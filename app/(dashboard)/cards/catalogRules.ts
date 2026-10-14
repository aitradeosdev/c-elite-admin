import { isUuid } from '../../lib/http';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '../../lib/uploadTypes';

export const CARD_NAME_MAX = 80;
export const COUNTRY_NAME_MAX = 80;
export const CURRENCY_SYMBOL_MAX = 8;
export const LOGO_URL_MAX = 500;
export const SORT_ORDER_MAX = 10000;
export const REORDER_MAX = 200;

export const LOGO_EXTENSIONS: ReadonlyArray<string> = Object.keys(ALLOWED_IMAGE_TYPES);

export const LOGO_ACCEPT = LOGO_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export const LOGO_MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

const COUNTRY_CODE = /^[A-Z]{2,3}$/;

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

type Body = Readonly<Record<string, unknown>>;

export interface CardFields {
  name: string;
  logo_url: string | null;
  is_active: boolean;
  sort_order: number;
}

export type CardChanges = Partial<CardFields>;

export interface CountryFields {
  country_code: string;
  country_name: string;
  currency_symbol: string;
  is_active: boolean;
}

export interface NewCountry extends CountryFields {
  card_id: string;
}

export type CountryChanges = Partial<CountryFields>;

export interface FieldDiff<T> {
  fields: Array<keyof T & string>;
  before: Record<string, unknown>;
  after: Partial<T>;
}

function refuse<T>(message: string): Checked<T> {
  return { ok: false, message };
}

function accept<T>(value: T): Checked<T> {
  return { ok: true, value };
}

export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function readId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return isUuid(id) ? id : null;
}

export function normalizeCountryCode(value: unknown): string {
  return cleanText(value).toUpperCase();
}

export function cardNameProblem(name: string): string | null {
  if (!name) return 'Enter a brand name.';
  if (name.length > CARD_NAME_MAX) return `Brand names can be at most ${CARD_NAME_MAX} characters.`;
  return null;
}

export function countryNameProblem(name: string): string | null {
  if (!name) return 'Enter the country name.';
  if (name.length > COUNTRY_NAME_MAX) return `Country names can be at most ${COUNTRY_NAME_MAX} characters.`;
  return null;
}

export function countryCodeProblem(code: string): string | null {
  return COUNTRY_CODE.test(code) ? null : 'Use a two- or three-letter country code.';
}

export function currencySymbolProblem(symbol: string): string | null {
  if (!symbol) return 'Enter the currency symbol.';
  if (symbol.length > CURRENCY_SYMBOL_MAX) {
    return `Currency symbols can be at most ${CURRENCY_SYMBOL_MAX} characters.`;
  }
  return null;
}

export function readLogoUrl(value: unknown): string | null {
  const text = cleanText(value);
  return text === '' ? null : text;
}

export function logoUrlProblem(url: string | null): string | null {
  if (!url) return null;
  if (url.length > LOGO_URL_MAX) return `The logo address can be at most ${LOGO_URL_MAX} characters.`;
  if (!/^https:\/\//.test(url)) return 'The logo address must start with https://.';
  return null;
}

export function logoExtension(fileName: string): string {
  return (fileName.split('.').pop() || '').toLowerCase();
}

export function logoFileProblem(fileName: string, size: number): string | null {
  if (!fileName.includes('.') || !LOGO_EXTENSIONS.includes(logoExtension(fileName))) {
    return `Choose a ${LOGO_EXTENSIONS.join(', ')} image.`;
  }
  if (size > MAX_UPLOAD_BYTES) return `Logos can be at most ${LOGO_MAX_MB} MB.`;
  return null;
}

export function clampSortOrder(value: unknown): number {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(SORT_ORDER_MAX, number));
}

export function readFlag(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === false) return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0' || value === '') return false;
  return Boolean(value);
}

export function sameBrandName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function findBrandNamed<T extends { id: string; name: string | null }>(
  rows: ReadonlyArray<T>,
  name: string,
  exceptId: string | null = null,
): T | null {
  const clean = name.trim();
  if (!clean) return null;
  return rows.find((row) => row.id !== exceptId && sameBrandName(row.name ?? '', clean)) ?? null;
}

function checkName(value: unknown): Checked<string> {
  const name = cleanText(value);
  const problem = cardNameProblem(name);
  return problem ? refuse(problem) : accept(name);
}

