import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { classesOf, loadAppModule, render, tagsOf, textOf, type Attrs } from './support/uiHarness.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type {
  SaveReceipt, SecretDraft, SettingsEdit, SettingsSnapshot,
} from '../app/(dashboard)/admin-settings/model.ts';
import type { SaveRequest, StoredSetting } from '../app/(dashboard)/admin-settings/rules.ts';
import type { PolicyChange, PolicyState } from '../app/(dashboard)/admin-settings/securityPolicy.ts';

type RulesModule = typeof import('../app/(dashboard)/admin-settings/rules.ts');
type ModelModule = typeof import('../app/(dashboard)/admin-settings/model.ts');
type ConfirmModule = typeof import('../app/(dashboard)/admin-settings/confirmOptions.tsx');
type PartsModule = typeof import('../app/(dashboard)/admin-settings/SettingsParts.tsx');
type PolicyModule = typeof import('../app/(dashboard)/admin-settings/securityPolicy.ts');
type PolicyCardModule = typeof import('../app/(dashboard)/admin-settings/SecurityPolicyCard.tsx');

let rules: RulesModule;
let model: ModelModule;
let dialogs: ConfirmModule;
let parts: PartsModule;
let policy: PolicyModule;
let policyCard: PolicyCardModule;

before(async () => {
  rules = await loadAppModule<RulesModule>('(dashboard)/admin-settings/rules.ts');
  model = await loadAppModule<ModelModule>('(dashboard)/admin-settings/model.ts');
  dialogs = await loadAppModule<ConfirmModule>('(dashboard)/admin-settings/confirmOptions.tsx');
  parts = await loadAppModule<PartsModule>('(dashboard)/admin-settings/SettingsParts.tsx');
  policy = await loadAppModule<PolicyModule>('(dashboard)/admin-settings/securityPolicy.ts');
  policyCard = await loadAppModule<PolicyCardModule>('(dashboard)/admin-settings/SecurityPolicyCard.tsx');
});

const OWNED_DIR = fileURLToPath(new URL('../app/(dashboard)/admin-settings/', import.meta.url));
const ROUTE_FILE = fileURLToPath(new URL('../app/api/admin-settings/route.ts', import.meta.url));
const PAGE_FILE = join(OWNED_DIR, 'page.tsx');

const PREVIOUS_ROUTE_KEYS = [
  'gateway_paystack_enabled', 'gateway_monnify_enabled', 'gateway_novac_enabled', 'active_payment_gateway',
  'bill_vtpass_enabled', 'bill_novac_enabled', 'active_bill_provider',
  'chatwoot_base_url', 'chatwoot_website_token', 'chatwoot_identity_key',
  'app_current_version', 'app_minimum_version', 'app_update_type', 'app_update_message',
  'emergency_mode', 'max_card_approval_naira', 'terms_url', 'privacy_url', 'store_url_android', 'store_url_ios',
];

const SECRET = 'hmac-Secret-Value-123';
const STAMP = '2026-10-01T09:00:00.000Z';
const NOW = new Date('2026-10-02T09:00:00.000Z');

const LIVE: Record<string, string> = {
  gateway_paystack_enabled: 'true',
  gateway_monnify_enabled: 'false',
  gateway_novac_enabled: 'true',
  active_payment_gateway: 'paystack',
  bill_vtpass_enabled: 'true',
  bill_novac_enabled: 'false',
  active_bill_provider: 'vtpass',
  chatwoot_base_url: 'https://app.chatwoot.com',
  chatwoot_website_token: 'AbC123xyz',
  chatwoot_identity_key: SECRET,
  app_current_version: '1.4.0',
  app_minimum_version: '1.2.0',
  app_update_type: 'soft',
  app_update_message: 'Please update',
  emergency_mode: 'false',
  max_card_approval_naira: '5000000',
  terms_url: 'https://cardelite.ng/terms',
  privacy_url: 'https://cardelite.ng/privacy',
  store_url_android: 'https://play.google.com/store/apps/details?id=com.cardelite.app',
  store_url_ios: 'https://apps.apple.com/app/id1',
};

const noop = () => {};

function without(values: Record<string, string>, ...keys: string[]): Record<string, string> {
  const copy = { ...values };
  for (const key of keys) delete copy[key];
  return copy;
}

function rows(values: Record<string, string>, publicKeys: readonly string[] = []): StoredSetting[] {
  return Object.entries(values).map(([key, value]) => ({
    key,
    value,
    is_public: key === 'chatwoot_identity_key' ? publicKeys.includes(key) : true,
    updated_at: STAMP,
  }));
}

function body(values: Record<string, string> = LIVE): Record<string, unknown> {
  return { success: true, request_id: 'req_test', ...rules.presentSettings(rows(values)) };
}

function snapshot(values: Record<string, string> = LIVE): SettingsSnapshot {
  const snap = model.toSnapshot(body(values));
  assert.ok(snap);
  return snap;
}

function editOf(
  patch: Record<string, string> = {},
  secret: SecretDraft = { mode: 'keep' },
  values: Record<string, string> = LIVE,
): SettingsEdit {
  const edit = model.startEdit(snapshot(values));
  return { ...edit, draft: { ...edit.draft, ...patch }, secret };
}

function request(changes: Record<string, unknown>, extra: Partial<SaveRequest> = {}): SaveRequest {
  return { changes, reason: null, expected: null, ...extra };
}

function plan(
  changes: Record<string, unknown>,
  current: Record<string, string> = LIVE,
  extra: Partial<SaveRequest> = {},
) {
  const result = rules.planSave(current, request(changes, extra));
  if (!result.ok) assert.fail(result.message);
  return result.plan;
}

function refusal(
  changes: Record<string, unknown>,
  current: Record<string, string> = LIVE,
  extra: Partial<SaveRequest> = {},
) {
  const result = rules.planSave(current, request(changes, extra));
  if (result.ok) assert.fail(`expected ${JSON.stringify(changes)} to be refused`);
  return result;
}

function failure(patch: Partial<ApiFailure>): ApiResult<SaveReceipt> {
  return {
    ok: false,
    error: {
      kind: 'http',
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Refused by the server.',
      requestId: null,
      details: null,
      outcomeUnknown: false,
      ...patch,
    },
  };
}

describe('GET contract', () => {
  test('manages exactly the keys the previous route accepted', () => {
    assert.deepEqual([...rules.SETTINGS_KEYS].sort(), [...PREVIOUS_ROUTE_KEYS].sort());
  });

  test('keeps every value the mobile app reads, but masks the secret', () => {
    const payload = rules.presentSettings(rows(LIVE));
    for (const key of PREVIOUS_ROUTE_KEYS) {
      if (key === 'chatwoot_identity_key') continue;
      assert.equal(payload.config[key], LIVE[key], key);
    }
    assert.equal(payload.config.chatwoot_identity_key, rules.SECRET_MASK);
    assert.deepEqual(payload.secrets.chatwoot_identity_key, { set: true, updated_at: STAMP, exposed: false });
    assert.equal(payload.config_updated_at.terms_url, STAMP);
    assert.ok(!JSON.stringify(payload).includes(SECRET));
  });

  test('reports a public secret row as exposed and an empty one as not set', () => {
    const exposed = rules.presentSettings(rows(LIVE, ['chatwoot_identity_key']));
    assert.equal(exposed.secrets.chatwoot_identity_key.exposed, true);
    const empty = rules.presentSettings(rows({ ...LIVE, chatwoot_identity_key: '  ' }, ['chatwoot_identity_key']));
    assert.equal(empty.config.chatwoot_identity_key, '');
    assert.deepEqual(empty.secrets.chatwoot_identity_key, { set: false, updated_at: STAMP, exposed: false });
    const missing = rules.presentSettings(rows(without(LIVE, 'chatwoot_identity_key')));
    assert.equal('chatwoot_identity_key' in missing.config, false);
    assert.deepEqual(missing.secrets.chatwoot_identity_key, { set: false, updated_at: null, exposed: false });
  });

  test('never leaks rows outside the managed keys', () => {
    const payload = rules.presentSettings([
      ...rows(LIVE),
      { key: 'paystack_secret_key', value: 'sk_live_x', is_public: false, updated_at: STAMP },
    ]);
    assert.equal('paystack_secret_key' in payload.config, false);
    assert.ok(!JSON.stringify(payload).includes('sk_live_x'));
  });

  test('the mask can never be stored as a real key', () => {
    assert.equal(rules.checkSettingValue('chatwoot_identity_key', rules.SECRET_MASK).ok, false);
    assert.equal(rules.isMaskEcho(` ${rules.SECRET_MASK} `), true);
    assert.equal(rules.isMaskEcho(SECRET), false);
  });
});

