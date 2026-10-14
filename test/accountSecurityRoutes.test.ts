import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeJwt } from 'jose';
import ts from 'typescript';
import { base32Encode, hashRecoveryCode, openSecret } from '../app/lib/mfa.ts';
import { twoStepLockedMessage } from '../app/lib/http.ts';

type JwtModule = typeof import('../app/lib/jwt.ts');

const STATE_KEY = '__cardeliteAccountSecurityTest';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const TEST_FILE = fileURLToPath(import.meta.url);
const nodeRequire = createRequire(import.meta.url);

const ROUTES = {
  mfa: 'api/account/mfa/route.ts',
  start: 'api/account/mfa/enroll/start/route.ts',
  confirm: 'api/account/mfa/enroll/confirm/route.ts',
  codes: 'api/account/mfa/recovery-codes/route.ts',
  sessions: 'api/account/sessions/route.ts',
  session: 'api/account/sessions/[id]/route.ts',
  others: 'api/account/sessions/sign-out-others/route.ts',
  everywhere: 'api/account/sessions/sign-out-everywhere/route.ts',
} as const;

const ADMIN_ID = '3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b';
const SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
const OTHER_SID = '9e8d7c6b-5a49-4382-a716-05f4e3d2c1b0';
const PHONE_SID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const USERNAME = 'ops.lead';
const ROLE = 'Operations Lead';
const GRANTS = ['withdrawals', 'card_queue'];
const MFA_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const SEALED = 'oKGio6Slpqeoqaqr1ypPGXD9NYdbVbbhNE716EeUYCCow3tgg0VFxid5ZNE596De';
const SECRET = Buffer.from('12345678901234567890', 'ascii');
const ISSUED_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.account-security.signature';
const JWT_SECRET = 'account-security-test-secret-0123456789abcdef';
const REQUEST_ID = 'req_acctsecure01';
const USER_AGENT = 'Mozilla/5.0 (CardElite account security test)';
const CLIENT_IP = '198.51.100.7';
const EPOCH = 'Thu, 01 Jan 1970 00:00:00 GMT';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const RECOVERY_SHAPE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

const TWO_STEP_UNAVAILABLE = 'Two-step sign-in is unavailable right now. Try again later.';
const ALREADY_ON = 'Two-step sign-in is already on.';
const SETUP_EXPIRED = 'This setup timed out or was replaced. Start again.';
const ENTER_SIX_DIGITS = 'Enter the 6-digit code from your authenticator app.';
const SETUP_CODE_WRONG = "That code did not work. Use the newest CardElite Admin entry in your app and check your phone's clock.";
const CODES_CODE_WRONG = 'That code did not work. Codes work once, so if you just used it, wait for the next one.';
const CODES_TOO_MANY = 'Too many attempts to get new recovery codes. Wait 15 minutes, then try again.';
const CODES_CHECK_UNAVAILABLE = 'Your code cannot be checked right now. Try again in a few minutes.';
const THIS_DEVICE = 'This is the device you are using. Use Log out instead.';

const AUDIT_KEYS = [
  'admin_id', 'action', 'entity', 'entity_id', 'before_value', 'after_value', 'ip_address', 'admin_role', 'user_agent',
  'request_id', 'reason', 'result', 'error', 'sensitivity',
] as const;

interface DbError {
  message: string;
  code?: string;
}

interface DbResult {
  data?: unknown;
  error?: DbError | null;
}

type Reply = DbResult | 'throw' | ((args: Record<string, unknown>) => DbResult | 'throw');

type Filter = [kind: string, column: string, value: unknown];

interface Query {
  table: string;
  op: string | null;
  columns: string | null;
  payload: unknown;
  filters: Filter[];
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface StubState {
  replies: Map<string, Reply>;
  rpcs: RpcCall[];
  queries: Query[];
  signed: unknown[][];
  headers: Headers;
  cookies: Map<string, string>;
  requestAdmin: Record<string, unknown> | null;
  auditError: string | null;
  resetRead: DbResult | 'throw';
  signError: string | null;
  db: {
    from(table: string): object;
    rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
  };
}

interface Cookie {
  value: string;
  attributes: Map<string, string | true>;
}

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface RouteModule {
  GET?: Handler;
  POST?: Handler;
  DELETE?: Handler;
}

interface WorldSession {
  id: string;
  client: 'web' | 'mobile';
  amr: string[];
  createdAt: string;
  expiresAt: string;
  reauthAt: string | null;
  version: number;
  revoked: boolean;
}

interface World {
  version: number;
  mfa: 'none' | 'pending' | 'active';
  sessions: WorldSession[];
}

const logs: string[] = [];
let sessionExpiresAt = '';

const state: StubState = {
  replies: new Map(),
  rpcs: [],
  queries: [],
  signed: [],
  headers: new Headers(),
  cookies: new Map(),
  requestAdmin: null,
  auditError: null,
  resetRead: { data: [] },
  signError: null,
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

function respond(query: Query): DbResult | 'throw' {
  if (query.table === 'audit_log' && query.op === 'insert') {
    return { error: state.auditError ? { message: state.auditError } : null };
  }
  if (query.table === 'audit_log' && query.op === 'select') return state.resetRead;
  throw new Error(`unexpected query ${JSON.stringify(query)}`);
}

function chain(table: string): object {
  const query: Query = { table, op: null, columns: null, payload: undefined, filters: [] };
  state.queries.push(query);
  const builder: Record<string, unknown> = {};
  const filter = (kind: string) => (column: string, value: unknown) => {
    query.filters.push([kind, column, value]);
    return builder;
  };
  Object.assign(builder, {
    select: (columns: string) => {
      query.op = query.op ?? 'select';
      query.columns = columns;
      return builder;
    },
    insert: (payload: unknown) => {
      query.op = 'insert';
      query.payload = payload;
      return builder;
    },
    eq: filter('eq'),
    is: filter('is'),
    in: filter('in'),
    order: filter('order'),
    limit: (count: number) => {
      query.filters.push(['limit', '', count]);
      return builder;
    },
    maybeSingle: () => builder,
    then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          const answer = respond(query);
          if (answer === 'throw') throw new Error('fetch failed');
          return { data: null, error: null, ...answer };
        })
        .then(onFulfilled, onRejected),
  });
  return builder;
}

function moduleUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function stub(lines: string[]): string {
  return moduleUrl([`const state = () => globalThis.${STATE_KEY};`, ...lines].join('\n'));
}

const IMPORT_RE = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;

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
  return async <T>(path: string): Promise<T> => (await import(await bundle(resolve(APP_DIR, path)))) as T;
}

const SUPABASE_STUB = stub([
  'export const supabaseAdmin = {',
  '  from(table) { return state().db.from(table); },',
  '  rpc(name, args) { return state().db.rpc(name, args); },',
  '};',
]);

const PACKAGES: Readonly<Record<string, string>> = {
  'next/server': pathToFileURL(nodeRequire.resolve('next/server')).href,
  'next/headers': stub([
    'export async function headers() { return state().headers; }',
    'export async function cookies() {',
    '  return { get: (name) => (state().cookies.has(name) ? { name, value: state().cookies.get(name) } : undefined) };',
    '}',
  ]),
};

const CRYPTO_MODULES: Readonly<Record<string, string>> = {
  [resolve(APP_DIR, 'lib', 'mfa.ts')]: pathToFileURL(resolve(APP_DIR, 'lib', 'mfa.ts')).href,
  [resolve(APP_DIR, 'lib', 'qr.ts')]: pathToFileURL(resolve(APP_DIR, 'lib', 'qr.ts')).href,
};

const loadStubbed = bundler({
  ...CRYPTO_MODULES,
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: SUPABASE_STUB,
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: stub([
    'export async function signSessionToken(admin, sid, amr, epoch) {',
    '  state().signed.push([admin, sid, amr, epoch]);',
    '  if (state().signError) throw new Error(state().signError);',
    `  return '${ISSUED_TOKEN}';`,
    '}',
    'export async function verifyAdminFromRequest() { return state().requestAdmin; }',
  ]),
}, PACKAGES);

