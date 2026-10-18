import { combineCodecs, enumParam, uuidParam } from '../../_ui/useUrlState';
import type { SortState } from '../../_ui/useTableSort';
import type { ConfirmFn, ConfirmOptions, ConfirmTone } from '../../_ui/Confirm';
import type { ApiBody, ApiFailure, ApiResult } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { isPermission, type Permission } from '../../lib/permissions';
import {
  copyableKeys, highestRisk, keysFromMatrix, matrixFromKeys, normalizeGrants, sameGrants, sortGrants,
} from '../../lib/grants';
import {
  REASON_MAX, REASON_MESSAGE, REASON_MIN, checkRoleDraft, parseRoleRow, roleSummary,
  type AffectedAdmin, type Impact, type RoleRow, type UnchangedAdmin,
} from '../../lib/roles';
import {
  STEP_UP_MESSAGE, adminHandle, confirmIdentity, plural, stepUpCode, type StepUpCode,
} from '../admin-accounts/model';

export const TITLE = 'Roles';
export const SUBTITLE = 'Each admin holds one role at most, plus any permissions granted to them directly. Times are WAT.';

export const ROLES_PATH = '/api/admin-roles';
export const PREVIEW_PATH = '/api/admin-roles/preview';
export const COPY_SOURCES_PATH = '/api/admin-accounts';
export const ADMIN_ACCOUNTS_HREF = '/admin-accounts';

export const MISSING_LINK = 'That role could not be found, so nothing was opened.';
export const PREVIEW_UNREACHABLE = 'The impact of this change could not be worked out, so nothing was saved. Try again.';
export const SIGN_OUT_LINE = 'They will be signed out on every device, and their phone alerts stop until they sign in again.';
export const IDENTITY_TITLE = 'Confirm it is you';
export const IDENTITY_MESSAGE =
  'Role changes need a recent identity check. Enter a code from your authenticator app to finish.';

export type RoleTab = 'active' | 'archived';

export const ROLE_TAB_VALUES: readonly RoleTab[] = ['active', 'archived'];

