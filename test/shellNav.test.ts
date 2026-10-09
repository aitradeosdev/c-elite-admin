import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAV_GROUPS,
  SIDEBAR_COLLAPSED_COOKIE,
  SIDEBAR_COOKIE_MAX_AGE,
  breadcrumbTrail,
  filterNavByPermissions,
  findBreadcrumb,
  findNavKey,
  findNavMatch,
  hrefMatches,
  isNavPathDenied,
  navLeafAllowed,
  navLeafKeys,
  parseSidebarCollapsed,
  serializeSidebarCollapsed,
  type NavGroup,
  type NavLeaf,
} from '../app/(dashboard)/_shell/nav.ts';
import { ALL_PERMISSIONS, LEGACY_PERMISSION_MAP, isPermission } from '../app/lib/permissions.ts';

const leaves = NAV_GROUPS.flatMap((g) => g.items);
const FLAGGED = '/flagged-transactions';

const VISIBLE_BY_KEY: Readonly<Record<string, readonly string[]>> = {
  dashboard: ['/dashboard'],
  card_queue: ['/card-queue'],
  withdrawals: ['/withdrawals', FLAGGED],
  transactions_overview: ['/transactions-overview'],
  users: ['/users'],
  user_activity_monitor: ['/user-activity-monitor'],
  activity: ['/activity'],
  admin_accounts: ['/admin-accounts'],
  card_management: ['/cards'],
  card_type_builder: ['/field-builder'],
  rates_management: ['/rates'],
  bonuses_rewards: ['/bonuses-rewards', '/bonuses-rewards/levels'],
  coupons: ['/coupons'],
  referral_management: ['/referral-management'],
  notifications_broadcast: ['/notifications-broadcast'],
  notification_templates: ['/notification-templates'],
  email_templates: ['/email-templates'],
  platform_balance: ['/platform-balance'],
  limits_fees: ['/limits-fees'],
  bill_settings: ['/bill-settings'],
  admin_settings: ['/admin-settings'],
  anomaly_alerts: ['/anomaly-alerts'],
  security_limits: ['/security-limits'],
  'flags.read': [FLAGGED],
};

function visibleHrefs(keys: readonly string[]): string[] {
  return filterNavByPermissions(keys, false).flatMap((group) => group.items.map((item) => item.href));
}

function flaggedLeaf(): NavLeaf {
  const leaf = leaves.find((l) => l.href === FLAGGED);
  assert.ok(leaf, 'missing Flagged nav item');
  return leaf;
}

describe('nav table integrity', () => {
  test('every href is unique, absolute and has no trailing slash', () => {
    const hrefs = leaves.map((l) => l.href);
    assert.equal(new Set(hrefs).size, hrefs.length);
    for (const href of hrefs) {
      assert.match(href, /^\/[a-z0-9/-]*[a-z0-9]$/, `bad href: ${href}`);
    }
  });

  test('every leaf has a label, real permission keys and an icon', () => {
    for (const leaf of leaves) {
      assert.ok(leaf.label.trim().length > 0, `empty label on ${leaf.href}`);
      for (const key of navLeafKeys(leaf)) {
        assert.ok(key in LEGACY_PERMISSION_MAP || isPermission(key), `unknown key ${key} on ${leaf.href}`);
      }
      assert.ok(leaf.icon, `missing icon on ${leaf.href}`);
    }
  });

  test('only the Flagged item carries alternative keys', () => {
    const withAlternatives = leaves.filter((l) => (l.altKeys?.length ?? 0) > 0).map((l) => l.href);
    assert.deepEqual(withAlternatives, [FLAGGED]);
  });

  test('legacy page keys stay unique to their pages, so grant labels do not merge', () => {
    const owners = new Map<string, string[]>();
    for (const leaf of leaves) owners.set(leaf.key, [...(owners.get(leaf.key) ?? []), leaf.label]);
    for (const [key, labels] of owners) {
      if (key === 'bonuses_rewards') assert.deepEqual(labels, ['Bonuses', 'Levels']);
      else assert.equal(labels.length, 1, `${key} is the primary key of ${labels.join(', ')}`);
    }
    assert.deepEqual(owners.get('withdrawals'), ['Withdrawals']);
  });

  test('Levels keeps the shared bonuses_rewards permission key', () => {
    const bonuses = leaves.find((l) => l.href === '/bonuses-rewards');
    const levels = leaves.find((l) => l.href === '/bonuses-rewards/levels');
    assert.equal(bonuses?.key, 'bonuses_rewards');
    assert.equal(levels?.key, 'bonuses_rewards');
  });
});

