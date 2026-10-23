import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit } from '../../lib/audit';
import { ok, fail, isUuid, buildPagination } from '../../lib/api';
import { sanitizeSearch, clampPagination } from '../../lib/sanitize';
import { formatBusinessDateTime, lagosDateToRangeEnd, lagosDateToRangeStart } from '../../lib/time';
import { readPayoutGateway } from '../../lib/gateway';

const LIST_COLUMNS =
  'id, user_id, amount, fee, bank_name, account_number, account_name, gateway, gateway_reference, status, failure_reason, created_at';
const EXPORT_COLUMNS =
  'id, user_id, amount, fee, bank_name, account_number, account_name, gateway, gateway_reference, status, created_at';
const FLAG_COLUMNS = 'id, transaction_id, flag_reason, status, created_at, reviewed_at';

const REVIEW_STATUSES = ['pending_review', 'held'];
const SORT_KEYS = new Set(['created_at', 'amount']);
const STATUS_TOKEN = /^[a-z_]{1,32}$/;
const MAX_STATUSES = 8;

const MAX_PAGE_SIZE = 100;
const EXPORT_CAP = 50000;
const EXPORT_BATCH = 1000;
const LOOKUP_BATCH = 100;
const LOOKUP_PARALLEL = 4;
const SEARCH_USER_CAP = 100;
const RANGE_NOT_SATISFIABLE = 'PGRST103';
const EMERGENCY_KEY = 'emergency_mode';

interface WithdrawalRow {
  id: string;
  user_id: string | null;
  amount: number | string | null;
  fee: number | string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  gateway: string | null;
  gateway_reference: string | null;
  status: string;
  failure_reason?: string | null;
  created_at: string;
}

interface UserRow {
  id: string;
  username: string | null;
  full_name: string | null;
  email?: string | null;
  is_frozen?: boolean | null;
}

interface FlagRow {
  id: string;
  transaction_id: string;
  flag_reason: string | null;
  status: string | null;
  created_at: string | null;
  reviewed_at: string | null;
}

interface Filters {
  statuses: string[];
  review: boolean;
  fromIso: string | null;
  toIso: string | null;
  match: string | null;
  through?: string;
}

interface Sorting {
  key: string;
  ascending: boolean;
}

function parseStatuses(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (!trimmed.includes(',')) return [trimmed];
  const tokens = Array.from(new Set(trimmed.split(',').map((token) => token.trim()).filter(Boolean)));
  if (tokens.length === 0 || tokens.length > MAX_STATUSES || !tokens.every((token) => STATUS_TOKEN.test(token))) {
    return null;
  }
  return tokens;
}

function scoped(columns: string, filters: Filters, count?: 'exact', head = false) {
  let query = supabaseAdmin.from('withdrawals').select(columns, { count, head });
  if (filters.review) query = query.in('status', REVIEW_STATUSES);
  else if (filters.statuses.length === 1) query = query.eq('status', filters.statuses[0]);
  else if (filters.statuses.length > 1) query = query.in('status', filters.statuses);
  if (filters.fromIso) query = query.gte('created_at', filters.fromIso);
  if (filters.toIso) query = query.lt('created_at', filters.toIso);
  if (filters.through) query = query.lte('created_at', filters.through);
  if (filters.match) query = query.or(filters.match);
  return query;
}

async function buildSearch(search: string): Promise<{ clause: string; capped: boolean } | null> {
  const pattern = `%${search}%`;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .or(`full_name.ilike.${pattern},username.ilike.${pattern},email.ilike.${pattern}`)
    .limit(SEARCH_USER_CAP + 1);
  if (error) {
    console.error('withdrawals search:', error.message);
    return null;
  }
  const ids = ((data ?? []) as { id: string }[]).map((user) => user.id).filter((id) => isUuid(id));
  const clauses = [
    `account_name.ilike.${pattern}`,
    `account_number.ilike.${pattern}`,
    `gateway_reference.ilike.${pattern}`,
  ];
  if (isUuid(search)) clauses.push(`id.eq.${search}`, `user_id.eq.${search}`);
  if (ids.length) clauses.unshift(`user_id.in.(${ids.slice(0, SEARCH_USER_CAP).join(',')})`);
  return { clause: clauses.join(','), capped: ids.length > SEARCH_USER_CAP };
}

