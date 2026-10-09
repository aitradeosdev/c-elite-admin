import { afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ElementType } from 'react';
import { classesOf, loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type { CatalogCard, CatalogCountry } from '../app/(dashboard)/cards/model.ts';

type Rules = typeof import('../app/(dashboard)/cards/catalogRules.ts');
type Model = typeof import('../app/(dashboard)/cards/model.ts');
type Countries = typeof import('../app/(dashboard)/cards/countries.ts');
type ApiClientModule = typeof import('../app/lib/apiClient.ts');

let rules: Rules;
let model: Model;
let countries: Countries;
let api: ApiClientModule;
let parts: Record<string, ElementType>;
const realFetch = globalThis.fetch;

before(async () => {
  rules = await loadAppModule<Rules>('(dashboard)/cards/catalogRules.ts');
  model = await loadAppModule<Model>('(dashboard)/cards/model.ts');
  countries = await loadAppModule<Countries>('(dashboard)/cards/countries.ts');
  api = await loadAppModule<ApiClientModule>('lib/apiClient.ts');
  parts = await loadAppModule<Record<string, ElementType>>('(dashboard)/cards/CatalogParts.tsx');
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const ID = {
  amazon: '11111111-1111-4111-8111-111111111111',
  apple: '22222222-2222-4222-8222-222222222222',
  steam: '33333333-3333-4333-8333-333333333333',
  sephora: '44444444-4444-4444-8444-444444444444',
};

const COUNTRY_ID = {
  us: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  gb: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ca: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};

function country(id: string, code: string, name: string, active = true, symbol = '$'): CatalogCountry {
  return { id, country_code: code, country_name: name, currency_symbol: symbol, is_active: active };
}

function brand(id: string, name: string, sortOrder: number, extra: Partial<CatalogCard> = {}): CatalogCard {
  return { id, name, logo_url: null, is_active: true, sort_order: sortOrder, created_at: null, countries: [], ...extra };
}

function failure(patch: Partial<ApiFailure>): ApiResult<never> {
  return {
    ok: false,
    error: {
      kind: 'http',
      status: 500,
      code: null,
      message: 'Failed',
      requestId: null,
      details: null,
      outcomeUnknown: false,
      ...patch,
    },
  };
}

function respond(status: number, body: unknown): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
}

describe('cards catalog rules: brand input', () => {
  test('a new brand is trimmed, active by default and placed at position 0 when no order is sent', () => {
    const checked = rules.checkCardCreate({ name: '  Amazon  ' });
    assert.deepEqual(checked, { ok: true, value: { name: 'Amazon', logo_url: null, is_active: true, sort_order: 0 } });
  });

  test('a new brand keeps the mobile request shape, including a sort order and an inactive flag', () => {
    const checked = rules.checkCardCreate({
      type: 'card', name: 'Steam', is_active: false, logo_url: 'https://cdn.example.com/steam.png', sort_order: 7,
    });
    assert.deepEqual(checked, {
      ok: true,
      value: { name: 'Steam', logo_url: 'https://cdn.example.com/steam.png', is_active: false, sort_order: 7 },
    });
  });

  test('brand names must be present and at most 80 characters', () => {
    assert.equal(rules.checkCardCreate({ name: '   ' }).ok, false);
    assert.equal(rules.checkCardCreate({ name: 'x'.repeat(81) }).ok, false);
    assert.equal(rules.checkCardCreate({ name: 'x'.repeat(80) }).ok, true);
  });

  test('logo addresses must be https and at most 500 characters; a blank logo means no logo', () => {
    assert.equal(rules.checkCardCreate({ name: 'A', logo_url: 'http://cdn.example.com/a.png' }).ok, false);
    assert.equal(rules.checkCardCreate({ name: 'A', logo_url: `https://${'a'.repeat(500)}` }).ok, false);
    const blank = rules.checkCardCreate({ name: 'A', logo_url: '   ' });
    assert.equal(blank.ok && blank.value.logo_url, null);
  });

  test('sort orders are truncated and clamped to 0..10000', () => {
    assert.equal(rules.clampSortOrder(12.9), 12);
    assert.equal(rules.clampSortOrder(-5), 0);
    assert.equal(rules.clampSortOrder(99999), 10000);
    assert.equal(rules.clampSortOrder('3'), 3);
    assert.equal(rules.clampSortOrder('abc'), 0);
    assert.equal(rules.clampSortOrder(undefined), 0);
  });

  test('flags accept booleans and their common string and number forms', () => {
    assert.equal(rules.readFlag('false', true), false);
    assert.equal(rules.readFlag('true', false), true);
    assert.equal(rules.readFlag(0, true), false);
    assert.equal(rules.readFlag(1, false), true);
    assert.equal(rules.readFlag(undefined, true), true);
    assert.equal(rules.readFlag(null, false), false);
  });

  test('a brand patch carries only the fields that were sent', () => {
    assert.deepEqual(rules.checkCardPatch({ type: 'card', id: ID.amazon }), { ok: true, value: {} });
    assert.deepEqual(rules.checkCardPatch({ is_active: false }), { ok: true, value: { is_active: false } });
    assert.deepEqual(
      rules.checkCardPatch({ name: ' Apple ', logo_url: null, sort_order: 4 }),
      { ok: true, value: { name: 'Apple', logo_url: null, sort_order: 4 } },
    );
    assert.equal(rules.checkCardPatch({ name: '' }).ok, false);
    assert.equal(rules.checkCardPatch({ logo_url: 'ftp://x' }).ok, false);
  });
});

describe('cards catalog rules: country input', () => {
  test('a new country needs a valid brand id, a 2-3 letter code, a name and a symbol', () => {
    const checked = rules.checkCountryCreate({
      card_id: ID.amazon.toUpperCase(), country_code: ' ng ', country_name: 'Nigeria', currency_symbol: '₦',
    });
    assert.deepEqual(checked, {
      ok: true,
      value: { card_id: ID.amazon, country_code: 'NG', country_name: 'Nigeria', currency_symbol: '₦', is_active: true },
    });
    assert.equal(rules.checkCountryCreate({ card_id: 'nope', country_code: 'NG', country_name: 'Nigeria', currency_symbol: '₦' }).ok, false);
    assert.equal(rules.checkCountryCreate({ card_id: ID.amazon, country_code: 'N1', country_name: 'Nigeria', currency_symbol: '₦' }).ok, false);
    assert.equal(rules.checkCountryCreate({ card_id: ID.amazon, country_code: 'NG', country_name: '', currency_symbol: '₦' }).ok, false);
    assert.equal(rules.checkCountryCreate({ card_id: ID.amazon, country_code: 'NG', country_name: 'Nigeria', currency_symbol: '' }).ok, false);
    assert.equal(rules.checkCountryCreate({ card_id: ID.amazon, country_code: 'NG', country_name: 'Nigeria', currency_symbol: '123456789' }).ok, false);
  });

  test('a country patch carries only the fields that were sent', () => {
    assert.deepEqual(rules.checkCountryPatch({ type: 'country', id: COUNTRY_ID.us, is_active: false }), {
      ok: true,
      value: { is_active: false },
    });
    assert.deepEqual(rules.checkCountryPatch({ currency_symbol: ' C$ ' }), { ok: true, value: { currency_symbol: 'C$' } });
    assert.equal(rules.checkCountryPatch({ country_code: 'toolong' }).ok, false);
  });

  test('ids are trimmed and lower-cased, and anything else is rejected', () => {
    assert.equal(rules.readId(` ${ID.amazon.toUpperCase()} `), ID.amazon);
    assert.equal(rules.readId('123'), null);
    assert.equal(rules.readId(42), null);
  });
});

describe('cards catalog rules: diffs, names and logos', () => {
  test('a diff keeps only the fields whose value actually changes', () => {
    const diff = rules.diffFields(
      { name: 'Amazon', logo_url: null, is_active: true, sort_order: 2 },
      { name: 'Amazon', logo_url: 'https://x.example/a.png', is_active: false, sort_order: undefined },
    );
    assert.deepEqual(diff.fields, ['logo_url', 'is_active']);
    assert.deepEqual(diff.before, { logo_url: null, is_active: true });
    assert.deepEqual(diff.after, { logo_url: 'https://x.example/a.png', is_active: false });
  });

  test('a diff treats a missing value as null', () => {
    const diff = rules.diffFields({ name: null }, { name: 'Steam' });
    assert.deepEqual(diff.before, { name: null });
    assert.deepEqual(rules.diffFields({ logo_url: null }, { logo_url: null }).fields, []);
  });

  test('brand names are compared without case or surrounding spaces', () => {
    const rows = [{ id: ID.amazon, name: 'Amazon' }, { id: ID.apple, name: null }];
    assert.equal(rules.sameBrandName(' amazon ', 'AMAZON'), true);
    assert.equal(rules.findBrandNamed(rows, 'AMAZON ')?.id, ID.amazon);
    assert.equal(rules.findBrandNamed(rows, 'Amazon', ID.amazon), null);
    assert.equal(rules.findBrandNamed(rows, '   '), null);
  });

  test('logo files must be png, jpg, jpeg or webp and at most 5 MB', () => {
    assert.equal(rules.logoFileProblem('logo.PNG', 1000), null);
    assert.equal(rules.logoFileProblem('logo.webp', 5 * 1024 * 1024), null);
    assert.match(rules.logoFileProblem('logo.gif', 1000) ?? '', /png, jpg, jpeg, webp/);
    assert.notEqual(rules.logoFileProblem('logo', 1000), null);
    assert.match(rules.logoFileProblem('logo.jpg', 5 * 1024 * 1024 + 1) ?? '', /5 MB/);
    assert.equal(rules.LOGO_ACCEPT, '.png,.jpg,.jpeg,.webp');
  });
});

describe('cards catalog rules: reorder requests', () => {
  test('the new order must be a non-empty list of at most 200 distinct valid ids', () => {
    assert.equal(rules.readReorderIds(undefined).ok, false);
    assert.equal(rules.readReorderIds([]).ok, false);
    assert.equal(rules.readReorderIds(['x']).ok, false);
    assert.equal(rules.readReorderIds(Array.from({ length: 201 }, () => ID.amazon)).ok, false);
    assert.equal(rules.readReorderIds([ID.amazon, ID.amazon.toUpperCase()]).ok, false);
    assert.deepEqual(rules.readReorderIds([ID.apple.toUpperCase(), ID.amazon]), { ok: true, ids: [ID.apple, ID.amazon] });
  });

  test('a plan writes only the brands whose position changes', () => {
    const rows = [
      { id: ID.amazon, sort_order: 0 },
      { id: ID.apple, sort_order: 1 },
      { id: ID.steam, sort_order: 2 },
    ];
    const plan = rules.planReorder(rows, [ID.apple, ID.amazon, ID.steam]);
    assert.deepEqual(plan.steps, [
      { id: ID.apple, from: 1, to: 0 },
      { id: ID.amazon, from: 0, to: 1 },
    ]);
    assert.deepEqual(plan.missing, []);
    assert.deepEqual(plan.extra, []);
  });

  test('a plan renumbers brands that shared a position', () => {
    const rows = [
      { id: ID.amazon, sort_order: 0 },
      { id: ID.apple, sort_order: 0 },
      { id: ID.steam, sort_order: null },
    ];
    const plan = rules.planReorder(rows, [ID.amazon, ID.apple, ID.steam]);
    assert.deepEqual(plan.steps, [
      { id: ID.apple, from: 0, to: 1 },
      { id: ID.steam, from: null, to: 2 },
    ]);
  });

  test('a plan reports brands that were added or are unknown since the list was loaded', () => {
    const rows = [
      { id: ID.amazon, sort_order: 0 },
      { id: ID.apple, sort_order: 1 },
      { id: ID.steam.toUpperCase(), sort_order: 2 },
    ];
    const plan = rules.planReorder(rows, [ID.apple, ID.amazon, ID.sephora]);
    assert.deepEqual(plan.missing, [ID.sephora]);
    assert.deepEqual(plan.extra, [ID.steam]);
  });
});

describe('cards catalog model: parsing and receipts', () => {
  test('the catalog keeps valid brands and countries, upper-cases codes and fills safe defaults', () => {
    const catalog = model.toCatalog({
      success: true,
      cards: [
        {
          id: ID.amazon, name: ' Amazon ', logo_url: '', is_active: true, sort_order: '3', created_at: '2026-01-01',
          countries: [
            { id: COUNTRY_ID.us, country_code: 'us', country_name: null, currency_symbol: null, is_active: true },
            { id: '', country_code: 'GB' },
            'junk',
          ],
        },
        { id: ID.apple, name: null, sort_order: null },
        { name: 'No id' },
        null,
      ],
    });
    assert.ok(catalog);
    assert.equal(catalog.cards.length, 2);
    const [amazon, apple] = catalog.cards;
    assert.equal(amazon.name, 'Amazon');
    assert.equal(amazon.logo_url, null);
    assert.equal(amazon.sort_order, 3);
    assert.deepEqual(amazon.countries, [
      { id: COUNTRY_ID.us, country_code: 'US', country_name: 'US', currency_symbol: '', is_active: true },
    ]);
    assert.equal(apple.name, '');
    assert.equal(apple.is_active, false);
    assert.equal(model.brandLabel(apple), 'Unnamed brand');
  });

  test('a body without a cards list is not a catalog', () => {
    assert.equal(model.toCatalog({ success: true }), null);
    assert.equal(model.toCatalog({ cards: {} }), null);
  });

  test('receipts read the saved rows and any audit warning the route sends', () => {
    assert.equal(model.toCreatedCard({ success: true }), null);
    const created = model.toCreatedCard({
      success: true, id: ID.steam, card: { id: ID.steam, name: 'Steam', is_active: false, sort_order: 4 },
      warning: 'The change was saved, but it could not be written to the audit log.',
    });
    assert.equal(created?.card?.sort_order, 4);
    assert.match(created?.warning ?? '', /audit log/);
    assert.equal(model.toCardReceipt({ success: true }).card, null);
    assert.equal(model.toCountryReceipt({ country: { id: COUNTRY_ID.gb, country_code: 'gb' } }).country?.country_code, 'GB');
    assert.equal(model.toUploadReceipt({ success: true }), null);
    assert.equal(model.toUploadReceipt({ url: 'https://cdn.example.com/x.png' })?.url, 'https://cdn.example.com/x.png');
  });
});

describe('cards catalog model: mutation outcomes', () => {
  test('outcomes separate saved, signed out, refused, unknown and retryable results', () => {
    assert.deepEqual(model.classifyMutation({ ok: true, data: 1, status: 200, requestId: null }), { kind: 'done', data: 1 });
    assert.deepEqual(model.classifyMutation(failure({ status: 401 })), { kind: 'expired' });
    for (const status of [403, 404, 409]) {
      assert.equal(model.classifyMutation(failure({ status, message: 'No' })).kind, 'refused');
    }
    assert.equal(model.classifyMutation(failure({ status: 500, outcomeUnknown: true })).kind, 'unknown');
    assert.equal(model.classifyMutation(failure({ kind: 'timeout', status: null, outcomeUnknown: true })).kind, 'unknown');
    assert.equal(model.classifyMutation(failure({ status: 400 })).kind, 'retry');
    assert.equal(model.classifyMutation(failure({ status: 500, code: 'INTERNAL_ERROR' })).kind, 'retry');
  });

  test('a stale reorder refused by the route rolls back instead of retrying', async () => {
    respond(409, {
      success: false, code: 'STATE_CONFLICT', error: 'The brand list has changed since you loaded it. Reload and try again.',
      message: 'The brand list has changed since you loaded it. Reload and try again.', request_id: 'req_1',
    });
    const result = await api.apiRequest('/api/cards', {
      method: 'PATCH', body: { type: 'reorder', ids: [ID.amazon] }, select: model.toReceipt,
    });
    const outcome = model.classifyMutation(result);
    assert.equal(outcome.kind, 'refused');
    assert.match(outcome.kind === 'refused' ? outcome.message : '', /brand list has changed/);
  });

  test('a reorder that fails without a code may have been saved, so the page refetches rather than rolls back', async () => {
    respond(502, { error: 'Bad gateway' });
    const result = await api.apiRequest('/api/cards', {
      method: 'PATCH', body: { type: 'reorder', ids: [ID.amazon] }, select: model.toReceipt,
    });
    assert.equal(model.classifyMutation(result).kind, 'unknown');
  });

  test('a saved reorder with an audit warning is still saved', async () => {
    respond(200, { success: true, changed: true, positions: [], audit_recorded: false, warning: 'Not audited.' });
    const result = await api.apiRequest('/api/cards', {
      method: 'PATCH', body: { type: 'reorder', ids: [ID.amazon] }, select: model.toReceipt,
    });
    const outcome = model.classifyMutation(result);
    assert.equal(outcome.kind, 'done');
    assert.equal(outcome.kind === 'done' ? outcome.data.warning : null, 'Not audited.');
  });
});

describe('cards catalog model: ordering', () => {
  const ids = [ID.amazon, ID.apple, ID.steam];

  test('moves go up, down, to the top or to the bottom, and edges are refused', () => {
    assert.deepEqual(model.moveId(ids, ID.apple, 'up'), [ID.apple, ID.amazon, ID.steam]);
    assert.deepEqual(model.moveId(ids, ID.apple, 'down'), [ID.amazon, ID.steam, ID.apple]);
    assert.deepEqual(model.moveId(ids, ID.steam, 'top'), [ID.steam, ID.amazon, ID.apple]);
    assert.deepEqual(model.moveId(ids, ID.amazon, 'bottom'), [ID.apple, ID.steam, ID.amazon]);
    assert.equal(model.moveId(ids, ID.amazon, 'up'), null);
    assert.equal(model.moveId(ids, ID.steam, 'bottom'), null);
    assert.equal(model.moveId(ids, ID.sephora, 'up'), null);
  });

  test('move availability matches the position', () => {
    assert.equal(model.canMove(0, 3, 'up'), false);
    assert.equal(model.canMove(0, 3, 'top'), false);
    assert.equal(model.canMove(0, 3, 'down'), true);
    assert.equal(model.canMove(2, 3, 'bottom'), false);
    assert.equal(model.canMove(1, 3, 'top'), true);
    assert.equal(model.canMove(5, 3, 'up'), false);
  });

  test('renumbering applies the new order and leaves unchanged brands untouched', () => {
    const amazon = brand(ID.amazon, 'Amazon', 0);
    const apple = brand(ID.apple, 'Apple', 1);
    const steam = brand(ID.steam, 'Steam', 2);
    const next = model.renumberCards([amazon, apple, steam], [ID.apple, ID.amazon, ID.steam]);
    assert.deepEqual(next.map((card) => [card.name, card.sort_order]), [['Apple', 0], ['Amazon', 1], ['Steam', 2]]);
    assert.equal(next[2], steam);
  });

  test('shared positions are detected, and new brands go after the highest position', () => {
    assert.equal(model.hasSharedPositions([brand(ID.amazon, 'A', 0), brand(ID.apple, 'B', 0)]), true);
    assert.equal(model.hasSharedPositions([brand(ID.amazon, 'A', 0), brand(ID.apple, 'B', 3)]), false);
    assert.equal(model.nextSortOrder([]), 0);
    assert.equal(model.nextSortOrder([brand(ID.amazon, 'A', 4), brand(ID.apple, 'B', 9)]), 10);
    assert.equal(model.nextSortOrder([brand(ID.amazon, 'A', 10000)]), 10000);
    assert.equal(model.positionText(0, 12), '1 of 12');
  });

  test('a created brand is appended once, after the others', () => {
    const list = [brand(ID.amazon, 'Amazon', 0), brand(ID.apple, 'Apple', 5)];
    const saved = { id: ID.steam, name: 'Steam', logo_url: null, is_active: false, sort_order: null };
    const next = model.appendCard(list, saved);
    assert.deepEqual(next.map((card) => [card.name, card.sort_order]), [['Amazon', 0], ['Apple', 5], ['Steam', 6]]);
    assert.equal(model.appendCard(next, { ...saved, name: 'Steam Wallet' }).length, 3);
  });
});

describe('cards catalog model: brand edits', () => {
  test('changes ignore surrounding spaces in the name', () => {
    const base = { name: 'Amazon', logo_url: null, is_active: true };
    assert.deepEqual(model.brandChanges(base, { ...base, name: ' Amazon ' }), []);
    assert.deepEqual(model.brandChanges(base, { ...base, is_active: false }), [
      { field: 'is_active', before: true, after: false },
    ]);
  });

  test('a rebase keeps another admin’s changes and flags fields both of you changed', () => {
    const base = { name: 'Amazon', logo_url: null, is_active: true };
    const mine = { name: 'Amazon US', logo_url: null, is_active: true };
    const theirs = { name: 'Amazon', logo_url: 'https://x.example/a.png', is_active: false };
    const merged = model.rebaseBrand(base, mine, theirs);
    assert.deepEqual(merged.draft, { name: 'Amazon US', logo_url: 'https://x.example/a.png', is_active: false });
    assert.deepEqual(merged.pending, [{ field: 'name', before: 'Amazon', after: 'Amazon US' }]);
    assert.deepEqual(merged.conflicts, []);

    const clash = model.rebaseBrand(base, mine, { ...base, name: 'Amazon Global' });
    assert.deepEqual(clash.conflicts, ['name']);
    assert.deepEqual(clash.pending, [{ field: 'name', before: 'Amazon Global', after: 'Amazon US' }]);
  });

  test('a patch sends only the reviewed fields', () => {
    assert.deepEqual(
      model.brandPatch(ID.amazon, [{ field: 'is_active', before: true, after: false }]),
      { type: 'card', id: ID.amazon, is_active: false },
    );
  });

  test('new brands start hidden from users', () => {
    assert.deepEqual(model.NEW_BRAND, { name: '', logo_url: null, is_active: false });
  });
});

describe('cards catalog model: consequences shown before confirming', () => {
  const us = country(COUNTRY_ID.us, 'US', 'United States');
  const gb = country(COUNTRY_ID.gb, 'GB', 'United Kingdom', true, '£');

  test('deactivating explains what happens to the Sell tab and the review queue', () => {
    const lines = model.statusConsequences(brand(ID.amazon, 'Amazon', 0, { countries: [us] }), false);
    assert.ok(lines.some((line) => line.includes('Sell tab')));
    assert.ok(lines.some((line) => line.includes('review queue')));
    assert.ok(lines.some((line) => line.includes('activating it again restores it')));
  });

  test('activating a brand with no available country warns that it cannot be sold yet', () => {
    const lines = model.statusConsequences(brand(ID.amazon, 'Amazon', 0, { is_active: false }), true);
    assert.ok(lines.some((line) => line.includes('cannot sell it until a country is made available')));
    const open = model.statusConsequences(brand(ID.amazon, 'Amazon', 0, { is_active: false, countries: [us, gb] }), true);
    assert.ok(open.some((line) => line.includes('2 available countries')));
  });

  test('renames warn about coupons only when the name really changes, and about the marketplace on any change', () => {
    const real = model.renameConsequences('Amazon', 'Amazon US');
    assert.ok(real.some((line) => line.includes('Coupons and giftbox rules')));
    assert.ok(real.some((line) => line.includes('marketplace feed')));
    const caseOnly = model.renameConsequences('amazon', 'Amazon');
    assert.ok(!caseOnly.some((line) => line.includes('Coupons')));
    assert.ok(caseOnly.some((line) => line.includes('marketplace feed')));
  });

  test('making the last available country unavailable on an active brand says it cannot be sold', () => {
    const amazon = brand(ID.amazon, 'Amazon', 0, { countries: [us, { ...gb, is_active: false }] });
    assert.ok(model.countryOffConsequences(amazon, us).some((line) => line.includes('last available country')));
    const hidden = { ...amazon, is_active: false };
    assert.ok(!model.countryOffConsequences(hidden, us).some((line) => line.includes('last available country')));
    assert.equal(model.availabilityAfter(amazon, COUNTRY_ID.us, false), 0);
  });

  test('removing a country with its own symbol warns that notifications fall back to $', () => {
    const amazon = brand(ID.amazon, 'Amazon', 0, { countries: [us, gb] });
    assert.ok(model.countryRemovalConsequences(amazon, gb).some((line) => line.includes('“$” instead of “£”')));
    assert.ok(!model.countryRemovalConsequences(amazon, us).some((line) => line.includes('instead of')));
    const unavailable = { ...gb, is_active: false };
    assert.ok(!model.countryRemovalConsequences(amazon, unavailable).some((line) => line.includes('can no longer choose')));
  });
});

describe('cards catalog model: search, stats and summaries', () => {
  const amazon = brand(ID.amazon, 'Amazon', 0, {
    countries: [country(COUNTRY_ID.us, 'US', 'United States'), country(COUNTRY_ID.ca, 'CI', 'Côte d’Ivoire', false)],
  });

  test('search matches brand names, country names without accents, and exact country codes', () => {
    assert.equal(model.matchesSearch(amazon, 'amaz'), true);
    assert.equal(model.matchesSearch(amazon, 'cote'), true);
    assert.equal(model.matchesSearch(amazon, 'ci'), true);
    assert.equal(model.matchesSearch(amazon, 'c i'), false);
    assert.equal(model.matchesSearch(amazon, ''), true);
    assert.equal(model.matchesSearch(amazon, 'steam'), false);
  });

  test('stats count active brands that users can see but cannot sell', () => {
    const stats = model.catalogStats([
      amazon,
      brand(ID.apple, 'Apple', 1),
      brand(ID.steam, 'Steam', 2, { is_active: false }),
    ]);
    assert.deepEqual(stats, { total: 3, active: 2, inactive: 1, needsCountry: 1 });
    assert.equal(model.needsCountry(brand(ID.steam, 'Steam', 2, { is_active: false })), false);
  });

  test('country summaries are sorted and shortened', () => {
    const summary = model.countrySummary([
      country(COUNTRY_ID.us, 'US', 'United States'),
      country(COUNTRY_ID.gb, 'GB', 'United Kingdom', false),
      country(COUNTRY_ID.ca, 'CA', 'Canada'),
    ], 2);
    assert.deepEqual(summary, { count: '3 countries', names: 'Canada, United Kingdom +1', available: 2, unavailable: 1 });
    assert.equal(model.countrySummary([]).count, 'No countries');
  });
});

describe('cards catalog countries', () => {
  test('lookups are case-insensitive and derive the flag and currency code from the country', () => {
    assert.equal(countries.isoCountry(' ng ')?.name, 'Nigeria');
    assert.equal(countries.isoCountry('ZZ'), null);
    assert.equal(countries.currencyCodeOf('us'), 'USD');
    assert.equal(countries.currencyCodeOf(null), null);
    assert.equal(countries.flagOf('ng'), '\u{1F1F3}\u{1F1EC}');
    assert.equal(countries.flagOf('USA'), '');
  });

  test('every listed country has a unique code, a symbol and a three-letter currency code', () => {
    const codes = countries.ISO_COUNTRIES.map((entry) => entry.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const entry of countries.ISO_COUNTRIES) {
      assert.match(entry.code, /^[A-Z]{2}$/);
      assert.match(entry.currency, /^[A-Z]{3}$/);
      assert.ok(entry.symbol.length > 0 && entry.symbol.length <= rules.CURRENCY_SYMBOL_MAX, entry.code);
    }
  });

  test('picker options leave out countries already on the brand and stay in name order', () => {
    const options = countries.countryOptions(['us', 'GB']);
    assert.ok(!options.some((option) => option.value === 'US' || option.value === 'GB'));
    const labels = options.map((option) => option.label);
    const sorted = labels.slice().sort((a, b) => new Intl.Collator('en', { sensitivity: 'base' }).compare(a, b));
    assert.deepEqual(labels, sorted);
    const nigeria = options.find((option) => option.value === 'NG');
    assert.equal(nigeria?.description, 'NG · NGN · ₦');
    assert.deepEqual(nigeria?.keywords, ['NG', 'NGN']);
  });
});

describe('cards catalog parts', () => {
  test('move controls are named, and unavailable directions stay focusable but disabled', () => {
    const html = render(createElement(parts.MoveControls, {
      card: { id: ID.amazon, name: 'Amazon' }, index: 0, total: 3, saving: false, locked: false, onMove: () => {},
    }));
    const buttons = tagsOf(html, 'button');
    assert.deepEqual(buttons.map((button) => button['aria-label']), ['Move Amazon up', 'Move Amazon down']);
    assert.equal(buttons[0]['aria-disabled'], 'true');
    assert.equal(buttons[1]['aria-disabled'], undefined);
    assert.ok(buttons.every((button) => button.disabled === undefined));
    assert.match(textOf(html), /^1$/);
  });

  test('move controls lock while an order is saving and announce it', () => {
    const html = render(createElement(parts.MoveControls, {
      card: { id: ID.apple, name: 'Apple' }, index: 1, total: 3, saving: true, locked: true, showPosition: false,
      onMove: () => {},
    }));
    const buttons = tagsOf(html, 'button');
    assert.ok(buttons.every((button) => button['aria-disabled'] === 'true'));
    assert.match(textOf(html), /Saving the new order/);
  });

  test('the brand status flags an active brand with no available country', () => {
    const flagged = render(createElement(parts.BrandStatus, { card: { is_active: true, countries: [] } }));
    assert.match(textOf(flagged), /Active No available country/);
    const hidden = render(createElement(parts.BrandStatus, { card: { is_active: false, countries: [] } }));
    assert.equal(textOf(hidden), 'Inactive');
  });

  test('brand logos use the kit avatar as a square tile with an initials fallback', () => {
    const html = render(createElement(parts.BrandMark, { src: null, name: 'Google Play' }));
    const tile = tagsOf(html, 'span')[0];
    assert.ok(classesOf(tile).includes('logoTile'));
    assert.match(textOf(html), /GP/);
    const image = render(createElement(parts.BrandMark, { src: 'https://cdn.example.com/a.png', name: 'Amazon' }));
    assert.equal(tagsOf(image, 'img')[0].alt, '');
  });

  test('the country cell summarises availability', () => {
    const html = render(createElement(parts.CountryCell, {
      card: { countries: [country(COUNTRY_ID.us, 'US', 'United States'), country(COUNTRY_ID.gb, 'GB', 'United Kingdom', false)] },
    }));
    assert.equal(textOf(html), '2 countries · 1 unavailable United Kingdom, United States');
  });
});
