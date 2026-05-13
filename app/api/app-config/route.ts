import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

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

  const keys = Object.keys(changes);
  const { data: before } = await supabaseAdmin
    .from('app_config').select('key, value').in('key', keys);
  const beforeMap: Record<string, string> = {};
  (before || []).forEach((r) => { beforeMap[r.key] = r.value; });

  const rows = keys.map((key) => ({ key, value: String(changes[key]), updated_at: new Date().toISOString() }));
  const { error } = await supabaseAdmin
    .from('app_config')
    .upsert(rows, { onConflict: 'key' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'UPDATE_APP_CONFIG', entity: 'app_config',
    entity_id: 'batch', before_value: beforeMap, after_value: changes,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
