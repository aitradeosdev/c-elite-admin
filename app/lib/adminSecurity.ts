import type { ApiBody, ApiFailure, ApiFailureKind } from './apiClient';
import { twoStepUnlockText } from './http';
import { businessDateKey, formatAge, formatBusinessDate, formatBusinessDateTime } from './time';

export type DeviceKind = 'computer' | 'phone' | 'tablet' | 'app';
export type DeviceClient = 'web' | 'mobile';
export type DeviceAuthMethod = 'pwd' | 'otp' | 'recovery';
export type TwoStepStatus = 'none' | 'pending' | 'active';
export type TwoStepTone = 'success' | 'neutral' | 'danger';
export type RecoveryCodesTone = 'neutral' | 'warning' | 'danger';
export type CopyState = 'idle' | 'copied' | 'failed';

export interface DeviceDescription {
  label: string;
  kind: DeviceKind;
}

export interface DeviceSession {
  id: string;
  client: DeviceClient;
  userAgent: string | null;
  ip: string | null;
  authMethods: DeviceAuthMethod[];
  createdAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string | null;
  current: boolean;
}

export interface GraceText {
  date: string;
  shortDate: string;
  dateTime: string;
  daysLeft: number;
  left: string;
  overdue: boolean;
}

export interface EnrollSetup {
  otpauthUri: string;
  secretDisplay: string;
  qrDataUri: string;
  accountLabel: string;
}

export interface EnrollConfirmed {
  recoveryCodes: string[];
  sessionRenewed: boolean | null;
}

export interface EnrollResult {
  sessionRenewed: boolean | null;
}

export type EnrollFailure =
  | { kind: 'ended' }
  | { kind: 'field'; message: string }
  | { kind: 'problem'; message: string; restart: boolean };

export interface TwoStepBadge {
  label: string;
  tone: TwoStepTone;
}

export interface RecoveryCodesFile {
  username: string;
  createdAt?: Date;
}

export const APP_NAME = 'CardElite Admin app';
export const OTP_LENGTH = 6;
export const ACTIVE_NOW_MS = 2 * 60 * 1000;
export const COPY_STATUS_MS = 2000;
export const ENTER_OTP = 'Enter the 6-digit code from your authenticator app.';
export const ENTER_RECOVERY_CODE = 'Enter the whole recovery code: 10 letters and numbers.';
export const SETUP_UNAVAILABLE = 'Two-step sign-in setup is unavailable right now. Try again shortly.';
export const SETUP_REPLACED = 'This setup was replaced in another window. Start again.';
export const UNKNOWN_DEVICE = 'Unknown browser';
export const NO_IP = 'IP not recorded';
export const TWO_STEP_REQUIRED_NOW = 'Required now';

export const TWO_STEP_STATUS_LABEL: Readonly<Record<TwoStepStatus, string>> = Object.freeze({
  none: 'Off',
  pending: 'Setup not finished',
  active: 'On',
});

export const COPY_STATUS_TEXT: Readonly<Record<CopyState, string>> = Object.freeze({
  idle: '',
  copied: 'Copied',
  failed: 'Could not copy. Select the text and copy it instead.',
});

export const OTP_INPUT_ATTRIBUTES = Object.freeze({
  type: 'text',
  inputMode: 'numeric',
  autoComplete: 'one-time-code',
  enterKeyHint: 'go',
  autoCapitalize: 'none',
  spellCheck: false,
  translate: 'no',
} as const);

export const RECOVERY_INPUT_ATTRIBUTES = Object.freeze({
  type: 'text',
  inputMode: 'text',
  autoComplete: 'off',
  enterKeyHint: 'go',
  autoCapitalize: 'characters',
  spellCheck: false,
  translate: 'no',
} as const);

const UA_LIMIT = 512;
const DAY_MS = 24 * 60 * 60 * 1000;
const OTP_PATTERN = /^[0-9]{6}$/;
const RECOVERY_INPUT_LIMIT = 64;
const RECOVERY_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const RECOVERY_SHAPE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;
const QR_DATA_URI = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/;
const OTPAUTH_URI = /^otpauth:\/\/totp\/[^\s]+$/;
const URI_LIMIT = 2048;
const QR_LIMIT = 200000;
const AUTH_METHODS: readonly DeviceAuthMethod[] = ['otp', 'pwd', 'recovery'];

