import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createElement, type ElementType, type ReactNode } from 'react';
import { classesOf, loadAppModule, render, tagsOf, textOf, withClass, type Attrs } from './support/uiHarness.ts';
import {
  ALL_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  PERMISSION_CATALOG,
  permissionStatus,
  resolvePermissions,
  type Permission,
} from '../app/lib/permissions.ts';
import type {
  AdminList, AdminRow, AdminSecurity, MfaCellState, MutationResult, SecurityPolicy,
} from '../app/(dashboard)/admin-accounts/model.ts';
import type { AdminState, EditInput } from '../app/(dashboard)/admin-accounts/rules.ts';
import type { RoleRow } from '../app/lib/roles.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type { DeviceSession } from '../app/lib/adminSecurity.ts';

type RulesModule = typeof import('../app/(dashboard)/admin-accounts/rules.ts');
type ModelModule = typeof import('../app/(dashboard)/admin-accounts/model.ts');
type ConfirmModule = typeof import('../app/(dashboard)/admin-accounts/confirmOptions.tsx');
type SecurityPartsModule = typeof import('../app/(dashboard)/admin-accounts/SecurityParts.tsx');
type NavModule = typeof import('../app/(dashboard)/_shell/nav.ts');
type EditorModule = typeof import('../app/(dashboard)/admin-accounts/AdminEditor.tsx');
type DetailsModule = typeof import('../app/(dashboard)/admin-accounts/AdminDetails.tsx');
type AccessModule = typeof import('../app/(dashboard)/_access/index.ts');

let rules: RulesModule;
let model: ModelModule;
let confirmOptions: ConfirmModule;
let securityParts: SecurityPartsModule;
let nav: NavModule;
let editorModule: EditorModule;
let detailsModule: DetailsModule;
let accessParts: AccessModule;
let GrantDiff: ElementType;

before(async () => {
  rules = await loadAppModule<RulesModule>('(dashboard)/admin-accounts/rules.ts');
  model = await loadAppModule<ModelModule>('(dashboard)/admin-accounts/model.ts');
  confirmOptions = await loadAppModule<ConfirmModule>('(dashboard)/admin-accounts/confirmOptions.tsx');
  securityParts = await loadAppModule<SecurityPartsModule>('(dashboard)/admin-accounts/SecurityParts.tsx');
  nav = await loadAppModule<NavModule>('(dashboard)/_shell/nav.ts');
  accessParts = await loadAppModule<AccessModule>('(dashboard)/_access/index.ts');
  GrantDiff = (await loadAppModule<Record<string, ElementType>>('(dashboard)/_access/index.ts')).GrantDiff;
  editorModule = await loadAppModule<EditorModule>('(dashboard)/admin-accounts/AdminEditor.tsx');
  detailsModule = await loadAppModule<DetailsModule>('(dashboard)/admin-accounts/AdminDetails.tsx');
});

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const ADMIN_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const SELF_ID = '11111111-2222-4333-8444-555555555555';
const ROLE_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const LEGACY_ROUTE_ACCEPTED = [
  'dashboard', 'card_queue', 'card_management', 'card_type_builder', 'rates_management',
  'withdrawals', 'manual_wallet_credit', 'users', 'transactions_overview',
  'bonuses_rewards', 'referral_management', 'coupons', 'notifications_broadcast',
  'notification_templates', 'email_templates', 'platform_balance', 'admin_accounts',
  'user_activity_monitor', 'limits_fees', 'admin_settings', 'bill_settings',
  'anomaly_alerts', 'security_limits', 'activity', 'field_builder', 'feature_overrides',
  'flagged_transactions', 'giftbox', 'users_freeze',
];

function state(patch: Partial<AdminState> = {}): AdminState {
  return {
    id: ADMIN_ID,
    username: 'ada',
    email: 'ada@cardelite.ng',
    role_title: 'Card Reviewer',
    page_permissions: ['card_queue', 'users'],
    is_active: true,
    is_super_admin: false,
    deleted_at: null,
    token_version: 4,
    ...patch,
  };
}

function row(patch: Partial<AdminRow> = {}): AdminRow {
  return {
    id: ADMIN_ID,
    username: 'ada',
    email: 'ada@cardelite.ng',
    role_title: 'Card Reviewer',
    page_permissions: ['card_queue', 'users'],
    role_id: null,
    role: null,
    direct_permissions: ['card_queue', 'users'],
    last_login_at: '2026-09-30T10:00:00.000Z',
    is_active: true,
    is_super_admin: false,
    deleted_at: null,
    created_at: '2026-01-02T09:00:00.000Z',
    security: null,
    invitePending: false,
    ...patch,
  };
}

const NOW = new Date('2026-10-13T09:00:00.000Z');
const GRACE_END = '2026-10-27T09:05:00.000Z';
const LOCK_TODAY = '2026-10-13T09:19:30.000Z';
const LOCK_TOMORROW = '2026-10-14T09:00:00.000Z';
const SESSION_ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

const OFF_POLICY: SecurityPolicy = { mode: 'off', graceEndsAt: null, requiredNow: false };
const GRACE_POLICY: SecurityPolicy = { mode: 'all', graceEndsAt: GRACE_END, requiredNow: false };
const REQUIRED_POLICY: SecurityPolicy = { mode: 'all', graceEndsAt: '2026-10-01T09:00:00.000Z', requiredNow: true };

function security(patch: Partial<AdminSecurity> = {}): AdminSecurity {
  return {
    mfaStatus: 'active',
    confirmedAt: '2026-10-12T09:05:00.000Z',
    lockedUntil: null,
    lastUsedAt: '2026-10-13T08:00:00.000Z',
    recoveryCodesLeft: 8,
    liveSessions: 2,
    lastSeenAt: '2026-10-13T08:59:00.000Z',
    ...patch,
  };
}

function device(patch: Partial<DeviceSession> = {}): DeviceSession {
  return {
    id: SESSION_ID,
    client: 'web',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    ip: '102.89.34.1',
    authMethods: ['otp', 'pwd'],
    createdAt: '2026-10-13T08:14:00.000Z',
    lastSeenAt: '2026-10-13T08:59:00.000Z',
    expiresAt: '2026-10-13T16:14:00.000Z',
    current: false,
    ...patch,
  };
}

function plan(input: Record<string, unknown>, patch: Partial<AdminState> = {}, actor = SELF_ID) {
  const result = rules.planEdit(state(patch), input as EditInput, actor);
  assert.ok(result.ok, result.ok ? '' : result.message);
  return result.plan;
}

function refusal(input: Record<string, unknown>, patch: Partial<AdminState> = {}, actor = SELF_ID) {
  const result = rules.planEdit(state(patch), input as EditInput, actor);
  assert.equal(result.ok, false);
  return result.ok ? null : result;
}

describe('grant sets', () => {
  test('additional permissions are exactly the catalog keys that no page key grants', () => {
    const granted = new Set(Object.values(LEGACY_PERMISSION_MAP).flat());
    const expected = ALL_PERMISSIONS.filter((key) => !granted.has(key));
    assert.deepEqual([...rules.ADDITIONAL_PERMISSIONS], expected);
    for (const key of ['sensitive_data.share', 'sensitive_data.download', 'flags.read', 'flags.resolve',
      'reconciliation.read', 'reconciliation.resolve'] as const) {
      assert.ok(rules.ADDITIONAL_PERMISSIONS.includes(key), key);
    }
    for (const key of ['withdrawals.approve', 'users.freeze', 'cards.review', 'admin_users.manage'] as const) {
      assert.ok(!rules.ADDITIONAL_PERMISSIONS.includes(key), key);
    }
  });

  test('every key the previous route accepted can still be sent back while the account stores it', () => {
    const checked = rules.checkGrants(LEGACY_ROUTE_ACCEPTED, { stored: LEGACY_ROUTE_ACCEPTED });
    assert.ok(checked.ok);
    assert.deepEqual(new Set(checked.ok ? checked.keys : []), new Set(LEGACY_ROUTE_ACCEPTED));
  });

  test('accepts every grantable page as new, and every page key and additional permission once stored', () => {
    assert.ok(rules.checkGrants(rules.GRANTABLE_PAGE_KEYS).ok);
    const all = [...rules.PAGE_KEYS, ...rules.ADDITIONAL_PERMISSIONS];
    assert.ok(rules.checkGrants(all, { stored: all }).ok);
  });

  test('a catalog key is only ever echoed on the phone path, now that payouts check withdrawals.approve', () => {
    for (const key of ['withdrawals.approve', 'withdrawals.read', 'users.freeze', 'cards.review']) {
      const added = rules.checkGrants(['withdrawals', key]);
      assert.equal(added.ok, false, key);
      assert.equal(added.ok ? '' : added.code, 'STATE_CONFLICT', key);
      assert.equal(added.ok ? '' : added.message, 'This admin’s access changed since you opened it. Reload and try again.');
      assert.deepEqual(rules.checkGrants(['withdrawals', key], { stored: ['withdrawals', key] }), {
        ok: true,
        keys: ['withdrawals', key],
      });
    }
  });

  test('refuses unknown keys, non-strings, non-arrays and oversized lists', () => {
    assert.equal(rules.checkGrants(['coupons', 'constructor']).ok, false);
    assert.equal(rules.checkGrants(['coupons', 7]).ok, false);
    assert.equal(rules.checkGrants('coupons').ok, false);
    assert.equal(rules.checkGrants(null).ok, false);
    assert.equal(rules.checkGrants(new Array(rules.MAX_GRANT_KEYS + 1).fill('coupons')).ok, false);
  });

  test('drops duplicate keys and keeps the first order', () => {
    const checked = rules.checkGrants(['users', 'coupons', 'users']);
    assert.deepEqual(checked.ok ? checked.keys : null, ['users', 'coupons']);
  });

  test('a newly added restricted, retired or unknown page key is refused by name, with the keys for the console', () => {
    for (const [key, message] of [
      ['admin_accounts', 'This permission cannot be granted: admin_accounts.'],
      ['giftbox', 'This permission cannot be granted: giftbox.'],
      ['transfers', 'This permission cannot be granted: transfers.'],
    ] as const) {
      const checked = rules.checkGrants(['coupons', key], { stored: ['coupons'] });
      assert.equal(checked.ok, false, key);
      if (checked.ok) continue;
      assert.equal(checked.code, 'VALIDATION_ERROR');
      assert.equal(checked.message, message);
      assert.deepEqual(checked.details, { reason: 'not_grantable', keys: [key] });
    }
    const two = rules.checkGrants(['admin_accounts', 'giftbox']);
    assert.equal(two.ok ? '' : two.message, 'These permissions cannot be granted: admin_accounts, giftbox.');
  });

  test('stored keys may be sent back, including the super admin’s transfers and manual_wallet_credit', () => {
    const held = ['dashboard', 'card_queue', 'withdrawals', 'admin_accounts', 'transfers', 'manual_wallet_credit'];
    assert.deepEqual(rules.checkGrants([...held].reverse(), { stored: held }), { ok: true, keys: [...held].reverse() });
  });

  test('unticking a key that comes from the role answers 409 naming the role, and an echo of it passes', () => {
    const held = { stored: ['users', 'withdrawals', 'coupons'], roleKeys: ['withdrawals', 'coupons'], roleName: 'Manager' };
    const one = rules.checkGrants(['users', 'coupons'], held);
    assert.equal(one.ok ? '' : one.code, 'STATE_CONFLICT');
    assert.equal(one.ok ? '' : one.message, 'withdrawals comes from the role Manager. Change it in the web console.');
    const both = rules.checkGrants(['users'], held);
    assert.equal(both.ok ? '' : both.message, 'withdrawals, coupons come from the role Manager. Change them in the web console.');
    assert.ok(rules.checkGrants(['coupons', 'users', 'withdrawals'], held).ok);
    assert.ok(rules.checkGrants(['withdrawals', 'coupons'], held).ok);
  });

  test('dotted keys must match the stored ones, so a stale phone list cannot add or drop one', () => {
    const held = { stored: ['users', 'withdrawals.read', 'sensitive_data.share'] };
    for (const sent of [['users', 'withdrawals.read'], ['users', 'withdrawals.read', 'sensitive_data.share', 'flags.read']]) {
      const checked = rules.checkGrants(sent, held);
      assert.equal(checked.ok ? '' : checked.code, 'STATE_CONFLICT', JSON.stringify(sent));
    }
    assert.ok(rules.checkGrants(['sensitive_data.share', 'users', 'withdrawals.read', 'coupons'], held).ok);
  });

  test('classifies keys by how they are stored', () => {
    assert.equal(rules.grantKind('withdrawals'), 'page');
    assert.equal(rules.grantKind('users_freeze'), 'page');
    assert.equal(rules.grantKind('admin_accounts'), 'restricted');
    assert.equal(rules.grantKind('giftbox'), 'retired');
    assert.equal(rules.grantKind('sensitive_data.share'), 'additional');
    assert.equal(rules.grantKind('withdrawals.approve'), 'unknown');
    assert.equal(rules.grantKind('toString'), 'unknown');
  });

  test('admin management is never offered as a grantable page', () => {
    assert.ok(!rules.GRANTABLE_PAGE_KEYS.includes('admin_accounts'));
    assert.ok(rules.GRANTABLE_PAGE_KEYS.includes('users_freeze'));
  });

  test('effective actions ignore keys the resolver cannot expand, including prototype names', () => {
    assert.doesNotThrow(() => rules.effectiveActions(['constructor', '__proto__', 'toString', 'giftbox']));
    assert.equal(rules.effectiveActions(['constructor', 'giftbox']).size, 0);
    assert.deepEqual(rules.effectiveActions(['coupons']), resolvePermissions(['coupons'], false));
  });
});

describe('grant diff', () => {
  test('lists added and removed keys and the actions gained and lost', () => {
    const change = rules.diffGrants(['coupons', 'users'], ['users', 'withdrawals', 'sensitive_data.share']);
    assert.deepEqual(change.added, ['withdrawals', 'sensitive_data.share']);
    assert.deepEqual(change.removed, ['coupons']);
    assert.ok(change.gained.includes('withdrawals.approve'));
    assert.ok(change.gained.includes('sensitive_data.share'));
    assert.deepEqual(change.lost, ['coupons.read', 'coupons.write']);
  });

  test('removing a key loses only the actions no remaining key grants', () => {
    const change = rules.diffGrants(['notifications_broadcast', 'notification_templates'], ['notification_templates']);
    assert.deepEqual(change.removed, ['notifications_broadcast']);
    assert.deepEqual([...change.lost].sort(), [
      'communications.read', 'communications.send', 'communications.send_all', 'communications.write',
    ]);
  });

  test('the notification and email template keys grant separate actions', () => {
    const change = rules.diffGrants(['notification_templates', 'email_templates'], ['email_templates']);
    assert.deepEqual(change.removed, ['notification_templates']);
    assert.deepEqual([...change.lost].sort(), ['notification_templates.read', 'notification_templates.write']);
  });

  test('the cards and field builder keys grant separate actions', () => {
    const change = rules.diffGrants(['card_management', 'card_type_builder'], ['card_type_builder']);
    assert.deepEqual(change.removed, ['card_management']);
    assert.deepEqual([...change.lost].sort(), ['catalog.publish', 'catalog.read', 'catalog.write']);
  });

  test('risk is the highest risk among the actions a key grants', () => {
    assert.equal(rules.grantRisk('withdrawals'), 'critical');
    assert.equal(rules.grantRisk('coupons'), 'medium');
    assert.equal(rules.grantRisk('dashboard'), null);
    assert.equal(rules.grantRisk('flags.read'), 'medium');
    assert.equal(rules.grantRisk('giftbox'), null);
  });
});

describe('field rules', () => {
  test('passwords keep the existing strength rules', () => {
    assert.equal(rules.checkPassword(''), 'A password is required.');
    assert.equal(rules.checkPassword(42), 'A password is required.');
    assert.match(rules.checkPassword('Short1!') ?? '', /at least 12/);
    assert.match(rules.checkPassword('alllowercase1!') ?? '', /uppercase/);
    assert.match(rules.checkPassword('ALLUPPERCASE1!') ?? '', /lowercase/);
    assert.match(rules.checkPassword('NoDigitsHere!!') ?? '', /number/);
    assert.match(rules.checkPassword('NoSymbols12345') ?? '', /symbol/);
    assert.match(rules.checkPassword(`Aa1!${'x'.repeat(130)}`) ?? '', /128 characters or fewer/);
    assert.equal(rules.checkPassword('Correct-Horse-9'), null);
    assert.deepEqual(rules.unmetPasswordRules('abc'), ['length', 'upper', 'digit', 'symbol']);
  });

  test('the strength rules are the shared password policy, unchanged in wording and limits', async () => {
    const policy = await loadAppModule<typeof import('../app/lib/passwordPolicy.ts')>('lib/passwordPolicy.ts');
    assert.equal(rules.checkPassword, policy.checkPassword);
    assert.equal(rules.unmetPasswordRules, policy.unmetPasswordRules);
    assert.equal(rules.PASSWORD_RULES, policy.PASSWORD_RULES);
    assert.equal(rules.PASSWORD_MIN, 12);
    assert.equal(rules.PASSWORD_MAX, 128);
    assert.deepEqual(rules.PASSWORD_RULES.map((rule) => rule.label), [
      'At least 12 characters', 'A lowercase letter', 'An uppercase letter', 'A number', 'A symbol',
    ]);
    assert.equal(rules.checkPassword('Short1!'), 'Password must be at least 12 characters.');
    assert.equal(rules.checkPassword('alllowercase1!'), 'Password must include an uppercase letter.');
    assert.equal(rules.checkPassword('ALLUPPERCASE1!'), 'Password must include a lowercase letter.');
    assert.equal(rules.checkPassword('NoDigitsHere!!'), 'Password must include a number.');
    assert.equal(rules.checkPassword('NoSymbols12345'), 'Password must include a symbol.');
    assert.equal(rules.checkPassword(`Aa1!${'x'.repeat(130)}`), 'Password must be 128 characters or fewer.');
  });

  test('reasons are optional, trimmed and capped', () => {
    assert.deepEqual(rules.checkReason(undefined), { ok: true, reason: null });
    assert.deepEqual(rules.checkReason('   '), { ok: true, reason: null });
    assert.deepEqual(rules.checkReason('  Left the company '), { ok: true, reason: 'Left the company' });
    assert.equal(rules.checkReason(12).ok, false);
    assert.equal(rules.checkReason('x'.repeat(rules.REASON_MAX + 1)).ok, false);
  });

  test('the phone’s create keeps the required fields and its password, and takes grantable pages only', () => {
    const base = {
      username: 'tolu',
      email: 'tolu@cardelite.ng',
      password: 'Correct-Horse-9',
      role_title: 'Payout Officer',
    };
    const created = rules.checkCreate({ ...base, page_permissions: ['withdrawals', 'card_queue', 'withdrawals'] }, 'mobile');
    assert.ok(created.ok);
    assert.deepEqual(created.ok ? created.value.page_permissions : null, ['withdrawals', 'card_queue']);
    assert.equal(created.ok ? created.value.password : null, 'Correct-Horse-9');
    const bare = rules.checkCreate(base, 'mobile');
    assert.deepEqual(bare.ok ? bare.value.page_permissions : null, []);
    assert.equal(rules.checkCreate({ ...base, email: '' }, 'mobile').ok, false);
    assert.equal(rules.checkCreate({ ...base, email: 'not-an-email' }, 'mobile').ok, false);
    assert.equal(rules.checkCreate({ ...base, password: 'weak' }, 'mobile').ok, false);
    assert.equal(rules.checkCreate({ ...base, username: 'ab' }, 'mobile').ok, false);
    assert.equal(rules.checkCreate({ ...base, role_title: 'x' }, 'mobile').ok, false);
    const missing = rules.checkCreate({ ...base, password: undefined }, 'mobile');
    assert.equal(missing.ok ? '' : missing.code, 'VALIDATION_ERROR');
    assert.equal(missing.ok ? '' : missing.message, 'Username, email, password and role title are required.');
    for (const key of ['withdrawals.approve', 'sensitive_data.share']) {
      const dotted = rules.checkCreate({ ...base, page_permissions: ['withdrawals', key] }, 'mobile');
      assert.equal(dotted.ok ? '' : dotted.code, 'STATE_CONFLICT', key);
    }
    for (const key of ['admin_accounts', 'giftbox', 'mystery']) {
      const refused = rules.checkCreate({ ...base, page_permissions: ['withdrawals', key] }, 'mobile');
      assert.equal(refused.ok ? '' : refused.code, 'VALIDATION_ERROR', key);
      assert.deepEqual(refused.ok ? null : refused.details, { reason: 'not_grantable', keys: [key] }, key);
    }
  });

  test('the web invite takes no password, needs a username, email and title, and stores the email trimmed in lowercase', () => {
    const base = { username: 'tolu', email: ' Tolu.Ade@CardElite.NG ', role_title: 'Payout Officer' };
    assert.deepEqual(rules.checkCreate(base, 'web'), {
      ok: true,
      value: { username: 'tolu', email: 'tolu.ade@cardelite.ng', password: null, role_title: 'Payout Officer', page_permissions: [] },
    });
    assert.equal(rules.INVITE_PASSWORD_MESSAGE, 'Passwords are chosen by the new admin from the invitation email.');
    for (const password of ['Correct-Horse-9', '', null]) {
      const refused = rules.checkCreate({ ...base, password }, 'web');
      assert.equal(refused.ok ? '' : refused.message, rules.INVITE_PASSWORD_MESSAGE);
    }
    const missing = rules.checkCreate({ ...base, role_title: '' }, 'web');
    assert.equal(missing.ok ? '' : missing.message, 'Username, email and role title are required.');
    assert.equal(rules.checkCreate({ ...base, username: 'ab' }, 'web').ok, false);
    assert.equal(rules.checkCreate({ ...base, email: 'x<a@b.co>' }, 'web').ok, false);
  });

  test('admin emails allow only letters, digits and . _ % + -, are checked trimmed, and are stored in lowercase', () => {
    for (const good of ['ada@cardelite.ng', ' Ada.Obi+ops@Card-Elite.co.uk ', 'a_b%c@x.io']) assert.equal(rules.isEmail(good), true, good);
    for (const bad of ['x<a@b.co>', 'a"b@x.ng', 'a,b@x.ng', 'a;b@x.ng', 'a(b)@x.ng', 'a b@x.ng', 'ada@cardelite', 'ada@x.n', '@x.ng', 7]) {
      assert.equal(rules.isEmail(bad), false, String(bad));
    }
    assert.equal(rules.normalizeEmail('  Ada@CardElite.NG '), 'ada@cardelite.ng');
  });
});

