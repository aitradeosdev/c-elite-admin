import type { ApiBody, ApiFailure, ApiResult } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { isMaskable, maskMetadata, maskTail } from '../../lib/mask';
import { redactAudit } from '../../lib/redact';
import { sanitizeSearch } from '../../lib/sanitize';
import type { SortState, ToastTone } from '../../_ui';
import { isActionable } from '../withdrawals/model';

export type FlagStatus = 'pending_review' | 'escalated' | 'cleared' | 'rejected';
export type FlagTab = 'open' | FlagStatus | 'all';
export type FlagAction = 'clear' | 'escalate' | 'reject';
export type FlagSortKey = 'created_at' | 'amount';

export interface TabSpec {
  value: FlagTab;
  label: string;
  statuses: readonly FlagStatus[] | null;
  emptyTitle: string;
  emptyHint: string;
}

export interface FlagUser {
  id: string | null;
  username: string | null;
  full_name: string | null;
  email: string | null;
  is_frozen: boolean | null;
  freeze_reason: string | null;
}

export interface Flag {
  id: string;
  user_id: string | null;
  transaction_id: string | null;
  transaction_type: string | null;
  amount: number | string | null;
  flag_reason: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  user: FlagUser | null;
}

export type StatusCounts = Readonly<Record<FlagStatus, number | null>>;

export interface ListResult {
  flags: Flag[];
  total: number;
  counts: StatusCounts | null;
  openCount: number | null;
  types: string[] | null;
  searchCapped: boolean;
}

export interface WithdrawalSummary {
  id: string;
  status: string;
  amount: number | string | null;
  fee: number | string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  gateway: string | null;
  failure_reason: string | null;
  created_at: string | null;
}

export interface TransactionSummary {
  id: string;
  type: string | null;
  amount: number | string | null;
  status: string | null;
  reference_id: string | null;
  created_at: string | null;
  metadata: unknown;
}

export interface OtherFlag {
  id: string;
  flag_reason: string | null;
  status: string;
  created_at: string | null;
  reviewed_at: string | null;
}

export interface Reviewer {
  id: string;
  username: string | null;
}

export interface DetailPartial {
  reviewer: string | null;
  related: string | null;
  otherFlags: string | null;
}

export interface DetailResult {
  flag: Flag;
  reviewer: Reviewer | null;
  withdrawal: WithdrawalSummary | null;
  transaction: TransactionSummary | null;
  otherFlags: OtherFlag[];
  partial: DetailPartial;
}

export interface FlagsView {
  tab: FlagTab;
  search: string;
  type: string;
  range: { from: string | null; to: string | null };
  sort: SortState;
  page: number;
}

export type FlagSearch =
  | { kind: 'none' }
  | { kind: 'id'; id: string }
  | { kind: 'text'; userTerm: string; fragment: string | null };

export type ResolutionOutcome =
  | { kind: 'done'; status: string | null; warning: string | null }
  | { kind: 'unknown' }
  | { kind: 'refused'; status: number | null; message: string }
  | { kind: 'expired' };

export type ResolutionAttempt = ResolutionOutcome | { kind: 'retry'; message: string };

export interface FlagActionSpec {
  result: FlagStatus;
  button: string;
  title: string;
  lead: string;
  confirmLabel: string;
  reasonLabel: string;
  placeholder: string;
  presets: string[];
  done: string;
}

export const FLAG_STATUSES: readonly FlagStatus[] = ['pending_review', 'escalated', 'cleared', 'rejected'];
export const OPEN_STATUSES: readonly FlagStatus[] = ['pending_review', 'escalated'];
export const FLAG_SORT_KEYS: readonly FlagSortKey[] = ['created_at', 'amount'];
export const DEFAULT_SORT: SortState = { key: 'created_at', dir: 'desc' };
export const DEFAULT_TAB: FlagTab = 'open';
export const PAGE_SIZE = 50;
export const SEARCH_MAX = 64;
export const SEARCH_USER_CAP = 100;
export const REASON_MAX = 500;

