import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { loadAppModule } from './support/uiHarness.ts';

type GrantsModule = typeof import('../app/lib/grants.ts');

const STATE_KEY = '__adminAccessRouteTest';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const ROUTE_FILE = resolve(APP_DIR, 'api', 'admin-accounts', '[id]', 'access', 'route.ts');
const TEST_FILE = fileURLToPath(import.meta.url);

const ACTOR_ID = '11111111-2222-4333-8444-555555555555';
const TARGET_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const ROLE_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
const REQUEST_ID = 'req_adminaccess1';
const USER_AGENT = 'admin-access-route-test';
const CLIENT_IP = '198.51.100.11';
const REASON = 'Moving the Manager onto the role';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const MANAGER_KEYS = ['dashboard', 'users', 'withdrawals'];

const WEB_ONLY = 'Access can only be changed in the web console.';
const SUPER_ONLY = 'This action is restricted to super administrators.';
const SAVE_FAILED = 'The access change could not be confirmed. Reload the account and try again.';
const PREVIEW_FAILED = 'The access preview could not be loaded. Try again.';
const REASON_MESSAGE = 'Enter a reason of 3 to 500 characters.';

interface DbError {
  message: string;
  code?: string;
}

interface DbResult {
  data?: unknown;
  error?: DbError | null;
}

type Reply = DbResult | 'throw';

interface Query {
  table: string;
  op: string | null;
  payload: unknown;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown> | undefined;
}

interface StubState {
  reply: Reply;
  rpcs: RpcCall[];
  queries: Query[];
  claims: Record<string, unknown> | 'unavailable' | null;
  db: {
    from(table: string): object;
    rpc(name: string, args: Record<string, unknown> | undefined): Promise<DbResult>;
  };
}

interface AccessRoute {
  PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
}

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

const logs: string[] = [];

const state: StubState = {
  reply: { data: null },
  rpcs: [],
  queries: [],
  claims: null,
  db: {
    from: (table) => chain(table),
    rpc: (name, args) => rpc(name, args),
  },
};

Reflect.set(globalThis, STATE_KEY, state);

function rpc(name: string, args: Record<string, unknown> | undefined): Promise<DbResult> {
  state.rpcs.push({ name, args });
  if (name !== 'admin_set_access') return Promise.reject(new Error(`unexpected rpc ${name}`));
  if (state.reply === 'throw') return Promise.reject(new Error('fetch failed'));
  return Promise.resolve({ data: null, error: null, ...state.reply });
}

function chain(table: string): object {
  const query: Query = { table, op: null, payload: undefined };
  state.queries.push(query);
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    insert: (payload: unknown) => {
      query.op = 'insert';
      query.payload = payload;
      return builder;
    },
    then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          if (table === 'audit_log' && query.op === 'insert') return { data: null, error: null };
          throw new Error(`unexpected query ${JSON.stringify(query)}`);
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
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: stub([
    'export async function verifyAdminFromRequest() {',
    '  const claims = state().claims;',
    "  if (claims === 'unavailable') {",
    "    const error = new Error('The admin session could not be checked.');",
    "    error.name = 'SessionUnavailableError';",
    '    throw error;',
    '  }',
    '  return claims;',
    '}',
  ]),
};

const PACKAGE_STUBS: Readonly<Record<string, string>> = {
  'next/server': moduleUrl('export const NextResponse = { json: (body, init) => Response.json(body, init) };'),
  'next/headers': stub([
    'export async function headers() {',
    `  return new Headers({ 'x-request-id': '${REQUEST_ID}', 'user-agent': '${USER_AGENT}', 'x-forwarded-for': '${CLIENT_IP}' });`,
    '}',
    'export async function cookies() { return { get: () => undefined }; }',
  ]),
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

let route: AccessRoute;
let grants: GrantsModule;

before(async () => {
  route = (await import(await bundle(ROUTE_FILE))) as AccessRoute;
  grants = await loadAppModule<GrantsModule>('lib/grants.ts');
});

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function session(patch: Record<string, unknown> = {}): Record<string, unknown> {
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
    role: null,
    is_super_admin: true,
    page_permissions: [],
    token_version: 7,
    session: session(),
    mfa: { status: 'active', lockedUntil: null },
    policy: { mode: 'off', graceEndsAt: null, requiredNow: false },
    ...patch,
  };
}

