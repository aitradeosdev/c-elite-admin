import { isUuid } from '../../lib/http';
import { formatNaira } from '../../_ui/money';

export const RATE_DB_MAX = 99_999_999.99;
export const RATE_MAX = 100_000;
export const AMOUNT_MAX = 100_000_000;
export const RANGE_LABEL_MAX = 80;
export const MAX_CHANGES = 500;
export const LARGE_MOVE = 0.1;
export const HUGE_MOVE = 0.5;

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

export interface RateValues {
  rate: number | null;
  active: boolean;
}

export interface RateChangeInput {
  id: string;
  rate: number;
  active: boolean | null;
  expected: RateValues | null;
}

export interface NewRangeInput {
  card_type_id: string;
  range_label: string;
  min_value: number;
  max_value: number;
  rate_naira: number;
  is_active: boolean;
}

export interface CardRow {
  id: string;
  name: string | null;
  logo_url: string | null;
  is_active: boolean | null;
  sort_order: number | null;
}

export interface CountryRow {
  id: string;
  card_id: string | null;
  country_code: string | null;
  country_name: string | null;
  currency_symbol: string | null;
}

export interface TypeRow {
  id: string;
  card_id: string | null;
  country_code: string | null;
  name: string | null;
  sort_order: number | null;
}

export interface StoredDenomination {
  id: string;
  card_type_id: string | null;
  range_label: string | null;
  min_value: number | string | null;
  max_value: number | string | null;
  rate_naira: number | string | null;
  is_active: boolean | null;
}

export interface RateTreeDenomination {
  id: string;
  range_label: string | null;
  min_value: number | string | null;
  max_value: number | string | null;
  rate_naira: number | string | null;
  is_active: boolean | null;
}

export interface RateTreeType {
  id: string;
  name: string | null;
  denominations: RateTreeDenomination[];
}

export interface RateTreeCountry {
  id: string;
  country_code: string | null;
  country_name: string | null;
  currency_symbol: string | null;
  card_types: RateTreeType[];
}

export interface RateTreeCard {
  id: string;
  name: string | null;
  logo_url: string | null;
  is_active: boolean | null;
  countries: RateTreeCountry[];
  activeRates: number;
}

export type RateResultStatus = 'saved' | 'unchanged' | 'conflict' | 'missing' | 'error';

export interface RateResult {
  id: string;
  status: RateResultStatus;
  rate_naira: number | null;
  is_active: boolean | null;
}

export type RatePlan =
  | { kind: 'conflict' }
  | { kind: 'unchanged' }
  | { kind: 'write'; update: { rate_naira: number; is_active?: boolean } };

export type SaveVerdict =
  | { ok: true }
  | { ok: false; code: 'STATE_CONFLICT' | 'INTERNAL_ERROR'; message: string };

export interface RangeBounds {
  min: number | null;
  max: number | null;
}

const PLAIN_DECIMAL = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const GROUPED_DECIMAL = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const STORED_DECIMAL = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const NAIRA_PREFIX = /^₦\s*/;
const AMOUNT_FORMAT = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 });

function refuse<T>(message: string): Checked<T> {
  return { ok: false, message };
}

function accept<T>(value: T): Checked<T> {
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? one : many}`;
}

function cleanDecimal(text: string): string {
  return text.trim().replace(NAIRA_PREFIX, '');
}

function ungroup(text: string): string {
  return GROUPED_DECIMAL.test(text) ? text.replace(/,/g, '') : text;
}

function fractionDigits(text: string): number {
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function parseDecimal(text: string): number | null {
  const plain = ungroup(cleanDecimal(text));
  if (!PLAIN_DECIMAL.test(plain)) return null;
  const value = Number(plain);
  return Number.isFinite(value) ? value : null;
}

export function toAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!STORED_DECIMAL.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

export function sameRate(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.000001;
}

export function formatAmount(value: number): string {
  return AMOUNT_FORMAT.format(value);
}

function decimalProblem(text: string, noun: string, ceiling: number, ceilingText: string): string | null {
  const cleaned = cleanDecimal(text);
  if (cleaned === '') return `Enter ${noun}.`;
  if (cleaned.startsWith('-')) return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} cannot be negative.`;
  const plain = ungroup(cleaned);
  if (!PLAIN_DECIMAL.test(plain)) {
    return cleaned.includes(',')
      ? 'Use a full stop for decimals and commas only between thousands, like 1,500.50.'
      : 'Enter a number, like 1500 or 1500.50.';
  }
  if (fractionDigits(plain) > 2) return 'Use at most 2 decimal places.';
  if (Number(plain) > ceiling) return ceilingText;
  return null;
}