export const REVIEW_ONLY_TITLE = 'Resolving a flag only records the review';
export const REVIEW_ONLY_BODY = 'It never approves, pays, holds or refunds anything.';
export const REVIEW_ONLY = `${REVIEW_ONLY_TITLE}. ${REVIEW_ONLY_BODY}`;
export const DECIDE_IN_WITHDRAWALS =
  'To pay or stop the payout, open the withdrawal: approving or rejecting it there runs the frozen-account and emergency-mode checks and resolves this flag automatically.';
export const VIEW_ONLY =
  'You can view this flag, but clearing, escalating or rejecting it needs the Resolve flagged transactions permission.';
export const READ_DENIED =
  'Flagged transactions are open to admins with Withdrawals access or the View flagged transactions permission. If you need it, ask a super administrator to grant it.';
export const UNKNOWN_RESOLUTION =
  'No response came back, so the review may or may not have been recorded. Reloading to show the flag’s current state.';

export const TABS: readonly TabSpec[] = [
  {
    value: 'open',
    label: 'Open',
    statuses: OPEN_STATUSES,
    emptyTitle: 'No open flags',
    emptyHint: 'Flags waiting for a review, or escalated for a second look, appear here.',
  },
  {
    value: 'pending_review',
    label: 'Pending review',
    statuses: ['pending_review'],
    emptyTitle: 'Nothing is waiting for review',
    emptyHint: 'New flags from the withdrawal risk rules appear here as soon as they are raised.',
  },
  {
    value: 'escalated',
    label: 'Escalated',
    statuses: ['escalated'],
    emptyTitle: 'No escalated flags',
    emptyHint: 'Flags escalated for a senior review stay here until someone clears or rejects them.',
  },
  {
    value: 'cleared',
    label: 'Cleared',
    statuses: ['cleared'],
    emptyTitle: 'No cleared flags',
    emptyHint: 'Flags reviewed and found fine appear here, along with flags on withdrawals that were approved.',
  },
  {
    value: 'rejected',
    label: 'Rejected',
    statuses: ['rejected'],
    emptyTitle: 'No rejected flags',
    emptyHint: 'Flags judged justified appear here, along with flags on withdrawals that were rejected.',
  },
  {
    value: 'all',
    label: 'All',
    statuses: null,
    emptyTitle: 'No flags yet',
    emptyHint: 'Every flag the risk rules raise appears here.',
  },
];

export const TAB_VALUES: readonly FlagTab[] = TABS.map((spec) => spec.value);

export const ACTION_ORDER: readonly FlagAction[] = ['clear', 'escalate', 'reject'];

export const FLAG_ACTIONS: Readonly<Record<FlagAction, FlagActionSpec>> = {
  clear: {
    result: 'cleared',
    button: 'Clear flag',
    title: 'Clear this flag?',
    lead: 'Clearing records that you reviewed this flag and found nothing wrong.',
    confirmLabel: 'Clear flag',
    reasonLabel: 'Why is this flag being cleared?',
    placeholder: 'Explain what you checked',
    presets: [
      'Verified with the user',
      'Normal activity for this account',
      'Funds came from verified trades',
      'Duplicate of another flag',
    ],
    done: 'Flag cleared. Only your review was recorded; nothing was approved, paid, held or refunded.',
  },
  escalate: {
    result: 'escalated',
    button: 'Escalate flag',
    title: 'Escalate this flag?',
    lead: 'Escalating keeps this flag open and marks it for a senior review.',
    confirmLabel: 'Escalate flag',
    reasonLabel: 'Why does this flag need a senior review?',
    placeholder: 'Explain what the next reviewer should look at',
    presets: [
      'Needs a senior review',
      'Waiting for more information',
      'Unusual pattern on the account',
      'Possible fraud',
    ],
    done: 'Flag escalated. Only your review was recorded; nothing was approved, paid, held or refunded.',
  },
  reject: {
    result: 'rejected',
    button: 'Reject flag',
    title: 'Reject this flag?',
    lead: 'Rejecting records that this flag was justified.',
    confirmLabel: 'Reject flag',
    reasonLabel: 'Why is this flag being rejected?',
    placeholder: 'Explain what you found',
    presets: [
      'Confirmed suspicious activity',
      'Source of funds not verified',
      'Account under investigation',
      'Possible fraud',
    ],
    done: 'Flag rejected. Only your review was recorded; nothing was rejected, reversed or refunded.',
  },
};

