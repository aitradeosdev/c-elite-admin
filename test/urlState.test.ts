import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement, type Context } from 'react';
import { loadUi, render } from './support/uiHarness.ts';
import type { SortState } from '../app/_ui/useTableSort.ts';
import type { UrlCodec, UrlSyncState } from '../app/_ui/useUrlState.ts';

type UrlStateModule = typeof import('../app/_ui/useUrlState.ts');

const nodeRequire = createRequire(import.meta.url);
const { SearchParamsContext } = nodeRequire('next/dist/shared/lib/hooks-client-context.shared-runtime') as {
  SearchParamsContext: Context<URLSearchParams | null>;
};

let url: UrlStateModule;

before(async () => {
  url = await loadUi<UrlStateModule>('useUrlState.ts');
});

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

const UUID = '3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';

describe('stringParam', () => {
  test('parses trimmed text and falls back to the default', () => {
    const codec = url.stringParam('search');
    assert.equal(codec.parse(params('')), '');
    assert.equal(codec.parse(params('search=%20%20ada%20%20')), 'ada');
    assert.equal(url.stringParam('view', 'all').parse(params('')), 'all');
    assert.equal(url.stringParam('view', { default: 'all' }).parse(params('view=%20')), 'all');
  });

  test('maxLength cuts after trimming and never leaves a trailing space', () => {
    const codec = url.stringParam('search', { maxLength: 5 });
    assert.equal(codec.parse(params('search=abcdefgh')), 'abcde');
    assert.equal(codec.parse(params('search=abcd%20efgh')), 'abcd');
    assert.deepEqual(codec.serialize('  abcdefgh '), { search: 'abcde' });
  });

  test('empty values and the default are omitted from the URL', () => {
    assert.deepEqual(url.stringParam('search').serialize(''), { search: null });
    assert.deepEqual(url.stringParam('search').serialize('   '), { search: null });
    assert.deepEqual(url.stringParam('view', 'all').serialize('all'), { view: null });
    assert.deepEqual(url.stringParam('search').serialize(' ada '), { search: 'ada' });
  });
});

describe('intParam', () => {
  const page = () => url.intParam('page', { min: 1, default: 1 });

  test('only whole numbers parse; anything else is the default', () => {
    for (const raw of ['', 'abc', '2.5', '1e3', '0x10', '99999999999999999999']) {
      assert.equal(page().parse(params(`page=${raw}`)), 1, `page=${raw}`);
    }
    assert.equal(page().parse(params('')), 1);
    assert.equal(page().parse(params('page=3')), 3);
    assert.equal(page().parse(params('page=%207%20')), 7);
  });

  test('values outside min and max are clamped', () => {
    const limit = url.intParam('limit', { min: 1, max: 200, default: 50 });
    assert.equal(limit.parse(params('limit=0')), 1);
    assert.equal(limit.parse(params('limit=-4')), 1);
    assert.equal(limit.parse(params('limit=500')), 200);
    assert.deepEqual(limit.serialize(500), { limit: '200' });
  });

  test('the default and non-finite values are omitted; fractions are truncated', () => {
    assert.deepEqual(page().serialize(1), { page: null });
    assert.deepEqual(page().serialize(0), { page: null });
    assert.deepEqual(page().serialize(2), { page: '2' });
    assert.deepEqual(page().serialize(2.9), { page: '2' });
    assert.deepEqual(page().serialize(Number.NaN), { page: null });
    assert.deepEqual(page().serialize(Number.POSITIVE_INFINITY), { page: null });
  });
});

