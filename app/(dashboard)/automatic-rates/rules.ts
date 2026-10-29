import { ERROR_MESSAGE, isUuid, type ApiErrorCode } from '../../lib/http';
import type { EdgeAnswer } from '../../lib/edge';
import { BUSINESS_TZ_LABEL, formatBusinessDateTime } from '../../lib/time';
import { RATE_MAX } from '../rates/rateRules';

export const RATE_SYNC_FUNCTION = 'sync-provider-rates';
export const STATUS_EDGE_TIMEOUT_MS = 15000;
export const RUN_EDGE_TIMEOUT_MS = 50000;
export const RUN_REQUEST_TIMEOUT_MS = 65000;
export const MAX_LINK_CHANGES = 500;
export const PERCENT_MIN = -90;
export const PERCENT_MAX = 100;
export const RATE_MAX_KOBO = RATE_MAX * 100;
export const INTERVAL_OPTIONS = [15, 30, 60, 120, 180, 360, 720, 1440] as const;
export const PROVIDER_ID = /^[a-z][a-z0-9_]{1,31}$/;
export const RUN_ACTIONS = ['run', 'products'] as const;
export const SETTING_KEYS = ['rate_provider', 'interval_minutes', 'universal_markup_pct'] as const;
export const SQL_SETTING_KEYS: Readonly<Record<SettingKey, string>> = {
  rate_provider: 'provider',
  interval_minutes: 'interval_minutes',
  universal_markup_pct: 'universal_markup_pct',
};

export type IntervalMinutes = (typeof INTERVAL_OPTIONS)[number];
export type RunAction = (typeof RUN_ACTIONS)[number];
export type SettingKey = (typeof SETTING_KEYS)[number];
export type SettingValue = string | number | null;

export const PERCENT_MESSAGE = 'Enter a percentage from −90% to 100% with at most 2 decimal places.';
export const EXPECTED_MESSAGE = 'expected must map each setting to the value you last saw.';

export const TEXT = {
  heading: 'Automatic Rates',
  hint: 'Linked card types get their ranges and rates from a rate provider on a schedule, plus an extra percentage. Card types that are not linked stay manual. Times are WAT.',
  loadFailed: 'Automatic rates could not be loaded',
  statusFailed: 'The automatic rate status could not be read.',
  settingsFailed: 'The automatic rate settings could not be read.',
  cardsFailed: 'The card types and their links could not be loaded. Try again.',
  conflictOn: 'Someone else turned automatic rates on after you loaded this page, so nothing was changed.',
  conflictOff: 'Someone else turned automatic rates off after you loaded this page, so nothing was changed.',
  switchNoProvider: 'Choose a rate provider first, so automatic rates were not turned on.',
  switchNoLinks: 'Link at least one card type first, so automatic rates were not turned on.',
  switchUnconfirmed: 'The change could not be confirmed. Reload the page to check whether automatic rates are on before trying again.',
  switchBody: 'Send enabled and expected as true or false.',
  settingsChanged: 'These settings changed after you loaded them, so nothing was saved.',
  settingsTurnOffFirst: 'Turn off automatic rates before changing the rate provider, so nothing was saved.',
  settingsNotSaved: 'The settings could not be saved. Reload to check the live values before trying again.',
  settingsNoChanges: 'No changes were sent.',
  linksNoChanges: 'No changes provided.',
  linksTooMany: `Save at most ${MAX_LINK_CHANGES} links at a time.`,
  linksInvalid: 'These links are not valid, so nothing was saved.',
  linksUnknownProduct: 'That product is not in the latest product list. Load products again and choose it from the list.',
  linksTypeInactive: 'That card type is switched off. Switch it on in Cards before linking it.',
  linksTypeMissing: 'That card type no longer exists.',
  linksNoSymbol: 'That country has no currency symbol. Add one in Cards before linking.',
  linksConflict: 'Someone else changed this link after you loaded the page, so nothing was saved.',
  linksNoProvider: 'Choose a rate provider first, so nothing was linked.',
  linksNotSaved: 'The link could not be confirmed. Reload the page to check it before trying again.',
  markupConflict: 'Someone else changed this card’s extra percentage after you loaded the page, so nothing was saved.',
  markupCardMissing: 'That card no longer exists.',
  markupCard: 'Choose a valid card.',
  markupExpected: 'expected must be the extra percentage you last saw.',
  markupNotSaved: 'The extra percentage could not be confirmed. Reload the page to check it before trying again.',
  cardsBody: 'Invalid type. Use links or markup.',
  runBody: 'Send action run or products.',
  runOff: 'Automatic rates are off, so nothing was updated.',
  runNoProvider: 'No rate provider is chosen, so nothing was updated.',
  runBusy: 'An update is already running. The status shows when it finishes.',
  runNoLinks: 'No card types are linked, so nothing was updated.',
  runAdapterMissing: 'The rate provider is not set up on the server, so nothing was updated.',
  runSecretsMissing: 'The rate provider’s keys are not set on the server, so nothing was updated.',
  runAdapterError: 'An error on our side stopped the update, so rates stay as they were. Try again in a few minutes.',
  runWebOnly: 'Rates can only be updated from the web console.',
  runRateLimited: 'You can start at most 20 updates or product loads an hour. Try again later.',
  runNotSetUp: 'Updating rates is not set up on the server, so nothing was changed.',
  runNotChecked: 'The server could not check this request, so nothing was changed. Try again.',
  runRefused: 'The update service refused this request, so nothing was changed.',
  runUnknown: 'No answer came back, so the update may or may not have run. The status below shows the last finished update.',
} as const;

