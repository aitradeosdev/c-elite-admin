import { ERROR_MESSAGE, isUuid, type ApiErrorCode } from '../../../lib/http';
import { KOBO_PER_NAIRA, groupedNairaText, koboText, parseNaira, toKobo, type NairaProblem } from '../../../lib/naira';
import { formatNaira } from '../../../_ui/money';
import type { ApiBody, ApiResult } from '../../../lib/apiClient';
import type { ConfirmOptions, ToastTone } from '../../../_ui';
import { userHandle, userSummary, type UserProfile } from './model';

export type AdjustDirection = 'credit' | 'debit';

export const ADJUSTMENTS_TABLE = 'wallet_adjustments';
export const CAP_KEY = 'max_wallet_adjustment_naira';
export const DAILY_CAP_KEY = 'max_wallet_adjustment_daily_naira';
export const EMERGENCY_KEY = 'emergency_mode';
export const DEFAULT_CAP_NAIRA = 500_000;
export const DEFAULT_DAILY_CAP_NAIRA = 2_000_000;
export const TEMPLATE_KEYS: Readonly<Record<AdjustDirection, string>> = { credit: 'wallet_credited', debit: 'wallet_debited' };
export const AMOUNT_MAX = 9_999_999_999_999.99;
export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const NOTE_MAX = 140;
export const REFERENCE_MAX = 120;
export const HISTORY_LIMIT = 20;
export const TYPED_FROM_KOBO = 100_000 * KOBO_PER_NAIRA;
export const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
export const DEFAULT_NOTE = 'Balance adjustment by CardElite support.';
export const OTHER_CHOICE = '__other__';
export const DELETION_FREEZE = /deletion in progress/i;
export const REVIEW_STATUSES: readonly string[] = ['pending_review', 'held'];

export const REASON_PRESETS: readonly string[] = [
  'Card trade paid at the wrong amount',
  'Failed withdrawal that was not refunded',
  'Failed bill payment that was not refunded',
  'Duplicate or mistaken credit',
  'Correction of an earlier wallet adjustment',
];

const SHARED_NOTES: readonly string[] = [DEFAULT_NOTE, 'Correction to an earlier transaction.'];

export const NOTE_PRESETS: Readonly<Record<AdjustDirection, readonly string[]>> = {
  credit: [DEFAULT_NOTE, 'Refund from CardElite support.', 'Correction to an earlier transaction.'],
  debit: [DEFAULT_NOTE, 'Reversal of an amount credited in error.', 'Correction to an earlier transaction.'],
};

export const DIRECTION_TEXT: Readonly<Record<AdjustDirection, { label: string; done: string; history: string }>> = {
  credit: { label: 'Credit', done: 'Credited', history: 'Wallet credit' },
  debit: { label: 'Debit', done: 'Debited', history: 'Wallet debit' },
};

export const TEMPLATE_NAMES: Readonly<Record<AdjustDirection, string>> = { credit: 'Wallet Credited', debit: 'Wallet Debited' };

export interface TemplateInfo {
  active: boolean;
  title: string | null;
  body: string | null;
}

export const DEFAULT_TEMPLATES: Readonly<Record<AdjustDirection, TemplateInfo>> = {
  credit: { active: true, title: 'Wallet Credited', body: '₦{amount} has been added to your wallet. {note}' },
  debit: { active: true, title: 'Wallet Debited', body: '₦{amount} has been deducted from your wallet. {note}' },
};

export const REFUSAL_REASONS = [
  'user_not_found',
  'wallet_not_found',
  'account_deleted',
  'self_adjustment',
  'emergency_mode',
  'over_limit',
  'over_daily_limit',
  'balance_changed',
  'insufficient_balance',
  'idempotency_mismatch',
] as const;

export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export const OUTCOME_UNKNOWN_MESSAGE =
  'The adjustment could not be confirmed, so it may or may not have been applied. Use Retry safely: it sends the same request again and can never apply it twice.';
export const NOT_APPLIED_MESSAGE = 'The adjustment could not be applied, so nothing was changed. Try again.';
export const INVALID_ADJUSTMENT_MESSAGE =
  'The database refused these values, so nothing was changed. Check the amount, the reason, the message and the reference.';
export const CLOSE_WHILE_UNKNOWN =
  'The last adjustment could not be confirmed. If you close the panel, check the wallet history before adjusting again, or the same money could move twice.';

