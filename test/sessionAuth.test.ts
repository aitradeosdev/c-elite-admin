import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose';
import ts from 'typescript';

type JwtModule = typeof import('../app/lib/jwt.ts');
type GuardModule = typeof import('../app/lib/guard.ts');
type SessionModule = typeof import('../app/lib/session.ts');
type NextServer = typeof import('next/server');

const STATE_KEY = '__cardeliteSessionAuthTest';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const LIB_DIR = join(APP_DIR, 'lib');
const TEST_FILE = fileURLToPath(import.meta.url);
const MOBILE_DIR = fileURLToPath(new URL('../../CardEliteAdmin/', import.meta.url));
const nodeRequire = createRequire(import.meta.url);

const SECRET = 'session-auth-test-secret-0123456789abcdef';
const KEY = new TextEncoder().encode(SECRET);
const ADMIN_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
const OTHER_SID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const ROLE_ID = '5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const ACCESS_ROUTE = '/api/admin-accounts/[id]/access';
const REQUEST_ID = 'req_sessionauth1';
const USER_AGENT = 'Mozilla/5.0 (CardElite session test)';
const CLIENT_IP = '198.51.100.7';
const UNAVAILABLE_TEXT = 'Your session could not be checked. Try again.';
const HOUR_MS = 60 * 60 * 1000;
const EPOCH = 'Thu, 01 Jan 1970 00:00:00 GMT';

const MOBILE_WEB_PATHS = [
  '/api/activity', '/api/admin-accounts', '/api/admin-settings', '/api/app-config', '/api/bonuses', '/api/card-queue',
  '/api/card-queue/share', '/api/cards', '/api/cards/upload', '/api/coupons', '/api/dashboard', '/api/email-templates',
  '/api/field-builder', '/api/flagged-transactions', '/api/giftbox', '/api/levels', '/api/limits-fees',
  '/api/notification-templates', '/api/notifications/broadcast', '/api/notifications/recipient-count',
  '/api/notifications/user-search', '/api/platform-balance', '/api/rates', '/api/referrals', '/api/transactions',
  '/api/user-activity-monitor', '/api/user-activity-monitor/[id]', '/api/user-activity-monitor/[id]/terminate',
  '/api/users', '/api/users/[id]', '/api/withdrawals', '/api/withdrawals/[id]/approve', '/api/withdrawals/[id]/reject',
] as const;
const WEB_INVITE_BRANCH = /if \(admin\.session\.client === 'mobile'\) return createForPhone\(req, admin\);[\s\S]*?return inviteFromWeb\(req, admin\);/;

interface DbError {
  message: string;
  code?: string;
}

interface DbResult {
  data?: unknown;
  error?: DbError | null;
}

type Reply = DbResult | 'throw' | ((args: Record<string, unknown>) => DbResult | 'throw');

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface Query {
  table: string;
  op: string | null;
  payload: unknown;
  filters: Array<[string, string, unknown]>;
}

interface StubState {
  headers: Headers;
  cookies: Map<string, string>;
  rpcs: RpcCall[];
  queries: Query[];
  replies: Map<string, Reply>;
  auditError: string | null;
  stubClaims: unknown;
  db: {
    from(table: string): object;
    rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
  };
}

interface Cookie {
  value: string;
  attributes: Map<string, string | true>;
}

const logs: string[] = [];

const state: StubState = {
  headers: new Headers(),
  cookies: new Map(),
  rpcs: [],
  queries: [],
  replies: new Map(),
  auditError: null,
  stubClaims: null,
  db: {
    from: (table) => chain(table),
    rpc: (name, args) => rpc(name, args),
  },
};

Reflect.set(globalThis, STATE_KEY, state);

function rpc(name: string, args: Record<string, unknown>): Promise<DbResult> {
  state.rpcs.push({ name, args });
  const reply = state.replies.get(name);
  if (reply === undefined) return Promise.reject(new Error(`unexpected rpc ${name}`));
  const settled = typeof reply === 'function' ? reply(args) : reply;
  if (settled === 'throw') return Promise.reject(new Error('fetch failed'));
  return Promise.resolve({ data: null, error: null, ...settled });
}

function chain(table: string): object {
  const query: Query = { table, op: null, payload: undefined, filters: [] };
  state.queries.push(query);
  const builder: Record<string, unknown> = {};
  const filter = (kind: string) => (column: string, value: unknown) => {
    query.filters.push([kind, column, value]);
    return builder;
  };
  Object.assign(builder, {
    insert: (payload: unknown) => {
      query.op = 'insert';
      query.payload = payload;
      return builder;
    },
    select: () => {
      query.op = query.op ?? 'select';
      return builder;
    },
    eq: filter('eq'),
    is: filter('is'),
    maybeSingle: () => builder,
    then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          if (query.table === 'audit_log' && query.op === 'insert') {
            return { data: null, error: state.auditError ? { message: state.auditError } : null };
          }
          throw new Error(`unexpected query ${JSON.stringify(query)}`);
        })
        .then(onFulfilled, onRejected),
  });
  return builder;
}

const IMPORT_RE = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;

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

const loadReal = bundler({ [join(LIB_DIR, 'supabase.ts')]: SUPABASE_STUB }, {
  jose: import.meta.resolve('jose'),
  'next/server': pathToFileURL(nodeRequire.resolve('next/server')).href,
  'next/headers': stub([
    'export async function headers() { return state().headers; }',
    'export async function cookies() {',
    '  return { get: (name) => (state().cookies.has(name) ? { name, value: state().cookies.get(name) } : undefined) };',
    '}',
  ]),
});

const loadStubbed = bundler({
  [join(LIB_DIR, 'supabase.ts')]: SUPABASE_STUB,
  [join(LIB_DIR, 'jwt.ts')]: stub(['export async function verifyAdminFromRequest() { return state().stubClaims; }']),
}, {
  'next/server': moduleUrl('export const NextResponse = { json: (body, init) => Response.json(body, init) };'),
  'next/headers': stub([
    `export async function headers() { return new Headers({ 'x-request-id': '${REQUEST_ID}', 'user-agent': '${USER_AGENT}', 'x-forwarded-for': '${CLIENT_IP}' }); }`,
    'export async function cookies() { return { get: () => undefined }; }',
  ]),
});

let jwt: JwtModule;
let guard: GuardModule;
let session: SessionModule;
let stubbedGuard: GuardModule;
let NextResponse: NextServer['NextResponse'];

