import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SignJWT, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import ts from 'typescript';
import { ERROR_MESSAGE } from '../app/lib/http.ts';

type PassModule = typeof import('../app/lib/realtimePass.ts');

interface PassRoute {
  POST: () => Promise<Response>;
}

interface DbReply {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

type Reply = DbReply | 'throw';

interface Grant {
  pagePermissions?: string[];
  superAdmin?: boolean;
  expiresAt?: string;
}

interface StubState {
  headers: Headers;
  cookies: Map<string, string>;
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
  queries: string[];
  authState: (sid: string) => Reply;
  stubClaims: unknown;
  db: {
    from(table: string): never;
    rpc(name: string, args: Record<string, unknown>): Promise<DbReply>;
  };
}

const STATE_KEY = '__cardeliteRealtimePassTest';
const ADMIN_DIR = fileURLToPath(new URL('../', import.meta.url));
const APP_DIR = join(ADMIN_DIR, 'app');
const LIB_DIR = join(APP_DIR, 'lib');
const UI_DIR = join(APP_DIR, '_ui');
const TEST_DIR = join(ADMIN_DIR, 'test');
const LIB_FILE = join(LIB_DIR, 'realtimePass.ts');
const SUPABASE_FILE = join(LIB_DIR, 'supabase.ts');
const JWT_FILE = join(LIB_DIR, 'jwt.ts');
const ROUTE_FILE = join(APP_DIR, 'api', 'realtime', 'pass', 'route.ts');
const TEST_FILE = fileURLToPath(import.meta.url);
const SESSION_TEST_FILE = join(TEST_DIR, 'sessionAuth.test.ts');
const SCHEMA_FILE = fileURLToPath(new URL('../../schema_admin_app.sql', import.meta.url));
const MOBILE_DIR = fileURLToPath(new URL('../../CardEliteAdmin/', import.meta.url));
const nodeRequire = createRequire(import.meta.url);

const ADMIN_SECRET = 'realtime-pass-test-admin-secret-0123456789abcdef';
const PASS_SECRET = 'realtime-pass-test-signing-secret-0123456789abcdef';
const OTHER_SECRET = 'a-different-signing-secret-entirely-0123456789';
const PUBLISHABLE_KEY = 'sb_publishable_realtimePassTestKey0123456789';
const SUPABASE_URL = 'https://project.supabase.test';
const ADMIN_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const WEB_SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
const PHONE_SID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const USERNAME = 'ops.lead';
const REQUEST_ID = 'req_realtimepass1';
const SESSION_UNAVAILABLE = 'Your session could not be checked. Try again.';
const SETTINGS = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_REALTIME_JWT_SECRET'] as const;
const BOTH_TOPICS = ['admin:withdrawals', 'admin:cards'];
const NEEDED = ['withdrawals.read', 'cards.read'];
const HOUR_MS = 60 * 60 * 1000;
const LOG_LEVELS = ['error', 'warn', 'log', 'info', 'debug'] as const;
const JWT_SHAPE = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;
const OFF = { success: true, request_id: REQUEST_ID, enabled: false };
const IMPORT_RE = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;
const VALUE_IMPORT_RE = /^(?:import|export)\s+(type\s+)?([^;'"]*?)\s*\bfrom\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;

const logs: string[] = [];

const state: StubState = {
  headers: new Headers(),
  cookies: new Map(),
  rpcs: [],
  queries: [],
  authState: (sid) => live(sid),
  stubClaims: null,
  db: {
    from: (table) => {
      state.queries.push(table);
      throw new Error(`unexpected query on ${table}`);
    },
    rpc: (name, args) => rpc(name, args),
  },
};

Reflect.set(globalThis, STATE_KEY, state);

function rpc(name: string, args: Record<string, unknown>): Promise<DbReply> {
  state.rpcs.push({ name, args });
  if (name !== 'admin_auth_state') return Promise.reject(new Error(`unexpected rpc ${name}`));
  const reply = state.authState(String(args.p_sid));
  if (reply === 'throw') return Promise.reject(new Error('fetch failed'));
  return Promise.resolve({ data: null, error: null, ...reply });
}

function moduleUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function stub(lines: string[]): string {
  return moduleUrl([`const state = () => globalThis.${STATE_KEY};`, ...lines].join('\n'));
}

function resolveRelative(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = /\.tsx?$/.test(base) ? [base] : [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`${fromFile} imports ${specifier}, which does not resolve`);
  return found;
}

function bundler(fileStubs: Readonly<Record<string, string>>, packageStubs: Readonly<Record<string, string>>) {
  const cache = new Map<string, Promise<string>>();
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
        targets.set(specifier, fileStubs[path] ?? (await bundle(path)));
      } else if (packageStubs[specifier]) {
        targets.set(specifier, packageStubs[specifier]);
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
    let pending = cache.get(file);
    if (!pending) {
      pending = transpile(file);
      cache.set(file, pending);
    }
    return pending;
  }
  return async <T>(path: string): Promise<T> => (await import(await bundle(path))) as T;
}

const SUPABASE_STUB = stub([
  'export const supabaseAdmin = {',
  '  from(table) { return state().db.from(table); },',
  '  rpc(name, args) { return state().db.rpc(name, args); },',
  '};',
]);

const NEXT_HEADERS_STUB = stub([
  'export async function headers() { return state().headers; }',
  'export async function cookies() {',
  '  return { get: (name) => (state().cookies.has(name) ? { name, value: state().cookies.get(name) } : undefined) };',
  '}',
]);

const NEXT_SERVER = pathToFileURL(nodeRequire.resolve('next/server')).href;

const REFUSING_JOSE = moduleUrl([
  'export class SignJWT {',
  '  setProtectedHeader() { return this; }',
  '  setIssuedAt() { return this; }',
  '  setExpirationTime() { return this; }',
  '  async sign(key) { throw new Error("signing refused for " + new TextDecoder().decode(key)); }',
  '}',
].join('\n'));

const loadReal = bundler({ [SUPABASE_FILE]: SUPABASE_STUB }, {
  jose: import.meta.resolve('jose'),
  'next/server': NEXT_SERVER,
  'next/headers': NEXT_HEADERS_STUB,
});

const loadStubbedSession = bundler({
  [SUPABASE_FILE]: SUPABASE_STUB,
  [JWT_FILE]: stub(['export async function verifyAdminFromRequest() { return state().stubClaims; }']),
}, {
  jose: REFUSING_JOSE,
  'next/server': NEXT_SERVER,
  'next/headers': NEXT_HEADERS_STUB,
});

let route: PassRoute;
let stubbedRoute: PassRoute;
let pass: PassModule;

before(async () => {
  route = await loadReal<PassRoute>(ROUTE_FILE);
  pass = await loadReal<PassModule>(LIB_FILE);
  stubbedRoute = await loadStubbedSession<PassRoute>(ROUTE_FILE);
});

function setAllSettings(): void {
  Reflect.set(process.env, 'SUPABASE_URL', SUPABASE_URL);
  Reflect.set(process.env, 'SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE_KEY);
  Reflect.set(process.env, 'SUPABASE_REALTIME_JWT_SECRET', PASS_SECRET);
}

function setSetting(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else Reflect.set(process.env, name, value);
}

function requestHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'user-agent': 'realtime pass test',
    'x-forwarded-for': '198.51.100.7',
    'x-request-id': REQUEST_ID,
    ...extra,
  });
}

