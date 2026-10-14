import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { base32Encode, hashRecoveryCode, openSecret } from '../app/lib/mfa.ts';
import { twoStepLockedMessage } from '../app/lib/http.ts';

const STATE_KEY = '__cardeliteMfaLoginTest';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const TEST_FILE = fileURLToPath(import.meta.url);
const nodeRequire = createRequire(import.meta.url);

const ROUTES = {
  verify: 'api/auth/mfa/verify/route.ts',
  start: 'api/auth/mfa/enroll/start/route.ts',
  confirm: 'api/auth/mfa/enroll/confirm/route.ts',
  reauth: 'api/account/reauth/route.ts',
} as const;

const ADMIN_ID = '3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b';
const SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
const NEW_SID = '9e8d7c6b-5a49-4382-a716-05f4e3d2c1b0';
const USERNAME = 'ops.lead';
const ROLE = 'Operations Lead';
const MFA_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const OTHER_KEY = 'BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const SEALED = 'oKGio6Slpqeoqaqr1ypPGXD9NYdbVbbhNE716EeUYCCow3tgg0VFxid5ZNE596De';
const SECRET = Buffer.from('12345678901234567890', 'ascii');
const SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RECOVERY_INPUT = 'abcde fghjk';
const RECOVERY_HASH = '33b76dcb0d0d19da3153d074f5ceb04efb4c5341b997f8b42177341e060b1fc7';
const CHALLENGE_TOKEN = 'q6Wb3n4Xy0Zr2PpL8sT1uVwKcDeFgHiJkLmNoPqRsTu';
const CHALLENGE_HASH = '77b9d6c11cdf8f7cef1c6718528251e6d7bbe1e599e85b3e8cf574cd5b55b0f2';
const ISSUED_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.two-step-session.signature';
const PASSWORD = 'Correct-Horse-Battery-9';
const STORED_HASH = '$2a$12$storedhashstoredhashstoredhashstoredhashstoredhashst';
const REQUEST_ID = 'req_mfalogin0001';
const USER_AGENT = 'Mozilla/5.0 (CardElite two-step test)';
const CLIENT_IP = '198.51.100.7';
const EPOCH = 'Thu, 01 Jan 1970 00:00:00 GMT';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const STEP_ENDED = 'This sign-in step ended. Enter your password again.';
const SIGN_IN_UNAVAILABLE = 'Sign-in is unavailable right now. Try again shortly.';
const TWO_STEP_UNAVAILABLE = 'Two-step sign-in is unavailable right now. Try again later.';
const ENTER_CODE = 'Enter the 6-digit code from your authenticator app.';
const CODE_DID_NOT_WORK = 'That code did not work. Enter the newest code, and check that your phone sets its clock automatically.';
const CODE_ALREADY_USED = 'That code was already used. Wait for the next one.';
const RECOVERY_DID_NOT_WORK = 'That recovery code did not work or was already used.';
const SETUP_CODE_WRONG = "That code did not work. Use the newest CardElite Admin entry in your app and check your phone's clock.";
const REAUTH_ENTER_CODE = 'Enter the code from your authenticator app.';
const REAUTH_CODE_WRONG = 'That code did not work. Enter the newest code from your authenticator app.';

const AUDIT_KEYS = [
  'admin_id', 'action', 'entity', 'entity_id', 'after_value', 'ip_address', 'admin_role', 'user_agent', 'request_id',
  'reason', 'result', 'error', 'sensitivity',
] as const;

interface DbError {
  message: string;
  code?: string;
}

interface DbResult {
  data?: unknown;
  error?: DbError | null;
}

type Reply = DbResult | 'throw';

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

interface Scenario {
  replies: Record<string, Reply>;
  admin: Record<string, unknown> | null;
  adminError: string | null;
  hashRow: Record<string, unknown> | null;
  auditError: string | null;
  signError: string | null;
}

interface StubState {
  scenario: Scenario;
  queries: Query[];
  rpcs: RpcCall[];
  timeline: string[];
  signed: unknown[][];
  compares: Array<[unknown, unknown]>;
  headers: Headers;
  cookies: Map<string, string>;
  requestAdmin: Record<string, unknown> | null;
  db: {
    from(table: string): object;
    rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
  };
}

interface Cookie {
  value: string;
  attributes: Map<string, string | true>;
}

type Handler = (req: Request) => Promise<Response>;

interface PostRoute {
  POST: Handler;
}

let expiresAt = '';
let expiresEpoch = 0;

function opened(methods: string[], tokenVersion = 4): Reply {
  return {
    get data() {
      return {
        ok: true,
        session_id: NEW_SID,
        token_version: tokenVersion,
        auth_methods: [...methods].sort(),
        expires_at: expiresAt,
        expires_at_epoch: expiresEpoch,
      };
    },
  };
}

function factor(patch: Record<string, unknown> = {}): Reply {
  return {
    data: {
      status: 'active',
      secret_enc: SEALED,
      key_version: 1,
      created_at: '2026-10-01T09:00:00+00:00',
      confirmed_at: '2026-10-01T09:01:00+00:00',
      last_used_step: null,
      last_used_at: null,
      locked_until: null,
      recovery_codes_left: 9,
      ...patch,
    },
  };
}

function failure(patch: Record<string, unknown> = {}): Reply {
  return {
    data: {
      recorded: true, failed_count: 1, failed_count_24h: 1, locked: false, locked_until: null, just_locked: false,
      lock_minutes: null, ...patch,
    },
  };
}

function baseReplies(): Record<string, Reply> {
  return {
    admin_challenge_attempt: {
      data: { ok: true, challenge_id: '5d6e7f80-9a1b-4c2d-8e3f-405162738495', admin_id: ADMIN_ID, purpose: 'mfa_verify', attempts_left: 4 },
    },
    admin_challenge_consume: { data: { ok: true, admin_id: ADMIN_ID, token_version: 4 } },
    admin_mfa_get: factor(),
    admin_mfa_use_step: { data: { ok: true } },
    admin_mfa_record_failure: failure(),
    admin_recovery_code_use: { data: { ok: true, recovery_codes_left: 9 } },
    admin_session_open: opened(['pwd', 'otp']),
    admin_session_revoke: { data: { revoked: true } },
    admin_mfa_begin: { data: { ok: true } },
    admin_mfa_activate: { data: { ok: true, token_version: 5, session_kept: false, sessions_revoked: 2, recovery_codes_left: 10 } },
    admin_session_mark_reauth: { data: { ok: true, reauth_at: '2026-10-13T10:00:00.123+00:00' } },
    check_rate_limit_by_key: { data: true },
  };
}

function baseScenario(): Scenario {
  return {
    replies: baseReplies(),
    admin: {
      id: ADMIN_ID,
      username: USERNAME,
      role_title: ROLE,
      is_super_admin: false,
      is_active: true,
      page_permissions: ['withdrawals'],
      theme_preference: 'light',
      token_version: 4,
    },
    adminError: null,
    hashRow: { password_hash: STORED_HASH },
    auditError: null,
    signError: null,
  };
}