const STATUS_LABELS: Readonly<Record<FlagStatus, string>> = {
  pending_review: 'Pending review',
  escalated: 'Escalated',
  cleared: 'Cleared',
  rejected: 'Rejected',
};

const STATUS_ALIASES: ReadonlyMap<string, readonly FlagStatus[]> = new Map<string, readonly FlagStatus[]>([
  ['open', OPEN_STATUSES],
  ['pending', ['pending_review']],
]);

const RESULT_LINES: Readonly<Record<FlagAction, string>> = {
  clear: 'The flag moves to Cleared and leaves the open queue. A cleared flag cannot be reopened.',
  escalate: 'The flag stays open as Escalated until someone clears or rejects it.',
  reject: 'The flag moves to Rejected and leaves the open queue. A rejected flag cannot be reopened.',
};

const ACTION_PARTICIPLES: Readonly<Record<FlagAction, string>> = {
  clear: 'cleared',
  escalate: 'escalated',
  reject: 'rejected',
};

const FINAL_FAILURES: ReadonlySet<number> = new Set([403, 404, 409]);
const TYPE_TOKEN = /^[a-z0-9_]{1,40}$/;
const HEX_FRAGMENT = /^[0-9a-f-]{8,}$/;
const LEADING_AT = /^@+/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function amountOf(value: unknown): number | string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function booleanOf(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function firstOf(value: unknown): unknown {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function isFlagStatus(value: unknown): value is FlagStatus {
  return typeof value === 'string' && (FLAG_STATUSES as readonly string[]).includes(value);
}

export function isOpenStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && (OPEN_STATUSES as readonly string[]).includes(status);
}

export function flagStatusLabel(status: string | null | undefined): string {
  if (isFlagStatus(status)) return STATUS_LABELS[status];
  const raw = typeof status === 'string' ? status.trim() : '';
  if (!raw) return 'Unknown';
  const spaced = raw.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function tabSpec(tab: FlagTab): TabSpec {
  return TABS.find((spec) => spec.value === tab) ?? TABS[0];
}

export function parseStatusFilter(raw: string | null | undefined): FlagStatus[] | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === '' || value === 'all') return [];
  const wanted = new Set<FlagStatus>();
  for (const token of value.split(',')) {
    const key = token.trim();
    if (!key) continue;
    const expanded = isFlagStatus(key) ? [key] : STATUS_ALIASES.get(key);
    if (!expanded) return null;
    for (const status of expanded) wanted.add(status);
  }
  if (wanted.size === 0) return null;
  return FLAG_STATUSES.filter((status) => wanted.has(status));
}

export function isTypeToken(value: unknown): value is string {
  return typeof value === 'string' && TYPE_TOKEN.test(value);
}

export function parseTypeFilter(raw: string | null | undefined): string | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === '' || value === 'all') return '';
  return isTypeToken(value) ? value : null;
}

export function typeParam(raw: string | null | undefined): string {
  return parseTypeFilter(raw) ?? '';
}

export function parseSortKey(raw: string | null | undefined): FlagSortKey {
  return raw === 'amount' ? 'amount' : 'created_at';
}

export function planFlagSearch(raw: string | null | undefined): FlagSearch {
  const term = sanitizeSearch(typeof raw === 'string' ? raw : '', SEARCH_MAX);
  if (!term) return { kind: 'none' };
  const lowered = term.toLowerCase();
  if (isUuid(lowered)) return { kind: 'id', id: lowered };
  return {
    kind: 'text',
    userTerm: term.replace(LEADING_AT, '').trim(),
    fragment: HEX_FRAGMENT.test(lowered) ? lowered : null,
  };
}

