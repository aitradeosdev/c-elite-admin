import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createElement, type ElementType, type ReactNode } from 'react';
import { classesOf, loadAppModule, render, tagsOf, textById, textOf } from './support/uiHarness.ts';
import type { AdminRow } from '../app/(dashboard)/admin-accounts/model.ts';

type ModelModule = typeof import('../app/(dashboard)/admin-accounts/model.ts');
type ConfirmModule = typeof import('../app/(dashboard)/admin-accounts/confirmOptions.tsx');
type SectionModule = typeof import('../app/(dashboard)/admin-accounts/SuperAdminSection.tsx');
type DetailsModule = typeof import('../app/(dashboard)/admin-accounts/AdminDetails.tsx');
type ActivityModule = typeof import('../app/(dashboard)/activity/rules.ts');

const STATE_KEY = '__superAdminRouteTest';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const ACCOUNTS_DIR = join(APP_DIR, '(dashboard)', 'admin-accounts');
const ROUTE_FILE = resolve(APP_DIR, 'api', 'admin-accounts', '[id]', 'super-admin', 'route.ts');
const ADMIN_SQL = fileURLToPath(new URL('../../schema_admin_app.sql', import.meta.url));
const TEST_FILE = fileURLToPath(import.meta.url);

const ACTOR_ID = '11111111-2222-4333-8444-555555555555';
const TARGET_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const ROLE_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
const REQUEST_ID = 'req_superadmin01';
const USER_AGENT = 'super-admin-route-test';
const CLIENT_IP = '198.51.100.21';
const REASON = 'Second super admin for cover';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const WEB_ONLY = 'Super admin can only be changed in the web console.';
const SUPER_ONLY = 'This action is restricted to super administrators.';
const INVALID_BODY = 'Send the super admin change as a JSON object.';
const INVALID_MAKE = 'make must be true or false.';
const INVALID_ADMIN = 'A valid admin account id is required.';
const REASON_MESSAGE = 'Enter a reason of 3 to 500 characters.';
const SAVE_FAILED = 'The super admin change could not be confirmed. Reload the account and try again.';
const DESCRIPTION = 'Holds every permission. Granted and removed in Admin accounts. It cannot be edited, archived or assigned here.';

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

