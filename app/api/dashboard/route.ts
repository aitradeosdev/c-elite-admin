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

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const [
    { count: pendingCards },
    { data: todayPayouts },
    { count: totalUsers },
    { count: pendingWithdrawals },
    { count: cardsToday },
    { count: activeCoupons },
    { data: walletBalances },
    { count: referralsToday },
  ] = await Promise.all([
    supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('withdrawals').select('amount').eq('status', 'success').gte('created_at', todayISO).limit(10000),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('withdrawals').select('id', { count: 'exact', head: true }).in('status', ['pending_review', 'held', 'initiated']),
    supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).gte('created_at', todayISO),
    supabaseAdmin.from('coupons').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabaseAdmin.from('wallets').select('balance').limit(50000),
    supabaseAdmin.from('referrals').select('id', { count: 'exact', head: true }).gte('created_at', todayISO),
  ]);

  const todayPayoutsTotal = (todayPayouts || []).reduce((s: number, w: any) => s + Number(w.amount || 0), 0);
  const walletTotal = (walletBalances || []).reduce((s: number, w: any) => s + Number(w.balance || 0), 0);

  const { data: recentSubmissions } = await supabaseAdmin
    .from('card_submissions')
    .select('id, amount_foreign, payout_naira, status, created_at, users(username), cards(name)')
    .order('created_at', { ascending: false })
    .limit(10);

  return NextResponse.json({
    stats: {
      pendingCards: pendingCards || 0,
      todayPayouts: todayPayoutsTotal,
      totalUsers: totalUsers || 0,
      pendingWithdrawals: pendingWithdrawals || 0,
      cardsToday: cardsToday || 0,
      activeCoupons: activeCoupons || 0,
      walletTotal,
      referralsToday: referralsToday || 0,
    },
    recent_submissions: recentSubmissions || [],
  });
}
