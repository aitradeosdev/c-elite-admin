import { NAV_GROUPS } from '../_shell/nav';
import {
  ALL_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  isPermission,
  permissionStatus,
  resolvePermissions,
  type Permission,
  type PermissionCategory,
  type PermissionRisk,
} from '../../lib/permissions';
import type { ApiBody, ApiFailure, ApiResult } from '../../lib/apiClient';
import { isUuid, twoStepUnlockText } from '../../lib/http';
import { graceText, isLockActive, toTwoStepStatus, type TwoStepStatus } from '../../lib/adminSecurity';
import { foldIntoRole } from '../../lib/grants';
import { REASON_MESSAGE, REASON_MIN, assignableRole, parseRoleRow, type RoleRow } from '../../lib/roles';
import { SecurityRequestError, reauthenticate } from '../../_security/reauth';
import { combineCodecs, enumParam, uuidParam } from '../../_ui/useUrlState';
import type { SortState } from '../../_ui/useTableSort';
import type { StatTone, Tone } from '../../_ui/Status';
import {
  ADDITIONAL_PERMISSIONS,
  PAGE_KEYS,
  ROLE_TITLE_MAX,
  ROLE_TITLE_MIN,
  checkPassword,
  checkRoleTitle,
  checkUsername,
  effectiveActions,
  grantKind,
  grantRisk,
  grantedActions,
  highestRisk,
  isEmail,
  normalizeGrants,
  sameGrants,
  sortGrants,
  type EditExpectation,
} from './rules';

export interface AdminSecurity {
  mfaStatus: TwoStepStatus;
  confirmedAt: string | null;
  lockedUntil: string | null;
  lastUsedAt: string | null;
  recoveryCodesLeft: number;
  liveSessions: number;
  lastSeenAt: string | null;
}

export interface AdminRoleRef {
  id: string;
  name: string | null;
  archived: boolean;
}

export interface AdminRow {
  id: string;
  username: string;
  email: string | null;
  role_title: string;
  page_permissions: string[];
  role_id: string | null;
  role: AdminRoleRef | null;
  direct_permissions: string[];
  last_login_at: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  deleted_at: string | null;
  created_at: string | null;
  security: AdminSecurity | null;
}

export type PolicyMode = 'off' | 'all';

export interface SecurityPolicy {
  mode: PolicyMode;
  graceEndsAt: string | null;
  requiredNow: boolean;
}

export const POLICY_OFF: SecurityPolicy = Object.freeze({ mode: 'off', graceEndsAt: null, requiredNow: false });

