import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';

const VALID = new Set(['light', 'dark', 'system']);

export async function PATCH(req: NextRequest) {
  const admin = await verifyAdminFromRequest();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { theme?: string } = {};
  try { body = await req.json(); } catch {  }
  const theme = String(body.theme || '');
  if (!VALID.has(theme)) {
    return NextResponse.json({ error: 'theme must be light | dark | system' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('admin_users')
    .update({ theme_preference: theme })
    .eq('id', admin.admin_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const response = NextResponse.json({ success: true, theme });
  response.cookies.set('admin_theme', theme, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
  return response;
}
