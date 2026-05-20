import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { redactAudit } from '../../lib/redact';

const KEYS = [
  'airtime_quick_amounts',
  'electricity_quick_amounts',
  'min_airtime_amount',
  'min_electricity_amount',
];

const CSV_KEYS = new Set(['airtime_quick_amounts', 'electricity_quick_amounts']);
const ALLOWED = new Set(KEYS);

async function getAdmin() {
  return verifyAdminFromRequest();
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('bill_settings')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabaseAdmin.from('app_config').select('key, value').in('key', KEYS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const config: Record<string, string> = {};
  (data || []).forEach((r) => { config[r.key] = r.value; });
  return NextResponse.json({ config });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('bill_settings')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { changes } = await req.json();
  if (!changes || typeof changes !== 'object') {
    return NextResponse.json({ error: 'No changes' }, { status: 400 });
  }
  const keys = Object.keys(changes).filter((k) => ALLOWED.has(k));
  if (keys.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  for (const k of keys) {
    const v = changes[k];
    if (CSV_KEYS.has(k)) {
      if (typeof v !== 'string') return NextResponse.json({ error: `Invalid value for ${k}` }, { status: 400 });
      const parts = String(v).split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) return NextResponse.json({ error: `${k} cannot be empty` }, { status: 400 });
      for (const p of parts) {
        const n = Number(p);
        if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: `Invalid number in ${k}: ${p}` }, { status: 400 });
      }
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
    admin_id: admin.admin_id, action: 'UPDATE_BILL_SETTINGS', entity: 'app_config',
    entity_id: 'batch', after_value: redactAudit(changes),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });
  return NextResponse.json({ success: true });
}
