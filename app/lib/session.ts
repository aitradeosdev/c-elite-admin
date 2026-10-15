import type { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from './supabase';
import { writeAudit, type AuditInput } from './audit';
import { fail, ok, requestId } from './api';
import { MFA_LOCKED_REASON, STEP_ENDED_REASON, clientIpFrom, isUuid, twoStepLockedMessage } from './http';

export type SessionTransport = 'cookie' | 'bearer';
export type SessionClient = 'web' | 'mobile';
export type AuthMethod = 'pwd' | 'otp' | 'recovery';
export type MfaStatus = 'none' | 'pending' | 'active';
export type MfaMode = 'off' | 'all';
export type ThemePreference = 'light' | 'dark' | 'system';
export type ChallengePurpose = 'mfa_verify' | 'mfa_enroll';
export type TwoStepFailureAction = 'MFA_CHALLENGE_FAILED' | 'REAUTH_FAILED';
export type LimitVerdict = 'allowed' | 'limited' | 'unavailable';
export type AuditActor = NonNullable<AuditInput['admin']>;

export interface SessionInfo {
  id: string;
  client: SessionClient;
  amr: AuthMethod[];
  createdAt: string;
  expiresAt: string;
  reauthAt: string | null;
  transport: SessionTransport;
}

export interface MfaState {
  status: MfaStatus;
  lockedUntil: string | null;
}

export interface PolicyState {
  mode: MfaMode;
  graceEndsAt: string | null;
  requiredNow: boolean;
}

export interface SecurityState {
  session: SessionInfo;
  mfa: MfaState;
  policy: PolicyState;
}

export interface SessionTokenAdmin {
  id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: readonly string[];
  token_version: number;
}

export type SessionSigner = (
  admin: SessionTokenAdmin,
  sid: string,
  amr: readonly AuthMethod[],
  expiresAtEpoch: number,
) => Promise<string>;

export interface RequestMeta {
  ip: string;
  user_agent: string;
  request_id: string;
}

export interface SignInAdmin {
  id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[] | null;
  theme_preference: string | null;
  token_version: number | null;
}

export interface OpenedSession {
  sessionId: string;
  token: string;
  tokenVersion: number;
  expiresAt: string;
  amr: AuthMethod[];
}

export type WebSessionOpen =
  | ({ kind: 'ok' } & OpenedSession)
  | { kind: 'refused'; reason: string }
  | { kind: 'failed' };

export interface MfaRecord {
  status: MfaStatus;
  secretEnc: string | null;
  keyVersion: number;
  createdAt: string | null;
  confirmedAt: string | null;
  lastUsedAt: string | null;
  lockedUntil: string | null;
  recoveryCodesLeft: number;
}

export interface TwoStepFailure {
  locked: boolean;
  lockedUntil: string | null;
}

export type CodeOutcome =
  | { kind: 'ok' }
  | ({ kind: 'wrong' } & TwoStepFailure)
  | ({ kind: 'replay' } & TwoStepFailure)
  | { kind: 'locked'; lockedUntil: string | null }
  | { kind: 'not_active' }
  | { kind: 'unavailable' };

export type ChallengeAttempt =
  | { kind: 'ok'; adminId: string; attemptsLeft: number }
  | { kind: 'ended' }
  | { kind: 'failed' };

export type ChallengeConsume =
  | { kind: 'ok'; tokenVersion: number }
  | { kind: 'ended' }
  | { kind: 'failed' };

export type AdminRead = { ok: true; admin: SignInAdmin | null } | { ok: false };

export const SESSION_COOKIE = 'admin_token';
export const THEME_COOKIE = 'admin_theme';
export const CHALLENGE_COOKIE = 'admin_mfa_challenge';
export const CHALLENGE_PATH = '/api/auth';
export const CHALLENGE_SECONDS = 300;
export const WEB_SESSION_SECONDS = 8 * 60 * 60;
export const REAUTH_MAX_AGE_SECONDS = 300;
export const THEME_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const NO_STORE: Readonly<Record<string, string>> = Object.freeze({ 'Cache-Control': 'no-store' });
export const DEFAULT_MFA: Readonly<MfaState> = Object.freeze({ status: 'none', lockedUntil: null });
export const DEFAULT_POLICY: Readonly<PolicyState> = Object.freeze({ mode: 'off', graceEndsAt: null, requiredNow: false });

export const SESSION_UNAVAILABLE = 'Your session could not be checked. Try again.';
export const TWO_STEP_UNAVAILABLE = 'Two-step sign-in is unavailable right now. Try again later.';
export const STEP_ENDED = 'This sign-in step ended. Enter your password again.';
export const CODE_MISMATCH = 'Two-step code did not match.';
export const CODE_REUSED = 'Two-step code was already used.';
export const TWO_STEP_LOCKED = 'Two-step sign-in is locked.';
export const TWO_STEP_CHANGED = 'Two-step sign-in changed during sign-in.';
export const TWO_STEP_CHANGED_DURING_CHECK = 'Two-step sign-in changed during the identity check.';

const ENTITY = 'admin_users';
const UNIQUE_VIOLATION = '23505';
const DAY_LOCK_MINUTES = 24 * 60;
const AUTH_METHODS: readonly string[] = ['otp', 'pwd', 'recovery'];
const SIGN_IN_COLUMNS = 'id, username, role_title, is_super_admin, is_active, page_permissions, theme_preference, token_version';

export class SessionUnavailableError extends Error {
  constructor() {
    super('The admin session could not be checked.');
    this.name = 'SessionUnavailableError';
  }
}

export function isSessionUnavailable(error: unknown): boolean {
  return error instanceof SessionUnavailableError || (error instanceof Error && error.name === 'SessionUnavailableError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function normalizeAuthMethods(value: unknown): AuthMethod[] {
  if (!Array.isArray(value)) return [];
  const found = new Set<AuthMethod>();
  for (const item of value) {
    if (typeof item === 'string' && AUTH_METHODS.includes(item)) found.add(item as AuthMethod);
  }
  return [...found].sort();
}

export function epochSeconds(value: string | Date): number {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Math.floor(ms / 1000);
}

export function sessionTokenAdmin(
  admin: { admin_id: string; username: string; role_title: string; is_super_admin: boolean; page_permissions: readonly string[] },
  tokenVersion: number,
): SessionTokenAdmin {
  return {
    id: admin.admin_id,
    username: admin.username,
    role_title: admin.role_title,
    is_super_admin: admin.is_super_admin,
    page_permissions: [...admin.page_permissions],
    token_version: tokenVersion,
  };
}

export function themePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: string | Date): void {
  const until = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  const maxAge = Number.isFinite(until) ? Math.max(0, Math.floor((until - Date.now()) / 1000)) : 0;
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'strict',
    maxAge,
    path: '/',
  });
}

