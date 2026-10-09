import type { Permission } from './permissions';
import { isUuid } from './http';
import { maskTail } from './mask';
import { asUuid, sanitizeSearch } from './sanitize';
import { BUSINESS_TZ_LABEL, formatBusinessDate, formatBusinessDateTime, lagosDateToRangeStart } from './time';
import { formatNaira } from '../_ui/money';

export const SEARCH_GROUP_KEYS = [
  'users', 'withdrawals', 'transactions', 'card_submissions', 'coupons', 'flags',
] as const;

export type SearchGroupKey = (typeof SEARCH_GROUP_KEYS)[number];

export type SearchItem = {
  id: string;
  title: string;
  subtitle: string | null;
  meta: string | null;
  status: string | null;
  href: string;
};

export type SearchGroup = {
  key: SearchGroupKey;
  label: string;
  items: SearchItem[];
  more_href: string | null;
};

export type SearchResponse = {
  query: string;
  groups: SearchGroup[];
  partial: Record<string, string>;
};

export type SearchIntentKind = 'id' | 'email' | 'username' | 'phone' | 'account' | 'text';

export type SearchIntent = {
  kind: SearchIntentKind;
  needle: string;
};

export type SearchContext = {
  query: string;
  intent: SearchIntent;
  limit: number;
  signal: AbortSignal;
};

export type SearchRunner = (context: SearchContext) => Promise<readonly SearchItem[]>;

export type SearchRunners = Readonly<Record<SearchGroupKey, SearchRunner>>;

export type GroupFailure = {
  key: SearchGroupKey;
  status: 'failed' | 'timeout';
  code: string;
};

export type SearchRequest = {
  rawQuery: string | null | undefined;
  rawLimit: string | null | undefined;
  can: (permission: Permission) => boolean;
  runners: SearchRunners;
  budgetMs?: number;
  signal?: AbortSignal | null;
  onFailure?: (failure: GroupFailure) => void;
};

export type TaskOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'failed'; reason: unknown }
  | { status: 'timeout' };

export type GroupOutcome =
  | { key: SearchGroupKey; status: 'ok'; items: readonly SearchItem[] }
  | { key: SearchGroupKey; status: 'failed' | 'timeout' };

export type PersonRef = {
  username?: string | null;
  full_name?: string | null;
  email?: string | null;
};

type Embedded<T> = T | T[] | null;

export type UserHit = {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  is_active: boolean | null;
  is_frozen: boolean | null;
  deleted_at: string | null;
  created_at: string | null;
};

export type WithdrawalHit = {
  id: string;
  user_id: string | null;
  amount: number | string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  status: string | null;
  created_at: string | null;
};

export type TransactionHit = {
  id: string;
  type: string | null;
  amount: number | string | null;
  status: string | null;
  created_at: string | null;
  users?: Embedded<PersonRef>;
};

export type SubmissionHit = {
  id: string;
  payout_naira: number | string | null;
  status: string | null;
  created_at: string | null;
  cards?: Embedded<{ name?: string | null }>;
  card_types?: Embedded<{ name?: string | null; country_code?: string | null }>;
  users?: Embedded<PersonRef>;
};

export type CouponHit = {
  id: string;
  code: string;
  brand: string;
  bonus: number | null;
  expiry: string | null;
  state: string;
};

export type FlagHit = {
  id: string;
  transaction_type: string | null;
  amount: number | string | null;
  flag_reason: string | null;
  status: string | null;
  created_at: string | null;
  users?: Embedded<PersonRef>;
};

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_DEFAULT_LIMIT = 5;
export const SEARCH_MAX_LIMIT = 10;
export const SEARCH_BUDGET_MS = 4000;
export const SEARCH_USER_CAP = 100;
export const SEARCH_CARD_CAP = 50;

export const SEARCH_GROUP_ACCESS: Readonly<Record<SearchGroupKey, readonly Permission[]>> = {
  users: ['users.read'],
  withdrawals: ['withdrawals.read'],
  transactions: ['transactions.read'],
  card_submissions: ['cards.read'],
  coupons: ['coupons.read'],
  flags: ['flags.read', 'withdrawals.read'],
};

