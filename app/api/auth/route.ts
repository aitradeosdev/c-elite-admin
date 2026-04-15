import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../lib/supabase';
import { signAdminJWT } from '../../lib/jwt';

export async function POST(req: NextRequest) {
  const { email, username, password } = await req.json();

  if (!email || !username || !password) {
    return NextResponse.json({ error: 'Email, username and password required' }, { status: 400 });
  }

  const { data: admin, error } = await supabaseAdmin
    .from('admin_users')
    .select('id, username, email, password_hash, role_title, is_super_admin, is_active, page_permissions')
    .eq('username', username)
    .eq('email', email)
    .eq('is_active', true)
    .single();

  if (error || !admin) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const passwordMatch = await bcrypt.compare(password, admin.password_hash);
  if (!passwordMatch) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // Update last login
  await supabaseAdmin
    .from('admin_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', admin.id);

  // Log to audit_log
  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.id,
    action: 'LOGIN',
    entity: 'admin_users',
    entity_id: admin.id,
    ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
  });

  const token = await signAdminJWT({
    admin_id: admin.id,
    role_title: admin.role_title,
    is_super_admin: admin.is_super_admin,
    page_permissions: admin.page_permissions || [],
    username: admin.username,
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8,
    path: '/',
  });

  return response;
}
