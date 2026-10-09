import type { ApiBody, ApiResult } from '../../lib/apiClient';
import type { SortState } from '../../_ui/useTableSort';
import type { Tone } from '../../_ui/Status';
import { formatNaira } from '../../_ui/money';
import {
  BONUS_MAX, LARGE_BONUS, LIMIT_MAX, MIN_TRADE_MAX, TERMS_CONFIG_KEY, TERMS_MAX, TYPE_MAX,
  codeProblem, daysUntil, findBrand, formatCount, formatDateKey, isDateKey, isRecord, normalizeCode, plural,
  parseTermsList, restrictionOf, rulesList, sameAmount, sameBrand, sameCode, textOrNull, toAmount, toDateKey, toWhole, withRestriction,
} from './couponRules';

export interface CouponRow {
  id: string;
  code: string;
  type: string;
  bonus: number;
  minTrade: number;
  expiry: string | null;
  limit: number | null;
  uses: number;
  active: boolean;
  terms: string | null;
  rules: unknown[];
  restrictTo: string | null;
  createdAt: string | null;
  awaitingTrades: number | null;
  awaitingBonus: number | null;
}

export interface Brand {
  id: string;
  name: string;
}

export interface CouponsSnapshot {
  coupons: CouponRow[];
  brands: Brand[] | null;
  terms: string[] | null;
  awaitingCounted: boolean;
}

const AMOUNT_FORMAT = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 });
const PLAIN_DECIMAL = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const GROUPED_DECIMAL = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const CURRENCY_PREFIX = /^[₦$]\s*/;
const PLAIN_INTEGER = /^\d+$/;
const ENDING_SOON_DAYS = 7;

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function formatAmount(value: number): string {
  return AMOUNT_FORMAT.format(value);
}

export function toCouponRow(raw: unknown): CouponRow | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (!id) return null;
  const rules = rulesList(raw.eligibility_rules);
  const awaitingTrades = toWhole(raw.pending_trades);
  return {
    id: id.toLowerCase(),
    code: text(raw.code) ?? '',
    type: text(raw.type) ?? '',
    bonus: toAmount(raw.bonus_rate_naira) ?? 0,
    minTrade: toAmount(raw.min_trade_amount_usd) ?? 0,
    expiry: toDateKey(raw.expiry_date),
    limit: toWhole(raw.max_redemptions),
    uses: Math.max(0, toWhole(raw.use_count) ?? 0),
    active: raw.is_active === true,
    terms: textOrNull(raw.terms_of_use),
    rules,
    restrictTo: restrictionOf(rules),
    createdAt: text(raw.created_at),
    awaitingTrades,
    awaitingBonus: awaitingTrades === null ? null : toAmount(raw.pending_bonus_naira) ?? 0,
  };
}

function toBrand(raw: unknown): Brand | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const name = text(raw.name);
  return id && name ? { id, name } : null;
}

function toTerms(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item) => (typeof item === 'string' && item.trim() !== '' ? [item.trim()] : []));
}

export function toSnapshot(body: ApiBody): CouponsSnapshot | null {
  if (!Array.isArray(body.coupons)) return null;
  return {
    coupons: body.coupons.map(toCouponRow).filter(notNull),
    brands: Array.isArray(body.brands) ? body.brands.map(toBrand).filter(notNull) : null,
    terms: toTerms(body.terms_options),
    awaitingCounted: body.pending_counted === true,
  };
}

export function withCoupon(snapshot: CouponsSnapshot | undefined, row: CouponRow): CouponsSnapshot | undefined {
  if (!snapshot) return snapshot;
  const index = snapshot.coupons.findIndex((item) => item.id === row.id);
  if (index === -1) return { ...snapshot, coupons: [row, ...snapshot.coupons] };
  const previous = snapshot.coupons[index];
  const merged: CouponRow = row.awaitingTrades === null
    ? { ...row, awaitingTrades: previous.awaitingTrades, awaitingBonus: previous.awaitingBonus }
    : row;
  return { ...snapshot, coupons: snapshot.coupons.map((item, at) => (at === index ? merged : item)) };
}

