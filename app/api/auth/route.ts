import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../lib/supabase';
import { signAdminJWT } from '../../lib/jwt';

function getClientIp(req: NextRequest): string {
  return req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || (req.headers.get('x-forwarded-for') || '').split(',').pop()?.trim()
      || 'unknown';
}

export async function POST(req: NextRequest) {
  const { email, username, password } = await req.json();

  if (!email || !username || !password) {
    return NextResponse.json({ error: 'Email, username and password required' }, { status: 400 });
  }

  const ip = getClientIp(req);
  const { data: rlOk } = await supabaseAdmin.rpc('check_rate_limit_by_key', {
    p_key: ip,
    p_action: 'admin_login',
    p_limit: 20,
    p_window_secs: 600,
  });
  if (rlOk === false) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  const { data: admin, error } = await supabaseAdmin
    .from('admin_users')
    .select('id, username, email, password_hash, role_title, is_super_admin, is_active, page_permissions, theme_preference')
    .eq('username', username)
    .eq('email', email)
    .eq('is_active', true)
    .single();

  if (error || !admin) {
    await bcrypt.compare(password, '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012');
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const passwordMatch = await bcrypt.compare(password, admin.password_hash);
  if (!passwordMatch) {
    await supabaseAdmin.from('audit_log').insert({
      admin_id: admin.id,
      action: 'LOGIN_FAILED',
      entity: 'admin_users',
      entity_id: admin.id,
      ip_address: ip,
    });
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  await supabaseAdmin
    .from('admin_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', admin.id);

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.id,
    action: 'LOGIN',
    entity: 'admin_users',
    entity_id: admin.id,
    ip_address: ip,
  });

  const isMobile = req.headers.get('x-client') === 'mobile-admin';
  
  const token = await signAdminJWT({
    admin_id: admin.id,
    role_title: admin.role_title,
    is_super_admin: admin.is_super_admin,
    page_permissions: admin.page_permissions || [],
    username: admin.username,
  }, isMobile ? '30d' : '8h');

  const themePref: 'light' | 'dark' | 'system' =
    admin.theme_preference === 'light' || admin.theme_preference === 'dark' ? admin.theme_preference : 'system';

  if (isMobile) {

    return NextResponse.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role_title: admin.role_title,
        is_super_admin: admin.is_super_admin,
        page_permissions: admin.page_permissions || [],
        theme_preference: themePref,
      },
    });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 8,
    path: '/',
  });

  response.cookies.set('admin_theme', themePref, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });

  return response;
}