describe('PATCH accepts every request shape the mobile app sends', () => {
  test('a gateway toggle', () => {
    const result = plan({ gateway_monnify_enabled: 'true' });
    assert.deepEqual(result.updates, { gateway_monnify_enabled: 'true' });
    assert.equal(result.action, 'UPDATE_ADMIN_SETTINGS');
    assert.equal(result.sensitivity, 'financial');
    assert.equal(result.entityId, 'gateway_monnify_enabled');
  });

  test('the Live Chat save echoes the masked key, which keeps the stored key untouched', () => {
    const result = plan({
      chatwoot_base_url: LIVE.chatwoot_base_url,
      chatwoot_website_token: LIVE.chatwoot_website_token,
      chatwoot_identity_key: rules.SECRET_MASK,
    });
    assert.deepEqual(result.updates, {});
    assert.deepEqual(new Set(result.unchanged), new Set(['chatwoot_base_url', 'chatwoot_website_token', 'chatwoot_identity_key']));
    assert.deepEqual(result.secretUpdates, []);
  });

  test('clearing the key in the mobile field still clears it, and the audit says so without the value', () => {
    const result = plan({ chatwoot_identity_key: '' });
    assert.deepEqual(result.updates, { chatwoot_identity_key: '' });
    assert.deepEqual(result.before, { chatwoot_identity_key: '[set]' });
    assert.deepEqual(result.after, { chatwoot_identity_key: '[cleared]' });
    assert.deepEqual(result.secretUpdates, ['chatwoot_identity_key']);
    assert.equal(result.sensitivity, 'security');
  });

  test('the emergency toggle without a reason', () => {
    const parsed = rules.readSaveRequest({ changes: { emergency_mode: 'true' } });
    if (!parsed.ok) assert.fail(parsed.message);
    assert.equal(parsed.request.reason, null);
    const on = plan({ emergency_mode: 'true' });
    assert.equal(on.action, 'ENABLE_EMERGENCY_MODE');
    assert.equal(on.sensitivity, 'security');
    assert.equal(on.entityId, 'emergency_mode');
    assert.deepEqual(on.before, { emergency_mode: 'false' });
    assert.deepEqual(on.after, { emergency_mode: 'true' });
    const off = plan({ emergency_mode: 'false' }, { ...LIVE, emergency_mode: 'true' });
    assert.equal(off.action, 'DISABLE_EMERGENCY_MODE');
  });

  test('the version save re-sends unchanged values, which are skipped instead of rewritten', () => {
    const result = plan({
      app_current_version: '1.4.0', app_minimum_version: '1.2.0', app_update_type: 'soft', app_update_message: 'Please update',
    });
    assert.deepEqual(result.updates, {});
    assert.equal(result.unchanged.length, 4);
  });

  test('an unchanged legacy value is not re-validated, so the rest of the section can still be saved', () => {
    const legacy = { ...LIVE, app_current_version: 'v1.2', app_update_type: 'hard' };
    const result = plan({
      app_current_version: 'v1.2', app_minimum_version: '1.2.0', app_update_type: 'hard', app_update_message: 'New build',
    }, legacy);
    assert.deepEqual(result.updates, { app_update_message: 'New build' });
    assert.deepEqual(new Set(result.unchanged), new Set(['app_current_version', 'app_minimum_version', 'app_update_type']));
    refusal({ app_current_version: 'v1.3' }, legacy);
  });

  test('the approval limit as the mobile app formats it, and JSON booleans and numbers', () => {
    assert.deepEqual(plan({ max_card_approval_naira: '7500000' }).updates, { max_card_approval_naira: '7500000' });
    assert.deepEqual(plan({ max_card_approval_naira: 6000000 }).updates, { max_card_approval_naira: '6000000' });
    assert.deepEqual(plan({ gateway_monnify_enabled: true }).updates, { gateway_monnify_enabled: 'true' });
  });

  test('unknown keys are ignored as before; a request with none of ours is refused', () => {
    assert.deepEqual(plan({ terms_url: 'https://x.co/t', mystery: 'x' }).updates, { terms_url: 'https://x.co/t' });
    assert.equal(refusal({ mystery: 'x' }).message, 'Nothing to update.');
  });
});

describe('PATCH validation', () => {
  test('the primary gateway must be on, unless the same request turns it on', () => {
    assert.match(refusal({ active_payment_gateway: 'monnify' }).message, /Turn on Monnify/);
    assert.deepEqual(
      plan({ gateway_monnify_enabled: 'true', active_payment_gateway: 'monnify' }).updates,
      { gateway_monnify_enabled: 'true', active_payment_gateway: 'monnify' },
    );
  });

  test('the primary gateway cannot be turned off, even by a client that does not check', () => {
    assert.match(refusal({ gateway_paystack_enabled: 'false' }).message, /Paystack is the primary payout gateway/);
    assert.ok(plan({ active_payment_gateway: 'novac', gateway_paystack_enabled: 'false' }));
  });

  test('bill providers follow the same rules, and a missing primary means VTPass', () => {
    const current = without(LIVE, 'active_bill_provider');
    assert.match(refusal({ bill_vtpass_enabled: 'false' }, current).message, /VTPass is the primary bill provider/);
    assert.match(refusal({ active_bill_provider: 'novac' }).message, /Turn on Novac/);
  });

  test('unknown primaries and malformed switches are refused', () => {
    for (const changes of [
      { active_payment_gateway: 'stripe' },
      { active_payment_gateway: '' },
      { active_bill_provider: 'vtu' },
      { emergency_mode: 'yes' },
      { gateway_novac_enabled: 'on' },
      { gateway_novac_enabled: { value: true } },
    ]) {
      refusal(changes);
    }
  });

  test('the approval limit is whole naira within range', () => {
    for (const value of ['999', '1000000000001', '5000.5', '5e6', '-1000', '', '5,000,000']) {
      assert.match(refusal({ max_card_approval_naira: value }).message, /whole number of naira/, value);
    }
    assert.deepEqual(plan({ max_card_approval_naira: '1000' }).updates, { max_card_approval_naira: '1000' });
    assert.deepEqual(plan({ max_card_approval_naira: '1000000000000' }).updates, { max_card_approval_naira: '1000000000000' });
    assert.deepEqual(plan({ max_card_approval_naira: '0006000000' }).updates, { max_card_approval_naira: '6000000' });
  });

  test('URLs must be https, are trimmed, and may be cleared', () => {
    assert.match(refusal({ terms_url: 'http://cardelite.ng/terms' }).message, /Terms of Use URL must be a valid https:\/\/ URL/);
    assert.match(refusal({ privacy_url: 'https://x.co/\u200Bp' }).message, /Privacy Policy URL contains disallowed characters/);
    assert.deepEqual(plan({ terms_url: '  https://cardelite.ng/t  ' }).updates, { terms_url: 'https://cardelite.ng/t' });
    assert.deepEqual(plan({ privacy_url: '' }).updates, { privacy_url: '' });
  });

  test('tokens are a single value without spaces', () => {
    assert.match(refusal({ chatwoot_website_token: 'a b' }).message, /Website inbox token must be a single value/);
    refusal({ chatwoot_identity_key: 'x'.repeat(257) });
    refusal({ chatwoot_identity_key: `${rules.SECRET_MASK}x` });
  });

  test('versions must be numeric, and the minimum cannot pass the current version', () => {
    refusal({ app_current_version: 'v2' });
    refusal({ app_minimum_version: '1.0.0-beta' });
    assert.match(refusal({ app_minimum_version: '1.5.0' }).message, /cannot be above the current version \(1\.4\.0\)/);
    assert.match(refusal({ app_current_version: '1.1.9' }).message, /minimum app version \(1\.2\.0\)/);
    assert.ok(plan({ app_minimum_version: '1.5.0', app_current_version: '1.5.0' }));
    assert.deepEqual(plan({ app_minimum_version: '' }).updates, { app_minimum_version: '' });
  });

  test('update type and message', () => {
    refusal({ app_update_type: 'hard' });
    assert.deepEqual(plan({ app_update_type: 'FORCE' }).updates, { app_update_type: 'force' });
    refusal({ app_update_message: 'x'.repeat(501) });
    refusal({ app_update_message: 'line\nbreak' });
  });
});

