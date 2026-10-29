import type { ApiBody, ApiResult } from '../../lib/apiClient';
import type { ToastTone } from '../../_ui';
import { formatNaira } from '../../_ui/money';
import { isUuid } from '../../lib/http';
import {
  amountProblem, formatAmount, isHugeMove, labelProblem, parseDecimal, rangesOverlap, rateProblem, sameRate, toAmount,
  type RateResultStatus, type RateValues,
} from './rateRules';
import { everyInterval, isCount, isInterval, lateBy, overdue, stamp, type IntervalMinutes } from '../automatic-rates/rules';

export interface RatePath {
  cardId: string;
  cardName: string;
  countryId: string;
  countryCode: string;
  countryName: string;
  currency: string;
  typeId: string;
  typeName: string;
}

export interface RateRow extends RateValues {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
  title: string;
  path: RatePath;
}

export interface RateGroup {
  key: string;
  path: RatePath;
  rows: RateRow[];
}

export interface EmptyCountry {
  id: string;
  name: string;
}

export interface RateCard {
  id: string;
  name: string;
  logoUrl: string | null;
  countries: number;
  groups: RateGroup[];
  emptyCountries: EmptyCountry[];
  active: number;
  inactive: number;
}

export interface RateTotals {
  cards: number;
  active: number;
  inactive: number;
}

export interface RatesAutomatic {
  enabled: boolean;
  intervalMinutes: IntervalMinutes;
  nextDueAt: string | null;
  stale: boolean;
  failures: number;
  linked: ReadonlySet<string>;
}

export interface AutomaticNotice {
  tone: 'info' | 'warning';
  text: string;
}

export interface NextUpdatePhrase {
  predicate: string;
  aside: string;
}

export interface RatesSnapshot {
  cards: RateCard[];
  rows: Readonly<Record<string, RateRow>>;
  totals: RateTotals;
  automatic: RatesAutomatic | null;
}

export interface DraftEntry {
  rate: string;
  active: boolean;
  base: RateValues;
  title: string;
  conflict: RateValues | null;
  failure: string | null;
}

export type Draft = Readonly<Record<string, DraftEntry>>;

export const EMPTY_DRAFT: Draft = Object.freeze({});

export interface PendingChange {
  id: string;
  title: string;
  row: RateRow;
  from: RateValues;
  to: { rate: number; active: boolean };
  rateChanged: boolean;
  activeChanged: boolean;
  conflict: RateValues | null;
}

export interface DraftReview {
  changes: PendingChange[];
  errors: Readonly<Record<string, string>>;
  firstError: string | null;
}

export const EMPTY_REVIEW: DraftReview = Object.freeze({ changes: [], errors: Object.freeze({}), firstError: null });

export interface DraftNote {
  id: string;
  title: string;
}

export interface RebaseConflict extends DraftNote {
  live: RateValues;
  mine: string;
}

export interface RebaseResult {
  draft: Draft;
  conflicts: RebaseConflict[];
  dropped: DraftNote[];
  alreadyLive: DraftNote[];
}

export interface NoticeItem {
  id: string;
  title: string;
  detail: string;
}

export interface PageNotice {
  tone: 'danger' | 'warning';
  title: string;
  message: string;
  items: NoticeItem[];
}

export interface ToastNote {
  text: string;
  tone: ToastTone;
}

export interface RowResult {
  id: string;
  status: RateResultStatus;
  rate: number | null;
  active: boolean | null;
}

export interface SaveResponse {
  results: RowResult[];
  warning: string | null;
}

export type SaveOutcome =
  | { kind: 'saved'; results: RowResult[]; warning: string | null }
  | { kind: 'conflict'; results: RowResult[] }
  | { kind: 'unknown'; message: string }
  | { kind: 'refused'; status: number | null; message: string }
  | { kind: 'expired' }
  | { kind: 'retry'; message: string };

export interface SaveSettlement {
  draft: Draft;
  notice: PageNotice | null;
  toasts: ToastNote[];
  cleared: boolean;
}

export interface RowView {
  rate: string;
  active: boolean;
  changed: boolean;
  rateChanged: boolean;
  activeChanged: boolean;
  from: RateValues;
  to: number | null;
  huge: boolean;
  failure: string | null;
  conflict: RateValues | null;
}

