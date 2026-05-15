import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

function canAccessActivity(admin: { is_super_admin: boolean; page_permissions: string[] }): boolean {
  return admin.is_super_admin || (admin.page_permissions || []).includes('activity');
}

export async function GET(req: NextRequest) {
  const admin = await verifyAdminFromRequest();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessActivity(admin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100));
  const beforeRaw = url.searchParams.get('before');
  const before = beforeRaw ? new Date(beforeRaw).toISOString() : null;
  const adminFilterRaw = url.searchParams.get('admin_filter');
  const adminFilter = adminFilterRaw && adminFilterRaw !== 'all' ? adminFilterRaw : null;

  const [{ data: activity, error: actErr }, { data: admins, error: admErr }] = await Promise.all([
    supabaseAdmin.rpc('list_admin_activity', {
      p_caller_admin_id: admin.admin_id,
      p_limit: limit,
      p_before: before,
      p_admin_filter: adminFilter,
    }),
    supabaseAdmin
      .from('admin_users')
      .select('id, username, role_title, is_super_admin, is_active, last_login_at')
      .order('username', { ascending: true }),
  ]);

  if (actErr) return NextResponse.json({ error: actErr.message }, { status: 500 });
  if (admErr) return NextResponse.json({ error: admErr.message }, { status: 500 });

  return NextResponse.json({ activity: activity || [], admins: admins || [] });
}
