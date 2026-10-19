import {
  ALL_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  isPermission,
  type Permission,
} from '../../lib/permissions';
import {
  RETIRED_PAGE_KEYS,
  checkNewKeys,
  diffGrants,
  grantChangeRecord,
  normalizeGrants,
  phoneEditProblem,
  sameGrants,
  type GrantChange,
} from '../../lib/grants';
import { checkPassword } from '../../lib/passwordPolicy';

export {
  PASSWORD_MAX,
  PASSWORD_MIN,
  PASSWORD_RULES,
  checkPassword,
  unmetPasswordRules,
} from '../../lib/passwordPolicy';
export type { PasswordRule } from '../../lib/passwordPolicy';

export {
  RETIRED_PAGE_KEYS,
  RISK_ORDER,
  diffGrants,
  effectiveActions,
  grantChangeRecord,
  grantRisk,
  grantedActions,
  highestRisk,
  normalizeGrants,
  sameGrants,
  sortGrants,
} from '../../lib/grants';
export type { GrantChange } from '../../lib/grants';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const ROLE_TITLE_MIN = 2;
export const ROLE_TITLE_MAX = 64;
export const REASON_MAX = 500;

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export const INVITE_PASSWORD_MESSAGE = 'Passwords are chosen by the new admin from the invitation email.';

export const RESTRICTED_PAGE_KEYS: readonly string[] = ['admin_accounts'];

export const PAGE_KEYS: readonly string[] = Object.keys(LEGACY_PERMISSION_MAP);

const PAGES: ReadonlySet<string> = new Set(PAGE_KEYS);
const RESTRICTED: ReadonlySet<string> = new Set(RESTRICTED_PAGE_KEYS);
const RETIRED: ReadonlySet<string> = new Set(RETIRED_PAGE_KEYS);

export const GRANTABLE_PAGE_KEYS: readonly string[] = PAGE_KEYS.filter((key) => !RESTRICTED.has(key));

const PAGE_GRANTED: ReadonlySet<Permission> = new Set(PAGE_KEYS.flatMap((key) => LEGACY_PERMISSION_MAP[key]));

export const ADDITIONAL_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter((key) => !PAGE_GRANTED.has(key));

const ACCEPTED: ReadonlySet<string> = new Set<string>([...PAGE_KEYS, ...RETIRED_PAGE_KEYS, ...ADDITIONAL_PERMISSIONS]);

export const MAX_GRANT_KEYS = 256;

export type GrantKind = 'page' | 'restricted' | 'retired' | 'additional' | 'unknown';

export function grantKind(key: string): GrantKind {
  if (RESTRICTED.has(key)) return 'restricted';
  if (PAGES.has(key)) return 'page';
  if (RETIRED.has(key)) return 'retired';
  if (isPermission(key) && !PAGE_GRANTED.has(key)) return 'additional';
  return 'unknown';
}

export function isAcceptedGrant(value: unknown): value is string {
  return typeof value === 'string' && ACCEPTED.has(value);
}

export type RuleFailure = {
  ok: false;
  code: 'VALIDATION_ERROR' | 'STATE_CONFLICT';
  message: string;
  details?: Record<string, unknown>;
};

const invalid = (message: string, details?: Record<string, unknown>): RuleFailure =>
  details ? { ok: false, code: 'VALIDATION_ERROR', message, details } : { ok: false, code: 'VALIDATION_ERROR', message };
const conflict = (message: string): RuleFailure => ({ ok: false, code: 'STATE_CONFLICT', message });

export interface HeldGrants {
  stored?: readonly string[] | null;
  roleKeys?: readonly string[] | null;
  roleName?: string | null;
}

export type GrantCheck = { ok: true; keys: string[] } | RuleFailure;

