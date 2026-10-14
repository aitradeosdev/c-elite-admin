import type { ReactNode } from 'react';
import { ArrowDownToLine, ClipboardList, Flag, MessageSquareWarning, Wallet } from 'lucide-react';
import { holdsAny, type Permission } from '../../lib/permissions';
import type { MetricMap } from '../../lib/dashboard';
import { BUSINESS_TZ_LABEL, formatAge, formatBusinessDate } from '../../lib/time';
import { formatNaira, type StatItem } from '../../_ui';

export const REFRESH_INTERVAL_MS = 30000;

export type MetricFormat = 'count' | 'money';
export type MetricState = 'ready' | 'unavailable' | 'loading';

export const VALUE_SKELETON_WIDTH: Readonly<Record<MetricFormat, string>> = {
  count: '2.5em',
  money: '7em',
};

export interface MetricSpec {
  statKey: string;
  perm: Permission | readonly Permission[];
  label: string;
  hint: string;
  href: string;
  format: MetricFormat;
}

export interface ActionMetricSpec extends MetricSpec {
  icon: ReactNode;
  clearHint: string;
  oldestKey?: string;
}

export interface StripBand {
  id: string;
  label: string;
  metrics: readonly MetricSpec[];
}

export interface ActionTileView {
  key: string;
  label: string;
  icon: ReactNode;
  href: string;
  format: MetricFormat;
  state: MetricState;
  value: string;
  hint: string;
  age: string | null;
  attention: boolean;
}

const ICON_SIZE = 14;

export const ACTION_METRICS: readonly ActionMetricSpec[] = [
  {
    statKey: 'pendingCards',
    perm: 'cards.read',
    label: 'Pending cards',
    hint: 'Awaiting admin review',
    clearHint: 'Queue is clear',
    href: '/card-queue?status=pending',
    format: 'count',
    icon: <ClipboardList size={ICON_SIZE} />,
    oldestKey: 'oldestPendingCardAt',
  },
  {
    statKey: 'disputedCards',
    perm: 'cards.read',
    label: 'Disputed cards',
    hint: 'Awaiting a decision',
    clearHint: 'No open disputes',
    href: '/card-queue?status=disputed',
    format: 'count',
    icon: <MessageSquareWarning size={ICON_SIZE} />,
  },
  {
    statKey: 'pendingWithdrawals',
    perm: 'withdrawals.read',
    label: 'Pending withdrawals',
    hint: 'In review or held',
    clearHint: 'Queue is clear',
    href: '/withdrawals?tab=pending_review',
    format: 'count',
    icon: <ArrowDownToLine size={ICON_SIZE} />,
    oldestKey: 'oldestPendingWithdrawalAt',
  },
  {
    statKey: 'pendingWithdrawalValue',
    perm: 'withdrawals.read',
    label: 'Pending payout value',
    hint: 'Held for review',
    clearHint: 'Nothing held',
    href: '/withdrawals?tab=pending_review',
    format: 'money',
    icon: <Wallet size={ICON_SIZE} />,
  },
  {
    statKey: 'openFlags',
    perm: 'withdrawals.read',
    label: 'Open flags',
    hint: 'Flagged withdrawals to review',
    clearHint: 'No open flags',
    href: '/withdrawals?tab=pending_review',
    format: 'count',
    icon: <Flag size={ICON_SIZE} />,
  },
];

const TODAY_METRICS: readonly MetricSpec[] = [
  { statKey: 'cardsInRange', perm: 'cards.read', label: 'Cards submitted', hint: 'Any status', href: '/card-queue', format: 'count' },
  { statKey: 'payoutsInRange', perm: 'withdrawals.read', label: 'Payouts settled', hint: 'Successful withdrawals', href: '/withdrawals?tab=success', format: 'money' },
  { statKey: 'txInRange', perm: 'transactions.read', label: 'Transactions', hint: 'All types and statuses', href: '/transactions-overview', format: 'count' },
  { statKey: 'txVolumeInRange', perm: 'transactions.read', label: 'Volume', hint: 'Successful transactions', href: '/transactions-overview', format: 'money' },
  { statKey: 'newUsersInRange', perm: 'users.read', label: 'New users', hint: 'Accounts created', href: '/users', format: 'count' },
  { statKey: 'giftboxInRange', perm: 'rewards.read', label: 'Giftbox claims', hint: 'Rewards claimed', href: '/bonuses-rewards', format: 'count' },
  { statKey: 'referralsInRange', perm: 'referrals.read', label: 'Referrals', hint: 'New referral signups', href: '/referral-management', format: 'count' },
];

