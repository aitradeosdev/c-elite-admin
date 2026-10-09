import { PAYOUT_GATEWAY_KEYS, resolvePayoutGateway, type PayoutGateway } from '../../lib/gateway';
import { formatAge } from '../../lib/time';
import { formatNaira } from '../../_ui/money';
import type { ApiBody, ApiResult } from '../../lib/apiClient';

export const PLATFORM_BALANCE_ENDPOINT = '/api/platform-balance';

export const MODE_KEY = 'platform_balance_mode';
export const STATIC_KEY = 'platform_balance_static';
export const LIVE_KEY = 'platform_balance_live';
export const LIVE_AT_KEY = 'platform_balance_live_at';
export const LIVE_ERROR_KEY = 'platform_balance_live_error';
export const GATEWAY_KEY = 'active_payment_gateway';

export const CONFIG_KEYS: readonly string[] = [MODE_KEY, STATIC_KEY, LIVE_KEY, LIVE_AT_KEY, LIVE_ERROR_KEY, GATEWAY_KEY];

export const READ_KEYS: readonly string[] = Array.from(new Set<string>([...CONFIG_KEYS, ...PAYOUT_GATEWAY_KEYS]));

export type WritableKey = typeof MODE_KEY | typeof STATIC_KEY;

export const WRITABLE_KEYS: readonly WritableKey[] = [MODE_KEY, STATIC_KEY];

export type BalanceMode = 'static' | 'live';

export const BALANCE_MODES: readonly BalanceMode[] = ['static', 'live'];

export const MODE_LABELS: Readonly<Record<BalanceMode, string>> = { static: 'Static', live: 'Live' };

export const KEY_LABELS: Readonly<Record<WritableKey, string>> = {
  [MODE_KEY]: 'balance source',
  [STATIC_KEY]: 'static amount',
};

export const PROVIDER_LABELS: Readonly<Record<PayoutGateway, string>> = {
  paystack: 'Paystack',
  monnify: 'Monnify',
  novac: 'Novac',
};

export const STATIC_MAX = 1_000_000_000_000;
export const REFRESH_INTERVAL_MINUTES = 30;
export const STALE_AFTER_MS = 65 * 60 * 1000;
export const AUDIT_ACTION = 'UPDATE_PLATFORM_BALANCE';
export const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';

export const AMOUNT_MESSAGES = {
  required: 'Enter the static amount in naira.',
  invalid: 'Enter the amount as a number of naira, like 48350000 or 48,350,000.50.',
  negative: 'The amount cannot be negative.',
  decimals: 'Use at most 2 decimal places (kobo).',
  tooLarge: 'The amount cannot be more than ₦1,000,000,000,000.00.',
} as const;

export const MODE_MESSAGE = 'Choose Static or Live as the balance source.';

const SHOWN_AMOUNT = /^\s*[0-9]+(\.[0-9]+)?\s*$/;
const PLAIN_AMOUNT = /^\d+(?:\.\d+)?$/;
const GROUPED_AMOUNT = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const CONFIG_KEY_SET: ReadonlySet<string> = new Set(CONFIG_KEYS);
const GATEWAY_KEY_SET: ReadonlySet<string> = new Set<string>(PAYOUT_GATEWAY_KEYS);
const READ_KEY_SET: ReadonlySet<string> = new Set(READ_KEYS);
const PROVIDERS: readonly PayoutGateway[] = ['paystack', 'monnify', 'novac'];
const EXPECTED_MESSAGE = 'expected must map each setting to the value you last saw.';

export type StoredValue = string | null | undefined;
export type StoredValues = Readonly<Record<string, StoredValue>>;

export type AmountCheck = { ok: true; value: string; amount: number } | { ok: false; message: string };

export type ModeCheck = { ok: true; value: BalanceMode } | { ok: false; message: string };

export interface PatchRequest {
  changes: Record<string, unknown>;
  expected: Record<string, string> | null;
}

export type PatchRequestCheck = { ok: true; request: PatchRequest } | { ok: false; message: string };

export interface PatchConflict {
  key: WritableKey;
  label: string;
  current: string | null;
}

