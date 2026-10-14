import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireSuperAdmin } from '../../../../../lib/guard';
import { writeAudit } from '../../../../../lib/audit';
import { fail, isUuid, ok } from '../../../../../lib/api';

const ENTITY = 'admin_users';
const REASON_MIN = 3;
const REASON_MAX = 500;

const INVALID_ADMIN = 'A valid admin account id is required.';
const INVALID_SESSION = 'A valid session id is required.';
const OWN_DEVICES = 'Manage your own devices on your Profile.';
const REASON_SHORT = `Give a reason of at least ${REASON_MIN} characters.`;
const REASON_LONG = `The reason must be ${REASON_MAX} characters or fewer.`;
const REVOKE_FAILED = 'That device could not be signed out. Try again.';
const AUDIT_WARNING = 'The device was signed out, but the change could not be written to the audit log.';

type ReasonRead = { ok: true; reason: string } | { ok: false; message: string };

type Revoke =
  | { kind: 'done'; revoked: boolean; client: string | null; released: number }
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

async function revoke(target: string, sessionId: string, actor: string): Promise<Revoke> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_session_revoke', {
      p_admin_id: target,
      p_sid: sessionId,
      p_actor: actor,
      p_reason: 'revoked_by_admin',
    });
    if (error) return { kind: 'failed', message: error.message };
    const result = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    if (!result) return { kind: 'failed', message: 'The sign-out returned no result.' };
    return {
      kind: 'done',
      revoked: result.revoked === true,
      client: typeof result.client === 'string' ? result.client : null,
      released: Number(result.push_tokens_released) || 0,
    };
  } catch (error) {
    return { kind: 'failed', message: errorText(error) };
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; sid: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const params = await ctx.params;
  const target = readId(params.id);
  if (!target) return fail('VALIDATION_ERROR', INVALID_ADMIN);
  const sessionId = readId(params.sid);
  if (!sessionId) return fail('VALIDATION_ERROR', INVALID_SESSION);
  if (target === admin.admin_id.toLowerCase()) return fail('VALIDATION_ERROR', OWN_DEVICES);

  const body = await readBody(req);
  const reason = readReason(body?.reason);
  if (!reason.ok) return fail('VALIDATION_ERROR', reason.message, { details: { field: 'reason' } });

  const outcome = await revoke(target, sessionId, admin.admin_id.toLowerCase());
  if (outcome.kind === 'failed') {
    console.error('admin device sign-out by a super admin failed:', outcome.message);
    await writeAudit({
      admin,
      action: 'ADMIN_SESSION_REVOKED',
      entity: ENTITY,
      entity_id: target,
      after: { session_id: sessionId, by: 'super_admin' },
      reason: reason.reason,
      result: 'failure',
      error: outcome.message,
      sensitivity: 'security',
    });
    return fail('INTERNAL_ERROR', REVOKE_FAILED);
  }
  if (!outcome.revoked) return ok({ revoked: false });

  const recorded = await writeAudit({
    admin,
    action: 'ADMIN_SESSION_REVOKED',
    entity: ENTITY,
    entity_id: target,
    after: {
      session_id: sessionId,
      session_client: outcome.client,
      by: 'super_admin',
      push_tokens_released: outcome.released,
    },
    reason: reason.reason,
    result: 'success',
    sensitivity: 'security',
  });
  return ok({ revoked: true, ...auditFields(recorded.ok) });
}
