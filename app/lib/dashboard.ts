import { supabaseAdmin } from './supabase';
import type { AdminJWTPayload } from './jwt';

export type DashboardStats = Record<string, number>;

export function buildCan(admin: AdminJWTPayload | null): (key: string) => boolean {
  return (key: string): boolean =>
    !!admin && (admin.is_super_admin || (admin.page_permissions || []).includes(key));
}

export async function getDashboardStats(can: (k: string) => boolean): Promise<DashboardStats> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();
  const onlineISO = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const s: DashboardStats = {};
  const jobs: Promise<unknown>[] = [];
  const count = (key: string, q: any) =>
    jobs.push(q.then((r: any) => { s[key] = r?.count || 0; }).catch(() => {}));
  const sum = (key: string, q: any, col: string) =>
    jobs.push(q.then((r: any) => {
      s[key] = (r?.data || []).reduce((a: number, x: any) => a + Number(x[col] || 0), 0);
    }).catch(() => {}));

  if (can('card_queue')) {
    count('pendingCards', supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'));
    count('cardsToday', supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
  }
  if (can('withdrawals')) {
    sum('todayPayouts', supabaseAdmin.from('withdrawals').select('amount').eq('status', 'success').gte('created_at', todayISO), 'amount');
    count('pendingWithdrawals', supabaseAdmin.from('withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'initiated'));
  }
  if (can('transfers')) {
    count('transfersToday', supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
    sum('transferVolumeToday', supabaseAdmin.from('transfers').select('amount').eq('status', 'success').gte('created_at', todayISO), 'amount');
  }
  if (can('transactions_overview')) {
    count('txToday', supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
    sum('txVolumeToday', supabaseAdmin.from('transactions').select('amount').eq('status', 'success').gte('created_at', todayISO), 'amount');
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
    sum('rewardPool', supabaseAdmin.from('transactions').select('amount').eq('status', 'success').in('type', ['signup_bonus', 'newbie_bonus', 'giftbox_bonus', 'referral_bonus', 'level_bonus']).limit(100000), 'amount');
  }
  if (can('referral_management')) {
    count('referralsToday', supabaseAdmin.from('referrals').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
  }
  if (can('platform_balance')) {
    sum('walletTotal', supabaseAdmin.from('wallets').select('balance'), 'balance');
  }
  if (can('card_management')) {
    count('activeCards', supabaseAdmin.from('cards').select('id', { count: 'exact', head: true }).eq('is_active', true));
  }
  if (can('admin_accounts')) {
    count('totalAdmins', supabaseAdmin.from('admin_users').select('id', { count: 'exact', head: true }));
  }

  await Promise.all(jobs);
  return s;
}

export async function getRecentSubmissions() {
  const { data } = await supabaseAdmin
    .from('card_submissions')
    .select(`
      id, amount_foreign, payout_naira, status, created_at, card_id,
      users(username),
      cards(name),
      card_types(country_code)
    `)
    .order('created_at', { ascending: false })
    .limit(10);
  const rows = data || [];
  const cardIds = [...new Set(rows.map((r: any) => r.card_id).filter(Boolean))];
  let nameByKey: Record<string, string> = {};
  if (cardIds.length) {
    const { data: cc } = await supabaseAdmin
      .from('card_countries')
      .select('card_id, country_code, country_name')
      .in('card_id', cardIds);
    nameByKey = Object.fromEntries(
      (cc || []).map((c: any) => [`${c.card_id}|${c.country_code}`, c.country_name]),
    );
  }
  return rows.map((r: any) => ({
    ...r,
    country_name:
      nameByKey[`${r.card_id}|${r.card_types?.country_code}`] ||
      r.card_types?.country_code ||
      null,
  }));
}

export async function getDashboardData(admin: AdminJWTPayload | null) {
  const can = buildCan(admin);
  const [stats, recent_submissions] = await Promise.all([
    getDashboardStats(can),
    can('card_queue') ? getRecentSubmissions() : Promise.resolve([] as any[]),
  ]);
  return { stats, recent_submissions };
}