export interface PatchPlan {
  updates: Record<string, string>;
  changed: WritableKey[];
  unchanged: WritableKey[];
  before: Record<string, string | number | null>;
  after: Record<string, string | number | null>;
  entityId: string;
}

export type PatchPlanResult =
  | { ok: true; plan: PatchPlan }
  | { ok: false; code: 'VALIDATION_ERROR'; message: string }
  | { ok: false; code: 'STATE_CONFLICT'; message: string; conflicts: PatchConflict[] };

export type BalancePayload = {
  config: Record<string, string | null>;
  config_updated_at: Record<string, string | null>;
  live_gateway: PayoutGateway;
};

export interface BalanceSnapshot {
  raw: Readonly<Record<string, string | null>>;
  updatedAt: Readonly<Record<string, string | null>>;
  gateway: PayoutGateway;
  mode: BalanceMode;
  staticText: string | null;
  staticAmount: number;
  staticValid: boolean;
  liveAmount: number;
  liveValid: boolean;
  liveAt: string | null;
  liveError: string | null;
  shownAmount: number;
}

export type LiveIssueKind = 'failed' | 'never' | 'invalid' | 'stale';

export interface LiveIssue {
  kind: LiveIssueKind;
  title: string;
  message: string;
}

export interface SaveReceipt {
  changed: string[] | null;
  applied: Record<string, string>;
  auditRecorded: boolean;
  warning: string | null;
}

export type SaveOutcome =
  | { kind: 'done'; receipt: SaveReceipt }
  | { kind: 'conflict'; message: string }
  | { kind: 'denied'; message: string }
  | { kind: 'expired' }
  | { kind: 'unknown'; message: string }
  | { kind: 'refused'; message: string };

export interface SavePayload {
  changes: Record<string, string>;
  expected: Record<string, string>;
}

export interface StaticDraft {
  text: string;
  base: string | null;
}

export type WorkPhase = 'checking' | 'confirming' | 'saving';

export type Working =
  | { kind: 'mode'; target: BalanceMode; phase: WorkPhase }
  | { kind: 'static'; phase: WorkPhase };

export interface SourceChoice {
  value: BalanceMode;
  pending: BalanceMode | null;
  locked: boolean;
}

export type Magnitude = 'larger' | 'smaller' | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function owns(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function instant(value: unknown): string | null {
  const raw = text(value);
  return raw !== null && Number.isFinite(Date.parse(raw)) ? raw : null;
}

function storedOrNull(value: StoredValue): string | null {
  return typeof value === 'string' ? value : null;
}

export function isProvider(value: unknown): value is PayoutGateway {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

export function effectiveMode(raw: StoredValue): BalanceMode {
  return raw === 'live' ? 'live' : 'static';
}

export function isShownAmount(raw: StoredValue): boolean {
  return typeof raw === 'string' && SHOWN_AMOUNT.test(raw);
}

export function shownAmount(raw: StoredValue): number {
  if (typeof raw !== 'string' || !SHOWN_AMOUNT.test(raw)) return 0;
  const amount = Number(raw.trim());
  return Number.isFinite(amount) ? amount : 0;
}

export function displayedBalance(values: StoredValues): number {
  return effectiveMode(values[MODE_KEY]) === 'live' ? shownAmount(values[LIVE_KEY]) : shownAmount(values[STATIC_KEY]);
}

export function checkStaticAmount(raw: unknown): AmountCheck {
  let value: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, message: AMOUNT_MESSAGES.invalid };
    value = String(raw);
  } else if (typeof raw === 'string') {
    value = raw.trim().replace(/^₦\s*/, '');
  } else {
    return { ok: false, message: raw === null || raw === undefined ? AMOUNT_MESSAGES.required : AMOUNT_MESSAGES.invalid };
  }
  if (value === '') return { ok: false, message: AMOUNT_MESSAGES.required };
  if (/^[-−]/.test(value)) return { ok: false, message: AMOUNT_MESSAGES.negative };
  if (!PLAIN_AMOUNT.test(value) && !GROUPED_AMOUNT.test(value)) return { ok: false, message: AMOUNT_MESSAGES.invalid };
  const [whole, fraction = ''] = value.replace(/,/g, '').split('.');
  if (fraction.length > 2) return { ok: false, message: AMOUNT_MESSAGES.decimals };
  const units = whole.replace(/^0+(?=\d)/, '');
  const kobo = fraction.replace(/0+$/, '');
  const canonical = kobo ? `${units}.${kobo}` : units;
  const amount = Number(canonical);
  if (!Number.isFinite(amount) || amount > STATIC_MAX) return { ok: false, message: AMOUNT_MESSAGES.tooLarge };
  return { ok: true, value: canonical, amount };
}

