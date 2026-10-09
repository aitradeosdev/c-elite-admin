import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit } from '../../lib/audit';
import { ok, fail, isUuid, buildPagination } from '../../lib/api';
import { sanitizeSearch, clampPagination } from '../../lib/sanitize';
import {
  businessDateKey, businessToday, formatBusinessDateTime, lagosDateToRangeEnd, lagosDateToRangeStart,
} from '../../lib/time';

const LIST_COLUMNS =
  'id, full_name, username, email, phone, country, is_active, is_frozen, freeze_reason, created_at, deleted_at, avatar_path, wallets(balance)';
const EXPORT_COLUMNS =
  'id, full_name, username, email, phone, is_active, is_frozen, created_at, deleted_at, wallets(balance)';

const STATUS_FILTERS = ['active', 'frozen', 'inactive', 'deleted'] as const;
const SEARCH_COLUMNS = ['full_name', 'username', 'email', 'phone'] as const;

const MAX_PAGE_SIZE = 100;
const EXPORT_CAP = 50000;
const EXPORT_BATCH = 1000;
const COUNT_PARALLEL = 50;
const DIRECT_COUNT_LIMIT = 250;
const MAX_COUNT_PAGES = 500;
const AVATAR_TTL_SECONDS = 3600;
const RANGE_NOT_SATISFIABLE = 'PGRST103';

type StatusFilter = (typeof STATUS_FILTERS)[number];
type SortKey = 'created_at' | 'balance';
type ExportFormat = 'csv' | 'pdf';

interface WalletEmbed {
  balance?: number | string | null;
}

interface UserRow {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
  country?: string | null;
  is_active: boolean | null;
  is_frozen: boolean | null;
  freeze_reason?: string | null;
  created_at: string;
  deleted_at: string | null;
  avatar_path?: string | null;
  wallets?: WalletEmbed | WalletEmbed[] | null;
}

interface Filters {
  match: string | null;
  status: StatusFilter | null;
  fromIso: string | null;
  toIso: string | null;
  through?: string;
}

interface Sorting {
  key: SortKey;
  ascending: boolean;
}

interface Paging {
  page: number;
  limit: number;
  offset: number;
}

interface Summary {
  date: string;
  total_users: number | null;
  new_today: number | null;
  frozen: number | null;
}

interface SummaryResult {
  summary: Summary | null;
  error: string | null;
}

interface TradeCounts {
  counts: Map<string, number>;
  failed: boolean;
}

interface CountRow {
  user_id: string | null;
  count: number | string | null;
}

type Fetched = { rows: UserRow[]; total: number } | { error: string };

type Collected = { rows: UserRow[]; total: number; truncated: boolean } | { error: string };

const DEFAULT_SORT: Sorting = { key: 'created_at', ascending: false };

