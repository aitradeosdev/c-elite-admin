import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement, type ReactNode } from 'react';
import ts from 'typescript';
import { loadAppModule, loadUi, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type { PasswordChangeResult, PasswordDraft, ProfileAccount } from '../app/(dashboard)/profile/model.ts';

type PolicyModule = typeof import('../app/lib/passwordPolicy.ts');
type ModelModule = typeof import('../app/(dashboard)/profile/model.ts');
type PartsModule = typeof import('../app/(dashboard)/profile/ProfileParts.tsx');
type LinkModule = typeof import('../app/(dashboard)/profile/ProfileLink.tsx');
type PageModule = typeof import('../app/(dashboard)/profile/page.tsx');
type ConfirmModule = typeof import('../app/_ui/Confirm.tsx');

const STATE_KEY = '__cardeliteProfileRouteTest';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const TEST_FILE = fileURLToPath(import.meta.url);
const ROUTE_FILE = join(APP_DIR, 'api', 'account', 'password', 'route.ts');
const POLICY_FILE = join(APP_DIR, 'lib', 'passwordPolicy.ts');
const OWNED_DIR = join(APP_DIR, '(dashboard)', 'profile');
const nodeRequire = createRequire(import.meta.url);

const ADMIN_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const OTHER_ADMIN_ID = '3c9d1f7a-8b2e-4d6c-9a1f-0e4b7c2d5a83';
const USERNAME = 'ops.lead';
const EMAIL = 'adaeze.okafor@cardelite.test';
const ROLE = 'Operations Lead';
const CURRENT_PASSWORD = 'Correct-Horse-Battery-9';
const NEW_PASSWORD = 'Velvet-Harbour-Lantern-42';
const WRONG_PASSWORD = 'Tr0ub4dor-and-3-wrong';
const OTHER_PASSWORD = 'Someone-Else-Changed-It-7';
const STORED_HASH = '$2a$12$storedhashstoredhashstoredhashstoredhashstoredhashst';
const OTHER_HASH = '$2a$12$otherhashotherhashotherhashotherhashotherhashotherh';
const NEW_HASH = '$2a$12$freshhashfreshhashfreshhashfreshhashfreshhashfreshh';
const ISSUED_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.renewed-session-token.signature';
const BEARER = 'eyJhbGciOiJIUzI1NiJ9.mobile-session-token.signature';
const SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
const HOUR_MS = 60 * 60 * 1000;
const REQUEST_ID = 'req_profilepw001';
const USER_AGENT = 'Mozilla/5.0 (CardElite profile test)';
const FORWARDED_FOR = '203.0.113.9, 198.51.100.21';
const CLIENT_IP = '198.51.100.21';
const LIMIT_DOWN = 'rate limit store unavailable';
const AUDIT_DOWN = 'audit store unavailable';
const DB_REFUSED = 'permission denied for table admin_users';

const MISSING_BODY = 'Send your current password and a new password.';
const CURRENT_REQUIRED = 'Enter your current password.';
const NEW_REQUIRED = 'Enter a new password.';
const TOO_MANY = 'Too many password change attempts. Wait 15 minutes, then try again.';
const LIMIT_UNAVAILABLE = 'Your password cannot be changed right now. Try again in a few minutes.';
const CURRENT_INCORRECT = 'Your current password is incorrect.';
const READ_FAILED = 'Your account could not be read, so your password was not changed. Try again.';
const SAVE_FAILED = 'Your password could not be changed. Try again.';
const KEPT_CHANGING = 'Your account changed while the new password was being saved, so it was not changed. Try again.';
const AUDIT_WARNING = 'Your password was changed, but the change could not be written to the audit log.';

const AUDIT_KEYS = [
  'admin_id', 'user_id', 'action', 'entity', 'entity_id', 'before_value', 'after_value', 'ip_address',
  'admin_role', 'user_agent', 'request_id', 'reason', 'result', 'error', 'sensitivity',
] as const;

const SECRETS = [CURRENT_PASSWORD, NEW_PASSWORD, WRONG_PASSWORD, STORED_HASH, NEW_HASH, OTHER_HASH] as const;

interface SessionInfo {
  id: string;
  client: 'web' | 'mobile';
  amr: string[];
  createdAt: string;
  expiresAt: string;
  reauthAt: string | null;
  transport: 'cookie' | 'bearer';
}

interface Claims {
  admin_id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  token_version: number;
  session?: SessionInfo | null;
  mfa?: { status: string; lockedUntil: string | null };
  policy?: { mode: string; graceEndsAt: string | null; requiredNow: boolean };
}

interface AccountRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string | null;
  role_title: string;
  is_super_admin: boolean;
  is_active: boolean;
  page_permissions: string[] | null;
  token_version: number | null;
}

type ReadStep = AccountRow | null | { error: string };
type SaveStep = 'saved' | 'not-kept' | 'lost' | 'refused' | 'throw' | { error: string };
type LimitStep = boolean | null | 'error' | 'throw';

interface Scenario {
  claims: Claims | null;
  limit: LimitStep;
  reads: ReadStep[];
  saves: SaveStep[];
  auditError: string | null;
  signError: string | null;
  compareError: string | null;
}

interface DbError {
  message: string;
}

interface DbResult {
  data?: unknown;
  error?: DbError | null;
}

type Filter = [kind: string, column: string, value: unknown];

interface Query {
  table: string;
  op: 'select' | 'insert' | 'update' | null;
  columns: string | null;
  payload: unknown;
  filters: Filter[];
  terminal: 'maybeSingle' | null;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface StubState {
  scenario: Scenario;
  queries: Query[];
  rpcs: RpcCall[];
  timeline: string[];
  compares: Array<[unknown, unknown]>;
  hashes: Array<[unknown, unknown]>;
  signed: Array<[Record<string, unknown>, unknown, unknown, unknown]>;
  headers: Headers;
  plain: Readonly<Record<string, string>>;
  newHash: string;
  issuedToken: string;
  db: {
    from(table: string): object;
    rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
  };
}

interface Cookie {
  value: string;
  attributes: Map<string, string | true>;
}

interface PasswordRoute {
  POST: (req: Request) => Promise<Response>;
}

let sessionExpiresAt = '';

function webSession(patch: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SID,
    client: 'web',
    amr: ['otp', 'pwd'],
    createdAt: new Date(Date.now() - 3 * HOUR_MS).toISOString(),
    expiresAt: sessionExpiresAt,
    reauthAt: null,
    transport: 'cookie',
    ...patch,
  };
}

function signedInAs(patch: Partial<Claims> = {}): Claims {
  return {
    admin_id: ADMIN_ID,
    username: USERNAME,
    role_title: ROLE,
    is_super_admin: false,
    page_permissions: [],
    token_version: 4,
    session: webSession(),
    mfa: { status: 'active', lockedUntil: null },
    policy: { mode: 'off', graceEndsAt: null, requiredNow: false },
    ...patch,
  };
}

const ACCOUNT: AccountRow = {
  id: ADMIN_ID,
  username: USERNAME,
  email: EMAIL,
  password_hash: STORED_HASH,
  role_title: ROLE,
  is_super_admin: false,
  is_active: true,
  page_permissions: ['withdrawals', 'card_queue'],
  token_version: 4,
};

const VALID_BODY = { current_password: CURRENT_PASSWORD, new_password: NEW_PASSWORD };

function account(patch: Partial<AccountRow> = {}): AccountRow {
  return { ...ACCOUNT, ...patch };
}

function baseScenario(): Scenario {
  return {
    claims: signedInAs(),
    limit: true,
    reads: [account()],
    saves: ['saved'],
    auditError: null,
    signError: null,
    compareError: null,
  };
}

const logs: string[] = [];

