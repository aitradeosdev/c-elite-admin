import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { requireAdminAll, type AdminContext } from '../../../../lib/guard';
import { writeAudit } from '../../../../lib/audit';
import { fail, isUuid, ok } from '../../../../lib/api';
import { businessDayStart } from '../../../../lib/time';
import { koboNaira, toKobo } from '../../../../lib/naira';
import {
  ADJUSTMENTS_TABLE, CAP_KEY, DAILY_CAP_KEY, DEFAULT_CAP_NAIRA, DEFAULT_DAILY_CAP_NAIRA, EMERGENCY_KEY, HISTORY_LIMIT,
  OUTCOME_UNKNOWN, REVIEW_STATUSES, TEMPLATE_KEYS, checkAdjustRequest, readCap, readRpcResult, refusalFailure,
  rpcErrorFailure, sameEmail,
  type AdjustRequest, type Refusal, type RouteFailure,
} from '../../../../(dashboard)/users/[id]/walletAdjust';

const PAGE_ROWS = 1000;
const MAX_PAGES = 20;
const HISTORY_COLUMNS =
  'id, direction, amount, balance_before, balance_after, reason, user_note, reference, admin_id, account_frozen, notified, transaction_id, created_at';

const PARTIAL_TEXT = {
  config: 'Emergency mode and the adjustment limits could not be checked.',
  usedToday: 'Your adjustments today could not be totalled.',
  pending: 'Withdrawals waiting for review could not be counted.',
  self: 'Whether this is your own account could not be checked.',
  notifications: 'The notification templates could not be read.',
  history: 'Recent adjustments could not be loaded.',
} as const;

interface UserRow {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  is_frozen: boolean | null;
  freeze_reason: string | null;
  deleted_at: string | null;
}

interface ConfigRow {
  key: string;
  value: string | null;
}

interface TemplateRow {
  key: string;
  title: string | null;
  body: string | null;
  is_active: boolean | null;
}

interface AdjustmentRow {
  id: string;
  direction: string | null;
  amount: number | string | null;
  balance_before: number | string | null;
  balance_after: number | string | null;
  reason: string | null;
  user_note: string | null;
  reference: string | null;
  admin_id: string | null;
  account_frozen: boolean | null;
  notified: boolean | null;
  transaction_id: string | null;
  created_at: string;
}

interface Limits {
  per_adjustment: number;
  daily: number;
}

interface ConfigRead {
  emergency: boolean | null;
  limits: Limits | null;
}

interface TemplateState {
  active: boolean;
  title: string | null;
  body: string | null;
}

type UserRead = { ok: true; row: UserRow | null } | { ok: false };
type WalletRead = { ok: true; balance: number | null } | { ok: false };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readUser(userId: string): Promise<UserRead> {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, username, email, is_frozen, freeze_reason, deleted_at')
      .eq('id', userId)
      .maybeSingle<UserRow>();
    if (!error) return { ok: true, row: data ?? null };
    console.error('wallet adjustments user:', error.message);
  } catch (error) {
    console.error('wallet adjustments user:', describe(error));
  }
  return { ok: false };
}

async function readWallet(userId: string): Promise<WalletRead> {
  try {
    const { data, error } = await supabaseAdmin
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle<{ balance: number | string | null }>();
    if (!error) {
      const kobo = toKobo(data?.balance ?? null);
      return { ok: true, balance: kobo === null ? null : koboNaira(kobo) };
    }
    console.error('wallet adjustments wallet:', error.message);
  } catch (error) {
    console.error('wallet adjustments wallet:', describe(error));
  }
  return { ok: false };
}

async function readConfig(): Promise<ConfigRead> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('key, value')
      .in('key', [EMERGENCY_KEY, CAP_KEY, DAILY_CAP_KEY]);
    if (!error) {
      const values = new Map<string, string | null>();
      for (const row of (data ?? []) as ConfigRow[]) values.set(row.key, typeof row.value === 'string' ? row.value : null);
      return {
        emergency: values.get(EMERGENCY_KEY) === 'true',
        limits: {
          per_adjustment: readCap(values.get(CAP_KEY), DEFAULT_CAP_NAIRA),
          daily: readCap(values.get(DAILY_CAP_KEY), DEFAULT_DAILY_CAP_NAIRA),
        },
      };
    }
    console.error('wallet adjustments config:', error.message);
  } catch (error) {
    console.error('wallet adjustments config:', describe(error));
  }
  return { emergency: null, limits: null };
}