function isStatusFilter(value: string): value is StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(value);
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function walletBalance(wallets: UserRow['wallets']): number {
  const wallet = Array.isArray(wallets) ? wallets[0] : wallets;
  const amount = Number(wallet?.balance ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function statusOf(user: Pick<UserRow, 'deleted_at' | 'is_frozen' | 'is_active'>): string {
  if (user.deleted_at) return 'Deleted';
  if (user.is_frozen) return 'Frozen';
  return user.is_active ? 'Active' : 'Inactive';
}

function searchClause(term: string): string | null {
  if (!term) return null;
  if (isUuid(term)) return `id.eq.${term.toLowerCase()}`;
  const pattern = `%${term}%`;
  return SEARCH_COLUMNS.map((column) => `${column}.ilike.${pattern}`).join(',');
}

function scoped(columns: string, filters: Filters, count?: 'exact', head = false) {
  let query = supabaseAdmin.from('users').select(columns, { count, head });
  if (filters.match) query = query.or(filters.match);
  if (filters.fromIso) query = query.gte('created_at', filters.fromIso);
  if (filters.toIso) query = query.lt('created_at', filters.toIso);
  if (filters.through) query = query.lte('created_at', filters.through);
  switch (filters.status) {
    case 'deleted':
      return query.not('deleted_at', 'is', null);
    case 'frozen':
      return query.is('deleted_at', null).eq('is_frozen', true);
    case 'active':
      return query.is('deleted_at', null).not('is_frozen', 'is', true).eq('is_active', true);
    case 'inactive':
      return query.is('deleted_at', null).not('is_frozen', 'is', true).not('is_active', 'is', true);
    default:
      return query;
  }
}

type UsersQuery = ReturnType<typeof scoped>;

function sortedBy(query: UsersQuery, sorting: Sorting): UsersQuery {
  if (sorting.key === 'balance') {
    return query
      .order('wallets(balance)', { ascending: sorting.ascending, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false });
  }
  return query
    .order('created_at', { ascending: sorting.ascending, nullsFirst: false })
    .order('id', { ascending: sorting.ascending });
}

async function fetchPage(filters: Filters, sorting: Sorting, paging: Paging): Promise<Fetched> {
  const { data, error, count } = await sortedBy(scoped(LIST_COLUMNS, filters, 'exact'), sorting)
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (!error) return { rows: (data ?? []) as unknown as UserRow[], total: count ?? 0 };
  if (error.code !== RANGE_NOT_SATISFIABLE) return { error: error.message };
  const { count: matching, error: countError } = await scoped('id', filters, 'exact', true);
  if (countError) return { error: countError.message };
  return { rows: [], total: matching ?? 0 };
}

async function tradeCounts(ids: readonly string[]): Promise<TradeCounts> {
  const counts = new Map<string, number>();
  let failed = false;
  for (let start = 0; start < ids.length; start += COUNT_PARALLEL) {
    const slice = ids.slice(start, start + COUNT_PARALLEL);
    const results = await Promise.all(
      slice.map((id) =>
        supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', id),
      ),
    );
    results.forEach((result, index) => {
      if (result.error || typeof result.count !== 'number') {
        failed = true;
        return;
      }
      counts.set(slice[index], result.count);
    });
  }
  if (failed) console.error('users list: some trade counts could not be loaded');
  return { counts, failed };
}

async function exportTradeCounts(ids: readonly string[]): Promise<Map<string, number> | null> {
  if (ids.length <= DIRECT_COUNT_LIMIT) {
    const { counts, failed } = await tradeCounts(ids);
    return failed ? null : counts;
  }
  const wanted = new Set(ids);
  const counts = new Map<string, number>();
  let offset = 0;
  for (let round = 0; round < MAX_COUNT_PAGES; round += 1) {
    const { data, error } = await supabaseAdmin
      .rpc('count_user_transactions')
      .order('user_id')
      .range(offset, offset + EXPORT_BATCH - 1);
    if (error) {
      console.error('count_user_transactions:', error.message);
      return null;
    }
    const batch = (data ?? []) as CountRow[];
    if (batch.length === 0) return counts;
    for (const row of batch) {
      if (row.user_id && wanted.has(row.user_id)) counts.set(row.user_id, Number(row.count) || 0);
    }
    offset += batch.length;
  }
  console.error('count_user_transactions: page limit reached');
  return null;
}

async function signAvatars(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  try {
    const { data, error } = await supabaseAdmin.storage.from('avatars').createSignedUrls(paths, AVATAR_TTL_SECONDS);
    if (error) {
      console.error('avatar signing:', error.message);
      return urls;
    }
    for (const entry of data ?? []) {
      if (entry?.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
    }
  } catch (error) {
    console.error('avatar signing:', error instanceof Error ? error.message : error);
  }
  return urls;
}

async function loadSummary(): Promise<SummaryResult> {
  const day = businessToday();
  const unavailable = 'User totals could not be loaded.';
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_dashboard_metrics', {
      p_from: day.from_iso,
      p_to: day.to_iso,
      p_online_from: day.from_iso,
      p_groups: ['users'],
    });
    if (error) {
      console.error('admin_dashboard_metrics (users) failed:', error.message);
      return { summary: null, error: unavailable };
    }
    const metrics = (data ?? {}) as Record<string, unknown>;
    return {
      summary: {
        date: businessDateKey(day.from),
        total_users: finite(metrics.totalUsers),
        new_today: finite(metrics.newUsersInRange),
        frozen: finite(metrics.frozenUsers),
      },
      error: null,
    };
  } catch (error) {
    console.error('users summary:', error instanceof Error ? error.message : error);
    return { summary: null, error: unavailable };
  }
}

async function listUsers(
  admin: AdminContext,
  filters: Filters,
  sorting: Sorting,
  paging: Paging,
  includeSummary: boolean,
) {
  const summaryPromise: Promise<SummaryResult | null> = includeSummary ? loadSummary() : Promise.resolve(null);

  let effective = sorting;
  let fetched = await fetchPage(filters, sorting, paging);
  if ('error' in fetched && sorting.key === 'balance') {
    console.error('users list sorted by balance:', fetched.error);
    effective = DEFAULT_SORT;
    fetched = await fetchPage(filters, effective, paging);
  }
  if ('error' in fetched) {
    console.error('users list:', fetched.error);
    return fail('INTERNAL_ERROR', 'Users could not be loaded.');
  }

  const { rows, total } = fetched;
  const avatarPaths = rows.map((row) => row.avatar_path).filter((path): path is string => Boolean(path));
  const [trades, avatars, summary] = await Promise.all([
    tradeCounts(rows.map((row) => row.id)),
    signAvatars(avatarPaths),
    summaryPromise,
  ]);

  const users = rows.map((row) => ({
    ...row,
    balance: walletBalance(row.wallets),
    trades: trades.counts.get(row.id) ?? null,
    avatar_url: row.avatar_path ? avatars.get(row.avatar_path) ?? null : null,
  }));

  return ok(
    {
      users,
      total,
      page: paging.page,
      limit: paging.limit,
      sort: effective.key,
      dir: effective.ascending ? 'asc' : 'desc',
      sort_fallback: effective !== sorting,
      summary: summary?.summary ?? null,
      partial: {
        trades: trades.failed ? 'Trade counts could not be loaded for some users.' : null,
        summary: summary?.error ?? null,
      },
      can: { export: admin.can('users.export') },
    },
    { pagination: buildPagination(paging.page, paging.limit, total) },
  );
}