const REFUSAL_SET: ReadonlySet<string> = new Set(REFUSAL_REASONS);
const FINAL_STATUSES: ReadonlySet<number> = new Set([400, 403, 404, 409]);
const UNSUPPORTED = /\u0000/;
const PLAIN_CAP = /^[0-9]{1,255}(?:\.[0-9]{1,255})?$/;
const EDGE_SPACE = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;
const SETTLED_CODE = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;
const CONNECTION_LOST_CODE = 'PGRST001';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function amountOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function flagOf(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function directionOf(value: unknown): AdjustDirection | null {
  return value === 'credit' || value === 'debit' ? value : null;
}

export function characters(value: string): number {
  return Array.from(value).length;
}

export function formatKobo(kobo: number): string {
  return formatNaira(kobo / KOBO_PER_NAIRA);
}

export function isRefusalReason(value: unknown): value is RefusalReason {
  return typeof value === 'string' && REFUSAL_SET.has(value);
}

export function readCap(raw: unknown, fallback: number): number {
  if (typeof raw !== 'string') return fallback;
  const value = raw.replace(EDGE_SPACE, '');
  if (!PLAIN_CAP.test(value)) return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
}

export function sameEmail(a: unknown, b: unknown): boolean {
  const left = typeof a === 'string' ? a.trim().toLowerCase() : '';
  const right = typeof b === 'string' ? b.trim().toLowerCase() : '';
  return left !== '' && left === right;
}

export interface AdjustRequest {
  direction: AdjustDirection;
  amount: string;
  amount_kobo: number;
  reason: string;
  user_note: string | null;
  reference: string | null;
  expected_balance: string | null;
  idempotency_key: string;
}

export type AdjustRequestField =
  | 'direction' | 'amount' | 'reason' | 'user_note' | 'reference' | 'expected_balance' | 'idempotency_key';

export type AdjustRequestCheck =
  | { ok: true; value: AdjustRequest }
  | { ok: false; field: AdjustRequestField | null; message: string };

export const REQUEST_MESSAGES = {
  body: 'Send the adjustment as a JSON object.',
  direction: 'Choose whether to credit or debit the wallet.',
  amountType: 'Send the amount as text, such as "5000" or "5000.50".',
  amountZero: 'The amount must be more than ₦0.00.',
  reasonMissing: 'Give a reason for the adjustment. It stays internal.',
  reasonShort: `The reason must be at least ${REASON_MIN} characters.`,
  reasonLong: `The reason must be ${REASON_MAX} characters or fewer.`,
  noteType: 'The message to the user must be text.',
  noteLong: `The message to the user must be ${NOTE_MAX} characters or fewer.`,
  referenceType: 'The reference must be text.',
  referenceLong: `The reference must be ${REFERENCE_MAX} characters or fewer.`,
  balanceType: 'Send the balance you saw as text, such as "1500.00".',
  balanceInvalid: 'The balance you saw is not a valid amount.',
  key: 'This request has no valid key, so nothing was sent on. Reload the page and try again.',
  unsupported: 'Remove the unsupported character from the text.',
} as const;

export const AMOUNT_PROBLEMS: Readonly<Record<NairaProblem, string>> = {
  required: 'Enter the amount in naira.',
  invalid: 'Enter the amount as a number of naira, such as 5000 or 5,000.50.',
  negative: 'Enter the amount without a minus sign. Choose Debit to take money out of the wallet.',
  decimals: 'Use at most 2 decimal places (kobo).',
  too_large: `The amount cannot be more than ${formatNaira(AMOUNT_MAX)}.`,
};

function refuse(field: AdjustRequestField | null, message: string): AdjustRequestCheck {
  return { ok: false, field, message };
}

type OptionalText = { ok: true; value: string | null } | { ok: false };

function optionalText(raw: unknown): OptionalText {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  const trimmed = raw.trim();
  return { ok: true, value: trimmed === '' ? null : trimmed };
}

function expectedBalance(raw: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, message: REQUEST_MESSAGES.balanceType };
  const parsed = parseNaira(raw, AMOUNT_MAX);
  return parsed.ok ? { ok: true, value: koboText(parsed.kobo) } : { ok: false, message: REQUEST_MESSAGES.balanceInvalid };
}

export function checkAdjustRequest(body: unknown): AdjustRequestCheck {
  if (!isRecord(body)) return refuse(null, REQUEST_MESSAGES.body);
  const direction = directionOf(body.direction);
  if (!direction) return refuse('direction', REQUEST_MESSAGES.direction);

  const rawAmount = body.amount;
  if (typeof rawAmount !== 'string') {
    return refuse('amount', rawAmount === undefined || rawAmount === null ? AMOUNT_PROBLEMS.required : REQUEST_MESSAGES.amountType);
  }
  const amount = parseNaira(rawAmount, AMOUNT_MAX);
  if (!amount.ok) return refuse('amount', AMOUNT_PROBLEMS[amount.problem]);
  if (amount.kobo <= 0) return refuse('amount', REQUEST_MESSAGES.amountZero);

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason === '') return refuse('reason', REQUEST_MESSAGES.reasonMissing);
  if (characters(reason) < REASON_MIN) return refuse('reason', REQUEST_MESSAGES.reasonShort);
  if (characters(reason) > REASON_MAX) return refuse('reason', REQUEST_MESSAGES.reasonLong);
  if (UNSUPPORTED.test(reason)) return refuse('reason', REQUEST_MESSAGES.unsupported);

  const note = optionalText(body.user_note);
  if (!note.ok) return refuse('user_note', REQUEST_MESSAGES.noteType);
  if (note.value !== null && characters(note.value) > NOTE_MAX) return refuse('user_note', REQUEST_MESSAGES.noteLong);
  if (note.value !== null && UNSUPPORTED.test(note.value)) return refuse('user_note', REQUEST_MESSAGES.unsupported);

  const reference = optionalText(body.reference);
  if (!reference.ok) return refuse('reference', REQUEST_MESSAGES.referenceType);
  if (reference.value !== null && characters(reference.value) > REFERENCE_MAX) {
    return refuse('reference', REQUEST_MESSAGES.referenceLong);
  }
  if (reference.value !== null && UNSUPPORTED.test(reference.value)) return refuse('reference', REQUEST_MESSAGES.unsupported);

  const expected = expectedBalance(body.expected_balance);
  if (!expected.ok) return refuse('expected_balance', expected.message);

  const key = body.idempotency_key;
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return refuse('idempotency_key', REQUEST_MESSAGES.key);

  return {
    ok: true,
    value: {
      direction,
      amount: koboText(amount.kobo),
      amount_kobo: amount.kobo,
      reason,
      user_note: note.value,
      reference: reference.value,
      expected_balance: expected.value,
      idempotency_key: key,
    },
  };
}

