import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin } from '../../lib/guard';
import { fail, ok } from '../../lib/api';
import { businessDayStart } from '../../lib/time';

interface CountResponse {
  count: number | null;
  error: { message: string } | null;
}

type StatKey = 'level_claims_today' | 'level_tier_count' | 'signup_awarded_today' | 'signup_awarded_total';

function counted(label: string, response: CountResponse): number | null {
  if (response.error) {
    console.error(`bonus stats ${label}:`, response.error.message);
    return null;
  }
  return response.count ?? 0;
}

export async function GET() {
  const guard = await requireAdmin('rewards.read');
  if (!guard.ok) return guard.response;

  const since = businessDayStart().toISOString();

  const [levelToday, levelTiers, signupToday, signupTotal] = await Promise.all([
    supabaseAdmin.from('user_level_claims').select('id', { count: 'exact', head: true })
      .gte('claimed_at', since),
    supabaseAdmin.from('level_tiers').select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true })
      .eq('type', 'signup_bonus').gte('created_at', since),
    supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true })
      .eq('type', 'signup_bonus'),
  ]);

  const values: Record<StatKey, number | null> = {
    level_claims_today: counted('level claims today', levelToday),
    level_tier_count: counted('active tiers', levelTiers),
    signup_awarded_today: counted('signup bonuses today', signupToday),
    signup_awarded_total: counted('signup bonuses total', signupTotal),
  };
  const unavailable = (Object.keys(values) as StatKey[]).filter((key) => values[key] === null);
  if (unavailable.length === Object.keys(values).length) {
    return fail('INTERNAL_ERROR', 'The reward figures could not be loaded. Try again.');
  }

  return ok({
    stats: {
      level_claims_today: values.level_claims_today ?? 0,
      level_tier_count: values.level_tier_count ?? 0,
      signup_awarded_today: values.signup_awarded_today ?? 0,
      signup_awarded_total: values.signup_awarded_total ?? 0,
    },
    unavailable,
    since,
  });
}
