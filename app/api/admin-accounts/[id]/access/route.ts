import type { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { requireRecentAuth, requireSuperAdmin, requireTwoStep, type AdminContext } from '../../../../lib/guard';
import { writeAudit } from '../../../../lib/audit';
import { ERROR_STATUS, fail, isUuid, ok } from '../../../../lib/api';
import { actionDiff, checkNewKeys, foldIntoRole, normalizeGrants } from '../../../../lib/grants';
import { REASON_MAX, REASON_MESSAGE, REASON_MIN, rpcFailure, type RpcFailure } from '../../../../lib/roles';

const ENTITY = 'admin_users';
const MAX_KEYS = 128;

const WEB_ONLY = 'Access can only be changed in the web console.';
const INVALID_BODY = 'Send the access change as a JSON object.';
const INVALID_DRY_RUN = 'dry_run must be true or false.';
const INVALID_ADMIN = 'A valid admin account id is required.';
const INVALID_ROLE = 'role_id must be a role id or null.';
const INVALID_DIRECT = 'direct_permissions must be a list of permission keys.';
const TOO_MANY_KEYS = 'Too many permission keys.';
const INVALID_EXPECTED =
  'expected must hold the role_id, direct_permissions and page_permissions this admin had when you loaded it.';
const PREVIEW_FAILED = 'The access preview could not be loaded. Try again.';
const SAVE_FAILED = 'The access change could not be confirmed. Reload the account and try again.';
const UNREADABLE = 'The access change returned a result that could not be read.';

type Body = Record<string, unknown>;

interface Expected {
  role_id: string | null;
  direct_permissions: string[];
  page_permissions: string[];
}

interface AccessRequest {
  dryRun: boolean;
  setRole: boolean;
  roleId: string | null;
  direct: string[] | null;
  expected: Expected;
  reason: string | null;
}

interface SavedAccess {
  id: string;
  role_id: string | null;
  direct_permissions: string[];
  page_permissions: string[];
}

type RoleRead = { ok: true; id: string | null } | { ok: false };

type RequestRead = { ok: true; request: AccessRequest } | { ok: false; failure: RpcFailure };

type Outcome =
  | { kind: 'preview'; before: string[]; after: string[]; direct: string[]; changed: boolean; signsOut: boolean }
  | { kind: 'saved'; changed: boolean; signedOut: boolean; admin: SavedAccess | null }
  | { kind: 'refused'; failure: RpcFailure; error: string }
  | { kind: 'failed'; error: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string, field?: string, reason = 'invalid'): RpcFailure {
  return {
    code: 'VALIDATION_ERROR',
    status: ERROR_STATUS.VALIDATION_ERROR,
    message,
    details: field ? { field, reason } : { reason },
  };
}

function outage(dryRun: boolean): RpcFailure {
  return { code: 'INTERNAL_ERROR', status: ERROR_STATUS.INTERNAL_ERROR, message: dryRun ? PREVIEW_FAILED : SAVE_FAILED };
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

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((key) => typeof key === 'string') ? [...value] : null;
}

function keyList(value: unknown): string[] | null {
  const list = stringList(value);
  return list === null ? null : normalizeGrants(list);
}

function readRole(value: unknown): RoleRead {
  if (value === null) return { ok: true, id: null };
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isUuid(id) ? { ok: true, id } : { ok: false };
}

function readExpected(value: unknown): Expected | null {
  if (!isRecord(value)) return null;
  const role = readRole(value.role_id);
  const direct = keyList(value.direct_permissions);
  const effective = keyList(value.page_permissions);
  if (!role.ok || direct === null || effective === null) return null;
  return { role_id: role.id, direct_permissions: direct, page_permissions: effective };
}

function readReason(value: unknown): string | null {
  const reason = typeof value === 'string' ? value.trim() : '';
  const length = Array.from(reason).length;
  return length >= REASON_MIN && length <= REASON_MAX ? reason : null;
}

function readRequest(body: Body, dryRun: boolean): RequestRead {
  const setRole = body.role_id !== undefined;
  const role = setRole ? readRole(body.role_id) : null;
  if (role && !role.ok) return { ok: false, failure: invalid(INVALID_ROLE, 'role_id') };
  let direct: string[] | null = null;
  if (body.direct_permissions !== undefined) {
    if (Array.isArray(body.direct_permissions) && body.direct_permissions.length > MAX_KEYS) {
      return { ok: false, failure: invalid(TOO_MANY_KEYS, 'direct_permissions') };
    }
    direct = keyList(body.direct_permissions);
    if (direct === null) return { ok: false, failure: invalid(INVALID_DIRECT, 'direct_permissions') };
  }
  const expected = readExpected(body.expected);
  if (!expected) return { ok: false, failure: invalid(INVALID_EXPECTED, 'expected') };
  const reason = readReason(body.reason);
  if (!dryRun && reason === null) return { ok: false, failure: invalid(REASON_MESSAGE, 'reason', 'reason_required') };
  const roleId = role && role.ok ? role.id : null;
  return { ok: true, request: { dryRun, setRole, roleId, direct, expected, reason } };
}

function refusedKeys(request: AccessRequest): RpcFailure | null {
  if (request.direct === null) return null;
  const held = [...request.expected.direct_permissions, ...request.expected.page_permissions];
  const refused = checkNewKeys(request.direct, held, 'direct');
  if (!refused) return null;
  const failure = invalid(refused.message, 'direct_permissions', 'not_grantable');
  return { ...failure, details: { ...failure.details, keys: refused.keys } };
}

function readSaved(value: unknown): SavedAccess | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const role = readRole(value.role_id ?? null);
  const direct = stringList(value.direct_permissions);
  const effective = stringList(value.page_permissions);
  if (!isUuid(id) || !role.ok || direct === null || effective === null) return null;
  return { id, role_id: role.id, direct_permissions: direct, page_permissions: effective };
}

