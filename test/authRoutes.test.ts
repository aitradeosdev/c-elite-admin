import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { twoStepLockedMessage } from '../app/lib/http.ts';

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
const OTHER_ADMIN_ID = '3c9d1f7a-8b2e-4d6c-9a1f-0e4b7c2d5a83';
const SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
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
const MFA_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const SEALED = 'oKGio6Slpqeoqaqr1ypPGXD9NYdbVbbhNE716EeUYCCow3tgg0VFxid5ZNE596De';
const LOCKED_UNTIL = '2026-10-13T14:05:00+00:00';
const HOUR_MS = 60 * 60 * 1000;
const LOGIN_COLUMNS =
  'id, username, email, password_hash, role_title, is_super_admin, is_active, page_permissions, theme_preference, token_version';
const PROFILE_COLUMNS =
  'id, username, email, role_title, is_super_admin, is_active, page_permissions, last_login_at, created_at';
const MISSING_FIELDS = 'Email, username and password required';
const TOO_MANY = 'Too many attempts. Try again later.';
const INVALID = 'Invalid credentials';
const SIGN_IN_UNAVAILABLE = 'Sign-in is unavailable right now. Try again shortly.';
const TWO_STEP_UNAVAILABLE = 'Two-step sign-in is unavailable right now. Try again later.';
const SESSION_UNAVAILABLE = 'Your session could not be checked. Try again.';
const BAD_THEME = 'theme must be light | dark | system';
const AUDIT_DOWN = 'audit store unavailable';

const AUDIT_KEYS = [
  'admin_id', 'user_id', 'action', 'entity', 'entity_id', 'before_value', 'after_value', 'ip_address',
  'admin_role', 'user_agent', 'request_id', 'reason', 'result', 'error', 'sensitivity',
] as const;