beforeEach(() => {
  state.headers = requestHeaders();
  state.cookies = new Map();
  state.rpcs = [];
  state.queries = [];
  state.authState = (sid) => live(sid);
  state.stubClaims = null;
  logs.length = 0;
  Reflect.set(process.env, 'ADMIN_JWT_SECRET', ADMIN_SECRET);
  setAllSettings();
  for (const level of LOG_LEVELS) {
    mock.method(console, level, (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    });
  }
});

afterEach(() => {
  mock.restoreAll();
});

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function live(sid: string, grant: Grant = {}): DbReply {
  return {
    data: {
      admin: {
        id: ADMIN_ID,
        username: USERNAME,
        role_title: 'Operations Lead',
        is_super_admin: grant.superAdmin === true,
        page_permissions: grant.pagePermissions ?? ['withdrawals', 'card_queue'],
        token_version: 4,
      },
      session: {
        id: sid,
        status: 'active',
        client: sid === PHONE_SID ? 'mobile' : 'web',
        auth_methods: ['pwd'],
        created_at: iso(-HOUR_MS),
        expires_at: grant.expiresAt ?? iso(7 * HOUR_MS),
        reauth_at: null,
      },
      mfa: { status: 'none', locked_until: null },
      policy: { mfa_mode: 'off', mfa_grace_ends_at: null, mfa_required_now: false },
    },
  };
}

function allow(grant: Grant): void {
  state.authState = (sid) => live(sid, grant);
}

function adminToken(overrides: Record<string, unknown> = {}, secret = ADMIN_SECRET, lifetimeSeconds = 3600): Promise<string> {
  const claims: Record<string, unknown> = {
    admin_id: ADMIN_ID,
    role_title: 'Operations Lead',
    is_super_admin: false,
    page_permissions: [],
    username: USERNAME,
    token_version: 4,
    sid: WEB_SID,
    amr: ['pwd'],
    ...overrides,
  };
  for (const [name, value] of Object.entries(claims)) {
    if (value === undefined) Reflect.deleteProperty(claims, name);
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + lifetimeSeconds)
    .sign(new TextEncoder().encode(secret));
}

function sessionToken(sid: string): Promise<string> {
  return adminToken({ sid });
}

async function asWeb(): Promise<void> {
  state.headers = requestHeaders();
  state.cookies = new Map([['admin_token', await sessionToken(WEB_SID)]]);
}

async function asPhone(withWebCookie = false): Promise<void> {
  state.headers = requestHeaders({ 'x-client': 'mobile-admin', authorization: `Bearer ${await sessionToken(PHONE_SID)}` });
  state.cookies = withWebCookie ? new Map([['admin_token', await sessionToken(WEB_SID)]]) : new Map();
}

function signedOut(): void {
  state.headers = requestHeaders();
  state.cookies = new Map();
}

