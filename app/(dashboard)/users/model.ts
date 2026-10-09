import {
  combineCodecs, dateRangeParam, enumParam, intParam, sortParam, stringParam, uuidParam, type UrlCodecValue,
} from '../../_ui/useUrlState';
import type { ExportFiltersOption, ExportFormat, SortState, Tone } from '../../_ui';
import type { ApiBody } from '../../lib/apiClient';
import { FILTERS_RANGE_LABEL } from '../../lib/printExport';
import { formatAge, formatBusinessDate } from '../../lib/time';

export const PAGE_SIZE = 50;
export const SEARCH_MAX = 64;
export const DEFAULT_SORT: SortState = { key: 'created_at', dir: 'desc' };

export const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'deleted', label: 'Deleted' },
] as const;

export type StatusValue = (typeof STATUS_OPTIONS)[number]['value'];
export type StatusFilter = StatusValue | '';

export const USERS_URL = combineCodecs({
  search: stringParam('search', { maxLength: SEARCH_MAX }),
  status: enumParam('status', STATUS_OPTIONS.map((option) => option.value), ''),
  range: dateRangeParam(),
  sort: sortParam({ allowed: ['created_at', 'balance'], default: DEFAULT_SORT }),
  page: intParam('page', { min: 1, default: 1 }),
  id: uuidParam('id'),
});

export type UsersView = UrlCodecValue<typeof USERS_URL>;

export interface UserRow {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean | null;
  is_frozen: boolean | null;
  deleted_at?: string | null;
  created_at: string;
  balance: number | string | null;
  trades?: number | null;
  avatar_url?: string | null;
}

export interface UserSummary {
  total_users: number | null;
  new_today: number | null;
  frozen: number | null;
}

export interface SummaryState {
  data: UserSummary | null;
  error: string | null;
}

export interface UserList {
  users: UserRow[];
  total: number;
  sortFallback: boolean;
  tradesPartial: boolean;
  summary: SummaryState | null;
}

export interface ApiEnvelope {
  success?: boolean;
  error?: string;
  message?: string;
}

export interface ExportRow {
  id: string;
  full_name: string;
  username: string;
  email: string;
  phone: string;
  balance: number | string | null;
  trades: number | null;
  joined: string;
  joined_lagos?: string;
  status: string;
}

export interface ExportResponse extends ApiEnvelope {
  rows?: ExportRow[];
  total?: number;
  truncated?: boolean;
}

export interface ExportSpan {
  from: string | null;
  to: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readSummary(value: unknown): UserSummary | null {
  if (!isRecord(value)) return null;
  return {
    total_users: countOf(value.total_users),
    new_today: countOf(value.new_today),
    frozen: countOf(value.frozen),
  };
}

export function toListResult(body: ApiBody, withSummary: boolean): UserList | null {
  if (!Array.isArray(body.users)) return null;
  const partial = isRecord(body.partial) ? body.partial : null;
  return {
    users: body.users.filter((row): row is UserRow => isRecord(row) && typeof row.id === 'string'),
    total: Math.max(0, Number(body.total) || 0),
    sortFallback: body.sort_fallback === true,
    tradesPartial: text(partial?.trades) !== null,
    summary: withSummary ? { data: readSummary(body.summary), error: text(partial?.summary) } : null,
  };
}

export function cleanSearch(value: string): string {
  return value.trim().slice(0, SEARCH_MAX).trim();
}

export function statusFilterOf(value: string): StatusFilter {
  return STATUS_OPTIONS.find((option) => option.value === value)?.value ?? '';
}

function filterParams(view: UsersView, span: ExportSpan): URLSearchParams {
  const params = new URLSearchParams();
  if (view.search) params.set('search', view.search);
  if (view.status) params.set('status', view.status);
  if (span.from) params.set('date_from', span.from);
  if (span.to) params.set('date_to', span.to);
  params.set('sort', view.sort.key);
  params.set('dir', view.sort.dir);
  return params;
}

export function listQuery(view: UsersView): string {
  const params = filterParams(view, view.range);
  params.set('page', String(view.page));
  params.set('limit', String(PAGE_SIZE));
  return params.toString();
}

export function exportQuery(view: UsersView, span: ExportSpan, format: ExportFormat): string {
  const params = filterParams(view, span);
  params.set(format, '1');
  return params.toString();
}

export function isFiltered(view: UsersView, searchText: string): boolean {
  return searchText.trim() !== '' || Boolean(view.search || view.status || view.range.from || view.range.to);
}

export function describeFilters(view: Pick<UsersView, 'search' | 'status'>): string {
  const label = STATUS_OPTIONS.find((option) => option.value === view.status)?.label;
  const who = label ? `${label} users` : 'All users';
  return view.search ? `${who} matching “${view.search}”` : who;
}

export function exportFiltersFor(view: UsersView): ExportFiltersOption {
  return {
    label: FILTERS_RANGE_LABEL,
    description: describeFilters(view),
    from: view.range.from,
    to: view.range.to,
  };
}

export function messageOf(body: ApiEnvelope | null | undefined, fallback: string): string {
  return (body?.message || body?.error || '').trim() || fallback;
}

export function countText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-NG') : '—';
}

export function fullNameOf(user: Pick<UserRow, 'full_name'>): string | null {
  return (user.full_name || '').trim() || null;
}

export function handleOf(user: Pick<UserRow, 'username'>): string | null {
  return user.username ? `@${user.username}` : null;
}

export function accountStatus(user: Pick<UserRow, 'deleted_at' | 'is_frozen' | 'is_active'>): { label: string; tone: Tone } {
  if (user.deleted_at) return { label: 'Deleted', tone: 'neutral' };
  if (user.is_frozen) return { label: 'Frozen', tone: 'danger' };
  if (user.is_active) return { label: 'Active', tone: 'success' };
  return { label: 'Inactive', tone: 'neutral' };
}

export function tradesOf(user: Pick<UserRow, 'trades'>): number | null {
  return typeof user.trades === 'number' && Number.isFinite(user.trades) ? user.trades : null;
}

export function ageText(value: string, now?: Date): string {
  const age = formatAge(value, now);
  return age === '—' ? age : `${age} ago`;
}

export function joinedMeta(user: Pick<UserRow, 'created_at' | 'trades'>): string {
  const joined = `Joined ${formatBusinessDate(user.created_at)}`;
  const trades = tradesOf(user);
  if (trades === null) return joined;
  return `${joined} · ${trades.toLocaleString('en-NG')} ${trades === 1 ? 'trade' : 'trades'}`;
}