const loadReal = bundler({
  ...CRYPTO_MODULES,
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: SUPABASE_STUB,
}, { ...PACKAGES, jose: import.meta.resolve('jose') });

const routes = {} as Record<keyof typeof ROUTES, RouteModule>;
const realRoutes = {} as Record<'confirm' | 'others' | 'sessions', RouteModule>;
let realJwt: JwtModule;

before(async () => {
  for (const [key, path] of Object.entries(ROUTES)) routes[key as keyof typeof ROUTES] = await loadStubbed<RouteModule>(path);
  for (const key of ['confirm', 'others', 'sessions'] as const) realRoutes[key] = await loadReal<RouteModule>(ROUTES[key]);
  realJwt = await loadReal<JwtModule>('lib/jwt.ts');
});

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function webSession(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SID,
    client: 'web',
    amr: ['pwd'],
    createdAt: iso(-HOUR_MS),
    expiresAt: sessionExpiresAt,
    reauthAt: iso(-MINUTE_MS),
    transport: 'cookie',
    ...patch,
  };
}

function signedIn(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    admin_id: ADMIN_ID,
    username: USERNAME,
    role_title: ROLE,
    is_super_admin: false,
    page_permissions: GRANTS,
    token_version: 4,
    session: webSession(),
    mfa: { status: 'none', lockedUntil: null },
    policy: { mode: 'off', graceEndsAt: null, requiredNow: false },
    ...patch,
  };
}

function factor(patch: Record<string, unknown> = {}): DbResult {
  return {
    data: {
      status: 'active',
      secret_enc: SEALED,
      key_version: 1,
      created_at: '2026-10-01T09:00:00+00:00',
      confirmed_at: '2026-10-01T09:01:00+00:00',
      last_used_step: 58800000,
      last_used_at: '2026-10-12T08:00:00+00:00',
      locked_until: null,
      recovery_codes_left: 7,
      ...patch,
    },
  };
}

function pendingFactor(createdAt = iso(-MINUTE_MS)): DbResult {
  return factor({
    status: 'pending', created_at: createdAt, confirmed_at: null, last_used_step: null, last_used_at: null, recovery_codes_left: 0,
  });
}

function failure(patch: Record<string, unknown> = {}): DbResult {
  return {
    data: {
      recorded: true, failed_count: 1, failed_count_24h: 1, locked: false, locked_until: null, just_locked: false,
      lock_minutes: null, ...patch,
    },
  };
}

function listedRow(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    client: 'web',
    auth_methods: ['pwd'],
    created_at: '2026-10-13T08:00:00+00:00',
    last_seen_at: '2026-10-13T09:00:00+00:00',
    expires_at: '2026-10-13T16:00:00+00:00',
    ip: '102.89.34.1',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0',
    ...patch,
  };
}

function baseReplies(): Map<string, Reply> {
  return new Map<string, Reply>([
    ['admin_mfa_get', factor()],
    ['admin_mfa_begin', { data: { ok: true } }],
    ['admin_mfa_activate', { data: { ok: true, token_version: 5, session_kept: true, sessions_revoked: 2, recovery_codes_left: 10 } }],
    ['admin_mfa_use_step', { data: { ok: true } }],
    ['admin_mfa_record_failure', failure()],
    ['admin_recovery_codes_replace', (args) => ({
      data: { ok: true, recovery_codes_left: Array.isArray(args.p_code_hashes) ? args.p_code_hashes.length : 0 },
    })],
    ['admin_sessions_list', { data: [listedRow(OTHER_SID), listedRow(SID), listedRow(PHONE_SID, { client: 'mobile' })] }],
    ['admin_session_revoke', { data: { revoked: true, client: 'mobile', push_tokens_released: 1 } }],
    ['admin_sessions_revoke_all', {
      data: { sessions_revoked: 2, session_kept: true, token_version: 5, token_version_bumped: true, push_tokens_released: 1 },
    }],
    ['check_rate_limit_by_key', { data: true }],
  ]);
}

function reset(replies: Record<string, Reply> = {}, admin: Record<string, unknown> | null = null): void {
  sessionExpiresAt = new Date(Date.now() + 5 * HOUR_MS).toISOString();
  state.replies = baseReplies();
  for (const [name, reply] of Object.entries(replies)) state.replies.set(name, reply);
  state.rpcs = [];
  state.queries = [];
  state.signed = [];
  state.auditError = null;
  state.resetRead = { data: [] };
  state.signError = null;
  state.cookies = new Map();
  state.headers = new Headers({
    'content-type': 'application/json',
    'user-agent': USER_AGENT,
    'x-forwarded-for': `203.0.113.50, ${CLIENT_IP}`,
    'x-request-id': REQUEST_ID,
  });
  state.requestAdmin = admin ?? signedIn();
  logs.length = 0;
}

beforeEach(() => {
  reset();
  Reflect.set(process.env, 'ADMIN_MFA_ENCRYPTION_KEY', MFA_KEY);
  Reflect.set(process.env, 'ADMIN_JWT_SECRET', JWT_SECRET);
  mock.method(console, 'error', (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(' '));
  });
});

afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
});

function call(route: RouteModule, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, params?: Record<string, string>) {
  const handler = route[method];
  assert.ok(handler, `${path} has no ${method} handler`);
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: state.headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return handler(req, { params: Promise.resolve(params ?? {}) });
}

const getMfa = () => call(routes.mfa, 'GET', '/api/account/mfa');
const startSetup = () => call(routes.start, 'POST', '/api/account/mfa/enroll/start', {});
const confirmSetup = (body: unknown) => call(routes.confirm, 'POST', '/api/account/mfa/enroll/confirm', body);
const newCodes = (body: unknown) => call(routes.codes, 'POST', '/api/account/mfa/recovery-codes', body);
const listSessions = () => call(routes.sessions, 'GET', '/api/account/sessions');
const signOutOne = (id: string) => call(routes.session, 'DELETE', `/api/account/sessions/${id}`, undefined, { id });
const signOutOthers = () => call(routes.others, 'POST', '/api/account/sessions/sign-out-others');
const signOutEverywhere = () => call(routes.everywhere, 'POST', '/api/account/sessions/sign-out-everywhere');

function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

function currentCode(secret: Buffer = SECRET): { code: string; step: number } {
  const step = Math.floor(Date.now() / 30000);
  return { code: hotp(secret, step), step };
}

function wrongCode(secret: Buffer = SECRET): string {
  const step = Math.floor(Date.now() / 30000);
  const taken = new Set([-2, -1, 0, 1, 2, 3].map((delta) => hotp(secret, step + delta)));
  const pick = ['000000', '111111', '222222', '333333', '444444', '555555'].find((code) => !taken.has(code));
  assert.ok(pick);
  return pick;
}

