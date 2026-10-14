import { supabaseAdmin } from './supabase';
import { holdsAny, type Permission } from './permissions';
import { BUSINESS_TZ, businessRange, previousBusinessRange, type BusinessRange } from './time';

export type MetricGroup =
  | 'cards'
  | 'withdrawals'
  | 'transactions'
  | 'users'
  | 'activity'
  | 'coupons'
  | 'rewards'
  | 'referrals'
  | 'wallets'
  | 'catalog'
  | 'flags'
  | 'admins';

export const GROUP_PERMISSION: Readonly<Record<MetricGroup, Permission | readonly Permission[]>> = {
  cards: 'cards.read',
  withdrawals: 'withdrawals.read',
  transactions: 'transactions.read',
  users: 'users.read',
  activity: 'user_activity.read',
  coupons: 'coupons.read',
  rewards: 'rewards.read',
  referrals: 'referrals.read',
  wallets: 'wallets.read',
  catalog: 'catalog.read',
  flags: 'withdrawals.read',
  admins: 'admin_users.read',
};

const ALL_GROUPS = Object.keys(GROUP_PERMISSION) as MetricGroup[];

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const QUERY_TIMEOUT_MS = 20000;
const RECENT_LIMIT = 10;
const MAX_DAYS = 365;

export type MetricMap = Record<string, number | string | null>;

export interface DashboardRange {
  days: number;
  from: string;
  to: string;
  timezone: string;
}

export interface DashboardData {
  stats: MetricMap;
  previous: MetricMap | null;
  groups: MetricGroup[];
  range: DashboardRange;
  generated_at: string;
  metrics_error: string | null;
  previous_error: string | null;
  recent_submissions: RecentSubmission[];
  recent_submissions_error: string | null;
}

export interface RecentSubmission {
  id: string;
  amount_foreign: number | null;
  payout_naira: number | null;
  status: string;
  created_at: string;
  card_id: string | null;
  users: { username: string | null } | null;
  cards: { name: string | null } | null;
  card_types: { country_code: string | null } | null;
  country_name: string | null;
}

interface MetricsResult {
  stats: MetricMap;
  error: string | null;
}

interface CountryRow {
  card_id: string;
  country_code: string;
  country_name: string;
}

export function grantedGroups(permissions: ReadonlySet<Permission>): MetricGroup[] {
  return ALL_GROUPS.filter((g) => holdsAny(permissions, GROUP_PERMISSION[g]));
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unexpected error';
}

function isMetricMap(value: unknown): value is MetricMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampDays(days: number | undefined): number {
  const n = Math.floor(Number(days ?? 1));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_DAYS) : 1;
}

async function fetchMetrics(
  range: BusinessRange,
  groups: MetricGroup[],
  signal: AbortSignal,
): Promise<MetricsResult> {
  if (groups.length === 0) return { stats: {}, error: null };
  try {
    const { data, error } = await supabaseAdmin
      .rpc('admin_dashboard_metrics', {
        p_from: range.from_iso,
        p_to: range.to_iso,
        p_online_from: new Date(Date.now() - ONLINE_WINDOW_MS).toISOString(),
        p_groups: groups,
      })
      .abortSignal(signal);
    if (error) {
      console.error('admin_dashboard_metrics failed:', error.message);
      return { stats: {}, error: error.message };
    }
    if (!isMetricMap(data)) {
      console.error('admin_dashboard_metrics returned an unexpected payload');
      return { stats: {}, error: 'Unexpected metrics payload' };
    }
    return { stats: data, error: null };
  } catch (err) {
    const message = errorText(err);
    console.error('admin_dashboard_metrics failed:', message);
    return { stats: {}, error: message };
  }
}

async function countryNames(cardIds: string[], signal: AbortSignal): Promise<Record<string, string>> {
  if (cardIds.length === 0) return {};
  try {
    const { data, error } = await supabaseAdmin
      .from('card_countries')
      .select('card_id, country_code, country_name')
      .in('card_id', cardIds)
      .abortSignal(signal);
    if (error) {
      console.error('recent submission countries failed:', error.message);
      return {};
    }
    return Object.fromEntries(
      ((data || []) as CountryRow[]).map((c) => [`${c.card_id}|${c.country_code}`, c.country_name]),
    );
  } catch (err) {
    console.error('recent submission countries failed:', errorText(err));
    return {};
  }
}

export async function getRecentSubmissions(signal?: AbortSignal): Promise<{
  rows: RecentSubmission[];
  error: string | null;
}> {
  const deadline = signal ?? AbortSignal.timeout(QUERY_TIMEOUT_MS);
  try {
    const { data, error } = await supabaseAdmin
      .from('card_submissions')
      .select(`
        id, amount_foreign, payout_naira, status, created_at, card_id,
        users(username),
        cards(name),
        card_types(country_code)
      `)
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT)
      .abortSignal(deadline);

    if (error) {
      console.error('recent submissions failed:', error.message);
      return { rows: [], error: error.message };
    }

    const rows = (data || []) as unknown as RecentSubmission[];
    const cardIds = [...new Set(rows.map((r) => r.card_id).filter(Boolean))] as string[];
    const nameByKey = await countryNames(cardIds, deadline);

    return {
      rows: rows.map((r) => ({
        ...r,
        country_name:
          nameByKey[`${r.card_id}|${r.card_types?.country_code}`] ||
          r.card_types?.country_code ||
          null,
      })),
      error: null,
    };
  } catch (err) {
    const message = errorText(err);
    console.error('recent submissions failed:', message);
    return { rows: [], error: message };
  }
}

export interface DashboardOptions {
  days?: number;
  compare?: boolean;
}

const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  cardsInRange: 'cardsToday',
  payoutsInRange: 'todayPayouts',
  txInRange: 'txToday',
  txVolumeInRange: 'txVolumeToday',
  newUsersInRange: 'newUsersToday',
  giftboxInRange: 'giftboxToday',
  referralsInRange: 'referralsToday',
};

export function withLegacyAliases(stats: MetricMap, days: number): MetricMap {
  if (days !== 1) return stats;
  const out: MetricMap = { ...stats };
  for (const [current, legacy] of Object.entries(LEGACY_ALIASES)) {
    if (current in stats) out[legacy] = stats[current];
  }
  return out;
}

export async function getDashboardData(
  permissions: ReadonlySet<Permission>,
  options: DashboardOptions = {},
): Promise<DashboardData> {
  const days = clampDays(options.days);
  const groups = grantedGroups(permissions);
  const range = businessRange(days);
  const signal = AbortSignal.timeout(QUERY_TIMEOUT_MS);

  const [metrics, previous, submissions] = await Promise.all([
    fetchMetrics(range, groups, signal),
    options.compare
      ? fetchMetrics(previousBusinessRange(range), groups, signal)
      : Promise.resolve(null),
    permissions.has('cards.read')
      ? getRecentSubmissions(signal)
      : Promise.resolve({ rows: [] as RecentSubmission[], error: null }),
  ]);

  return {
    stats: withLegacyAliases(metrics.stats, days),
    previous: previous && !previous.error ? withLegacyAliases(previous.stats, days) : null,
    groups,
    range: { days, from: range.from_iso, to: range.to_iso, timezone: BUSINESS_TZ },
    generated_at: new Date().toISOString(),
    metrics_error: metrics.error,
    previous_error: previous ? previous.error : null,
    recent_submissions: submissions.rows,
    recent_submissions_error: submissions.error,
  };
}
