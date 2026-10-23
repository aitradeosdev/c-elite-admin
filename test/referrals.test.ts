import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ElementType } from 'react';
import { loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiResult } from '../app/lib/apiClient.ts';
import type {
  FilterPlan, ReferralFacts, SettingKey, StatusFilter, StoredReferral, StoredSetting, StoredSettings, UserBrief,
} from '../app/(dashboard)/referral-management/referralRules.ts';
import type { SaveReceipt } from '../app/(dashboard)/referral-management/model.ts';

type Rules = typeof import('../app/(dashboard)/referral-management/referralRules.ts');
type ConfigRules = typeof import('../app/(dashboard)/referral-management/appConfigRules.ts');
type Model = typeof import('../app/(dashboard)/referral-management/model.ts');
type Options = typeof import('../app/(dashboard)/referral-management/confirmOptions.tsx');
type BonusModel = typeof import('../app/(dashboard)/bonuses-rewards/model.ts');

let rules: Rules;
let config: ConfigRules;
let model: Model;
let options: Options;
let parts: Record<string, ElementType>;
let bonuses: BonusModel;

before(async () => {
  rules = await loadAppModule<Rules>('(dashboard)/referral-management/referralRules.ts');
  config = await loadAppModule<ConfigRules>('(dashboard)/referral-management/appConfigRules.ts');
  model = await loadAppModule<Model>('(dashboard)/referral-management/model.ts');
  options = await loadAppModule<Options>('(dashboard)/referral-management/confirmOptions.tsx');
  parts = await loadAppModule<Record<string, ElementType>>('(dashboard)/referral-management/ReferralParts.tsx');
  bonuses = await loadAppModule<BonusModel>('(dashboard)/bonuses-rewards/model.ts');
});

const REFERRER = '0a000000-0000-4000-8000-000000000001';
const REFEREE = '0a000000-0000-4000-8000-000000000002';
const REFERRAL = '0a000000-0000-4000-8000-000000000003';
const STAMP = '2026-10-01T09:00:00.000Z';

const OWNED_DIR = fileURLToPath(new URL('../app/(dashboard)/referral-management/', import.meta.url));
const REFERRALS_ROUTE = fileURLToPath(new URL('../app/api/referrals/route.ts', import.meta.url));
const APP_CONFIG_ROUTE = fileURLToPath(new URL('../app/api/app-config/route.ts', import.meta.url));
const ADMIN_SQL = fileURLToPath(new URL('../../schema_admin_app.sql', import.meta.url));

const PREVIOUS_ALLOWED_KEYS = [
  'bill_vtpass_enabled', 'bill_novac_enabled', 'active_bill_provider',
  'gateway_paystack_enabled', 'gateway_monnify_enabled', 'gateway_novac_enabled',
  'min_withdrawal_amount', 'max_withdrawal_amount', 'max_daily_withdrawal', 'withdraw_fee',
  'min_electricity_amount', 'electricity_quick_amounts',
  'min_airtime_amount', 'max_airtime_amount',
  'min_data_amount', 'max_data_amount',
  'min_cable_amount', 'max_cable_amount',
  'signup_bonus_amount', 'signup_bonus_condition', 'signup_bonus_active',
  'referral_active', 'referral_referrer_bonus', 'referral_referee_bonus', 'referral_min_trade_usd', 'referral_max_per_day',
  'level_bonus_active', 'levels_active',
  'pin_reset_freeze_hours',
  'large_withdrawal_flag_threshold',
  'signup_rate_limit_per_hour',
  'anomaly_dormant_days', 'anomaly_dormant_amount',
  'anomaly_rapid_window_mins', 'anomaly_rapid_ratio',
  'anomaly_failures_window_mins', 'anomaly_failures_threshold',
  'critical_alert_amount', 'alert_email_batch',
  'paystack_webhook_ips', 'monnify_webhook_ips', 'novac_webhook_ips',
  'terms_url', 'privacy_url', 'chatwoot_base_url', 'chatwoot_website_token',
  'store_url_android', 'store_url_ios',
  'app_current_version', 'app_update_type', 'app_update_message',
  'withdrawal_narrations',
  'coupon_terms_of_use',
  'iana_timezone',
];

const TEST_ALLOWED: ReadonlySet<string> = new Set(PREVIOUS_ALLOWED_KEYS);

function stored(value: string | null, exists = true): StoredSetting {
  return { value, updated_at: exists ? STAMP : null, exists };
}

function settings(overrides: Partial<Record<SettingKey, StoredSetting>> = {}): StoredSettings {
  return {
    referral_active: stored('true'),
    referral_referrer_bonus: stored('500'),
    referral_referee_bonus: stored('500'),
    referral_min_trade_usd: stored('50'),
    referral_max_per_day: stored('10'),
    ...overrides,
  };
}

function facts(overrides: ReferralFacts = {}): ReferralFacts {
  return {
    first_trade_completed: true,
    referrer_bonus_amount: 500,
    referee_bonus_amount: 300,
    referrer_credited: false,
    referee_credited: false,
    ...overrides,
  };
}

function failure(status: number | null, extra: Partial<{ code: string; outcomeUnknown: boolean; message: string }> = {}) {
  return {
    ok: false as const,
    error: {
      kind: status === null ? ('network' as const) : ('http' as const),
      status,
      code: extra.code ?? null,
      message: extra.message ?? 'Request failed.',
      requestId: null,
      details: null,
      outcomeUnknown: extra.outcomeUnknown ?? false,
    },
  };
}

function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      out.push(text.slice(start, index));
      start = index + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

function evalCondition(condition: string, row: Record<string, unknown>): boolean {
  const nested = condition.match(/^(and|or)\((.*)\)$/);
  if (nested) {
    const items = splitTop(nested[2]);
    return nested[1] === 'and' ? items.every((item) => evalCondition(item, row)) : items.some((item) => evalCondition(item, row));
  }
  const [column, ...rest] = condition.split('.');
  const negate = rest[0] === 'not';
  const [operator, ...valueParts] = negate ? rest.slice(1) : rest;
  const value = valueParts.join('.');
  const cell = row[column];
  let result: boolean;
  switch (operator) {
    case 'is':
      result = value === 'null' ? cell === null || cell === undefined : cell === (value === 'true');
      break;
    case 'gt':
      result = typeof cell === 'number' && cell > Number(value);
      break;
    case 'lte':
      result = typeof cell === 'number' && cell <= Number(value);
      break;
    default:
      throw new Error(`unsupported operator ${operator}`);
  }
  return negate ? !result : result;
}

function matchesPlan(plan: Pick<FilterPlan, 'firstTrade' | 'groups'>, row: Record<string, unknown>): boolean {
  if (plan.firstTrade === 'done' && row.first_trade_completed !== true) return false;
  if (plan.firstTrade === 'not_done' && row.first_trade_completed === true) return false;
  const logic = rules.combineGroups(plan.groups);
  return logic === null || splitTop(logic).some((condition) => evalCondition(condition, row));
}