export function withoutCoupon(snapshot: CouponsSnapshot | undefined, id: string): CouponsSnapshot | undefined {
  if (!snapshot) return snapshot;
  return { ...snapshot, coupons: snapshot.coupons.filter((item) => item.id !== id) };
}

export function brandNames(brands: readonly Brand[] | null): string[] {
  return brands ? brands.map((brand) => brand.name) : [];
}

export function brandAvailable(type: string, brands: readonly Brand[] | null): boolean | null {
  if (!brands) return null;
  return findBrand(type, brandNames(brands)) !== null;
}

export function isExpired(expiry: string | null, today: string): boolean {
  return expiry !== null && expiry < today;
}

export function isUsedUp(row: Pick<CouponRow, 'limit' | 'uses'>): boolean {
  return row.limit !== null && row.uses >= row.limit;
}

export type CouponState = 'live' | 'disabled' | 'expired' | 'used_up' | 'no_brand';

export interface CouponStatus {
  state: CouponState;
  label: string;
  tone: Tone;
  hint: string;
}

export function couponStatus(row: CouponRow, today: string, brands: readonly Brand[] | null): CouponStatus {
  if (!row.active) {
    return { state: 'disabled', label: 'Disabled', tone: 'neutral', hint: 'Switched off. Users cannot see it in the app or apply it.' };
  }
  if (isExpired(row.expiry, today)) {
    return {
      state: 'expired',
      label: 'Expired',
      tone: 'warning',
      hint: `Ended on ${formatDateKey(row.expiry)}. Users can no longer see it in the app or apply it.`,
    };
  }
  if (isUsedUp(row)) {
    return {
      state: 'used_up',
      label: 'Used up',
      tone: 'warning',
      hint: `Reached its limit of ${plural(row.limit ?? 0, 'use', 'uses')}. It still shows in the app, but users can no longer apply it.`,
    };
  }
  if (brandAvailable(row.type, brands) === false) {
    return {
      state: 'no_brand',
      label: 'No such brand',
      tone: 'warning',
      hint: `No active card brand is named “${row.type || 'this'}”. It still shows in the app, but no trade can use it.`,
    };
  }
  return { state: 'live', label: 'Live', tone: 'success', hint: 'Users can see it in the app and apply it now.' };
}

export type CouponTab = 'all' | 'live' | 'off';

export const TAB_VALUES: readonly CouponTab[] = ['all', 'live', 'off'];

export const TABS: ReadonlyArray<{ value: CouponTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'off', label: 'Not live' },
];

export function inTab(status: CouponStatus, tab: CouponTab): boolean {
  if (tab === 'all') return true;
  return tab === 'live' ? status.state === 'live' : status.state !== 'live';
}

export function tabCounts(
  rows: readonly CouponRow[],
  today: string,
  brands: readonly Brand[] | null,
): Record<CouponTab, number> {
  const counts: Record<CouponTab, number> = { all: rows.length, live: 0, off: 0 };
  for (const row of rows) {
    if (couponStatus(row, today, brands).state === 'live') counts.live += 1;
    else counts.off += 1;
  }
  return counts;
}

export function matchesQuery(row: CouponRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return row.code.toLowerCase().includes(needle) || row.type.toLowerCase().includes(needle);
}

export const SORT_KEYS = ['code', 'bonus', 'uses', 'expiry'] as const;

function compareCoupons(a: CouponRow, b: CouponRow, sort: SortState): number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  switch (sort.key) {
    case 'code':
      return sign * a.code.localeCompare(b.code, 'en', { sensitivity: 'base' });
    case 'bonus':
      return sign * (a.bonus - b.bonus);
    case 'uses':
      return sign * (a.uses - b.uses);
    case 'expiry': {
      if (a.expiry === b.expiry) return 0;
      if (a.expiry === null) return sign;
      if (b.expiry === null) return -sign;
      return sign * a.expiry.localeCompare(b.expiry);
    }
    default:
      return 0;
  }
}

export interface ViewOptions {
  tab: CouponTab;
  query: string;
  sort: SortState | null;
  today: string;
  brands: readonly Brand[] | null;
}