const logs: string[] = [];

const state: StubState = {
  scenario: baseScenario(),
  queries: [],
  rpcs: [],
  timeline: [],
  signed: [],
  compares: [],
  headers: new Headers(),
  cookies: new Map(),
  requestAdmin: null,
  db: {
    from: (table) => chain(table),
    rpc: (name, args) => rpc(name, args),
  },
};

Reflect.set(globalThis, STATE_KEY, state);

function respond(query: Query): DbResult {
  const s = state.scenario;
  if (query.table === 'audit_log' && query.op === 'insert') return { error: s.auditError ? { message: s.auditError } : null };
  if (query.table === 'admin_users' && query.op === 'select' && query.columns === 'password_hash') return { data: s.hashRow };
  if (query.table === 'admin_users' && query.op === 'select') {
    return s.adminError ? { error: { message: s.adminError } } : { data: s.admin };
  }
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
    maybeSingle: () => builder,
    then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          state.timeline.push(`${query.table}:${query.op}`);
          return { data: null, error: null, ...respond(query) };
        })
        .then(onFulfilled, onRejected),
  });
  return builder;
}

function rpc(name: string, args: Record<string, unknown>): Promise<DbResult> {
  state.rpcs.push({ name, args });
  state.timeline.push(`rpc:${name}`);
  const reply = state.scenario.replies[name];
  if (reply === undefined) return Promise.reject(new Error(`unexpected rpc ${name}`));
  if (reply === 'throw') return Promise.reject(new Error('fetch failed'));
  return Promise.resolve({ data: null, error: null, ...reply });
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
    '  async compare(value, hash) { state().compares.push([value, hash]); return value === "Correct-Horse-Battery-9"; },',
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
    `  return '${ISSUED_TOKEN}';`,
    '}',
    'export async function verifyAdminFromRequest() { return state().requestAdmin; }',
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

async function loadRoute<T>(path: string): Promise<T> {
  return (await import(await bundle(resolve(APP_DIR, path)))) as T;
}

function reset(patch: Partial<Omit<Scenario, 'replies'>> & { replies?: Record<string, Reply> } = {}): void {
  const expires = Math.floor((Date.now() + 8 * HOUR_MS) / 1000);
  expiresEpoch = expires;
  expiresAt = new Date(expires * 1000).toISOString();
  const base = baseScenario();
  state.scenario = { ...base, ...patch, replies: { ...base.replies, ...(patch.replies ?? {}) } };
  state.queries = [];
  state.rpcs = [];
  state.timeline = [];
  state.signed = [];
  state.compares = [];
  state.requestAdmin = null;
  state.headers = new Headers({
    'content-type': 'application/json',
    'user-agent': USER_AGENT,
    'x-forwarded-for': `203.0.113.50, ${CLIENT_IP}`,
    'x-request-id': REQUEST_ID,
  });
  state.cookies = new Map([['admin_mfa_challenge', CHALLENGE_TOKEN]]);
  logs.length = 0;
}

let verify: PostRoute;
let start: PostRoute;
let confirm: PostRoute;
let reauth: PostRoute;

before(async () => {
  verify = await loadRoute<PostRoute>(ROUTES.verify);
  start = await loadRoute<PostRoute>(ROUTES.start);
  confirm = await loadRoute<PostRoute>(ROUTES.confirm);
  reauth = await loadRoute<PostRoute>(ROUTES.reauth);
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
  syncBuiltinESMExports();
});

function send(route: PostRoute, path: string, body?: unknown, raw?: string): Promise<Response> {
  return route.POST(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: state.headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  }));
}

const verifyWith = (body: unknown) => send(verify, '/api/auth/mfa/verify', body);
const startSetup = () => send(start, '/api/auth/mfa/enroll/start', {});
const confirmWith = (body: unknown) => send(confirm, '/api/auth/mfa/enroll/confirm', body);
const reauthWith = (body: unknown, raw?: string) => send(reauth, '/api/account/reauth', body, raw);

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
  return () => spy.mock.calls.filter((call) => call.arguments[0] === 'sha1').length;
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
  return state.rpcs.filter((call) => call.name === name).map((call) => call.args);
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
    after_value: { client: 'web' },
    ip_address: CLIENT_IP,
    admin_role: ROLE,
    user_agent: USER_AGENT,
    request_id: REQUEST_ID,
    reason: null,
    result: 'failure',
    error: null,
    sensitivity: 'security',
    ...patch,
  };
}

function assertStepEnded(res: Response, body: Record<string, unknown>): void {
  assert.equal(res.status, 401);
  assert.deepEqual(withoutRequestId(body), {
    success: false, error: STEP_ENDED, code: 'AUTH_REQUIRED', message: STEP_ENDED, details: { reason: 'challenge_expired' },
  });
  const cleared = cookiesOf(res).get('admin_mfa_challenge');
  assert.equal(cleared?.value, '');
  assert.equal(cleared?.attributes.get('path'), '/api/auth');
  assert.equal(cleared?.attributes.get('expires'), EPOCH);
  assert.equal(cookiesOf(res).has('admin_token'), false);
}

function assertNoSession(res: Response): void {
  assert.equal(cookiesOf(res).has('admin_token'), false);
  assert.deepEqual(state.signed, []);
  assert.deepEqual(callsTo('admin_session_open'), []);
}

function assertSignedIn(res: Response, methods: string[], tokenVersion: number): void {
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const cookies = cookiesOf(res);
  assert.equal(cookies.get('admin_token')?.value, ISSUED_TOKEN);
  assert.equal(cookies.get('admin_token')?.attributes.get('path'), '/');
  assert.equal(cookies.get('admin_token')?.attributes.get('httponly'), true);
  const maxAge = Number(cookies.get('admin_token')?.attributes.get('max-age'));
  assert.ok(maxAge >= 28798 && maxAge <= 28800, String(maxAge));
  assert.equal(cookies.get('admin_theme')?.value, 'light');
  assert.equal(cookies.get('admin_mfa_challenge')?.value, '');
  assert.equal(cookies.get('admin_mfa_challenge')?.attributes.get('path'), '/api/auth');
  assert.deepEqual(callsTo('admin_session_open'), [{
    p_admin_id: ADMIN_ID,
    p_client: 'web',
    p_auth_methods: methods,
    p_ttl_seconds: 28800,
    p_expected_token_version: tokenVersion,
    p_ip: CLIENT_IP,
    p_user_agent: USER_AGENT,
  }]);
  const login = audits().find((row) => row.action === 'LOGIN');
  assert.deepEqual(pick(login, AUDIT_KEYS), auditRow({
    action: 'LOGIN',
    result: 'success',
    after_value: { client: 'web', amr: [...methods].sort(), session_id: NEW_SID },
  }));
}

