import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { loadAppModule } from './support/uiHarness.ts';
import { resolvePermissions } from '../app/lib/permissions.ts';
import type { Permission } from '../app/lib/permissions.ts';

type GrantRules = typeof import('../app/(dashboard)/admin-accounts/rules.ts');
type SettingsRules = typeof import('../app/(dashboard)/admin-settings/rules.ts');
type CasModule = typeof import('../app/lib/configCas.ts');

interface RouteModule {
  GET: (req: Request) => Promise<Response>;
  PATCH: (req: Request) => Promise<Response>;
}

interface Claims {
  admin_id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  token_version: number;
}

type DbError = { message: string; code?: string } | null;

interface DbResult {
  data: unknown;
  error: DbError;
}

interface Operation {
  kind: 'select' | 'insert' | 'rpc';
  table: string;
  columns?: string;
  filter?: { column: string; values: unknown[] };
  rows?: unknown;
  name?: string;
  args?: unknown;
}

interface Failures {
  read?: string;
  audit?: string;
  cache?: string;
  cacheThrows?: boolean;
}

interface CasControl {
  error?: { code?: string; message: string };
  throws?: boolean;
  data?: unknown;
  beforeRun?: (db: FakeDb) => void;
}

interface FakeQuery extends PromiseLike<DbResult> {
  select(columns: string): FakeQuery;
  in(column: string, values: readonly unknown[]): FakeQuery;
  insert(rows: unknown): FakeQuery;
}

interface FakeDb {
  config: Map<string, string | null>;
  hidden: Set<string>;
  audits: Record<string, unknown>[];
  operations: Operation[];
  failures: Failures;
  cas: CasControl;
  casResults: unknown[];
  from(table: string): FakeQuery;
  rpc(name: string, args: unknown): Promise<DbResult>;
}

interface Harness {
  db: FakeDb;
  claims: Claims | null;
  headers: Record<string, string>;
}

interface RouteSpec {
  folder: string;
  action: string;
  legacyKey: string | null;
  permissions: readonly Permission[];
  keys: readonly string[];
  privateKeys: readonly string[] | null;
  single: { key: string; value: string };
  batch: Readonly<Record<string, string>>;
  sensitivity: 'financial' | 'security';
  rejects: ReadonlyArray<[Record<string, unknown>, string]>;
  accepts: ReadonlyArray<[Record<string, unknown>, Record<string, string>]>;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
  requestHeader: string | null;
}

interface AuditFields {
  action: string;
  entity_id: string;
  before_value: unknown;
  after_value: unknown;
  sensitivity: string;
  result?: string;
  error?: string | null;
  reason?: string | null;
}

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const HARNESS_KEY = '__configRoutesHarness';
const REQUEST_ID = 'req_cfgtest01';
const USER_AGENT = 'config-routes-test';
const CLIENT_IP = '198.51.100.7';
const STAMP = '2026-10-01T09:00:00.000Z';
const PUBLIC_CACHE_KEY = 'app_config:public';
const CAS = 'app_config_compare_and_set';
const CAS_PARAMS = ['p_changes', 'p_expected', 'p_private_keys'];
const SECRET_KEY = 'chatwoot_identity_key';
const SECRET = 'hmac-identity-secret';
const WALLET_CAP_KEYS: readonly string[] = ['max_wallet_adjustment_naira', 'max_wallet_adjustment_daily_naira'];
const LOAD_FAILED = 'The settings could not be loaded. Try again.';
const NOT_SAVED = 'The new values could not be written to the database. Reload to check the live values before trying again.';
const EXPECTED_SHAPE = 'expected must map each setting to the value you last saw.';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const RACE = 'Another admin changed these settings while you were saving, so nothing was saved. Reload to see the current values.';
const UNREADABLE = `${CAS} returned a result in an unexpected shape`;
const APP_NOT_SAVED = 'The settings could not be saved. Nothing was changed.';
const APP_UNCONFIRMED = 'The save could not be confirmed. Reload to check the current values before trying again.';
const APP_READ_FAILED = 'The current values could not be read, so nothing was saved.';
const SETTINGS_NOT_SAVED = 'The settings could not be saved. Nothing was changed.';
const SETTINGS_UNCONFIRMED = 'The save could not be confirmed. Reload the settings to check them before trying again.';
const SECRET_WRITE_FAILED = 'The database refused the write.';
const BALANCE_NOT_SAVED = 'The platform balance could not be saved. Nothing was changed.';
const BALANCE_UNCONFIRMED = 'The save could not be confirmed. Reload the platform balance to check it before trying again.';
const SIGNUP_SWITCH = 'Signup bonus: Switch the signup bonus on or off (true or false).';
const SIGNUP_CONDITION = 'When users can claim the signup bonus: Choose “After their first approved trade” or “Straight away”.';
const SIGNUP_ZERO = 'A signup bonus that is on needs an amount above ₦0. Switch the bonus off instead.';
const SIGNUP_UNREADABLE = 'Signup bonus amount: Enter a number, like 1500 or 1500.50.';

const SEED: Readonly<Record<string, string>> = {
  min_withdrawal_amount: '1000',
  max_withdrawal_amount: '500000',
  max_daily_withdrawal: '1000000',
  pin_reset_freeze_hours: '24',
  withdraw_fee: '50',
  large_withdrawal_flag_threshold: '500000',
  max_wallet_adjustment_naira: '500000',
  max_wallet_adjustment_daily_naira: '2000000',
  airtime_quick_amounts: '100,200,500,1000',
  electricity_quick_amounts: '1000,2000,5000,10000',
  min_airtime_amount: '50',
  min_electricity_amount: '500',
  anomaly_dormant_days: '30',
  anomaly_dormant_amount: '200000',
  anomaly_rapid_window_mins: '60',
  anomaly_rapid_ratio: '0.8',
  anomaly_failures_window_mins: '30',
  anomaly_failures_threshold: '5',
  alert_critical_amount: '1000000',
  alert_timezone: 'Africa/Lagos',
  security_alerts_batch_size: '50',
  signup_rate_limit_per_hour: '6',
  paystack_webhook_ips: '52.31.139.75,52.49.173.169,52.214.14.220',
  monnify_webhook_ips: '35.242.133.146',
  novac_webhook_ips: '41.58.1.10',
  chatwoot_identity_key: SECRET,
  emergency_mode: 'false',
  gateway_paystack_enabled: 'true',
  gateway_monnify_enabled: 'false',
  gateway_novac_enabled: 'true',
  active_payment_gateway: 'paystack',
  bill_vtpass_enabled: 'true',
  bill_novac_enabled: 'false',
  active_bill_provider: 'vtpass',
  chatwoot_base_url: 'https://app.chatwoot.com',
  chatwoot_website_token: 'AbC123xyz',
  app_current_version: '1.4.0',
  app_minimum_version: '1.2.0',
  app_update_type: 'soft',
  app_update_message: 'Please update',
  max_card_approval_naira: '5000000',
  terms_url: 'https://cardelite.ng/terms',
  privacy_url: 'https://cardelite.ng/privacy',
  store_url_android: 'https://play.google.com/store/apps/details?id=com.cardelite.app',
  store_url_ios: 'https://apps.apple.com/app/id1',
  platform_balance_mode: 'static',
  platform_balance_static: '48350000',
  platform_balance_live: '12345.67',
  platform_balance_live_at: '2026-10-02T08:30:00.000Z',
  platform_balance_live_error: '',
  referral_active: 'true',
  referral_referrer_bonus: '500.00',
  referral_referee_bonus: '500',
  referral_min_trade_usd: '50',
  referral_max_per_day: '10',
  levels_active: 'true',
  signup_bonus_active: 'false',
  signup_bonus_amount: '200',
  signup_bonus_condition: 'first_trade',
};

const SUPER: Claims = {
  admin_id: '0b9c2f4e-7a51-4f0e-9d3a-2c1b8e6f4a10',
  username: 'owner',
  role_title: 'Super Admin',
  is_super_admin: true,
  page_permissions: [],
  token_version: 0,
};

function staff(grants: string[]): Claims {
  return {
    admin_id: '6d1e8a3b-2f47-4c9b-8e15-7a0c3d9b5f21',
    username: 'ops',
    role_title: 'Operations',
    is_super_admin: false,
    page_permissions: grants,
    token_version: 0,
  };
}

const LIMITS: RouteSpec = {
  folder: 'limits-fees',
  action: 'UPDATE_LIMITS_FEES',
  legacyKey: null,
  permissions: [],
  keys: [
    'min_withdrawal_amount', 'max_withdrawal_amount', 'max_daily_withdrawal',
    'pin_reset_freeze_hours', 'withdraw_fee', 'large_withdrawal_flag_threshold',
    ...WALLET_CAP_KEYS,
  ],
  privateKeys: WALLET_CAP_KEYS,
  single: { key: 'withdraw_fee', value: '75' },
  batch: { min_withdrawal_amount: '2000', max_withdrawal_amount: '750000' },
  sensitivity: 'financial',
  rejects: [
    [{ withdraw_fee: '-1' }, 'Invalid value for withdraw_fee'],
    [{ min_withdrawal_amount: 'abc' }, 'Invalid value for min_withdrawal_amount'],
    [{ max_daily_withdrawal: 'Infinity' }, 'Invalid value for max_daily_withdrawal'],
    [{ pin_reset_freeze_hours: { hours: 1 } }, 'Invalid value for pin_reset_freeze_hours'],
    [{ withdraw_fee: '10', max_withdrawal_amount: '-5' }, 'Invalid value for max_withdrawal_amount'],
    [{ max_wallet_adjustment_naira: '0' }, 'Invalid value for max_wallet_adjustment_naira'],
    [{ max_wallet_adjustment_naira: '1500.50' }, 'Invalid value for max_wallet_adjustment_naira'],
    [{ max_wallet_adjustment_naira: '007' }, 'Invalid value for max_wallet_adjustment_naira'],
    [{ max_wallet_adjustment_naira: '10000000001' }, 'Invalid value for max_wallet_adjustment_naira'],
    [{ max_wallet_adjustment_daily_naira: '-1' }, 'Invalid value for max_wallet_adjustment_daily_naira'],
    [{ max_wallet_adjustment_daily_naira: '1e6' }, 'Invalid value for max_wallet_adjustment_daily_naira'],
    [{ max_wallet_adjustment_daily_naira: ' 2000000' }, 'Invalid value for max_wallet_adjustment_daily_naira'],
    [{ max_wallet_adjustment_daily_naira: 2000000.5 }, 'Invalid value for max_wallet_adjustment_daily_naira'],
    [{ max_wallet_adjustment_daily_naira: null }, 'Invalid value for max_wallet_adjustment_daily_naira'],
  ],
  accepts: [
    [{ withdraw_fee: '0' }, { withdraw_fee: '0' }],
    [{ max_withdrawal_amount: 2500000 }, { max_withdrawal_amount: '2500000' }],
    [{ pin_reset_freeze_hours: '1000' }, { pin_reset_freeze_hours: '1000' }],
    [{ max_wallet_adjustment_naira: '750000' }, { max_wallet_adjustment_naira: '750000' }],
    [{ max_wallet_adjustment_daily_naira: 3000000 }, { max_wallet_adjustment_daily_naira: '3000000' }],
    [{ max_wallet_adjustment_naira: '10000000000' }, { max_wallet_adjustment_naira: '10000000000' }],
  ],
};

const BILLS: RouteSpec = {
  folder: 'bill-settings',
  action: 'UPDATE_BILL_SETTINGS',
  legacyKey: 'bill_settings',
  permissions: ['providers.read', 'providers.write'],
  keys: ['airtime_quick_amounts', 'electricity_quick_amounts', 'min_airtime_amount', 'min_electricity_amount'],
  privateKeys: null,
  single: { key: 'min_airtime_amount', value: '100' },
  batch: { min_electricity_amount: '600', airtime_quick_amounts: '50,100,200' },
  sensitivity: 'financial',
  rejects: [
    [{ airtime_quick_amounts: 100 }, 'Invalid value for airtime_quick_amounts'],
    [{ electricity_quick_amounts: ' , ,' }, 'electricity_quick_amounts cannot be empty'],
    [{ airtime_quick_amounts: '100,-5' }, 'Invalid number in airtime_quick_amounts: -5'],
    [{ airtime_quick_amounts: '100,abc' }, 'Invalid number in airtime_quick_amounts: abc'],
    [{ min_electricity_amount: '-1' }, 'Invalid value for min_electricity_amount'],
  ],
  accepts: [
    [{ airtime_quick_amounts: '100, 200,500' }, { airtime_quick_amounts: '100, 200,500' }],
    [{ min_airtime_amount: 0 }, { min_airtime_amount: '0' }],
  ],
};

