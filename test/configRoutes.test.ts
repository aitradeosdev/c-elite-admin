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

interface RouteModule {
  GET: () => Promise<Response>;
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

type DbError = { message: string } | null;

interface DbResult {
  data: unknown;
  error: DbError;
}

interface Operation {
  kind: 'select' | 'upsert' | 'insert' | 'rpc';
  table: string;
  columns?: string;
  filter?: { column: string; values: unknown[] };
  rows?: unknown;
  options?: unknown;
  name?: string;
  args?: unknown;
}

interface Failures {
  read?: string;
  write?: string;
  audit?: string;
  rpc?: string;
  rpcThrows?: boolean;
}

interface FakeQuery extends PromiseLike<DbResult> {
  select(columns: string): FakeQuery;
  in(column: string, values: readonly unknown[]): FakeQuery;
  upsert(rows: unknown, options?: unknown): FakeQuery;
  insert(rows: unknown): FakeQuery;
}

interface FakeDb {
  config: Map<string, string | null>;
  audits: Record<string, unknown>[];
  operations: Operation[];
  failures: Failures;
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

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const HARNESS_KEY = '__configRoutesHarness';
const REQUEST_ID = 'req_cfgtest01';
const USER_AGENT = 'config-routes-test';
const CLIENT_IP = '198.51.100.7';
const PUBLIC_CACHE_KEY = 'app_config:public';
const LOAD_FAILED = 'The settings could not be loaded. Try again.';
const READ_FAILED = 'The current values could not be read, so nothing was saved. Try again.';
const NOT_SAVED = 'The new values could not be written to the database. Reload to check the live values before trying again.';
const EXPECTED_SHAPE = 'expected must map each setting to the value you last saw.';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';

const SEED: Readonly<Record<string, string>> = {
  min_withdrawal_amount: '1000',
  max_withdrawal_amount: '500000',
  max_daily_withdrawal: '1000000',
  pin_reset_freeze_hours: '24',
  withdraw_fee: '50',
  large_withdrawal_flag_threshold: '500000',
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
  chatwoot_identity_key: 'hmac-identity-secret',
  emergency_mode: 'false',
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
  ],
  single: { key: 'withdraw_fee', value: '75' },
  batch: { min_withdrawal_amount: '2000', max_withdrawal_amount: '750000' },
  sensitivity: 'financial',
  rejects: [
    [{ withdraw_fee: '-1' }, 'Invalid value for withdraw_fee'],
    [{ min_withdrawal_amount: 'abc' }, 'Invalid value for min_withdrawal_amount'],
    [{ max_daily_withdrawal: 'Infinity' }, 'Invalid value for max_daily_withdrawal'],
    [{ pin_reset_freeze_hours: { hours: 1 } }, 'Invalid value for pin_reset_freeze_hours'],
    [{ withdraw_fee: '10', max_withdrawal_amount: '-5' }, 'Invalid value for max_withdrawal_amount'],
  ],
  accepts: [
    [{ withdraw_fee: '0' }, { withdraw_fee: '0' }],
    [{ max_withdrawal_amount: 2500000 }, { max_withdrawal_amount: '2500000' }],
    [{ pin_reset_freeze_hours: '1000' }, { pin_reset_freeze_hours: '1000' }],
  ],
};

const BILLS: RouteSpec = {
  folder: 'bill-settings',
  action: 'UPDATE_BILL_SETTINGS',
  legacyKey: 'bill_settings',
  permissions: ['providers.read', 'providers.write'],
  keys: ['airtime_quick_amounts', 'electricity_quick_amounts', 'min_airtime_amount', 'min_electricity_amount'],
  single: { key: 'min_airtime_amount', value: '100' },
  batch: { airtime_quick_amounts: '50,100,200', electricity_quick_amounts: '500,1000' },
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

function failure(message: string | undefined): DbResult | null {
  return message ? { data: null, error: { message } } : null;
}

function execute(db: FakeDb, operation: Operation): DbResult {
  db.operations.push({ ...operation });
  if (operation.table === 'app_config' && operation.kind === 'select') {
    const failed = failure(db.failures.read);
    if (failed) return failed;
    const wanted = new Set(operation.filter?.values ?? []);
    const rows = [...db.config]
      .filter(([key]) => !operation.filter || wanted.has(key))
      .map(([key, value]) => ({ key, value }));
    return { data: rows, error: null };
  }
  if (operation.table === 'app_config' && operation.kind === 'upsert') {
    const failed = failure(db.failures.write);
    if (failed) return failed;
    for (const row of operation.rows as Array<{ key: string; value: string | null }>) db.config.set(row.key, row.value);
    return { data: null, error: null };
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
    audits: [],
    operations: [],
    failures: {},
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
        upsert(rows, options) {
          operation.kind = 'upsert';
          operation.rows = rows;
          operation.options = options;
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
      if (db.failures.rpcThrows) throw new Error('cache endpoint unreachable');
      return failure(db.failures.rpc) ?? { data: null, error: null };
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

function routeFile(spec: RouteSpec): string {
  return resolve(APP_DIR, 'api', spec.folder, 'route.ts');
}

const routes = new Map<string, RouteModule>();
let grantRules: GrantRules;
let storableGrants: string[] = [];

before(async () => {
  for (const spec of SPECS) {
    routes.set(spec.folder, (await import(await bundle(routeFile(spec)))) as RouteModule);
  }
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

function route(spec: RouteSpec): RouteModule {
  const loaded = routes.get(spec.folder);
  if (!loaded) throw new Error(`${spec.folder} route was not loaded`);
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

async function get(spec: RouteSpec): Promise<Reply> {
  return reply(await route(spec).GET());
}

async function patch(spec: RouteSpec, body: unknown): Promise<Reply> {
  return reply(await route(spec).PATCH(patchRequest(body)));
}

function kinds(): string[] {
  return harness.db.operations.map((operation) => `${operation.kind}:${operation.kind === 'rpc' ? operation.name : operation.table}`);
}

function oldRule(spec: RouteSpec, claims: Claims): boolean {
  if (claims.is_super_admin) return true;
  return spec.legacyKey !== null && claims.page_permissions.includes(spec.legacyKey);
}

function otherKey(spec: RouteSpec): string {
  const key = spec.keys.find((candidate) => candidate !== spec.single.key);
  if (!key) throw new Error(`${spec.folder} needs a second key`);
  return key;
}

function auditRow(spec: RouteSpec, fields: {
  entity_id: string;
  before_value: unknown;
  after_value: unknown;
  result?: string;
  error?: string | null;
}) {
  return {
    admin_id: SUPER.admin_id,
    user_id: null,
    action: spec.action,
    entity: 'app_config',
    entity_id: fields.entity_id,
    before_value: fields.before_value,
    after_value: fields.after_value,
    ip_address: CLIENT_IP,
    admin_role: SUPER.role_title,
    user_agent: USER_AGENT,
    request_id: REQUEST_ID,
    reason: null,
    result: fields.result ?? 'success',
    error: fields.error ?? null,
    sensitivity: spec.sensitivity,
  };
}

function failureBody(message: string, code: string) {
  return { success: false, error: message, code, message, request_id: REQUEST_ID };
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
    test('malformed bodies are refused before anything is read', async () => {
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
        for (const [key, value] of Object.entries(stored)) assert.equal(harness.db.config.get(key), value);
      }
    });
  });

  describe(`${spec.folder}: PATCH writes`, () => {
    const { key, value } = spec.single;

    test('saves the change, clears the public config cache and audits before and after', async () => {
      const res = await patch(spec, { changes: { [key]: value, not_a_setting: 'ignored' } });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        success: true, request_id: REQUEST_ID, changed: [key], unchanged: [], audit_recorded: true,
      });
      assert.equal(res.requestHeader, REQUEST_ID);
      assert.equal(harness.db.config.get(key), value);
      assert.equal(harness.db.config.has('not_a_setting'), false);
      assert.deepEqual(kinds(), ['select:app_config', 'upsert:app_config', 'rpc:edge_cache_delete', 'insert:audit_log']);
      const write = harness.db.operations[1];
      assert.deepEqual(write.options, { onConflict: 'key' });
      const rows = write.rows as Array<Record<string, unknown>>;
      assert.equal(rows.length, 1);
      assert.deepEqual(Object.keys(rows[0]).sort(), ['key', 'updated_at', 'value']);
      assert.equal(rows[0].key, key);
      assert.equal(rows[0].value, value);
      assert.ok(!Number.isNaN(Date.parse(String(rows[0].updated_at))));
      assert.deepEqual(harness.db.operations[2].args, { p_key: PUBLIC_CACHE_KEY });
      assert.deepEqual(harness.db.audits, [
        auditRow(spec, { entity_id: key, before_value: { [key]: SEED[key] }, after_value: { [key]: value } }),
      ]);
    });

    test('a batch is written in one upsert and recorded as one audit row', async () => {
      const keys = Object.keys(spec.batch);
      const res = await patch(spec, { changes: spec.batch });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.changed, keys);
      assert.deepEqual(kinds(), ['select:app_config', 'upsert:app_config', 'rpc:edge_cache_delete', 'insert:audit_log']);
      const before: Record<string, string> = {};
      for (const name of keys) before[name] = SEED[name];
      assert.deepEqual(harness.db.audits, [
        auditRow(spec, { entity_id: 'batch', before_value: before, after_value: { ...spec.batch } }),
      ]);
    });

    test('values that are already stored are skipped: no write, no cache clear, no empty audit row', async () => {
      const keys = Object.keys(spec.batch);
      const same: Record<string, string> = {};
      for (const name of keys) same[name] = SEED[name];
      const res = await patch(spec, { changes: same });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { success: true, request_id: REQUEST_ID, changed: [], unchanged: keys });
      assert.deepEqual(kinds(), ['select:app_config']);
      assert.deepEqual(harness.db.audits, []);
    });

    test('only the keys that actually change are written and audited', async () => {
      const kept = otherKey(spec);
      const res = await patch(spec, { changes: { [key]: value, [kept]: SEED[kept] } });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.changed, [key]);
      assert.deepEqual(res.body.unchanged, [kept]);
      const rows = harness.db.operations[1].rows as Array<Record<string, unknown>>;
      assert.deepEqual(rows.map((row) => row.key), [key]);
      assert.deepEqual(harness.db.audits[0].before_value, { [key]: SEED[key] });
      assert.deepEqual(harness.db.audits[0].after_value, { [key]: value });
    });

    test('a missing row is created and audited with a null before value', async () => {
      harness.db.config.delete(key);
      const res = await patch(spec, { changes: { [key]: value } });
      assert.equal(res.status, 200);
      assert.equal(harness.db.config.get(key), value);
      assert.deepEqual(harness.db.audits[0].before_value, { [key]: null });
    });

    test('a failed write is a 500, is audited as a failure and leaves the cache alone', async () => {
      harness.db.failures.write = 'permission denied for table app_config';
      const res = await patch(spec, { changes: { [key]: value } });
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, failureBody(NOT_SAVED, 'INTERNAL_ERROR'));
      assert.deepEqual(kinds(), ['select:app_config', 'upsert:app_config', 'insert:audit_log']);
      assert.equal(harness.db.config.get(key), SEED[key]);
      assert.deepEqual(harness.db.audits, [
        auditRow(spec, {
          entity_id: key,
          before_value: { [key]: SEED[key] },
          after_value: { [key]: value },
          result: 'failure',
          error: 'permission denied for table app_config',
        }),
      ]);
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
      harness.db.failures.rpc = 'cache table locked';
      const errored = await patch(spec, { changes: { [key]: value } });
      assert.equal(errored.status, 200);
      assert.equal(errored.body.audit_recorded, true);
      reset();
      harness.db.failures.rpcThrows = true;
      const thrown = await patch(spec, { changes: { [key]: value } });
      assert.equal(thrown.status, 200);
      assert.equal(harness.db.audits.length, 1);
    });

    test('a failed read of the current values stops before any write', async () => {
      harness.db.failures.read = 'statement timeout';
      const res = await patch(spec, { changes: { [key]: value } });
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, failureBody(READ_FAILED, 'INTERNAL_ERROR'));
      assert.deepEqual(kinds(), ['select:app_config']);
      assert.deepEqual(harness.db.audits, []);
    });
  });

  describe(`${spec.folder}: PATCH optional expected map`, () => {
    const { key, value } = spec.single;

    test('a matching expected value saves', async () => {
      const res = await patch(spec, { changes: { [key]: value }, expected: { [key]: SEED[key] } });
      assert.equal(res.status, 200);
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
      assert.deepEqual(kinds(), ['select:app_config']);
      assert.deepEqual(harness.db.audits, []);
      assert.equal(harness.db.config.get(key), '7');
    });

    test('an empty or null expected value matches a row that does not exist', async () => {
      for (const seen of ['', null]) {
        reset();
        harness.db.config.delete(key);
        const res = await patch(spec, { changes: { [key]: value }, expected: { [key]: seen } });
        assert.equal(res.status, 200, String(seen));
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
      assert.deepEqual(kinds(), ['select:app_config']);
    });

    test('expected entries for keys that are not being changed are ignored', async () => {
      const res = await patch(spec, {
        changes: { [key]: value },
        expected: { [otherKey(spec)]: 'stale', not_a_setting: { nested: true } },
      });
      assert.equal(res.status, 200);
      assert.equal(harness.db.config.get(key), value);
    });

    test('a malformed expected map is refused before anything is read', async () => {
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
      assert.equal(harness.db.config.get(key), value);
      assert.deepEqual(harness.db.audits[0].before_value, { [key]: '7' });
    });
  });
}