function watchTotp(): () => number {
  const spy = mock.method(crypto, 'createHmac');
  syncBuiltinESMExports();
  return () => spy.mock.calls.filter((entry) => entry.arguments[0] === 'sha1').length;
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function withoutRequestId(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  delete copy.request_id;
  return copy;
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

function callsTo(name: string): Array<Record<string, unknown>> {
  return state.rpcs.filter((entry) => entry.name === name).map((entry) => entry.args);
}

function audits(): Array<Record<string, unknown>> {
  return state.queries.filter((query) => query.table === 'audit_log' && query.op === 'insert')
    .map((query) => query.payload as Record<string, unknown>);
}

function pick(row: Record<string, unknown> | undefined, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = row?.[key];
  return out;
}

function auditRow(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    admin_id: ADMIN_ID,
    action: null,
    entity: 'admin_users',
    entity_id: ADMIN_ID,
    before_value: null,
    after_value: { client: 'web' },
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

function assertKeptSession(res: Response): void {
  const cookies = cookiesOf(res);
  assert.deepEqual([...cookies.keys()], ['admin_token']);
  const session = cookies.get('admin_token');
  assert.equal(session?.value, ISSUED_TOKEN);
  assert.equal(session?.attributes.get('httponly'), true);
  assert.equal(session?.attributes.get('samesite'), 'strict');
  assert.equal(session?.attributes.get('path'), '/');
  const maxAge = Number(session?.attributes.get('max-age'));
  assert.ok(maxAge >= 5 * 3600 - 2 && maxAge <= 5 * 3600, String(maxAge));
}

describe('GET /api/account/mfa', () => {
  test('without a session it is the expired-session 401 and nothing is read', async () => {
    reset({}, null);
    state.requestAdmin = null;
    const res = await getMfa();
    assert.equal(res.status, 401);
    assert.deepEqual(state.rpcs, []);
    assert.deepEqual(state.queries, []);
  });

  test('an admin without two-step sign-in sees status none, the policy, and no reset', async () => {
    reset({ admin_mfa_get: { data: { status: 'none' } } }, signedIn({
      policy: { mode: 'all', graceEndsAt: '2026-10-27T10:00:00+00:00', requiredNow: false },
    }));
    const res = await getMfa();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await bodyOf(res), {
      success: true,
      request_id: REQUEST_ID,
      status: 'none',
      created_at: null,
      confirmed_at: null,
      last_used_at: null,
      locked_until: null,
      recovery_codes_left: 0,
      reset_at: null,
      policy: { mfa_mode: 'all', mfa_grace_ends_at: '2026-10-27T10:00:00+00:00', mfa_required_now: false },
    });
    assert.deepEqual(callsTo('admin_mfa_get'), [{ p_admin_id: ADMIN_ID }]);
  });

  test('an enrolled admin sees the dates, the lock and the codes left, but never the sealed secret', async () => {
    reset({ admin_mfa_get: factor({ locked_until: '2026-10-13T14:05:00+00:00' }) });
    const res = await getMfa();
    const body = await bodyOf(res);
    assert.equal(body.status, 'active');
    assert.equal(body.created_at, '2026-10-01T09:00:00+00:00');
    assert.equal(body.confirmed_at, '2026-10-01T09:01:00+00:00');
    assert.equal(body.last_used_at, '2026-10-12T08:00:00+00:00');
    assert.equal(body.locked_until, '2026-10-13T14:05:00+00:00');
    assert.equal(body.recovery_codes_left, 7);
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, new RegExp(SEALED.slice(0, 16)));
    assert.doesNotMatch(text, /secret|key_version|last_used_step/);
  });

  test('a setup that was started but not finished is reported as pending', async () => {
    reset({ admin_mfa_get: pendingFactor('2026-10-13T09:00:00+00:00') });
    const body = await bodyOf(await getMfa());
    assert.equal(body.status, 'pending');
    assert.equal(body.created_at, '2026-10-13T09:00:00+00:00');
    assert.equal(body.recovery_codes_left, 0);
  });

  test('reset_at is the newest successful reset of this admin, by a super admin or from the database', async () => {
    reset();
    state.resetRead = { data: [{ created_at: '2026-10-12T10:05:00+00:00' }] };
    const body = await bodyOf(await getMfa());
    assert.equal(body.reset_at, '2026-10-12T10:05:00+00:00');
    const read = state.queries.find((query) => query.table === 'audit_log' && query.op === 'select');
    assert.equal(read?.columns, 'created_at');
    assert.deepEqual(read?.filters, [
      ['eq', 'entity', 'admin_users'],
      ['eq', 'entity_id', ADMIN_ID],
      ['in', 'action', ['MFA_RESET', 'MFA_BREAK_GLASS_RESET']],
      ['eq', 'result', 'success'],
      ['order', 'created_at', { ascending: false }],
      ['limit', '', 1],
    ]);
  });

  test('a failed reset lookup only hides the notice; a failed two-step read is a 500', async () => {
    for (const read of [{ error: { message: 'statement timeout' } }, 'throw'] as Array<DbResult | 'throw'>) {
      reset();
      state.resetRead = read;
      const res = await getMfa();
      assert.equal(res.status, 200);
      assert.equal((await bodyOf(res)).reset_at, null);
      assert.ok(logs.some((line) => line.startsWith('admin two-step reset lookup failed:')));
    }
    for (const reply of [{ error: { message: 'connection terminated' } }, 'throw'] as Reply[]) {
      reset({ admin_mfa_get: reply });
      const res = await getMfa();
      assert.equal(res.status, 500);
      assert.equal((await bodyOf(res)).error, 'Your two-step sign-in could not be loaded. Try again.');
    }
  });
});

describe('POST /api/account/mfa/enroll/start', () => {
  test('asks for the password again unless the admin signed in or checked their identity in the last five minutes', async () => {
    reset({}, signedIn({ session: webSession({ createdAt: iso(-HOUR_MS), reauthAt: iso(-6 * MINUTE_MS) }) }));
    const res = await startSetup();
    assert.equal(res.status, 403);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), {
      success: false,
      error: 'Confirm it is you to continue.',
      code: 'REAUTH_REQUIRED',
      message: 'Confirm it is you to continue.',
      details: { method: 'password', max_age_secs: 300 },
    });
    assert.deepEqual(state.rpcs, []);
  });

  test('a cookie from before sessions had ids can never start a setup', async () => {
    reset({}, signedIn({ session: null }));
    const res = await startSetup();
    assert.equal(res.status, 403);
    assert.equal((await bodyOf(res)).code, 'REAUTH_REQUIRED');
    assert.deepEqual(state.rpcs, []);
  });

  test('a fresh check starts a new secret, sealed to this admin, and returns the QR code and key without caching', async () => {
    const res = await startSetup();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await bodyOf(res);
    const [begin] = callsTo('admin_mfa_begin');
    assert.equal(begin?.p_admin_id, ADMIN_ID);
    assert.equal(begin?.p_key_version, 1);
    const secret = openSecret(String(begin?.p_secret_enc), ADMIN_ID, 1);
    assert.equal(secret.length, 20);
    const key = base32Encode(secret);
    assert.equal(body.secret_display, key.match(/.{1,4}/g)?.join(' '));
    assert.equal(
      body.otpauth_uri,
      `otpauth://totp/CardElite%20Admin:ops.lead?secret=${key}&issuer=CardElite%20Admin&algorithm=SHA1&digits=6&period=30`,
    );
    assert.match(String(body.qr_data_uri), /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/);
    assert.equal(body.account_label, 'CardElite Admin (ops.lead)');
    assert.deepEqual(callsTo('admin_mfa_get'), []);
    assert.deepEqual(audits(), []);
  });

  test('every start makes a new secret, even while an earlier setup is still pending', async () => {
    reset({}, signedIn({ mfa: { status: 'pending', lockedUntil: null } }));
    await startSetup();
    await startSetup();
    const sealed = callsTo('admin_mfa_begin').map((args) => args.p_secret_enc);
    assert.equal(sealed.length, 2);
    assert.notEqual(sealed[0], sealed[1]);
  });

  test('an admin whose two-step sign-in is already on gets a 409 and no new secret', async () => {
    reset({}, signedIn({ mfa: { status: 'active', lockedUntil: null } }));
    const res = await startSetup();
    assert.equal(res.status, 409);
    assert.deepEqual((await bodyOf(res)).details, { reason: 'already_active' });
    assert.deepEqual(callsTo('admin_mfa_begin'), []);
    reset({ admin_mfa_begin: { data: { ok: false, reason: 'already_active' } } });
    const raced = await startSetup();
    assert.equal(raced.status, 409);
    assert.equal((await bodyOf(raced)).error, ALREADY_ON);
  });

  test('without the encryption key it fails closed before anything is saved', async () => {
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    const res = await startSetup();
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, TWO_STEP_UNAVAILABLE);
    assert.deepEqual(callsTo('admin_mfa_begin'), []);
    assert.ok(logs.some((line) => line.includes('admin two-step sign-in unavailable')));
    assert.ok(!logs.some((line) => line.includes(MFA_KEY)));
  });

  test('a deactivated account is the expired-session 401, and a store that fails is a 500', async () => {
    reset({ admin_mfa_begin: { data: { ok: false, reason: 'admin_inactive' } } });
    assert.equal((await startSetup()).status, 401);
    for (const reply of [{ error: { message: 'connection terminated' } }, 'throw', { data: { ok: false, reason: 'surprise' } }] as Reply[]) {
      reset({ admin_mfa_begin: reply });
      const res = await startSetup();
      assert.equal(res.status, 500, JSON.stringify(reply));
      assert.equal((await bodyOf(res)).error, 'Two-step sign-in setup could not be started. Try again.');
    }
  });
});