export interface AdjustmentRecord {
  adjustment_id: string | null;
  transaction_id: string | null;
  user_id: string | null;
  direction: AdjustDirection | null;
  amount: number | null;
  balance_before: number | null;
  balance_after: number | null;
  account_frozen: boolean | null;
  notified: boolean | null;
  created_at: string | null;
}

export interface Refusal {
  reason: string;
  balance: number | null;
  limit: number | null;
  used_today: number | null;
}

export type RpcOutcome =
  | { kind: 'applied'; adjustment: AdjustmentRecord; replayed: boolean }
  | { kind: 'refused'; refusal: Refusal }
  | { kind: 'unreadable' };

export function adjustmentRecord(raw: Record<string, unknown>): AdjustmentRecord {
  return {
    adjustment_id: text(raw.adjustment_id),
    transaction_id: text(raw.transaction_id),
    user_id: text(raw.user_id),
    direction: directionOf(raw.direction),
    amount: amountOf(raw.amount),
    balance_before: amountOf(raw.balance_before),
    balance_after: amountOf(raw.balance_after),
    account_frozen: flagOf(raw.account_frozen),
    notified: flagOf(raw.notified),
    created_at: text(raw.created_at),
  };
}

export function readRpcResult(data: unknown): RpcOutcome {
  if (!isRecord(data)) return { kind: 'unreadable' };
  if (data.applied === true) return { kind: 'applied', adjustment: adjustmentRecord(data), replayed: data.replayed === true };
  if (data.applied !== false) return { kind: 'unreadable' };
  return {
    kind: 'refused',
    refusal: {
      reason: text(data.reason) ?? 'unknown',
      balance: amountOf(data.balance),
      limit: amountOf(data.limit),
      used_today: amountOf(data.used_today),
    },
  };
}

export interface RouteFailure {
  code: ApiErrorCode;
  message: string;
  details: Record<string, unknown> | null;
}

export const OUTCOME_UNKNOWN: RouteFailure = {
  code: 'INTERNAL_ERROR',
  message: OUTCOME_UNKNOWN_MESSAGE,
  details: { outcome_unknown: true },
};

function naira(value: number | null): string | null {
  return value === null ? null : formatNaira(value);
}

