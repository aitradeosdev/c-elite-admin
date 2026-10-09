import { validateConfigUrl } from '../../lib/configUrls';
import { SECRET_CONFIG_KEYS } from '../../lib/configSecrets';

export const PAYMENT_GATEWAYS = ['paystack', 'monnify', 'novac'] as const;
export const BILL_PROVIDERS = ['vtpass', 'novac'] as const;
export const UPDATE_TYPES = ['soft', 'force'] as const;

export type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number];
export type BillProvider = (typeof BILL_PROVIDERS)[number];
export type UpdateType = (typeof UPDATE_TYPES)[number];

export const GATEWAY_LABELS: Readonly<Record<PaymentGateway, string>> = {
  paystack: 'Paystack',
  monnify: 'Monnify',
  novac: 'Novac',
};

export const BILL_PROVIDER_LABELS: Readonly<Record<BillProvider, string>> = {
  vtpass: 'VTPass',
  novac: 'Novac',
};

export const UPDATE_TYPE_LABELS: Readonly<Record<UpdateType, string>> = {
  soft: 'Soft: users can skip it',
  force: 'Force: users must update',
};

export const PRIMARY_GATEWAY_KEY = 'active_payment_gateway';
export const PRIMARY_BILL_KEY = 'active_bill_provider';
export const EMERGENCY_KEY = 'emergency_mode';
export const APPROVAL_LIMIT_KEY = 'max_card_approval_naira';
export const CHATWOOT_URL_KEY = 'chatwoot_base_url';
export const CHATWOOT_TOKEN_KEY = 'chatwoot_website_token';
export const IDENTITY_KEY = 'chatwoot_identity_key';
export const CURRENT_VERSION_KEY = 'app_current_version';
export const MINIMUM_VERSION_KEY = 'app_minimum_version';
export const UPDATE_TYPE_KEY = 'app_update_type';
export const UPDATE_MESSAGE_KEY = 'app_update_message';
export const TERMS_URL_KEY = 'terms_url';
export const PRIVACY_URL_KEY = 'privacy_url';
export const ANDROID_STORE_KEY = 'store_url_android';
export const IOS_STORE_KEY = 'store_url_ios';

export const DEFAULT_GATEWAY: PaymentGateway = 'paystack';
export const DEFAULT_BILL_PROVIDER: BillProvider = 'vtpass';
export const DEFAULT_APPROVAL_LIMIT = '5000000';
export const DEFAULT_UPDATE_TYPE: UpdateType = 'soft';

export const APPROVAL_LIMIT_MIN = 1_000;
export const APPROVAL_LIMIT_MAX = 1_000_000_000_000;
export const TOKEN_MAX_LENGTH = 256;
export const MESSAGE_MAX_LENGTH = 500;
export const REASON_MAX_LENGTH = 500;

export const SECRET_MASK = '•••••••• (hidden)';

export function gatewayFlagKey(gateway: string): string {
  return `gateway_${gateway}_enabled`;
}

export function billFlagKey(provider: string): string {
  return `bill_${provider}_enabled`;
}

export const SETTINGS_KEYS: readonly string[] = [
  ...PAYMENT_GATEWAYS.map(gatewayFlagKey),
  PRIMARY_GATEWAY_KEY,
  ...BILL_PROVIDERS.map(billFlagKey),
  PRIMARY_BILL_KEY,
  CHATWOOT_URL_KEY,
  CHATWOOT_TOKEN_KEY,
  IDENTITY_KEY,
  CURRENT_VERSION_KEY,
  MINIMUM_VERSION_KEY,
  UPDATE_TYPE_KEY,
  UPDATE_MESSAGE_KEY,
  EMERGENCY_KEY,
  APPROVAL_LIMIT_KEY,
  TERMS_URL_KEY,
  PRIVACY_URL_KEY,
  ANDROID_STORE_KEY,
  IOS_STORE_KEY,
];

export const SECRET_KEYS: readonly string[] = SECRET_CONFIG_KEYS;

