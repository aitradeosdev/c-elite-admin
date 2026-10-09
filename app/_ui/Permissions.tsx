'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Permission } from '../lib/permissions';

export type PermissionMode = 'any' | 'all';

export interface UsePermissionsResult {
  readonly can: (permission: Permission) => boolean;
  readonly canAny: (permissions: readonly Permission[]) => boolean;
  readonly canAll: (permissions: readonly Permission[]) => boolean;
  readonly isSuperAdmin: boolean;
  readonly permissions: ReadonlySet<string>;
}

export interface PermissionsProviderProps {
  permissions: readonly string[];
  isSuperAdmin: boolean;
  children?: ReactNode;
}

export interface PermissionRequirement {
  permission?: Permission;
  anyOf?: readonly Permission[];
  allOf?: readonly Permission[];
}

export interface CanProps extends PermissionRequirement {
  fallback?: ReactNode;
  children?: ReactNode;
}

const KEY_SEPARATOR = ' ';
const WHITESPACE = /\s/;

const deny = (): boolean => false;

const refuseMutation = (): never => {
  throw new TypeError('Permissions are read-only');
};

function readOnlySet(values: Iterable<string>): ReadonlySet<string> {
  const set = new Set(values);
  Object.defineProperties(set, {
    add: { value: refuseMutation },
    delete: { value: refuseMutation },
    clear: { value: refuseMutation },
  });
  return Object.freeze(set);
}

export const NO_PERMISSIONS: UsePermissionsResult = Object.freeze({
  can: deny,
  canAny: deny,
  canAll: deny,
  isSuperAdmin: false,
  permissions: readOnlySet([]),
});

export function permissionsKey(permissions: readonly string[]): string {
  const keys = new Set<string>();
  for (const raw of Array.isArray(permissions) ? permissions : []) {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (key && !WHITESPACE.test(key)) keys.add(key);
  }
  return Array.from(keys).sort().join(KEY_SEPARATOR);
}

function fromKey(key: string, isSuperAdmin: boolean): UsePermissionsResult {
  const keys = key ? key.split(KEY_SEPARATOR) : [];
  const held = new Set(keys);
  const allows = (permission: unknown): boolean =>
    typeof permission === 'string' && permission !== '' && (isSuperAdmin || held.has(permission));
  return Object.freeze({
    can: allows,
    canAny: (list: readonly Permission[]) => Array.isArray(list) && list.some(allows),
    canAll: (list: readonly Permission[]) => Array.isArray(list) && list.every(allows),
    isSuperAdmin,
    permissions: readOnlySet(keys),
  });
}

export function createPermissions(permissions: readonly string[], isSuperAdmin: boolean): UsePermissionsResult {
  return fromKey(permissionsKey(permissions), isSuperAdmin === true);
}

export function permissionsAllow(permissions: UsePermissionsResult, requirement: PermissionRequirement): boolean {
  const { permission, anyOf, allOf } = requirement;
  if (permission === undefined && anyOf === undefined && allOf === undefined) return false;
  if (permission !== undefined && !permissions.can(permission)) return false;
  if (anyOf !== undefined && !permissions.canAny(anyOf)) return false;
  if (allOf !== undefined && !permissions.canAll(allOf)) return false;
  return true;
}

const PermissionsContext = createContext<UsePermissionsResult | null>(null);

export function PermissionsProvider({ permissions, isSuperAdmin, children }: PermissionsProviderProps) {
  const key = useMemo(() => permissionsKey(permissions), [permissions]);
  const superAdmin = isSuperAdmin === true;
  const value = useMemo(() => fromKey(key, superAdmin), [key, superAdmin]);
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): UsePermissionsResult {
  return useContext(PermissionsContext) ?? NO_PERMISSIONS;
}

export function useCan(permission: Permission | readonly Permission[], mode: PermissionMode = 'all'): boolean {
  const permissions = usePermissions();
  if (typeof permission === 'string') return permissions.can(permission);
  return mode === 'any' ? permissions.canAny(permission) : permissions.canAll(permission);
}

export function Can({ permission, anyOf, allOf, fallback = null, children }: CanProps) {
  const permissions = usePermissions();
  return <>{permissionsAllow(permissions, { permission, anyOf, allOf }) ? children : fallback}</>;
}
