import type { ApiBody, ApiResult } from '../../lib/apiClient';
import type { ConfirmOptions } from '../../_ui/Confirm';
import { formatAge, formatBusinessDateTime } from '../../lib/time';
import {
  OWN_PASSWORD_RULES,
  checkOwnPassword,
  unmetOwnPasswordRules,
  type OwnPasswordRule,
} from '../../lib/passwordPolicy';

export const PROFILE_PATH = '/api/auth/me';
export const PASSWORD_PATH = '/api/account/password';

export const PAGE_TITLE = 'Profile';
export const PAGE_SUBTITLE = 'Your own account details and password. Times are WAT.';

export interface ProfileAccount {
  id: string;
  username: string;
  email: string | null;
  roleTitle: string;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export interface PasswordDraft {
  current: string;
  next: string;
  confirm: string;
}

export type PasswordField = keyof PasswordDraft;

export type PasswordErrors = Partial<Record<PasswordField, string>>;

export interface ChecklistItem {
  id: OwnPasswordRule;
  label: string;
  met: boolean;
}

export interface PasswordChangeBody {
  current_password: string;
  new_password: string;
}

export interface PasswordChangeResult {
  sessionRenewed: boolean;
  warning: string | null;
}

export type NoticeTone = 'warning' | 'danger';

export type PasswordChangeOutcome =
  | { kind: 'done'; result: PasswordChangeResult }
  | { kind: 'field'; field: 'current' | 'next'; message: string }
  | { kind: 'notice'; tone: NoticeTone; message: string }
  | { kind: 'retry'; message: string }
  | { kind: 'expired' };

export type PasswordConfirm = Required<Pick<ConfirmOptions, 'title' | 'message' | 'consequences' | 'confirmLabel' | 'pendingLabel'>>;

export const EMPTY_PASSWORD_DRAFT: Readonly<PasswordDraft> = Object.freeze({ current: '', next: '', confirm: '' });

export const PASSWORD_FIELDS: readonly PasswordField[] = ['current', 'next', 'confirm'];

export const CURRENT_REQUIRED = 'Enter your current password.';
export const CONFIRM_REQUIRED = 'Enter the new password again.';
export const CONFIRM_MISMATCH = 'The new passwords do not match.';
export const CHANGED_MESSAGE = 'Your password was changed. You were signed out on your other devices.';
export const UNKNOWN_OUTCOME =
  'We could not confirm whether your password changed. If it did, you will be asked to sign in again with the new password.';

const FIELD_OF_DETAIL: Readonly<Record<string, 'current' | 'next'>> = {
  current_password: 'current',
  new_password: 'next',
};

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function stamp(value: unknown): string | null {
  const raw = text(value);
  return raw !== null && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toProfileAccount(body: ApiBody): ProfileAccount | null {
  const raw = body.admin;
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const username = text(raw.username);
  if (id === null || username === null) return null;
  return {
    id,
    username,
    email: text(raw.email),
    roleTitle: text(raw.role_title) ?? '',
    isSuperAdmin: raw.is_super_admin === true,
    lastLoginAt: stamp(raw.last_login_at),
    createdAt: stamp(raw.created_at),
  };
}

export function lastSignInText(value: string | null, now: Date = new Date()): string {
  if (!value) return 'Never';
  return `${formatBusinessDateTime(value)} WAT · ${formatAge(value, now)} ago`;
}

export function createdText(value: string | null): string {
  return value ? `${formatBusinessDateTime(value)} WAT` : '—';
}

function policyContext(draft: PasswordDraft, account: Pick<ProfileAccount, 'username' | 'email'>) {
  return { current: draft.current, username: account.username, email: account.email };
}

export function passwordChecklist(
  draft: PasswordDraft,
  account: Pick<ProfileAccount, 'username' | 'email'>,
): ChecklistItem[] {
  const unmet = unmetOwnPasswordRules(draft.next, policyContext(draft, account));
  return OWN_PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: draft.next !== '' && !unmet.includes(rule.id) && (rule.id !== 'different' || draft.current !== ''),
  }));
}

export function validatePasswordDraft(
  draft: PasswordDraft,
  account: Pick<ProfileAccount, 'username' | 'email'>,
): PasswordErrors {
  const errors: PasswordErrors = {};
  if (draft.current === '') errors.current = CURRENT_REQUIRED;
  const problem = checkOwnPassword(draft.next, policyContext(draft, account));
  if (problem) errors.next = problem.message;
  if (draft.confirm === '') errors.confirm = CONFIRM_REQUIRED;
  else if (draft.confirm !== draft.next) errors.confirm = CONFIRM_MISMATCH;
  return errors;
}

export function firstPasswordError(errors: PasswordErrors): PasswordField | null {
  return PASSWORD_FIELDS.find((field) => Boolean(errors[field])) ?? null;
}

export function passwordChangeBody(draft: PasswordDraft): PasswordChangeBody {
  return { current_password: draft.current, new_password: draft.next };
}

export function toPasswordChangeResult(body: ApiBody): PasswordChangeResult | null {
  if (body.changed !== true) return null;
  return { sessionRenewed: body.session_renewed === true, warning: text(body.warning) };
}

function detailField(details: unknown): 'current' | 'next' | null {
  if (!isRecord(details) || typeof details.field !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(FIELD_OF_DETAIL, details.field) ? FIELD_OF_DETAIL[details.field] : null;
}

export function classifyPasswordChange(result: ApiResult<PasswordChangeResult>): PasswordChangeOutcome {
  if (result.ok) return { kind: 'done', result: result.data };
  const failure = result.error;
  if (failure.outcomeUnknown) return { kind: 'notice', tone: 'warning', message: UNKNOWN_OUTCOME };
  if (failure.kind !== 'http') return { kind: 'retry', message: failure.message };
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.status === 429) return { kind: 'notice', tone: 'danger', message: failure.message };
  if (failure.status === 409) return { kind: 'notice', tone: 'warning', message: failure.message };
  const field = failure.status === 400 ? detailField(failure.details) : null;
  if (field) return { kind: 'field', field, message: failure.message };
  return { kind: 'retry', message: failure.message };
}

export function passwordChangeConfirm(): PasswordConfirm {
  return {
    title: 'Change your password?',
    message:
      'Changing your password signs you out on your other devices, including the CardElite Admin mobile app. You stay signed in here.',
    consequences: ['Sign in on your other devices and the mobile app with the new password.'],
    confirmLabel: 'Change password',
    pendingLabel: 'Changing your password…',
  };
}
