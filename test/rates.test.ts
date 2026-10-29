import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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

describe('save messages', () => {
  test('a refused save says plainly that nothing was saved, never "N of M saved"', () => {
    assert.equal(
      rules.conflictMessage(1, 1),
      'The rate change was not saved. 1 rate changed or was removed after you loaded it. Reload the rates and review them again.',
    );
    assert.equal(
      rules.conflictMessage(3, 1),
      'None of the 3 rate changes were saved: they are saved together, and 1 rate changed or was removed after you loaded it. Reload the rates and review them again.',
    );
    assert.equal(
      rules.conflictMessage(4, 2),
      'None of the 4 rate changes were saved: they are saved together, and 2 rates changed or were removed after you loaded them. Reload the rates and review them again.',
    );
    for (const total of [1, 2, 3, 500]) {
      for (const conflicts of [1, 2]) assert.doesNotMatch(rules.conflictMessage(total, conflicts), /\d+ of \d+/);
    }
  });

  test('each refusal reason from the database reads like the matching body check', () => {
    assert.equal(rules.rateChangeProblem('not_an_object', 1, null), 'Change 1 is not a valid rate change.');
    assert.equal(rules.rateChangeProblem('invalid_id', 2, 'nope'), 'Change 2 does not name a valid range.');
    assert.equal(rules.rateChangeProblem('invalid_id', 2, null), 'Change 2 does not name a valid range.');
    assert.equal(rules.rateChangeProblem('duplicate_id', 3, D1), `Range ${D1} appears more than once in this save.`);
    assert.equal(rules.rateChangeProblem('invalid_rate', 1, D1), `The rate for range ${D1} must be a number from 0 to ₦99,999,999.99.`);
    assert.equal(rules.rateChangeProblem('invalid_active', 1, D1), `The active setting for range ${D1} must be true or false.`);
    assert.equal(rules.rateChangeProblem('invalid_expected', 1, D1), `The expected values sent for range ${D1} are not valid.`);
    assert.equal(rules.rateChangeProblem('invalid_rate', 4, null), 'Change 4 is not a valid rate change.');
    assert.equal(rules.rateChangeProblem('a_new_reason', 5, D1), 'Change 5 is not a valid rate change.');
  });

  test('stored values read as numbers, and a missing flag means switched off', () => {
    assert.deepEqual(rules.storedValues({ rate_naira: '1500.00', is_active: null }), { rate: 1500, active: false });
    assert.deepEqual(rules.storedValues({ rate_naira: 1550, is_active: true }), { rate: 1550, active: true });
    assert.deepEqual(rules.storedValues({}), { rate: null, active: false });
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

  test('reads the automatic summary strictly, so an unreadable one is null and never a default', () => {
    const automatic = {
      enabled: true, interval_minutes: 60, next_due_at: '2026-10-26T12:30:00.000Z', stale: false, failures: 0,
      linked_card_type_ids: [PHYSICAL.toUpperCase()],
    };
    const parsed = model.toRatesSnapshot({ ...treeBody(), automatic })?.automatic;
    assert.ok(parsed);
    assert.equal(parsed.enabled, true);
    assert.equal(parsed.linked.has(PHYSICAL), true);
    assert.equal(model.isLinkedType(parsed, PHYSICAL.toUpperCase()), true);
    assert.equal(model.isLinkedType(parsed, ECODE), false);
    assert.equal(model.toRatesSnapshot(treeBody())?.automatic, null);
    for (const broken of [
      { ...automatic, enabled: 'yes' }, { ...automatic, interval_minutes: 45 }, { ...automatic, next_due_at: null },
      { ...automatic, next_due_at: 'soon' }, { ...automatic, failures: -1 }, { ...automatic, failures: 1.5 },
      { ...automatic, linked_card_type_ids: ['x'] }, { ...automatic, stale: undefined }, null, [],
    ]) {
      assert.equal(model.toRatesSnapshot({ ...treeBody(), automatic: broken })?.automatic, null, JSON.stringify(broken));
    }
    assert.equal(model.toRatesAutomatic({ ...automatic, enabled: false, next_due_at: null })?.enabled, false);
  });

  test('the page notices say when automatic rates are on, and warn when they are failing or stale', () => {
    const read = Date.parse('2026-10-26T12:00:00.000Z');
    const on = model.toRatesAutomatic({
      enabled: true, interval_minutes: 60, next_due_at: '2026-10-26T12:30:00.000Z', stale: false, failures: 0, linked_card_type_ids: [PHYSICAL],
    });
    assert.ok(on);
    assert.deepEqual(model.automaticNotice(on, read), {
      tone: 'info',
      text: 'Automatic rates are on. 1 linked card type gets its ranges and rates from the rate provider every hour; the next update is due around 26 Oct 2026, 13:30 WAT. Changes you make to them here are replaced then.',
    });
    const two = model.toRatesAutomatic({
      enabled: true, interval_minutes: 120, next_due_at: '2026-10-26T12:30:00.000Z', stale: false, failures: 2, linked_card_type_ids: [PHYSICAL, ECODE],
    });
    assert.ok(two);
    assert.match(model.automaticNotice(two, read)?.text ?? '', /^Automatic rates are on\. 2 linked card types get their ranges and rates from the rate provider every 2 hours;/);
    const warning = 'Automatic rates are on, but recent updates have not succeeded. Linked card types keep their current rates until one does.';
    assert.deepEqual(model.automaticNotice({ ...on, stale: true }, read), { tone: 'warning', text: warning });
    assert.deepEqual(model.automaticNotice({ ...on, failures: 3 }, read), { tone: 'warning', text: warning });
    assert.equal(model.automaticNotice({ ...on, enabled: false, nextDueAt: null }, read), null);
    assert.equal(model.automaticNotice({ ...on, linked: new Set<string>() }, read), null);
    assert.equal(model.automaticNotice({ ...on, linked: new Set<string>(), failures: 3 }, read), null);
    assert.equal(
      model.AUTOMATIC_UNREADABLE,
      'The automatic rate status could not be read, so this page cannot show which card types are updated automatically.',
    );
    const page = readFileSync(resolve(APP_DIR, '(dashboard)', 'rates', 'page.tsx'), 'utf8');
    assert.match(page, /\{snapshot && !automatic \? \(\s*<Notice tone="warning" compact>\{AUTOMATIC_UNREADABLE\}<\/Notice>/);
    assert.match(page, /<LinkButton href=\{AUTOMATIC_HREF\} variant="ghost" size="sm">Open Automatic Rates<\/LinkButton>/);
    assert.match(page, /const AUTOMATIC_HREF = '\/admin-settings\/automatic-rates';/);
  });

  test('the page notice words the next update as of the last read: due around while ahead, a start within 5 minutes for 10 minutes, then overdue since', () => {
    const read = Date.parse('2026-10-26T12:00:00.000Z');
    const lead = 'Automatic rates are on. 1 linked card type gets its ranges and rates from the rate provider every hour; ';
    const tail = '. Changes you make to them here are replaced then.';
    const cases: Array<[number, string]> = [
      [-1_800_000, 'the next update is due around 26 Oct 2026, 13:30 WAT'],
      [0, 'the next update is due around 26 Oct 2026, 13:00 WAT'],
      [1, 'the next update starts within 5 minutes'],
      [599_999, 'the next update starts within 5 minutes'],
      [600_000, 'the next update has been overdue since 26 Oct 2026, 12:50 WAT'],
      [900_000, 'the next update has been overdue since 26 Oct 2026, 12:45 WAT'],
    ];
    for (const [late, due] of cases) {
      const automatic = model.toRatesAutomatic({
        enabled: true, interval_minutes: 60, next_due_at: new Date(read - late).toISOString(), stale: false, failures: 1,
        linked_card_type_ids: [PHYSICAL],
      });
      assert.ok(automatic);
      assert.deepEqual(model.automaticNotice(automatic, read), { tone: 'info', text: `${lead}${due}${tail}` }, `${late} ms late`);
    }
    const page = readFileSync(resolve(APP_DIR, '(dashboard)', 'rates', 'page.tsx'), 'utf8');
    assert.match(page, /const updatedAt = snapshot \? rates\.lastUpdatedAt : null;/);
    assert.match(page, /const liveNotice = automatic && updatedAt !== null \? automaticNotice\(automatic, updatedAt\) : null;/);
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
      details: {
        saved: 0,
        unchanged: 1,
        failed: 2,
        results: [
          { id: D1, status: 'conflict', rate_naira: 1600, is_active: true },
          { id: D2, status: 'unchanged', rate_naira: 1550, is_active: true },
          { id: D3, status: 'missing', rate_naira: null, is_active: null },
        ],
        audit_recorded: true,
      },
    }, 409));
    assert.deepEqual(model.classifySave(await patch()), {
      kind: 'conflict',
      results: [
        { id: D1, status: 'conflict', rate: 1600, active: true },
        { id: D2, status: 'unchanged', rate: 1550, active: true },
        { id: D3, status: 'missing', rate: null, active: null },
      ],
    });

    respond(() => json({
      success: false, error: conflict, code: 'STATE_CONFLICT', message: conflict,
      details: { results: [{ id: D1, status: 'error', rate_naira: 1500, is_active: true }] },
    }, 409));
    assert.deepEqual(model.classifySave(await patch()), { kind: 'retry', message: conflict });

    const notSaved = 'The database did not accept the rate changes, so nothing was saved. Try again.';
    respond(() => json({ success: false, error: notSaved, code: 'INTERNAL_ERROR', message: notSaved }, 500));
    assert.deepEqual(model.classifySave(await patch()), { kind: 'retry', message: notSaved });

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

  describe('a refused save', () => {
    const CONFLICT_REASON = 'Someone else changed this to ₦1,600.00 before your save reached it.';
    const ALREADY_LIVE = 'Someone else already made this change, so there is nothing left to save.';

    function staged(): { draft: Draft; pending: PendingChange[] } {
      const snap = snapshot();
      let draft = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
      draft = model.editRate(draft, row(snap, D2), '1650');
      draft = model.editRate(draft, row(snap, D3), '1200');
      draft = model.editRate(draft, row(snap, D4), '2000');
      const pending = pendingFor(snap, draft);
      return { draft: { ...draft, [D2]: { ...draft[D2], failure: 'From an earlier save.' } }, pending };
    }

    const outcome = {
      kind: 'conflict' as const,
      results: [
        { id: D1, status: 'conflict' as const, rate: 1600, active: true },
        { id: D3, status: 'missing' as const, rate: null, active: null },
        { id: D4, status: 'unchanged' as const, rate: 2000, active: true },
      ],
    };

    test('saves nothing: conflicts are listed, blocked edits stay staged and already-live rows are done', () => {
      const { draft, pending } = staged();
      const fresh = snapshot({ [D1]: { rate_naira: 1600 }, [D4]: { rate_naira: 2000 } }, [D3]);
      const settled = model.settleSave(draft, pending, outcome, fresh);
      assert.deepEqual(Object.keys(settled.draft).sort(), [D1, D2].sort());
      assert.equal(settled.draft[D1].rate, '1550');
      assert.equal(settled.draft[D1].failure, CONFLICT_REASON);
      assert.deepEqual(settled.draft[D1].base, { rate: 1600, active: true });
      assert.deepEqual(settled.draft[D1].conflict, { rate: 1600, active: true });
      assert.equal(settled.draft[D2].rate, '1650');
      assert.equal(settled.draft[D2].failure, null);
      assert.equal(settled.cleared, false);
      assert.deepEqual(settled.notice, {
        tone: 'danger',
        title: 'None of the 4 rate changes were saved',
        message: 'Rate changes are saved together, and 2 ranges changed or were removed after you loaded them. 2 changes are still marked as unsaved below. Review and save again.',
        items: [
          { id: D1, title: row(snapshot(), D1).title, detail: CONFLICT_REASON },
          { id: D3, title: row(snapshot(), D3).title, detail: 'This range no longer exists.' },
          { id: D4, title: row(snapshot(), D4).title, detail: ALREADY_LIVE },
        ],
      });
      assert.deepEqual(settled.toasts, [{ text: 'Nothing was saved. Check the notice above the rates.', tone: 'error' }]);
      for (const text of [settled.notice?.title ?? '', settled.notice?.message ?? '', ...settled.toasts.map((toast) => toast.text)]) {
        assert.doesNotMatch(text, /\d+ of \d+/);
        assert.doesNotMatch(text, /saved and (is|are) live/);
      }
    });

    test('without fresh rates every blocked or conflicting edit stays staged and a refresh is suggested', () => {
      const { draft, pending } = staged();
      const settled = model.settleSave(draft, pending, outcome, null);
      assert.deepEqual(Object.keys(settled.draft).sort(), [D1, D2, D3].sort());
      assert.equal(settled.draft[D1].failure, CONFLICT_REASON);
      assert.deepEqual(settled.draft[D1].base, { rate: 1500, active: true });
      assert.equal(settled.draft[D2].failure, null);
      assert.equal(settled.draft[D3].failure, 'This range no longer exists.');
      assert.equal(
        settled.notice?.message,
        'Rate changes are saved together, and 2 ranges changed or were removed after you loaded them. 3 changes are still marked as unsaved below. Review and save again.',
      );
      assert.deepEqual(settled.toasts, [
        { text: 'Nothing was saved. Check the notice above the rates.', tone: 'error' },
        { text: 'The live rates could not be reloaded. Refresh to see them.', tone: 'warning' },
      ]);
    });

    test('a single change that conflicted or vanished', () => {
      const snap = snapshot();
      const draft = model.editRate(model.EMPTY_DRAFT, row(snap, D1), '1550');
      const pending = pendingFor(snap, draft);
      const conflicted = model.settleSave(draft, pending, {
        kind: 'conflict', results: [{ id: D1, status: 'conflict', rate: 1600, active: true }],
      }, snapshot({ [D1]: { rate_naira: 1600 } }));
      assert.equal(conflicted.notice?.title, 'The rate change was not saved');
      assert.equal(
        conflicted.notice?.message,
        'The range changed or was removed after you loaded it. 1 change is still marked as unsaved below. Review and save again.',
      );
      assert.equal(conflicted.draft[D1].failure, CONFLICT_REASON);

      const vanished = model.settleSave(draft, pending, {
        kind: 'conflict', results: [{ id: D1, status: 'missing', rate: null, active: null }],
      }, snapshot({}, [D1]));
      assert.deepEqual(vanished.draft, {});
      assert.equal(vanished.notice?.message, 'The range changed or was removed after you loaded it.');
      assert.deepEqual(vanished.notice?.items.map((item) => item.detail), ['This range no longer exists.']);
    });
  });

  test('failure reasons', () => {
    assert.equal(model.failureReason({ id: D1, status: 'missing', rate: null, active: null }), 'This range no longer exists.');
    assert.equal(
      model.failureReason({ id: D1, status: 'conflict', rate: 1600, active: false }),
      'Someone else changed this to ₦1,600.00 (switched off) before your save reached it.',
    );
    assert.equal(
      model.failureReason({ id: D1, status: 'conflict', rate: null, active: null }),
      'Someone else changed this range before your save reached it.',
    );
    assert.equal(model.failureReason({ id: D1, status: 'unchanged', rate: 1500, active: true }), '');
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

  test('saving or adding a range on a linked card type while automatic rates are on says the next update replaces it', () => {
    const snap = snapshot();
    const read = Date.parse('2026-10-26T12:00:00.000Z');
    const due = '26 Oct 2026, 13:30 WAT';
    const on = model.toRatesAutomatic({
      enabled: true, interval_minutes: 60, next_due_at: '2026-10-26T12:30:00.000Z', stale: false, failures: 0, linked_card_type_ids: [PHYSICAL],
    });
    const off = model.toRatesAutomatic({
      enabled: false, interval_minutes: 60, next_due_at: null, stale: false, failures: 0, linked_card_type_ids: [PHYSICAL],
    });
    assert.ok(on && off);
    assert.deepEqual(options.reviewOptions(edits(snap, { [D1]: '1550' }), on, read).consequences, [
      `This change is on a linked card type. The next automatic update, due around ${due}, replaces it with the rate provider’s rate.`,
    ]);
    assert.deepEqual(options.reviewOptions(edits(snap, { [D1]: '1550', [D4]: '1950' }), on, read).consequences, [
      `1 of these changes is on a linked card type. The next automatic update, due around ${due}, replaces it with the rate provider’s rate.`,
    ]);
    assert.deepEqual(options.reviewOptions(edits(snap, { [D1]: '1550', [D2]: '1600' }), on, read).consequences, [
      `2 of these changes are on linked card types. The next automatic update, due around ${due}, replaces them with the rate provider’s rates.`,
    ]);
    assert.equal(options.reviewOptions(edits(snap, { [D1]: '1550' }), off, read).consequences, undefined);
    assert.equal(options.reviewOptions(edits(snap, { [D4]: '1950' }), on, read).consequences, undefined);
    assert.equal(options.reviewOptions(edits(snap, { [D1]: '1550' })).consequences, undefined);

    const values = { label: '$90–$150', min: 90, max: 150, rate: 1500, active: true };
    const linked = model.addTarget(snap.cards[0].groups[0]);
    assert.deepEqual(options.addRangeOptions(linked, values, [], on, read).consequences, [
      `This card type is linked to the rate provider. At the next update, due around ${due}, its ranges are replaced by the provider’s: this range is switched off, or repriced if the provider quotes exactly this range.`,
    ]);
    assert.equal(options.addRangeOptions(linked, values, [], off, read).consequences, undefined);
    assert.equal(options.addRangeOptions(model.addTarget(snap.cards[1].groups[0]), values, [], on, read).consequences, undefined);
  });

  test('the save and add-range confirms word the next update like the page notice: due around while ahead, a start within 5 minutes for 10 minutes, then overdue since', () => {
    const snap = snapshot();
    const read = Date.parse('2026-10-26T12:00:00.000Z');
    const changes = edits(snap, { [D1]: '1550' });
    const target = model.addTarget(snap.cards[0].groups[0]);
    const values = { label: '$90–$150', min: 90, max: 150, rate: 1500, active: true };
    const lead = 'Automatic rates are on. 1 linked card type gets its ranges and rates from the rate provider every hour; the next update ';
    const tail = '. Changes you make to them here are replaced then.';
    const warning = 'Automatic rates are on, but recent updates have not succeeded. Linked card types keep their current rates until one does.';
    const timing = (text: string) => text.match(
      /due around \d{1,2} \w{3} \d{4}, \d{2}:\d{2} WAT|starts within 5 minutes|has been overdue since \d{1,2} \w{3} \d{4}, \d{2}:\d{2} WAT/,
    )?.[0];
    const cases: Array<[number, boolean, string, string]> = [
      [-1_800_000, false, 'is due around 26 Oct 2026, 13:30 WAT', 'due around 26 Oct 2026, 13:30 WAT'],
      [0, false, 'is due around 26 Oct 2026, 13:00 WAT', 'due around 26 Oct 2026, 13:00 WAT'],
      [1, false, 'starts within 5 minutes', 'which starts within 5 minutes'],
      [599_999, false, 'starts within 5 minutes', 'which starts within 5 minutes'],
      [600_000, false, 'has been overdue since 26 Oct 2026, 12:50 WAT', 'which has been overdue since 26 Oct 2026, 12:50 WAT'],
      [10_800_000, true, 'has been overdue since 26 Oct 2026, 10:00 WAT', 'which has been overdue since 26 Oct 2026, 10:00 WAT'],
    ];
    for (const [late, stale, predicate, aside] of cases) {
      const automatic = model.toRatesAutomatic({
        enabled: true, interval_minutes: 60, next_due_at: new Date(read - late).toISOString(), stale, failures: stale ? 1 : 0,
        linked_card_type_ids: [PHYSICAL],
      });
      assert.ok(automatic);
      const save = options.reviewOptions(changes, automatic, read).consequences;
      const add = options.addRangeOptions(target, values, [], automatic, read).consequences;
      assert.deepEqual(save, [
        `This change is on a linked card type. The next automatic update, ${aside}, replaces it with the rate provider’s rate.`,
      ], `save ${late} ms late`);
      assert.deepEqual(add, [
        `This card type is linked to the rate provider. At the next update, ${aside}, its ranges are replaced by the provider’s: this range is switched off, or repriced if the provider quotes exactly this range.`,
      ], `add ${late} ms late`);
      assert.ok(save && add);
      const notice = model.automaticNotice(automatic, read);
      const timed = stale ? model.automaticNotice({ ...automatic, stale: false, failures: 0 }, read) : notice;
      assert.deepEqual(notice, stale ? { tone: 'warning', text: warning } : { tone: 'info', text: `${lead}${predicate}${tail}` }, `notice ${late} ms late`);
      assert.ok(timed);
      assert.equal(timed.text, `${lead}${predicate}${tail}`, `timed notice ${late} ms late`);
      const said = timing(timed.text);
      assert.ok(said, `the notice has a timing ${late} ms late`);
      assert.equal(timing(save[0]), said, `save agrees with the notice ${late} ms late`);
      assert.equal(timing(add[0]), said, `add agrees with the notice ${late} ms late`);
      if (late >= 600_000) {
        for (const text of [save[0], add[0]]) assert.doesNotMatch(text, /due around|starts within/, `no promised start ${late} ms late`);
      }
    }
    assert.equal('dueText' in model, false);
    const dialogs = readFileSync(resolve(APP_DIR, '(dashboard)', 'rates', 'confirmOptions.tsx'), 'utf8');
    assert.doesNotMatch(dialogs, /due around|starts within|overdue since|\b(?:stamp|lateBy|overdue|dueNow)\(/);
    const page = readFileSync(resolve(APP_DIR, '(dashboard)', 'rates', 'page.tsx'), 'utf8');
    assert.match(page, /const fresh = await refreshRates\(\);\s*const readAt = Date\.now\(\);/);
    assert.match(page, /\.\.\.reviewOptions\(pending\.changes, fresh\.data\.automatic, readAt\),/);
    assert.match(page, /\.\.\.addRangeOptions\(target, values, overlapsFor\(target, values\.min, values\.max\), automatic, rates\.lastUpdatedAt\),/);
    assert.equal(page.match(/Date\.now\(\)/g)?.length, 1);
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

  test('a linked card type shows Automatic and the group note while automatic rates are on, and Linked while they are off', () => {
    const snap = snapshot();
    const summary = {
      enabled: true, interval_minutes: 60, next_due_at: '2026-10-26T12:30:00.000Z', stale: false, failures: 0, linked_card_type_ids: [PHYSICAL],
    };
    const on = model.toRatesAutomatic(summary);
    const off = model.toRatesAutomatic({ ...summary, enabled: false, next_due_at: null });
    assert.ok(on && off);
    const note = 'Ranges and rates come from the rate provider. Changes here are replaced at the next update.';
    const live = section(snap, { automatic: on });
    const liveBadges = tagsOf(live, 'span').filter((attrs) => classesOf(attrs).includes('badge'));
    assert.deepEqual(liveBadges.map((attrs) => classesOf(attrs)), [['badge', 'info']]);
    assert.match(textOf(live), /United States · Physical ₦ per \$1 Automatic Add range/);
    assert.ok(textOf(live).includes(note));
    assert.match(live, /<p class="groupNote">Ranges and rates come from the rate provider\./);
    const quiet = section(snap, { automatic: off });
    assert.deepEqual(tagsOf(quiet, 'span').filter((attrs) => classesOf(attrs).includes('badge')).map((attrs) => classesOf(attrs)), [['badge', 'neutral']]);
    assert.match(textOf(quiet), /United States · Physical ₦ per \$1 Linked Add range/);
    assert.ok(!textOf(quiet).includes(note));
    const plain = section(snap);
    assert.equal(tagsOf(plain, 'span').filter((attrs) => classesOf(attrs).includes('badge')).length, 0);
    assert.ok(!textOf(plain).includes(note));
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

interface RouteClaims {
  admin_id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  token_version: number;
}

interface RpcCall {
  name: string;
  args: unknown;
}

interface DbReply {
  data: unknown;
  error: { message: string; code?: string } | null;
}

interface RouteChain {
  insert(row: Record<string, unknown>): Promise<DbReply>;
  select(): RouteChain;
  eq(): RouteChain;
  order(): RouteChain;
  range(from: number, to: number): Promise<DbReply & { count: number }>;
}

interface RouteHarness {
  claims: RouteClaims | null;
  headers: Record<string, string>;
  rpcCalls: RpcCall[];
  reply: DbReply;
  tables: string[];
  selects: Record<string, unknown[]>;
  audits: Record<string, unknown>[];
  auditFailure: string | null;
  from(table: string): RouteChain;
  rpc(name: string, args: unknown): Promise<DbReply>;
}

interface RatesRoute {
  GET: () => Promise<Response>;
  PATCH: (req: Request) => Promise<Response>;
}

interface RouteReply {
  status: number;
  body: Record<string, unknown>;
}

type Pair = [number | null, boolean];

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const ROUTE_HARNESS_KEY = '__ratesRouteHarness';
const ROUTE_REQUEST_ID = 'req_ratestest01';
const ROUTE_USER_AGENT = 'rates-route-test';
const ROUTE_CLIENT_IP = '198.51.100.23';
const ADMIN_ID = '0e000000-0000-4000-8000-000000000001';
const NOT_SAVED = 'The database did not accept the rate changes, so nothing was saved. Try again.';
const UNCONFIRMED = 'The save could not be confirmed. Reload the rates to check them before trying again.';

const OWNER: RouteClaims = {
  admin_id: ADMIN_ID,
  username: 'owner',
  role_title: 'Super Admin',
  is_super_admin: true,
  page_permissions: [],
  token_version: 0,
};

function rateStaff(grants: string[]): RouteClaims {
  return { ...OWNER, username: 'rates', role_title: 'Rates desk', is_super_admin: false, page_permissions: grants };
}

const RANGE_CONTEXT: Readonly<Record<string, { card_type_id: string; range_label: string; min_value: number; max_value: number }>> = {
  [D1]: { card_type_id: PHYSICAL, range_label: '$25–$99', min_value: 25, max_value: 99 },
  [D2]: { card_type_id: PHYSICAL, range_label: '$100–$500', min_value: 100, max_value: 500 },
  [D3]: { card_type_id: PHYSICAL, range_label: '$501–$1000', min_value: 501, max_value: 1000 },
  [D4]: { card_type_id: ECODE, range_label: '£10–£50', min_value: 10, max_value: 50 },
};

const routeHarness: RouteHarness = {
  claims: OWNER,
  headers: {},
  rpcCalls: [],
  reply: { data: null, error: null },
  tables: [],
  selects: {},
  audits: [],
  auditFailure: null,
  from(table) {
    routeHarness.tables.push(table);
    const rows = Object.prototype.hasOwnProperty.call(routeHarness.selects, table) ? routeHarness.selects[table] : [];
    const chain: RouteChain = {
      async insert(row) {
        if (table !== 'audit_log') throw new Error(`unexpected insert into ${table}`);
        if (routeHarness.auditFailure) return { data: null, error: { message: routeHarness.auditFailure } };
        routeHarness.audits.push(row);
        return { data: null, error: null };
      },
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null, count: rows.length }),
    };
    return chain;
  },
  async rpc(name, args) {
    routeHarness.rpcCalls.push({ name, args });
    return routeHarness.reply;
  },
};
(globalThis as unknown as Record<string, unknown>)[ROUTE_HARNESS_KEY] = routeHarness;

const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const harnessRef = `const harness = () => globalThis.${ROUTE_HARNESS_KEY};`;

const ROUTE_FILE_STUBS: Readonly<Record<string, string>> = {
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: moduleUrl(`${harnessRef}
export const supabaseAdmin = {
  from: (table) => harness().from(table),
  rpc: (name, args) => harness().rpc(name, args),
};`),
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: moduleUrl(`${harnessRef}
export async function verifyAdminFromRequest() { return harness().claims; }`),
};

const ROUTE_PACKAGE_STUBS: Readonly<Record<string, string>> = {
  'next/headers': moduleUrl(`${harnessRef}
export async function headers() { return new Headers(harness().headers); }
export async function cookies() { return { get: () => undefined }; }`),
  'next/server': moduleUrl('export const NextResponse = { json: (body, init) => Response.json(body, init) };'),
};

const ROUTE_IMPORTS = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;
const routeBundles = new Map<string, Promise<string>>();

function resolveRouteImport(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const found = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]
    .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
  if (!found) throw new Error(`${fromFile} imports ${specifier}, which does not resolve to a .ts file`);
  return found;
}

async function compileRouteModule(file: string): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const targets = new Map<string, string>();
  for (const [, , specifier] of outputText.matchAll(ROUTE_IMPORTS)) {
    if (targets.has(specifier)) continue;
    if (specifier.startsWith('.')) {
      const target = resolveRouteImport(file, specifier);
      targets.set(specifier, ROUTE_FILE_STUBS[target] ?? (await bundleRouteModule(target)));
    } else if (ROUTE_PACKAGE_STUBS[specifier]) {
      targets.set(specifier, ROUTE_PACKAGE_STUBS[specifier]);
    } else {
      throw new Error(`${file} imports ${specifier}, which this test does not provide`);
    }
  }
  return moduleUrl(outputText.replace(ROUTE_IMPORTS, (match: string, head: string, specifier: string) => {
    const target = targets.get(specifier);
    return target ? `${head}'${target}'` : match;
  }));
}

function bundleRouteModule(file: string): Promise<string> {
  let pending = routeBundles.get(file);
  if (!pending) {
    pending = compileRouteModule(file);
    routeBundles.set(file, pending);
  }
  return pending;
}

let ratesRoute: RatesRoute;

function resetRoute(claims: RouteClaims | null = OWNER): void {
  routeHarness.claims = claims;
  routeHarness.headers = {
    'x-request-id': ROUTE_REQUEST_ID,
    'user-agent': ROUTE_USER_AGENT,
    'x-forwarded-for': ROUTE_CLIENT_IP,
  };
  routeHarness.rpcCalls = [];
  routeHarness.reply = { data: null, error: null };
  routeHarness.tables = [];
  routeHarness.selects = {};
  routeHarness.audits = [];
  routeHarness.auditFailure = null;
}

async function patchRates(body: unknown): Promise<RouteReply> {
  const response = await ratesRoute.PATCH(new Request('http://admin.test/api/rates', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function failureBody(message: string, code: string, extra: Record<string, unknown> = {}) {
  return { success: false, error: message, code, message, request_id: ROUTE_REQUEST_ID, ...extra };
}

function auditRow(fields: { entity_id: string; before_value?: unknown; after_value: unknown; result?: string; error?: string }) {
  return {
    admin_id: ADMIN_ID,
    user_id: null,
    action: 'UPDATE_RATE',
    entity: 'denominations',
    entity_id: fields.entity_id,
    before_value: fields.before_value ?? null,
    after_value: fields.after_value,
    ip_address: ROUTE_CLIENT_IP,
    admin_role: OWNER.role_title,
    user_agent: ROUTE_USER_AGENT,
    request_id: ROUTE_REQUEST_ID,
    reason: null,
    result: fields.result ?? 'success',
    error: fields.error ?? null,
    sensitivity: 'financial',
  };
}

function beforeValue(id: string, [rate, active]: Pair) {
  return { rate_naira: rate, is_active: active, ...RANGE_CONTEXT[id] };
}

function doneRow(index: number, id: string, before: Pair, after: Pair, status: 'saved' | 'unchanged' = 'saved') {
  return {
    index,
    id,
    status,
    before: { rate_naira: before[0], is_active: before[1] },
    ...RANGE_CONTEXT[id],
    rate_naira: after[0],
    is_active: after[1],
  };
}

function refusedRow(index: number, id: string, status: 'conflict' | 'missing', live: Pair | null = null) {
  const context = live ? RANGE_CONTEXT[id] : { card_type_id: null, range_label: null, min_value: null, max_value: null };
  return {
    index,
    id,
    status,
    rate_naira: live ? live[0] : null,
    is_active: live ? live[1] : null,
    ...context,
    expected: { rate_naira: 1500, is_active: true },
    requested: { rate_naira: 1550, is_active: true },
  };
}

function applied(saved: string[], unchanged: string[], results: unknown[]): DbReply {
  return { data: { applied: true, saved, unchanged, results }, error: null };
}

function refused(conflicts: unknown[], invalid: unknown[], unchanged: string[]): DbReply {
  return { data: { applied: false, conflicts, invalid, unchanged }, error: null };
}

function raised(message: string, code = 'P0001'): DbReply {
  return { data: null, error: { code, message } };
}

function saveCall(): Record<string, unknown> {
  assert.equal(routeHarness.rpcCalls.length, 1);
  const [call] = routeHarness.rpcCalls;
  assert.equal(call.name, 'admin_save_rates');
  assert.deepEqual(JSON.parse(JSON.stringify(call.args)), call.args, 'no parameter may be undefined');
  return call.args as Record<string, unknown>;
}

describe('PATCH /api/rates saves through admin_save_rates', () => {
  const WEB_CHANGES = [
    { id: D1, rate_naira: 1550, is_active: true, expected: { rate_naira: 1500, is_active: true } },
    { id: D2, rate_naira: 1600, is_active: false, expected: { rate_naira: 1550, is_active: true } },
    { id: D3, rate_naira: 1200, is_active: true, expected: { rate_naira: 0, is_active: false } },
  ];
  const WEB_BODY = { changes: WEB_CHANGES };

  before(async () => {
    ratesRoute = (await import(await bundleRouteModule(resolve(APP_DIR, 'api', 'rates', 'route.ts')))) as RatesRoute;
  });

  beforeEach(() => {
    resetRoute();
    mock.method(console, 'error', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test('no session is 401 and the database is never called', async () => {
    resetRoute(null);
    const res = await patchRates(WEB_BODY);
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, failureBody('Your session has expired. Sign in again.', 'AUTH_REQUIRED'));
    assert.deepEqual(routeHarness.rpcCalls, []);
    assert.deepEqual(routeHarness.tables, []);
  });

  test('saving needs rates.write: a viewer is refused with 403 before the database', async () => {
    resetRoute(rateStaff(['rates.read']));
    const viewer = await patchRates(WEB_BODY);
    assert.equal(viewer.status, 403);
    assert.equal(viewer.body.code, 'PERMISSION_DENIED');
    assert.deepEqual(viewer.body.details, { required: ['rates.write'] });
    assert.deepEqual(routeHarness.rpcCalls, []);

    resetRoute(rateStaff(['rates_management']));
    routeHarness.reply = applied([], [D1], [doneRow(0, D1, [1550, true], [1550, true], 'unchanged')]);
    const manager = await patchRates({ changes: [{ id: D1, rate_naira: 1550, is_active: true }] });
    assert.equal(manager.status, 200);
    assert.equal(saveCall().p_admin_id, ADMIN_ID);
  });

  test('bodies the checks refuse keep their messages and never reach the database', async () => {
    const cases: ReadonlyArray<[unknown, string]> = [
      ['not json', 'No changes provided.'],
      [{ changes: [] }, 'No changes provided.'],
      [{ changes: Array.from({ length: 501 }, () => ({ id: D1, rate_naira: 1 })) }, 'Save at most 500 rate changes at a time.'],
      [{ changes: ['x'] }, 'Change 1 is not a valid rate change.'],
      [{ changes: [{ id: 'nope', rate_naira: 1 }] }, 'Change 1 does not name a valid range.'],
      [{ changes: [{ id: D1, rate_naira: 1 }, { id: D1, rate_naira: 2 }] }, `Range ${D1} appears more than once in this save.`],
      [{ changes: [{ id: D1, rate_naira: -1 }] }, `The rate for range ${D1} must be a number from 0 to ₦99,999,999.99.`],
      [{ changes: [{ id: D1, rate_naira: 1, is_active: 'yes' }] }, `The active setting for range ${D1} must be true or false.`],
      [{ changes: [{ id: D1, rate_naira: 1, expected: { is_active: true } }] }, `The expected values sent for range ${D1} are not valid.`],
    ];
    for (const [body, message] of cases) {
      resetRoute();
      const res = await patchRates(body);
      assert.equal(res.status, 400, message);
      assert.deepEqual(res.body, failureBody(message, 'VALIDATION_ERROR'), message);
      assert.deepEqual(routeHarness.rpcCalls, [], message);
      assert.deepEqual(routeHarness.tables, [], message);
    }
  });

  test('the function gets every named parameter, rebuilt from the checked body, with null and never undefined', async () => {
    const lettered = 'ab000000-0000-4000-8000-0000000000cd';
    routeHarness.reply = applied([], [lettered, D2, D3], [
      { ...doneRow(0, D1, [1550.5, true], [1550.5, true], 'unchanged'), id: lettered },
      doneRow(1, D2, [1600, false], [1600, false], 'unchanged'),
      doneRow(2, D3, [1200, false], [1200, false], 'unchanged'),
    ]);
    const res = await patchRates({
      changes: [
        { id: ` ${lettered.toUpperCase()} `, rate_naira: '1550.50' },
        { id: D2, rate_naira: 1600, is_active: false, expected: { rate_naira: '1550', is_active: true } },
        { id: D3, rate_naira: 1200, is_active: null, expected: { rate_naira: null, is_active: null } },
      ],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(saveCall(), {
      p_admin_id: ADMIN_ID,
      p_changes: [
        { id: lettered, rate_naira: 1550.5, is_active: null, expected: null },
        { id: D2, rate_naira: 1600, is_active: false, expected: { rate_naira: 1550, is_active: true } },
        { id: D3, rate_naira: 1200, is_active: null, expected: { rate_naira: null, is_active: false } },
      ],
    });
    assert.deepEqual(routeHarness.tables, []);
  });

  test('applied: results come back in order and each saved row gets one UPDATE_RATE audit with its before and after', async () => {
    routeHarness.reply = applied([D1, D2], [D3], [
      doneRow(0, D1, [1500, true], [1550, true]),
      doneRow(1, D2, [1550, true], [1600, false]),
      doneRow(2, D3, [1200, true], [1200, true], 'unchanged'),
    ]);
    const res = await patchRates(WEB_BODY);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      success: true,
      request_id: ROUTE_REQUEST_ID,
      saved: 2,
      unchanged: 1,
      results: [
        { id: D1, status: 'saved', rate_naira: 1550, is_active: true },
        { id: D2, status: 'saved', rate_naira: 1600, is_active: false },
        { id: D3, status: 'unchanged', rate_naira: 1200, is_active: true },
      ],
      audit_recorded: true,
    });
    assert.deepEqual(saveCall().p_changes, WEB_CHANGES);
    assert.deepEqual(routeHarness.audits, [
      auditRow({ entity_id: D1, before_value: beforeValue(D1, [1500, true]), after_value: { rate_naira: 1550, is_active: true } }),
      auditRow({ entity_id: D2, before_value: beforeValue(D2, [1550, true]), after_value: { rate_naira: 1600, is_active: false } }),
    ]);
    assert.deepEqual(routeHarness.tables, ['audit_log', 'audit_log']);
  });

  test('applied with every value already live: no audit rows and no warning', async () => {
    routeHarness.reply = applied([], [D1], [doneRow(0, D1, [1500, true], [1500, true], 'unchanged')]);
    const res = await patchRates({ changes: [{ id: D1, rate_naira: 1500, is_active: true }] });
    assert.deepEqual(res.body, {
      success: true,
      request_id: ROUTE_REQUEST_ID,
      saved: 0,
      unchanged: 1,
      results: [{ id: D1, status: 'unchanged', rate_naira: 1500, is_active: true }],
      audit_recorded: true,
    });
    assert.deepEqual(routeHarness.audits, []);
    assert.deepEqual(routeHarness.tables, []);
  });

  test('a failed audit write keeps the save and says so', async () => {
    routeHarness.auditFailure = 'audit insert refused';
    routeHarness.reply = applied([D1, D2], [], [
      doneRow(0, D1, [1500, true], [1550, true]),
      doneRow(1, D2, [1550, true], [1600, true]),
    ]);
    const many = await patchRates({ changes: [{ id: D1, rate_naira: 1550 }, { id: D2, rate_naira: 1600 }] });
    assert.equal(many.status, 200);
    assert.equal(many.body.saved, 2);
    assert.equal(many.body.audit_recorded, false);
    assert.equal(many.body.warning, 'The rates were saved, but some changes could not be written to the audit log.');

    resetRoute();
    routeHarness.auditFailure = 'audit insert refused';
    routeHarness.reply = applied([D1], [], [doneRow(0, D1, [1500, true], [1550, true])]);
    const one = await patchRates({ changes: [{ id: D1, rate_naira: 1550 }] });
    assert.equal(one.status, 200);
    assert.equal(one.body.audit_recorded, false);
    assert.equal(one.body.warning, 'The rate was saved, but the change could not be written to the audit log.');
  });

  test('refused for conflicts: 409, nothing saved, conflicting and already-live rows listed in order, no audit', async () => {
    routeHarness.reply = refused([refusedRow(0, D1, 'conflict', [1600, true]), refusedRow(2, D3, 'missing')], [], [D2]);
    const changes = [...WEB_CHANGES, { id: D4, rate_naira: 2000, is_active: true, expected: { rate_naira: 1900, is_active: true } }];
    const res = await patchRates({ changes });
    const message = 'None of the 4 rate changes were saved: they are saved together, and 2 rates changed or were removed after you loaded them. Reload the rates and review them again.';
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, failureBody(message, 'STATE_CONFLICT', {
      details: {
        saved: 0,
        unchanged: 1,
        failed: 3,
        results: [
          { id: D1, status: 'conflict', rate_naira: 1600, is_active: true },
          { id: D2, status: 'unchanged', rate_naira: 1600, is_active: false },
          { id: D3, status: 'missing', rate_naira: null, is_active: null },
        ],
        audit_recorded: true,
      },
    }));
    assert.deepEqual(saveCall().p_changes, changes);
    assert.deepEqual(routeHarness.audits, []);
    assert.deepEqual(routeHarness.tables, []);

    respond(() => json(res.body, res.status));
    assert.deepEqual(model.classifySave(await patch()), {
      kind: 'conflict',
      results: [
        { id: D1, status: 'conflict', rate: 1600, active: true },
        { id: D2, status: 'unchanged', rate: 1600, active: false },
        { id: D3, status: 'missing', rate: null, active: null },
      ],
    });
  });

  test('the mobile body { changes: [{ id, rate_naira, is_active }] } is sent with expected null and keeps its answers', async () => {
    const mobile = { changes: [{ id: D1, rate_naira: 1650, is_active: true }] };
    routeHarness.reply = applied([D1], [], [doneRow(0, D1, [1500, true], [1650, true])]);
    const saved = await patchRates(mobile);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.success, true);
    assert.deepEqual(saveCall().p_changes, [{ id: D1, rate_naira: 1650, is_active: true, expected: null }]);

    resetRoute();
    routeHarness.reply = refused([refusedRow(0, D1, 'missing')], [], []);
    const gone = await patchRates(mobile);
    assert.equal(gone.status, 409);
    assert.equal(
      gone.body.error,
      'The rate change was not saved. 1 rate changed or was removed after you loaded it. Reload the rates and review them again.',
    );
  });

  test('refused for invalid entries: 400 with the message the body check gives, and nothing saved', async () => {
    routeHarness.reply = refused(
      [refusedRow(0, D1, 'conflict', [1600, true])],
      [{ index: 1, id: D2, reason: 'invalid_rate' }],
      [],
    );
    const rate = await patchRates(WEB_BODY);
    assert.equal(rate.status, 400);
    assert.deepEqual(rate.body, failureBody(`The rate for range ${D2} must be a number from 0 to ₦99,999,999.99.`, 'VALIDATION_ERROR', {
      details: { invalid: [{ index: 1, id: D2, reason: 'invalid_rate' }] },
    }));
    assert.deepEqual(routeHarness.audits, []);

    resetRoute();
    routeHarness.reply = refused([], [{ index: 0, id: null, reason: 'not_an_object' }], []);
    const shape = await patchRates(WEB_BODY);
    assert.equal(shape.status, 400);
    assert.equal(shape.body.error, 'Change 1 is not a valid rate change.');
    assert.deepEqual(routeHarness.audits, []);
  });

  test('raised errors: a deactivated admin gets exactly the guard answer, and the count checks keep their messages', async () => {
    resetRoute(null);
    const signedOut = await patchRates(WEB_BODY);

    resetRoute();
    routeHarness.reply = raised('Not authorized');
    const deactivated = await patchRates(WEB_BODY);
    assert.equal(deactivated.status, 401);
    assert.deepEqual(deactivated, signedOut);
    assert.equal(routeHarness.rpcCalls.length, 1);
    assert.deepEqual(routeHarness.audits, []);

    const counts: ReadonlyArray<[string, string]> = [
      ['No rate changes provided', 'No changes provided.'],
      ['Too many rate changes', 'Save at most 500 rate changes at a time.'],
    ];
    for (const [error, message] of counts) {
      resetRoute();
      routeHarness.reply = raised(error);
      const res = await patchRates(WEB_BODY);
      assert.equal(res.status, 400, error);
      assert.deepEqual(res.body, failureBody(message, 'VALIDATION_ERROR'), error);
      assert.deepEqual(routeHarness.audits, [], error);
    }
  });

  test('any other database error is a 500 that says nothing was saved, with one failure audit per change', async () => {
    routeHarness.reply = raised('deadlock detected', '40P01');
    const res = await patchRates({
      changes: [
        { id: D1, rate_naira: 1550, is_active: true, expected: { rate_naira: 1500, is_active: true } },
        { id: D2, rate_naira: '1600' },
      ],
    });
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, failureBody(NOT_SAVED, 'INTERNAL_ERROR'));
    assert.deepEqual(routeHarness.audits, [
      auditRow({ entity_id: D1, after_value: { rate_naira: 1550, is_active: true }, result: 'failure', error: 'deadlock detected' }),
      auditRow({ entity_id: D2, after_value: { rate_naira: 1600 }, result: 'failure', error: 'deadlock detected' }),
    ]);

    resetRoute();
    const schemaCache = 'Could not find the function public.admin_save_rates(p_admin_id, p_changes) in the schema cache';
    routeHarness.reply = raised(schemaCache, 'PGRST202');
    const missing = await patchRates({ changes: [{ id: D1, rate_naira: 1550 }] });
    assert.equal(missing.status, 500);
    assert.deepEqual(missing.body, failureBody(NOT_SAVED, 'INTERNAL_ERROR'));
    assert.deepEqual(routeHarness.audits, [
      auditRow({ entity_id: D1, after_value: { rate_naira: 1550 }, result: 'failure', error: schemaCache }),
    ]);

    resetRoute();
    routeHarness.reply = raised('Not authorized for this');
    assert.equal((await patchRates({ changes: [{ id: D1, rate_naira: 1550 }] })).status, 500);
  });

  test('a result in an unexpected shape is a 500 that claims nothing and writes no audit', async () => {
    const shapes: unknown[] = [
      null,
      [],
      { applied: 'yes', unchanged: [] },
      { applied: true, saved: [D1], results: [] },
      { applied: true, saved: [D1], unchanged: [] },
      { applied: true, saved: [D1], unchanged: [], results: [{ index: 0, id: D1, status: 'written', before: {} }] },
      { applied: true, saved: [D1], unchanged: [], results: [{ index: 0, id: D1, status: 'saved' }] },
      { applied: true, saved: [7], unchanged: [], results: [] },
      { applied: false, conflicts: [], invalid: [], unchanged: [] },
      { applied: false, conflicts: [{ id: D1, status: 'stale' }], invalid: [], unchanged: [] },
      { applied: false, conflicts: [], invalid: [{ index: '0', reason: 'invalid_rate' }], unchanged: [] },
      { applied: false, conflicts: [refusedRow(0, D1, 'missing')], unchanged: [] },
    ];
    for (const data of shapes) {
      resetRoute();
      routeHarness.reply = { data, error: null };
      const res = await patchRates(WEB_BODY);
      assert.equal(res.status, 500, JSON.stringify(data));
      assert.deepEqual(res.body, failureBody(UNCONFIRMED, 'INTERNAL_ERROR'), JSON.stringify(data));
      assert.deepEqual(routeHarness.audits, [], JSON.stringify(data));
    }
  });
});

describe('GET /api/rates answers the tree and the automatic summary', () => {
  const STATUS = {
    enabled: true,
    provider: 'acme',
    interval_minutes: 60,
    universal_markup_pct: 4,
    enabled_changed_at: '2026-10-26T09:00:00.000Z',
    updated_at: '2026-10-26T09:00:00.000Z',
    updated_by: null,
    linked_card_type_ids: [PHYSICAL],
    running: null,
    last_success: null,
    last_update: null,
    last_products: null,
    failures: 0,
    next_due_at: '2026-10-26T12:30:00.000Z',
    stale: false,
  };
  const TABLES: Record<string, unknown[]> = {
    cards: [{ id: AMAZON, name: 'Amazon', logo_url: null, is_active: true, sort_order: 1 }],
    card_countries: [{ id: US, card_id: AMAZON, country_code: 'US', country_name: 'United States', currency_symbol: '$' }],
    card_types: [{ id: PHYSICAL, card_id: AMAZON, country_code: 'US', name: 'Physical', sort_order: 1 }],
    denominations: [
      { id: D1, card_type_id: PHYSICAL, range_label: '$25–$99', min_value: 25, max_value: 99, rate_naira: 1500, is_active: true },
    ],
  };

  before(async () => {
    ratesRoute = (await import(await bundleRouteModule(resolve(APP_DIR, 'api', 'rates', 'route.ts')))) as RatesRoute;
  });

  beforeEach(() => {
    resetRoute();
    mock.method(console, 'error', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test('the phone keys are kept, and automatic carries only the six summary fields from rate_sync_status', async () => {
    routeHarness.selects = TABLES;
    routeHarness.reply = { data: STATUS, error: null };
    const res = await ratesRoute.GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ['success', 'request_id', 'cards', 'automatic']);
    assert.deepEqual(body.cards, rules.assembleRateTree(
      TABLES.cards as CardRow[], TABLES.card_countries as CountryRow[], TABLES.card_types as TypeRow[], TABLES.denominations as StoredDenomination[],
    ));
    assert.deepEqual(body.automatic, {
      enabled: true,
      interval_minutes: 60,
      next_due_at: '2026-10-26T12:30:00.000Z',
      stale: false,
      failures: 0,
      linked_card_type_ids: [PHYSICAL],
    });
    assert.deepEqual(routeHarness.rpcCalls.map((call) => call.name), ['rate_sync_status']);
    assert.deepEqual([...routeHarness.tables].sort(), ['card_countries', 'card_types', 'cards', 'denominations']);
    const parsed = model.toRatesSnapshot(body);
    assert.ok(parsed?.automatic);
    assert.equal(parsed.automatic.linked.has(PHYSICAL), true);
  });

  test('a status that cannot be read fails the read like any other', async () => {
    routeHarness.selects = TABLES;
    routeHarness.reply = { data: null, error: { message: 'function rate_sync_status() does not exist' } };
    const res = await ratesRoute.GET();
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as Record<string, unknown>).message, 'The rates could not be loaded. Try again.');
    routeHarness.reply = { data: [STATUS], error: null };
    assert.equal((await ratesRoute.GET()).status, 500);
  });

  test('the route reads the tree through the shared reader, and the old in-route copy is gone', () => {
    const source = readFileSync(resolve(APP_DIR, 'api', 'rates', 'route.ts'), 'utf8');
    assert.match(source, /^import \{ DENOMINATION_COLUMNS, loadRateTree \} from '\.\.\/\.\.\/lib\/rateTree';$/m);
    assert.match(source, /const \[cards, status\] = await Promise\.all\(\[loadRateTree\(\), readRateSync\('rate_sync_status'\)\]\);/);
    assert.match(source, /return ok\(\{ cards, automatic: ratesAutomatic\(status\) \}\);/);
    assert.doesNotMatch(source, /async function readAll|PAGE_ROWS|MAX_PAGES|assembleRateTree/);
    const reader = readFileSync(resolve(APP_DIR, 'lib', 'rateTree.ts'), 'utf8');
    assert.match(reader, /^export async function loadRateTree\(\): Promise<RateTreeCard\[\] \| null> \{$/m);
    assert.match(reader, /return assembleRateTree\(cards, countries, types, denominations\);/);
  });
});