export type Phase = 'idle' | 'checking' | 'confirming' | 'saving';

export type ShowFilter = 'all' | 'changed' | 'active' | 'inactive';

export const SHOW_OPTIONS: ReadonlyArray<{ value: ShowFilter; label: string }> = [
  { value: 'all', label: 'All ranges' },
  { value: 'changed', label: 'Unsaved changes' },
  { value: 'active', label: 'Active ranges' },
  { value: 'inactive', label: 'Switched-off ranges' },
];

export interface ExistingRange {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
  active: boolean;
}

export interface AddRangeTarget {
  path: RatePath;
  ranges: ExistingRange[];
}

export interface NewRangeDraft {
  label: string;
  min: string;
  max: string;
  rate: string;
  active: boolean;
}

export type NewRangeField = 'label' | 'min' | 'max' | 'rate';

export type NewRangeErrors = Partial<Record<NewRangeField, string>>;

export interface NewRangeValues {
  label: string;
  min: number;
  max: number;
  rate: number;
  active: boolean;
}

export interface NewRangeCheck {
  errors: NewRangeErrors;
  values: NewRangeValues | null;
}

export interface AddResponse {
  id: string | null;
  warning: string | null;
}

export type AddOutcome =
  | { kind: 'added'; id: string | null; warning: string | null }
  | { kind: 'unknown'; message: string }
  | { kind: 'refused'; status: number | null; message: string }
  | { kind: 'expired' }
  | { kind: 'retry'; message: string };

const STATUSES: ReadonlySet<string> = new Set(['saved', 'unchanged', 'conflict', 'missing']);
const NEW_RANGE_FIELDS: readonly NewRangeField[] = ['label', 'min', 'max', 'rate'];
const NO_IDS: ReadonlySet<string> = new Set<string>();
const ALREADY_LIVE = 'Someone else already made this change, so there is nothing left to save.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function count(value: number, one: string, many: string): string {
  return `${value.toLocaleString('en-NG')} ${value === 1 ? one : many}`;
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function includes(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(needle);
}

export function currencyAmount(symbol: string, value: number | null): string {
  if (value === null) return '—';
  const amount = formatAmount(value);
  if (!symbol) return amount;
  return /\p{L}$/u.test(symbol) ? `${symbol} ${amount}` : `${symbol}${amount}`;
}

export function valueSpan(row: Pick<RateRow, 'min' | 'max' | 'path'>): string {
  return `${currencyAmount(row.path.currency, row.min)} – ${currencyAmount(row.path.currency, row.max)}`;
}

export function perUnit(symbol: string): string {
  return symbol ? `per ${currencyAmount(symbol, 1)}` : 'per unit';
}

export function groupTitle(path: RatePath): string {
  return `${path.countryName} · ${path.typeName}`;
}

export function rowTitle(path: RatePath, label: string): string {
  return `${path.cardName}${path.countryCode ? ` ${path.countryCode}` : ''} · ${path.typeName} · ${label}`;
}

export function rateInputId(id: string): string {
  return `rate-${id}`;
}

export function cardSummary(card: Pick<RateCard, 'countries' | 'active' | 'inactive'>): string {
  const parts = [
    count(card.countries, 'country', 'countries'),
    count(card.active, 'active range', 'active ranges'),
  ];
  if (card.inactive > 0) parts.push(`${card.inactive.toLocaleString('en-NG')} switched off`);
  return parts.join(' · ');
}

export function unsavedText(total: number): string {
  return count(total, 'unsaved change', 'unsaved changes');
}

export function changeCountText(total: number): string {
  return count(total, 'rate change', 'rate changes');
}

