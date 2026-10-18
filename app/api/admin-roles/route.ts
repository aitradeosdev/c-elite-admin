import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import {
  requireAdmin,
  requireRecentAuth,
  requireSuperAdmin,
  requireTwoStep,
  type AdminContext,
} from '../../lib/guard';
import { writeAudit } from '../../lib/audit';
import { ERROR_STATUS, fail, isUuid, ok } from '../../lib/api';
import { normalizeGrants } from '../../lib/grants';
import {
  REASON_MAX,
  REASON_MIN,
  SYSTEM_ROLE_KEY,
  checkRoleDraft,
  parseRoleRow,
  roleSummary,
  rpcFailure,
  type RoleDraft,
  type RoleDraftCheck,
  type RoleMemberCounts,
  type RoleRow,
  type RpcFailure,
} from '../../lib/roles';

const ACTION = 'CREATE_ADMIN_ROLE';
const ENTITY = 'admin_roles';
const ROLE_COLUMNS =
  'id, name, description, permissions, system_key, is_protected, version, archived_at, archived_by, created_at, created_by, updated_at, updated_by';
const HOLDER_COLUMNS = 'role_id, is_active, is_super_admin';
const NAME_COLUMNS = 'id, username';

const LOAD_FAILED = 'Roles could not be loaded.';
const WEB_ONLY = 'Roles can only be changed in the web console.';
const BODY_INVALID = 'Send the new role as a JSON object.';
const SAVE_FAILED = 'The role could not be created. Try again.';

type Body = Record<string, unknown>;
type DraftProblem = Extract<RoleDraftCheck, { ok: false }>;
type RpcReply = { kind: 'error'; error: unknown; message: string } | { kind: 'result'; data: unknown };

interface Holders {
  counts: Map<string, RoleMemberCounts>;
  superAdmins: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function readBody(req: NextRequest): Promise<Body | null> {
  return record(await req.json().catch(() => null));
}

function auditReason(value: unknown): string | null {
  const reason = typeof value === 'string' ? value.trim() : '';
  const length = Array.from(reason).length;
  return length >= REASON_MIN && length <= REASON_MAX ? reason : null;
}

function attemptOf(body: Body | null) {
  const permissions = body?.permissions;
  return {
    name: typeof body?.name === 'string' ? body.name.trim() : null,
    description: typeof body?.description === 'string' ? body.description.trim() : null,
    permissions: Array.isArray(permissions) ? normalizeGrants(permissions) : null,
  };
}

function invalid(message: string): RpcFailure {
  return { code: 'VALIDATION_ERROR', status: ERROR_STATUS.VALIDATION_ERROR, message, details: { reason: 'invalid' } };
}

function draftFailure(problem: DraftProblem): RpcFailure {
  const reason = problem.keys ? 'not_grantable' : problem.field === 'reason' ? 'reason_required' : 'invalid';
  return {
    code: 'VALIDATION_ERROR',
    status: ERROR_STATUS.VALIDATION_ERROR,
    message: problem.message,
    details: problem.keys ? { field: problem.field, reason, keys: problem.keys } : { field: problem.field, reason },
  };
}

function failureFor(value: unknown): RpcFailure {
  const failure = rpcFailure(value);
  return failure.code === 'INTERNAL_ERROR' ? { ...failure, message: SAVE_FAILED } : failure;
}

async function refuse(admin: AdminContext, body: Body | null, failure: RpcFailure, error: string = failure.message) {
  await writeAudit({
    admin,
    action: ACTION,
    entity: ENTITY,
    entity_id: null,
    after: attemptOf(body),
    reason: auditReason(body?.reason),
    result: 'failure',
    error,
    sensitivity: 'security',
  });
  return fail(failure.code, failure.message, failure.details ? { details: failure.details } : undefined);
}

async function createRole(admin: AdminContext, draft: RoleDraft): Promise<RpcReply> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_role_save', {
      p_actor: admin.admin_id,
      p_role_id: null,
      p_expected_version: null,
      p_name: draft.name,
      p_description: draft.description,
      p_permissions: draft.permissions,
      p_reason: draft.reason,
      p_dry_run: false,
      p_ip: admin.ip,
      p_user_agent: admin.user_agent || null,
      p_request_id: admin.request_id,
    });
    return error ? { kind: 'error', error, message: error.message } : { kind: 'result', data };
  } catch (error) {
    const message = errorText(error);
    return { kind: 'error', error: { message }, message };
  }
}

async function readRoles(): Promise<RoleRow[] | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('admin_roles')
      .select(ROLE_COLUMNS)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('admin roles read failed:', error.message);
      return null;
    }
    const roles: RoleRow[] = [];
    for (const item of Array.isArray(data) ? data : []) {
      const role = parseRoleRow(item);
      if (role) roles.push(role);
    }
    return roles;
  } catch (error) {
    console.error('admin roles read failed:', errorText(error));
    return null;
  }
}

