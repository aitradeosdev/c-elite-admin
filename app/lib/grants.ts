import {
  ALL_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  PERMISSION_CATALOG,
  isPermission,
  permissionStatus,
  resolvePermissions,
  type Permission,
  type PermissionRisk,
} from './permissions';

export const RETIRED_PAGE_KEYS: readonly string[] = [
  'manual_wallet_credit',
  'field_builder',
  'feature_overrides',
  'flagged_transactions',
  'giftbox',
];

const RESTRICTED_PAGE_KEY = 'admin_accounts';
const PAGE_KEYS: readonly string[] = Object.keys(LEGACY_PERMISSION_MAP);
const PAGES: ReadonlySet<string> = new Set(PAGE_KEYS);

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

export type GrantTarget = 'role' | 'direct';

export interface GrantRefusal {
  keys: string[];
  message: string;
}

export interface ActionDiff {
  gained: Permission[];
  lost: Permission[];
  highest_risk: PermissionRisk | null;
}

export interface PhoneEditProblem {
  status: 409;
  message: string;
}

const PHONE_STALE_MESSAGE = 'This admin’s access changed since you opened it. Reload and try again.';

function grantable(permission: Permission): boolean {
  return permissionStatus(permission) === 'enforced';
}

function refusedKey(key: string): boolean {
  if (key === RESTRICTED_PAGE_KEY) return true;
  if (isPermission(key)) return !grantable(key);
  return !PAGES.has(key);
}

export function composeGrants(
  roleKeys: readonly string[] | null | undefined,
  direct: readonly string[] | null | undefined,
): string[] {
  return normalizeGrants([...(roleKeys ?? []), ...(direct ?? [])]).sort();
}

export function matrixFromKeys(keys: readonly string[] | null | undefined): Set<Permission> {
  return resolvePermissions(keys, false);
}

export function keysFromMatrix(
  originalKeys: readonly string[] | null | undefined,
  ticked: ReadonlySet<Permission>,
  keepOther = false,
): string[] {
  const stored = normalizeGrants(originalKeys);
  const storedSet = new Set(stored);
  const covered = new Set<Permission>();
  const out: string[] = [];
  for (const key of stored) {
    if (PAGES.has(key) && key !== RESTRICTED_PAGE_KEY) {
      const bundle = LEGACY_PERMISSION_MAP[key];
      if (bundle.every((permission) => !grantable(permission) || ticked.has(permission))) {
        out.push(key);
        for (const permission of bundle) covered.add(permission);
      }
    } else if (!isPermission(key) && keepOther) {
      out.push(key);
    }
  }
  for (const permission of ALL_PERMISSIONS) {
    if (!ticked.has(permission)) continue;
    if (storedSet.has(permission) || (!covered.has(permission) && grantable(permission))) out.push(permission);
  }
  return sortGrants(out);
}

export function grantRefusalMessage(keys: readonly string[], kind: GrantTarget): string {
  const subject = keys.length > 1 ? 'These permissions' : 'This permission';
  const verb = kind === 'role' ? 'cannot be added to a role' : 'cannot be granted';
  return keys.length ? `${subject} ${verb}: ${keys.join(', ')}.` : `${subject} ${verb}.`;
}

export function checkNewKeys(
  next: readonly string[],
  current: readonly string[] | null | undefined,
  kind: GrantTarget,
): GrantRefusal | null {
  const held = new Set(normalizeGrants(current));
  const keys = sortGrants(normalizeGrants(next).filter((key) => !held.has(key) && refusedKey(key)));
  return keys.length ? { keys, message: grantRefusalMessage(keys, kind) } : null;
}

export function actionDiff(
  beforeKeys: readonly string[] | null | undefined,
  afterKeys: readonly string[] | null | undefined,
): ActionDiff {
  const before = resolvePermissions(beforeKeys, false);
  const after = resolvePermissions(afterKeys, false);
  const gained = ALL_PERMISSIONS.filter((key) => after.has(key) && !before.has(key));
  const lost = ALL_PERMISSIONS.filter((key) => before.has(key) && !after.has(key));
  return { gained, lost, highest_risk: highestRisk([...gained, ...lost]) };
}

export function copyableKeys(directKeys: readonly string[] | null | undefined): string[] {
  return normalizeGrants(directKeys).filter((key) => !refusedKey(key));
}

export function foldIntoRole(
  direct: readonly string[] | null | undefined,
  roleKeys: readonly string[] | null | undefined,
): string[] {
  const literal = new Set(normalizeGrants(roleKeys));
  const covered = resolvePermissions(roleKeys, false);
  return normalizeGrants(direct).filter((key) => !literal.has(key) && !(isPermission(key) && covered.has(key)));
}

export function phoneEditProblem(
  sent: readonly string[],
  current: readonly string[] | null | undefined,
  roleKeys: readonly string[] | null | undefined,
  roleName: string | null | undefined,
): PhoneEditProblem | null {
  const next = normalizeGrants(sent);
  const stored = normalizeGrants(current);
  const dotted = (keys: readonly string[]) => keys.filter((key) => key.includes('.'));
  if (!sameGrants(dotted(next), dotted(stored))) return { status: 409, message: PHONE_STALE_MESSAGE };
  const kept = new Set(next);
  const held = new Set(stored);
  const removed = normalizeGrants(roleKeys).filter((key) => held.has(key) && !kept.has(key));
  if (removed.length === 0) return null;
  const source = roleName ? `the role ${roleName}` : 'their role';
  return removed.length === 1
    ? { status: 409, message: `${removed[0]} comes from ${source}. Change it in the web console.` }
    : { status: 409, message: `${removed.join(', ')} come from ${source}. Change them in the web console.` };
}
