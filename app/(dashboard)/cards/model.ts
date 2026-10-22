import type { ApiBody, ApiResult } from '../../lib/apiClient';
import { SORT_ORDER_MAX, findBrandNamed, sameBrandName } from './catalogRules';

export interface CatalogCountry {
  id: string;
  country_code: string;
  country_name: string;
  currency_symbol: string;
  is_active: boolean;
}

export interface CatalogCard {
  id: string;
  name: string;
  logo_url: string | null;
  info_text: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string | null;
  countries: CatalogCountry[];
}

export interface Catalog {
  cards: CatalogCard[];
}

export interface SavedCard {
  id: string;
  name: string | null;
  logo_url: string | null;
  info_text: string | null;
  is_active: boolean;
  sort_order: number | null;
}

export interface Receipt {
  warning: string | null;
}

export interface CardReceipt extends Receipt {
  card: SavedCard | null;
}

export interface CreatedCardReceipt extends Receipt {
  id: string;
  card: SavedCard | null;
}

export interface CountryReceipt extends Receipt {
  country: CatalogCountry | null;
}

export interface UploadReceipt extends Receipt {
  url: string;
}

export type MutationOutcome<T> =
  | { kind: 'done'; data: T }
  | { kind: 'expired' }
  | { kind: 'refused'; status: number; message: string }
  | { kind: 'unknown'; message: string }
  | { kind: 'retry'; message: string };

export type MoveTarget = 'up' | 'down' | 'top' | 'bottom';

export interface BrandDraft {
  name: string;
  logo_url: string | null;
  info_text: string;
  is_active: boolean;
}

export type BrandField = keyof BrandDraft;

export interface BrandChange<K extends BrandField = BrandField> {
  field: K;
  before: BrandDraft[K];
  after: BrandDraft[K];
}

export interface BrandRebase {
  draft: BrandDraft;
  pending: BrandChange[];
  conflicts: BrandField[];
}

export interface CatalogStats {
  total: number;
  active: number;
  inactive: number;
  needsCountry: number;
}

export interface CountrySummary {
  count: string;
  names: string;
  available: number;
  unavailable: number;
}

export const NEW_BRAND: Readonly<BrandDraft> = Object.freeze({ name: '', logo_url: null, info_text: '', is_active: false });

const BRAND_FIELDS: ReadonlyArray<BrandField> = ['name', 'logo_url', 'info_text', 'is_active'];

const REFUSED_STATUSES: ReadonlySet<number> = new Set([403, 404, 409]);

const APP_DELAY = 'The app picks this up within about two minutes.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function sortValue(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function readCountry(raw: unknown): CatalogCountry | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const code = text(raw.country_code);
  if (!id || !code) return null;
  return {
    id,
    country_code: code.toUpperCase(),
    country_name: text(raw.country_name) ?? code.toUpperCase(),
    currency_symbol: text(raw.currency_symbol) ?? '',
    is_active: raw.is_active === true,
  };
}

export function readCard(raw: unknown): CatalogCard | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (!id) return null;
  const countries = Array.isArray(raw.countries)
    ? raw.countries.map(readCountry).filter((country): country is CatalogCountry => country !== null)
    : [];
  return {
    id,
    name: text(raw.name) ?? '',
    logo_url: text(raw.logo_url),
    info_text: text(raw.info_text),
    is_active: raw.is_active === true,
    sort_order: sortValue(raw.sort_order),
    created_at: text(raw.created_at),
    countries,
  };
}

export function toCatalog(body: ApiBody): Catalog | null {
  if (!Array.isArray(body.cards)) return null;
  return { cards: body.cards.map(readCard).filter((card): card is CatalogCard => card !== null) };
}

function readSavedCard(raw: unknown): SavedCard | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (!id) return null;
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name.trim() : null,
    logo_url: text(raw.logo_url),
    info_text: text(raw.info_text),
    is_active: raw.is_active === true,
    sort_order: raw.sort_order === undefined || raw.sort_order === null ? null : sortValue(raw.sort_order),
  };
}

function warningOf(body: ApiBody): string | null {
  return text(body.warning);
}

export function toReceipt(body: ApiBody): Receipt {
  return { warning: warningOf(body) };
}

export function toCardReceipt(body: ApiBody): CardReceipt {
  return { warning: warningOf(body), card: readSavedCard(body.card) };
}

