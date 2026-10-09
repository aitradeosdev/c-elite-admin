import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const STATE_KEY = '__cardeliteAuthRoutesTest';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const TEST_FILE = fileURLToPath(import.meta.url);
const nodeRequire = createRequire(import.meta.url);

const ROUTES = {
  login: 'api/auth/route.ts',
  logout: 'api/auth/logout/route.ts',
  me: 'api/auth/me/route.ts',
  theme: 'api/admin/theme/route.ts',
} as const;

const ADMIN_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const EMAIL = 'Ops@CardElite.test';
const USERNAME = 'Ops.Lead';
const ROLE = 'Operations Lead';
const PASSWORD = 'Correct-Horse-Battery-9';
const WRONG_PASSWORD = 'Tr0ub4dor-and-3-wrong';
const STORED_HASH = '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';
const ISSUED_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.issued-session-token.signature';
const SESSION_COOKIE = 'eyJhbGciOiJIUzI1NiJ9.current-session-cookie.signature';
const REQUEST_ID = 'req_authroutes01';
const USER_AGENT = 'Mozilla/5.0 (CardElite auth route test)';
const FORWARDED_FOR = '203.0.113.50, 198.51.100.7';
const CLIENT_IP = '198.51.100.7';
const DUMMY_HASH = 'dummy-hash:not-a-real-password:12';
const EPOCH = 'Thu, 01 Jan 1970 00:00:00 GMT';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const LOGIN_COLUMNS =
  'id, username, email, password_hash, role_title, is_super_admin, is_active, page_permissions, theme_preference, token_version';
const PROFILE_COLUMNS = 'id, username, email, role_title, is_super_admin, is_active, page_permissions';
const MISSING_FIELDS = 'Email, username and password required';
const TOO_MANY = 'Too many attempts. Try again later.';
const INVALID = 'Invalid credentials';
const BAD_THEME = 'theme must be light | dark | system';
const ALERT_COLUMN_ERROR = "Could not find the 'admin_id' column of 'admin_alerts' in the schema cache";
const AUDIT_DOWN = 'audit store unavailable';

const AUDIT_KEYS = [
  'admin_id', 'user_id', 'action', 'entity', 'entity_id', 'before_value', 'after_value', 'ip_address',
  'admin_role', 'user_agent', 'request_id', 'reason', 'result', 'error', 'sensitivity',
] as const;

interface AccountRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role_title: string;
  is_super_admin: boolean;
  is_active: boolean;
  page_permissions: string[] | null;
  theme_preference: string | null;
  token_version: number | null;
}

interface SessionClaims {
  admin_id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  token_version: number;
}

interface ProfileRow {
  id: string;
  username: string;
  email: string;
  role_title: string;
  is_super_admin: boolean;
  is_active: boolean;
  page_permissions: string[] | null;
}

interface DbError {
  message: string;
  code?: string;
}

interface DbResult {
  data?: unknown;
  error?: DbError | null;
  count?: number | null;
}

type Filter = [kind: string, column: string, value: unknown];

