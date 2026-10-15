import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireAdmin } from '../../../../../lib/guard';
import { signSessionToken } from '../../../../../lib/jwt';
import { writeAudit } from '../../../../../lib/audit';
import { fail, ok } from '../../../../../lib/api';
import { hashRecoveryCode, matchTotp, newRecoveryCodes, openSecret } from '../../../../../lib/mfa';
import {
  NO_STORE,
  checkLimit,
  epochSeconds,
  loadMfa,
  sessionTokenAdmin,
  setSessionCookie,
  twoStepUnavailable,
  type MfaRecord,
} from '../../../../../lib/session';

const ENTITY = 'admin_users';
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_SECS = 15 * 60;
const PENDING_MS = 15 * 60 * 1000;
const CODE_PATTERN = /^[0-9]{6}$/;

const ENTER_CODE = 'Enter the 6-digit code from your authenticator app.';
const SETUP_CODE_WRONG = "That code did not work. Use the newest CardElite Admin entry in your app and check your phone's clock.";
const SETUP_EXPIRED = 'This setup timed out or was replaced. Start again.';
const ALREADY_ON = 'Two-step sign-in is already on.';
const TOO_MANY_ATTEMPTS = 'Too many setup attempts. Wait 15 minutes, then try again.';
const SETUP_UNAVAILABLE = 'Two-step sign-in could not be turned on right now. Try again in a few minutes.';
const AUDIT_WARNING = 'Two-step sign-in was turned on, but the change could not be written to the audit log.';

type Activation =
  | { kind: 'ok'; tokenVersion: number | null; sessionKept: boolean; sessionsRevoked: number }
  | { kind: 'refused'; reason: string }
  | { kind: 'failed' };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wrongCode(message: string) {
  return fail('VALIDATION_ERROR', message, { details: { field: 'otp' } });
}

function conflict(message: string, reason: 'already_active' | 'setup_expired') {
  return fail('STATE_CONFLICT', message, { details: { reason } });
}

function freshPending(mfa: MfaRecord, nowMs: number): boolean {
  if (mfa.status !== 'pending' || !mfa.createdAt) return false;
  const started = Date.parse(mfa.createdAt);
  return Number.isFinite(started) && started > nowMs - PENDING_MS;
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

async function activate(adminId: string, step: number, hashes: string[], keepSid: string | null): Promise<Activation> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_mfa_activate', {
      p_admin_id: adminId,
      p_step: step,
      p_recovery_hashes: hashes,
      p_keep_sid: keepSid,
    });
    if (error) {
      console.error('admin two-step activation failed:', error.message);
      return { kind: 'failed' };
    }
    const result = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    if (!result) {
      console.error('admin two-step activation failed:', 'no result');
      return { kind: 'failed' };
    }
    if (result.ok !== true) return { kind: 'refused', reason: typeof result.reason === 'string' ? result.reason : 'unknown' };
    const version = result.token_version;
    return {
      kind: 'ok',
      tokenVersion: typeof version === 'number' && Number.isInteger(version) ? version : null,
      sessionKept: result.session_kept === true,
      sessionsRevoked: Number(result.sessions_revoked) || 0,
    };
  } catch (error) {
    console.error('admin two-step activation failed:', errorText(error));
    return { kind: 'failed' };
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  const adminId = admin.admin_id.toLowerCase();

  const raw: unknown = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return wrongCode(ENTER_CODE);
  const body = raw as Record<string, unknown>;

  const limit = await checkLimit(`admin:${adminId}`, 'admin_mfa_enroll', ATTEMPT_LIMIT, ATTEMPT_WINDOW_SECS);
  if (limit === 'limited') return fail('RATE_LIMITED', TOO_MANY_ATTEMPTS);
  if (limit === 'unavailable') return fail('INTERNAL_ERROR', SETUP_UNAVAILABLE);

  const mfa = await loadMfa(adminId);
  if (!mfa) return fail('INTERNAL_ERROR', SETUP_UNAVAILABLE);
  if (mfa.status === 'active') return conflict(ALREADY_ON, 'already_active');
  if (!freshPending(mfa, Date.now())) return conflict(SETUP_EXPIRED, 'setup_expired');

  const code = typeof body.otp === 'string' ? body.otp.replace(/\s+/g, '') : '';
  if (!CODE_PATTERN.test(code)) return wrongCode(ENTER_CODE);

  let step: number | null;
  try {
    step = matchTotp(openSecret(mfa.secretEnc ?? '', adminId, mfa.keyVersion), code);
  } catch (error) {
    return twoStepUnavailable(error);
  }
  if (step === null) return wrongCode(SETUP_CODE_WRONG);

  let codes: string[];
  let hashes: string[];
  try {
    codes = newRecoveryCodes();
    hashes = codes.map((recoveryCode) => hashRecoveryCode(recoveryCode, adminId, mfa.keyVersion));
  } catch (error) {
    return twoStepUnavailable(error);
  }

  const session = admin.session.transport === 'cookie' ? admin.session : null;
  const activated = await activate(adminId, step, hashes, session ? session.id : null);
  if (activated.kind === 'failed') return fail('INTERNAL_ERROR', SETUP_UNAVAILABLE);
  if (activated.kind === 'refused') {
    if (activated.reason === 'already_active') return conflict(ALREADY_ON, 'already_active');
    if (activated.reason === 'not_pending') return conflict(SETUP_EXPIRED, 'setup_expired');
    if (activated.reason === 'admin_inactive') return fail('AUTH_REQUIRED');
    console.error('admin two-step activation failed:', 'unexpected refusal');
    return fail('INTERNAL_ERROR', SETUP_UNAVAILABLE);
  }

  const recorded = await writeAudit({
    admin,
    action: 'MFA_ENABLED',
    entity: ENTITY,
    entity_id: adminId,
    after: {
      client: 'web',
      during_sign_in: false,
      sessions_revoked: activated.sessionsRevoked,
      recovery_codes_left: codes.length,
      session_kept: activated.sessionKept,
    },
    result: 'success',
    sensitivity: 'security',
  });

  let token: string | null = null;
  if (session && activated.sessionKept && activated.tokenVersion !== null) {
    try {
      token = await signSessionToken(
        sessionTokenAdmin(admin, activated.tokenVersion),
        session.id,
        [...session.amr, 'otp'],
        epochSeconds(session.expiresAt),
      );
    } catch (error) {
      console.error('admin two-step session signing failed:', errorText(error));
    }
  }

  const res = await ok({
    recovery_codes: codes,
    recovery_codes_left: codes.length,
    sessions_revoked: activated.sessionsRevoked,
    session_renewed: token !== null,
    ...auditFields(recorded.ok),
  }, { headers: { ...NO_STORE } });
  if (session && token !== null) setSessionCookie(res, token, session.expiresAt);
  return res;
}
