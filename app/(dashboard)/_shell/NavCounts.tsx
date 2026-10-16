'use client';

import { apiRequest, type ApiBody } from '../../lib/apiClient';
import type { Permission } from '../../lib/permissions';
import { usePermissions } from '../../_ui/Permissions';
import { useRealtimeSignal } from '../../_ui/realtime/RealtimeSignals';
import { useResource, type ResourceView } from '../../_ui/useResource';
import { navCountText, type NavCountKey } from './nav';
import s from './NavCounts.module.css';

export type NavCountMap = Partial<Record<NavCountKey, number>>;

export type NavLive = Readonly<Record<NavCountKey, boolean>>;

export interface NavCountProps {
  count: number;
  active: boolean;
}

export const NAV_COUNTS_PATH = '/api/nav-counts';

export const NAV_COUNT_GAP_MS = 2000;

export const NAV_COUNT_PERMISSIONS: Readonly<Record<NavCountKey, Permission>> = {
  withdrawals: 'withdrawals.read',
  cards: 'cards.read',
};

const COUNT_KEYS = Object.keys(NAV_COUNT_PERMISSIONS) as NavCountKey[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function readNavCounts(body: ApiBody): NavCountMap | null {
  const counts = body.counts;
  if (!isRecord(counts)) return null;
  const read: NavCountMap = {};
  for (const key of COUNT_KEYS) {
    const value = counts[key];
    if (value === undefined) continue;
    if (!isCount(value)) return null;
    read[key] = value;
  }
  return read;
}

export function fetchNavCounts(signal: AbortSignal) {
  return apiRequest(NAV_COUNTS_PATH, { signal, select: readNavCounts });
}

export function shownNavCounts(view: Pick<ResourceView<NavCountMap>, 'status' | 'data'>, live: NavLive): NavCountMap {
  const shown: NavCountMap = {};
  if (view.status !== 'success' || !view.data) return shown;
  for (const key of COUNT_KEYS) {
    const count = view.data[key];
    if (live[key] && count !== undefined && count > 0) shown[key] = count;
  }
  return shown;
}

export function useNavCounts(keys: readonly NavCountKey[]): NavCountMap {
  const { can } = usePermissions();
  const topic = (key: NavCountKey) => (keys.includes(key) && can(NAV_COUNT_PERMISSIONS[key]) ? key : null);
  const reload = () => counts.invalidate({ minGapMs: NAV_COUNT_GAP_MS });
  const withdrawals = useRealtimeSignal(topic('withdrawals'), reload);
  const cards = useRealtimeSignal(topic('cards'), reload);
  const live: NavLive = { withdrawals: withdrawals.live, cards: cards.live };
  const counts = useResource(live.withdrawals || live.cards ? NAV_COUNTS_PATH : null, fetchNavCounts);
  return shownNavCounts(counts, live);
}

export function NavCount({ count, active }: NavCountProps) {
  return (
    <span className={active ? `${s.count} ${s.onActive}` : s.count} aria-hidden="true">
      {navCountText(count)}
    </span>
  );
}