export function setThemeCookie(res: NextResponse, theme: ThemePreference): void {
  res.cookies.set(THEME_COOKIE, theme, {
    httpOnly: false,
    secure: secureCookies(),
    sameSite: 'lax',
    maxAge: THEME_MAX_AGE_SECONDS,
    path: '/',
  });
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'strict',
    expires: new Date(0),
    path: '/',
  });
  res.cookies.set(THEME_COOKIE, '', {
    httpOnly: false,
    secure: secureCookies(),
    sameSite: 'lax',
    expires: new Date(0),
    path: '/',
  });
}

export function setChallengeCookie(res: NextResponse, token: string): void {
  res.cookies.set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'strict',
    maxAge: CHALLENGE_SECONDS,
    path: CHALLENGE_PATH,
  });
}

export function clearChallengeCookie(res: NextResponse): void {
  res.cookies.set(CHALLENGE_COOKIE, '', {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'strict',
    expires: new Date(0),
    path: CHALLENGE_PATH,
  });
}

export async function readChallengeToken(): Promise<string | null> {
  const value = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  return value ? value : null;
}

export async function requestMeta(source: { get(name: string): string | null }): Promise<RequestMeta> {
  const get = (name: string) => source.get(name);
  return {
    ip: clientIpFrom(get),
    user_agent: (get('user-agent') || '').slice(0, 512),
    request_id: await requestId(),
  };
}

export function actorFor(admin: { id: string; role_title: string }, meta: RequestMeta): AuditActor {
  return {
    admin_id: admin.id,
    role_title: admin.role_title,
    ip: meta.ip,
    user_agent: meta.user_agent,
    request_id: meta.request_id,
  };
}

function storedIp(ip: string): string | null {
  return ip === 'unknown' ? null : ip;
}

