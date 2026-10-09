import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireSuperAdmin } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import { isSecretConfigKey } from '../../lib/configSecrets';
import { planConfigWrite, readConfigKeys, readConfigPatch } from '../../(dashboard)/referral-management/appConfigRules';

const ENTITY = 'app_config';
const ACTION = 'UPDATE_APP_CONFIG';
const PUBLIC_CACHE_KEY = 'app_config:public';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const NOT_SAVED = 'The settings could not be saved. Nothing was changed.';

const ALLOWED_KEYS = new Set<string>([
  'bill_vtpass_enabled', 'bill_novac_enabled', 'active_bill_provider',
  'gateway_paystack_enabled', 'gateway_monnify_enabled', 'gateway_novac_enabled',
  'min_withdrawal_amount', 'max_withdrawal_amount', 'max_daily_withdrawal', 'withdraw_fee',
  'min_electricity_amount', 'electricity_quick_amounts',
  'min_airtime_amount', 'max_airtime_amount',
  'min_data_amount', 'max_data_amount',
  'min_cable_amount', 'max_cable_amount',
  'signup_bonus_amount', 'signup_bonus_condition', 'signup_bonus_active',
  'referral_active', 'referral_referrer_bonus', 'referral_referee_bonus', 'referral_min_trade_usd', 'referral_max_per_day',
  'level_bonus_active', 'levels_active',
  'pin_reset_freeze_hours',
  'large_withdrawal_flag_threshold',
  'signup_rate_limit_per_hour',
  'anomaly_dormant_days', 'anomaly_dormant_amount',
  'anomaly_rapid_window_mins', 'anomaly_rapid_ratio',
  'anomaly_failures_window_mins', 'anomaly_failures_threshold',
  'critical_alert_amount', 'alert_email_batch',
  'paystack_webhook_ips', 'monnify_webhook_ips', 'novac_webhook_ips',
  'terms_url', 'privacy_url', 'chatwoot_base_url', 'chatwoot_website_token',
  'store_url_android', 'store_url_ios',
  'app_current_version', 'app_update_type', 'app_update_message',
  'withdrawal_narrations',
  'coupon_terms_of_use',
  'iana_timezone',
]);

interface ConfigRow {
  key: string;
  value: string | null;
}

async function clearPublicCache(): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('edge_cache_delete', { p_key: PUBLIC_CACHE_KEY });
    if (error) console.error('app config cache clear:', error.message);
  } catch (error) {
    console.error('app config cache clear:', error instanceof Error ? error.message : String(error));
  }
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const requested = readConfigKeys(new URL(req.url).searchParams.get('keys'));
  if (!requested.ok) return fail('VALIDATION_ERROR', requested.message);
  if (requested.keys && requested.keys.length === 0) return ok({ config: {} });

  let query = supabaseAdmin.from('app_config').select('key, value');
  if (requested.keys) query = query.in('key', requested.keys);
  const { data, error } = await query;
  if (error) {
    console.error('app config read:', error.message);
    return fail('INTERNAL_ERROR', 'The configuration could not be loaded.');
  }

  const config: Record<string, string | null> = {};
  for (const row of (data ?? []) as ConfigRow[]) {
    if (typeof row.key !== 'string' || isSecretConfigKey(row.key)) continue;
    config[row.key] = row.value;
  }
  return ok({ config });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body: unknown = await req.json().catch(() => null);
  const checked = readConfigPatch(body, ALLOWED_KEYS);
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const { patch } = checked;

  const { data: rows, error: readError } = await supabaseAdmin
    .from('app_config')
    .select('key, value')
    .in('key', Object.keys(patch.changes));
  if (readError) {
    console.error('app config current read:', readError.message);
    return fail('INTERNAL_ERROR', 'The current values could not be read, so nothing was saved.');
  }
  const current: Record<string, string | null> = {};
  for (const row of (rows ?? []) as ConfigRow[]) {
    if (typeof row.key === 'string') current[row.key] = typeof row.value === 'string' ? row.value : null;
  }

  const planned = planConfigWrite(patch, current);
  if (!planned.ok) {
    return fail('STATE_CONFLICT', planned.message, { details: { conflicts: planned.conflicts } });
  }
  const { plan } = planned;
  const changed = Object.keys(plan.updates);
  if (changed.length === 0) return ok({ changed, unchanged: plan.unchanged });

  const audit: AuditInput = {
    admin,
    action: ACTION,
    entity: ENTITY,
    entity_id: plan.entityId,
    before: plan.before,
    after: plan.after,
    sensitivity: plan.sensitivity,
  };

  const updatedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('app_config')
    .upsert(changed.map((key) => ({ key, value: plan.updates[key], updated_at: updatedAt })), { onConflict: 'key' });
  if (error) {
    console.error('app config save failed:', error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', NOT_SAVED);
  }

  await clearPublicCache();

  const recorded = await writeAudit({ ...audit, result: 'success' });
  return ok({ changed, unchanged: plan.unchanged, ...auditFields(recorded.ok) });
}
