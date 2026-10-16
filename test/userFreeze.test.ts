import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import ts from 'typescript';
import {
  OTHER_REASON, createConfirmController, effectiveReason, type ConfirmController,
} from '../app/_ui/confirmModel.ts';
import { loadAppModule, loadUi, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ConfirmOptions } from '../app/_ui/Confirm.tsx';

type ApiClientModule = typeof import('../app/lib/apiClient.ts');
type UserDetailModel = typeof import('../app/(dashboard)/users/[id]/model.ts');
type ConfirmModule = typeof import('../app/_ui/Confirm.tsx');

interface Claims {
  admin_id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  token_version: number;
}

interface Account {
  is_frozen: boolean | null;
  freeze_reason: string | null;
  deleted_at: string | null;
}

type Filter = ['eq' | 'is', string, unknown];

interface QueryOp {
  table: string;
  kind: 'select' | 'update' | 'insert';
  filters: Filter[];
  payload: unknown;
}

interface DbReply {
  data: unknown;
  error: { message: string } | null;
}

interface FakeQuery extends PromiseLike<DbReply> {
  select(columns: string): FakeQuery;
  update(values: unknown): FakeQuery;
  insert(rows: unknown): FakeQuery;
  eq(column: string, value: unknown): FakeQuery;
  is(column: string, value: unknown): FakeQuery;
  maybeSingle(): FakeQuery;
}

interface RouteHarness {
  claims: Claims | null;
  headers: Record<string, string>;
  account: Account | null;
  ops: QueryOp[];
  audits: Record<string, unknown>[];
  from(table: string): FakeQuery;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface UsersRoute {
  PATCH: (req: Request, ctx: RouteContext) => Promise<Response>;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const ROUTE_FILE = join(APP_DIR, 'api', 'users', '[id]', 'route.ts');
const PAGE_FILE = join(APP_DIR, '(dashboard)', 'users', '[id]', 'page.tsx');
const HARNESS_KEY = '__userFreezeRouteHarness';

const USER_ID = '3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const ADMIN_ID = '0e000000-0000-4000-8000-0000000000aa';
const REQUEST_ID = 'req_userfreeze01';
const USER_AGENT = 'user-freeze-test';
const CLIENT_IP = '198.51.100.45';
const DELETION_REASON = 'Account deletion in progress';
const RESERVED = 'That reason is reserved. Use a different reason.';

const OWNER: Claims = {
  admin_id: ADMIN_ID,
  username: 'owner',
  role_title: 'Super Admin',
  is_super_admin: true,
  page_permissions: [],
  token_version: 0,
};

const ACTIVE: Account = { is_frozen: false, freeze_reason: null, deleted_at: null };
const CLAIMED: Account = { is_frozen: true, freeze_reason: DELETION_REASON, deleted_at: null };

function staff(grants: string[]): Claims {
  return { ...OWNER, username: 'ops', role_title: 'Operations', is_super_admin: false, page_permissions: grants };
}

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every(([, column, value]) => row[column] === value);
}

function respond(op: QueryOp): DbReply {
  harness.ops.push(op);
  if (op.table === 'audit_log' && op.kind === 'insert') {
    harness.audits.push(op.payload as Record<string, unknown>);
    return { data: null, error: null };
  }
  if (op.table !== 'users' || op.kind === 'insert') throw new Error(`unexpected ${op.kind} on ${op.table}`);
  const current = harness.account;
  const hit = current !== null && matches({ id: USER_ID, ...current }, op.filters);
  if (op.kind === 'select') return { data: hit && current ? { ...current } : null, error: null };
  if (!hit || !current) return { data: [], error: null };
  harness.account = { ...current, ...(op.payload as Partial<Account>) };
  return { data: [{ id: USER_ID }], error: null };
}

function fakeQuery(table: string): FakeQuery {
  const op: QueryOp = { table, kind: 'select', filters: [], payload: null };
  const query: FakeQuery = {
    select() {
      return query;
    },
    update(values) {
      op.kind = 'update';
      op.payload = values;
      return query;
    },
    insert(rows) {
      op.kind = 'insert';
      op.payload = rows;
      return query;
    },
    eq(column, value) {
      op.filters.push(['eq', column, value]);
      return query;
    },
    is(column, value) {
      op.filters.push(['is', column, value]);
      return query;
    },
    maybeSingle() {
      return query;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve().then(() => respond(op)).then(onFulfilled, onRejected);
    },
  };
  return query;
}

const harness: RouteHarness = {
  claims: OWNER,
  headers: {},
  account: null,
  ops: [],
  audits: [],
  from: (table) => fakeQuery(table),
};
Reflect.set(globalThis, HARNESS_KEY, harness);

const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const harnessRef = `const harness = () => globalThis.${HARNESS_KEY};`;

const FILE_STUBS: Readonly<Record<string, string>> = {
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: moduleUrl(`${harnessRef}
export const supabaseAdmin = { from: (table) => harness().from(table) };`),
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: moduleUrl(`${harnessRef}
export async function verifyAdminFromRequest() { return harness().claims; }`),
};

const PACKAGE_STUBS: Readonly<Record<string, string>> = {
  'next/headers': moduleUrl(`${harnessRef}
export async function headers() { return new Headers(harness().headers); }
export async function cookies() { return { get: () => undefined }; }`),
  'next/server': moduleUrl('export const NextResponse = { json: (body, init) => Response.json(body, init) };'),
};

const IMPORTS = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;
const bundles = new Map<string, Promise<string>>();

function resolveImport(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const found = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]
    .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
  if (!found) throw new Error(`${fromFile} imports ${specifier}, which does not resolve to a .ts file`);
  return found;
}