export function checkMode(raw: unknown): ModeCheck {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === 'static' || value === 'live' ? { ok: true, value } : { ok: false, message: MODE_MESSAGE };
}

export function sameStoredValue(key: WritableKey, a: StoredValue, b: StoredValue): boolean {
  if (key === MODE_KEY) return effectiveMode(a) === effectiveMode(b);
  const left = isShownAmount(a);
  const right = isShownAmount(b);
  if (left && right) return shownAmount(a) === shownAmount(b);
  if (left || right) return false;
  return (a ?? '').trim() === (b ?? '').trim();
}

export function readPatchRequest(body: unknown): PatchRequestCheck {
  if (!isRecord(body)) return { ok: false, message: 'Send the changes as a JSON object.' };
  const { changes, expected } = body;
  if (!isRecord(changes)) return { ok: false, message: 'No changes were sent.' };
  if (expected === undefined || expected === null) return { ok: true, request: { changes, expected: null } };
  if (!isRecord(expected)) return { ok: false, message: EXPECTED_MESSAGE };
  const seen: Record<string, string> = {};
  for (const key of WRITABLE_KEYS) {
    if (!owns(expected, key)) continue;
    const value = expected[key];
    if (value === null || value === undefined) seen[key] = '';
    else if (typeof value === 'string') seen[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) seen[key] = String(value);
    else return { ok: false, message: EXPECTED_MESSAGE };
  }
  return { ok: true, request: { changes, expected: seen } };
}

export function conflictMessage(keys: readonly WritableKey[]): string {
  const labels = keys.map((key) => KEY_LABELS[key]).join(' and ');
  return `Another admin changed the ${labels} after you loaded this page, so nothing was saved. Reload to see the current value.`;
}

export function planPatch(current: StoredValues, request: PatchRequest): PatchPlanResult {
  const requested = WRITABLE_KEYS.filter((key) => owns(request.changes, key));
  if (requested.length === 0) return { ok: false, code: 'VALIDATION_ERROR', message: 'Nothing to update.' };

  const updates: Record<string, string> = {};
  const changed: WritableKey[] = [];
  const unchanged: WritableKey[] = [];
  for (const key of requested) {
    const checked = key === MODE_KEY ? checkMode(request.changes[key]) : checkStaticAmount(request.changes[key]);
    if (!checked.ok) return { ok: false, code: 'VALIDATION_ERROR', message: checked.message };
    if (current[key] === checked.value) {
      unchanged.push(key);
      continue;
    }
    updates[key] = checked.value;
    changed.push(key);
  }

  const expected = request.expected;
  const conflicted = expected
    ? changed.filter((key) => owns(expected, key) && !sameStoredValue(key, current[key], expected[key]))
    : [];
  if (conflicted.length > 0) {
    return {
      ok: false,
      code: 'STATE_CONFLICT',
      message: conflictMessage(conflicted),
      conflicts: conflicted.map((key) => ({ key, label: KEY_LABELS[key], current: storedOrNull(current[key]) })),
    };
  }

  const before: Record<string, string | number | null> = {};
  const after: Record<string, string | number | null> = {};
  for (const key of changed) {
    before[key] = storedOrNull(current[key]);
    after[key] = updates[key];
  }
  if (changed.length > 0) {
    before.displayed_balance = displayedBalance(current);
    after.displayed_balance = displayedBalance({ ...current, ...updates });
  }

  return {
    ok: true,
    plan: {
      updates,
      changed,
      unchanged,
      before,
      after,
      entityId: changed.length === 1 ? changed[0] : 'batch',
    },
  };
}

