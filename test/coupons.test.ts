import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ElementType, type ReactNode } from 'react';
import { loadAppModule, render, textOf } from './support/uiHarness.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type {
  Brand, CouponForm, CouponRow, CouponsSnapshot, FormContext, MutationResult,
} from '../app/(dashboard)/coupons/model.ts';
import type { StoredCoupon } from '../app/(dashboard)/coupons/couponRules.ts';

type Rules = typeof import('../app/(dashboard)/coupons/couponRules.ts');
type Model = typeof import('../app/(dashboard)/coupons/model.ts');
type Options = typeof import('../app/(dashboard)/coupons/confirmOptions.tsx');
type PermissionsModule = typeof import('../app/lib/permissions.ts');
type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

let rules: Rules;
let model: Model;
let options: Options;
let parts: Record<string, ElementType>;

before(async () => {
  rules = await loadAppModule<Rules>('(dashboard)/coupons/couponRules.ts');
  model = await loadAppModule<Model>('(dashboard)/coupons/model.ts');
  options = await loadAppModule<Options>('(dashboard)/coupons/confirmOptions.tsx');
  parts = await loadAppModule<Record<string, ElementType>>('(dashboard)/coupons/CouponParts.tsx');
});

const WELCOME = '0c100000-0000-4000-8000-000000000001';
const SPRING = '0c100000-0000-4000-8000-000000000002';
const OLD = '0c100000-0000-4000-8000-000000000003';
const SOON = '0c100000-0000-4000-8000-000000000004';
const TODAY = '2026-10-03';
const BRAND_NAMES = ['Amazon', 'Apple', 'Macy’s', "Macy's"];
const BRANDS: Brand[] = [
  { id: '0b100000-0000-4000-8000-000000000001', name: 'Amazon' },
  { id: '0b100000-0000-4000-8000-000000000002', name: 'Apple' },
];

type RowSeed = Partial<StoredCoupon> & { pending_trades?: number | null; pending_bonus_naira?: number | null };

