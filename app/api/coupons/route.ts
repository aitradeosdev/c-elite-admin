import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

async function getAdmin(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return null;
  return verifyAdminJWT(token);
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('coupons')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ coupons: data || [] });
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { code, min_trade_amount_usd, expiry_date, type, bonus_rate_naira, is_active, eligibility_rules, terms_of_use } = body;

  if (!code || !type) {
    return NextResponse.json({ error: 'Missing code or type' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('coupons')
    .insert({
      code: code.trim().toUpperCase(),
      min_trade_amount_usd: Number(min_trade_amount_usd) || 0,
      expiry_date: expiry_date || null,
      type,
      bonus_rate_naira: Number(bonus_rate_naira) || 0,
      is_active: is_active ?? true,
      eligibility_rules: Array.isArray(eligibility_rules) ? eligibility_rules : [],
      terms_of_use: terms_of_use || null,
    })
    .select('id').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'CREATE_COUPON', entity: 'coupons',
    entity_id: data.id, after_value: body,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true, id: data.id });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  if (updates.code) updates.code = String(updates.code).trim().toUpperCase();

  const { data: before } = await supabaseAdmin.from('coupons').select('*').eq('id', id).single();

  const { error } = await supabaseAdmin.from('coupons').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'UPDATE_COUPON', entity: 'coupons',
    entity_id: id, before_value: before, after_value: updates,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
