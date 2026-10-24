import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_PERMISSIONS,
  ENFORCED_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  PAGE_READ_PERMISSION,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  RESOURCE_LABELS,
  RESTRICTED_PERMISSIONS,
  actionLabel,
  actionOf,
  holdsAny,
  isPermission,
  permissionStatus,
  permissionsByCategory,
  resolvePermissions,
  resourceOf,
  type Permission,
  type PermissionStatus,
} from '../app/lib/permissions.ts';
import { loadAppModule } from './support/uiHarness.ts';

type NavModule = typeof import('../app/(dashboard)/_shell/nav.ts');

describe('catalog integrity', () => {
  test('every permission is resource.action', () => {
    for (const key of ALL_PERMISSIONS) {
      assert.match(key, /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, `bad key: ${key}`);
    }
  });

  test('no duplicate keys', () => {
    assert.equal(new Set(ALL_PERMISSIONS).size, ALL_PERMISSIONS.length);
  });

  test('every permission has metadata in a declared category', () => {
    for (const key of ALL_PERMISSIONS) {
      const meta = PERMISSION_CATALOG[key];
      assert.ok(meta, `missing meta: ${key}`);
      assert.ok(meta.label.length > 0, `empty label: ${key}`);
      assert.ok(meta.description.length > 0, `empty description: ${key}`);
      assert.ok(PERMISSION_CATEGORIES.includes(meta.category), `unknown category on ${key}`);
      assert.ok(['low', 'medium', 'high', 'critical'].includes(meta.risk), `bad risk on ${key}`);
    }
  });

  test('grouping covers the whole catalog exactly once', () => {
    const grouped = permissionsByCategory().flatMap((g) => g.permissions);
    assert.equal(grouped.length, ALL_PERMISSIONS.length);
    assert.deepEqual(new Set(grouped).size, ALL_PERMISSIONS.length);
  });

  test('every money-moving action is critical risk', () => {
    const mustBeCritical: Permission[] = [
      'withdrawals.approve',
      'withdrawals.retry',
      'withdrawals.resolve',
      'cards.review',
      'wallets.adjust',
      'rates.publish',
      'referrals.payout',
      'platform_balance.write',
    ];
    for (const key of mustBeCritical) {
      assert.equal(PERMISSION_CATALOG[key].risk, 'critical', `${key} should be critical`);
    }
  });
});

describe('wallet adjustments', () => {
  test('wallets.adjust is the single, immediate adjustment permission', () => {
    const meta = PERMISSION_CATALOG['wallets.adjust'];
    assert.equal(meta.label, 'Adjust wallets');
    assert.match(meta.description, /^Credit or debit a user’s wallet\./);
    assert.match(meta.description, /applies at once, with no second approval/);
    assert.equal(meta.risk, 'critical');
  });

  test('wallets.approve_adjustment is kept but says it is not used', () => {
    assert.equal(isPermission('wallets.approve_adjustment'), true);
    const meta = PERMISSION_CATALOG['wallets.approve_adjustment'];
    assert.match(meta.label, /\(not used\)$/);
    assert.match(meta.description, /^Not used/);
  });

  test('only an explicit grant or super admin holds wallets.adjust', () => {
    assert.ok(resolvePermissions(['wallets.adjust'], false).has('wallets.adjust'));
    assert.ok(resolvePermissions([], true).has('wallets.adjust'));
    assert.ok(!resolvePermissions(['wallets.approve_adjustment', 'users', 'platform_balance'], false).has('wallets.adjust'));
  });
});

