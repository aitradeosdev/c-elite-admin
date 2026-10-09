import { isUuid } from '../../lib/http';
import { formatNaira } from '../../_ui/money';

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

export const GIFTBOX_TITLE_MAX = 120;
export const GIFTBOX_DESCRIPTION_MAX = 1000;
export const GIFTBOX_NOTE_MAX = 200;
export const GIFTBOX_REWARD_MAX = 100_000_000;
export const RULES_MAX = 50;
export const LEVEL_COUNT = 6;
export const LEVEL_NAME_MAX = 80;
export const LEVEL_AMOUNT_MAX = 1_000_000_000;
export const BADGE_URL_MAX = 500;
export const SIGNUP_BONUS_MAX = 1_000_000;
export const RULE_COUNT_MAX = 100_000;
export const RULE_DAYS_MAX = 3650;
export const RULE_AMOUNT_MAX = 1_000_000_000;
export const RULE_TEXT_MAX = 80;
export const RULE_LIST_MAX = 50;
export const REASON_MAX = 500;
export const LARGE_MOVE = 0.5;
export const HUGE_FACTOR = 10;

const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
const PLAIN_NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const SIGNED_NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const PLAIN_INTEGER = /^\d+$/;
const GROUPED_NUMBER = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const CURRENCY_PREFIX = /^[₦$]\s*/;
const BADGE_URL = /^https:\/\/[^\s<>"']{3,}$/i;
const AMOUNT_FORMAT = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 });
const COUNT_FORMAT = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });

function refuse<T>(message: string): Checked<T> {
  return { ok: false, message };
}