function verifiedAdmin(session: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    admin_id: ADMIN_ID,
    username: USERNAME,
    role_title: 'Operations Lead',
    is_super_admin: false,
    page_permissions: ['withdrawals', 'card_queue'],
    token_version: 4,
    sid: WEB_SID,
    amr: ['pwd'],
    session: {
      id: WEB_SID,
      client: 'web',
      amr: ['pwd'],
      createdAt: iso(-HOUR_MS),
      expiresAt: iso(7 * HOUR_MS),
      reauthAt: null,
      transport: 'cookie',
      ...session,
    },
    mfa: { status: 'none', lockedUntil: null },
    policy: { mode: 'off', graceEndsAt: null, requiredNow: false },
  };
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function failure(code: string, message: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { success: false, error: message, code, message, request_id: REQUEST_ID, ...extra };
}

function sessionChecks(): unknown[] {
  return state.rpcs.filter((call) => call.name === 'admin_auth_state').map((call) => call.args.p_sid);
}

const signingKey = (secret: string): Uint8Array => new TextEncoder().encode(secret);

describe('POST /api/realtime/pass', () => {
  test('a web admin who reads both queues gets a five-minute HS256 pass for both topics, with the browser settings', async () => {
    await asWeb();
    const from = Math.floor(Date.now() / 1000);
    const res = await route.POST();
    const to = Math.floor(Date.now() / 1000);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await bodyOf(res);
    assert.deepEqual(Object.keys(body).sort(), [
      'enabled', 'expires_at', 'issued_at', 'key', 'request_id', 'success', 'token', 'topics', 'url',
    ]);
    assert.equal(body.success, true);
    assert.equal(body.request_id, REQUEST_ID);
    assert.equal(body.enabled, true);
    assert.equal(body.url, SUPABASE_URL);
    assert.equal(body.key, PUBLISHABLE_KEY);
    assert.deepEqual(body.topics, BOTH_TOPICS);

    const token = String(body.token);
    assert.deepEqual(decodeProtectedHeader(token), { alg: 'HS256', typ: 'JWT' });
    const claims = decodeJwt(token);
    assert.deepEqual(Object.keys(claims).sort(), ['app', 'exp', 'iat', 'role', 'topics']);
    assert.equal(claims.role, 'admin_console_realtime');
    assert.equal(claims.app, 'cardelite-admin');
    assert.deepEqual(claims.topics, BOTH_TOPICS);
    assert.ok(Number.isInteger(claims.iat), String(claims.iat));
    assert.ok(Number.isInteger(claims.exp), String(claims.exp));
    const iat = Number(claims.iat);
    assert.ok(iat >= from && iat <= to, `${from} <= ${iat} <= ${to}`);
    assert.equal(claims.exp, iat + 300);
    assert.equal(body.issued_at, iat);
    assert.equal(body.expires_at, claims.exp);
    for (const absent of [ADMIN_ID, WEB_SID, USERNAME, 'withdrawals.approve']) {
      assert.ok(!JSON.stringify(claims).includes(absent), absent);
    }

    const { payload } = await jwtVerify(token, signingKey(PASS_SECRET), { algorithms: ['HS256'] });
    assert.equal(payload.role, 'admin_console_realtime');
    await assert.rejects(() => jwtVerify(token, signingKey(ADMIN_SECRET), { algorithms: ['HS256'] }));
    assert.deepEqual(sessionChecks(), [WEB_SID]);
  });

  test('the topics follow the read permissions exactly, always withdrawals first', async () => {
    const cases: Array<[Grant, string[]]> = [
      [{ pagePermissions: ['withdrawals'] }, ['admin:withdrawals']],
      [{ pagePermissions: ['card_queue'] }, ['admin:cards']],
      [{ pagePermissions: ['withdrawals.read'] }, ['admin:withdrawals']],
      [{ pagePermissions: ['cards.read', 'users'] }, ['admin:cards']],
      [{ pagePermissions: ['cards.read', 'withdrawals.read'] }, BOTH_TOPICS],
      [{ pagePermissions: ['card_queue', 'withdrawals.read', 'transactions_overview'] }, BOTH_TOPICS],
      [{ pagePermissions: [], superAdmin: true }, BOTH_TOPICS],
    ];
    for (const [grant, topics] of cases) {
      allow(grant);
      await asWeb();
      const res = await route.POST();
      assert.equal(res.status, 200, JSON.stringify(grant));
      const body = await bodyOf(res);
      assert.deepEqual(body.topics, topics, JSON.stringify(grant));
      assert.deepEqual(decodeJwt(String(body.token)).topics, topics, JSON.stringify(grant));
    }
  });

  test('an admin who reads neither queue gets the guard 403 and no pass', async () => {
    for (const pagePermissions of [['users'], ['withdrawals.approve', 'cards.review', 'cards.export'], []]) {
      allow({ pagePermissions });
      await asWeb();
      const res = await route.POST();
      assert.equal(res.status, 403, JSON.stringify(pagePermissions));
      assert.deepEqual(
        await bodyOf(res),
        failure('PERMISSION_DENIED', ERROR_MESSAGE.PERMISSION_DENIED, { details: { required: NEEDED } }),
      );
    }
  });

  test('a caller without a live session gets 401, and a missing token is refused before any database call', async () => {
    signedOut();
    const missing = await route.POST();
    assert.equal(missing.status, 401);
    assert.deepEqual(await bodyOf(missing), failure('AUTH_REQUIRED', ERROR_MESSAGE.AUTH_REQUIRED));
    assert.deepEqual(state.rpcs, []);

    const ended: Reply[] = [
      { data: { admin: null, session: null, mfa: null, policy: null } },
      { data: { ...(live(WEB_SID).data as Record<string, unknown>), session: { status: 'revoked', client: 'web' } } },
    ];
    for (const reply of ended) {
      state.authState = () => reply;
      await asWeb();
      const res = await route.POST();
      assert.equal(res.status, 401, JSON.stringify(reply));
      assert.deepEqual(await bodyOf(res), failure('AUTH_REQUIRED', ERROR_MESSAGE.AUTH_REQUIRED));
    }
  });

  test('a token without a session id, an expired token, or one signed with the realtime secret is 401 before any database call', async () => {
    const now = Math.floor(Date.now() / 1000);
    const issuedPass = await pass.signRealtimePass(
      PASS_SECRET,
      pass.REALTIME_TOPICS.map((grant) => grant.topic),
      { issuedAt: now, expiresAt: now + 300 },
    );
    const refused: Array<[string, string]> = [
      ['no sid', await adminToken({ sid: undefined })],
      ['sid that is not a uuid', await adminToken({ sid: 'web' })],
      ['no admin id', await adminToken({ admin_id: undefined })],
      ['no token version', await adminToken({ token_version: undefined })],
      ['expired', await adminToken({}, ADMIN_SECRET, -60)],
      ['admin claims under the realtime secret', await adminToken({}, PASS_SECRET)],
      ['a realtime pass', issuedPass],
    ];
    for (const [label, token] of refused) {
      for (const transport of ['cookie', 'bearer'] as const) {
        state.rpcs = [];
        state.headers = transport === 'cookie'
          ? requestHeaders()
          : requestHeaders({ 'x-client': 'mobile-admin', authorization: `Bearer ${token}` });
        state.cookies = transport === 'cookie' ? new Map([['admin_token', token]]) : new Map();
        const res = await route.POST();
        assert.equal(res.status, 401, `${label} on ${transport}`);
        assert.deepEqual(await bodyOf(res), failure('AUTH_REQUIRED', ERROR_MESSAGE.AUTH_REQUIRED), `${label} on ${transport}`);
        assert.deepEqual(state.rpcs, [], `${label} on ${transport}`);
      }
    }
  });

  test('a session signed out everywhere, or now on another client, is 401 after one session check', async () => {
    const current = live(WEB_SID).data as { admin: Record<string, unknown>; session: Record<string, unknown> };
    const ended: Reply[] = [
      { data: { ...current, admin: { ...current.admin, token_version: 5 } } },
      { data: { ...current, session: { ...current.session, client: 'mobile' } } },
      { data: { ...current, session: { ...current.session, status: 'expired' } } },
    ];
    for (const reply of ended) {
      state.rpcs = [];
      state.authState = () => reply;
      await asWeb();
      const res = await route.POST();
      assert.equal(res.status, 401, JSON.stringify(reply));
      assert.deepEqual(await bodyOf(res), failure('AUTH_REQUIRED', ERROR_MESSAGE.AUTH_REQUIRED));
      assert.deepEqual(sessionChecks(), [WEB_SID]);
    }
  });

  test('the topics come from the live session check, never from the token, so a removed permission shows on the next pass', async () => {
    state.headers = requestHeaders();
    state.cookies = new Map([[
      'admin_token',
      await adminToken({ is_super_admin: true, page_permissions: ['withdrawals', 'card_queue'] }),
    ]]);
    const steps: Array<[string[], number, string[] | null]> = [
      [['withdrawals', 'card_queue'], 200, BOTH_TOPICS],
      [['card_queue'], 200, ['admin:cards']],
      [['users'], 403, null],
    ];
    for (const [pagePermissions, status, topics] of steps) {
      allow({ pagePermissions });
      const res = await route.POST();
      assert.equal(res.status, status, JSON.stringify(pagePermissions));
      const body = await bodyOf(res);
      if (topics === null) {
        assert.equal(body.token, undefined);
        continue;
      }
      assert.deepEqual(body.topics, topics);
      assert.deepEqual(decodeJwt(String(body.token)).topics, topics);
    }
  });

  test('a mobile session gets 403 even when it reads both queues, with or without a web cookie beside it', async () => {
    for (const withWebCookie of [false, true]) {
      state.rpcs = [];
      await asPhone(withWebCookie);
      const res = await route.POST();
      assert.equal(res.status, 403);
      assert.deepEqual(await bodyOf(res), failure('PERMISSION_DENIED', ERROR_MESSAGE.PERMISSION_DENIED));
      assert.deepEqual(sessionChecks(), [PHONE_SID]);
    }
  });

  test('a session outage is the guard 500, never a 401 and never a pass', async () => {
    const outages: Reply[] = [{ error: { message: 'connection terminated' } }, 'throw', { data: null }];
    for (const outage of outages) {
      state.authState = () => outage;
      await asWeb();
      const res = await route.POST();
      assert.equal(res.status, 500, JSON.stringify(outage));
      assert.deepEqual(await bodyOf(res), failure('INTERNAL_ERROR', SESSION_UNAVAILABLE), JSON.stringify(outage));
    }
  });

  test('the pass ends with the session when the session ends first', async () => {
    const end = Math.floor(Date.now() / 1000) + 100;
    allow({ expiresAt: new Date(end * 1000 + 999).toISOString() });
    await asWeb();
    const body = await bodyOf(await route.POST());
    assert.equal(body.enabled, true);
    assert.equal(body.expires_at, end);
    const claims = decodeJwt(String(body.token));
    assert.equal(claims.exp, end);
    assert.ok(end - Number(claims.iat) <= 300 && end - Number(claims.iat) >= 30);
  });

  test('with under 30 seconds of session left, or an unreadable session end, realtime is off for this call', async () => {
    for (const expiresAt of [iso(20 * 1000), iso(-5 * 1000), 'soon']) {
      allow({ expiresAt });
      await asWeb();
      const res = await route.POST();
      assert.equal(res.status, 200, expiresAt);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await bodyOf(res), OFF, expiresAt);
    }
  });

  test('a missing setting turns realtime off, and only after the guard and the web check have passed', async () => {
    for (const name of SETTINGS) {
      for (const value of [undefined, '', '   ']) {
        setAllSettings();
        setSetting(name, value);
        state.rpcs = [];
        await asWeb();
        const res = await route.POST();
        assert.equal(res.status, 200, `${name}=${JSON.stringify(value)}`);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await bodyOf(res), OFF, `${name}=${JSON.stringify(value)}`);
        assert.deepEqual(sessionChecks(), [WEB_SID]);
      }
    }
  });

  test('with every setting missing, signed out is still 401, an outage 500, a mobile session and a non-reader 403', async () => {
    for (const name of SETTINGS) setSetting(name, undefined);

    signedOut();
    const missing = await route.POST();
    assert.equal(missing.status, 401);
    assert.deepEqual(await bodyOf(missing), failure('AUTH_REQUIRED', ERROR_MESSAGE.AUTH_REQUIRED));

    state.authState = () => ({ error: { message: 'connection terminated' } });
    await asWeb();
    const outage = await route.POST();
    assert.equal(outage.status, 500);
    assert.deepEqual(await bodyOf(outage), failure('INTERNAL_ERROR', SESSION_UNAVAILABLE));

    state.authState = (sid) => live(sid);
    await asPhone();
    const phone = await route.POST();
    assert.equal(phone.status, 403);
    assert.deepEqual(await bodyOf(phone), failure('PERMISSION_DENIED', ERROR_MESSAGE.PERMISSION_DENIED));

    allow({ pagePermissions: ['users'] });
    await asWeb();
    const reader = await route.POST();
    assert.equal(reader.status, 403);
    assert.equal((await bodyOf(reader)).code, 'PERMISSION_DENIED');
  });

  test('one session check per pass, with no audit row, no rate limit and no other database call', async () => {
    await asWeb();
    assert.equal((await route.POST()).status, 200);
    assert.deepEqual(state.rpcs.map((call) => call.name), ['admin_auth_state']);
    assert.deepEqual(state.rpcs[0].args, { p_admin_id: ADMIN_ID, p_sid: WEB_SID });
    assert.deepEqual(state.queries, []);
  });

  test('nothing is logged on the way, and no refusal or log line carries the secret, the key or a pass', async () => {
    await asWeb();
    const issued = await bodyOf(await route.POST());
    const token = String(issued.token);
    assert.match(token, JWT_SHAPE);
    assert.ok(!JSON.stringify(issued).includes(PASS_SECRET));
    assert.equal(logs.length, 0, logs.join('\n'));

    const refusals: string[] = [];
    setSetting('SUPABASE_REALTIME_JWT_SECRET', undefined);
    await asWeb();
    refusals.push(JSON.stringify(await bodyOf(await route.POST())));
    setAllSettings();
    await asPhone();
    refusals.push(JSON.stringify(await bodyOf(await route.POST())));
    signedOut();
    refusals.push(JSON.stringify(await bodyOf(await route.POST())));
    state.authState = () => ({ error: { message: 'connection terminated' } });
    await asWeb();
    refusals.push(JSON.stringify(await bodyOf(await route.POST())));

    for (const text of refusals) {
      for (const secret of [PASS_SECRET, PUBLISHABLE_KEY, SUPABASE_URL, token]) assert.ok(!text.includes(secret), text);
      assert.doesNotMatch(text, JWT_SHAPE);
    }
    assert.ok(logs.length > 0);
    for (const line of logs) {
      for (const secret of [PASS_SECRET, PUBLISHABLE_KEY, ADMIN_SECRET, token]) assert.ok(!line.includes(secret), line);
      assert.doesNotMatch(line, JWT_SHAPE);
    }
  });
});

