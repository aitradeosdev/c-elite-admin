import type { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { verifyAdminFromRequest, type AdminJWTPayload } from './jwt';
import { resolvePermissions, type Permission } from './permissions';
import { clientIpFrom } from './http';
import { fail, requestId } from './api';

export interface AdminContext {
  admin_id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  permissions: Set<Permission>;
  ip: string;
  user_agent: string;
  request_id: string;
  can: (permission: Permission) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
  canAll: (permissions: readonly Permission[]) => boolean;
}

export type Guarded =
  | { ok: true; admin: AdminContext }
  | { ok: false; response: NextResponse };

async function buildContext(claims: AdminJWTPayload): Promise<AdminContext> {
  const h = await headers();
  const get = (name: string) => h.get(name);
  const permissions = resolvePermissions(claims.page_permissions, claims.is_super_admin);
  return {
    admin_id: claims.admin_id,
    username: claims.username,
    role_title: claims.role_title,
    is_super_admin: claims.is_super_admin,
    permissions,
    ip: clientIpFrom(get),
    user_agent: (get('user-agent') || '').slice(0, 512),
    request_id: await requestId(),
    can: (permission) => permissions.has(permission),
    canAny: (list) => list.some((p) => permissions.has(p)),
    canAll: (list) => list.every((p) => permissions.has(p)),
  };
}

async function authenticate(): Promise<Guarded> {
  const claims = await verifyAdminFromRequest();
  if (!claims) return { ok: false, response: await fail('AUTH_REQUIRED') };
  return { ok: true, admin: await buildContext(claims) };
}

function denied(permissions: readonly Permission[]): Promise<NextResponse> {
  return fail('PERMISSION_DENIED', undefined, { details: { required: permissions } });
}

export async function requireAdmin(permission?: Permission): Promise<Guarded> {
  const auth = await authenticate();
  if (!auth.ok) return auth;
  if (permission && !auth.admin.can(permission)) {
    return { ok: false, response: await denied([permission]) };
  }
  return auth;
}

export async function requireAdminAny(permissions: readonly Permission[]): Promise<Guarded> {
  const auth = await authenticate();
  if (!auth.ok) return auth;
  if (permissions.length && !auth.admin.canAny(permissions)) {
    return { ok: false, response: await denied(permissions) };
  }
  return auth;
}

export async function requireAdminAll(permissions: readonly Permission[]): Promise<Guarded> {
  const auth = await authenticate();
  if (!auth.ok) return auth;
  if (permissions.length && !auth.admin.canAll(permissions)) {
    return { ok: false, response: await denied(permissions) };
  }
  return auth;
}

export async function requireSuperAdmin(): Promise<Guarded> {
  const auth = await authenticate();
  if (!auth.ok) return auth;
  if (!auth.admin.is_super_admin) {
    return { ok: false, response: await fail('PERMISSION_DENIED', 'This action is restricted to super administrators.') };
  }
  return auth;
}
