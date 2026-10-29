import type { NextRequest } from 'next/server';
import { requireAdmin } from '../../../lib/guard';
import { sessionTokenFromRequest } from '../../../lib/jwt';
import { callEdgeFunction } from '../../../lib/edge';
import { ERROR_MESSAGE, fail, ok } from '../../../lib/api';
import { refuse } from '../../../lib/rateSync';
import { edgeFunctionReady, logEdgeAnswer } from '../../../lib/rateService';
import {
  RATE_SYNC_FUNCTION, RUN_EDGE_TIMEOUT_MS, TEXT, applySummaryJson, readRunAction, readRunAnswer,
} from '../../../(dashboard)/automatic-rates/rules';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const guard = await requireAdmin('rates.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  if (admin.session.client !== 'web') return fail('PERMISSION_DENIED', TEXT.runWebOnly);

  const checked = readRunAction(await req.json().catch(() => null));
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);

  if (!edgeFunctionReady()) {
    console.error('automatic rates run: SUPABASE_URL or ADMIN_FUNCTION_SECRET is not set');
    return fail('PROVIDER_ERROR', TEXT.runNotSetUp);
  }

  const { token } = await sessionTokenFromRequest();
  if (!token) return fail('AUTH_REQUIRED', ERROR_MESSAGE.AUTH_REQUIRED);

  const answer = await callEdgeFunction(RATE_SYNC_FUNCTION, {
    action: checked.value,
    ip: admin.ip,
    user_agent: admin.user_agent,
    request_id: admin.request_id,
  }, RUN_EDGE_TIMEOUT_MS, token);
  logEdgeAnswer('automatic rates run', answer);

  const reply = readRunAnswer(answer);
  if (!reply.ok) return refuse(reply);
  if (reply.mode === 'apply') return ok({ mode: 'apply', run_id: reply.runId, summary: applySummaryJson(reply.summary) });
  return ok({ mode: 'products', run_id: reply.runId, summary: { lines: reply.summary.lines, usable: reply.summary.usable } });
}