describe('legacy expansion', () => {
  test('every legacy target is a real catalog key', () => {
    for (const [legacy, expanded] of Object.entries(LEGACY_PERMISSION_MAP)) {
      for (const key of expanded) {
        assert.ok(isPermission(key), `${legacy} maps to unknown permission ${key}`);
      }
    }
  });

  test('a page key grants exactly what that page already allowed', () => {
    const w = resolvePermissions(['withdrawals'], false);
    assert.ok(w.has('withdrawals.read'));
    assert.ok(w.has('withdrawals.approve'));
    assert.ok(w.has('withdrawals.reject'));
    assert.ok(w.has('withdrawals.export'));
    assert.ok(!w.has('users.read'));
    assert.ok(!w.has('wallets.adjust'));
  });

  test('card_queue keeps its existing ability to see submitted card values', () => {
    const c = resolvePermissions(['card_queue'], false);
    assert.ok(c.has('cards.read'));
    assert.ok(c.has('cards.review'));
    assert.ok(c.has('sensitive_data.reveal'));
  });

  test('card_queue does not grant sensitive download or export of protected columns', () => {
    const c = resolvePermissions(['card_queue'], false);
    assert.ok(!c.has('sensitive_data.download'));
    assert.ok(!c.has('sensitive_data.export'));
  });

  test('sharing card submissions is gated: no legacy key grants it', () => {
    const everyLegacyKey = Object.keys(LEGACY_PERMISSION_MAP);
    assert.ok(!resolvePermissions(everyLegacyKey, false).has('sensitive_data.share'),
      'owner decision S-1 option 2: only an explicit grant may allow sharing');
  });

  test('sharing can be granted explicitly and super admins hold it', () => {
    assert.ok(resolvePermissions(['card_queue', 'sensitive_data.share'], false).has('sensitive_data.share'));
    assert.ok(resolvePermissions([], true).has('sensitive_data.share'));
  });

  test('freeze stays a separate grant', () => {
    assert.ok(!resolvePermissions(['users'], false).has('users.freeze'));
    assert.ok(resolvePermissions(['users', 'users_freeze'], false).has('users.freeze'));
  });

  test('flags and reconciliation are reachable from no legacy key', () => {
    const everyLegacyKey = Object.keys(LEGACY_PERMISSION_MAP);
    const all = resolvePermissions(everyLegacyKey, false);
    assert.ok(!all.has('flags.read'));
    assert.ok(!all.has('flags.resolve'));
    assert.ok(!all.has('reconciliation.read'));
    assert.ok(!all.has('reconciliation.resolve'));
  });

  test('no legacy key grants privilege escalation', () => {
    const all = resolvePermissions(Object.keys(LEGACY_PERMISSION_MAP), false);
    assert.ok(!all.has('roles.write'));
    assert.ok(!all.has('wallets.adjust'));
    assert.ok(!all.has('emergency.manage'));
    assert.ok(!all.has('users.delete'));
  });

  test('dashboard grants nothing on its own', () => {
    assert.equal(resolvePermissions(['dashboard'], false).size, 0);
  });
});

describe('resolvePermissions', () => {
  test('super admin holds the whole catalog', () => {
    const s = resolvePermissions([], true);
    assert.equal(s.size, ALL_PERMISSIONS.length);
    for (const key of ALL_PERMISSIONS) assert.ok(s.has(key));
  });

  test('new-style keys pass through', () => {
    const s = resolvePermissions(['withdrawals.read', 'audit.read'], false);
    assert.deepEqual([...s].sort(), ['audit.read', 'withdrawals.read']);
  });

  test('mixed legacy and new-style keys combine', () => {
    const s = resolvePermissions(['users', 'audit.read'], false);
    assert.ok(s.has('users.read'));
    assert.ok(s.has('audit.read'));
  });

  test('unknown, blank and non-string entries are ignored, not granted', () => {
    const s = resolvePermissions(['', '   ', 'not_a_real_key', 'users.nope', '*'] as string[], false);
    assert.equal(s.size, 0);
  });

  test('null and undefined storage resolve to no access', () => {
    assert.equal(resolvePermissions(null, false).size, 0);
    assert.equal(resolvePermissions(undefined, false).size, 0);
  });

  test('duplicate entries do not duplicate grants', () => {
    const s = resolvePermissions(['users', 'users', 'users.read'], false);
    assert.equal([...s].filter((k) => k === 'users.read').length, 1);
  });
});

describe('legacy page keys stay separate', () => {
  test('no two legacy keys grant a shared action, so one page key never opens another page', () => {
    const owners = new Map<Permission, string[]>();
    for (const [key, granted] of Object.entries(LEGACY_PERMISSION_MAP)) {
      for (const permission of granted) owners.set(permission, [...(owners.get(permission) ?? []), key]);
    }
    const shared = [...owners].filter(([, keys]) => keys.length > 1).map(([permission, keys]) => `${permission}: ${keys.join(', ')}`);
    assert.deepEqual(shared, []);
  });

  test('the cards and field builder keys map to their own permissions', () => {
    assert.deepEqual([...LEGACY_PERMISSION_MAP.card_management].sort(), ['catalog.publish', 'catalog.read', 'catalog.write']);
    assert.deepEqual([...LEGACY_PERMISSION_MAP.card_type_builder].sort(), ['card_types.read', 'card_types.write']);
  });

  test('the template keys map to their own permissions, not the broadcast ones', () => {
    assert.deepEqual([...LEGACY_PERMISSION_MAP.notification_templates].sort(), ['notification_templates.read', 'notification_templates.write']);
    assert.deepEqual([...LEGACY_PERMISSION_MAP.email_templates].sort(), ['email_templates.read', 'email_templates.write']);
  });
});

