import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const STATE_KEY = '__cardeliteAdminSecurityTest';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const TEST_FILE = fileURLToPath(import.meta.url);

const ROUTES = {
  accounts: 'api/admin-accounts/route.ts',
  sessions: 'api/admin-accounts/[id]/sessions/route.ts',
  session: 'api/admin-accounts/[id]/sessions/[sid]/route.ts',
  reset: 'api/admin-accounts/[id]/mfa/route.ts',
  policy: 'api/admin-settings/security-policy/route.ts',
} as const;

const NEW_ROUTES = [ROUTES.sessions, ROUTES.session, ROUTES.reset, ROUTES.policy] as const;
const MOBILE_CALLED = ['api/admin-accounts/route.ts', 'api/admin-settings/route.ts'] as const;
const WEB_INVITE_BRANCH = /if \(admin\.session\.client === 'mobile'\) return createForPhone\(req, admin\);[\s\S]*?return inviteFromWeb\(req, admin\);/;

const ACTOR_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const TARGET_ID = '11111111-2222-4333-8444-555555555555';
const DELETED_ID = '22222222-3333-4444-8555-666666666666';
const SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
const TARGET_SID = '9e8d7c6b-5a49-4382-a716-05f4e3d2c1b0';
const MFA_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const REQUEST_ID = 'req_adminsecur01';
const USER_AGENT = 'Mozilla/5.0 (CardElite admin security test)';
const CLIENT_IP = '198.51.100.9';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const REASON = 'Lost phone, confirmed by call';
const GRACE = '2026-10-27T10:00:00+00:00';

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

type Reply = DbResult | 'throw' | ((args: Record<string, unknown> | undefined) => DbResult | 'throw');

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
  args: Record<string, unknown> | undefined;
}

interface StubState {
  replies: Map<string, Reply>;
  rpcs: RpcCall[];
  queries: Query[];
  timeline: string[];
  claims: Record<string, unknown> | null;
  adminRows: DbResult | 'throw';
  auditError: string | null;
  db: {
    from(table: string): object;
    rpc(name: string, args: Record<string, unknown> | undefined): Promise<DbResult>;
  };
}

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface RouteModule {
  GET?: Handler;
  PATCH?: Handler;
  DELETE?: Handler;
}

const logs: string[] = [];

const state: StubState = {
  replies: new Map(),
  rpcs: [],
  queries: [],
  timeline: [],
  claims: null,
  adminRows: { data: [] },
  auditError: null,
  db: {
    from: (table) => chain(table),
    rpc: (name, args) => rpc(name, args),
  },
};

Reflect.set(globalThis, STATE_KEY, state);

function rpc(name: string, args: Record<string, unknown> | undefined): Promise<DbResult> {
  state.rpcs.push({ name, args });
  state.timeline.push(`rpc:${name}`);
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
  if (query.table === 'admin_users' && query.op === 'select') return state.adminRows;
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
    order: filter('order'),
    then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          const answer = respond(query);
          state.timeline.push(`resolved:${query.table}`);
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

const FILE_STUBS: Readonly<Record<string, string>> = {
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: stub([
    'export const supabaseAdmin = {',
    '  from(table) { return state().db.from(table); },',
    '  rpc(name, args) { return state().db.rpc(name, args); },',
    '};',
  ]),
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: stub(['export async function verifyAdminFromRequest() { return state().claims; }']),
  [resolve(APP_DIR, 'lib', 'mfa.ts')]: pathToFileURL(resolve(APP_DIR, 'lib', 'mfa.ts')).href,
};

const PACKAGE_STUBS: Readonly<Record<string, string>> = {
  'next/server': moduleUrl('export const NextResponse = { json: (body, init) => Response.json(body, init) };'),
  'next/headers': stub([
    'export async function headers() {',
    `  return new Headers({ 'x-request-id': '${REQUEST_ID}', 'user-agent': '${USER_AGENT}', 'x-forwarded-for': '${CLIENT_IP}' });`,
    '}',
    'export async function cookies() { return { get: () => undefined }; }',
  ]),
  bcryptjs: moduleUrl('export default { hash: async () => "unused", compare: async () => false };'),
};

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
      targets.set(specifier, FILE_STUBS[path] ?? (await bundle(path)));
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

const routes = {} as Record<keyof typeof ROUTES, RouteModule>;

before(async () => {
  for (const [key, path] of Object.entries(ROUTES)) {
    routes[key as keyof typeof ROUTES] = (await import(await bundle(resolve(APP_DIR, path)))) as RouteModule;
  }
});

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function freshSession(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SID,
    client: 'web',
    amr: ['otp', 'pwd'],
    createdAt: iso(-HOUR_MS),
    expiresAt: iso(7 * HOUR_MS),
    reauthAt: iso(-MINUTE_MS),
    transport: 'cookie',
    ...patch,
  };
}

