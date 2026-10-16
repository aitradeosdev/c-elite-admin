import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement, type Context } from 'react';
import { SignJWT } from 'jose';
import ts from 'typescript';
import { loadAppModule, loadUi, render, tagsOf } from './support/uiHarness.ts';
import { ERROR_MESSAGE } from '../app/lib/http.ts';
import {
  NAV_COUNT_CAP,
  NAV_GROUPS,
  filterNavByPermissions,
  navCountKeys,
  navCountLabel,
  navCountText,
  navItemLabel,
} from '../app/(dashboard)/_shell/nav.ts';
import type { ShellProps } from '../app/(dashboard)/_shell/Shell.tsx';
import type { NavCountMap, NavLive } from '../app/(dashboard)/_shell/NavCounts.tsx';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type { ResourceEnvironment, ResourceStatus } from '../app/_ui/useResource.ts';

type NavCountsModule = typeof import('../app/(dashboard)/_shell/NavCounts.tsx');
type ShellModule = typeof import('../app/(dashboard)/_shell/Shell.tsx');
type ThemeModule = typeof import('../app/_ui/theme.tsx');
type ResourceModule = typeof import('../app/_ui/useResource.ts');
type ApiClientModule = typeof import('../app/lib/apiClient.ts');
type PassModule = typeof import('../app/lib/realtimePass.ts');

interface CountsRoute {
  GET: () => Promise<Response>;
}

interface DbReply {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

type Reply = DbReply | 'throw';

interface Grant {
  pagePermissions?: string[];
  superAdmin?: boolean;
}

interface StubState {
  headers: Headers;
  cookies: Map<string, string>;
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
  queries: string[];
  deadlines: unknown[];
  authState: (sid: string) => Reply;
  metrics: (args: Record<string, unknown>) => Reply;
  db: {
    from(table: string): never;
    rpc(name: string, args: Record<string, unknown>): Promise<DbReply>;
  };
}

const STATE_KEY = '__cardeliteNavCountsTest';
const ADMIN_DIR = fileURLToPath(new URL('../', import.meta.url));
const APP_DIR = join(ADMIN_DIR, 'app');
const LIB_DIR = join(APP_DIR, 'lib');
const SHELL_DIR = join(APP_DIR, '(dashboard)', '_shell');
const ROUTE_FILE = join(APP_DIR, 'api', 'nav-counts', 'route.ts');
const ISLAND_FILE = join(SHELL_DIR, 'NavCounts.tsx');
const ISLAND_CSS = join(SHELL_DIR, 'NavCounts.module.css');
const SHELL_FILE = join(SHELL_DIR, 'Shell.tsx');
const SHELL_CSS = join(SHELL_DIR, 'Shell.module.css');
const NAV_FILE = join(SHELL_DIR, 'nav.ts');
const PASS_LIB_FILE = join(LIB_DIR, 'realtimePass.ts');
const SUPABASE_FILE = join(LIB_DIR, 'supabase.ts');
const CARD_QUEUE_ROUTE = join(APP_DIR, 'api', 'card-queue', 'route.ts');
const WITHDRAWALS_ROUTE = join(APP_DIR, 'api', 'withdrawals', 'route.ts');
const METRICS_FILE = join(APP_DIR, '(dashboard)', 'dashboard', 'metrics.tsx');
const TEST_FILE = fileURLToPath(import.meta.url);
const SESSION_TEST_FILE = join(ADMIN_DIR, 'test', 'sessionAuth.test.ts');
const SCHEMA_FILE = fileURLToPath(new URL('../../schema.sql', import.meta.url));
const MOBILE_DIR = fileURLToPath(new URL('../../CardEliteAdmin/', import.meta.url));
const nodeRequire = createRequire(import.meta.url);

const ADMIN_SECRET = 'nav-counts-test-admin-secret-0123456789abcdef';
const ADMIN_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const WEB_SID = 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d';
const PHONE_SID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const USERNAME = 'ops.lead';
const REQUEST_ID = 'req_navcounts01';
const SESSION_UNAVAILABLE = 'Your session could not be checked. Try again.';
const COUNTS_ERROR = 'The waiting counts could not be loaded.';
const NEEDED = ['withdrawals.read', 'cards.read'];
const HOUR_MS = 60 * 60 * 1000;
const LOG_LEVELS = ['error', 'warn', 'log', 'info', 'debug'] as const;
const IMPORT_RE = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;
const VALUE_IMPORT_RE = /^(?:import|export)\s+(type\s+)?([^;'"]*?)\s*\bfrom\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]/gm;

const CARD_STATS = {
  pendingCards: 4,
  disputedCards: 3,
  cardsInRange: 11,
  oldestPendingCardAt: '2026-10-16T07:00:00+00:00',
};

const WITHDRAWAL_STATS = {
  pendingWithdrawals: 6,
  pendingWithdrawalValue: 812500,
  processingWithdrawals: 2,
  payoutsInRange: 150000,
  failedWithdrawalsInRange: 1,
  oldestPendingWithdrawalAt: '2026-10-16T06:00:00+00:00',
};

const logs: string[] = [];

const state: StubState = {
  headers: new Headers(),
  cookies: new Map(),
  rpcs: [],
  queries: [],
  deadlines: [],
  authState: (sid) => live(sid),
  metrics: (args) => metricsFor(args),
  db: {
    from: (table) => {
      state.queries.push(table);
      throw new Error(`unexpected query on ${table}`);
    },
    rpc: (name, args) => rpc(name, args),
  },
};

Reflect.set(globalThis, STATE_KEY, state);

function rpc(name: string, args: Record<string, unknown>): Promise<DbReply> {
  state.rpcs.push({ name, args });
  let reply: Reply;
  if (name === 'admin_auth_state') reply = state.authState(String(args.p_sid));
  else if (name === 'admin_dashboard_metrics') reply = state.metrics(args);
  else return Promise.reject(new Error(`unexpected rpc ${name}`));
  if (reply === 'throw') return Promise.reject(new Error('fetch failed'));
  return Promise.resolve({ data: null, error: null, ...reply });
}

function metricsFor(args: Record<string, unknown>): DbReply {
  const groups = Array.isArray(args.p_groups) ? args.p_groups : [];
  return {
    data: {
      ...(groups.includes('cards') ? CARD_STATS : {}),
      ...(groups.includes('withdrawals') ? WITHDRAWAL_STATS : {}),
    },
  };
}

function moduleUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function stub(lines: string[]): string {
  return moduleUrl([`const state = () => globalThis.${STATE_KEY};`, ...lines].join('\n'));
}

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
  return async <T>(path: string): Promise<T> => (await import(await bundle(path))) as T;
}

const SUPABASE_STUB = stub([
  'export const supabaseAdmin = {',
  '  from(table) { return state().db.from(table); },',
  '  rpc(name, args) {',
  '    const pending = state().db.rpc(name, args);',
  '    pending.abortSignal = (signal) => { state().deadlines.push(signal); return pending; };',
  '    return pending;',
  '  },',
  '};',
]);

const NEXT_HEADERS_STUB = stub([
  'export async function headers() { return state().headers; }',
  'export async function cookies() {',
  '  return { get: (name) => (state().cookies.has(name) ? { name, value: state().cookies.get(name) } : undefined) };',
  '}',
]);

const loadServer = bundler({ [SUPABASE_FILE]: SUPABASE_STUB }, {
  jose: import.meta.resolve('jose'),
  'next/server': pathToFileURL(nodeRequire.resolve('next/server')).href,
  'next/headers': NEXT_HEADERS_STUB,
});

let route: CountsRoute;
let pass: PassModule;
let island: NavCountsModule;
let resources: ResourceModule;

before(async () => {
  route = await loadServer<CountsRoute>(ROUTE_FILE);
  pass = await loadServer<PassModule>(PASS_LIB_FILE);
  island = await loadAppModule<NavCountsModule>('(dashboard)/_shell/NavCounts.tsx');
  resources = await loadUi<ResourceModule>('useResource.ts');
});

function requestHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'user-agent': 'nav counts test',
    'x-forwarded-for': '198.51.100.7',
    'x-request-id': REQUEST_ID,
    ...extra,
  });
}

