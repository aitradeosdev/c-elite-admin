import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireSuperAdmin } from '../../../lib/guard';
import { fail, isUuid, ok } from '../../../lib/api';
import {
  DEVICE_LIMIT,
  ONLINE_WINDOW_SECONDS,
  SESSION_LIMIT,
  TRANSACTION_LIMIT,
  WITHDRAWAL_LIMIT,
  isOnlineAt,
} from '../../../(dashboard)/user-activity-monitor/rules';

const USER_COLUMNS =
  'id, username, full_name, email, phone, country, last_active_at, is_frozen, freeze_reason, is_active, created_at, deleted_at';
const SESSION_COLUMNS =
  'id, session_id, ip_address, device_model, os_version, app_version, device_fingerprint, created_at, ended_at, ended_by';
const DEVICE_COLUMNS =
  'id, device_model, os_version, app_version, ip_address, is_new_device, last_seen_at, login_count, created_at';
const TRANSACTION_COLUMNS = 'id, type, amount, status, session_id, created_at';
const WITHDRAWAL_COLUMNS = 'id, amount, bank_name, account_name, status, session_id, created_at';

interface UserRow {
  id: string;
  last_active_at: string | null;
  [column: string]: unknown;
}

function problem(error: { message: string } | null, section: string, message: string): string | null {
  if (!error) return null;
  console.error(`user activity ${section}:`, error.message);
  return message;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fail('VALIDATION_ERROR', 'Invalid user id.');
  const userId = id.toLowerCase();

  const [user, sessions, openSessions, devices, transactions, withdrawals] = await Promise.all([
    supabaseAdmin.from('users').select(USER_COLUMNS).eq('id', userId).maybeSingle<UserRow>(),
    supabaseAdmin
      .from('login_history')
      .select(SESSION_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(SESSION_LIMIT),
    supabaseAdmin
      .from('login_history')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('ended_at', null),
    supabaseAdmin
      .from('device_logs')
      .select(DEVICE_COLUMNS)
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(DEVICE_LIMIT),
    supabaseAdmin
      .from('transactions')
      .select(TRANSACTION_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(TRANSACTION_LIMIT),
    supabaseAdmin
      .from('withdrawals')
      .select(WITHDRAWAL_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(WITHDRAWAL_LIMIT),
  ]);

  if (user.error) {
    console.error('user activity detail:', user.error.message);
    return fail('INTERNAL_ERROR', 'This user could not be loaded.');
  }

  const now = Date.now();
  const openSessionsProblem = problem(openSessions.error, 'open sessions', 'The open session count could not be loaded.');

  return ok({
    user: user.data ? { ...user.data, is_online: isOnlineAt(user.data.last_active_at, now) } : null,
    sessions: sessions.data ?? [],
    transactions: transactions.data ?? [],
    withdrawals: withdrawals.data ?? [],
    devices: devices.data ?? [],
    open_session_count: openSessionsProblem ? null : openSessions.count ?? 0,
    online_window_seconds: ONLINE_WINDOW_SECONDS,
    partial: {
      sessions: problem(sessions.error, 'sessions', 'Sessions could not be loaded.'),
      devices: problem(devices.error, 'devices', 'Devices could not be loaded.'),
      transactions: problem(transactions.error, 'transactions', 'Recent transactions could not be loaded.'),
      withdrawals: problem(withdrawals.error, 'withdrawals', 'Recent withdrawals could not be loaded.'),
      open_session_count: openSessionsProblem,
    },
  });
}
