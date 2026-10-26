import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit } from '../../lib/audit';
import { ok, fail, isUuid, buildPagination, type ApiErrorCode } from '../../lib/api';
import { sanitizeSearch } from '../../lib/sanitize';
import { isBusinessDateKey, lagosDateToRangeEnd, lagosDateToRangeStart } from '../../lib/time';

const STATUS_FILTERS: ReadonlySet<string> = new Set([
  'pending', 'approved', 'rejected', 'disputed', 'dispute_resolved',
]);

const SORT_COLUMNS: ReadonlyMap<string, string> = new Map([
  ['created_at', 'created_at'],
  ['amount', 'payout_naira'],
]);

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 200;
const USER_MATCH_CAP = 100;
const CARD_MATCH_CAP = 50;
const SIGNED_URL_TTL_SECONDS = 3600;
const TEXT_MAX = 500;
const DEFAULT_APPROVAL_LIMIT = 5000000;

const USER_FIELDS = 'id, full_name, username, email';
const LIST_FIELDS = 'id, amount_foreign, payout_naira, status, created_at, rejection_reason, dispute_message, cards(name), card_types(name, country_code)';

const DETAIL_FIELDS = `
  id, amount_foreign, payout_naira, rate_at_submission, status, rejection_reason,
  submitted_fields, card_images, dispute_message, dispute_images, coupon_code, coupon_bonus, created_at,
  card_id, card_type_id,
  users(id, full_name, username, email),
  cards(id, name),
  card_types(id, name, country_code),
  range_label_at_submission
`;

const DECISION_FIELDS = 'id, status, user_id, card_id, card_type_id, amount_foreign, payout_naira, coupon_code, coupon_bonus';

type Decision = 'approve' | 'overturn' | 'reject' | 'uphold';

const DECISIONS: ReadonlySet<string> = new Set(['approve', 'overturn', 'reject', 'uphold']);

const AUDIT_ACTION: Readonly<Record<Decision, string>> = {
  approve: 'APPROVE_CARD',
  overturn: 'OVERTURN_DISPUTE',
  reject: 'REJECT_CARD',
  uphold: 'UPHOLD_DISPUTE',
};

const REQUIRED_STATUS: Readonly<Record<Decision, string>> = {
  approve: 'pending',
  overturn: 'disputed',
  reject: 'pending',
  uphold: 'disputed',
};

const STATUS_PHRASE: Readonly<Record<string, string>> = {
  pending: 'pending review',
  approved: 'already approved',
  rejected: 'rejected',
  disputed: 'under dispute',
  dispute_resolved: 'closed after a dispute',
};

interface DecisionRow {
  id: string;
  status: string;
  user_id: string | null;
  card_id: string | null;
  card_type_id: string | null;
  amount_foreign: number | string | null;
  payout_naira: number | string | null;
  coupon_code: string | null;
  coupon_bonus: number | string | null;
}

type SearchPlan =
  | { kind: 'none' }
  | { kind: 'nothing' }
  | { kind: 'users'; term: string }
  | { kind: 'any'; filter: string; truncated: boolean };

interface ListFilters {
  status: string | null;
  from: string | null;
  to: string | null;
  search: SearchPlan;
}

