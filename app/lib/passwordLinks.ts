import { supabaseAdmin } from './supabase';
import { callEdgeFunction } from './edge';
import { hashChallengeToken, newChallengeToken } from './mfa';
import { BUSINESS_TZ_LABEL, formatBusinessDateTime } from './time';

export type LinkPurpose = 'invite' | 'reset';
export type SendOutcome = 'sent' | 'not_sent' | 'unknown';

export interface LinkSend {
  outcome: SendOutcome;
  reason: string | null;
}

export interface LinkIssue extends LinkSend {
  expiresAt: string | null;
}

export interface LinkEmail {
  purpose: LinkPurpose;
  token: string;
  email: string;
  username: string;
  expiresAt: string;
  inviter?: string | null;
}

export interface LinkRequest {
  adminId: string;
  purpose: LinkPurpose;
  inviter?: string | null;
}

export interface CheckedLink {
  adminId: string;
  purpose: LinkPurpose;
  username: string;
  email: string;
  roleTitle: string;
  expiresAt: string;
}

export type LinkCheck = { kind: 'valid'; link: CheckedLink } | { kind: 'invalid' } | { kind: 'failed' };

export const SET_PASSWORD_PATH = '/set-password';
export const LINK_INVALID = 'This link has expired, was already used, or was replaced by a newer one.';

const SEND_TIMEOUT_MS = 15000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UNSAFE_URL_CHARACTERS = /[&"]/;
const TEMPLATE_KEYS: Readonly<Record<LinkPurpose, string>> = {
  invite: 'admin_invite',
  reset: 'admin_password_reset',
};
const SMTP_NOT_CONFIGURED = 'SMTP not configured';
const UNAVAILABLE = 'unavailable';
const MISCONFIGURED = 'misconfigured';
const NO_INVITER = 'A super admin';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function consoleBaseUrl(): string | null {
  const raw = (process.env.ADMIN_CONSOLE_URL || '').trim().replace(/\/+$/, '');
  if (!raw || UNSAFE_URL_CHARACTERS.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
  return secure && url.href === `${url.origin}/` ? url.origin : null;
}

function edgeConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL) && Boolean(process.env.ADMIN_FUNCTION_SECRET);
}

export function linksConfigured(): boolean {
  return consoleBaseUrl() !== null && edgeConfigured();
}

export function isLinkToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function mintLinkToken(): { token: string; tokenHash: string } {
  const { token, hash } = newChallengeToken();
  return { token, tokenHash: hash };
}

function expiryText(expiresAt: string): string {
  return `${formatBusinessDateTime(expiresAt)} ${BUSINESS_TZ_LABEL}`;
}

function detailOf(body: Record<string, unknown> | null): string {
  const raw = body ? body.message ?? body.error : null;
  return typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
}

function classifySend(status: number, body: unknown): LinkSend {
  const record = isRecord(body) ? body : null;
  const detail = detailOf(record);
  if (status >= 200 && status < 300) {
    return record?.success === true ? { outcome: 'sent', reason: null } : { outcome: 'unknown', reason: 'unreadable' };
  }
  if (status >= 400 && status < 500) return { outcome: 'not_sent', reason: detail || `HTTP ${status}` };
  if (status === 500 && detail === SMTP_NOT_CONFIGURED) return { outcome: 'not_sent', reason: SMTP_NOT_CONFIGURED };
  return { outcome: 'unknown', reason: detail || `HTTP ${status}` };
}

function failureReason(error: unknown): string {
  const name = isRecord(error) ? error.name : undefined;
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
}

async function sendEmail(to: string, templateKey: string, vars: Record<string, string>): Promise<LinkSend> {
  const answer = await callEdgeFunction('send-email', { to, template_key: templateKey, vars }, SEND_TIMEOUT_MS);
  if (answer.kind === 'failed') return { outcome: 'unknown', reason: failureReason(answer.error) };
  return classifySend(answer.status, answer.body);
}

export async function sendLinkEmail(input: LinkEmail): Promise<LinkSend> {
  const base = consoleBaseUrl();
  if (base === null || !edgeConfigured()) return { outcome: 'not_sent', reason: MISCONFIGURED };
  const vars: Record<string, string> = {
    username: input.username,
    link: `${base}${SET_PASSWORD_PATH}#${input.token}`,
    expires_at: expiryText(input.expiresAt),
  };
  if (input.purpose === 'invite') vars.inviter = input.inviter ? `@${input.inviter}` : NO_INVITER;
  return sendEmail(input.email, TEMPLATE_KEYS[input.purpose], vars);
}

async function linkRpc(name: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc(name, args);
    if (error) {
      console.error(`${name} failed:`, error.message);
      return null;
    }
    if (isRecord(data)) return data;
    console.error(`${name} failed:`, 'no result');
    return null;
  } catch (error) {
    console.error(`${name} failed:`, errorText(error));
    return null;
  }
}

function notIssued(reason: string): LinkIssue {
  return { outcome: 'not_sent', reason, expiresAt: null };
}

export async function issueAndSend({ adminId, purpose, inviter }: LinkRequest): Promise<LinkIssue> {
  const { token, tokenHash } = mintLinkToken();
  const issued = await linkRpc('admin_password_link_issue', {
    p_admin_id: adminId,
    p_purpose: purpose,
    p_token_hash: tokenHash,
  });
  if (!issued) return notIssued(UNAVAILABLE);
  if (issued.ok !== true) {
    return notIssued(typeof issued.reason === 'string' && issued.reason !== '' ? issued.reason : UNAVAILABLE);
  }
  const expiresAt = textOf(issued.expires_at);
  const email = textOf(issued.email);
  const username = textOf(issued.username);
  if (!expiresAt || !email || !username) {
    console.error('admin_password_link_issue failed:', 'incomplete result');
    return notIssued(UNAVAILABLE);
  }
  const sent = await sendLinkEmail({ purpose, token, email, username, expiresAt, inviter });
  return { ...sent, expiresAt };
}

export async function checkLink(token: string): Promise<LinkCheck> {
  const checked = await linkRpc('admin_password_link_check', { p_token_hash: hashChallengeToken(token) });
  if (!checked) return { kind: 'failed' };
  if (checked.ok !== true) return { kind: 'invalid' };
  const adminId = textOf(checked.admin_id);
  const purpose: LinkPurpose | null = checked.purpose === 'invite' ? 'invite' : checked.purpose === 'reset' ? 'reset' : null;
  if (!adminId || !purpose) {
    console.error('admin_password_link_check failed:', 'unreadable result');
    return { kind: 'failed' };
  }
  return {
    kind: 'valid',
    link: {
      adminId,
      purpose,
      username: textOf(checked.username),
      email: textOf(checked.email),
      roleTitle: textOf(checked.role_title),
      expiresAt: textOf(checked.expires_at),
    },
  };
}
