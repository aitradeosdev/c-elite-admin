import type { ApiBody, ApiResult } from '../../lib/apiClient';
import type { UseResourceResult } from '../../_ui';
import type { RealtimeSignal } from '../../_ui/realtime/RealtimeSignals';

export type Tab = 'pending_review' | 'processing' | 'success' | 'failed' | 'all';

export interface TabSpec {
  value: Tab;
  label: string;
  statuses: readonly string[] | null;
  emptyTitle: string;
  emptyHint: string;
}

export const DEFAULT_TAB: Tab = 'pending_review';

const REVIEW_TAB: Tab = 'pending_review';

const REVIEW_STATUSES: readonly string[] = ['pending_review', 'held'];

const TAB_ALIASES: ReadonlyMap<string, Tab> = new Map<string, Tab>([['held', REVIEW_TAB]]);

const FILTER_KEYS = ['status', 'review'];

export const TABS: readonly TabSpec[] = [
  {
    value: REVIEW_TAB,
    label: 'Review',
    statuses: REVIEW_STATUSES,
    emptyTitle: 'Nothing is waiting for a decision',
    emptyHint: 'New requests and held withdrawals appear here until someone approves or rejects them.',
  },
  {
    value: 'processing',
    label: 'Processing',
    statuses: ['initiated', 'processing'],
    emptyTitle: 'No payouts in flight',
    emptyHint: 'Approved payouts waiting on the provider appear here until they settle or fail.',
  },
  {
    value: 'success',
    label: 'Success',
    statuses: ['success'],
    emptyTitle: 'No completed payouts',
    emptyHint: 'Payouts the provider has confirmed appear here.',
  },
  {
    value: 'failed',
    label: 'Failed',
    statuses: ['failed', 'resume_failed'],
    emptyTitle: 'No failed withdrawals',
    emptyHint: 'Rejected and failed withdrawals are refunded to the user and appear here.',
  },
  {
    value: 'all',
    label: 'All',
    statuses: null,
    emptyTitle: 'No withdrawals yet',
    emptyHint: 'Every withdrawal request appears here once a user makes one.',
  },
];

export const REJECT_REASONS = [
  'Suspicious activity',
  'Account under review',
  'Incorrect account details',
  'Duplicate withdrawal',
  'Gateway unavailable',
];

export const SIGNAL_GAP_MS = 1000;

const SUBTITLE_LEAD = 'Payout queue across every status.';

export type SignalTarget = Pick<UseResourceResult<unknown>, 'invalidate'>;

const ACTIONABLE = new Set(REVIEW_STATUSES);
const OPEN_FLAG = new Set(['pending_review', 'escalated']);

const PROVIDERS: Record<string, string> = {
  paystack: 'Paystack',
  monnify: 'Monnify',
  novac: 'Novac',
};

export const PAYOUT_UNCHECKED =
  'The active payout provider could not be checked. The payout goes through whichever provider is active when you confirm. If none is active then, or the check fails again, the approval is refused and no payout is sent.';

export const NO_GATEWAY_APPROVAL =
  'No payout provider is available, so this payout cannot be sent. Approvals are paused until a super administrator chooses a primary payout gateway that is turned on in Admin Settings.';

export const GATEWAY_UNCHECKED_APPROVAL =
  'The active payout provider could not be checked, so the withdrawal was not approved. Try again.';

export interface WithdrawalUser {
  id?: string | null;
  username?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  is_frozen?: boolean | null;
  freeze_reason?: string | null;
}

export const FROZEN_APPROVAL =
  'This account is frozen. Unfreeze it before approving, or reject the withdrawal to refund the wallet.';

export const EMERGENCY_TITLE = 'Emergency mode is on';

export const EMERGENCY_PAUSED =
  'Approvals are paused until a super administrator turns it off in Admin Settings.';

export const EMERGENCY_APPROVAL = `${EMERGENCY_TITLE}. ${EMERGENCY_PAUSED}`;

export const EMERGENCY_REJECT_NOTE = 'Rejecting still works and refunds the wallet in full.';

export const EMERGENCY_UNCHECKED =
  'Emergency mode could not be checked. While it is on, the approval is refused and no payout is sent.';

export function isFrozen(user: WithdrawalUser | null | undefined): boolean {
  return user?.is_frozen === true;
}

