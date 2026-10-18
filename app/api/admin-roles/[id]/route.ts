import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import {
  requireAdmin,
  requireRecentAuth,
  requireSuperAdmin,
  requireTwoStep,
  type AdminContext,
} from '../../../lib/guard';
import { writeAudit } from '../../../lib/audit';
import { ERROR_STATUS, fail, isUuid, ok } from '../../../lib/api';
import { normalizeGrants } from '../../../lib/grants';
import {
  REASON_MAX,
  REASON_MIN,
  SYSTEM_ROLE_KEY,
  buildImpact,
  checkRoleDraft,
  parseRoleRow,
  rpcFailure,
  type RoleDraft,
  type RoleDraftCheck,
  type RoleRow,
  type RpcFailure,
} from '../../../lib/roles';

const ACTION = 'EDIT_ADMIN_ROLE';
const ENTITY = 'admin_roles';
const ROLE_COLUMNS =
  'id, name, description, permissions, system_key, is_protected, version, archived_at, archived_by, created_at, created_by, updated_at, updated_by';
const MEMBER_COLUMNS = 'id, username, role_title, is_active, last_login_at';
const MAX_VERSION = 2147483647;

const WEB_ONLY = 'Roles can only be changed in the web console.';
const INVALID_ROLE = 'A valid role id is required.';
const INVALID_VERSION = 'A valid role version is required.';
const BODY_INVALID = 'Send the role changes as a JSON object.';
const NOT_FOUND = 'Role not found.';
const LOAD_FAILED = 'The role could not be loaded.';
const READ_FAILED = 'The role could not be read.';
const SAVE_FAILED = 'The role could not be saved. Try again.';

type Body = Record<string, unknown>;
type DraftProblem = Extract<RoleDraftCheck, { ok: false }>;
type RoleRead = { ok: true; role: RoleRow | null } | { ok: false };
type RpcReply = { kind: 'error'; error: unknown; message: string } | { kind: 'result'; data: unknown };

interface Member {
  id: string;
  username: string;
  role_title: string | null;
  is_active: boolean;
  last_login_at: string | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

async function readBody(req: NextRequest): Promise<Body | null> {
  return record(await req.json().catch(() => null));
}

function readId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isUuid(id) ? id : null;
}

function readVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_VERSION ? value : null;
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
    expected_version: readVersion(body?.expected_version),
  };
}