export const SEARCH_GROUP_LABELS: Readonly<Record<SearchGroupKey, string>> = {
  users: 'Users',
  withdrawals: 'Withdrawals',
  transactions: 'Transactions',
  card_submissions: 'Card submissions',
  coupons: 'Coupons',
  flags: 'Flagged transactions',
};

const DETAIL_PATHS: Readonly<Record<SearchGroupKey, (id: string) => string>> = {
  users: (id) => `/users/${id}`,
  withdrawals: (id) => `/withdrawals?id=${id}`,
  transactions: (id) => `/transactions-overview?id=${id}`,
  card_submissions: (id) => `/card-queue?id=${id}`,
  coupons: (id) => `/coupons?id=${id}`,
  flags: (id) => `/flagged-transactions?id=${id}`,
};

const LIST_SEARCH: Readonly<Record<SearchGroupKey, { path: string; param: string } | null>> = {
  users: { path: '/users', param: 'search' },
  withdrawals: null,
  transactions: { path: '/transactions-overview', param: 'search' },
  card_submissions: null,
  coupons: { path: '/coupons', param: 'q' },
  flags: { path: '/flagged-transactions', param: 'search' },
};

const LEADING_GROUP: Readonly<Record<SearchIntentKind, SearchGroupKey | null>> = {
  id: null,
  email: 'users',
  username: 'users',
  phone: 'users',
  account: 'withdrawals',
  text: null,
};

const COUPON_STATUS: Readonly<Record<string, string>> = { live: 'active' };

const USER_TEXT_COLUMNS = ['full_name', 'username', 'email', 'phone'] as const;
const USER_MATCH_COLUMNS = ['full_name', 'username', 'email'] as const;
const WITHDRAWAL_TEXT_COLUMNS = ['account_name', 'account_number', 'gateway_reference'] as const;
const COUPON_TEXT_COLUMNS = ['code', 'type'] as const;

const HANDLE = /^[\p{L}\p{N}_.-]+$/u;
const EMAIL_LIKE = /^[^@\s]+@[^@\s]*$/;
const COMPLETE_EMAIL = /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/;
const ACCOUNT_NUMBER = /^\d{10}$/;
const PHONE_NUMBER = /^(?:\+\d{8,15}|0\d{10}|234\d{10})$/;
const NUMBER_SEPARATORS = /[\s.-]/g;
const DIGITS_ONLY = /^\d+$/;
const REFERENCE_FRAGMENT = /^[0-9a-f-]{8,}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const LONG_DIGITS = /\d{10,}/g;
const SPACES = /\s+/g;
const SAFE_CODE = /^[A-Za-z0-9_]{1,32}$/;
const PHONE_TAIL = 10;
const REASON_MAX = 80;
const SEPARATOR = ' · ';

export class SearchQueryError extends Error {
  readonly code: string;

  constructor(code: unknown) {
    super('A search query failed.');
    this.name = 'SearchQueryError';
    this.code = typeof code === 'string' && SAFE_CODE.test(code) ? code : 'unknown';
  }
}

export function failureCode(reason: unknown): string {
  if (reason instanceof SearchQueryError) return reason.code;
  if (reason instanceof Error && SAFE_CODE.test(reason.name)) return reason.name;
  return 'unexpected';
}

export function readSearchQuery(raw: string | null | undefined): string {
  return typeof raw === 'string' ? sanitizeSearch(raw) : '';
}

export function isSearchable(query: string): boolean {
  return Array.from(query).length >= SEARCH_MIN_LENGTH;
}

export function parseSearchLimit(raw: string | null | undefined): number {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!DIGITS_ONLY.test(text)) return SEARCH_DEFAULT_LIMIT;
  const value = Number(text);
  if (value < 1) return SEARCH_DEFAULT_LIMIT;
  return Math.min(value, SEARCH_MAX_LIMIT);
}