export function toRatesSnapshot(body: ApiBody): RatesSnapshot | null {
  if (!Array.isArray(body.cards)) return null;
  const rows: Record<string, RateRow> = {};
  const cards: RateCard[] = [];
  for (const rawCard of body.cards) {
    if (!isRecord(rawCard)) continue;
    const cardId = text(rawCard.id);
    if (!cardId) continue;
    const cardName = text(rawCard.name) ?? 'Unnamed card';
    const groups: RateGroup[] = [];
    const emptyCountries: EmptyCountry[] = [];
    let countries = 0;
    let active = 0;
    let inactive = 0;
    for (const rawCountry of list(rawCard.countries)) {
      if (!isRecord(rawCountry)) continue;
      const countryId = text(rawCountry.id);
      if (!countryId) continue;
      countries += 1;
      const countryCode = text(rawCountry.country_code) ?? '';
      const countryName = text(rawCountry.country_name) ?? (countryCode || 'Unknown country');
      const currency = text(rawCountry.currency_symbol) ?? '';
      const types = list(rawCountry.card_types).filter(isRecord).filter((type) => text(type.id) !== null);
      if (types.length === 0) {
        emptyCountries.push({ id: countryId, name: countryName });
        continue;
      }
      for (const rawType of types) {
        const typeId = text(rawType.id) as string;
        const path: RatePath = {
          cardId, cardName, countryId, countryCode, countryName, currency, typeId,
          typeName: text(rawType.name) ?? 'Unnamed type',
        };
        const groupRows: RateRow[] = [];
        for (const rawRange of list(rawType.denominations)) {
          if (!isRecord(rawRange)) continue;
          const id = text(rawRange.id);
          if (!id || rows[id]) continue;
          const min = toAmount(rawRange.min_value);
          const max = toAmount(rawRange.max_value);
          const label = text(rawRange.range_label) ?? valueSpan({ min, max, path });
          const row: RateRow = {
            id,
            label,
            min,
            max,
            rate: toAmount(rawRange.rate_naira),
            active: rawRange.is_active === true,
            title: rowTitle(path, label),
            path,
          };
          rows[id] = row;
          groupRows.push(row);
          if (row.active) active += 1;
          else inactive += 1;
        }
        groups.push({ key: typeId, path, rows: groupRows });
      }
    }
    cards.push({ id: cardId, name: cardName, logoUrl: text(rawCard.logo_url), countries, groups, emptyCountries, active, inactive });
  }
  return {
    cards,
    rows,
    totals: {
      cards: cards.length,
      active: cards.reduce((sum, card) => sum + card.active, 0),
      inactive: cards.reduce((sum, card) => sum + card.inactive, 0),
    },
    automatic: toRatesAutomatic(body.automatic),
  };
}

export function toRatesAutomatic(raw: unknown): RatesAutomatic | null {
  if (!isRecord(raw)) return null;
  const { enabled, stale, failures } = raw;
  if (typeof enabled !== 'boolean' || typeof stale !== 'boolean' || !isCount(failures) || !isInterval(raw.interval_minutes)) {
    return null;
  }
  const due = raw.next_due_at;
  const nextDueAt = due === null ? null : typeof due === 'string' && Number.isFinite(Date.parse(due)) ? due : undefined;
  if (nextDueAt === undefined || (enabled && nextDueAt === null)) return null;
  const ids = raw.linked_card_type_ids;
  if (!Array.isArray(ids) || !ids.every((id) => isUuid(id))) return null;
  return {
    enabled,
    intervalMinutes: raw.interval_minutes,
    nextDueAt,
    stale,
    failures,
    linked: new Set(ids.map((id) => String(id).toLowerCase())),
  };
}

export function isLinkedType(automatic: RatesAutomatic | null | undefined, typeId: string): boolean {
  return automatic ? automatic.linked.has(typeId.toLowerCase()) : false;
}

export function updatesLive(automatic: RatesAutomatic | null | undefined, typeId: string): boolean {
  return automatic ? automatic.enabled && automatic.linked.has(typeId.toLowerCase()) : false;
}

export const AUTOMATIC_UNREADABLE =
  'The automatic rate status could not be read, so this page cannot show which card types are updated automatically.';

export function nextUpdatePhrase(automatic: RatesAutomatic, now: number): NextUpdatePhrase | null {
  if (automatic.nextDueAt === null) return null;
  if (overdue(automatic, now)) {
    const since = `has been overdue since ${stamp(automatic.nextDueAt)}`;
    return { predicate: since, aside: `which ${since}` };
  }
  const late = lateBy(automatic, now);
  if (late !== null && late > 0) {
    const soon = 'starts within 5 minutes';
    return { predicate: soon, aside: `which ${soon}` };
  }
  const around = `due around ${stamp(automatic.nextDueAt)}`;
  return { predicate: `is ${around}`, aside: around };
}