function readOutcome(data: unknown, dryRun: boolean): Outcome {
  if (!isRecord(data)) return { kind: 'failed', error: UNREADABLE };
  if (data.ok !== true) {
    const failure = rpcFailure(data);
    const reason = typeof data.reason === 'string' ? data.reason : 'unknown';
    return failure.code === 'INTERNAL_ERROR'
      ? { kind: 'failed', error: `Unexpected refusal: ${reason}` }
      : { kind: 'refused', failure, error: failure.message };
  }
  const changed = data.changed;
  if (dryRun) {
    const before = stringList(data.before);
    const after = stringList(data.after);
    const direct = stringList(data.direct);
    const signsOut = data.signs_out;
    if (data.dry_run !== true || !before || !after || !direct || typeof changed !== 'boolean' || typeof signsOut !== 'boolean') {
      return { kind: 'failed', error: UNREADABLE };
    }
    return { kind: 'preview', before, after, direct, changed, signsOut };
  }
  const signedOut = data.signed_out;
  if (typeof changed !== 'boolean' || typeof signedOut !== 'boolean') return { kind: 'failed', error: UNREADABLE };
  if (!changed) return { kind: 'saved', changed: false, signedOut: false, admin: null };
  const admin = readSaved(data.admin);
  return admin ? { kind: 'saved', changed: true, signedOut, admin } : { kind: 'failed', error: UNREADABLE };
}

async function setAccess(admin: AdminContext, target: string, request: AccessRequest): Promise<Outcome> {
  let data: unknown;
  try {
    const result = await supabaseAdmin.rpc('admin_set_access', {
      p_actor: admin.admin_id,
      p_admin_id: target,
      p_expected_role_id: request.expected.role_id,
      p_expected_direct: request.expected.direct_permissions,
      p_expected_effective: request.expected.page_permissions,
      p_set_role: request.setRole,
      p_role_id: request.roleId,
      p_direct: request.direct,
      p_reason: request.reason,
      p_dry_run: request.dryRun,
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
  return readOutcome(data, request.dryRun);
}

function foldedKeys(before: readonly string[], direct: readonly string[], after: readonly string[]): string[] {
  const kept = new Set(direct);
  const fromRole = after.filter((key) => !kept.has(key));
  const uncovered = new Set(foldIntoRole(before, fromRole));
  return before.filter((key) => !kept.has(key) && !uncovered.has(key)).sort();
}

function attemptOf(body: Body): Record<string, unknown> {
  const attempt: Record<string, unknown> = {};
  if (typeof body.role_id === 'string' || body.role_id === null) attempt.role_id = body.role_id;
  const direct = keyList(body.direct_permissions);
  if (direct !== null) attempt.direct_permissions = direct;
  return attempt;
}

async function refuse(
  admin: AdminContext,
  saving: { target: string | null; body: Body } | null,
  failure: RpcFailure,
  error: string = failure.message,
): Promise<NextResponse> {
  if (saving) {
    await writeAudit({
      admin,
      action: 'EDIT_ADMIN_ACCESS',
      entity: ENTITY,
      entity_id: saving.target,
      before: readExpected(saving.body.expected),
      after: attemptOf(saving.body),
      reason: readReason(saving.body.reason),
      result: 'failure',
      error,
      sensitivity: 'security',
    });
  }
  return answer(failure);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  if (admin.session.client !== 'web') return fail('PERMISSION_DENIED', WEB_ONLY);

  const body = await readBody(req);
  if (!body) return answer(invalid(INVALID_BODY));
  if (body.dry_run !== undefined && typeof body.dry_run !== 'boolean') return answer(invalid(INVALID_DRY_RUN, 'dry_run'));
  const dryRun = body.dry_run === true;
  if (!dryRun) {
    const withoutTwoStep = await requireTwoStep(admin);
    if (withoutTwoStep) return withoutTwoStep;
    const stale = await requireRecentAuth(admin);
    if (stale) return stale;
  }

  const { id: raw } = await ctx.params;
  const target = readId(raw);
  const saving = dryRun ? null : { target, body };
  if (!target) return refuse(admin, saving, invalid(INVALID_ADMIN, 'id'));

  const read = readRequest(body, dryRun);
  if (!read.ok) return refuse(admin, saving, read.failure);
  const request = read.request;

  const refused = refusedKeys(request);
  if (refused) return refuse(admin, saving, refused);

  const outcome = await setAccess(admin, target, request);
  if (outcome.kind === 'failed') {
    console.error('admin access change failed:', outcome.error);
    return refuse(admin, saving, outage(dryRun), outcome.error);
  }
  if (outcome.kind === 'refused') return refuse(admin, saving, outcome.failure, outcome.error);
  if (outcome.kind === 'preview') {
    const diff = actionDiff(outcome.before, outcome.after);
    return ok({
      impact: {
        before: outcome.before,
        after: outcome.after,
        gained: diff.gained,
        lost: diff.lost,
        highest_risk: diff.highest_risk,
        changed: outcome.changed,
        signs_out: outcome.signsOut,
        folded: foldedKeys(request.expected.direct_permissions, outcome.direct, outcome.after),
      },
    });
  }
  return ok({
    admin: outcome.admin ?? {
      id: target,
      role_id: request.expected.role_id,
      direct_permissions: request.expected.direct_permissions,
      page_permissions: request.expected.page_permissions,
    },
    changed: outcome.changed,
    signed_out: outcome.signedOut,
  });
}
