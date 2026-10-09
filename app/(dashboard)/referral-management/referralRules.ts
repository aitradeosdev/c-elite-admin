import { formatNaira } from '../../_ui/money';
import { isUuid } from '../../lib/http';
import { sanitizeSearch } from '../../lib/sanitize';
import { lagosDateToRangeEnd, lagosDateToRangeStart } from '../../lib/time';

export const SETTING_KEYS = [
  'referral_active',
  'referral_referrer_bonus',
  'referral_referee_bonus',
  'referral_min_trade_usd',
  'referral_max_per_day',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

type AmountKey = 'referral_referrer_bonus' | 'referral_referee_bonus' | 'referral_min_trade_usd';

export const REFERRAL_BONUS_MAX = 1_000_000;
export const MIN_TRADE_MAX = 100_000;
export const MAX_PER_DAY_MAX = 10_000;
export const DEFAULT_MIN_TRADE = 50;
export const DEFAULT_MAX_PER_DAY = 10;
export const LARGE_MOVE = 0.5;
export const HUGE_FACTOR = 10;

export const SETTING_LABELS: Readonly<Record<SettingKey, string>> = {
  referral_active: 'Referral programme',
  referral_referrer_bonus: 'Referrer bonus',
  referral_referee_bonus: 'Referred user bonus',
  referral_min_trade_usd: 'Minimum first trade',
  referral_max_per_day: 'Referrals per referrer in 24 hours',
};

const KEY_SET: ReadonlySet<string> = new Set(SETTING_KEYS);
const PLAIN_NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const GROUPED_NUMBER = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const PLAIN_INTEGER = /^\d+$/;
const GROUPED_INTEGER = /^\d{1,3}(?:,\d{3})+$/;
const NAIRA_PREFIX = /^₦\s*/;
const DOLLAR_PREFIX = /^\$\s*/;
const STORED_NUMBER = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/;
const STORED_INTEGER = /^\s*[+-]?\d+\s*$/;
const INT4_MAX = 2_147_483_647;
const INT4_MIN = -2_147_483_648;
const TRUE_WORDS: ReadonlySet<string> = new Set(['true', 't', 'yes', 'y', 'on', '1']);
const FALSE_WORDS: ReadonlySet<string> = new Set(['false', 'f', 'no', 'n', 'off', '0']);
const AMOUNT_FORMAT = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 });
const COUNT_FORMAT = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });
const SHOWN_MAX = 40;
const TOO_FEW = 'Allow at least 1 referral. To stop recording referrals, switch the programme off.';
const NO_REFERRALS = 'No value is saved, so no new referrals are recorded.';

export function isSettingKey(key: string): key is SettingKey {
  return KEY_SET.has(key);
}

export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

export function formatAmount(value: number): string {
  return AMOUNT_FORMAT.format(value);
}

