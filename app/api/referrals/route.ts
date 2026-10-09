import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin } from '../../lib/guard';
import { buildPagination, fail, isUuid, ok } from '../../lib/api';
import {
  SEARCH_USER_CAP, SETTING_KEYS, buildFilterPlan, buildStats, combineGroups, owedAmount, presentReferral,
  presentSettings, readListQuery, searchGroup, userSearchFilter,
  type FilterPlan, type ListQuery, type OwedTotals, type ReferralFacts, type ReferralStats, type StoredReferral,
  type StoredSettingRow, type UserBrief,
} from '../../(dashboard)/referral-management/referralRules';

const REFERRAL_COLUMNS =
  'id, referrer_id, referee_id, referrer_bonus_amount, referee_bonus_amount, first_trade_completed, first_trade_at, referrer_credited, referee_credited, created_at';
const OWED_COLUMNS = 'id, first_trade_completed, referrer_bonus_amount, referee_bonus_amount, referrer_credited, referee_credited';
const USER_COLUMNS = 'id, username, full_name';
const RANGE_NOT_SATISFIABLE = 'PGRST103';
const LOOKUP_BATCH = 100;
const LOOKUP_PARALLEL = 4;
const OWED_BATCH = 1000;
const OWED_PAGES = 5;
const LIST_FAILED = 'Referrals could not be loaded.';
const STATS_FAILED = 'The referral totals could not be loaded.';

function scoped(columns: string, plan: FilterPlan, count?: 'exact', head = false) {
  let query = supabaseAdmin.from('referrals').select(columns, { count, head });
  if (plan.firstTrade === 'done') query = query.is('first_trade_completed', true);
  if (plan.firstTrade === 'not_done') query = query.not('first_trade_completed', 'is', true);
  if (plan.fromIso) query = query.gte('created_at', plan.fromIso);
  if (plan.toIso) query = query.lt('created_at', plan.toIso);
  const logic = combineGroups(plan.groups);
  if (logic) query = query.or(logic);
  return query;
}

async function findUsers(search: string): Promise<{ ids: string[]; capped: boolean } | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .or(userSearchFilter(search))
    .limit(SEARCH_USER_CAP + 1);
  if (error) {
    console.error('referrals search:', error.message);
    return null;
  }
  const ids = ((data ?? []) as Array<{ id: unknown }>)
    .map((row) => row.id)
    .filter((id): id is string => isUuid(id));
  return { ids, capped: ids.length > SEARCH_USER_CAP };
}

async function lookupUsers(rows: readonly StoredReferral[]): Promise<Map<string, UserBrief> | null> {
  const unique = Array.from(new Set(
    rows.flatMap((row) => [row.referrer_id, row.referee_id]).filter((id): id is string => isUuid(id)),
  ));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += LOOKUP_BATCH) chunks.push(unique.slice(index, index + LOOKUP_BATCH));
  const users = new Map<string, UserBrief>();
  for (let index = 0; index < chunks.length; index += LOOKUP_PARALLEL) {
    const results = await Promise.all(
      chunks.slice(index, index + LOOKUP_PARALLEL).map((chunk) => supabaseAdmin.from('users').select(USER_COLUMNS).in('id', chunk)),
    );
    for (const { data, error } of results) {
      if (error) {
        console.error('referrals user lookup:', error.message);
        return null;
      }
      for (const user of (data ?? []) as unknown as UserBrief[]) users.set(user.id, user);
    }
  }
  return users;
}