export function refusalFailure(refusal: Refusal, attempt: Pick<AdjustRequest, 'amount_kobo'>): RouteFailure {
  const { reason } = refusal;
  const amount = formatKobo(attempt.amount_kobo);
  const balance = naira(refusal.balance);
  const limit = naira(refusal.limit);
  const withBalance = refusal.balance === null ? { reason } : { reason, balance: refusal.balance };
  switch (reason) {
    case 'user_not_found':
      return { code: 'RESOURCE_NOT_FOUND', message: 'This user account could not be found, so nothing was changed.', details: { reason } };
    case 'wallet_not_found':
      return { code: 'RESOURCE_NOT_FOUND', message: 'This user has no wallet, so nothing was changed.', details: { reason } };
    case 'account_deleted':
      return {
        code: 'STATE_CONFLICT',
        message: 'This account is being deleted, so its wallet cannot be adjusted. Nothing was changed.',
        details: { reason },
      };
    case 'emergency_mode':
      return {
        code: 'STATE_CONFLICT',
        message: 'Emergency mode is on, so wallets cannot be credited. Debits are still allowed. Nothing was changed.',
        details: { reason },
      };
    case 'self_adjustment':
      return {
        code: 'STATE_CONFLICT',
        message: 'You cannot adjust the wallet of an account that uses your own email address. Nothing was changed.',
        details: { reason },
      };
    case 'insufficient_balance':
      return {
        code: 'STATE_CONFLICT',
        message: balance
          ? `The wallet holds ${balance}, so it cannot be debited ${amount}. A wallet can never go below zero. Nothing was changed.`
          : `The wallet does not hold ${amount}, so it cannot be debited that much. Nothing was changed.`,
        details: withBalance,
      };
    case 'balance_changed':
      return {
        code: 'STATE_CONFLICT',
        message: balance
          ? `The balance changed to ${balance} after you opened this panel, so nothing was changed. Check the new balance and submit again.`
          : 'The balance changed after you opened this panel, so nothing was changed. Check the new balance and submit again.',
        details: withBalance,
      };
    case 'over_limit':
      return {
        code: 'VALIDATION_ERROR',
        message: limit
          ? `${amount} is more than the ${limit} limit for one adjustment, so nothing was changed.`
          : `${amount} is more than the limit for one adjustment, so nothing was changed.`,
        details: { reason, limit: refusal.limit },
      };
    case 'over_daily_limit': {
      const used = refusal.used_today;
      const left = refusal.limit !== null && used !== null ? Math.max(0, refusal.limit - used) : null;
      return {
        code: 'VALIDATION_ERROR',
        message: limit && used !== null && left !== null
          ? `This would take you past your daily adjustment limit of ${limit}. You have adjusted ${formatNaira(used)} today, so ${formatNaira(left)} is left. Nothing was changed.`
          : 'This would take you past your daily adjustment limit, so nothing was changed.',
        details: { reason, limit: refusal.limit, used_today: used },
      };
    }
    case 'idempotency_mismatch':
      return {
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'This request reused the key of a different adjustment, so it was refused and nothing was changed. Close the panel and start again.',
        details: { reason },
      };
    default:
      return { code: 'STATE_CONFLICT', message: 'The adjustment was refused, so nothing was changed.', details: { reason } };
  }
}

export function rpcErrorFailure(error: { message?: unknown; code?: unknown } | null): RouteFailure {
  const message = typeof error?.message === 'string' ? error.message : '';
  const code = typeof error?.code === 'string' ? error.code : '';
  if (!SETTLED_CODE.test(code) || code === CONNECTION_LOST_CODE) return OUTCOME_UNKNOWN;
  if (message === 'Not authorized') return { code: 'AUTH_REQUIRED', message: ERROR_MESSAGE.AUTH_REQUIRED, details: null };
  if (message === 'Invalid adjustment') return { code: 'VALIDATION_ERROR', message: INVALID_ADJUSTMENT_MESSAGE, details: null };
  return { code: 'INTERNAL_ERROR', message: NOT_APPLIED_MESSAGE, details: null };
}

export interface AdjustReceipt {
  adjustment: AdjustmentRecord;
  replayed: boolean;
}

export function toAdjustReceipt(body: ApiBody): AdjustReceipt | null {
  if (!isRecord(body.adjustment) || typeof body.replayed !== 'boolean') return null;
  return { adjustment: adjustmentRecord(body.adjustment), replayed: body.replayed };
}

export type AdjustOutcome =
  | { kind: 'applied'; receipt: AdjustReceipt }
  | { kind: 'refused'; status: number | null; code: string | null; message: string; reason: RefusalReason | null; balance: number | null }
  | { kind: 'retry'; message: string }
  | { kind: 'unknown'; message: string }
  | { kind: 'expired' };

export function classifyAdjust(result: ApiResult<AdjustReceipt>): AdjustOutcome {
  if (result.ok) return { kind: 'applied', receipt: result.data };
  const failure = result.error;
  if (failure.outcomeUnknown) return { kind: 'unknown', message: OUTCOME_UNKNOWN_MESSAGE };
  if (failure.kind !== 'http') return { kind: 'retry', message: failure.message };
  if (failure.status === 401) return { kind: 'expired' };
  const details = isRecord(failure.details) ? failure.details : {};
  if (details.outcome_unknown === true) return { kind: 'unknown', message: OUTCOME_UNKNOWN_MESSAGE };
  if (failure.status !== null && FINAL_STATUSES.has(failure.status)) {
    return {
      kind: 'refused',
      status: failure.status,
      code: failure.code,
      message: failure.message,
      reason: isRefusalReason(details.reason) ? details.reason : null,
      balance: amountOf(details.balance),
    };
  }
  return { kind: 'retry', message: failure.message };
}

export interface ContextUser {
  id: string;
  full_name: string | null;
  username: string | null;
  frozen: boolean;
  freezeReason: string | null;
  deletedAt: string | null;
}

export interface HistoryRow {
  id: string;
  direction: AdjustDirection;
  amountKobo: number;
  balanceBeforeKobo: number | null;
  balanceAfterKobo: number | null;
  reason: string;
  userNote: string;
  reference: string | null;
  adminUsername: string | null;
  accountFrozen: boolean;
  notified: boolean;
  transactionId: string | null;
  createdAt: string;
}

export interface WalletLimits {
  perAdjustmentKobo: number;
  dailyKobo: number;
}