const state: StubState = {
  scenario: baseScenario(),
  queries: [],
  rpcs: [],
  timeline: [],
  compares: [],
  hashes: [],
  signed: [],
  headers: new Headers(),
  plain: { [STORED_HASH]: CURRENT_PASSWORD, [OTHER_HASH]: OTHER_PASSWORD, [NEW_HASH]: NEW_PASSWORD },
  newHash: NEW_HASH,
  issuedToken: ISSUED_TOKEN,
  db: {
    from: (table) => chain(table),
    rpc: (name, args) => rpc(name, args),
  },
};

Reflect.set(globalThis, STATE_KEY, state);

function respond(query: Query): DbResult {
  const s = state.scenario;
  if (query.table === 'audit_log' && query.op === 'insert') {
    return { error: s.auditError ? { message: s.auditError } : null };
  }
  if (query.table === 'admin_users' && query.op === 'select' && query.terminal === 'maybeSingle') {
    const step = s.reads.shift();
    if (step === undefined) throw new Error('unexpected account read');
    if (step !== null && 'error' in step) return { error: { message: step.error } };
    return { data: step };
  }
  throw new Error(`unexpected query ${JSON.stringify(query)}`);
}

function savePassword(args: Record<string, unknown>): Promise<DbResult> {
  const step = state.scenario.saves.shift();
  if (step === undefined) return Promise.reject(new Error('unexpected password save'));
  if (step === 'throw') return Promise.reject(new Error('fetch failed'));
  if (typeof step === 'object') return Promise.resolve({ data: null, error: { message: step.error } });
  if (step === 'lost') return Promise.resolve({ data: { ok: false, reason: 'state_changed' }, error: null });
  if (step === 'refused') return Promise.resolve({ data: { ok: false, reason: 'unexpected' }, error: null });
  return Promise.resolve({
    data: {
      ok: true,
      token_version: Number(args.p_expected_token_version) + 1,
      session_kept: step === 'saved' && args.p_keep_sid !== null,
      sessions_revoked: 2,
    },
    error: null,
  });
}

function chain(table: string): object {
  const query: Query = { table, op: null, columns: null, payload: undefined, filters: [], terminal: null };
  state.queries.push(query);
  const builder: Record<string, unknown> = {};
  const filter = (kind: string) => (column: string, value: unknown) => {
    query.filters.push([kind, column, value]);
    return builder;
  };
  Object.assign(builder, {
    select: (columns: string) => {
      if (query.op === null) query.op = 'select';
      query.columns = columns;
      return builder;
    },
    insert: (payload: unknown) => {
      query.op = 'insert';
      query.payload = payload;
      return builder;
    },
    update: (payload: unknown) => {
      query.op = 'update';
      query.payload = payload;
      return builder;
    },
    eq: filter('eq'),
    is: filter('is'),
    maybeSingle: () => {
      query.terminal = 'maybeSingle';
      return builder;
    },
    then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(() => ({ data: null, error: null, ...respond(query) }))
        .then(onFulfilled, onRejected),
  });
  return builder;
}

function rpc(name: string, args: Record<string, unknown>): Promise<DbResult> {
  state.rpcs.push({ name, args });
  state.timeline.push(`rpc:${name}`);
  if (name === 'admin_password_change') return savePassword(args);
  if (name !== 'check_rate_limit_by_key') return Promise.reject(new Error(`unexpected rpc ${name}`));
  const verdict = state.scenario.limit;
  if (verdict === 'throw') return Promise.reject(new Error('fetch failed'));
  if (verdict === 'error') return Promise.resolve({ data: null, error: { message: LIMIT_DOWN } });
  return Promise.resolve({ data: verdict, error: null });
}

function moduleUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function stub(lines: string[]): string {
  return moduleUrl([`const state = () => globalThis.${STATE_KEY};`, ...lines].join('\n'));
}

const PACKAGE_STUBS: Readonly<Record<string, string>> = {
  'next/server': pathToFileURL(nodeRequire.resolve('next/server')).href,
  'next/headers': stub([
    'export async function headers() { return state().headers; }',
    'export async function cookies() { return { get: () => undefined }; }',
  ]),
  bcryptjs: stub([
    'export default {',
    '  async compare(value, hash) {',
    '    state().compares.push([value, hash]);',
    '    if (state().scenario.compareError) throw new Error(state().scenario.compareError);',
    '    return state().plain[hash] === value;',
    '  },',
    '  async hash(value, rounds) { state().hashes.push([value, rounds]); return state().newHash; },',
    '};',
  ]),
};

const LIB_STUBS: Readonly<Record<string, string>> = {
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: stub([
    'export const supabaseAdmin = {',
    '  from(table) { return state().db.from(table); },',
    '  rpc(name, args) { return state().db.rpc(name, args); },',
    '};',
  ]),
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: stub([
    'export async function verifyAdminFromRequest() { return state().scenario.claims; }',
    'export async function signSessionToken(admin, sid, amr, epoch) {',
    '  if (state().scenario.signError) throw new Error(state().scenario.signError);',
    '  state().signed.push([admin, sid, amr, epoch]);',
    '  state().timeline.push("sign");',
    '  return state().issuedToken;',
    '}',
  ]),
};

const IMPORT_RE = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;
const bundled = new Map<string, Promise<string>>();

function resolveRelative(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = /\.tsx?$/.test(base) ? [base] : [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`${fromFile} imports ${specifier}, which does not resolve`);
  return found;
}

async function transpile(file: string): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  });
  const targets = new Map<string, string>();
  for (const [, , specifier] of outputText.matchAll(IMPORT_RE)) {
    if (targets.has(specifier)) continue;
    if (specifier.startsWith('.')) {
      const path = resolveRelative(file, specifier);
      targets.set(specifier, LIB_STUBS[path] ?? (await bundle(path)));
    } else if (PACKAGE_STUBS[specifier]) {
      targets.set(specifier, PACKAGE_STUBS[specifier]);
    } else {
      throw new Error(`${file} imports ${specifier}, which this test does not provide`);
    }
  }
  return moduleUrl(outputText.replace(IMPORT_RE, (match: string, head: string, specifier: string) => {
    const target = targets.get(specifier);
    return target ? `${head}'${target}'` : match;
  }));
}

function bundle(file: string): Promise<string> {
  let pending = bundled.get(file);
  if (!pending) {
    pending = transpile(file);
    bundled.set(file, pending);
  }
  return pending;
}

function reset(patch: Partial<Scenario> = {}): void {
  sessionExpiresAt = new Date(Date.now() + 5 * HOUR_MS).toISOString();
  state.scenario = { ...baseScenario(), ...patch };
  state.queries = [];
  state.rpcs = [];
  state.timeline = [];
  state.compares = [];
  state.hashes = [];
  state.signed = [];
  state.headers = new Headers();
  logs.length = 0;
}

function prepare(extra: Record<string, string | null> = {}): Headers {
  const headers = new Headers({
    'content-type': 'application/json',
    'user-agent': USER_AGENT,
    'x-forwarded-for': FORWARDED_FOR,
    'x-request-id': REQUEST_ID,
  });
  for (const [name, value] of Object.entries(extra)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  state.headers = headers;
  return headers;
}

let route: PasswordRoute;

function change(body: unknown = VALID_BODY, options: { raw?: string; headers?: Record<string, string | null> } = {}) {
  const headers = prepare(options.headers);
  return route.POST(new Request('http://localhost/api/account/password', {
    method: 'POST',
    headers,
    body: options.raw ?? JSON.stringify(body),
  }));
}

function changeTo(next: string): Promise<Response> {
  return change({ current_password: CURRENT_PASSWORD, new_password: next });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function cookiesOf(res: Response): Map<string, Cookie> {
  const out = new Map<string, Cookie>();
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attributes] = line.split(';').map((part) => part.trim());
    const split = pair.indexOf('=');
    const parsed = new Map<string, string | true>();
    for (const attribute of attributes) {
      const at = attribute.indexOf('=');
      if (at === -1) parsed.set(attribute.toLowerCase(), true);
      else parsed.set(attribute.slice(0, at).toLowerCase(), attribute.slice(at + 1));
    }
    out.set(pair.slice(0, split), { value: decodeURIComponent(pair.slice(split + 1)), attributes: parsed });
  }
  return out;
}

