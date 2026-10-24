import type { NextRequest } from 'next/server';
import { requireAdminAll } from '../../../../lib/guard';
import { sessionTokenFromRequest } from '../../../../lib/jwt';
import { callEdgeFunction } from '../../../../lib/edge';
import { ERROR_MESSAGE, fail, isUuid, ok } from '../../../../lib/api';
import {
  DELETE_EDGE_FUNCTION, DELETE_EDGE_TIMEOUT_MS, DELETE_TEXT, readDeleteRequest, readEdgeAnswer,
} from '../../../../(dashboard)/users/[id]/accountDeletion';

export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminAll(['users.read', 'users.delete']);
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  if (admin.session.client !== 'web') return fail('PERMISSION_DENIED', DELETE_TEXT.webOnly);

  const { id: rawId } = await ctx.params;
  if (!isUuid(rawId)) return fail('VALIDATION_ERROR', 'Invalid user id.');
  const id = rawId.toLowerCase();

  const checked = readDeleteRequest(await req.json().catch(() => null));
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);

  if (!process.env.SUPABASE_URL || !process.env.ADMIN_FUNCTION_SECRET) {
    console.error('user delete: SUPABASE_URL or ADMIN_FUNCTION_SECRET is not set');
    return fail('PROVIDER_ERROR', DELETE_TEXT.notSetUp);
  }

  const { token } = await sessionTokenFromRequest();
  if (!token) return fail('AUTH_REQUIRED', ERROR_MESSAGE.AUTH_REQUIRED);

  const answer = await callEdgeFunction(DELETE_EDGE_FUNCTION, {
    user_id: id,
    request_email: checked.request.requestEmail,
    reason: checked.request.reason,
    ip: admin.ip,
    user_agent: admin.user_agent,
    request_id: admin.request_id,
  }, DELETE_EDGE_TIMEOUT_MS, token);

  if (answer.kind === 'failed') {
    console.error('user delete: no answer from the edge function:', answer.error instanceof Error ? answer.error.message : String(answer.error));
  } else if (answer.status !== 200) {
    const body = answer.body as { code?: unknown } | null;
    console.error('user delete: edge answered', answer.status, typeof body?.code === 'string' ? body.code : '');
  }

  const reply = readEdgeAnswer(answer);
  if (!reply.ok) return fail(reply.code, reply.message, reply.details ? { details: reply.details } : undefined);
  return ok({ deleted: true, resumed: reply.resumed, ...(reply.warning ? { warning: reply.warning } : {}) });
}