function checkLogo(value: unknown): Checked<string | null> {
  const url = readLogoUrl(value);
  const problem = logoUrlProblem(url);
  return problem ? refuse(problem) : accept(url);
}

function checkCode(value: unknown): Checked<string> {
  const code = normalizeCountryCode(value);
  const problem = countryCodeProblem(code);
  return problem ? refuse(problem) : accept(code);
}

function checkCountryName(value: unknown): Checked<string> {
  const name = cleanText(value);
  const problem = countryNameProblem(name);
  return problem ? refuse(problem) : accept(name);
}

function checkSymbol(value: unknown): Checked<string> {
  const symbol = cleanText(value);
  const problem = currencySymbolProblem(symbol);
  return problem ? refuse(problem) : accept(symbol);
}

export function checkCardCreate(body: Body): Checked<CardFields> {
  const name = checkName(body.name);
  if (!name.ok) return name;
  const logo = checkLogo(body.logo_url);
  if (!logo.ok) return logo;
  return accept({
    name: name.value,
    logo_url: logo.value,
    is_active: readFlag(body.is_active, true),
    sort_order: clampSortOrder(body.sort_order),
  });
}

export function checkCardPatch(body: Body): Checked<CardChanges> {
  const changes: CardChanges = {};
  if (body.name !== undefined) {
    const name = checkName(body.name);
    if (!name.ok) return name;
    changes.name = name.value;
  }
  if (body.logo_url !== undefined) {
    const logo = checkLogo(body.logo_url);
    if (!logo.ok) return logo;
    changes.logo_url = logo.value;
  }
  if (body.is_active !== undefined) changes.is_active = readFlag(body.is_active, false);
  if (body.sort_order !== undefined) changes.sort_order = clampSortOrder(body.sort_order);
  return accept(changes);
}

export function checkCountryCreate(body: Body): Checked<NewCountry> {
  const cardId = readId(body.card_id);
  if (!cardId) return refuse('Choose the brand to add this country to.');
  const code = checkCode(body.country_code);
  if (!code.ok) return code;
  const name = checkCountryName(body.country_name);
  if (!name.ok) return name;
  const symbol = checkSymbol(body.currency_symbol);
  if (!symbol.ok) return symbol;
  return accept({
    card_id: cardId,
    country_code: code.value,
    country_name: name.value,
    currency_symbol: symbol.value,
    is_active: readFlag(body.is_active, true),
  });
}

export function checkCountryPatch(body: Body): Checked<CountryChanges> {
  const changes: CountryChanges = {};
  if (body.country_code !== undefined) {
    const code = checkCode(body.country_code);
    if (!code.ok) return code;
    changes.country_code = code.value;
  }
  if (body.country_name !== undefined) {
    const name = checkCountryName(body.country_name);
    if (!name.ok) return name;
    changes.country_name = name.value;
  }
  if (body.currency_symbol !== undefined) {
    const symbol = checkSymbol(body.currency_symbol);
    if (!symbol.ok) return symbol;
    changes.currency_symbol = symbol.value;
  }
  if (body.is_active !== undefined) changes.is_active = readFlag(body.is_active, false);
  return accept(changes);
}

export function diffFields<T extends object>(current: Readonly<Record<string, unknown>>, changes: T): FieldDiff<T> {
  const fields = (Object.keys(changes) as Array<keyof T & string>).filter(
    (field) => changes[field] !== undefined && (current[field] ?? null) !== changes[field],
  );
  const before: Record<string, unknown> = {};
  const after: Partial<T> = {};
  for (const field of fields) {
    before[field] = current[field] ?? null;
    after[field] = changes[field];
  }
  return { fields, before, after };
}

export type ReorderIds = { ok: true; ids: string[] } | { ok: false; message: string };

export function readReorderIds(raw: unknown): ReorderIds {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: 'Send every brand id in its new order.' };
  }
  if (raw.length > REORDER_MAX) {
    return { ok: false, message: `At most ${REORDER_MAX} brands can be ordered at once.` };
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const id = readId(value);
    if (!id) return { ok: false, message: 'Every brand id in the new order must be a valid id.' };
    if (seen.has(id)) return { ok: false, message: 'A brand appears more than once in the new order.' };
    seen.add(id);
    ids.push(id);
  }
  return { ok: true, ids };
}