function nextUpdateText(automatic: RatesAutomatic, now: number): string {
  const phrase = nextUpdatePhrase(automatic, now);
  return phrase ? `; the next update ${phrase.predicate}` : '';
}

export function automaticNotice(automatic: RatesAutomatic, now: number): AutomaticNotice | null {
  if (!automatic.enabled || automatic.linked.size === 0) return null;
  if (automatic.stale || automatic.failures >= 3) {
    return {
      tone: 'warning',
      text: 'Automatic rates are on, but recent updates have not succeeded. Linked card types keep their current rates until one does.',
    };
  }
  const linked = automatic.linked.size;
  const types = linked === 1
    ? '1 linked card type gets its ranges and rates'
    : `${linked.toLocaleString('en-NG')} linked card types get their ranges and rates`;
  return {
    tone: 'info',
    text: `Automatic rates are on. ${types} from the rate provider ${everyInterval(automatic.intervalMinutes)}${nextUpdateText(automatic, now)}. Changes you make to them here are replaced then.`,
  };
}

export function orderedRows(snapshot: RatesSnapshot): RateRow[] {
  return snapshot.cards.flatMap((card) => card.groups.flatMap((group) => group.rows));
}

export function rateText(rate: number | null): string {
  return rate === null ? '' : rate.toFixed(2);
}

function startEntry(row: RateRow): DraftEntry {
  return {
    rate: rateText(row.rate),
    active: row.active,
    base: { rate: row.rate, active: row.active },
    title: row.title,
    conflict: null,
    failure: null,
  };
}

export function rateTouched(entry: DraftEntry): boolean {
  const parsed = parseDecimal(entry.rate);
  if (parsed === null) return entry.rate.trim() !== rateText(entry.base.rate);
  return !sameRate(parsed, entry.base.rate);
}

export function activeTouched(entry: DraftEntry): boolean {
  return entry.active !== entry.base.active;
}

export function isChanged(entry: DraftEntry | undefined): boolean {
  return Boolean(entry) && (rateTouched(entry as DraftEntry) || activeTouched(entry as DraftEntry));
}

function isPristine(entry: DraftEntry): boolean {
  return entry.rate === rateText(entry.base.rate) && !activeTouched(entry) && entry.failure === null;
}

function without(draft: Draft, ids: Iterable<string>): Draft {
  const drop = new Set(ids);
  let removed = false;
  const next: Record<string, DraftEntry> = {};
  for (const [id, entry] of Object.entries(draft)) {
    if (drop.has(id)) removed = true;
    else next[id] = entry;
  }
  return removed ? next : draft;
}

function withEntry(draft: Draft, id: string, entry: DraftEntry): Draft {
  if (isPristine(entry)) return without(draft, [id]);
  return { ...draft, [id]: entry };
}

export function editRate(draft: Draft, row: RateRow, value: string): Draft {
  const entry = draft[row.id] ?? startEntry(row);
  return withEntry(draft, row.id, { ...entry, rate: value, failure: null });
}

export function editActive(draft: Draft, row: RateRow, active: boolean): Draft {
  const entry = draft[row.id] ?? startEntry(row);
  return withEntry(draft, row.id, { ...entry, active, failure: null });
}

export function revertRow(draft: Draft, id: string): Draft {
  return without(draft, [id]);
}

export function draftCount(draft: Draft): number {
  return Object.values(draft).filter((entry) => isChanged(entry)).length;
}

export function changesByCard(snapshot: RatesSnapshot, draft: Draft): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const [id, entry] of Object.entries(draft)) {
    const row = snapshot.rows[id];
    if (!row || !isChanged(entry)) continue;
    counts.set(row.path.cardId, (counts.get(row.path.cardId) ?? 0) + 1);
  }
  return counts;
}

export function issuesByCard(snapshot: RatesSnapshot, errors: Readonly<Record<string, string>>): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const id of Object.keys(errors)) {
    const row = snapshot.rows[id];
    if (row) counts.set(row.path.cardId, (counts.get(row.path.cardId) ?? 0) + 1);
  }
  return counts;
}

