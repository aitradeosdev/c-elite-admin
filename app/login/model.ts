import type { ApiBody, ApiFailure, ApiResult } from '../lib/apiClient';
import { MFA_LOCKED_REASON, STEP_ENDED_REASON, twoStepLockedMessage } from '../lib/http';
import {
  ENTER_OTP, ENTER_RECOVERY_CODE, failureAttemptsLeft, failureDetails, failureField, isCompleteOtp,
  isCompleteRecoveryCode, securityFailureText, withTriesLeft,
} from '../lib/adminSecurity';

export type LoginStep = 'credentials' | 'code' | 'recovery' | 'enroll' | 'recovered';
export type CodeMode = 'otp' | 'recovery';
export type CredentialField = 'email' | 'username' | 'password';
export type CodeField = 'otp' | 'recovery_code';
export type RecoveredTone = 'warning' | 'danger';

export interface Credentials {
  email: string;
  username: string;
  password: string;
}

export interface SignInLock {
  until: number;
  account: string;
}

export interface RecoveredNotice {
  tone: RecoveredTone;
  text: string;
}

export type SignInOutcome =
  | { kind: 'done' }
  | { kind: 'code'; username: string | null }
  | { kind: 'enroll'; username: string | null }
  | { kind: 'recovered'; codesLeft: number }
  | { kind: 'ended'; message: string }
  | { kind: 'locked'; message: string; lockedUntil: string | null }
  | { kind: 'error'; message: string; field: CodeField | null };

export const SIGN_IN_PATH = '/api/auth';
export const VERIFY_PATH = '/api/auth/mfa/verify';
export const ENROLL_START_PATH = '/api/auth/mfa/enroll/start';
export const ENROLL_CONFIRM_PATH = '/api/auth/mfa/enroll/confirm';
export const DEFAULT_NEXT = '/dashboard';
export const PROFILE_TWO_STEP_HREF = '/profile#two-step-sign-in';
export const FORGOT_PATH = '/forgot-password';

export const CODE_HEADING = 'Two-step sign-in';
export const CODE_LABEL = 'Authentication code';
export const CODE_HELP = 'Enter the 6-digit code from your authenticator app. It changes every 30 seconds.';
export const RECOVERY_LABEL = 'Recovery code';
export const RECOVERY_HELP = 'Each recovery code works once. Type it with or without the dash.';
export const RECOVERY_HINT = 'Lost your phone and your codes? Ask a super administrator to reset your two-step sign-in.';
export const VERIFY_LABEL = 'Verify';
export const VERIFYING_LABEL = 'Verifying…';
export const SIGN_IN_LABEL = 'Sign in';
export const SIGNING_IN_LABEL = 'Signing in…';
export const USE_RECOVERY = 'Use a recovery code instead';
export const USE_APP = 'Use your authenticator app instead';
export const SWITCH_ACCOUNT = 'Sign in as someone else';
export const FORGOT_LABEL = 'Forgot your password?';
export const ENROLL_HEADING = 'Set up two-step sign-in';
export const ENROLL_REQUIRED = 'Two-step sign-in is required for every admin. Set it up now to finish signing in.';
export const ENROLL_HELP = 'Need help? Ask a super administrator.';
export const ENROLL_CONFIRM_LABEL = 'Turn on and continue';
export const ENROLL_FINISH_LABEL = 'Continue to the console';
export const RECOVERED_HEADING = 'Signed in with a recovery code';
export const CONTINUE_LABEL = 'Continue';
export const OPEN_PROFILE_LABEL = 'Open Profile';
export const FOOTNOTE = 'Admin access is granted by a super administrator. Every sign-in attempt is recorded.';

export const STEP_ENDED = 'This sign-in step ended. Enter your password again.';
export const SETUP_ENDED = 'This setup timed out. Enter your password again to start over.';
export const NO_TRIES_LEFT = 'That did not work, and this sign-in step has no tries left. Enter your password again.';
export const SETUP_NO_TRIES_LEFT = 'That did not work, and this setup has no tries left. Enter your password again to start over.';
export const SIGN_IN_UNAVAILABLE = 'Sign-in is unavailable right now. Try again shortly.';
export const SIGN_IN_FAILED = 'Sign in failed. Check your details and try again.';
export const TOO_MANY_ATTEMPTS = 'Too many attempts. Wait a few minutes and try again.';
export const LAST_RECOVERY_CODE = 'That was your last recovery code. Get new codes on your Profile now.';