function accept<T>(value: T): Checked<T> {
  return { ok: true, value };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function formatAmount(value: number): string {
  return AMOUNT_FORMAT.format(value);
}

export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

export function formatUsd(value: number): string {
  return `$${formatAmount(value)}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export function toAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!SIGNED_NUMBER.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

export function sameAmount(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.000001;
}

export function hasAtMostCents(value: number): boolean {
  return Math.abs(Math.round(value * 100) - value * 100) < 0.000001;
}

export function cleanNumberText(text: string): string {
  const trimmed = text.trim().replace(CURRENCY_PREFIX, '');
  return GROUPED_NUMBER.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed;
}

export function parseAmountText(text: string): number | null {
  const plain = cleanNumberText(text);
  if (!PLAIN_NUMBER.test(plain)) return null;
  const value = Number(plain);
  return Number.isFinite(value) ? value : null;
}

export interface AmountRule {
  noun: string;
  max: number;
  positive?: boolean;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function amountTextProblem(text: string, rule: AmountRule): string | null {
  const cleaned = text.trim().replace(CURRENCY_PREFIX, '');
  if (cleaned === '') return `Enter ${rule.noun}.`;
  if (cleaned.startsWith('-')) return `${capitalise(rule.noun.replace(/^(an?|the) /, ''))} cannot be negative.`;
  const plain = cleanNumberText(text);
  if (!PLAIN_NUMBER.test(plain)) {
    return cleaned.includes(',')
      ? 'Use a full stop for decimals and commas only between thousands, like 1,500.50.'
      : 'Enter a number, like 1500 or 1500.50.';
  }
  const value = Number(plain);
  if (!hasAtMostCents(value)) return 'Use at most 2 decimal places.';
  if (value > rule.max) return `Use ${formatAmount(rule.max)} or less.`;
  if (rule.positive && value === 0) return 'Enter an amount above 0.';
  return null;
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
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

export function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
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

export function readFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return undefined;
}

export function readReason(value: unknown): Checked<string | null> {
  if (value === undefined || value === null) return accept(null);
  if (typeof value !== 'string') return refuse('The reason must be text.');
  const reason = value.trim();
  if (reason.length > REASON_MAX) return refuse(`Keep the reason to ${REASON_MAX} characters or fewer.`);
  return accept(reason === '' ? null : reason);
}

function readMoney(value: unknown, max: number): number | null {
  const amount = typeof value === 'string' && PLAIN_NUMBER.test(value.trim())
    ? Number(value.trim())
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : null;
  if (amount === null || amount < 0 || amount > max || !hasAtMostCents(amount)) return null;
  return amount;
}

function readWhole(value: unknown, min: number, max: number): number | null {
  const number = typeof value === 'string' && PLAIN_INTEGER.test(value.trim())
    ? Number(value.trim())
    : typeof value === 'number'
      ? value
      : null;
  if (number === null || !Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

export type RuleKind =
  | 'count'
  | 'days'
  | 'level'
  | 'usd'
  | 'naira'
  | 'text'
  | 'list'
  | 'none'
  | 'countDays'
  | 'usdDays'
  | 'usdCard';

export type RuleGroup = 'Trading' | 'Levels' | 'Account' | 'Wallet' | 'Referrals' | 'Gift boxes';

export interface RuleSpec {
  type: string;
  label: string;
  kind: RuleKind;
  group: RuleGroup;
  retired: string | null;
}

export type RuleValue =
  | number
  | string
  | string[]
  | { count: number; days: number }
  | { amount: number; days: number }
  | { amount: number; card: string }
  | null;

export interface Rule {
  type: string;
  value: RuleValue;
}

const ONE_CLAIM = 'Each user can claim a gift box only once, because the database allows one claim per user and gift box';

export const RULE_SPECS: readonly RuleSpec[] = [
  { type: 'min_trades', label: 'Approved trades', kind: 'count', group: 'Trading', retired: null },
  { type: 'min_volume_usd', label: 'Lifetime trade value', kind: 'usd', group: 'Trading', retired: null },
  { type: 'min_single_trade_usd', label: 'A single trade worth', kind: 'usdCard', group: 'Trading', retired: null },
  { type: 'trades_in_period', label: 'Trades in recent days', kind: 'countDays', group: 'Trading', retired: null },
  { type: 'volume_in_period', label: 'Trade value in recent days', kind: 'usdDays', group: 'Trading', retired: null },
  { type: 'min_card_categories', label: 'Card brands traded', kind: 'count', group: 'Trading', retired: null },
  { type: 'specific_card_category', label: 'Has traded a card', kind: 'text', group: 'Trading', retired: null },
  { type: 'min_avg_trade_usd', label: 'Average trade value', kind: 'usd', group: 'Trading', retired: null },
  { type: 'consecutive_days_active', label: 'Days in a row trading', kind: 'count', group: 'Trading', retired: null },
  { type: 'has_used_coupon', label: 'Has used a coupon', kind: 'none', group: 'Trading', retired: null },
  { type: 'min_level', label: 'Level at or above', kind: 'level', group: 'Levels', retired: null },
  { type: 'exact_level', label: 'Exact level', kind: 'level', group: 'Levels', retired: null },
  { type: 'has_claimed_level_bonus', label: 'Has claimed a level bonus', kind: 'none', group: 'Levels', retired: null },
  { type: 'min_account_age_days', label: 'Account at least this old', kind: 'days', group: 'Account', retired: null },
  { type: 'max_account_age_days', label: 'Account at most this old', kind: 'days', group: 'Account', retired: null },
  { type: 'email_verified', label: 'Email verified', kind: 'none', group: 'Account', retired: null },
  { type: 'has_set_pin', label: 'Transaction PIN set', kind: 'none', group: 'Account', retired: null },
  { type: 'has_bank_account', label: 'Saved bank account', kind: 'none', group: 'Account', retired: null },
  { type: 'country_in', label: 'Country', kind: 'list', group: 'Account', retired: null },
  { type: 'min_balance_naira', label: 'Wallet balance', kind: 'naira', group: 'Wallet', retired: null },
  { type: 'min_referrals', label: 'Referrals', kind: 'count', group: 'Referrals', retired: null },
  { type: 'min_successful_referrals', label: 'Referrals who traded', kind: 'count', group: 'Referrals', retired: null },
  { type: 'first_time_claimer', label: 'First gift box', kind: 'none', group: 'Gift boxes', retired: null },
  {
    type: 'max_claims_per_user',
    label: 'Claims per user',
    kind: 'count',
    group: 'Gift boxes',
    retired: `${ONE_CLAIM}, so this limit has no effect.`,
  },
  {
    type: 'cooldown_days',
    label: 'Cooldown between claims',
    kind: 'days',
    group: 'Gift boxes',
    retired: `${ONE_CLAIM}, so a cooldown never applies.`,
  },
  { type: 'min_withdrawn_total', label: 'Lifetime withdrawals', kind: 'naira', group: 'Wallet', retired: null },
];

const SPEC_BY_TYPE: ReadonlyMap<string, RuleSpec> = new Map(RULE_SPECS.map((spec) => [spec.type, spec]));

export const RULE_GROUPS: readonly RuleGroup[] = ['Trading', 'Levels', 'Account', 'Wallet', 'Referrals', 'Gift boxes'];

export const OFFERED_RULES: readonly RuleSpec[] = RULE_SPECS.filter((spec) => spec.retired === null);

export const DEFAULT_RULE_TYPE = 'min_trades';

export function ruleSpec(type: unknown): RuleSpec | null {
  return typeof type === 'string' ? SPEC_BY_TYPE.get(type.trim()) ?? null : null;
}

export function ruleType(raw: unknown): string {
  return isRecord(raw) && typeof raw.type === 'string' ? raw.type.trim() : '';
}

type ValueCheck = { ok: true; value: RuleValue } | { ok: false; message: string };

const COUNT_MESSAGE = `Enter a whole number from 1 to ${formatCount(RULE_COUNT_MAX)}.`;
const DAYS_MESSAGE = `Enter a whole number of days from 1 to ${formatCount(RULE_DAYS_MAX)}.`;
const LEVEL_MESSAGE = `Enter a level from 1 to ${LEVEL_COUNT}.`;
const POSITIVE_MESSAGE = `Enter an amount above 0 with at most 2 decimal places, up to ${formatAmount(RULE_AMOUNT_MAX)}.`;
const AMOUNT_MESSAGE = `Enter an amount of 0 or more with at most 2 decimal places, up to ${formatAmount(RULE_AMOUNT_MAX)}.`;

function positiveMoney(value: unknown): number | null {
  const amount = readMoney(value, RULE_AMOUNT_MAX);
  return amount !== null && amount > 0 ? amount : null;
}

function readCardName(value: unknown, required: boolean): Checked<string> {
  const name = typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : null;
  if (name === null) return refuse('Enter the card name as text.');
  if (required && name === '') return refuse('Enter the card name exactly as it is listed in Cards.');
  if (name.length > RULE_TEXT_MAX) return refuse(`Use ${RULE_TEXT_MAX} characters or fewer for the card name.`);
  return accept(name);
}

export function splitList(value: unknown): string[] | null {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null;
  if (parts === null) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (typeof part !== 'string') return null;
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function checkValue(spec: RuleSpec, value: unknown): ValueCheck {
  const record = isRecord(value) ? value : null;
  switch (spec.kind) {
    case 'count': {
      const count = readWhole(value, 1, RULE_COUNT_MAX);
      return count === null ? { ok: false, message: COUNT_MESSAGE } : { ok: true, value: count };
    }
    case 'days': {
      const days = readWhole(value, 1, RULE_DAYS_MAX);
      return days === null ? { ok: false, message: DAYS_MESSAGE } : { ok: true, value: days };
    }
    case 'level': {
      const level = readWhole(value, 1, LEVEL_COUNT);
      return level === null ? { ok: false, message: LEVEL_MESSAGE } : { ok: true, value: level };
    }
    case 'usd':
    case 'naira': {
      const amount = positiveMoney(value);
      return amount === null ? { ok: false, message: POSITIVE_MESSAGE } : { ok: true, value: amount };
    }
    case 'text': {
      const name = readCardName(value, true);
      return name.ok ? { ok: true, value: name.value } : name;
    }
    case 'list': {
      const names = splitList(value);
      if (names === null || names.length === 0) return { ok: false, message: 'Enter at least one country name, separated by commas.' };
      if (names.length > RULE_LIST_MAX) return { ok: false, message: `Use at most ${RULE_LIST_MAX} countries.` };
      if (names.some((name) => name.length > RULE_TEXT_MAX)) {
        return { ok: false, message: `Keep each country name to ${RULE_TEXT_MAX} characters or fewer.` };
      }
      return { ok: true, value: names };
    }
    case 'none':
      return { ok: true, value: null };
    case 'countDays': {
      const count = readWhole(record?.count, 1, RULE_COUNT_MAX);
      if (count === null) return { ok: false, message: `Enter how many trades, as a whole number from 1 to ${formatCount(RULE_COUNT_MAX)}.` };
      const days = readWhole(record?.days, 1, RULE_DAYS_MAX);
      if (days === null) return { ok: false, message: DAYS_MESSAGE };
      return { ok: true, value: { count, days } };
    }
    case 'usdDays': {
      const amount = positiveMoney(record?.amount);
      if (amount === null) return { ok: false, message: POSITIVE_MESSAGE };
      const days = readWhole(record?.days, 1, RULE_DAYS_MAX);
      if (days === null) return { ok: false, message: DAYS_MESSAGE };
      return { ok: true, value: { amount, days } };
    }
    case 'usdCard': {
      const amount = readMoney(record?.amount, RULE_AMOUNT_MAX);
      if (amount === null) return { ok: false, message: AMOUNT_MESSAGE };
      const card = readCardName(record?.card, false);
      if (!card.ok) return card;
      return { ok: true, value: { amount, card: card.value } };
    }
  }
}

export function checkRule(raw: unknown): Checked<Rule> {
  if (!isRecord(raw)) return refuse('This is not a valid rule.');
  const type = ruleType(raw);
  const spec = ruleSpec(type);
  if (!spec) {
    return refuse(`“${type || 'blank'}” is not a rule the claim check understands, so every claim would fail with an error.`);
  }
  if (spec.retired) return refuse(`${spec.label} cannot be used. ${spec.retired}`);
  const checked = checkValue(spec, raw.value);
  if (!checked.ok) return refuse(checked.message);
  return accept({ type: spec.type, value: checked.value });
}

export function readRules(value: unknown): Checked<Rule[]> {
  if (value === undefined || value === null) return accept([]);
  if (!Array.isArray(value)) return refuse('eligibility_rules must be a list of rules.');
  if (value.length > RULES_MAX) return refuse(`A gift box can have at most ${RULES_MAX} rules.`);
  const rules: Rule[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const checked = checkRule(value[index]);
    if (!checked.ok) return refuse(`Rule ${index + 1}: ${checked.message}`);
    rules.push(checked.value);
  }
  return accept(rules);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
  return JSON.stringify(value === undefined ? null : value);
}

export function rulesList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function sameRules(a: unknown, b: unknown): boolean {
  return canonicalJson(rulesList(a)) === canonicalJson(rulesList(b));
}

function countText(value: unknown, one: string, many: string): string {
  const count = toAmount(value);
  return count === null ? `? ${many}` : plural(count, one, many);
}

function usdText(value: unknown): string {
  const amount = toAmount(value);
  return amount === null ? '$?' : formatUsd(amount);
}

function nairaText(value: unknown): string {
  const amount = toAmount(value);
  return amount === null ? '₦?' : formatNaira(amount);
}

function plainText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '?';
}

export function describeRule(raw: unknown): string {
  if (!isRecord(raw)) return 'Unreadable rule';
  const type = ruleType(raw);
  const spec = ruleSpec(type);
  if (!spec) return `Unrecognised rule “${type || 'blank'}”`;
  const value = raw.value;
  const record: Record<string, unknown> = isRecord(value) ? value : {};
  switch (spec.type) {
    case 'min_trades':
      return `At least ${countText(value, 'approved trade', 'approved trades')}`;
    case 'min_volume_usd':
      return `Lifetime trades worth at least ${usdText(value)}`;
    case 'min_single_trade_usd': {
      const card = typeof record.card === 'string' && record.card.trim() ? `on ${record.card.trim()}` : 'on any card';
      return `One trade worth at least ${usdText(record.amount)} ${card}`;
    }
    case 'trades_in_period':
      return `At least ${countText(record.count, 'trade', 'trades')} in the last ${countText(record.days, 'day', 'days')}`;
    case 'volume_in_period':
      return `Trades worth at least ${usdText(record.amount)} in the last ${countText(record.days, 'day', 'days')}`;
    case 'min_card_categories':
      return `Traded at least ${countText(value, 'card brand', 'different card brands')}`;
    case 'specific_card_category':
      return `Has traded ${plainText(value)}`;
    case 'min_avg_trade_usd':
      return `Average trade worth at least ${usdText(value)}`;
    case 'consecutive_days_active':
      return `Traded on at least ${countText(value, 'day in a row', 'days in a row')}`;
    case 'has_used_coupon':
      return 'Has used a coupon on an approved trade';
    case 'min_level':
      return `At level ${toAmount(value) ?? '?'} or above`;
    case 'exact_level':
      return `At level ${toAmount(value) ?? '?'} exactly`;
    case 'has_claimed_level_bonus':
      return 'Has claimed a level bonus';
    case 'min_account_age_days':
      return `Account at least ${countText(value, 'day', 'days')} old`;
    case 'max_account_age_days':
      return `Account no more than ${countText(value, 'day', 'days')} old`;
    case 'email_verified':
      return 'Email address verified';
    case 'has_set_pin':
      return 'Transaction PIN set';
    case 'has_bank_account':
      return 'Has a saved bank account';
    case 'country_in': {
      const names = splitList(value);
      return names && names.length > 0 ? `Country is ${names.join(' or ')}` : 'Country is ?';
    }
    case 'min_balance_naira':
      return `Wallet balance of at least ${nairaText(value)}`;
    case 'min_referrals':
      return `At least ${countText(value, 'referral', 'referrals')}`;
    case 'min_successful_referrals':
      return `At least ${countText(value, 'referral who has traded', 'referrals who have traded')}`;
    case 'first_time_claimer':
      return 'Has never claimed a gift box';
    case 'max_claims_per_user':
      return `No more than ${countText(value, 'claim', 'claims')} per user`;
    case 'cooldown_days':
      return `${capitalise(countText(value, 'day', 'days'))} between claims`;
    case 'min_withdrawn_total':
      return `Successful withdrawals totalling at least ${nairaText(value)}, fees included`;
    default:
      return spec.label;
  }
}

export type RuleImpactLevel = 'ok' | 'warning' | 'blocking';

export interface RuleImpact {
  level: RuleImpactLevel;
  message: string | null;
}

const DIRECT_NUMBER_KINDS: ReadonlySet<RuleKind> = new Set<RuleKind>(['count', 'days', 'level', 'usd', 'naira']);

export function ruleImpact(raw: unknown): RuleImpact {
  const spec = ruleSpec(ruleType(raw));
  if (!spec || !isRecord(raw)) {
    return { level: 'blocking', message: 'The claim check does not recognise this rule, so every claim attempt fails with an error.' };
  }
  const value = raw.value;
  if (DIRECT_NUMBER_KINDS.has(spec.kind) && (typeof value !== 'number' || !Number.isFinite(value))) {
    return { level: 'blocking', message: 'Its value is not stored as a number, so every claim attempt fails with an error.' };
  }
  if (spec.kind === 'list' && !Array.isArray(value)) {
    return { level: 'blocking', message: 'Its countries are not stored as a list, so every claim attempt fails with an error.' };
  }
  if (spec.type === 'max_claims_per_user') {
    const extra = typeof value === 'number' && value > 1 ? ' A second attempt shows the user a database error.' : '';
    return { level: 'warning', message: `${spec.retired}${extra}` };
  }
  if (spec.type === 'cooldown_days') {
    return { level: 'warning', message: `${spec.retired} A second attempt shows the user a database error.` };
  }
  return { level: 'ok', message: null };
}

export function rulesImpact(rules: unknown): RuleImpactLevel {
  let level: RuleImpactLevel = 'ok';
  for (const rule of rulesList(rules)) {
    const impact = ruleImpact(rule).level;
    if (impact === 'blocking') return 'blocking';
    if (impact === 'warning') level = 'warning';
  }
  return level;
}

export function countryCodeWarning(value: unknown): string | null {
  const names = splitList(value) ?? [];
  const codes = names.filter((name) => /^[A-Za-z]{2,3}$/.test(name));
  if (codes.length === 0) return null;
  return `Users’ countries are stored as full names such as Nigeria, so ${codes.join(', ')} ${codes.length === 1 ? 'matches' : 'match'} nobody.`;
}

export interface GiftboxInput {
  title: string;
  description: string | null;
  reward_naira: number;
  expiry_date: string | null;
  eligibility_condition: string | null;
  eligibility_rules: Rule[];
  is_active: boolean;
}

export type GiftboxScalarField = 'title' | 'description' | 'reward_naira' | 'expiry_date' | 'eligibility_condition' | 'is_active';

export type GiftboxField = GiftboxScalarField | 'eligibility_rules';

export const GIFTBOX_FIELDS: readonly GiftboxField[] = [
  'title', 'description', 'reward_naira', 'expiry_date', 'eligibility_condition', 'eligibility_rules', 'is_active',
];

export const FINANCIAL_GIFTBOX_FIELDS: ReadonlySet<GiftboxField> = new Set<GiftboxField>([
  'reward_naira', 'expiry_date', 'eligibility_rules', 'is_active',
]);

export type GiftboxScalars = Partial<Omit<GiftboxInput, 'eligibility_rules'>>;

export interface GiftboxValues {
  title: string | null;
  description: string | null;
  reward_naira: number | null;
  expiry_date: string | null;
  eligibility_condition: string | null;
  eligibility_rules: unknown[];
  is_active: boolean;
}

export type GiftboxExpected = Partial<GiftboxValues>;

export interface GiftboxPatch {
  id: string;
  fields: GiftboxScalars;
  rules: unknown[] | undefined;
  expected: GiftboxExpected | null;
  reason: string | null;
}

export interface StoredGiftbox {
  id: string;
  title: string | null;
  description: string | null;
  reward_naira: number | string | null;
  expiry_date: string | null;
  eligibility_condition: string | null;
  eligibility_rules: unknown;
  is_active: boolean | null;
  [column: string]: unknown;
}

function readTitle(value: unknown): Checked<string> {
  const title = value === undefined || value === null ? '' : String(value).trim();
  if (!title) return refuse('Enter a title for the gift box.');
  if (title.length > GIFTBOX_TITLE_MAX) return refuse(`Use ${GIFTBOX_TITLE_MAX} characters or fewer for the title.`);
  return accept(title);
}

function readOptionalText(value: unknown, max: number, what: string): Checked<string | null> {
  const text = textOrNull(value);
  if (text !== null && text.length > max) return refuse(`Use ${formatCount(max)} characters or fewer for the ${what}.`);
  return accept(text);
}

const REWARD_CENTS = 'Use at most 2 decimal places for the reward.';

function readReward(value: unknown, strict: boolean): Checked<number> {
  if (value === undefined || value === null || value === '') return refuse('Enter the reward amount.');
  const amount = toAmount(value);
  if (amount === null || amount < 0) return refuse('The reward must be a number of 0 or more.');
  if (amount > GIFTBOX_REWARD_MAX) return refuse(`The reward can be at most ${formatNaira(GIFTBOX_REWARD_MAX)}.`);
  if (strict && !hasAtMostCents(amount)) return refuse(REWARD_CENTS);
  return accept(amount);
}

function readExpiry(value: unknown): Checked<string | null> {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return accept(null);
  const key = toDateKey(value);
  return key ? accept(key) : refuse('Use a date like 2026-12-31 for the end date.');
}

function readActiveFlag(value: unknown, fallback: boolean): Checked<boolean> {
  if (value === undefined || value === null) return accept(fallback);
  const flag = readFlag(value);
  return flag === undefined ? refuse('is_active must be true or false.') : accept(flag);
}

export function readGiftboxCreate(body: unknown): Checked<GiftboxInput> {
  if (!isRecord(body)) return refuse('Send the gift box as a JSON object.');
  const title = readTitle(body.title);
  if (!title.ok) return title;
  const reward = readReward(body.reward_naira, true);
  if (!reward.ok) return reward;
  const description = readOptionalText(body.description, GIFTBOX_DESCRIPTION_MAX, 'description');
  if (!description.ok) return description;
  const note = readOptionalText(body.eligibility_condition, GIFTBOX_NOTE_MAX, 'requirement note');
  if (!note.ok) return note;
  const expiry = readExpiry(body.expiry_date);
  if (!expiry.ok) return expiry;
  const rules = readRules(body.eligibility_rules);
  if (!rules.ok) return rules;
  const active = readActiveFlag(body.is_active, true);
  if (!active.ok) return active;
  return accept({
    title: title.value,
    description: description.value,
    reward_naira: reward.value,
    expiry_date: expiry.value,
    eligibility_condition: note.value,
    eligibility_rules: rules.value,
    is_active: active.value,
  });
}

function readExpected(value: unknown): Checked<GiftboxExpected | null> {
  if (value === undefined || value === null) return accept(null);
  if (!isRecord(value)) return refuse('The expected values sent with this change are not valid.');
  const expected: GiftboxExpected = {};
  const invalid = refuse<GiftboxExpected | null>('The expected values sent with this change are not valid.');
  for (const key of ['title', 'description', 'eligibility_condition'] as const) {
    if (!(key in value)) continue;
    const raw = value[key];
    if (raw !== null && typeof raw !== 'string') return invalid;
    expected[key] = textOrNull(raw);
  }
  if ('reward_naira' in value) {
    const raw = value.reward_naira;
    const amount = raw === null ? null : toAmount(raw);
    if (raw !== null && amount === null) return invalid;
    expected.reward_naira = amount;
  }
  if ('expiry_date' in value) {
    const raw = value.expiry_date;
    const key = raw === null || raw === '' ? null : toDateKey(raw);
    if (raw !== null && raw !== '' && key === null) return invalid;
    expected.expiry_date = key;
  }
  if ('eligibility_rules' in value) {
    if (!Array.isArray(value.eligibility_rules)) return invalid;
    expected.eligibility_rules = value.eligibility_rules;
  }
  if ('is_active' in value) {
    const flag = readFlag(value.is_active);
    if (flag === undefined) return invalid;
    expected.is_active = flag;
  }
  return accept(expected);
}

export function readGiftboxPatch(body: unknown): Checked<GiftboxPatch> {
  if (!isRecord(body)) return refuse('Send the changes as a JSON object.');
  const id = readId(body.id);
  if (!id) return refuse('A valid gift box id is required.');
  const fields: GiftboxScalars = {};
  if (body.title !== undefined) {
    const title = readTitle(body.title);
    if (!title.ok) return title;
    fields.title = title.value;
  }
  if (body.description !== undefined) {
    const description = readOptionalText(body.description, GIFTBOX_DESCRIPTION_MAX, 'description');
    if (!description.ok) return description;
    fields.description = description.value;
  }
  if (body.reward_naira !== undefined) {
    const reward = readReward(body.reward_naira, false);
    if (!reward.ok) return reward;
    fields.reward_naira = reward.value;
  }
  if (body.expiry_date !== undefined) {
    const expiry = readExpiry(body.expiry_date);
    if (!expiry.ok) return expiry;
    fields.expiry_date = expiry.value;
  }
  if (body.eligibility_condition !== undefined) {
    const note = readOptionalText(body.eligibility_condition, GIFTBOX_NOTE_MAX, 'requirement note');
    if (!note.ok) return note;
    fields.eligibility_condition = note.value;
  }
  if (body.is_active !== undefined) {
    const active = readActiveFlag(body.is_active, false);
    if (!active.ok) return active;
    fields.is_active = active.value;
  }
  let rules: unknown[] | undefined;
  if (body.eligibility_rules !== undefined) {
    if (body.eligibility_rules !== null && !Array.isArray(body.eligibility_rules)) {
      return refuse('eligibility_rules must be a list of rules.');
    }
    rules = rulesList(body.eligibility_rules);
    if (rules.length > RULES_MAX) return refuse(`A gift box can have at most ${RULES_MAX} rules.`);
  }
  const expected = readExpected(body.expected);
  if (!expected.ok) return expected;
  const reason = readReason(body.reason);
  if (!reason.ok) return reason;
  return accept({ id, fields, rules, expected: expected.value, reason: reason.value });
}

export function giftboxValues(row: StoredGiftbox): GiftboxValues {
  return {
    title: textOrNull(row.title),
    description: textOrNull(row.description),
    reward_naira: toAmount(row.reward_naira),
    expiry_date: toDateKey(row.expiry_date),
    eligibility_condition: textOrNull(row.eligibility_condition),
    eligibility_rules: rulesList(row.eligibility_rules),
    is_active: row.is_active === true,
  };
}

export function sameGiftboxValue(field: GiftboxField, a: unknown, b: unknown): boolean {
  if (field === 'reward_naira') return sameAmount(toAmount(a), toAmount(b));
  if (field === 'eligibility_rules') return sameRules(a, b);
  if (field === 'is_active') return (a === true) === (b === true);
  if (field === 'expiry_date') return toDateKey(a) === toDateKey(b);
  return textOrNull(a) === textOrNull(b);
}

export function giftboxConflicts(expected: GiftboxExpected, live: StoredGiftbox): GiftboxField[] {
  const current = giftboxValues(live);
  return GIFTBOX_FIELDS.filter((field) => field in expected && !sameGiftboxValue(field, expected[field], current[field]));
}

export interface GiftboxPlan {
  update: Record<string, unknown>;
  changed: GiftboxField[];
  before: Partial<GiftboxValues>;
  financial: boolean;
  problem: string | null;
}

export function planGiftboxUpdate(fields: GiftboxScalars, rules: Rule[] | undefined, live: StoredGiftbox): GiftboxPlan {
  const current = giftboxValues(live);
  const update: Record<string, unknown> = {};
  const before: Partial<GiftboxValues> = {};
  const changed: GiftboxField[] = [];
  const consider = (field: GiftboxField, next: unknown) => {
    if (sameGiftboxValue(field, next, current[field])) return;
    update[field] = next;
    (before as Record<string, unknown>)[field] = current[field];
    changed.push(field);
  };
  for (const field of GIFTBOX_FIELDS) {
    if (field === 'eligibility_rules') {
      if (rules !== undefined) consider(field, rules);
      continue;
    }
    if (field in fields) consider(field, fields[field]);
  }
  const reward = update.reward_naira;
  return {
    update,
    changed,
    before,
    financial: changed.some((field) => FINANCIAL_GIFTBOX_FIELDS.has(field)),
    problem: typeof reward === 'number' && !hasAtMostCents(reward) ? REWARD_CENTS : null,
  };
}

export interface TierValues {
  name: string;
  target_usd: number | null;
  bonus_naira: number | null;
  badge_url: string | null;
  is_active: boolean;
}

export type TierKey = keyof TierValues;

export const TIER_KEYS: readonly TierKey[] = ['name', 'target_usd', 'bonus_naira', 'badge_url', 'is_active'];

export const FINANCIAL_TIER_KEYS: ReadonlySet<TierKey> = new Set<TierKey>(['target_usd', 'bonus_naira', 'is_active']);

export interface StoredTier {
  id: string;
  tier_order: number | string | null;
  name: string | null;
  target_usd: number | string | null;
  bonus_naira: number | string | null;
  badge_url: string | null;
  is_active: boolean | null;
  [column: string]: unknown;
}

export interface LevelChange {
  id: string;
  values: Partial<TierValues>;
  expected: Partial<TierValues> | null;
}

export interface LevelPatch {
  changes: LevelChange[];
  batch: boolean;
  reason: string | null;
}

export function tierValues(row: StoredTier): TierValues {
  return {
    name: typeof row.name === 'string' ? row.name.trim() : '',
    target_usd: toAmount(row.target_usd),
    bonus_naira: toAmount(row.bonus_naira),
    badge_url: textOrNull(row.badge_url),
    is_active: row.is_active === true,
  };
}

export function sameTierValue(key: TierKey, a: unknown, b: unknown): boolean {
  if (key === 'target_usd' || key === 'bonus_naira') return sameAmount(toAmount(a), toAmount(b));
  if (key === 'is_active') return (a === true) === (b === true);
  return textOrNull(a) === textOrNull(b);
}

export function tierNameProblem(value: string): string | null {
  const name = value.trim();
  if (!name) return 'Enter a name for this tier.';
  if (name.length > LEVEL_NAME_MAX) return `Use ${LEVEL_NAME_MAX} characters or fewer.`;
  return null;
}

export function badgeUrlProblem(value: string): string | null {
  if (value.length > BADGE_URL_MAX || !BADGE_URL.test(value)) {
    return `The badge address must start with https:// and be at most ${BADGE_URL_MAX} characters.`;
  }
  return null;
}

