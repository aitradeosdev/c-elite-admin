import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../../lib/guard';
import { writeAudit } from '../../../lib/audit';
import { ok, fail, isUuid, buildPagination } from '../../../lib/api';
import { clampPagination } from '../../../lib/sanitize';
import { redactAudit } from '../../../lib/redact';
import { maskMetadata } from '../../../lib/mask';

const USER_COLUMNS =
  'id, full_name, username, email, phone, country, is_active, is_frozen, freeze_reason, referral_code, referred_by, bonus_balance, last_active_at, avatar_path, created_at, deleted_at, wallets(balance)';

type SectionKey = 'transactions' | 'devices' | 'logins';

interface SectionSpec {
  table: string;
  columns: string;
  pageSize: number;
  sortKeys: readonly string[];
  unavailable: string;
}

const SECTIONS: Readonly<Record<SectionKey, SectionSpec>> = {
  transactions: {
    table: 'transactions',
    columns: 'id, type, amount, status, reference_id, created_at, metadata',
    pageSize: 10,
    sortKeys: ['created_at', 'amount'],
    unavailable: 'The transaction ledger could not be read.',
  },
  devices: {
    table: 'device_logs',
    columns: 'id, device_model, os_version, app_version, ip_address, created_at, last_seen_at, login_count',
    pageSize: 20,
    sortKeys: ['created_at', 'last_seen_at', 'login_count'],
    unavailable: 'Device records could not be read.',
  },
  logins: {
    table: 'login_history',
    columns: 'id, device_model, os_version, app_version, ip_address, created_at, ended_at',
    pageSize: 20,
    sortKeys: ['created_at'],
    unavailable: 'Sign-in records could not be read.',
  },
};

const MAX_SECTION_LIMIT = 100;
const RANGE_NOT_SATISFIABLE = 'PGRST103';
const AVATAR_TTL_SECONDS = 3600;
const REVIEW_STATES = ['pending_review', 'held'];
const REASON_MAX = 500;
const DELETION_FREEZE_REASON = 'Account deletion in progress';
const DELETION_UNCHECKED = 'Whether this account’s deletion finished could not be checked. Refresh to try again.';

type Row = Record<string, unknown>;

interface Sorting {
  key: string;
  ascending: boolean;
}

interface SectionResult {
  rows: Row[];
  total: number | null;
  error: string | null;
}

interface WalletEmbed {
  balance?: number | string | null;
}

interface UserRow {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  is_active: boolean | null;
  is_frozen: boolean | null;
  freeze_reason: string | null;
  referral_code: string | null;
  referred_by: string | null;
  bonus_balance: number | string | null;
  last_active_at: string | null;
  avatar_path: string | null;
  created_at: string;
  deleted_at: string | null;
  wallets?: WalletEmbed | WalletEmbed[] | null;
}

interface ReferrerRow {
  id: string;
  username: string | null;
  full_name: string | null;
}

interface FreezeState {
  is_frozen: boolean | null;
  freeze_reason: string | null;
  deleted_at: string | null;
}

const DEFAULT_SORTING: Sorting = { key: 'created_at', ascending: false };

function sectionOf(raw: string): SectionKey | null {
  return raw === 'transactions' || raw === 'devices' || raw === 'logins' ? raw : null;
}

function finiteCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function walletBalance(wallets: UserRow['wallets']): number {
  const wallet = Array.isArray(wallets) ? wallets[0] : wallets;
  const amount = Number(wallet?.balance ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function present(section: SectionKey, row: Row): Row {
  if (section !== 'transactions') return row;
  const { metadata } = row;
  return {
    ...row,
    metadata: metadata === null || metadata === undefined ? null : redactAudit(maskMetadata(metadata)),
  };
}

function readSorting(section: SectionKey, params: URLSearchParams): Sorting {
  const key = params.get('sort') || '';
  if (!SECTIONS[section].sortKeys.includes(key)) return DEFAULT_SORTING;
  return { key, ascending: params.get('dir') === 'asc' };
}

function describe(error: unknown): unknown {
  return error instanceof Error ? error.message : error;
}

async function countFor(table: string, userId: string, statuses?: string[]): Promise<number | null> {
  try {
    let query = supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (statuses) query = query.in('status', statuses);
    const { count, error } = await query;
    if (!error) return finiteCount(count);
    console.error(`user detail ${table} count:`, error.message);
  } catch (error) {
    console.error(`user detail ${table} count:`, describe(error));
  }
  return null;
}

async function loadSection(
  userId: string,
  section: SectionKey,
  page: number,
  limit: number,
  sorting: Sorting,
): Promise<SectionResult> {
  const spec = SECTIONS[section];
  const offset = (page - 1) * limit;
  try {
    const { data, error, count } = await supabaseAdmin
      .from(spec.table)
      .select(spec.columns, { count: 'exact' })
      .eq('user_id', userId)
      .order(sorting.key, { ascending: sorting.ascending, nullsFirst: false })
      .order('id', { ascending: sorting.ascending })
      .range(offset, offset + limit - 1);
    if (!error) {
      const rows = ((data ?? []) as unknown as Row[]).map((row) => present(section, row));
      return { rows, total: finiteCount(count), error: null };
    }
    if (error.code === RANGE_NOT_SATISFIABLE) {
      const total = await countFor(spec.table, userId);
      if (total !== null) return { rows: [], total, error: null };
    } else {
      console.error(`user detail ${section}:`, error.message);
    }
  } catch (error) {
    console.error(`user detail ${section}:`, describe(error));
  }
  return { rows: [], total: null, error: spec.unavailable };
}

async function loadReferrer(referrerId: string | null): Promise<{ referrer: ReferrerRow | null; error: string | null }> {
  if (!referrerId || !isUuid(referrerId)) return { referrer: null, error: null };
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, username, full_name')
      .eq('id', referrerId)
      .maybeSingle<ReferrerRow>();
    if (!error) return { referrer: data ?? null, error: null };
    console.error('user detail referrer:', error.message);
  } catch (error) {
    console.error('user detail referrer:', describe(error));
  }
  return { referrer: null, error: 'The referring account could not be read.' };
}

async function signAvatar(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabaseAdmin.storage.from('avatars').createSignedUrl(path, AVATAR_TTL_SECONDS);
    if (!error) return data?.signedUrl ?? null;
    console.error('user detail avatar signing:', error.message);
  } catch (error) {
    console.error('user detail avatar signing:', describe(error));
  }
  return null;
}

async function readDeletionUnfinished(id: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_deletion_unfinished', { p_uid: id });
    if (!error && typeof data === 'boolean') return data;
    console.error('user detail deletion state:', error ? error.message : 'no answer was returned');
  } catch (error) {
    console.error('user detail deletion state:', describe(error));
  }
  return null;
}

async function readProfile(id: string, admin: AdminContext) {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select(USER_COLUMNS)
    .eq('id', id)
    .maybeSingle<UserRow>();

  if (error) {
    console.error('user detail:', error.message);
    return fail('INTERNAL_ERROR', 'The user could not be loaded.');
  }
  if (!user) return fail('RESOURCE_NOT_FOUND', 'User not found.');

  const checkDeletion = Boolean(user.deleted_at) && admin.can('users.delete');
  const [transactions, devices, logins, withdrawals, awaitingReview, cardSubmissions, referred, avatarUrl, unfinished] =
    await Promise.all([
      loadSection(id, 'transactions', 1, SECTIONS.transactions.pageSize, DEFAULT_SORTING),
      loadSection(id, 'devices', 1, SECTIONS.devices.pageSize, DEFAULT_SORTING),
      loadSection(id, 'logins', 1, SECTIONS.logins.pageSize, DEFAULT_SORTING),
      countFor('withdrawals', id),
      countFor('withdrawals', id, REVIEW_STATES),
      countFor('card_submissions', id),
      loadReferrer(user.referred_by),
      signAvatar(user.avatar_path),
      checkDeletion ? readDeletionUnfinished(id) : Promise.resolve(null),
    ]);

  const uncounted = [
    transactions.total === null ? 'transactions' : null,
    withdrawals === null ? 'withdrawals' : null,
    awaitingReview === null ? 'withdrawals awaiting review' : null,
    cardSubmissions === null ? 'card submissions' : null,
  ].filter((label): label is string => label !== null);

  return ok({
    user: { ...user, balance: walletBalance(user.wallets), avatar_url: avatarUrl },
    referrer: referred.referrer,
    deletion_unfinished: unfinished,
    stats: {
      trades: transactions.total,
      withdrawals,
      withdrawals_pending: awaitingReview,
      card_submissions: cardSubmissions,
    },
    devices: devices.rows,
    logins: logins.rows,
    recentTransactions: transactions.rows,
    totals: {
      transactions: transactions.total,
      devices: devices.total,
      logins: logins.total,
    },
    page_size: {
      transactions: SECTIONS.transactions.pageSize,
      devices: SECTIONS.devices.pageSize,
      logins: SECTIONS.logins.pageSize,
    },
    partial: {
      devices: devices.error,
      logins: logins.error,
      recent_transactions: transactions.error,
      stats: uncounted.length ? `These totals could not be counted: ${uncounted.join(', ')}.` : null,
      referrer: referred.error,
      deletion: checkDeletion && unfinished === null ? DELETION_UNCHECKED : null,
    },
    can: {
      freeze: admin.can('users.freeze'),
      transactions: admin.can('transactions.read'),
    },
  });
}

