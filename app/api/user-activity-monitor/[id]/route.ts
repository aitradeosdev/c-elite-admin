import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';

async function getAdmin() {
  return verifyAdminFromRequest();
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin?.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;

  const [user, sessions, txns, withdrawals, transfers] = await Promise.all([
    supabaseAdmin.from('users').select('id, username, full_name, email, phone, country, last_active_at, is_frozen, is_active, created_at').eq('id', id).maybeSingle(),
    supabaseAdmin.from('login_history').select('id, session_id, ip_address, device_model, os_version, app_version, device_fingerprint, created_at, ended_at').eq('user_id', id).order('created_at', { ascending: false }).limit(30),
    supabaseAdmin.from('transactions').select('id, type, amount, status, session_id, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(30),
    supabaseAdmin.from('withdrawals').select('id, amount, bank_name, account_name, status, session_id, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
    supabaseAdmin.from('transfers').select('id, type, amount, status, session_id, created_at').eq('sender_id', id).order('created_at', { ascending: false }).limit(20),
  ]);

  if (user.error) return NextResponse.json({ error: user.error.message }, { status: 500 });

  return NextResponse.json({
    user: user.data,
    sessions: sessions.data || [],
    transactions: txns.data || [],
    withdrawals: withdrawals.data || [],
    transfers: transfers.data || [],
  });
}
