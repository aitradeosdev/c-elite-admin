import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const STATE_KEY = '__cardelitePasswordLinksTest';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const TEST_FILE = fileURLToPath(import.meta.url);

const FILES = {
  lib: 'lib/passwordLinks.ts',
  edge: 'lib/edge.ts',
  forgot: 'api/auth/password/forgot/route.ts',
  check: 'api/auth/password/check/route.ts',
  set: 'api/auth/password/set/route.ts',
  templates: 'api/email-templates/route.ts',
  broadcast: 'api/notifications/broadcast/route.ts',
} as const;

const ADMIN_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const ACTOR_ID = '3c9d1f7a-8b2e-4d6c-9a1f-0e4b7c2d5a83';
const SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
const USERNAME = 'ops.lead';
const EMAIL = 'adaeze.okafor@cardelite.test';
const ROLE = 'Operations Lead';
const CONSOLE_URL = 'https://admin.cardelite.test';
const SUPABASE_URL = 'https://project.supabase.test';
const FUNCTION_SECRET = 'edge-function-secret-for-tests';
const SEND_URL = `${SUPABASE_URL}/functions/v1/send-email`;
const REQUEST_ID = 'req_pwlinks0001';
const USER_AGENT = 'Mozilla/5.0 (CardElite password link test)';
const FORWARDED_FOR = '203.0.113.50, 198.51.100.7';
const CLIENT_IP = '198.51.100.7';
const TOKEN = 'pwLinkTest_Token-0123456789abcdefghijkLMNOP';
const INVITE_EXPIRES = '2026-10-22T13:30:00.123456+00:00';
const INVITE_EXPIRES_TEXT = '22 Oct 2026, 14:30 WAT';
const RESET_EXPIRES = '2026-10-19T14:00:00+00:00';
const RESET_EXPIRES_TEXT = '19 Oct 2026, 15:00 WAT';
const NEW_PASSWORD = 'Velvet-Harbour-Lantern-42';
const OLD_HASH = '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';
const NEW_HASH = `$2a$12$hashed:${NEW_PASSWORD.length}`;
const STAMP = '2026-10-19T09:00:00.000+00:00';

const FORGOT_SENT =
  'If those details match an admin account, we have emailed a link to choose a new password. It works for 30 minutes.';
const FORGOT_MISSING = 'Enter the email and username you sign in with.';
const TOO_MANY = 'Too many attempts. Try again later.';
const RESET_UNAVAILABLE = 'Password reset is not available right now.';
const LINK_INVALID = 'This link has expired, was already used, or was replaced by a newer one.';
const CHECK_UNAVAILABLE = 'This link could not be checked right now. Try again shortly.';
const SAVE_UNAVAILABLE = 'Your password could not be saved right now. Try again shortly.';
const DIFFERENT = 'Password must be different from your current password.';
const ADMIN_TEMPLATES_DENIED = 'Only super administrators can change admin email templates.';

const AUDIT_KEYS = [
  'admin_id', 'user_id', 'action', 'entity', 'entity_id', 'before_value', 'after_value', 'ip_address',
  'admin_role', 'user_agent', 'request_id', 'reason', 'result', 'error', 'sensitivity',
] as const;

const ENV_KEYS = ['ADMIN_CONSOLE_URL', 'SUPABASE_URL', 'ADMIN_FUNCTION_SECRET'] as const;

interface DbError {
  message: string;
  code?: string;
}

interface DbResult {
  data?: unknown;
  error?: DbError | null;
}

type Reply = DbResult | 'throw';

type SendReply = { status: number; body?: unknown; raw?: string } | 'timeout' | 'network';

type Filter = [kind: string, column: string, value: unknown];