before(async () => {
  ({ NextResponse } = (await import(pathToFileURL(nodeRequire.resolve('next/server')).href)) as NextServer);
  jwt = await loadReal<JwtModule>(join(LIB_DIR, 'jwt.ts'));
  guard = await loadReal<GuardModule>(join(LIB_DIR, 'guard.ts'));
  session = await loadReal<SessionModule>(join(LIB_DIR, 'session.ts'));
  stubbedGuard = await loadStubbed<GuardModule>(join(LIB_DIR, 'guard.ts'));
});

function prepare(extra: Record<string, string> = {}, cookies: Record<string, string> = {}): void {
  state.headers = new Headers({
    'user-agent': USER_AGENT,
    'x-forwarded-for': `203.0.113.9, ${CLIENT_IP}`,
    'x-request-id': REQUEST_ID,
    ...extra,
  });
  state.cookies = new Map(Object.entries(cookies));
}

function reset(): void {
  prepare();
  state.rpcs = [];
  state.queries = [];
  state.replies = new Map();
  state.auditError = null;
  state.stubClaims = null;
  logs.length = 0;
}

beforeEach(() => {
  reset();
  Reflect.set(process.env, 'ADMIN_JWT_SECRET', SECRET);
  mock.method(console, 'error', (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(' '));
  });
});

afterEach(() => {
  mock.restoreAll();
});

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function stateFor(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    admin: {
      id: ADMIN_ID,
      username: 'ops.lead',
      role_title: 'Operations Lead',
      is_super_admin: false,
      page_permissions: ['withdrawals', 'card_queue'],
      token_version: 4,
    },
    session: {
      id: SID,
      status: 'active',
      client: 'web',
      auth_methods: ['otp', 'pwd'],
      created_at: iso(-HOUR_MS),
      expires_at: iso(7 * HOUR_MS),
      reauth_at: iso(-HOUR_MS),
    },
    mfa: { status: 'active', locked_until: null },
    policy: { mfa_mode: 'all', mfa_grace_ends_at: '2026-10-27T10:00:00+00:00', mfa_required_now: false },
    ...patch,
  };
}

function answer(data: unknown): void {
  state.replies.set('admin_auth_state', { data });
}

interface TokenOptions {
  alg?: string;
  key?: Uint8Array;
  exp?: number | null;
}

function claims(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    admin_id: ADMIN_ID,
    role_title: 'Old Title',
    is_super_admin: true,
    page_permissions: [],
    username: 'old.name',
    token_version: 4,
    sid: SID,
    amr: ['pwd', 'otp'],
    ...patch,
  };
}

function withoutSid(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const out = claims(patch);
  delete out.sid;
  delete out.amr;
  return out;
}

async function token(payload: Record<string, unknown> = claims(), options: TokenOptions = {}): Promise<string> {
  const builder = new SignJWT(payload).setProtectedHeader({ alg: options.alg ?? 'HS256' }).setIssuedAt();
  if (options.exp !== null) builder.setExpirationTime(options.exp ?? Math.floor(Date.now() / 1000) + 3600);
  return builder.sign(options.key ?? KEY);
}