describe('conflict detection', () => {
  test('a stale expected value is refused instead of silently overwritten', () => {
    const result = refusal(
      { active_payment_gateway: 'novac' },
      LIVE,
      { expected: { active_payment_gateway: 'monnify' } },
    );
    if (result.code !== 'STATE_CONFLICT') assert.fail(result.message);
    assert.deepEqual(result.conflicts, [
      { key: 'active_payment_gateway', label: 'Primary payout gateway', current: 'paystack' },
    ]);
  });

  test('expected values are compared the way the page normalises them', () => {
    const current = without(LIVE, 'gateway_monnify_enabled', 'active_payment_gateway', 'max_card_approval_naira');
    assert.ok(plan({ gateway_monnify_enabled: 'true' }, current, { expected: { gateway_monnify_enabled: 'false' } }));
    assert.ok(plan({ active_payment_gateway: 'novac' }, current, { expected: { active_payment_gateway: 'paystack' } }));
    assert.ok(plan({ max_card_approval_naira: '7000000' }, current, { expected: { max_card_approval_naira: '5000000' } }));
  });

  test('a secret conflict compares whether a key is stored, never the key itself', () => {
    assert.ok(plan(
      { chatwoot_identity_key: 'new-key' },
      LIVE,
      { expected: { chatwoot_identity_key: rules.SECRET_MASK } },
    ));
    const result = refusal({ chatwoot_identity_key: 'new-key' }, LIVE, { expected: { chatwoot_identity_key: '' } });
    if (result.code !== 'STATE_CONFLICT') assert.fail(result.message);
    assert.equal(result.conflicts[0].current, '[set]');
    assert.ok(!JSON.stringify(result).includes(SECRET));
  });

  test('values that are not changing never conflict', () => {
    assert.deepEqual(
      plan({ terms_url: LIVE.terms_url }, LIVE, { expected: { terms_url: 'https://old.example/terms' } }).updates,
      {},
    );
  });

  test('a conflict names the settings by label, for a stale plan and for a change the database caught', () => {
    assert.equal(
      rules.conflictMessage(['terms_url']),
      'Another admin changed Terms of Use URL after you loaded these settings, so nothing was saved. Reload to see the current values.',
    );
    assert.equal(
      rules.conflictMessage(['chatwoot_identity_key', 'privacy_url', 'emergency_mode']),
      'Another admin changed Identity validation key, Privacy Policy URL and Emergency mode after you loaded these settings, so nothing was saved. Reload to see the current values.',
    );
    const stale = refusal({ terms_url: 'https://a.co/t' }, LIVE, { expected: { terms_url: 'https://old.example/terms' } });
    assert.equal(stale.message, rules.conflictMessage(['terms_url']));
  });
});

describe('audit records', () => {
  test('a replaced, new or cleared key is recorded as a marker, never as its value', () => {
    const replaced = plan({ chatwoot_identity_key: 'brand-new-key' });
    assert.deepEqual(replaced.before, { chatwoot_identity_key: '[set]' });
    assert.deepEqual(replaced.after, { chatwoot_identity_key: '[replaced]' });
    const added = plan({ chatwoot_identity_key: 'brand-new-key' }, without(LIVE, 'chatwoot_identity_key'));
    assert.deepEqual(added.before, { chatwoot_identity_key: '[not set]' });
    assert.deepEqual(added.after, { chatwoot_identity_key: '[set]' });
    const audit = JSON.stringify({ before: replaced.before, after: replaced.after, added: [added.before, added.after] });
    assert.ok(!audit.includes('brand-new-key'));
    assert.ok(!audit.includes(SECRET));
  });

  test('sensitivity follows the most sensitive key, and the entity names a single key', () => {
    assert.equal(rules.sensitivityFor(['terms_url']), 'normal');
    assert.equal(rules.sensitivityFor(['terms_url', 'max_card_approval_naira']), 'financial');
    assert.equal(rules.sensitivityFor(['active_bill_provider', 'chatwoot_identity_key']), 'security');
    assert.equal(rules.sensitivityFor(['emergency_mode']), 'security');
    assert.equal(plan({ terms_url: 'https://a.co/t', privacy_url: 'https://a.co/p' }).entityId, 'batch');
  });
});

describe('request parsing', () => {
  test('reads changes, trims the reason and keeps only known expected keys', () => {
    const parsed = rules.readSaveRequest({
      changes: { terms_url: 'https://x.co' },
      reason: '  Rotating links  ',
      expected: { terms_url: 'https://old.co', junk: 'y', gateway_novac_enabled: true },
    });
    if (!parsed.ok) assert.fail(parsed.message);
    assert.equal(parsed.request.reason, 'Rotating links');
    assert.deepEqual(parsed.request.expected, { terms_url: 'https://old.co', gateway_novac_enabled: 'true' });
    const blank = rules.readSaveRequest({ changes: {}, reason: '   ' });
    if (!blank.ok) assert.fail(blank.message);
    assert.equal(blank.request.reason, null);
  });

  test('refuses a missing changes object, a non-text reason and an over-long reason', () => {
    for (const input of [
      null,
      {},
      { changes: [] },
      { changes: 'x' },
      { changes: {}, reason: 5 },
      { changes: {}, reason: 'x'.repeat(501) },
      { changes: {}, expected: 'x' },
      { changes: {}, expected: { terms_url: { nested: true } } },
    ]) {
      assert.equal(rules.readSaveRequest(input).ok, false, JSON.stringify(input));
    }
  });
});