describe('POST /api/auth/mfa/verify: the sign-in step', () => {
  test('without the step cookie the step has ended: 401, the cookie is cleared on its path, nothing is called', async () => {
    state.cookies.clear();
    const res = await verifyWith({ otp: currentCode().code });
    assertStepEnded(res, await bodyOf(res));
    assert.deepEqual(state.rpcs, []);
    assert.deepEqual(state.queries, []);
  });

  test('the step is found by the sha256 of its cookie, and an ended, used, exhausted or unknown step is a 401', async () => {
    await verifyWith({ otp: currentCode().code });
    assert.deepEqual(callsTo('admin_challenge_attempt'), [{ p_token_hash: CHALLENGE_HASH, p_purpose: 'mfa_verify' }]);
    for (const reason of ['invalid', 'consumed', 'expired', 'exhausted']) {
      reset({ replies: { admin_challenge_attempt: { data: { ok: false, reason } } } });
      const res = await verifyWith({ otp: currentCode().code });
      assertStepEnded(res, await bodyOf(res));
      assert.deepEqual(state.rpcs.map((call) => call.name), ['admin_challenge_attempt'], reason);
      assert.deepEqual(audits(), [], reason);
    }
  });

  test('a step store that fails is a 500 that keeps the cookie, so the admin can try again', async () => {
    for (const reply of [{ error: { message: 'connection terminated' } }, 'throw'] as Reply[]) {
      reset({ replies: { admin_challenge_attempt: reply } });
      const res = await verifyWith({ otp: currentCode().code });
      assert.equal(res.status, 500);
      assert.equal((await bodyOf(res)).error, SIGN_IN_UNAVAILABLE);
      assert.deepEqual(res.headers.getSetCookie(), []);
    }
  });

  test('an admin deactivated meanwhile, or whose two-step sign-in is gone, ends the step; a failed read is a 500', async () => {
    const ended: Array<Parameters<typeof reset>[0]> = [
      { admin: null },
      { replies: { admin_mfa_get: { data: { status: 'none' } } } },
      { replies: { admin_mfa_get: factor({ status: 'pending', confirmed_at: null }) } },
    ];
    for (const patch of ended) {
      reset(patch);
      const res = await verifyWith({ otp: currentCode().code });
      assertStepEnded(res, await bodyOf(res));
      assertNoSession(res);
    }
    for (const patch of [{ adminError: 'connection terminated' }, { replies: { admin_mfa_get: 'throw' as Reply } }]) {
      reset(patch);
      const res = await verifyWith({ otp: currentCode().code });
      assert.equal(res.status, 500, JSON.stringify(patch));
      assertNoSession(res);
    }
    reset();
    await verifyWith({ otp: currentCode().code });
    const read = state.queries.find((query) => query.table === 'admin_users');
    assert.deepEqual(read?.filters, [['eq', 'id', ADMIN_ID], ['eq', 'is_active', true], ['is', 'deleted_at', null]]);
    assert.doesNotMatch(String(read?.columns), /password_hash/);
  });
});

