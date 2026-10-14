import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminSession, type AdminJWTPayload, type SessionInfo } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';
import { writeAudit } from '../../../lib/audit';
import { ok } from '../../../lib/api';
import { SESSION_COOKIE, actorFor, clearSessionCookies, requestMeta } from '../../../lib/session';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function revokeThisDevice(adminId: string, sessionId: string): Promise<string | null> {
  try {
    const { error } = await supabaseAdmin.rpc('admin_session_revoke', {
      p_admin_id: adminId,
      p_sid: sessionId,
      p_actor: adminId,
      p_reason: 'logout',
    });
    return error ? error.message : null;
  } catch (error) {
    return errorText(error);
  }
}

async function revokeEverywhere(adminId: string): Promise<string | null> {
  try {
    const { error } = await supabaseAdmin.rpc('admin_bump_token_version', { p_target_admin_id: adminId });
    return error ? error.message : null;
  } catch (error) {
    return errorText(error);
  }
}

async function endSession(req: NextRequest, claims: AdminJWTPayload, session: SessionInfo | null): Promise<void> {
  const actor = actorFor({ id: claims.admin_id, role_title: claims.role_title }, await requestMeta(req.headers));
  if (session) {
    const revokeError = await revokeThisDevice(claims.admin_id, session.id);
    if (revokeError) console.error('admin logout session revoke failed:', revokeError);
    await writeAudit({
      admin: actor,
      action: 'LOGOUT',
      entity: 'admin_users',
      entity_id: claims.admin_id,
      after: { scope: 'this_device', session_id: session.id },
      result: revokeError ? 'partial' : 'success',
      error: revokeError,
      sensitivity: 'security',
    });
    return;
  }
  const bumpError = await revokeEverywhere(claims.admin_id);
  if (bumpError) console.error('admin logout session revoke failed:', bumpError);
  await writeAudit({
    admin: actor,
    action: 'LOGOUT',
    entity: 'admin_users',
    entity_id: claims.admin_id,
    after: { scope: 'everywhere_legacy' },
    result: bumpError ? 'partial' : 'success',
    error: bumpError,
    sensitivity: 'security',
  });
}

export async function POST(req: NextRequest) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const check = await verifyAdminSession(token, 'cookie');
    if (check.status === 'ok') await endSession(req, check.claims, check.session);
  }
  const response = await ok();
  clearSessionCookies(response);
  return response;
}
