import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { supabaseAdmin } from './supabase';
import { isUuid } from './http';
import {
  SESSION_COOKIE,
  SessionUnavailableError,
  normalizeAuthMethods,
  type AuthMethod,
  type MfaState,
  type PolicyState,
  type SecurityState,
  type SessionClient,
  type SessionInfo,
  type SessionTokenAdmin,
  type SessionTransport,
} from './session';

export type { AuthMethod, MfaState, PolicyState, SecurityState, SessionInfo, SessionTransport } from './session';

export interface AdminJWTPayload {
  admin_id: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  username: string;
  token_version: number;
  sid?: string;
  amr?: AuthMethod[];
}

export interface VerifiedAdmin extends AdminJWTPayload, Partial<SecurityState> {}

export type SessionCheck =
  | ({ status: 'ok'; claims: AdminJWTPayload } & SecurityState)
  | { status: 'invalid' }
  | { status: 'unavailable' };

export interface PresentedToken {
  token: string;
  transport: SessionTransport;
}

interface TokenClaims {
  admin_id: string;
  token_version: number;
  sid: string | null;
  amr: AuthMethod[] | null;
}

type TokenRead = { kind: 'claims'; claims: TokenClaims } | { kind: 'invalid' } | { kind: 'unavailable' };

const ALGORITHMS = ['HS256'];
const BEARER = /^Bearer(?:\s+|$)/i;
const INVALID: SessionCheck = { status: 'invalid' };
const UNAVAILABLE: SessionCheck = { status: 'unavailable' };
const CLIENT_FOR: Readonly<Record<SessionTransport, SessionClient>> = { cookie: 'web', bearer: 'mobile' };

function jwtKey(): Uint8Array {
  return new TextEncoder().encode(process.env.ADMIN_JWT_SECRET ?? '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function signAdminJWT(payload: AdminJWTPayload, expiresAt: Date): Promise<string> {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  if (!Number.isFinite(exp)) throw new TypeError('The session expiry is not a valid time');
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(jwtKey());
}

export function signSessionToken(
  admin: SessionTokenAdmin,
  sid: string,
  amr: readonly AuthMethod[],
  expiresAtEpoch: number,
): Promise<string> {
  if (!isUuid(sid)) throw new TypeError('The session id must be a uuid');
  if (!Number.isFinite(expiresAtEpoch)) throw new TypeError('The session expiry is not a valid time');
  return signAdminJWT({
    admin_id: admin.id,
    role_title: admin.role_title,
    is_super_admin: admin.is_super_admin,
    page_permissions: [...admin.page_permissions],
    username: admin.username,
    token_version: admin.token_version,
    sid,
    amr: normalizeAuthMethods(amr),
  }, new Date(expiresAtEpoch * 1000));
}

async function readToken(token: string): Promise<TokenRead> {
  const key = jwtKey();
  if (key.length === 0) {
    console.error('admin session check failed:', 'ADMIN_JWT_SECRET is not set');
    return { kind: 'unavailable' };
  }
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key, { algorithms: ALGORITHMS, requiredClaims: ['exp'] }));
  } catch {
    return { kind: 'invalid' };
  }
  const tokenVersion = payload.token_version;
  if (!isUuid(payload.admin_id) || typeof tokenVersion !== 'number' || !Number.isInteger(tokenVersion)) {
    return { kind: 'invalid' };
  }
  const hasSid = Object.prototype.hasOwnProperty.call(payload, 'sid');
  if (hasSid && !isUuid(payload.sid)) return { kind: 'invalid' };
  return {
    kind: 'claims',
    claims: {
      admin_id: payload.admin_id,
      token_version: tokenVersion,
      sid: hasSid ? (payload.sid as string) : null,
      amr: Array.isArray(payload.amr) ? normalizeAuthMethods(payload.amr) : null,
    },
  };
}

function readMfa(value: unknown): MfaState {
  const raw = isRecord(value) ? value : {};
  const status = raw.status === 'active' || raw.status === 'pending' ? raw.status : 'none';
  return { status, lockedUntil: typeof raw.locked_until === 'string' ? raw.locked_until : null };
}