describe('POST /api/auth/mfa/verify: authenticator codes', () => {
  test('a right code is used once, then a password-and-code session opens and the step cookie is cleared', async () => {
    const { code, step } = currentCode();
    const res = await verifyWith({ otp: code });
    assert.deepEqual(await bodyOf(res), { success: true, request_id: REQUEST_ID, step: 'done', method: 'otp' });
    assertSignedIn(res, ['pwd', 'otp'], 4);
    assert.deepEqual(callsTo('admin_mfa_use_step'), [{ p_admin_id: ADMIN_ID, p_step: step }]);
    assert.deepEqual(callsTo('admin_challenge_consume'), [{ p_token_hash: CHALLENGE_HASH, p_purpose: 'mfa_verify' }]);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    assert.deepEqual(state.signed, [[{
      id: ADMIN_ID, username: USERNAME, role_title: ROLE, is_super_admin: false, page_permissions: ['withdrawals'], token_version: 4,
    }, NEW_SID, ['otp', 'pwd'], expiresEpoch]]);
    const order = state.timeline.filter((entry) => entry.startsWith('rpc:'));
    assert.deepEqual(order, [
      'rpc:admin_challenge_attempt', 'rpc:admin_mfa_get', 'rpc:admin_mfa_use_step', 'rpc:admin_challenge_consume', 'rpc:admin_session_open',
    ]);
  });

  test('the session opens under the version the step was started with', async () => {
    reset({ replies: { admin_challenge_consume: { data: { ok: true, admin_id: ADMIN_ID, token_version: 11 } }, admin_session_open: opened(['pwd', 'otp'], 11) } });
    const res = await verifyWith({ otp: currentCode().code });
    assertSignedIn(res, ['pwd', 'otp'], 11);
  });

  test('spaces inside the code are ignored', async () => {
    const { code } = currentCode();
    const res = await verifyWith({ otp: ` ${code.slice(0, 3)} ${code.slice(3)} ` });
    assert.equal(res.status, 200);
  });

  test('anything but six digits is refused on the code field without counting it or computing a code', async () => {
    for (const otp of ['12345', '1234567', 'abcdef', '12 34 5', '', 123456, null]) {
      reset();
      const count = watchTotp();
      const res = await verifyWith({ otp });
      assert.equal(res.status, 400, String(otp));
      assert.deepEqual(withoutRequestId(await bodyOf(res)), {
        success: false, error: ENTER_CODE, code: 'VALIDATION_ERROR', message: ENTER_CODE, details: { field: 'otp', attempts_left: 4 },
      });
      assert.equal(count(), 0, String(otp));
      assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
      assert.deepEqual(callsTo('admin_mfa_use_step'), []);
      mock.restoreAll();
      syncBuiltinESMExports();
    }
  });

  test('a body key named code is never read, because coupons use that name', async () => {
    const res = await verifyWith({ code: currentCode().code });
    assert.equal(res.status, 400);
    assert.deepEqual((await bodyOf(res)).details, { field: 'otp', attempts_left: 4 });
  });

  test('a wrong code is counted once, audited, and says how many tries this step has left', async () => {
    reset({ replies: { admin_challenge_attempt: { data: { ok: true, admin_id: ADMIN_ID, attempts_left: 2 } } } });
    const res = await verifyWith({ otp: wrongCode() });
    assert.equal(res.status, 400);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), {
      success: false, error: CODE_DID_NOT_WORK, code: 'VALIDATION_ERROR', message: CODE_DID_NOT_WORK,
      details: { field: 'otp', attempts_left: 2 },
    });
    assert.deepEqual(callsTo('admin_mfa_record_failure'), [{ p_admin_id: ADMIN_ID }]);
    assert.deepEqual(callsTo('admin_mfa_use_step'), []);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [
      auditRow({ action: 'MFA_CHALLENGE_FAILED', error: 'Two-step code did not match.' }),
    ]);
    assertNoSession(res);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('the wrong code that locks two-step sign-in answers 429 with the unlock time and audits the lock', async () => {
    const lockedUntil = new Date(Date.now() + 15 * MINUTE_MS).toISOString();
    reset({ replies: { admin_mfa_record_failure: failure({ failed_count: 10, locked: true, locked_until: lockedUntil, just_locked: true, lock_minutes: 15 }) } });
    const res = await verifyWith({ otp: wrongCode() });
    assert.equal(res.status, 429);
    const body = await bodyOf(res);
    assert.equal(body.code, 'RATE_LIMITED');
    assert.equal(body.error, twoStepLockedMessage(lockedUntil));
    assert.deepEqual(body.details, { reason: 'mfa_locked', locked_until: lockedUntil });
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [
      auditRow({ action: 'MFA_CHALLENGE_FAILED', error: 'Two-step code did not match.' }),
      auditRow({
        action: 'MFA_LOCKED',
        result: 'success',
        reason: '10 failed two-step codes in 15 minutes.',
        after_value: { client: 'web', locked_until: lockedUntil, lock_minutes: 15 },
      }),
    ]);
  });

  test('a 24-hour lock names the day sign-in works again', async () => {
    const lockedUntil = new Date(Date.now() + 24 * HOUR_MS).toISOString();
    reset({ replies: { admin_mfa_record_failure: failure({ failed_count: 3, failed_count_24h: 30, locked: true, locked_until: lockedUntil, just_locked: true, lock_minutes: 1440 }) } });
    const res = await verifyWith({ otp: wrongCode() });
    assert.equal(res.status, 429);
    assert.match(String((await bodyOf(res)).error), /locked until \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2} WAT\./);
    assert.equal(audits()[1]?.reason, '30 failed two-step codes in 24 hours.');
    assert.deepEqual(audits()[1]?.after_value, { client: 'web', locked_until: lockedUntil, lock_minutes: 1440 });
  });

  test('while locked, nothing is counted and no code is computed, and the attempt is audited', async () => {
    reset({ replies: { admin_mfa_get: factor({ locked_until: '2026-10-13T14:05:00+00:00' }) } });
    const { code } = currentCode();
    const count = watchTotp();
    const res = await verifyWith({ otp: code });
    assert.equal(res.status, 429);
    assert.deepEqual((await bodyOf(res)).details, { reason: 'mfa_locked', locked_until: '2026-10-13T14:05:00+00:00' });
    assert.equal(count(), 0);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    assert.deepEqual(callsTo('admin_mfa_use_step'), []);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [
      auditRow({ action: 'MFA_CHALLENGE_FAILED', error: 'Two-step sign-in is locked.' }),
    ]);
  });

  test('a code already used is counted as a failure; if that locks, the answer is the lock', async () => {
    reset({ replies: { admin_mfa_use_step: { data: { ok: false, reason: 'replay' } } } });
    const res = await verifyWith({ otp: currentCode().code });
    assert.equal(res.status, 400);
    assert.equal((await bodyOf(res)).error, CODE_ALREADY_USED);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), [{ p_admin_id: ADMIN_ID }]);
    assert.equal(audits()[0]?.error, 'Two-step code was already used.');
    reset({ replies: {
      admin_mfa_use_step: { data: { ok: false, reason: 'replay' } },
      admin_mfa_record_failure: failure({ locked: true, locked_until: '2026-10-13T14:05:00+00:00' }),
    } });
    const locked = await verifyWith({ otp: currentCode().code });
    assert.equal(locked.status, 429);
  });

  test('a lock that lands between the check and the code is not counted', async () => {
    reset({ replies: { admin_mfa_use_step: { data: { ok: false, reason: 'locked', locked_until: '2026-10-13T14:05:00+00:00' } } } });
    const res = await verifyWith({ otp: currentCode().code });
    assert.equal(res.status, 429);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    assert.equal(audits()[0]?.error, 'Two-step sign-in is locked.');
  });

  test('two-step sign-in removed during the step ends it', async () => {
    reset({ replies: { admin_mfa_use_step: { data: { ok: false, reason: 'not_active' } } } });
    const res = await verifyWith({ otp: currentCode().code });
    assertStepEnded(res, await bodyOf(res));
    assert.equal(audits()[0]?.error, 'Two-step sign-in changed during sign-in.');
    assert.deepEqual(callsTo('admin_challenge_consume'), []);
  });

  test('stores that fail after a right code answer 500, and a step that ended answers 401', async () => {
    const outages: Array<Record<string, Reply>> = [
      { admin_mfa_use_step: { error: { message: 'Invalid time step' } } },
      { admin_challenge_consume: 'throw' as Reply },
      { admin_session_open: { error: { message: 'connection terminated' } } },
    ];
    for (const replies of outages) {
      reset({ replies });
      const res = await verifyWith({ otp: currentCode().code });
      assert.equal(res.status, 500, JSON.stringify(replies));
      assert.equal(cookiesOf(res).has('admin_token'), false);
      assert.deepEqual(state.signed, []);
      assert.ok(!audits().some((row) => row.action === 'LOGIN'));
    }
    const ended: Array<Record<string, Reply>> = [
      { admin_challenge_consume: { data: { ok: false, reason: 'invalid' } } },
      { admin_session_open: { data: { ok: false, reason: 'token_version_changed' } } },
    ];
    for (const replies of ended) {
      reset({ replies });
      const res = await verifyWith({ otp: currentCode().code });
      assertStepEnded(res, await bodyOf(res));
    }
  });

  test('a token that cannot be signed ends the new session and answers 500', async () => {
    reset({ signError: 'Zero-length key is not supported' });
    const res = await verifyWith({ otp: currentCode().code });
    assert.equal(res.status, 500);
    assert.deepEqual(callsTo('admin_session_revoke'), [{
      p_admin_id: ADMIN_ID, p_sid: NEW_SID, p_actor: ADMIN_ID, p_reason: 'sign_in_incomplete',
    }]);
    assert.equal(cookiesOf(res).has('admin_token'), false);
    assert.ok(!audits().some((row) => row.action === 'LOGIN'));
  });

  test('a missing, malformed or different encryption key, or a damaged secret, fails closed and counts nothing', async () => {
    const cases: Array<[string | null, Reply | null, string]> = [
      [null, null, 'ADMIN_MFA_ENCRYPTION_KEY is not set'],
      ['not-base64', null, 'ADMIN_MFA_ENCRYPTION_KEY must be 44 characters'],
      [OTHER_KEY, null, 'the two-step secret could not be opened'],
      [MFA_KEY, factor({ secret_enc: `${SEALED.slice(0, -4)}AAAA` }), 'the two-step secret could not be opened'],
      [MFA_KEY, factor({ key_version: 2 }), 'ADMIN_MFA_ENCRYPTION_KEY_V2 is not set'],
    ];
    for (const [key, mfa, logged] of cases) {
      reset(mfa ? { replies: { admin_mfa_get: mfa } } : {});
      if (key === null) Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
      else Reflect.set(process.env, 'ADMIN_MFA_ENCRYPTION_KEY', key);
      const res = await verifyWith({ otp: currentCode().code });
      assert.equal(res.status, 500, logged);
      assert.equal((await bodyOf(res)).error, TWO_STEP_UNAVAILABLE);
      assert.deepEqual(callsTo('admin_mfa_record_failure'), [], logged);
      assert.deepEqual(callsTo('admin_mfa_use_step'), [], logged);
      assert.ok(logs.some((line) => line.includes(logged)), logged);
      assert.ok(!logs.join('\n').includes(MFA_KEY) && !logs.join('\n').includes(SEALED), logged);
      assertNoSession(res);
    }
  });
});