function readTierAmount(value: unknown, what: string): Checked<number> {
  const amount = toAmount(value);
  if (amount === null || amount < 0 || amount > LEVEL_AMOUNT_MAX) {
    return refuse(`The ${what} must be a number from 0 to ${formatAmount(LEVEL_AMOUNT_MAX)}.`);
  }
  return accept(amount);
}

function readTierFields(source: Record<string, unknown>, prefix: string): Checked<Partial<TierValues>> {
  const values: Partial<TierValues> = {};
  if (source.name !== undefined) {
    const name = source.name === null ? '' : String(source.name);
    const problem = tierNameProblem(name);
    if (problem) return refuse(`${prefix}${problem}`);
    values.name = name.trim();
  }
  if (source.target_usd !== undefined) {
    const target = readTierAmount(source.target_usd, 'trade target');
    if (!target.ok) return refuse(`${prefix}${target.message}`);
    values.target_usd = target.value;
  }
  if (source.bonus_naira !== undefined) {
    const bonus = readTierAmount(source.bonus_naira, 'bonus');
    if (!bonus.ok) return refuse(`${prefix}${bonus.message}`);
    values.bonus_naira = bonus.value;
  }
  if (source.badge_url !== undefined) {
    const url = textOrNull(source.badge_url);
    if (url !== null) {
      const problem = badgeUrlProblem(url);
      if (problem) return refuse(`${prefix}${problem}`);
    }
    values.badge_url = url;
  }
  if (source.is_active !== undefined) {
    const flag = source.is_active === null ? false : readFlag(source.is_active);
    if (flag === undefined) return refuse(`${prefix}is_active must be true or false.`);
    values.is_active = flag;
  }
  return accept(values);
}

