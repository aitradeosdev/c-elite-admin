import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ElementType, type ReactNode } from 'react';
import { classesOf, loadAppModule, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import {
  ALL_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  PERMISSION_CATALOG,
  resolvePermissions,
  type Permission,
} from '../app/lib/permissions.ts';
import type { AdminRow, MutationResult } from '../app/(dashboard)/admin-accounts/model.ts';
import type { AdminState, EditInput } from '../app/(dashboard)/admin-accounts/rules.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';

type RulesModule = typeof import('../app/(dashboard)/admin-accounts/rules.ts');
type ModelModule = typeof import('../app/(dashboard)/admin-accounts/model.ts');
type ConfirmModule = typeof import('../app/(dashboard)/admin-accounts/confirmOptions.tsx');
type NavModule = typeof import('../app/(dashboard)/_shell/nav.ts');

let rules: RulesModule;
let model: ModelModule;
let confirmOptions: ConfirmModule;
let nav: NavModule;
let GrantEditor: ElementType;
let GrantDiff: ElementType;

before(async () => {
  rules = await loadAppModule<RulesModule>('(dashboard)/admin-accounts/rules.ts');
  model = await loadAppModule<ModelModule>('(dashboard)/admin-accounts/model.ts');
  confirmOptions = await loadAppModule<ConfirmModule>('(dashboard)/admin-accounts/confirmOptions.tsx');
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
    assert.deepEqual(self, { edit: false, revoke: false, deactivate: false, reactivate: false, remove: false });
    const otherSuper = model.capabilitiesFor(row({ is_super_admin: true }), SELF_ID);
    assert.deepEqual(otherSuper, { edit: false, revoke: true, deactivate: true, reactivate: false, remove: false });
    const inactive = model.capabilitiesFor(row({ is_active: false }), SELF_ID);
    assert.deepEqual(inactive, { edit: true, revoke: false, deactivate: false, reactivate: true, remove: true });
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
