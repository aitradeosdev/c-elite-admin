import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { redactAudit } from '../../lib/redact';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

function validatePassword(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Password required';
  if (pw.length < 12) return 'Password must be at least 12 characters';
  if (pw.length > 128) return 'Password too long';
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter';
  if (!/[0-9]/.test(pw)) return 'Password must include a digit';
  if (!/[^a-zA-Z0-9]/.test(pw)) return 'Password must include a symbol';
  return null;
}

const ALLOWED_PERMISSIONS = new Set<string>([
  'dashboard', 'card_queue', 'card_management', 'card_type_builder', 'rates_management',
  'withdrawals', 'transfers', 'manual_wallet_credit', 'users', 'transactions_overview',
  'bonuses_rewards', 'referral_management', 'coupons', 'notifications_broadcast',
  'notification_templates', 'email_templates', 'platform_balance', 'admin_accounts',
  'user_activity_monitor', 'limits_fees', 'admin_settings', 'bill_settings',
  'anomaly_alerts', 'security_limits', 'activity', 'field_builder', 'feature_overrides',
  'flagged_transactions', 'giftbox', 'users_freeze',
]);

function validatePagePermissions(perms: unknown): string | null {
  if (perms === undefined || perms === null) return null;
  if (!Array.isArray(perms)) return 'page_permissions must be an array';
  if (perms.length > ALLOWED_PERMISSIONS.size) return 'too many permissions';
  for (const p of perms) {
    if (typeof p !== 'string' || !ALLOWED_PERMISSIONS.has(p)) {
      return `Unknown permission key: ${String(p).slice(0, 32)}`;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin || !admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('id, username, email, role_title, page_permissions, last_login_at, is_active, is_super_admin')
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ admins: data });
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin || !admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { username, email, password, role_title, page_permissions } = await req.json();

  if (!username || !password || !role_title || !email) {
    return NextResponse.json({ error: 'Username, email, password and role title are required' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }
  const pwErr = validatePassword(password);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });
  if (typeof username !== 'string' || username.length < 3 || username.length > 32) {
    return NextResponse.json({ error: 'Invalid username (3–32 chars)' }, { status: 400 });
  }
  if (typeof role_title !== 'string' || role_title.length < 2 || role_title.length > 64) {
    return NextResponse.json({ error: 'Invalid role title' }, { status: 400 });
  }
  const permErr = validatePagePermissions(page_permissions);
  if (permErr) return NextResponse.json({ error: permErr }, { status: 400 });

  const password_hash = await bcrypt.hash(password, 12);

  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .insert({ username, email, password_hash, role_title, page_permissions, is_super_admin: false, is_active: true })
    .select('id')
    .single();

  if (error) {
    if (error.message.includes('unique')) return NextResponse.json({ error: 'Username already taken' }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id,
    action: 'CREATE_ADMIN',
    entity: 'admin_users',
    entity_id: data.id,
    after_value: redactAudit({ username, email, role_title, page_permissions }),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin || !admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, email, password, role_title, page_permissions, is_active, revoke_sessions } = await req.json();
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  const { data: before } = await supabaseAdmin
    .from('admin_users')
    .select('email, role_title, page_permissions, is_active, is_super_admin')
    .eq('id', id)
    .single();

  if (is_active === false || revoke_sessions) {
    if (id === admin.admin_id) {
      return NextResponse.json({ error: 'You cannot deactivate or revoke your own session here. Sign out from your account instead.' }, { status: 400 });
    }
  }
  if (is_active === false && before?.is_super_admin) {
    const { count } = await supabaseAdmin
      .from('admin_users')
      .select('id', { count: 'exact', head: true })
      .eq('is_super_admin', true)
      .eq('is_active', true);
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'Cannot deactivate the last active super admin.' }, { status: 400 });
    }
  }

  const updates: Record<string, any> = {};
  if (role_title !== undefined) {
    if (typeof role_title !== 'string' || role_title.length < 2 || role_title.length > 64) {
      return NextResponse.json({ error: 'Invalid role title' }, { status: 400 });
    }
    updates.role_title = role_title;
  }
  if (page_permissions !== undefined) {
    const permErr = validatePagePermissions(page_permissions);
    if (permErr) return NextResponse.json({ error: permErr }, { status: 400 });
    updates.page_permissions = page_permissions;
  }
  if (is_active !== undefined) updates.is_active = is_active;
  if (password) {
    const pwErr = validatePassword(password);
    if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });
    updates.password_hash = await bcrypt.hash(password, 12);
  }
  if (email !== undefined) {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    updates.email = email || null;
  }

  const shouldBumpVersion =
    !!revoke_sessions ||
    !!password ||
    page_permissions !== undefined ||
    role_title !== undefined;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabaseAdmin.from('admin_users').update(updates).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (shouldBumpVersion) {
    const { data: current } = await supabaseAdmin
      .from('admin_users').select('token_version').eq('id', id).single();
    const next = ((current?.token_version as number) ?? 0) + 1;
    const { error: bumpErr } = await supabaseAdmin
      .from('admin_users').update({ token_version: next }).eq('id', id);
    if (bumpErr) return NextResponse.json({ error: bumpErr.message }, { status: 500 });
  }

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id,
    action: revoke_sessions
      ? 'REVOKE_ADMIN_SESSIONS'
      : is_active !== undefined
        ? (is_active ? 'REACTIVATE_ADMIN' : 'DEACTIVATE_ADMIN')
        : 'EDIT_ADMIN',
    entity: 'admin_users',
    entity_id: id,
    before_value: redactAudit(before),
    after_value: redactAudit({ ...updates, ...(shouldBumpVersion ? { token_version_bumped: true } : {}) }),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin || !admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  const { data: target } = await supabaseAdmin
    .from('admin_users')
    .select('username, is_active, is_super_admin')
    .eq('id', id)
    .single();

  if (target?.is_super_admin) return NextResponse.json({ error: 'Cannot delete super admin' }, { status: 400 });
  if (target?.is_active) return NextResponse.json({ error: 'Deactivate before deleting' }, { status: 400 });

  const { error } = await supabaseAdmin.from('admin_users').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id,
    action: 'DELETE_ADMIN',
    entity: 'admin_users',
    entity_id: id,
    before_value: redactAudit(target),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
