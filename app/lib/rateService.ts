import { sessionTokenFromRequest } from './jwt';
import { callEdgeFunction, type EdgeAnswer } from './edge';
import {
  RATE_SYNC_FUNCTION, STATUS_EDGE_TIMEOUT_MS, readProviders,
  type ProvidersReply,
} from '../(dashboard)/automatic-rates/rules';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function edgeFunctionReady(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.ADMIN_FUNCTION_SECRET);
}

export function logEdgeAnswer(label: string, answer: EdgeAnswer): void {
  if (answer.kind === 'failed') {
    console.error(`${label}: no answer from the rate service:`, describe(answer.error));
    return;
  }
  if (answer.status === 200) return;
  const body = answer.body !== null && typeof answer.body === 'object' && !Array.isArray(answer.body)
    ? (answer.body as Record<string, unknown>)
    : null;
  console.error(`${label}: the rate service answered`, answer.status, typeof body?.code === 'string' ? body.code : '');
}

export async function readProviderRegistry(label: string): Promise<ProvidersReply> {
  if (!edgeFunctionReady()) {
    console.error(`${label}: SUPABASE_URL or ADMIN_FUNCTION_SECRET is not set`);
    return { ok: false, failure: 'not_set_up' };
  }
  const { token } = await sessionTokenFromRequest();
  if (!token) return { ok: false, failure: 'session' };
  const answer = await callEdgeFunction(RATE_SYNC_FUNCTION, { action: 'status' }, STATUS_EDGE_TIMEOUT_MS, token);
  logEdgeAnswer(label, answer);
  return readProviders(answer);
}