function queriesOn(table: string, op: Query['op']): Query[] {
  return state.queries.filter((query) => query.table === table && query.op === op);
}

function audits(): Array<Record<string, unknown>> {
  return queriesOn('audit_log', 'insert').map((query) => query.payload as Record<string, unknown>);
}

function pick(row: Record<string, unknown> | undefined, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = row?.[key];
  return out;
}

function auditRow(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    admin_id: ADMIN_ID,
    user_id: null,
    action: null,
    entity: 'admin_users',
    entity_id: ADMIN_ID,
    before_value: null,
    after_value: null,
    ip_address: CLIENT_IP,
    admin_role: ROLE,
    user_agent: USER_AGENT,
    request_id: REQUEST_ID,
    reason: null,
    result: 'success',
    error: null,
    sensitivity: 'security',
    ...patch,
  };
}

function failureBody(code: string, message: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { success: false, error: message, code, message, request_id: REQUEST_ID, ...extra };
}

function assertNoSecrets(text: string, secrets: readonly string[] = SECRETS): void {
  for (const secret of secrets) assert.ok(!text.includes(secret), `leaked ${secret}`);
}

function passwordSaves(): Array<Record<string, unknown>> {
  return state.rpcs.filter((call) => call.name === 'admin_password_change').map((call) => call.args);
}

function assertNothingChanged(): void {
  assert.deepEqual(queriesOn('admin_users', 'update'), []);
  assert.deepEqual(passwordSaves(), []);
  assert.deepEqual(state.hashes, []);
  assert.deepEqual(state.signed, []);
}

async function withNodeEnv<T>(value: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  Reflect.set(process.env, 'NODE_ENV', value);
  try {
    return await run();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Reflect.set(process.env, 'NODE_ENV', previous);
  }
}

let policy: PolicyModule;
let model: ModelModule;
let parts: PartsModule;
let link: LinkModule;
let page: PageModule;
let confirmUi: ConfirmModule;

before(async () => {
  route = (await import(await bundle(ROUTE_FILE))) as PasswordRoute;
  policy = await loadAppModule<PolicyModule>('lib/passwordPolicy.ts');
  model = await loadAppModule<ModelModule>('(dashboard)/profile/model.ts');
  parts = await loadAppModule<PartsModule>('(dashboard)/profile/ProfileParts.tsx');
  link = await loadAppModule<LinkModule>('(dashboard)/profile/ProfileLink.tsx');
  page = await loadAppModule<PageModule>('(dashboard)/profile/page.tsx');
  confirmUi = await loadUi<ConfirmModule>('Confirm.tsx');
});

beforeEach(() => {
  reset();
  mock.method(console, 'error', (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(' '));
  });
});

afterEach(() => {
  mock.restoreAll();
});

describe('the shared password policy', () => {
  const context = { current: CURRENT_PASSWORD, username: USERNAME, email: EMAIL };

  test('counts length in UTF-8 bytes, the way bcrypt does', () => {
    assert.equal(policy.PASSWORD_MAX_BYTES, 72);
    assert.equal(policy.utf8Length('abc'), 3);
    assert.equal(policy.utf8Length('é'), 2);
    assert.equal(policy.utf8Length('€'), 3);
    assert.equal(policy.utf8Length('😀'), 4);
    assert.equal(policy.utf8Length(`Aa1!${'é'.repeat(34)}`), 72);
  });

  test('treats two passwords as the same when bcrypt would, including past 72 bytes', () => {
    const long = `Aa1!${'x'.repeat(80)}`;
    assert.equal(policy.isSamePassword(CURRENT_PASSWORD, CURRENT_PASSWORD), true);
    assert.equal(policy.isSamePassword(CURRENT_PASSWORD, NEW_PASSWORD), false);
    assert.equal(policy.isSamePassword(long.slice(0, 72), long), true);
    assert.equal(policy.isSamePassword(long.slice(0, 71), long), false);
    assert.equal(policy.isSamePassword('', CURRENT_PASSWORD), false);
  });

  test('reads the username and the email name, lower-cased, ignoring names under three characters', () => {
    assert.deepEqual(policy.personalNames('Ops.Lead', 'Adaeze.Okafor@CardElite.test'), ['ops.lead', 'adaeze.okafor']);
    assert.deepEqual(policy.personalNames('ops', 'ops@cardelite.ng'), ['ops']);
    assert.deepEqual(policy.personalNames('ab', 'xy@cardelite.ng'), []);
    assert.deepEqual(policy.personalNames('ops', 'no-at-sign'), ['ops']);
    assert.deepEqual(policy.personalNames('ops', '@cardelite.ng'), ['ops']);
    assert.deepEqual(policy.personalNames(null, undefined), []);
  });

  test('lists every unmet rule, the existing ones first', () => {
    assert.deepEqual(policy.unmetOwnPasswordRules('abc', context), ['length', 'upper', 'digit', 'symbol']);
    assert.deepEqual(policy.unmetOwnPasswordRules(NEW_PASSWORD, context), []);
    assert.deepEqual(policy.unmetOwnPasswordRules(CURRENT_PASSWORD, context), ['different']);
    assert.deepEqual(policy.unmetOwnPasswordRules(`Aa1!${'x'.repeat(69)}`, context), ['bytes']);
    assert.deepEqual(policy.unmetOwnPasswordRules('Key-OPS.LEAD-2026', context), ['personal']);
    assert.deepEqual(policy.unmetOwnPasswordRules('Adaeze.Okafor-Key-2026', context), ['personal']);
    assert.deepEqual(policy.unmetOwnPasswordRules(CURRENT_PASSWORD, { ...context, current: '' }), []);
  });

  test('explains the first problem in plain words, or nothing when the password is fine', () => {
    assert.deepEqual(policy.checkOwnPassword('', context), { rule: null, message: NEW_REQUIRED });
    assert.deepEqual(policy.checkOwnPassword(42, context), { rule: null, message: NEW_REQUIRED });
    assert.deepEqual(policy.checkOwnPassword('Short1!a', context), {
      rule: 'length', message: 'Password must be at least 12 characters.',
    });
    assert.deepEqual(policy.checkOwnPassword(`Aa1!${'x'.repeat(69)}`, context), {
      rule: 'bytes',
      message: 'Password must be 72 bytes or fewer. Emoji and accented letters take more than one byte each.',
    });
    assert.deepEqual(policy.checkOwnPassword(CURRENT_PASSWORD, context), {
      rule: 'different', message: 'Password must be different from your current password.',
    });
    assert.deepEqual(policy.checkOwnPassword('Key-OPS.LEAD-2026', context), {
      rule: 'personal', message: 'Password must not contain your username or the part of your email before the @.',
    });
    assert.equal(policy.checkOwnPassword(NEW_PASSWORD, context), null);
  });

  test('offers one checklist label per rule, the existing five first and unchanged', () => {
    assert.deepEqual(policy.OWN_PASSWORD_RULES.map((rule) => rule.id), [
      'length', 'lower', 'upper', 'digit', 'symbol', 'bytes', 'different', 'personal',
    ]);
    assert.deepEqual(policy.OWN_PASSWORD_RULES.slice(0, 5), [...policy.PASSWORD_RULES]);
    for (const rule of policy.OWN_PASSWORD_RULES) assert.match(rule.label, /^[A-Z]/, rule.id);
  });
});