interface QueueCounts {
  pending: number | null;
  disputed: number | null;
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function userMatchFilter(term: string): string {
  return `username.ilike.%${term}%,full_name.ilike.%${term}%,email.ilike.%${term}%`;
}

function readPaging(url: URL) {
  const rawPage = Number(url.searchParams.get('page') || '1');
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const rawLimit = url.searchParams.get('limit') ?? url.searchParams.get('page_size');
  const parsedLimit = Number(rawLimit);
  const limit = rawLimit !== null && rawLimit !== '' && Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.min(Math.floor(parsedLimit), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  return { page, limit, offset: (page - 1) * limit };
}

async function planSearch(raw: string): Promise<SearchPlan | null> {
  const term = sanitizeSearch(raw);
  if (!term) return { kind: 'none' };
  const lowered = term.toLowerCase();
  if (isUuid(lowered)) {
    return { kind: 'any', filter: `id.eq.${lowered},user_id.eq.${lowered}`, truncated: false };
  }

  const userTerm = term.replace(/^@+/, '').trim();
  const { data: cards, error: cardError } = await supabaseAdmin
    .from('cards')
    .select('id')
    .ilike('name', `%${term}%`)
    .limit(CARD_MATCH_CAP + 1);
  if (cardError) {
    console.error('card-queue search (cards):', cardError.message);
    return null;
  }

  const cardIds = (cards || []).map((c: { id: string }) => c.id);
  if (cardIds.length === 0) return userTerm ? { kind: 'users', term: userTerm } : { kind: 'nothing' };

  const clauses = [`card_id.in.(${cardIds.slice(0, CARD_MATCH_CAP).join(',')})`];
  let truncated = cardIds.length > CARD_MATCH_CAP;

  if (userTerm) {
    const { data: users, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .or(userMatchFilter(userTerm))
      .limit(USER_MATCH_CAP + 1);
    if (userError) {
      console.error('card-queue search (users):', userError.message);
      return null;
    }
    const userIds = (users || []).map((u: { id: string }) => u.id);
    if (userIds.length > USER_MATCH_CAP) truncated = true;
    if (userIds.length > 0) clauses.push(`user_id.in.(${userIds.slice(0, USER_MATCH_CAP).join(',')})`);
  }

  return { kind: 'any', filter: clauses.join(','), truncated };
}

function filteredQuery(filters: ListFilters, select: string, head: boolean) {
  let query = supabaseAdmin.from('card_submissions').select(select, { count: 'exact', head });
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lt('created_at', filters.to);
  if (filters.search.kind === 'users') {
    query = query.or(userMatchFilter(filters.search.term), { referencedTable: 'users' });
  } else if (filters.search.kind === 'any') {
    query = query.or(filters.search.filter);
  }
  return query;
}

async function queueCounts(): Promise<QueueCounts> {
  const [pending, disputed] = await Promise.all([
    supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).eq('status', 'disputed'),
  ]);
  return {
    pending: pending.error ? null : pending.count ?? 0,
    disputed: disputed.error ? null : disputed.count ?? 0,
  };
}

async function listSubmissions(admin: AdminContext, url: URL) {
  const rawStatus = url.searchParams.get('status') || '';
  if (rawStatus && rawStatus !== 'all' && !STATUS_FILTERS.has(rawStatus)) {
    return fail('VALIDATION_ERROR', 'Unknown status filter.');
  }

  const dateFrom = url.searchParams.get('date_from') || '';
  const dateTo = url.searchParams.get('date_to') || '';
  if (dateFrom && !isBusinessDateKey(dateFrom)) return fail('VALIDATION_ERROR', 'date_from must be a YYYY-MM-DD date.');
  if (dateTo && !isBusinessDateKey(dateTo)) return fail('VALIDATION_ERROR', 'date_to must be a YYYY-MM-DD date.');
  if (dateFrom && dateTo && dateFrom > dateTo) return fail('VALIDATION_ERROR', 'date_from must be on or before date_to.');

  const { page, limit, offset } = readPaging(url);
  const sortColumn = SORT_COLUMNS.get(url.searchParams.get('sort') || '') ?? null;
  const column = sortColumn ?? 'created_at';
  const ascending = sortColumn !== null && url.searchParams.get('dir') === 'asc';

  const countsPromise = queueCounts();
  const plan = await planSearch(url.searchParams.get('search') || '');
  if (!plan) return fail('INTERNAL_ERROR', 'The search could not be run.');

  const canReview = admin.can('cards.review');
  const truncated = plan.kind === 'any' && plan.truncated;
  const respond = async (rows: unknown[], total: number | null) => ok(
    {
      submissions: rows,
      total: total ?? rows.length,
      page,
      limit,
      counts: await countsPromise,
      can_review: canReview,
      ...(truncated ? { search_truncated: true } : {}),
    },
    { pagination: buildPagination(page, limit, total) },
  );

  if (plan.kind === 'nothing') return respond([], 0);

  const filters: ListFilters = {
    status: rawStatus && rawStatus !== 'all' ? rawStatus : null,
    from: dateFrom ? lagosDateToRangeStart(dateFrom) : null,
    to: dateTo ? lagosDateToRangeEnd(dateTo) : null,
    search: plan,
  };
  const innerUsers = plan.kind === 'users';

  let query = filteredQuery(filters, `${LIST_FIELDS}, users${innerUsers ? '!inner' : ''}(${USER_FIELDS})`, false)
    .order(column, { ascending, nullsFirst: false });
  if (column !== 'created_at') query = query.order('created_at', { ascending: false });
  const { data, error, count } = await query
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    if (error.code === 'PGRST103') {
      const { count: total, error: countError } = await filteredQuery(
        filters,
        innerUsers ? `id, users!inner(${USER_FIELDS})` : 'id',
        true,
      );
      if (!countError) return respond([], total ?? 0);
    }
    console.error('card-queue list:', error.message);
    return fail('INTERNAL_ERROR', 'The card queue could not be loaded.');
  }

  return respond(data || [], count ?? null);
}

async function signImagePaths(paths: unknown): Promise<string[]> {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const signed = await Promise.all(paths.map(async (path) => {
    if (typeof path !== 'string' || !path) return null;
    const { data } = await supabaseAdmin.storage.from('card-images').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    return data?.signedUrl || null;
  }));
  return signed.filter((u): u is string => Boolean(u));
}

async function countryFor(
  cardId: string | null,
  countryCode: string | null | undefined,
): Promise<{ name: string | null; symbol: string | null }> {
  if (!countryCode || !cardId) return { name: null, symbol: null };
  const { data } = await supabaseAdmin
    .from('card_countries')
    .select('country_name, currency_symbol')
    .eq('card_id', cardId)
    .eq('country_code', countryCode)
    .maybeSingle();
  const row = data as { country_name?: string | null; currency_symbol?: string | null } | null;
  return { name: row?.country_name || countryCode, symbol: row?.currency_symbol || null };
}

async function cardTypesFor(cardId: string | null) {
  if (!cardId) return [];
  const { data: types } = await supabaseAdmin
    .from('card_types')
    .select('id, name, country_code, card_id')
    .eq('card_id', cardId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  const typeRows = (types || []) as Array<{ id: string }>;
  const typeIds = typeRows.map((t) => t.id);
  let denominations: Array<{ card_type_id: string }> = [];
  if (typeIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('denominations')
      .select('id, card_type_id, range_label, min_value, max_value, rate_naira')
      .in('card_type_id', typeIds)
      .eq('is_active', true);
    denominations = (data || []) as Array<{ card_type_id: string }>;
  }
  return typeRows.map((t) => ({
    ...t,
    denominations: denominations.filter((d) => d.card_type_id === t.id),
  }));
}

async function fieldLabelsFor(cardTypeId: string | null): Promise<Record<string, string>> {
  if (!cardTypeId) return {};
  const { data } = await supabaseAdmin
    .from('card_type_fields')
    .select('id, label')
    .eq('card_type_id', cardTypeId);
  return Object.fromEntries(((data || []) as Array<{ id: string; label: string }>).map((f) => [f.id, f.label]));
}

async function approvalLimit(): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', 'max_card_approval_naira')
    .maybeSingle();
  if (error) return null;
  const raw = (data as { value?: unknown } | null)?.value;
  if (raw === null || raw === undefined) return DEFAULT_APPROVAL_LIMIT;
  const text = String(raw).trim();
  const n = Number(text);
  return text !== '' && Number.isFinite(n) ? n : null;
}

async function getSubmission(admin: AdminContext, id: string) {
  if (!isUuid(id)) return fail('VALIDATION_ERROR', 'Invalid submission id.');

  const { data, error } = await supabaseAdmin
    .from('card_submissions')
    .select(DETAIL_FIELDS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('card-queue detail:', error.message);
    return fail('INTERNAL_ERROR', 'The submission could not be loaded.');
  }
  if (!data) return fail('RESOURCE_NOT_FOUND', 'Submission not found.');

  const row = data as Record<string, unknown> & {
    card_id: string | null;
    card_type_id: string | null;
    card_images: unknown;
    dispute_images: unknown;
    card_types: { country_code?: string | null } | null;
  };

  const [cardImages, disputeImages, country, typesForCard, fieldLabels, limit] = await Promise.all([
    signImagePaths(row.card_images),
    signImagePaths(row.dispute_images),
    countryFor(row.card_id, row.card_types?.country_code),
    cardTypesFor(row.card_id),
    fieldLabelsFor(row.card_type_id),
    approvalLimit(),
  ]);

  return ok({
    submission: {
      ...row,
      card_images: cardImages,
      dispute_images: disputeImages,
      country_name: country.name,
      currency_symbol: country.symbol,
      card_types_for_card: typesForCard,
      field_labels: fieldLabels,
    },
    approval_limit_naira: limit,
    can_review: admin.can('cards.review'),
  });
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin('cards.read');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (id) return getSubmission(admin, id.trim());
  return listSubmissions(admin, url);
}

function snapshot(row: DecisionRow) {
  return {
    status: row.status,
    card_type_id: row.card_type_id,
    amount_foreign: row.amount_foreign,
    payout_naira: row.payout_naira,
    coupon_code: row.coupon_code,
    coupon_bonus: row.coupon_bonus,
  };
}

function conflictMessage(decision: Decision, status: string): string {
  const state = STATUS_PHRASE[status] || status.replace(/_/g, ' ');
  if (decision === 'approve' && status === 'disputed') {
    return 'This submission is under dispute. Overturn the dispute to approve it.';
  }
  if (decision === 'approve') return `This submission is ${state}, so it can no longer be approved.`;
  if (decision === 'reject') return `Only pending submissions can be rejected. This one is ${state}.`;
  if (decision === 'overturn') return `Only disputed submissions can be overturned. This one is ${state}.`;
  return `Only disputed submissions can be upheld. This one is ${state}.`;
}

function approvalFailure(error: { message?: string; code?: string }): { code: ApiErrorCode; message: string } {
  const message = (error.message || '').trim();
  if (!error.code) {
    return {
      code: 'INTERNAL_ERROR',
      message: 'The approval could not be confirmed. Reload the submission and check its status before trying again.',
    };
  }
  if (error.code !== 'P0001') {
    return { code: 'INTERNAL_ERROR', message: 'The approval failed and was rolled back. No credit was made.' };
  }
  if (/status transition|cannot approve from status/i.test(message)) {
    return { code: 'STATE_CONFLICT', message: 'This submission changed while you were reviewing it. No credit was made.' };
  }
  if (/submission not found/i.test(message)) {
    return { code: 'RESOURCE_NOT_FOUND', message: 'Submission not found. No credit was made.' };
  }
  if (/wallet not found/i.test(message)) {
    return { code: 'INTERNAL_ERROR', message: 'The user has no wallet to credit. No credit was made.' };
  }
  if (/corrected amount|does not belong to this card|no active denomination|exceeds maximum/i.test(message)) {
    return { code: 'VALIDATION_ERROR', message: `${message.replace(/[.\s]+$/, '')}. No credit was made.` };
  }
  return { code: 'INTERNAL_ERROR', message: 'The approval was refused and rolled back. No credit was made.' };
}

interface ApprovalInput {
  cardTypeId: string | null;
  amount: number | null;
  note: string;
}

function readApprovalInput(body: Record<string, unknown>): ApprovalInput | { error: string } {
  const rawType = body.card_type_id;
  let cardTypeId: string | null = null;
  if (rawType !== undefined && rawType !== null && rawType !== '') {
    if (!isUuid(rawType)) return { error: 'Invalid card type.' };
    cardTypeId = rawType.toLowerCase();
  }

  const rawAmount = body.amount_foreign;
  let amount: number | null = null;
  if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
    const n = Number(rawAmount);
    if (!Number.isFinite(n) || n <= 0) return { error: 'Invalid corrected amount' };
    amount = n;
  }