describe('POST /api/account/mfa/enroll/confirm', () => {
  function pendingAdmin(): void {
    reset({ admin_mfa_get: pendingFactor() }, signedIn({ mfa: { status: 'pending', lockedUntil: null } }));
  }

  test('the right code turns two-step sign-in on, keeps this session and returns ten recovery codes without caching', async () => {
    pendingAdmin();
    const { code, step } = currentCode();
    const res = await confirmSetup({ otp: code });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await bodyOf(res);
    const codes = body.recovery_codes as string[];
    assert.equal(codes.length, 10);
    for (const entry of codes) assert.match(entry, RECOVERY_SHAPE);
    assert.equal(new Set(codes).size, 10);
    assert.deepEqual(withoutRequestId({ ...body, recovery_codes: null }), {
      success: true,
      recovery_codes: null,
      recovery_codes_left: 10,
      sessions_revoked: 2,
      session_renewed: true,
      audit_recorded: true,
    });
    const [activation] = callsTo('admin_mfa_activate');
    assert.deepEqual({ ...activation, p_recovery_hashes: null }, {
      p_admin_id: ADMIN_ID, p_step: step, p_recovery_hashes: null, p_keep_sid: SID,
    });
    assert.deepEqual(activation?.p_recovery_hashes, codes.map((entry) => hashRecoveryCode(entry, ADMIN_ID, 1)));
    assertKeptSession(res);
  });

  test('the kept session is re-signed with the new version, the same id, otp added and its original end', async () => {
    pendingAdmin();
    await confirmSetup({ otp: currentCode().code });
    assert.deepEqual(state.signed, [[{
      id: ADMIN_ID, username: USERNAME, role_title: ROLE, is_super_admin: false, page_permissions: GRANTS, token_version: 5,
    }, SID, ['pwd', 'otp'], Math.floor(Date.parse(sessionExpiresAt) / 1000)]]);
  });

  test('turning it on is audited with the devices signed out, and the right code is never counted as a failure', async () => {
    pendingAdmin();
    await confirmSetup({ otp: currentCode().code });
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [auditRow({
      action: 'MFA_ENABLED',
      after_value: { client: 'web', during_sign_in: false, sessions_revoked: 2, recovery_codes_left: 10, session_kept: true },
    })]);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    assert.deepEqual(callsTo('admin_mfa_use_step'), []);
  });

  test('setup attempts count against the admin, 10 in 15 minutes, and the limit fails closed', async () => {
    pendingAdmin();
    await confirmSetup({ otp: currentCode().code });
    assert.deepEqual(callsTo('check_rate_limit_by_key'), [{
      p_key: `admin:${ADMIN_ID}`, p_action: 'admin_mfa_enroll', p_limit: 10, p_window_secs: 900,
    }]);
    const cases: Array<[Reply, number]> = [
      [{ data: false }, 429],
      [{ data: null }, 429],
      [{ error: { message: 'duplicate key value', code: '23505' } }, 429],
      [{ error: { message: 'rate limit store unavailable' } }, 500],
      ['throw', 500],
    ];
    for (const [reply, status] of cases) {
      reset({ admin_mfa_get: pendingFactor(), check_rate_limit_by_key: reply });
      const res = await confirmSetup({ otp: currentCode().code });
      assert.equal(res.status, status, JSON.stringify(reply));
      assert.deepEqual(callsTo('admin_mfa_get'), []);
      assert.deepEqual(callsTo('admin_mfa_activate'), []);
    }
  });

  test('a setup that is missing, replaced, finished or older than 15 minutes is a 409 that says to start again', async () => {
    const cases: Array<[DbResult, string, string]> = [
      [{ data: { status: 'none' } }, SETUP_EXPIRED, 'setup_expired'],
      [pendingFactor(iso(-16 * MINUTE_MS)), SETUP_EXPIRED, 'setup_expired'],
      [pendingFactor(''), SETUP_EXPIRED, 'setup_expired'],
      [factor(), ALREADY_ON, 'already_active'],
    ];
    for (const [reply, message, reason] of cases) {
      reset({ admin_mfa_get: reply });
      const { code } = currentCode();
      const count = watchTotp();
      const res = await confirmSetup({ otp: code });
      assert.equal(res.status, 409);
      assert.deepEqual(withoutRequestId(await bodyOf(res)), {
        success: false, error: message, code: 'STATE_CONFLICT', message, details: { reason },
      });
      assert.equal(count(), 0);
      assert.deepEqual(callsTo('admin_mfa_activate'), []);
      mock.restoreAll();
      syncBuiltinESMExports();
    }
  });

  test('anything but six digits is refused on the code field; a wrong code is refused and never counted', async () => {
    for (const otp of ['12345', 'abcdef', '', 123456, null]) {
      pendingAdmin();
      const res = await confirmSetup({ otp });
      assert.equal(res.status, 400, String(otp));
      assert.deepEqual((await bodyOf(res)).details, { field: 'otp' });
      assert.deepEqual(callsTo('admin_mfa_activate'), []);
    }
    pendingAdmin();
    const wrong = await confirmSetup({ otp: wrongCode() });
    assert.equal(wrong.status, 400);
    assert.deepEqual(withoutRequestId(await bodyOf(wrong)), {
      success: false, error: SETUP_CODE_WRONG, code: 'VALIDATION_ERROR', message: SETUP_CODE_WRONG, details: { field: 'otp' },
    });
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    assert.deepEqual(callsTo('admin_mfa_activate'), []);
    assert.deepEqual(audits(), []);
    pendingAdmin();
    assert.equal((await confirmSetup({ code: currentCode().code })).status, 400);
  });

  test('a bearer or a cookie without a session id is not kept: the codes still come back and the page is told', async () => {
    for (const session of [webSession({ client: 'mobile', transport: 'bearer' }), null]) {
      reset({
        admin_mfa_get: pendingFactor(),
        admin_mfa_activate: { data: { ok: true, token_version: 5, session_kept: false, sessions_revoked: 3, recovery_codes_left: 10 } },
      }, signedIn({ session, mfa: { status: 'pending', lockedUntil: null } }));
      const res = await confirmSetup({ otp: currentCode().code });
      assert.equal(res.status, 200);
      const body = await bodyOf(res);
      assert.equal(body.session_renewed, false);
      assert.equal((body.recovery_codes as string[]).length, 10);
      assert.equal(callsTo('admin_mfa_activate')[0]?.p_keep_sid, null);
      assert.deepEqual(state.signed, []);
      assert.deepEqual(res.headers.getSetCookie(), []);
    }
  });

  test('a session the database did not keep, or a signing failure, still hands over the codes without a cookie', async () => {
    reset({
      admin_mfa_get: pendingFactor(),
      admin_mfa_activate: { data: { ok: true, token_version: 5, session_kept: false, sessions_revoked: 1, recovery_codes_left: 10 } },
    });
    const notKept = await confirmSetup({ otp: currentCode().code });
    assert.equal((await bodyOf(notKept)).session_renewed, false);
    assert.deepEqual(notKept.headers.getSetCookie(), []);
    pendingAdmin();
    state.signError = 'signing key unavailable';
    const unsigned = await confirmSetup({ otp: currentCode().code });
    assert.equal(unsigned.status, 200);
    const body = await bodyOf(unsigned);
    assert.equal(body.session_renewed, false);
    assert.equal((body.recovery_codes as string[]).length, 10);
    assert.deepEqual(unsigned.headers.getSetCookie(), []);
    assert.equal(audits()[0]?.action, 'MFA_ENABLED');
  });

  test('the database refusing activation maps to 409, 401 or 500, and a lost audit row is reported', async () => {
    const cases: Array<[Reply, number]> = [
      [{ data: { ok: false, reason: 'not_pending' } }, 409],
      [{ data: { ok: false, reason: 'already_active' } }, 409],
      [{ data: { ok: false, reason: 'admin_inactive' } }, 401],
      [{ data: { ok: false, reason: 'surprise' } }, 500],
      [{ error: { message: 'Invalid time step' } }, 500],
      ['throw', 500],
    ];
    for (const [reply, status] of cases) {
      reset({ admin_mfa_get: pendingFactor(), admin_mfa_activate: reply });
      const res = await confirmSetup({ otp: currentCode().code });
      assert.equal(res.status, status, JSON.stringify(reply));
      assert.deepEqual(audits(), []);
      assert.deepEqual(res.headers.getSetCookie(), []);
    }
    pendingAdmin();
    state.auditError = 'audit store down';
    const body = await bodyOf(await confirmSetup({ otp: currentCode().code }));
    assert.equal(body.audit_recorded, false);
    assert.equal(body.warning, 'Two-step sign-in was turned on, but the change could not be written to the audit log.');
  });

  test('without the encryption key the code is never checked', async () => {
    pendingAdmin();
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    const res = await confirmSetup({ otp: currentCode().code });
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, TWO_STEP_UNAVAILABLE);
    assert.deepEqual(callsTo('admin_mfa_activate'), []);
  });
});

