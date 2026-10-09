import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireSuperAdmin } from '../../lib/guard';
import { buildPagination, fail, ok } from '../../lib/api';
import { clampPagination } from '../../lib/sanitize';
import {
  MAX_PAGE_SIZE,
  ONLINE_WINDOW_SECONDS,
  RECENT_WINDOW_HOURS,
  activityWindows,
  filterConstraints,
  isOnlineAt,
  parseActivityFilter,
  parseActivitySort,
  userSearchClause,
  type ActivityConstraint,
  type ActivitySorting,
} from '../../(dashboard)/user-activity-monitor/rules';

const LIST_COLUMNS =
  'id, username, full_name, email, phone, last_active_at, is_frozen, freeze_reason, is_active, created_at, deleted_at';
const RANGE_NOT_SATISFIABLE = 'PGRST103';
const COUNT_FAILED = 'This count could not be loaded.';

interface ActivityRow {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  last_active_at: string | null;
  is_frozen: boolean | null;
  freeze_reason: string | null;
  is_active: boolean | null;
  created_at: string | null;
  deleted_at: string | null;
}

interface Paging {
  page: number;
  limit: number;
  offset: number;
}

type Fetched = { rows: ActivityRow[]; total: number } | { error: string };

function scoped(
  columns: string,
  constraints: readonly ActivityConstraint[],
  match: string | null,
  count?: 'exact',
  head = false,
) {
  let query = supabaseAdmin.from('users').select(columns, { count, head });
  for (const constraint of constraints) {
    switch (constraint.kind) {
      case 'since':
        query = query.gte(constraint.column, constraint.value);
        break;
      case 'is':
        query = query.eq(constraint.column, constraint.value);
        break;
      case 'missing':
        query = query.is(constraint.column, null);
        break;
      case 'present':
        query = query.not(constraint.column, 'is', null);
        break;
    }
  }
  if (match) query = query.or(match);
  return query;
}

async function fetchPage(
  constraints: readonly ActivityConstraint[],
  match: string | null,
  sorting: ActivitySorting,
  paging: Paging,
): Promise<Fetched> {
  const { data, error, count } = await scoped(LIST_COLUMNS, constraints, match, 'exact')
    .order(sorting.key, { ascending: sorting.ascending, nullsFirst: false })
    .order('id', { ascending: sorting.ascending })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (!error) return { rows: (data ?? []) as unknown as ActivityRow[], total: count ?? 0 };
  if (error.code !== RANGE_NOT_SATISFIABLE) return { error: error.message };
  const { count: matching, error: countError } = await scoped('id', constraints, match, 'exact', true);
  if (countError) return { error: countError.message };
  return { rows: [], total: matching ?? 0 };
}

async function countActiveSince(iso: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .gte('last_active_at', iso);
  if (error) {
    console.error('user activity count:', error.message);
    return null;
  }
  return count ?? 0;
}

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const params = new URL(req.url).searchParams;
  const filter = parseActivityFilter(params.get('filter'));
  if (!filter) return fail('VALIDATION_ERROR', 'Unknown activity filter.');
  const sorting = parseActivitySort(params.get('sort'), params.get('dir'));
  const search = userSearchClause(params.get('search'));
  const paging = clampPagination(params.get('page'), params.get('limit'), MAX_PAGE_SIZE);
  const now = Date.now();
  const windows = activityWindows(now);
  const constraints = filterConstraints(filter, windows, params.get('online') === '1');

  const [fetched, onlineCount, recentCount] = await Promise.all([
    fetchPage(constraints, search.clause, sorting, paging),
    countActiveSince(windows.onlineFrom),
    countActiveSince(windows.recentFrom),
  ]);

  if ('error' in fetched) {
    console.error('user activity list:', fetched.error);
    return fail('INTERNAL_ERROR', 'User activity could not be loaded.');
  }

  const users = fetched.rows.map((row) => ({ ...row, is_online: isOnlineAt(row.last_active_at, now) }));

  return ok(
    {
      users,
      total: fetched.total,
      online_count: onlineCount,
      recent_count: recentCount,
      page: paging.page,
      limit: paging.limit,
      filter,
      search: search.term || null,
      sort: sorting.key,
      dir: sorting.ascending ? 'asc' : 'desc',
      online_window_seconds: ONLINE_WINDOW_SECONDS,
      recent_window_hours: RECENT_WINDOW_HOURS,
      partial: {
        online_count: onlineCount === null ? COUNT_FAILED : null,
        recent_count: recentCount === null ? COUNT_FAILED : null,
      },
    },
    { pagination: buildPagination(paging.page, paging.limit, fetched.total) },
  );
}
