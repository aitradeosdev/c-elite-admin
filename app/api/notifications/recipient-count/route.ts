import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/guard';
import { fail, ok } from '../../../lib/api';
import { READ_PERMISSION, readAudienceParam } from '../../../(dashboard)/notifications-broadcast/broadcastRules';

const COUNT_FAILED = 'The recipients could not be counted. Try again.';

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(READ_PERMISSION);
  if (!guard.ok) return guard.response;

  const parsed = readAudienceParam(new URL(req.url).searchParams.get('audience'));
  if (!parsed.ok) return fail('VALIDATION_ERROR', parsed.message);
  const audience = parsed.value;

  if (audience === 'specific') {
    return ok({ count: 1, audience, accounts: 1, anonymous_devices: 0 });
  }

  const accounts = await supabaseAdmin.rpc('resolve_broadcast_audience', { p_audience: audience }, { count: 'exact' });
  if (accounts.error) {
    console.error('broadcast recipient count:', accounts.error.message);
    return fail('INTERNAL_ERROR', COUNT_FAILED);
  }
  const accountCount = typeof accounts.count === 'number'
    ? accounts.count
    : Array.isArray(accounts.data) ? accounts.data.length : 0;

  let anonymousCount = 0;
  if (audience === 'all_anon') {
    const anonymous = await supabaseAdmin
      .from('user_push_tokens')
      .select('token', { count: 'exact', head: true })
      .is('user_id', null);
    if (anonymous.error) {
      console.error('broadcast app-only device count:', anonymous.error.message);
      return fail('INTERNAL_ERROR', COUNT_FAILED);
    }
    anonymousCount = anonymous.count ?? 0;
  }

  return ok({
    count: accountCount + anonymousCount,
    audience,
    accounts: accountCount,
    anonymous_devices: anonymousCount,
  });
}