interface Query {
  table: string;
  op: 'select' | 'insert' | 'update' | null;
  columns: string | null;
  payload: unknown;
  filters: Filter[];
  terminal: 'single' | 'maybeSingle' | null;
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

interface Scenario {
  limits: Record<string, Reply>;
  account: { id: string } | null;
  lookupError: DbError | null;
  issue: Reply;
  check: Reply;
  redeem: Reply;
  storedHash: string | null;
  hashError: DbError | null;
  sameHash: boolean;
  compareError: string | null;
  template: Record<string, unknown> | null;
  auditError: string | null;
  send: SendReply;
}

interface StubState {
  scenario: Scenario;
  queries: Query[];
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
  timeline: string[];
  fetches: FetchCall[];
  afterTasks: unknown[];
  hashes: Array<[unknown, unknown]>;
  compares: Array<[unknown, unknown]>;
  headers: Headers;
  claims: Record<string, unknown> | null;
  db: {
    from(table: string): object;
    rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
  };
}

type Handler = (req: Request) => Promise<Response>;

interface PostRoute {
  POST: Handler;
}

interface PatchRoute {
  PATCH: Handler;
}

type Lib = typeof import('../app/lib/passwordLinks.ts');
type Edge = typeof import('../app/lib/edge.ts');

function checkAnswer(purpose: 'invite' | 'reset', patch: Record<string, unknown> = {}): Reply {
  return {
    data: {
      ok: true,
      admin_id: ADMIN_ID,
      purpose,
      username: USERNAME,
      email: EMAIL,
      role_title: ROLE,
      expires_at: purpose === 'invite' ? INVITE_EXPIRES : RESET_EXPIRES,
      ...patch,
    },
  };
}

function redeemAnswer(purpose: 'invite' | 'reset', patch: Record<string, unknown> = {}): Reply {
  return {
    data: {
      ok: true,
      admin_id: ADMIN_ID,
      purpose,
      username: USERNAME,
      role_title: ROLE,
      sessions_revoked: purpose === 'invite' ? 0 : 2,
      ...patch,
    },
  };
}

function baseScenario(): Scenario {
  return {
    limits: {},
    account: { id: ADMIN_ID },
    lookupError: null,
    issue: { data: { ok: true, expires_at: RESET_EXPIRES, email: EMAIL, username: USERNAME } },
    check: checkAnswer('reset'),
    redeem: redeemAnswer('reset'),
    storedHash: OLD_HASH,
    hashError: null,
    sameHash: false,
    compareError: null,
    template: null,
    auditError: null,
    send: { status: 200, body: { success: true } },
  };
}

const logs: string[] = [];

const state: StubState = {
  scenario: baseScenario(),
  queries: [],
  rpcs: [],
  timeline: [],
  fetches: [],
  afterTasks: [],
  hashes: [],
  compares: [],
  headers: new Headers(),
  claims: null,
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
  if (query.table === 'audit_log' && query.op === 'insert') return { error: fault(s.auditError) };
  if (query.table === 'admin_users' && query.op === 'select' && query.columns === 'id') {
    return s.lookupError ? { error: s.lookupError } : { data: s.account };
  }
  if (query.table === 'admin_users' && query.op === 'select' && query.columns === 'password_hash') {
    return s.hashError ? { error: s.hashError } : { data: { password_hash: s.storedHash } };
  }
  if (query.table === 'email_templates' && query.op === 'select') return { data: s.template };
  if (query.table === 'email_templates' && query.op === 'update') {
    return { data: [{ ...s.template, ...(query.payload as Record<string, unknown>) }] };
  }
  throw new Error(`unexpected query ${JSON.stringify(query)}`);
}

function chain(table: string): object {
  const query: Query = { table, op: null, columns: null, payload: undefined, filters: [], terminal: null };
  state.queries.push(query);
  const settle = () => Promise.resolve().then(() => {
    state.timeline.push(`${query.table}:${query.op}`);
    return { data: null, error: null, ...respond(query) };
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
  if (name === 'admin_password_link_issue') return settleReply(s.issue);
  if (name === 'admin_password_link_check') return settleReply(s.check);
  if (name === 'admin_password_link_redeem') return settleReply(s.redeem);
  return Promise.reject(new Error(`unexpected rpc ${name}`));
}

const realFetch = globalThis.fetch;

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  state.fetches.push({ url: String(input), init });
  state.timeline.push('fetch');
  const send = state.scenario.send;
  if (send === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  if (send === 'network') throw new TypeError('fetch failed');
  const text = send.raw ?? JSON.stringify(send.body ?? null);
  return new Response(text, { status: send.status, headers: { 'content-type': 'application/json' } });
}

function moduleUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function stub(lines: string[]): string {
  return moduleUrl([`const state = () => globalThis.${STATE_KEY};`, ...lines].join('\n'));
}

const PACKAGE_STUBS: Readonly<Record<string, string>> = {
  'next/server': stub([
    'export const NextResponse = { json: (body, init) => Response.json(body, init) };',
    'export function after(task) { state().afterTasks.push(task); }',
  ]),
  'next/headers': stub([
    'export async function headers() { return state().headers; }',
    'export async function cookies() { return { get: () => undefined }; }',
  ]),
  bcryptjs: stub([
    'export default {',
    '  async hash(value, rounds) { state().hashes.push([value, rounds]); return "$2a$" + rounds + "$hashed:" + value.length; },',
    '  async compare(value, hash) {',
    '    state().compares.push([value, hash]);',
    '    if (state().scenario.compareError) throw new Error(state().scenario.compareError);',
    '    return state().scenario.sameHash;',
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
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: stub(['export async function verifyAdminFromRequest() { return state().claims; }']),
  [resolve(APP_DIR, 'lib', 'mfa.ts')]: pathToFileURL(resolve(APP_DIR, 'lib', 'mfa.ts')).href,
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

async function load<T>(path: string): Promise<T> {
  return (await import(await bundle(resolve(APP_DIR, path)))) as T;
}

function source(path: string): string {
  return readFileSync(resolve(APP_DIR, path), 'utf8');
}

const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key): [string, string | undefined] => [key, process.env[key]]));

function setEnv(key: (typeof ENV_KEYS)[number], value: string | null): void {
  if (value === null) Reflect.deleteProperty(process.env, key);
  else Reflect.set(process.env, key, value);
}

function reset(patch: Partial<Scenario> = {}, claims: Record<string, unknown> | null = null): void {
  state.scenario = { ...baseScenario(), ...patch };
  state.queries = [];
  state.rpcs = [];
  state.timeline = [];
  state.fetches = [];
  state.afterTasks = [];
  state.hashes = [];
  state.compares = [];
  state.claims = claims;
  state.headers = new Headers({
    'content-type': 'application/json',
    'user-agent': USER_AGENT,
    'x-forwarded-for': FORWARDED_FOR,
    'x-request-id': REQUEST_ID,
  });
  logs.length = 0;
}

function request(method: 'POST' | 'PATCH', path: string, body: unknown, raw?: string): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: state.headers,
    body: raw ?? JSON.stringify(body),
  });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function withoutRequestId(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  delete copy.request_id;
  return copy;
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

function sentBodies(): Array<{ to: string; template_key: string; vars: Record<string, string> }> {
  return state.fetches.map((call) => JSON.parse(String(call.init.body)));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertNoSecrets(text: string, secrets: readonly string[]): void {
  for (const secret of secrets) assert.ok(!text.includes(secret), `leaked ${secret}`);
}

async function runAfter(): Promise<void> {
  for (const task of state.afterTasks.splice(0)) {
    await (typeof task === 'function' ? (task as () => unknown)() : task);
  }
}

function freshSession(): Record<string, unknown> {
  return {
    id: SID, client: 'web', amr: ['otp', 'pwd'], createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), reauthAt: null, transport: 'cookie',
  };
}

function claimsFor(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    admin_id: ACTOR_ID,
    username: 'owner',
    role_title: 'Super Admin',
    role: null,
    is_super_admin: true,
    page_permissions: [],
    token_version: 7,
    sid: SID,
    amr: ['otp', 'pwd'],
    session: freshSession(),
    mfa: { status: 'active', lockedUntil: null },
    policy: { mode: 'off', graceEndsAt: null, requiredNow: false },
    ...patch,
  };
}

const EDITOR = { is_super_admin: false, username: 'editor', role_title: 'Content Editor', page_permissions: ['email_templates.read', 'email_templates.write'] };

function templateRow(key: string): Record<string, unknown> {
  return {
    key,
    subject: 'Subject for tests',
    html: '<p>{username} <a href="{link}">{link}</a></p>',
    description: 'Template for tests.',
    variables: ['username', 'link'],
    is_active: true,
    updated_at: STAMP,
  };
}

let lib: Lib;
let edge: Edge;
let forgot: PostRoute;
let check: PostRoute;
let setPassword: PostRoute;
let templates: PatchRoute;

before(async () => {
  lib = await load<Lib>(FILES.lib);
  edge = await load<Edge>(FILES.edge);
  forgot = await load<PostRoute>(FILES.forgot);
  check = await load<PostRoute>(FILES.check);
  setPassword = await load<PostRoute>(FILES.set);
  templates = await load<PatchRoute>(FILES.templates);
});

beforeEach(() => {
  reset();
  setEnv('ADMIN_CONSOLE_URL', CONSOLE_URL);
  setEnv('SUPABASE_URL', SUPABASE_URL);
  setEnv('ADMIN_FUNCTION_SECRET', FUNCTION_SECRET);
  globalThis.fetch = fakeFetch as typeof fetch;
  mock.method(console, 'error', (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(' '));
  });
});

afterEach(() => {
  mock.restoreAll();
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) setEnv(key, savedEnv.get(key) ?? null);
});

function forgotPost(body: unknown, raw?: string): Promise<Response> {
  return forgot.POST(request('POST', '/api/auth/password/forgot', body, raw));
}