export const ROLE_TABS: ReadonlyArray<{ value: RoleTab; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

export const ROLES_URL = combineCodecs({
  tab: enumParam('status', ROLE_TAB_VALUES, 'active'),
  id: uuidParam('id'),
});

export const EMPTY_COPY: Readonly<Record<RoleTab, { title: string; hint: string }>> = {
  active: { title: 'No roles yet', hint: 'Create a role to give admins a set of permissions.' },
  archived: { title: 'No archived roles', hint: 'Archived roles stay listed here and can be restored.' },
};

export const SEARCH_EMPTY = {
  title: 'No roles match this search',
  hint: 'Try a role name or description, or clear the search.',
};

export interface RoleView {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  system_key: string | null;
  is_protected: boolean;
  version: number;
  archived_at: string | null;
  action_count: number;
  member_count: number;
  active_member_count: number;
  created_at: string | null;
  updated_at: string | null;
  updated_by_username: string | null;
}

export interface RoleList {
  roles: RoleView[];
  superAdminCount: number;
  canManage: boolean;
}

export interface RoleMember {
  id: string;
  username: string;
  role_title: string | null;
  is_active: boolean;
  last_login_at: string | null;
}

export interface RoleDetail {
  role: RoleRow;
  members: RoleMember[];
}

export interface RoleSaved {
  role: RoleRow;
  impact: Impact | null;
}

export interface RoleHolder {
  admin_id: string;
  username: string;
}

export interface CopySource {
  id: string;
  username: string;
  is_active: boolean;
  keys: string[];
}

export type EditableRole = Pick<
  RoleRow,
  'id' | 'name' | 'description' | 'permissions' | 'system_key' | 'is_protected' | 'version' | 'archived_at'
>;

export type ConfirmBase = Omit<ConfirmOptions, 'action'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function nameOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function rolePath(id: string): string {
  return `${ROLES_PATH}/${encodeURIComponent(id)}`;
}

export function archivePath(id: string): string {
  return `${rolePath(id)}/archive`;
}

export function restorePath(id: string): string {
  return `${rolePath(id)}/restore`;
}

export function adminHref(id: string): string {
  return `${ADMIN_ACCOUNTS_HREF}?id=${encodeURIComponent(id)}`;
}

function lowered(role: RoleRow): RoleRow {
  return { ...role, id: role.id.toLowerCase() };
}

export function toRoleView(raw: unknown): RoleView | null {
  const role = parseRoleRow(raw);
  if (!role || !isRecord(raw)) return null;
  return {
    id: role.id.toLowerCase(),
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    system_key: role.system_key,
    is_protected: role.is_protected,
    version: role.version,
    archived_at: role.archived_at,
    action_count: count(raw.action_count),
    member_count: count(raw.member_count),
    active_member_count: count(raw.active_member_count),
    created_at: role.created_at,
    updated_at: role.updated_at,
    updated_by_username: text(raw.updated_by_username),
  };
}

export function toRoleList(body: ApiBody): RoleList | null {
  if (!Array.isArray(body.roles)) return null;
  const roles = body.roles.map(toRoleView).filter((role): role is RoleView => role !== null);
  return { roles, superAdminCount: count(body.super_admin_count), canManage: body.can_manage === true };
}

function toMember(raw: unknown): RoleMember | null {
  if (!isRecord(raw)) return null;
  const id = raw.id;
  if (!isUuid(id)) return null;
  return {
    id: id.toLowerCase(),
    username: nameOf(raw.username),
    role_title: text(raw.role_title),
    is_active: raw.is_active === true,
    last_login_at: text(raw.last_login_at),
  };
}

export function toRoleDetail(body: ApiBody): RoleDetail | null {
  const role = parseRoleRow(body.role);
  if (!role) return null;
  const members = (Array.isArray(body.members) ? body.members : [])
    .map(toMember)
    .filter((member): member is RoleMember => member !== null);
  return { role: lowered(role), members };
}

function permissionList(value: unknown): Permission[] {
  const out: Permission[] = [];
  for (const key of Array.isArray(value) ? value : []) {
    if (typeof key === 'string' && isPermission(key)) out.push(key);
  }
  return out;
}

function toAffected(raw: unknown): AffectedAdmin | null {
  if (!isRecord(raw)) return null;
  const adminId = raw.admin_id;
  if (typeof adminId !== 'string') return null;
  const gained = permissionList(raw.gained);
  const lost = permissionList(raw.lost);
  return {
    admin_id: adminId,
    username: nameOf(raw.username),
    is_active: raw.is_active === true,
    gained,
    lost,
    highest_risk: highestRisk([...gained, ...lost]),
  };
}

function toUnchanged(raw: unknown): UnchangedAdmin | null {
  if (!isRecord(raw)) return null;
  const adminId = raw.admin_id;
  if (typeof adminId !== 'string') return null;
  return { admin_id: adminId, username: nameOf(raw.username), why: raw.why === 'super_admin' ? 'super_admin' : 'same_access' };
}

export function parseImpact(raw: unknown): Impact | null {
  if (!isRecord(raw)) return null;
  const affectedRaw = raw.affected;
  const unchangedRaw = raw.unchanged;
  if (!Array.isArray(affectedRaw) || !Array.isArray(unchangedRaw)) return null;
  const affected = affectedRaw.map(toAffected).filter((admin): admin is AffectedAdmin => admin !== null);
  const unchanged = unchangedRaw.map(toUnchanged).filter((admin): admin is UnchangedAdmin => admin !== null);
  return {
    members_total: affected.length + unchanged.length,
    affected,
    unchanged,
    signed_out_count: affected.filter((admin) => admin.is_active).length,
  };
}

export function toImpact(body: ApiBody): Impact | null {
  return parseImpact(body.impact);
}

export function toRoleSaved(body: ApiBody): RoleSaved | null {
  const role = parseRoleRow(body.role);
  if (!role) return null;
  return { role: lowered(role), impact: body.impact === undefined ? null : parseImpact(body.impact) };
}

export function toCopySources(body: ApiBody): CopySource[] | null {
  if (!Array.isArray(body.admins)) return null;
  const sources: CopySource[] = [];
  for (const raw of body.admins) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (!isUuid(id) || raw.is_super_admin === true || text(raw.deleted_at) !== null) continue;
    const direct = raw.direct_permissions;
    sources.push({
      id: id.toLowerCase(),
      username: nameOf(raw.username),
      is_active: raw.is_active === true,
      keys: copyableKeys(Array.isArray(direct) ? normalizeGrants(direct) : []),
    });
  }
  return sources.sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
}

