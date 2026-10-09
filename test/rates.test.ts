import { afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ElementType, type ReactElement } from 'react';
import { classesOf, loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiResult } from '../app/lib/apiClient.ts';
import type {
  Draft, PendingChange, RateRow, RatesSnapshot, SaveResponse, AddResponse,
} from '../app/(dashboard)/rates/model.ts';
import type { CardRow, CountryRow, StoredDenomination, TypeRow } from '../app/(dashboard)/rates/rateRules.ts';

type Rules = typeof import('../app/(dashboard)/rates/rateRules.ts');
type Model = typeof import('../app/(dashboard)/rates/model.ts');
type Options = typeof import('../app/(dashboard)/rates/confirmOptions.tsx');
type ApiClientModule = typeof import('../app/lib/apiClient.ts');

let rules: Rules;
let model: Model;
let options: Options;
let api: ApiClientModule;
let parts: Record<string, ElementType>;
let list: Record<string, ElementType>;
const realFetch = globalThis.fetch;

before(async () => {
  rules = await loadAppModule<Rules>('(dashboard)/rates/rateRules.ts');
  model = await loadAppModule<Model>('(dashboard)/rates/model.ts');
  options = await loadAppModule<Options>('(dashboard)/rates/confirmOptions.tsx');
  api = await loadAppModule<ApiClientModule>('lib/apiClient.ts');
  parts = await loadAppModule<Record<string, ElementType>>('(dashboard)/rates/RateParts.tsx');
  list = await loadAppModule<Record<string, ElementType>>('(dashboard)/rates/RateList.tsx');
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const AMAZON = '0a000000-0000-4000-8000-000000000001';
const APPLE = '0a000000-0000-4000-8000-000000000002';
const US = '0b000000-0000-4000-8000-000000000001';
const GB = '0b000000-0000-4000-8000-000000000002';
const UK_APPLE = '0b000000-0000-4000-8000-000000000003';
const PHYSICAL = '0c000000-0000-4000-8000-000000000001';
const ECODE = '0c000000-0000-4000-8000-000000000002';
const D1 = '0d000000-0000-4000-8000-000000000001';
const D2 = '0d000000-0000-4000-8000-000000000002';
const D3 = '0d000000-0000-4000-8000-000000000003';
const D4 = '0d000000-0000-4000-8000-000000000004';

interface RangeSeed {
  id: string;
  range_label: string;
  min_value: number;
  max_value: number;
  rate_naira: number | null;
  is_active: boolean;
}

function ranges(overrides: Partial<Record<string, Partial<RangeSeed>>> = {}, omit: string[] = []): RangeSeed[] {
  const base: RangeSeed[] = [
    { id: D1, range_label: '$25–$99', min_value: 25, max_value: 99, rate_naira: 1500, is_active: true },
    { id: D2, range_label: '$100–$500', min_value: 100, max_value: 500, rate_naira: 1550, is_active: true },
    { id: D3, range_label: '$501–$1000', min_value: 501, max_value: 1000, rate_naira: 0, is_active: false },
  ];
  return base.filter((range) => !omit.includes(range.id)).map((range) => ({ ...range, ...(overrides[range.id] ?? {}) }));
}

function treeBody(overrides: Partial<Record<string, Partial<RangeSeed>>> = {}, omit: string[] = []) {
  const appleRange = { id: D4, range_label: '£10–£50', min_value: 10, max_value: 50, rate_naira: 1900, is_active: true, ...(overrides[D4] ?? {}) };
  return {
    success: true,
    request_id: 'req_rates',
    cards: [
      {
        id: AMAZON,
        name: 'Amazon',
        logo_url: null,
        is_active: true,
        activeRates: 2,
        countries: [
          {
            id: US,
            country_code: 'US',
            country_name: 'United States',
            currency_symbol: '$',
            card_types: [{ id: PHYSICAL, name: 'Physical', denominations: ranges(overrides, omit) }],
          },
          { id: GB, country_code: 'GB', country_name: 'United Kingdom', currency_symbol: '£', card_types: [] },
        ],
      },
      {
        id: APPLE,
        name: 'Apple',
        logo_url: 'https://cdn.example.com/apple.png',
        is_active: true,
        activeRates: 1,
        countries: [
          {
            id: UK_APPLE,
            country_code: 'GB',
            country_name: 'United Kingdom',
            currency_symbol: '£',
            card_types: [{ id: ECODE, name: 'E-code', denominations: omit.includes(D4) ? [] : [appleRange] }],
          },
        ],
      },
    ],
  };
}

function snapshot(overrides: Partial<Record<string, Partial<RangeSeed>>> = {}, omit: string[] = []): RatesSnapshot {
  const parsed = model.toRatesSnapshot(treeBody(overrides, omit));
  assert.ok(parsed);
  return parsed;
}

function row(snap: RatesSnapshot, id: string): RateRow {
  const found = snap.rows[id];
  assert.ok(found, `row ${id} exists`);
  return found;
}

function respond(handler: (init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => handler(init ?? {})) as typeof fetch;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function patch(): Promise<ApiResult<SaveResponse>> {
  return api.apiRequest('/api/rates', { method: 'PATCH', body: { changes: [] }, select: model.toSaveResponse });
}

function post(): Promise<ApiResult<AddResponse>> {
  return api.apiRequest('/api/rates', { method: 'POST', body: {}, select: model.toAddResponse });
}

function pendingFor(snap: RatesSnapshot, draft: Draft): PendingChange[] {
  const reviewed = model.reviewDraft(snap, draft);
  assert.deepEqual(reviewed.errors, {});
  return reviewed.changes;
}

describe('rate input parsing and validation', () => {
  test('parseDecimal accepts plain, grouped and naira-prefixed numbers and nothing ambiguous', () => {
    assert.equal(rules.parseDecimal('1500'), 1500);
    assert.equal(rules.parseDecimal(' 1,500.50 '), 1500.5);
    assert.equal(rules.parseDecimal('₦1,500'), 1500);
    assert.equal(rules.parseDecimal('₦ 2000'), 2000);
    assert.equal(rules.parseDecimal('.5'), 0.5);
    assert.equal(rules.parseDecimal('1,50'), null);
    assert.equal(rules.parseDecimal('1.2.3'), null);
    assert.equal(rules.parseDecimal('-5'), null);
    assert.equal(rules.parseDecimal(''), null);
    assert.equal(rules.parseDecimal('1e3'), null);
  });

  test('rateProblem rejects empty, negative, non-numeric, over-precise and absurd rates', () => {
    assert.equal(rules.rateProblem('', true), 'Enter a rate.');
    assert.equal(rules.rateProblem('   ', false), 'Enter a rate.');
    assert.equal(rules.rateProblem('-10', true), 'A rate cannot be negative.');
    assert.equal(rules.rateProblem('1,50', true), 'Use a full stop for decimals and commas only between thousands, like 1,500.50.');
    assert.equal(rules.rateProblem('abc', true), 'Enter a number, like 1500 or 1500.50.');
    assert.equal(rules.rateProblem('1500.505', true), 'Use at most 2 decimal places.');
    assert.equal(
      rules.rateProblem('100000.01', true),
      'That is more than ₦100,000.00 per unit, which is not a realistic rate. Check the value.',
    );
    assert.equal(rules.rateProblem('100000', true), null);
    assert.equal(rules.rateProblem('1,500.50', true), null);
    assert.equal(rules.rateProblem('0.07', true), null);
  });

  test('a zero rate is refused only for an active range', () => {
    assert.equal(rules.rateProblem('0', true), 'An active range needs a rate above ₦0.00. Switch the range off instead.');
    assert.equal(rules.rateProblem('0.00', false), null);
  });

  test('amount and label problems', () => {
    assert.equal(rules.amountProblem(''), 'Enter an amount.');
    assert.equal(rules.amountProblem('-1'), 'An amount cannot be negative.');
    assert.equal(rules.amountProblem('100000001'), 'Use an amount of 100,000,000 or less.');
    assert.equal(rules.amountProblem('25'), null);
    assert.equal(rules.labelProblem('  '), 'Enter a label, like $25–$99.');
    assert.equal(rules.labelProblem('x'.repeat(81)), 'Use 80 characters or fewer.');
    assert.equal(rules.labelProblem('$25–$99'), null);
  });

  test('move helpers', () => {
    assert.equal(rules.rateMove(1500, 1650), 0.1);
    assert.equal(rules.rateMove(0, 1200), null);
    assert.equal(rules.rateMove(null, 1200), null);
    assert.equal(rules.isLargeMove(1500, 1650), false);
    assert.equal(rules.isLargeMove(1500, 1651), true);
    assert.equal(rules.isLargeMove(1500, 1349), true);
    assert.equal(rules.isLargeMove(0, 1200), true);
    assert.equal(rules.isLargeMove(null, 0), false);
    assert.equal(rules.isHugeMove(1500, 2250), true);
    assert.equal(rules.isHugeMove(1500, 2000), false);
    assert.equal(rules.rangesOverlap({ min: 25, max: 99 }, { min: 99, max: 200 }), true);
    assert.equal(rules.rangesOverlap({ min: 25, max: 99 }, { min: 100, max: 200 }), false);
    assert.equal(rules.rangesOverlap({ min: null, max: 99 }, { min: 1, max: 200 }), false);
  });
});

describe('PATCH /api/rates body (mobile contract)', () => {
  test('the mobile shape { changes: [{ id, rate_naira, is_active }] } is accepted', () => {
    const checked = rules.readRateChanges({ changes: [{ id: D1.toUpperCase(), rate_naira: 1550, is_active: true }] });
    assert.deepEqual(checked, { ok: true, value: [{ id: D1, rate: 1550, active: true, expected: null }] });
  });

  test('numeric strings, a missing is_active and web expected values are read', () => {
    const checked = rules.readRateChanges({
      changes: [
        { id: D1, rate_naira: '1550.5' },
        { id: D2, rate_naira: 1600, is_active: false, expected: { rate_naira: 1550, is_active: true } },
        { id: D3, rate_naira: 1200, is_active: true, expected: { rate_naira: null, is_active: null } },
      ],
    });
    assert.deepEqual(checked, {
      ok: true,
      value: [
        { id: D1, rate: 1550.5, active: null, expected: null },
        { id: D2, rate: 1600, active: false, expected: { rate: 1550, active: true } },
        { id: D3, rate: 1200, active: true, expected: { rate: null, active: false } },
      ],
    });
  });

  test('invalid bodies are refused with a reason', () => {
    const refused = (body: unknown) => {
      const checked = rules.readRateChanges(body);
      assert.equal(checked.ok, false);
      return checked.ok ? '' : checked.message;
    };
    assert.equal(refused(null), 'No changes provided.');
    assert.equal(refused({ changes: [] }), 'No changes provided.');
    assert.equal(
      refused({ changes: Array.from({ length: 501 }, () => ({ id: D1, rate_naira: 1 })) }),
      'Save at most 500 rate changes at a time.',
    );
    assert.equal(refused({ changes: ['x'] }), 'Change 1 is not a valid rate change.');
    assert.equal(refused({ changes: [{ id: 'nope', rate_naira: 1 }] }), 'Change 1 does not name a valid range.');
    assert.equal(
      refused({ changes: [{ id: D1, rate_naira: 1 }, { id: D1, rate_naira: 2 }] }),
      `Range ${D1} appears more than once in this save.`,
    );
    const rateMessage = `The rate for range ${D1} must be a number from 0 to ₦99,999,999.99.`;
    assert.equal(refused({ changes: [{ id: D1, rate_naira: -1 }] }), rateMessage);
    assert.equal(refused({ changes: [{ id: D1, rate_naira: 100000000 }] }), rateMessage);
    assert.equal(refused({ changes: [{ id: D1, rate_naira: '' }] }), rateMessage);
    assert.equal(refused({ changes: [{ id: D1, rate_naira: true }] }), rateMessage);
    assert.equal(
      refused({ changes: [{ id: D1, rate_naira: 1, is_active: 'yes' }] }),
      `The active setting for range ${D1} must be true or false.`,
    );
    assert.equal(
      refused({ changes: [{ id: D1, rate_naira: 1, expected: { is_active: true } }] }),
      `The expected values sent for range ${D1} are not valid.`,
    );
    assert.equal(
      refused({ changes: [{ id: D1, rate_naira: 1, expected: 'x' }] }),
      `The expected values sent for range ${D1} are not valid.`,
    );
  });
});

describe('POST /api/rates body (mobile contract)', () => {
  const valid = {
    card_type_id: PHYSICAL,
    range_label: '  $25–$99 ',
    min_value: 25,
    max_value: 99,
    rate_naira: 1500,
    is_active: false,
  };

  test('the mobile shape is accepted and the label trimmed', () => {
    assert.deepEqual(rules.readNewRange(valid), {
      ok: true,
      value: { card_type_id: PHYSICAL, range_label: '$25–$99', min_value: 25, max_value: 99, rate_naira: 1500, is_active: false },
    });
    const withoutFlag = rules.readNewRange({ ...valid, is_active: undefined });
    assert.equal(withoutFlag.ok && withoutFlag.value.is_active, true);
  });

  test('invalid ranges are refused', () => {
    const refused = (body: unknown) => {
      const checked = rules.readNewRange(body);
      assert.equal(checked.ok, false);
      return checked.ok ? '' : checked.message;
    };
    assert.equal(refused('x'), 'Send the new range as a JSON object.');
    assert.equal(refused({ ...valid, card_type_id: 'x' }), 'Choose a valid card type for this range.');
    assert.equal(refused({ ...valid, range_label: '  ' }), 'Enter a label, like $25–$99.');
    assert.equal(refused({ ...valid, min_value: -1 }), 'The minimum card value must be a number of 0 or more.');
    assert.equal(refused({ ...valid, max_value: 'abc' }), 'The maximum card value must be a number of 0 or more.');
    assert.equal(refused({ ...valid, min_value: 100, max_value: 50 }), 'The minimum card value cannot be more than the maximum.');
    assert.equal(refused({ ...valid, rate_naira: -1 }), 'The rate must be a number from 0 to ₦99,999,999.99.');
    assert.equal(refused({ ...valid, is_active: 'true' }), 'is_active must be true or false.');
  });
});

describe('server write planning', () => {
  const change = (rate: number, active: boolean | null, expected: { rate: number | null; active: boolean } | null) => ({
    id: D1, rate, active, expected,
  });

  test('writes with or without is_active, refuses a stale expectation and skips no-ops', () => {
    const current = { rate_naira: 1500, is_active: true };
    assert.deepEqual(rules.planRateWrite(change(1550, true, { rate: 1500, active: true }), current), {
      kind: 'write', update: { rate_naira: 1550, is_active: true },
    });
    assert.deepEqual(rules.planRateWrite(change(1550, null, null), current), { kind: 'write', update: { rate_naira: 1550 } });
    assert.deepEqual(rules.planRateWrite(change(1550, true, { rate: 1400, active: true }), current), { kind: 'conflict' });
    assert.deepEqual(rules.planRateWrite(change(1550, true, { rate: 1500, active: false }), current), { kind: 'conflict' });
    assert.deepEqual(rules.planRateWrite(change(1500, true, null), current), { kind: 'unchanged' });
    assert.deepEqual(rules.planRateWrite(change(1500, true, { rate: 1400, active: true }), current), { kind: 'unchanged' });
    assert.deepEqual(rules.planRateWrite(change(1500, null, null), { rate_naira: '1500.00', is_active: true }), { kind: 'unchanged' });
  });

  test('a null is_active in the database is treated as switched off', () => {
    assert.deepEqual(rules.planRateWrite(change(1500, false, { rate: 1500, active: false }), { rate_naira: 1500, is_active: null }), {
      kind: 'unchanged',
    });
    assert.deepEqual(rules.planRateWrite(change(1500, true, { rate: 1500, active: false }), { rate_naira: 1500, is_active: null }), {
      kind: 'write', update: { rate_naira: 1500, is_active: true },
    });
  });

  test('saveVerdict never reports a partial save as success', () => {
    const result = (status: 'saved' | 'unchanged' | 'conflict' | 'missing' | 'error') => ({
      id: D1, status, rate_naira: null, is_active: null,
    });
    assert.deepEqual(rules.saveVerdict([result('saved'), result('unchanged')]), { ok: true });
    assert.deepEqual(rules.saveVerdict([result('saved'), result('conflict')]), {
      ok: false,
      code: 'STATE_CONFLICT',
      message: '1 of 2 rate changes saved; 1 not saved. 1 rate changed or was removed after you loaded it. Reload the rates and review them again.',
    });
    assert.deepEqual(rules.saveVerdict([result('conflict')]), {
      ok: false,
      code: 'STATE_CONFLICT',
      message: 'The rate change was not saved. 1 rate changed or was removed after you loaded it. Reload the rates and review them again.',
    });
    assert.deepEqual(rules.saveVerdict([result('missing'), result('missing'), result('saved')]), {
      ok: false,
      code: 'STATE_CONFLICT',
      message: '1 of 3 rate changes saved; 2 not saved. 2 rates changed or were removed after you loaded them. Reload the rates and review them again.',
    });
    assert.deepEqual(rules.saveVerdict([result('error'), result('conflict'), result('missing')]), {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'None of the 3 rate changes were saved. 2 rates changed or were removed after you loaded them and 1 change hit a database error. Reload the rates and try again.',
    });
  });
});

describe('GET /api/rates tree (mobile contract)', () => {
  const cards: CardRow[] = [
    { id: APPLE, name: 'Apple', logo_url: null, is_active: true, sort_order: 2 },
    { id: AMAZON, name: 'Amazon', logo_url: 'a.png', is_active: true, sort_order: 1 },
    { id: '0a000000-0000-4000-8000-000000000003', name: 'Zed', logo_url: null, is_active: true, sort_order: null },
  ];
  const countries: CountryRow[] = [
    { id: GB, card_id: AMAZON, country_code: 'GB', country_name: 'United Kingdom', currency_symbol: '£' },
    { id: US, card_id: AMAZON, country_code: 'US', country_name: 'United States', currency_symbol: '$' },
    { id: UK_APPLE, card_id: APPLE, country_code: 'GB', country_name: 'United Kingdom', currency_symbol: '£' },
  ];
  const types: TypeRow[] = [
    { id: ECODE, card_id: APPLE, country_code: 'GB', name: 'E-code', sort_order: 0 },
    { id: PHYSICAL, card_id: AMAZON, country_code: 'US', name: 'Physical', sort_order: 1 },
    { id: '0c000000-0000-4000-8000-000000000003', card_id: AMAZON, country_code: 'US', name: 'E-code', sort_order: 0 },
  ];
  const denominations: StoredDenomination[] = [
    { id: D2, card_type_id: PHYSICAL, range_label: '$100–$500', min_value: '100', max_value: 500, rate_naira: 1550, is_active: true },
    { id: D1, card_type_id: PHYSICAL, range_label: '$25–$99', min_value: 25, max_value: 99, rate_naira: 1500, is_active: true },
    { id: D3, card_type_id: PHYSICAL, range_label: '$501–$1000', min_value: 501, max_value: 1000, rate_naira: 0, is_active: false },
    { id: D4, card_type_id: ECODE, range_label: '£10–£50', min_value: 10, max_value: 50, rate_naira: 1900, is_active: true },
    { id: '0d000000-0000-4000-8000-000000000009', card_type_id: 'other', range_label: 'x', min_value: 1, max_value: 2, rate_naira: 1, is_active: true },
  ];

  test('orders cards, countries, types and ranges and counts active rates', () => {
    const tree = rules.assembleRateTree(cards, countries, types, denominations);
    assert.deepEqual(tree.map((card) => card.name), ['Amazon', 'Apple', 'Zed']);
    const amazon = tree[0];
    assert.deepEqual(amazon.countries.map((country) => country.country_name), ['United Kingdom', 'United States']);
    assert.deepEqual(amazon.countries[0].card_types, []);
    assert.deepEqual(amazon.countries[1].card_types.map((type) => type.name), ['E-code', 'Physical']);
    assert.deepEqual(amazon.countries[1].card_types[1].denominations.map((range) => range.id), [D1, D2, D3]);
    assert.equal(amazon.activeRates, 2);
    assert.equal(tree[1].activeRates, 1);
    assert.deepEqual(tree[2].countries, []);
  });

  test('keeps exactly the keys the mobile rates screen reads', () => {
    const tree = rules.assembleRateTree(cards, countries, types, denominations);
    const card = tree[0];
    assert.deepEqual(Object.keys(card), ['id', 'name', 'logo_url', 'is_active', 'countries', 'activeRates']);
    assert.deepEqual(Object.keys(card.countries[1]), ['id', 'country_code', 'country_name', 'currency_symbol', 'card_types']);
    assert.deepEqual(Object.keys(card.countries[1].card_types[1]), ['id', 'name', 'denominations']);
    assert.deepEqual(Object.keys(card.countries[1].card_types[1].denominations[0]), [
      'id', 'range_label', 'min_value', 'max_value', 'rate_naira', 'is_active',
    ]);
    const parsed = model.toRatesSnapshot({ cards: tree });
    assert.ok(parsed);
    assert.equal(parsed.rows[D2].min, 100);
    assert.equal(parsed.rows[D1].title, 'Amazon US · Physical · $25–$99');
  });
});

describe('snapshot parsing', () => {
  test('reads the tree, totals and empty countries', () => {
    const snap = snapshot();
    assert.deepEqual(snap.totals, { cards: 2, active: 3, inactive: 1 });
    const amazon = snap.cards[0];
    assert.equal(amazon.countries, 2);
    assert.deepEqual(amazon.emptyCountries, [{ id: GB, name: 'United Kingdom' }]);
    assert.equal(amazon.groups.length, 1);
    assert.equal(model.groupTitle(amazon.groups[0].path), 'United States · Physical');
    assert.deepEqual(model.orderedRows(snap).map((entry) => entry.id), [D1, D2, D3, D4]);
    assert.equal(row(snap, D4).title, 'Apple GB · E-code · £10–£50');
    assert.equal(row(snap, D3).active, false);
  });

  test('refuses a body without cards and skips malformed entries', () => {
    assert.equal(model.toRatesSnapshot({ success: true }), null);
    const parsed = model.toRatesSnapshot({ cards: [null, { name: 'No id' }, { id: AMAZON, name: '', countries: 'x' }] });
    assert.ok(parsed);
    assert.equal(parsed.cards.length, 1);
    assert.equal(parsed.cards[0].name, 'Unnamed card');
  });

  test('formatting helpers', () => {
    assert.equal(model.currencyAmount('$', 25), '$25');
    assert.equal(model.currencyAmount('CAD', 1000.5), 'CAD 1,000.5');
    assert.equal(model.currencyAmount('', 25), '25');
    assert.equal(model.currencyAmount('$', null), '—');
    assert.equal(model.perUnit('£'), 'per £1');
    assert.equal(model.perUnit(''), 'per unit');
    assert.equal(model.valueSpan(row(snapshot(), D2)), '$100 – $500');
    assert.equal(model.cardSummary({ countries: 2, active: 2, inactive: 1 }), '2 countries · 2 active ranges · 1 switched off');
    assert.equal(model.cardSummary({ countries: 1, active: 1, inactive: 0 }), '1 country · 1 active range');
    assert.equal(model.rateText(1500), '1500.00');
    assert.equal(model.rateText(null), '');
  });
});

describe('staged edits', () => {
  test('editing creates an entry and editing back to the live value removes it', () => {
    const snap = snapshot();
    const d1 = row(snap, D1);
    const edited = model.editRate(model.EMPTY_DRAFT, d1, '1550');
    assert.deepEqual(edited[D1], {
      rate: '1550', active: true, base: { rate: 1500, active: true }, title: d1.title, conflict: null, failure: null,
    });
    assert.equal(model.draftCount(edited), 1);
    const sameValue = model.editRate(edited, d1, '1,500.00');
    assert.equal(model.isChanged(sameValue[D1]), false);
    assert.equal(model.draftCount(sameValue), 0);
    assert.deepEqual(model.editRate(edited, d1, '1500.00'), {});
    const typing = model.editRate(model.EMPTY_DRAFT, d1, '1500.0');
    assert.equal(typing[D1].rate, '1500.0');
    assert.equal(model.draftCount(typing), 0);
    assert.equal(model.rowView(d1, typing).rate, '1500.0');
    assert.equal(model.rowView(d1, typing).changed, false);
    assert.deepEqual(model.reviewDraft(snap, typing).changes, []);
    const toggledOff = model.editActive(model.EMPTY_DRAFT, d1, false);
    assert.equal(model.draftCount(toggledOff), 1);
    assert.deepEqual(model.editActive(toggledOff, d1, true), {});
    const invalid = model.editRate(model.EMPTY_DRAFT, d1, 'abc');
    assert.equal(model.isChanged(invalid[D1]), true);
    assert.deepEqual(model.revertRow(invalid, D1), {});
  });

  test('editing clears a previous save failure on that row', () => {
    const snap = snapshot();
    const d1 = row(snap, D1);
    const failed: Draft = { [D1]: { ...model.editRate(model.EMPTY_DRAFT, d1, '1550')[D1], failure: 'x' } };
    assert.equal(model.editRate(failed, d1, '1560')[D1].failure, null);
  });

  test('reviewDraft validates changed rows in display order and builds before → after changes', () => {
    const snap = snapshot();
    let draft = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
    draft = model.editRate(draft, row(snap, D2), 'abc');
    draft = model.editActive(draft, row(snap, D3), true);
    const reviewed = model.reviewDraft(snap, draft);
    assert.deepEqual(reviewed.errors, {
      [D2]: 'Enter a number, like 1500 or 1500.50.',
      [D3]: 'Set a rate above ₦0.00 before switching this range on.',
    });
    assert.equal(reviewed.firstError, D2);
    assert.equal(reviewed.changes.length, 1);
    assert.deepEqual(
      { from: reviewed.changes[0].from, to: reviewed.changes[0].to, rate: reviewed.changes[0].rateChanged, active: reviewed.changes[0].activeChanged },
      { from: { rate: 1500, active: true }, to: { rate: 1550, active: true }, rate: true, active: false },
    );
    const fixed = model.editRate(model.editRate(draft, row(snap, D2), '1600'), row(snap, D3), '1200');
    const again = model.reviewDraft(snap, fixed);
    assert.deepEqual(again.errors, {});
    assert.deepEqual(again.changes.map((change) => change.id), [D1, D2, D3]);
    assert.deepEqual(again.changes[2].to, { rate: 1200, active: true });
    assert.equal(again.changes[2].activeChanged, true);
  });

  test('a row with no rate in the database must be given one', () => {
    const snap = snapshot({ [D2]: { rate_naira: null } });
    const draft = model.editActive(model.EMPTY_DRAFT, row(snap, D2), false);
    assert.deepEqual(model.reviewDraft(snap, draft).errors, { [D2]: 'Enter a rate.' });
  });

  test('rowView describes the staged state of a row', () => {
    const snap = snapshot();
    const d1 = row(snap, D1);
    assert.equal(model.rowView(d1, model.EMPTY_DRAFT).changed, false);
    const huge = model.rowView(d1, model.editRate(model.EMPTY_DRAFT, d1, '3000'));
    assert.deepEqual({ changed: huge.changed, to: huge.to, huge: huge.huge }, { changed: true, to: 3000, huge: true });
    const invalid = model.rowView(d1, model.editRate(model.EMPTY_DRAFT, d1, '15,00'));
    assert.equal(invalid.to, null);
    assert.equal(invalid.rateChanged, true);
  });

  test('change counts per card', () => {
    const snap = snapshot();
    let draft = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
    draft = model.editRate(draft, row(snap, D4), '2000');
    assert.deepEqual([...model.changesByCard(snap, draft)], [[AMAZON, 1], [APPLE, 1]]);
    assert.deepEqual([...model.issuesByCard(snap, { [D4]: 'x' })], [[APPLE, 1]]);
  });
});

describe('collision handling', () => {
  test('rebaseDraft keeps my edits, follows live values for untouched fields and reports what changed', () => {
    const before = snapshot();
    let draft = model.editRate(model.EMPTY_DRAFT, row(before, D1), '1550');
    draft = model.editActive(draft, row(before, D2), false);
    draft = model.editRate(draft, row(before, D4), '2000');
    draft = model.editRate(draft, row(before, D3), '1200');
    const live = snapshot({ [D1]: { rate_naira: 1600 }, [D2]: { rate_naira: 1580 }, [D4]: { rate_naira: 2000 } }, [D3]);
    const result = model.rebaseDraft(draft, live);
    assert.deepEqual(Object.keys(result.draft).sort(), [D1, D2].sort());
    assert.deepEqual(result.draft[D1], {
      rate: '1550',
      active: true,
      base: { rate: 1600, active: true },
      title: row(live, D1).title,
      conflict: { rate: 1600, active: true },
      failure: null,
    });
    assert.deepEqual(
      { rate: result.draft[D2].rate, active: result.draft[D2].active, base: result.draft[D2].base, conflict: result.draft[D2].conflict },
      { rate: '1580.00', active: false, base: { rate: 1580, active: true }, conflict: { rate: 1580, active: true } },
    );
    assert.deepEqual(result.conflicts, [
      { id: D1, title: row(live, D1).title, live: { rate: 1600, active: true }, mine: 'your value 1550' },
      { id: D2, title: row(live, D2).title, live: { rate: 1580, active: true }, mine: 'your change to switch it off' },
    ]);
    assert.deepEqual(result.dropped.map((note) => note.id), [D3]);
    assert.deepEqual(result.alreadyLive.map((note) => note.id), [D4]);
  });

  test('a conflict stays on the entry after a second rebase so the reviewer still sees it', () => {
    const draft = model.editRate(model.EMPTY_DRAFT, row(snapshot(), D1), '1550');
    const live = snapshot({ [D1]: { rate_naira: 1600 } });
    const once = model.rebaseDraft(draft, live);
    const twice = model.rebaseDraft(once.draft, live);
    assert.deepEqual(twice.conflicts, []);
    assert.deepEqual(twice.draft[D1].conflict, { rate: 1600, active: true });
    const pending = model.reviewDraft(live, twice.draft).changes;
    assert.deepEqual(pending[0].from, { rate: 1600, active: true });
    assert.deepEqual(pending[0].conflict, { rate: 1600, active: true });
  });

  test('rebaseNotice explains conflicts, dropped and already-live changes', () => {
    const before = snapshot();
    let draft = model.editRate(model.EMPTY_DRAFT, row(before, D1), '1550');
    draft = model.editRate(draft, row(before, D3), '1200');
    draft = model.editRate(draft, row(before, D4), '2000');
    const result = model.rebaseDraft(draft, snapshot({ [D1]: { rate_naira: 1600 }, [D4]: { rate_naira: 2000 } }, [D3]));
    const notice = model.rebaseNotice(result, true);
    assert.ok(notice);
    assert.equal(notice.title, 'Rates changed while you were editing');
    assert.deepEqual(notice.items.map((item) => item.id), [D1, D3, D4]);
    assert.equal(notice.items[0].detail, 'Someone else changed this to ₦1,600.00. Your value 1550 is kept; check it before saving.');
    assert.equal(model.rebaseNotice(result, false)?.items.length, 2);
    assert.equal(model.rebaseNotice({ draft: {}, conflicts: [], dropped: [], alreadyLive: [] }, true), null);
  });

  test('the save payload carries the reviewed values as the expected state', () => {
    const snap = snapshot();
    const draft = model.editActive(model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550'), row(snap, D1), false);
    assert.deepEqual(model.savePayload(pendingFor(snap, draft)), {
      changes: [{ id: D1, rate_naira: 1550, is_active: false, expected: { rate_naira: 1500, is_active: true } }],
    });
  });
});

describe('save outcomes', () => {
  test('classifySave maps every server answer', async () => {
    respond(() => json({ success: true, request_id: 'r', saved: 1, results: [{ id: D1, status: 'saved', rate_naira: 1550, is_active: true }], audit_recorded: true }, 200));
    assert.deepEqual(model.classifySave(await patch()), {
      kind: 'saved', results: [{ id: D1, status: 'saved', rate: 1550, active: true }], warning: null,
    });

    respond(() => json({ success: true, results: [], audit_recorded: false, warning: 'Not audited.' }, 200));
    assert.deepEqual(model.classifySave(await patch()), { kind: 'saved', results: [], warning: 'Not audited.' });

    const conflict = 'The rate change was not saved.';
    respond(() => json({
      success: false, error: conflict, code: 'STATE_CONFLICT', message: conflict,
      details: { results: [{ id: D1, status: 'conflict', rate_naira: 1600, is_active: true }] },
    }, 409));
    assert.deepEqual(model.classifySave(await patch()), {
      kind: 'partial', results: [{ id: D1, status: 'conflict', rate: 1600, active: true }], message: conflict, warning: null,
    });

    respond(() => json({
      success: false, error: conflict, code: 'INTERNAL_ERROR', message: conflict,
      details: { results: [{ id: D1, status: 'error', rate_naira: 1500, is_active: true }], warning: 'Not audited.' },
    }, 500));
    const failedWrite = model.classifySave(await patch());
    assert.equal(failedWrite.kind, 'partial');
    assert.equal(failedWrite.kind === 'partial' && failedWrite.warning, 'Not audited.');

    respond(() => json({ success: false, error: 'Nothing saved.', code: 'INTERNAL_ERROR', message: 'Nothing saved.' }, 500));
    assert.deepEqual(model.classifySave(await patch()), { kind: 'retry', message: 'Nothing saved.' });

    respond(() => json({ success: false, error: 'No changes provided.', code: 'VALIDATION_ERROR' }, 400));
    assert.deepEqual(model.classifySave(await patch()), { kind: 'retry', message: 'No changes provided.' });

    respond(() => new Response('upstream down', { status: 502 }));
    assert.equal(model.classifySave(await patch()).kind, 'unknown');

    respond(() => {
      throw new TypeError('Failed to fetch');
    });
    assert.equal(model.classifySave(await patch()).kind, 'unknown');

    respond(() => json({ success: false, error: 'You do not have permission to do this.', code: 'PERMISSION_DENIED' }, 403));
    assert.deepEqual(model.classifySave(await patch()), {
      kind: 'refused', status: 403, message: 'You do not have permission to do this.',
    });

    respond(() => json({ success: false, error: 'Your session has expired.', code: 'AUTH_REQUIRED' }, 401));
    assert.deepEqual(model.classifySave(await patch()), { kind: 'expired' });
  });

  test('a full save clears the saved rows', () => {
    const snap = snapshot();
    const draft = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
    const pending = pendingFor(snap, draft);
    const fresh = snapshot({ [D1]: { rate_naira: 1550 } });
    const settled = model.settleSave(draft, pending, { kind: 'saved', results: [], warning: null }, fresh);
    assert.deepEqual(settled.draft, {});
    assert.equal(settled.cleared, true);
    assert.equal(settled.notice, null);
    assert.deepEqual(settled.toasts, [{ text: 'Saved 1 rate change. New submissions use it now.', tone: 'success' }]);

    const warned = model.settleSave(draft, pending, { kind: 'saved', results: [], warning: 'Not audited.' }, null);
    assert.deepEqual(warned.toasts.map((toast) => toast.tone), ['success', 'warning', 'warning']);
    assert.equal(warned.toasts[2].text, 'The new rates could not be reloaded. Refresh to see them.');
  });

  test('a partial save reports which rows saved and keeps the rest staged', () => {
    const snap = snapshot();
    let draft = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
    draft = model.editRate(draft, row(snap, D2), '1650');
    const pending = pendingFor(snap, draft);
    const fresh = snapshot({ [D1]: { rate_naira: 1550 }, [D2]: { rate_naira: 1600 } });
    const outcome = {
      kind: 'partial' as const,
      message: '1 of 2 rate changes saved; 1 not saved.',
      warning: null,
      results: [
        { id: D1, status: 'saved' as const, rate: 1550, active: true },
        { id: D2, status: 'conflict' as const, rate: 1600, active: true },
      ],
    };
    const settled = model.settleSave(draft, pending, outcome, fresh);
    assert.deepEqual(Object.keys(settled.draft), [D2]);
    assert.equal(settled.draft[D2].failure, 'Someone else changed this to ₦1,600.00 before your save reached it.');
    assert.deepEqual(settled.draft[D2].conflict, { rate: 1600, active: true });
    assert.equal(settled.cleared, false);
    assert.ok(settled.notice);
    assert.equal(settled.notice.tone, 'danger');
    assert.equal(settled.notice.title, '1 of 2 rate changes not saved');
    assert.equal(settled.notice.message, '1 change was saved and is live. The rest are still marked as unsaved below.');
    assert.deepEqual(settled.notice.items.map((item) => item.id), [D2]);
    assert.deepEqual(settled.toasts, [{ text: '1 of 2 rate changes saved; 1 not saved.', tone: 'error' }]);
    const unaudited = model.settleSave(draft, pending, { ...outcome, warning: 'Not audited.' }, fresh);
    assert.deepEqual(unaudited.toasts.map((toast) => toast.tone), ['error', 'warning']);
  });

  test('failure reasons', () => {
    assert.equal(model.failureReason(undefined), 'No result came back for this change.');
    assert.equal(model.failureReason({ id: D1, status: 'missing', rate: null, active: null }), 'This range no longer exists.');
    assert.equal(model.failureReason({ id: D1, status: 'error', rate: 1, active: true }), 'The database did not accept this change.');
    assert.equal(
      model.failureReason({ id: D1, status: 'conflict', rate: 1600, active: false }),
      'Someone else changed this to ₦1,600.00 (switched off) before your save reached it.',
    );
  });

  test('an unknown outcome is reconciled against the live rates', () => {
    const snap = snapshot();
    let draft = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
    draft = model.editActive(draft, row(snap, D2), false);
    const pending = pendingFor(snap, draft);
    const outcome = { kind: 'unknown' as const, message: 'Could not reach the server.' };
    const checked = model.settleSave(draft, pending, outcome, snapshot({ [D1]: { rate_naira: 1550 } }));
    assert.deepEqual(Object.keys(checked.draft), [D2]);
    assert.equal(
      checked.notice?.message,
      'No answer came back from the server, so the live rates were checked: 1 of 2 changes are live and 1 is still marked as unsaved below. Review it before saving again.',
    );
    assert.equal(checked.toasts[0].tone, 'warning');

    const allLive = model.settleSave(draft, pending, outcome, snapshot({ [D1]: { rate_naira: 1550 }, [D2]: { is_active: false } }));
    assert.equal(allLive.cleared, true);
    assert.equal(allLive.toasts[0].tone, 'success');

    const blind = model.settleSave(draft, pending, outcome, null);
    assert.equal(blind.draft, draft);
    assert.equal(blind.notice?.message, 'Could not reach the server. Your changes are still marked as unsaved below until you check.');
  });

  test('refusals keep the draft', () => {
    const snap = snapshot();
    const draft = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
    const pending = pendingFor(snap, draft);
    const refused = model.settleSave(draft, pending, { kind: 'refused', status: 403, message: 'No.' }, null);
    assert.equal(refused.draft, draft);
    assert.deepEqual(refused.toasts, [{ text: 'No.', tone: 'error' }]);
    assert.deepEqual(model.settleSave(draft, pending, { kind: 'expired' }, null).toasts, []);
  });
});

describe('filters', () => {
  test('search matches card, country, type and range labels', () => {
    const snap = snapshot();
    assert.equal(model.filterCards(snap.cards, '', 'all', {}), snap.cards);
    assert.deepEqual(model.filterCards(snap.cards, 'amazon', 'all', {}).map((card) => card.id), [AMAZON]);
    const kingdom = model.filterCards(snap.cards, 'Kingdom', 'all', {});
    assert.deepEqual(kingdom.map((card) => card.id), [APPLE]);
    const range = model.filterCards(snap.cards, '$100–', 'all', {});
    assert.deepEqual(range[0].groups[0].rows.map((entry) => entry.id), [D2]);
    const prefix = model.filterCards(snap.cards, '$100', 'all', {});
    assert.deepEqual(prefix[0].groups[0].rows.map((entry) => entry.id), [D2, D3]);
    assert.deepEqual(range[0].emptyCountries, []);
    assert.deepEqual(model.filterCards(snap.cards, 'zzz', 'all', {}), []);
  });

  test('show filters by live status or by unsaved changes', () => {
    const snap = snapshot();
    const inactive = model.filterCards(snap.cards, '', 'inactive', {});
    assert.deepEqual(inactive.flatMap((card) => card.groups.flatMap((group) => group.rows.map((entry) => entry.id))), [D3]);
    const draft = model.editRate(model.EMPTY_DRAFT, row(snap, D4), '2000');
    const changed = model.filterCards(snap.cards, '', 'changed', draft);
    assert.deepEqual(changed.map((card) => card.id), [APPLE]);
    assert.equal(model.containsRow(changed, D4), true);
    assert.equal(model.containsRow(changed, D1), false);
    const typedBack = model.editRate(draft, row(snap, D4), '1900.0');
    assert.equal(model.containsRow(model.filterCards(snap.cards, '', 'changed', typedBack), D4), false);
    assert.equal(model.containsRow(model.filterCards(snap.cards, '', 'changed', typedBack, new Set([D4])), D4), true);
    assert.equal(model.containsRow(model.filterCards(snap.cards, '', 'changed', typedBack, new Set([D4])), D1), false);
    assert.equal(model.filtersActive(' ', 'all'), false);
    assert.equal(model.filtersActive('a', 'all'), true);
    assert.equal(model.filtersActive('', 'active'), true);
  });
});

describe('navigation guard', () => {
  const here = 'https://admin.example.com/rates';

  test('only same-origin links to another page are guarded', () => {
    assert.equal(model.leavePath('/cards', here), '/cards');
    assert.equal(model.leavePath('/cards#top', here), '/cards#top');
    assert.equal(model.leavePath('/rates?show=1', here), '/rates?show=1');
    assert.equal(model.leavePath('/rates', here), null);
    assert.equal(model.leavePath('#top', here), null);
    assert.equal(model.leavePath('https://other.example.com/x', here), null);
    assert.equal(model.leavePath('http://[bad', here), null);
  });
});

describe('add range', () => {
  test('checkNewRange validates every field and returns typed values', () => {
    const ok = model.checkNewRange({ label: ' $90–$150 ', min: '90', max: '150', rate: '1,520.50', active: true });
    assert.deepEqual(ok, { errors: {}, values: { label: '$90–$150', min: 90, max: 150, rate: 1520.5, active: true } });
    const swapped = model.checkNewRange({ label: 'x', min: '150', max: '90', rate: '1500', active: true });
    assert.deepEqual(swapped.errors, { max: 'The maximum must be at least the minimum.' });
    assert.equal(swapped.values, null);
    const zero = model.checkNewRange({ label: 'x', min: '1', max: '2', rate: '0', active: true });
    assert.equal(zero.errors.rate, 'An active range needs a rate above ₦0.00. Switch the range off instead.');
    assert.equal(model.checkNewRange({ label: 'x', min: '1', max: '2', rate: '0', active: false }).values?.rate, 0);
    const empty = model.checkNewRange({ label: '', min: '', max: '', rate: '', active: true });
    assert.equal(model.firstNewRangeError(empty.errors), 'label');
    assert.equal(model.firstNewRangeError({ rate: 'x', max: 'y' }), 'max');
  });

  test('overlaps and the request body', () => {
    const snap = snapshot();
    const target = model.addTarget(snap.cards[0].groups[0]);
    assert.deepEqual(model.overlapsFor(target, 90, 150).map((range) => range.id), [D1, D2]);
    assert.deepEqual(model.overlapsFor(target, 1001, 2000), []);
    assert.deepEqual(model.newRangeBody(target, { label: '$90–$150', min: 90, max: 150, rate: 1500, active: false }), {
      card_type_id: PHYSICAL, range_label: '$90–$150', min_value: 90, max_value: 150, rate_naira: 1500, is_active: false,
    });
  });

  test('classifyAdd', async () => {
    respond(() => json({ success: true, id: D1, denomination: {}, audit_recorded: true }, 200));
    assert.deepEqual(model.classifyAdd(await post()), { kind: 'added', id: D1, warning: null });
    respond(() => json({ success: false, error: 'That card type no longer exists.', code: 'RESOURCE_NOT_FOUND' }, 404));
    assert.deepEqual(model.classifyAdd(await post()), { kind: 'refused', status: 404, message: 'That card type no longer exists.' });
    respond(() => json({ success: false, error: 'Enter a label, like $25–$99.', code: 'VALIDATION_ERROR' }, 400));
    assert.deepEqual(model.classifyAdd(await post()), { kind: 'retry', message: 'Enter a label, like $25–$99.' });
    respond(() => new Response('', { status: 500 }));
    assert.equal(model.classifyAdd(await post()).kind, 'unknown');
    respond(() => json({ success: false, error: 'Expired', code: 'AUTH_REQUIRED' }, 401));
    assert.deepEqual(model.classifyAdd(await post()), { kind: 'expired' });
  });
});

describe('confirmation dialogs', () => {
  function edits(snap: RatesSnapshot, values: Record<string, string>, active: Record<string, boolean> = {}): PendingChange[] {
    let draft: Draft = model.EMPTY_DRAFT;
    for (const [id, value] of Object.entries(values)) draft = model.editRate(draft, row(snap, id), value);
    for (const [id, flag] of Object.entries(active)) draft = model.editActive(draft, row(snap, id), flag);
    return pendingFor(snap, draft);
  }

  test('the save dialog lists every change before → after and flags large moves', () => {
    const snap = snapshot();
    const changes = edits(snap, { [D1]: '1550', [D2]: '1800', [D3]: '1200' }, { [D3]: true });
    const dialog = options.reviewOptions(changes);
    assert.equal(dialog.tone, 'financial');
    assert.equal(dialog.title, 'Save 3 rate changes?');
    assert.equal(dialog.confirmLabel, 'Save 3 changes');
    assert.equal(dialog.pendingLabel, 'Saving 3 rate changes…');
    assert.deepEqual(dialog.details?.map((detail) => detail.label), [
      'Amazon US · Physical · $25–$99',
      'Amazon US · Physical · $100–$500',
      'Amazon US · Physical · $501–$1000',
    ]);
    const first = textOf(render(dialog.details?.[0].value as ReactElement));
    assert.match(first, /₦1,500\.00/);
    assert.match(first, /₦1,550\.00/);
    assert.match(first, /\+3\.3%/);
    const third = textOf(render(dialog.details?.[2].value as ReactElement));
    assert.match(third, /New rate/);
    assert.match(third, /Status from Off/);
    assert.deepEqual(dialog.consequences, [
      'Amazon US · Physical · $100–$500 moves +16.1%, from ₦1,550.00 to ₦1,800.00.',
      'Amazon US · Physical · $501–$1000 moves from ₦0.00 to ₦1,200.00.',
      '1 range is switched on and starts paying new submissions immediately.',
    ]);
  });

  test('typos, conflicts and switch-offs are called out', () => {
    const snap = snapshot();
    const huge = options.reviewConsequences(edits(snap, { [D1]: '3000' }));
    assert.deepEqual(huge, ['Amazon US · Physical · $25–$99 moves +100.0%, from ₦1,500.00 to ₦3,000.00. Check this is not a typo.']);
    const off = options.reviewConsequences(edits(snap, {}, { [D1]: false, [D2]: false }));
    assert.deepEqual(off, ['2 ranges are switched off. The app stops offering them for new submissions.']);
    const draft = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
    const live = snapshot({ [D1]: { rate_naira: 1600 } });
    const rebased = model.rebaseDraft(draft, live).draft;
    const conflict = options.reviewConsequences(pendingFor(live, rebased));
    assert.deepEqual(conflict, [
      'Someone else changed Amazon US · Physical · $25–$99 to ₦1,600.00 after you started editing. Saving sets it to ₦1,550.00.',
    ]);
    const toggled = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
    const switchedOff = snapshot({ [D1]: { is_active: false } });
    const switchedResult = model.rebaseDraft(toggled, switchedOff);
    assert.deepEqual(switchedResult.draft[D1].conflict, { rate: 1500, active: false });
    assert.deepEqual(options.reviewConsequences(pendingFor(switchedOff, switchedResult.draft))[0],
      'Someone else changed Amazon US · Physical · $25–$99 to ₦1,500.00 (switched off) after you started editing. Saving sets it to ₦1,550.00 (switched off).');
  });

  test('more than three large moves are summarised in one line', () => {
    const snap = snapshot();
    const lines = options.reviewConsequences(edits(snap, { [D1]: '1700', [D2]: '1800', [D3]: '900', [D4]: '5700' }));
    assert.deepEqual(lines, [
      '4 rates move by more than 10%. The largest is Apple GB · E-code · £10–£50, +200.0%, from ₦1,900.00 to ₦5,700.00. 1 of them moves by 50% or more; check for typos.',
    ]);
  });

  test('duplicate titles get distinct detail labels', () => {
    const snap = snapshot({ [D2]: { range_label: '$25–$99' } });
    const changes = edits(snap, { [D1]: '1510', [D2]: '1560' });
    assert.deepEqual([...model.detailLabels(changes).values()], [
      'Amazon US · Physical · $25–$99 ($25 – $99)',
      'Amazon US · Physical · $25–$99 ($100 – $500)',
    ]);
  });

  test('discard, leave and add-range dialogs', () => {
    assert.equal(options.discardOptions(1).title, 'Discard 1 unsaved change?');
    assert.equal(options.discardOptions(3).title, 'Discard 3 unsaved changes?');
    const leave = options.leaveOptions(2);
    assert.equal(leave.tone, 'danger');
    assert.equal(leave.message, 'You have 2 unsaved changes on this page. Leaving discards them.');

    const snap = snapshot();
    const target = model.addTarget(snap.cards[0].groups[0]);
    const values = { label: '$90–$150', min: 90, max: 150, rate: 1500, active: true };
    const add = options.addRangeOptions(target, values, model.overlapsFor(target, 90, 150));
    assert.equal(add.tone, 'financial');
    assert.equal(add.title, 'Add $90–$150 to Amazon?');
    assert.deepEqual(add.details?.map((detail) => detail.label), [
      'Card', 'Range', 'Card value', 'Rate per $1', 'Payout for a $150 card', 'Status',
    ]);
    assert.equal(add.details?.[0].value, 'Amazon · United States · Physical');
    assert.equal(add.details?.[2].value, '$90 – $150');
    assert.match(textOf(render(add.details?.[4].value as ReactElement)), /₦225,000\.00/);
    assert.deepEqual(add.consequences, [
      'This range overlaps $25–$99, $100–$500. Where active ranges overlap, the one with the higher minimum value sets the rate.',
    ]);
    assert.equal(
      options.overlapConsequence([{ id: D3, label: '$501–$1000', min: 501, max: 1000, active: false }]),
      'This range overlaps $501–$1000 (switched off). Where active ranges overlap, the one with the higher minimum value sets the rate.',
    );
    assert.equal(options.addRangeOptions(target, { ...values, active: false }, []).consequences, undefined);
  });
});

describe('rendering', () => {
  function editor(snap: RatesSnapshot, patchEditor: Record<string, unknown> = {}) {
    return {
      draft: model.EMPTY_DRAFT,
      errors: {},
      canWrite: true,
      isMobile: false,
      onRate: () => {},
      onActive: () => {},
      onRevert: () => {},
      onBlur: () => {},
      onAdd: () => {},
      snap,
      ...patchEditor,
    };
  }

  function section(snap: RatesSnapshot, patchEditor: Record<string, unknown> = {}, expanded = true): string {
    return render(createElement(list.RateCardSection, {
      card: snap.cards[0],
      expanded,
      changes: 0,
      issues: 0,
      editor: editor(snap, patchEditor),
      onToggle: () => {},
    }));
  }

  test('an editor sees a rate input, a switch and an add button per range', () => {
    const snap = snapshot();
    const html = section(snap);
    const inputs = tagsOf(html, 'input');
    const rates = inputs.filter((attrs) => attrs.id?.startsWith('rate-'));
    assert.deepEqual(rates.map((attrs) => attrs.id), [`rate-${D1}`, `rate-${D2}`, `rate-${D3}`]);
    assert.equal(rates[0].value, '1500.00');
    assert.equal(rates[0]['aria-label'], 'Rate for Amazon US · Physical · $25–$99, in naira per $1');
    assert.equal(rates[0].inputMode ?? rates[0].inputmode, 'decimal');
    assert.equal(inputs.filter((attrs) => attrs.role === 'switch').length, 3);
    assert.match(textOf(html), /Add range/);
    assert.match(textOf(html), /United Kingdom has no active card types yet/);
    assert.equal(tagsOf(html, 'button')[0]['aria-expanded'], 'true');
  });

  test('a viewer without rates.write gets no editing controls', () => {
    const snap = snapshot();
    const html = section(snap, { canWrite: false });
    assert.equal(tagsOf(html, 'input').length, 0);
    assert.doesNotMatch(textOf(html), /Add range/);
    assert.match(textOf(html), /₦1,500\.00/);
    assert.match(textOf(html), /Switched off/);
  });

  test('changed, failed and invalid rows are marked', () => {
    const snap = snapshot();
    let draft = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
    draft = model.editRate(draft, row(snap, D2), 'abc');
    draft = { ...draft, [D1]: { ...draft[D1], failure: 'This range no longer exists.' } };
    const html = section(snap, { draft, errors: { [D2]: 'Enter a number, like 1500 or 1500.50.' } });
    const rows = tagsOf(html, 'tr');
    assert.ok(rows.some((attrs) => classesOf(attrs).includes('rowFailed')));
    assert.ok(rows.some((attrs) => classesOf(attrs).includes('rowChanged')));
    assert.match(textOf(html), /Not saved: This range no longer exists\./);
    assert.match(textOf(html), /Unsaved/);
    const invalid = tagsOf(html, 'input').find((attrs) => attrs.id === `rate-${D2}`);
    assert.equal(invalid?.['aria-invalid'], 'true');
    assert.match(html, /role="alert"[^>]*>Enter a number, like 1500 or 1500\.50\./);
    assert.equal(tagsOf(html, 'button').filter((attrs) => attrs['aria-label']?.startsWith('Undo the unsaved change')).length, 2);
  });

  test('a collapsed card shows no rows, and phones get the mobile list', () => {
    const snap = snapshot();
    const collapsed = section(snap, {}, false);
    assert.equal(tagsOf(collapsed, 'table').length, 0);
    assert.equal(tagsOf(collapsed, 'button')[0]['aria-expanded'], 'false');
    const mobile = section(snap, { isMobile: true });
    assert.equal(tagsOf(mobile, 'table').length, 0);
    assert.ok(tagsOf(mobile, 'ul').some((attrs) => attrs['aria-label'] === 'Amazon United States · Physical rates'));
    assert.equal(tagsOf(mobile, 'input').filter((attrs) => attrs.id?.startsWith('rate-')).length, 3);

    const edited = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
    const failed = { ...edited, [D1]: { ...edited[D1], failure: 'This range no longer exists.' } };
    const phone = section(snap, { isMobile: true, draft: failed });
    assert.match(textOf(phone), /Not saved: This range no longer exists\./);
    assert.ok(tagsOf(phone, 'li').some((attrs) => classesOf(attrs).includes('flagDanger')));
    assert.match(textOf(phone), /₦1,550\.00/);
  });

  test('the unsaved bar reflects the phase', () => {
    const idle = render(createElement(parts.UnsavedBar, { count: 2, issues: 1, phase: 'idle', onDiscard: () => {}, onReview: () => {} }));
    assert.match(textOf(idle), /2 unsaved changes/);
    assert.match(textOf(idle), /1 to fix/);
    assert.match(textOf(idle), /Review changes/);
    const checking = render(createElement(parts.UnsavedBar, { count: 2, issues: 0, phase: 'checking', onDiscard: () => {}, onReview: () => {} }));
    assert.match(textOf(checking), /Checking the live rates…/);
    assert.ok(tagsOf(checking, 'button').every((attrs) => attrs['aria-disabled'] === 'true'));
    const saving = render(createElement(parts.UnsavedBar, { count: 1, issues: 0, phase: 'saving', onDiscard: () => {}, onReview: () => {} }));
    assert.match(textOf(saving), /Saving 1 rate change…/);
  });

  test('the notice lists every affected range', () => {
    const html = render(createElement(parts.PageNoticeView, {
      notice: { tone: 'danger', title: 'Not saved', message: 'Nothing was saved.', items: [{ id: D1, title: 'Amazon US · Physical · $25–$99', detail: 'This range no longer exists.' }] },
      onDismiss: () => {},
    }));
    assert.match(textOf(html), /Amazon US · Physical · \$25–\$99 : This range no longer exists\./);
    assert.ok(tagsOf(html, 'button').some((attrs) => attrs['aria-label'] === 'Dismiss this notice'));
  });
});
