import {
  combineCodecs, dateRangeParam, enumParam, intParam, sortParam, stringParam, urlParam, uuidParam,
  type UrlCodecValue,
} from '../../_ui/useUrlState';
import type { ExportFiltersOption, ExportFormat, SortState } from '../../_ui';
import type { ApiBody } from '../../lib/apiClient';
import { FILTERS_RANGE_LABEL } from '../../lib/printExport';
import { formatAge } from '../../lib/time';
import {
  PAGE_SIZE, RESULT_FILTERS, SEARCH_MAX, actionLabel, entityLabel, formatStamp, isActionKey, isEntityKey,
  resultFilterLabel, resultLabel,
  type ActivityEvent, type AdminInfo, type PrintableEvent,
} from './rules';

export const ACTIVITY_ENDPOINT = '/api/activity';
export const DEFAULT_SORT: SortState = { key: 'created_at', dir: 'desc' };

function cleanKey(raw: string | null | undefined, valid: (value: unknown) => value is string): string {
  const value = (raw ?? '').trim();
  return valid(value) ? value : '';
}

export const ACTIVITY_URL = combineCodecs({
  search: stringParam('search', { maxLength: SEARCH_MAX }),
  admin: uuidParam('admin'),
  action: urlParam<string>('action', {
    parse: (raw) => cleanKey(raw, isActionKey),
    format: (value) => cleanKey(value, isActionKey) || null,
  }),
  entity: urlParam<string>('entity', {
    parse: (raw) => cleanKey(raw, isEntityKey),
    format: (value) => cleanKey(value, isEntityKey) || null,
  }),
  result: enumParam('result', RESULT_FILTERS, ''),
  range: dateRangeParam(),
  sort: sortParam({ allowed: ['created_at'], default: DEFAULT_SORT }),
  page: intParam('page', { min: 1, default: 1 }),
  id: uuidParam('id'),
});

export type ActivityView = UrlCodecValue<typeof ACTIVITY_URL>;

export interface ExportSpan {
  from: string | null;
  to: string | null;
}

export interface ActivityList {
  events: ActivityEvent[];
  admins: AdminInfo[];
  total: number;
  searchCapped: boolean;
  targetsNote: string | null;
}

export interface ApiEnvelope {
  success?: boolean;
  error?: string;
  message?: string;
}

export interface ExportResponse extends ApiEnvelope {
  rows?: unknown;
  total?: unknown;
  truncated?: unknown;
}

export interface PrintBatch {
  rows: PrintableEvent[];
  total: number;
  truncated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readPrintable(value: Record<string, unknown>): PrintableEvent | null {
  const id = value.id;
  const createdAt = value.created_at;
  if (typeof id !== 'string' || typeof createdAt !== 'string') return null;
  return {
    id,
    admin_id: str(value.admin_id),
    admin_username: str(value.admin_username),
    admin_role_title: str(value.admin_role_title),
    admin_is_super: value.admin_is_super === true,
    admin_deleted: value.admin_deleted === true,
    action: str(value.action) ?? '',
    entity: str(value.entity),
    entity_id: str(value.entity_id),
    user_id: str(value.user_id),
    ip_address: str(value.ip_address),
    created_at: createdAt,
    target_username: str(value.target_username),
    target_label: str(value.target_label),
    admin_role: str(value.admin_role),
    user_agent: str(value.user_agent),
    request_id: str(value.request_id),
    reason: str(value.reason),
    result: str(value.result),
    error: str(value.error),
    sensitivity: str(value.sensitivity),
  };
}

export function readEvent(value: unknown): ActivityEvent | null {
  if (!isRecord(value)) return null;
  const base = readPrintable(value);
  if (!base) return null;
  return { ...base, before_value: value.before_value ?? null, after_value: value.after_value ?? null };
}

function readAdmin(value: unknown): AdminInfo | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  if (typeof id !== 'string') return null;
  return {
    id,
    username: str(value.username),
    role_title: str(value.role_title),
    is_super_admin: value.is_super_admin === true,
    is_active: value.is_active !== false,
    deleted_at: str(value.deleted_at),
  };
}

export function toListResult(body: ApiBody): ActivityList | null {
  if (!Array.isArray(body.activity)) return null;
  const partial = isRecord(body.partial) ? body.partial : null;
  return {
    events: body.activity.map(readEvent).filter((event): event is ActivityEvent => event !== null),
    admins: Array.isArray(body.admins)
      ? body.admins.map(readAdmin).filter((admin): admin is AdminInfo => admin !== null)
      : [],
    total: Math.max(0, Number(body.total) || 0),
    searchCapped: body.search_capped === true,
    targetsNote: str(partial?.targets),
  };
}