export const SETTING_LABELS: Readonly<Record<string, string>> = {
  gateway_paystack_enabled: 'Paystack gateway',
  gateway_monnify_enabled: 'Monnify gateway',
  gateway_novac_enabled: 'Novac gateway',
  [PRIMARY_GATEWAY_KEY]: 'Primary payout gateway',
  bill_vtpass_enabled: 'VTPass bill provider',
  bill_novac_enabled: 'Novac bill provider',
  [PRIMARY_BILL_KEY]: 'Primary bill provider',
  [CHATWOOT_URL_KEY]: 'Chatwoot base URL',
  [CHATWOOT_TOKEN_KEY]: 'Website inbox token',
  [IDENTITY_KEY]: 'Identity validation key',
  [CURRENT_VERSION_KEY]: 'Current app version',
  [MINIMUM_VERSION_KEY]: 'Minimum app version',
  [UPDATE_TYPE_KEY]: 'Update prompt',
  [UPDATE_MESSAGE_KEY]: 'Update message',
  [EMERGENCY_KEY]: 'Emergency mode',
  [APPROVAL_LIMIT_KEY]: 'Card approval limit',
  [TERMS_URL_KEY]: 'Terms of Use URL',
  [PRIVACY_URL_KEY]: 'Privacy Policy URL',
  [ANDROID_STORE_KEY]: 'Google Play URL',
  [IOS_STORE_KEY]: 'App Store URL',
};

const KEY_SET: ReadonlySet<string> = new Set(SETTINGS_KEYS);
const SECRET_SET: ReadonlySet<string> = new Set(SECRET_KEYS);
const FLAG_SET: ReadonlySet<string> = new Set([
  ...PAYMENT_GATEWAYS.map(gatewayFlagKey),
  ...BILL_PROVIDERS.map(billFlagKey),
  EMERGENCY_KEY,
]);
const URL_SET: ReadonlySet<string> = new Set([
  CHATWOOT_URL_KEY, TERMS_URL_KEY, PRIVACY_URL_KEY, ANDROID_STORE_KEY, IOS_STORE_KEY,
]);
const TOKEN_SET: ReadonlySet<string> = new Set([CHATWOOT_TOKEN_KEY, IDENTITY_KEY]);
const VERSION_SET: ReadonlySet<string> = new Set([CURRENT_VERSION_KEY, MINIMUM_VERSION_KEY]);
const FINANCIAL_SET: ReadonlySet<string> = new Set([
  ...PAYMENT_GATEWAYS.map(gatewayFlagKey),
  PRIMARY_GATEWAY_KEY,
  ...BILL_PROVIDERS.map(billFlagKey),
  PRIMARY_BILL_KEY,
  APPROVAL_LIMIT_KEY,
]);
const SECURITY_SET: ReadonlySet<string> = new Set([EMERGENCY_KEY, IDENTITY_KEY]);

const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
const VERSION_PATTERN = /^\d{1,6}(?:\.\d{1,6}){0,2}$/;
const WHOLE_NAIRA = /^\d{1,13}$/;

export type StoredValue = string | null | undefined;
export type StoredValues = Readonly<Record<string, StoredValue>>;

export type ValueCheck = { ok: true; value: string } | { ok: false; message: string };

export type SettingsSensitivity = 'normal' | 'financial' | 'security';

export type SettingsAuditAction = 'UPDATE_ADMIN_SETTINGS' | 'ENABLE_EMERGENCY_MODE' | 'DISABLE_EMERGENCY_MODE';

export interface StoredSetting {
  key: string;
  value: string | null;
  is_public?: boolean | null;
  updated_at?: string | null;
}

export type SecretSummary = {
  set: boolean;
  updated_at: string | null;
  exposed: boolean;
};

export type SettingsPayload = {
  config: Record<string, string | null>;
  secrets: Record<string, SecretSummary>;
  config_updated_at: Record<string, string | null>;
};

export interface SaveRequest {
  changes: Record<string, unknown>;
  reason: string | null;
  expected: Record<string, string> | null;
}

export type SaveRequestCheck = { ok: true; request: SaveRequest } | { ok: false; message: string };

export interface SettingsConflict {
  key: string;
  label: string;
  current: string | null;
}

export interface SavePlan {
  updates: Record<string, string>;
  unchanged: string[];
  before: Record<string, string | null>;
  after: Record<string, string | null>;
  action: SettingsAuditAction;
  sensitivity: SettingsSensitivity;
  entityId: string;
  secretUpdates: string[];
}

