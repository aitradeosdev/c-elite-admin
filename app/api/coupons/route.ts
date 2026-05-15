import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { redactAudit } from '../../lib/redact';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('coupons')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
  if (!admin.is_super_admin && !admin.page_permissions.includes('coupons')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { code, min_trade_amount_usd, expiry_date, type, bonus_rate_naira, is_active, eligibility_rules, terms_of_use } = body;

  if (!code || !type) {
    return NextResponse.json({ error: 'Missing code or type' }, { status: 400 });
  }
  const minTradeVal = Number(min_trade_amount_usd || 0);
  const bonusVal = Number(bonus_rate_naira || 0);
  if (!Number.isFinite(minTradeVal) || minTradeVal < 0) return NextResponse.json({ error: 'Invalid min_trade_amount_usd' }, { status: 400 });
  if (!Number.isFinite(bonusVal) || bonusVal < 0) return NextResponse.json({ error: 'Invalid bonus_rate_naira' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('coupons')
    .insert({
      code: code.trim().toUpperCase(),
      min_trade_amount_usd: minTradeVal,
      expiry_date: expiry_date || null,
      type,
      bonus_rate_naira: bonusVal,
      is_active: is_active ?? true,
      eligibility_rules: Array.isArray(eligibility_rules) ? eligibility_rules : [],
      terms_of_use: terms_of_use || null,
    })
    .select('id').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'CREATE_COUPON', entity: 'coupons',
    entity_id: data.id, after_value: redactAudit(body),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true, id: data.id });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('coupons')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const updates: any = {};
  if (body.code !== undefined) updates.code = String(body.code).trim().toUpperCase();
  if (body.min_trade_amount_usd !== undefined) {
    const n = Number(body.min_trade_amount_usd);
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'Invalid min_trade_amount_usd' }, { status: 400 });
    updates.min_trade_amount_usd = n;
  }
  if (body.bonus_rate_naira !== undefined) {
    const n = Number(body.bonus_rate_naira);
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'Invalid bonus_rate_naira' }, { status: 400 });
    updates.bonus_rate_naira = n;
  }
  if (body.expiry_date !== undefined) updates.expiry_date = body.expiry_date || null;
  if (body.type !== undefined) updates.type = body.type;
  if (body.is_active !== undefined) updates.is_active = !!body.is_active;
  if (body.eligibility_rules !== undefined) updates.eligibility_rules = Array.isArray(body.eligibility_rules) ? body.eligibility_rules : [];
  if (body.terms_of_use !== undefined) updates.terms_of_use = body.terms_of_use || null;

  const { data: before } = await supabaseAdmin.from('coupons').select('*').eq('id', id).single();

  const { error } = await supabaseAdmin.from('coupons').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'UPDATE_COUPON', entity: 'coupons',
    entity_id: id, before_value: redactAudit(before), after_value: redactAudit(updates),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}

