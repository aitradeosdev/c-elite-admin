import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

const GATEWAYS = ['paystack', 'monnify'];

const KEYS = [
  ...GATEWAYS.map((g) => `gateway_${g}_enabled`),
  'active_payment_gateway',
  'bill_vtpass_enabled',
  'live_chat_url',
  'app_current_version',
  'app_minimum_version',
  'app_update_type',
  'app_update_message',
  'emergency_mode',
];

const ALLOWED_UPDATE = new Set(KEYS);

async function getAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return null;
  return verifyAdminJWT(token);
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabaseAdmin.from('app_config').select('key, value').in('key', KEYS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const config: Record<string, string> = {};
  (data || []).forEach((r) => { config[r.key] = r.value; });
  return NextResponse.json({ config });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { changes } = await req.json();
  if (!changes || typeof changes !== 'object') {
    return NextResponse.json({ error: 'No changes' }, { status: 400 });
  }
  const keys = Object.keys(changes).filter((k) => ALLOWED_UPDATE.has(k));
  if (keys.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  // Validate primary gateway is enabled
  if (changes.active_payment_gateway) {
    const primary = String(changes.active_payment_gateway);
    if (!GATEWAYS.includes(primary)) {
      return NextResponse.json({ error: 'Invalid primary gateway' }, { status: 400 });
    }
    const enabledKey = `gateway_${primary}_enabled`;
    const enabledVal = changes[enabledKey] ?? (await supabaseAdmin
      .from('app_config').select('value').eq('key', enabledKey).single()).data?.value;
    if (enabledVal !== 'true') {
      return NextResponse.json({ error: 'Primary gateway must be enabled' }, { status: 400 });
    }
  }

  const rows = keys.map((k) => ({
    key: k, value: String(changes[k]), updated_at: new Date().toISOString(),
  }));
  const { error } = await supabaseAdmin.from('app_config').upsert(rows, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'UPDATE_ADMIN_SETTINGS', entity: 'app_config',
    entity_id: 'batch', after_value: changes,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });
  return NextResponse.json({ success: true });
}
