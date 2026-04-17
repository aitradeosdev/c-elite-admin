import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { sanitizeSearch, clampPagination } from '../../lib/sanitize';

async function getAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return null;
  return verifyAdminJWT(token);
}

const ONLINE_WINDOW_SECS = 90;

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin?.is_super_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const onlyOnline = searchParams.get('online') === '1';
  const search = sanitizeSearch(searchParams.get('search') || '');
  const { page, limit, offset } = clampPagination(searchParams.get('page'), searchParams.get('limit'));

  const onlineCutoff = new Date(Date.now() - ONLINE_WINDOW_SECS * 1000).toISOString();

  let query = supabaseAdmin
    .from('users')
    .select('id, username, full_name, email, phone, last_active_at, is_frozen, is_active, created_at', { count: 'exact' });

  if (onlyOnline) query = query.gte('last_active_at', onlineCutoff);
  if (search) {
    query = query.or(`username.ilike.%${search}%,full_name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data, error, count } = await query
    .order('last_active_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count: onlineCount } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .gte('last_active_at', onlineCutoff);

  const rows = (data || []).map((u: any) => ({
    ...u,
    is_online: u.last_active_at && new Date(u.last_active_at).getTime() > Date.now() - ONLINE_WINDOW_SECS * 1000,
  }));

  return NextResponse.json({
    users: rows,
    total: count || 0,
    online_count: onlineCount || 0,
    page,
    limit,
  });
}
