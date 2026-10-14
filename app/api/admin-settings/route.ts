import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireSuperAdmin } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import { RACE_CONFLICT_MESSAGE, compareAndSet, inOrder, seenValues } from '../../lib/configCas';
import {
  SECRET_KEYS,
  SETTINGS_KEYS,
  auditValue,
  conflictMessage,
  planSave,
  presentSettings,
  readSaveRequest,
  settingLabel,
  storedValues,
  type SettingsConflict,
  type StoredSetting,
} from '../../(dashboard)/admin-settings/rules';

const ENTITY = 'app_config';
const COLUMNS = 'key, value, is_public, updated_at';
const PUBLIC_CACHE_KEY = 'app_config:public';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const NOT_SAVED = 'The settings could not be saved. Nothing was changed.';
const UNCONFIRMED = 'The save could not be confirmed. Reload the settings to check them before trying again.';
const SECRET_WRITE_FAILED = 'The database refused the write.';

type SettingsRead = { ok: true; rows: StoredSetting[] } | { ok: false };

async function readSettings(): Promise<SettingsRead> {
  const { data, error } = await supabaseAdmin.from('app_config').select(COLUMNS).in('key', [...SETTINGS_KEYS]);
  if (error) {
    console.error('admin settings read:', error.message);
    return { ok: false };
  }
  return { ok: true, rows: (data ?? []) as StoredSetting[] };
}

async function raceConflict(keys: readonly string[]) {
  const read = await readSettings();
  const latest = read.ok ? storedValues(read.rows) : null;
  const conflicts: SettingsConflict[] = keys.map((key) => ({
    key,
    label: settingLabel(key),
    current: latest ? auditValue(key, latest[key]) : null,
  }));
  return fail('STATE_CONFLICT', keys.length > 0 ? conflictMessage(keys) : RACE_CONFLICT_MESSAGE, { details: { conflicts } });
}

async function clearPublicCache(): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('edge_cache_delete', { p_key: PUBLIC_CACHE_KEY });
    if (error) console.error('admin settings cache clear:', error.message);
  } catch (error) {
    console.error('admin settings cache clear:', error instanceof Error ? error.message : String(error));
  }
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const read = await readSettings();
  if (!read.ok) return fail('INTERNAL_ERROR', 'The settings could not be loaded.');
  return ok({ ...presentSettings(read.rows) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body: unknown = await req.json().catch(() => null);
  const parsed = readSaveRequest(body);
  if (!parsed.ok) return fail('VALIDATION_ERROR', parsed.message);
  const { request } = parsed;

  const read = await readSettings();
  if (!read.ok) return fail('INTERNAL_ERROR', 'The current settings could not be read, so nothing was changed.');

  const current = storedValues(read.rows);
  const planned = planSave(current, request);
  if (!planned.ok) {
    if (planned.code === 'STATE_CONFLICT') {
      return fail('STATE_CONFLICT', planned.message, { details: { conflicts: planned.conflicts } });
    }
    return fail('VALIDATION_ERROR', planned.message);
  }
  const { plan } = planned;
  const order = [...Object.keys(request.changes), ...SETTINGS_KEYS];

  const secretWrite = plan.secretUpdates.length > 0;
  const audit: AuditInput = {
    admin,
    action: plan.action,
    entity: ENTITY,
    entity_id: plan.entityId,
    before: plan.before,
    after: plan.after,
    reason: request.reason,
    sensitivity: plan.sensitivity,
  };

  const outcome = await compareAndSet({
    changes: plan.updates,
    expected: seenValues(current, SETTINGS_KEYS),
    privateKeys: SECRET_KEYS,
    order,
  });
  if (outcome.kind === 'conflict') return raceConflict(outcome.conflicts.map((conflict) => conflict.key));
  if (outcome.kind === 'failed') {
    console.error('admin settings save failed:', secretWrite ? outcome.code ?? 'unknown' : outcome.message);
    if (Object.keys(plan.updates).length > 0) {
      await writeAudit({ ...audit, result: 'failure', error: secretWrite ? SECRET_WRITE_FAILED : outcome.message });
    }
    return fail('INTERNAL_ERROR', outcome.outcomeUnknown ? UNCONFIRMED : NOT_SAVED);
  }

  const { changed } = outcome;
  const unchanged = inOrder([...plan.unchanged, ...outcome.unchanged], order);
  if (changed.length === 0) return ok({ changed, unchanged });

  await clearPublicCache();

  const recorded = await writeAudit({ ...audit, result: 'success' });
  return ok({ changed, unchanged, ...auditFields(recorded.ok) });
}
