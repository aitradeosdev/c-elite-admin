import { ALL_PERMISSIONS, resolvePermissions, type Permission, type PermissionRisk } from './permissions';
import { actionDiff, checkNewKeys, grantRefusalMessage, normalizeGrants } from './grants';
import { ERROR_MESSAGE, ERROR_STATUS, isUuid, type ApiErrorCode } from './http';

export const ROLE_NAME_MIN = 2;
export const ROLE_NAME_MAX = 64;
export const ROLE_DESCRIPTION_MAX = 500;
export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const SYSTEM_ROLE_KEY = 'super_admin';
export const REASON_MESSAGE = `Enter a reason of ${REASON_MIN} to ${REASON_MAX} characters.`;

const MAX_PERMISSION_KEYS = 128;
const SUPER_ADMIN_TEXT = 'Super admins hold every permission, so roles do not apply.';
const ROLE_MISSING_TEXT = 'That role does not exist.';
const UNASSIGNABLE_TEXT = 'This role cannot be assigned.';
const ARCHIVED_ROLE_TEXT = 'This role is archived.';
const ROLE_FK = 'admin_users_role_id_fkey';
const DIRECT_CHECK = 'admin_users_direct_permissions_valid';

export interface RoleRow {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  system_key: string | null;
  is_protected: boolean;
  version: number;
  archived_at: string | null;
  archived_by: string | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export interface RoleDraftInput {
  name?: unknown;
  description?: unknown;
  permissions?: unknown;
  reason?: unknown;
}

export interface RoleDraft {
  name: string;
  description: string;
  permissions: string[];
  reason: string | null;
}

export type RoleDraftField = 'name' | 'description' | 'permissions' | 'reason';

export type RoleDraftCheck =
  | { ok: true; draft: RoleDraft }
  | { ok: false; field: RoleDraftField; message: string; keys?: string[] };

export interface RoleMemberCounts {
  total: number;
  active: number;
}

export interface RoleSummary {
  member_count: number;
  active_member_count: number;
  action_count: number;
  actions_label: string;
}

export interface RpcFailure {
  code: ApiErrorCode;
  status: number;
  message: string;
  details?: Record<string, unknown>;
}

export interface AffectedAdmin {
  admin_id: string;
  username: string;
  is_active: boolean;
  gained: Permission[];
  lost: Permission[];
  highest_risk: PermissionRisk | null;
}

export interface UnchangedAdmin {
  admin_id: string;
  username: string;
  why: 'super_admin' | 'same_access';
}

export interface Impact {
  members_total: number;
  affected: AffectedAdmin[];
  unchanged: UnchangedAdmin[];
  signed_out_count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function charLength(value: string): number {
  return Array.from(value).length;
}

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? one : many}`;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function uuidOrNull(value: unknown): string | null {
  return isUuid(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function checkRoleDraft(
  input: RoleDraftInput,
  currentPermissions: readonly string[] | null | undefined,
): RoleDraftCheck {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (charLength(name) < ROLE_NAME_MIN || charLength(name) > ROLE_NAME_MAX) {
    return { ok: false, field: 'name', message: `Role name must be ${ROLE_NAME_MIN}–${ROLE_NAME_MAX} characters.` };
  }
  if (input.description !== undefined && input.description !== null && typeof input.description !== 'string') {
    return { ok: false, field: 'description', message: 'The description must be text.' };
  }
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (charLength(description) > ROLE_DESCRIPTION_MAX) {
    return {
      ok: false,
      field: 'description',
      message: `The description must be ${ROLE_DESCRIPTION_MAX} characters or fewer.`,
    };
  }
  const raw = input.permissions;
  if (!Array.isArray(raw) || raw.some((key) => typeof key !== 'string')) {
    return { ok: false, field: 'permissions', message: 'permissions must be a list of permission keys.' };
  }
  if (raw.length > MAX_PERMISSION_KEYS) return { ok: false, field: 'permissions', message: 'Too many permission keys.' };
  const permissions = normalizeGrants(raw);
  const refused = checkNewKeys(permissions, currentPermissions, 'role');
  if (refused) return { ok: false, field: 'permissions', message: refused.message, keys: refused.keys };
  let reason: string | null = null;
  if ('reason' in input) {
    reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (charLength(reason) < REASON_MIN || charLength(reason) > REASON_MAX) {
      return { ok: false, field: 'reason', message: REASON_MESSAGE };
    }
  }
  return { ok: true, draft: { name, description, permissions, reason } };
}

export function parseRoleRow(raw: unknown): RoleRow | null {
  if (!isRecord(raw)) return null;
  const id = raw.id;
  const name = raw.name;
  const version = raw.version;
  if (!isUuid(id) || typeof name !== 'string') return null;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
  return {
    id,
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    permissions: Array.isArray(raw.permissions) ? normalizeGrants(raw.permissions) : [],
    system_key: textOrNull(raw.system_key),
    is_protected: raw.is_protected === true,
    version,
    archived_at: textOrNull(raw.archived_at),
    archived_by: uuidOrNull(raw.archived_by),
    created_at: textOrNull(raw.created_at),
    created_by: uuidOrNull(raw.created_by),
    updated_at: textOrNull(raw.updated_at),
    updated_by: uuidOrNull(raw.updated_by),
  };
}

export function roleSummary(role: Pick<RoleRow, 'permissions' | 'system_key'>, members: RoleMemberCounts): RoleSummary {
  const all = role.system_key === SYSTEM_ROLE_KEY;
  const actionCount = all ? ALL_PERMISSIONS.length : resolvePermissions(role.permissions, false).size;
  return {
    member_count: members.total,
    active_member_count: members.active,
    action_count: actionCount,
    actions_label: all ? 'All permissions' : plural(actionCount, 'action'),
  };
}

export function assignableRole(role: Pick<RoleRow, 'system_key' | 'archived_at'>): boolean {
  return role.system_key === null && role.archived_at === null;
}

function failure(code: ApiErrorCode, message?: string, details?: Record<string, unknown>): RpcFailure {
  const out: RpcFailure = { code, status: ERROR_STATUS[code], message: message ?? ERROR_MESSAGE[code] };
  if (details) out.details = details;
  return out;
}

function reasonFailure(result: Record<string, unknown>, reason: string): RpcFailure {
  switch (reason) {
    case 'invalid':
      return failure('VALIDATION_ERROR', undefined, { reason });
    case 'reason_required':
      return failure('VALIDATION_ERROR', REASON_MESSAGE, { reason });
    case 'not_grantable': {
      const keys = stringList(result.keys);
      return failure('VALIDATION_ERROR', grantRefusalMessage(keys, 'direct'), { reason, keys });
    }
    case 'role_not_found':
      return failure('VALIDATION_ERROR', ROLE_MISSING_TEXT, { reason });
    case 'not_found':
      return failure('RESOURCE_NOT_FOUND', undefined, { reason });
    case 'protected':
      return failure('STATE_CONFLICT', 'This role is protected and cannot be changed.', { reason });
    case 'archived':
      return failure('STATE_CONFLICT', 'This role is archived. Restore it before changing it.', { reason });
    case 'role_protected':
      return failure('STATE_CONFLICT', UNASSIGNABLE_TEXT, { reason });
    case 'role_archived':
      return failure('STATE_CONFLICT', ARCHIVED_ROLE_TEXT, { reason });
    case 'super_admin':
      return failure('STATE_CONFLICT', SUPER_ADMIN_TEXT, { reason });
    case 'stale': {
      const version = result.version;
      return failure('STATE_CONFLICT', undefined, Number.isInteger(version) ? { reason, version } : { reason });
    }
    case 'name_taken':
      return failure('STATE_CONFLICT', 'Another role already has this name.', { reason });
    case 'in_use': {
      const members = (Array.isArray(result.members) ? result.members : [])
        .filter(isRecord)
        .filter((member) => typeof member.admin_id === 'string')
        .map((member) => ({ admin_id: member.admin_id, username: typeof member.username === 'string' ? member.username : null }));
      return failure('STATE_CONFLICT', 'Admins still hold this role. Move them to another role first.', { reason, members });
    }
    case 'unchanged':
      return failure('STATE_CONFLICT', 'The role is already in that state.', { reason });
    default:
      return failure('INTERNAL_ERROR');
  }
}

function errorFailure(error: Record<string, unknown>, message: string): RpcFailure {
  switch (message) {
    case 'Not authorized':
      return failure('PERMISSION_DENIED', 'This action is restricted to super administrators.');
    case 'This role cannot be assigned':
      return failure('STATE_CONFLICT', UNASSIGNABLE_TEXT, { reason: 'role_protected' });
    case 'This role is archived':
      return failure('STATE_CONFLICT', ARCHIVED_ROLE_TEXT, { reason: 'role_archived' });
    case 'Roles do not apply to super admins':
      return failure('STATE_CONFLICT', SUPER_ADMIN_TEXT, { reason: 'super_admin' });
    case 'Change the role and the page permissions separately':
      return failure('VALIDATION_ERROR', 'Change the role and the page permissions separately.', { reason: 'invalid' });
    case 'This permission cannot be granted':
      return failure('VALIDATION_ERROR', 'This permission cannot be granted.', { reason: 'not_grantable' });
    default:
      break;
  }
  const mentions = (name: string) => message.includes(name) || (typeof error.details === 'string' && error.details.includes(name));
  if (error.code === '23503' && mentions(ROLE_FK)) {
    return failure('VALIDATION_ERROR', ROLE_MISSING_TEXT, { reason: 'role_not_found' });
  }
  if (error.code === '23514' && mentions(DIRECT_CHECK)) {
    return failure('VALIDATION_ERROR', 'A permission key is not valid.', { reason: 'invalid' });
  }
  return failure('INTERNAL_ERROR');
}

export function rpcFailure(value: unknown): RpcFailure {
  if (!isRecord(value)) return failure('INTERNAL_ERROR');
  if (value.ok === false && typeof value.reason === 'string') return reasonFailure(value, value.reason);
  if (typeof value.message === 'string') return errorFailure(value, value.message);
  return failure('INTERNAL_ERROR');
}

export function buildImpact(members: unknown): Impact {
  const affected: AffectedAdmin[] = [];
  const unchanged: UnchangedAdmin[] = [];
  for (const member of Array.isArray(members) ? members : []) {
    if (!isRecord(member)) continue;
    const adminId = member.admin_id;
    if (typeof adminId !== 'string') continue;
    const username = typeof member.username === 'string' ? member.username : '';
    if (member.changed === true) {
      const diff = actionDiff(stringList(member.before), stringList(member.after));
      affected.push({
        admin_id: adminId,
        username,
        is_active: member.is_active === true,
        gained: diff.gained,
        lost: diff.lost,
        highest_risk: diff.highest_risk,
      });
    } else {
      unchanged.push({
        admin_id: adminId,
        username,
        why: member.is_super_admin === true ? 'super_admin' : 'same_access',
      });
    }
  }
  return {
    members_total: affected.length + unchanged.length,
    affected,
    unchanged,
    signed_out_count: affected.filter((admin) => admin.is_active).length,
  };
}

export function impactSentence(impact: Pick<Impact, 'affected'>): string {
  const count = impact.affected.length;
  return count === 0 ? 'No admin’s access changes.' : `${plural(count, 'admin')} will be affected.`;
}
