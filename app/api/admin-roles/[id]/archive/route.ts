import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { requireRecentAuth, requireSuperAdmin, requireTwoStep, type AdminContext } from '../../../../lib/guard';
import { writeAudit } from '../../../../lib/audit';
import { ERROR_STATUS, fail, isUuid, ok } from '../../../../lib/api';
import { REASON_MAX, REASON_MESSAGE, REASON_MIN, parseRoleRow, rpcFailure, type RpcFailure } from '../../../../lib/roles';

const ACTION = 'ARCHIVE_ADMIN_ROLE';
const ENTITY = 'admin_roles';
const ARCHIVED = true;
const MAX_VERSION = 2147483647;

const WEB_ONLY = 'Roles can only be changed in the web console.';
const INVALID_ROLE = 'A valid role id is required.';
const INVALID_VERSION = 'A valid role version is required.';
const BODY_INVALID = 'Send the reason and the role version as a JSON object.';
const SAVE_FAILED = 'The role could not be archived. Try again.';

type RpcReply = { kind: 'error'; error: unknown; message: string } | { kind: 'result'; data: unknown };

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

function readReason(value: unknown): string | null {
  const reason = typeof value === 'string' ? value.trim() : '';
  const length = Array.from(reason).length;
  return length >= REASON_MIN && length <= REASON_MAX ? reason : null;
}

function invalid(message: string, field?: string): RpcFailure {
  return {
    code: 'VALIDATION_ERROR',
    status: ERROR_STATUS.VALIDATION_ERROR,
    message,
    details: field ? { field, reason: 'invalid' } : { reason: 'invalid' },
  };
}

function reasonMissing(): RpcFailure {
  return {
    code: 'VALIDATION_ERROR',
    status: ERROR_STATUS.VALIDATION_ERROR,
    message: REASON_MESSAGE,
    details: { field: 'reason', reason: 'reason_required' },
  };
}

function failureFor(value: unknown): RpcFailure {
  const failure = rpcFailure(value);
  return failure.code === 'INTERNAL_ERROR' ? { ...failure, message: SAVE_FAILED } : failure;
}

async function refuse(
  admin: AdminContext,
  roleId: string | null,
  expectedVersion: number | null,
  reason: string | null,
  failure: RpcFailure,
  error: string = failure.message,
) {
  await writeAudit({
    admin,
    action: ACTION,
    entity: ENTITY,
    entity_id: roleId,
    after: { archived: ARCHIVED, expected_version: expectedVersion },
    reason,
    result: 'failure',
    error,
    sensitivity: 'security',
  });
  return fail(failure.code, failure.message, failure.details ? { details: failure.details } : undefined);
}

async function setArchived(admin: AdminContext, roleId: string, expectedVersion: number, reason: string): Promise<RpcReply> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_role_set_archived', {
      p_actor: admin.admin_id,
      p_role_id: roleId,
      p_expected_version: expectedVersion,
      p_archived: ARCHIVED,
      p_reason: reason,
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

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
  const expected = readVersion(body?.expected_version);
  const reason = readReason(body?.reason);
  if (!id) return refuse(admin, null, expected, reason, invalid(INVALID_ROLE, 'id'));
  if (!body) return refuse(admin, id, expected, reason, invalid(BODY_INVALID));
  if (expected === null) return refuse(admin, id, expected, reason, invalid(INVALID_VERSION, 'expected_version'));
  if (reason === null) return refuse(admin, id, expected, reason, reasonMissing());

  const reply = await setArchived(admin, id, expected, reason);
  if (reply.kind === 'error') {
    const failure = failureFor(reply.error);
    if (failure.code === 'INTERNAL_ERROR') console.error('admin role archive failed:', reply.message);
    return refuse(admin, id, expected, reason, failure, reply.message);
  }
  const result = record(reply.data);
  if (result?.ok === true) {
    const role = parseRoleRow(result.role);
    if (role) return ok({ role });
    console.error('admin role archive failed:', 'the archived role could not be read');
    return fail('INTERNAL_ERROR', SAVE_FAILED);
  }
  const failure = failureFor(result);
  if (failure.code === 'INTERNAL_ERROR') console.error('admin role archive failed:', 'the result was not recognised');
  return refuse(admin, id, expected, reason, failure);
}
