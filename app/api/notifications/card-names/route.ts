import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';

async function getAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return null;
  return verifyAdminJWT(token);
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('notifications_broadcast')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from('cards')
    .select('name')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const names = Array.from(new Set((data || []).map((c) => c.name).filter(Boolean))) as string[];
  return NextResponse.json({ names });
}