export function visibleCoupons(rows: readonly CouponRow[], options: ViewOptions): CouponRow[] {
  const shown = rows.filter((row) => (
    inTab(couponStatus(row, options.today, options.brands), options.tab) && matchesQuery(row, options.query)
  ));
  const sort = options.sort;
  if (!sort || !(SORT_KEYS as readonly string[]).includes(sort.key)) return shown;
  return shown
    .map((row, index) => ({ row, index }))
    .sort((a, b) => compareCoupons(a.row, b.row, sort) || a.index - b.index)
    .map((entry) => entry.row);
}

export interface CouponStats {
  total: number;
  live: number;
  redemptions: number;
  awaitingTrades: number | null;
  awaitingBonus: number | null;
  endingSoon: number;
}

export function couponStats(
  rows: readonly CouponRow[],
  today: string,
  brands: readonly Brand[] | null,
  awaitingCounted: boolean,
): CouponStats {
  const stats: CouponStats = {
    total: rows.length,
    live: 0,
    redemptions: 0,
    awaitingTrades: awaitingCounted ? 0 : null,
    awaitingBonus: awaitingCounted ? 0 : null,
    endingSoon: 0,
  };
  for (const row of rows) {
    stats.redemptions += row.uses;
    if (awaitingCounted && stats.awaitingTrades !== null && stats.awaitingBonus !== null) {
      stats.awaitingTrades += row.awaitingTrades ?? 0;
      stats.awaitingBonus += row.awaitingBonus ?? 0;
    }
    if (couponStatus(row, today, brands).state !== 'live') continue;
    stats.live += 1;
    if (row.expiry !== null) {
      const days = daysUntil(row.expiry, today);
      if (days >= 0 && days <= ENDING_SOON_DAYS) stats.endingSoon += 1;
    }
  }
  return stats;
}

export interface ExpiryView {
  date: string;
  relative: string;
}

export function expiryView(expiry: string | null, today: string): ExpiryView {
  if (expiry === null) return { date: 'No expiry', relative: 'Runs until switched off' };
  const days = daysUntil(expiry, today);
  const date = formatDateKey(expiry);
  if (days < -1) return { date, relative: `Ended ${formatCount(-days)} days ago` };
  if (days === -1) return { date, relative: 'Ended yesterday' };
  if (days === 0) return { date, relative: 'Last day today' };
  if (days === 1) return { date, relative: 'Ends tomorrow' };
  return { date, relative: `Ends in ${formatCount(days)} days` };
}

export function usesText(row: Pick<CouponRow, 'uses' | 'limit'>): string {
  return row.limit === null ? formatCount(row.uses) : `${formatCount(row.uses)} / ${formatCount(row.limit)}`;
}

export function minTradeText(value: number): string {
  return value > 0 ? `$${formatAmount(value)}` : 'No minimum';
}

export function limitText(limit: number | null): string {
  return limit === null ? 'No limit' : plural(limit, 'use', 'uses');
}

export function expiryText(expiry: string | null): string {
  return expiry === null ? 'No expiry' : `End of ${formatDateKey(expiry)} (WAT)`;
}

export function restrictText(restrictTo: string | null): string {
  return restrictTo ? `Users with an approved ${restrictTo} trade` : 'Anyone';
}

export function awaitingText(trades: number | null, bonus: number | null): string {
  if (trades === null) return 'Not counted';
  if (trades === 0) return 'None';
  return `${plural(trades, 'trade', 'trades')} · ${formatNaira(bonus ?? 0)}`;
}

export function deletable(row: CouponRow): boolean {
  return !row.active && row.uses === 0 && (row.awaitingTrades === null || row.awaitingTrades === 0);
}

export type EditorMode = 'create' | 'edit';

export interface CouponForm {
  code: string;
  type: string;
  bonus: string;
  minTrade: string;
  expiry: string;
  limit: string;
  active: boolean;
  terms: string;
  restrictTo: string;
}

export type FormKey = keyof CouponForm;

export const FORM_KEYS: readonly FormKey[] = [
  'code', 'type', 'bonus', 'minTrade', 'expiry', 'limit', 'active', 'restrictTo', 'terms',
];

export type FormField = Exclude<FormKey, 'active'>;

