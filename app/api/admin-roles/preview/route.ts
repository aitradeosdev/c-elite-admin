import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireSuperAdmin, type AdminContext } from '../../../lib/guard';
import { ERROR_STATUS, fail, isUuid, ok } from '../../../lib/api';
import {
  buildImpact,
  checkRoleDraft,
  parseRoleRow,
  rpcFailure,
  type RoleDraft,
  type RoleDraftCheck,
  type RoleRow,
  type RpcFailure,
} from '../../../lib/roles';

const ROLE_COLUMNS =
  'id, name, description, permissions, system_key, is_protected, version, archived_at, archived_by, created_at, created_by, updated_at, updated_by';
const MAX_VERSION = 2147483647;

const INVALID_ROLE = 'A valid role id is required.';
const INVALID_VERSION = 'A valid role version is required.';
const BODY_INVALID = 'Send the draft role as a JSON object.';
const PREVIEW_FAILED = 'The impact of this change could not be worked out. Try again.';

type DraftProblem = Extract<RoleDraftCheck, { ok: false }>;
type RoleRead = { ok: true; role: RoleRow | null } | { ok: false };
type RpcReply = { kind: 'error'; error: unknown; message: string } | { kind: 'result'; data: unknown };

interface Target {
  id: string;
  version: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  return record(await req.json().catch(() => null));
}

function readId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isUuid(id) ? id : null;
}

function readVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_VERSION ? value : null;
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
  const reason = problem.keys ? 'not_grantable' : 'invalid';
  return {
    code: 'VALIDATION_ERROR',
    status: ERROR_STATUS.VALIDATION_ERROR,
    message: problem.message,
    details: problem.keys ? { field: problem.field, reason, keys: problem.keys } : { field: problem.field, reason },
  };
}

function failureFor(value: unknown): RpcFailure {
  const failure = rpcFailure(value);
  return failure.code === 'INTERNAL_ERROR' ? { ...failure, message: PREVIEW_FAILED } : failure;
}

function respond(failure: RpcFailure) {
  return fail(failure.code, failure.message, failure.details ? { details: failure.details } : undefined);
}

function roleProblem(role: RoleRow, expectedVersion: number): Record<string, unknown> | null {
  if (role.is_protected) return { ok: false, reason: 'protected' };
  if (role.archived_at !== null) return { ok: false, reason: 'archived' };
  if (role.version !== expectedVersion) return { ok: false, reason: 'stale', version: role.version };
  return null;
}

async function readRole(id: string): Promise<RoleRead> {
  try {
    const { data, error } = await supabaseAdmin.from('admin_roles').select(ROLE_COLUMNS).eq('id', id).maybeSingle();
    if (error) {
      console.error('admin role preview read failed:', error.message);
      return { ok: false };
    }
    return { ok: true, role: data ? parseRoleRow(data) : null };
  } catch (error) {
    console.error('admin role preview read failed:', errorText(error));
    return { ok: false };
  }
}

async function dryRun(admin: AdminContext, target: Target | null, draft: RoleDraft): Promise<RpcReply> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_role_save', {
      p_actor: admin.admin_id,
      p_role_id: target?.id ?? null,
      p_expected_version: target?.version ?? null,
      p_name: draft.name,
      p_description: draft.description,
      p_permissions: draft.permissions,
      p_reason: null,
      p_dry_run: true,
    });
    return error ? { kind: 'error', error, message: error.message } : { kind: 'result', data };
  } catch (error) {
    const message = errorText(error);
    return { kind: 'error', error: { message }, message };
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body = await readBody(req);
  if (!body) return respond(invalid(BODY_INVALID));

  let target: Target | null = null;
  let current: readonly string[] = [];
  if (body.role_id !== undefined && body.role_id !== null) {
    const id = readId(body.role_id);
    if (!id) return respond(invalid(INVALID_ROLE, 'role_id'));
    const version = readVersion(body.expected_version);
    if (version === null) return respond(invalid(INVALID_VERSION, 'expected_version'));
    const read = await readRole(id);
    if (!read.ok) return fail('INTERNAL_ERROR', PREVIEW_FAILED);
    if (!read.role) return respond(rpcFailure({ ok: false, reason: 'not_found' }));
    const problem = roleProblem(read.role, version);
    if (problem) return respond(rpcFailure(problem));
    target = { id, version };
    current = read.role.permissions;
  }

  const checked = checkRoleDraft({ name: body.name, description: body.description, permissions: body.permissions }, current);
  if (!checked.ok) return respond(draftFailure(checked));

  const reply = await dryRun(admin, target, checked.draft);
  if (reply.kind === 'error') {
    const failure = failureFor(reply.error);
    if (failure.code === 'INTERNAL_ERROR') console.error('admin role preview failed:', reply.message);
    return respond(failure);
  }
  const result = record(reply.data);
  if (result?.ok === true && result.dry_run === true) return ok({ impact: buildImpact(result.members) });
  const failure = failureFor(result);
  if (failure.code === 'INTERNAL_ERROR') console.error('admin role preview failed:', 'the result was not recognised');
  return respond(failure);
}
