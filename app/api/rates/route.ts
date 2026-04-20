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
  if (!admin.is_super_admin && !admin.page_permissions.includes('rates_management')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: cards } = await supabaseAdmin
    .from('cards')
    .select('id, name, logo_url, is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  const result = await Promise.all((cards || []).map(async (card) => {
    const { data: countries } = await supabaseAdmin
      .from('card_countries')
      .select('id, country_code, country_name, currency_symbol')
      .eq('card_id', card.id)
      .eq('is_active', true);

    const countriesWithTypes = await Promise.all((countries || []).map(async (country) => {
      const { data: types } = await supabaseAdmin
        .from('card_types')
        .select('id, name')
        .eq('card_id', card.id)
        .eq('country_code', country.country_code)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      const typesWithDenoms = await Promise.all((types || []).map(async (type) => {
        const { data: denoms } = await supabaseAdmin
          .from('denominations')
          .select('id, range_label, min_value, max_value, rate_naira, is_active')
          .eq('card_type_id', type.id)
          .order('min_value', { ascending: true });
        return { ...type, denominations: denoms || [] };
      }));

      return { ...country, card_types: typesWithDenoms };
    }));

    const activeRates = countriesWithTypes.reduce((sum, c) =>
      sum + c.card_types.reduce((s, t) =>
        s + t.denominations.filter((d) => d.is_active).length, 0), 0);

    return { ...card, countries: countriesWithTypes, activeRates };
  }));

  return NextResponse.json({ cards: result });
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('rates_management')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { card_type_id, range_label, min_value, max_value, rate_naira, is_active } = await req.json();

  const minVal = Number(min_value);
  const maxVal = Number(max_value);
  const rateVal = Number(rate_naira);
  if (!Number.isFinite(minVal) || minVal < 0) return NextResponse.json({ error: 'Invalid min_value' }, { status: 400 });
  if (!Number.isFinite(maxVal) || maxVal < 0) return NextResponse.json({ error: 'Invalid max_value' }, { status: 400 });
  if (!Number.isFinite(rateVal) || rateVal < 0) return NextResponse.json({ error: 'Invalid rate_naira' }, { status: 400 });
  if (minVal > maxVal) return NextResponse.json({ error: 'min_value cannot exceed max_value' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('denominations')
    .insert({ card_type_id, range_label, min_value: minVal, max_value: maxVal, rate_naira: rateVal, is_active: is_active ?? true })
    .select('id').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'CREATE_DENOMINATION', entity: 'denominations',
    entity_id: data.id, after_value: { card_type_id, range_label, min_value, max_value, rate_naira },
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('rates_management')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { changes } = await req.json();
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  if (!Array.isArray(changes) || changes.length === 0) {
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
  }

  const beforeSnapshots: Record<string, any> = {};
  for (const change of changes) {
    const { data } = await supabaseAdmin.from('denominations').select('*').eq('id', change.id).single();
    beforeSnapshots[change.id] = data;
  }

  for (const change of changes) {
    const r = Number(change.rate_naira);
    if (!Number.isFinite(r) || r < 0) return NextResponse.json({ error: `Invalid rate_naira for id ${change.id}` }, { status: 400 });
  }

  const results = await Promise.all(changes.map(({ id, rate_naira, is_active }: { id: string; rate_naira: number; is_active: boolean }) =>
    supabaseAdmin.from('denominations').update({ rate_naira: Number(rate_naira), is_active }).eq('id', id)
  ));

  const hasError = results.some((r) => r.error);
  if (hasError) return NextResponse.json({ error: 'Some updates failed' }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'BATCH_UPDATE_RATES', entity: 'denominations',
    entity_id: 'batch', before_value: beforeSnapshots,
    after_value: changes,
    ip_address: ip,
  });

  return NextResponse.json({ success: true });
}
