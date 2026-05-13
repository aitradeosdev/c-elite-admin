import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../../../lib/jwt';
import { supabaseAdmin } from '../../../../lib/supabase';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin?.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;

  const { error } = await supabaseAdmin.rpc('terminate_user_sessions', {
    p_user_id: id,
    p_admin_id: admin.admin_id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id,
    action: 'TERMINATE_USER_SESSIONS',
    entity: 'users',
    entity_id: id,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