describe('the route behind a stubbed session check', () => {
  test('a pass that cannot be signed is a 500 with one fixed log line that never carries the secret', async () => {
    state.stubClaims = verifiedAdmin();
    const res = await stubbedRoute.POST();
    assert.equal(res.status, 500);
    const body = await bodyOf(res);
    assert.deepEqual(body, failure('INTERNAL_ERROR', ERROR_MESSAGE.INTERNAL_ERROR));
    assert.deepEqual(logs, ['realtime pass signing failed']);
    assert.ok(!JSON.stringify(body).includes(PASS_SECRET));
  });

  test('the route itself refuses any session that is not the web console on its cookie, before reading the settings', async () => {
    const sessions: Array<Record<string, unknown>> = [
      { client: 'web', transport: 'bearer' },
      { client: 'mobile', transport: 'cookie' },
      { client: 'mobile', transport: 'bearer' },
    ];
    for (const session of sessions) {
      for (const name of SETTINGS) setSetting(name, undefined);
      state.stubClaims = verifiedAdmin(session);
      const res = await stubbedRoute.POST();
      assert.equal(res.status, 403, JSON.stringify(session));
      assert.deepEqual(await bodyOf(res), failure('PERMISSION_DENIED', ERROR_MESSAGE.PERMISSION_DENIED));
    }
    assert.deepEqual(logs, []);
  });
});

