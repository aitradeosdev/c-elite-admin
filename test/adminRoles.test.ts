import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { ALL_PERMISSIONS, PERMISSION_CATALOG, PERMISSION_CATEGORIES, permissionStatus } from '../app/lib/permissions.ts';

const STATE_KEY = '__cardeliteAdminRolesTest';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const TEST_FILE = fileURLToPath(import.meta.url);
const SESSION_TEST_FILE = fileURLToPath(new URL('./sessionAuth.test.ts', import.meta.url));
const MOBILE_DIR = fileURLToPath(new URL('../../CardEliteAdmin/', import.meta.url));

const ROUTES = {
  roles: 'api/admin-roles/route.ts',
  role: 'api/admin-roles/[id]/route.ts',
  archive: 'api/admin-roles/[id]/archive/route.ts',
  restore: 'api/admin-roles/[id]/restore/route.ts',
  preview: 'api/admin-roles/preview/route.ts',
  catalog: 'api/admin-permissions/route.ts',
} as const;

type RouteName = keyof typeof ROUTES;

const ROUTE_EXPORTS: Readonly<Record<RouteName, readonly string[]>> = {
  roles: ['GET', 'POST'],
  role: ['GET', 'PATCH'],
  archive: ['POST'],
  restore: ['POST'],
  preview: ['POST'],
  catalog: ['GET'],
};

const WEB_PATHS = Object.values(ROUTES).map((file) => `/${file.slice(0, -'/route.ts'.length)}`);

const OWNER_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const DEPUTY_ID = '0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6';
const FORMER_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const MANAGER_ID = '11111111-2222-4333-8444-555555555555';
const CLERK_ID = '22222222-3333-4444-8555-666666666666';
const GONE_ID = '33333333-4444-4555-8666-777777777777';
const STEADY_ID = '88888888-9999-4aaa-bbbb-cccccccccccc';
const SYSTEM_ROLE_ID = '44444444-5555-4666-8777-888888888888';
const MANAGER_ROLE_ID = '55555555-6666-4777-8888-999999999999';
const AUDITOR_ROLE_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const NEW_ROLE_ID = '77777777-8888-4999-aaaa-bbbbbbbbbbbb';
const SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
const REQUEST_ID = 'req_adminroles01';
const USER_AGENT = 'Mozilla/5.0 (CardElite roles test)';
const CLIENT_IP = '198.51.100.11';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const REASON = 'Approval moves to the finance desk';
const REASON_TEXT = 'Enter a reason of 3 to 500 characters.';
const STALE_TEXT = 'That record has changed. Reload and try again.';
const SUPER_ONLY_TEXT = 'This action is restricted to super administrators.';
const LOST_APPROVAL = ['withdrawals.approve', 'withdrawals.reject', 'withdrawals.retry', 'withdrawals.resolve', 'withdrawals.export'];

interface DbError {
  message: string;
  code?: string;
}

interface DbResult {
  data?: unknown;
  error?: DbError | null;
}

type Row = Record<string, unknown>;
type RpcReply = DbResult | 'throw' | ((args: Record<string, unknown>) => DbResult | 'throw');
type Filter = [kind: string, column: string, value: unknown];