export function entryProblem(entry: DraftEntry): string | null {
  if (rateTouched(entry) || entry.base.rate === null) return rateProblem(entry.rate, entry.active);
  if (activeTouched(entry) && entry.active && !((entry.base.rate ?? 0) > 0)) {
    return 'Set a rate above ₦0.00 before switching this range on.';
  }
  return null;
}

export function reviewDraft(snapshot: RatesSnapshot, draft: Draft): DraftReview {
  const changes: PendingChange[] = [];
  const errors: Record<string, string> = {};
  let firstError: string | null = null;
  for (const row of orderedRows(snapshot)) {
    const entry = draft[row.id];
    if (!entry || !isChanged(entry)) continue;
    const problem = entryProblem(entry);
    if (problem) {
      errors[row.id] = problem;
      if (firstError === null) firstError = row.id;
      continue;
    }
    const touched = rateTouched(entry);
    const rate = touched ? parseDecimal(entry.rate) : entry.base.rate;
    if (rate === null) continue;
    changes.push({
      id: row.id,
      title: row.title,
      row,
      from: entry.base,
      to: { rate, active: entry.active },
      rateChanged: touched,
      activeChanged: activeTouched(entry),
      conflict: entry.conflict,
    });
  }
  return { changes, errors, firstError };
}

export function rebaseDraft(draft: Draft, snapshot: RatesSnapshot): RebaseResult {
  const next: Record<string, DraftEntry> = {};
  const conflicts: RebaseConflict[] = [];
  const dropped: DraftNote[] = [];
  const alreadyLive: DraftNote[] = [];
  for (const [id, entry] of Object.entries(draft)) {
    const row = snapshot.rows[id];
    if (!row) {
      dropped.push({ id, title: entry.title });
      continue;
    }
    const live: RateValues = { rate: row.rate, active: row.active };
    const touchedRate = rateTouched(entry);
    const touchedActive = activeTouched(entry);
    const moved = !sameRate(live.rate, entry.base.rate) || live.active !== entry.base.active;
    const rebased: DraftEntry = {
      rate: touchedRate ? entry.rate : rateText(live.rate),
      active: touchedActive ? entry.active : live.active,
      base: live,
      title: row.title,
      conflict: null,
      failure: entry.failure,
    };
    if (!isChanged(rebased)) {
      if (touchedRate || touchedActive) alreadyLive.push({ id, title: row.title });
      continue;
    }
    const conflict = moved && (touchedRate || touchedActive);
    next[id] = { ...rebased, conflict: conflict ? live : entry.conflict };
    if (conflict) conflicts.push({ id, title: row.title, live, mine: describeMine(entry, touchedRate, touchedActive) });
  }
  return { draft: next, conflicts, dropped, alreadyLive };
}

function describeMine(entry: DraftEntry, touchedRate: boolean, touchedActive: boolean): string {
  const switching = `switch it ${entry.active ? 'on' : 'off'}`;
  if (!touchedRate) return `your change to ${switching}`;
  const value = `your value ${entry.rate.trim()}`;
  return touchedActive ? `${value} and your change to ${switching}` : value;
}

function describeLive(values: RateValues): string {
  const rate = values.rate === null ? 'no rate' : formatNaira(values.rate);
  return values.active ? rate : `${rate} (switched off)`;
}

export function rebaseNotice(result: RebaseResult, includeConflicts: boolean): PageNotice | null {
  const items: NoticeItem[] = [
    ...(includeConflicts
      ? result.conflicts.map((conflict) => ({
          id: conflict.id,
          title: conflict.title,
          detail: `Someone else changed this to ${describeLive(conflict.live)}. ${conflict.mine.charAt(0).toUpperCase()}${conflict.mine.slice(1)} ${conflict.mine.includes(' and ') ? 'are kept; check them' : 'is kept; check it'} before saving.`,
        }))
      : []),
    ...result.dropped.map((note) => ({
      id: note.id,
      title: note.title,
      detail: 'This range is no longer listed (it, its card, country or type was switched off or removed), so your change was discarded.',
    })),
    ...result.alreadyLive.map((note) => ({
      id: note.id,
      title: note.title,
      detail: ALREADY_LIVE,
    })),
  ];
  if (items.length === 0) return null;
  return {
    tone: 'warning',
    title: items.length === 1 ? 'A rate changed while you were editing' : 'Rates changed while you were editing',
    message: 'The live rates were reloaded. Your other unsaved changes are kept.',
    items,
  };
}

