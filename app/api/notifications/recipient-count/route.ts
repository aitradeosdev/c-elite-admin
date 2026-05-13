import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('notifications_broadcast')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const audience = new URL(req.url).searchParams.get('audience') || 'all';
  if (audience === 'specific') return NextResponse.json({ count: 1 });

  const { data, error } = await supabaseAdmin.rpc('resolve_broadcast_audience', { p_audience: audience });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: (data || []).length });
}
