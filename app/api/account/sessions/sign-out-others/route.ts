import { supabaseAdmin } from '../../../../lib/supabase';
import { requireAdmin } from '../../../../lib/guard';
import { signSessionToken } from '../../../../lib/jwt';
import { writeAudit } from '../../../../lib/audit';
import { fail, ok } from '../../../../lib/api';
import { NO_STORE, epochSeconds, sessionTokenAdmin, setSessionCookie } from '../../../../lib/session';

const ENTITY = 'admin_users';
const SIGN_OUT_FAILED = 'Your other devices could not be signed out. Try again.';
const AUDIT_WARNING = 'Your other devices were signed out, but the change could not be written to the audit log.';

type RevokeAll =
  | { kind: 'done'; sessionsRevoked: number; sessionKept: boolean; tokenVersion: number | null; released: number }
  | { kind: 'failed'; message: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

async function revokeOthers(adminId: string, keepSid: string | null): Promise<RevokeAll> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_sessions_revoke_all', {
      p_admin_id: adminId,
      p_actor: adminId,
      p_keep_sid: keepSid,
      p_bump_token: true,
      p_reason: 'signed_out_others',
    });
    if (error) return { kind: 'failed', message: error.message };
    const result = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    if (!result) return { kind: 'failed', message: 'The sign-out returned no result.' };
    const version = result.token_version;
    return {
      kind: 'done',
      sessionsRevoked: Number(result.sessions_revoked) || 0,
      sessionKept: result.session_kept === true,
      tokenVersion: typeof version === 'number' && Number.isInteger(version) ? version : null,
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
  const session = admin.session.transport === 'cookie' ? admin.session : null;

  const outcome = await revokeOthers(adminId, session ? session.id : null);
  if (outcome.kind === 'failed') {
    console.error('admin sign-out of other devices failed:', outcome.message);
    await writeAudit({
      admin,
      action: 'ADMIN_SESSIONS_SIGNED_OUT_OTHERS',
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
    action: 'ADMIN_SESSIONS_SIGNED_OUT_OTHERS',
    entity: ENTITY,
    entity_id: adminId,
    after: {
      client: 'web',
      sessions_revoked: outcome.sessionsRevoked,
      session_kept: outcome.sessionKept,
      push_tokens_released: outcome.released,
    },
    result: 'success',
    sensitivity: 'security',
  });

  let token: string | null = null;
  if (session && outcome.sessionKept && outcome.tokenVersion !== null) {
    try {
      token = await signSessionToken(
        sessionTokenAdmin(admin, outcome.tokenVersion),
        session.id,
        session.amr,
        epochSeconds(session.expiresAt),
      );
    } catch (error) {
      console.error('admin session signing failed:', errorText(error));
    }
  }

  const res = await ok({
    sessions_revoked: outcome.sessionsRevoked,
    session_renewed: token !== null,
    ...auditFields(recorded.ok),
  }, { headers: { ...NO_STORE } });
  if (session && token !== null) setSessionCookie(res, token, session.expiresAt);
  return res;
}