describe('POST /api/account/password: who can call it', () => {
  test('no session is a 401 before the body, the rate limit or the account is touched', async () => {
    reset({ claims: null });
    const res = await change();
    assert.equal(res.status, 401);
    const body = await bodyOf(res);
    assert.equal(body.code, 'AUTH_REQUIRED');
    assert.equal(body.request_id, REQUEST_ID);
    assert.deepEqual(state.rpcs, []);
    assert.deepEqual(state.queries, []);
    assert.deepEqual(state.compares, []);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('any signed-in admin may change their own password, with no grant and no super-admin role', async () => {
    reset({ claims: signedInAs({ page_permissions: [], is_super_admin: false }) });
    const res = await change();
    assert.equal(res.status, 200);
    reset({ claims: signedInAs({ is_super_admin: true }), reads: [account({ is_super_admin: true })] });
    assert.equal((await change()).status, 200);
  });

  test('the account is always the session admin, never an id sent in the body', async () => {
    const res = await change({ ...VALID_BODY, admin_id: OTHER_ADMIN_ID, id: OTHER_ADMIN_ID, username: 'someone' });
    assert.equal(res.status, 200);
    assert.deepEqual(state.rpcs[0]?.args.p_key, `admin:${ADMIN_ID}`);
    assert.deepEqual(queriesOn('admin_users', 'select').map((query) => query.filters), [[['eq', 'id', ADMIN_ID]]]);
    assert.equal(passwordSaves()[0]?.p_admin_id, ADMIN_ID);
    assert.equal(audits()[0]?.entity_id, ADMIN_ID);
    reset({ claims: signedInAs({ admin_id: OTHER_ADMIN_ID }), reads: [account({ id: OTHER_ADMIN_ID })] });
    await change({ ...VALID_BODY, admin_id: ADMIN_ID });
    assert.deepEqual(queriesOn('admin_users', 'select').map((query) => query.filters), [[['eq', 'id', OTHER_ADMIN_ID]]]);
  });
});

describe('POST /api/account/password: request checks', () => {
  test('a missing, empty or non-string field is refused with its field before the rate limit', async () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ new_password: NEW_PASSWORD }, 'current_password', CURRENT_REQUIRED],
      [{ current_password: '', new_password: NEW_PASSWORD }, 'current_password', CURRENT_REQUIRED],
      [{ current_password: 12345, new_password: NEW_PASSWORD }, 'current_password', CURRENT_REQUIRED],
      [{ current_password: CURRENT_PASSWORD }, 'new_password', NEW_REQUIRED],
      [{ current_password: CURRENT_PASSWORD, new_password: '' }, 'new_password', NEW_REQUIRED],
      [{ current_password: CURRENT_PASSWORD, new_password: ['x'] }, 'new_password', NEW_REQUIRED],
    ];
    for (const [body, field, message] of cases) {
      reset();
      const res = await change(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(await bodyOf(res), failureBody('VALIDATION_ERROR', message, { details: { field } }));
      assert.deepEqual(state.rpcs, []);
      assert.deepEqual(state.queries, []);
    }
  });

  test('an unreadable body is a 400 that names nothing', async () => {
    for (const raw of ['not json', 'null', '[]', '"password"']) {
      reset();
      const res = await change(undefined, { raw });
      assert.equal(res.status, 400, raw);
      assert.deepEqual(await bodyOf(res), failureBody('VALIDATION_ERROR', MISSING_BODY));
      assert.deepEqual(state.rpcs, []);
    }
  });
});

describe('POST /api/account/password: rate limit', () => {
  test('every attempt counts against the admin: 5 in 15 minutes, through check_rate_limit_by_key', async () => {
    await change();
    assert.deepEqual(state.rpcs[0], {
      name: 'check_rate_limit_by_key',
      args: { p_key: `admin:${ADMIN_ID}`, p_action: 'admin_password_change', p_limit: 5, p_window_secs: 900 },
    });
    assert.deepEqual(state.rpcs.map((call) => call.name), ['check_rate_limit_by_key', 'admin_password_change']);
  });

  test('over the limit is a 429 with no account read, compare or audit', async () => {
    reset({ limit: false });
    const res = await change();
    assert.equal(res.status, 429);
    assert.deepEqual(await bodyOf(res), failureBody('RATE_LIMITED', TOO_MANY));
    assert.deepEqual(state.queries, []);
    assert.deepEqual(state.compares, []);
    assert.deepEqual(audits(), []);
  });

  test('a rate limit that cannot be checked fails closed with a 429, and is logged', async () => {
    for (const limit of ['error', 'throw', null] as const) {
      reset({ limit });
      const res = await change();
      assert.equal(res.status, 429, String(limit));
      const body = await bodyOf(res);
      assert.equal(body.code, 'RATE_LIMITED');
      assert.equal(body.error, limit === null ? TOO_MANY : LIMIT_UNAVAILABLE, String(limit));
      assert.deepEqual(state.queries, [], String(limit));
      assert.deepEqual(state.compares, [], String(limit));
      if (limit === 'error') assert.ok(logs.some((line) => line.includes(LIMIT_DOWN)));
      if (limit === 'throw') assert.ok(logs.some((line) => line.includes('fetch failed')));
      assertNoSecrets(logs.join('\n'));
    }
  });
});