function superAdmin(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    admin_id: ACTOR_ID,
    username: 'owner',
    role_title: 'Super Admin',
    is_super_admin: true,
    page_permissions: [],
    token_version: 7,
    session: freshSession(),
    mfa: { status: 'active', lockedUntil: null },
    policy: { mode: 'off', graceEndsAt: null, requiredNow: false },
    ...patch,
  };
}

const staleSession = () => freshSession({ createdAt: iso(-HOUR_MS), reauthAt: iso(-10 * MINUTE_MS) });

function adminRow(id: string, username: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    username,
    email: `${username}@cardelite.ng`,
    role_title: 'Card Reviewer',
    page_permissions: ['card_queue'],
    last_login_at: '2026-10-12T09:00:00.000Z',
    is_active: true,
    is_super_admin: false,
    deleted_at: null,
    created_at: '2026-01-02T09:00:00.000Z',
    ...patch,
  };
}

function overviewRow(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    admin_id: id,
    mfa_status: 'none',
    mfa_confirmed_at: null,
    recovery_codes_left: 0,
    live_sessions: 0,
    last_seen_at: null,
    mfa_locked_until: null,
    mfa_last_used_at: null,
    ...patch,
  };
}

function sessionRow(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    client: 'mobile',
    auth_methods: ['otp', 'pwd'],
    created_at: '2026-10-13T08:00:00+00:00',
    last_seen_at: '2026-10-13T09:30:00+00:00',
    expires_at: '2026-10-14T08:00:00+00:00',
    ip: '102.89.34.1',
    user_agent: 'okhttp/4.9.0',
    ...patch,
  };
}

function baseReplies(): Map<string, Reply> {
  return new Map<string, Reply>([
    ['admin_security_overview', {
      data: [
        overviewRow(ACTOR_ID, {
          mfa_status: 'active', mfa_confirmed_at: '2026-10-01T09:01:00+00:00', recovery_codes_left: 8, live_sessions: 2,
          last_seen_at: '2026-10-13T09:59:00+00:00', mfa_last_used_at: '2026-10-13T08:00:00+00:00',
        }),
        overviewRow(TARGET_ID, { mfa_status: 'pending', live_sessions: 1, last_seen_at: '2026-10-13T09:30:00+00:00' }),
      ],
    }],
    ['admin_sessions_list', { data: [sessionRow(TARGET_SID), sessionRow(SID, { client: 'web', user_agent: 'Mozilla/5.0' })] }],
    ['admin_session_revoke', { data: { revoked: true, client: 'mobile', push_tokens_released: 1 } }],
    ['admin_mfa_reset', {
      data: { ok: true, previous_status: 'active', recovery_codes_removed: 6, sessions_revoked: 2, token_version: 9 },
    }],
    ['admin_security_policy_get', {
      data: { mfa_mode: 'all', mfa_grace_ends_at: GRACE, mfa_required_now: false, updated_at: '2026-10-13T10:00:00+00:00', updated_by: ACTOR_ID },
    }],
    ['admin_security_policy_set', (args) => ({
      data: { changed: true, mfa_mode: args?.p_mfa_mode, mfa_grace_ends_at: args?.p_mfa_mode === 'all' ? GRACE : null },
    })],
  ]);
}

function reset(replies: Record<string, Reply> = {}, claims: Record<string, unknown> | null = superAdmin()): void {
  state.replies = baseReplies();
  for (const [name, reply] of Object.entries(replies)) state.replies.set(name, reply);
  state.rpcs = [];
  state.queries = [];
  state.timeline = [];
  state.claims = claims;
  state.adminRows = { data: [] };
  state.auditError = null;
  logs.length = 0;
}

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

function call(route: RouteModule, method: 'GET' | 'PATCH' | 'DELETE', path: string, body?: unknown, params?: Record<string, string>) {
  const handler = route[method];
  assert.ok(handler, `${path} has no ${method} handler`);
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler(req, { params: Promise.resolve(params ?? {}) });
}