function authStateCalls(): RpcCall[] {
  return state.rpcs.filter((call) => call.name === 'admin_auth_state');
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

async function withNodeEnv<T>(value: string, run: () => Promise<T> | T): Promise<T> {
  const previous = process.env.NODE_ENV;
  Reflect.set(process.env, 'NODE_ENV', value);
  try {
    return await run();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Reflect.set(process.env, 'NODE_ENV', previous);
  }
}

describe('signing session tokens', () => {
  test('signAdminJWT signs HS256 with an issued-at time and a numeric expiry taken from the session', async () => {
    const expiresAt = new Date('2031-01-02T03:04:05.678Z');
    const signed = await jwt.signAdminJWT({
      admin_id: ADMIN_ID, role_title: 'Ops', is_super_admin: false, page_permissions: [], username: 'ops', token_version: 3,
      sid: SID, amr: ['pwd'],
    }, expiresAt);
    assert.equal(decodeProtectedHeader(signed).alg, 'HS256');
    const payload = decodeJwt(signed);
    assert.equal(payload.exp, Math.floor(expiresAt.getTime() / 1000));
    assert.equal(typeof payload.iat, 'number');
    assert.equal(payload.token_version, 3);
    assert.equal(payload.sid, SID);
  });

  test('signSessionToken carries the session id, the sorted methods and the session expiry, never sliding it', async () => {
    const epoch = Math.floor(Date.now() / 1000) + 1234;
    const signed = await jwt.signSessionToken({
      id: ADMIN_ID,
      username: 'ops.lead',
      role_title: 'Operations Lead',
      is_super_admin: true,
      page_permissions: ['withdrawals'],
      token_version: 9,
    }, SID, ['pwd', 'otp', 'pwd', 'bogus' as 'pwd'], epoch);
    const payload = decodeJwt(signed);
    assert.deepEqual(
      { ...payload, iat: undefined },
      {
        admin_id: ADMIN_ID,
        role_title: 'Operations Lead',
        is_super_admin: true,
        page_permissions: ['withdrawals'],
        username: 'ops.lead',
        token_version: 9,
        sid: SID,
        amr: ['otp', 'pwd'],
        exp: epoch,
        iat: undefined,
      },
    );
  });

  test('signSessionToken refuses a session id that is not a uuid and an expiry that is not a time', () => {
    const admin = { id: ADMIN_ID, username: 'u', role_title: 'r', is_super_admin: false, page_permissions: [], token_version: 1 };
    assert.throws(() => jwt.signSessionToken(admin, 'not-a-session', ['pwd'], 2000000000), TypeError);
    assert.throws(() => jwt.signSessionToken(admin, SID, ['pwd'], Number.NaN), TypeError);
  });

  test('a token signed by the console verifies as a session once the database agrees', async () => {
    const epoch = Math.floor(Date.now() / 1000) + 600;
    const signed = await jwt.signSessionToken({
      id: ADMIN_ID, username: 'ops.lead', role_title: 'Operations Lead', is_super_admin: false, page_permissions: [], token_version: 4,
    }, SID, ['pwd'], epoch);
    answer(stateFor({ mfa: { status: 'none', locked_until: null } }));
    const check = await jwt.verifyAdminSession(signed, 'cookie');
    assert.equal(check.status, 'ok');
  });
});

describe('verifyAdminSession', () => {
  test('an active web session presented as the cookie is ok, with identity read fresh from one database call', async () => {
    const state0 = stateFor();
    answer(state0);
    const check = await jwt.verifyAdminSession(await token(), 'cookie');
    assert.equal(check.status, 'ok');
    if (check.status !== 'ok') return;
    assert.deepEqual(state.rpcs, [{ name: 'admin_auth_state', args: { p_admin_id: ADMIN_ID, p_sid: SID } }]);
    assert.deepEqual(check.claims, {
      admin_id: ADMIN_ID,
      role_title: 'Operations Lead',
      is_super_admin: false,
      page_permissions: ['withdrawals', 'card_queue'],
      username: 'ops.lead',
      token_version: 4,
      sid: SID,
      amr: ['otp', 'pwd'],
      role: null,
    });
    const raw = state0.session as Record<string, string>;
    assert.deepEqual(check.session, {
      id: SID,
      client: 'web',
      amr: ['otp', 'pwd'],
      createdAt: raw.created_at,
      expiresAt: raw.expires_at,
      reauthAt: raw.reauth_at,
      transport: 'cookie',
    });
    assert.deepEqual(check.mfa, { status: 'active', lockedUntil: null });
    assert.deepEqual(check.policy, { mode: 'all', graceEndsAt: '2026-10-27T10:00:00+00:00', requiredNow: false });
  });

  test('an active mobile session presented as a bearer is ok, with identity and methods read fresh from the database', async () => {
    answer(stateFor({ session: { ...(stateFor().session as object), client: 'mobile', auth_methods: ['pwd'] } }));
    const check = await jwt.verifyAdminSession(await token(), 'bearer');
    assert.equal(check.status, 'ok');
    if (check.status === 'ok') {
      assert.equal(check.session.client, 'mobile');
      assert.equal(check.session.transport, 'bearer');
      assert.deepEqual(check.session.amr, ['pwd']);
      assert.equal(check.claims.username, 'ops.lead');
      assert.equal(check.claims.role_title, 'Operations Lead');
      assert.equal(check.claims.sid, SID);
      assert.deepEqual(check.claims.amr, ['pwd']);
    }
    assert.deepEqual(state.rpcs, [{ name: 'admin_auth_state', args: { p_admin_id: ADMIN_ID, p_sid: SID } }]);
  });

  test('the role is read from the database when it is well formed, and anything else is no role, never an error', async () => {
    const cases: Array<[unknown, unknown]> = [
      [{ id: ROLE_ID, name: 'Manager' }, { id: ROLE_ID, name: 'Manager' }],
      [{ id: ROLE_ID, name: null }, { id: ROLE_ID, name: null }],
      [{ id: ROLE_ID }, { id: ROLE_ID, name: null }],
      [{ id: ROLE_ID, name: 7 }, { id: ROLE_ID, name: null }],
      [null, null],
      ['Manager', null],
      [[ROLE_ID], null],
      [{ id: 'not-a-role', name: 'Manager' }, null],
      [{ id: 42, name: 'Manager' }, null],
      [{ name: 'Manager' }, null],
    ];
    for (const [role, expected] of cases) {
      reset();
      answer(stateFor({ admin: { ...(stateFor().admin as object), role } }));
      const check = await jwt.verifyAdminSession(await token(), 'cookie');
      assert.equal(check.status, 'ok', JSON.stringify(role));
      if (check.status === 'ok') assert.deepEqual(check.claims.role, expected, JSON.stringify(role));
    }
  });

  test('a session that is revoked, expired, superseded by a version bump or unknown is invalid', async () => {
    for (const status of ['revoked', 'expired', 'stale', 'not_found', 'superseded', null]) {
      reset();
      answer(stateFor({ session: { ...(stateFor().session as object), status } }));
      assert.deepEqual(await jwt.verifyAdminSession(await token(), 'cookie'), { status: 'invalid' }, String(status));
      assert.equal(authStateCalls().length, 1);
    }
    reset();
    answer(stateFor({ session: null }));
    assert.deepEqual(await jwt.verifyAdminSession(await token(), 'cookie'), { status: 'invalid' });
  });

  test('a session presented on the wrong transport is invalid: the cookie needs web, the bearer needs mobile', async () => {
    const cases: Array<[string, 'cookie' | 'bearer']> = [['mobile', 'cookie'], ['web', 'bearer'], ['tablet', 'cookie']];
    for (const [client, transport] of cases) {
      reset();
      answer(stateFor({ session: { ...(stateFor().session as object), client } }));
      assert.deepEqual(await jwt.verifyAdminSession(await token(), transport), { status: 'invalid' }, `${client} ${transport}`);
    }
  });

  test('a token without a session id is invalid on the cookie and the bearer for every admin, before any database call', async () => {
    const sidless = [await token(withoutSid()), await token({ ...withoutSid(), amr: ['pwd'] })];
    for (const status of ['none', 'pending', 'active']) {
      for (const transport of ['cookie', 'bearer'] as const) {
        for (const signed of sidless) {
          reset();
          answer(stateFor({ session: null, mfa: { status, locked_until: null } }));
          assert.deepEqual(await jwt.verifyAdminSession(signed, transport), { status: 'invalid' }, `${status} ${transport}`);
          assert.deepEqual(state.rpcs, [], `${status} ${transport}`);
        }
      }
    }
  });

  test('a token without a session id is invalid even while the database is down, so it never turns into an outage', async () => {
    const signed = await token(withoutSid());
    for (const outage of [{ error: { message: 'connection terminated' } }, 'throw'] as Reply[]) {
      reset();
      state.replies.set('admin_auth_state', outage);
      assert.deepEqual(await jwt.verifyAdminSession(signed, 'cookie'), { status: 'invalid' }, JSON.stringify(outage));
      assert.deepEqual(state.rpcs, []);
    }
  });

  test('a missing or deactivated admin and a token from an older version are invalid', async () => {
    answer({ admin: null, session: null, mfa: null, policy: null });
    assert.deepEqual(await jwt.verifyAdminSession(await token(), 'cookie'), { status: 'invalid' });
    for (const version of [3, 5]) {
      reset();
      answer(stateFor({ admin: { ...(stateFor().admin as object), token_version: version } }));
      assert.deepEqual(await jwt.verifyAdminSession(await token(), 'cookie'), { status: 'invalid' }, String(version));
    }
  });

  test('a database outage is unavailable, never invalid, and is logged without the token', async () => {
    const outages: Reply[] = [
      { error: { message: 'Could not find the function public.admin_auth_state', code: 'PGRST202' } },
      'throw',
      { data: null },
      { data: 'ok' },
      { data: [stateFor()] },
    ];
    for (const outage of outages) {
      reset();
      const signed = await token();
      state.replies.set('admin_auth_state', outage);
      assert.deepEqual(await jwt.verifyAdminSession(signed, 'cookie'), { status: 'unavailable' }, JSON.stringify(outage));
      assert.ok(logs.some((line) => line.includes('admin session check failed')), JSON.stringify(outage));
      assert.ok(!logs.join('\n').includes(signed));
    }
    reset();
    answer(stateFor({ session: { status: 'active', client: 'web' } }));
    assert.deepEqual(await jwt.verifyAdminSession(await token(), 'cookie'), { status: 'unavailable' });
  });

  test('a token that fails its own checks is invalid before any database call', async () => {
    const now = Math.floor(Date.now() / 1000);
    const bad: string[] = [
      await token(claims(), { key: new TextEncoder().encode('a-different-secret-entirely-0123456789') }),
      await token(claims(), { exp: now - 5 }),
      await token(claims(), { exp: null }),
      await token(claims(), { alg: 'HS512', key: new Uint8Array(64).fill(7) }),
      await token(claims({ admin_id: 'not-a-uuid' })),
      await token(claims({ admin_id: 42 })),
      await token(claims({ sid: null })),
      await token(claims({ sid: 'not-a-session' })),
      await token(claims({ token_version: '4' })),
      await token(claims({ token_version: 4.5 })),
      await token(claims({ token_version: undefined })),
      await token(claims({ sid: undefined })),
      'not.a.token',
      '',
    ];
    for (const signed of bad) {
      reset();
      answer(stateFor());
      assert.deepEqual(await jwt.verifyAdminSession(signed, 'cookie'), { status: 'invalid' }, signed);
      assert.deepEqual(state.rpcs, [], signed);
    }
  });

  test('a missing ADMIN_JWT_SECRET is an outage on the server, not a bad session, and calls nothing', async () => {
    const signed = await token();
    Reflect.deleteProperty(process.env, 'ADMIN_JWT_SECRET');
    answer(stateFor());
    assert.deepEqual(await jwt.verifyAdminSession(signed, 'cookie'), { status: 'unavailable' });
    assert.deepEqual(state.rpcs, []);
    assert.ok(logs.some((line) => line.includes('ADMIN_JWT_SECRET is not set')));
  });

  test('the verifier that answered null for an outage is gone, and nothing in the console asks for it', () => {
    assert.deepEqual(Object.keys(jwt).sort(), [
      'sessionTokenFromRequest', 'signAdminJWT', 'signSessionToken', 'verifyAdminFromRequest', 'verifyAdminSession',
    ]);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) files.push(path);
      }
    };
    walk(APP_DIR);
    assert.ok(files.length > 100, String(files.length));
    for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /verifyAdminJWT/, file);
  });
});