describe('hrefMatches', () => {
  test('matches the exact path and paths below it', () => {
    assert.equal(hrefMatches('/users', '/users'), true);
    assert.equal(hrefMatches('/users/42', '/users'), true);
    assert.equal(hrefMatches('/users/42/devices', '/users'), true);
  });

  test('does not match a sibling that only shares a string prefix', () => {
    assert.equal(hrefMatches('/users-archive', '/users'), false);
    assert.equal(hrefMatches('/bonuses-rewardsx', '/bonuses-rewards'), false);
    assert.equal(hrefMatches('/user', '/users'), false);
  });
});

describe('findNavMatch — longest href wins', () => {
  test('on the Levels page only Levels is active', () => {
    const match = findNavMatch('/bonuses-rewards/levels');
    assert.equal(match?.leaf.label, 'Levels');
    assert.equal(match?.exact, true);
    const active = leaves.filter((l) => l.href === match?.leaf.href);
    assert.equal(active.length, 1);
  });

  test('the parent page still resolves to itself', () => {
    const match = findNavMatch('/bonuses-rewards');
    assert.equal(match?.leaf.label, 'Bonuses');
    assert.equal(match?.exact, true);
  });

  test('a sibling sub-path of the parent falls back to the parent', () => {
    const match = findNavMatch('/bonuses-rewards/campaigns');
    assert.equal(match?.leaf.label, 'Bonuses');
    assert.equal(match?.exact, false);
  });

  test('a path below Levels resolves to Levels', () => {
    assert.equal(findNavMatch('/bonuses-rewards/levels/3')?.leaf.label, 'Levels');
  });

  test('unknown paths match nothing', () => {
    for (const path of ['/', '/login', '/nope', '/userz']) {
      assert.equal(findNavMatch(path), null, path);
    }
  });

  test('the result does not depend on the order of the nav table', () => {
    const reversed: NavGroup[] = [...NAV_GROUPS]
      .reverse()
      .map((g) => ({ ...g, items: [...g.items].reverse() }));
    for (const path of ['/bonuses-rewards/levels', '/bonuses-rewards', '/bonuses-rewards/x', '/users/9']) {
      assert.equal(findNavMatch(path, reversed)?.leaf.href, findNavMatch(path)?.leaf.href, path);
    }
  });

  test('every leaf resolves to itself on its own page', () => {
    for (const leaf of leaves) {
      const match = findNavMatch(leaf.href);
      assert.equal(match?.leaf, leaf, leaf.href);
      assert.equal(match?.exact, true, leaf.href);
    }
  });
});

describe('findBreadcrumb', () => {
  test('names the Levels page, not Bonuses', () => {
    assert.deepEqual(findBreadcrumb('/bonuses-rewards/levels'), {
      group: 'Rewards',
      item: 'Levels',
      href: '/bonuses-rewards/levels',
      detail: null,
    });
  });

  test('a user detail page carries the detail label', () => {
    assert.deepEqual(findBreadcrumb('/users/7f3c'), {
      group: 'People',
      item: 'Users',
      href: '/users',
      detail: 'User details',
    });
  });

  test('the list page itself carries no detail label', () => {
    assert.equal(findBreadcrumb('/users')?.detail, null);
  });

  test('unknown paths have no breadcrumb', () => {
    assert.equal(findBreadcrumb('/nope'), null);
  });
});

describe('breadcrumbTrail', () => {
  test('a top-level page is its group followed by the current page', () => {
    assert.deepEqual(breadcrumbTrail('/withdrawals'), [
      { label: 'Operations' },
      { label: 'Withdrawals', current: true },
    ]);
  });

  test('a detail page links back to its section and marks the detail current', () => {
    assert.deepEqual(breadcrumbTrail('/users/7f3c'), [
      { label: 'People' },
      { label: 'Users', href: '/users' },
      { label: 'User details', current: true },
    ]);
  });

  test('a sub-path without a detail label keeps the section current', () => {
    assert.deepEqual(breadcrumbTrail('/cards/archived'), [
      { label: 'Catalog' },
      { label: 'Cards', current: true },
    ]);
  });

  test('an unknown path falls back to a single current crumb', () => {
    assert.deepEqual(breadcrumbTrail('/nope'), [{ label: 'Admin', current: true }]);
  });

  test('exactly one crumb is current and it is always last', () => {
    const paths = [...leaves.map((l) => l.href), '/users/1', '/nope', '/bonuses-rewards/levels/2'];
    for (const path of paths) {
      const trail = breadcrumbTrail(path);
      assert.equal(trail.filter((c) => c.current).length, 1, path);
      assert.equal(trail[trail.length - 1].current, true, path);
      assert.ok(trail.every((c) => !(c.current && c.href)), `current crumb must not be a link: ${path}`);
    }
  });
});