beforeEach(() => {
  state.headers = requestHeaders();
  state.cookies = new Map();
  state.rpcs = [];
  state.queries = [];
  state.deadlines = [];
  state.authState = (sid) => live(sid);
  state.metrics = (args) => metricsFor(args);
  logs.length = 0;
  Reflect.set(process.env, 'ADMIN_JWT_SECRET', ADMIN_SECRET);
  for (const level of LOG_LEVELS) {
    mock.method(console, level, (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    });
  }
});

afterEach(() => {
  mock.restoreAll();
});

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function live(sid: string, grant: Grant = {}): DbReply {
  return {
    data: {
      admin: {
        id: ADMIN_ID,
        username: USERNAME,
        role_title: 'Operations Lead',
        is_super_admin: grant.superAdmin === true,
        page_permissions: grant.pagePermissions ?? ['withdrawals', 'card_queue'],
        token_version: 4,
      },
      session: {
        id: sid,
        status: 'active',
        client: sid === PHONE_SID ? 'mobile' : 'web',
        auth_methods: ['pwd'],
        created_at: iso(-HOUR_MS),
        expires_at: iso(7 * HOUR_MS),
        reauth_at: null,
      },
      mfa: { status: 'none', locked_until: null },
      policy: { mfa_mode: 'off', mfa_grace_ends_at: null, mfa_required_now: false },
    },
  };
}

function allow(grant: Grant): void {
  state.authState = (sid) => live(sid, grant);
}

function sessionToken(sid: string): Promise<string> {
  return new SignJWT({
    admin_id: ADMIN_ID,
    role_title: 'Operations Lead',
    is_super_admin: false,
    page_permissions: [],
    username: USERNAME,
    token_version: 4,
    sid,
    amr: ['pwd'],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(new TextEncoder().encode(ADMIN_SECRET));
}

async function asWeb(): Promise<void> {
  state.headers = requestHeaders();
  state.cookies = new Map([['admin_token', await sessionToken(WEB_SID)]]);
}

async function asPhone(withWebCookie = false): Promise<void> {
  state.headers = requestHeaders({ 'x-client': 'mobile-admin', authorization: `Bearer ${await sessionToken(PHONE_SID)}` });
  state.cookies = withWebCookie ? new Map([['admin_token', await sessionToken(WEB_SID)]]) : new Map();
}

function signedOut(): void {
  state.headers = requestHeaders();
  state.cookies = new Map();
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function failure(code: string, message: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { success: false, error: message, code, message, request_id: REQUEST_ID, ...extra };
}

function rpcNames(): string[] {
  return state.rpcs.map((call) => call.name);
}

function metricCalls(): Array<Record<string, unknown>> {
  return state.rpcs.filter((call) => call.name === 'admin_dashboard_metrics').map((call) => call.args);
}

const sources = new Map<string, string>();

function read(file: string): string {
  let text = sources.get(file);
  if (text === undefined) {
    text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    sources.set(file, text);
  }
  return text;
}

function rel(file: string): string {
  return relative(ADMIN_DIR, file).split(sep).join('/');
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function valueImports(source: string): string[] {
  const out: string[] = [];
  for (const [, typeOnly, clause, from, bare] of source.matchAll(VALUE_IMPORT_RE)) {
    if (bare) {
      out.push(bare);
      continue;
    }
    if (typeOnly) continue;
    const named = clause.match(/^\{([^}]*)\}$/);
    const parts = named ? named[1].split(',').map((part) => part.trim()).filter(Boolean) : [];
    if (named && parts.length > 0 && parts.every((part) => part.startsWith('type '))) continue;
    out.push(from);
  }
  return out;
}

function staticGraph(entry: string): Set<string> {
  const files = new Set<string>([entry]);
  const queue = [entry];
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    for (const specifier of valueImports(read(file))) {
      if (!specifier.startsWith('.')) continue;
      const base = resolve(dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]
        .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
      if (!target || files.has(target)) continue;
      files.add(target);
      queue.push(target);
    }
  }
  return files;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.(?:tsx?|jsx?)$/.test(entry.name)) out.push(path);
  }
  return out;
}