export interface WalletContext {
  user: ContextUser;
  balanceKobo: number | null;
  emergencyMode: boolean | null;
  limits: WalletLimits | null;
  usedTodayKobo: number | null;
  withdrawalsPending: number | null;
  selfAdjustment: boolean | null;
  templates: Record<AdjustDirection, TemplateInfo> | null;
  history: HistoryRow[] | null;
  partial: string[];
}

function templateOf(raw: unknown): TemplateInfo | null {
  if (!isRecord(raw) || typeof raw.active !== 'boolean') return null;
  return { active: raw.active, title: text(raw.title), body: text(raw.body) };
}

function historyRow(raw: unknown): HistoryRow | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const direction = directionOf(raw.direction);
  const amountKobo = toKobo(raw.amount);
  const createdAt = text(raw.created_at);
  if (!direction || amountKobo === null || !createdAt) return null;
  return {
    id: raw.id,
    direction,
    amountKobo,
    balanceBeforeKobo: toKobo(raw.balance_before),
    balanceAfterKobo: toKobo(raw.balance_after),
    reason: text(raw.reason) ?? '',
    userNote: text(raw.user_note) ?? '',
    reference: text(raw.reference),
    adminUsername: text(raw.admin_username),
    accountFrozen: raw.account_frozen === true,
    notified: raw.notified === true,
    transactionId: text(raw.transaction_id),
    createdAt,
  };
}

export function toWalletContext(body: ApiBody): WalletContext | null {
  const user = isRecord(body.user) ? body.user : null;
  if (!user || !isUuid(user.id)) return null;
  const wallet = isRecord(body.wallet) ? body.wallet : null;
  const limits = isRecord(body.limits) ? body.limits : null;
  const perAdjustmentKobo = limits ? toKobo(limits.per_adjustment) : null;
  const dailyKobo = limits ? toKobo(limits.daily) : null;
  const notifications = isRecord(body.notifications) ? body.notifications : null;
  const credit = notifications ? templateOf(notifications.credit) : null;
  const debit = notifications ? templateOf(notifications.debit) : null;
  const partial = isRecord(body.partial) ? body.partial : {};
  return {
    user: {
      id: user.id.toLowerCase(),
      full_name: text(user.full_name),
      username: text(user.username),
      frozen: user.is_frozen === true,
      freezeReason: text(user.freeze_reason),
      deletedAt: text(user.deleted_at),
    },
    balanceKobo: wallet ? toKobo(wallet.balance) : null,
    emergencyMode: flagOf(body.emergency_mode),
    limits: perAdjustmentKobo !== null && dailyKobo !== null ? { perAdjustmentKobo, dailyKobo } : null,
    usedTodayKobo: toKobo(body.used_today),
    withdrawalsPending: countOf(body.withdrawals_pending),
    selfAdjustment: flagOf(body.self_adjustment),
    templates: credit && debit ? { credit, debit } : null,
    history: Array.isArray(body.adjustments)
      ? body.adjustments.map(historyRow).filter((row): row is HistoryRow => row !== null)
      : null,
    partial: Object.values(partial).map(text).filter((entry): entry is string => entry !== null),
  };
}

export function isDeletionFreeze(user: Pick<ContextUser, 'frozen' | 'freezeReason'>): boolean {
  return user.frozen && user.freezeReason !== null && DELETION_FREEZE.test(user.freezeReason);
}

export interface Allowance {
  perAdjustmentKobo: number;
  dailyKobo: number;
  usedTodayKobo: number | null;
  leftTodayKobo: number | null;
}

export function allowanceOf(context: Pick<WalletContext, 'limits' | 'usedTodayKobo'>): Allowance | null {
  if (!context.limits) return null;
  const used = context.usedTodayKobo;
  return {
    perAdjustmentKobo: context.limits.perAdjustmentKobo,
    dailyKobo: context.limits.dailyKobo,
    usedTodayKobo: used,
    leftTodayKobo: used === null ? null : Math.max(0, context.limits.dailyKobo - used),
  };
}

export interface AdjustForm {
  direction: AdjustDirection | null;
  amount: string;
  reasonChoice: string;
  reasonText: string;
  reference: string;
  noteChoice: string;
  noteText: string;
}

export const EMPTY_ADJUST_FORM: Readonly<AdjustForm> = Object.freeze({
  direction: null,
  amount: '',
  reasonChoice: '',
  reasonText: '',
  reference: '',
  noteChoice: DEFAULT_NOTE,
  noteText: '',
});

export function notePresets(direction: AdjustDirection | null): readonly string[] {
  return direction ? NOTE_PRESETS[direction] : SHARED_NOTES;
}

export function withDirection(form: AdjustForm, direction: AdjustDirection): AdjustForm {
  const keep = form.noteChoice === OTHER_CHOICE || notePresets(direction).includes(form.noteChoice);
  return { ...form, direction, noteChoice: keep ? form.noteChoice : DEFAULT_NOTE };
}