describe('POST /api/account/password: the current password', () => {
  test('is read fresh, and a missing or deactivated account ends the session with a 401', async () => {
    await change();
    assert.deepEqual(queriesOn('admin_users', 'select').map((query) => [query.columns, query.terminal]), [[
      'id, username, email, password_hash, role_title, is_super_admin, is_active, page_permissions, token_version',
      'maybeSingle',
    ]]);
    for (const read of [null, account({ is_active: false })]) {
      reset({ reads: [read] });
      const res = await change();
      assert.equal(res.status, 401);
      assert.equal((await bodyOf(res)).code, 'AUTH_REQUIRED');
      assert.deepEqual(state.compares, []);
      assertNothingChanged();
    }
  });

  test('an account that cannot be read is a 500, logged, with nothing changed', async () => {
    reset({ reads: [{ error: 'connection terminated' }] });
    const res = await change();
    assert.equal(res.status, 500);
    assert.deepEqual(await bodyOf(res), failureBody('INTERNAL_ERROR', READ_FAILED));
    assert.ok(logs.some((line) => line.includes('connection terminated')));
    assertNothingChanged();
  });

  test('a wrong current password is a 400 on current_password, never a 401, and is audited without the password', async () => {
    const res = await change({ current_password: WRONG_PASSWORD, new_password: NEW_PASSWORD });
    assert.equal(res.status, 400);
    assert.deepEqual(await bodyOf(res), failureBody('VALIDATION_ERROR', CURRENT_INCORRECT, {
      details: { field: 'current_password' },
    }));
    assert.deepEqual(state.compares, [[WRONG_PASSWORD, STORED_HASH]]);
    const rows = audits();
    assert.equal(rows.length, 1);
    assert.deepEqual(pick(rows[0], AUDIT_KEYS), auditRow({
      action: 'PASSWORD_CHANGE_FAILED',
      result: 'failure',
      error: 'Current password did not match.',
    }));
    assertNoSecrets(JSON.stringify(rows));
    assertNoSecrets(logs.join('\n'));
    assertNothingChanged();
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('a stored hash that cannot be compared counts as a wrong password, and is logged', async () => {
    reset({ compareError: 'Invalid salt version: xx' });
    const res = await change();
    assert.equal(res.status, 400);
    assert.deepEqual((await bodyOf(res)).details, { field: 'current_password' });
    assert.ok(logs.some((line) => line.includes('Invalid salt version')));
    assert.deepEqual(audits().map((row) => row.action), ['PASSWORD_CHANGE_FAILED']);
    assertNothingChanged();
  });

  test('an account with no stored hash cannot change its password', async () => {
    reset({ reads: [account({ password_hash: null })] });
    const res = await change();
    assert.equal(res.status, 400);
    assert.deepEqual(state.compares, []);
    assertNothingChanged();
  });
});

describe('POST /api/account/password: the new password', () => {
  test('every rule is enforced after the current password checks out, naming the field and the rule', async () => {
    const context = { current: CURRENT_PASSWORD, username: USERNAME, email: EMAIL };
    const cases: Array<[string, string]> = [
      ['Sh0rt!pass', 'length'],
      ['NOLOWER-CASE-123', 'lower'],
      ['noupper-case-123', 'upper'],
      ['No-Digits-Here-At-All', 'digit'],
      ['NoSymbolsHere12345', 'symbol'],
      [`Aa1!${'x'.repeat(69)}`, 'bytes'],
      [`Aa1!${'é'.repeat(35)}`, 'bytes'],
      [CURRENT_PASSWORD, 'different'],
      ['My-OPS.LEAD-Key-2026', 'personal'],
      ['Adaeze.Okafor-Key-2026', 'personal'],
    ];
    for (const [next, rule] of cases) {
      reset();
      const res = await changeTo(next);
      assert.equal(res.status, 400, next);
      const expected = policy.checkOwnPassword(next, context);
      assert.equal(expected?.rule, rule, next);
      assert.deepEqual(await bodyOf(res), failureBody('VALIDATION_ERROR', expected?.message ?? '', {
        details: { field: 'new_password', rule },
      }), next);
      assert.deepEqual(state.compares, [[CURRENT_PASSWORD, STORED_HASH]], next);
      assert.deepEqual(audits(), [], next);
      assertNothingChanged();
    }
  });

  test('72 bytes is the limit, counted in UTF-8 bytes rather than characters', async () => {
    const accepted = [`Aa1!${'x'.repeat(68)}`, `Aa1!${'é'.repeat(34)}`, `Aa1!${'x'.repeat(60)}😀😀`];
    for (const next of accepted) {
      reset();
      const res = await changeTo(next);
      assert.equal(res.status, 200, next);
      assert.deepEqual(state.hashes, [[next, 12]], next);
    }
    for (const next of [`Aa1!${'x'.repeat(69)}`, `Aa1!${'x'.repeat(61)}😀😀`]) {
      reset();
      const res = await changeTo(next);
      assert.equal(res.status, 400, next);
      assert.deepEqual((await bodyOf(res)).details, { field: 'new_password', rule: 'bytes' });
      assertNothingChanged();
    }
  });
});

describe('POST /api/account/password: saving', () => {
  test('hashes at cost 12 and saves through one admin_password_change call that keeps this session', async () => {
    const res = await change();
    assert.equal(res.status, 200);
    assert.deepEqual(state.hashes, [[NEW_PASSWORD, 12]]);
    assert.deepEqual(passwordSaves(), [{
      p_admin_id: ADMIN_ID,
      p_expected_token_version: 4,
      p_password_hash: NEW_HASH,
      p_keep_sid: SID,
    }]);
    assert.deepEqual(queriesOn('admin_users', 'update'), []);
  });

  test('the token is signed before saving, with the next version, this session and its methods, and its original expiry', async () => {
    await change();
    assert.deepEqual(state.signed, [[{
      id: ADMIN_ID,
      username: USERNAME,
      role_title: ROLE,
      is_super_admin: false,
      page_permissions: ['withdrawals', 'card_queue'],
      token_version: 5,
    }, SID, ['otp', 'pwd'], Math.floor(Date.parse(sessionExpiresAt) / 1000)]]);
    assert.ok(state.timeline.indexOf('sign') < state.timeline.indexOf('rpc:admin_password_change'));
  });

  test('a token version never bumped before is sent as 0 and the session is signed with 1', async () => {
    reset({ reads: [account({ token_version: null })] });
    await change();
    assert.equal(passwordSaves()[0]?.p_expected_token_version, 0);
    assert.equal(state.signed[0]?.[0].token_version, 1);
  });

  test('a lost race re-reads, checks the current password again and retries once, hashing only once', async () => {
    reset({ reads: [account(), account({ token_version: 7 })], saves: ['lost', 'saved'] });
    const res = await change();
    assert.equal(res.status, 200);
    assert.equal(queriesOn('admin_users', 'select').length, 2);
    assert.deepEqual(state.compares, [[CURRENT_PASSWORD, STORED_HASH], [CURRENT_PASSWORD, STORED_HASH]]);
    assert.deepEqual(state.hashes, [[NEW_PASSWORD, 12]]);
    assert.deepEqual(passwordSaves().map((args) => [args.p_expected_token_version, args.p_password_hash, args.p_keep_sid]), [
      [4, NEW_HASH, SID],
      [7, NEW_HASH, SID],
    ]);
    assert.deepEqual(state.signed.map((entry) => entry[0].token_version), [5, 8]);
    assert.equal(cookiesOf(res).get('admin_token')?.value, ISSUED_TOKEN);
    assert.deepEqual(audits().map((row) => [row.action, row.result]), [['PASSWORD_CHANGED', 'success']]);
  });

  test('losing the race twice is a 409 with nothing re-issued or recorded', async () => {
    reset({ reads: [account(), account({ token_version: 5 })], saves: ['lost', 'lost'] });
    const res = await change();
    assert.equal(res.status, 409);
    assert.deepEqual(await bodyOf(res), failureBody('STATE_CONFLICT', KEPT_CHANGING));
    assert.equal(passwordSaves().length, 2);
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.deepEqual(audits(), []);
  });

  test('a password changed elsewhere during the race is caught by the second check', async () => {
    reset({ reads: [account(), account({ password_hash: OTHER_HASH, token_version: 5 })], saves: ['lost'] });
    const res = await change();
    assert.equal(res.status, 400);
    assert.deepEqual((await bodyOf(res)).details, { field: 'current_password' });
    assert.deepEqual(state.compares, [[CURRENT_PASSWORD, STORED_HASH], [CURRENT_PASSWORD, OTHER_HASH]]);
    assert.equal(passwordSaves().length, 1);
    assert.deepEqual(audits().map((row) => row.action), ['PASSWORD_CHANGE_FAILED']);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('a database error, a lost call or an unexpected refusal is a 500, recorded as a failed change, with nothing re-issued', async () => {
    const cases: Array<[SaveStep, string]> = [
      [{ error: DB_REFUSED }, DB_REFUSED],
      ['throw', 'fetch failed'],
      ['refused', 'The password change returned no result.'],
    ];
    for (const [save, logged] of cases) {
      reset({ saves: [save] });
      const res = await change();
      assert.equal(res.status, 500, logged);
      assert.deepEqual(await bodyOf(res), failureBody('INTERNAL_ERROR', SAVE_FAILED));
      assert.deepEqual(pick(audits()[0], AUDIT_KEYS), auditRow({
        action: 'PASSWORD_CHANGE_FAILED', result: 'failure', error: logged,
      }));
      assert.ok(logs.some((line) => line.includes(logged)), logged);
      assert.deepEqual(res.headers.getSetCookie(), []);
      assertNoSecrets(JSON.stringify(audits()));
      assertNoSecrets(logs.join('\n'));
    }
  });

  test('a session that cannot be signed stops the change before anything is saved', async () => {
    reset({ signError: 'ADMIN_JWT_SECRET is not set' });
    const res = await change();
    assert.equal(res.status, 500);
    assert.deepEqual(await bodyOf(res), failureBody('INTERNAL_ERROR', SAVE_FAILED));
    assert.deepEqual(passwordSaves(), []);
    assert.deepEqual(audits(), []);
    assert.ok(logs.some((line) => line.includes('ADMIN_JWT_SECRET is not set')));
  });
});

describe('POST /api/account/password: this session', () => {
  test('the browser keeps this session with the new version, until its original end, never a fresh 8 hours', async () => {
    const res = await change();
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), {
      success: true,
      request_id: REQUEST_ID,
      changed: true,
      sessions_revoked: true,
      session_renewed: true,
      audit_recorded: true,
    });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const cookies = cookiesOf(res);
    assert.deepEqual([...cookies.keys()], ['admin_token']);
    const session = cookies.get('admin_token');
    assert.equal(session?.value, ISSUED_TOKEN);
    assert.equal(session?.attributes.get('httponly'), true);
    assert.equal(session?.attributes.get('samesite'), 'strict');
    assert.equal(session?.attributes.get('path'), '/');
    assert.equal(session?.attributes.has('secure'), false);
    const maxAge = Number(session?.attributes.get('max-age'));
    assert.ok(maxAge >= 5 * 3600 - 2 && maxAge <= 5 * 3600, String(maxAge));
  });

  test('the cookie is Secure in production', async () => {
    const res = await withNodeEnv('production', () => change());
    assert.equal(cookiesOf(res).get('admin_token')?.attributes.get('secure'), true);
  });

  test('a mobile bearer session is not kept: every session ends and the app signs in again with the new password', async () => {
    reset({ claims: signedInAs({ session: webSession({ client: 'mobile', transport: 'bearer', amr: ['pwd'] }) }) });
    const res = await change(VALID_BODY, { headers: { 'x-client': 'mobile-admin', authorization: `Bearer ${BEARER}` } });
    assert.equal(res.status, 200);
    const body = await bodyOf(res);
    assert.equal(body.session_renewed, false);
    assert.equal(body.sessions_revoked, true);
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.deepEqual(state.signed, []);
    assert.equal(passwordSaves()[0]?.p_keep_sid, null);
  });

  test('a cookie from before sessions had ids is not kept either', async () => {
    reset({ claims: signedInAs({ session: null }) });
    const res = await change();
    assert.equal(res.status, 200);
    assert.equal((await bodyOf(res)).session_renewed, false);
    assert.equal(passwordSaves()[0]?.p_keep_sid, null);
    assert.deepEqual(state.signed, []);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('a session that ended while the password was saved is not re-issued, and the page is told', async () => {
    reset({ saves: ['not-kept'] });
    const res = await change();
    assert.equal(res.status, 200);
    assert.equal((await bodyOf(res)).session_renewed, false);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('the mobile header alone no longer decides anything; the verified session does', async () => {
    const res = await change(VALID_BODY, { headers: { 'x-client': 'mobile-admin' } });
    assert.equal((await bodyOf(res)).session_renewed, true);
    assert.equal(passwordSaves()[0]?.p_keep_sid, SID);
  });
});

describe('POST /api/account/password: audit', () => {
  test('a change records PASSWORD_CHANGED as a security event, with the other sessions it ended, and no password material', async () => {
    const res = await change();
    const rows = audits();
    assert.equal(rows.length, 1);
    assert.deepEqual(pick(rows[0], AUDIT_KEYS), auditRow({
      action: 'PASSWORD_CHANGED',
      after_value: { password_changed: true, token_version_bumped: true, sessions_revoked: 2 },
    }));
    assertNoSecrets(JSON.stringify(rows), [...SECRETS, ISSUED_TOKEN]);
    assertNoSecrets(JSON.stringify(await bodyOf(res)), [...SECRETS, ISSUED_TOKEN]);
    assertNoSecrets(JSON.stringify(state.rpcs.filter((call) => call.name !== 'admin_password_change')));
    assertNoSecrets(JSON.stringify(passwordSaves()), [CURRENT_PASSWORD, NEW_PASSWORD, WRONG_PASSWORD, STORED_HASH, OTHER_HASH]);
    assertNoSecrets(JSON.stringify(state.signed));
    assertNoSecrets(logs.join('\n'));
  });

  test('an audit write that fails still keeps the change and says so additively', async () => {
    reset({ auditError: AUDIT_DOWN });
    const res = await change();
    assert.equal(res.status, 200);
    const body = await bodyOf(res);
    assert.equal(body.audit_recorded, false);
    assert.equal(body.warning, AUDIT_WARNING);
    assert.equal(cookiesOf(res).get('admin_token')?.value, ISSUED_TOKEN);
  });
});

describe('the password route source', () => {
  const source = readFileSync(ROUTE_FILE, 'utf8');

  test('takes any signed-in admin through requireAdmin(), and never answers 403', () => {
    assert.match(source, /const guard = await requireAdmin\(\);/);
    assert.doesNotMatch(source, /requireAdmin\(['"]|requireAdminAny|requireAdminAll|requireSuperAdmin/);
    assert.doesNotMatch(source, /PERMISSION_DENIED|status: 403|verifyAdminFromRequest|REAUTH_REQUIRED|MFA_REQUIRED/);
  });

  test('writes its audit rows through writeAudit with literal actions, as security events', () => {
    assert.equal(source.match(/writeAudit\(/g)?.length, 3);
    assert.equal(source.match(/action: 'PASSWORD_CHANGE_FAILED',/g)?.length, 2);
    assert.equal(source.match(/action: 'PASSWORD_CHANGED',/g)?.length, 1);
    assert.equal(source.match(/sensitivity: 'security',/g)?.length, 3);
    assert.doesNotMatch(source, /from\('audit_log'\)|NextResponse\.json\(|x-forwarded-for/i);
  });

  test('never reads an admin id from the body, and logs only messages, never a password', () => {
    assert.doesNotMatch(source, /(?:record|body)\.(?:admin_id|id|username)\b/);
    const logged = [...source.matchAll(/console\.error\(([^;]*)\);/g)].map((match) => match[1]);
    assert.ok(logged.length > 0);
    for (const args of logged) {
      assert.match(args, /^'[^']+', (?:error\.message|errorText\(error\)|saved\.message)$/, args);
    }
  });

  test('saves in one database call and re-signs this session with its original expiry, never a fresh lifetime', () => {
    assert.match(source, /supabaseAdmin\.rpc\('admin_password_change'/);
    assert.match(source, /signSessionToken\(tokenAdmin\(row, expected \+ 1\), session\.id, session\.amr, epochSeconds\(session\.expiresAt\)\)/);
    assert.match(source, /setSessionCookie\(response, token, session\.expiresAt\)/);
    assert.match(source, /admin\.session\.transport === 'cookie'/);
    assert.doesNotMatch(source, /\.update\(|maxAge|'8h'|60 \* 60 \* 8|x-client|cookies\.set/);
  });
});

const PROFILE: ProfileAccount = {
  id: ADMIN_ID,
  username: USERNAME,
  email: EMAIL,
  roleTitle: ROLE,
  isSuperAdmin: false,
  lastLoginAt: '2026-10-11T08:15:00.000Z',
  createdAt: '2026-01-02T09:00:00.000Z',
};

const NOW = new Date('2026-10-11T10:20:00.000Z');

function draft(patch: Partial<PasswordDraft> = {}): PasswordDraft {
  return { ...model.EMPTY_PASSWORD_DRAFT, ...patch };
}

function failure(patch: Partial<ApiFailure>): ApiResult<PasswordChangeResult> {
  return {
    ok: false,
    error: {
      kind: 'http',
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Refused.',
      requestId: REQUEST_ID,
      details: null,
      outcomeUnknown: false,
      ...patch,
    },
  };
}

describe('profile model', () => {
  test('reads the account from /api/auth/me, keeping only what the page shows', () => {
    assert.equal(model.PROFILE_PATH, '/api/auth/me');
    assert.equal(model.PASSWORD_PATH, '/api/account/password');
    assert.deepEqual(model.toProfileAccount({
      success: true,
      admin: {
        id: ADMIN_ID, username: USERNAME, email: EMAIL, role_title: ROLE, is_super_admin: true,
        page_permissions: ['withdrawals'], last_login_at: PROFILE.lastLoginAt, created_at: PROFILE.createdAt,
      },
    }), { ...PROFILE, isSuperAdmin: true });
    assert.deepEqual(model.toProfileAccount({
      admin: { id: ADMIN_ID, username: USERNAME, email: null, role_title: null, last_login_at: 'yesterday', created_at: null },
    }), { ...PROFILE, email: null, roleTitle: '', lastLoginAt: null, createdAt: null });
    assert.equal(model.toProfileAccount({ admin: { username: USERNAME } }), null);
    assert.equal(model.toProfileAccount({ admin: { id: ADMIN_ID } }), null);
    assert.equal(model.toProfileAccount({ admin: [] }), null);
    assert.equal(model.toProfileAccount({}), null);
  });

  test('shows sign-in and creation times in Lagos time', () => {
    assert.equal(model.lastSignInText(PROFILE.lastLoginAt, NOW), '11 Oct 2026, 09:15 WAT · 2h ago');
    assert.equal(model.lastSignInText(null, NOW), 'Never');
    assert.equal(model.createdText(PROFILE.createdAt), '02 Jan 2026, 10:00 WAT');
    assert.equal(model.createdText(null), '—');
  });

  test('the checklist starts empty and ticks each rule as the new password meets it', () => {
    const empty = model.passwordChecklist(draft(), PROFILE);
    assert.equal(empty.length, 8);
    assert.ok(empty.every((item) => !item.met));
    const ready = model.passwordChecklist(draft({ current: CURRENT_PASSWORD, next: NEW_PASSWORD }), PROFILE);
    assert.ok(ready.every((item) => item.met), JSON.stringify(ready));
    const noCurrent = model.passwordChecklist(draft({ next: NEW_PASSWORD }), PROFILE);
    assert.deepEqual(noCurrent.filter((item) => !item.met).map((item) => item.id), ['different']);
    const reused = model.passwordChecklist(draft({ current: CURRENT_PASSWORD, next: CURRENT_PASSWORD }), PROFILE);
    assert.deepEqual(reused.filter((item) => !item.met).map((item) => item.id), ['different']);
    const personal = model.passwordChecklist(draft({ current: CURRENT_PASSWORD, next: 'Key-Ops.Lead-2026' }), PROFILE);
    assert.deepEqual(personal.filter((item) => !item.met).map((item) => item.id), ['personal']);
    const short = model.passwordChecklist(draft({ current: CURRENT_PASSWORD, next: 'ab' }), PROFILE);
    assert.deepEqual(short.filter((item) => item.met).map((item) => item.id), ['lower', 'bytes', 'different', 'personal']);
  });

  test('validates every field before anything is sent', () => {
    assert.deepEqual(model.validatePasswordDraft(draft(), PROFILE), {
      current: model.CURRENT_REQUIRED, next: NEW_REQUIRED, confirm: model.CONFIRM_REQUIRED,
    });
    assert.deepEqual(model.validatePasswordDraft(draft({ current: CURRENT_PASSWORD, next: NEW_PASSWORD, confirm: 'Other-1!' }), PROFILE), {
      confirm: model.CONFIRM_MISMATCH,
    });
    assert.deepEqual(model.validatePasswordDraft(draft({ current: CURRENT_PASSWORD, next: 'weak', confirm: 'weak' }), PROFILE), {
      next: 'Password must be at least 12 characters.',
    });
    assert.deepEqual(model.validatePasswordDraft(draft({ current: CURRENT_PASSWORD, next: NEW_PASSWORD, confirm: NEW_PASSWORD }), PROFILE), {});
    assert.equal(model.firstPasswordError({ confirm: 'x', next: 'y' }), 'next');
    assert.equal(model.firstPasswordError({}), null);
  });

  test('sends exactly the two passwords, untouched', () => {
    assert.deepEqual(model.passwordChangeBody(draft({ current: ' spaced ', next: `${NEW_PASSWORD} `, confirm: 'ignored' })), {
      current_password: ' spaced ',
      new_password: `${NEW_PASSWORD} `,
    });
  });

  test('reads the change result, and classifies every failure', () => {
    assert.deepEqual(model.toPasswordChangeResult({ success: true, changed: true, session_renewed: true }), {
      sessionRenewed: true, warning: null,
    });
    assert.deepEqual(model.toPasswordChangeResult({ changed: true, session_renewed: false, warning: AUDIT_WARNING }), {
      sessionRenewed: false, warning: AUDIT_WARNING,
    });
    assert.equal(model.toPasswordChangeResult({ success: true }), null);
    const done: ApiResult<PasswordChangeResult> = {
      ok: true, data: { sessionRenewed: true, warning: null }, status: 200, requestId: REQUEST_ID,
    };
    assert.deepEqual(model.classifyPasswordChange(done), { kind: 'done', result: { sessionRenewed: true, warning: null } });
    assert.deepEqual(model.classifyPasswordChange(failure({ message: CURRENT_INCORRECT, details: { field: 'current_password' } })), {
      kind: 'field', field: 'current', message: CURRENT_INCORRECT,
    });
    assert.deepEqual(model.classifyPasswordChange(failure({ message: 'Too short.', details: { field: 'new_password', rule: 'length' } })), {
      kind: 'field', field: 'next', message: 'Too short.',
    });
    assert.deepEqual(model.classifyPasswordChange(failure({ status: 401, code: 'AUTH_REQUIRED' })), { kind: 'expired' });
    assert.deepEqual(model.classifyPasswordChange(failure({ status: 429, code: 'RATE_LIMITED', message: TOO_MANY })), {
      kind: 'notice', tone: 'danger', message: TOO_MANY,
    });
    assert.deepEqual(model.classifyPasswordChange(failure({ status: 409, code: 'STATE_CONFLICT', message: KEPT_CHANGING })), {
      kind: 'notice', tone: 'warning', message: KEPT_CHANGING,
    });
    assert.deepEqual(model.classifyPasswordChange(failure({ status: 500, code: 'INTERNAL_ERROR', message: SAVE_FAILED })), {
      kind: 'retry', message: SAVE_FAILED,
    });
    assert.deepEqual(model.classifyPasswordChange(failure({ message: MISSING_BODY })), { kind: 'retry', message: MISSING_BODY });
    assert.deepEqual(model.classifyPasswordChange(failure({ details: { field: 'constructor' } })), { kind: 'retry', message: 'Refused.' });
    assert.deepEqual(
      model.classifyPasswordChange(failure({ kind: 'timeout', status: null, code: null, outcomeUnknown: true })),
      { kind: 'notice', tone: 'warning', message: model.UNKNOWN_OUTCOME },
    );
    assert.deepEqual(
      model.classifyPasswordChange(failure({ kind: 'parse', status: null, code: null, message: 'Not sent.' })),
      { kind: 'retry', message: 'Not sent.' },
    );
  });

  test('the confirmation says plainly that other devices and the mobile app are signed out, and this one stays', () => {
    const options = model.passwordChangeConfirm();
    assert.equal(options.title, 'Change your password?');
    assert.equal(
      options.message,
      'Changing your password signs you out on your other devices, including the CardElite Admin mobile app. You stay signed in here.',
    );
    assert.deepEqual(options.consequences, ['Sign in on your other devices and the mobile app with the new password.']);
    assert.equal(options.confirmLabel, 'Change password');
    assert.match(model.CHANGED_MESSAGE, /signed out on your other devices/);
  });
});

function confirmShell(...children: ReactNode[]): string {
  return render(createElement(confirmUi.ConfirmProvider, null, ...children));
}

describe('profile page rendering', () => {
  test('the account card shows the read-only details in Lagos time', () => {
    const html = render(createElement(parts.AccountDetails, { account: PROFILE, now: NOW }));
    const text = textOf(html);
    for (const expected of [
      'Account', 'Username', USERNAME, 'Email', EMAIL, 'Role title', ROLE, 'Last sign-in',
      '11 Oct 2026, 09:15 WAT · 2h ago', 'Account created', '02 Jan 2026, 10:00 WAT',
      'To change your email or role title, ask a super administrator.',
    ]) {
      assert.ok(text.includes(expected), expected);
    }
    assert.doesNotMatch(text, /Super admin\b/);
    assert.deepEqual(tagsOf(html, 'input'), []);
    assert.equal(tagsOf(html, 'h2').length, 1);
  });

  test('a super admin sees the badge, and missing values read plainly', () => {
    const html = render(createElement(parts.AccountDetails, {
      account: { ...PROFILE, isSuperAdmin: true, email: null, lastLoginAt: null, createdAt: null, roleTitle: '' },
      now: NOW,
    }));
    const text = textOf(html);
    assert.match(text, /Super admin/);
    assert.match(text, /Email None/);
    assert.match(text, /Last sign-in Never/);
    assert.match(text, /Account created —/);
    assert.match(text, /No role title/);
  });

  test('the password card has the three fields, their autocomplete hints, show/hide toggles and the rules', () => {
    const html = confirmShell(createElement(parts.PasswordCard, { account: PROFILE }));
    const text = textOf(html);
    assert.match(text, /Change password/);
    assert.match(text, /A new password signs you out on your other devices, including the mobile app\. You stay signed in here\./);
    const inputs = tagsOf(html, 'input');
    const passwords = inputs.filter((input) => input.type === 'password');
    assert.deepEqual(passwords.map((input) => input.autoComplete), ['current-password', 'new-password', 'new-password']);
    for (const input of passwords) {
      assert.ok(input.id, 'every password field has an id');
      assert.equal(input['aria-required'], 'true');
      assert.equal(input.spellCheck, 'false');
    }
    const username = inputs.find((input) => input.autoComplete === 'username');
    assert.ok(username && 'hidden' in username && 'readOnly' in username);
    assert.equal(username?.value, USERNAME);
    const toggles = tagsOf(html, 'button').filter((button) => /^Show /.test(button['aria-label'] ?? ''));
    assert.deepEqual(toggles.map((button) => button['aria-label']), [
      'Show current password', 'Show new password', 'Show new password confirmation',
    ]);
    assert.deepEqual(toggles.map((button) => button['aria-pressed']), ['false', 'false', 'false']);
    assert.deepEqual(toggles.map((button) => button['aria-controls']), passwords.map((input) => input.id));
    for (const label of ['Current password', 'New password', 'Confirm new password']) assert.ok(text.includes(label), label);
    const rules = tagsOf(html, 'ul').find((list) => list['aria-label'] === 'Password requirements');
    assert.ok(rules?.id);
    assert.ok(passwords[1]['aria-describedby']?.split(' ').includes(rules?.id ?? ''));
    assert.equal(withClass(html, 'li', 'rule').length, 8);
    assert.equal(withClass(html, 'li', 'ruleMet').length, 0);
    const submit = tagsOf(html, 'button').find((button) => button.type === 'submit');
    assert.ok(submit);
    assert.match(textOf(html.slice(html.lastIndexOf('<button'))), /Change password/);
  });

  test('the rules list marks met and unmet rules for sighted and screen reader users', () => {
    const items = model.passwordChecklist(draft({ current: CURRENT_PASSWORD, next: 'Velvet-harbour' }), PROFILE);
    const html = render(createElement(parts.PasswordRules, { id: 'rules', items }));
    assert.equal(withClass(html, 'li', 'ruleMet').length, items.filter((item) => item.met).length);
    assert.equal(withClass(html, 'li', 'rule').length, items.filter((item) => !item.met).length);
    const text = textOf(html);
    assert.match(text, /A number , not met yet/);
    assert.match(text, /An uppercase letter , met/);
    assert.match(text, /At most 72 bytes \(emoji and accented letters use more\) , met/);
  });

  test('the sidebar entry links to /profile and marks itself current there', () => {
    const plain = render(createElement(link.ProfileLink, { current: false, 'aria-label': 'Profile: ada', children: 'ada' }));
    const [anchor] = tagsOf(plain, 'a');
    assert.equal(anchor.href, '/profile');
    assert.equal(anchor['aria-current'], undefined);
    assert.equal(anchor['aria-label'], 'Profile: ada');
    assert.deepEqual(anchor.class?.split(' '), ['link']);
    const current = tagsOf(render(createElement(link.ProfileLink, { current: true, children: 'ada' })), 'a')[0];
    assert.equal(current['aria-current'], 'page');
    assert.deepEqual(current.class?.split(' '), ['link', 'current']);
  });

  test('the page opens with its header and a loading state, then fills from the server', () => {
    const html = render(createElement(page.default));
    const text = textOf(html);
    assert.match(text, /^Profile /);
    assert.match(text, /Your own account details and password\. Times are WAT\./);
    assert.match(text, /Loading your profile…/);
    const source = readFileSync(join(OWNED_DIR, 'page.tsx'), 'utf8');
    assert.match(source, /apiRequest\(PROFILE_PATH, \{ signal, select: toProfileAccount \}\)/);
    assert.match(source, /if \(expired\) notifySessionExpired\(\);/);
  });
});

describe('house rules for the profile files', () => {
  const owned = [
    ROUTE_FILE,
    POLICY_FILE,
    ...readdirSync(OWNED_DIR).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => join(OWNED_DIR, name)),
  ];
  const sheets = readdirSync(OWNED_DIR).filter((name) => name.endsWith('.css')).map((name) => join(OWNED_DIR, name));

  test('no prose comments, no static inline styles and no stacking numbers, and no comments in this test', () => {
    assert.ok(owned.length >= 6);
    for (const file of [...owned, TEST_FILE]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m, file);
    }
    for (const file of owned) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /style=\{\{/, file);
      assert.doesNotMatch(text, /z-?index/i, file);
    }
  });

  test('the stylesheets use tokens only', () => {
    const names = sheets.map((file) => file.slice(OWNED_DIR.length + 1));
    for (const name of ['ProfileLink.module.css', 'page.module.css']) assert.ok(names.includes(name), name);
    for (const name of names) assert.match(name, /^[A-Za-z]+\.module\.css$/, name);
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
    for (const file of sheets) {
      const css = readFileSync(file, 'utf8');
      assert.doesNotMatch(css, /\/\*/, file);
      for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
        assert.doesNotMatch(value, colour, `${file} ${property}: ${value}`);
        assert.notEqual(property, 'z-index', file);
      }
    }
  });

  test('client modules say so; the model and the policy stay free of React and server code', () => {
    for (const name of ['page.tsx', 'ProfileParts.tsx']) {
      assert.ok(readFileSync(join(OWNED_DIR, name), 'utf8').startsWith("'use client';"), name);
    }
    for (const file of [join(OWNED_DIR, 'model.ts'), POLICY_FILE]) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /'use client'|from 'react'|supabase|bcrypt|from 'next/, file);
    }
  });
});
