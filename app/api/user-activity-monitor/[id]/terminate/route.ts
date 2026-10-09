import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { requireSuperAdmin } from '../../../../lib/guard';
import { writeAudit, type AuditInput } from '../../../../lib/audit';
import { fail, isUuid, ok } from '../../../../lib/api';
import { checkTerminateReason } from '../../../../(dashboard)/user-activity-monitor/rules';

const AUDIT_WARNING = 'Every sign-in was revoked, but this could not be written to the audit log.';

interface TargetUser {
  id: string;
  last_active_at: string | null;
  deleted_at: string | null;
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const raw: unknown = await req.json().catch(() => null);
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

async function countOpenSessions(userId: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('login_history')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('ended_at', null);
  if (error) {
    console.error('user activity open sessions:', error.message);
    return null;
  }
  return count ?? 0;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fail('VALIDATION_ERROR', 'Invalid user id.');
  const userId = id.toLowerCase();

  const body = await readBody(req);
  const reason = checkTerminateReason(body.reason);
  if (!reason.ok) return fail('VALIDATION_ERROR', reason.message);

  const { data: target, error: readError } = await supabaseAdmin
    .from('users')
    .select('id, last_active_at, deleted_at')
    .eq('id', userId)
    .maybeSingle<TargetUser>();
  if (readError) {
    console.error('user activity terminate read:', readError.message);
    return fail('INTERNAL_ERROR', 'The user could not be read, so no sessions were ended.');
  }
  if (!target) return fail('RESOURCE_NOT_FOUND', 'User not found.');

  const openBefore = await countOpenSessions(userId);
  const audit: AuditInput = {
    admin,
    action: 'TERMINATE_USER_SESSIONS',
    entity: 'users',
    entity_id: userId,
    user_id: userId,
    before: { open_sessions: openBefore, last_active_at: target.last_active_at, deleted: target.deleted_at !== null },
    reason: reason.reason,
    sensitivity: 'security',
  };

  const { error: rpcError } = await supabaseAdmin.rpc('terminate_user_sessions', {
    p_user_id: userId,
    p_admin_id: admin.admin_id,
  });

  if (rpcError) {
    console.error('terminate_user_sessions:', rpcError.message);
    await writeAudit({
      ...audit,
      after: null,
      result: 'failure',
      error: rpcError.message,
    });
    if (/not authorized/i.test(rpcError.message || '')) {
      return fail('PERMISSION_DENIED', 'Your account is no longer allowed to end user sessions. Nothing was changed.');
    }
    return fail('INTERNAL_ERROR', 'The sessions could not be ended. Signing out everywhere again is safe.');
  }

  const openAfter = await countOpenSessions(userId);
  const recorded = await writeAudit({
    ...audit,
    after: { open_sessions: openAfter, last_active_at: null, sign_ins_revoked: true },
    result: 'success',
  });

  return ok({
    ended_sessions: openBefore,
    open_sessions: openAfter,
    audit_recorded: recorded.ok,
    ...(recorded.ok ? {} : { warning: AUDIT_WARNING }),
  });
}
