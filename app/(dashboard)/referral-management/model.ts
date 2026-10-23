import type { ApiBody, ApiResult } from '../../lib/apiClient';
import type { DateRangeValue, SortState } from '../../_ui';
import {
  NO_USERNAME, SETTING_KEYS, SETTING_LABELS, checkSetting, formatCount, inputText, owedAmount, plural, readSetting,
  referralStatus, roundMoney, sameSettingValue, settingText, toAmount,
  type ReferralFacts, type ReferralStatus, type SettingKey, type SettingReading, type StatusFilter, type StoredSetting,
  type StoredSettings,
} from './referralRules';

export const REFERRALS_ENDPOINT = '/api/referrals';
export const CONFIG_ENDPOINT = '/api/app-config';
export const PAGE_SIZE = 50;
export const SUMMARY_QUERY: Readonly<Record<string, string>> = { view: 'summary' };
export const DEFAULT_SORT: SortState = { key: 'created_at', dir: 'desc' };

export type Phase = 'idle' | 'checking' | 'confirming' | 'saving';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function wholeCount(value: unknown): number | null {
  const amount = toAmount(value);
  return amount === null || amount < 0 ? null : Math.round(amount);
}

export interface ReferralTotals {
  total: number;
  awaiting: number;
  unclaimed: number;
  owed: number;
  owedPartial: boolean;
  paidToReferrers: number;
  paidToReferees: number;
}

export function toTotals(raw: unknown): ReferralTotals | null {
  if (!isRecord(raw)) return null;
  const total = wholeCount(raw.total_referrals);
  const awaiting = wholeCount(raw.awaiting_trade);
  const unclaimed = wholeCount(raw.unclaimed);
  const owed = toAmount(raw.pending_payout);
  const paid = toAmount(raw.paid_to_referrers ?? raw.total_paid_out);
  const refereePaid = toAmount(raw.paid_to_referees);
  if (total === null || awaiting === null || unclaimed === null || owed === null || paid === null || refereePaid === null) return null;
  return {
    total,
    awaiting,
    unclaimed,
    owed,
    owedPartial: raw.pending_payout_partial === true,
    paidToReferrers: paid,
    paidToReferees: refereePaid,
  };
}

export interface ReferralSummary {
  settings: StoredSettings;
  totals: ReferralTotals | null;
}

function readStored(raw: unknown): StoredSetting | null {
  if (!isRecord(raw) || typeof raw.exists !== 'boolean') return null;
  const value = raw.value;
  if (value !== null && typeof value !== 'string') return null;
  return { value, updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : null, exists: raw.exists };
}

export function toSummary(body: ApiBody): ReferralSummary | null {
  const raw = body.settings;
  if (!isRecord(raw)) return null;
  const settings = {} as Record<SettingKey, StoredSetting>;
  for (const key of SETTING_KEYS) {
    const stored = readStored(raw[key]);
    if (!stored) return null;
    settings[key] = stored;
  }
  return { settings, totals: toTotals(body.stats) };
}

export interface ReferralRow {
  id: string;
  referrerId: string | null;
  referrerUsername: string | null;
  referrerName: string | null;
  refereeId: string | null;
  refereeUsername: string | null;
  refereeName: string | null;
  createdAt: string | null;
  firstTradeAt: string | null;
  firstTradeCompleted: boolean;
  referrerBonus: number | null;
  refereeBonus: number | null;
  referrerCredited: boolean;
  refereeCredited: boolean;
  status: ReferralStatus;
  owed: number;
}

export interface ReferralList {
  rows: ReferralRow[];
  total: number;
  searchCapped: boolean;
}

function username(value: unknown): string | null {
  const name = text(value);
  return name === null || name === NO_USERNAME ? null : name;
}

export function toReferralRow(raw: unknown): ReferralRow | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (!id) return null;
  const facts: ReferralFacts = {
    first_trade_completed: raw.first_trade_completed,
    referrer_bonus_amount: raw.referrer_bonus_amount,
    referee_bonus_amount: raw.referee_bonus_amount,
    referrer_credited: raw.referrer_credited,
    referee_credited: raw.referee_credited,
  };
  return {
    id,
    referrerId: text(raw.referrer_id),
    referrerUsername: username(raw.referrer_username),
    referrerName: text(raw.referrer_name),
    refereeId: text(raw.referee_id),
    refereeUsername: username(raw.referee_username),
    refereeName: text(raw.referee_name),
    createdAt: text(raw.created_at),
    firstTradeAt: text(raw.first_trade_at),
    firstTradeCompleted: raw.first_trade_completed === true,
    referrerBonus: toAmount(raw.referrer_bonus_amount),
    refereeBonus: toAmount(raw.referee_bonus_amount),
    referrerCredited: raw.referrer_credited === true,
    refereeCredited: raw.referee_credited === true,
    status: referralStatus(facts),
    owed: owedAmount(facts),
  };
}

