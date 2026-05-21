import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeSearch } from '../../../lib/sanitize';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const q = sanitizeSearch(new URL(req.url).searchParams.get('q') || '');
  if (q.length < 3) return NextResponse.json({ users: [] });

  const { data: rlOk } = await supabaseAdmin.rpc('check_rate_limit_by_key', {
    p_key: `admin_user_search:${admin.admin_id}`,
    p_action: 'admin_user_search',
    p_limit: 60,
    p_window_secs: 60,
  });
  if (rlOk === false) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, full_name, username, email')
    .or(`username.ilike.%${q}%,email.ilike.%${q}%,full_name.ilike.%${q}%`)
    .is('deleted_at', null)
    .limit(10);
  if (error) return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  return NextResponse.json({ users: data || [] });
}