describe('pass helpers', () => {
  test('the topics, their permissions and the claim values are fixed', () => {
    assert.deepEqual(pass.REALTIME_TOPICS, [
      { key: 'withdrawals', topic: 'admin:withdrawals', permission: 'withdrawals.read' },
      { key: 'cards', topic: 'admin:cards', permission: 'cards.read' },
    ]);
    assert.deepEqual(pass.PASS_PERMISSIONS, NEEDED);
    assert.equal(pass.PASS_ROLE, 'admin_console_realtime');
    assert.equal(pass.PASS_APP, 'cardelite-admin');
    assert.equal(pass.PASS_LIFETIME_SECONDS, 300);
    assert.equal(pass.PASS_MIN_SECONDS, 30);
  });

  test('each queue topic is granted by that queue read permission alone', () => {
    const holding = (...held: string[]) => (permission: string) => held.includes(permission);
    assert.deepEqual(pass.passTopics(holding('withdrawals.read')), ['admin:withdrawals']);
    assert.deepEqual(pass.passTopics(holding('cards.read')), ['admin:cards']);
    assert.deepEqual(pass.passTopics(holding('cards.read', 'withdrawals.read')), BOTH_TOPICS);
    assert.deepEqual(pass.passTopics(holding('withdrawals.approve', 'cards.review', 'users.read')), []);
    assert.deepEqual(pass.realtimeTopicKeys(holding('cards.read', 'withdrawals.read')), ['withdrawals', 'cards']);
    assert.deepEqual(pass.realtimeTopicKeys(holding('cards.read')), ['cards']);
    assert.deepEqual(pass.realtimeTopicKeys(holding()), []);
  });

  test('a pass lasts five minutes, ends with the session when that comes first, and is refused under 30 seconds', () => {
    const now = Date.parse('2026-10-16T10:00:00.750Z');
    const at = Math.floor(now / 1000);
    const end = (seconds: number) => new Date((at + seconds) * 1000).toISOString();
    assert.deepEqual(pass.passTimes(now, end(8 * 3600)), { issuedAt: at, expiresAt: at + 300 });
    assert.deepEqual(pass.passTimes(now, end(300)), { issuedAt: at, expiresAt: at + 300 });
    assert.deepEqual(pass.passTimes(now, end(120)), { issuedAt: at, expiresAt: at + 120 });
    assert.deepEqual(pass.passTimes(now, new Date((at + 120) * 1000 + 999).toISOString()), { issuedAt: at, expiresAt: at + 120 });
    assert.deepEqual(pass.passTimes(now, '2026-10-16T10:02:00.123456+00:00'), { issuedAt: at, expiresAt: at + 120 });
    assert.deepEqual(pass.passTimes(now, '2026-10-16T11:02:00.5+01:00'), { issuedAt: at, expiresAt: at + 120 });
    assert.deepEqual(pass.passTimes(now, end(30)), { issuedAt: at, expiresAt: at + 30 });
    assert.equal(pass.passTimes(now, end(29)), null);
    assert.equal(pass.passTimes(now, new Date((at + 30) * 1000 - 1).toISOString()), null);
    assert.equal(pass.passTimes(now, end(-60)), null);
    for (const unreadable of ['soon', '', 'not a time']) assert.equal(pass.passTimes(now, unreadable), null, unreadable);
    assert.equal(pass.passTimes(Number.NaN, end(8 * 3600)), null);
  });

  test('only a web session on the cookie counts as the web console', () => {
    assert.equal(pass.isWebSession({ client: 'web', transport: 'cookie' }), true);
    assert.equal(pass.isWebSession({ client: 'web', transport: 'bearer' }), false);
    assert.equal(pass.isWebSession({ client: 'mobile', transport: 'bearer' }), false);
    assert.equal(pass.isWebSession({ client: 'mobile', transport: 'cookie' }), false);
  });

  test('realtime is configured only when all three settings hold a value, read without surrounding spaces', () => {
    assert.deepEqual(pass.realtimeSettings(), { url: SUPABASE_URL, key: PUBLISHABLE_KEY, secret: PASS_SECRET });
    setSetting('SUPABASE_PUBLISHABLE_KEY', `  ${PUBLISHABLE_KEY}\n`);
    setSetting('SUPABASE_REALTIME_JWT_SECRET', `${PASS_SECRET} `);
    assert.deepEqual(pass.realtimeSettings(), { url: SUPABASE_URL, key: PUBLISHABLE_KEY, secret: PASS_SECRET });
    for (const name of SETTINGS) {
      for (const value of [undefined, '', ' \n ']) {
        setAllSettings();
        setSetting(name, value);
        assert.equal(pass.realtimeSettings(), null, `${name}=${JSON.stringify(value)}`);
      }
    }
  });

  test('a signed pass carries exactly the claims the policy reads, under HS256 with no kid', async () => {
    const times = { issuedAt: 1792152000, expiresAt: 1792152300 };
    const token = await pass.signRealtimePass(PASS_SECRET, ['admin:cards'], times);
    assert.deepEqual(decodeProtectedHeader(token), { alg: 'HS256', typ: 'JWT' });
    assert.deepEqual(decodeJwt(token), {
      role: 'admin_console_realtime',
      app: 'cardelite-admin',
      topics: ['admin:cards'],
      iat: 1792152000,
      exp: 1792152300,
    });
    const during = new Date(1792152100 * 1000);
    const { payload } = await jwtVerify(token, signingKey(PASS_SECRET), { algorithms: ['HS256'], currentDate: during });
    assert.deepEqual(payload.topics, ['admin:cards']);
    await assert.rejects(() => jwtVerify(token, signingKey(OTHER_SECRET), { algorithms: ['HS256'], currentDate: during }));
    await assert.rejects(() => jwtVerify(token, signingKey(PASS_SECRET), {
      algorithms: ['HS256'],
      currentDate: new Date(1792152301 * 1000),
    }));
  });
});