const staleSession = () => session({ reauthAt: iso(-10 * MINUTE_MS) });
const phoneSession = () => session({ client: 'mobile', transport: 'bearer' });
const noTwoStep = { status: 'none', lockedUntil: null };

function expected(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { role_id: null, direct_permissions: [...MANAGER_KEYS], page_permissions: [...MANAGER_KEYS], ...patch };
}

function save(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { role_id: ROLE_ID, direct_permissions: [], expected: expected(), reason: REASON, ...patch };
}

function preview(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { role_id: ROLE_ID, direct_permissions: [], expected: expected(), dry_run: true, ...patch };
}

const MANAGER_PREVIEW: DbResult = {
  data: { ok: true, dry_run: true, before: MANAGER_KEYS, after: MANAGER_KEYS, direct: [], changed: false, signs_out: false },
};

const SAVED_ADMIN = { id: TARGET_ID, role_id: ROLE_ID, direct_permissions: [], page_permissions: MANAGER_KEYS };

const SAVED: DbResult = { data: { ok: true, changed: true, signed_out: false, admin: SAVED_ADMIN } };

function reset(reply: Reply = SAVED, claims: StubState['claims'] = superAdmin()): void {
  state.reply = reply;
  state.claims = claims;
  state.rpcs = [];
  state.queries = [];
  logs.length = 0;
}

beforeEach(() => {
  reset();
  mock.method(console, 'error', (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(' '));
  });
});

afterEach(() => {
  mock.restoreAll();
});