describe('verifyAdminFromRequest', () => {
  test('a mobile bearer is checked as a bearer, and the cookie is never used, even when the bearer fails', async () => {
    const bearer = await token();
    const cookie = await token(claims({ sid: OTHER_SID }));
    prepare({ authorization: `Bearer ${bearer}`, 'x-client': 'mobile-admin' }, { admin_token: cookie });
    answer(stateFor({ session: { ...(stateFor().session as object), client: 'mobile' } }));
    const verified = await jwt.verifyAdminFromRequest();
    assert.equal(verified?.session?.transport, 'bearer');
    assert.deepEqual(authStateCalls().map((call) => call.args.p_sid), [SID]);

    reset();
    prepare({ authorization: 'Bearer not.a.token', 'x-client': 'mobile-admin' }, { admin_token: cookie });
    answer(stateFor());
    assert.equal(await jwt.verifyAdminFromRequest(), null);
    assert.deepEqual(state.rpcs, []);

    reset();
    prepare({ authorization: 'Bearer', 'x-client': 'mobile-admin' }, { admin_token: cookie });
    answer(stateFor());
    assert.equal(await jwt.verifyAdminFromRequest(), null);
    assert.deepEqual(state.rpcs, []);

    reset();
    prepare({ authorization: `Bearer ${bearer}`, 'x-client': 'mobile-admin' });
    answer(stateFor());
    assert.equal(await jwt.verifyAdminFromRequest(), null);
  });

  test('without the mobile header the cookie is checked as the web session, whatever Authorization says', async () => {
    const cookie = await token();
    prepare({ authorization: `Bearer ${await token(claims({ sid: OTHER_SID }))}` }, { admin_token: cookie });
    answer(stateFor());
    const verified = await jwt.verifyAdminFromRequest();
    assert.equal(verified?.session?.transport, 'cookie');
    assert.deepEqual(authStateCalls().map((call) => call.args.p_sid), [SID]);

    reset();
    prepare({ 'x-client': 'mobile-admin', authorization: 'Basic abc' }, { admin_token: cookie });
    answer(stateFor());
    assert.equal((await jwt.verifyAdminFromRequest())?.session?.transport, 'cookie');
  });

  test('no token at all is null without a database call', async () => {
    assert.equal(await jwt.verifyAdminFromRequest(), null);
    assert.deepEqual(state.rpcs, []);
  });

  test('a token without a session id is null as the cookie and as the mobile bearer, without a database call', async () => {
    const sidless = await token(withoutSid());
    const requests: Array<[Record<string, string>, Record<string, string>]> = [
      [{}, { admin_token: sidless }],
      [{ authorization: `Bearer ${sidless}`, 'x-client': 'mobile-admin' }, {}],
      [{ authorization: `Bearer ${sidless}`, 'x-client': 'mobile-admin' }, { admin_token: await token() }],
    ];
    for (const [headers, cookies] of requests) {
      reset();
      prepare(headers, cookies);
      answer(stateFor({ session: null, mfa: { status: 'none', locked_until: null } }));
      assert.equal(await jwt.verifyAdminFromRequest(), null, JSON.stringify(headers));
      assert.deepEqual(state.rpcs, [], JSON.stringify(headers));
    }
  });

  test('returns the claims with the session, two-step state and policy for the guard', async () => {
    prepare({}, { admin_token: await token() });
    answer(stateFor({ mfa: { status: 'active', locked_until: '2026-10-13T10:15:00+00:00' } }));
    const verified = await jwt.verifyAdminFromRequest();
    assert.equal(verified?.username, 'ops.lead');
    assert.equal(verified?.session?.id, SID);
    assert.deepEqual(verified?.mfa, { status: 'active', lockedUntil: '2026-10-13T10:15:00+00:00' });
    assert.equal(verified?.policy?.mode, 'all');
  });

  test('an outage throws SessionUnavailableError instead of answering null', async () => {
    prepare({}, { admin_token: await token() });
    state.replies.set('admin_auth_state', { error: { message: 'connection terminated' } });
    await assert.rejects(() => jwt.verifyAdminFromRequest(), (error: unknown) => {
      assert.ok(error instanceof session.SessionUnavailableError);
      assert.ok(session.isSessionUnavailable(error));
      return true;
    });
  });

  test('sessionTokenFromRequest is the one rule the guard reads by, so a route can forward exactly what was checked', async () => {
    const cookie = { admin_token: 'web.session.token' };
    const cases: Array<[Record<string, string>, Record<string, string>, { token: string; transport: string }]> = [
      [{ authorization: 'Bearer phone.session.token', 'x-client': 'mobile-admin' }, cookie, { token: 'phone.session.token', transport: 'bearer' }],
      [{ authorization: 'bearer \t phone.session.token', 'x-client': 'mobile-admin' }, {}, { token: 'phone.session.token', transport: 'bearer' }],
      [{ authorization: 'Bearer', 'x-client': 'mobile-admin' }, cookie, { token: '', transport: 'bearer' }],
      [{ authorization: 'Bearerphone.session.token', 'x-client': 'mobile-admin' }, cookie, { token: 'web.session.token', transport: 'cookie' }],
      [{ authorization: 'Basic abc', 'x-client': 'mobile-admin' }, cookie, { token: 'web.session.token', transport: 'cookie' }],
      [{ authorization: 'Bearer phone.session.token' }, cookie, { token: 'web.session.token', transport: 'cookie' }],
      [{ 'x-client': 'mobile-admin' }, {}, { token: '', transport: 'cookie' }],
    ];
    for (const [headers, cookies, expected] of cases) {
      prepare(headers, cookies);
      assert.deepEqual(await jwt.sessionTokenFromRequest(), expected, JSON.stringify(headers));
    }
    assert.deepEqual(state.rpcs, []);
    const source = readFileSync(join(LIB_DIR, 'jwt.ts'), 'utf8');
    assert.match(
      source,
      /export async function verifyAdminFromRequest\(\): Promise<VerifiedAdmin \| null> \{\n {2}const \{ token, transport \} = await sessionTokenFromRequest\(\);\n/,
    );
    assert.equal(source.match(/BEARER\.test\(/g)?.length, 1);
  });
});

describe('the guard', () => {
  test('an outage answers 500 with the session-check message, never a 401 that would sign the app out', async () => {
    prepare({ authorization: `Bearer ${await token()}`, 'x-client': 'mobile-admin' });
    state.replies.set('admin_auth_state', { error: { message: 'Could not find the function', code: 'PGRST202' } });
    const result = await guard.requireAdmin();
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.response.status, 500);
    const body = await bodyOf(result.response);
    assert.equal(body.code, 'INTERNAL_ERROR');
    assert.equal(body.error, UNAVAILABLE_TEXT);
    for (const check of [() => guard.requireSuperAdmin(), () => guard.requireAdminAny(['withdrawals.read']), () => guard.requireAdminAll(['withdrawals.read'])]) {
      const other = await check();
      assert.equal(other.ok ? 200 : other.response.status, 500);
    }
  });

  test('an invalid session answers 401 AUTH_REQUIRED', async () => {
    prepare({}, { admin_token: await token() });
    answer({ admin: null, session: null, mfa: null, policy: null });
    const result = await guard.requireAdmin();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 401);
      assert.equal((await bodyOf(result.response)).code, 'AUTH_REQUIRED');
    }
  });

  test('a token without a session id answers 401 AUTH_REQUIRED on both transports, never the 500 of an outage', async () => {
    const sidless = await token(withoutSid());
    for (const [headers, cookies] of [
      [{}, { admin_token: sidless }],
      [{ authorization: `Bearer ${sidless}`, 'x-client': 'mobile-admin' }, {}],
    ] as Array<[Record<string, string>, Record<string, string>]>) {
      reset();
      prepare(headers, cookies);
      state.replies.set('admin_auth_state', { error: { message: 'connection terminated' } });
      const result = await guard.requireAdmin();
      assert.equal(result.ok ? 200 : result.response.status, 401, JSON.stringify(headers));
      if (!result.ok) assert.equal((await bodyOf(result.response)).code, 'AUTH_REQUIRED');
      assert.deepEqual(state.rpcs, []);
    }
  });

  test('the context carries the session, two-step state, policy and stored grants, and checks permissions as before', async () => {
    prepare({}, { admin_token: await token() });
    answer(stateFor());
    const result = await guard.requireAdmin('withdrawals.read');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const { admin } = result;
    assert.equal(admin.admin_id, ADMIN_ID);
    assert.equal(admin.username, 'ops.lead');
    assert.equal(admin.role_title, 'Operations Lead');
    assert.deepEqual(admin.page_permissions, ['withdrawals', 'card_queue']);
    assert.equal(admin.session?.id, SID);
    assert.equal(admin.session?.transport, 'cookie');
    assert.deepEqual(admin.mfa, { status: 'active', lockedUntil: null });
    assert.equal(admin.policy.mode, 'all');
    assert.equal(admin.ip, CLIENT_IP);
    assert.equal(admin.user_agent, USER_AGENT);
    assert.equal(admin.request_id, REQUEST_ID);
    assert.equal(admin.role, null);
    assert.ok(admin.can('withdrawals.read'));

    reset();
    prepare({}, { admin_token: await token() });
    answer(stateFor());
    const denied = await guard.requireSuperAdmin();
    assert.equal(denied.ok ? 200 : denied.response.status, 403);
  });

  test('the context carries the role the database reports', async () => {
    prepare({}, { admin_token: await token() });
    answer(stateFor({ admin: { ...(stateFor().admin as object), role: { id: ROLE_ID, name: 'Manager' } } }));
    const result = await guard.requireAdmin('withdrawals.read');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.admin.role, { id: ROLE_ID, name: 'Manager' });
    assert.deepEqual(result.admin.page_permissions, ['withdrawals', 'card_queue']);
  });

  test('bare claims from the suites that stub jwt.ts still build a working context with safe defaults', async () => {
    state.stubClaims = {
      admin_id: ADMIN_ID,
      username: 'ops.lead',
      role_title: 'Operations Lead',
      is_super_admin: false,
      page_permissions: ['withdrawals'],
      token_version: 4,
    };
    const result = await stubbedGuard.requireAdmin('withdrawals.read');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.admin.mfa, { status: 'none', lockedUntil: null });
    assert.deepEqual(result.admin.policy, { mode: 'off', graceEndsAt: null, requiredNow: false });
    assert.deepEqual(result.admin.page_permissions, ['withdrawals']);
    assert.equal(result.admin.role, null);
    assert.equal(result.admin.request_id, REQUEST_ID);
    state.stubClaims = null;
    const refused = await stubbedGuard.requireAdmin();
    assert.equal(refused.ok ? 200 : refused.response.status, 401);
  });

  test('the guard takes only verifyAdminFromRequest from jwt.ts, and session.ts never imports jwt.ts or the crypto modules', () => {
    const imports = (file: string) =>
      [...readFileSync(join(LIB_DIR, file), 'utf8').matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)';$/gm)]
        .map((match) => ({ typeOnly: Boolean(match[1]), names: match[2], from: match[3] }));
    const fromJwt = imports('guard.ts').filter((entry) => entry.from === './jwt');
    assert.equal(fromJwt.length, 1);
    const runtime = fromJwt[0].names.split(',').map((name) => name.trim()).filter((name) => name && !name.startsWith('type '));
    assert.deepEqual(runtime, ['verifyAdminFromRequest']);
    const sessionImports = imports('session.ts').map((entry) => entry.from).sort();
    assert.deepEqual(sessionImports, ['./api', './audit', './http', './supabase', 'next/headers', 'next/server']);
    const source = readFileSync(join(LIB_DIR, 'session.ts'), 'utf8');
    assert.doesNotMatch(source, /from '\.\/(?:jwt|mfa|qr|guard)'|from 'jose'|node:crypto|qrcode-generator/);
  });
});