async function readSection(id: string, section: SectionKey, params: URLSearchParams) {
  const spec = SECTIONS[section];
  const paging = clampPagination(params.get('page'), params.get('limit') || String(spec.pageSize), MAX_SECTION_LIMIT);
  const sorting = readSorting(section, params);
  const result = await loadSection(id, section, paging.page, paging.limit, sorting);
  if (result.error) return fail('INTERNAL_ERROR', result.error);
  return ok(
    {
      section,
      items: result.rows,
      total: result.total,
      page: paging.page,
      limit: paging.limit,
      sort: sorting.key,
      dir: sorting.ascending ? 'asc' : 'desc',
    },
    { pagination: buildPagination(paging.page, paging.limit, result.total) },
  );
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin('users.read');
  if (!guard.ok) return guard.response;

  const { id: rawId } = await params;
  if (!isUuid(rawId)) return fail('VALIDATION_ERROR', 'Invalid user id.');
  const id = rawId.toLowerCase();

  const query = new URL(req.url).searchParams;
  const rawSection = (query.get('section') || '').trim();
  if (rawSection) {
    const section = sectionOf(rawSection);
    if (!section) return fail('VALIDATION_ERROR', 'Unknown section.');
    return readSection(id, section, query);
  }

  return readProfile(id, guard.admin);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin('users.freeze');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const { id: rawId } = await params;
  if (!isUuid(rawId)) return fail('VALIDATION_ERROR', 'Invalid user id.');
  const id = rawId.toLowerCase();

  const body = (await req.json().catch(() => null)) as { action?: unknown; reason?: unknown } | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

  if (action !== 'freeze' && action !== 'unfreeze') {
    return fail('VALIDATION_ERROR', 'Unknown action.');
  }

  const freezing = action === 'freeze';
  if (freezing && !reason) return fail('VALIDATION_ERROR', 'A reason is required to freeze an account.');
  if (freezing && reason.toLowerCase() === DELETION_FREEZE_REASON.toLowerCase()) {
    return fail('VALIDATION_ERROR', 'That reason is reserved. Use a different reason.');
  }
  if (reason.length > REASON_MAX) {
    return fail('VALIDATION_ERROR', `The reason must be ${REASON_MAX} characters or fewer.`);
  }

  const { data: before, error: readErr } = await supabaseAdmin
    .from('users')
    .select('is_frozen, freeze_reason, deleted_at')
    .eq('id', id)
    .maybeSingle<FreezeState>();

  if (readErr) {
    console.error('freeze/unfreeze read:', readErr.message);
    return fail('INTERNAL_ERROR', 'The account could not be read.');
  }
  if (!before) return fail('RESOURCE_NOT_FOUND', 'User not found.');
  if (before.deleted_at) {
    return fail('STATE_CONFLICT', 'This account is being deleted, so admin actions are disabled.');
  }

  if (Boolean(before.is_frozen) === freezing) {
    return fail('STATE_CONFLICT', freezing ? 'This account is already frozen.' : 'This account is not frozen.');
  }

  const next = freezing
    ? { is_frozen: true, freeze_reason: reason }
    : { is_frozen: false, freeze_reason: null };

  const auditBase = {
    admin,
    action: freezing ? 'FREEZE_USER' : 'UNFREEZE_USER',
    entity: 'users',
    entity_id: id,
    user_id: id,
    before: { is_frozen: before.is_frozen, freeze_reason: before.freeze_reason },
    reason: reason || null,
    sensitivity: 'security' as const,
  };

  const guarded = supabaseAdmin
    .from('users')
    .update(next)
    .eq('id', id)
    .is('deleted_at', null);

  const { data: updated, error: updateErr } = await (before.is_frozen === null
    ? guarded.is('is_frozen', null)
    : guarded.eq('is_frozen', before.is_frozen)
  ).select('id');

  if (updateErr) {
    await writeAudit({ ...auditBase, after: next, result: 'failure', error: updateErr.message });
    console.error('freeze/unfreeze update:', updateErr.message);
    return fail('INTERNAL_ERROR', `The account could not be ${freezing ? 'frozen' : 'unfrozen'}.`);
  }

  if (!updated || updated.length === 0) {
    return fail('STATE_CONFLICT', 'The account changed while you were working on it. Reload and try again.');
  }

  const audit = await writeAudit({ ...auditBase, after: next, result: 'success' });

  return ok({
    is_frozen: freezing,
    audit_recorded: audit.ok,
    ...(audit.ok
      ? {}
      : { warning: `The account was ${freezing ? 'frozen' : 'unfrozen'} but could not be written to the audit log.` }),
  });
}