export function toEventResult(body: ApiBody): ActivityEvent | null {
  return readEvent(body.event);
}

export function toPrintBatch(body: ExportResponse | null): PrintBatch | null {
  if (!body || body.success === false || !Array.isArray(body.rows)) return null;
  const rows = body.rows
    .map((row) => (isRecord(row) ? readPrintable(row) : null))
    .filter((row): row is PrintableEvent => row !== null);
  return { rows, total: Math.max(rows.length, Number(body.total) || 0), truncated: body.truncated === true };
}

function filterParams(view: ActivityView, span: ExportSpan): URLSearchParams {
  const params = new URLSearchParams();
  if (view.search) params.set('search', view.search);
  if (view.admin) params.set('admin_id', view.admin);
  if (view.action) params.set('action', view.action);
  if (view.entity) params.set('entity', view.entity);
  if (view.result) params.set('result', view.result);
  if (span.from) params.set('date_from', span.from);
  if (span.to) params.set('date_to', span.to);
  if (view.sort.dir === 'asc') params.set('dir', 'asc');
  return params;
}

export function listQuery(view: ActivityView): string {
  const params = filterParams(view, view.range);
  params.set('page', String(view.page));
  params.set('limit', String(PAGE_SIZE));
  return params.toString();
}

export function exportQuery(view: ActivityView, span: ExportSpan, format: ExportFormat): string {
  const params = filterParams(view, span);
  params.set('export', format);
  return params.toString();
}

export function cleanSearch(value: string): string {
  return value.trim().slice(0, SEARCH_MAX).trim();
}

export function isFiltered(view: ActivityView, searchText: string): boolean {
  return searchText.trim() !== ''
    || Boolean(view.search || view.admin || view.action || view.entity || view.result || view.range.from || view.range.to);
}

export function adminHandle(username: string | null | undefined): string {
  return username ? `@${username}` : 'Unknown admin';
}

export function adminOptionLabel(admin: AdminInfo): string {
  const name = adminHandle(admin.username);
  if (admin.deleted_at) return `${name} (deleted admin)`;
  if (admin.is_active === false) return `${name} (inactive)`;
  return name;
}

export function describeFilters(view: ActivityView, admins: readonly AdminInfo[]): string {
  const admin = view.admin ? admins.find((candidate) => candidate.id === view.admin) : undefined;
  const parts = [view.admin ? (admin ? adminOptionLabel(admin) : 'One admin') : 'All admins'];
  if (view.action) parts.push(actionLabel(view.action));
  if (view.entity) parts.push(entityLabel(view.entity));
  if (view.result) parts.push(resultFilterLabel(view.result));
  if (view.search) parts.push(`search “${view.search}”`);
  return parts.join(' · ');
}

export function exportFiltersFor(view: ActivityView, admins: readonly AdminInfo[]): ExportFiltersOption {
  return {
    label: FILTERS_RANGE_LABEL,
    description: describeFilters(view, admins),
    from: view.range.from,
    to: view.range.to,
  };
}

export function messageOf(body: ApiEnvelope | null | undefined, fallback: string): string {
  return (body?.message || body?.error || '').trim() || fallback;
}

export function ageText(value: string, now?: Date): string {
  const age = formatAge(value, now);
  return age === '—' ? age : `${age} ago`;
}

export interface TargetSummary {
  primary: string;
  secondary: string | null;
}

export function targetSummary(
  event: Pick<ActivityEvent, 'entity' | 'target_label' | 'target_username'>,
): TargetSummary {
  const entity = entityLabel(event.entity);
  const handle = event.target_username ? `@${event.target_username}` : null;
  if (!event.target_label) {
    return { primary: entity || '—', secondary: handle };
  }
  const parts = [entity, handle && handle !== event.target_label ? handle : null].filter(Boolean);
  return { primary: event.target_label, secondary: parts.length > 0 ? parts.join(' · ') : null };
}

export function hasRecordedValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export const PRINT_COLUMNS = [
  'Time (WAT)', 'Admin', 'Action', 'Target', 'Result', 'Reason', 'IP address', 'Request ID',
];

export function printCells(row: PrintableEvent): string[] {
  const target = targetSummary(row);
  const admin = adminHandle(row.admin_username);
  return [
    formatStamp(row.created_at),
    row.admin_deleted ? `${admin} (deleted admin)` : admin,
    actionLabel(row.action),
    target.secondary ? `${target.primary} · ${target.secondary}` : target.primary,
    resultLabel(row.result),
    row.reason ?? '',
    row.ip_address ?? '',
    row.request_id ?? '',
  ];
}
