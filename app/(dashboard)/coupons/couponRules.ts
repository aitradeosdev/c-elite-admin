import { isUuid } from '../../lib/http';
import { businessDateKey, formatBusinessDate, lagosDateToRangeStart } from '../../lib/time';
import { formatNaira } from '../../_ui/money';

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

export const CODE_MIN = 3;
export const CODE_MAX = 32;
export const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;
export const TYPE_MAX = 80;
export const BONUS_MAX = 1_000_000_000;
export const MIN_TRADE_MAX = 10_000_000;
export const LIMIT_MAX = 10_000_000;
export const TERMS_MAX = 5000;
export const RULES_MAX = 50;
export const REASON_MAX = 500;
export const TERM_OPTION_MAX = 200;
export const TERM_OPTIONS_MAX = 100;
export const LARGE_BONUS = 100_000;
export const RESTRICT_RULE = 'specific_card_category';
export const AWAITING_STATUSES: readonly string[] = ['pending', 'disputed'];
export const TERMS_CONFIG_KEY = 'coupon_terms_of_use';

export type CouponField =
  | 'code'
  | 'type'
  | 'bonus_rate_naira'
  | 'min_trade_amount_usd'
  | 'expiry_date'
  | 'max_redemptions'
  | 'is_active'
  | 'terms_of_use'
  | 'eligibility_rules';

export const COUPON_FIELDS: readonly CouponField[] = [
  'code',
  'type',
  'bonus_rate_naira',
  'min_trade_amount_usd',
  'expiry_date',
  'max_redemptions',
  'is_active',
  'terms_of_use',
  'eligibility_rules',
];

export const FINANCIAL_FIELDS: ReadonlySet<CouponField> = new Set<CouponField>([
  'code',
  'type',
  'bonus_rate_naira',
  'min_trade_amount_usd',
  'expiry_date',
  'max_redemptions',
  'is_active',
  'eligibility_rules',
]);

export const GUARD_COLUMNS = [
  'code',
  'type',
  'bonus_rate_naira',
  'min_trade_amount_usd',
  'expiry_date',
  'max_redemptions',
  'is_active',
] as const;

export interface StoredCoupon {
  id: string;
  code: string | null;
  min_trade_amount_usd: number | string | null;
  expiry_date: string | null;
  type: string | null;
  bonus_rate_naira: number | string | null;
  is_active: boolean | null;
  use_count: number | null;
  max_redemptions: number | null;
  eligibility_rules: unknown;
  terms_of_use: string | null;
  created_at: string | null;
  [column: string]: unknown;
}

export interface CouponValues {
  code: string;
  type: string;
  bonus_rate_naira: number;
  min_trade_amount_usd: number;
  expiry_date: string | null;
  max_redemptions: number | null;
  is_active: boolean;
  terms_of_use: string | null;
  eligibility_rules: unknown[];
}

export type CouponExpected = Partial<CouponValues>;

export interface CouponPatch {
  id: string;
  fields: Partial<CouponValues>;
  expected: CouponExpected | null;
  reason: string | null;
}

export interface CouponPlan {
  update: Partial<CouponValues>;
  changed: CouponField[];
  before: Partial<CouponValues>;
  financial: boolean;
  problem: string | null;
}

export interface CouponDelete {
  id: string;
  reason: string;
  expected: CouponExpected | null;
}

export interface AwaitingTotals {
  trades: number;
  bonus: number;
}

export interface DeleteState {
  active: boolean;
  uses: number;
  redemptions: number;
  awaiting: number;
}

export interface TypeContext {
  brands: readonly string[] | null;
}

export interface CreateContext extends TypeContext {
  today: string;
}

const TYPE_PATTERN = /^[A-Za-z0-9 _\-&()]+$/;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
const PLAIN_DECIMAL = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const SIGNED_DECIMAL = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const PLAIN_INTEGER = /^\d+$/;
const COUNT_FORMAT = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });
const DAY_MS = 86_400_000;

const BONUS_PROBLEM = `The bonus must be a number from ${formatNaira(0)} to ${formatNaira(BONUS_MAX)}.`;
const MIN_TRADE_PROBLEM = `The minimum card value must be a number from 0 to ${COUNT_FORMAT.format(MIN_TRADE_MAX)}.`;
const LIMIT_PROBLEM = `The usage limit must be a whole number from 1 to ${COUNT_FORMAT.format(LIMIT_MAX)}, or empty for no limit.`;
const EXPIRY_FORMAT_PROBLEM = 'Use a date like 2026-12-31 for the expiry date.';
const ACTIVE_PROBLEM = 'is_active must be true or false.';
const EXPECTED_PROBLEM = 'The expected values sent with this change are not valid.';