export function toReferralList(body: ApiBody): ReferralList | null {
  if (!Array.isArray(body.log)) return null;
  const rows = body.log.map(toReferralRow).filter((row): row is ReferralRow => row !== null);
  return { rows, total: wholeCount(body.total) ?? rows.length, searchCapped: body.search_capped === true };
}

export function userHandle(name: string | null, fullName: string | null): string {
  if (name) return `@${name}`;
  return fullName ?? 'Unknown user';
}

export function totalBonus(row: Pick<ReferralRow, 'referrerBonus' | 'refereeBonus'>): number {
  return roundMoney((row.referrerBonus ?? 0) + (row.refereeBonus ?? 0));
}

export interface ListView {
  search: string;
  status: StatusFilter | '';
  range: DateRangeValue;
  sort: SortState;
  page: number;
}

export function listQueryString(view: ListView): string {
  const params = new URLSearchParams();
  params.set('page', String(view.page));
  params.set('page_size', String(PAGE_SIZE));
  if (view.search) params.set('search', view.search);
  if (view.status) params.set('status', view.status);
  if (view.range.from) params.set('date_from', view.range.from);
  if (view.range.to) params.set('date_to', view.range.to);
  params.set('sort', view.sort.key);
  params.set('dir', view.sort.dir);
  params.set('stats', '0');
  return params.toString();
}

export function filtersActive(view: Pick<ListView, 'status' | 'range'>, searchText: string): boolean {
  return searchText.trim() !== '' || view.status !== '' || view.range.from !== null || view.range.to !== null;
}

export interface DraftEntry {
  value: string;
  base: StoredSetting;
  conflict: boolean;
}

export type Draft = Readonly<Partial<Record<SettingKey, DraftEntry>>>;

export const EMPTY_DRAFT: Draft = Object.freeze({});

export function draftValue(live: StoredSettings, draft: Draft, key: SettingKey): string {
  return draft[key]?.value ?? inputText(key, live[key]);
}

function sameInput(key: SettingKey, a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const left = checkSetting(key, a);
  const right = checkSetting(key, b);
  return left.ok && right.ok && left.value === right.value;
}

export function entryChanged(key: SettingKey, entry: DraftEntry | undefined): boolean {
  return entry !== undefined && !sameInput(key, entry.value, inputText(key, entry.base));
}

export function editSetting(draft: Draft, live: StoredSettings, key: SettingKey, value: string): Draft {
  const current = draft[key];
  const base = current ? current.base : live[key];
  if (value === inputText(key, base)) {
    if (!current) return draft;
    const next: Partial<Record<SettingKey, DraftEntry>> = { ...draft };
    delete next[key];
    return next;
  }
  return { ...draft, [key]: { value, base, conflict: current?.conflict ?? false } };
}

export function draftCount(draft: Draft): number {
  return SETTING_KEYS.filter((key) => entryChanged(key, draft[key])).length;
}

export function draftErrors(draft: Draft): Partial<Record<SettingKey, string>> {
  const errors: Partial<Record<SettingKey, string>> = {};
  for (const key of SETTING_KEYS) {
    const entry = draft[key];
    if (!entry || !entryChanged(key, entry)) continue;
    const checked = checkSetting(key, entry.value);
    if (!checked.ok) errors[key] = checked.message;
  }
  return errors;
}

export function firstErrorKey(errors: Partial<Record<SettingKey, string>>): SettingKey | null {
  return SETTING_KEYS.find((key) => Boolean(errors[key])) ?? null;
}

export interface SettingChange {
  key: SettingKey;
  label: string;
  base: StoredSetting;
  to: string;
  fromReading: SettingReading;
  toReading: SettingReading;
  fromText: string;
  toText: string;
  conflict: boolean;
}

export function draftChanges(draft: Draft): SettingChange[] {
  const changes: SettingChange[] = [];
  for (const key of SETTING_KEYS) {
    const entry = draft[key];
    if (!entry || !entryChanged(key, entry)) continue;
    const checked = checkSetting(key, entry.value);
    if (!checked.ok) continue;
    const fromReading = readSetting(key, entry.base);
    const toReading = readSetting(key, { value: checked.value, updated_at: null, exists: true });
    changes.push({
      key,
      label: SETTING_LABELS[key],
      base: entry.base,
      to: checked.value,
      fromReading,
      toReading,
      fromText: settingText(key, fromReading),
      toText: settingText(key, toReading),
      conflict: entry.conflict,
    });
  }
  return changes;
}

export interface SavePayload {
  changes: Record<string, string>;
  expected: Record<string, string>;
}

export function savePayload(changes: readonly SettingChange[]): SavePayload {
  const values: Record<string, string> = {};
  const expected: Record<string, string> = {};
  for (const change of changes) {
    values[change.key] = change.to;
    expected[change.key] = change.base.value ?? '';
  }
  return { changes: values, expected };
}

