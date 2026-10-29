import type { ApiBody, ApiResult } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { formatAge } from '../../lib/time';
import { toRatesSnapshot, type RatePath } from '../rates/model';
import { toAmount } from '../rates/rateRules';
import {
  PROVIDER_ID, appliedKobo, dueNow, isCount, isInterval, isValidKobo, koboOf, listedOff, overdue, ratesMoved, readApplySummary,
  readPct, readProductsSummary, relabelledText, stamp, summaryText, typesOffText,
  type ApplySummary, type IntervalMinutes, type ProductsSummary, type RateProvider, type UnpricedType,
} from './rules';

export { dueNow, overdue, stamp } from './rules';

export const STATUS_ENDPOINT = '/api/automatic-rates';
export const PROVIDERS_ENDPOINT = '/api/automatic-rates/providers';
export const SETTINGS_ENDPOINT = '/api/automatic-rates/settings';
export const CARDS_ENDPOINT = '/api/automatic-rates/cards';
export const RUN_ENDPOINT = '/api/automatic-rates/run';

export type RunMode = 'apply' | 'products';
export type RunVia = 'schedule' | 'console';

export interface RunningRun {
  id: string;
  mode: RunMode;
  startedAt: string;
  via: RunVia;
}

export interface SucceededUpdate {
  id: string;
  startedAt: string;
  finishedAt: string;
  via: RunVia;
  summary: ApplySummary;
}

export type FinishedUpdate =
  | { id: string; status: 'succeeded'; startedAt: string; finishedAt: string; via: RunVia; summary: ApplySummary; error: null }
  | { id: string; status: 'failed'; startedAt: string; finishedAt: string; via: RunVia; summary: null; error: string };

export type FinishedProducts =
  | { id: string; status: 'succeeded'; startedAt: string; finishedAt: string; summary: ProductsSummary; error: null }
  | { id: string; status: 'failed'; startedAt: string; finishedAt: string; summary: null; error: string };

export interface AutomaticStatus {
  enabled: boolean;
  provider: string | null;
  intervalMinutes: IntervalMinutes;
  universalPct: number;
  enabledChangedAt: string | null;
  updatedAt: string;
  linkedTypeIds: string[];
  running: RunningRun | null;
  lastSuccess: SucceededUpdate | null;
  lastUpdate: FinishedUpdate | null;
  lastProducts: FinishedProducts | null;
  failures: number;
  nextDueAt: string | null;
  stale: boolean;
}

export type StatusIssue =
  | { kind: 'running'; mode: RunMode; startedAt: string }
  | { kind: 'failed'; error: string; streak: number; nextDueAt: string | null }
  | { kind: 'stale'; lastSuccessAt: string | null }
  | { kind: 'never' }
  | { kind: 'types_off'; types: UnpricedType[] }
  | { kind: 'no_links' };

export type ProvidersView =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; providers: RateProvider[] };

export interface ProviderBand {
  min: number;
  max: number;
  rateKobo: number;
}

export interface ProviderProduct {
  ref: string;
  name: string;
  country: string | null;
  currency: string | null;
  form: string | null;
  bands: ProviderBand[] | null;
  problem: string | null;
  lastSeenAt: string;
  inLatest: boolean;
}

export interface LinkRow {
  typeId: string;
  path: RatePath;
  title: string;
  place: string;
  liveRanges: number;
  ref: string | null;
  product: ProviderProduct | null;
  offReason: string | null;
}

export interface LinkCard {
  id: string;
  name: string;
  logoUrl: string | null;
  rows: LinkRow[];
  ownPct: number | null;
  effectivePct: number;
  linked: number;
}

export interface CardsSnapshot {
  provider: string | null;
  enabled: boolean;
  universalPct: number;
  cards: LinkCard[];
  products: ProviderProduct[];
  typeCount: number;
  linkedCount: number;
  offCount: number;
  hiddenLinked: number;
  ownPctCards: number;
}

export type LinkFilter = 'all' | 'linked' | 'unlinked' | 'off';

export const LINK_FILTERS: ReadonlyArray<{ value: LinkFilter; label: string }> = [
  { value: 'all', label: 'All card types' },
  { value: 'linked', label: 'Linked' },
  { value: 'unlinked', label: 'Not linked' },
  { value: 'off', label: 'Switched off' },
];

