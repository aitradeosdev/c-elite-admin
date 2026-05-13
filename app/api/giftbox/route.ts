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
  if (!admin.is_super_admin && !admin.page_permissions.includes('bonuses_rewards')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: items, error } = await supabaseAdmin
    .from('giftbox_items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (items || []).map((i) => i.id);
  const claimCounts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: claims } = await supabaseAdmin
      .from('giftbox_claims').select('item_id').in('item_id', ids);
    (claims || []).forEach((c) => {
      claimCounts[c.item_id] = (claimCounts[c.item_id] || 0) + 1;
    });
  }

  const withCounts = (items || []).map((i) => ({ ...i, claims: claimCounts[i.id] || 0 }));
  return NextResponse.json({ items: withCounts });
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('bonuses_rewards')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { title, description, reward_naira, expiry_date, eligibility_condition, eligibility_rules, is_active } = body;

  if (!title || reward_naira === undefined || reward_naira === null) {
    return NextResponse.json({ error: 'Missing title or reward' }, { status: 400 });
  }
  const rewardVal = Number(reward_naira);
  if (!Number.isFinite(rewardVal) || rewardVal < 0) {
    return NextResponse.json({ error: 'Invalid reward_naira' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('giftbox_items')
    .insert({
      title,
      description: description || null,
      reward_naira: rewardVal,
      expiry_date: expiry_date || null,
      eligibility_condition: eligibility_condition || null,
      eligibility_rules: Array.isArray(eligibility_rules) ? eligibility_rules : [],
      is_active: is_active ?? true,
    })
    .select('id').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'CREATE_GIFTBOX_ITEM', entity: 'giftbox_items',
    entity_id: data.id, after_value: body,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true, id: data.id });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('bonuses_rewards')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const updates: any = {};
  if (body.title !== undefined) updates.title = String(body.title);
  if (body.description !== undefined) updates.description = body.description || null;
  if (body.reward_naira !== undefined) {
    const n = Number(body.reward_naira);
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'Invalid reward_naira' }, { status: 400 });
    updates.reward_naira = n;
  }
  if (body.expiry_date !== undefined) updates.expiry_date = body.expiry_date || null;
  if (body.eligibility_condition !== undefined) updates.eligibility_condition = body.eligibility_condition || null;
  if (body.eligibility_rules !== undefined) updates.eligibility_rules = Array.isArray(body.eligibility_rules) ? body.eligibility_rules : [];
  if (body.is_active !== undefined) updates.is_active = !!body.is_active;

  const { data: before } = await supabaseAdmin.from('giftbox_items').select('*').eq('id', id).single();

  const { error } = await supabaseAdmin
    .from('giftbox_items')
    .update(updates)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'UPDATE_GIFTBOX_ITEM', entity: 'giftbox_items',
    entity_id: id, before_value: before, after_value: updates,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