const ANOMALY: RouteSpec = {
  folder: 'anomaly-alerts',
  action: 'UPDATE_ANOMALY_ALERTS',
  legacyKey: 'anomaly_alerts',
  permissions: ['anomaly.read', 'anomaly.write'],
  keys: [
    'anomaly_dormant_days', 'anomaly_dormant_amount', 'anomaly_rapid_window_mins', 'anomaly_rapid_ratio',
    'anomaly_failures_window_mins', 'anomaly_failures_threshold', 'alert_critical_amount', 'alert_timezone',
    'security_alerts_batch_size',
  ],
  privateKeys: null,
  single: { key: 'anomaly_rapid_ratio', value: '0.9' },
  batch: { anomaly_dormant_days: '45', alert_timezone: 'Europe/London' },
  sensitivity: 'security',
  rejects: [
    [{ alert_timezone: '' }, 'Invalid value for alert_timezone'],
    [{ alert_timezone: 'A'.repeat(65) }, 'Invalid value for alert_timezone'],
    [{ alert_timezone: 1 }, 'Invalid value for alert_timezone'],
    [{ anomaly_rapid_ratio: '-0.1' }, 'Invalid value for anomaly_rapid_ratio'],
    [{ security_alerts_batch_size: 'ten' }, 'Invalid value for security_alerts_batch_size'],
  ],
  accepts: [
    [{ alert_timezone: 'Z'.repeat(64) }, { alert_timezone: 'Z'.repeat(64) }],
    [{ anomaly_rapid_ratio: '1.5' }, { anomaly_rapid_ratio: '1.5' }],
  ],
};

const SECURITY: RouteSpec = {
  folder: 'security-limits',
  action: 'UPDATE_SECURITY_LIMITS',
  legacyKey: 'security_limits',
  permissions: ['security.read', 'security.write'],
  keys: ['signup_rate_limit_per_hour', 'paystack_webhook_ips', 'monnify_webhook_ips', 'novac_webhook_ips'],
  privateKeys: null,
  single: { key: 'signup_rate_limit_per_hour', value: '10' },
  batch: { paystack_webhook_ips: '52.31.139.75', monnify_webhook_ips: '35.242.133.146,35.242.133.147' },
  sensitivity: 'security',
  rejects: [
    [{ paystack_webhook_ips: '52.31.139.75, 256.1.1.1' }, 'Invalid IP: 256.1.1.1'],
    [{ novac_webhook_ips: '10.0.0.1/24' }, 'Invalid IP: 10.0.0.1/24'],
    [{ monnify_webhook_ips: ['35.242.133.146'] }, 'Invalid value for monnify_webhook_ips'],
    [{ signup_rate_limit_per_hour: '-3' }, 'Invalid value for signup_rate_limit_per_hour'],
  ],
  accepts: [
    [{ paystack_webhook_ips: '' }, { paystack_webhook_ips: '' }],
    [{ novac_webhook_ips: '41.58.1.10, 41.58.1.11' }, { novac_webhook_ips: '41.58.1.10, 41.58.1.11' }],
  ],
};

const SPECS: readonly RouteSpec[] = [LIMITS, BILLS, ANOMALY, SECURITY];
const APP_CONFIG = 'app-config';
const ADMIN_SETTINGS = 'admin-settings';
const PLATFORM_BALANCE = 'platform-balance';
const FOLDERS: readonly string[] = [...SPECS.map((spec) => spec.folder), APP_CONFIG, ADMIN_SETTINGS, PLATFORM_BALANCE];

const COMMON_REJECTS: ReadonlyArray<[unknown, string]> = [
  ['not json', 'No changes'],
  [null, 'No changes'],
  [{}, 'No changes'],
  [{ changes: 'withdraw_fee=1' }, 'No changes'],
  [{ changes: null }, 'No changes'],
  [{ changes: {} }, 'Nothing to update'],
  [{ changes: { not_a_setting: '1' } }, 'Nothing to update'],
  [{ changes: ['1'] }, 'Nothing to update'],
];

const UNKNOWN_OUTCOMES: ReadonlyArray<[CasControl, string]> = [
  [{ error: { code: '', message: 'TypeError: fetch failed' } }, 'TypeError: fetch failed'],
  [{ error: { message: 'Bad gateway' } }, 'Bad gateway'],
  [{ throws: true }, 'fetch failed'],
  [{ data: null }, UNREADABLE],
  [{ data: { applied: 'yes' } }, UNREADABLE],
  [{ data: { applied: true, changed: 'withdraw_fee', unchanged: [], before: {} } }, UNREADABLE],
];

const SETTLED_FAILURES: ReadonlyArray<[CasControl, string]> = [
  [{ error: { code: 'P0001', message: 'Invalid config changes' } }, 'Invalid config changes'],
  [{ error: { code: 'P0001', message: 'Invalid config expected' } }, 'Invalid config expected'],
  [
    { error: { code: 'PGRST202', message: `Could not find the function public.${CAS}(p_changes, p_expected) in the schema cache` } },
    `Could not find the function public.${CAS}(p_changes, p_expected) in the schema cache`,
  ],
  [{ error: { code: '40P01', message: 'deadlock detected' } }, 'deadlock detected'],
];

function failure(message: string | undefined): DbResult | null {
  return message ? { data: null, error: { message } } : null;
}

function isTextMap(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, item]) => key !== '' && typeof item === 'string');
}

function raised(message: string): DbResult {
  return { data: null, error: { code: 'P0001', message } };
}

function emulateCompareAndSet(db: FakeDb, args: unknown): DbResult {
  const sent: unknown = JSON.parse(JSON.stringify(args ?? null));
  const params = sent !== null && typeof sent === 'object' && !Array.isArray(sent) ? (sent as Record<string, unknown>) : {};
  const names = Object.keys(params).sort();
  if (names.join(',') !== CAS_PARAMS.join(',')) {
    return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${CAS}(${names.join(', ')})` } };
  }
  const changes = params.p_changes;
  if (!isTextMap(changes)) return raised('Invalid config changes');
  const expected = params.p_expected === null ? {} : params.p_expected;
  if (!isTextMap(expected)) return raised('Invalid config expected');
  const listed = Array.isArray(params.p_private_keys) ? params.p_private_keys : [];
  const privateKeys = listed.filter((key): key is string => typeof key === 'string' && key !== '');
  const owns = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);
  const keys = [...new Set([...Object.keys(changes), ...Object.keys(expected), ...privateKeys])].sort();
  const changed: string[] = [];
  const unchanged: string[] = [];
  const before: Record<string, string | null> = {};
  const conflicts: Array<{ key: string; current: string | null }> = [];
  for (const key of keys) {
    const current = db.config.get(key) ?? null;
    if (owns(changes, key)) {
      if (current !== null && current === changes[key]) {
        unchanged.push(key);
        continue;
      }
      changed.push(key);
      before[key] = current;
      if (owns(expected, key) && (current ?? '') !== expected[key]) conflicts.push({ key, current });
    } else if (owns(expected, key) && (current ?? '') !== expected[key]) {
      conflicts.push({ key, current });
    }
  }
  if (conflicts.length > 0) return { data: { applied: false, conflicts }, error: null };
  for (const key of changed) {
    const existed = db.config.has(key);
    db.config.set(key, changes[key]);
    if (privateKeys.includes(key)) db.hidden.add(key);
    else if (!existed) db.hidden.delete(key);
  }
  for (const key of privateKeys) if (db.config.has(key)) db.hidden.add(key);
  return { data: { applied: true, changed, unchanged, before }, error: null };
}

async function compareAndSetCall(db: FakeDb, args: unknown): Promise<DbResult> {
  const control = db.cas;
  control.beforeRun?.(db);
  if (control.throws) throw new Error('fetch failed');
  if (control.error) return { data: null, error: { ...control.error } };
  if (control.data !== undefined) return { data: control.data, error: null };
  const result = emulateCompareAndSet(db, args);
  if (!result.error) db.casResults.push(result.data);
  return result;
}

function execute(db: FakeDb, operation: Operation): DbResult {
  db.operations.push({ ...operation });
  if (operation.table === 'app_config' && operation.kind === 'select') {
    const failed = failure(db.failures.read);
    if (failed) return failed;
    const columns = (operation.columns ?? '').split(',').map((column) => column.trim());
    const wanted = new Set(operation.filter?.values ?? []);
    const rows = [...db.config]
      .filter(([key]) => !operation.filter || wanted.has(key))
      .map(([key, value]) => {
        const row: Record<string, unknown> = { key, value };
        if (columns.includes('is_public')) row.is_public = !db.hidden.has(key);
        if (columns.includes('updated_at')) row.updated_at = STAMP;
        return row;
      });
    return { data: rows, error: null };
  }
  if (operation.table === 'audit_log' && operation.kind === 'insert') {
    const failed = failure(db.failures.audit);
    if (failed) return failed;
    db.audits.push(operation.rows as Record<string, unknown>);
    return { data: null, error: null };
  }
  throw new Error(`unexpected ${operation.kind} on ${operation.table}`);
}

function createDb(seed: Readonly<Record<string, string | null>>): FakeDb {
  const db: FakeDb = {
    config: new Map(Object.entries(seed)),
    hidden: new Set([SECRET_KEY]),
    audits: [],
    operations: [],
    failures: {},
    cas: {},
    casResults: [],
    from(table) {
      const operation: Operation = { kind: 'select', table };
      const query: FakeQuery = {
        select(columns) {
          operation.kind = 'select';
          operation.columns = columns;
          return query;
        },
        in(column, values) {
          operation.filter = { column, values: [...values] };
          return query;
        },
        insert(rows) {
          operation.kind = 'insert';
          operation.rows = rows;
          return query;
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve().then(() => execute(db, operation)).then(onFulfilled, onRejected);
        },
      };
      return query;
    },
    async rpc(name, args) {
      db.operations.push({ kind: 'rpc', table: '', name, args });
      if (name === CAS) return compareAndSetCall(db, args);
      if (name === 'edge_cache_delete') {
        if (db.failures.cacheThrows) throw new Error('cache endpoint unreachable');
        return failure(db.failures.cache) ?? { data: null, error: null };
      }
      if (name === 'build_marketplace_feed_cache') return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return db;
}

const harness: Harness = { db: createDb(SEED), claims: SUPER, headers: {} };
(globalThis as unknown as Record<string, unknown>)[HARNESS_KEY] = harness;

function reset(claims: Claims | null = SUPER): void {
  harness.db = createDb(SEED);
  harness.claims = claims;
  harness.headers = { 'x-request-id': REQUEST_ID, 'user-agent': USER_AGENT, 'x-forwarded-for': CLIENT_IP };
}

const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const stubHarness = `const harness = () => globalThis.${HARNESS_KEY};`;

const FILE_STUBS: Readonly<Record<string, string>> = {
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: moduleUrl(`${stubHarness}
export const supabaseAdmin = {
  from: (table) => harness().db.from(table),
  rpc: (name, args) => harness().db.rpc(name, args),
};`),
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: moduleUrl(`${stubHarness}
export async function verifyAdminFromRequest() { return harness().claims; }`),
};

const PACKAGE_STUBS: Readonly<Record<string, string>> = {
  'next/headers': moduleUrl(`${stubHarness}
export async function headers() { return new Headers(harness().headers); }
export async function cookies() { return { get: () => undefined }; }`),
  'next/server': moduleUrl('export const NextResponse = { json: (body, init) => Response.json(body, init) };'),
};

const IMPORTS = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;
const bundles = new Map<string, Promise<string>>();

function resolveImport(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const found = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]
    .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
  if (!found) throw new Error(`${fromFile} imports ${specifier}, which does not resolve to a .ts file`);
  return found;
}

async function compile(file: string): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const targets = new Map<string, string>();
  for (const [, , specifier] of outputText.matchAll(IMPORTS)) {
    if (targets.has(specifier)) continue;
    if (specifier.startsWith('.')) {
      const target = resolveImport(file, specifier);
      targets.set(specifier, FILE_STUBS[target] ?? (await bundle(target)));
    } else if (PACKAGE_STUBS[specifier]) {
      targets.set(specifier, PACKAGE_STUBS[specifier]);
    } else {
      throw new Error(`${file} imports ${specifier}, which this test does not provide`);
    }
  }
  return moduleUrl(outputText.replace(IMPORTS, (match, head: string, specifier: string) => {
    const target = targets.get(specifier);
    return target ? `${head}'${target}'` : match;
  }));
}

function bundle(file: string): Promise<string> {
  let pending = bundles.get(file);
  if (!pending) {
    pending = compile(file);
    bundles.set(file, pending);
  }
  return pending;
}

function routeFile(folder: string): string {
  return resolve(APP_DIR, 'api', folder, 'route.ts');
}

const CAS_FILE = resolve(APP_DIR, 'lib', 'configCas.ts');

const routes = new Map<string, RouteModule>();
let grantRules: GrantRules;
let settingsRules: SettingsRules;
let cas: CasModule;
let storableGrants: string[] = [];

before(async () => {
  for (const folder of FOLDERS) {
    routes.set(folder, (await import(await bundle(routeFile(folder)))) as RouteModule);
  }
  cas = (await import(await bundle(CAS_FILE))) as CasModule;
  settingsRules = await loadAppModule<SettingsRules>('(dashboard)/admin-settings/rules.ts');
  grantRules = await loadAppModule<GrantRules>('(dashboard)/admin-accounts/rules.ts');
  storableGrants = [...new Set([
    ...grantRules.PAGE_KEYS,
    ...grantRules.RETIRED_PAGE_KEYS,
    ...grantRules.ADDITIONAL_PERMISSIONS,
  ])];
});

beforeEach(() => {
  reset();
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  mock.restoreAll();
});

function route(folder: string): RouteModule {
  const loaded = routes.get(folder);
  if (!loaded) throw new Error(`${folder} route was not loaded`);
  return loaded;
}

function patchRequest(body: unknown): Request {
  return new Request('http://admin.test/api/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function reply(response: Response): Promise<Reply> {
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    requestHeader: response.headers.get('x-request-id'),
  };
}

async function getRoute(folder: string, query = ''): Promise<Reply> {
  return reply(await route(folder).GET(new Request(`http://admin.test/api/${folder}${query}`)));
}

async function patchRoute(folder: string, body: unknown): Promise<Reply> {
  return reply(await route(folder).PATCH(patchRequest(body)));
}

async function get(spec: RouteSpec): Promise<Reply> {
  return getRoute(spec.folder);
}

async function patch(spec: RouteSpec, body: unknown): Promise<Reply> {
  return patchRoute(spec.folder, body);
}

function kinds(): string[] {
  return harness.db.operations.map((operation) => `${operation.kind}:${operation.kind === 'rpc' ? operation.name : operation.table}`);
}

function casArgs(): Record<string, unknown> {
  const calls = harness.db.operations.filter((operation) => operation.kind === 'rpc' && operation.name === CAS);
  assert.equal(calls.length, 1, 'exactly one compare-and-set call');
  const args = calls[0].args as Record<string, unknown>;
  assert.deepEqual(Object.keys(args).sort(), CAS_PARAMS);
  for (const name of CAS_PARAMS) assert.notEqual(args[name], undefined, `${name} must be null, never undefined`);
  return args;
}

function loggedText(): string {
  const spy = console.error as unknown as { mock: { calls: Array<{ arguments: unknown[] }> } };
  return JSON.stringify(spy.mock.calls.map((call) => call.arguments));
}

function oldRule(spec: RouteSpec, claims: Claims): boolean {
  if (claims.is_super_admin) return true;
  return spec.legacyKey !== null && claims.page_permissions.includes(spec.legacyKey);
}

function privateKeysOf(spec: RouteSpec): string[] | null {
  return spec.privateKeys ? [...spec.privateKeys] : null;
}

function otherKey(spec: RouteSpec): string {
  const key = spec.keys.find((candidate) => candidate !== spec.single.key);
  if (!key) throw new Error(`${spec.folder} needs a second key`);
  return key;
}

function auditEntry(fields: AuditFields) {
  return {
    admin_id: SUPER.admin_id,
    user_id: null,
    action: fields.action,
    entity: 'app_config',
    entity_id: fields.entity_id,
    before_value: fields.before_value,
    after_value: fields.after_value,
    ip_address: CLIENT_IP,
    admin_role: SUPER.role_title,
    user_agent: USER_AGENT,
    request_id: REQUEST_ID,
    reason: fields.reason ?? null,
    result: fields.result ?? 'success',
    error: fields.error ?? null,
    sensitivity: fields.sensitivity,
  };
}

function auditRow(spec: RouteSpec, fields: {
  entity_id: string;
  before_value: unknown;
  after_value: unknown;
  result?: string;
  error?: string | null;
}) {
  return auditEntry({ action: spec.action, sensitivity: spec.sensitivity, ...fields });
}

function failureBody(message: string, code: string) {
  return { success: false, error: message, code, message, request_id: REQUEST_ID };
}

function seenSettings(): Record<string, string> {
  const seen: Record<string, string> = {};
  for (const key of settingsRules.SETTINGS_KEYS) seen[key] = harness.db.config.get(key) ?? '';
  return seen;
}

function storeConfig(values: Readonly<Record<string, string | null | undefined>>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) harness.db.config.delete(key);
    else harness.db.config.set(key, value);
  }
}