async function readUsedToday(adminId: string): Promise<number | null> {
  const since = businessDayStart().toISOString();
  let totalKobo = 0;
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_ROWS;
      const { data, error } = await supabaseAdmin
        .from(ADJUSTMENTS_TABLE)
        .select('id, amount')
        .eq('admin_id', adminId)
        .gte('created_at', since)
        .order('id', { ascending: true })
        .range(from, from + PAGE_ROWS - 1);
      if (error) {
        console.error('wallet adjustments today:', error.message);
        return null;
      }
      const rows = (data ?? []) as Array<{ amount: number | string | null }>;
      for (const row of rows) {
        const kobo = toKobo(row.amount);
        if (kobo === null) return null;
        totalKobo += kobo;
      }
      if (rows.length < PAGE_ROWS) return koboNaira(totalKobo);
    }
    console.error(`wallet adjustments today: more than ${MAX_PAGES * PAGE_ROWS} rows`);
  } catch (error) {
    console.error('wallet adjustments today:', describe(error));
  }
  return null;
}

async function countPending(userId: string): Promise<number | null> {
  try {
    const { count, error } = await supabaseAdmin
      .from('withdrawals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', [...REVIEW_STATUSES]);
    if (!error) return typeof count === 'number' && Number.isFinite(count) ? count : null;
    console.error('wallet adjustments pending withdrawals:', error.message);
  } catch (error) {
    console.error('wallet adjustments pending withdrawals:', describe(error));
  }
  return null;
}

async function readSelf(adminId: string, userEmail: string | null): Promise<boolean | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('admin_users')
      .select('email')
      .eq('id', adminId)
      .maybeSingle<{ email: string | null }>();
    if (!error) return sameEmail(data?.email ?? null, userEmail);
    console.error('wallet adjustments own account:', error.message);
  } catch (error) {
    console.error('wallet adjustments own account:', describe(error));
  }
  return null;
}

function templateState(rows: readonly TemplateRow[], key: string): TemplateState {
  const row = rows.find((candidate) => candidate.key === key);
  if (!row) return { active: false, title: null, body: null };
  return { active: row.is_active === true, title: row.title ?? null, body: row.body ?? null };
}

async function readTemplates(): Promise<{ credit: TemplateState; debit: TemplateState } | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('notification_templates')
      .select('key, title, body, is_active')
      .in('key', [TEMPLATE_KEYS.credit, TEMPLATE_KEYS.debit]);
    if (!error) {
      const rows = (data ?? []) as TemplateRow[];
      return { credit: templateState(rows, TEMPLATE_KEYS.credit), debit: templateState(rows, TEMPLATE_KEYS.debit) };
    }
    console.error('wallet adjustments templates:', error.message);
  } catch (error) {
    console.error('wallet adjustments templates:', describe(error));
  }
  return null;
}

async function adminNames(ids: readonly string[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  if (ids.length === 0) return names;
  try {
    const { data, error } = await supabaseAdmin.from('admin_users').select('id, username').in('id', [...ids]);
    if (error) {
      console.error('wallet adjustments admin names:', error.message);
      return names;
    }
    for (const row of (data ?? []) as Array<{ id: string; username: string | null }>) names.set(row.id, row.username ?? null);
  } catch (error) {
    console.error('wallet adjustments admin names:', describe(error));
  }
  return names;
}

async function readHistory(userId: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from(ADJUSTMENTS_TABLE)
      .select(HISTORY_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) {
      console.error('wallet adjustments history:', error.message);
      return null;
    }
    const rows = (data ?? []) as unknown as AdjustmentRow[];
    const ids = [...new Set(rows.map((row) => row.admin_id).filter((id): id is string => typeof id === 'string'))];
    const names = await adminNames(ids);
    return rows.map((row) => ({ ...row, admin_username: row.admin_id ? names.get(row.admin_id) ?? null : null }));
  } catch (error) {
    console.error('wallet adjustments history:', describe(error));
    return null;
  }
}

function respond(failure: RouteFailure) {
  return fail(failure.code, failure.message, failure.details ? { details: failure.details } : undefined);
}

function isUnknown(failure: RouteFailure): boolean {
  return failure.details?.outcome_unknown === true;
}

function refusalExtras(refusal: Refusal | null): Record<string, number> {
  if (!refusal) return {};
  const extras: Record<string, number> = {};
  if (refusal.balance !== null) extras.balance = refusal.balance;
  if (refusal.limit !== null) extras.limit = refusal.limit;
  if (refusal.used_today !== null) extras.used_today = refusal.used_today;
  return extras;
}