export function copySourceLabel(source: CopySource): string {
  return source.is_active ? adminHandle(source) : `${adminHandle(source)} · Inactive`;
}

export function isSystemRole(role: Pick<RoleRow, 'system_key' | 'is_protected'>): boolean {
  return role.is_protected || role.system_key !== null;
}

export function isArchived(role: Pick<RoleRow, 'archived_at'>): boolean {
  return role.archived_at !== null;
}

export function tabOf(role: Pick<RoleRow, 'archived_at'>): RoleTab {
  return isArchived(role) ? 'archived' : 'active';
}

export function tabCounts(roles: readonly RoleView[]): Record<RoleTab, number> {
  const counts: Record<RoleTab, number> = { active: 0, archived: 0 };
  for (const role of roles) counts[tabOf(role)] += 1;
  return counts;
}

export function matchesQuery(role: RoleView, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return role.name.toLowerCase().includes(needle) || role.description.toLowerCase().includes(needle);
}

export const ROLE_SORT_KEYS = ['name', 'admins', 'updated_at'] as const;

function compareRoles(a: RoleView, b: RoleView, sort: SortState): number {
  const flip = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'admins') return (a.active_member_count - b.active_member_count) * flip;
  if (sort.key === 'updated_at') {
    const left = a.updated_at ? Date.parse(a.updated_at) : Number.NaN;
    const right = b.updated_at ? Date.parse(b.updated_at) : Number.NaN;
    if (Number.isNaN(left) && Number.isNaN(right)) return 0;
    if (Number.isNaN(left)) return 1;
    if (Number.isNaN(right)) return -1;
    return (left - right) * flip;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * flip;
}

export function visibleRoles(
  roles: readonly RoleView[],
  tab: RoleTab,
  query: string,
  sort: SortState | null,
): RoleView[] {
  const rows = roles.filter((role) => tabOf(role) === tab && matchesQuery(role, query));
  if (!sort || !(ROLE_SORT_KEYS as readonly string[]).includes(sort.key)) return rows;
  return rows
    .map((role, index) => ({ role, index }))
    .sort((a, b) => compareRoles(a.role, b.role, sort) || a.index - b.index)
    .map((entry) => entry.role);
}

export function adminsText(role: Pick<RoleView, 'active_member_count'>): string {
  return role.active_member_count.toLocaleString('en-NG');
}

export function permissionsText(role: Pick<RoleView, 'system_key' | 'is_protected' | 'action_count'>): string {
  return isSystemRole(role) ? 'All' : plural(role.action_count, 'action');
}

export function updatedBy(role: Pick<RoleView, 'updated_by_username'>): string | null {
  return role.updated_by_username ? adminHandle({ username: role.updated_by_username }) : null;
}

export function holdersOf(value: unknown): RoleHolder[] {
  const out: RoleHolder[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (!isRecord(item)) continue;
    const adminId = item.admin_id;
    if (typeof adminId !== 'string') continue;
    out.push({ admin_id: adminId.toLowerCase(), username: nameOf(item.username) });
  }
  return out;
}

export function holdersFromMembers(members: readonly RoleMember[]): RoleHolder[] {
  return members.map((member) => ({ admin_id: member.id, username: member.username }));
}

export type EditorMode = 'create' | 'edit';

export interface RoleValues {
  name: string;
  description: string;
  keys: string[];
}

