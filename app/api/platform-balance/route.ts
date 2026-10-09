import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import {
  AUDIT_ACTION,
  AUDIT_WARNING,
  KEY_LABELS,
  READ_KEYS,
  conflictMessage,
  guardedWrite,
  planPatch,
  presentBalance,
  readPatchRequest,
  storedValues,
  type PatchPlan,
  type StoredValues,
} from '../../(dashboard)/platform-balance/model';

const ENTITY = 'app_config';
const PUBLIC_CACHE_KEY = 'app_config:public';
const LOAD_FAILED = 'The platform balance could not be loaded.';
const READ_FAILED = 'The current platform balance could not be read, so nothing was changed.';
const NOT_SAVED = 'The platform balance could not be saved. Nothing was changed.';

type ConfigRead = { ok: true; rows: unknown[] } | { ok: false };

type WriteResult = { ok: true } | { ok: false; conflict: true } | { ok: false; conflict: false; message: string };

const UNIQUE_VIOLATION = '23505';

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

async function writePlan(current: StoredValues, plan: PatchPlan, updatedAt: string): Promise<WriteResult> {
  const guarded = guardedWrite(current, plan);
  try {
    if (!guarded) {
      const { error } = await supabaseAdmin
        .from('app_config')
        .upsert(plan.changed.map((key) => ({ key, value: plan.updates[key], updated_at: updatedAt })), { onConflict: 'key' });
      return error ? { ok: false, conflict: false, message: error.message } : { ok: true };
    }
    const row = { value: guarded.value, updated_at: updatedAt };
    if (!guarded.exists) {
      const { error } = await supabaseAdmin.from('app_config').insert({ key: guarded.key, ...row });
      if (!error) return { ok: true };
      return error.code === UNIQUE_VIOLATION ? { ok: false, conflict: true } : { ok: false, conflict: false, message: error.message };
    }
    const update = supabaseAdmin.from('app_config').update(row).eq('key', guarded.key);
    const { data, error } = await (guarded.seen === null ? update.is('value', null) : update.eq('value', guarded.seen)).select('key');
    if (error) return { ok: false, conflict: false, message: error.message };
    return (data ?? []).length > 0 ? { ok: true } : { ok: false, conflict: true };
  } catch (error) {
    return { ok: false, conflict: false, message: describe(error) };
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

  const audit: AuditInput = {
    admin,
    action: AUDIT_ACTION,
    entity: ENTITY,
    entity_id: plan.entityId,
    before: plan.before,
    after: plan.after,
    sensitivity: 'financial',
  };

  const written = await writePlan(current, plan, new Date().toISOString());
  if (!written.ok) {
    if (written.conflict) return raceConflict(plan);
    console.error('platform balance save failed:', written.message);
    await writeAudit({ ...audit, result: 'failure', error: written.message });
    return fail('INTERNAL_ERROR', NOT_SAVED);
  }

  const [, recorded] = await Promise.all([refreshCaches(), writeAudit({ ...audit, result: 'success' })]);
  return ok({
    changed: plan.changed,
    unchanged: plan.unchanged,
    applied: plan.updates,
    ...(recorded.ok ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING }),
  });
}