function phoneTail(compact: string): string {
  const digits = compact.replace(/^\+/, '');
  return digits.length > PHONE_TAIL ? digits.slice(-PHONE_TAIL) : digits;
}

export function detectIntent(query: string): SearchIntent {
  const term = query.trim();
  const id = asUuid(term);
  if (id) return { kind: 'id', needle: id };
  if (term.startsWith('@')) {
    const handle = term.slice(1);
    if (HANDLE.test(handle)) return { kind: 'username', needle: handle.toLowerCase() };
  }
  if (EMAIL_LIKE.test(term)) return { kind: 'email', needle: term.toLowerCase() };
  const compact = term.replace(NUMBER_SEPARATORS, '');
  if (ACCOUNT_NUMBER.test(compact)) return { kind: 'account', needle: compact };
  if (PHONE_NUMBER.test(compact)) return { kind: 'phone', needle: phoneTail(compact) };
  return { kind: 'text', needle: term };
}

export function canSearchGroup(key: SearchGroupKey, can: (permission: Permission) => boolean): boolean {
  return SEARCH_GROUP_ACCESS[key].some((permission) => can(permission));
}

export function permittedGroups(can: (permission: Permission) => boolean): SearchGroupKey[] {
  return SEARCH_GROUP_KEYS.filter((key) => canSearchGroup(key, can));
}

function contains(text: string): string {
  return `%${text}%`;
}

function ilikeAny(columns: readonly string[], text: string): string {
  return columns.map((column) => `${column}.ilike.${contains(text)}`).join(',');
}

function idIn(column: string, ids: readonly string[]): string | null {
  const valid = Array.from(new Set(ids.filter((id) => isUuid(id)).map((id) => id.toLowerCase())))
    .slice(0, SEARCH_USER_CAP);
  return valid.length ? `${column}.in.(${valid.join(',')})` : null;
}

function anyOf(clauses: ReadonlyArray<string | null>): string | null {
  const kept = clauses.filter((clause): clause is string => Boolean(clause));
  return kept.length ? kept.join(',') : null;
}

function searchesOwnText(intent: SearchIntent): boolean {
  return intent.kind === 'text' || intent.kind === 'account';
}

export function usersFilter(intent: SearchIntent): string {
  switch (intent.kind) {
    case 'id':
      return `id.eq.${intent.needle}`;
    case 'username':
      return `username.ilike.${contains(intent.needle)}`;
    case 'email':
      return `email.ilike.${contains(intent.needle)}`;
    case 'phone':
      return `phone.ilike.${contains(intent.needle)}`;
    default:
      return ilikeAny(USER_TEXT_COLUMNS, intent.needle);
  }
}

export function exactUserMatch(intent: SearchIntent): { column: 'username' | 'email'; value: string } | null {
  if (intent.kind === 'username') return { column: 'username', value: intent.needle };
  if (intent.kind === 'email' && COMPLETE_EMAIL.test(intent.needle)) return { column: 'email', value: intent.needle };
  return null;
}

export function userMatchFilter(intent: SearchIntent): string | null {
  switch (intent.kind) {
    case 'id':
      return null;
    case 'username':
    case 'email':
    case 'phone':
      return usersFilter(intent);
    default:
      return ilikeAny(USER_MATCH_COLUMNS, intent.needle);
  }
}

export function withdrawalsFilter(intent: SearchIntent, userIds: readonly string[]): string | null {
  if (intent.kind === 'id') {
    return `id.eq.${intent.needle},user_id.eq.${intent.needle},gateway_reference.eq.${intent.needle}`;
  }
  const own = searchesOwnText(intent)
    ? WITHDRAWAL_TEXT_COLUMNS.map((column) => `${column}.ilike.${contains(intent.needle)}`)
    : [];
  return anyOf([idIn('user_id', userIds), ...own]);
}