export interface WithdrawalFlag {
  id?: string | null;
  flag_reason?: string | null;
  status?: string | null;
  created_at?: string | null;
  reviewed_at?: string | null;
}

export interface Withdrawal {
  id: string;
  user_id: string | null;
  amount: number | string | null;
  fee?: number | string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  gateway: string | null;
  gateway_reference: string | null;
  status: string;
  failure_reason: string | null;
  created_at: string;
  user: WithdrawalUser | null;
  flag?: WithdrawalFlag | null;
}

export interface DetailPartial {
  user: string | null;
  flag: string | null;
}

export interface ApiEnvelope {
  success?: boolean;
  error?: string;
  message?: string;
  code?: string;
}

export interface ExportRow {
  ID: string;
  User: string;
  Amount: number | string | null;
  Fee?: number | string | null;
  Bank: string;
  Account: string;
  AccountName: string;
  Status: string;
  Gateway: string;
  GatewayRef: string;
  Date: string;
}

export interface ExportResponse extends ApiEnvelope {
  rows?: ExportRow[];
  total?: number;
  truncated?: boolean;
}

export interface ListResult {
  withdrawals: Withdrawal[];
  total: number;
  searchCapped: boolean;
  flagNote: string | null;
  emergencyMode: boolean | null;
}

export interface DetailResult {
  withdrawal: Withdrawal;
  partial: DetailPartial;
  payoutGateway: string | null;
  payoutMissing: boolean;
  emergencyMode: boolean | null;
}

export interface ActionResult {
  status: string | null;
  warning: string | null;
}

export type DecisionOutcome =
  | { kind: 'done'; status: string | null; warning: string | null; requestId: string | null }
  | { kind: 'unknown'; requestId: string | null }
  | { kind: 'provider'; message: string; stage: string | null; requestId: string | null }
  | { kind: 'refused'; message: string; status: number | null }
  | { kind: 'expired' }
  | { kind: 'retry'; message: string };