function readLevelChange(source: unknown, position: number | null): Checked<LevelChange> {
  const prefix = position === null ? '' : `Change ${position}: `;
  if (!isRecord(source)) return refuse(`${prefix}Send each tier change as a JSON object.`);
  const id = readId(source.id);
  if (!id) return refuse(position === null ? 'Invalid id' : `${prefix}a valid tier id is required.`);
  const values = readTierFields(source, prefix);
  if (!values.ok) return values;
  let expected: Partial<TierValues> | null = null;
  if (source.expected !== undefined && source.expected !== null) {
    if (!isRecord(source.expected)) return refuse(`${prefix}the expected values are not valid.`);
    const raw = source.expected;
    const read: Partial<TierValues> = {};
    if (raw.name !== undefined) read.name = raw.name === null ? '' : String(raw.name).trim();
    for (const key of ['target_usd', 'bonus_naira'] as const) {
      if (raw[key] === undefined) continue;
      const amount = raw[key] === null ? null : toAmount(raw[key]);
      if (raw[key] !== null && amount === null) return refuse(`${prefix}the expected values are not valid.`);
      read[key] = amount;
    }
    if (raw.badge_url !== undefined) read.badge_url = textOrNull(raw.badge_url);
    if (raw.is_active !== undefined) {
      const flag = readFlag(raw.is_active);
      if (flag === undefined) return refuse(`${prefix}the expected values are not valid.`);
      read.is_active = flag;
    }
    expected = read;
  }
  return accept({ id, values: values.value, expected });
}

