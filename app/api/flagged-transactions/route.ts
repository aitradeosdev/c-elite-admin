import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, requireAdminAny } from '../../lib/guard';
import { writeAudit } from '../../lib/audit';
import { ok, fail, isUuid, parsePageParams, buildPagination, type PageParams } from '../../lib/api';
import { lagosDateToRangeEnd, lagosDateToRangeStart } from '../../lib/time';
import {
  FLAG_STATUSES, OPEN_STATUSES, SEARCH_USER_CAP, firstOf, flagSearchClause, parseSortKey, parseStatusFilter,
  parseTypeFilter, planFlagSearch, presentTransaction, presentWithdrawal, userMatchClause,
  type FlagSearch, type FlagSortKey, type FlagStatus, type OtherFlag, type Reviewer, type StatusCounts,
  type TransactionSummary, type WithdrawalSummary,
} from '../../lib/flags';

const LIST_COLUMNS =
  'id, user_id, transaction_id, transaction_type, amount, flag_reason, status, reviewed_by, reviewed_at, created_at, users(username, full_name, email)';
const DETAIL_COLUMNS =
  'id, user_id, transaction_id, transaction_type, amount, flag_reason, status, reviewed_by, reviewed_at, created_at, users(id, username, full_name, email, is_frozen, freeze_reason)';
const WITHDRAWAL_COLUMNS =
  'id, status, amount, fee, bank_name, account_number, account_name, gateway, failure_reason, created_at';
const TRANSACTION_COLUMNS = 'id, type, amount, status, reference_id, metadata, created_at';
const OTHER_FLAG_COLUMNS = 'id, flag_reason, status, created_at, reviewed_at';

const RANGE_NOT_SATISFIABLE = 'PGRST103';
const OTHER_FLAG_LIMIT = 10;
const TYPE_SCAN_LIMIT = 20;

const NO_TARGET = 'This flag does not record which transaction it was raised on.';
const WITHDRAWAL_MISSING = 'The withdrawal this flag was raised on could not be found.';
const WITHDRAWAL_FAILED = 'The withdrawal could not be loaded.';
const TRANSACTION_MISSING = 'The transaction this flag was raised on could not be found.';
const TRANSACTION_FAILED = 'The transaction could not be loaded.';
const REVIEWER_FAILED = 'The name of the admin who reviewed this flag could not be loaded.';
const OTHERS_FAILED = 'Other flags on the same transaction could not be checked.';

const EMPTY_COUNTS: StatusCounts = { pending_review: 0, escalated: 0, cleared: 0, rejected: 0 };

const ACTIONS: Record<string, { status: string; action: string; label: string }> = {
  clear: { status: 'cleared', action: 'CLEAR_FLAG', label: 'cleared' },
  escalate: { status: 'escalated', action: 'ESCALATE_FLAG', label: 'escalated' },
  reject: { status: 'rejected', action: 'REJECT_FLAG', label: 'rejected' },
};

interface Filters {
  statuses: readonly FlagStatus[];
  type: string;
  fromIso: string | null;
  toIso: string | null;
  match: string | null;
}

interface Sorting {
  key: FlagSortKey;
  ascending: boolean;
}

interface SearchMatch {
  match: string | null;
  nothing: boolean;
  capped: boolean;
}

interface FlagRow {
  id: string;
  transaction_id: string | null;
  transaction_type: string | null;
  user_id: string | null;
  reviewed_by: string | null;
  users?: unknown;
  [column: string]: unknown;
}

interface Related {
  withdrawal: WithdrawalSummary | null;
  transaction: TransactionSummary | null;
  error: string | null;
}

type Fetched = { rows: unknown[]; total: number } | { error: string };

function scoped(columns: string, filters: Filters, statuses: readonly FlagStatus[], count?: 'exact', head = false) {
  let query = supabaseAdmin.from('flagged_transactions').select(columns, { count, head });
  if (statuses.length === 1) query = query.eq('status', statuses[0]);
  else if (statuses.length > 1) query = query.in('status', statuses);
  if (filters.type) query = query.eq('transaction_type', filters.type);
  if (filters.fromIso) query = query.gte('created_at', filters.fromIso);
  if (filters.toIso) query = query.lt('created_at', filters.toIso);
  if (filters.match) query = query.or(filters.match);
  return query;
}

type FlagQuery = ReturnType<typeof scoped>;