export function plural(value: number, one: string, many: string): string {
  return `${formatCount(value)} ${value === 1 ? one : many}`;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export type SettingCheck = { ok: true; value: string } | { ok: false; message: string };

function accept(value: string): SettingCheck {
  return { ok: true, value };
}

function refuse(message: string): SettingCheck {
  return { ok: false, message };
}

function inputOf(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  return null;
}

function decimalPlaces(text: string): number {
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

interface AmountSpec {
  prefix: RegExp;
  empty: string;
  negative: string;
  max: number;
  maxText: string;
}

const AMOUNT_SPECS: Readonly<Record<AmountKey, AmountSpec>> = {
  referral_referrer_bonus: {
    prefix: NAIRA_PREFIX,
    empty: 'Enter the referrer bonus in naira. Use 0 for no bonus.',
    negative: 'The referrer bonus cannot be negative.',
    max: REFERRAL_BONUS_MAX,
    maxText: `₦${formatAmount(REFERRAL_BONUS_MAX)}`,
  },
  referral_referee_bonus: {
    prefix: NAIRA_PREFIX,
    empty: 'Enter the referred user bonus in naira. Use 0 for no bonus.',
    negative: 'The referred user bonus cannot be negative.',
    max: REFERRAL_BONUS_MAX,
    maxText: `₦${formatAmount(REFERRAL_BONUS_MAX)}`,
  },
  referral_min_trade_usd: {
    prefix: DOLLAR_PREFIX,
    empty: 'Enter the minimum card value for the first trade. Use 0 to count any approved trade.',
    negative: 'The minimum card value cannot be negative.',
    max: MIN_TRADE_MAX,
    maxText: formatAmount(MIN_TRADE_MAX),
  },
};

function checkAmount(text: string, spec: AmountSpec): SettingCheck {
  const cleaned = text.replace(spec.prefix, '');
  if (cleaned === '') return refuse(spec.empty);
  if (cleaned.startsWith('-')) return refuse(spec.negative);
  const plain = GROUPED_NUMBER.test(cleaned) ? cleaned.replace(/,/g, '') : cleaned;
  if (!PLAIN_NUMBER.test(plain)) {
    return refuse(cleaned.includes(',')
      ? 'Use a full stop for decimals and commas only between thousands, like 1,500.50.'
      : 'Enter a number, like 500 or 1,500.50.');
  }
  if (decimalPlaces(plain) > 2) return refuse('Use at most 2 decimal places.');
  const value = Number(plain);
  if (value > spec.max) return refuse(`Use ${spec.maxText} or less.`);
  return accept(String(value));
}

function checkCount(text: string): SettingCheck {
  if (text === '') return refuse('Enter how many referrals one referrer can earn from in 24 hours, like 10.');
  const plain = GROUPED_INTEGER.test(text) ? text.replace(/,/g, '') : text;
  if (!PLAIN_INTEGER.test(plain)) {
    return refuse(text.startsWith('-') ? TOO_FEW : 'Enter a whole number of referrals, like 10.');
  }
  const value = Number(plain);
  if (value < 1) return refuse(TOO_FEW);
  if (value > MAX_PER_DAY_MAX) return refuse(`Use ${formatCount(MAX_PER_DAY_MAX)} or less.`);
  return accept(String(value));
}

function checkActive(text: string): SettingCheck {
  const flag = text.toLowerCase();
  return flag === 'true' || flag === 'false'
    ? accept(flag)
    : refuse('Switch the referral programme on or off (true or false).');
}

export function checkSetting(key: SettingKey, raw: unknown): SettingCheck {
  const text = inputOf(raw);
  if (text === null) return refuse(`${SETTING_LABELS[key]} must be text or a number.`);
  switch (key) {
    case 'referral_active':
      return checkActive(text);
    case 'referral_max_per_day':
      return checkCount(text);
    default:
      return checkAmount(text, AMOUNT_SPECS[key]);
  }
}

function storedNumber(value: string): number | null {
  if (!STORED_NUMBER.test(value)) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function storedEffective(key: SettingKey, value: string): number | boolean | null {
  switch (key) {
    case 'referral_active': {
      if (value === '') return true;
      const word = value.trim().toLowerCase();
      if (TRUE_WORDS.has(word)) return true;
      return FALSE_WORDS.has(word) ? false : null;
    }
    case 'referral_max_per_day': {
      if (value === '') return DEFAULT_MAX_PER_DAY;
      if (!STORED_INTEGER.test(value)) return null;
      const parsed = Number(value.trim());
      return Number.isSafeInteger(parsed) && parsed >= INT4_MIN && parsed <= INT4_MAX ? parsed : null;
    }
    case 'referral_min_trade_usd':
      return storedNumber(value);
    default:
      return value === '' ? 0 : storedNumber(value);
  }
}

export function sameSettingValue(key: SettingKey, a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return a === b;
  if (a === b) return true;
  const left = storedEffective(key, a);
  const right = storedEffective(key, b);
  return left !== null && right !== null && left === right;
}

export interface StoredSetting {
  value: string | null;
  updated_at: string | null;
  exists: boolean;
}

export type StoredSettings = Readonly<Record<SettingKey, StoredSetting>>;

export interface StoredSettingRow {
  key?: unknown;
  value?: unknown;
  updated_at?: unknown;
}

export function presentSettings(rows: readonly StoredSettingRow[]): Record<SettingKey, StoredSetting> {
  const settings = {} as Record<SettingKey, StoredSetting>;
  for (const key of SETTING_KEYS) settings[key] = { value: null, updated_at: null, exists: false };
  for (const row of rows) {
    if (!row || typeof row.key !== 'string' || !isSettingKey(row.key)) continue;
    settings[row.key] = {
      value: typeof row.value === 'string' ? row.value : null,
      updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
      exists: true,
    };
  }
  return settings;
}

export type IssueLevel = 'danger' | 'warning';

export interface SettingIssue {
  level: IssueLevel;
  message: string;
}

export interface SettingReading {
  effective: number | boolean | null;
  issue: SettingIssue | null;
}

function quoted(value: string): string {
  if (value.trim() === '') return 'an empty value';
  return `“${value.length > SHOWN_MAX ? `${value.slice(0, SHOWN_MAX)}…` : value}”`;
}

function unreadable(key: SettingKey, value: string): SettingIssue {
  const kind = key === 'referral_active' ? 'on or off' : key === 'referral_max_per_day' ? 'a whole number' : 'a number';
  const effect = key === 'referral_min_trade_usd'
    ? 'Every card approval fails until it is fixed.'
    : 'Sign-ups that use a referral code fail until it is fixed.';
  return { level: 'danger', message: `Saved as ${quoted(value)}, which the database cannot read as ${kind}. ${effect}` };
}

function missingReading(key: SettingKey, exists: boolean): SettingReading {
  switch (key) {
    case 'referral_active':
      return exists
        ? { effective: true, issue: null }
        : { effective: false, issue: { level: 'warning', message: NO_REFERRALS } };
    case 'referral_max_per_day':
      return exists
        ? { effective: DEFAULT_MAX_PER_DAY, issue: null }
        : { effective: null, issue: { level: 'warning', message: NO_REFERRALS } };
    case 'referral_min_trade_usd':
      return { effective: DEFAULT_MIN_TRADE, issue: null };
    default:
      return exists
        ? { effective: 0, issue: null }
        : { effective: 0, issue: { level: 'warning', message: 'No amount is saved, so new referrals get ₦0.' } };
  }
}

export function readSetting(key: SettingKey, stored: StoredSetting): SettingReading {
  if (stored.value === null) return missingReading(key, stored.exists);
  const effective = storedEffective(key, stored.value);
  if (effective === null) return { effective: null, issue: unreadable(key, stored.value) };
  if (typeof effective === 'number') {
    if ((key === 'referral_referrer_bonus' || key === 'referral_referee_bonus') && effective < 0) {
      return { effective, issue: { level: 'warning', message: 'A negative amount is recorded on new referrals. Use 0 or more.' } };
    }
    if (key === 'referral_max_per_day' && effective < 1) {
      return { effective, issue: { level: 'warning', message: 'At this value no new referrals are recorded.' } };
    }
  }
  return { effective, issue: null };
}

export function settingText(key: SettingKey, reading: SettingReading): string {
  const { effective } = reading;
  if (effective === null) return reading.issue?.level === 'danger' ? 'Unreadable' : 'Not set';
  if (typeof effective === 'boolean') return effective ? 'On' : 'Off';
  switch (key) {
    case 'referral_max_per_day':
      return plural(effective, 'referral', 'referrals');
    case 'referral_min_trade_usd':
      return formatAmount(effective);
    default:
      return formatNaira(effective);
  }
}

export function inputText(key: SettingKey, stored: StoredSetting): string {
  if (key === 'referral_active') {
    const { effective } = readSetting(key, stored);
    return effective === null ? '' : effective ? 'true' : 'false';
  }
  return stored.value === null ? '' : stored.value.trim();
}

export function settingIssues(settings: StoredSettings): Array<{ key: SettingKey; issue: SettingIssue }> {
  const issues: Array<{ key: SettingKey; issue: SettingIssue }> = [];
  for (const key of SETTING_KEYS) {
    const { issue } = readSetting(key, settings[key]);
    if (issue) issues.push({ key, issue });
  }
  return issues;
}

export function latestUpdate(settings: StoredSettings): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const key of SETTING_KEYS) {
    const stamp = settings[key].updated_at;
    const time = stamp ? Date.parse(stamp) : Number.NaN;
    if (stamp && Number.isFinite(time) && time > latestTime) {
      latest = stamp;
      latestTime = time;
    }
  }
  return latest;
}

export function moveNote(from: number | null, to: number | null): string {
  if (from === null || to === null || from <= 0 || to <= 0) return '';
  if (to / from >= HUGE_FACTOR || from / to >= HUGE_FACTOR) return ' That is a tenfold change or more: check it is not a typo.';
  return Math.abs(to - from) / from >= LARGE_MOVE ? ' Check this is not a typo.' : '';
}

export type ReferralStatus = 'awaiting' | 'unclaimed' | 'partly_claimed' | 'claimed' | 'no_bonus';

export const STATUS_FILTERS = ['awaiting', 'unclaimed', 'paid'] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_LABELS: Readonly<Record<ReferralStatus, string>> = {
  awaiting: 'Awaiting first trade',
  unclaimed: 'Ready to claim',
  partly_claimed: 'Partly claimed',
  claimed: 'Paid out',
  no_bonus: 'No bonus',
};

export const STATUS_TONES: Readonly<Record<ReferralStatus, 'success' | 'warning' | 'neutral'>> = {
  awaiting: 'neutral',
  unclaimed: 'warning',
  partly_claimed: 'warning',
  claimed: 'success',
  no_bonus: 'neutral',
};

export const STATUS_FILTER_LABELS: Readonly<Record<StatusFilter, string>> = {
  awaiting: 'Awaiting first trade',
  unclaimed: 'Bonus to claim',
  paid: 'Paid out',
};

export interface ReferralFacts {
  first_trade_completed?: unknown;
  referrer_bonus_amount?: unknown;
  referee_bonus_amount?: unknown;
  referrer_credited?: unknown;
  referee_credited?: unknown;
}

export function toAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return typeof value === 'string' ? storedNumber(value) : null;
}