interface AccountRow {
  id: string;
  username: string;
  email: string;
  password_hash: string | null;
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
  last_login_at: string | null;
  created_at: string | null;
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

type Reply = DbResult | 'throw';

type Filter = [kind: string, column: string, value: unknown];

interface Query {
  table: string;
  op: 'select' | 'insert' | 'update' | null;
  columns: string | null;
  payload: unknown;
  filters: Filter[];
  terminal: 'single' | 'maybeSingle' | null;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface Scenario {
  limits: Record<string, Reply>;
  account: AccountRow | null;
  lookupError: DbError | null;
  failureRecord: Reply;
  open: Reply;
  mfa: Reply;
  challenge: Reply;
  revoke: Reply;
  auditError: string | null;
  signError: string | null;
  compareError: string | null;
  profile: ProfileRow | null;
  profileError: string | null;
  themeError: string | null;
}

interface StubState {
  hashes: Array<[unknown, unknown]>;
  scenario: Scenario;
  queries: Query[];
  rpcs: RpcCall[];
  timeline: string[];
  compares: Array<[unknown, unknown]>;
  signed: unknown[][];
  verified: unknown[][];
  fromRequestCalls: number;
  checks: Record<string, unknown>;
  requestAdmin: SessionClaims | null;
  issuedToken: string;
  headers: Headers;
  cookies: Map<string, string>;
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
  last_login_at: '2026-10-11T08:15:00.000Z',
  created_at: '2026-01-02T09:00:00.000Z',
};

const LOGIN_BODY = { email: EMAIL, username: USERNAME, password: PASSWORD };

let expiresAt = '';
let expiresEpoch = 0;

function opened(patch: Record<string, unknown> = {}): Reply {
  return {
    data: {
      ok: true,
      session_id: SID,
      token_version: 4,
      auth_methods: ['pwd'],
      expires_at: expiresAt,
      expires_at_epoch: expiresEpoch,
      ...patch,
    },
  };
}

function activeFactor(patch: Record<string, unknown> = {}): Reply {
  return {
    data: {
      status: 'active',
      secret_enc: SEALED,
      key_version: 1,
      created_at: '2026-10-01T09:00:00+00:00',
      confirmed_at: '2026-10-01T09:01:00+00:00',
      last_used_step: 59061240,
      last_used_at: '2026-10-12T09:00:00+00:00',
      locked_until: null,
      recovery_codes_left: 9,
      ...patch,
    },
  };
}

function baseScenario(): Scenario {
  return {
    limits: {},
    account: { ...ACCOUNT },
    lookupError: null,
    failureRecord: { data: { recorded: true, failures_30m: 1, failures_24h: 1, burst_alerted: false, deactivated: false } },
    open: opened(),
    mfa: activeFactor(),
    challenge: { data: { ok: true, challenge_id: '5d6e7f80-9a1b-4c2d-8e3f-405162738495' } },
    revoke: { data: { revoked: true, client: 'web', push_tokens_released: 0 } },
    auditError: null,
    signError: null,
    compareError: null,
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
  timeline: [],
  compares: [],
  signed: [],
  verified: [],
  fromRequestCalls: 0,
  checks: {},
  requestAdmin: null,
  issuedToken: ISSUED_TOKEN,
  headers: new Headers(),
  cookies: new Map(),
  matches: (value, hash) => value === PASSWORD && hash === STORED_HASH,
  db: {
    from: (table) => chain(table),
    rpc: (name, args) => rpc(name, args),
  },
};

Reflect.set(globalThis, STATE_KEY, state);

function fault(message: string | null): DbError | null {
  return message ? { message } : null;
}

function respond(query: Query): DbResult {
  const s = state.scenario;
  const payload = (query.payload ?? {}) as Record<string, unknown>;
  if (query.table === 'audit_log' && query.op === 'insert') return { error: fault(s.auditError) };
  if (query.table === 'admin_users' && query.op === 'select' && query.terminal === 'single') {
    if (s.lookupError) return { error: s.lookupError };
    if (s.account) return { data: s.account };
    return { error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
  }
  if (query.table === 'admin_users' && query.op === 'select' && query.terminal === 'maybeSingle') {
    return s.profileError ? { error: fault(s.profileError) } : { data: s.profile };
  }
  if (query.table === 'admin_users' && query.op === 'update' && 'theme_preference' in payload) {
    return { error: fault(s.themeError) };
  }
  throw new Error(`unexpected query ${JSON.stringify(query)}`);
}

function chain(table: string): object {
  const query: Query = { table, op: null, columns: null, payload: undefined, filters: [], terminal: null };
  state.queries.push(query);
  const settle = () => Promise.resolve().then(() => {
    state.timeline.push(`${query.table}:${query.op}`);
    return { data: null, error: null, count: null, ...respond(query) };
  });
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
  });
  return builder;
}

function settleReply(reply: Reply): Promise<DbResult> {
  if (reply === 'throw') return Promise.reject(new Error('fetch failed'));
  return Promise.resolve({ data: null, error: null, ...reply });
}

function rpc(name: string, args: Record<string, unknown>): Promise<DbResult> {
  state.rpcs.push({ name, args });
  state.timeline.push(`rpc:${name}`);
  const s = state.scenario;
  if (name === 'check_rate_limit_by_key') return settleReply(s.limits[String(args.p_action)] ?? { data: true });
  if (name === 'admin_record_login_failure') return settleReply(s.failureRecord);
  if (name === 'admin_session_open') return settleReply(s.open);
  if (name === 'admin_mfa_get') return settleReply(s.mfa);
  if (name === 'admin_challenge_create') return settleReply(s.challenge);
  if (name === 'admin_session_revoke') return settleReply(s.revoke);
  return Promise.reject(new Error(`unexpected rpc ${name}`));
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
    'export async function cookies() {',
    '  return { get: (name) => (state().cookies.has(name) ? { name, value: state().cookies.get(name) } : undefined) };',
    '}',
  ]),
  bcryptjs: stub([
    'export default {',
    '  hashSync(value, rounds) { state().hashes.push([value, rounds]); return "dummy-hash:" + value + ":" + rounds; },',
    '  async compare(value, hash) {',
    '    state().compares.push([value, hash]);',
    '    if (state().scenario.compareError) throw new Error(state().scenario.compareError);',
    '    return state().matches(value, hash);',
    '  },',
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
    'export async function signSessionToken(admin, sid, amr, epoch) {',
    '  state().signed.push([admin, sid, amr, epoch]);',
    '  if (state().scenario.signError) throw new Error(state().scenario.signError);',
    '  return state().issuedToken;',
    '}',
    'export async function verifyAdminSession(token, transport) {',
    '  state().verified.push([token, transport]);',
    '  return Object.prototype.hasOwnProperty.call(state().checks, token) ? state().checks[token] : { status: "invalid" };',
    '}',
    'export async function verifyAdminFromRequest() { state().fromRequestCalls += 1; return state().requestAdmin; }',
  ]),
  [resolve(APP_DIR, 'lib', 'mfa.ts')]: pathToFileURL(resolve(APP_DIR, 'lib', 'mfa.ts')).href,
  [resolve(APP_DIR, 'lib', 'qr.ts')]: pathToFileURL(resolve(APP_DIR, 'lib', 'qr.ts')).href,
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
  const expires = Math.floor((Date.now() + 8 * HOUR_MS) / 1000);
  expiresEpoch = expires;
  expiresAt = new Date(expires * 1000).toISOString();
  state.scenario = { ...baseScenario(), ...patch };
  state.queries = [];
  state.rpcs = [];
  state.timeline = [];
  state.compares = [];
  state.signed = [];
  state.verified = [];
  state.fromRequestCalls = 0;
  state.checks = {};
  state.requestAdmin = null;
  state.headers = new Headers();
  state.cookies = new Map();
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
  state.cookies = new Map(cookie === undefined ? [] : [['admin_token', cookie]]);
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

function callsTo(name: string): Array<Record<string, unknown>> {
  return state.rpcs.filter((call) => call.name === name).map((call) => call.args);
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
  Reflect.set(process.env, 'ADMIN_MFA_ENCRYPTION_KEY', MFA_KEY);
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

function assertNoSession(res: Response): void {
  assert.deepEqual(res.headers.getSetCookie(), []);
  assert.deepEqual(state.signed, []);
  assert.ok(!audits().some((row) => row.action === 'LOGIN'));
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
    reset({ limits: { admin_login: { data: false } } });
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

  test('the per-account limit keys on the lower-cased username and email, shared with the mobile app', async () => {
    reset({ limits: { admin_login_account: { data: false } } });
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

  test('padding the email cannot dodge the per-account limit: the key uses the same trimmed, lower-cased email as the lookup', async () => {
    for (const padded of [` ${EMAIL}`, `${EMAIL} `, `\t${EMAIL.toUpperCase()}  `]) {
      reset({ limits: { admin_login_account: { data: false } } });
      const res = await signIn({ ...LOGIN_BODY, email: padded });
      assert.equal(res.status, 429, JSON.stringify(padded));
      assert.equal(state.rpcs[1]?.args.p_key, 'admin:ops.lead|ops@cardelite.test', JSON.stringify(padded));
      assert.equal(state.queries.length, 0);
    }
  });

  test('both limits answer identically, so neither reveals which one tripped', async () => {
    reset({ limits: { admin_login: { data: false } } });
    const byIp = withoutRequestId(await bodyOf(await signIn()));
    reset({ limits: { admin_login_account: { data: false } } });
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
      reset({ limits: { admin_login: { data: false } } });
      await signIn(LOGIN_BODY, headers);
      assert.equal(state.rpcs[0]?.args.p_key, ip);
    }
  });

  test('a limit that cannot be checked now fails closed: a concurrent first write is 429, anything else is 500', async () => {
    const cases: Array<[Reply, number, string]> = [
      [{ error: { message: 'duplicate key value violates unique constraint "anon_rate_limits_pkey"', code: '23505' } }, 429, TOO_MANY],
      [{ data: null }, 429, TOO_MANY],
      [{ error: { message: 'rate limit store unavailable' } }, 500, SIGN_IN_UNAVAILABLE],
      ['throw', 500, SIGN_IN_UNAVAILABLE],
    ];
    for (const action of ['admin_login', 'admin_login_account']) {
      for (const [reply, status, message] of cases) {
        reset({ limits: { [action]: reply } });
        const res = await signIn();
        assert.equal(res.status, status, `${action} ${JSON.stringify(reply)}`);
        assert.equal((await bodyOf(res)).error, message);
        assert.equal(state.queries.length, 0);
        assert.equal(state.compares.length, 0);
        assertNoSecrets(logs.join('\n'), [PASSWORD, EMAIL, USERNAME]);
      }
    }
  });
});

describe('POST /api/auth: credentials', () => {
  test('the account is looked up by the username as sent, the trimmed lower-cased email, the active flag and not deleted', async () => {
    for (const typed of [EMAIL, `  ${EMAIL.toUpperCase()} `]) {
      reset({ account: null });
      await signIn({ ...LOGIN_BODY, email: typed });
      const lookups = queriesOn('admin_users', 'select');
      assert.equal(lookups.length, 1, typed);
      assert.equal(lookups[0].columns, LOGIN_COLUMNS);
      assert.deepEqual(lookups[0].filters, [
        ['eq', 'username', USERNAME], ['eq', 'email', 'ops@cardelite.test'], ['eq', 'is_active', true], ['is', 'deleted_at', null],
      ], typed);
      assert.equal(lookups[0].terminal, 'single');
    }
  });

  test('an unknown account still runs one bcrypt compare against the dummy hash and records nothing', async () => {
    reset({ account: null });
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
    assert.deepEqual(state.rpcs.map((call) => call.name), ['check_rate_limit_by_key', 'check_rate_limit_by_key']);
    assert.deepEqual(audits(), []);
    assertNoSession(res);
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

  test('a lookup error is a 500, logged without credentials, never a password check', async () => {
    reset({ lookupError: { message: 'connection terminated', code: '08006' } });
    const res = await signIn();
    assert.equal(res.status, 500);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), {
      success: false, error: SIGN_IN_UNAVAILABLE, code: 'INTERNAL_ERROR', message: SIGN_IN_UNAVAILABLE,
    });
    assert.deepEqual(state.compares, []);
    assert.deepEqual(audits(), []);
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

  test('a wrong password is recorded once through admin_record_login_failure, which owns the burst alert and the lock', async () => {
    const res = await signInWrong();
    assert.equal(res.status, 401);
    assert.equal((await bodyOf(res)).error, INVALID);
    assert.deepEqual(state.compares, [[WRONG_PASSWORD, STORED_HASH]]);
    assert.deepEqual(callsTo('admin_record_login_failure'), [{
      p_admin_id: ADMIN_ID, p_client: 'web', p_ip: CLIENT_IP, p_user_agent: USER_AGENT, p_request_id: REQUEST_ID,
    }]);
    assert.deepEqual(audits(), []);
    assert.deepEqual(callsTo('admin_session_open'), []);
    assert.deepEqual(queriesOn('admin_users', 'update'), []);
    assertNoSession(res);
    assertNoSecrets(JSON.stringify(state.rpcs), [WRONG_PASSWORD, PASSWORD, STORED_HASH]);
  });

  test('a missing or empty stored hash runs the dummy compare and is recorded as a failed sign-in', async () => {
    for (const hash of [null, '']) {
      reset({ account: { ...ACCOUNT, password_hash: hash } });
      const res = await signIn();
      assert.equal(res.status, 401, String(hash));
      assert.equal((await bodyOf(res)).error, INVALID);
      assert.deepEqual(state.compares, [[PASSWORD, DUMMY_HASH]]);
      assert.equal(callsTo('admin_record_login_failure').length, 1);
      assertNoSession(res);
    }
  });

  test('a stored hash bcrypt cannot read counts as a wrong password, and is logged without the password', async () => {
    reset({ compareError: 'Invalid salt version: xx' });
    const res = await signIn();
    assert.equal(res.status, 401);
    assert.equal(callsTo('admin_record_login_failure').length, 1);
    assert.ok(logs.some((line) => line.includes('Invalid salt version')));
    assertNoSecrets(logs.join('\n'), [PASSWORD]);
  });

  test('a failure record that is refused or never arrives is logged and the answer stays the same', async () => {
    for (const failureRecord of [{ error: { message: 'Invalid session client' } }, 'throw'] as Reply[]) {
      reset({ failureRecord });
      const res = await signInWrong();
      assert.equal(res.status, 401);
      assert.equal((await bodyOf(res)).error, INVALID);
      assert.ok(logs.some((line) => line.includes('admin sign-in failure record failed')));
      assertNoSecrets(logs.join('\n'), [WRONG_PASSWORD, PASSWORD, EMAIL]);
    }
  });
});

describe('POST /api/auth: signing in without two-step sign-in', () => {
  test('opens one 8-hour web session and gets the cookie, never the token in the body', async () => {
    const res = await signIn();
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), { success: true, request_id: REQUEST_ID, step: 'done' });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(callsTo('admin_session_open'), [{
      p_admin_id: ADMIN_ID,
      p_client: 'web',
      p_auth_methods: ['pwd'],
      p_ttl_seconds: 28800,
      p_expected_token_version: 4,
      p_ip: CLIENT_IP,
      p_user_agent: USER_AGENT,
    }]);
    assert.deepEqual(state.signed, [[{
      id: ADMIN_ID,
      username: USERNAME,
      role_title: ROLE,
      is_super_admin: false,
      page_permissions: ['withdrawals', 'card_queue'],
      token_version: 4,
    }, SID, ['pwd'], expiresEpoch]]);
    const cookies = cookiesOf(res);
    assert.deepEqual([...cookies.keys()].sort(), ['admin_theme', 'admin_token']);
    const session = cookies.get('admin_token');
    assert.equal(session?.value, ISSUED_TOKEN);
    assert.equal(session?.attributes.get('httponly'), true);
    assert.equal(session?.attributes.get('samesite'), 'strict');
    assert.equal(session?.attributes.get('path'), '/');
    assert.equal(session?.attributes.has('secure'), false);
    const maxAge = Number(session?.attributes.get('max-age'));
    assert.ok(maxAge >= 28798 && maxAge <= 28800, String(maxAge));
    const themeCookie = cookies.get('admin_theme');
    assert.equal(themeCookie?.value, 'dark');
    assert.equal(themeCookie?.attributes.has('httponly'), false);
    assert.equal(themeCookie?.attributes.get('samesite'), 'lax');
    assert.equal(themeCookie?.attributes.get('max-age'), '31536000');
    assert.equal(themeCookie?.attributes.get('path'), '/');
  });

  test('both cookies are Secure in production', async () => {
    const res = await withNodeEnv('production', () => signIn());
    const cookies = cookiesOf(res);
    assert.equal(cookies.get('admin_token')?.attributes.get('secure'), true);
    assert.equal(cookies.get('admin_theme')?.attributes.get('secure'), true);
  });

  test('records LOGIN with the client, methods and session, and leaves last_login_at to the database', async () => {
    await signIn();
    assert.deepEqual(queriesOn('admin_users', 'update'), []);
    const rows = audits();
    assert.equal(rows.length, 1);
    assert.deepEqual(pick(rows[0], AUDIT_KEYS), auditRow({
      action: 'LOGIN',
      after_value: { client: 'web', amr: ['pwd'], session_id: SID },
    }));
    assert.ok(state.timeline.indexOf('rpc:admin_session_open') < state.timeline.indexOf('audit_log:insert'));
    assertNoSecrets(JSON.stringify(rows), [PASSWORD, STORED_HASH, ISSUED_TOKEN]);
    assertNoSecrets(logs.join('\n'), [PASSWORD, ISSUED_TOKEN]);
  });

  test('an unknown client address is stored as no address on the session', async () => {
    await signIn(LOGIN_BODY, { 'x-forwarded-for': null });
    assert.equal(callsTo('admin_session_open')[0]?.p_ip, null);
    assert.equal(audits()[0]?.ip_address, 'unknown');
  });

  test('a request carrying the mobile header still gets the cookie flow and never a token in the body', async () => {
    const res = await signIn(LOGIN_BODY, { 'x-client': 'mobile-admin' });
    assert.equal(res.status, 200);
    const body = await bodyOf(res);
    assert.deepEqual(body, { success: true, request_id: REQUEST_ID, step: 'done' });
    assert.ok(!('token' in body) && !('admin' in body));
    assert.equal(callsTo('admin_session_open')[0]?.p_client, 'web');
    assert.equal(callsTo('admin_session_open')[0]?.p_ttl_seconds, 28800);
    assert.equal(cookiesOf(res).get('admin_token')?.value, ISSUED_TOKEN);
  });

  test('the theme falls back to system, and missing permissions and token version to [] and 0', async () => {
    for (const preference of [null, 'blue', 'system']) {
      reset({ account: { ...ACCOUNT, theme_preference: preference, page_permissions: null, token_version: null } });
      const res = await signIn();
      assert.equal(cookiesOf(res).get('admin_theme')?.value, 'system', String(preference));
      assert.equal(callsTo('admin_session_open')[0]?.p_expected_token_version, 0);
      assert.deepEqual((state.signed[0]?.[0] as Record<string, unknown>).page_permissions, []);
    }
  });

  test('a token that cannot be signed ends the new session and answers 500 with no cookie', async () => {
    reset({ signError: 'Zero-length key is not supported' });
    const res = await signIn();
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, SIGN_IN_UNAVAILABLE);
    assert.deepEqual(callsTo('admin_session_revoke'), [{
      p_admin_id: ADMIN_ID, p_sid: SID, p_actor: ADMIN_ID, p_reason: 'sign_in_incomplete',
    }]);
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.deepEqual(audits(), []);
    assert.ok(logs.some((line) => line.includes('Zero-length key is not supported')));
  });

  test('a session store that fails or answers nonsense is a 500, never a 401', async () => {
    for (const open of [{ error: { message: 'Could not find the function public.admin_session_open', code: 'PGRST202' } }, 'throw', { data: null }, opened({ session_id: 'nope' }), opened({ expires_at_epoch: null })] as Reply[]) {
      reset({ open });
      const res = await signIn();
      assert.equal(res.status, 500, JSON.stringify(open));
      assert.equal((await bodyOf(res)).error, SIGN_IN_UNAVAILABLE);
      assertNoSession(res);
    }
  });

  test('a session the database refuses for a deactivated admin or a changed version is an ordinary 401', async () => {
    for (const reason of ['admin_inactive', 'token_version_changed', 'something_new']) {
      reset({ open: { data: { ok: false, reason } } });
      const res = await signIn();
      assert.equal(res.status, 401, reason);
      assert.equal((await bodyOf(res)).error, INVALID);
      assert.deepEqual(callsTo('admin_mfa_get'), []);
      assertNoSession(res);
    }
  });

  test('an audit write failure does not block the sign-in', async () => {
    reset({ auditError: AUDIT_DOWN });
    const res = await signIn();
    assert.equal(res.status, 200);
    assert.equal(cookiesOf(res).get('admin_token')?.value, ISSUED_TOKEN);
  });
});

describe('POST /api/auth: admins with two-step sign-in', () => {
  function needsCode(patch: Partial<Scenario> = {}): Partial<Scenario> {
    return { open: { data: { ok: false, reason: 'mfa_required' } }, ...patch };
  }

  test('a right password opens no session; it starts a five-minute code step bound to an httpOnly cookie', async () => {
    reset(needsCode());
    const res = await signIn();
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), {
      success: true, request_id: REQUEST_ID, step: 'mfa', methods: ['otp', 'recovery'], username: USERNAME,
    });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(callsTo('admin_mfa_get'), [{ p_admin_id: ADMIN_ID }]);
    const cookies = cookiesOf(res);
    assert.deepEqual([...cookies.keys()], ['admin_mfa_challenge']);
    const challenge = cookies.get('admin_mfa_challenge');
    assert.match(challenge?.value ?? '', /^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge?.attributes.get('path'), '/api/auth');
    assert.equal(challenge?.attributes.get('max-age'), '300');
    assert.equal(challenge?.attributes.get('httponly'), true);
    assert.equal(challenge?.attributes.get('samesite'), 'strict');
    assert.deepEqual(callsTo('admin_challenge_create'), [{
      p_admin_id: ADMIN_ID,
      p_purpose: 'mfa_verify',
      p_token_hash: sha256(challenge?.value ?? ''),
      p_ip: CLIENT_IP,
      p_user_agent: USER_AGENT,
    }]);
    assert.deepEqual(state.signed, []);
    assert.deepEqual(audits(), []);
    assertNoSecrets(JSON.stringify(state.rpcs), [challenge?.value ?? 'missing']);
  });