async function patch(body: unknown, id = TARGET_ID): Promise<Answer> {
  const req = new Request(`http://localhost/api/admin-accounts/${id}/access`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await route.PATCH(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function withoutRequestId(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  delete copy.request_id;
  return copy;
}

function failureBody(code: string, message: string, details?: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = { success: false, error: message, code, message };
  if (details !== undefined) body.details = details;
  return body;
}

function calls(): Array<Record<string, unknown> | undefined> {
  return state.rpcs.filter((entry) => entry.name === 'admin_set_access').map((entry) => entry.args);
}

function audits(): Array<Record<string, unknown>> {
  return state.queries.filter((query) => query.table === 'audit_log' && query.op === 'insert')
    .map((query) => query.payload as Record<string, unknown>);
}

function auditBrief(row: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    admin_id: row?.admin_id,
    action: row?.action,
    entity: row?.entity,
    entity_id: row?.entity_id,
    reason: row?.reason,
    result: row?.result,
    error: row?.error,
    sensitivity: row?.sensitivity,
  };
}

describe('PATCH /api/admin-accounts/[id]/access: who may call it', () => {
  test('a phone session is refused with 403 before the database is touched, for a save and a dry run alike', async () => {
    for (const body of [save(), preview()]) {
      reset(SAVED, superAdmin({ session: phoneSession() }));
      const reply = await patch(body);
      assert.equal(reply.status, 403);
      assert.deepEqual(withoutRequestId(reply.body), failureBody('PERMISSION_DENIED', WEB_ONLY));
      assert.deepEqual(state.rpcs, []);
      assert.deepEqual(state.queries, []);
    }
  });

  test('only a signed-in super admin may call it, and a session outage is a 500, never a 401 or 403', async () => {
    reset(SAVED, superAdmin({ is_super_admin: false, page_permissions: ['admin_accounts'] }));
    const manager = await patch(save());
    assert.equal(manager.status, 403);
    assert.deepEqual(withoutRequestId(manager.body), failureBody('PERMISSION_DENIED', SUPER_ONLY));
    reset(SAVED, null);
    assert.equal((await patch(save())).status, 401);
    reset(SAVED, 'unavailable');
    const outage = await patch(preview());
    assert.equal(outage.status, 500);
    assert.equal(outage.body.code, 'INTERNAL_ERROR');
    assert.deepEqual(state.rpcs, []);
  });

  test('a save needs two-step sign-in and a recent identity check, while a dry run needs neither, nor a reason', async () => {
    reset(SAVED, superAdmin({ mfa: noTwoStep }));
    const withoutTwoStep = await patch(save());
    assert.equal(withoutTwoStep.status, 403);
    assert.equal(withoutTwoStep.body.code, 'MFA_REQUIRED');
    reset(SAVED, superAdmin({ session: staleSession() }));
    const stale = await patch(save());
    assert.equal(stale.status, 403);
    assert.equal(stale.body.code, 'REAUTH_REQUIRED');
    assert.deepEqual(stale.body.details, { method: 'otp', max_age_secs: 300 });
    assert.deepEqual(state.rpcs, []);
    reset(MANAGER_PREVIEW, superAdmin({ mfa: noTwoStep, session: staleSession() }));
    const dry = await patch(preview());
    assert.equal(dry.status, 200);
    assert.deepEqual(calls().map((args) => [args?.p_dry_run, args?.p_reason]), [[true, null]]);
  });
});

describe('PATCH /api/admin-accounts/[id]/access: the request', () => {
  test('a missing or malformed expected answers 400 without calling the database', async () => {
    const bodies = [
      save({ expected: undefined }),
      save({ expected: 'nope' }),
      save({ expected: { direct_permissions: [], page_permissions: [] } }),
      save({ expected: expected({ role_id: 'nope' }) }),
      save({ expected: expected({ direct_permissions: 'users' }) }),
      save({ expected: expected({ page_permissions: [7] }) }),
      preview({ expected: undefined }),
    ];
    for (const body of bodies) {
      reset();
      const reply = await patch(body);
      assert.equal(reply.status, 400, JSON.stringify(body));
      assert.equal(reply.body.code, 'VALIDATION_ERROR');
      assert.deepEqual(reply.body.details, { field: 'expected', reason: 'invalid' });
      assert.deepEqual(state.rpcs, []);
      const recorded = body.dry_run === true ? [] : [['EDIT_ADMIN_ACCESS', 'failure', TARGET_ID]];
      assert.deepEqual(audits().map((row) => [row.action, row.result, row.entity_id]), recorded, JSON.stringify(body));
    }
  });

  test('the body, the id, dry_run, role_id and direct_permissions are checked before the database', async () => {
    const field = (name: string) => ({ field: name, reason: 'invalid' });
    const cases: Array<[unknown, string, string, unknown, number]> = [
      [[], TARGET_ID, 'Send the access change as a JSON object.', { reason: 'invalid' }, 0],
      [save({ dry_run: 'yes' }), TARGET_ID, 'dry_run must be true or false.', field('dry_run'), 0],
      [save(), 'nope', 'A valid admin account id is required.', field('id'), 1],
      [save({ role_id: 'nope' }), TARGET_ID, 'role_id must be a role id or null.', field('role_id'), 1],
      [save({ role_id: 42 }), TARGET_ID, 'role_id must be a role id or null.', field('role_id'), 1],
      [save({ direct_permissions: 'coupons' }), TARGET_ID, 'direct_permissions must be a list of permission keys.', field('direct_permissions'), 1],
      [save({ direct_permissions: ['coupons', 1] }), TARGET_ID, 'direct_permissions must be a list of permission keys.', field('direct_permissions'), 1],
      [save({ direct_permissions: new Array(129).fill('coupons') }), TARGET_ID, 'Too many permission keys.', field('direct_permissions'), 1],
    ];
    for (const [body, id, message, details, recorded] of cases) {
      reset();
      const reply = await patch(body, id);
      assert.equal(reply.status, 400, message);
      assert.deepEqual(withoutRequestId(reply.body), failureBody('VALIDATION_ERROR', message, details));
      assert.deepEqual(state.rpcs, []);
      assert.equal(audits().length, recorded, message);
    }
    reset();
    await patch(save(), 'nope');
    assert.deepEqual(auditBrief(audits()[0]), {
      admin_id: ACTOR_ID,
      action: 'EDIT_ADMIN_ACCESS',
      entity: 'admin_users',
      entity_id: null,
      reason: REASON,
      result: 'failure',
      error: 'A valid admin account id is required.',
      sensitivity: 'security',
    });
  });

  test('a save needs a reason of 3 to 500 characters, and a dry run does not ask for one', async () => {
    for (const reason of [undefined, '   ', 'ab', 'x'.repeat(501), 42]) {
      reset();
      const reply = await patch(save({ reason }));
      assert.equal(reply.status, 400, String(reason));
      assert.deepEqual(
        withoutRequestId(reply.body),
        failureBody('VALIDATION_ERROR', REASON_MESSAGE, { field: 'reason', reason: 'reason_required' }),
      );
      assert.deepEqual(state.rpcs, []);
      assert.deepEqual(audits().map((row) => [row.action, row.result, row.reason]), [['EDIT_ADMIN_ACCESS', 'failure', null]]);
    }
    reset();
    assert.equal((await patch(save({ reason: 'x'.repeat(500) }))).status, 200);
    reset(MANAGER_PREVIEW);
    assert.equal((await patch(preview({ reason: 'ab' }))).status, 200);
  });

  test('the RPC receives exactly the request, with p_set_role false when role_id is absent', async () => {
    await patch(save());
    assert.deepEqual(calls(), [{
      p_actor: ACTOR_ID,
      p_admin_id: TARGET_ID,
      p_expected_role_id: null,
      p_expected_direct: MANAGER_KEYS,
      p_expected_effective: MANAGER_KEYS,
      p_set_role: true,
      p_role_id: ROLE_ID,
      p_direct: [],
      p_reason: REASON,
      p_dry_run: false,
      p_ip: CLIENT_IP,
      p_user_agent: USER_AGENT,
      p_request_id: REQUEST_ID,
    }]);
    reset();
    await patch({ direct_permissions: ['users', 'withdrawals', 'users'], expected: expected(), reason: `  ${REASON} ` });
    assert.deepEqual(calls().map((args) => [args?.p_set_role, args?.p_role_id, args?.p_direct, args?.p_reason]), [
      [false, null, ['users', 'withdrawals'], REASON],
    ]);
    reset();
    await patch({ role_id: null, expected: expected({ role_id: ROLE_ID.toUpperCase() }), reason: REASON });
    assert.deepEqual(calls().map((args) => [args?.p_set_role, args?.p_role_id, args?.p_direct, args?.p_expected_role_id]), [
      [true, null, null, ROLE_ID],
    ]);
    reset();
    await patch({ role_id: ROLE_ID.toUpperCase(), expected: expected(), reason: REASON }, TARGET_ID.toUpperCase());
    assert.deepEqual(calls().map((args) => [args?.p_admin_id, args?.p_role_id, args?.p_direct]), [[TARGET_ID, ROLE_ID, null]]);
  });

  test('newly added retired, not-in-use or restricted keys are refused before the database, with their names', async () => {
    const asked = ['users', 'giftbox', 'reconciliation.read', 'admin_accounts', 'roles.write'];
    const refusal = grants.checkNewKeys(asked, [...MANAGER_KEYS, ...MANAGER_KEYS], 'direct');
    assert.ok(refusal);
    assert.deepEqual(new Set(refusal.keys), new Set(['giftbox', 'reconciliation.read', 'admin_accounts', 'roles.write']));
    const reply = await patch(save({ role_id: undefined, direct_permissions: asked }));
    assert.equal(reply.status, 400);
    assert.deepEqual(
      withoutRequestId(reply.body),
      failureBody('VALIDATION_ERROR', refusal.message, { field: 'direct_permissions', reason: 'not_grantable', keys: refusal.keys }),
    );
    assert.deepEqual(state.rpcs, []);
    const rows = audits();
    assert.deepEqual(rows.map(auditBrief), [{
      admin_id: ACTOR_ID,
      action: 'EDIT_ADMIN_ACCESS',
      entity: 'admin_users',
      entity_id: TARGET_ID,
      reason: REASON,
      result: 'failure',
      error: refusal.message,
      sensitivity: 'security',
    }]);
    assert.deepEqual(rows[0]?.before_value, expected());
    assert.deepEqual(rows[0]?.after_value, { direct_permissions: asked });
    reset();
    assert.equal((await patch(preview({ role_id: undefined, direct_permissions: asked }))).status, 400);
    assert.deepEqual(audits(), []);
    reset();
    const kept = await patch(save({ direct_permissions: ['users', 'giftbox'], expected: expected({ direct_permissions: ['users', 'giftbox'] }) }));
    assert.equal(kept.status, 200);
    assert.equal(calls().length, 1);
  });
});

describe('PATCH /api/admin-accounts/[id]/access: database answers', () => {
  test('refusals keep their meaning: 409 for stale, super_admin and the role states, 400 for bad keys, roles and input, 404 for a missing admin', async () => {
    const cases: Array<[Record<string, unknown>, number, string, string, Record<string, unknown>]> = [
      [{ ok: false, reason: 'stale' }, 409, 'STATE_CONFLICT', 'That record has changed. Reload and try again.', { reason: 'stale' }],
      [{ ok: false, reason: 'super_admin' }, 409, 'STATE_CONFLICT', 'Super admins hold every permission, so roles do not apply.', { reason: 'super_admin' }],
      [{ ok: false, reason: 'role_protected' }, 409, 'STATE_CONFLICT', 'This role cannot be assigned.', { reason: 'role_protected' }],
      [{ ok: false, reason: 'role_archived' }, 409, 'STATE_CONFLICT', 'This role is archived.', { reason: 'role_archived' }],
      [
        { ok: false, reason: 'not_grantable', keys: ['roles.write'] },
        400, 'VALIDATION_ERROR', 'This permission cannot be granted: roles.write.', { reason: 'not_grantable', keys: ['roles.write'] },
      ],
      [{ ok: false, reason: 'role_not_found' }, 400, 'VALIDATION_ERROR', 'That role does not exist.', { reason: 'role_not_found' }],
      [{ ok: false, reason: 'invalid' }, 400, 'VALIDATION_ERROR', 'The request was not valid.', { reason: 'invalid' }],
      [{ ok: false, reason: 'not_found' }, 404, 'RESOURCE_NOT_FOUND', 'That record could not be found.', { reason: 'not_found' }],
    ];
    for (const [data, status, code, message, details] of cases) {
      reset({ data });
      const reply = await patch(save());
      assert.equal(reply.status, status, String(data.reason));
      assert.deepEqual(withoutRequestId(reply.body), failureBody(code, message, details));
      assert.deepEqual(audits().map((row) => [row.action, row.result, row.error, row.reason]), [
        ['EDIT_ADMIN_ACCESS', 'failure', message, REASON],
      ]);
      assert.deepEqual(logs, []);
      reset({ data });
      const dry = await patch(preview());
      assert.equal(dry.status, status, String(data.reason));
      assert.deepEqual(audits(), []);
    }
  });

  test('any database error answers 500, never 401 or 403, with a failure audit for a save', async () => {
    const replies: Reply[] = [
      { error: { message: 'connection terminated', code: '08006' } },
      'throw',
      { data: null },
      { data: { ok: false, reason: 'mystery' } },
      { data: { ok: false } },
      { data: { ok: true } },
      { data: { ok: true, changed: true, signed_out: true } },
      { data: { ok: true, changed: true, signed_out: false, admin: { id: 'nope', role_id: null, direct_permissions: [], page_permissions: [] } } },
    ];
    for (const reply of replies) {
      reset(reply);
      const answer = await patch(save());
      assert.equal(answer.status, 500, JSON.stringify(reply));
      assert.deepEqual(withoutRequestId(answer.body), failureBody('INTERNAL_ERROR', SAVE_FAILED));
      assert.deepEqual(audits().map((row) => [row.action, row.result]), [['EDIT_ADMIN_ACCESS', 'failure']]);
      assert.ok(logs.some((line) => line.startsWith('admin access change failed:')), JSON.stringify(reply));
    }
    for (const reply of [
      { data: { ok: true, dry_run: true, before: [], after: [] } },
      { data: { ok: true, before: [], after: [], direct: [], changed: false, signs_out: false } },
      'throw',
    ] as Reply[]) {
      reset(reply);
      const answer = await patch(preview());
      assert.equal(answer.status, 500, JSON.stringify(reply));
      assert.deepEqual(withoutRequestId(answer.body), failureBody('INTERNAL_ERROR', PREVIEW_FAILED));
      assert.deepEqual(audits(), []);
    }
  });

  test('the database’s own Not authorized stays a 403 and is recorded', async () => {
    reset({ error: { message: 'Not authorized', code: 'P0001' } });
    const reply = await patch(save());
    assert.equal(reply.status, 403);
    assert.deepEqual(withoutRequestId(reply.body), failureBody('PERMISSION_DENIED', SUPER_ONLY));
    assert.deepEqual(audits().map((row) => [row.action, row.result, row.error]), [['EDIT_ADMIN_ACCESS', 'failure', 'Not authorized']]);
    assert.deepEqual(logs, []);
  });
});

describe('PATCH /api/admin-accounts/[id]/access: answers', () => {
  test('moving the Manager onto a copied role previews as unchanged, with the keys moved into the role', async () => {
    reset(MANAGER_PREVIEW);
    const reply = await patch(preview());
    assert.equal(reply.status, 200);
    assert.deepEqual(withoutRequestId(reply.body), {
      success: true,
      impact: {
        before: MANAGER_KEYS,
        after: MANAGER_KEYS,
        gained: [],
        lost: [],
        highest_risk: null,
        changed: false,
        signs_out: false,
        folded: ['dashboard', 'users', 'withdrawals'],
      },
    });
    assert.deepEqual(audits(), []);
  });

  test('a dry run that takes away payout approval lists the actions lost, the highest risk and the sign-out', async () => {
    const after = ['withdrawals.export', 'withdrawals.read', 'withdrawals.reject'];
    reset({ data: { ok: true, dry_run: true, before: ['withdrawals'], after, direct: after, changed: true, signs_out: true } });
    const reply = await patch(preview({
      role_id: undefined,
      direct_permissions: ['withdrawals.read', 'withdrawals.reject', 'withdrawals.export'],
      expected: expected({ direct_permissions: ['withdrawals'], page_permissions: ['withdrawals'] }),
    }));
    assert.equal(reply.status, 200);
    const diff = grants.actionDiff(['withdrawals'], after);
    assert.ok(diff.lost.includes('withdrawals.approve'));
    assert.deepEqual(reply.body.impact, {
      before: ['withdrawals'],
      after,
      gained: diff.gained,
      lost: diff.lost,
      highest_risk: diff.highest_risk,
      changed: true,
      signs_out: true,
      folded: [],
    });
    assert.deepEqual(calls().map((args) => [args?.p_set_role, args?.p_dry_run]), [[false, true]]);
  });

  test('keys the role already covers are reported as moved, while keys simply removed are not', async () => {
    reset({
      data: {
        ok: true, dry_run: true, before: ['coupons', 'withdrawals.read'], after: ['withdrawals'], direct: [], changed: true, signs_out: true,
      },
    });
    const reply = await patch(preview({ expected: expected({ direct_permissions: ['withdrawals.read', 'coupons'], page_permissions: ['coupons', 'withdrawals.read'] }) }));
    assert.deepEqual((reply.body.impact as Record<string, unknown>).folded, ['withdrawals.read']);
  });

  test('a save answers with the admin, changed and signed_out from the database, and leaves the audit row to it', async () => {
    const admin = { id: TARGET_ID, role_id: ROLE_ID, direct_permissions: [], page_permissions: ['users'] };
    reset({ data: { ok: true, changed: true, signed_out: true, admin } });
    const reply = await patch(save());
    assert.equal(reply.status, 200);
    assert.deepEqual(withoutRequestId(reply.body), { success: true, admin, changed: true, signed_out: true });
    assert.deepEqual(audits(), []);
  });

  test('a save that changes nothing answers changed false with the values the console sent', async () => {
    reset({ data: { ok: true, changed: false, signed_out: false } });
    const reply = await patch(save({ role_id: undefined, direct_permissions: ['withdrawals', 'users', 'dashboard'] }));
    assert.equal(reply.status, 200);
    assert.deepEqual(withoutRequestId(reply.body), {
      success: true,
      admin: { id: TARGET_ID, role_id: null, direct_permissions: MANAGER_KEYS, page_permissions: MANAGER_KEYS },
      changed: false,
      signed_out: false,
    });
  });
});

describe('the access route source', () => {
  const source = () => readFileSync(ROUTE_FILE, 'utf8');

  test('carries no prose comments, and neither does this test', () => {
    assert.doesNotMatch(source(), /\/\*|(^|[^:])\/\/(?!\/)/m);
    assert.doesNotMatch(readFileSync(TEST_FILE, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m);
  });

  test('is for super admins on the web, steps up for a save only, and names its audit action as a plain literal', () => {
    const text = source();
    assert.match(text, /requireSuperAdmin\(\)/);
    assert.match(text, /admin\.session\.client !== 'web'/);
    assert.match(text, /if \(!dryRun\) \{\s*const withoutTwoStep = await requireTwoStep\(admin\);/);
    assert.match(text, /requireRecentAuth\(admin\)/);
    assert.match(text, /action: 'EDIT_ADMIN_ACCESS'/);
    assert.doesNotMatch(text, /requireAdmin(?:Any|All)?\(|NextResponse\.json\(|status: 401/);
  });

  test('changes access only through admin_set_access and never writes admin_users itself', () => {
    const text = source();
    assert.deepEqual([...text.matchAll(/\.rpc\('([a-z_]+)'/g)].map((match) => match[1]), ['admin_set_access']);
    assert.doesNotMatch(text, /from\('admin_users'\)/);
  });

  test('never logs a code, a secret, a token or a password', () => {
    for (const [, args] of source().matchAll(/console\.error\(([^;]*)\);/g)) {
      const code = args.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '');
      assert.doesNotMatch(code, /\b(?:code|codes|otp|secret|sealed|token|hashes|password)\b/, args);
    }
  });
});