function sortedBy(query: FlagQuery, sorting: Sorting): FlagQuery {
  if (sorting.key === 'amount') {
    return query
      .order('amount', { ascending: sorting.ascending, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
  }
  return query
    .order('created_at', { ascending: sorting.ascending })
    .order('id', { ascending: sorting.ascending });
}

async function fetchPage(filters: Filters, sorting: Sorting, paging: PageParams): Promise<Fetched> {
  const { data, error, count } = await sortedBy(scoped(LIST_COLUMNS, filters, filters.statuses, 'exact'), sorting)
    .range(paging.from, paging.to);
  if (!error) return { rows: data ?? [], total: count ?? 0 };
  if (error.code !== RANGE_NOT_SATISFIABLE) return { error: error.message };
  const { count: matching, error: countError } = await scoped('id', filters, filters.statuses, 'exact', true);
  if (countError) return { error: countError.message };
  return { rows: [], total: matching ?? 0 };
}

async function statusCounts(filters: Filters): Promise<StatusCounts> {
  const results = await Promise.all(
    FLAG_STATUSES.map((status) => scoped('id', filters, [status], 'exact', true)),
  );
  const counts: Record<FlagStatus, number | null> = { ...EMPTY_COUNTS };
  FLAG_STATUSES.forEach((status, index) => {
    const { count, error } = results[index];
    if (error) console.error(`flagged_transactions count (${status}):`, error.message);
    counts[status] = error ? null : count ?? 0;
  });
  return counts;
}

async function openCount(): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('flagged_transactions')
    .select('id', { count: 'exact', head: true })
    .in('status', OPEN_STATUSES);
  if (error) console.error('flagged_transactions open count:', error.message);
  return error ? null : count ?? null;
}

async function presentTypes(): Promise<string[] | null> {
  const types: string[] = [];
  let after: string | null = null;
  while (types.length < TYPE_SCAN_LIMIT) {
    let query = supabaseAdmin
      .from('flagged_transactions')
      .select('transaction_type')
      .not('transaction_type', 'is', null);
    if (after !== null) query = query.gt('transaction_type', after);
    const { data, error } = await query.order('transaction_type', { ascending: true }).limit(1);
    if (error) {
      console.error('flagged_transactions types:', error.message);
      return null;
    }
    const next = (data?.[0] as { transaction_type?: unknown } | undefined)?.transaction_type;
    if (typeof next !== 'string') break;
    types.push(next);
    after = next;
  }
  return types;
}

async function buildMatch(plan: FlagSearch): Promise<SearchMatch | null> {
  if (plan.kind === 'none') return { match: null, nothing: false, capped: false };
  let userIds: string[] = [];
  if (plan.kind === 'text' && plan.userTerm) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .or(userMatchClause(plan.userTerm))
      .limit(SEARCH_USER_CAP + 1);
    if (error) {
      console.error('flagged_transactions search:', error.message);
      return null;
    }
    userIds = ((data ?? []) as { id: unknown }[]).map((user) => user.id).filter(isUuid);
  }
  const match = flagSearchClause(plan, userIds);
  return { match, nothing: match === null, capped: userIds.length > SEARCH_USER_CAP };
}

async function listFlags(
  filters: Filters,
  sorting: Sorting,
  paging: PageParams,
  search: SearchMatch,
  wantTypes: boolean,
) {
  const [fetched, counts, open, types] = await Promise.all([
    search.nothing ? Promise.resolve<Fetched>({ rows: [], total: 0 }) : fetchPage(filters, sorting, paging),
    search.nothing ? Promise.resolve(EMPTY_COUNTS) : statusCounts(filters),
    openCount(),
    wantTypes ? presentTypes() : Promise.resolve(null),
  ]);
  if ('error' in fetched) {
    console.error('flagged_transactions list:', fetched.error);
    return fail('INTERNAL_ERROR', 'Flagged transactions could not be loaded.');
  }
  return ok(
    {
      flagged: fetched.rows,
      open_count: open,
      total: fetched.total,
      counts,
      types,
      search_capped: search.capped,
    },
    { pagination: buildPagination(paging.page, paging.pageSize, fetched.total) },
  );
}

