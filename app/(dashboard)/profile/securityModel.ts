import type { ApiBody } from '../../lib/apiClient';
import type { ConfirmOptions } from '../../_ui/Confirm';
import {
  graceText, isLocalAddress, isLockActive, isRecoveryCodeShape, lockedUntilText, recoveryCodesLeftText,
  recoveryCodesTone, toTwoStepStatus, twoStepBadge,
  type DeviceSession, type RecoveryCodesTone, type TwoStepBadge, type TwoStepStatus,
} from '../../lib/adminSecurity';
import { formatAge, formatBusinessDateTime } from '../../lib/time';

export type SecurityPrompt = 'none' | 'due' | 'overdue';
export type TwoStepMode = 'off' | 'all';
export type TwoStepNoticeTone = 'warning' | 'danger';
export type ConfirmCopy = Omit<ConfirmOptions, 'action' | 'actionErrorMessage' | 'returnFocusTo'>;

export interface ShellSecurity {
  prompt: SecurityPrompt;
  graceEndsAt: string | null;
}

export interface SecurityBannerView {
  tone: TwoStepNoticeTone;
  title: string;
  text: string;
}

export interface TwoStepPolicy {
  mode: TwoStepMode;
  graceEndsAt: string | null;
  requiredNow: boolean;
}

export interface TwoStepAccount {
  status: TwoStepStatus;
  createdAt: string | null;
  confirmedAt: string | null;
  lastUsedAt: string | null;
  lockedUntil: string | null;
  recoveryCodesLeft: number;
  resetAt: string | null;
  policy: TwoStepPolicy;
}

export interface TwoStepNotice {
  key: 'reset' | 'required' | 'locked' | 'codes';
  tone: TwoStepNoticeTone;
  title: string | null;
  text: string;
}

export interface RecoveryCodesSummary {
  left: number;
  text: string;
  tone: RecoveryCodesTone;
}

export interface TwoStepView {
  status: TwoStepStatus;
  badge: TwoStepBadge;
  locked: boolean;
  notices: TwoStepNotice[];
  lead: string | null;
  onSince: string | null;
  lastUsed: string | null;
  codes: RecoveryCodesSummary | null;
  help: string | null;
  canSetUp: boolean;
  canReplaceCodes: boolean;
}

export interface TwoStepViewOptions {
  isSuperAdmin: boolean;
  now?: Date;
}

export interface SetupFinish {
  expire: boolean;
  refresh: boolean;
}

export interface NewRecoveryCodes {
  codes: string[];
  left: number;
  warning: string | null;
}

export interface DeviceSignOut {
  revoked: boolean;
  warning: string | null;
}

export interface OthersSignOut {
  revoked: number;
  sessionRenewed: boolean;
  warning: string | null;
}

export const TWO_STEP_ANCHOR = 'two-step-sign-in';
export const DEVICES_ANCHOR = 'signed-in-devices';
export const TWO_STEP_HREF = `/profile#${TWO_STEP_ANCHOR}`;
export const LOGIN_PATH = '/login';

export const MFA_PATH = '/api/account/mfa';
export const SETUP_START_PATH = '/api/account/mfa/enroll/start';
export const SETUP_CONFIRM_PATH = '/api/account/mfa/enroll/confirm';
export const RECOVERY_CODES_PATH = '/api/account/mfa/recovery-codes';
export const SESSIONS_PATH = '/api/account/sessions';
export const SIGN_OUT_OTHERS_PATH = '/api/account/sessions/sign-out-others';
export const SIGN_OUT_EVERYWHERE_PATH = '/api/account/sessions/sign-out-everywhere';

export const DEVICES_POLL_MS = 60 * 1000;

export const NO_SECURITY_PROMPT: Readonly<ShellSecurity> = Object.freeze({ prompt: 'none', graceEndsAt: null });

export const BANNER_ACTION_LABEL = 'Set it up';
export const BANNER_OVERDUE_TITLE = 'Two-step sign-in is now required';
export const BANNER_OVERDUE_TEXT =
  'Set it up now, or you will have to before you can use the console the next time you sign in.';