export interface RebaseResult {
  draft: Draft;
  conflicts: SettingKey[];
  alreadyLive: SettingKey[];
}

function sameBase(a: StoredSetting, b: StoredSetting): boolean {
  return (a.value ?? '') === (b.value ?? '');
}

export function rebaseDraft(draft: Draft, fresh: StoredSettings): RebaseResult {
  const next: Partial<Record<SettingKey, DraftEntry>> = {};
  const conflicts: SettingKey[] = [];
  const alreadyLive: SettingKey[] = [];
  for (const key of SETTING_KEYS) {
    const entry = draft[key];
    if (!entry) continue;
    const live = fresh[key];
    const moved = !sameBase(entry.base, live);
    if (!entryChanged(key, entry)) {
      if (!moved) next[key] = { ...entry, base: live };
      continue;
    }
    const rebased: DraftEntry = { value: entry.value, base: live, conflict: moved || entry.conflict };
    if (!entryChanged(key, rebased)) {
      alreadyLive.push(key);
      continue;
    }
    next[key] = rebased;
    if (moved) conflicts.push(key);
  }
  return { draft: next, conflicts, alreadyLive };
}

export interface NoticeItem {
  id: string;
  title: string;
  detail: string;
}

export interface PageNotice {
  tone: 'warning' | 'danger';
  title: string;
  message: string;
  items: NoticeItem[];
}

export function rebaseNotice(result: RebaseResult, fresh: StoredSettings): PageNotice | null {
  const items: NoticeItem[] = [
    ...result.conflicts.map((key) => ({
      id: key,
      title: SETTING_LABELS[key],
      detail: `Someone else changed this to ${settingText(key, readSetting(key, fresh[key]))}. Your value is kept; check it before saving.`,
    })),
    ...result.alreadyLive.map((key) => ({
      id: key,
      title: SETTING_LABELS[key],
      detail: 'Someone else already made this change, so there is nothing left to save.',
    })),
  ];
  if (items.length === 0) return null;
  return {
    tone: 'warning',
    title: items.length === 1 ? 'A referral setting changed while you were editing' : 'Referral settings changed while you were editing',
    message: 'The live values were reloaded. Your other unsaved changes are kept.',
    items,
  };
}

export function conflictNotice(message: string): PageNotice {
  return { tone: 'warning', title: 'Nothing was saved', message, items: [] };
}

export function unknownNotice(message: string): PageNotice {
  return {
    tone: 'warning',
    title: 'The save could not be confirmed',
    message: `${message} Your changes are still marked as unsaved until you check them.`,
    items: [],
  };
}

export interface SaveReceipt {
  warning: string | null;
}

export function toSaveReceipt(body: ApiBody): SaveReceipt {
  return { warning: text(body.warning) };
}

export type SaveOutcome =
  | { kind: 'saved'; warning: string | null }
  | { kind: 'conflict'; message: string }
  | { kind: 'unknown'; message: string }
  | { kind: 'refused'; status: number | null; message: string }
  | { kind: 'expired' }
  | { kind: 'retry'; message: string };

export function classifySave(result: ApiResult<SaveReceipt>): SaveOutcome {
  if (result.ok) return { kind: 'saved', warning: result.data.warning };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  if (failure.status === 403) return { kind: 'refused', status: 403, message: failure.message };
  if (failure.status === 409 && failure.code === 'STATE_CONFLICT') return { kind: 'conflict', message: failure.message };
  return { kind: 'retry', message: failure.message };
}

export function sameAsIntended(fresh: StoredSettings, changes: readonly SettingChange[]): boolean {
  return changes.every((change) => fresh[change.key].exists && sameSettingValue(change.key, fresh[change.key].value, change.to));
}

export function afterValue(live: StoredSettings, changes: readonly SettingChange[], key: SettingKey): number | boolean | null {
  const change = changes.find((item) => item.key === key);
  return change ? change.toReading.effective : readSetting(key, live[key]).effective;
}

export function programmeNotes(live: StoredSettings, changes: readonly SettingChange[]): string[] {
  const touchesPay = changes.some((change) => (
    change.key === 'referral_active' || change.key === 'referral_referrer_bonus' || change.key === 'referral_referee_bonus'
  ));
  if (!touchesPay || afterValue(live, changes, 'referral_active') !== true) return [];
  const referrer = afterValue(live, changes, 'referral_referrer_bonus');
  const referee = afterValue(live, changes, 'referral_referee_bonus');
  return referrer === 0 && referee === 0
    ? ['Both bonuses will be ₦0, so new referrals are recorded but pay nothing.']
    : [];
}

export function unsavedText(total: number): string {
  return plural(total, 'unsaved change', 'unsaved changes');
}

export function savedText(total: number): string {
  return total === 1
    ? 'Saved. The referral programme uses the new value from now on.'
    : `Saved. The referral programme uses the ${formatCount(total)} new values from now on.`;
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
