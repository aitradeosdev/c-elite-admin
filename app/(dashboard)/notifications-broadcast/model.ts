import type { ApiBody, ApiFailure, ApiResult } from '../../lib/apiClient';
import { permissionLabel } from '../../lib/permissions';
import {
  DEFAULT_TYPE, HISTORY_PAGE_SIZE, MESSAGE_LIMIT, SEND_TIMEOUT_MS, TITLE_LIMIT, cleanText, isRecord, readSendCounts,
  type Audience, type BroadcastType, type GlobalValues, type SendCounts,
} from './broadcastRules';

export interface BroadcastRow {
  id: string;
  title: string;
  message: string;
  type: string;
  audience: string;
  targetUserId: string | null;
  recipients: number;
  delivered: number;
  failed: number;
  sentAt: string | null;
}

export interface HistoryPage {
  rows: BroadcastRow[];
  total: number;
  page: number;
  pageSize: number;
  globals: GlobalValues | null;
}

export interface RecipientCount {
  total: number;
  accounts: number;
  anonymousDevices: number;
}

export interface UserHit {
  id: string;
  fullName: string | null;
  username: string | null;
  email: string | null;
  active: boolean;
  deleted: boolean;
  pushEnabled: boolean;
}

export interface SendResult extends SendCounts {
  auditWarning: string | null;
}

export type SendOutcome =
  | { kind: 'sent'; result: SendResult; requestId: string | null }
  | { kind: 'unknown'; message: string; requestId: string | null }
  | { kind: 'not_sent'; message: string; requestId: string | null }
  | { kind: 'duplicate'; message: string; requestId: string | null; firstSentAt: string | null }
  | { kind: 'refused'; message: string; status: number | null; requestId: string | null }
  | { kind: 'expired' }
  | { kind: 'retry'; message: string };

export interface Draft {
  audience: Audience | null;
  type: BroadcastType;
  title: string;
  message: string;
  user: UserHit | null;
}

export const EMPTY_DRAFT: Draft = { audience: null, type: DEFAULT_TYPE, title: '', message: '', user: null };

export type DraftField = 'audience' | 'user' | 'title' | 'message';

export const DRAFT_FIELDS: readonly DraftField[] = ['audience', 'user', 'title', 'message'];

export type DraftErrors = Partial<Record<DraftField, string>>;

export type TextField = 'title' | 'message';

export interface TextSelection {
  start: number;
  end: number;
}

export interface Insertion {
  text: string;
  caret: number;
}

export interface AudienceAccess {
  send: boolean;
  sendAll: boolean;
  search: boolean;
}

const AUDIT_WARNING = 'The broadcast was sent, but it could not be written to the audit log.';

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function count(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function toBroadcastRow(raw: unknown): BroadcastRow | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (!id) return null;
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    message: typeof raw.message === 'string' ? raw.message : '',
    type: text(raw.type) ?? DEFAULT_TYPE,
    audience: text(raw.audience) ?? '',
    targetUserId: text(raw.target_user_id),
    recipients: count(raw.recipient_count) ?? 0,
    delivered: count(raw.delivered_count) ?? 0,
    failed: count(raw.failed_count) ?? 0,
    sentAt: text(raw.sent_at),
  };
}

function toGlobals(raw: unknown): GlobalValues | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function toHistoryPage(body: ApiBody): HistoryPage | null {
  if (!Array.isArray(body.broadcasts)) return null;
  const rows = body.broadcasts.map(toBroadcastRow).filter((row): row is BroadcastRow => row !== null);
  const pagination = isRecord(body.pagination) ? body.pagination : null;
  const page = Math.max(1, count(pagination?.page) ?? 1);
  const pageSize = Math.max(1, count(pagination?.page_size) ?? HISTORY_PAGE_SIZE);
  const total = count(pagination?.total) ?? (page - 1) * pageSize + rows.length;
  return { rows, total, page, pageSize, globals: toGlobals(body.variables) };
}

