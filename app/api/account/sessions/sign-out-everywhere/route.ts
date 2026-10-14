import { supabaseAdmin } from '../../../../lib/supabase';
import { requireAdmin } from '../../../../lib/guard';
import { writeAudit } from '../../../../lib/audit';
import { fail, ok } from '../../../../lib/api';
import { NO_STORE, clearSessionCookies } from '../../../../lib/session';

const ENTITY = 'admin_users';
const SIGN_OUT_FAILED = 'You could not be signed out everywhere. Try again.';
const AUDIT_WARNING = 'You were signed out everywhere, but the change could not be written to the audit log.';

type RevokeAll = { kind: 'done'; sessionsRevoked: number; released: number } | { kind: 'failed'; message: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

async function revokeEverywhere(adminId: string): Promise<RevokeAll> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_sessions_revoke_all', {
      p_admin_id: adminId,
      p_actor: adminId,
      p_keep_sid: null,
      p_bump_token: true,
      p_reason: 'signed_out_everywhere',
    });
    if (error) return { kind: 'failed', message: error.message };
    const result = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    if (!result) return { kind: 'failed', message: 'The sign-out returned no result.' };
    return {
      kind: 'done',
      sessionsRevoked: Number(result.sessions_revoked) || 0,
      released: Number(result.push_tokens_released) || 0,
    };
  } catch (error) {
    return { kind: 'failed', message: errorText(error) };
  }
}

export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  const adminId = admin.admin_id.toLowerCase();

  const outcome = await revokeEverywhere(adminId);
  if (outcome.kind === 'failed') {
    console.error('admin sign-out everywhere failed:', outcome.message);
    await writeAudit({
      admin,
      action: 'ADMIN_SESSIONS_SIGNED_OUT_EVERYWHERE',
      entity: ENTITY,
      entity_id: adminId,
      after: { client: 'web' },
      result: 'failure',
      error: outcome.message,
      sensitivity: 'security',
    });
    return fail('INTERNAL_ERROR', SIGN_OUT_FAILED);
  }

  const recorded = await writeAudit({
    admin,
    action: 'ADMIN_SESSIONS_SIGNED_OUT_EVERYWHERE',
    entity: ENTITY,
    entity_id: adminId,
    after: { client: 'web', sessions_revoked: outcome.sessionsRevoked, push_tokens_released: outcome.released },
    result: 'success',
    sensitivity: 'security',
  });

  const res = await ok({
    sessions_revoked: outcome.sessionsRevoked,
    ...auditFields(recorded.ok),
  }, { headers: { ...NO_STORE } });
  clearSessionCookies(res);
  return res;
}