async function lookupUsers(userIds: Array<string | null>, columns: string): Promise<Map<string, UserRow> | null> {
  const unique = Array.from(new Set(userIds.filter((id): id is string => isUuid(id))));
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += LOOKUP_BATCH) chunks.push(unique.slice(i, i + LOOKUP_BATCH));
  const users = new Map<string, UserRow>();
  for (let i = 0; i < chunks.length; i += LOOKUP_PARALLEL) {
    const results = await Promise.all(
      chunks.slice(i, i + LOOKUP_PARALLEL).map((chunk) => supabaseAdmin.from('users').select(columns).in('id', chunk)),
    );
    for (const { data, error } of results) {
      if (error) {
        console.error('withdrawals user lookup:', error.message);
        return null;
      }
      for (const user of (data ?? []) as unknown as UserRow[]) users.set(user.id, user);
    }
  }
  return users;
}

async function lookupFlags(withdrawalIds: string[]): Promise<{ flags: Map<string, Omit<FlagRow, 'transaction_id'>>; error: string | null }> {
  const flags = new Map<string, Omit<FlagRow, 'transaction_id'>>();
  if (withdrawalIds.length === 0) return { flags, error: null };
  const { data, error } = await supabaseAdmin
    .from('flagged_transactions')
    .select(FLAG_COLUMNS)
    .eq('transaction_type', 'withdrawal')
    .in('transaction_id', withdrawalIds)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('withdrawals flag lookup:', error.message);
    return { flags, error: 'Flag markers could not be loaded.' };
  }
  for (const flag of (data ?? []) as unknown as FlagRow[]) {
    if (flags.has(flag.transaction_id)) continue;
    const { transaction_id: transactionId, ...rest } = flag;
    flags.set(transactionId, rest);
  }
  return { flags, error: null };
}