describe('page model', () => {
  test('the page manages every setting: staged fields, the secret field and the kill switch', () => {
    const staged = model.SECTIONS.flatMap((section) => section.fields.map((field) => field.key));
    assert.equal(new Set(staged).size, staged.length);
    assert.deepEqual(new Set([...staged, rules.IDENTITY_KEY, rules.EMERGENCY_KEY]), new Set(rules.SETTINGS_KEYS));
    assert.equal(staged.includes(rules.EMERGENCY_KEY), false);
    assert.equal(staged.includes(rules.IDENTITY_KEY), false);
  });

  test('a snapshot never holds the secret', () => {
    const snap = snapshot();
    assert.equal(snap.values.chatwoot_identity_key, rules.SECRET_MASK);
    assert.deepEqual(snap.identity, { set: true, updatedAt: STAMP, exposed: false });
    assert.ok(!JSON.stringify(snap).includes(SECRET));
    assert.equal(model.toSnapshot({ success: true }), null);
  });

  test('missing rows read as the values the platform actually uses', () => {
    const snap = snapshot(without(
      LIVE, 'active_payment_gateway', 'active_bill_provider', 'max_card_approval_naira', 'app_update_type',
      'gateway_monnify_enabled',
    ));
    assert.equal(snap.values.active_payment_gateway, 'paystack');
    assert.equal(snap.values.active_bill_provider, 'vtpass');
    assert.equal(snap.values.max_card_approval_naira, '5000000');
    assert.equal(snap.values.app_update_type, 'soft');
    assert.equal(snap.values.gateway_monnify_enabled, 'false');
    assert.equal(snap.raw.gateway_monnify_enabled, undefined);
  });

  test('field validation matches the server', () => {
    assert.match(model.editErrors(editOf({ terms_url: 'http://insecure.example' })).terms_url, /https/);
    assert.match(model.editErrors(editOf({ active_payment_gateway: 'monnify' })).active_payment_gateway, /Turn on Monnify/);
    assert.match(
      model.editErrors(editOf({ gateway_paystack_enabled: 'false' })).gateway_paystack_enabled,
      /primary payout gateway/,
    );
    assert.match(model.editErrors(editOf({ app_minimum_version: '2.0.0' })).app_minimum_version, /cannot be above/);
    assert.ok(model.editErrors(editOf({ max_card_approval_naira: '999' })).max_card_approval_naira);
    assert.deepEqual(model.editErrors(editOf({ terms_url: 'https://cardelite.ng/new-terms' })), {});
    assert.equal(model.firstInvalidKey({ terms_url: 'x', active_payment_gateway: 'y' }), 'active_payment_gateway');
    assert.equal(model.firstInvalidKey({ privacy_url: 'x', chatwoot_identity_key: 'y' }), 'chatwoot_identity_key');
  });

  test('a staged edit sends only its changes, with the values it was based on', () => {
    const edit = editOf({ active_payment_gateway: 'novac', terms_url: 'https://cardelite.ng/t2' });
    assert.equal(model.pendingCount(edit), 2);
    assert.deepEqual(model.savePayload(edit, '  Moving payouts  '), {
      changes: { active_payment_gateway: 'novac', terms_url: 'https://cardelite.ng/t2' },
      expected: { active_payment_gateway: 'paystack', terms_url: LIVE.terms_url },
      reason: 'Moving payouts',
    });
    assert.deepEqual(model.savePayload(model.startEdit(snapshot())), { changes: {}, expected: {} });
    assert.equal(model.involvesMoney(edit), true);
    assert.equal(model.involvesMoney(editOf({ terms_url: 'https://cardelite.ng/t2' })), false);
  });

  test('a replaced key is sent once, and only its stored state is expected', () => {
    const edit = editOf({}, { mode: 'replace', value: '  k-2  ' });
    assert.equal(model.isEditDirty(edit), true);
    assert.deepEqual(model.savePayload(edit), {
      changes: { chatwoot_identity_key: 'k-2' },
      expected: { chatwoot_identity_key: rules.SECRET_MASK },
    });
    assert.deepEqual(model.savePayload(editOf({}, { mode: 'clear' })).changes, { chatwoot_identity_key: '' });
    assert.equal(model.isEditDirty(editOf({}, { mode: 'clear' }, without(LIVE, 'chatwoot_identity_key'))), false);
  });

  test('a key being replaced must be entered and valid', () => {
    assert.match(model.secretProblem({ mode: 'replace', value: '  ' }) ?? '', /Enter the new key/);
    assert.match(model.secretProblem({ mode: 'replace', value: 'a b' }) ?? '', /single value/);
    assert.equal(model.secretProblem({ mode: 'replace', value: 'ok-key' }), null);
    assert.equal(model.secretProblem({ mode: 'keep' }), null);
    assert.ok(model.editErrors(editOf({}, { mode: 'replace', value: '' })).chatwoot_identity_key);
  });

  test('review rows show before and after in field order, and hide the key', () => {
    const rowsShown = model.reviewRows(editOf(
      { max_card_approval_naira: '7500000', terms_url: '' },
      { mode: 'replace', value: 'k-2' },
    ));
    assert.deepEqual(rowsShown.map((row) => row.key), ['max_card_approval_naira', 'chatwoot_identity_key', 'terms_url']);
    assert.deepEqual(rowsShown[0], {
      key: 'max_card_approval_naira',
      label: 'Card approval limit',
      from: '₦5,000,000.00',
      to: '₦7,500,000.00',
      fromMissing: false,
      toMissing: false,
      mono: false,
    });
    assert.equal(rowsShown[1].from, 'Stored');
    assert.equal(rowsShown[1].to, 'New key');
    assert.equal(rowsShown[2].to, 'Not set');
    assert.equal(rowsShown[2].toMissing, true);
    assert.ok(!JSON.stringify(rowsShown).includes('k-2'));
  });

  test('rebasing keeps my edits, adopts other live changes and reports collisions', () => {
    const mine = editOf({ terms_url: 'https://cardelite.ng/terms-a' });
    const latest = snapshot({
      ...LIVE, terms_url: 'https://cardelite.ng/terms-b', privacy_url: 'https://cardelite.ng/privacy-c',
    });
    const rebased = model.rebaseEdit(mine, latest);
    assert.equal(rebased.edit.draft.terms_url, 'https://cardelite.ng/terms-a');
    assert.equal(rebased.edit.draft.privacy_url, 'https://cardelite.ng/privacy-c');
    assert.equal(rebased.edit.base, latest);
    assert.equal(rebased.dirty, true);
    assert.equal(rebased.conflicts.length, 1);
    assert.match(rebased.conflicts[0], /Terms of Use URL to https:\/\/cardelite\.ng\/terms-b/);
  });

  test('rebasing drops a removal that already happened and flags a key that moved', () => {
    const removed = model.rebaseEdit(editOf({}, { mode: 'clear' }), snapshot(without(LIVE, 'chatwoot_identity_key')));
    assert.equal(removed.edit.secret.mode, 'keep');
    assert.equal(removed.dirty, false);
    const moved: SettingsSnapshot = {
      ...snapshot(),
      identity: { set: true, updatedAt: '2026-10-02T08:00:00.000Z', exposed: false },
    };
    const replaced = model.rebaseEdit(editOf({}, { mode: 'replace', value: 'k-3' }), moved);
    assert.equal(replaced.dirty, true);
    assert.match(replaced.conflicts.join(' '), /identity validation key/);
  });

  test('every outcome the dialogs handle is classified', () => {
    const receipt: SaveReceipt = { changed: ['terms_url'], unchanged: [], auditRecorded: true, warning: null };
    assert.deepEqual(model.classifySave({ ok: true, data: receipt, status: 200, requestId: 'req_1' }), { kind: 'done', receipt });
    assert.equal(model.classifySave(failure({ status: 401, code: 'AUTH_REQUIRED' })).kind, 'expired');
    assert.equal(model.classifySave(failure({ status: 403, code: 'PERMISSION_DENIED' })).kind, 'denied');
    assert.deepEqual(
      model.classifySave(failure({
        status: 409,
        code: 'STATE_CONFLICT',
        details: { conflicts: [{ key: 'terms_url', label: 'Terms of Use URL', current: 'x' }] },
      })),
      { kind: 'conflict', message: 'Refused by the server.', keys: ['terms_url'] },
    );
    assert.equal(model.classifySave(failure({ kind: 'network', status: null, code: null, outcomeUnknown: true })).kind, 'unknown');
    assert.equal(model.classifySave(failure({ status: 500, code: null, outcomeUnknown: true })).kind, 'unknown');
    assert.equal(model.classifySave(failure({ status: 500, code: 'INTERNAL_ERROR' })).kind, 'refused');
    assert.equal(model.classifySave(failure({})).kind, 'refused');
  });

  test('the save receipt tolerates older bodies and counts what changed', () => {
    assert.deepEqual(model.toSaveReceipt({ success: true }), {
      changed: null, unchanged: [], auditRecorded: true, warning: null,
    });
    const receipt = model.toSaveReceipt({ success: true, changed: [], unchanged: ['terms_url'], audit_recorded: false, warning: 'w' });
    assert.ok(receipt);
    assert.equal(receipt.auditRecorded, false);
    assert.equal(model.savedMessage(receipt, 1), 'Nothing needed to change. These values were already live.');
    assert.equal(model.savedMessage({ ...receipt, changed: ['a', 'b'] }, 2), 'Saved. 2 changes are now live.');
    assert.equal(model.savedMessage({ ...receipt, changed: null }, 1), 'Saved. 1 change is now live.');
  });

  test('consequences spell out what changes for users', () => {
    const notes = (patch: Record<string, string>, secret: SecretDraft = { mode: 'keep' }) =>
      model.reviewConsequences(editOf(patch, secret)).join(' ');
    assert.match(notes({ active_payment_gateway: 'novac' }), /sent through Novac instead of Paystack/);
    assert.match(notes({ max_card_approval_naira: '7500000' }), /up to ₦7,500,000\.00, up from ₦5,000,000\.00/);
    assert.match(notes({ max_card_approval_naira: '1000000' }), /more than ₦1,000,000\.00 now need a super admin/);
    assert.match(notes({ app_minimum_version: '1.3.0' }), /below version 1\.3\.0 cannot use the app/);
    assert.match(notes({ app_update_type: 'force' }), /below version 1\.4\.0 cannot use the app until they update/);
    assert.match(notes({ app_current_version: '1.5.0' }), /Make sure 1\.5\.0 is live in both stores/);
    assert.match(notes({ chatwoot_base_url: '' }), /Live chat stops working/);
    assert.match(notes({ gateway_novac_enabled: 'false' }), /Novac can no longer be chosen/);
    assert.match(notes({}, { mode: 'replace', value: 'k' }), /verified with the new key/);
    assert.match(notes({}, { mode: 'clear' }), /no longer verified/);
  });

  test('live notices explain payouts that fall back and bills that are refused', () => {
    const fallback = model.payoutNotice(snapshot({ ...LIVE, active_payment_gateway: 'monnify' }));
    assert.equal(fallback?.title, 'Payouts are going through Paystack');
    assert.match(fallback?.message ?? '', /Monnify is the primary gateway but is turned off/);
    assert.equal(model.payoutNotice(snapshot()), null);
    const refused = model.billNotice(snapshot({ ...LIVE, bill_vtpass_enabled: 'false' }));
    assert.equal(refused?.tone, 'danger');
    assert.equal(model.billNotice(snapshot(without(LIVE, 'bill_vtpass_enabled'))), null);
    assert.equal(model.billNotice(snapshot({ ...LIVE, active_bill_provider: 'novac' }))?.title, 'Bills are going through VTPass');
  });

  test('a save that could not be reloaded is applied locally without storing the key', () => {
    const next = model.applySaved(
      snapshot(),
      { changes: { chatwoot_identity_key: 'k-9', terms_url: 'https://n.co/t', gateway_monnify_enabled: 'true' }, expected: {} },
      '2026-10-02T09:30:00.000Z',
    );
    assert.equal(next.values.chatwoot_identity_key, rules.SECRET_MASK);
    assert.deepEqual(next.identity, { set: true, updatedAt: '2026-10-02T09:30:00.000Z', exposed: false });
    assert.equal(next.values.terms_url, 'https://n.co/t');
    assert.equal(next.values.gateway_monnify_enabled, 'true');
    assert.ok(!JSON.stringify(next).includes('k-9'));
  });

  test('the emergency payload expects the opposite state', () => {
    assert.deepEqual(model.emergencyPayload(true, '  Provider outage  '), {
      changes: { emergency_mode: 'true' },
      expected: { emergency_mode: 'false' },
      reason: 'Provider outage',
    });
    assert.deepEqual(model.emergencyPayload(false, ''), {
      changes: { emergency_mode: 'false' },
      expected: { emergency_mode: 'true' },
    });
    assert.deepEqual(model.emergencyState(snapshot({ ...LIVE, emergency_mode: 'true' })), { on: true, since: STAMP });
  });
});