describe('page read permissions', () => {
  test('every nav key except dashboard maps to a read action from its own bundle, and dashboard maps to none', async () => {
    const nav = await loadAppModule<NavModule>('(dashboard)/_shell/nav.ts');
    const keys = [...new Set(nav.NAV_GROUPS.flatMap((group) => group.items.map((leaf) => leaf.key)))]
      .filter((key) => key !== 'dashboard');
    assert.equal(keys.length, 22);
    for (const key of keys) {
      const read = PAGE_READ_PERMISSION[key];
      assert.ok(read, `no read permission for ${key}`);
      assert.ok(LEGACY_PERMISSION_MAP[key].includes(read), `${key} does not grant ${read}`);
      assert.equal(actionOf(read), 'read', key);
    }
    assert.deepEqual(Object.keys(PAGE_READ_PERMISSION).sort(), [...keys].sort());
    assert.equal(Object.hasOwn(PAGE_READ_PERMISSION, 'dashboard'), false);
  });
});

describe('permission statuses', () => {
  test('the statuses partition the catalog into in use, super administrators only and not in use yet', () => {
    const byStatus: Record<PermissionStatus, Permission[]> = { enforced: [], super_only: [], reserved: [] };
    for (const key of ALL_PERMISSIONS) byStatus[permissionStatus(key)].push(key);
    const all = [...byStatus.enforced, ...byStatus.super_only, ...byStatus.reserved];
    assert.equal(all.length, ALL_PERMISSIONS.length);
    assert.equal(new Set(all).size, ALL_PERMISSIONS.length);
    assert.deepEqual([...byStatus.super_only].sort(), [...RESTRICTED_PERMISSIONS].sort());
    assert.deepEqual(
      [...byStatus.enforced].sort(),
      ENFORCED_PERMISSIONS.filter((key) => !RESTRICTED_PERMISSIONS.includes(key)).sort(),
    );
  });

  test('only the admin and role permissions are restricted', () => {
    assert.deepEqual([...RESTRICTED_PERMISSIONS].sort(), [
      'admin_users.manage', 'admin_users.read', 'admin_users.sessions', 'roles.read', 'roles.write',
    ]);
  });

  test('the enforced list holds unique catalog keys, including the role and audit keys this work checks', () => {
    for (const key of ENFORCED_PERMISSIONS) assert.ok(isPermission(key), key);
    assert.equal(new Set(ENFORCED_PERMISSIONS).size, ENFORCED_PERMISSIONS.length);
    for (const key of ['roles.read', 'audit.read', 'audit.export', 'withdrawals.approve'] as const) {
      assert.ok(ENFORCED_PERMISSIONS.includes(key), key);
    }
    assert.equal(permissionStatus('roles.read'), 'super_only');
    assert.equal(permissionStatus('audit.read'), 'enforced');
    assert.equal(permissionStatus('withdrawals.retry'), 'reserved');
    assert.equal(permissionStatus('users.delete'), 'enforced');
    assert.equal(PERMISSION_CATALOG['users.delete'].risk, 'critical');
  });
});

describe('matrix labels', () => {
  test('every catalog key splits into a labelled resource and a labelled action', () => {
    const resources = new Set<string>();
    for (const key of ALL_PERMISSIONS) {
      assert.equal(`${resourceOf(key)}.${actionOf(key)}`, key);
      resources.add(resourceOf(key));
      assert.ok(RESOURCE_LABELS[resourceOf(key)], `no resource label for ${key}`);
      assert.notEqual(actionLabel(key), actionOf(key), `no action label for ${key}`);
    }
    assert.deepEqual(Object.keys(RESOURCE_LABELS).sort(), [...resources].sort());
  });

  test('actions read as plain words', () => {
    assert.equal(actionLabel('communications.send_all'), 'Send to all');
    assert.equal(actionLabel('withdrawals.read'), 'View');
    assert.equal(actionLabel('withdrawals.approve'), 'Approve');
    assert.equal(resourceOf('sensitive_data.share'), 'sensitive_data');
    assert.equal(actionOf('risk.case_write'), 'case_write');
    assert.equal(RESOURCE_LABELS.withdrawals, 'Withdrawals');
  });
});

describe('holdsAny', () => {
  test('a single permission or any one of a list grants access', () => {
    const held = new Set<Permission>(['withdrawals.read']);
    assert.equal(holdsAny(held, 'withdrawals.read'), true);
    assert.equal(holdsAny(held, 'flags.read'), false);
    assert.equal(holdsAny(held, ['flags.read', 'withdrawals.read']), true);
    assert.equal(holdsAny(held, ['flags.read', 'users.read']), false);
    assert.equal(holdsAny(held, []), false);
  });
});