export function rateProblem(text: string, active: boolean): string | null {
  const problem = decimalProblem(
    text,
    'a rate',
    RATE_MAX,
    `That is more than ${formatNaira(RATE_MAX)} per unit, which is not a realistic rate. Check the value.`,
  );
  if (problem) return problem;
  if (active && parseDecimal(text) === 0) return 'An active range needs a rate above ₦0.00. Switch the range off instead.';
  return null;
}

export function amountProblem(text: string): string | null {
  return decimalProblem(text, 'an amount', AMOUNT_MAX, `Use an amount of ${formatAmount(AMOUNT_MAX)} or less.`);
}

export function labelProblem(text: string): string | null {
  const label = text.trim();
  if (!label) return 'Enter a label, like $25–$99.';
  if (label.length > RANGE_LABEL_MAX) return `Use ${RANGE_LABEL_MAX} characters or fewer.`;
  return null;
}

export function readId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return isUuid(id) ? id : null;
}

function readStoredRate(value: unknown): number | null {
  const amount = toAmount(value);
  return amount !== null && amount >= 0 && amount <= RATE_DB_MAX ? amount : null;
}

function readFlag(value: unknown): boolean | null | undefined {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return null;
  return undefined;
}

function readExpected(value: unknown): RateValues | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return undefined;
  const rate = value.rate_naira === null ? null : toAmount(value.rate_naira);
  if (rate === null && value.rate_naira !== null) return undefined;
  const active = readFlag(value.is_active);
  if (active === undefined) return undefined;
  return { rate, active: active === true };
}

export function readRateChanges(body: unknown): Checked<RateChangeInput[]> {
  const list = isRecord(body) ? body.changes : undefined;
  if (!Array.isArray(list) || list.length === 0) return refuse('No changes provided.');
  if (list.length > MAX_CHANGES) return refuse(`Save at most ${MAX_CHANGES} rate changes at a time.`);
  const seen = new Set<string>();
  const changes: RateChangeInput[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const item: unknown = list[index];
    const position = index + 1;
    if (!isRecord(item)) return refuse(`Change ${position} is not a valid rate change.`);
    const id = readId(item.id);
    if (!id) return refuse(`Change ${position} does not name a valid range.`);
    if (seen.has(id)) return refuse(`Range ${id} appears more than once in this save.`);
    seen.add(id);
    const rate = readStoredRate(item.rate_naira);
    if (rate === null) return refuse(`The rate for range ${id} must be a number from 0 to ${formatNaira(RATE_DB_MAX)}.`);
    const active = readFlag(item.is_active);
    if (active === undefined) return refuse(`The active setting for range ${id} must be true or false.`);
    const expected = readExpected(item.expected);
    if (expected === undefined) return refuse(`The expected values sent for range ${id} are not valid.`);
    changes.push({ id, rate, active, expected });
  }
  return accept(changes);
}

export function readNewRange(body: unknown): Checked<NewRangeInput> {
  if (!isRecord(body)) return refuse('Send the new range as a JSON object.');
  const typeId = readId(body.card_type_id);
  if (!typeId) return refuse('Choose a valid card type for this range.');
  const label = typeof body.range_label === 'string' ? body.range_label.trim() : '';
  const labelIssue = labelProblem(label);
  if (labelIssue) return refuse(labelIssue);
  const min = toAmount(body.min_value);
  if (min === null || min < 0) return refuse('The minimum card value must be a number of 0 or more.');
  const max = toAmount(body.max_value);
  if (max === null || max < 0) return refuse('The maximum card value must be a number of 0 or more.');
  if (min > max) return refuse('The minimum card value cannot be more than the maximum.');
  const rate = readStoredRate(body.rate_naira);
  if (rate === null) return refuse(`The rate must be a number from 0 to ${formatNaira(RATE_DB_MAX)}.`);
  const active = readFlag(body.is_active);
  if (active === undefined) return refuse('is_active must be true or false.');
  return accept({
    card_type_id: typeId,
    range_label: label,
    min_value: min,
    max_value: max,
    rate_naira: rate,
    is_active: active ?? true,
  });
}

export function storedValues(row: Pick<StoredDenomination, 'rate_naira' | 'is_active'>): RateValues {
  return { rate: toAmount(row.rate_naira), active: row.is_active === true };
}

export function planRateWrite(change: RateChangeInput, current: Pick<StoredDenomination, 'rate_naira' | 'is_active'>): RatePlan {
  const live = storedValues(current);
  const sameActive = change.active === null || change.active === live.active;
  if (sameRate(live.rate, change.rate) && sameActive) return { kind: 'unchanged' };
  if (change.expected && (!sameRate(live.rate, change.expected.rate) || live.active !== change.expected.active)) {
    return { kind: 'conflict' };
  }
  return {
    kind: 'write',
    update: change.active === null ? { rate_naira: change.rate } : { rate_naira: change.rate, is_active: change.active },
  };
}

