import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit } from '../../lib/audit';
import { ok, fail, isUuid, buildPagination } from '../../lib/api';
import { sanitizeSearch, clampPagination, asUuid } from '../../lib/sanitize';
import { redactAudit } from '../../lib/redact';
import { maskMetadata } from '../../lib/mask';
import {
  businessDateKey, businessToday, formatBusinessDateTime, lagosDateToRangeEnd, lagosDateToRangeStart,
} from '../../lib/time';

const LIST_COLUMNS =
  'id, user_id, type, amount, status, reference_id, metadata, created_at, users(username, full_name, email)';
const DETAIL_COLUMNS =
  'id, user_id, type, amount, status, reference_id, metadata, created_at, users(id, username, full_name, email)';
const EXPORT_COLUMNS = 'id, type, amount, status, reference_id, created_at, users(username, email)';

const SORT_KEYS = new Set(['created_at', 'amount']);
const FILTER_TOKEN = /^[a-z0-9_]{1,40}$/;
const MAX_FILTER_TOKENS = 16;
const REFERENCE_FRAGMENT = /^[0-9a-f-]{8,}$/;

const MAX_PAGE_SIZE = 100;
const EXPORT_CAP = 50000;
const EXPORT_BATCH = 1000;
const SEARCH_USER_CAP = 100;
const RANGE_NOT_SATISFIABLE = 'PGRST103';

interface TransactionUser {
  id?: string | null;
  username?: string | null;
  full_name?: string | null;
  email?: string | null;
}

interface TransactionRow {
  id: string;
  user_id?: string | null;
  type: string | null;
  amount: number | string | null;
  status: string | null;
  reference_id: string | null;
  metadata?: unknown;
  created_at: string;
  users?: TransactionUser | TransactionUser[] | null;
}

interface Filters {
  types: string[];
  statuses: string[];
  fromIso: string | null;
  toIso: string | null;
  match: string | null;
  noMatch: boolean;
  through?: string;
}

interface Sorting {
  key: string;
  ascending: boolean;
}

interface LegacyStats {
  totalCount: number;
  totalAmount: number;
  todayCount: number;
  todayAmount: number;
}

interface TodaySummary {
  date: string;
  from: string;
  to: string;
  count: number | null;
  success_volume: number | null;
}

interface Summary {
  stats: LegacyStats | null;
  today: TodaySummary | null;
  partial: { stats: string | null; today: string | null };
}

type Collected =
  | { rows: TransactionRow[]; total: number; truncated: boolean }
  | { error: string };

type SummaryMode = 'none' | 'legacy' | 'full';

const NO_SUMMARY: Summary = { stats: null, today: null, partial: { stats: null, today: null } };
const STATS_UNAVAILABLE = 'Platform totals could not be loaded.';
const TODAY_UNAVAILABLE = 'Today’s figures could not be loaded.';

function parseTokens(raw: string): string[] | null {
  const tokens = Array.from(
    new Set(raw.split(',').map((token) => token.trim().toLowerCase()).filter(Boolean)),
  );
  if (tokens.length > MAX_FILTER_TOKENS || !tokens.every((token) => FILTER_TOKEN.test(token))) return null;
  return tokens;
}

function firstUser(users: TransactionRow['users']): TransactionUser | null {
  if (Array.isArray(users)) return users[0] ?? null;
  return users ?? null;
}

function present(row: TransactionRow) {
  return {
    ...row,
    users: firstUser(row.users),
    metadata: row.metadata === null || row.metadata === undefined ? null : redactAudit(maskMetadata(row.metadata)),
  };
}