export interface RoleDraftState extends RoleValues {
  baseline: string[];
}

export function settledKeys(keys: readonly string[]): string[] {
  return keysFromMatrix(keys, matrixFromKeys(keys), true);
}

export function valuesOf(role: Pick<RoleRow, 'name' | 'description' | 'permissions'>): RoleValues {
  return { name: role.name, description: role.description, keys: settledKeys(role.permissions) };
}

export function baseFor(role: EditableRole | null, seed: readonly string[] = []): RoleValues {
  return role ? valuesOf(role) : { name: '', description: '', keys: settledKeys(seed) };
}

export function draftFor(role: EditableRole | null, seed: readonly string[] = []): RoleDraftState {
  const base = baseFor(role, seed);
  return { ...base, keys: [...base.keys], baseline: [...base.keys] };
}

export function duplicateKeys(role: Pick<RoleRow, 'permissions'>): string[] {
  return copyableKeys(role.permissions);
}

export function otherKeys(keys: readonly string[]): string[] {
  const kept = new Set(keysFromMatrix(keys, matrixFromKeys(keys)));
  return normalizeGrants(keys).filter((key) => !kept.has(key));
}

export function withMatrix(draft: RoleDraftState, ticked: ReadonlySet<Permission>): RoleDraftState {
  return { ...draft, keys: sortGrants([...keysFromMatrix(draft.baseline, ticked), ...otherKeys(draft.keys)]) };
}

export function withStoredKeys(draft: RoleDraftState, next: readonly string[]): RoleDraftState {
  return { ...draft, keys: sortGrants(normalizeGrants(next)) };
}

export function withCopy(draft: RoleDraftState, keys: readonly string[]): RoleDraftState {
  const copied = settledKeys(keys);
  return { ...draft, keys: copied, baseline: [...copied] };
}

export type RoleEditorField = 'name' | 'description' | 'permissions';

export type RoleEditorErrors = Partial<Record<RoleEditorField, string>>;

export const ROLE_FIELD_ORDER: readonly RoleEditorField[] = ['name', 'description', 'permissions'];

export function validateRoleDraft(draft: RoleValues, current: readonly string[]): RoleEditorErrors {
  const check = checkRoleDraft({ name: draft.name, description: draft.description, permissions: draft.keys }, current);
  const errors: RoleEditorErrors = {};
  if (!check.ok && check.field !== 'reason') errors[check.field] = check.message;
  return errors;
}

export function firstRoleError(errors: RoleEditorErrors): RoleEditorField | null {
  return ROLE_FIELD_ORDER.find((field) => errors[field]) ?? null;
}

export function isRoleDirty(draft: RoleValues, base: RoleValues): boolean {
  return draft.name.trim() !== base.name.trim()
    || draft.description.trim() !== base.description.trim()
    || !sameGrants(draft.keys, base.keys);
}

export type RoleConflictField = 'name' | 'description';

export interface RoleRebase {
  values: RoleValues;
  baseline: string[];
  conflicts: RoleConflictField[];
  changedElsewhere: boolean;
}

export function rebaseRoleDraft(base: RoleValues, local: RoleValues, server: RoleValues): RoleRebase {
  const conflicts: RoleConflictField[] = [];
  const pick = (field: RoleConflictField): string => {
    const mine = local[field].trim() !== base[field].trim();
    const theirs = server[field].trim() !== base[field].trim();
    if (!mine) return server[field];
    if (theirs && server[field].trim() !== local[field].trim()) conflicts.push(field);
    return local[field];
  };
  const name = pick('name');
  const description = pick('description');
  const was = new Set(base.keys);
  const wanted = new Set(local.keys);
  const live = new Set(server.keys);
  const keys = sortGrants(new Set([...base.keys, ...local.keys, ...server.keys]))
    .filter((key) => (wanted.has(key) !== was.has(key) ? wanted.has(key) : live.has(key)));
  return {
    values: { name, description, keys },
    baseline: sortGrants(new Set([...server.keys, ...keys.filter((key) => !isPermission(key))])),
    conflicts,
    changedElsewhere: server.name.trim() !== base.name.trim()
      || server.description.trim() !== base.description.trim()
      || !sameGrants(server.keys, base.keys),
  };
}

