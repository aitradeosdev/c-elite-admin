import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

const KEYS = [
  'platform_balance_mode',
  'platform_balance_static',
  'platform_balance_live',
  'platform_balance_live_at',
  'platform_balance_live_error',
  'active_payment_gateway',
];

async function getAdmin() {
  return verifyAdminFromRequest();
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('platform_balance')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { data, error } = await supabaseAdmin.from('app_config').select('key, value').in('key', KEYS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const config: Record<string, string> = {};
  (data || []).forEach((r) => { config[r.key] = r.value; });
  return NextResponse.json({ config });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('platform_balance')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { changes } = await req.json();
  if (!changes || typeof changes !== 'object') {
    return NextResponse.json({ error: 'No changes' }, { status: 400 });
  }
  const allowed = ['platform_balance_mode', 'platform_balance_static'];
  const keys = Object.keys(changes).filter((k) => allowed.includes(k));
  if (keys.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  const rows = keys.map((k) => ({ key: k, value: String(changes[k]), updated_at: new Date().toISOString() }));
  const { error } = await supabaseAdmin.from('app_config').upsert(rows, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'UPDATE_PLATFORM_BALANCE', entity: 'app_config',
    entity_id: 'batch', after_value: changes,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });
  return NextResponse.json({ success: true });
}
