import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';

async function getAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return null;
  return verifyAdminJWT(token);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin || !admin.page_permissions?.includes('users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, full_name, username, email, phone, country, is_active, is_frozen, freeze_reason, referral_code, created_at, wallets(balance)')
    .eq('id', id)
    .single();

  if (error || !user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const [txRes, wdRes, trRes] = await Promise.all([
    supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', id),
    supabaseAdmin.from('withdrawals').select('id', { count: 'exact', head: true }).eq('user_id', id),
    supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }).eq('sender_id', id),
  ]);

  const { data: devices } = await supabaseAdmin
    .from('device_logs')
    .select('device_model, os_version, app_version, ip_address, created_at')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(20);

  const { data: logins } = await supabaseAdmin
    .from('login_history')
    .select('device_model, os_version, app_version, ip_address, created_at')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(20);

  const { data: recentTx } = await supabaseAdmin
    .from('transactions')
    .select('id, type, amount, status, created_at, metadata')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(10);

  return NextResponse.json({
    user: {
      ...user,
      balance: user.wallets?.[0]?.balance ?? (user as any).wallets?.balance ?? 0,
    },
    stats: {
      trades: txRes.count || 0,
      withdrawals: wdRes.count || 0,
      transfers: trRes.count || 0,
    },
    devices: devices || [],
    logins: logins || [],
    recentTransactions: recentTx || [],
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin || !admin.page_permissions?.includes('users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { action, reason } = body;

  if (action === 'freeze') {
    if (!reason?.trim()) {
      return NextResponse.json({ error: 'Reason is required to freeze an account' }, { status: 400 });
    }

    const { data: before } = await supabaseAdmin
      .from('users')
      .select('is_frozen, freeze_reason')
      .eq('id', id)
      .single();

    await supabaseAdmin
      .from('users')
      .update({ is_frozen: true, freeze_reason: reason.trim() })
      .eq('id', id);

    await supabaseAdmin.from('audit_log').insert({
      admin_id: admin.admin_id,
      action: 'FREEZE_USER',
      entity: 'users',
      entity_id: id,
      before_value: before,
      after_value: { is_frozen: true, freeze_reason: reason.trim() },
      ip_address: req.headers.get('x-forwarded-for') || 'unknown',
    });

    return NextResponse.json({ success: true });
  }

  if (action === 'unfreeze') {
    const { data: before } = await supabaseAdmin
      .from('users')
      .select('is_frozen, freeze_reason')
      .eq('id', id)
      .single();

    await supabaseAdmin
      .from('users')
      .update({ is_frozen: false, freeze_reason: null })
      .eq('id', id);

    await supabaseAdmin.from('audit_log').insert({
      admin_id: admin.admin_id,
      action: 'UNFREEZE_USER',
      entity: 'users',
      entity_id: id,
      before_value: before,
      after_value: { is_frozen: false, freeze_reason: null },
      ip_address: req.headers.get('x-forwarded-for') || 'unknown',
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
