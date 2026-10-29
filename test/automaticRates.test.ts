import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type Context, type ElementType, type ReactElement } from 'react';
import ts from 'typescript';
import { loadAppModule, loadUi, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { EdgeAnswer } from '../app/lib/edge.ts';
import type { ApiResult } from '../app/lib/apiClient.ts';
import type { AutomaticStatus, CardsSnapshot, ProvidersView } from '../app/(dashboard)/automatic-rates/model.ts';

type Rules = typeof import('../app/(dashboard)/automatic-rates/rules.ts');
type Model = typeof import('../app/(dashboard)/automatic-rates/model.ts');
type Options = typeof import('../app/(dashboard)/automatic-rates/confirmOptions.tsx');
type SectionModule = typeof import('../app/(dashboard)/automatic-rates/AutomaticRatesSection.tsx');
type PartsModule = typeof import('../app/(dashboard)/automatic-rates/AutomaticRatesParts.tsx');

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

interface RpcCall {
  name: string;
  args: unknown;
}

interface DbReply {
  data?: unknown;
  error?: { message: string } | null;
}

interface EdgeCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type EdgeReply = { status: number; body: unknown } | 'network';

interface Harness {
  claims: Claims | null;
  token: string;
  headers: Record<string, string>;
  rpcs: RpcCall[];
  replies: Map<string, DbReply | ((args: Record<string, unknown>) => DbReply)>;
  tables: Record<string, unknown[]>;
  inserts: string[];
  rpc(name: string, args: unknown): Promise<DbReply>;
  from(table: string): unknown;
}

interface Route {
  GET?: () => Promise<Response>;
  PATCH?: (req: Request) => Promise<Response>;
  POST?: (req: Request) => Promise<Response>;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const OWNED_DIR = join(APP_DIR, '(dashboard)', 'automatic-rates');
const ROUTES_DIR = join(APP_DIR, 'api', 'automatic-rates');
const PAGE_FILE = join(APP_DIR, '(dashboard)', 'admin-settings', 'automatic-rates', 'page.tsx');
const LIB_FILES = ['rateTree.ts', 'rateSync.ts', 'rateService.ts'].map((name) => join(APP_DIR, 'lib', name));
const ADMIN_SQL = fileURLToPath(new URL('../../schema_admin_app.sql', import.meta.url));
const EDGE_FILE = fileURLToPath(new URL('../../supabase/functions/sync-provider-rates/index.ts', import.meta.url));
const SIBLINGS_PRESENT = existsSync(ADMIN_SQL) && existsSync(EDGE_FILE);
const TEST_FILE = fileURLToPath(import.meta.url);
const HARNESS_KEY = '__automaticRatesRouteHarness';
const NO_COMMENTS = /\/\*|(^|[^:])\/\/(?!\/)/m;

const ADMIN_ID = '0e000000-0000-4000-8000-0000000000a1';
const REQUEST_ID = 'req_autorates01';
const USER_AGENT = 'automatic-rates-test';
const CLIENT_IP = '198.51.100.61';
const TOKEN = 'admin.session.token';
const EDGE_BASE = 'https://edge.test';
const SECRET = 'fn-secret';
const RUN_ID = '0f000000-0000-4000-8000-0000000000b1';
const AMAZON = '0a000000-0000-4000-8000-000000000001';
const APPLE = '0a000000-0000-4000-8000-000000000002';
const US = '0b000000-0000-4000-8000-000000000001';
const GB = '0b000000-0000-4000-8000-000000000002';
const PHYSICAL = '0c000000-0000-4000-8000-000000000001';
const ECODE = '0c000000-0000-4000-8000-000000000002';
const APPLE_GB = '0c000000-0000-4000-8000-000000000003';
const D1 = '0d000000-0000-4000-8000-000000000001';
const D2 = '0d000000-0000-4000-8000-000000000002';
const D3 = '0d000000-0000-4000-8000-000000000003';
const NOW = Date.parse('2026-10-26T12:00:00.000Z');

const WEB: Session = {
  id: '7c000000-0000-4000-8000-0000000000c1',
  client: 'web',
  amr: ['pwd', 'otp'],
  createdAt: '2026-10-26T08:00:00.000Z',
  expiresAt: '2026-10-26T20:00:00.000Z',
  reauthAt: null,
  transport: 'cookie',
};

const PHONE: Session = { ...WEB, client: 'mobile', transport: 'bearer' };

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
  return { ...OWNER, username: 'rates', role_title: 'Rates desk', is_super_admin: false, page_permissions: grants, session };
}

const SUMMARY = {
  lines: 3, linked: 2, priced: 2, unpriced: [], created: 1, updated: 2, relabelled: 0, reactivated: 0, deactivated: 1, unchanged: 4,
};

function statusBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: false,
    provider: null,
    interval_minutes: 60,
    universal_markup_pct: 4,
    enabled_changed_at: null,
    updated_at: '2026-10-25T10:00:00.000Z',
    updated_by: null,
    linked_card_type_ids: [],
    running: null,
    last_success: null,
    last_update: null,
    last_products: null,
    failures: 0,
    next_due_at: null,
    stale: false,
    ...patch,
  };
}

function onBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return statusBody({
    enabled: true,
    provider: 'acme',
    enabled_changed_at: '2026-10-26T09:00:00.000Z',
    next_due_at: '2026-10-26T12:30:00.000Z',
    linked_card_type_ids: [PHYSICAL, ECODE],
    ...patch,
  });
}

function success(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RUN_ID,
    started_at: '2026-10-26T11:30:00.000Z',
    finished_at: '2026-10-26T11:30:04.000Z',
    requested_via: 'schedule',
    summary: SUMMARY,
    ...patch,
  };
}

function update(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...success(), status: 'succeeded', error: null, ...patch };
}

function treeCards(): unknown[] {
  return [
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
          card_types: [
            {
              id: PHYSICAL,
              name: 'Physical',
              denominations: [
                { id: D1, range_label: '$25–$99', min_value: 25, max_value: 99, rate_naira: 1248, is_active: true },
                { id: D2, range_label: '$100–$500', min_value: 100, max_value: 500, rate_naira: 1300, is_active: true },
              ],
            },
            { id: ECODE, name: 'E-code', denominations: [{ id: D3, range_label: '$10–$50', min_value: 10, max_value: 50, rate_naira: 1100, is_active: false }] },
          ],
        },
      ],
    },
    {
      id: APPLE,
      name: 'Apple',
      logo_url: null,
      is_active: true,
      activeRates: 0,
      countries: [
        { id: GB, country_code: 'GB', country_name: 'United Kingdom', currency_symbol: '£', card_types: [{ id: APPLE_GB, name: 'E-code', denominations: [] }] },
      ],
    },
  ];
}

function product(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: 'amz-us-phys',
    name: 'Amazon US Physical',
    country: 'US',
    currency: 'USD',
    form: 'physical',
    bands: [{ min: 25, max: 99, rate: 1200 }, { min: 100, max: 500, rate: 1250 }],
    problem: null,
    last_seen_at: '2026-10-26T11:30:00.000Z',
    in_latest: true,
    ...patch,
  };
}

function overview(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'acme',
    enabled: true,
    universal_markup_pct: 4,
    markups: [
      { card_id: AMAZON, card_markup_pct: null, effective_markup_pct: 4 },
      { card_id: APPLE, card_markup_pct: -10, effective_markup_pct: -10 },
    ],
    links: [
      { card_type_id: PHYSICAL, provider_ref: 'amz-us-phys', updated_at: '2026-10-26T09:00:00.000Z' },
      { card_type_id: ECODE, provider_ref: 'amz-us-code', updated_at: '2026-10-26T09:00:00.000Z' },
    ],
    products: [
      product(),
      product({ ref: 'amz-us-code', name: 'Amazon US E-code', form: 'ecode', bands: null, problem: 'no_bands', in_latest: false }),
    ],
    unpriced: [{ card_type_id: ECODE, reason: 'no_bands', listed: true }],
    ...patch,
  };
}

let rules: Rules;
let model: Model;
let options: Options;

before(async () => {
  rules = await loadAppModule<Rules>('(dashboard)/automatic-rates/rules.ts');
  model = await loadAppModule<Model>('(dashboard)/automatic-rates/model.ts');
  options = await loadAppModule<Options>('(dashboard)/automatic-rates/confirmOptions.tsx');
});

function parsedStatus(body: Record<string, unknown>): AutomaticStatus {
  const status = model.toAutomaticStatus(body);
  assert.ok(status, JSON.stringify(body));
  return status;
}

function cardsSnapshot(over: Record<string, unknown> = overview()): CardsSnapshot {
  const snapshot = model.toCardsSnapshot({ cards: treeCards(), automatic: over });
  assert.ok(snapshot);
  return snapshot;
}

function sqlBody(name: string): string {
  const sql = readFileSync(ADMIN_SQL, 'utf8');
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('AS $$', start) + 5));
}

function answered(status: number, body: unknown): EdgeAnswer {
  return { kind: 'answered', status, body };
}