export function toRecipientCount(body: ApiBody): RecipientCount | null {
  const total = count(body.count);
  if (total === null) return null;
  const accounts = Math.min(total, count(body.accounts) ?? total);
  const anonymousDevices = count(body.anonymous_devices) ?? total - accounts;
  return { total, accounts, anonymousDevices };
}

function toUserHit(raw: unknown): UserHit | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (!id) return null;
  return {
    id,
    fullName: text(raw.full_name),
    username: text(raw.username),
    email: text(raw.email),
    active: raw.is_active !== false,
    deleted: text(raw.deleted_at) !== null,
    pushEnabled: raw.push_notifications_enabled !== false,
  };
}

export function toUserHits(body: ApiBody): UserHit[] | null {
  if (!Array.isArray(body.users)) return null;
  return body.users.map(toUserHit).filter((hit): hit is UserHit => hit !== null);
}

export function userName(user: UserHit): string {
  return user.fullName ?? (user.username ? `@${user.username}` : user.email ?? 'Unnamed user');
}

export function userLine(user: UserHit): string {
  const parts = [user.username ? `@${user.username}` : null, user.email].filter((part): part is string => Boolean(part));
  return parts.join(' · ');
}

export function userSummary(user: UserHit): string {
  const line = userLine(user);
  const name = userName(user);
  return line && line !== name ? `${name} · ${line}` : name;
}

export function toSendResult(body: ApiBody): SendResult {
  return {
    ...readSendCounts(body),
    auditWarning: body.audit_recorded === false ? text(body.warning) ?? AUDIT_WARNING : null,
  };
}

function unknownMessage(failure: ApiFailure): string {
  const tail = 'Check the broadcast history before you send it again.';
  switch (failure.kind) {
    case 'timeout':
      return `The server did not answer within ${Math.round(SEND_TIMEOUT_MS / 1000)} seconds, so the broadcast may or may not have gone out. ${tail}`;
    case 'network':
    case 'aborted':
      return `The connection dropped before the server answered, so the broadcast may or may not have gone out. ${tail}`;
    case 'parse':
      return `The server’s reply could not be read, so the broadcast may or may not have gone out. ${tail}`;
    default:
      return failure.status
        ? `The server returned an error (HTTP ${failure.status}) before confirming, so the broadcast may or may not have gone out. ${tail}`
        : `No clear answer came back, so the broadcast may or may not have gone out. ${tail}`;
  }
}

function detail(failure: ApiFailure, key: string): unknown {
  return isRecord(failure.details) ? failure.details[key] : undefined;
}

export function classifySend(result: ApiResult<SendResult>): SendOutcome {
  if (result.ok) return { kind: 'sent', result: result.data, requestId: result.requestId };
  const failure = result.error;
  const requestId = failure.requestId;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: unknownMessage(failure), requestId };
  if (failure.code === 'PROVIDER_ERROR') {
    return detail(failure, 'outcome') === 'not_sent'
      ? { kind: 'not_sent', message: failure.message, requestId }
      : { kind: 'unknown', message: failure.message, requestId };
  }
  if (failure.code === 'IDEMPOTENCY_CONFLICT') {
    return { kind: 'duplicate', message: failure.message, requestId, firstSentAt: text(detail(failure, 'first_sent_at')) };
  }
  if (failure.status !== null && failure.status >= 400 && failure.status < 500 && failure.status !== 429) {
    return { kind: 'refused', message: failure.message, status: failure.status, requestId };
  }
  return { kind: 'retry', message: failure.message };
}