export function saveVerdict(results: readonly RateResult[]): SaveVerdict {
  const total = results.length;
  const done = results.filter((result) => result.status === 'saved' || result.status === 'unchanged').length;
  const conflicts = results.filter((result) => result.status === 'conflict' || result.status === 'missing').length;
  const errors = results.filter((result) => result.status === 'error').length;
  if (conflicts === 0 && errors === 0) return { ok: true };
  const lead = done > 0
    ? `${done.toLocaleString('en-NG')} of ${plural(total, 'rate change', 'rate changes')} saved; ${(total - done).toLocaleString('en-NG')} not saved.`
    : total === 1
      ? 'The rate change was not saved.'
      : `None of the ${total.toLocaleString('en-NG')} rate changes were saved.`;
  const parts: string[] = [];
  if (conflicts > 0) {
    parts.push(`${plural(conflicts, 'rate', 'rates')} changed or ${conflicts === 1 ? 'was' : 'were'} removed after you loaded ${conflicts === 1 ? 'it' : 'them'}`);
  }
  if (errors > 0) parts.push(`${plural(errors, 'change', 'changes')} hit a database error`);
  const advice = errors > 0 ? 'Reload the rates and try again.' : 'Reload the rates and review them again.';
  return {
    ok: false,
    code: errors > 0 ? 'INTERNAL_ERROR' : 'STATE_CONFLICT',
    message: `${lead} ${parts.join(' and ')}. ${advice}`,
  };
}

export function rateMove(from: number | null, to: number): number | null {
  if (from === null || from <= 0) return null;
  return (to - from) / from;
}

export function isLargeMove(from: number | null, to: number): boolean {
  const move = rateMove(from, to);
  if (move === null) return to > 0;
  return Math.abs(move) > LARGE_MOVE;
}

export function isHugeMove(from: number | null, to: number): boolean {
  const move = rateMove(from, to);
  return move !== null && Math.abs(move) >= HUGE_MOVE;
}

export function rangesOverlap(a: RangeBounds, b: RangeBounds): boolean {
  if (a.min === null || a.max === null || b.min === null || b.max === null) return false;
  return a.min <= b.max && b.min <= a.max;
}

function byOrder(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function byText(a: string | null, b: string | null): number {
  return (a ?? '').localeCompare(b ?? '', 'en', { sensitivity: 'base' });
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

function typeKey(cardId: string | null, countryCode: string | null): string | null {
  return cardId === null || countryCode === null ? null : `${cardId}|${countryCode}`;
}

function treeDenomination(row: StoredDenomination): RateTreeDenomination {
  return {
    id: row.id,
    range_label: row.range_label,
    min_value: row.min_value,
    max_value: row.max_value,
    rate_naira: row.rate_naira,
    is_active: row.is_active,
  };
}

export function assembleRateTree(
  cards: readonly CardRow[],
  countries: readonly CountryRow[],
  types: readonly TypeRow[],
  denominations: readonly StoredDenomination[],
): RateTreeCard[] {
  const countriesByCard = groupBy(countries, (row) => row.card_id);
  const typesByCountry = groupBy(types, (row) => typeKey(row.card_id, row.country_code));
  const rangesByType = groupBy(denominations, (row) => row.card_type_id);
  return [...cards]
    .sort((a, b) => byOrder(a.sort_order, b.sort_order) || byText(a.name, b.name) || a.id.localeCompare(b.id))
    .map((card) => {
      let activeRates = 0;
      const cardCountries = [...(countriesByCard.get(card.id) ?? [])]
        .sort((a, b) => byText(a.country_name, b.country_name) || byText(a.country_code, b.country_code))
        .map((country): RateTreeCountry => ({
          id: country.id,
          country_code: country.country_code,
          country_name: country.country_name,
          currency_symbol: country.currency_symbol,
          card_types: [...(typesByCountry.get(typeKey(card.id, country.country_code) ?? '') ?? [])]
            .sort((a, b) => byOrder(a.sort_order, b.sort_order) || byText(a.name, b.name) || a.id.localeCompare(b.id))
            .map((type): RateTreeType => {
              const ranges = [...(rangesByType.get(type.id) ?? [])].sort(
                (a, b) => byOrder(toAmount(a.min_value), toAmount(b.min_value)) || a.id.localeCompare(b.id),
              );
              activeRates += ranges.filter((range) => range.is_active === true).length;
              return { id: type.id, name: type.name, denominations: ranges.map(treeDenomination) };
            }),
        }));
      return {
        id: card.id,
        name: card.name,
        logo_url: card.logo_url,
        is_active: card.is_active,
        countries: cardCountries,
        activeRates,
      };
    });
}