describe('referral setting validation', () => {
  test('accepts and canonicalises the values the database can read', () => {
    const cases: Array<[SettingKey, unknown, string]> = [
      ['referral_referrer_bonus', '1,500', '1500'],
      ['referral_referrer_bonus', '₦2,000.50', '2000.5'],
      ['referral_referee_bonus', 750, '750'],
      ['referral_referee_bonus', '0', '0'],
      ['referral_min_trade_usd', '$25', '25'],
      ['referral_min_trade_usd', '12.5', '12.5'],
      ['referral_max_per_day', '15', '15'],
      ['referral_max_per_day', '1,000', '1000'],
      ['referral_active', 'TRUE', 'true'],
      ['referral_active', false, 'false'],
    ];
    for (const [key, raw, expected] of cases) {
      const checked = rules.checkSetting(key, raw);
      assert.ok(checked.ok, `${key} ${String(raw)}`);
      if (checked.ok) assert.equal(checked.value, expected);
    }
  });

  test('refuses values that would break sign-ups or card approvals, with a reason', () => {
    const cases: Array<[SettingKey, unknown, RegExp]> = [
      ['referral_referrer_bonus', '', /Use 0 for no bonus/],
      ['referral_referrer_bonus', '-5', /cannot be negative/],
      ['referral_referrer_bonus', 'abc', /Enter a number/],
      ['referral_referee_bonus', '1,50', /commas only between thousands/],
      ['referral_referee_bonus', '10.555', /2 decimal places/],
      ['referral_referee_bonus', '1000001', /₦1,000,000 or less/],
      ['referral_min_trade_usd', '', /any approved trade/],
      ['referral_min_trade_usd', '100001', /100,000 or less/],
      ['referral_max_per_day', '0', /at least 1/],
      ['referral_max_per_day', '-3', /at least 1/],
      ['referral_max_per_day', '10.5', /whole number/],
      ['referral_max_per_day', '10001', /10,000 or less/],
      ['referral_active', 'yes', /on or off/],
      ['referral_active', null, /must be text or a number/],
      ['referral_referrer_bonus', { amount: 5 }, /must be text or a number/],
    ];
    for (const [key, raw, pattern] of cases) {
      const checked = rules.checkSetting(key, raw);
      assert.equal(checked.ok, false, `${key} ${JSON.stringify(raw)}`);
      if (!checked.ok) assert.match(checked.message, pattern);
    }
  });
});

describe('reading stored settings the way the database does', () => {
  test('an empty minimum first trade is flagged as stopping every card approval', () => {
    const reading = rules.readSetting('referral_min_trade_usd', stored(''));
    assert.equal(reading.effective, null);
    assert.equal(reading.issue?.level, 'danger');
    assert.match(reading.issue?.message ?? '', /an empty value/);
    assert.match(reading.issue?.message ?? '', /Every card approval fails/);
    assert.deepEqual(rules.readSetting('referral_min_trade_usd', stored(null, false)), { effective: 50, issue: null });
  });

  test('unreadable sign-up values are flagged as breaking referred sign-ups', () => {
    for (const key of ['referral_referrer_bonus', 'referral_active', 'referral_max_per_day'] as const) {
      const reading = rules.readSetting(key, stored(key === 'referral_max_per_day' ? '10.5' : 'abc'));
      assert.equal(reading.effective, null, key);
      assert.equal(reading.issue?.level, 'danger', key);
      assert.match(reading.issue?.message ?? '', /Sign-ups that use a referral code fail/, key);
    }
  });

  test('applies the database defaults for empty and missing values', () => {
    assert.deepEqual(rules.readSetting('referral_referrer_bonus', stored('')), { effective: 0, issue: null });
    assert.equal(rules.readSetting('referral_referee_bonus', stored(null, false)).issue?.level, 'warning');
    assert.equal(rules.readSetting('referral_active', stored('')).effective, true);
    assert.equal(rules.readSetting('referral_active', stored(null, true)).effective, true);
    const missingSwitch = rules.readSetting('referral_active', stored(null, false));
    assert.equal(missingSwitch.effective, false);
    assert.match(missingSwitch.issue?.message ?? '', /no new referrals/);
    assert.equal(rules.readSetting('referral_max_per_day', stored('')).effective, 10);
    assert.equal(rules.readSetting('referral_max_per_day', stored(null, false)).effective, null);
    assert.equal(rules.readSetting('referral_max_per_day', stored('0')).issue?.level, 'warning');
    assert.equal(rules.readSetting('referral_referee_bonus', stored('-10')).issue?.level, 'warning');
    assert.equal(rules.readSetting('referral_active', stored(' Off ')).effective, false);
  });

  test('describes values for people', () => {
    assert.equal(rules.settingText('referral_referrer_bonus', rules.readSetting('referral_referrer_bonus', stored('500'))), '₦500.00');
    assert.equal(rules.settingText('referral_max_per_day', rules.readSetting('referral_max_per_day', stored('1'))), '1 referral');
    assert.equal(rules.settingText('referral_min_trade_usd', rules.readSetting('referral_min_trade_usd', stored('50'))), '50');
    assert.equal(rules.settingText('referral_active', rules.readSetting('referral_active', stored('true'))), 'On');
    assert.equal(rules.settingText('referral_min_trade_usd', rules.readSetting('referral_min_trade_usd', stored('x'))), 'Unreadable');
    assert.equal(rules.settingText('referral_max_per_day', rules.readSetting('referral_max_per_day', stored(null, false))), 'Not set');
  });

  test('compares stored values by meaning', () => {
    assert.equal(rules.sameSettingValue('referral_referrer_bonus', '500.00', '500'), true);
    assert.equal(rules.sameSettingValue('referral_active', 't', 'true'), true);
    assert.equal(rules.sameSettingValue('referral_max_per_day', '', '10'), true);
    assert.equal(rules.sameSettingValue('referral_min_trade_usd', '', '50'), false);
    assert.equal(rules.sameSettingValue('referral_referee_bonus', null, '500'), false);
    assert.equal(rules.sameSettingValue('referral_referee_bonus', 'abc', 'abc'), true);
  });

  test('lists issues in setting order and finds the latest change', () => {
    const live = settings({
      referral_min_trade_usd: stored(''),
      referral_referrer_bonus: { value: '500', updated_at: '2026-10-02T10:00:00.000Z', exists: true },
    });
    assert.deepEqual(rules.settingIssues(live).map((item) => item.key), ['referral_min_trade_usd']);
    assert.equal(rules.latestUpdate(live), '2026-10-02T10:00:00.000Z');
  });
});

