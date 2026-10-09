import type { ApiBody } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { METADATA_MASK_KEYS, maskMetadata, maskTail } from '../../lib/mask';
import type { SortState } from '../../_ui';

export interface TransactionUser {
  id?: string | null;
  username?: string | null;
  full_name?: string | null;
  email?: string | null;
}

export type Metadata = Record<string, unknown>;

export interface Transaction {
  id: string;
  user_id: string | null;
  type: string | null;
  amount: number | string | null;
  status: string | null;
  reference_id: string | null;
  metadata: Metadata | null;
  created_at: string;
  users?: TransactionUser | null;
}

export interface Capabilities {
  users: boolean;
  withdrawals: boolean;
  cards: boolean;
}

export interface LegacyStats {
  totalCount: number;
  totalAmount: number;
  todayCount: number;
  todayAmount: number;
}

export interface TodaySummary {
  date: string;
  count: number | null;
  success_volume: number | null;
}

export interface ListSummary {
  stats: LegacyStats | null;
  today: TodaySummary | null;
  error: string | null;
}

export interface ListResult {
  transactions: Transaction[];
  total: number;
  searchCapped: boolean;
  summary: ListSummary | null;
}

export interface DetailResult {
  transaction: Transaction;
}

export interface ApiEnvelope {
  success?: boolean;
  error?: string;
  message?: string;
  code?: string;
  request_id?: string;
}

export interface ExportRow {
  ID: string;
  User: string;
  Email: string;
  Type: string;
  Amount: number | string | null;
  Status: string;
  Reference: string;
  Date: string;
  DateLagos?: string;
}

export interface ExportResponse extends ApiEnvelope {
  rows?: ExportRow[];
  total?: number;
  truncated?: boolean;
}

