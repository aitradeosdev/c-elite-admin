import type { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { requireRecentAuth, requireSuperAdmin, requireTwoStep, type AdminContext } from '../../../../lib/guard';
import { writeAudit } from '../../../../lib/audit';
import { ERROR_MESSAGE, ERROR_STATUS, fail, isUuid, ok, type ApiErrorCode } from '../../../../lib/api';
import { REASON_MAX, REASON_MESSAGE, REASON_MIN, rpcFailure, type RpcFailure } from '../../../../lib/roles';

const ENTITY = 'admin_users';

const WEB_ONLY = 'Super admin can only be changed in the web console.';
const INVALID_BODY = 'Send the super admin change as a JSON object.';
const INVALID_MAKE = 'make must be true or false.';
const INVALID_ADMIN = 'A valid admin account id is required.';
const NOT_FOUND = 'Admin account not found.';
const OWN_STATUS = 'You cannot remove your own super admin status. Another super administrator has to do it.';
const ALREADY_SUPER = 'This admin is already a super admin.';
const NOT_SUPER = 'This admin is not a super admin.';
const INACTIVE = 'This admin is deactivated. Reactivate the account before making it a super admin.';
const INVITE_PENDING = 'This admin has not accepted their invitation yet.';
const LAST_SUPER_ADMIN = 'Cannot remove the last active super admin.';
const SAVE_FAILED = 'The super admin change could not be confirmed. Reload the account and try again.';
const UNREADABLE = 'The super admin change returned a result that could not be read.';

type Body = Record<string, unknown>;

interface Attempt {
  target: string | null;
  make: boolean;
  reason: string | null;
}

interface SavedAdmin {
  id: string;
  is_super_admin: boolean;
  role_id: string | null;
  direct_permissions: string[];
  page_permissions: string[];
}

type Outcome =
  | { kind: 'saved'; admin: SavedAdmin; signedOut: boolean }
  | { kind: 'refused'; failure: RpcFailure; error: string }
  | { kind: 'failed'; error: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(code: ApiErrorCode, message: string, details: Record<string, unknown>): RpcFailure {
  return { code, status: ERROR_STATUS[code], message, details };
}

function invalid(message: string, field?: string, reason = 'invalid'): RpcFailure {
  return failure('VALIDATION_ERROR', message, field ? { field, reason } : { reason });
}

function outage(): RpcFailure {
  return { code: 'INTERNAL_ERROR', status: ERROR_STATUS.INTERNAL_ERROR, message: SAVE_FAILED };
}

function answer(failure: RpcFailure): Promise<NextResponse> {
  return fail(failure.code, failure.message, failure.details ? { details: failure.details } : undefined);
}

async function readBody(req: NextRequest): Promise<Body | null> {
  const raw: unknown = await req.json().catch(() => null);
  return isRecord(raw) ? raw : null;
}

function readId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isUuid(id) ? id : null;
}

function readReason(value: unknown): string | null {
  const reason = typeof value === 'string' ? value.trim() : '';
  const length = Array.from(reason).length;
  return length >= REASON_MIN && length <= REASON_MAX ? reason : null;
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((key) => typeof key === 'string') ? [...value] : null;
}

function refusal(reason: string, make: boolean): RpcFailure | null {
  switch (reason) {
    case 'invalid':
      return failure('VALIDATION_ERROR', ERROR_MESSAGE.VALIDATION_ERROR, { reason });
    case 'reason_required':
      return failure('VALIDATION_ERROR', REASON_MESSAGE, { reason });
    case 'self':
      return failure('VALIDATION_ERROR', OWN_STATUS, { reason });
    case 'not_found':
      return failure('RESOURCE_NOT_FOUND', NOT_FOUND, { reason });
    case 'unchanged':
      return failure('STATE_CONFLICT', make ? ALREADY_SUPER : NOT_SUPER, { reason });
    case 'inactive':
      return failure('STATE_CONFLICT', INACTIVE, { reason });
    case 'invite_pending':
      return failure('STATE_CONFLICT', INVITE_PENDING, { reason });
    case 'last_super_admin':
      return failure('STATE_CONFLICT', LAST_SUPER_ADMIN, { reason });
    default:
      return null;
  }
}

function readSaved(value: unknown): SavedAdmin | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const roleId = value.role_id ?? null;
  const direct = stringList(value.direct_permissions);
  const effective = stringList(value.page_permissions);
  if (!isUuid(id) || typeof value.is_super_admin !== 'boolean' || direct === null || effective === null) return null;
  if (roleId !== null && !isUuid(roleId)) return null;
  return { id, is_super_admin: value.is_super_admin, role_id: roleId, direct_permissions: direct, page_permissions: effective };
}