export interface AdminList {
  admins: AdminRow[];
  currentAdminId: string | null;
  policy: SecurityPolicy;
  actorTwoStep: TwoStepStatus | null;
  securityLoaded: boolean;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function idOf(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

function isTwoStepStatus(value: unknown): value is TwoStepStatus {
  return value === 'none' || value === 'pending' || value === 'active';
}

function toAdminSecurity(row: Record<string, unknown>): AdminSecurity | null {
  if (!isTwoStepStatus(row.mfa_status)) return null;
  return {
    mfaStatus: toTwoStepStatus(row.mfa_status),
    confirmedAt: text(row.mfa_confirmed_at),
    lockedUntil: text(row.mfa_locked_until),
    lastUsedAt: text(row.mfa_last_used_at),
    recoveryCodesLeft: countOf(row.recovery_codes_left),
    liveSessions: countOf(row.live_sessions),
    lastSeenAt: text(row.last_seen_at),
  };
}

function toRoleRef(value: unknown): AdminRoleRef | null {
  if (!isRecord(value)) return null;
  const id = idOf(value.id);
  if (!id) return null;
  return { id, name: text(value.name), archived: value.archived === true };
}

export function toSecurityPolicy(raw: unknown): SecurityPolicy {
  if (!isRecord(raw)) return POLICY_OFF;
  const mode: PolicyMode = raw.mfa_mode === 'all' ? 'all' : 'off';
  return {
    mode,
    graceEndsAt: mode === 'all' ? text(raw.mfa_grace_ends_at) : null,
    requiredNow: mode === 'all' && raw.mfa_required_now === true,
  };
}

export function toAdminRow(row: unknown): AdminRow | null {
  if (!isRecord(row)) return null;
  const id = text(row.id);
  if (!id) return null;
  return {
    id: id.toLowerCase(),
    username: typeof row.username === 'string' ? row.username : '',
    email: text(row.email),
    role_title: typeof row.role_title === 'string' ? row.role_title : '',
    page_permissions: Array.isArray(row.page_permissions) ? normalizeGrants(row.page_permissions) : [],
    role_id: idOf(row.role_id),
    role: toRoleRef(row.role),
    direct_permissions: Array.isArray(row.direct_permissions) ? normalizeGrants(row.direct_permissions) : [],
    last_login_at: text(row.last_login_at),
    is_active: row.is_active === true,
    is_super_admin: row.is_super_admin === true,
    deleted_at: text(row.deleted_at),
    created_at: text(row.created_at),
    security: toAdminSecurity(row),
  };
}

export function toAdminList(body: ApiBody): AdminList | null {
  if (!Array.isArray(body.admins)) return null;
  const admins = body.admins.map(toAdminRow).filter((row): row is AdminRow => row !== null);
  const current = text(body.current_admin_id);
  const security = isRecord(body.security) ? body.security : null;
  return {
    admins,
    currentAdminId: current ? current.toLowerCase() : null,
    policy: toSecurityPolicy(security),
    actorTwoStep: security && isTwoStepStatus(security.actor_mfa_status) ? security.actor_mfa_status : null,
    securityLoaded: security?.status_loaded === true,
  };
}

export function withAdmin(list: AdminList | undefined, admin: AdminRow): AdminList | undefined {
  if (!list) return list;
  const index = list.admins.findIndex((row) => row.id === admin.id);
  if (index === -1) return { ...list, admins: [...list.admins, admin] };
  const previous = list.admins[index];
  const merged = admin.security === null && previous.security !== null ? { ...admin, security: previous.security } : admin;
  return { ...list, admins: list.admins.map((row, at) => (at === index ? merged : row)) };
}

export function adminHandle(admin: { username: string } | null | undefined): string {
  const name = admin?.username?.trim();
  return name ? `@${name}` : 'this admin';
}

export const SUPER_ADMIN_ROLE_LABEL = 'Super administrator';
export const NO_ROLE_LABEL = 'No role';
export const UNNAMED_ROLE_LABEL = 'Unnamed role';

export function roleLabel(admin: Pick<AdminRow, 'is_super_admin' | 'role_id' | 'role'>): string {
  if (admin.is_super_admin) return SUPER_ADMIN_ROLE_LABEL;
  if (admin.role) return admin.role.name ?? UNNAMED_ROLE_LABEL;
  return admin.role_id ? UNNAMED_ROLE_LABEL : NO_ROLE_LABEL;
}

export type AdminStatus = 'active' | 'inactive' | 'deleted';

export type StatusTab = 'all' | AdminStatus;

export const STATUS_TAB_VALUES: readonly StatusTab[] = ['all', 'active', 'inactive', 'deleted'];

export const STATUS_LABEL: Readonly<Record<AdminStatus, string>> = {
  active: 'Active',
  inactive: 'Inactive',
  deleted: 'Deleted',
};

export const STATUS_TONE: Readonly<Record<AdminStatus, Tone>> = {
  active: 'success',
  inactive: 'neutral',
  deleted: 'danger',
};

export const STATUS_TABS: ReadonlyArray<{ value: StatusTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: STATUS_LABEL.active },
  { value: 'inactive', label: STATUS_LABEL.inactive },
  { value: 'deleted', label: STATUS_LABEL.deleted },
];

export function statusOf(admin: AdminRow): AdminStatus {
  if (admin.deleted_at) return 'deleted';
  return admin.is_active ? 'active' : 'inactive';
}

export function tabCounts(admins: readonly AdminRow[]): Record<StatusTab, number> {
  const counts: Record<StatusTab, number> = { all: admins.length, active: 0, inactive: 0, deleted: 0 };
  for (const admin of admins) counts[statusOf(admin)] += 1;
  return counts;
}

export function matchesQuery(admin: AdminRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [admin.username, admin.email ?? '', admin.role_title].some((value) => value.toLowerCase().includes(needle));
}

export const SORT_KEYS = ['username', 'last_login_at'] as const;

function compareAdmins(a: AdminRow, b: AdminRow, sort: SortState): number {
  if (sort.key === 'last_login_at') {
    if (!a.last_login_at && !b.last_login_at) return 0;
    if (!a.last_login_at) return 1;
    if (!b.last_login_at) return -1;
    const delta = Date.parse(a.last_login_at) - Date.parse(b.last_login_at);
    return sort.dir === 'asc' ? delta : -delta;
  }
  const delta = a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });
  return sort.dir === 'asc' ? delta : -delta;
}

export function visibleAdmins(
  admins: readonly AdminRow[],
  tab: StatusTab,
  query: string,
  sort: SortState | null,
): AdminRow[] {
  const rows = admins.filter((admin) => (tab === 'all' || statusOf(admin) === tab) && matchesQuery(admin, query));
  if (!sort || !(SORT_KEYS as readonly string[]).includes(sort.key)) return rows;
  return rows
    .map((admin, index) => ({ admin, index }))
    .sort((a, b) => compareAdmins(a.admin, b.admin, sort) || a.index - b.index)
    .map((entry) => entry.admin);
}

export interface AdminCapabilities {
  edit: boolean;
  revoke: boolean;
  deactivate: boolean;
  reactivate: boolean;
  remove: boolean;
  resetMfa: boolean;
}

const NO_CAPABILITIES: AdminCapabilities = {
  edit: false, revoke: false, deactivate: false, reactivate: false, remove: false, resetMfa: false,
};

export function isSelf(admin: AdminRow, currentAdminId: string | null): boolean {
  return currentAdminId !== null && admin.id === currentAdminId;
}

export function capabilitiesFor(admin: AdminRow, currentAdminId: string | null): AdminCapabilities {
  if (admin.deleted_at) return NO_CAPABILITIES;
  const self = isSelf(admin, currentAdminId);
  return {
    edit: !admin.is_super_admin,
    revoke: admin.is_active && !self,
    deactivate: admin.is_active && !self,
    reactivate: !admin.is_active,
    remove: !admin.is_active && !admin.is_super_admin,
    resetMfa: !self && admin.security?.mfaStatus === 'active',
  };
}

export function hasRowActions(capabilities: AdminCapabilities): boolean {
  return capabilities.revoke || capabilities.deactivate || capabilities.reactivate || capabilities.remove
    || capabilities.resetMfa;
}

export const ACTOR_TWO_STEP_FIRST = 'Set up two-step sign-in on your Profile first.';
export const OWN_RESET_TEXT = 'You cannot reset your own two-step sign-in. Another super administrator has to do it.';
export const PROFILE_HREF = '/profile';
export const PROFILE_TWO_STEP_HREF = '/profile#two-step-sign-in';
export const TWO_STEP_SETTINGS_HREF = '/admin-settings#admin-two-step';

export function actorCanReset(actorTwoStep: TwoStepStatus | null): boolean {
  return actorTwoStep === 'active';
}