describe('planEdit', () => {
  test('a deleted admin cannot be changed', () => {
    const result = refusal({ role_title: 'Lead' }, { deleted_at: '2026-09-01T00:00:00.000Z' });
    assert.equal(result?.code, 'STATE_CONFLICT');
  });

  test('an admin cannot deactivate or sign out their own account', () => {
    assert.equal(refusal({ is_active: false }, {}, ADMIN_ID)?.message, rules.SELF_REVOKE_MESSAGE);
    assert.equal(refusal({ revoke_sessions: true }, {}, ADMIN_ID)?.message, rules.SELF_REVOKE_MESSAGE);
    assert.equal(rules.planEdit(state(), { role_title: 'Lead' }, ADMIN_ID).ok, true);
  });

  test('is_active must be a boolean', () => {
    assert.equal(refusal({ is_active: 'false' })?.code, 'VALIDATION_ERROR');
  });

  test('saving the same values in another order changes nothing and keeps sessions', () => {
    const result = plan({ email: 'ada@cardelite.ng', role_title: 'Card Reviewer', page_permissions: ['users', 'card_queue'] });
    assert.deepEqual(result.changed, []);
    assert.equal(result.revokesSessions, false);
    assert.deepEqual(result.updates, {});
  });

  test('a grant change is recorded with its diff, and the database decides the sign-out, not the route', () => {
    const result = plan({ page_permissions: ['card_queue', 'users', 'users_freeze', 'coupons'], reason: 'x' });
    assert.equal(result.action, 'EDIT_ADMIN');
    assert.deepEqual(result.changed, ['page_permissions']);
    assert.equal(result.revokesSessions, false);
    assert.deepEqual(result.updates, { page_permissions: ['card_queue', 'users', 'users_freeze', 'coupons'] });
    assert.deepEqual(result.grants?.added, ['users_freeze', 'coupons']);
    const after = result.after as { grant_changes: { added: string[]; actions_gained: string[] }; token_version_bumped?: boolean };
    assert.deepEqual(after.grant_changes.added, ['users_freeze', 'coupons']);
    assert.ok(after.grant_changes.actions_gained.includes('users.freeze'));
    assert.equal(after.token_version_bumped, undefined);
    assert.deepEqual((result.before as { page_permissions: string[] }).page_permissions, ['card_queue', 'users']);
    const titled = plan({ role_title: 'Lead', page_permissions: ['card_queue', 'users', 'coupons'] });
    assert.equal(titled.revokesSessions, true);
    assert.equal(titled.updates.token_version, 5);
  });

  test('a mobile edit that sends back keys the mobile screen does not list keeps them', () => {
    const held = ['card_queue', 'users_freeze', 'limits_fees', 'sensitive_data.share', 'flags.read'];
    const result = plan(
      { email: 'ada@cardelite.ng', role_title: 'Card Reviewer', page_permissions: [...held, 'coupons'] },
      { page_permissions: held },
    );
    assert.deepEqual(result.updates.page_permissions, [...held, 'coupons']);
    assert.deepEqual(result.grants?.removed, []);
  });

  test('a role title change signs the admin out; an email change does not', () => {
    const role = plan({ role_title: 'Senior Reviewer' });
    assert.equal(role.revokesSessions, true);
    const email = plan({ email: 'ada.obi@cardelite.ng' });
    assert.deepEqual(email.changed, ['email']);
    assert.equal(email.revokesSessions, false);
    assert.equal(email.updates.token_version, undefined);
  });

  test('a change reviewed against values that have since moved is refused as a conflict', () => {
    const grants = ['card_queue', 'users', 'coupons'];
    assert.equal(
      refusal({ page_permissions: grants, expected: { page_permissions: ['card_queue'] } })?.message,
      rules.EXPECTATION_MESSAGE,
    );
    assert.equal(refusal({ page_permissions: grants, expected: { page_permissions: ['card_queue'] } })?.code, 'STATE_CONFLICT');
    assert.equal(refusal({ role_title: 'Lead', expected: { role_title: 'Payouts' } })?.code, 'STATE_CONFLICT');
    assert.equal(refusal({ email: 'new@cardelite.ng', expected: { email: 'old@cardelite.ng' } })?.code, 'STATE_CONFLICT');
    assert.equal(refusal({ role_title: 'Lead', expected: 'nope' })?.code, 'VALIDATION_ERROR');
    assert.deepEqual(
      plan({ page_permissions: grants, expected: { page_permissions: ['users', 'card_queue'] } }).changed,
      ['page_permissions'],
    );
    assert.deepEqual(plan({ role_title: 'Lead', expected: { role_title: ' Card Reviewer ', email: 'ada@cardelite.ng' } }).changed, ['role_title']);
    assert.deepEqual(plan({ email: 'b@cardelite.ng', expected: { email: null } }, { email: null }).changed, ['email']);
  });

  test('an email cannot be removed, because admins sign in with it', () => {
    assert.equal(refusal({ email: '' })?.message, rules.EMAIL_REMOVAL_MESSAGE);
    assert.equal(refusal({ email: 'nope' })?.code, 'VALIDATION_ERROR');
    assert.deepEqual(plan({ email: '' }, { email: null }).changed, []);
  });

  test('an email edit is saved trimmed and in lowercase, so the same address in other letters is no change', () => {
    assert.deepEqual(plan({ email: ' Ada.Obi@CardElite.NG ' }).updates, { email: 'ada.obi@cardelite.ng' });
    assert.deepEqual(plan({ email: 'ADA@CardElite.ng' }).changed, []);
    assert.equal(refusal({ email: 'x<a@b.co>' })?.message, 'Enter a valid email address.');
  });

  test('a new password is hashed by the route and never written to the audit record', () => {
    const result = plan({ password: 'Correct-Horse-9' });
    assert.equal(result.password, 'Correct-Horse-9');
    assert.equal(result.revokesSessions, true);
    assert.equal((result.after as { password_changed?: boolean }).password_changed, true);
    const audit = JSON.stringify([result.before, result.after]);
    assert.ok(!audit.includes('Correct-Horse-9'));
    assert.ok(!audit.includes('"password"'));
    assert.equal(refusal({ password: 'weak' })?.code, 'VALIDATION_ERROR');
    assert.deepEqual(plan({ password: '' }).changed, []);
  });

  test('deactivation and reactivation are labelled and both end old sessions', () => {
    const off = plan({ is_active: false });
    assert.equal(off.action, 'DEACTIVATE_ADMIN');
    assert.equal(off.revokesSessions, true);
    assert.equal(off.deactivatesSuperAdmin, false);
    assert.equal(plan({ is_active: false }, { is_super_admin: true }).deactivatesSuperAdmin, true);
    const on = plan({ is_active: true }, { is_active: false });
    assert.equal(on.action, 'REACTIVATE_ADMIN');
    assert.equal(on.revokesSessions, true);
    assert.deepEqual(plan({ is_active: false }, { is_active: false }).changed, []);
  });

  test('revoking sessions bumps the token version with no other change', () => {
    const result = plan({ revoke_sessions: true });
    assert.equal(result.action, 'REVOKE_ADMIN_SESSIONS');
    assert.deepEqual(result.changed, []);
    assert.equal(result.revokesSessions, true);
    assert.equal(result.updates.token_version, 5);
    assert.equal(plan({ revoke_sessions: true }, { token_version: null }).updates.token_version, 1);
  });

  test('a catalog key the phone never loaded answers 409, and null grants are treated as none', () => {
    const added = refusal({ page_permissions: ['withdrawals.approve'] });
    assert.equal(added?.code, 'STATE_CONFLICT');
    assert.equal(added?.message, 'This admin’s access changed since you opened it. Reload and try again.');
    assert.deepEqual(plan({ page_permissions: null }).updates.page_permissions, []);
  });

  test('a page the role grants cannot be unticked from the phone, and an unrelated phone save keeps it', () => {
    const roleState = {
      page_permissions: ['users', 'withdrawals'],
      role_id: ROLE_ID,
      direct_permissions: ['users'],
      role: { id: ROLE_ID, name: 'Manager', archived_at: null, permissions: ['withdrawals'] },
    };
    const unticked = refusal({ email: 'ada@cardelite.ng', role_title: 'Card Reviewer', page_permissions: ['users'] }, roleState);
    assert.equal(unticked?.code, 'STATE_CONFLICT');
    assert.equal(unticked?.message, 'withdrawals comes from the role Manager. Change it in the web console.');
    const unnamed = refusal({ page_permissions: ['users'] }, { ...roleState, role: { ...roleState.role, name: null } });
    assert.equal(unnamed?.message, 'withdrawals comes from their role. Change it in the web console.');
    const echo = plan({ email: 'ada.obi@cardelite.ng', role_title: 'Card Reviewer', page_permissions: ['withdrawals', 'users'] }, roleState);
    assert.deepEqual(echo.changed, ['email']);
    assert.equal(echo.updates.page_permissions, undefined);
    const dropDirect = plan({ page_permissions: ['withdrawals'] }, roleState);
    assert.deepEqual(dropDirect.updates, { page_permissions: ['withdrawals'] });
  });

  test('a newly added restricted page is refused by name, while stored retired and unknown keys may be echoed', () => {
    const restricted = refusal({ page_permissions: ['card_queue', 'users', 'admin_accounts'] });
    assert.equal(restricted?.code, 'VALIDATION_ERROR');
    assert.deepEqual(restricted?.details, { reason: 'not_grantable', keys: ['admin_accounts'] });
    const held = ['card_queue', 'users', 'giftbox', 'transfers'];
    assert.deepEqual(plan({ page_permissions: [...held] }, { page_permissions: held }).changed, []);
    assert.deepEqual(plan({ page_permissions: ['card_queue', 'giftbox'] }, { page_permissions: held }).updates.page_permissions, [
      'card_queue', 'giftbox',
    ]);
  });

  test('a super admin’s stored keys, including transfers, ride along with a phone title change', () => {
    const held = ['dashboard', 'card_queue', 'withdrawals', 'admin_accounts', 'transfers', 'manual_wallet_credit'];
    const result = plan(
      { email: 'ada@cardelite.ng', role_title: 'Lead', page_permissions: [...held] },
      { is_super_admin: true, page_permissions: held },
    );
    assert.deepEqual(result.changed, ['role_title']);
    assert.deepEqual(result.updates, { role_title: 'Lead', token_version: 5 });
  });

  test('the saved row, not the plan, says whether sessions ended and what the grants became', () => {
    const grantPlan = plan({ page_permissions: ['card_queue', 'users', 'coupons'] });
    const bumped = rules.savedChange(grantPlan, state(), { page_permissions: ['card_queue', 'coupons', 'users'], token_version: 5 });
    assert.equal(bumped.sessionsRevoked, true);
    assert.deepEqual(bumped.after, {
      page_permissions: ['card_queue', 'coupons', 'users'],
      grant_changes: { added: ['coupons'], removed: [], actions_gained: ['coupons.read', 'coupons.write'], actions_lost: [] },
      token_version_bumped: true,
    });
    const kept = rules.savedChange(grantPlan, state(), { page_permissions: ['card_queue', 'coupons', 'users'], token_version: 4 });
    assert.equal(kept.sessionsRevoked, false);
    assert.equal('token_version_bumped' in kept.after, false);
    const composed = rules.savedChange(grantPlan, state(), { page_permissions: ['card_queue', 'coupons', 'users', 'withdrawals'], token_version: 5 });
    assert.deepEqual((composed.after.grant_changes as { added: string[] }).added, ['withdrawals', 'coupons']);
    const titlePlan = plan({ role_title: 'Lead' });
    const titled = rules.savedChange(titlePlan, state(), { page_permissions: ['card_queue', 'users'], token_version: 5 });
    assert.deepEqual(titled, { after: { role_title: 'Lead', token_version_bumped: true }, sessionsRevoked: true });
  });
});

describe('planDelete', () => {
  test('keeps the existing deletion safeguards', () => {
    assert.equal(rules.planDelete(state({ deleted_at: '2026-09-01T00:00:00.000Z', is_active: false })).ok, false);
    const superAdmin = rules.planDelete(state({ is_super_admin: true, is_active: false }));
    assert.equal(superAdmin.ok ? '' : superAdmin.code, 'VALIDATION_ERROR');
    const active = rules.planDelete(state());
    assert.equal(active.ok ? '' : active.code, 'STATE_CONFLICT');
    assert.equal(rules.planDelete(state({ is_active: false })).ok, true);
  });
});

