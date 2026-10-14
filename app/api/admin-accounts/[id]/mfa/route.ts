import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { requireRecentAuth, requireSuperAdmin, requireTwoStep } from '../../../../lib/guard';
import { writeAudit } from '../../../../lib/audit';
import { fail, isUuid, ok } from '../../../../lib/api';

const ENTITY = 'admin_users';
const REASON_MIN = 3;
const REASON_MAX = 500;

const INVALID_ADMIN = 'A valid admin account id is required.';
const OWN_TWO_STEP = 'You cannot reset your own two-step sign-in. Another super administrator has to do it.';
const REASON_SHORT = `Give a reason of at least ${REASON_MIN} characters.`;
const REASON_LONG = `The reason must be ${REASON_MAX} characters or fewer.`;
const NOT_FOUND = 'Admin account not found.';
const NOT_ENROLLED = 'This admin has no two-step sign-in to reset.';
const RESET_FAILED = 'Two-step sign-in could not be reset. Try again.';
const AUDIT_WARNING = 'Two-step sign-in was reset, but the change could not be written to the audit log.';

type ReasonRead = { ok: true; reason: string } | { ok: false; message: string };

type Reset =
  | { kind: 'done'; previousStatus: string; codesRemoved: number; sessionsRevoked: number }
  | { kind: 'refused'; reason: string }
  | { kind: 'failed'; message: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isUuid(id) ? id : null;
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const raw: unknown = await req.json().catch(() => null);
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function readReason(value: unknown): ReasonRead {
  const reason = typeof value === 'string' ? value.trim() : '';
  const length = Array.from(reason).length;
  if (length < REASON_MIN) return { ok: false, message: REASON_SHORT };
  if (length > REASON_MAX) return { ok: false, message: REASON_LONG };
  return { ok: true, reason };
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

async function resetTwoStep(actor: string, target: string, reason: string): Promise<Reset> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_mfa_reset', {
      p_actor: actor,
      p_target: target,
      p_reason: reason,
    });
    if (error) return { kind: 'failed', message: error.message };
    const result = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    if (!result) return { kind: 'failed', message: 'The reset returned no result.' };
    if (result.ok !== true) return { kind: 'refused', reason: typeof result.reason === 'string' ? result.reason : 'unknown' };
    return {
      kind: 'done',
      previousStatus: result.previous_status === 'pending' ? 'pending' : 'active',
      codesRemoved: Number(result.recovery_codes_removed) || 0,
      sessionsRevoked: Number(result.sessions_revoked) || 0,
    };
  } catch (error) {
    return { kind: 'failed', message: errorText(error) };
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const withoutTwoStep = await requireTwoStep(admin);
  if (withoutTwoStep) return withoutTwoStep;
  const stale = await requireRecentAuth(admin);
  if (stale) return stale;

  const { id: raw } = await ctx.params;
  const target = readId(raw);
  if (!target) return fail('VALIDATION_ERROR', INVALID_ADMIN);
  const actor = admin.admin_id.toLowerCase();
  if (target === actor) return fail('VALIDATION_ERROR', OWN_TWO_STEP);

  const body = await readBody(req);
  const reason = readReason(body?.reason);
  if (!reason.ok) return fail('VALIDATION_ERROR', reason.message, { details: { field: 'reason' } });

  const outcome = await resetTwoStep(actor, target, reason.reason);
  if (outcome.kind === 'failed') {
    console.error('admin two-step reset failed:', outcome.message);
    await writeAudit({
      admin,
      action: 'MFA_RESET',
      entity: ENTITY,
      entity_id: target,
      reason: reason.reason,
      result: 'failure',
      error: outcome.message,
      sensitivity: 'security',
    });
    return fail('INTERNAL_ERROR', RESET_FAILED);
  }
  if (outcome.kind === 'refused') {
    if (outcome.reason === 'not_enrolled') return fail('STATE_CONFLICT', NOT_ENROLLED, { details: { reason: 'not_enrolled' } });
    if (outcome.reason === 'target_not_found') return fail('RESOURCE_NOT_FOUND', NOT_FOUND);
    if (outcome.reason === 'self') return fail('VALIDATION_ERROR', OWN_TWO_STEP);
    console.error('admin two-step reset failed:', 'unexpected refusal');
    return fail('INTERNAL_ERROR', RESET_FAILED);
  }

  const recorded = await writeAudit({
    admin,
    action: 'MFA_RESET',
    entity: ENTITY,
    entity_id: target,
    before: { mfa_status: outcome.previousStatus, recovery_codes_left: outcome.codesRemoved },
    after: { mfa_status: 'none', sessions_revoked: outcome.sessionsRevoked, token_version_bumped: true },
    reason: reason.reason,
    result: 'success',
    sensitivity: 'security',
  });
  return ok({
    ok: true,
    previous_status: outcome.previousStatus,
    sessions_revoked: outcome.sessionsRevoked,
    ...auditFields(recorded.ok),
  });
}