describe('access rules', () => {
  test('the mapped actions can only come from their own legacy page key', () => {
    for (const spec of SPECS) {
      for (const permission of spec.permissions) {
        assert.equal(grantRules.isAcceptedGrant(permission), false, `${permission} must not be storable directly`);
        const sources = storableGrants.filter((grant) => resolvePermissions([grant], false).has(permission));
        assert.deepEqual(sources, [spec.legacyKey], permission);
      }
    }
  });

  for (const spec of SPECS) {
    test(`${spec.folder}: no session is 401 and touches nothing`, async () => {
      reset(null);
      const read = await get(spec);
      assert.equal(read.status, 401);
      assert.equal(read.body.code, 'AUTH_REQUIRED');
      const write = await patch(spec, { changes: { [spec.single.key]: spec.single.value } });
      assert.equal(write.status, 401);
      assert.equal(write.body.code, 'AUTH_REQUIRED');
      assert.deepEqual(harness.db.operations, []);
    });

    test(`${spec.folder}: a super admin with no grants can read and write`, async () => {
      reset(SUPER);
      assert.equal((await get(spec)).status, 200);
      assert.equal((await patch(spec, { changes: { [spec.single.key]: spec.single.value } })).status, 200);
    });

    test(`${spec.folder}: every grant the admin editor can store opens it exactly when the old rule did`, async () => {
      const opened: string[] = [];
      for (const grant of storableGrants) {
        const claims = staff([grant]);
        const allowed = oldRule(spec, claims);
        reset(claims);
        const read = await get(spec);
        const readOperations = harness.db.operations.length;
        reset(claims);
        const write = await patch(spec, { changes: { [spec.single.key]: spec.single.value } });
        if (allowed) {
          opened.push(grant);
          assert.equal(read.status, 200, `${grant} GET`);
          assert.equal(write.status, 200, `${grant} PATCH`);
          continue;
        }
        assert.equal(read.status, 403, `${grant} GET`);
        assert.equal(read.body.code, 'PERMISSION_DENIED', `${grant} GET`);
        assert.equal(typeof read.body.error, 'string');
        assert.equal(readOperations, 0, `${grant} GET touched the database`);
        assert.equal(write.status, 403, `${grant} PATCH`);
        assert.equal(write.body.code, 'PERMISSION_DENIED', `${grant} PATCH`);
        assert.deepEqual(harness.db.operations, [], `${grant} PATCH touched the database`);
      }
      assert.deepEqual(opened, spec.legacyKey ? [spec.legacyKey] : []);
    });

    test(`${spec.folder}: holding every other storable grant is still refused with 403`, async () => {
      const claims = staff(storableGrants.filter((grant) => grant !== spec.legacyKey));
      reset(claims);
      assert.equal((await get(spec)).status, 403);
      assert.equal((await patch(spec, { changes: { [spec.single.key]: spec.single.value } })).status, 403);
      assert.deepEqual(harness.db.audits, []);
    });
  }

  test('limits-fees stays super-admin only even for the limits_fees grant', async () => {
    reset(staff(['limits_fees']));
    const read = await get(LIMITS);
    assert.equal(read.status, 403);
    assert.equal(read.body.code, 'PERMISSION_DENIED');
    const write = await patch(LIMITS, { changes: { withdraw_fee: '75' } });
    assert.equal(write.status, 403);
    assert.equal(harness.db.config.get('withdraw_fee'), SEED.withdraw_fee);
  });

  test('the other app_config writers keep their guards', async () => {
    for (const folder of [APP_CONFIG, ADMIN_SETTINGS]) {
      reset(staff(storableGrants));
      const write = await patchRoute(folder, { changes: { terms_url: 'https://cardelite.ng/t2' } });
      assert.equal(write.status, 403, folder);
      assert.equal(write.body.error, 'This action is restricted to super administrators.', folder);
      assert.deepEqual(harness.db.operations, [], folder);
    }
    reset(staff([]));
    const balance = await patchRoute(PLATFORM_BALANCE, { changes: { platform_balance_mode: 'live' } });
    assert.equal(balance.status, 403);
    assert.deepEqual(balance.body.details, { required: ['platform_balance.write'] });
    assert.deepEqual(harness.db.operations, []);
  });
});