const EXPOSURE_METRICS: readonly MetricSpec[] = [
  { statKey: 'walletTotal', perm: 'wallets.read', label: 'Wallet liability', hint: 'Sum of all user wallets', href: '/platform-balance', format: 'money' },
  { statKey: 'bonusLiability', perm: 'rewards.read', label: 'Bonus liability', hint: 'Unspent bonus balances', href: '/bonuses-rewards', format: 'money' },
  { statKey: 'rewardPool', perm: 'rewards.read', label: 'Reward pool', hint: 'Bonuses and coupon rewards, all time', href: '/bonuses-rewards', format: 'money' },
];

const ESTATE_METRICS: readonly MetricSpec[] = [
  { statKey: 'totalUsers', perm: 'users.read', label: 'Total users', hint: 'Excludes deleted accounts', href: '/users', format: 'count' },
  { statKey: 'frozenUsers', perm: 'users.read', label: 'Frozen users', hint: 'Account access suspended', href: '/users', format: 'count' },
  { statKey: 'onlineUsers', perm: 'user_activity.read', label: 'Users online', hint: 'Active in the last 5 min', href: '/user-activity-monitor', format: 'count' },
  { statKey: 'activeCoupons', perm: 'coupons.read', label: 'Active coupons', hint: 'Currently redeemable', href: '/coupons', format: 'count' },
  { statKey: 'activeCards', perm: 'catalog.read', label: 'Active cards', hint: 'Live in the catalog', href: '/cards', format: 'count' },
  { statKey: 'totalAdmins', perm: 'admin_users.read', label: 'Admin accounts', hint: 'Active admin users', href: '/admin-accounts', format: 'count' },
  { statKey: 'processingWithdrawals', perm: 'withdrawals.read', label: 'Payouts in flight', hint: 'Sent to a provider', href: '/withdrawals?tab=processing', format: 'count' },
];

export const STRIP_BANDS: readonly StripBand[] = [
  { id: 'today', label: 'Today', metrics: TODAY_METRICS },
  { id: 'exposure', label: 'Exposure', metrics: EXPOSURE_METRICS },
  { id: 'estate', label: 'Estate', metrics: ESTATE_METRICS },
];

const COUNT_FORMAT = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });

function metricNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatMetric(format: MetricFormat, value: number): string {
  return format === 'money' ? formatNaira(value) : COUNT_FORMAT.format(value);
}

function oldestAge(spec: ActionMetricSpec, stats: MetricMap, now: Date): string | null {
  if (!spec.oldestKey) return null;
  const raw = stats[spec.oldestKey];
  if (typeof raw !== 'string' || raw === '') return null;
  const age = formatAge(raw, now);
  return age === '—' ? null : age;
}

export function buildActionTiles(
  stats: MetricMap,
  permissions: ReadonlySet<Permission>,
  failed: boolean,
  now: Date,
): ActionTileView[] {
  return ACTION_METRICS.filter((spec) => holdsAny(permissions, spec.perm)).map((spec) => {
    const value = failed ? null : metricNumber(stats[spec.statKey]);
    const waiting = value !== null && value > 0;
    return {
      key: spec.statKey,
      label: spec.label,
      icon: spec.icon,
      href: spec.href,
      format: spec.format,
      state: value === null ? 'unavailable' : 'ready',
      value: value === null ? '' : formatMetric(spec.format, value),
      hint: value === null || waiting ? spec.hint : spec.clearHint,
      age: waiting ? oldestAge(spec, stats, now) : null,
      attention: waiting,
    };
  });
}

export function placeholderActionTiles(): ActionTileView[] {
  return ACTION_METRICS.map((spec) => ({
    key: spec.statKey,
    label: spec.label,
    icon: spec.icon,
    href: spec.href,
    format: spec.format,
    state: 'loading',
    value: '',
    hint: spec.hint,
    age: null,
    attention: false,
  }));
}

export function buildStripCells(
  specs: readonly MetricSpec[],
  stats: MetricMap,
  permissions: ReadonlySet<Permission>,
  failed: boolean,
): StatItem[] {
  return specs.filter((spec) => holdsAny(permissions, spec.perm)).map((spec) => {
    const value = failed ? null : metricNumber(stats[spec.statKey]);
    return {
      label: spec.label,
      hint: spec.hint,
      href: spec.href,
      value: value === null ? '' : formatMetric(spec.format, value),
      unavailable: value === null,
    };
  });
}

export function placeholderStripCells(specs: readonly MetricSpec[]): StatItem[] {
  return specs.map((spec) => ({
    label: spec.label,
    hint: spec.hint,
    href: spec.href,
    value: '',
    loading: true,
    loadingWidth: VALUE_SKELETON_WIDTH[spec.format],
  }));
}

export function overviewSubtitle(from: Date | string): string {
  return `Activity for ${formatBusinessDate(from)} (${BUSINESS_TZ_LABEL}).`;
}
