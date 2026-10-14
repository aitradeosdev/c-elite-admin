import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { requireAdmin } from '../../../../lib/guard';
import { writeAudit } from '../../../../lib/audit';
import { fail, isUuid, ok } from '../../../../lib/api';

const ENTITY = 'admin_users';
const INVALID_ID = 'A valid session id is required.';
const THIS_DEVICE = 'This is the device you are using. Use Log out instead.';
const REVOKE_FAILED = 'That device could not be signed out. Try again.';
const AUDIT_WARNING = 'The device was signed out, but the change could not be written to the audit log.';

type Revoke =
  | { kind: 'done'; revoked: boolean; client: string | null; released: number }
  | { kind: 'failed'; message: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

async function revoke(adminId: string, sessionId: string): Promise<Revoke> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_session_revoke', {
      p_admin_id: adminId,
      p_sid: sessionId,
      p_actor: adminId,
      p_reason: 'signed_out_by_owner',
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

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  const adminId = admin.admin_id.toLowerCase();

  const { id: raw } = await ctx.params;
  const sessionId = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!isUuid(sessionId)) return fail('VALIDATION_ERROR', INVALID_ID);
  if (admin.session && admin.session.id.toLowerCase() === sessionId) return fail('STATE_CONFLICT', THIS_DEVICE);

  const outcome = await revoke(adminId, sessionId);
  if (outcome.kind === 'failed') {
    console.error('admin device sign-out failed:', outcome.message);
    await writeAudit({
      admin,
      action: 'ADMIN_SESSION_REVOKED',
      entity: ENTITY,
      entity_id: adminId,
      after: { client: 'web', session_id: sessionId, by: 'owner' },
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
    entity_id: adminId,
    after: {
      client: 'web',
      session_id: sessionId,
      session_client: outcome.client,
      by: 'owner',
      push_tokens_released: outcome.released,
    },
    result: 'success',
    sensitivity: 'security',
  });
  return ok({ revoked: true, ...auditFields(recorded.ok) });
}