  test('the step cookie is Secure in production', async () => {
    reset(needsCode());
    const res = await withNodeEnv('production', () => signIn());
    assert.equal(cookiesOf(res).get('admin_mfa_challenge')?.attributes.get('secure'), true);
  });

  test('while two-step sign-in is locked the answer says until when, nothing is counted and no step starts', async () => {
    reset(needsCode({ mfa: activeFactor({ locked_until: LOCKED_UNTIL }) }));
    const res = await signIn();
    assert.equal(res.status, 429);
    const body = await bodyOf(res);
    assert.equal(body.code, 'RATE_LIMITED');
    assert.equal(body.error, twoStepLockedMessage(LOCKED_UNTIL));
    assert.match(String(body.error), /^Too many wrong codes\. Two-step sign-in is locked until .+ WAT\. Your super administrators have been alerted\.$/);
    assert.deepEqual(body.details, { reason: 'mfa_locked', locked_until: LOCKED_UNTIL });
    assert.deepEqual(callsTo('admin_challenge_create'), []);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.deepEqual(pick(audits()[0], AUDIT_KEYS), auditRow({
      action: 'MFA_CHALLENGE_FAILED', result: 'failure', error: 'Two-step sign-in is locked.', after_value: { client: 'web' },
    }));
  });

  test('without the encryption key the step fails closed with a 500, and never falls back to the password', async () => {
    reset(needsCode());
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    const res = await signIn();
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, TWO_STEP_UNAVAILABLE);
    assert.deepEqual(callsTo('admin_challenge_create'), []);
    assertNoSession(res);
    assert.ok(logs.some((line) => line.includes('the encryption key is not configured')));
  });

  test('a two-step store or step store that fails is a 500, and a refused step is a 401', async () => {
    const cases: Array<[Partial<Scenario>, number]> = [
      [needsCode({ mfa: { error: { message: 'connection terminated' } } }), 500],
      [needsCode({ mfa: 'throw' }), 500],
      [needsCode({ challenge: { error: { message: 'Invalid challenge token' } } }), 500],
      [needsCode({ challenge: { data: { ok: false, reason: 'mfa_not_active' } } }), 401],
      [needsCode({ mfa: { data: { status: 'none' } } }), 401],
    ];
    for (const [patch, status] of cases) {
      reset(patch);
      const res = await signIn();
      assert.equal(res.status, status, JSON.stringify(patch));
      assert.equal((await bodyOf(res)).error, status === 500 ? SIGN_IN_UNAVAILABLE : INVALID);
      assertNoSession(res);
    }
  });

  test('a wrong password for an enrolled admin is the same 401 as for anyone, and starts no step', async () => {
    reset(needsCode());
    const res = await signInWrong();
    assert.equal(res.status, 401);
    assert.deepEqual(callsTo('admin_session_open'), []);
    assert.deepEqual(callsTo('admin_mfa_get'), []);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });
});

