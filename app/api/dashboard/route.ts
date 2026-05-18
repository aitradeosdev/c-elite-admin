import { NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !(admin.page_permissions || []).includes('dashboard')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const can = (key: string): boolean =>
    admin.is_super_admin || (admin.page_permissions || []).includes(key);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();
  const onlineISO = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const stats: Record<string, number> = {};
  const jobs: Promise<unknown>[] = [];
  const count = (k: string, q: any) =>
    jobs.push(q.then((r: any) => { stats[k] = r?.count || 0; }).catch(() => {}));
  const sum = (k: string, q: any, col: string) =>
    jobs.push(q.then((r: any) => {
      stats[k] = (r?.data || []).reduce((a: number, x: any) => a + Number(x[col] || 0), 0);
    }).catch(() => {}));

  if (can('card_queue')) {
    count('pendingCards', supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'));
    count('cardsToday', supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
  }
  if (can('withdrawals')) {
    sum('todayPayouts', supabaseAdmin.from('withdrawals').select('amount').eq('status', 'success').gte('created_at', todayISO).limit(10000), 'amount');
    count('pendingWithdrawals', supabaseAdmin.from('withdrawals').select('id', { count: 'exact', head: true }).in('status', ['pending_review', 'held', 'initiated']));
  }
  if (can('transfers')) {
    count('transfersToday', supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
    sum('transferVolumeToday', supabaseAdmin.from('transfers').select('amount').eq('status', 'success').gte('created_at', todayISO).limit(10000), 'amount');
  }
  if (can('transactions_overview')) {
    count('txToday', supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
    sum('txVolumeToday', supabaseAdmin.from('transactions').select('amount').eq('status', 'success').gte('created_at', todayISO).limit(10000), 'amount');
  }
  if (can('users')) {
    count('totalUsers', supabaseAdmin.from('users').select('id', { count: 'exact', head: true }));
    count('newUsersToday', supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
  }
  if (can('user_activity_monitor')) {
    count('onlineUsers', supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('last_active_at', onlineISO));
  }
  if (can('coupons')) {
    count('activeCoupons', supabaseAdmin.from('coupons').select('id', { count: 'exact', head: true }).eq('is_active', true));
  }
  if (can('bonuses_rewards')) {
    count('giftboxToday', supabaseAdmin.from('giftbox_claims').select('id', { count: 'exact', head: true }).gte('claimed_at', todayISO));
  }
  if (can('referral_management')) {
    count('referralsToday', supabaseAdmin.from('referrals').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
  }
  if (can('platform_balance')) {
    sum('walletTotal', supabaseAdmin.from('wallets').select('balance').limit(50000), 'balance');
  }
  if (can('card_management')) {
    count('activeCards', supabaseAdmin.from('cards').select('id', { count: 'exact', head: true }).eq('is_active', true));
  }
  if (can('admin_accounts')) {
    count('totalAdmins', supabaseAdmin.from('admin_users').select('id', { count: 'exact', head: true }));
  }

  await Promise.all(jobs);

  let recent_submissions: unknown[] = [];
  if (can('card_queue')) {
    const { data } = await supabaseAdmin
      .from('card_submissions')
      .select('id, amount_foreign, payout_naira, status, created_at, users(username), cards(name)')
      .order('created_at', { ascending: false })
      .limit(10);
    recent_submissions = data || [];
  }

  return NextResponse.json({ stats, recent_submissions });
}