  const note = readText(body.correction_note);
  if (note.length > TEXT_MAX) return { error: `The correction note must be ${TEXT_MAX} characters or fewer.` };
  return { cardTypeId, amount, note };
}

async function correctionLacksRate(cardTypeId: string | null, amount: number | null): Promise<boolean> {
  if (!cardTypeId || amount === null || amount <= 0) return false;
  const { data, error } = await supabaseAdmin
    .from('denominations')
    .select('id, rate_naira')
    .eq('card_type_id', cardTypeId)
    .eq('is_active', true)
    .lte('min_value', amount)
    .gte('max_value', amount)
    .order('min_value', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;
  return toNumber((data as { rate_naira?: unknown }).rate_naira) === null;
}

async function approveSubmission(admin: AdminContext, decision: 'approve' | 'overturn', before: DecisionRow, input: ApprovalInput) {
  const overrides: { card_type_id?: string; amount_foreign?: number } = {};
  if (input.cardTypeId && input.cardTypeId !== (before.card_type_id || '').toLowerCase()) {
    overrides.card_type_id = input.cardTypeId;
  }
  if (input.amount !== null && input.amount !== toNumber(before.amount_foreign)) {
    overrides.amount_foreign = input.amount;
  }

  const corrected = Boolean(overrides.card_type_id) || overrides.amount_foreign !== undefined;
  const unpriced = corrected
    ? await correctionLacksRate(overrides.card_type_id ?? before.card_type_id, overrides.amount_foreign ?? toNumber(before.amount_foreign))
    : toNumber(before.payout_naira) === null;
  if (unpriced) {
    return fail(
      'VALIDATION_ERROR',
      corrected
        ? 'The denomination that matches this correction has no rate set, so the payout cannot be calculated. No credit was made.'
        : 'This submission has no payout amount, so it cannot be credited as submitted. Correct the card type or amount instead.',
    );
  }

  const rpcArgs: Record<string, unknown> = { p_submission_id: before.id, p_admin_id: admin.admin_id };
  if (overrides.card_type_id) rpcArgs.p_card_type_id = overrides.card_type_id;
  if (overrides.amount_foreign !== undefined) rpcArgs.p_amount_foreign = overrides.amount_foreign;
  if (input.note) rpcArgs.p_correction_note = input.note;

  const auditBase = {
    admin,
    action: AUDIT_ACTION[decision],
    entity: 'card_submissions',
    entity_id: before.id,
    user_id: before.user_id,
    before: snapshot(before),
    reason: input.note || null,
    sensitivity: 'financial' as const,
  };

  const { data, error } = await supabaseAdmin.rpc('approve_card_submission', rpcArgs);
  if (error && !error.code) {
    const { data: current } = await supabaseAdmin
      .from('card_submissions')
      .select('status')
      .eq('id', before.id)
      .maybeSingle();
    if ((current as { status?: string } | null)?.status === 'approved') {
      const audit = await writeAudit({
        ...auditBase,
        after: { status: 'approved', credited: null, ...overrides },
        result: 'success',
        error: `Response lost (${error.message}); approval confirmed by re-reading the submission status.`,
      });
      return ok({
        result: null,
        status: 'approved',
        credited: null,
        audit_recorded: audit.ok,
        warning: 'The card was approved, but the server response was lost, so the credited amount could not be shown here. Check the user\'s wallet history.',
      });
    }
  }
  if (error) {
    await writeAudit({
      ...auditBase,
      after: { status: before.status, attempted: 'approved', ...overrides },
      result: 'failure',
      error: error.message,
    });
    console.error('approve_card_submission:', error.message);
    const failure = approvalFailure(error);
    return fail(failure.code, failure.message);
  }

  const result = (data && typeof data === 'object' ? data : {}) as {
    already_processed?: boolean;
    credited?: unknown;
    new_balance?: unknown;
  };

  if (result.already_processed) {
    await writeAudit({
      ...auditBase,
      after: { status: before.status, attempted: 'approved' },
      result: 'failure',
      error: 'Already decided by another admin; no credit was made.',
    });
    return fail('STATE_CONFLICT', 'Another admin decided this submission first. No credit was made.');
  }

  const credited = toNumber(result.credited);
  const audit = await writeAudit({
    ...auditBase,
    after: { status: 'approved', credited, new_balance: toNumber(result.new_balance), ...overrides },
    result: 'success',
  });

  return ok({
    result: data,
    status: 'approved',
    credited,
    audit_recorded: audit.ok,
    ...(audit.ok ? {} : { warning: 'The card was approved and credited, but the decision could not be written to the audit log.' }),
  });
}

async function cardLabelFor(row: DecisionRow): Promise<string> {
  const [cardResult, typeResult] = await Promise.all([
    row.card_id
      ? supabaseAdmin.from('cards').select('name').eq('id', row.card_id).maybeSingle()
      : Promise.resolve({ data: null }),
    row.card_type_id
      ? supabaseAdmin.from('card_types').select('name, country_code').eq('id', row.card_type_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const cardRow = cardResult.data as { name?: string | null } | null;
  const typeRow = typeResult.data as { name?: string | null; country_code?: string | null } | null;

  let symbol = '$';
  if (typeRow?.country_code && row.card_id) {
    const { data: country } = await supabaseAdmin
      .from('card_countries')
      .select('currency_symbol')
      .eq('card_id', row.card_id)
      .eq('country_code', typeRow.country_code)
      .maybeSingle();
    const currency = (country as { currency_symbol?: string | null } | null)?.currency_symbol;
    if (currency) symbol = currency;
  }

  const amount = Number(row.amount_foreign) || 0;
  const amountText = Number.isInteger(amount)
    ? amount.toLocaleString('en-US')
    : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${amountText} ${cardRow?.name || 'Gift card'}${typeRow?.name ? ` (${typeRow.name})` : ''}`;
}

async function failCreditEntry(row: DecisionRow, reason: string): Promise<string | null> {
  const { data: existing, error: findError } = await supabaseAdmin
    .from('transactions')
    .select('id')
    .eq('reference_id', row.id)
    .eq('type', 'giftcard_credit')
    .maybeSingle();
  if (findError) return findError.message;

  const metadata = { submission_id: row.id, rejection_reason: reason };
  if (existing) {
    const { error } = await supabaseAdmin
      .from('transactions')
      .update({ status: 'failed', metadata })
      .eq('id', (existing as { id: string }).id);
    return error ? error.message : null;
  }

  const { error } = await supabaseAdmin.from('transactions').insert({
    user_id: row.user_id,
    type: 'giftcard_credit',
    amount: row.payout_naira,
    status: 'failed',
    reference_id: row.id,
    idempotency_key: 'reject-card-' + row.id,
    metadata,
  });
  return error ? error.message : null;
}

async function rejectSubmission(admin: AdminContext, before: DecisionRow, reason: string) {
  const auditBase = {
    admin,
    action: AUDIT_ACTION.reject,
    entity: 'card_submissions',
    entity_id: before.id,
    user_id: before.user_id,
    before: snapshot(before),
    reason,
    sensitivity: 'financial' as const,
  };

  const { data: updated, error } = await supabaseAdmin
    .from('card_submissions')
    .update({ status: 'rejected', rejection_reason: reason })
    .eq('id', before.id)
    .eq('status', 'pending')
    .select('id');
  if (error) {
    await writeAudit({ ...auditBase, after: { status: before.status, attempted: 'rejected' }, result: 'failure', error: error.message });
    console.error('card-queue reject:', error.message);
    return fail('INTERNAL_ERROR', 'The submission could not be rejected.');
  }
  if (!updated || updated.length === 0) return fail('STATE_CONFLICT', 'Submission is no longer pending');

  const incomplete: string[] = [];
  const errors: string[] = [];

  const ledgerError = await failCreditEntry(before, reason);
  if (ledgerError) {
    incomplete.push('its pending credit entry could not be marked failed');
    errors.push(`ledger: ${ledgerError}`);
  }

  const cardLabel = await cardLabelFor(before);
  const { error: notifyError } = await supabaseAdmin.rpc('emit_notification', {
    p_user_id: before.user_id,
    p_template_key: 'card_rejected',
    p_type: 'card_rejected',
    p_vars: { card_label: cardLabel, reason },
  });
  if (notifyError) {
    incomplete.push('the user could not be notified');
    errors.push(`notification: ${notifyError.message}`);
  }

  const audit = await writeAudit({
    ...auditBase,
    after: { status: 'rejected', rejection_reason: reason },
    result: errors.length ? 'partial' : 'success',
    error: errors.length ? errors.join('; ') : null,
  });
  if (!audit.ok) incomplete.push('the decision could not be written to the audit log');

  return ok({
    status: 'rejected',
    audit_recorded: audit.ok,
    ...(incomplete.length ? { warning: `The card was rejected, but ${joinClauses(incomplete)}.` } : {}),
  });
}

async function upholdDispute(admin: AdminContext, before: DecisionRow, note: string) {
  const auditBase = {
    admin,
    action: AUDIT_ACTION.uphold,
    entity: 'card_submissions',
    entity_id: before.id,
    user_id: before.user_id,
    before: snapshot(before),
    reason: note || null,
    sensitivity: 'financial' as const,
  };

  const { data: updated, error } = await supabaseAdmin
    .from('card_submissions')
    .update({ status: 'dispute_resolved' })
    .eq('id', before.id)
    .eq('status', 'disputed')
    .select('id');
  if (error) {
    await writeAudit({ ...auditBase, after: { status: before.status, attempted: 'dispute_resolved' }, result: 'failure', error: error.message });
    console.error('card-queue uphold:', error.message);
    return fail('INTERNAL_ERROR', 'The dispute could not be closed.');
  }
  if (!updated || updated.length === 0) return fail('STATE_CONFLICT', 'Submission is no longer disputed');

  const incomplete: string[] = [];
  const errors: string[] = [];

  const { error: ledgerError } = await supabaseAdmin
    .from('transactions')
    .update({ status: 'failed' })
    .eq('reference_id', before.id)
    .eq('type', 'giftcard_credit');
  if (ledgerError) {
    incomplete.push('its pending credit entry could not be marked failed');
    errors.push(`ledger: ${ledgerError.message}`);
  }

  const { error: notifyError } = await supabaseAdmin.rpc('emit_notification', {
    p_user_id: before.user_id,
    p_template_key: 'dispute_closed',
    p_type: 'dispute_closed',
    p_vars: {},
  });
  if (notifyError) {
    incomplete.push('the user could not be notified');
    errors.push(`notification: ${notifyError.message}`);
  }

  const audit = await writeAudit({
    ...auditBase,
    after: { status: 'dispute_resolved' },
    result: errors.length ? 'partial' : 'success',
    error: errors.length ? errors.join('; ') : null,
  });
  if (!audit.ok) incomplete.push('the decision could not be written to the audit log');

  return ok({
    status: 'dispute_resolved',
    audit_recorded: audit.ok,
    ...(incomplete.length ? { warning: `The dispute was closed, but ${joinClauses(incomplete)}.` } : {}),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin('cards.review');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const parsed: unknown = await req.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('VALIDATION_ERROR', 'The request body must be a JSON object.');
  }
  const body = parsed as Record<string, unknown>;

  const action = readText(body.action);
  const submissionId = readText(body.submission_id);
  if (!action || !submissionId) return fail('VALIDATION_ERROR', 'Missing action or submission_id');
  if (!DECISIONS.has(action)) return fail('VALIDATION_ERROR', 'Invalid action');
  if (!isUuid(submissionId)) return fail('VALIDATION_ERROR', 'Invalid submission id.');
  const decision = action as Decision;

  let reason = '';
  let approval: ApprovalInput | null = null;
  if (decision === 'reject') {
    reason = readText(body.reason);
    if (!reason) return fail('VALIDATION_ERROR', 'Rejection reason required');
    if (reason.length > TEXT_MAX) return fail('VALIDATION_ERROR', `The rejection reason must be ${TEXT_MAX} characters or fewer.`);
  } else if (decision === 'uphold') {
    reason = readText(body.reason);
    if (reason.length > TEXT_MAX) return fail('VALIDATION_ERROR', `The note must be ${TEXT_MAX} characters or fewer.`);
  } else {
    const input = readApprovalInput(body);
    if ('error' in input) return fail('VALIDATION_ERROR', input.error);
    approval = input;
  }

  const { data, error: readError } = await supabaseAdmin
    .from('card_submissions')
    .select(DECISION_FIELDS)
    .eq('id', submissionId.toLowerCase())
    .maybeSingle();
  if (readError) {
    console.error('card-queue decision read:', readError.message);
    return fail('INTERNAL_ERROR', 'The submission could not be read.');
  }
  if (!data) return fail('RESOURCE_NOT_FOUND', 'Submission not found');
  const before = data as DecisionRow;

  if (before.status !== REQUIRED_STATUS[decision]) {
    return fail('STATE_CONFLICT', conflictMessage(decision, before.status), { details: { status: before.status } });
  }

  if (decision === 'reject') return rejectSubmission(admin, before, reason);
  if (decision === 'uphold') return upholdDispute(admin, before, reason);
  return approveSubmission(admin, decision, before, approval as ApprovalInput);
}