const listAccounts = () => call(routes.accounts, 'GET', '/api/admin-accounts');
const listDevices = (id: string) => call(routes.sessions, 'GET', `/api/admin-accounts/${id}/sessions`, undefined, { id });
const signOutDevice = (id: string, sid: string, body?: unknown) =>
  call(routes.session, 'DELETE', `/api/admin-accounts/${id}/sessions/${sid}`, body, { id, sid });
const resetTwoStep = (id: string, body?: unknown) => call(routes.reset, 'DELETE', `/api/admin-accounts/${id}/mfa`, body, { id });
const readPolicy = () => call(routes.policy, 'GET', '/api/admin-settings/security-policy');
const changePolicy = (body: unknown) => call(routes.policy, 'PATCH', '/api/admin-settings/security-policy', body);

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function withoutRequestId(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  delete copy.request_id;
  return copy;
}

function callsTo(name: string): Array<Record<string, unknown> | undefined> {
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
    admin_id: ACTOR_ID,
    action: null,
    entity: 'admin_users',
    entity_id: TARGET_ID,
    before_value: null,
    after_value: null,
    ip_address: CLIENT_IP,
    admin_role: 'Super Admin',
    user_agent: USER_AGENT,
    request_id: REQUEST_ID,
    reason: REASON,
    result: 'success',
    error: null,
    sensitivity: 'security',
    ...patch,
  };
}

function failureBody(code: string, message: string, details?: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = { success: false, error: message, code, message };
  if (details !== undefined) body.details = details;
  return body;
}

describe('GET /api/admin-accounts: two-step status', () => {
  const rows = () => [
    adminRow(ACTOR_ID, 'owner', { is_super_admin: true, role_title: 'Super Admin' }),
    adminRow(TARGET_ID.toUpperCase(), 'ada'),
    adminRow(DELETED_ID, 'gone', { is_active: false, deleted_at: '2026-09-01T00:00:00.000Z' }),
  ];

  test('keeps every listed field and adds the two-step status of each account, read alongside the list', async () => {
    reset({}, superAdmin({ policy: { mode: 'all', graceEndsAt: GRACE, requiredNow: false } }));
    state.adminRows = { data: rows() };
    const res = await listAccounts();
    assert.equal(res.status, 200);
    const body = await bodyOf(res);
    assert.equal(body.current_admin_id, ACTOR_ID);
    const admins = body.admins as Array<Record<string, unknown>>;
    const [owner, ada, gone] = admins;
    const listed = rows();
    for (const [index, row] of admins.entries()) {
      assert.deepEqual(pick(row, Object.keys(listed[index])), listed[index]);
    }
    assert.deepEqual(pick(owner, ['mfa_status', 'mfa_confirmed_at', 'mfa_locked_until', 'mfa_last_used_at', 'recovery_codes_left', 'live_sessions', 'last_seen_at']), {
      mfa_status: 'active',
      mfa_confirmed_at: '2026-10-01T09:01:00+00:00',
      mfa_locked_until: null,
      mfa_last_used_at: '2026-10-13T08:00:00+00:00',
      recovery_codes_left: 8,
      live_sessions: 2,
      last_seen_at: '2026-10-13T09:59:00+00:00',
    });
    assert.equal(ada?.mfa_status, 'pending');
    assert.equal(ada?.live_sessions, 1);
    assert.deepEqual(pick(gone, ['mfa_status', 'recovery_codes_left', 'live_sessions']), {
      mfa_status: null, recovery_codes_left: null, live_sessions: null,
    });
    assert.deepEqual(body.security, {
      mfa_mode: 'all', mfa_grace_ends_at: GRACE, mfa_required_now: false, actor_mfa_status: 'active', status_loaded: true,
    });
    assert.deepEqual(callsTo('admin_security_overview'), [undefined]);
    assert.ok(state.timeline.indexOf('rpc:admin_security_overview') < state.timeline.indexOf('resolved:admin_users'));
  });

  test('a lock still in force is passed through for the Locked badge', async () => {
    reset({ admin_security_overview: { data: [overviewRow(TARGET_ID, { mfa_status: 'active', mfa_locked_until: '2026-10-14T09:00:00+00:00' })] } });
    state.adminRows = { data: [adminRow(TARGET_ID, 'ada')] };
    const [ada] = (await bodyOf(await listAccounts())).admins as Array<Record<string, unknown>>;
    assert.equal(ada?.mfa_locked_until, '2026-10-14T09:00:00+00:00');
  });

  test('an overview that cannot be read leaves the list working, with the new fields null', async () => {
    for (const reply of [{ error: { message: 'Could not find the function' } }, 'throw', { data: { not: 'rows' } }] as Reply[]) {
      reset({ admin_security_overview: reply });
      state.adminRows = { data: rows() };
      const res = await listAccounts();
      assert.equal(res.status, 200, JSON.stringify(reply));
      const body = await bodyOf(res);
      for (const row of body.admins as Array<Record<string, unknown>>) {
        assert.equal(row.mfa_status, null);
        assert.equal(row.live_sessions, null);
      }
      assert.equal((body.security as Record<string, unknown>).status_loaded, false);
      assert.ok(logs.some((line) => line.startsWith('admin security overview read:')));
    }
  });

  test('a list that fails is still the existing 500, and only super admins may list', async () => {
    reset();
    state.adminRows = { error: { message: 'connection terminated' } };
    const res = await listAccounts();
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, 'Admin accounts could not be loaded.');
    reset({}, superAdmin({ is_super_admin: false }));
    assert.equal((await listAccounts()).status, 403);
    reset({}, null);
    assert.equal((await listAccounts()).status, 401);
  });
});