export function transactionsFilter(intent: SearchIntent, userIds: readonly string[]): string | null {
  if (intent.kind === 'id') {
    return `id.eq.${intent.needle},user_id.eq.${intent.needle},reference_id.eq.${intent.needle}`;
  }
  const fragment = intent.needle.toLowerCase();
  const reference = searchesOwnText(intent) && REFERENCE_FRAGMENT.test(fragment)
    ? `reference_id.ilike.${fragment}%`
    : null;
  return anyOf([idIn('user_id', userIds), reference]);
}

export function searchesCardNames(intent: SearchIntent): boolean {
  return intent.kind === 'text';
}

export function cardNamePattern(intent: SearchIntent): string {
  return contains(intent.needle);
}

export function submissionsFilter(
  intent: SearchIntent,
  userIds: readonly string[],
  cardIds: readonly string[],
): string | null {
  if (intent.kind === 'id') return `id.eq.${intent.needle},user_id.eq.${intent.needle}`;
  return anyOf([idIn('card_id', cardIds), idIn('user_id', userIds)]);
}

export function couponsFilter(intent: SearchIntent): string | null {
  if (intent.kind === 'id') return `id.eq.${intent.needle}`;
  return searchesOwnText(intent) ? ilikeAny(COUPON_TEXT_COLUMNS, intent.needle) : null;
}

export function flagsFilter(intent: SearchIntent, userIds: readonly string[]): string | null {
  if (intent.kind === 'id') {
    return `id.eq.${intent.needle},transaction_id.eq.${intent.needle},user_id.eq.${intent.needle}`;
  }
  return idIn('user_id', userIds);
}

export function itemHref(key: SearchGroupKey, id: string): string {
  return DETAIL_PATHS[key](encodeURIComponent(id));
}

function listText(key: SearchGroupKey, intent: SearchIntent): string | null {
  switch (key) {
    case 'users':
      return intent.needle;
    case 'transactions':
      return intent.kind === 'phone' ? null : intent.needle;
    case 'coupons':
      return searchesOwnText(intent) ? intent.needle : null;
    case 'flags':
      return intent.kind === 'phone' || intent.kind === 'account' ? null : intent.needle;
    default:
      return null;
  }
}

export function moreHref(key: SearchGroupKey, intent: SearchIntent): string | null {
  const target = LIST_SEARCH[key];
  const text = target ? listText(key, intent) : null;
  if (!target || !text) return null;
  return `${target.path}?${new URLSearchParams({ [target.param]: text }).toString()}`;
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(SPACES, ' ').trim();
  return text === '' ? null : text;
}