export function checkGrants(input: unknown, held: HeldGrants = {}): GrantCheck {
  if (!Array.isArray(input)) return invalid('page_permissions must be an array of permission keys.');
  if (input.length > MAX_GRANT_KEYS) return invalid('Too many permission keys.');
  if (input.some((key) => typeof key !== 'string')) return invalid('page_permissions must be an array of permission keys.');
  const keys = normalizeGrants(input);
  const stored = normalizeGrants(held.stored);
  const refused = checkNewKeys(keys.filter((key) => !key.includes('.')), stored, 'direct');
  if (refused) return invalid(refused.message, { reason: 'not_grantable', keys: refused.keys });
  const problem = phoneEditProblem(keys, stored, held.roleKeys, held.roleName);
  if (problem) return conflict(problem.message);
  return { ok: true, keys };
}

export function checkUsername(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < USERNAME_MIN || value.length > USERNAME_MAX) {
    return `Username must be ${USERNAME_MIN}–${USERNAME_MAX} characters.`;
  }
  return null;
}

export function checkRoleTitle(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < ROLE_TITLE_MIN || value.length > ROLE_TITLE_MAX) {
    return `Role title must be ${ROLE_TITLE_MIN}–${ROLE_TITLE_MAX} characters.`;
  }
  return null;
}

export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_PATTERN.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export type ReasonCheck = { ok: true; reason: string | null } | { ok: false; message: string };

export function checkReason(value: unknown): ReasonCheck {
  if (value === undefined || value === null) return { ok: true, reason: null };
  if (typeof value !== 'string') return { ok: false, message: 'The reason must be text.' };
  const reason = value.trim();
  if (reason.length > REASON_MAX) {
    return { ok: false, message: `The reason must be ${REASON_MAX} characters or fewer.` };
  }
  return { ok: true, reason: reason || null };
}

export interface CreateInput {
  username?: unknown;
  email?: unknown;
  password?: unknown;
  role_title?: unknown;
  page_permissions?: unknown;
}

export interface NewAdmin {
  username: string;
  email: string;
  password: string | null;
  role_title: string;
  page_permissions: string[];
}

export type CreateCheck = { ok: true; value: NewAdmin } | RuleFailure;

export function checkCreate(input: CreateInput, client: 'web' | 'mobile'): CreateCheck {
  const { username, email, password, role_title: roleTitle, page_permissions: grants } = input;
  const web = client === 'web';
  if (web && password !== undefined) return invalid(INVITE_PASSWORD_MESSAGE);
  if (!username || !roleTitle || !email || (!web && !password)) {
    return invalid(web ? 'Username, email and role title are required.' : 'Username, email, password and role title are required.');
  }
  if (!isEmail(email)) return invalid('Enter a valid email address.');
  if (!web) {
    const passwordProblem = checkPassword(password);
    if (passwordProblem) return invalid(passwordProblem);
  }
  const usernameProblem = checkUsername(username);
  if (usernameProblem) return invalid(usernameProblem);
  const roleProblem = checkRoleTitle(roleTitle);
  if (roleProblem) return invalid(roleProblem);
  let keys: string[] = [];
  if (grants !== undefined && grants !== null) {
    const checked = checkGrants(grants);
    if (!checked.ok) return checked;
    keys = checked.keys;
  }
  return {
    ok: true,
    value: {
      username: username as string,
      email: normalizeEmail(email),
      password: web ? null : (password as string),
      role_title: roleTitle as string,
      page_permissions: keys,
    },
  };
}

export interface AdminRoleState {
  id: string;
  name: string | null;
  archived_at?: string | null;
  permissions?: readonly string[] | null;
}

export interface AdminState {
  id: string;
  username: string | null;
  email: string | null;
  role_title: string | null;
  page_permissions: readonly string[] | null;
  is_active: boolean | null;
  is_super_admin: boolean | null;
  deleted_at: string | null;
  token_version: number | null;
  role_id?: string | null;
  direct_permissions?: readonly string[] | null;
  role?: AdminRoleState | null;
}

