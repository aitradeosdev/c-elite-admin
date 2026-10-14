import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createElement, type ElementType, type ReactNode } from 'react';
import { classesOf, loadAppModule, render, tagsOf, textOf, withClass, type Attrs } from './support/uiHarness.ts';
import {
  ALL_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  PERMISSION_CATALOG,
  resolvePermissions,
  type Permission,
} from '../app/lib/permissions.ts';
import type {
  AdminList, AdminRow, AdminSecurity, MfaCellState, MutationResult, SecurityPolicy,
} from '../app/(dashboard)/admin-accounts/model.ts';
import type { AdminState, EditInput } from '../app/(dashboard)/admin-accounts/rules.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type { DeviceSession } from '../app/lib/adminSecurity.ts';

type RulesModule = typeof import('../app/(dashboard)/admin-accounts/rules.ts');
type ModelModule = typeof import('../app/(dashboard)/admin-accounts/model.ts');
type ConfirmModule = typeof import('../app/(dashboard)/admin-accounts/confirmOptions.tsx');
type SecurityPartsModule = typeof import('../app/(dashboard)/admin-accounts/SecurityParts.tsx');
type NavModule = typeof import('../app/(dashboard)/_shell/nav.ts');

let rules: RulesModule;
let model: ModelModule;
let confirmOptions: ConfirmModule;
let securityParts: SecurityPartsModule;
let nav: NavModule;
let GrantEditor: ElementType;
let GrantDiff: ElementType;