function checkPost(body: unknown, raw?: string): Promise<Response> {
  return check.POST(request('POST', '/api/auth/password/check', body, raw));
}

function setPost(body: unknown = { token: TOKEN, new_password: NEW_PASSWORD }, raw?: string): Promise<Response> {
  return setPassword.POST(request('POST', '/api/auth/password/set', body, raw));
}

function patchTemplate(body: unknown): Promise<Response> {
  return templates.PATCH(request('PATCH', '/api/email-templates', body));
}

const FORGOT_BODY = { email: EMAIL, username: USERNAME };

describe('lib/passwordLinks: tokens and the link address', () => {
  test('mintLinkToken gives a fresh 43-character base64url token and the sha256 hex that is stored', () => {
    const first = lib.mintLinkToken();
    const second = lib.mintLinkToken();
    assert.deepEqual(Object.keys(first).sort(), ['token', 'tokenHash']);
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(first.tokenHash, /^[0-9a-f]{64}$/);
    assert.equal(first.tokenHash, sha256(first.token));
    assert.notEqual(first.token, second.token);
    assert.equal(lib.isLinkToken(first.token), true);
  });

  test('isLinkToken accepts exactly 43 base64url characters and nothing else', () => {
    for (const good of [TOKEN, 'A'.repeat(43), `${'-_'.repeat(21)}x`]) assert.equal(lib.isLinkToken(good), true, good);
    const base = 'A'.repeat(42);
    for (const bad of ['', base, `${base}AA`, `${base}=`, `${base}+`, `${base}/`, ` ${base}`, `${base}.`, 42, null, undefined, [TOKEN], { token: TOKEN }]) {
      assert.equal(lib.isLinkToken(bad), false, JSON.stringify(bad));
    }
  });

  test('consoleBaseUrl takes an https origin, or http on localhost, and strips a trailing slash', () => {
    const accepted: Array<[string, string]> = [
      [CONSOLE_URL, CONSOLE_URL],
      [`${CONSOLE_URL}/`, CONSOLE_URL],
      [`  https://Admin.CardElite.test${'/'.repeat(3)}  `, CONSOLE_URL],
      ['https://admin.cardelite.test:8443', 'https://admin.cardelite.test:8443'],
      ['http://localhost:3000', 'http://localhost:3000'],
      ['http://localhost:3000/', 'http://localhost:3000'],
    ];
    for (const [value, expected] of accepted) {
      setEnv('ADMIN_CONSOLE_URL', value);
      assert.equal(lib.consoleBaseUrl(), expected, value);
    }
  });

  test('consoleBaseUrl refuses plain http, paths, queries, fragments, credentials, & and quotes', () => {
    for (const value of [
      '', '   ', 'http://admin.cardelite.test', 'http://127.0.0.1:3000', 'https://admin.cardelite.test/console',
      'https://admin.cardelite.test/?next=1', 'https://admin.cardelite.test?', 'https://admin.cardelite.test#top',
      'https://admin.cardelite.test/a&b', 'https://adm&in.cardelite.test', 'https://admin"cardelite.test',
      'https://user:secret@admin.cardelite.test', 'ftp://admin.cardelite.test', 'javascript:alert(1)',
      'admin.cardelite.test', 'not a url',
    ]) {
      setEnv('ADMIN_CONSOLE_URL', value);
      assert.equal(lib.consoleBaseUrl(), null, value);
      assert.equal(lib.linksConfigured(), false, value);
    }
    setEnv('ADMIN_CONSOLE_URL', null);
    assert.equal(lib.consoleBaseUrl(), null);
  });

  test('linksConfigured needs the console address, SUPABASE_URL and ADMIN_FUNCTION_SECRET together', () => {
    assert.equal(lib.linksConfigured(), true);
    for (const key of ENV_KEYS) {
      setEnv(key, null);
      assert.equal(lib.linksConfigured(), false, key);
      setEnv(key, key === 'ADMIN_CONSOLE_URL' ? CONSOLE_URL : key === 'SUPABASE_URL' ? SUPABASE_URL : FUNCTION_SECRET);
    }
    assert.equal(lib.linksConfigured(), true);
  });

  test('the link page is /set-password and the shared invalid-link text is fixed', () => {
    assert.equal(lib.SET_PASSWORD_PATH, '/set-password');
    assert.equal(lib.LINK_INVALID, LINK_INVALID);
  });
});

