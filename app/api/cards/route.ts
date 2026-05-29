import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { redactAudit } from '../../lib/redact';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

async function logAction(adminId: string, action: string, entityId: string, before: any, after: any, ip: string) {
  await supabaseAdmin.from('audit_log').insert({
    admin_id: adminId,
    action,
    entity: 'cards',
    entity_id: entityId,
    before_value: redactAudit(before),
    after_value: redactAudit(after),
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
    const name = String(body.name || '').trim();
    if (!name || name.length > 80) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    const logo_url = body.logo_url == null ? null : String(body.logo_url);
    if (logo_url && (logo_url.length > 500 || !/^https:\/\//.test(logo_url))) {
      return NextResponse.json({ error: 'logo_url must be https and <=500 chars' }, { status: 400 });
    }
    const sort_order = Math.max(0, Math.min(10000, Number(body.sort_order ?? 0) || 0));
    const { data, error } = await supabaseAdmin
      .from('cards')
      .insert({ name, logo_url, is_active: body.is_active ?? true, sort_order })
      .select('id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAction(admin.admin_id, 'CREATE_CARD', data.id, null, { name, logo_url, is_active: body.is_active }, ip);
    return NextResponse.json({ success: true, id: data.id });
  }

  if (body.type === 'country') {
    const card_id = String(body.card_id || '');
    const country_code = String(body.country_code || '').toUpperCase();
    const country_name = String(body.country_name || '').trim();
    const currency_symbol = String(body.currency_symbol || '').trim();
    if (!/^[A-Z]{2,3}$/.test(country_code)) return NextResponse.json({ error: 'Invalid country_code' }, { status: 400 });
    if (!country_name || country_name.length > 80) return NextResponse.json({ error: 'Invalid country_name' }, { status: 400 });
    if (!currency_symbol || currency_symbol.length > 8) return NextResponse.json({ error: 'Invalid currency_symbol' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('card_countries')
      .insert({ card_id, country_code, country_name, currency_symbol, is_active: body.is_active ?? true })
      .select('id')
      .single();
    if (error) {
      if ((error as any).code === '23505') {
        return NextResponse.json({ error: 'This country is already on this card.' }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
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
    if (body.name !== undefined) {
      const n = String(body.name).trim();
      if (!n || n.length > 80) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
      updates.name = n;
    }
    if (body.logo_url !== undefined) {
      const u = body.logo_url == null ? null : String(body.logo_url);
      if (u && (u.length > 500 || !/^https:\/\//.test(u))) {
        return NextResponse.json({ error: 'logo_url must be https and <=500 chars' }, { status: 400 });
      }
      updates.logo_url = u;
    }
    if (body.is_active !== undefined) updates.is_active = !!body.is_active;
    if (body.sort_order !== undefined) {
      updates.sort_order = Math.max(0, Math.min(10000, Number(body.sort_order) || 0));
    }
    const { data: before } = await supabaseAdmin.from('cards').select('*').eq('id', id).single();
    const { error } = await supabaseAdmin.from('cards').update(updates).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAction(admin.admin_id, 'UPDATE_CARD', id, before, updates, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'country') {
    const { id } = body;
    const updates: any = {};
    if (body.country_code !== undefined) {
      const c = String(body.country_code).toUpperCase();
      if (!/^[A-Z]{2,3}$/.test(c)) return NextResponse.json({ error: 'Invalid country_code' }, { status: 400 });
      updates.country_code = c;
    }
    if (body.country_name !== undefined) {
      const n = String(body.country_name).trim();
      if (!n || n.length > 80) return NextResponse.json({ error: 'Invalid country_name' }, { status: 400 });
      updates.country_name = n;
    }
    if (body.currency_symbol !== undefined) {
      const s = String(body.currency_symbol).trim();
      if (!s || s.length > 8) return NextResponse.json({ error: 'Invalid currency_symbol' }, { status: 400 });
      updates.currency_symbol = s;
    }
    if (body.is_active !== undefined) updates.is_active = !!body.is_active;
    const { data: before } = await supabaseAdmin.from('card_countries').select('*').eq('id', id).single();
    const { error } = await supabaseAdmin.from('card_countries').update(updates).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAction(admin.admin_id, 'UPDATE_CARD_COUNTRY', id, before, updates, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'reorder') {
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 200) : [];
    if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 });
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
