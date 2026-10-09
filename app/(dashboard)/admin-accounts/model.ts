import { NAV_GROUPS } from '../_shell/nav';
import {
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  isPermission,
  type Permission,
  type PermissionCategory,
  type PermissionRisk,
} from '../../lib/permissions';
import type { ApiBody, ApiResult } from '../../lib/apiClient';
import type { SortState } from '../../_ui/useTableSort';
import type { Tone } from '../../_ui/Status';
import {
  ADDITIONAL_PERMISSIONS,
  GRANTABLE_PAGE_KEYS,
  checkPassword,
  checkRoleTitle,
  checkUsername,
  diffGrants,
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
  type GrantChange,
} from './rules';

export interface AdminRow {
  id: string;
  username: string;
  email: string | null;
  role_title: string;
  page_permissions: string[];
  last_login_at: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  deleted_at: string | null;
  created_at: string | null;
}

export interface AdminList {
  admins: AdminRow[];
  currentAdminId: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function toAdminRow(raw: unknown): AdminRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  if (!id) return null;
  return {
    id: id.toLowerCase(),
    username: typeof row.username === 'string' ? row.username : '',
    email: text(row.email),
    role_title: typeof row.role_title === 'string' ? row.role_title : '',
    page_permissions: Array.isArray(row.page_permissions) ? normalizeGrants(row.page_permissions) : [],
    last_login_at: text(row.last_login_at),
    is_active: row.is_active === true,
    is_super_admin: row.is_super_admin === true,
    deleted_at: text(row.deleted_at),
    created_at: text(row.created_at),
  };
}

export function toAdminList(body: ApiBody): AdminList | null {
  if (!Array.isArray(body.admins)) return null;
  const admins = body.admins.map(toAdminRow).filter((row): row is AdminRow => row !== null);
  const current = text(body.current_admin_id);
  return { admins, currentAdminId: current ? current.toLowerCase() : null };
}

export function withAdmin(list: AdminList | undefined, admin: AdminRow): AdminList | undefined {
  if (!list) return list;
  const index = list.admins.findIndex((row) => row.id === admin.id);
  const admins = index === -1
    ? [...list.admins, admin]
    : list.admins.map((row, at) => (at === index ? admin : row));
  return { ...list, admins };
}

export function adminHandle(admin: { username: string } | null | undefined): string {
  const name = admin?.username?.trim();
  return name ? `@${name}` : 'this admin';
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
}

const NO_CAPABILITIES: AdminCapabilities = { edit: false, revoke: false, deactivate: false, reactivate: false, remove: false };

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
  };
}

export function hasRowActions(capabilities: AdminCapabilities): boolean {
  return capabilities.revoke || capabilities.deactivate || capabilities.reactivate || capabilities.remove;
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
  const kind = grantKind(key);
  if (kind === 'page' || kind === 'restricted' || kind === 'retired') return pageLabel(key);
  if (kind === 'additional' && isPermission(key)) return PERMISSION_CATALOG[key].label;
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

export const PAGE_GRANT_GROUPS: readonly PageGrantGroup[] = (() => {
  const grantable = new Set(GRANTABLE_PAGE_KEYS);
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
  const rest = GRANTABLE_PAGE_KEYS.filter((key) => !placed.has(key));
  if (rest.length) groups.push({ label: 'Other pages', grants: rest.map(pageSpec) });
  return groups;
})();

export const ENFORCED_ADDITIONAL: readonly Permission[] = [
  'flags.read',
  'flags.resolve',
  'sensitive_data.download',
  'sensitive_data.share',
];

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
    } else if (kind === 'additional') {
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
  grants: readonly string[];
}

export interface EditableValues {
  email: string;
  roleTitle: string;
  grants: readonly string[];
}

export const EMPTY_DRAFT: EditorDraft = {
  username: '',
  email: '',
  roleTitle: '',
  password: '',
  confirmPassword: '',
  grants: [],
};

export function valuesOf(admin: AdminRow): EditableValues {
  return { email: admin.email ?? '', roleTitle: admin.role_title, grants: admin.page_permissions };
}

export function draftFor(admin: AdminRow | null): EditorDraft {
  if (!admin) return EMPTY_DRAFT;
  return { ...EMPTY_DRAFT, username: admin.username, ...valuesOf(admin) };
}

export type EditorField = 'username' | 'email' | 'roleTitle' | 'password' | 'confirmPassword' | 'grants';