async function compile(file: string): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const targets = new Map<string, string>();
  for (const [, , specifier] of outputText.matchAll(IMPORTS)) {
    if (targets.has(specifier)) continue;
    if (specifier.startsWith('.')) {
      const target = resolveImport(file, specifier);
      targets.set(specifier, FILE_STUBS[target] ?? (await bundle(target)));
    } else if (PACKAGE_STUBS[specifier]) {
      targets.set(specifier, PACKAGE_STUBS[specifier]);
    } else {
      throw new Error(`${file} imports ${specifier}, which this test does not provide`);
    }
  }
  return moduleUrl(outputText.replace(IMPORTS, (match: string, head: string, specifier: string) => {
    const target = targets.get(specifier);
    return target ? `${head}'${target}'` : match;
  }));
}

function bundle(file: string): Promise<string> {
  let pending = bundles.get(file);
  if (!pending) {
    pending = compile(file);
    bundles.set(file, pending);
  }
  return pending;
}

const realFetch = globalThis.fetch;
let route: UsersRoute;
let api: ApiClientModule;
let model: UserDetailModel;
let ConfirmDialog: ConfirmModule['ConfirmDialog'];

function reset(account: Account | null = ACTIVE, claims: Claims | null = OWNER): void {
  harness.claims = claims;
  harness.headers = { 'x-request-id': REQUEST_ID, 'user-agent': USER_AGENT, 'x-forwarded-for': CLIENT_IP };
  harness.account = account && { ...account };
  harness.ops = [];
  harness.audits = [];
}

function context(id: string): RouteContext {
  return { params: Promise.resolve({ id }) };
}