for (const spec of SPECS) {
  describe(`${spec.folder}: GET`, () => {
    test('returns the legacy { config } map for exactly its keys, inside the envelope', async () => {
      const [nulled, missing, ...rest] = spec.keys;
      harness.db.config.set(nulled, null);
      harness.db.config.delete(missing);
      const res = await get(spec);
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.request_id, REQUEST_ID);
      assert.equal(res.requestHeader, REQUEST_ID);
      const expected: Record<string, string | null> = { [nulled]: null };
      for (const key of rest) expected[key] = SEED[key];
      assert.deepEqual(res.body.config, expected);
      assert.deepEqual(harness.db.operations, [
        { kind: 'select', table: 'app_config', columns: 'key, value', filter: { column: 'key', values: [...spec.keys] } },
      ]);
    });

    test('a failed read is a 500 that does not echo the database message', async () => {
      harness.db.failures.read = 'relation "app_config" does not exist';
      const res = await get(spec);
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, failureBody(LOAD_FAILED, 'INTERNAL_ERROR'));
    });
  });

  describe(`${spec.folder}: PATCH validation keeps the old rules and messages`, () => {
    test('malformed bodies are refused before the database is called', async () => {
      for (const [body, message] of COMMON_REJECTS) {
        reset();
        const res = await patch(spec, body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.deepEqual(res.body, failureBody(message, 'VALIDATION_ERROR'), JSON.stringify(body));
        assert.deepEqual(harness.db.operations, []);
      }
    });

    test('keys owned by another configuration page are ignored', async () => {
      const foreign = SPECS.find((candidate) => candidate !== spec);
      assert.ok(foreign);
      const res = await patch(spec, { changes: { [foreign.single.key]: foreign.single.value } });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Nothing to update');
      assert.equal(harness.db.config.get(foreign.single.key), SEED[foreign.single.key]);
    });

    test('invalid values are refused with the same messages and nothing is written', async () => {
      for (const [changes, message] of spec.rejects) {
        reset();
        const res = await patch(spec, { changes });
        assert.equal(res.status, 400, message);
        assert.deepEqual(res.body, failureBody(message, 'VALIDATION_ERROR'));
        assert.deepEqual(harness.db.operations, [], message);
        assert.deepEqual(harness.db.audits, []);
      }
    });

    test('values inside the old bounds are still accepted and stored as sent', async () => {
      for (const [changes, stored] of spec.accepts) {
        reset();
        const res = await patch(spec, { changes });
        assert.equal(res.status, 200, JSON.stringify(changes));
        assert.deepEqual(casArgs().p_changes, stored);
        for (const [key, value] of Object.entries(stored)) assert.equal(harness.db.config.get(key), value);
      }
    });
  });

  describe(`${spec.folder}: PATCH writes`, () => {
    const { key, value } = spec.single;

    test('sends one compare-and-set call, clears the public config cache and audits before and after', async () => {
      const res = await patch(spec, { changes: { [key]: value, not_a_setting: 'ignored' } });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        success: true, request_id: REQUEST_ID, changed: [key], unchanged: [], audit_recorded: true,
      });
      assert.equal(res.requestHeader, REQUEST_ID);
      assert.equal(harness.db.config.get(key), value);
      assert.equal(harness.db.config.has('not_a_setting'), false);
      assert.deepEqual(kinds(), [`rpc:${CAS}`, 'rpc:edge_cache_delete', 'insert:audit_log']);
      assert.deepEqual(casArgs(), { p_changes: { [key]: value }, p_expected: null, p_private_keys: privateKeysOf(spec) });
      assert.deepEqual(harness.db.operations[1].args, { p_key: PUBLIC_CACHE_KEY });
      assert.deepEqual(harness.db.audits, [
        auditRow(spec, { entity_id: key, before_value: { [key]: SEED[key] }, after_value: { [key]: value } }),
      ]);
    });

    test('a batch is one call, answered in request order although the database sorts the keys', async () => {
      const keys = Object.keys(spec.batch);
      const res = await patch(spec, { changes: spec.batch });
      assert.equal(res.status, 200);
      assert.deepEqual(casArgs().p_changes, spec.batch);
      assert.deepEqual(harness.db.casResults, [{
        applied: true,
        changed: [...keys].sort(),
        unchanged: [],
        before: Object.fromEntries(keys.map((name) => [name, SEED[name]])),
      }]);
      assert.notDeepEqual([...keys].sort(), keys, 'the batch must be out of byte order to prove the re-sort');
      assert.deepEqual(res.body.changed, keys);
      assert.deepEqual(kinds(), [`rpc:${CAS}`, 'rpc:edge_cache_delete', 'insert:audit_log']);
      const before: Record<string, string> = {};
      for (const name of keys) before[name] = SEED[name];
      assert.deepEqual(harness.db.audits, [
        auditRow(spec, { entity_id: 'batch', before_value: before, after_value: { ...spec.batch } }),
      ]);
    });

    test('values that are already stored are skipped: no cache clear, no empty audit row', async () => {
      const keys = Object.keys(spec.batch);
      const same: Record<string, string> = {};
      for (const name of keys) same[name] = SEED[name];
      const res = await patch(spec, { changes: same });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { success: true, request_id: REQUEST_ID, changed: [], unchanged: keys });
      assert.deepEqual(kinds(), [`rpc:${CAS}`]);
      assert.deepEqual(casArgs().p_changes, same);
      assert.deepEqual(harness.db.audits, []);
    });

    test('only the keys that actually change are audited', async () => {
      const kept = otherKey(spec);
      const res = await patch(spec, { changes: { [key]: value, [kept]: SEED[kept] } });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.changed, [key]);
      assert.deepEqual(res.body.unchanged, [kept]);
      assert.deepEqual(casArgs().p_changes, { [key]: value, [kept]: SEED[kept] });
      assert.deepEqual(harness.db.audits[0].before_value, { [key]: SEED[key] });
      assert.deepEqual(harness.db.audits[0].after_value, { [key]: value });
    });

    test('a missing row is created as a public row and audited with a null before value', async () => {
      harness.db.config.delete(key);
      const res = await patch(spec, { changes: { [key]: value } });
      assert.equal(res.status, 200);
      assert.equal(harness.db.config.get(key), value);
      assert.equal(harness.db.hidden.has(key), false);
      assert.deepEqual(harness.db.audits[0].before_value, { [key]: null });
    });

    test('a database error is a 500 that is audited as a failure and leaves the cache alone', async () => {
      harness.db.cas.error = { code: '42501', message: `permission denied for function ${CAS}` };
      const res = await patch(spec, { changes: { [key]: value } });
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, failureBody(NOT_SAVED, 'INTERNAL_ERROR'));
      assert.deepEqual(kinds(), [`rpc:${CAS}`, 'insert:audit_log']);
      assert.equal(harness.db.config.get(key), SEED[key]);
      assert.deepEqual(harness.db.audits, [
        auditRow(spec, {
          entity_id: key,
          before_value: null,
          after_value: { [key]: value },
          result: 'failure',
          error: `permission denied for function ${CAS}`,
        }),
      ]);
    });

    test('every other way the call can fail is the same 500, audited with what went wrong', async () => {
      for (const [control, message] of [...SETTLED_FAILURES, ...UNKNOWN_OUTCOMES]) {
        reset();
        harness.db.cas = control;
        const res = await patch(spec, { changes: spec.batch });
        assert.equal(res.status, 500, message);
        assert.deepEqual(res.body, failureBody(NOT_SAVED, 'INTERNAL_ERROR'), message);
        assert.deepEqual(kinds(), [`rpc:${CAS}`, 'insert:audit_log'], message);
        assert.deepEqual(harness.db.audits, [
          auditRow(spec, { entity_id: 'batch', before_value: null, after_value: { ...spec.batch }, result: 'failure', error: message }),
        ], message);
      }
    });

    test('a conflict reported without rows (a concurrent insert) is a 409 with the generic message', async () => {
      harness.db.cas.data = { applied: false, conflicts: [] };
      const res = await patch(spec, { changes: { [key]: value } });
      assert.equal(res.status, 409);
      assert.deepEqual(res.body, { ...failureBody(RACE, 'STATE_CONFLICT'), details: { conflicts: [] } });
      assert.deepEqual(kinds(), [`rpc:${CAS}`]);
      assert.deepEqual(harness.db.audits, []);
    });

    test('a failed audit write keeps the saved change and says so', async () => {
      harness.db.failures.audit = 'audit insert refused';
      const res = await patch(spec, { changes: { [key]: value } });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        success: true, request_id: REQUEST_ID, changed: [key], unchanged: [], audit_recorded: false, warning: AUDIT_WARNING,
      });
      assert.equal(harness.db.config.get(key), value);
    });

    test('a cache clear that errors or throws does not fail the save', async () => {
      harness.db.failures.cache = 'cache table locked';
      const errored = await patch(spec, { changes: { [key]: value } });
      assert.equal(errored.status, 200);
      assert.equal(errored.body.audit_recorded, true);
      reset();
      harness.db.failures.cacheThrows = true;
      const thrown = await patch(spec, { changes: { [key]: value } });
      assert.equal(thrown.status, 200);
      assert.equal(harness.db.audits.length, 1);
    });
  });

  describe(`${spec.folder}: PATCH optional expected map`, () => {
    const { key, value } = spec.single;

    test('a matching expected value saves', async () => {
      const res = await patch(spec, { changes: { [key]: value }, expected: { [key]: SEED[key] } });
      assert.equal(res.status, 200);
      assert.deepEqual(casArgs(), {
        p_changes: { [key]: value }, p_expected: { [key]: SEED[key] }, p_private_keys: privateKeysOf(spec),
      });
      assert.equal(harness.db.config.get(key), value);
    });

    test('a stale expected value is refused with 409 STATE_CONFLICT and nothing changes', async () => {
      harness.db.config.set(key, '7');
      const res = await patch(spec, { changes: { [key]: value }, expected: { [key]: SEED[key] } });
      assert.equal(res.status, 409);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'STATE_CONFLICT');
      assert.equal(
        res.body.error,
        `Another admin changed ${key} after you loaded it, so nothing was saved. Reload to see the current values.`,
      );
      assert.equal(res.body.message, res.body.error);
      assert.deepEqual(res.body.details, { conflicts: [{ key, current: '7' }] });
      assert.deepEqual(kinds(), [`rpc:${CAS}`]);
      assert.deepEqual(harness.db.audits, []);
      assert.equal(harness.db.config.get(key), '7');
    });

    test('an empty or null expected value matches a row that does not exist', async () => {
      for (const seen of ['', null]) {
        reset();
        harness.db.config.delete(key);
        const res = await patch(spec, { changes: { [key]: value }, expected: { [key]: seen } });
        assert.equal(res.status, 200, String(seen));
        assert.deepEqual(casArgs().p_expected, { [key]: '' });
        assert.equal(harness.db.config.get(key), value);
      }
    });

    test('an empty expected value does not match a stored value', async () => {
      const res = await patch(spec, { changes: { [key]: value }, expected: { [key]: '' } });
      assert.equal(res.status, 409);
      assert.deepEqual(res.body.details, { conflicts: [{ key, current: SEED[key] }] });
    });

    test('a key already at the requested value is not a conflict', async () => {
      const res = await patch(spec, { changes: { [key]: SEED[key] }, expected: { [key]: 'something older' } });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.unchanged, [key]);
      assert.deepEqual(kinds(), [`rpc:${CAS}`]);
    });

    test('expected entries for keys that are not being changed are not sent', async () => {
      const res = await patch(spec, {
        changes: { [key]: value },
        expected: { [otherKey(spec)]: 'stale', not_a_setting: { nested: true } },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(casArgs(), { p_changes: { [key]: value }, p_expected: {}, p_private_keys: privateKeysOf(spec) });
      assert.equal(harness.db.config.get(key), value);
    });

    test('a malformed expected map is refused before the database is called', async () => {
      for (const expected of [['x'], 'stale', 12, { [key]: { value: SEED[key] } }, { [key]: true }]) {
        reset();
        const res = await patch(spec, { changes: { [key]: value }, expected });
        assert.equal(res.status, 400, JSON.stringify(expected));
        assert.deepEqual(res.body, failureBody(EXPECTED_SHAPE, 'VALIDATION_ERROR'));
        assert.deepEqual(harness.db.operations, []);
      }
    });

    test('without expected the old last-write-wins contract is unchanged, as mobile relies on', async () => {
      harness.db.config.set(key, '7');
      const res = await patch(spec, { changes: { [key]: value } });
      assert.equal(res.status, 200);
      assert.equal(casArgs().p_expected, null);
      assert.equal(harness.db.config.get(key), value);
      assert.deepEqual(harness.db.audits[0].before_value, { [key]: '7' });
    });
  });
}