export function draftErrors(draft: Draft): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.audience) errors.audience = 'Choose who receives this broadcast.';
  if (draft.audience === 'specific' && !draft.user) errors.user = 'Find and choose the user to send to.';
  const title = cleanText(draft.title);
  const message = cleanText(draft.message);
  if (!title) errors.title = 'Add a title.';
  else if (title.length > TITLE_LIMIT) errors.title = `Keep the title to ${TITLE_LIMIT} characters or fewer.`;
  if (!message) errors.message = 'Add a message.';
  else if (message.length > MESSAGE_LIMIT) errors.message = `Keep the message to ${MESSAGE_LIMIT} characters or fewer.`;
  return errors;
}

export function firstError(errors: DraftErrors): DraftField | null {
  return DRAFT_FIELDS.find((field) => errors[field] !== undefined) ?? null;
}

export function draftDirty(draft: Draft): boolean {
  return draft.title.trim() !== '' || draft.message.trim() !== '' || draft.user !== null;
}

export function sameDraft(draft: Draft, audience: Audience, title: string, message: string, userId: string | null): boolean {
  return draft.audience === audience
    && cleanText(draft.title) === title
    && cleanText(draft.message) === message
    && (draft.user?.id ?? null) === userId;
}

export function availableAudiences(access: AudienceAccess): Audience[] {
  const out: Audience[] = [];
  if (access.sendAll) out.push('all', 'all_anon');
  if (access.send) out.push('active_7d', 'inactive');
  if (access.send && access.search) out.push('specific');
  return out;
}

export function audienceHelp(access: AudienceAccess): string | undefined {
  const notes: string[] = [];
  if (!access.sendAll) {
    notes.push(`Sending to all users needs the “${permissionLabel('communications.send_all')}” permission.`);
  }
  if (!access.send) {
    notes.push(`Sending to a segment or to one user needs the “${permissionLabel('communications.send')}” permission.`);
  } else if (!access.search) {
    notes.push(`Sending to one user also needs the “${permissionLabel('users.read')}” permission, to find them.`);
  }
  return notes.length > 0 ? notes.join(' ') : undefined;
}

export function insertVariable(value: string, selection: TextSelection | null, token: string, limit: number): Insertion | null {
  const insert = `{${token}}`;
  const start = Math.min(Math.max(selection?.start ?? value.length, 0), value.length);
  const end = Math.min(Math.max(selection?.end ?? start, start), value.length);
  const next = value.slice(0, start) + insert + value.slice(end);
  if (next.length > limit) return null;
  return { text: next, caret: start + insert.length };
}

export function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-NG');
}

export function plural(value: number, one: string, many: string): string {
  return `${formatCount(value)} ${value === 1 ? one : many}`;
}

export function recipientsText(audience: Audience, recipients: RecipientCount | null): string {
  if (audience === 'specific') return '1 user';
  if (!recipients) return '—';
  const accounts = plural(recipients.accounts, 'account', 'accounts');
  if (audience !== 'all_anon') return accounts;
  return `${accounts} and ${plural(recipients.anonymousDevices, 'app-only device', 'app-only devices')}`;
}

export function shortfall(expected: RecipientCount | null, result: SendCounts): number {
  if (!expected) return 0;
  return Math.max(0, expected.accounts - result.recipients);
}

export interface SendPlan {
  audience: Audience;
  type: BroadcastType;
  title: string;
  message: string;
  user: UserHit | null;
  recipients: RecipientCount;
  globals: GlobalValues | null;
  allowDuplicate: boolean;
}

export function sendBody(plan: SendPlan): Record<string, unknown> {
  return {
    title: plan.title,
    message: plan.message,
    type: plan.type,
    audience: plan.audience,
    target_user_id: plan.audience === 'specific' ? plan.user?.id ?? null : null,
    ...(plan.allowDuplicate ? { allow_duplicate: true } : {}),
  };
}

export interface OutcomeContext {
  audience: Audience;
  title: string;
  message: string;
  userId: string | null;
  userLabel: string | null;
  recipients: RecipientCount;
}

export function planContext(plan: SendPlan): OutcomeContext {
  const user = plan.audience === 'specific' ? plan.user : null;
  return {
    audience: plan.audience,
    title: plan.title,
    message: plan.message,
    userId: user?.id ?? null,
    userLabel: user ? userName(user) : null,
    recipients: plan.recipients,
  };
}