export function readLevelPatch(body: unknown): Checked<LevelPatch> {
  if (!isRecord(body)) return refuse('Send the changes as a JSON object.');
  const reason = readReason(body.reason);
  if (!reason.ok) return reason;
  if (body.changes === undefined) {
    const single = readLevelChange(body, null);
    if (!single.ok) return single;
    return accept({ changes: [single.value], batch: false, reason: reason.value });
  }
  if (!Array.isArray(body.changes) || body.changes.length === 0) return refuse('No tier changes were sent.');
  if (body.changes.length > LEVEL_COUNT) return refuse(`Send at most ${LEVEL_COUNT} tier changes at a time.`);
  const seen = new Set<string>();
  const changes: LevelChange[] = [];
  for (let index = 0; index < body.changes.length; index += 1) {
    const change = readLevelChange(body.changes[index], index + 1);
    if (!change.ok) return change;
    if (seen.has(change.value.id)) return refuse(`Tier ${change.value.id} appears more than once in this save.`);
    if (Object.keys(change.value.values).length === 0) return refuse(`Change ${index + 1} has nothing to save.`);
    seen.add(change.value.id);
    changes.push(change.value);
  }
  return accept({ changes, batch: true, reason: reason.value });
}

export type TierPlan =
  | { kind: 'unchanged' }
  | { kind: 'invalid'; message: string }
  | { kind: 'conflict'; fields: TierKey[] }
  | { kind: 'write'; update: Partial<TierValues>; before: Partial<TierValues>; financial: boolean };

