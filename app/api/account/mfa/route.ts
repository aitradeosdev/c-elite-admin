import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/guard';
import { fail, ok } from '../../../lib/api';
import { NO_STORE, loadMfa } from '../../../lib/session';

const RESET_ACTIONS: readonly string[] = ['MFA_RESET', 'MFA_BREAK_GLASS_RESET'];
const LOAD_FAILED = 'Your two-step sign-in could not be loaded. Try again.';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function lastReset(adminId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('audit_log')
      .select('created_at')
      .eq('entity', 'admin_users')
      .eq('entity_id', adminId)
      .in('action', [...RESET_ACTIONS])
      .eq('result', 'success')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      console.error('admin two-step reset lookup failed:', error.message);
      return null;
    }
    const row: unknown = Array.isArray(data) ? data[0] : null;
    const at = row && typeof row === 'object' ? (row as Record<string, unknown>).created_at : null;
    return typeof at === 'string' && at !== '' ? at : null;
  } catch (error) {
    console.error('admin two-step reset lookup failed:', errorText(error));
    return null;
  }
}

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  const adminId = admin.admin_id.toLowerCase();

  const [mfa, resetAt] = await Promise.all([loadMfa(adminId), lastReset(adminId)]);
  if (!mfa) return fail('INTERNAL_ERROR', LOAD_FAILED);

  return ok({
    status: mfa.status,
    created_at: mfa.createdAt,
    confirmed_at: mfa.confirmedAt,
    last_used_at: mfa.lastUsedAt,
    locked_until: mfa.lockedUntil,
    recovery_codes_left: mfa.status === 'active' ? mfa.recoveryCodesLeft : 0,
    reset_at: resetAt,
    policy: {
      mfa_mode: admin.policy.mode,
      mfa_grace_ends_at: admin.policy.graceEndsAt,
      mfa_required_now: admin.policy.requiredNow,
    },
  }, { headers: { ...NO_STORE } });
}