export function userMatchClause(term: string): string {
  const pattern = `%${term}%`;
  return `full_name.ilike.${pattern},username.ilike.${pattern},email.ilike.${pattern}`;
}

export function flagSearchClause(plan: FlagSearch, userIds: readonly unknown[]): string | null {
  if (plan.kind === 'none') return null;
  if (plan.kind === 'id') return `id.eq.${plan.id},transaction_id.eq.${plan.id},user_id.eq.${plan.id}`;
  const ids = Array.from(
    new Set(userIds.filter((id): id is string => isUuid(id)).map((id) => id.toLowerCase())),
  ).slice(0, SEARCH_USER_CAP);
  const clauses: string[] = [];
  if (ids.length > 0) clauses.push(`user_id.in.(${ids.join(',')})`);
  if (plan.fragment) clauses.push(`transaction_id.ilike.${plan.fragment}%`);
  return clauses.length > 0 ? clauses.join(',') : null;
}

export function listQuery(view: FlagsView, pageSize: number = PAGE_SIZE): string {
  const params = new URLSearchParams();
  const statuses = tabSpec(view.tab).statuses;
  if (statuses) params.set('status', statuses.join(','));
  const search = view.search.trim();
  if (search) params.set('search', search);
  if (view.type) params.set('type', view.type);
  if (view.range.from) params.set('date_from', view.range.from);
  if (view.range.to) params.set('date_to', view.range.to);
  params.set('sort', view.sort.key);
  params.set('dir', view.sort.dir);
  params.set('page', String(view.page));
  params.set('page_size', String(pageSize));
  return params.toString();
}

export function sameStatusScope(previousKey: string, nextKey: string): boolean {
  return new URLSearchParams(previousKey).get('status') === new URLSearchParams(nextKey).get('status');
}

export function tabCount(tab: FlagTab, counts: StatusCounts | null): number | null {
  if (!counts) return null;
  let total = 0;
  for (const status of tabSpec(tab).statuses ?? FLAG_STATUSES) {
    const value = counts[status];
    if (value === null) return null;
    total += value;
  }
  return total;
}

export function typeOptions(types: readonly string[] | null, selected: string): string[] {
  const options = new Set((types ?? []).filter(isTypeToken));
  if (isTypeToken(selected)) options.add(selected);
  return Array.from(options).sort();
}

function toUser(raw: unknown): FlagUser | null {
  if (!isRecord(raw)) return null;
  return {
    id: text(raw.id),
    username: text(raw.username),
    full_name: text(raw.full_name),
    email: text(raw.email),
    is_frozen: booleanOf(raw.is_frozen),
    freeze_reason: text(raw.freeze_reason),
  };
}

export function toFlag(raw: unknown): Flag | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  return {
    id: raw.id,
    user_id: text(raw.user_id),
    transaction_id: text(raw.transaction_id),
    transaction_type: text(raw.transaction_type),
    amount: amountOf(raw.amount),
    flag_reason: text(raw.flag_reason),
    status: text(raw.status) ?? '',
    reviewed_by: text(raw.reviewed_by),
    reviewed_at: text(raw.reviewed_at),
    created_at: text(raw.created_at),
    user: toUser(firstOf(raw.users)),
  };
}

function toCounts(raw: unknown): StatusCounts | null {
  if (!isRecord(raw)) return null;
  return {
    pending_review: countOf(raw.pending_review),
    escalated: countOf(raw.escalated),
    cleared: countOf(raw.cleared),
    rejected: countOf(raw.rejected),
  };
}

function toTypes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return Array.from(new Set(raw.filter(isTypeToken))).sort();
}

export function toListResult(body: ApiBody): ListResult | null {
  if (!Array.isArray(body.flagged)) return null;
  const flags = body.flagged.map(toFlag).filter((flag): flag is Flag => flag !== null);
  const pagination = isRecord(body.pagination) ? body.pagination : null;
  return {
    flags,
    total: countOf(body.total) ?? countOf(pagination?.total) ?? flags.length,
    counts: toCounts(body.counts),
    openCount: countOf(body.open_count),
    types: toTypes(body.types),
    searchCapped: body.search_capped === true,
  };
}

