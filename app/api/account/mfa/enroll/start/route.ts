import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireAdmin, requireRecentAuth } from '../../../../../lib/guard';
import { fail, ok } from '../../../../../lib/api';
import {
  MFA_KEY_VERSION,
  base32Encode,
  groupKey,
  isMfaKeyConfigured,
  newTotpSecret,
  otpauthUri,
  sealSecret,
} from '../../../../../lib/mfa';
import { qrDataUri } from '../../../../../lib/qr';
import { NO_STORE, twoStepUnavailable } from '../../../../../lib/session';

const ALREADY_ON = 'Two-step sign-in is already on.';
const SETUP_FAILED = 'Two-step sign-in setup could not be started. Try again.';

type Begin = 'ok' | 'already_active' | 'inactive' | 'failed';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function alreadyOn() {
  return fail('STATE_CONFLICT', ALREADY_ON, { details: { reason: 'already_active' } });
}

async function beginSetup(adminId: string, sealed: string): Promise<Begin> {
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
    const result = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    if (result?.ok === true) return 'ok';
    if (result?.reason === 'already_active') return 'already_active';
    if (result?.reason === 'admin_inactive') return 'inactive';
    console.error('admin two-step setup start failed:', 'unexpected result');
    return 'failed';
  } catch (error) {
    console.error('admin two-step setup start failed:', errorText(error));
    return 'failed';
  }
}

export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  const adminId = admin.admin_id.toLowerCase();

  const stale = await requireRecentAuth(admin);
  if (stale) return stale;
  if (admin.mfa.status === 'active') return alreadyOn();
  if (!isMfaKeyConfigured()) return twoStepUnavailable('the encryption key is not configured');

  const secret = newTotpSecret();
  let sealed: string;
  try {
    sealed = sealSecret(secret, adminId, MFA_KEY_VERSION);
  } catch (error) {
    return twoStepUnavailable(error);
  }

  const begun = await beginSetup(adminId, sealed);
  if (begun === 'failed') return fail('INTERNAL_ERROR', SETUP_FAILED);
  if (begun === 'already_active') return alreadyOn();
  if (begun === 'inactive') return fail('AUTH_REQUIRED');

  const key = base32Encode(secret);
  let uri: string;
  let qr: string;
  try {
    uri = otpauthUri(admin.username, key);
    qr = qrDataUri(uri);
  } catch (error) {
    console.error('admin two-step setup code could not be drawn:', errorText(error));
    return fail('INTERNAL_ERROR', SETUP_FAILED);
  }
  return ok({
    otpauth_uri: uri,
    secret_display: groupKey(key),
    qr_data_uri: qr,
    account_label: `CardElite Admin (${admin.username})`,
  }, { headers: { ...NO_STORE } });
}