describe('GET /api/admin-accounts/[id]/sessions', () => {
  test('lists the live sessions of another admin for a super admin, without caching and with none marked current', async () => {
    const res = await listDevices(TARGET_ID.toUpperCase());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const sessions = (await bodyOf(res)).sessions as Array<Record<string, unknown>>;
    assert.deepEqual(callsTo('admin_sessions_list'), [{ p_admin_id: TARGET_ID }]);
    assert.deepEqual(sessions[0], {
      id: TARGET_SID,
      client: 'mobile',
      user_agent: 'okhttp/4.9.0',
      ip: '102.89.34.1',
      auth_methods: ['otp', 'pwd'],
      created_at: '2026-10-13T08:00:00+00:00',
      last_seen_at: '2026-10-13T09:30:00+00:00',
      expires_at: '2026-10-14T08:00:00+00:00',
      current: false,
    });
    assert.ok(sessions.every((row) => row.current === false));
  });

  test('a super admin looking at their own account sees this device first and marked', async () => {
    const sessions = (await bodyOf(await listDevices(ACTOR_ID))).sessions as Array<Record<string, unknown>>;
    assert.deepEqual(sessions.map((row) => [row.id, row.current]), [[SID, true], [TARGET_SID, false]]);
  });

  test('a bad id is a 400, a store outage a 500, and anyone but a super admin is refused', async () => {
    assert.equal((await listDevices('not-an-id')).status, 400);
    assert.deepEqual(state.rpcs, []);
    reset({ admin_sessions_list: { error: { message: 'connection terminated' } } });
    const res = await listDevices(TARGET_ID);
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, 'The signed-in devices could not be loaded. Try again.');
    reset({}, superAdmin({ is_super_admin: false }));
    assert.equal((await listDevices(TARGET_ID)).status, 403);
    assert.deepEqual(state.rpcs, []);
  });
});