function stored(overrides: Partial<StoredCoupon> = {}): StoredCoupon {
  return {
    id: WELCOME,
    code: 'WELCOME10',
    min_trade_amount_usd: 50,
    expiry_date: '2026-12-31',
    type: 'Amazon',
    bonus_rate_naira: 1000,
    is_active: true,
    use_count: 4,
    max_redemptions: 100,
    eligibility_rules: [],
    terms_of_use: 'First-time users only',
    created_at: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

function row(seed: RowSeed = {}): CouponRow {
  const { pending_trades = 2, pending_bonus_naira = 2000, ...rest } = seed;
  const parsed = model.toCouponRow({ ...stored(rest), pending_trades, pending_bonus_naira });
  assert.ok(parsed);
  return parsed;
}

function accepted<T>(checked: Checked<T>): T {
  if (!checked.ok) assert.fail(checked.message);
  return checked.value;
}

function refusal<T>(checked: Checked<T>): string {
  assert.equal(checked.ok, false);
  return checked.ok ? '' : checked.message;
}

function createContext(coupons: readonly CouponRow[] = []): FormContext {
  return { mode: 'create', today: TODAY, base: null, coupons, brands: BRANDS };
}

function editContext(base: CouponRow, coupons: readonly CouponRow[] = [base]): FormContext {
  return { mode: 'edit', today: TODAY, base, coupons, brands: BRANDS };
}

function failure(patch: Partial<ApiFailure>): ApiResult<MutationResult> {
  return {
    ok: false,
    error: {
      kind: 'http',
      status: 400,
      code: null,
      message: 'Refused',
      requestId: null,
      details: null,
      outcomeUnknown: false,
      ...patch,
    },
  };
}

function textOfNode(node: ReactNode): string {
  return textOf(render(createElement('div', null, node)));
}

function detailText(details: { label: string; value: ReactNode }[] | undefined, label: string): string {
  const detail = details?.find((item) => item.label === label);
  assert.ok(detail, `missing detail ${label}`);
  return textOfNode(detail.value);
}

describe('coupon rules: reading a new coupon', () => {
  test('accepts the mobile payload and normalises it', () => {
    const value = accepted(rules.readCouponCreate({
      code: ' welcome10 ',
      min_trade_amount_usd: 50,
      expiry_date: '2026-12-31',
      type: 'amazon',
      bonus_rate_naira: 1000,
      is_active: true,
      eligibility_rules: [{ type: 'specific_card_category', value: 'Apple' }],
      terms_of_use: '  First-time users only  ',
    }, { today: TODAY, brands: BRAND_NAMES }));
    assert.deepEqual(value, {
      code: 'WELCOME10',
      type: 'Amazon',
      bonus_rate_naira: 1000,
      min_trade_amount_usd: 50,
      expiry_date: '2026-12-31',
      max_redemptions: null,
      is_active: true,
      terms_of_use: 'First-time users only',
      eligibility_rules: [{ type: 'specific_card_category', value: 'Apple' }],
    });
  });

  test('fills the same defaults the old route did', () => {
    const value = accepted(rules.readCouponCreate({ code: 'SPRING', type: 'Apple' }, { today: TODAY, brands: BRAND_NAMES }));
    assert.equal(value.bonus_rate_naira, 0);
    assert.equal(value.min_trade_amount_usd, 0);
    assert.equal(value.expiry_date, null);
    assert.equal(value.max_redemptions, null);
    assert.equal(value.is_active, true);
    assert.deepEqual(value.eligibility_rules, []);
    assert.equal(value.terms_of_use, null);
  });

  test('accepts numeric strings, ISO timestamps, today and a usage limit', () => {
    const value = accepted(rules.readCouponCreate({
      code: 'TODAY-ONLY',
      type: 'Apple',
      bonus_rate_naira: '1500.50',
      min_trade_amount_usd: ' 25 ',
      expiry_date: '2026-10-03T00:00:00.000Z',
      max_redemptions: '250',
      is_active: 'false',
    }, { today: TODAY, brands: BRAND_NAMES }));
    assert.equal(value.bonus_rate_naira, 1500.5);
    assert.equal(value.min_trade_amount_usd, 25);
    assert.equal(value.expiry_date, '2026-10-03');
    assert.equal(value.max_redemptions, 250);
    assert.equal(value.is_active, false);
  });

  test('accepts a catalog brand the old pattern refused, in its catalog spelling', () => {
    const value = accepted(rules.readCouponCreate({ code: 'MACYS', type: "macy's" }, { today: TODAY, brands: BRAND_NAMES }));
    assert.equal(value.type, "Macy's");
    assert.match(refusal(rules.readCouponCreate({ code: 'MACYS', type: "Macy's" }, { today: TODAY, brands: null })), /not a card brand/);
  });

  test('still accepts a plain type that is not in the catalog, as before', () => {
    assert.equal(accepted(rules.readCouponCreate({ code: 'FUTURE', type: 'Best Buy' }, { today: TODAY, brands: BRAND_NAMES })).type, 'Best Buy');
  });

  const refusals: Array<[string, Record<string, unknown>, RegExp]> = [
    ['a short code', { code: 'AB' }, /3 to 32/],
    ['a code with spaces', { code: 'WELCOME 10' }, /3 to 32/],
    ['a missing brand', { type: '' }, /card brand/],
    ['an odd brand that is not listed', { type: 'Nord/strom' }, /not a card brand/],
    ['a negative bonus', { bonus_rate_naira: -5 }, /bonus/],
    ['a bonus over the cap', { bonus_rate_naira: 2_000_000_000 }, /bonus/],
    ['a bonus with letters', { bonus_rate_naira: '12abc' }, /bonus/],
    ['a boolean bonus', { bonus_rate_naira: true }, /bonus/],
    ['a minimum over the cap', { min_trade_amount_usd: 20_000_000 }, /minimum card value/],
    ['an unreadable expiry', { expiry_date: 'next week' }, /2026-12-31/],
    ['an expiry in the past (Lagos)', { expiry_date: '2026-10-02' }, /already passed/],
    ['a zero usage limit', { max_redemptions: 0 }, /usage limit/],
    ['a fractional usage limit', { max_redemptions: 2.5 }, /usage limit/],
    ['an unreadable active flag', { is_active: 'yes' }, /is_active/],
    ['terms over 5,000 characters', { terms_of_use: 'x'.repeat(5001) }, /5,000/],
  ];

  for (const [name, patch, expected] of refusals) {
    test(`refuses ${name}`, () => {
      const body = { code: 'WELCOME10', type: 'Apple', bonus_rate_naira: 500, ...patch };
      assert.match(refusal(rules.readCouponCreate(body, { today: TODAY, brands: BRAND_NAMES })), expected);
    });
  }

  test('refuses a body that is not an object', () => {
    assert.match(refusal(rules.readCouponCreate(null, { today: TODAY, brands: BRAND_NAMES })), /JSON object/);
  });
});

describe('coupon rules: reading a change', () => {
  test('keeps the old missing-id message and refuses a malformed id', () => {
    assert.equal(refusal(rules.readCouponPatch({ is_active: false }, { brands: null })), 'Missing id');
    assert.match(refusal(rules.readCouponPatch({ id: 'abc', is_active: false }, { brands: null })), /valid coupon id/);
  });

  test('reads only the fields that were sent', () => {
    const patch = accepted(rules.readCouponPatch({ id: WELCOME.toUpperCase(), is_active: false }, { brands: null }));
    assert.equal(patch.id, WELCOME);
    assert.deepEqual(patch.fields, { is_active: false });
    assert.equal(patch.expected, null);
    assert.equal(patch.reason, null);
  });

  test('treats a null active flag as off and an empty expiry as no expiry, like the old route', () => {
    const patch = accepted(rules.readCouponPatch({ id: WELCOME, is_active: null, expiry_date: '' }, { brands: null }));
    assert.deepEqual(patch.fields, { is_active: false, expiry_date: null });
  });

  test('reads expected values and the audit reason', () => {
    const patch = accepted(rules.readCouponPatch({
      id: WELCOME,
      bonus_rate_naira: 1500,
      expected: { bonus_rate_naira: '1000', is_active: true, expiry_date: '', code: 'welcome10', max_redemptions: null },
      reason: '  Black Friday  ',
    }, { brands: null }));
    assert.deepEqual(patch.expected, {
      code: 'WELCOME10',
      bonus_rate_naira: 1000,
      expiry_date: null,
      max_redemptions: null,
      is_active: true,
    });
    assert.equal(patch.reason, 'Black Friday');
  });

  test('refuses malformed expected values and long reasons', () => {
    assert.match(refusal(rules.readCouponPatch({ id: WELCOME, expected: { is_active: 'yes' } }, { brands: null })), /expected values/);
    assert.match(refusal(rules.readCouponPatch({ id: WELCOME, expected: [] }, { brands: null })), /expected values/);
    assert.match(refusal(rules.readCouponPatch({ id: WELCOME, reason: 'x'.repeat(501) }, { brands: null })), /500 characters/);
  });

  test('resolves the brand against the catalog', () => {
    assert.equal(accepted(rules.readCouponPatch({ id: WELCOME, type: 'APPLE' }, { brands: BRAND_NAMES })).fields.type, 'Apple');
  });
});

describe('coupon rules: planning an update', () => {
  test('case-only and unchanged values plan nothing', () => {
    const plan = rules.planCouponUpdate(
      { code: 'welcome10', type: 'AMAZON', bonus_rate_naira: 1000, is_active: true, eligibility_rules: [], terms_of_use: ' First-time users only ' },
      stored(),
      TODAY,
    );
    assert.deepEqual(plan.changed, []);
    assert.deepEqual(plan.update, {});
    assert.equal(plan.problem, null);
  });

  test('a bonus change is financial and records the value it replaces', () => {
    const plan = rules.planCouponUpdate({ bonus_rate_naira: 1500 }, stored(), TODAY);
    assert.deepEqual(plan.changed, ['bonus_rate_naira']);
    assert.deepEqual(plan.update, { bonus_rate_naira: 1500 });
    assert.deepEqual(plan.before, { bonus_rate_naira: 1000 });
    assert.equal(plan.financial, true);
  });

  test('a terms-only change is not financial', () => {
    const plan = rules.planCouponUpdate({ terms_of_use: 'Weekends only' }, stored(), TODAY);
    assert.deepEqual(plan.changed, ['terms_of_use']);
    assert.equal(plan.financial, false);
  });

  test('moving the expiry into the past is refused, but an unchanged past expiry is not', () => {
    assert.match(rules.planCouponUpdate({ expiry_date: '2026-10-01' }, stored(), TODAY).problem ?? '', /already passed/);
    const expired = stored({ expiry_date: '2026-09-01' });
    const plan = rules.planCouponUpdate({ expiry_date: '2026-09-01', bonus_rate_naira: 2000 }, expired, TODAY);
    assert.deepEqual(plan.changed, ['bonus_rate_naira']);
    assert.equal(plan.problem, null);
  });

  test('clearing the expiry and setting a limit are planned', () => {
    const plan = rules.planCouponUpdate({ expiry_date: null, max_redemptions: 20 }, stored({ max_redemptions: null }), TODAY);
    assert.deepEqual(plan.changed, ['expiry_date', 'max_redemptions']);
    assert.deepEqual(plan.update, { expiry_date: null, max_redemptions: 20 });
  });

  test('normalises stored rows before comparing', () => {
    const values = rules.couponValues(stored({ bonus_rate_naira: null, is_active: null, expiry_date: '2026-12-31T00:00:00+00:00' }));
    assert.equal(values.bonus_rate_naira, 0);
    assert.equal(values.is_active, false);
    assert.equal(values.expiry_date, '2026-12-31');
  });

  test('reports conflicts only for expected values that moved', () => {
    assert.deepEqual(rules.couponConflicts({ bonus_rate_naira: 1000, is_active: true, code: 'welcome10' }, stored()), []);
    assert.deepEqual(rules.couponConflicts({ bonus_rate_naira: 900, max_redemptions: 100 }, stored()), ['bonus_rate_naira']);
  });
});

describe('coupon rules: deleting', () => {
  test('needs an id and a reason', () => {
    assert.equal(accepted(rules.readCouponDelete({ id: WELCOME, reason: 'Test coupon' }, null)).reason, 'Test coupon');
    assert.equal(accepted(rules.readCouponDelete({ reason: 'Duplicate' }, WELCOME)).id, WELCOME);
    assert.match(refusal(rules.readCouponDelete(null, WELCOME)), /reason/);
    assert.match(refusal(rules.readCouponDelete({ id: 'nope', reason: 'x' }, null)), /valid coupon id/);
  });

  test('only a switched-off coupon nobody used or applied can go', () => {
    assert.match(rules.deleteBlocker({ active: true, uses: 0, redemptions: 0, awaiting: 0 }) ?? '', /Switch this coupon off/);
    assert.match(rules.deleteBlocker({ active: false, uses: 3, redemptions: 3, awaiting: 0 }) ?? '', /used 3 times/);
    assert.match(rules.deleteBlocker({ active: false, uses: 0, redemptions: 1, awaiting: 0 }) ?? '', /used 1 time,/);
    assert.match(rules.deleteBlocker({ active: false, uses: 0, redemptions: 0, awaiting: 2 }) ?? '', /2 trades awaiting review have/);
    assert.equal(rules.deleteBlocker({ active: false, uses: 0, redemptions: 0, awaiting: 0 }), null);
  });

  test('groups trades awaiting review the way approval matches codes', () => {
    const totals = rules.awaitingByCode([
      { coupon_code: 'welcome10', coupon_bonus: 1000 },
      { coupon_code: 'WELCOME10', coupon_bonus: '500.50' },
      { coupon_code: 'SPRING', coupon_bonus: 0 },
      { coupon_code: null, coupon_bonus: 700 },
    ]);
    assert.deepEqual(rules.awaitingFor('Welcome10', totals), { trades: 2, bonus: 1500.5 });
    assert.deepEqual(rules.awaitingFor('SPRING', totals), { trades: 0, bonus: 0 });
  });

  test('escapes LIKE wildcards so code lookups match exactly', () => {
    assert.equal(rules.escapeLike('A_B%C\\'), 'A\\_B\\%C\\\\');
  });
});

describe('coupon rules: terms, rules and dates', () => {
  test('reads the stored terms list defensively', () => {
    assert.deepEqual(
      rules.parseTermsList('["First-time users only"," first-time USERS only ","Weekends only",3,""]'),
      ['First-time users only', 'Weekends only'],
    );
    assert.deepEqual(rules.parseTermsList('not json'), []);
    assert.deepEqual(rules.parseTermsList(null), []);
    assert.deepEqual(rules.parseTermsList(['A', 'B']), ['A', 'B']);
  });

  test('checks a new term against the list', () => {
    assert.match(rules.termProblem('   ', []) ?? '', /Type the term/);
    assert.match(rules.termProblem('x'.repeat(201), []) ?? '', /200 characters/);
    assert.match(rules.termProblem('weekends ONLY', ['Weekends only']) ?? '', /already in the list/);
    assert.match(rules.termProblem('New', Array.from({ length: 100 }, (_, index) => `Term ${index}`)) ?? '', /at most 100/);
    assert.equal(rules.termProblem('Weekends only', ['First-time users only']), null);
  });

  test('changes the brand restriction without losing other rules', () => {
    const stored = [{ type: 'legacy_rule', value: 1 }, { type: 'specific_card_category', value: 'Apple' }];
    assert.equal(rules.restrictionOf(stored), 'Apple');
    assert.deepEqual(rules.withRestriction(stored, 'Amazon'), [
      { type: 'legacy_rule', value: 1 },
      { type: 'specific_card_category', value: 'Amazon' },
    ]);
    assert.deepEqual(rules.withRestriction(stored, null), [{ type: 'legacy_rule', value: 1 }]);
    assert.equal(rules.restrictionOf('junk'), null);
  });

  test('uses the Lagos calendar day', () => {
    assert.equal(rules.todayKey(new Date('2026-10-03T22:59:00Z')), '2026-10-03');
    assert.equal(rules.todayKey(new Date('2026-10-03T23:30:00Z')), '2026-10-04');
    assert.equal(rules.formatDateKey('2026-12-31'), '31 Dec 2026');
    assert.equal(rules.formatDateKey(null), '—');
    assert.equal(rules.daysUntil('2026-10-13', TODAY), 10);
    assert.equal(rules.toDateKey('2026-02-30'), null);
  });
});

describe('coupons model: snapshot and status', () => {
  test('parses the list response, including the additive keys', () => {
    const snapshot = model.toSnapshot({
      coupons: [{ ...stored(), pending_trades: 3, pending_bonus_naira: 3000 }, { id: '' }, 'junk'],
      brands: [{ id: 'b1', name: 'Amazon' }, { id: 'b2', name: '' }],
      terms_options: ['A', ' ', 'B'],
      pending_counted: true,
    });
    assert.ok(snapshot);
    assert.equal(snapshot.coupons.length, 1);
    assert.equal(snapshot.coupons[0].awaitingTrades, 3);
    assert.equal(snapshot.coupons[0].awaitingBonus, 3000);
    assert.deepEqual(snapshot.brands, [{ id: 'b1', name: 'Amazon' }]);
    assert.deepEqual(snapshot.terms, ['A', 'B']);
    assert.equal(snapshot.awaitingCounted, true);
  });

  test('keeps working against the old response shape', () => {
    const snapshot = model.toSnapshot({ coupons: [stored()] });
    assert.ok(snapshot);
    assert.equal(snapshot.brands, null);
    assert.equal(snapshot.terms, null);
    assert.equal(snapshot.awaitingCounted, false);
    assert.equal(snapshot.coupons[0].awaitingTrades, null);
    assert.equal(model.toSnapshot({ items: [] }), null);
  });

  test('reads the brand restriction and limits from a row', () => {
    const parsed = row({ eligibility_rules: [{ type: 'specific_card_category', value: 'Apple' }], max_redemptions: null });
    assert.equal(parsed.restrictTo, 'Apple');
    assert.equal(parsed.limit, null);
    assert.equal(model.usesText(parsed), '4');
    assert.equal(model.usesText(row()), '4 / 100');
  });

  test('derives the status users actually experience', () => {
    assert.equal(model.couponStatus(row({ is_active: false }), TODAY, BRANDS).state, 'disabled');
    assert.equal(model.couponStatus(row({ expiry_date: '2026-10-02' }), TODAY, BRANDS).state, 'expired');
    assert.equal(model.couponStatus(row({ expiry_date: TODAY }), TODAY, BRANDS).state, 'live');
    assert.equal(model.couponStatus(row({ use_count: 100 }), TODAY, BRANDS).state, 'used_up');
    assert.equal(model.couponStatus(row({ type: 'Walmart' }), TODAY, BRANDS).state, 'no_brand');
    assert.equal(model.couponStatus(row({ type: 'Walmart' }), TODAY, null).state, 'live');
    assert.equal(model.couponStatus(row({ type: 'amazon' }), TODAY, BRANDS).state, 'live');
  });

  test('describes the expiry relative to today', () => {
    assert.deepEqual(model.expiryView(null, TODAY), { date: 'No expiry', relative: 'Runs until switched off' });
    assert.equal(model.expiryView(TODAY, TODAY).relative, 'Last day today');
    assert.equal(model.expiryView('2026-10-04', TODAY).relative, 'Ends tomorrow');
    assert.equal(model.expiryView('2026-10-13', TODAY).relative, 'Ends in 10 days');
    assert.equal(model.expiryView('2026-10-02', TODAY).relative, 'Ended yesterday');
    assert.equal(model.expiryView('2026-09-20', TODAY).relative, 'Ended 13 days ago');
  });
});

describe('coupons model: list view and totals', () => {
  const list = () => [
    row({ id: WELCOME, code: 'WELCOME10', bonus_rate_naira: 1000, expiry_date: null, use_count: 4 }),
    row({ id: SPRING, code: 'SPRING', bonus_rate_naira: 500, expiry_date: '2026-11-01', type: 'Apple', use_count: 9 }),
    row({ id: OLD, code: 'OLD', bonus_rate_naira: 800, expiry_date: '2026-01-01', use_count: 1 }),
  ];

  test('filters by tab and search and sorts stably', () => {
    const rows = list();
    const view = (patch: Partial<Parameters<Model['visibleCoupons']>[1]>) => model.visibleCoupons(rows, {
      tab: 'all', query: '', sort: null, today: TODAY, brands: BRANDS, ...patch,
    }).map((item) => item.code);
    assert.deepEqual(view({}), ['WELCOME10', 'SPRING', 'OLD']);
    assert.deepEqual(view({ tab: 'live' }), ['WELCOME10', 'SPRING']);
    assert.deepEqual(view({ tab: 'off' }), ['OLD']);
    assert.deepEqual(view({ query: 'apple' }), ['SPRING']);
    assert.deepEqual(view({ query: 'spr' }), ['SPRING']);
    assert.deepEqual(view({ sort: { key: 'bonus', dir: 'desc' } }), ['WELCOME10', 'OLD', 'SPRING']);
    assert.deepEqual(view({ sort: { key: 'expiry', dir: 'asc' } }), ['OLD', 'SPRING', 'WELCOME10']);
    assert.deepEqual(view({ sort: { key: 'expiry', dir: 'desc' } }), ['WELCOME10', 'SPRING', 'OLD']);
    assert.deepEqual(model.tabCounts(rows, TODAY, BRANDS), { all: 3, live: 2, off: 1 });
  });

  test('totals live coupons, redemptions, held bonuses and coupons ending soon', () => {
    const rows = [...list(), row({ id: SOON, code: 'SOON', expiry_date: '2026-10-08', use_count: 0, pending_trades: 0, pending_bonus_naira: 0 })];
    assert.deepEqual(model.couponStats(rows, TODAY, BRANDS, true), {
      total: 4,
      live: 3,
      redemptions: 14,
      awaitingTrades: 6,
      awaitingBonus: 6000,
      endingSoon: 1,
    });
    const uncounted = model.couponStats(rows, TODAY, BRANDS, false);
    assert.equal(uncounted.awaitingTrades, null);
    assert.equal(uncounted.awaitingBonus, null);
  });

  test('merges a saved coupon without losing the awaiting counts', () => {
    const snapshot: CouponsSnapshot = { coupons: [row()], brands: BRANDS, terms: [], awaitingCounted: true };
    const saved = model.toCouponRow({ ...stored({ bonus_rate_naira: 1500 }), pending_trades: null });
    assert.ok(saved);
    const merged = model.withCoupon(snapshot, saved);
    assert.equal(merged?.coupons[0].bonus, 1500);
    assert.equal(merged?.coupons[0].awaitingTrades, 2);
    assert.equal(model.withoutCoupon(merged, WELCOME)?.coupons.length, 0);
    const added = model.withCoupon(snapshot, row({ id: SPRING, code: 'SPRING' }));
    assert.deepEqual(added?.coupons.map((item) => item.code), ['SPRING', 'WELCOME10']);
  });

  test('works out the remaining liability and trades that would lose a bonus', () => {
    assert.equal(model.remainingLiability(1000, 100, 4), 96000);
    assert.equal(model.remainingLiability(1000, null, 4), null);
    assert.equal(model.awaitingLosing(row({ use_count: 10, pending_trades: 5 }), 12), 3);
    assert.equal(model.awaitingLosing(row({ use_count: 10, pending_trades: 5 }), null), 0);
    assert.equal(model.deletable(row({ is_active: false, use_count: 0, pending_trades: 0 })), true);
    assert.equal(model.deletable(row({ is_active: false, use_count: 0, pending_trades: null })), true);
    assert.equal(model.deletable(row({ is_active: true, use_count: 0, pending_trades: 0 })), false);
    assert.equal(model.deletable(row({ is_active: false, use_count: 1, pending_trades: 0 })), false);
  });
});

describe('coupons model: the editor form', () => {
  test('an empty create form names every required field', () => {
    const check = model.checkForm(model.EMPTY_FORM, createContext());
    assert.deepEqual(Object.keys(check.errors).sort(), ['bonus', 'code', 'type']);
    assert.equal(check.values, null);
  });

  test('refuses a code another coupon already uses, ignoring case', () => {
    const check = model.checkForm({ ...model.EMPTY_FORM, code: 'welcome10', type: 'Apple', bonus: '500' }, createContext([row()]));
    assert.equal(check.errors.code, 'Another coupon already uses this code.');
  });

  test('parses a complete form into request values', () => {
    const form: CouponForm = {
      ...model.EMPTY_FORM,
      code: 'NEW-1',
      type: 'Apple',
      bonus: '1,500.50',
      minTrade: '$25',
      expiry: '2026-12-01',
      limit: '200',
      terms: 'Weekends only',
      restrictTo: 'Amazon',
    };
    const check = model.checkForm(form, createContext([row()]));
    assert.deepEqual(check.errors, {});
    assert.deepEqual(check.values, {
      code: 'NEW-1',
      type: 'Apple',
      bonus: 1500.5,
      minTrade: 25,
      expiry: '2026-12-01',
      limit: 200,
      active: true,
      terms: 'Weekends only',
      restrictTo: 'Amazon',
    });
    assert.ok(check.values);
    assert.deepEqual(model.createRequestBody(check.values, ''), {
      code: 'NEW-1',
      type: 'Apple',
      bonus_rate_naira: 1500.5,
      min_trade_amount_usd: 25,
      expiry_date: '2026-12-01',
      max_redemptions: 200,
      is_active: true,
      eligibility_rules: [{ type: 'specific_card_category', value: 'Amazon' }],
      terms_of_use: 'Weekends only',
    });
  });

  test('validates amounts, dates and limits the way users type them', () => {
    const errors = (patch: Partial<CouponForm>) => model.checkForm({
      ...model.EMPTY_FORM, code: 'NEW-1', type: 'Apple', bonus: '500', ...patch,
    }, createContext()).errors;
    assert.match(errors({ bonus: '0' }).bonus ?? '', /above 0/);
    assert.match(errors({ bonus: '10.555' }).bonus ?? '', /2 decimal places/);
    assert.match(errors({ bonus: '1.500,50' }).bonus ?? '', /full stop/);
    assert.match(errors({ bonus: '-5' }).bonus ?? '', /0 or more/);
    assert.match(errors({ minTrade: 'fifty' }).minTrade ?? '', /Enter a number/);
    assert.match(errors({ expiry: '2026-10-02' }).expiry ?? '', /Pick today/);
    assert.equal(errors({ expiry: TODAY }).expiry, undefined);
    assert.match(errors({ limit: '0' }).limit ?? '', /at least 1/);
    assert.match(errors({ limit: '2.5' }).limit ?? '', /whole number/);
    assert.match(errors({ limit: '20000000' }).limit ?? '', /10,000,000 or less/);
  });

  test('untouched legacy values never block an edit', () => {
    const legacy = row({ bonus_rate_naira: 0, code: 'old code', expiry_date: '2026-09-01' });
    const check = model.checkForm({ ...model.formFor(legacy), active: false }, editContext(legacy));
    assert.deepEqual(check.errors, {});
    assert.ok(check.values);
  });

  test('warns about large bonuses, limits below current use and missing brands', () => {
    const base = row({ use_count: 10, max_redemptions: null });
    const check = model.checkForm({ ...model.formFor(base), bonus: '250000', limit: '8', type: 'Walmart' }, editContext(base));
    assert.equal(check.warnings.length, 3);
    assert.match(check.warnings[0], /large bonus/);
    assert.match(check.warnings[1], /at or below the 10 uses/);
    assert.match(check.warnings[2], /Walmart/);
  });

  test('tells dirty from clean, treating formatting changes as clean', () => {
    const base = model.formFor(row());
    assert.equal(model.isFormDirty({ ...base, code: 'welcome10', type: 'AMAZON', bonus: '1,000.00' }, base), false);
    assert.equal(model.isFormDirty({ ...base, minTrade: '50.00' }, base), false);
    assert.equal(model.isFormDirty({ ...base, limit: '' }, base), true);
    assert.equal(model.isFormDirty({ ...base, active: false }, base), true);
    assert.equal(model.sameFormValue('minTrade', { ...base, minTrade: '' }, { ...base, minTrade: '0' }), true);
  });

  test('proposes only the changed fields, with the live values as expectations', () => {
    const live = row({ eligibility_rules: [{ type: 'legacy_rule', value: 1 }] });
    const form: CouponForm = { ...model.formFor(live), bonus: '1500', restrictTo: 'Apple' };
    const check = model.checkForm(form, editContext(live));
    assert.ok(check.values);
    const proposal = model.proposeEdit(live, form, check.values);
    assert.deepEqual(proposal.changes, ['bonus', 'restrictTo']);
    assert.deepEqual(proposal.body, {
      id: WELCOME,
      bonus_rate_naira: 1500,
      eligibility_rules: [{ type: 'legacy_rule', value: 1 }, { type: 'specific_card_category', value: 'Apple' }],
      expected: { bonus_rate_naira: 1000, eligibility_rules: [{ type: 'legacy_rule', value: 1 }] },
    });
    assert.deepEqual(model.editRequestBody(proposal, '  promo  '), { ...proposal.body, reason: 'promo' });
    const unchanged = { ...model.formFor(live), code: 'welcome10', type: 'AMAZON' };
    assert.deepEqual(model.proposeEdit(live, unchanged, check.values).changes, []);
  });

  test('builds toggle and delete requests that guard against lost updates', () => {
    const live = row();
    assert.deepEqual(model.toggleRequestBody(live, false, ''), { id: WELCOME, is_active: false, expected: { is_active: true } });
    assert.deepEqual(model.toggleRequestBody(live, false, ' Promotion ended '), {
      id: WELCOME, is_active: false, expected: { is_active: true }, reason: 'Promotion ended',
    });
    assert.deepEqual(model.deleteRequestBody(live, ' Test coupon '), {
      id: WELCOME, reason: 'Test coupon', expected: { is_active: true, code: 'WELCOME10' },
    });
  });

  test('rebases an edit onto changes made elsewhere', () => {
    const base = model.formFor(row());
    const local = { ...base, bonus: '1500' };
    const rebased = model.rebaseForm(base, local, { ...base, limit: '50', bonus: '1200' });
    assert.equal(rebased.form.bonus, '1500');
    assert.equal(rebased.form.limit, '50');
    assert.deepEqual(rebased.conflicts, ['bonus']);
    assert.equal(rebased.changedElsewhere, true);
    assert.deepEqual(model.rebaseForm(base, local, { ...base, bonus: '1,500' }).conflicts, []);
    assert.equal(model.rebaseForm(base, local, base).changedElsewhere, false);
  });

  test('classifies mutation results into outcomes', () => {
    assert.equal(model.classifyMutation(failure({ status: 401 })).kind, 'expired');
    assert.equal(model.classifyMutation(failure({ status: null, kind: 'timeout', outcomeUnknown: true })).kind, 'unknown');
    assert.equal(model.classifyMutation(failure({ status: 403 })).kind, 'refused');
    const stale = model.classifyMutation(failure({ status: 409, details: { coupon: { ...stored(), bonus_rate_naira: 900 } } }));
    assert.equal(stale.kind, 'stale');
    assert.equal(stale.kind === 'stale' ? stale.latest?.bonus : null, 900);
    assert.equal(model.classifyMutation(failure({ status: 400 })).kind, 'retry');
    assert.equal(model.classifyMutation(failure({ status: 500, code: 'INTERNAL_ERROR' })).kind, 'retry');
    const done = model.classifyMutation({ ok: true, data: model.toMutationResult({ changed: false }), status: 200, requestId: null });
    assert.equal(done.kind, 'done');
    assert.equal(done.kind === 'done' ? done.result.changed : true, false);
  });

  test('diffs and rebases the terms list by meaning, not spelling', () => {
    const change = model.diffTerms(['A', 'B', 'C'], ['A', 'C', 'D']);
    assert.deepEqual(change, { added: ['D'], removed: ['B'] });
    assert.deepEqual(model.applyTermsChange(['A', 'B', 'C', 'E'], change), ['A', 'C', 'E', 'D']);
    assert.deepEqual(model.applyTermsChange(['A', 'D'], change), ['A', 'D']);
    assert.equal(model.isEmptyTermsChange(model.diffTerms(['A'], ['a'])), true);
    assert.equal(model.sameTerms(['A', 'B'], ['B', 'A']), false);
    assert.equal(model.termsUsage([row(), row({ id: SPRING, terms_of_use: null })], 'first-time USERS only'), 1);
  });

  test('reads the stored terms list and saves it against the exact stored value', () => {
    const stored = model.readStoredTerms({ config: { coupon_terms_of_use: '["A"," a ","B"]' } });
    assert.deepEqual(stored, { raw: '["A"," a ","B"]', terms: ['A', 'B'] });
    assert.deepEqual(model.readStoredTerms({ config: {} }), { raw: '', terms: [] });
    assert.deepEqual(model.readStoredTerms({ config: { coupon_terms_of_use: null } }), { raw: '', terms: [] });
    assert.equal(model.readStoredTerms({ coupons: [] }), null);
    assert.deepEqual(model.termsSaveBody(['A', 'C'], '["A"," a ","B"]'), {
      changes: { coupon_terms_of_use: '["A","C"]' },
      expected: { coupon_terms_of_use: '["A"," a ","B"]' },
    });
  });
});

describe('coupons confirm dialogs', () => {
  const values = () => {
    const check = model.checkForm({
      ...model.EMPTY_FORM, code: 'NEW-1', type: 'Apple', bonus: '1500.50', limit: '200', expiry: '2026-12-01',
    }, createContext());
    assert.ok(check.values);
    return check.values;
  };

  test('create states the money, the reach and the cap', () => {
    const confirm = options.createConfirm(values(), true);
    assert.equal(confirm.tone, 'financial');
    assert.equal(confirm.title, 'Create coupon NEW-1?');
    assert.deepEqual(confirm.details?.map((detail) => detail.label), [
      'Code', 'Brand', 'Bonus per trade', 'Minimum card value', 'Usage limit', 'Expires', 'Who can use it', 'Terms of use', 'Status',
    ]);
    assert.equal(detailText(confirm.details, 'Bonus per trade'), '₦1,500.50');
    assert.equal(detailText(confirm.details, 'Expires'), 'End of 01 Dec 2026 (WAT)');
    const lines = confirm.consequences ?? [];
    assert.ok(lines.some((line) => /Coupons screen of the user app/.test(line)));
    assert.ok(lines.includes('At most ₦300,100.00 in bonuses: 200 uses at ₦1,500.50 each.'));
    assert.equal(confirm.reason?.required, undefined);
  });

  test('create flags a missing brand and an open-ended coupon', () => {
    const open = { ...values(), limit: null, expiry: null, type: 'Walmart', bonus: 250000 };
    const lines = options.createConfirm(open, false).consequences ?? [];
    assert.ok(lines.some((line) => /no usage limit/.test(line)));
    assert.ok(lines.some((line) => /no expiry date/.test(line)));
    assert.ok(lines.some((line) => /large bonus/.test(line)));
    assert.ok(lines.some((line) => /Walmart/.test(line)));
  });

  test('edit shows exact before and after values and what happens to waiting trades', () => {
    const live = row({ pending_trades: 3, pending_bonus_naira: 3000 });
    const form: CouponForm = { ...model.formFor(live), code: 'WELCOME20', bonus: '1500' };
    const check = model.checkForm(form, editContext(live));
    assert.ok(check.values);
    const proposal = model.proposeEdit(live, form, check.values);
    const confirm = options.editConfirm(proposal, null, true);
    assert.equal(confirm.tone, 'financial');
    assert.deepEqual(confirm.details?.map((detail) => detail.label), ['Coupon', 'Code', 'Bonus per trade']);
    assert.equal(detailText(confirm.details, 'Code'), 'WELCOME10 → changes to WELCOME20');
    assert.equal(detailText(confirm.details, 'Bonus per trade'), '₦1,000.00 → changes to ₦1,500.00');
    const lines = confirm.consequences ?? [];
    assert.ok(lines.some((line) => line.startsWith('New trades get ₦1,500.00 instead of ₦1,000.00.')));
    assert.ok(lines.some((line) => line.includes('3 trades awaiting review used WELCOME10') && line.includes('₦3,000.00 is not paid')));
  });

  test('edit warns when a lower limit cuts off waiting trades', () => {
    const live = row({ use_count: 10, pending_trades: 5, pending_bonus_naira: 5000 });
    const form: CouponForm = { ...model.formFor(live), limit: '12' };
    const check = model.checkForm(form, editContext(live));
    assert.ok(check.values);
    const lines = options.editConsequences(model.proposeEdit(live, form, check.values), true);
    assert.ok(lines.includes('3 trades awaiting review go over the new limit and get no bonus when approved.'));
    assert.ok(lines.includes('At most ₦2,000.00 more in bonuses from new redemptions.'));
  });

  test('edit explains a change made elsewhere', () => {
    const live = row();
    const form: CouponForm = { ...model.formFor(live), terms: 'Weekends only' };
    const check = model.checkForm(form, editContext(live));
    assert.ok(check.values);
    const confirm = options.editConfirm(
      model.proposeEdit(live, form, check.values),
      { form, conflicts: ['terms'], changedElsewhere: true },
      true,
    );
    assert.equal(confirm.tone, 'default');
    assert.match(textOfNode(confirm.message), /Changed while you were editing.*you both changed the terms of use, and yours wins/);
  });

  test('switching off keeps the bonuses already promised', () => {
    const confirm = options.toggleConfirm(row(), false, TODAY, BRANDS);
    assert.equal(confirm.tone, 'default');
    assert.equal(confirm.confirmLabel, 'Disable coupon');
    assert.equal(detailText(confirm.details, 'Status'), 'Live → changes to Disabled');
    assert.ok(confirm.consequences?.includes('The 2 trades awaiting review with it still get their bonus when approved: ₦2,000.00 in total.'));
    assert.deepEqual(confirm.reason?.presets?.length, 4);
  });

  test('switching an expired coupon on says it stays unusable', () => {
    const confirm = options.toggleConfirm(row({ is_active: false, expiry_date: '2026-09-30' }), true, TODAY, BRANDS);
    assert.equal(confirm.tone, 'financial');
    assert.equal(detailText(confirm.details, 'Status'), 'Disabled → changes to Expired');
    assert.ok(confirm.consequences?.some((line) => /^It expired on .+, so users still cannot apply it\./.test(line)));
  });

  test('switching a live coupon on states the bonus and the cap', () => {
    const confirm = options.toggleConfirm(row({ is_active: false }), true, TODAY, BRANDS);
    assert.ok(confirm.consequences?.includes('Each qualifying trade gets ₦1,000.00 added to its payout when the trade is approved.'));
    assert.ok(confirm.consequences?.includes('At most ₦96,000.00 more in bonuses from new redemptions.'));
  });

  test('delete is a typed, reasoned, irreversible confirmation', () => {
    const confirm = options.deleteConfirm(row({ is_active: false, use_count: 0, pending_trades: 0 }));
    assert.equal(confirm.tone, 'danger');
    assert.equal(confirm.requireTyped, 'WELCOME10');
    assert.equal(confirm.reason?.required, true);
    assert.ok(confirm.consequences?.includes('This cannot be undone.'));
    assert.match(textOfNode(confirm.message), /no trades are waiting with it/);
    assert.equal(detailText(confirm.details, 'Status'), 'Disabled → changes to Deleted');
  });

  test('saving the terms list shows the diff and the effect on coupons', () => {
    const confirm = options.termsConfirm({ added: ['Weekends only'], removed: ['First-time users only'] }, 4, true, () => 2);
    const lines = confirm.consequences ?? [];
    assert.ok(lines[0].startsWith('New terms can be picked'));
    assert.ok(lines.includes('2 coupons still show a removed term to users until edited.'));
    const message = textOfNode(confirm.message);
    assert.match(message, /Changed while you were editing/);
    assert.match(message, /Adding · 1/);
    assert.match(message, /Removing · 1/);
  });
});

describe('coupons parts', () => {
  test('status and uses cells render what the table shows', () => {
    assert.equal(textOfNode(createElement(parts.StatusCell, {
      status: model.couponStatus(row({ is_active: false }), TODAY, BRANDS),
    })), 'Disabled');
    assert.equal(textOfNode(createElement(parts.UsesCell, { row: row() })), '4 / 100 2 awaiting review');
    assert.equal(textOfNode(createElement(parts.BrandCell, { row: row({ type: 'Walmart' }), available: false })), 'Walmart Not an active brand');
    assert.equal(
      textOfNode(createElement(parts.CodeCell, { row: row({ eligibility_rules: [{ type: 'specific_card_category', value: 'Apple' }] }) })),
      'WELCOME10 Needs an approved Apple trade',
    );
  });
});

describe('coupons unit hard rules', () => {
  const root = fileURLToPath(new URL('../app/(dashboard)/coupons/', import.meta.url));
  const route = fileURLToPath(new URL('../app/api/coupons/route.ts', import.meta.url));
  const files = [...readdirSync(root).map((name) => join(root, name)), route];

  test('source files carry no prose comments', () => {
    for (const file of files.filter((path) => /\.(tsx?|css)$/.test(path))) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const trimmed = line.trim();
        assert.ok(!trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('{/*'), `${file}: ${trimmed}`);
      }
    }
  });

  test('styles use tokens only', () => {
    for (const file of files.filter((path) => path.endsWith('.css'))) {
      const css = readFileSync(file, 'utf8');
      assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, file);
      assert.doesNotMatch(css, /\b(?:rgba?|hsla?)\(/, file);
      assert.doesNotMatch(css, /z-index/, file);
    }
  });

  test('components carry no static inline styles or literal colours', () => {
    for (const file of files.filter((path) => path.endsWith('.tsx'))) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /style=\{\{/, file);
      assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/, file);
    }
  });

  test('the private mobile list and the hand-rolled modal are gone', () => {
    const page = readFileSync(join(root, 'page.tsx'), 'utf8');
    assert.doesNotMatch(page, /CouponsMobile|useIsMobile/);
    const terms = readFileSync(join(root, 'TermsOfUseManager.tsx'), 'utf8');
    assert.doesNotMatch(terms, /<button|<input|React\.CSSProperties/);
  });

  test('the route keeps the exact access rule on every method', () => {
    const source = readFileSync(route, 'utf8');
    const sections = Object.fromEntries(
      source.split('export async function ').slice(1).map((chunk) => [chunk.slice(0, chunk.indexOf('(')), chunk]),
    );
    assert.deepEqual(Object.keys(sections).sort(), ['DELETE', 'GET', 'PATCH', 'POST']);
    assert.match(sections.GET, /requireAdmin\('coupons\.read'\)/);
    for (const method of ['POST', 'PATCH', 'DELETE']) assert.match(sections[method], /requireAdmin\('coupons\.write'\)/, method);
    assert.doesNotMatch(source, /status:\s*40[13]/);
    assert.doesNotMatch(source, /page_permissions|is_super_admin|from\('audit_log'\)/);
  });

  test('the UI gates on the permissions the routes enforce', () => {
    const page = readFileSync(join(root, 'page.tsx'), 'utf8');
    assert.match(page, /useCan\('coupons\.write'\)/);
    const terms = readFileSync(join(root, 'TermsOfUseManager.tsx'), 'utf8');
    assert.match(terms, /isSuperAdmin/);
    assert.match(terms, /'\/api\/app-config'/);
    assert.match(terms, /termsSaveBody\(/);
  });

  test('the legacy coupons key expands to exactly read and write', async () => {
    const permissions = await loadAppModule<PermissionsModule>('lib/permissions.ts');
    assert.deepEqual([...permissions.resolvePermissions(['coupons'], false)].sort(), ['coupons.read', 'coupons.write']);
  });
});
