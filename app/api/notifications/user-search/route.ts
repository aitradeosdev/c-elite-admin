import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdminAll } from '../../../lib/guard';
import { fail, ok } from '../../../lib/api';
import { sanitizeSearch } from '../../../lib/sanitize';
import {
  SEARCH_LIMIT, SEARCH_MIN, SEARCH_PERMISSIONS, SEARCH_RATE_LIMIT, SEARCH_RATE_WINDOW_SECONDS,
} from '../../../(dashboard)/notifications-broadcast/broadcastRules';

const USER_COLUMNS = 'id, full_name, username, email, is_active, deleted_at, push_notifications_enabled';

export async function GET(req: NextRequest) {
  const guard = await requireAdminAll(SEARCH_PERMISSIONS);
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const q = sanitizeSearch(new URL(req.url).searchParams.get('q') || '');
  if (q.length < SEARCH_MIN) return ok({ users: [] });

  const { data: allowed, error: limitError } = await supabaseAdmin.rpc('check_rate_limit_by_key', {
    p_key: `admin_user_search:${admin.admin_id}`,
    p_action: 'admin_user_search',
    p_limit: SEARCH_RATE_LIMIT,
    p_window_secs: SEARCH_RATE_WINDOW_SECONDS,
  });
  if (limitError) console.error('broadcast user search rate limit:', limitError.message);
  if (allowed === false) {
    return fail('RATE_LIMITED', 'Too many user searches in the last minute. Wait a moment, then try again.');
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select(USER_COLUMNS)
    .or(`username.ilike.%${q}%,email.ilike.%${q}%,full_name.ilike.%${q}%`)
    .order('username', { ascending: true, nullsFirst: false })
    .limit(SEARCH_LIMIT);
  if (error) {
    console.error('broadcast user search:', error.message);
    return fail('INTERNAL_ERROR', 'The user search failed. Try again.');
  }
  return ok({ users: data ?? [] });
}
