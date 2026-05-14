import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { redactAudit } from '../../lib/redact';

const ALLOWED_FEATURES = new Set(['tag_transfer']);

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const feature = new URL(req.url).searchParams.get('feature') || '';
  if (!ALLOWED_FEATURES.has(feature)) {
    return NextResponse.json({ error: 'Invalid feature' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('feature_overrides')
    .select('id, user_id, feature_key, enabled, granted_at, reason, users!feature_overrides_user_id_fkey(username, email, full_name), admin_users!feature_overrides_granted_by_fkey(username)')
    .eq('feature_key', feature)
    .order('granted_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const overrides = (data || []).map((r: any) => ({
    id: r.id,
    user_id: r.user_id,
    enabled: r.enabled,
    granted_at: r.granted_at,
    reason: r.reason,
    username: r.users?.username || '',
    email: r.users?.email || '',
    full_name: r.users?.full_name || '',
    granted_by_username: r.admin_users?.username || '',
  }));
  return NextResponse.json({ overrides });
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { user_id, feature_key, reason } = body || {};
  if (!user_id || typeof user_id !== 'string') {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }
  if (!ALLOWED_FEATURES.has(feature_key)) {
    return NextResponse.json({ error: 'Invalid feature' }, { status: 400 });
  }

  const { data: userRow } = await supabaseAdmin
    .from('users').select('id').eq('id', user_id).maybeSingle();
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data, error } = await supabaseAdmin
    .from('feature_overrides')
    .upsert({
      user_id,
      feature_key,
      enabled: true,
      granted_by: admin.admin_id,
      granted_at: new Date().toISOString(),
      reason: typeof reason === 'string' ? reason.slice(0, 500) : null,
    }, { onConflict: 'user_id,feature_key' })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id,
    action: 'GRANT_FEATURE_OVERRIDE',
    entity: 'feature_overrides',
    entity_id: data.id,
    after_value: redactAudit({ user_id, feature_key, reason }),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true, id: data.id });
}