export function rowView(row: RateRow, draft: Draft): RowView {
  const entry = draft[row.id];
  const from: RateValues = entry ? entry.base : { rate: row.rate, active: row.active };
  if (!entry) {
    return {
      rate: rateText(row.rate),
      active: row.active,
      changed: false,
      rateChanged: false,
      activeChanged: false,
      from,
      to: row.rate,
      huge: false,
      failure: null,
      conflict: null,
    };
  }
  const rateChanged = rateTouched(entry);
  const parsed = parseDecimal(entry.rate);
  return {
    rate: entry.rate,
    active: entry.active,
    changed: isChanged(entry),
    rateChanged,
    activeChanged: activeTouched(entry),
    from,
    to: rateChanged ? parsed : entry.base.rate,
    huge: rateChanged && parsed !== null && isHugeMove(from.rate, parsed),
    failure: entry.failure,
    conflict: entry.conflict,
  };
}

function showMatches(row: RateRow, show: ShowFilter, draft: Draft, keep: ReadonlySet<string>): boolean {
  if (show === 'changed') return isChanged(draft[row.id]) || keep.has(row.id);
  if (show === 'active') return row.active;
  if (show === 'inactive') return !row.active;
  return true;
}

export function filtersActive(query: string, show: ShowFilter): boolean {
  return normalize(query) !== '' || show !== 'all';
}

export function filterCards(
  cards: readonly RateCard[],
  query: string,
  show: ShowFilter,
  draft: Draft,
  keep: ReadonlySet<string> = NO_IDS,
): RateCard[] {
  const needle = normalize(query);
  if (needle === '' && show === 'all') return cards as RateCard[];
  const out: RateCard[] = [];
  for (const card of cards) {
    const cardHit = needle !== '' && includes(card.name, needle);
    const groups: RateGroup[] = [];
    for (const group of card.groups) {
      const { countryName, countryCode, typeName } = group.path;
      const groupHit = cardHit
        || (needle !== '' && (includes(countryName, needle) || includes(countryCode, needle) || includes(typeName, needle)));
      const rows = group.rows.filter((row) => (
        (needle === '' || groupHit || includes(row.label, needle)) && showMatches(row, show, draft, keep)
      ));
      if (rows.length > 0) groups.push({ ...group, rows });
    }
    if (groups.length > 0) out.push({ ...card, groups, emptyCountries: [] });
  }
  return out;
}

export function containsRow(cards: readonly RateCard[], id: string): boolean {
  return cards.some((card) => card.groups.some((group) => group.rows.some((row) => row.id === id)));
}

export function detailLabels(changes: readonly PendingChange[]): ReadonlyMap<string, string> {
  const seen = new Map<string, number>();
  for (const change of changes) seen.set(change.title, (seen.get(change.title) ?? 0) + 1);
  const used = new Set<string>();
  const labels = new Map<string, string>();
  for (const change of changes) {
    const base = (seen.get(change.title) ?? 0) > 1 ? `${change.title} (${valueSpan(change.row)})` : change.title;
    let label = base;
    for (let suffix = 2; used.has(label); suffix += 1) label = `${base} #${suffix}`;
    used.add(label);
    labels.set(change.id, label);
  }
  return labels;
}

export function savePayload(changes: readonly PendingChange[]) {
  return {
    changes: changes.map((change) => ({
      id: change.id,
      rate_naira: change.to.rate,
      is_active: change.to.active,
      expected: { rate_naira: change.from.rate, is_active: change.from.active },
    })),
  };
}

export function toRowResults(value: unknown): RowResult[] | null {
  if (!Array.isArray(value)) return null;
  const results: RowResult[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const id = text(item.id);
    const status = item.status;
    if (!id || typeof status !== 'string' || !STATUSES.has(status)) return null;
    results.push({
      id,
      status: status as RateResultStatus,
      rate: toAmount(item.rate_naira),
      active: typeof item.is_active === 'boolean' ? item.is_active : null,
    });
  }
  return results;
}