export function planTierWrite(change: LevelChange, live: StoredTier): TierPlan {
  const current = tierValues(live);
  const update: Partial<TierValues> = {};
  const before: Partial<TierValues> = {};
  for (const key of TIER_KEYS) {
    if (!(key in change.values)) continue;
    const next = change.values[key];
    if (sameTierValue(key, next, current[key])) continue;
    (update as Record<string, unknown>)[key] = next;
    (before as Record<string, unknown>)[key] = current[key];
  }
  const keys = Object.keys(update) as TierKey[];
  if (keys.length === 0) return { kind: 'unchanged' };
  for (const key of ['target_usd', 'bonus_naira'] as const) {
    const amount = update[key];
    if (typeof amount === 'number' && !hasAtMostCents(amount)) {
      return { kind: 'invalid', message: `Use at most 2 decimal places for the ${key === 'target_usd' ? 'trade target' : 'bonus'}.` };
    }
  }
  const expected = change.expected;
  if (expected) {
    const conflicts = keys.filter((key) => key in expected && !sameTierValue(key, expected[key], current[key]));
    if (conflicts.length > 0) return { kind: 'conflict', fields: conflicts };
  }
  return { kind: 'write', update, before, financial: keys.some((key) => FINANCIAL_TIER_KEYS.has(key)) };
}

