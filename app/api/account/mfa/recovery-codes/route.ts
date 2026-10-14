import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { requireAdmin } from '../../../../lib/guard';
import { writeAudit } from '../../../../lib/audit';
import { fail, ok } from '../../../../lib/api';
import { hashRecoveryCode, matchTotp, newRecoveryCodes, openSecret } from '../../../../lib/mfa';
import {
  NO_STORE,
  checkLimit,
  loadMfa,
  refuseLocked,
  settleTotpCode,
  twoStepLocked,
  twoStepUnavailable,
} from '../../../../lib/session';

const ENTITY = 'admin_users';
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_SECS = 15 * 60;
const CODE_PATTERN = /^[0-9]{6}$/;

const ENTER_CODE = 'Enter the code from your authenticator app.';
const ENTER_SIX_DIGITS = 'Enter the 6-digit code from your authenticator app.';
const CODE_DID_NOT_WORK = 'That code did not work. Codes work once, so if you just used it, wait for the next one.';
const NOT_ON = 'Two-step sign-in is not on. Set it up first.';
const TWO_STEP_CHANGED = 'Your two-step sign-in changed. Reload the page and try again.';
const TOO_MANY_ATTEMPTS = 'Too many attempts to get new recovery codes. Wait 15 minutes, then try again.';
const CHECK_UNAVAILABLE = 'Your code cannot be checked right now. Try again in a few minutes.';
const REPLACE_FAILED = 'Your recovery codes were not changed. Wait for the next code, then try again.';
const AUDIT_WARNING = 'New recovery codes were made, but the change could not be written to the audit log.';

type Replacement = { kind: 'ok'; left: number } | { kind: 'refused' } | { kind: 'failed'; message: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wrongCode(message: string) {
  return fail('VALIDATION_ERROR', message, { details: { field: 'otp' } });
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

async function replaceCodes(adminId: string, hashes: string[]): Promise<Replacement> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_recovery_codes_replace', {
      p_admin_id: adminId,
      p_code_hashes: hashes,
    });
    if (error) return { kind: 'failed', message: error.message };
    const result = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    if (!result) return { kind: 'failed', message: 'The recovery code replacement returned no result.' };
    if (result.ok !== true) return { kind: 'refused' };
    const left = Number(result.recovery_codes_left);
    return { kind: 'ok', left: Number.isFinite(left) && left > 0 ? Math.floor(left) : hashes.length };
  } catch (error) {
    return { kind: 'failed', message: errorText(error) };
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

  const limit = await checkLimit(`admin:${adminId}`, 'admin_mfa_recovery_codes', ATTEMPT_LIMIT, ATTEMPT_WINDOW_SECS);
  if (limit === 'limited') return fail('RATE_LIMITED', TOO_MANY_ATTEMPTS);
  if (limit === 'unavailable') return fail('INTERNAL_ERROR', CHECK_UNAVAILABLE);

  const mfa = await loadMfa(adminId);
  if (!mfa) return fail('INTERNAL_ERROR', CHECK_UNAVAILABLE);
  if (mfa.status !== 'active') return fail('STATE_CONFLICT', NOT_ON);
  if (mfa.lockedUntil) return refuseLocked(admin, 'MFA_CHALLENGE_FAILED', mfa.lockedUntil);

  const code = typeof body.otp === 'string' ? body.otp.replace(/\s+/g, '') : '';
  if (code === '') return wrongCode(ENTER_CODE);
  if (!CODE_PATTERN.test(code)) return wrongCode(ENTER_SIX_DIGITS);

  let secret: Buffer;
  let codes: string[];
  let hashes: string[];
  try {
    secret = openSecret(mfa.secretEnc ?? '', adminId, mfa.keyVersion);
    codes = newRecoveryCodes();
    hashes = codes.map((recoveryCode) => hashRecoveryCode(recoveryCode, adminId, mfa.keyVersion));
  } catch (error) {
    return twoStepUnavailable(error);
  }

  const outcome = await settleTotpCode(admin, matchTotp(secret, code), 'MFA_CHALLENGE_FAILED');
  if (outcome.kind === 'wrong' || outcome.kind === 'replay') {
    return outcome.locked ? twoStepLocked(outcome.lockedUntil) : wrongCode(CODE_DID_NOT_WORK);
  }
  if (outcome.kind === 'locked') return twoStepLocked(outcome.lockedUntil);
  if (outcome.kind === 'not_active') return fail('STATE_CONFLICT', TWO_STEP_CHANGED);
  if (outcome.kind === 'unavailable') return fail('INTERNAL_ERROR', CHECK_UNAVAILABLE);

  const replaced = await replaceCodes(adminId, hashes);
  if (replaced.kind !== 'ok') {
    const message = replaced.kind === 'failed' ? replaced.message : 'Two-step sign-in was no longer on.';
    if (replaced.kind === 'failed') console.error('admin recovery code replacement failed:', replaced.message);
    await writeAudit({
      admin,
      action: 'MFA_RECOVERY_CODES_REPLACED',
      entity: ENTITY,
      entity_id: adminId,
      after: { client: 'web' },
      result: 'failure',
      error: message,
      sensitivity: 'security',
    });
    return replaced.kind === 'refused' ? fail('STATE_CONFLICT', TWO_STEP_CHANGED) : fail('INTERNAL_ERROR', REPLACE_FAILED);
  }

  const recorded = await writeAudit({
    admin,
    action: 'MFA_RECOVERY_CODES_REPLACED',
    entity: ENTITY,
    entity_id: adminId,
    before: { recovery_codes_left: mfa.recoveryCodesLeft },
    after: { client: 'web', recovery_codes_left: replaced.left },
    result: 'success',
    sensitivity: 'security',
  });
  return ok({
    recovery_codes: codes,
    recovery_codes_left: replaced.left,
    ...auditFields(recorded.ok),
  }, { headers: { ...NO_STORE } });
}