describe('rules', () => {
  test('the interval options equal both SQL lists', { skip: !SIBLINGS_PRESENT }, () => {
    const sql = readFileSync(ADMIN_SQL, 'utf8');
    const table = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS rate_sync_settings ('));
    const check = /interval_minutes int NOT NULL DEFAULT 60 CHECK \(interval_minutes IN \(([\d, ]+)\)\)/.exec(table);
    const setter = /v_number IN \(([\d, ]+)\)/.exec(sqlBody('rate_sync_setting_value'));
    assert.ok(check && setter);
    for (const list of [check[1], setter[1]]) {
      assert.deepEqual(list.split(',').map((item) => Number(item.trim())), [...rules.INTERVAL_OPTIONS]);
    }
    assert.deepEqual(rules.INTERVAL_OPTIONS.map((minutes) => rules.intervalLabel(minutes)), [
      '15 minutes', '30 minutes', '1 hour', '2 hours', '3 hours', '6 hours', '12 hours', '24 hours',
    ]);
    assert.equal(rules.everyInterval(60), 'every hour');
    assert.equal(rules.everyInterval(15), 'every 15 minutes');
    assert.equal(rules.everyInterval(1440), 'every 24 hours');
  });

  test('the percentage bounds and the rate bound equal the SQL checks', { skip: !SIBLINGS_PRESENT }, () => {
    const sql = readFileSync(ADMIN_SQL, 'utf8');
    assert.match(sql, /universal_markup_pct numeric\(5,2\) NOT NULL DEFAULT 0 CHECK \(universal_markup_pct BETWEEN -90 AND 100\)/);
    assert.match(sql, /markup_pct numeric\(5,2\) NOT NULL CHECK \(markup_pct BETWEEN -90 AND 100\)/);
    assert.match(sqlBody('rate_sync_rate_valid'), /SELECT p_rate > 0 AND p_rate <= 100000 AND p_rate = round\(p_rate, 2\);/);
    assert.match(sqlBody('rate_sync_applied_rate'), /SELECT round\(p_provider_rate \* \(1 \+ p_markup_pct \/ 100\), 2\);/);
    assert.equal(rules.PERCENT_MIN, -90);
    assert.equal(rules.PERCENT_MAX, 100);
    assert.equal(rules.RATE_MAX_KOBO, 10_000_000);
  });

  test('parsePercent accepts signed percentages with at most 2 decimals from −90 to 100, and nothing else', () => {
    const accepted: Array<[unknown, number]> = [
      ['4', 4], ['+4', 4], ['-4', -4], ['−4', -4], ['4.5', 4.5], ['3.33', 3.33], ['0', 0], ['-0', 0], ['-90', -90],
      ['100', 100], ['4%', 4], [' 2.5 % ', 2.5], ['.5', 0.5], ['100.00', 100], [4.5, 4.5], [-90, -90],
    ];
    for (const [raw, value] of accepted) {
      const checked = rules.parsePercent(raw);
      assert.ok(checked.ok, String(raw));
      assert.equal(checked.value, value, String(raw));
      assert.ok(!Object.is(checked.value, -0), String(raw));
    }
    for (const raw of ['10.555', '100.01', '-90.01', '', '  ', 'abc', '--5', '+-5', '1e2', '4%%', '1,000', null, undefined, Number.NaN, {}]) {
      const checked = rules.parsePercent(raw);
      assert.equal(checked.ok, false, String(raw));
      if (!checked.ok) assert.equal(checked.message, rules.PERCENT_MESSAGE);
    }
    assert.equal(rules.PERCENT_MESSAGE, 'Enter a percentage from −90% to 100% with at most 2 decimal places.');
  });

  test('percentages print plainly for forms and with a sign for people', () => {
    const cases: Array<[number, string, string]> = [
      [4, '4', '+4%'], [-10, '-10', '−10%'], [0, '0', '0%'], [3.33, '3.33', '+3.33%'], [4.5, '4.5', '+4.5%'],
      [0.05, '0.05', '+0.05%'], [-0.5, '-0.5', '−0.5%'], [100, '100', '+100%'], [-90, '-90', '−90%'],
    ];
    for (const [value, plain, shown] of cases) {
      assert.equal(rules.pctText(value), plain, String(value));
      assert.equal(rules.formatPct(value), shown, String(value));
    }
  });

  test('the applied rate rounds half up to kobo exactly like round(rate * (1 + pct / 100), 2)', () => {
    const cases: Array<[number, number, number]> = [
      [120000, 400, 124800], [123456, 333, 127567], [1250, 100, 1263], [1250, -300, 1213], [1, -5000, 1], [5, -1000, 5],
      [4, -9000, 0], [5_000_000, 10000, 10_000_000], [6_000_000, 6667, 10_000_200], [6_000_000, 6666, 9_999_600],
    ];
    for (const [rate, hundredths, paid] of cases) assert.equal(rules.appliedKobo(rate, hundredths), paid, `${rate} at ${hundredths}`);
    const exact = (rate: bigint, hundredths: bigint) => (rate * (BigInt(10000) + hundredths) * BigInt(2) + BigInt(10000)) / BigInt(20000);
    for (const rate of [1, 7, 99, 1234, 99_999, 120_000, 1_234_567, 10_000_000]) {
      for (const hundredths of [-9000, -3333, -1, 0, 1, 250, 333, 4999, 6667, 10000]) {
        assert.equal(BigInt(rules.appliedKobo(rate, hundredths)), exact(BigInt(rate), BigInt(hundredths)), `${rate} at ${hundredths}`);
      }
    }
    assert.equal(rules.isValidKobo(0), false);
    assert.equal(rules.isValidKobo(1), true);
    assert.equal(rules.isValidKobo(10_000_000), true);
    assert.equal(rules.isValidKobo(10_000_001), false);
  });

  test('summaryText joins the non-zero parts with commas and a final and, in singular or plural', () => {
    const empty = { created: 0, updated: 0, relabelled: 0, reactivated: 0, deactivated: 0 };
    assert.equal(rules.summaryText(empty), null);
    assert.equal(rules.summaryText({ ...empty, updated: 1 }), '1 rate changed');
    assert.equal(rules.summaryText({ ...empty, created: 1 }), '1 range added');
    assert.equal(rules.summaryText({ ...empty, updated: 2, created: 1 }), '2 rates changed and 1 range added');
    assert.equal(
      rules.summaryText({ created: 3, updated: 1200, relabelled: 0, reactivated: 1, deactivated: 2 }),
      '1,200 rates changed, 3 ranges added, 1 range switched back on and 2 ranges switched off',
    );
    assert.equal(rules.summaryText({ ...empty, relabelled: 1 }), '1 range label updated');
    assert.equal(rules.summaryText({ ...empty, relabelled: 2 }), '2 range labels updated');
    assert.equal(rules.summaryText({ ...empty, updated: 1, relabelled: 3 }), '1 rate changed and 3 range labels updated');
    assert.equal(rules.ratesMoved({ ...empty, relabelled: 2 }), false);
    for (const key of ['updated', 'created', 'reactivated', 'deactivated'] as const) assert.equal(rules.ratesMoved({ ...empty, [key]: 1 }), true, key);
    assert.equal(rules.relabelledText(1), '1 range label was updated.');
    assert.equal(rules.relabelledText(1200), '1,200 range labels were updated.');
    const off = (reasons: string[]) => reasons.map((reason, index) => ({
      cardTypeId: `0c000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, reason, listed: true,
    }));
    const PERCENT = 'The extra percentage would make a rate ₦0.00 or less, or more than ₦100,000.00, for';
    const CURRENCY = 'No currency symbol is set in Cards for the country of';
    assert.equal(rules.typesOffText(off(['missing']), 'card type'), '1 card type got no usable rates and was switched off.');
    assert.equal(rules.typesOffText(off(['missing', 'no_bands', 'bands_overlap']), 'card type'), '3 card types got no usable rates and were switched off.');
    assert.equal(rules.typesOffText(off(Array(1200).fill('missing')), 'card type'), '1,200 card types got no usable rates and were switched off.');
    assert.equal(rules.typesOffText(off(['markup_out_of_range']), 'card type'), `${PERCENT} 1 card type, so their ranges were switched off.`);
    assert.equal(rules.typesOffText(off(['markup_out_of_range', 'markup_out_of_range']), 'card type'), `${PERCENT} 2 card types, so their ranges were switched off.`);
    assert.equal(rules.typesOffText(off(['no_currency_symbol']), 'card type'), `${CURRENCY} 1 card type, so their ranges were switched off.`);
    assert.equal(rules.typesOffText(off(['no_currency_symbol', 'no_currency_symbol']), 'card type'), `${CURRENCY} 2 card types, so their ranges were switched off.`);
    assert.equal(
      rules.typesOffText(off(['no_currency_symbol', 'markup_out_of_range', 'rate_not_valid']), 'card type'),
      `1 card type got no usable rates and was switched off. ${PERCENT} 1 card type, so their ranges were switched off. ${CURRENCY} 1 card type, so their ranges were switched off.`,
    );
    assert.equal(
      rules.typesOffText(off(['markup_out_of_range', 'missing', 'missing']), 'linked card type'),
      `2 linked card types got no usable rates and were switched off. ${PERCENT} 1 linked card type, so their ranges were switched off.`,
    );
    assert.equal(rules.typesOffText([], 'card type'), '');
  });

  test('the run toast says rates changed only when a rate or a range moved', () => {
    const base = { ...SUMMARY, created: 0, updated: 0, relabelled: 0, reactivated: 0, deactivated: 0 };
    assert.equal(model.runToastText(base, 'Acme Rates'), 'Acme Rates’s rates matched the live rates, so nothing changed.');
    assert.equal(
      model.runToastText({ ...base, relabelled: 2 }, 'Acme Rates'),
      'Acme Rates’s rates matched the live rates, so no rate changed. 2 range labels were updated.',
    );
    assert.equal(model.runToastText({ ...base, relabelled: 1 }, 'the rate provider'), 'The rate provider’s rates matched the live rates, so no rate changed. 1 range label was updated.');
    assert.equal(
      model.runToastText({ ...base, updated: 1, relabelled: 2 }, 'Acme Rates'),
      'Rates updated from Acme Rates: 1 rate changed and 2 range labels updated.',
    );
    assert.equal(model.runToastText(SUMMARY, 'Acme Rates'), 'Rates updated from Acme Rates: 2 rates changed, 1 range added and 1 range switched off.');
    const off = { ...base, unpriced: [{ cardTypeId: ECODE, reason: 'missing', listed: true }, { cardTypeId: APPLE_GB, reason: 'missing', listed: false }] };
    assert.equal(
      model.runToastText(off, 'Acme Rates'),
      'Acme Rates’s rates matched the live rates, so nothing changed. 1 card type got no usable rates and was switched off.',
    );
    const percent = {
      ...base,
      deactivated: 1,
      unpriced: [{ cardTypeId: PHYSICAL, reason: 'markup_out_of_range', listed: true }, { cardTypeId: ECODE, reason: 'no_currency_symbol', listed: true }],
    };
    assert.equal(
      model.runToastText(percent, 'Acme Rates'),
      'Rates updated from Acme Rates: 1 range switched off. '
        + 'The extra percentage would make a rate ₦0.00 or less, or more than ₦100,000.00, for 1 card type, so their ranges were switched off. '
        + 'No currency symbol is set in Cards for the country of 1 card type, so their ranges were switched off.',
    );
    assert.doesNotMatch(model.runToastText(percent, 'Acme Rates'), /no usable rates/);
  });
});

describe('reading the edge answers', () => {
  const PROVIDERS = [{ id: 'acme', label: 'Acme Rates', missing_secrets: ['ACME_API_KEY'] }];

  test('the status answer lists the registry, and every other answer is a named failure', () => {
    assert.deepEqual(rules.readProviders(answered(200, { success: true, code: 'status', providers: [] })), { ok: true, providers: [] });
    assert.deepEqual(rules.readProviders(answered(200, { success: true, code: 'status', providers: PROVIDERS })), {
      ok: true,
      providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: ['ACME_API_KEY'] }],
    });
    const cases: Array<[EdgeAnswer, string]> = [
      [{ kind: 'failed', error: new Error('timeout') }, 'unreachable'],
      [answered(200, { success: true, code: 'status' }), 'unreadable'],
      [answered(200, { success: true, code: 'status', providers: [{ id: 'Acme', label: 'x', missing_secrets: [] }] }), 'unreadable'],
      [answered(200, { success: true, code: 'status', providers: [{ id: 'acme', label: '', missing_secrets: [] }] }), 'unreadable'],
      [answered(200, { success: true, code: 'status', providers: [PROVIDERS[0], PROVIDERS[0]] }), 'unreadable'],
      [answered(200, null), 'unreadable'],
      [answered(401, { code: 'no_token' }), 'session'],
      [answered(401, { code: 'session_ended' }), 'session'],
      [answered(401, { code: 'wrong_client' }), 'web_only'],
      [answered(403, { code: 'forbidden' }), 'forbidden'],
      [answered(401, { code: 'not_authorized' }), 'not_set_up'],
      [answered(500, { code: 'lookup_failed' }), 'not_checked'],
      [answered(404, { code: 'NOT_FOUND' }), 'not_set_up'],
      [answered(546, { code: 'WORKER_LIMIT' }), 'unreachable'],
    ];
    for (const [answer, failure] of cases) {
      assert.deepEqual(rules.readProviders(answer), { ok: false, failure }, JSON.stringify(answer));
    }
  });

  test('each service failure has its own text in each context, never the payment provider default', () => {
    const turnOn = rules.serviceRefusal('unreachable', 'turn_on');
    assert.deepEqual(turnOn, {
      ok: false,
      code: 'PROVIDER_ERROR',
      message: 'The rate service could not be reached, so automatic rates were not turned on. Try again in a few minutes.',
      details: null,
    });
    assert.equal(rules.serviceRefusal('unreachable', 'check').message, 'The rate service could not be reached. Try again in a few minutes.');
    assert.equal(
      rules.serviceRefusal('unreachable', 'provider').message,
      'The rate service could not be reached, so the provider was not changed. Try again in a few minutes.',
    );
    assert.equal(rules.serviceRefusal('web_only', 'turn_on').message, 'Automatic rates can only be turned on from the web console.');
    assert.equal(rules.serviceRefusal('web_only', 'provider').message, 'The rate provider can only be changed from the web console.');
    assert.deepEqual(rules.serviceRefusal('forbidden', 'check').details, { required: ['rates.read'] });
    assert.equal(rules.serviceRefusal('session', 'check').code, 'AUTH_REQUIRED');
    assert.equal(rules.serviceRefusal('not_checked', 'turn_on').code, 'INTERNAL_ERROR');
    for (const failure of ['unreachable', 'unreadable', 'not_set_up'] as const) {
      assert.notEqual(rules.serviceRefusal(failure, 'check').message, 'The payment provider could not be reached.');
    }
  });

  test('turning on needs the chosen provider in the registry, with every key set', () => {
    const listed = [{ id: 'acme', label: 'Acme Rates', missingSecrets: ['ACME_API_KEY', 'ACME_SECRET'] }];
    assert.equal(
      rules.providerRefusal([], 'acme', 'turn_on')?.message,
      'The rate provider “acme” is not set up on the server, so automatic rates were not turned on.',
    );
    assert.equal(
      rules.providerRefusal(listed, 'acme', 'turn_on')?.message,
      'The rate provider’s keys are not set on the server (ACME_API_KEY, ACME_SECRET), so automatic rates were not turned on.',
    );
    assert.equal(rules.providerRefusal(listed, 'acme', 'provider'), null);
    assert.equal(rules.providerRefusal([{ ...listed[0], missingSecrets: [] }], 'acme', 'turn_on'), null);
    assert.equal(
      rules.providerRefusal([], 'zeta', 'provider')?.message,
      'The rate provider “zeta” is not set up on the server, so nothing was saved.',
    );
  });

  test('every run answer maps to a status, a code, a message and details', () => {
    const run = { run_id: RUN_ID };
    const cases: Array<[EdgeAnswer, string, string, Record<string, unknown> | null]> = [
      [answered(409, { code: 'off', ...run }), 'STATE_CONFLICT', 'Automatic rates are off, so nothing was updated.', { reason: 'off' }],
      [answered(409, { code: 'no_provider' }), 'STATE_CONFLICT', 'No rate provider is chosen, so nothing was updated.', { reason: 'no_provider' }],
      [answered(409, { code: 'busy' }), 'STATE_CONFLICT', 'An update is already running. The status shows when it finishes.', { reason: 'busy' }],
      [answered(409, { code: 'no_links' }), 'STATE_CONFLICT', 'No card types are linked, so nothing was updated.', { reason: 'no_links' }],
      [answered(503, { code: 'adapter_missing', ...run }), 'PROVIDER_ERROR', 'The rate provider is not set up on the server, so nothing was updated.', { reason: 'adapter_missing', run_id: RUN_ID }],
      [answered(503, { code: 'secrets_missing', missing: ['ACME_API_KEY'], ...run }), 'PROVIDER_ERROR',
        'The rate provider’s keys are not set on the server (ACME_API_KEY), so nothing was updated.', { reason: 'secrets_missing', missing: ['ACME_API_KEY'], run_id: RUN_ID }],
      [answered(503, { code: 'secrets_missing', missing: [], ...run }), 'PROVIDER_ERROR',
        'The rate provider’s keys are not set on the server, so nothing was updated.', { reason: 'secrets_missing', run_id: RUN_ID }],
      [answered(502, { code: 'provider_failed', error: 'rates 503', ...run }), 'PROVIDER_ERROR',
        'The rate provider could not be read (rates 503), so rates stay as they were. Try again in a few minutes.', { reason: 'provider_failed', error: 'rates 503', run_id: RUN_ID }],
      [answered(502, { code: 'provider_failed', error: 'adapter_error', ...run }), 'PROVIDER_ERROR',
        'An error on our side stopped the update, so rates stay as they were. Try again in a few minutes.', { reason: 'provider_failed', error: 'adapter_error', run_id: RUN_ID }],
      [answered(422, { code: 'refused', reason: 'answer_empty', ...run }), 'STATE_CONFLICT',
        'The rate provider’s answer could not be used because it returned no rates, so rates stay as they were.', { reason: 'refused', error: 'answer_empty', run_id: RUN_ID }],
      [answered(422, { code: 'refused', reason: 'turned_off', ...run }), 'STATE_CONFLICT',
        'The rate provider’s answer could not be used because automatic rates were turned off while it ran, so rates stay as they were.', { reason: 'refused', error: 'turned_off', run_id: RUN_ID }],
      [answered(401, { code: 'wrong_client' }), 'PERMISSION_DENIED', 'Rates can only be updated from the web console.', null],
      [answered(403, { code: 'forbidden' }), 'PERMISSION_DENIED', 'You do not have permission to do this.', { required: ['rates.write'] }],
      [answered(429, { code: 'rate_limited' }), 'RATE_LIMITED', 'You can start at most 20 updates or product loads an hour. Try again later.', null],
      [answered(401, { code: 'not_authorized' }), 'PROVIDER_ERROR', 'Updating rates is not set up on the server, so nothing was changed.', null],
      [answered(401, { code: 'token_revoked' }), 'AUTH_REQUIRED', 'Your session has expired. Sign in again.', null],
      [answered(500, { code: 'db_error' }), 'INTERNAL_ERROR', 'The server could not check this request, so nothing was changed. Try again.', null],
      [answered(500, { code: 'lookup_failed' }), 'INTERNAL_ERROR', 'The server could not check this request, so nothing was changed. Try again.', null],
      [answered(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }), 'PROVIDER_ERROR', 'The update service refused this request, so nothing was changed.', null],
    ];
    for (const [answer, code, message, details] of cases) {
      const reply = rules.readRunAnswer(answer);
      assert.equal(reply.ok, false, JSON.stringify(answer));
      if (reply.ok) continue;
      assert.equal(reply.code, code, JSON.stringify(answer));
      assert.equal(reply.message, message, JSON.stringify(answer));
      assert.deepEqual(reply.details, details, JSON.stringify(answer));
    }
  });

  test('no answer, a server error, an unreadable answer or a success without a code is an unknown outcome', () => {
    const unknown = {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No answer came back, so the update may or may not have run. The status below shows the last finished update.',
      details: { outcome_unknown: true },
    };
    for (const answer of [
      { kind: 'failed', error: new TypeError('fetch failed') } as EdgeAnswer,
      answered(500, { code: 'server_error', run_id: RUN_ID }),
      answered(546, { code: 'WORKER_LIMIT' }),
      answered(500, null),
      answered(200, { success: true, run_id: RUN_ID, summary: SUMMARY }),
      answered(200, { success: true, code: 'applied', summary: SUMMARY }),
      answered(200, { success: true, code: 'applied', run_id: RUN_ID, summary: { ...SUMMARY, created: -1 } }),
      answered(200, { success: true, code: 'not_due' }),
      answered(200, { success: true, code: 'products_loaded', run_id: RUN_ID, summary: { lines: 2, usable: 3 } }),
      answered(502, { code: 'provider_failed', run_id: RUN_ID }),
    ]) {
      assert.deepEqual(rules.readRunAnswer(answer), unknown, JSON.stringify(answer));
    }
  });

  test('a finished update or product load comes back with its summary', () => {
    assert.deepEqual(rules.readRunAnswer(answered(200, { success: true, code: 'applied', run_id: RUN_ID, summary: SUMMARY })), {
      ok: true, mode: 'apply', runId: RUN_ID, summary: SUMMARY,
    });
    assert.deepEqual(
      rules.readRunAnswer(answered(200, { success: true, code: 'products_loaded', run_id: RUN_ID, summary: { lines: 12, usable: 10 } })),
      { ok: true, mode: 'products', runId: RUN_ID, summary: { lines: 12, usable: 10 } },
    );
    const withOff = { ...SUMMARY, unpriced: [{ card_type_id: ECODE.toUpperCase(), reason: 'missing', listed: true }] };
    const reply = rules.readRunAnswer(answered(200, { success: true, code: 'applied', run_id: RUN_ID, summary: withOff }));
    assert.ok(reply.ok && reply.mode === 'apply');
    assert.deepEqual(reply.summary.unpriced, [{ cardTypeId: ECODE, reason: 'missing', listed: true }]);
    assert.deepEqual(rules.applySummaryJson(reply.summary).unpriced, [{ card_type_id: ECODE, reason: 'missing', listed: true }]);
  });
});

describe('error and reason texts cover every code the database and the edge function write', { skip: !SIBLINGS_PRESENT }, () => {
  test('every run error code has its own text', () => {
    const readLines = sqlBody('rate_sync_read_lines');
    const problems = [...readLines.matchAll(/'problem', '(answer_[a-z_]+)'/g)].map((match) => match[1]);
    const sql = readFileSync(ADMIN_SQL, 'utf8');
    const closed = [...sql.matchAll(/rate_sync_close_failed\([a-z_.]+, '([a-z_]+)'\)/g)].map((match) => match[1]);
    const edge = readFileSync(EDGE_FILE, 'utf8');
    const failed = [...edge.matchAll(/failRun\(admin, runId, '([a-z_]+)'\)/g)].map((match) => match[1]);
    const assigned = [...edge.matchAll(/known \? e\.message : '([a-z_]+)'/g)].map((match) => match[1]);
    assert.ok(edge.includes('failRun(admin, runId, `secrets_missing ${missing.join(\',\')}`)'));
    const codes = new Set([...problems, ...closed, ...failed, ...assigned, 'not_running', 'secrets_missing ACME_API_KEY,ACME_SECRET']);
    assert.ok(problems.length >= 5 && closed.length >= 4 && failed.length >= 2 && assigned.length >= 1, JSON.stringify([...codes]));
    for (const code of codes) {
      const text = rules.runErrorText(code);
      assert.doesNotMatch(text, /could not be read \(/, code);
    }
    assert.equal(rules.runErrorText('secrets_missing ACME_API_KEY,ACME_SECRET'), 'the provider’s keys are not set on the server (ACME_API_KEY, ACME_SECRET)');
    assert.equal(rules.runErrorText('rates 503'), 'the provider could not be read (rates 503)');
    assert.equal(rules.runErrorText('rates no response'), 'the provider could not be read (rates no response)');
  });

  test('every reason a card type is switched off has its own text', () => {
    const readLines = sqlBody('rate_sync_read_lines');
    const judged = [...readLines.matchAll(/THEN '([a-z_]+)'/g)].map((match) => match[1]);
    const apply = sqlBody('apply_provider_rates');
    const assigned = [...apply.matchAll(/v_reason := '([a-z_]+)'/g)].map((match) => match[1]);
    assert.deepEqual(judged, ['no_bands', 'too_many_bands', 'band_not_valid', 'rate_not_valid', 'bands_overlap']);
    assert.deepEqual(assigned, ['missing', 'no_currency_symbol', 'markup_out_of_range']);
    for (const reason of [...judged, ...assigned]) {
      assert.doesNotMatch(rules.unpricedReasonText(reason), /unknown reason/, reason);
    }
    assert.equal(
      rules.unpricedReasonText('markup_out_of_range'),
      'the extra percentage makes a rate ₦0.00 or less, or more than ₦100,000.00',
    );
    assert.equal(
      rules.unpricedReasonText('bands_overlap'),
      'the provider’s ranges overlap (both ends of a range are included, so ranges that share an end value overlap)',
    );
    assert.deepEqual([...judged, ...assigned].map((reason) => rules.offCause(reason)), [
      'provider', 'provider', 'provider', 'provider', 'provider', 'provider', 'currency', 'percentage',
    ]);
  });

  test('the switched-off alert words each cause as the console callout does', () => {
    const apply = sqlBody('apply_provider_rates');
    assert.match(apply, /WHEN 'markup_out_of_range' THEN 2 WHEN 'no_currency_symbol' THEN 3 ELSE 1 END AS grp/);
    for (const text of [
      'The rate provider gave no usable rates for ',
      ', so their ranges were switched off. They stay off until the provider quotes them again, or until you unlink them and set their rates by hand.',
      'The extra percentage would make a rate ₦0.00 or less, or more than ₦100,000.00, for ',
      ', so their ranges were switched off. They stay off until the percentage or the provider’s rate brings every rate back in range, or until you unlink them and set their rates by hand.',
      'No currency symbol is set in Cards for the country of ',
      ', so their ranges were switched off. They stay off until one is added, or until you unlink them and set their rates by hand.',
    ]) {
      assert.ok(apply.includes(text), text);
    }
  });
});

describe('the status model', () => {
  test('a complete status is read, and any missing or invalid field refuses the whole status', () => {
    const off = parsedStatus(statusBody());
    assert.equal(off.enabled, false);
    assert.equal(off.provider, null);
    assert.equal(off.universalPct, 4);
    const on = parsedStatus(onBody({ last_success: success(), last_update: update(), universal_markup_pct: -2.5 }));
    assert.equal(on.universalPct, -2.5);
    assert.equal(on.lastUpdate?.status, 'succeeded');
    const required = [
      'enabled', 'provider', 'interval_minutes', 'universal_markup_pct', 'enabled_changed_at', 'updated_at', 'linked_card_type_ids',
      'running', 'last_success', 'last_update', 'last_products', 'failures', 'next_due_at', 'stale',
    ];
    for (const key of required) {
      const body = onBody();
      delete body[key];
      assert.equal(model.toAutomaticStatus(body), null, key);
    }
    const broken: Array<Record<string, unknown>> = [
      onBody({ interval_minutes: 45 }),
      onBody({ universal_markup_pct: 100.5 }),
      onBody({ universal_markup_pct: '4' }),
      onBody({ provider: 'Acme' }),
      onBody({ provider: null }),
      onBody({ next_due_at: null }),
      statusBody({ next_due_at: '2026-10-26T12:30:00.000Z' }),
      statusBody({ stale: true }),
      onBody({ failures: -1 }),
      onBody({ linked_card_type_ids: ['x'] }),
      onBody({ running: { id: RUN_ID, mode: 'sync', started_at: '2026-10-26T11:30:00.000Z', requested_via: 'schedule' } }),
      onBody({ last_update: update({ status: 'failed' }) }),
      onBody({ last_update: update({ status: 'failed', error: 'answer_empty' }) }),
      onBody({ last_update: update({ error: 'x' }) }),
      onBody({ last_success: success({ summary: { lines: 1 } }) }),
      onBody({ last_products: { ...update(), summary: { lines: 1, usable: 2 } } }),
    ];
    for (const body of broken) assert.equal(model.toAutomaticStatus(body), null, JSON.stringify(body));
    assert.equal(model.toAutomaticStatus(null), null);
    assert.equal(model.toAutomaticStatus([]), null);
  });

  test('statusIssue names running, failed with the streak, stale, never, switched-off types, no links or nothing', () => {
    const running = { id: RUN_ID, mode: 'products', started_at: '2026-10-26T11:58:00.000Z', requested_via: 'console' };
    assert.deepEqual(model.statusIssue(parsedStatus(statusBody({ running }))), {
      kind: 'running', mode: 'products', startedAt: '2026-10-26T11:58:00.000Z',
    });
    assert.equal(model.statusIssue(parsedStatus(statusBody())), null);
    assert.deepEqual(model.statusIssue(parsedStatus(onBody({ linked_card_type_ids: [] }))), { kind: 'no_links' });
    const failed = parsedStatus(onBody({
      last_success: success(), last_update: update({ status: 'failed', error: 'rates 503', summary: null }), failures: 2,
    }));
    assert.deepEqual(model.statusIssue(failed), { kind: 'failed', error: 'rates 503', streak: 2, nextDueAt: '2026-10-26T12:30:00.000Z' });
    const quietFailure = parsedStatus(onBody({ last_success: success(), last_update: update({ status: 'failed', error: 'rates 503', summary: null }) }));
    assert.equal(model.statusIssue(quietFailure), null);
    assert.deepEqual(model.statusIssue(parsedStatus(onBody({ last_success: success(), stale: true }))), {
      kind: 'stale', lastSuccessAt: '2026-10-26T11:30:00.000Z',
    });
    const before = success({ started_at: '2026-10-26T08:00:00.000Z' });
    assert.deepEqual(model.statusIssue(parsedStatus(onBody({ last_success: before, stale: true }))), { kind: 'stale', lastSuccessAt: null });
    assert.deepEqual(model.statusIssue(parsedStatus(onBody({ last_success: before }))), { kind: 'never' });
    assert.deepEqual(model.statusIssue(parsedStatus(onBody())), { kind: 'never' });
    const off = { ...SUMMARY, unpriced: [{ card_type_id: ECODE, reason: 'missing', listed: true }, { card_type_id: APPLE_GB, reason: 'missing', listed: false }] };
    assert.deepEqual(model.statusIssue(parsedStatus(onBody({ last_success: success({ summary: off }) }))), {
      kind: 'types_off', types: [{ cardTypeId: ECODE, reason: 'missing', listed: true }],
    });
    assert.equal(model.statusIssue(parsedStatus(onBody({ last_success: success() }))), null);
  });

  test('turnOnBlock gives the first reason turning on is unavailable, in order', () => {
    const ready = (providers: Array<{ id: string; label: string; missingSecrets: string[] }>): ProvidersView => ({ state: 'ready', providers });
    const acme = { id: 'acme', label: 'Acme Rates', missingSecrets: [] };
    const off = (patch: Record<string, unknown> = {}) => parsedStatus(statusBody({ provider: 'acme', linked_card_type_ids: [PHYSICAL], ...patch }));
    assert.equal(model.turnOnBlock(off(), { state: 'loading' }), 'Checking the rate service…');
    assert.equal(model.turnOnBlock(off(), { state: 'failed' }), 'The rate service could not be checked, so automatic rates cannot be turned on right now.');
    assert.equal(model.turnOnBlock(off(), ready([])), 'No rate provider is set up on the server yet, so automatic rates cannot be turned on.');
    assert.equal(model.turnOnBlock(off({ provider: null }), ready([acme])), 'Choose a rate provider in Update settings first.');
    assert.equal(model.turnOnBlock(off({ provider: 'zeta' }), ready([acme])), 'The chosen rate provider is not set up on the server.');
    assert.equal(
      model.turnOnBlock(off(), ready([{ ...acme, missingSecrets: ['ACME_API_KEY', 'ACME_SECRET'] }])),
      'The rate provider’s keys are not set on the server: ACME_API_KEY, ACME_SECRET.',
    );
    assert.equal(model.turnOnBlock(off({ linked_card_type_ids: [] }), ready([acme])), 'Link at least one card type below first.');
    assert.equal(model.turnOnBlock(off(), ready([acme])), null);
  });

  test('providerLock checks the chosen provider first, and words the lock for whether automatic rates are on', () => {
    const acme = { id: 'acme', label: 'Acme Rates', missingSecrets: [] };
    const empty: ProvidersView = { state: 'ready', providers: [] };
    const listed: ProvidersView = { state: 'ready', providers: [acme] };
    const noRegistry = 'No rate provider is set up on the server yet, so card types cannot be linked and automatic rates cannot be turned on.';
    const unknownOff = 'The chosen rate provider is not set up on the server, so its products cannot be loaded and automatic rates cannot be turned on.';
    const unknownOn = 'The chosen rate provider is not set up on the server, so its products cannot be loaded and every update fails until it is set up again.';
    assert.equal(model.providerLock(null, empty, false), noRegistry);
    assert.equal(model.providerLock('acme', empty, false), unknownOff);
    assert.equal(model.providerLock('acme', empty, true), unknownOn);
    assert.equal(model.providerLock('zeta', listed, false), unknownOff);
    assert.equal(model.providerLock('zeta', listed, true), unknownOn);
    assert.equal(model.providerLock(null, listed, false), null);
    assert.equal(model.providerLock('acme', listed, false), null);
    assert.equal(model.providerLock('acme', listed, true), null);
    assert.equal(model.providerLock(null, { state: 'loading' }, false), null);
    assert.equal(model.providerLock('acme', { state: 'failed' }, true), null);
  });

  test('the next update is worded from the status: a start is promised only within 10 minutes of the due time, and later it is overdue', () => {
    const on = (patch: Record<string, unknown> = {}) => parsedStatus(onBody(patch));
    const running = { id: RUN_ID, mode: 'apply', started_at: '2026-10-26T11:59:00.000Z', requested_via: 'schedule' };
    assert.equal(model.dueNow(on(), NOW), false);
    assert.equal(model.dueNow(on({ next_due_at: '2026-10-26T11:55:00.000Z' }), NOW), true);
    assert.equal(model.dueNow(on({ next_due_at: '2026-10-26T12:00:00.000Z' }), NOW), false);
    assert.equal(model.dueNow(on({ next_due_at: '2026-10-26T11:55:00.000Z', running }), NOW), false);
    assert.equal(model.dueNow(on({ next_due_at: '2026-10-24T20:40:00.000Z' }), NOW), false);
    assert.equal(model.dueNow(parsedStatus(statusBody()), NOW), false);
    assert.equal(model.overdue(on(), NOW), false);
    assert.equal(model.overdue(on({ next_due_at: '2026-10-26T11:55:00.000Z' }), NOW), false);
    assert.equal(model.overdue(on({ next_due_at: '2026-10-24T20:40:00.000Z' }), NOW), true);
    assert.equal(model.overdue(on({ next_due_at: '2026-10-24T20:40:00.000Z', running }), NOW), true);
    assert.equal(model.overdue(parsedStatus(statusBody()), NOW), false);
    assert.equal(model.linkDueText(on(), NOW), ' It changes at the next update, due around 26 Oct 2026, 13:30 WAT.');
    assert.equal(model.linkDueText(on({ next_due_at: '2026-10-26T11:55:00.000Z' }), NOW), ' It changes at the next update, which starts within 5 minutes.');
    assert.equal(model.linkDueText(on({ next_due_at: '2026-10-26T11:55:00.000Z', running }), NOW), ' It changes at the next update, due around 26 Oct 2026, 12:55 WAT.');
    assert.equal(model.linkDueText(on({ next_due_at: '2026-10-24T20:40:00.000Z' }), NOW), ' It changes at the next update, which has been overdue since 24 Oct 2026, 21:40 WAT.');
    assert.equal(model.linkDueText(on({ linked_card_type_ids: [], next_due_at: '2026-10-26T11:55:00.000Z' }), NOW), ' The first update starts within 5 minutes.');
    assert.equal(model.linkDueText(on({ linked_card_type_ids: [], next_due_at: '2026-10-24T20:40:00.000Z' }), NOW), ' The first update has been overdue since 24 Oct 2026, 21:40 WAT.');
    assert.equal(model.linkDueText(on({ linked_card_type_ids: [] }), NOW), ' The first update is due around 26 Oct 2026, 13:30 WAT.');
    assert.equal(model.linkDueText(parsedStatus(statusBody({ provider: 'acme' })), NOW), '');
  });

  test('the 10-minute window has exact edges: not yet passed is due around, passed by less than 10 minutes starts within 5, from 10 minutes it is overdue', () => {
    const on = (patch: Record<string, unknown> = {}) => parsedStatus(onBody(patch));
    const ago = (ms: number) => new Date(NOW - ms).toISOString();
    const edges: Array<[number, boolean, boolean, string]> = [
      [-1, false, false, ' It changes at the next update, due around 26 Oct 2026, 13:00 WAT.'],
      [0, false, false, ' It changes at the next update, due around 26 Oct 2026, 13:00 WAT.'],
      [1, true, false, ' It changes at the next update, which starts within 5 minutes.'],
      [599_999, true, false, ' It changes at the next update, which starts within 5 minutes.'],
      [600_000, false, true, ' It changes at the next update, which has been overdue since 26 Oct 2026, 12:50 WAT.'],
      [600_001, false, true, ' It changes at the next update, which has been overdue since 26 Oct 2026, 12:49 WAT.'],
      [3 * 3_600_000, false, true, ' It changes at the next update, which has been overdue since 26 Oct 2026, 10:00 WAT.'],
    ];
    for (const [late, dueNow, overdue, text] of edges) {
      const status = on({ next_due_at: ago(late) });
      assert.equal(model.dueNow(status, NOW), dueNow, `dueNow ${late} ms late`);
      assert.equal(model.overdue(status, NOW), overdue, `overdue ${late} ms late`);
      assert.equal(model.linkDueText(status, NOW), text, `toast ${late} ms late`);
    }
    const first = on({ linked_card_type_ids: [], next_due_at: ago(599_999) });
    assert.equal(model.linkDueText(first, NOW), ' The first update starts within 5 minutes.');
    assert.equal(model.linkDueText(first, NOW + 1), ' The first update has been overdue since 26 Oct 2026, 12:50 WAT.');
  });

  test('the due-time rules are written once, in rules.ts, and the model passes the same functions on', () => {
    assert.equal(model.dueNow, rules.dueNow);
    assert.equal(model.overdue, rules.overdue);
    assert.equal(model.stamp, rules.stamp);
    assert.equal(rules.lateBy(parsedStatus(onBody({ next_due_at: new Date(NOW - 600_000).toISOString() })), NOW), 600_000);
    assert.equal(rules.lateBy(parsedStatus(statusBody()), NOW), null);
    const source = readFileSync(join(OWNED_DIR, 'model.ts'), 'utf8');
    assert.doesNotMatch(source, /DUE_NOW_MS|600_000|function (?:stamp|lateBy|dueNow|overdue)\b/);
  });

  test('the provider is named from the registry only, and generically when the registry does not list it', () => {
    const view: ProvidersView = { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] };
    assert.equal(model.providerName('acme', view), 'Acme Rates');
    assert.equal(model.providerName('zeta', view), 'the rate provider');
    assert.equal(model.providerName('acme', { state: 'failed' }), 'the rate provider');
    assert.equal(model.providerName(null, view), 'the rate provider');
    assert.equal(model.sentence('the rate provider’s rates'), 'The rate provider’s rates');
  });
});

describe('the card types snapshot', () => {
  test('joins the tree with the links, products, percentages and the last update’s switched-off types', () => {
    const snapshot = cardsSnapshot();
    assert.equal(snapshot.provider, 'acme');
    assert.equal(snapshot.typeCount, 3);
    assert.equal(snapshot.linkedCount, 2);
    assert.equal(snapshot.offCount, 1);
    assert.equal(snapshot.hiddenLinked, 0);
    assert.equal(snapshot.ownPctCards, 1);
    const [amazon, apple] = snapshot.cards;
    assert.equal(amazon.ownPct, null);
    assert.equal(amazon.effectivePct, 4);
    assert.equal(apple.ownPct, -10);
    assert.deepEqual(amazon.rows.map((row) => [row.title, row.place, row.ref, row.liveRanges, row.offReason]), [
      ['Amazon US · Physical', 'United States · Physical', 'amz-us-phys', 2, null],
      ['Amazon US · E-code', 'United States · E-code', 'amz-us-code', 0, 'no_bands'],
    ]);
    assert.equal(amazon.rows[0].product?.name, 'Amazon US Physical');
    assert.deepEqual(amazon.rows[0].product?.bands, [{ min: 25, max: 99, rateKobo: 120000 }, { min: 100, max: 500, rateKobo: 125000 }]);
    assert.equal(apple.rows[0].ref, null);
  });

  test('links to card types that are not listed are counted for the footnote', () => {
    const hidden = '0c000000-0000-4000-8000-0000000000ff';
    const snapshot = cardsSnapshot(overview({
      links: [...(overview().links as unknown[]), { card_type_id: hidden, provider_ref: 'amz-us-phys', updated_at: '2026-10-26T09:00:00.000Z' }],
    }));
    assert.equal(snapshot.hiddenLinked, 1);
    assert.equal(model.linkedOfText(snapshot), '2 of 3, plus 1 switched off in Cards');
    assert.equal(model.linkedOfText(cardsSnapshot()), '2 of 3');
  });

  test('refuses an overview whose percentages, products or links cannot be read', () => {
    const broken = [
      overview({ universal_markup_pct: 'x' }),
      overview({ markups: [{ card_id: AMAZON, card_markup_pct: null, effective_markup_pct: 5 }, { card_id: APPLE, card_markup_pct: -10, effective_markup_pct: -10 }] }),
      overview({ markups: [{ card_id: AMAZON, card_markup_pct: null, effective_markup_pct: 4 }] }),
      overview({ products: [product({ bands: null })] }),
      overview({ products: [product({ problem: 'no_bands' })] }),
      overview({ products: [product({ bands: [{ min: 25, max: 99, rate: 0 }] })] }),
      overview({ products: [product({ bands: [{ min: 25, max: 99, rate: 12.345 }] })] }),
      overview({ products: [product(), product()] }),
      overview({ links: [{ card_type_id: PHYSICAL, provider_ref: '', updated_at: '2026-10-26T09:00:00.000Z' }] }),
      overview({ unpriced: 'none' }),
      overview({ provider: 'Acme' }),
    ];
    for (const over of broken) assert.equal(model.toCardsSnapshot({ cards: treeCards(), automatic: over }), null, JSON.stringify(over));
    assert.equal(model.toCardsSnapshot({ cards: treeCards() }), null);
  });

  test('filters by search and link state, and previews the percentage on the provider rates', () => {
    const snapshot = cardsSnapshot();
    assert.deepEqual(model.filterLinkCards(snapshot.cards, '', 'unlinked').map((card) => card.name), ['Apple']);
    assert.deepEqual(model.filterLinkCards(snapshot.cards, '', 'off').flatMap((card) => card.rows.map((row) => row.typeId)), [ECODE]);
    assert.deepEqual(model.filterLinkCards(snapshot.cards, 'kingdom', 'all').map((card) => card.name), ['Apple']);
    assert.deepEqual(model.filterLinkCards(snapshot.cards, 'amz-us-phys', 'all').flatMap((card) => card.rows.map((row) => row.typeId)), [PHYSICAL]);
    const productRow = snapshot.cards[0].rows[0].product;
    assert.ok(productRow);
    assert.deepEqual(model.previewBands(productRow, 4), [
      { min: 25, max: 99, rateKobo: 120000, paidKobo: 124800, valid: true },
      { min: 100, max: 500, rateKobo: 125000, paidKobo: 130000, valid: true },
    ]);
    assert.ok(model.previewBands(productRow, -90)?.every((band) => band.valid));
    const unusable = snapshot.cards[0].rows[1].product;
    assert.ok(unusable);
    assert.equal(model.previewBands(unusable, 4), null);
    assert.deepEqual(model.currencySamples(snapshot.cards[0]), [
      { key: 'US|$', countryName: 'United States', symbol: '$', lowKobo: 120000, highKobo: 125000 },
    ]);
  });

  test('classifies writes as done, conflict, denied, expired, unknown or refused', () => {
    const failure = (patch: Record<string, unknown>): ApiResult<unknown> => ({
      ok: false,
      error: { kind: 'http', status: 409, code: 'STATE_CONFLICT', message: 'm', requestId: null, details: null, outcomeUnknown: false, ...patch },
    });
    assert.deepEqual(model.classifyWrite({ ok: true, data: 1, status: 200, requestId: null }), { kind: 'done', data: 1 });
    assert.deepEqual(model.classifyWrite(failure({ details: { reason: 'conflict' } })), { kind: 'conflict', message: 'm' });
    assert.deepEqual(model.classifyWrite(failure({ details: { reason: 'no_links' } })), { kind: 'refused', message: 'm' });
    assert.deepEqual(model.classifyWrite(failure({ status: 403 })), { kind: 'denied', message: 'm' });
    assert.deepEqual(model.classifyWrite(failure({ status: 401 })), { kind: 'expired' });
    assert.deepEqual(model.classifyWrite(failure({ status: 500, details: { outcome_unknown: true } })), { kind: 'unknown', message: 'm' });
    assert.deepEqual(model.classifyWrite(failure({ kind: 'timeout', status: null })), { kind: 'unknown', message: 'm' });
    assert.deepEqual(model.classifyWrite(failure({ status: 500, outcomeUnknown: true })), { kind: 'unknown', message: 'm' });
  });
});

describe('confirm dialogs', () => {
  test('turning on lists the provider, the links, the schedule and both kinds of percentage', () => {
    const status = parsedStatus(onBody({ enabled: false, enabled_changed_at: null, next_due_at: null, universal_markup_pct: 4 }));
    const dialog = options.turnOnOptions({ status, provider: 'Acme Rates', cards: cardsSnapshot() });
    assert.equal(dialog.tone, 'financial');
    assert.equal(dialog.title, 'Turn on automatic rates?');
    assert.equal(
      dialog.message,
      'Every hour, linked card types get Acme Rates’s ranges and rates plus the extra percentage. Card types that are not linked are never changed. The change is recorded in the audit log.',
    );
    assert.deepEqual(dialog.details?.map((detail) => detail.label), [
      'Automatic rates', 'Rate provider', 'Linked card types', 'Update every', 'Extra percentage for every card', 'Cards with their own percentage',
    ]);
    assert.deepEqual(dialog.details?.slice(1).map((detail) => detail.value), ['Acme Rates', '2 of 3', '1 hour', '+4%', '1']);
    assert.match(textOf(render(dialog.details?.[0].value as ReactElement)), /From Off → to On/);
    assert.deepEqual(dialog.consequences, [
      'The first update starts within 5 minutes. After that, ranges and rates typed by hand on the 2 linked card types last only until the next update.',
      'At each update, a linked card type gets exactly the provider’s ranges. Ranges the provider does not list are switched off, and a card type the provider does not quote is switched off until it is quoted again.',
      'Each update applies the provider’s rates as received, however far they move from the last update.',
      'The 1 card type that is not linked keeps its rates, and extra percentages never apply to it.',
      'While automatic rates are on, changing an extra percentage reprices the linked ranges straight away. Rates are rounded to the nearest kobo after the percentage is applied.',
    ]);
    assert.equal(dialog.confirmLabel, 'Turn on automatic rates');
    assert.equal(dialog.pendingLabel, 'Turning on automatic rates…');
    assert.doesNotMatch(JSON.stringify(dialog.consequences), /hold|anyway|accept/i);

    const hidden = '0c000000-0000-4000-8000-0000000000ff';
    const withHidden = cardsSnapshot(overview({
      links: [...(overview().links as unknown[]), { card_type_id: hidden, provider_ref: 'amz-us-phys', updated_at: '2026-10-26T09:00:00.000Z' }],
    }));
    const three = parsedStatus(onBody({ enabled: false, enabled_changed_at: null, next_due_at: null, linked_card_type_ids: [PHYSICAL, ECODE, hidden] }));
    const counted = options.turnOnOptions({ status: three, provider: 'Acme Rates', cards: withHidden });
    assert.equal(counted.details?.find((detail) => detail.label === 'Linked card types')?.value, '2 of 3, plus 1 switched off in Cards');
    assert.match(counted.consequences?.[0] ?? '', /on the 3 linked card types last only until the next update\.$/);
  });

  test('turning off, updating now, linking, unlinking and changing a card percentage', () => {
    const status = parsedStatus(onBody());
    const off = options.turnOffOptions(status, 'Acme Rates');
    assert.equal(off.title, 'Turn off automatic rates?');
    assert.equal(off.message, 'Updates from Acme Rates stop. Every range keeps the rate it has now, and rates are set by hand again. The change is recorded in the audit log.');
    assert.deepEqual(off.consequences, [
      'Links and extra percentages are kept, so turning automatic rates back on resumes updates.',
      'An update that is running when you confirm finishes without changing any rate.',
    ]);
    const run = options.runOptions('Acme Rates');
    assert.equal(run.tone, 'financial');
    assert.equal(run.title, 'Update rates from Acme Rates now?');
    assert.equal(run.confirmLabel, 'Update rates now');
    assert.equal(run.pendingLabel, 'Updating rates…');
    assert.deepEqual(run.consequences, ['The provider’s rates are applied as received, however far they move from the last update.']);

    const snapshot = cardsSnapshot();
    const [amazon, apple] = snapshot.cards;
    const usable = amazon.rows[0].product;
    const unusable = amazon.rows[1].product;
    assert.ok(usable && unusable);
    const link = options.linkOptions(apple.rows[0], apple, usable, 'Acme Rates');
    assert.equal(link.title, 'Link Apple GB · E-code to Amazon US Physical?');
    assert.deepEqual(link.details?.map((detail) => [detail.label, detail.value]), [
      ['Product', 'Amazon US Physical (amz-us-phys)'],
      ['Extra percentage', '−10% (this card’s own percentage)'],
      ['Live ranges now', '0'],
    ]);
    assert.equal(link.confirmLabel, 'Link card type');
    assert.equal(link.pendingLabel, 'Linking…');
    assert.equal(link.consequences, undefined);
    const risky = options.linkOptions(amazon.rows[1], amazon, unusable, 'Acme Rates');
    assert.deepEqual(risky.consequences, [
      'Acme Rates’s rates for this product cannot be used because the provider listed no ranges. If you link it, this card type is switched off at each update until they can be used.',
      'Amazon US E-code was not in Acme Rates’s latest list, so this card type is switched off at the next update unless it is listed again.',
    ]);
    const unlink = options.unlinkOptions(amazon.rows[0]);
    assert.equal(unlink.title, 'Unlink Amazon US · Physical?');
    assert.equal(unlink.confirmLabel, 'Unlink card type');

    const own = options.extraOptions(amazon, 5, 4, true);
    assert.equal(own.title, 'Change the extra percentage for Amazon?');
    assert.equal(own.message, 'Linked ranges of Amazon are repriced as soon as you confirm. The change is recorded in the audit log.');
    assert.equal(own.confirmLabel, 'Set to +5%');
    assert.match(textOf(render(own.details?.[0].value as ReactElement)), /\+4% \(every-card percentage\) → to \+5% \(this card’s own percentage\)/);
    assert.equal(own.details?.[1].value, '2 of 2 card types');
    const back = options.extraOptions(apple, null, 4, false);
    assert.equal(back.message, 'The percentage is used once automatic rates are on. The change is recorded in the audit log.');
    assert.equal(back.confirmLabel, 'Use the every-card percentage');
    assert.deepEqual(back.consequences, [
      'Card types of Apple that are not linked keep their hand-typed rates.',
      'Rates are rounded to the nearest kobo after the percentage is applied.',
    ]);
  });
});

const nodeRequire = createRequire(import.meta.url);
const { AppRouterContext } = nodeRequire('next/dist/shared/lib/app-router-context.shared-runtime') as {
  AppRouterContext: Context<unknown>;
};
const ROUTER = { push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} };

describe('the section on screen', () => {
  let section: SectionModule;
  let parts: PartsModule;
  let ConfirmProvider: ElementType;

  before(async () => {
    section = await loadAppModule<SectionModule>('(dashboard)/automatic-rates/AutomaticRatesSection.tsx');
    parts = await loadAppModule<PartsModule>('(dashboard)/automatic-rates/AutomaticRatesParts.tsx');
    ({ ConfirmProvider } = await loadUi<{ ConfirmProvider: ElementType }>('Confirm.tsx'));
  });

  function screen(status: AutomaticStatus, canWrite: boolean, view: ProvidersView, cards: CardsSnapshot | null = cardsSnapshot()): string {
    return render(createElement(
      AppRouterContext.Provider,
      { value: ROUTER },
      createElement(ConfirmProvider, {
        children: createElement(section.AutomaticRatesView, {
          status, failure: null, shownAt: null, view, cards, cardsFailure: null, cardsRetrying: false, canWrite, isMobile: false,
          now: NOW, working: null, baseId: 'ar', switchRef: null, runRef: null, onRetry: () => {}, onRetryCards: () => {},
          onToggle: () => {}, onRun: () => {}, onLoadProducts: () => {}, onLink: () => {}, onUnlink: () => {}, onExtra: () => {},
          onSettingsSaved: () => {},
        }),
      }),
    ));
  }

  function button(html: string, label: string) {
    return tagsOf(html, 'button').find((attrs) => attrs['aria-label'] === label)
      ?? [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
        .filter((match) => textOf(match[2]) === label)
        .map((match) => tagsOf(`<button${match[1]}>`, 'button')[0])[0];
  }

  test('with no provider set up, turning on is disabled with the plain reason and updating now is disabled while off', () => {
    const html = screen(parsedStatus(statusBody()), true, { state: 'ready', providers: [] }, cardsSnapshot(overview({ provider: null, links: [], products: [], unpriced: [] })));
    const text = textOf(html);
    const turnOn = button(html, 'Turn on automatic rates…');
    assert.ok(turnOn, 'turn on button');
    assert.equal(turnOn.disabled, '');
    assert.match(text, /No rate provider is set up on the server yet, so automatic rates cannot be turned on\./);
    const runNow = button(html, 'Update rates now…');
    assert.ok(runNow);
    assert.equal(runNow.disabled, '');
    assert.match(text, /Turn on automatic rates to update them from the rate provider\./);
    assert.ok(button(html, 'Load products')?.disabled === '');
    const lock = 'No rate provider is set up on the server yet, so card types cannot be linked and automatic rates cannot be turned on.';
    assert.equal(text.split(lock).length - 1, 2, 'the Links card and the Updates card both name the lock');
    assert.doesNotMatch(text, /Choose a rate provider|Pick the provider in Update settings|No rate provider is chosen yet/);
    assert.match(text, /Updates No rate provider is set up on the server yet\./);
    assert.match(text, /No rate provider is set up on the server yet\./);
    assert.match(text, /Off\. Every rate is set by hand\./);
    assert.doesNotMatch(text, /You can view automatic rates/);

    const reader = textOf(screen(parsedStatus(statusBody()), false, { state: 'ready', providers: [] }, cardsSnapshot(overview({ provider: null, links: [], products: [], unpriced: [] }))));
    assert.equal(reader.split(lock).length - 1, 2, 'a read-only admin sees the lock in the Switch card and the Links card');
    assert.match(reader, /Off\. Every rate is set by hand\. No rate provider is set up on the server yet, so card types cannot be linked/);
    assert.doesNotMatch(reader, /Choose a rate provider|Pick the provider in Update settings/);

    const listed: ProvidersView = { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] };
    const free = textOf(screen(parsedStatus(statusBody()), true, listed, cardsSnapshot(overview({ provider: null, links: [], products: [], unpriced: [] }))));
    assert.match(free, /Choose a rate provider first/);
    assert.match(free, /No rate provider is chosen yet\./);
    assert.doesNotMatch(free, /No rate provider is set up on the server yet/);

    const unlisted = screen(parsedStatus(statusBody({ provider: 'zeta' })), true, listed, cardsSnapshot(overview({ provider: 'zeta', links: [], products: [], unpriced: [] })));
    const unlistedText = textOf(unlisted);
    assert.match(unlistedText, /The chosen rate provider is not set up on the server, so its products cannot be loaded and automatic rates cannot be turned on\./);
    assert.doesNotMatch(unlistedText, /No products loaded yet|Load the product list/);
  });

  test('a chosen provider the server does not list locks loading products, and while on the lock does not say turning on is blocked', () => {
    const listed: ProvidersView = { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] };
    const empty: ProvidersView = { state: 'ready', providers: [] };
    const unknownOff = 'The chosen rate provider is not set up on the server, so its products cannot be loaded and automatic rates cannot be turned on.';
    const unknownOn = 'The chosen rate provider is not set up on the server, so its products cannot be loaded and every update fails until it is set up again.';
    for (const canWrite of [true, false]) {
      const who = canWrite ? 'writer' : 'reader';
      const on = textOf(screen(parsedStatus(onBody({ provider: 'zeta' })), canWrite, listed, cardsSnapshot(overview({ provider: 'zeta' }))));
      assert.match(on, /Automatic rates are on/, who);
      assert.ok(on.includes(unknownOn), who);
      assert.doesNotMatch(on, /cannot be turned on|card types cannot be linked/, who);
      const onEmpty = textOf(screen(parsedStatus(onBody()), canWrite, empty, cardsSnapshot(overview())));
      assert.match(onEmpty, /Automatic rates are on/, who);
      assert.ok(onEmpty.includes(unknownOn), who);
      assert.doesNotMatch(onEmpty, /cannot be turned on|card types cannot be linked/, who);
    }
    const onHtml = screen(parsedStatus(onBody({ provider: 'zeta' })), true, listed, cardsSnapshot(overview({ provider: 'zeta' })));
    assert.equal(textOf(onHtml).split(unknownOn).length - 1, 2, 'the Links card and the Updates card both name the lock');
    assert.equal(button(onHtml, 'Load products')?.disabled, '');

    const offEmpty = screen(parsedStatus(statusBody({ provider: 'acme', linked_card_type_ids: [PHYSICAL] })), true, empty, cardsSnapshot(overview({ enabled: false })));
    const offEmptyText = textOf(offEmpty);
    assert.equal(offEmptyText.split(unknownOff).length - 1, 2, 'the Links card and the Updates card both name the lock');
    assert.doesNotMatch(offEmptyText, /card types cannot be linked/);
    assert.equal(button(offEmpty, 'Load products')?.disabled, '');
    const unlisted = screen(parsedStatus(statusBody({ provider: 'zeta', linked_card_type_ids: [PHYSICAL] })), true, listed, cardsSnapshot(overview({ provider: 'zeta', enabled: false })));
    assert.equal(textOf(unlisted).split(unknownOff).length - 1, 2, 'the Links card and the Updates card both name the lock');
    assert.equal(button(unlisted, 'Load products')?.disabled, '');
    const usable = screen(parsedStatus(statusBody({ provider: 'acme', linked_card_type_ids: [PHYSICAL] })), true, listed, cardsSnapshot(overview({ enabled: false })));
    assert.equal(button(usable, 'Load products')?.disabled, undefined);
    assert.doesNotMatch(textOf(usable), /is not set up on the server/);
  });

  test('with automatic rates on and nothing linked, no next update is promised', () => {
    const view: ProvidersView = { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] };
    const status = parsedStatus(onBody({ linked_card_type_ids: [] }));
    const text = textOf(screen(status, true, view, cardsSnapshot(overview({ links: [], unpriced: [] }))));
    assert.match(text, /No card types are linked, so nothing is updated\./);
    assert.doesNotMatch(text, /0 linked card types are updated|Rates typed on them by hand are replaced/);
    assert.match(text, /Next update None until a card type is linked/);
    assert.doesNotMatch(text, /Due around/);
    assert.match(text, /No card types are linked Automatic rates are on, but nothing is updated until a card type is linked\./);
    const one = textOf(screen(parsedStatus(onBody({ linked_card_type_ids: [PHYSICAL] })), true, view));
    assert.match(one, /1 linked card type is updated every hour\. Rates typed on them by hand are replaced at the next update\./);
    assert.match(one, /Next update Due around 26 Oct 2026, 13:30 WAT/);
    const justDue = textOf(screen(parsedStatus(onBody({ linked_card_type_ids: [PHYSICAL], next_due_at: '2026-10-26T11:55:00.000Z' })), true, view));
    assert.match(justDue, /Next update Due now\. It starts within 5 minutes\. Linked card types/);
    const relinked = textOf(screen(parsedStatus(onBody({ linked_card_type_ids: [PHYSICAL], next_due_at: '2026-10-24T20:40:00.000Z' })), true, view));
    assert.match(relinked, /Next update Overdue since 24 Oct 2026, 21:40 WAT Linked card types/);
    assert.doesNotMatch(relinked, /Next update Due/);
    const running = { id: RUN_ID, mode: 'apply', started_at: '2026-10-26T11:59:00.000Z', requested_via: 'schedule' };
    const busy = textOf(screen(parsedStatus(onBody({ linked_card_type_ids: [PHYSICAL], next_due_at: '2026-10-26T11:55:00.000Z', running })), true, view));
    assert.match(busy, /An update is running\./);
    assert.match(busy, /Next update Due around 26 Oct 2026, 12:55 WAT/);
    assert.doesNotMatch(busy, /Due now/);
    const busyLate = textOf(screen(parsedStatus(onBody({ linked_card_type_ids: [PHYSICAL], next_due_at: '2026-10-26T09:00:00.000Z', running })), true, view));
    assert.match(busyLate, /An update is running\./);
    assert.match(busyLate, /Next update Overdue since 26 Oct 2026, 10:00 WAT Linked card types/);
  });

  test('an update overdue for hours while rates are out of date promises no start in the Next update row or the link toast', () => {
    const view: ProvidersView = { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] };
    const last = { started_at: '2026-10-26T08:45:00.000Z', finished_at: '2026-10-26T08:45:03.000Z' };
    const stalled = parsedStatus(onBody({
      linked_card_type_ids: [PHYSICAL],
      enabled_changed_at: '2026-10-26T07:00:00.000Z',
      last_success: success(last),
      last_update: update(last),
      next_due_at: '2026-10-26T09:45:00.000Z',
      stale: true,
    }));
    const row = (now: number) => {
      const text = textOf(render(createElement(parts.UpdatesCard, {
        status: stalled, now, view, cards: null, labels: new Map(), canWrite: true, running: null, disabled: false,
        headingId: 'u', runRef: null, onRun: () => {}, onLoadProducts: () => {},
      })));
      return { text, next: (text.match(/Next update (.+?) Linked card types/) ?? [])[1] };
    };
    const atNow = row(NOW);
    assert.match(atNow.text, /Rates are out of date/);
    assert.equal(atNow.next, 'Overdue since 26 Oct 2026, 10:45 WAT');
    assert.doesNotMatch(atNow.text, /Due now|starts within 5 minutes|Due around/);
    assert.equal(row(NOW + 3_600_000).next, 'Overdue since 26 Oct 2026, 10:45 WAT');
    assert.equal(model.linkDueText(stalled, NOW), ' It changes at the next update, which has been overdue since 26 Oct 2026, 10:45 WAT.');
    assert.equal(model.linkDueText(stalled, NOW + 3_600_000), ' It changes at the next update, which has been overdue since 26 Oct 2026, 10:45 WAT.');
    assert.doesNotMatch(textOf(screen(stalled, true, view)), /Next update Due|Due now/);
  });

  test('the never callout promises the first update within 5 minutes only until its due time is 10 minutes past, then says it is overdue', () => {
    const view: ProvidersView = { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] };
    const fresh = parsedStatus(onBody({
      linked_card_type_ids: [PHYSICAL],
      enabled_changed_at: '2026-10-26T11:46:30.000Z',
      next_due_at: '2026-10-26T11:50:00.000Z',
    }));
    assert.deepEqual(model.statusIssue(fresh), { kind: 'never' });
    const card = (now: number) => textOf(render(createElement(parts.UpdatesCard, {
      status: fresh, now, view, cards: null, labels: new Map(), canWrite: true, running: null, disabled: false,
      headingId: 'u', runRef: null, onRun: () => {}, onLoadProducts: () => {},
    })));
    const late = card(NOW + 30_000);
    assert.match(late, /No update has finished yet The first update has been overdue since 26 Oct 2026, 12:50 WAT\./);
    assert.match(late, /Next update Overdue since 26 Oct 2026, 12:50 WAT Linked card types/);
    assert.doesNotMatch(late, /starts within 5 minutes|Due now/);
    assert.equal(
      parts.issueView({ kind: 'never' }, fresh, 'Acme Rates', NOW + 30_000, new Map()).message,
      'The first update has been overdue since 26 Oct 2026, 12:50 WAT.',
    );
    assert.match(card(NOW), /No update has finished yet The first update has been overdue since 26 Oct 2026, 12:50 WAT\./);
    const window = card(NOW - 1);
    assert.match(window, /No update has finished yet The first update starts within 5 minutes of turning automatic rates on\./);
    assert.match(window, /Next update Due now\. It starts within 5 minutes\. Linked card types/);
    const ahead = card(Date.parse('2026-10-26T11:48:00.000Z'));
    assert.match(ahead, /No update has finished yet The first update starts within 5 minutes of turning automatic rates on\./);
    assert.match(ahead, /Next update Due around 26 Oct 2026, 12:50 WAT Linked card types/);
  });

  test('the failed callout words the next attempt the way the Next update row does: due around, then within 5 minutes, then overdue since', () => {
    const view: ProvidersView = { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] };
    const cases: Array<[number, string, string]> = [
      [-1_800_000, ', and the next attempt is due around 26 Oct 2026, 13:30 WAT', 'Due around 26 Oct 2026, 13:30 WAT'],
      [0, ', and the next attempt is due around 26 Oct 2026, 13:00 WAT', 'Due around 26 Oct 2026, 13:00 WAT'],
      [1, ', and the next attempt starts within 5 minutes', 'Due now. It starts within 5 minutes.'],
      [599_999, ', and the next attempt starts within 5 minutes', 'Due now. It starts within 5 minutes.'],
      [600_000, ', and the next attempt has been overdue since 26 Oct 2026, 12:50 WAT', 'Overdue since 26 Oct 2026, 12:50 WAT'],
      [3 * 3_600_000, ', and the next attempt has been overdue since 26 Oct 2026, 10:00 WAT', 'Overdue since 26 Oct 2026, 10:00 WAT'],
    ];
    for (const [late, tail, row] of cases) {
      const status = parsedStatus(onBody({
        linked_card_type_ids: [PHYSICAL],
        last_success: success(),
        last_update: update({ status: 'failed', error: 'answer_empty', summary: null }),
        failures: 2,
        next_due_at: new Date(NOW - late).toISOString(),
        stale: late > 900_000,
      }));
      const issue = model.statusIssue(status);
      assert.ok(issue && issue.kind === 'failed', `${late} ms late`);
      assert.equal(
        parts.issueView(issue, status, 'Acme Rates', NOW, new Map()).message,
        `Reading rates from Acme Rates failed because it returned no rates. Rates stay as they were${tail}. 2 updates in a row have failed.`,
        `${late} ms late`,
      );
      const text = textOf(render(createElement(parts.UpdatesCard, {
        status, now: NOW, view, cards: null, labels: new Map(), canWrite: true, running: null, disabled: false,
        headingId: 'u', runRef: null, onRun: () => {}, onLoadProducts: () => {},
      })));
      assert.ok(text.includes(`The last update failed Reading rates from Acme Rates failed because it returned no rates. Rates stay as they were${tail}.`), `callout ${late} ms late`);
      assert.ok(text.includes(`Next update ${row} Linked card types`), `row ${late} ms late`);
      if (late >= 600_000) assert.doesNotMatch(text, /starts within 5 minutes|Due now|due around/i, `${late} ms late`);
    }
  });

  test('the Updates card and the turn-on dialog count links to switched-off card types the same way', () => {
    const hidden = '0c000000-0000-4000-8000-0000000000ff';
    const view: ProvidersView = { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] };
    const cards = cardsSnapshot(overview({
      links: [...(overview().links as unknown[]), { card_type_id: hidden, provider_ref: 'amz-us-phys', updated_at: '2026-10-26T09:00:00.000Z' }],
    }));
    const status = parsedStatus(onBody({ linked_card_type_ids: [PHYSICAL, ECODE, hidden] }));
    const text = textOf(screen(status, true, view, cards));
    assert.match(text, /Linked card types 2 of 3, plus 1 switched off in Cards/);
    assert.match(text, /3 linked card types are updated every hour\./);
    assert.match(text, /1 linked card type is switched off in Cards, so it is not listed here\. It is still updated\./);
  });

  test('the result row counts the linked card types of the update, including one it switched off', () => {
    const view: ProvidersView = { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] };
    const off = {
      ...SUMMARY, linked: 1, priced: 0, created: 0, updated: 0, deactivated: 2,
      unpriced: [{ card_type_id: PHYSICAL, reason: 'missing', listed: true }],
    };
    const status = parsedStatus(onBody({ linked_card_type_ids: [PHYSICAL], last_success: success({ summary: off }), last_update: update({ summary: off }) }));
    const text = textOf(screen(status, true, view));
    assert.match(text, /Result 2 ranges switched off on 1 card type Next update/);
    assert.doesNotMatch(text, /on 0 card types/);
  });

  test('a rates.read admin sees everything without action buttons and gets the read-only notice', () => {
    const status = parsedStatus(onBody({ last_success: success(), last_update: update() }));
    const html = screen(status, false, { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] });
    const text = textOf(html);
    assert.match(text, /You can view automatic rates\. Changing them needs the “Draft rate changes” permission\./);
    for (const label of ['Turn on automatic rates…', 'Turn off automatic rates…', 'Update rates now…', 'Load products', 'Link…', 'Unlink…', 'Change…']) {
      assert.equal(text.includes(label), false, label);
    }
    assert.match(text, /Automatic rates are on/);
    assert.match(text, /2 linked card types are updated every hour\. Rates typed on them by hand are replaced at the next update\./);
    assert.match(text, /Rate provider Acme Rates/);
    assert.match(text, /2 rates changed, 1 range added and 1 range switched off on 2 card types/);
    assert.match(text, /Due around 26 Oct 2026, 13:30 WAT/);
    assert.match(text, /Extra percentage for every card \+4%/);
    assert.match(text, /Switched off at the last update 1/);
    assert.doesNotMatch(text, /Review changes/);
  });

  test('a writer sees the switch, the update buttons, the settings form and the issue callouts', () => {
    const status = parsedStatus(onBody({
      last_success: success(), last_update: update({ status: 'failed', error: 'answer_empty', summary: null }), failures: 3,
    }));
    const html = screen(status, true, { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] });
    const text = textOf(html);
    assert.ok(button(html, 'Turn off automatic rates…'));
    assert.equal(button(html, 'Update rates now…')?.disabled, undefined);
    assert.match(text, /The last update failed/);
    assert.match(text, /Reading rates from Acme Rates failed because it returned no rates\. Rates stay as they were, and the next attempt is due around 26 Oct 2026, 13:30 WAT\. 3 updates in a row have failed\./);
    assert.match(text, /Failed: it returned no rates/);
    assert.match(text, /Update settings/);
    assert.equal(button(html, 'Unlink Amazon US · Physical'), undefined, 'the cards start collapsed');
    assert.deepEqual(tagsOf(html, 'button').filter((attrs) => attrs['aria-expanded'] !== undefined).map((attrs) => attrs['aria-expanded']), [
      'false', 'false',
    ]);
  });

  test('the switched-off callout names the card types, and the parts render on their own', () => {
    const off = { ...SUMMARY, unpriced: [{ card_type_id: ECODE, reason: 'no_bands', listed: true }] };
    const status = parsedStatus(onBody({ last_success: success({ summary: off }), last_update: update({ summary: off }) }));
    const view: ProvidersView = { state: 'ready', providers: [{ id: 'acme', label: 'Acme Rates', missingSecrets: [] }] };
    const labels = new Map([[ECODE, 'Amazon US · E-code']]);
    const issue = model.statusIssue(status);
    assert.ok(issue && issue.kind === 'types_off');
    assert.deepEqual(parts.issueView(issue, status, 'Acme Rates', NOW, labels), {
      tone: 'warning',
      title: '1 card type is switched off',
      message: 'The last update got no usable rates for Amazon US · E-code, so their ranges were switched off. They stay off until Acme Rates quotes them again, or until you unlink them and set their rates by hand.',
    });
    assert.match(parts.issueView(issue, status, 'Acme Rates', NOW, new Map()).message, /for 1 linked card type,/);
    const mixed = {
      ...SUMMARY,
      unpriced: [
        { card_type_id: ECODE, reason: 'missing', listed: true },
        { card_type_id: PHYSICAL, reason: 'markup_out_of_range', listed: true },
        { card_type_id: APPLE_GB, reason: 'no_currency_symbol', listed: true },
      ],
    };
    const mixedStatus = parsedStatus(onBody({ last_success: success({ summary: mixed }), last_update: update({ summary: mixed }) }));
    const mixedIssue = model.statusIssue(mixedStatus);
    assert.ok(mixedIssue && mixedIssue.kind === 'types_off');
    const names = new Map([[ECODE, 'Amazon US · E-code'], [PHYSICAL, 'Amazon US · Physical'], [APPLE_GB, 'Apple GB · E-code']]);
    assert.deepEqual(parts.issueView(mixedIssue, mixedStatus, 'Acme Rates', NOW, names), {
      tone: 'warning',
      title: '3 card types are switched off',
      message: 'The last update got no usable rates for Amazon US · E-code, so their ranges were switched off. They stay off until Acme Rates quotes them again, or until you unlink them and set their rates by hand. '
        + 'The extra percentage would make a rate ₦0.00 or less, or more than ₦100,000.00, for Amazon US · Physical, so their ranges were switched off at the last update. They stay off until the percentage or Acme Rates’s rate brings every rate back in range, or until you unlink them and set their rates by hand. '
        + 'No currency symbol is set in Cards for the country of Apple GB · E-code, so their ranges were switched off at the last update. They stay off until one is added, or until you unlink them and set their rates by hand.',
    });
    const percentOnly = { ...SUMMARY, unpriced: [{ card_type_id: PHYSICAL, reason: 'markup_out_of_range', listed: true }] };
    const percentStatus = parsedStatus(onBody({ last_success: success({ summary: percentOnly }), last_update: update({ summary: percentOnly }) }));
    const percentIssue = model.statusIssue(percentStatus);
    assert.ok(percentIssue && percentIssue.kind === 'types_off');
    assert.doesNotMatch(parts.issueView(percentIssue, percentStatus, 'Acme Rates', NOW, names).message, /no usable rates|quotes them again/);
    const running = render(createElement(parts.RunningNotice, {
      running: { id: RUN_ID, mode: 'apply', startedAt: '2026-10-26T11:58:00.000Z', via: 'console' },
      now: NOW,
    }));
    assert.match(textOf(running), /An update is running\. It started 2m ago\./);
    const summary = textOf(render(createElement(parts.SettingsSummary, { status, view, headingId: 'x' })));
    assert.match(summary, /Rate provider Acme Rates Update every 1 hour Extra percentage for every card \+4%/);
  });

  test('saving Update settings refreshes the status and the cards, and a card percentage is confirmed against a fresh status', () => {
    const form = readFileSync(join(APP_DIR, '(dashboard)', '_config', 'ConfigForm.tsx'), 'utf8');
    assert.match(form, /^ {2}onSaved\?: \(\) => void;$/m);
    assert.match(form, /export function ConfigForm\(\{ title, subtitle, endpoint, sections, onSaved \}: ConfigFormProps\)/);
    const saved = [...form.matchAll(/toast\.show\(savedMessage\(pending\.length\), 'success'\);\n([\s\S]*?)return;/g)].map((match) => match[1]);
    assert.equal(saved.length, 2);
    for (const tail of saved) assert.match(tail, /onSaved\?\.\(\);\n\s*$/);
    assert.equal((form.match(/onSaved\?\.\(\)/g) ?? []).length, 2);
    const source = readFileSync(join(OWNED_DIR, 'AutomaticRatesSection.tsx'), 'utf8');
    assert.match(source, /onSaved=\{onSettingsSaved\}/);
    assert.match(source, /const settingsSaved = \(\) => \{\s*void refreshStatus\(\{ background: true \}\);\s*void refreshCards\(\{ background: true \}\);\s*\};/);
    assert.match(source, /onSettingsSaved=\{settingsSaved\}/);
    assert.match(
      source,
      /const fresh = await readFresh\(\);\s*if \(!fresh\) return false;\s*const decision = await confirm<WriteOutcome<MarkupReceipt>>\(\{\s*\.\.\.extraOptions\(card, next, fresh\.universalPct, fresh\.enabled\),/,
    );
    assert.equal((source.match(/formatPct\(outcome\.data\.effectivePct\)/g) ?? []).length, 2);
    assert.doesNotMatch(source, /current\.universalPct/);
  });

  test('linking is confirmed against a fresh status and freshly read cards, and a read cut short by another refresh is read again', () => {
    const source = readFileSync(join(OWNED_DIR, 'AutomaticRatesSection.tsx'), 'utf8');
    assert.match(
      source,
      /const readNow = async <T,>\(refresh: \(\) => Promise<ApiResult<T> \| null>\): Promise<T \| null> => \{\s*let result = await refresh\(\);\s*if \(aliveRef\.current && result && !result\.ok && result\.error\.kind === 'aborted'\) result = await refresh\(\);\s*if \(!aliveRef\.current \|\| !result\) return null;\s*if \(!result\.ok\) \{\s*if \(result\.error\.status !== 401\) \{\s*toast\.show\(`Could not check automatic rates, so nothing was changed\. \$\{result\.error\.message\}`, 'error'\);\s*\}\s*if \(result\.error\.status === 403\) router\.refresh\(\);\s*return null;\s*\}\s*return result\.data;\s*\};/,
    );
    assert.match(source, /const readFresh = \(\) => readNow\(refreshStatus\);/);
    const link = source.slice(source.indexOf('const submitLink = async ('), source.indexOf('const unlink = async ('));
    assert.match(
      link,
      /const fresh = await readFresh\(\);\s*if \(!fresh\) return false;\s*const cardsNow = await readNow\(refreshCards\);\s*if \(!cardsNow\) return false;\s*const freshCard = cardsNow\.cards\.find\(\(entry\) => entry\.id === card\.id\);\s*if \(!freshCard\) \{\s*toast\.show\(`\$\{card\.name\} is no longer listed \(it was switched off or removed in Cards\), so nothing was changed\.`, 'error'\);\s*return true;\s*\}\s*const provider = providerName\(fresh\.provider, view\);\s*const priced = \{ \.\.\.freshCard, effectivePct: freshCard\.ownPct \?\? fresh\.universalPct \};\s*const outcome = await saveLinks\(linkOptions\(row, priced, product, provider\), \{/,
    );
    assert.match(link, /is linked to \$\{product\.name\}\.\$\{linkDueText\(fresh, Date\.now\(\)\)\}/);
    assert.doesNotMatch(link, /status\.data|const current|cardsData|\.\.\.card\b|card\.ownPct|card\.effectivePct/);
    assert.match(source, /const linkCard = linking && cardsData \? cardsData\.cards\.find\(\(entry\) => entry\.id === linking\.card\.id\) : undefined;/);
    assert.match(source, /\{canWrite && linking && cardsData && linkCard \? \(\s*<LinkModal\s*key=\{linking\.row\.typeId\}\s*row=\{linking\.row\}\s*card=\{linkCard\}/);
  });

  test('an admin with neither rates permission is refused, and a 403 from the status shows AccessDenied for rates.read', async () => {
    const nav = await import('../app/(dashboard)/_shell/nav.ts');
    const perms = await import('../app/lib/permissions.ts');
    const denied = (keys: string[]) => nav.isNavPathDenied(
      '/admin-settings/automatic-rates', keys, false, perms.resolvePermissions(keys, false), perms.PAGE_READ_PERMISSION,
    );
    assert.equal(denied([]), true);
    assert.equal(denied(['rates.write']), true);
    assert.equal(denied(['limits_fees']), true);
    assert.equal(denied(['rates.read']), false);
    assert.equal(denied(['rates_management']), false);
    const source = readFileSync(join(OWNED_DIR, 'AutomaticRatesSection.tsx'), 'utf8');
    assert.match(source, /if \(failure\?\.status === 403\) \{\s*return \(\s*<div className=\{s\.page\}>\s*<AccessDenied required=\{\['rates\.read'\]\} \/>/);
    assert.match(source, /const canWrite = useCan\('rates\.write'\);/);
  });

  test('the Platform Settings page renders the section without being a client module', () => {
    const page = readFileSync(PAGE_FILE, 'utf8');
    assert.match(page, /^import AutomaticRatesSection from '\.\.\/\.\.\/automatic-rates\/AutomaticRatesSection';$/m);
    assert.match(page, /return <AutomaticRatesSection \/>;/);
    assert.doesNotMatch(page, /use client/);
  });
});

const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const harnessRef = `const harness = () => globalThis.${HARNESS_KEY};`;

const harness: Harness = {
  claims: OWNER,
  token: TOKEN,
  headers: {},
  rpcs: [],
  replies: new Map(),
  tables: {},
  inserts: [],
  async rpc(name, args) {
    harness.rpcs.push({ name, args });
    const reply = harness.replies.get(name);
    if (reply === undefined) throw new Error(`unexpected rpc ${name}`);
    const settled = typeof reply === 'function' ? reply((args ?? {}) as Record<string, unknown>) : reply;
    return { data: null, error: null, ...settled };
  },
  from(table) {
    const rows = harness.tables[table];
    if (!rows) throw new Error(`unexpected read of ${table}`);
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      range: (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null, count: rows.length }),
      insert: () => {
        harness.inserts.push(table);
        return Promise.resolve({ data: null, error: null });
      },
    };
    return chain;
  },
};
Reflect.set(globalThis, HARNESS_KEY, harness);

const FILE_STUBS: Readonly<Record<string, string>> = {
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: moduleUrl(`${harnessRef}
export const supabaseAdmin = { from: (table) => harness().from(table), rpc: (name, args) => harness().rpc(name, args) };`),
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
let edgeCalls: EdgeCall[] = [];
let edgeReply: EdgeReply = { status: 200, body: { success: true, code: 'status', providers: [] } };

function stubEdge(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    edgeCalls.push({
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
    });
    if (edgeReply === 'network') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(edgeReply.body), { status: edgeReply.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function reset(claims: Claims | null = OWNER): void {
  harness.claims = claims;
  harness.token = TOKEN;
  harness.headers = { 'x-request-id': REQUEST_ID, 'user-agent': USER_AGENT, 'x-forwarded-for': CLIENT_IP };
  harness.rpcs = [];
  harness.replies = new Map();
  harness.tables = {};
  harness.inserts = [];
  edgeCalls = [];
  edgeReply = { status: 200, body: { success: true, code: 'status', providers: [] } };
  process.env.SUPABASE_URL = EDGE_BASE;
  process.env.ADMIN_FUNCTION_SECRET = SECRET;
}

async function routeOf(path: string): Promise<Route> {
  return (await import(await bundle(join(ROUTES_DIR, path, 'route.ts')))) as Route;
}

async function send(handler: ((req: Request) => Promise<Response>) | undefined, body: unknown): Promise<Reply> {
  assert.ok(handler);
  const response = await handler(new Request('http://admin.test/api/automatic-rates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function read(handler: (() => Promise<Response>) | undefined): Promise<Reply> {
  assert.ok(handler);
  const response = await handler();
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function audited(extra: Record<string, unknown>): Record<string, unknown> {
  return { p_admin_id: ADMIN_ID, ...extra, p_ip: CLIENT_IP, p_user_agent: USER_AGENT, p_request_id: REQUEST_ID };
}

function rpcArgs(name: string): Record<string, unknown> {
  const calls = harness.rpcs.filter((call) => call.name === name);
  assert.equal(calls.length, 1, name);
  return calls[0].args as Record<string, unknown>;
}

const ACME = [{ id: 'acme', label: 'Acme Rates', missing_secrets: [] }];

describe('routes', () => {
  let statusRoute: Route;
  let providersRoute: Route;
  let settingsRoute: Route;
  let cardsRoute: Route;
  let runRoute: Route;

  before(async () => {
    statusRoute = (await import(await bundle(join(ROUTES_DIR, 'route.ts')))) as Route;
    providersRoute = await routeOf('providers');
    settingsRoute = await routeOf('settings');
    cardsRoute = await routeOf('cards');
    runRoute = await routeOf('run');
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

  describe('GET and PATCH /api/automatic-rates', () => {
    test('reading needs rates.read and answers the status from rate_sync_status', async () => {
      reset(null);
      assert.equal((await read(statusRoute.GET)).status, 401);
      reset(staff(['rates.write']));
      const denied = await read(statusRoute.GET);
      assert.equal(denied.status, 403);
      assert.deepEqual(denied.body.details, { required: ['rates.read'] });
      assert.equal(harness.rpcs.length, 0);
      reset(staff(['rates.read']));
      harness.replies.set('rate_sync_status', { data: statusBody() });
      const reply = await read(statusRoute.GET);
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body.automatic, statusBody());
      harness.replies.set('rate_sync_status', { error: { message: 'boom' } });
      const failed = await read(statusRoute.GET);
      assert.equal(failed.status, 500);
      assert.equal(failed.body.message, 'The automatic rate status could not be read.');
    });

    test('switching needs rates.write and a boolean body, before anything is called', async () => {
      reset(staff(['rates.read']));
      const denied = await send(statusRoute.PATCH, { enabled: false, expected: true });
      assert.equal(denied.status, 403);
      assert.deepEqual(denied.body.details, { required: ['rates.write'] });
      reset();
      for (const body of ['x', { enabled: 'yes', expected: true }, { enabled: true }]) {
        const reply = await send(statusRoute.PATCH, body);
        assert.equal(reply.status, 400);
        assert.equal(reply.body.message, 'Send enabled and expected as true or false.');
      }
      assert.equal(harness.rpcs.length, 0);
      assert.equal(edgeCalls.length, 0);
    });

    test('turning off never calls the edge function and works from a phone session', async () => {
      for (const claims of [OWNER, staff(['rates_management'], PHONE)]) {
        reset(claims);
        stubEdge();
        harness.replies.set('admin_rate_sync_settings_set', {
          data: { ok: true, changed: ['enabled'], repriced: 0, settings: { enabled: false, provider: 'acme', interval_minutes: 60, universal_markup_pct: 4 } },
        });
        harness.replies.set('rate_sync_status', { data: statusBody({ provider: 'acme' }) });
        const reply = await send(statusRoute.PATCH, { enabled: false, expected: true });
        assert.equal(reply.status, 200);
        assert.deepEqual(reply.body.changed, ['enabled']);
        assert.equal(reply.body.enabled, false);
        assert.deepEqual(rpcArgs('admin_rate_sync_settings_set'), audited({ p_changes: { enabled: false }, p_expected: { enabled: true } }));
        assert.equal(edgeCalls.length, 0);
      }
    });

    test('turning on is web only, needs a provider and checks the registry with the session bearer', async () => {
      reset(staff(['rates_management'], PHONE));
      let reply = await send(statusRoute.PATCH, { enabled: true, expected: false });
      assert.equal(reply.status, 403);
      assert.equal(reply.body.message, 'Automatic rates can only be turned on from the web console.');
      assert.equal(harness.rpcs.length, 0);

      reset();
      harness.replies.set('rate_sync_status', { data: statusBody() });
      reply = await send(statusRoute.PATCH, { enabled: true, expected: false });
      assert.equal(reply.status, 409);
      assert.equal(reply.body.message, 'Choose a rate provider first, so automatic rates were not turned on.');
      assert.equal(edgeCalls.length, 0);

      reset();
      harness.replies.set('rate_sync_status', { data: onBody() });
      reply = await send(statusRoute.PATCH, { enabled: true, expected: false });
      assert.equal(reply.status, 409);
      assert.equal(reply.body.message, 'Someone else turned automatic rates on after you loaded this page, so nothing was changed.');
      assert.deepEqual(reply.body.details, { reason: 'conflict', enabled: true });
      assert.equal(edgeCalls.length, 0);

      const refusals: Array<[EdgeReply, number, string]> = [
        [{ status: 200, body: { success: true, code: 'status', providers: [] } }, 409,
          'The rate provider “acme” is not set up on the server, so automatic rates were not turned on.'],
        [{ status: 200, body: { success: true, code: 'status', providers: [{ id: 'acme', label: 'Acme Rates', missing_secrets: ['ACME_API_KEY'] }] } }, 409,
          'The rate provider’s keys are not set on the server (ACME_API_KEY), so automatic rates were not turned on.'],
        ['network', 502, 'The rate service could not be reached, so automatic rates were not turned on. Try again in a few minutes.'],
        [{ status: 401, body: { code: 'not_authorized' } }, 502, 'Automatic rates are not set up on the server, so automatic rates were not turned on.'],
      ];
      for (const [answer, status, message] of refusals) {
        reset();
        stubEdge();
        edgeReply = answer;
        harness.replies.set('rate_sync_status', { data: statusBody({ provider: 'acme', linked_card_type_ids: [PHYSICAL] }) });
        reply = await send(statusRoute.PATCH, { enabled: true, expected: false });
        assert.equal(reply.status, status, message);
        assert.equal(reply.body.message, message);
        assert.equal(harness.rpcs.some((call) => call.name === 'admin_rate_sync_settings_set'), false);
        assert.equal(edgeCalls.length, 1);
        assert.equal(edgeCalls[0].url, `${EDGE_BASE}/functions/v1/sync-provider-rates`);
        assert.equal(edgeCalls[0].headers['x-admin-secret'], SECRET);
        assert.equal(edgeCalls[0].headers.Authorization, `Bearer ${TOKEN}`);
        assert.deepEqual(edgeCalls[0].body, { action: 'status' });
      }
    });

    test('turning on with a listed provider saves through SQL and answers the fresh status; SQL refusals keep their texts', async () => {
      const ready = () => {
        reset();
        stubEdge();
        edgeReply = { status: 200, body: { success: true, code: 'status', providers: ACME } };
        let reads = 0;
        harness.replies.set('rate_sync_status', () => {
          reads += 1;
          return { data: reads === 1 ? statusBody({ provider: 'acme', linked_card_type_ids: [PHYSICAL] }) : onBody() };
        });
      };
      ready();
      harness.replies.set('admin_rate_sync_settings_set', {
        data: { ok: true, changed: ['enabled'], repriced: 0, settings: { enabled: true, provider: 'acme', interval_minutes: 60, universal_markup_pct: 4 } },
      });
      let reply = await send(statusRoute.PATCH, { enabled: true, expected: false });
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body.automatic, onBody());
      assert.deepEqual(rpcArgs('admin_rate_sync_settings_set'), audited({ p_changes: { enabled: true }, p_expected: { enabled: false } }));

      const answers: Array<[DbReply, number, string]> = [
        [{ data: { ok: false, reason: 'no_links' } }, 409, 'Link at least one card type first, so automatic rates were not turned on.'],
        [{ data: { ok: false, reason: 'no_provider' } }, 409, 'Choose a rate provider first, so automatic rates were not turned on.'],
        [{ data: { ok: false, reason: 'conflict', conflicts: [{ key: 'enabled', current: true }], settings: { enabled: true } } }, 409,
          'Someone else turned automatic rates on after you loaded this page, so nothing was changed.'],
        [{ error: { message: 'Not authorized' } }, 403, 'You do not have permission to do this.'],
        [{ error: { message: 'canceling statement due to statement timeout' } }, 500,
          'The change could not be confirmed. Reload the page to check whether automatic rates are on before trying again.'],
        [{ data: { ok: 'maybe' } }, 500, 'The change could not be confirmed. Reload the page to check whether automatic rates are on before trying again.'],
      ];
      for (const [answer, status, message] of answers) {
        ready();
        harness.replies.set('admin_rate_sync_settings_set', answer);
        reply = await send(statusRoute.PATCH, { enabled: true, expected: false });
        assert.equal(reply.status, status, message);
        assert.equal(reply.body.message, message);
        if (status === 500) assert.deepEqual(reply.body.details, { outcome_unknown: true });
      }
    });
  });

  describe('GET /api/automatic-rates/providers', () => {
    test('lists the registry through the edge status action, for web sessions with rates.read', async () => {
      reset(staff(['rates.read']));
      stubEdge();
      edgeReply = { status: 200, body: { success: true, code: 'status', providers: ACME } };
      const reply = await read(providersRoute.GET);
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body.providers, ACME);
      assert.deepEqual(edgeCalls[0].body, { action: 'status' });
      assert.equal(edgeCalls[0].headers.Authorization, `Bearer ${TOKEN}`);

      reset(staff(['rates.read'], PHONE));
      stubEdge();
      const phone = await read(providersRoute.GET);
      assert.equal(phone.status, 403);
      assert.equal(phone.body.message, 'The rate service can only be checked from the web console.');
      assert.equal(edgeCalls.length, 0);

      reset();
      stubEdge();
      edgeReply = 'network';
      const down = await read(providersRoute.GET);
      assert.equal(down.status, 502);
      assert.equal(down.body.code, 'PROVIDER_ERROR');
      assert.equal(down.body.message, 'The rate service could not be reached. Try again in a few minutes.');

      reset();
      stubEdge();
      delete process.env.ADMIN_FUNCTION_SECRET;
      const unset = await read(providersRoute.GET);
      assert.equal(unset.status, 502);
      assert.equal(unset.body.message, 'Automatic rates are not set up on the server.');
      assert.equal(edgeCalls.length, 0);
    });
  });

  describe('the settings route', () => {
    test('GET answers the form contract from the status, with plain percentage text', async () => {
      harness.replies.set('rate_sync_status', { data: statusBody({ universal_markup_pct: -2.5 }) });
      const reply = await read(settingsRoute.GET);
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body.config, { rate_provider: '', interval_minutes: '60', universal_markup_pct: '-2.5' });
      reset();
      harness.replies.set('rate_sync_status', { data: statusBody({ interval_minutes: 45 }) });
      const broken = await read(settingsRoute.GET);
      assert.equal(broken.status, 500);
      assert.equal(broken.body.message, 'The automatic rate settings could not be read.');
    });

    test('PATCH maps the form strings to typed values, with an expected value for each', async () => {
      harness.replies.set('admin_rate_sync_settings_set', {
        data: { ok: true, changed: ['interval_minutes', 'universal_markup_pct'], repriced: 3, settings: { enabled: true, provider: 'acme', interval_minutes: 120, universal_markup_pct: -2.5 } },
      });
      const reply = await send(settingsRoute.PATCH, {
        changes: { interval_minutes: '120', universal_markup_pct: '-2.5' },
        expected: { interval_minutes: '60', universal_markup_pct: '4' },
      });
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body.config, { rate_provider: 'acme', interval_minutes: '120', universal_markup_pct: '-2.5' });
      assert.equal(reply.body.repriced, 3);
      assert.deepEqual(rpcArgs('admin_rate_sync_settings_set'), audited({
        p_changes: { interval_minutes: 120, universal_markup_pct: -2.5 },
        p_expected: { interval_minutes: 60, universal_markup_pct: 4 },
      }));
      assert.equal(edgeCalls.length, 0);
    });

    test('PATCH refuses bad bodies and values before SQL, and an empty provider is sent as null without the edge', async () => {
      const cases: Array<[unknown, string]> = [
        [{ changes: {} }, 'No changes were sent.'],
        [{ changes: { interval_minutes: '60' } }, 'expected must map each setting to the value you last saw.'],
        [{ changes: { interval_minutes: '60' }, expected: {} }, 'expected must map each setting to the value you last saw.'],
        [{ changes: { interval_minutes: '45' }, expected: { interval_minutes: '60' } }, 'Invalid value for interval_minutes'],
        [{ changes: { universal_markup_pct: '100.5' }, expected: { universal_markup_pct: '4' } }, 'Invalid value for universal_markup_pct'],
        [{ changes: { universal_markup_pct: '4.555' }, expected: { universal_markup_pct: '4' } }, 'Invalid value for universal_markup_pct'],
        [{ changes: { rate_provider: 'Acme' }, expected: { rate_provider: '' } }, 'Invalid value for rate_provider'],
        [{ changes: { universal_markup_naira: '50' }, expected: { universal_markup_naira: '0' } }, 'Invalid value for universal_markup_naira'],
        [{ changes: { enabled: 'true' }, expected: { enabled: 'false' } }, 'Invalid value for enabled'],
        [{ changes: { interval_minutes: '60' }, expected: { interval_minutes: 'x' } }, 'expected must map each setting to the value you last saw.'],
      ];
      for (const [body, message] of cases) {
        const reply = await send(settingsRoute.PATCH, body);
        assert.equal(reply.status, 400, JSON.stringify(body));
        assert.equal(reply.body.message, message);
      }
      assert.equal(harness.rpcs.length, 0);
      harness.replies.set('admin_rate_sync_settings_set', {
        data: { ok: true, changed: ['provider'], repriced: 0, settings: { enabled: false, provider: null, interval_minutes: 60, universal_markup_pct: 4 } },
      });
      const cleared = await send(settingsRoute.PATCH, { changes: { rate_provider: '' }, expected: { rate_provider: 'acme' } });
      assert.equal(cleared.status, 200);
      assert.deepEqual(rpcArgs('admin_rate_sync_settings_set').p_changes, { provider: null });
      assert.deepEqual(rpcArgs('admin_rate_sync_settings_set').p_expected, { provider: 'acme' });
      assert.equal(edgeCalls.length, 0);
    });

    test('a new provider must be in the registry, and a phone session cannot change it', async () => {
      reset(staff(['rates_management'], PHONE));
      let reply = await send(settingsRoute.PATCH, { changes: { rate_provider: 'acme' }, expected: { rate_provider: '' } });
      assert.equal(reply.status, 403);
      assert.equal(reply.body.message, 'The rate provider can only be changed from the web console.');
      reset();
      stubEdge();
      reply = await send(settingsRoute.PATCH, { changes: { rate_provider: 'acme' }, expected: { rate_provider: '' } });
      assert.equal(reply.status, 409);
      assert.equal(reply.body.message, 'The rate provider “acme” is not set up on the server, so nothing was saved.');
      assert.equal(harness.rpcs.length, 0);
      reset();
      stubEdge();
      edgeReply = 'network';
      reply = await send(settingsRoute.PATCH, { changes: { rate_provider: 'acme' }, expected: { rate_provider: '' } });
      assert.equal(reply.status, 502);
      assert.equal(reply.body.message, 'The rate service could not be reached, so the provider was not changed. Try again in a few minutes.');
      reset();
      stubEdge();
      edgeReply = { status: 200, body: { success: true, code: 'status', providers: [{ id: 'acme', label: 'Acme Rates', missing_secrets: ['ACME_API_KEY'] }] } };
      harness.replies.set('admin_rate_sync_settings_set', {
        data: { ok: true, changed: ['provider'], repriced: 0, settings: { enabled: false, provider: 'acme', interval_minutes: 60, universal_markup_pct: 4 } },
      });
      reply = await send(settingsRoute.PATCH, { changes: { rate_provider: 'acme' }, expected: { rate_provider: '' } });
      assert.equal(reply.status, 200);
      assert.deepEqual(rpcArgs('admin_rate_sync_settings_set').p_changes, { provider: 'acme' });
    });

    test('SQL refusals become a 409 conflict, the turn-off rule, an out-of-range rate or a named invalid key', async () => {
      const answers: Array<[DbReply, number, string]> = [
        [{ data: { ok: false, reason: 'conflict', conflicts: [{ key: 'interval_minutes', current: 30 }], settings: {} } }, 409,
          'These settings changed after you loaded them, so nothing was saved.'],
        [{ data: { ok: false, reason: 'turn_off_first' } }, 409, 'Turn off automatic rates before changing the rate provider, so nothing was saved.'],
        [{ data: { ok: false, reason: 'rate_out_of_range', range_label: '$25–$99', provider_rate: 0.04, rate_naira: 0, card_type_id: PHYSICAL } }, 409,
          'With that percentage, $25–$99 would pay ₦0.00 per unit, which is not a valid rate, so nothing was saved.'],
        [{ data: { ok: false, reason: 'invalid', key: 'provider' } }, 400, 'Invalid value for rate_provider'],
        [{ error: { message: 'Not authorized' } }, 403, 'You do not have permission to do this.'],
        [{ error: { message: 'deadlock detected' } }, 500, 'The settings could not be saved. Reload to check the live values before trying again.'],
      ];
      for (const [answer, status, message] of answers) {
        reset();
        harness.replies.set('admin_rate_sync_settings_set', answer);
        const reply = await send(settingsRoute.PATCH, { changes: { universal_markup_pct: '-90' }, expected: { universal_markup_pct: '4' } });
        assert.equal(reply.status, status, message);
        assert.equal(reply.body.message, message);
      }
      reset();
      harness.replies.set('admin_rate_sync_settings_set', { data: { ok: false, reason: 'conflict', conflicts: [{ key: 'provider', current: 'acme' }] } });
      const conflict = await send(settingsRoute.PATCH, { changes: { interval_minutes: '30' }, expected: { interval_minutes: '60' } });
      assert.deepEqual(conflict.body.details, { reason: 'conflict', conflicts: [{ key: 'rate_provider', current: 'acme' }] });
    });
  });

  describe('the cards route', () => {
    function treeTables(): void {
      harness.tables = {
        cards: [{ id: AMAZON, name: 'Amazon', logo_url: null, is_active: true, sort_order: 1 }],
        card_countries: [{ id: US, card_id: AMAZON, country_code: 'US', country_name: 'United States', currency_symbol: '$' }],
        card_types: [{ id: PHYSICAL, card_id: AMAZON, country_code: 'US', name: 'Physical', sort_order: 1 }],
        denominations: [{ id: D1, card_type_id: PHYSICAL, range_label: '$25–$99', min_value: 25, max_value: 99, rate_naira: 1248, is_active: true }],
      };
    }

    test('GET answers the shared rate tree beside the overview', async () => {
      treeTables();
      harness.replies.set('rate_sync_overview', { data: overview() });
      const reply = await read(cardsRoute.GET);
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body.automatic, overview());
      const cards = reply.body.cards as Array<Record<string, unknown>>;
      assert.deepEqual(cards.map((card) => card.name), ['Amazon']);
      assert.deepEqual(Object.keys(cards[0]), ['id', 'name', 'logo_url', 'is_active', 'countries', 'activeRates']);
      reset();
      treeTables();
      harness.replies.set('rate_sync_overview', { error: { message: 'boom' } });
      const failed = await read(cardsRoute.GET);
      assert.equal(failed.status, 500);
      assert.equal(failed.body.message, 'The card types and their links could not be loaded. Try again.');
    });

    test('links are checked, capped at 500 and saved through admin_save_rate_links with every refusal named', async () => {
      const change = { card_type_id: PHYSICAL.toUpperCase(), provider_ref: 'amz-us-phys', expected_ref: null };
      const bad: Array<[unknown, string]> = [
        [{ type: 'links', changes: [] }, 'No changes provided.'],
        [{ type: 'links', changes: Array.from({ length: 501 }, () => change) }, 'Save at most 500 links at a time.'],
        [{ type: 'links', changes: [{ ...change, card_type_id: 'x' }] }, 'Link 1 is not valid.'],
        [{ type: 'links', changes: [{ ...change, provider_ref: ' amz ' }] }, 'Link 1 is not valid.'],
        [{ type: 'links', changes: [change, change] }, `Card type ${PHYSICAL} appears more than once in this save.`],
        [{ type: 'nope' }, 'Invalid type. Use links or markup.'],
        ['x', 'Send the changes as a JSON object.'],
      ];
      for (const [body, message] of bad) {
        const reply = await send(cardsRoute.PATCH, body);
        assert.equal(reply.status, 400, message);
        assert.equal(reply.body.message, message);
      }
      assert.equal(harness.rpcs.length, 0);
      harness.replies.set('admin_save_rate_links', { data: { ok: true, saved: [PHYSICAL], unchanged: [] } });
      const saved = await send(cardsRoute.PATCH, { type: 'links', changes: [change] });
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.body.saved, [PHYSICAL]);
      assert.deepEqual(rpcArgs('admin_save_rate_links'), audited({
        p_changes: [{ card_type_id: PHYSICAL, provider_ref: 'amz-us-phys', expected_ref: null }],
      }));
      const answers: Array<[DbReply, number, string]> = [
        [{ data: { ok: false, reason: 'invalid', invalid: [{ index: 0, card_type_id: PHYSICAL, reason: 'unknown_product' }], conflicts: [] } }, 409,
          'That product is not in the latest product list. Load products again and choose it from the list.'],
        [{ data: { ok: false, reason: 'invalid', invalid: [{ index: 0, card_type_id: PHYSICAL, reason: 'type_inactive' }], conflicts: [] } }, 409,
          'That card type is switched off. Switch it on in Cards before linking it.'],
        [{ data: { ok: false, reason: 'invalid', invalid: [{ index: 0, card_type_id: PHYSICAL, reason: 'type_not_found' }], conflicts: [] } }, 404,
          'That card type no longer exists.'],
        [{ data: { ok: false, reason: 'invalid', invalid: [{ index: 0, card_type_id: PHYSICAL, reason: 'no_currency_symbol' }], conflicts: [] } }, 409,
          'That country has no currency symbol. Add one in Cards before linking.'],
        [{ data: { ok: false, reason: 'conflict', invalid: [], conflicts: [{ index: 0, card_type_id: PHYSICAL, current: 'other' }] } }, 409,
          'Someone else changed this link after you loaded the page, so nothing was saved.'],
        [{ data: { ok: false, reason: 'no_provider' } }, 409, 'Choose a rate provider first, so nothing was linked.'],
        [{ error: { message: 'Not authorized' } }, 403, 'You do not have permission to do this.'],
        [{ error: { message: 'boom' } }, 500, 'The link could not be confirmed. Reload the page to check it before trying again.'],
      ];
      for (const [answer, status, message] of answers) {
        reset();
        harness.replies.set('admin_save_rate_links', answer);
        const reply = await send(cardsRoute.PATCH, { type: 'links', changes: [change] });
        assert.equal(reply.status, status, message);
        assert.equal(reply.body.message, message);
      }
    });

    test('a card percentage is a signed 2-decimal string or null, saved through admin_set_card_rate_markup', async () => {
      for (const [body, message] of [
        [{ type: 'markup', card_id: 'x', markup_pct: '5', expected: null }, 'Choose a valid card.'],
        [{ type: 'markup', card_id: AMAZON, markup_pct: '100.5', expected: null }, 'Enter a percentage from −90% to 100% with at most 2 decimal places.'],
        [{ type: 'markup', card_id: AMAZON, markup_pct: '5', expected: 'x' }, 'expected must be the extra percentage you last saw.'],
        [{ type: 'markup', card_id: AMAZON, expected: null }, 'Enter a percentage from −90% to 100% with at most 2 decimal places.'],
      ] as Array<[unknown, string]>) {
        const reply = await send(cardsRoute.PATCH, body);
        assert.equal(reply.status, 400, message);
        assert.equal(reply.body.message, message);
      }
      harness.replies.set('admin_set_card_rate_markup', {
        data: { ok: true, changed: true, card_markup_pct: 5, effective_markup_pct: 5, repriced: 2 },
      });
      const saved = await send(cardsRoute.PATCH, { type: 'markup', card_id: AMAZON, markup_pct: '+5', expected: null });
      assert.equal(saved.status, 200);
      assert.deepEqual(
        { changed: saved.body.changed, own: saved.body.card_markup_pct, effective: saved.body.effective_markup_pct, repriced: saved.body.repriced },
        { changed: true, own: 5, effective: 5, repriced: 2 },
      );
      assert.deepEqual(rpcArgs('admin_set_card_rate_markup'), audited({ p_card_id: AMAZON, p_markup_pct: 5, p_expected: null }));
      reset();
      harness.replies.set('admin_set_card_rate_markup', { data: { ok: true, changed: true, card_markup_pct: null, effective_markup_pct: 4, repriced: 0 } });
      await send(cardsRoute.PATCH, { type: 'markup', card_id: AMAZON, markup_pct: null, expected: '-10' });
      assert.deepEqual(rpcArgs('admin_set_card_rate_markup'), audited({ p_card_id: AMAZON, p_markup_pct: null, p_expected: -10 }));
      const answers: Array<[DbReply, number, string]> = [
        [{ data: { ok: false, reason: 'rate_out_of_range', denomination_id: D1, card_type_id: PHYSICAL, range_label: '$100–$500', provider_rate: 60000, rate_naira: 120000 } }, 409,
          'With that percentage, $100–$500 would pay ₦120,000.00 per unit, which is not a valid rate, so nothing was saved.'],
        [{ data: { ok: false, reason: 'conflict', current: 7.5, effective: 7.5 } }, 409,
          'Someone else changed this card’s extra percentage after you loaded the page, so nothing was saved.'],
        [{ data: { ok: false, reason: 'card_not_found' } }, 404, 'That card no longer exists.'],
        [{ data: { ok: false, reason: 'invalid_percentage' } }, 400, 'Enter a percentage from −90% to 100% with at most 2 decimal places.'],
        [{ data: { ok: true, changed: true, card_markup_pct: '5', effective_markup_pct: 5, repriced: 0 } }, 500,
          'The extra percentage could not be confirmed. Reload the page to check it before trying again.'],
      ];
      for (const [answer, status, message] of answers) {
        reset();
        harness.replies.set('admin_set_card_rate_markup', answer);
        const reply = await send(cardsRoute.PATCH, { type: 'markup', card_id: AMAZON, markup_pct: '100', expected: null });
        assert.equal(reply.status, status, message);
        assert.equal(reply.body.message, message);
      }
    });
  });

  describe('POST /api/automatic-rates/run', () => {
    test('is web only, checks the body and the settings, then sends one call with the bearer and the request', async () => {
      reset(staff(['rates_management'], PHONE));
      let reply = await send(runRoute.POST, { action: 'run' });
      assert.equal(reply.status, 403);
      assert.equal(reply.body.message, 'Rates can only be updated from the web console.');
      reset(staff(['rates.read']));
      reply = await send(runRoute.POST, { action: 'run' });
      assert.equal(reply.status, 403);
      reset();
      reply = await send(runRoute.POST, { action: 'sync' });
      assert.equal(reply.status, 400);
      assert.equal(reply.body.message, 'Send action run or products.');
      delete process.env.SUPABASE_URL;
      reply = await send(runRoute.POST, { action: 'run' });
      assert.equal(reply.status, 502);
      assert.equal(reply.body.message, 'Updating rates is not set up on the server, so nothing was changed.');
      assert.equal(edgeCalls.length, 0);

      reset();
      stubEdge();
      harness.token = '';
      reply = await send(runRoute.POST, { action: 'run' });
      assert.equal(reply.status, 401);
      assert.equal(edgeCalls.length, 0);

      for (const action of ['run', 'products'] as const) {
        reset();
        stubEdge();
        edgeReply = action === 'run'
          ? { status: 200, body: { success: true, code: 'applied', run_id: RUN_ID, summary: SUMMARY } }
          : { status: 200, body: { success: true, code: 'products_loaded', run_id: RUN_ID, summary: { lines: 4, usable: 3 } } };
        reply = await send(runRoute.POST, { action, accept_large_moves: true });
        assert.equal(reply.status, 200);
        assert.equal(reply.body.mode, action === 'run' ? 'apply' : 'products');
        assert.equal(reply.body.run_id, RUN_ID);
        assert.equal(edgeCalls.length, 1);
        assert.equal(edgeCalls[0].headers.Authorization, `Bearer ${TOKEN}`);
        assert.equal(edgeCalls[0].headers['x-admin-secret'], SECRET);
        assert.deepEqual(edgeCalls[0].body, { action, ip: CLIENT_IP, user_agent: USER_AGENT, request_id: REQUEST_ID });
      }
      assert.equal(harness.rpcs.length, 0);
    });

    test('an edge refusal keeps its text and an unknown answer is reported as unknown', async () => {
      edgeReply = { status: 502, body: { success: false, code: 'provider_failed', error: 'rates 503', run_id: RUN_ID } };
      let reply = await send(runRoute.POST, { action: 'run' });
      assert.equal(reply.status, 502);
      assert.equal(reply.body.message, 'The rate provider could not be read (rates 503), so rates stay as they were. Try again in a few minutes.');
      edgeReply = 'network';
      reply = await send(runRoute.POST, { action: 'run' });
      assert.equal(reply.status, 500);
      assert.deepEqual(reply.body.details, { outcome_unknown: true });
    });
  });

  test('the route sources: exports, guards, timeouts and no console audit writes', () => {
    const files = readdirSync(ROUTES_DIR, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name === 'route.ts')
      .map((entry) => join(entry.parentPath, entry.name));
    assert.equal(files.length, 5);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /writeAudit|from\('audit_log'\)|\bfetch\(/, file);
    }
    const exportsOf = (path: string) => [...readFileSync(join(ROUTES_DIR, path, 'route.ts'), 'utf8').matchAll(/^export (?:async function|const) (\w+)/gm)]
      .map((match) => match[1]);
    assert.deepEqual(exportsOf(''), ['GET', 'PATCH']);
    assert.deepEqual(exportsOf('providers'), ['GET']);
    assert.deepEqual(exportsOf('settings'), ['GET', 'PATCH']);
    assert.deepEqual(exportsOf('cards'), ['GET', 'PATCH']);
    assert.deepEqual(exportsOf('run'), ['maxDuration', 'POST']);
    const run = readFileSync(join(ROUTES_DIR, 'run', 'route.ts'), 'utf8');
    assert.match(run, /^export const maxDuration = 60;$/m);
    const steps = ["requireAdmin('rates.write')", "admin.session.client !== 'web'", 'readRunAction(', 'edgeFunctionReady()', 'sessionTokenFromRequest()', 'callEdgeFunction('];
    const at = steps.map((step) => run.indexOf(step));
    assert.ok(at.every((index) => index > 0), JSON.stringify(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    assert.match(run, /\}, RUN_EDGE_TIMEOUT_MS, token\);/);
    assert.equal(rules.RUN_EDGE_TIMEOUT_MS, 50000);
    assert.equal(rules.RUN_REQUEST_TIMEOUT_MS, 65000);
    assert.equal(rules.STATUS_EDGE_TIMEOUT_MS, 15000);
    const sectionSource = readFileSync(join(OWNED_DIR, 'AutomaticRatesSection.tsx'), 'utf8');
    assert.equal((sectionSource.match(/timeoutMs: RUN_REQUEST_TIMEOUT_MS/g) ?? []).length, 2);
  });
});

describe('house rules for the automatic rates files', () => {
  const owned = () => [
    ...readdirSync(OWNED_DIR).map((name) => join(OWNED_DIR, name)),
    ...readdirSync(ROUTES_DIR, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)),
    PAGE_FILE,
    ...LIB_FILES,
    TEST_FILE,
  ];

  test('no prose comments, inline styles, literal colours or stacking orders', () => {
    for (const file of owned()) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, NO_COMMENTS, file);
      if (file.endsWith('.tsx')) assert.doesNotMatch(source, /style=\{/, file);
      if (file.endsWith('.css')) {
        assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|z-index|\[data-theme/i, file);
      }
    }
  });

  test('client modules say so, and the shared rules and model are pure', () => {
    for (const name of ['AutomaticRatesSection.tsx', 'AutomaticRatesParts.tsx', 'LinksCard.tsx', 'LinkModal.tsx', 'ExtraPercentageModal.tsx']) {
      assert.ok(readFileSync(join(OWNED_DIR, name), 'utf8').startsWith("'use client';"), name);
    }
    for (const name of ['rules.ts', 'model.ts']) {
      const source = readFileSync(join(OWNED_DIR, name), 'utf8');
      assert.doesNotMatch(source, /'use client'|from 'react'|lib\/(?:supabase|guard|jwt|session|rateSync|rateService)/, name);
    }
  });

  test('percentages, never naira amounts, are the extra: no formatNaira and no amount wording', () => {
    for (const file of readdirSync(OWNED_DIR).map((name) => join(OWNED_DIR, name))) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /formatNaira\(/, file);
      assert.doesNotMatch(source, /markup_naira|extra amount|every-card amount|ExtraAmount/i, file);
    }
    assert.ok(!existsSync(join(OWNED_DIR, 'ExtraAmountModal.tsx')));
  });
});