export const FORM_FIELD_ORDER: readonly FormField[] = [
  'code', 'type', 'bonus', 'minTrade', 'expiry', 'limit', 'restrictTo', 'terms',
];

export const FIELD_LABELS: Readonly<Record<FormKey, string>> = {
  code: 'Code',
  type: 'Brand',
  bonus: 'Bonus per trade',
  minTrade: 'Minimum card value',
  expiry: 'Expires',
  limit: 'Usage limit',
  active: 'Status',
  restrictTo: 'Who can use it',
  terms: 'Terms of use',
};

export const EMPTY_FORM: CouponForm = {
  code: '',
  type: '',
  bonus: '',
  minTrade: '',
  expiry: '',
  limit: '',
  active: true,
  terms: '',
  restrictTo: '',
};

export function amountText(value: number): string {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function formFor(row: CouponRow | null): CouponForm {
  if (!row) return EMPTY_FORM;
  return {
    code: row.code,
    type: row.type,
    bonus: amountText(row.bonus),
    minTrade: row.minTrade > 0 ? amountText(row.minTrade) : '',
    expiry: row.expiry ?? '',
    limit: row.limit === null ? '' : String(row.limit),
    active: row.active,
    terms: row.terms ?? '',
    restrictTo: row.restrictTo ?? '',
  };
}

function cleanAmountText(value: string): string {
  const trimmed = value.trim().replace(CURRENCY_PREFIX, '');
  return GROUPED_DECIMAL.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed;
}

export function parseAmountText(value: string): number | null {
  const plain = cleanAmountText(value);
  if (!PLAIN_DECIMAL.test(plain)) return null;
  const amount = Number(plain);
  return Number.isFinite(amount) ? amount : null;
}

function fractionDigits(value: string): number {
  const dot = value.indexOf('.');
  return dot < 0 ? 0 : value.length - dot - 1;
}

export interface AmountRule {
  noun: string;
  max: number;
  required: boolean;
  positive: boolean;
}

export function amountProblem(value: string, rule: AmountRule): string | null {
  const cleaned = value.trim().replace(CURRENCY_PREFIX, '');
  if (cleaned === '') return rule.required ? `Enter ${rule.noun}.` : null;
  if (cleaned.startsWith('-')) return 'Use a number of 0 or more.';
  const plain = cleanAmountText(value);
  if (!PLAIN_DECIMAL.test(plain)) {
    return cleaned.includes(',')
      ? 'Use a full stop for decimals and commas only between thousands, like 1,500.50.'
      : 'Enter a number, like 1500 or 1500.50.';
  }
  if (fractionDigits(plain) > 2) return 'Use at most 2 decimal places.';
  const amount = Number(plain);
  if (amount > rule.max) return `Use ${formatAmount(rule.max)} or less.`;
  if (rule.positive && amount === 0) return 'Enter an amount above 0.';
  return null;
}

export function limitProblem(value: string): string | null {
  const cleaned = value.trim().replace(/,/g, '');
  if (cleaned === '') return null;
  if (!PLAIN_INTEGER.test(cleaned)) return 'Use a whole number, like 100, or leave it empty for no limit.';
  const limit = Number(cleaned);
  if (limit < 1) return 'Use at least 1, or leave it empty for no limit.';
  if (limit > LIMIT_MAX) return `Use ${formatCount(LIMIT_MAX)} or less.`;
  return null;
}

function parseLimitText(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, '');
  return PLAIN_INTEGER.test(cleaned) ? Number(cleaned) : null;
}

export function sameFormValue(key: FormKey, a: CouponForm, b: CouponForm): boolean {
  switch (key) {
    case 'code':
      return sameCode(a.code, b.code);
    case 'type':
    case 'restrictTo':
      return sameBrand(a[key], b[key]);
    case 'bonus':
    case 'minTrade': {
      const left = a[key].trim() === '' && key === 'minTrade' ? 0 : parseAmountText(a[key]);
      const right = b[key].trim() === '' && key === 'minTrade' ? 0 : parseAmountText(b[key]);
      if (left === null || right === null) return a[key].trim() === b[key].trim();
      return sameAmount(left, right);
    }
    case 'limit': {
      const left = a.limit.trim();
      const right = b.limit.trim();
      if (left === '' || right === '') return left === right;
      const leftLimit = parseLimitText(left);
      const rightLimit = parseLimitText(right);
      return leftLimit === null || rightLimit === null ? left === right : leftLimit === rightLimit;
    }
    case 'expiry':
      return a.expiry.trim() === b.expiry.trim();
    case 'active':
      return a.active === b.active;
    case 'terms':
      return a.terms.trim() === b.terms.trim();
  }
}