function payable(amount: unknown): boolean {
  const value = toAmount(amount);
  return value !== null && value > 0;
}

export function referralStatus(row: ReferralFacts): ReferralStatus {
  if (row.first_trade_completed !== true) return 'awaiting';
  const sides = [
    { pays: payable(row.referrer_bonus_amount), claimed: row.referrer_credited === true },
    { pays: payable(row.referee_bonus_amount), claimed: row.referee_credited === true },
  ].filter((side) => side.pays);
  if (sides.length === 0) return 'no_bonus';
  const claimed = sides.filter((side) => side.claimed).length;
  if (claimed === sides.length) return 'claimed';
  return claimed === 0 ? 'unclaimed' : 'partly_claimed';
}

export function owedAmount(row: ReferralFacts): number {
  if (row.first_trade_completed !== true) return 0;
  let owed = 0;
  const referrer = toAmount(row.referrer_bonus_amount);
  if (referrer !== null && referrer > 0 && row.referrer_credited !== true) owed += referrer;
  const referee = toAmount(row.referee_bonus_amount);
  if (referee !== null && referee > 0 && row.referee_credited !== true) owed += referee;
  return roundMoney(owed);
}

export function statusMatches(filter: StatusFilter, row: ReferralFacts): boolean {
  const status = referralStatus(row);
  if (filter === 'awaiting') return status === 'awaiting';
  if (filter === 'unclaimed') return status === 'unclaimed' || status === 'partly_claimed';
  return status === 'claimed';
}

