import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { redactAudit } from '../../lib/redact';
import { validateConfigUrl } from '../../lib/configUrls';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const keys = url.searchParams.get('keys');

  let query = supabaseAdmin.from('app_config').select('key, value');
  if (keys) query = query.in('key', keys.split(','));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const map: Record<string, string> = {};
  (data || []).forEach((r) => { map[r.key] = r.value; });
  return NextResponse.json({ config: map });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { changes } = await req.json();
  if (!changes || typeof changes !== 'object' || Object.keys(changes).length === 0) {
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
  }

  const ALLOWED_KEYS = new Set<string>([
    'tag_transfer_enabled', 'bill_vtpass_enabled', 'gateway_paystack_enabled', 'gateway_monnify_enabled',
    'min_withdrawal_amount', 'max_withdrawal_amount', 'max_daily_withdrawal', 'withdraw_fee',
    'min_electricity_amount', 'electricity_quick_amounts',
    'transfer_bank_fee', 'transfer_bank_min', 'transfer_bank_max',
    'min_airtime_amount', 'max_airtime_amount',
    'min_data_amount', 'max_data_amount',
    'min_cable_amount', 'max_cable_amount',
    'signup_bonus_amount', 'signup_bonus_condition', 'signup_bonus_active',
    'newbie_bonus_amount', 'newbie_bonus_active',
    'referral_active', 'referral_bonus_amount', 'referral_min_trade_usd', 'referral_max_per_day',
    'level_bonus_active', 'levels_active',
    'pin_reset_freeze_hours',
    'large_withdrawal_flag_threshold',
    'signup_rate_limit_per_hour',
    'anomaly_dormant_days', 'anomaly_dormant_amount',
    'anomaly_rapid_window_mins', 'anomaly_rapid_ratio',
    'anomaly_failures_window_mins', 'anomaly_failures_threshold',
    'critical_alert_amount', 'alert_email_batch',
    'paystack_webhook_ips', 'monnify_webhook_ips',
    'terms_url', 'privacy_url', 'live_chat_url',
    'store_url_android', 'store_url_ios',
    'app_current_version', 'app_update_type', 'app_update_message',
    'emergency_mode', 'withdrawal_narrations',
    'iana_timezone',
  ]);
  const incoming = Object.keys(changes);
  const rejected = incoming.filter((k) => !ALLOWED_KEYS.has(k));
  if (rejected.length > 0) {
    return NextResponse.json({ error: `Unknown app_config keys: ${rejected.join(', ')}` }, { status: 400 });
  }
  for (const k of incoming) {
    const urlErr = validateConfigUrl(k, changes[k]);
    if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 });
  }
  const keys = incoming;
  const { data: before } = await supabaseAdmin
    .from('app_config').select('key, value').in('key', keys);
  const beforeMap: Record<string, string> = {};
  (before || []).forEach((r) => { beforeMap[r.key] = r.value; });

  const rows = keys.map((key) => ({ key, value: String(changes[key]), updated_at: new Date().toISOString() }));
  const { error } = await supabaseAdmin
    .from('app_config')
    .upsert(rows, { onConflict: 'key' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    await supabaseAdmin.rpc('edge_cache_delete', { p_key: 'app_config:public' });
  } catch {}

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'UPDATE_APP_CONFIG', entity: 'app_config',
    entity_id: 'batch', before_value: redactAudit(beforeMap), after_value: redactAudit(changes),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
