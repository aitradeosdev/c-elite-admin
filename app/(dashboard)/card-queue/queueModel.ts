import type { SortState, TableSkeletonColumn } from '../../_ui';
import type { RealtimeSignal } from '../../_ui/realtime/RealtimeSignals';

export type QueueTab = 'pending' | 'disputed' | 'approved' | 'rejected' | 'all';

export const DEFAULT_TAB: QueueTab = 'pending';

export const QUEUE_TABS: ReadonlyArray<{ value: QueueTab; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'disputed', label: 'Disputes' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

export const PAGE_SIZE = 50;

export const SIGNAL_GAP_MS = 2000;

export function liveNote(live: boolean): string | undefined {
  return live ? 'Updates live' : undefined;
}

export interface QueueQuery {
  tab: QueueTab;
  search: string;
  from: string | null;
  to: string | null;
  page: number;
  sort: SortState | null;
}

export function queueParams(query: QueueQuery): string {
  const params = new URLSearchParams();
  if (query.tab !== 'all') params.set('status', query.tab);
  if (query.search) params.set('search', query.search);
  if (query.from) params.set('date_from', query.from);
  if (query.to) params.set('date_to', query.to);
  if (query.sort) {
    params.set('sort', query.sort.key);
    params.set('dir', query.sort.dir);
  }
  params.set('page', String(query.page));
  params.set('limit', String(PAGE_SIZE));
  return params.toString();
}

export function sameQueueTab(previousKey: string, nextKey: string): boolean {
  return new URLSearchParams(previousKey).get('status') === new URLSearchParams(nextKey).get('status');
}

export interface QueueRefresh {
  readonly list: boolean;
  readonly detail: boolean;
}

export class DecisionGate {
  private openId: string | null = null;
  private deciding = false;
  private stale = false;
  private settledId: string | null = null;
  private readonly changedIds = new Set<string>();

  setOpenId(id: string | null): void {
    this.openId = id?.toLowerCase() ?? null;
  }

  begin(): boolean {
    if (this.deciding) return false;
    this.deciding = true;
    return true;
  }

  signal(signal: RealtimeSignal): QueueRefresh {
    const id = signal.kind === 'signal' ? signal.id.toLowerCase() : null;
    if (!this.deciding) return { list: true, detail: id !== null && id === this.openId };
    this.stale = true;
    if (id !== null) this.changedIds.add(id);
    return { list: false, detail: false };
  }

  settle(id: string): void {
    if (this.deciding) this.settledId = id.toLowerCase();
  }

  end(): QueueRefresh {
    const openId = this.openId;
    const refresh: QueueRefresh = {
      list: this.stale,
      detail: openId !== null && openId !== this.settledId && this.changedIds.has(openId),
    };
    this.deciding = false;
    this.stale = false;
    this.settledId = null;
    this.changedIds.clear();
    return refresh;
  }
}

export const QUEUE_SKELETON_COLUMNS: ReadonlyArray<TableSkeletonColumn> = [
  { width: 116, lines: 2 },
  { width: 104, lines: 2 },
  { width: 120, lines: 2 },
  { width: 48, align: 'right' },
  { width: 88, align: 'right' },
  { width: 64 },
  { width: 156, align: 'right', button: true },
];

export const REJECT_REASONS = [
  'Card already redeemed',
  'Invalid card code',
  'Card image unclear / unreadable',
  'Wrong card type selected',
  'Wrong denomination',
  'Duplicate submission',
];

export const CORRECTION_NOTES = [
  'Card partially redeemed — credited the actual usable balance',
  'Card face value differs from submitted amount',
  'Wrong card type selected — corrected to the right one',
  'Denomination mismatch — adjusted to match card value',
  'Partial approval — unusable portion excluded',
];

export interface QueueUser {
  id?: string | null;
  full_name?: string | null;
  username?: string | null;
  email?: string | null;
}

export interface QueueRow {
  id: string;
  amount_foreign: number | string | null;
  payout_naira: number | string | null;
  status: string;
  created_at: string;
  rejection_reason: string | null;
  dispute_message: string | null;
  users: QueueUser | null;
  cards: { name?: string | null } | null;
  card_types: { name?: string | null; country_code?: string | null } | null;
}

export interface Denomination {
  id: string;
  card_type_id?: string;
  range_label: string | null;
  min_value: number | string | null;
  max_value: number | string | null;
  rate_naira: number | string | null;
}

export interface CardTypeOption {
  id: string;
  name: string;
  country_code: string | null;
  denominations: Denomination[];
}

export interface Submission extends QueueRow {
  rate_at_submission: number | string | null;
  submitted_fields: Record<string, unknown> | null;
  card_images: string[];
  dispute_images: string[];
  coupon_code: string | null;
  coupon_bonus: number | string | null;
  card_id: string | null;
  card_type_id: string | null;
  cards: { id?: string | null; name?: string | null } | null;
  card_types: { id?: string | null; name?: string | null; country_code?: string | null } | null;
  range_label_at_submission: string | null;
  country_name: string | null;
  currency_symbol: string | null;
  card_types_for_card: CardTypeOption[];
  field_labels: Record<string, string>;
}

export interface QueueCounts {
  pending: number | null;
  disputed: number | null;
}

export type Decision = 'approve' | 'overturn' | 'reject' | 'uphold';

export interface CorrectionPayload {
  card_type_id?: string;
  amount_foreign?: number;
  correction_note?: string;
}

const STATUS_TEXT: Readonly<Record<string, string>> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  disputed: 'Disputed',
  dispute_resolved: 'Dispute closed',
};

