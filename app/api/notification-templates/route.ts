import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

async function getAdmin() {
  return verifyAdminFromRequest();
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('notification_templates')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabaseAdmin
    .from('notification_templates')
    .select('key, title, body, description, variables, is_active, updated_at')
    .order('key', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data || [] });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('notification_templates')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { key, title, body, is_active } = await req.json();
  if (!key || typeof key !== 'string') {
    return NextResponse.json({ error: 'key required' }, { status: 400 });
  }
  if (title != null && !String(title).trim()) {
    return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
  }
  if (body != null && !String(body).trim()) {
    return NextResponse.json({ error: 'body cannot be empty' }, { status: 400 });
  }

  const { data: before } = await supabaseAdmin
    .from('notification_templates')
    .select('title, body, is_active')
    .eq('key', key)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const patch: any = { updated_at: new Date().toISOString(), updated_by: admin.admin_id };
  if (title != null) patch.title = String(title);
  if (body != null) patch.body = String(body);
  if (is_active != null) patch.is_active = Boolean(is_active);

  const { error } = await supabaseAdmin
    .from('notification_templates')
    .update(patch)
    .eq('key', key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id,
    action: 'UPDATE_NOTIFICATION_TEMPLATE',
    entity: 'notification_templates',
    entity_id: key,
    before_value: before,
    after_value: patch,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