export interface BandPreview {
  min: number;
  max: number;
  rateKobo: number;
  paidKobo: number;
  valid: boolean;
}

export interface CurrencySample {
  key: string;
  countryName: string;
  symbol: string;
  lowKobo: number;
  highKobo: number;
}

export interface SwitchReceipt {
  enabled: boolean;
  changed: string[];
  status: AutomaticStatus | null;
}

export type RunReceipt =
  | { mode: 'apply'; summary: ApplySummary }
  | { mode: 'products'; summary: ProductsSummary };

export interface LinkReceipt {
  saved: string[];
  unchanged: string[];
}

export interface MarkupReceipt {
  changed: boolean;
  ownPct: number | null;
  effectivePct: number;
  repriced: number;
}

export type WriteOutcome<T> =
  | { kind: 'done'; data: T }
  | { kind: 'conflict'; message: string }
  | { kind: 'denied'; message: string }
  | { kind: 'expired' }
  | { kind: 'unknown'; message: string }
  | { kind: 'refused'; message: string };

const BLOCK = {
  checking: 'Checking the rate service…',
  unchecked: 'The rate service could not be checked, so automatic rates cannot be turned on right now.',
  noRegistry: 'No rate provider is set up on the server yet, so automatic rates cannot be turned on.',
  noProvider: 'Choose a rate provider in Update settings first.',
  unknownProvider: 'The chosen rate provider is not set up on the server.',
  noLinks: 'Link at least one card type below first.',
} as const;

const LOCK = {
  noRegistry: 'No rate provider is set up on the server yet, so card types cannot be linked and automatic rates cannot be turned on.',
  unknownProvider: 'The chosen rate provider is not set up on the server, so its products cannot be loaded and automatic rates cannot be turned on.',
  unknownProviderOn: 'The chosen rate provider is not set up on the server, so its products cannot be loaded and every update fails until it is set up again.',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function instantOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value)) ? value : null;
}

function nullableInstant(value: unknown): string | null | undefined {
  if (value === null) return null;
  const at = instantOf(value);
  return at === null ? undefined : at;
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function uuidOf(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

function uuidList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    const id = uuidOf(item);
    if (id === null) return null;
    ids.push(id);
  }
  return ids;
}

function readVia(value: unknown): RunVia | null {
  return value === 'schedule' || value === 'console' ? value : null;
}

function readRunning(value: unknown): RunningRun | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const id = uuidOf(value.id);
  const startedAt = instantOf(value.started_at);
  const via = readVia(value.requested_via);
  const mode = value.mode === 'apply' || value.mode === 'products' ? value.mode : null;
  if (id === null || startedAt === null || via === null || mode === null) return undefined;
  return { id, mode, startedAt, via };
}

function readSuccess(value: unknown): SucceededUpdate | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const id = uuidOf(value.id);
  const startedAt = instantOf(value.started_at);
  const finishedAt = instantOf(value.finished_at);
  const via = readVia(value.requested_via);
  const summary = readApplySummary(value.summary);
  if (id === null || startedAt === null || finishedAt === null || via === null || summary === null) return undefined;
  return { id, startedAt, finishedAt, via, summary };
}

function readUpdate(value: unknown): FinishedUpdate | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const id = uuidOf(value.id);
  const startedAt = instantOf(value.started_at);
  const finishedAt = instantOf(value.finished_at);
  const via = readVia(value.requested_via);
  if (id === null || startedAt === null || finishedAt === null || via === null) return undefined;
  if (value.status === 'succeeded' && value.error === null) {
    const summary = readApplySummary(value.summary);
    return summary ? { id, status: 'succeeded', startedAt, finishedAt, via, summary, error: null } : undefined;
  }
  const error = nullableText(value.error);
  if (value.status === 'failed' && value.summary === null && typeof error === 'string') {
    return { id, status: 'failed', startedAt, finishedAt, via, summary: null, error };
  }
  return undefined;
}