describe('POST /api/account/mfa/recovery-codes', () => {
  function enrolled(replies: Record<string, Reply> = {}): void {
    reset(replies, signedIn({ mfa: { status: 'active', lockedUntil: null } }));
  }

  test('a right code is used once, then ten new codes replace the old ones and come back without caching', async () => {
    enrolled();
    const { code, step } = currentCode();
    const res = await newCodes({ otp: code });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await bodyOf(res);
    const codes = body.recovery_codes as string[];
    assert.equal(codes.length, 10);
    for (const entry of codes) assert.match(entry, RECOVERY_SHAPE);
    assert.equal(body.recovery_codes_left, 10);
    assert.deepEqual(callsTo('admin_mfa_use_step'), [{ p_admin_id: ADMIN_ID, p_step: step }]);
    assert.deepEqual(callsTo('admin_recovery_codes_replace'), [{
      p_admin_id: ADMIN_ID, p_code_hashes: codes.map((entry) => hashRecoveryCode(entry, ADMIN_ID, 1)),
    }]);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [auditRow({
      action: 'MFA_RECOVERY_CODES_REPLACED',
      before_value: { recovery_codes_left: 7 },
      after_value: { client: 'web', recovery_codes_left: 10 },
    })]);
    const order = state.rpcs.map((entry) => entry.name);
    assert.deepEqual(order, ['check_rate_limit_by_key', 'admin_mfa_get', 'admin_mfa_use_step', 'admin_recovery_codes_replace']);
  });

  test('every request counts against the admin, 5 in 15 minutes, after the body is read and before the code is', async () => {
    enrolled();
    await newCodes({ otp: currentCode().code });
    assert.deepEqual(callsTo('check_rate_limit_by_key'), [{
      p_key: `admin:${ADMIN_ID}`, p_action: 'admin_mfa_recovery_codes', p_limit: 5, p_window_secs: 900,
    }]);
    for (const body of ['not json', 'null', '[]']) {
      enrolled();
      const res = await newCodes(body);
      assert.equal(res.status, 400, body);
      assert.deepEqual(state.rpcs, [], body);
    }
  });

  test('a limited admin gets a 429 before anything is read, computed, counted or replaced', async () => {
    const replies: Reply[] = [{ data: false }, { data: null }, { error: { message: 'duplicate key value', code: '23505' } }];
    const { code } = currentCode();
    const count = watchTotp();
    for (const reply of replies) {
      enrolled({ check_rate_limit_by_key: reply });
      const res = await newCodes({ otp: code });
      assert.equal(res.status, 429, JSON.stringify(reply));
      assert.deepEqual(withoutRequestId(await bodyOf(res)), {
        success: false, error: CODES_TOO_MANY, code: 'RATE_LIMITED', message: CODES_TOO_MANY,
      });
      assert.deepEqual(state.rpcs.map((entry) => entry.name), ['check_rate_limit_by_key'], JSON.stringify(reply));
      assert.deepEqual(callsTo('admin_mfa_use_step'), []);
      assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
      assert.deepEqual(callsTo('admin_recovery_codes_replace'), []);
      assert.deepEqual(audits(), []);
    }
    assert.equal(count(), 0);
  });

  test('a limit store that fails is a 500 that checks nothing, never a pass', async () => {
    const replies: Reply[] = [{ error: { message: 'rate limit store unavailable' } }, 'throw'];
    const { code } = currentCode();
    const count = watchTotp();
    for (const reply of replies) {
      enrolled({ check_rate_limit_by_key: reply });
      const res = await newCodes({ otp: code });
      assert.equal(res.status, 500, JSON.stringify(reply));
      assert.deepEqual(withoutRequestId(await bodyOf(res)), {
        success: false, error: CODES_CHECK_UNAVAILABLE, code: 'INTERNAL_ERROR', message: CODES_CHECK_UNAVAILABLE,
      });
      assert.deepEqual(state.rpcs.map((entry) => entry.name), ['check_rate_limit_by_key'], JSON.stringify(reply));
      assert.deepEqual(audits(), []);
      assert.ok(logs.some((line) => line.startsWith('admin rate limit check failed: admin_mfa_recovery_codes')), JSON.stringify(reply));
    }
    assert.equal(count(), 0);
  });

  test('while wrong codes cannot be recorded, the attempt limit still stops the sixth try', async () => {
    let used = 0;
    enrolled({
      admin_mfa_record_failure: { error: { message: 'connection terminated' } },
      check_rate_limit_by_key: () => {
        used += 1;
        return { data: used <= 5 };
      },
    });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) statuses.push((await newCodes({ otp: wrongCode() })).status);
    assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
    assert.equal(callsTo('check_rate_limit_by_key').length, 6);
    assert.equal(callsTo('admin_mfa_record_failure').length, 5);
    assert.equal(callsTo('admin_mfa_get').length, 5);
    assert.deepEqual(callsTo('admin_recovery_codes_replace'), []);
    assert.ok(logs.some((line) => line.startsWith('admin two-step failure record failed:')));
  });

  test('without two-step sign-in on there is nothing to replace: 409', async () => {
    for (const reply of [{ data: { status: 'none' } }, pendingFactor()] as DbResult[]) {
      enrolled({ admin_mfa_get: reply });
      const res = await newCodes({ otp: currentCode().code });
      assert.equal(res.status, 409);
      assert.equal((await bodyOf(res)).error, 'Two-step sign-in is not on. Set it up first.');
      assert.deepEqual(callsTo('admin_mfa_use_step'), []);
    }
  });

  test('while locked, nothing is counted, no code is computed, and the refusal is audited with the unlock time', async () => {
    const lockedUntil = new Date(Date.now() + 10 * MINUTE_MS).toISOString();
    enrolled({ admin_mfa_get: factor({ locked_until: lockedUntil }) });
    const { code } = currentCode();
    const count = watchTotp();
    const res = await newCodes({ otp: code });
    assert.equal(res.status, 429);
    const body = await bodyOf(res);
    assert.equal(body.error, twoStepLockedMessage(lockedUntil));
    assert.deepEqual(body.details, { reason: 'mfa_locked', locked_until: lockedUntil });
    assert.equal(count(), 0);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    assert.deepEqual(callsTo('admin_mfa_use_step'), []);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [auditRow({
      action: 'MFA_CHALLENGE_FAILED', result: 'failure', error: 'Two-step sign-in is locked.',
    })]);
  });

  test('a blank or malformed code is refused on the code field without counting it', async () => {
    for (const [otp, message] of [['', 'Enter the code from your authenticator app.'], ['12 34', ENTER_SIX_DIGITS], ['abcdef', ENTER_SIX_DIGITS]]) {
      enrolled();
      const count = watchTotp();
      const res = await newCodes({ otp });
      assert.equal(res.status, 400);
      assert.deepEqual(withoutRequestId(await bodyOf(res)), {
        success: false, error: message, code: 'VALIDATION_ERROR', message, details: { field: 'otp' },
      });
      assert.equal(count(), 0);
      assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
      mock.restoreAll();
      syncBuiltinESMExports();
    }
    enrolled();
    assert.equal((await newCodes({ code: currentCode().code })).status, 400);
    assert.deepEqual(callsTo('admin_mfa_use_step'), []);
  });

  test('a wrong or reused code is counted once, audited, and refused on the code field', async () => {
    enrolled();
    const wrong = await newCodes({ otp: wrongCode() });
    assert.equal(wrong.status, 400);
    assert.deepEqual(withoutRequestId(await bodyOf(wrong)), {
      success: false, error: CODES_CODE_WRONG, code: 'VALIDATION_ERROR', message: CODES_CODE_WRONG, details: { field: 'otp' },
    });
    assert.deepEqual(callsTo('admin_mfa_record_failure'), [{ p_admin_id: ADMIN_ID }]);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [auditRow({
      action: 'MFA_CHALLENGE_FAILED', result: 'failure', error: 'Two-step code did not match.',
    })]);
    assert.deepEqual(callsTo('admin_recovery_codes_replace'), []);
    enrolled({ admin_mfa_use_step: { data: { ok: false, reason: 'replay' } } });
    const reused = await newCodes({ otp: currentCode().code });
    assert.equal(reused.status, 400);
    assert.equal((await bodyOf(reused)).error, CODES_CODE_WRONG);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), [{ p_admin_id: ADMIN_ID }]);
    assert.equal(audits()[0]?.error, 'Two-step code was already used.');
    assert.deepEqual(callsTo('admin_recovery_codes_replace'), []);
  });

  test('the code that locks two-step sign-in answers 429 with the date and audits the 24-hour lock', async () => {
    const lockedUntil = new Date(Date.now() + 24 * HOUR_MS).toISOString();
    enrolled({
      admin_mfa_record_failure: failure({
        failed_count: 4, failed_count_24h: 30, locked: true, locked_until: lockedUntil, just_locked: true, lock_minutes: 1440,
      }),
    });
    const res = await newCodes({ otp: wrongCode() });
    assert.equal(res.status, 429);
    assert.match(String((await bodyOf(res)).error), /locked until \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2} WAT\./);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS))[1], auditRow({
      action: 'MFA_LOCKED',
      reason: '30 failed two-step codes in 24 hours.',
      after_value: { client: 'web', locked_until: lockedUntil, lock_minutes: 1440 },
    }));
  });

  test('a lock or a reset that lands between the read and the check is a 429 or a 409, and a step store outage a 500', async () => {
    enrolled({ admin_mfa_use_step: { data: { ok: false, reason: 'locked', locked_until: '2026-10-13T14:05:00+00:00' } } });
    assert.equal((await newCodes({ otp: currentCode().code })).status, 429);
    enrolled({ admin_mfa_use_step: { data: { ok: false, reason: 'not_active' } } });
    assert.equal((await newCodes({ otp: currentCode().code })).status, 409);
    enrolled({ admin_mfa_use_step: { error: { message: 'Invalid time step' } } });
    assert.equal((await newCodes({ otp: currentCode().code })).status, 500);
    assert.deepEqual(callsTo('admin_recovery_codes_replace'), []);
  });

  test('a replacement that fails after the code was used keeps the old codes, says so, and is audited', async () => {
    for (const [reply, status] of [[{ error: { message: 'Invalid recovery codes' } }, 500], ['throw', 500], [{ data: { ok: false, reason: 'not_active' } }, 409]] as Array<[Reply, number]>) {
      enrolled({ admin_recovery_codes_replace: reply });
      const res = await newCodes({ otp: currentCode().code });
      assert.equal(res.status, status, JSON.stringify(reply));
      const body = await bodyOf(res);
      assert.equal(body.recovery_codes, undefined);
      assert.equal(audits()[0]?.action, 'MFA_RECOVERY_CODES_REPLACED');
      assert.equal(audits()[0]?.result, 'failure');
    }
  });

  test('without the encryption key nothing is used up', async () => {
    enrolled();
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    const res = await newCodes({ otp: currentCode().code });
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, TWO_STEP_UNAVAILABLE);
    assert.deepEqual(callsTo('admin_mfa_use_step'), []);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
  });
});