describe('POST /api/auth/mfa/verify: recovery codes', () => {
  test('a recovery code is hashed with the admin-bound pepper, used once, audited, and opens a recovery session', async () => {
    reset({ replies: { admin_session_open: opened(['pwd', 'recovery']) } });
    const res = await verifyWith({ recovery_code: RECOVERY_INPUT });
    assert.deepEqual(await bodyOf(res), {
      success: true, request_id: REQUEST_ID, step: 'done', method: 'recovery', recovery_codes_left: 9,
    });
    assertSignedIn(res, ['pwd', 'recovery'], 4);
    assert.deepEqual(callsTo('admin_recovery_code_use'), [{ p_admin_id: ADMIN_ID, p_code_hash: RECOVERY_HASH }]);
    assert.deepEqual(pick(audits()[0], AUDIT_KEYS), auditRow({
      action: 'MFA_RECOVERY_CODE_USED', result: 'success', after_value: { client: 'web', recovery_codes_left: 9 },
    }));
    assert.deepEqual(callsTo('admin_mfa_use_step'), []);
    const order = state.timeline.filter((entry) => entry.startsWith('rpc:'));
    assert.ok(order.indexOf('rpc:admin_recovery_code_use') < order.indexOf('rpc:admin_challenge_consume'));
    assertNoSecretsAnywhere([RECOVERY_INPUT, 'ABCDEFGHJK', RECOVERY_HASH]);
  });

  test('the dash, case and the easily confused letters do not matter', async () => {
    for (const input of ['ABCDE-FGHJK', 'abcdefghjk', ' AbCdE fGhJk ']) {
      reset({ replies: { admin_session_open: opened(['pwd', 'recovery']) } });
      await verifyWith({ recovery_code: input });
      assert.deepEqual(callsTo('admin_recovery_code_use'), [{ p_admin_id: ADMIN_ID, p_code_hash: RECOVERY_HASH }], input);
    }
    reset({ replies: { admin_session_open: opened(['pwd', 'recovery']) } });
    await verifyWith({ recovery_code: 'O1LI0-abcde' });
    assert.equal(callsTo('admin_recovery_code_use')[0]?.p_code_hash, hashRecoveryCode('01110ABCDE', ADMIN_ID, 1));
  });

  test('a malformed recovery code is counted as a failure without touching the stored codes', async () => {
    for (const input of ['abcde', 'abcde-fghjk-x', 'abcde-fghju', 'ß'.repeat(10), '']) {
      reset();
      const res = await verifyWith({ recovery_code: input });
      assert.equal(res.status, 400, input);
      assert.deepEqual(withoutRequestId(await bodyOf(res)), {
        success: false, error: RECOVERY_DID_NOT_WORK, code: 'VALIDATION_ERROR', message: RECOVERY_DID_NOT_WORK,
        details: { field: 'recovery_code', attempts_left: 4 },
      });
      assert.deepEqual(callsTo('admin_mfa_record_failure'), [{ p_admin_id: ADMIN_ID }], input);
      assert.deepEqual(callsTo('admin_recovery_code_use'), [], input);
      assert.equal(audits()[0]?.error, 'Recovery code was not in the expected format.');
    }
  });

  test('a recovery code that does not match or was already used is counted, and can lock', async () => {
    reset({ replies: { admin_recovery_code_use: { data: { ok: false, reason: 'invalid' } } } });
    const res = await verifyWith({ recovery_code: RECOVERY_INPUT });
    assert.equal(res.status, 400);
    assert.deepEqual((await bodyOf(res)).details, { field: 'recovery_code', attempts_left: 4 });
    assert.deepEqual(callsTo('admin_mfa_record_failure'), [{ p_admin_id: ADMIN_ID }]);
    assert.equal(audits()[0]?.error, 'Recovery code did not match or was already used.');
    assertNoSession(res);
    reset({ replies: {
      admin_recovery_code_use: { data: { ok: false, reason: 'invalid' } },
      admin_mfa_record_failure: failure({ locked: true, locked_until: '2026-10-13T14:05:00+00:00', just_locked: true, lock_minutes: 15, failed_count: 10 }),
    } });
    const locked = await verifyWith({ recovery_code: RECOVERY_INPUT });
    assert.equal(locked.status, 429);
    assert.deepEqual(audits().map((row) => row.action), ['MFA_CHALLENGE_FAILED', 'MFA_LOCKED']);
  });

  test('a lock or a removed factor at the moment of use is not counted; a failed store is a 500', async () => {
    reset({ replies: { admin_recovery_code_use: { data: { ok: false, reason: 'locked', locked_until: '2026-10-13T14:05:00+00:00' } } } });
    assert.equal((await verifyWith({ recovery_code: RECOVERY_INPUT })).status, 429);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    reset({ replies: { admin_recovery_code_use: { data: { ok: false, reason: 'not_active' } } } });
    const ended = await verifyWith({ recovery_code: RECOVERY_INPUT });
    assertStepEnded(ended, await bodyOf(ended));
    reset({ replies: { admin_recovery_code_use: { error: { message: 'Invalid recovery code hash' } } } });
    assert.equal((await verifyWith({ recovery_code: RECOVERY_INPUT })).status, 500);
  });

  test('without the key recovery codes cannot be checked, so the step fails closed', async () => {
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    const res = await verifyWith({ recovery_code: RECOVERY_INPUT });
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, TWO_STEP_UNAVAILABLE);
    assert.deepEqual(callsTo('admin_recovery_code_use'), []);
  });
});

function assertNoSecretsAnywhere(secrets: readonly string[]): void {
  const text = [JSON.stringify(audits()), logs.join('\n')].join('\n');
  for (const secret of secrets) assert.ok(!text.includes(secret), `leaked ${secret}`);
}