export type SideState = 'none' | 'locked' | 'unclaimed' | 'claimed';

export function sideState(firstTrade: boolean, amount: number | null, credited: boolean): SideState {
  if (amount === null || amount <= 0) return 'none';
  if (credited) return 'claimed';
  return firstTrade ? 'unclaimed' : 'locked';
}

export interface FilterPlan {
  firstTrade: 'done' | 'not_done' | null;
  fromIso: string | null;
  toIso: string | null;
  groups: string[][];
}

const UNCLAIMED_GROUP: readonly string[] = [
  'and(referrer_credited.not.is.true,referrer_bonus_amount.gt.0)',
  'and(referee_credited.not.is.true,referee_bonus_amount.gt.0)',
];

const PAID_GROUPS: ReadonlyArray<readonly string[]> = [
  ['referrer_bonus_amount.gt.0', 'referee_bonus_amount.gt.0'],
  ['referrer_credited.is.true', 'referrer_bonus_amount.lte.0', 'referrer_bonus_amount.is.null'],
  ['referee_credited.is.true', 'referee_bonus_amount.lte.0', 'referee_bonus_amount.is.null'],
];

export function statusPlan(filter: StatusFilter | null): Pick<FilterPlan, 'firstTrade' | 'groups'> {
  switch (filter) {
    case 'awaiting':
      return { firstTrade: 'not_done', groups: [] };
    case 'unclaimed':
      return { firstTrade: 'done', groups: [[...UNCLAIMED_GROUP]] };
    case 'paid':
      return { firstTrade: 'done', groups: PAID_GROUPS.map((group) => [...group]) };
    default:
      return { firstTrade: null, groups: [] };
  }
}