function block(source: string, start: string): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, start);
  return source.slice(from, source.indexOf('\n}\n', from) + 2);
}

describe('GET /api/nav-counts', () => {
  test('a web admin who reads both queues gets one number each: cards pending plus disputed, withdrawals in review or held', async () => {
    await asWeb();
    const res = await route.GET();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await bodyOf(res), {
      success: true,
      request_id: REQUEST_ID,
      counts: { withdrawals: 6, cards: 7 },
    });
    assert.deepEqual(rpcNames(), ['admin_auth_state', 'admin_dashboard_metrics']);
    const [args] = metricCalls();
    assert.deepEqual(Object.keys(args).sort(), ['p_from', 'p_groups', 'p_online_from', 'p_to']);
    assert.deepEqual(args.p_groups, ['withdrawals', 'cards']);
    assert.equal(args.p_online_from, null);
    assert.ok(Date.parse(String(args.p_from)) < Date.parse(String(args.p_to)));
    assert.equal(state.deadlines.length, 1);
    assert.ok(state.deadlines[0] instanceof AbortSignal);
    assert.deepEqual(state.queries, []);
    assert.deepEqual(logs, []);
  });

  test('each count follows its read permission exactly, and only the granted groups are read', async () => {
    const cases: Array<[Grant, Record<string, number>, string[]]> = [
      [{ pagePermissions: ['withdrawals'] }, { withdrawals: 6 }, ['withdrawals']],
      [{ pagePermissions: ['card_queue'] }, { cards: 7 }, ['cards']],
      [{ pagePermissions: ['withdrawals.read'] }, { withdrawals: 6 }, ['withdrawals']],
      [{ pagePermissions: ['cards.read', 'users'] }, { cards: 7 }, ['cards']],
      [{ pagePermissions: ['card_queue', 'withdrawals.read', 'transactions_overview'] }, { withdrawals: 6, cards: 7 }, ['withdrawals', 'cards']],
      [{ pagePermissions: [], superAdmin: true }, { withdrawals: 6, cards: 7 }, ['withdrawals', 'cards']],
    ];
    for (const [grant, counts, groups] of cases) {
      state.rpcs = [];
      allow(grant);
      await asWeb();
      const res = await route.GET();
      assert.equal(res.status, 200, JSON.stringify(grant));
      assert.deepEqual((await bodyOf(res)).counts, counts, JSON.stringify(grant));
      assert.deepEqual(metricCalls().map((args) => args.p_groups), [groups], JSON.stringify(grant));
    }
  });

  test('an empty queue is a real zero from the server; hiding it is the sidebar’s job', async () => {
    state.metrics = () => ({ data: { ...CARD_STATS, ...WITHDRAWAL_STATS, pendingCards: 0, disputedCards: 0, pendingWithdrawals: 0 } });
    await asWeb();
    assert.deepEqual((await bodyOf(await route.GET())).counts, { withdrawals: 0, cards: 0 });
  });

  test('whole-number strings from the metrics function are read as counts', async () => {
    state.metrics = () => ({ data: { ...CARD_STATS, ...WITHDRAWAL_STATS, pendingCards: '12', disputedCards: '0', pendingWithdrawals: '5' } });
    await asWeb();
    assert.deepEqual((await bodyOf(await route.GET())).counts, { withdrawals: 5, cards: 12 });
  });

  test('an admin who reads neither queue gets the guard 403 and no count is read', async () => {
    for (const pagePermissions of [['users'], ['withdrawals.approve', 'cards.review', 'flags.read'], []]) {
      state.rpcs = [];
      allow({ pagePermissions });
      await asWeb();
      const res = await route.GET();
      assert.equal(res.status, 403, JSON.stringify(pagePermissions));
      assert.deepEqual(
        await bodyOf(res),
        failure('PERMISSION_DENIED', ERROR_MESSAGE.PERMISSION_DENIED, { details: { required: NEEDED } }),
      );
      assert.deepEqual(rpcNames(), ['admin_auth_state']);
    }
  });

  test('a signed-out caller gets 401 before any database call', async () => {
    signedOut();
    const res = await route.GET();
    assert.equal(res.status, 401);
    assert.deepEqual(await bodyOf(res), failure('AUTH_REQUIRED', ERROR_MESSAGE.AUTH_REQUIRED));
    assert.deepEqual(state.rpcs, []);
  });

  test('a session outage is the guard 500, never a 401, and no count is read (D8)', async () => {
    for (const outage of [{ error: { message: 'connection terminated' } }, 'throw', { data: null }] as Reply[]) {
      state.rpcs = [];
      state.authState = () => outage;
      await asWeb();
      const res = await route.GET();
      assert.equal(res.status, 500, JSON.stringify(outage));
      assert.deepEqual(await bodyOf(res), failure('INTERNAL_ERROR', SESSION_UNAVAILABLE), JSON.stringify(outage));
      assert.deepEqual(rpcNames(), ['admin_auth_state']);
    }
  });

  test('a mobile session gets 403 even when it reads both queues, with or without a web cookie, and no count is read', async () => {
    for (const withWebCookie of [false, true]) {
      state.rpcs = [];
      await asPhone(withWebCookie);
      const res = await route.GET();
      assert.equal(res.status, 403);
      assert.deepEqual(await bodyOf(res), failure('PERMISSION_DENIED', ERROR_MESSAGE.PERMISSION_DENIED));
      assert.deepEqual(rpcNames(), ['admin_auth_state']);
      assert.equal(state.rpcs[0].args.p_sid, PHONE_SID);
    }
  });

  test('a count that fails or cannot be read is a 500 with one fixed message, never a 401 and never a guessed number', async () => {
    const broken: Reply[] = [
      { error: { message: 'canceling statement due to statement timeout', code: '57014' } },
      { error: { message: 'JWT expired', code: 'PGRST301' } },
      'throw',
      { data: null },
      { data: [] },
      { data: 'nope' },
      { data: { ...WITHDRAWAL_STATS } },
      { data: { ...CARD_STATS } },
      { data: { ...CARD_STATS, ...WITHDRAWAL_STATS, disputedCards: -1 } },
      { data: { ...CARD_STATS, ...WITHDRAWAL_STATS, pendingCards: 2.5 } },
      { data: { ...CARD_STATS, ...WITHDRAWAL_STATS, pendingWithdrawals: 'many' } },
      { data: { ...CARD_STATS, ...WITHDRAWAL_STATS, pendingWithdrawals: '-3' } },
      { data: { ...CARD_STATS, ...WITHDRAWAL_STATS, pendingWithdrawals: null } },
      { data: { ...CARD_STATS, ...WITHDRAWAL_STATS, pendingCards: Number.MAX_SAFE_INTEGER + 2 } },
    ];
    for (const reply of broken) {
      logs.length = 0;
      state.metrics = () => reply;
      await asWeb();
      const res = await route.GET();
      assert.equal(res.status, 500, JSON.stringify(reply));
      assert.deepEqual(await bodyOf(res), failure('INTERNAL_ERROR', COUNTS_ERROR), JSON.stringify(reply));
      assert.equal(logs.length, 1, JSON.stringify(reply));
      assert.match(logs[0], /^nav counts failed: /);
    }
  });
});