export interface RateProvider {
  id: string;
  label: string;
  missingSecrets: string[];
}

export interface UnpricedType {
  cardTypeId: string;
  reason: string;
  listed: boolean;
}

export interface ApplySummary {
  lines: number;
  linked: number;
  priced: number;
  unpriced: UnpricedType[];
  created: number;
  updated: number;
  relabelled: number;
  reactivated: number;
  deactivated: number;
  unchanged: number;
}

export type OffCause = 'provider' | 'percentage' | 'currency';

export interface ProductsSummary {
  lines: number;
  usable: number;
}

export type PercentCheck = { ok: true; value: number; hundredths: number } | { ok: false; message: string };

export type Refusal = { ok: false; code: ApiErrorCode; message: string; details: Record<string, unknown> | null };

export type ServiceFailure = 'unreachable' | 'unreadable' | 'session' | 'web_only' | 'forbidden' | 'not_set_up' | 'not_checked';

export type ServiceContext = 'check' | 'turn_on' | 'provider';

export type ProvidersReply = { ok: true; providers: RateProvider[] } | { ok: false; failure: ServiceFailure };

export type RunReply =
  | { ok: true; mode: 'apply'; runId: string; summary: ApplySummary }
  | { ok: true; mode: 'products'; runId: string; summary: ProductsSummary }
  | Refusal;

export interface LinkChange {
  card_type_id: string;
  provider_ref: string | null;
  expected_ref: string | null;
}

export interface MarkupRequest {
  cardId: string;
  pct: number | null;
  expected: number | null;
}

export interface SettingsRequest {
  changes: Record<string, SettingValue>;
  expected: Record<string, SettingValue>;
  keys: SettingKey[];
}

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

export interface DueStatus {
  enabled: boolean;
  nextDueAt: string | null;
}

const PERCENT_TEXT = /^([+\-−])?\s*(\d+(?:\.\d+)?|\.\d+)\s*%?$/;
const MINUS = '−';
const SESSION_CODES: ReadonlySet<string> = new Set(['no_token', 'bad_token', 'inactive', 'token_revoked', 'session_ended']);
const CHECK_CODES: ReadonlySet<string> = new Set(['lookup_failed', 'db_error', 'invalid_request', 'too_large']);
const NOT_AUTHORIZED = /Not authorized/;
const COUNT = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });
const NAIRA = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DUE_NOW_MS = 600_000;