export function combineGroups(groups: ReadonlyArray<ReadonlyArray<string>>): string | null {
  const live = groups.filter((group) => group.length > 0);
  if (live.length === 0) return null;
  if (live.length === 1) return live[0].join(',');
  return `and(${live.map((group) => (group.length === 1 ? group[0] : `or(${group.join(',')})`)).join(',')})`;
}

export const SEARCH_USER_CAP = 50;

export function userSearchFilter(search: string): string {
  const pattern = `%${search}%`;
  return `username.ilike.${pattern},full_name.ilike.${pattern},referral_code.ilike.${pattern}`;
}

export function searchGroup(search: string, userIds: readonly string[]): string[] {
  const ids = userIds.filter((id) => isUuid(id)).slice(0, SEARCH_USER_CAP);
  const clauses: string[] = [];
  if (ids.length > 0) {
    const list = ids.join(',');
    clauses.push(`referrer_id.in.(${list})`, `referee_id.in.(${list})`);
  }
  if (isUuid(search)) {
    const id = search.toLowerCase();
    clauses.push(`id.eq.${id}`, `referrer_id.eq.${id}`, `referee_id.eq.${id}`);
  }
  return clauses;
}

export const LEGACY_PAGE_SIZE = 500;
export const MAX_PAGE_SIZE = 500;
export const MAX_PAGE = 1_000_000;
export const SORT_KEYS = ['created_at', 'first_trade_at'] as const;

export type SortKey = (typeof SORT_KEYS)[number];

export interface ListQuery {
  page: number;
  pageSize: number;
  search: string;
  status: StatusFilter | null;
  dateFrom: string | null;
  dateTo: string | null;
  fromIso: string | null;
  toIso: string | null;
  sort: SortKey;
  ascending: boolean;
  withStats: boolean;
}

export type ListQueryCheck = { ok: true; query: ListQuery } | { ok: false; message: string };

function positiveInt(raw: string | null, fallback: number, max: number): number {
  const text = (raw ?? '').trim();
  if (!/^\d+$/.test(text)) return fallback;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

function isStatusFilter(value: string): value is StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(value);
}

function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

export function readListQuery(params: URLSearchParams): ListQueryCheck {
  const rawStatus = (params.get('status') ?? '').trim();
  if (rawStatus !== '' && !isStatusFilter(rawStatus)) {
    return { ok: false, message: 'Unknown status filter. Use awaiting, unclaimed or paid.' };
  }
  const dateFrom = (params.get('date_from') ?? '').trim() || null;
  const dateTo = (params.get('date_to') ?? '').trim() || null;
  const fromIso = dateFrom ? lagosDateToRangeStart(dateFrom) : null;
  const toIso = dateTo ? lagosDateToRangeEnd(dateTo) : null;
  if ((dateFrom && !fromIso) || (dateTo && !toIso)) {
    return { ok: false, message: 'Dates must be calendar days in YYYY-MM-DD format.' };
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { ok: false, message: 'The start date must be on or before the end date.' };
  }
  const rawSort = (params.get('sort') ?? '').trim();
  return {
    ok: true,
    query: {
      page: positiveInt(params.get('page'), 1, MAX_PAGE),
      pageSize: positiveInt(params.get('page_size') ?? params.get('limit'), LEGACY_PAGE_SIZE, MAX_PAGE_SIZE),
      search: sanitizeSearch(params.get('search') ?? ''),
      status: rawStatus === '' ? null : (rawStatus as StatusFilter),
      dateFrom,
      dateTo,
      fromIso,
      toIso,
      sort: isSortKey(rawSort) ? rawSort : 'created_at',
      ascending: params.get('dir') === 'asc',
      withStats: params.get('stats') !== '0',
    },
  };
}