export function effectiveReason(form: Pick<AdjustForm, 'reasonChoice' | 'reasonText'>): string {
  return (form.reasonChoice === OTHER_CHOICE ? form.reasonText : form.reasonChoice).trim();
}

export function effectiveNote(form: Pick<AdjustForm, 'noteChoice' | 'noteText'>): string {
  return (form.noteChoice === OTHER_CHOICE ? form.noteText : form.noteChoice).trim();
}

export function isFormDirty(form: AdjustForm): boolean {
  return form.direction !== null
    || form.amount.trim() !== ''
    || form.reasonChoice !== ''
    || form.reasonText.trim() !== ''
    || form.reference.trim() !== ''
    || form.noteChoice !== DEFAULT_NOTE
    || form.noteText.trim() !== '';
}

export interface AdjustValues {
  direction: AdjustDirection;
  amountKobo: number;
  reason: string;
  reference: string | null;
  note: string;
}

export interface BalancePreview {
  beforeKobo: number;
  afterKobo: number;
  changeKobo: number;
  negative: boolean;
}

export function previewBalance(balanceKobo: number, direction: AdjustDirection, amountKobo: number): BalancePreview {
  const changeKobo = direction === 'credit' ? amountKobo : -amountKobo;
  const afterKobo = balanceKobo + changeKobo;
  return { beforeKobo: balanceKobo, afterKobo, changeKobo, negative: afterKobo < 0 };
}

export type FormField = 'direction' | 'amount' | 'reason' | 'reference' | 'note';

export const FORM_FIELDS: readonly FormField[] = ['direction', 'amount', 'reason', 'reference', 'note'];

export interface FormCheck {
  values: AdjustValues | null;
  errors: Partial<Record<FormField, string>>;
  blocked: string | null;
  preview: BalancePreview | null;
  amountKobo: number | null;
}

export const FORM_MESSAGES = {
  direction: 'Choose Credit or Debit.',
  emergencyCredit: 'Emergency mode is on, so credits are refused. Debits are still allowed.',
  amountZero: 'Enter an amount above ₦0.00.',
  reasonChoose: 'Choose a reason, or choose Other and write one. It stays internal.',
  reasonWrite: 'Write the reason. It stays internal.',
  reasonShort: `Write at least ${REASON_MIN} characters.`,
  reasonLong: `Keep the reason to ${REASON_MAX} characters or fewer.`,
  referenceLong: `Keep the reference to ${REFERENCE_MAX} characters or fewer.`,
  noteWrite: 'Write the message, or choose one of the ready-made messages.',
  noteLong: `Keep the message to ${NOTE_MAX} characters or fewer.`,
  unsupported: 'Remove the unsupported character.',
  notLoaded: 'The wallet has not loaded yet.',
  deleted: 'This account is being deleted, so its wallet cannot be adjusted.',
  noWallet: 'This user has no wallet, so there is nothing to adjust.',
  self: 'You cannot adjust the wallet of an account that uses your own email address.',
} as const;

export function blockedReason(context: WalletContext | null): string | null {
  if (!context) return FORM_MESSAGES.notLoaded;
  if (context.user.deletedAt) return FORM_MESSAGES.deleted;
  if (context.balanceKobo === null) return FORM_MESSAGES.noWallet;
  if (context.selfAdjustment === true) return FORM_MESSAGES.self;
  return null;
}

function allowanceProblem(context: WalletContext | null, amountKobo: number): string | null {
  const allowance = context ? allowanceOf(context) : null;
  if (!allowance) return null;
  if (allowance.perAdjustmentKobo === 0 || allowance.dailyKobo === 0) {
    return 'Wallet adjustments are switched off: a limit is set to ₦0.00 in Limits & Fees.';
  }
  if (amountKobo > allowance.perAdjustmentKobo) {
    return `One adjustment can be at most ${formatKobo(allowance.perAdjustmentKobo)}.`;
  }
  if (allowance.leftTodayKobo !== null && amountKobo > allowance.leftTodayKobo) {
    return allowance.leftTodayKobo === 0
      ? `You have used all of your ${formatKobo(allowance.dailyKobo)} daily limit. It resets at midnight (WAT).`
      : `You have ${formatKobo(allowance.leftTodayKobo)} left of your ${formatKobo(allowance.dailyKobo)} daily limit.`;
  }
  return null;
}