describe('limits-fees specifics', () => {
  test('a numeric expected value is compared as the text it stands for', async () => {
    const res = await patch(LIMITS, { changes: { withdraw_fee: '75' }, expected: { withdraw_fee: 50 } });
    assert.equal(res.status, 200);
    assert.deepEqual(casArgs().p_expected, { withdraw_fee: '50' });
  });

  test('several conflicts are named together, in the order they were sent', async () => {
    harness.db.config.set('min_withdrawal_amount', '1500');
    harness.db.config.set('max_withdrawal_amount', '600000');
    const res = await patch(LIMITS, {
      changes: { min_withdrawal_amount: '2000', max_withdrawal_amount: '750000', withdraw_fee: '75' },
      expected: { min_withdrawal_amount: '1000', max_withdrawal_amount: '500000', withdraw_fee: '50' },
    });
    assert.equal(res.status, 409);
    assert.deepEqual(harness.db.casResults, [{
      applied: false,
      conflicts: [
        { key: 'max_withdrawal_amount', current: '600000' },
        { key: 'min_withdrawal_amount', current: '1500' },
      ],
    }]);
    assert.equal(
      res.body.error,
      'Another admin changed min_withdrawal_amount and max_withdrawal_amount after you loaded them, so nothing was saved. Reload to see the current values.',
    );
    assert.deepEqual(res.body.details, {
      conflicts: [
        { key: 'min_withdrawal_amount', current: '1500' },
        { key: 'max_withdrawal_amount', current: '600000' },
      ],
    });
    assert.equal(harness.db.config.get('withdraw_fee'), '50');
  });

  test('money limits and fees are financial, its security controls are security', async () => {
    const cases: ReadonlyArray<[Record<string, string>, string]> = [
      [{ withdraw_fee: '75' }, 'financial'],
      [{ max_daily_withdrawal: '2000000' }, 'financial'],
      [{ pin_reset_freeze_hours: '48' }, 'security'],
      [{ large_withdrawal_flag_threshold: '750000' }, 'security'],
      [{ withdraw_fee: '80', pin_reset_freeze_hours: '12' }, 'security'],
    ];
    for (const [changes, sensitivity] of cases) {
      reset();
      const res = await patch(LIMITS, { changes });
      assert.equal(res.status, 200);
      assert.equal(harness.db.audits[0].sensitivity, sensitivity, JSON.stringify(changes));
      assert.deepEqual(harness.db.audits[0].after_value, changes);
    }
  });

  test('the sensitivity of a batch follows the keys that actually changed', async () => {
    const res = await patch(LIMITS, { changes: { withdraw_fee: '80', pin_reset_freeze_hours: SEED.pin_reset_freeze_hours } });
    assert.equal(res.status, 200);
    assert.equal(harness.db.audits[0].sensitivity, 'financial');
    assert.equal(harness.db.audits[0].entity_id, 'withdraw_fee');
  });

  test('every save keeps both wallet adjustment limits private, whichever setting changes', async () => {
    harness.db.hidden.delete('max_wallet_adjustment_naira');
    const res = await patch(LIMITS, { changes: { withdraw_fee: '80' } });
    assert.equal(res.status, 200);
    assert.deepEqual(casArgs().p_private_keys, [...WALLET_CAP_KEYS]);
    assert.equal(harness.db.hidden.has('max_wallet_adjustment_naira'), true);
    assert.deepEqual(res.body.changed, ['withdraw_fee']);
    assert.deepEqual(harness.db.audits[0].after_value, { withdraw_fee: '80' });
  });

  test('a wallet adjustment limit with no row yet is created private', async () => {
    harness.db.config.delete('max_wallet_adjustment_daily_naira');
    const res = await patch(LIMITS, { changes: { max_wallet_adjustment_daily_naira: '2500000' } });
    assert.equal(res.status, 200);
    assert.equal(harness.db.config.get('max_wallet_adjustment_daily_naira'), '2500000');
    assert.equal(harness.db.hidden.has('max_wallet_adjustment_daily_naira'), true);
    assert.deepEqual(harness.db.audits[0].before_value, { max_wallet_adjustment_daily_naira: null });
  });

  test('changing a wallet adjustment limit is a financial change, audited like the others', async () => {
    const res = await patch(LIMITS, {
      changes: { max_wallet_adjustment_naira: '600000', max_wallet_adjustment_daily_naira: '2400000' },
      expected: { max_wallet_adjustment_naira: '500000', max_wallet_adjustment_daily_naira: '2000000' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.changed, ['max_wallet_adjustment_naira', 'max_wallet_adjustment_daily_naira']);
    assert.deepEqual(harness.db.audits, [auditRow(LIMITS, {
      entity_id: 'batch',
      before_value: { max_wallet_adjustment_naira: '500000', max_wallet_adjustment_daily_naira: '2000000' },
      after_value: { max_wallet_adjustment_naira: '600000', max_wallet_adjustment_daily_naira: '2400000' },
    })]);
  });

  test('the page offers both wallet adjustment limits as whole-naira fields checked against each other', () => {
    const page = readFileSync(resolve(APP_DIR, '(dashboard)', 'admin-settings', 'limits-fees', 'page.tsx'), 'utf8');
    for (const key of WALLET_CAP_KEYS) {
      const start = page.indexOf(`key: '${key}'`);
      assert.ok(start >= 0, key);
      const block = page.slice(start, page.indexOf('},', start));
      assert.match(block, /input: 'number',/, key);
      assert.match(block, /min: 1,/, key);
      assert.match(block, /step: 1,/, key);
      assert.match(block, /validate: wholeNaira\(/, key);
    }
    assert.match(page, /notAbove\('max_wallet_adjustment_daily_naira', 'the daily adjustment limit'\)/);
    assert.match(page, /notBelow\('max_wallet_adjustment_naira', 'the per-adjustment limit'\)/);
  });

  test('the route lists the wallet adjustment limits as its private keys', () => {
    const text = readFileSync(routeFile(LIMITS.folder), 'utf8');
    assert.match(text, /const PRIVATE_KEYS = \['max_wallet_adjustment_naira', 'max_wallet_adjustment_daily_naira'\];/);
    assert.match(text, /compareAndSet\(\{ changes, expected, privateKeys: PRIVATE_KEYS, order: requested \}\)/);
  });
});

describe('configCas: the shared caller', () => {
  test('puts keys in the order given, then the rest in the order they came', () => {
    assert.deepEqual(cas.inOrder(['b', 'z', 'a', 'y'], ['a', 'b', 'a']), ['a', 'b', 'z', 'y']);
    assert.deepEqual(cas.inOrder([], ['a']), []);
  });

  test('picks own keys only and reads missing or null values as empty text', () => {
    assert.deepEqual(cas.pick({ a: '1', b: '2' }, ['b', 'c']), { b: '2' });
    assert.deepEqual(cas.seenValues({ a: '1', b: null }, ['a', 'b', 'c', 'constructor']), { a: '1', b: '', c: '', constructor: '' });
  });

  test('reads an applied result, keeping before values only for changed keys', () => {
    assert.deepEqual(
      cas.readConfigCas(
        { applied: true, changed: ['b', 'a'], unchanged: ['c'], before: { a: null, b: '1', c: 'x', d: 5 } },
        ['a', 'b', 'c'],
      ),
      { kind: 'applied', changed: ['a', 'b'], unchanged: ['c'], before: { a: null, b: '1' } },
    );
  });

  test('reads a conflict result in the order given, skipping malformed rows', () => {
    assert.deepEqual(
      cas.readConfigCas(
        { applied: false, conflicts: [{ key: 'b', current: '2' }, { key: 'a', current: null }, { current: 'x' }, 'junk', { key: 'c', current: 3 }] },
        ['c', 'a', 'b'],
      ),
      { kind: 'conflict', conflicts: [{ key: 'c', current: null }, { key: 'a', current: null }, { key: 'b', current: '2' }] },
    );
    assert.deepEqual(cas.readConfigCas({ applied: false }, []), { kind: 'conflict', conflicts: [] });
  });

  test('anything else is an outcome that cannot be confirmed', () => {
    const unknown = { kind: 'failed', outcomeUnknown: true, code: null, message: UNREADABLE };
    for (const data of [null, 'ok', [], {}, { applied: 1 }, { applied: true }, { applied: true, changed: [], unchanged: [1], before: {} },
      { applied: true, changed: [], unchanged: [], before: [] }]) {
      assert.deepEqual(cas.readConfigCas(data, []), unknown, JSON.stringify(data));
    }
  });

  test('sends every named parameter, with null rather than undefined', async () => {
    await cas.compareAndSet({ changes: { withdraw_fee: '60' }, expected: null, privateKeys: null, order: [] });
    assert.deepEqual(casArgs(), { p_changes: { withdraw_fee: '60' }, p_expected: null, p_private_keys: null });
    reset();
    await cas.compareAndSet({ changes: {}, expected: { terms_url: '' }, privateKeys: [SECRET_KEY], order: [] });
    assert.deepEqual(casArgs(), { p_changes: {}, p_expected: { terms_url: '' }, p_private_keys: [SECRET_KEY] });
  });

  test('a database error is settled, a transport failure or a throw is unknown', async () => {
    harness.db.cas.error = { code: 'P0001', message: 'Invalid config changes' };
    assert.deepEqual(
      await cas.compareAndSet({ changes: {}, expected: null, privateKeys: null, order: [] }),
      { kind: 'failed', outcomeUnknown: false, code: 'P0001', message: 'Invalid config changes' },
    );
    harness.db.cas.error = { code: '', message: '' };
    assert.deepEqual(
      await cas.compareAndSet({ changes: {}, expected: null, privateKeys: null, order: [] }),
      { kind: 'failed', outcomeUnknown: true, code: null, message: 'unknown error' },
    );
    harness.db.cas = { throws: true };
    assert.deepEqual(
      await cas.compareAndSet({ changes: {}, expected: null, privateKeys: null, order: [] }),
      { kind: 'failed', outcomeUnknown: true, code: null, message: 'fetch failed' },
    );
  });
});

describe('app-config: PATCH', () => {
  test('a referral value equal in meaning is not written: it is a precondition and reported unchanged', async () => {
    const res = await patchRoute(APP_CONFIG, { changes: { referral_referrer_bonus: '500' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, request_id: REQUEST_ID, changed: [], unchanged: ['referral_referrer_bonus'] });
    assert.deepEqual(casArgs(), {
      p_changes: {},
      p_expected: { referral_referrer_bonus: '500.00' },
      p_private_keys: null,
    });
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`]);
    assert.equal(harness.db.config.get('referral_referrer_bonus'), '500.00');
    assert.deepEqual(harness.db.audits, []);
  });

  test('equal referral values ride along as preconditions while other keys are written in request order', async () => {
    const res = await patchRoute(APP_CONFIG, { changes: { withdraw_fee: 60, referral_referrer_bonus: '₦500', levels_active: false } });
    assert.equal(res.status, 200);
    assert.deepEqual(casArgs(), {
      p_changes: { withdraw_fee: '60', levels_active: 'false' },
      p_expected: { referral_referrer_bonus: '500.00' },
      p_private_keys: null,
    });
    assert.deepEqual(res.body, {
      success: true,
      request_id: REQUEST_ID,
      changed: ['withdraw_fee', 'levels_active'],
      unchanged: ['referral_referrer_bonus'],
      audit_recorded: true,
    });
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`, 'rpc:edge_cache_delete', 'insert:audit_log']);
    assert.deepEqual(harness.db.audits, [auditEntry({
      action: 'UPDATE_APP_CONFIG',
      entity_id: 'batch',
      before_value: { withdraw_fee: '50', levels_active: 'true' },
      after_value: { withdraw_fee: '60', levels_active: 'false' },
      sensitivity: 'financial',
    })]);
  });

  test('a referral value changed by another admin after the read is a 409 naming it, and nothing is written', async () => {
    harness.db.cas.beforeRun = (db) => db.config.set('referral_referrer_bonus', '900');
    const res = await patchRoute(APP_CONFIG, { changes: { referral_referrer_bonus: '500', levels_active: 'false' } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      ...failureBody(
        'Another admin changed Referrer bonus after you loaded it, so nothing was saved. Reload to see the current values.',
        'STATE_CONFLICT',
      ),
      details: { conflicts: [{ key: 'referral_referrer_bonus', label: 'Referrer bonus', current: '900' }] },
    });
    assert.equal(harness.db.config.get('levels_active'), 'true');
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`]);
    assert.deepEqual(harness.db.audits, []);
  });

  test('the expected value of a key being written is passed through and compared raw', async () => {
    const res = await patchRoute(APP_CONFIG, {
      changes: { referral_referee_bonus: '700' },
      expected: { referral_referee_bonus: '400' },
    });
    assert.equal(res.status, 409);
    assert.deepEqual(casArgs().p_expected, { referral_referee_bonus: '400' });
    assert.equal(
      res.body.error,
      'Another admin changed Referred user bonus after you loaded it, so nothing was saved. Reload to see the current values.',
    );
    assert.deepEqual(res.body.details, {
      conflicts: [{ key: 'referral_referee_bonus', label: 'Referred user bonus', current: '500' }],
    });
  });

  test('a referral value that differs is canonicalised, written and audited', async () => {
    const res = await patchRoute(APP_CONFIG, {
      changes: { referral_referee_bonus: '1,000' },
      expected: { referral_referee_bonus: '500' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(casArgs(), {
      p_changes: { referral_referee_bonus: '1000' },
      p_expected: { referral_referee_bonus: '500' },
      p_private_keys: null,
    });
    assert.deepEqual(res.body.changed, ['referral_referee_bonus']);
    assert.equal(harness.db.config.get('referral_referee_bonus'), '1000');
    assert.deepEqual(harness.db.audits[0].before_value, { referral_referee_bonus: '500' });
    assert.equal(harness.db.audits[0].entity_id, 'referral_referee_bonus');
  });

  test('another key at its stored value is sent and reported unchanged by the database', async () => {
    const res = await patchRoute(APP_CONFIG, { changes: { withdraw_fee: '50' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, request_id: REQUEST_ID, changed: [], unchanged: ['withdraw_fee'] });
    assert.deepEqual(casArgs(), { p_changes: { withdraw_fee: '50' }, p_expected: null, p_private_keys: null });
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`]);
  });

  test('a key with no row yet is created as a public row', async () => {
    const res = await patchRoute(APP_CONFIG, { changes: { min_data_amount: '100' } });
    assert.equal(res.status, 200);
    assert.equal(harness.db.config.get('min_data_amount'), '100');
    assert.equal(harness.db.hidden.has('min_data_amount'), false);
    assert.deepEqual(harness.db.audits[0].before_value, { min_data_amount: null });
  });

  test('the mobile bonus and referral screens send only their changes and still save', async () => {
    const bonuses = await patchRoute(APP_CONFIG, { changes: { levels_active: 'false', signup_bonus_amount: '300' } });
    assert.equal(bonuses.status, 200);
    assert.deepEqual(bonuses.body.changed, ['levels_active', 'signup_bonus_amount']);
    reset();
    const referrals = await patchRoute(APP_CONFIG, {
      changes: { referral_active: 'false', referral_referrer_bonus: '600', referral_referee_bonus: '500' },
    });
    assert.equal(referrals.status, 200);
    assert.deepEqual(casArgs(), {
      p_changes: { referral_active: 'false', referral_referrer_bonus: '600' },
      p_expected: { referral_referee_bonus: '500' },
      p_private_keys: null,
    });
    assert.deepEqual(referrals.body.changed, ['referral_active', 'referral_referrer_bonus']);
    assert.deepEqual(referrals.body.unchanged, ['referral_referee_bonus']);
  });

  test('a database error is a 500 audited with the values that were read', async () => {
    harness.db.cas.error = { code: '40001', message: 'could not serialize access due to concurrent update' };
    const res = await patchRoute(APP_CONFIG, { changes: { withdraw_fee: '60', referral_referrer_bonus: '500' } });
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, failureBody(APP_NOT_SAVED, 'INTERNAL_ERROR'));
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`, 'insert:audit_log']);
    assert.deepEqual(harness.db.audits, [auditEntry({
      action: 'UPDATE_APP_CONFIG',
      entity_id: 'withdraw_fee',
      before_value: { withdraw_fee: '50' },
      after_value: { withdraw_fee: '60' },
      sensitivity: 'financial',
      result: 'failure',
      error: 'could not serialize access due to concurrent update',
    })]);
    for (const [control, message] of SETTLED_FAILURES) {
      reset();
      harness.db.cas = control;
      const settled = await patchRoute(APP_CONFIG, { changes: { withdraw_fee: '60' } });
      assert.deepEqual(settled.body, failureBody(APP_NOT_SAVED, 'INTERNAL_ERROR'), message);
      assert.equal(harness.db.audits[0].error, message);
    }
  });

  test('an outcome that cannot be confirmed says so', async () => {
    for (const [control, message] of UNKNOWN_OUTCOMES) {
      reset();
      harness.db.cas = control;
      const res = await patchRoute(APP_CONFIG, { changes: { withdraw_fee: '60' } });
      assert.equal(res.status, 500, message);
      assert.deepEqual(res.body, failureBody(APP_UNCONFIRMED, 'INTERNAL_ERROR'), message);
      assert.equal(harness.db.audits[0].error, message);
      assert.equal(harness.db.audits[0].result, 'failure');
    }
  });

  test('a failure audit leaves out keys that already held the sent value', async () => {
    harness.db.cas.error = { code: '40001', message: 'could not serialize access due to concurrent update' };
    const res = await patchRoute(APP_CONFIG, { changes: { levels_active: 'true', withdraw_fee: '60' } });
    assert.equal(res.status, 500);
    assert.deepEqual(casArgs().p_changes, { levels_active: 'true', withdraw_fee: '60' });
    assert.equal(harness.db.audits.length, 1);
    assert.equal(harness.db.audits[0].entity_id, 'withdraw_fee');
    assert.deepEqual(harness.db.audits[0].before_value, { withdraw_fee: '50' });
    assert.deepEqual(harness.db.audits[0].after_value, { withdraw_fee: '60' });
    reset();
    harness.db.cas.error = { code: '40001', message: 'could not serialize access due to concurrent update' };
    const same = await patchRoute(APP_CONFIG, { changes: { levels_active: 'true' } });
    assert.equal(same.status, 500);
    assert.deepEqual(harness.db.audits, []);
  });

  test('a failure with nothing to write is a 500 without an audit row', async () => {
    harness.db.cas.error = { code: '57014', message: 'canceling statement due to statement timeout' };
    const res = await patchRoute(APP_CONFIG, { changes: { referral_referrer_bonus: '500' } });
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, failureBody(APP_NOT_SAVED, 'INTERNAL_ERROR'));
    assert.deepEqual(harness.db.audits, []);
  });

  test('a conflict reported without rows is a 409 with the generic message', async () => {
    harness.db.cas.data = { applied: false, conflicts: [] };
    const res = await patchRoute(APP_CONFIG, { changes: { withdraw_fee: '60' } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { ...failureBody(RACE, 'STATE_CONFLICT'), details: { conflicts: [] } });
  });

  test('a failed read stops before the database function is called', async () => {
    harness.db.failures.read = 'statement timeout';
    const res = await patchRoute(APP_CONFIG, { changes: { withdraw_fee: '60' } });
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, failureBody(APP_READ_FAILED, 'INTERNAL_ERROR'));
    assert.deepEqual(kinds(), ['select:app_config']);
  });

  test('validation refusals touch nothing', async () => {
    const cases: ReadonlyArray<[unknown, string]> = [
      [{ changes: { chatwoot_identity_key: 'x' } }, 'chatwoot_identity_key can only be changed in Platform Settings'],
      [{ changes: { mystery_key: '1' } }, 'Unknown app_config keys: mystery_key'],
      [{ changes: {} }, 'No changes provided'],
      [{ changes: { referral_max_per_day: '0' } }, 'Referrals per referrer in 24 hours: Allow at least 1 referral. To stop recording referrals, switch the programme off.'],
    ];
    for (const [body, message] of cases) {
      reset();
      const res = await patchRoute(APP_CONFIG, body);
      assert.equal(res.status, 400, message);
      assert.deepEqual(res.body, failureBody(message, 'VALIDATION_ERROR'));
      assert.deepEqual(harness.db.operations, []);
    }
  });

  test('signup bonus values the claim cannot use are refused before the database is called', async () => {
    const cases: ReadonlyArray<[Record<string, unknown>, string]> = [
      [{ signup_bonus_active: 'yes' }, SIGNUP_SWITCH],
      [{ signup_bonus_active: '' }, SIGNUP_SWITCH],
      [{ signup_bonus_active: 1 }, SIGNUP_SWITCH],
      [{ signup_bonus_active: null }, SIGNUP_SWITCH],
      [{ signup_bonus_condition: 'first_withdrawal' }, SIGNUP_CONDITION],
      [{ signup_bonus_condition: 'First_Trade' }, SIGNUP_CONDITION],
      [{ signup_bonus_condition: '' }, SIGNUP_CONDITION],
      [{ signup_bonus_condition: ['first_trade'] }, SIGNUP_CONDITION],
      [{ levels_active: 'false', signup_bonus_condition: 'first_withdrawal' }, SIGNUP_CONDITION],
      [{ signup_bonus_amount: '' }, 'Signup bonus amount: Enter the bonus amount.'],
      [{ signup_bonus_amount: null }, 'Signup bonus amount: Enter the bonus amount.'],
      [{ signup_bonus_amount: '-500' }, 'Signup bonus amount: Bonus amount cannot be negative.'],
      [{ signup_bonus_amount: -500 }, 'Signup bonus amount: Bonus amount cannot be negative.'],
      [{ signup_bonus_amount: 'abc' }, SIGNUP_UNREADABLE],
      [{ signup_bonus_amount: '1e3' }, SIGNUP_UNREADABLE],
      [{ signup_bonus_amount: true }, SIGNUP_UNREADABLE],
      [{ signup_bonus_amount: '1,50' }, 'Signup bonus amount: Use a full stop for decimals and commas only between thousands, like 1,500.50.'],
      [{ signup_bonus_amount: '2000.555' }, 'Signup bonus amount: Use at most 2 decimal places.'],
      [{ signup_bonus_amount: '1000000.01' }, 'Signup bonus amount: Use 1,000,000 or less.'],
    ];
    for (const [changes, message] of cases) {
      reset();
      const res = await patchRoute(APP_CONFIG, { changes });
      const label = JSON.stringify(changes);
      assert.equal(res.status, 400, label);
      assert.deepEqual(res.body, failureBody(message, 'VALIDATION_ERROR'), label);
      assert.deepEqual(harness.db.operations, [], label);
    }
  });

  test('signup bonus values are stored the way the claim reads them', async () => {
    const cases: ReadonlyArray<[Record<string, unknown>, Record<string, string>]> = [
      [{ signup_bonus_active: ' TRUE ' }, { signup_bonus_active: 'true' }],
      [{ signup_bonus_active: true }, { signup_bonus_active: 'true' }],
      [{ signup_bonus_condition: ' click_activate ' }, { signup_bonus_condition: 'click_activate' }],
      [{ signup_bonus_amount: '₦2,500.50' }, { signup_bonus_amount: '2500.5' }],
      [{ signup_bonus_amount: 300 }, { signup_bonus_amount: '300' }],
      [{ signup_bonus_amount: '0.00' }, { signup_bonus_amount: '0' }],
    ];
    for (const [changes, stored] of cases) {
      reset();
      const res = await patchRoute(APP_CONFIG, { changes });
      const label = JSON.stringify(changes);
      assert.equal(res.status, 200, label);
      assert.deepEqual(casArgs().p_changes, stored, label);
      for (const [key, value] of Object.entries(stored)) assert.equal(harness.db.config.get(key), value, label);
    }
  });

  test('a signup bonus left on must be payable from the stored values too, and a refusal writes nothing', async () => {
    const cases: ReadonlyArray<[Record<string, string | null | undefined>, Record<string, string>, string]> = [
      [{ signup_bonus_amount: '0' }, { signup_bonus_active: 'true' }, SIGNUP_ZERO],
      [{ signup_bonus_amount: '0.00' }, { signup_bonus_active: 'true' }, SIGNUP_ZERO],
      [{ signup_bonus_active: 'true' }, { signup_bonus_amount: '0' }, SIGNUP_ZERO],
      [{}, { signup_bonus_active: 'true', signup_bonus_amount: '0' }, SIGNUP_ZERO],
      [{ signup_bonus_amount: undefined }, { signup_bonus_active: 'true' }, 'Signup bonus amount: Enter the bonus amount.'],
      [{ signup_bonus_amount: null }, { signup_bonus_active: 'true' }, 'Signup bonus amount: Enter the bonus amount.'],
      [{ signup_bonus_amount: '-200' }, { signup_bonus_active: 'true' }, 'Signup bonus amount: Bonus amount cannot be negative.'],
      [{ signup_bonus_amount: 'abc' }, { signup_bonus_active: 'true' }, SIGNUP_UNREADABLE],
      [{ signup_bonus_amount: '5000000' }, { signup_bonus_active: 'true' }, 'Signup bonus amount: Use 1,000,000 or less.'],
      [{ signup_bonus_amount: '2000.555' }, { signup_bonus_active: 'true' }, 'Signup bonus amount: Use at most 2 decimal places.'],
      [{ signup_bonus_amount: '2,000' }, { signup_bonus_active: 'true' }, SIGNUP_UNREADABLE],
      [{ signup_bonus_amount: '₦2000' }, { signup_bonus_active: 'true' }, SIGNUP_UNREADABLE],
      [{ signup_bonus_amount: ' 2000' }, { signup_bonus_active: 'true' }, SIGNUP_UNREADABLE],
      [{ signup_bonus_condition: 'first_withdrawal' }, { signup_bonus_active: 'true' }, SIGNUP_CONDITION],
      [{ signup_bonus_condition: undefined }, { signup_bonus_active: 'true' }, SIGNUP_CONDITION],
      [{ signup_bonus_condition: null }, { signup_bonus_active: 'true' }, SIGNUP_CONDITION],
      [{ signup_bonus_active: 'true', signup_bonus_condition: 'first_withdrawal' }, { signup_bonus_active: 'true' }, SIGNUP_CONDITION],
    ];
    for (const [stored, changes, message] of cases) {
      reset();
      storeConfig(stored);
      const before = new Map(harness.db.config);
      const res = await patchRoute(APP_CONFIG, { changes });
      const label = JSON.stringify([Object.entries(stored), changes]);
      assert.equal(res.status, 400, label);
      assert.deepEqual(res.body, failureBody(message, 'VALIDATION_ERROR'), label);
      assert.deepEqual(kinds(), ['select:app_config'], label);
      assert.deepEqual(harness.db.config, before, label);
      assert.deepEqual(harness.db.audits, [], label);
    }
  });

  test('a signup bonus change reads all three signup settings; other changes read only their own keys', async () => {
    await patchRoute(APP_CONFIG, { changes: { signup_bonus_active: 'true', withdraw_fee: '60' } });
    assert.deepEqual(harness.db.operations[0].filter, {
      column: 'key',
      values: ['signup_bonus_active', 'withdraw_fee', 'signup_bonus_amount', 'signup_bonus_condition'],
    });
    reset();
    await patchRoute(APP_CONFIG, { changes: { signup_bonus_condition: 'click_activate' } });
    assert.deepEqual(harness.db.operations[0].filter, {
      column: 'key',
      values: ['signup_bonus_condition', 'signup_bonus_active', 'signup_bonus_amount'],
    });
    reset();
    await patchRoute(APP_CONFIG, { changes: { withdraw_fee: '60', levels_active: 'false' } });
    assert.deepEqual(harness.db.operations[0].filter, { column: 'key', values: ['withdraw_fee', 'levels_active'] });
  });

  test('the bonus can always be switched off, and changes that leave it payable are saved', async () => {
    const cases: ReadonlyArray<[Record<string, string | null | undefined>, Record<string, string>]> = [
      [{}, { signup_bonus_amount: '0' }],
      [{ signup_bonus_active: 'true', signup_bonus_amount: '0' }, { signup_bonus_active: 'false' }],
      [
        { signup_bonus_active: 'true', signup_bonus_amount: 'abc', signup_bonus_condition: 'first_withdrawal' },
        { signup_bonus_active: 'false', signup_bonus_amount: '0' },
      ],
      [{ signup_bonus_amount: '0' }, { signup_bonus_active: 'true', signup_bonus_amount: '1500' }],
      [{ signup_bonus_amount: '2000.00' }, { signup_bonus_active: 'true' }],
      [{ signup_bonus_condition: 'first_withdrawal' }, { signup_bonus_active: 'true', signup_bonus_condition: 'click_activate' }],
      [{ signup_bonus_active: 'true', signup_bonus_condition: 'first_withdrawal' }, { signup_bonus_amount: '300' }],
      [{ signup_bonus_active: 'true', signup_bonus_amount: '0' }, { signup_bonus_condition: 'click_activate' }],
    ];
    for (const [stored, changes] of cases) {
      reset();
      storeConfig(stored);
      const res = await patchRoute(APP_CONFIG, { changes });
      const label = JSON.stringify([Object.entries(stored), changes]);
      assert.equal(res.status, 200, label);
      assert.deepEqual(res.body.changed, Object.keys(changes), label);
      for (const [key, value] of Object.entries(changes)) assert.equal(harness.db.config.get(key), value, label);
    }
  });

  test('a change to the signup switch or amount pins the other at the value it was checked against', async () => {
    const amount = await patchRoute(APP_CONFIG, {
      changes: { signup_bonus_amount: '300' },
      expected: { signup_bonus_amount: '200' },
    });
    assert.equal(amount.status, 200);
    assert.deepEqual(casArgs(), {
      p_changes: { signup_bonus_amount: '300' },
      p_expected: { signup_bonus_amount: '200', signup_bonus_active: 'false' },
      p_private_keys: null,
    });
    assert.deepEqual(amount.body.changed, ['signup_bonus_amount']);
    assert.deepEqual(amount.body.unchanged, []);
    assert.deepEqual(harness.db.audits[0].before_value, { signup_bonus_amount: '200' });
    assert.deepEqual(harness.db.audits[0].after_value, { signup_bonus_amount: '300' });
    reset();
    const toggle = await patchRoute(APP_CONFIG, { changes: { signup_bonus_active: 'true' } });
    assert.equal(toggle.status, 200);
    assert.deepEqual(casArgs().p_expected, { signup_bonus_amount: '200' });
    assert.deepEqual(harness.db.audits[0].after_value, { signup_bonus_active: 'true' });
    reset();
    harness.db.config.delete('signup_bonus_active');
    const missing = await patchRoute(APP_CONFIG, { changes: { signup_bonus_amount: '300' } });
    assert.equal(missing.status, 200);
    assert.deepEqual(casArgs().p_expected, { signup_bonus_active: '' });
    assert.equal(harness.db.config.has('signup_bonus_active'), false);
    const unpinned: ReadonlyArray<Record<string, string>> = [
      { signup_bonus_active: 'true', signup_bonus_amount: '400' },
      { signup_bonus_condition: 'click_activate' },
      { levels_active: 'false' },
    ];
    for (const changes of unpinned) {
      reset();
      const res = await patchRoute(APP_CONFIG, { changes });
      assert.equal(res.status, 200, JSON.stringify(changes));
      assert.equal(casArgs().p_expected, null, JSON.stringify(changes));
    }
  });

  test('switching the bonus on while another admin sets the amount to ₦0 is a 409 naming the amount, and nothing is written', async () => {
    harness.db.cas.beforeRun = (db) => db.config.set('signup_bonus_amount', '0');
    const res = await patchRoute(APP_CONFIG, { changes: { signup_bonus_active: 'true' } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      ...failureBody(
        'Another admin changed Signup bonus amount after you loaded it, so nothing was saved. Reload to see the current values.',
        'STATE_CONFLICT',
      ),
      details: { conflicts: [{ key: 'signup_bonus_amount', label: 'Signup bonus amount', current: '0' }] },
    });
    assert.equal(harness.db.config.get('signup_bonus_active'), 'false');
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`]);
    assert.deepEqual(harness.db.audits, []);
  });

  test('setting the amount to ₦0 while another admin switches the bonus on is a 409 naming the switch, and nothing is written', async () => {
    harness.db.cas.beforeRun = (db) => db.config.set('signup_bonus_active', 'true');
    const res = await patchRoute(APP_CONFIG, { changes: { signup_bonus_amount: '0' } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      ...failureBody(
        'Another admin changed Signup bonus after you loaded it, so nothing was saved. Reload to see the current values.',
        'STATE_CONFLICT',
      ),
      details: { conflicts: [{ key: 'signup_bonus_active', label: 'Signup bonus', current: 'true' }] },
    });
    assert.equal(harness.db.config.get('signup_bonus_amount'), SEED.signup_bonus_amount);
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`]);
    assert.deepEqual(harness.db.audits, []);
  });

  test('a stale signup bonus value is named by its label', async () => {
    harness.db.config.set('signup_bonus_condition', 'click_activate');
    const res = await patchRoute(APP_CONFIG, {
      changes: { signup_bonus_condition: 'first_trade' },
      expected: { signup_bonus_condition: 'first_trade' },
    });
    assert.equal(res.status, 409);
    assert.equal(
      res.body.error,
      'Another admin changed When users can claim the signup bonus after you loaded it, so nothing was saved. Reload to see the current values.',
    );
    assert.deepEqual(res.body.details, {
      conflicts: [{ key: 'signup_bonus_condition', label: 'When users can claim the signup bonus', current: 'click_activate' }],
    });
    assert.equal(harness.db.config.get('signup_bonus_condition'), 'click_activate');
  });

  test('GET still filters by keys and never returns the secret', async () => {
    const res = await getRoute(APP_CONFIG, '?keys=referral_active,chatwoot_identity_key');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.config, { referral_active: 'true' });
  });
});

describe('admin-settings: PATCH', () => {
  test('a toggle sends its update, every value just read as a precondition and the secret keys', async () => {
    const seen = seenSettings();
    const res = await patchRoute(ADMIN_SETTINGS, { changes: { gateway_monnify_enabled: 'true' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      success: true, request_id: REQUEST_ID, changed: ['gateway_monnify_enabled'], unchanged: [], audit_recorded: true,
    });
    assert.deepEqual(casArgs(), {
      p_changes: { gateway_monnify_enabled: 'true' },
      p_expected: seen,
      p_private_keys: [SECRET_KEY],
    });
    assert.equal(Object.keys(seen).length, settingsRules.SETTINGS_KEYS.length);
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`, 'rpc:edge_cache_delete', 'insert:audit_log']);
    assert.deepEqual(harness.db.audits, [auditEntry({
      action: 'UPDATE_ADMIN_SETTINGS',
      entity_id: 'gateway_monnify_enabled',
      before_value: { gateway_monnify_enabled: 'false' },
      after_value: { gateway_monnify_enabled: 'true' },
      sensitivity: 'financial',
    })]);
  });

  test('missing and null rows are expected as empty text', async () => {
    harness.db.config.delete('app_minimum_version');
    harness.db.config.set('app_update_message', null);
    const res = await patchRoute(ADMIN_SETTINGS, { changes: { terms_url: 'https://cardelite.ng/t2' } });
    assert.equal(res.status, 200);
    const expected = casArgs().p_expected as Record<string, string>;
    assert.equal(expected.app_minimum_version, '');
    assert.equal(expected.app_update_message, '');
  });

  test('the console expected map is never sent: raw values are, so normalised or masked values do not conflict', async () => {
    harness.db.config.set('active_payment_gateway', ' Paystack ');
    const seen = seenSettings();
    const res = await patchRoute(ADMIN_SETTINGS, {
      changes: { terms_url: 'https://cardelite.ng/t2' },
      expected: { terms_url: SEED.terms_url, active_payment_gateway: 'paystack', chatwoot_identity_key: settingsRules.SECRET_MASK },
    });
    assert.equal(res.status, 200);
    const expected = casArgs().p_expected as Record<string, string>;
    assert.deepEqual(expected, seen);
    assert.equal(expected.active_payment_gateway, ' Paystack ');
    assert.equal(expected.chatwoot_identity_key, SECRET);
    assert.ok(!JSON.stringify(res.body).includes(SECRET));
  });

  test('the mobile Live Chat save echoes the masked key: nothing is written and an exposed key is made private', async () => {
    harness.db.hidden.delete(SECRET_KEY);
    const res = await patchRoute(ADMIN_SETTINGS, {
      changes: {
        chatwoot_base_url: SEED.chatwoot_base_url,
        chatwoot_website_token: SEED.chatwoot_website_token,
        chatwoot_identity_key: settingsRules.SECRET_MASK,
      },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      success: true,
      request_id: REQUEST_ID,
      changed: [],
      unchanged: ['chatwoot_base_url', 'chatwoot_website_token', SECRET_KEY],
    });
    const args = casArgs();
    assert.deepEqual(args.p_changes, {});
    assert.deepEqual(args.p_private_keys, [SECRET_KEY]);
    assert.equal(harness.db.hidden.has(SECRET_KEY), true);
    assert.equal(harness.db.config.get(SECRET_KEY), SECRET);
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`]);
    assert.deepEqual(harness.db.audits, []);
  });

  test('replacing the key writes it privately; the raw values the database returns are never returned or logged', async () => {
    const res = await patchRoute(ADMIN_SETTINGS, { changes: { chatwoot_identity_key: 'brand-new-key' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      success: true, request_id: REQUEST_ID, changed: [SECRET_KEY], unchanged: [], audit_recorded: true,
    });
    assert.equal(harness.db.config.get(SECRET_KEY), 'brand-new-key');
    assert.equal(harness.db.hidden.has(SECRET_KEY), true);
    assert.deepEqual(harness.db.casResults, [{
      applied: true, changed: [SECRET_KEY], unchanged: [], before: { [SECRET_KEY]: SECRET },
    }]);
    assert.deepEqual(harness.db.audits, [auditEntry({
      action: 'UPDATE_ADMIN_SETTINGS',
      entity_id: SECRET_KEY,
      before_value: { [SECRET_KEY]: '[redacted]' },
      after_value: { [SECRET_KEY]: '[redacted]' },
      sensitivity: 'security',
    })]);
    const exposed = JSON.stringify([res.body, harness.db.audits]) + loggedText();
    assert.ok(!exposed.includes(SECRET));
    assert.ok(!exposed.includes('brand-new-key'));
  });

  test('a key added where none was stored is created private', async () => {
    harness.db.config.delete(SECRET_KEY);
    harness.db.hidden.delete(SECRET_KEY);
    const res = await patchRoute(ADMIN_SETTINGS, { changes: { chatwoot_identity_key: 'first-key' } });
    assert.equal(res.status, 200);
    assert.equal((casArgs().p_expected as Record<string, string>)[SECRET_KEY], '');
    assert.equal(harness.db.config.get(SECRET_KEY), 'first-key');
    assert.equal(harness.db.hidden.has(SECRET_KEY), true);
  });

  test('any setting changed after the read is a 409 built from a fresh read, with the key masked', async () => {
    harness.db.cas.beforeRun = (db) => {
      db.config.set(SECRET_KEY, 'rotated-secret');
      db.config.set('privacy_url', 'https://cardelite.ng/p2');
    };
    const res = await patchRoute(ADMIN_SETTINGS, { changes: { terms_url: 'https://cardelite.ng/t2' } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      ...failureBody(
        'Another admin changed Identity validation key and Privacy Policy URL after you loaded these settings, so nothing was saved. Reload to see the current values.',
        'STATE_CONFLICT',
      ),
      details: {
        conflicts: [
          { key: SECRET_KEY, label: 'Identity validation key', current: '[set]' },
          { key: 'privacy_url', label: 'Privacy Policy URL', current: 'https://cardelite.ng/p2' },
        ],
      },
    });
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`, 'select:app_config']);
    assert.equal(harness.db.config.get('terms_url'), SEED.terms_url);
    assert.deepEqual(harness.db.audits, []);
    assert.ok(!JSON.stringify(res.body).includes('rotated-secret'));
  });

  test('when the fresh read fails the conflict still names the keys, without values', async () => {
    harness.db.cas.beforeRun = (db) => {
      db.config.set('privacy_url', 'https://cardelite.ng/p2');
      db.failures.read = 'statement timeout';
    };
    const res = await patchRoute(ADMIN_SETTINGS, { changes: { terms_url: 'https://cardelite.ng/t2' } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body.details, {
      conflicts: [{ key: 'privacy_url', label: 'Privacy Policy URL', current: null }],
    });
  });

  test('a conflict reported without rows is a 409 with the generic message', async () => {
    harness.db.cas.data = { applied: false, conflicts: [] };
    const res = await patchRoute(ADMIN_SETTINGS, { changes: { terms_url: 'https://cardelite.ng/t2' } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { ...failureBody(RACE, 'STATE_CONFLICT'), details: { conflicts: [] } });
  });

  test('a planned conflict or an invalid value is refused before the database function is called', async () => {
    const stale = await patchRoute(ADMIN_SETTINGS, {
      changes: { active_payment_gateway: 'novac' },
      expected: { active_payment_gateway: 'monnify' },
    });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body.details, {
      conflicts: [{ key: 'active_payment_gateway', label: 'Primary payout gateway', current: 'paystack' }],
    });
    assert.deepEqual(kinds(), ['select:app_config']);
    reset();
    const invalid = await patchRoute(ADMIN_SETTINGS, { changes: { active_payment_gateway: 'monnify' } });
    assert.equal(invalid.status, 400);
    assert.match(String(invalid.body.error), /Turn on Monnify/);
    assert.deepEqual(kinds(), ['select:app_config']);
  });

  test('a database error while writing the key logs only its code and audits a generic error', async () => {
    harness.db.cas.error = { code: '23514', message: 'failing row contains (chatwoot_identity_key, brand-new-key)' };
    const res = await patchRoute(ADMIN_SETTINGS, { changes: { chatwoot_identity_key: 'brand-new-key' } });
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, failureBody(SETTINGS_NOT_SAVED, 'INTERNAL_ERROR'));
    assert.ok(loggedText().includes('23514'));
    assert.ok(!loggedText().includes('brand-new-key'));
    assert.deepEqual(harness.db.audits, [auditEntry({
      action: 'UPDATE_ADMIN_SETTINGS',
      entity_id: SECRET_KEY,
      before_value: { [SECRET_KEY]: '[redacted]' },
      after_value: { [SECRET_KEY]: '[redacted]' },
      sensitivity: 'security',
      result: 'failure',
      error: SECRET_WRITE_FAILED,
    })]);
  });

  test('a database error on other settings logs and audits its message', async () => {
    for (const [control, message] of SETTLED_FAILURES) {
      reset();
      harness.db.cas = control;
      const res = await patchRoute(ADMIN_SETTINGS, { changes: { terms_url: 'https://cardelite.ng/t2' } });
      assert.equal(res.status, 500, message);
      assert.deepEqual(res.body, failureBody(SETTINGS_NOT_SAVED, 'INTERNAL_ERROR'), message);
      assert.ok(loggedText().includes(message), message);
      assert.equal(harness.db.audits[0].error, message);
      assert.equal(harness.db.config.get('terms_url'), SEED.terms_url);
    }
  });

  test('an outcome that cannot be confirmed says so', async () => {
    for (const [control, message] of UNKNOWN_OUTCOMES) {
      reset();
      harness.db.cas = control;
      const res = await patchRoute(ADMIN_SETTINGS, { changes: { terms_url: 'https://cardelite.ng/t2' } });
      assert.equal(res.status, 500, message);
      assert.deepEqual(res.body, failureBody(SETTINGS_UNCONFIRMED, 'INTERNAL_ERROR'), message);
      assert.equal(harness.db.audits.length, 1, message);
    }
  });

  test('a save with nothing to change that fails is a 500 without an audit row', async () => {
    harness.db.cas.error = { code: '57014', message: 'canceling statement due to statement timeout' };
    const res = await patchRoute(ADMIN_SETTINGS, { changes: { terms_url: SEED.terms_url } });
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, failureBody(SETTINGS_NOT_SAVED, 'INTERNAL_ERROR'));
    assert.deepEqual(harness.db.audits, []);
  });

  test('the emergency switch keeps its action, reason and security sensitivity', async () => {
    const res = await patchRoute(ADMIN_SETTINGS, { changes: { emergency_mode: 'true' }, reason: '  Provider outage  ' });
    assert.equal(res.status, 200);
    assert.deepEqual(harness.db.audits, [auditEntry({
      action: 'ENABLE_EMERGENCY_MODE',
      entity_id: 'emergency_mode',
      before_value: { emergency_mode: 'false' },
      after_value: { emergency_mode: 'true' },
      sensitivity: 'security',
      reason: 'Provider outage',
    })]);
  });
});