export const TWO_STEP_TITLE = 'Two-step sign-in';
export const TWO_STEP_SUBTITLE = 'A 6-digit code from an authenticator app, asked for after your password.';
export const TWO_STEP_LOAD_FAILED = 'Your two-step sign-in could not be loaded';
export const OFF_LEAD = 'Add a second step so a stolen password is not enough to get into the console.';
export const REQUIRED_NOW_TEXT = 'Required now. You will have to set it up the next time you sign in.';
export const NO_CODES_LEFT =
  'You have no recovery codes left. Get new ones so you can still sign in if you lose your phone.';
export const APP_CALLOUT_TITLE = 'CardElite Admin app';
export const APP_CALLOUT_TEXT = 'Type your password and then your 6-digit code in the Password field, with no space.';
export const LOST_PHONE_HELP =
  'Lost your phone? Sign in with a recovery code, then ask a super administrator to reset two-step sign-in.';
export const ONLY_SUPER_ADMIN_HELP = 'If you are the only super administrator, it is reset from the database.';
export const NOT_USED_YET = 'Not used yet';
export const SET_UP_LABEL = 'Set up two-step sign-in';
export const NEW_CODES_LABEL = 'Get new recovery codes…';
export const SETUP_MODAL_TITLE = 'Set up two-step sign-in';
export const SETUP_CONFIRM_LABEL = 'Turn on two-step sign-in';
export const SETUP_FINISH_LABEL = 'Done';
export const ENABLED_TOAST = 'Two-step sign-in is on.';
export const NEW_CODES_MODAL_TITLE = 'Your new recovery codes';
export const DONE_LABEL = 'Done';
export const CODES_UNAVAILABLE = 'Your recovery codes could not be changed right now. Try again shortly.';

export const DEVICES_TITLE = 'Signed-in devices';
export const DEVICES_SUBTITLE =
  'Where your account is signed in now, on the web console and in the CardElite Admin app.';
export const DEVICES_LOAD_FAILED = 'Your signed-in devices could not be loaded';
export const SIGN_OUT_LABEL = 'Sign out';
export const SIGN_OUT_OTHERS_LABEL = 'Sign out other devices';
export const SIGN_OUT_EVERYWHERE_LABEL = 'Sign out everywhere…';
export const SIGN_OUT_EVERYWHERE_HELP = 'Ends every session, including this one.';
export const DEVICE_SIGN_OUT_FAILED = 'That device could not be signed out. Try again.';
export const OTHERS_SIGN_OUT_FAILED = 'Your other devices could not be signed out. Try again.';
export const EVERYWHERE_SIGN_OUT_FAILED = 'You could not be signed out everywhere. Try again.';