describe('DELETE /api/admin-accounts/[id]/sessions/[sid]', () => {
  test('signs one device of another admin out with a reason and audits it against that admin', async () => {
    const res = await signOutDevice(TARGET_ID, TARGET_SID.toUpperCase(), { reason: `  ${REASON}  ` });
    assert.equal(res.status, 200);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), { success: true, revoked: true, audit_recorded: true });
    assert.deepEqual(callsTo('admin_session_revoke'), [{
      p_admin_id: TARGET_ID, p_sid: TARGET_SID, p_actor: ACTOR_ID, p_reason: 'revoked_by_admin',
    }]);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [auditRow({
      action: 'ADMIN_SESSION_REVOKED',
      after_value: { session_id: TARGET_SID, session_client: 'mobile', by: 'super_admin', push_tokens_released: 1 },
    })]);
  });

  test('needs no fresh identity check, because it only ends a session', async () => {
    reset({}, superAdmin({ session: staleSession(), mfa: { status: 'none', lockedUntil: null } }));
    assert.equal((await signOutDevice(TARGET_ID, TARGET_SID, { reason: REASON })).status, 200);
  });

  test('your own devices are managed on your Profile', async () => {
    const res = await signOutDevice(ACTOR_ID.toUpperCase(), SID, { reason: REASON });
    assert.equal(res.status, 400);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), failureBody('VALIDATION_ERROR', 'Manage your own devices on your Profile.'));
    assert.deepEqual(state.rpcs, []);
  });

  test('ids must be uuids and the reason 3 to 500 characters', async () => {
    assert.equal((await signOutDevice('nope', TARGET_SID, { reason: REASON })).status, 400);
    assert.equal((await signOutDevice(TARGET_ID, 'nope', { reason: REASON })).status, 400);
    const cases: Array<[unknown, string]> = [
      [undefined, 'Give a reason of at least 3 characters.'],
      [{}, 'Give a reason of at least 3 characters.'],
      [{ reason: '   ok  ' }, 'Give a reason of at least 3 characters.'],
      [{ reason: '\u{1F44D}\u{1F44D}' }, 'Give a reason of at least 3 characters.'],
      [{ reason: 42 }, 'Give a reason of at least 3 characters.'],
      [{ reason: 'x'.repeat(501) }, 'The reason must be 500 characters or fewer.'],
    ];
    for (const [body, message] of cases) {
      const res = await signOutDevice(TARGET_ID, TARGET_SID, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(withoutRequestId(await bodyOf(res)), failureBody('VALIDATION_ERROR', message, { field: 'reason' }));
    }
    assert.deepEqual(state.rpcs, []);
    assert.equal((await signOutDevice(TARGET_ID, TARGET_SID, { reason: 'x'.repeat(500) })).status, 200);
  });

  test('a device already signed out answers revoked false without an audit row', async () => {
    reset({ admin_session_revoke: { data: { revoked: false } } });
    const res = await signOutDevice(TARGET_ID, TARGET_SID, { reason: REASON });
    assert.equal(res.status, 200);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), { success: true, revoked: false });
    assert.deepEqual(audits(), []);
  });

  test('a store that fails is a 500 with a failure audit that keeps the reason', async () => {
    for (const reply of [{ error: { message: 'Not authorized' } }, 'throw'] as Reply[]) {
      reset({ admin_session_revoke: reply });
      const res = await signOutDevice(TARGET_ID, TARGET_SID, { reason: REASON });
      assert.equal(res.status, 500);
      assert.deepEqual(pick(audits()[0], ['action', 'entity_id', 'reason', 'result']), {
        action: 'ADMIN_SESSION_REVOKED', entity_id: TARGET_ID, reason: REASON, result: 'failure',
      });
    }
  });
});