describe('confirmation dialogs', () => {
  test('the kill switch needs the exact phrase and a reason, and spells out what stops', () => {
    const on = dialogs.emergencyOptions(true, STAMP, NOW);
    assert.equal(on.tone, 'danger');
    assert.equal(on.requireTyped, 'turn on emergency mode');
    assert.equal(on.reason?.required, true);
    const consequences = (on.consequences ?? []).join(' ');
    assert.match(consequences, /Under Maintenance/);
    assert.match(consequences, /withdrawal requests and bill payments .* are refused/);
    assert.match(consequences, /are paused: none can be approved/);
    assert.equal(on.details?.[0].label, 'Emergency mode');
    assert.equal(textOf(render(createElement('div', null, on.details?.[0].value))), 'From Off → to On');
    const off = dialogs.emergencyOptions(false, STAMP, NOW);
    assert.equal(off.tone, 'danger');
    assert.equal(off.requireTyped, 'turn off emergency mode');
    assert.equal(off.reason?.required, true);
    assert.match((off.consequences ?? []).join(' '), /accepted again/);
  });

  test('the review dialog lists every change before and after', () => {
    const edit = editOf({ max_card_approval_naira: '7500000', terms_url: 'https://cardelite.ng/t2' });
    const options = dialogs.reviewOptions({
      rows: model.reviewRows(edit),
      consequences: model.reviewConsequences(edit),
      conflicts: ['Someone else changed Terms of Use URL.'],
      money: model.involvesMoney(edit),
    });
    assert.equal(options.tone, 'financial');
    assert.equal(options.title, 'Apply 2 changes to Admin Settings?');
    assert.deepEqual(options.details?.map((detail) => detail.label), ['Card approval limit', 'Terms of Use URL']);
    assert.equal(options.consequences?.[0], 'Someone else changed Terms of Use URL.');
    assert.equal(options.reason?.required, undefined);
    assert.equal(
      textOf(render(createElement('div', null, options.details?.[1].value))),
      `From ${LIVE.terms_url} → to https://cardelite.ng/t2`,
    );
    const plain = dialogs.reviewOptions({ rows: model.reviewRows(editOf({ terms_url: '' })), consequences: [], conflicts: [], money: false });
    assert.equal(plain.tone, 'danger');
    assert.equal(plain.consequences, undefined);
    assert.equal(plain.confirmLabel, 'Apply change');
  });

  test('discard and leave dialogs count the unsaved changes', () => {
    assert.equal(dialogs.discardOptions(1).title, 'Discard 1 unsaved change?');
    assert.equal(dialogs.discardOptions(3).title, 'Discard 3 unsaved changes?');
    assert.match(String(dialogs.leaveOptions(2).message), /2 unsaved changes/);
  });
});