function firstOf<T>(value: Embedded<T> | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function joinParts(parts: ReadonlyArray<string | null>): string | null {
  const kept = parts.filter((part): part is string => part !== null && part !== '');
  return kept.length ? kept.join(SEPARATOR) : null;
}

function nairaText(value: unknown): string | null {
  const amount = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(amount) ? formatNaira(amount) : null;
}

function lagosDateTime(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  const formatted = formatBusinessDateTime(text);
  return formatted === '—' ? null : `${formatted} ${BUSINESS_TZ_LABEL}`;
}

function lagosDate(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  const formatted = formatBusinessDate(text);
  return formatted === '—' ? null : formatted;
}

function maskDigits(text: string): string {
  return text.replace(LONG_DIGITS, (run) => maskTail(run));
}

function maskedText(value: unknown): string | null {
  const text = clean(value);
  return text ? maskDigits(text) : null;
}

function reasonText(value: unknown): string | null {
  const text = maskedText(value);
  if (!text) return null;
  const characters = Array.from(text);
  if (characters.length <= REASON_MAX) return characters.join('');
  return `${characters.slice(0, REASON_MAX - 1).join('').trimEnd()}…`;
}

export function handleOf(person: PersonRef | null | undefined): string | null {
  const username = clean(person?.username);
  if (username) return `@${username}`;
  return clean(person?.full_name) ?? clean(person?.email);
}

export function userStatus(row: Pick<UserHit, 'deleted_at' | 'is_frozen' | 'is_active'>): string {
  if (row.deleted_at) return 'deleted';
  if (row.is_frozen === true) return 'frozen';
  return row.is_active === true ? 'active' : 'inactive';
}

export function toUserItem(row: UserHit): SearchItem {
  const name = clean(row.full_name);
  const username = clean(row.username);
  const handle = username ? `@${username}` : null;
  const email = clean(row.email);
  const title = name ?? handle ?? email ?? 'Unnamed user';
  const joined = lagosDate(row.created_at);
  return {
    id: row.id,
    title,
    subtitle: joinParts([handle, email].filter((part) => part !== title)),
    meta: joined ? `Joined ${joined}` : null,
    status: userStatus(row),
    href: itemHref('users', row.id),
  };
}

export function toWithdrawalItem(row: WithdrawalHit, person: PersonRef | null): SearchItem {
  const amount = nairaText(row.amount);
  const handle = handleOf(person);
  const payout = amount ? `${amount} payout` : 'Withdrawal';
  const account = clean(row.account_number);
  return {
    id: row.id,
    title: handle ? `${payout} for ${handle}` : payout,
    subtitle: joinParts([maskedText(row.bank_name), account ? maskTail(account) : null, maskedText(row.account_name)]),
    meta: lagosDateTime(row.created_at),
    status: clean(row.status),
    href: itemHref('withdrawals', row.id),
  };
}

export function toTransactionItem(row: TransactionHit, typeText: string): SearchItem {
  return {
    id: row.id,
    title: joinParts([typeText, nairaText(row.amount)]) ?? 'Transaction',
    subtitle: handleOf(firstOf(row.users)),
    meta: lagosDateTime(row.created_at),
    status: clean(row.status),
    href: itemHref('transactions', row.id),
  };
}

export function toSubmissionItem(row: SubmissionHit): SearchItem {
  const card = firstOf(row.cards);
  const type = firstOf(row.card_types);
  const payout = nairaText(row.payout_naira);
  return {
    id: row.id,
    title: joinParts([clean(card?.name) ?? 'Gift card', clean(type?.name), clean(type?.country_code)]) ?? 'Gift card',
    subtitle: handleOf(firstOf(row.users)),
    meta: joinParts([payout ? `${payout} payout` : null, lagosDateTime(row.created_at)]),
    status: clean(row.status),
    href: itemHref('card_submissions', row.id),
  };
}

function expiryText(expiry: string | null, today: string): string {
  const key = expiry && DATE_KEY.test(expiry) ? expiry : null;
  const day = key ? lagosDate(lagosDateToRangeStart(key)) : null;
  if (!key || !day) return 'No end date';
  return `${key < today ? 'Ended' : 'Ends'} ${day}`;
}

export function couponItemStatus(state: string): string {
  return COUPON_STATUS[state] ?? state;
}

export function toCouponItem(hit: CouponHit, today: string): SearchItem {
  const bonus = hit.bonus !== null && hit.bonus > 0 ? nairaText(hit.bonus) : null;
  return {
    id: hit.id,
    title: clean(hit.code) ?? 'Coupon',
    subtitle: joinParts([clean(hit.brand) ?? 'No brand', bonus ? `${bonus} bonus` : null]),
    meta: expiryText(hit.expiry, today),
    status: clean(hit.state) ? couponItemStatus(hit.state) : null,
    href: itemHref('coupons', hit.id),
  };
}

export function toFlagItem(row: FlagHit, typeText: string | null): SearchItem {
  return {
    id: row.id,
    title: joinParts([typeText ? `${typeText} flag` : 'Flag', nairaText(row.amount)]) ?? 'Flag',
    subtitle: joinParts([handleOf(firstOf(row.users)), reasonText(row.flag_reason)]),
    meta: lagosDateTime(row.created_at),
    status: clean(row.status),
    href: itemHref('flags', row.id),
  };
}

export function mergeHits<T extends { id: string }>(first: readonly T[], second: readonly T[], limit: number): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const hit of [...first, ...second]) {
    if (merged.length >= limit) break;
    if (typeof hit?.id !== 'string' || seen.has(hit.id)) continue;
    seen.add(hit.id);
    merged.push(hit);
  }
  return merged;
}

