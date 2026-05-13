import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

async function getAdmin() {
  return verifyAdminFromRequest();
}

async function log(adminId: string, action: string, entity: string, entityId: string, before: any, after: any, ip: string) {
  await supabaseAdmin.from('audit_log').insert({ admin_id: adminId, action, entity, entity_id: entityId, before_value: before, after_value: after, ip_address: ip });
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('card_type_builder')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const cardId = searchParams.get('card_id');
  const countryCode = searchParams.get('country_code');

  if (cardId && countryCode) {
    const { data: types } = await supabaseAdmin
      .from('card_types')
      .select('id, name, is_active, sort_order')
      .eq('card_id', cardId)
      .eq('country_code', countryCode)
      .order('sort_order', { ascending: true });

    const typesWithFields = await Promise.all((types || []).map(async (type) => {
      const { data: fields } = await supabaseAdmin
        .from('card_type_fields')
        .select('id, label, input_type, is_required, sort_order')
        .eq('card_type_id', type.id)
        .order('sort_order', { ascending: true });
      return { ...type, fields: fields || [] };
    }));

    return NextResponse.json({ types: typesWithFields });
  }

  return NextResponse.json({ error: 'card_id and country_code required' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('card_type_builder')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  if (body.type === 'card_type') {
    const { card_id, country_code, name, is_active } = body;
    const { data: existing } = await supabaseAdmin.from('card_types').select('sort_order').eq('card_id', card_id).eq('country_code', country_code).order('sort_order', { ascending: false }).limit(1);
    const sort_order = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
    const { data, error } = await supabaseAdmin.from('card_types').insert({ card_id, country_code, name, is_active: is_active ?? true, sort_order }).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await log(admin.admin_id, 'CREATE_CARD_TYPE', 'card_types', data.id, null, { card_id, country_code, name }, ip);
    return NextResponse.json({ success: true, id: data.id });
  }

  if (body.type === 'field') {
    const { card_type_id, label, input_type, is_required } = body;
    const { data: existing } = await supabaseAdmin.from('card_type_fields').select('sort_order').eq('card_type_id', card_type_id).order('sort_order', { ascending: false }).limit(1);
    const sort_order = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
    const { data, error } = await supabaseAdmin.from('card_type_fields').insert({ card_type_id, label, input_type, is_required: is_required ?? true, sort_order }).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await log(admin.admin_id, 'CREATE_FIELD', 'card_type_fields', data.id, null, { card_type_id, label, input_type, is_required }, ip);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('card_type_builder')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  if (body.type === 'card_type') {
    const { id } = body;
    const updates: any = {};
    if (body.name !== undefined) updates.name = String(body.name);
    if (body.is_active !== undefined) updates.is_active = !!body.is_active;
    if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order);
    const { data: before } = await supabaseAdmin.from('card_types').select('*').eq('id', id).single();
    await supabaseAdmin.from('card_types').update(updates).eq('id', id);
    await log(admin.admin_id, 'UPDATE_CARD_TYPE', 'card_types', id, before, updates, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'field') {
    const { id } = body;
    const updates: any = {};
    if (body.label !== undefined) updates.label = String(body.label);
    if (body.input_type !== undefined) updates.input_type = body.input_type;
    if (body.is_required !== undefined) updates.is_required = !!body.is_required;
    if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order);
    const { data: before } = await supabaseAdmin.from('card_type_fields').select('*').eq('id', id).single();
    await supabaseAdmin.from('card_type_fields').update(updates).eq('id', id);
    await log(admin.admin_id, 'UPDATE_FIELD', 'card_type_fields', id, before, updates, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'reorder_fields') {
    const { ids } = body;
    await Promise.all(ids.map((id: string, index: number) =>
      supabaseAdmin.from('card_type_fields').update({ sort_order: index }).eq('id', id)
    ));
    await log(admin.admin_id, 'REORDER_FIELDS', 'card_type_fields', 'batch', null, { ids }, ip);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('card_type_builder')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  if (body.type === 'card_type') {
    const { data: before } = await supabaseAdmin.from('card_types').select('*').eq('id', body.id).single();
    await supabaseAdmin.from('card_type_fields').delete().eq('card_type_id', body.id);
    await supabaseAdmin.from('card_types').delete().eq('id', body.id);
    await log(admin.admin_id, 'DELETE_CARD_TYPE', 'card_types', body.id, before, null, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'field') {
    const { data: before } = await supabaseAdmin.from('card_type_fields').select('*').eq('id', body.id).single();
    await supabaseAdmin.from('card_type_fields').delete().eq('id', body.id);
    await log(admin.admin_id, 'DELETE_FIELD', 'card_type_fields', body.id, before, null, ip);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}
