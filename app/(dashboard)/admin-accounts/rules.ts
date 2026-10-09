import {
  ALL_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  PERMISSION_CATALOG,
  isPermission,
  resolvePermissions,
  type Permission,
  type PermissionRisk,
} from '../../lib/permissions';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const ROLE_TITLE_MIN = 2;
export const ROLE_TITLE_MAX = 64;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const REASON_MAX = 500;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const RESTRICTED_PAGE_KEYS: readonly string[] = ['admin_accounts'];

export const RETIRED_PAGE_KEYS: readonly string[] = [
  'manual_wallet_credit',
  'field_builder',
  'feature_overrides',
  'flagged_transactions',
  'giftbox',
];

export const PAGE_KEYS: readonly string[] = Object.keys(LEGACY_PERMISSION_MAP);

const PAGES: ReadonlySet<string> = new Set(PAGE_KEYS);
const RESTRICTED: ReadonlySet<string> = new Set(RESTRICTED_PAGE_KEYS);
const RETIRED: ReadonlySet<string> = new Set(RETIRED_PAGE_KEYS);

export const GRANTABLE_PAGE_KEYS: readonly string[] = PAGE_KEYS.filter((key) => !RESTRICTED.has(key));

const PAGE_GRANTED: ReadonlySet<Permission> = new Set(PAGE_KEYS.flatMap((key) => LEGACY_PERMISSION_MAP[key]));

export const ADDITIONAL_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter((key) => !PAGE_GRANTED.has(key));

const ACCEPTED: ReadonlySet<string> = new Set<string>([...PAGE_KEYS, ...RETIRED_PAGE_KEYS, ...ADDITIONAL_PERMISSIONS]);

export const MAX_GRANT_KEYS = ACCEPTED.size;

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

export const RISK_ORDER: readonly PermissionRisk[] = ['critical', 'high', 'medium', 'low'];

const RISK_RANK: Readonly<Record<PermissionRisk, number>> = { low: 0, medium: 1, high: 2, critical: 3 };

export function highestRisk(permissions: Iterable<Permission>): PermissionRisk | null {
  let best: PermissionRisk | null = null;
  for (const permission of permissions) {
    const risk = PERMISSION_CATALOG[permission].risk;
    if (best === null || RISK_RANK[risk] > RISK_RANK[best]) best = risk;
  }
  return best;
}

export function grantedActions(key: string): readonly Permission[] {
  if (PAGES.has(key)) return LEGACY_PERMISSION_MAP[key];
  if (isPermission(key)) return [key];
  return [];
}

export function grantRisk(key: string): PermissionRisk | null {
  return highestRisk(grantedActions(key));
}

