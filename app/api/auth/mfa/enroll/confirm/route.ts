import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { signSessionToken } from '../../../../../lib/jwt';
import { writeAudit } from '../../../../../lib/audit';
import { fail } from '../../../../../lib/api';
import { hashChallengeToken, hashRecoveryCode, matchTotp, newRecoveryCodes, openSecret } from '../../../../../lib/mfa';
import {
  actorFor,
  attemptChallenge,
  consumeChallenge,
  loadMfa,
  loadSignInAdmin,
  openWebSession,
  readChallengeToken,
  requestMeta,
  signInStepEnded,
  signedIn,
  twoStepUnavailable,
} from '../../../../../lib/session';

const SIGN_IN_UNAVAILABLE = 'Sign-in is unavailable right now. Try again shortly.';
const ENTER_CODE = 'Enter the 6-digit code from your authenticator app.';
const SETUP_CODE_WRONG = "That code did not work. Use the newest CardElite Admin entry in your app and check your phone's clock.";
const CODE_PATTERN = /^[0-9]{6}$/;

function readOtp(body: unknown): string {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return typeof record.otp === 'string' ? record.otp.replace(/\s+/g, '') : '';
}

async function activate(adminId: string, step: number, hashes: string[]): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_mfa_activate', {
      p_admin_id: adminId,
      p_step: step,
      p_recovery_hashes: hashes,
      p_keep_sid: null,
    });
    if (error || !data || typeof data !== 'object') {
      console.error('admin two-step activation failed:', error ? error.message : 'no result');
      return null;
    }
    return data as Record<string, unknown>;
  } catch (error) {
    console.error('admin two-step activation failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function POST(req: NextRequest) {
  const meta = await requestMeta(req.headers);
  const token = await readChallengeToken();
  if (!token) return signInStepEnded();
  const tokenHash = hashChallengeToken(token);

  const challenge = await attemptChallenge(tokenHash, 'mfa_enroll');
  if (challenge.kind === 'failed') return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (challenge.kind === 'ended') return signInStepEnded();

  const read = await loadSignInAdmin(challenge.adminId);
  if (!read.ok) return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (!read.admin) return signInStepEnded();
  const admin = read.admin;

  const mfa = await loadMfa(admin.id);
  if (!mfa) return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (mfa.status !== 'pending') return signInStepEnded();

  const code = readOtp(await req.json().catch(() => null));
  if (!CODE_PATTERN.test(code)) {
    return fail('VALIDATION_ERROR', ENTER_CODE, { details: { field: 'otp', attempts_left: challenge.attemptsLeft } });
  }

  let step: number | null;
  try {
    step = matchTotp(openSecret(mfa.secretEnc ?? '', admin.id, mfa.keyVersion), code);
  } catch (error) {
    return twoStepUnavailable(error);
  }
  if (step === null) {
    return fail('VALIDATION_ERROR', SETUP_CODE_WRONG, { details: { field: 'otp', attempts_left: challenge.attemptsLeft } });
  }

  let codes: string[];
  let hashes: string[];
  try {
    codes = newRecoveryCodes();
    hashes = codes.map((recoveryCode) => hashRecoveryCode(recoveryCode, admin.id, mfa.keyVersion));
  } catch (error) {
    return twoStepUnavailable(error);
  }

  const consumed = await consumeChallenge(tokenHash, 'mfa_enroll');
  if (consumed.kind === 'failed') return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (consumed.kind === 'ended') return signInStepEnded();

  const activated = await activate(admin.id, step, hashes);
  if (!activated) return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (activated.ok !== true || !Number.isInteger(activated.token_version)) return signInStepEnded();

  const actor = actorFor(admin, meta);
  await writeAudit({
    admin: actor,
    action: 'MFA_ENABLED',
    entity: 'admin_users',
    entity_id: admin.id,
    after: {
      client: 'web',
      during_sign_in: true,
      sessions_revoked: Number(activated.sessions_revoked) || 0,
      recovery_codes_left: codes.length,
    },
    result: 'success',
    sensitivity: 'security',
  });

  const opened = await openWebSession(admin, ['pwd', 'otp'], activated.token_version as number, meta, signSessionToken);
  if (opened.kind === 'failed') return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (opened.kind === 'refused') return signInStepEnded();
  return signedIn(admin, opened, actor, { recovery_codes: codes }, true);
}
