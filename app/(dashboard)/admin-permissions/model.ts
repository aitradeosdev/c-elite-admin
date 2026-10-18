import { combineCodecs, enumParam, stringParam, type UrlCodecValue } from '../../_ui/useUrlState';
import type { MobileDataListFlag } from '../../_ui/MobileDataList';
import type { ApiBody } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import {
  PERMISSION_CATEGORIES,
  isPermission,
  type Permission,
  type PermissionCategory,
  type PermissionRisk,
  type PermissionStatus,
} from '../../lib/permissions';
import { RISK_ORDER } from '../../lib/grants';
import { grantLabel, plural } from '../admin-accounts/model';

export const TITLE = 'Permissions';
export const PERMISSIONS_PATH = '/api/admin-permissions';
export const SEARCH_MAX = 64;
export const ROLES_SHOWN = 3;

export const DENIED_TITLE = 'Super administrators only';
export const DENIED_MESSAGE =
  'Permissions are managed by super administrators. Ask one if you need to know who holds a permission.';

export const NO_ROLES_TEXT = 'No role grants this permission.';
export const NO_DIRECT_TEXT = 'No admin holds this permission directly.';
export const NO_PAGES_TEXT = 'No page access includes this permission.';

export const FILTERED_EMPTY = {
  title: 'No permissions match these filters',
  hint: 'Try another search, category, risk or status, or clear the filters.',
};

export const CATALOG_EMPTY = {
  title: 'No permissions to show',
  hint: 'The permission catalog came back empty.',
};

export const STATUS_ORDER: readonly PermissionStatus[] = ['enforced', 'super_only', 'reserved'];

export const RISK_LABEL: Readonly<Record<PermissionRisk, string>> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const PERMISSIONS_URL = combineCodecs({
  search: stringParam('search', { maxLength: SEARCH_MAX }),
  category: enumParam('category', PERMISSION_CATEGORIES, ''),
  risk: enumParam('risk', RISK_ORDER, ''),
  status: enumParam('status', STATUS_ORDER, ''),
});

export type PermissionsView = UrlCodecValue<typeof PERMISSIONS_URL>;

export const NO_FILTERS: PermissionsView = { search: '', category: '', risk: '', status: '' };

export interface PermissionRole {
  id: string;
  name: string;
}

export interface PermissionAdmin {
  id: string;
  username: string;
}

export interface PermissionEntry {
  key: Permission;
  label: string;
  description: string;
  category: PermissionCategory;
  risk: PermissionRisk;
  status: PermissionStatus;
  legacy_pages: string[];
  roles: PermissionRole[];
  direct_admin_count: number;
  direct_admins: PermissionAdmin[];
}

export interface PermissionList {
  permissions: PermissionEntry[];
  superAdminCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function oneOf<V extends string>(values: readonly V[], value: unknown): V | null {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as V) : null;
}

function listOf<T>(value: unknown, parse: (raw: unknown) => T | null): T[] {
  return (Array.isArray(value) ? value : []).map(parse).filter((item): item is T => item !== null);
}

function toRole(raw: unknown): PermissionRole | null {
  if (!isRecord(raw) || !isUuid(raw.id) || typeof raw.name !== 'string') return null;
  return { id: raw.id.toLowerCase(), name: raw.name };
}

function toAdmin(raw: unknown): PermissionAdmin | null {
  if (!isRecord(raw) || !isUuid(raw.id)) return null;
  return { id: raw.id.toLowerCase(), username: textOf(raw.username) };
}

function toPage(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

export function toPermissionEntry(raw: unknown): PermissionEntry | null {
  if (!isRecord(raw)) return null;
  const key = raw.key;
  const category = oneOf(PERMISSION_CATEGORIES, raw.category);
  const risk = oneOf(RISK_ORDER, raw.risk);
  const status = oneOf(STATUS_ORDER, raw.status);
  if (typeof key !== 'string' || !isPermission(key) || !category || !risk || !status) return null;
  return {
    key,
    label: textOf(raw.label) || key,
    description: textOf(raw.description),
    category,
    risk,
    status,
    legacy_pages: listOf(raw.legacy_pages, toPage),
    roles: listOf(raw.roles, toRole),
    direct_admin_count: count(raw.direct_admin_count),
    direct_admins: listOf(raw.direct_admins, toAdmin),
  };
}

export function toPermissionList(body: ApiBody): PermissionList | null {
  if (!Array.isArray(body.permissions)) return null;
  return {
    permissions: listOf(body.permissions, toPermissionEntry),
    superAdminCount: count(body.super_admin_count),
  };
}

function choice<V extends string>(values: readonly V[], value: string): V | '' {
  return oneOf(values, value) ?? '';
}

export function categoryFilter(value: string): PermissionCategory | '' {
  return choice(PERMISSION_CATEGORIES, value);
}

export function riskFilter(value: string): PermissionRisk | '' {
  return choice(RISK_ORDER, value);
}

export function statusFilter(value: string): PermissionStatus | '' {
  return choice(STATUS_ORDER, value);
}

export function cleanSearch(value: string): string {
  return value.trim().slice(0, SEARCH_MAX).trim();
}

export function matchesSearch(entry: Pick<PermissionEntry, 'key' | 'label' | 'description'>, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [entry.key, entry.label, entry.description].some((field) => field.toLowerCase().includes(needle));
}

export function visiblePermissions(entries: readonly PermissionEntry[], view: PermissionsView): PermissionEntry[] {
  return entries.filter((entry) => (view.category === '' || entry.category === view.category)
    && (view.risk === '' || entry.risk === view.risk)
    && (view.status === '' || entry.status === view.status)
    && matchesSearch(entry, view.search));
}

export function isFiltered(view: PermissionsView, searchText: string): boolean {
  return searchText.trim() !== '' || view.search !== '' || view.category !== '' || view.risk !== '' || view.status !== '';
}

export function superAdminLine(superAdmins: number | null): string {
  const line = 'Super administrators hold every permission';
  return superAdmins === null ? line : `${line} (${superAdmins.toLocaleString('en-NG')})`;
}

export function rolesPreview(roles: readonly PermissionRole[], shown: number = ROLES_SHOWN): string {
  const names = roles.map((role) => role.name);
  if (names.length <= shown) return names.join(', ');
  return `${names.slice(0, shown).join(', ')} +${(names.length - shown).toLocaleString('en-NG')}`;
}

export function directAdminsText(admins: number): string {
  return `${plural(admins, 'admin')} directly assigned`;
}

export function mobileMeta(entry: Pick<PermissionEntry, 'category' | 'roles' | 'direct_admin_count'>): string {
  const roles = entry.roles.length ? plural(entry.roles.length, 'role') : 'No roles';
  return [entry.category, roles, directAdminsText(entry.direct_admin_count)].join(' · ');
}

export function pageAccessLine(page: string): string {
  return `Comes with ${grantLabel(page)} page access`;
}

export function isHighRisk(risk: PermissionRisk): boolean {
  return risk === 'critical' || risk === 'high';
}

export function highRiskFlag(risk: PermissionRisk): MobileDataListFlag | null {
  if (risk === 'critical') return 'danger';
  return risk === 'high' ? 'warning' : null;
}
