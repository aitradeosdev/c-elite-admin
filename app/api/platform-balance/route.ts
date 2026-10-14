import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import { compareAndSet, pick, seenValues } from '../../lib/configCas';
import {
  AUDIT_ACTION,
  AUDIT_WARNING,
  KEY_LABELS,
  READ_KEYS,
  WRITABLE_KEYS,
  changeAudit,
  conflictMessage,
  planPatch,
  presentBalance,
  readPatchRequest,
  storedValues,
  type ChangeAudit,
  type PatchPlan,
  type StoredValues,
} from '../../(dashboard)/platform-balance/model';

const ENTITY = 'app_config';
const PUBLIC_CACHE_KEY = 'app_config:public';
const LOAD_FAILED = 'The platform balance could not be loaded.';
const READ_FAILED = 'The current platform balance could not be read, so nothing was changed.';
const NOT_SAVED = 'The platform balance could not be saved. Nothing was changed.';
const UNCONFIRMED = 'The save could not be confirmed. Reload the platform balance to check it before trying again.';

type ConfigRead = { ok: true; rows: unknown[] } | { ok: false };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readConfig(columns: string): Promise<ConfigRead> {
  try {
    const { data, error } = await supabaseAdmin.from('app_config').select(columns).in('key', [...READ_KEYS]);
    if (error) {
      console.error('platform balance read:', error.message);
      return { ok: false };
    }
    return { ok: true, rows: (data ?? []) as unknown[] };
  } catch (error) {
    console.error('platform balance read:', describe(error));
    return { ok: false };
  }
}

async function runRpc(name: string, args: Record<string, unknown> | undefined, label: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc(name, args);
    if (error) console.error(`platform balance ${label}:`, error.message);
  } catch (error) {
    console.error(`platform balance ${label}:`, describe(error));
  }
}

async function raceConflict(plan: PatchPlan) {
  const read = await readConfig('key, value');
  const latest: StoredValues = read.ok ? storedValues(read.rows) : {};
  const conflicts = plan.changed.map((key) => ({ key, label: KEY_LABELS[key], current: latest[key] ?? null }));
  return fail('STATE_CONFLICT', conflictMessage(plan.changed), { details: { conflicts } });
}

async function refreshCaches(): Promise<void> {
  await runRpc('edge_cache_delete', { p_key: PUBLIC_CACHE_KEY }, 'cache clear');
  await runRpc('build_marketplace_feed_cache', undefined, 'feed rebuild');
}

function auditOf(admin: AdminContext, change: ChangeAudit): AuditInput {
  return {
    admin,
    action: AUDIT_ACTION,
    entity: ENTITY,
    entity_id: change.entityId,
    before: change.before,
    after: change.after,
    sensitivity: 'financial',
  };
}

export async function GET() {
  const guard = await requireAdmin('platform_balance.read');
  if (!guard.ok) return guard.response;

  const read = await readConfig('key, value, updated_at');
  if (!read.ok) return fail('INTERNAL_ERROR', LOAD_FAILED);
  return ok({ ...presentBalance(read.rows) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('platform_balance.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body: unknown = await req.json().catch(() => null);
  const parsed = readPatchRequest(body);
  if (!parsed.ok) return fail('VALIDATION_ERROR', parsed.message);

  const read = await readConfig('key, value');
  if (!read.ok) return fail('INTERNAL_ERROR', READ_FAILED);

  const current = storedValues(read.rows);
  const planned = planPatch(current, parsed.request);
  if (!planned.ok) {
    if (planned.code === 'STATE_CONFLICT') {
      return fail('STATE_CONFLICT', planned.message, { details: { conflicts: planned.conflicts } });
    }
    return fail('VALIDATION_ERROR', planned.message);
  }
  const { plan } = planned;

  if (plan.changed.length === 0) {
    return ok({ changed: [], unchanged: plan.unchanged, applied: {} });
  }

  const outcome = await compareAndSet({
    changes: plan.updates,
    expected: seenValues(current, plan.changed),
    privateKeys: null,
    order: WRITABLE_KEYS,
  });
  if (outcome.kind === 'conflict') return raceConflict(plan);
  if (outcome.kind === 'failed') {
    console.error('platform balance save failed:', outcome.message);
    const audit = auditOf(admin, plan);
    await writeAudit({ ...audit, result: 'failure', error: outcome.message });
    return fail('INTERNAL_ERROR', outcome.outcomeUnknown ? UNCONFIRMED : NOT_SAVED);
  }

  const changed = WRITABLE_KEYS.filter((key) => outcome.changed.includes(key));
  const unchanged = WRITABLE_KEYS.filter((key) => plan.unchanged.includes(key) || outcome.unchanged.includes(key));
  if (changed.length === 0) return ok({ changed, unchanged, applied: {} });

  const applied = pick(plan.updates, changed);
  const settled = { ...current, ...outcome.before, ...pick(plan.updates, outcome.unchanged) };
  const audit = auditOf(admin, changeAudit(settled, applied));
  const [, recorded] = await Promise.all([refreshCaches(), writeAudit({ ...audit, result: 'success' })]);
  return ok({
    changed,
    unchanged,
    applied,
    ...(recorded.ok ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING }),
  });
}