async function collectExport(filters: Filters, sorting: Sorting): Promise<Collected> {
  const snapshot: Filters = { ...filters, through: new Date().toISOString() };
  const { count, error: countError } = await scoped('id', snapshot, 'exact', true);
  if (countError) return { error: countError.message };

  const total = count ?? 0;
  const target = Math.min(total, EXPORT_CAP);
  const seen = new Set<string>();
  const rows: UserRow[] = [];
  let offset = 0;

  while (offset < target) {
    const end = Math.min(offset + EXPORT_BATCH, target) - 1;
    const { data, error } = await sortedBy(scoped(EXPORT_COLUMNS, snapshot), sorting).range(offset, end);
    if (error) {
      if (error.code === RANGE_NOT_SATISFIABLE) break;
      return { error: error.message };
    }
    const batch = (data ?? []) as unknown as UserRow[];
    if (batch.length === 0) break;
    for (const row of batch) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    offset += batch.length;
  }

  return { rows, total, truncated: rows.length < total };
}

function csvField(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}

async function exportUsers(
  admin: AdminContext,
  format: ExportFormat,
  filters: Filters,
  sorting: Sorting,
  echo: Record<string, string | null>,
) {
  let effective = sorting;
  let collected = await collectExport(filters, sorting);
  if ('error' in collected && sorting.key === 'balance') {
    console.error('users export sorted by balance:', collected.error);
    effective = DEFAULT_SORT;
    collected = await collectExport(filters, effective);
  }
  if ('error' in collected) {
    console.error('users export:', collected.error);
    return fail('INTERNAL_ERROR', 'The export could not be built.');
  }

  const counts = await exportTradeCounts(collected.rows.map((row) => row.id));
  if (!counts) {
    return fail('INTERNAL_ERROR', 'Trade counts could not be loaded, so the export was not built. Try again shortly.');
  }

  const exportRows = collected.rows.map((row) => ({
    id: row.id,
    full_name: row.full_name || '',
    username: row.username || '',
    email: row.email || '',
    phone: row.phone || '',
    balance: walletBalance(row.wallets),
    trades: counts.get(row.id) ?? 0,
    joined: row.created_at,
    joined_lagos: formatBusinessDateTime(row.created_at),
    status: statusOf(row),
  }));

  const audit = await writeAudit({
    admin,
    action: format === 'csv' ? 'EXPORT_CSV' : 'EXPORT_PDF',
    entity: 'users',
    entity_id: null,
    after: {
      format,
      rows: exportRows.length,
      total: collected.total,
      truncated: collected.truncated,
      cap: EXPORT_CAP,
      filters: { ...echo, sort: effective.key, dir: effective.ascending ? 'asc' : 'desc' },
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

  const header = 'ID,Name,Username,Email,Phone,Balance,Trades,Joined,Status,JoinedLagos\n';
  const body = exportRows
    .map((r) => [
      r.id, r.full_name, r.username, r.email, r.phone, r.balance, r.trades, r.joined, r.status, r.joined_lagos,
    ].map(csvField).join(','))
    .join('\n');

  return new Response(header + body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="users-${Date.now()}.csv"`,
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
  const format: ExportFormat | null = params.get('pdf') === '1' ? 'pdf' : params.get('csv') === '1' ? 'csv' : null;

  const guard = await requireAdmin(format ? 'users.export' : 'users.read');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const rawStatus = (params.get('status') || '').trim().toLowerCase();
  const status = isStatusFilter(rawStatus) ? rawStatus : null;
  if (rawStatus && !status) return fail('VALIDATION_ERROR', 'Unknown status filter.');

  const dateFrom = (params.get('date_from') || '').trim();
  const dateTo = (params.get('date_to') || '').trim();
  const fromIso = dateFrom ? lagosDateToRangeStart(dateFrom) : null;
  const toIso = dateTo ? lagosDateToRangeEnd(dateTo) : null;
  if ((dateFrom && !fromIso) || (dateTo && !toIso)) {
    return fail('VALIDATION_ERROR', 'Dates must be calendar days in YYYY-MM-DD format.');
  }

  const sorting: Sorting = {
    key: params.get('sort') === 'balance' ? 'balance' : 'created_at',
    ascending: params.get('dir') === 'asc',
  };

  const search = sanitizeSearch(params.get('search') || '');
  const filters: Filters = { match: searchClause(search), status, fromIso, toIso };

  try {
    if (format) {
      return await exportUsers(admin, format, filters, sorting, {
        search: search || null,
        status,
        date_from: dateFrom || null,
        date_to: dateTo || null,
      });
    }
    const paging = clampPagination(params.get('page'), params.get('limit'), MAX_PAGE_SIZE);
    return await listUsers(admin, filters, sorting, paging, params.get('summary') === '1');
  } catch (error) {
    console.error('users route:', error instanceof Error ? error.message : error);
    return fail('INTERNAL_ERROR', format ? 'The export could not be built.' : 'Users could not be loaded.');
  }
}