export function checkAdjustForm(form: AdjustForm, context: WalletContext | null): FormCheck {
  const errors: Partial<Record<FormField, string>> = {};
  const blocked = blockedReason(context);

  if (form.direction === null) errors.direction = FORM_MESSAGES.direction;
  else if (form.direction === 'credit' && context?.emergencyMode === true) errors.direction = FORM_MESSAGES.emergencyCredit;

  let amountKobo: number | null = null;
  const parsed = parseNaira(form.amount, AMOUNT_MAX);
  if (!parsed.ok) errors.amount = AMOUNT_PROBLEMS[parsed.problem];
  else if (parsed.kobo <= 0) errors.amount = FORM_MESSAGES.amountZero;
  else {
    amountKobo = parsed.kobo;
    const problem = allowanceProblem(context, parsed.kobo);
    if (problem) errors.amount = problem;
  }

  const balanceKobo = context?.balanceKobo ?? null;
  const preview = form.direction && amountKobo !== null && balanceKobo !== null
    ? previewBalance(balanceKobo, form.direction, amountKobo)
    : null;
  if (preview?.negative && !errors.amount && balanceKobo !== null) {
    errors.amount = `The wallet holds ${formatKobo(balanceKobo)}, so you can debit at most that. A wallet can never go below zero.`;
  }

  const reason = effectiveReason(form);
  if (form.reasonChoice === '') errors.reason = FORM_MESSAGES.reasonChoose;
  else if (reason === '') errors.reason = FORM_MESSAGES.reasonWrite;
  else if (characters(reason) < REASON_MIN) errors.reason = FORM_MESSAGES.reasonShort;
  else if (characters(reason) > REASON_MAX) errors.reason = FORM_MESSAGES.reasonLong;
  else if (UNSUPPORTED.test(reason)) errors.reason = FORM_MESSAGES.unsupported;

  const reference = form.reference.trim();
  if (characters(reference) > REFERENCE_MAX) errors.reference = FORM_MESSAGES.referenceLong;
  else if (UNSUPPORTED.test(reference)) errors.reference = FORM_MESSAGES.unsupported;

  const note = effectiveNote(form);
  if (note === '') errors.note = FORM_MESSAGES.noteWrite;
  else if (characters(note) > NOTE_MAX) errors.note = FORM_MESSAGES.noteLong;
  else if (UNSUPPORTED.test(note)) errors.note = FORM_MESSAGES.unsupported;

  const valid = blocked === null && Object.keys(errors).length === 0;
  const values = valid && form.direction && amountKobo !== null && preview && !preview.negative
    ? { direction: form.direction, amountKobo, reason, reference: reference === '' ? null : reference, note }
    : null;
  return { values, errors, blocked, preview, amountKobo };
}

export function firstProblem(errors: Partial<Record<FormField, string>>): FormField | null {
  return FORM_FIELDS.find((field) => errors[field] !== undefined) ?? null;
}

export function notificationAmount(amountKobo: number): string {
  return groupedNairaText(amountKobo);
}

function fill(template: string, amountKobo: number, note: string): string {
  return template.split('{amount}').join(notificationAmount(amountKobo)).split('{note}').join(note);
}

export interface RenderedNotice {
  title: string;
  body: string;
}

export function renderNotice(template: TemplateInfo, amountKobo: number, note: string): RenderedNotice | null {
  if (!template.active || template.title === null || template.body === null) return null;
  return { title: fill(template.title, amountKobo, note), body: fill(template.body, amountKobo, note) };
}