describe('requireRecentAuth', () => {
  const NOW = Date.parse('2026-10-13T10:00:00.000Z');

  function info(createdAt: string, reauthAt: string | null): Parameters<SessionModule['requireRecentAuth']>[0]['session'] {
    return {
      id: SID, client: 'web', amr: ['pwd'], createdAt, expiresAt: '2026-10-13T18:00:00.000Z', reauthAt, transport: 'cookie',
    };
  }

  test('passes within five minutes of signing in or of the last identity check', async () => {
    const mfa = { status: 'none' as const, lockedUntil: null };
    assert.equal(await session.requireRecentAuth({ session: info('2026-10-13T09:55:00.000Z', null), mfa }, 300, NOW), null);
    assert.equal(await session.requireRecentAuth({ session: info('2026-10-13T02:00:00.000Z', '2026-10-13T09:57:30.000Z'), mfa }, 300, NOW), null);
    assert.equal(await session.requireRecentAuth({ session: info('2026-10-13T09:59:59.000Z', '2026-10-13T02:00:00.000Z'), mfa }, 300, NOW), null);
    assert.equal(session.REAUTH_MAX_AGE_SECONDS, 300);
  });

  test('asks for a fresh check after five minutes with 403 REAUTH_REQUIRED, naming the method the admin has', async () => {
    const stale = info('2026-10-13T02:00:00.000Z', '2026-10-13T09:54:59.000Z');
    for (const [status, method] of [['none', 'password'], ['pending', 'password'], ['active', 'otp']] as const) {
      const res = await session.requireRecentAuth({ session: stale, mfa: { status, lockedUntil: null } }, 300, NOW);
      assert.ok(res, status);
      if (!res) continue;
      assert.equal(res.status, 403);
      const body = await bodyOf(res);
      assert.equal(body.code, 'REAUTH_REQUIRED');
      assert.equal(body.error, 'Confirm it is you to continue.');
      assert.deepEqual(body.details, { method, max_age_secs: 300 });
    }
  });

  test('an unreadable time counts as stale', async () => {
    const unreadable = await session.requireRecentAuth({ session: info('soon', null), mfa: { status: 'none', lockedUntil: null } }, 300, NOW);
    assert.equal(unreadable?.status, 403);
    const both = await session.requireRecentAuth({ session: info('soon', 'later'), mfa: { status: 'none', lockedUntil: null } }, 300, NOW);
    assert.equal(both?.status, 403);
  });

  test('requireTwoStep answers 403 MFA_REQUIRED unless two-step sign-in is on, and the guard re-exports both checks', async () => {
    for (const status of ['none', 'pending'] as const) {
      const res = await session.requireTwoStep({ mfa: { status, lockedUntil: null } });
      assert.equal(res?.status, 403);
      assert.equal(res ? (await bodyOf(res)).code : null, 'MFA_REQUIRED');
    }
    assert.equal(await session.requireTwoStep({ mfa: { status: 'active', lockedUntil: null } }), null);
    assert.equal(guard.requireRecentAuth, session.requireRecentAuth);
    assert.equal(guard.requireTwoStep, session.requireTwoStep);
  });
});