before(async () => {
  rules = await loadAppModule<RulesModule>('(dashboard)/admin-accounts/rules.ts');
  model = await loadAppModule<ModelModule>('(dashboard)/admin-accounts/model.ts');
  confirmOptions = await loadAppModule<ConfirmModule>('(dashboard)/admin-accounts/confirmOptions.tsx');
  securityParts = await loadAppModule<SecurityPartsModule>('(dashboard)/admin-accounts/SecurityParts.tsx');
  nav = await loadAppModule<NavModule>('(dashboard)/_shell/nav.ts');
  GrantEditor = (await loadAppModule<Record<string, ElementType>>('(dashboard)/admin-accounts/GrantEditor.tsx')).GrantEditor;
  GrantDiff = (await loadAppModule<Record<string, ElementType>>('(dashboard)/admin-accounts/GrantParts.tsx')).GrantDiff;
});

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const ADMIN_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const SELF_ID = '11111111-2222-4333-8444-555555555555';

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
    last_login_at: '2026-09-30T10:00:00.000Z',
    is_active: true,
    is_super_admin: false,
    deleted_at: null,
    created_at: '2026-01-02T09:00:00.000Z',
    security: null,
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

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
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

  test('every key the previous route accepted is still accepted', () => {
    const checked = rules.checkGrants(LEGACY_ROUTE_ACCEPTED);
    assert.ok(checked.ok);
    assert.deepEqual(new Set(checked.ok ? checked.keys : []), new Set(LEGACY_ROUTE_ACCEPTED));
  });

  test('accepts every page key and every additional permission together', () => {
    const all = [...rules.PAGE_KEYS, ...rules.ADDITIONAL_PERMISSIONS];
    const checked = rules.checkGrants(all);
    assert.ok(checked.ok);
  });

  test('refuses a catalog key that a page key already grants, so payouts cannot be stranded', () => {
    for (const key of ['withdrawals.approve', 'withdrawals.read', 'users.freeze', 'cards.review']) {
      const checked = rules.checkGrants(['withdrawals', key]);
      assert.equal(checked.ok, false, key);
      assert.equal(checked.ok ? '' : checked.message, `Unknown permission key: ${key}`);
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

  test('creating an admin keeps the required fields and validates grants', () => {
    const base = {
      username: 'tolu',
      email: 'tolu@cardelite.ng',
      password: 'Correct-Horse-9',
      role_title: 'Payout Officer',
    };
    const created = rules.checkCreate({ ...base, page_permissions: ['withdrawals', 'sensitive_data.share'] });
    assert.ok(created.ok);
    assert.deepEqual(created.ok ? created.value.page_permissions : null, ['withdrawals', 'sensitive_data.share']);
    const bare = rules.checkCreate(base);
    assert.deepEqual(bare.ok ? bare.value.page_permissions : null, []);
    assert.equal(rules.checkCreate({ ...base, email: '' }).ok, false);
    assert.equal(rules.checkCreate({ ...base, email: 'not-an-email' }).ok, false);
    assert.equal(rules.checkCreate({ ...base, password: 'weak' }).ok, false);
    assert.equal(rules.checkCreate({ ...base, username: 'ab' }).ok, false);
    assert.equal(rules.checkCreate({ ...base, role_title: 'x' }).ok, false);
    assert.equal(rules.checkCreate({ ...base, page_permissions: ['withdrawals.approve'] }).ok, false);
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

  test('a grant change is recorded with its diff and signs the admin out', () => {
    const result = plan({ page_permissions: ['card_queue', 'users', 'users_freeze', 'sensitive_data.share'], reason: 'x' });
    assert.equal(result.action, 'EDIT_ADMIN');
    assert.deepEqual(result.changed, ['page_permissions']);
    assert.equal(result.revokesSessions, true);
    assert.equal(result.updates.token_version, 5);
    assert.deepEqual(result.grants?.added, ['users_freeze', 'sensitive_data.share']);
    const after = result.after as { grant_changes: { added: string[]; actions_gained: string[] } };
    assert.deepEqual(after.grant_changes.added, ['users_freeze', 'sensitive_data.share']);
    assert.ok(after.grant_changes.actions_gained.includes('users.freeze'));
    assert.deepEqual((result.before as { page_permissions: string[] }).page_permissions, ['card_queue', 'users']);
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

  test('refuses catalog keys that page keys already grant and treats null grants as none', () => {
    assert.equal(refusal({ page_permissions: ['withdrawals.approve'] })?.code, 'VALIDATION_ERROR');
    assert.deepEqual(plan({ page_permissions: null }).updates.page_permissions, []);
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

  test('the in-use list matches what the console actually checks', () => {
    const skip = [join(APP_DIR, 'lib', 'permissions.ts'), join(APP_DIR, '(dashboard)', 'admin-accounts') + sep];
    const sources = sourceFiles(APP_DIR)
      .filter((file) => !skip.some((prefix) => file === prefix || file.startsWith(prefix)))
      .map((file) => readFileSync(file, 'utf8'));
    const referenced = rules.ADDITIONAL_PERMISSIONS.filter((key) =>
      sources.some((source) => source.includes(`'${key}'`) || source.includes(`"${key}"`)));
    assert.deepEqual(
      new Set(model.ENFORCED_ADDITIONAL),
      new Set(referenced),
      'An additional permission started or stopped being checked; update ENFORCED_ADDITIONAL in admin-accounts/model.ts',
    );
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
    assert.equal(list.currentAdminId, 'abc');
    assert.equal(model.toAdminList({ admins: 'nope' }), null);
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
      edit: false, revoke: false, deactivate: false, reactivate: false, remove: false, resetMfa: false,
    });
    const otherSuper = model.capabilitiesFor(row({ is_super_admin: true }), SELF_ID);
    assert.deepEqual(otherSuper, {
      edit: false, revoke: true, deactivate: true, reactivate: false, remove: false, resetMfa: false,
    });
    const inactive = model.capabilitiesFor(row({ is_active: false }), SELF_ID);
    assert.deepEqual(inactive, {
      edit: true, revoke: false, deactivate: false, reactivate: true, remove: true, resetMfa: false,
    });
    const deleted = model.capabilitiesFor(row({ is_active: false, deleted_at: '2026-09-01T00:00:00.000Z' }), SELF_ID);
    assert.equal(model.hasRowActions(deleted), false);
    assert.equal(deleted.edit, false);
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

  test('creating needs a username, email, role title, password and a real grant', () => {
    const errors = model.validateDraft('create', draft());
    assert.deepEqual(Object.keys(errors).sort(), ['email', 'grants', 'password', 'roleTitle', 'username']);
    const ready = draft({
      username: 'tolu', email: 'tolu@cardelite.ng', roleTitle: 'Payout Officer',
      password: 'Correct-Horse-9', confirmPassword: 'Correct-Horse-9', grants: ['withdrawals'],
    });
    assert.deepEqual(model.validateDraft('create', ready), {});
    assert.ok(model.validateDraft('create', { ...ready, confirmPassword: 'Other-Horse-9' }).confirmPassword);
    assert.ok(model.validateDraft('create', { ...ready, grants: ['giftbox'] }).grants);
    assert.match(model.validateDraft('create', { ...ready, grants: ['withdrawals', 'mystery'] }).grants ?? '', /unrecognised/);
  });

  test('editing keeps the password optional and the email required', () => {
    const base = model.draftFor(row());
    assert.deepEqual(model.validateDraft('edit', base), {});
    assert.ok(model.validateDraft('edit', { ...base, email: ' ' }).email);
    assert.equal(model.firstError(model.validateDraft('edit', { ...base, email: '', grants: [] })), 'email');
  });

  test('dirty tracking ignores reordering and surrounding spaces', () => {
    const admin = row();
    const base = model.valuesOf(admin);
    const current = model.draftFor(admin);
    assert.equal(model.isDraftDirty('edit', { ...current, grants: ['users', 'card_queue'], roleTitle: ' Card Reviewer ' }, base), false);
    assert.equal(model.isDraftDirty('edit', { ...current, password: 'x' }, base), true);
    assert.equal(model.isDraftDirty('create', draft(), model.valuesOf(row({ email: null, role_title: '', page_permissions: [] }))), false);
  });

  test('rebasing keeps both admins’ grant changes and flags a clashing field', () => {
    const base = { email: 'a@x.ng', roleTitle: 'Reviewer', grants: ['card_queue', 'users'] };
    const local = { email: 'a@x.ng', roleTitle: 'Lead', grants: ['card_queue', 'users', 'coupons'] };
    const server = { email: 'b@x.ng', roleTitle: 'Senior', grants: ['card_queue'] };
    const rebased = model.rebaseValues(base, local, server);
    assert.deepEqual(rebased.values, { email: 'b@x.ng', roleTitle: 'Lead', grants: ['card_queue', 'coupons'] });
    assert.deepEqual(rebased.conflicts, ['roleTitle']);
    assert.equal(rebased.changedElsewhere, true);
    assert.equal(model.rebaseValues(base, local, base).changedElsewhere, false);
  });

  test('an edit proposal sends only what changed', () => {
    const live = row();
    const values = { email: 'ada@cardelite.ng', roleTitle: 'Card Reviewer', grants: ['card_queue', 'users', 'users_freeze'] };
    const proposal = model.proposeEdit(live, values, '');
    assert.equal(proposal.email, null);
    assert.equal(proposal.roleTitle, null);
    assert.deepEqual(proposal.grants?.added, ['users_freeze']);
    assert.equal(proposal.revokesSessions, true);
    assert.deepEqual(model.editRequestBody(live.id, proposal, '', 'Needs freeze'), {
      id: ADMIN_ID,
      reason: 'Needs freeze',
      page_permissions: ['card_queue', 'users', 'users_freeze'],
      expected: { page_permissions: ['card_queue', 'users'] },
    });
    const email = model.proposeEdit(live, { ...model.valuesOf(live), email: 'new@cardelite.ng' }, '');
    assert.deepEqual(email.email, { before: 'ada@cardelite.ng', after: 'new@cardelite.ng' });
    assert.equal(email.revokesSessions, false);
    assert.equal(model.isEmptyProposal(model.proposeEdit(live, model.valuesOf(live), '')), true);
    assert.equal(model.isEmptyProposal(model.proposeEdit(live, model.valuesOf(live), 'Correct-Horse-9')), false);
  });

  test('the create body trims names and never adds fields the route does not know', () => {
    const body = model.createRequestBody(draft({
      username: ' tolu ', email: ' tolu@cardelite.ng ', roleTitle: ' Payout ', password: 'Correct-Horse-9',
      confirmPassword: 'Correct-Horse-9', grants: ['withdrawals', 'withdrawals'],
    }), 'New hire');
    assert.deepEqual(body, {
      username: 'tolu', email: 'tolu@cardelite.ng', password: 'Correct-Horse-9', role_title: 'Payout',
      page_permissions: ['withdrawals'], reason: 'New hire',
    });
  });
});

describe('mutation outcomes', () => {
  const failure = (patch: Partial<ApiFailure>): ApiResult<MutationResult> => ({
    ok: false,
    error: {
      kind: 'http', status: 400, code: 'VALIDATION_ERROR', message: 'Bad', requestId: null, details: null,
      outcomeUnknown: false, ...patch,
    },
  });

  test('maps failures onto retry, stale, refused, unknown and expired', () => {
    assert.equal(model.classifyMutation(failure({})).kind, 'retry');
    assert.equal(model.classifyMutation(failure({ status: 409 })).kind, 'stale');
    assert.equal(model.classifyMutation(failure({ status: 404 })).kind, 'stale');
    assert.equal(model.classifyMutation(failure({ status: 403 })).kind, 'refused');
    assert.equal(model.classifyMutation(failure({ status: 401 })).kind, 'expired');
    assert.equal(model.classifyMutation(failure({ status: 500, code: null, outcomeUnknown: true })).kind, 'unknown');
    assert.equal(model.classifyMutation(failure({ kind: 'timeout', status: null, outcomeUnknown: true })).kind, 'unknown');
  });

  test('reads the additive response fields', () => {
    const result = model.toMutationResult({
      success: true, changed: true, sessions_revoked: true, admin: { id: ADMIN_ID, username: 'ada' }, warning: 'w',
    });
    assert.equal(result.admin?.id, ADMIN_ID);
    assert.equal(result.sessionsRevoked, true);
    assert.equal(result.warning, 'w');
    assert.equal(model.toMutationResult({ success: true }).changed, true);
  });
});

describe('rendered grant editor', () => {
  function editor(value: string[], baseline: string[] = value, mode: 'create' | 'edit' = 'edit', error?: string) {
    return render(createElement(GrantEditor, { value, baseline, mode, error, onChange: () => {} }));
  }

  test('renders a real checkbox for every grantable page and in-use permission, with reserved ones hidden', () => {
    const html = editor(['withdrawals']);
    const boxes = tagsOf(html, 'input').filter((input) => input.type === 'checkbox');
    const expected = rules.GRANTABLE_PAGE_KEYS.length + rules.ADDITIONAL_PERMISSIONS.length;
    assert.equal(boxes.length, expected);
    assert.equal(boxes.filter((input) => 'checked' in input).length, 1);
    const reserved = tagsOf(html, 'div').find((div) => classesOf(div).includes('reservedBody'));
    assert.ok(reserved && 'hidden' in reserved);
    const text = textOf(html);
    assert.match(text, /Freeze & unfreeze users/);
    assert.match(text, /Approve withdrawals/);
    assert.doesNotMatch(text, /Other stored keys/);
  });

  test('opens the reserved list when the account holds a reserved permission', () => {
    const html = editor(['withdrawals', 'reconciliation.read']);
    const reserved = tagsOf(html, 'div').find((div) => classesOf(div).includes('reservedBody'));
    assert.ok(reserved && !('hidden' in reserved));
  });

  test('lists stored keys that cannot be granted, marking unknown ones invalid', () => {
    const html = editor(['coupons', 'admin_accounts', 'mystery']);
    const text = textOf(html);
    assert.match(text, /Other stored keys/);
    assert.match(text, /super administrators only/);
    assert.ok(tagsOf(html, 'input').some((input) => input['aria-invalid'] === 'true'));
  });

  test('marks pending additions and removals while editing, and shows the error', () => {
    const html = editor(['coupons', 'users'], ['coupons', 'withdrawals'], 'edit', 'Give this admin at least one page or permission.');
    assert.equal(withClass(html, 'span', 'grantMark').length, 2);
    assert.match(textOf(html), /Give this admin at least one page or permission\./);
    assert.equal(withClass(editor(['coupons'], [], 'create'), 'span', 'grantMark').length, 0);
  });
});

describe('confirmations', () => {
  const html = (...nodes: ReactNode[]) => render(createElement('div', null, ...nodes));

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
  });

  test('the edit confirmation shows before and after values and never the password', () => {
    const live = row();
    const proposal = model.proposeEdit(
      live,
      { email: 'new@cardelite.ng', roleTitle: 'Lead', grants: ['card_queue'] },
      'Correct-Horse-9',
    );
    const options = confirmOptions.editConfirm(live, proposal, { values: model.valuesOf(live), conflicts: [], changedElsewhere: false });
    assert.equal(options.reason?.required, true);
    const text = textOf(html(
      options.message,
      ...(options.details ?? []).map((detail) => createElement('p', { key: detail.label }, detail.label, ' ', detail.value)),
      ...(options.consequences ?? []),
    ));
    assert.match(text, /Card Reviewer → changes to Lead/);
    assert.match(text, /ada@cardelite\.ng → changes to new@cardelite\.ng/);
    assert.match(text, /Removing · 1/);
    assert.match(text, /signed out on every device/);
    assert.doesNotMatch(text, /Correct-Horse-9/);
  });

  test('the create confirmation lists every grant as added and keeps the password hidden', () => {
    const options = confirmOptions.createConfirm({
      ...model.EMPTY_DRAFT,
      username: 'tolu', email: 'tolu@cardelite.ng', roleTitle: 'Payout', password: 'Correct-Horse-9',
      confirmPassword: 'Correct-Horse-9', grants: ['withdrawals', 'reconciliation.read'],
    });
    const text = textOf(html(
      options.message,
      ...(options.details ?? []).map((detail) => createElement('p', { key: detail.label }, detail.value)),
      ...(options.consequences ?? []),
    ));
    assert.match(text, /Access granted · 2/);
    assert.match(text, /not checked anywhere yet/);
    assert.doesNotMatch(text, /Correct-Horse-9/);
    assert.equal(options.reason?.required, true);
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
      edit: false, revoke: false, deactivate: false, reactivate: false, remove: false, resetMfa: true,
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
    assert.match(source, /const COLUMN_COUNT = 7;/);
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

interface RouteClaims {
  admin_id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  token_version: number;
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
  terminal: 'maybeSingle' | null;
}

interface RouteScenario {
  target: StoredAdmin | null;
  superAdmins: number;
  updateError: RouteDbError | null;
}

interface RouteHarness {
  scenario: RouteScenario;
  queries: RouteQuery[];
  claims: RouteClaims;
  logs: string[];
  db: {
    from(table: string): object;
    rpc(name: string, args: unknown): Promise<never>;
  };
}

interface AccountsRoute {
  PATCH: (req: Request) => Promise<Response>;
  DELETE: (req: Request) => Promise<Response>;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const OWNER: RouteClaims = {
  admin_id: SELF_ID,
  username: 'owner',
  role_title: 'Super Admin',
  is_super_admin: true,
  page_permissions: [],
  token_version: 0,
};

function stored(patch: Partial<StoredAdmin> = {}): StoredAdmin {
  return {
    id: ADMIN_ID,
    username: 'ada',
    email: 'ada@cardelite.ng',
    role_title: 'Card Reviewer',
    page_permissions: ['card_queue', 'users'],
    last_login_at: '2026-09-30T10:00:00.000Z',
    is_active: true,
    is_super_admin: true,
    deleted_at: null,
    created_at: '2026-01-02T09:00:00.000Z',
    token_version: 4,
    ...patch,
  };
}

function routeScenario(patch: Partial<RouteScenario> = {}): RouteScenario {
  return { target: stored(), superAdmins: 2, updateError: null, ...patch };
}

const routeHarness: RouteHarness = {
  scenario: routeScenario(),
  queries: [],
  claims: OWNER,
  logs: [],
  db: {
    from: (table) => routeChain(table),
    rpc: (name) => Promise.reject(new Error(`unexpected rpc ${name}`)),
  },
};

Reflect.set(globalThis, ROUTE_KEY, routeHarness);

function routeAnswer(query: RouteQuery): Record<string, unknown> {
  const s = routeHarness.scenario;
  if (query.table === 'audit_log' && query.op === 'insert') return { error: null };
  if (query.table === 'admin_users' && query.op === 'select' && query.terminal === 'maybeSingle') return { data: s.target };
  if (query.table === 'admin_users' && query.op === 'select' && query.columns === 'id') return { count: s.superAdmins };
  if (query.table === 'admin_users' && query.op === 'update') {
    if (s.updateError) return { error: s.updateError };
    return { data: s.target ? [{ ...s.target, ...(query.payload as Record<string, unknown>) }] : [] };
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
    maybeSingle: () => {
      query.terminal = 'maybeSingle';
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

before(async () => {
  accountsRoute = (await import(await routeBundle(ROUTE_FILE))) as AccountsRoute;
});

function routeReset(patch: Partial<RouteScenario> = {}): void {
  routeHarness.scenario = routeScenario(patch);
  routeHarness.queries = [];
  routeHarness.logs.length = 0;
}

async function send(method: 'PATCH' | 'DELETE', body: unknown): Promise<Reply> {
  const req = new Request('http://localhost/api/admin-accounts', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = method === 'PATCH' ? await accountsRoute.PATCH(req) : await accountsRoute.DELETE(req);
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