export function changedKeys(form: CouponForm, base: CouponForm): FormKey[] {
  return FORM_KEYS.filter((key) => !sameFormValue(key, form, base));
}

export function isFormDirty(form: CouponForm, base: CouponForm): boolean {
  return changedKeys(form, base).length > 0;
}

export interface CouponDraftValues {
  code: string;
  type: string;
  bonus: number;
  minTrade: number;
  expiry: string | null;
  limit: number | null;
  active: boolean;
  terms: string | null;
  restrictTo: string | null;
}

export interface FormContext {
  mode: EditorMode;
  today: string;
  base: CouponRow | null;
  coupons: readonly CouponRow[];
  brands: readonly Brand[] | null;
}

export interface FormCheck {
  errors: Partial<Record<FormField, string>>;
  warnings: string[];
  values: CouponDraftValues | null;
}

export function checkForm(form: CouponForm, context: FormContext): FormCheck {
  const errors: Partial<Record<FormField, string>> = {};
  const base = context.base;
  const baseForm = context.mode === 'edit' && base ? formFor(base) : null;
  const untouched = (key: FormKey) => baseForm !== null && sameFormValue(key, form, baseForm);

  const code = normalizeCode(form.code);
  if (!untouched('code')) {
    const codeIssue = codeProblem(code);
    if (codeIssue) errors.code = codeIssue;
    else if (context.coupons.some((row) => row.id !== base?.id && sameCode(row.code, code))) {
      errors.code = 'Another coupon already uses this code.';
    }
  }

  const type = form.type.trim();
  if (!untouched('type')) {
    if (!type) errors.type = 'Choose the brand this coupon is for.';
    else if (type.length > TYPE_MAX) errors.type = `Brand names can be at most ${TYPE_MAX} characters.`;
  }

  const bonusIssue = untouched('bonus')
    ? null
    : amountProblem(form.bonus, { noun: 'the bonus', max: BONUS_MAX, required: true, positive: true });
  if (bonusIssue) errors.bonus = bonusIssue;

  const minIssue = untouched('minTrade')
    ? null
    : amountProblem(form.minTrade, { noun: 'the minimum card value', max: MIN_TRADE_MAX, required: false, positive: false });
  if (minIssue) errors.minTrade = minIssue;

  const expiry = form.expiry.trim();
  const expiryChanged = context.mode === 'create' || expiry !== (base?.expiry ?? '');
  if (expiry && !isDateKey(expiry)) errors.expiry = 'Use a date like 2026-12-31.';
  else if (expiry && expiryChanged && expiry < context.today) {
    errors.expiry = `Pick today (${formatDateKey(context.today)}) or a later date.`;
  }

  const limitIssue = limitProblem(form.limit);
  if (limitIssue) errors.limit = limitIssue;

  const restrictTo = form.restrictTo.trim();
  if (restrictTo.length > TYPE_MAX) errors.restrictTo = `Brand names can be at most ${TYPE_MAX} characters.`;

  const terms = form.terms.trim();
  if (terms.length > TERMS_MAX) errors.terms = `Keep the terms of use to ${formatCount(TERMS_MAX)} characters or fewer.`;

  const bonus = parseAmountText(form.bonus);
  const minTrade = form.minTrade.trim() === '' ? 0 : parseAmountText(form.minTrade);
  const limit = form.limit.trim() === '' ? null : parseLimitText(form.limit);

  const warnings: string[] = [];
  if (!errors.bonus && bonus !== null && bonus >= LARGE_BONUS) {
    warnings.push(`${formatNaira(bonus)} per trade is a large bonus. Check it is not a typo.`);
  }
  if (context.mode === 'edit' && base && !errors.limit && limit !== null && limit <= base.uses) {
    warnings.push(
      `The limit is at or below the ${plural(base.uses, 'use', 'uses')} so far, so nobody else can apply this coupon once you save.`,
    );
  }
  if (form.active && type && context.brands && brandAvailable(type, context.brands) === false) {
    warnings.push(`No active card brand is named “${type}”, so no trade can use this coupon until one is.`);
  }
  if (context.mode === 'edit' && form.active && expiry && !expiryChanged && expiry < context.today) {
    warnings.push(
      `This coupon expired on ${formatDateKey(expiry)}. Set a later expiry date if users should be able to apply it again.`,
    );
  }

  const valid = Object.keys(errors).length === 0 && bonus !== null && minTrade !== null;
  return {
    errors,
    warnings,
    values: valid
      ? {
          code,
          type,
          bonus: bonus as number,
          minTrade: minTrade as number,
          expiry: expiry || null,
          limit,
          active: form.active,
          terms: terms || null,
          restrictTo: restrictTo || null,
        }
      : null,
  };
}