describe('cookies', () => {
  test('the session cookie is httpOnly, strict, site-wide, and lives exactly until the session ends', () => {
    const res = NextResponse.json({});
    session.setSessionCookie(res, 'signed.session.token', new Date(Date.now() + 2 * HOUR_MS + 500));
    const cookie = cookiesOf(res).get('admin_token');
    assert.equal(cookie?.value, 'signed.session.token');
    assert.equal(cookie?.attributes.get('httponly'), true);
    assert.equal(cookie?.attributes.get('samesite'), 'strict');
    assert.equal(cookie?.attributes.get('path'), '/');
    const maxAge = Number(cookie?.attributes.get('max-age'));
    assert.ok(maxAge >= 2 * 3600 - 1 && maxAge <= 2 * 3600, String(maxAge));
    assert.equal(cookie?.attributes.has('secure'), false);
    const past = NextResponse.json({});
    session.setSessionCookie(past, 'x', '2001-01-01T00:00:00.000Z');
    assert.equal(cookiesOf(past).get('admin_token')?.attributes.get('max-age'), '0');
  });

  test('the sign-in step cookie is scoped to /api/auth for five minutes, and is cleared on the same path', () => {
    const res = NextResponse.json({});
    session.setChallengeCookie(res, 'challenge-token');
    const cookie = cookiesOf(res).get('admin_mfa_challenge');
    assert.equal(cookie?.value, 'challenge-token');
    assert.equal(cookie?.attributes.get('path'), '/api/auth');
    assert.equal(cookie?.attributes.get('max-age'), '300');
    assert.equal(cookie?.attributes.get('httponly'), true);
    assert.equal(cookie?.attributes.get('samesite'), 'strict');
    const cleared = NextResponse.json({});
    session.clearChallengeCookie(cleared);
    const gone = cookiesOf(cleared).get('admin_mfa_challenge');
    assert.equal(gone?.value, '');
    assert.equal(gone?.attributes.get('path'), '/api/auth');
    assert.equal(gone?.attributes.get('expires'), EPOCH);
  });

  test('every auth cookie is Secure in production', async () => {
    await withNodeEnv('production', () => {
      const res = NextResponse.json({});
      session.setSessionCookie(res, 't', new Date(Date.now() + HOUR_MS));
      session.setThemeCookie(res, 'dark');
      session.setChallengeCookie(res, 'c');
      for (const [name, cookie] of cookiesOf(res)) assert.equal(cookie.attributes.get('secure'), true, name);
      const cleared = NextResponse.json({});
      session.clearSessionCookies(cleared);
      session.clearChallengeCookie(cleared);
      for (const [name, cookie] of cookiesOf(cleared)) assert.equal(cookie.attributes.get('secure'), true, name);
    });
  });

  test('signing out clears both the session and the theme cookie with their original flags', () => {
    const res = NextResponse.json({});
    session.clearSessionCookies(res);
    const cookies = cookiesOf(res);
    assert.deepEqual([...cookies.keys()].sort(), ['admin_theme', 'admin_token']);
    assert.equal(cookies.get('admin_token')?.attributes.get('httponly'), true);
    assert.equal(cookies.get('admin_token')?.attributes.get('expires'), EPOCH);
    assert.equal(cookies.get('admin_theme')?.attributes.has('httponly'), false);
    assert.equal(cookies.get('admin_theme')?.attributes.get('samesite'), 'lax');
  });

  test('the theme cookie keeps its year-long, script-readable form, and unknown themes become system', () => {
    const res = NextResponse.json({});
    session.setThemeCookie(res, session.themePreference('blue'));
    const cookie = cookiesOf(res).get('admin_theme');
    assert.equal(cookie?.value, 'system');
    assert.equal(cookie?.attributes.get('max-age'), '31536000');
    assert.equal(session.themePreference('dark'), 'dark');
    assert.equal(session.themePreference('light'), 'light');
    assert.equal(session.themePreference(null), 'system');
  });
});