function readPolicy(value: unknown): PolicyState {
  const raw = isRecord(value) ? value : {};
  return {
    mode: raw.mfa_mode === 'all' ? 'all' : 'off',
    graceEndsAt: typeof raw.mfa_grace_ends_at === 'string' ? raw.mfa_grace_ends_at : null,
    requiredNow: raw.mfa_required_now === true,
  };
}

async function authState(claims: TokenClaims): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_auth_state', { p_admin_id: claims.admin_id, p_sid: claims.sid });
    if (error) {
      console.error('admin session check failed:', error.message);
      return null;
    }
    if (!isRecord(data)) {
      console.error('admin session check failed:', 'no state was returned');
      return null;
    }
    return data;
  } catch (error) {
    console.error('admin session check failed:', errorText(error));
    return null;
  }
}

async function checkSession(token: string, transport: SessionTransport | null): Promise<SessionCheck> {
  const read = await readToken(token);
  if (read.kind !== 'claims') return read.kind === 'invalid' ? INVALID : UNAVAILABLE;
  const { claims } = read;

  const state = await authState(claims);
  if (!state) return UNAVAILABLE;
  const admin = isRecord(state.admin) ? state.admin : null;
  if (!admin || typeof admin.id !== 'string') return INVALID;
  const currentVersion = typeof admin.token_version === 'number' ? admin.token_version : 0;
  if (claims.token_version !== currentVersion) return INVALID;

  const mfa = readMfa(state.mfa);
  let session: SessionInfo | null = null;
  if (claims.sid !== null) {
    const raw = isRecord(state.session) ? state.session : null;
    if (!raw || raw.status !== 'active') return INVALID;
    const client = raw.client === 'web' || raw.client === 'mobile' ? raw.client : null;
    if (client === null || (transport !== null && client !== CLIENT_FOR[transport])) return INVALID;
    if (typeof raw.created_at !== 'string' || typeof raw.expires_at !== 'string') {
      console.error('admin session check failed:', 'the session was not described');
      return UNAVAILABLE;
    }
    session = {
      id: claims.sid,
      client,
      amr: normalizeAuthMethods(raw.auth_methods),
      createdAt: raw.created_at,
      expiresAt: raw.expires_at,
      reauthAt: typeof raw.reauth_at === 'string' ? raw.reauth_at : null,
      transport: transport ?? (client === 'web' ? 'cookie' : 'bearer'),
    };
  } else if (mfa.status === 'active') {
    return INVALID;
  }

  const verified: AdminJWTPayload = {
    admin_id: admin.id,
    role_title: typeof admin.role_title === 'string' ? admin.role_title : '',
    is_super_admin: admin.is_super_admin === true,
    page_permissions: Array.isArray(admin.page_permissions)
      ? admin.page_permissions.filter((item): item is string => typeof item === 'string')
      : [],
    username: typeof admin.username === 'string' ? admin.username : '',
    token_version: currentVersion,
  };
  if (claims.sid !== null) verified.sid = claims.sid;
  const amr = session ? session.amr : claims.amr;
  if (amr) verified.amr = amr;

  return { status: 'ok', claims: verified, session, mfa, policy: readPolicy(state.policy) };
}

export function verifyAdminSession(token: string, transport: SessionTransport): Promise<SessionCheck> {
  return checkSession(token, transport);
}

export async function verifyAdminJWT(token: string, transport?: SessionTransport): Promise<AdminJWTPayload | null> {
  const check = await checkSession(token, transport ?? null);
  return check.status === 'ok' ? check.claims : null;
}

export async function sessionTokenFromRequest(): Promise<PresentedToken> {
  const h = await headers();
  const authorization = h.get('authorization') ?? '';
  if (h.get('x-client') === 'mobile-admin' && BEARER.test(authorization)) {
    return { token: authorization.replace(BEARER, '').trim(), transport: 'bearer' };
  }
  return { token: (await cookies()).get(SESSION_COOKIE)?.value ?? '', transport: 'cookie' };
}

export async function verifyAdminFromRequest(): Promise<VerifiedAdmin | null> {
  const { token, transport } = await sessionTokenFromRequest();
  if (!token) return null;

  const check = await checkSession(token, transport);
  if (check.status === 'unavailable') throw new SessionUnavailableError();
  if (check.status === 'invalid') return null;
  return { ...check.claims, session: check.session, mfa: check.mfa, policy: check.policy };
}