export function resetBlockedText(admin: AdminRow, self: boolean): string {
  const handle = adminHandle(admin);
  if (admin.deleted_at) return `${handle} was deleted, so nothing was changed.`;
  if (self) return OWN_RESET_TEXT;
  if (!admin.security) return 'Two-step sign-in could not be checked, so nothing was changed. Refresh and try again.';
  return `${handle} does not use two-step sign-in now, so there is nothing to reset.`;
}

export type PolicyRequirement =
  | { kind: 'none' }
  | { kind: 'grace'; shortDate: string; date: string; dateTime: string }
  | { kind: 'required' };

export function policyRequirement(policy: SecurityPolicy, now: Date = new Date()): PolicyRequirement {
  if (policy.mode !== 'all') return { kind: 'none' };
  const grace = graceText(policy.graceEndsAt, now);
  if (policy.requiredNow || !grace || grace.overdue) return { kind: 'required' };
  return { kind: 'grace', shortDate: grace.shortDate, date: grace.date, dateTime: grace.dateTime };
}

export type MfaCellState =
  | { kind: 'deleted' }
  | { kind: 'unknown' }
  | { kind: 'on'; codesLeft: number }
  | { kind: 'locked'; until: string | null }
  | { kind: 'pending' }
  | { kind: 'off'; due: 'none' }
  | { kind: 'off'; due: 'grace'; date: string }
  | { kind: 'off'; due: 'required' };

export function mfaCellState(admin: AdminRow, policy: SecurityPolicy, now: Date = new Date()): MfaCellState {
  if (admin.deleted_at) return { kind: 'deleted' };
  const security = admin.security;
  if (!security) return { kind: 'unknown' };
  if (security.mfaStatus === 'active') {
    return isLockActive(security.lockedUntil, now)
      ? { kind: 'locked', until: twoStepUnlockText(security.lockedUntil, now.getTime()) }
      : { kind: 'on', codesLeft: security.recoveryCodesLeft };
  }
  if (security.mfaStatus === 'pending') return { kind: 'pending' };
  if (!admin.is_active) return { kind: 'off', due: 'none' };
  const requirement = policyRequirement(policy, now);
  if (requirement.kind === 'grace') return { kind: 'off', due: 'grace', date: requirement.shortDate };
  if (requirement.kind === 'required') return { kind: 'off', due: 'required' };
  return { kind: 'off', due: 'none' };
}

export function codesLeftLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return 'No recovery codes left';
  return count === 1 ? '1 recovery code' : `${Math.floor(count).toLocaleString('en-NG')} recovery codes`;
}

export interface TwoStepStats {
  active: number;
  enrolled: number;
  missing: number;
  known: boolean;
}

export function twoStepStats(admins: readonly AdminRow[]): TwoStepStats {
  let active = 0;
  let enrolled = 0;
  let known = true;
  for (const admin of admins) {
    if (admin.deleted_at || !admin.is_active) continue;
    active += 1;
    if (!admin.security) known = false;
    else if (admin.security.mfaStatus === 'active') enrolled += 1;
  }
  return { active, enrolled, missing: active - enrolled, known };
}

export interface TwoStepStat {
  value: string;
  hint: string;
  tone: StatTone | undefined;
  unavailable: boolean;
}

export const TWO_STEP_STAT_UNAVAILABLE = 'Two-step sign-in status could not be loaded.';

export function twoStepStat(
  stats: TwoStepStats,
  policy: SecurityPolicy,
  loaded: boolean,
  now: Date = new Date(),
): TwoStepStat {
  const requirement = policyRequirement(policy, now);
  const hint = requirement.kind === 'grace'
    ? `active admins · required from ${requirement.shortDate}`
    : requirement.kind === 'required'
      ? 'active admins · required now'
      : 'active admins';
  const tone: StatTone | undefined = stats.missing > 0 && requirement.kind !== 'none'
    ? requirement.kind === 'required' ? 'danger' : 'warning'
    : undefined;
  return {
    value: `${stats.enrolled.toLocaleString('en-NG')} of ${stats.active.toLocaleString('en-NG')}`,
    hint,
    tone,
    unavailable: !loaded || !stats.known,
  };
}

export const ADMIN_PANELS = ['account', 'security'] as const;

export type AdminPanel = (typeof ADMIN_PANELS)[number];

export const ADMINS_URL = combineCodecs({
  tab: enumParam('status', STATUS_TAB_VALUES, 'all'),
  id: uuidParam('id'),
  panel: enumParam('panel', ADMIN_PANELS, 'account'),
});

export function hasSecurityPanel(admin: AdminRow): boolean {
  return !admin.deleted_at;
}

export function adminSecurityHref(id: string): string {
  return `/admin-accounts?id=${encodeURIComponent(id)}&panel=security`;
}

export function adminMfaPath(id: string): string {
  return `/api/admin-accounts/${encodeURIComponent(id)}/mfa`;
}

export function adminSessionsPath(id: string): string {
  return `/api/admin-accounts/${encodeURIComponent(id)}/sessions`;
}

export function adminSessionPath(id: string, sessionId: string): string {
  return `${adminSessionsPath(id)}/${encodeURIComponent(sessionId)}`;
}

export function accessPath(id: string): string {
  return `/api/admin-accounts/${encodeURIComponent(id)}/access`;
}

export type RowActionKind = 'revoke' | 'deactivate' | 'reactivate' | 'remove';

export function allowsAction(capabilities: AdminCapabilities, kind: RowActionKind): boolean {
  return capabilities[kind];
}

export interface MutationRequest {
  method: 'PATCH' | 'DELETE';
  body: Record<string, unknown>;
}

