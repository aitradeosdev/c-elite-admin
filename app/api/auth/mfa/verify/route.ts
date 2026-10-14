import type { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { signSessionToken } from '../../../../lib/jwt';
import { writeAudit } from '../../../../lib/audit';
import { fail } from '../../../../lib/api';
import { hashChallengeToken, hashRecoveryCode, matchTotp, normalizeRecoveryCode, openSecret } from '../../../../lib/mfa';
import {
  actorFor,
  attemptChallenge,
  consumeChallenge,
  loadMfa,
  loadSignInAdmin,
  openWebSession,
  readChallengeToken,
  recordTwoStepFailure,
  refuseLocked,
  requestMeta,
  settleTotpCode,
  signInStepEnded,
  signedIn,
  twoStepLocked,
  twoStepUnavailable,
  type AuditActor,
  type MfaRecord,
  type RequestMeta,
  type SignInAdmin,
  type TwoStepFailure,
} from '../../../../lib/session';

const SIGN_IN_UNAVAILABLE = 'Sign-in is unavailable right now. Try again shortly.';
const ENTER_CODE = 'Enter the 6-digit code from your authenticator app.';
const CODE_DID_NOT_WORK = 'That code did not work. Enter the newest code, and check that your phone sets its clock automatically.';
const CODE_ALREADY_USED = 'That code was already used. Wait for the next one.';
const RECOVERY_DID_NOT_WORK = 'That recovery code did not work or was already used.';
const RECOVERY_MALFORMED = 'Recovery code was not in the expected format.';
const RECOVERY_MISMATCH = 'Recovery code did not match or was already used.';
const CODE_PATTERN = /^[0-9]{6}$/;

type CodeInput = { kind: 'otp'; value: string } | { kind: 'recovery'; value: string };

interface Attempt {
  admin: SignInAdmin;
  mfa: MfaRecord;
  actor: AuditActor;
  meta: RequestMeta;
  tokenHash: string;
  attemptsLeft: number;
}

function readInput(body: unknown): CodeInput {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (typeof record.recovery_code === 'string') return { kind: 'recovery', value: record.recovery_code };
  return { kind: 'otp', value: typeof record.otp === 'string' ? record.otp : '' };
}

function wrongCode(message: string, field: 'otp' | 'recovery_code', attemptsLeft: number): Promise<NextResponse> {
  return fail('VALIDATION_ERROR', message, { details: { field, attempts_left: attemptsLeft } });
}

function refused(outcome: TwoStepFailure, message: string, field: 'otp' | 'recovery_code', attemptsLeft: number) {
  return outcome.locked ? twoStepLocked(outcome.lockedUntil) : wrongCode(message, field, attemptsLeft);
}

async function finish(attempt: Attempt, method: 'otp' | 'recovery', extra: Record<string, unknown>): Promise<NextResponse> {
  const consumed = await consumeChallenge(attempt.tokenHash, 'mfa_verify');
  if (consumed.kind === 'failed') return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (consumed.kind === 'ended') return signInStepEnded();
  const opened = await openWebSession(attempt.admin, ['pwd', method], consumed.tokenVersion, attempt.meta, signSessionToken);
  if (opened.kind === 'failed') return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (opened.kind === 'refused') return signInStepEnded();
  return signedIn(attempt.admin, opened, attempt.actor, { method, ...extra }, true);
}

async function withCode(attempt: Attempt, input: string): Promise<NextResponse> {
  const code = input.replace(/\s+/g, '');
  if (!CODE_PATTERN.test(code)) return wrongCode(ENTER_CODE, 'otp', attempt.attemptsLeft);
  let secret: Buffer;
  try {
    secret = openSecret(attempt.mfa.secretEnc ?? '', attempt.admin.id, attempt.mfa.keyVersion);
  } catch (error) {
    return twoStepUnavailable(error);
  }
  const outcome = await settleTotpCode(attempt.actor, matchTotp(secret, code), 'MFA_CHALLENGE_FAILED');
  if (outcome.kind === 'ok') return finish(attempt, 'otp', {});
  if (outcome.kind === 'wrong') return refused(outcome, CODE_DID_NOT_WORK, 'otp', attempt.attemptsLeft);
  if (outcome.kind === 'replay') return refused(outcome, CODE_ALREADY_USED, 'otp', attempt.attemptsLeft);
  if (outcome.kind === 'locked') return twoStepLocked(outcome.lockedUntil);
  if (outcome.kind === 'not_active') return signInStepEnded();
  return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
}

async function withRecoveryCode(attempt: Attempt, input: string): Promise<NextResponse> {
  const code = normalizeRecoveryCode(input);
  if (!code) {
    const outcome = await recordTwoStepFailure(attempt.actor, 'MFA_CHALLENGE_FAILED', RECOVERY_MALFORMED);
    return refused(outcome, RECOVERY_DID_NOT_WORK, 'recovery_code', attempt.attemptsLeft);
  }
  let codeHash: string;
  try {
    codeHash = hashRecoveryCode(code, attempt.admin.id, attempt.mfa.keyVersion);
  } catch (error) {
    return twoStepUnavailable(error);
  }

  let reply: Record<string, unknown>;
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_recovery_code_use', {
      p_admin_id: attempt.admin.id,
      p_code_hash: codeHash,
    });
    if (error || !data || typeof data !== 'object') {
      console.error('admin recovery code check failed:', error ? error.message : 'no result');
      return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
    }
    reply = data as Record<string, unknown>;
  } catch (error) {
    console.error('admin recovery code check failed:', error instanceof Error ? error.message : String(error));
    return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  }

  if (reply.ok === true) {
    const left = Number(reply.recovery_codes_left);
    const recoveryCodesLeft = Number.isFinite(left) && left > 0 ? Math.floor(left) : 0;
    await writeAudit({
      admin: attempt.actor,
      action: 'MFA_RECOVERY_CODE_USED',
      entity: 'admin_users',
      entity_id: attempt.admin.id,
      after: { client: 'web', recovery_codes_left: recoveryCodesLeft },
      result: 'success',
      sensitivity: 'security',
    });
    return finish(attempt, 'recovery', { recovery_codes_left: recoveryCodesLeft });
  }
  if (reply.reason === 'invalid') {
    const outcome = await recordTwoStepFailure(attempt.actor, 'MFA_CHALLENGE_FAILED', RECOVERY_MISMATCH);
    return refused(outcome, RECOVERY_DID_NOT_WORK, 'recovery_code', attempt.attemptsLeft);
  }
  if (reply.reason === 'locked') {
    const lockedUntil = typeof reply.locked_until === 'string' ? reply.locked_until : null;
    return refuseLocked(attempt.actor, 'MFA_CHALLENGE_FAILED', lockedUntil);
  }
  return signInStepEnded();
}

export async function POST(req: NextRequest) {
  const meta = await requestMeta(req.headers);
  const token = await readChallengeToken();
  if (!token) return signInStepEnded();
  const tokenHash = hashChallengeToken(token);

  const challenge = await attemptChallenge(tokenHash, 'mfa_verify');
  if (challenge.kind === 'failed') return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (challenge.kind === 'ended') return signInStepEnded();

  const read = await loadSignInAdmin(challenge.adminId);
  if (!read.ok) return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (!read.admin) return signInStepEnded();
  const admin = read.admin;

  const mfa = await loadMfa(admin.id);
  if (!mfa) return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (mfa.status !== 'active') return signInStepEnded();

  const actor = actorFor(admin, meta);
  if (mfa.lockedUntil) return refuseLocked(actor, 'MFA_CHALLENGE_FAILED', mfa.lockedUntil);

  const attempt: Attempt = { admin, mfa, actor, meta, tokenHash, attemptsLeft: challenge.attemptsLeft };
  const input = readInput(await req.json().catch(() => null));
  return input.kind === 'recovery' ? withRecoveryCode(attempt, input.value) : withCode(attempt, input.value);
}