describe('lib/passwordLinks: sending the email', () => {
  test('an invite goes through send-email with the admin secret, the link, the WAT expiry and the inviter', async () => {
    const result = await lib.sendLinkEmail({
      purpose: 'invite', token: TOKEN, email: EMAIL, username: USERNAME, expiresAt: INVITE_EXPIRES, inviter: 'owner',
    });
    assert.deepEqual(result, { outcome: 'sent', reason: null });
    assert.equal(state.fetches.length, 1);
    const [call] = state.fetches;
    assert.equal(call.url, SEND_URL);
    assert.equal(call.init.method, 'POST');
    assert.deepEqual(call.init.headers, { 'Content-Type': 'application/json', 'x-admin-secret': FUNCTION_SECRET });
    assert.equal(call.init.cache, 'no-store');
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.deepEqual(sentBodies()[0], {
      to: EMAIL,
      template_key: 'admin_invite',
      vars: {
        username: USERNAME,
        link: `${CONSOLE_URL}/set-password#${TOKEN}`,
        expires_at: INVITE_EXPIRES_TEXT,
        inviter: '@owner',
      },
    });
  });

  test('a reset uses the reset template and carries no inviter', async () => {
    const result = await lib.sendLinkEmail({
      purpose: 'reset', token: TOKEN, email: EMAIL, username: USERNAME, expiresAt: RESET_EXPIRES, inviter: 'owner',
    });
    assert.deepEqual(result, { outcome: 'sent', reason: null });
    assert.deepEqual(sentBodies()[0], {
      to: EMAIL,
      template_key: 'admin_password_reset',
      vars: { username: USERNAME, link: `${CONSOLE_URL}/set-password#${TOKEN}`, expires_at: RESET_EXPIRES_TEXT },
    });
  });

  test('the link is the console origin, /set-password and the token after a #, with nothing that breaks the email', async () => {
    const cases: Array<[string, string]> = [[`${CONSOLE_URL}/`, CONSOLE_URL], ['http://localhost:3000', 'http://localhost:3000']];
    for (const [value, origin] of cases) {
      reset();
      setEnv('ADMIN_CONSOLE_URL', value);
      const { token } = lib.mintLinkToken();
      await lib.sendLinkEmail({ purpose: 'reset', token, email: EMAIL, username: USERNAME, expiresAt: RESET_EXPIRES });
      const link = sentBodies()[0]?.vars.link ?? '';
      assert.equal(link, `${origin}/set-password#${token}`, value);
      assert.match(link, /^https?:\/\/[^/?#&"]+\/set-password#[A-Za-z0-9_-]{43}$/);
    }
  });

  test('the answer is sent only on a 2xx with success, not_sent when nothing can have gone out, unknown otherwise', async () => {
    const cases: Array<[SendReply, string, string | null]> = [
      [{ status: 200, body: { success: true } }, 'sent', null],
      [{ status: 400, body: { success: false, message: 'Template not available' } }, 'not_sent', 'Template not available'],
      [{ status: 400, body: { success: false, message: 'Recipient not allowed' } }, 'not_sent', 'Recipient not allowed'],
      [{ status: 401, body: { success: false, message: 'Unauthorized' } }, 'not_sent', 'Unauthorized'],
      [{ status: 404, raw: 'Not found' }, 'not_sent', 'HTTP 404'],
      [{ status: 500, body: { success: false, message: 'SMTP not configured' } }, 'not_sent', 'SMTP not configured'],
      [{ status: 500, body: { success: false, message: 'Something went wrong' } }, 'unknown', 'Something went wrong'],
      [{ status: 502, raw: '<html>Bad gateway</html>' }, 'unknown', 'HTTP 502'],
      [{ status: 200, body: { success: false } }, 'unknown', 'unreadable'],
      ['timeout', 'unknown', 'timeout'],
      ['network', 'unknown', 'network'],
    ];
    for (const [send, outcome, reason] of cases) {
      reset({ send });
      const result = await lib.sendLinkEmail({
        purpose: 'invite', token: TOKEN, email: EMAIL, username: USERNAME, expiresAt: INVITE_EXPIRES, inviter: 'owner',
      });
      assert.deepEqual(result, { outcome, reason }, JSON.stringify(send));
      assert.equal(state.fetches.length, 1);
    }
  });

  test('the edge transport calls nothing without its settings, and trims a trailing slash from SUPABASE_URL', async () => {
    for (const key of ['SUPABASE_URL', 'ADMIN_FUNCTION_SECRET'] as const) {
      reset();
      setEnv(key, null);
      const answer = await edge.callEdgeFunction('send-email', {}, 1000);
      assert.equal(answer.kind, 'failed', key);
      assert.equal(state.fetches.length, 0, key);
      setEnv(key, key === 'SUPABASE_URL' ? SUPABASE_URL : FUNCTION_SECRET);
    }
    reset();
    setEnv('SUPABASE_URL', `${SUPABASE_URL}/`);
    const answer = await edge.callEdgeFunction('broadcast-notification', { title: 'Hello' }, 1000);
    assert.deepEqual(answer, { kind: 'answered', status: 200, body: { success: true } });
    assert.equal(state.fetches[0]?.url, `${SUPABASE_URL}/functions/v1/broadcast-notification`);
    assert.equal(state.fetches[0]?.init.body, JSON.stringify({ title: 'Hello' }));
    assert.equal(new Headers(state.fetches[0]?.init.headers).has('authorization'), false);
    reset();
    await edge.callEdgeFunction('admin-delete-account', { user_id: 'x' }, 1000, 'admin.token');
    assert.equal(new Headers(state.fetches[0]?.init.headers).get('authorization'), 'Bearer admin.token');
    assert.equal(new Headers(state.fetches[0]?.init.headers).get('x-admin-secret'), FUNCTION_SECRET);
  });

  test('nothing is sent when the console address or the edge settings are missing', async () => {
    for (const key of ENV_KEYS) {
      reset();
      setEnv(key, null);
      const result = await lib.sendLinkEmail({ purpose: 'reset', token: TOKEN, email: EMAIL, username: USERNAME, expiresAt: RESET_EXPIRES });
      assert.deepEqual(result, { outcome: 'not_sent', reason: 'misconfigured' }, key);
      assert.equal(state.fetches.length, 0, key);
      setEnv(key, key === 'ADMIN_CONSOLE_URL' ? CONSOLE_URL : key === 'SUPABASE_URL' ? SUPABASE_URL : FUNCTION_SECRET);
    }
  });
});

describe('lib/passwordLinks: issuing and sending in one step', () => {
  test('issueAndSend stores the hash of a fresh token, then emails the address, username and expiry the database returned', async () => {
    reset({ issue: { data: { ok: true, expires_at: RESET_EXPIRES, email: 'stored@cardelite.test', username: 'stored.name' } } });
    const result = await lib.issueAndSend({ adminId: ADMIN_ID, purpose: 'reset' });
    assert.deepEqual(result, { outcome: 'sent', reason: null, expiresAt: RESET_EXPIRES });
    const issued = callsTo('admin_password_link_issue');
    assert.equal(issued.length, 1);
    assert.deepEqual(Object.keys(issued[0]).sort(), ['p_admin_id', 'p_purpose', 'p_token_hash']);
    assert.equal(issued[0].p_admin_id, ADMIN_ID);
    assert.equal(issued[0].p_purpose, 'reset');
    assert.match(String(issued[0].p_token_hash), /^[0-9a-f]{64}$/);
    const [sent] = sentBodies();
    assert.equal(sent.to, 'stored@cardelite.test');
    assert.equal(sent.template_key, 'admin_password_reset');
    assert.equal(sent.vars.username, 'stored.name');
    assert.equal(sent.vars.expires_at, RESET_EXPIRES_TEXT);
    const token = sent.vars.link.slice(sent.vars.link.indexOf('#') + 1);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(sha256(token), issued[0].p_token_hash);
    assert.deepEqual(state.timeline, ['rpc:admin_password_link_issue', 'fetch']);
    assertNoSecrets(JSON.stringify(state.rpcs), [token]);
  });

  test('an invite resend sends the invite template with the inviter', async () => {
    reset({ issue: { data: { ok: true, expires_at: INVITE_EXPIRES, email: EMAIL, username: USERNAME } } });
    const result = await lib.issueAndSend({ adminId: ADMIN_ID, purpose: 'invite', inviter: 'owner' });
    assert.deepEqual(result, { outcome: 'sent', reason: null, expiresAt: INVITE_EXPIRES });
    assert.equal(callsTo('admin_password_link_issue')[0]?.p_purpose, 'invite');
    assert.equal(sentBodies()[0]?.template_key, 'admin_invite');
    assert.equal(sentBodies()[0]?.vars.inviter, '@owner');
    assert.equal(sentBodies()[0]?.vars.expires_at, INVITE_EXPIRES_TEXT);
  });

  test('a send that fails after the link was issued keeps the expiry, so callers can tell it from a refusal', async () => {
    reset({ send: { status: 400, body: { success: false, message: 'Template not available' } } });
    assert.deepEqual(await lib.issueAndSend({ adminId: ADMIN_ID, purpose: 'reset' }), {
      outcome: 'not_sent', reason: 'Template not available', expiresAt: RESET_EXPIRES,
    });
    reset({ send: 'timeout' });
    assert.deepEqual(await lib.issueAndSend({ adminId: ADMIN_ID, purpose: 'reset' }), {
      outcome: 'unknown', reason: 'timeout', expiresAt: RESET_EXPIRES,
    });
  });

  test('a refusal or an outage sends nothing and gives no expiry', async () => {
    const cases: Array<[Reply, string]> = [
      [{ data: { ok: false, reason: 'not_found' } }, 'not_found'],
      [{ data: { ok: false, reason: 'inactive' } }, 'inactive'],
      [{ data: { ok: false, reason: 'no_email' } }, 'no_email'],
      [{ data: { ok: false, reason: 'password_set' } }, 'password_set'],
      [{ data: { ok: false, reason: 'invite_pending' } }, 'invite_pending'],
      [{ data: { ok: false } }, 'unavailable'],
      [{ data: null }, 'unavailable'],
      [{ data: { ok: true, expires_at: RESET_EXPIRES } }, 'unavailable'],
      [{ error: { message: 'Invalid link', code: 'P0001' } }, 'unavailable'],
      ['throw', 'unavailable'],
    ];
    for (const [issue, reason] of cases) {
      reset({ issue });
      const result = await lib.issueAndSend({ adminId: ADMIN_ID, purpose: 'invite', inviter: 'owner' });
      assert.deepEqual(result, { outcome: 'not_sent', reason, expiresAt: null }, JSON.stringify(issue));
      assert.equal(state.fetches.length, 0, JSON.stringify(issue));
    }
  });
});

describe('POST /api/auth/password/forgot', () => {
  test('unknown, inactive, invited and real accounts all get the same 200 with no-store', async () => {
    const scenarios: Array<[string, Partial<Scenario>]> = [
      ['unknown', { account: null }],
      ['inactive or deleted', { account: null }],
      ['invited', { issue: { data: { ok: false, reason: 'invite_pending' } } }],
      ['real', {}],
    ];
    const answers: unknown[] = [];
    for (const [name, patch] of scenarios) {
      reset(patch);
      const res = await forgotPost(FORGOT_BODY);
      answers.push([res.status, withoutRequestId(await bodyOf(res)), res.headers.get('cache-control')]);
      await runAfter();
      assert.equal(res.status, 200, name);
    }
    for (const answer of answers) {
      assert.deepEqual(answer, [200, { success: true, message: FORGOT_SENT }, 'no-store']);
    }
  });

  test('the lookup is one id read by the trimmed username as typed and the trimmed lower-cased email, active and not deleted', async () => {
    await forgotPost({ email: '  Adaeze.Okafor@CardElite.TEST ', username: ' Ops.Lead ' });
    const lookups = queriesOn('admin_users', 'select');
    assert.equal(lookups.length, 1);
    assert.equal(lookups[0].columns, 'id');
    assert.deepEqual(lookups[0].filters, [
      ['eq', 'username', 'Ops.Lead'], ['eq', 'email', EMAIL], ['eq', 'is_active', true], ['is', 'deleted_at', null],
    ]);
    assert.equal(lookups[0].terminal, 'maybeSingle');
  });

  test('the limits run first: 10 an hour per address, then 3 an hour per username and email', async () => {
    reset({ limits: { admin_password_forgot: { data: false } } });
    const byIp = await forgotPost({ email: 'Adaeze.Okafor@CardElite.test', username: 'Ops.Lead' });
    assert.equal(byIp.status, 429);
    assert.deepEqual(withoutRequestId(await bodyOf(byIp)), { success: false, error: TOO_MANY, code: 'RATE_LIMITED', message: TOO_MANY });
    assert.deepEqual(state.rpcs, [
      { name: 'check_rate_limit_by_key', args: { p_key: CLIENT_IP, p_action: 'admin_password_forgot', p_limit: 10, p_window_secs: 3600 } },
    ]);
    assert.equal(state.queries.length, 0);

    reset({ limits: { admin_password_forgot_account: { data: false } } });
    const byAccount = await forgotPost({ email: 'Adaeze.Okafor@CardElite.test', username: 'Ops.Lead' });
    assert.equal(byAccount.status, 429);
    assert.equal(byAccount.headers.get('cache-control'), 'no-store');
    assert.deepEqual(state.rpcs[1], {
      name: 'check_rate_limit_by_key',
      args: { p_key: `admin:ops.lead|${EMAIL}`, p_action: 'admin_password_forgot_account', p_limit: 3, p_window_secs: 3600 },
    });
    assert.equal(state.queries.length, 0);
    assert.equal(state.afterTasks.length, 0);
  });

  test('a limit that cannot be checked is a 500, never a 401, and nothing is looked up', async () => {
    for (const action of ['admin_password_forgot', 'admin_password_forgot_account']) {
      for (const reply of [{ error: { message: 'rate limit store unavailable' } }, 'throw'] as Reply[]) {
        reset({ limits: { [action]: reply } });
        const res = await forgotPost(FORGOT_BODY);
        assert.equal(res.status, 500, action);
        assert.deepEqual(withoutRequestId(await bodyOf(res)), {
          success: false, error: RESET_UNAVAILABLE, code: 'INTERNAL_ERROR', message: RESET_UNAVAILABLE,
        });
        assert.equal(state.queries.length, 0);
        assert.equal(state.afterTasks.length, 0);
      }
    }
  });

  test('links that are not set up answer 500 before the lookup, the same for every input', async () => {
    for (const value of [null, 'http://admin.cardelite.test']) {
      for (const account of [null, { id: ADMIN_ID }]) {
        reset({ account });
        setEnv('ADMIN_CONSOLE_URL', value);
        const res = await forgotPost(FORGOT_BODY);
        assert.equal(res.status, 500, String(value));
        assert.deepEqual(withoutRequestId(await bodyOf(res)), {
          success: false, error: RESET_UNAVAILABLE, code: 'INTERNAL_ERROR', message: RESET_UNAVAILABLE,
        });
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.equal(state.queries.length, 0);
        assert.equal(state.afterTasks.length, 0);
        assert.ok(logs.some((line) => line.includes('ADMIN_CONSOLE_URL')));
      }
    }
  });

  test('a lookup error is a 500 and schedules nothing', async () => {
    reset({ lookupError: { message: 'connection terminated', code: '08006' } });
    const res = await forgotPost(FORGOT_BODY);
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).code, 'INTERNAL_ERROR');
    assert.equal(state.afterTasks.length, 0);
    assert.ok(logs.some((line) => line.includes('connection terminated')));
    assertNoSecrets(logs.join('\n'), [EMAIL, USERNAME]);
  });

  test('a missing, empty or too long field is a 400 before any limit or lookup', async () => {
    const bodies: unknown[] = [
      {}, { email: EMAIL }, { username: USERNAME }, { email: '', username: USERNAME }, { email: '   ', username: USERNAME },
      { email: EMAIL, username: '  ' }, { email: `${'a'.repeat(310)}@cardelite.test`, username: USERNAME },
      { email: EMAIL, username: 'u'.repeat(33) }, { email: 42, username: USERNAME }, { email: EMAIL, username: [USERNAME] },
      null, [], 'text',
    ];
    for (const body of bodies) {
      reset();
      const res = await forgotPost(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(withoutRequestId(await bodyOf(res)), {
        success: false, error: FORGOT_MISSING, code: 'VALIDATION_ERROR', message: FORGOT_MISSING,
      });
      assert.equal(state.rpcs.length, 0);
      assert.equal(state.queries.length, 0);
    }
    reset();
    assert.equal((await forgotPost(null, 'not json')).status, 400);
    reset();
    assert.equal((await forgotPost({ email: EMAIL, username: 'u'.repeat(32) })).status, 200);
  });

  test('the reply goes out first; the after() task then issues a reset link, sends it and records the request', async () => {
    const res = await forgotPost(FORGOT_BODY);
    assert.equal(res.status, 200);
    assert.equal(state.afterTasks.length, 1);
    assert.deepEqual(callsTo('admin_password_link_issue'), []);
    assert.equal(state.fetches.length, 0);
    assert.deepEqual(audits(), []);

    await runAfter();
    const issued = callsTo('admin_password_link_issue');
    assert.equal(issued.length, 1);
    assert.equal(issued[0].p_admin_id, ADMIN_ID);
    assert.equal(issued[0].p_purpose, 'reset');
    const [sent] = sentBodies();
    assert.equal(sent.to, EMAIL);
    assert.equal(sent.template_key, 'admin_password_reset');
    const rows = audits();
    assert.equal(rows.length, 1);
    assert.deepEqual(pick(rows[0], AUDIT_KEYS), {
      admin_id: null,
      user_id: null,
      action: 'PASSWORD_RESET_REQUESTED',
      entity: 'admin_users',
      entity_id: ADMIN_ID,
      before_value: null,
      after_value: { outcome: 'sent', expires_at: RESET_EXPIRES, ip: CLIENT_IP },
      ip_address: null,
      admin_role: null,
      user_agent: null,
      request_id: null,
      reason: null,
      result: 'success',
      error: null,
      sensitivity: 'security',
    });
    const token = sent.vars.link.slice(sent.vars.link.indexOf('#') + 1);
    assertNoSecrets(JSON.stringify(rows), [token, sent.vars.link]);
    assertNoSecrets(logs.join('\n'), [token]);
  });

  test('an unmatched account schedules nothing: no link, no email and no record', async () => {
    reset({ account: null });
    const res = await forgotPost(FORGOT_BODY);
    assert.equal(res.status, 200);
    assert.equal(state.afterTasks.length, 0);
    await runAfter();
    assert.deepEqual(callsTo('admin_password_link_issue'), []);
    assert.equal(state.fetches.length, 0);
    assert.deepEqual(audits(), []);
  });

  test('an invited account is refused by the issue step: recorded as a failure with invite_pending, and nothing is sent', async () => {
    reset({ issue: { data: { ok: false, reason: 'invite_pending' } } });
    await forgotPost(FORGOT_BODY);
    await runAfter();
    assert.equal(state.fetches.length, 0);
    assert.deepEqual(pick(audits()[0], ['admin_id', 'action', 'entity_id', 'after_value', 'result', 'error', 'sensitivity']), {
      admin_id: null,
      action: 'PASSWORD_RESET_REQUESTED',
      entity_id: ADMIN_ID,
      after_value: { outcome: 'not_sent', expires_at: null, ip: CLIENT_IP },
      result: 'failure',
      error: 'invite_pending',
      sensitivity: 'security',
    });
  });

  test('an email that was not sent, or may have gone out, is recorded as a failure with its reason', async () => {
    const cases: Array<[SendReply, string, string]> = [
      [{ status: 400, body: { success: false, message: 'Template not available' } }, 'not_sent', 'Template not available'],
      ['timeout', 'unknown', 'timeout'],
    ];
    for (const [send, outcome, reason] of cases) {
      reset({ send });
      await forgotPost(FORGOT_BODY);
      await runAfter();
      assert.deepEqual(pick(audits()[0], ['after_value', 'result', 'error']), {
        after_value: { outcome, expires_at: RESET_EXPIRES, ip: CLIENT_IP },
        result: 'failure',
        error: reason,
      });
    }
  });

  test('it never records a sign-in failure and never changes the account', async () => {
    for (const patch of [{}, { account: null }, { issue: { data: { ok: false, reason: 'inactive' } } }] as Array<Partial<Scenario>>) {
      reset(patch);
      await forgotPost(FORGOT_BODY);
      await runAfter();
      assert.deepEqual(callsTo('admin_record_login_failure'), []);
      assert.deepEqual(queriesOn('admin_users', 'update'), []);
      assert.deepEqual(state.rpcs.map((call) => call.name).filter((name) => name !== 'check_rate_limit_by_key' && name !== 'admin_password_link_issue'), []);
    }
  });
});

describe('POST /api/auth/password/check', () => {
  test('a token of the wrong shape is a 409 without asking the database', async () => {
    const bodies: unknown[] = [{}, { token: '' }, { token: 'A'.repeat(42) }, { token: `${TOKEN}=` }, { token: 42 }, { token: [TOKEN] }, null, []];
    for (const body of bodies) {
      reset();
      const res = await checkPost(body);
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.deepEqual(withoutRequestId(await bodyOf(res)), {
        success: false, error: LINK_INVALID, code: 'STATE_CONFLICT', message: LINK_INVALID,
      });
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual(state.rpcs, []);
    }
    reset();
    assert.equal((await checkPost(null, 'not json')).status, 409);
  });

  test('a usable link answers 200 with the purpose, username, email and expiry, and never the token or ids', async () => {
    reset({ check: checkAnswer('invite') });
    const res = await checkPost({ token: TOKEN });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await bodyOf(res);
    assert.deepEqual(body, {
      success: true, request_id: REQUEST_ID, purpose: 'invite', username: USERNAME, email: EMAIL, expires_at: INVITE_EXPIRES,
    });
    assert.deepEqual(state.rpcs, [{ name: 'admin_password_link_check', args: { p_token_hash: sha256(TOKEN) } }]);
    assertNoSecrets(JSON.stringify(body), [TOKEN, ADMIN_ID, ROLE]);
    assert.deepEqual(state.queries, []);
  });

  test('a link that is expired, used or replaced is a 409; an outage or an unreadable answer is a 500, never a 401', async () => {
    const cases: Array<[Reply, number, string]> = [
      [{ data: { ok: false, reason: 'invalid' } }, 409, LINK_INVALID],
      [{ error: { message: 'connection terminated' } }, 500, CHECK_UNAVAILABLE],
      ['throw', 500, CHECK_UNAVAILABLE],
      [{ data: null }, 500, CHECK_UNAVAILABLE],
      [checkAnswer('reset', { purpose: 'other' }), 500, CHECK_UNAVAILABLE],
      [checkAnswer('reset', { admin_id: null }), 500, CHECK_UNAVAILABLE],
    ];
    for (const [reply, status, message] of cases) {
      reset({ check: reply });
      const res = await checkPost({ token: TOKEN });
      assert.equal(res.status, status, JSON.stringify(reply));
      const body = await bodyOf(res);
      assert.equal(body.error, message);
      assert.equal(body.code, status === 409 ? 'STATE_CONFLICT' : 'INTERNAL_ERROR');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assertNoSecrets(logs.join('\n'), [TOKEN]);
    }
  });
});

describe('POST /api/auth/password/set', () => {
  test('a token of the wrong shape is a 409 and nothing is checked, hashed or saved', async () => {
    for (const body of [{ new_password: NEW_PASSWORD }, { token: 'short', new_password: NEW_PASSWORD }, null] as unknown[]) {
      reset();
      const res = await setPost(body);
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal((await bodyOf(res)).error, LINK_INVALID);
      assert.deepEqual(state.rpcs, []);
      assert.deepEqual(state.hashes, []);
    }
  });

  test('a link that cannot be used is a 409, and a check outage is a 500, before the password is looked at', async () => {
    reset({ check: { data: { ok: false, reason: 'invalid' } } });
    const used = await setPost();
    assert.equal(used.status, 409);
    assert.equal((await bodyOf(used)).error, LINK_INVALID);
    reset({ check: { error: { message: 'connection terminated' } } });
    const down = await setPost();
    assert.equal(down.status, 500);
    assert.deepEqual(withoutRequestId(await bodyOf(down)), {
      success: false, error: SAVE_UNAVAILABLE, code: 'INTERNAL_ERROR', message: SAVE_UNAVAILABLE,
    });
    for (const res of [used, down]) assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(state.hashes, []);
    assert.deepEqual(callsTo('admin_password_link_redeem'), []);
    assert.deepEqual(audits(), []);
  });

  test('the password rules run with the username and email of the link, and a problem is a 400 on new_password', async () => {
    const cases: Array<[unknown, string, string | null]> = [
      [undefined, 'Enter a new password.', null],
      ['', 'Enter a new password.', null],
      ['Short-1a', 'Password must be at least 12 characters.', 'length'],
      ['Key-OPS.LEAD-2026', 'Password must not contain your username or the part of your email before the @.', 'personal'],
      ['Adaeze.Okafor-Key-2026', 'Password must not contain your username or the part of your email before the @.', 'personal'],
      [`Aa1!${'x'.repeat(69)}`, 'Password must be 72 bytes or fewer. Emoji and accented letters take more than one byte each.', 'bytes'],
    ];
    for (const [password, message, rule] of cases) {
      reset();
      const res = await setPost({ token: TOKEN, new_password: password });
      assert.equal(res.status, 400, String(password));
      const body = await bodyOf(res);
      assert.equal(body.code, 'VALIDATION_ERROR');
      assert.equal(body.error, message);
      assert.deepEqual(body.details, rule ? { field: 'new_password', rule } : { field: 'new_password' });
      assert.deepEqual(state.hashes, []);
      assert.deepEqual(callsTo('admin_password_link_redeem'), []);
    }
  });

  test('a reset to the current password is a 400 with the different message, after one compare against the stored hash', async () => {
    reset({ sameHash: true });
    const res = await setPost();
    assert.equal(res.status, 400);
    const body = await bodyOf(res);
    assert.equal(body.error, DIFFERENT);
    assert.deepEqual(body.details, { field: 'new_password', rule: 'different' });
    const reads = queriesOn('admin_users', 'select');
    assert.deepEqual(reads.map((query) => [query.columns, query.filters, query.terminal]), [
      ['password_hash', [['eq', 'id', ADMIN_ID]], 'maybeSingle'],
    ]);
    assert.deepEqual(state.compares, [[NEW_PASSWORD, OLD_HASH]]);
    assert.deepEqual(state.hashes, []);
    assert.deepEqual(callsTo('admin_password_link_redeem'), []);
  });

  test('an invite never reads or compares a stored hash', async () => {
    reset({ check: checkAnswer('invite'), redeem: redeemAnswer('invite') });
    const res = await setPost();
    assert.equal(res.status, 200);
    assert.deepEqual(queriesOn('admin_users', 'select'), []);
    assert.deepEqual(state.compares, []);
  });

  test('a stored hash that cannot be read is a 500; one bcrypt cannot read counts as a different password', async () => {
    reset({ hashError: { message: 'connection terminated' } });
    const down = await setPost();
    assert.equal(down.status, 500);
    assert.equal((await bodyOf(down)).error, SAVE_UNAVAILABLE);
    assert.deepEqual(callsTo('admin_password_link_redeem'), []);
    reset({ compareError: 'Invalid salt version: xx' });
    const unreadable = await setPost();
    assert.equal(unreadable.status, 200);
    assert.ok(logs.some((line) => line.includes('Invalid salt version')));
    assertNoSecrets(logs.join('\n'), [NEW_PASSWORD, TOKEN]);
  });

  test('success saves a cost-12 hash through the link, answers 200 with the purpose, sets no cookie and records it', async () => {
    const cases: Array<['invite' | 'reset', string, number]> = [
      ['invite', 'ADMIN_INVITE_ACCEPTED', 0],
      ['reset', 'PASSWORD_RESET_COMPLETED', 2],
    ];
    for (const [purpose, action, revoked] of cases) {
      reset({ check: checkAnswer(purpose), redeem: redeemAnswer(purpose) });
      const res = await setPost();
      assert.equal(res.status, 200, purpose);
      assert.deepEqual(await bodyOf(res), { success: true, request_id: REQUEST_ID, purpose });
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual(res.headers.getSetCookie(), []);
      assert.deepEqual(state.hashes, [[NEW_PASSWORD, 12]]);
      assert.deepEqual(callsTo('admin_password_link_redeem'), [{ p_token_hash: sha256(TOKEN), p_password_hash: NEW_HASH }]);
      const order = state.timeline.filter((step) => step.startsWith('rpc:') || step === 'audit_log:insert');
      assert.deepEqual(order, ['rpc:admin_password_link_check', 'rpc:admin_password_link_redeem', 'audit_log:insert']);
      const rows = audits();
      assert.equal(rows.length, 1);
      assert.deepEqual(pick(rows[0], AUDIT_KEYS), {
        admin_id: ADMIN_ID,
        user_id: null,
        action,
        entity: 'admin_users',
        entity_id: ADMIN_ID,
        before_value: null,
        after_value: { sessions_revoked: revoked },
        ip_address: CLIENT_IP,
        admin_role: ROLE,
        user_agent: USER_AGENT,
        request_id: REQUEST_ID,
        reason: null,
        result: 'success',
        error: null,
        sensitivity: 'security',
      });
      assertNoSecrets(JSON.stringify([state.rpcs, rows, logs]), [NEW_PASSWORD, TOKEN]);
    }
  });

  test('a link used or replaced while the password was chosen is a 409 with a failure record for its purpose', async () => {
    for (const [purpose, action] of [['reset', 'PASSWORD_RESET_COMPLETED'], ['invite', 'ADMIN_INVITE_ACCEPTED']] as const) {
      reset({ check: checkAnswer(purpose), redeem: { data: { ok: false, reason: 'invalid' } } });
      const res = await setPost();
      assert.equal(res.status, 409, purpose);
      assert.equal((await bodyOf(res)).error, LINK_INVALID);
      assert.deepEqual(pick(audits()[0], ['admin_id', 'action', 'entity', 'entity_id', 'after_value', 'result', 'error', 'sensitivity']), {
        admin_id: ADMIN_ID,
        action,
        entity: 'admin_users',
        entity_id: ADMIN_ID,
        after_value: null,
        result: 'failure',
        error: 'link_invalid',
        sensitivity: 'security',
      });
    }
  });

  test('a redeem outage is a 500 with the save message and no record', async () => {
    for (const redeem of [{ error: { message: 'Invalid password hash', code: 'P0001' } }, 'throw', { data: null }] as Reply[]) {
      reset({ redeem });
      const res = await setPost();
      assert.equal(res.status, 500, JSON.stringify(redeem));
      assert.deepEqual(withoutRequestId(await bodyOf(res)), {
        success: false, error: SAVE_UNAVAILABLE, code: 'INTERNAL_ERROR', message: SAVE_UNAVAILABLE,
      });
      assert.deepEqual(audits(), []);
      assert.ok(logs.some((line) => line.includes('admin password link redeem failed')));
      assertNoSecrets(logs.join('\n'), [NEW_PASSWORD, TOKEN]);
    }
  });
});

describe('PATCH /api/email-templates: admin templates are for super admins only', () => {
  test('an admin who may edit templates but is not a super admin cannot change an admin_ template, and nothing is read', async () => {
    for (const key of ['admin_invite', 'admin_password_reset', 'admin_security_alert']) {
      reset({ template: templateRow(key) }, claimsFor(EDITOR));
      const res = await patchTemplate({ key, is_active: false });
      assert.equal(res.status, 403, key);
      assert.deepEqual(withoutRequestId(await bodyOf(res)), {
        success: false, error: ADMIN_TEMPLATES_DENIED, code: 'PERMISSION_DENIED', message: ADMIN_TEMPLATES_DENIED,
      });
      assert.deepEqual(state.queries, []);
    }
  });

  test('a super admin can change one, and other templates keep the existing permission', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['admin_invite', claimsFor()],
      ['new_device_login', claimsFor(EDITOR)],
    ];
    for (const [key, claims] of cases) {
      reset({ template: templateRow(key) }, claims);
      const res = await patchTemplate({ key, is_active: false, reason: 'Paused for the test' });
      assert.equal(res.status, 200, key);
      assert.equal((await bodyOf(res)).changed, true);
      const updates = queriesOn('email_templates', 'update');
      assert.equal(updates.length, 1);
      assert.equal((updates[0].payload as Record<string, unknown>).is_active, false);
      assert.equal(audits()[0]?.action, 'UPDATE_EMAIL_TEMPLATE');
    }
  });
});