describe('POST /api/auth: two-step sign-in required but not set up', () => {
  const required: Partial<Scenario> = { open: { data: { ok: false, reason: 'mfa_enrolment_required' } } };

  test('a right password starts a setup step instead of a session', async () => {
    reset(required);
    const res = await signIn();
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), { success: true, request_id: REQUEST_ID, step: 'enroll', username: USERNAME });
    const challenge = cookiesOf(res).get('admin_mfa_challenge');
    assert.equal(challenge?.attributes.get('path'), '/api/auth');
    assert.deepEqual(callsTo('admin_challenge_create'), [{
      p_admin_id: ADMIN_ID,
      p_purpose: 'mfa_enroll',
      p_token_hash: sha256(challenge?.value ?? ''),
      p_ip: CLIENT_IP,
      p_user_agent: USER_AGENT,
    }]);
    assert.deepEqual(callsTo('admin_mfa_get'), []);
    assert.deepEqual(state.signed, []);
  });

  test('without the encryption key setup cannot start, so sign-in fails closed', async () => {
    reset(required);
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    const res = await signIn();
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, TWO_STEP_UNAVAILABLE);
    assert.deepEqual(callsTo('admin_challenge_create'), []);
    assertNoSession(res);
  });
});

describe('POST /api/auth/logout', () => {
  function liveSession(adminId = ADMIN_ID, role = ROLE): unknown {
    return {
      status: 'ok',
      claims: { ...SESSION, admin_id: adminId, role_title: role, sid: SID, amr: ['pwd'] },
      session: {
        id: SID, client: 'web', amr: ['pwd'], createdAt: '2026-10-13T08:00:00Z', expiresAt: '2026-10-13T16:00:00Z',
        reauthAt: null, transport: 'cookie',
      },
      mfa: { status: 'none', lockedUntil: null },
      policy: { mode: 'off', graceEndsAt: null, requiredNow: false },
    };
  }

  test('without a session cookie it still signs out: both cookies cleared, nothing checked, revoked or recorded', async () => {
    const res = await signOut();
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), { success: true, request_id: REQUEST_ID });
    assertSignedOutCookies(res);
    assert.equal(state.queries.length, 0);
    assert.deepEqual(state.rpcs, []);
    assert.deepEqual(state.verified, []);
  });

  test('an invalid cookie, or one that cannot be checked right now, is cleared without revoking anything', async () => {
    for (const check of [undefined, { status: 'invalid' }, { status: 'unavailable' }]) {
      reset();
      if (check) state.checks['stale-cookie'] = check;
      const res = await signOut({ cookie: 'stale-cookie' });
      assert.equal(res.status, 200);
      assert.deepEqual(state.verified, [['stale-cookie', 'cookie']]);
      assert.equal(state.queries.length, 0);
      assert.deepEqual(state.rpcs, []);
      assertSignedOutCookies(res);
    }
  });

  test('a session with an id signs out this device only: one revoke, no version bump, LOGOUT for this device', async () => {
    state.checks[SESSION_COOKIE] = liveSession();
    const res = await signOut({ cookie: SESSION_COOKIE });
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), { success: true, request_id: REQUEST_ID });
    assert.deepEqual(state.verified, [[SESSION_COOKIE, 'cookie']]);
    assert.deepEqual(state.rpcs, [{
      name: 'admin_session_revoke', args: { p_admin_id: ADMIN_ID, p_sid: SID, p_actor: ADMIN_ID, p_reason: 'logout' },
    }]);
    assert.deepEqual(callsTo('admin_bump_token_version'), []);
    const rows = audits();
    assert.equal(rows.length, 1);
    assert.deepEqual(pick(rows[0], AUDIT_KEYS), auditRow({
      action: 'LOGOUT', after_value: { scope: 'this_device', session_id: SID },
    }));
    assertNoSecrets(JSON.stringify(rows), [SESSION_COOKIE, FORWARDED_FOR]);
    assertNoSecrets(JSON.stringify(state.rpcs), [SESSION_COOKIE]);
    assertSignedOutCookies(res);
  });

  test('the revoke targets the admin the cookie verifies as, and the audit names that admin', async () => {
    state.checks[SESSION_COOKIE] = liveSession(OTHER_ADMIN_ID, 'Payout Officer');
    await signOut({ cookie: SESSION_COOKIE });
    assert.deepEqual(callsTo('admin_session_revoke'), [{
      p_admin_id: OTHER_ADMIN_ID, p_sid: SID, p_actor: OTHER_ADMIN_ID, p_reason: 'logout',
    }]);
    assert.deepEqual(
      pick(audits()[0], AUDIT_KEYS),
      auditRow({
        action: 'LOGOUT', admin_id: OTHER_ADMIN_ID, entity_id: OTHER_ADMIN_ID, admin_role: 'Payout Officer',
        after_value: { scope: 'this_device', session_id: SID },
      }),
    );
  });

  test('a revoke the database refuses, or that never arrives, still signs out and is recorded as partial', async () => {
    const cases: Array<[Partial<Scenario>, string]> = [
      [{ revoke: { error: { message: 'Not authorized', code: 'P0001' } } }, 'Not authorized'],
      [{ revoke: 'throw' }, 'fetch failed'],
    ];
    for (const [patch, message] of cases) {
      reset(patch);
      state.checks[SESSION_COOKIE] = liveSession();
      const res = await signOut({ cookie: SESSION_COOKIE });
      assert.equal(res.status, 200, message);
      assert.deepEqual(await bodyOf(res), { success: true, request_id: REQUEST_ID }, message);
      assertSignedOutCookies(res);
      assert.equal(audits().length, 1, message);
      assert.equal(audits()[0].result, 'partial', message);
      assert.equal(audits()[0].error, message, message);
      assert.ok(logs.some((line) => line.includes(message)), message);
    }
  });

  test('a mobile bearer without the cookie revokes nothing, as before', async () => {
    state.requestAdmin = { ...SESSION };
    const res = await signOut({ headers: { authorization: `Bearer ${SESSION_COOKIE}`, 'x-client': 'mobile-admin' } });
    assert.equal(res.status, 200);
    assert.equal(state.fromRequestCalls, 0);
    assert.deepEqual(state.verified, []);
    assert.equal(state.queries.length, 0);
    assert.deepEqual(state.rpcs, []);
    assertSignedOutCookies(res);
  });

  test('an audit write failure does not block sign-out', async () => {
    reset({ auditError: AUDIT_DOWN });
    state.checks[SESSION_COOKIE] = liveSession();
    const res = await signOut({ cookie: SESSION_COOKIE });
    assert.equal(res.status, 200);
    assertSignedOutCookies(res);
  });
});

