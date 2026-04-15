import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

async function getAdmin(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return null;
  return verifyAdminJWT(token);
}

// GET — aggregate stats for the bonuses page
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const [levelToday, levelTiers, signupToday, signupTotal, anniversaryToday] = await Promise.all([
    supabaseAdmin.from('user_level_claims').select('id', { count: 'exact', head: true })
      .gte('claimed_at', todayIso),
    supabaseAdmin.from('level_tiers').select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true })
      .eq('type', 'signup_bonus').gte('created_at', todayIso),
    supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true })
      .eq('type', 'signup_bonus'),
    supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true })
      .eq('type', 'anniversary_bonus').gte('created_at', todayIso),
  ]);

  return NextResponse.json({
    stats: {
      level_claims_today: levelToday.count || 0,
      level_tier_count: levelTiers.count || 0,
      signup_awarded_today: signupToday.count || 0,
      signup_awarded_total: signupTotal.count || 0,
      anniversary_awarded_today: anniversaryToday.count || 0,
    },
  });
}