function lastAuthenticatedAt(session: SessionInfo): number {
  const times = [Date.parse(session.createdAt), session.reauthAt ? Date.parse(session.reauthAt) : Number.NaN]
    .filter((value) => Number.isFinite(value));
  return times.length > 0 ? Math.max(...times) : Number.NEGATIVE_INFINITY;
}

export async function requireRecentAuth(
  admin: { session: SessionInfo; mfa: MfaState },
  maxAgeSecs: number = REAUTH_MAX_AGE_SECONDS,
  nowMs: number = Date.now(),
): Promise<NextResponse | null> {
  if (lastAuthenticatedAt(admin.session) >= nowMs - maxAgeSecs * 1000) return null;
  return fail('REAUTH_REQUIRED', undefined, {
    details: { method: admin.mfa.status === 'active' ? 'otp' : 'password', max_age_secs: maxAgeSecs },
  });
}

export async function requireTwoStep(admin: { mfa: MfaState }): Promise<NextResponse | null> {
  return admin.mfa.status === 'active' ? null : fail('MFA_REQUIRED');
}

async function callRpc(name: string, args: Record<string, unknown>, label: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc(name, args);
    if (error) {
      console.error(label, error.message);
      return null;
    }
    if (!isRecord(data)) {
      console.error(label, 'no result');
      return null;
    }
    return data;
  } catch (error) {
    console.error(label, errorText(error));
    return null;
  }
}

export async function checkLimit(key: string, action: string, limit: number, windowSecs: number): Promise<LimitVerdict> {
  try {
    const { data, error } = await supabaseAdmin.rpc('check_rate_limit_by_key', {
      p_key: key,
      p_action: action,
      p_limit: limit,
      p_window_secs: windowSecs,
    });
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return 'limited';
      console.error('admin rate limit check failed:', action, error.message);
      return 'unavailable';
    }
    return data === true ? 'allowed' : 'limited';
  } catch (error) {
    console.error('admin rate limit check failed:', action, errorText(error));
    return 'unavailable';
  }
}

function toMfaRecord(data: Record<string, unknown>): MfaRecord | null {
  const status: MfaStatus = data.status === 'active' || data.status === 'pending' ? data.status : 'none';
  const keyVersion = typeof data.key_version === 'number' && Number.isInteger(data.key_version) ? data.key_version : 0;
  const secretEnc = textOrNull(data.secret_enc);
  if (status !== 'none' && (secretEnc === null || keyVersion < 1)) {
    console.error('admin two-step state read failed:', 'the stored factor is incomplete');
    return null;
  }
  const left = Number(data.recovery_codes_left);
  return {
    status,
    secretEnc: status === 'none' ? null : secretEnc,
    keyVersion,
    createdAt: textOrNull(data.created_at),
    confirmedAt: textOrNull(data.confirmed_at),
    lastUsedAt: textOrNull(data.last_used_at),
    lockedUntil: textOrNull(data.locked_until),
    recoveryCodesLeft: Number.isFinite(left) && left > 0 ? Math.floor(left) : 0,
  };
}

export async function loadMfa(adminId: string): Promise<MfaRecord | null> {
  const data = await callRpc('admin_mfa_get', { p_admin_id: adminId }, 'admin two-step state read failed:');
  return data ? toMfaRecord(data) : null;
}