export function toCreatedCard(body: ApiBody): CreatedCardReceipt | null {
  const id = text(body.id);
  if (!id) return null;
  return { id, warning: warningOf(body), card: readSavedCard(body.card) };
}

export function toCountryReceipt(body: ApiBody): CountryReceipt {
  return { warning: warningOf(body), country: readCountry(body.country) };
}

export function toUploadReceipt(body: ApiBody): UploadReceipt | null {
  const url = text(body.url);
  return url ? { url, warning: warningOf(body) } : null;
}

export function classifyMutation<T>(result: ApiResult<T>): MutationOutcome<T> {
  if (result.ok) return { kind: 'done', data: result.data };
  const failure = result.error;
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.status !== null && REFUSED_STATUSES.has(failure.status)) {
    return { kind: 'refused', status: failure.status, message: failure.message };
  }
  return { kind: 'retry', message: failure.message };
}

export function brandLabel(card: Pick<CatalogCard, 'name'>): string {
  return card.name || 'Unnamed brand';
}

export function statusText(active: boolean): string {
  return active ? 'Active' : 'Inactive';
}

export function availabilityText(active: boolean): string {
  return active ? 'Available' : 'Unavailable';
}

export function matchesSearch(card: CatalogCard, query: string): boolean {
  const needle = fold(query);
  if (!needle) return true;
  if (fold(card.name).includes(needle)) return true;
  return card.countries.some(
    (country) => fold(country.country_name).includes(needle) || country.country_code.toLowerCase() === needle,
  );
}

export function moveId(ids: ReadonlyArray<string>, id: string, target: MoveTarget): string[] | null {
  const index = ids.indexOf(id);
  if (index < 0) return null;
  const last = ids.length - 1;
  const destination = target === 'up'
    ? index - 1
    : target === 'down'
      ? index + 1
      : target === 'top'
        ? 0
        : last;
  if (destination < 0 || destination > last || destination === index) return null;
  const next = ids.filter((entry) => entry !== id);
  next.splice(destination, 0, id);
  return next;
}

export function canMove(index: number, total: number, target: MoveTarget): boolean {
  if (index < 0 || index >= total) return false;
  return target === 'up' || target === 'top' ? index > 0 : index < total - 1;
}