describe('shared session helpers', () => {
  test('auth methods are deduplicated, sorted like the database, and unknown ones dropped', () => {
    assert.deepEqual(session.normalizeAuthMethods(['pwd', 'otp', 'pwd']), ['otp', 'pwd']);
    assert.deepEqual(session.normalizeAuthMethods(['recovery', 'pwd', 'sms', 7]), ['pwd', 'recovery']);
    assert.deepEqual(session.normalizeAuthMethods('pwd'), []);
  });

  test('expiry times become whole epoch seconds, and context grants become token claims', () => {
    assert.equal(session.epochSeconds('2026-10-13T18:00:00.999Z'), Date.parse('2026-10-13T18:00:00.000Z') / 1000);
    assert.equal(session.epochSeconds(new Date(1500)), 1);
    assert.deepEqual(session.sessionTokenAdmin({
      admin_id: ADMIN_ID, username: 'ops', role_title: 'Ops', is_super_admin: true, page_permissions: ['users'],
    }, 12), { id: ADMIN_ID, username: 'ops', role_title: 'Ops', is_super_admin: true, page_permissions: ['users'], token_version: 12 });
  });

  test('rate limits fail closed: an error is unavailable, a concurrent first write is limited, anything but true is limited', async () => {
    const cases: Array<[Reply, string]> = [
      [{ data: true }, 'allowed'],
      [{ data: false }, 'limited'],
      [{ data: null }, 'limited'],
      [{ error: { message: 'duplicate key value violates unique constraint', code: '23505' } }, 'limited'],
      [{ error: { message: 'rate limit store unavailable' } }, 'unavailable'],
      ['throw', 'unavailable'],
    ];
    for (const [reply, verdict] of cases) {
      reset();
      state.replies.set('check_rate_limit_by_key', reply);
      assert.equal(await session.checkLimit('admin:x', 'admin_reauth', 5, 900), verdict, JSON.stringify(reply));
      assert.deepEqual(state.rpcs[0]?.args, { p_key: 'admin:x', p_action: 'admin_reauth', p_limit: 5, p_window_secs: 900 });
    }
  });

  test('a wrong code is recorded once, audited, and a new lock is audited with how long it lasts', async () => {
    const actor = { admin_id: ADMIN_ID, role_title: 'Ops', ip: CLIENT_IP, user_agent: USER_AGENT, request_id: REQUEST_ID };
    state.replies.set('admin_mfa_record_failure', { data: {
      recorded: true, failed_count: 10, failed_count_24h: 12, locked: true, locked_until: '2026-10-13T10:15:00+00:00',
      just_locked: true, lock_minutes: 15,
    } });
    const outcome = await session.recordTwoStepFailure(actor, 'MFA_CHALLENGE_FAILED', 'Two-step code did not match.');
    assert.deepEqual(outcome, { locked: true, lockedUntil: '2026-10-13T10:15:00+00:00' });
    assert.deepEqual(state.rpcs, [{ name: 'admin_mfa_record_failure', args: { p_admin_id: ADMIN_ID } }]);
    const rows = state.queries.filter((query) => query.table === 'audit_log').map((query) => query.payload as Record<string, unknown>);
    assert.deepEqual(rows.map((row) => [row.action, row.result, row.error, row.reason]), [
      ['MFA_CHALLENGE_FAILED', 'failure', 'Two-step code did not match.', null],
      ['MFA_LOCKED', 'success', null, '10 failed two-step codes in 15 minutes.'],
    ]);
    assert.deepEqual(rows[1].after_value, { client: 'web', locked_until: '2026-10-13T10:15:00+00:00', lock_minutes: 15 });
    assert.ok(rows.every((row) => row.sensitivity === 'security' && row.admin_id === ADMIN_ID && row.entity_id === ADMIN_ID));

    reset();
    state.replies.set('admin_mfa_record_failure', { data: {
      recorded: true, failed_count: 3, failed_count_24h: 30, locked: true, locked_until: '2026-10-14T10:00:00+00:00',
      just_locked: true, lock_minutes: 1440,
    } });
    await session.recordTwoStepFailure(actor, 'REAUTH_FAILED', 'Two-step code was already used.');
    const daily = state.queries.map((query) => query.payload as Record<string, unknown>);
    assert.deepEqual(daily.map((row) => row.action), ['REAUTH_FAILED', 'MFA_LOCKED']);
    assert.equal(daily[1].reason, '30 failed two-step codes in 24 hours.');
  });

  test('a failure store that cannot be reached is logged, still audited, and reported as not locked', async () => {
    const actor = { admin_id: ADMIN_ID, role_title: 'Ops', ip: CLIENT_IP, user_agent: USER_AGENT, request_id: REQUEST_ID };
    for (const reply of [{ error: { message: 'connection terminated' } }, 'throw'] as Reply[]) {
      reset();
      state.replies.set('admin_mfa_record_failure', reply);
      assert.deepEqual(await session.recordTwoStepFailure(actor, 'MFA_CHALLENGE_FAILED', 'x'), { locked: false, lockedUntil: null });
      assert.deepEqual(state.queries.map((query) => (query.payload as Record<string, unknown>).action), ['MFA_CHALLENGE_FAILED']);
      assert.ok(logs.some((line) => line.includes('admin two-step failure record failed')));
    }
  });

  test('a matched step is settled once; a replay is counted, a lock or a changed factor is not', async () => {
    const actor = { admin_id: ADMIN_ID, role_title: 'Ops', ip: CLIENT_IP, user_agent: USER_AGENT, request_id: REQUEST_ID };
    const unlocked = { data: { recorded: true, failed_count: 1, locked: false, locked_until: null, just_locked: false } };
    const cases: Array<[Reply, string, string[]]> = [
      [{ data: { ok: true } }, 'ok', []],
      [{ data: { ok: false, reason: 'replay' } }, 'replay', ['admin_mfa_record_failure']],
      [{ data: { ok: false, reason: 'locked', locked_until: '2026-10-13T10:15:00+00:00' } }, 'locked', []],
      [{ data: { ok: false, reason: 'not_active' } }, 'not_active', []],
      [{ error: { message: 'Invalid time step' } }, 'unavailable', []],
    ];
    for (const [reply, kind, extra] of cases) {
      reset();
      state.replies.set('admin_mfa_use_step', reply);
      state.replies.set('admin_mfa_record_failure', unlocked);
      const outcome = await session.settleTotpCode(actor, 59061240, 'MFA_CHALLENGE_FAILED');
      assert.equal(outcome.kind, kind);
      assert.deepEqual(state.rpcs.map((call) => call.name), ['admin_mfa_use_step', ...extra], kind);
      assert.deepEqual(state.rpcs[0].args, { p_admin_id: ADMIN_ID, p_step: 59061240 });
    }
    reset();
    state.replies.set('admin_mfa_record_failure', unlocked);
    const wrong = await session.settleTotpCode(actor, null, 'REAUTH_FAILED');
    assert.deepEqual(wrong, { kind: 'wrong', locked: false, lockedUntil: null });
    assert.deepEqual(state.rpcs.map((call) => call.name), ['admin_mfa_record_failure']);
  });

  test('the two-step record is read without ever exposing a broken factor as usable', async () => {
    state.replies.set('admin_mfa_get', { data: { status: 'none' } });
    assert.deepEqual(await session.loadMfa(ADMIN_ID), {
      status: 'none', secretEnc: null, keyVersion: 0, createdAt: null, confirmedAt: null, lastUsedAt: null, lockedUntil: null,
      recoveryCodesLeft: 0,
    });
    reset();
    state.replies.set('admin_mfa_get', { data: {
      status: 'active', secret_enc: 'c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0', key_version: 1, created_at: 'a', confirmed_at: 'b',
      last_used_at: 'c', locked_until: null, recovery_codes_left: 7,
    } });
    const active = await session.loadMfa(ADMIN_ID);
    assert.equal(active?.status, 'active');
    assert.equal(active?.recoveryCodesLeft, 7);
    for (const broken of [{ status: 'active', key_version: 1 }, { status: 'pending', secret_enc: 'abc', key_version: 0 }]) {
      reset();
      state.replies.set('admin_mfa_get', { data: broken });
      assert.equal(await session.loadMfa(ADMIN_ID), null, JSON.stringify(broken));
    }
    reset();
    state.replies.set('admin_mfa_get', { error: { message: 'connection terminated' } });
    assert.equal(await session.loadMfa(ADMIN_ID), null);
  });
});