describe('POST /api/auth/mfa/enroll/start', () => {
  const pending = (createdAt: string) => factor({ status: 'pending', confirmed_at: null, created_at: createdAt });
  const setupStep = { admin_challenge_attempt: { data: { ok: true, admin_id: ADMIN_ID, purpose: 'mfa_enroll', attempts_left: 4 } } };

  test('without a step, or with one that ended, there is nothing to set up', async () => {
    state.cookies.clear();
    const res = await startSetup();
    assertStepEnded(res, await bodyOf(res));
    reset({ replies: { admin_challenge_attempt: { data: { ok: false, reason: 'expired' } } } });
    const ended = await startSetup();
    assertStepEnded(ended, await bodyOf(ended));
    assert.deepEqual(callsTo('admin_challenge_attempt'), [{ p_token_hash: CHALLENGE_HASH, p_purpose: 'mfa_enroll' }]);
  });

  test('a new setup seals a fresh secret for this admin and shows it once, with a QR code and no caching', async () => {
    reset({ replies: { ...setupStep, admin_mfa_get: { data: { status: 'none' } } } });
    const res = await startSetup();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await bodyOf(res);
    assert.deepEqual(Object.keys(body).sort(), ['account_label', 'otpauth_uri', 'qr_data_uri', 'request_id', 'secret_display', 'success']);
    const [begin] = callsTo('admin_mfa_begin');
    assert.equal(begin?.p_admin_id, ADMIN_ID);
    assert.equal(begin?.p_key_version, 1);
    const secret = openSecret(String(begin?.p_secret_enc), ADMIN_ID, 1);
    assert.equal(secret.length, 20);
    const key = base32Encode(secret);
    assert.equal(body.secret_display, key.match(/.{1,4}/g)?.join(' '));
    assert.equal(
      body.otpauth_uri,
      `otpauth://totp/CardElite%20Admin:${USERNAME}?secret=${key}&issuer=CardElite%20Admin&algorithm=SHA1&digits=6&period=30`,
    );
    assert.match(String(body.qr_data_uri), /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/);
    assert.equal(body.account_label, `CardElite Admin (${USERNAME})`);
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.deepEqual(audits(), []);
    assertNoSecretsAnywhere([key, String(begin?.p_secret_enc)]);
  });

  test('a setup started in the last 15 minutes shows the same secret again without starting over', async () => {
    reset({ replies: { ...setupStep, admin_mfa_get: pending(new Date(Date.now() - 5 * MINUTE_MS).toISOString()) } });
    const body = await bodyOf(await startSetup());
    assert.equal(body.secret_display, SECRET_BASE32.match(/.{1,4}/g)?.join(' '));
    assert.deepEqual(callsTo('admin_mfa_begin'), []);
  });

  test('an older unfinished setup is replaced by a new secret', async () => {
    reset({ replies: { ...setupStep, admin_mfa_get: pending(new Date(Date.now() - 20 * MINUTE_MS).toISOString()) } });
    const body = await bodyOf(await startSetup());
    assert.equal(callsTo('admin_mfa_begin').length, 1);
    assert.notEqual(body.secret_display, SECRET_BASE32.match(/.{1,4}/g)?.join(' '));
  });

  test('an admin who already has two-step sign-in cannot start again here', async () => {
    reset({ replies: setupStep });
    const active = await startSetup();
    assertStepEnded(active, await bodyOf(active));
    assert.deepEqual(callsTo('admin_mfa_begin'), []);
    reset({ replies: { ...setupStep, admin_mfa_get: { data: { status: 'none' } }, admin_mfa_begin: { data: { ok: false, reason: 'already_active' } } } });
    const refused = await startSetup();
    assertStepEnded(refused, await bodyOf(refused));
  });

  test('without the key setup fails closed, and failed stores are 500s', async () => {
    reset({ replies: { ...setupStep, admin_mfa_get: { data: { status: 'none' } } } });
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    const res = await startSetup();
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, TWO_STEP_UNAVAILABLE);
    assert.deepEqual(callsTo('admin_mfa_begin'), []);
    Reflect.set(process.env, 'ADMIN_MFA_ENCRYPTION_KEY', MFA_KEY);
    const failures: Array<Record<string, Reply>> = [
      { admin_mfa_get: 'throw' },
      { admin_mfa_get: { data: { status: 'none' } }, admin_mfa_begin: { error: { message: 'Invalid two-step secret' } } },
    ];
    for (const replies of failures) {
      reset({ replies: { ...setupStep, ...replies } });
      assert.equal((await startSetup()).status, 500, JSON.stringify(replies));
    }
  });
});

describe('POST /api/auth/mfa/enroll/confirm', () => {
  const unfinished = factor({ status: 'pending', confirmed_at: null, created_at: new Date().toISOString() });
  const setupStep = {
    admin_challenge_attempt: { data: { ok: true, admin_id: ADMIN_ID, purpose: 'mfa_enroll', attempts_left: 3 } },
    admin_challenge_consume: { data: { ok: true, admin_id: ADMIN_ID, token_version: 4 } },
    admin_mfa_get: unfinished,
    admin_session_open: opened(['pwd', 'otp'], 5),
  };

  test('only an unfinished setup can be confirmed', async () => {
    for (const mfa of [{ data: { status: 'none' } }, factor()] as Reply[]) {
      reset({ replies: { ...setupStep, admin_mfa_get: mfa } });
      const res = await confirmWith({ otp: currentCode().code });
      assertStepEnded(res, await bodyOf(res));
      assert.deepEqual(callsTo('admin_mfa_activate'), []);
    }
  });

  test('a code that is not six digits is refused, and setup codes are never counted toward the lock', async () => {
    reset({ replies: setupStep });
    const malformed = await confirmWith({ otp: '12ab56' });
    assert.equal(malformed.status, 400);
    assert.deepEqual((await bodyOf(malformed)).details, { field: 'otp', attempts_left: 3 });
    reset({ replies: setupStep });
    const wrong = await confirmWith({ otp: wrongCode() });
    assert.equal(wrong.status, 400);
    assert.deepEqual(withoutRequestId(await bodyOf(wrong)), {
      success: false, error: SETUP_CODE_WRONG, code: 'VALIDATION_ERROR', message: SETUP_CODE_WRONG,
      details: { field: 'otp', attempts_left: 3 },
    });
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    assert.deepEqual(callsTo('admin_challenge_consume'), []);
    assert.deepEqual(audits(), []);
  });

  test('a right code ends the step first, then turns two-step sign-in on with ten new recovery codes and signs in', async () => {
    reset({ replies: setupStep });
    const { code, step } = currentCode();
    const res = await confirmWith({ otp: code });
    assertSignedIn(res, ['pwd', 'otp'], 5);
    const body = await bodyOf(res);
    assert.equal(body.step, 'done');
    const codes = body.recovery_codes as string[];
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    for (const recovery of codes) assert.match(recovery, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    const [activate] = callsTo('admin_mfa_activate');
    assert.equal(activate?.p_admin_id, ADMIN_ID);
    assert.equal(activate?.p_step, step);
    assert.equal(activate?.p_keep_sid, null);
    assert.deepEqual(activate?.p_recovery_hashes, codes.map((recovery) => hashRecoveryCode(recovery, ADMIN_ID, 1)));
    const order = state.timeline.filter((entry) => entry.startsWith('rpc:'));
    assert.ok(order.indexOf('rpc:admin_challenge_consume') < order.indexOf('rpc:admin_mfa_activate'));
    assert.ok(order.indexOf('rpc:admin_mfa_activate') < order.indexOf('rpc:admin_session_open'));
    assert.deepEqual(audits().map((row) => row.action), ['MFA_ENABLED', 'LOGIN']);
    assert.deepEqual(pick(audits()[0], AUDIT_KEYS), auditRow({
      action: 'MFA_ENABLED',
      result: 'success',
      after_value: { client: 'web', during_sign_in: true, sessions_revoked: 2, recovery_codes_left: 10 },
    }));
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    assertNoSecretsAnywhere(codes);
  });

  test('a step that ended before activation leaves two-step sign-in off', async () => {
    reset({ replies: { ...setupStep, admin_challenge_consume: { data: { ok: false, reason: 'invalid' } } } });
    const res = await confirmWith({ otp: currentCode().code });
    assertStepEnded(res, await bodyOf(res));
    assert.deepEqual(callsTo('admin_mfa_activate'), []);
  });

  test('an activation the database refuses ends the step, and one that fails is a 500', async () => {
    reset({ replies: { ...setupStep, admin_mfa_activate: { data: { ok: false, reason: 'not_pending' } } } });
    const refused = await confirmWith({ otp: currentCode().code });
    assertStepEnded(refused, await bodyOf(refused));
    assert.deepEqual(audits(), []);
    reset({ replies: { ...setupStep, admin_mfa_activate: { error: { message: 'Invalid time step' } } } });
    const failed = await confirmWith({ otp: currentCode().code });
    assert.equal(failed.status, 500);
    assertNoSession(failed);
  });

  test('without the key the code cannot be checked, so nothing is consumed or activated', async () => {
    reset({ replies: setupStep });
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    const res = await confirmWith({ otp: currentCode().code });
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, TWO_STEP_UNAVAILABLE);
    assert.deepEqual(callsTo('admin_challenge_consume'), []);
    assert.deepEqual(callsTo('admin_mfa_activate'), []);
  });
});