const APP_SIGN_OUT_NOTE = 'The app goes back to its sign-in screen the next time it reaches the server.';
const NOT_RECORDED = 'Not recorded';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function stamp(value: unknown): string | null {
  const raw = text(value);
  return raw !== null && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function watTime(value: string): string {
  return `${formatBusinessDateTime(value)} WAT`;
}

function isAfter(later: string, earlier: string | null): boolean {
  if (earlier === null) return true;
  return Date.parse(later) > Date.parse(earlier);
}

export function shellSecurity(
  mfa: { status: string },
  policy: { mode: string; graceEndsAt: string | null; requiredNow: boolean },
): ShellSecurity {
  if (mfa.status === 'active' || policy.mode !== 'all') return { prompt: 'none', graceEndsAt: null };
  return { prompt: policy.requiredNow ? 'overdue' : 'due', graceEndsAt: policy.graceEndsAt };
}

export function securityBannerView(
  security: ShellSecurity | null | undefined,
  now: Date = new Date(),
): SecurityBannerView | null {
  if (!security || security.prompt === 'none') return null;
  const grace = graceText(security.graceEndsAt, now);
  if (security.prompt === 'overdue' || grace?.overdue) {
    return { tone: 'danger', title: BANNER_OVERDUE_TITLE, text: BANNER_OVERDUE_TEXT };
  }
  if (!grace) {
    return {
      tone: 'warning',
      title: SET_UP_LABEL,
      text: 'It will soon be required for every admin. You will then be asked to set it up when you sign in.',
    };
  }
  return {
    tone: 'warning',
    title: `Set up two-step sign-in by ${grace.date}`,
    text: `It will be required for every admin. After that date you will be asked to set it up when you sign in. ${grace.left}.`,
  };
}

export function toTwoStepAccount(body: ApiBody): TwoStepAccount | null {
  if (typeof body.status !== 'string') return null;
  const policy = isRecord(body.policy) ? body.policy : {};
  return {
    status: toTwoStepStatus(body.status),
    createdAt: stamp(body.created_at),
    confirmedAt: stamp(body.confirmed_at),
    lastUsedAt: stamp(body.last_used_at),
    lockedUntil: stamp(body.locked_until),
    recoveryCodesLeft: count(body.recovery_codes_left) ?? 0,
    resetAt: stamp(body.reset_at),
    policy: {
      mode: policy.mfa_mode === 'all' ? 'all' : 'off',
      graceEndsAt: stamp(policy.mfa_grace_ends_at),
      requiredNow: policy.mfa_required_now === true,
    },
  };
}

function requirementNotice(policy: TwoStepPolicy, now: Date): TwoStepNotice | null {
  if (policy.mode !== 'all') return null;
  const grace = graceText(policy.graceEndsAt, now);
  if (policy.requiredNow || grace?.overdue) {
    return { key: 'required', tone: 'danger', title: null, text: REQUIRED_NOW_TEXT };
  }
  if (!grace) {
    return {
      key: 'required',
      tone: 'warning',
      title: 'Required soon',
      text: 'Soon you will have to set it up when you sign in. It takes about two minutes.',
    };
  }
  return {
    key: 'required',
    tone: 'warning',
    title: `Required by ${grace.date}`,
    text: `From ${grace.dateTime} you will have to set it up when you sign in. It takes about two minutes. ${grace.left}.`,
  };
}

function pendingLead(createdAt: string | null): string {
  const started = createdAt
    ? `You started setting this up on ${watTime(createdAt)} but did not finish.`
    : 'You started setting this up but did not finish.';
  return `${started} Starting again makes a new QR code; delete any older CardElite Admin entry from your app.`;
}

export function twoStepView(account: TwoStepAccount, options: TwoStepViewOptions): TwoStepView {
  const now = options.now ?? new Date();
  const active = account.status === 'active';
  const locked = active && isLockActive(account.lockedUntil, now);
  const notices: TwoStepNotice[] = [];

  if (account.resetAt && isAfter(account.resetAt, account.confirmedAt)) {
    notices.push({
      key: 'reset',
      tone: 'warning',
      title: null,
      text: `A super administrator reset your two-step sign-in on ${watTime(account.resetAt)}.`,
    });
  }
  if (!active) {
    const required = requirementNotice(account.policy, now);
    if (required) notices.push(required);
  }
  if (locked) {
    notices.push({
      key: 'locked',
      tone: 'danger',
      title: null,
      text: `${lockedUntilText(account.lockedUntil, now)} after too many wrong codes. If you did not enter those codes, change your password.`,
    });
  }
  if (active && account.recoveryCodesLeft === 0) {
    notices.push({ key: 'codes', tone: 'danger', title: null, text: NO_CODES_LEFT });
  }

  const lastUsed = account.lastUsedAt
    ? `${watTime(account.lastUsedAt)} · ${formatAge(account.lastUsedAt, now)} ago`
    : NOT_USED_YET;

  return {
    status: account.status,
    badge: twoStepBadge({ status: account.status, lockedUntil: account.lockedUntil }, now),
    locked,
    notices,
    lead: account.status === 'none' ? OFF_LEAD : account.status === 'pending' ? pendingLead(account.createdAt) : null,
    onSince: active ? (account.confirmedAt ? watTime(account.confirmedAt) : '—') : null,
    lastUsed: active ? lastUsed : null,
    codes: active
      ? {
          left: account.recoveryCodesLeft,
          text: recoveryCodesLeftText(account.recoveryCodesLeft),
          tone: recoveryCodesTone(account.recoveryCodesLeft),
        }
      : null,
    help: active ? (options.isSuperAdmin ? `${LOST_PHONE_HELP} ${ONLY_SUPER_ADMIN_HELP}` : LOST_PHONE_HELP) : null,
    canSetUp: !active,
    canReplaceCodes: active && !locked,
  };
}

export function lockEndsAt(account: TwoStepAccount | null | undefined, now: Date = new Date()): number | null {
  if (!account || account.status !== 'active' || !isLockActive(account.lockedUntil, now)) return null;
  return Date.parse(account.lockedUntil ?? '');
}

export function setupFinish(result: { sessionRenewed: boolean | null }): SetupFinish {
  const expire = result.sessionRenewed === false;
  return { expire, refresh: !expire };
}

export function setupConfirm(): ConfirmCopy {
  return {
    title: 'Set up two-step sign-in?',
    message:
      'Have your phone ready with an authenticator app, such as Google Authenticator, Microsoft Authenticator, 1Password or Authy. Nothing changes until you enter a code from it.',
    consequences: [
      'Turning it on signs you out on your other devices, including the CardElite Admin app. You stay signed in here.',
      'After that, every sign-in asks for a 6-digit code from the app.',
    ],
    credential: { kind: 'password' },
    confirmLabel: 'Continue',
    pendingLabel: 'Checking your password…',
  };
}

export function newCodesConfirm(left: number): ConfirmCopy {
  return {
    title: 'Get new recovery codes?',
    message: 'Your current recovery codes stop working as soon as the new ones are made.',
    details: [{ label: 'Codes left now', value: String(Number.isFinite(left) && left > 0 ? Math.floor(left) : 0) }],
    consequences: ['You see the new codes once. Save them before you close the window.'],
    credential: { kind: 'otp' },
    confirmLabel: 'Get new codes',
    pendingLabel: 'Making new codes…',
  };
}

export function toNewRecoveryCodes(body: ApiBody): NewRecoveryCodes | null {
  const raw = body.recovery_codes;
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isRecoveryCodeShape)) return null;
  return { codes: [...raw], left: count(body.recovery_codes_left) ?? raw.length, warning: text(body.warning) };
}