export type SavePlanResult =
  | { ok: true; plan: SavePlan }
  | { ok: false; code: 'VALIDATION_ERROR'; message: string }
  | { ok: false; code: 'STATE_CONFLICT'; message: string; conflicts: SettingsConflict[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function owns(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function accept(value: string): ValueCheck {
  return { ok: true, value };
}

function refuse(message: string): ValueCheck {
  return { ok: false, message };
}

export function isSettingKey(key: string): boolean {
  return KEY_SET.has(key);
}

export function isSecretKey(key: string): boolean {
  return SECRET_SET.has(key);
}

export function isFlagKey(key: string): boolean {
  return FLAG_SET.has(key);
}

export function isFinancialKey(key: string): boolean {
  return FINANCIAL_SET.has(key);
}

export function isMonoKey(key: string): boolean {
  return URL_SET.has(key) || TOKEN_SET.has(key) || VERSION_SET.has(key) || key === APPROVAL_LIMIT_KEY;
}

export function settingLabel(key: string): string {
  return SETTING_LABELS[key] ?? key;
}

export function isGateway(value: string): value is PaymentGateway {
  return (PAYMENT_GATEWAYS as readonly string[]).includes(value);
}

export function isBillProvider(value: string): value is BillProvider {
  return (BILL_PROVIDERS as readonly string[]).includes(value);
}

export function isUpdateType(value: string): value is UpdateType {
  return (UPDATE_TYPES as readonly string[]).includes(value);
}

export function gatewayLabel(value: string): string {
  return isGateway(value) ? GATEWAY_LABELS[value] : value;
}

export function billProviderLabel(value: string): string {
  return isBillProvider(value) ? BILL_PROVIDER_LABELS[value] : value;
}

export function hasValue(raw: unknown): boolean {
  return typeof raw === 'string' && raw.trim() !== '';
}

export function isMaskEcho(raw: unknown): boolean {
  return typeof raw === 'string' && raw.trim() === SECRET_MASK;
}

export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export function isVersion(value: string): boolean {
  return VERSION_PATTERN.test(value);
}

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function normalizeStored(key: string, raw: StoredValue): string {
  const text = typeof raw === 'string' ? raw : '';
  if (SECRET_SET.has(key)) return text.trim() !== '' ? SECRET_MASK : '';
  if (FLAG_SET.has(key)) return text === 'true' ? 'true' : 'false';
  if (key === PRIMARY_GATEWAY_KEY) return text.trim().toLowerCase() || DEFAULT_GATEWAY;
  if (key === PRIMARY_BILL_KEY) return text.trim().toLowerCase() || DEFAULT_BILL_PROVIDER;
  if (key === APPROVAL_LIMIT_KEY) return typeof raw === 'string' ? text.trim() : DEFAULT_APPROVAL_LIMIT;
  if (key === UPDATE_TYPE_KEY) return text.trim().toLowerCase() || DEFAULT_UPDATE_TYPE;
  return text.trim();
}

export function normalizeSettings(raw: StoredValues): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) values[key] = normalizeStored(key, raw[key]);
  return values;
}

export function primaryGateway(values: StoredValues): string {
  return normalizeStored(PRIMARY_GATEWAY_KEY, values[PRIMARY_GATEWAY_KEY]);
}

export function primaryBillProvider(values: StoredValues): string {
  return normalizeStored(PRIMARY_BILL_KEY, values[PRIMARY_BILL_KEY]);
}

function asText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

const APPROVAL_LIMIT_MESSAGE =
  'The card approval limit must be a whole number of naira from ₦1,000 to ₦1,000,000,000,000.';

export function checkSettingValue(key: string, raw: unknown): ValueCheck {
  const label = settingLabel(key);
  const text = asText(raw);
  if (text === null) return refuse(`${label} must be text.`);
  const value = text.trim();

  if (FLAG_SET.has(key)) {
    const flag = value.toLowerCase();
    return flag === 'true' || flag === 'false' ? accept(flag) : refuse(`${label} must be on or off (true or false).`);
  }
  if (key === PRIMARY_GATEWAY_KEY) {
    const gateway = value.toLowerCase();
    return isGateway(gateway)
      ? accept(gateway)
      : refuse(`Choose ${joinLabels(PAYMENT_GATEWAYS.map((option) => GATEWAY_LABELS[option]))} as the primary payout gateway.`);
  }
  if (key === PRIMARY_BILL_KEY) {
    const provider = value.toLowerCase();
    return isBillProvider(provider)
      ? accept(provider)
      : refuse(`Choose ${joinLabels(BILL_PROVIDERS.map((option) => BILL_PROVIDER_LABELS[option]))} as the primary bill provider.`);
  }
  if (key === APPROVAL_LIMIT_KEY) {
    if (!WHOLE_NAIRA.test(value)) return refuse(APPROVAL_LIMIT_MESSAGE);
    const amount = Number(value);
    if (amount < APPROVAL_LIMIT_MIN || amount > APPROVAL_LIMIT_MAX) return refuse(APPROVAL_LIMIT_MESSAGE);
    return accept(String(amount));
  }
  if (URL_SET.has(key)) {
    const problem = validateConfigUrl(key, value);
    return problem ? refuse(`${problem.split(key).join(label)}.`) : accept(value);
  }
  if (TOKEN_SET.has(key)) {
    if (value.length > TOKEN_MAX_LENGTH || CONTROL.test(value) || /\s/.test(value)) {
      return refuse(`${label} must be a single value of at most ${TOKEN_MAX_LENGTH} characters, with no spaces.`);
    }
    return accept(value);
  }
  if (VERSION_SET.has(key)) {
    return value === '' || isVersion(value)
      ? accept(value)
      : refuse(`${label} must look like 1.4.2: up to three whole numbers separated by dots.`);
  }
  if (key === UPDATE_TYPE_KEY) {
    const type = value.toLowerCase();
    return isUpdateType(type) ? accept(type) : refuse('The update prompt must be soft or force.');
  }
  if (key === UPDATE_MESSAGE_KEY) {
    if (value.length > MESSAGE_MAX_LENGTH) {
      return refuse(`The update message must be ${MESSAGE_MAX_LENGTH} characters or fewer.`);
    }
    if (CONTROL.test(value)) return refuse('The update message cannot contain line breaks or control characters.');
    return accept(value);
  }
  return accept(value);
}

export function settingProblem(key: string, values: StoredValues): string | null {
  if (key === PRIMARY_GATEWAY_KEY) {
    const primary = primaryGateway(values);
    return values[gatewayFlagKey(primary)] === 'true'
      ? null
      : `Turn on ${gatewayLabel(primary)} before making it the primary payout gateway.`;
  }
  if (key === PRIMARY_BILL_KEY) {
    const primary = primaryBillProvider(values);
    return values[billFlagKey(primary)] === 'true'
      ? null
      : `Turn on ${billProviderLabel(primary)} before making it the primary bill provider.`;
  }
  const gateway = PAYMENT_GATEWAYS.find((option) => gatewayFlagKey(option) === key);
  if (gateway) {
    return values[key] !== 'true' && primaryGateway(values) === gateway
      ? `${GATEWAY_LABELS[gateway]} is the primary payout gateway. Make another gateway primary before turning it off.`
      : null;
  }
  const provider = BILL_PROVIDERS.find((option) => billFlagKey(option) === key);
  if (provider) {
    return values[key] !== 'true' && primaryBillProvider(values) === provider
      ? `${BILL_PROVIDER_LABELS[provider]} is the primary bill provider. Make another provider primary before turning it off.`
      : null;
  }
  if (VERSION_SET.has(key)) {
    const current = (values[CURRENT_VERSION_KEY] ?? '').trim();
    const minimum = (values[MINIMUM_VERSION_KEY] ?? '').trim();
    if (!isVersion(current) || !isVersion(minimum)) return null;
    return compareVersions(minimum, current) > 0
      ? `The minimum app version (${minimum}) cannot be above the current version (${current}), or everyone on the current version would be blocked.`
      : null;
  }
  return null;
}

export function sameSetting(key: string, a: StoredValue, b: StoredValue): boolean {
  return normalizeStored(key, a) === normalizeStored(key, b);
}

export function auditValue(key: string, raw: StoredValue): string | null {
  if (SECRET_SET.has(key)) return hasValue(raw) ? '[set]' : '[not set]';
  return typeof raw === 'string' ? raw : null;
}

function secretAfter(previous: StoredValue, next: string): string {
  if (!hasValue(next)) return '[cleared]';
  return hasValue(previous) ? '[replaced]' : '[set]';
}

export function sensitivityFor(keys: readonly string[]): SettingsSensitivity {
  if (keys.some((key) => SECURITY_SET.has(key))) return 'security';
  if (keys.some((key) => FINANCIAL_SET.has(key))) return 'financial';
  return 'normal';
}

export function actionFor(updates: Readonly<Record<string, string>>): SettingsAuditAction {
  if (!owns(updates, EMERGENCY_KEY)) return 'UPDATE_ADMIN_SETTINGS';
  return updates[EMERGENCY_KEY] === 'true' ? 'ENABLE_EMERGENCY_MODE' : 'DISABLE_EMERGENCY_MODE';
}

function readReason(raw: unknown): { ok: true; reason: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, reason: null };
  if (typeof raw !== 'string') return { ok: false, message: 'The reason must be text.' };
  const reason = raw.trim();
  if (reason.length > REASON_MAX_LENGTH) {
    return { ok: false, message: `Keep the reason to ${REASON_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, reason: reason || null };
}

function readExpected(raw: unknown): { ok: true; expected: Record<string, string> | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, expected: null };
  if (!isRecord(raw)) return { ok: false, message: 'expected must map each setting to the value you last saw.' };
  const expected: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!KEY_SET.has(key)) continue;
    const text = asText(value);
    if (text === null) return { ok: false, message: 'expected must map each setting to the value you last saw.' };
    expected[key] = text;
  }
  return { ok: true, expected };
}

export function readSaveRequest(body: unknown): SaveRequestCheck {
  if (!isRecord(body)) return { ok: false, message: 'Send the settings to change as a JSON object.' };
  const changes = body.changes;
  if (!isRecord(changes)) return { ok: false, message: 'No changes were sent.' };
  const reason = readReason(body.reason);
  if (!reason.ok) return reason;
  const expected = readExpected(body.expected);
  if (!expected.ok) return expected;
  return { ok: true, request: { changes, reason: reason.reason, expected: expected.expected } };
}

function storedText(raw: StoredValue): string {
  return typeof raw === 'string' ? raw : '';
}

function conflictMessage(keys: readonly string[]): string {
  const labels = joinLabels(keys.map(settingLabel));
  return `Another admin changed ${labels} after you loaded these settings, so nothing was saved. Reload to see the current values.`;
}

export function planSave(current: StoredValues, request: SaveRequest): SavePlanResult {
  const requested = Object.keys(request.changes).filter(isSettingKey);
  if (requested.length === 0) return { ok: false, code: 'VALIDATION_ERROR', message: 'Nothing to update.' };

  const updates: Record<string, string> = {};
  const unchanged: string[] = [];
  for (const key of requested) {
    const raw = request.changes[key];
    if (SECRET_SET.has(key) && isMaskEcho(raw)) {
      unchanged.push(key);
      continue;
    }
    if (typeof current[key] === 'string' && asText(raw) === current[key]) {
      unchanged.push(key);
      continue;
    }
    const checked = checkSettingValue(key, raw);
    if (!checked.ok) return { ok: false, code: 'VALIDATION_ERROR', message: checked.message };
    if (checked.value === storedText(current[key])) {
      unchanged.push(key);
      continue;
    }
    updates[key] = checked.value;
  }

  const keys = Object.keys(updates);
  const expected = request.expected;
  const conflicted = expected
    ? keys.filter((key) => owns(expected, key) && !sameSetting(key, current[key], expected[key]))
    : [];
  if (conflicted.length > 0) {
    return {
      ok: false,
      code: 'STATE_CONFLICT',
      message: conflictMessage(conflicted),
      conflicts: conflicted.map((key) => ({ key, label: settingLabel(key), current: auditValue(key, current[key]) })),
    };
  }

  const next: Record<string, StoredValue> = { ...current, ...updates };
  for (const key of keys) {
    const problem = settingProblem(key, next);
    if (problem) return { ok: false, code: 'VALIDATION_ERROR', message: problem };
  }

  const before: Record<string, string | null> = {};
  const after: Record<string, string | null> = {};
  for (const key of keys) {
    before[key] = auditValue(key, current[key]);
    after[key] = SECRET_SET.has(key) ? secretAfter(current[key], updates[key]) : updates[key];
  }

  return {
    ok: true,
    plan: {
      updates,
      unchanged,
      before,
      after,
      action: actionFor(updates),
      sensitivity: sensitivityFor(keys),
      entityId: keys.length === 1 ? keys[0] : 'batch',
      secretUpdates: keys.filter((key) => SECRET_SET.has(key)),
    },
  };
}

export function storedValues(rows: readonly StoredSetting[]): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  for (const row of rows) {
    if (!row || typeof row.key !== 'string' || !KEY_SET.has(row.key)) continue;
    values[row.key] = typeof row.value === 'string' ? row.value : null;
  }
  return values;
}

export function presentSettings(rows: readonly StoredSetting[]): SettingsPayload {
  const config: Record<string, string | null> = {};
  const updated: Record<string, string | null> = {};
  const byKey = new Map<string, StoredSetting>();
  for (const row of rows) {
    if (!row || typeof row.key !== 'string' || !KEY_SET.has(row.key)) continue;
    byKey.set(row.key, row);
    const value = typeof row.value === 'string' ? row.value : null;
    config[row.key] = SECRET_SET.has(row.key) ? (hasValue(value) ? SECRET_MASK : '') : value;
    updated[row.key] = typeof row.updated_at === 'string' ? row.updated_at : null;
  }
  const secrets: Record<string, SecretSummary> = {};
  for (const key of SECRET_KEYS) {
    const row = byKey.get(key);
    const set = hasValue(row?.value);
    secrets[key] = {
      set,
      updated_at: row && typeof row.updated_at === 'string' ? row.updated_at : null,
      exposed: set && row?.is_public === true,
    };
  }
  return { config, secrets, config_updated_at: updated };
}