export const EDITOR_FIELD_ORDER: readonly EditorField[] = [
  'username',
  'email',
  'roleTitle',
  'password',
  'confirmPassword',
  'grants',
];

export type EditorErrors = Partial<Record<EditorField, string>>;

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
  const role = draft.roleTitle.trim();
  const roleProblem = role ? checkRoleTitle(role) : 'Enter a role title.';
  if (roleProblem) errors.roleTitle = roleProblem;
  if (mode === 'create' || draft.password !== '') {
    const passwordProblem = checkPassword(draft.password);
    if (passwordProblem) errors.password = passwordProblem;
  }
  if (draft.password !== '' && draft.confirmPassword !== draft.password) {
    errors.confirmPassword = 'The passwords do not match.';
  }
  const kinds = draft.grants.map(grantKind);
  if (kinds.includes('unknown')) errors.grants = 'Untick the unrecognised keys before saving.';
  else if (!kinds.some((kind) => kind === 'page' || kind === 'additional')) {
    errors.grants = 'Give this admin at least one page or permission.';
  }
  return errors;
}

export function firstError(errors: EditorErrors): EditorField | null {
  return EDITOR_FIELD_ORDER.find((field) => errors[field]) ?? null;
}

export function isDraftDirty(mode: EditorMode, draft: EditorDraft, base: EditableValues): boolean {
  if (draft.password !== '' || draft.confirmPassword !== '') return true;
  if (mode === 'create' && draft.username.trim() !== '') return true;
  return draft.email.trim() !== base.email.trim()
    || draft.roleTitle.trim() !== base.roleTitle.trim()
    || !sameGrants(draft.grants, base.grants);
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
  const was = new Set(base.grants);
  const wanted = new Set(local.grants);
  const live = new Set(server.grants);
  const grants = sortGrants(new Set([...base.grants, ...local.grants, ...server.grants]))
    .filter((key) => (wanted.has(key) !== was.has(key) ? wanted.has(key) : live.has(key)));
  return {
    values: { email, roleTitle, grants },
    conflicts,
    changedElsewhere: server.email.trim() !== base.email.trim()
      || server.roleTitle.trim() !== base.roleTitle.trim()
      || !sameGrants(server.grants, base.grants),
  };
}

export interface FieldChange {
  before: string | null;
  after: string;
}

export interface EditProposal {
  email: FieldChange | null;
  roleTitle: FieldChange | null;
  grants: GrantChange | null;
  nextGrants: string[];
  password: boolean;
  revokesSessions: boolean;
  expected: EditExpectation;
}

export function proposeEdit(live: AdminRow, values: EditableValues, password: string): EditProposal {
  const email = values.email.trim();
  const roleTitle = values.roleTitle.trim();
  const nextGrants = normalizeGrants(values.grants);
  const emailChange = email !== (live.email ?? '').trim() ? { before: live.email, after: email } : null;
  const roleChange = roleTitle !== live.role_title.trim() ? { before: live.role_title || null, after: roleTitle } : null;
  const grants = sameGrants(live.page_permissions, nextGrants) ? null : diffGrants(live.page_permissions, nextGrants);
  const passwordChange = password !== '';
  const expected: EditExpectation = {};
  if (emailChange) expected.email = live.email;
  if (roleChange) expected.role_title = live.role_title;
  if (grants) expected.page_permissions = live.page_permissions;
  return {
    email: emailChange,
    roleTitle: roleChange,
    grants,
    nextGrants,
    password: passwordChange,
    revokesSessions: passwordChange || roleChange !== null || grants !== null,
    expected,
  };
}

export function isEmptyProposal(proposal: EditProposal): boolean {
  return !proposal.email && !proposal.roleTitle && !proposal.grants && !proposal.password;
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
  if (proposal.grants) body.page_permissions = proposal.nextGrants;
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
    page_permissions: normalizeGrants(draft.grants),
    reason,
  };
}

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

export type MutationOutcome =
  | { kind: 'done'; result: MutationResult }
  | { kind: 'unknown'; message: string }
  | { kind: 'stale'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'expired' };

export type MutationAttempt = MutationOutcome | { kind: 'retry'; message: string };

export function classifyMutation(result: ApiResult<MutationResult>): MutationAttempt {
  if (result.ok) return { kind: 'done', result: result.data };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  if (failure.status === 403) return { kind: 'refused', message: failure.message };
  if (failure.status === 404 || failure.status === 409) return { kind: 'stale', message: failure.message };
  return { kind: 'retry', message: failure.message };
}
