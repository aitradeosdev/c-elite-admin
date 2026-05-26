import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
import { supabaseAdmin } from '../../lib/supabase';
import { signAdminJWT } from '../../lib/jwt';

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for') || '';
  const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || req.headers.get('x-real-ip') || 'unknown';
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

  const acctKey = `admin:${String(username || '').toLowerCase()}|${String(email || '').toLowerCase()}`;
  const { data: acctOk } = await supabaseAdmin.rpc('check_rate_limit_by_key', {
    p_key: acctKey,
    p_action: 'admin_login_account',
    p_limit: 10,
    p_window_secs: 1800,
  });
  if (acctOk === false) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  const { data: admin, error } = await supabaseAdmin
    .from('admin_users')
    .select('id, username, email, password_hash, role_title, is_super_admin, is_active, page_permissions, theme_preference, token_version')
    .eq('username', username)
    .eq('email', email)
    .eq('is_active', true)
    .single();

  if (error || !admin) {
    await bcrypt.compare(password, DUMMY_HASH);
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

    const since30m = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ count: fail30m }, { count: fail24h }] = await Promise.all([
      supabaseAdmin
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', admin.id)
        .eq('action', 'LOGIN_FAILED')
        .gte('created_at', since30m),
      supabaseAdmin
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', admin.id)
        .eq('action', 'LOGIN_FAILED')
        .gte('created_at', since24h),
    ]);
    if ((fail30m ?? 0) >= 5) {
      try {
        await supabaseAdmin.from('admin_alerts').insert({
          admin_id: admin.id,
          severity: 'high',
          event_type: 'admin_login_burst',
          subject: `Repeated failed admin logins for ${admin.email}`,
          detail: { admin_id: admin.id, email: admin.email, fail_count: fail30m, ip },
        });
      } catch {}
    }
    if ((fail24h ?? 0) >= 25) {
      await supabaseAdmin.from('admin_users').update({ is_active: false }).eq('id', admin.id);
      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.id,
        action: 'ADMIN_AUTO_DEACTIVATED',
        entity: 'admin_users',
        entity_id: admin.id,
        ip_address: ip,
      });
    }

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
    token_version: admin.token_version ?? 0,
  }, isMobile ? '24h' : '8h');

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