const RUN_ERRORS: Readonly<Record<string, string>> = {
  answer_not_a_list: 'its answer was not in the expected shape',
  answer_bad_line: 'its answer was not in the expected shape',
  answer_empty: 'it returned no rates',
  answer_too_long: 'it returned more than 2,000 products',
  answer_duplicate_ref: 'it listed the same product twice',
  no_linked_products: 'none of the linked products were in its answer',
  timed_out: 'the update did not finish within 3 minutes',
  turned_off: 'automatic rates were turned off while it ran',
  provider_changed: 'the rate provider was changed while it ran',
  not_running: 'the update had already been closed',
  adapter_missing: 'the server has no connection set up for this provider',
  adapter_error: 'an error on our side stopped it',
  apply_error: 'an error on our side stopped it',
};

const UNPRICED_REASONS: Readonly<Record<string, string>> = {
  missing: 'not in the provider’s latest list',
  no_bands: 'the provider listed no ranges',
  too_many_bands: 'the provider listed more than 50 ranges',
  band_not_valid: 'a range from the provider is not valid',
  rate_not_valid: 'a rate from the provider is not valid',
  bands_overlap: 'the provider’s ranges overlap (both ends of a range are included, so ranges that share an end value overlap)',
  markup_out_of_range: 'the extra percentage makes a rate ₦0.00 or less, or more than ₦100,000.00',
  no_currency_symbol: 'its country has no currency symbol',
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function owns(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function refusal(code: ApiErrorCode, message: string, details: Record<string, unknown> | null = null): Refusal {
  return { ok: false, code, message, details };
}

function plural(count: number, one: string, many: string): string {
  return `${COUNT.format(count)} ${count === 1 ? one : many}`;
}

export function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function isInterval(value: unknown): value is IntervalMinutes {
  return typeof value === 'number' && (INTERVAL_OPTIONS as readonly number[]).includes(value);
}

export function intervalLabel(minutes: IntervalMinutes): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export function everyInterval(minutes: IntervalMinutes): string {
  return minutes === 60 ? 'every hour' : `every ${intervalLabel(minutes)}`;
}

export function stamp(at: string): string {
  return `${formatBusinessDateTime(at)} ${BUSINESS_TZ_LABEL}`;
}

export function lateBy(status: DueStatus, now: number): number | null {
  return status.enabled && status.nextDueAt !== null ? now - Date.parse(status.nextDueAt) : null;
}

export function dueNow(status: DueStatus & { running: object | null }, now: number): boolean {
  const late = lateBy(status, now);
  return late !== null && status.running === null && late > 0 && late < DUE_NOW_MS;
}

export function overdue(status: DueStatus, now: number): boolean {
  const late = lateBy(status, now);
  return late !== null && late >= DUE_NOW_MS;
}

export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function hundredthsOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const scaled = Math.round(value * 100);
  if (Math.abs(value * 100 - scaled) > 1e-6) return null;
  return scaled === 0 ? 0 : scaled;
}

export function readPct(value: unknown): number | null {
  const hundredths = hundredthsOf(value);
  if (hundredths === null || hundredths < PERCENT_MIN * 100 || hundredths > PERCENT_MAX * 100) return null;
  return hundredths / 100;
}

export function parsePercent(raw: unknown): PercentCheck {
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, message: PERCENT_MESSAGE };
    text = String(raw);
  } else if (typeof raw === 'string') {
    text = raw.trim();
  } else {
    return { ok: false, message: PERCENT_MESSAGE };
  }
  const match = PERCENT_TEXT.exec(text);
  if (!match) return { ok: false, message: PERCENT_MESSAGE };
  const [whole, fraction = ''] = match[2].split('.');
  if (fraction.length > 2) return { ok: false, message: PERCENT_MESSAGE };
  const magnitude = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
  const hundredths = match[1] === '-' || match[1] === MINUS ? -magnitude : magnitude;
  if (!Number.isSafeInteger(hundredths) || hundredths < PERCENT_MIN * 100 || hundredths > PERCENT_MAX * 100) {
    return { ok: false, message: PERCENT_MESSAGE };
  }
  const normalized = hundredths === 0 ? 0 : hundredths;
  return { ok: true, value: normalized / 100, hundredths: normalized };
}