describe('page grant groups', () => {
  test('every grantable page key appears exactly once, grouped like the navigation', () => {
    const keys = model.PAGE_GRANT_GROUPS.flatMap((group) => group.grants.map((grant) => grant.key));
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(new Set(keys), new Set(rules.GRANTABLE_PAGE_KEYS));
    const navOrder = nav.NAV_GROUPS.map((group) => group.label);
    const groupOrder = model.PAGE_GRANT_GROUPS.map((group) => group.label);
    assert.deepEqual(groupOrder, navOrder.filter((label) => groupOrder.includes(label)));
  });

  test('a page is offered exactly when its bundle holds no super-administrator-only action', () => {
    const offered = new Set(model.PAGE_GRANT_GROUPS.flatMap((group) => group.grants.map((grant) => grant.key)));
    for (const key of Object.keys(LEGACY_PERMISSION_MAP)) {
      const superOnly = LEGACY_PERMISSION_MAP[key].some((permission) => permissionStatus(permission) === 'super_only');
      assert.equal(offered.has(key), !superOnly, key);
    }
    assert.ok(!offered.has('admin_accounts'));
  });

  test('freezing users sits right after Users in People, and Admins is not offered', () => {
    const people = model.PAGE_GRANT_GROUPS.find((group) => group.label === 'People');
    const keys = people?.grants.map((grant) => grant.key) ?? [];
    assert.equal(keys[keys.indexOf('users') + 1], 'users_freeze');
    assert.ok(!keys.includes('admin_accounts'));
  });

  test('each page shows exactly the actions its key grants, with nav labels', () => {
    for (const group of model.PAGE_GRANT_GROUPS) {
      for (const grant of group.grants) {
        assert.deepEqual([...grant.actions], [...LEGACY_PERMISSION_MAP[grant.key]], grant.key);
      }
    }
    const rewards = model.PAGE_GRANT_GROUPS.flatMap((group) => group.grants).find((grant) => grant.key === 'bonuses_rewards');
    assert.equal(rewards?.label, 'Bonuses & Levels');
  });

  test('pages that only open for super admins say so', () => {
    const grants = model.PAGE_GRANT_GROUPS.flatMap((group) => group.grants);
    for (const key of Object.keys(model.SUPER_ADMIN_ONLY_ROUTES)) {
      const grant = grants.find((item) => item.key === key);
      assert.ok(grant?.notes.some((note) => note.tone === 'warning' && /super administrators/.test(note.text)), key);
    }
  });

  test('the super-admin-only notes still match the routes they describe', () => {
    for (const [key, folder] of Object.entries(model.SUPER_ADMIN_ONLY_ROUTES)) {
      const source = readFileSync(new URL(`../app/api/${folder}/route.ts`, import.meta.url), 'utf8');
      const superOnly = /requireSuperAdmin\(\)/.test(source) || /!\s*admin\??\.is_super_admin\b/.test(source);
      const grantCheck = /requireAdmin(Any|All)?\(/.test(source) || /page_permissions/.test(source);
      assert.ok(superOnly && !grantCheck, `${folder} no longer looks super-admin-only; update the ${key} note`);
    }
  });

  test('the user activity grant says it also unlocks the dashboard activity metrics', () => {
    const grant = model.PAGE_GRANT_GROUPS.flatMap((group) => group.grants).find((item) => item.key === 'user_activity_monitor');
    assert.ok(grant?.notes.some((note) => /dashboard/i.test(note.text)));
    const dashboard = readFileSync(new URL('../app/lib/dashboard.ts', import.meta.url), 'utf8');
    assert.match(dashboard, /activity:\s*'user_activity\.read'/);
  });
});

describe('additional permissions', () => {
  test('in-use and reserved groups cover the additional set exactly once', () => {
    const shown = [...model.ENFORCED_ADDITIONAL_GROUPS, ...model.RESERVED_ADDITIONAL_GROUPS]
      .flatMap((group) => group.grants.map((grant) => grant.key));
    assert.equal(new Set(shown).size, shown.length);
    assert.deepEqual(new Set(shown), new Set(rules.ADDITIONAL_PERMISSIONS));
    for (const grant of model.ENFORCED_ADDITIONAL_GROUPS.flatMap((group) => group.grants)) {
      assert.equal(grant.risk, PERMISSION_CATALOG[grant.key].risk);
      assert.equal(grant.enforced, true);
    }
  });

  test('wallet adjustments are checked now, while the second-approval key stays reserved', () => {
    assert.ok(model.ENFORCED_ADDITIONAL.includes('wallets.adjust'));
    assert.ok(!model.ENFORCED_ADDITIONAL.includes('wallets.approve_adjustment'));
    assert.ok(model.RESERVED_ADDITIONAL.includes('wallets.approve_adjustment'));
    const grant = model.ENFORCED_ADDITIONAL_GROUPS.flatMap((group) => group.grants).find((item) => item.key === 'wallets.adjust');
    assert.equal(grant?.label, 'Adjust wallets');
    assert.equal(grant?.risk, 'critical');
  });

  test('the in-use list comes from the catalog statuses, so it cannot drift from what is checked', () => {
    assert.deepEqual(
      [...model.ENFORCED_ADDITIONAL],
      rules.ADDITIONAL_PERMISSIONS.filter((key) => permissionStatus(key) === 'enforced'),
    );
    assert.deepEqual(new Set(model.ENFORCED_ADDITIONAL), new Set([
      'flags.read', 'flags.resolve', 'sensitive_data.download', 'sensitive_data.share', 'users.delete', 'wallets.adjust',
    ]));
    for (const key of model.RESERVED_ADDITIONAL) assert.notEqual(permissionStatus(key), 'enforced', key);
  });
});

describe('stored extras and summaries', () => {
  test('restricted, retired and unknown keys are listed so they can be removed', () => {
    const extras = model.extraGrants(['admin_accounts', 'giftbox', 'mystery', 'coupons', 'flags.read']);
    assert.deepEqual(extras.map((extra) => [extra.key, extra.kind]), [
      ['admin_accounts', 'restricted'],
      ['giftbox', 'retired'],
      ['mystery', 'unknown'],
    ]);
  });

  test('summarises pages, additional permissions and critical actions', () => {
    const summary = model.accessSummary(['withdrawals', 'coupons', 'sensitive_data.share', 'giftbox']);
    assert.equal(summary.pages, 2);
    assert.equal(summary.additional, 1);
    assert.equal(summary.other, 1);
    assert.equal(summary.highest, 'critical');
    const critical = [...rules.effectiveActions(['withdrawals', 'coupons', 'sensitive_data.share'])]
      .filter((key: Permission) => PERMISSION_CATALOG[key].risk === 'critical').length;
    assert.equal(summary.critical, critical);
    assert.deepEqual(summary.labels, ['Withdrawals', 'Coupons', 'Share card submissions']);
  });

  test('catalog keys from a page bundle count as access under their catalog names, as roles now hold them', () => {
    const summary = model.accessSummary(['withdrawals.read', 'withdrawals.approve']);
    assert.equal(summary.pages, 0);
    assert.equal(summary.additional, 2);
    assert.equal(summary.other, 0);
    assert.equal(summary.actions, 2);
    assert.deepEqual(summary.labels, [
      PERMISSION_CATALOG['withdrawals.read'].label, PERMISSION_CATALOG['withdrawals.approve'].label,
    ]);
    assert.equal(model.grantLabel('withdrawals.read'), PERMISSION_CATALOG['withdrawals.read'].label);
    assert.equal(model.grantLabel('sensitive_data.share'), PERMISSION_CATALOG['sensitive_data.share'].label);
    assert.equal(model.grantLabel('withdrawals'), 'Withdrawals');
    assert.equal(model.grantLabel('mystery'), 'mystery');
    assert.equal(model.holdsCritical(row({ page_permissions: ['withdrawals.approve'] })), true);
    const cell = textOf(render(createElement(accessParts.AccessCell, {
      admin: row({ page_permissions: ['withdrawals.read', 'withdrawals.approve'] }),
    })));
    assert.match(cell, /^0 pages · 2 additional Critical risk /);
    assert.doesNotMatch(cell, /No access/);
  });

  test('counts statuses and critical holders without deleted or super admins', () => {
    const admins = [
      row(),
      row({ id: 'b', page_permissions: ['withdrawals'] }),
      row({ id: 'c', is_active: false }),
      row({ id: 'd', is_super_admin: true, page_permissions: [] }),
      row({ id: 'e', is_active: false, deleted_at: '2026-09-01T00:00:00.000Z', page_permissions: ['withdrawals'] }),
    ];
    assert.deepEqual(model.adminStats(admins), {
      active: 3, inactive: 1, superAdmins: 1, activeSuperAdmins: 1, critical: 2,
    });
    assert.deepEqual(model.tabCounts(admins), { all: 5, active: 3, inactive: 1, deleted: 1 });
  });
});

describe('list model', () => {
  test('reads the list, lower-cases ids and tolerates null grants', () => {
    const list = model.toAdminList({
      admins: [
        { id: 'ABC', username: 'ada', email: '', role_title: null, page_permissions: null, is_active: true },
        { username: 'no-id' },
      ],
      current_admin_id: 'ABC',
    });
    assert.ok(list);
    assert.equal(list.admins.length, 1);
    assert.equal(list.admins[0].id, 'abc');
    assert.equal(list.admins[0].email, null);
    assert.deepEqual(list.admins[0].page_permissions, []);
    assert.equal(list.admins[0].role_id, null);
    assert.equal(list.admins[0].role, null);
    assert.deepEqual(list.admins[0].direct_permissions, []);
    assert.equal(list.currentAdminId, 'abc');
    assert.equal(model.toAdminList({ admins: 'nope' }), null);
  });

  test('reads invite_pending as true, false, or null when the list could not tell', () => {
    const list = model.toAdminList({
      admins: [
        { id: ADMIN_ID, username: 'ada', invite_pending: true },
        { id: SELF_ID, username: 'owner', invite_pending: false },
        { id: 'c', username: 'old' },
        { id: 'd', username: 'odd', invite_pending: 'yes' },
      ],
    });
    assert.deepEqual(list?.admins.map((admin) => admin.invitePending), [true, false, null, null]);
  });

  test('an invited admin reads as Invited while active, but stays under the Active tab and in its count', () => {
    const invited = row({ id: 'i', invitePending: true, last_login_at: null });
    assert.equal(model.INVITED_LABEL, 'Invited');
    assert.equal(model.isInvited(invited), true);
    assert.equal(model.statusOf(invited), 'active');
    for (const patch of [
      { invitePending: true, is_active: false },
      { invitePending: true, is_active: false, deleted_at: '2026-09-01T00:00:00.000Z' },
      { invitePending: null },
      { invitePending: false },
    ]) {
      assert.equal(model.isInvited(row(patch)), false, JSON.stringify(patch));
    }
    const admins = [row(), invited, row({ id: 'c', is_active: false, invitePending: true })];
    assert.deepEqual(model.tabCounts(admins), { all: 3, active: 2, inactive: 1, deleted: 0 });
    assert.deepEqual(model.visibleAdmins(admins, 'active', '', null).map((admin) => admin.id), [ADMIN_ID, 'i']);
  });

  test('reads the role, its id and the direct grants, and names the role for the table', () => {
    const list = model.toAdminList({
      admins: [
        {
          id: ADMIN_ID,
          username: 'ada',
          page_permissions: ['users', 'withdrawals'],
          role_id: ROLE_ID.toUpperCase(),
          role: { id: ROLE_ID.toUpperCase(), name: 'Manager', archived: false },
          direct_permissions: ['users', 'users'],
        },
        { id: SELF_ID, username: 'root', is_super_admin: true, role_id: null, role: null, direct_permissions: null },
        { id: 'c', username: 'odd', role_id: 'not-a-uuid', role: { id: 'nope', name: 'X' } },
      ],
    });
    assert.ok(list);
    const [ada, root, odd] = list.admins;
    assert.equal(ada.role_id, ROLE_ID);
    assert.deepEqual(ada.role, { id: ROLE_ID, name: 'Manager', archived: false });
    assert.deepEqual(ada.direct_permissions, ['users']);
    assert.equal(model.roleLabel(ada), 'Manager');
    assert.equal(model.roleLabel(root), 'Super administrator');
    assert.deepEqual(root.direct_permissions, []);
    assert.equal(odd.role_id, null);
    assert.equal(odd.role, null);
    assert.equal(model.roleLabel(odd), 'No role');
    assert.equal(model.roleLabel(row({ role_id: ROLE_ID, role: null })), 'Unnamed role');
    assert.equal(model.roleLabel(row({ role_id: ROLE_ID, role: { id: ROLE_ID, name: null, archived: false } })), 'Unnamed role');
  });

  test('filters by tab and search, and sorts with never-signed-in admins last', () => {
    const admins = [
      row({ id: 'a', username: 'zed', last_login_at: null }),
      row({ id: 'b', username: 'amy', last_login_at: '2026-09-01T00:00:00.000Z', email: 'amy@x.ng' }),
      row({ id: 'c', username: 'bob', is_active: false, last_login_at: '2026-09-20T00:00:00.000Z' }),
    ];
    assert.deepEqual(model.visibleAdmins(admins, 'active', '', null).map((admin) => admin.id), ['a', 'b']);
    assert.deepEqual(model.visibleAdmins(admins, 'all', 'AMY@', null).map((admin) => admin.id), ['b']);
    assert.deepEqual(
      model.visibleAdmins(admins, 'all', '', { key: 'username', dir: 'asc' }).map((admin) => admin.username),
      ['amy', 'bob', 'zed'],
    );
    assert.deepEqual(
      model.visibleAdmins(admins, 'all', '', { key: 'last_login_at', dir: 'desc' }).map((admin) => admin.id),
      ['c', 'b', 'a'],
    );
  });

  test('capabilities follow the route safeguards', () => {
    const self = model.capabilitiesFor(row({ id: SELF_ID, is_super_admin: true }), SELF_ID);
    assert.deepEqual(self, {
      edit: false, revoke: false, deactivate: false, reactivate: false, remove: false, resetMfa: false, resendInvite: false,
    });
    const otherSuper = model.capabilitiesFor(row({ is_super_admin: true }), SELF_ID);
    assert.deepEqual(otherSuper, {
      edit: false, revoke: true, deactivate: true, reactivate: false, remove: false, resetMfa: false, resendInvite: false,
    });
    const inactive = model.capabilitiesFor(row({ is_active: false }), SELF_ID);
    assert.deepEqual(inactive, {
      edit: true, revoke: false, deactivate: false, reactivate: true, remove: true, resetMfa: false, resendInvite: false,
    });
    const deleted = model.capabilitiesFor(row({ is_active: false, deleted_at: '2026-09-01T00:00:00.000Z' }), SELF_ID);
    assert.equal(model.hasRowActions(deleted), false);
    assert.equal(deleted.edit, false);
  });

  test('Resend invitation is offered for another admin’s pending invitation only, beside the usual actions', () => {
    const invited = model.capabilitiesFor(row({ invitePending: true, last_login_at: null }), SELF_ID);
    assert.deepEqual(invited, {
      edit: true, revoke: true, deactivate: true, reactivate: false, remove: false, resetMfa: false, resendInvite: true,
    });
    assert.equal(model.hasRowActions({
      edit: false, revoke: false, deactivate: false, reactivate: false, remove: false, resetMfa: false, resendInvite: true,
    }), true);
    for (const patch of [
      { invitePending: true, id: SELF_ID },
      { invitePending: true, is_active: false },
      { invitePending: true, is_active: false, deleted_at: '2026-09-01T00:00:00.000Z' },
      { invitePending: null },
      { invitePending: false },
    ]) {
      assert.equal(model.capabilitiesFor(row(patch), SELF_ID).resendInvite, false, JSON.stringify(patch));
    }
    assert.equal(model.invitePath(ADMIN_ID), `/api/admin-accounts/${ADMIN_ID}/invite`);
  });

  test('reads the invitation outcome of a create and of a resend strictly', () => {
    const invite = { outcome: 'sent', expires_at: '2026-10-22T13:30:00.000Z' };
    assert.deepEqual(model.toInviteResult(invite), { outcome: 'sent', expiresAt: '2026-10-22T13:30:00.000Z' });
    assert.deepEqual(model.toInviteResult({ outcome: 'not_sent', expires_at: null }), { outcome: 'not_sent', expiresAt: null });
    for (const bad of [null, 'sent', { outcome: 'queued' }, { expires_at: invite.expires_at }]) {
      assert.equal(model.toInviteResult(bad), null, JSON.stringify(bad));
    }
    assert.deepEqual(model.toResentInvite({ success: true, invite: { outcome: 'unknown', expires_at: invite.expires_at } }), {
      outcome: 'unknown', expiresAt: invite.expires_at,
    });
    assert.equal(model.toResentInvite({ success: true }), null);
    const created = model.toCreatedAdmin({
      id: ADMIN_ID,
      admin: { id: ADMIN_ID, username: 'tolu', email: 'tolu@cardelite.ng', role_title: 'Payout Officer' },
      invite,
      audit_recorded: false,
      warning: 'The change was saved, but it could not be written to the audit log.',
    });
    assert.equal(created?.admin?.username, 'tolu');
    assert.deepEqual(created?.invite, { outcome: 'sent', expiresAt: invite.expires_at });
    assert.equal(created?.warning, 'The change was saved, but it could not be written to the audit log.');
    assert.equal(model.toCreatedAdmin({ id: ADMIN_ID, admin: null, invite })?.admin, null);
    assert.equal(model.toCreatedAdmin({ id: ADMIN_ID, admin: { id: ADMIN_ID } }), null);
  });

  test('row actions send the existing request shapes plus a reason', () => {
    const admin = row();
    assert.deepEqual(model.rowActionRequest('revoke', admin, 'Lost device'), {
      method: 'PATCH', body: { id: ADMIN_ID, revoke_sessions: true, reason: 'Lost device' },
    });
    assert.deepEqual(model.rowActionRequest('deactivate', admin, 'Left'), {
      method: 'PATCH', body: { id: ADMIN_ID, is_active: false, reason: 'Left' },
    });
    assert.deepEqual(model.rowActionRequest('remove', admin, 'Left'), {
      method: 'DELETE', body: { id: ADMIN_ID, reason: 'Left' },
    });
  });
});

describe('editor model', () => {
  const draft = (patch: Partial<ReturnType<ModelModule['draftFor']>> = {}) => ({ ...model.EMPTY_DRAFT, ...patch });

  test('creating needs a username, email and title, and no password, since the new admin chooses it from the email', () => {
    const errors = model.validateDraft('create', draft());
    assert.deepEqual(Object.keys(errors).sort(), ['email', 'roleTitle', 'username']);
    assert.equal(errors.roleTitle, 'Enter a title.');
    const ready = draft({ username: 'tolu', email: 'tolu@cardelite.ng', roleTitle: 'Payout Officer' });
    assert.deepEqual(model.validateDraft('create', ready), {});
    assert.equal(model.validateDraft('create', { ...ready, roleTitle: 'x' }).roleTitle, 'Title must be 2–64 characters.');
    assert.equal(model.validateDraft('create', { ...ready, email: 'x<a@b.co>' }).email, 'Enter a valid email address.');
    assert.deepEqual(Object.keys(model.EMPTY_DRAFT).sort(), ['email', 'roleTitle', 'username']);
    assert.deepEqual([...model.EDITOR_FIELD_ORDER], ['username', 'email', 'roleTitle']);
  });

  test('editing keeps the email required', () => {
    const base = model.draftFor(row());
    assert.deepEqual(model.validateDraft('edit', base), {});
    assert.deepEqual(Object.keys(base).sort(), ['email', 'roleTitle', 'username']);
    assert.ok(model.validateDraft('edit', { ...base, email: ' ' }).email);
    assert.equal(model.firstError(model.validateDraft('edit', { ...base, email: '', roleTitle: '' })), 'email');
  });

  test('dirty tracking ignores surrounding spaces and leaves access to the Access section', () => {
    const admin = row();
    const base = model.valuesOf(admin);
    assert.deepEqual(base, { email: 'ada@cardelite.ng', roleTitle: 'Card Reviewer' });
    const current = model.draftFor(admin);
    assert.equal(model.isDraftDirty('edit', { ...current, roleTitle: ' Card Reviewer ' }, base), false);
    assert.equal(model.isDraftDirty('edit', { ...current, email: 'ada.obi@cardelite.ng' }, base), true);
    assert.equal(model.isDraftDirty('create', draft(), model.valuesOf(row({ email: null, role_title: '' }))), false);
  });

  test('rebasing keeps the other admin’s values and flags a clashing field', () => {
    const base = { email: 'a@x.ng', roleTitle: 'Reviewer' };
    const local = { email: 'a@x.ng', roleTitle: 'Lead' };
    const server = { email: 'b@x.ng', roleTitle: 'Senior' };
    const rebased = model.rebaseValues(base, local, server);
    assert.deepEqual(rebased.values, { email: 'b@x.ng', roleTitle: 'Lead' });
    assert.deepEqual(rebased.conflicts, ['roleTitle']);
    assert.equal(rebased.changedElsewhere, true);
    assert.equal(model.rebaseValues(base, local, base).changedElsewhere, false);
  });

  test('an edit proposal sends only the changed account fields, never a password and never any access field', () => {
    const live = row();
    const title = model.proposeEdit(live, { email: 'ada@cardelite.ng', roleTitle: 'Lead' });
    assert.equal(title.email, null);
    assert.deepEqual(title.roleTitle, { before: 'Card Reviewer', after: 'Lead' });
    assert.equal(title.revokesSessions, true);
    assert.deepEqual(model.editRequestBody(live.id, title, 'Promoted'), {
      id: ADMIN_ID, reason: 'Promoted', role_title: 'Lead', expected: { role_title: 'Card Reviewer' },
    });
    const email = model.proposeEdit(live, { ...model.valuesOf(live), email: 'new@cardelite.ng' });
    assert.deepEqual(email.email, { before: 'ada@cardelite.ng', after: 'new@cardelite.ng' });
    assert.equal(email.revokesSessions, false);
    assert.equal('password' in email, false);
    assert.equal(model.isEmptyProposal(model.proposeEdit(live, model.valuesOf(live))), true);
    for (const body of [model.editRequestBody(live.id, title, 'x'), model.editRequestBody(live.id, email, 'x')]) {
      for (const field of ['password', 'page_permissions', 'role_id', 'direct_permissions']) assert.equal(field in body, false, field);
      const expected = (body.expected ?? {}) as Record<string, unknown>;
      assert.equal('page_permissions' in expected, false);
    }
  });

  test('the create body trims the account fields and carries the chosen role, or null for No role, and no password', () => {
    const snapshot = draft({ username: ' tolu ', email: ' tolu@cardelite.ng ', roleTitle: ' Payout ' });
    assert.deepEqual(model.createRequestBody(snapshot, ROLE_ID, 'New hire'), {
      username: 'tolu', email: 'tolu@cardelite.ng', role_title: 'Payout', role_id: ROLE_ID, reason: 'New hire',
    });
    assert.deepEqual(model.createRequestBody(snapshot, null, 'New hire'), {
      username: 'tolu', email: 'tolu@cardelite.ng', role_title: 'Payout', role_id: null, reason: 'New hire',
    });
  });
});

const MANAGER_KEYS = ['dashboard', 'users', 'withdrawals'];
const OTHER_ROLE_ID = '5f4e3d2c-1b0a-4987-8654-3210fedcba98';
const SYSTEM_ROLE_ID = '00000000-0000-4000-8000-000000000001';
const ARCHIVED_ROLE_ID = '00000000-0000-4000-8000-000000000002';

function roleRow(patch: Partial<RoleRow> = {}): RoleRow {
  return {
    id: ROLE_ID,
    name: 'Manager',
    description: '',
    permissions: [...MANAGER_KEYS],
    system_key: null,
    is_protected: false,
    version: 1,
    archived_at: null,
    archived_by: null,
    created_at: null,
    created_by: null,
    updated_at: null,
    updated_by: null,
    ...patch,
  };
}

const ROLE_LIST: RoleRow[] = [
  roleRow({ id: SYSTEM_ROLE_ID, name: 'Super administrator', system_key: 'super_admin', is_protected: true, permissions: [] }),
  roleRow({ id: OTHER_ROLE_ID, name: 'Reviewer', permissions: ['card_queue'] }),
  roleRow(),
  roleRow({ id: ARCHIVED_ROLE_ID, name: 'Old desk', archived_at: '2026-10-01T00:00:00.000Z' }),
];

function managerRow(patch: Partial<AdminRow> = {}): AdminRow {
  return row({
    username: 'manager',
    role_title: 'Manager',
    page_permissions: [...MANAGER_KEYS],
    direct_permissions: [...MANAGER_KEYS],
    ...patch,
  });
}

describe('access model', () => {
  test('the expected values are the role, the direct grants and the effective list the last read returned', () => {
    const expected = model.accessOf(managerRow());
    assert.deepEqual(expected, { role_id: null, direct_permissions: MANAGER_KEYS, page_permissions: MANAGER_KEYS });
    assert.deepEqual(model.accessDraftFor(expected), { roleId: null, direct: MANAGER_KEYS, folded: [] });
    assert.deepEqual(model.NO_ACCESS, { role_id: null, direct_permissions: [], page_permissions: [] });
    assert.equal(model.isAccessDirty(expected, model.accessDraftFor(expected)), false);
    assert.equal(model.isAccessDirty(expected, { roleId: null, direct: [...MANAGER_KEYS].reverse(), folded: [] }), false);
    assert.equal(model.isAccessDirty(expected, { roleId: ROLE_ID, direct: MANAGER_KEYS, folded: [] }), true);
    assert.equal(model.isAccessDirty(model.NO_ACCESS, { roleId: null, direct: ['coupons'], folded: [] }), true);
  });

  test('picking the copied Manager role moves the covered direct grants into it, and No role puts them back', () => {
    const start = model.accessDraftFor(model.accessOf(managerRow()));
    const picked = model.pickRole(start, ROLE_ID, MANAGER_KEYS);
    assert.deepEqual(picked, { roleId: ROLE_ID, direct: [], folded: MANAGER_KEYS });
    const cleared = model.pickRole(picked, null, []);
    assert.deepEqual(cleared, { roleId: null, direct: MANAGER_KEYS, folded: [] });
    assert.equal(model.isAccessDirty(model.accessOf(managerRow()), cleared), false);
    assert.deepEqual(model.pickRole(picked, OTHER_ROLE_ID, ['card_queue', 'users.read']), {
      roleId: OTHER_ROLE_ID, direct: MANAGER_KEYS, folded: [],
    });
    assert.deepEqual(model.pickRole({ roleId: null, direct: ['withdrawals.read', 'coupons'], folded: [] }, ROLE_ID, ['withdrawals']), {
      roleId: ROLE_ID, direct: ['coupons'], folded: ['withdrawals.read'],
    });
  });

  test('every action the role holds is locked in the matrix as From role with its name', () => {
    const locks = model.roleLocks(roleRow());
    assert.equal(locks.get('withdrawals.approve'), 'From role Manager');
    assert.equal(locks.get('users.read'), 'From role Manager');
    assert.equal(locks.has('coupons.read'), false);
    assert.equal(locks.size, resolvePermissions(MANAGER_KEYS, false).size);
    assert.equal(model.roleLocks(null).size, 0);
  });

  test('picking a role proposes its name as the title while the title is empty or still names the previous role', () => {
    assert.equal(model.proposedTitle('', null, 'Manager'), 'Manager');
    assert.equal(model.proposedTitle('  ', null, 'Manager'), 'Manager');
    assert.equal(model.proposedTitle('Reviewer', 'Reviewer', 'Manager'), 'Manager');
    assert.equal(model.proposedTitle('Operations lead', 'Reviewer', 'Manager'), null);
    assert.equal(model.proposedTitle('Operations lead', null, 'Manager'), null);
    assert.equal(model.proposedTitle('Manager', null, 'Manager'), null);
    assert.equal(model.proposedTitle('Reviewer', 'Reviewer', null), null);
  });

  test('the role picker offers active, non-system roles by name, and keeps the admin’s own role visible', () => {
    const list = model.toRoleList({
      roles: [...ROLE_LIST.map((role) => (role.id === OTHER_ROLE_ID ? { ...role, id: OTHER_ROLE_ID.toUpperCase() } : role)), {
        id: 'nope', name: 'Broken', version: 1,
      }],
    });
    assert.ok(list);
    assert.equal(list.length, 4);
    assert.equal(list[1].id, OTHER_ROLE_ID);
    assert.deepEqual(model.roleChoices(list, null), [{ id: ROLE_ID, name: 'Manager' }, { id: OTHER_ROLE_ID, name: 'Reviewer' }]);
    assert.deepEqual(model.roleChoices(list, ARCHIVED_ROLE_ID)[0], { id: ARCHIVED_ROLE_ID, name: 'Old desk (archived)' });
    assert.deepEqual(model.roleChoices(list, ROLE_ID).map((choice) => choice.id), [ROLE_ID, OTHER_ROLE_ID]);
    assert.equal(model.toRoleList({ roles: 'nope' }), null);
  });

  test('the dry run and the save send the same change against the values the last read returned', () => {
    const expected = model.accessOf(managerRow());
    const next = model.pickRole(model.accessDraftFor(expected), ROLE_ID, MANAGER_KEYS);
    const preview = model.accessPreviewBody(expected, next);
    assert.deepEqual(preview, {
      role_id: ROLE_ID,
      direct_permissions: [],
      expected: { role_id: null, direct_permissions: MANAGER_KEYS, page_permissions: MANAGER_KEYS },
      dry_run: true,
    });
    const { dry_run: dryRun, ...change } = preview;
    assert.equal(dryRun, true);
    const save = model.accessSaveBody(expected, next, 'Moving the Manager onto the role');
    assert.deepEqual(save, { ...change, reason: 'Moving the Manager onto the role' });
    const directOnly = model.accessPreviewBody(expected, { roleId: null, direct: [...MANAGER_KEYS, 'coupons'], folded: [] });
    assert.equal('role_id' in directOnly, false);
    assert.deepEqual(directOnly.direct_permissions, [...MANAGER_KEYS, 'coupons']);
    const unrole = model.accessPreviewBody(
      { role_id: ROLE_ID, direct_permissions: [], page_permissions: MANAGER_KEYS },
      { roleId: null, direct: [], folded: [] },
    );
    assert.equal(unrole.role_id, null);
    assert.equal('direct_permissions' in unrole, false);
    assert.equal(model.accessPath(ADMIN_ID), `/api/admin-accounts/${ADMIN_ID}/access`);
  });

  test('a reason of at least 3 characters is needed before the save is sent', () => {
    assert.equal(model.accessReasonProblem('ok'), 'Enter a reason of 3 to 500 characters.');
    assert.equal(model.accessReasonProblem('  ab  '), 'Enter a reason of 3 to 500 characters.');
    assert.equal(model.accessReasonProblem('New desk'), null);
  });

  test('reads the dry run and the save the access route answers, and updates the listed row', () => {
    assert.deepEqual(model.toAccessPreview({
      success: true,
      impact: {
        before: MANAGER_KEYS, after: MANAGER_KEYS, gained: [], lost: [], highest_risk: null, changed: false,
        signs_out: false, folded: MANAGER_KEYS,
      },
    }), {
      before: MANAGER_KEYS, after: MANAGER_KEYS, gained: [], lost: [], highestRisk: null, changed: false, signsOut: false,
      folded: MANAGER_KEYS,
    });
    const loss = model.toAccessPreview({
      impact: { before: ['withdrawals'], after: ['withdrawals.read'], gained: [], lost: ['withdrawals.approve', 'nope'], changed: true, signs_out: true },
    });
    assert.deepEqual(loss?.lost, ['withdrawals.approve']);
    assert.equal(loss?.highestRisk, PERMISSION_CATALOG['withdrawals.approve'].risk);
    assert.deepEqual(loss?.folded, []);
    assert.equal(model.toAccessPreview({ impact: { before: [], after: [] } }), null);
    assert.equal(model.toAccessPreview({}), null);
    const saved = model.toAccessResult({
      success: true,
      admin: { id: ADMIN_ID, role_id: ROLE_ID.toUpperCase(), direct_permissions: [], page_permissions: MANAGER_KEYS },
      changed: true,
      signed_out: false,
    });
    assert.deepEqual(saved, {
      access: { role_id: ROLE_ID, direct_permissions: [], page_permissions: MANAGER_KEYS }, changed: true, signedOut: false,
    });
    assert.equal(model.toAccessResult({ changed: true }), null);
    const access = saved?.access;
    assert.ok(access);
    const updated = model.withAccess(managerRow(), access, { id: ROLE_ID, name: 'Manager', archived: false });
    assert.equal(updated.role_id, ROLE_ID);
    assert.deepEqual(updated.direct_permissions, []);
    assert.equal(model.roleLabel(updated), 'Manager');
    assert.equal(model.withAccess(updated, { role_id: null, direct_permissions: ['coupons'], page_permissions: ['coupons'] }, null).role, null);
  });

  test('a stale answer rebases the change onto the server’s values', () => {
    const base = { role_id: null, direct_permissions: ['users', 'withdrawals'], page_permissions: ['users', 'withdrawals'] };
    const local = { roleId: ROLE_ID, direct: ['users', 'coupons'], folded: ['withdrawals'] };
    const server = {
      role_id: null,
      direct_permissions: ['users', 'withdrawals', 'rates_management'],
      page_permissions: ['users', 'withdrawals', 'rates_management'],
    };
    const rebased = model.rebaseAccess(base, local, server);
    assert.deepEqual(rebased.draft, { roleId: ROLE_ID, direct: ['users', 'rates_management', 'coupons'], folded: ['withdrawals'] });
    assert.equal(rebased.changedElsewhere, true);
    assert.equal(model.rebaseAccess(base, model.accessDraftFor(base), { ...base, role_id: OTHER_ROLE_ID }).draft.roleId, OTHER_ROLE_ID);
    assert.equal(model.rebaseAccess(base, local, base).changedElsewhere, false);
    assert.equal(model.rebaseAccess(base, local, { ...base, page_permissions: ['users'] }).changedElsewhere, true);
  });

  test('a stopped preview or save keeps its own outcome, and the old create hand-off notice is gone', () => {
    const failure = (patch: Partial<ApiFailure>): ApiFailure => ({
      kind: 'http', status: 500, code: 'INTERNAL_ERROR', message: 'The access preview could not be loaded. Try again.',
      requestId: null, details: null, outcomeUnknown: false, ...patch,
    });
    assert.deepEqual(model.previewStop(failure({ status: 401, code: 'AUTH_REQUIRED' })), { kind: 'expired' });
    assert.deepEqual(model.previewStop(failure({ status: 409, code: 'STATE_CONFLICT', message: 'That record has changed. Reload and try again.' })), {
      kind: 'stale', message: 'That record has changed. Reload and try again.',
    });
    assert.equal(model.previewStop(failure({ status: 404, code: 'RESOURCE_NOT_FOUND' })).kind, 'stale');
    assert.equal(model.previewStop(failure({ status: 403, code: 'PERMISSION_DENIED' })).kind, 'refused');
    assert.deepEqual(model.previewStop(failure({})), { kind: 'failed', message: 'The access preview could not be loaded. Try again.' });
    assert.deepEqual(model.previewStop(failure({ kind: 'network', status: null, code: null, outcomeUnknown: true })), {
      kind: 'failed', message: model.ACCESS_PREVIEW_UNREACHABLE,
    });
    assert.deepEqual(model.accessStepOf(null), { kind: 'cancelled' });
    assert.deepEqual(model.accessStepOf({ kind: 'reauth', code: 'MFA_REQUIRED', message: model.STEP_UP_MESSAGE.MFA_REQUIRED }), {
      kind: 'reauth', message: 'Set up two-step sign-in on your Profile first.',
    });
    const result = { access: null, changed: true, signedOut: false };
    assert.deepEqual(model.accessStepOf({ kind: 'done', result }), { kind: 'saved', result });
    for (const name of ['createdNotice', 'CREATED_WITHOUT_ACCESS']) assert.equal(name in model, false, name);
  });
});

describe('confirmations', () => {
  const html = (...nodes: ReactNode[]) => render(createElement('div', null, ...nodes));
  const detailRows = (options: { details?: Array<{ label: string; value: ReactNode }> }) =>
    (options.details ?? []).map((detail) => createElement('p', { key: detail.label }, detail.label, ' ', detail.value));
  const managerPreview = {
    before: MANAGER_KEYS, after: MANAGER_KEYS, gained: [], lost: [], highestRisk: null, changed: false, signsOut: false,
    folded: MANAGER_KEYS,
  };

  test('the grant diff shows added and removed keys with risk and the actions that change', () => {
    const change = rules.diffGrants(['coupons'], ['withdrawals']);
    const text = textOf(html(createElement(GrantDiff, { change })));
    assert.match(text, /Granting · 1/);
    assert.match(text, /Removing · 1/);
    assert.match(text, /Critical risk/);
    assert.match(text, /Gains 6 actions/);
    assert.match(text, /Loses 2 actions/);
  });

  test('every access-changing row action requires a reason; deleting also needs the username typed', () => {
    for (const kind of ['revoke', 'deactivate', 'reactivate', 'remove'] as const) {
      const options = confirmOptions.rowActionConfirm(kind, row({ is_active: kind !== 'reactivate' && kind !== 'remove' }));
      assert.equal(options.reason?.required, true, kind);
    }
    assert.equal(confirmOptions.rowActionConfirm('remove', row({ is_active: false })).requireTyped, 'ada');
    assert.equal(confirmOptions.rowActionConfirm('deactivate', row()).tone, 'danger');
  });

  test('row confirmations state the grants before and after', () => {
    const deleting = confirmOptions.rowActionConfirm('remove', row({ is_active: false }));
    assert.match(textOf(html(deleting.message)), /Grants removed for good · 2/);
    assert.doesNotMatch(textOf(html(deleting.message)), /What this admin can do/);
    const deactivating = textOf(html(confirmOptions.rowActionConfirm('deactivate', row()).message));
    assert.match(deactivating, /Access suspended · 2/);
    assert.match(deactivating, /Loses \d+ actions/);
    const restoring = textOf(html(confirmOptions.rowActionConfirm('reactivate', row({ is_active: false })).message));
    assert.match(restoring, /Access restored · 2/);
    const revoking = confirmOptions.rowActionConfirm('revoke', row()).details ?? [];
    assert.deepEqual(revoking.find((detail) => detail.label === 'Access')?.value, 'Unchanged, 2 grants');
    assert.deepEqual(revoking.find((detail) => detail.label === 'Title')?.value, 'Card Reviewer');
  });

  test('the edit confirmation shows before and after values, has no password row, and leaves access to its own step', () => {
    const live = row();
    const proposal = model.proposeEdit(live, { email: 'new@cardelite.ng', roleTitle: 'Lead' });
    const rebased = { values: model.valuesOf(live), conflicts: [], changedElsewhere: false };
    const options = confirmOptions.editConfirm(live, proposal, rebased);
    assert.equal(options.reason?.required, true);
    const text = textOf(html(options.message, ...detailRows(options), ...(options.consequences ?? [])));
    assert.match(text, /Title Card Reviewer → changes to Lead/);
    assert.match(text, /ada@cardelite\.ng → changes to new@cardelite\.ng/);
    assert.match(text, /Access does not change\./);
    assert.match(text, /signed out on every device/);
    assert.deepEqual(options.details?.map((detail) => detail.label), ['Admin', 'Title', 'Email']);
    const pending = textOf(html(confirmOptions.editConfirm(live, proposal, rebased, true).message));
    assert.match(pending, /Your access changes are saved separately with Review access\./);
  });

  test('the create confirmation shows the account and its role, says an invitation goes out, and asks for a reason', () => {
    const snapshot = { ...model.EMPTY_DRAFT, username: 'tolu', email: ' tolu@cardelite.ng ', roleTitle: 'Payout' };
    const withRole = confirmOptions.createConfirm(snapshot, 'Manager');
    assert.equal(withRole.title, 'Create @tolu?');
    assert.equal(textOf(html(withRole.message)), 'The account is created with this role and an invitation email is sent.');
    assert.deepEqual(withRole.details?.map((detail) => [detail.label, detail.value]), [
      ['Username', '@tolu'],
      ['Email', 'tolu@cardelite.ng'],
      ['Title', 'Payout'],
      ['Role', 'Manager'],
    ]);
    assert.deepEqual(withRole.consequences, [
      '@tolu gets an email at tolu@cardelite.ng with a link to choose a password. The link works once, for 72 hours.',
      'They get every action the role Manager holds once they sign in.',
      'Every super administrator gets an alert.',
    ]);
    assert.equal(withRole.reason?.required, true);
    assert.equal(withRole.reason?.maxLength, 500);
    assert.equal(withRole.credential, undefined);
    assert.equal(withRole.confirmLabel, 'Create and send invitation');
    const noRole = confirmOptions.createConfirm(snapshot, null);
    assert.deepEqual(noRole.details?.find((detail) => detail.label === 'Role')?.value, 'No role');
    assert.equal(noRole.consequences?.[1], 'The account has no access until you give it a role in Access.');
    const text = textOf(html(noRole.message, ...detailRows(noRole), ...(noRole.consequences ?? [])));
    assert.doesNotMatch(text, /[Pp]assword:|secure channel|straight away|second change|Additional access/);
  });

  test('the create’s identity check is a follow-up that asks only for a code', () => {
    const options = confirmOptions.createIdentityConfirm({ ...model.EMPTY_DRAFT, username: 'tolu' });
    assert.equal(options.title, 'Confirm it is you');
    assert.equal(
      options.message,
      'New admin accounts need a recent identity check. Enter a code from your authenticator app to create @tolu and send the invitation.',
    );
    assert.deepEqual(options.credential, { kind: 'otp' });
    assert.equal(options.reason, undefined);
    assert.equal(options.confirmLabel, 'Create and send invitation');
  });

  test('after a create or a resend the toast says whether the invitation email went out, with the expiry in WAT', () => {
    const expiresAt = '2026-10-22T13:30:00.000Z';
    const sent = { outcome: 'sent' as const, expiresAt };
    assert.equal(
      confirmOptions.inviteSentText('create', 'tolu@cardelite.ng', sent),
      'Invitation sent to tolu@cardelite.ng. The link works until 22 Oct 2026, 14:30 WAT.',
    );
    assert.equal(confirmOptions.inviteSentText('resend', 'tolu@cardelite.ng', sent), confirmOptions.inviteSentText('create', 'tolu@cardelite.ng', sent));
    assert.equal(
      confirmOptions.inviteSentText('create', 'tolu@cardelite.ng', { outcome: 'not_sent', expiresAt }),
      'The account was created, but the invitation email was not sent. Use Resend invitation.',
    );
    assert.equal(
      confirmOptions.inviteSentText('create', 'tolu@cardelite.ng', { outcome: 'unknown', expiresAt }),
      'The account was created, but we could not confirm the email went out. If it does not arrive, use Resend invitation.',
    );
    assert.equal(
      confirmOptions.inviteSentText('resend', 'tolu@cardelite.ng', { outcome: 'not_sent', expiresAt }),
      'The invitation email was not sent. Use Resend invitation to try again.',
    );
    assert.equal(
      confirmOptions.inviteSentText('resend', 'tolu@cardelite.ng', { outcome: 'unknown', expiresAt }),
      'We could not confirm the email went out. If it does not arrive, use Resend invitation again.',
    );
  });

  test('Resend invitation asks a plain question, with no reason, and Revoke invitation says the link stops working', () => {
    const invited = row({ invitePending: true, last_login_at: null });
    const resend = confirmOptions.resendInviteConfirm(invited);
    assert.equal(resend.title, 'Send a new invitation to ada@cardelite.ng?');
    assert.equal(resend.message, 'The previous link stops working.');
    assert.equal(resend.confirmLabel, 'Send invitation');
    assert.equal(resend.reason, undefined);
    assert.equal(resend.credential, undefined);
    const revoke = confirmOptions.rowActionConfirm('deactivate', invited).consequences ?? [];
    assert.equal(revoke.at(-1), 'The invitation link stops working. Reactivating the account later needs a new invitation.');
    for (const admin of [row(), row({ invitePending: null }), row({ invitePending: true, is_active: false })]) {
      assert.ok(!(confirmOptions.rowActionConfirm('deactivate', admin).consequences ?? []).some((line) => /invitation/.test(line)));
    }
    const revoked = row({ invitePending: true, is_active: false, last_login_at: null });
    const restore = confirmOptions.rowActionConfirm('reactivate', revoked).consequences ?? [];
    assert.equal(restore[0], '@ada has not chosen a password yet, so send a new invitation after reactivating.');
    assert.ok(!restore.some((line) => /existing email and password/.test(line)));
    for (const admin of [row({ is_active: false }), row({ invitePending: null, is_active: false })]) {
      assert.equal(
        (confirmOptions.rowActionConfirm('reactivate', admin).consequences ?? [])[0],
        '@ada can sign in again with their existing email and password.',
      );
    }
  });

  test('moving the live Manager onto a role that matches reads as no change and lists the moved keys', () => {
    const live = managerRow();
    const options = confirmOptions.accessConfirm({
      admin: live,
      preview: managerPreview,
      before: { roleName: null, direct: MANAGER_KEYS },
      after: { roleName: 'Manager', direct: [] },
    });
    const text = textOf(html(options.message, ...detailRows(options), ...(options.consequences ?? [])));
    assert.match(text, /Access unchanged\. @manager stays signed in\./);
    assert.match(text, /Moved into the role: dashboard, users, withdrawals/);
    assert.match(text, /Role No role → changes to Manager/);
    assert.match(text, /Additional access 3 grants → changes to None/);
    assert.deepEqual(options.consequences, []);
    assert.equal(options.reason?.required, true);
    assert.equal(options.credential, undefined);
    assert.equal(options.confirmLabel, 'Save access');
    assert.equal(options.title, 'Change access for @manager?');
  });

  test('an access change that changes what the admin can do lists the actions and today’s sign-out line', () => {
    const preview = {
      before: ['withdrawals'], after: ['withdrawals.read'], gained: [], lost: ['withdrawals.approve' as Permission],
      highestRisk: PERMISSION_CATALOG['withdrawals.approve'].risk, changed: true, signsOut: true, folded: [],
    };
    const sides = { before: { roleName: null, direct: ['withdrawals'] }, after: { roleName: null, direct: ['withdrawals.read'] } };
    const options = confirmOptions.accessConfirm({ admin: row(), preview, ...sides });
    const text = textOf(html(options.message, ...detailRows(options)));
    assert.match(text, /What this admin can do/);
    assert.match(text, /Gains no actions\./);
    assert.match(text, /Loses 1 action:/);
    assert.match(text, /Role No role/);
    assert.doesNotMatch(text, /stays signed in/);
    assert.doesNotMatch(text, /Moved into the role/);
    assert.deepEqual(options.consequences, ['@ada is signed out on every device, web and mobile, and must sign in again.']);
    const inactive = confirmOptions.accessConfirm({ admin: row({ is_active: false }), preview: { ...preview, signsOut: false }, ...sides });
    assert.deepEqual(inactive.consequences, ['@ada is deactivated. These changes apply if the account is reactivated.']);
  });

  test('a pending title change is never covered by a stays-signed-in claim', () => {
    const options = confirmOptions.accessConfirm({
      admin: managerRow(),
      preview: managerPreview,
      before: { roleName: null, direct: MANAGER_KEYS },
      after: { roleName: 'Manager', direct: [] },
      titlePending: true,
    });
    const text = textOf(html(options.message));
    assert.match(text, /Access unchanged\./);
    assert.doesNotMatch(text, /stays signed in/);
    assert.deepEqual(options.consequences, [
      'The new title is saved separately with Review changes, and saving it signs @manager out on every device.',
    ]);
    const inactive = textOf(html(confirmOptions.accessConfirm({
      admin: managerRow({ is_active: false }),
      preview: managerPreview,
      before: { roleName: null, direct: MANAGER_KEYS },
      after: { roleName: 'Manager', direct: [] },
    }).message));
    assert.doesNotMatch(inactive, /stays signed in/);
  });

  test('the identity check is a follow-up that asks only for a code, and the toast follows the save', () => {
    const options = confirmOptions.accessIdentityConfirm(row());
    assert.deepEqual(options.credential, { kind: 'otp' });
    assert.equal(options.reason, undefined);
    assert.equal(options.title, 'Confirm it is you');
    assert.match(String(options.message), /authenticator app/);
    assert.equal(
      confirmOptions.accessSavedText(row(), { access: null, changed: true, signedOut: true }),
      'Saved access for @ada. They were signed out everywhere and must sign in again.',
    );
    assert.equal(confirmOptions.accessSavedText(row(), { access: null, changed: true, signedOut: false }), 'Saved access for @ada. They stay signed in.');
    assert.equal(confirmOptions.accessSavedText(row({ is_active: false }), { access: null, changed: true, signedOut: false }), 'Saved access for @ada.');
    assert.equal(confirmOptions.accessSavedText(row(), { access: null, changed: false, signedOut: false }), 'Nothing changed. This access was already live.');
  });
});

describe('rendered access section', () => {
  const noop = () => {};
  const roleFailure: ApiFailure = {
    kind: 'http', status: 500, code: 'INTERNAL_ERROR', message: 'Roles could not be loaded.', requestId: 'req_roles',
    details: null, outcomeUnknown: false,
  };
  const section = (props: Record<string, unknown> = {}) => render(createElement(editorModule.AccessSection, {
    mode: 'edit',
    roles: ROLE_LIST,
    rolesError: null,
    rolesRetrying: false,
    onRetryRoles: noop,
    base: { role_id: null, direct_permissions: ['withdrawals'], page_permissions: ['withdrawals'] },
    draft: { roleId: null, direct: ['withdrawals'], folded: [] },
    onRole: noop,
    onReview: noop,
    ...props,
  }));
  const checkboxes = (html: string) => tagsOf(html, 'input').filter((input) => input.type === 'checkbox');
  const optionsOf = (html: string) => [...html.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map((match) => ({
    value: tagsOf(`<option${match[1]}>`, 'option')[0].value,
    label: match[2],
    selected: 'selected' in tagsOf(`<option${match[1]}>`, 'option')[0],
  }));

  test('offers No role and the active roles, and Review access waits for a change', () => {
    const html = section();
    assert.deepEqual(optionsOf(html).map((option) => [option.value, option.label, option.selected]), [
      ['', 'No role', true],
      [ROLE_ID, 'Manager', false],
      [OTHER_ROLE_ID, 'Reviewer', false],
    ]);
    const idle = buttonByText(html, 'Review access');
    assert.ok(idle && 'disabled' in idle);
    const changed = section({ draft: { roleId: ROLE_ID, direct: [], folded: ['withdrawals'] } });
    assert.equal(optionsOf(changed).find((option) => option.selected)?.value, ROLE_ID);
    const ready = buttonByText(changed, 'Review access');
    assert.ok(ready && !('disabled' in ready));
    assert.equal(checkboxes(changed).length, 0);
  });

  test('the Access step shows only the role picker: permissions are shown and edited on the Roles page', () => {
    const html = section({ draft: { roleId: ROLE_ID, direct: ['coupons'], folded: [] } });
    const text = textOf(html);
    assert.equal(checkboxes(html).length, 0);
    assert.doesNotMatch(text, /From role|Additional access|Not in use yet|Super administrators only/);
    assert.match(text, /The Roles page shows and edits them\./);
  });

  test('a change made elsewhere is announced above the role picker', () => {
    const html = section({
      base: { role_id: null, direct_permissions: ['coupons', 'giftbox'], page_permissions: ['coupons', 'giftbox'] },
      draft: { roleId: null, direct: ['coupons', 'giftbox'], folded: [] },
      notice: model.ACCESS_CHANGED_ELSEWHERE,
    });
    const text = textOf(html);
    assert.match(text, /Another admin changed this account’s access while you were editing/);
    assert.doesNotMatch(text, /Other stored keys/);
  });

  test('creating has no Review access button, and the roles list has its loading and error states', () => {
    const creating = section({
      mode: 'create',
      onReview: undefined,
      base: model.NO_ACCESS,
      draft: { roleId: null, direct: [], folded: [] },
    });
    assert.equal(buttonByText(creating, 'Review access'), undefined);
    assert.match(
      textOf(creating),
      /Given with the account\. Creating it needs two-step sign-in, a recent identity check and a reason\./,
    );
    assert.doesNotMatch(textOf(creating), /Saved right after the account is created/);
    assert.deepEqual(optionsOf(creating).map((option) => [option.value, option.label]), [
      ['', 'No role'],
      [ROLE_ID, 'Manager'],
      [OTHER_ROLE_ID, 'Reviewer'],
    ]);
    assert.match(textOf(section({ roles: undefined })), /Loading roles…/);
    const failed = section({ roles: undefined, rolesError: roleFailure });
    assert.match(textOf(failed), /Roles could not be loaded/);
    assert.ok(buttonByText(failed, 'Try again'));
    assert.equal(tagsOf(failed, 'select').length, 0);
  });

  test('while a save runs, the role picker is frozen', () => {
    const html = section({ disabled: true, draft: { roleId: ROLE_ID, direct: [], folded: [] } });
    assert.ok('disabled' in tagsOf(html, 'select')[0]);
    assert.equal(checkboxes(html).length, 0);
  });
});

describe('rendered admin details', () => {
  const noop = () => {};
  const details = (admin: AdminRow) => textOf(render(createElement(detailsModule.AdminDetails, { admin, onClose: noop })));

  test('shows the role, the title, the direct grants and the effective access summary', () => {
    const text = details(row({
      role_id: ROLE_ID,
      role: { id: ROLE_ID, name: 'Manager', archived: false },
      page_permissions: ['withdrawals', 'coupons'],
      direct_permissions: ['coupons'],
    }));
    assert.match(text, /Role Manager/);
    assert.match(text, /Title Card Reviewer/);
    assert.match(text, /Direct grants Coupons coupons Medium risk/);
    assert.match(text, /Effective access 8 actions in total, from the role and direct grants\./);
    assert.match(text, /Critical risk/);
  });

  test('an admin without a role or grants says so, and a super admin shows only the account', () => {
    const none = details(row({ page_permissions: [], direct_permissions: [] }));
    assert.match(none, /Role No role/);
    assert.match(none, /No direct grants\./);
    assert.match(none, /No actions\./);
    const direct = details(row());
    assert.match(direct, /10 actions in total, from direct grants\./);
    const root = details(row({ is_super_admin: true }));
    assert.match(root, /Role Super administrator/);
    assert.match(root, /roles and direct grants do not apply/);
    assert.doesNotMatch(root, /Effective access/);
    const gone = details(row({ is_active: false, deleted_at: '2026-09-01T00:00:00.000Z' }));
    assert.match(gone, /Access it held/);
  });

  test('an invited admin reads Invited for the status and the last sign-in, and an unknown invite state reads as today', () => {
    const invited = details(row({ invitePending: true, last_login_at: null }));
    assert.match(invited, /Status Invited Last sign-in Invited Created/);
    const unknown = details(row({ invitePending: null, last_login_at: null }));
    assert.match(unknown, /Status Active Last sign-in Never Created/);
    const revoked = details(row({ invitePending: true, is_active: false, last_login_at: null }));
    assert.match(revoked, /Status Inactive Last sign-in Never Created/);
  });
});

function buttonByText(html: string, label: string): Attrs | undefined {
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (textOf(match[2]) === label) return tagsOf(`<button${match[1]}>`, 'button')[0];
  }
  return undefined;
}

function badgeTones(html: string): string[] {
  return tagsOf(html, 'span')
    .filter((attrs) => classesOf(attrs).includes('badge'))
    .map((attrs) => classesOf(attrs).filter((name) => name !== 'badge').join(' '));
}

describe('two-step status in the list', () => {
  test('reads each admin’s two-step status, the policy and the acting admin’s own status', () => {
    const list = model.toAdminList({
      admins: [
        {
          id: ADMIN_ID,
          username: 'ada',
          is_active: true,
          mfa_status: 'active',
          mfa_confirmed_at: '2026-10-12T09:05:00.000Z',
          mfa_locked_until: null,
          mfa_last_used_at: '2026-10-13T08:00:00.000Z',
          recovery_codes_left: 8,
          live_sessions: 2,
          last_seen_at: '2026-10-13T08:59:00.000Z',
        },
        { id: 'B', username: 'old', deleted_at: '2026-09-01T00:00:00.000Z', mfa_status: null, recovery_codes_left: null },
      ],
      current_admin_id: SELF_ID,
      security: {
        mfa_mode: 'all', mfa_grace_ends_at: GRACE_END, mfa_required_now: false, actor_mfa_status: 'active', status_loaded: true,
      },
    });
    assert.ok(list);
    assert.deepEqual(list.admins[0].security, security());
    assert.equal(list.admins[1].security, null);
    assert.deepEqual(list.policy, GRACE_POLICY);
    assert.equal(list.actorTwoStep, 'active');
    assert.equal(list.securityLoaded, true);
    const older = model.toAdminList({ admins: [{ id: ADMIN_ID, username: 'ada' }] });
    assert.ok(older);
    assert.equal(older.admins[0].security, null);
    assert.deepEqual(older.policy, model.POLICY_OFF);
    assert.equal(older.actorTwoStep, null);
    assert.equal(older.securityLoaded, false);
    assert.equal(model.toSecurityPolicy({ mfa_mode: 'off', mfa_grace_ends_at: GRACE_END, mfa_required_now: true }).requiredNow, false);
  });

  test('an account returned by a change keeps the two-step status the list already had', () => {
    const list: AdminList = {
      admins: [row({ security: security() })],
      currentAdminId: SELF_ID,
      policy: OFF_POLICY,
      actorTwoStep: 'active',
      securityLoaded: true,
    };
    const merged = model.withAdmin(list, row({ role_title: 'Lead' }));
    assert.equal(merged?.admins[0].role_title, 'Lead');
    assert.deepEqual(merged?.admins[0].security, security());
    assert.equal(model.withAdmin(list, row({ security: security({ recoveryCodesLeft: 2 }) }))?.admins[0].security?.recoveryCodesLeft, 2);
  });

  test('the cell state covers every status, the lock and the requirement', () => {
    const state = (patch: Partial<AdminRow>, policy: SecurityPolicy = OFF_POLICY) => model.mfaCellState(row(patch), policy, NOW);
    const off = security({ mfaStatus: 'none', confirmedAt: null, recoveryCodesLeft: 0 });
    assert.deepEqual(state({ security: security() }), { kind: 'on', codesLeft: 8 });
    assert.deepEqual(state({ security: security({ lockedUntil: LOCK_TODAY }) }), { kind: 'locked', until: '10:20 WAT' });
    assert.deepEqual(state({ security: security({ lockedUntil: LOCK_TOMORROW }) }), { kind: 'locked', until: '14 Oct, 10:00 WAT' });
    assert.deepEqual(state({ security: security({ lockedUntil: '2026-10-13T08:00:00.000Z' }) }), { kind: 'on', codesLeft: 8 });
    assert.deepEqual(state({ security: security({ mfaStatus: 'pending' }) }), { kind: 'pending' });
    assert.deepEqual(state({ security: off }), { kind: 'off', due: 'none' });
    assert.deepEqual(state({ security: off }, GRACE_POLICY), { kind: 'off', due: 'grace', date: '27 Oct' });
    assert.deepEqual(state({ security: off }, REQUIRED_POLICY), { kind: 'off', due: 'required' });
    assert.deepEqual(state({ security: off }, { ...GRACE_POLICY, graceEndsAt: '2026-10-13T08:00:00.000Z' }), { kind: 'off', due: 'required' });
    assert.deepEqual(state({ security: off, is_active: false }, REQUIRED_POLICY), { kind: 'off', due: 'none' });
    assert.deepEqual(state({ security: null }), { kind: 'unknown' });
    assert.deepEqual(state({ security: security(), deleted_at: '2026-09-01T00:00:00.000Z' }), { kind: 'deleted' });
  });

  test('the stat counts active admins who use two-step sign-in and flags missing ones while it is required', () => {
    const stats = model.twoStepStats([
      row({ id: 'a', security: security() }),
      row({ id: 'b', security: security({ mfaStatus: 'none' }) }),
      row({ id: 'c', is_active: false, security: security({ mfaStatus: 'none' }) }),
      row({ id: 'd', deleted_at: '2026-09-01T00:00:00.000Z' }),
    ]);
    assert.deepEqual(stats, { active: 2, enrolled: 1, missing: 1, known: true });
    assert.deepEqual(model.twoStepStat(stats, OFF_POLICY, true, NOW), {
      value: '1 of 2', hint: 'active admins', tone: undefined, unavailable: false,
    });
    assert.deepEqual(model.twoStepStat(stats, GRACE_POLICY, true, NOW), {
      value: '1 of 2', hint: 'active admins · required from 27 Oct', tone: 'warning', unavailable: false,
    });
    assert.equal(model.twoStepStat(stats, REQUIRED_POLICY, true, NOW).tone, 'danger');
    assert.equal(model.twoStepStat({ ...stats, enrolled: 2, missing: 0 }, GRACE_POLICY, true, NOW).tone, undefined);
    assert.equal(model.twoStepStat(stats, OFF_POLICY, false, NOW).unavailable, true);
    assert.equal(model.twoStepStats([row({ security: null })]).known, false);
  });
});

describe('rendered two-step cell', () => {
  const cell = (state: MfaCellState) => render(createElement(securityParts.MfaCell, { state }));

  test('on shows a success badge and the recovery codes left, warning at 3 or fewer and danger at none', () => {
    const on = cell({ kind: 'on', codesLeft: 8 });
    assert.equal(textOf(on), 'On 8 recovery codes');
    assert.deepEqual(badgeTones(on), ['success']);
    assert.equal(withClass(on, 'span', 'sub').length, 1);
    assert.equal(textOf(cell({ kind: 'on', codesLeft: 1 })), 'On 1 recovery code');
    assert.equal(withClass(cell({ kind: 'on', codesLeft: 3 }), 'span', 'subWarning').length, 1);
    const none = cell({ kind: 'on', codesLeft: 0 });
    assert.equal(textOf(none), 'On No recovery codes left');
    assert.equal(withClass(none, 'span', 'subDanger').length, 1);
  });

  test('a lock says until when, with the date when it ends on another day', () => {
    assert.equal(textOf(cell({ kind: 'locked', until: '10:20 WAT' })), 'Locked until 10:20 WAT');
    assert.equal(textOf(cell({ kind: 'locked', until: '14 Oct, 10:00 WAT' })), 'Locked until 14 Oct, 10:00 WAT');
    assert.deepEqual(badgeTones(cell({ kind: 'locked', until: null })), ['danger']);
  });

  test('off is muted unless two-step sign-in is required, and deleted or unknown accounts show a dash', () => {
    const off = cell({ kind: 'off', due: 'none' });
    assert.equal(textOf(off), 'Off');
    assert.deepEqual(badgeTones(off), []);
    assert.equal(withClass(off, 'span', 'muted').length, 1);
    const due = cell({ kind: 'off', due: 'grace', date: '27 Oct' });
    assert.equal(textOf(due), 'Off Due 27 Oct');
    assert.deepEqual(badgeTones(due), ['warning']);
    const required = cell({ kind: 'off', due: 'required' });
    assert.equal(textOf(required), 'Off Set up at next sign-in');
    assert.deepEqual(badgeTones(required), ['danger']);
    assert.equal(textOf(cell({ kind: 'pending' })), 'Setup started');
    assert.deepEqual(badgeTones(cell({ kind: 'pending' })), ['neutral']);
    assert.equal(textOf(cell({ kind: 'deleted' })), '— Not applicable');
    assert.equal(textOf(cell({ kind: 'unknown' })), '— Not available');
  });

  test('the phone list names two-step sign-in in its badge', () => {
    assert.deepEqual(securityParts.mfaSummary({ kind: 'on', codesLeft: 8 }), { label: 'Two-step on', tone: 'success' });
    assert.deepEqual(securityParts.mfaSummary({ kind: 'locked', until: null }), { label: 'Two-step locked', tone: 'danger' });
    assert.deepEqual(securityParts.mfaSummary({ kind: 'pending' }), { label: 'Two-step setup started', tone: 'neutral' });
    assert.deepEqual(securityParts.mfaSummary({ kind: 'off', due: 'none' }), { label: 'Two-step off', tone: 'neutral' });
    assert.deepEqual(securityParts.mfaSummary({ kind: 'off', due: 'grace', date: '27 Oct' }), { label: 'Two-step off', tone: 'warning' });
    assert.equal(securityParts.mfaSummary({ kind: 'deleted' }), null);
    assert.equal(securityParts.mfaSummary({ kind: 'unknown' }), null);
    const badge = render(createElement(securityParts.MfaBadge, { state: { kind: 'off', due: 'required' } }));
    assert.equal(textOf(badge), 'Two-step off');
    assert.deepEqual(badgeTones(badge), ['danger']);
  });
});

describe('resetting another admin’s two-step sign-in', () => {
  test('the reset is offered only for another, undeleted admin whose two-step sign-in is on', () => {
    const can = (patch: Partial<AdminRow>) => model.capabilitiesFor(row(patch), SELF_ID).resetMfa;
    assert.equal(can({ security: security() }), true);
    assert.equal(can({ security: security({ lockedUntil: LOCK_TODAY }) }), true);
    assert.equal(can({ is_active: false, security: security() }), true);
    assert.equal(can({ is_super_admin: true, security: security() }), true);
    assert.equal(can({ security: security({ mfaStatus: 'pending' }) }), false);
    assert.equal(can({ security: security({ mfaStatus: 'none' }) }), false);
    assert.equal(can({ security: null }), false);
    assert.equal(can({ id: SELF_ID, security: security() }), false);
    assert.equal(can({ is_active: false, deleted_at: '2026-09-01T00:00:00.000Z', security: security() }), false);
    assert.equal(model.hasRowActions({
      edit: false, revoke: false, deactivate: false, reactivate: false, remove: false, resetMfa: true, resendInvite: false,
    }), true);
  });

  test('the acting super admin needs their own two-step sign-in first', () => {
    assert.equal(model.actorCanReset('active'), true);
    for (const status of ['none', 'pending', null] as const) assert.equal(model.actorCanReset(status), false);
    assert.equal(model.ACTOR_TWO_STEP_FIRST, 'Set up two-step sign-in on your Profile first.');
  });

  test('a reset that is no longer possible explains why nothing changed', () => {
    assert.equal(model.resetBlockedText(row({ id: SELF_ID }), true), model.OWN_RESET_TEXT);
    assert.match(model.resetBlockedText(row({ deleted_at: '2026-09-01T00:00:00.000Z' }), false), /was deleted/);
    assert.match(model.resetBlockedText(row({ security: security({ mfaStatus: 'none' }) }), false), /nothing to reset/);
    assert.match(model.resetBlockedText(row({ security: null }), false), /could not be checked/);
  });

  test('the reset confirm needs a reason and a code from the authenticator app, and says what happens next', () => {
    const options = confirmOptions.resetMfaConfirm(row({ security: security() }), OFF_POLICY, NOW);
    assert.equal(options.tone, 'danger');
    assert.equal(options.title, 'Reset two-step sign-in for @ada?');
    assert.equal(options.reason?.required, true);
    assert.deepEqual(options.reason?.presets, confirmOptions.RESET_REASONS);
    assert.deepEqual(options.credential, { kind: 'otp' });
    assert.equal(options.confirmLabel, 'Reset two-step sign-in');
    assert.equal(options.pendingLabel, 'Resetting two-step sign-in…');
    const text = textOf(render(createElement(
      'div',
      null,
      options.message,
      ...(options.details ?? []).map((detail) => createElement('p', { key: detail.label }, detail.label, ' ', detail.value)),
    )));
    assert.match(text, /Their password does not change\./);
    assert.match(text, /Two-step sign-in On since 12 Oct 2026 → changes to Off/);
    assert.match(text, /Recovery codes left 8/);
    assert.deepEqual(options.consequences, [
      'Their authenticator app and recovery codes stop working straight away.',
      'They are signed out everywhere, on the web and in the mobile app.',
      'They can set it up again on their Profile.',
      'Super administrators get an alert, and @ada sees the reset on their Profile.',
    ]);
    assert.equal(
      confirmOptions.resetMfaConfirm(row({ security: security() }), GRACE_POLICY, NOW).consequences?.[2],
      'They are asked to set it up again by 27 Oct 2026, and must set it up when they sign in after that.',
    );
    assert.equal(
      confirmOptions.resetMfaConfirm(row({ security: security() }), REQUIRED_POLICY, NOW).consequences?.[2],
      'They must set it up again the next time they sign in.',
    );
    const locked = confirmOptions.resetMfaConfirm(row({ security: security({ lockedUntil: LOCK_TOMORROW }) }), OFF_POLICY, NOW);
    const lockedText = textOf(render(createElement(
      'div',
      null,
      ...(locked.details ?? []).map((detail) => createElement('p', { key: detail.label }, detail.value)),
    )));
    assert.match(lockedText, /Locked until 14 Oct, 10:00 WAT → changes to Off/);
  });

  test('the reset goes to its own route and reads the reset result', () => {
    assert.equal(model.adminMfaPath(ADMIN_ID), `/api/admin-accounts/${ADMIN_ID}/mfa`);
    assert.deepEqual(model.toResetResult({
      success: true, ok: true, previous_status: 'active', sessions_revoked: 3, audit_recorded: true,
    }), { previousStatus: 'active', sessionsRevoked: 3, auditRecorded: true, warning: null });
    assert.equal(model.toResetResult({ success: true, ok: false }), null);
    assert.equal(model.toResetResult({ success: true, ok: true, audit_recorded: false, warning: 'w' })?.warning, 'w');
    assert.equal(confirmOptions.resetSuccess(row()), '@ada’s two-step sign-in was reset and they were signed out everywhere.');
  });

  test('a code prompt or a missing two-step sign-in keeps its own outcome instead of reading as a refusal', () => {
    const failure = (patch: Partial<ApiFailure>): ApiResult<MutationResult> => ({
      ok: false,
      error: {
        kind: 'http', status: 403, code: 'PERMISSION_DENIED', message: 'No', requestId: null, details: null,
        outcomeUnknown: false, ...patch,
      },
    });
    assert.deepEqual(model.classifyMutation(failure({ code: 'REAUTH_REQUIRED', message: 'Confirm it is you to continue.' })), {
      kind: 'reauth', code: 'REAUTH_REQUIRED', message: model.STEP_UP_MESSAGE.REAUTH_REQUIRED,
    });
    assert.deepEqual(model.classifyMutation(failure({ code: 'MFA_REQUIRED', message: 'Set up two-step sign-in first.' })), {
      kind: 'reauth', code: 'MFA_REQUIRED', message: 'Set up two-step sign-in on your Profile first.',
    });
    assert.deepEqual(model.classifyMutation(failure({})), { kind: 'refused', message: 'No' });
    assert.equal(model.classifyMutation(failure({ status: 400, code: 'VALIDATION_ERROR' })).kind, 'retry');
  });
});

describe('signing out one of another admin’s devices', () => {
  test('the confirm names the admin and the device, needs a reason and asks for no code', () => {
    const options = confirmOptions.deviceSignOutConfirm(row(), device(), 'Chrome on Android', NOW);
    assert.equal(options.tone, 'danger');
    assert.equal(options.title, 'Sign out @ada on Chrome on Android?');
    assert.equal(options.message, 'That session ends straight away. Their other devices stay signed in.');
    assert.equal(options.reason?.required, true);
    assert.ok(options.reason?.presets?.includes('Lost or stolen device'));
    assert.equal(options.credential, undefined);
    assert.equal(options.consequences, undefined);
    assert.deepEqual(options.details?.map((detail) => [detail.label, detail.value]), [
      ['Admin', '@ada'],
      ['Device', 'Chrome on Android'],
      ['Signed in', '13 Oct 2026, 09:14 WAT'],
      ['Last active', '13 Oct 2026, 09:59 WAT · 1m ago'],
      ['IP', '102.89.34.1'],
    ]);
    const app = confirmOptions.deviceSignOutConfirm(row(), device({ client: 'mobile', ip: '::1' }), 'CardElite Admin app', NOW);
    assert.deepEqual(app.consequences, [confirmOptions.APP_SESSION_NOTE]);
    assert.equal(app.details?.find((detail) => detail.label === 'IP')?.value, 'Local address (::1)');
    assert.equal(confirmOptions.deviceSignOutSuccess(row(), 'Chrome on Android'), '@ada was signed out of Chrome on Android.');
  });

  test('the device routes take the admin and session ids, and the answer says whether it was still live', () => {
    assert.equal(model.adminSessionsPath(ADMIN_ID), `/api/admin-accounts/${ADMIN_ID}/sessions`);
    assert.equal(model.adminSessionPath(ADMIN_ID, SESSION_ID), `/api/admin-accounts/${ADMIN_ID}/sessions/${SESSION_ID}`);
    assert.deepEqual(model.toDeviceSignOut({ success: true, revoked: true, audit_recorded: true }), {
      revoked: true, auditRecorded: true, warning: null,
    });
    assert.deepEqual(model.toDeviceSignOut({ success: true, revoked: false }), { revoked: false, auditRecorded: true, warning: null });
    assert.equal(model.toDeviceSignOut({ success: true }), null);
  });

  test('signing out everywhere now points to the Security tab for a single device', () => {
    const options = confirmOptions.rowActionConfirm('revoke', row());
    assert.deepEqual(options.consequences, [
      'They can sign in again straight away.',
      'To end one device only, use the Security tab in their account.',
    ]);
    assert.doesNotMatch((options.consequences ?? []).join(' '), /single sessions cannot be picked/);
  });
});

describe('drawer Security tab', () => {
  const noop = () => {};
  const panel = (props: Record<string, unknown> = {}) => render(createElement(securityParts.AdminSecurityPanel, {
    admin: row({ security: security() }),
    currentAdminId: SELF_ID,
    policy: OFF_POLICY,
    actorTwoStep: 'active',
    devices: { sessions: [device()], error: null, retrying: false, onRetry: noop },
    busy: false,
    pendingSessionId: null,
    now: NOW,
    onResetMfa: noop,
    onSignOutDevice: noop,
    onSignOutEverywhere: noop,
    ...props,
  }));

  test('your own account points to your Profile and offers no actions', () => {
    const html = panel({ admin: row({ id: SELF_ID, security: security() }) });
    assert.match(textOf(html), /This is your account\. Manage your two-step sign-in and devices on your Profile\. Open Profile/);
    assert.deepEqual(tagsOf(html, 'a').map((attrs) => attrs.href), ['/profile']);
    assert.equal(tagsOf(html, 'button').length, 0);
  });

  test('another admin shows their two-step rows, their devices and both sign-out actions', () => {
    const html = panel();
    const text = textOf(html);
    assert.match(text, /Two-step sign-in Status On/);
    assert.match(text, /On since 12 Oct 2026, 10:05 WAT · 23h ago/);
    assert.match(text, /Last code used 13 Oct 2026, 09:00 WAT · 1h ago/);
    assert.match(text, /Recovery codes 8 left/);
    assert.match(text, /Signed-in devices Chrome on Android Signed in 13 Oct 2026, 09:14 WAT · Active now IP 102\.89\.34\.1/);
    const reset = buttonByText(html, 'Reset two-step sign-in…');
    assert.ok(reset);
    assert.equal('disabled' in reset, false);
    assert.ok(tagsOf(html, 'button').some((attrs) => attrs['aria-label'] === 'Sign out Chrome on Android, signed in 13 Oct 2026, 09:14 WAT'));
    assert.ok(buttonByText(html, 'Sign out everywhere…'));
  });

  test('the reset waits for the acting super admin’s own two-step sign-in', () => {
    const html = panel({ actorTwoStep: 'none' });
    const reset = buttonByText(html, 'Reset two-step sign-in…');
    assert.ok(reset && 'disabled' in reset);
    assert.match(textOf(html), /Set up two-step sign-in on your Profile first\. Open Profile/);
    assert.ok(tagsOf(html, 'a').some((attrs) => attrs.href === '/profile#two-step-sign-in'));
    assert.equal(buttonByText(panel({ admin: row({ security: security({ mfaStatus: 'none' }) }) }), 'Reset two-step sign-in…'), undefined);
    const busy = buttonByText(panel({ busy: true }), 'Sign out everywhere…');
    assert.ok(busy && 'disabled' in busy);
  });

  test('a deactivated admin has no sessions to list or sign out', () => {
    const html = panel({ admin: row({ is_active: false, security: security() }), devices: null });
    assert.match(textOf(html), /No active sessions\. Deactivated accounts are signed out everywhere\./);
    assert.equal(buttonByText(html, 'Sign out everywhere…'), undefined);
    assert.ok(buttonByText(html, 'Reset two-step sign-in…'));
  });

  test('devices show a loading state, an error with a retry, and an empty list', () => {
    const loading = panel({ devices: { sessions: undefined, error: null, retrying: false, onRetry: noop } });
    assert.match(textOf(loading), /Loading signed-in devices…/);
    const failure: ApiFailure = {
      kind: 'http', status: 500, code: 'INTERNAL_ERROR', message: 'The signed-in devices could not be loaded. Try again.',
      requestId: 'req_devices', details: null, outcomeUnknown: false,
    };
    const failed = panel({ devices: { sessions: undefined, error: failure, retrying: false, onRetry: noop } });
    assert.match(textOf(failed), /Signed-in devices could not be loaded/);
    assert.ok(buttonByText(failed, 'Try again'));
    const empty = panel({ devices: { sessions: [], error: null, retrying: false, onRetry: noop } });
    assert.match(textOf(empty), /No signed-in devices\./);
  });

  test('an admin without two-step sign-in shows when it is due, a lock shows when it ends, and an unknown status says so', () => {
    const due = textOf(panel({ admin: row({ security: security({ mfaStatus: 'none', confirmedAt: null }) }), policy: GRACE_POLICY }));
    assert.match(due, /Status Off/);
    assert.match(due, /They have until 27 Oct 2026, 10:05 WAT to set it up\./);
    assert.doesNotMatch(due, /On since/);
    const required = textOf(panel({ admin: row({ security: security({ mfaStatus: 'none' }) }), policy: REQUIRED_POLICY }));
    assert.match(required, /They must set it up the next time they sign in\./);
    const locked = textOf(panel({ admin: row({ security: security({ lockedUntil: LOCK_TOMORROW }) }) }));
    assert.match(locked, /Status Locked/);
    assert.match(locked, /Locked until 14 Oct, 10:00 WAT/);
    assert.match(textOf(panel({ admin: row({ security: null }) })), /Two-step sign-in status could not be loaded/);
  });

  test('the drawer tabs carry the panel ids and the session count, and the account panel stays mounted', () => {
    const tabs = render(createElement(securityParts.PanelTabs, { id: 'drawer', value: 'security', onChange: noop, sessions: 2 }));
    assert.deepEqual(tagsOf(tabs, 'button').map((attrs) => [attrs.id, attrs['aria-controls'], attrs['aria-selected']]), [
      ['drawer-tab-account', 'drawer-panel-account', 'false'],
      ['drawer-tab-security', 'drawer-panel-security', 'true'],
    ]);
    assert.equal(textOf(tabs), 'Account Security 2');
    assert.equal(textOf(render(createElement(securityParts.PanelTabs, { id: 'drawer', value: 'account', onChange: noop, sessions: 0 }))), 'Account Security');
    const panels = render(createElement(securityParts.DrawerPanels, {
      id: 'drawer',
      panel: 'security',
      onPanelChange: noop,
      sessions: 0,
      security: createElement('p', null, 'Security body'),
      children: createElement('form', { id: 'editor' }, 'Account form'),
    }));
    const tabpanels = tagsOf(panels, 'div').filter((attrs) => attrs.role === 'tabpanel');
    assert.deepEqual(tabpanels.map((attrs) => [attrs.id, 'hidden' in attrs]), [
      ['drawer-panel-account', true],
      ['drawer-panel-security', false],
    ]);
    assert.match(panels, /<form id="editor">Account form<\/form>/);
    assert.match(textOf(panels), /Security body/);
    const plain = render(createElement(securityParts.DrawerPanels, {
      id: 'drawer', panel: 'security', sessions: null, children: createElement('form', null, 'Account form'),
    }));
    assert.equal(plain, '<form>Account form</form>');
    assert.equal(securityParts.drawerPanel('security', undefined, noop), 'account');
    assert.equal(securityParts.drawerPanel('security', 'x', undefined), 'account');
    assert.equal(securityParts.drawerPanel('security', 'x', noop), 'security');
  });

  test('the open tab lives in the URL as panel, so links can open the Security tab', () => {
    assert.deepEqual(
      model.ADMINS_URL.parse(new URLSearchParams(`id=${ADMIN_ID.toUpperCase()}&panel=security`)),
      { tab: 'all', id: ADMIN_ID, panel: 'security' },
    );
    assert.equal(model.ADMINS_URL.parse(new URLSearchParams('panel=devices')).panel, 'account');
    assert.deepEqual(model.ADMINS_URL.serialize({ tab: 'all', id: null, panel: 'account' }), { status: null, id: null, panel: null });
    assert.deepEqual(
      model.ADMINS_URL.serialize({ tab: 'active', id: ADMIN_ID, panel: 'security' }),
      { status: 'active', id: ADMIN_ID, panel: 'security' },
    );
    assert.equal(model.adminSecurityHref(ADMIN_ID), `/admin-accounts?id=${ADMIN_ID}&panel=security`);
    assert.equal(model.hasSecurityPanel(row()), true);
    assert.equal(model.hasSecurityPanel(row({ deleted_at: '2026-09-01T00:00:00.000Z' })), false);
  });

  test('the page wires the column, the menu item, the stat, the identity check and the drawer tab', () => {
    const source = readFileSync(new URL('../app/(dashboard)/admin-accounts/page.tsx', import.meta.url), 'utf8');
    assert.match(source, /const COLUMN_COUNT = 8;/);
    assert.match(source, /<Th>Email<\/Th>\s*<Th>Role<\/Th>\s*<Th>Access<\/Th>/);
    assert.match(source, /<Th>Status<\/Th>\s*<Th>Two-step<\/Th>/);
    assert.match(source, /label: 'Reset two-step sign-in',\s*icon: <KeyRound/);
    const everywhere = source.indexOf("label: 'Sign out everywhere'");
    assert.ok(everywhere > 0 && everywhere < source.indexOf("label: 'Reset two-step sign-in'"));
    assert.match(source, /label: 'Two-step sign-in',/);
    const identity = source.indexOf('await confirmIdentity(credential');
    assert.ok(identity > 0 && identity < source.indexOf('adminMfaPath(live.id)'));
    const reasonCheck = source.indexOf('checkStepUpReason(reason);');
    assert.ok(reasonCheck > 0 && reasonCheck < identity, 'a short reason is refused before the code is spent');
    assert.equal((source.match(/security=\{securityTab\}/g) ?? []).length, 2);
  });
});

describe('the Access step wiring', () => {
  const ACCOUNTS_DIR = join(APP_DIR, '(dashboard)', 'admin-accounts');
  const source = (name: string) => readFileSync(join(ACCOUNTS_DIR, name), 'utf8');

  test('the old grant editor and grant parts are gone, and the shared parts come from _access', () => {
    assert.equal(existsSync(join(ACCOUNTS_DIR, 'GrantEditor.tsx')), false);
    assert.equal(existsSync(join(ACCOUNTS_DIR, 'GrantParts.tsx')), false);
    for (const name of readdirSync(ACCOUNTS_DIR).filter((file) => /\.(ts|tsx)$/.test(file))) {
      assert.doesNotMatch(source(name), /\.\/Grant(?:Editor|Parts)['"]/, name);
    }
    assert.match(source('page.tsx'), /import \{ AccessCell \} from '\.\.\/_access';/);
    assert.match(source('AdminDetails.tsx'), /import \{ ActionBreakdown, GrantList \} from '\.\.\/_access';/);
    assert.match(source('confirmOptions.tsx'), /import \{ Change, GrantDiff \} from '\.\.\/_access';/);
    assert.doesNotMatch(source('AdminEditor.tsx'), /from '\.\.\/_access'/);
  });

  test('account saves go to /api/admin-accounts with no access fields, and access goes to its own route', () => {
    const editor = source('AdminEditor.tsx');
    assert.match(editor, /body: createRequestBody\(snapshot, roleId, reason\)/);
    assert.match(editor, /body: editRequestBody\(live\.id, proposal, reason\)/);
    assert.match(editor, /body: accessPreviewBody\(expected, next\)/);
    assert.match(editor, /body: accessSaveBody\(expected, next, reason\)/);
    assert.equal((editor.match(/apiRequest\(accessPath\(target\.id\)/g) ?? []).length, 2);
    assert.doesNotMatch(editor, /page_permissions|direct_permissions:/);
  });

  test('the dry run comes before the confirm, and the identity check is asked only after REAUTH_REQUIRED', () => {
    const editor = source('AdminEditor.tsx');
    const order = [
      'body: accessPreviewBody(expected, next)',
      '...accessConfirm({',
      'accessReasonProblem(result.reason)',
      'const attempt = await save();',
      "outcome.code !== 'REAUTH_REQUIRED'",
      '...accessIdentityConfirm(target)',
      "await confirmIdentity(credential ?? '')",
    ].map((needle) => editor.indexOf(needle));
    assert.ok(order.every((at) => at > 0), JSON.stringify(order));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.equal((editor.match(/credential: \{ kind: 'otp' \}/g) ?? []).length, 0);
    assert.match(source('confirmOptions.tsx'), /export function accessIdentityConfirm[\s\S]*?credential: \{ kind: 'otp' \}/);
  });

  test('the Access section is a role picker only; permissions live on the Roles page', () => {
    const editor = source('AdminEditor.tsx');
    assert.match(editor, /<option value="">No role<\/option>/);
    assert.match(editor, /roleChoices\(roles, base\.role_id, currentRoleName\)/);
    assert.doesNotMatch(editor, /PermissionMatrix|keysFromMatrix|storedKeys=|onDirect/);
    assert.match(editor, /pickRole\(current, roleId, role \? role\.permissions : \[\]\)/);
    assert.match(editor, /proposedTitle\(draft\.roleTitle, previous, role \? role\.name : null\)/);
    assert.match(editor, /<FieldShell label="Title"/);
    assert.doesNotMatch(editor, /label="Role title"/);
  });

  test('the create form shows the role picker with no Review button, so the role is given with the account', () => {
    const editor = source('AdminEditor.tsx');
    assert.match(editor, /const showsAccess = creating \|\| \(admin !== null && !admin\.is_super_admin\);/);
    assert.match(editor, /useResource<RoleRow\[\]>\(showsAccess \? 'admin-roles' : null, fetchRoles\)/);
    assert.match(editor, /onReview=\{creating \? undefined : \(\) => void reviewAccess\(\)\}/);
    assert.match(editor, /subtitle=\{creating \? 'They choose their password from the invitation email\.'/);
  });

  test('the editor has no password fields, and the old create hand-off is gone from the page, the editor and the model', () => {
    const editor = source('AdminEditor.tsx');
    assert.doesNotMatch(editor, /type=\{reveal|new-password|PASSWORD_RULES|PASSWORD_MAX|unmetPasswordRules|draft\.password|confirmPassword|Change password/);
    assert.doesNotMatch(editor, /lucide-react/);
    for (const name of ['page.tsx', 'AdminEditor.tsx', 'model.ts', 'confirmOptions.tsx']) {
      assert.doesNotMatch(source(name), /AccessHandoff|handoff|handOff|createdNotice|createdText|CREATED_WITHOUT_ACCESS|CREATE_THEN_ACCESS|CREATE_WITHOUT_ACCESS|wantsAccess/i, name);
    }
    assert.match(editor, /mode=\{mode\}/);
    assert.match(editor, /mode === 'create' \? CREATE_ACCESS_HINT : EDIT_ACCESS_HINT/);
  });

  test('the create asks for a reason, sends the invite, and asks for a code only after REAUTH_REQUIRED, like Make super admin', () => {
    const editor = source('AdminEditor.tsx');
    let at = editor.indexOf('const submit = async (event?: FormEvent<HTMLFormElement>) => {');
    assert.ok(at > 0, 'submit is missing');
    for (const needle of [
      'if (creating) {',
      'body: createRequestBody(snapshot, roleId, reason),',
      'select: toCreatedAdmin,',
      '...createConfirm(snapshot, roleNameOf(roleId)),',
      'accessReasonProblem(result.reason)',
      'const attempt = await save();',
      "outcome?.kind === 'reauth' && outcome.code === 'REAUTH_REQUIRED'",
      '...createIdentityConfirm(snapshot),',
      "await confirmIdentity(credential ?? '')",
      "settleCreate(outcome.result, snapshot)",
      'else reportFailure(outcome);',
    ]) {
      const next = editor.indexOf(needle, at);
      assert.ok(next > at, `${needle} is missing or out of order`);
      at = next;
    }
    assert.match(editor, /notify\(inviteSentText\('create', email, result\.invite\), result\.invite\.outcome === 'sent' \? 'success' : 'warning'\);/);
  });

  test('invited rows read Invited, offer Resend invitation, and call Deactivate Revoke invitation', () => {
    const page = source('page.tsx');
    assert.match(page, /capabilities\.resendInvite && \{\s*label: 'Resend invitation',\s*icon: <Send size=\{14\} aria-hidden \/>,\s*onSelect: \(\) => void runResend\(admin\),/);
    assert.match(page, /capabilities\.deactivate && \{\s*label: isInvited\(admin\) \? 'Revoke invitation' : 'Deactivate',/);
    assert.match(page, /\.\.\.resendInviteConfirm\(target\),/);
    assert.match(page, /apiRequest\(invitePath\(target\.id\), \{\s*method: 'POST',\s*select: toResentInvite,\s*\}\)/);
    assert.match(page, /inviteSentText\('resend', admin\.email \?\? adminHandle\(admin\), outcome\.result\)/);
    assert.match(page, /label=\{isInvited\(admin\) \? INVITED_LABEL : STATUS_LABEL\[status\]\}/);
    assert.match(page, /if \(isInvited\(admin\)\) return <span className=\{s\.muted\}>\{INVITED_LABEL\}<\/span>;/);
    assert.match(page, /<Td><SignInCell admin=\{admin\} \/><\/Td>/);
    assert.doesNotMatch(page, /credential: \{ kind: 'otp' \}/);
  });

  test('the table shows each admin’s role, and the page shares the identity check with the editor', () => {
    const page = source('page.tsx');
    assert.match(page, /<Td><RoleCell admin=\{admin\} \/><\/Td>\s*<Td><AccessCell admin=\{admin\} \/><\/Td>/);
    assert.match(page, /secondary: `\$\{admin\.role_title \|\| 'No title'\} · \$\{roleLabel\(admin\)\}`/);
    assert.doesNotMatch(page, /reauthenticate|async function confirmIdentity/);
    assert.match(source('model.ts'), /export async function confirmIdentity\(code: string\)/);
  });
});

describe('owned sources', () => {
  const ownedDir = fileURLToPath(new URL('../app/(dashboard)/admin-accounts/', import.meta.url));
  const owned = () => readdirSync(ownedDir).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => join(ownedDir, name));

  test('carry no prose comments and no inline styles', () => {
    for (const file of owned()) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /\/\*/, file);
      assert.doesNotMatch(source, /(^|\s)\/\/\s/m, file);
      assert.doesNotMatch(source, /style=\{/, file);
    }
  });

  test('the stylesheet uses tokens only', () => {
    const css = readFileSync(join(ownedDir, 'page.module.css'), 'utf8');
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
    for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      assert.doesNotMatch(value, colour, `${property}: ${value}`);
      if (property === 'z-index') assert.match(value.trim(), /^var\(--z-[\w-]+\)$/);
    }
    assert.doesNotMatch(css, /\/\*/);
  });

  test('every class the components use is in the stylesheet, and the moved grant styles are gone from it', () => {
    const used = new Set<string>();
    for (const file of owned()) {
      for (const [, name] of readFileSync(file, 'utf8').matchAll(/(?<![\w.])s\.([A-Za-z]\w*)/g)) used.add(name);
    }
    const css = readFileSync(join(ownedDir, 'page.module.css'), 'utf8');
    const defined = new Set([...css.matchAll(/\.([A-Za-z]\w*)/g)].map((match) => match[1]));
    assert.deepEqual([...used].filter((name) => !defined.has(name)).sort(), []);
    assert.deepEqual([...defined].filter((name) => !used.has(name)).sort(), []);
    assert.doesNotMatch(css, /\.(?:grant|breakdown|reserved|diff\b|note\b)/);
  });
});

const ROUTE_KEY = '__adminAccountsRouteTest';
const ROUTE_FILE = join(APP_DIR, 'api', 'admin-accounts', 'route.ts');
const ROUTE_REQUEST_ID = 'req_adminaccts01';
const ROUTE_USER_AGENT = 'admin-accounts-route-test';
const ROUTE_IP = '198.51.100.7';
const LAST_SUPER_ADMIN = 'At least one active super admin is required';
const GUARD_REFUSAL = { message: LAST_SUPER_ADMIN, code: 'P0001' };
const CONNECTION_LOST = { message: 'connection terminated', code: '08006' };
const CANNOT_DEACTIVATE = 'Cannot deactivate the last active super admin.';
const CANNOT_DELETE = 'Cannot delete the last active super admin.';
const UPDATE_FAILED = 'The admin account could not be updated.';
const DELETE_FAILED = 'The admin account could not be deleted.';
const CREATED_ID = '33333333-4444-4555-8666-777777777777';
const CREATED_AT = '2026-10-16T09:00:00.000Z';
const INVITE_FILE = join(APP_DIR, 'api', 'admin-accounts', '[id]', 'invite', 'route.ts');
const LINK_TOKEN = `${'a'.repeat(21)}-_${'B'.repeat(20)}`;
const LINK_TOKEN_HASH = '0123456789abcdef'.repeat(4);
const INVITE_EXPIRES = '2026-10-22T13:30:00.000Z';
const INVITE_REASON = 'New payout officer for the night shift';
const REASON_TEXT = 'Enter a reason of 3 to 500 characters.';
const CREATE_FAILED = 'The admin account could not be created.';
const SUPER_ONLY = 'This action is restricted to super administrators.';

type LinkOutcome = 'sent' | 'not_sent' | 'unknown';

interface LinkStub {
  configured: boolean;
  minted: number;
  send: { outcome: LinkOutcome; reason: string | null };
  issue: { outcome: LinkOutcome; reason: string | null; expiresAt: string | null };
  sends: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
}

type RouteRpcReply = { data?: unknown; error?: RouteDbError | null } | 'throw';

interface RouteSession {
  id: string;
  client: 'web' | 'mobile';
  amr: string[];
  createdAt: string;
  expiresAt: string;
  reauthAt: string | null;
  transport: 'cookie' | 'bearer';
}

interface RouteClaims {
  admin_id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  token_version: number;
  session: RouteSession;
  mfa?: { status: 'none' | 'pending' | 'active'; lockedUntil: string | null };
}

interface RouteDbError {
  message: string;
  code?: string;
}

type StoredAdmin = AdminState & { last_login_at: string | null; created_at: string | null };

type RouteFilter = [kind: string, column: string, value: unknown];

interface RouteQuery {
  table: string;
  op: 'select' | 'insert' | 'update' | null;
  columns: string | null;
  options: unknown;
  payload: unknown;
  filters: RouteFilter[];
  terminal: 'maybeSingle' | 'single' | null;
}

interface RouteScenario {
  target: StoredAdmin | null;
  superAdmins: number;
  updateError: RouteDbError | null;
  saved: Partial<StoredAdmin> | null;
  list: Array<Record<string, unknown>>;
  insertError: RouteDbError | null;
  pending: Array<Record<string, unknown>>;
  pendingError: RouteDbError | null;
  readError: RouteDbError | null;
  invite: RouteRpcReply;
}

interface RouteRpc {
  name: string;
  args: unknown;
}

interface RouteHarness {
  scenario: RouteScenario;
  queries: RouteQuery[];
  rpcs: RouteRpc[];
  claims: RouteClaims | null;
  logs: string[];
  links: LinkStub;
  db: {
    from(table: string): object;
    rpc(name: string, args: unknown): Promise<unknown>;
  };
}

interface AccountsRoute {
  GET: () => Promise<Response>;
  POST: (req: Request) => Promise<Response>;
  PATCH: (req: Request) => Promise<Response>;
  DELETE: (req: Request) => Promise<Response>;
  maxDuration: number;
}

interface InviteRoute {
  POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  maxDuration: number;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

function routeSession(client: RouteSession['client']): RouteSession {
  return {
    id: '0f1e2d3c-4b5a-4968-8776-655443322110',
    client,
    amr: ['otp', 'pwd'],
    createdAt: '2026-10-16T08:00:00.000Z',
    expiresAt: '2026-10-16T16:00:00.000Z',
    reauthAt: null,
    transport: client === 'web' ? 'cookie' : 'bearer',
  };
}

const OWNER: RouteClaims = {
  admin_id: SELF_ID,
  username: 'owner',
  role_title: 'Super Admin',
  is_super_admin: true,
  page_permissions: [],
  token_version: 0,
  session: routeSession('mobile'),
};

const WEB_OWNER: RouteClaims = { ...OWNER, session: routeSession('web') };

function webInviter(session: Partial<RouteSession> = {}, status: 'none' | 'pending' | 'active' = 'active'): RouteClaims {
  return {
    ...OWNER,
    mfa: { status, lockedUntil: null },
    session: { ...routeSession('web'), createdAt: new Date(Date.now() - 60 * 1000).toISOString(), ...session },
  };
}

function stored(patch: Partial<StoredAdmin> = {}): StoredAdmin {
  return {
    id: ADMIN_ID,
    username: 'ada',
    email: 'ada@cardelite.ng',
    role_title: 'Card Reviewer',
    page_permissions: ['card_queue', 'users'],
    role_id: null,
    direct_permissions: ['card_queue', 'users'],
    role: null,
    last_login_at: '2026-09-30T10:00:00.000Z',
    is_active: true,
    is_super_admin: true,
    deleted_at: null,
    created_at: '2026-01-02T09:00:00.000Z',
    token_version: 4,
    ...patch,
  };
}

const INVITE_CREATED: RouteRpcReply = {
  data: {
    ok: true,
    admin_id: CREATED_ID,
    username: 'tolu',
    email: 'tolu@cardelite.ng',
    role_id: ROLE_ID,
    expires_at: INVITE_EXPIRES,
  },
};

function routeScenario(patch: Partial<RouteScenario> = {}): RouteScenario {
  return {
    target: stored(),
    superAdmins: 2,
    updateError: null,
    saved: null,
    list: [],
    insertError: null,
    pending: [],
    pendingError: null,
    readError: null,
    invite: INVITE_CREATED,
    ...patch,
  };
}

function linkStub(patch: Partial<LinkStub> = {}): LinkStub {
  return {
    configured: true,
    minted: 0,
    send: { outcome: 'sent', reason: null },
    issue: { outcome: 'sent', reason: null, expiresAt: INVITE_EXPIRES },
    sends: [],
    issues: [],
    ...patch,
  };
}

function routeRpc(name: string, args: unknown): Promise<unknown> {
  routeHarness.rpcs.push({ name, args });
  if (name === 'admin_security_overview') return Promise.resolve({ data: [], error: null });
  if (name !== 'admin_invite_create') return Promise.reject(new Error(`unexpected rpc ${name}`));
  const reply = routeHarness.scenario.invite;
  if (reply === 'throw') return Promise.reject(new Error('fetch failed'));
  return Promise.resolve({ data: null, error: null, ...reply });
}

const routeHarness: RouteHarness = {
  scenario: routeScenario(),
  queries: [],
  rpcs: [],
  claims: OWNER,
  logs: [],
  links: linkStub(),
  db: {
    from: (table) => routeChain(table),
    rpc: (name, args) => routeRpc(name, args),
  },
};

Reflect.set(globalThis, ROUTE_KEY, routeHarness);

function createdRow(payload: Record<string, unknown>): Record<string, unknown> {
  const grants = Array.isArray(payload.page_permissions) ? [...(payload.page_permissions as string[])].sort() : [];
  return {
    id: CREATED_ID,
    username: payload.username,
    email: payload.email,
    role_title: payload.role_title,
    page_permissions: grants,
    role_id: null,
    direct_permissions: grants,
    role: null,
    last_login_at: null,
    is_active: payload.is_active,
    is_super_admin: payload.is_super_admin,
    deleted_at: null,
    created_at: CREATED_AT,
  };
}

function isInviteStatusRead(query: RouteQuery): boolean {
  return query.table === 'admin_users' && query.op === 'select'
    && query.filters.some(([kind, column]) => kind === 'is' && column === 'password_hash');
}

function routeAnswer(query: RouteQuery): Record<string, unknown> {
  const s = routeHarness.scenario;
  if (query.table === 'audit_log' && query.op === 'insert') return { error: null };
  if (isInviteStatusRead(query)) return s.pendingError ? { error: s.pendingError } : { data: s.pending };
  if (query.table === 'admin_users' && query.op === 'select' && query.terminal === 'maybeSingle') {
    return s.readError ? { error: s.readError } : { data: s.target };
  }
  if (query.table === 'admin_users' && query.op === 'select' && query.columns === 'id') return { count: s.superAdmins };
  if (query.table === 'admin_users' && query.op === 'select' && query.terminal === null) return { data: s.list };
  if (query.table === 'admin_users' && query.op === 'insert') {
    if (s.insertError) return { error: s.insertError };
    return { data: createdRow(query.payload as Record<string, unknown>) };
  }
  if (query.table === 'admin_users' && query.op === 'update') {
    if (s.updateError) return { error: s.updateError };
    return { data: s.target ? [{ ...s.target, ...(query.payload as Record<string, unknown>), ...(s.saved ?? {}) }] : [] };
  }
  throw new Error(`unexpected query ${JSON.stringify(query)}`);
}

function routeChain(table: string): object {
  const query: RouteQuery = { table, op: null, columns: null, options: null, payload: undefined, filters: [], terminal: null };
  routeHarness.queries.push(query);
  const builder: Record<string, unknown> = {};
  const filter = (kind: string) => (column: string, ...values: unknown[]) => {
    query.filters.push([kind, column, values.length === 1 ? values[0] : values]);
    return builder;
  };
  Object.assign(builder, {
    select: (columns: string, options?: unknown) => {
      if (query.op === null) query.op = 'select';
      query.columns = columns;
      query.options = options ?? null;
      return builder;
    },
    update: (payload: unknown) => {
      query.op = 'update';
      query.payload = payload;
      return builder;
    },
    insert: (payload: unknown) => {
      query.op = 'insert';
      query.payload = payload;
      return builder;
    },
    eq: filter('eq'),
    is: filter('is'),
    not: filter('not'),
    order: filter('order'),
    maybeSingle: () => {
      query.terminal = 'maybeSingle';
      return builder;
    },
    single: () => {
      query.terminal = 'single';
      return builder;
    },
    then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(() => ({ data: null, error: null, count: null, ...routeAnswer(query) }))
        .then(onFulfilled, onRejected),
  });
  return builder;
}

const routeModuleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const routeStub = (lines: string[]) => routeModuleUrl([`const harness = () => globalThis.${ROUTE_KEY};`, ...lines].join('\n'));

const ROUTE_FILE_STUBS: Readonly<Record<string, string>> = {
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: routeStub([
    'export const supabaseAdmin = {',
    '  from: (table) => harness().db.from(table),',
    '  rpc: (name, args) => harness().db.rpc(name, args),',
    '};',
  ]),
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: routeStub(['export async function verifyAdminFromRequest() { return harness().claims; }']),
  [resolve(APP_DIR, 'lib', 'passwordLinks.ts')]: routeStub([
    'export function linksConfigured() { return harness().links.configured; }',
    'export function mintLinkToken() {',
    '  harness().links.minted += 1;',
    `  return { token: '${LINK_TOKEN}', tokenHash: '${LINK_TOKEN_HASH}' };`,
    '}',
    'export async function sendLinkEmail(input) {',
    '  harness().links.sends.push(input);',
    '  return { ...harness().links.send };',
    '}',
    'export async function issueAndSend(input) {',
    '  harness().links.issues.push(input);',
    '  return { ...harness().links.issue };',
    '}',
  ]),
};

const ROUTE_PACKAGE_STUBS: Readonly<Record<string, string>> = {
  'next/headers': routeStub([
    'export async function headers() {',
    `  return new Headers({ 'x-request-id': '${ROUTE_REQUEST_ID}', 'user-agent': '${ROUTE_USER_AGENT}', 'x-forwarded-for': '${ROUTE_IP}' });`,
    '}',
    'export async function cookies() { return { get: () => undefined }; }',
  ]),
  'next/server': routeModuleUrl('export const NextResponse = { json: (body, init) => Response.json(body, init) };'),
  bcryptjs: routeModuleUrl('export default { hash: async (value, rounds) => "bcrypt-hash:" + rounds };'),
};

const ROUTE_IMPORTS = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;
const routeBundles = new Map<string, Promise<string>>();

function routeImport(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const found = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]
    .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
  if (!found) throw new Error(`${fromFile} imports ${specifier}, which does not resolve to a .ts file`);
  return found;
}

async function routeCompile(file: string): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const targets = new Map<string, string>();
  for (const [, , specifier] of outputText.matchAll(ROUTE_IMPORTS)) {
    if (targets.has(specifier)) continue;
    if (specifier.startsWith('.')) {
      const target = routeImport(file, specifier);
      targets.set(specifier, ROUTE_FILE_STUBS[target] ?? (await routeBundle(target)));
    } else if (ROUTE_PACKAGE_STUBS[specifier]) {
      targets.set(specifier, ROUTE_PACKAGE_STUBS[specifier]);
    } else {
      throw new Error(`${file} imports ${specifier}, which this test does not provide`);
    }
  }
  return routeModuleUrl(outputText.replace(ROUTE_IMPORTS, (match, head: string, specifier: string) => {
    const target = targets.get(specifier);
    return target ? `${head}'${target}'` : match;
  }));
}

function routeBundle(file: string): Promise<string> {
  let pending = routeBundles.get(file);
  if (!pending) {
    pending = routeCompile(file);
    routeBundles.set(file, pending);
  }
  return pending;
}

let accountsRoute: AccountsRoute;
let inviteRoute: InviteRoute;

before(async () => {
  accountsRoute = (await import(await routeBundle(ROUTE_FILE))) as AccountsRoute;
  inviteRoute = (await import(await routeBundle(INVITE_FILE))) as InviteRoute;
});

function routeReset(patch: Partial<RouteScenario> = {}, claims: RouteClaims | null = OWNER, links: Partial<LinkStub> = {}): void {
  routeHarness.scenario = routeScenario(patch);
  routeHarness.claims = claims;
  routeHarness.queries = [];
  routeHarness.rpcs = [];
  routeHarness.links = linkStub(links);
  routeHarness.logs.length = 0;
}

async function resend(id: string = ADMIN_ID): Promise<Reply> {
  const req = new Request(`http://localhost/api/admin-accounts/${id}/invite`, { method: 'POST' });
  const res = await inviteRoute.POST(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function inviteCalls(): unknown[] {
  return routeHarness.rpcs.filter((call) => call.name === 'admin_invite_create').map((call) => call.args);
}

async function send(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<Reply> {
  const req = new Request('http://localhost/api/admin-accounts', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = method === 'GET'
    ? await accountsRoute.GET()
    : method === 'POST'
      ? await accountsRoute.POST(req)
      : method === 'PATCH'
        ? await accountsRoute.PATCH(req)
        : await accountsRoute.DELETE(req);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function failureBody(message: string, code = 'STATE_CONFLICT') {
  return { success: false, error: message, code, message, request_id: ROUTE_REQUEST_ID };
}

function routeQueries(table: string, op: RouteQuery['op']): RouteQuery[] {
  return routeHarness.queries.filter((query) => query.table === table && query.op === op);
}

function superAdminCounts(): RouteQuery[] {
  return routeQueries('admin_users', 'select').filter((query) => query.columns === 'id');
}

function routeAudits(): Array<Record<string, unknown>> {
  return routeQueries('audit_log', 'insert').map((query) => query.payload as Record<string, unknown>);
}

function auditSummary(row: Record<string, unknown> | undefined) {
  return {
    admin_id: row?.admin_id,
    action: row?.action,
    entity: row?.entity,
    entity_id: row?.entity_id,
    reason: row?.reason,
    result: row?.result,
    error: row?.error,
    sensitivity: row?.sensitivity,
  };
}

function captureRouteLogs(): void {
  beforeEach(() => {
    routeReset();
    mock.method(console, 'error', (...args: unknown[]) => {
      routeHarness.logs.push(args.map((arg) => String(arg)).join(' '));
    });
  });
  afterEach(() => {
    mock.restoreAll();
  });
}

describe('PATCH /api/admin-accounts: the last active super admin', () => {
  captureRouteLogs();

  test('the friendly pre-count still refuses before any write when only one active super admin is left', async () => {
    routeReset({ superAdmins: 1 });
    const reply = await send('PATCH', { id: ADMIN_ID, is_active: false, reason: 'Left the company' });
    assert.equal(reply.status, 409);
    assert.deepEqual(reply.body, failureBody(CANNOT_DEACTIVATE));
    assert.deepEqual(superAdminCounts().map((query) => [query.options, query.filters]), [[
      { count: 'exact', head: true },
      [['eq', 'is_super_admin', true], ['eq', 'is_active', true], ['is', 'deleted_at', null]],
    ]]);
    assert.deepEqual(routeQueries('admin_users', 'update'), []);
    assert.deepEqual(routeAudits(), []);
  });

  test('a deactivation the database guard refuses after the count passed gets the same conflict and a failure audit', async () => {
    routeReset({ superAdmins: 2, updateError: GUARD_REFUSAL });
    const reply = await send('PATCH', { id: ADMIN_ID, is_active: false, reason: 'Left the company' });
    assert.equal(reply.status, 409);
    assert.deepEqual(reply.body, failureBody(CANNOT_DEACTIVATE));
    assert.equal(superAdminCounts().length, 1);
    assert.deepEqual(routeQueries('admin_users', 'update').map((query) => [query.payload, query.filters]), [[
      { is_active: false, token_version: 5 },
      [['eq', 'id', ADMIN_ID], ['is', 'deleted_at', null], ['eq', 'token_version', 4]],
    ]]);
    const rows = routeAudits();
    assert.deepEqual(rows.map(auditSummary), [{
      admin_id: SELF_ID,
      action: 'DEACTIVATE_ADMIN',
      entity: 'admin_users',
      entity_id: ADMIN_ID,
      reason: 'Left the company',
      result: 'failure',
      error: LAST_SUPER_ADMIN,
      sensitivity: 'security',
    }]);
    assert.deepEqual(rows[0]?.after_value, { is_active: false, token_version_bumped: true });
    assert.deepEqual(routeHarness.logs, []);
  });

  test('the mobile app deactivate request, which sends no reason, gets the same conflict', async () => {
    routeReset({ updateError: GUARD_REFUSAL });
    const reply = await send('PATCH', { id: ADMIN_ID, is_active: false });
    assert.equal(reply.status, 409);
    assert.deepEqual(reply.body, failureBody(CANNOT_DEACTIVATE));
    assert.deepEqual(routeAudits().map((row) => [row.action, row.reason, row.result]), [['DEACTIVATE_ADMIN', null, 'failure']]);
  });

  test('deactivating while signing out everywhere is refused with the same wording under its own action', async () => {
    routeReset({ updateError: GUARD_REFUSAL });
    const reply = await send('PATCH', { id: ADMIN_ID, is_active: false, revoke_sessions: true, reason: 'Compromised' });
    assert.equal(reply.status, 409);
    assert.deepEqual(reply.body, failureBody(CANNOT_DEACTIVATE));
    assert.deepEqual(routeAudits().map((row) => [row.action, row.result, row.error]), [
      ['REVOKE_ADMIN_SESSIONS', 'failure', LAST_SUPER_ADMIN],
    ]);
  });

  test('any other update error is still a 500 with the existing message, logged and recorded', async () => {
    routeReset({ updateError: CONNECTION_LOST });
    const reply = await send('PATCH', { id: ADMIN_ID, is_active: false, reason: 'Left the company' });
    assert.equal(reply.status, 500);
    assert.deepEqual(reply.body, failureBody(UPDATE_FAILED, 'INTERNAL_ERROR'));
    assert.deepEqual(routeAudits().map((row) => [row.action, row.result, row.error]), [
      ['DEACTIVATE_ADMIN', 'failure', CONNECTION_LOST.message],
    ]);
    assert.ok(routeHarness.logs.some((line) => line.includes(CONNECTION_LOST.message)));
  });

  test('deactivating a super admin while another remains still succeeds with every response key', async () => {
    const reply = await send('PATCH', { id: ADMIN_ID, is_active: false, reason: 'Left the company' });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, {
      success: true,
      request_id: ROUTE_REQUEST_ID,
      changed: true,
      sessions_revoked: true,
      admin: {
        id: ADMIN_ID,
        username: 'ada',
        email: 'ada@cardelite.ng',
        role_title: 'Card Reviewer',
        page_permissions: ['card_queue', 'users'],
        role_id: null,
        role: null,
        direct_permissions: ['card_queue', 'users'],
        last_login_at: '2026-09-30T10:00:00.000Z',
        is_active: false,
        is_super_admin: true,
        deleted_at: null,
        created_at: '2026-01-02T09:00:00.000Z',
      },
      audit_recorded: true,
    });
    assert.deepEqual(routeAudits().map((row) => [row.action, row.result]), [['DEACTIVATE_ADMIN', 'success']]);
  });

  test('edits and session revokes on the last super admin never count super admins, because they remove none', async () => {
    const bodies: Array<Record<string, unknown>> = [
      { id: ADMIN_ID, revoke_sessions: true, reason: 'Lost device' },
      { id: ADMIN_ID, email: 'ada.obi@cardelite.ng', role_title: 'Card Reviewer', page_permissions: ['card_queue', 'users'] },
    ];
    for (const body of bodies) {
      routeReset({ superAdmins: 1 });
      const reply = await send('PATCH', body);
      assert.equal(reply.status, 200, JSON.stringify(body));
      assert.equal(reply.body.changed, true);
      assert.equal(superAdminCounts().length, 0);
      assert.equal(routeQueries('admin_users', 'update').length, 1);
    }
  });
});

describe('DELETE /api/admin-accounts: the database super admin guard', () => {
  captureRouteLogs();

  const inactive = () => stored({ is_super_admin: false, is_active: false });

  test('a soft delete the guard refuses is a conflict in deletion wording, recorded as a failure', async () => {
    routeReset({ target: inactive(), updateError: GUARD_REFUSAL });
    const reply = await send('DELETE', { id: ADMIN_ID });
    assert.equal(reply.status, 409);
    assert.deepEqual(reply.body, failureBody(CANNOT_DELETE));
    assert.deepEqual(routeQueries('admin_users', 'update').map((query) => query.filters), [[
      ['eq', 'id', ADMIN_ID],
      ['is', 'deleted_at', null],
      ['not', 'is_super_admin', ['is', true]],
      ['not', 'is_active', ['is', true]],
    ]]);
    assert.deepEqual(routeAudits().map((row) => [row.action, row.result, row.error]), [['DELETE_ADMIN', 'failure', LAST_SUPER_ADMIN]]);
    assert.deepEqual(routeHarness.logs, []);
  });

  test('any other delete error is still a 500 with the existing message, logged and recorded', async () => {
    routeReset({ target: inactive(), updateError: CONNECTION_LOST });
    const reply = await send('DELETE', { id: ADMIN_ID });
    assert.equal(reply.status, 500);
    assert.deepEqual(reply.body, failureBody(DELETE_FAILED, 'INTERNAL_ERROR'));
    assert.deepEqual(routeAudits().map((row) => [row.action, row.result]), [['DELETE_ADMIN', 'failure']]);
    assert.ok(routeHarness.logs.some((line) => line.includes(CONNECTION_LOST.message)));
  });

  test('the mobile delete request still removes an inactive admin', async () => {
    routeReset({ target: inactive() });
    const reply = await send('DELETE', { id: ADMIN_ID });
    assert.equal(reply.status, 200);
    const admin = reply.body.admin as Record<string, unknown>;
    assert.equal(admin.id, ADMIN_ID);
    assert.equal(admin.is_active, false);
    assert.equal(typeof admin.deleted_at, 'string');
    assert.equal(reply.body.audit_recorded, true);
    assert.deepEqual(routeAudits().map((row) => [row.action, row.result]), [['DELETE_ADMIN', 'success']]);
  });
});

const ACCESS_ELSEWHERE = 'Change access in the web console’s Access section.';
const STALE_ACCESS = 'This admin’s access changed since you opened it. Reload and try again.';
const LIST_ROLE_EMBED = 'role:admin_roles!admin_users_role_id_fkey(id, name, archived_at)';
const STATE_ROLE_EMBED = 'role:admin_roles!admin_users_role_id_fkey(id, name, archived_at, permissions)';
const PHONE_FIELDS = ['id', 'username', 'email', 'role_title', 'page_permissions', 'last_login_at', 'is_active', 'is_super_admin', 'deleted_at'];
const PHONE_CREATE = {
  username: 'tolu',
  email: 'tolu@cardelite.ng',
  password: 'Correct-Horse-9',
  role_title: 'Payout Officer',
  page_permissions: ['withdrawals', 'card_queue'],
};

const member = (patch: Partial<StoredAdmin> = {}) => stored({ is_super_admin: false, ...patch });

function phoneEdit(pages: string[], patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: ADMIN_ID, email: 'ada@cardelite.ng', role_title: 'Card Reviewer', page_permissions: pages, ...patch };
}

function listedRow(patch: Partial<StoredAdmin>, role: Record<string, unknown> | null): Record<string, unknown> {
  const { token_version: _version, role: _state, ...row } = stored(patch);
  return { ...row, role };
}

function columnsOf(query: RouteQuery | undefined): string[] {
  return (query?.columns ?? '').split(/,\s*/);
}

describe('GET /api/admin-accounts: roles beside the fields the phone reads', () => {
  captureRouteLogs();

  test('keeps every field the phone reads and adds the role, its id and the direct grants through the hinted embed', async () => {
    const listed = [
      listedRow(
        { is_super_admin: false, page_permissions: ['dashboard', 'users', 'withdrawals'], role_id: ROLE_ID, direct_permissions: [] },
        { id: ROLE_ID, name: 'Manager', archived_at: null },
      ),
      listedRow({ id: SELF_ID, username: 'owner' }, null),
      listedRow({ id: CREATED_ID, username: 'old', is_super_admin: false, role_id: ROLE_ID }, {
        id: ROLE_ID, name: 'Night shift', archived_at: '2026-10-01T09:00:00.000Z',
      }),
    ];
    routeReset({ list: listed });
    const reply = await send('GET');
    assert.equal(reply.status, 200);
    const admins = reply.body.admins as Array<Record<string, unknown>>;
    assert.equal(admins.length, 3);
    for (const [index, admin] of admins.entries()) {
      for (const field of PHONE_FIELDS) assert.deepEqual(admin[field], listed[index][field], `${index} ${field}`);
    }
    assert.deepEqual([admins[0].role_id, admins[0].role, admins[0].direct_permissions], [
      ROLE_ID, { id: ROLE_ID, name: 'Manager', archived: false }, [],
    ]);
    assert.deepEqual([admins[1].role_id, admins[1].role, admins[1].direct_permissions], [null, null, ['card_queue', 'users']]);
    assert.deepEqual(admins[2].role, { id: ROLE_ID, name: 'Night shift', archived: true });
    const [list] = routeQueries('admin_users', 'select');
    assert.ok(list?.columns?.includes(LIST_ROLE_EMBED));
    assert.ok(columnsOf(list).includes('role_id') && columnsOf(list).includes('direct_permissions'));
    assert.equal(columnsOf(list).includes('token_version'), false);
  });

  test('marks each admin invite_pending from one extra query that never reads a hash, and still lists when it fails', async () => {
    const listed = [
      listedRow({ is_super_admin: false, last_login_at: null }, null),
      listedRow({ id: SELF_ID, username: 'owner' }, null),
    ];
    routeReset({ list: listed, pending: [{ id: ADMIN_ID.toUpperCase() }, { id: 'not-a-uuid' }] });
    const reply = await send('GET');
    assert.equal(reply.status, 200);
    const admins = reply.body.admins as Array<Record<string, unknown>>;
    assert.deepEqual(admins.map((admin) => [admin.id, admin.invite_pending]), [[ADMIN_ID, true], [SELF_ID, false]]);
    const status = routeHarness.queries.filter(isInviteStatusRead);
    assert.deepEqual(status.map((query) => [query.columns, query.filters, query.terminal]), [[
      'id', [['is', 'password_hash', null], ['is', 'deleted_at', null]], null,
    ]]);
    assert.equal(routeHarness.logs.length, 0);
    routeReset({ list: listed, pendingError: CONNECTION_LOST });
    const degraded = await send('GET');
    assert.equal(degraded.status, 200);
    assert.deepEqual((degraded.body.admins as Array<Record<string, unknown>>).map((admin) => admin.invite_pending), [null, null]);
    assert.ok(routeHarness.logs.some((line) => line.startsWith('admin invite status read:')));
  });
});

describe('PATCH /api/admin-accounts: the phone’s edits once roles exist', () => {
  captureRouteLogs();

  test('the phone’s edit from a mobile session, with no reason or expected values, writes only page_permissions', async () => {
    routeReset({
      target: member(),
      saved: { page_permissions: ['card_queue', 'coupons', 'users'], direct_permissions: ['card_queue', 'coupons', 'users'], token_version: 5 },
    });
    const reply = await send('PATCH', phoneEdit(['card_queue', 'users', 'coupons']));
    assert.equal(reply.status, 200);
    const [update] = routeQueries('admin_users', 'update');
    assert.deepEqual(update?.payload, { page_permissions: ['card_queue', 'users', 'coupons'] });
    assert.deepEqual(update?.filters, [['eq', 'id', ADMIN_ID], ['is', 'deleted_at', null], ['eq', 'token_version', 4]]);
    for (const column of ['page_permissions', 'direct_permissions', 'role_id', 'token_version']) {
      assert.ok(columnsOf(update).includes(column), column);
    }
    assert.equal(reply.body.changed, true);
    assert.equal(reply.body.sessions_revoked, true);
    const admin = reply.body.admin as Record<string, unknown>;
    assert.deepEqual([admin.page_permissions, admin.direct_permissions, admin.role_id, admin.role], [
      ['card_queue', 'coupons', 'users'], ['card_queue', 'coupons', 'users'], null, null,
    ]);
    assert.equal('token_version' in admin, false);
    const [audit] = routeAudits();
    assert.deepEqual(auditSummary(audit), {
      admin_id: SELF_ID,
      action: 'EDIT_ADMIN',
      entity: 'admin_users',
      entity_id: ADMIN_ID,
      reason: null,
      result: 'success',
      error: null,
      sensitivity: 'security',
    });
    assert.deepEqual(audit?.after_value, {
      page_permissions: ['card_queue', 'coupons', 'users'],
      grant_changes: { added: ['coupons'], removed: [], actions_gained: ['coupons.read', 'coupons.write'], actions_lost: [] },
      token_version_bumped: true,
    });
  });

  test('a page change the database stores without a sign-out answers that no session ended', async () => {
    routeReset({
      target: member(),
      saved: { page_permissions: ['card_queue', 'dashboard', 'users'], direct_permissions: ['card_queue', 'dashboard', 'users'] },
    });
    const reply = await send('PATCH', phoneEdit(['card_queue', 'users', 'dashboard']));
    assert.equal(reply.status, 200);
    assert.equal(reply.body.sessions_revoked, false);
    const after = routeAudits()[0]?.after_value as Record<string, unknown>;
    assert.equal('token_version_bumped' in after, false);
    assert.deepEqual((after.grant_changes as Record<string, unknown>).added, ['dashboard']);
  });

  test('a title change in the same phone save still signs the admin out from the route, once', async () => {
    routeReset({ target: member(), saved: { page_permissions: ['card_queue', 'coupons', 'users'] } });
    const reply = await send('PATCH', phoneEdit(['card_queue', 'users', 'coupons'], { role_title: 'Senior Reviewer' }));
    assert.equal(reply.status, 200);
    assert.deepEqual(routeQueries('admin_users', 'update')[0]?.payload, {
      role_title: 'Senior Reviewer',
      page_permissions: ['card_queue', 'users', 'coupons'],
      token_version: 5,
    });
    assert.equal(reply.body.sessions_revoked, true);
  });

  test('unticking a page that comes from the role answers 409 naming the role, and nothing is written', async () => {
    routeReset({
      target: member({
        page_permissions: ['users', 'withdrawals'],
        role_id: ROLE_ID,
        direct_permissions: ['users'],
        role: { id: ROLE_ID, name: 'Manager', archived_at: null, permissions: ['withdrawals'] },
      }),
    });
    const reply = await send('PATCH', phoneEdit(['users']));
    assert.equal(reply.status, 409);
    assert.deepEqual(reply.body, failureBody('withdrawals comes from the role Manager. Change it in the web console.'));
    assert.deepEqual(routeQueries('admin_users', 'update'), []);
    assert.deepEqual(routeAudits(), []);
    const [read] = routeQueries('admin_users', 'select');
    assert.ok(read?.columns?.includes(STATE_ROLE_EMBED));
    assert.ok(columnsOf(read).includes('token_version'));
  });

  test('dotted keys that differ from the stored ones answer 409, and an echo of them saves', async () => {
    for (const pages of [['users'], ['users', 'withdrawals.read', 'withdrawals.approve']]) {
      routeReset({ target: member({ page_permissions: ['users', 'withdrawals.read'] }) });
      const reply = await send('PATCH', phoneEdit(pages));
      assert.equal(reply.status, 409, JSON.stringify(pages));
      assert.deepEqual(reply.body, failureBody(STALE_ACCESS));
      assert.deepEqual(routeQueries('admin_users', 'update'), []);
    }
    routeReset({ target: member({ page_permissions: ['users', 'withdrawals.read'] }) });
    const echo = await send('PATCH', phoneEdit(['withdrawals.read', 'users', 'coupons']));
    assert.equal(echo.status, 200);
    assert.deepEqual(routeQueries('admin_users', 'update')[0]?.payload, { page_permissions: ['withdrawals.read', 'users', 'coupons'] });
  });

  test('an echo containing transfers for a super-admin target is accepted', async () => {
    const held = ['dashboard', 'card_queue', 'withdrawals', 'admin_accounts', 'transfers', 'manual_wallet_credit'];
    routeReset({ target: stored({ page_permissions: held, direct_permissions: held }) });
    const reply = await send('PATCH', phoneEdit([...held], { role_title: 'Lead' }));
    assert.equal(reply.status, 200);
    assert.deepEqual(routeQueries('admin_users', 'update')[0]?.payload, { role_title: 'Lead', token_version: 5 });
  });

  test('newly added restricted or retired pages answer 400 with the keys, before anything is written', async () => {
    routeReset({ target: member() });
    const reply = await send('PATCH', phoneEdit(['card_queue', 'users', 'admin_accounts', 'giftbox']));
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, {
      ...failureBody('These permissions cannot be granted: admin_accounts, giftbox.', 'VALIDATION_ERROR'),
      details: { reason: 'not_grantable', keys: ['admin_accounts', 'giftbox'] },
    });
    assert.deepEqual(routeQueries('admin_users', 'update'), []);
  });

  test('database trigger refusals answer 400 or 409 with a failure audit, while other errors stay 500', async () => {
    const cases: Array<[RouteDbError, number, string, string, Record<string, unknown>]> = [
      [
        { message: 'This permission cannot be granted', code: 'P0001' },
        400, 'VALIDATION_ERROR', 'This permission cannot be granted.', { reason: 'not_grantable' },
      ],
      [{ message: 'This role is archived', code: 'P0001' }, 409, 'STATE_CONFLICT', 'This role is archived.', { reason: 'role_archived' }],
    ];
    for (const [error, status, code, message, details] of cases) {
      routeReset({ target: member(), updateError: error });
      const reply = await send('PATCH', phoneEdit(['card_queue', 'users', 'coupons']));
      assert.equal(reply.status, status, error.message);
      assert.deepEqual(reply.body, { ...failureBody(message, code), details });
      assert.deepEqual(routeAudits().map((row) => [row.action, row.result, row.error]), [['EDIT_ADMIN', 'failure', error.message]]);
      assert.deepEqual(routeHarness.logs, []);
    }
  });
});

describe('POST /api/admin-accounts: creating from the phone and from the web', () => {
  captureRouteLogs();

  test('the phone’s create from a mobile session creates the account with its pages, read back from the row', async () => {
    routeReset({ target: null });
    const reply = await send('POST', PHONE_CREATE);
    assert.equal(reply.status, 200);
    const [insert] = routeQueries('admin_users', 'insert');
    assert.deepEqual(insert?.payload, {
      username: 'tolu',
      email: 'tolu@cardelite.ng',
      password_hash: 'bcrypt-hash:12',
      role_title: 'Payout Officer',
      page_permissions: ['withdrawals', 'card_queue'],
      is_super_admin: false,
      is_active: true,
    });
    assert.equal(insert?.terminal, 'single');
    assert.ok(insert?.columns?.includes(LIST_ROLE_EMBED));
    assert.equal(reply.body.id, CREATED_ID);
    assert.deepEqual(reply.body.admin, {
      id: CREATED_ID,
      username: 'tolu',
      email: 'tolu@cardelite.ng',
      role_title: 'Payout Officer',
      page_permissions: ['card_queue', 'withdrawals'],
      role_id: null,
      role: null,
      direct_permissions: ['card_queue', 'withdrawals'],
      last_login_at: null,
      is_active: true,
      is_super_admin: false,
      deleted_at: null,
      created_at: CREATED_AT,
    });
    const [audit] = routeAudits();
    assert.deepEqual([audit?.action, audit?.result, audit?.entity_id], ['CREATE_ADMIN', 'success', CREATED_ID]);
    assert.deepEqual((audit?.after_value as Record<string, unknown>).page_permissions, ['card_queue', 'withdrawals']);
  });

  test('the phone keeps its password create with no step-up, stores the email in lowercase and sends no invitation', async () => {
    routeReset({ target: null });
    const reply = await send('POST', { ...PHONE_CREATE, email: ' Tolu@CardElite.NG ' });
    assert.equal(reply.status, 200);
    assert.equal((routeQueries('admin_users', 'insert')[0]?.payload as Record<string, unknown>).email, 'tolu@cardelite.ng');
    assert.deepEqual(inviteCalls(), []);
    assert.deepEqual([routeHarness.links.minted, routeHarness.links.sends.length], [0, 0]);
    routeReset({ target: null });
    const refused = await send('POST', { ...PHONE_CREATE, email: 'x<a@b.co>' });
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, failureBody('Enter a valid email address.', 'VALIDATION_ERROR'));
    assert.deepEqual(routeQueries('admin_users', 'insert'), []);
  });

  test('a database refusal on create is a 400 with a failure audit', async () => {
    routeReset({ target: null, insertError: { message: 'This permission cannot be granted', code: 'P0001' } });
    const reply = await send('POST', PHONE_CREATE);
    assert.equal(reply.status, 400);
    assert.equal(reply.body.code, 'VALIDATION_ERROR');
    assert.deepEqual(routeAudits().map((row) => [row.action, row.result]), [['CREATE_ADMIN', 'failure']]);
    assert.deepEqual(routeHarness.logs, []);
  });
});

const WEB_INVITE = {
  username: 'tolu',
  email: ' Tolu@CardElite.NG ',
  role_title: 'Payout Officer',
  role_id: ROLE_ID.toUpperCase(),
  reason: `  ${INVITE_REASON} `,
};

function createdStored(): StoredAdmin {
  return stored({
    id: CREATED_ID,
    username: 'tolu',
    email: 'tolu@cardelite.ng',
    role_title: 'Payout Officer',
    page_permissions: [...MANAGER_KEYS],
    role_id: ROLE_ID,
    direct_permissions: [],
    role: { id: ROLE_ID, name: 'Manager', archived_at: null },
    last_login_at: null,
    is_super_admin: false,
    created_at: CREATED_AT,
  });
}

function nothingSent(): void {
  assert.deepEqual(inviteCalls(), []);
  assert.deepEqual([routeHarness.links.minted, routeHarness.links.sends.length], [0, 0]);
  assert.deepEqual(routeAudits(), []);
}

describe('POST /api/admin-accounts: the web invite', () => {
  captureRouteLogs();

  test('needs two-step sign-in, then an identity check within 5 minutes, before the body is read', async () => {
    routeReset({ target: null }, webInviter({}, 'none'));
    const withoutTwoStep = await send('POST', []);
    assert.equal(withoutTwoStep.status, 403);
    assert.equal(withoutTwoStep.body.code, 'MFA_REQUIRED');
    assert.deepEqual(routeHarness.queries, []);
    nothingSent();
    routeReset({ target: null }, WEB_OWNER);
    assert.equal((await send('POST', WEB_INVITE)).body.code, 'MFA_REQUIRED');
    routeReset({ target: null }, webInviter({ createdAt: '2026-10-16T08:00:00.000Z' }));
    const stale = await send('POST', []);
    assert.equal(stale.status, 403);
    assert.equal(stale.body.code, 'REAUTH_REQUIRED');
    assert.deepEqual(stale.body.details, { method: 'otp', max_age_secs: 300 });
    assert.deepEqual(routeHarness.queries, []);
    nothingSent();
    routeReset({ target: null }, webInviter({ createdAt: '2026-10-16T08:00:00.000Z', reauthAt: new Date().toISOString() }));
    assert.equal((await send('POST', WEB_INVITE)).status, 200);
  });

  test('a password, direct_permissions or page_permissions answer 400 before anything is created', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...WEB_INVITE, password: 'Correct-Horse-9' }, 'Passwords are chosen by the new admin from the invitation email.'],
      [{ ...WEB_INVITE, password: '' }, 'Passwords are chosen by the new admin from the invitation email.'],
      [{ ...WEB_INVITE, direct_permissions: ['coupons'] }, ACCESS_ELSEWHERE],
      [{ ...WEB_INVITE, page_permissions: ['withdrawals'] }, ACCESS_ELSEWHERE],
    ];
    for (const [body, message] of cases) {
      routeReset({ target: null }, webInviter());
      const reply = await send('POST', body);
      assert.equal(reply.status, 400, JSON.stringify(body));
      assert.deepEqual(reply.body, failureBody(message, 'VALIDATION_ERROR'));
      assert.deepEqual(routeHarness.queries, []);
      nothingSent();
    }
  });

  test('needs a reason of 3 to 500 characters and a role id or null, and checks the account before anything is created', async () => {
    for (const reason of [undefined, '   ', 'ab', 'x'.repeat(501), 42]) {
      routeReset({ target: null }, webInviter());
      const reply = await send('POST', { ...WEB_INVITE, reason });
      assert.equal(reply.status, 400, String(reason));
      assert.deepEqual(reply.body, {
        ...failureBody(REASON_TEXT, 'VALIDATION_ERROR'),
        details: { field: 'reason', reason: 'reason_required' },
      });
      nothingSent();
    }
    for (const role_id of ['nope', 42, {}, '']) {
      routeReset({ target: null }, webInviter());
      const reply = await send('POST', { ...WEB_INVITE, role_id });
      assert.equal(reply.status, 400, JSON.stringify(role_id));
      assert.deepEqual(reply.body, {
        ...failureBody('role_id must be a role id or null.', 'VALIDATION_ERROR'),
        details: { field: 'role_id', reason: 'invalid' },
      });
      nothingSent();
    }
    for (const [patch, message] of [
      [{ email: 'x<a@b.co>' }, 'Enter a valid email address.'],
      [{ username: 'ab' }, 'Username must be 3–32 characters.'],
      [{ role_title: '' }, 'Username, email and role title are required.'],
    ] as const) {
      routeReset({ target: null }, webInviter());
      const reply = await send('POST', { ...WEB_INVITE, ...patch });
      assert.deepEqual(reply.body, failureBody(message, 'VALIDATION_ERROR'), message);
      nothingSent();
    }
  });

  test('answers 500 before anything is created when invitation links are not set up', async () => {
    routeReset({ target: null }, webInviter(), { configured: false });
    const reply = await send('POST', WEB_INVITE);
    assert.equal(reply.status, 500);
    assert.deepEqual(reply.body, failureBody('Invitations are not set up on the server, so no account was created.', 'INTERNAL_ERROR'));
    assert.deepEqual(routeHarness.queries, []);
    nothingSent();
  });

  test('creates the account with its role and link in one call, emails the link and records only the send', async () => {
    routeReset({ target: createdStored() }, webInviter());
    const reply = await send('POST', WEB_INVITE);
    assert.equal(reply.status, 200);
    assert.deepEqual(inviteCalls(), [{
      p_actor: SELF_ID,
      p_username: 'tolu',
      p_email: 'tolu@cardelite.ng',
      p_role_title: 'Payout Officer',
      p_role_id: ROLE_ID,
      p_token_hash: LINK_TOKEN_HASH,
      p_reason: INVITE_REASON,
      p_ip: ROUTE_IP,
      p_user_agent: ROUTE_USER_AGENT,
      p_request_id: ROUTE_REQUEST_ID,
    }]);
    assert.match(LINK_TOKEN_HASH, /^[0-9a-f]{64}$/);
    assert.equal(routeHarness.links.minted, 1);
    assert.deepEqual(routeQueries('admin_users', 'insert'), []);
    const [readBack] = routeQueries('admin_users', 'select');
    assert.deepEqual([readBack?.filters, readBack?.terminal], [[['eq', 'id', CREATED_ID]], 'maybeSingle']);
    assert.ok(readBack?.columns?.includes(LIST_ROLE_EMBED));
    assert.deepEqual(routeHarness.links.sends, [{
      purpose: 'invite',
      token: LINK_TOKEN,
      email: 'tolu@cardelite.ng',
      username: 'tolu',
      expiresAt: INVITE_EXPIRES,
      inviter: 'owner',
    }]);
    const audits = routeAudits();
    assert.deepEqual(audits.map(auditSummary), [{
      admin_id: SELF_ID,
      action: 'ADMIN_INVITE_SENT',
      entity: 'admin_users',
      entity_id: CREATED_ID,
      reason: null,
      result: 'success',
      error: null,
      sensitivity: 'security',
    }]);
    assert.deepEqual(audits[0]?.after_value, { outcome: 'sent', expires_at: INVITE_EXPIRES, resend: false });
    assert.ok(!JSON.stringify(audits).includes(LINK_TOKEN) && !JSON.stringify(reply.body).includes(LINK_TOKEN));
    assert.deepEqual(reply.body, {
      success: true,
      request_id: ROUTE_REQUEST_ID,
      id: CREATED_ID,
      admin: {
        id: CREATED_ID,
        username: 'tolu',
        email: 'tolu@cardelite.ng',
        role_title: 'Payout Officer',
        page_permissions: MANAGER_KEYS,
        role_id: ROLE_ID,
        role: { id: ROLE_ID, name: 'Manager', archived: false },
        direct_permissions: [],
        last_login_at: null,
        is_active: true,
        is_super_admin: false,
        deleted_at: null,
        created_at: CREATED_AT,
      },
      invite: { outcome: 'sent', expires_at: INVITE_EXPIRES },
      audit_recorded: true,
    });
    assert.deepEqual(routeHarness.logs, []);
  });

  test('No role sends role_id null, from a missing role_id or an explicit null', async () => {
    for (const body of [{ ...WEB_INVITE, role_id: undefined }, { ...WEB_INVITE, role_id: null }]) {
      routeReset({ target: createdStored() }, webInviter());
      assert.equal((await send('POST', body)).status, 200);
      assert.deepEqual(inviteCalls().map((args) => (args as Record<string, unknown>).p_role_id), [null]);
    }
  });

  test('an email that was not sent, or may have gone out, still answers 200 with the outcome and keeps the account', async () => {
    for (const delivery of [{ outcome: 'not_sent', reason: 'Template not available' }, { outcome: 'unknown', reason: 'timeout' }] as const) {
      routeReset({ target: createdStored() }, webInviter(), { send: delivery });
      const reply = await send('POST', WEB_INVITE);
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body.invite, { outcome: delivery.outcome, expires_at: INVITE_EXPIRES });
      assert.deepEqual(routeAudits().map((row) => [row.action, row.result, row.error]), [['ADMIN_INVITE_SENT', 'failure', delivery.reason]]);
      assert.deepEqual(routeQueries('admin_users', 'update'), []);
    }
  });

  test('a failed read-back still answers 200 with admin null, and sends the email', async () => {
    routeReset({ target: createdStored(), readError: CONNECTION_LOST }, webInviter());
    const reply = await send('POST', WEB_INVITE);
    assert.equal(reply.status, 200);
    assert.equal(reply.body.admin, null);
    assert.equal(reply.body.id, CREATED_ID);
    assert.equal(routeHarness.links.sends.length, 1);
    assert.ok(routeHarness.logs.some((line) => line.startsWith('admin invite read back:')));
  });

  test('database refusals answer 400, 403 or 409 with a CREATE_ADMIN failure audit and no email', async () => {
    const cases: Array<[RouteRpcReply, number, string, string, Record<string, unknown> | undefined]> = [
      [{ data: { ok: false, reason: 'role_not_found' } }, 400, 'VALIDATION_ERROR', 'That role does not exist.', { reason: 'role_not_found' }],
      [{ data: { ok: false, reason: 'role_protected' } }, 409, 'STATE_CONFLICT', 'This role cannot be assigned.', { reason: 'role_protected' }],
      [{ data: { ok: false, reason: 'role_archived' } }, 409, 'STATE_CONFLICT', 'This role is archived.', { reason: 'role_archived' }],
      [{ data: { ok: false, reason: 'reason_required' } }, 400, 'VALIDATION_ERROR', REASON_TEXT, { reason: 'reason_required' }],
      [
        { error: { message: 'duplicate key value violates unique constraint "admin_users_username_key"', code: '23505' } },
        400, 'VALIDATION_ERROR', 'That username is already taken.', undefined,
      ],
      [{ error: { message: 'Not authorized', code: 'P0001' } }, 403, 'PERMISSION_DENIED', SUPER_ONLY, undefined],
      [{ error: { message: 'This role is archived', code: 'P0001' } }, 409, 'STATE_CONFLICT', 'This role is archived.', { reason: 'role_archived' }],
    ];
    for (const [invite, status, code, message, details] of cases) {
      routeReset({ target: null, invite }, webInviter());
      const reply = await send('POST', WEB_INVITE);
      assert.equal(reply.status, status, message);
      assert.deepEqual(reply.body, details ? { ...failureBody(message, code), details } : failureBody(message, code));
      const audits = routeAudits();
      assert.deepEqual(audits.map(auditSummary), [{
        admin_id: SELF_ID,
        action: 'CREATE_ADMIN',
        entity: 'admin_users',
        entity_id: null,
        reason: INVITE_REASON,
        result: 'failure',
        error: audits[0]?.error,
        sensitivity: 'security',
      }]);
      assert.equal(typeof audits[0]?.error, 'string');
      assert.deepEqual(audits[0]?.after_value, {
        username: 'tolu', email: 'tolu@cardelite.ng', role_title: 'Payout Officer', role_id: ROLE_ID,
      });
      assert.equal(routeHarness.links.sends.length, 0);
      assert.deepEqual(routeHarness.logs, []);
    }
  });

  test('an outage or an unreadable answer is a 500, never a 401, logged and recorded, with no email', async () => {
    const replies: RouteRpcReply[] = [
      { error: CONNECTION_LOST },
      'throw',
      { data: null },
      { data: { ok: false } },
      { data: { ok: false, reason: 'mystery' } },
      { data: { ok: true } },
      { data: { ok: true, admin_id: 'nope', username: 'tolu', email: 'tolu@cardelite.ng', expires_at: INVITE_EXPIRES } },
      { data: { ok: true, admin_id: CREATED_ID, username: 'tolu', email: 'tolu@cardelite.ng' } },
    ];
    for (const invite of replies) {
      routeReset({ target: null, invite }, webInviter());
      const reply = await send('POST', WEB_INVITE);
      assert.equal(reply.status, 500, JSON.stringify(invite));
      assert.deepEqual(reply.body, failureBody(CREATE_FAILED, 'INTERNAL_ERROR'));
      assert.deepEqual(routeAudits().map((row) => [row.action, row.result]), [['CREATE_ADMIN', 'failure']]);
      assert.equal(routeHarness.links.sends.length, 0);
      assert.ok(routeHarness.logs.some((line) => line.startsWith('admin invite failed:')), JSON.stringify(invite));
    }
  });

  test('waits up to 30 seconds for the email', () => {
    assert.equal(accountsRoute.maxDuration, 30);
    assert.equal(inviteRoute.maxDuration, 30);
  });
});