export function toSaveResponse(body: ApiBody): SaveResponse {
  return { results: toRowResults(body.results) ?? [], warning: text(body.warning) };
}

export function classifySave(result: ApiResult<SaveResponse>): SaveOutcome {
  if (result.ok) return { kind: 'saved', results: result.data.results, warning: result.data.warning };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  if (failure.status === 403) return { kind: 'refused', status: 403, message: failure.message };
  const details = isRecord(failure.details) ? failure.details : null;
  const results = details ? toRowResults(details.results) : null;
  if (results && results.length > 0) return { kind: 'conflict', results };
  return { kind: 'retry', message: failure.message };
}

export function failureReason(result: RowResult): string {
  if (result.status === 'missing') return 'This range no longer exists.';
  if (result.status === 'conflict') {
    return result.rate === null
      ? 'Someone else changed this range before your save reached it.'
      : `Someone else changed this to ${describeLive({ rate: result.rate, active: result.active === true })} before your save reached it.`;
  }
  return '';
}

function savedText(total: number): string {
  return total === 1
    ? 'Saved 1 rate change. New submissions use it now.'
    : `Saved ${total.toLocaleString('en-NG')} rate changes. New submissions use them now.`;
}

function conflictText(total: number, conflicts: number, staged: number): string {
  const lead = total === 1
    ? 'The range changed or was removed after you loaded it.'
    : `Rate changes are saved together, and ${count(conflicts, 'range', 'ranges')} changed or ${conflicts === 1 ? 'was' : 'were'} removed after you loaded ${conflicts === 1 ? 'it' : 'them'}.`;
  if (staged === 0) return lead;
  return `${lead} ${count(staged, 'change is', 'changes are')} still marked as unsaved below. Review and save again.`;
}

export function settleSave(
  draft: Draft,
  pending: readonly PendingChange[],
  outcome: SaveOutcome,
  fresh: RatesSnapshot | null,
): SaveSettlement {
  const total = pending.length;
  switch (outcome.kind) {
    case 'saved': {
      const remaining = without(draft, pending.map((change) => change.id));
      const next = fresh ? rebaseDraft(remaining, fresh).draft : remaining;
      const toasts: ToastNote[] = [{ text: savedText(total), tone: 'success' }];
      if (outcome.warning) toasts.push({ text: outcome.warning, tone: 'warning' });
      if (!fresh) toasts.push({ text: 'The new rates could not be reloaded. Refresh to see them.', tone: 'warning' });
      return { draft: next, notice: null, toasts, cleared: draftCount(next) === 0 };
    }
    case 'conflict': {
      const byId = new Map(outcome.results.map((result) => [result.id, result]));
      const next: Record<string, DraftEntry> = { ...draft };
      const items: NoticeItem[] = [];
      let conflicts = 0;
      for (const change of pending) {
        const result = byId.get(change.id);
        const entry = next[change.id];
        if (result?.status === 'unchanged') {
          delete next[change.id];
          items.push({ id: change.id, title: change.title, detail: ALREADY_LIVE });
        } else if (result && (result.status === 'conflict' || result.status === 'missing')) {
          const reason = failureReason(result);
          conflicts += 1;
          items.push({ id: change.id, title: change.title, detail: reason });
          if (entry) next[change.id] = { ...entry, failure: reason };
        } else if (entry && entry.failure !== null) {
          next[change.id] = { ...entry, failure: null };
        }
      }
      const settled = fresh ? rebaseDraft(next, fresh).draft : next;
      const staged = pending.filter((change) => isChanged(settled[change.id])).length;
      const toasts: ToastNote[] = [{ text: 'Nothing was saved. Check the notice above the rates.', tone: 'error' }];
      if (!fresh) toasts.push({ text: 'The live rates could not be reloaded. Refresh to see them.', tone: 'warning' });
      return {
        draft: settled,
        notice: {
          tone: 'danger',
          title: total === 1 ? 'The rate change was not saved' : `None of the ${changeCountText(total)} were saved`,
          message: conflictText(total, conflicts, staged),
          items,
        },
        toasts,
        cleared: false,
      };
    }
    case 'unknown': {
      if (!fresh) {
        return {
          draft,
          notice: {
            tone: 'warning',
            title: 'The save could not be confirmed',
            message: `${outcome.message} Your changes are still marked as unsaved below until you check.`,
            items: [],
          },
          toasts: [{ text: 'The save could not be confirmed. Refresh the rates before trying again.', tone: 'error' }],
          cleared: false,
        };
      }
      const rebased = rebaseDraft(draft, fresh);
      const ids = new Set(pending.map((change) => change.id));
      const live = rebased.alreadyLive.filter((note) => ids.has(note.id)).length;
      const remaining = pending.filter((change) => rebased.draft[change.id] !== undefined).length;
      const message = remaining === 0
        ? `No answer came back from the server, so the live rates were checked: all ${count(total, 'change is', 'changes are')} live.`
        : `No answer came back from the server, so the live rates were checked: ${live.toLocaleString('en-NG')} of ${count(total, 'change is', 'changes are')} live and ${count(remaining, 'is', 'are')} still marked as unsaved below. Review ${remaining === 1 ? 'it' : 'them'} before saving again.`;
      return {
        draft: rebased.draft,
        notice: { tone: 'warning', title: 'The save could not be confirmed', message, items: [] },
        toasts: remaining === 0
          ? [{ text: savedText(total), tone: 'success' }]
          : [{ text: 'Some changes may not have been saved. Check the notice above the rates.', tone: 'warning' }],
        cleared: draftCount(rebased.draft) === 0,
      };
    }
    case 'refused':
    case 'retry':
      return { draft, notice: null, toasts: [{ text: outcome.message, tone: 'error' }], cleared: false };
    case 'expired':
      return { draft, notice: null, toasts: [], cleared: false };
  }
}

