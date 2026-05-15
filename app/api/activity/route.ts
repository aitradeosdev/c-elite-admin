import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

function canAccessActivity(admin: { is_super_admin: boolean; page_permissions: string[] }): boolean {
  return admin.is_super_admin || (admin.page_permissions || []).includes('activity');
}

function csvCell(v: any): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows: any[]): string {
  const cols = [
    'created_at', 'admin_username', 'admin_role_title', 'admin_is_super',
    'action', 'entity', 'entity_id', 'target_username', 'target_label',
    'ip_address', 'before_value', 'after_value', 'id',
  ];
  const header = cols.join(',');
  const lines = rows.map((r) => cols.map((c) => csvCell(r[c])).join(','));
  return [header, ...lines].join('\n');
}

export async function GET(req: NextRequest) {
  const admin = await verifyAdminFromRequest();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessActivity(admin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const format = (url.searchParams.get('format') || 'json').toLowerCase();
  const isCsv = format === 'csv';
  const limit = isCsv
    ? Math.min(5000, Math.max(1, Number(url.searchParams.get('limit')) || 5000))
    : Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100));

  const beforeRaw = url.searchParams.get('before');
  const before = beforeRaw ? new Date(beforeRaw).toISOString() : null;
  const afterRaw = url.searchParams.get('after');
  const after  = afterRaw  ? new Date(afterRaw).toISOString()  : null;
  const adminFilterRaw = url.searchParams.get('admin_filter');
  const adminFilter = adminFilterRaw && adminFilterRaw !== 'all' ? adminFilterRaw : null;

  const [{ data: activity, error: actErr }, { data: admins, error: admErr }] = await Promise.all([
    supabaseAdmin.rpc('list_admin_activity', {
      p_caller_admin_id: admin.admin_id,
      p_limit: limit,
      p_before: before,
      p_admin_filter: adminFilter,
      p_after: after,
    }),
    isCsv
      ? Promise.resolve({ data: null, error: null })
      : supabaseAdmin
          .from('admin_users')
          .select('id, username, role_title, is_super_admin, is_active, last_login_at')
          .order('username', { ascending: true }),
  ]);

  if (actErr) return NextResponse.json({ error: actErr.message }, { status: 500 });
  if (admErr) return NextResponse.json({ error: admErr.message }, { status: 500 });

  if (isCsv) {
    const csv = toCsv(activity || []);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="admin-activity-${stamp}.csv"`,
      },
    });
  }

  return NextResponse.json({ activity: activity || [], admins: admins || [] });
}