describe('GET /api/account/sessions', () => {
  test('lists the live sessions with this device first and marked current, without caching', async () => {
    const res = await listSessions();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await bodyOf(res);
    const sessions = body.sessions as Array<Record<string, unknown>>;
    assert.deepEqual(sessions.map((row) => [row.id, row.current]), [[SID, true], [OTHER_SID, false], [PHONE_SID, false]]);
    assert.deepEqual(sessions[0], {
      id: SID,
      client: 'web',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0',
      ip: '102.89.34.1',
      auth_methods: ['pwd'],
      created_at: '2026-10-13T08:00:00+00:00',
      last_seen_at: '2026-10-13T09:00:00+00:00',
      expires_at: '2026-10-13T16:00:00+00:00',
      current: true,
    });
    assert.equal(sessions[2]?.client, 'mobile');
    assert.deepEqual(callsTo('admin_sessions_list'), [{ p_admin_id: ADMIN_ID }]);
  });

  test('a cookie from before sessions had ids sees every session, none of them current', async () => {
    reset({}, signedIn({ session: null }));
    const sessions = (await bodyOf(await listSessions())).sessions as Array<Record<string, unknown>>;
    assert.deepEqual(sessions.map((row) => row.current), [false, false, false]);
  });

  test('missing fields read as null, unknown methods are dropped, and rows without an id are skipped', async () => {
    reset({ admin_sessions_list: { data: [{ id: OTHER_SID.toUpperCase(), auth_methods: ['otp', 'pwd', 'magic'] }, { client: 'web' }] } });
    const sessions = (await bodyOf(await listSessions())).sessions as Array<Record<string, unknown>>;
    assert.deepEqual(sessions, [{
      id: OTHER_SID, client: 'web', user_agent: null, ip: null, auth_methods: ['otp', 'pwd'],
      created_at: null, last_seen_at: null, expires_at: null, current: false,
    }]);
  });

  test('a store that fails is a 500, never a 401', async () => {
    for (const reply of [{ error: { message: 'connection terminated' } }, 'throw', { data: { not: 'rows' } }] as Reply[]) {
      reset({ admin_sessions_list: reply });
      const res = await listSessions();
      assert.equal(res.status, 500);
      assert.equal((await bodyOf(res)).error, 'Your signed-in devices could not be loaded. Try again.');
    }
  });
});

