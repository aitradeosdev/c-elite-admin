import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ElementType } from 'react';
import ts from 'typescript';
import { loadAppModule, loadUi, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiBody, ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type { ProfileData } from '../app/(dashboard)/users/[id]/model.ts';

type DeletionModule = typeof import('../app/(dashboard)/users/[id]/accountDeletion.ts');
type ModelModule = typeof import('../app/(dashboard)/users/[id]/model.ts');
type OptionsModule = typeof import('../app/(dashboard)/users/[id]/deleteOptions.tsx');
type PermissionsModule = typeof import('../app/_ui/Permissions.tsx');

interface Session {
  id: string;
  client: 'web' | 'mobile';
  amr: string[];
  createdAt: string;
  expiresAt: string;
  reauthAt: string | null;
  transport: 'cookie' | 'bearer';
}

interface Claims {
  admin_id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  token_version: number;
  session: Session;
}

interface EdgeCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: boolean;
}

interface Harness {
  claims: Claims | null;
  token: string;
  headers: Record<string, string>;
}

interface DeleteRoute {
  POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

type EdgeReply = { status: number; body: unknown } | 'network';

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const ROUTE_FILE = join(APP_DIR, 'api', 'users', '[id]', 'delete', 'route.ts');
const SHARED_FILE = join(APP_DIR, '(dashboard)', 'users', '[id]', 'accountDeletion.ts');
const OPTIONS_FILE = join(APP_DIR, '(dashboard)', 'users', '[id]', 'deleteOptions.tsx');
const PAGE_FILE = join(APP_DIR, '(dashboard)', 'users', '[id]', 'page.tsx');
const PARTS_FILE = join(APP_DIR, '(dashboard)', 'users', '[id]', 'UserParts.tsx');
const DETAIL_ROUTE = join(APP_DIR, 'api', 'users', '[id]', 'route.ts');
const TEST_FILE = fileURLToPath(import.meta.url);
const HARNESS_KEY = '__userDeleteRouteHarness';

const USER_ID = '3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const ADMIN_ID = '0e000000-0000-4000-8000-0000000000aa';
const REQUEST_ID = 'req_userdelete01';
const USER_AGENT = 'user-delete-test';
const CLIENT_IP = '198.51.100.46';
const TOKEN = 'admin.session.token';
const EDGE_BASE = 'https://edge.test';
const SECRET = 'fn-secret';
const REASON = 'Deletion requested by email on 22 October';
const EMAIL = 'ada@example.com';
const REASON_MESSAGE = 'Enter a reason of 3 to 500 characters.';

const WEB: Session = {
  id: '7c000000-0000-4000-8000-0000000000bb',
  client: 'web',
  amr: ['pwd', 'otp'],
  createdAt: '2026-10-22T08:00:00.000Z',
  expiresAt: '2026-10-22T20:00:00.000Z',
  reauthAt: null,
  transport: 'cookie',
};

const OWNER: Claims = {
  admin_id: ADMIN_ID,
  username: 'owner',
  role_title: 'Super Admin',
  is_super_admin: true,
  page_permissions: [],
  token_version: 0,
  session: WEB,
};

function staff(grants: string[], session: Session = WEB): Claims {
  return { ...OWNER, username: 'support', role_title: 'Support', is_super_admin: false, page_permissions: grants, session };
}

const harness: Harness = { claims: OWNER, token: TOKEN, headers: {} };
Reflect.set(globalThis, HARNESS_KEY, harness);

const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const harnessRef = `const harness = () => globalThis.${HARNESS_KEY};`;

const FILE_STUBS: Readonly<Record<string, string>> = {
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: moduleUrl('export const supabaseAdmin = { from() { throw new Error(\'the delete route must not read the database\'); }, rpc() { throw new Error(\'the delete route must not call the database\'); } };'),
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: moduleUrl(`${harnessRef}
export async function verifyAdminFromRequest() { return harness().claims; }
export async function sessionTokenFromRequest() { return { token: harness().token, transport: 'cookie' }; }`),
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
const savedEnv = { url: process.env.SUPABASE_URL, secret: process.env.ADMIN_FUNCTION_SECRET };
let route: DeleteRoute;
let shared: DeletionModule;
let model: ModelModule;
let options: OptionsModule;
let perms: PermissionsModule;
let parts: Record<string, ElementType>;
let calls: EdgeCall[] = [];
let edgeReply: EdgeReply = { status: 200, body: { success: true, code: 'deleted', resumed: false, files_removed: true } };

function stubEdge(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      signal: Boolean(init?.signal),
    });
    if (edgeReply === 'network') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(edgeReply.body), { status: edgeReply.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function reset(claims: Claims | null = OWNER): void {
  harness.claims = claims;
  harness.token = TOKEN;
  harness.headers = { 'x-request-id': REQUEST_ID, 'user-agent': USER_AGENT, 'x-forwarded-for': CLIENT_IP };
  calls = [];
  edgeReply = { status: 200, body: { success: true, code: 'deleted', resumed: false, files_removed: true } };
  process.env.SUPABASE_URL = EDGE_BASE;
  process.env.ADMIN_FUNCTION_SECRET = SECRET;
}

async function post(payload: unknown, id = USER_ID): Promise<Reply> {
  const response = await route.POST(new Request(`http://admin.test/api/users/${id}/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  }), { params: Promise.resolve({ id }) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function failure(patch: Partial<ApiFailure>): ApiResult<ApiBody> {
  return {
    ok: false,
    error: { kind: 'http', status: 500, code: 'INTERNAL_ERROR', message: 'failed', requestId: null, details: null, outcomeUnknown: false, ...patch },
  };
}

function profileOf(patch: Partial<ProfileData['user']> = {}, deletionUnfinished: boolean | null = null): ProfileData {
  return {
    user: {
      id: USER_ID,
      full_name: 'Ada Obi',
      username: 'ada',
      email: EMAIL,
      phone: '08030000000',
      country: 'NG',
      is_active: true,
      is_frozen: false,
      freeze_reason: null,
      referral_code: 'ADA1',
      referred_by: null,
      bonus_balance: 0,
      last_active_at: null,
      created_at: '2026-01-02T09:00:00.000Z',
      deleted_at: null,
      balance: 0,
      avatar_url: null,
      ...patch,
    },
    referrer: null,
    stats: { trades: 0, withdrawals: 0, withdrawals_pending: 0, card_submissions: 0 },
    deletionUnfinished,
    partial: { stats: null, referrer: null, deletion: null },
  };
}

function button(profile: ProfileData, permissions: string[], isSuperAdmin = false): string {
  return render(createElement(
    perms.PermissionsProvider,
    { permissions, isSuperAdmin },
    createElement(parts.DeleteAccountButton, { profile, onOpen: () => {} }),
  ));
}

before(async () => {
  route = (await import(await bundle(ROUTE_FILE))) as DeleteRoute;
  shared = await loadAppModule<DeletionModule>('(dashboard)/users/[id]/accountDeletion.ts');
  model = await loadAppModule<ModelModule>('(dashboard)/users/[id]/model.ts');
  options = await loadAppModule<OptionsModule>('(dashboard)/users/[id]/deleteOptions.tsx');
  perms = await loadUi<PermissionsModule>('Permissions.tsx');
  parts = await loadAppModule<Record<string, ElementType>>('(dashboard)/users/[id]/UserParts.tsx');
});

beforeEach(() => {
  reset();
  stubEdge();
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.SUPABASE_URL = savedEnv.url;
  process.env.ADMIN_FUNCTION_SECRET = savedEnv.secret;
  mock.restoreAll();
});

describe('POST /api/users/[id]/delete: who may call it', () => {
  test('anonymous, partial grants and phone sessions are refused before anything is sent', async () => {
    reset(null);
    stubEdge();
    let reply = await post({ reason: REASON, request_email: EMAIL });
    assert.equal(reply.status, 401);
    assert.equal(reply.body.code, 'AUTH_REQUIRED');
    for (const grants of [['users.read'], ['users.delete'], ['users', 'users_freeze']]) {
      reset(staff(grants));
      stubEdge();
      reply = await post({ reason: REASON, request_email: EMAIL });
      assert.equal(reply.status, 403, grants.join());
      assert.equal(reply.body.code, 'PERMISSION_DENIED');
      assert.deepEqual(reply.body.details, { required: ['users.read', 'users.delete'] });
      assert.equal(calls.length, 0);
    }
    reset(staff(['users.read', 'users.delete'], { ...WEB, client: 'mobile', transport: 'bearer' }));
    stubEdge();
    reply = await post({ reason: REASON, request_email: EMAIL });
    assert.equal(reply.status, 403);
    assert.equal(reply.body.message, 'Accounts can only be deleted in the web console.');
    assert.equal(calls.length, 0);
  });

  test('a role holding users.read and users.delete, and a super admin, reach the edge function', async () => {
    for (const claims of [staff(['users.read', 'users.delete']), OWNER]) {
      reset(claims);
      stubEdge();
      const reply = await post({ reason: REASON, request_email: EMAIL });
      assert.equal(reply.status, 200);
      assert.equal(calls.length, 1);
    }
  });
});

describe('POST /api/users/[id]/delete: the request', () => {
  test('bad input is refused with 400 and nothing is sent', async () => {
    const cases: Array<[unknown, string, string?]> = [
      ['not json', 'Send the deletion as a JSON object.'],
      [[1, 2], 'Send the deletion as a JSON object.'],
      [{ reason: 'ab', request_email: EMAIL }, REASON_MESSAGE],
      [{ reason: 'x'.repeat(501), request_email: EMAIL }, REASON_MESSAGE],
      [{ request_email: EMAIL }, REASON_MESSAGE],
      [{ reason: REASON, request_email: '   ' }, 'Confirm the email address the request came from.'],
      [{ reason: REASON, request_email: 42 }, 'Confirm the email address the request came from.'],
      [{ reason: REASON, request_email: `${'a'.repeat(250)}@b.cd` }, 'Confirm the email address the request came from.'],
      [{ reason: REASON, request_email: EMAIL }, 'Invalid user id.', 'not-a-uuid'],
    ];
    for (const [payload, message, id] of cases) {
      calls = [];
      const reply = await post(payload, id);
      assert.equal(reply.status, 400, JSON.stringify(payload));
      assert.equal(reply.body.message, message);
      assert.equal(calls.length, 0);
    }
  });

  test('missing edge settings answer 502 and send nothing', async () => {
    for (const key of ['SUPABASE_URL', 'ADMIN_FUNCTION_SECRET'] as const) {
      reset();
      stubEdge();
      delete process.env[key];
      const reply = await post({ reason: REASON, request_email: EMAIL });
      assert.equal(reply.status, 502);
      assert.equal(reply.body.code, 'PROVIDER_ERROR');
      assert.equal(reply.body.message, 'Deleting accounts is not set up on the server, so nothing was changed.');
      assert.equal(calls.length, 0);
    }
  });

  test('without a session token nothing is sent', async () => {
    harness.token = '';
    const reply = await post({ reason: REASON, request_email: EMAIL });
    assert.equal(reply.status, 401);
    assert.equal(calls.length, 0);
  });

  test('exactly one call goes to admin-delete-account, with the secret, the admin token and the request', async () => {
    const reply = await post({ reason: `  ${REASON}  `, request_email: ' Ada@Example.com ' }, USER_ID.toUpperCase());
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { success: true, request_id: REQUEST_ID, deleted: true, resumed: false });
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.url, `${EDGE_BASE}/functions/v1/admin-delete-account`);
    assert.equal(call.headers['x-admin-secret'], SECRET);
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(call.signal, true);
    assert.deepEqual(call.body, {
      user_id: USER_ID,
      request_email: 'Ada@Example.com',
      reason: REASON,
      ip: CLIENT_IP,
      user_agent: USER_AGENT,
      request_id: REQUEST_ID,
    });
  });

  test('finishing a deletion sends no request email', async () => {
    edgeReply = { status: 200, body: { success: true, code: 'deleted', resumed: true, files_removed: true } };
    const reply = await post({ reason: 'The deletion stopped before the sign-in was removed' });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.resumed, true);
    assert.equal((calls[0].body as Record<string, unknown>).request_email, null);
  });
});

describe('POST /api/users/[id]/delete: the edge answers', () => {
  const cases: Array<[string, EdgeReply, number, string, string, Record<string, unknown> | undefined]> = [
    ['wallet', { status: 409, body: { success: false, code: 'wallet_balance', balance: 1500 } }, 409, 'STATE_CONFLICT',
      'The wallet holds ₦1,500.00. An account can only be deleted when its wallet is at ₦0, so nothing was changed.', { reason: 'wallet_balance', balance: 1500 }],
    ['in flight', { status: 409, body: { success: false, code: 'in_flight' } }, 409, 'STATE_CONFLICT',
      'A gift card trade, withdrawal or bill payment on this account is still in progress, so nothing was changed. Try again once it has finished.', { reason: 'in_flight' }],
    ['email', { status: 409, body: { success: false, code: 'email_mismatch' } }, 409, 'STATE_CONFLICT',
      'The email address on this account is not the one you confirmed, so nothing was changed. Reload the page and check the request again.', { reason: 'email_mismatch' }],
    ['finished', { status: 409, body: { success: false, code: 'already_deleted' } }, 409, 'STATE_CONFLICT',
      'This account’s deletion has already finished, so nothing was changed.', { reason: 'already_deleted' }],
    ['not found', { status: 404, body: { success: false, code: 'not_found' } }, 404, 'RESOURCE_NOT_FOUND', 'User not found.', undefined],
    ['reason', { status: 400, body: { success: false, code: 'reason_required' } }, 400, 'VALIDATION_ERROR', REASON_MESSAGE, { field: 'reason' }],
    ['forbidden', { status: 403, body: { success: false, code: 'forbidden' } }, 403, 'PERMISSION_DENIED', 'You do not have permission to do this.', { required: ['users.delete'] }],
    ['rate', { status: 429, body: { success: false, code: 'rate_limited' } }, 429, 'RATE_LIMITED',
      'You can delete at most 10 accounts an hour, so nothing was changed. Try again later.', undefined],
    ['session', { status: 401, body: { success: false, code: 'session_ended' } }, 401, 'AUTH_REQUIRED', 'Your session has expired. Sign in again.', undefined],
    ['secret', { status: 401, body: { success: false, code: 'not_authorized' } }, 502, 'PROVIDER_ERROR',
      'Deleting accounts is not set up on the server, so nothing was changed.', undefined],
    ['db', { status: 500, body: { success: false, code: 'db_error' } }, 500, 'INTERNAL_ERROR',
      'The server could not check this deletion, so nothing was changed. Try again.', undefined],
    ['sign-in left', { status: 500, body: { success: false, code: 'auth_not_removed' } }, 500, 'INTERNAL_ERROR',
      'The account was deleted, but its sign-in could not be removed. Try again to finish the deletion.', undefined],
    ['missing function', { status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } }, 502, 'PROVIDER_ERROR',
      'The deletion service refused this request, so nothing was changed.', undefined],
  ];

  for (const [label, answer, status, code, message, details] of cases) {
    test(`${label}: ${status} ${code}`, async () => {
      edgeReply = answer;
      const reply = await post({ reason: REASON, request_email: EMAIL });
      assert.equal(reply.status, status);
      assert.equal(reply.body.code, code);
      assert.equal(reply.body.message, message);
      assert.deepEqual(reply.body.details, details);
    });
  }

  test('a file removal failure is a success with a warning', async () => {
    edgeReply = { status: 200, body: { success: true, code: 'deleted', resumed: false, files_removed: false } };
    const reply = await post({ reason: REASON, request_email: EMAIL });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.warning, 'The account was deleted, but some of its stored files could not be removed.');
  });

  test('no answer, a server error or an unreadable success is an unknown outcome, never a guessed result', async () => {
    for (const answer of [
      'network',
      { status: 500, body: { success: false, code: 'server_error' } },
      { status: 546, body: { code: 'WORKER_LIMIT' } },
      { status: 200, body: { success: true } },
      { status: 200, body: 'ok' },
    ] as EdgeReply[]) {
      edgeReply = answer;
      const reply = await post({ reason: REASON, request_email: EMAIL });
      assert.equal(reply.status, 500, JSON.stringify(answer));
      assert.equal(reply.body.code, 'INTERNAL_ERROR');
      assert.deepEqual(reply.body.details, { outcome_unknown: true });
      assert.equal(
        reply.body.message,
        'No answer came back, so the account may or may not have been deleted. Reload the page to see its current state.',
      );
    }
  });
});

describe('the user page model', () => {
  test('deletionKind offers delete for a live account with an email and finish only for an unfinished deletion', () => {
    assert.equal(model.deletionKind(profileOf()), 'delete');
    assert.equal(model.deletionKind(profileOf({ is_frozen: true, freeze_reason: 'Suspected fraud' })), 'delete');
    assert.equal(model.deletionKind(profileOf({ email: null })), null);
    const deleted = { deleted_at: '2026-10-22T09:00:00.000Z', email: `deleted_${USER_ID}@deleted.local` };
    assert.equal(model.deletionKind(profileOf(deleted, true)), 'finish');
    assert.equal(model.deletionKind(profileOf(deleted, false)), null);
    assert.equal(model.deletionKind(profileOf(deleted, null)), null);
  });

  test('an unknown outcome carried in details closes the dialog as unknown', () => {
    assert.deepEqual(model.classifyAction(failure({ code: 'INTERNAL_ERROR', details: { outcome_unknown: true } })), { kind: 'unknown' });
    assert.deepEqual(model.classifyAction(failure({ code: 'INTERNAL_ERROR', message: 'signin left' })), { kind: 'retry', message: 'signin left' });
  });

  test('the toasts name the account', () => {
    const user = { full_name: 'Ada Obi', username: 'ada' };
    assert.deepEqual(model.actionNotice('delete', user, { kind: 'done', warning: null }), { text: '@ada was deleted.', tone: 'success' });
    assert.deepEqual(model.actionNotice('finish', { full_name: null, username: 'deleted_3f2a' }, { kind: 'done', warning: null }), {
      text: 'The deletion of @deleted_3f2a is finished.', tone: 'success',
    });
    assert.deepEqual(model.actionNotice('delete', user, { kind: 'done', warning: 'Files left.' }), { text: 'Files left.', tone: 'warning' });
  });

  test('the profile reads whether a deletion is unfinished', () => {
    const body = { user: { id: USER_ID }, deletion_unfinished: true, partial: { deletion: 'x' } };
    const read = model.readProfile(body);
    assert.ok(read);
    assert.equal(read.deletionUnfinished, true);
    assert.equal(read.partial.deletion, 'x');
    assert.equal(model.readProfile({ user: { id: USER_ID } })?.deletionUnfinished, null);
  });
});

describe('the Delete account button and dialogs', () => {
  test('the button needs users.read and users.delete', () => {
    assert.match(textOf(button(profileOf(), ['users.read', 'users.delete'])), /Delete account/);
    assert.match(textOf(button(profileOf(), [], true)), /Delete account/);
    assert.equal(button(profileOf(), ['users.read']), '');
    assert.equal(button(profileOf(), ['users.delete']), '');
    const deleted = { deleted_at: '2026-10-22T09:00:00.000Z' };
    assert.match(textOf(button(profileOf(deleted, true), [], true)), /Finish deletion/);
    assert.equal(button(profileOf(deleted, false), [], true), '');
    assert.equal(tagsOf(button(profileOf(), [], true), 'button').length, 1);
  });

  test('the delete dialog asks for the email, the reason and the check', () => {
    const plain = options.deleteOptions(profileOf());
    assert.equal(plain.tone, 'danger');
    assert.equal(plain.title, 'Delete @ada?');
    assert.equal(plain.message, 'This deletes the account for good, in the same way as when the user deletes it in the app.');
    assert.equal(plain.requireTyped, EMAIL);
    assert.equal(plain.acknowledge, `I have checked that the deletion request came from ${EMAIL}, the email address on this account, and that the account holder confirmed it when we replied.`);
    assert.equal(plain.confirmLabel, 'Delete account');
    assert.deepEqual(plain.reason, {
      required: true,
      label: 'Reason for deleting',
      placeholder: 'For example: deletion requested by email on 22 October. Leave out names and email addresses.',
      maxLength: 500,
    });
    assert.deepEqual(plain.consequences, [
      'This cannot be undone.',
      'It only goes ahead if the wallet is at ₦0 and no gift card trade, withdrawal or bill payment is still in progress. Otherwise nothing changes.',
      'The name, username, phone number, country and email address are removed, and no one can sign in to this account again.',
      'Devices, sign-in history and saved bank accounts are deleted, and the support chats are removed from the chat service soon after. Trade, withdrawal and bill payment records are kept.',
    ]);
    const busy = options.deleteOptions(profileOf({ balance: 1500, bonus_balance: 200, is_frozen: true, freeze_reason: 'Suspected fraud' }));
    assert.ok(busy.consequences?.includes('The wallet holds ₦1,500.00, so the deletion will be refused until the user withdraws or spends it.'));
    assert.ok(busy.consequences?.includes('The bonus balance of ₦200.00 is lost when the account is deleted.'));
    assert.ok(busy.consequences?.includes('The account is frozen. If the deletion is refused, it stays frozen with the same reason.'));
    assert.ok(busy.details?.some((row) => row.label === 'Frozen because' && row.value === 'Suspected fraud'));
  });

  test('the finish dialog asks only for a reason', () => {
    const finish = options.finishOptions(profileOf({ deleted_at: '2026-10-22T09:00:00.000Z', username: 'deleted_3f2a', full_name: null }, true));
    assert.equal(finish.title, 'Finish deleting @deleted_3f2a?');
    assert.equal(finish.message, 'This account’s deletion did not finish. Its details are already removed, but its sign-in is still there.');
    assert.equal(finish.requireTyped, undefined);
    assert.equal(finish.acknowledge, undefined);
    assert.equal(finish.confirmLabel, 'Finish deletion');
    assert.equal(finish.reason?.label, 'Reason for finishing');
  });
});

describe('sources', () => {
  test('the route checks access, then the request, then calls the edge function once and never the database', () => {
    const source = readFileSync(ROUTE_FILE, 'utf8');
    assert.match(source, /^export const maxDuration = 60;$/m);
    assert.deepEqual([...source.matchAll(/^export async function (\w+)/gm)].map((match) => match[1]), ['POST']);
    const guard = source.indexOf("requireAdminAll(['users.read', 'users.delete'])");
    const web = source.indexOf("admin.session.client !== 'web'");
    const body = source.indexOf('readDeleteRequest(');
    const edge = source.indexOf('callEdgeFunction(');
    assert.ok(guard > 0 && guard < web && web < body && body < edge);
    assert.doesNotMatch(source, /supabaseAdmin|writeAudit|\bfetch\(/);
    assert.doesNotMatch(source, /console\.error\([^)]*(?:requestEmail|request_email|token)/);
  });

  test('the user detail route asks whether a deletion finished only for admins who can delete', () => {
    const source = readFileSync(DETAIL_ROUTE, 'utf8');
    assert.match(source, /const checkDeletion = Boolean\(user\.deleted_at\) && admin\.can\('users\.delete'\);/);
    assert.match(source, /rpc\('admin_deletion_unfinished', \{ p_uid: id \}\)/);
  });

  test('the page sends deletions through the shared act flow and the new files carry no prose comments', () => {
    const page = readFileSync(PAGE_FILE, 'utf8');
    assert.match(page, /<DeleteAccountButton profile=\{current\} onOpen=\{\(kind\) => void act\(kind\)\} \/>/);
    assert.match(page, /timeoutMs: DELETE_REQUEST_TIMEOUT_MS/);
    const shared = readFileSync(SHARED_FILE, 'utf8');
    assert.doesNotMatch(shared, /'use client'/);
    assert.doesNotMatch(shared, /from 'react'/);
    assert.doesNotMatch(shared, /^import \{[^}]*\} from '\.\.\/\.\.\/\.\.\/_ui';$/m);
    for (const file of [ROUTE_FILE, SHARED_FILE, OPTIONS_FILE, PAGE_FILE, PARTS_FILE, TEST_FILE]) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /\/\*/, file);
      assert.doesNotMatch(source, /(^|\s)\/\/\s/m, file);
    }
  });

  test('the shared module texts are the ones the route sends', () => {
    assert.equal(shared.deleteAccountPath(USER_ID), `/api/users/${USER_ID}/delete`);
    assert.equal(shared.DELETE_EDGE_FUNCTION, 'admin-delete-account');
    assert.equal(shared.DELETE_EDGE_TIMEOUT_MS, 50000);
    assert.equal(shared.DELETE_REQUEST_TIMEOUT_MS, 65000);
  });
});