describe('DELETE /api/admin-accounts/[id]/mfa', () => {
  test('resets the two-step sign-in of another admin with a reason, signs them out and audits what was removed', async () => {
    const res = await resetTwoStep(TARGET_ID, { reason: ` ${REASON} ` });
    assert.equal(res.status, 200);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), {
      success: true, ok: true, previous_status: 'active', sessions_revoked: 2, audit_recorded: true,
    });
    assert.deepEqual(callsTo('admin_mfa_reset'), [{ p_actor: ACTOR_ID, p_target: TARGET_ID, p_reason: REASON }]);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [auditRow({
      action: 'MFA_RESET',
      before_value: { mfa_status: 'active', recovery_codes_left: 6 },
      after_value: { mfa_status: 'none', sessions_revoked: 2, token_version_bumped: true },
    })]);
  });

  test('checks in order: super admin, two-step sign-in on for the actor, a fresh code, then the target', async () => {
    reset({}, superAdmin({ is_super_admin: false, mfa: { status: 'none', lockedUntil: null } }));
    const notSuper = await resetTwoStep(ACTOR_ID, {});
    assert.equal(notSuper.status, 403);
    assert.equal((await bodyOf(notSuper)).code, 'PERMISSION_DENIED');

    reset({}, superAdmin({ mfa: { status: 'pending', lockedUntil: null }, session: staleSession() }));
    const noTwoStep = await resetTwoStep(ACTOR_ID, {});
    assert.equal(noTwoStep.status, 403);
    assert.deepEqual(withoutRequestId(await bodyOf(noTwoStep)), failureBody('MFA_REQUIRED', 'Set up two-step sign-in first.'));

    reset({}, superAdmin({ session: staleSession() }));
    const stale = await resetTwoStep(ACTOR_ID, {});
    assert.equal(stale.status, 403);
    assert.deepEqual(withoutRequestId(await bodyOf(stale)), failureBody(
      'REAUTH_REQUIRED', 'Confirm it is you to continue.', { method: 'otp', max_age_secs: 300 },
    ));

    reset();
    const self = await resetTwoStep(ACTOR_ID.toUpperCase(), { reason: REASON });
    assert.equal(self.status, 400);
    assert.equal(
      (await bodyOf(self)).error,
      'You cannot reset your own two-step sign-in. Another super administrator has to do it.',
    );
    assert.equal((await resetTwoStep('not-an-id', { reason: REASON })).status, 400);
    const noReason = await resetTwoStep(TARGET_ID, { reason: 'no' });
    assert.deepEqual((await bodyOf(noReason)).details, { field: 'reason' });
    assert.deepEqual(state.rpcs, []);
  });

  test('the database refusals map to 409, 404 and 400, and a pending setup can be reset too', async () => {
    const cases: Array<[string, number, string]> = [
      ['not_enrolled', 409, 'This admin has no two-step sign-in to reset.'],
      ['target_not_found', 404, 'Admin account not found.'],
      ['self', 400, 'You cannot reset your own two-step sign-in. Another super administrator has to do it.'],
      ['surprise', 500, 'Two-step sign-in could not be reset. Try again.'],
    ];
    for (const [reason, status, message] of cases) {
      reset({ admin_mfa_reset: { data: { ok: false, reason } } });
      const res = await resetTwoStep(TARGET_ID, { reason: REASON });
      assert.equal(res.status, status, reason);
      assert.equal((await bodyOf(res)).error, message);
      assert.deepEqual(audits(), []);
    }
    reset({ admin_mfa_reset: { data: { ok: true, previous_status: 'pending', recovery_codes_removed: 0, sessions_revoked: 1 } } });
    const pending = await bodyOf(await resetTwoStep(TARGET_ID, { reason: REASON }));
    assert.equal(pending.previous_status, 'pending');
    assert.deepEqual(audits()[0]?.before_value, { mfa_status: 'pending', recovery_codes_left: 0 });
  });

  test('a store that fails is a 500 with a failure audit, and a lost audit row is reported', async () => {
    for (const reply of [{ error: { message: 'A reason of 3 to 500 characters is required' } }, 'throw'] as Reply[]) {
      reset({ admin_mfa_reset: reply });
      const res = await resetTwoStep(TARGET_ID, { reason: REASON });
      assert.equal(res.status, 500);
      assert.deepEqual(pick(audits()[0], ['action', 'entity_id', 'reason', 'result']), {
        action: 'MFA_RESET', entity_id: TARGET_ID, reason: REASON, result: 'failure',
      });
    }
    reset();
    state.auditError = 'audit store down';
    const body = await bodyOf(await resetTwoStep(TARGET_ID, { reason: REASON }));
    assert.equal(body.audit_recorded, false);
    assert.equal(body.warning, 'Two-step sign-in was reset, but the change could not be written to the audit log.');
  });
});

describe('GET /api/admin-settings/security-policy', () => {
  const roster = () => [
    { id: ACTOR_ID, username: 'owner' },
    { id: TARGET_ID, username: 'ada' },
    { id: DELETED_ID.replace('2222', '3333'), username: 'tunde' },
  ];

  test('returns the policy, whether the key is set, the status of the actor and who still has to set it up, without caching', async () => {
    state.adminRows = { data: roster() };
    const res = await readPolicy();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(withoutRequestId(await bodyOf(res)), {
      success: true,
      mfa_mode: 'all',
      mfa_grace_ends_at: GRACE,
      mfa_required_now: false,
      updated_at: '2026-10-13T10:00:00+00:00',
      updated_by: ACTOR_ID,
      key_configured: true,
      actor_mfa_status: 'active',
      roster: {
        active: 3,
        enrolled: 1,
        missing: [{ id: TARGET_ID, username: 'ada' }, { id: DELETED_ID.replace('2222', '3333'), username: 'tunde' }],
      },
    });
    const read = state.queries.find((query) => query.table === 'admin_users');
    assert.equal(read?.columns, 'id, username');
    assert.deepEqual(read?.filters, [['eq', 'is_active', true], ['is', 'deleted_at', null], ['order', 'created_at', { ascending: true }]]);
  });

  test('says when the encryption key is missing, without printing anything about it', async () => {
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    state.adminRows = { data: roster() };
    const body = await bodyOf(await readPolicy());
    assert.equal(body.key_configured, false);
    Reflect.set(process.env, 'ADMIN_MFA_ENCRYPTION_KEY', 'not-a-key');
    assert.equal((await bodyOf(await readPolicy())).key_configured, false);
    assert.ok(!logs.some((line) => line.includes('not-a-key')));
  });

  test('any read that fails is a 500, and only super admins may read it', async () => {
    const failing: Array<[Record<string, Reply>, DbResult | 'throw']> = [
      [{ admin_security_policy_get: { error: { message: 'connection terminated' } } }, { data: roster() }],
      [{ admin_security_policy_get: { data: null } }, { data: roster() }],
      [{ admin_security_overview: 'throw' }, { data: roster() }],
      [{}, { error: { message: 'connection terminated' } }],
    ];
    for (const [replies, rows] of failing) {
      reset(replies);
      state.adminRows = rows;
      const res = await readPolicy();
      assert.equal(res.status, 500);
      assert.equal((await bodyOf(res)).error, 'The two-step requirement could not be loaded. Try again.');
    }
    reset({}, superAdmin({ is_super_admin: false }));
    assert.equal((await readPolicy()).status, 403);
  });
});