export interface EditInput {
  email?: unknown;
  password?: unknown;
  role_title?: unknown;
  page_permissions?: unknown;
  is_active?: unknown;
  revoke_sessions?: unknown;
  expected?: unknown;
}

export interface EditExpectation {
  email?: string | null;
  role_title?: string | null;
  page_permissions?: readonly string[] | null;
}

export const EXPECTATION_MESSAGE =
  'This admin account changed after you reviewed it, so nothing was saved. Review the changes again.';

function sameText(a: unknown, b: unknown): boolean {
  const left = typeof a === 'string' ? a.trim() : '';
  const right = typeof b === 'string' ? b.trim() : '';
  return left === right;
}

export function expectationProblem(state: AdminState, expected: unknown): string | null {
  if (expected === undefined || expected === null) return null;
  if (typeof expected !== 'object' || Array.isArray(expected)) return 'expected must be an object.';
  const record = expected as Record<string, unknown>;
  if ('email' in record && !sameText(record.email, state.email)) return EXPECTATION_MESSAGE;
  if ('role_title' in record && !sameText(record.role_title, state.role_title)) return EXPECTATION_MESSAGE;
  if ('page_permissions' in record) {
    const grants = record.page_permissions;
    if (grants !== null && !Array.isArray(grants)) return 'expected.page_permissions must be an array.';
    if (!sameGrants(normalizeGrants(grants as unknown[] | null), normalizeGrants(state.page_permissions))) {
      return EXPECTATION_MESSAGE;
    }
  }
  return null;
}

export type EditAction = 'REVOKE_ADMIN_SESSIONS' | 'REACTIVATE_ADMIN' | 'DEACTIVATE_ADMIN' | 'EDIT_ADMIN';

export type EditField = 'email' | 'role_title' | 'page_permissions' | 'is_active' | 'password';

export interface EditUpdates {
  email?: string | null;
  role_title?: string;
  page_permissions?: string[];
  is_active?: boolean;
  token_version?: number;
}

