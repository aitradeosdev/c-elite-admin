import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAppModule, loadUi } from './support/uiHarness.ts';
import type { UserRow, UsersView } from '../app/(dashboard)/users/model.ts';

type UsersModel = typeof import('../app/(dashboard)/users/model.ts');
type UrlStateModule = typeof import('../app/_ui/useUrlState.ts');
type PrintExportModule = typeof import('../app/lib/printExport.ts');

let model: UsersModel;
let url: UrlStateModule;
let printExport: PrintExportModule;

before(async () => {
  model = await loadAppModule<UsersModel>('(dashboard)/users/model.ts');
  url = await loadUi<UrlStateModule>('useUrlState.ts');
  printExport = await loadAppModule<PrintExportModule>('lib/printExport.ts');
});

const UUID = '3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';

function parse(query: string): UsersView {
  return model.USERS_URL.parse(new URLSearchParams(query));
}

function view(patch: Partial<UsersView> = {}): UsersView {
  return { ...parse(''), ...patch };
}

function row(patch: Partial<UserRow> = {}): UserRow {
  return {
    id: UUID,
    full_name: 'Ada Obi',
    username: 'ada',
    email: 'ada@example.com',
    phone: '08030000000',
    is_active: true,
    is_frozen: false,
    deleted_at: null,
    created_at: '2026-09-30T23:30:00.000Z',
    balance: 1500,
    trades: 3,
    avatar_url: null,
    ...patch,
  };
}

describe('USERS_URL', () => {
  test('an empty query is the default directory view', () => {
    assert.deepEqual(parse(''), {
      search: '',
      status: '',
      range: { from: null, to: null },
      sort: { key: 'created_at', dir: 'desc' },
      page: 1,
      id: null,
    });
  });

  test('a deep link restores every filter, the sort and the page', () => {
    assert.deepEqual(
      parse('search=%20ada%20&status=frozen&date_from=2026-09-01&date_to=2026-09-30&sort=balance&dir=asc&page=3'),
      {
        search: 'ada',
        status: 'frozen',
        range: { from: '2026-09-01', to: '2026-09-30' },
        sort: { key: 'balance', dir: 'asc' },
        page: 3,
        id: null,
      },
    );
  });

  test('values the directory does not support fall back to the defaults', () => {
    const parsed = parse('status=banned&sort=full_name&dir=asc&page=0&date_from=2026-09-30&date_to=2026-09-01');
    assert.equal(parsed.status, '');
    assert.deepEqual(parsed.sort, model.DEFAULT_SORT);
    assert.equal(parsed.page, 1);
    assert.deepEqual(parsed.range, { from: null, to: null });
  });

  test('the page is a whole number of at least 1', () => {
    assert.equal(parse('page=7').page, 7);
    assert.equal(parse('page=2.5').page, 1);
    assert.equal(parse('page=-4').page, 1);
    assert.equal(parse('page=abc').page, 1);
  });

  test('a sort key without a direction sorts descending', () => {
    assert.deepEqual(parse('sort=balance').sort, { key: 'balance', dir: 'desc' });
  });

  test('the search is trimmed, cut to 64 characters and trimmed again', () => {
    assert.equal(parse(`search=${'a'.repeat(63)}%20bcd`).search, 'a'.repeat(63));
    assert.equal(parse(`search=${'b'.repeat(80)}`).search.length, model.SEARCH_MAX);
  });

  test('user ids are lowercased and anything that is not a UUID is ignored', () => {
    assert.equal(parse(`id=${UUID.toUpperCase()}`).id, UUID);
    assert.equal(parse('id=not-a-user').id, null);
    assert.equal(parse('id=').id, null);
  });

  test('the default view writes nothing to the URL', () => {
    assert.deepEqual(model.USERS_URL.serialize(view()), {
      search: null,
      status: null,
      date_from: null,
      date_to: null,
      sort: null,
      dir: null,
      page: null,
      id: null,
    });
  });

  test('a filtered view round-trips through the URL unchanged', () => {
    const filtered = view({
      search: 'ada',
      status: 'deleted',
      range: { from: '2026-09-01', to: null },
      sort: { key: 'created_at', dir: 'asc' },
      page: 4,
    });
    const query = url.mergeUrlQuery('', model.USERS_URL.serialize(filtered));
    assert.equal(query, 'search=ada&status=deleted&date_from=2026-09-01&sort=created_at&dir=asc&page=4');
    assert.deepEqual(parse(query), filtered);
  });

  test('rewriting the current view strips an invalid ?id= and keeps the filters', () => {
    const location = { pathname: '/users', search: '?status=frozen&id=not-a-user', hash: '' };
    assert.deepEqual(url.planUrlWrite(model.USERS_URL, location, (current) => current), {
      query: 'status=frozen',
      url: '/users?status=frozen',
    });
  });

  test('a valid ?id= survives a rewrite so the redirect to the user can run', () => {
    const location = { pathname: '/users', search: `?id=${UUID}`, hash: '' };
    assert.equal(url.planUrlWrite(model.USERS_URL, location, (current) => current), null);
  });
});