export interface GuardedWrite {
  key: WritableKey;
  value: string;
  exists: boolean;
  seen: string | null;
}

export function guardedWrite(current: StoredValues, plan: PatchPlan): GuardedWrite | null {
  if (plan.changed.length !== 1) return null;
  const [key] = plan.changed;
  return { key, value: plan.updates[key], exists: owns(current, key), seen: storedOrNull(current[key]) };
}

export function storedValues(rows: readonly unknown[]): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  for (const row of rows) {
    if (!isRecord(row) || typeof row.key !== 'string' || !READ_KEY_SET.has(row.key)) continue;
    values[row.key] = typeof row.value === 'string' ? row.value : null;
  }
  return values;
}

export function presentBalance(rows: readonly unknown[]): BalancePayload {
  const config: Record<string, string | null> = {};
  const updated: Record<string, string | null> = {};
  const gateways: Record<string, string | null> = {};
  for (const row of rows) {
    if (!isRecord(row) || typeof row.key !== 'string') continue;
    const value = typeof row.value === 'string' ? row.value : null;
    if (CONFIG_KEY_SET.has(row.key)) {
      config[row.key] = value;
      updated[row.key] = typeof row.updated_at === 'string' ? row.updated_at : null;
    }
    if (GATEWAY_KEY_SET.has(row.key)) gateways[row.key] = value;
  }
  return { config, config_updated_at: updated, live_gateway: resolvePayoutGateway(gateways) };
}

export function buildSnapshot(
  raw: Readonly<Record<string, string | null>>,
  updatedAt: Readonly<Record<string, string | null>>,
  gateway: PayoutGateway,
): BalanceSnapshot {
  const values = { ...raw };
  return {
    raw: values,
    updatedAt: { ...updatedAt },
    gateway,
    mode: effectiveMode(values[MODE_KEY]),
    staticText: storedOrNull(values[STATIC_KEY]),
    staticAmount: shownAmount(values[STATIC_KEY]),
    staticValid: isShownAmount(values[STATIC_KEY]),
    liveAmount: shownAmount(values[LIVE_KEY]),
    liveValid: isShownAmount(values[LIVE_KEY]),
    liveAt: instant(values[LIVE_AT_KEY]),
    liveError: text(values[LIVE_ERROR_KEY]),
    shownAmount: displayedBalance(values),
  };
}

export function toSnapshot(body: ApiBody): BalanceSnapshot | null {
  if (!isRecord(body.config)) return null;
  const raw: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(body.config)) {
    if (typeof value === 'string') raw[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) raw[key] = String(value);
    else if (value === null) raw[key] = null;
  }
  const updatedAt: Record<string, string | null> = {};
  if (isRecord(body.config_updated_at)) {
    for (const [key, value] of Object.entries(body.config_updated_at)) updatedAt[key] = instant(value);
  }
  const gateway = isProvider(body.live_gateway)
    ? body.live_gateway
    : resolvePayoutGateway({ [GATEWAY_KEY]: raw[GATEWAY_KEY] ?? null });
  return buildSnapshot(raw, updatedAt, gateway);
}

export function ageText(at: string, now: number): string {
  const age = formatAge(at, new Date(now));
  return age === '<1m' ? 'less than a minute ago' : `${age} ago`;
}