describe('the route source', () => {
  test('it is a server module that exports only GET', () => {
    const source = read(ROUTE_FILE);
    assert.doesNotMatch(source, /^\s*['"]use client['"]/);
    assert.deepEqual([...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((match) => match[1]), ['GET']);
    assert.doesNotMatch(source, /^export\s+(?:\{|\*|default|type|interface)/m);
  });

  test('the guard runs first, then the web-only check, and only then the counts are read and sent with no-store', () => {
    const source = read(ROUTE_FILE);
    const steps = [
      'requireAdminAny(COUNT_PERMISSIONS)',
      "if (!isWebSession(admin.session)) return fail('PERMISSION_DENIED');",
      'waitingCounts(realtimeTopicKeys(admin.can))',
      "if (!counts) return fail('INTERNAL_ERROR', COUNTS_ERROR);",
      'return ok({ counts }, { headers: { ...NO_STORE } });',
    ];
    const at = steps.map((step) => source.indexOf(step));
    assert.ok(at.every((index) => index > 0), JSON.stringify(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    assert.match(source, /^const COUNT_PERMISSIONS = REALTIME_TOPICS\.map\(\(grant\) => grant\.permission\);$/m);
  });

  test('it reads the dashboard metrics function once and nothing else: no table query, no write, no audit row', () => {
    const source = read(ROUTE_FILE);
    assert.equal(count(source, ".rpc('admin_dashboard_metrics'"), 1);
    assert.equal(count(source, '.rpc('), 1);
    assert.doesNotMatch(source, /\.from\(|writeAudit|\.insert\(|\.update\(|\.upsert\(|\.delete\(|process\.env/);
    assert.match(source, /\.abortSignal\(AbortSignal\.timeout\(COUNT_TIMEOUT_MS\)\)/);
  });
});

describe('the counts are the console’s existing definitions, shared rather than rewritten', () => {
  function countSources(): Array<[string, string, string[]]> {
    const table = read(ROUTE_FILE).match(/const COUNT_SOURCES[^=]*= \{([\s\S]*?)\n\};/);
    assert.ok(table);
    return [...table[1].matchAll(/(\w+): \{ group: '(\w+)', metrics: \[([^\]]*)\] \}/g)]
      .map(([, key, group, metrics]): [string, string, string[]] => [
        key,
        group,
        [...metrics.matchAll(/'(\w+)'/g)].map((match) => match[1]),
      ]);
  }

  test('each sidebar count reads the dashboard’s own “needs action” figures for its queue', () => {
    assert.deepEqual(countSources(), [
      ['withdrawals', 'withdrawals', ['pendingWithdrawals']],
      ['cards', 'cards', ['pendingCards', 'disputedCards']],
    ]);
    const metrics = read(METRICS_FILE);
    for (const key of ['pendingCards', 'disputedCards', 'pendingWithdrawals']) {
      assert.ok(metrics.includes(`statKey: '${key}'`), key);
    }
  });

  test('those figures count exactly what the card-queue tabs and the withdrawals review tab count', { skip: !existsSync(SCHEMA_FILE) }, () => {
    const sql = readFileSync(SCHEMA_FILE, 'utf8');
    const body = sql.match(/CREATE OR REPLACE FUNCTION admin_dashboard_metrics\(([\s\S]*?)\n\$\$;/)?.[1] ?? '';
    assert.ok(body.length > 0);
    const group = (name: string) => {
      const start = body.indexOf(`IF '${name}' = ANY(g) THEN`);
      assert.ok(start >= 0, name);
      return body.slice(start, body.indexOf('END IF;', start));
    };
    assert.match(group('cards'), /'pendingCards',\s*\(SELECT count\(\*\) FROM card_submissions WHERE status = 'pending'\)/);
    assert.match(group('cards'), /'disputedCards',\s*\(SELECT count\(\*\) FROM card_submissions WHERE status = 'disputed'\)/);
    assert.match(group('withdrawals'), /'pendingWithdrawals',\s*\(SELECT count\(\*\) FROM withdrawals\s+WHERE status IN \('pending_review', 'held'\)\)/);

    const queueCounts = block(read(CARD_QUEUE_ROUTE), 'async function queueCounts()');
    assert.equal(count(queueCounts, ".from('card_submissions').select('id', { count: 'exact', head: true })"), 2);
    assert.deepEqual([...queueCounts.matchAll(/\.eq\('status', '(\w+)'\)/g)].map((match) => match[1]), ['pending', 'disputed']);
    assert.match(read(WITHDRAWALS_ROUTE), /^const REVIEW_STATUSES = \['pending_review', 'held'\];$/m);
  });

  test('the island asks for each count under the same read permission that grants its realtime topic', () => {
    assert.deepEqual(
      Object.fromEntries(pass.REALTIME_TOPICS.map((grant) => [grant.key, grant.permission])),
      { ...island.NAV_COUNT_PERMISSIONS },
    );
    assert.deepEqual(Object.keys(island.NAV_COUNT_PERMISSIONS).sort(), countSources().map(([key]) => key).sort());
  });
});

describe('the nav table and its count helpers', () => {
  test('Card Queue and Withdrawals carry a count; no other page does', () => {
    const counted = NAV_GROUPS.flatMap((group) => group.items).filter((leaf) => leaf.countKey !== undefined);
    assert.deepEqual(counted.map((leaf) => [leaf.href, leaf.countKey]), [
      ['/card-queue', 'cards'],
      ['/withdrawals', 'withdrawals'],
    ]);
  });

  test('the counts the sidebar asks for follow the pages the admin can open', () => {
    assert.deepEqual(navCountKeys(NAV_GROUPS), ['cards', 'withdrawals']);
    assert.deepEqual(navCountKeys(filterNavByPermissions([], true)), ['cards', 'withdrawals']);
    assert.deepEqual(navCountKeys(filterNavByPermissions(['withdrawals'], false)), ['withdrawals']);
    assert.deepEqual(navCountKeys(filterNavByPermissions(['card_queue', 'users'], false)), ['cards']);
    assert.deepEqual(navCountKeys(filterNavByPermissions(['users', 'coupons'], false)), []);
    assert.deepEqual(navCountKeys(filterNavByPermissions(['cards.read', 'withdrawals.read'], false)), []);
    assert.deepEqual(navCountKeys([]), []);
  });

  test('the badge text is capped at 99+', () => {
    assert.equal(NAV_COUNT_CAP, 99);
    for (const [value, text] of [[1, '1'], [9, '9'], [42, '42'], [99, '99'], [100, '99+'], [1500, '99+']] as const) {
      assert.equal(navCountText(value), text, String(value));
    }
  });

  test('the spoken label names the real number, and joins the page name when there is one', () => {
    assert.equal(navCountLabel(5), '5 waiting');
    assert.equal(navCountLabel(142), '142 waiting');
    assert.equal(navItemLabel('Card Queue', 5), 'Card Queue, 5 waiting');
    assert.equal(navItemLabel('Withdrawals', 142), 'Withdrawals, 142 waiting');
    assert.equal(navItemLabel('Withdrawals', null), 'Withdrawals');
  });
});

describe('reading and showing the counts', () => {
  const BOTH_LIVE: NavLive = { withdrawals: true, cards: true };

  test('the reply is read only when every count it carries is a whole number of zero or more', () => {
    assert.deepEqual(island.readNavCounts({ counts: { withdrawals: 6, cards: 7 } }), { withdrawals: 6, cards: 7 });
    assert.deepEqual(island.readNavCounts({ counts: { cards: 0 } }), { cards: 0 });
    assert.deepEqual(island.readNavCounts({ counts: { cards: 2, users: 9 } }), { cards: 2 });
    assert.deepEqual(island.readNavCounts({ counts: {} }), {});
    for (const body of [
      {},
      { counts: null },
      { counts: [] },
      { counts: 5 },
      { counts: { cards: -1 } },
      { counts: { cards: 1.5 } },
      { counts: { cards: '4' } },
      { counts: { withdrawals: Number.NaN } },
      { counts: { withdrawals: Number.POSITIVE_INFINITY } },
      { counts: { withdrawals: null } },
    ]) {
      assert.equal(island.readNavCounts(body as Record<string, unknown>), null, JSON.stringify(body));
    }
  });

  test('a badge shows only while its topic is live, after a good load, and never at zero', () => {
    const data: NavCountMap = { withdrawals: 6, cards: 7 };
    const view = (status: ResourceStatus, value: NavCountMap | undefined = data) => ({ status, data: value });
    const empty = { status: 'success' as const, data: undefined };
    assert.deepEqual(island.shownNavCounts(view('success'), BOTH_LIVE), { withdrawals: 6, cards: 7 });
    assert.deepEqual(island.shownNavCounts(view('success'), { withdrawals: false, cards: true }), { cards: 7 });
    assert.deepEqual(island.shownNavCounts(view('success'), { withdrawals: true, cards: false }), { withdrawals: 6 });
    assert.deepEqual(island.shownNavCounts(view('success'), { withdrawals: false, cards: false }), {});
    assert.deepEqual(island.shownNavCounts(view('success', { withdrawals: 0, cards: 3 }), BOTH_LIVE), { cards: 3 });
    assert.deepEqual(island.shownNavCounts(view('success', { cards: 3 }), BOTH_LIVE), { cards: 3 });
    for (const status of ['idle', 'loading', 'refreshing', 'error'] as const) {
      assert.deepEqual(island.shownNavCounts(view(status), BOTH_LIVE), {}, status);
    }
    assert.deepEqual(island.shownNavCounts(empty, BOTH_LIVE), {});
  });

  test('the badge is a token-styled number hidden from screen readers, since the link carries the words', () => {
    assert.equal(render(createElement(island.NavCount, { count: 5, active: false })), '<span class="count" aria-hidden="true">5</span>');
    assert.equal(render(createElement(island.NavCount, { count: 99, active: false })), '<span class="count" aria-hidden="true">99</span>');
    assert.equal(render(createElement(island.NavCount, { count: 100, active: true })), '<span class="count onActive" aria-hidden="true">99+</span>');
  });

  test('the counts are fetched with a plain GET through the console client; a failed or unreachable count never ends the session', async () => {
    const client = await loadAppModule<ApiClientModule>('lib/apiClient.ts');
    const expired: ApiFailure[] = [];
    const restore = client.configureApiClient({ onAuthExpired: (failure) => expired.push(failure) });
    const seen: Array<{ url: string; method: string | undefined; cache: string | undefined }> = [];
    let next: () => Response = () => new Response('{}');
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), method: init?.method, cache: init?.cache });
      return next();
    }) as typeof fetch;
    const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
    try {
      next = json(200, { success: true, request_id: 'r1', counts: { withdrawals: 2, cards: 0 } });
      const good = await island.fetchNavCounts(new AbortController().signal);
      assert.deepEqual(seen, [{ url: '/api/nav-counts', method: 'GET', cache: 'no-store' }]);
      assert.equal(good.ok, true);
      assert.deepEqual(good.ok ? good.data : null, { withdrawals: 2, cards: 0 });

      next = json(200, { success: true, counts: { cards: 'seven' } });
      const unreadable = await island.fetchNavCounts(new AbortController().signal);
      assert.equal(unreadable.ok, false);

      next = json(500, { success: false, code: 'INTERNAL_ERROR', error: COUNTS_ERROR });
      const down = await island.fetchNavCounts(new AbortController().signal);
      assert.equal(down.ok ? null : down.error.status, 500);

      next = json(500, { success: false, code: 'INTERNAL_ERROR', error: SESSION_UNAVAILABLE });
      await island.fetchNavCounts(new AbortController().signal);

      next = () => {
        throw new TypeError('Failed to fetch');
      };
      const offline = await island.fetchNavCounts(new AbortController().signal);
      assert.equal(offline.ok ? null : offline.error.kind, 'network');
      assert.deepEqual(expired, []);

      next = json(401, { success: false, code: 'AUTH_REQUIRED', error: ERROR_MESSAGE.AUTH_REQUIRED });
      await island.fetchNavCounts(new AbortController().signal);
      assert.equal(expired.length, 1, 'only an ended session reaches the session-expired dialog, as for every console read');
    } finally {
      globalThis.fetch = realFetch;
      restore();
    }
  });
});

describe('the island never polls', () => {
  interface Clock {
    env: ResourceEnvironment;
    advance: (ms: number) => void;
    timers: () => number;
  }

  function createClock(): Clock {
    let now = 1000;
    let sequence = 0;
    const pending = new Map<number, { at: number; callback: () => void }>();
    return {
      env: {
        now: () => now,
        setTimer: (callback, ms) => {
          sequence += 1;
          pending.set(sequence, { at: now + ms, callback });
          return sequence;
        },
        clearTimer: (handle) => {
          pending.delete(handle as number);
        },
        isHidden: () => false,
      },
      advance: (ms) => {
        now += ms;
        const due = [...pending].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
        for (const [id, timer] of due) {
          if (!pending.has(id)) continue;
          pending.delete(id);
          timer.callback();
        }
      },
      timers: () => pending.size,
    };
  }

  function counts(clock: Clock) {
    const calls: Array<(result: ApiResult<NavCountMap>) => void> = [];
    const store = new resources.ResourceStore<NavCountMap>(clock.env);
    store.setFetcher(() => new Promise<ApiResult<NavCountMap>>((done) => {
      calls.push(done);
    }));
    const hint = () => store.invalidate({ minGapMs: island.NAV_COUNT_GAP_MS });
    return { store, calls, hint };
  }

  function flush(): Promise<void> {
    return new Promise((done) => setImmediate(done));
  }

  async function answer(calls: Array<(result: ApiResult<NavCountMap>) => void>, data: NavCountMap): Promise<void> {
    for (const done of calls) done({ ok: true, data, status: 200, requestId: 'req_ok' });
    await flush();
  }

  async function refuse(calls: Array<(result: ApiResult<NavCountMap>) => void>, status: number): Promise<void> {
    for (const done of calls) {
      done({
        ok: false,
        error: { kind: 'http', status, code: null, message: `failed ${status}`, requestId: null, details: null, outcomeUnknown: false },
      });
    }
    await flush();
  }

  test('after the first load nothing is armed, so a quiet day sends no request at all', async () => {
    const clock = createClock();
    const { store, calls } = counts(clock);
    store.start(island.NAV_COUNTS_PATH, true);
    assert.equal(calls.length, 1);
    await answer(calls, { withdrawals: 1, cards: 2 });
    assert.equal(clock.timers(), 0);
    clock.advance(24 * HOUR_MS);
    assert.equal(calls.length, 1);
  });

  test('signals reload at most once per two seconds, and a signal during a load gets one follow-up', async () => {
    assert.equal(island.NAV_COUNT_GAP_MS, 2000);
    const clock = createClock();
    const { store, calls, hint } = counts(clock);
    store.start(island.NAV_COUNTS_PATH, true);
    await answer(calls, { cards: 1 });
    for (let index = 0; index < 10; index += 1) {
      hint();
      clock.advance(10);
    }
    assert.equal(calls.length, 2);
    await answer(calls, { cards: 2 });
    clock.advance(1899);
    assert.equal(calls.length, 2);
    clock.advance(1);
    assert.equal(calls.length, 3);
    await answer(calls, { cards: 3 });
    assert.equal(clock.timers(), 0);
    clock.advance(HOUR_MS);
    assert.equal(calls.length, 3);
  });

  test('while no topic is live there is no key, so signals load nothing', () => {
    const clock = createClock();
    const { store, calls, hint } = counts(clock);
    store.start(null, true);
    hint();
    clock.advance(HOUR_MS);
    assert.equal(calls.length, 0);
    assert.equal(clock.timers(), 0);
  });

  test('after a 401 or a 403 signals send nothing more', async () => {
    for (const status of [401, 403]) {
      const clock = createClock();
      const { store, calls, hint } = counts(clock);
      store.start(island.NAV_COUNTS_PATH, true);
      await refuse(calls, status);
      hint();
      clock.advance(HOUR_MS);
      assert.equal(calls.length, 1, String(status));
    }
  });
});

describe('the island source', () => {
  test('it is a client module that reads the counts through useResource with no polling, gated on live topics', () => {
    const source = read(ISLAND_FILE);
    assert.ok(source.startsWith("'use client';\n"));
    assert.equal(count(source, 'useResource('), 1);
    assert.match(source, /const counts = useResource\(live\.withdrawals \|\| live\.cards \? NAV_COUNTS_PATH : null, fetchNavCounts\);/);
    assert.doesNotMatch(source, /pollMs|setInterval|setTimeout|requestAnimationFrame|Date\.now|performance\.now/);
  });

  test('it listens on each topic it shows, under its read permission, and reloads with the two-second gap on every hint', () => {
    const source = read(ISLAND_FILE);
    assert.match(source, /const topic = \(key: NavCountKey\) => \(keys\.includes\(key\) && can\(NAV_COUNT_PERMISSIONS\[key\]\) \? key : null\);/);
    assert.match(source, /const reload = \(\) => counts\.invalidate\(\{ minGapMs: NAV_COUNT_GAP_MS \}\);/);
    assert.equal(count(source, 'useRealtimeSignal('), 2);
    assert.match(source, /const withdrawals = useRealtimeSignal\(topic\('withdrawals'\), reload\);/);
    assert.match(source, /const cards = useRealtimeSignal\(topic\('cards'\), reload\);/);
    assert.equal(count(source, '.invalidate('), 1);
    assert.doesNotMatch(source, /\.refresh\(|\.mutate\(/);
  });

  test('a failed count only hides the badges: no toast, no dialog, no sign-out, no navigation', () => {
    const source = read(ISLAND_FILE);
    assert.doesNotMatch(source, /useToast|toast\.|useConfirm|notifySessionExpired|leaveConsole|signOut|logout|window\.location|router|throw /);
  });

  test('its static imports stay on the client side and never reach the server pass library, the service client or supabase-js', () => {
    assert.deepEqual(valueImports(read(ISLAND_FILE)), [
      '../../lib/apiClient',
      '../../_ui/Permissions',
      '../../_ui/realtime/RealtimeSignals',
      '../../_ui/useResource',
      './nav',
      './NavCounts.module.css',
    ]);
    for (const entry of [ISLAND_FILE, SHELL_FILE]) {
      const graph = staticGraph(entry);
      assert.ok(graph.has(join(APP_DIR, '_ui', 'realtime', 'RealtimeSignals.tsx')), rel(entry));
      for (const banned of [PASS_LIB_FILE, SUPABASE_FILE, ROUTE_FILE, join(APP_DIR, '_ui', 'realtime', 'supabaseTransport.ts')]) {
        assert.ok(!graph.has(banned), `${rel(entry)} reaches ${rel(banned)}`);
      }
    }
  });
});

describe('the shell wiring', () => {
  const { PathnameContext } = nodeRequire('next/dist/shared/lib/hooks-client-context.shared-runtime') as {
    PathnameContext: Context<string | null>;
  };
  let shell: ShellModule;
  let theme: ThemeModule;

  before(async () => {
    shell = await loadAppModule<ShellModule>('(dashboard)/_shell/Shell.tsx');
    theme = await loadUi<ThemeModule>('theme.tsx');
  });

  function inShell(props: Partial<Omit<ShellProps, 'children'>> = {}): string {
    const shellProps: ShellProps = {
      allowedKeys: ['withdrawals', 'card_queue'],
      isSuperAdmin: false,
      permissions: ['cards.read', 'withdrawals.read'],
      username: 'ada',
      roleTitle: 'Card Reviewer',
      ...props,
      children: createElement('p', { id: 'page-probe' }, 'page body'),
    };
    return render(createElement(
      PathnameContext.Provider,
      { value: '/withdrawals' },
      createElement(theme.ThemeProvider, {
        initialMode: 'light',
        initialResolved: 'light',
        children: createElement(shell.Shell, shellProps),
      }),
    ));
  }

  function navLink(html: string, href: string) {
    const [anchor] = tagsOf(html, 'a').filter((attrs) => attrs.href === href && (attrs.class ?? '').includes('navItem'));
    assert.ok(anchor, href);
    return anchor;
  }

  test('before live updates run the sidebar renders exactly as before: no badge, and today’s link names', () => {
    const open = inShell();
    assert.doesNotMatch(open, /class="count/);
    assert.equal(navLink(open, '/card-queue')['aria-label'], undefined);
    assert.equal(navLink(open, '/withdrawals')['aria-label'], undefined);
    assert.match(open, /<p id="page-probe">page body<\/p>/);
    const rail = inShell({ initialCollapsed: true });
    assert.doesNotMatch(rail, /class="count/);
    assert.equal(navLink(rail, '/card-queue')['aria-label'], 'Card Queue');
    assert.equal(navLink(rail, '/withdrawals')['aria-label'], 'Withdrawals');
  });

  test('the frame asks for the counts of the pages it lists, and each link names its count when one shows', () => {
    const source = read(SHELL_FILE);
    assert.match(source, /^import \{ NavCount, useNavCounts \} from '\.\/NavCounts';$/m);
    assert.match(source, /const countKeys = useMemo\(\(\) => navCountKeys\(navGroups\), \[navGroups\]\);\s*const navCounts = useNavCounts\(countKeys\);/);
    assert.match(source, /const count = item\.countKey \? navCounts\[item\.countKey\] \?\? null : null;/);
    assert.match(source, /aria-label=\{collapsed \|\| count !== null \? navItemLabel\(item\.label, count\) : undefined\}/);
    assert.match(
      source,
      /<span className=\{s\.navLabel\}>\{item\.label\}<\/span>\s*\{count !== null \? <NavCount count=\{count\} active=\{active\} \/> : null\}\s*<\/Link>/,
    );
    assert.equal(count(source, 'useNavCounts('), 1);
    const frame = source.slice(source.indexOf('function ShellFrame('), source.indexOf('export interface SidebarAccountProps'));
    assert.ok(frame.includes('useNavCounts(countKeys)'));
    assert.match(source, /title=\{collapsed && railTip\.activeId !== item\.href \? item\.label : undefined\}/);
    assert.match(source, /\{\.\.\.\(collapsed \? railTip\.trigger\(item\.href, item\.label\) : \{\}\)\}/);
  });
});

describe('the badge stylesheet', () => {
  test('tokens only: no literal colours, no stacking order, no comments', () => {
    const css = read(ISLAND_CSS);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(css, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/);
    assert.doesNotMatch(css, /(?<![-\w])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink)(?![-\w])/i);
    assert.doesNotMatch(css, /z-index|!important|\/\*/);
    for (const [, property, value] of css.matchAll(/(background|color|font-family|font-size|font-weight|border-radius):\s*([^;]+);/g)) {
      assert.match(value.trim(), /^var\(--[a-z0-9-]+\)$/, `${property}: ${value}`);
    }
  });

  test('every class the island uses is defined, and no rule is left unused', () => {
    const used = new Set([...read(ISLAND_FILE).matchAll(/\bs\.([A-Za-z]\w*)/g)].map((match) => match[1]));
    const defined = new Set([...read(ISLAND_CSS).matchAll(/\.([A-Za-z]\w*)/g)].map((match) => match[1]));
    assert.deepEqual([...used].sort(), [...defined].sort());
  });

  test('on the collapsed rail it sits on the icon corner under the same container rule that hides the labels', () => {
    const shellCss = read(SHELL_CSS);
    const container = shellCss.match(/container: ([\w-]+) \/ inline-size;/)?.[1];
    assert.equal(container, 'shell-sidebar');
    const rule = read(ISLAND_CSS).match(/@container ([^{]+)\{/)?.[1].trim();
    assert.equal(rule, `${container} (max-width: 120px)`);
    assert.ok(shellCss.includes(`@container ${rule} {`));
    const railBlock = read(ISLAND_CSS).slice(read(ISLAND_CSS).indexOf('@container'));
    assert.match(railBlock, /position: absolute;/);
    const navItem = shellCss.slice(shellCss.indexOf('.navItem {'), shellCss.indexOf('}', shellCss.indexOf('.navItem {')));
    assert.match(navItem, /position: relative;/);
  });
});

describe('house rules for the sidebar counts', () => {
  test('the new and changed files carry no prose comments', () => {
    for (const file of [ROUTE_FILE, ISLAND_FILE, ISLAND_CSS, NAV_FILE, SHELL_FILE, TEST_FILE]) {
      assert.doesNotMatch(read(file), /\/\*|(^|[^:])\/\/(?!\/)/m, rel(file));
    }
  });

  test('the nav table stays a plain module the server layout can import', () => {
    const source = read(NAV_FILE);
    assert.doesNotMatch(source, /^\s*['"]use client['"]/);
    assert.deepEqual(valueImports(source), ['lucide-react']);
  });

  test('the counts route is web-only: the mobile path list is unchanged and does not hold it', () => {
    const list = read(SESSION_TEST_FILE).match(/const MOBILE_WEB_PATHS = \[([\s\S]*?)\] as const;/);
    assert.ok(list);
    const paths = [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    assert.equal(paths.length, 33);
    assert.ok(!paths.includes('/api/nav-counts'));
  });

  test('the mobile app never asks for the counts', { skip: !existsSync(MOBILE_DIR) }, () => {
    const files = ['app', 'lib', 'components']
      .map((dir) => join(MOBILE_DIR, dir))
      .filter((dir) => existsSync(dir))
      .flatMap((dir) => walk(dir));
    assert.ok(files.length > 0);
    for (const file of files) assert.ok(!readFileSync(file, 'utf8').includes('/api/nav-counts'), file);
  });
});