export function rebaseNoticeText(rebase: Pick<RoleRebase, 'conflicts'>): string {
  const both = rebase.conflicts.length
    ? `; you both changed the ${rebase.conflicts.join(' and ')}, and yours is kept`
    : '';
  return `Another admin saved this role while you were editing. Their changes are kept and yours are applied on top${both}. Review the changes again before saving.`;
}

export function previewBody(draft: RoleValues, role: EditableRole | null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    role_id: role ? role.id : null,
    name: draft.name.trim(),
    description: draft.description.trim(),
    permissions: draft.keys,
  };
  if (role) body.expected_version = role.version;
  return body;
}

export function saveBody(draft: RoleValues, role: EditableRole | null, reason: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    permissions: draft.keys,
    reason,
  };
  if (role) body.expected_version = role.version;
  return body;
}

export function archiveBody(reason: string, version: number): Record<string, unknown> {
  return { reason, expected_version: version };
}

export type RoleConflict = 'stale' | 'name_taken' | 'in_use' | 'protected' | 'archived' | 'unchanged' | 'not_found' | 'other';

const CONFLICT_REASONS: ReadonlySet<string> = new Set(['stale', 'name_taken', 'in_use', 'protected', 'archived', 'unchanged']);

function isConflict(value: unknown): value is RoleConflict {
  return typeof value === 'string' && CONFLICT_REASONS.has(value);
}

export type RoleWriteOutcome<T> =
  | { kind: 'done'; result: T }
  | { kind: 'expired' }
  | { kind: 'unknown'; message: string }
  | { kind: 'reauth'; code: StepUpCode; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'conflict'; reason: RoleConflict; message: string; version: number | null; members: RoleHolder[] };

export type RoleWriteAttempt<T> = RoleWriteOutcome<T> | { kind: 'retry'; message: string };

export function classifyRoleWrite<T>(result: ApiResult<T>): RoleWriteAttempt<T> {
  if (result.ok) return { kind: 'done', result: result.data };
  const failure: ApiFailure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  const stepUp = stepUpCode(failure);
  if (stepUp) return { kind: 'reauth', code: stepUp, message: STEP_UP_MESSAGE[stepUp] };
  if (failure.status === 403) return { kind: 'refused', message: failure.message };
  if (failure.status === 404 || failure.status === 409) {
    const details = isRecord(failure.details) ? failure.details : {};
    const reason = details.reason;
    const version = details.version;
    return {
      kind: 'conflict',
      reason: failure.status === 404 ? 'not_found' : isConflict(reason) ? reason : 'other',
      message: failure.message,
      version: typeof version === 'number' && Number.isInteger(version) ? version : null,
      members: holdersOf(details.members),
    };
  }
  return { kind: 'retry', message: failure.message };
}

export function reasonProblem(reason: string): string | null {
  const length = Array.from(reason.trim()).length;
  return length < REASON_MIN || length > REASON_MAX ? REASON_MESSAGE : null;
}

export function identityConfirm(options: ConfirmBase): ConfirmBase {
  return {
    tone: options.tone,
    title: IDENTITY_TITLE,
    message: IDENTITY_MESSAGE,
    credential: { kind: 'otp' },
    confirmLabel: options.confirmLabel,
    pendingLabel: options.pendingLabel,
    returnFocusTo: options.returnFocusTo,
  };
}