function readProducts(value: unknown): FinishedProducts | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const id = uuidOf(value.id);
  const startedAt = instantOf(value.started_at);
  const finishedAt = instantOf(value.finished_at);
  if (id === null || startedAt === null || finishedAt === null) return undefined;
  if (value.status === 'succeeded' && value.error === null) {
    const summary = readProductsSummary(value.summary);
    return summary ? { id, status: 'succeeded', startedAt, finishedAt, summary, error: null } : undefined;
  }
  const error = nullableText(value.error);
  if (value.status === 'failed' && value.summary === null && typeof error === 'string') {
    return { id, status: 'failed', startedAt, finishedAt, summary: null, error };
  }
  return undefined;
}

export function toAutomaticStatus(raw: unknown): AutomaticStatus | null {
  if (!isRecord(raw)) return null;
  const { enabled, stale, provider } = raw;
  if (typeof enabled !== 'boolean' || typeof stale !== 'boolean') return null;
  if (!(provider === null || (typeof provider === 'string' && PROVIDER_ID.test(provider)))) return null;
  if (!isInterval(raw.interval_minutes)) return null;
  const universalPct = readPct(raw.universal_markup_pct);
  const enabledChangedAt = nullableInstant(raw.enabled_changed_at);
  const updatedAt = instantOf(raw.updated_at);
  const nextDueAt = nullableInstant(raw.next_due_at);
  const linkedTypeIds = uuidList(raw.linked_card_type_ids);
  const running = readRunning(raw.running);
  const lastSuccess = readSuccess(raw.last_success);
  const lastUpdate = readUpdate(raw.last_update);
  const lastProducts = readProducts(raw.last_products);
  if (universalPct === null || enabledChangedAt === undefined || updatedAt === null || nextDueAt === undefined) return null;
  if (linkedTypeIds === null || running === undefined || lastSuccess === undefined || lastUpdate === undefined) return null;
  if (lastProducts === undefined || !isCount(raw.failures)) return null;
  if (enabled && (provider === null || enabledChangedAt === null || nextDueAt === null)) return null;
  if (!enabled && (nextDueAt !== null || stale)) return null;
  return {
    enabled,
    provider,
    intervalMinutes: raw.interval_minutes,
    universalPct,
    enabledChangedAt,
    updatedAt,
    linkedTypeIds,
    running,
    lastSuccess,
    lastUpdate,
    lastProducts,
    failures: raw.failures,
    nextDueAt,
    stale,
  };
}

export function currentSuccess(status: AutomaticStatus): SucceededUpdate | null {
  const success = status.lastSuccess;
  if (!success || status.enabledChangedAt === null) return null;
  return Date.parse(success.startedAt) >= Date.parse(status.enabledChangedAt) ? success : null;
}

export function statusIssue(status: AutomaticStatus): StatusIssue | null {
  if (status.running) return { kind: 'running', mode: status.running.mode, startedAt: status.running.startedAt };
  if (!status.enabled) return null;
  if (status.linkedTypeIds.length === 0) return { kind: 'no_links' };
  const last = status.lastUpdate;
  if (last && last.status === 'failed' && status.failures > 0) {
    return { kind: 'failed', error: last.error, streak: status.failures, nextDueAt: status.nextDueAt };
  }
  const current = currentSuccess(status);
  if (status.stale) return { kind: 'stale', lastSuccessAt: current ? current.startedAt : null };
  if (!current) return { kind: 'never' };
  const off = listedOff(current.summary);
  return off.length > 0 ? { kind: 'types_off', types: off } : null;
}

export function providerEntry(provider: string | null, view: ProvidersView): RateProvider | null {
  if (provider === null || view.state !== 'ready') return null;
  const entry = view.providers.find((candidate) => candidate.id === provider);
  return entry === undefined ? null : entry;
}

export function providerName(provider: string | null, view: ProvidersView): string {
  const entry = providerEntry(provider, view);
  return entry ? entry.label : 'the rate provider';
}