async function readOwed(): Promise<OwedTotals | null> {
  const plan = buildFilterPlan({ status: 'unclaimed', fromIso: null, toIso: null }, null);
  let sum = 0;
  let seen = 0;
  let total: number | null = null;
  for (let index = 0; index < OWED_PAGES; index += 1) {
    const from = index * OWED_BATCH;
    const { data, error, count } = await scoped(OWED_COLUMNS, plan, index === 0 ? 'exact' : undefined)
      .order('id', { ascending: true })
      .range(from, from + OWED_BATCH - 1);
    if (error) {
      if (error.code === RANGE_NOT_SATISFIABLE) break;
      console.error('referrals unclaimed totals:', error.message);
      return null;
    }
    if (index === 0 && typeof count === 'number') total = count;
    const batch = (data ?? []) as unknown as ReferralFacts[];
    for (const row of batch) sum += owedAmount(row);
    seen += batch.length;
    if (batch.length < OWED_BATCH || (total !== null && seen >= total)) {
      return { count: total ?? seen, sum, partial: total !== null && seen < total };
    }
  }
  return { count: total ?? seen, sum, partial: total === null || seen < total };
}

async function readStats(): Promise<ReferralStats | null> {
  const [rpc, owed] = await Promise.all([supabaseAdmin.rpc('admin_referrals_stats'), readOwed()]);
  if (rpc.error) {
    console.error('referrals stats:', rpc.error.message);
    return null;
  }
  if (!owed) return null;
  const stats = buildStats(rpc.data, owed);
  if (!stats) console.error('referrals stats: the totals came back in an unexpected shape');
  return stats;
}

async function readSettings() {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('key, value, updated_at')
    .in('key', [...SETTING_KEYS]);
  if (error) {
    console.error('referral settings read:', error.message);
    return null;
  }
  return presentSettings((data ?? []) as StoredSettingRow[]);
}

async function summary() {
  const [settings, stats] = await Promise.all([readSettings(), readStats().catch(() => null)]);
  if (!settings) return fail('INTERNAL_ERROR', 'The referral settings could not be loaded.');
  return ok({ settings, stats, partial: { stats: stats ? null : STATS_FAILED } });
}

async function list(query: ListQuery) {
  const statsWork: Promise<ReferralStats | null | undefined> = query.withStats
    ? readStats().catch(() => null)
    : Promise.resolve(undefined);

  let clauses: string[] | null = null;
  let searchCapped = false;
  if (query.search) {
    const found = await findUsers(query.search);
    if (!found) return fail('INTERNAL_ERROR', 'The search could not be run.');
    searchCapped = found.capped;
    clauses = searchGroup(query.search, found.ids);
  }

  let rows: StoredReferral[] = [];
  let total = 0;
  if (clauses === null || clauses.length > 0) {
    const plan = buildFilterPlan(query, clauses);
    const offset = (query.page - 1) * query.pageSize;
    const { data, error, count } = await scoped(REFERRAL_COLUMNS, plan, 'exact')
      .order(query.sort, { ascending: query.ascending, nullsFirst: false })
      .order('id', { ascending: query.ascending })
      .range(offset, offset + query.pageSize - 1);
    if (error) {
      if (error.code !== RANGE_NOT_SATISFIABLE) {
        console.error('referrals list:', error.message);
        return fail('INTERNAL_ERROR', LIST_FAILED);
      }
      const { count: matching, error: countError } = await scoped('id', plan, 'exact', true);
      if (countError) {
        console.error('referrals count:', countError.message);
        return fail('INTERNAL_ERROR', LIST_FAILED);
      }
      total = matching ?? 0;
    } else {
      rows = (data ?? []) as unknown as StoredReferral[];
      total = count ?? rows.length;
    }
  }

  const users = await lookupUsers(rows);
  if (!users) return fail('INTERNAL_ERROR', LIST_FAILED);
  const stats = await statsWork;

  const payload: Record<string, unknown> = {
    log: rows.map((row) => presentReferral(row, users)),
    total,
    page: query.page,
    page_size: query.pageSize,
    search_capped: searchCapped,
  };
  if (stats !== undefined) {
    payload.stats = stats;
    payload.partial = { stats: stats ? null : STATS_FAILED };
  }
  return ok(payload, { pagination: buildPagination(query.page, query.pageSize, total) });
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin('referrals.read');
  if (!guard.ok) return guard.response;

  const params = new URL(req.url).searchParams;
  if (params.get('view') === 'summary') return summary();

  const checked = readListQuery(params);
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  return list(checked.query);
}