async function readHolders(): Promise<Holders | null> {
  try {
    const { data, error } = await supabaseAdmin.from('admin_users').select(HOLDER_COLUMNS).is('deleted_at', null);
    if (error) {
      console.error('admin role members read failed:', error.message);
      return null;
    }
    const counts = new Map<string, RoleMemberCounts>();
    let superAdmins = 0;
    for (const item of Array.isArray(data) ? data : []) {
      const row = record(item);
      if (!row) continue;
      const active = row.is_active === true;
      if (row.is_super_admin === true && active) superAdmins += 1;
      if (!isUuid(row.role_id)) continue;
      const key = row.role_id.toLowerCase();
      const count = counts.get(key) ?? { total: 0, active: 0 };
      counts.set(key, { total: count.total + 1, active: count.active + (active ? 1 : 0) });
    }
    return { counts, superAdmins };
  } catch (error) {
    console.error('admin role members read failed:', errorText(error));
    return null;
  }
}

async function readUsernames(ids: readonly string[]): Promise<Map<string, string> | null> {
  const wanted = [...new Set(ids.map((id) => id.toLowerCase()))];
  const names = new Map<string, string>();
  if (wanted.length === 0) return names;
  try {
    const { data, error } = await supabaseAdmin.from('admin_users').select(NAME_COLUMNS).in('id', wanted);
    if (error) {
      console.error('admin role editors read failed:', error.message);
      return null;
    }
    for (const item of Array.isArray(data) ? data : []) {
      const row = record(item);
      if (row && isUuid(row.id) && typeof row.username === 'string') names.set(row.id.toLowerCase(), row.username);
    }
    return names;
  } catch (error) {
    console.error('admin role editors read failed:', errorText(error));
    return null;
  }
}

function membersOf(role: RoleRow, holders: Holders): RoleMemberCounts {
  if (role.system_key === SYSTEM_ROLE_KEY) return { total: holders.superAdmins, active: holders.superAdmins };
  return holders.counts.get(role.id.toLowerCase()) ?? { total: 0, active: 0 };
}

function roleView(role: RoleRow, members: RoleMemberCounts, names: ReadonlyMap<string, string>) {
  const summary = roleSummary(role, members);
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    action_count: summary.action_count,
    is_protected: role.is_protected,
    system_key: role.system_key,
    archived_at: role.archived_at,
    version: role.version,
    member_count: summary.member_count,
    active_member_count: summary.active_member_count,
    created_at: role.created_at,
    updated_at: role.updated_at,
    updated_by_username: role.updated_by ? names.get(role.updated_by.toLowerCase()) ?? null : null,
  };
}

export async function GET() {
  const guard = await requireAdmin('roles.read');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const [roles, holders] = await Promise.all([readRoles(), readHolders()]);
  if (!roles || !holders) return fail('INTERNAL_ERROR', LOAD_FAILED);
  const names = await readUsernames(roles.flatMap((role) => (role.updated_by ? [role.updated_by] : [])));
  if (!names) return fail('INTERNAL_ERROR', LOAD_FAILED);

  return ok({
    roles: roles.map((role) => roleView(role, membersOf(role, holders), names)),
    super_admin_count: holders.superAdmins,
    can_manage: admin.is_super_admin,
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  if (admin.session.client !== 'web') return fail('PERMISSION_DENIED', WEB_ONLY);

  const withoutTwoStep = await requireTwoStep(admin);
  if (withoutTwoStep) return withoutTwoStep;
  const stale = await requireRecentAuth(admin);
  if (stale) return stale;

  const body = await readBody(req);
  if (!body) return refuse(admin, body, invalid(BODY_INVALID));
  const checked = checkRoleDraft(
    { name: body.name, description: body.description, permissions: body.permissions, reason: body.reason },
    [],
  );
  if (!checked.ok) return refuse(admin, body, draftFailure(checked));

  const reply = await createRole(admin, checked.draft);
  if (reply.kind === 'error') {
    const failure = failureFor(reply.error);
    if (failure.code === 'INTERNAL_ERROR') console.error('admin role create failed:', reply.message);
    return refuse(admin, body, failure, reply.message);
  }
  const result = record(reply.data);
  if (result?.ok === true) {
    const role = parseRoleRow(result.role);
    if (role) return ok({ role }, { status: 201 });
    console.error('admin role create failed:', 'the saved role could not be read');
    return fail('INTERNAL_ERROR', SAVE_FAILED);
  }
  const failure = failureFor(result);
  if (failure.code === 'INTERNAL_ERROR') console.error('admin role create failed:', 'the result was not recognised');
  return refuse(admin, body, failure);
}
