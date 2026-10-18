import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin } from '../../lib/guard';
import { fail, isUuid, ok } from '../../lib/api';
import {
  ALL_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  PERMISSION_CATALOG,
  permissionStatus,
  permissionsByCategory,
  resolvePermissions,
  type Permission,
} from '../../lib/permissions';

const ROLE_COLUMNS = 'id, name, permissions';
const ADMIN_COLUMNS = 'id, username, is_active, is_super_admin, direct_permissions';
const LOAD_FAILED = 'Permissions could not be loaded.';
const PAGE_KEYS = Object.keys(LEGACY_PERMISSION_MAP);

interface Holder {
  id: string;
  name: string;
  grants: Set<Permission>;
}

interface Admins {
  direct: Holder[];
  superAdmins: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function keys(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [];
}

function legacyPages(permission: Permission): string[] {
  return PAGE_KEYS.filter((page) => LEGACY_PERMISSION_MAP[page].includes(permission));
}

async function readRoles(): Promise<Holder[] | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('admin_roles')
      .select(ROLE_COLUMNS)
      .is('archived_at', null)
      .is('system_key', null)
      .order('name', { ascending: true });
    if (error) {
      console.error('admin permissions roles read failed:', error.message);
      return null;
    }
    const roles: Holder[] = [];
    for (const item of Array.isArray(data) ? data : []) {
      const row = record(item);
      if (!row || !isUuid(row.id) || typeof row.name !== 'string') continue;
      roles.push({ id: row.id, name: row.name, grants: resolvePermissions(keys(row.permissions), false) });
    }
    return roles;
  } catch (error) {
    console.error('admin permissions roles read failed:', errorText(error));
    return null;
  }
}

async function readAdmins(): Promise<Admins | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('admin_users')
      .select(ADMIN_COLUMNS)
      .is('deleted_at', null)
      .order('username', { ascending: true });
    if (error) {
      console.error('admin permissions admins read failed:', error.message);
      return null;
    }
    const direct: Holder[] = [];
    let superAdmins = 0;
    for (const item of Array.isArray(data) ? data : []) {
      const row = record(item);
      if (!row || !isUuid(row.id)) continue;
      if (row.is_super_admin === true) {
        if (row.is_active === true) superAdmins += 1;
        continue;
      }
      direct.push({
        id: row.id,
        name: typeof row.username === 'string' ? row.username : '',
        grants: resolvePermissions(keys(row.direct_permissions), false),
      });
    }
    return { direct, superAdmins };
  } catch (error) {
    console.error('admin permissions admins read failed:', errorText(error));
    return null;
  }
}

export async function GET() {
  const guard = await requireAdmin('roles.read');
  if (!guard.ok) return guard.response;

  const [roles, admins] = await Promise.all([readRoles(), readAdmins()]);
  if (!roles || !admins) return fail('INTERNAL_ERROR', LOAD_FAILED);

  const permissions = ALL_PERMISSIONS.map((key) => {
    const meta = PERMISSION_CATALOG[key];
    const holders = admins.direct.filter((admin) => admin.grants.has(key));
    return {
      key,
      label: meta.label,
      description: meta.description,
      category: meta.category,
      risk: meta.risk,
      status: permissionStatus(key),
      legacy_pages: legacyPages(key),
      roles: roles.filter((role) => role.grants.has(key)).map((role) => ({ id: role.id, name: role.name })),
      direct_admin_count: holders.length,
      direct_admins: holders.map((admin) => ({ id: admin.id, username: admin.name })),
    };
  });

  return ok({
    permissions,
    categories: permissionsByCategory().map((group) => group.category),
    super_admin_count: admins.superAdmins,
  });
}
