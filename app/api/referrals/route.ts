import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('referral_management')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: rows, error } = await supabaseAdmin
    .from('referrals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = new Set<string>();
  (rows || []).forEach((r) => {
    if (r.referrer_id) userIds.add(r.referrer_id);
    if (r.referee_id) userIds.add(r.referee_id);
  });

  let userMap: Record<string, string> = {};
  if (userIds.size > 0) {
    const { data: users } = await supabaseAdmin
      .from('users').select('id, username').in('id', Array.from(userIds));
    (users || []).forEach((u) => { userMap[u.id] = u.username || '—'; });
  }

  const log = (rows || []).map((r) => ({
    id: r.id,
    referrer_username: userMap[r.referrer_id] || '—',
    referee_username: userMap[r.referee_id] || '—',
    created_at: r.created_at,
    first_trade_at: r.first_trade_at,
    first_trade_completed: r.first_trade_completed,
    referrer_bonus_amount: r.referrer_bonus_amount,
    referee_bonus_amount: r.referee_bonus_amount,
    referrer_credited: r.referrer_credited,
    referee_credited: r.referee_credited,
  }));

  const { data: statsRows } = await supabaseAdmin.rpc('admin_referrals_stats');
  const stats0 = Array.isArray(statsRows) ? statsRows[0] : statsRows;

  return NextResponse.json({
    log,
    stats: {
      total_referrals: Number(stats0?.total || 0),
      pending_payout: 0,
      total_paid_out: Number(stats0?.total_paid || 0),
    },
  });
}