function readOutcome(data: unknown, make: boolean): Outcome {
  if (!isRecord(data)) return { kind: 'failed', error: UNREADABLE };
  if (data.ok !== true) {
    const reason = typeof data.reason === 'string' ? data.reason : 'unknown';
    const refused = refusal(reason, make);
    return refused ? { kind: 'refused', failure: refused, error: refused.message } : { kind: 'failed', error: `Unexpected refusal: ${reason}` };
  }
  const admin = readSaved(data.admin);
  const signedOut = data.signed_out;
  if (!admin || typeof signedOut !== 'boolean') return { kind: 'failed', error: UNREADABLE };
  return { kind: 'saved', admin, signedOut };
}

async function setSuperAdmin(admin: AdminContext, target: string, make: boolean, reason: string): Promise<Outcome> {
  let data: unknown;
  try {
    const result = await supabaseAdmin.rpc('admin_set_super_admin', {
      p_actor: admin.admin_id,
      p_admin_id: target,
      p_make: make,
      p_reason: reason,
      p_ip: admin.ip,
      p_user_agent: admin.user_agent || null,
      p_request_id: admin.request_id,
    });
    if (result.error) {
      const failure = rpcFailure(result.error);
      return failure.code === 'INTERNAL_ERROR'
        ? { kind: 'failed', error: result.error.message }
        : { kind: 'refused', failure, error: result.error.message };
    }
    data = result.data;
  } catch (error) {
    return { kind: 'failed', error: errorText(error) };
  }
  return readOutcome(data, make);
}

async function refuse(
  admin: AdminContext,
  attempt: Attempt,
  failure: RpcFailure,
  error: string = failure.message,
): Promise<NextResponse> {
  await writeAudit({
    admin,
    action: attempt.make ? 'GRANT_SUPER_ADMIN' : 'REMOVE_SUPER_ADMIN',
    entity: ENTITY,
    entity_id: attempt.target,
    after: { is_super_admin: attempt.make },
    reason: attempt.reason,
    result: 'failure',
    error,
    sensitivity: 'security',
  });
  return answer(failure);
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

  const body = await readBody(req);
  if (!body) return answer(invalid(INVALID_BODY));
  if (typeof body.make !== 'boolean') return answer(invalid(INVALID_MAKE, 'make'));
  const make = body.make;

  const { id: raw } = await ctx.params;
  const target = readId(raw);
  const reason = readReason(body.reason);
  const attempt: Attempt = { target, make, reason };
  if (!target) return refuse(admin, attempt, invalid(INVALID_ADMIN, 'id'));
  if (reason === null) return refuse(admin, attempt, invalid(REASON_MESSAGE, 'reason', 'reason_required'));

  const outcome = await setSuperAdmin(admin, target, make, reason);
  if (outcome.kind === 'failed') {
    console.error('admin super admin change failed:', outcome.error);
    return refuse(admin, attempt, outage(), outcome.error);
  }
  if (outcome.kind === 'refused') return refuse(admin, attempt, outcome.failure, outcome.error);
  return ok({ admin: outcome.admin, signed_out: outcome.signedOut });
}