describe('rendered parts', () => {
  const identity = { set: true, updatedAt: STAMP, exposed: false };
  const handlers = { onReplace: noop, onRemove: noop, onCancel: noop, onValue: noop, onBlur: noop };

  test('the secret field shows whether a key is stored, never the key', () => {
    const html = render(createElement(parts.SecretField, { id: 'idk', identity, draft: { mode: 'keep' }, ...handlers }));
    const text = textOf(html);
    assert.match(text, /Stored/);
    assert.match(text, /Replace/);
    assert.match(text, /Remove/);
    assert.equal(tagsOf(html, 'input').length, 0);
    assert.ok(!html.includes(rules.SECRET_MASK));
    const empty = textOf(render(createElement(parts.SecretField, {
      id: 'idk', identity: { set: false, updatedAt: null, exposed: false }, draft: { mode: 'keep' }, ...handlers,
    })));
    assert.match(empty, /Not set/);
    assert.match(empty, /Add key/);
  });

  test('replacing a key uses a password field, and an exposed key is called out', () => {
    const html = render(createElement(parts.SecretField, {
      id: 'idk', identity: { ...identity, exposed: true }, draft: { mode: 'replace', value: 'typed' }, ...handlers,
    }));
    const input = tagsOf(html, 'input').find((attrs) => attrs.id === 'idk');
    assert.equal(input?.type, 'password');
    assert.equal(input?.autoComplete, 'new-password');
    assert.match(textOf(html), /readable by the user app/);
    const removing = textOf(render(createElement(parts.SecretField, { id: 'idk', identity, draft: { mode: 'clear' }, ...handlers })));
    assert.match(removing, /Removed when you apply/);
    assert.match(removing, /Undo/);
  });

  test('the emergency card shows its state and the matching action', () => {
    const on = textOf(render(createElement(parts.EmergencyCard, {
      state: { on: true, since: STAMP }, headingId: 'em', busy: false, disabled: false, buttonRef: null, onToggle: noop,
    })));
    assert.match(on, /Emergency mode is on/);
    assert.match(on, /Turn off emergency mode…/);
    const off = textOf(render(createElement(parts.EmergencyCard, {
      state: { on: false, since: STAMP }, headingId: 'em', busy: false, disabled: false, buttonRef: null, onToggle: noop,
    })));
    assert.doesNotMatch(off, /Emergency mode is on/);
    assert.match(off, /Turn on emergency mode…/);
  });

  test('the provider card keeps the primary on and only offers providers that are on', () => {
    const html = render(createElement(parts.ProviderCard, {
      section: model.sectionById('payouts'),
      headingId: 'pg',
      primaryKey: 'active_payment_gateway',
      providers: [
        { value: 'paystack', label: 'Paystack', flagKey: 'gateway_paystack_enabled' },
        { value: 'monnify', label: 'Monnify', flagKey: 'gateway_monnify_enabled' },
        { value: 'novac', label: 'Novac', flagKey: 'gateway_novac_enabled' },
      ],
      noun: 'gateway',
      values: snapshot().values,
      errors: {},
      modified: new Set<string>(['gateway_novac_enabled']),
      notice: null,
      fieldId: (key: string) => `f-${key}`,
      onChange: noop,
      onBlur: noop,
    }));
    const inputs = tagsOf(html, 'input');
    const paystack = inputs.find((attrs) => attrs.id === 'f-gateway_paystack_enabled');
    const novac = inputs.find((attrs) => attrs.id === 'f-gateway_novac_enabled');
    const monnifyRadio = inputs.find((attrs) => attrs.type === 'radio' && attrs.value === 'monnify');
    const novacRadio = inputs.find((attrs) => attrs.type === 'radio' && attrs.value === 'novac');
    assert.ok(paystack && 'disabled' in paystack);
    assert.ok(novac && !('disabled' in novac));
    assert.ok(monnifyRadio && 'disabled' in monnifyRadio);
    assert.ok(novacRadio && !('disabled' in novacRadio));
    assert.match(textOf(html), /Unsaved/);
  });
});

const POLICY_NOW = new Date('2026-10-13T09:00:00.000Z');
const ADA_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const OPS_ID = '22222222-3333-4444-8555-666666666666';
const GRACE_BODY = { mfa_mode: 'all', mfa_grace_ends_at: '2026-10-27T09:05:00.000Z' };
const REQUIRED_BODY = { mfa_mode: 'all', mfa_grace_ends_at: '2026-10-01T09:00:00.000Z', mfa_required_now: true };

function policyBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    success: true,
    request_id: 'req_policy',
    mfa_mode: 'off',
    mfa_grace_ends_at: null,
    mfa_required_now: false,
    updated_at: null,
    updated_by: null,
    key_configured: true,
    actor_mfa_status: 'active',
    roster: { active: 2, enrolled: 1, missing: [{ id: OPS_ID.toUpperCase(), username: 'ops.lead' }] },
    ...patch,
  };
}

function policyState(patch: Record<string, unknown> = {}): PolicyState {
  const state = policy.toPolicyState(policyBody(patch));
  assert.ok(state);
  return state;
}

function buttonByText(html: string, label: string): Attrs | undefined {
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (textOf(match[2]) === label) return tagsOf(`<button${match[1]}>`, 'button')[0];
  }
  return undefined;
}

function hrefs(html: string): string[] {
  return tagsOf(html, 'a').map((attrs) => (attrs.href ?? '').replace(/&amp;/g, '&'));
}