export function pctText(value: number): string {
  const hundredths = Math.round(value * 100);
  const abs = Math.abs(hundredths);
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  const fraction = rest === 0 ? '' : `.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
  return `${hundredths < 0 ? '-' : ''}${whole}${fraction}`;
}

export function formatPct(value: number): string {
  const hundredths = Math.round(value * 100);
  const body = `${pctText(Math.abs(hundredths) / 100)}%`;
  if (hundredths === 0) return body;
  return hundredths < 0 ? `${MINUS}${body}` : `+${body}`;
}

export function koboOf(rate: unknown): number | null {
  return hundredthsOf(rate);
}

export function appliedKobo(rateKobo: number, hundredths: number): number {
  return Math.floor((rateKobo * (10000 + hundredths) + 5000) / 10000);
}

export function isValidKobo(kobo: number): boolean {
  return Number.isSafeInteger(kobo) && kobo > 0 && kobo <= RATE_MAX_KOBO;
}

export function nairaText(kobo: number): string {
  const text = NAIRA.format(Math.abs(kobo) / 100);
  return kobo < 0 ? `${MINUS}₦${text}` : `₦${text}`;
}

export function runErrorText(code: string): string {
  const known = Object.prototype.hasOwnProperty.call(RUN_ERRORS, code) ? RUN_ERRORS[code] : null;
  if (known) return known;
  const secrets = /^secrets_missing (.+)$/.exec(code);
  if (secrets) return `the provider’s keys are not set on the server (${secrets[1].split(',').join(', ')})`;
  return `the provider could not be read (${code})`;
}

export function unpricedReasonText(reason: string): string {
  return Object.prototype.hasOwnProperty.call(UNPRICED_REASONS, reason) ? UNPRICED_REASONS[reason] : `of an unknown reason (${reason})`;
}

export function offCause(reason: string): OffCause {
  if (reason === 'markup_out_of_range') return 'percentage';
  if (reason === 'no_currency_symbol') return 'currency';
  return 'provider';
}

type SummaryCounts = Pick<ApplySummary, 'created' | 'updated' | 'relabelled' | 'reactivated' | 'deactivated'>;

export function summaryText(summary: SummaryCounts): string | null {
  const parts: string[] = [];
  if (summary.updated > 0) parts.push(plural(summary.updated, 'rate changed', 'rates changed'));
  if (summary.created > 0) parts.push(plural(summary.created, 'range added', 'ranges added'));
  if (summary.reactivated > 0) parts.push(plural(summary.reactivated, 'range switched back on', 'ranges switched back on'));
  if (summary.deactivated > 0) parts.push(plural(summary.deactivated, 'range switched off', 'ranges switched off'));
  if (summary.relabelled > 0) parts.push(plural(summary.relabelled, 'range label updated', 'range labels updated'));
  return parts.length > 0 ? joinWords(parts) : null;
}

export function ratesMoved(summary: SummaryCounts): boolean {
  return summary.updated + summary.created + summary.reactivated + summary.deactivated > 0;
}

export function relabelledText(count: number): string {
  return count === 1 ? '1 range label was updated.' : `${COUNT.format(count)} range labels were updated.`;
}

export function listedOff(summary: ApplySummary): UnpricedType[] {
  return summary.unpriced.filter((entry) => entry.listed);
}

const OFF_CAUSES: readonly OffCause[] = ['provider', 'percentage', 'currency'];

export function typesOffText(types: readonly UnpricedType[], noun: 'card type' | 'linked card type'): string {
  const counts: Record<OffCause, number> = { provider: 0, percentage: 0, currency: 0 };
  for (const entry of types) counts[offCause(entry.reason)] += 1;
  const parts: string[] = [];
  for (const cause of OFF_CAUSES) {
    const count = counts[cause];
    if (count === 0) continue;
    const named = plural(count, noun, `${noun}s`);
    if (cause === 'provider') {
      parts.push(`${named} got no usable rates and ${count === 1 ? 'was' : 'were'} switched off.`);
    } else if (cause === 'percentage') {
      parts.push(`The extra percentage would make a rate ₦0.00 or less, or more than ₦100,000.00, for ${named}, so their ranges were switched off.`);
    } else {
      parts.push(`No currency symbol is set in Cards for the country of ${named}, so their ranges were switched off.`);
    }
  }
  return parts.join(' ');
}

function readUnpriced(value: unknown): UnpricedType[] | null {
  if (!Array.isArray(value)) return null;
  const out: UnpricedType[] = [];
  for (const item of value) {
    const entry = record(item);
    if (!entry || !isUuid(entry.card_type_id) || typeof entry.reason !== 'string' || entry.reason === ''
      || typeof entry.listed !== 'boolean') return null;
    out.push({ cardTypeId: entry.card_type_id.toLowerCase(), reason: entry.reason, listed: entry.listed });
  }
  return out;
}

export function readApplySummary(value: unknown): ApplySummary | null {
  const body = record(value);
  if (!body) return null;
  const counts = ['lines', 'linked', 'priced', 'created', 'updated', 'relabelled', 'reactivated', 'deactivated', 'unchanged'] as const;
  if (!counts.every((key) => isCount(body[key]))) return null;
  const unpriced = readUnpriced(body.unpriced);
  if (!unpriced) return null;
  return {
    lines: body.lines as number,
    linked: body.linked as number,
    priced: body.priced as number,
    unpriced,
    created: body.created as number,
    updated: body.updated as number,
    relabelled: body.relabelled as number,
    reactivated: body.reactivated as number,
    deactivated: body.deactivated as number,
    unchanged: body.unchanged as number,
  };
}

export function applySummaryJson(summary: ApplySummary): Record<string, unknown> {
  return {
    lines: summary.lines,
    linked: summary.linked,
    priced: summary.priced,
    unpriced: summary.unpriced.map((entry) => ({ card_type_id: entry.cardTypeId, reason: entry.reason, listed: entry.listed })),
    created: summary.created,
    updated: summary.updated,
    relabelled: summary.relabelled,
    reactivated: summary.reactivated,
    deactivated: summary.deactivated,
    unchanged: summary.unchanged,
  };
}

export function readProductsSummary(value: unknown): ProductsSummary | null {
  const body = record(value);
  if (!body || !isCount(body.lines) || !isCount(body.usable) || body.usable > body.lines) return null;
  return { lines: body.lines, usable: body.usable };
}

export function toProviderList(value: unknown): RateProvider[] | null {
  if (!Array.isArray(value)) return null;
  const out: RateProvider[] = [];
  for (const item of value) {
    const entry = record(item);
    if (!entry || typeof entry.id !== 'string' || !PROVIDER_ID.test(entry.id)) return null;
    if (typeof entry.label !== 'string' || entry.label.trim() === '') return null;
    const missing = entry.missing_secrets;
    if (!Array.isArray(missing) || !missing.every((name) => typeof name === 'string' && name !== '')) return null;
    if (out.some((known) => known.id === entry.id)) return null;
    out.push({ id: entry.id, label: entry.label.trim(), missingSecrets: [...missing] as string[] });
  }
  return out;
}

export function providerJson(providers: readonly RateProvider[]) {
  return providers.map((provider) => ({ id: provider.id, label: provider.label, missing_secrets: provider.missingSecrets }));
}

export function readProviders(answer: EdgeAnswer): ProvidersReply {
  if (answer.kind === 'failed') return { ok: false, failure: 'unreachable' };
  const body = record(answer.body);
  const code = typeof body?.code === 'string' ? body.code : '';
  if (answer.status === 200) {
    const providers = body?.success === true && code === 'status' ? toProviderList(body.providers) : null;
    return providers ? { ok: true, providers } : { ok: false, failure: 'unreadable' };
  }
  if (SESSION_CODES.has(code)) return { ok: false, failure: 'session' };
  if (code === 'wrong_client') return { ok: false, failure: 'web_only' };
  if (code === 'forbidden') return { ok: false, failure: 'forbidden' };
  if (code === 'not_authorized') return { ok: false, failure: 'not_set_up' };
  if (CHECK_CODES.has(code)) return { ok: false, failure: 'not_checked' };
  return { ok: false, failure: answer.status >= 500 ? 'unreachable' : 'not_set_up' };
}

const SERVICE_SUFFIX: Readonly<Record<ServiceContext, string>> = {
  check: '',
  turn_on: ', so automatic rates were not turned on',
  provider: ', so the provider was not changed',
};

const SERVICE_WEB_ONLY: Readonly<Record<ServiceContext, string>> = {
  check: 'The rate service can only be checked from the web console.',
  turn_on: 'Automatic rates can only be turned on from the web console.',
  provider: 'The rate provider can only be changed from the web console.',
};

export function serviceRefusal(failure: ServiceFailure, context: ServiceContext): Refusal {
  const suffix = SERVICE_SUFFIX[context];
  switch (failure) {
    case 'unreachable':
      return refusal('PROVIDER_ERROR', `The rate service could not be reached${suffix}. Try again in a few minutes.`);
    case 'unreadable':
      return refusal('PROVIDER_ERROR', `The rate service sent an answer that could not be read${suffix}. Try again in a few minutes.`);
    case 'session':
      return refusal('AUTH_REQUIRED', ERROR_MESSAGE.AUTH_REQUIRED);
    case 'web_only':
      return refusal('PERMISSION_DENIED', SERVICE_WEB_ONLY[context]);
    case 'forbidden':
      return refusal('PERMISSION_DENIED', ERROR_MESSAGE.PERMISSION_DENIED, { required: ['rates.read'] });
    case 'not_set_up':
      return refusal('PROVIDER_ERROR', `Automatic rates are not set up on the server${suffix}.`);
    case 'not_checked':
      return refusal('INTERNAL_ERROR', `The server could not check this request${suffix}. Try again.`);
  }
}

export function webOnlyText(context: ServiceContext): string {
  return SERVICE_WEB_ONLY[context];
}

export function secretsText(names: readonly string[]): string {
  return names.join(', ');
}

export function providerRefusal(
  providers: readonly RateProvider[],
  id: string,
  context: 'turn_on' | 'provider',
): Refusal | null {
  const entry = providers.find((provider) => provider.id === id);
  if (!entry) {
    return refusal('STATE_CONFLICT', context === 'turn_on'
      ? `The rate provider “${id}” is not set up on the server, so automatic rates were not turned on.`
      : `The rate provider “${id}” is not set up on the server, so nothing was saved.`, { reason: 'adapter_missing' });
  }
  if (context === 'turn_on' && entry.missingSecrets.length > 0) {
    return refusal(
      'STATE_CONFLICT',
      `The rate provider’s keys are not set on the server (${secretsText(entry.missingSecrets)}), so automatic rates were not turned on.`,
      { reason: 'secrets_missing', missing: entry.missingSecrets },
    );
  }
  return null;
}

export function unknownRun(): Refusal {
  return refusal('INTERNAL_ERROR', TEXT.runUnknown, { outcome_unknown: true });
}

export function readRunAnswer(answer: EdgeAnswer): RunReply {
  if (answer.kind === 'failed') return unknownRun();
  const body = record(answer.body);
  const code = typeof body?.code === 'string' ? body.code : '';
  const runId = typeof body?.run_id === 'string' && isUuid(body.run_id) ? body.run_id.toLowerCase() : null;
  if (answer.status === 200) {
    if (body?.success !== true || runId === null) return unknownRun();
    if (code === 'applied') {
      const summary = readApplySummary(body.summary);
      return summary ? { ok: true, mode: 'apply', runId, summary } : unknownRun();
    }
    if (code === 'products_loaded') {
      const summary = readProductsSummary(body.summary);
      return summary ? { ok: true, mode: 'products', runId, summary } : unknownRun();
    }
    return unknownRun();
  }
  const run = runId ? { run_id: runId } : {};
  if (SESSION_CODES.has(code)) return refusal('AUTH_REQUIRED', ERROR_MESSAGE.AUTH_REQUIRED);
  switch (code) {
    case 'wrong_client':
      return refusal('PERMISSION_DENIED', TEXT.runWebOnly);
    case 'forbidden':
      return refusal('PERMISSION_DENIED', ERROR_MESSAGE.PERMISSION_DENIED, { required: ['rates.write'] });
    case 'rate_limited':
      return refusal('RATE_LIMITED', TEXT.runRateLimited);
    case 'not_authorized':
      return refusal('PROVIDER_ERROR', TEXT.runNotSetUp);
    case 'off':
      return refusal('STATE_CONFLICT', TEXT.runOff, { reason: code });
    case 'no_provider':
      return refusal('STATE_CONFLICT', TEXT.runNoProvider, { reason: code });
    case 'busy':
      return refusal('STATE_CONFLICT', TEXT.runBusy, { reason: code });
    case 'no_links':
      return refusal('STATE_CONFLICT', TEXT.runNoLinks, { reason: code });
    case 'adapter_missing':
      return refusal('PROVIDER_ERROR', TEXT.runAdapterMissing, { reason: code, ...run });
    case 'secrets_missing': {
      const missing = Array.isArray(body?.missing) && body.missing.every((name) => typeof name === 'string' && name !== '')
        ? (body.missing as string[])
        : null;
      if (!missing || missing.length === 0) return refusal('PROVIDER_ERROR', TEXT.runSecretsMissing, { reason: code, ...run });
      return refusal(
        'PROVIDER_ERROR',
        `The rate provider’s keys are not set on the server (${secretsText(missing)}), so nothing was updated.`,
        { reason: code, missing, ...run },
      );
    }
    case 'provider_failed': {
      const error = typeof body?.error === 'string' && body.error.trim() !== '' ? body.error.trim() : null;
      if (error === null) return unknownRun();
      if (error === 'adapter_error') return refusal('PROVIDER_ERROR', TEXT.runAdapterError, { reason: code, error, ...run });
      return refusal(
        'PROVIDER_ERROR',
        `The rate provider could not be read (${error}), so rates stay as they were. Try again in a few minutes.`,
        { reason: code, error, ...run },
      );
    }
    case 'refused': {
      const reason = typeof body?.reason === 'string' && body.reason !== '' ? body.reason : null;
      return refusal(
        'STATE_CONFLICT',
        reason === null
          ? 'The rate provider’s answer could not be used, so rates stay as they were.'
          : `The rate provider’s answer could not be used because ${runErrorText(reason)}, so rates stay as they were.`,
        { reason: code, error: reason, ...run },
      );
    }
  }
  if (CHECK_CODES.has(code)) return refusal('INTERNAL_ERROR', TEXT.runNotChecked);
  if (answer.status >= 400 && answer.status < 500) return refusal('PROVIDER_ERROR', TEXT.runRefused);
  return unknownRun();
}

export function readRunAction(body: unknown): Checked<RunAction> {
  const value = record(body);
  const action = value?.action;
  return typeof action === 'string' && (RUN_ACTIONS as readonly string[]).includes(action)
    ? { ok: true, value: action as RunAction }
    : { ok: false, message: TEXT.runBody };
}

export function readSwitchBody(body: unknown): Checked<{ enabled: boolean; expected: boolean }> {
  const value = record(body);
  if (!value || typeof value.enabled !== 'boolean' || typeof value.expected !== 'boolean') {
    return { ok: false, message: TEXT.switchBody };
  }
  return { ok: true, value: { enabled: value.enabled, expected: value.expected } };
}

export function readSettingValue(key: SettingKey, raw: unknown): { ok: true; value: SettingValue } | { ok: false } {
  if (key === 'rate_provider') {
    if (typeof raw !== 'string') return { ok: false };
    const id = raw.trim();
    if (id === '') return { ok: true, value: null };
    return PROVIDER_ID.test(id) ? { ok: true, value: id } : { ok: false };
  }
  if (key === 'interval_minutes') {
    const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
    if (!/^\d{1,4}$/.test(text)) return { ok: false };
    const minutes = Number(text);
    return isInterval(minutes) ? { ok: true, value: minutes } : { ok: false };
  }
  const checked = parsePercent(raw);
  return checked.ok ? { ok: true, value: checked.value } : { ok: false };
}

export function invalidSetting(key: string): string {
  return `Invalid value for ${key}`;
}

export function readSettingsRequest(body: unknown): Checked<SettingsRequest> {
  const value = record(body);
  const changes = value ? record(value.changes) : null;
  if (!changes || Object.keys(changes).length === 0) return { ok: false, message: TEXT.settingsNoChanges };
  const expected = record(value?.expected);
  const out: SettingsRequest = { changes: {}, expected: {}, keys: [] };
  for (const key of Object.keys(changes)) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) return { ok: false, message: invalidSetting(key) };
    const setting = key as SettingKey;
    const next = readSettingValue(setting, changes[key]);
    if (!next.ok) return { ok: false, message: invalidSetting(key) };
    if (!expected || !owns(expected, key)) return { ok: false, message: EXPECTED_MESSAGE };
    const seen = readSettingValue(setting, expected[key]);
    if (!seen.ok) return { ok: false, message: EXPECTED_MESSAGE };
    const sqlKey = SQL_SETTING_KEYS[setting];
    out.changes[sqlKey] = next.value;
    out.expected[sqlKey] = seen.value;
    out.keys.push(setting);
  }
  return { ok: true, value: out };
}

export function consoleSettingKey(sqlKey: unknown): string {
  const match = SETTING_KEYS.find((key) => SQL_SETTING_KEYS[key] === sqlKey);
  return match === undefined ? String(sqlKey) : match;
}

export function settingsConfig(value: unknown): Record<SettingKey, string> | null {
  const settings = record(value);
  if (!settings) return null;
  const provider = settings.provider;
  if (!(provider === null || (typeof provider === 'string' && PROVIDER_ID.test(provider)))) return null;
  if (!isInterval(settings.interval_minutes)) return null;
  const pct = readPct(settings.universal_markup_pct);
  if (pct === null) return null;
  return {
    rate_provider: provider === null ? '' : provider,
    interval_minutes: String(settings.interval_minutes),
    universal_markup_pct: pctText(pct),
  };
}

export function readLinksBody(body: unknown): Checked<LinkChange[]> {
  const list = record(body)?.changes;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, message: TEXT.linksNoChanges };
  if (list.length > MAX_LINK_CHANGES) return { ok: false, message: TEXT.linksTooMany };
  const seen = new Set<string>();
  const out: LinkChange[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = record(list[index]);
    const invalid = { ok: false as const, message: `Link ${index + 1} is not valid.` };
    if (!item || !isUuid(item.card_type_id)) return invalid;
    const id = item.card_type_id.toLowerCase();
    if (seen.has(id)) return { ok: false, message: `Card type ${id} appears more than once in this save.` };
    seen.add(id);
    const ref = item.provider_ref;
    if (!(ref === null || (typeof ref === 'string' && ref === ref.trim() && ref.length >= 1 && ref.length <= 128))) return invalid;
    const expected = item.expected_ref;
    if (!(expected === null || typeof expected === 'string')) return invalid;
    out.push({ card_type_id: id, provider_ref: ref, expected_ref: expected });
  }
  return { ok: true, value: out };
}

export function readMarkupBody(body: unknown): Checked<MarkupRequest> {
  const value = record(body);
  if (!value || !isUuid(value.card_id)) return { ok: false, message: TEXT.markupCard };
  const next = value.markup_pct === null ? null : parsePercent(value.markup_pct);
  if (next !== null && !next.ok) return { ok: false, message: PERCENT_MESSAGE };
  const seen = value.expected === null ? null : parsePercent(value.expected);
  if (seen !== null && !seen.ok) return { ok: false, message: TEXT.markupExpected };
  return {
    ok: true,
    value: {
      cardId: value.card_id.toLowerCase(),
      pct: next === null ? null : next.value,
      expected: seen === null ? null : seen.value,
    },
  };
}

export function rateOutOfRangeText(result: Record<string, unknown>): string {
  const label = typeof result.range_label === 'string' && result.range_label.trim() !== '' ? result.range_label.trim() : null;
  const kobo = hundredthsOf(result.rate_naira);
  const range = label === null ? 'one of the linked ranges' : label;
  return kobo === null
    ? `With that percentage, ${range} would not have a valid rate, so nothing was saved.`
    : `With that percentage, ${range} would pay ${nairaText(kobo)} per unit, which is not a valid rate, so nothing was saved.`;
}

export function isNotAuthorized(message: string): boolean {
  return NOT_AUTHORIZED.test(message);
}