function refuse<T>(message: string): Checked<T> {
  return { ok: false, message };
}

function accept<T>(value: T): Checked<T> {
  return { ok: true, value };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

export function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

export function readId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return isUuid(id) ? id : null;
}

export function toAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!SIGNED_DECIMAL.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

export function toWhole(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && PLAIN_INTEGER.test(value.trim())) {
    const number = Number(value.trim());
    return Number.isSafeInteger(number) ? number : null;
  }
  return null;
}

export function sameAmount(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.000001;
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2999 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toDateKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = DATE_PREFIX.exec(value.trim());
  if (!match) return null;
  const key = `${match[1]}-${match[2]}-${match[3]}`;
  return isDateKey(key) ? key : null;
}

export function todayKey(now: Date = new Date()): string {
  return businessDateKey(now);
}

export function formatDateKey(key: string | null | undefined): string {
  if (!key || !isDateKey(key)) return '—';
  return formatBusinessDate(lagosDateToRangeStart(key));
}

function dayNumber(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export function daysUntil(key: string, today: string): number {
  return Math.round(dayNumber(key) - dayNumber(today));
}

export function normalizeCode(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim().toUpperCase();
}

export function codeProblem(code: string): string | null {
  if (!code) return 'Enter a coupon code.';
  if (!CODE_PATTERN.test(code)) {
    return `Use ${CODE_MIN} to ${CODE_MAX} capital letters, numbers, hyphens or underscores for the code.`;
  }
  return null;
}

export function sameCode(a: unknown, b: unknown): boolean {
  return normalizeCode(a) === normalizeCode(b);
}

function brandKey(name: string): string {
  return name.trim().toLowerCase();
}

export function sameBrand(a: unknown, b: unknown): boolean {
  return brandKey(String(a ?? '')) === brandKey(String(b ?? ''));
}

export function findBrand(name: string, brands: readonly string[]): string | null {
  const key = brandKey(name);
  if (!key) return null;
  return brands.find((brand) => brandKey(brand) === key)?.trim() ?? null;
}

export function resolveType(value: unknown, brands: readonly string[] | null): Checked<string> {
  const type = textOrNull(value) ?? '';
  if (!type) return refuse('Choose the card brand this coupon applies to.');
  if (type.length > TYPE_MAX) return refuse(`Brand names can be at most ${TYPE_MAX} characters.`);
  const brand = brands ? findBrand(type, brands) : null;
  if (brand) return accept(brand);
  if (TYPE_PATTERN.test(type)) return accept(type);
  return refuse(`“${type}” is not a card brand in the catalog. Choose the brand exactly as it is listed in Cards.`);
}

export function rulesList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function restrictionOf(rules: unknown): string | null {
  for (const rule of rulesList(rules)) {
    if (!isRecord(rule) || rule.type !== RESTRICT_RULE) continue;
    const value = textOrNull(rule.value);
    if (value) return value;
  }
  return null;
}

export function withRestriction(rules: unknown, restrictTo: string | null): unknown[] {
  const kept = rulesList(rules).filter((rule) => !(isRecord(rule) && rule.type === RESTRICT_RULE));
  const value = textOrNull(restrictTo);
  return value ? [...kept, { type: RESTRICT_RULE, value }] : kept;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function sameRules(a: unknown, b: unknown): boolean {
  return canonicalJson(rulesList(a)) === canonicalJson(rulesList(b));
}

export function couponValues(row: StoredCoupon): CouponValues {
  return {
    code: textOrNull(row.code) ?? '',
    type: textOrNull(row.type) ?? '',
    bonus_rate_naira: toAmount(row.bonus_rate_naira) ?? 0,
    min_trade_amount_usd: toAmount(row.min_trade_amount_usd) ?? 0,
    expiry_date: toDateKey(row.expiry_date),
    max_redemptions: toWhole(row.max_redemptions),
    is_active: row.is_active === true,
    terms_of_use: textOrNull(row.terms_of_use),
    eligibility_rules: rulesList(row.eligibility_rules),
  };
}

export function sameCouponValue(field: CouponField, a: unknown, b: unknown): boolean {
  switch (field) {
    case 'code':
      return sameCode(a, b);
    case 'type':
      return sameBrand(a, b);
    case 'bonus_rate_naira':
    case 'min_trade_amount_usd':
      return sameAmount(toAmount(a ?? 0), toAmount(b ?? 0));
    case 'expiry_date':
      return toDateKey(a) === toDateKey(b);
    case 'max_redemptions':
      return toWhole(a) === toWhole(b);
    case 'is_active':
      return (a === true) === (b === true);
    case 'terms_of_use':
      return textOrNull(a) === textOrNull(b);
    case 'eligibility_rules':
      return sameRules(a, b);
  }
}

export function couponConflicts(expected: CouponExpected, live: StoredCoupon): CouponField[] {
  const current = couponValues(live);
  return COUPON_FIELDS.filter((field) => field in expected && !sameCouponValue(field, expected[field], current[field]));
}

function readMoney(value: unknown, max: number, problem: string): Checked<number> {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return accept(0);
  let amount: number | null = null;
  if (typeof value === 'number') amount = Number.isFinite(value) ? value : null;
  else if (typeof value === 'string' && PLAIN_DECIMAL.test(value.trim())) amount = Number(value.trim());
  if (amount === null || amount < 0 || amount > max) return refuse(problem);
  return accept(amount);
}

function readLimit(value: unknown): Checked<number | null> {
  if (value === null || (typeof value === 'string' && value.trim() === '')) return accept(null);
  const limit = toWhole(value);
  if (limit === null || limit < 1 || limit > LIMIT_MAX) return refuse(LIMIT_PROBLEM);
  return accept(limit);
}

function readExpiryFormat(value: unknown): Checked<string | null> {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return accept(null);
  const key = toDateKey(value);
  return key ? accept(key) : refuse(EXPIRY_FORMAT_PROBLEM);
}

export function pastExpiryProblem(key: string): string {
  return `The expiry date ${formatDateKey(key)} has already passed. Pick today or a later date.`;
}

function readActive(value: unknown, fallback: boolean): Checked<boolean> {
  if (value === undefined || value === null) return accept(fallback);
  if (typeof value === 'boolean') return accept(value);
  if (value === 'true' || value === 1) return accept(true);
  if (value === 'false' || value === 0) return accept(false);
  return refuse(ACTIVE_PROBLEM);
}

function readTerms(value: unknown): Checked<string | null> {
  const text = textOrNull(value);
  if (text !== null && text.length > TERMS_MAX) {
    return refuse(`Keep the terms of use to ${formatCount(TERMS_MAX)} characters or fewer.`);
  }
  return accept(text);
}

function readRules(value: unknown): unknown[] {
  return rulesList(value).slice(0, RULES_MAX);
}

export function readReason(value: unknown): Checked<string | null> {
  if (value === undefined || value === null) return accept(null);
  if (typeof value !== 'string') return refuse('The reason must be text.');
  const reason = value.trim();
  if (reason.length > REASON_MAX) return refuse(`Keep the reason to ${REASON_MAX} characters or fewer.`);
  return accept(reason === '' ? null : reason);
}

function readExpected(value: unknown): Checked<CouponExpected | null> {
  if (value === undefined || value === null) return accept(null);
  if (!isRecord(value)) return refuse(EXPECTED_PROBLEM);
  const expected: CouponExpected = {};
  if ('code' in value) {
    if (typeof value.code !== 'string') return refuse(EXPECTED_PROBLEM);
    expected.code = normalizeCode(value.code);
  }
  if ('type' in value) {
    if (value.type !== null && typeof value.type !== 'string') return refuse(EXPECTED_PROBLEM);
    expected.type = textOrNull(value.type) ?? '';
  }
  for (const field of ['bonus_rate_naira', 'min_trade_amount_usd'] as const) {
    if (!(field in value)) continue;
    const raw = value[field];
    const amount = raw === null ? 0 : toAmount(raw);
    if (amount === null) return refuse(EXPECTED_PROBLEM);
    expected[field] = amount;
  }
  if ('expiry_date' in value) {
    const raw = value.expiry_date;
    const key = raw === null || raw === '' ? null : toDateKey(raw);
    if (raw !== null && raw !== '' && key === null) return refuse(EXPECTED_PROBLEM);
    expected.expiry_date = key;
  }
  if ('max_redemptions' in value) {
    const raw = value.max_redemptions;
    const limit = raw === null ? null : toWhole(raw);
    if (raw !== null && limit === null) return refuse(EXPECTED_PROBLEM);
    expected.max_redemptions = limit;
  }
  if ('is_active' in value) {
    if (typeof value.is_active !== 'boolean') return refuse(EXPECTED_PROBLEM);
    expected.is_active = value.is_active;
  }
  if ('terms_of_use' in value) {
    const raw = value.terms_of_use;
    if (raw !== null && typeof raw !== 'string') return refuse(EXPECTED_PROBLEM);
    expected.terms_of_use = textOrNull(raw);
  }
  if ('eligibility_rules' in value) {
    if (!Array.isArray(value.eligibility_rules)) return refuse(EXPECTED_PROBLEM);
    expected.eligibility_rules = value.eligibility_rules;
  }
  return accept(expected);
}

export function readCouponCreate(body: unknown, context: CreateContext): Checked<CouponValues> {
  if (!isRecord(body)) return refuse('Send the coupon as a JSON object.');
  const code = normalizeCode(body.code);
  const codeIssue = codeProblem(code);
  if (codeIssue) return refuse(codeIssue);
  const type = resolveType(body.type, context.brands);
  if (!type.ok) return type;
  const bonus = readMoney(body.bonus_rate_naira, BONUS_MAX, BONUS_PROBLEM);
  if (!bonus.ok) return bonus;
  const minTrade = readMoney(body.min_trade_amount_usd, MIN_TRADE_MAX, MIN_TRADE_PROBLEM);
  if (!minTrade.ok) return minTrade;
  const expiry = readExpiryFormat(body.expiry_date);
  if (!expiry.ok) return expiry;
  if (expiry.value !== null && expiry.value < context.today) return refuse(pastExpiryProblem(expiry.value));
  const limit = body.max_redemptions === undefined ? accept<number | null>(null) : readLimit(body.max_redemptions);
  if (!limit.ok) return limit;
  const active = readActive(body.is_active, true);
  if (!active.ok) return active;
  const terms = readTerms(body.terms_of_use);
  if (!terms.ok) return terms;
  return accept({
    code,
    type: type.value,
    bonus_rate_naira: bonus.value,
    min_trade_amount_usd: minTrade.value,
    expiry_date: expiry.value,
    max_redemptions: limit.value,
    is_active: active.value,
    terms_of_use: terms.value,
    eligibility_rules: readRules(body.eligibility_rules),
  });
}

export function readCouponPatch(body: unknown, context: TypeContext): Checked<CouponPatch> {
  if (!isRecord(body)) return refuse('Send the changes as a JSON object.');
  if (body.id === undefined || body.id === null || body.id === '') return refuse('Missing id');
  const id = readId(body.id);
  if (!id) return refuse('A valid coupon id is required.');
  const fields: Partial<CouponValues> = {};
  if (body.code !== undefined) {
    const code = normalizeCode(body.code);
    const issue = codeProblem(code);
    if (issue) return refuse(issue);
    fields.code = code;
  }
  if (body.type !== undefined) {
    const type = resolveType(body.type, context.brands);
    if (!type.ok) return type;
    fields.type = type.value;
  }
  if (body.bonus_rate_naira !== undefined) {
    const bonus = readMoney(body.bonus_rate_naira, BONUS_MAX, BONUS_PROBLEM);
    if (!bonus.ok) return bonus;
    fields.bonus_rate_naira = bonus.value;
  }
  if (body.min_trade_amount_usd !== undefined) {
    const minTrade = readMoney(body.min_trade_amount_usd, MIN_TRADE_MAX, MIN_TRADE_PROBLEM);
    if (!minTrade.ok) return minTrade;
    fields.min_trade_amount_usd = minTrade.value;
  }
  if (body.expiry_date !== undefined) {
    const expiry = readExpiryFormat(body.expiry_date);
    if (!expiry.ok) return expiry;
    fields.expiry_date = expiry.value;
  }
  if (body.max_redemptions !== undefined) {
    const limit = readLimit(body.max_redemptions);
    if (!limit.ok) return limit;
    fields.max_redemptions = limit.value;
  }
  if (body.is_active !== undefined) {
    const active = readActive(body.is_active, false);
    if (!active.ok) return active;
    fields.is_active = active.value;
  }
  if (body.eligibility_rules !== undefined) fields.eligibility_rules = readRules(body.eligibility_rules);
  if (body.terms_of_use !== undefined) {
    const terms = readTerms(body.terms_of_use);
    if (!terms.ok) return terms;
    fields.terms_of_use = terms.value;
  }
  const expected = readExpected(body.expected);
  if (!expected.ok) return expected;
  const reason = readReason(body.reason);
  if (!reason.ok) return reason;
  return accept({ id, fields, expected: expected.value, reason: reason.value });
}

export function planCouponUpdate(fields: Partial<CouponValues>, live: StoredCoupon, today: string): CouponPlan {
  const current = couponValues(live);
  const update: Partial<CouponValues> = {};
  const before: Partial<CouponValues> = {};
  const changed: CouponField[] = [];
  for (const field of COUPON_FIELDS) {
    if (!(field in fields)) continue;
    const next = fields[field];
    if (sameCouponValue(field, next, current[field])) continue;
    (update as Record<string, unknown>)[field] = next;
    (before as Record<string, unknown>)[field] = current[field];
    changed.push(field);
  }
  const expiry = update.expiry_date;
  return {
    update,
    changed,
    before,
    financial: changed.some((field) => FINANCIAL_FIELDS.has(field)),
    problem: typeof expiry === 'string' && expiry < today ? pastExpiryProblem(expiry) : null,
  };
}

export function readCouponDelete(body: unknown, queryId: string | null): Checked<CouponDelete> {
  const record = isRecord(body) ? body : {};
  const id = readId(record.id ?? queryId);
  if (!id) return refuse('A valid coupon id is required.');
  const reason = readReason(record.reason);
  if (!reason.ok) return reason;
  if (!reason.value) return refuse('Give a reason for deleting this coupon. It is recorded in the audit log.');
  const expected = readExpected(record.expected);
  if (!expected.ok) return expected;
  return accept({ id, reason: reason.value, expected: expected.value });
}

export function awaitingKey(code: unknown): string {
  return code === null || code === undefined ? '' : String(code).toUpperCase();
}

export function awaitingByCode(
  rows: ReadonlyArray<{ coupon_code: unknown; coupon_bonus: unknown }>,
): Map<string, AwaitingTotals> {
  const totals = new Map<string, AwaitingTotals>();
  for (const row of rows) {
    const key = awaitingKey(row.coupon_code);
    const bonus = toAmount(row.coupon_bonus) ?? 0;
    if (!key || bonus <= 0) continue;
    const current = totals.get(key) ?? { trades: 0, bonus: 0 };
    totals.set(key, { trades: current.trades + 1, bonus: current.bonus + bonus });
  }
  return totals;
}

export function awaitingFor(code: unknown, totals: ReadonlyMap<string, AwaitingTotals>): AwaitingTotals {
  return totals.get(awaitingKey(code)) ?? { trades: 0, bonus: 0 };
}

export function deleteBlocker(state: DeleteState): string | null {
  if (state.active) return 'Switch this coupon off before deleting it, so nobody can apply it while it is being removed.';
  const used = Math.max(state.uses, state.redemptions);
  if (used > 0) {
    return `This coupon has been used ${plural(used, 'time', 'times')}, so it cannot be deleted. Keep it switched off to preserve its redemption history.`;
  }
  if (state.awaiting > 0) {
    return `${plural(state.awaiting, 'trade awaiting review has', 'trades awaiting review have')} this coupon applied. Deleting it would cancel ${state.awaiting === 1 ? 'that bonus' : 'those bonuses'}, so it cannot be deleted until ${state.awaiting === 1 ? 'it is' : 'they are'} decided.`;
  }
  return null;
}

export function parseTermsList(raw: unknown): string[] {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const term = item.trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

export function termProblem(term: string, list: readonly string[]): string | null {
  const text = term.trim();
  if (!text) return 'Type the term first.';
  if (text.length > TERM_OPTION_MAX) return `Keep each term to ${TERM_OPTION_MAX} characters or fewer.`;
  if (list.some((item) => item.trim().toLowerCase() === text.toLowerCase())) return 'That term is already in the list.';
  if (list.length >= TERM_OPTIONS_MAX) return `The list can hold at most ${TERM_OPTIONS_MAX} terms.`;
  return null;
}

export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