describe('two-step requirement model', () => {
  test('reads the policy, the server key, the acting admin and the roster', () => {
    assert.deepEqual(policyState({ updated_by: ADA_ID.toUpperCase(), updated_at: '2026-10-12T09:00:00.000Z' }), {
      mode: 'off',
      graceEndsAt: null,
      requiredNow: false,
      updatedAt: '2026-10-12T09:00:00.000Z',
      updatedBy: ADA_ID,
      keyConfigured: true,
      actorTwoStep: 'active',
      roster: { active: 2, enrolled: 1, missing: [{ id: OPS_ID, username: 'ops.lead' }] },
    });
    assert.equal(policy.toPolicyState(policyBody({ mfa_mode: 'some' })), null);
    assert.equal(policy.toPolicyState(policyBody({ roster: null })), null);
    const odd = policyState({
      actor_mfa_status: 'weird', key_configured: 'yes', roster: { active: '2', enrolled: -1, missing: [{ id: 'nope' }, null] },
    });
    assert.equal(odd.actorTwoStep, 'none');
    assert.equal(odd.keyConfigured, false);
    assert.deepEqual(odd.roster, { active: 0, enrolled: 0, missing: [] });
    assert.equal(policyState({ mfa_grace_ends_at: '2026-10-27T09:05:00.000Z' }).graceEndsAt, null);
  });

  test('the view shows not required, required from a date or required, and the one action that applies', () => {
    assert.deepEqual(policy.policyView(policyState(), POLICY_NOW), {
      phase: 'off',
      statusLabel: 'Not required',
      statusTone: 'neutral',
      grace: null,
      action: 'on',
      actionLabel: 'Require for all admins…',
      blocker: null,
    });
    const grace = policy.policyView(policyState(GRACE_BODY), POLICY_NOW);
    assert.deepEqual([grace.phase, grace.statusLabel, grace.statusTone], ['grace', 'Required from 27 Oct', 'warning']);
    assert.deepEqual([grace.action, grace.actionLabel], ['off', 'Stop requiring it…']);
    assert.equal(grace.grace?.dateTime, '27 Oct 2026, 10:05 WAT');
    const required = policy.policyView(policyState(REQUIRED_BODY), POLICY_NOW);
    assert.deepEqual([required.phase, required.statusLabel, required.statusTone], ['required', 'Required', 'success']);
    assert.equal(policy.policyView(policyState(GRACE_BODY), new Date('2026-10-28T00:00:00.000Z')).phase, 'required');
  });

  test('a change waits for the acting admin’s own two-step sign-in and, to turn it on, the server key', () => {
    assert.equal(policy.policyView(policyState({ actor_mfa_status: 'none' }), POLICY_NOW).blocker, 'two_step');
    assert.equal(policy.policyView(policyState({ actor_mfa_status: 'pending' }), POLICY_NOW).blocker, 'two_step');
    assert.equal(policy.policyView(policyState({ key_configured: false }), POLICY_NOW).blocker, 'key');
    assert.equal(policy.policyView(policyState({ ...GRACE_BODY, key_configured: false }), POLICY_NOW).blocker, null);
    assert.equal(policy.policyView(policyState({ ...GRACE_BODY, actor_mfa_status: 'none' }), POLICY_NOW).blocker, 'two_step');
    assert.equal(
      policy.blockerText('two_step'),
      'Set up two-step sign-in on your Profile first. You confirm this change with a code from your app.',
    );
    assert.equal(policy.blockerText('key'), 'The two-step key is not configured on the server.');
  });

  test('the roster counts active admins and names the ones without it', () => {
    assert.equal(policy.rosterText({ active: 2, enrolled: 1, missing: [] }), '1 of 2 active admins use it.');
    assert.equal(policy.rosterText({ active: 1, enrolled: 0, missing: [] }), '0 of 1 active admin uses it.');
    assert.equal(policy.rosterText({ active: 3, enrolled: 3, missing: [] }), 'All 3 active admins use it.');
    assert.equal(policy.rosterText({ active: 1, enrolled: 1, missing: [] }), 'The only active admin uses it.');
    assert.equal(policy.rosterText({ active: 0, enrolled: 0, missing: [] }), 'There are no active admins.');
    const names = ['a', 'b', 'c', 'd', 'e'].map((username, index) => ({ id: `${index}`, username }));
    assert.equal(policy.missingSummary(names), '5 (@a, @b, @c +2 more)');
    assert.equal(policy.missingSummary([{ id: OPS_ID, username: 'ops.lead' }]), '1 (@ops.lead)');
    assert.equal(policy.missingSummary([]), 'None');
    assert.equal(policy.rosterHref(OPS_ID), `/admin-accounts?id=${OPS_ID}&panel=security`);
  });

  test('a change is sent with the mode and a trimmed reason, and every answer is classified', () => {
    assert.deepEqual(policy.policyPayload('all', '  Security policy  '), { mfa_mode: 'all', reason: 'Security policy' });
    const change: PolicyChange = {
      changed: true, mode: 'all', graceEndsAt: '2026-10-27T09:05:00.000Z', auditRecorded: true, warning: null,
    };
    assert.deepEqual(policy.toPolicyChange({
      success: true, changed: true, mfa_mode: 'all', mfa_grace_ends_at: '2026-10-27T09:05:00.000Z', audit_recorded: true,
    }), change);
    assert.equal(policy.toPolicyChange({ success: true, changed: false, mfa_mode: 'off', mfa_grace_ends_at: null })?.auditRecorded, true);
    assert.equal(policy.toPolicyChange({ success: true }), null);
    const fail = (patch: Partial<ApiFailure>): ApiResult<PolicyChange> => ({
      ok: false,
      error: {
        kind: 'http', status: 400, code: 'VALIDATION_ERROR', message: 'Give a reason of at least 3 characters.',
        requestId: null, details: null, outcomeUnknown: false, ...patch,
      },
    });
    assert.deepEqual(policy.classifyPolicyChange({ ok: true, data: change, status: 200, requestId: 'req_1' }), { kind: 'done', change });
    assert.deepEqual(policy.classifyPolicyChange(fail({ status: 401, code: 'AUTH_REQUIRED' })), { kind: 'expired' });
    assert.deepEqual(policy.classifyPolicyChange(fail({ status: 403, code: 'REAUTH_REQUIRED' })), {
      kind: 'reauth', code: 'REAUTH_REQUIRED', message: model.STEP_UP_MESSAGE.REAUTH_REQUIRED,
    });
    assert.deepEqual(policy.classifyPolicyChange(fail({ status: 403, code: 'MFA_REQUIRED' })), {
      kind: 'reauth', code: 'MFA_REQUIRED', message: 'Set up two-step sign-in on your Profile first.',
    });
    assert.equal(policy.classifyPolicyChange(fail({ status: 403, code: 'PERMISSION_DENIED' })).kind, 'denied');
    assert.deepEqual(
      policy.classifyPolicyChange(fail({
        status: 409, code: 'STATE_CONFLICT', message: 'Set ADMIN_MFA_ENCRYPTION_KEY before requiring two-step sign-in.',
      })),
      { kind: 'conflict', message: 'Set ADMIN_MFA_ENCRYPTION_KEY before requiring two-step sign-in.' },
    );
    assert.deepEqual(policy.classifyPolicyChange(fail({})), { kind: 'refused', message: 'Give a reason of at least 3 characters.' });
    assert.equal(policy.classifyPolicyChange(fail({ status: 500, code: 'INTERNAL_ERROR' })).kind, 'refused');
    assert.equal(policy.classifyPolicyChange(fail({ status: 500, code: null, outcomeUnknown: true })).kind, 'unknown');
    assert.equal(policy.classifyPolicyChange(fail({ kind: 'network', status: null, code: null, outcomeUnknown: true })).kind, 'unknown');
  });

  test('the toasts say what changed', () => {
    assert.equal(
      policy.policyChangedText({ changed: true, mode: 'all', graceEndsAt: '2026-10-27T09:05:00.000Z', auditRecorded: true, warning: null }, POLICY_NOW),
      'Two-step sign-in is now required. Admins without it have until 27 Oct 2026, 10:05 WAT to set it up.',
    );
    assert.equal(
      policy.policyChangedText({ changed: true, mode: 'off', graceEndsAt: null, auditRecorded: true, warning: null }, POLICY_NOW),
      'Two-step sign-in is no longer required. Admins who use it keep it.',
    );
    assert.equal(policy.policyUnchangedText('all'), 'Two-step sign-in was already required. Nothing changed.');
    assert.equal(policy.policyUnchangedText('off'), 'Two-step sign-in was already not required. Nothing changed.');
  });

  test('settings saves treat a code prompt or a missing two-step sign-in as their own outcome', () => {
    assert.deepEqual(model.classifySave(failure({ status: 403, code: 'REAUTH_REQUIRED' })), {
      kind: 'reauth', message: model.STEP_UP_MESSAGE.REAUTH_REQUIRED,
    });
    assert.deepEqual(model.classifySave(failure({ status: 403, code: 'MFA_REQUIRED' })), {
      kind: 'reauth', message: 'Set up two-step sign-in on your Profile first.',
    });
    assert.equal(model.classifySave(failure({ status: 403, code: 'PERMISSION_DENIED' })).kind, 'denied');
  });
});

describe('two-step requirement card', () => {
  const noop = () => {};
  const card = (props: Record<string, unknown> = {}) => render(createElement(policyCard.SecurityPolicyCard, {
    headingId: 'policy-heading',
    state: policyState(),
    error: null,
    retrying: false,
    busy: false,
    now: POLICY_NOW,
    onRetry: noop,
    onChange: noop,
    ...props,
  }));
  const loadFailure: ApiFailure = {
    kind: 'http', status: 500, code: 'INTERNAL_ERROR', message: 'The two-step requirement could not be loaded. Try again.',
    requestId: 'req_policy', details: null, outcomeUnknown: false,
  };

  test('the card is the admin-two-step anchor, with a focusable heading and its subtitle', () => {
    const html = card();
    const region = tagsOf(html, 'div').find((attrs) => attrs.id === 'admin-two-step');
    assert.ok(region);
    assert.equal(region.role, 'region');
    assert.equal(region['aria-labelledby'], 'policy-heading');
    assert.equal(tagsOf(html, 'h2').find((attrs) => attrs.id === 'policy-heading')?.tabindex, '-1');
    assert.match(
      textOf(html),
      /^Two-step sign-in for admins Require an authenticator app code at every admin sign-in, on the web console and in the CardElite Admin app\. Not required/,
    );
  });

  test('while loading it shows placeholders, a failed load offers a retry, and a failed refresh keeps the card', () => {
    assert.match(textOf(card({ state: undefined })), /Loading the two-step requirement…/);
    const failed = card({ state: undefined, error: loadFailure });
    assert.match(textOf(failed), /The two-step requirement could not be loaded/);
    assert.ok(buttonByText(failed, 'Try again'));
    const stale = card({ error: loadFailure });
    assert.match(textOf(stale), /The two-step requirement could not be refreshed\./);
    assert.ok(buttonByText(stale, 'Require for all admins…'));
  });

  test('off: the roster, the admins without it linked to their Security tab, and the button to require it', () => {
    const html = card();
    const text = textOf(html);
    assert.match(text, /1 of 2 active admins use it\. Not set up yet: @ops\.lead/);
    assert.ok(hrefs(html).includes(`/admin-accounts?id=${OPS_ID}&panel=security`));
    const button = buttonByText(html, 'Require for all admins…');
    assert.ok(button);
    assert.equal('disabled' in button, false);
    assert.ok(classesOf(button).includes('primary'));
    assert.match(text, /Admins get 14 days to set it up\. You confirm with a code from your authenticator app\./);
    assert.equal(hrefs(html).includes('/profile#two-step-sign-in'), false);
  });

  test('without the acting admin’s own two-step sign-in, the change is disabled with a way to the Profile', () => {
    const html = card({ state: policyState({ actor_mfa_status: 'none' }) });
    const button = buttonByText(html, 'Require for all admins…');
    assert.ok(button && 'disabled' in button);
    assert.match(textOf(html), /Set up two-step sign-in on your Profile first\. You confirm this change with a code from your app\./);
    assert.ok(hrefs(html).includes('/profile#two-step-sign-in'));
    const stop = buttonByText(card({ state: policyState({ ...GRACE_BODY, actor_mfa_status: 'pending' }) }), 'Stop requiring it…');
    assert.ok(stop && 'disabled' in stop);
  });

  test('without the server key, requiring it is disabled and says why', () => {
    const html = card({ state: policyState({ key_configured: false }) });
    const button = buttonByText(html, 'Require for all admins…');
    assert.ok(button && 'disabled' in button);
    assert.match(textOf(html), /The two-step key is not configured on the server\./);
    assert.equal(hrefs(html).includes('/profile#two-step-sign-in'), false);
  });

  test('during the grace period it warns with the date and offers to stop requiring it', () => {
    const html = card({ state: policyState(GRACE_BODY) });
    const text = textOf(html);
    assert.match(text, /Required from 27 Oct Required from 27 Oct 2026/);
    assert.match(
      text,
      /Admins without it are asked to set it up by 27 Oct 2026, 10:05 WAT\. After that they must set it up when they sign in\./,
    );
    const stop = buttonByText(html, 'Stop requiring it…');
    assert.ok(stop);
    assert.equal('disabled' in stop, false);
    assert.ok(classesOf(stop).includes('dangerSubtle'));
  });

  test('once required it says since when, and still offers to stop requiring it', () => {
    const html = card({ state: policyState(REQUIRED_BODY) });
    assert.match(textOf(html), /Required since 01 Oct 2026\. Admins without it set it up the next time they sign in\./);
    assert.ok(buttonByText(html, 'Stop requiring it…'));
  });

  test('a change in flight shows the button as busy', () => {
    const button = buttonByText(card({ busy: true }), 'Require for all admins…');
    assert.ok(button && 'disabled' in button);
    assert.equal(button['aria-busy'], 'true');
  });
});