export function presentWithdrawal(row: Record<string, unknown>): WithdrawalSummary {
  return {
    id: text(row.id) ?? '',
    status: text(row.status) ?? '',
    amount: amountOf(row.amount),
    fee: amountOf(row.fee),
    bank_name: text(row.bank_name),
    account_number: isMaskable(row.account_number) ? maskTail(row.account_number) : null,
    account_name: text(row.account_name),
    gateway: text(row.gateway),
    failure_reason: text(row.failure_reason),
    created_at: text(row.created_at),
  };
}

export function presentTransaction(row: Record<string, unknown>): TransactionSummary {
  return {
    id: text(row.id) ?? '',
    type: text(row.type),
    amount: amountOf(row.amount),
    status: text(row.status),
    reference_id: text(row.reference_id),
    created_at: text(row.created_at),
    metadata: row.metadata === null || row.metadata === undefined ? null : redactAudit(maskMetadata(row.metadata)),
  };
}

function toWithdrawalSummary(raw: unknown): WithdrawalSummary | null {
  if (!isRecord(raw) || !text(raw.id)) return null;
  return presentWithdrawal(raw);
}

function toTransactionSummary(raw: unknown): TransactionSummary | null {
  if (!isRecord(raw) || !text(raw.id)) return null;
  return presentTransaction(raw);
}

function toOtherFlag(raw: unknown): OtherFlag | null {
  if (!isRecord(raw) || !text(raw.id)) return null;
  return {
    id: text(raw.id) ?? '',
    flag_reason: text(raw.flag_reason),
    status: text(raw.status) ?? '',
    created_at: text(raw.created_at),
    reviewed_at: text(raw.reviewed_at),
  };
}

function toReviewer(raw: unknown): Reviewer | null {
  if (!isRecord(raw) || !text(raw.id)) return null;
  return { id: text(raw.id) ?? '', username: text(raw.username) };
}

export function toDetail(body: ApiBody): DetailResult | null {
  const flag = toFlag(body.flag);
  if (!flag) return null;
  const partial = isRecord(body.partial) ? body.partial : null;
  const others = Array.isArray(body.other_flags) ? body.other_flags : [];
  return {
    flag,
    reviewer: toReviewer(body.reviewer),
    withdrawal: toWithdrawalSummary(body.withdrawal),
    transaction: toTransactionSummary(body.transaction),
    otherFlags: others.map(toOtherFlag).filter((other): other is OtherFlag => other !== null),
    partial: {
      reviewer: text(partial?.reviewer),
      related: text(partial?.related),
      otherFlags: text(partial?.other_flags),
    },
  };
}

export function isWithdrawalFlag(flag: Pick<Flag, 'transaction_type'>): boolean {
  return flag.transaction_type === 'withdrawal';
}

export function withdrawalHref(flag: Pick<Flag, 'transaction_type' | 'transaction_id'>): string | null {
  const id = flag.transaction_id;
  if (!isWithdrawalFlag(flag) || !isUuid(id)) return null;
  return `/withdrawals?id=${encodeURIComponent(id.toLowerCase())}`;
}

export function userHandle(user: FlagUser | null | undefined, userId?: string | null): string {
  if (user?.username) return `@${user.username}`;
  if (user?.full_name) return user.full_name;
  if (user?.email) return user.email;
  return userId ? 'Unknown user' : 'No user';
}

export function userName(user: FlagUser | null | undefined): string | null {
  return user?.full_name || user?.username || null;
}

export function userSubline(user: FlagUser | null | undefined): string {
  if (user?.username) return user.full_name || user.email || '—';
  if (user?.full_name) return user.email || '—';
  return '—';
}

export function userSummary(user: FlagUser | null | undefined): string {
  const handle = user?.username ? `@${user.username}` : null;
  const name = user?.full_name || null;
  if (handle && name) return `${name} (${handle})`;
  return handle || name || user?.email || 'Unknown user';
}

