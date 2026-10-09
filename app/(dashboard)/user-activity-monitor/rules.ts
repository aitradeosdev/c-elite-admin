import { sanitizeSearch } from '../../lib/sanitize';
import { isUuid } from '../../lib/http';

export const ONLINE_WINDOW_SECONDS = 5 * 60;
export const ONLINE_WINDOW_MINUTES = ONLINE_WINDOW_SECONDS / 60;
export const RECENT_WINDOW_HOURS = 24;
export const ONLINE_LABEL = `Active in the last ${ONLINE_WINDOW_MINUTES} minutes`;
export const RECENT_LABEL = `Active in the last ${RECENT_WINDOW_HOURS} hours`;
export const PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const SEARCH_MAX = 64;
export const REASON_MAX = 500;
export const SESSION_LIMIT = 30;
export const DEVICE_LIMIT = 20;
export const TRANSACTION_LIMIT = 30;
export const WITHDRAWAL_LIMIT = 20;

export const ACTIVITY_FILTERS = [
  { value: 'all', label: 'All users' },
  { value: 'online', label: ONLINE_LABEL },
  { value: 'recent', label: RECENT_LABEL },
  { value: 'frozen', label: 'Frozen' },
  { value: 'deleted', label: 'Deleted' },
] as const;

export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]['value'];

export const FILTER_VALUES: readonly ActivityFilter[] = ACTIVITY_FILTERS.map((option) => option.value);

export const DEFAULT_FILTER: ActivityFilter = 'all';

export const SORT_KEYS = ['last_active_at', 'created_at'] as const;

export type ActivitySortKey = (typeof SORT_KEYS)[number];

export interface ActivitySorting {
  key: ActivitySortKey;
  ascending: boolean;
}

export interface ActivityWindows {
  onlineFrom: string;
  recentFrom: string;
}

export type ActivityConstraint =
  | { kind: 'since'; column: 'last_active_at'; value: string }
  | { kind: 'is'; column: 'is_frozen'; value: boolean }
  | { kind: 'missing'; column: 'deleted_at' }
  | { kind: 'present'; column: 'deleted_at' };

export interface SearchPlan {
  term: string;
  clause: string | null;
}

export type ReasonCheck = { ok: true; reason: string | null } | { ok: false; message: string };

const SEARCH_COLUMNS = ['username', 'full_name', 'email', 'phone'] as const;

function isFilter(value: string): value is ActivityFilter {
  return (FILTER_VALUES as readonly string[]).includes(value);
}

function isSortKey(value: string): value is ActivitySortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

export function filterLabel(filter: ActivityFilter): string {
  return ACTIVITY_FILTERS.find((option) => option.value === filter)?.label ?? ACTIVITY_FILTERS[0].label;
}

export function parseActivityFilter(raw: string | null | undefined): ActivityFilter | null {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return DEFAULT_FILTER;
  return isFilter(value) ? value : null;
}

export function parseActivitySort(sort: string | null | undefined, dir: string | null | undefined): ActivitySorting {
  const key = (sort ?? '').trim();
  return { key: isSortKey(key) ? key : 'last_active_at', ascending: (dir ?? '').trim() === 'asc' };
}

export function activityWindows(now: number): ActivityWindows {
  return {
    onlineFrom: new Date(now - ONLINE_WINDOW_SECONDS * 1000).toISOString(),
    recentFrom: new Date(now - RECENT_WINDOW_HOURS * 3600 * 1000).toISOString(),
  };
}

export function isOnlineAt(lastActiveAt: string | null | undefined, now: number): boolean {
  if (!lastActiveAt) return false;
  const at = new Date(lastActiveAt).getTime();
  return Number.isFinite(at) && at >= now - ONLINE_WINDOW_SECONDS * 1000;
}

export function filterConstraints(
  filter: ActivityFilter,
  windows: ActivityWindows,
  onlineOnly = false,
): ActivityConstraint[] {
  const constraints: ActivityConstraint[] = [];
  const since = (value: string) => {
    if (constraints.some((item) => item.kind === 'since' && item.value === value)) return;
    constraints.push({ kind: 'since', column: 'last_active_at', value });
  };
  switch (filter) {
    case 'online':
      since(windows.onlineFrom);
      break;
    case 'recent':
      since(windows.recentFrom);
      break;
    case 'frozen':
      constraints.push({ kind: 'missing', column: 'deleted_at' }, { kind: 'is', column: 'is_frozen', value: true });
      break;
    case 'deleted':
      constraints.push({ kind: 'present', column: 'deleted_at' });
      break;
    case 'all':
      break;
  }
  if (onlineOnly) since(windows.onlineFrom);
  return constraints;
}

export function userSearchClause(raw: string | null | undefined): SearchPlan {
  const term = sanitizeSearch(raw ?? '', SEARCH_MAX);
  if (!term) return { term: '', clause: null };
  if (isUuid(term)) return { term, clause: `id.eq.${term.toLowerCase()}` };
  const pattern = `%${term}%`;
  return { term, clause: SEARCH_COLUMNS.map((column) => `${column}.ilike.${pattern}`).join(',') };
}

export function checkTerminateReason(value: unknown): ReasonCheck {
  if (value === undefined || value === null) return { ok: true, reason: null };
  if (typeof value !== 'string') return { ok: false, message: 'The reason must be text.' };
  const reason = value.trim();
  if (reason.length > REASON_MAX) {
    return { ok: false, message: `The reason must be ${REASON_MAX} characters or fewer.` };
  }
  return { ok: true, reason: reason || null };
}