describe('findNavKey', () => {
  test('Levels resolves to the shared key', () => {
    assert.equal(findNavKey('/bonuses-rewards/levels'), 'bonuses_rewards');
  });

  test('every leaf page resolves to its own key', () => {
    for (const leaf of leaves) {
      assert.equal(findNavKey(leaf.href), leaf.key, leaf.href);
    }
  });

  test('a detail page resolves to its section key', () => {
    assert.equal(findNavKey('/users/abc'), 'users');
  });

  test('unknown paths have no key', () => {
    assert.equal(findNavKey('/nope'), null);
  });
});

describe('filterNavByPermissions', () => {
  test('a super admin sees the whole table', () => {
    assert.equal(filterNavByPermissions([], true), NAV_GROUPS);
  });

  test('the shared key grants both Bonuses and Levels', () => {
    const groups = filterNavByPermissions(['bonuses_rewards'], false);
    assert.deepEqual(groups.map((g) => g.label), ['Rewards']);
    assert.deepEqual(groups[0].items.map((i) => i.label), ['Bonuses', 'Levels']);
  });

  test('groups with no permitted items are dropped', () => {
    const groups = filterNavByPermissions(['users', 'withdrawals'], false);
    assert.deepEqual(groups.map((g) => g.label), ['Operations', 'People']);
    for (const group of groups) assert.ok(group.items.length > 0);
  });

  test('no keys means no groups', () => {
    assert.deepEqual(filterNavByPermissions([], false), []);
  });

  test('each single key shows exactly the pages it showed before, plus Flagged for withdrawals', () => {
    for (const [key, hrefs] of Object.entries(VISIBLE_BY_KEY)) {
      assert.deepEqual(visibleHrefs([key]), hrefs, key);
    }
  });

  test('every legacy page key is covered by the visibility table', () => {
    for (const key of Object.keys(LEGACY_PERMISSION_MAP)) {
      if (key === 'users_freeze') {
        assert.deepEqual(visibleHrefs([key]), [], key);
        continue;
      }
      assert.ok(key in VISIBLE_BY_KEY, `${key} has no expected visibility`);
    }
  });

  test('raw catalog grants other than flags.read show no nav items', () => {
    for (const permission of ALL_PERMISSIONS) {
      if (permission === 'flags.read') continue;
      assert.deepEqual(visibleHrefs([permission]), [], permission);
    }
  });

  test('combining keys shows the union in table order, with no duplicates', () => {
    assert.deepEqual(visibleHrefs(['flags.read', 'withdrawals', 'users']), ['/withdrawals', FLAGGED, '/users']);
  });

  test('unknown and retired keys show nothing', () => {
    for (const key of ['flagged_transactions', 'giftbox', 'nope', '', 'Withdrawals']) {
      assert.deepEqual(visibleHrefs([key]), [], key);
    }
  });
});

describe('Flagged nav item', () => {
  test('sits in Operations right after Withdrawals', () => {
    const operations = NAV_GROUPS.find((g) => g.label === 'Operations');
    const hrefs = operations?.items.map((i) => i.href) ?? [];
    assert.equal(hrefs[hrefs.indexOf('/withdrawals') + 1], FLAGGED);
    assert.equal(flaggedLeaf().label, 'Flagged');
    assert.ok(flaggedLeaf().icon);
  });

  test('opens for the withdrawals page key, the raw flags.read grant or a super admin', () => {
    assert.ok(visibleHrefs(['withdrawals']).includes(FLAGGED));
    assert.ok(visibleHrefs(['flags.read']).includes(FLAGGED));
    assert.ok(filterNavByPermissions([], true).some((g) => g.items.some((i) => i.href === FLAGGED)));
    assert.deepEqual(filterNavByPermissions(['flags.read'], false).map((g) => g.label), ['Operations']);
  });

  test('stays hidden from admins with neither key', () => {
    for (const keys of [['users'], ['transactions_overview', 'card_queue'], ['flags.resolve'], ['withdrawals.read']]) {
      assert.ok(!visibleHrefs(keys).includes(FLAGGED), keys.join(','));
    }
  });

  test('has an Operations breadcrumb and resolves to its own key', () => {
    assert.deepEqual(breadcrumbTrail(FLAGGED), [{ label: 'Operations' }, { label: 'Flagged', current: true }]);
    assert.equal(findNavKey(FLAGGED), 'flags.read');
    assert.equal(findNavMatch(`${FLAGGED}/abc`)?.leaf.href, FLAGGED);
  });
});