const BROWSERS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Edge', /\bEdg(?:e|A|iOS)?[/]/],
  ['Opera', /\b(?:OPR|OPiOS)[/]/],
  ['Samsung Internet', /\bSamsungBrowser[/]/],
  ['Firefox', /\b(?:Firefox|FxiOS)[/]/],
  ['Chrome', /\b(?:Chrome|CriOS)[/]/],
  ['Safari', /\bVersion[/][\d.]+.*\bSafari[/]/],
];

const SYSTEMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['iPhone', /\biPhone\b/],
  ['iPad', /\biPad\b/],
  ['Android', /\bAndroid\b/],
  ['Windows', /\bWindows\b/],
  ['ChromeOS', /\bCrOS\b/],
  ['macOS', /\bMacintosh\b|\bMac OS X\b/],
  ['Linux', /\bLinux\b/],
];

const INTERRUPTED: Readonly<Record<Exclude<ApiFailureKind, 'http'>, string>> = {
  network: 'Could not reach the server. Check your connection and try again.',
  timeout: 'The server took too long to respond. Try again.',
  aborted: 'The request was cancelled. Try again.',
  parse: 'The server sent a response that could not be read. Try again.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function instant(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stamp(value: unknown): string | null {
  const raw = text(value);
  return raw !== null && instant(raw) !== null ? raw : null;
}

function pick(list: ReadonlyArray<readonly [string, RegExp]>, ua: string): string | null {
  for (const [name, pattern] of list) if (pattern.test(ua)) return name;
  return null;
}

function calendarDay(at: Date): number {
  const [year, month, day] = businessDateKey(at).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function sanitizeOtp(value: unknown): string {
  return String(value ?? '').replace(/\D+/g, '').slice(0, OTP_LENGTH);
}

export function isCompleteOtp(value: unknown): boolean {
  return typeof value === 'string' && OTP_PATTERN.test(value);
}

export function isCompleteRecoveryCode(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > RECOVERY_INPUT_LIMIT) return false;
  const compact = value.replace(/[\s-]+/g, '');
  if (!/^[0-9A-Za-z]{10}$/.test(compact)) return false;
  return RECOVERY_PATTERN.test(compact.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0'));
}

export function groupSetupKey(secret: unknown): string {
  return String(secret ?? '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');
}

export function compactSetupKey(secret: unknown): string {
  return String(secret ?? '').replace(/\s+/g, '').toUpperCase();
}

export function describeDevice(userAgent: unknown, client: unknown): DeviceDescription {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, UA_LIMIT) : '';
  if (client === 'mobile') {
    const platform = /\bokhttp\b|\bAndroid\b/i.test(ua)
      ? 'Android'
      : /\bCFNetwork\b|\bDarwin\b|\biPhone\b|\biOS\b/.test(ua)
        ? 'iPhone'
        : null;
    return { label: platform ? `${APP_NAME} on ${platform}` : APP_NAME, kind: 'app' };
  }
  const browser = pick(BROWSERS, ua);
  const system = pick(SYSTEMS, ua);
  const kind: DeviceKind = system === 'iPhone' || (system === 'Android' && /\bMobile\b/.test(ua))
    ? 'phone'
    : system === 'iPad' || system === 'Android'
      ? 'tablet'
      : 'computer';
  if (browser && system) return { label: `${browser} on ${system}`, kind };
  if (browser) return { label: browser, kind };
  if (system) return { label: `Browser on ${system}`, kind };
  return { label: UNKNOWN_DEVICE, kind: 'computer' };
}

export function isLocalAddress(ip: unknown): boolean {
  if (typeof ip !== 'string') return false;
  const value = ip.trim().toLowerCase();
  return value === '::1' || value.startsWith('127.') || value.startsWith('::ffff:127.') || value === 'localhost';
}

export function ipText(ip: unknown): string {
  const value = typeof ip === 'string' ? ip.trim() : '';
  if (value === '' || value.toLowerCase() === 'unknown') return NO_IP;
  return isLocalAddress(value) ? `Local address (${value})` : `IP ${value}`;
}

export function lastSeenText(lastSeenAt: unknown, now: Date = new Date()): string | null {
  const seen = instant(lastSeenAt);
  if (!seen) return null;
  return now.getTime() - seen.getTime() < ACTIVE_NOW_MS ? 'Active now' : `Active ${formatAge(seen, now)} ago`;
}

