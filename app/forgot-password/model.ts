import type { ApiBody, ApiResult } from '../lib/apiClient';
import { securityFailureText } from '../lib/adminSecurity';
import { TOO_MANY_ATTEMPTS, credentialError } from '../login/model';

export type ForgotField = 'email' | 'username';

export interface ForgotValues {
  email: string;
  username: string;
}

export type ForgotOutcome = { kind: 'sent' } | { kind: 'error'; message: string };

export const REQUEST_PATH = '/api/auth/password/forgot';
export const SIGN_IN_HREF = '/login';

export const FORGOT_HEADING = 'Reset your password';
export const FORGOT_LEAD = 'Enter the email and username you sign in with. We will email you a link to choose a new password.';
export const SEND_LABEL = 'Email me a link';
export const SENDING_LABEL = 'Sending…';
export const FORGOT_SENT =
  'If those details match an admin account, we have emailed a link to choose a new password. It works for 30 minutes.';
export const SPAM_HINT = 'Check your spam folder if it does not arrive.';
export const BACK_TO_SIGN_IN = 'Back to sign in';
export const FORGOT_UNAVAILABLE = 'Password reset is unavailable right now. Try again shortly.';
export const FORGOT_FOOTNOTE = 'Every request is recorded.';

export function forgotError(field: ForgotField, values: ForgotValues): string | null {
  return credentialError(field, { ...values, password: '' });
}

export function forgotComplete(values: ForgotValues): boolean {
  return Boolean(values.email.trim() && values.username.trim());
}

export function forgotBody(values: ForgotValues): Record<string, string> {
  return { email: values.email.trim(), username: values.username.trim() };
}

export function classifyForgot(result: ApiResult<ApiBody>): ForgotOutcome {
  if (result.ok) return { kind: 'sent' };
  const failure = result.error;
  if (failure.kind !== 'http') return { kind: 'error', message: securityFailureText(failure, FORGOT_UNAVAILABLE) };
  if (failure.status === 429) return { kind: 'error', message: TOO_MANY_ATTEMPTS };
  if (failure.status !== null && failure.status >= 400 && failure.status < 500 && failure.code) {
    return { kind: 'error', message: failure.message };
  }
  return { kind: 'error', message: FORGOT_UNAVAILABLE };
}