function invalid(message: string, field?: string): RpcFailure {
  return {
    code: 'VALIDATION_ERROR',
    status: ERROR_STATUS.VALIDATION_ERROR,
    message,
    details: field ? { field, reason: 'invalid' } : { reason: 'invalid' },
  };
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

function roleProblem(role: RoleRow, expectedVersion: number): Record<string, unknown> | null {
  if (role.is_protected) return { ok: false, reason: 'protected' };
  if (role.archived_at !== null) return { ok: false, reason: 'archived' };
  if (role.version !== expectedVersion) return { ok: false, reason: 'stale', version: role.version };
  return null;
}

async function refuse(
  admin: AdminContext,
  roleId: string | null,
  body: Body | null,
  failure: RpcFailure,
  error: string = failure.message,
) {
  await writeAudit({
    admin,
    action: ACTION,
    entity: ENTITY,
    entity_id: roleId,
    after: attemptOf(body),
    reason: auditReason(body?.reason),
    result: 'failure',
    error,
    sensitivity: 'security',
  });
  return fail(failure.code, failure.message, failure.details ? { details: failure.details } : undefined);
}

async function readRole(id: string): Promise<RoleRead> {
  try {
    const { data, error } = await supabaseAdmin.from('admin_roles').select(ROLE_COLUMNS).eq('id', id).maybeSingle();
    if (error) {
      console.error('admin role read failed:', error.message);
      return { ok: false };
    }
    return { ok: true, role: data ? parseRoleRow(data) : null };
  } catch (error) {
    console.error('admin role read failed:', errorText(error));
    return { ok: false };
  }
}

function memberOf(value: unknown): Member | null {
  const row = record(value);
  if (!row || !isUuid(row.id)) return null;
  return {
    id: row.id,
    username: typeof row.username === 'string' ? row.username : '',
    role_title: text(row.role_title),
    is_active: row.is_active === true,
    last_login_at: text(row.last_login_at),
  };
}

async function readMembers(role: RoleRow): Promise<Member[] | null> {
  try {
    const listed = supabaseAdmin.from('admin_users').select(MEMBER_COLUMNS).is('deleted_at', null);
    const scoped = role.system_key === SYSTEM_ROLE_KEY
      ? listed.eq('is_super_admin', true).eq('is_active', true)
      : listed.eq('role_id', role.id);
    const { data, error } = await scoped.order('username', { ascending: true });
    if (error) {
      console.error('admin role members read failed:', error.message);
      return null;
    }
    const members: Member[] = [];
    for (const item of Array.isArray(data) ? data : []) {
      const member = memberOf(item);
      if (member) members.push(member);
    }
    return members;
  } catch (error) {
    console.error('admin role members read failed:', errorText(error));
    return null;
  }
}

async function saveRole(admin: AdminContext, roleId: string, expectedVersion: number, draft: RoleDraft): Promise<RpcReply> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_role_save', {
      p_actor: admin.admin_id,
      p_role_id: roleId,
      p_expected_version: expectedVersion,
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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin('roles.read');
  if (!guard.ok) return guard.response;

  const { id: raw } = await ctx.params;
  const id = readId(raw);
  if (!id) return fail('VALIDATION_ERROR', INVALID_ROLE);

  const read = await readRole(id);
  if (!read.ok) return fail('INTERNAL_ERROR', LOAD_FAILED);
  if (!read.role) return fail('RESOURCE_NOT_FOUND', NOT_FOUND);
  const members = await readMembers(read.role);
  if (!members) return fail('INTERNAL_ERROR', LOAD_FAILED);

  return ok({ role: read.role, members });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  if (admin.session.client !== 'web') return fail('PERMISSION_DENIED', WEB_ONLY);

  const withoutTwoStep = await requireTwoStep(admin);
  if (withoutTwoStep) return withoutTwoStep;
  const stale = await requireRecentAuth(admin);
  if (stale) return stale;

  const { id: raw } = await ctx.params;
  const id = readId(raw);
  const body = await readBody(req);
  if (!id) return refuse(admin, null, body, invalid(INVALID_ROLE, 'id'));
  if (!body) return refuse(admin, id, body, invalid(BODY_INVALID));
  const expected = readVersion(body.expected_version);
  if (expected === null) return refuse(admin, id, body, invalid(INVALID_VERSION, 'expected_version'));

  const read = await readRole(id);
  if (!read.ok) return refuse(admin, id, body, failureFor(null), READ_FAILED);
  const role = read.role;
  if (!role) return refuse(admin, id, body, rpcFailure({ ok: false, reason: 'not_found' }));
  const problem = roleProblem(role, expected);
  if (problem) return refuse(admin, id, body, rpcFailure(problem));
  const checked = checkRoleDraft(
    { name: body.name, description: body.description, permissions: body.permissions, reason: body.reason },
    role.permissions,
  );
  if (!checked.ok) return refuse(admin, id, body, draftFailure(checked));

  const reply = await saveRole(admin, id, expected, checked.draft);
  if (reply.kind === 'error') {
    const failure = failureFor(reply.error);
    if (failure.code === 'INTERNAL_ERROR') console.error('admin role save failed:', reply.message);
    return refuse(admin, id, body, failure, reply.message);
  }
  const result = record(reply.data);
  if (result?.ok === true) {
    const saved = parseRoleRow(result.role);
    if (saved) return ok({ role: saved, impact: buildImpact(result.members) });
    console.error('admin role save failed:', 'the saved role could not be read');
    return fail('INTERNAL_ERROR', SAVE_FAILED);
  }
  const failure = failureFor(result);
  if (failure.code === 'INTERNAL_ERROR') console.error('admin role save failed:', 'the result was not recognised');
  return refuse(admin, id, body, failure);
}