export function applyOrder<T extends { id: string }>(cards: ReadonlyArray<T>, ids: ReadonlyArray<string>): T[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return cards
    .map((card, index) => ({ card, rank: rank.get(card.id) ?? ids.length + index }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.card);
}

export function renumberCards<T extends { id: string; sort_order: number }>(
  cards: ReadonlyArray<T>,
  ids: ReadonlyArray<string>,
): T[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return applyOrder(cards, ids).map((card) => {
    const position = rank.get(card.id);
    return position === undefined || card.sort_order === position ? card : { ...card, sort_order: position };
  });
}

export function positionText(index: number, total: number): string {
  return `${index + 1} of ${total}`;
}

export function hasSharedPositions(cards: ReadonlyArray<Pick<CatalogCard, 'sort_order'>>): boolean {
  const seen = new Set<number>();
  for (const card of cards) {
    if (seen.has(card.sort_order)) return true;
    seen.add(card.sort_order);
  }
  return false;
}

export function nextSortOrder(cards: ReadonlyArray<Pick<CatalogCard, 'sort_order'>>): number {
  if (cards.length === 0) return 0;
  const highest = Math.max(...cards.map((card) => card.sort_order));
  return Math.max(0, Math.min(SORT_ORDER_MAX, Math.floor(highest) + 1));
}

export function availableCountries(card: Pick<CatalogCard, 'countries'>): number {
  return card.countries.filter((country) => country.is_active).length;
}

export function needsCountry(card: Pick<CatalogCard, 'is_active' | 'countries'>): boolean {
  return card.is_active && availableCountries(card) === 0;
}

export function catalogStats(cards: ReadonlyArray<CatalogCard>): CatalogStats {
  const active = cards.filter((card) => card.is_active).length;
  return {
    total: cards.length,
    active,
    inactive: cards.length - active,
    needsCountry: cards.filter(needsCountry).length,
  };
}

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? one : many}`;
}

export function sortCountries(countries: ReadonlyArray<CatalogCountry>): CatalogCountry[] {
  return countries.slice().sort((a, b) => a.country_name.localeCompare(b.country_name, 'en'));
}

export function countrySummary(countries: ReadonlyArray<CatalogCountry>, max = 3): CountrySummary {
  const available = countries.filter((country) => country.is_active).length;
  const shown = sortCountries(countries).slice(0, Math.max(0, max)).map((country) => country.country_name);
  const extra = countries.length - shown.length;
  return {
    count: countries.length === 0 ? 'No countries' : plural(countries.length, 'country', 'countries'),
    names: extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', '),
    available,
    unavailable: countries.length - available,
  };
}

export function brandDraftOf(card: Pick<CatalogCard, 'name' | 'logo_url' | 'info_text' | 'is_active'>): BrandDraft {
  return { name: card.name, logo_url: card.logo_url, info_text: card.info_text ?? '', is_active: card.is_active };
}

function fieldValue(draft: BrandDraft, field: BrandField): BrandDraft[BrandField] {
  return field === 'name' || field === 'info_text' ? draft[field].trim() : draft[field];
}

export function brandChanges(base: BrandDraft, draft: BrandDraft): BrandChange[] {
  return BRAND_FIELDS.filter((field) => fieldValue(base, field) !== fieldValue(draft, field)).map((field) => ({
    field,
    before: fieldValue(base, field),
    after: fieldValue(draft, field),
  }) as BrandChange);
}

export function rebaseBrand(base: BrandDraft, draft: BrandDraft, live: BrandDraft): BrandRebase {
  const mine = new Set(brandChanges(base, draft).map((change) => change.field));
  const merged: BrandDraft = {
    name: mine.has('name') ? draft.name.trim() : live.name,
    logo_url: mine.has('logo_url') ? draft.logo_url : live.logo_url,
    info_text: mine.has('info_text') ? draft.info_text.trim() : live.info_text,
    is_active: mine.has('is_active') ? draft.is_active : live.is_active,
  };
  const conflicts = BRAND_FIELDS.filter(
    (field) => mine.has(field) && fieldValue(base, field) !== fieldValue(live, field),
  );
  return { draft: merged, pending: brandChanges(live, merged), conflicts };
}

export function brandPatch(id: string, changes: ReadonlyArray<BrandChange>): Record<string, unknown> {
  const body: Record<string, unknown> = { type: 'card', id };
  for (const change of changes) body[change.field] = change.after;
  return body;
}

export function duplicateBrand(
  cards: ReadonlyArray<CatalogCard>,
  name: string,
  exceptId: string | null,
): CatalogCard | null {
  return findBrandNamed(cards, name, exceptId);
}

export function mergeSavedCard(cards: ReadonlyArray<CatalogCard>, saved: SavedCard): CatalogCard[] {
  return cards.map((card) => (
    card.id === saved.id
      ? {
          ...card,
          name: saved.name ?? card.name,
          logo_url: saved.logo_url,
          info_text: saved.info_text,
          is_active: saved.is_active,
          sort_order: saved.sort_order ?? card.sort_order,
        }
      : card
  ));
}

export function appendCard(cards: ReadonlyArray<CatalogCard>, saved: SavedCard): CatalogCard[] {
  if (cards.some((card) => card.id === saved.id)) return mergeSavedCard(cards, saved);
  return [
    ...cards,
    {
      id: saved.id,
      name: saved.name ?? '',
      logo_url: saved.logo_url,
      info_text: saved.info_text,
      is_active: saved.is_active,
      sort_order: saved.sort_order ?? nextSortOrder(cards),
      created_at: null,
      countries: [],
    },
  ];
}

export function withCountries(
  cards: ReadonlyArray<CatalogCard>,
  cardId: string,
  update: (countries: CatalogCountry[]) => CatalogCountry[],
): CatalogCard[] {
  return cards.map((card) => (card.id === cardId ? { ...card, countries: update(card.countries.slice()) } : card));
}

export function upsertCountry(countries: ReadonlyArray<CatalogCountry>, country: CatalogCountry): CatalogCountry[] {
  const exists = countries.some((entry) => entry.id === country.id);
  return exists
    ? countries.map((entry) => (entry.id === country.id ? country : entry))
    : [...countries, country];
}

export function dropCountry(countries: ReadonlyArray<CatalogCountry>, countryId: string): CatalogCountry[] {
  return countries.filter((entry) => entry.id !== countryId);
}

export function availabilityAfter(card: Pick<CatalogCard, 'countries'>, countryId: string, next: boolean | null): number {
  return card.countries.filter((country) => (
    country.id === countryId ? next === true : country.is_active
  )).length;
}

function lastCountryLine(brand: string): string {
  return `This is the last available country, so users will see ${brand} but cannot sell it until another country is available.`;
}

export function statusConsequences(card: CatalogCard, next: boolean): string[] {
  const brand = brandLabel(card);
  if (!next) {
    return [
      `Users stop seeing ${brand} in the Sell tab and the rate calculator once their app refreshes its brand list.`,
      'Anyone already on the sell form can still submit, and those cards reach the review queue as usual.',
      'Cards already in the review queue can still be approved or rejected.',
      'Its countries, card types and rates are kept, so activating it again restores it as it was.',
    ];
  }
  const open = availableCountries(card);
  return open > 0
    ? [
        `Users see ${brand} in the Sell tab and the rate calculator once their app refreshes its brand list.`,
        `They can sell it in ${plural(open, 'available country', 'available countries')}.`,
      ]
    : [
        `Users see ${brand} in the Sell tab once their app refreshes its brand list.`,
        `${brand} has no available country, so users cannot sell it until a country is made available.`,
      ];
}

export function renameConsequences(previous: string, next: string): string[] {
  const lines = [`Users see “${next}” in the Sell tab, the rate calculator and their trade history, including past trades.`];
  if (previous && !sameBrandName(previous, next)) {
    lines.push(
      `Coupons and giftbox rules match brands by name. Any that name “${previous}” stop applying to this brand until they are changed to “${next}”.`,
    );
  }
  if (previous && previous !== next) {
    lines.push(`Past trades in the marketplace feed keep the name “${previous}” and show without a logo.`);
  }
  return lines;
}

export function logoConsequences(brand: string, next: string | null): string[] {
  return next
    ? [`${brand} shows the new logo in the Sell tab and in users’ trade history.`]
    : [`${brand} shows without a logo in the app.`];
}

export function brandChangeConsequences(
  pending: ReadonlyArray<BrandChange>,
  live: CatalogCard,
  next: BrandDraft,
): string[] {
  const lines: string[] = [];
  const brand = brandLabel({ name: next.name });
  for (const change of pending) {
    if (change.field === 'name') lines.push(...renameConsequences(live.name, next.name));
    if (change.field === 'logo_url') lines.push(...logoConsequences(brand, next.logo_url));
    if (change.field === 'is_active') lines.push(...statusConsequences({ ...live, name: next.name }, next.is_active));
  }
  return lines;
}

export function countryOffConsequences(card: CatalogCard, country: CatalogCountry): string[] {
  const brand = brandLabel(card);
  const after = availabilityAfter(card, country.id, false);
  return [
    `Users can no longer choose ${country.country_name} when selling ${brand}. ${APP_DELAY}`,
    ...(card.is_active && after === 0 ? [lastCountryLine(brand)] : []),
    'Anyone already on the sell form for this country can still submit.',
    'Its card types and rates are kept and apply again when you make it available.',
  ];
}

export function countryRemovalConsequences(card: CatalogCard, country: CatalogCountry): string[] {
  const brand = brandLabel(card);
  const after = availabilityAfter(card, country.id, null);
  const symbol = country.currency_symbol;
  return [
    ...(country.is_active ? [`Users can no longer choose ${country.country_name} when selling ${brand}. ${APP_DELAY}`] : []),
    ...(country.is_active && card.is_active && after === 0 ? [lastCountryLine(brand)] : []),
    `Card types and rates set up for ${country.country_name} are kept and apply again if you add it back.`,
    ...(symbol && symbol !== '$'
      ? [`Notifications about ${brand} cards from ${country.country_name} show amounts with “$” instead of “${symbol}” until it is added back.`]
      : []),
  ];
}

export function symbolConsequences(card: CatalogCard, country: CatalogCountry, symbol: string): string[] {
  const brand = brandLabel(card);
  return [
    `Users see “${symbol}” next to amounts and rates for ${country.country_name} when selling ${brand}. ${APP_DELAY}`,
    `Notifications about ${brand} cards from ${country.country_name} use “${symbol}” from now on.`,
  ];
}
