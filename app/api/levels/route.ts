import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

async function getAdmin() {
  return verifyAdminFromRequest();
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('bonuses_rewards')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: tiers, error } = await supabaseAdmin
    .from('level_tiers')
    .select('*')
    .order('tier_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: claims } = await supabaseAdmin
    .from('user_level_claims')
    .select('tier_order');

  const counts: Record<number, number> = {};
  (claims || []).forEach((c: any) => { counts[c.tier_order] = (counts[c.tier_order] || 0) + 1; });

  const withCounts = (tiers || []).map((t) => ({ ...t, claims: counts[t.tier_order] || 0 }));
  return NextResponse.json({ tiers: withCounts });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('bonuses_rewards')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const allowed: any = {};
  if (updates.name !== undefined) allowed.name = String(updates.name).trim();
  if (updates.target_usd !== undefined) allowed.target_usd = Number(updates.target_usd);
  if (updates.bonus_naira !== undefined) allowed.bonus_naira = Number(updates.bonus_naira);
  if (updates.badge_url !== undefined) allowed.badge_url = updates.badge_url || null;
  if (updates.is_active !== undefined) allowed.is_active = !!updates.is_active;
  allowed.updated_at = new Date().toISOString();

  const { data: before } = await supabaseAdmin.from('level_tiers').select('*').eq('id', id).single();

  const { error } = await supabaseAdmin.from('level_tiers').update(allowed).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'UPDATE_LEVEL_TIER', entity: 'level_tiers',
    entity_id: id, before_value: before, after_value: allowed,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