export function signedInAtText(createdAt: unknown): string {
  const at = instant(createdAt);
  return at ? `Signed in ${formatBusinessDateTime(at)} WAT` : 'Sign-in time not recorded';
}

export function signedInText(
  session: Pick<DeviceSession, 'createdAt' | 'lastSeenAt'>,
  now: Date = new Date(),
): string {
  const seen = lastSeenText(session.lastSeenAt, now);
  const signedIn = signedInAtText(session.createdAt);
  return seen ? `${signedIn} · ${seen}` : signedIn;
}

export function signOutLabel(session: Pick<DeviceSession, 'createdAt'>, deviceLabel: string): string {
  const at = instant(session.createdAt);
  return at
    ? `Sign out ${deviceLabel}, signed in ${formatBusinessDateTime(at)} WAT`
    : `Sign out ${deviceLabel}`;
}

export function usedRecoveryCode(session: Pick<DeviceSession, 'authMethods'>): boolean {
  return session.authMethods.includes('recovery');
}

export function graceText(endsAt: unknown, now: Date = new Date()): GraceText | null {
  const end = instant(endsAt);
  if (!end) return null;
  const overdue = now.getTime() >= end.getTime();
  const daysLeft = overdue ? 0 : Math.max(0, Math.round((calendarDay(end) - calendarDay(now)) / DAY_MS));
  const date = formatBusinessDate(end);
  const left = overdue
    ? TWO_STEP_REQUIRED_NOW
    : daysLeft === 0
      ? 'Due today'
      : daysLeft === 1
        ? '1 day left'
        : `${daysLeft} days left`;
  return {
    date,
    shortDate: date.replace(/\s+\d{4}$/, ''),
    dateTime: `${formatBusinessDateTime(end)} WAT`,
    daysLeft,
    left,
    overdue,
  };
}

export function isLockActive(lockedUntil: unknown, now: Date = new Date()): boolean {
  const until = instant(lockedUntil);
  return until !== null && until.getTime() > now.getTime();
}

export function lockedUntilText(lockedUntil: unknown, now: Date = new Date()): string {
  const when = twoStepUnlockText(lockedUntil, now.getTime());
  return when ? `Locked until ${when}` : 'Locked';
}

export function toTwoStepStatus(value: unknown): TwoStepStatus {
  return value === 'active' || value === 'pending' ? value : 'none';
}

export function twoStepBadge(
  state: { status: TwoStepStatus; lockedUntil?: string | null },
  now: Date = new Date(),
): TwoStepBadge {
  if (state.status === 'active' && isLockActive(state.lockedUntil, now)) return { label: 'Locked', tone: 'danger' };
  if (state.status === 'active') return { label: TWO_STEP_STATUS_LABEL.active, tone: 'success' };
  return { label: TWO_STEP_STATUS_LABEL[state.status], tone: 'neutral' };
}

export function recoveryCodesTone(left: number): RecoveryCodesTone {
  if (!Number.isFinite(left) || left <= 0) return 'danger';
  return left <= 3 ? 'warning' : 'neutral';
}

export function recoveryCodesLeftText(left: number): string {
  return !Number.isFinite(left) || left <= 0 ? 'None left' : `${Math.floor(left)} left`;
}

export function triesLeftText(attemptsLeft: unknown): string {
  if (typeof attemptsLeft !== 'number' || !Number.isInteger(attemptsLeft) || attemptsLeft < 0 || attemptsLeft > 2) {
    return '';
  }
  if (attemptsLeft === 0) return 'No tries left.';
  return attemptsLeft === 1 ? '1 try left.' : '2 tries left.';
}

export function withTriesLeft(message: string, attemptsLeft: unknown): string {
  const suffix = triesLeftText(attemptsLeft);
  return suffix ? `${message} ${suffix}` : message;
}

export function failureDetails(failure: ApiFailure): Record<string, unknown> | null {
  return isRecord(failure.details) ? failure.details : null;
}

export function failureField(failure: ApiFailure): string | null {
  const details = failureDetails(failure);
  return details && typeof details.field === 'string' ? details.field : null;
}

export function failureAttemptsLeft(failure: ApiFailure): number | null {
  const left = failureDetails(failure)?.attempts_left;
  return typeof left === 'number' && Number.isInteger(left) && left >= 0 ? left : null;
}