describe('POST /api/admin-accounts/[id]/invite: resending an invitation', () => {
  captureRouteLogs();

  test('only a signed-in super admin may resend; a bad id answers 400 and missing links 500, before anything is issued', async () => {
    routeReset({}, { ...OWNER, is_super_admin: false });
    assert.equal((await resend()).status, 403);
    routeReset({}, null);
    assert.equal((await resend()).status, 401);
    routeReset({}, OWNER);
    const bad = await resend('nope');
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body, failureBody('A valid admin account id is required.', 'VALIDATION_ERROR'));
    routeReset({}, OWNER, { configured: false });
    const unset = await resend();
    assert.equal(unset.status, 500);
    assert.deepEqual(unset.body, failureBody('Invitations are not set up on the server, so nothing was sent.', 'INTERNAL_ERROR'));
    assert.deepEqual(routeHarness.links.issues, []);
    assert.deepEqual(routeAudits(), []);
  });

  test('issue refusals answer 404 or 409 and an outage 500, with no audit row', async () => {
    const cases: Array<[string, number, string, string]> = [
      ['not_found', 404, 'RESOURCE_NOT_FOUND', 'Admin account not found.'],
      ['inactive', 409, 'STATE_CONFLICT', 'Reactivate this account before sending a new invitation.'],
      ['password_set', 409, 'STATE_CONFLICT', 'This admin has already chosen a password.'],
      ['no_email', 409, 'STATE_CONFLICT', 'Add an email address first.'],
      ['unavailable', 500, 'INTERNAL_ERROR', 'The invitation could not be sent right now. Try again shortly.'],
    ];
    for (const [reason, status, code, message] of cases) {
      routeReset({}, OWNER, { issue: { outcome: 'not_sent', reason, expiresAt: null } });
      const reply = await resend();
      assert.equal(reply.status, status, reason);
      assert.deepEqual(reply.body, failureBody(message, code));
      assert.deepEqual(routeAudits(), []);
    }
  });

  test('a resend needs no reason or step-up, keeps the role, and answers 200 with the outcome for every send', async () => {
    for (const issue of [
      { outcome: 'sent', reason: null, expiresAt: INVITE_EXPIRES },
      { outcome: 'not_sent', reason: 'SMTP not configured', expiresAt: INVITE_EXPIRES },
      { outcome: 'unknown', reason: 'timeout', expiresAt: INVITE_EXPIRES },
    ] as const) {
      routeReset({}, WEB_OWNER, { issue });
      const reply = await resend(ADMIN_ID.toUpperCase());
      assert.equal(reply.status, 200, issue.outcome);
      assert.deepEqual(reply.body, {
        success: true, request_id: ROUTE_REQUEST_ID, invite: { outcome: issue.outcome, expires_at: INVITE_EXPIRES },
      });
      assert.deepEqual(routeHarness.links.issues, [{ adminId: ADMIN_ID, purpose: 'invite', inviter: 'owner' }]);
      const audits = routeAudits();
      assert.deepEqual(audits.map(auditSummary), [{
        admin_id: SELF_ID,
        action: 'ADMIN_INVITE_SENT',
        entity: 'admin_users',
        entity_id: ADMIN_ID,
        reason: null,
        result: issue.outcome === 'sent' ? 'success' : 'failure',
        error: issue.reason,
        sensitivity: 'security',
      }]);
      assert.deepEqual(audits[0]?.after_value, { outcome: issue.outcome, expires_at: INVITE_EXPIRES, resend: true });
      assert.deepEqual(routeHarness.queries.filter((query) => query.table === 'admin_users'), []);
      assert.deepEqual(routeHarness.rpcs, []);
    }
  });

  test('the route exports only POST, is guarded by requireSuperAdmin and writes its action as a literal', () => {
    const source = readFileSync(INVITE_FILE, 'utf8');
    assert.deepEqual([...source.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((match) => match[1]), [
      'maxDuration', 'POST',
    ]);
    assert.match(source, /await requireSuperAdmin\(\)/);
    assert.doesNotMatch(source, /requireRecentAuth|requireTwoStep|req\.json|readBody|body\./);
    assert.match(source, /action: 'ADMIN_INVITE_SENT'/);
    assert.match(source, /issueAndSend\(\{ adminId: id, purpose: 'invite', inviter: admin\.username \}\)/);
  });
});

