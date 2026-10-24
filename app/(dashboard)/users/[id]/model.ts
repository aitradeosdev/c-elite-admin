import { isUuid } from '../../../lib/http';
import type { ApiBody, ApiResult } from '../../../lib/apiClient';
import type { BadgeTone, SortState, ToastTone } from '../../../_ui';

export type SectionKey = 'transactions' | 'devices' | 'logins';

export type AccountState = 'deleted' | 'frozen' | 'active' | 'inactive';

export type ActionKind = 'freeze' | 'unfreeze' | 'delete' | 'finish';

export type DeletionKind = Extract<ActionKind, 'delete' | 'finish'>;

export interface UserProfile {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  is_active: boolean | null;
  is_frozen: boolean | null;
  freeze_reason: string | null;
  referral_code: string | null;
  referred_by: string | null;
  bonus_balance: number | string | null;
  last_active_at: string | null;
  created_at: string;
  deleted_at: string | null;
  balance: number | string | null;
  avatar_url: string | null;
}

export interface Referrer {
  id: string;
  username: string | null;
  full_name: string | null;
}

export interface UserStats {
  trades: number | null;
  withdrawals: number | null;
  withdrawals_pending: number | null;
  card_submissions: number | null;
}

export interface TransactionRow {
  id: string;
  type: string | null;
  amount: number | string | null;
  status: string | null;
  reference_id: string | null;
  created_at: string;
}

export interface DeviceRow {
  id: string | null;
  device_model: string | null;
  os_version: string | null;
  app_version: string | null;
  ip_address: string | null;
  created_at: string;
  last_seen_at: string | null;
  login_count: number | null;
}

export interface LoginRow {
  id: string | null;
  device_model: string | null;
  os_version: string | null;
  app_version: string | null;
  ip_address: string | null;
  created_at: string;
  ended_at: string | null;
}

export interface SectionRowMap {
  transactions: TransactionRow;
  devices: DeviceRow;
  logins: LoginRow;
}

export interface ProfileData {
  user: UserProfile;
  referrer: Referrer | null;
  stats: UserStats;
  deletionUnfinished: boolean | null;
  partial: { stats: string | null; referrer: string | null; deletion: string | null };
}

export interface ProfileResource {
  profile: ProfileData;
  body: ApiBody;
}

export interface SectionSeed<T> {
  rows: T[];
  total: number | null;
  error: string | null;
  pageSize: number | null;
}

export interface SectionPage<T> {
  rows: T[];
  total: number | null;
}

export interface SectionView {
  page: number;
  sort: SortState;
}

export type SeedPlan = 'apply' | 'refresh' | 'none';

export type ActionOutcome =
  | { kind: 'done'; warning: string | null }
  | { kind: 'unknown' }
  | { kind: 'refused'; status: number | null; message: string };

export type ActionAttempt = ActionOutcome | { kind: 'retry'; message: string };

export interface ActionNotice {
  text: string;
  tone: ToastTone;
}

export interface SectionSpec {
  key: SectionKey;
  label: string;
  noun: string;
  caption: string;
  pageSize: number;
  defaultSort: SortState;
  emptyTitle: string;
  emptyHint: string;
  errorTitle: string;
  errorMessage: string;
}

export const DEFAULT_SECTION: SectionKey = 'transactions';

export const SECTION_ORDER: readonly SectionKey[] = ['transactions', 'devices', 'logins'];

export const SECTIONS: Readonly<Record<SectionKey, SectionSpec>> = {
  transactions: {
    key: 'transactions',
    label: 'Transactions',
    noun: 'transactions',
    caption: 'Every ledger entry for this user. Times are WAT.',
    pageSize: 10,
    defaultSort: { key: 'created_at', dir: 'desc' },
    emptyTitle: 'No transactions yet',
    emptyHint: 'Card credits, withdrawals, bill payments and bonuses appear here as soon as they are recorded.',
    errorTitle: 'Transactions could not be loaded',
    errorMessage: 'The transaction ledger could not be read.',
  },
  devices: {
    key: 'devices',
    label: 'Devices',
    noun: 'devices',
    caption: 'Every phone or tablet this user has signed in on, with its app version. Times are WAT.',
    pageSize: 20,
    defaultSort: { key: 'created_at', dir: 'desc' },
    emptyTitle: 'No devices recorded',
    emptyHint: 'A device is recorded the first time this user signs in on it.',
    errorTitle: 'Devices could not be loaded',
    errorMessage: 'Device records could not be read.',
  },
  logins: {
    key: 'logins',
    label: 'Login history',
    noun: 'sign-ins',
    caption: 'Every app sign-in, with the device and IP address used. Times are WAT.',
    pageSize: 20,
    defaultSort: { key: 'created_at', dir: 'desc' },
    emptyTitle: 'No sign-ins recorded',
    emptyHint: 'Sessions appear here once this user signs in to the app.',
    errorTitle: 'Login history could not be loaded',
    errorMessage: 'Sign-in records could not be read.',
  },
};