async function patch(payload: unknown, id = USER_ID): Promise<Reply> {
  const response = await route.PATCH(new Request(`http://admin.test/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }), context(id));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function forwardFetchToRoute(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://admin.test');
    const id = decodeURIComponent(url.pathname.slice('/api/users/'.length));
    return route.PATCH(new Request(url, { method: init?.method, headers: init?.headers, body: init?.body }), context(id));
  }) as typeof fetch;
}

function settled(controller: ConfirmController<ConfirmOptions>): Promise<void> {
  return new Promise((done) => {
    const stop = controller.subscribe(() => {
      if (controller.getSession()?.phase === 'pending') return;
      stop();
      done();
    });
  });
}

const opLabel = (op: QueryOp) => `${op.kind}:${op.table}`;

before(async () => {
  route = (await import(await bundle(ROUTE_FILE))) as UsersRoute;
  api = await loadAppModule<ApiClientModule>('lib/apiClient.ts');
  model = await loadAppModule<UserDetailModel>('(dashboard)/users/[id]/model.ts');
  ({ ConfirmDialog } = await loadUi<ConfirmModule>('Confirm.tsx'));
});

beforeEach(() => {
  reset();
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
});

describe('freezing an account through /api/users/[id]', () => {
  test('the guard answers before the reason is looked at, and nothing is read', async () => {
    reset(ACTIVE, null);
    const anonymous = await patch({ action: 'freeze', reason: DELETION_REASON });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.code, 'AUTH_REQUIRED');
    assert.deepEqual(harness.ops, []);

    reset(ACTIVE, staff(['users']));
    const reader = await patch({ action: 'freeze', reason: DELETION_REASON });
    assert.equal(reader.status, 403);
    assert.equal(reader.body.code, 'PERMISSION_DENIED');
    assert.deepEqual(harness.ops, []);
  });

  test('the deletion claim reason is refused in any case or spacing, before the account is read', async () => {
    for (const reason of [
      DELETION_REASON,
      'account deletion in progress',
      'ACCOUNT DELETION IN PROGRESS',
      '  Account Deletion In Progress\n',
      '\tAccount deletion in progress ',
    ]) {
      reset();
      const reply = await patch({ action: 'freeze', reason });
      assert.equal(reply.status, 400, JSON.stringify(reason));
      assert.deepEqual(reply.body, {
        success: false, error: RESERVED, code: 'VALIDATION_ERROR', message: RESERVED, request_id: REQUEST_ID,
      });
      assert.deepEqual(harness.ops, [], 'nothing is read, written or audited');
      assert.deepEqual(harness.account, ACTIVE);
    }
  });

  test('any other reason freezes the account and is audited, including one that only mentions deletion', async () => {
    for (const reason of [
      'Unusual activity on your account is under review.',
      'Account deletion in progress: contact support to cancel it.',
    ]) {
      reset();
      const reply = await patch({ action: 'freeze', reason: `  ${reason} ` });
      assert.equal(reply.status, 200, reason);
      assert.deepEqual(reply.body, { success: true, request_id: REQUEST_ID, is_frozen: true, audit_recorded: true });
      assert.deepEqual(harness.account, { is_frozen: true, freeze_reason: reason, deleted_at: null });
      assert.deepEqual(harness.ops.map(opLabel), ['select:users', 'update:users', 'insert:audit_log']);
      assert.deepEqual(harness.ops[1].filters, [['eq', 'id', USER_ID], ['is', 'deleted_at', null], ['eq', 'is_frozen', false]]);
      assert.deepEqual(harness.audits, [{
        admin_id: ADMIN_ID,
        user_id: USER_ID,
        action: 'FREEZE_USER',
        entity: 'users',
        entity_id: USER_ID,
        before_value: { is_frozen: false, freeze_reason: null },
        after_value: { is_frozen: true, freeze_reason: reason },
        ip_address: CLIENT_IP,
        admin_role: 'Super Admin',
        user_agent: USER_AGENT,
        request_id: REQUEST_ID,
        reason,
        result: 'success',
        error: null,
        sensitivity: 'security',
      }]);
    }
  });

  test('an account left frozen by an unfinished deletion can still be unfrozen', async () => {
    reset(CLAIMED);
    const reply = await patch({ action: 'unfreeze' });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { success: true, request_id: REQUEST_ID, is_frozen: false, audit_recorded: true });
    assert.deepEqual(harness.account, ACTIVE);
    assert.deepEqual(harness.ops[1].filters, [['eq', 'id', USER_ID], ['is', 'deleted_at', null], ['eq', 'is_frozen', true]]);
    assert.equal(harness.audits[0]?.action, 'UNFREEZE_USER');
    assert.deepEqual(harness.audits[0]?.before_value, { is_frozen: true, freeze_reason: DELETION_REASON });
  });
});

describe('the freeze dialog on the user page', () => {
  test('every preset the dialog offers is accepted by the route', async () => {
    assert.match(readFileSync(PAGE_FILE, 'utf8'), /presets:\s*FREEZE_REASONS\b/);
    for (const reason of model.FREEZE_REASONS) {
      reset();
      const reply = await patch({ action: 'freeze', reason });
      assert.equal(reply.status, 200, reason);
      assert.equal(harness.account?.freeze_reason, reason);
    }
  });

  test('a reserved reason typed under Other comes back as the dialog error, and the dialog stays open for another reason', async () => {
    assert.match(
      readFileSync(PAGE_FILE, 'utf8'),
      /attempt\.kind\s*===\s*'retry'\)\s*throw new Error\(attempt\.message\)/,
    );
    forwardFetchToRoute();
    const controller = createConfirmController<ConfirmOptions>();
    const decision = controller.request({
      tone: 'danger',
      title: 'Freeze @ada?',
      reason: { required: true, presets: model.FREEZE_REASONS, label: 'Reason shown to the user', maxLength: 500 },
      confirmLabel: 'Freeze account',
      action: async ({ reason }) => {
        const attempt = model.classifyAction(await api.apiRequest(`/api/users/${encodeURIComponent(USER_ID)}`, {
          method: 'PATCH',
          body: { action: 'freeze', reason },
        }));
        if (attempt.kind === 'retry') throw new Error(attempt.message);
        return attempt;
      },
    });
    const opened = controller.getSession();
    assert.ok(opened);

    const typed = effectiveReason({ preset: OTHER_REASON, reason: '  account deletion in progress ' });
    assert.equal(typed, 'account deletion in progress');
    const refusal = settled(controller);
    assert.equal(controller.submit(opened.id, { reason: typed }), true);
    await refusal;

    const failed = controller.getSession();
    assert.ok(failed);
    assert.equal(failed.phase, 'failed');
    assert.equal(failed.error, RESERVED);
    assert.deepEqual(harness.account, ACTIVE);
    const html = render(createElement(ConfirmDialog, { session: failed, onSubmit: () => {}, onCancel: () => {} }));
    assert.equal(tagsOf(html, 'div').filter((attrs) => attrs.role === 'alert').length, 1);
    assert.equal(textOf(html).split(RESERVED).length - 1, 1);
    for (const preset of model.FREEZE_REASONS) assert.ok(textOf(html).includes(preset), preset);

    const [preset] = model.FREEZE_REASONS;
    const retry = settled(controller);
    assert.equal(controller.submit(failed.id, { reason: preset }), true);
    await retry;
    assert.equal(controller.getSession(), null);
    assert.deepEqual(await decision, { reason: preset, value: { kind: 'done', warning: null } });
    assert.deepEqual(harness.account, { is_frozen: true, freeze_reason: preset, deleted_at: null });
  });
});