describe('referral status and the server-side filters agree', () => {
  const rows: Array<{ row: ReferralFacts; status: string }> = [
    { row: facts({ first_trade_completed: false }), status: 'awaiting' },
    { row: facts({ first_trade_completed: null, referrer_bonus_amount: 0, referee_bonus_amount: 0 }), status: 'awaiting' },
    { row: facts(), status: 'unclaimed' },
    { row: facts({ referrer_credited: true }), status: 'partly_claimed' },
    { row: facts({ referrer_credited: true, referee_credited: true }), status: 'claimed' },
    { row: facts({ referee_bonus_amount: 0, referrer_credited: true }), status: 'claimed' },
    { row: facts({ referrer_bonus_amount: null, referee_bonus_amount: 300, referee_credited: true }), status: 'claimed' },
    { row: facts({ referrer_bonus_amount: 0, referee_bonus_amount: null }), status: 'no_bonus' },
    { row: facts({ referrer_bonus_amount: 0, referee_bonus_amount: 300, referee_credited: null }), status: 'unclaimed' },
  ];

  test('derives the status from the credited flags and payable amounts', () => {
    for (const { row, status } of rows) assert.equal(rules.referralStatus(row), status, JSON.stringify(row));
  });

  test('counts only unlocked, unclaimed amounts as owed', () => {
    assert.equal(rules.owedAmount(facts()), 800);
    assert.equal(rules.owedAmount(facts({ referrer_credited: true })), 300);
    assert.equal(rules.owedAmount(facts({ first_trade_completed: false })), 0);
    assert.equal(rules.owedAmount(facts({ referrer_bonus_amount: '500.25', referee_bonus_amount: null })), 500.25);
  });

  test('every status filter selects exactly the rows its label promises', () => {
    for (const filter of rules.STATUS_FILTERS as readonly StatusFilter[]) {
      const plan = rules.statusPlan(filter);
      for (const { row } of rows) {
        assert.equal(
          matchesPlan(plan, row as Record<string, unknown>),
          rules.statusMatches(filter, row),
          `${filter} ${JSON.stringify(row)}`,
        );
      }
    }
    assert.deepEqual(rules.statusPlan(null), { firstTrade: null, groups: [] });
  });

  test('builds the PostgREST logic exactly', () => {
    assert.deepEqual(rules.statusPlan('unclaimed').groups, [[
      'and(referrer_credited.not.is.true,referrer_bonus_amount.gt.0)',
      'and(referee_credited.not.is.true,referee_bonus_amount.gt.0)',
    ]]);
    assert.equal(rules.combineGroups([]), null);
    assert.equal(rules.combineGroups([['a.eq.1', 'b.eq.2']]), 'a.eq.1,b.eq.2');
    assert.equal(rules.combineGroups([['a.eq.1', 'b.eq.2'], ['c.eq.3'], []]), 'and(or(a.eq.1,b.eq.2),c.eq.3)');
  });

  test('searches by matching users, or by an exact referral or user ID', () => {
    assert.match(rules.userSearchFilter('ada'), /^username\.ilike\.%ada%,full_name\.ilike\.%ada%,referral_code\.ilike\.%ada%$/);
    assert.deepEqual(rules.searchGroup('ada', [REFERRER, 'not-a-uuid', REFEREE]), [
      `referrer_id.in.(${REFERRER},${REFEREE})`,
      `referee_id.in.(${REFERRER},${REFEREE})`,
    ]);
    assert.deepEqual(rules.searchGroup(REFERRAL.toUpperCase(), []), [
      `id.eq.${REFERRAL}`, `referrer_id.eq.${REFERRAL}`, `referee_id.eq.${REFERRAL}`,
    ]);
    assert.deepEqual(rules.searchGroup('nobody', []), []);
    const many = Array.from({ length: 150 }, (_, index) => `0b000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    assert.equal(rules.SEARCH_USER_CAP, 50);
    assert.equal(rules.searchGroup('x', many)[0].split(',').length, rules.SEARCH_USER_CAP);
  });

  test('puts the search group ahead of the status groups', () => {
    const plan = rules.buildFilterPlan({ status: 'paid', fromIso: 'A', toIso: 'B' }, ['referrer_id.in.(x)']);
    assert.equal(plan.firstTrade, 'done');
    assert.deepEqual(plan.groups[0], ['referrer_id.in.(x)']);
    assert.equal(plan.groups.length, 4);
    assert.equal(plan.fromIso, 'A');
    assert.equal(plan.toIso, 'B');
  });
});

describe('list query parsing', () => {
  test('a call with no parameters keeps the legacy shape the mobile app relies on', () => {
    const checked = rules.readListQuery(new URLSearchParams(''));
    assert.ok(checked.ok);
    if (!checked.ok) return;
    assert.equal(checked.query.page, 1);
    assert.equal(checked.query.pageSize, 500);
    assert.equal(checked.query.sort, 'created_at');
    assert.equal(checked.query.ascending, false);
    assert.equal(checked.query.withStats, true);
    assert.equal(checked.query.status, null);
    assert.equal(checked.query.search, '');
  });

  test('reads paging, sorting, status, dates and search', () => {
    const checked = rules.readListQuery(new URLSearchParams(
      'page=3&page_size=25&sort=first_trade_at&dir=asc&stats=0&status=paid&date_from=2026-10-01&date_to=2026-10-02&search=ada<b>',
    ));
    assert.ok(checked.ok);
    if (!checked.ok) return;
    assert.equal(checked.query.page, 3);
    assert.equal(checked.query.pageSize, 25);
    assert.equal(checked.query.sort, 'first_trade_at');
    assert.equal(checked.query.ascending, true);
    assert.equal(checked.query.withStats, false);
    assert.equal(checked.query.status, 'paid');
    assert.equal(checked.query.fromIso, '2026-09-30T23:00:00.000Z');
    assert.equal(checked.query.toIso, '2026-10-02T23:00:00.000Z');
    assert.equal(checked.query.search, 'adab');
  });

  test('clamps sizes and ignores junk paging', () => {
    const big = rules.readListQuery(new URLSearchParams('page_size=9000&page=abc'));
    assert.ok(big.ok && big.query.pageSize === 500 && big.query.page === 1);
    const alias = rules.readListQuery(new URLSearchParams('limit=40&sort=amount'));
    assert.ok(alias.ok && alias.query.pageSize === 40 && alias.query.sort === 'created_at');
  });

  test('refuses unknown statuses and bad dates', () => {
    for (const query of ['status=pending', 'date_from=2026-13-01', 'date_to=yesterday', 'date_from=2026-10-05&date_to=2026-10-01']) {
      const checked = rules.readListQuery(new URLSearchParams(query));
      assert.equal(checked.ok, false, query);
    }
  });
});

describe('legacy response shape', () => {
  const users = new Map<string, UserBrief>([
    [REFERRER, { id: REFERRER, username: 'ada', full_name: 'Ada Obi' }],
  ]);
  const row: StoredReferral = {
    id: REFERRAL,
    referrer_id: REFERRER,
    referee_id: REFEREE,
    referrer_bonus_amount: 500,
    referee_bonus_amount: '300',
    first_trade_completed: true,
    first_trade_at: STAMP,
    referrer_credited: true,
    referee_credited: null,
    created_at: '2026-09-01T09:00:00.000Z',
  };

  test('keeps every key the mobile referral screen reads, with the same meaning', () => {
    const presented = rules.presentReferral(row, users);
    for (const key of [
      'id', 'referrer_username', 'referee_username', 'created_at', 'first_trade_at', 'first_trade_completed',
      'referrer_bonus_amount', 'referee_bonus_amount', 'referrer_credited', 'referee_credited',
    ]) {
      assert.ok(Object.prototype.hasOwnProperty.call(presented, key), key);
    }
    assert.equal(presented.referrer_username, 'ada');
    assert.equal(presented.referee_username, '—');
    assert.equal(presented.referee_bonus_amount, 300);
    assert.equal(presented.referee_credited, false);
    assert.equal(presented.status, 'partly_claimed');
    assert.equal(presented.owed, 300);
    assert.equal(presented.referrer_name, 'Ada Obi');
  });

  test('builds real totals and refuses a malformed summary', () => {
    const stats = rules.buildStats(
      [{ total: 12, completed: 7, credited: 3, total_paid: 1500, referee_paid: 600 }],
      { count: 2, sum: 800.004, partial: false },
    );
    assert.deepEqual(stats, {
      total_referrals: 12,
      pending_payout: 800,
      total_paid_out: 1500,
      awaiting_trade: 5,
      completed: 7,
      unclaimed: 2,
      paid_to_referrers: 1500,
      paid_to_referees: 600,
      pending_payout_partial: false,
    });
    assert.equal(rules.buildStats(null, { count: 0, sum: 0, partial: false }), null);
    assert.equal(rules.buildStats({ total: 'many' }, { count: 0, sum: 0, partial: false }), null);
  });

  test('totals what referred users claimed and refuses a summary without it instead of showing ₦0', () => {
    const owed = { count: 0, sum: 0, partial: false };
    const row = { total: 2, completed: 1, credited: 1, total_paid: 500 };
    assert.equal(rules.buildStats([{ ...row, referee_paid: '300.004' }], owed)?.paid_to_referees, 300);
    assert.equal(rules.buildStats([{ ...row, referee_paid: 0 }], owed)?.paid_to_referees, 0);
    for (const referee of [undefined, null, '', 'lots']) {
      assert.equal(rules.buildStats([{ ...row, referee_paid: referee }], owed), null, String(referee));
    }
    assert.equal(rules.buildStats([row], owed), null);
  });

  test('presents the five programme settings and marks missing rows', () => {
    const presented = rules.presentSettings([
      { key: 'referral_active', value: 'true', updated_at: STAMP },
      { key: 'withdraw_fee', value: '50' },
      { key: 'referral_min_trade_usd', value: null },
    ]);
    assert.deepEqual(Object.keys(presented), [...rules.SETTING_KEYS]);
    assert.deepEqual(presented.referral_active, { value: 'true', updated_at: STAMP, exists: true });
    assert.deepEqual(presented.referral_min_trade_usd, { value: null, updated_at: null, exists: true });
    assert.deepEqual(presented.referral_max_per_day, { value: null, updated_at: null, exists: false });
  });
});

describe('/api/app-config planning', () => {
  test('reads the keys parameter like before, trimmed', () => {
    assert.deepEqual(config.readConfigKeys(null), { ok: true, keys: null });
    assert.deepEqual(config.readConfigKeys(''), { ok: true, keys: null });
    assert.deepEqual(config.readConfigKeys('referral_active, levels_active ,referral_active'), {
      ok: true,
      keys: ['referral_active', 'levels_active'],
    });
    assert.deepEqual(config.readConfigKeys(',,Bad-Key'), { ok: true, keys: [] });
    const many = Array.from({ length: 201 }, (_, index) => `key_${index}`).join(',');
    assert.equal(config.readConfigKeys(many).ok, false);
  });

  test('keeps D-16: settings-only keys are refused first, naming Platform Settings', () => {
    const identity = config.readConfigPatch({ changes: { chatwoot_identity_key: 'x' } }, TEST_ALLOWED);
    assert.deepEqual(identity, { ok: false, message: 'chatwoot_identity_key can only be changed in Platform Settings' });
    const emergency = config.readConfigPatch({ changes: { emergency_mode: 'true', mystery_key: '1' } }, TEST_ALLOWED);
    assert.deepEqual(emergency, { ok: false, message: 'emergency_mode can only be changed in Platform Settings' });
  });

  test('refuses empty, unknown, bad URL and bad referral values', () => {
    for (const body of [undefined, {}, { changes: {} }, { changes: [] }, { changes: null }]) {
      assert.deepEqual(config.readConfigPatch(body, TEST_ALLOWED), { ok: false, message: 'No changes provided' });
    }
    assert.deepEqual(config.readConfigPatch({ changes: { mystery_key: 1 } }, TEST_ALLOWED), {
      ok: false,
      message: 'Unknown app_config keys: mystery_key',
    });
    const url = config.readConfigPatch({ changes: { terms_url: 'http://cardelite.ng/terms' } }, TEST_ALLOWED);
    assert.deepEqual(url, { ok: false, message: 'terms_url must be a valid https:// URL' });
    const minimum = config.readConfigPatch({ changes: { referral_min_trade_usd: '' } }, TEST_ALLOWED);
    assert.equal(minimum.ok, false);
    if (!minimum.ok) assert.match(minimum.message, /^Minimum first trade: /);
    const shaped = config.readConfigPatch({ changes: { withdrawal_narrations: { a: 1 } } }, TEST_ALLOWED);
    assert.equal(shaped.ok, false);
    if (!shaped.ok) assert.match(shaped.message, /must be text, a number or true\/false/);
  });

  test('canonicalises referral values and passes other values through as before', () => {
    const checked = config.readConfigPatch({
      changes: {
        referral_referrer_bonus: '1,500',
        coupon_terms_of_use: ' ["No refunds"] ',
        levels_active: true,
        max_withdrawal_amount: 50000,
      },
      expected: { referral_referrer_bonus: '500', levels_active: null, not_changed: 'x' },
    }, TEST_ALLOWED);
    assert.ok(checked.ok);
    if (!checked.ok) return;
    assert.deepEqual(checked.patch.changes, {
      referral_referrer_bonus: '1500',
      coupon_terms_of_use: ' ["No refunds"] ',
      levels_active: 'true',
      max_withdrawal_amount: '50000',
    });
    assert.deepEqual(checked.patch.expected, { referral_referrer_bonus: '500', levels_active: '' });
    assert.equal(config.readConfigPatch({ changes: { levels_active: 'true' }, expected: 'x' }, TEST_ALLOWED).ok, false);
  });

  test('a referral value equal in meaning is held back as a precondition; every other value goes to the database', () => {
    const planned = config.planConfigWrite(
      {
        changes: { referral_referrer_bonus: '500', referral_referee_bonus: '700', coupon_terms_of_use: 'a' },
        expected: null,
      },
      { referral_referrer_bonus: '500.00', referral_referee_bonus: '500', coupon_terms_of_use: 'a ' },
    );
    assert.deepEqual(planned, {
      changes: { referral_referee_bonus: '700', coupon_terms_of_use: 'a' },
      expected: { referral_referrer_bonus: '500.00' },
      unchanged: ['referral_referrer_bonus'],
    });
    assert.deepEqual(
      config.planConfigWrite({ changes: { coupon_terms_of_use: 'a', withdraw_fee: '50' }, expected: null }, { coupon_terms_of_use: 'a', withdraw_fee: '50' }),
      { changes: { coupon_terms_of_use: 'a', withdraw_fee: '50' }, expected: null, unchanged: [] },
    );
    assert.deepEqual(
      config.planConfigWrite({ changes: { referral_max_per_day: '12' }, expected: null }, {}),
      { changes: { referral_max_per_day: '12' }, expected: null, unchanged: [] },
    );
    assert.deepEqual(
      config.planConfigWrite({ changes: { referral_active: 'true' }, expected: null }, { referral_active: null }),
      { changes: { referral_active: 'true' }, expected: null, unchanged: [] },
    );
  });

  test('the caller\'s expected values go with the keys being written; a held-back value expects what was read', () => {
    const sent = config.planConfigWrite(
      {
        changes: { referral_referrer_bonus: '900', terms_url: 'https://cardelite.ng/t' },
        expected: { referral_referrer_bonus: '500', terms_url: '' },
      },
      { referral_referrer_bonus: '700' },
    );
    assert.deepEqual(sent, {
      changes: { referral_referrer_bonus: '900', terms_url: 'https://cardelite.ng/t' },
      expected: { referral_referrer_bonus: '500', terms_url: '' },
      unchanged: [],
    });
    const alreadyLive = config.planConfigWrite(
      { changes: { referral_referrer_bonus: '700' }, expected: { referral_referrer_bonus: '500' } },
      { referral_referrer_bonus: '700.0' },
    );
    assert.deepEqual(alreadyLive, {
      changes: {},
      expected: { referral_referrer_bonus: '700.0' },
      unchanged: ['referral_referrer_bonus'],
    });
  });

  test('a lost update is named by label', () => {
    assert.equal(
      config.conflictMessage(['referral_referrer_bonus']),
      'Another admin changed Referrer bonus after you loaded it, so nothing was saved. Reload to see the current values.',
    );
    assert.equal(
      config.conflictMessage(['referral_referrer_bonus', 'terms_url']),
      'Another admin changed Referrer bonus and terms_url after you loaded them, so nothing was saved. Reload to see the current values.',
    );
    assert.equal(config.configLabel('referral_max_per_day'), 'Referrals per referrer in 24 hours');
    assert.equal(config.configLabel('withdraw_fee'), 'withdraw_fee');
  });

  test('classifies sensitivity by the most sensitive key', () => {
    assert.equal(config.sensitivityFor(['terms_url']), 'normal');
    assert.equal(config.sensitivityFor(['referral_active']), 'financial');
    assert.equal(config.sensitivityFor(['paystack_webhook_ips', 'withdraw_fee']), 'security');
  });

  test('signup bonus keys accept only what the claim reads, stored in the form it reads', () => {
    const checked = config.readConfigPatch({
      changes: { signup_bonus_active: ' TRUE ', signup_bonus_amount: '₦2,500.50', signup_bonus_condition: ' click_activate ' },
    }, TEST_ALLOWED);
    assert.ok(checked.ok);
    if (!checked.ok) return;
    assert.deepEqual(checked.patch.changes, {
      signup_bonus_active: 'true',
      signup_bonus_amount: '2500.5',
      signup_bonus_condition: 'click_activate',
    });
    const refused: ReadonlyArray<[Record<string, unknown>, string]> = [
      [{ signup_bonus_active: 'on' }, 'Signup bonus: Switch the signup bonus on or off (true or false).'],
      [{ signup_bonus_condition: 'first_withdrawal' }, 'When users can claim the signup bonus: Choose “After their first approved trade” or “Straight away”.'],
      [{ signup_bonus_amount: '' }, 'Signup bonus amount: Enter the bonus amount.'],
      [{ signup_bonus_amount: '1000000.5' }, 'Signup bonus amount: Use 1,000,000 or less.'],
    ];
    for (const [changes, message] of refused) {
      assert.deepEqual(config.readConfigPatch({ changes }, TEST_ALLOWED), { ok: false, message }, JSON.stringify(changes));
    }
  });

  test('a signup bonus left on needs a payable amount, and switching it on needs a condition the claim enforces', () => {
    const zero = 'A signup bonus that is on needs an amount above ₦0. Switch the bonus off instead.';
    const condition = 'When users can claim the signup bonus: Choose “After their first approved trade” or “Straight away”.';
    const on = { signup_bonus_active: 'true', signup_bonus_amount: '2000', signup_bonus_condition: 'first_trade' };
    const off = { ...on, signup_bonus_active: 'false' };
    assert.equal(config.signupBonusProblem({ signup_bonus_amount: '0' }, on), zero);
    assert.equal(config.signupBonusProblem({ signup_bonus_active: 'true' }, { ...off, signup_bonus_amount: '0' }), zero);
    assert.equal(config.signupBonusProblem({ signup_bonus_active: 'true' }, { ...off, signup_bonus_amount: '2,000' }),
      'Signup bonus amount: Enter a number, like 1500 or 1500.50.');
    assert.equal(config.signupBonusProblem({ signup_bonus_active: 'true' }, { ...off, signup_bonus_amount: '5000000' }),
      'Signup bonus amount: Use 1,000,000 or less.');
    assert.equal(config.signupBonusProblem({ signup_bonus_active: 'true' }, { signup_bonus_active: 'false', signup_bonus_amount: '2000' }), condition);
    assert.equal(config.signupBonusProblem({ signup_bonus_active: 'true' }, { ...off, signup_bonus_condition: 'first_withdrawal' }), condition);
    assert.equal(config.signupBonusProblem({ signup_bonus_active: 'true' }, off), null);
    assert.equal(config.signupBonusProblem({ signup_bonus_amount: '0' }, off), null);
    assert.equal(config.signupBonusProblem({ signup_bonus_active: 'false' }, { ...on, signup_bonus_amount: null }), null);
    assert.equal(config.signupBonusProblem({ signup_bonus_amount: '300' }, { ...on, signup_bonus_condition: null }), null);
    assert.equal(config.signupBonusProblem({ signup_bonus_condition: 'click_activate' }, { ...on, signup_bonus_amount: '0' }), null);
    assert.equal(config.signupBonusProblem({ withdraw_fee: '10' }, {}), null);
  });

  test('what the bonuses page sends passes unchanged, and an on bonus at ₦0 gets the page\'s own message', () => {
    const live = bonuses.toSettingsSnapshot({
      config: { signup_bonus_active: 'false', signup_bonus_amount: '0', signup_bonus_condition: 'first_trade' },
    });
    assert.ok(live);
    if (!live) return;
    let draft = bonuses.editSetting(bonuses.EMPTY_SETTINGS_DRAFT, live, 'signup_bonus_active', 'true');
    draft = bonuses.editSetting(draft, live, 'signup_bonus_amount', '₦2,500.50');
    draft = bonuses.editSetting(draft, live, 'signup_bonus_condition', 'click_activate');
    const payload = bonuses.settingsPayload(bonuses.settingsChanges(draft));
    const checked = config.readConfigPatch(payload, TEST_ALLOWED);
    assert.ok(checked.ok);
    if (!checked.ok) return;
    assert.deepEqual(checked.patch.changes, payload.changes);
    assert.equal(config.signupBonusProblem(checked.patch.changes, live.values), null);
    const switched = bonuses.editSetting(bonuses.EMPTY_SETTINGS_DRAFT, live, 'signup_bonus_active', 'true');
    const message = bonuses.settingsErrors(live, switched).signup_bonus_amount;
    assert.equal(message, 'A signup bonus that is on needs an amount above ₦0. Switch the bonus off instead.');
    assert.equal(config.signupBonusProblem({ signup_bonus_active: 'true' }, live.values), message);
  });

  test('a change to the signup switch or amount pins the other at the value read; nothing else is pinned', () => {
    const on = { signup_bonus_active: 'true', signup_bonus_amount: '2000', signup_bonus_condition: 'first_trade' };
    assert.deepEqual(
      config.planConfigWrite({ changes: { signup_bonus_amount: '300' }, expected: { signup_bonus_amount: '2000' } }, on),
      { changes: { signup_bonus_amount: '300' }, expected: { signup_bonus_amount: '2000', signup_bonus_active: 'true' }, unchanged: [] },
    );
    assert.deepEqual(
      config.planConfigWrite({ changes: { signup_bonus_active: 'false' }, expected: null }, { signup_bonus_amount: null }),
      { changes: { signup_bonus_active: 'false' }, expected: { signup_bonus_amount: '' }, unchanged: [] },
    );
    assert.deepEqual(
      config.planConfigWrite({ changes: { signup_bonus_active: 'true' }, expected: null }, {}),
      { changes: { signup_bonus_active: 'true' }, expected: { signup_bonus_amount: '' }, unchanged: [] },
    );
    const both = { signup_bonus_active: 'true', signup_bonus_amount: '300', signup_bonus_condition: 'click_activate' };
    assert.deepEqual(config.planConfigWrite({ changes: both, expected: null }, on), { changes: both, expected: null, unchanged: [] });
    assert.deepEqual(
      config.planConfigWrite({ changes: { signup_bonus_condition: 'click_activate', levels_active: 'false' }, expected: null }, on),
      { changes: { signup_bonus_condition: 'click_activate', levels_active: 'false' }, expected: null, unchanged: [] },
    );
  });

  test('a signup bonus change reads all three signup settings', () => {
    assert.deepEqual(config.configReadKeys(['withdraw_fee', 'levels_active']), ['withdraw_fee', 'levels_active']);
    assert.deepEqual(
      config.configReadKeys(['signup_bonus_amount', 'levels_active']),
      ['signup_bonus_amount', 'levels_active', 'signup_bonus_active', 'signup_bonus_condition'],
    );
    assert.deepEqual(
      config.configReadKeys(['signup_bonus_condition', 'signup_bonus_active', 'signup_bonus_amount']),
      ['signup_bonus_condition', 'signup_bonus_active', 'signup_bonus_amount'],
    );
  });

  test('signup bonus keys are named by the labels the bonuses page uses', () => {
    for (const key of ['signup_bonus_active', 'signup_bonus_amount', 'signup_bonus_condition'] as const) {
      assert.equal(config.configLabel(key), bonuses.SETTING_LABELS[key]);
    }
    assert.equal(config.configLabel('levels_active'), 'levels_active');
    assert.equal(
      config.conflictMessage(['signup_bonus_active', 'signup_bonus_amount']),
      'Another admin changed Signup bonus and Signup bonus amount after you loaded them, so nothing was saved. Reload to see the current values.',
    );
    const refused = config.readConfigPatch({ changes: { signup_bonus_condition: 'first_withdrawal' } }, TEST_ALLOWED);
    assert.equal(refused.ok, false);
    const message = refused.ok ? '' : refused.message;
    for (const option of bonuses.SIGNUP_CONDITIONS) {
      assert.ok(message.includes(`“${option.label}”`), option.label);
      assert.ok(!message.includes(option.value), option.value);
    }
  });
});

describe('page model', () => {
  test('reads the summary and refuses malformed settings', () => {
    const body = {
      settings: settings(),
      stats: {
        total_referrals: 4, awaiting_trade: 1, unclaimed: 2, pending_payout: 800, paid_to_referrers: 1000,
        paid_to_referees: 300, total_paid_out: 1000, pending_payout_partial: false,
      },
    };
    const summary = model.toSummary(body);
    assert.ok(summary);
    assert.deepEqual(summary?.totals, {
      total: 4, awaiting: 1, unclaimed: 2, owed: 800, owedPartial: false, paidToReferrers: 1000, paidToReferees: 300,
    });
    assert.equal(model.toSummary({ settings: { ...settings(), referral_active: { value: 1, exists: true } } }), null);
    assert.equal(model.toSummary({ settings: settings(), stats: null })?.totals, null);
  });

  test('a missing or unreadable referred users total leaves the totals unavailable, never ₦0', () => {
    const stats = {
      total_referrals: 4, awaiting_trade: 1, unclaimed: 2, pending_payout: 800, paid_to_referrers: 1000,
      total_paid_out: 1000, pending_payout_partial: false,
    };
    assert.equal(model.toTotals(stats), null);
    for (const referee of [null, '', 'lots', true]) {
      assert.equal(model.toTotals({ ...stats, paid_to_referees: referee }), null, String(referee));
    }
    assert.equal(model.toTotals({ ...stats, paid_to_referees: '0' })?.paidToReferees, 0);
    const both = model.toTotals({ ...stats, paid_to_referees: 250.5 });
    assert.equal(both?.paidToReferrers, 1000);
    assert.equal(both?.paidToReferees, 250.5);
  });

  test('reads the referral log and recomputes each status', () => {
    const list = model.toReferralList({
      log: [
        {
          id: REFERRAL, referrer_username: 'ada', referee_username: '—', referrer_id: REFERRER, referee_id: REFEREE,
          first_trade_completed: true, referrer_bonus_amount: 500, referee_bonus_amount: 300,
          referrer_credited: false, referee_credited: false, created_at: STAMP, first_trade_at: STAMP, status: 'claimed',
        },
        { nope: true },
      ],
      total: 9,
      search_capped: true,
    });
    assert.ok(list);
    assert.equal(list?.rows.length, 1);
    assert.equal(list?.rows[0].refereeUsername, null);
    assert.equal(list?.rows[0].status, 'unclaimed');
    assert.equal(list?.total, 9);
    assert.equal(list?.searchCapped, true);
    assert.equal(model.toReferralList({ log: 'x' }), null);
    assert.equal(model.userHandle(null, 'Bola'), 'Bola');
    assert.equal(model.userHandle('ada', 'Ada'), '@ada');
  });

  test('stages edits and counts only real changes', () => {
    const live = settings();
    let draft = model.editSetting(model.EMPTY_DRAFT, live, 'referral_referrer_bonus', '500.0');
    assert.ok(draft.referral_referrer_bonus);
    assert.equal(model.draftCount(draft), 0);
    draft = model.editSetting(draft, live, 'referral_referrer_bonus', '500');
    assert.equal(draft.referral_referrer_bonus, undefined);
    draft = model.editSetting(draft, live, 'referral_referrer_bonus', '1,000');
    draft = model.editSetting(draft, live, 'referral_max_per_day', 'ten');
    assert.equal(model.draftCount(draft), 2);
    assert.deepEqual(Object.keys(model.draftErrors(draft)), ['referral_max_per_day']);
    assert.equal(model.firstErrorKey(model.draftErrors(draft)), 'referral_max_per_day');
  });

  test('builds before and after changes and the compare-and-set payload', () => {
    const live = settings({ referral_min_trade_usd: stored(null, false) });
    let draft = model.editSetting(model.EMPTY_DRAFT, live, 'referral_referrer_bonus', '1,000');
    draft = model.editSetting(draft, live, 'referral_min_trade_usd', '20');
    draft = model.editSetting(draft, live, 'referral_active', 'false');
    const changes = model.draftChanges(draft);
    assert.deepEqual(changes.map((change) => change.key), ['referral_active', 'referral_referrer_bonus', 'referral_min_trade_usd']);
    assert.equal(changes[1].fromText, '₦500.00');
    assert.equal(changes[1].toText, '₦1,000.00');
    assert.deepEqual(model.savePayload(changes), {
      changes: { referral_active: 'false', referral_referrer_bonus: '1000', referral_min_trade_usd: '20' },
      expected: { referral_active: 'true', referral_referrer_bonus: '500', referral_min_trade_usd: '' },
    });
  });

  test('an unreadable programme switch can be repaired to either on or off', () => {
    const live = settings({ referral_active: stored('yes!') });
    assert.equal(model.draftValue(live, model.EMPTY_DRAFT, 'referral_active'), '');
    const off = model.editSetting(model.EMPTY_DRAFT, live, 'referral_active', 'false');
    assert.equal(model.draftCount(off), 1);
    assert.deepEqual(model.savePayload(model.draftChanges(off)), {
      changes: { referral_active: 'false' },
      expected: { referral_active: 'yes!' },
    });
    const on = model.editSetting(model.EMPTY_DRAFT, live, 'referral_active', 'true');
    assert.equal(model.draftChanges(on)[0].fromText, 'Unreadable');
  });

  test('rebases a draft on fresh values and reports what moved', () => {
    const live = settings();
    let draft = model.editSetting(model.EMPTY_DRAFT, live, 'referral_referrer_bonus', '900');
    draft = model.editSetting(draft, live, 'referral_referee_bonus', '800');
    const fresh = settings({ referral_referrer_bonus: stored('700'), referral_referee_bonus: stored('800') });
    const rebased = model.rebaseDraft(draft, fresh);
    assert.deepEqual(rebased.conflicts, ['referral_referrer_bonus']);
    assert.deepEqual(rebased.alreadyLive, ['referral_referee_bonus']);
    assert.equal(rebased.draft.referral_referrer_bonus?.conflict, true);
    assert.equal(rebased.draft.referral_referrer_bonus?.base.value, '700');
    assert.equal(rebased.draft.referral_referee_bonus, undefined);
    const notice = model.rebaseNotice(rebased, fresh);
    assert.equal(notice?.items.length, 2);
    assert.match(notice?.items[0].detail ?? '', /changed this to ₦700\.00/);
    assert.equal(model.rebaseNotice({ draft: {}, conflicts: [], alreadyLive: [] }, fresh), null);
  });

  test('classifies every save outcome', () => {
    const saved: ApiResult<SaveReceipt> = { ok: true, data: { warning: 'No audit row.' }, status: 200, requestId: null };
    assert.deepEqual(model.classifySave(saved), { kind: 'saved', warning: 'No audit row.' });
    assert.deepEqual(model.classifySave(failure(401)), { kind: 'expired' });
    assert.equal(model.classifySave(failure(null, { outcomeUnknown: true })).kind, 'unknown');
    assert.equal(model.classifySave(failure(403)).kind, 'refused');
    assert.equal(model.classifySave(failure(409, { code: 'STATE_CONFLICT' })).kind, 'conflict');
    assert.equal(model.classifySave(failure(400, { code: 'VALIDATION_ERROR' })).kind, 'retry');
    assert.equal(model.classifySave(failure(500, { code: 'INTERNAL_ERROR' })).kind, 'retry');
  });

  test('confirms an unknown outcome only when every value is live', () => {
    const live = settings();
    const changes = model.draftChanges(model.editSetting(model.EMPTY_DRAFT, live, 'referral_referrer_bonus', '1000'));
    assert.equal(model.sameAsIntended(settings({ referral_referrer_bonus: stored('1000.00') }), changes), true);
    assert.equal(model.sameAsIntended(live, changes), false);
  });

  test('warns when both bonuses end up at ₦0 with the programme on', () => {
    const live = settings({ referral_referee_bonus: stored('0') });
    const changes = model.draftChanges(model.editSetting(model.EMPTY_DRAFT, live, 'referral_referrer_bonus', '0'));
    assert.match(model.programmeNotes(live, changes)[0] ?? '', /pay nothing/);
    const off = model.draftChanges(model.editSetting(model.EMPTY_DRAFT, settings(), 'referral_active', 'false'));
    assert.deepEqual(model.programmeNotes(settings(), off), []);
  });

  test('builds the list request and detects filters', () => {
    const query = new URLSearchParams(model.listQueryString({
      search: 'ada', status: 'unclaimed', range: { from: '2026-10-01', to: null }, sort: { key: 'created_at', dir: 'desc' }, page: 2,
    }));
    assert.equal(query.get('page'), '2');
    assert.equal(query.get('page_size'), '50');
    assert.equal(query.get('stats'), '0');
    assert.equal(query.get('status'), 'unclaimed');
    assert.equal(query.get('date_from'), '2026-10-01');
    assert.equal(query.get('date_to'), null);
    assert.equal(model.filtersActive({ status: '', range: { from: null, to: null } }, '  '), false);
    assert.equal(model.filtersActive({ status: 'paid', range: { from: null, to: null } }, ''), true);
  });

  test('only guards navigation to another page', () => {
    assert.equal(model.leavePath('/users', 'https://admin.test/referral-management'), '/users');
    assert.equal(model.leavePath('/referral-management', 'https://admin.test/referral-management'), null);
    assert.equal(model.leavePath('https://other.test/x', 'https://admin.test/referral-management'), null);
  });
});

describe('confirmation copy', () => {
  test('is a financial before and after review that explains what each change does', () => {
    const live = settings();
    let draft = model.editSetting(model.EMPTY_DRAFT, live, 'referral_referrer_bonus', '5000');
    draft = model.editSetting(draft, live, 'referral_active', 'false');
    draft = model.editSetting(draft, live, 'referral_min_trade_usd', '100');
    const changes = model.draftChanges(draft);
    const review = options.reviewOptions(changes, []);
    assert.equal(review.tone, 'financial');
    assert.equal(review.title, 'Save 3 changes to the referral programme?');
    assert.deepEqual(review.details?.map((detail) => detail.label), ['Referral programme', 'Referrer bonus', 'Minimum first trade']);
    const lines = review.consequences ?? [];
    assert.ok(lines.some((line) => /users can still claim them/.test(line)));
    assert.ok(lines.some((line) => /Referrals already recorded keep the amount/.test(line) && /tenfold/.test(line)));
    assert.ok(lines.some((line) => /not checked again/.test(line)));
    assert.ok(lines.some((line) => /app shows the new referrer bonus/.test(line)));
    const html = render(createElement('div', null, review.details?.[1].value));
    assert.match(textOf(html), /From ₦500\.00 → to ₦5,000\.00/);
  });

  test('puts conflicts first and explains a missing previous value', () => {
    const live = settings({ referral_max_per_day: stored(null, false) });
    const draft = model.editSetting(model.EMPTY_DRAFT, live, 'referral_max_per_day', '20');
    const rebased = model.rebaseDraft(draft, settings({ referral_max_per_day: stored('15') }));
    const lines = options.reviewConsequences(model.draftChanges(rebased.draft), ['Extra note.']);
    assert.match(lines[0], /^Someone else changed referrals per referrer in 24 hours to 15 referrals/);
    assert.ok(lines.includes('Extra note.'));
    const missing = options.changeConsequence(model.draftChanges(draft)[0]);
    assert.match(missing, /instead of no saved value/);
  });

  test('discard and leave dialogs say nothing changes for users', () => {
    assert.match(String(options.discardOptions(2).message), /nothing changes for users/);
    assert.equal(options.leaveOptions(1).tone, 'danger');
  });
});

describe('referral page parts', () => {
  test('explains how referrals work as plain read-only text', () => {
    const html = render(createElement(parts.HowItWorks, { live: settings() }));
    assert.equal(tagsOf(html, 'input').length, 0);
    assert.equal(tagsOf(html, 'button').length, 0);
    const text = textOf(html);
    assert.match(text, /at most 10 referrals in any 24 hours/);
    assert.match(text, /card value of at least 50 in the card’s own currency/);
    assert.match(text, /not paid out from this console/);
    assert.doesNotMatch(text, /Trigger: First Trade/);
    const off = textOf(render(createElement(parts.HowItWorks, { live: settings({ referral_active: stored('false') }) })));
    assert.match(off, /The programme is off/);
    const broken = textOf(render(createElement(parts.HowItWorks, { live: settings({ referral_active: stored('maybe') }) })));
    assert.match(broken, /switch cannot be read/);
  });

  test('shows read-only values with a note to admins who are not super administrators', () => {
    const html = render(createElement(parts.SettingsCard, {
      live: settings(), draft: model.EMPTY_DRAFT, errors: {}, editable: false, idBase: 'f', headingId: 'h',
      onEdit: () => undefined, onTouch: () => undefined,
    }));
    assert.equal(tagsOf(html, 'input').length, 0);
    const text = textOf(html);
    assert.match(text, /Only super administrators can change the referral programme/);
    assert.match(text, /₦500\.00/);
    assert.match(text, /10 referrals/);
  });

  test('gives super administrators labelled inputs and the programme switch', () => {
    const html = render(createElement(parts.SettingsCard, {
      live: settings(), draft: model.EMPTY_DRAFT, errors: { referral_max_per_day: 'Enter a whole number of referrals, like 10.' },
      editable: true, idBase: 'f', headingId: 'h', onEdit: () => undefined, onTouch: () => undefined,
    }));
    const inputs = tagsOf(html, 'input');
    assert.deepEqual(
      inputs.filter((attrs) => attrs.role !== 'switch').map((attrs) => attrs.id),
      ['f-referral_referrer_bonus', 'f-referral_referee_bonus', 'f-referral_min_trade_usd', 'f-referral_max_per_day'],
    );
    assert.equal(inputs.filter((attrs) => attrs.role === 'switch').length, 1);
    assert.match(textOf(html), /Enter a whole number of referrals/);
  });

  test('raises an alert when a stored value breaks card approvals', () => {
    const html = render(createElement(parts.SettingIssuesNotice, { live: settings({ referral_min_trade_usd: stored('') }), editable: true }));
    assert.match(html, /role="alert"/);
    assert.match(textOf(html), /Every card approval fails until it is fixed/);
    assert.equal(render(createElement(parts.SettingIssuesNotice, { live: settings(), editable: true })), '');
  });

  test('shows each side of a referral and whether it was claimed', () => {
    const row = model.toReferralRow({
      id: REFERRAL, first_trade_completed: true, referrer_bonus_amount: 500, referee_bonus_amount: 300,
      referrer_credited: true, referee_credited: false,
    });
    const text = textOf(render(createElement(parts.BonusCell, { row })));
    assert.match(text, /Referrer ₦500\.00 Claimed/);
    assert.match(text, /Referred user ₦300\.00 Not claimed/);
    const locked = model.toReferralRow({ id: REFERRAL, first_trade_completed: false, referrer_bonus_amount: 500, referee_bonus_amount: 0 });
    assert.match(textOf(render(createElement(parts.BonusCell, { row: locked }))), /Locked.*No bonus/);
  });

  test('the totals strip shows what each side has claimed, the referred users right after the referrers', () => {
    const page = readFileSync(join(OWNED_DIR, 'page.tsx'), 'utf8');
    const start = page.indexOf('const statItems: StatItem[] = [');
    assert.ok(start > 0);
    const strip = page.slice(start, page.indexOf('\n  ];', start));
    assert.deepEqual(
      [...strip.matchAll(/label: '([^']+)'/g)].map((match) => match[1]),
      ['Referrals', 'Awaiting first trade', 'Unclaimed bonuses', 'Paid to referrers', 'Paid to referred users'],
    );
    const referred = strip.slice(strip.indexOf("label: 'Paid to referred users'"));
    assert.match(referred, /value: totals \? formatNaira\(totals\.paidToReferees\) : '—',/);
    assert.match(referred, /hint: 'Claimed by referred users so far',/);
    assert.match(referred, /loading: totalsLoading,/);
    assert.match(referred, /unavailable: totalsMissing,/);
  });
});

describe('route contracts', () => {
  const referrals = readFileSync(REFERRALS_ROUTE, 'utf8');
  const appConfig = readFileSync(APP_CONFIG_ROUTE, 'utf8');

  test('/api/referrals reads with referrals.read through the guard', () => {
    assert.match(referrals, /requireAdmin\('referrals\.read'\)/);
    assert.doesNotMatch(referrals, /referral_management|verifyAdminFromRequest|NextResponse\.json|status: 401/);
  });

  test('admin_referrals_stats returns each side’s claimed total under the names buildStats reads', { skip: !existsSync(ADMIN_SQL) }, () => {
    const sql = readFileSync(ADMIN_SQL, 'utf8').replace(/\r\n/g, '\n');
    const head = 'CREATE OR REPLACE FUNCTION admin_referrals_stats()\n';
    const start = sql.indexOf(head);
    assert.ok(start > 0, 'admin_referrals_stats is not in schema_admin_app.sql');
    assert.equal(sql.indexOf(head, start + 1), -1, 'admin_referrals_stats is defined twice');
    assert.ok(sql.slice(0, start).endsWith('\nDROP FUNCTION IF EXISTS admin_referrals_stats();\n'), 'the changed result needs the drop first');
    const grant = 'GRANT EXECUTE ON FUNCTION admin_referrals_stats() TO service_role;';
    const block = sql.slice(start, sql.indexOf(grant, start) + grant.length);
    const result = block.match(/^RETURNS TABLE\(([^)]*)\)$/m);
    assert.ok(result, 'the result columns were not found');
    const columns = result[1].split(',').map((column) => column.trim().split(' ')[0]);
    assert.deepEqual(columns, ['total', 'completed', 'credited', 'total_paid', 'referee_paid']);
    const sums = block.slice(block.indexOf('    COALESCE('), block.indexOf('  FROM referrals;\n'));
    assert.deepEqual(sums.split('\n').map((line) => line.trim()).filter((line) => line !== ''), [
      'COALESCE(sum(referrer_bonus_amount) FILTER (WHERE referrer_credited), 0),',
      'COALESCE(sum(referee_bonus_amount) FILTER (WHERE referee_credited), 0)',
    ]);
    assert.match(block, /\n\$\$;\nREVOKE ALL ON FUNCTION admin_referrals_stats\(\) FROM public, anon, authenticated;\nGRANT EXECUTE/);
    const row = Object.fromEntries(columns.map((column, index) => [column, index + 1]));
    assert.equal(rules.buildStats([row], { count: 0, sum: 0, partial: false })?.paid_to_referees, 5);
  });

  test('/api/app-config stays super-admin only for GET and PATCH', () => {
    assert.equal(appConfig.match(/await requireSuperAdmin\(\)/g)?.length, 2);
    assert.doesNotMatch(appConfig, /requireAdmin\(|verifyAdminFromRequest|NextResponse\.json|status: 401/);
    assert.match(appConfig, /isSecretConfigKey\(row\.key\)/);
    assert.match(appConfig, /edge_cache_delete/);
    assert.match(appConfig, /writeAudit\(/);
    assert.match(appConfig, /UPDATE_APP_CONFIG/);
  });

  test('/api/app-config writes only through the compare-and-set call, with public rows', () => {
    assert.match(appConfig, /compareAndSet\(\{ changes: plan\.changes, expected: plan\.expected, privateKeys: null, order: requested \}\)/);
    assert.doesNotMatch(appConfig, /\.upsert\(|\.update\(|\.insert\(/);
  });

  test('/api/app-config keeps the ALLOWED_KEYS list exactly', () => {
    const block = appConfig.match(/const ALLOWED_KEYS = new Set<string>\(\[([\s\S]*?)\]\);/);
    assert.ok(block);
    const keys = [...(block?.[1] ?? '').matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual([...keys].sort(), [...PREVIOUS_ALLOWED_KEYS].sort());
    assert.ok(!keys.includes('chatwoot_identity_key') && !keys.includes('emergency_mode'));
  });
});

describe('referrals unit hard rules', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  }

  const files = [...walk(OWNED_DIR), REFERRALS_ROUTE, APP_CONFIG_ROUTE];

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
      assert.doesNotMatch(css, /z-index:\s*-?\d/, file);
    }
  });

  test('components carry no static inline styles and no private mobile copies', () => {
    for (const file of files.filter((path) => path.endsWith('.tsx'))) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /style=\{\{/, file);
      assert.doesNotMatch(source, /function \w+Mobile\b|useIsMobile|Trigger: First Trade/, file);
    }
  });
});
