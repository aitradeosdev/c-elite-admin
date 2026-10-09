import { afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type {
  ActivityUser, DeviceRow, LoadedDetail, SessionRow, TransactionRow, UserDetail, WithdrawalRow,
} from '../app/(dashboard)/user-activity-monitor/model.ts';

type RulesModule = typeof import('../app/(dashboard)/user-activity-monitor/rules.ts');
type ModelModule = typeof import('../app/(dashboard)/user-activity-monitor/model.ts');
type PartsModule = typeof import('../app/(dashboard)/user-activity-monitor/ActivityParts.tsx');
type ConfirmModule = typeof import('../app/(dashboard)/user-activity-monitor/confirmOptions.tsx');
type ApiClientModule = typeof import('../app/lib/apiClient.ts');

let rules: RulesModule;
let model: ModelModule;
let parts: PartsModule;
let options: ConfirmModule;
let api: ApiClientModule;
const realFetch = globalThis.fetch;

before(async () => {
  rules = await loadAppModule<RulesModule>('(dashboard)/user-activity-monitor/rules.ts');
  model = await loadAppModule<ModelModule>('(dashboard)/user-activity-monitor/model.ts');
  parts = await loadAppModule<PartsModule>('(dashboard)/user-activity-monitor/ActivityParts.tsx');
  options = await loadAppModule<ConfirmModule>('(dashboard)/user-activity-monitor/confirmOptions.tsx');
  api = await loadAppModule<ApiClientModule>('lib/apiClient.ts');
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const OWNED_DIR = fileURLToPath(new URL('../app/(dashboard)/user-activity-monitor/', import.meta.url));
const API_DIR = fileURLToPath(new URL('../app/api/user-activity-monitor/', import.meta.url));
const LIST_ROUTE = join(API_DIR, 'route.ts');
const DETAIL_ROUTE = join(API_DIR, '[id]', 'route.ts');
const TERMINATE_ROUTE = join(API_DIR, '[id]', 'terminate', 'route.ts');
const DASHBOARD_LIB = fileURLToPath(new URL('../app/lib/dashboard.ts', import.meta.url));

const USER_ID = '3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const WITHDRAWAL_ID = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';
const TRANSACTION_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NOW = Date.parse('2026-10-03T13:05:00Z');

function user(patch: Partial<UserDetail> = {}): UserDetail {
  return {
    id: USER_ID,
    username: 'ada',
    full_name: 'Ada Obi',
    email: 'ada@example.com',
    phone: '+2348012345678',
    last_active_at: '2026-10-03T13:04:30Z',
    is_frozen: false,
    freeze_reason: null,
    is_active: true,
    created_at: '2026-01-15T09:00:00Z',
    deleted_at: null,
    is_online: true,
    country: 'NG',
    ...patch,
  };
}

function session(id: string, patch: Partial<SessionRow> = {}): SessionRow {
  return {
    id,
    device_model: 'iPhone 14',
    os_version: 'ios 17.2',
    app_version: '1.4.0',
    ip_address: '102.89.1.2',
    created_at: '2026-10-02T08:00:00Z',
    ended_at: null,
    ended_by: null,
    ...patch,
  };
}

function device(id: string, patch: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id,
    device_model: 'Infinix X6711',
    os_version: 'android 13',
    app_version: '1.3.9',
    ip_address: '105.112.4.9',
    is_new_device: false,
    last_seen_at: '2026-10-03T12:00:00Z',
    login_count: 4,
    created_at: '2026-06-01T10:00:00Z',
    ...patch,
  };
}

const WITHDRAWAL: WithdrawalRow = {
  id: WITHDRAWAL_ID,
  amount: 50000,
  bank_name: 'Access Bank',
  account_name: 'ADA OBI',
  status: 'success',
  created_at: '2026-10-01T11:00:00Z',
};

const TRANSACTION: TransactionRow = {
  id: TRANSACTION_ID,
  type: 'card_sale',
  amount: '12500.50',
  status: 'completed',
  created_at: '2026-09-30T16:30:00Z',
};

function detail(patch: Partial<LoadedDetail> = {}): LoadedDetail {
  return {
    user: user(),
    sessions: [session('s1'), session('s2', { ended_at: '2026-10-01T10:00:00Z', ended_by: 'admin' })],
    devices: [device('d1')],
    transactions: [TRANSACTION],
    withdrawals: [WITHDRAWAL],
    openSessionCount: 1,
    partial: { sessions: null, devices: null, transactions: null, withdrawals: null },
    ...patch,
  };
}

function listRow(patch: Partial<ActivityUser> = {}): ActivityUser {
  const { country: _country, ...base } = user();
  return { ...base, ...patch };
}

function respond(handler: () => Response | Promise<Response>): void {
  globalThis.fetch = (async () => handler()) as typeof fetch;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function failed(code: string, message: string, status: number): Response {
  return json({ success: false, error: message, code, message, request_id: 'req_fail' }, status);
}

async function terminate() {
  return model.classifyTerminate(
    await api.apiRequest(`/api/user-activity-monitor/${USER_ID}/terminate`, {
      method: 'POST',
      body: { reason: 'Lost or stolen device' },
      select: model.toTerminateResult,
    }),
  );
}

describe('activity filters, sorting and windows', () => {
  test('parses the filter strictly, defaulting a blank value to all users', () => {
    assert.equal(rules.parseActivityFilter(null), 'all');
    assert.equal(rules.parseActivityFilter(''), 'all');
    assert.equal(rules.parseActivityFilter('online'), 'online');
    assert.equal(rules.parseActivityFilter(' Frozen '), 'frozen');
    assert.equal(rules.parseActivityFilter('recent'), 'recent');
    assert.equal(rules.parseActivityFilter('deleted'), 'deleted');
    assert.equal(rules.parseActivityFilter('balance'), null);
    assert.deepEqual([...rules.FILTER_VALUES], ['all', 'online', 'recent', 'frozen', 'deleted']);
    assert.equal(rules.filterLabel('online'), 'Active in the last 5 minutes');
    assert.equal(rules.filterLabel('recent'), 'Active in the last 24 hours');
  });

  test('falls back to last seen for an unknown sort key and only sorts ascending when asked', () => {
    assert.deepEqual(rules.parseActivitySort('created_at', 'asc'), { key: 'created_at', ascending: true });
    assert.deepEqual(rules.parseActivitySort('balance', 'asc'), { key: 'last_active_at', ascending: true });
    assert.deepEqual(rules.parseActivitySort(null, null), { key: 'last_active_at', ascending: false });
    assert.deepEqual(rules.parseActivitySort('last_active_at', 'sideways'), { key: 'last_active_at', ascending: false });
  });

  test('derives the online and 24 hour windows from one clock reading', () => {
    const windows = rules.activityWindows(NOW);
    assert.equal(windows.onlineFrom, new Date(NOW - 300_000).toISOString());
    assert.equal(windows.recentFrom, new Date(NOW - 24 * 3600 * 1000).toISOString());
    assert.equal(rules.ONLINE_WINDOW_SECONDS, 300);
    assert.equal(rules.ONLINE_WINDOW_MINUTES, 5);
  });

  test('treats a heartbeat inside the 5 minute window as online', () => {
    assert.equal(rules.isOnlineAt(new Date(NOW - 300_000).toISOString(), NOW), true);
    assert.equal(rules.isOnlineAt(new Date(NOW - 90_000).toISOString(), NOW), true);
    assert.equal(rules.isOnlineAt(new Date(NOW - 301_000).toISOString(), NOW), false);
    assert.equal(rules.isOnlineAt(null, NOW), false);
    assert.equal(rules.isOnlineAt('not a date', NOW), false);
  });

  test('counts users online over the same window as the dashboard', () => {
    const source = readFileSync(DASHBOARD_LIB, 'utf8');
    const match = source.match(/const ONLINE_WINDOW_MS = ([\d\s*_]+);/);
    assert.ok(match, 'the dashboard online window constant could not be found');
    const ms = match[1].split('*').reduce((product, part) => product * Number(part.trim().replace(/_/g, '')), 1);
    assert.equal(rules.ONLINE_WINDOW_SECONDS * 1000, ms);
    assert.match(source, /p_online_from: new Date\(Date\.now\(\) - ONLINE_WINDOW_MS\)/);
  });

  test('labels each activity window by what it counts', () => {
    assert.equal(rules.ONLINE_LABEL, 'Active in the last 5 minutes');
    assert.equal(rules.RECENT_LABEL, 'Active in the last 24 hours');
    assert.deepEqual(rules.ACTIVITY_FILTERS.map((option) => option.label), [
      'All users', 'Active in the last 5 minutes', 'Active in the last 24 hours', 'Frozen', 'Deleted',
    ]);
  });

  test('turns each filter into the matching database constraints', () => {
    const windows = rules.activityWindows(NOW);
    assert.deepEqual(rules.filterConstraints('all', windows), []);
    assert.deepEqual(rules.filterConstraints('online', windows), [
      { kind: 'since', column: 'last_active_at', value: windows.onlineFrom },
    ]);
    assert.deepEqual(rules.filterConstraints('recent', windows), [
      { kind: 'since', column: 'last_active_at', value: windows.recentFrom },
    ]);
    assert.deepEqual(rules.filterConstraints('frozen', windows), [
      { kind: 'missing', column: 'deleted_at' },
      { kind: 'is', column: 'is_frozen', value: true },
    ]);
    assert.deepEqual(rules.filterConstraints('deleted', windows), [{ kind: 'present', column: 'deleted_at' }]);
  });

  test('keeps the mobile online=1 flag working on its own and alongside a filter', () => {
    const windows = rules.activityWindows(NOW);
    const online = { kind: 'since', column: 'last_active_at', value: windows.onlineFrom };
    assert.deepEqual(rules.filterConstraints('all', windows, true), [online]);
    assert.deepEqual(rules.filterConstraints('online', windows, true), [online]);
    assert.deepEqual(rules.filterConstraints('frozen', windows, true), [
      { kind: 'missing', column: 'deleted_at' },
      { kind: 'is', column: 'is_frozen', value: true },
      online,
    ]);
  });

  test('searches name, username, email and phone, or matches a user ID exactly', () => {
    assert.deepEqual(rules.userSearchClause(''), { term: '', clause: null });
    assert.deepEqual(rules.userSearchClause(null), { term: '', clause: null });
    assert.deepEqual(rules.userSearchClause('ada'), {
      term: 'ada',
      clause: 'username.ilike.%ada%,full_name.ilike.%ada%,email.ilike.%ada%,phone.ilike.%ada%',
    });
    assert.deepEqual(rules.userSearchClause(USER_ID.toUpperCase()), { term: USER_ID.toUpperCase(), clause: `id.eq.${USER_ID}` });
  });

  test('strips the characters that could break out of the search filter', () => {
    const plan = rules.userSearchClause('ada),id.eq.(x');
    assert.ok(!/[(),]/.test(plan.term), plan.term);
    assert.equal(rules.userSearchClause('x'.repeat(200)).term.length, rules.SEARCH_MAX);
  });

  test('accepts a missing reason for the mobile app but validates one that is sent', () => {
    assert.deepEqual(rules.checkTerminateReason(undefined), { ok: true, reason: null });
    assert.deepEqual(rules.checkTerminateReason(null), { ok: true, reason: null });
    assert.deepEqual(rules.checkTerminateReason('   '), { ok: true, reason: null });
    assert.deepEqual(rules.checkTerminateReason('  Lost phone  '), { ok: true, reason: 'Lost phone' });
    assert.equal(rules.checkTerminateReason(42).ok, false);
    assert.equal(rules.checkTerminateReason('x'.repeat(rules.REASON_MAX + 1)).ok, false);
    assert.equal(rules.checkTerminateReason('x'.repeat(rules.REASON_MAX)).ok, true);
  });
});

describe('reading the activity responses', () => {
  test('maps the list and keeps a failed count as unknown rather than zero', () => {
    const list = model.toListResult({
      success: true,
      users: [
        { id: USER_ID, username: 'ada', full_name: 'Ada Obi', email: 'ada@example.com', last_active_at: '2026-10-03T13:04:30Z', is_frozen: false, is_active: true, is_online: true },
        { id: 'x2', username: null, is_frozen: true, is_online: null },
        { username: 'no-id' },
        'junk',
      ],
      total: '42',
      online_count: 7,
      recent_count: null,
    });
    assert.ok(list);
    assert.equal(list.users.length, 2);
    assert.equal(list.users[0].is_online, true);
    assert.equal(list.users[1].is_online, false);
    assert.equal(list.users[1].is_frozen, true);
    assert.equal(list.users[1].deleted_at, null);
    assert.equal(list.total, 42);
    assert.equal(list.onlineCount, 7);
    assert.equal(list.recentCount, null);
    assert.equal(model.toListResult({ success: true }), null);
  });

  test('reads a missing user as not found and rejects a malformed detail', () => {
    const missing = model.toDetailResult({ user: null, sessions: [], transactions: [], withdrawals: [] });
    assert.ok(missing);
    assert.equal(missing.user, null);
    assert.equal(model.isLoaded(missing), false);
    assert.deepEqual(missing.devices, []);
    assert.equal(model.toDetailResult({ sessions: [] }), null);
    assert.equal(model.toDetailResult({ user: null }), null);
    assert.equal(model.toDetailResult({ user: { username: 'no id' }, sessions: [] }), null);
  });

  test('maps a full detail, including partial failures and the open session count', () => {
    const parsed = model.toDetailResult({
      user: { ...user(), country: ' NG ' },
      sessions: [{ id: 's1', device_model: 'iPhone 14', ended_at: null, ended_by: null, session_id: 'secret-ish' }],
      devices: [{ id: 'd1', device_model: 'Pixel', login_count: '3', is_new_device: true }],
      transactions: [{ id: TRANSACTION_ID, type: 'card_sale', amount: 100, status: 'completed' }],
      withdrawals: [{ id: WITHDRAWAL_ID, amount: '2500.00', status: 'processing' }],
      open_session_count: 3,
      partial: { sessions: null, devices: 'Devices could not be loaded.', transactions: '', withdrawals: null },
    });
    assert.ok(parsed && model.isLoaded(parsed));
    assert.equal(parsed.user.country, 'NG');
    assert.equal(parsed.sessions[0].device_model, 'iPhone 14');
    assert.equal(parsed.devices[0].login_count, 3);
    assert.equal(parsed.devices[0].is_new_device, true);
    assert.equal(parsed.withdrawals[0].amount, '2500.00');
    assert.equal(parsed.openSessionCount, 3);
    assert.deepEqual(parsed.partial, {
      sessions: null,
      devices: 'Devices could not be loaded.',
      transactions: null,
      withdrawals: null,
    });
  });

  test('reads the terminate result from both the new and the old response shape', () => {
    assert.deepEqual(model.toTerminateResult({ success: true, ended_sessions: 3, warning: ' Not audited. ' }), {
      endedSessions: 3,
      warning: 'Not audited.',
    });
    assert.deepEqual(model.toTerminateResult({ success: true }), { endedSessions: null, warning: null });
  });
});

describe('classifying a sign-out request', () => {
  test('a success reports how many open sessions were ended', async () => {
    respond(() => json({ success: true, request_id: 'req_ok', ended_sessions: 2, open_sessions: 0 }, 200));
    assert.deepEqual(await terminate(), { kind: 'done', endedSessions: 2, warning: null, requestId: 'req_ok' });
  });

  test('a definite server refusal keeps the dialog open with its own message', async () => {
    respond(() => failed('INTERNAL_ERROR', 'The sessions could not be ended. Nothing was changed.', 500));
    assert.deepEqual(await terminate(), {
      kind: 'retry',
      message: 'The sessions could not be ended. Nothing was changed.',
    });
  });

  test('an unreadable or missing response says retrying is safe', async () => {
    respond(() => new Response('<html>bad gateway</html>', { status: 502 }));
    assert.deepEqual(await terminate(), { kind: 'retry', message: model.UNKNOWN_TERMINATE });
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    assert.deepEqual(await terminate(), { kind: 'retry', message: model.UNKNOWN_TERMINATE });
  });

  test('a missing user or lost access closes the dialog, and an expired session stays quiet', async () => {
    respond(() => failed('RESOURCE_NOT_FOUND', 'User not found.', 404));
    assert.deepEqual(await terminate(), { kind: 'refused', message: 'User not found.', status: 404 });
    respond(() => failed('PERMISSION_DENIED', 'This action is restricted to super administrators.', 403));
    assert.deepEqual(await terminate(), {
      kind: 'refused',
      message: 'This action is restricted to super administrators.',
      status: 403,
    });
    respond(() => failed('AUTH_REQUIRED', 'Your session has expired. Sign in again.', 401));
    assert.deepEqual(await terminate(), { kind: 'expired' });
  });
});

describe('activity view helpers', () => {
  test('names a user by full name, then handle, then email', () => {
    assert.equal(model.displayName(user()), 'Ada Obi');
    assert.equal(model.displayName(user({ full_name: null })), '@ada');
    assert.equal(model.displayName(user({ full_name: null, username: null })), 'ada@example.com');
    assert.equal(model.displayName(user({ full_name: null, username: null, email: null })), 'Unnamed user');
    assert.equal(model.userSummary(user()), 'Ada Obi (@ada)');
    assert.equal(model.shortName(user()), '@ada');
    assert.equal(model.contactLine(user()), '@ada · ada@example.com');
    assert.equal(model.contactLine(user({ full_name: null })), 'ada@example.com');
    assert.equal(model.contactLine(user({ full_name: null, username: null })), undefined);
  });

  test('keeps the deleted and frozen states ahead of presence', () => {
    assert.equal(model.accountState(user({ deleted_at: '2026-09-01T00:00:00Z', is_frozen: true })), 'deleted');
    assert.equal(model.accountState(user({ is_frozen: true })), 'frozen');
    assert.equal(model.accountState(user({ is_active: false })), 'inactive');
    assert.equal(model.accountState(user({ is_active: null })), 'inactive');
    assert.equal(model.accountState(user()), 'active');
    assert.equal(model.presenceOf(user()).label, 'Online');
    assert.equal(model.presenceOf(user({ is_online: false })).label, 'Offline');
    assert.equal(model.presenceOf(user({ is_online: false, last_active_at: null })).label, 'Never active');
  });

  test('says who ended a session and when', () => {
    const now = new Date(NOW);
    assert.deepEqual(model.sessionState(session('a'), now), { key: 'open', label: 'Open', tone: 'success' });
    assert.equal(
      model.sessionState(session('b', { ended_at: '2026-10-03T12:05:00Z', ended_by: 'admin' }), now).label,
      'Ended by an admin 1h ago',
    );
    assert.equal(
      model.sessionState(session('c', { ended_at: '2026-10-03T13:00:00Z', ended_by: 'user' }), now).label,
      'Signed out 5m ago',
    );
    assert.equal(model.sessionState(session('d', { ended_at: '2026-10-01T13:05:00Z' }), now).label, 'Ended 2d ago');
  });

  test('describes a device from whatever was recorded', () => {
    assert.equal(model.deviceLabel(session('a')), 'iPhone 14 · ios 17.2 · v1.4.0');
    assert.equal(model.deviceLabel(session('b', { os_version: null, app_version: null })), 'iPhone 14');
    assert.equal(
      model.deviceLabel(session('c', { device_model: null, os_version: null, app_version: null })),
      'Unknown device',
    );
    assert.equal(model.typeLabel('card_sale'), 'Card sale');
    assert.equal(model.typeLabel(null), 'Type not recorded');
  });

  test('counts open sessions exactly when it can and says so when it cannot', () => {
    assert.deepEqual(model.openSessionSummary(detail()), { total: 1, exact: true, known: true });
    assert.equal(model.openSessionsText(model.openSessionSummary(detail({ openSessionCount: 0, sessions: [] }))), 'None');
    assert.deepEqual(model.openSessionSummary(detail({ openSessionCount: 0 })), { total: 1, exact: true, known: true });
    const guessed = model.openSessionSummary(detail({ openSessionCount: null }));
    assert.deepEqual(guessed, { total: 1, exact: false, known: true });
    assert.equal(model.openSessionsText(guessed), 'At least 1');
    assert.equal(
      model.openSessionsText(model.openSessionSummary(detail({ openSessionCount: null, sessions: [] }))),
      'None in the latest 30',
    );
    const unknown = model.openSessionSummary(detail({
      openSessionCount: null,
      sessions: [],
      partial: { sessions: 'Sessions could not be loaded.', devices: null, transactions: null, withdrawals: null },
    }));
    assert.equal(model.openSessionsText(unknown), 'Could not be checked');
  });

  test('builds the list request from the view, leaving the open user out of it', () => {
    const view = model.ACTIVITY_URL.parse(new URLSearchParams());
    assert.deepEqual(view, { filter: 'all', search: '', sort: { key: 'last_active_at', dir: 'desc' }, page: 1, id: null });
    assert.equal(model.listQuery(view), 'sort=last_active_at&dir=desc&page=1&limit=25');
    assert.equal(
      model.listQuery({ ...view, filter: 'online', search: 'ada obi', page: 3, sort: { key: 'created_at', dir: 'asc' } }),
      'filter=online&search=ada+obi&sort=created_at&dir=asc&page=3&limit=25',
    );
    const opened = { ...view, id: USER_ID };
    assert.equal(model.listQuery(opened), model.listQuery(view));
  });

  test('round-trips the view through the URL and drops anything invalid', () => {
    const parsed = model.ACTIVITY_URL.parse(
      new URLSearchParams(`filter=frozen&search=ada&page=2&sort=created_at&dir=asc&id=${USER_ID.toUpperCase()}`),
    );
    assert.deepEqual(parsed, {
      filter: 'frozen',
      search: 'ada',
      sort: { key: 'created_at', dir: 'asc' },
      page: 2,
      id: USER_ID,
    });
    const junk = model.ACTIVITY_URL.parse(new URLSearchParams('filter=everyone&page=-4&sort=balance&id=nope'));
    assert.deepEqual(junk, { filter: 'all', search: '', sort: { key: 'last_active_at', dir: 'desc' }, page: 1, id: null });
    assert.deepEqual(model.ACTIVITY_URL.serialize(junk), {
      filter: null,
      search: null,
      sort: null,
      dir: null,
      page: null,
      id: null,
    });
  });

  test('keeps rows on screen while paging or searching, but not across filters', () => {
    assert.equal(model.sameFilter('page=1', 'page=2&search=ada'), true);
    assert.equal(model.sameFilter('filter=online&page=1', 'filter=online&page=4'), true);
    assert.equal(model.sameFilter('page=1', 'filter=frozen&page=1'), false);
  });

  test('explains an empty list in terms of the filter that produced it', () => {
    const base = model.ACTIVITY_URL.parse(new URLSearchParams());
    assert.equal(model.emptyCopy(base).title, 'No users yet');
    assert.equal(model.emptyCopy({ ...base, filter: 'online' }).title, 'Nobody was active in the last 5 minutes');
    assert.match(model.emptyCopy({ ...base, filter: 'online' }).hint, /seen in the last 5 minutes counts as online/);
    assert.doesNotMatch(model.emptyCopy({ ...base, filter: 'online' }).hint, /seconds/);
    assert.equal(model.emptyCopy({ ...base, filter: 'recent' }).title, 'Nobody was active in the last 24 hours');
    assert.equal(model.emptyCopy({ ...base, filter: 'frozen' }).title, 'No frozen accounts');
    assert.equal(model.emptyCopy({ ...base, filter: 'deleted' }).title, 'No deleted accounts');
    assert.equal(model.emptyCopy({ ...base, filter: 'frozen', search: 'ada' }).title, 'No users match this search');
    assert.equal(model.describeView({ filter: 'frozen', search: 'ada' }), 'Frozen · search “ada”');
    assert.equal(model.describeView({ filter: 'online', search: '' }), 'Active in the last 5 minutes');
    assert.equal(model.isFiltered(base), false);
    assert.equal(model.isFiltered(base, ' a '), true);
    assert.equal(model.isFiltered({ ...base, filter: 'deleted' }), true);
  });
});

describe('live updates', () => {
  test('a confirmation outranks the drawer, which outranks a manual pause', () => {
    assert.equal(model.pauseReason({ manual: true, dialog: true, drawer: true }), 'dialog');
    assert.equal(model.pauseReason({ manual: true, dialog: false, drawer: true }), 'drawer');
    assert.equal(model.pauseReason({ manual: true, dialog: false, drawer: false }), 'manual');
    assert.equal(model.pauseReason({ manual: false, dialog: false, drawer: false }), null);
  });

  test('always shows when the list was last updated, in Lagos time', () => {
    assert.deepEqual(model.liveState({ paused: null, failing: false, updatedAt: NOW }), {
      tone: 'success',
      label: 'Live',
      detail: 'Updated 14:05 WAT · refreshes every 30 seconds',
    });
    assert.deepEqual(model.liveState({ paused: 'drawer', failing: false, updatedAt: NOW }), {
      tone: 'neutral',
      label: 'Paused while a user is open',
      detail: 'Updated 14:05 WAT',
    });
    assert.equal(model.liveState({ paused: 'dialog', failing: true, updatedAt: NOW }).label, 'Paused while a confirmation is open');
    assert.equal(
      model.liveState({ paused: 'manual', failing: false, updatedAt: NOW }).detail,
      'Updated 14:05 WAT · resume to see new activity',
    );
    assert.deepEqual(model.liveState({ paused: null, failing: true, updatedAt: NOW }), {
      tone: 'warning',
      label: 'Reconnecting',
      detail: 'Updated 14:05 WAT · retrying every 30 seconds',
    });
    assert.deepEqual(model.liveState({ paused: null, failing: false, updatedAt: null }), {
      tone: 'neutral',
      label: 'Connecting',
      detail: null,
    });
  });
});

describe('the sign-out confirmation', () => {
  test('names the user and every open session, and requires a reason', () => {
    const confirm = options.terminateConfirm(detail());
    assert.equal(confirm.tone, 'danger');
    assert.equal(confirm.title, 'Sign @ada out everywhere?');
    assert.deepEqual(confirm.details?.map((row) => row.label), [
      'User', 'Email', 'Last seen', 'Open sessions', 'Devices on record',
    ]);
    assert.equal(confirm.details?.[0].value, 'Ada Obi (@ada)');
    assert.match(String(confirm.details?.[2].value), /^Online · .+ WAT · .+ ago$/);
    assert.equal(confirm.details?.[4].value, '1 device');
    const open = textOf(render(confirm.details?.[3].value as ReactElement));
    assert.match(open, /^1 iPhone 14 · ios 17\.2 · v1\.4\.0 since .*WAT$/);
    assert.equal(confirm.reason?.required, true);
    assert.deepEqual(confirm.reason?.presets, options.TERMINATE_REASONS);
    assert.equal(confirm.reason?.maxLength, rules.REASON_MAX);
    assert.equal(confirm.confirmLabel, 'Sign out everywhere');
    assert.equal(confirm.pendingLabel, options.TERMINATE_PENDING);
    assert.ok(confirm.consequences?.some((line) => /token expires/.test(line)));
    assert.ok(!confirm.consequences?.some((line) => /deleted/.test(line)));
  });

  test('lists five sessions and counts the rest, including older ones beyond the latest page', () => {
    const sessions = Array.from({ length: 7 }, (_, index) => session(`s${index}`, { device_model: `Phone ${index}` }));
    const confirm = options.terminateConfirm(detail({ sessions, openSessionCount: 9 }));
    const html = render(confirm.details?.[3].value as ReactElement);
    assert.equal(tagsOf(html, 'li').length, 6);
    assert.match(textOf(html), /^9 Phone 0/);
    assert.match(textOf(html), /and 4 older open sessions$/);
  });

  test('is honest when nothing is open, a count failed or the account is deleted', () => {
    const none = options.terminateConfirm(detail({ sessions: [], openSessionCount: 0, devices: [] }));
    assert.match(String(none.message), /No session is recorded as open/);
    assert.equal(textOf(render(createElement('div', null, none.details?.[3].value))), 'None');
    assert.equal(none.details?.[4].value, 'None recorded');
    const unknown = options.terminateConfirm(detail({
      sessions: [],
      openSessionCount: null,
      partial: { sessions: 'Sessions could not be loaded.', devices: 'Devices could not be loaded.', transactions: null, withdrawals: null },
    }));
    assert.equal(textOf(render(createElement('div', null, unknown.details?.[3].value))), 'Could not be checked');
    assert.equal(unknown.details?.[4].value, 'Could not be checked');
    const many = options.terminateConfirm(detail({ devices: Array.from({ length: 20 }, (_, i) => device(`d${i}`)) }));
    assert.equal(many.details?.[4].value, '20 or more devices');
    const deleted = options.terminateConfirm(detail({ user: user({ deleted_at: '2026-09-01T00:00:00Z', is_online: false }) }));
    assert.ok(deleted.consequences?.some((line) => /This account is deleted/.test(line)));
    assert.match(String(deleted.details?.[2].value), /ago$/);
  });

  test('reports the result in plain words', () => {
    assert.equal(options.terminateSuccess(user(), 2), '@ada was signed out everywhere. 2 open sessions were ended.');
    assert.equal(options.terminateSuccess(user(), 1), '@ada was signed out everywhere. 1 open session was ended.');
    assert.equal(options.terminateSuccess(user(), 0), '@ada was signed out everywhere. No session was open.');
    assert.equal(options.terminateSuccess(user(), null), '@ada was signed out everywhere.');
  });
});

describe('rendered activity parts', () => {
  test('keeps the frozen and deleted badges next to presence', () => {
    assert.equal(textOf(render(createElement(parts.StatusCell, { user: listRow() }))), 'Online');
    assert.equal(
      textOf(render(createElement(parts.StatusCell, { user: listRow({ is_frozen: true, is_online: false }) }))),
      'Offline Frozen',
    );
    assert.equal(
      textOf(render(createElement(parts.StatusCell, { user: listRow({ deleted_at: '2026-09-01T00:00:00Z' }) }))),
      'Deleted',
    );
    assert.equal(textOf(render(createElement(parts.StatusCell, { user: listRow({ is_active: false }) }))), 'Online Inactive');
    assert.equal(textOf(render(createElement(parts.SeenCell, { value: null }))), 'Never active');
  });

  test('shows the live state with its update time', () => {
    const html = render(createElement(parts.LiveStatus, {
      state: { tone: 'success', label: 'Live', detail: 'Updated 14:05 WAT · refreshes every 30 seconds' },
    }));
    assert.equal(textOf(html), 'Live Updated 14:05 WAT · refreshes every 30 seconds');
  });

  test('renders every section of the drawer with links to the full records', () => {
    const html = render(createElement(parts.DetailBody, { detail: detail() }));
    const text = textOf(html);
    const headings = [...html.matchAll(/<h3\b[^>]*>([^<]*)<\/h3>/g)].map((match) => match[1]);
    assert.deepEqual(headings, ['Presence', 'Account', 'Sessions', 'Devices', 'Recent withdrawals', 'Recent transactions']);
    assert.match(text, /Open sessions 1/);
    assert.match(text, /Ended by an admin/);
    assert.match(text, /IP 102\.89\.1\.2/);
    assert.match(text, /4 sign-ins/);
    assert.match(text, /Card sale/);
    const hrefs = tagsOf(html, 'a').map((attrs) => attrs.href);
    assert.ok(hrefs.includes(`/users/${USER_ID}`));
    assert.ok(hrefs.includes(`/withdrawals?id=${WITHDRAWAL_ID}`));
    assert.ok(hrefs.includes(`/transactions-overview?id=${TRANSACTION_ID}`));
  });

  test('says when a section failed instead of claiming it is empty', () => {
    const html = render(createElement(parts.DetailBody, {
      detail: detail({
        sessions: [],
        devices: [],
        openSessionCount: null,
        partial: {
          sessions: 'Sessions could not be loaded.',
          devices: 'Devices could not be loaded.',
          transactions: null,
          withdrawals: null,
        },
      }),
    }));
    const text = textOf(html);
    assert.match(text, /Sessions could not be loaded\. Use Refresh to try again\./);
    assert.match(text, /Devices could not be loaded\. Use Refresh to try again\./);
    assert.doesNotMatch(text, /No sign-ins recorded/);
    assert.match(text, /Open sessions Could not be checked/);
  });

  test('calls out a frozen or deleted account at the top of the drawer', () => {
    const frozen = textOf(render(createElement(parts.DetailBody, {
      detail: detail({ user: user({ is_frozen: true, freeze_reason: 'Chargeback under review' }) }),
    })));
    assert.match(frozen, /^Account frozen Chargeback under review/);
    const deleted = textOf(render(createElement(parts.DetailBody, {
      detail: detail({ user: user({ deleted_at: '2026-09-01T00:00:00Z' }) }),
    })));
    assert.match(deleted, /^Account deleted Deleted /);
    const skeleton = render(createElement(parts.DetailSkeleton));
    assert.match(skeleton, /role="status"[^>]*>Loading user activity</);
  });
});

function ownedSources(): string[] {
  return [
    ...readdirSync(OWNED_DIR).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => join(OWNED_DIR, name)),
    LIST_ROUTE,
    DETAIL_ROUTE,
    TERMINATE_ROUTE,
  ];
}

describe('hard rules and the route contract', () => {
  test('no prose comments, literal colours, stacking numbers or static inline styles', () => {
    for (const file of ownedSources()) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/\/\*|(^|[^:])\/\/(?!\/)/m.test(text), `${file} has a comment`);
      assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(text), `${file} has a literal colour`);
      assert.ok(!/z-?index/i.test(text), `${file} sets a stacking order`);
      assert.ok(!/style=\{\{/.test(text), `${file} has a static inline style`);
    }
    const css = readFileSync(join(OWNED_DIR, 'page.module.css'), 'utf8');
    assert.ok(!/\/\*/.test(css));
    assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|z-index/i.test(css));
  });

  test('every route stays super-admin only and never answers a permission failure with 401', () => {
    for (const file of [LIST_ROUTE, DETAIL_ROUTE, TERMINATE_ROUTE]) {
      const source = readFileSync(file, 'utf8');
      assert.match(source, /requireSuperAdmin\(\)/, file);
      assert.doesNotMatch(source, /requireAdmin\(|user_activity\.|users\.sessions/, file);
      assert.doesNotMatch(source, /NextResponse\.json|status: 401/, file);
      assert.match(source, /from '[./]+lib\/api'/, file);
    }
  });

  test('the list route keeps every parameter and key the mobile app relies on', () => {
    const source = readFileSync(LIST_ROUTE, 'utf8');
    for (const param of ["'online'", "'search'", "'page'", "'limit'"]) assert.ok(source.includes(`params.get(${param})`), param);
    for (const key of ['users,', 'total:', 'online_count:', 'recent_count:', 'page:', 'limit:', 'online_window_seconds:']) {
      assert.ok(source.includes(key), key);
    }
    assert.match(source, /online_window_seconds: ONLINE_WINDOW_SECONDS,/);
    assert.match(source, /countActiveSince\(windows\.onlineFrom\)/);
    for (const column of ['username', 'full_name', 'email', 'phone', 'last_active_at', 'is_frozen', 'is_active']) {
      assert.match(source, new RegExp(`LIST_COLUMNS =[^;]*\\b${column}\\b`), column);
    }
    assert.match(source, /is_online: isOnlineAt/);
  });

  test('the detail route keeps every key and column the mobile app reads', () => {
    const source = readFileSync(DETAIL_ROUTE, 'utf8');
    for (const key of ['user:', 'sessions:', 'transactions:', 'withdrawals:']) assert.ok(source.includes(key), key);
    for (const column of ['session_id', 'ip_address', 'device_model', 'os_version', 'app_version', 'device_fingerprint', 'ended_at']) {
      assert.match(source, new RegExp(`SESSION_COLUMNS =[^;]*\\b${column}\\b`), column);
    }
    for (const column of ['country', 'last_active_at', 'is_frozen', 'is_active', 'created_at']) {
      assert.match(source, new RegExp(`USER_COLUMNS =[^;]*\\b${column}\\b`), column);
    }
    assert.match(source, /TRANSACTION_COLUMNS = 'id, type, amount, status/);
    assert.match(source, /WITHDRAWAL_COLUMNS = 'id, amount, bank_name, account_name, status/);
  });

  test('ending sessions is audited with the reason and its outcome either way', () => {
    const source = readFileSync(TERMINATE_ROUTE, 'utf8');
    assert.match(source, /action: 'TERMINATE_USER_SESSIONS'/);
    assert.match(source, /entity: 'users'/);
    assert.match(source, /reason: reason\.reason/);
    assert.match(source, /result: 'failure'/);
    assert.match(source, /result: 'success'/);
    assert.match(source, /rpc\('terminate_user_sessions'/);
    assert.match(source, /req\.json\(\)\.catch/);
  });

  test('a database refusal of the admin is a 403, not a retryable server error', () => {
    const source = readFileSync(TERMINATE_ROUTE, 'utf8');
    const refusal = source.indexOf('/not authorized/i');
    assert.ok(refusal > 0);
    assert.ok(source.indexOf("fail('PERMISSION_DENIED'", refusal) > refusal);
    assert.ok(source.indexOf("fail('PERMISSION_DENIED'", refusal) < source.indexOf("fail('INTERNAL_ERROR', 'The sessions", refusal));
  });

  test('the page is a client module on the shared kit with no private mobile copy', () => {
    const page = readFileSync(join(OWNED_DIR, 'page.tsx'), 'utf8');
    const partsSource = readFileSync(join(OWNED_DIR, 'ActivityParts.tsx'), 'utf8');
    assert.ok(page.startsWith("'use client';"));
    assert.ok(partsSource.startsWith("'use client';"));
    assert.doesNotMatch(page, /useIsMobile|ActivityMobile|OnlineDot|toLocaleString\(\)|\bfetch\(/);
    assert.match(page, /useUrlState\(ACTIVITY_URL\)/);
    assert.match(page, /pollMs: paused \? 0 : POLL_MS/);
    assert.match(page, /isSuperAdmin && loadedDetail/);
    assert.match(page, /ResponsiveView/);
  });

  test('the page names every activity count by the window it covers', () => {
    const page = readFileSync(join(OWNED_DIR, 'page.tsx'), 'utf8');
    assert.match(page, /label: ONLINE_LABEL,/);
    assert.match(page, /label: RECENT_LABEL,/);
    assert.match(page, /active in the last \$\{ONLINE_WINDOW_MINUTES\} minutes/);
    assert.doesNotMatch(page, /'Online now'|'Last 24 hours'|ONLINE_WINDOW_SECONDS/);
    const confirmSource = readFileSync(join(OWNED_DIR, 'confirmOptions.tsx'), 'utf8');
    assert.doesNotMatch(confirmSource, /'Online now'/);
  });
});