interface Query {
  table: string;
  op: 'select' | 'insert' | null;
  columns: string | null;
  payload: unknown;
  filters: Filter[];
  orders: Array<[column: string, ascending: boolean]>;
  single: boolean;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface StubState {
  claims: Record<string, unknown> | null | 'unavailable';
  tables: Record<string, Row[]>;
  failOn: ((query: Query) => DbError | 'throw' | null) | null;
  replies: Map<string, RpcReply>;
  rpcs: RpcCall[];
  queries: Query[];
  db: {
    from(table: string): object;
    rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
  };
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface RouteModule {
  GET?: Handler;
  POST?: Handler;
  PATCH?: Handler;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const CONNECTION_LOST: DbError = { message: 'connection terminated', code: '08006' };
const NOT_AUTHORIZED: DbError = { message: 'Not authorized', code: 'P0001' };

const logs: string[] = [];

const state: StubState = {
  claims: null,
  tables: {},
  failOn: null,
  replies: new Map(),
  rpcs: [],
  queries: [],
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

function compare(a: unknown, b: unknown): number {
  const left = String(a ?? '');
  const right = String(b ?? '');
  return left < right ? -1 : left > right ? 1 : 0;
}

function matches(row: Row, [kind, column, value]: Filter): boolean {
  const cell = row[column] ?? null;
  if (kind === 'eq' || kind === 'is') return cell === value;
  if (kind === 'in') return Array.isArray(value) && value.includes(cell);
  throw new Error(`unexpected filter ${kind}`);
}

function respond(query: Query): DbResult | 'throw' {
  if (query.table === 'audit_log' && query.op === 'insert') return { error: null };
  const failure = state.failOn?.(query) ?? null;
  if (failure === 'throw') return 'throw';
  if (failure) return { error: failure };
  const table = state.tables[query.table];
  if (!table || query.op !== 'select') throw new Error(`unexpected query ${JSON.stringify(query)}`);
  let rows = table.filter((row) => query.filters.every((filter) => matches(row, filter)));
  for (const [column, ascending] of [...query.orders].reverse()) {
    rows = [...rows].sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1));
  }
  const columns = (query.columns ?? '').split(',').map((column) => column.trim());
  const projected = rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
  if (query.single) return projected.length > 1 ? { error: { message: 'more than one row' } } : { data: projected[0] ?? null };
  return { data: projected };
}

function chain(table: string): object {
  const query: Query = { table, op: null, columns: null, payload: undefined, filters: [], orders: [], single: false };
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
    order: (column: string, options?: { ascending?: boolean }) => {
      query.orders.push([column, options?.ascending !== false]);
      return builder;
    },
    maybeSingle: () => {
      query.single = true;
      return builder;
    },
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

const routes = {} as Record<RouteName, RouteModule>;

before(async () => {
  for (const [name, path] of Object.entries(ROUTES)) {
    routes[name as RouteName] = (await import(await bundle(resolve(APP_DIR, path)))) as RouteModule;
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

const staleSession = () => freshSession({ reauthAt: iso(-10 * MINUTE_MS) });

function superAdmin(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    admin_id: OWNER_ID,
    username: 'owner',
    role_title: 'Super Admin',
    is_super_admin: true,
    page_permissions: ['transfers', 'manual_wallet_credit', 'admin_accounts'],
    token_version: 16,
    session: freshSession(),
    mfa: { status: 'active', lockedUntil: null },
    policy: { mode: 'off', graceEndsAt: null, requiredNow: false },
    ...patch,
  };
}

function manager(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return superAdmin({
    admin_id: MANAGER_ID,
    username: 'manager',
    role_title: 'Manager',
    is_super_admin: false,
    page_permissions: ['dashboard', 'users', 'withdrawals'],
    token_version: 4,
    mfa: { status: 'none', lockedUntil: null },
    ...patch,
  });
}

const accountsKeeper = () => manager({ page_permissions: ['dashboard', 'admin_accounts'], mfa: { status: 'active', lockedUntil: null } });

const SYSTEM_ROLE: Row = {
  id: SYSTEM_ROLE_ID,
  name: 'Super administrator',
  description: 'Holds every permission. Granted only in the database. It cannot be edited, archived or assigned here.',
  permissions: [],
  system_key: 'super_admin',
  is_protected: true,
  version: 1,
  archived_at: null,
  archived_by: null,
  created_at: '2026-10-16T09:00:00+00:00',
  created_by: null,
  updated_at: '2026-10-16T09:00:00+00:00',
  updated_by: null,
};

const MANAGER_ROLE: Row = {
  id: MANAGER_ROLE_ID,
  name: 'Manager',
  description: 'Runs withdrawals and users day to day.',
  permissions: ['dashboard', 'users', 'withdrawals'],
  system_key: null,
  is_protected: false,
  version: 3,
  archived_at: null,
  archived_by: null,
  created_at: '2026-10-17T09:00:00+00:00',
  created_by: OWNER_ID,
  updated_at: '2026-10-18T10:00:00+00:00',
  updated_by: OWNER_ID,
};

const AUDITOR_ROLE: Row = {
  id: AUDITOR_ROLE_ID,
  name: 'Auditor',
  description: '',
  permissions: ['audit.export', 'audit.read'],
  system_key: null,
  is_protected: false,
  version: 2,
  archived_at: '2026-10-19T08:00:00+00:00',
  archived_by: FORMER_ID,
  created_at: '2026-10-17T11:00:00+00:00',
  created_by: OWNER_ID,
  updated_at: '2026-10-19T08:00:00+00:00',
  updated_by: FORMER_ID,
};

const NEW_ROLE: Row = {
  ...MANAGER_ROLE,
  id: NEW_ROLE_ID,
  name: 'Payout reviewer',
  description: 'Reviews payouts',
  permissions: ['withdrawals.approve', 'withdrawals.read'],
  version: 1,
  created_at: '2026-10-21T09:00:00+00:00',
  updated_at: '2026-10-21T09:00:00+00:00',
};

function adminRow(id: string, username: string, patch: Row = {}): Row {
  return {
    id,
    username,
    role_title: 'Card Reviewer',
    is_active: true,
    is_super_admin: false,
    deleted_at: null,
    role_id: null,
    direct_permissions: [],
    last_login_at: '2026-10-15T08:00:00+00:00',
    ...patch,
  };
}

function admins(): Row[] {
  return [
    adminRow(OWNER_ID, 'owner', {
      role_title: 'Super Admin', is_super_admin: true, direct_permissions: ['transfers', 'manual_wallet_credit', 'admin_accounts'],
    }),
    adminRow(DEPUTY_ID, 'deputy', { role_title: 'Super Admin', is_super_admin: true, is_active: false }),
    adminRow(FORMER_ID, 'former', { role_title: 'Super Admin', is_super_admin: true, is_active: false, deleted_at: '2026-10-20T08:00:00+00:00' }),
    adminRow(MANAGER_ID, 'manager', { role_title: 'Manager', role_id: MANAGER_ROLE_ID, direct_permissions: ['coupons'] }),
    adminRow(CLERK_ID, 'clerk', {
      role_title: 'Clerk', is_active: false, role_id: MANAGER_ROLE_ID, direct_permissions: ['withdrawals.read'], last_login_at: null,
    }),
    adminRow(GONE_ID, 'gone', {
      is_active: false, deleted_at: '2026-09-01T00:00:00+00:00', role_id: MANAGER_ROLE_ID, direct_permissions: ['activity'],
    }),
  ];
}

const SAVED_MEMBERS = [
  {
    admin_id: CLERK_ID, username: 'clerk', is_active: false, is_super_admin: false,
    before: ['dashboard', 'users', 'withdrawals', 'withdrawals.read'], after: ['dashboard', 'users', 'withdrawals.read'], changed: true,
  },
  {
    admin_id: MANAGER_ID, username: 'manager', is_active: true, is_super_admin: false,
    before: ['coupons', 'dashboard', 'users', 'withdrawals'], after: ['coupons', 'dashboard', 'users', 'withdrawals.read'], changed: true,
  },
  {
    admin_id: STEADY_ID, username: 'steady', is_active: true, is_super_admin: false,
    before: ['withdrawals'], after: ['withdrawals', 'withdrawals.read'], changed: false,
  },
  {
    admin_id: DEPUTY_ID, username: 'deputy', is_active: false, is_super_admin: true,
    before: ['withdrawals'], after: ['withdrawals.read'], changed: false,
  },
];

const SAVED_IMPACT = {
  members_total: 4,
  affected: [
    { admin_id: CLERK_ID, username: 'clerk', is_active: false, gained: [], lost: LOST_APPROVAL, highest_risk: 'critical' },
    { admin_id: MANAGER_ID, username: 'manager', is_active: true, gained: [], lost: LOST_APPROVAL, highest_risk: 'critical' },
  ],
  unchanged: [
    { admin_id: STEADY_ID, username: 'steady', why: 'same_access' },
    { admin_id: DEPUTY_ID, username: 'deputy', why: 'super_admin' },
  ],
  signed_out_count: 1,
};

function reset(claims: StubState['claims'] = superAdmin()): void {
  state.claims = claims;
  state.tables = { admin_roles: [SYSTEM_ROLE, MANAGER_ROLE, AUDITOR_ROLE].map((row) => ({ ...row })), admin_users: admins() };
  state.failOn = null;
  state.replies = new Map();
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

function routePath(name: RouteName, id: string | undefined): string {
  return `/${ROUTES[name].slice(0, -'/route.ts'.length).replace('[id]', id ?? '')}`;
}

async function call(
  name: RouteName,
  method: 'GET' | 'POST' | 'PATCH',
  options: { id?: string; body?: unknown; raw?: string } = {},
): Promise<Reply> {
  const handler = routes[name][method];
  assert.ok(handler, `${ROUTES[name]} has no ${method} handler`);
  const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const req = new Request(`http://localhost${routePath(name, options.id)}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : payload,
  });
  const res = await handler(req, { params: Promise.resolve<Record<string, string>>(options.id === undefined ? {} : { id: options.id }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function failure(code: string, message: string, details?: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = { success: false, error: message, code, message, request_id: REQUEST_ID };
  if (details !== undefined) body.details = details;
  return body;
}

function success(payload: Record<string, unknown>): Record<string, unknown> {
  return { success: true, request_id: REQUEST_ID, ...payload };
}

function reads(table: string): Query[] {
  return state.queries.filter((query) => query.table === table && query.op === 'select');
}

function rpcArgs(name: string): Array<Record<string, unknown>> {
  return state.rpcs.filter((entry) => entry.name === name).map((entry) => entry.args);
}

function audits(): Array<Record<string, unknown>> {
  return state.queries
    .filter((query) => query.table === 'audit_log' && query.op === 'insert')
    .map((query) => query.payload as Record<string, unknown>);
}

function failureAudit(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    admin_id: OWNER_ID,
    user_id: null,
    action: null,
    entity: 'admin_roles',
    entity_id: null,
    before_value: null,
    after_value: null,
    ip_address: CLIENT_IP,
    admin_role: 'Super Admin',
    user_agent: USER_AGENT,
    request_id: REQUEST_ID,
    reason: null,
    result: 'failure',
    error: null,
    sensitivity: 'security',
    ...patch,
  };
}

function view(row: Row, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: row.permissions,
    is_protected: row.is_protected,
    system_key: row.system_key,
    archived_at: row.archived_at,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...patch,
  };
}

function failing(table: string, columns: string | null, answer: DbError | 'throw' = CONNECTION_LOST): (query: Query) => DbError | 'throw' | null {
  return (query) => (query.table === table && (columns === null || query.columns === columns) ? answer : null);
}

const createBody = (patch: Record<string, unknown> = {}) => ({
  name: '  Payout reviewer ',
  description: ' Reviews payouts ',
  permissions: ['withdrawals.read', 'withdrawals.approve', 'withdrawals.read', ''],
  reason: `  ${REASON}  `,
  ...patch,
});

const editBody = (patch: Record<string, unknown> = {}) => ({
  name: 'Manager',
  description: 'Runs withdrawals and users day to day.',
  permissions: ['dashboard', 'users', 'withdrawals.read'],
  reason: REASON,
  expected_version: 3,
  ...patch,
});

const draftBody = (patch: Record<string, unknown> = {}) => ({
  role_id: MANAGER_ROLE_ID,
  expected_version: 3,
  name: 'Manager',
  description: 'Runs withdrawals and users day to day.',
  permissions: ['dashboard', 'users', 'withdrawals.read'],
  ...patch,
});

describe('GET /api/admin-roles', () => {
  test('answers 403 for the Manager, who holds no roles.read, before reading anything', async () => {
    reset(manager());
    const reply = await call('roles', 'GET');
    assert.equal(reply.status, 403);
    assert.deepEqual(reply.body, failure('PERMISSION_DENIED', 'You do not have permission to do this.', { required: ['roles.read'] }));
    assert.deepEqual(state.queries, []);
  });

  test('lists every role with its counts and editor for a super admin, reading names by id and never through an embed', async () => {
    const reply = await call('roles', 'GET');
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, success({
      roles: [
        view(SYSTEM_ROLE, { action_count: ALL_PERMISSIONS.length, member_count: 1, active_member_count: 1, updated_by_username: null }),
        view(MANAGER_ROLE, { action_count: 10, member_count: 2, active_member_count: 1, updated_by_username: 'owner' }),
        view(AUDITOR_ROLE, { action_count: 2, member_count: 0, active_member_count: 0, updated_by_username: 'former' }),
      ],
      super_admin_count: 1,
      can_manage: true,
    }));
    assert.deepEqual(reads('admin_roles').map((query) => [query.filters, query.orders]), [[[], [['created_at', true]]]]);
    assert.deepEqual(reads('admin_users').map((query) => [query.columns, query.filters]), [
      ['role_id, is_active, is_super_admin', [['is', 'deleted_at', null]]],
      ['id, username', [['in', 'id', [OWNER_ID, FORMER_ID]]]],
    ]);
    for (const query of state.queries) assert.doesNotMatch(query.columns ?? '', /[(!]/, query.columns ?? '');
    assert.deepEqual(audits(), []);
  });

  test('an admin who holds roles.read through the legacy admin_accounts page key can read but not manage', async () => {
    reset(accountsKeeper());
    const reply = await call('roles', 'GET');
    assert.equal(reply.status, 200);
    assert.equal(reply.body.can_manage, false);
    assert.equal((reply.body.roles as unknown[]).length, 3);
  });

  test('answers 500, never 401 or an empty list, when a read fails or the session cannot be checked', async () => {
    const outages: Array<(query: Query) => DbError | 'throw' | null> = [
      failing('admin_roles', null),
      failing('admin_users', 'role_id, is_active, is_super_admin'),
      failing('admin_users', 'id, username'),
      failing('admin_roles', null, 'throw'),
    ];
    for (const outage of outages) {
      reset();
      state.failOn = outage;
      const reply = await call('roles', 'GET');
      assert.equal(reply.status, 500);
      assert.deepEqual(reply.body, failure('INTERNAL_ERROR', 'Roles could not be loaded.'));
      assert.ok(logs.some((line) => line.includes('connection terminated') || line.includes('fetch failed')), logs.join('\n'));
    }
    reset('unavailable');
    const unchecked = await call('roles', 'GET');
    assert.equal(unchecked.status, 500);
    assert.deepEqual(unchecked.body, failure('INTERNAL_ERROR', 'Your session could not be checked. Try again.'));
    reset(null);
    assert.equal((await call('roles', 'GET')).status, 401);
  });
});

describe('GET /api/admin-roles/[id]', () => {
  test('returns the stored role and its members who are not deleted, by username', async () => {
    const reply = await call('role', 'GET', { id: MANAGER_ROLE_ID.toUpperCase() });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, success({
      role: MANAGER_ROLE,
      members: [
        { id: CLERK_ID, username: 'clerk', role_title: 'Clerk', is_active: false, last_login_at: null },
        { id: MANAGER_ID, username: 'manager', role_title: 'Manager', is_active: true, last_login_at: '2026-10-15T08:00:00+00:00' },
      ],
    }));
    assert.deepEqual(reads('admin_roles').map((query) => [query.filters, query.single]), [[[['eq', 'id', MANAGER_ROLE_ID]], true]]);
    assert.deepEqual(reads('admin_users').map((query) => [query.columns, query.filters, query.orders]), [[
      'id, username, role_title, is_active, last_login_at',
      [['is', 'deleted_at', null], ['eq', 'role_id', MANAGER_ROLE_ID]],
      [['username', true]],
    ]]);
  });

  test('the protected system role lists the active super admins', async () => {
    const reply = await call('role', 'GET', { id: SYSTEM_ROLE_ID });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body.role, SYSTEM_ROLE);
    assert.deepEqual(reply.body.members, [
      { id: OWNER_ID, username: 'owner', role_title: 'Super Admin', is_active: true, last_login_at: '2026-10-15T08:00:00+00:00' },
    ]);
    assert.deepEqual(reads('admin_users').map((query) => query.filters), [
      [['is', 'deleted_at', null], ['eq', 'is_super_admin', true], ['eq', 'is_active', true]],
    ]);
  });

  test('refuses a bad id with 400 and a missing role with 404, and the Manager with 403', async () => {
    const bad = await call('role', 'GET', { id: 'not-a-role' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body, failure('VALIDATION_ERROR', 'A valid role id is required.'));
    assert.deepEqual(state.queries, []);
    const missing = await call('role', 'GET', { id: NEW_ROLE_ID });
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, failure('RESOURCE_NOT_FOUND', 'Role not found.'));
    reset(manager());
    assert.equal((await call('role', 'GET', { id: MANAGER_ROLE_ID })).status, 403);
  });

  test('answers 500 when the role or its members cannot be read', async () => {
    for (const outage of [failing('admin_roles', null), failing('admin_users', null), failing('admin_users', null, 'throw')]) {
      reset();
      state.failOn = outage;
      const reply = await call('role', 'GET', { id: MANAGER_ROLE_ID });
      assert.equal(reply.status, 500);
      assert.deepEqual(reply.body, failure('INTERNAL_ERROR', 'The role could not be loaded.'));
    }
  });
});

describe('role writes need a super admin in the web console with two-step sign-in and a recent identity check', () => {
  const writes: Array<[string, () => Promise<Reply>]> = [
    ['create', () => call('roles', 'POST', { body: createBody() })],
    ['edit', () => call('role', 'PATCH', { id: MANAGER_ROLE_ID, body: editBody() })],
    ['archive', () => call('archive', 'POST', { id: MANAGER_ROLE_ID, body: { reason: REASON, expected_version: 3 } })],
    ['restore', () => call('restore', 'POST', { id: AUDITOR_ROLE_ID, body: { reason: REASON, expected_version: 2 } })],
  ];

  test('without two-step sign-in each write answers MFA_REQUIRED and touches nothing', async () => {
    for (const [label, send] of writes) {
      reset(superAdmin({ mfa: { status: 'none', lockedUntil: null }, session: staleSession() }));
      const reply = await send();
      assert.equal(reply.status, 403, label);
      assert.deepEqual(reply.body, failure('MFA_REQUIRED', 'Set up two-step sign-in first.'), label);
      assert.deepEqual([state.queries, state.rpcs], [[], []], label);
    }
  });

  test('without an identity check in the last five minutes each write answers REAUTH_REQUIRED and touches nothing', async () => {
    for (const [label, send] of writes) {
      reset(superAdmin({ session: staleSession() }));
      const reply = await send();
      assert.equal(reply.status, 403, label);
      assert.deepEqual(reply.body, failure('REAUTH_REQUIRED', 'Confirm it is you to continue.', { method: 'otp', max_age_secs: 300 }), label);
      assert.deepEqual([state.queries, state.rpcs], [[], []], label);
    }
  });

  test('an admin who is not a super admin is refused even with roles.read and two-step sign-in', async () => {
    for (const [label, send] of writes) {
      reset(accountsKeeper());
      const reply = await send();
      assert.equal(reply.status, 403, label);
      assert.deepEqual(reply.body, failure('PERMISSION_DENIED', SUPER_ONLY_TEXT), label);
      assert.deepEqual([state.queries, state.rpcs], [[], []], label);
    }
  });

  test('a phone session is refused before any step-up check, even freshly signed in with two-step sign-in', async () => {
    for (const [label, send] of writes) {
      reset(superAdmin({ session: freshSession({ client: 'mobile', transport: 'bearer' }) }));
      const reply = await send();
      assert.equal(reply.status, 403, label);
      assert.deepEqual(reply.body, failure('PERMISSION_DENIED', 'Roles can only be changed in the web console.'), label);
      assert.deepEqual([state.queries, state.rpcs], [[], []], label);
    }
  });
});

describe('POST /api/admin-roles', () => {
  test('creates the role through admin_role_save and answers 201 with the saved row, leaving the success audit to the database', async () => {
    state.replies.set('admin_role_save', { data: { ok: true, role: NEW_ROLE, members: [], changed: 0, signed_out: 0 } });
    const reply = await call('roles', 'POST', { body: createBody() });
    assert.equal(reply.status, 201);
    assert.deepEqual(reply.body, success({ role: NEW_ROLE }));
    assert.deepEqual(rpcArgs('admin_role_save'), [{
      p_actor: OWNER_ID,
      p_role_id: null,
      p_expected_version: null,
      p_name: 'Payout reviewer',
      p_description: 'Reviews payouts',
      p_permissions: ['withdrawals.read', 'withdrawals.approve'],
      p_reason: REASON,
      p_dry_run: false,
      p_ip: CLIENT_IP,
      p_user_agent: USER_AGENT,
      p_request_id: REQUEST_ID,
    }]);
    assert.deepEqual(audits(), []);
  });

  test('refuses a body that is not an object, a bad name and a missing reason with 400 and a failure audit, before the database', async () => {
    const cases: Array<[{ body?: unknown; raw?: string }, Record<string, unknown>, Record<string, unknown>]> = [
      [
        { raw: 'not json' },
        failure('VALIDATION_ERROR', 'Send the new role as a JSON object.', { reason: 'invalid' }),
        failureAudit({
          action: 'CREATE_ADMIN_ROLE', after_value: { name: null, description: null, permissions: null },
          error: 'Send the new role as a JSON object.',
        }),
      ],
      [
        { body: createBody({ name: 'x' }) },
        failure('VALIDATION_ERROR', 'Role name must be 2–64 characters.', { field: 'name', reason: 'invalid' }),
        failureAudit({
          action: 'CREATE_ADMIN_ROLE', reason: REASON, error: 'Role name must be 2–64 characters.',
          after_value: { name: 'x', description: 'Reviews payouts', permissions: ['withdrawals.read', 'withdrawals.approve'] },
        }),
      ],
      [
        { body: createBody({ reason: 'no' }) },
        failure('VALIDATION_ERROR', REASON_TEXT, { field: 'reason', reason: 'reason_required' }),
        failureAudit({
          action: 'CREATE_ADMIN_ROLE', error: REASON_TEXT,
          after_value: { name: 'Payout reviewer', description: 'Reviews payouts', permissions: ['withdrawals.read', 'withdrawals.approve'] },
        }),
      ],
    ];
    for (const [request, expected, audit] of cases) {
      reset();
      const reply = await call('roles', 'POST', request);
      assert.equal(reply.status, 400);
      assert.deepEqual(reply.body, expected);
      assert.deepEqual(state.rpcs, []);
      assert.deepEqual(audits(), [audit]);
    }
  });

  test('refuses newly added restricted, reserved, retired and unknown keys with 400 and the keys', async () => {
    const reply = await call('roles', 'POST', {
      body: createBody({ permissions: ['users.read', 'roles.write', 'admin_accounts', 'withdrawals.retry', 'giftbox', 'transfers'] }),
    });
    const keys = ['admin_accounts', 'withdrawals.retry', 'roles.write', 'giftbox', 'transfers'];
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, failure(
      'VALIDATION_ERROR',
      'These permissions cannot be added to a role: admin_accounts, withdrawals.retry, roles.write, giftbox, transfers.',
      { field: 'permissions', reason: 'not_grantable', keys },
    ));
    assert.deepEqual(state.rpcs, []);
    assert.deepEqual(audits().map((row) => [row.action, row.result, row.reason]), [['CREATE_ADMIN_ROLE', 'failure', REASON]]);
  });

  test('maps name_taken to 409, RAISE Not authorized to 403 and other database failures to 500, each recorded as a failure', async () => {
    const created = 'The role could not be created. Try again.';
    const cases: Array<[RpcReply, number, Record<string, unknown>, string]> = [
      [{ data: { ok: false, reason: 'name_taken' } }, 409,
        failure('STATE_CONFLICT', 'Another role already has this name.', { reason: 'name_taken' }), 'Another role already has this name.'],
      [{ data: { ok: false, reason: 'invalid' } }, 400,
        failure('VALIDATION_ERROR', 'The request was not valid.', { reason: 'invalid' }), 'The request was not valid.'],
      [{ error: NOT_AUTHORIZED }, 403, failure('PERMISSION_DENIED', SUPER_ONLY_TEXT), 'Not authorized'],
      [{ error: CONNECTION_LOST }, 500, failure('INTERNAL_ERROR', created), 'connection terminated'],
      ['throw', 500, failure('INTERNAL_ERROR', created), 'fetch failed'],
      [{ data: { ok: false, reason: 'surprise' } }, 500, failure('INTERNAL_ERROR', created), created],
    ];
    for (const [answer, status, expected, error] of cases) {
      reset();
      state.replies.set('admin_role_save', answer);
      const reply = await call('roles', 'POST', { body: createBody() });
      assert.equal(reply.status, status, error);
      assert.deepEqual(reply.body, expected, error);
      assert.deepEqual(audits(), [failureAudit({
        action: 'CREATE_ADMIN_ROLE', reason: REASON, error,
        after_value: { name: 'Payout reviewer', description: 'Reviews payouts', permissions: ['withdrawals.read', 'withdrawals.approve'] },
      })], error);
      if (status === 500) assert.ok(logs.length > 0, error);
    }
  });
});

describe('PATCH /api/admin-roles/[id]', () => {
  test('saves against the expected version and answers the saved row with the impact the save returned', async () => {
    const saved = { ...MANAGER_ROLE, permissions: ['dashboard', 'users', 'withdrawals.read'], version: 4, updated_at: '2026-10-21T10:00:00+00:00' };
    state.replies.set('admin_role_save', { data: { ok: true, role: saved, members: SAVED_MEMBERS, changed: 2, signed_out: 1 } });
    const reply = await call('role', 'PATCH', { id: MANAGER_ROLE_ID, body: editBody() });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, success({ role: saved, impact: SAVED_IMPACT }));
    assert.deepEqual(rpcArgs('admin_role_save'), [{
      p_actor: OWNER_ID,
      p_role_id: MANAGER_ROLE_ID,
      p_expected_version: 3,
      p_name: 'Manager',
      p_description: 'Runs withdrawals and users day to day.',
      p_permissions: ['dashboard', 'users', 'withdrawals.read'],
      p_reason: REASON,
      p_dry_run: false,
      p_ip: CLIENT_IP,
      p_user_agent: USER_AGENT,
      p_request_id: REQUEST_ID,
    }]);
    assert.deepEqual(audits(), []);
  });

  test('requires expected_version, and a version that no longer matches answers 409 with the current one before the database', async () => {
    const missing = await call('role', 'PATCH', { id: MANAGER_ROLE_ID, body: editBody({ expected_version: undefined }) });
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body, failure('VALIDATION_ERROR', 'A valid role version is required.', { field: 'expected_version', reason: 'invalid' }));
    assert.deepEqual([reads('admin_roles'), state.rpcs], [[], []]);
    assert.deepEqual(audits(), [failureAudit({
      action: 'EDIT_ADMIN_ROLE', entity_id: MANAGER_ROLE_ID, reason: REASON, error: 'A valid role version is required.',
      after_value: {
        name: 'Manager', description: 'Runs withdrawals and users day to day.',
        permissions: ['dashboard', 'users', 'withdrawals.read'], expected_version: null,
      },
    })]);

    reset();
    const stale = await call('role', 'PATCH', { id: MANAGER_ROLE_ID, body: editBody({ expected_version: 2 }) });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body, failure('STATE_CONFLICT', STALE_TEXT, { reason: 'stale', version: 3 }));
    assert.deepEqual(state.rpcs, []);
    assert.deepEqual(audits().map((row) => [row.action, row.entity_id, row.result, row.error]), [
      ['EDIT_ADMIN_ROLE', MANAGER_ROLE_ID, 'failure', STALE_TEXT],
    ]);
  });

  test('refuses the protected system role, an archived role, a missing role and a bad id like the database does', async () => {
    const cases: Array<[string, unknown, number, Record<string, unknown>]> = [
      [SYSTEM_ROLE_ID, 1, 409, failure('STATE_CONFLICT', 'This role is protected and cannot be changed.', { reason: 'protected' })],
      [AUDITOR_ROLE_ID, 2, 409, failure('STATE_CONFLICT', 'This role is archived. Restore it before changing it.', { reason: 'archived' })],
      [NEW_ROLE_ID, 1, 404, failure('RESOURCE_NOT_FOUND', 'That record could not be found.', { reason: 'not_found' })],
      ['not-a-role', 1, 400, failure('VALIDATION_ERROR', 'A valid role id is required.', { field: 'id', reason: 'invalid' })],
    ];
    for (const [id, version, status, expected] of cases) {
      reset();
      const reply = await call('role', 'PATCH', { id, body: editBody({ expected_version: version }) });
      assert.equal(reply.status, status, id);
      assert.deepEqual(reply.body, expected, id);
      assert.deepEqual(state.rpcs, [], id);
      assert.deepEqual(audits().map((row) => [row.action, row.entity_id, row.result]), [
        ['EDIT_ADMIN_ROLE', id === 'not-a-role' ? null : id, 'failure'],
      ], id);
    }
  });

  test('keeps keys the role already holds and refuses newly added keys a role may not hold', async () => {
    state.replies.set('admin_role_save', { data: { ok: true, role: MANAGER_ROLE, members: [], changed: 0, signed_out: 0 } });
    const kept = await call('role', 'PATCH', {
      id: MANAGER_ROLE_ID, body: editBody({ permissions: ['dashboard', 'users', 'withdrawals', 'coupons.read'] }),
    });
    assert.equal(kept.status, 200);
    assert.deepEqual(rpcArgs('admin_role_save').map((args) => args.p_permissions), [['dashboard', 'users', 'withdrawals', 'coupons.read']]);

    reset();
    const refused = await call('role', 'PATCH', {
      id: MANAGER_ROLE_ID,
      body: editBody({ permissions: ['dashboard', 'users', 'withdrawals', 'withdrawals.retry', 'roles.write', 'transfers', 'manual_wallet_credit'] }),
    });
    const keys = ['withdrawals.retry', 'roles.write', 'manual_wallet_credit', 'transfers'];
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, failure(
      'VALIDATION_ERROR',
      'These permissions cannot be added to a role: withdrawals.retry, roles.write, manual_wallet_credit, transfers.',
      { field: 'permissions', reason: 'not_grantable', keys },
    ));
    assert.deepEqual(state.rpcs, []);
  });

  test('maps the database stale answer to 409 with its version and Not authorized to 403, each recorded as a failure', async () => {
    state.replies.set('admin_role_save', { data: { ok: false, reason: 'stale', version: 4 } });
    const stale = await call('role', 'PATCH', { id: MANAGER_ROLE_ID, body: editBody() });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body, failure('STATE_CONFLICT', STALE_TEXT, { reason: 'stale', version: 4 }));
    assert.deepEqual(audits().map((row) => [row.action, row.entity_id, row.error]), [['EDIT_ADMIN_ROLE', MANAGER_ROLE_ID, STALE_TEXT]]);

    reset();
    state.replies.set('admin_role_save', { error: NOT_AUTHORIZED });
    const denied = await call('role', 'PATCH', { id: MANAGER_ROLE_ID, body: editBody() });
    assert.equal(denied.status, 403);
    assert.deepEqual(denied.body, failure('PERMISSION_DENIED', SUPER_ONLY_TEXT));
    assert.deepEqual(audits().map((row) => [row.action, row.result, row.error]), [['EDIT_ADMIN_ROLE', 'failure', 'Not authorized']]);
  });

  test('answers 500 when the role cannot be read or saved, logged and recorded', async () => {
    state.failOn = failing('admin_roles', null);
    const unread = await call('role', 'PATCH', { id: MANAGER_ROLE_ID, body: editBody() });
    assert.equal(unread.status, 500);
    assert.deepEqual(unread.body, failure('INTERNAL_ERROR', 'The role could not be saved. Try again.'));
    assert.deepEqual(state.rpcs, []);
    assert.deepEqual(audits().map((row) => [row.action, row.error]), [['EDIT_ADMIN_ROLE', 'The role could not be read.']]);
    assert.ok(logs.some((line) => line.includes('connection terminated')));

    reset();
    state.replies.set('admin_role_save', { error: CONNECTION_LOST });
    const unsaved = await call('role', 'PATCH', { id: MANAGER_ROLE_ID, body: editBody() });
    assert.equal(unsaved.status, 500);
    assert.deepEqual(audits().map((row) => [row.action, row.error]), [['EDIT_ADMIN_ROLE', 'connection terminated']]);
  });
});

describe('POST /api/admin-roles/[id]/archive and /restore', () => {
  test('archive and restore call admin_role_set_archived with the reason and version and answer the role', async () => {
    const archived = { ...MANAGER_ROLE, archived_at: '2026-10-21T11:00:00+00:00', archived_by: OWNER_ID, version: 4 };
    state.replies.set('admin_role_set_archived', { data: { ok: true, role: archived } });
    const reply = await call('archive', 'POST', { id: MANAGER_ROLE_ID, body: { reason: `  ${REASON} `, expected_version: 3 } });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, success({ role: archived }));

    reset();
    const restored = { ...AUDITOR_ROLE, archived_at: null, archived_by: null, version: 3, updated_by: OWNER_ID };
    state.replies.set('admin_role_set_archived', { data: { ok: true, role: restored } });
    const back = await call('restore', 'POST', { id: AUDITOR_ROLE_ID, body: { reason: REASON, expected_version: 2 } });
    assert.equal(back.status, 200);
    assert.deepEqual(back.body, success({ role: restored }));
    assert.deepEqual(rpcArgs('admin_role_set_archived'), [{
      p_actor: OWNER_ID,
      p_role_id: AUDITOR_ROLE_ID,
      p_expected_version: 2,
      p_archived: false,
      p_reason: REASON,
      p_ip: CLIENT_IP,
      p_user_agent: USER_AGENT,
      p_request_id: REQUEST_ID,
    }]);
    assert.deepEqual(audits(), []);
  });

  test('archiving a role admins still hold answers 409 with the members, recorded as a failure', async () => {
    const members = [{ admin_id: CLERK_ID, username: 'clerk' }, { admin_id: MANAGER_ID, username: 'manager' }];
    state.replies.set('admin_role_set_archived', { data: { ok: false, reason: 'in_use', members } });
    const reply = await call('archive', 'POST', { id: MANAGER_ROLE_ID, body: { reason: REASON, expected_version: 3 } });
    assert.equal(reply.status, 409);
    const text = 'Admins still hold this role. Move them to another role first.';
    assert.deepEqual(reply.body, failure('STATE_CONFLICT', text, { reason: 'in_use', members }));
    assert.deepEqual(rpcArgs('admin_role_set_archived').map((args) => [args.p_role_id, args.p_archived, args.p_expected_version]), [
      [MANAGER_ROLE_ID, true, 3],
    ]);
    assert.deepEqual(audits(), [failureAudit({
      action: 'ARCHIVE_ADMIN_ROLE', entity_id: MANAGER_ROLE_ID, reason: REASON, error: text,
      after_value: { archived: true, expected_version: 3 },
    })]);
  });

  test('protected, stale, unchanged and not_found map to the database answers under each action', async () => {
    const cases: Array<[RpcReply, number, Record<string, unknown>]> = [
      [{ data: { ok: false, reason: 'protected' } }, 409,
        failure('STATE_CONFLICT', 'This role is protected and cannot be changed.', { reason: 'protected' })],
      [{ data: { ok: false, reason: 'stale', version: 5 } }, 409, failure('STATE_CONFLICT', STALE_TEXT, { reason: 'stale', version: 5 })],
      [{ data: { ok: false, reason: 'unchanged' } }, 409, failure('STATE_CONFLICT', 'The role is already in that state.', { reason: 'unchanged' })],
      [{ data: { ok: false, reason: 'not_found' } }, 404, failure('RESOURCE_NOT_FOUND', 'That record could not be found.', { reason: 'not_found' })],
    ];
    for (const [name, action] of [['archive', 'ARCHIVE_ADMIN_ROLE'], ['restore', 'RESTORE_ADMIN_ROLE']] as const) {
      for (const [answer, status, expected] of cases) {
        reset();
        state.replies.set('admin_role_set_archived', answer);
        const reply = await call(name, 'POST', { id: MANAGER_ROLE_ID, body: { reason: REASON, expected_version: 3 } });
        assert.equal(reply.status, status, name);
        assert.deepEqual(reply.body, expected, name);
        assert.deepEqual(audits().map((row) => [row.action, row.entity_id, row.result]), [[action, MANAGER_ROLE_ID, 'failure']], name);
      }
    }
  });

  test('a missing reason, version or id is refused with 400 before the database, and a database error answers 500', async () => {
    const cases: Array<[string, unknown, Record<string, unknown>]> = [
      [MANAGER_ROLE_ID, { expected_version: 3 }, failure('VALIDATION_ERROR', REASON_TEXT, { field: 'reason', reason: 'reason_required' })],
      [MANAGER_ROLE_ID, { reason: REASON }, failure('VALIDATION_ERROR', 'A valid role version is required.', { field: 'expected_version', reason: 'invalid' })],
      [MANAGER_ROLE_ID, { reason: REASON, expected_version: 0 }, failure('VALIDATION_ERROR', 'A valid role version is required.', { field: 'expected_version', reason: 'invalid' })],
      ['not-a-role', { reason: REASON, expected_version: 3 }, failure('VALIDATION_ERROR', 'A valid role id is required.', { field: 'id', reason: 'invalid' })],
    ];
    for (const [id, body, expected] of cases) {
      reset();
      const reply = await call('archive', 'POST', { id, body });
      assert.equal(reply.status, 400, JSON.stringify(body));
      assert.deepEqual(reply.body, expected, JSON.stringify(body));
      assert.deepEqual(state.rpcs, []);
      assert.deepEqual(audits().map((row) => [row.action, row.result]), [['ARCHIVE_ADMIN_ROLE', 'failure']]);
    }
    for (const [name, text] of [['archive', 'The role could not be archived. Try again.'], ['restore', 'The role could not be restored. Try again.']] as const) {
      reset();
      state.replies.set('admin_role_set_archived', { error: CONNECTION_LOST });
      const reply = await call(name, 'POST', { id: MANAGER_ROLE_ID, body: { reason: REASON, expected_version: 3 } });
      assert.equal(reply.status, 500);
      assert.deepEqual(reply.body, failure('INTERNAL_ERROR', text));
      assert.deepEqual(audits().map((row) => [row.result, row.error]), [['failure', 'connection terminated']]);
      assert.ok(logs.some((line) => line.includes('connection terminated')));
    }
  });
});

describe('POST /api/admin-roles/preview', () => {
  test('needs no step-up and returns the impact the dry run of admin_role_save reports', async () => {
    reset(superAdmin({ mfa: { status: 'none', lockedUntil: null }, session: staleSession() }));
    state.replies.set('admin_role_save', { data: { ok: true, dry_run: true, version: 3, members: SAVED_MEMBERS, changed: 2, signed_out: 1 } });
    const reply = await call('preview', 'POST', { body: draftBody() });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, success({ impact: SAVED_IMPACT }));
    assert.deepEqual(rpcArgs('admin_role_save'), [{
      p_actor: OWNER_ID,
      p_role_id: MANAGER_ROLE_ID,
      p_expected_version: 3,
      p_name: 'Manager',
      p_description: 'Runs withdrawals and users day to day.',
      p_permissions: ['dashboard', 'users', 'withdrawals.read'],
      p_reason: null,
      p_dry_run: true,
    }]);
    assert.deepEqual(audits(), []);
  });

  test('a new role is previewed without an id, a version or a reason', async () => {
    state.replies.set('admin_role_save', { data: { ok: true, dry_run: true, version: null, members: [], changed: 0, signed_out: 0 } });
    const reply = await call('preview', 'POST', { body: { name: 'Payout reviewer', permissions: ['withdrawals.read'], expected_version: 9 } });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, success({ impact: { members_total: 0, affected: [], unchanged: [], signed_out_count: 0 } }));
    assert.deepEqual(rpcArgs('admin_role_save').map((args) => [args.p_role_id, args.p_expected_version, args.p_reason, args.p_dry_run]), [
      [null, null, null, true],
    ]);
    assert.deepEqual(reads('admin_roles'), []);
  });

  test('an existing role needs expected_version, and stale answers 409 with the version from the read or the database', async () => {
    const missing = await call('preview', 'POST', { body: draftBody({ expected_version: undefined }) });
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body, failure('VALIDATION_ERROR', 'A valid role version is required.', { field: 'expected_version', reason: 'invalid' }));
    assert.deepEqual([state.queries, state.rpcs], [[], []]);

    reset();
    const behind = await call('preview', 'POST', { body: draftBody({ expected_version: 2 }) });
    assert.equal(behind.status, 409);
    assert.deepEqual(behind.body, failure('STATE_CONFLICT', STALE_TEXT, { reason: 'stale', version: 3 }));
    assert.deepEqual(state.rpcs, []);

    reset();
    state.replies.set('admin_role_save', { data: { ok: false, reason: 'stale', version: 4 } });
    const raced = await call('preview', 'POST', { body: draftBody() });
    assert.equal(raced.status, 409);
    assert.deepEqual(raced.body, failure('STATE_CONFLICT', STALE_TEXT, { reason: 'stale', version: 4 }));
    assert.deepEqual(audits(), []);
  });

  test('refuses keys the role may not newly hold, and protected, archived or missing roles, without calling the database', async () => {
    const cases: Array<[Record<string, unknown>, number, Record<string, unknown>]> = [
      [draftBody({ permissions: ['dashboard', 'users', 'withdrawals', 'roles.read'] }), 400, failure(
        'VALIDATION_ERROR', 'This permission cannot be added to a role: roles.read.',
        { field: 'permissions', reason: 'not_grantable', keys: ['roles.read'] },
      )],
      [draftBody({ role_id: SYSTEM_ROLE_ID, expected_version: 1 }), 409,
        failure('STATE_CONFLICT', 'This role is protected and cannot be changed.', { reason: 'protected' })],
      [draftBody({ role_id: AUDITOR_ROLE_ID, expected_version: 2 }), 409,
        failure('STATE_CONFLICT', 'This role is archived. Restore it before changing it.', { reason: 'archived' })],
      [draftBody({ role_id: NEW_ROLE_ID }), 404, failure('RESOURCE_NOT_FOUND', 'That record could not be found.', { reason: 'not_found' })],
      [draftBody({ role_id: 'not-a-role' }), 400, failure('VALIDATION_ERROR', 'A valid role id is required.', { field: 'role_id', reason: 'invalid' })],
      [draftBody({ name: ' ' }), 400, failure('VALIDATION_ERROR', 'Role name must be 2–64 characters.', { field: 'name', reason: 'invalid' })],
    ];
    for (const [body, status, expected] of cases) {
      reset();
      const reply = await call('preview', 'POST', { body });
      assert.equal(reply.status, status, JSON.stringify(body));
      assert.deepEqual(reply.body, expected, JSON.stringify(body));
      assert.deepEqual([state.rpcs, audits()], [[], []]);
    }
  });

  test('maps the database answers: name_taken 409, Not authorized 403, anything else 500, and never records an audit', async () => {
    const text = 'The impact of this change could not be worked out. Try again.';
    const cases: Array<[RpcReply, number, Record<string, unknown>]> = [
      [{ data: { ok: false, reason: 'name_taken' } }, 409, failure('STATE_CONFLICT', 'Another role already has this name.', { reason: 'name_taken' })],
      [{ error: NOT_AUTHORIZED }, 403, failure('PERMISSION_DENIED', SUPER_ONLY_TEXT)],
      [{ error: CONNECTION_LOST }, 500, failure('INTERNAL_ERROR', text)],
      ['throw', 500, failure('INTERNAL_ERROR', text)],
      [{ data: { ok: true, role: MANAGER_ROLE } }, 500, failure('INTERNAL_ERROR', text)],
    ];
    for (const [answer, status, expected] of cases) {
      reset();
      state.replies.set('admin_role_save', answer);
      const reply = await call('preview', 'POST', { body: draftBody() });
      assert.equal(reply.status, status);
      assert.deepEqual(reply.body, expected);
      assert.deepEqual(audits(), []);
    }
    reset();
    state.failOn = failing('admin_roles', null);
    const unread = await call('preview', 'POST', { body: draftBody() });
    assert.equal(unread.status, 500);
    assert.deepEqual(unread.body, failure('INTERNAL_ERROR', text));
    reset(accountsKeeper());
    const refused = await call('preview', 'POST', { body: draftBody() });
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body, failure('PERMISSION_DENIED', SUPER_ONLY_TEXT));
  });
});

describe('GET /api/admin-permissions', () => {
  test('answers 403 for the Manager', async () => {
    reset(manager());
    const reply = await call('catalog', 'GET');
    assert.equal(reply.status, 403);
    assert.deepEqual(reply.body, failure('PERMISSION_DENIED', 'You do not have permission to do this.', { required: ['roles.read'] }));
    assert.deepEqual(state.queries, []);
  });

  test('lists every permission with its status, page bundles, live roles and directly assigned admins', async () => {
    const reply = await call('catalog', 'GET');
    assert.equal(reply.status, 200);
    const permissions = reply.body.permissions as Array<Record<string, unknown>>;
    assert.deepEqual(permissions.map((entry) => entry.key), ALL_PERMISSIONS);
    for (const entry of permissions) {
      const key = entry.key as (typeof ALL_PERMISSIONS)[number];
      const meta = PERMISSION_CATALOG[key];
      assert.deepEqual(Object.keys(entry), [
        'key', 'label', 'description', 'category', 'risk', 'status', 'legacy_pages', 'roles', 'direct_admin_count', 'direct_admins',
      ]);
      assert.deepEqual([entry.label, entry.description, entry.category, entry.risk], [meta.label, meta.description, meta.category, meta.risk]);
      assert.equal(entry.status, permissionStatus(key));
      assert.equal(entry.direct_admin_count, (entry.direct_admins as unknown[]).length);
    }
    const byKey = new Map(permissions.map((entry) => [entry.key, entry]));
    const pick = (key: string) => {
      const entry = byKey.get(key);
      return [entry?.status, entry?.legacy_pages, entry?.roles, entry?.direct_admins];
    };
    const managerRole = { id: MANAGER_ROLE_ID, name: 'Manager' };
    assert.deepEqual(pick('withdrawals.approve'), ['enforced', ['withdrawals'], [managerRole], []]);
    assert.deepEqual(pick('withdrawals.read'), ['enforced', ['withdrawals'], [managerRole], [{ id: CLERK_ID, username: 'clerk' }]]);
    assert.deepEqual(pick('withdrawals.retry'), ['reserved', ['withdrawals'], [managerRole], []]);
    assert.deepEqual(pick('coupons.write'), ['enforced', ['coupons'], [], [{ id: MANAGER_ID, username: 'manager' }]]);
    assert.deepEqual(pick('audit.read'), ['enforced', ['activity'], [], []]);
    assert.deepEqual(pick('roles.read'), ['super_only', ['admin_accounts'], [], []]);
    assert.deepEqual(pick('users.freeze'), ['enforced', ['users_freeze'], [], []]);
    assert.deepEqual(reply.body.categories, [...PERMISSION_CATEGORIES]);
    assert.equal(reply.body.super_admin_count, 1);
    assert.deepEqual(reads('admin_roles').map((query) => [query.columns, query.filters, query.orders]), [[
      'id, name, permissions', [['is', 'archived_at', null], ['is', 'system_key', null]], [['name', true]],
    ]]);
    assert.deepEqual(reads('admin_users').map((query) => [query.columns, query.filters, query.orders]), [[
      'id, username, is_active, is_super_admin, direct_permissions', [['is', 'deleted_at', null]], [['username', true]],
    ]]);
  });

  test('answers 500 when the roles or the admins cannot be read', async () => {
    for (const outage of [failing('admin_roles', null), failing('admin_users', null), failing('admin_users', null, 'throw')]) {
      reset();
      state.failOn = outage;
      const reply = await call('catalog', 'GET');
      assert.equal(reply.status, 500);
      assert.deepEqual(reply.body, failure('INTERNAL_ERROR', 'Permissions could not be loaded.'));
    }
  });
});

describe('the roles and permissions routes stay web-only', () => {
  test('none of them is in the list of web routes the mobile app calls', () => {
    const list = readFileSync(SESSION_TEST_FILE, 'utf8').match(/const MOBILE_WEB_PATHS = \[([\s\S]*?)\] as const;/);
    assert.ok(list);
    const paths = [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    assert.ok(paths.length > 0);
    for (const path of WEB_PATHS) assert.ok(!paths.includes(path), path);
  });

  test('the mobile app never asks for them', { skip: !existsSync(MOBILE_DIR) }, () => {
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
    assert.ok(files.length > 0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      assert.ok(!source.includes('/api/admin-roles') && !source.includes('/api/admin-permissions'), file);
    }
  });
});

describe('house rules for the roles and permissions routes', () => {
  test('each route file exports only its HTTP handlers', () => {
    for (const [name, path] of Object.entries(ROUTES) as Array<[RouteName, string]>) {
      const source = readFileSync(join(APP_DIR, path), 'utf8');
      const exported = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((match) => match[1]);
      assert.deepEqual(exported, ROUTE_EXPORTS[name], path);
      assert.doesNotMatch(source, /^export\s+(?:\{|\*|default|type|interface)/m, path);
    }
  });

  test('the route files and this test carry no prose comments', () => {
    for (const file of [...Object.values(ROUTES).map((path) => join(APP_DIR, path)), TEST_FILE]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m, file);
    }
  });
});
