import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

async function getAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return null;
  return verifyAdminJWT(token);
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('email_templates')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabaseAdmin
    .from('email_templates')
    .select('key, subject, html, description, variables, is_active, updated_at')
    .order('key', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data || [] });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('email_templates')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { key, subject, html, is_active } = await req.json();
  if (!key || typeof key !== 'string') {
    return NextResponse.json({ error: 'key required' }, { status: 400 });
  }
  if (subject != null && !String(subject).trim()) {
    return NextResponse.json({ error: 'subject cannot be empty' }, { status: 400 });
  }
  if (html != null && !String(html).trim()) {
    return NextResponse.json({ error: 'html cannot be empty' }, { status: 400 });
  }

  const { data: before } = await supabaseAdmin
    .from('email_templates')
    .select('subject, html, is_active')
    .eq('key', key)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const patch: { updated_at: string; updated_by: string; subject?: string; html?: string; is_active?: boolean } = {
    updated_at: new Date().toISOString(),
    updated_by: admin.admin_id,
  };
  if (subject != null) patch.subject = String(subject);
  if (html != null) patch.html = String(html);
  if (is_active != null) patch.is_active = Boolean(is_active);

  const { error } = await supabaseAdmin
    .from('email_templates')
    .update(patch)
    .eq('key', key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id,
    action: 'UPDATE_EMAIL_TEMPLATE',
    entity: 'email_templates',
    entity_id: key,
    before_value: before,
    after_value: patch,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
