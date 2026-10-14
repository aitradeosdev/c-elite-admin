import type { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../../lib/guard';
import { writeAudit } from '../../../lib/audit';
import { fail, ok } from '../../../lib/api';
import { matchTotp, openSecret } from '../../../lib/mfa';
import {
  REAUTH_MAX_AGE_SECONDS,
  checkLimit,
  loadMfa,
  refuseLocked,
  settleTotpCode,
  twoStepLocked,
  twoStepUnavailable,
  type MfaRecord,
} from '../../../lib/session';

const ENTITY = 'admin_users';
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_SECS = 15 * 60;
const CODE_PATTERN = /^[0-9]{6}$/;

const MISSING_BODY = 'Send your password or the code from your authenticator app.';
const TOO_MANY_ATTEMPTS = 'Too many identity checks. Wait 15 minutes, then try again.';
const CHECK_UNAVAILABLE = 'Your identity cannot be checked right now. Try again in a few minutes.';
const ENTER_CODE = 'Enter the code from your authenticator app.';
const ENTER_SIX_DIGITS = 'Enter the 6-digit code from your authenticator app.';
const CODE_DID_NOT_WORK = 'That code did not work. Enter the newest code from your authenticator app.';
const CODE_ALREADY_USED = 'That code was already used. Wait for the next one.';
const ENTER_PASSWORD = 'Enter your password.';
const PASSWORD_INCORRECT = 'Your password is incorrect.';
const PASSWORD_MISMATCH = 'Password did not match.';
const TWO_STEP_CHANGED = 'Your two-step sign-in changed. Reload the page and try again.';

type Method = 'otp' | 'password';
type Check = { ok: true; method: Method } | { ok: false; response: NextResponse };
type Marked = { kind: 'marked'; at: string } | { kind: 'gone' } | { kind: 'failed' };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalid(message: string, field: 'otp' | 'password'): Promise<NextResponse> {
  return fail('VALIDATION_ERROR', message, { details: { field } });
}

async function refuse(response: Promise<NextResponse>): Promise<Check> {
  return { ok: false, response: await response };
}

async function checkCode(admin: AdminContext, mfa: MfaRecord, body: Record<string, unknown>): Promise<Check> {
  if (mfa.lockedUntil) return refuse(refuseLocked(admin, 'REAUTH_FAILED', mfa.lockedUntil));
  const code = typeof body.otp === 'string' ? body.otp.replace(/\s+/g, '') : '';
  if (code === '') return refuse(invalid(ENTER_CODE, 'otp'));
  if (!CODE_PATTERN.test(code)) return refuse(invalid(ENTER_SIX_DIGITS, 'otp'));
  let secret: Buffer;
  try {
    secret = openSecret(mfa.secretEnc ?? '', admin.admin_id, mfa.keyVersion);
  } catch (error) {
    return refuse(twoStepUnavailable(error));
  }
  const outcome = await settleTotpCode(admin, matchTotp(secret, code), 'REAUTH_FAILED');
  if (outcome.kind === 'ok') return { ok: true, method: 'otp' };
  if (outcome.kind === 'wrong' || outcome.kind === 'replay') {
    if (outcome.locked) return refuse(twoStepLocked(outcome.lockedUntil));
    return refuse(invalid(outcome.kind === 'wrong' ? CODE_DID_NOT_WORK : CODE_ALREADY_USED, 'otp'));
  }
  if (outcome.kind === 'locked') return refuse(twoStepLocked(outcome.lockedUntil));
  if (outcome.kind === 'not_active') return refuse(fail('STATE_CONFLICT', TWO_STEP_CHANGED));
  return refuse(fail('INTERNAL_ERROR', CHECK_UNAVAILABLE));
}

async function checkPassword(admin: AdminContext, body: Record<string, unknown>): Promise<Check> {
  const password = typeof body.password === 'string' ? body.password : '';
  if (password === '') return refuse(invalid(ENTER_PASSWORD, 'password'));
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('password_hash')
    .eq('id', admin.admin_id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle<{ password_hash: string | null }>();
  if (error) {
    console.error('admin identity check account read failed:', error.message);
    return refuse(fail('INTERNAL_ERROR', CHECK_UNAVAILABLE));
  }
  if (!data) return refuse(fail('AUTH_REQUIRED'));
  let matched = false;
  if (data.password_hash) {
    try {
      matched = await bcrypt.compare(password, data.password_hash);
    } catch (thrown) {
      console.error('admin identity check compare failed:', errorText(thrown));
    }
  }
  if (matched) return { ok: true, method: 'password' };
  await writeAudit({
    admin,
    action: 'REAUTH_FAILED',
    entity: ENTITY,
    entity_id: admin.admin_id,
    after: { client: 'web', method: 'password' },
    result: 'failure',
    error: PASSWORD_MISMATCH,
    sensitivity: 'security',
  });
  return refuse(invalid(PASSWORD_INCORRECT, 'password'));
}

async function markReauth(adminId: string, sessionId: string): Promise<Marked> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_session_mark_reauth', { p_admin_id: adminId, p_sid: sessionId });
    if (error) {
      console.error('admin identity check could not be saved:', error.message);
      return { kind: 'failed' };
    }
    const result = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    return result.ok === true && typeof result.reauth_at === 'string' ? { kind: 'marked', at: result.reauth_at } : { kind: 'gone' };
  } catch (error) {
    console.error('admin identity check could not be saved:', errorText(error));
    return { kind: 'failed' };
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  const session = admin.session;
  if (!session) return fail('AUTH_REQUIRED');

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('VALIDATION_ERROR', MISSING_BODY);
  const body = raw as Record<string, unknown>;

  const limit = await checkLimit(`admin:${admin.admin_id}`, 'admin_reauth', ATTEMPT_LIMIT, ATTEMPT_WINDOW_SECS);
  if (limit === 'limited') return fail('RATE_LIMITED', TOO_MANY_ATTEMPTS);
  if (limit === 'unavailable') return fail('INTERNAL_ERROR', CHECK_UNAVAILABLE);

  const mfa = await loadMfa(admin.admin_id);
  if (!mfa) return fail('INTERNAL_ERROR', CHECK_UNAVAILABLE);

  const check = mfa.status === 'active' ? await checkCode(admin, mfa, body) : await checkPassword(admin, body);
  if (!check.ok) return check.response;

  const marked = await markReauth(admin.admin_id, session.id);
  if (marked.kind === 'failed') return fail('INTERNAL_ERROR', CHECK_UNAVAILABLE);
  if (marked.kind === 'gone') return fail('AUTH_REQUIRED');

  await writeAudit({
    admin,
    action: 'REAUTH',
    entity: ENTITY,
    entity_id: admin.admin_id,
    after: { client: 'web', method: check.method, session_id: session.id },
    result: 'success',
    sensitivity: 'security',
  });
  return ok({ reauth_at: marked.at, valid_for_secs: REAUTH_MAX_AGE_SECONDS });
}