describe('listQuery and exportQuery', () => {
  test('the default list query always names the sort and the page size', () => {
    assert.equal(model.listQuery(view()), 'sort=created_at&dir=desc&page=1&limit=50');
  });

  test('the list query carries every filter and never the user id', () => {
    const filtered = view({
      search: 'ada',
      status: 'frozen',
      range: { from: '2026-09-01', to: '2026-09-30' },
      sort: { key: 'balance', dir: 'asc' },
      page: 3,
      id: UUID,
    });
    assert.equal(
      model.listQuery(filtered),
      'search=ada&status=frozen&date_from=2026-09-01&date_to=2026-09-30&sort=balance&dir=asc&page=3&limit=50',
    );
  });

  test('the export query uses the export window, not the on-screen dates or page', () => {
    const filtered = view({
      search: 'ada',
      status: 'active',
      range: { from: '2026-09-01', to: '2026-09-30' },
      page: 4,
    });
    assert.equal(
      model.exportQuery(filtered, { from: '2026-10-01', to: '2026-10-02' }, 'csv'),
      'search=ada&status=active&date_from=2026-10-01&date_to=2026-10-02&sort=created_at&dir=desc&csv=1',
    );
    assert.equal(model.exportQuery(filtered, { from: null, to: null }, 'pdf'), 'search=ada&status=active&sort=created_at&dir=desc&pdf=1');
  });

  test('the Current filters export window is exactly the on-screen join dates', () => {
    const filtered = view({ status: 'active', range: { from: '2026-09-01', to: '2026-09-30' } });
    const option = model.exportFiltersFor(filtered);
    assert.deepEqual(option, {
      label: 'Current filters',
      description: 'Active users',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    assert.deepEqual(printExport.resolveExportRange('filters', option), {
      from: '2026-09-01',
      to: '2026-09-30',
      label: 'Current filters',
    });
    assert.deepEqual(printExport.resolveExportRange('filters', model.exportFiltersFor(view())), {
      from: null,
      to: null,
      label: 'Current filters',
    });
  });
});

describe('toListResult', () => {
  test('a body without a users array is unreadable', () => {
    assert.equal(model.toListResult({}, false), null);
    assert.equal(model.toListResult({ users: 'nobody' }, true), null);
  });

  test('keeps well-formed rows, clamps the total and reads the flags', () => {
    const result = model.toListResult({
      users: [row(), null, { name: 'no id' }, 7],
      total: '-5',
      sort_fallback: true,
      partial: { trades: 'Trade counts could not be loaded for some users.', summary: null },
    }, false);
    assert.ok(result);
    assert.deepEqual(result.users.map((user) => user.id), [UUID]);
    assert.equal(result.total, 0);
    assert.equal(result.sortFallback, true);
    assert.equal(result.tradesPartial, true);
    assert.equal(result.summary, null);
  });

  test('only a literal true counts as a sort fallback', () => {
    const result = model.toListResult({ users: [], total: 12, sort_fallback: 'true' }, false);
    assert.ok(result);
    assert.equal(result.sortFallback, false);
    assert.equal(result.tradesPartial, false);
    assert.equal(result.total, 12);
  });

  test('the summary is read only when it was asked for', () => {
    const body = {
      users: [],
      total: 0,
      summary: { date: '2026-10-02', total_users: 40, new_today: 'three', frozen: 2 },
      partial: { trades: null, summary: null },
    };
    assert.deepEqual(model.toListResult(body, true)?.summary, {
      data: { total_users: 40, new_today: null, frozen: 2 },
      error: null,
    });
    assert.equal(model.toListResult(body, false)?.summary, null);
  });

  test('a failed summary carries the server message', () => {
    const result = model.toListResult({
      users: [],
      summary: null,
      partial: { summary: 'User totals could not be loaded.' },
    }, true);
    assert.deepEqual(result?.summary, { data: null, error: 'User totals could not be loaded.' });
  });
});

describe('display helpers', () => {
  test('account status: deleted, then frozen, then active, else inactive', () => {
    assert.deepEqual(model.accountStatus(row({ deleted_at: '2026-09-01T00:00:00.000Z', is_frozen: true })), {
      label: 'Deleted',
      tone: 'neutral',
    });
    assert.deepEqual(model.accountStatus(row({ is_frozen: true })), { label: 'Frozen', tone: 'danger' });
    assert.deepEqual(model.accountStatus(row()), { label: 'Active', tone: 'success' });
    assert.deepEqual(model.accountStatus(row({ is_active: null })), { label: 'Inactive', tone: 'neutral' });
  });

  test('the joined line uses the Lagos calendar day and pluralises trades', () => {
    assert.equal(model.joinedMeta(row({ trades: null })), 'Joined 01 Oct 2026');
    assert.equal(model.joinedMeta(row({ trades: 1 })), 'Joined 01 Oct 2026 · 1 trade');
    assert.equal(model.joinedMeta(row({ trades: 1200 })), 'Joined 01 Oct 2026 · 1,200 trades');
  });

  test('ages read as time ago, and a missing date stays a dash', () => {
    assert.equal(model.ageText('2026-09-30T00:00:00.000Z', new Date('2026-10-02T00:00:00.000Z')), '2d ago');
    assert.equal(model.ageText(''), '—');
  });

  test('names, handles, trades and counts', () => {
    assert.equal(model.fullNameOf(row({ full_name: '   ' })), null);
    assert.equal(model.fullNameOf(row({ full_name: ' Ada Obi ' })), 'Ada Obi');
    assert.equal(model.handleOf(row()), '@ada');
    assert.equal(model.handleOf(row({ username: null })), null);
    assert.equal(model.tradesOf(row({ trades: Number.NaN })), null);
    assert.equal(model.tradesOf(row({ trades: 0 })), 0);
    assert.equal(model.countText(null), '—');
    assert.equal(model.countText(1234567), '1,234,567');
  });

  test('search text and status input are cleaned the way the URL stores them', () => {
    assert.equal(model.cleanSearch('  ada  '), 'ada');
    assert.equal(model.cleanSearch(`${'c'.repeat(63)} d`), 'c'.repeat(63));
    assert.equal(model.statusFilterOf('frozen'), 'frozen');
    assert.equal(model.statusFilterOf('banned'), '');
    assert.equal(model.statusFilterOf(''), '');
  });

  test('filters count as active from typed text or any URL filter', () => {
    assert.equal(model.isFiltered(view(), ''), false);
    assert.equal(model.isFiltered(view(), '  '), false);
    assert.equal(model.isFiltered(view(), ' x '), true);
    assert.equal(model.isFiltered(view({ status: 'deleted' }), ''), true);
    assert.equal(model.isFiltered(view({ range: { from: null, to: '2026-09-30' } }), ''), true);
    assert.equal(model.isFiltered(view({ sort: { key: 'balance', dir: 'asc' }, page: 3 }), ''), false);
  });

  test('the filter description names the status and the search', () => {
    assert.equal(model.describeFilters({ search: '', status: '' }), 'All users');
    assert.equal(model.describeFilters({ search: 'ada', status: 'frozen' }), 'Frozen users matching “ada”');
    assert.equal(model.describeFilters({ search: 'x', status: '' }), 'All users matching “x”');
  });

  test('error text prefers the message, then the error, then the fallback', () => {
    assert.equal(model.messageOf({ message: ' Nope ', error: 'Other' }, 'Fallback'), 'Nope');
    assert.equal(model.messageOf({ error: 'Bad request' }, 'Fallback'), 'Bad request');
    assert.equal(model.messageOf({ message: '  ' }, 'Fallback'), 'Fallback');
    assert.equal(model.messageOf(null, 'Fallback'), 'Fallback');
  });
});