export function liveIssue(snapshot: BalanceSnapshot, now: number): LiveIssue | null {
  const provider = PROVIDER_LABELS[snapshot.gateway];
  if (snapshot.liveError) {
    return {
      kind: 'failed',
      title: 'The last live refresh failed',
      message: snapshot.liveAt
        ? `Reading the ${provider} balance failed: “${snapshot.liveError}”. The live balance is still the one fetched ${ageText(snapshot.liveAt, now)}.`
        : `Reading the ${provider} balance failed: “${snapshot.liveError}”. No live balance has been fetched yet.`,
    };
  }
  if (!snapshot.liveAt) {
    return {
      kind: 'never',
      title: 'No live balance yet',
      message: `No balance has been fetched from ${provider} yet. Refreshes run every ${REFRESH_INTERVAL_MINUTES} minutes.`,
    };
  }
  if (!snapshot.liveValid) {
    return {
      kind: 'invalid',
      title: 'The live balance cannot be read',
      message: 'The stored live balance is not a valid amount, so it counts as ₦0.00 until the next successful refresh.',
    };
  }
  if (now - Date.parse(snapshot.liveAt) > STALE_AFTER_MS) {
    return {
      kind: 'stale',
      title: 'The live balance is out of date',
      message: `It was last refreshed ${ageText(snapshot.liveAt, now)}. Refreshes run every ${REFRESH_INTERVAL_MINUTES} minutes, so recent ones have not completed.`,
    };
  }
  return null;
}

export function staticProblem(snapshot: BalanceSnapshot): string | null {
  if (snapshot.staticValid) return null;
  if (snapshot.staticText === null || snapshot.staticText.trim() === '') {
    return 'No static amount has been set, so it counts as ₦0.00.';
  }
  return `The stored value “${snapshot.staticText}” is not a valid amount, so it counts as ₦0.00.`;
}

export function magnitudeOf(from: number, to: number): Magnitude {
  if (!(from > 0)) return null;
  if (to >= from * 10) return 'larger';
  if (to > 0 && to * 10 <= from) return 'smaller';
  return null;
}

function issueConsequence(issue: LiveIssue, fresh: BalanceSnapshot, now: number): string {
  const provider = PROVIDER_LABELS[fresh.gateway];
  switch (issue.kind) {
    case 'failed':
      return fresh.liveAt
        ? `The last refresh failed (“${fresh.liveError}”), so users will see the balance fetched ${ageText(fresh.liveAt, now)} until a refresh succeeds.`
        : `The last refresh failed (“${fresh.liveError}”) and no balance has been fetched yet, so users will see ${formatNaira(fresh.liveAmount)} until a refresh succeeds.`;
    case 'never':
      return `No live balance has been fetched from ${provider} yet, so users will see ${formatNaira(fresh.liveAmount)} until the first refresh succeeds.`;
    case 'invalid':
      return 'The stored live balance is not a valid amount, so users will see ₦0.00 until a refresh succeeds.';
    case 'stale':
      return `The live balance was last refreshed ${ageText(fresh.liveAt ?? '', now)}, so users will see an out-of-date figure until a refresh succeeds.`;
  }
}

export function modeConsequences(fresh: BalanceSnapshot, target: BalanceMode, now: number): string[] {
  const provider = PROVIDER_LABELS[fresh.gateway];
  if (target === 'static') {
    const lines = [
      `The figure stops following ${provider} and stays at ${formatNaira(fresh.staticAmount)} until an admin changes the static amount.`,
    ];
    const problem = staticProblem(fresh);
    if (problem) lines.push(`${problem} Users will see ₦0.00 until a static amount is saved.`);
    return lines;
  }
  const lines = [
    `The figure follows ${provider} from now on. It is refreshed every ${REFRESH_INTERVAL_MINUTES} minutes, so users will see it change.`,
  ];
  const issue = liveIssue(fresh, now);
  if (issue) lines.push(issueConsequence(issue, fresh, now));
  return lines;
}

export function staticConsequences(fresh: BalanceSnapshot, amount: number, changedElsewhere: boolean): string[] {
  const lines: string[] = [];
  if (fresh.mode === 'live') {
    lines.push(
      `The source is Live, so users keep seeing the ${PROVIDER_LABELS[fresh.gateway]} balance. This amount is shown only after you switch to Static.`,
    );
  }
  if (changedElsewhere) {
    lines.push(
      `Another admin changed the static amount to ${formatNaira(fresh.staticAmount)} after you started editing. Saving replaces it.`,
    );
  }
  const magnitude = fresh.staticValid ? magnitudeOf(fresh.staticAmount, amount) : null;
  if (magnitude === 'larger') lines.push('The new amount is at least ten times the current one. Check for an extra zero.');
  if (magnitude === 'smaller') lines.push('The new amount is a tenth of the current one or less. Check for a missing zero.');
  if (amount === 0 && fresh.mode === 'static') lines.push('Users will see ₦0.00 on the Marketplace screen.');
  return lines;
}