export function normalizeGrants(keys: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of keys ?? []) {
    if (typeof key !== 'string' || key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function sameGrants(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;
  return true;
}

export function effectiveActions(keys: readonly string[]): Set<Permission> {
  return resolvePermissions(keys.filter((key) => PAGES.has(key) || isPermission(key)), false);
}

const ORDER: ReadonlyMap<string, number> = new Map<string, number>([
  ...PAGE_KEYS.map((key, index) => [key, index] as const),
  ...ALL_PERMISSIONS.map((key, index) => [key, PAGE_KEYS.length + index] as const),
  ...RETIRED_PAGE_KEYS.map((key, index) => [key, PAGE_KEYS.length + ALL_PERMISSIONS.length + index] as const),
]);

export function sortGrants(keys: Iterable<string>): string[] {
  const unplaced = Number.MAX_SAFE_INTEGER;
  return Array.from(keys).sort((a, b) => {
    const delta = (ORDER.get(a) ?? unplaced) - (ORDER.get(b) ?? unplaced);
    return delta !== 0 ? delta : a < b ? -1 : a > b ? 1 : 0;
  });
}

export interface GrantChange {
  added: string[];
  removed: string[];
  gained: Permission[];
  lost: Permission[];
}

export function diffGrants(before: readonly string[], after: readonly string[]): GrantChange {
  const was = new Set(before);
  const now = new Set(after);
  const beforeActions = effectiveActions(before);
  const afterActions = effectiveActions(after);
  return {
    added: sortGrants([...now].filter((key) => !was.has(key))),
    removed: sortGrants([...was].filter((key) => !now.has(key))),
    gained: ALL_PERMISSIONS.filter((key) => afterActions.has(key) && !beforeActions.has(key)),
    lost: ALL_PERMISSIONS.filter((key) => beforeActions.has(key) && !afterActions.has(key)),
  };
}

export function grantChangeRecord(change: GrantChange) {
  return {
    added: change.added,
    removed: change.removed,
    actions_gained: change.gained,
    actions_lost: change.lost,
  };
}

export type GrantCheck = { ok: true; keys: string[] } | { ok: false; message: string };

export function checkGrants(input: unknown): GrantCheck {
  if (!Array.isArray(input)) return { ok: false, message: 'page_permissions must be an array of permission keys.' };
  if (input.length > MAX_GRANT_KEYS) return { ok: false, message: 'Too many permission keys.' };
  for (const key of input) {
    if (!isAcceptedGrant(key)) {
      return { ok: false, message: `Unknown permission key: ${String(key).slice(0, 32)}` };
    }
  }
  return { ok: true, keys: normalizeGrants(input) };
}

export type PasswordRule = 'length' | 'lower' | 'upper' | 'digit' | 'symbol';

export const PASSWORD_RULES: ReadonlyArray<{ id: PasswordRule; label: string }> = [
  { id: 'length', label: `At least ${PASSWORD_MIN} characters` },
  { id: 'lower', label: 'A lowercase letter' },
  { id: 'upper', label: 'An uppercase letter' },
  { id: 'digit', label: 'A number' },
  { id: 'symbol', label: 'A symbol' },
];

const PASSWORD_MESSAGES: Readonly<Record<PasswordRule, string>> = {
  length: `Password must be at least ${PASSWORD_MIN} characters.`,
  lower: 'Password must include a lowercase letter.',
  upper: 'Password must include an uppercase letter.',
  digit: 'Password must include a number.',
  symbol: 'Password must include a symbol.',
};

export function unmetPasswordRules(password: string): PasswordRule[] {
  const unmet: PasswordRule[] = [];
  if (password.length < PASSWORD_MIN) unmet.push('length');
  if (!/[a-z]/.test(password)) unmet.push('lower');
  if (!/[A-Z]/.test(password)) unmet.push('upper');
  if (!/[0-9]/.test(password)) unmet.push('digit');
  if (!/[^a-zA-Z0-9]/.test(password)) unmet.push('symbol');
  return unmet;
}

export function checkPassword(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return 'A password is required.';
  if (value.length > PASSWORD_MAX) return `Password must be ${PASSWORD_MAX} characters or fewer.`;
  const unmet = unmetPasswordRules(value);
  return unmet.length ? PASSWORD_MESSAGES[unmet[0]] : null;
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
  return typeof value === 'string' && EMAIL_PATTERN.test(value);
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
  password: string;
  role_title: string;
  page_permissions: string[];
}

export type CreateCheck = { ok: true; value: NewAdmin } | { ok: false; message: string };

export function checkCreate(input: CreateInput): CreateCheck {
  const { username, email, password, role_title: roleTitle, page_permissions: grants } = input;
  if (!username || !password || !roleTitle || !email) {
    return { ok: false, message: 'Username, email, password and role title are required.' };
  }
  if (!isEmail(email)) return { ok: false, message: 'Enter a valid email address.' };
  const passwordProblem = checkPassword(password);
  if (passwordProblem) return { ok: false, message: passwordProblem };
  const usernameProblem = checkUsername(username);
  if (usernameProblem) return { ok: false, message: usernameProblem };
  const roleProblem = checkRoleTitle(roleTitle);
  if (roleProblem) return { ok: false, message: roleProblem };
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
      email,
      password: password as string,
      role_title: roleTitle as string,
      page_permissions: keys,
    },
  };
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

export type RuleFailure = { ok: false; code: 'VALIDATION_ERROR' | 'STATE_CONFLICT'; message: string };

export type EditPlanResult = { ok: true; plan: EditPlan } | RuleFailure;

const invalid = (message: string): RuleFailure => ({ ok: false, code: 'VALIDATION_ERROR', message });
const conflict = (message: string): RuleFailure => ({ ok: false, code: 'STATE_CONFLICT', message });

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
    const checked = checkGrants(input.page_permissions === null ? [] : input.page_permissions);
    if (!checked.ok) return invalid(checked.message);
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
      next = rawEmail;
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
    || changed.includes('page_permissions')
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

export type DeletePlanResult = { ok: true; before: Record<string, unknown> } | RuleFailure;

export function planDelete(state: AdminState): DeletePlanResult {
  if (state.deleted_at) return conflict('This admin account was already deleted.');
  if (state.is_super_admin) return invalid('Super admin accounts cannot be deleted.');
  if (state.is_active) return conflict('Deactivate this admin before deleting the account.');
  return { ok: true, before: stateRecord(state) };
}