function ipDetail(ip: string | null): string {
  if (!ip) return NOT_RECORDED;
  return isLocalAddress(ip) ? `${ip} (local)` : ip;
}

export function deviceSignOutConfirm(
  session: Pick<DeviceSession, 'client' | 'createdAt' | 'ip'>,
  deviceLabel: string,
): ConfirmCopy {
  const base = 'That device is signed out straight away and has to sign in again.';
  return {
    title: `Sign out ${deviceLabel}?`,
    message: session.client === 'mobile' ? `${base} ${APP_SIGN_OUT_NOTE}` : base,
    details: [
      { label: 'Signed in', value: session.createdAt ? watTime(session.createdAt) : NOT_RECORDED },
      { label: 'IP address', value: ipDetail(session.ip), mono: true },
    ],
    confirmLabel: SIGN_OUT_LABEL,
    pendingLabel: 'Signing out…',
  };
}

export function othersSignOutConfirm(others: number): ConfirmCopy {
  return {
    title: 'Sign out your other devices?',
    message: 'Every other session ends straight away, on the web and in the CardElite Admin app. This device stays signed in.',
    details: [{ label: 'Other devices', value: String(Math.max(0, others)) }],
    confirmLabel: SIGN_OUT_OTHERS_LABEL,
    pendingLabel: 'Signing out your other devices…',
  };
}

export function signOutEverywhereConfirm(): ConfirmCopy {
  return {
    tone: 'danger',
    title: 'Sign out everywhere?',
    message: 'Every session ends, including this one, and you go back to the sign-in page.',
    consequences: ['The CardElite Admin app goes back to its sign-in screen the next time it reaches the server.'],
    confirmLabel: 'Sign out everywhere',
    pendingLabel: 'Signing out everywhere…',
  };
}

export function toDeviceSignOut(body: ApiBody): DeviceSignOut | null {
  if (typeof body.revoked !== 'boolean') return null;
  return { revoked: body.revoked, warning: text(body.warning) };
}

export function toOthersSignOut(body: ApiBody): OthersSignOut | null {
  const revoked = count(body.sessions_revoked);
  if (revoked === null) return null;
  return { revoked, sessionRenewed: body.session_renewed === true, warning: text(body.warning) };
}

export function deviceSignedOutText(deviceLabel: string, revoked: boolean): string {
  return revoked ? `Signed out ${deviceLabel}.` : `${deviceLabel} was already signed out.`;
}

export function othersSignedOutText(revoked: number): string {
  if (revoked <= 0) return 'No other devices were signed in.';
  return revoked === 1 ? 'Signed out 1 other device.' : `Signed out ${revoked} other devices.`;
}

export function otherDeviceCount(sessions: readonly Pick<DeviceSession, 'current'>[]): number {
  return sessions.filter((session) => !session.current).length;
}

export function sessionPath(id: string): string {
  return `${SESSIONS_PATH}/${encodeURIComponent(id)}`;
}