describe('routes the mobile app calls', () => {
  const routeFile = (path: string) => join(APP_DIR, path.slice(1), 'route.ts');

  test('none of the 33 web routes the mobile app calls can ask for a fresh identity check or two-step setup', () => {
    assert.equal(MOBILE_WEB_PATHS.length, 33);
    for (const path of MOBILE_WEB_PATHS) {
      const file = routeFile(path);
      assert.ok(existsSync(file), path);
      const source = readFileSync(file, 'utf8').replace(WEB_INVITE_BRANCH, '');
      assert.doesNotMatch(source, /requireRecentAuth\(|requireTwoStep\(|REAUTH_REQUIRED|MFA_REQUIRED/, path);
    }
  });

  test('the web-only access route is not a route the mobile app calls, while the phone keeps /api/admin-accounts', () => {
    assert.ok(!(MOBILE_WEB_PATHS as readonly string[]).includes(ACCESS_ROUTE));
    assert.ok((MOBILE_WEB_PATHS as readonly string[]).includes('/api/admin-accounts'));
  });

  test('the list holds every web path the mobile app calls', { skip: !existsSync(join(MOBILE_DIR, 'lib', 'api.ts')) }, () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) files.push(path);
      }
    };
    for (const dir of ['app', 'lib', 'components']) if (existsSync(join(MOBILE_DIR, dir))) walk(join(MOBILE_DIR, dir));
    const called = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:callWeb|pickAndUploadImage)(?:<[^>]*>)?\(\s*[`'"](\/api\/[^`'"?]+)/g)) {
        called.add(match[1].replace(/\$\{[^}]+\}/g, '[id]'));
      }
    }
    assert.ok(called.size >= 30, String(called.size));
    for (const path of called) assert.ok((MOBILE_WEB_PATHS as readonly string[]).includes(path), path);
  });
});

describe('house rules for the session core', () => {
  test('no prose comments in the core modules or this test', () => {
    for (const file of [...['jwt.ts', 'guard.ts', 'session.ts', 'http.ts', 'redact.ts'].map((name) => join(LIB_DIR, name)), TEST_FILE]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m, file);
    }
  });

  test('the core never logs a token, a code or a password', () => {
    for (const name of ['jwt.ts', 'guard.ts', 'session.ts']) {
      const source = readFileSync(join(LIB_DIR, name), 'utf8');
      for (const [, args] of source.matchAll(/console\.error\(([^;]*)\);/g)) {
        assert.doesNotMatch(args, /\btoken\b|\bcode\b|password|secret_enc|\bsecret\b/, `${name}: ${args}`);
      }
    }
  });

  test('redaction covers every new secret-bearing key, but never the word code, which coupons use', async () => {
    const { redactAudit } = await import('../app/lib/redact.ts');
    const keys = [
      'recovery_code', 'recovery_codes', 'secret_enc', 'secret_display', 'otpauth_uri', 'qr_data_uri', 'qr_svg', 'code_hash',
      'token_hash', 'challenge', 'otp', 'password', 'token',
    ];
    const input = Object.fromEntries([...keys, 'code', 'session_id'].map((key) => [key, `value-${key}`]));
    const out = redactAudit({ nested: [input] }) as { nested: Array<Record<string, string>> };
    for (const key of keys) assert.equal(out.nested[0][key], '[redacted]', key);
    assert.equal(out.nested[0].code, 'value-code');
    assert.equal(out.nested[0].session_id, 'value-session_id');
  });
});
