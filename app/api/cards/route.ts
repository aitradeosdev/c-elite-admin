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

async function logAction(adminId: string, action: string, entityId: string, before: any, after: any, ip: string) {
  await supabaseAdmin.from('audit_log').insert({
    admin_id: adminId,
    action,
    entity: 'cards',
    entity_id: entityId,
    before_value: before,
    after_value: after,
    ip_address: ip,
  });
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('card_management')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: cards, error } = await supabaseAdmin
    .from('cards')
    .select('id, name, logo_url, is_active, sort_order, created_at')
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const cardsWithCountries = await Promise.all((cards || []).map(async (card) => {
    const { data: countries } = await supabaseAdmin
      .from('card_countries')
      .select('id, country_code, country_name, currency_symbol, is_active')
      .eq('card_id', card.id);
    return { ...card, countries: countries || [] };
  }));

  return NextResponse.json({ cards: cardsWithCountries });
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('card_management')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  if (body.type === 'card') {
    const { name, logo_url, is_active, sort_order } = body;
    const { data, error } = await supabaseAdmin
      .from('cards')
      .insert({ name, logo_url, is_active: is_active ?? true, sort_order: sort_order ?? 0 })
      .select('id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAction(admin.admin_id, 'CREATE_CARD', data.id, null, { name, logo_url, is_active }, ip);
    return NextResponse.json({ success: true, id: data.id });
  }

  if (body.type === 'country') {
    const { card_id, country_code, country_name, currency_symbol, is_active } = body;
    const { data, error } = await supabaseAdmin
      .from('card_countries')
      .insert({ card_id, country_code, country_name, currency_symbol, is_active: is_active ?? true })
      .select('id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAction(admin.admin_id, 'ADD_CARD_COUNTRY', data.id, null, { card_id, country_code, country_name, currency_symbol }, ip);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('card_management')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  if (body.type === 'card') {
    const { id } = body;
    const updates: any = {};
    if (body.name !== undefined) updates.name = String(body.name);
    if (body.logo_url !== undefined) updates.logo_url = body.logo_url;
    if (body.is_active !== undefined) updates.is_active = !!body.is_active;
    if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order);
    const { data: before } = await supabaseAdmin.from('cards').select('*').eq('id', id).single();
    const { error } = await supabaseAdmin.from('cards').update(updates).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAction(admin.admin_id, 'UPDATE_CARD', id, before, updates, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'country') {
    const { id } = body;
    const updates: any = {};
    if (body.country_code !== undefined) updates.country_code = body.country_code;
    if (body.country_name !== undefined) updates.country_name = body.country_name;
    if (body.currency_symbol !== undefined) updates.currency_symbol = body.currency_symbol;
    if (body.is_active !== undefined) updates.is_active = !!body.is_active;
    const { data: before } = await supabaseAdmin.from('card_countries').select('*').eq('id', id).single();
    const { error } = await supabaseAdmin.from('card_countries').update(updates).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAction(admin.admin_id, 'UPDATE_CARD_COUNTRY', id, before, updates, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'reorder') {
    const { ids } = body;
    await Promise.all(ids.map((id: string, index: number) =>
      supabaseAdmin.from('cards').update({ sort_order: index }).eq('id', id)
    ));
    await logAction(admin.admin_id, 'REORDER_CARDS', 'batch', null, { ids }, ip);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('card_management')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, type } = await req.json();
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  if (type === 'country') {
    const { data: before } = await supabaseAdmin.from('card_countries').select('*').eq('id', id).single();
    const { error } = await supabaseAdmin.from('card_countries').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAction(admin.admin_id, 'REMOVE_CARD_COUNTRY', id, before, null, ip);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}