export function statusText(status: string): string {
  return STATUS_TEXT[status] || (status || 'Unknown').replace(/_/g, ' ');
}

export function userHandle(user: QueueUser | null | undefined): string {
  if (user?.username) return `@${user.username}`;
  return user?.full_name || 'Unknown user';
}

export function cardName(row: Pick<QueueRow, 'cards'>): string {
  return row.cards?.name || 'Gift card';
}

export function cardDetail(row: Pick<QueueRow, 'card_types'>): string {
  return [row.card_types?.name, row.card_types?.country_code].filter(Boolean).join(' · ');
}

export function formatForeignAmount(value: number | string | null | undefined, symbol?: string | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  const text = Number.isInteger(amount)
    ? amount.toLocaleString('en-US')
    : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol || ''}${text}`;
}

export interface Decimal {
  units: bigint;
  scale: number;
}

const DECIMAL_TEXT = /^(\d+)(?:\.(\d*))?$/;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);

function pow10(exponent: number): bigint {
  let result = ONE;
  for (let i = 0; i < exponent; i++) result *= TEN;
  return result;
}

export function parseDecimal(value: unknown): Decimal | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return null;
  }
  if (text.startsWith('.')) text = `0${text}`;
  const match = DECIMAL_TEXT.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? '';
  return { units: BigInt(match[1] + fraction), scale: fraction.length };
}

export function isPositive(value: Decimal | null): value is Decimal {
  return value !== null && value.units > ZERO;
}

export function compareDecimal(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const left = a.units * pow10(scale - a.scale);
  const right = b.units * pow10(scale - b.scale);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function roundToKobo(units: bigint, scale: number): bigint {
  if (scale <= 2) return units * pow10(2 - scale);
  const divisor = pow10(scale - 2);
  const quotient = units / divisor;
  const remainder = units % divisor;
  return remainder * TWO >= divisor ? quotient + ONE : quotient;
}

export function toKobo(value: unknown): bigint | null {
  const parsed = parseDecimal(value);
  return parsed ? roundToKobo(parsed.units, parsed.scale) : null;
}

export function multiplyToKobo(a: Decimal, b: Decimal): bigint {
  return roundToKobo(a.units * b.units, a.scale + b.scale);
}

export function koboText(kobo: bigint): string {
  const whole = kobo / HUNDRED;
  const fraction = kobo % HUNDRED;
  return `${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

export function matchDenomination(type: CardTypeOption | undefined, amount: Decimal | null): Denomination | null {
  if (!type || !isPositive(amount)) return null;
  let best: Denomination | null = null;
  let bestMin: Decimal | null = null;
  for (const denomination of type.denominations || []) {
    const min = parseDecimal(denomination.min_value);
    const max = parseDecimal(denomination.max_value);
    if (!min || !max) continue;
    if (compareDecimal(amount, min) < 0 || compareDecimal(amount, max) > 0) continue;
    if (!best || !bestMin || compareDecimal(min, bestMin) > 0 || (compareDecimal(min, bestMin) === 0 && denomination.id > best.id)) {
      best = denomination;
      bestMin = min;
    }
  }
  return best;
}
