import {
  combineCodecs, enumParam, intParam, sortParam, stringParam, uuidParam, type UrlCodecValue,
} from '../../_ui/useUrlState';
import type { SortState, TabItem, Tone } from '../../_ui';
import type { ApiBody, ApiResult } from '../../lib/apiClient';
import { BUSINESS_TZ_LABEL, formatAge, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import {
  ACTIVITY_FILTERS,
  DEFAULT_FILTER,
  FILTER_VALUES,
  ONLINE_WINDOW_MINUTES,
  PAGE_SIZE,
  RECENT_WINDOW_HOURS,
  SEARCH_MAX,
  SESSION_LIMIT,
  SORT_KEYS,
  filterLabel,
  type ActivityFilter,
} from './rules';

export const POLL_SECONDS = 30;

export const DEFAULT_SORT: SortState = { key: 'last_active_at', dir: 'desc' };

export const UNKNOWN_TERMINATE =
  'No response came back, so the sessions may or may not have been ended. Signing out everywhere again is safe.';

export const ACTIVITY_URL = combineCodecs({
  filter: enumParam('filter', FILTER_VALUES, DEFAULT_FILTER),
  search: stringParam('search', { maxLength: SEARCH_MAX }),
  sort: sortParam({ allowed: SORT_KEYS, default: DEFAULT_SORT }),
  page: intParam('page', { min: 1, default: 1 }),
  id: uuidParam('id'),
});

export type ActivityView = UrlCodecValue<typeof ACTIVITY_URL>;

export const FILTER_TABS: ReadonlyArray<TabItem<ActivityFilter>> = ACTIVITY_FILTERS.map(({ value, label }) => ({
  value,
  label,
}));

export type AccountState = 'active' | 'inactive' | 'frozen' | 'deleted';

export type PauseReason = 'manual' | 'dialog' | 'drawer';

export interface ActivityUser {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  last_active_at: string | null;
  is_frozen: boolean;
  freeze_reason: string | null;
  is_active: boolean | null;
  created_at: string | null;
  deleted_at: string | null;
  is_online: boolean;
}

export interface UserDetail extends ActivityUser {
  country: string | null;
}

export interface SessionRow {
  id: string;
  device_model: string | null;
  os_version: string | null;
  app_version: string | null;
  ip_address: string | null;
  created_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
}

export interface DeviceRow {
  id: string;
  device_model: string | null;
  os_version: string | null;
  app_version: string | null;
  ip_address: string | null;
  is_new_device: boolean;
  last_seen_at: string | null;
  login_count: number | null;
  created_at: string | null;
}

export interface TransactionRow {
  id: string;
  type: string | null;
  amount: number | string | null;
  status: string | null;
  created_at: string | null;
}

export interface WithdrawalRow {
  id: string;
  amount: number | string | null;
  bank_name: string | null;
  account_name: string | null;
  status: string | null;
  created_at: string | null;
}

export interface DetailPartial {
  sessions: string | null;
  devices: string | null;
  transactions: string | null;
  withdrawals: string | null;
}

export interface ActivityDetail {
  user: UserDetail | null;
  sessions: SessionRow[];
  devices: DeviceRow[];
  transactions: TransactionRow[];
  withdrawals: WithdrawalRow[];
  openSessionCount: number | null;
  partial: DetailPartial;
}

export type LoadedDetail = ActivityDetail & { user: UserDetail };

export interface ActivityList {
  users: ActivityUser[];
  total: number;
  onlineCount: number | null;
  recentCount: number | null;
}

export interface TerminateResult {
  endedSessions: number | null;
  warning: string | null;
}

export type TerminateOutcome =
  | { kind: 'done'; endedSessions: number | null; warning: string | null; requestId: string | null }
  | { kind: 'refused'; message: string; status: number | null }
  | { kind: 'expired' }
  | { kind: 'retry'; message: string };

export type SettledTerminate = Exclude<TerminateOutcome, { kind: 'retry' }>;

export interface Presence {
  key: 'online' | 'offline' | 'never';
  label: string;
  tone: Tone;
}

export interface SessionState {
  key: 'open' | 'signed_out' | 'ended_by_admin' | 'ended';
  label: string;
  tone: Tone;
}

export interface LiveState {
  tone: Tone;
  label: string;
  detail: string | null;
}

export interface OpenSessionSummary {
  total: number;
  exact: boolean;
  known: boolean;
}

export interface EmptyCopy {
  title: string;
  hint: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function count(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function amount(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return text(value);
}

function rows<T>(value: unknown, read: (raw: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const raw of value) {
    const row = isRecord(raw) ? read(raw) : null;
    if (row) out.push(row);
  }
  return out;
}

function readUser(raw: Record<string, unknown>): ActivityUser | null {
  const id = text(raw.id);
  if (!id) return null;
  return {
    id,
    username: text(raw.username),
    full_name: text(raw.full_name),
    email: text(raw.email),
    phone: text(raw.phone),
    last_active_at: text(raw.last_active_at),
    is_frozen: raw.is_frozen === true,
    freeze_reason: text(raw.freeze_reason),
    is_active: typeof raw.is_active === 'boolean' ? raw.is_active : null,
    created_at: text(raw.created_at),
    deleted_at: text(raw.deleted_at),
    is_online: raw.is_online === true,
  };
}

function readUserDetail(raw: Record<string, unknown>): UserDetail | null {
  const user = readUser(raw);
  return user ? { ...user, country: text(raw.country) } : null;
}

function readSession(raw: Record<string, unknown>): SessionRow | null {
  const id = text(raw.id);
  if (!id) return null;
  return {
    id,
    device_model: text(raw.device_model),
    os_version: text(raw.os_version),
    app_version: text(raw.app_version),
    ip_address: text(raw.ip_address),
    created_at: text(raw.created_at),
    ended_at: text(raw.ended_at),
    ended_by: text(raw.ended_by),
  };
}

function readDevice(raw: Record<string, unknown>): DeviceRow | null {
  const id = text(raw.id);
  if (!id) return null;
  return {
    id,
    device_model: text(raw.device_model),
    os_version: text(raw.os_version),
    app_version: text(raw.app_version),
    ip_address: text(raw.ip_address),
    is_new_device: raw.is_new_device === true,
    last_seen_at: text(raw.last_seen_at),
    login_count: count(raw.login_count),
    created_at: text(raw.created_at),
  };
}

function readTransaction(raw: Record<string, unknown>): TransactionRow | null {
  const id = text(raw.id);
  if (!id) return null;
  return {
    id,
    type: text(raw.type),
    amount: amount(raw.amount),
    status: text(raw.status),
    created_at: text(raw.created_at),
  };
}

function readWithdrawal(raw: Record<string, unknown>): WithdrawalRow | null {
  const id = text(raw.id);
  if (!id) return null;
  return {
    id,
    amount: amount(raw.amount),
    bank_name: text(raw.bank_name),
    account_name: text(raw.account_name),
    status: text(raw.status),
    created_at: text(raw.created_at),
  };
}

export function toListResult(body: ApiBody): ActivityList | null {
  if (!Array.isArray(body.users)) return null;
  return {
    users: rows(body.users, readUser),
    total: count(body.total) ?? 0,
    onlineCount: count(body.online_count),
    recentCount: count(body.recent_count),
  };
}

export function toDetailResult(body: ApiBody): ActivityDetail | null {
  if (!('user' in body) || !Array.isArray(body.sessions)) return null;
  const user = isRecord(body.user) ? readUserDetail(body.user) : null;
  if (body.user !== null && user === null) return null;
  const partial = isRecord(body.partial) ? body.partial : {};
  return {
    user,
    sessions: rows(body.sessions, readSession),
    devices: rows(body.devices, readDevice),
    transactions: rows(body.transactions, readTransaction),
    withdrawals: rows(body.withdrawals, readWithdrawal),
    openSessionCount: count(body.open_session_count),
    partial: {
      sessions: text(partial.sessions),
      devices: text(partial.devices),
      transactions: text(partial.transactions),
      withdrawals: text(partial.withdrawals),
    },
  };
}

export function isLoaded(detail: ActivityDetail | undefined): detail is LoadedDetail {
  return Boolean(detail && detail.user);
}

export function toTerminateResult(body: ApiBody): TerminateResult {
  return { endedSessions: count(body.ended_sessions), warning: text(body.warning) };
}

export function classifyTerminate(result: ApiResult<TerminateResult>): TerminateOutcome {
  if (result.ok) {
    return {
      kind: 'done',
      endedSessions: result.data.endedSessions,
      warning: result.data.warning,
      requestId: result.requestId,
    };
  }
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.status === 403 || failure.status === 404) {
    return { kind: 'refused', message: failure.message, status: failure.status };
  }
  if (failure.outcomeUnknown) return { kind: 'retry', message: UNKNOWN_TERMINATE };
  return { kind: 'retry', message: failure.message };
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString('en-NG')} ${n === 1 ? singular : pluralForm}`;
}

export function countText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-NG') : '—';
}

export function handleOf(user: Pick<ActivityUser, 'username'>): string | null {
  return user.username ? `@${user.username}` : null;
}

export function displayName(user: Pick<ActivityUser, 'full_name' | 'username' | 'email'>): string {
  return user.full_name || handleOf(user) || user.email || 'Unnamed user';
}

export function userSummary(user: Pick<ActivityUser, 'full_name' | 'username' | 'email'>): string {
  const handle = handleOf(user);
  if (user.full_name && handle) return `${user.full_name} (${handle})`;
  return displayName(user);
}

export function shortName(user: Pick<ActivityUser, 'full_name' | 'username' | 'email'>): string {
  return handleOf(user) || user.full_name || user.email || 'this user';
}

export function contactLine(user: Pick<ActivityUser, 'full_name' | 'username' | 'email'>): string | undefined {
  const handle = user.full_name ? handleOf(user) : null;
  const email = displayName(user) === user.email ? null : user.email;
  const line = [handle, email].filter(Boolean).join(' · ');
  return line || undefined;
}

export function accountState(user: Pick<ActivityUser, 'deleted_at' | 'is_frozen' | 'is_active'>): AccountState {
  if (user.deleted_at) return 'deleted';
  if (user.is_frozen) return 'frozen';
  return user.is_active === true ? 'active' : 'inactive';
}

export function presenceOf(user: Pick<ActivityUser, 'is_online' | 'last_active_at'>): Presence {
  if (user.is_online) return { key: 'online', label: 'Online', tone: 'success' };
  if (!user.last_active_at) return { key: 'never', label: 'Never active', tone: 'neutral' };
  return { key: 'offline', label: 'Offline', tone: 'neutral' };
}

export function ageText(value: string | null | undefined, now?: Date): string {
  const age = formatAge(value, now);
  return age === '—' ? age : `${age} ago`;
}

export function seenText(value: string | null | undefined, now?: Date): string {
  if (!value) return 'Never active';
  return `${formatBusinessDateTime(value)} ${BUSINESS_TZ_LABEL} · ${ageText(value, now)}`;
}

export function deviceLabel(row: Pick<SessionRow, 'device_model' | 'os_version' | 'app_version'>): string {
  const parts = [row.device_model, row.os_version, row.app_version ? `v${row.app_version}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Unknown device';
}

export function sessionState(session: Pick<SessionRow, 'ended_at' | 'ended_by'>, now?: Date): SessionState {
  if (!session.ended_at) return { key: 'open', label: 'Open', tone: 'success' };
  const age = ageText(session.ended_at, now);
  if (session.ended_by === 'admin') return { key: 'ended_by_admin', label: `Ended by an admin ${age}`, tone: 'neutral' };
  if (session.ended_by === 'user') return { key: 'signed_out', label: `Signed out ${age}`, tone: 'neutral' };
  return { key: 'ended', label: `Ended ${age}`, tone: 'neutral' };
}

export function openSessionsOf(sessions: readonly SessionRow[]): SessionRow[] {
  return sessions.filter((session) => !session.ended_at);
}

export function openSessionSummary(
  detail: Pick<ActivityDetail, 'sessions' | 'openSessionCount' | 'partial'>,
): OpenSessionSummary {
  const listed = openSessionsOf(detail.sessions).length;
  if (detail.openSessionCount !== null) {
    return { total: Math.max(detail.openSessionCount, listed), exact: true, known: true };
  }
  if (detail.partial.sessions) return { total: 0, exact: false, known: false };
  return { total: listed, exact: false, known: true };
}

export function openSessionsText(summary: OpenSessionSummary): string {
  if (!summary.known) return 'Could not be checked';
  if (summary.exact) return summary.total === 0 ? 'None' : summary.total.toLocaleString('en-NG');
  if (summary.total === 0) return `None in the latest ${SESSION_LIMIT}`;
  return `At least ${summary.total.toLocaleString('en-NG')}`;
}

export function typeLabel(value: string | null | undefined): string {
  const words = (value ?? '').replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Type not recorded';
}

export function cleanSearch(value: string): string {
  return value.trim().slice(0, SEARCH_MAX).trim();
}

export function listQuery(view: Pick<ActivityView, 'filter' | 'search' | 'sort' | 'page'>): string {
  const params = new URLSearchParams();
  if (view.filter !== DEFAULT_FILTER) params.set('filter', view.filter);
  if (view.search) params.set('search', view.search);
  params.set('sort', view.sort.key);
  params.set('dir', view.sort.dir);
  params.set('page', String(view.page));
  params.set('limit', String(PAGE_SIZE));
  return params.toString();
}

export function sameFilter(previousKey: string, nextKey: string): boolean {
  return new URLSearchParams(previousKey).get('filter') === new URLSearchParams(nextKey).get('filter');
}

export function isFiltered(view: Pick<ActivityView, 'filter' | 'search'>, searchText = view.search): boolean {
  return view.filter !== DEFAULT_FILTER || searchText.trim() !== '';
}

export function describeView(view: Pick<ActivityView, 'filter' | 'search'>): string {
  const parts = [filterLabel(view.filter)];
  if (view.search) parts.push(`search “${view.search}”`);
  return parts.join(' · ');
}

export function emptyCopy(view: Pick<ActivityView, 'filter' | 'search'>): EmptyCopy {
  if (view.search) {
    return {
      title: 'No users match this search',
      hint: 'Search by name, username, email, phone number or user ID, or clear the filters.',
    };
  }
  switch (view.filter) {
    case 'online':
      return {
        title: `Nobody was active in the last ${ONLINE_WINDOW_MINUTES} minutes`,
        hint: `Users appear here while the app is open on their phone. The app checks in about once a minute, and anyone seen in the last ${ONLINE_WINDOW_MINUTES} minutes counts as online, so someone who has just closed the app can still appear here.`,
      };
    case 'recent':
      return {
        title: `Nobody was active in the last ${RECENT_WINDOW_HOURS} hours`,
        hint: 'Users appear here once they open the app.',
      };
    case 'frozen':
      return { title: 'No frozen accounts', hint: 'Accounts frozen from the Users page appear here.' };
    case 'deleted':
      return { title: 'No deleted accounts', hint: 'Accounts that have been deleted appear here.' };
    case 'all':
      return { title: 'No users yet', hint: 'Customers appear here as soon as they sign up in the CardElite app.' };
  }
}

export function pauseReason(input: { manual: boolean; dialog: boolean; drawer: boolean }): PauseReason | null {
  if (input.dialog) return 'dialog';
  if (input.drawer) return 'drawer';
  if (input.manual) return 'manual';
  return null;
}

export function liveState(input: {
  paused: PauseReason | null;
  failing: boolean;
  updatedAt: number | null;
}): LiveState {
  const stamp = input.updatedAt === null
    ? null
    : `Updated ${formatBusinessTime(new Date(input.updatedAt))} ${BUSINESS_TZ_LABEL}`;
  switch (input.paused) {
    case 'dialog':
      return { tone: 'neutral', label: 'Paused while a confirmation is open', detail: stamp };
    case 'drawer':
      return { tone: 'neutral', label: 'Paused while a user is open', detail: stamp };
    case 'manual':
      return {
        tone: 'neutral',
        label: 'Paused',
        detail: stamp ? `${stamp} · resume to see new activity` : 'Resume to load new activity',
      };
    case null:
      break;
  }
  if (input.failing) {
    return {
      tone: 'warning',
      label: 'Reconnecting',
      detail: stamp ? `${stamp} · retrying every ${POLL_SECONDS} seconds` : `Retrying every ${POLL_SECONDS} seconds`,
    };
  }
  if (stamp === null) return { tone: 'neutral', label: 'Connecting', detail: null };
  return { tone: 'success', label: 'Live', detail: `${stamp} · refreshes every ${POLL_SECONDS} seconds` };
}
