import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';

// PATCH /api/admin/theme — persist the calling admin's UI theme preference.
//
// Auth: any authenticated admin can change their OWN preference (no
// super-admin gate). Body: { theme: 'light' | 'dark' | 'system' }. The
// route also refreshes the admin_theme cookie so the next SSR render
// uses the new value immediately, eliminating a flash if the admin
// refreshes right after toggling.

const VALID = new Set(['light', 'dark', 'system']);

export async function PATCH(req: NextRequest) {
  const admin = await verifyAdminFromRequest();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { theme?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
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
