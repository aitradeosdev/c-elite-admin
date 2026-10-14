import { supabaseAdmin } from '../../../../../lib/supabase';
import { fail, ok } from '../../../../../lib/api';
import {
  MFA_KEY_VERSION,
  base32Encode,
  groupKey,
  hashChallengeToken,
  isMfaKeyConfigured,
  newTotpSecret,
  openSecret,
  otpauthUri,
  sealSecret,
} from '../../../../../lib/mfa';
import { qrDataUri } from '../../../../../lib/qr';
import {
  NO_STORE,
  attemptChallenge,
  loadMfa,
  loadSignInAdmin,
  readChallengeToken,
  signInStepEnded,
  twoStepUnavailable,
  type MfaRecord,
} from '../../../../../lib/session';

const SIGN_IN_UNAVAILABLE = 'Sign-in is unavailable right now. Try again shortly.';
const PENDING_REUSE_MS = 15 * 60 * 1000;

function reusable(mfa: MfaRecord, nowMs: number): boolean {
  if (mfa.status !== 'pending' || !mfa.createdAt) return false;
  const started = Date.parse(mfa.createdAt);
  return Number.isFinite(started) && started > nowMs - PENDING_REUSE_MS;
}

async function beginSetup(adminId: string, sealed: string): Promise<'ok' | 'refused' | 'failed'> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_mfa_begin', {
      p_admin_id: adminId,
      p_secret_enc: sealed,
      p_key_version: MFA_KEY_VERSION,
    });
    if (error) {
      console.error('admin two-step setup start failed:', error.message);
      return 'failed';
    }
    return data && typeof data === 'object' && (data as Record<string, unknown>).ok === true ? 'ok' : 'refused';
  } catch (error) {
    console.error('admin two-step setup start failed:', error instanceof Error ? error.message : String(error));
    return 'failed';
  }
}

export async function POST() {
  const token = await readChallengeToken();
  if (!token) return signInStepEnded();
  const challenge = await attemptChallenge(hashChallengeToken(token), 'mfa_enroll');
  if (challenge.kind === 'failed') return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (challenge.kind === 'ended') return signInStepEnded();

  const read = await loadSignInAdmin(challenge.adminId);
  if (!read.ok) return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (!read.admin) return signInStepEnded();
  const admin = read.admin;

  const mfa = await loadMfa(admin.id);
  if (!mfa) return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (mfa.status === 'active') return signInStepEnded();
  if (!isMfaKeyConfigured()) return twoStepUnavailable('the encryption key is not configured');

  let secret: Buffer;
  if (reusable(mfa, Date.now())) {
    try {
      secret = openSecret(mfa.secretEnc ?? '', admin.id, mfa.keyVersion);
    } catch (error) {
      return twoStepUnavailable(error);
    }
  } else {
    secret = newTotpSecret();
    let sealed: string;
    try {
      sealed = sealSecret(secret, admin.id, MFA_KEY_VERSION);
    } catch (error) {
      return twoStepUnavailable(error);
    }
    const begun = await beginSetup(admin.id, sealed);
    if (begun === 'failed') return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
    if (begun === 'refused') return signInStepEnded();
  }

  const key = base32Encode(secret);
  let uri: string;
  let qr: string;
  try {
    uri = otpauthUri(admin.username, key);
    qr = qrDataUri(uri);
  } catch (error) {
    console.error('admin two-step setup code could not be drawn:', error instanceof Error ? error.message : String(error));
    return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  }
  return ok({
    otpauth_uri: uri,
    secret_display: groupKey(key),
    qr_data_uri: qr,
    account_label: `CardElite Admin (${admin.username})`,
  }, { headers: { ...NO_STORE } });
}