const LOGIN_PATH = /^\/login(?:[/?#]|$)/;
const LOCAL_ORIGIN = 'http://cardelite.invalid';

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function safeNext(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.charAt(0) !== '/') return DEFAULT_NEXT;
  let url: URL;
  try {
    url = new URL(raw, LOCAL_ORIGIN);
  } catch {
    return DEFAULT_NEXT;
  }
  if (url.origin !== LOCAL_ORIGIN) return DEFAULT_NEXT;
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (LOGIN_PATH.test(url.pathname) || url.pathname.startsWith('/api/')) return DEFAULT_NEXT;
  return target;
}

export function credentialError(field: CredentialField, values: Credentials): string | null {
  if (field === 'email') {
    const email = values.email.trim();
    if (!email) return 'Enter your admin email.';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : 'That does not look like an email address.';
  }
  if (field === 'username') return values.username.trim() ? null : 'Enter your admin username.';
  return values.password ? null : 'Enter your password.';
}

export function credentialsComplete(values: Credentials): boolean {
  return Boolean(values.email.trim() && values.username.trim() && values.password);
}

export function signInBody(values: Credentials): Record<string, string> {
  return { email: values.email.trim(), username: values.username.trim(), password: values.password };
}

export function accountKey(values: Pick<Credentials, 'email' | 'username'>): string {
  return `${values.username.trim().toLowerCase()}|${values.email.trim().toLowerCase()}`;
}

export function codeModeOf(step: LoginStep): CodeMode {
  return step === 'recovery' ? 'recovery' : 'otp';
}

export function codeError(mode: CodeMode, value: string): string | null {
  if (mode === 'otp') return isCompleteOtp(value) ? null : ENTER_OTP;
  return isCompleteRecoveryCode(value) ? null : ENTER_RECOVERY_CODE;
}

export function verifyBody(mode: CodeMode, value: string): Record<string, string> {
  return mode === 'otp' ? { otp: value } : { recovery_code: value.trim() };
}

export function signingInAs(username: string): string {
  return `@${username.replace(/^@+/, '')}`;
}

export function lockFrom(lockedUntil: string | null, account: string, nowMs: number = Date.now()): SignInLock | null {
  const until = lockedUntil === null ? Number.NaN : Date.parse(lockedUntil);
  return Number.isFinite(until) && until > nowMs ? { until, account } : null;
}

export function lockApplies(lock: SignInLock | null, account: string): boolean {
  return lock !== null && lock.account === account;
}

function lockedOutcome(details: Record<string, unknown> | null, nowMs: number): SignInOutcome {
  const lockedUntil = text(details?.locked_until);
  return { kind: 'locked', message: twoStepLockedMessage(lockedUntil, nowMs), lockedUntil };
}

function codeField(failure: ApiFailure): CodeField | null {
  const field = failureField(failure);
  return field === 'otp' || field === 'recovery_code' ? field : null;
}

function interruptedOrServer(failure: ApiFailure): string {
  return securityFailureText(failure, SIGN_IN_UNAVAILABLE);
}

export function classifySignIn(result: ApiResult<ApiBody>, nowMs: number = Date.now()): SignInOutcome {
  if (result.ok) {
    const username = text(result.data.username);
    if (result.data.step === 'mfa') return { kind: 'code', username };
    if (result.data.step === 'enroll') return { kind: 'enroll', username };
    return { kind: 'done' };
  }
  const failure = result.error;
  if (failure.kind !== 'http') return { kind: 'error', message: interruptedOrServer(failure), field: null };
  const details = failureDetails(failure);
  if (failure.status === 429) {
    if (details?.reason === MFA_LOCKED_REASON) return lockedOutcome(details, nowMs);
    return { kind: 'error', message: failure.code ? failure.message : TOO_MANY_ATTEMPTS, field: null };
  }
  if (failure.status === 401 && details?.reason === STEP_ENDED_REASON) return { kind: 'ended', message: STEP_ENDED };
  if (failure.status !== null && failure.status >= 400 && failure.status < 500) {
    return { kind: 'error', message: failure.code ? failure.message : SIGN_IN_FAILED, field: null };
  }
  return { kind: 'error', message: interruptedOrServer(failure), field: null };
}

export function classifyVerify(result: ApiResult<ApiBody>, nowMs: number = Date.now()): SignInOutcome {
  if (result.ok) {
    if (result.data.method === 'recovery') {
      const left = Number(result.data.recovery_codes_left);
      return { kind: 'recovered', codesLeft: Number.isFinite(left) && left > 0 ? Math.floor(left) : 0 };
    }
    return { kind: 'done' };
  }
  const failure = result.error;
  if (failure.kind !== 'http') return { kind: 'error', message: interruptedOrServer(failure), field: null };
  const details = failureDetails(failure);
  if (failure.status === 429 && details?.reason === MFA_LOCKED_REASON) return lockedOutcome(details, nowMs);
  if (failure.status === 401) return { kind: 'ended', message: STEP_ENDED };
  if (failure.status === 400) {
    const attemptsLeft = failureAttemptsLeft(failure);
    if (attemptsLeft === 0) return { kind: 'ended', message: NO_TRIES_LEFT };
    return { kind: 'error', message: withTriesLeft(failure.message || SIGN_IN_FAILED, attemptsLeft), field: codeField(failure) };
  }
  if (failure.status === 429) {
    return { kind: 'error', message: failure.code ? failure.message : TOO_MANY_ATTEMPTS, field: null };
  }
  return { kind: 'error', message: interruptedOrServer(failure), field: null };
}

export function enrollEndedMessage(failure: ApiFailure): string {
  return failure.kind === 'http' && failure.status === 400 ? SETUP_NO_TRIES_LEFT : SETUP_ENDED;
}

export function recoveredNotice(codesLeft: number): RecoveredNotice {
  if (!Number.isFinite(codesLeft) || codesLeft <= 0) return { tone: 'danger', text: LAST_RECOVERY_CODE };
  const count = codesLeft === 1 ? '1 recovery code' : `${Math.floor(codesLeft)} recovery codes`;
  return {
    tone: 'warning',
    text: `You have ${count} left. If your authenticator app is gone, ask a super administrator to reset two-step sign-in, then set it up again.`,
  };
}