function capabilities(admin: AdminContext) {
  return {
    export: admin.can('transactions.export'),
    users: admin.can('users.read'),
    withdrawals: admin.can('withdrawals.read'),
    cards: admin.can('cards.read'),
  };
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function scoped(columns: string, filters: Filters, count?: 'exact', head = false) {
  let query = supabaseAdmin.from('transactions').select(columns, { count, head });
  if (filters.types.length === 1) query = query.eq('type', filters.types[0]);
  else if (filters.types.length > 1) query = query.in('type', filters.types);
  if (filters.statuses.length === 1) query = query.eq('status', filters.statuses[0]);
  else if (filters.statuses.length > 1) query = query.in('status', filters.statuses);
  if (filters.fromIso) query = query.gte('created_at', filters.fromIso);
  if (filters.toIso) query = query.lt('created_at', filters.toIso);
  if (filters.through) query = query.lte('created_at', filters.through);
  if (filters.match) query = query.or(filters.match);
  return query;
}

async function buildSearch(term: string): Promise<{ match: string | null; capped: boolean } | null> {
  const exactId = asUuid(term);
  if (exactId) {
    return { match: `id.eq.${exactId},user_id.eq.${exactId},reference_id.eq.${exactId}`, capped: false };
  }

  const pattern = `%${term}%`;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .or(`full_name.ilike.${pattern},username.ilike.${pattern},email.ilike.${pattern}`)
    .limit(SEARCH_USER_CAP + 1);
  if (error) {
    console.error('transactions search:', error.message);
    return null;
  }

  const ids = ((data ?? []) as { id: string }[]).map((user) => user.id).filter((id) => isUuid(id));
  const clauses: string[] = [];
  if (ids.length) clauses.push(`user_id.in.(${ids.slice(0, SEARCH_USER_CAP).join(',')})`);
  const fragment = term.toLowerCase();
  if (REFERENCE_FRAGMENT.test(fragment)) clauses.push(`reference_id.ilike.${fragment}%`);
  return { match: clauses.length ? clauses.join(',') : null, capped: ids.length > SEARCH_USER_CAP };
}

async function loadSummary(mode: SummaryMode): Promise<Summary> {
  if (mode === 'none') return NO_SUMMARY;
  const day = businessToday();
  const withToday = mode === 'full';
  try {
    const [statsResult, todayResult] = await Promise.all([
      supabaseAdmin.rpc('admin_transactions_stats'),
      withToday
        ? supabaseAdmin.rpc('admin_dashboard_metrics', {
          p_from: day.from_iso,
          p_to: day.to_iso,
          p_online_from: day.from_iso,
          p_groups: ['transactions'],
        })
        : Promise.resolve(null),
    ]);

    let stats: LegacyStats | null = null;
    if (statsResult.error) {
      console.error('admin_transactions_stats failed:', statsResult.error.message);
    } else {
      const row = (Array.isArray(statsResult.data) ? statsResult.data[0] : statsResult.data) as
        | Record<string, unknown>
        | null
        | undefined;
      stats = {
        totalCount: Number(row?.total_count || 0),
        totalAmount: Number(row?.total_amount || 0),
        todayCount: Number(row?.today_count || 0),
        todayAmount: Number(row?.today_amount || 0),
      };
    }

    let today: TodaySummary | null = null;
    if (todayResult?.error) {
      console.error('admin_dashboard_metrics (transactions) failed:', todayResult.error.message);
    } else if (todayResult) {
      const metrics = (todayResult.data ?? {}) as Record<string, unknown>;
      today = {
        date: businessDateKey(day.from),
        from: day.from_iso,
        to: day.to_iso,
        count: finite(metrics.txInRange),
        success_volume: finite(metrics.txVolumeInRange),
      };
    }

    return {
      stats,
      today,
      partial: {
        stats: stats ? null : STATS_UNAVAILABLE,
        today: withToday && !today ? TODAY_UNAVAILABLE : null,
      },
    };
  } catch (error) {
    console.error('transactions summary:', error instanceof Error ? error.message : error);
    return {
      stats: null,
      today: null,
      partial: { stats: STATS_UNAVAILABLE, today: withToday ? TODAY_UNAVAILABLE : null },
    };
  }
}

function summaryMode(raw: string | null): SummaryMode {
  if (raw === '0') return 'none';
  if (raw === '1') return 'full';
  return 'legacy';
}

async function readDetail(rawId: string, admin: AdminContext) {
  if (!isUuid(rawId)) return fail('VALIDATION_ERROR', 'Invalid transaction id.');

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select(DETAIL_COLUMNS)
    .eq('id', rawId.toLowerCase())
    .maybeSingle();
  if (error) {
    console.error('transaction detail:', error.message);
    return fail('INTERNAL_ERROR', 'The transaction could not be loaded.');
  }
  if (!data) return fail('RESOURCE_NOT_FOUND', 'Transaction not found.');

  return ok({ transaction: present(data as unknown as TransactionRow), can: capabilities(admin) });
}

async function listTransactions(
  admin: AdminContext,
  filters: Filters,
  sorting: Sorting,
  paging: { page: number; limit: number; offset: number },
  searchCapped: boolean,
  mode: SummaryMode,
) {
  const { page, limit, offset } = paging;
  const summaryPromise = loadSummary(mode);

  let rows: TransactionRow[] = [];
  let total = 0;

  if (!filters.noMatch) {
    const { data, error, count } = await scoped(LIST_COLUMNS, filters, 'exact')
      .order(sorting.key, { ascending: sorting.ascending, nullsFirst: false })
      .order('id', { ascending: sorting.ascending })
      .range(offset, offset + limit - 1);

    if (error) {
      if (error.code !== RANGE_NOT_SATISFIABLE) {
        console.error('transactions list:', error.message);
        return fail('INTERNAL_ERROR', 'Transactions could not be loaded.');
      }
      const { count: matching, error: countError } = await scoped('id', filters, 'exact', true);
      if (countError) {
        console.error('transactions count:', countError.message);
        return fail('INTERNAL_ERROR', 'Transactions could not be loaded.');
      }
      total = matching ?? 0;
    } else {
      rows = (data ?? []) as unknown as TransactionRow[];
      total = count ?? 0;
    }
  }

  const summary = await summaryPromise;

  return ok(
    {
      transactions: rows.map(present),
      total,
      page,
      limit,
      stats: summary.stats,
      today: summary.today,
      summary: mode,
      sort: sorting.key,
      dir: sorting.ascending ? 'asc' : 'desc',
      search_capped: searchCapped,
      partial: summary.partial,
      can: capabilities(admin),
    },
    { pagination: buildPagination(page, limit, total) },
  );
}

function csvField(value: unknown): string {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}

async function collectExport(filters: Filters, sorting: Sorting): Promise<Collected> {
  if (filters.noMatch) return { rows: [], total: 0, truncated: false };

  const snapshot: Filters = { ...filters, through: new Date().toISOString() };
  const { count, error: countError } = await scoped('id', snapshot, 'exact', true);
  if (countError) return { error: countError.message };

  const total = count ?? 0;
  const target = Math.min(total, EXPORT_CAP);
  const seen = new Set<string>();
  const rows: TransactionRow[] = [];
  let offset = 0;

  while (offset < target) {
    const end = Math.min(offset + EXPORT_BATCH, target) - 1;
    const { data, error } = await scoped(EXPORT_COLUMNS, snapshot)
      .order(sorting.key, { ascending: sorting.ascending, nullsFirst: false })
      .order('id', { ascending: sorting.ascending })
      .range(offset, end);
    if (error) {
      if (error.code === RANGE_NOT_SATISFIABLE) break;
      return { error: error.message };
    }
    const batch = (data ?? []) as unknown as TransactionRow[];
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

async function exportTransactions(
  admin: AdminContext,
  format: 'csv' | 'pdf',
  filters: Filters,
  sorting: Sorting,
  echo: Record<string, string | null>,
) {
  const collected = await collectExport(filters, sorting);
  if ('error' in collected) {
    console.error('transactions export:', collected.error);
    await writeAudit({
      admin,
      action: format === 'csv' ? 'EXPORT_CSV' : 'EXPORT_PDF',
      entity: 'transactions',
      entity_id: null,
      after: { format, filters: echo },
      result: 'failure',
      error: collected.error,
      sensitivity: 'sensitive',
    });
    return fail('INTERNAL_ERROR', 'The export could not be built.');
  }

  const exportRows = collected.rows.map((row) => {
    const user = firstUser(row.users);
    return {
      ID: row.id,
      User: user?.username || '',
      Email: user?.email || '',
      Type: row.type || '',
      Amount: row.amount,
      Status: row.status || '',
      Reference: row.reference_id || '',
      Date: row.created_at,
      DateLagos: formatBusinessDateTime(row.created_at),
    };
  });

  const audit = await writeAudit({
    admin,
    action: format === 'csv' ? 'EXPORT_CSV' : 'EXPORT_PDF',
    entity: 'transactions',
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

  const header = 'ID,User,Email,Type,Amount,Status,Reference,Date,DateLagos\n';
  const body = exportRows
    .map((r) => [
      r.ID, r.User, r.Email, r.Type, r.Amount, r.Status, r.Reference, r.Date, r.DateLagos,
    ].map(csvField).join(','))
    .join('\n');

  return new Response(header + body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="transactions-${Date.now()}.csv"`,
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
  const id = (params.get('id') || '').trim();
  const format = params.get('pdf') === '1' ? 'pdf' : params.get('csv') === '1' ? 'csv' : null;

  const guard = await requireAdmin(!id && format ? 'transactions.export' : 'transactions.read');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  if (id) return readDetail(id, admin);

  const types = parseTokens(params.get('type') || '');
  if (!types) return fail('VALIDATION_ERROR', 'Unknown transaction type filter.');
  const statuses = parseTokens(params.get('status') || '');
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

  const search = sanitizeSearch(params.get('search') || '');
  const filters: Filters = { types, statuses, fromIso, toIso, match: null, noMatch: false };

  let searchCapped = false;
  if (search) {
    const built = await buildSearch(search);
    if (!built) return fail('INTERNAL_ERROR', 'The search could not be run.');
    filters.match = built.match;
    filters.noMatch = built.match === null;
    searchCapped = built.capped;
  }

  if (format) {
    return exportTransactions(admin, format, filters, sorting, {
      type: types.join(',') || null,
      status: statuses.join(',') || null,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      search: search || null,
      sort: sorting.key,
      dir: sorting.ascending ? 'asc' : 'desc',
    });
  }

  const paging = clampPagination(params.get('page'), params.get('limit'), MAX_PAGE_SIZE);
  return listTransactions(admin, filters, sorting, paging, searchCapped, summaryMode(params.get('summary')));
}