export type SettledDecision = Exclude<DecisionOutcome, { kind: 'retry' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function booleanOf(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function tabSpec(tab: Tab): TabSpec {
  return TABS.find((spec) => spec.value === tab) ?? TABS[0];
}

export function parseTab(raw: string | null | undefined): Tab {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return TABS.find((spec) => spec.value === text)?.value ?? TAB_ALIASES.get(text) ?? DEFAULT_TAB;
}

export function formatTab(tab: Tab): string | null {
  return tab === DEFAULT_TAB || !TABS.some((spec) => spec.value === tab) ? null : tab;
}

export function tabFilter(tab: Tab): Record<string, string> {
  const spec = tabSpec(tab);
  if (spec.value === REVIEW_TAB) return { review: '1' };
  return spec.statuses ? { status: spec.statuses.join(',') } : {};
}

export function sameTabFilter(previousKey: string, nextKey: string): boolean {
  const previous = new URLSearchParams(previousKey);
  const next = new URLSearchParams(nextKey);
  return FILTER_KEYS.every((key) => previous.get(key) === next.get(key));
}

export function subtitleFor(live: boolean): string {
  return live ? `${SUBTITLE_LEAD} Updates live; times are WAT.` : `${SUBTITLE_LEAD} Times are WAT.`;
}

export function signalReachesDetail(signal: RealtimeSignal, openId: string | null): boolean {
  if (!openId) return false;
  if (signal.kind === 'resync') return true;
  const open = openId.toLowerCase();
  return signal.id.toLowerCase() === open || signal.withdrawalId?.toLowerCase() === open;
}

export function invalidateOnSignal(
  signal: RealtimeSignal,
  openId: string | null,
  list: SignalTarget,
  detail: SignalTarget,
): void {
  list.invalidate({ minGapMs: SIGNAL_GAP_MS });
  if (signalReachesDetail(signal, openId)) detail.invalidate({ minGapMs: SIGNAL_GAP_MS });
}

export function isActionable(status: string | null | undefined): boolean {
  return ACTIONABLE.has(String(status || ''));
}

export function isHeld(status: string | null | undefined): boolean {
  return status === 'held';
}

export function isOpenFlag(flag: WithdrawalFlag | null | undefined): boolean {
  return Boolean(flag && OPEN_FLAG.has(String(flag.status || '')));
}

export function approvalRefusal(detail: Pick<DetailResult, 'withdrawal' | 'emergencyMode' | 'payoutMissing'>): string | null {
  if (isFrozen(detail.withdrawal.user)) return FROZEN_APPROVAL;
  if (detail.emergencyMode === true) return EMERGENCY_APPROVAL;
  if (detail.payoutMissing) return NO_GATEWAY_APPROVAL;
  return null;
}

function kobo(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function feeOf(w: Pick<Withdrawal, 'fee'>): number {
  return kobo(w.fee) / 100;
}

export function netOf(w: Pick<Withdrawal, 'amount'>): number {
  return kobo(w.amount) / 100;
}

export function grossOf(w: Pick<Withdrawal, 'amount' | 'fee'>): number {
  return (kobo(w.amount) + kobo(w.fee)) / 100;
}

export function gatewayKey(gateway: string | null | undefined): string {
  return String(gateway || '').trim().toLowerCase();
}

export function providerLabel(gateway: string | null | undefined): string {
  const key = gatewayKey(gateway);
  if (!key) return '—';
  return PROVIDERS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export function payoutDiffers(requested: string | null | undefined, payout: string | null): boolean {
  if (payout === null) return true;
  const from = gatewayKey(requested);
  return from !== '' && from !== gatewayKey(payout);
}

export function payoutProviderNote(requested: string | null | undefined, payout: string | null): string | null {
  if (payout === null) return PAYOUT_UNCHECKED;
  if (!payoutDiffers(requested, payout)) return null;
  return `This request came in via ${providerLabel(requested)}, but the payout will go through ${providerLabel(payout)}, the active provider.`;
}

export function userHandle(user: WithdrawalUser | null | undefined): string {
  if (user?.username) return `@${user.username}`;
  if (user?.full_name) return user.full_name;
  return 'Unknown user';
}

export function userSummary(user: WithdrawalUser | null | undefined): string {
  const handle = user?.username ? `@${user.username}` : null;
  const name = user?.full_name || null;
  if (handle && name) return `${name} (${handle})`;
  return handle || name || 'Unknown user';
}

export function messageOf(body: ApiEnvelope | null | undefined, fallback: string): string {
  return (body?.message || body?.error || '').trim() || fallback;
}

export function toListResult(body: ApiBody): ListResult | null {
  if (!Array.isArray(body.withdrawals)) return null;
  const partial = isRecord(body.partial) ? body.partial : null;
  return {
    withdrawals: body.withdrawals as Withdrawal[],
    total: Math.max(0, Number(body.total) || 0),
    searchCapped: body.search_capped === true,
    flagNote: text(partial?.flags),
    emergencyMode: booleanOf(body.emergency_mode),
  };
}

export function toDetail(body: ApiBody): DetailResult | null {
  const withdrawal = body.withdrawal;
  if (!isRecord(withdrawal) || typeof withdrawal.id !== 'string') return null;
  const partial = isRecord(body.partial) ? body.partial : null;
  return {
    withdrawal: withdrawal as unknown as Withdrawal,
    partial: { user: text(partial?.user), flag: text(partial?.flag) },
    payoutGateway: text(body.payout_gateway),
    payoutMissing: body.payout_gateway_missing === true,
    emergencyMode: booleanOf(body.emergency_mode),
  };
}

export function toActionResult(body: ApiBody): ActionResult {
  return { status: text(body.status), warning: text(body.warning) };
}

function stageOf(details: unknown): string | null {
  return isRecord(details) ? text(details.stage) : null;
}

export function classifyDecision(result: ApiResult<ActionResult>): DecisionOutcome {
  if (result.ok) {
    return { kind: 'done', status: result.data.status, warning: result.data.warning, requestId: result.requestId };
  }
  const failure = result.error;
  if (failure.outcomeUnknown) return { kind: 'unknown', requestId: failure.requestId };
  if (failure.code === 'PROVIDER_ERROR') {
    return { kind: 'provider', message: failure.message, stage: stageOf(failure.details), requestId: failure.requestId };
  }
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.status === 403 || failure.status === 404 || failure.status === 409) {
    return { kind: 'refused', message: failure.message, status: failure.status };
  }
  return { kind: 'retry', message: failure.message };
}