export function partialMessage(key: SearchGroupKey, status: 'failed' | 'timeout'): string {
  const label = SEARCH_GROUP_LABELS[key];
  return status === 'timeout' ? `${label} took too long to search.` : `${label} could not be searched.`;
}

export function emptySearch(query: string): SearchResponse {
  return { query, groups: [], partial: {} };
}

export function rankGroups(groups: readonly SearchGroup[], intent: SearchIntent): SearchGroup[] {
  const leading = LEADING_GROUP[intent.kind];
  const rank = (group: SearchGroup): number => {
    if (intent.kind === 'id') return group.items.some((item) => item.id === intent.needle) ? 0 : 1;
    return group.key === leading ? 0 : 1;
  };
  return groups
    .map((group, index) => ({ group, index, rank: rank(group) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.group);
}

export function buildSearchResponse(
  query: string,
  intent: SearchIntent,
  outcomes: readonly GroupOutcome[],
  limit: number,
): SearchResponse {
  const groups: SearchGroup[] = [];
  const partial: Record<string, string> = {};
  for (const outcome of outcomes) {
    if (outcome.status !== 'ok') {
      partial[outcome.key] = partialMessage(outcome.key, outcome.status);
      continue;
    }
    const items = mergeHits(outcome.items, [], limit);
    if (items.length === 0) continue;
    groups.push({
      key: outcome.key,
      label: SEARCH_GROUP_LABELS[outcome.key],
      items,
      more_href: moreHref(outcome.key, intent),
    });
  }
  return { query, groups: rankGroups(groups, intent), partial };
}

async function attempt<T>(task: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<TaskOutcome<T>> {
  try {
    return { status: 'ok', value: await task(signal) };
  } catch (reason) {
    return signal.aborted ? { status: 'timeout' } : { status: 'failed', reason };
  }
}

export async function settleWithin<T>(
  tasks: ReadonlyArray<(signal: AbortSignal) => Promise<T>>,
  budgetMs: number,
  outer?: AbortSignal | null,
): Promise<TaskOutcome<T>[]> {
  const controller = new AbortController();
  let expire: () => void = () => undefined;
  const expired = new Promise<TaskOutcome<T>>((resolve) => {
    expire = () => {
      if (controller.signal.aborted) return;
      resolve({ status: 'timeout' });
      controller.abort();
    };
  });
  const timer = setTimeout(() => expire(), Math.max(0, budgetMs));
  const onOuterAbort = () => expire();
  if (outer?.aborted) expire();
  else outer?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    return await Promise.all(tasks.map((task) => Promise.race([attempt(task, controller.signal), expired])));
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

export async function executeSearch(request: SearchRequest): Promise<SearchResponse> {
  const query = readSearchQuery(request.rawQuery);
  if (!isSearchable(query)) return emptySearch(query);
  const keys = permittedGroups(request.can);
  if (keys.length === 0) return emptySearch(query);
  const intent = detectIntent(query);
  const limit = parseSearchLimit(request.rawLimit);
  const settled = await settleWithin(
    keys.map((key) => (signal: AbortSignal) => request.runners[key]({ query, intent, limit, signal })),
    request.budgetMs ?? SEARCH_BUDGET_MS,
    request.signal,
  );
  const outcomes = keys.map((key, index): GroupOutcome => {
    const result = settled[index];
    if (result.status === 'ok') return { key, status: 'ok', items: Array.isArray(result.value) ? result.value : [] };
    request.onFailure?.({
      key,
      status: result.status,
      code: result.status === 'failed' ? failureCode(result.reason) : 'timeout',
    });
    return { key, status: result.status };
  });
  return buildSearchResponse(query, intent, outcomes, limit);
}
