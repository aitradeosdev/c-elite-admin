import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAppModule } from './support/uiHarness.ts';
import type { Permission } from '../app/lib/permissions.ts';

type GrantsModule = typeof import('../app/lib/grants.ts');
type RulesModule = typeof import('../app/(dashboard)/admin-accounts/rules.ts');

let grants: GrantsModule;
let rules: RulesModule;

before(async () => {
  grants = await loadAppModule<GrantsModule>('lib/grants.ts');
  rules = await loadAppModule<RulesModule>('(dashboard)/admin-accounts/rules.ts');
});

const MANAGER = ['dashboard', 'users', 'withdrawals'];
const STALE = 'This admin’s access changed since you opened it. Reload and try again.';

const SAMPLES: string[][] = [
  [],
  ['withdrawals'],
  ['withdrawals', 'withdrawals.read'],
  ['users', 'users_freeze', 'giftbox', 'mystery', 'flags.read'],
  ['admin_accounts', 'roles.write', 'sensitive_data.share', 'dashboard'],
  ['', 'users', 'users', 'coupons.write'],
  ['card_queue', 'transfers', 'manual_wallet_credit', 'wallets.adjust'],
];

describe('helpers moved from admin-accounts/rules.ts', () => {
  test('behave exactly like the originals', () => {
    assert.deepEqual(grants.RISK_ORDER, rules.RISK_ORDER);
    assert.deepEqual(grants.RETIRED_PAGE_KEYS, rules.RETIRED_PAGE_KEYS);
    for (const a of SAMPLES) {
      assert.deepEqual(grants.normalizeGrants(a), rules.normalizeGrants(a));
      assert.deepEqual(grants.sortGrants(a), rules.sortGrants(a));
      assert.deepEqual([...grants.effectiveActions(a)], [...rules.effectiveActions(a)]);
      assert.equal(grants.highestRisk(grants.effectiveActions(a)), rules.highestRisk(rules.effectiveActions(a)));
      for (const key of a) {
        assert.deepEqual(grants.grantedActions(key), rules.grantedActions(key), key);
        assert.equal(grants.grantRisk(key), rules.grantRisk(key), key);
      }
      for (const b of SAMPLES) {
        const label = `${JSON.stringify(a)} -> ${JSON.stringify(b)}`;
        assert.equal(grants.sameGrants(a, b), rules.sameGrants(a, b), label);
        assert.deepEqual(grants.diffGrants(a, b), rules.diffGrants(a, b), label);
        assert.deepEqual(grants.grantChangeRecord(grants.diffGrants(a, b)), rules.grantChangeRecord(rules.diffGrants(a, b)), label);
      }
    }
  });
});

describe('composeGrants and matrixFromKeys', () => {
  test('composeGrants is the sorted, distinct union of the role keys and the direct grants, without blanks', () => {
    assert.deepEqual(grants.composeGrants(['users', 'withdrawals.read'], ['withdrawals.read', '', 'coupons']), [
      'coupons', 'users', 'withdrawals.read',
    ]);
    assert.deepEqual(grants.composeGrants(null, undefined), []);
    assert.deepEqual(grants.composeGrants([], ['flags.read']), ['flags.read']);
  });

  test('matrixFromKeys resolves stored keys to actions and never treats anyone as a super admin', () => {
    const matrix = grants.matrixFromKeys(['withdrawals', 'flags.read', 'giftbox']);
    assert.ok(matrix.has('withdrawals.approve'));
    assert.ok(matrix.has('flags.read'));
    assert.equal(matrix.size, 7);
    assert.equal(grants.matrixFromKeys([]).size, 0);
    assert.equal(grants.matrixFromKeys(null).size, 0);
  });
});

describe('keysFromMatrix', () => {
  test('keeps an untouched page key, and unticking approve leaves the other enforced withdrawal actions', () => {
    const ticked = grants.matrixFromKeys(['withdrawals']);
    assert.deepEqual(grants.keysFromMatrix(['withdrawals'], ticked), ['withdrawals']);
    const without = new Set<Permission>(ticked);
    without.delete('withdrawals.approve');
    assert.deepEqual(grants.keysFromMatrix(['withdrawals'], without), [
      'withdrawals.read', 'withdrawals.reject', 'withdrawals.export',
    ]);
  });

  test('ticking actions never folds them into a page key, and actions not in use yet are never newly added', () => {
    const all = new Set<Permission>(['withdrawals.read', 'withdrawals.approve', 'withdrawals.reject', 'withdrawals.export']);
    assert.deepEqual(grants.keysFromMatrix([], all), [
      'withdrawals.read', 'withdrawals.approve', 'withdrawals.reject', 'withdrawals.export',
    ]);
    assert.deepEqual(grants.keysFromMatrix([], new Set<Permission>(['withdrawals.retry', 'roles.write'])), []);
  });

  test('keeps dashboard and stored catalog keys, and keeps other stored keys only when asked', () => {
    const stored = ['dashboard', 'users', 'users.read', 'giftbox', 'transfers', 'admin_accounts'];
    const ticked = grants.matrixFromKeys(stored);
    assert.deepEqual(grants.keysFromMatrix(stored, ticked), ['dashboard', 'users', 'users.read']);
    assert.deepEqual(grants.keysFromMatrix(stored, ticked, true), [
      'dashboard', 'users', 'admin_accounts', 'users.read', 'giftbox', 'transfers',
    ]);
    const unticked = new Set<Permission>(ticked);
    unticked.delete('users.read');
    assert.deepEqual(grants.keysFromMatrix(stored, unticked), ['dashboard', 'users.export']);
  });
});