describe('enumParam', () => {
  test('known values parse; unknown or missing values fall back', () => {
    const tab = url.enumParam('status', ['pending', 'disputed', 'approved'], 'pending');
    const parsed: 'pending' | 'disputed' | 'approved' = tab.parse(params('status=disputed'));
    assert.equal(parsed, 'disputed');
    assert.equal(tab.parse(params('status=hacked')), 'pending');
    assert.equal(tab.parse(params('')), 'pending');
    assert.equal(tab.parse(params('status=Disputed')), 'pending');
  });

  test('the fallback and unknown values are omitted from the URL', () => {
    const tab = url.enumParam('status', ['pending', 'disputed'], 'pending');
    assert.deepEqual(tab.serialize('pending'), { status: null });
    assert.deepEqual(tab.serialize('disputed'), { status: 'disputed' });
    assert.deepEqual(tab.serialize('other' as 'pending'), { status: null });
  });

  test('an empty or null fallback models an "all" filter', () => {
    const status = url.enumParam('status', ['active', 'frozen'], '');
    const value: 'active' | 'frozen' | '' = status.parse(params('status=frozen'));
    assert.equal(value, 'frozen');
    assert.equal(status.parse(params('status=gone')), '');
    assert.deepEqual(status.serialize(''), { status: null });
    const nullable = url.enumParam('kind', ['a', 'b'], null);
    assert.equal(nullable.parse(params('')), null);
    assert.deepEqual(nullable.serialize(null), { kind: null });
    assert.deepEqual(nullable.serialize('b'), { kind: 'b' });
  });
});

describe('uuidParam', () => {
  test('accepts a UUID in any case and stores it lowercased', () => {
    const id = url.uuidParam('id');
    assert.equal(id.parse(params(`id=${UUID.toUpperCase()}`)), UUID);
    assert.deepEqual(id.serialize(UUID.toUpperCase()), { id: UUID });
  });

  test('anything that is not a UUID is null and is dropped from the URL', () => {
    const id = url.uuidParam('id');
    assert.equal(id.parse(params('id=123')), null);
    assert.equal(id.parse(params('')), null);
    assert.deepEqual(id.serialize('not-a-uuid'), { id: null });
    assert.deepEqual(id.serialize(null), { id: null });
  });
});