describe('sources', () => {
  const owned = [FILES.lib, FILES.edge, FILES.forgot, FILES.check, FILES.set];

  test('the new files carry no prose comments, and neither does this test', () => {
    for (const [path, text] of [...owned.map((file) => [file, source(file)]), ['test', readFileSync(TEST_FILE, 'utf8')]]) {
      assert.doesNotMatch(text, /\/\*/, path);
      assert.doesNotMatch(text, /(^|[^:])\/\/(?!\/)/m, path);
    }
  });

  test('the public routes never answer 401, need no session, set no cookie and export only what Next allows', () => {
    for (const path of [FILES.forgot, FILES.check, FILES.set]) {
      const text = source(path);
      assert.doesNotMatch(text, /AUTH_REQUIRED|require(?:Admin|AdminAny|AdminAll|SuperAdmin)\(|lib\/guard/, path);
      assert.doesNotMatch(text, /setSessionCookie|setChallengeCookie|cookies|signSessionToken|admin_session_open/, path);
      assert.doesNotMatch(text, /NextResponse\.json\(|from\('audit_log'\)|x-forwarded-for|PROVIDER_ERROR/i, path);
      assert.match(text, /NO_STORE/, path);
      const exported = [...text.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((match) => match[1]);
      assert.deepEqual(exported, path === FILES.forgot ? ['maxDuration', 'POST'] : ['POST'], path);
      assert.doesNotMatch(text, /^export\s+(?:\{|\*|default|type|interface)/m, path);
    }
    assert.match(source(FILES.forgot), /^export const maxDuration = 30;$/m);
    assert.match(source(FILES.forgot), /after\(\(\) => sendReset\(adminId, meta\)\)/);
    assert.doesNotMatch(source(FILES.forgot), /admin_record_login_failure|\.update\(|password_hash/);
  });

  test('one edge transport in lib/edge.ts serves the broadcast and the link emails', () => {
    const edge = source(FILES.edge);
    assert.match(edge, /\/functions\/v1\/\$\{slug\}/);
    assert.match(edge, /'x-admin-secret': secret/);
    assert.match(edge, /cache: 'no-store'/);
    assert.match(edge, /signal: AbortSignal\.timeout\(timeoutMs\)/);
    assert.deepEqual([...edge.matchAll(/^export\s+(?:async\s+)?(?:function|const|type)\s+(\w+)/gm)].map((match) => match[1]), [
      'EdgeAnswer', 'callEdgeFunction',
    ]);
    const links = source(FILES.lib);
    assert.match(links, /^const SEND_TIMEOUT_MS = 15000;$/m);
    assert.match(links, /callEdgeFunction\('send-email', \{ to, template_key: templateKey, vars \}, SEND_TIMEOUT_MS\)/);
    assert.match(links, /^import \{ hashChallengeToken, newChallengeToken \} from '\.\/mfa';$/m);
    assert.doesNotMatch(links, /node:crypto|randomBytes|createHash|\bfetch\(|next\/headers|headers\.get/);
    const broadcast = source(FILES.broadcast);
    assert.match(broadcast, /callEdgeFunction\('broadcast-notification', payload, EDGE_TIMEOUT_MS\)/);
    assert.doesNotMatch(broadcast, /\bfetch\(|AbortSignal|functions\/v1/);
  });
});
