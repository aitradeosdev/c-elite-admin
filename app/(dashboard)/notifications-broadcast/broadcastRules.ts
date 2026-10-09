import { isUuid } from '../../lib/http';
import { permissionLabel, type Permission } from '../../lib/permissions';
import { BUSINESS_TZ_LABEL, formatBusinessTime } from '../../lib/time';

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

export const AUDIENCES = ['all', 'all_anon', 'active_7d', 'inactive', 'specific'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const BROADCAST_TYPES = ['general', 'promo', 'update', 'system'] as const;
export type BroadcastType = (typeof BROADCAST_TYPES)[number];

export const DEFAULT_TYPE: BroadcastType = 'general';
export const DEFAULT_COUNT_AUDIENCE: Audience = 'all';
export const TITLE_LIMIT = 120;
export const MESSAGE_LIMIT = 1000;
export const SEARCH_MIN = 3;
export const SEARCH_LIMIT = 10;
export const SEARCH_RATE_LIMIT = 60;
export const SEARCH_RATE_WINDOW_SECONDS = 60;
export const DUPLICATE_WINDOW_SECONDS = 600;
export const DUPLICATE_ACTION = 'admin_broadcast_send';
export const EDGE_TIMEOUT_MS = 50000;
export const SEND_TIMEOUT_MS = 65000;
export const HISTORY_PAGE_SIZE = 20;
export const HISTORY_MAX_PAGE_SIZE = 50;
export const SEND_ALL_PHRASE = 'SEND TO ALL';
export const SEND_AGAIN_PHRASE = 'SEND AGAIN';
export const SUBSTITUTION_LIMIT = 80;

export const READ_PERMISSION: Permission = 'communications.read';
export const SEND_PERMISSIONS: readonly Permission[] = ['communications.send', 'communications.send_all'];
export const SEARCH_PERMISSIONS: readonly Permission[] = ['communications.read', 'users.read'];

export interface AudienceMeta {
  label: string;
  description: string;
  question: string;
}

export const AUDIENCE_META: Readonly<Record<Audience, AudienceMeta>> = {
  all: {
    label: 'All users',
    description: 'Every active account gets an in-app notification, plus a push where the user allows push.',
    question: 'Send to every user?',
  },
  all_anon: {
    label: 'All users and app-only devices',
    description:
      'Everyone in All users, plus a push to devices that have the app but no account. Personal variables are left blank on those devices.',
    question: 'Send to every user and every app-only device?',
  },
  active_7d: {
    label: 'Active in the last 7 days',
    description: 'Active accounts that signed in during the last 7 days.',
    question: 'Send to users active in the last 7 days?',
  },
  inactive: {
    label: 'Not seen for 7 days',
    description: 'Active accounts that have not signed in for 7 days or more, or have never signed in.',
    question: 'Send to users not seen for 7 days?',
  },
  specific: {
    label: 'One user',
    description: 'A single user you find by name, username or email.',
    question: 'Send to this user?',
  },
};

export const TYPE_LABELS: Readonly<Record<BroadcastType, string>> = {
  general: 'General',
  promo: 'Promotion',
  update: 'Product update',
  system: 'System',
};

const AUDIENCE_SET: ReadonlySet<string> = new Set<string>(AUDIENCES);
const TYPE_SET: ReadonlySet<string> = new Set<string>(BROADCAST_TYPES);
const BIDI_CONTROLS: ReadonlySet<number> = new Set([
  0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);
const CHECK_HISTORY = 'Check the broadcast history before you send it again.';

function stripChars(text: string, drop: (code: number) => boolean): string {
  let out = '';
  for (const char of text) {
    if (!drop(char.codePointAt(0) ?? 0)) out += char;
  }
  return out;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && AUDIENCE_SET.has(value);
}

export function isBroadcastType(value: unknown): value is BroadcastType {
  return typeof value === 'string' && TYPE_SET.has(value);
}

export function reachesEveryone(audience: Audience): boolean {
  return audience === 'all' || audience === 'all_anon';
}

export function sendPermission(audience: Audience): Permission {
  return reachesEveryone(audience) ? 'communications.send_all' : 'communications.send';
}

export function audienceLabel(value: string | null | undefined): string {
  if (isAudience(value)) return AUDIENCE_META[value].label;
  const text = String(value ?? '').trim();
  return text ? text.replace(/_/g, ' ') : 'Unknown audience';
}

export function typeLabel(value: string | null | undefined): string {
  if (isBroadcastType(value)) return TYPE_LABELS[value];
  const text = String(value ?? '').trim();
  return text ? text.replace(/_/g, ' ') : TYPE_LABELS[DEFAULT_TYPE];
}

export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return stripChars(String(value), (code) => BIDI_CONTROLS.has(code)).normalize('NFKC').trim();
}

export interface BroadcastRequest {
  title: string;
  message: string;
  type: BroadcastType;
  audience: Audience;
  target_user_id: string | null;
  allow_duplicate: boolean;
}

export function readBroadcastRequest(body: unknown): Checked<BroadcastRequest> {
  if (!isRecord(body)) {
    return { ok: false, message: 'Send the broadcast as a JSON object with a title, a message and an audience.' };
  }
  const title = cleanText(body.title);
  const message = cleanText(body.message);
  const audience = body.audience;
  if (!title || !message || audience === undefined || audience === null || audience === '') {
    return { ok: false, message: 'A title, a message and an audience are all required.' };
  }
  if (title.length > TITLE_LIMIT || message.length > MESSAGE_LIMIT) {
    return {
      ok: false,
      message: `The title can be up to ${TITLE_LIMIT} characters and the message up to ${MESSAGE_LIMIT}.`,
    };
  }
  if (!isAudience(audience)) return { ok: false, message: 'That audience is not recognised.' };
  const rawType = body.type;
  if (rawType !== undefined && rawType !== null && !isBroadcastType(rawType)) {
    return { ok: false, message: 'That notification category is not recognised.' };
  }
  let target: string | null = null;
  if (audience === 'specific') {
    if (!isUuid(body.target_user_id)) return { ok: false, message: 'Choose the user to send to.' };
    target = body.target_user_id.toLowerCase();
  }
  return {
    ok: true,
    value: {
      title,
      message,
      type: isBroadcastType(rawType) ? rawType : DEFAULT_TYPE,
      audience,
      target_user_id: target,
      allow_duplicate: body.allow_duplicate === true,
    },
  };
}

export function readAudienceParam(raw: string | null | undefined): Checked<Audience> {
  const value = (raw ?? '').trim();
  if (!value) return { ok: true, value: DEFAULT_COUNT_AUDIENCE };
  return isAudience(value) ? { ok: true, value } : { ok: false, message: 'That audience is not recognised.' };
}

export function sendDeniedMessage(audience: Audience): string {
  const permission = sendPermission(audience);
  return `Sending to ${AUDIENCE_META[audience].label.toLowerCase()} needs the “${permissionLabel(permission)}” permission.`;
}

export type DuplicateSource = Pick<BroadcastRequest, 'audience' | 'target_user_id' | 'title' | 'message'>;

export function duplicateFingerprint(request: DuplicateSource): string {
  return JSON.stringify([request.audience, request.target_user_id, request.title, request.message]);
}

export async function duplicateKey(request: DuplicateSource): Promise<string> {
  const bytes = new TextEncoder().encode(duplicateFingerprint(request));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return `broadcast:${hex}`;
}

export function duplicateMessage(startedAt: string | null): string {
  const minutes = Math.round(DUPLICATE_WINDOW_SECONDS / 60);
  const time = formatBusinessTime(startedAt);
  const when = time === '—' ? '' : ` at ${time} ${BUSINESS_TZ_LABEL}`;
  return `An identical broadcast to this audience was started${when}, less than ${minutes} minutes ago, so this one was not sent. The first one may still be delivering. ${CHECK_HISTORY}`;
}

export function toCount(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export interface SendCounts {
  broadcastId: string | null;
  recipients: number;
  delivered: number;
  failed: number;
  anonymousRecipients: number;
  anonymousDelivered: number;
  anonymousFailed: number;
}

export function readSendCounts(body: Record<string, unknown>): SendCounts {
  const id = body.broadcast_id;
  return {
    broadcastId: typeof id === 'string' && id.trim() !== '' ? id : null,
    recipients: toCount(body.recipient_count),
    delivered: toCount(body.delivered),
    failed: toCount(body.failed),
    anonymousRecipients: toCount(body.anonymous_recipient_count),
    anonymousDelivered: toCount(body.anonymous_delivered),
    anonymousFailed: toCount(body.anonymous_failed),
  };
}

export type UnknownStage = 'timeout' | 'network' | 'upstream' | 'unreadable';
export type NotSentReason = 'refused' | 'misconfigured';

export type EdgeOutcome =
  | { kind: 'sent'; counts: SendCounts }
  | { kind: 'not_sent'; reason: NotSentReason; status: number | null; detail: string }
  | { kind: 'unknown'; stage: UnknownStage; status: number | null; detail: string };

function detailOf(body: Record<string, unknown> | null): string {
  const raw = body ? body.error ?? body.message : null;
  return typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
}

export function classifyEdgeResponse(status: number, body: unknown): EdgeOutcome {
  const record = isRecord(body) ? body : null;
  const detail = detailOf(record);
  if (status >= 200 && status < 300) {
    if (record && record.success === true) return { kind: 'sent', counts: readSendCounts(record) };
    return { kind: 'unknown', stage: 'unreadable', status, detail };
  }
  if (status === 401 || status === 403 || status === 404) {
    return { kind: 'not_sent', reason: 'misconfigured', status, detail };
  }
  if (status >= 400 && status < 500) return { kind: 'not_sent', reason: 'refused', status, detail };
  if (status >= 500 && /misconfigured/i.test(detail)) {
    return { kind: 'not_sent', reason: 'misconfigured', status, detail };
  }
  if (status >= 500) return { kind: 'unknown', stage: 'upstream', status, detail };
  return { kind: 'unknown', stage: 'unreadable', status, detail };
}

export function classifyEdgeFailure(error: unknown): EdgeOutcome {
  const name = isRecord(error) ? error.name : undefined;
  const timedOut = name === 'TimeoutError' || name === 'AbortError';
  const detail = error instanceof Error ? error.message.trim().slice(0, 200) : '';
  return { kind: 'unknown', stage: timedOut ? 'timeout' : 'network', status: null, detail };
}

export const NOT_CONFIGURED_MESSAGE =
  'Broadcasting is not set up correctly on the server, so nothing was sent. Ask an administrator to check the broadcast service settings.';

export function edgeOutcomeMessage(outcome: Exclude<EdgeOutcome, { kind: 'sent' }>): string {
  if (outcome.kind === 'not_sent') {
    if (outcome.reason === 'misconfigured') return NOT_CONFIGURED_MESSAGE;
    const detail = outcome.detail.replace(/[.\s]+$/, '');
    return detail
      ? `The broadcast service refused this request (${detail}), so nothing was sent.`
      : 'The broadcast service refused this request, so nothing was sent.';
  }
  switch (outcome.stage) {
    case 'timeout':
      return `The broadcast service did not answer within ${Math.round(EDGE_TIMEOUT_MS / 1000)} seconds. The send may still be running and may already have reached some or all recipients. ${CHECK_HISTORY}`;
    case 'network':
      return `The connection to the broadcast service dropped. The send may have started and may have reached some or all recipients. ${CHECK_HISTORY}`;
    case 'upstream':
      return `The broadcast service failed part-way. Some or all recipients may already have the message. ${CHECK_HISTORY}`;
    default:
      return `The broadcast service answered, but its reply could not be read. The message probably went out. ${CHECK_HISTORY}`;
  }
}

export type VariableScope = 'user' | 'config';

export interface VariableSpec {
  token: string;
  label: string;
  hint: string;
  scope: VariableScope;
  configKey?: string;
  amount?: boolean;
}

export const USER_VARIABLES: readonly VariableSpec[] = [
  { token: 'first_name', label: 'First name', hint: 'First word of the user’s name, or “there”', scope: 'user' },
  { token: 'full_name', label: 'Full name', hint: 'The user’s full name, or “there”', scope: 'user' },
  { token: 'username', label: 'Username', hint: 'The username, or “user”', scope: 'user' },
  { token: 'email', label: 'Email', hint: 'Email address, blank if missing', scope: 'user' },
  { token: 'phone', label: 'Phone', hint: 'Phone number, blank if missing', scope: 'user' },
  { token: 'country', label: 'Country', hint: 'Country, blank if missing', scope: 'user' },
  { token: 'referral_code', label: 'Referral code', hint: 'The user’s referral code, blank if missing', scope: 'user' },
  { token: 'balance', label: 'Wallet balance', hint: 'Like 12,500, with no ₦ sign', scope: 'user' },
];

export const CONFIG_VARIABLES: readonly VariableSpec[] = [
  {
    token: 'min_withdrawal',
    label: 'Minimum withdrawal',
    hint: 'Minimum withdrawal, with no ₦ sign',
    scope: 'config',
    configKey: 'min_withdrawal_amount',
    amount: true,
  },
  {
    token: 'max_withdrawal',
    label: 'Maximum withdrawal',
    hint: 'Maximum withdrawal, with no ₦ sign',
    scope: 'config',
    configKey: 'max_withdrawal_amount',
    amount: true,
  },
  {
    token: 'signup_bonus',
    label: 'Sign-up bonus',
    hint: 'Sign-up bonus, with no ₦ sign',
    scope: 'config',
    configKey: 'signup_bonus_amount',
    amount: true,
  },
  {
    token: 'referral_bonus',
    label: 'Referral bonus',
    hint: 'Bonus paid to the referrer, with no ₦ sign',
    scope: 'config',
    configKey: 'referral_referrer_bonus',
    amount: true,
  },
  {
    token: 'app_version',
    label: 'App version',
    hint: 'Current app version',
    scope: 'config',
    configKey: 'app_current_version',
    amount: false,
  },
];

export const CONFIG_KEYS: readonly string[] = CONFIG_VARIABLES.flatMap((spec) => (spec.configKey ? [spec.configKey] : []));

const VARIABLES: ReadonlyMap<string, VariableSpec> = new Map(
  [...USER_VARIABLES, ...CONFIG_VARIABLES].map((spec) => [spec.token, spec]),
);

export function variableSpec(token: string): VariableSpec | null {
  return VARIABLES.get(token) ?? null;
}

export type TemplatePart =
  | { kind: 'text'; text: string }
  | { kind: 'variable'; raw: string; token: string; spec: VariableSpec | null };

export function splitTemplate(text: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\{([^}\n]+)\}/g)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push({ kind: 'text', text: text.slice(cursor, start) });
    parts.push({ kind: 'variable', raw: match[0], token: match[1], spec: variableSpec(match[1]) });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts;
}