export type FinalSendOutcome = Exclude<SendOutcome, { kind: 'expired' } | { kind: 'retry' }>;

export type Outcome = FinalSendOutcome & { context: OutcomeContext; at: number };

export type OutcomeTone = 'success' | 'warning' | 'danger';

export interface OutcomeSummary {
  tone: OutcomeTone;
  title: string;
  lines: string[];
}

function sentSummary(result: SendResult, context: OutcomeContext): OutcomeSummary {
  const lines: string[] = [];
  let tone: OutcomeTone = 'success';
  const reach = context.audience === 'specific'
    ? context.userLabel ?? '1 user'
    : plural(result.recipients, 'account', 'accounts');
  lines.push(`In the app: ${plural(result.recipients, 'account', 'accounts')}.`);
  lines.push(
    result.delivered + result.failed === 0
      ? 'Push: none sent.'
      : `Push: ${formatCount(result.delivered)} accepted by the push service, ${formatCount(result.failed)} failed.`,
  );
  if (context.audience === 'all_anon') {
    lines.push(
      `App-only devices: ${formatCount(result.anonymousDelivered)} accepted and ${formatCount(result.anonymousFailed)} failed, of ${formatCount(result.anonymousRecipients)}.`,
    );
  }
  if (result.failed + result.anonymousFailed > 0) {
    lines.push('Devices that have uninstalled the app are removed from future sends automatically.');
  }
  const missing = shortfall(context.recipients, result);
  if (missing > 0) {
    tone = 'warning';
    lines.push(
      `When you confirmed, ${plural(context.recipients.accounts, 'account', 'accounts')} matched this audience, but the service reported ${formatCount(result.recipients)}. Some users may not have received it.`,
    );
  }
  if (result.recipients === 0 && context.audience !== 'specific') {
    tone = 'warning';
    lines.push('Nobody matched this audience when the service ran, so nothing was delivered.');
  }
  if (result.auditWarning) {
    tone = 'warning';
    lines.push(result.auditWarning);
  }
  return { tone, title: `Sent to ${reach}`, lines };
}

export function outcomeSummary(outcome: Outcome): OutcomeSummary {
  switch (outcome.kind) {
    case 'sent':
      return sentSummary(outcome.result, outcome.context);
    case 'unknown':
      return { tone: 'danger', title: 'Outcome unknown: the broadcast may have gone out', lines: [outcome.message] };
    case 'duplicate':
      return { tone: 'warning', title: 'Not sent: this looks like a repeat', lines: [outcome.message] };
    case 'not_sent':
    case 'refused':
      return { tone: 'danger', title: 'Not sent', lines: [outcome.message] };
  }
}

export function outcomeToast(outcome: Outcome): { text: string; tone: 'success' | 'warning' | 'error' } {
  switch (outcome.kind) {
    case 'sent': {
      const summary = sentSummary(outcome.result, outcome.context);
      return { text: `Broadcast sent. ${summary.title}.`, tone: summary.tone === 'success' ? 'success' : 'warning' };
    }
    case 'duplicate':
      return { text: 'Not sent: an identical broadcast went to this audience a few minutes ago.', tone: 'warning' };
    case 'unknown':
      return { text: 'The broadcast may or may not have gone out. Check the history before sending it again.', tone: 'error' };
    case 'not_sent':
    case 'refused':
      return { text: outcome.message, tone: 'error' };
  }
}

export function leavePath(href: string, current: string): string | null {
  let here: URL;
  let target: URL;
  try {
    here = new URL(current);
    target = new URL(href, here);
  } catch {
    return null;
  }
  if (target.origin !== here.origin) return null;
  if (target.pathname === here.pathname && target.search === here.search) return null;
  return `${target.pathname}${target.search}${target.hash}`;
}