describe('POST /api/account/reauth', () => {
  function signedInAdmin(mfa: 'none' | 'pending' | 'active', withSession = true): Record<string, unknown> {
    return {
      admin_id: ADMIN_ID,
      username: USERNAME,
      role_title: ROLE,
      is_super_admin: false,
      page_permissions: [],
      token_version: 4,
      session: withSession
        ? { id: SID, client: 'web', amr: ['pwd'], createdAt: '2026-10-13T08:00:00Z', expiresAt: '2026-10-13T16:00:00Z', reauthAt: null, transport: 'cookie' }
        : null,
      mfa: { status: mfa, lockedUntil: null },
      policy: { mode: 'off', graceEndsAt: null, requiredNow: false },
    };
  }

  function asAdmin(mfa: 'none' | 'pending' | 'active', patch: Parameters<typeof reset>[0] = {}): void {
    const replies: Record<string, Reply> = mfa === 'active'
      ? {}
      : { admin_mfa_get: mfa === 'none' ? { data: { status: 'none' } } : factor({ status: 'pending', confirmed_at: null }) };
    reset({ ...patch, replies: { ...replies, ...(patch?.replies ?? {}) } });
    state.requestAdmin = signedInAdmin(mfa);
  }

  test('needs a signed-in session that has an id; anything else is the expired-session 401', async () => {
    const none = await reauthWith({ otp: '123456' });
    assert.equal(none.status, 401);
    reset();
    state.requestAdmin = signedInAdmin('none', false);
    const legacy = await reauthWith({ password: PASSWORD });
    assert.equal(legacy.status, 401);
    assert.equal((await bodyOf(legacy)).code, 'AUTH_REQUIRED');
    assert.deepEqual(state.rpcs, []);
    assert.deepEqual(state.queries, []);
  });

  test('an unreadable body is a 400 before the limit', async () => {
    asAdmin('none');
    const res = await reauthWith(undefined, 'not json');
    assert.equal(res.status, 400);
    assert.equal(res.status === 400 ? (await bodyOf(res)).code : null, 'VALIDATION_ERROR');
    assert.deepEqual(state.rpcs, []);
  });

  test('every check counts against the admin, 5 in 15 minutes, and the limit fails closed', async () => {
    asAdmin('none');
    await reauthWith({ password: PASSWORD });
    assert.deepEqual(callsTo('check_rate_limit_by_key'), [{ p_key: `admin:${ADMIN_ID}`, p_action: 'admin_reauth', p_limit: 5, p_window_secs: 900 }]);
    const cases: Array<[Reply, number]> = [
      [{ data: false }, 429],
      [{ error: { message: 'duplicate key value', code: '23505' } }, 429],
      [{ error: { message: 'rate limit store unavailable' } }, 500],
      ['throw', 500],
    ];
    for (const [reply, status] of cases) {
      asAdmin('none', { replies: { check_rate_limit_by_key: reply } });
      const res = await reauthWith({ password: PASSWORD });
      assert.equal(res.status, status, JSON.stringify(reply));
      assert.deepEqual(state.compares, []);
      assert.deepEqual(callsTo('admin_session_mark_reauth'), []);
    }
  });

  test('with two-step sign-in on, a right code marks this session as freshly checked', async () => {
    asAdmin('active');
    const { code, step } = currentCode();
    const res = await reauthWith({ otp: code });
    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), {
      success: true, request_id: REQUEST_ID, reauth_at: '2026-10-13T10:00:00.123+00:00', valid_for_secs: 300,
    });
    assert.deepEqual(callsTo('admin_mfa_use_step'), [{ p_admin_id: ADMIN_ID, p_step: step }]);
    assert.deepEqual(callsTo('admin_session_mark_reauth'), [{ p_admin_id: ADMIN_ID, p_sid: SID }]);
    assert.deepEqual(pick(audits()[0], AUDIT_KEYS), auditRow({
      action: 'REAUTH', result: 'success', after_value: { client: 'web', method: 'otp', session_id: SID },
    }));
    assert.deepEqual(state.compares, []);
  });

  test('with two-step sign-in on, a password alone is refused on the code field', async () => {
    asAdmin('active');
    const res = await reauthWith({ password: PASSWORD });
    assert.equal(res.status, 400);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), {
      success: false, error: REAUTH_ENTER_CODE, code: 'VALIDATION_ERROR', message: REAUTH_ENTER_CODE, details: { field: 'otp' },
    });
    assert.deepEqual(state.compares, []);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
  });

  test('a wrong or reused code is a 400, never a 401, and is counted and audited as a failed check', async () => {
    asAdmin('active');
    const wrong = await reauthWith({ otp: wrongCode() });
    assert.equal(wrong.status, 400);
    assert.equal((await bodyOf(wrong)).error, REAUTH_CODE_WRONG);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), [{ p_admin_id: ADMIN_ID }]);
    assert.deepEqual(pick(audits()[0], AUDIT_KEYS), auditRow({ action: 'REAUTH_FAILED', error: 'Two-step code did not match.' }));
    asAdmin('active', { replies: { admin_mfa_use_step: { data: { ok: false, reason: 'replay' } } } });
    const reused = await reauthWith({ otp: currentCode().code });
    assert.equal(reused.status, 400);
    assert.equal((await bodyOf(reused)).error, CODE_ALREADY_USED);
    assert.deepEqual(callsTo('admin_session_mark_reauth'), []);
  });

  test('a code that locks two-step sign-in answers 429 and audits the lock', async () => {
    const lockedUntil = new Date(Date.now() + 15 * MINUTE_MS).toISOString();
    asAdmin('active', { replies: { admin_mfa_record_failure: failure({ failed_count: 10, locked: true, locked_until: lockedUntil, just_locked: true, lock_minutes: 15 }) } });
    const res = await reauthWith({ otp: wrongCode() });
    assert.equal(res.status, 429);
    assert.deepEqual((await bodyOf(res)).details, { reason: 'mfa_locked', locked_until: lockedUntil });
    assert.deepEqual(audits().map((row) => row.action), ['REAUTH_FAILED', 'MFA_LOCKED']);
  });

  test('while locked, nothing is counted and no code is computed', async () => {
    asAdmin('active', { replies: { admin_mfa_get: factor({ locked_until: '2026-10-13T14:05:00+00:00' }) } });
    const { code } = currentCode();
    const count = watchTotp();
    const res = await reauthWith({ otp: code });
    assert.equal(res.status, 429);
    assert.equal(count(), 0);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    assert.deepEqual(callsTo('admin_mfa_use_step'), []);
    assert.deepEqual(pick(audits()[0], AUDIT_KEYS), auditRow({ action: 'REAUTH_FAILED', error: 'Two-step sign-in is locked.' }));
  });

  test('a two-step reset during the check is a 409, a malformed code a 400, and no key a 500', async () => {
    asAdmin('active', { replies: { admin_mfa_use_step: { data: { ok: false, reason: 'not_active' } } } });
    assert.equal((await reauthWith({ otp: currentCode().code })).status, 409);
    asAdmin('active');
    const malformed = await reauthWith({ otp: '12345' });
    assert.equal(malformed.status, 400);
    assert.deepEqual(callsTo('admin_mfa_record_failure'), []);
    asAdmin('active');
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    const keyless = await reauthWith({ otp: currentCode().code });
    assert.equal(keyless.status, 500);
    assert.equal((await bodyOf(keyless)).error, TWO_STEP_UNAVAILABLE);
  });

  test('without two-step sign-in, the password is checked against a fresh read of the stored hash', async () => {
    for (const mfa of ['none', 'pending'] as const) {
      asAdmin(mfa);
      const res = await reauthWith({ password: PASSWORD });
      assert.equal(res.status, 200, mfa);
      const read = state.queries.find((query) => query.table === 'admin_users');
      assert.equal(read?.columns, 'password_hash');
      assert.deepEqual(read?.filters, [['eq', 'id', ADMIN_ID], ['eq', 'is_active', true], ['is', 'deleted_at', null]]);
      assert.deepEqual(state.compares, [[PASSWORD, STORED_HASH]]);
      assert.deepEqual(callsTo('admin_session_mark_reauth'), [{ p_admin_id: ADMIN_ID, p_sid: SID }]);
      assert.equal(audits()[0]?.action, 'REAUTH');
      assert.deepEqual(audits()[0]?.after_value, { client: 'web', method: 'password', session_id: SID });
    }
  });

  test('a wrong password is a 400 on the password field, never a 401, and is audited', async () => {
    asAdmin('none');
    const res = await reauthWith({ password: 'not-the-password' });
    assert.equal(res.status, 400);
    assert.deepEqual((await bodyOf(res)).details, { field: 'password' });
    assert.deepEqual(pick(audits()[0], AUDIT_KEYS), auditRow({
      action: 'REAUTH_FAILED', error: 'Password did not match.', after_value: { client: 'web', method: 'password' },
    }));
    assert.deepEqual(callsTo('admin_session_mark_reauth'), []);
    assertNoSecretsAnywhere(['not-the-password', STORED_HASH]);
  });

  test('a missing password or stored hash fails the check without bcrypt; a vanished account is a 401', async () => {
    asAdmin('none');
    assert.equal((await reauthWith({ otp: '123456' })).status, 400);
    assert.deepEqual(state.queries.filter((query) => query.table === 'admin_users'), []);
    asAdmin('none', { hashRow: { password_hash: null } });
    assert.equal((await reauthWith({ password: PASSWORD })).status, 400);
    assert.deepEqual(state.compares, []);
    asAdmin('none', { hashRow: null });
    assert.equal((await reauthWith({ password: PASSWORD })).status, 401);
  });

  test('a session that ended before the check was saved is a 401, and a failed save is a 500', async () => {
    asAdmin('none', { replies: { admin_session_mark_reauth: { data: { ok: false, reauth_at: null } } } });
    assert.equal((await reauthWith({ password: PASSWORD })).status, 401);
    assert.ok(!audits().some((row) => row.action === 'REAUTH'));
    asAdmin('none', { replies: { admin_session_mark_reauth: { error: { message: 'connection terminated' } } } });
    assert.equal((await reauthWith({ password: PASSWORD })).status, 500);
  });
});