export function sentence(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

export function runToastText(summary: ApplySummary, provider: string): string {
  const changed = summaryText(summary);
  const lead = changed === null
    ? `${sentence(provider)}’s rates matched the live rates, so nothing changed.`
    : ratesMoved(summary)
      ? `Rates updated from ${provider}: ${changed}.`
      : `${sentence(provider)}’s rates matched the live rates, so no rate changed. ${relabelledText(summary.relabelled)}`;
  const off = listedOff(summary);
  return off.length > 0 ? `${lead} ${typesOffText(off, 'card type')}` : lead;
}

export function providerLock(provider: string | null, view: ProvidersView, enabled: boolean): string | null {
  if (view.state !== 'ready') return null;
  if (provider !== null) {
    if (view.providers.some((entry) => entry.id === provider)) return null;
    return enabled ? LOCK.unknownProviderOn : LOCK.unknownProvider;
  }
  return view.providers.length === 0 ? LOCK.noRegistry : null;
}

export function turnOnBlock(status: AutomaticStatus, view: ProvidersView): string | null {
  if (view.state === 'loading') return BLOCK.checking;
  if (view.state === 'failed') return BLOCK.unchecked;
  if (view.providers.length === 0) return BLOCK.noRegistry;
  if (status.provider === null) return BLOCK.noProvider;
  const entry = providerEntry(status.provider, view);
  if (!entry) return BLOCK.unknownProvider;
  if (entry.missingSecrets.length > 0) return `The rate provider’s keys are not set on the server: ${entry.missingSecrets.join(', ')}.`;
  if (status.linkedTypeIds.length === 0) return BLOCK.noLinks;
  return null;
}

export function ageText(at: string, now: number): string {
  const age = formatAge(at, new Date(now));
  return age === '<1m' ? 'less than a minute ago' : `${age} ago`;
}

export function linkDueText(status: AutomaticStatus, now: number): string {
  if (!status.enabled || status.nextDueAt === null) return '';
  const first = status.linkedTypeIds.length === 0;
  if (overdue(status, now)) {
    return first
      ? ` The first update has been overdue since ${stamp(status.nextDueAt)}.`
      : ` It changes at the next update, which has been overdue since ${stamp(status.nextDueAt)}.`;
  }
  if (dueNow(status, now)) {
    return first ? ' The first update starts within 5 minutes.' : ' It changes at the next update, which starts within 5 minutes.';
  }
  return first
    ? ` The first update is due around ${stamp(status.nextDueAt)}.`
    : ` It changes at the next update, due around ${stamp(status.nextDueAt)}.`;
}

function readBand(value: unknown): ProviderBand | null {
  if (!isRecord(value)) return null;
  const min = toAmount(value.min);
  const max = toAmount(value.max);
  const rateKobo = koboOf(value.rate);
  if (min === null || max === null || min < 0 || max < min || rateKobo === null || !isValidKobo(rateKobo)) return null;
  return { min, max, rateKobo };
}

function readProduct(value: unknown): ProviderProduct | null {
  if (!isRecord(value)) return null;
  const { ref, name } = value;
  const country = nullableText(value.country);
  const currency = nullableText(value.currency);
  const form = nullableText(value.form);
  const problem = nullableText(value.problem);
  const lastSeenAt = instantOf(value.last_seen_at);
  if (typeof ref !== 'string' || ref === '' || typeof name !== 'string' || name.trim() === '') return null;
  if (country === undefined || currency === undefined || form === undefined || problem === undefined || lastSeenAt === null) return null;
  if (typeof value.in_latest !== 'boolean') return null;
  let bands: ProviderBand[] | null = null;
  if (value.bands !== null) {
    if (!Array.isArray(value.bands)) return null;
    bands = [];
    for (const item of value.bands) {
      const band = readBand(item);
      if (!band) return null;
      bands.push(band);
    }
  }
  if ((bands === null) === (problem === null)) return null;
  return { ref, name: name.trim(), country, currency, form, bands, problem, lastSeenAt, inLatest: value.in_latest };
}

function rowTitle(path: RatePath): string {
  return `${path.cardName}${path.countryCode ? ` ${path.countryCode}` : ''} · ${path.typeName}`;
}

export function toCardsSnapshot(body: ApiBody): CardsSnapshot | null {
  const tree = toRatesSnapshot({ cards: body.cards });
  const overview = isRecord(body.automatic) ? body.automatic : null;
  if (!tree || !overview) return null;
  const { provider, enabled } = overview;
  if (!(provider === null || (typeof provider === 'string' && PROVIDER_ID.test(provider))) || typeof enabled !== 'boolean') return null;
  const universalPct = readPct(overview.universal_markup_pct);
  if (universalPct === null) return null;
  if (!Array.isArray(overview.markups) || !Array.isArray(overview.links) || !Array.isArray(overview.products)) return null;
  if (!Array.isArray(overview.unpriced)) return null;

  const markups = new Map<string, { own: number | null; effective: number }>();
  for (const item of overview.markups) {
    if (!isRecord(item)) return null;
    const cardId = uuidOf(item.card_id);
    const own = item.card_markup_pct === null ? null : readPct(item.card_markup_pct);
    const effective = readPct(item.effective_markup_pct);
    if (cardId === null || effective === null || (item.card_markup_pct !== null && own === null)) return null;
    if (effective !== (own === null ? universalPct : own)) return null;
    markups.set(cardId, { own, effective });
  }

  const links = new Map<string, string>();
  for (const item of overview.links) {
    if (!isRecord(item)) return null;
    const typeId = uuidOf(item.card_type_id);
    if (typeId === null || typeof item.provider_ref !== 'string' || item.provider_ref === '' || instantOf(item.updated_at) === null) return null;
    links.set(typeId, item.provider_ref);
  }

  const products: ProviderProduct[] = [];
  const byRef = new Map<string, ProviderProduct>();
  for (const item of overview.products) {
    const product = readProduct(item);
    if (!product || byRef.has(product.ref)) return null;
    products.push(product);
    byRef.set(product.ref, product);
  }

  const offReasons = new Map<string, string>();
  for (const item of overview.unpriced) {
    if (!isRecord(item)) return null;
    const typeId = uuidOf(item.card_type_id);
    if (typeId === null || typeof item.reason !== 'string' || item.reason === '' || typeof item.listed !== 'boolean') return null;
    offReasons.set(typeId, item.reason);
  }

  const shown = new Set<string>();
  const cards: LinkCard[] = [];
  for (const card of tree.cards) {
    const markup = markups.get(card.id.toLowerCase());
    if (!markup) return null;
    const rows: LinkRow[] = card.groups.map((group) => {
      const typeId = group.path.typeId.toLowerCase();
      shown.add(typeId);
      const ref = links.has(typeId) ? (links.get(typeId) as string) : null;
      return {
        typeId,
        path: group.path,
        title: rowTitle(group.path),
        place: `${group.path.countryName} · ${group.path.typeName}`,
        liveRanges: group.rows.filter((row) => row.active).length,
        ref,
        product: ref !== null && byRef.has(ref) ? (byRef.get(ref) as ProviderProduct) : null,
        offReason: ref !== null && offReasons.has(typeId) ? (offReasons.get(typeId) as string) : null,
      };
    });
    cards.push({
      id: card.id,
      name: card.name,
      logoUrl: card.logoUrl,
      rows,
      ownPct: markup.own,
      effectivePct: markup.effective,
      linked: rows.filter((row) => row.ref !== null).length,
    });
  }

  const allRows = cards.flatMap((card) => card.rows);
  return {
    provider,
    enabled,
    universalPct,
    cards,
    products,
    typeCount: allRows.length,
    linkedCount: allRows.filter((row) => row.ref !== null).length,
    offCount: allRows.filter((row) => row.offReason !== null).length,
    hiddenLinked: [...links.keys()].filter((typeId) => !shown.has(typeId)).length,
    ownPctCards: [...markups.values()].filter((markup) => markup.own !== null).length,
  };
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function rowMatches(card: LinkCard, row: LinkRow, needle: string, filter: LinkFilter): boolean {
  if (filter === 'linked' && row.ref === null) return false;
  if (filter === 'unlinked' && row.ref !== null) return false;
  if (filter === 'off' && row.offReason === null) return false;
  if (needle === '') return true;
  const haystack = [card.name, row.path.countryName, row.path.countryCode, row.path.typeName];
  if (row.ref !== null) haystack.push(row.ref);
  if (row.product) haystack.push(row.product.name);
  return haystack.some((value) => normalize(value).includes(needle));
}

export function filterLinkCards(cards: readonly LinkCard[], query: string, filter: LinkFilter): LinkCard[] {
  const needle = normalize(query);
  if (needle === '' && filter === 'all') return cards as LinkCard[];
  const out: LinkCard[] = [];
  for (const card of cards) {
    const rows = card.rows.filter((row) => rowMatches(card, row, needle, filter));
    if (rows.length > 0) out.push({ ...card, rows });
  }
  return out;
}

export function filtering(query: string, filter: LinkFilter): boolean {
  return normalize(query) !== '' || filter !== 'all';
}

export function previewBands(product: ProviderProduct, pct: number): BandPreview[] | null {
  if (product.bands === null) return null;
  const hundredths = Math.round(pct * 100);
  return product.bands.map((band) => {
    const paidKobo = appliedKobo(band.rateKobo, hundredths);
    return { min: band.min, max: band.max, rateKobo: band.rateKobo, paidKobo, valid: isValidKobo(paidKobo) };
  });
}

export function currencySamples(card: LinkCard): CurrencySample[] {
  const samples = new Map<string, CurrencySample>();
  for (const row of card.rows) {
    const bands = row.product?.bands;
    if (!bands || bands.length === 0) continue;
    const key = `${row.path.countryCode}|${row.path.currency}`;
    const low = Math.min(...bands.map((band) => band.rateKobo));
    const high = Math.max(...bands.map((band) => band.rateKobo));
    const known = samples.get(key);
    if (known) {
      known.lowKobo = Math.min(known.lowKobo, low);
      known.highKobo = Math.max(known.highKobo, high);
    } else {
      samples.set(key, { key, countryName: row.path.countryName, symbol: row.path.currency, lowKobo: low, highKobo: high });
    }
  }
  return [...samples.values()];
}

export function toSwitchReceipt(body: ApiBody): SwitchReceipt | null {
  if (typeof body.enabled !== 'boolean' || !Array.isArray(body.changed)) return null;
  const changed: string[] = [];
  for (const key of body.changed) {
    if (typeof key !== 'string') return null;
    changed.push(key);
  }
  return { enabled: body.enabled, changed, status: toAutomaticStatus(body.automatic) };
}

export function toRunReceipt(body: ApiBody): RunReceipt | null {
  if (body.mode === 'apply') {
    const summary = readApplySummary(body.summary);
    return summary ? { mode: 'apply', summary } : null;
  }
  if (body.mode === 'products') {
    const summary = readProductsSummary(body.summary);
    return summary ? { mode: 'products', summary } : null;
  }
  return null;
}

export function toLinkReceipt(body: ApiBody): LinkReceipt | null {
  const saved = uuidList(body.saved);
  const unchanged = uuidList(body.unchanged);
  return saved && unchanged ? { saved, unchanged } : null;
}

export function toMarkupReceipt(body: ApiBody): MarkupReceipt | null {
  const ownPct = body.card_markup_pct === null ? null : readPct(body.card_markup_pct);
  const effectivePct = readPct(body.effective_markup_pct);
  if (typeof body.changed !== 'boolean' || effectivePct === null || !isCount(body.repriced)) return null;
  if (body.card_markup_pct !== null && ownPct === null) return null;
  return { changed: body.changed, ownPct, effectivePct, repriced: body.repriced };
}

export function classifyWrite<T>(result: ApiResult<T>): WriteOutcome<T> {
  if (result.ok) return { kind: 'done', data: result.data };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.status === 403) return { kind: 'denied', message: failure.message };
  const details = isRecord(failure.details) ? failure.details : null;
  if (failure.outcomeUnknown || details?.outcome_unknown === true || failure.kind !== 'http') {
    return { kind: 'unknown', message: failure.message };
  }
  if (failure.status === 409 && details?.reason === 'conflict') return { kind: 'conflict', message: failure.message };
  return { kind: 'refused', message: failure.message };
}

export function linkedText(count: number): string {
  return count === 1 ? '1 linked card type' : `${count.toLocaleString('en-NG')} linked card types`;
}

export function linkedOfText(cards: CardsSnapshot): string {
  const listed = `${cards.linkedCount.toLocaleString('en-NG')} of ${cards.typeCount.toLocaleString('en-NG')}`;
  return cards.hiddenLinked > 0 ? `${listed}, plus ${cards.hiddenLinked.toLocaleString('en-NG')} switched off in Cards` : listed;
}

export function rangesRepricedText(count: number): string {
  if (count === 0) return '';
  return count === 1 ? ' 1 range was repriced.' : ` ${count.toLocaleString('en-NG')} ranges were repriced.`;
}