export interface EditPlan {
  action: EditAction;
  updates: EditUpdates;
  password: string | null;
  changed: readonly EditField[];
  revokesSessions: boolean;
  deactivatesSuperAdmin: boolean;
  grants: GrantChange | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export type EditPlanResult = { ok: true; plan: EditPlan } | RuleFailure;

export const SELF_REVOKE_MESSAGE =
  'You cannot deactivate or revoke your own session here. Sign out from your account instead.';

export const EMAIL_REMOVAL_MESSAGE =
  'An admin’s email cannot be removed, because admins sign in with it. Enter a new email instead.';

function stateRecord(state: AdminState) {
  return {
    username: state.username,
    email: state.email,
    role_title: state.role_title,
    page_permissions: normalizeGrants(state.page_permissions),
    is_active: state.is_active,
    is_super_admin: state.is_super_admin,
  };
}

export function planEdit(state: AdminState, input: EditInput, actorId: string): EditPlanResult {
  if (state.deleted_at) return conflict('This admin account was deleted, so it can no longer be changed.');
  const expectation = expectationProblem(state, input.expected);
  if (expectation === EXPECTATION_MESSAGE) return conflict(expectation);
  if (expectation) return invalid(expectation);

  const revoke = Boolean(input.revoke_sessions);
  if (input.is_active !== undefined && typeof input.is_active !== 'boolean') {
    return invalid('is_active must be true or false.');
  }
  const nextActive = typeof input.is_active === 'boolean' ? input.is_active : undefined;
  if ((nextActive === false || revoke) && state.id === actorId) return invalid(SELF_REVOKE_MESSAGE);

  const updates: EditUpdates = {};
  const changed: EditField[] = [];
  const current = normalizeGrants(state.page_permissions);

  const rawRole = input.role_title;
  if (rawRole !== undefined) {
    const problem = checkRoleTitle(rawRole);
    if (problem) return invalid(problem);
    if (rawRole !== state.role_title) {
      updates.role_title = rawRole as string;
      changed.push('role_title');
    }
  }

  let grants: GrantChange | null = null;
  if (input.page_permissions !== undefined) {
    const checked = checkGrants(input.page_permissions === null ? [] : input.page_permissions, {
      stored: current,
      roleKeys: state.role?.permissions,
      roleName: state.role?.name,
    });
    if (!checked.ok) return checked;
    if (!sameGrants(current, checked.keys)) {
      updates.page_permissions = checked.keys;
      changed.push('page_permissions');
      grants = diffGrants(current, checked.keys);
    }
  }

  let password: string | null = null;
  if (input.password) {
    const problem = checkPassword(input.password);
    if (problem) return invalid(problem);
    password = input.password as string;
    changed.push('password');
  }

  const rawEmail = input.email;
  if (rawEmail !== undefined) {
    let next: string | null = null;
    if (rawEmail) {
      if (!isEmail(rawEmail)) return invalid('Enter a valid email address.');
      next = normalizeEmail(rawEmail);
    }
    if (next === null && state.email) return invalid(EMAIL_REMOVAL_MESSAGE);
    if (next !== state.email) {
      updates.email = next;
      changed.push('email');
    }
  }

  if (nextActive !== undefined && nextActive !== Boolean(state.is_active)) {
    updates.is_active = nextActive;
    changed.push('is_active');
  }

  const deactivating = updates.is_active === false;
  const revokesSessions = revoke
    || password !== null
    || changed.includes('role_title')
    || changed.includes('is_active');
  if (revokesSessions) updates.token_version = (state.token_version ?? 0) + 1;

  const action: EditAction = revoke
    ? 'REVOKE_ADMIN_SESSIONS'
    : updates.is_active !== undefined
      ? updates.is_active ? 'REACTIVATE_ADMIN' : 'DEACTIVATE_ADMIN'
      : 'EDIT_ADMIN';

  const after: Record<string, unknown> = {};
  if (updates.email !== undefined) after.email = updates.email;
  if (updates.role_title !== undefined) after.role_title = updates.role_title;
  if (updates.page_permissions !== undefined) after.page_permissions = updates.page_permissions;
  if (updates.is_active !== undefined) after.is_active = updates.is_active;
  if (password !== null) after.password_changed = true;
  if (revokesSessions) after.token_version_bumped = true;
  if (grants) after.grant_changes = grantChangeRecord(grants);

  return {
    ok: true,
    plan: {
      action,
      updates,
      password,
      changed,
      revokesSessions,
      deactivatesSuperAdmin: deactivating && state.is_super_admin === true,
      grants,
      before: stateRecord(state),
      after,
    },
  };
}

export interface SavedGrants {
  page_permissions: readonly string[] | null;
  token_version: number | null;
}

export interface SavedChange {
  after: Record<string, unknown>;
  sessionsRevoked: boolean;
}

export function savedChange(plan: EditPlan, state: AdminState, saved: SavedGrants): SavedChange {
  const sessionsRevoked = saved.token_version !== state.token_version;
  const after: Record<string, unknown> = { ...plan.after };
  delete after.token_version_bumped;
  if (plan.updates.page_permissions !== undefined) {
    const effective = normalizeGrants(saved.page_permissions);
    after.page_permissions = effective;
    after.grant_changes = grantChangeRecord(diffGrants(normalizeGrants(state.page_permissions), effective));
  }
  if (sessionsRevoked) after.token_version_bumped = true;
  return { after, sessionsRevoked };
}

export type DeletePlanResult = { ok: true; before: Record<string, unknown> } | RuleFailure;

export function planDelete(state: AdminState): DeletePlanResult {
  if (state.deleted_at) return conflict('This admin account was already deleted.');
  if (state.is_super_admin) return invalid('Super admin accounts cannot be deleted.');
  if (state.is_active) return conflict('Deactivate this admin before deleting the account.');
  return { ok: true, before: stateRecord(state) };
}