async function readReviewer(adminId: string | null): Promise<{ value: Reviewer | null; error: string | null }> {
  if (!isUuid(adminId)) return { value: null, error: null };
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('id, username')
    .eq('id', adminId)
    .maybeSingle();
  if (error) {
    console.error('flagged_transactions reviewer:', error.message);
    return { value: null, error: REVIEWER_FAILED };
  }
  const row = data as { id?: unknown; username?: unknown } | null;
  if (!row || typeof row.id !== 'string') return { value: null, error: null };
  return { value: { id: row.id, username: typeof row.username === 'string' ? row.username : null }, error: null };
}

async function readRelated(flag: FlagRow): Promise<Related> {
  const target = typeof flag.transaction_id === 'string' ? flag.transaction_id.trim() : '';
  if (!target) return { withdrawal: null, transaction: null, error: NO_TARGET };

  if (flag.transaction_type === 'withdrawal') {
    if (!isUuid(target)) return { withdrawal: null, transaction: null, error: WITHDRAWAL_MISSING };
    const { data, error } = await supabaseAdmin
      .from('withdrawals')
      .select(WITHDRAWAL_COLUMNS)
      .eq('id', target)
      .maybeSingle();
    if (error) {
      console.error('flagged_transactions withdrawal:', error.message);
      return { withdrawal: null, transaction: null, error: WITHDRAWAL_FAILED };
    }
    if (!data) return { withdrawal: null, transaction: null, error: WITHDRAWAL_MISSING };
    return { withdrawal: presentWithdrawal(data as Record<string, unknown>), transaction: null, error: null };
  }

  const lowered = target.toLowerCase();
  const owner = isUuid(flag.user_id) ? flag.user_id : null;
  const all = supabaseAdmin.from('transactions').select(TRANSACTION_COLUMNS);
  const base = owner ? all.eq('user_id', owner) : all;
  const matching = isUuid(target)
    ? base.or(`id.eq.${lowered},reference_id.eq.${lowered}`)
    : base.eq('reference_id', target);
  const { data, error } = await matching.order('created_at', { ascending: false }).limit(2);
  if (error) {
    console.error('flagged_transactions transaction:', error.message);
    return { withdrawal: null, transaction: null, error: TRANSACTION_FAILED };
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const row = rows.find((candidate) => candidate.id === lowered) ?? rows[0];
  if (!row) return { withdrawal: null, transaction: null, error: TRANSACTION_MISSING };
  return { withdrawal: null, transaction: presentTransaction(row), error: null };
}

async function readOtherFlags(flag: FlagRow): Promise<{ value: OtherFlag[] | null; error: string | null }> {
  if (!flag.transaction_id || !flag.transaction_type) return { value: [], error: null };
  const { data, error } = await supabaseAdmin
    .from('flagged_transactions')
    .select(OTHER_FLAG_COLUMNS)
    .eq('transaction_type', flag.transaction_type)
    .eq('transaction_id', flag.transaction_id)
    .neq('id', flag.id)
    .order('created_at', { ascending: false })
    .limit(OTHER_FLAG_LIMIT);
  if (error) {
    console.error('flagged_transactions other flags:', error.message);
    return { value: null, error: OTHERS_FAILED };
  }
  return { value: (data ?? []) as unknown as OtherFlag[], error: null };
}

async function readDetail(id: string) {
  if (!isUuid(id)) return fail('VALIDATION_ERROR', 'Invalid flag id.');

  const { data, error } = await supabaseAdmin
    .from('flagged_transactions')
    .select(DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('flagged_transactions detail:', error.message);
    return fail('INTERNAL_ERROR', 'The flag could not be loaded.');
  }
  if (!data) return fail('RESOURCE_NOT_FOUND', 'Flag not found.');

  const flag = data as unknown as FlagRow;
  const [reviewer, related, others] = await Promise.all([
    readReviewer(flag.reviewed_by),
    readRelated(flag),
    readOtherFlags(flag),
  ]);

  return ok({
    flag: { ...flag, users: firstOf(flag.users) },
    reviewer: reviewer.value,
    withdrawal: related.withdrawal,
    transaction: related.transaction,
    other_flags: others.value,
    partial: { reviewer: reviewer.error, related: related.error, other_flags: others.error },
  });
}

export async function GET(req: NextRequest) {
  const guard = await requireAdminAny(['flags.read', 'withdrawals.read']);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const params = url.searchParams;

  try {
    const id = (params.get('id') || '').trim();
    if (id) return await readDetail(id);

    const statuses = parseStatusFilter(params.get('status'));
    if (!statuses) return fail('VALIDATION_ERROR', 'Unknown status filter.');
    const type = parseTypeFilter(params.get('type'));
    if (type === null) return fail('VALIDATION_ERROR', 'Unknown transaction type filter.');

    const dateFrom = (params.get('date_from') || '').trim();
    const dateTo = (params.get('date_to') || '').trim();
    const fromIso = dateFrom ? lagosDateToRangeStart(dateFrom) : null;
    const toIso = dateTo ? lagosDateToRangeEnd(dateTo) : null;
    if ((dateFrom && !fromIso) || (dateTo && !toIso)) {
      return fail('VALIDATION_ERROR', 'Dates must be calendar days in YYYY-MM-DD format.');
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return fail('VALIDATION_ERROR', 'date_from must be on or before date_to.');
    }

    const sorting: Sorting = { key: parseSortKey(params.get('sort')), ascending: params.get('dir') === 'asc' };
    const paging = parsePageParams(url, { defaultSize: 200, maxSize: 200 });

    const search = await buildMatch(planFlagSearch(params.get('search')));
    if (!search) return fail('INTERNAL_ERROR', 'The search could not be run.');

    const filters: Filters = { statuses, type, fromIso, toIso, match: search.match };
    return await listFlags(filters, sorting, paging, search, params.get('types') === '1');
  } catch (error) {
    console.error('flagged_transactions route:', error instanceof Error ? error.message : error);
    return fail('INTERNAL_ERROR', 'Flagged transactions could not be loaded.');
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin('flags.resolve');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body = await req.json().catch(() => ({}));
  const actionKey = typeof (body as { action?: unknown })?.action === 'string'
    ? (body as { action: string }).action
    : '';
  const flagId = typeof (body as { flag_id?: unknown })?.flag_id === 'string'
    ? (body as { flag_id: string }).flag_id
    : '';
  const reason = String((body as { reason?: unknown })?.reason || '').trim().slice(0, 500) || null;

  if (!isUuid(flagId)) return fail('VALIDATION_ERROR', 'A valid flag id is required.');
  const spec = ACTIONS[actionKey];
  if (!spec) return fail('VALIDATION_ERROR', 'Unknown action.');

  const { data: before, error: readErr } = await supabaseAdmin
    .from('flagged_transactions')
    .select('id, status, user_id, transaction_id, transaction_type, amount, flag_reason')
    .eq('id', flagId)
    .maybeSingle();

  if (readErr) return fail('INTERNAL_ERROR', 'The flag could not be read.');
  if (!before) return fail('RESOURCE_NOT_FOUND', 'Flag not found.');
  if (!OPEN_STATUSES.includes(before.status)) {
    return fail('STATE_CONFLICT', `This flag is already ${before.status.replace(/_/g, ' ')}.`, {
      details: { status: before.status },
    });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('flagged_transactions')
    .update({ status: spec.status, reviewed_by: admin.admin_id, reviewed_at: new Date().toISOString() })
    .eq('id', flagId)
    .in('status', OPEN_STATUSES)
    .select('id');

  if (error) {
    await writeAudit({
      admin,
      action: spec.action,
      entity: 'flagged_transactions',
      entity_id: flagId,
      user_id: before.user_id,
      before: { status: before.status },
      reason,
      result: 'failure',
      error: error.message,
      sensitivity: 'security',
    });
    console.error('flagged_transactions update:', error.message);
    return fail('INTERNAL_ERROR', 'The flag could not be updated.');
  }

  if (!updated || updated.length === 0) {
    return fail('STATE_CONFLICT', 'Another admin resolved this flag first. Reload to see the current state.');
  }

  const audit = await writeAudit({
    admin,
    action: spec.action,
    entity: 'flagged_transactions',
    entity_id: flagId,
    user_id: before.user_id,
    before: { status: before.status },
    after: {
      status: spec.status,
      transaction_id: before.transaction_id,
      transaction_type: before.transaction_type,
      amount: before.amount,
    },
    reason,
    result: 'success',
    sensitivity: 'security',
  });

  return ok({
    status: spec.status,
    audit_recorded: audit.ok,
    ...(audit.ok ? {} : { warning: `The flag was ${spec.label} but could not be written to the audit log.` }),
  });
}