async function recordFailure(admin: AdminContext, userId: string, request: AdjustRequest, error: string, refusal: Refusal | null) {
  await writeAudit({
    admin,
    action: request.direction === 'credit' ? 'CREDIT_WALLET' : 'DEBIT_WALLET',
    entity: 'wallet_adjustments',
    entity_id: null,
    user_id: userId,
    after: {
      direction: request.direction,
      amount: request.amount,
      user_note: request.user_note,
      reference: request.reference,
      expected_balance: request.expected_balance,
      idempotency_key: request.idempotency_key,
      ...refusalExtras(refusal),
    },
    reason: request.reason,
    result: 'failure',
    error,
    sensitivity: 'financial',
  });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminAll(['users.read', 'wallets.adjust']);
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const { id: rawId } = await ctx.params;
  if (!isUuid(rawId)) return fail('VALIDATION_ERROR', 'Invalid user id.');
  const userId = rawId.toLowerCase();

  const user = await readUser(userId);
  if (!user.ok) return fail('INTERNAL_ERROR', 'The account could not be loaded. Try again.');
  if (!user.row) return fail('RESOURCE_NOT_FOUND', 'User not found.');
  const row = user.row;

  const [wallet, config, usedToday, pending, self, notifications, history] = await Promise.all([
    readWallet(userId),
    readConfig(),
    readUsedToday(admin.admin_id),
    countPending(userId),
    readSelf(admin.admin_id, row.email),
    readTemplates(),
    readHistory(userId),
  ]);
  if (!wallet.ok) return fail('INTERNAL_ERROR', 'The wallet could not be loaded. Try again.');

  return ok({
    user: {
      id: row.id,
      full_name: row.full_name,
      username: row.username,
      is_frozen: row.is_frozen === true,
      freeze_reason: row.freeze_reason,
      deleted_at: row.deleted_at,
    },
    wallet: wallet.balance === null ? null : { balance: wallet.balance },
    emergency_mode: config.emergency,
    limits: config.limits,
    used_today: usedToday,
    withdrawals_pending: pending,
    self_adjustment: self,
    notifications,
    adjustments: history,
    partial: {
      config: config.limits === null ? PARTIAL_TEXT.config : null,
      used_today: usedToday === null ? PARTIAL_TEXT.usedToday : null,
      withdrawals_pending: pending === null ? PARTIAL_TEXT.pending : null,
      self_adjustment: self === null ? PARTIAL_TEXT.self : null,
      notifications: notifications === null ? PARTIAL_TEXT.notifications : null,
      adjustments: history === null ? PARTIAL_TEXT.history : null,
    },
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminAll(['users.read', 'wallets.adjust']);
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const { id: rawId } = await ctx.params;
  if (!isUuid(rawId)) return fail('VALIDATION_ERROR', 'Invalid user id.');
  const userId = rawId.toLowerCase();

  const checked = checkAdjustRequest(await req.json().catch(() => null));
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message, { details: { field: checked.field } });
  const request = checked.value;

  let data: unknown = null;
  let rpcError: { message?: unknown; code?: unknown } | null = null;
  try {
    const result = await supabaseAdmin.rpc('admin_adjust_wallet', {
      p_admin_id: admin.admin_id,
      p_user_id: userId,
      p_direction: request.direction,
      p_amount: request.amount,
      p_reason: request.reason,
      p_user_note: request.user_note,
      p_reference: request.reference,
      p_idempotency_key: request.idempotency_key,
      p_expected_balance: request.expected_balance,
      p_request_id: admin.request_id,
      p_ip: admin.ip,
      p_user_agent: admin.user_agent || null,
    });
    data = result.data;
    rpcError = result.error;
  } catch (error) {
    rpcError = { message: describe(error), code: '' };
  }

  if (rpcError) {
    const failure = rpcErrorFailure(rpcError);
    const message = typeof rpcError.message === 'string' && rpcError.message !== '' ? rpcError.message : 'Unknown database error';
    console.error('admin_adjust_wallet:', message);
    await recordFailure(admin, userId, request, isUnknown(failure) ? `${message} (the outcome is unknown)` : message, null);
    return respond(failure);
  }

  const outcome = readRpcResult(data);
  if (outcome.kind === 'applied') return ok({ adjustment: outcome.adjustment, replayed: outcome.replayed });
  if (outcome.kind === 'unreadable') {
    console.error('admin_adjust_wallet: the result did not have the expected shape.');
    await recordFailure(admin, userId, request, 'The result could not be read (the outcome is unknown)', null);
    return respond(OUTCOME_UNKNOWN);
  }
  await recordFailure(admin, userId, request, outcome.refusal.reason, outcome.refusal);
  return respond(refusalFailure(outcome.refusal, request));
}