describe('route sources', () => {
  const sources = Object.values(ROUTES).map((path) => [path, readFileSync(resolve(APP_DIR, path), 'utf8')] as const);

  test('carry no prose comments, and neither does this test', () => {
    for (const [path, source] of [...sources, ['test/mfaLogin.test.ts', readFileSync(TEST_FILE, 'utf8')] as const]) {
      assert.doesNotMatch(source, /\/\*|(^|[^:])\/\/(?!\/)/m, path);
    }
  });

  test('read only otp and recovery_code from the body, never code, and use the envelope', () => {
    for (const [path, source] of sources) {
      assert.doesNotMatch(source, /\.code\b(?!_)|\['code'\]|record\.code/, path);
      assert.doesNotMatch(source, /NextResponse\.json\(|from\('audit_log'\)|x-forwarded-for|'use client'/, path);
      assert.doesNotMatch(source, /status: 401|REAUTH_REQUIRED|MFA_REQUIRED/, path);
    }
  });

  test('the routes that hand out a secret or codes do so without caching', () => {
    const start = sources.find(([path]) => path === ROUTES.start)?.[1] ?? '';
    assert.match(start, /headers: \{ \.\.\.NO_STORE \}/);
    const confirmSource = sources.find(([path]) => path === ROUTES.confirm)?.[1] ?? '';
    assert.match(confirmSource, /signedIn\(admin, opened, actor, \{ recovery_codes: codes \}, true\)/);
  });
});