export function firstError(errors: Partial<Record<FormField, string>>): FormField | null {
  return FORM_FIELD_ORDER.find((field) => errors[field]) ?? null;
}

export interface RebaseResult {
  form: CouponForm;
  conflicts: FormKey[];
  changedElsewhere: boolean;
}

export function rebaseForm(base: CouponForm, local: CouponForm, server: CouponForm): RebaseResult {
  const form: CouponForm = { ...local };
  const conflicts: FormKey[] = [];
  let changedElsewhere = false;
  for (const key of FORM_KEYS) {
    const mine = !sameFormValue(key, local, base);
    const theirs = !sameFormValue(key, server, base);
    if (theirs) changedElsewhere = true;
    if (!mine) {
      (form as Record<FormKey, string | boolean>)[key] = server[key];
      continue;
    }
    if (theirs && !sameFormValue(key, local, server)) conflicts.push(key);
  }
  return { form, conflicts, changedElsewhere };
}

export interface CouponProposal {
  live: CouponRow;
  values: CouponDraftValues;
  changes: FormKey[];
  body: Record<string, unknown>;
}

export function proposeEdit(live: CouponRow, form: CouponForm, values: CouponDraftValues): CouponProposal {
  const changes = changedKeys(form, formFor(live));
  const body: Record<string, unknown> = { id: live.id };
  const expected: Record<string, unknown> = {};
  for (const key of changes) {
    switch (key) {
      case 'code':
        body.code = values.code;
        expected.code = live.code;
        break;
      case 'type':
        body.type = values.type;
        expected.type = live.type;
        break;
      case 'bonus':
        body.bonus_rate_naira = values.bonus;
        expected.bonus_rate_naira = live.bonus;
        break;
      case 'minTrade':
        body.min_trade_amount_usd = values.minTrade;
        expected.min_trade_amount_usd = live.minTrade;
        break;
      case 'expiry':
        body.expiry_date = values.expiry;
        expected.expiry_date = live.expiry;
        break;
      case 'limit':
        body.max_redemptions = values.limit;
        expected.max_redemptions = live.limit;
        break;
      case 'active':
        body.is_active = values.active;
        expected.is_active = live.active;
        break;
      case 'terms':
        body.terms_of_use = values.terms;
        expected.terms_of_use = live.terms;
        break;
      case 'restrictTo':
        body.eligibility_rules = withRestriction(live.rules, values.restrictTo);
        expected.eligibility_rules = live.rules;
        break;
    }
  }
  if (changes.length > 0) body.expected = expected;
  return { live, values, changes, body };
}

function withReason(body: Record<string, unknown>, reason: string): Record<string, unknown> {
  const note = reason.trim();
  return note ? { ...body, reason: note } : body;
}

export function editRequestBody(proposal: CouponProposal, reason: string): Record<string, unknown> {
  return withReason(proposal.body, reason);
}