describe('GET /api/auth/me', () => {
  test('no session is a 401 that keeps the error key, never a 403', async () => {
    const res = await readProfile();
    assert.equal(res.status, 401);
    const body = await bodyOf(res);
    assert.equal(body.code, 'AUTH_REQUIRED');
    assert.equal(typeof body.error, 'string');
    assert.equal(body.request_id, REQUEST_ID);
    assert.equal(state.queries.length, 0);
  });

  test('returns the six original profile fields plus the sign-in and creation times, from a fresh read', async () => {
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
        last_login_at: '2026-10-11T08:15:00.000Z',
        created_at: '2026-01-02T09:00:00.000Z',
      },
    });
    const reads = queriesOn('admin_users', 'select');
    assert.deepEqual(reads.map((query) => [query.columns, query.filters, query.terminal]), [
      [PROFILE_COLUMNS, [['eq', 'id', ADMIN_ID]], 'maybeSingle'],
    ]);
  });

  test('missing permissions become an empty list, and missing times become null', async () => {
    reset({ profile: { ...PROFILE, page_permissions: null, last_login_at: null, created_at: null } });
    state.requestAdmin = { ...SESSION };
    const body = await bodyOf(await readProfile());
    const admin = body.admin as Record<string, unknown>;
    assert.deepEqual(admin.page_permissions, []);
    assert.equal(admin.last_login_at, null);
    assert.equal(admin.created_at, null);
  });

  test('only the signed-in admin is ever read, and no password, hash or token version is returned', async () => {
    state.requestAdmin = { ...SESSION, admin_id: OTHER_ADMIN_ID };
    const body = await bodyOf(await readProfile());
    assert.deepEqual(queriesOn('admin_users', 'select').map((query) => query.filters), [[['eq', 'id', OTHER_ADMIN_ID]]]);
    assert.deepEqual(Object.keys(body.admin as Record<string, unknown>).sort(), [
      'created_at', 'email', 'id', 'is_super_admin', 'last_login_at', 'page_permissions', 'role_title', 'username',
    ]);
    assert.doesNotMatch(String(queriesOn('admin_users', 'select')[0]?.columns), /password_hash|token_version/);
  });

  test('a missing or deactivated row is a 401', async () => {
    const cases: Array<Partial<Scenario>> = [
      { profile: null },
      { profile: { ...PROFILE, is_active: false } },
    ];
    for (const patch of cases) {
      reset(patch);
      state.requestAdmin = { ...SESSION };
      const res = await readProfile();
      assert.equal(res.status, 401, JSON.stringify(patch));
      assert.equal((await bodyOf(res)).code, 'AUTH_REQUIRED');
    }
  });

  test('an unreadable row is a 500 with the session-check message, never the 401 that signs the admin out', async () => {
    reset({ profileError: 'connection terminated' });
    state.requestAdmin = { ...SESSION };
    const res = await readProfile();
    assert.equal(res.status, 500);
    assert.deepEqual(await bodyOf(res), {
      success: false,
      error: SESSION_UNAVAILABLE,
      code: 'INTERNAL_ERROR',
      message: SESSION_UNAVAILABLE,
      request_id: REQUEST_ID,
    });
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.ok(logs.some((line) => line === 'admin profile read failed: connection terminated'), logs.join('\n'));
  });

  test('the outage message is the shared session-check constant, not a copy', () => {
    const source = readFileSync(resolve(APP_DIR, ROUTES.me), 'utf8');
    assert.match(source, /^import \{ SESSION_UNAVAILABLE \} from '\.\.\/\.\.\/\.\.\/lib\/session';$/m);
    assert.match(source, /return fail\('INTERNAL_ERROR', SESSION_UNAVAILABLE\);/);
    assert.doesNotMatch(source, /could not be checked/);
  });
});