export function typedAmount(amountKobo: number): string {
  const whole = Math.floor(amountKobo / KOBO_PER_NAIRA);
  const rest = amountKobo % KOBO_PER_NAIRA;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, '0')}`;
}

export type ConfirmUser = Pick<UserProfile, 'id' | 'full_name' | 'username'>;

export interface ConfirmInput {
  user: ConfirmUser;
  values: AdjustValues;
  preview: BalancePreview;
  context: WalletContext;
  seenBalanceKobo: number | null;
}

function notifyLine(template: TemplateInfo | null, direction: AdjustDirection): string {
  if (template && !template.active) {
    return `The user is not notified, because the ${TEMPLATE_NAMES[direction]} notification is switched off in Notification templates. They still see the message in their transaction history.`;
  }
  return 'The user is notified by push and in the app, and sees the message in their transaction history. The reason and the reference stay internal.';
}

export function adjustConfirmOptions(input: ConfirmInput): ConfirmOptions {
  const { user, values, preview, context, seenBalanceKobo } = input;
  const credit = values.direction === 'credit';
  const amount = formatKobo(values.amountKobo);
  const handle = userHandle(user);
  const template = context.templates ? context.templates[values.direction] : null;
  const consequences = [
    'It applies as soon as you confirm and cannot be edited or undone. A mistake is fixed with an opposite adjustment.',
    notifyLine(template, values.direction),
  ];
  if (context.user.frozen) {
    consequences.push(isDeletionFreeze(context.user)
      ? 'The user is deleting this account. Money left in the wallet stops the deletion from completing.'
      : 'The account is frozen. The adjustment still applies, and it is recorded as made while frozen.');
  }
  if (seenBalanceKobo !== null && seenBalanceKobo !== preview.beforeKobo) {
    consequences.push(
      `The balance changed from ${formatKobo(seenBalanceKobo)} to ${formatKobo(preview.beforeKobo)} while the panel was open. The figures above use the current balance.`,
    );
  }
  const typed = values.amountKobo >= TYPED_FROM_KOBO ? typedAmount(values.amountKobo) : null;
  return {
    tone: 'financial',
    title: credit ? `Credit ${amount} to ${handle}?` : `Debit ${amount} from ${handle}?`,
    message: 'Check every line before you confirm.',
    details: [
      { label: 'User', value: userSummary(user) },
      { label: 'User ID', value: user.id, mono: true },
      { label: 'Direction', value: credit ? 'Credit: money into the wallet' : 'Debit: money out of the wallet' },
      { label: 'Amount', value: amount, emphasis: true },
      { label: 'Balance before', value: formatKobo(preview.beforeKobo) },
      { label: 'Balance after', value: formatKobo(preview.afterKobo), emphasis: true },
      { label: 'Message to the user', value: values.note },
      { label: 'Notification', value: template && !template.active ? 'Not sent: the template is switched off' : 'Push and in-app' },
      { label: 'Reason (internal)', value: values.reason },
      { label: 'Reference (internal)', value: values.reference ?? 'None' },
    ],
    consequences,
    acknowledge: credit
      ? `I have checked that ${amount} should be credited to ${handle}.`
      : `I have checked that ${amount} should be debited from ${handle}.`,
    ...(typed ? { requireTyped: typed } : {}),
    confirmLabel: credit ? `Credit ${amount}` : `Debit ${amount}`,
    pendingLabel: credit ? 'Crediting the wallet…' : 'Debiting the wallet…',
  };
}

export interface AdjustPayload {
  direction: AdjustDirection;
  amount: string;
  reason: string;
  user_note: string;
  reference: string | null;
  expected_balance: string | null;
}

export interface AdjustBody extends AdjustPayload {
  idempotency_key: string;
}

export function adjustPayload(values: AdjustValues, balanceKobo: number | null): AdjustPayload {
  return {
    direction: values.direction,
    amount: koboText(values.amountKobo),
    reason: values.reason,
    user_note: values.note,
    reference: values.reference,
    expected_balance: balanceKobo === null ? null : koboText(balanceKobo),
  };
}

export function samePayload(a: AdjustPayload, b: AdjustPayload): boolean {
  return a.direction === b.direction
    && a.amount === b.amount
    && a.reason === b.reason
    && a.user_note === b.user_note
    && a.reference === b.reference
    && a.expected_balance === b.expected_balance;
}

export interface AttemptState {
  key: string;
  payload: AdjustPayload | null;
  locked: boolean;
}

export function newAttempt(key: string): AttemptState {
  return { key, payload: null, locked: false };
}

export function prepareAttempt(
  state: AttemptState,
  payload: AdjustPayload,
  mint: () => string,
): { state: AttemptState; body: AdjustBody } | null {
  if (state.payload === null || samePayload(state.payload, payload)) {
    if (state.locked && state.payload === null) return null;
    const bound = state.payload ?? payload;
    return { state: { ...state, payload: bound }, body: { ...bound, idempotency_key: state.key } };
  }
  if (state.locked) return null;
  const key = mint();
  return { state: { key, payload, locked: false }, body: { ...payload, idempotency_key: key } };
}

export function retryBody(state: AttemptState): AdjustBody | null {
  return state.payload ? { ...state.payload, idempotency_key: state.key } : null;
}

export function settleAttempt(state: AttemptState, outcome: AdjustOutcome, mint: () => string): AttemptState {
  switch (outcome.kind) {
    case 'applied':
      return { ...state, locked: false };
    case 'unknown':
      return { ...state, locked: true };
    case 'refused':
      if (outcome.reason === 'idempotency_mismatch') return newAttempt(mint());
      return outcome.reason !== null ? { ...state, locked: false } : state;
    default:
      return state;
  }
}

export function mintAdjustKey(): string {
  const source = globalThis.crypto;
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface AdjustNotice {
  text: string;
  tone: ToastTone;
}

export function appliedNotices(receipt: AdjustReceipt, values: Pick<AdjustValues, 'direction' | 'amountKobo'>, handle: string): AdjustNotice[] {
  const { adjustment } = receipt;
  const direction = adjustment.direction ?? values.direction;
  const amountKobo = toKobo(adjustment.amount) ?? values.amountKobo;
  const afterKobo = toKobo(adjustment.balance_after);
  const after = afterKobo === null ? '' : ` The balance is now ${formatKobo(afterKobo)}.`;
  const notices: AdjustNotice[] = [];
  if (receipt.replayed) {
    notices.push({ text: `This adjustment had already been applied, so it was not applied again.${after}`, tone: 'success' });
  } else {
    const verb = DIRECTION_TEXT[direction].done;
    const link = direction === 'credit' ? 'to' : 'from';
    notices.push({ text: `${verb} ${formatKobo(amountKobo)} ${link} ${handle}.${after}`, tone: 'success' });
  }
  if (adjustment.notified === false) {
    notices.push({
      text: `The user was not notified, because the ${TEMPLATE_NAMES[direction]} notification is switched off in Notification templates.`,
      tone: 'warning',
    });
  }
  return notices;
}