export async function loadSignInAdmin(adminId: string): Promise<AdminRead> {
  try {
    const { data, error } = await supabaseAdmin
      .from('admin_users')
      .select(SIGN_IN_COLUMNS)
      .eq('id', adminId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle<SignInAdmin>();
    if (error) {
      console.error('admin sign-in account read failed:', error.message);
      return { ok: false };
    }
    return { ok: true, admin: data ?? null };
  } catch (error) {
    console.error('admin sign-in account read failed:', errorText(error));
    return { ok: false };
  }
}

export function twoStepLocked(lockedUntil: string | null): Promise<NextResponse> {
  return fail('RATE_LIMITED', twoStepLockedMessage(lockedUntil), {
    details: { reason: MFA_LOCKED_REASON, locked_until: lockedUntil },
  });
}

export function twoStepUnavailable(reason: unknown): Promise<NextResponse> {
  const named = reason instanceof Error && reason.name === 'MfaUnavailableError';
  const text = named ? (reason as Error).message : typeof reason === 'string' ? reason : 'the two-step secret could not be opened';
  console.error('admin two-step sign-in unavailable:', text);
  return fail('INTERNAL_ERROR', TWO_STEP_UNAVAILABLE);
}

function lockReason(outcome: Record<string, unknown>): string {
  return outcome.lock_minutes === DAY_LOCK_MINUTES
    ? `${outcome.failed_count_24h} failed two-step codes in 24 hours.`
    : `${outcome.failed_count} failed two-step codes in 15 minutes.`;
}

export async function recordTwoStepFailure(
  actor: AuditActor,
  action: TwoStepFailureAction,
  error: string,
): Promise<TwoStepFailure> {
  let outcome: Record<string, unknown> | null = null;
  try {
    const { data, error: rpcError } = await supabaseAdmin.rpc('admin_mfa_record_failure', { p_admin_id: actor.admin_id });
    if (rpcError) console.error('admin two-step failure record failed:', rpcError.message);
    else if (isRecord(data)) outcome = data;
  } catch (thrown) {
    console.error('admin two-step failure record failed:', errorText(thrown));
  }
  await writeAudit({
    admin: actor,
    action,
    entity: ENTITY,
    entity_id: actor.admin_id,
    after: { client: 'web' },
    result: 'failure',
    error,
    sensitivity: 'security',
  });
  if (outcome?.just_locked === true) {
    await writeAudit({
      admin: actor,
      action: 'MFA_LOCKED',
      entity: ENTITY,
      entity_id: actor.admin_id,
      after: { client: 'web', locked_until: outcome.locked_until ?? null, lock_minutes: outcome.lock_minutes ?? null },
      reason: lockReason(outcome),
      result: 'success',
      sensitivity: 'security',
    });
  }
  return { locked: outcome?.locked === true, lockedUntil: textOrNull(outcome?.locked_until) };
}

export async function refuseLocked(
  actor: AuditActor,
  action: TwoStepFailureAction,
  lockedUntil: string | null,
): Promise<NextResponse> {
  await writeAudit({
    admin: actor,
    action,
    entity: ENTITY,
    entity_id: actor.admin_id,
    after: { client: 'web' },
    result: 'failure',
    error: TWO_STEP_LOCKED,
    sensitivity: 'security',
  });
  return twoStepLocked(lockedUntil);
}

export async function settleTotpCode(
  actor: AuditActor,
  step: number | null,
  action: TwoStepFailureAction,
): Promise<CodeOutcome> {
  if (step === null) return { kind: 'wrong', ...(await recordTwoStepFailure(actor, action, CODE_MISMATCH)) };
  const reply = await callRpc(
    'admin_mfa_use_step',
    { p_admin_id: actor.admin_id, p_step: step },
    'admin two-step step record failed:',
  );
  if (!reply) return { kind: 'unavailable' };
  if (reply.ok === true) return { kind: 'ok' };
  if (reply.reason === 'replay') return { kind: 'replay', ...(await recordTwoStepFailure(actor, action, CODE_REUSED)) };
  if (reply.reason === 'locked') {
    await writeAudit({
      admin: actor,
      action,
      entity: ENTITY,
      entity_id: actor.admin_id,
      after: { client: 'web' },
      result: 'failure',
      error: TWO_STEP_LOCKED,
      sensitivity: 'security',
    });
    return { kind: 'locked', lockedUntil: textOrNull(reply.locked_until) };
  }
  await writeAudit({
    admin: actor,
    action,
    entity: ENTITY,
    entity_id: actor.admin_id,
    after: { client: 'web' },
    result: 'failure',
    error: action === 'REAUTH_FAILED' ? TWO_STEP_CHANGED_DURING_CHECK : TWO_STEP_CHANGED,
    sensitivity: 'security',
  });
  return { kind: 'not_active' };
}

export async function createChallenge(
  adminId: string,
  purpose: ChallengePurpose,
  tokenHash: string,
  meta: RequestMeta,
): Promise<'ok' | 'refused' | 'failed'> {
  const reply = await callRpc(
    'admin_challenge_create',
    {
      p_admin_id: adminId,
      p_purpose: purpose,
      p_token_hash: tokenHash,
      p_ip: storedIp(meta.ip),
      p_user_agent: meta.user_agent || null,
    },
    'admin sign-in step could not be started:',
  );
  if (!reply) return 'failed';
  return reply.ok === true ? 'ok' : 'refused';
}

export async function attemptChallenge(tokenHash: string, purpose: ChallengePurpose): Promise<ChallengeAttempt> {
  const reply = await callRpc(
    'admin_challenge_attempt',
    { p_token_hash: tokenHash, p_purpose: purpose },
    'admin sign-in step check failed:',
  );
  if (!reply) return { kind: 'failed' };
  if (reply.ok !== true || !isUuid(reply.admin_id)) return { kind: 'ended' };
  const left = Number(reply.attempts_left);
  return { kind: 'ok', adminId: reply.admin_id, attemptsLeft: Number.isFinite(left) && left > 0 ? Math.floor(left) : 0 };
}

export async function consumeChallenge(tokenHash: string, purpose: ChallengePurpose): Promise<ChallengeConsume> {
  const reply = await callRpc(
    'admin_challenge_consume',
    { p_token_hash: tokenHash, p_purpose: purpose },
    'admin sign-in step could not be finished:',
  );
  if (!reply) return { kind: 'failed' };
  if (reply.ok !== true || !Number.isInteger(reply.token_version)) return { kind: 'ended' };
  return { kind: 'ok', tokenVersion: reply.token_version as number };
}

export async function signInStepEnded(): Promise<NextResponse> {
  const res = await fail('AUTH_REQUIRED', STEP_ENDED, { details: { reason: STEP_ENDED_REASON } });
  clearChallengeCookie(res);
  return res;
}

async function revokeIncomplete(adminId: string, sessionId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('admin_session_revoke', {
      p_admin_id: adminId,
      p_sid: sessionId,
      p_actor: adminId,
      p_reason: 'sign_in_incomplete',
    });
    if (error) console.error('admin incomplete session revoke failed:', error.message);
  } catch (error) {
    console.error('admin incomplete session revoke failed:', errorText(error));
  }
}