export function rowActionRequest(kind: RowActionKind, admin: AdminRow, reason: string): MutationRequest {
  switch (kind) {
    case 'revoke':
      return { method: 'PATCH', body: { id: admin.id, revoke_sessions: true, reason } };
    case 'deactivate':
      return { method: 'PATCH', body: { id: admin.id, is_active: false, reason } };
    case 'reactivate':
      return { method: 'PATCH', body: { id: admin.id, is_active: true, reason } };
    case 'remove':
      return { method: 'DELETE', body: { id: admin.id, reason } };
  }
}

export interface GrantNote {
  tone: 'info' | 'warning';
  text: string;
}

export interface PageGrantSpec {
  key: string;
  label: string;
  actions: readonly Permission[];
  risk: PermissionRisk | null;
  notes: readonly GrantNote[];
}

export interface PageGrantGroup {
  label: string;
  grants: readonly PageGrantSpec[];
}

export const SUPER_ADMIN_ONLY_ROUTES: Readonly<Record<string, string>> = {
  limits_fees: 'limits-fees',
  admin_settings: 'admin-settings',
  user_activity_monitor: 'user-activity-monitor',
};

const PAGE_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  users_freeze: 'Freeze & unfreeze users',
};

const PLACED_AFTER: Readonly<Record<string, string>> = {
  users_freeze: 'users',
};

const info = (value: string): GrantNote => ({ tone: 'info', text: value });

const PAGE_NOTES: Readonly<Record<string, readonly GrantNote[]>> = {
  dashboard: [info('Adds Dashboard to the menu. Every admin can open the dashboard, and it only shows the metrics their other grants allow.')],
  card_queue: [info('Also sends card queue alerts to this admin.')],
  withdrawals: [info('Also sends withdrawal and flagged-transaction alerts. The payout service checks this key before it sends money.')],
  transactions_overview: [info('Also sends flagged-transaction alerts to this admin.')],
  users: [info('Does not include freezing accounts. Grant Freeze & unfreeze users as well for that.')],
  users_freeze: [info('Not a menu page. Adds Freeze and Unfreeze to user profiles, so it needs Users as well.')],
  user_activity_monitor: [info('Also shows the user activity metrics, such as Users online, on the dashboard.')],
};

