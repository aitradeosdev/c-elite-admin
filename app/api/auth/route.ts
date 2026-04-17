import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../lib/supabase';
import { signAdminJWT } from '../../lib/jwt';

export async function POST(req: NextRequest) {
  const { email, username, password } = await req.json();

  if (!email || !username || !password) {
    return NextResponse.json({ error: 'Email, username and password required' }, { status: 400 });
  }

  // Phase 35d: rate-limit admin login per-IP (20 attempts / 10 min) via
  // the anon-keyed limiter (no user_id here — the caller isn't authed yet).
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
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
    .select('id, username, email, password_hash, role_title, is_super_admin, is_active, page_permissions')
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
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
    });
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
  // Phase 35d: sameSite=strict — `lax` already blocks cross-site POST in
  // modern browsers, but `strict` also blocks top-level GET navigations
  // carrying the cookie, closing the last residual CSRF edge case.
  response.cookies.set('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 8,
    path: '/',
  });

  return response;
}