const sources = new Map<string, string>();

function read(file: string): string {
  let text = sources.get(file);
  if (text === undefined) {
    text = readFileSync(file, 'utf8');
    sources.set(file, text);
  }
  return text;
}

function rel(file: string): string {
  return relative(ADMIN_DIR, file).split(sep).join('/');
}

function isClientModule(source: string): boolean {
  return /^\s*['"]use client['"]/.test(source);
}

function walk(dir: string, extensions: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, extensions));
    else if (extensions.test(entry.name)) out.push(path);
  }
  return out;
}

function valueImports(source: string): string[] {
  const out: string[] = [];
  for (const [, typeOnly, clause, from, bare, dynamic] of source.matchAll(VALUE_IMPORT_RE)) {
    if (bare || dynamic) {
      out.push(bare || dynamic);
      continue;
    }
    if (typeOnly) continue;
    const named = clause.match(/^\{([^}]*)\}$/);
    const parts = named ? named[1].split(',').map((part) => part.trim()).filter(Boolean) : [];
    if (named && parts.length > 0 && parts.every((part) => part.startsWith('type '))) continue;
    out.push(from);
  }
  return out;
}

const resolvedImports = new Map<string, string | null>();

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  const cached = resolvedImports.get(base);
  if (cached !== undefined) return cached;
  const candidates = /\.(?:tsx?|mts)$/.test(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  const found = candidates.find((candidate) => existsSync(candidate)) ?? null;
  resolvedImports.set(base, found);
  return found;
}