export async function openWebSession(
  admin: SignInAdmin,
  methods: readonly AuthMethod[],
  expectedTokenVersion: number,
  meta: RequestMeta,
  sign: SessionSigner,
): Promise<WebSessionOpen> {
  const reply = await callRpc(
    'admin_session_open',
    {
      p_admin_id: admin.id,
      p_client: 'web',
      p_auth_methods: [...methods],
      p_ttl_seconds: WEB_SESSION_SECONDS,
      p_expected_token_version: expectedTokenVersion,
      p_ip: storedIp(meta.ip),
      p_user_agent: meta.user_agent || null,
    },
    'admin session open failed:',
  );
  if (!reply) return { kind: 'failed' };
  if (reply.ok !== true) return { kind: 'refused', reason: typeof reply.reason === 'string' ? reply.reason : 'unknown' };

  const sessionId = reply.session_id;
  const tokenVersion = reply.token_version;
  const epoch = typeof reply.expires_at_epoch === 'number' ? reply.expires_at_epoch : Number.NaN;
  const expiresAt = textOrNull(reply.expires_at);
  if (!isUuid(sessionId) || !Number.isInteger(tokenVersion) || !Number.isInteger(epoch) || expiresAt === null) {
    console.error('admin session open failed:', 'the new session was not described');
    return { kind: 'failed' };
  }
  const amr = normalizeAuthMethods(reply.auth_methods);
  try {
    const token = await sign(
      {
        id: admin.id,
        username: admin.username,
        role_title: admin.role_title,
        is_super_admin: admin.is_super_admin === true,
        page_permissions: admin.page_permissions || [],
        token_version: tokenVersion as number,
      },
      sessionId,
      amr,
      epoch,
    );
    return { kind: 'ok', sessionId, token, tokenVersion: tokenVersion as number, expiresAt, amr };
  } catch (error) {
    console.error('admin session signing failed:', errorText(error));
    await revokeIncomplete(admin.id, sessionId);
    return { kind: 'failed' };
  }
}

export async function signedIn(
  admin: SignInAdmin,
  opened: OpenedSession,
  actor: AuditActor,
  extra: Record<string, unknown> = {},
  endsChallenge = false,
): Promise<NextResponse> {
  await writeAudit({
    admin: actor,
    action: 'LOGIN',
    entity: ENTITY,
    entity_id: admin.id,
    after: { client: 'web', amr: opened.amr, session_id: opened.sessionId },
    result: 'success',
    sensitivity: 'security',
  });
  const res = await ok({ step: 'done', ...extra }, { headers: { ...NO_STORE } });
  setSessionCookie(res, opened.token, opened.expiresAt);
  setThemeCookie(res, themePreference(admin.theme_preference));
  if (endsChallenge) clearChallengeCookie(res);
  return res;
}
