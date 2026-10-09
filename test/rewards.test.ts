import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ElementType } from 'react';
import { loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiResult } from '../app/lib/apiClient.ts';
import type { GiftboxItem, SettingsSnapshot } from '../app/(dashboard)/bonuses-rewards/model.ts';
import type { StoredGiftbox, StoredTier } from '../app/(dashboard)/bonuses-rewards/rewardRules.ts';
import type { Tier, TierSnapshot } from '../app/(dashboard)/bonuses-rewards/levels/model.ts';

type Rules = typeof import('../app/(dashboard)/bonuses-rewards/rewardRules.ts');
type Model = typeof import('../app/(dashboard)/bonuses-rewards/model.ts');
type Levels = typeof import('../app/(dashboard)/bonuses-rewards/levels/model.ts');
type Options = typeof import('../app/(dashboard)/bonuses-rewards/confirmOptions.tsx');
type LevelOptions = typeof import('../app/(dashboard)/bonuses-rewards/levels/confirmOptions.tsx');

let rules: Rules;
let model: Model;
let levels: Levels;
let options: Options;
let levelOptions: LevelOptions;
let builder: Record<string, ElementType>;

before(async () => {
  rules = await loadAppModule<Rules>('(dashboard)/bonuses-rewards/rewardRules.ts');
  model = await loadAppModule<Model>('(dashboard)/bonuses-rewards/model.ts');
  levels = await loadAppModule<Levels>('(dashboard)/bonuses-rewards/levels/model.ts');
  options = await loadAppModule<Options>('(dashboard)/bonuses-rewards/confirmOptions.tsx');
  levelOptions = await loadAppModule<LevelOptions>('(dashboard)/bonuses-rewards/levels/confirmOptions.tsx');
  builder = await loadAppModule<Record<string, ElementType>>('(dashboard)/bonuses-rewards/RuleBuilder.tsx');
});

const BOX = '0e000000-0000-4000-8000-000000000001';
const BOX_2 = '0e000000-0000-4000-8000-000000000002';
const TIER_1 = '0f000000-0000-4000-8000-000000000001';
const TIER_2 = '0f000000-0000-4000-8000-000000000002';
const TODAY = '2026-10-03';