export async function confirmWithStepUp<T>(
  confirm: ConfirmFn,
  options: ConfirmBase,
  send: (reason: string) => Promise<RoleWriteAttempt<T>>,
  verify: (code: string) => Promise<'ok' | 'expired'> = confirmIdentity,
): Promise<RoleWriteOutcome<T> | null> {
  const first = await confirm<RoleWriteOutcome<T>>({
    ...options,
    action: async ({ reason }) => {
      const problem = reasonProblem(reason);
      if (problem) throw new Error(problem);
      const attempt = await send(reason);
      if (attempt.kind === 'retry') throw new Error(attempt.message);
      return attempt;
    },
  });
  const outcome = first?.value;
  if (!first || !outcome) return null;
  if (outcome.kind !== 'reauth' || outcome.code !== 'REAUTH_REQUIRED') return outcome;
  const reason = first.reason;
  const second = await confirm<RoleWriteOutcome<T>>({
    ...identityConfirm(options),
    action: async ({ credential }) => {
      const identity = await verify(credential ?? '');
      if (identity === 'expired') return { kind: 'expired' };
      const attempt = await send(reason);
      if (attempt.kind === 'retry') throw new Error(attempt.message);
      if (attempt.kind === 'reauth' && attempt.code === 'REAUTH_REQUIRED') throw new Error(attempt.message);
      return attempt;
    },
  });
  return second?.value ?? null;
}

export function impactTone(impact: Pick<Impact, 'affected'>): ConfirmTone {
  return impact.affected.some((admin) => admin.highest_risk === 'critical') ? 'danger' : 'default';
}

export function memberLine(admin: AffectedAdmin): string {
  const handle = adminHandle(admin);
  const gains = admin.gained.length ? `gains ${plural(admin.gained.length, 'action')}` : null;
  const loses = admin.lost.length ? `loses ${plural(admin.lost.length, 'action')}` : null;
  if (gains && loses) return `${handle} ${gains} and ${loses}.`;
  if (gains || loses) return `${handle} ${gains ?? loses}.`;
  return `${handle}’s access changes.`;
}

export function impactConsequences(impact: Pick<Impact, 'affected' | 'signed_out_count'>): string[] {
  const lines = impact.affected.map(memberLine);
  if (impact.signed_out_count > 0) lines.push(SIGN_OUT_LINE);
  return lines;
}

export function actionsText(total: number): string {
  return total === 0 ? 'None' : plural(total, 'action');
}

export function saveSuccessText(mode: EditorMode, saved: RoleSaved): string {
  const name = saved.role.name;
  if (mode === 'create') return `Created the role ${name}.`;
  const changed = saved.impact ? saved.impact.affected.length : 0;
  if (changed === 0) return `Saved the role ${name}. No admin’s access changed.`;
  const signedOut = saved.impact ? saved.impact.signed_out_count : 0;
  const out = signedOut > 0 ? ` ${plural(signedOut, 'admin was', 'admins were')} signed out on every device.` : '';
  return `Saved the role ${name}. Access changed for ${plural(changed, 'admin')}.${out}`;
}

export function archiveConfirm(role: Pick<RoleRow, 'name' | 'permissions' | 'system_key'>): ConfirmBase {
  return {
    title: `Archive ${role.name}?`,
    message:
      'Nobody holds this role, so no admin’s access changes. An archived role cannot be assigned or edited until it is restored.',
    details: [
      { label: 'Role', value: role.name },
      { label: 'Permissions', value: roleSummary(role, { total: 0, active: 0 }).actions_label },
    ],
    reason: { required: true, label: 'Reason for archiving', maxLength: REASON_MAX },
    confirmLabel: 'Archive role',
    pendingLabel: 'Archiving…',
  };
}

export function restoreConfirm(role: Pick<RoleRow, 'name' | 'permissions' | 'system_key'>): ConfirmBase {
  return {
    title: `Restore ${role.name}?`,
    message: 'The role can be assigned and edited again. Nobody holds it, so no admin’s access changes.',
    details: [
      { label: 'Role', value: role.name },
      { label: 'Permissions', value: roleSummary(role, { total: 0, active: 0 }).actions_label },
    ],
    reason: { required: true, label: 'Reason for restoring', maxLength: REASON_MAX },
    confirmLabel: 'Restore role',
    pendingLabel: 'Restoring…',
  };
}

export function archiveSuccessText(archived: boolean, name: string): string {
  return archived ? `Archived the role ${name}.` : `Restored the role ${name}.`;
}