describe('DELETE /api/account/sessions/[id]', () => {
  test('signs one other device out as its owner and audits it', async () => {
    const res = await signOutOne(PHONE_SID);
    assert.equal(res.status, 200);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), { success: true, revoked: true, audit_recorded: true });
    assert.deepEqual(callsTo('admin_session_revoke'), [{
      p_admin_id: ADMIN_ID, p_sid: PHONE_SID, p_actor: ADMIN_ID, p_reason: 'signed_out_by_owner',
    }]);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [auditRow({
      action: 'ADMIN_SESSION_REVOKED',
      after_value: { client: 'web', session_id: PHONE_SID, session_client: 'mobile', by: 'owner', push_tokens_released: 1 },
    })]);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('this device is refused with a pointer to Log out, and nothing is called', async () => {
    for (const id of [SID, SID.toUpperCase()]) {
      reset();
      const res = await signOutOne(id);
      assert.equal(res.status, 409);
      assert.equal((await bodyOf(res)).error, THIS_DEVICE);
      assert.deepEqual(state.rpcs, []);
    }
  });

  test('an id that is not a uuid is a 400; a device already gone answers revoked false without an audit row', async () => {
    const bad = await signOutOne('not-a-session');
    assert.equal(bad.status, 400);
    assert.deepEqual(state.rpcs, []);
    reset({ admin_session_revoke: { data: { revoked: false } } });
    const gone = await signOutOne(OTHER_SID);
    assert.equal(gone.status, 200);
    assert.deepEqual(withoutRequestId(await bodyOf(gone)), { success: true, revoked: false });
    assert.deepEqual(audits(), []);
  });

  test('a store that fails is a 500 with a failure audit, never a 401', async () => {
    for (const reply of [{ error: { message: 'Not authorized' } }, 'throw'] as Reply[]) {
      reset({ admin_session_revoke: reply });
      const res = await signOutOne(OTHER_SID);
      assert.equal(res.status, 500);
      assert.equal(audits()[0]?.action, 'ADMIN_SESSION_REVOKED');
      assert.equal(audits()[0]?.result, 'failure');
    }
  });
});

describe('POST /api/account/sessions/sign-out-others', () => {
  test('ends every other session, keeps this one under the new version until its original end, and audits it', async () => {
    const res = await signOutOthers();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(withoutRequestId(await bodyOf(res)), {
      success: true, sessions_revoked: 2, session_renewed: true, audit_recorded: true,
    });
    assert.deepEqual(callsTo('admin_sessions_revoke_all'), [{
      p_admin_id: ADMIN_ID, p_actor: ADMIN_ID, p_keep_sid: SID, p_bump_token: true, p_reason: 'signed_out_others',
    }]);
    assert.deepEqual(state.signed, [[{
      id: ADMIN_ID, username: USERNAME, role_title: ROLE, is_super_admin: false, page_permissions: GRANTS, token_version: 5,
    }, SID, ['pwd'], Math.floor(Date.parse(sessionExpiresAt) / 1000)]]);
    assertKeptSession(res);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [auditRow({
      action: 'ADMIN_SESSIONS_SIGNED_OUT_OTHERS',
      after_value: { client: 'web', sessions_revoked: 2, session_kept: true, push_tokens_released: 1 },
    })]);
  });

  test('a bearer or a cookie without a session id keeps nothing, so the page is told the session ended', async () => {
    for (const session of [webSession({ client: 'mobile', transport: 'bearer' }), null]) {
      reset({
        admin_sessions_revoke_all: { data: { sessions_revoked: 3, session_kept: false, token_version: 5, push_tokens_released: 0 } },
      }, signedIn({ session }));
      const res = await signOutOthers();
      assert.equal((await bodyOf(res)).session_renewed, false);
      assert.equal(callsTo('admin_sessions_revoke_all')[0]?.p_keep_sid, null);
      assert.deepEqual(state.signed, []);
      assert.deepEqual(res.headers.getSetCookie(), []);
    }
  });

  test('a session that ended meanwhile, a missing version or a signing failure gives no cookie and session_renewed false', async () => {
    const replies: Reply[] = [
      { data: { sessions_revoked: 1, session_kept: false, token_version: 5 } },
      { data: { sessions_revoked: 1, session_kept: true, token_version: null } },
    ];
    for (const reply of replies) {
      reset({ admin_sessions_revoke_all: reply });
      const res = await signOutOthers();
      assert.equal((await bodyOf(res)).session_renewed, false, JSON.stringify(reply));
      assert.deepEqual(res.headers.getSetCookie(), []);
    }
    reset();
    state.signError = 'signing key unavailable';
    const unsigned = await signOutOthers();
    assert.equal((await bodyOf(unsigned)).session_renewed, false);
    assert.deepEqual(unsigned.headers.getSetCookie(), []);
  });

  test('a store that fails is a 500 with a failure audit, and the cookie is left alone', async () => {
    for (const reply of [{ error: { message: 'Admin not found' } }, 'throw'] as Reply[]) {
      reset({ admin_sessions_revoke_all: reply });
      const res = await signOutOthers();
      assert.equal(res.status, 500);
      assert.deepEqual(res.headers.getSetCookie(), []);
      assert.equal(audits()[0]?.result, 'failure');
    }
  });
});

describe('POST /api/account/sessions/sign-out-everywhere', () => {
  test('ends every session including this one, clears both cookies and audits it', async () => {
    const res = await signOutEverywhere();
    assert.equal(res.status, 200);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), { success: true, sessions_revoked: 2, audit_recorded: true });
    assert.deepEqual(callsTo('admin_sessions_revoke_all'), [{
      p_admin_id: ADMIN_ID, p_actor: ADMIN_ID, p_keep_sid: null, p_bump_token: true, p_reason: 'signed_out_everywhere',
    }]);
    const cookies = cookiesOf(res);
    assert.equal(cookies.get('admin_token')?.value, '');
    assert.equal(cookies.get('admin_token')?.attributes.get('expires'), EPOCH);
    assert.equal(cookies.get('admin_theme')?.value, '');
    assert.deepEqual(state.signed, []);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [auditRow({
      action: 'ADMIN_SESSIONS_SIGNED_OUT_EVERYWHERE',
      after_value: { client: 'web', sessions_revoked: 2, push_tokens_released: 1 },
    })]);
  });

  test('a store that fails is a 500 with a failure audit, and the cookies are kept', async () => {
    reset({ admin_sessions_revoke_all: { error: { message: 'connection terminated' } } });
    const res = await signOutEverywhere();
    assert.equal(res.status, 500);
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.equal(audits()[0]?.action, 'ADMIN_SESSIONS_SIGNED_OUT_EVERYWHERE');
    assert.equal(audits()[0]?.result, 'failure');
  });
});

