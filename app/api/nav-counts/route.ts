import { supabaseAdmin } from '../../lib/supabase';
import { requireAdminAny } from '../../lib/guard';
import { fail, ok } from '../../lib/api';
import { NO_STORE } from '../../lib/session';
import { REALTIME_TOPICS, isWebSession, realtimeTopicKeys, type RealtimeTopicKey } from '../../lib/realtimePass';
import { businessRange } from '../../lib/time';
import type { MetricGroup } from '../../lib/dashboard';

interface CountSource {
  group: MetricGroup;
  metrics: readonly string[];
}

type WaitingCounts = Partial<Record<RealtimeTopicKey, number>>;

const COUNT_SOURCES: Readonly<Record<RealtimeTopicKey, CountSource>> = {
  withdrawals: { group: 'withdrawals', metrics: ['pendingWithdrawals'] },
  cards: { group: 'cards', metrics: ['pendingCards', 'disputedCards'] },
};

const COUNT_PERMISSIONS = REALTIME_TOPICS.map((grant) => grant.permission);
const COUNT_TIMEOUT_MS = 10000;
const COUNTS_ERROR = 'The waiting counts could not be loaded.';
const WHOLE_NUMBER = /^\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countOf(value: unknown): number | null {
  const n = typeof value === 'string' && WHOLE_NUMBER.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unexpected error';
}

async function readMetrics(keys: readonly RealtimeTopicKey[]): Promise<Record<string, unknown> | null> {
  const range = businessRange(1);
  try {
    const { data, error } = await supabaseAdmin
      .rpc('admin_dashboard_metrics', {
        p_from: range.from_iso,
        p_to: range.to_iso,
        p_online_from: null,
        p_groups: keys.map((key) => COUNT_SOURCES[key].group),
      })
      .abortSignal(AbortSignal.timeout(COUNT_TIMEOUT_MS));
    if (error) {
      console.error('nav counts failed:', error.message);
      return null;
    }
    if (!isRecord(data)) {
      console.error('nav counts failed:', 'the metrics payload was not an object');
      return null;
    }
    return data;
  } catch (error) {
    console.error('nav counts failed:', errorText(error));
    return null;
  }
}

async function waitingCounts(keys: readonly RealtimeTopicKey[]): Promise<WaitingCounts | null> {
  const stats = await readMetrics(keys);
  if (!stats) return null;
  const counts: WaitingCounts = {};
  for (const key of keys) {
    let total = 0;
    for (const metric of COUNT_SOURCES[key].metrics) {
      const value = countOf(stats[metric]);
      if (value === null) {
        console.error('nav counts failed:', `${metric} was missing or not a count`);
        return null;
      }
      total += value;
    }
    counts[key] = total;
  }
  return counts;
}

export async function GET() {
  const guard = await requireAdminAny(COUNT_PERMISSIONS);
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  if (!isWebSession(admin.session)) return fail('PERMISSION_DENIED');

  const counts = await waitingCounts(realtimeTopicKeys(admin.can));
  if (!counts) return fail('INTERNAL_ERROR', COUNTS_ERROR);

  return ok({ counts }, { headers: { ...NO_STORE } });
}