describe('navLeafAllowed — any of its keys', () => {
  const single: NavLeaf = { key: 'users', label: 'Users', href: '/users', icon: leaves[0].icon };
  const multi: NavLeaf = { key: 'a.read', altKeys: ['b', 'c'], label: 'Multi', href: '/multi', icon: leaves[0].icon };

  test('a leaf without alternatives needs its own key', () => {
    assert.deepEqual(navLeafKeys(single), ['users']);
    assert.equal(navLeafAllowed(single, ['users']), true);
    assert.equal(navLeafAllowed(single, ['withdrawals']), false);
    assert.equal(navLeafAllowed(single, []), false);
  });

  test('a leaf with alternatives opens for any one of them', () => {
    assert.deepEqual(navLeafKeys(multi), ['a.read', 'b', 'c']);
    for (const key of ['a.read', 'b', 'c']) assert.equal(navLeafAllowed(multi, [key]), true, key);
    assert.equal(navLeafAllowed(multi, ['d']), false);
    assert.equal(navLeafAllowed({ ...multi, altKeys: [] }, ['b']), false);
  });

  test('accepts a Set as well as an array', () => {
    assert.equal(navLeafAllowed(multi, new Set(['c'])), true);
    assert.equal(navLeafAllowed(single, new Set(['b'])), false);
  });
});

describe('isNavPathDenied', () => {
  const singleKeyRule = (pathname: string, keys: readonly string[]) => {
    const key = findNavKey(pathname);
    return pathname !== '/dashboard' && key !== null && !keys.includes(key);
  };

  test('never denies a super admin, the dashboard or an unknown path', () => {
    for (const path of [...leaves.map((l) => l.href), '/users/1', FLAGGED]) {
      assert.equal(isNavPathDenied(path, [], true), false, path);
    }
    assert.equal(isNavPathDenied('/dashboard', [], false), false);
    for (const path of ['/', '/nope', '/login']) assert.equal(isNavPathDenied(path, [], false), false, path);
  });

  test('matches the old single-key rule for every page without alternatives', () => {
    const keySets = [[], ['users'], ['withdrawals'], ['bonuses_rewards', 'coupons'], ['dashboard'], ['flags.read']];
    const paths = [...leaves.filter((l) => !l.altKeys?.length).map((l) => l.href), '/users/9', '/dashboard/x'];
    for (const keys of keySets) {
      for (const path of paths) {
        assert.equal(isNavPathDenied(path, keys, false), singleKeyRule(path, keys), `${path} with ${keys.join(',')}`);
      }
    }
  });

  test('opens the Flagged page for withdrawals or flags.read holders only', () => {
    assert.equal(isNavPathDenied(FLAGGED, ['withdrawals'], false), false);
    assert.equal(isNavPathDenied(FLAGGED, ['flags.read'], false), false);
    assert.equal(isNavPathDenied(`${FLAGGED}/x`, ['withdrawals'], false), false);
    assert.equal(isNavPathDenied(FLAGGED, ['users'], false), true);
    assert.equal(isNavPathDenied(FLAGGED, ['flagged_transactions'], false), true);
    assert.equal(isNavPathDenied(FLAGGED, [], false), true);
  });
});

describe('sidebar collapse cookie', () => {
  test('parses 1 and 0 and treats anything else as no preference', () => {
    assert.equal(parseSidebarCollapsed('1'), true);
    assert.equal(parseSidebarCollapsed('0'), false);
    for (const raw of [undefined, null, '', 'true', 'false', ' 1', 'yes']) {
      assert.equal(parseSidebarCollapsed(raw), undefined, String(raw));
    }
  });

  test('serializes with path, SameSite=Lax and a one-year max-age', () => {
    const parts = serializeSidebarCollapsed(true).split('; ');
    assert.equal(parts[0], `${SIDEBAR_COLLAPSED_COOKIE}=1`);
    assert.ok(parts.includes('Path=/'));
    assert.ok(parts.includes('SameSite=Lax'));
    assert.ok(parts.includes(`Max-Age=${SIDEBAR_COOKIE_MAX_AGE}`));
    assert.equal(SIDEBAR_COOKIE_MAX_AGE, 365 * 24 * 60 * 60);
    assert.ok(!parts.includes('Secure'));
  });

  test('adds Secure only when asked', () => {
    assert.ok(serializeSidebarCollapsed(false, true).split('; ').includes('Secure'));
    assert.ok(!serializeSidebarCollapsed(false, false).split('; ').includes('Secure'));
  });

  test('round-trips through the parser the layout uses', () => {
    for (const collapsed of [true, false]) {
      const value = serializeSidebarCollapsed(collapsed).split('; ')[0].split('=')[1];
      assert.equal(parseSidebarCollapsed(value), collapsed);
    }
  });

  test('uses the cookie name the layout reads', () => {
    assert.equal(SIDEBAR_COLLAPSED_COOKIE, 'admin_sidebar_collapsed');
  });
});