describe('checkNewKeys', () => {
  test('refuses newly added restricted, not-in-use, retired and unknown keys and the admins page key', () => {
    for (const kind of ['role', 'direct'] as const) {
      for (const key of ['roles.write', 'roles.read', 'admin_users.manage', 'admin_accounts', 'wallets.approve_adjustment', 'risk.read', 'giftbox', 'manual_wallet_credit', 'transfers', 'users.nope']) {
        assert.deepEqual(grants.checkNewKeys(['users', key], ['users'], kind)?.keys, [key], `${kind} ${key}`);
      }
    }
  });

  test('accepts enforced catalog keys, grantable page keys and every key already stored', () => {
    for (const kind of ['role', 'direct'] as const) {
      assert.equal(grants.checkNewKeys(['dashboard', 'users', 'withdrawals.read', 'sensitive_data.share', 'wallets.adjust'], [], kind), null);
      assert.equal(grants.checkNewKeys(
        ['admin_accounts', 'transfers', 'manual_wallet_credit', 'users'],
        ['admin_accounts', 'transfers', 'manual_wallet_credit'],
        kind,
      ), null);
    }
  });

  test('names the refused keys in a message worded for roles or for direct grants', () => {
    assert.deepEqual(grants.checkNewKeys(['roles.write'], [], 'role'), {
      keys: ['roles.write'],
      message: 'This permission cannot be added to a role: roles.write.',
    });
    assert.deepEqual(grants.checkNewKeys(['roles.write', 'admin_accounts', 'users'], null, 'direct'), {
      keys: ['admin_accounts', 'roles.write'],
      message: 'These permissions cannot be granted: admin_accounts, roles.write.',
    });
  });
});

describe('copying and folding access', () => {
  test('copyableKeys keeps the live Manager exactly and leaves out keys a role cannot hold', () => {
    assert.deepEqual(grants.copyableKeys(MANAGER), MANAGER);
    assert.deepEqual(
      grants.copyableKeys(['admin_accounts', 'giftbox', 'transfers', 'roles.write', 'wallets.approve_adjustment', 'flags.read', 'coupons']),
      ['flags.read', 'coupons'],
    );
    assert.deepEqual(grants.copyableKeys(null), []);
  });

  test('foldIntoRole removes what the role already covers, literally or through its actions', () => {
    assert.deepEqual(grants.foldIntoRole(grants.copyableKeys(MANAGER), MANAGER), []);
    assert.deepEqual(grants.foldIntoRole(['withdrawals.read', 'flags.read', 'coupons'], ['withdrawals']), ['flags.read', 'coupons']);
    assert.deepEqual(grants.foldIntoRole(['users', 'coupons.read'], []), ['users', 'coupons.read']);
  });
});

describe('phoneEditProblem', () => {
  test('an unchanged echo passes, with or without a role, including stored unknown keys', () => {
    assert.equal(grants.phoneEditProblem(MANAGER, MANAGER, MANAGER, 'Manager'), null);
    const superAdmin = ['dashboard', 'withdrawals', 'transfers', 'manual_wallet_credit'];
    assert.equal(grants.phoneEditProblem(superAdmin, superAdmin, [], null), null);
  });

  test('a dotted key added or missing answers 409 stale', () => {
    assert.deepEqual(grants.phoneEditProblem(['users', 'flags.read'], ['users'], [], null), { status: 409, message: STALE });
    assert.deepEqual(grants.phoneEditProblem(['users'], ['users', 'flags.read'], [], null), { status: 409, message: STALE });
    assert.deepEqual(
      grants.phoneEditProblem(['users', 'coupons.read'], ['users', 'flags.read'], ['flags.read'], 'Manager'),
      { status: 409, message: STALE },
    );
  });

  test('removing a page key that comes from the role answers 409 naming the role', () => {
    assert.deepEqual(grants.phoneEditProblem(['dashboard', 'users'], MANAGER, ['withdrawals'], 'Manager'), {
      status: 409,
      message: 'withdrawals comes from the role Manager. Change it in the web console.',
    });
    assert.deepEqual(grants.phoneEditProblem(['dashboard'], MANAGER, ['users', 'withdrawals'], 'Manager'), {
      status: 409,
      message: 'users, withdrawals come from the role Manager. Change them in the web console.',
    });
  });

  test('adding pages or removing a direct page key is left to the other checks', () => {
    assert.equal(grants.phoneEditProblem([...MANAGER, 'coupons'], MANAGER, ['withdrawals'], 'Manager'), null);
    assert.equal(grants.phoneEditProblem(['dashboard', 'withdrawals'], MANAGER, ['withdrawals'], 'Manager'), null);
  });
});

describe('actionDiff', () => {
  test('reports gained and lost actions in catalog order with the highest risk of either', () => {
    assert.deepEqual(grants.actionDiff(['withdrawals'], ['withdrawals.read']), {
      gained: [],
      lost: ['withdrawals.approve', 'withdrawals.reject', 'withdrawals.retry', 'withdrawals.resolve', 'withdrawals.export'],
      highest_risk: 'critical',
    });
    assert.deepEqual(grants.actionDiff(['users'], ['users', 'coupons']), {
      gained: ['coupons.read', 'coupons.write'],
      lost: [],
      highest_risk: 'medium',
    });
    assert.deepEqual(grants.actionDiff(['withdrawals'], ['withdrawals.read', 'withdrawals.approve', 'withdrawals.reject', 'withdrawals.retry', 'withdrawals.resolve', 'withdrawals.export']), {
      gained: [],
      lost: [],
      highest_risk: null,
    });
  });
});
