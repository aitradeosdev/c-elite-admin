import { SignJWT } from 'jose';
import { epochSeconds, type SessionInfo } from './session';
import type { Permission } from './permissions';

export type RealtimeTopicKey = 'withdrawals' | 'cards';
export type RealtimeTopic = 'admin:withdrawals' | 'admin:cards';

export interface RealtimeTopicGrant {
  readonly key: RealtimeTopicKey;
  readonly topic: RealtimeTopic;
  readonly permission: Permission;
}

export interface RealtimeSettings {
  url: string;
  key: string;
  secret: string;
}

export interface PassTimes {
  issuedAt: number;
  expiresAt: number;
}

export const PASS_ROLE = 'admin_console_realtime';
export const PASS_APP = 'cardelite-admin';
export const PASS_LIFETIME_SECONDS = 300;
export const PASS_MIN_SECONDS = 30;

export const REALTIME_TOPICS: readonly RealtimeTopicGrant[] = [
  { key: 'withdrawals', topic: 'admin:withdrawals', permission: 'withdrawals.read' },
  { key: 'cards', topic: 'admin:cards', permission: 'cards.read' },
];

export const PASS_PERMISSIONS: readonly Permission[] = REALTIME_TOPICS.map((grant) => grant.permission);

function granted(can: (permission: Permission) => boolean): RealtimeTopicGrant[] {
  return REALTIME_TOPICS.filter((grant) => can(grant.permission));
}

export function realtimeTopicKeys(can: (permission: Permission) => boolean): RealtimeTopicKey[] {
  return granted(can).map((grant) => grant.key);
}

export function passTopics(can: (permission: Permission) => boolean): RealtimeTopic[] {
  return granted(can).map((grant) => grant.topic);
}

export function realtimeSettings(): RealtimeSettings | null {
  const url = (process.env.SUPABASE_URL ?? '').trim();
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  const secret = (process.env.SUPABASE_REALTIME_JWT_SECRET ?? '').trim();
  return url && key && secret ? { url, key, secret } : null;
}

export function isWebSession(session: Pick<SessionInfo, 'client' | 'transport'>): boolean {
  return session.client === 'web' && session.transport === 'cookie';
}

export function passTimes(nowMs: number, sessionExpiresAt: string): PassTimes | null {
  const issuedAt = Math.floor(nowMs / 1000);
  const sessionEnd = epochSeconds(sessionExpiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(sessionEnd)) return null;
  const expiresAt = Math.min(issuedAt + PASS_LIFETIME_SECONDS, sessionEnd);
  return expiresAt - issuedAt < PASS_MIN_SECONDS ? null : { issuedAt, expiresAt };
}

export async function signRealtimePass(secret: string, topics: readonly RealtimeTopic[], times: PassTimes): Promise<string> {
  return new SignJWT({ role: PASS_ROLE, app: PASS_APP, topics: [...topics] })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(times.issuedAt)
    .setExpirationTime(times.expiresAt)
    .sign(new TextEncoder().encode(secret));
}