interface Query {
  table: string;
  op: 'select' | 'insert' | 'update' | null;
  columns: string | null;
  options: unknown;
  payload: unknown;
  filters: Filter[];
  terminal: 'single' | 'maybeSingle' | null;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface Scenario {
  limits: Record<string, boolean | null>;
  limitError: string | null;
  account: AccountRow | null;
  lookupError: DbError | null;
  recentFailures: number;
  dailyFailures: number;
  auditError: string | null;
  alert: 'ok' | 'error' | 'throw';
  deactivateError: string | null;
  tokenVersion: number | null;
  tokenReadError: string | null;
  tokenWriteError: string | null;
  profile: ProfileRow | null;
  profileError: string | null;
  themeError: string | null;
}

interface CookieJar {
  get(name: string): { name: string; value: string } | undefined;
}

interface StubState {
  hashes: Array<[unknown, unknown]>;
  scenario: Scenario;
  queries: Query[];
  rpcs: RpcCall[];
  compares: Array<[unknown, unknown]>;
  signed: Array<[unknown, unknown]>;
  verified: unknown[];
  fromRequestCalls: number;
  sessions: Record<string, SessionClaims>;
  requestAdmin: SessionClaims | null;
  issuedToken: string;
  headers: Headers;
  cookies: CookieJar;
  matches(value: unknown, hash: unknown): boolean;
  db: {
    from(table: string): object;
    rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
  };
}

interface Cookie {
  value: string;
  attributes: Map<string, string | true>;
}

interface RequestOptions {
  body?: unknown;
  raw?: string;
  headers?: Record<string, string | null>;
  cookie?: string;
}

type Handler = (req: Request) => Promise<Response>;

interface PostRoute {
  POST: Handler;
}

interface ProfileRoute {
  GET: () => Promise<Response>;
}

interface ThemeRoute {
  PATCH: Handler;
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
  theme_preference: 'dark',
  token_version: 4,
};

const SESSION: SessionClaims = {
  admin_id: ADMIN_ID,
  username: USERNAME,
  role_title: ROLE,
  is_super_admin: false,
  page_permissions: [],
  token_version: 4,
};

const PROFILE: ProfileRow = {
  id: ADMIN_ID,
  username: USERNAME,
  email: EMAIL,
  role_title: ROLE,
  is_super_admin: false,
  is_active: true,
  page_permissions: ['withdrawals'],
};

const LOGIN_BODY = { email: EMAIL, username: USERNAME, password: PASSWORD };

function baseScenario(): Scenario {
  return {
    limits: {},
    limitError: null,
    account: { ...ACCOUNT },
    lookupError: null,
    recentFailures: 0,
    dailyFailures: 0,
    auditError: null,
    alert: 'ok',
    deactivateError: null,
    tokenVersion: 4,
    tokenReadError: null,
    tokenWriteError: null,
    profile: { ...PROFILE },
    profileError: null,
    themeError: null,
  };
}

const logs: string[] = [];

const state: StubState = {
  hashes: [],
  scenario: baseScenario(),
  queries: [],
  rpcs: [],
  compares: [],
  signed: [],
  verified: [],
  fromRequestCalls: 0,
  sessions: {},
  requestAdmin: null,
  issuedToken: ISSUED_TOKEN,
  headers: new Headers(),
  cookies: { get: () => undefined },
  matches: (value, hash) => value === PASSWORD && hash === STORED_HASH,
  db: {
    from: (table) => chain(table),
    rpc: (name, args) => rateLimit(name, args),
  },
};

Reflect.set(globalThis, STATE_KEY, state);

function fault(message: string | null): DbError | null {
  return message ? { message } : null;
}

function filterValue(query: Query, kind: string, column: string): unknown {
  return query.filters.find(([k, c]) => k === kind && c === column)?.[2];
}

function respond(query: Query): DbResult {
  const s = state.scenario;
  const payload = (query.payload ?? {}) as Record<string, unknown>;
  if (query.table === 'audit_log' && query.op === 'insert') return { error: fault(s.auditError) };
  if (query.table === 'audit_log' && query.op === 'select') {
    const since = Date.parse(String(filterValue(query, 'gte', 'created_at')));
    return { count: Date.now() - since < HOUR_MS ? s.recentFailures : s.dailyFailures };
  }
  if (query.table === 'admin_alerts' && query.op === 'insert') {
    if (s.alert === 'throw') throw new Error('admin_alerts unreachable');
    return { error: s.alert === 'error' ? { message: ALERT_COLUMN_ERROR, code: 'PGRST204' } : null };
  }
  if (query.table === 'admin_users' && query.op === 'select' && query.columns === 'token_version') {
    return s.tokenReadError ? { error: fault(s.tokenReadError) } : { data: { token_version: s.tokenVersion } };
  }
  if (query.table === 'admin_users' && query.op === 'select' && query.terminal === 'single') {
    if (s.lookupError) return { error: s.lookupError };
    if (s.account) return { data: s.account };
    return { error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
  }
  if (query.table === 'admin_users' && query.op === 'select' && query.terminal === 'maybeSingle') {
    return s.profileError ? { error: fault(s.profileError) } : { data: s.profile };
  }
  if (query.table === 'admin_users' && query.op === 'update') {
    if ('is_active' in payload) return { error: fault(s.deactivateError) };
    if ('last_login_at' in payload) return { error: null };
    if ('token_version' in payload) return { error: fault(s.tokenWriteError) };
    if ('theme_preference' in payload) return { error: fault(s.themeError) };
  }
  throw new Error(`unexpected query ${JSON.stringify(query)}`);
}

function chain(table: string): object {
  const query: Query = { table, op: null, columns: null, options: null, payload: undefined, filters: [], terminal: null };
  state.queries.push(query);
  const settle = () => Promise.resolve().then(() => ({ data: null, error: null, count: null, ...respond(query) }));
  const builder: Record<string, unknown> = {
    select: (columns: string, options?: unknown) => {
      if (query.op === null) query.op = 'select';
      query.columns = columns;
      query.options = options ?? null;
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
    eq: (column: string, value: unknown) => {
      query.filters.push(['eq', column, value]);
      return builder;
    },
    gte: (column: string, value: unknown) => {
      query.filters.push(['gte', column, value]);
      return builder;
    },
    single: () => {
      query.terminal = 'single';
      return builder;
    },
    maybeSingle: () => {
      query.terminal = 'maybeSingle';
      return builder;
    },
    then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
      settle().then(onFulfilled, onRejected),
  };
  return builder;
}

function rateLimit(name: string, args: Record<string, unknown>): Promise<DbResult> {
  state.rpcs.push({ name, args });
  if (name !== 'check_rate_limit_by_key') return Promise.reject(new Error(`unexpected rpc ${name}`));
  if (state.scenario.limitError) return Promise.resolve({ data: null, error: { message: state.scenario.limitError } });
  const verdict = state.scenario.limits[String(args.p_action)];
  return Promise.resolve({ data: verdict === undefined ? true : verdict, error: null });
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
    'export async function cookies() { return state().cookies; }',
  ]),
  bcryptjs: stub([
    'export default {',
    '  hashSync(value, rounds) { state().hashes.push([value, rounds]); return "dummy-hash:" + value + ":" + rounds; },',
    '  async compare(value, hash) { state().compares.push([value, hash]); return state().matches(value, hash); },',
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
    'export async function signAdminJWT(payload, expiresIn) { state().signed.push([payload, expiresIn]); return state().issuedToken; }',
    'export async function verifyAdminJWT(token) {',
    '  state().verified.push(token);',
    '  return Object.prototype.hasOwnProperty.call(state().sessions, token) ? state().sessions[token] : null;',
    '}',
    'export async function verifyAdminFromRequest() { state().fromRequestCalls += 1; return state().requestAdmin; }',
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
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
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
  const code = outputText.replace(IMPORT_RE, (match: string, head: string, specifier: string) => {
    const target = targets.get(specifier);
    return target ? `${head}'${target}'` : match;
  });
  return moduleUrl(code);
}

function bundle(file: string): Promise<string> {
  let pending = bundled.get(file);
  if (!pending) {
    pending = transpile(file);
    bundled.set(file, pending);
  }
  return pending;
}

async function loadRoute<T>(path: string): Promise<T> {
  return (await import(await bundle(resolve(APP_DIR, path)))) as T;
}

function reset(patch: Partial<Scenario> = {}): void {
  state.scenario = { ...baseScenario(), ...patch };
  state.queries = [];
  state.rpcs = [];
  state.compares = [];
  state.signed = [];
  state.verified = [];
  state.fromRequestCalls = 0;
  state.sessions = {};
  state.requestAdmin = null;
  state.headers = new Headers();
  state.cookies = { get: () => undefined };
  logs.length = 0;
}

function prepare(extra: Record<string, string | null> = {}, cookie?: string): Headers {
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
  state.cookies = {
    get: (name) => (name === 'admin_token' && cookie !== undefined ? { name, value: cookie } : undefined),
  };
  return headers;
}

function request(method: 'POST' | 'PATCH', path: string, options: RequestOptions = {}): Request {
  const headers = prepare(options.headers, options.cookie);
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(`http://localhost${path}`, { method, headers, body });
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

function assertNoSecrets(text: string, secrets: readonly string[]): void {
  for (const secret of secrets) assert.ok(!text.includes(secret), `leaked ${secret}`);
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

let login: PostRoute;
let logout: PostRoute;
let me: ProfileRoute;
let theme: ThemeRoute;
let hashesAtLoad: Array<[unknown, unknown]> = [];

before(async () => {
  login = await loadRoute<PostRoute>(ROUTES.login);
  hashesAtLoad = state.hashes.slice();
  logout = await loadRoute<PostRoute>(ROUTES.logout);
  me = await loadRoute<ProfileRoute>(ROUTES.me);
  theme = await loadRoute<ThemeRoute>(ROUTES.theme);
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

function signIn(body: unknown = LOGIN_BODY, headers: Record<string, string | null> = {}): Promise<Response> {
  return login.POST(request('POST', '/api/auth', { body, headers }));
}

function signInWrong(): Promise<Response> {
  return signIn({ ...LOGIN_BODY, password: WRONG_PASSWORD });
}

function signOut(options: RequestOptions = {}): Promise<Response> {
  return logout.POST(request('POST', '/api/auth/logout', options));
}

function readProfile(): Promise<Response> {
  prepare();
  return me.GET();
}

function saveTheme(options: RequestOptions): Promise<Response> {
  return theme.PATCH(request('PATCH', '/api/admin/theme', options));
}

function assertSignedOutCookies(res: Response): void {
  const cookies = cookiesOf(res);
  const session = cookies.get('admin_token');
  assert.equal(session?.value, '');
  assert.equal(session?.attributes.get('expires'), EPOCH);
  assert.equal(session?.attributes.get('httponly'), true);
  assert.equal(session?.attributes.get('samesite'), 'strict');
  assert.equal(session?.attributes.get('path'), '/');
  const themeCookie = cookies.get('admin_theme');
  assert.equal(themeCookie?.value, '');
  assert.equal(themeCookie?.attributes.get('expires'), EPOCH);
  assert.equal(themeCookie?.attributes.has('httponly'), false);
  assert.equal(themeCookie?.attributes.get('samesite'), 'lax');
  assert.equal(themeCookie?.attributes.get('path'), '/');
}

describe('POST /api/auth: request validation', () => {
  test('a missing or empty field is refused before any rate limit or lookup, with the message the login page shows', async () => {
    const bodies = [
      { username: USERNAME, password: PASSWORD },
      { email: EMAIL, password: PASSWORD },
      { email: EMAIL, username: USERNAME },
      { email: '', username: USERNAME, password: PASSWORD },
      { email: EMAIL, username: '', password: PASSWORD },
      { email: EMAIL, username: USERNAME, password: '' },
    ];
    for (const body of bodies) {
      reset();
      const res = await signIn(body);
      assert.equal(res.status, 400);
      assert.deepEqual(await bodyOf(res), {
        success: false,
        error: MISSING_FIELDS,
        code: 'VALIDATION_ERROR',
        message: MISSING_FIELDS,
        request_id: REQUEST_ID,
      });
      assert.equal(res.headers.get('x-request-id'), REQUEST_ID);
      assert.equal(state.rpcs.length, 0);
      assert.equal(state.queries.length, 0);
      assert.equal(state.compares.length, 0);
    }
  });

  test('unreadable bodies and non-string fields get the same 400 instead of crashing', async () => {
    const raws = [
      'not json',
      'null',
      '[]',
      '"Ops.Lead"',
      JSON.stringify({ ...LOGIN_BODY, password: 12345 }),
      JSON.stringify({ ...LOGIN_BODY, username: [USERNAME] }),
      JSON.stringify({ ...LOGIN_BODY, email: { $ne: '' } }),
    ];
    for (const raw of raws) {
      reset();
      const res = await login.POST(request('POST', '/api/auth', { raw }));
      assert.equal(res.status, 400, raw);
      assert.equal((await bodyOf(res)).error, MISSING_FIELDS, raw);
      assert.equal(state.rpcs.length, 0, raw);
      assert.equal(state.queries.length, 0, raw);
    }
  });
});

describe('POST /api/auth: rate limiting', () => {
  test('the per-IP limit runs first with the existing key, action, limit and window', async () => {
    reset({ limits: { admin_login: false } });
    const res = await signIn();
    assert.equal(res.status, 429);
    assert.deepEqual(await bodyOf(res), {
      success: false,
      error: TOO_MANY,
      code: 'RATE_LIMITED',
      message: TOO_MANY,
      request_id: REQUEST_ID,
    });
    assert.deepEqual(state.rpcs, [
      { name: 'check_rate_limit_by_key', args: { p_key: CLIENT_IP, p_action: 'admin_login', p_limit: 20, p_window_secs: 600 } },
    ]);
    assert.equal(state.queries.length, 0);
    assert.equal(state.compares.length, 0);
  });

  test('the per-account limit keys on the lower-cased username and email as sent', async () => {
    reset({ limits: { admin_login_account: false } });
    const res = await signIn();
    assert.equal(res.status, 429);
    assert.equal((await bodyOf(res)).error, TOO_MANY);
    assert.equal(state.rpcs.length, 2);
    assert.deepEqual(state.rpcs[1], {
      name: 'check_rate_limit_by_key',
      args: { p_key: 'admin:ops.lead|ops@cardelite.test', p_action: 'admin_login_account', p_limit: 10, p_window_secs: 1800 },
    });
    assert.equal(state.queries.length, 0);
    assert.equal(state.compares.length, 0);
  });

  test('both limits answer identically, so neither reveals which one tripped', async () => {
    reset({ limits: { admin_login: false } });
    const byIp = withoutRequestId(await bodyOf(await signIn()));
    reset({ limits: { admin_login_account: false } });
    const byAccount = withoutRequestId(await bodyOf(await signIn()));
    assert.deepEqual(byIp, byAccount);
  });

  test('the client IP is the last X-Forwarded-For hop, then X-Real-IP, then unknown', async () => {
    const cases: Array<[Record<string, string | null>, string]> = [
      [{}, CLIENT_IP],
      [{ 'x-forwarded-for': null, 'x-real-ip': '192.0.2.44' }, '192.0.2.44'],
      [{ 'x-forwarded-for': null }, 'unknown'],
    ];
    for (const [headers, ip] of cases) {
      reset({ limits: { admin_login: false } });
      await signIn(LOGIN_BODY, headers);
      assert.equal(state.rpcs[0]?.args.p_key, ip);
    }
  });

  test('a rate-limit lookup error lets the attempt through, as before, and is logged without credentials', async () => {
    reset({ limitError: 'rate limit store unavailable', account: null });
    const res = await signIn();
    assert.equal(res.status, 401);
    assert.equal(state.rpcs.length, 2);
    assert.equal(queriesOn('admin_users', 'select').length, 1);
    assert.ok(logs.some((line) => line.includes('rate limit store unavailable')));
    assertNoSecrets(logs.join('\n'), [PASSWORD, EMAIL, USERNAME]);
  });
});

describe('POST /api/auth: credentials', () => {
  test('the account is looked up by username, email and the active flag exactly as sent', async () => {
    reset({ account: null });
    await signIn();
    const lookups = queriesOn('admin_users', 'select');
    assert.equal(lookups.length, 1);
    assert.equal(lookups[0].columns, LOGIN_COLUMNS);
    assert.deepEqual(lookups[0].filters, [['eq', 'username', USERNAME], ['eq', 'email', EMAIL], ['eq', 'is_active', true]]);
    assert.equal(lookups[0].terminal, 'single');
  });

  test('an unknown account still runs one bcrypt compare against the dummy hash and records nothing', async () => {
    reset({ account: null, recentFailures: 50, dailyFailures: 50 });
    const res = await signIn();
    assert.equal(res.status, 401);
    assert.deepEqual(await bodyOf(res), {
      success: false,
      error: INVALID,
      code: 'AUTH_REQUIRED',
      message: INVALID,
      request_id: REQUEST_ID,
    });
    assert.deepEqual(state.compares, [[PASSWORD, DUMMY_HASH]]);
    assert.equal(queriesOn('audit_log', 'insert').length, 0);
    assert.equal(queriesOn('audit_log', 'select').length, 0);
    assert.equal(queriesOn('admin_alerts', 'insert').length, 0);
    assert.equal(queriesOn('admin_users', 'update').length, 0);
    assert.equal(state.signed.length, 0);
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.deepEqual(logs, []);
  });

  test('the dummy hash is computed once with cost 12 when the route loads, never per request', async () => {
    assert.deepEqual(hashesAtLoad, [['not-a-real-password', 12]]);
    reset({ account: null });
    await signIn();
    reset();
    await signInWrong();
    reset();
    await signIn();
    assert.deepEqual(state.hashes, hashesAtLoad);
  });

  test('a lookup error fails closed exactly like an unknown account and is logged without credentials', async () => {
    reset({ lookupError: { message: 'connection terminated', code: '08006' } });
    const res = await signIn();
    assert.equal(res.status, 401);
    assert.equal((await bodyOf(res)).error, INVALID);
    assert.deepEqual(state.compares, [[PASSWORD, DUMMY_HASH]]);
    assert.equal(audits().length, 0);
    assert.ok(logs.some((line) => line.includes('connection terminated')));
    assertNoSecrets(logs.join('\n'), [PASSWORD, EMAIL, USERNAME]);
  });

  test('a wrong password and an unknown account look the same to the caller', async () => {
    reset({ account: null });
    const unknown = await signIn();
    reset();
    const wrong = await signInWrong();
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(withoutRequestId(await bodyOf(unknown)), withoutRequestId(await bodyOf(wrong)));
    assert.deepEqual(unknown.headers.getSetCookie(), wrong.headers.getSetCookie());
  });

  test('a wrong password compares against the stored hash and records LOGIN_FAILED through the audit writer', async () => {
    reset();
    const res = await signInWrong();
    assert.equal(res.status, 401);
    assert.deepEqual(state.compares, [[WRONG_PASSWORD, STORED_HASH]]);
    const rows = audits();
    assert.equal(rows.length, 1);
    assert.deepEqual(
      pick(rows[0], AUDIT_KEYS),
      auditRow({ action: 'LOGIN_FAILED', result: 'failure', error: 'Password did not match.' }),
    );
    assertNoSecrets(JSON.stringify(rows), [WRONG_PASSWORD, PASSWORD, STORED_HASH]);
    assert.equal(state.signed.length, 0);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('failures are counted for this account over 30 minutes and 24 hours, after the new row is written', async () => {
    reset();
    const started = Date.now();
    await signInWrong();
    const insertAt = state.queries.findIndex((query) => query.table === 'audit_log' && query.op === 'insert');
    const counts = queriesOn('audit_log', 'select');
    assert.equal(counts.length, 2);
    for (const count of counts) {
      assert.ok(state.queries.indexOf(count) > insertAt);
      assert.equal(count.columns, 'id');
      assert.deepEqual(count.options, { count: 'exact', head: true });
      assert.deepEqual(count.filters.slice(0, 2), [['eq', 'admin_id', ADMIN_ID], ['eq', 'action', 'LOGIN_FAILED']]);
      assert.deepEqual(count.filters[2]?.slice(0, 2), ['gte', 'created_at']);
    }
    const windows = counts
      .map((count) => started - Date.parse(String(count.filters[2]?.[2])))
      .sort((a, b) => a - b);
    assert.ok(Math.abs(windows[0] - 30 * MINUTE_MS) < 5000, String(windows[0]));
    assert.ok(Math.abs(windows[1] - 24 * HOUR_MS) < 5000, String(windows[1]));
  });

  test('below both thresholds nothing else happens', async () => {
    reset({ recentFailures: 4, dailyFailures: 24 });
    const res = await signInWrong();
    assert.equal(res.status, 401);
    assert.equal(queriesOn('admin_alerts', 'insert').length, 0);
    assert.equal(queriesOn('admin_users', 'update').length, 0);
    assert.deepEqual(audits().map((row) => row.action), ['LOGIN_FAILED']);
  });

  test('five failures in 30 minutes raise the burst alert with the existing payload', async () => {
    reset({ recentFailures: 5, dailyFailures: 5 });
    const res = await signInWrong();
    assert.equal(res.status, 401);
    assert.equal((await bodyOf(res)).error, INVALID);
    assert.deepEqual(queriesOn('admin_alerts', 'insert').map((query) => query.payload), [{
      admin_id: ADMIN_ID,
      severity: 'high',
      event_type: 'admin_login_burst',
      subject: `Repeated failed admin logins for ${EMAIL}`,
      detail: { admin_id: ADMIN_ID, email: EMAIL, fail_count: 5, ip: CLIENT_IP },
    }]);
    assert.equal(queriesOn('admin_users', 'update').length, 0);
  });

  test('a refused or throwing alert insert never changes the answer, and the failure is logged', async () => {
    for (const alert of ['error', 'throw'] as const) {
      reset({ recentFailures: 7, alert });
      const res = await signInWrong();
      assert.equal(res.status, 401, alert);
      assert.equal((await bodyOf(res)).error, INVALID, alert);
      assert.ok(logs.some((line) => line.includes('burst alert')), alert);
      assertNoSecrets(logs.join('\n'), [WRONG_PASSWORD, PASSWORD]);
    }
  });

  test('25 failures in 24 hours deactivate the account and record ADMIN_AUTO_DEACTIVATED', async () => {
    reset({ recentFailures: 5, dailyFailures: 25 });
    const res = await signInWrong();
    assert.equal(res.status, 401);
    assert.equal((await bodyOf(res)).error, INVALID);
    const updates = queriesOn('admin_users', 'update');
    assert.deepEqual(updates.map((query) => [query.payload, query.filters]), [[{ is_active: false }, [['eq', 'id', ADMIN_ID]]]]);
    const alertAt = state.queries.findIndex((query) => query.table === 'admin_alerts');
    assert.ok(alertAt >= 0 && alertAt < state.queries.indexOf(updates[0]));
    const rows = audits();
    assert.deepEqual(rows.map((row) => row.action), ['LOGIN_FAILED', 'ADMIN_AUTO_DEACTIVATED']);
    assert.deepEqual(
      pick(rows[1], AUDIT_KEYS),
      auditRow({
        action: 'ADMIN_AUTO_DEACTIVATED',
        before_value: { is_active: true },
        after_value: { is_active: false },
        reason: '25 failed sign-ins in the last 24 hours.',
      }),
    );
  });

  test('a deactivation the database refuses is recorded as a failure, and the answer is unchanged', async () => {
    reset({ dailyFailures: 30, deactivateError: 'permission denied for table admin_users' });
    const res = await signInWrong();
    assert.equal(res.status, 401);
    assert.equal((await bodyOf(res)).error, INVALID);
    const deactivated = audits().find((row) => row.action === 'ADMIN_AUTO_DEACTIVATED');
    assert.equal(deactivated?.result, 'failure');
    assert.equal(deactivated?.error, 'permission denied for table admin_users');
  });
});

describe('POST /api/auth: successful sign-in', () => {
  test('the browser gets the 8-hour session cookie and the theme cookie, never the token in the body', async () => {
    reset();
    const res = await signIn();
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), { success: true, request_id: REQUEST_ID });
    assert.equal(res.headers.get('x-request-id'), REQUEST_ID);
    assert.deepEqual(state.signed, [[{
      admin_id: ADMIN_ID,
      role_title: ROLE,
      is_super_admin: false,
      page_permissions: ['withdrawals', 'card_queue'],
      username: USERNAME,
      token_version: 4,
    }, '8h']]);
    const cookies = cookiesOf(res);
    assert.deepEqual([...cookies.keys()].sort(), ['admin_theme', 'admin_token']);
    const session = cookies.get('admin_token');
    assert.equal(session?.value, ISSUED_TOKEN);
    assert.equal(session?.attributes.get('httponly'), true);
    assert.equal(session?.attributes.get('samesite'), 'strict');
    assert.equal(session?.attributes.get('max-age'), '28800');
    assert.equal(session?.attributes.get('path'), '/');
    assert.equal(session?.attributes.has('secure'), false);
    const themeCookie = cookies.get('admin_theme');
    assert.equal(themeCookie?.value, 'dark');
    assert.equal(themeCookie?.attributes.has('httponly'), false);
    assert.equal(themeCookie?.attributes.get('samesite'), 'lax');
    assert.equal(themeCookie?.attributes.get('max-age'), '31536000');
    assert.equal(themeCookie?.attributes.get('path'), '/');
    assert.equal(themeCookie?.attributes.has('secure'), false);
  });

  test('both cookies are Secure in production', async () => {
    reset();
    const res = await withNodeEnv('production', () => signIn());
    const cookies = cookiesOf(res);
    assert.equal(cookies.get('admin_token')?.attributes.get('secure'), true);
    assert.equal(cookies.get('admin_theme')?.attributes.get('secure'), true);
  });

  test('stamps last_login_at, then records LOGIN through the audit writer without the password or token', async () => {
    reset();
    const started = Date.now();
    await signIn();
    const stamps = queriesOn('admin_users', 'update');
    assert.equal(stamps.length, 1);
    const stampedAt = Date.parse(String((stamps[0].payload as Record<string, unknown>).last_login_at));
    assert.ok(stampedAt >= started - 1000 && stampedAt <= Date.now() + 1000);
    assert.deepEqual(stamps[0].filters, [['eq', 'id', ADMIN_ID]]);
    const rows = audits();
    assert.equal(rows.length, 1);
    assert.deepEqual(pick(rows[0], AUDIT_KEYS), auditRow({ action: 'LOGIN' }));
    const auditAt = state.queries.findIndex((query) => query.table === 'audit_log' && query.op === 'insert');
    assert.ok(state.queries.indexOf(stamps[0]) < auditAt);
    assertNoSecrets(JSON.stringify(rows), [PASSWORD, STORED_HASH, ISSUED_TOKEN]);
    assertNoSecrets(logs.join('\n'), [PASSWORD, ISSUED_TOKEN]);
  });

  test('the mobile client gets a 24-hour token and the profile in the body, and no cookies', async () => {
    reset();
    const res = await signIn(LOGIN_BODY, { 'x-client': 'mobile-admin' });
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), {
      success: true,
      request_id: REQUEST_ID,
      token: ISSUED_TOKEN,
      admin: {
        id: ADMIN_ID,
        username: USERNAME,
        email: EMAIL,
        role_title: ROLE,
        is_super_admin: false,
        page_permissions: ['withdrawals', 'card_queue'],
        theme_preference: 'dark',
      },
    });
    assert.equal(state.signed[0]?.[1], '24h');
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('the theme falls back to system, and missing permissions and token version to [] and 0', async () => {
    for (const preference of [null, 'blue', 'system']) {
      reset({ account: { ...ACCOUNT, theme_preference: preference, page_permissions: null, token_version: null } });
      const res = await signIn();
      assert.equal(cookiesOf(res).get('admin_theme')?.value, 'system', String(preference));
      assert.deepEqual(state.signed[0]?.[0], {
        admin_id: ADMIN_ID,
        role_title: ROLE,
        is_super_admin: false,
        page_permissions: [],
        username: USERNAME,
        token_version: 0,
      });
    }
    reset({ account: { ...ACCOUNT, theme_preference: 'light' } });
    const mobile = await bodyOf(await signIn(LOGIN_BODY, { 'x-client': 'mobile-admin' }));
    assert.equal((mobile.admin as Record<string, unknown>).theme_preference, 'light');
  });

  test('an audit write failure does not block the sign-in', async () => {
    reset({ auditError: AUDIT_DOWN });
    const res = await signIn();
    assert.equal(res.status, 200);
    assert.equal(cookiesOf(res).get('admin_token')?.value, ISSUED_TOKEN);
  });
});

describe('POST /api/auth/logout', () => {
  test('without a session cookie it still signs out: both cookies cleared, nothing revoked or recorded', async () => {
    reset();
    const res = await signOut();
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), { success: true, request_id: REQUEST_ID });
    assertSignedOutCookies(res);
    assert.equal(state.queries.length, 0);
    assert.deepEqual(state.verified, []);
  });

  test('an invalid or revoked session cookie is treated the same way', async () => {
    reset();
    const res = await signOut({ cookie: 'stale-cookie' });
    assert.equal(res.status, 200);
    assert.deepEqual(state.verified, ['stale-cookie']);
    assert.equal(state.queries.length, 0);
    assertSignedOutCookies(res);
  });

  test('a valid session bumps token_version by one, records LOGOUT and clears both cookies', async () => {
    reset({ tokenVersion: 4 });
    state.sessions[SESSION_COOKIE] = { ...SESSION };
    const res = await signOut({ cookie: SESSION_COOKIE });
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), { success: true, request_id: REQUEST_ID });
    assert.deepEqual(state.verified, [SESSION_COOKIE]);
    const reads = queriesOn('admin_users', 'select');
    assert.deepEqual(reads.map((query) => [query.columns, query.filters, query.terminal]), [
      ['token_version', [['eq', 'id', ADMIN_ID]], 'single'],
    ]);
    assert.deepEqual(queriesOn('admin_users', 'update').map((query) => [query.payload, query.filters]), [
      [{ token_version: 5 }, [['eq', 'id', ADMIN_ID]]],
    ]);
    const rows = audits();
    assert.equal(rows.length, 1);
    assert.deepEqual(pick(rows[0], AUDIT_KEYS), auditRow({ action: 'LOGOUT' }));
    assertNoSecrets(JSON.stringify(rows), [SESSION_COOKIE, FORWARDED_FOR]);
    assertSignedOutCookies(res);
  });

  test('a missing token version counts as 0', async () => {
    reset({ tokenVersion: null });
    state.sessions[SESSION_COOKIE] = { ...SESSION };
    await signOut({ cookie: SESSION_COOKIE });
    assert.deepEqual(queriesOn('admin_users', 'update').map((query) => query.payload), [{ token_version: 1 }]);
  });

  test('a revoke the database refuses still signs out and is recorded as partial', async () => {
    for (const patch of [{ tokenWriteError: 'update refused' }, { tokenReadError: 'read refused' }]) {
      reset(patch);
      state.sessions[SESSION_COOKIE] = { ...SESSION };
      const res = await signOut({ cookie: SESSION_COOKIE });
      assert.equal(res.status, 200);
      assertSignedOutCookies(res);
      const message = patch.tokenWriteError ?? patch.tokenReadError;
      assert.deepEqual(pick(audits()[0], AUDIT_KEYS), auditRow({ action: 'LOGOUT', result: 'partial', error: message }));
      assert.ok(logs.some((line) => line.includes(String(message))));
    }
  });

  test('a mobile bearer without the cookie revokes nothing, as before', async () => {
    reset();
    state.requestAdmin = { ...SESSION };
    const res = await signOut({ headers: { authorization: `Bearer ${SESSION_COOKIE}`, 'x-client': 'mobile-admin' } });
    assert.equal(res.status, 200);
    assert.equal(state.fromRequestCalls, 0);
    assert.deepEqual(state.verified, []);
    assert.equal(state.queries.length, 0);
    assertSignedOutCookies(res);
  });

  test('an audit write failure does not block sign-out', async () => {
    reset({ auditError: AUDIT_DOWN });
    state.sessions[SESSION_COOKIE] = { ...SESSION };
    const res = await signOut({ cookie: SESSION_COOKIE });
    assert.equal(res.status, 200);
    assertSignedOutCookies(res);
  });
});

describe('GET /api/auth/me', () => {
  test('no session is a 401 that keeps the error key, never a 403', async () => {
    reset();
    const res = await readProfile();
    assert.equal(res.status, 401);
    const body = await bodyOf(res);
    assert.equal(body.code, 'AUTH_REQUIRED');
    assert.equal(typeof body.error, 'string');
    assert.equal(body.request_id, REQUEST_ID);
    assert.equal(state.queries.length, 0);
  });

  test('returns exactly the six profile fields from a fresh read of the signed-in admin', async () => {
    reset({ profile: { ...PROFILE, page_permissions: ['withdrawals', 'users'] } });
    state.requestAdmin = { ...SESSION };
    const res = await readProfile();
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), {
      success: true,
      request_id: REQUEST_ID,
      admin: {
        id: ADMIN_ID,
        username: USERNAME,
        email: EMAIL,
        role_title: ROLE,
        is_super_admin: false,
        page_permissions: ['withdrawals', 'users'],
      },
    });
    const reads = queriesOn('admin_users', 'select');
    assert.deepEqual(reads.map((query) => [query.columns, query.filters, query.terminal]), [
      [PROFILE_COLUMNS, [['eq', 'id', ADMIN_ID]], 'maybeSingle'],
    ]);
  });

  test('missing permissions become an empty list', async () => {
    reset({ profile: { ...PROFILE, page_permissions: null } });
    state.requestAdmin = { ...SESSION };
    const body = await bodyOf(await readProfile());
    assert.deepEqual((body.admin as Record<string, unknown>).page_permissions, []);
  });

  test('a missing, deactivated or unreadable row is a 401', async () => {
    const cases: Array<Partial<Scenario>> = [
      { profile: null },
      { profile: { ...PROFILE, is_active: false } },
      { profileError: 'connection terminated' },
    ];
    for (const patch of cases) {
      reset(patch);
      state.requestAdmin = { ...SESSION };
      const res = await readProfile();
      assert.equal(res.status, 401, JSON.stringify(patch));
      assert.equal((await bodyOf(res)).code, 'AUTH_REQUIRED');
    }
  });
});

describe('PATCH /api/admin/theme', () => {
  test('no session is a 401 and nothing is written', async () => {
    reset();
    const res = await saveTheme({ body: { theme: 'dark' } });
    assert.equal(res.status, 401);
    const body = await bodyOf(res);
    assert.equal(body.code, 'AUTH_REQUIRED');
    assert.equal(typeof body.error, 'string');
    assert.equal(state.queries.length, 0);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('anything but light, dark or system is refused with the existing message', async () => {
    const cases: RequestOptions[] = [
      { body: {} },
      { body: { theme: 'blue' } },
      { body: { theme: '' } },
      { body: { theme: 'DARK' } },
      { raw: 'not json' },
      { raw: 'null' },
    ];
    for (const options of cases) {
      reset();
      state.requestAdmin = { ...SESSION };
      const res = await saveTheme(options);
      assert.equal(res.status, 400, JSON.stringify(options));
      assert.deepEqual(withoutRequestId(await bodyOf(res)), {
        success: false,
        error: BAD_THEME,
        code: 'VALIDATION_ERROR',
        message: BAD_THEME,
      });
      assert.equal(state.queries.length, 0);
    }
  });

  test('any signed-in admin saves their own theme, records UPDATE_ADMIN_THEME and gets the theme cookie', async () => {
    for (const value of ['light', 'dark', 'system']) {
      reset();
      state.requestAdmin = { ...SESSION, page_permissions: [], is_super_admin: false };
      const res = await saveTheme({ body: { theme: value } });
      assert.equal(res.status, 200, value);
      assert.deepEqual(await bodyOf(res), { success: true, request_id: REQUEST_ID, theme: value, audit_recorded: true });
      assert.deepEqual(queriesOn('admin_users', 'update').map((query) => [query.payload, query.filters]), [
        [{ theme_preference: value }, [['eq', 'id', ADMIN_ID]]],
      ]);
      assert.deepEqual(
        pick(audits()[0], AUDIT_KEYS),
        auditRow({ action: 'UPDATE_ADMIN_THEME', after_value: { theme: value } }),
      );
      const cookie = cookiesOf(res).get('admin_theme');
      assert.equal(cookie?.value, value);
      assert.equal(cookie?.attributes.has('httponly'), false);
      assert.equal(cookie?.attributes.get('samesite'), 'lax');
      assert.equal(cookie?.attributes.get('max-age'), '31536000');
      assert.equal(cookie?.attributes.get('path'), '/');
    }
  });

  test('a database error is a 500 with a generic message, recorded as a failure, and sets no cookie', async () => {
    reset({ themeError: 'permission denied for table admin_users' });
    state.requestAdmin = { ...SESSION };
    const res = await saveTheme({ body: { theme: 'dark' } });
    assert.equal(res.status, 500);
    const body = await bodyOf(res);
    assert.equal(body.code, 'INTERNAL_ERROR');
    assert.equal(typeof body.error, 'string');
    assert.ok(!String(body.error).includes('permission denied'));
    assert.deepEqual(
      pick(audits()[0], AUDIT_KEYS),
      auditRow({
        action: 'UPDATE_ADMIN_THEME',
        after_value: { theme: 'dark' },
        result: 'failure',
        error: 'permission denied for table admin_users',
      }),
    );
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('an audit write failure is reported additively and the theme is still saved', async () => {
    reset({ auditError: AUDIT_DOWN });
    state.requestAdmin = { ...SESSION };
    const res = await saveTheme({ body: { theme: 'system' } });
    assert.equal(res.status, 200);
    const body = await bodyOf(res);
    assert.equal(body.theme, 'system');
    assert.equal(body.audit_recorded, false);
    assert.equal(typeof body.warning, 'string');
    assert.equal(cookiesOf(res).get('admin_theme')?.value, 'system');
  });
});

describe('route sources', () => {
  const sources = Object.values(ROUTES).map((path) => [path, readFileSync(resolve(APP_DIR, path), 'utf8')] as const);
  const sourceOf = (path: string) => sources.find(([candidate]) => candidate === path)?.[1] ?? '';

  test('carry no prose comments, and neither does this test', () => {
    const files = [...sources, ['test/authRoutes.test.ts', readFileSync(TEST_FILE, 'utf8')] as const];
    for (const [path, source] of files) {
      assert.doesNotMatch(source, /\/\*/, path);
      assert.doesNotMatch(source, /(^|[^:])\/\/(?!\/)/m, path);
    }
  });

  test('every audit write goes through writeAudit with its existing action name, and responses use the envelope', () => {
    for (const [path, source] of sources) {
      assert.doesNotMatch(source, /from\('audit_log'\)\s*\.insert/, path);
      assert.doesNotMatch(source, /NextResponse\.json\(/, path);
      assert.doesNotMatch(source, /x-forwarded-for/i, path);
    }
    const expected: Array<[string, string[]]> = [
      [ROUTES.login, ['LOGIN', 'LOGIN_FAILED', 'ADMIN_AUTO_DEACTIVATED']],
      [ROUTES.logout, ['LOGOUT']],
      [ROUTES.theme, ['UPDATE_ADMIN_THEME']],
    ];
    for (const [path, actions] of expected) {
      const source = sourceOf(path);
      assert.match(source, /writeAudit\(/, path);
      for (const action of actions) assert.match(source, new RegExp(`action: '${action}'`), `${path} ${action}`);
    }
  });

  test('sign-in and sign-out need no session, me and theme take any signed-in admin, and nothing answers 403', () => {
    for (const path of [ROUTES.login, ROUTES.logout]) {
      assert.doesNotMatch(sourceOf(path), /require(Admin|AdminAny|AdminAll|SuperAdmin)\(/, path);
    }
    for (const path of [ROUTES.me, ROUTES.theme]) {
      assert.match(sourceOf(path), /requireAdmin\(\)/, path);
      assert.doesNotMatch(sourceOf(path), /requireAdmin\(['"]|requireAdminAny|requireAdminAll|requireSuperAdmin/, path);
    }
    for (const [path, source] of sources) assert.doesNotMatch(source, /PERMISSION_DENIED|status: 403/, path);
  });
});