describe('the re-signed cookie against the real verifier', () => {
  const world: World = { version: 4, mfa: 'none', sessions: [] };

  function live(session: WorldSession): boolean {
    return !session.revoked && Date.parse(session.expiresAt) > Date.now() && session.version === world.version;
  }

  function keepAndBump(keepSid: unknown): { kept: WorldSession | undefined; revoked: number } {
    const kept = world.sessions.find((session) => session.id === keepSid && live(session));
    let revoked = 0;
    for (const session of world.sessions) {
      if (live(session) && session !== kept) {
        session.revoked = true;
        revoked += 1;
      }
    }
    world.version += 1;
    if (kept) kept.version = world.version;
    return { kept, revoked };
  }

  function session(id: string, client: 'web' | 'mobile', amr: string[]): WorldSession {
    return {
      id, client, amr, createdAt: iso(-HOUR_MS), expiresAt: iso(5 * HOUR_MS), reauthAt: iso(-HOUR_MS), version: 4, revoked: false,
    };
  }

  function realWorld(mfa: World['mfa']): void {
    reset();
    world.version = 4;
    world.mfa = mfa;
    world.sessions = [session(SID, 'web', ['pwd']), session(OTHER_SID, 'web', ['pwd']), session(PHONE_SID, 'mobile', ['pwd'])];
    state.requestAdmin = null;
    state.replies.set('admin_auth_state', (args) => {
      const found = world.sessions.find((entry) => entry.id === args.p_sid);
      const status = !found ? 'not_found' : found.revoked ? 'revoked' : Date.parse(found.expiresAt) <= Date.now() ? 'expired'
        : found.version !== world.version ? 'stale' : 'active';
      return {
        data: {
          admin: { id: ADMIN_ID, username: USERNAME, role_title: ROLE, is_super_admin: false, page_permissions: GRANTS, token_version: world.version },
          session: args.p_sid ? {
            id: args.p_sid, status, client: found?.client ?? null, auth_methods: found?.amr ?? null, created_at: found?.createdAt ?? null,
            expires_at: found?.expiresAt ?? null, reauth_at: found?.reauthAt ?? null,
          } : null,
          mfa: { status: world.mfa, locked_until: null },
          policy: { mfa_mode: 'off', mfa_grace_ends_at: null, mfa_required_now: false },
        },
      };
    });
    state.replies.set('admin_sessions_revoke_all', (args) => {
      const { kept, revoked } = keepAndBump(args.p_keep_sid);
      return {
        data: { sessions_revoked: revoked, session_kept: kept !== undefined, token_version: world.version, token_version_bumped: true, push_tokens_released: 0 },
      };
    });
    state.replies.set('admin_mfa_activate', (args) => {
      const { kept, revoked } = keepAndBump(args.p_keep_sid);
      world.mfa = 'active';
      if (kept) kept.amr = [...new Set([...kept.amr, 'otp'])].sort();
      return {
        data: { ok: true, token_version: world.version, session_kept: kept !== undefined, sessions_revoked: revoked, recovery_codes_left: 10 },
      };
    });
    state.replies.set('admin_sessions_list', () => ({
      data: world.sessions.filter(live).map((entry) => listedRow(entry.id, { client: entry.client, auth_methods: entry.amr })),
    }));
    state.replies.set('admin_mfa_get', pendingFactor());
  }

  async function issued(id: string): Promise<{ token: string; exp: number }> {
    const found = world.sessions.find((entry) => entry.id === id);
    assert.ok(found);
    const exp = Math.floor(Date.parse(found.expiresAt) / 1000);
    const token = await realJwt.signSessionToken({
      id: ADMIN_ID, username: USERNAME, role_title: ROLE, is_super_admin: false, page_permissions: GRANTS, token_version: found.version,
    }, id, found.amr as Array<'pwd' | 'otp' | 'recovery'>, exp);
    return { token, exp };
  }

  async function listWith(token: string): Promise<Response> {
    state.cookies = new Map([['admin_token', token]]);
    return call(realRoutes.sessions, 'GET', '/api/account/sessions');
  }

  test('after signing out other devices, the new cookie works, the old cookie and the other devices get 401', async () => {
    realWorld('none');
    const old = await issued(SID);
    const other = await issued(OTHER_SID);
    assert.equal((await listWith(old.token)).status, 200);

    state.cookies = new Map([['admin_token', old.token]]);
    const res = await call(realRoutes.others, 'POST', '/api/account/sessions/sign-out-others');
    assert.equal(res.status, 200);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), {
      success: true, sessions_revoked: 2, session_renewed: true, audit_recorded: true,
    });
    const renewed = cookiesOf(res).get('admin_token')?.value ?? '';
    const claims = decodeJwt(renewed);
    assert.equal(claims.sid, SID);
    assert.deepEqual(claims.amr, ['pwd']);
    assert.equal(claims.token_version, 5);
    assert.equal(claims.exp, old.exp);
    assert.equal(claims.admin_id, ADMIN_ID);

    const fresh = await listWith(renewed);
    assert.equal(fresh.status, 200);
    assert.deepEqual(((await bodyOf(fresh)).sessions as Array<Record<string, unknown>>).map((row) => [row.id, row.current]), [[SID, true]]);
    assert.equal((await listWith(old.token)).status, 401);
    assert.equal((await listWith(other.token)).status, 401);
  });

  test('after turning two-step sign-in on, the new cookie carries otp and works, and the old cookie gets 401', async () => {
    realWorld('pending');
    const old = await issued(SID);
    state.cookies = new Map([['admin_token', old.token]]);
    const res = await call(realRoutes.confirm, 'POST', '/api/account/mfa/enroll/confirm', { otp: currentCode().code });
    assert.equal(res.status, 200);
    const body = await bodyOf(res);
    assert.equal(body.session_renewed, true);
    assert.equal((body.recovery_codes as string[]).length, 10);
    const renewed = cookiesOf(res).get('admin_token')?.value ?? '';
    const claims = decodeJwt(renewed);
    assert.equal(claims.sid, SID);
    assert.deepEqual(claims.amr, ['otp', 'pwd']);
    assert.equal(claims.token_version, 5);
    assert.equal(claims.exp, old.exp);

    assert.equal((await listWith(renewed)).status, 200);
    assert.equal((await listWith(old.token)).status, 401);
  });

  test('a verifier outage on these routes is a 500, never the 401 that would sign the admin out', async () => {
    realWorld('none');
    const old = await issued(SID);
    state.replies.set('admin_auth_state', { error: { message: 'connection terminated' } });
    const res = await listWith(old.token);
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, 'Your session could not be checked. Try again.');
  });
});

describe('route sources', () => {
  const sources = Object.values(ROUTES).map((path) => [path, readFileSync(resolve(APP_DIR, path), 'utf8')] as const);

  test('carry no prose comments, and neither does this test', () => {
    for (const [path, source] of [...sources, ['test/accountSecurityRoutes.test.ts', readFileSync(TEST_FILE, 'utf8')] as const]) {
      assert.doesNotMatch(source, /\/\*|(^|[^:])\/\/(?!\/)/m, path);
    }
  });

  test('read only otp from a body, never code, and answer through the shared envelope', () => {
    for (const [path, source] of sources) {
      assert.doesNotMatch(source, /\.code\b(?!_)|\['code'\]|body\.code/, path);
      assert.doesNotMatch(source, /NextResponse\.json\(|from\('audit_log'\)\s*\.insert|x-forwarded-for|'use client'|status: 401/, path);
      assert.match(source, /requireAdmin\(\)/, path);
      assert.doesNotMatch(source, /requireSuperAdmin/, path);
    }
  });

  test('only setting up two-step sign-in asks for a fresh identity check', () => {
    for (const [path, source] of sources) {
      assert.equal(/requireRecentAuth/.test(source), path === ROUTES.start, path);
    }
  });

  test('each route writes its own audit action as a plain literal, and the database-only reset is only ever read', () => {
    const owned: Array<[keyof typeof ROUTES, string]> = [
      ['confirm', 'MFA_ENABLED'],
      ['codes', 'MFA_RECOVERY_CODES_REPLACED'],
      ['session', 'ADMIN_SESSION_REVOKED'],
      ['others', 'ADMIN_SESSIONS_SIGNED_OUT_OTHERS'],
      ['everywhere', 'ADMIN_SESSIONS_SIGNED_OUT_EVERYWHERE'],
    ];
    for (const [key, action] of owned) {
      assert.match(readFileSync(resolve(APP_DIR, ROUTES[key]), 'utf8'), new RegExp(`action: '${action}'`), key);
    }
    for (const [path, source] of sources) assert.doesNotMatch(source, /action: 'MFA_BREAK_GLASS_RESET'/, path);
    assert.match(readFileSync(resolve(APP_DIR, ROUTES.mfa), 'utf8'), /\['MFA_RESET', 'MFA_BREAK_GLASS_RESET'\]/);
  });

  test('responses that carry a secret, codes or a new cookie are never cached', () => {
    for (const key of ['start', 'confirm', 'codes', 'others', 'everywhere', 'mfa', 'sessions'] as const) {
      assert.match(readFileSync(resolve(APP_DIR, ROUTES[key]), 'utf8'), /headers: \{ \.\.\.NO_STORE \}/, key);
    }
  });

  test('never log a code, a secret, a token or a password', () => {
    for (const [path, source] of sources) {
      for (const [, args] of source.matchAll(/console\.error\(([^;]*)\);/g)) {
        const code = args.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '');
        assert.doesNotMatch(code, /\b(?:code|codes|otp|secret|sealed|token|hashes|password)\b/, `${path}: ${args}`);
      }
    }
  });
});
