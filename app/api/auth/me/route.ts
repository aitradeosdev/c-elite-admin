import { NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';

export async function GET() {
  const admin = await verifyAdminFromRequest();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Refresh from DB so permission changes propagate without re-login.
  const { data: row } = await supabaseAdmin
    .from('admin_users')
    .select('id, username, email, role_title, is_super_admin, is_active, page_permissions')
    .eq('id', admin.admin_id)
    .maybeSingle();
  if (!row || !row.is_active) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    admin: {
      id: row.id,
      username: row.username,
      email: row.email,
      role_title: row.role_title,
      is_super_admin: row.is_super_admin,
      page_permissions: row.page_permissions || [],
    },
  });
}