describe('limits-fees specifics', () => {
  test('a numeric expected value is compared as the text it stands for', async () => {
    const res = await patch(LIMITS, { changes: { withdraw_fee: '75' }, expected: { withdraw_fee: 50 } });
    assert.equal(res.status, 200);
  });

  test('several conflicts are named together', async () => {
    harness.db.config.set('min_withdrawal_amount', '1500');
    harness.db.config.set('max_withdrawal_amount', '600000');
    const res = await patch(LIMITS, {
      changes: { min_withdrawal_amount: '2000', max_withdrawal_amount: '750000', withdraw_fee: '75' },
      expected: { min_withdrawal_amount: '1000', max_withdrawal_amount: '500000', withdraw_fee: '50' },
    });
    assert.equal(res.status, 409);
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
});

describe('hard rules', () => {
  const source = (spec: RouteSpec) => readFileSync(routeFile(spec), 'utf8');

  test('the routes carry no prose comments', () => {
    for (const spec of SPECS) {
      assert.doesNotMatch(source(spec), /\/\*/, spec.folder);
      assert.doesNotMatch(source(spec), /(^|\s)\/\/\s/m, spec.folder);
    }
  });

  test('the routes export only their handlers', () => {
    for (const spec of SPECS) {
      const text = source(spec);
      const exported = [...text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm)].map((match) => match[1]);
      assert.deepEqual(exported.sort(), ['GET', 'PATCH'], spec.folder);
      assert.doesNotMatch(text, /^export\s+(?:default|\{|\*|type|interface)/m, spec.folder);
    }
  });

  test('the routes use the guard, the envelope and writeAudit, never the legacy paths', () => {
    for (const spec of SPECS) {
      const text = source(spec);
      assert.match(text, /writeAudit\(/, spec.folder);
      assert.doesNotMatch(text, /NextResponse\.json|verifyAdminFromRequest|page_permissions|from\('audit_log'\)|status: 401/, spec.folder);
      assert.match(text, new RegExp(`const ACTION = '${spec.action}';`), spec.folder);
    }
    assert.match(source(LIMITS), /requireSuperAdmin\(\)/);
    assert.doesNotMatch(source(LIMITS), /requireAdmin(Any|All)?\(/);
    for (const spec of [BILLS, ANOMALY, SECURITY]) {
      assert.match(source(spec), new RegExp(`requireAdmin\\('${spec.permissions[0].replace('.', '\\.')}'\\)`), spec.folder);
      assert.match(source(spec), new RegExp(`requireAdmin\\('${spec.permissions[1].replace('.', '\\.')}'\\)`), spec.folder);
    }
  });

  test('the routes and this test spell invisible and bidirectional characters as escapes', () => {
    const hidden = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
    for (const file of [...SPECS.map(routeFile), fileURLToPath(import.meta.url)]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), hidden, file);
    }
  });
});
