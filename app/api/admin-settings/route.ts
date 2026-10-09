import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireSuperAdmin } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import {
  SECRET_KEYS,
  SETTINGS_KEYS,
  planSave,
  presentSettings,
  readSaveRequest,
  storedValues,
  type StoredSetting,
} from '../../(dashboard)/admin-settings/rules';

const ENTITY = 'app_config';
const COLUMNS = 'key, value, is_public, updated_at';
const PUBLIC_CACHE_KEY = 'app_config:public';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const NOT_SAVED = 'The settings could not be saved. Nothing was changed.';
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

async function sealSecretRows(keys: readonly string[]): Promise<boolean> {
  if (keys.length === 0) return true;
  const { error } = await supabaseAdmin
    .from('app_config')
    .upsert(keys.map((key) => ({ key, is_public: false })), { onConflict: 'key' });
  if (error) {
    console.error('admin settings secret seal failed:', error.code ?? 'unknown');
    return false;
  }
  return true;
}

async function keepSecretsPrivate(): Promise<void> {
  const { error } = await supabaseAdmin.from('app_config').update({ is_public: false }).in('key', [...SECRET_KEYS]);
  if (error) console.error('admin settings secret privacy failed:', error.code ?? 'unknown');
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

  const planned = planSave(storedValues(read.rows), request);
  if (!planned.ok) {
    if (planned.code === 'STATE_CONFLICT') {
      return fail('STATE_CONFLICT', planned.message, { details: { conflicts: planned.conflicts } });
    }
    return fail('VALIDATION_ERROR', planned.message);
  }
  const { plan } = planned;
  const changed = Object.keys(plan.updates);

  if (changed.length === 0) {
    await keepSecretsPrivate();
    return ok({ changed, unchanged: plan.unchanged });
  }

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

  if (!(await sealSecretRows(plan.secretUpdates))) {
    await writeAudit({ ...audit, result: 'failure', error: SECRET_WRITE_FAILED });
    return fail('INTERNAL_ERROR', NOT_SAVED);
  }

  const updatedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('app_config')
    .upsert(changed.map((key) => ({ key, value: plan.updates[key], updated_at: updatedAt })), { onConflict: 'key' });

  if (error) {
    console.error('admin settings save failed:', secretWrite ? error.code ?? 'unknown' : error.message);
    await writeAudit({ ...audit, result: 'failure', error: secretWrite ? SECRET_WRITE_FAILED : error.message });
    return fail('INTERNAL_ERROR', NOT_SAVED);
  }

  await keepSecretsPrivate();
  await clearPublicCache();

  const recorded = await writeAudit({ ...audit, result: 'success' });
  return ok({ changed, unchanged: plan.unchanged, ...auditFields(recorded.ok) });
}
