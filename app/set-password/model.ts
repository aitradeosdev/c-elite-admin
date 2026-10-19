import type { ApiBody, ApiFailure, ApiResult } from '../lib/apiClient';
import type { PasswordRuleItem } from '../_security/PasswordRules';
import { failureField, securityFailureText } from '../lib/adminSecurity';
import { OWN_PASSWORD_RULES, checkOwnPassword, unmetOwnPasswordRules } from '../lib/passwordPolicy';
import { formatBusinessDateTime } from '../lib/time';

export type LinkPurpose = 'invite' | 'reset';

export interface LinkAccount {
  purpose: LinkPurpose;
  username: string;
  email: string | null;
  expiresAt: string | null;
}

export type SetPasswordView =
  | { kind: 'checking' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'invalid' }
  | { kind: 'form'; account: LinkAccount }
  | { kind: 'done' };

export type CheckView = Extract<SetPasswordView, { kind: 'unavailable' | 'invalid' | 'form' }>;

export type SaveOutcome =
  | { kind: 'done' }
  | { kind: 'invalid' }
  | { kind: 'field'; message: string }
  | { kind: 'error'; message: string };

export interface NewPasswordDraft {
  next: string;
  confirm: string;
}

export type NewPasswordField = keyof NewPasswordDraft;

export type NewPasswordErrors = Partial<Record<NewPasswordField, string>>;

export const SET_PASSWORD_PATH = '/set-password';
export const CHECK_PATH = '/api/auth/password/check';
export const SAVE_PATH = '/api/auth/password/set';

export const INVITE_HEADING = 'Choose your password';
export const RESET_HEADING = 'Choose a new password';
export const NEW_PASSWORD_LABEL = 'New password';
export const CONFIRM_PASSWORD_LABEL = 'Confirm password';
export const SAVE_LABEL = 'Save password';
export const SAVING_LABEL = 'Saving…';
export const DONE_HEADING = 'Password saved';
export const DONE_LEAD = 'Sign in with your email, your username and your new password.';
export const LINK_INVALID = 'This link has expired, was already used, or was replaced by a newer one.';
export const INVALID_HELP =
  'If you were resetting your password, request a new link. If you were invited, ask a super administrator to send a new invitation.';
export const REQUEST_NEW_LINK = 'Request a new link';
export const SAVE_UNAVAILABLE = 'Your password could not be saved right now. Try again shortly.';
export const CHECK_UNAVAILABLE = 'This link could not be checked right now. Try again shortly.';
export const TRY_AGAIN = 'Try again';
export const CONFIRM_REQUIRED = 'Enter the new password again.';
export const CONFIRM_MISMATCH = 'The new passwords do not match.';

export const SET_PASSWORD_RULES = OWN_PASSWORD_RULES.filter((rule) => rule.id !== 'different');

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function stamp(value: unknown): string | null {
  const raw = text(value);
  return raw !== null && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

export function toLinkAccount(body: ApiBody): LinkAccount | null {
  const purpose: LinkPurpose | null = body.purpose === 'invite' ? 'invite' : body.purpose === 'reset' ? 'reset' : null;
  const username = text(body.username);
  if (purpose === null || username === null) return null;
  return { purpose, username, email: text(body.email), expiresAt: stamp(body.expires_at) };
}

export function checkBody(token: string): Record<string, string> {
  return { token };
}

export function saveBody(token: string, next: string): Record<string, string> {
  return { token, new_password: next };
}

export function formHeading(account: LinkAccount): string {
  return account.purpose === 'invite' ? INVITE_HEADING : RESET_HEADING;
}

export function formLead(account: LinkAccount): string {
  if (account.purpose === 'reset') return `@${account.username}, choosing a new password signs you out on every device.`;
  const welcome = `Welcome, @${account.username}. Choose a password to finish setting up your admin account.`;
  return account.expiresAt ? `${welcome} The link works until ${formatBusinessDateTime(account.expiresAt)} WAT.` : welcome;
}

function policyContext(account: LinkAccount) {
  return { current: '', username: account.username, email: account.email };
}

export function newPasswordChecklist(next: string, account: LinkAccount): PasswordRuleItem[] {
  const unmet = unmetOwnPasswordRules(next, policyContext(account));
  return SET_PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: next !== '' && !unmet.includes(rule.id),
  }));
}

export function validateNewPassword(draft: NewPasswordDraft, account: LinkAccount): NewPasswordErrors {
  const errors: NewPasswordErrors = {};
  const problem = checkOwnPassword(draft.next, policyContext(account));
  if (problem) errors.next = problem.message;
  if (draft.confirm === '') errors.confirm = CONFIRM_REQUIRED;
  else if (draft.confirm !== draft.next) errors.confirm = CONFIRM_MISMATCH;
  return errors;
}

export function firstNewPasswordError(errors: NewPasswordErrors): NewPasswordField | null {
  if (errors.next) return 'next';
  return errors.confirm ? 'confirm' : null;
}

function failureText(failure: ApiFailure, fallback: string): string {
  if (failure.kind !== 'http') return securityFailureText(failure, fallback);
  if (failure.status !== null && failure.status >= 400 && failure.status < 500 && failure.code) return failure.message;
  return fallback;
}

export function classifyCheck(result: ApiResult<LinkAccount>): CheckView {
  if (result.ok) return { kind: 'form', account: result.data };
  const failure = result.error;
  if (failure.kind === 'http' && failure.status === 409) return { kind: 'invalid' };
  return { kind: 'unavailable', message: failureText(failure, CHECK_UNAVAILABLE) };
}

export function classifySave(result: ApiResult<ApiBody>): SaveOutcome {
  if (result.ok) return { kind: 'done' };
  const failure = result.error;
  if (failure.kind === 'http' && failure.status === 409) return { kind: 'invalid' };
  if (failure.kind === 'http' && failure.status === 400 && failureField(failure) === 'new_password') {
    return { kind: 'field', message: failure.message };
  }
  return { kind: 'error', message: failureText(failure, SAVE_UNAVAILABLE) };
}