export function securityFailureText(failure: ApiFailure, fallback: string): string {
  if (failure.kind !== 'http') return INTERRUPTED[failure.kind];
  if (failure.code === null && (failure.status ?? 0) >= 500) return fallback;
  return failure.message || fallback;
}

export function classifyEnrollFailure(failure: ApiFailure, stage: 'start' | 'confirm'): EnrollFailure {
  if (failure.kind === 'http' && (failure.status === 401 || failure.status === 403)) return { kind: 'ended' };
  if (stage === 'confirm' && failure.kind === 'http' && failure.status === 400) {
    if (failureAttemptsLeft(failure) === 0) return { kind: 'ended' };
    if (failureField(failure) === 'otp') {
      return { kind: 'field', message: withTriesLeft(failure.message || ENTER_OTP, failureAttemptsLeft(failure)) };
    }
  }
  if (failure.kind === 'http' && failure.status === 409) {
    return stage === 'confirm'
      ? { kind: 'problem', message: failure.code ? failure.message : SETUP_REPLACED, restart: true }
      : { kind: 'problem', message: failure.message, restart: false };
  }
  return { kind: 'problem', message: securityFailureText(failure, SETUP_UNAVAILABLE), restart: stage === 'start' };
}

export function isQrDataUri(value: unknown): value is string {
  return typeof value === 'string' && value.length <= QR_LIMIT && QR_DATA_URI.test(value);
}

export function isOtpauthUri(value: unknown): value is string {
  return typeof value === 'string' && value.length <= URI_LIMIT && OTPAUTH_URI.test(value);
}

export function isRecoveryCodeShape(value: unknown): value is string {
  return typeof value === 'string' && RECOVERY_SHAPE.test(value);
}

export function toEnrollSetup(body: ApiBody): EnrollSetup | null {
  const otpauthUri = text(body.otpauth_uri);
  const secret = text(body.secret_display);
  const qrDataUri = text(body.qr_data_uri);
  if (!isOtpauthUri(otpauthUri) || secret === null || !isQrDataUri(qrDataUri)) return null;
  const secretDisplay = groupSetupKey(secret);
  if (!/^[A-Z2-7 ]+$/.test(secretDisplay)) return null;
  return { otpauthUri, secretDisplay, qrDataUri, accountLabel: text(body.account_label) ?? 'CardElite Admin' };
}

export function toEnrollConfirmed(body: ApiBody): EnrollConfirmed | null {
  const raw = body.recovery_codes;
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isRecoveryCodeShape)) return null;
  return {
    recoveryCodes: [...raw],
    sessionRenewed: typeof body.session_renewed === 'boolean' ? body.session_renewed : null,
  };
}

function toDeviceSession(raw: unknown): DeviceSession | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (id === null) return null;
  const methods = Array.isArray(raw.auth_methods) ? raw.auth_methods : [];
  return {
    id,
    client: raw.client === 'mobile' ? 'mobile' : 'web',
    userAgent: text(raw.user_agent),
    ip: text(raw.ip),
    authMethods: AUTH_METHODS.filter((method) => methods.includes(method)),
    createdAt: stamp(raw.created_at),
    lastSeenAt: stamp(raw.last_seen_at),
    expiresAt: stamp(raw.expires_at),
    current: raw.current === true,
  };
}

export function toDeviceSessions(body: ApiBody): DeviceSession[] | null {
  if (!Array.isArray(body.sessions)) return null;
  const sessions = body.sessions.map(toDeviceSession).filter((session): session is DeviceSession => session !== null);
  return [...sessions.filter((session) => session.current), ...sessions.filter((session) => !session.current)];
}

export function recoveryCodesText(codes: readonly string[], file: RecoveryCodesFile): string {
  const created = file.createdAt ?? new Date();
  const width = String(codes.length).length;
  return [
    'CardElite Admin recovery codes',
    `Account: ${file.username}`,
    `Created: ${formatBusinessDateTime(created)} WAT`,
    '',
    'Each code signs you in once if you lose your phone. On the sign-in page, choose "Use a recovery code instead" and type one code.',
    '',
    ...codes.map((code, index) => `${String(index + 1).padStart(width, ' ')}. ${code}`),
    '',
  ].join('\n');
}

export function recoveryCodesFileName(username: unknown, now: Date = new Date()): string {
  const safe = String(username ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 64) || 'admin';
  return `cardelite-admin-recovery-codes-${safe}-${businessDateKey(now)}.txt`;
}