export function unknownVariables(...texts: string[]): string[] {
  const seen = new Set<string>();
  for (const text of texts) {
    for (const part of splitTemplate(text)) {
      if (part.kind === 'variable' && !part.spec) seen.add(part.raw);
    }
  }
  return [...seen];
}

export function usedVariables(...texts: string[]): VariableSpec[] {
  const used = new Set<string>();
  for (const text of texts) {
    for (const part of splitTemplate(text)) {
      if (part.kind === 'variable' && part.spec) used.add(part.spec.token);
    }
  }
  return [...USER_VARIABLES, ...CONFIG_VARIABLES].filter((spec) => used.has(spec.token));
}

export function sanitizeSubstitution(value: unknown): string {
  const text = String(value ?? '');
  return stripChars(text, (code) => code < 0x20 || code === 0x7f || BIDI_CONTROLS.has(code)).slice(0, SUBSTITUTION_LIMIT);
}

export function formatConfigAmount(raw: unknown): string {
  const value = raw || 0;
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

export type GlobalValues = Readonly<Record<string, string>>;

export interface ConfigRow {
  key: unknown;
  value: unknown;
}

export function globalsFromConfig(rows: readonly ConfigRow[]): GlobalValues {
  const byKey = new Map<string, unknown>();
  for (const row of rows) {
    if (typeof row.key === 'string') byKey.set(row.key, row.value);
  }
  const out: Record<string, string> = {};
  for (const spec of CONFIG_VARIABLES) {
    const raw = (spec.configKey ? byKey.get(spec.configKey) : undefined) || '';
    out[spec.token] = sanitizeSubstitution(spec.amount ? formatConfigAmount(raw) : String(raw));
  }
  return out;
}
