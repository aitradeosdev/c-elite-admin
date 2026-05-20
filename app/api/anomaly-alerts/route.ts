import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { redactAudit } from '../../lib/redact';

const KEYS = [
  'anomaly_dormant_days',
  'anomaly_dormant_amount',
  'anomaly_rapid_window_mins',
  'anomaly_rapid_ratio',
  'anomaly_failures_window_mins',
  'anomaly_failures_threshold',
  'alert_critical_amount',
  'alert_timezone',
  'security_alerts_batch_size',
];

const TEXT_KEYS = new Set(['alert_timezone']);
const ALLOWED = new Set(KEYS);

async function getAdmin() {
  return verifyAdminFromRequest();
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('anomaly_alerts')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabaseAdmin.from('app_config').select('key, value').in('key', KEYS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const config: Record<string, string> = {};
  (data || []).forEach((r) => { config[r.key] = r.value; });
  return NextResponse.json({ config });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('anomaly_alerts')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { changes } = await req.json();
  if (!changes || typeof changes !== 'object') {
    return NextResponse.json({ error: 'No changes' }, { status: 400 });
  }
  const keys = Object.keys(changes).filter((k) => ALLOWED.has(k));
  if (keys.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  for (const k of keys) {
    const v = changes[k];
    if (TEXT_KEYS.has(k)) {
      if (typeof v !== 'string' || v.length === 0 || v.length > 64) return NextResponse.json({ error: `Invalid value for ${k}` }, { status: 400 });
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: `Invalid value for ${k}` }, { status: 400 });
    }
  }

  const rows = keys.map((k) => ({ key: k, value: String(changes[k]), updated_at: new Date().toISOString() }));
  const { error } = await supabaseAdmin.from('app_config').upsert(rows, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    await supabaseAdmin.rpc('edge_cache_delete', { p_key: 'app_config:public' });
  } catch {}

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'UPDATE_ANOMALY_ALERTS', entity: 'app_config',
    entity_id: 'batch', after_value: redactAudit(changes),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });
  return NextResponse.json({ success: true });
}