describe('two-step requirement confirms', () => {
  test('a reason the route would refuse is caught before the code is spent', () => {
    assert.equal(policy.reasonProblem('ok'), 'Give a reason of at least 3 characters.');
    assert.equal(policy.reasonProblem('  ab  '), 'Give a reason of at least 3 characters.');
    assert.equal(policy.reasonProblem('Rollout paused'), null);
    const source = readFileSync(new URL('../app/(dashboard)/admin-settings/SecurityPolicyCard.tsx', import.meta.url), 'utf8');
    const check = source.indexOf('reasonProblem(reason)');
    assert.ok(check > 0 && check < source.indexOf('await confirmIdentity(credential'));
  });

  test('requiring it shows the 14-day grace and who is missing, and needs a reason and a code', () => {
    const options = dialogs.policyOnOptions(policyState(), POLICY_NOW);
    assert.equal(options.tone, undefined);
    assert.equal(options.title, 'Require two-step sign-in for every admin?');
    assert.deepEqual(options.details?.map((detail) => detail.label), ['Two-step sign-in', 'Grace period', 'Admins without it']);
    assert.equal(textOf(render(createElement('div', null, options.details?.[0].value))), 'From Not required → to Required for every admin');
    assert.equal(options.details?.[1].value, '14 days, until 27 Oct 2026, 10:00 WAT');
    assert.equal(options.details?.[2].value, '1 (@ops.lead)');
    assert.deepEqual(options.consequences, [
      'Admins without it see a banner asking them to set it up by 27 Oct 2026.',
      'After that they must set it up when they sign in on the web console before they can use it. The mobile app cannot set it up.',
      'In the mobile app, admins with it type their password followed by the 6-digit code.',
      'Admins already signed in stay signed in until their session ends.',
      'Every admin gets an alert in the mobile app.',
    ]);
    assert.equal(options.reason?.required, true);
    assert.deepEqual(options.reason?.presets, ['Security policy', 'After a security incident', 'Audit or compliance']);
    assert.deepEqual(options.credential, { kind: 'otp' });
    assert.equal(options.confirmLabel, 'Require two-step sign-in');
  });

  test('stopping it is a danger confirm that also needs a reason and a code', () => {
    const options = dialogs.policyOffOptions(policyState(GRACE_BODY), POLICY_NOW);
    assert.equal(options.tone, 'danger');
    assert.equal(options.title, 'Stop requiring two-step sign-in?');
    assert.equal(options.message, 'Admins who use it keep it. Admins without it can sign in with just their password again.');
    assert.equal(textOf(render(createElement('div', null, options.details?.[0].value))), 'From Required from 27 Oct → to Not required');
    assert.deepEqual(options.consequences, [
      'The banner and the setup step at sign-in stop.',
      'The other super administrators are alerted.',
    ]);
    assert.equal(options.reason?.required, true);
    assert.deepEqual(options.reason?.presets, ['Turned on by mistake', 'Rollout paused']);
    assert.deepEqual(options.credential, { kind: 'otp' });
    assert.equal(options.confirmLabel, 'Stop requiring it');
    const required = dialogs.policyOffOptions(policyState(REQUIRED_BODY), POLICY_NOW);
    assert.equal(textOf(render(createElement('div', null, required.details?.[0].value))), 'From Required → to Not required');
  });

  test('the page names admin sign-in and places the card after emergency mode, outside the settings form', () => {
    const source = readFileSync(PAGE_FILE, 'utf8');
    assert.match(source, /payouts, bills, support, admin sign-in and the user app/);
    const emergency = source.indexOf('<EmergencyCard');
    const section = source.indexOf('<SecurityPolicySection />');
    const form = source.indexOf('<form');
    assert.ok(emergency > 0 && emergency < section && section < form);
  });
});

describe('hard rules', () => {
  const sources = () => [
    ...readdirSync(OWNED_DIR).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => join(OWNED_DIR, name)),
    ROUTE_FILE,
  ];

  test('owned sources carry no prose comments and no inline styles', () => {
    for (const file of sources()) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /\/\*/, file);
      assert.doesNotMatch(source, /(^|\s)\/\/\s/m, file);
      assert.doesNotMatch(source, /style=\{/, file);
    }
  });

  test('owned sources spell invisible and bidirectional characters as escapes', () => {
    const hidden = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
    for (const file of [...sources(), fileURLToPath(import.meta.url)]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), hidden, file);
    }
  });

  test('the stylesheet uses tokens only', () => {
    const css = readFileSync(join(OWNED_DIR, 'page.module.css'), 'utf8');
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
    for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      assert.doesNotMatch(value, colour, `${property}: ${value}`);
      if (property === 'z-index') assert.match(value.trim(), /^var\(--z-[\w-]+\)$/);
    }
    assert.doesNotMatch(css, /\/\*/);
  });

  test('the route keeps the super-admin rule and the shared rules module', () => {
    const source = readFileSync(ROUTE_FILE, 'utf8');
    assert.match(source, /requireSuperAdmin\(\)/);
    assert.doesNotMatch(source, /requireAdmin\(|requireAdminAny\(|requireAdminAll\(/);
    assert.match(source, /writeAudit\(/);
    assert.match(source, /from '\.\.\/\.\.\/\(dashboard\)\/admin-settings\/rules'/);
    assert.doesNotMatch(source, /NextResponse\.json\(/);
  });

  test('every save goes through one compare-and-set call that keeps the secret keys private', () => {
    const source = readFileSync(ROUTE_FILE, 'utf8');
    assert.match(source, /changes: plan\.updates,/);
    assert.match(source, /expected: seenValues\(current, SETTINGS_KEYS\),/);
    assert.match(source, /privateKeys: SECRET_KEYS,/);
    assert.doesNotMatch(source, /request\.expected/);
    assert.doesNotMatch(source, /keepSecretsPrivate|sealSecretRows|\.upsert\(|\.update\(|\.insert\(/);
    assert.doesNotMatch(source, /outcome\.before/);
  });
});