describe('PATCH /api/admin-settings/security-policy', () => {
  test('turning the requirement on starts the grace, is audited with before and after, and says so', async () => {
    const res = await changePolicy({ mfa_mode: 'all', reason: REASON });
    assert.equal(res.status, 200);
    assert.deepEqual(withoutRequestId(await bodyOf(res)), {
      success: true, changed: true, mfa_mode: 'all', mfa_grace_ends_at: GRACE, audit_recorded: true,
    });
    assert.deepEqual(callsTo('admin_security_policy_set'), [{ p_actor: ACTOR_ID, p_mfa_mode: 'all' }]);
    assert.deepEqual(audits().map((row) => pick(row, AUDIT_KEYS)), [auditRow({
      action: 'SECURITY_POLICY_CHANGED',
      entity: 'admin_security_policy',
      entity_id: null,
      before_value: { mfa_mode: 'off', mfa_grace_ends_at: null },
      after_value: { mfa_mode: 'all', mfa_grace_ends_at: GRACE },
    })]);
  });

  test('turning it off works without the key, and the same mode again changes nothing and writes nothing', async () => {
    reset({}, superAdmin({ policy: { mode: 'all', graceEndsAt: GRACE, requiredNow: false } }));
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    const off = await changePolicy({ mfa_mode: 'off', reason: REASON });
    assert.equal(off.status, 200);
    assert.deepEqual(audits()[0]?.before_value, { mfa_mode: 'all', mfa_grace_ends_at: GRACE });
    assert.deepEqual(audits()[0]?.after_value, { mfa_mode: 'off', mfa_grace_ends_at: null });
    reset({ admin_security_policy_set: { data: { changed: false, mfa_mode: 'off', mfa_grace_ends_at: null } } });
    const same = await changePolicy({ mfa_mode: 'off', reason: REASON });
    assert.deepEqual(withoutRequestId(await bodyOf(same)), { success: true, changed: false, mfa_mode: 'off', mfa_grace_ends_at: null });
    assert.deepEqual(audits(), []);
  });

  test('checks in order: super admin, two-step sign-in on for the actor, a fresh code, the request, then the key', async () => {
    reset({}, superAdmin({ is_super_admin: false }));
    assert.equal((await bodyOf(await changePolicy({ mfa_mode: 'all', reason: REASON }))).code, 'PERMISSION_DENIED');
    reset({}, superAdmin({ mfa: { status: 'none', lockedUntil: null }, session: staleSession() }));
    assert.equal((await bodyOf(await changePolicy({ mfa_mode: 'all', reason: REASON }))).code, 'MFA_REQUIRED');
    reset({}, superAdmin({ session: staleSession() }));
    const stale = await changePolicy({ mfa_mode: 'all', reason: REASON });
    assert.equal(stale.status, 403);
    assert.deepEqual((await bodyOf(stale)).details, { method: 'otp', max_age_secs: 300 });
    reset();
    const mode = await changePolicy({ mfa_mode: 'everyone', reason: REASON });
    assert.equal(mode.status, 400);
    assert.deepEqual((await bodyOf(mode)).details, { field: 'mfa_mode' });
    const reason = await changePolicy({ mfa_mode: 'all', reason: ' ' });
    assert.deepEqual((await bodyOf(reason)).details, { field: 'reason' });
    Reflect.deleteProperty(process.env, 'ADMIN_MFA_ENCRYPTION_KEY');
    const keyless = await changePolicy({ mfa_mode: 'all', reason: REASON });
    assert.equal(keyless.status, 409);
    assert.deepEqual(withoutRequestId(await bodyOf(keyless)), failureBody(
      'STATE_CONFLICT', 'Set ADMIN_MFA_ENCRYPTION_KEY before requiring two-step sign-in.', { reason: 'key_not_configured' },
    ));
    assert.deepEqual(state.rpcs, []);
    assert.deepEqual(audits(), []);
  });

  test('a store that fails is a 500 with a failure audit', async () => {
    reset({ admin_security_policy_set: { error: { message: 'Not authorized' } } });
    const res = await changePolicy({ mfa_mode: 'all', reason: REASON });
    assert.equal(res.status, 500);
    assert.equal((await bodyOf(res)).error, 'The two-step requirement could not be changed. Try again.');
    assert.deepEqual(pick(audits()[0], ['action', 'result', 'error', 'reason']), {
      action: 'SECURITY_POLICY_CHANGED', result: 'failure', error: 'Not authorized', reason: REASON,
    });
  });
});