describe('dateParam and dateRangeParam', () => {
  test('dateParam accepts only real Lagos calendar dates', () => {
    const day = url.dateParam('date_from');
    assert.equal(day.parse(params('date_from=2026-09-30')), '2026-09-30');
    for (const raw of ['2026-02-30', '2026-13-01', '30/09/2026', '2026-9-30', '']) {
      assert.equal(day.parse(params(`date_from=${raw}`)), null, raw);
    }
    assert.deepEqual(day.serialize('2026-02-30'), { date_from: null });
    assert.deepEqual(day.serialize('2026-10-01'), { date_from: '2026-10-01' });
  });

  test('dateRangeParam drops an inverted range and keeps one-sided ranges', () => {
    const range = url.dateRangeParam();
    assert.deepEqual(range.parse(params('date_from=2026-09-01&date_to=2026-09-30')), { from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual(range.parse(params('date_from=2026-09-30&date_to=2026-09-01')), { from: null, to: null });
    assert.deepEqual(range.parse(params('date_to=2026-09-30')), { from: null, to: '2026-09-30' });
    assert.deepEqual(range.serialize({ from: '2026-09-30', to: '2026-09-01' }), { date_from: null, date_to: null });
    assert.deepEqual(range.serialize({ from: '2026-09-01', to: null }), { date_from: '2026-09-01', date_to: null });
  });

  test('dateRangeParam supports custom parameter names', () => {
    const range = url.dateRangeParam('from', 'to');
    assert.deepEqual(range.parse(params('from=2026-01-01&to=2026-01-31')), { from: '2026-01-01', to: '2026-01-31' });
    assert.deepEqual(range.serialize({ from: null, to: '2026-01-31' }), { from: null, to: '2026-01-31' });
  });
});

describe('sortParam', () => {
  const DEFAULT_SORT: SortState = { key: 'created_at', dir: 'desc' };
  const sort = () => url.sortParam({ allowed: ['created_at', 'balance'], default: DEFAULT_SORT });

  test('a missing, unknown or default sort returns the default object itself', () => {
    assert.equal(sort().parse(params('')), DEFAULT_SORT);
    assert.equal(sort().parse(params('sort=hacked&dir=asc')), DEFAULT_SORT);
    assert.equal(sort().parse(params('sort=created_at&dir=desc')), DEFAULT_SORT);
  });

  test('an allowed key parses with its direction, defaulting a bad direction', () => {
    assert.deepEqual(sort().parse(params('sort=balance&dir=asc')), { key: 'balance', dir: 'asc' });
    assert.deepEqual(sort().parse(params('sort=balance')), { key: 'balance', dir: 'desc' });
    assert.deepEqual(sort().parse(params('sort=balance&dir=sideways')), { key: 'balance', dir: 'desc' });
    assert.deepEqual(sort().parse(params('sort=created_at&dir=asc')), { key: 'created_at', dir: 'asc' });
  });

  test('the default and unknown keys are omitted; other sorts write both params', () => {
    assert.deepEqual(sort().serialize({ key: 'created_at', dir: 'desc' }), { sort: null, dir: null });
    assert.deepEqual(sort().serialize({ key: 'balance', dir: 'asc' }), { sort: 'balance', dir: 'asc' });
    assert.deepEqual(sort().serialize({ key: 'hacked', dir: 'asc' }), { sort: null, dir: null });
  });

  test('custom parameter names and a null default', () => {
    const custom = url.sortParam({ allowed: ['amount'], default: null, sortName: 'order', dirName: 'direction' });
    const none: SortState | null = custom.parse(params(''));
    assert.equal(none, null);
    assert.deepEqual(custom.parse(params('order=amount&direction=asc')), { key: 'amount', dir: 'asc' });
    assert.deepEqual(custom.serialize(null), { order: null, direction: null });
    assert.deepEqual(custom.serialize({ key: 'amount', dir: 'desc' }), { order: 'amount', direction: 'desc' });
  });
});

describe('combineCodecs', () => {
  const FILTERS = () => url.combineCodecs({
    tab: url.enumParam('tab', ['pending', 'all'], 'pending'),
    search: url.stringParam('search', { maxLength: 64 }),
    range: url.dateRangeParam(),
    sort: url.sortParam({ allowed: ['created_at', 'amount'], default: { key: 'created_at', dir: 'desc' } }),
    page: url.intParam('page', { min: 1, default: 1 }),
    id: url.uuidParam('id'),
  });

  test('a page declares its whole state in one codec', () => {
    const value = FILTERS().parse(params(`tab=all&search=ada&date_from=2026-09-01&sort=amount&dir=asc&page=4&id=${UUID}`));
    const tab: 'pending' | 'all' = value.tab;
    const page: number = value.page;
    assert.equal(tab, 'all');
    assert.equal(page, 4);
    assert.deepEqual(value, {
      tab: 'all',
      search: 'ada',
      range: { from: '2026-09-01', to: null },
      sort: { key: 'amount', dir: 'asc' },
      page: 4,
      id: UUID,
    });
  });

  test('serialize merges every field and omits each default', () => {
    const codec = FILTERS();
    const defaults = codec.parse(params(''));
    assert.deepEqual(codec.serialize(defaults), {
      tab: null, search: null, date_from: null, date_to: null, sort: null, dir: null, page: null, id: null,
    });
    assert.equal(url.mergeUrlQuery('', codec.serialize(defaults)), '');
  });

  test('parse and serialize round-trip canonical values', () => {
    const codec = FILTERS();
    const query = `tab=all&search=ada+lovelace&date_from=2026-09-01&date_to=2026-09-30&sort=amount&dir=asc&page=2&id=${UUID}`;
    const value = codec.parse(params(query));
    assert.equal(url.mergeUrlQuery('', codec.serialize(value)), query);
    assert.deepEqual(codec.parse(params(url.mergeUrlQuery('', codec.serialize(value)))), value);
  });
});

describe('mergeUrlQuery', () => {
  test('params the codec does not own are preserved in place', () => {
    assert.equal(url.mergeUrlQuery('id=1&status=pending&utm=x', { status: null, page: '2' }), 'id=1&utm=x&page=2');
    assert.equal(url.mergeUrlQuery('a=1&b=2', { a: '3' }), 'a=3&b=2');
  });

  test('null and empty values delete; duplicates collapse to one value', () => {
    assert.equal(url.mergeUrlQuery('a=1&a=2&b=3', { a: '9', b: '' }), 'a=9');
    assert.equal(url.mergeUrlQuery('', { a: null }), '');
  });
});

describe('planUrlWrite', () => {
  const usersCodec = () => url.combineCodecs({
    status: url.enumParam('status', ['active', 'frozen'], ''),
    search: url.stringParam('search'),
    page: url.intParam('page', { min: 1, default: 1 }),
  });

  test('writes only owned params, omits defaults and keeps other params and the hash', () => {
    const plan = url.planUrlWrite(
      usersCodec(),
      { pathname: '/users', search: '?status=frozen&tab=x&page=3', hash: '#list' },
      { status: '', search: 'ada lovelace', page: 1 },
    );
    assert.deepEqual(plan, { query: 'tab=x&search=ada+lovelace', url: '/users?tab=x&search=ada+lovelace#list' });
  });

  test('a functional update receives the state parsed from the current URL', () => {
    let seen: unknown = null;
    const plan = url.planUrlWrite(usersCodec(), { pathname: '/users', search: '?status=frozen&page=3', hash: '' }, (previous) => {
      seen = previous;
      return { ...previous, page: previous.page + 1 };
    });
    assert.deepEqual(seen, { status: 'frozen', search: '', page: 3 });
    assert.equal(plan?.url, '/users?status=frozen&page=4');
  });

  test('a write that changes nothing is skipped', () => {
    assert.equal(url.planUrlWrite(usersCodec(), { pathname: '/users', search: '?status=frozen', hash: '' }, (v) => v), null);
    assert.equal(url.planUrlWrite(usersCodec(), { pathname: '/users', search: '', hash: '' }, { status: '', search: '', page: 1 }), null);
  });

  test('clearing every param leaves a clean path with the hash', () => {
    const plan = url.planUrlWrite(usersCodec(), { pathname: '/users', search: '?page=2', hash: '#top' }, (v) => ({ ...v, page: 1 }));
    assert.deepEqual(plan, { query: '', url: '/users#top' });
  });

  test('an identity update canonicalises a hand-edited URL', () => {
    const plan = url.planUrlWrite(usersCodec(), { pathname: '/users', search: '?status=bogus&page=0&search=%20x%20', hash: '' }, (v) => v);
    assert.equal(plan?.url, '/users?search=x');
  });
});

describe('pending write reconciliation', () => {
  const start = (query: string): UrlSyncState => ({ observed: query, intended: query, pending: [] });

  test('an unchanged observation returns the same state object', () => {
    const state = start('a=1');
    assert.equal(url.reconcileUrlSync(state, 'a=1'), state);
  });

  test('the echo of our own write is consumed without changing what the page intends', () => {
    const written = url.recordUrlWrite(start(''), 'page=2');
    assert.deepEqual(written, { observed: '', intended: 'page=2', pending: ['page=2'] });
    assert.deepEqual(url.reconcileUrlSync(written, 'page=2'), { observed: 'page=2', intended: 'page=2', pending: [] });
  });

  test('an older echo arriving after a newer write never rolls the state back', () => {
    let state = url.recordUrlWrite(start(''), 'page=2');
    state = url.recordUrlWrite(state, 'page=3');
    state = url.reconcileUrlSync(state, 'page=2');
    assert.equal(state.intended, 'page=3');
    assert.deepEqual(state.pending, ['page=3']);
    state = url.reconcileUrlSync(state, 'page=3');
    assert.deepEqual(state, { observed: 'page=3', intended: 'page=3', pending: [] });
  });

  test('batched echoes that skip intermediate writes drain the queue', () => {
    let state = url.recordUrlWrite(start(''), 'page=2');
    state = url.recordUrlWrite(state, 'page=3');
    state = url.reconcileUrlSync(state, 'page=3');
    assert.deepEqual(state.pending, []);
  });

  test('an outside navigation is adopted and clears the queue', () => {
    const state = url.reconcileUrlSync(url.recordUrlWrite(start(''), 'page=2'), `id=${UUID}`);
    assert.deepEqual(state, { observed: `id=${UUID}`, intended: `id=${UUID}`, pending: [] });
  });

  test('writing back to what the router shows leaves no stale entry, and a late echo heals on the next one', () => {
    let state = url.recordUrlWrite(start('tab=a'), 'tab=b');
    state = url.recordUrlWrite(state, 'tab=a');
    assert.deepEqual(state, { observed: 'tab=a', intended: 'tab=a', pending: [] });
    state = url.reconcileUrlSync(state, 'tab=b');
    assert.equal(state.intended, 'tab=b');
    state = url.reconcileUrlSync(state, 'tab=a');
    assert.deepEqual(state, { observed: 'tab=a', intended: 'tab=a', pending: [] });
  });

  test('a repeated query drains up to its last occurrence', () => {
    let state = url.recordUrlWrite(start(''), 'q=a');
    state = url.recordUrlWrite(state, 'q=b');
    state = url.recordUrlWrite(state, 'q=a');
    assert.deepEqual(url.reconcileUrlSync(state, 'q=a').pending, []);
  });

  test('a page that canonicalises on every change settles after one write with a lagging router', () => {
    const codec = url.combineCodecs({ page: url.intParam('page', { min: 1, default: 1 }) });
    const location = { pathname: '/x', search: '?page=0', hash: '' };
    let sync = start('page=0');
    const routerQueue: string[] = [];
    let writes = 0;
    const set = (next: (previous: { page: number }) => { page: number }) => {
      const plan = url.planUrlWrite(codec, location, next);
      if (!plan) return;
      writes += 1;
      location.search = plan.query ? `?${plan.query}` : '';
      routerQueue.push(plan.query);
      sync = url.recordUrlWrite(sync, plan.query);
    };
    for (let round = 0; round < 5; round += 1) {
      set((value) => value);
      if (round === 0) continue;
      const echo = routerQueue.shift();
      if (echo !== undefined) sync = url.reconcileUrlSync(sync, echo);
      assert.equal(sync.intended, '', `round ${round} must keep the canonical state`);
    }
    for (const echo of routerQueue.splice(0)) sync = url.reconcileUrlSync(sync, echo);
    assert.equal(writes, 1);
    assert.deepEqual(sync, { observed: '', intended: '', pending: [] });
    assert.deepEqual(codec.parse(params(sync.intended)), { page: 1 });
  });
});

describe('useUrlState (server render)', () => {
  const CODEC = (): UrlCodec<{ tab: 'pending' | 'disputed'; page: number }> => url.combineCodecs({
    tab: url.enumParam('status', ['pending', 'disputed'], 'pending'),
    page: url.intParam('page', { min: 1, default: 1 }),
  });

  function probe(query: string | null): { html: string; set: ((next: { tab: 'pending' | 'disputed'; page: number }) => void) | null } {
    const codec = CODEC();
    let captured: ((next: { tab: 'pending' | 'disputed'; page: number }) => void) | null = null;
    function Probe() {
      const [value, set] = url.useUrlState(codec);
      captured = set;
      return createElement('output', null, `${value.tab}|${value.page}`);
    }
    const tree = query === null
      ? createElement(Probe)
      : createElement(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, createElement(Probe));
    return { html: render(tree), set: captured };
  }

  test('the first render parses the request URL, so server and client agree', () => {
    assert.equal(probe('status=disputed&page=3&utm=x').html, '<output>disputed|3</output>');
  });

  test('invalid params render as their defaults', () => {
    assert.equal(probe('status=bogus&page=-2').html, '<output>pending|1</output>');
  });

  test('without a router context the defaults render', () => {
    assert.equal(probe(null).html, '<output>pending|1</output>');
  });

  test('the setter is inert on the server', () => {
    const { set } = probe('status=disputed');
    assert.ok(set);
    assert.doesNotThrow(() => set?.({ tab: 'pending', page: 2 }));
  });
});
