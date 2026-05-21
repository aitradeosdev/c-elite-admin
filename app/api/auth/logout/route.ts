import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (token) {
    const admin = await verifyAdminJWT(token);
    if (admin) {
      try {
        const { data: cur } = await supabaseAdmin
          .from('admin_users').select('token_version').eq('id', admin.admin_id).single();
        const next = ((cur?.token_version as number) ?? 0) + 1;
        await supabaseAdmin.from('admin_users').update({ token_version: next }).eq('id', admin.admin_id);
      } catch {}
      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.admin_id,
        action: 'LOGOUT',
        entity: 'admin_users',
        entity_id: admin.admin_id,
        ip_address: req.headers.get('x-forwarded-for') || 'unknown',
      });
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0),
    path: '/',
  });
  response.cookies.set('admin_theme', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(0),
    path: '/',
  });
  return response;
}