interface SuperAdminRoute {
  POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
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
  if (name !== 'admin_set_super_admin') return Promise.reject(new Error(`unexpected rpc ${name}`));
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

let route: SuperAdminRoute;
let model: ModelModule;
let confirmOptions: ConfirmModule;
let section: SectionModule;
let details: DetailsModule;
let activity: ActivityModule;

before(async () => {
  route = (await import(await bundle(ROUTE_FILE))) as SuperAdminRoute;
  model = await loadAppModule<ModelModule>('(dashboard)/admin-accounts/model.ts');
  confirmOptions = await loadAppModule<ConfirmModule>('(dashboard)/admin-accounts/confirmOptions.tsx');
  section = await loadAppModule<SectionModule>('(dashboard)/admin-accounts/SuperAdminSection.tsx');
  details = await loadAppModule<DetailsModule>('(dashboard)/admin-accounts/AdminDetails.tsx');
  activity = await loadAppModule<ActivityModule>('(dashboard)/activity/rules.ts');
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

const grant = (patch: Record<string, unknown> = {}) => ({ make: true, reason: REASON, ...patch });
const removal = (patch: Record<string, unknown> = {}) => ({ make: false, reason: REASON, ...patch });

const GRANTED_ADMIN = {
  id: TARGET_ID,
  is_super_admin: true,
  role_id: null,
  direct_permissions: ['coupons'],
  page_permissions: ['coupons'],
};

const REMOVED_ADMIN = { id: TARGET_ID, is_super_admin: false, role_id: null, direct_permissions: [], page_permissions: [] };

const GRANTED: DbResult = { data: { ok: true, signed_out: true, admin: GRANTED_ADMIN } };

function reset(reply: Reply = GRANTED, claims: StubState['claims'] = superAdmin()): void {
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

async function post(body: unknown, id = TARGET_ID): Promise<Answer> {
  const req = new Request(`http://localhost/api/admin-accounts/${id}/super-admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await route.POST(req, { params: Promise.resolve({ id }) });
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
  return state.rpcs.filter((entry) => entry.name === 'admin_set_super_admin').map((entry) => entry.args);
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

describe('POST /api/admin-accounts/[id]/super-admin: who may call it', () => {
  test('a phone session is refused with 403 before the database is touched', async () => {
    for (const body of [grant(), removal()]) {
      reset(GRANTED, superAdmin({ session: phoneSession() }));
      const reply = await post(body);
      assert.equal(reply.status, 403);
      assert.deepEqual(withoutRequestId(reply.body), failureBody('PERMISSION_DENIED', WEB_ONLY));
      assert.deepEqual(state.rpcs, []);
      assert.deepEqual(state.queries, []);
    }
  });

  test('only a signed-in super admin may call it, and a session outage is a 500, never a 401 or 403', async () => {
    reset(GRANTED, superAdmin({ is_super_admin: false, page_permissions: ['admin_accounts'] }));
    const manager = await post(grant());
    assert.equal(manager.status, 403);
    assert.deepEqual(withoutRequestId(manager.body), failureBody('PERMISSION_DENIED', SUPER_ONLY));
    reset(GRANTED, null);
    assert.equal((await post(grant())).status, 401);
    reset(GRANTED, 'unavailable');
    const outage = await post(removal());
    assert.equal(outage.status, 500);
    assert.equal(outage.body.code, 'INTERNAL_ERROR');
    assert.deepEqual(state.rpcs, []);
    assert.deepEqual(state.queries, []);
  });

  test('the acting super admin needs two-step sign-in, then an identity check within 5 minutes, before the body is read', async () => {
    reset(GRANTED, superAdmin({ mfa: noTwoStep }));
    const withoutTwoStep = await post([]);
    assert.equal(withoutTwoStep.status, 403);
    assert.equal(withoutTwoStep.body.code, 'MFA_REQUIRED');
    reset(GRANTED, superAdmin({ session: staleSession() }));
    const stale = await post(grant());
    assert.equal(stale.status, 403);
    assert.equal(stale.body.code, 'REAUTH_REQUIRED');
    assert.deepEqual(stale.body.details, { method: 'otp', max_age_secs: 300 });
    reset(GRANTED, superAdmin({ mfa: noTwoStep, session: staleSession() }));
    assert.equal((await post(removal())).body.code, 'MFA_REQUIRED');
    reset(GRANTED, superAdmin({ mfa: noTwoStep, session: phoneSession() }));
    assert.equal((await post(removal())).body.message, WEB_ONLY);
    assert.deepEqual(state.rpcs, []);
    assert.deepEqual(state.queries, []);
  });
});

describe('POST /api/admin-accounts/[id]/super-admin: the request', () => {
  test('the body must be an object with make true or false, checked before any audit row', async () => {
    const cases: Array<[unknown, string, unknown]> = [
      [[], INVALID_BODY, { reason: 'invalid' }],
      ['grant', INVALID_BODY, { reason: 'invalid' }],
      [{ reason: REASON }, INVALID_MAKE, { field: 'make', reason: 'invalid' }],
      [grant({ make: 'yes' }), INVALID_MAKE, { field: 'make', reason: 'invalid' }],
      [grant({ make: 1 }), INVALID_MAKE, { field: 'make', reason: 'invalid' }],
      [grant({ make: null }), INVALID_MAKE, { field: 'make', reason: 'invalid' }],
    ];
    for (const [body, message, detail] of cases) {
      reset();
      const reply = await post(body);
      assert.equal(reply.status, 400, JSON.stringify(body));
      assert.deepEqual(withoutRequestId(reply.body), failureBody('VALIDATION_ERROR', message, detail));
      assert.deepEqual(state.rpcs, []);
      assert.deepEqual(audits(), []);
    }
  });

  test('a bad admin id answers 400 and is recorded as a failed attempt under the action asked for', async () => {
    for (const [body, action, made] of [[grant(), 'GRANT_SUPER_ADMIN', true], [removal(), 'REMOVE_SUPER_ADMIN', false]] as const) {
      reset();
      const reply = await post(body, 'nope');
      assert.equal(reply.status, 400);
      assert.deepEqual(withoutRequestId(reply.body), failureBody('VALIDATION_ERROR', INVALID_ADMIN, { field: 'id', reason: 'invalid' }));
      assert.deepEqual(state.rpcs, []);
      const rows = audits();
      assert.deepEqual(rows.map(auditBrief), [{
        admin_id: ACTOR_ID,
        action,
        entity: 'admin_users',
        entity_id: null,
        reason: REASON,
        result: 'failure',
        error: INVALID_ADMIN,
        sensitivity: 'security',
      }]);
      assert.deepEqual(rows[0]?.after_value, { is_super_admin: made });
    }
  });

  test('a reason of 3 to 500 characters is required, and a missing one is recorded without a reason', async () => {
    for (const reason of [undefined, '   ', 'ab', 'x'.repeat(501), 42]) {
      reset();
      const reply = await post(grant({ reason }));
      assert.equal(reply.status, 400, String(reason));
      assert.deepEqual(
        withoutRequestId(reply.body),
        failureBody('VALIDATION_ERROR', REASON_MESSAGE, { field: 'reason', reason: 'reason_required' }),
      );
      assert.deepEqual(state.rpcs, []);
      assert.deepEqual(audits().map((row) => [row.action, row.result, row.reason]), [['GRANT_SUPER_ADMIN', 'failure', null]]);
    }
    reset();
    assert.equal((await post(grant({ reason: 'x'.repeat(500) }))).status, 200);
  });

  test('the database function receives exactly the change, the trimmed reason and the request details', async () => {
    await post(grant());
    assert.deepEqual(calls(), [{
      p_actor: ACTOR_ID,
      p_admin_id: TARGET_ID,
      p_make: true,
      p_reason: REASON,
      p_ip: CLIENT_IP,
      p_user_agent: USER_AGENT,
      p_request_id: REQUEST_ID,
    }]);
    reset({ data: { ok: true, signed_out: true, admin: REMOVED_ADMIN } });
    await post(removal({ reason: `  ${REASON} ` }), TARGET_ID.toUpperCase());
    assert.deepEqual(calls().map((args) => [args?.p_admin_id, args?.p_make, args?.p_reason]), [[TARGET_ID, false, REASON]]);
  });
});

describe('POST /api/admin-accounts/[id]/super-admin: database answers', () => {
  const REFUSALS: Array<[string, boolean, number, string, string]> = [
    ['invalid', true, 400, 'VALIDATION_ERROR', 'The request was not valid.'],
    ['reason_required', true, 400, 'VALIDATION_ERROR', REASON_MESSAGE],
    ['self', false, 400, 'VALIDATION_ERROR', 'You cannot remove your own super admin status. Another super administrator has to do it.'],
    ['not_found', true, 404, 'RESOURCE_NOT_FOUND', 'Admin account not found.'],
    ['unchanged', true, 409, 'STATE_CONFLICT', 'This admin is already a super admin.'],
    ['unchanged', false, 409, 'STATE_CONFLICT', 'This admin is not a super admin.'],
    ['inactive', true, 409, 'STATE_CONFLICT', 'This admin is deactivated. Reactivate the account before making it a super admin.'],
    ['invite_pending', true, 409, 'STATE_CONFLICT', 'This admin has not accepted their invitation yet.'],
    ['last_super_admin', false, 409, 'STATE_CONFLICT', 'Cannot remove the last active super admin.'],
  ];

  test('every refusal keeps its meaning and status, with a failure audit and no error log', async () => {
    for (const [reason, make, status, code, message] of REFUSALS) {
      reset({ data: { ok: false, reason } });
      const reply = await post(make ? grant() : removal());
      assert.equal(reply.status, status, `${reason} ${make}`);
      assert.deepEqual(withoutRequestId(reply.body), failureBody(code, message, { reason }));
      assert.deepEqual(audits().map((row) => [row.action, row.result, row.error, row.reason, row.entity_id]), [
        [make ? 'GRANT_SUPER_ADMIN' : 'REMOVE_SUPER_ADMIN', 'failure', message, REASON, TARGET_ID],
      ]);
      assert.deepEqual(logs, []);
    }
  });

  test('the database’s own Not authorized stays a 403 and is recorded', async () => {
    reset({ error: { message: 'Not authorized', code: 'P0001' } });
    const reply = await post(removal());
    assert.equal(reply.status, 403);
    assert.deepEqual(withoutRequestId(reply.body), failureBody('PERMISSION_DENIED', SUPER_ONLY));
    assert.deepEqual(audits().map((row) => [row.action, row.result, row.error]), [['REMOVE_SUPER_ADMIN', 'failure', 'Not authorized']]);
    assert.deepEqual(logs, []);
  });

  test('an outage or an unreadable answer is a 500, never a 401 or 403, logged and recorded', async () => {
    const replies: Reply[] = [
      { error: { message: 'connection terminated', code: '08006' } },
      { error: { message: 'At least one active super admin is required', code: 'P0001' } },
      'throw',
      { data: null },
      { data: { ok: false, reason: 'mystery' } },
      { data: { ok: false } },
      { data: { ok: true } },
      { data: { ok: true, signed_out: true } },
      { data: { ok: true, signed_out: 'yes', admin: GRANTED_ADMIN } },
      { data: { ok: true, signed_out: true, admin: { ...GRANTED_ADMIN, id: 'nope' } } },
      { data: { ok: true, signed_out: true, admin: { ...GRANTED_ADMIN, is_super_admin: 'true' } } },
      { data: { ok: true, signed_out: true, admin: { ...GRANTED_ADMIN, role_id: 'nope' } } },
      { data: { ok: true, signed_out: true, admin: { ...GRANTED_ADMIN, page_permissions: null } } },
    ];
    for (const reply of replies) {
      reset(reply);
      const answer = await post(grant());
      assert.equal(answer.status, 500, JSON.stringify(reply));
      assert.deepEqual(withoutRequestId(answer.body), failureBody('INTERNAL_ERROR', SAVE_FAILED));
      assert.deepEqual(audits().map((row) => [row.action, row.result]), [['GRANT_SUPER_ADMIN', 'failure']]);
      assert.ok(logs.some((line) => line.startsWith('admin super admin change failed:')), JSON.stringify(reply));
    }
  });
});

describe('POST /api/admin-accounts/[id]/super-admin: answers', () => {
  test('granting answers the admin and the sign-out from the database, and leaves the success audit to it', async () => {
    const reply = await post(grant());
    assert.equal(reply.status, 200);
    assert.deepEqual(withoutRequestId(reply.body), { success: true, admin: GRANTED_ADMIN, signed_out: true });
    assert.deepEqual(audits(), []);
    assert.deepEqual(logs, []);
  });

  test('removing answers an admin with no role and no access', async () => {
    reset({ data: { ok: true, signed_out: true, admin: { ...REMOVED_ADMIN, role_id: undefined } } });
    const reply = await post(removal());
    assert.equal(reply.status, 200);
    assert.deepEqual(withoutRequestId(reply.body), { success: true, admin: REMOVED_ADMIN, signed_out: true });
    assert.deepEqual(audits(), []);
  });
});

describe('the super admin route source', () => {
  const source = () => readFileSync(ROUTE_FILE, 'utf8');

  test('carries no prose comments, and neither does this test', () => {
    assert.doesNotMatch(source(), /\/\*|(^|[^:])\/\/(?!\/)/m);
    assert.doesNotMatch(readFileSync(TEST_FILE, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m);
  });

  test('guards like the Access route: super admin, web session, two-step sign-in, recent identity check, then the body', () => {
    const text = source();
    const order = [
      'await requireSuperAdmin()',
      "admin.session.client !== 'web'",
      'await requireTwoStep(admin)',
      'await requireRecentAuth(admin)',
      'await readBody(req)',
      "typeof body.make !== 'boolean'",
      'readReason(body.reason)',
      'await setSuperAdmin(',
    ].map((needle) => text.indexOf(needle));
    assert.ok(order.every((at) => at > 0), JSON.stringify(order));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.doesNotMatch(text, /requireAdmin(?:Any|All)?\(|NextResponse\.json\(|status: 401/);
    assert.match(text, /export async function POST\(/);
    assert.doesNotMatch(text, /export async function (?:GET|PATCH|PUT|DELETE)\(/);
  });

  test('changes super admin only through admin_set_super_admin, never writes admin_users itself, and names its actions as literals', () => {
    const text = source();
    assert.deepEqual([...text.matchAll(/\.rpc\('([a-z_]+)'/g)].map((match) => match[1]), ['admin_set_super_admin']);
    assert.doesNotMatch(text, /from\('admin_users'\)/);
    assert.match(text, /action: attempt\.make \? 'GRANT_SUPER_ADMIN' : 'REMOVE_SUPER_ADMIN'/);
    assert.match(text, /sensitivity: 'security'/);
  });

  test('never logs a code, a secret, a token or a password', () => {
    for (const [, args] of source().matchAll(/console\.error\(([^;]*)\);/g)) {
      const code = args.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '');
      assert.doesNotMatch(code, /\b(?:code|codes|otp|secret|sealed|token|hashes|password)\b/, args);
    }
  });
});

function adminRow(patch: Partial<AdminRow> = {}): AdminRow {
  return {
    id: TARGET_ID,
    username: 'ada',
    email: 'ada@cardelite.ng',
    role_title: 'Manager',
    page_permissions: ['dashboard', 'users', 'withdrawals'],
    role_id: ROLE_ID,
    role: { id: ROLE_ID, name: 'Manager', archived: false },
    direct_permissions: [],
    last_login_at: null,
    is_active: true,
    is_super_admin: false,
    deleted_at: null,
    created_at: null,
    security: null,
    invitePending: false,
    ...patch,
  };
}

const superRow = (patch: Partial<AdminRow> = {}) =>
  adminRow({ is_super_admin: true, role_id: null, role: null, page_permissions: [], ...patch });

const html = (...nodes: ReactNode[]) => render(createElement('div', null, ...nodes));

function confirmText(options: { message?: ReactNode; details?: Array<{ label: string; value: ReactNode }>; consequences?: string[] }): string {
  const rows = (options.details ?? []).map((detail) => createElement('p', { key: detail.label }, detail.label, ' ', detail.value));
  return textOf(html(options.message, ...rows, ...(options.consequences ?? [])));
}

describe('super admin in Admin accounts: who it is offered for', () => {
  test('make for active admins who are not super admins, remove for other super admins, never yourself or a deleted account', () => {
    const deleted = '2026-09-01T00:00:00.000Z';
    assert.equal(model.superAdminChange(adminRow(), ACTOR_ID), 'make');
    assert.equal(model.superAdminChange(adminRow({ role_id: null, role: null }), ACTOR_ID), 'make');
    assert.equal(model.superAdminChange(adminRow({ is_active: false }), ACTOR_ID), null);
    assert.equal(model.superAdminChange(superRow(), ACTOR_ID), 'remove');
    assert.equal(model.superAdminChange(superRow({ is_active: false }), ACTOR_ID), 'remove');
    assert.equal(model.superAdminChange(superRow({ id: ACTOR_ID }), ACTOR_ID), null);
    assert.equal(model.superAdminChange(superRow(), null), null);
    assert.equal(model.superAdminChange(adminRow({ is_active: false, deleted_at: deleted }), ACTOR_ID), null);
    assert.equal(model.superAdminChange(superRow({ is_active: false, deleted_at: deleted }), ACTOR_ID), null);
  });

  test('Make super admin is hidden while an invitation is pending, and shown when the invite state is unknown', () => {
    assert.equal(model.superAdminChange(adminRow({ invitePending: true, last_login_at: null }), ACTOR_ID), null);
    assert.equal(model.superAdminChange(adminRow({ invitePending: null }), ACTOR_ID), 'make');
    assert.equal(model.superAdminChange(adminRow({ invitePending: false }), ACTOR_ID), 'make');
    assert.equal(model.superAdminChange(adminRow({ invitePending: true, is_active: false }), ACTOR_ID), null);
  });

  test('the change goes to its own route with make and the reason, and the answer is read strictly', () => {
    assert.equal(model.superAdminPath(TARGET_ID), `/api/admin-accounts/${TARGET_ID}/super-admin`);
    assert.deepEqual(model.superAdminRequestBody('make', REASON), { make: true, reason: REASON });
    assert.deepEqual(model.superAdminRequestBody('remove', REASON), { make: false, reason: REASON });
    assert.deepEqual(model.toSuperAdminResult({ admin: GRANTED_ADMIN, signed_out: true }), { isSuperAdmin: true, signedOut: true });
    assert.deepEqual(model.toSuperAdminResult({ admin: REMOVED_ADMIN, signed_out: false }), { isSuperAdmin: false, signedOut: false });
    assert.equal(model.toSuperAdminResult({ admin: GRANTED_ADMIN }), null);
    assert.equal(model.toSuperAdminResult({ signed_out: true }), null);
    assert.equal(model.toSuperAdminResult({ admin: { ...GRANTED_ADMIN, is_super_admin: 'true' }, signed_out: true }), null);
  });
});

describe('super admin in Admin accounts: confirmations', () => {
  test('making a super admin states full access, the role cleared, the sign-out and the alert, and asks for a reason', () => {
    const options = confirmOptions.superAdminConfirm(adminRow(), 'make');
    assert.equal(options.tone, 'danger');
    assert.equal(options.title, 'Make @ada a super admin?');
    assert.equal(options.reason?.required, true);
    assert.equal(options.reason?.maxLength, 500);
    assert.equal(options.credential, undefined);
    assert.equal(options.confirmLabel, 'Make super admin');
    assert.equal(options.pendingLabel, confirmOptions.SUPER_ADMIN_PENDING);
    const text = confirmText(options);
    assert.match(text, /Admin @ada/);
    assert.match(text, /Role Manager → changes to Super administrator/);
    assert.deepEqual(options.consequences, [
      '@ada gets full access to every page and action.',
      'Their role Manager is cleared, because roles do not apply to super admins.',
      '@ada is signed out on every device, web and mobile, and must sign in again.',
      'Every super administrator gets an alert.',
    ]);
    const roleless = confirmOptions.superAdminConfirm(adminRow({ role_id: null, role: null }), 'make');
    assert.match(confirmText(roleless), /Role No role → changes to Super administrator/);
    assert.equal(roleless.consequences?.some((line) => /cleared/.test(line)), false);
  });

  test('removing a super admin states no access until a role is given, the sign-out and the alert, and asks for a reason', () => {
    const options = confirmOptions.superAdminConfirm(superRow(), 'remove');
    assert.equal(options.tone, 'danger');
    assert.equal(options.title, 'Remove super admin from @ada?');
    assert.equal(options.reason?.required, true);
    assert.equal(options.credential, undefined);
    assert.equal(options.confirmLabel, 'Remove super admin');
    const text = confirmText(options);
    assert.match(text, /They lose every permission\./);
    assert.match(text, /Role Super administrator → changes to No role/);
    assert.deepEqual(options.consequences, [
      '@ada has no access until a role is given.',
      '@ada is signed out on every device, web and mobile, and must sign in again.',
      'Every super administrator gets an alert.',
    ]);
    const inactive = confirmOptions.superAdminConfirm(superRow({ is_active: false }), 'remove');
    assert.ok(inactive.consequences?.includes('@ada is deactivated, so they are already signed out.'));
  });

  test('the identity check is a follow-up that asks only for a code, and the toast follows the change', () => {
    for (const change of ['make', 'remove'] as const) {
      const options = confirmOptions.superAdminIdentityConfirm(adminRow(), change);
      assert.deepEqual(options.credential, { kind: 'otp' });
      assert.equal(options.reason, undefined);
      assert.equal(options.title, 'Confirm it is you');
      assert.match(String(options.message), /authenticator app/);
      assert.equal(options.confirmLabel, change === 'make' ? 'Make super admin' : 'Remove super admin');
    }
    assert.match(String(confirmOptions.superAdminIdentityConfirm(adminRow(), 'make').message), /make @ada a super admin\.$/);
    assert.match(String(confirmOptions.superAdminIdentityConfirm(superRow(), 'remove').message), /remove super admin from @ada\.$/);
    assert.equal(
      confirmOptions.superAdminSavedText(adminRow(), 'make', { isSuperAdmin: true, signedOut: true }),
      '@ada is now a super admin. They were signed out everywhere and must sign in again.',
    );
    assert.equal(
      confirmOptions.superAdminSavedText(superRow(), 'remove', { isSuperAdmin: false, signedOut: true }),
      '@ada is no longer a super admin and has no access until a role is given. They were signed out everywhere and must sign in again.',
    );
    assert.equal(confirmOptions.superAdminSavedText(adminRow(), 'make', { isSuperAdmin: true, signedOut: false }), '@ada is now a super admin.');
    assert.equal(
      confirmOptions.superAdminSavedText(superRow({ is_active: false }), 'remove', { isSuperAdmin: false, signedOut: true }),
      '@ada is no longer a super admin and has no access until a role is given.',
    );
  });
});

describe('super admin in Admin accounts: the panel section', () => {
  const noop = () => {};
  const sectionHtml = (props: Record<string, unknown>) =>
    render(createElement(section.SuperAdminSection as ElementType, { admin: adminRow(), change: 'make', busy: false, onChange: noop, ...props }));

  test('offers Make super admin with what it does, and Remove super admin as a danger action', () => {
    const make = sectionHtml({});
    const [makeButton] = tagsOf(make, 'button');
    assert.equal(makeButton.type, 'button');
    assert.ok(classesOf(makeButton).includes('secondary'));
    assert.ok(!('disabled' in makeButton));
    assert.match(textOf(make), /^Super admin Make super admin… /);
    assert.equal(textById(make, makeButton['aria-describedby']), section.MAKE_SUPER_ADMIN_HELP);
    const remove = sectionHtml({ admin: superRow(), change: 'remove' });
    const [removeButton] = tagsOf(remove, 'button');
    assert.ok(classesOf(removeButton).includes('dangerSubtle'));
    assert.match(textOf(remove), /Remove super admin…/);
    assert.equal(textById(remove, removeButton['aria-describedby']), section.REMOVE_SUPER_ADMIN_HELP);
    assert.equal(tagsOf(remove, 'h3').length, 1);
  });

  test('is frozen while another admin action runs', () => {
    const [button] = tagsOf(sectionHtml({ busy: true }), 'button');
    assert.ok('disabled' in button);
  });

  test('the details panel shows the section it is given after the account, and nothing when it is not given', () => {
    const node = createElement(section.SuperAdminSection as ElementType, { admin: superRow(), change: 'remove', busy: false, onChange: noop });
    const shown = textOf(render(createElement(details.AdminDetails, { admin: superRow(), onClose: noop, superAdmin: node })));
    assert.match(shown, /Created — Super admin Remove super admin…/);
    const hidden = textOf(render(createElement(details.AdminDetails, { admin: superRow(), onClose: noop })));
    assert.doesNotMatch(hidden, /Remove super admin/);
  });
});

describe('super admin in Admin accounts: page wiring', () => {
  const source = (name: string) => readFileSync(join(ACCOUNTS_DIR, name), 'utf8');

  test('the page offers the section through superAdminChange and hands it to both panels', () => {
    const page = source('page.tsx');
    assert.match(page, /const superAdminAction = openAdmin \? superAdminChange\(openAdmin, currentAdminId\) : null;/);
    assert.equal((page.match(/superAdmin=\{superAdminSection\}/g) ?? []).length, 2);
    assert.match(page, /busy=\{acting !== null\}/);
    assert.match(page, /apiRequest\(superAdminPath\(target\.id\), \{\s*method: 'POST',\s*body: superAdminRequestBody\(change, reason\),\s*select: toSuperAdminResult,/);
  });

  test('the confirm asks for a reason first, and the identity check is asked only after REAUTH_REQUIRED, like the Access step', () => {
    const page = source('page.tsx');
    let at = page.indexOf('const runSuperAdmin = async (target: AdminRow, change: SuperAdminChange, returnFocusTo: FocusTarget)');
    assert.ok(at > 0, 'runSuperAdmin is missing');
    for (const needle of [
      '...superAdminConfirm(target, change)',
      'accessReasonProblem(result.reason)',
      'const attempt = await save();',
      "outcome?.kind === 'reauth' && outcome.code === 'REAUTH_REQUIRED'",
      '...superAdminIdentityConfirm(target, change)',
      "await confirmIdentity(credential ?? '')",
      'reportSuperAdmin(target, change, outcome)',
      "if (outcome.kind !== 'expired') refreshQuietly();",
      'if (sent && !settled) refreshQuietly();',
    ]) {
      const next = page.indexOf(needle, at);
      assert.ok(next > at, `${needle} is missing or out of order`);
      at = next;
    }
    assert.doesNotMatch(page, /credential: \{ kind: 'otp' \}/);
    assert.match(source('confirmOptions.tsx'), /export function superAdminIdentityConfirm[\s\S]*?credential: \{ kind: 'otp' \}/);
  });

  test('both panels render the section at the end of their account tab', () => {
    const editor = source('AdminEditor.tsx');
    const access = editor.indexOf('<AccessSection');
    assert.ok(access > 0 && editor.indexOf('{superAdmin}') > access);
    assert.match(editor, /\{superAdmin\}\s*<\/div>\s*<\/DrawerPanels>/);
    assert.match(source('AdminDetails.tsx'), /\{superAdmin\}\s*<\/div>\s*<\/DrawerPanels>/);
  });

  test('the activity log names both changes under Admins and sign-in, right after access changes', () => {
    assert.equal(activity.actionLabel('GRANT_SUPER_ADMIN'), 'Granted super admin');
    assert.equal(activity.actionLabel('REMOVE_SUPER_ADMIN'), 'Removed super admin');
    const values = activity.ACTION_GROUPS.find((group) => group.label === 'Admins and sign-in')?.options.map((option) => option.value) ?? [];
    const at = values.indexOf('EDIT_ADMIN_ACCESS');
    assert.deepEqual(values.slice(at, at + 3), ['EDIT_ADMIN_ACCESS', 'GRANT_SUPER_ADMIN', 'REMOVE_SUPER_ADMIN']);
    const matching = activity.actionsMatching('super admin');
    assert.ok(matching.includes('GRANT_SUPER_ADMIN') && matching.includes('REMOVE_SUPER_ADMIN'));
  });
});

describe('admin_set_super_admin in schema_admin_app.sql', { skip: !existsSync(ADMIN_SQL) }, () => {
  const sql = () => readFileSync(ADMIN_SQL, 'utf8').replace(/\r\n/g, '\n');
  const fn = () => {
    const text = sql();
    const head = 'CREATE OR REPLACE FUNCTION admin_set_super_admin(';
    const start = text.indexOf(head);
    assert.ok(start > 0, 'admin_set_super_admin is missing');
    assert.equal(text.indexOf(head, start + 1), -1, 'admin_set_super_admin is defined twice');
    return text.slice(start, text.indexOf('\n$$;', start));
  };

  test('is a security definer with a fixed search path, executable by service_role only', () => {
    const text = sql();
    assert.match(fn(), /RETURNS jsonb\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = public\nAS \$\$/);
    assert.match(text, /\$\$;\nREVOKE ALL ON FUNCTION admin_set_super_admin\(uuid, uuid, boolean, text, text, text, text\) FROM public, anon, authenticated;\nGRANT EXECUTE ON FUNCTION admin_set_super_admin\(uuid, uuid, boolean, text, text, text, text\) TO service_role;\n/);
  });

  test('checks the actor, the reason and self-removal before locking the target, and turns the last-super-admin guard into a refusal', () => {
    const body = fn();
    const order = [
      'AND is_super_admin IS TRUE;',
      "RAISE EXCEPTION 'Not authorized';",
      "char_length(v_reason) NOT BETWEEN 3 AND 500",
      "IF NOT p_make AND p_admin_id = p_actor THEN",
      'deleted_at IS NULL FOR UPDATE;',
      'EXCEPTION WHEN raise_exception THEN',
      "IF SQLERRM = 'At least one active super admin is required' THEN",
      'INSERT INTO audit_log (',
      'PERFORM emit_admin_security_alert(',
    ].map((needle) => body.indexOf(needle));
    assert.ok(order.every((at) => at > 0), JSON.stringify(order));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.match(body, /SET is_super_admin = true,\n\s+role_id = NULL,\n\s+token_version = token_version \+ 1\n/);
    assert.match(body, /SET is_super_admin = false,\n\s+role_id = NULL,\n\s+direct_permissions = ARRAY\[\]::text\[\],\n\s+token_version = token_version \+ 1\n/);
    assert.match(body, /CASE WHEN p_make THEN 'GRANT_SUPER_ADMIN' ELSE 'REMOVE_SUPER_ADMIN' END/);
    assert.match(body, /v_ip, v_ua, v_rid, v_actor\.role_title, v_reason, 'success', 'security'/);
    assert.match(body, /'admin_super_admin_changed',/);
  });

  test('every refusal the function can return is mapped by the route to a 4xx answer', async () => {
    const reasons = [...new Set([...fn().matchAll(/'ok', false, 'reason', '([a-z_]+)'/g)].map((match) => match[1]))].sort();
    assert.deepEqual(reasons, [
      'inactive', 'invalid', 'invite_pending', 'last_super_admin', 'not_found', 'reason_required', 'self', 'unchanged',
    ]);
    for (const reason of reasons) {
      for (const body of [grant(), removal()]) {
        reset({ data: { ok: false, reason } });
        const reply = await post(body);
        assert.ok(reply.status >= 400 && reply.status < 500, `${reason}: ${reply.status}`);
      }
    }
  });

  test('the protected role’s seed and its idempotent correction carry the same description', () => {
    const text = sql();
    assert.doesNotMatch(text, /Granted only in the database/);
    assert.ok(text.includes(`  'Super administrator',\n  '${DESCRIPTION}',\n`));
    assert.ok(text.includes([
      'UPDATE admin_roles',
      `   SET description = '${DESCRIPTION}'`,
      " WHERE system_key = 'super_admin'",
      `   AND description IS DISTINCT FROM '${DESCRIPTION}';`,
    ].join('\n')));
  });
});