function storedBox(overrides: Partial<StoredGiftbox> = {}): StoredGiftbox {
  return {
    id: BOX,
    title: 'Weekend boost',
    description: 'Trade this weekend',
    reward_naira: 1500,
    expiry_date: '2026-12-31',
    eligibility_condition: null,
    eligibility_rules: [{ type: 'min_trades', value: 3 }],
    is_active: true,
    created_at: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

function item(overrides: Partial<StoredGiftbox> = {}, claims = 4): GiftboxItem {
  const parsed = model.toGiftboxItem({ ...storedBox(overrides), claims, claims_counted: true });
  assert.ok(parsed);
  return parsed;
}

function storedTier(overrides: Partial<StoredTier> = {}): StoredTier {
  return {
    id: TIER_1,
    tier_order: 1,
    name: 'Newbie',
    target_usd: 200,
    bonus_naira: 2000,
    badge_url: null,
    is_active: true,
    ...overrides,
  };
}

function tierSnapshot(rows: Array<Partial<StoredTier> & { claims?: number }>): TierSnapshot {
  const snapshot = levels.toTierSnapshot({ tiers: rows.map((row) => ({ ...storedTier(row), claims: row.claims ?? 0 })) });
  assert.ok(snapshot);
  return snapshot;
}

function failure(status: number | null, extra: Partial<{ code: string; details: unknown; outcomeUnknown: boolean; message: string }> = {}) {
  return {
    ok: false as const,
    error: {
      kind: status === null ? ('network' as const) : ('http' as const),
      status,
      code: extra.code ?? null,
      message: extra.message ?? 'Request failed.',
      requestId: null,
      details: extra.details ?? null,
      outcomeUnknown: extra.outcomeUnknown ?? false,
    },
  };
}

describe('rule catalogue', () => {
  test('offers exactly the rule types the claim check evaluates and can satisfy', () => {
    const offered = rules.OFFERED_RULES.map((spec) => spec.type).sort();
    assert.deepEqual(offered, [
      'consecutive_days_active', 'country_in', 'email_verified', 'exact_level', 'first_time_claimer',
      'has_bank_account', 'has_claimed_level_bonus', 'has_set_pin', 'has_used_coupon', 'max_account_age_days',
      'min_account_age_days', 'min_avg_trade_usd', 'min_balance_naira', 'min_card_categories', 'min_level',
      'min_referrals', 'min_single_trade_usd', 'min_successful_referrals', 'min_trades', 'min_volume_usd',
      'min_withdrawn_total', 'specific_card_category', 'trades_in_period', 'volume_in_period',
    ]);
    assert.equal(rules.ruleSpec('completed_task'), null);
    for (const type of ['max_claims_per_user', 'cooldown_days']) {
      assert.ok(rules.ruleSpec(type)?.retired, `${type} should be retired`);
    }
  });

  test('accepts every kind and normalises numbers and lists', () => {
    const cases: Array<[unknown, unknown]> = [
      [{ type: 'min_trades', value: '5' }, { type: 'min_trades', value: 5 }],
      [{ type: 'min_volume_usd', value: 250.5 }, { type: 'min_volume_usd', value: 250.5 }],
      [{ type: 'min_withdrawn_total', value: 5000 }, { type: 'min_withdrawn_total', value: 5000 }],
      [{ type: 'min_level', value: 6 }, { type: 'min_level', value: 6 }],
      [{ type: 'specific_card_category', value: '  Amazon ' }, { type: 'specific_card_category', value: 'Amazon' }],
      [{ type: 'country_in', value: 'Nigeria, Ghana, nigeria' }, { type: 'country_in', value: ['Nigeria', 'Ghana'] }],
      [{ type: 'email_verified', value: true }, { type: 'email_verified', value: null }],
      [{ type: 'trades_in_period', value: { count: 3, days: '7' } }, { type: 'trades_in_period', value: { count: 3, days: 7 } }],
      [{ type: 'volume_in_period', value: { amount: 100, days: 30 } }, { type: 'volume_in_period', value: { amount: 100, days: 30 } }],
      [{ type: 'min_single_trade_usd', value: { amount: 0, card: '' } }, { type: 'min_single_trade_usd', value: { amount: 0, card: '' } }],
    ];
    for (const [input, expected] of cases) {
      const checked = rules.checkRule(input);
      assert.ok(checked.ok, JSON.stringify(input));
      if (checked.ok) assert.deepEqual(checked.value, expected);
    }
  });

  test('refuses unknown, retired and malformed rules with a reason', () => {
    const refused: Array<[unknown, RegExp]> = [
      [{ type: 'completed_task', value: 3 }, /every claim would fail/],
      [{ type: 'cooldown_days', value: 7 }, /only once/],
      [{ type: 'min_trades', value: 2.5 }, /whole number/],
      [{ type: 'min_trades', value: 0 }, /whole number/],
      [{ type: 'min_account_age_days', value: 0 }, /days from 1/],
      [{ type: 'exact_level', value: 7 }, /level from 1 to 6/],
      [{ type: 'min_balance_naira', value: -1 }, /above 0/],
      [{ type: 'min_avg_trade_usd', value: 10.555 }, /2 decimal places/],
      [{ type: 'specific_card_category', value: '  ' }, /card name/],
      [{ type: 'country_in', value: [] }, /country name/],
      [{ type: 'trades_in_period', value: { count: 2, days: 0 } }, /days from 1/],
      ['min_trades', /not a valid rule/],
    ];
    for (const [input, pattern] of refused) {
      const checked = rules.checkRule(input);
      assert.equal(checked.ok, false, JSON.stringify(input));
      if (!checked.ok) assert.match(checked.message, pattern);
    }
  });

  test('reads rule lists with positions and limits', () => {
    assert.deepEqual(rules.readRules(null), { ok: true, value: [] });
    assert.equal(rules.readRules('x').ok, false);
    const tooMany = rules.readRules(Array.from({ length: rules.RULES_MAX + 1 }, () => ({ type: 'email_verified', value: null })));
    assert.equal(tooMany.ok, false);
    const second = rules.readRules([{ type: 'email_verified', value: null }, { type: 'completed_task', value: 1 }]);
    assert.equal(second.ok, false);
    if (!second.ok) assert.match(second.message, /^Rule 2: /);
  });

  test('describes rules in plain sentences', () => {
    assert.equal(rules.describeRule({ type: 'min_trades', value: 1 }), 'At least 1 approved trade');
    assert.equal(rules.describeRule({ type: 'min_trades', value: 5 }), 'At least 5 approved trades');
    assert.equal(
      rules.describeRule({ type: 'min_single_trade_usd', value: { amount: 100, card: 'Amazon' } }),
      'One trade worth at least $100 on Amazon',
    );
    assert.equal(rules.describeRule({ type: 'min_single_trade_usd', value: { amount: 50, card: '' } }), 'One trade worth at least $50 on any card');
    assert.equal(
      rules.describeRule({ type: 'trades_in_period', value: { count: 3, days: 7 } }),
      'At least 3 trades in the last 7 days',
    );
    assert.equal(rules.describeRule({ type: 'country_in', value: ['Nigeria', 'Ghana'] }), 'Country is Nigeria or Ghana');
    assert.equal(rules.describeRule({ type: 'min_balance_naira', value: 5000 }), 'Wallet balance of at least ₦5,000.00');
    assert.equal(rules.describeRule({ type: 'completed_task', value: 2 }), 'Unrecognised rule “completed_task”');
  });

  test('flags stored rules that break or do nothing at claim time', () => {
    assert.equal(rules.ruleImpact({ type: 'completed_task', value: 1 }).level, 'blocking');
    assert.equal(rules.ruleImpact({ type: 'min_trades', value: '3' }).level, 'blocking');
    assert.equal(rules.ruleImpact({ type: 'country_in', value: 'Nigeria' }).level, 'blocking');
    assert.deepEqual(rules.ruleImpact({ type: 'min_withdrawn_total', value: 5000 }), { level: 'ok', message: null });
    const single = rules.ruleImpact({ type: 'max_claims_per_user', value: 1 });
    assert.equal(single.level, 'warning');
    assert.doesNotMatch(single.message ?? '', /database error/);
    assert.match(rules.ruleImpact({ type: 'max_claims_per_user', value: 3 }).message ?? '', /database error/);
    assert.match(rules.ruleImpact({ type: 'cooldown_days', value: 7 }).message ?? '', /database error/);
    assert.deepEqual(rules.ruleImpact({ type: 'min_trades', value: 3 }), { level: 'ok', message: null });
    assert.equal(rules.rulesImpact([{ type: 'min_trades', value: 3 }, { type: 'cooldown_days', value: 2 }]), 'warning');
  });

  test('compares rule lists regardless of key order', () => {
    assert.ok(rules.sameRules(
      [{ type: 'volume_in_period', value: { amount: 1, days: 2 } }],
      [{ value: { days: 2, amount: 1 }, type: 'volume_in_period' }],
    ));
    assert.ok(!rules.sameRules([{ type: 'min_trades', value: 3 }], [{ type: 'min_trades', value: '3' }]));
    assert.ok(rules.sameRules(null, []));
  });

  test('warns when countries look like codes', () => {
    assert.match(rules.countryCodeWarning(['NG', 'Nigeria']) ?? '', /NG matches nobody/);
    assert.equal(rules.countryCodeWarning(['Nigeria']), null);
  });
});

describe('gift box readers', () => {
  test('accepts the mobile create body', () => {
    const checked = rules.readGiftboxCreate({
      title: '  Promo  ',
      description: null,
      reward_naira: 500,
      expiry_date: null,
      eligibility_condition: null,
      eligibility_rules: [],
      is_active: true,
    });
    assert.ok(checked.ok);
    if (checked.ok) {
      assert.deepEqual(checked.value, {
        title: 'Promo',
        description: null,
        reward_naira: 500,
        expiry_date: null,
        eligibility_condition: null,
        eligibility_rules: [],
        is_active: true,
      });
    }
  });

  test('defaults and normalises optional fields', () => {
    const checked = rules.readGiftboxCreate({ title: 'Promo', reward_naira: '250.50', expiry_date: '2026-12-31T00:00:00Z' });
    assert.ok(checked.ok);
    if (checked.ok) {
      assert.equal(checked.value.reward_naira, 250.5);
      assert.equal(checked.value.expiry_date, '2026-12-31');
      assert.equal(checked.value.is_active, true);
    }
    const off = rules.readGiftboxCreate({ title: 'Promo', reward_naira: 1, is_active: 'false' });
    assert.ok(off.ok && off.value.is_active === false);
  });

  test('refuses invalid create bodies', () => {
    const bodies: Array<[unknown, RegExp]> = [
      [{ reward_naira: 10 }, /title/],
      [{ title: '   ', reward_naira: 10 }, /title/],
      [{ title: 'x'.repeat(121), reward_naira: 10 }, /120 characters/],
      [{ title: 'Promo' }, /reward amount/],
      [{ title: 'Promo', reward_naira: -1 }, /0 or more/],
      [{ title: 'Promo', reward_naira: 100_000_001 }, /at most/],
      [{ title: 'Promo', reward_naira: 10.005 }, /2 decimal places/],
      [{ title: 'Promo', reward_naira: 10, expiry_date: '2026-13-01' }, /date like/],
      [{ title: 'Promo', reward_naira: 10, eligibility_rules: [{ type: 'completed_task', value: 1 }] }, /Rule 1/],
      [{ title: 'Promo', reward_naira: 10, is_active: 'maybe' }, /true or false/],
      ['nope', /JSON object/],
    ];
    for (const [body, pattern] of bodies) {
      const checked = rules.readGiftboxCreate(body);
      assert.equal(checked.ok, false, JSON.stringify(body));
      if (!checked.ok) assert.match(checked.message, pattern);
    }
  });

  test('reads patch bodies, including the mobile toggle', () => {
    const toggle = rules.readGiftboxPatch({ id: BOX, is_active: false });
    assert.ok(toggle.ok);
    if (toggle.ok) {
      assert.deepEqual(toggle.value.fields, { is_active: false });
      assert.equal(toggle.value.rules, undefined);
      assert.equal(toggle.value.expected, null);
    }
    assert.equal(rules.readGiftboxPatch({ id: 'not-a-uuid', is_active: true }).ok, false);
    const withExpected = rules.readGiftboxPatch({
      id: BOX.toUpperCase(),
      reward_naira: 2000,
      eligibility_rules: [{ type: 'cooldown_days', value: 2 }],
      expected: { reward_naira: '1500.00', is_active: true },
      reason: '  promo update ',
    });
    assert.ok(withExpected.ok);
    if (withExpected.ok) {
      assert.equal(withExpected.value.id, BOX);
      assert.deepEqual(withExpected.value.expected, { reward_naira: 1500, is_active: true });
      assert.deepEqual(withExpected.value.rules, [{ type: 'cooldown_days', value: 2 }]);
      assert.equal(withExpected.value.reason, 'promo update');
    }
    assert.equal(rules.readGiftboxPatch({ id: BOX, expected: { reward_naira: 'abc' } }).ok, false);
    assert.equal(rules.readGiftboxPatch({ id: BOX, eligibility_rules: 'x' }).ok, false);
  });

  test('detects conflicts against the stored row only for sent fields', () => {
    const live = storedBox({ reward_naira: '2000.00' });
    assert.deepEqual(rules.giftboxConflicts({ reward_naira: 1500 }, live), ['reward_naira']);
    assert.deepEqual(rules.giftboxConflicts({ reward_naira: 2000, title: 'Weekend boost ' }, live), []);
    assert.deepEqual(
      rules.giftboxConflicts({ eligibility_rules: [{ value: 3, type: 'min_trades' }], is_active: true }, live),
      [],
    );
  });

  test('plans only the fields that change', () => {
    const live = storedBox();
    const plan = rules.planGiftboxUpdate({ title: 'Weekend boost', reward_naira: 2500 }, undefined, live);
    assert.deepEqual(plan.update, { reward_naira: 2500 });
    assert.deepEqual(plan.changed, ['reward_naira']);
    assert.deepEqual(plan.before, { reward_naira: 1500 });
    assert.equal(plan.financial, true);
    const text = rules.planGiftboxUpdate({ description: 'New text' }, undefined, live);
    assert.equal(text.financial, false);
    const same = rules.planGiftboxUpdate({}, [{ type: 'min_trades', value: 3 }], live);
    assert.deepEqual(same.changed, []);
    assert.equal(plan.problem, null);
  });

  test('refuses sub-kobo rewards only when the reward changes', () => {
    const patch = rules.readGiftboxPatch({ id: BOX, reward_naira: 10.005 });
    assert.ok(patch.ok);
    if (!patch.ok) return;
    assert.equal(rules.planGiftboxUpdate(patch.value.fields, undefined, storedBox({ reward_naira: 10.005 })).problem, null);
    assert.match(rules.planGiftboxUpdate(patch.value.fields, undefined, storedBox()).problem ?? '', /2 decimal places/);
  });
});

describe('level readers and write plans', () => {
  test('reads the mobile single-tier body', () => {
    const checked = rules.readLevelPatch({
      id: TIER_1,
      name: ' Elite ',
      target_usd: 500,
      bonus_naira: 3500,
      badge_url: null,
      is_active: true,
    });
    assert.ok(checked.ok);
    if (checked.ok) {
      assert.equal(checked.value.batch, false);
      assert.deepEqual(checked.value.changes, [{
        id: TIER_1,
        values: { name: 'Elite', target_usd: 500, bonus_naira: 3500, badge_url: null, is_active: true },
        expected: null,
      }]);
    }
  });

  test('refuses invalid tier values', () => {
    const bodies: Array<[unknown, RegExp]> = [
      [{ id: 'x', name: 'A' }, /^Invalid id$/],
      [{ id: TIER_1, name: '  ' }, /name/],
      [{ id: TIER_1, name: 'x'.repeat(81) }, /80 characters/],
      [{ id: TIER_1, target_usd: -5 }, /trade target/],
      [{ id: TIER_1, bonus_naira: 1_000_000_001 }, /bonus/],
      [{ id: TIER_1, bonus_naira: 'lots' }, /bonus/],
      [{ id: TIER_1, badge_url: 'http://example.com/badge.png' }, /https:\/\//],
      [{ changes: [] }, /No tier changes/],
      [{ changes: [{ id: TIER_1, name: 'A' }, { id: TIER_1, name: 'B' }] }, /more than once/],
      [{ changes: [{ id: TIER_1 }] }, /nothing to save/],
      [{ changes: Array.from({ length: 7 }, () => ({ id: TIER_1, name: 'A' })) }, /at most 6/],
    ];
    for (const [body, pattern] of bodies) {
      const checked = rules.readLevelPatch(body);
      assert.equal(checked.ok, false, JSON.stringify(body));
      if (!checked.ok) assert.match(checked.message, pattern);
    }
  });

  test('reads batch changes with expected values', () => {
    const checked = rules.readLevelPatch({
      changes: [{ id: TIER_1, bonus_naira: '2500', is_active: 'false', expected: { bonus_naira: 2000, is_active: true } }],
      reason: 'campaign',
    });
    assert.ok(checked.ok);
    if (checked.ok) {
      assert.equal(checked.value.batch, true);
      assert.equal(checked.value.reason, 'campaign');
      assert.deepEqual(checked.value.changes[0].values, { bonus_naira: 2500, is_active: false });
      assert.deepEqual(checked.value.changes[0].expected, { bonus_naira: 2000, is_active: true });
    }
  });

  test('plans tier writes with compare-and-swap semantics', () => {
    const live = storedTier({ bonus_naira: '2000.00' });
    assert.deepEqual(rules.planTierWrite({ id: TIER_1, values: { bonus_naira: 2000, name: 'Newbie' }, expected: null }, live), { kind: 'unchanged' });
    assert.deepEqual(
      rules.planTierWrite({ id: TIER_1, values: { bonus_naira: 2500 }, expected: { bonus_naira: 1800 } }, live),
      { kind: 'conflict', fields: ['bonus_naira'] },
    );
    assert.deepEqual(
      rules.planTierWrite({ id: TIER_1, values: { bonus_naira: 2500 }, expected: { bonus_naira: 2000, name: 'Other' } }, live),
      { kind: 'write', update: { bonus_naira: 2500 }, before: { bonus_naira: 2000 }, financial: true },
    );
    const rename = rules.planTierWrite({ id: TIER_1, values: { name: 'Starter' }, expected: { name: 'Newbie' } }, live);
    assert.equal(rename.kind, 'write');
    if (rename.kind === 'write') assert.equal(rename.financial, false);
  });

  test('checks cents only on values that change, so resent legacy values still save', () => {
    const read = rules.readLevelPatch({ id: TIER_1, name: 'Newbie', bonus_naira: 2000.555 });
    assert.ok(read.ok);
    if (!read.ok) return;
    const change = read.value.changes[0];
    assert.deepEqual(rules.planTierWrite(change, storedTier({ bonus_naira: 2000.555 })), { kind: 'unchanged' });
    const changed = rules.planTierWrite(change, storedTier());
    assert.equal(changed.kind, 'invalid');
    if (changed.kind === 'invalid') assert.match(changed.message, /2 decimal places for the bonus/);
  });

  test('explains partial and failed tier saves', () => {
    assert.deepEqual(rules.tierVerdict([{ id: TIER_1, status: 'saved', tier: null }]), { ok: true });
    const partial = rules.tierVerdict([
      { id: TIER_1, status: 'saved', tier: null },
      { id: TIER_2, status: 'conflict', tier: null },
    ]);
    assert.equal(partial.ok, false);
    if (!partial.ok) {
      assert.equal(partial.code, 'STATE_CONFLICT');
      assert.match(partial.message, /^1 of 2 tiers saved; 1 not saved\. 1 tier changed after you loaded it\./);
    }
    const error = rules.tierVerdict([{ id: TIER_1, status: 'error', tier: null }]);
    assert.ok(!error.ok && error.code === 'INTERNAL_ERROR');
  });
});

describe('programme settings model', () => {
  const snapshot = (): SettingsSnapshot => {
    const parsed = model.toSettingsSnapshot({
      config: { signup_bonus_active: 'true', signup_bonus_amount: '2000', signup_bonus_condition: 'first_trade' },
    });
    assert.ok(parsed);
    return parsed;
  };

  test('reads app config values and marks missing keys', () => {
    const parsed = snapshot();
    assert.equal(parsed.values.signup_bonus_amount, '2000');
    assert.equal(parsed.values.levels_active, null);
    assert.equal(model.toSettingsSnapshot({}), null);
  });

  test('stages edits and drops them when they match the live value again', () => {
    const live = snapshot();
    let draft = model.editSetting(model.EMPTY_SETTINGS_DRAFT, live, 'signup_bonus_active', 'false');
    assert.equal(model.settingsCount(draft), 1);
    draft = model.editSetting(draft, live, 'signup_bonus_active', 'true');
    assert.deepEqual(draft, {});
    draft = model.editSetting(draft, live, 'signup_bonus_amount', '2000.0');
    assert.equal(model.settingValue(live, draft, 'signup_bonus_amount'), '2000.0');
    assert.equal(model.settingsCount(draft), 0);
    draft = model.editSetting(draft, live, 'signup_bonus_amount', '2,500');
    assert.equal(model.settingsCount(draft), 1);
    assert.deepEqual(model.settingsPayload(model.settingsChanges(draft)), {
      changes: { signup_bonus_amount: '2500' },
      expected: { signup_bonus_amount: '2000' },
    });
  });

  test('blocks a switched-on bonus with no amount', () => {
    const live = model.toSettingsSnapshot({ config: { signup_bonus_active: 'false', signup_bonus_amount: '0' } });
    assert.ok(live);
    const draft = model.editSetting(model.EMPTY_SETTINGS_DRAFT, live, 'signup_bonus_active', 'true');
    assert.match(model.settingsErrors(live, draft).signup_bonus_amount ?? '', /above ₦0/);
    const typo = model.editSetting(model.EMPTY_SETTINGS_DRAFT, snapshot(), 'signup_bonus_amount', '2000abc');
    assert.match(model.settingsErrors(snapshot(), typo).signup_bonus_amount ?? '', /Enter a number/);
  });

  test('rebases onto fresh values and reports conflicts', () => {
    const live = snapshot();
    const draft = model.editSetting(
      model.editSetting(model.EMPTY_SETTINGS_DRAFT, live, 'signup_bonus_amount', '3000'),
      live,
      'signup_bonus_active',
      'false',
    );
    const fresh = model.toSettingsSnapshot({ config: { signup_bonus_active: 'false', signup_bonus_amount: '2500' } });
    assert.ok(fresh);
    const rebased = model.rebaseSettings(draft, fresh);
    assert.deepEqual(rebased.alreadyLive, ['signup_bonus_active']);
    assert.deepEqual(rebased.conflicts, [{ key: 'signup_bonus_amount', live: '2500' }]);
    assert.equal(rebased.draft.signup_bonus_amount?.base, '2500');
    assert.equal(rebased.draft.signup_bonus_amount?.conflict, true);
    const notice = model.rebaseSettingsNotice(rebased);
    assert.equal(notice?.items.length, 2);
  });

  test('explains consequences, including typo-sized moves', () => {
    const live = snapshot();
    const draft = model.editSetting(model.EMPTY_SETTINGS_DRAFT, live, 'signup_bonus_amount', '20000');
    const lines = model.settingsConsequences(model.settingsChanges(draft));
    assert.match(lines[0], /pay ₦20,000\.00 instead of ₦2,000\.00/);
    assert.match(lines[0], /tenfold/);
    const off = model.editSetting(model.EMPTY_SETTINGS_DRAFT, live, 'levels_active', 'false');
    assert.equal(model.settingsChanges(off).length, 0);
    const on = model.editSetting(model.EMPTY_SETTINGS_DRAFT, live, 'levels_active', 'true');
    const optionsFor = options.settingsReviewOptions(model.settingsChanges(on));
    assert.equal(optionsFor.tone, 'financial');
    assert.equal(optionsFor.confirmLabel, 'Apply change');
  });

  test('describes conditions honestly, including unenforced ones', () => {
    assert.equal(model.conditionText('click_activate'), 'Straight away');
    assert.match(model.conditionText('first_withdrawal'), /not enforced/);
    assert.equal(model.isSignupCondition('first_withdrawal'), false);
    assert.deepEqual(model.SIGNUP_CONDITIONS.map((option) => option.value), ['first_trade', 'click_activate']);
  });

  test('classifies config saves', () => {
    assert.deepEqual(model.classifyConfigSave({ ok: true, data: {}, status: 200, requestId: null }), { kind: 'done' });
    assert.deepEqual(model.classifyConfigSave(failure(401)), { kind: 'expired' });
    assert.equal(model.classifyConfigSave(failure(null, { outcomeUnknown: true })).kind, 'unknown');
    assert.equal(model.classifyConfigSave(failure(403)).kind, 'refused');
    assert.equal(model.classifyConfigSave(failure(400)).kind, 'retry');
    assert.equal(model.classifyConfigSave(failure(409)).kind, 'conflict');
    assert.ok(model.sameSettings(snapshot(), { signup_bonus_amount: '2000.00', signup_bonus_active: 'true' }));
  });
});

describe('gift box model', () => {
  test('maps list responses and honest claim counts', () => {
    const list = model.toGiftboxList({
      items: [
        { ...storedBox(), claims: 7, claims_counted: true },
        { ...storedBox({ id: BOX_2 }), claims: 0, claims_counted: false },
        { title: 'no id' },
      ],
    });
    assert.ok(list);
    assert.equal(list?.length, 2);
    assert.equal(list?.[0].claims, 7);
    assert.equal(list?.[1].claims, null);
    assert.equal(model.toGiftboxList({}), null);
  });

  test('derives status the way the app and claim check behave', () => {
    assert.equal(model.giftboxStatus(item(), TODAY).kind, 'live');
    assert.equal(model.giftboxStatus(item({ is_active: false }), TODAY).kind, 'off');
    assert.equal(model.giftboxStatus(item({ expiry_date: null }), TODAY).kind, 'hidden');
    assert.equal(model.giftboxStatus(item({ expiry_date: '2026-10-02' }), TODAY).kind, 'ended');
    assert.equal(model.giftboxStatus(item({ expiry_date: TODAY }), TODAY).kind, 'live');
    assert.equal(model.giftboxStatus(item({ eligibility_rules: [{ type: 'completed_task', value: 1 }] }), TODAY).kind, 'failing');
  });

  test('validates the editor form', () => {
    const empty = model.checkGiftboxForm(model.emptyGiftboxForm(), [], TODAY);
    assert.ok(empty.errors.title);
    assert.ok(empty.errors.reward);
    assert.equal(empty.values, null);
    const form = { ...model.emptyGiftboxForm(), title: 'Promo', reward: '1,500', expiry: '' };
    const noEnd = model.checkGiftboxForm(form, [], TODAY);
    assert.ok(noEnd.values);
    assert.match(noEnd.warnings[0], /does not list/);
    const past = model.checkGiftboxForm({ ...form, expiry: '2026-01-01' }, [], TODAY);
    assert.match(past.warnings[0], /has passed/);
    assert.equal(past.values?.reward_naira, 1500);
    assert.equal(model.checkGiftboxForm({ ...form, expiry: '2026-02-30' }, [], TODAY).errors.expiry, 'Use a date like 2026-12-31.');
  });

  test('keeps legacy rules only while the rules are unchanged', () => {
    let key = 0;
    const nextKey = () => `rule-${(key += 1)}`;
    const legacy = item({ eligibility_rules: [{ type: 'cooldown_days', value: 7 }, { type: 'min_trades', value: 2 }] });
    const form = model.giftboxFormFrom(legacy, nextKey);
    assert.equal(model.isLegacyRule(form.rules[0]), true);
    const untouched = model.checkGiftboxForm({ ...form, title: 'Renamed' }, legacy.rules, TODAY);
    assert.ok(untouched.values);
    assert.equal(untouched.rules.changed, false);
    assert.match(untouched.rules.warnings[form.rules[0].key], /only once/);
    const edited = model.checkGiftboxForm({ ...form, rules: [form.rules[0], { ...form.rules[1], a: '5' }] }, legacy.rules, TODAY);
    assert.equal(edited.values, null);
    assert.match(edited.rules.problems[form.rules[0].key], /Remove this rule/);
  });

  test('builds change lists and patch bodies for changed fields only', () => {
    const live = item();
    const values = {
      title: 'Weekend boost',
      description: 'Trade this weekend',
      reward_naira: 2000,
      expiry_date: '2026-12-31',
      eligibility_condition: null,
      eligibility_rules: [{ type: 'min_trades', value: 3 }, { type: 'email_verified', value: null }],
      is_active: true,
    };
    const changes = model.giftboxChanges(live, values);
    assert.deepEqual(changes.map((change) => change.field), ['reward_naira', 'eligibility_rules']);
    assert.equal(changes[0].from, '₦1,500.00');
    assert.equal(changes[0].to, '₦2,000.00');
    assert.deepEqual(changes[1].toList, ['At least 3 approved trades', 'Email address verified']);
    const body = model.giftboxPatchBody(live, values, changes);
    assert.deepEqual(body, {
      id: BOX,
      reward_naira: 2000,
      eligibility_rules: values.eligibility_rules,
      expected: { reward_naira: 1500, eligibility_rules: [{ type: 'min_trades', value: 3 }] },
    });
    assert.deepEqual(model.giftboxToggleBody(live, false), { id: BOX, is_active: false, expected: { is_active: true } });
  });

  test('rebases the form onto a newer version without losing edits', () => {
    let key = 0;
    const nextKey = () => `rule-${(key += 1)}`;
    const old = item();
    const form = { ...model.giftboxFormFrom(old, nextKey), reward: '1800' };
    const latest = item({ reward_naira: 1700, description: 'Updated by someone else' });
    const rebased = model.rebaseGiftboxForm(form, old, latest, nextKey);
    assert.equal(rebased.form.reward, '1800');
    assert.equal(rebased.form.description, 'Updated by someone else');
    assert.deepEqual(rebased.conflicts, ['Reward']);
    assert.equal(model.formDirty(model.giftboxFormFrom(old, nextKey), model.giftboxFormFrom(old, nextKey)), false);
    assert.equal(model.formDirty(form, model.giftboxFormFrom(old, nextKey)), true);
  });

  test('classifies gift box saves', () => {
    const receipt = model.toGiftboxReceipt({ changed: true, item: { ...storedBox(), claims: 0 }, audit_recorded: false });
    assert.match(receipt.warning ?? '', /audit log/);
    const saved: ApiResult<ReturnType<Model['toGiftboxReceipt']>> = { ok: true, data: receipt, status: 200, requestId: null };
    assert.equal(model.classifyGiftboxSave(saved).kind, 'saved');
    const conflict = model.classifyGiftboxSave(failure(409, { details: { item: { ...storedBox({ reward_naira: 999 }) } } }));
    assert.equal(conflict.kind, 'conflict');
    if (conflict.kind === 'conflict') assert.equal(conflict.live?.reward, 999);
    assert.equal(model.classifyGiftboxSave(failure(404)).kind, 'missing');
    assert.equal(model.classifyGiftboxSave(failure(null, { outcomeUnknown: true })).kind, 'unknown');
    assert.equal(model.classifyGiftboxSave(failure(403)).kind, 'refused');
    assert.equal(model.classifyGiftboxSave(failure(400)).kind, 'retry');
    assert.equal(model.classifyGiftboxSave(failure(401)).kind, 'expired');
  });

  test('confirm options name the money and the audience', () => {
    const hidden = item({ expiry_date: null, is_active: false });
    const on = options.giftboxToggleOptions(hidden, true, TODAY);
    assert.equal(on.tone, 'financial');
    assert.match((on.consequences ?? []).join(' '), /does not list it/);
    const off = options.giftboxToggleOptions(item(), false, TODAY);
    assert.equal(off.tone, 'danger');
    assert.match((off.consequences ?? [])[0], /no longer see or claim/);
    const values = {
      title: 'New', description: null, reward_naira: 750, expiry_date: '2026-11-30', eligibility_condition: null,
      eligibility_rules: [], is_active: true,
    };
    const create = options.giftboxCreateOptions(values, [], TODAY);
    assert.match((create.consequences ?? [])[0], /Every user can claim ₦750\.00 once/);
    const live = item();
    const edit = options.giftboxEditOptions(live, { ...values, title: live.title, reward_naira: 15000, expiry_date: live.expiry }, [
      { field: 'reward_naira', label: 'Reward', from: '₦1,500.00', to: '₦15,000.00', fromList: null, toList: null },
    ], [], TODAY);
    assert.equal(edit.tone, 'financial');
    assert.match((edit.consequences ?? [])[0], /tenfold/);
  });

  test('leave guard only intercepts same-origin navigation to another page', () => {
    assert.equal(model.leavePath('/rates', 'https://admin.test/bonuses-rewards'), '/rates');
    assert.equal(model.leavePath('/bonuses-rewards', 'https://admin.test/bonuses-rewards'), null);
    assert.equal(model.leavePath('https://other.test/x', 'https://admin.test/bonuses-rewards'), null);
    assert.equal(model.leavePath('/bonuses-rewards/levels#tier', 'https://admin.test/bonuses-rewards'), '/bonuses-rewards/levels#tier');
  });
});

describe('level tiers model', () => {
  function tierOf(snapshot: TierSnapshot, id: string): Tier {
    const tier = snapshot.byId[id];
    assert.ok(tier);
    return tier;
  }

  test('maps and orders tiers', () => {
    const snapshot = tierSnapshot([
      { id: TIER_2, tier_order: 2, name: 'Elite', target_usd: 500, bonus_naira: 3500, claims: 3 },
      { id: TIER_1, tier_order: 1 },
    ]);
    assert.deepEqual(snapshot.tiers.map((tier) => tier.order), [1, 2]);
    assert.equal(levels.tierTitle(snapshot.tiers[1]), 'Tier 2 · Elite');
    const uncounted = levels.toTierSnapshot({ tiers: [{ ...storedTier(), claims: 0, claims_counted: false }] });
    assert.equal(uncounted?.tiers[0].claims, null);
  });

  test('stages, counts and reverts tier edits', () => {
    const snapshot = tierSnapshot([{ id: TIER_1 }]);
    const tier = tierOf(snapshot, TIER_1);
    let draft = levels.editTier(levels.EMPTY_TIER_DRAFT, tier, { bonus: '2500', active: false });
    assert.equal(levels.tierDraftCount(draft), 2);
    draft = levels.editTier(draft, tier, { bonus: '2000', active: true });
    assert.deepEqual(draft, {});
    draft = levels.editTier(draft, tier, { target: '200.00' });
    assert.equal(levels.tierDraftCount(draft), 0);
    assert.deepEqual(levels.revertTier(draft, TIER_1), {});
  });

  test('reviews tiers into before and after values and refuses bad input', () => {
    const snapshot = tierSnapshot([{ id: TIER_1 }]);
    const tier = tierOf(snapshot, TIER_1);
    const bad = levels.reviewTiers(snapshot, levels.editTier(levels.EMPTY_TIER_DRAFT, tier, { bonus: '-5', name: ' ' }));
    assert.deepEqual(bad.first, { id: TIER_1, field: 'name' });
    assert.equal(bad.changes.length, 0);
    const good = levels.reviewTiers(snapshot, levels.editTier(levels.EMPTY_TIER_DRAFT, tier, { bonus: '2,500', badge: 'https://cdn.test/b.webp' }));
    assert.deepEqual(good.changes[0].fields.map((field) => [field.key, field.from, field.to]), [
      ['bonus_naira', 2000, 2500],
      ['badge_url', null, 'https://cdn.test/b.webp'],
    ]);
    assert.deepEqual(levels.tierPayload(good.changes), {
      changes: [{
        id: TIER_1,
        bonus_naira: 2500,
        badge_url: 'https://cdn.test/b.webp',
        expected: { bonus_naira: 2000, badge_url: null },
      }],
    });
  });

  test('rebases tier drafts and reports conflicts', () => {
    const snapshot = tierSnapshot([{ id: TIER_1 }, { id: TIER_2, tier_order: 2, name: 'Elite' }]);
    let draft = levels.editTier(levels.EMPTY_TIER_DRAFT, tierOf(snapshot, TIER_1), { bonus: '2500' });
    draft = levels.editTier(draft, tierOf(snapshot, TIER_2), { name: 'Elite Plus' });
    const fresh = tierSnapshot([
      { id: TIER_1, bonus_naira: 2200 },
      { id: TIER_2, tier_order: 2, name: 'Elite Plus' },
    ]);
    const rebased = levels.rebaseTiers(draft, fresh);
    assert.deepEqual(rebased.alreadyLive.map((note) => note.id), [TIER_2]);
    assert.equal(rebased.conflicts.length, 1);
    assert.deepEqual(rebased.conflicts[0].fields, ['bonus']);
    assert.deepEqual(rebased.draft[TIER_1]?.conflict, { bonus_naira: 2200 });
    assert.match(levels.rebaseTiersNotice(rebased, true)?.items[0].detail ?? '', /bonus to ₦2,200\.00/);
  });

  test('settles partial saves and keeps failed tiers unsaved', () => {
    const snapshot = tierSnapshot([{ id: TIER_1 }, { id: TIER_2, tier_order: 2, name: 'Elite' }]);
    let draft = levels.editTier(levels.EMPTY_TIER_DRAFT, tierOf(snapshot, TIER_1), { bonus: '2500' });
    draft = levels.editTier(draft, tierOf(snapshot, TIER_2), { bonus: '4000' });
    const pending = levels.reviewTiers(snapshot, draft).changes;
    const outcome = levels.classifyTierSave(failure(409, {
      message: '1 of 2 tiers saved; 1 not saved.',
      details: {
        results: [
          { id: TIER_1, status: 'saved', tier: { ...storedTier({ bonus_naira: 2500 }) } },
          { id: TIER_2, status: 'conflict', tier: null },
        ],
      },
    }));
    assert.equal(outcome.kind, 'partial');
    const settled = levels.settleTierSave(draft, pending, outcome, null);
    assert.equal(settled.draft[TIER_1], undefined);
    assert.match(settled.draft[TIER_2]?.failure ?? '', /changed this tier/);
    assert.equal(settled.notice?.tone, 'danger');
    const saved = levels.settleTierSave(draft, pending, { kind: 'saved', results: [], warning: null }, null);
    assert.equal(levels.tierDraftCount(saved.draft), 0);
    assert.equal(levels.classifyTierSave(failure(null, { outcomeUnknown: true })).kind, 'unknown');
  });

  test('checks badge files like the upload route', () => {
    assert.match(levels.badgeFileProblem('badge.svg', 100) ?? '', /png, jpg, jpeg, webp/);
    assert.match(levels.badgeFileProblem('badge.png', 6 * 1024 * 1024) ?? '', /5 MB/);
    assert.equal(levels.badgeFileProblem('Badge.WEBP', 1000), null);
    assert.equal(levels.BADGE_ACCEPT, '.png,.jpg,.jpeg,.webp');
    assert.deepEqual(levels.toUploadReceipt({ url: 'https://cdn.test/a.webp', audit_recorded: true }), { url: 'https://cdn.test/a.webp', warning: null });
    assert.equal(levels.toUploadReceipt({}), null);
  });

  test('confirm options describe tier consequences', () => {
    const snapshot = tierSnapshot([{ id: TIER_1, target_usd: 500 }]);
    const tier = tierOf(snapshot, TIER_1);
    const draft = levels.editTier(levels.EMPTY_TIER_DRAFT, tier, { target: '300', active: false });
    const confirmOptions = levelOptions.tierReviewOptions(levels.reviewTiers(snapshot, draft).changes);
    assert.equal(confirmOptions.tone, 'financial');
    const lines = (confirmOptions.consequences ?? []).join(' ');
    assert.match(lines, /already traded \$300 or more since reaching it can claim straight away/);
    assert.match(lines, /cannot claim it or move past it/);
    assert.equal(confirmOptions.details?.length, 2);
    assert.equal(confirmOptions.confirmLabel, 'Save 2 changes');
  });
});

describe('RuleBuilder', () => {
  test('renders named remove buttons with an icon and offers no broken rule types', () => {
    const RuleBuilder = builder.RuleBuilder;
    const html = render(createElement(RuleBuilder, {
      idBase: 'rb',
      rules: [
        { key: 'r1', type: 'min_trades', a: '3', b: '', legacy: null },
        { key: 'r2', type: 'cooldown_days', a: '', b: '', legacy: { type: 'cooldown_days', value: 7 } },
      ],
      problems: {},
      warnings: { r2: 'Each user can claim a gift box only once.' },
      nextKey: () => 'r3',
      onChange: () => {},
      onBlur: () => {},
    }));
    const removes = tagsOf(html, 'button').filter((attrs) => (attrs['aria-label'] ?? '').startsWith('Remove rule'));
    assert.deepEqual(removes.map((attrs) => attrs['aria-label']), [
      'Remove rule 1: At least 3 approved trades',
      'Remove rule 2: 7 days between claims',
    ]);
    const buttons = html.split('<button').filter((chunk) => chunk.includes('aria-label="Remove rule'));
    for (const chunk of buttons) assert.match(chunk, /<svg/);
    assert.doesNotMatch(html, /value="completed_task"/);
    assert.doesNotMatch(html, /value="cooldown_days"/);
    assert.match(textOf(html), /Each user can claim a gift box only once\./);
  });
});

describe('bonuses unit hard rules', () => {
  const root = fileURLToPath(new URL('../app/(dashboard)/bonuses-rewards/', import.meta.url));
  const routeFiles = ['bonuses/route.ts', 'levels/route.ts', 'levels/upload/route.ts', 'giftbox/route.ts']
    .map((file) => fileURLToPath(new URL(`../app/api/${file}`, import.meta.url)));

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  }

  const files = [...walk(root), ...routeFiles];

  test('the old shared RuleBuilder is gone', () => {
    const shared = fileURLToPath(new URL('../app/_shared/RuleBuilder.tsx', import.meta.url));
    assert.throws(() => statSync(shared));
  });

  test('source files carry no prose comments', () => {
    for (const file of files.filter((path) => /\.(tsx?|css)$/.test(path))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (const line of lines) {
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
      assert.doesNotMatch(css, /z-index:\s*-?\d/, file);
    }
  });

  test('components carry no static inline styles', () => {
    for (const file of files.filter((path) => path.endsWith('.tsx'))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /style=\{\{/, file);
    }
  });
});