export function actionsFor(status: string | null | undefined): FlagAction[] {
  if (status === 'pending_review') return ['clear', 'escalate', 'reject'];
  if (status === 'escalated') return ['clear', 'reject'];
  return [];
}

export function unavailableText(status: string, action: FlagAction): string {
  if (status === 'escalated' && action === 'escalate') return 'This flag is already escalated.';
  return `This flag is now ${flagStatusLabel(status).toLowerCase()}, so it can no longer be ${ACTION_PARTICIPLES[action]}.`;
}

export function actionMessage(action: FlagAction): string {
  return `${FLAG_ACTIONS[action].lead} ${REVIEW_ONLY}`;
}

function phrase(status: string): string {
  return status.replace(/_/g, ' ');
}

function relatedLine(action: FlagAction, detail: Pick<DetailResult, 'flag' | 'withdrawal'>): string {
  if (!isWithdrawalFlag(detail.flag)) return 'No money moves and the transaction itself is not changed.';
  const withdrawal = detail.withdrawal;
  if (!withdrawal || !withdrawal.status) {
    return 'The withdrawal could not be checked just now. Whatever its status, resolving this flag does not change it.';
  }
  const state = phrase(withdrawal.status);
  if (!isActionable(withdrawal.status)) {
    return `The withdrawal stays ${state}. Resolving this flag does not change, reverse or refund it.`;
  }
  if (action === 'clear') {
    return `The withdrawal stays ${state}. Clearing the flag does not approve or pay it: to send the payout, approve the withdrawal on the Withdrawals page.`;
  }
  if (action === 'escalate') {
    return `The withdrawal stays ${state}. Escalating does not hold or pause it, and it can still be approved or rejected on the Withdrawals page.`;
  }
  return `The withdrawal stays ${state} and can still be approved. Rejecting the flag does not reject or refund it: to stop the payout and refund the wallet, reject the withdrawal on the Withdrawals page.`;
}

function othersLine(detail: Pick<DetailResult, 'flag' | 'otherFlags'>): string | null {
  const open = detail.otherFlags.filter((other) => isOpenStatus(other.status)).length;
  if (open === 0) return null;
  const noun = isWithdrawalFlag(detail.flag) ? 'withdrawal' : 'transaction';
  return open === 1
    ? `1 other open flag on this ${noun} stays open. Each flag is reviewed on its own.`
    : `${open} other open flags on this ${noun} stay open. Each flag is reviewed on its own.`;
}

export function actionConsequences(
  action: FlagAction,
  detail: Pick<DetailResult, 'flag' | 'withdrawal' | 'otherFlags'>,
): string[] {
  const others = othersLine(detail);
  return [RESULT_LINES[action], relatedLine(action, detail), ...(others ? [others] : [])];
}

export function classifyResolution(result: ApiResult<ApiBody>): ResolutionAttempt {
  if (result.ok) return { kind: 'done', status: text(result.data.status), warning: text(result.data.warning) };
  const failure = result.error;
  if (failure.outcomeUnknown) return { kind: 'unknown' };
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.status !== null && FINAL_FAILURES.has(failure.status)) {
    return { kind: 'refused', status: failure.status, message: failure.message };
  }
  return { kind: 'retry', message: failure.message };
}

export function resolutionToast(
  action: FlagAction,
  outcome: ResolutionOutcome,
): { text: string; tone: ToastTone } | null {
  switch (outcome.kind) {
    case 'done':
      return outcome.warning
        ? { text: outcome.warning, tone: 'warning' }
        : { text: FLAG_ACTIONS[action].done, tone: 'success' };
    case 'unknown':
      return { text: UNKNOWN_RESOLUTION, tone: 'error' };
    case 'refused':
      return { text: outcome.message, tone: 'error' };
    default:
      return null;
  }
}

export function readFailureText(failure: ApiFailure): string {
  return failure.kind === 'http' ? failure.message : `${failure.message} Nothing was changed.`;
}

export function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    work.then(done, done);
  });
}