export const ACCOUNT_STATES: Readonly<Record<AccountState, { label: string; tone: BadgeTone }>> = {
  deleted: { label: 'Deletion in progress', tone: 'danger' },
  frozen: { label: 'Frozen', tone: 'danger' },
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'neutral' },
};

export const FREEZE_REASONS = [
  'Unusual activity on your account is under review.',
  'A security check is in progress on your account.',
  'A card trade on your account is under investigation.',
  'Your account was suspended at your request.',
];

export const UNKNOWN_ACTION_OUTCOME =
  'No response came back, so the account may or may not have changed. Reloading to show its current state.';

const FINAL_ACTION_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 409]);

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
  wallet_credit: 'Wallet credit',
  wallet_debit: 'Wallet debit',
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function amount(value: unknown): number | string | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finiteCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function sameSort(a: SortState, b: SortState): boolean {
  return a.key === b.key && a.dir === b.dir;
}

export function validUserId(raw: unknown): string | null {
  return isUuid(raw) ? raw.toLowerCase() : null;
}

export function countText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-NG') : '—';
}

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? one : many}`;
}

export function sectionQuery(key: SectionKey, page: number, limit: number, sort: SortState): string {
  return new URLSearchParams({
    section: key,
    page: String(page),
    limit: String(limit),
    sort: sort.key,
    dir: sort.dir,
  }).toString();
}

export function transactionHref(id: string): string {
  return `/transactions-overview?id=${encodeURIComponent(id)}`;
}

export function userTransactionsHref(userId: string): string {
  return `/transactions-overview?search=${encodeURIComponent(userId)}`;
}

export function accountState(user: Pick<UserProfile, 'deleted_at' | 'is_frozen' | 'is_active'>): AccountState {
  if (user.deleted_at) return 'deleted';
  if (user.is_frozen) return 'frozen';
  return user.is_active ? 'active' : 'inactive';
}

export function canAdjustWallet(user: Pick<UserProfile, 'deleted_at' | 'is_frozen' | 'is_active'>): boolean {
  return accountState(user) !== 'deleted';
}

export function deletionKind(profile: { user: Pick<UserProfile, 'deleted_at' | 'email'>; deletionUnfinished: boolean | null }): DeletionKind | null {
  if (!profile.user.deleted_at) return profile.user.email ? 'delete' : null;
  return profile.deletionUnfinished === true ? 'finish' : null;
}

export function displayName(user: Pick<UserProfile, 'full_name' | 'username'>): string {
  if (user.full_name) return user.full_name;
  if (user.username) return `@${user.username}`;
  return 'Unnamed user';
}

export function userHandle(user: Pick<UserProfile, 'full_name' | 'username'>): string {
  if (user.username) return `@${user.username}`;
  return user.full_name || 'this user';
}

export function userSummary(user: Pick<UserProfile, 'full_name' | 'username'>): string {
  const handle = user.username ? `@${user.username}` : null;
  if (handle && user.full_name) return `${user.full_name} (${handle})`;
  return handle || user.full_name || 'Unnamed user';
}

export function referrerName(referrer: Referrer): string {
  if (referrer.username) return `@${referrer.username}`;
  return referrer.full_name || 'View account';
}

export function typeLabel(type: string | null | undefined): string {
  const key = String(type ?? '').trim();
  if (!key) return 'Unknown type';
  const known = TYPE_LABELS[key];
  if (known) return known;
  const words = key.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function deviceSummary(row: Pick<DeviceRow, 'os_version' | 'app_version'>): string {
  return [row.os_version, row.app_version ? `app ${row.app_version}` : null].filter(Boolean).join(' · ')
    || 'No version recorded';
}

export function toProfile(raw: unknown): UserProfile | null {
  const r = record(raw);
  const id = validUserId(r.id);
  if (!id) return null;
  return {
    id,
    full_name: text(r.full_name),
    username: text(r.username),
    email: text(r.email),
    phone: text(r.phone),
    country: text(r.country),
    is_active: flag(r.is_active),
    is_frozen: flag(r.is_frozen),
    freeze_reason: text(r.freeze_reason),
    referral_code: text(r.referral_code),
    referred_by: validUserId(r.referred_by),
    bonus_balance: amount(r.bonus_balance),
    last_active_at: text(r.last_active_at),
    created_at: text(r.created_at) ?? '',
    deleted_at: text(r.deleted_at),
    balance: amount(r.balance),
    avatar_url: text(r.avatar_url),
  };
}

function toReferrer(raw: unknown): Referrer | null {
  const r = record(raw);
  const id = validUserId(r.id);
  return id ? { id, username: text(r.username), full_name: text(r.full_name) } : null;
}

function toStats(raw: unknown): UserStats {
  const r = record(raw);
  return {
    trades: finiteCount(r.trades),
    withdrawals: finiteCount(r.withdrawals),
    withdrawals_pending: finiteCount(r.withdrawals_pending),
    card_submissions: finiteCount(r.card_submissions),
  };
}

export function readProfile(body: ApiBody): ProfileData | null {
  const user = toProfile(body.user);
  if (!user) return null;
  const partial = record(body.partial);
  return {
    user,
    referrer: toReferrer(body.referrer),
    stats: toStats(body.stats),
    deletionUnfinished: flag(body.deletion_unfinished),
    partial: {
      stats: text(partial.stats),
      referrer: text(partial.referrer),
      deletion: text(partial.deletion),
    },
  };
}

export function toProfileResource(body: ApiBody): ProfileResource | null {
  const profile = readProfile(body);
  return profile ? { profile, body } : null;
}

export function sectionSeed<K extends SectionKey>(body: ApiBody, key: K): SectionSeed<SectionRowMap[K]> {
  const partial = record(body.partial);
  const rows = key === 'transactions' ? body.recentTransactions : key === 'devices' ? body.devices : body.logins;
  const error = key === 'transactions' ? partial.recent_transactions : key === 'devices' ? partial.devices : partial.logins;
  const size = finiteCount(record(body.page_size)[key]);
  return {
    rows: (Array.isArray(rows) ? rows : []) as SectionRowMap[K][],
    total: finiteCount(record(body.totals)[key]),
    error: text(error),
    pageSize: size && size > 0 ? size : null,
  };
}

export function toSectionPage<T>(body: ApiBody): SectionPage<T> | null {
  if (!Array.isArray(body.items)) return null;
  return { rows: body.items as T[], total: finiteCount(body.total) };
}

export function planSeed(spec: SectionSpec, view: SectionView, seed: SectionSeed<unknown>, seeded: boolean): SeedPlan {
  const defaultView = view.page === 1 && sameSort(view.sort, spec.defaultSort);
  const fits = seed.pageSize === null || seed.pageSize === spec.pageSize;
  if (defaultView && fits && seed.error === null) return 'apply';
  return seeded ? 'refresh' : 'none';
}

export function classifyAction(result: ApiResult<ApiBody>): ActionAttempt {
  if (result.ok) return { kind: 'done', warning: text(result.data.warning) };
  const { error } = result;
  if (error.outcomeUnknown || record(error.details).outcome_unknown === true) return { kind: 'unknown' };
  if (error.status !== null && FINAL_ACTION_STATUSES.has(error.status)) {
    return { kind: 'refused', status: error.status, message: error.message };
  }
  return { kind: 'retry', message: error.message };
}

export function actionNotice(
  kind: ActionKind,
  user: Pick<UserProfile, 'full_name' | 'username'>,
  outcome: ActionOutcome,
): ActionNotice | null {
  if (outcome.kind === 'unknown') return { text: UNKNOWN_ACTION_OUTCOME, tone: 'error' };
  if (outcome.kind === 'refused') return outcome.status === 401 ? null : { text: outcome.message, tone: 'error' };
  if (outcome.warning) return { text: outcome.warning, tone: 'warning' };
  const handle = userHandle(user);
  if (kind === 'delete') return { text: `${handle} was deleted.`, tone: 'success' };
  if (kind === 'finish') return { text: `The deletion of ${handle} is finished.`, tone: 'success' };
  return kind === 'freeze'
    ? { text: `${handle} is frozen. Withdrawals and bill payments are now refused.`, tone: 'success' }
    : { text: `${handle} is unfrozen. Withdrawals and bill payments are allowed again.`, tone: 'success' };
}