export interface FilterState {
  search: string;
  type: string;
  status: string;
  from: string | null;
  to: string | null;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

export type MetaKind = 'money' | 'datetime' | 'masked' | 'id' | 'json' | 'empty' | 'text';

export interface MetaRow {
  key: string;
  label: string;
  kind: MetaKind;
  text: string;
}

export interface RelatedLink {
  href: string;
  label: string;
}

export const SEARCH_MAX = 64;

const FILTER_TOKEN = /^[a-z0-9_]{1,40}$/;
const MAX_FILTER_TOKENS = 16;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const TYPE_LABELS: Readonly<Record<string, string>> = {
  giftcard_credit: 'Gift card credit',
  withdrawal: 'Withdrawal',
  withdrawal_refund: 'Withdrawal refund',
  airtime: 'Airtime',
  data: 'Data',
  cable: 'Cable TV',
  electricity: 'Electricity',
  signup_bonus: 'Sign-up bonus',
  giftbox_bonus: 'Giftbox bonus',
  referral_bonus: 'Referral bonus',
  level_bonus: 'Level bonus',
  bonus_redeem: 'Bonus redemption',
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'Pending',
  pending_review: 'Pending review',
  processing: 'Processing',
  success: 'Success',
  failed: 'Failed',
};

const META_LABELS: Readonly<Record<string, string>> = {
  submission_id: 'Submission ID',
  bank_name: 'Bank',
  account_name: 'Account name',
  account_number: 'Account number',
  fee: 'Fee',
  reason: 'Reason',
  failure_reason: 'Failure reason',
  rejection_reason: 'Rejection reason',
  disputed_at: 'Disputed',
  provider: 'Provider',
  provider_label: 'Provider name',
  recipient: 'Recipient',
  recipient_name: 'Recipient name',
  plan_label: 'Plan',
  variation_code: 'Variation code',
  meter_type: 'Meter type',
  units: 'Units',
  electricity_token: 'Electricity token',
};

const META_ORDER = Object.keys(META_LABELS);
const MONEY_KEYS = new Set(['fee']);
const MASKED_KEYS: ReadonlySet<string> = new Set(METADATA_MASK_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function humanize(key: string): string {
  const label = key.replace(/[_-]+/g, ' ').trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : '—';
}

export function normalizeTokens(raw: string | null | undefined): string {
  const tokens = Array.from(
    new Set(String(raw ?? '').split(',').map((token) => token.trim().toLowerCase()).filter(Boolean)),
  ).filter((token) => FILTER_TOKEN.test(token));
  return tokens.slice(0, MAX_FILTER_TOKENS).sort().join(',');
}

function option(value: string, label: string): SelectOption {
  return { value: normalizeTokens(value), label };
}

export const TYPE_GROUPS: readonly SelectGroup[] = [
  {
    label: 'Gift cards',
    options: [option('giftcard_credit', 'Gift card credits')],
  },
  {
    label: 'Withdrawals',
    options: [
      option('withdrawal,withdrawal_refund', 'All withdrawal activity'),
      option('withdrawal', 'Withdrawals'),
      option('withdrawal_refund', 'Withdrawal refunds'),
    ],
  },
  {
    label: 'Bills',
    options: [
      option('airtime,data,cable,electricity', 'All bills'),
      option('airtime', 'Airtime'),
      option('data', 'Data'),
      option('cable', 'Cable TV'),
      option('electricity', 'Electricity'),
    ],
  },
  {
    label: 'Bonuses',
    options: [
      option('signup_bonus,giftbox_bonus,referral_bonus,level_bonus,bonus_redeem', 'All bonuses'),
      option('signup_bonus', 'Sign-up bonuses'),
      option('giftbox_bonus', 'Giftbox bonuses'),
      option('referral_bonus', 'Referral bonuses'),
      option('level_bonus', 'Level bonuses'),
      option('bonus_redeem', 'Bonus redemptions'),
    ],
  },
];

export const STATUS_OPTIONS: readonly SelectOption[] = Object.entries(STATUS_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const KNOWN_TYPE_VALUES = new Set(TYPE_GROUPS.flatMap((group) => group.options.map((entry) => entry.value)));
const KNOWN_STATUS_VALUES = new Set(STATUS_OPTIONS.map((entry) => entry.value));

export function typeLabel(type: string | null | undefined): string {
  const key = String(type ?? '').trim();
  if (!key) return 'Unknown type';
  return TYPE_LABELS[key] ?? humanize(key);
}

export function statusText(status: string | null | undefined): string {
  const key = String(status ?? '').trim();
  if (!key) return 'Unknown';
  return STATUS_LABELS[key] ?? humanize(key);
}

export function isKnownType(value: string): boolean {
  return KNOWN_TYPE_VALUES.has(value);
}

export function isKnownStatus(value: string): boolean {
  return KNOWN_STATUS_VALUES.has(value);
}

export function tokensLabel(value: string, label: (token: string) => string): string {
  return value.split(',').filter(Boolean).map(label).join(', ');
}

export function validId(raw: string | null | undefined): string | null {
  return isUuid(raw) ? raw.toLowerCase() : null;
}

export function filtersActive(filters: FilterState): boolean {
  return Boolean(filters.search || filters.type || filters.status || filters.from || filters.to);
}

function filterParams(filters: FilterState, range: { from: string | null; to: string | null }): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  if (range.from) params.set('date_from', range.from);
  if (range.to) params.set('date_to', range.to);
  return params;
}

function applySort(params: URLSearchParams, sort: SortState | null): void {
  if (!sort) return;
  params.set('sort', sort.key);
  params.set('dir', sort.dir);
}

export function filterQuery(filters: FilterState): string {
  return filterParams(filters, filters).toString();
}

export function buildListQuery(filters: FilterState, sort: SortState | null, page: number, limit: number): string {
  const params = filterParams(filters, filters);
  applySort(params, sort);
  params.set('page', String(page));
  params.set('limit', String(limit));
  return params.toString();
}

export function buildExportQuery(
  filters: FilterState,
  sort: SortState | null,
  range: { from: string | null; to: string | null },
  format: 'csv' | 'pdf',
): string {
  const params = filterParams(filters, range);
  applySort(params, sort);
  params.set(format, '1');
  return params.toString();
}

export function messageOf(body: ApiEnvelope | null | undefined, fallback: string): string {
  return (body?.message || body?.error || '').trim() || fallback;
}

export function userHandle(user: TransactionUser | null | undefined, userId?: string | null): string {
  if (user?.username) return `@${user.username}`;
  if (user?.full_name) return user.full_name;
  if (user?.email) return user.email;
  return userId ? 'Unknown user' : 'No user';
}

export function relatedLink(transaction: Transaction, can: Capabilities): RelatedLink | null {
  const reference = validId(transaction.reference_id);
  if (!reference) return null;
  if ((transaction.type === 'withdrawal' || transaction.type === 'withdrawal_refund') && can.withdrawals) {
    return { href: `/withdrawals?id=${reference}`, label: 'Open withdrawal' };
  }
  if (transaction.type === 'giftcard_credit' && can.cards) {
    return { href: `/card-queue?id=${reference}`, label: 'Open card submission' };
  }
  return null;
}

function readSummary(body: ApiBody): ListSummary {
  const partial = isRecord(body.partial) ? body.partial : null;
  const failures = [text(partial?.stats), text(partial?.today)].filter((entry): entry is string => entry !== null);
  return {
    stats: isRecord(body.stats) ? (body.stats as unknown as LegacyStats) : null,
    today: isRecord(body.today) ? (body.today as unknown as TodaySummary) : null,
    error: failures.length ? failures.join(' ') : null,
  };
}

export function toListResult(body: ApiBody): ListResult | null {
  if (!Array.isArray(body.transactions)) return null;
  return {
    transactions: body.transactions as Transaction[],
    total: Math.max(0, Number(body.total) || 0),
    searchCapped: body.search_capped === true,
    summary: body.summary === 'full' ? readSummary(body) : null,
  };
}

export function toDetail(body: ApiBody): DetailResult | null {
  const transaction = body.transaction;
  if (!isRecord(transaction) || typeof transaction.id !== 'string') return null;
  return { transaction: transaction as unknown as Transaction };
}

function metaRank(key: string): number {
  const index = META_ORDER.indexOf(key);
  return index === -1 ? META_ORDER.length : index;
}

function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

function describeMeta(key: string, value: unknown): MetaRow {
  const label = META_LABELS[key] ?? humanize(key);
  if (value === null || value === undefined || value === '') return { key, label, kind: 'empty', text: '—' };
  if (MASKED_KEYS.has(key)) return { key, label, kind: 'masked', text: maskTail(value) };
  if (MONEY_KEYS.has(key) && isNumeric(value)) return { key, label, kind: 'money', text: String(value) };
  if (typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))) {
    return { key, label, kind: 'datetime', text: value };
  }
  if (typeof value === 'string' && isUuid(value)) return { key, label, kind: 'id', text: value };
  if (typeof value === 'boolean') return { key, label, kind: 'text', text: value ? 'Yes' : 'No' };
  if (typeof value === 'object') return { key, label, kind: 'json', text: JSON.stringify(maskMetadata(value)) };
  return { key, label, kind: 'text', text: String(value) };
}

export function metadataRows(metadata: Metadata | null | undefined): MetaRow[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  return Object.keys(metadata)
    .sort((a, b) => metaRank(a) - metaRank(b) || a.localeCompare(b))
    .map((key) => describeMeta(key, metadata[key]));
}