export function buildFilterPlan(
  query: Pick<ListQuery, 'status' | 'fromIso' | 'toIso'>,
  search: readonly string[] | null,
): FilterPlan {
  const base = statusPlan(query.status);
  return {
    firstTrade: base.firstTrade,
    fromIso: query.fromIso,
    toIso: query.toIso,
    groups: search && search.length > 0 ? [[...search], ...base.groups] : base.groups,
  };
}

export interface StoredReferral extends ReferralFacts {
  id: string;
  referrer_id: string | null;
  referee_id: string | null;
  first_trade_at: string | null;
  created_at: string | null;
}

export interface UserBrief {
  id: string;
  username: string | null;
  full_name: string | null;
}

export interface ReferralLogRow {
  id: string;
  referrer_username: string;
  referee_username: string;
  created_at: string | null;
  first_trade_at: string | null;
  first_trade_completed: boolean;
  referrer_bonus_amount: number | null;
  referee_bonus_amount: number | null;
  referrer_credited: boolean;
  referee_credited: boolean;
  referrer_id: string | null;
  referee_id: string | null;
  referrer_name: string | null;
  referee_name: string | null;
  status: ReferralStatus;
  owed: number;
}

export const NO_USERNAME = '—';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function presentReferral(row: StoredReferral, users: ReadonlyMap<string, UserBrief>): ReferralLogRow {
  const referrer = row.referrer_id ? users.get(row.referrer_id) : undefined;
  const referee = row.referee_id ? users.get(row.referee_id) : undefined;
  return {
    id: row.id,
    referrer_username: text(referrer?.username) ?? NO_USERNAME,
    referee_username: text(referee?.username) ?? NO_USERNAME,
    created_at: row.created_at,
    first_trade_at: row.first_trade_at,
    first_trade_completed: row.first_trade_completed === true,
    referrer_bonus_amount: toAmount(row.referrer_bonus_amount),
    referee_bonus_amount: toAmount(row.referee_bonus_amount),
    referrer_credited: row.referrer_credited === true,
    referee_credited: row.referee_credited === true,
    referrer_id: row.referrer_id,
    referee_id: row.referee_id,
    referrer_name: text(referrer?.full_name),
    referee_name: text(referee?.full_name),
    status: referralStatus(row),
    owed: owedAmount(row),
  };
}

export interface OwedTotals {
  count: number;
  sum: number;
  partial: boolean;
}

export interface ReferralStats {
  total_referrals: number;
  pending_payout: number;
  total_paid_out: number;
  awaiting_trade: number;
  completed: number;
  unclaimed: number;
  paid_to_referrers: number;
  pending_payout_partial: boolean;
}

function wholeCount(value: unknown): number | null {
  const amount = toAmount(value);
  return amount === null || amount < 0 ? null : Math.round(amount);
}

export function buildStats(rpc: unknown, owed: OwedTotals): ReferralStats | null {
  const row: unknown = Array.isArray(rpc) ? rpc[0] : rpc;
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const total = wholeCount(record.total);
  const completed = wholeCount(record.completed);
  const paid = toAmount(record.total_paid);
  if (total === null || completed === null || paid === null) return null;
  return {
    total_referrals: total,
    pending_payout: roundMoney(owed.sum),
    total_paid_out: roundMoney(paid),
    awaiting_trade: Math.max(0, total - completed),
    completed,
    unclaimed: owed.count,
    paid_to_referrers: roundMoney(paid),
    pending_payout_partial: owed.partial,
  };
}