function humanizeKey(key: string): string {
  const words = key.replace(/[._]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

const NAV_LABELS: ReadonlyMap<string, string> = (() => {
  const labels = new Map<string, string[]>();
  for (const group of NAV_GROUPS) {
    for (const leaf of group.items) {
      const list = labels.get(leaf.key);
      if (!list) labels.set(leaf.key, [leaf.label]);
      else if (!list.includes(leaf.label)) list.push(leaf.label);
    }
  }
  return new Map(Array.from(labels, ([key, list]) => [key, list.join(' & ')] as const));
})();

export function pageLabel(key: string): string {
  return PAGE_LABEL_OVERRIDES[key] ?? NAV_LABELS.get(key) ?? humanizeKey(key);
}

export function grantLabel(key: string): string {
  if (isPermission(key)) return PERMISSION_CATALOG[key].label;
  const kind = grantKind(key);
  if (kind === 'page' || kind === 'restricted' || kind === 'retired') return pageLabel(key);
  return key;
}

function pageSpec(key: string): PageGrantSpec {
  const label = pageLabel(key);
  const restricted = SUPER_ADMIN_ONLY_ROUTES[key]
    ? [{
        tone: 'warning' as const,
        text: `${label} only opens for super administrators for now, so this grant adds it to the menu but does not open the page.`,
      }]
    : [];
  return {
    key,
    label,
    actions: grantedActions(key),
    risk: grantRisk(key),
    notes: [...(PAGE_NOTES[key] ?? []), ...restricted],
  };
}

const GRANTABLE_PAGES: readonly string[] = PAGE_KEYS.filter((key) =>
  LEGACY_PERMISSION_MAP[key].every((permission) => permissionStatus(permission) !== 'super_only'));

export const PAGE_GRANT_GROUPS: readonly PageGrantGroup[] = (() => {
  const grantable = new Set(GRANTABLE_PAGES);
  const placed = new Set<string>();
  const groups: PageGrantGroup[] = [];
  for (const group of NAV_GROUPS) {
    const keys: string[] = [];
    for (const leaf of group.items) {
      if (!grantable.has(leaf.key) || placed.has(leaf.key)) continue;
      keys.push(leaf.key);
      placed.add(leaf.key);
      for (const [extra, anchor] of Object.entries(PLACED_AFTER)) {
        if (anchor !== leaf.key || !grantable.has(extra) || placed.has(extra)) continue;
        keys.push(extra);
        placed.add(extra);
      }
    }
    if (keys.length) groups.push({ label: group.label, grants: keys.map(pageSpec) });
  }
  const rest = GRANTABLE_PAGES.filter((key) => !placed.has(key));
  if (rest.length) groups.push({ label: 'Other pages', grants: rest.map(pageSpec) });
  return groups;
})();

export const ENFORCED_ADDITIONAL: readonly Permission[] = ADDITIONAL_PERMISSIONS.filter(
  (key) => permissionStatus(key) === 'enforced',
);

export interface AdditionalGrantSpec {
  key: Permission;
  label: string;
  description: string;
  risk: PermissionRisk;
  enforced: boolean;
}

export interface AdditionalGrantGroup {
  category: PermissionCategory;
  grants: readonly AdditionalGrantSpec[];
}

const ENFORCED: ReadonlySet<Permission> = new Set(ENFORCED_ADDITIONAL);

function groupAdditional(keys: readonly Permission[]): AdditionalGrantGroup[] {
  return PERMISSION_CATEGORIES.map((category) => ({
    category,
    grants: keys
      .filter((key) => PERMISSION_CATALOG[key].category === category)
      .map((key) => ({
        key,
        label: PERMISSION_CATALOG[key].label,
        description: PERMISSION_CATALOG[key].description,
        risk: PERMISSION_CATALOG[key].risk,
        enforced: ENFORCED.has(key),
      })),
  })).filter((group) => group.grants.length > 0);
}

export const ENFORCED_ADDITIONAL_GROUPS: readonly AdditionalGrantGroup[] =
  groupAdditional(ADDITIONAL_PERMISSIONS.filter((key) => ENFORCED.has(key)));

export const RESERVED_ADDITIONAL_GROUPS: readonly AdditionalGrantGroup[] =
  groupAdditional(ADDITIONAL_PERMISSIONS.filter((key) => !ENFORCED.has(key)));

export const RESERVED_ADDITIONAL: readonly Permission[] = ADDITIONAL_PERMISSIONS.filter((key) => !ENFORCED.has(key));

export type ExtraKind = 'restricted' | 'retired' | 'unknown';

export interface ExtraGrantSpec {
  key: string;
  kind: ExtraKind;
  label: string;
  note: string;
}

const RETIRED_NOTES: Readonly<Record<string, string>> = {
  manual_wallet_credit: 'Nothing in the console checks this key.',
  field_builder: 'Nothing checks this key. Field Builder access comes from the Field Builder grant.',
  feature_overrides: 'Nothing checks this key. Feature overrides were removed.',
  flagged_transactions: 'Nothing checks this key. Use the View flagged transactions permission instead.',
  giftbox: 'Nothing checks this key. The giftbox is part of the Bonuses & Levels grant.',
};

const RESTRICTED_NOTE =
  'Managing admins is for super administrators only, so this key cannot be granted here. It adds Admins to the menu and the admin count to the dashboard. Untick it to remove it.';

const UNKNOWN_NOTE = 'Not a recognised permission key, so the account cannot be saved with it. Untick it to remove it.';

export function extraGrants(keys: Iterable<string>): ExtraGrantSpec[] {
  const out: ExtraGrantSpec[] = [];
  for (const key of sortGrants(new Set(keys))) {
    const kind = grantKind(key);
    if (kind === 'restricted') out.push({ key, kind, label: pageLabel(key), note: RESTRICTED_NOTE });
    else if (kind === 'retired') out.push({ key, kind, label: pageLabel(key), note: RETIRED_NOTES[key] ?? RETIRED_NOTES.manual_wallet_credit });
    else if (kind === 'unknown') out.push({ key, kind, label: key, note: UNKNOWN_NOTE });
  }
  return out;
}

export function holdsReserved(keys: readonly string[]): boolean {
  const reserved = new Set<string>(RESERVED_ADDITIONAL);
  return keys.some((key) => reserved.has(key));
}

export interface AccessSummary {
  pages: number;
  additional: number;
  other: number;
  actions: number;
  critical: number;
  highest: PermissionRisk | null;
  labels: string[];
}

export function accessSummary(keys: readonly string[]): AccessSummary {
  let pages = 0;
  let additional = 0;
  let other = 0;
  const labels: string[] = [];
  for (const key of sortGrants(new Set(keys))) {
    const kind = grantKind(key);
    if (kind === 'page' || kind === 'restricted') {
      pages += 1;
      labels.push(grantLabel(key));
    } else if (kind === 'additional' || isPermission(key)) {
      additional += 1;
      labels.push(grantLabel(key));
    } else {
      other += 1;
    }
  }
  const actions = effectiveActions(keys);
  let critical = 0;
  for (const action of actions) if (PERMISSION_CATALOG[action].risk === 'critical') critical += 1;
  return { pages, additional, other, actions: actions.size, critical, highest: highestRisk(actions), labels };
}

export function holdsCritical(admin: AdminRow): boolean {
  if (admin.is_super_admin) return false;
  return accessSummary(admin.page_permissions).critical > 0;
}

export interface AdminStats {
  active: number;
  inactive: number;
  superAdmins: number;
  activeSuperAdmins: number;
  critical: number;
}

export function adminStats(admins: readonly AdminRow[]): AdminStats {
  const stats: AdminStats = { active: 0, inactive: 0, superAdmins: 0, activeSuperAdmins: 0, critical: 0 };
  for (const admin of admins) {
    if (admin.deleted_at) continue;
    if (admin.is_active) stats.active += 1;
    else stats.inactive += 1;
    if (admin.is_super_admin) {
      stats.superAdmins += 1;
      if (admin.is_active) stats.activeSuperAdmins += 1;
    } else if (admin.is_active && holdsCritical(admin)) {
      stats.critical += 1;
    }
  }
  return stats;
}

export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? one : many}`;
}

export type EditorMode = 'create' | 'edit';

export interface EditorDraft {
  username: string;
  email: string;
  roleTitle: string;
  password: string;
  confirmPassword: string;
}

export interface EditableValues {
  email: string;
  roleTitle: string;
}

export const EMPTY_DRAFT: EditorDraft = {
  username: '',
  email: '',
  roleTitle: '',
  password: '',
  confirmPassword: '',
};

export function valuesOf(admin: AdminRow): EditableValues {
  return { email: admin.email ?? '', roleTitle: admin.role_title };
}

export function draftFor(admin: AdminRow | null): EditorDraft {
  if (!admin) return EMPTY_DRAFT;
  return { ...EMPTY_DRAFT, username: admin.username, ...valuesOf(admin) };
}

export type EditorField = 'username' | 'email' | 'roleTitle' | 'password' | 'confirmPassword';

export const EDITOR_FIELD_ORDER: readonly EditorField[] = [
  'username',
  'email',
  'roleTitle',
  'password',
  'confirmPassword',
];

export type EditorErrors = Partial<Record<EditorField, string>>;

export const TITLE_LENGTH_MESSAGE = `Title must be ${ROLE_TITLE_MIN}–${ROLE_TITLE_MAX} characters.`;

export function validateDraft(mode: EditorMode, draft: EditorDraft): EditorErrors {
  const errors: EditorErrors = {};
  if (mode === 'create') {
    const username = draft.username.trim();
    const problem = username ? checkUsername(username) : 'Enter a username.';
    if (problem) errors.username = problem;
  }
  const email = draft.email.trim();
  if (!email) errors.email = 'Enter an email address. Admins sign in with it and receive security alerts there.';
  else if (!isEmail(email)) errors.email = 'Enter a valid email address.';
  const title = draft.roleTitle.trim();
  if (!title) errors.roleTitle = 'Enter a title.';
  else if (checkRoleTitle(title)) errors.roleTitle = TITLE_LENGTH_MESSAGE;
  if (mode === 'create' || draft.password !== '') {
    const passwordProblem = checkPassword(draft.password);
    if (passwordProblem) errors.password = passwordProblem;
  }
  if (draft.password !== '' && draft.confirmPassword !== draft.password) {
    errors.confirmPassword = 'The passwords do not match.';
  }
  return errors;
}

export function firstError(errors: EditorErrors): EditorField | null {
  return EDITOR_FIELD_ORDER.find((field) => errors[field]) ?? null;
}

export function isDraftDirty(mode: EditorMode, draft: EditorDraft, base: EditableValues): boolean {
  if (draft.password !== '' || draft.confirmPassword !== '') return true;
  if (mode === 'create' && draft.username.trim() !== '') return true;
  return draft.email.trim() !== base.email.trim() || draft.roleTitle.trim() !== base.roleTitle.trim();
}

export type ConflictField = 'email' | 'roleTitle';

export interface RebaseResult {
  values: EditableValues;
  conflicts: ConflictField[];
  changedElsewhere: boolean;
}

export function rebaseValues(base: EditableValues, local: EditableValues, server: EditableValues): RebaseResult {
  const conflicts: ConflictField[] = [];
  const pick = (field: ConflictField): string => {
    const mine = local[field].trim() !== base[field].trim();
    const theirs = server[field].trim() !== base[field].trim();
    if (!mine) return server[field];
    if (theirs && server[field].trim() !== local[field].trim()) conflicts.push(field);
    return local[field];
  };
  const email = pick('email');
  const roleTitle = pick('roleTitle');
  return {
    values: { email, roleTitle },
    conflicts,
    changedElsewhere: server.email.trim() !== base.email.trim() || server.roleTitle.trim() !== base.roleTitle.trim(),
  };
}

export interface FieldChange {
  before: string | null;
  after: string;
}

export interface EditProposal {
  email: FieldChange | null;
  roleTitle: FieldChange | null;
  password: boolean;
  revokesSessions: boolean;
  expected: EditExpectation;
}

export function proposeEdit(live: AdminRow, values: EditableValues, password: string): EditProposal {
  const email = values.email.trim();
  const roleTitle = values.roleTitle.trim();
  const emailChange = email !== (live.email ?? '').trim() ? { before: live.email, after: email } : null;
  const roleChange = roleTitle !== live.role_title.trim() ? { before: live.role_title || null, after: roleTitle } : null;
  const passwordChange = password !== '';
  const expected: EditExpectation = {};
  if (emailChange) expected.email = live.email;
  if (roleChange) expected.role_title = live.role_title;
  return {
    email: emailChange,
    roleTitle: roleChange,
    password: passwordChange,
    revokesSessions: passwordChange || roleChange !== null,
    expected,
  };
}

export function isEmptyProposal(proposal: EditProposal): boolean {
  return !proposal.email && !proposal.roleTitle && !proposal.password;
}

export function editRequestBody(
  id: string,
  proposal: EditProposal,
  password: string,
  reason: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = { id, reason };
  if (proposal.email) body.email = proposal.email.after;
  if (proposal.roleTitle) body.role_title = proposal.roleTitle.after;
  if (proposal.password) body.password = password;
  if (Object.keys(proposal.expected).length) body.expected = proposal.expected;
  return body;
}

export function createRequestBody(draft: EditorDraft, reason: string): Record<string, unknown> {
  return {
    username: draft.username.trim(),
    email: draft.email.trim(),
    password: draft.password,
    role_title: draft.roleTitle.trim(),
    reason,
  };
}

export interface AccessExpected {
  role_id: string | null;
  direct_permissions: readonly string[];
  page_permissions: readonly string[];
}

export const NO_ACCESS: AccessExpected = Object.freeze({ role_id: null, direct_permissions: [], page_permissions: [] });

export interface AccessDraft {
  roleId: string | null;
  direct: readonly string[];
  folded: readonly string[];
}

export function accessOf(admin: Pick<AdminRow, 'role_id' | 'direct_permissions' | 'page_permissions'>): AccessExpected {
  return {
    role_id: admin.role_id,
    direct_permissions: [...admin.direct_permissions],
    page_permissions: [...admin.page_permissions],
  };
}

export function accessDraftFor(expected: AccessExpected): AccessDraft {
  return { roleId: expected.role_id, direct: [...expected.direct_permissions], folded: [] };
}

export function isAccessDirty(base: AccessExpected, draft: AccessDraft): boolean {
  return draft.roleId !== base.role_id || !sameGrants(draft.direct, base.direct_permissions);
}

export function pickRole(draft: AccessDraft, roleId: string | null, roleKeys: readonly string[]): AccessDraft {
  const candidates = normalizeGrants([...draft.direct, ...draft.folded]);
  if (roleId === null) return { roleId: null, direct: candidates, folded: [] };
  const direct = foldIntoRole(candidates, roleKeys);
  const kept = new Set(direct);
  return { roleId, direct, folded: candidates.filter((key) => !kept.has(key)) };
}

export function roleLocks(role: Pick<RoleRow, 'name' | 'permissions'> | null): Map<Permission, string> {
  const locks = new Map<Permission, string>();
  if (!role) return locks;
  const held = resolvePermissions(role.permissions, false);
  const note = `From role ${role.name}`;
  for (const permission of ALL_PERMISSIONS) if (held.has(permission)) locks.set(permission, note);
  return locks;
}

export function proposedTitle(title: string, previousRole: string | null, nextRole: string | null): string | null {
  if (nextRole === null) return null;
  const current = title.trim();
  const follows = current === '' || (previousRole !== null && current === previousRole.trim());
  return follows && current !== nextRole.trim() ? nextRole : null;
}

export function toRoleList(body: ApiBody): RoleRow[] | null {
  if (!Array.isArray(body.roles)) return null;
  const roles: RoleRow[] = [];
  for (const raw of body.roles) {
    const role = parseRoleRow(raw);
    if (role) roles.push({ ...role, id: role.id.toLowerCase() });
  }
  return roles;
}

export interface RoleChoice {
  id: string;
  name: string;
}

export function roleChoices(roles: readonly RoleRow[], keepId: string | null, keepName: string | null = null): RoleChoice[] {
  const choices = roles
    .filter(assignableRole)
    .map((role) => ({ id: role.id, name: role.name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (keepId && !choices.some((choice) => choice.id === keepId)) {
    const kept = roles.find((role) => role.id === keepId);
    const name = kept?.name ?? keepName ?? UNNAMED_ROLE_LABEL;
    choices.unshift({ id: keepId, name: kept?.archived_at ? `${name} (archived)` : name });
  }
  return choices;
}

function accessChangeBody(base: AccessExpected, draft: AccessDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (draft.roleId !== base.role_id) body.role_id = draft.roleId;
  if (!sameGrants(draft.direct, base.direct_permissions)) body.direct_permissions = normalizeGrants(draft.direct);
  body.expected = {
    role_id: base.role_id,
    direct_permissions: [...base.direct_permissions],
    page_permissions: [...base.page_permissions],
  };
  return body;
}

export function accessPreviewBody(base: AccessExpected, draft: AccessDraft): Record<string, unknown> {
  return { ...accessChangeBody(base, draft), dry_run: true };
}

export function accessSaveBody(base: AccessExpected, draft: AccessDraft, reason: string): Record<string, unknown> {
  return { ...accessChangeBody(base, draft), reason };
}

export function accessReasonProblem(reason: string): string | null {
  return Array.from(reason.trim()).length < REASON_MIN ? REASON_MESSAGE : null;
}

export interface AccessPreview {
  before: string[];
  after: string[];
  gained: Permission[];
  lost: Permission[];
  highestRisk: PermissionRisk | null;
  changed: boolean;
  signsOut: boolean;
  folded: string[];
}

function keyList(value: unknown): string[] | null {
  return Array.isArray(value) ? normalizeGrants(value) : null;
}

function actionList(value: unknown): Permission[] {
  return Array.isArray(value)
    ? value.filter((key): key is Permission => typeof key === 'string' && isPermission(key))
    : [];
}

export function toAccessPreview(body: ApiBody): AccessPreview | null {
  const impact = isRecord(body.impact) ? body.impact : null;
  if (!impact) return null;
  const before = keyList(impact.before);
  const after = keyList(impact.after);
  if (!before || !after || typeof impact.changed !== 'boolean' || typeof impact.signs_out !== 'boolean') return null;
  const gained = actionList(impact.gained);
  const lost = actionList(impact.lost);
  return {
    before,
    after,
    gained,
    lost,
    highestRisk: highestRisk([...gained, ...lost]),
    changed: impact.changed,
    signsOut: impact.signs_out,
    folded: keyList(impact.folded) ?? [],
  };
}

export interface AccessResult {
  access: AccessExpected | null;
  changed: boolean;
  signedOut: boolean;
}

export function toAccessResult(body: ApiBody): AccessResult | null {
  if (typeof body.changed !== 'boolean' || typeof body.signed_out !== 'boolean') return null;
  const admin = isRecord(body.admin) ? body.admin : null;
  const direct = admin ? keyList(admin.direct_permissions) : null;
  const effective = admin ? keyList(admin.page_permissions) : null;
  return {
    access: admin && direct && effective
      ? { role_id: idOf(admin.role_id), direct_permissions: direct, page_permissions: effective }
      : null,
    changed: body.changed,
    signedOut: body.signed_out,
  };
}

export function withAccess(admin: AdminRow, access: AccessExpected, role: AdminRoleRef | null): AdminRow {
  return {
    ...admin,
    role_id: access.role_id,
    role: access.role_id ? role : null,
    direct_permissions: [...access.direct_permissions],
    page_permissions: [...access.page_permissions],
  };
}

export interface AccessRebase {
  draft: AccessDraft;
  changedElsewhere: boolean;
}

export function rebaseAccess(base: AccessExpected, local: AccessDraft, server: AccessExpected): AccessRebase {
  const roleId = local.roleId !== base.role_id ? local.roleId : server.role_id;
  const was = new Set(base.direct_permissions);
  const wanted = new Set(local.direct);
  const live = new Set(server.direct_permissions);
  const direct = sortGrants(new Set([...base.direct_permissions, ...local.direct, ...server.direct_permissions]))
    .filter((key) => (wanted.has(key) !== was.has(key) ? wanted.has(key) : live.has(key)));
  const kept = new Set(direct);
  return {
    draft: { roleId, direct, folded: local.folded.filter((key) => !kept.has(key)) },
    changedElsewhere: server.role_id !== base.role_id
      || !sameGrants(server.direct_permissions, base.direct_permissions)
      || !sameGrants(server.page_permissions, base.page_permissions),
  };
}

export interface AccessHandoff {
  adminId: string;
  access: AccessDraft;
  notice: string;
}

export const CREATED_WITHOUT_ACCESS = 'The account was created without access.';

export const ACCESS_CHANGED_ELSEWHERE =
  'Another admin changed this account’s access while you were editing. It now shows their change with yours on top, so review it again.';

export const ACCESS_PREVIEW_UNREACHABLE = 'The access preview could not be loaded. Check your connection and try again.';

export interface MutationResult {
  admin: AdminRow | null;
  changed: boolean;
  sessionsRevoked: boolean;
  warning: string | null;
}

export function toMutationResult(body: ApiBody): MutationResult {
  return {
    admin: toAdminRow(body.admin),
    changed: body.changed !== false,
    sessionsRevoked: body.sessions_revoked === true,
    warning: text(body.warning),
  };
}

export type StepUpCode = 'REAUTH_REQUIRED' | 'MFA_REQUIRED';

export const STEP_UP_MESSAGE: Readonly<Record<StepUpCode, string>> = {
  REAUTH_REQUIRED: 'Your identity check ran out. Enter a new code from your authenticator app and try again.',
  MFA_REQUIRED: ACTOR_TWO_STEP_FIRST,
};

export function stepUpCode(failure: ApiFailure): StepUpCode | null {
  if (failure.kind !== 'http' || failure.status !== 403) return null;
  return failure.code === 'REAUTH_REQUIRED' || failure.code === 'MFA_REQUIRED' ? failure.code : null;
}

export async function confirmIdentity(code: string): Promise<'ok' | 'expired'> {
  try {
    await reauthenticate('otp', code);
    return 'ok';
  } catch (error) {
    if (error instanceof SecurityRequestError && error.failure.kind === 'http' && error.failure.status === 401) {
      return 'expired';
    }
    throw error;
  }
}

export type MutationOutcome<T = MutationResult> =
  | { kind: 'done'; result: T }
  | { kind: 'unknown'; message: string }
  | { kind: 'stale'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'reauth'; code: StepUpCode; message: string }
  | { kind: 'expired' };

export type MutationAttempt<T = MutationResult> = MutationOutcome<T> | { kind: 'retry'; message: string };

export function classifyMutation<T = MutationResult>(result: ApiResult<T>): MutationAttempt<T> {
  if (result.ok) return { kind: 'done', result: result.data };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  const stepUp = stepUpCode(failure);
  if (stepUp) return { kind: 'reauth', code: stepUp, message: STEP_UP_MESSAGE[stepUp] };
  if (failure.status === 403) return { kind: 'refused', message: failure.message };
  if (failure.status === 404 || failure.status === 409) return { kind: 'stale', message: failure.message };
  return { kind: 'retry', message: failure.message };
}

export type AccessStop =
  | { kind: 'cancelled' }
  | { kind: 'expired' }
  | { kind: 'stale'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'reauth'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'unknown'; message: string };

export type AccessStep = { kind: 'saved'; result: AccessResult } | AccessStop;

export function previewStop(failure: ApiFailure): AccessStop {
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.kind !== 'http') return { kind: 'failed', message: ACCESS_PREVIEW_UNREACHABLE };
  const stepUp = stepUpCode(failure);
  if (stepUp) return { kind: 'reauth', message: STEP_UP_MESSAGE[stepUp] };
  if (failure.status === 403) return { kind: 'refused', message: failure.message };
  if (failure.status === 404 || failure.status === 409) return { kind: 'stale', message: failure.message };
  return { kind: 'failed', message: failure.message };
}

export function accessStepOf(outcome: MutationOutcome<AccessResult> | null | undefined): AccessStep {
  if (!outcome) return { kind: 'cancelled' };
  switch (outcome.kind) {
    case 'done':
      return { kind: 'saved', result: outcome.result };
    case 'expired':
      return { kind: 'expired' };
    case 'reauth':
      return { kind: 'reauth', message: outcome.message };
    case 'unknown':
      return { kind: 'unknown', message: outcome.message };
    case 'stale':
      return { kind: 'stale', message: outcome.message };
    case 'refused':
      return { kind: 'refused', message: outcome.message };
  }
}

export function createdNotice(stop: AccessStop): string {
  switch (stop.kind) {
    case 'cancelled':
      return `${CREATED_WITHOUT_ACCESS} The access change was cancelled.`;
    case 'expired':
      return `${CREATED_WITHOUT_ACCESS} Your session ended before it was saved.`;
    case 'unknown':
      return `The account was created. ${stop.message}`;
    default:
      return `${CREATED_WITHOUT_ACCESS} ${stop.message}`;
  }
}

export interface ResetResult {
  previousStatus: 'active' | 'pending';
  sessionsRevoked: number;
  auditRecorded: boolean;
  warning: string | null;
}

export function toResetResult(body: ApiBody): ResetResult | null {
  if (body.ok !== true) return null;
  return {
    previousStatus: body.previous_status === 'pending' ? 'pending' : 'active',
    sessionsRevoked: countOf(body.sessions_revoked),
    auditRecorded: body.audit_recorded !== false,
    warning: text(body.warning),
  };
}

export interface DeviceSignOut {
  revoked: boolean;
  auditRecorded: boolean;
  warning: string | null;
}

export function toDeviceSignOut(body: ApiBody): DeviceSignOut | null {
  if (typeof body.revoked !== 'boolean') return null;
  return { revoked: body.revoked, auditRecorded: body.audit_recorded !== false, warning: text(body.warning) };
}