describe('platform-balance: PATCH', () => {
  test('a source switch from the mobile app sends the value read as its precondition', async () => {
    const res = await patchRoute(PLATFORM_BALANCE, { changes: { platform_balance_mode: 'live' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      success: true,
      request_id: REQUEST_ID,
      changed: ['platform_balance_mode'],
      unchanged: [],
      applied: { platform_balance_mode: 'live' },
      audit_recorded: true,
    });
    assert.deepEqual(casArgs(), {
      p_changes: { platform_balance_mode: 'live' },
      p_expected: { platform_balance_mode: 'static' },
      p_private_keys: null,
    });
    assert.deepEqual(kinds().slice(0, 2), ['select:app_config', `rpc:${CAS}`]);
    assert.deepEqual(kinds().slice(2).sort(), ['insert:audit_log', 'rpc:build_marketplace_feed_cache', 'rpc:edge_cache_delete']);
    assert.equal(harness.db.config.get('platform_balance_mode'), 'live');
    assert.deepEqual(harness.db.audits, [auditEntry({
      action: 'UPDATE_PLATFORM_BALANCE',
      entity_id: 'platform_balance_mode',
      before_value: { platform_balance_mode: 'static', displayed_balance: 48350000 },
      after_value: { platform_balance_mode: 'live', displayed_balance: 12345.67 },
      sensitivity: 'financial',
    })]);
  });

  test('the static amount is canonicalised and its precondition is the raw value read', async () => {
    harness.db.config.set('platform_balance_static', '48350000.00');
    const res = await patchRoute(PLATFORM_BALANCE, { changes: { platform_balance_static: '50,000,000.50' } });
    assert.equal(res.status, 200);
    assert.deepEqual(casArgs(), {
      p_changes: { platform_balance_static: '50000000.5' },
      p_expected: { platform_balance_static: '48350000.00' },
      p_private_keys: null,
    });
    assert.deepEqual(res.body.applied, { platform_balance_static: '50000000.5' });
  });

  test('a missing or null row is expected as empty text, and a missing row is created public', async () => {
    harness.db.config.delete('platform_balance_mode');
    const created = await patchRoute(PLATFORM_BALANCE, { changes: { platform_balance_mode: 'live' } });
    assert.equal(created.status, 200);
    assert.deepEqual(casArgs().p_expected, { platform_balance_mode: '' });
    assert.equal(harness.db.config.get('platform_balance_mode'), 'live');
    assert.equal(harness.db.hidden.has('platform_balance_mode'), false);
    reset();
    harness.db.config.set('platform_balance_static', null);
    const filled = await patchRoute(PLATFORM_BALANCE, { changes: { platform_balance_static: '5' } });
    assert.equal(filled.status, 200);
    assert.deepEqual(casArgs().p_expected, { platform_balance_static: '' });
  });

  test('a value already stored is not sent at all', async () => {
    const res = await patchRoute(PLATFORM_BALANCE, { changes: { platform_balance_mode: 'static' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      success: true, request_id: REQUEST_ID, changed: [], unchanged: ['platform_balance_mode'], applied: {},
    });
    assert.deepEqual(kinds(), ['select:app_config']);
  });

  test('a stale expected value is refused by the plan before the database function is called', async () => {
    harness.db.config.set('platform_balance_static', '49000000');
    const res = await patchRoute(PLATFORM_BALANCE, {
      changes: { platform_balance_static: '50000000' },
      expected: { platform_balance_static: '48350000' },
    });
    assert.equal(res.status, 409);
    assert.deepEqual(kinds(), ['select:app_config']);
  });

  test('a change made after the read is a 409 from a fresh read', async () => {
    harness.db.cas.beforeRun = (db) => db.config.set('platform_balance_static', '49000000');
    const res = await patchRoute(PLATFORM_BALANCE, { changes: { platform_balance_static: '50000000' } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      ...failureBody(
        'Another admin changed the static amount after you loaded this page, so nothing was saved. Reload to see the current value.',
        'STATE_CONFLICT',
      ),
      details: { conflicts: [{ key: 'platform_balance_static', label: 'static amount', current: '49000000' }] },
    });
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`, 'select:app_config']);
    assert.equal(harness.db.config.get('platform_balance_static'), '49000000');
    assert.deepEqual(harness.db.audits, []);
  });

  test('the same value saved by another admin first is reported unchanged, with no audit or cache refresh', async () => {
    harness.db.cas.beforeRun = (db) => db.config.set('platform_balance_mode', 'live');
    const res = await patchRoute(PLATFORM_BALANCE, { changes: { platform_balance_mode: 'live' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      success: true, request_id: REQUEST_ID, changed: [], unchanged: ['platform_balance_mode'], applied: {},
    });
    assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`]);
    assert.deepEqual(harness.db.audits, []);
  });

  test('when only one of two changes is still needed, only it is applied and audited against the state it replaced', async () => {
    harness.db.cas.beforeRun = (db) => db.config.set('platform_balance_mode', 'live');
    const res = await patchRoute(PLATFORM_BALANCE, {
      changes: { platform_balance_mode: 'live', platform_balance_static: '50000000' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(casArgs().p_expected, { platform_balance_mode: 'static', platform_balance_static: '48350000' });
    assert.deepEqual(res.body.changed, ['platform_balance_static']);
    assert.deepEqual(res.body.unchanged, ['platform_balance_mode']);
    assert.deepEqual(res.body.applied, { platform_balance_static: '50000000' });
    assert.deepEqual(harness.db.audits, [auditEntry({
      action: 'UPDATE_PLATFORM_BALANCE',
      entity_id: 'platform_balance_static',
      before_value: { platform_balance_static: '48350000', displayed_balance: 12345.67 },
      after_value: { platform_balance_static: '50000000', displayed_balance: 12345.67 },
      sensitivity: 'financial',
    })]);
  });

  test('a database error is audited and refused, and an unconfirmed outcome says so', async () => {
    for (const [control, message] of [...SETTLED_FAILURES, ...UNKNOWN_OUTCOMES]) {
      reset();
      harness.db.cas = control;
      const res = await patchRoute(PLATFORM_BALANCE, { changes: { platform_balance_mode: 'live' } });
      const copy = SETTLED_FAILURES.some(([, settled]) => settled === message) ? BALANCE_NOT_SAVED : BALANCE_UNCONFIRMED;
      assert.equal(res.status, 500, message);
      assert.deepEqual(res.body, failureBody(copy, 'INTERNAL_ERROR'), message);
      assert.deepEqual(kinds(), ['select:app_config', `rpc:${CAS}`, 'insert:audit_log'], message);
      assert.deepEqual(harness.db.audits, [auditEntry({
        action: 'UPDATE_PLATFORM_BALANCE',
        entity_id: 'platform_balance_mode',
        before_value: { platform_balance_mode: 'static', displayed_balance: 48350000 },
        after_value: { platform_balance_mode: 'live', displayed_balance: 12345.67 },
        sensitivity: 'financial',
        result: 'failure',
        error: message,
      })], message);
    }
  });

  test('a failed audit write keeps the saved change and says so', async () => {
    harness.db.failures.audit = 'audit insert refused';
    const res = await patchRoute(PLATFORM_BALANCE, { changes: { platform_balance_mode: 'live' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.audit_recorded, false);
    assert.equal(res.body.warning, AUDIT_WARNING);
  });

  test('validation refusals keep their messages', async () => {
    const empty = await patchRoute(PLATFORM_BALANCE, {});
    assert.deepEqual(empty.body, failureBody('No changes were sent.', 'VALIDATION_ERROR'));
    assert.deepEqual(harness.db.operations, []);
    reset();
    const other = await patchRoute(PLATFORM_BALANCE, { changes: { platform_balance_live: '9' } });
    assert.deepEqual(other.body, failureBody('Nothing to update.', 'VALIDATION_ERROR'));
    assert.deepEqual(kinds(), ['select:app_config']);
  });
});

describe('hard rules', () => {
  const files = () => [...FOLDERS.map(routeFile), CAS_FILE];
  const source = (file: string) => readFileSync(file, 'utf8');

  test('the routes and the shared caller carry no prose comments', () => {
    for (const file of files()) {
      assert.doesNotMatch(source(file), /\/\*/, file);
      assert.doesNotMatch(source(file), /(^|\s)\/\/\s/m, file);
    }
  });

  test('the routes export only their handlers', () => {
    for (const folder of FOLDERS) {
      const text = source(routeFile(folder));
      const exported = [...text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm)].map((match) => match[1]);
      assert.deepEqual(exported.sort(), ['GET', 'PATCH'], folder);
      assert.doesNotMatch(text, /^export\s+(?:default|\{|\*|type|interface)/m, folder);
    }
  });

  test('the routes use the guard, the envelope and writeAudit, never the legacy paths', () => {
    for (const spec of SPECS) {
      const text = source(routeFile(spec.folder));
      assert.match(text, /writeAudit\(/, spec.folder);
      assert.doesNotMatch(text, /NextResponse\.json|verifyAdminFromRequest|page_permissions|from\('audit_log'\)|status: 401/, spec.folder);
      assert.match(text, new RegExp(`const ACTION = '${spec.action}';`), spec.folder);
    }
    assert.match(source(routeFile(LIMITS.folder)), /requireSuperAdmin\(\)/);
    assert.doesNotMatch(source(routeFile(LIMITS.folder)), /requireAdmin(Any|All)?\(/);
    for (const spec of [BILLS, ANOMALY, SECURITY]) {
      assert.match(source(routeFile(spec.folder)), new RegExp(`requireAdmin\\('${spec.permissions[0].replace('.', '\\.')}'\\)`), spec.folder);
      assert.match(source(routeFile(spec.folder)), new RegExp(`requireAdmin\\('${spec.permissions[1].replace('.', '\\.')}'\\)`), spec.folder);
    }
  });

  test('every app_config writer goes through the compare-and-set call and never writes the table itself', () => {
    for (const folder of FOLDERS) {
      const text = source(routeFile(folder));
      assert.match(text, /compareAndSet\(\{/, folder);
      assert.doesNotMatch(text, /\.(?:upsert|update|insert|delete)\(/, folder);
    }
    const caller = source(CAS_FILE);
    assert.match(caller, /rpc\(CONFIG_CAS_FUNCTION, \{/);
    for (const name of CAS_PARAMS) assert.match(caller, new RegExp(`${name}: `), name);
  });

  test('the routes, the shared caller and this test spell invisible and bidirectional characters as escapes', () => {
    const hidden = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
    for (const file of [...files(), fileURLToPath(import.meta.url)]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), hidden, file);
    }
  });
});