export function addTarget(group: RateGroup): AddRangeTarget {
  return {
    path: group.path,
    ranges: group.rows.map((row) => ({ id: row.id, label: row.label, min: row.min, max: row.max, active: row.active })),
  };
}

export function overlapsFor(target: AddRangeTarget, min: number | null, max: number | null): ExistingRange[] {
  return target.ranges.filter((range) => rangesOverlap({ min, max }, range));
}

export function checkNewRange(form: NewRangeDraft): NewRangeCheck {
  const errors: NewRangeErrors = {};
  const labelIssue = labelProblem(form.label);
  if (labelIssue) errors.label = labelIssue;
  const minIssue = amountProblem(form.min);
  if (minIssue) errors.min = minIssue;
  const maxIssue = amountProblem(form.max);
  if (maxIssue) errors.max = maxIssue;
  const rateIssue = rateProblem(form.rate, form.active);
  if (rateIssue) errors.rate = rateIssue;
  const min = parseDecimal(form.min);
  const max = parseDecimal(form.max);
  if (!errors.min && !errors.max && min !== null && max !== null && min > max) {
    errors.max = 'The maximum must be at least the minimum.';
  }
  const rate = parseDecimal(form.rate);
  const valid = NEW_RANGE_FIELDS.every((field) => !errors[field]) && min !== null && max !== null && rate !== null;
  return {
    errors,
    values: valid ? { label: form.label.trim(), min: min as number, max: max as number, rate: rate as number, active: form.active } : null,
  };
}

export function firstNewRangeError(errors: NewRangeErrors): NewRangeField | null {
  return NEW_RANGE_FIELDS.find((field) => Boolean(errors[field])) ?? null;
}

export function newRangeBody(target: AddRangeTarget, values: NewRangeValues) {
  return {
    card_type_id: target.path.typeId,
    range_label: values.label,
    min_value: values.min,
    max_value: values.max,
    rate_naira: values.rate,
    is_active: values.active,
  };
}

export function toAddResponse(body: ApiBody): AddResponse {
  return { id: text(body.id), warning: text(body.warning) };
}

export function classifyAdd(result: ApiResult<AddResponse>): AddOutcome {
  if (result.ok) return { kind: 'added', id: result.data.id, warning: result.data.warning };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  if (failure.status === 403 || failure.status === 404) {
    return { kind: 'refused', status: failure.status, message: failure.message };
  }
  return { kind: 'retry', message: failure.message };
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
