import type { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../lib/supabase';
import { signSessionToken } from '../../lib/jwt';
import { fail, ok } from '../../lib/api';
import { isMfaKeyConfigured, newChallengeToken } from '../../lib/mfa';
import {
  NO_STORE,
  actorFor,
  checkLimit,
  createChallenge,
  loadMfa,
  openWebSession,
  refuseLocked,
  requestMeta,
  setChallengeCookie,
  signedIn,
  twoStepUnavailable,
  type ChallengePurpose,
  type LimitVerdict,
  type RequestMeta,
  type SignInAdmin,
} from '../../lib/session';

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const ADMIN_COLUMNS =
  'id, username, email, password_hash, role_title, is_super_admin, is_active, page_permissions, theme_preference, token_version';
const MISSING_FIELDS = 'Email, username and password required';
const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again later.';
const INVALID_CREDENTIALS = 'Invalid credentials';
const SIGN_IN_UNAVAILABLE = 'Sign-in is unavailable right now. Try again shortly.';
const NO_ROWS = 'PGRST116';

interface Credentials {
  email: string;
  username: string;
  password: string;
}

interface AdminRow extends SignInAdmin {
  email: string;
  password_hash: string | null;
  is_active: boolean;
}

function readCredentials(body: unknown): Credentials | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { email, username, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof username !== 'string' || typeof password !== 'string') return null;
  if (!email || !username || !password) return null;
  return { email, username, password };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function limitRefusal(verdict: LimitVerdict): Promise<NextResponse> {
  return verdict === 'limited'
    ? fail('RATE_LIMITED', TOO_MANY_ATTEMPTS)
    : fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
}

async function passwordMatches(password: string, hash: string | null): Promise<boolean> {
  const usable = typeof hash === 'string' && hash.length > 0;
  try {
    const match = await bcrypt.compare(password, usable ? hash : DUMMY_HASH);
    return usable && match;
  } catch (error) {
    console.error('admin login password check failed:', errorText(error));
    return false;
  }
}

async function recordPasswordFailure(admin: AdminRow, meta: RequestMeta): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('admin_record_login_failure', {
      p_admin_id: admin.id,
      p_client: 'web',
      p_ip: meta.ip,
      p_user_agent: meta.user_agent || null,
      p_request_id: meta.request_id,
    });
    if (error) console.error('admin sign-in failure record failed:', error.message);
  } catch (error) {
    console.error('admin sign-in failure record failed:', errorText(error));
  }
}

async function startChallenge(
  admin: AdminRow,
  meta: RequestMeta,
  purpose: ChallengePurpose,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const challenge = newChallengeToken();
  const created = await createChallenge(admin.id, purpose, challenge.hash, meta);
  if (created === 'failed') return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (created === 'refused') return fail('AUTH_REQUIRED', INVALID_CREDENTIALS);
  const res = await ok(body, { headers: { ...NO_STORE } });
  setChallengeCookie(res, challenge.token);
  return res;
}

async function askForCode(admin: AdminRow, meta: RequestMeta): Promise<NextResponse> {
  const mfa = await loadMfa(admin.id);
  if (!mfa) return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (mfa.status !== 'active') return fail('AUTH_REQUIRED', INVALID_CREDENTIALS);
  if (mfa.lockedUntil) return refuseLocked(actorFor(admin, meta), 'MFA_CHALLENGE_FAILED', mfa.lockedUntil);
  if (!isMfaKeyConfigured(mfa.keyVersion)) return twoStepUnavailable('the encryption key is not configured');
  return startChallenge(admin, meta, 'mfa_verify', { step: 'mfa', methods: ['otp', 'recovery'], username: admin.username });
}

async function askForSetup(admin: AdminRow, meta: RequestMeta): Promise<NextResponse> {
  if (!isMfaKeyConfigured()) return twoStepUnavailable('the encryption key is not configured');
  return startChallenge(admin, meta, 'mfa_enroll', { step: 'enroll', username: admin.username });
}

export async function POST(req: NextRequest) {
  const credentials = readCredentials(await req.json().catch(() => null));
  if (!credentials) return fail('VALIDATION_ERROR', MISSING_FIELDS);
  const { email, username, password } = credentials;
  const meta = await requestMeta(req.headers);

  const byIp = await checkLimit(meta.ip, 'admin_login', 20, 600);
  if (byIp !== 'allowed') return limitRefusal(byIp);
  const byAccount = await checkLimit(`admin:${username.toLowerCase()}|${email.toLowerCase()}`, 'admin_login_account', 10, 1800);
  if (byAccount !== 'allowed') return limitRefusal(byAccount);

  const { data: admin, error } = await supabaseAdmin
    .from('admin_users')
    .select(ADMIN_COLUMNS)
    .eq('username', username)
    .eq('email', email)
    .eq('is_active', true)
    .is('deleted_at', null)
    .single<AdminRow>();
  if (error && error.code !== NO_ROWS) {
    console.error('admin login lookup failed:', error.message);
    return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  }
  if (!admin) {
    await passwordMatches(password, null);
    return fail('AUTH_REQUIRED', INVALID_CREDENTIALS);
  }

  if (!(await passwordMatches(password, admin.password_hash))) {
    await recordPasswordFailure(admin, meta);
    return fail('AUTH_REQUIRED', INVALID_CREDENTIALS);
  }

  const opened = await openWebSession(admin, ['pwd'], admin.token_version ?? 0, meta, signSessionToken);
  if (opened.kind === 'ok') return signedIn(admin, opened, actorFor(admin, meta));
  if (opened.kind === 'failed') return fail('INTERNAL_ERROR', SIGN_IN_UNAVAILABLE);
  if (opened.reason === 'mfa_required') return askForCode(admin, meta);
  if (opened.reason === 'mfa_enrolment_required') return askForSetup(admin, meta);
  return fail('AUTH_REQUIRED', INVALID_CREDENTIALS);
}