export type TierResultStatus = 'saved' | 'unchanged' | 'conflict' | 'missing' | 'error';

export interface PublicTierValues extends TierValues {
  id: string;
  tier_order: number | null;
}

export interface TierResult {
  id: string;
  status: TierResultStatus;
  tier: PublicTierValues | null;
}

export function publicTierValues(row: StoredTier): PublicTierValues {
  return { id: row.id, tier_order: toAmount(row.tier_order), ...tierValues(row) };
}

export type SaveVerdict =
  | { ok: true }
  | { ok: false; code: 'STATE_CONFLICT' | 'INTERNAL_ERROR'; message: string };

export function tierVerdict(results: readonly TierResult[]): SaveVerdict {
  const total = results.length;
  const done = results.filter((result) => result.status === 'saved' || result.status === 'unchanged').length;
  const conflicts = results.filter((result) => result.status === 'conflict' || result.status === 'missing').length;
  const errors = results.filter((result) => result.status === 'error').length;
  if (conflicts === 0 && errors === 0) return { ok: true };
  const lead = done > 0
    ? `${formatCount(done)} of ${plural(total, 'tier', 'tiers')} saved; ${formatCount(total - done)} not saved.`
    : total === 1
      ? 'The tier change was not saved.'
      : `None of the ${formatCount(total)} tier changes were saved.`;
  const parts: string[] = [];
  if (conflicts > 0) parts.push(`${plural(conflicts, 'tier', 'tiers')} changed after you loaded ${conflicts === 1 ? 'it' : 'them'}`);
  if (errors > 0) parts.push(`${plural(errors, 'change', 'changes')} hit a database error`);
  return {
    ok: false,
    code: errors > 0 ? 'INTERNAL_ERROR' : 'STATE_CONFLICT',
    message: `${lead} ${capitalise(parts.join(' and '))}. Reload the tiers and review them again.`,
  };
}

export function moveRatio(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from <= 0) return null;
  return (to - from) / from;
}

export function isLargeMove(from: number | null, to: number | null): boolean {
  const move = moveRatio(from, to);
  return move !== null && Math.abs(move) >= LARGE_MOVE;
}

export function isHugeMove(from: number | null, to: number | null): boolean {
  if (from === null || to === null || from <= 0 || to <= 0) return false;
  return to / from >= HUGE_FACTOR || from / to >= HUGE_FACTOR;
}