describe('/api/admin-accounts: access fields belong to the Access step', () => {
  captureRouteLogs();

  test('role_id or direct_permissions answer 400 before anything is read, from any edit and from the phone’s create', async () => {
    const requests: Array<[RouteClaims, 'POST' | 'PATCH', Record<string, unknown>]> = [];
    for (const claims of [OWNER, WEB_OWNER]) {
      requests.push(
        [claims, 'PATCH', { id: ADMIN_ID, role_id: ROLE_ID }],
        [claims, 'PATCH', { id: ADMIN_ID, role_id: null }],
        [claims, 'PATCH', { id: ADMIN_ID, direct_permissions: [] }],
        [claims, 'PATCH', { ...phoneEdit(['card_queue', 'users']), role_id: ROLE_ID }],
      );
    }
    requests.push(
      [OWNER, 'POST', { ...PHONE_CREATE, role_id: ROLE_ID }],
      [OWNER, 'POST', { ...PHONE_CREATE, direct_permissions: ['coupons'] }],
    );
    for (const [claims, method, body] of requests) {
      routeReset({}, claims);
      const reply = await send(method, body);
      assert.equal(reply.status, 400, `${claims.session.client} ${method} ${JSON.stringify(body)}`);
      assert.deepEqual(reply.body, failureBody(ACCESS_ELSEWHERE, 'VALIDATION_ERROR'));
      assert.deepEqual(routeHarness.queries, []);
    }
  });

  test('a web edit cannot set a password, while the phone’s password edit still saves', async () => {
    routeReset({ target: member() }, WEB_OWNER);
    const refused = await send('PATCH', { id: ADMIN_ID, password: 'Correct-Horse-9', reason: 'Forgot it' });
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, failureBody('Passwords are chosen by the admin from a reset email.', 'VALIDATION_ERROR'));
    assert.deepEqual(routeHarness.queries, []);
    routeReset({ target: member() });
    const phone = await send('PATCH', { id: ADMIN_ID, password: 'Correct-Horse-9' });
    assert.equal(phone.status, 200);
    assert.deepEqual(routeQueries('admin_users', 'update')[0]?.payload, { token_version: 5, password_hash: 'bcrypt-hash:12' });
    assert.equal(phone.body.sessions_revoked, true);
  });

  test('an email edit from either client is saved trimmed and in lowercase', async () => {
    for (const claims of [OWNER, WEB_OWNER]) {
      routeReset({ target: member() }, claims);
      const reply = await send('PATCH', { id: ADMIN_ID, email: ' Ada.Obi@CardElite.NG ', reason: 'New mailbox' });
      assert.equal(reply.status, 200, claims.session.client);
      assert.deepEqual(routeQueries('admin_users', 'update')[0]?.payload, { email: 'ada.obi@cardelite.ng' });
    }
  });

  test('page_permissions from a web session answer 400, while the web console’s account edits still save', async () => {
    routeReset({ target: member() }, WEB_OWNER);
    const refused = await send('PATCH', { ...phoneEdit(['card_queue', 'users']), reason: 'Tidy up' });
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, failureBody(ACCESS_ELSEWHERE, 'VALIDATION_ERROR'));
    assert.deepEqual(routeHarness.queries, []);
    routeReset({ target: member() }, WEB_OWNER);
    const titled = await send('PATCH', { id: ADMIN_ID, role_title: 'Lead', reason: 'Promotion', expected: { role_title: 'Card Reviewer' } });
    assert.equal(titled.status, 200);
    assert.deepEqual(routeQueries('admin_users', 'update')[0]?.payload, { role_title: 'Lead', token_version: 5 });
  });

  test('the web create asks for two-step sign-in, then a recent identity check, before its body; the phone, PATCH and DELETE ask for neither', () => {
    const source = readFileSync(ROUTE_FILE, 'utf8');
    assert.match(source, /admin\.session\.client !== 'mobile'/);
    const handler = (name: string) => {
      const start = source.indexOf(`export async function ${name}(`);
      assert.ok(start > 0, name);
      const next = source.indexOf('\nexport async function ', start + 1);
      return source.slice(start, next < 0 ? source.length : next);
    };
    const post = handler('POST');
    const order = [
      'await requireSuperAdmin()',
      "if (admin.session.client === 'mobile') return createForPhone(req, admin);",
      'await requireTwoStep(admin)',
      'await requireRecentAuth(admin)',
      'return inviteFromWeb(req, admin);',
    ].map((needle) => post.indexOf(needle));
    assert.ok(order.every((at) => at > 0), JSON.stringify(order));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.doesNotMatch(post, /readBody/);
    for (const name of ['GET', 'PATCH', 'DELETE']) {
      assert.doesNotMatch(handler(name), /requireRecentAuth|requireTwoStep|REAUTH_REQUIRED|MFA_REQUIRED/, name);
    }
    const phone = source.slice(source.indexOf('async function createForPhone('), source.indexOf('async function inviteFromWeb('));
    assert.ok(phone.length > 0);
    assert.doesNotMatch(phone, /requireRecentAuth|requireTwoStep|admin_invite_create|mintLinkToken|sendLinkEmail/);
    assert.equal((source.match(/requireTwoStep\(admin\)|requireRecentAuth\(admin\)/g) ?? []).length, 2);
    const invite = source.slice(source.indexOf('async function inviteFromWeb('), source.indexOf('export async function POST('));
    const steps = [
      'await readBody(req)',
      'body.password !== undefined',
      'body.direct_permissions !== undefined || body.page_permissions !== undefined',
      'readReason(body.reason)',
      'readRole(body.role_id)',
      "checkCreate(body as CreateInput, 'web')",
      'if (!linksConfigured())',
      'mintLinkToken()',
      'await createInvite(',
      'await readCreated(',
      'await sendLinkEmail({',
      "action: 'ADMIN_INVITE_SENT'",
    ].map((needle) => invite.indexOf(needle));
    assert.ok(steps.every((at) => at >= 0), JSON.stringify(steps));
    assert.deepEqual(steps, [...steps].sort((a, b) => a - b));
    assert.deepEqual([...source.matchAll(/\.rpc\('([a-z_]+)'/g)].map((match) => match[1]), [
      'admin_security_overview', 'admin_invite_create',
    ]);
  });
});
