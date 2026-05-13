import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
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
    after_value: { username, email, role_title, page_permissions },
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin || !admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, username, email, password, role_title, page_permissions, is_active } = await req.json();
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  const { data: before } = await supabaseAdmin
    .from('admin_users')
    .select('email, role_title, page_permissions, is_active')
    .eq('id', id)
    .single();

  const updates: Record<string, any> = {};
  if (role_title !== undefined) updates.role_title = role_title;
  if (page_permissions !== undefined) updates.page_permissions = page_permissions;
  if (is_active !== undefined) updates.is_active = is_active;
  if (password) updates.password_hash = await bcrypt.hash(password, 12);
  if (email !== undefined) {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    updates.email = email || null;
  }

  const { error } = await supabaseAdmin.from('admin_users').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id,
    action: is_active !== undefined ? (is_active ? 'REACTIVATE_ADMIN' : 'DEACTIVATE_ADMIN') : 'EDIT_ADMIN',
    entity: 'admin_users',
    entity_id: id,
    before_value: before,
    after_value: updates,
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
    before_value: target,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