export function toSaveReceipt(body: ApiBody): SaveReceipt | null {
  const changed = Array.isArray(body.changed)
    ? body.changed.filter((key): key is string => typeof key === 'string')
    : null;
  const applied: Record<string, string> = {};
  if (isRecord(body.applied)) {
    for (const [key, value] of Object.entries(body.applied)) {
      if (typeof value === 'string') applied[key] = value;
    }
  }
  return {
    changed,
    applied,
    auditRecorded: body.audit_recorded !== false,
    warning: text(body.warning),
  };
}

export function classifySave(result: ApiResult<SaveReceipt>): SaveOutcome {
  if (result.ok) return { kind: 'done', receipt: result.data };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.status === 403) return { kind: 'denied', message: failure.message };
  if (failure.status === 409 && failure.code === 'STATE_CONFLICT') return { kind: 'conflict', message: failure.message };
  if (failure.outcomeUnknown || failure.kind !== 'http') return { kind: 'unknown', message: failure.message };
  return { kind: 'refused', message: failure.message };
}

export function changePayload(snapshot: BalanceSnapshot, key: WritableKey, value: string): SavePayload {
  return { changes: { [key]: value }, expected: { [key]: snapshot.raw[key] ?? '' } };
}

export function applySaved(
  snapshot: BalanceSnapshot,
  applied: Readonly<Record<string, string>>,
  at: string,
): BalanceSnapshot {
  const keys = WRITABLE_KEYS.filter((key) => typeof applied[key] === 'string');
  if (keys.length === 0) return snapshot;
  const raw: Record<string, string | null> = { ...snapshot.raw };
  const updatedAt: Record<string, string | null> = { ...snapshot.updatedAt };
  for (const key of keys) {
    raw[key] = applied[key];
    updatedAt[key] = at;
  }
  return buildSnapshot(raw, updatedAt, snapshot.gateway);
}

export function isDraftDirty(draft: StaticDraft | null): boolean {
  if (!draft) return false;
  const next = checkStaticAmount(draft.text);
  const base = checkStaticAmount(draft.base ?? '');
  if (next.ok && base.ok) return next.value !== base.value;
  return draft.text.trim() !== (draft.base ?? '').trim();
}

export function editedElsewhere(draft: StaticDraft, fresh: BalanceSnapshot): boolean {
  return !sameStoredValue(STATIC_KEY, draft.base, fresh.staticText);
}

export function alreadyStored(fresh: BalanceSnapshot, value: string, amount: number): boolean {
  return fresh.staticText === value || (fresh.staticValid && fresh.staticAmount === amount);
}

export function sourceText(snapshot: BalanceSnapshot): string {
  return snapshot.mode === 'live' ? `Live balance from ${PROVIDER_LABELS[snapshot.gateway]}` : 'Static amount';
}

export function workingStatus(working: Working | null): string {
  if (!working || working.kind !== 'mode') return '';
  if (working.phase === 'checking') return 'Checking the current source…';
  if (working.phase === 'saving') return `Switching to ${MODE_LABELS[working.target]}…`;
  return '';
}

export function sourceChoice(saved: BalanceMode, working: Working | null): SourceChoice {
  const pending = working?.kind === 'mode' ? working.target : null;
  return { value: pending ?? saved, pending, locked: working !== null };
}

export function saveLabel(phase: WorkPhase | null): string {
  if (phase === 'checking') return 'Checking…';
  if (phase === 'saving') return 'Saving…';
  return 'Save amount';
}

export function savedHelp(snapshot: BalanceSnapshot, changedAt: string | null): string | undefined {
  if (snapshot.staticValid) {
    return `Saved as ${formatNaira(snapshot.staticAmount)}${changedAt ? `, last changed ${changedAt}` : ''}.`;
  }
  return changedAt ? `Last changed ${changedAt}.` : undefined;
}