async function readEmergencyMode(): Promise<boolean | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('value')
      .eq('key', EMERGENCY_KEY)
      .maybeSingle<{ value: string | null }>();
    if (error) {
      console.error('withdrawals emergency mode:', error.message);
      return null;
    }
    return data?.value === 'true';
  } catch (error) {
    console.error('withdrawals emergency mode:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function readDetail(id: string) {
  if (!isUuid(id)) return fail('VALIDATION_ERROR', 'Invalid withdrawal id.');

  const { data: withdrawal, error } = await supabaseAdmin
    .from('withdrawals')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('withdrawal detail:', error.message);
    return fail('INTERNAL_ERROR', 'The withdrawal could not be loaded.');
  }
  if (!withdrawal) return fail('RESOURCE_NOT_FOUND', 'Withdrawal not found.');

  const userId: unknown = withdrawal.user_id;
  const awaitingDecision = REVIEW_STATUSES.includes(String(withdrawal.status));
  const [userResult, flagResult, payoutLookup, emergencyMode] = await Promise.all([
    isUuid(userId)
      ? supabaseAdmin
          .from('users')
          .select('id, username, full_name, email, phone, is_frozen, freeze_reason')
          .eq('id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabaseAdmin
      .from('flagged_transactions')
      .select('id, flag_reason, status, created_at, reviewed_at')
      .eq('transaction_type', 'withdrawal')
      .eq('transaction_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    awaitingDecision ? readPayoutGateway(supabaseAdmin) : Promise.resolve(null),
    readEmergencyMode(),
  ]);

  if (userResult.error) console.error('withdrawal detail user:', userResult.error.message);
  if (flagResult.error) console.error('withdrawal detail flag:', flagResult.error.message);

  return ok({
    withdrawal: { ...withdrawal, user: userResult.data ?? null, flag: flagResult.data ?? null },
    partial: {
      user: userResult.error ? 'The account holder could not be loaded.' : null,
      flag: flagResult.error ? 'The flag status could not be checked.' : null,
    },
    payout_gateway: payoutLookup?.kind === 'gateway' ? payoutLookup.gateway : null,
    payout_gateway_missing: payoutLookup?.kind === 'none',
    emergency_mode: emergencyMode,
  });
}

async function listWithdrawals(
  filters: Filters,
  sorting: Sorting,
  paging: { page: number; limit: number; offset: number },
  searchCapped: boolean,
) {
  const { page, limit, offset } = paging;
  const emergency = readEmergencyMode();
  const { data, error, count } = await scoped(LIST_COLUMNS, filters, 'exact')
    .order(sorting.key, { ascending: sorting.ascending })
    .order('id', { ascending: sorting.ascending })
    .range(offset, offset + limit - 1);

  let rows = (data ?? []) as unknown as WithdrawalRow[];
  let total = count ?? 0;

  if (error) {
    if (error.code !== RANGE_NOT_SATISFIABLE) {
      console.error('withdrawals list:', error.message);
      return fail('INTERNAL_ERROR', 'Withdrawals could not be loaded.');
    }
    const { count: matching, error: countError } = await scoped('id', filters, 'exact', true);
    if (countError) {
      console.error('withdrawals count:', countError.message);
      return fail('INTERNAL_ERROR', 'Withdrawals could not be loaded.');
    }
    rows = [];
    total = matching ?? 0;
  }

  const users = await lookupUsers(rows.map((row) => row.user_id), 'id, username, full_name, email, is_frozen');
  if (!users) return fail('INTERNAL_ERROR', 'Withdrawals could not be loaded.');
  const { flags, error: flagError } = await lookupFlags(rows.map((row) => row.id));

  const withdrawals = rows.map((row) => ({
    ...row,
    user: (row.user_id && users.get(row.user_id)) || null,
    flag: flags.get(row.id) ?? null,
  }));
  const emergencyMode = await emergency;

  return ok(
    {
      withdrawals,
      total,
      page,
      limit,
      sort: sorting.key,
      dir: sorting.ascending ? 'asc' : 'desc',
      search_capped: searchCapped,
      emergency_mode: emergencyMode,
      partial: { flags: flagError },
    },
    { pagination: buildPagination(page, limit, total) },
  );
}

function csvField(value: unknown): string {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}

async function collectExport(filters: Filters, sorting: Sorting) {
  const snapshot: Filters = { ...filters, through: new Date().toISOString() };
  const { count, error: countError } = await scoped('id', snapshot, 'exact', true);
  if (countError) return { error: countError.message } as const;

  const total = count ?? 0;
  const target = Math.min(total, EXPORT_CAP);
  const seen = new Set<string>();
  const rows: WithdrawalRow[] = [];
  let offset = 0;

  while (offset < target) {
    const end = Math.min(offset + EXPORT_BATCH, target) - 1;
    const { data, error } = await scoped(EXPORT_COLUMNS, snapshot)
      .order(sorting.key, { ascending: sorting.ascending })
      .order('id', { ascending: sorting.ascending })
      .range(offset, end);
    if (error) {
      if (error.code === RANGE_NOT_SATISFIABLE) break;
      return { error: error.message } as const;
    }
    const batch = (data ?? []) as unknown as WithdrawalRow[];
    if (batch.length === 0) break;
    for (const row of batch) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    offset += batch.length;
  }

  return { rows, total, truncated: rows.length < total } as const;
}

async function exportWithdrawals(
  admin: AdminContext,
  format: 'csv' | 'pdf',
  filters: Filters,
  sorting: Sorting,
  echo: Record<string, string | boolean | null>,
) {
  const collected = await collectExport(filters, sorting);
  if ('error' in collected) {
    console.error('withdrawals export:', collected.error);
    return fail('INTERNAL_ERROR', 'The export could not be built.');
  }

  const users = await lookupUsers(collected.rows.map((row) => row.user_id), 'id, username, full_name');
  if (!users) return fail('INTERNAL_ERROR', 'The export could not be built.');

  const exportRows = collected.rows.map((row) => {
    const user = row.user_id ? users.get(row.user_id) : undefined;
    return {
      ID: row.id,
      User: user?.username || user?.full_name || '',
      Amount: row.amount,
      Bank: row.bank_name || '',
      Account: row.account_number || '',
      AccountName: row.account_name || '',
      Status: row.status || '',
      Gateway: row.gateway || '',
      GatewayRef: row.gateway_reference || '',
      Date: row.created_at,
      Fee: row.fee ?? 0,
      DateLagos: formatBusinessDateTime(row.created_at),
    };
  });

  const audit = await writeAudit({
    admin,
    action: format === 'csv' ? 'EXPORT_CSV' : 'EXPORT_PDF',
    entity: 'withdrawals',
    entity_id: null,
    after: {
      format,
      rows: exportRows.length,
      total: collected.total,
      truncated: collected.truncated,
      filters: echo,
    },
    result: 'success',
    sensitivity: 'sensitive',
  });
  if (!audit.ok) {
    return fail('AUDIT_FAILED', 'The export was blocked because it could not be recorded in the audit log. Try again shortly.');
  }

  if (format === 'pdf') {
    return ok({ rows: exportRows, total: collected.total, truncated: collected.truncated });
  }

  const header = 'ID,User,Amount,Bank,Account,AccountName,Status,Gateway,GatewayRef,Date,Fee,DateLagos\n';
  const body = exportRows
    .map((r) => [
      r.ID, r.User, r.Amount, r.Bank, r.Account, r.AccountName,
      r.Status, r.Gateway, r.GatewayRef, r.Date, r.Fee, r.DateLagos,
    ].map(csvField).join(','))
    .join('\n');

  return new Response(header + body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="withdrawals-${Date.now()}.csv"`,
      'Cache-Control': 'no-store',
      'X-Total-Count': String(collected.total),
      'X-Export-Rows': String(exportRows.length),
      'X-Export-Truncated': collected.truncated ? '1' : '0',
      'x-request-id': admin.request_id,
    },
  });
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const id = params.get('id');
  const format = params.get('pdf') === '1' ? 'pdf' : params.get('csv') === '1' ? 'csv' : null;

  const guard = await requireAdmin(!id && format ? 'withdrawals.export' : 'withdrawals.read');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  if (id) return readDetail(id);

  const statuses = parseStatuses(params.get('status') || '');
  if (!statuses) return fail('VALIDATION_ERROR', 'Unknown status filter.');

  const dateFrom = (params.get('date_from') || '').trim();
  const dateTo = (params.get('date_to') || '').trim();
  const fromIso = dateFrom ? lagosDateToRangeStart(dateFrom) : null;
  const toIso = dateTo ? lagosDateToRangeEnd(dateTo) : null;
  if ((dateFrom && !fromIso) || (dateTo && !toIso)) {
    return fail('VALIDATION_ERROR', 'Dates must be calendar days in YYYY-MM-DD format.');
  }

  const sortParam = params.get('sort') || '';
  const sorting: Sorting = {
    key: SORT_KEYS.has(sortParam) ? sortParam : 'created_at',
    ascending: params.get('dir') === 'asc',
  };

  const review = params.get('review') === '1';
  const search = sanitizeSearch(params.get('search') || '');
  const filters: Filters = { statuses, review, fromIso, toIso, match: null };

  let searchCapped = false;
  if (search) {
    const built = await buildSearch(search);
    if (!built) return fail('INTERNAL_ERROR', 'The search could not be run.');
    filters.match = built.clause;
    searchCapped = built.capped;
  }

  if (format) {
    return exportWithdrawals(admin, format, filters, sorting, {
      status: statuses.join(',') || null,
      review,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      search: search || null,
      sort: sorting.key,
      dir: sorting.ascending ? 'asc' : 'desc',
    });
  }

  const paging = clampPagination(params.get('page'), params.get('limit'), MAX_PAGE_SIZE);
  return listWithdrawals(filters, sorting, paging, searchCapped);
}
