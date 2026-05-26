import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { redactAudit } from '../../lib/redact';

async function getAdmin() {
  return verifyAdminFromRequest();
}

async function log(adminId: string, action: string, entity: string, entityId: string, before: any, after: any, ip: string) {
  await supabaseAdmin.from('audit_log').insert({ admin_id: adminId, action, entity, entity_id: entityId, before_value: redactAudit(before), after_value: redactAudit(after), ip_address: ip });
}

function canBuild(admin: any) {
  return admin.is_super_admin || admin.page_permissions.includes('card_type_builder');
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canBuild(admin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const cardId = searchParams.get('card_id');
  if (!cardId) return NextResponse.json({ error: 'card_id required' }, { status: 400 });

  const { data: templates } = await supabaseAdmin
    .from('card_type_templates')
    .select('id, name, is_active, sort_order')
    .eq('card_id', cardId)
    .order('sort_order', { ascending: true });

  const withDetail = await Promise.all((templates || []).map(async (tpl) => {
    const [{ data: fields }, { data: installs }] = await Promise.all([
      supabaseAdmin
        .from('card_type_template_fields')
        .select('id, label, input_type, is_required, sort_order')
        .eq('template_id', tpl.id)
        .order('sort_order', { ascending: true }),
      supabaseAdmin
        .from('card_types')
        .select('id, country_code, is_active')
        .eq('template_id', tpl.id),
    ]);
    return { ...tpl, fields: fields || [], countries: installs || [] };
  }));

  const { data: countries } = await supabaseAdmin
    .from('card_countries')
    .select('country_code, country_name, is_active')
    .eq('card_id', cardId)
    .eq('is_active', true)
    .order('country_name', { ascending: true });

  return NextResponse.json({ templates: withDetail, countries: countries || [] });
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canBuild(admin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  if (body.type === 'template') {
    const { card_id, name } = body;
    if (!card_id || !String(name || '').trim()) return NextResponse.json({ error: 'card_id and name required' }, { status: 400 });
    const { data: existing } = await supabaseAdmin.from('card_type_templates').select('sort_order').eq('card_id', card_id).order('sort_order', { ascending: false }).limit(1);
    const sort_order = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
    const { data, error } = await supabaseAdmin.from('card_type_templates').insert({ card_id, name: String(name).trim(), is_active: body.is_active ?? true, sort_order }).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await log(admin.admin_id, 'CREATE_CARD_TYPE_TEMPLATE', 'card_type_templates', data.id, null, { card_id, name }, ip);
    return NextResponse.json({ success: true, id: data.id });
  }

  if (body.type === 'field') {
    const { template_id, label, input_type, is_required } = body;
    if (!template_id || !String(label || '').trim()) return NextResponse.json({ error: 'template_id and label required' }, { status: 400 });
    const { data: existing } = await supabaseAdmin.from('card_type_template_fields').select('sort_order').eq('template_id', template_id).order('sort_order', { ascending: false }).limit(1);
    const sort_order = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
    const { data, error } = await supabaseAdmin.from('card_type_template_fields').insert({ template_id, label: String(label).trim(), input_type, is_required: is_required ?? true, sort_order }).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await log(admin.admin_id, 'CREATE_TEMPLATE_FIELD', 'card_type_template_fields', data.id, null, { template_id, label, input_type, is_required }, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'add_country') {
    const { template_id, country_code } = body;
    if (!template_id || !country_code) return NextResponse.json({ error: 'template_id and country_code required' }, { status: 400 });

    const { data: tpl } = await supabaseAdmin.from('card_type_templates').select('id, card_id, name, sort_order').eq('id', template_id).single();
    if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    const { data: existing } = await supabaseAdmin
      .from('card_types')
      .select('id, is_active')
      .eq('card_id', tpl.card_id)
      .eq('country_code', country_code)
      .eq('template_id', template_id)
      .maybeSingle();

    if (existing) {
      if (!existing.is_active) {
        await supabaseAdmin.from('card_types').update({ is_active: true }).eq('id', existing.id);
        await log(admin.admin_id, 'REACTIVATE_CARD_TYPE_COUNTRY', 'card_types', existing.id, null, { template_id, country_code }, ip);
      }
      return NextResponse.json({ success: true, id: existing.id, reactivated: !existing.is_active });
    }

    const { data: ct, error } = await supabaseAdmin
      .from('card_types')
      .insert({ card_id: tpl.card_id, country_code, name: tpl.name, template_id, is_active: true, sort_order: tpl.sort_order })
      .select('id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: tplFields } = await supabaseAdmin
      .from('card_type_template_fields')
      .select('label, input_type, is_required, sort_order')
      .eq('template_id', template_id)
      .order('sort_order', { ascending: true });
    if (tplFields && tplFields.length > 0) {
      await supabaseAdmin.from('card_type_fields').insert(tplFields.map((f) => ({ card_type_id: ct.id, ...f })));
    }

    await log(admin.admin_id, 'ADD_CARD_TYPE_TO_COUNTRY', 'card_types', ct.id, null, { template_id, country_code, name: tpl.name }, ip);
    return NextResponse.json({ success: true, id: ct.id });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canBuild(admin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  if (body.type === 'template') {
    const { id } = body;
    const updates: any = {};
    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.is_active !== undefined) updates.is_active = !!body.is_active;
    if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order);
    const { data: before } = await supabaseAdmin.from('card_type_templates').select('*').eq('id', id).single();
    await supabaseAdmin.from('card_type_templates').update(updates).eq('id', id);
    // keep the name of installed (cloned) per-country types in sync with the template
    if (updates.name !== undefined) {
      await supabaseAdmin.from('card_types').update({ name: updates.name }).eq('template_id', id);
    }
    await log(admin.admin_id, 'UPDATE_CARD_TYPE_TEMPLATE', 'card_type_templates', id, before, updates, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'field') {
    const { id } = body;
    const updates: any = {};
    if (body.label !== undefined) updates.label = String(body.label).trim();
    if (body.input_type !== undefined) updates.input_type = body.input_type;
    if (body.is_required !== undefined) updates.is_required = !!body.is_required;
    if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order);
    const { data: before } = await supabaseAdmin.from('card_type_template_fields').select('*').eq('id', id).single();
    await supabaseAdmin.from('card_type_template_fields').update(updates).eq('id', id);
    await log(admin.admin_id, 'UPDATE_TEMPLATE_FIELD', 'card_type_template_fields', id, before, updates, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'reorder_fields') {
    const { ids } = body;
    await Promise.all((ids || []).map((id: string, index: number) =>
      supabaseAdmin.from('card_type_template_fields').update({ sort_order: index }).eq('id', id)
    ));
    await log(admin.admin_id, 'REORDER_TEMPLATE_FIELDS', 'card_type_template_fields', 'batch', null, { ids }, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'country') {
    const { card_type_id, is_active } = body;
    if (!card_type_id) return NextResponse.json({ error: 'card_type_id required' }, { status: 400 });
    await supabaseAdmin.from('card_types').update({ is_active: !!is_active }).eq('id', card_type_id);
    await log(admin.admin_id, 'SET_CARD_TYPE_COUNTRY_ACTIVE', 'card_types', card_type_id, null, { is_active }, ip);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canBuild(admin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  if (body.type === 'template') {
    const { data: before } = await supabaseAdmin.from('card_type_templates').select('*').eq('id', body.id).single();
    // unlink the installed per-country types (keep them — they may have rates/submissions), then drop the template
    await supabaseAdmin.from('card_types').update({ template_id: null }).eq('template_id', body.id);
    await supabaseAdmin.from('card_type_template_fields').delete().eq('template_id', body.id);
    await supabaseAdmin.from('card_type_templates').delete().eq('id', body.id);
    await log(admin.admin_id, 'DELETE_CARD_TYPE_TEMPLATE', 'card_type_templates', body.id, before, null, ip);
    return NextResponse.json({ success: true });
  }

  if (body.type === 'field') {
    const { data: before } = await supabaseAdmin.from('card_type_template_fields').select('*').eq('id', body.id).single();
    await supabaseAdmin.from('card_type_template_fields').delete().eq('id', body.id);
    await log(admin.admin_id, 'DELETE_TEMPLATE_FIELD', 'card_type_template_fields', body.id, before, null, ip);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}