describe('route sources', () => {
  const read = (path: string) => readFileSync(resolve(APP_DIR, path), 'utf8');

  test('carry no prose comments, and neither does this test', () => {
    for (const path of Object.values(ROUTES)) assert.doesNotMatch(read(path), /\/\*|(^|[^:])\/\/(?!\/)/m, path);
    assert.doesNotMatch(readFileSync(TEST_FILE, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m);
  });

  test('the new routes are for super admins only and answer through the shared envelope', () => {
    for (const path of NEW_ROUTES) {
      const source = read(path);
      assert.match(source, /requireSuperAdmin\(\)/, path);
      assert.doesNotMatch(source, /requireAdmin(?:Any|All)?\(|NextResponse\.json\(|from\('audit_log'\)\s*\.insert|'use client'|status: 401/, path);
      assert.doesNotMatch(source, /\.code\b(?!_)|\['code'\]|body\.code/, path);
    }
  });

  test('a fresh code is asked for only by the two-step reset and the policy switch, never on a route the app calls', () => {
    const guarded = [ROUTES.reset, ROUTES.policy] as const;
    for (const path of NEW_ROUTES) {
      const source = read(path);
      const expected = (guarded as readonly string[]).includes(path);
      assert.equal(/requireRecentAuth\(admin\)/.test(source), expected, path);
      assert.equal(/requireTwoStep\(admin\)/.test(source), expected, path);
    }
    for (const path of MOBILE_CALLED) {
      const phoneSide = read(path).replace(WEB_INVITE_BRANCH, '');
      assert.doesNotMatch(phoneSide, /requireRecentAuth\(|requireTwoStep\(|REAUTH_REQUIRED|MFA_REQUIRED/, path);
    }
  });

  test('each route writes its own audit action as a plain literal', () => {
    const owned: Array<[string, string]> = [
      [ROUTES.reset, 'MFA_RESET'],
      [ROUTES.session, 'ADMIN_SESSION_REVOKED'],
      [ROUTES.policy, 'SECURITY_POLICY_CHANGED'],
    ];
    for (const [path, action] of owned) assert.match(read(path), new RegExp(`action: '${action}'`), path);
    for (const path of Object.values(ROUTES)) assert.doesNotMatch(read(path), /action: 'MFA_BREAK_GLASS_RESET'/, path);
  });

  test('the policy reads are never gated by a fresh code, only the change is', () => {
    const source = read(ROUTES.policy);
    const get = source.slice(source.indexOf('export async function GET'), source.indexOf('export async function PATCH'));
    assert.doesNotMatch(get, /requireRecentAuth|requireTwoStep/);
  });

  test('never log a code, a secret, a token or a password', () => {
    for (const path of Object.values(ROUTES)) {
      for (const [, args] of read(path).matchAll(/console\.error\(([^;]*)\);/g)) {
        const code = args.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '');
        assert.doesNotMatch(code, /\b(?:code|codes|otp|secret|sealed|token|hashes|password)\b/, `${path}: ${args}`);
      }
    }
  });
});
