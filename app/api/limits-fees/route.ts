import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

const KEYS = [
  'min_withdrawal_amount',
  'max_withdrawal_amount',
  'max_daily_withdrawal',
  'transfer_tag_fee',
  'transfer_bank_fee',
  'large_withdrawal_flag_threshold',
];

const ALLOWED = new Set(KEYS);

async function getAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return null;
  return verifyAdminJWT(token);
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabaseAdmin.from('app_config').select('key, value').in('key', KEYS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const config: Record<string, string> = {};
  (data || []).forEach((r) => { config[r.key] = r.value; });
  return NextResponse.json({ config });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { changes } = await req.json();
  if (!changes || typeof changes !== 'object') {
    return NextResponse.json({ error: 'No changes' }, { status: 400 });
  }
  const keys = Object.keys(changes).filter((k) => ALLOWED.has(k));
  if (keys.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  for (const k of keys) {
    const n = Number(changes[k]);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `Invalid value for ${k}` }, { status: 400 });
    }
  }

  const rows = keys.map((k) => ({ key: k, value: String(changes[k]), updated_at: new Date().toISOString() }));
  const { error } = await supabaseAdmin.from('app_config').upsert(rows, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'UPDATE_LIMITS_FEES', entity: 'app_config',
    entity_id: 'batch', after_value: changes,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });
  return NextResponse.json({ success: true });
}