export function createRequestBody(values: CouponDraftValues, reason: string): Record<string, unknown> {
  return withReason({
    code: values.code,
    type: values.type,
    bonus_rate_naira: values.bonus,
    min_trade_amount_usd: values.minTrade,
    expiry_date: values.expiry,
    max_redemptions: values.limit,
    is_active: values.active,
    eligibility_rules: withRestriction([], values.restrictTo),
    terms_of_use: values.terms,
  }, reason);
}

export function toggleRequestBody(live: CouponRow, next: boolean, reason: string): Record<string, unknown> {
  return withReason({ id: live.id, is_active: next, expected: { is_active: live.active } }, reason);
}

export function deleteRequestBody(live: CouponRow, reason: string): Record<string, unknown> {
  return { id: live.id, reason: reason.trim(), expected: { is_active: live.active, code: live.code } };
}

export function remainingLiability(bonus: number, limit: number | null, uses: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - uses) * bonus;
}

export function awaitingLosing(live: CouponRow, limit: number | null): number {
  const awaiting = live.awaitingTrades ?? 0;
  if (limit === null || awaiting === 0) return 0;
  return Math.max(0, awaiting - Math.max(0, limit - live.uses));
}

export interface MutationResult {
  coupon: CouponRow | null;
  changed: boolean;
  deleted: boolean;
  warning: string | null;
}

export function toMutationResult(body: ApiBody): MutationResult {
  return {
    coupon: toCouponRow(body.coupon),
    changed: body.changed !== false,
    deleted: body.deleted === true,
    warning: text(body.warning),
  };
}

export type MutationOutcome =
  | { kind: 'done'; result: MutationResult }
  | { kind: 'unknown'; message: string }
  | { kind: 'stale'; message: string; latest: CouponRow | null }
  | { kind: 'refused'; message: string }
  | { kind: 'expired' };

export type MutationAttempt = MutationOutcome | { kind: 'retry'; message: string };

function latestFrom(details: unknown): CouponRow | null {
  return isRecord(details) ? toCouponRow(details.coupon) : null;
}

export function classifyMutation(result: ApiResult<MutationResult>): MutationAttempt {
  if (result.ok) return { kind: 'done', result: result.data };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  if (failure.status === 403) return { kind: 'refused', message: failure.message };
  if (failure.status === 404 || failure.status === 409) {
    return { kind: 'stale', message: failure.message, latest: latestFrom(failure.details) };
  }
  return { kind: 'retry', message: failure.message };
}

export interface TermsChange {
  added: string[];
  removed: string[];
}

function termKey(term: string): string {
  return term.trim().toLowerCase();
}

export function diffTerms(base: readonly string[], next: readonly string[]): TermsChange {
  const before = new Set(base.map(termKey));
  const after = new Set(next.map(termKey));
  return {
    added: next.filter((term) => !before.has(termKey(term))),
    removed: base.filter((term) => !after.has(termKey(term))),
  };
}

export function applyTermsChange(fresh: readonly string[], change: TermsChange): string[] {
  const removed = new Set(change.removed.map(termKey));
  const kept = fresh.filter((term) => !removed.has(termKey(term)));
  const present = new Set(kept.map(termKey));
  return [...kept, ...change.added.filter((term) => !present.has(termKey(term)))];
}

export function sameTerms(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((term, index) => term === b[index]);
}

export function isEmptyTermsChange(change: TermsChange): boolean {
  return change.added.length === 0 && change.removed.length === 0;
}

export function termsUsage(rows: readonly CouponRow[], term: string): number {
  const key = termKey(term);
  return rows.filter((row) => row.terms !== null && termKey(row.terms) === key).length;
}

export interface StoredTerms {
  raw: string;
  terms: string[];
}

export function readStoredTerms(body: ApiBody): StoredTerms | null {
  if (!isRecord(body.config)) return null;
  const value = body.config[TERMS_CONFIG_KEY];
  const raw = typeof value === 'string' ? value : '';
  return { raw, terms: parseTermsList(raw) };
}

export function termsSaveBody(next: readonly string[], storedRaw: string): Record<string, unknown> {
  return {
    changes: { [TERMS_CONFIG_KEY]: JSON.stringify(next) },
    expected: { [TERMS_CONFIG_KEY]: storedRaw },
  };
}