function reachableFromClientCode(): Set<string> {
  const roots = walk(APP_DIR, /\.(?:tsx?|mts)$/).filter((file) => file.startsWith(UI_DIR + sep) || isClientModule(read(file)));
  const seen = new Set<string>(roots);
  const queue = [...roots];
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    for (const specifier of valueImports(read(file))) {
      const target = resolveImport(file, specifier);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

describe('house rules for the realtime pass', () => {
  test('the new files carry no prose comments', () => {
    for (const file of [ROUTE_FILE, LIB_FILE, TEST_FILE]) {
      assert.doesNotMatch(read(file), /\/\*|(^|[^:])\/\/(?!\/)/m, rel(file));
    }
  });

  test('the library and the route are server modules, and the route exports only POST', () => {
    for (const file of [ROUTE_FILE, LIB_FILE]) assert.equal(isClientModule(read(file)), false, rel(file));
    const source = read(ROUTE_FILE);
    assert.deepEqual([...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((match) => match[1]), ['POST']);
    assert.doesNotMatch(source, /^export\s+(?:\{|\*|default|type|interface)/m);
  });

  test('the realtime secret is named in one code file only, the server pass library, which reads exactly three settings', () => {
    const code = walk(ADMIN_DIR, /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/).filter((file) => !file.startsWith(TEST_DIR + sep));
    assert.ok(code.some((file) => rel(file) === 'next.config.ts') && code.some((file) => rel(file) === 'proxy.ts'));
    const readers = code.filter((file) => read(file).includes('SUPABASE_REALTIME_JWT_SECRET')).map(rel);
    assert.deepEqual(readers, ['app/lib/realtimePass.ts']);
    const lib = read(LIB_FILE);
    assert.deepEqual([...lib.matchAll(/process\.env\.(\w+)/g)].map((match) => match[1]), [...SETTINGS]);
    assert.doesNotMatch(lib, /NEXT_PUBLIC|console\.|process\.env\[/);
  });

  test('client code can never reach the pass library or the service client', () => {
    const reachable = reachableFromClientCode();
    assert.ok(reachable.size > 50, String(reachable.size));
    assert.ok(reachable.has(join(UI_DIR, 'useResource.ts')));
    assert.equal(reachable.has(LIB_FILE), false);
    assert.equal(reachable.has(SUPABASE_FILE), false);
  });

  test('the route checks the session, then the web console, then the settings, then the time left, and only then signs', () => {
    const source = read(ROUTE_FILE);
    const steps = [
      'requireAdminAny(PASS_PERMISSIONS)',
      'isWebSession(admin.session)',
      'realtimeSettings()',
      'passTimes(Date.now(), admin.session.expiresAt)',
      'passTopics(admin.can)',
      'signRealtimePass(settings.secret, topics, times)',
    ];
    const at = steps.map((step) => source.indexOf(step));
    assert.ok(at.every((index) => index > 0), JSON.stringify(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    assert.doesNotMatch(source, /writeAudit|checkLimit|supabaseAdmin|from\('|\.rpc\(|process\.env/);
    assert.deepEqual([...source.matchAll(/console\.(\w+)\(([^)]*)\)/g)].map((match) => `${match[1]}(${match[2]})`), [
      "error('realtime pass signing failed')",
    ]);
  });

  test('the pass route stays web-only: the mobile path list is unchanged and does not hold it', () => {
    const block = read(SESSION_TEST_FILE).match(/const MOBILE_WEB_PATHS = \[([\s\S]*?)\] as const;/);
    assert.ok(block);
    const paths = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    assert.equal(paths.length, 33);
    assert.ok(paths.every((path) => !path.startsWith('/api/realtime')), JSON.stringify(paths));
  });

  test('the mobile app never asks for a pass', { skip: !existsSync(MOBILE_DIR) }, () => {
    const files = ['app', 'lib', 'components']
      .map((dir) => join(MOBILE_DIR, dir))
      .filter((dir) => existsSync(dir))
      .flatMap((dir) => walk(dir, /\.(?:tsx?|jsx?)$/));
    assert.ok(files.length > 0);
    for (const file of files) assert.ok(!read(file).includes('/api/realtime'), file);
  });

  test('the claims are exactly what the canonical realtime policy admits', { skip: !existsSync(SCHEMA_FILE) }, () => {
    const sql = read(SCHEMA_FILE);
    const policy = sql.match(/CREATE POLICY "admin_console_signals_select" ON realtime\.messages([\s\S]*?)\);/);
    assert.ok(policy);
    const body = policy[1];
    assert.match(body, new RegExp(`FOR SELECT TO ${pass.PASS_ROLE}\\s`));
    assert.ok(body.includes(`->> 'app') = '${pass.PASS_APP}'`));
    assert.ok(body.includes("-> 'topics') @> jsonb_build_array((SELECT realtime.topic()))"));
    const admitted = body.match(/IN \(([^)]*)\)/);
    assert.ok(admitted);
    assert.deepEqual([...admitted[1].matchAll(/'([^']+)'/g)].map((match) => match[1]), pass.REALTIME_TOPICS.map((grant) => grant.topic));
    assert.match(sql, new RegExp(`CREATE ROLE ${pass.PASS_ROLE} NOLOGIN NOINHERIT;`));
  });

  test('in the canonical SQL the pass role can only read the signal topics: no other grant, no write policy, no member', { skip: !existsSync(SCHEMA_FILE) }, () => {
    const mentions = read(SCHEMA_FILE)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes(pass.PASS_ROLE));
    assert.deepEqual(mentions, [
      `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${pass.PASS_ROLE}') THEN`,
      `CREATE ROLE ${pass.PASS_ROLE} NOLOGIN NOINHERIT;`,
      `GRANT USAGE ON SCHEMA realtime TO ${pass.PASS_ROLE};`,
      `GRANT SELECT ON realtime.messages TO ${pass.PASS_ROLE};`,
      `FOR SELECT TO ${pass.PASS_ROLE}`,
    ]);
    const policies = [...read(SCHEMA_FILE).matchAll(/CREATE POLICY "([^"]+)" ON realtime\.messages/g)].map((match) => match[1]);
    assert.deepEqual(policies, ['admin_console_signals_select']);
    for (const name of ['schema.sql', 'rls.sql', 'cron_jobs.sql', 'create_admin.sql']) {
      const file = fileURLToPath(new URL(`../../${name}`, import.meta.url));
      if (!existsSync(file)) continue;
      const text = read(file);
      assert.ok(!text.includes(pass.PASS_ROLE), name);
      assert.ok(!/ON realtime\.messages/.test(text), name);
    }
  });
});