describe('PATCH /api/admin/theme', () => {
  test('no session is a 401 and nothing is written', async () => {
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

  test('audit rows go through writeAudit or the shared session module, and responses use the envelope', () => {
    for (const [path, source] of sources) {
      assert.doesNotMatch(source, /from\('audit_log'\)/, path);
      assert.doesNotMatch(source, /NextResponse\.json\(/, path);
      assert.doesNotMatch(source, /x-forwarded-for/i, path);
    }
    assert.match(sourceOf(ROUTES.logout), /action: 'LOGOUT'/);
    assert.match(sourceOf(ROUTES.theme), /action: 'UPDATE_ADMIN_THEME'/);
    assert.match(sourceOf(ROUTES.login), /signedIn\(admin, opened, actorFor\(admin, meta\)\)/);
  });

  test('log out only ever ends this device: the version bump for cookies without a session id is gone', () => {
    const source = sourceOf(ROUTES.logout);
    assert.equal(source.match(/supabaseAdmin\.rpc\(/g)?.length, 1);
    assert.match(source, /supabaseAdmin\.rpc\('admin_session_revoke', \{/);
    assert.match(source, /p_reason: 'logout',/);
    assert.match(source, /after: \{ scope: 'this_device', session_id: session\.id \},/);
    assert.doesNotMatch(source, /admin_bump_token_version|everywhere_legacy|SessionInfo \| null/);
  });

  test('the password step leaves the failure policy to the database and has no mobile branch', () => {
    const source = sourceOf(ROUTES.login);
    assert.match(source, /'admin_record_login_failure'/);
    assert.doesNotMatch(source, /x-client|mobile-admin|isMobile|'24h'/);
    assert.doesNotMatch(source, /emit_admin_alert|admin_login_burst|LOGIN_FAILED|ADMIN_AUTO_DEACTIVAT|last_login_at|is_active: false/);
    assert.doesNotMatch(source, /signAdminJWT|maxAge|cookies\.set/);
  });

  test('sign-in and sign-out need no session, me and theme take any signed-in admin, and nothing answers 403', () => {
    for (const path of [ROUTES.login, ROUTES.logout]) {
      assert.doesNotMatch(sourceOf(path), /require(Admin|AdminAny|AdminAll|SuperAdmin)\(/, path);
    }
    for (const path of [ROUTES.me, ROUTES.theme]) {
      assert.match(sourceOf(path), /requireAdmin\(\)/, path);
      assert.doesNotMatch(sourceOf(path), /requireAdmin\(['"]|requireAdminAny|requireAdminAll|requireSuperAdmin/, path);
    }
    for (const [path, source] of sources) assert.doesNotMatch(source, /PERMISSION_DENIED|status: 403|REAUTH_REQUIRED|MFA_REQUIRED/, path);
  });
});
