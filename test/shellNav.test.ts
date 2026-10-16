import { after, before, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement, isValidElement, type Context, type ReactElement, type ReactNode } from 'react';
import ts from 'typescript';
import { loadAppModule, loadUi, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ShellProps } from '../app/(dashboard)/_shell/Shell.tsx';
import type { ShellSecurity } from '../app/(dashboard)/profile/securityModel.ts';
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
  parseSidebarCollapsed,
  serializeSidebarCollapsed,
  type NavGroup,
} from '../app/(dashboard)/_shell/nav.ts';
import { ALL_PERMISSIONS, LEGACY_PERMISSION_MAP, isPermission } from '../app/lib/permissions.ts';

const leaves = NAV_GROUPS.flatMap((g) => g.items);
const RETIRED_FLAGGED = '/flagged-transactions';

const VISIBLE_BY_KEY: Readonly<Record<string, readonly string[]>> = {
  dashboard: ['/dashboard'],
  card_queue: ['/card-queue'],
  withdrawals: ['/withdrawals'],
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
};

function visibleHrefs(keys: readonly string[]): string[] {
  return filterNavByPermissions(keys, false).flatMap((group) => group.items.map((item) => item.href));
}

describe('nav table integrity', () => {
  test('every href is unique, absolute and has no trailing slash', () => {
    const hrefs = leaves.map((l) => l.href);
    assert.equal(new Set(hrefs).size, hrefs.length);
    for (const href of hrefs) {
      assert.match(href, /^\/[a-z0-9/-]*[a-z0-9]$/, `bad href: ${href}`);
    }
  });

  test('every leaf has a label, a real permission key and an icon', () => {
    for (const leaf of leaves) {
      assert.ok(leaf.label.trim().length > 0, `empty label on ${leaf.href}`);
      assert.ok(leaf.key in LEGACY_PERMISSION_MAP || isPermission(leaf.key), `unknown key ${leaf.key} on ${leaf.href}`);
      assert.ok(leaf.icon, `missing icon on ${leaf.href}`);
    }
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

  test('the profile page has its own crumb', () => {
    assert.deepEqual(breadcrumbTrail('/profile'), [{ label: 'Profile', current: true }]);
    assert.deepEqual(breadcrumbTrail('/profilex'), [{ label: 'Admin', current: true }]);
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

  test('each single key shows exactly the pages it showed before', () => {
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

  test('raw catalog grants show no nav items, flags.read included', () => {
    for (const permission of ALL_PERMISSIONS) {
      assert.deepEqual(visibleHrefs([permission]), [], permission);
    }
  });

  test('combining keys shows the union in table order, with no duplicates', () => {
    assert.deepEqual(visibleHrefs(['users', 'withdrawals', 'users']), ['/withdrawals', '/users']);
  });

  test('unknown and retired keys show nothing', () => {
    for (const key of ['flagged_transactions', 'giftbox', 'nope', '', 'Withdrawals']) {
      assert.deepEqual(visibleHrefs([key]), [], key);
    }
  });
});

describe('retired Flagged page', () => {
  test('Operations goes straight from Withdrawals to Transactions, with no Flagged item anywhere', () => {
    const operations = NAV_GROUPS.find((g) => g.label === 'Operations');
    assert.deepEqual(operations?.items.map((i) => i.href), [
      '/dashboard', '/card-queue', '/withdrawals', '/transactions-overview',
    ]);
    assert.ok(!leaves.some((l) => l.href === RETIRED_FLAGGED || l.label === 'Flagged'));
    assert.ok(!filterNavByPermissions([], true).some((g) => g.items.some((i) => i.href === RETIRED_FLAGGED)));
  });

  test('its old path is unknown to the sidebar, so it has no key, breadcrumb or permission gate', () => {
    assert.equal(findNavMatch(RETIRED_FLAGGED), null);
    assert.equal(findNavKey(RETIRED_FLAGGED), null);
    assert.deepEqual(breadcrumbTrail(RETIRED_FLAGGED), [{ label: 'Admin', current: true }]);
    assert.equal(isNavPathDenied(RETIRED_FLAGGED, ['withdrawals'], false), false);
  });
});

describe('isNavPathDenied', () => {
  const singleKeyRule = (pathname: string, keys: readonly string[]) => {
    const key = findNavKey(pathname);
    return pathname !== '/dashboard' && key !== null && !keys.includes(key);
  };

  test('never denies a super admin, the dashboard or an unknown path', () => {
    for (const path of [...leaves.map((l) => l.href), '/users/1']) {
      assert.equal(isNavPathDenied(path, [], true), false, path);
    }
    assert.equal(isNavPathDenied('/dashboard', [], false), false);
    for (const path of ['/', '/nope', '/login', RETIRED_FLAGGED]) {
      assert.equal(isNavPathDenied(path, [], false), false, path);
    }
  });

  test('follows the single-key rule for every page', () => {
    const keySets = [[], ['users'], ['withdrawals'], ['bonuses_rewards', 'coupons'], ['dashboard'], ['flags.read']];
    const paths = [...leaves.map((l) => l.href), '/users/9', '/dashboard/x'];
    for (const keys of keySets) {
      for (const path of paths) {
        assert.equal(isNavPathDenied(path, keys, false), singleKeyRule(path, keys), `${path} with ${keys.join(',')}`);
      }
    }
  });

  test('Withdrawals opens for its own page key, never for flags.read', () => {
    assert.equal(isNavPathDenied('/withdrawals', ['withdrawals'], false), false);
    assert.equal(isNavPathDenied('/withdrawals', ['flags.read'], false), true);
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

type ShellModule = typeof import('../app/(dashboard)/_shell/Shell.tsx');
type ThemeModule = typeof import('../app/_ui/theme.tsx');
type ProfileLinkModule = typeof import('../app/(dashboard)/profile/ProfileLink.tsx');

const nodeRequire = createRequire(import.meta.url);
const { PathnameContext } = nodeRequire('next/dist/shared/lib/hooks-client-context.shared-runtime') as {
  PathnameContext: Context<string | null>;
};

const appSource = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8');

describe('sidebar account: the profile link', () => {
  let shell: ShellModule;
  let theme: ThemeModule;
  let profileLink: ProfileLinkModule;

  before(async () => {
    shell = await loadAppModule<ShellModule>('(dashboard)/_shell/Shell.tsx');
    theme = await loadUi<ThemeModule>('theme.tsx');
    profileLink = await loadAppModule<ProfileLinkModule>('(dashboard)/profile/ProfileLink.tsx');
  });

  function inShell(pathname: string, props: Partial<Omit<ShellProps, 'children'>> = {}, child: ReactNode = 'page body'): string {
    const shellProps: ShellProps = {
      allowedKeys: [],
      isSuperAdmin: false,
      permissions: [],
      username: 'ada',
      roleTitle: 'Card Reviewer',
      ...props,
      children: child,
    };
    return render(createElement(
      PathnameContext.Provider,
      { value: pathname },
      createElement(theme.ThemeProvider, {
        initialMode: 'light',
        initialResolved: 'light',
        children: createElement(shell.Shell, shellProps),
      }),
    ));
  }

  function profileAnchors(html: string) {
    return tagsOf(html, 'a').filter((anchor) => anchor.href === '/profile');
  }

  function profileMarkup(html: string): string {
    const match = /<a\b[^>]*href="\/profile"[^>]*>([\s\S]*?)<\/a>/.exec(html);
    return match ? match[1] : '';
  }

  test('the avatar, name and role are one link to /profile, named for screen readers', () => {
    const html = inShell('/dashboard');
    const anchors = profileAnchors(html);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0]['aria-label'], 'Profile: ada, Card Reviewer');
    assert.equal(anchors[0].title, 'Profile');
    assert.equal(anchors[0]['aria-current'], undefined);
    const inside = profileMarkup(html);
    assert.match(inside, /userAvatar/);
    assert.match(textOf(inside), /^A ada Card Reviewer$/);
    assert.equal(profileLink.PROFILE_HREF, '/profile');
    assert.equal(profileLink.PROFILE_LABEL, 'Profile');
  });

  test('Log out stays a separate button beside the link, unchanged', () => {
    const html = inShell('/dashboard');
    assert.doesNotMatch(profileMarkup(html), /<button|Log out/);
    const logout = tagsOf(html, 'button').filter((button) => button['aria-label'] === 'Log out');
    assert.equal(logout.length, 1);
    assert.equal(logout[0].title, 'Log out');
    const foot = /<div class="sidebarFoot">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    assert.ok(foot.indexOf('href="/profile"') >= 0 && foot.indexOf('href="/profile"') < foot.indexOf('aria-label="Log out"'));
  });

  test('on the profile page the link is marked current, and every admin can open it without a grant', () => {
    const html = inShell('/profile', { allowedKeys: [] }, createElement('output', { id: 'probe' }, 'profile body'));
    const [anchor] = profileAnchors(html);
    assert.equal(anchor['aria-current'], 'page');
    assert.match(anchor.class ?? '', /\bcurrent\b/);
    assert.match(textOf(html), /profile body/);
    assert.doesNotMatch(textOf(html), /You do not have access to this page/);
    assert.equal(isNavPathDenied('/profile', [], false), false);
    assert.equal(isNavPathDenied('/profile', ['withdrawals'], false), false);
    assert.equal(findNavKey('/profile'), null);
  });

  test('the collapsed rail keeps the link, titled Profile, with its own tooltip trigger', () => {
    const html = inShell('/dashboard', { initialCollapsed: true });
    const [anchor] = profileAnchors(html);
    assert.equal(anchor.title, 'Profile');
    assert.equal(anchor['aria-label'], 'Profile: ada, Card Reviewer');
    const source = appSource('(dashboard)/_shell/Shell.tsx');
    assert.match(source, /profileTipTrigger=\{collapsed \? railTip\.trigger\(PROFILE_TIP_ID, PROFILE_LABEL\) : undefined\}/);
    assert.match(source, /showProfileTitle=\{railTip\.activeId !== PROFILE_TIP_ID\}/);
    assert.match(source, /tipTrigger=\{collapsed \? railTip\.trigger\(LOGOUT_TIP_ID, 'Log out'\) : undefined\}/);
  });

  test('the link label copes with a missing role title', () => {
    assert.equal(profileLink.profileLinkLabel('ada', ''), 'Profile: ada');
    assert.equal(profileLink.profileLinkLabel(' ada ', ' Card Reviewer '), 'Profile: ada, Card Reviewer');
    assert.equal(profileLink.profileLinkLabel('', ''), 'Profile');
  });
});

describe('session-expired dialog copy', () => {
  test('says sessions end 8 hours after sign-in, with no idle timeout', () => {
    const text = appSource('_ui/SessionExpired.tsx').replace(/\s+/g, ' ');
    assert.match(text, /admin sessions end 8 hours after you sign in\./);
    assert.match(text, /change your password on another device/);
    assert.match(text, /Sign in again and you will come back to this page\./);
    assert.doesNotMatch(text, /inactivity|idle/i);
  });

  test('names every way a session now ends early, including per-device sign-out and a two-step reset', () => {
    const text = appSource('_ui/SessionExpired.tsx').replace(/\s+/g, ' ');
    assert.ok(text.includes(
      'For security, admin sessions end 8 hours after you sign in. A session also ends early if it is signed out '
      + 'from Signed-in devices, if you sign out everywhere or change your password on another device, or if a '
      + 'super administrator changes your access, resets your two-step sign-in or signs you out. Sign in again '
      + 'and you will come back to this page.',
    ));
    assert.doesNotMatch(text, /if you sign out or change your password/);
  });

  test('a 401 from any sign-in route, including the password step itself, never opens the dialog', () => {
    const text = appSource('_ui/SessionExpired.tsx');
    assert.match(text, /return url\.pathname !== '\/api\/auth' && !url\.pathname\.startsWith\('\/api\/auth\/'\);/);
  });
});

type BannerModule = typeof import('../app/(dashboard)/_shell/SecurityBanner.tsx');
type SecurityModelModule = typeof import('../app/(dashboard)/profile/securityModel.ts');
type SignOutModule = typeof import('../app/(dashboard)/profile/signOut.ts');

const DAY_MS = 24 * 60 * 60 * 1000;
const BANNER_NOW = new Date('2026-10-12T09:05:00.000Z');

function inShellWith(
  shell: ShellModule,
  theme: ThemeModule,
  pathname: string,
  security: ShellSecurity | undefined,
  overrides: Partial<Omit<ShellProps, 'children' | 'security'>> = {},
): string {
  const props: ShellProps = {
    allowedKeys: [],
    isSuperAdmin: true,
    permissions: [],
    username: 'ada',
    roleTitle: 'Operations Lead',
    ...overrides,
    security,
    children: createElement('h1', null, 'Page title'),
  };
  return render(createElement(
    PathnameContext.Provider,
    { value: pathname },
    createElement(theme.ThemeProvider, {
      initialMode: 'light',
      initialResolved: 'light',
      children: createElement(shell.Shell, props),
    }),
  ));
}

function mainOf(html: string): string {
  const start = html.indexOf('id="main-content"');
  assert.ok(start >= 0, 'main landmark');
  const open = html.indexOf('>', start) + 1;
  return html.slice(open, html.indexOf('</main>', open));
}

describe('logging out of this device and signing out everywhere', () => {
  let shell: ShellModule;
  let signOut: SignOutModule;

  before(async () => {
    shell = await loadAppModule<ShellModule>('(dashboard)/_shell/Shell.tsx');
    signOut = await loadAppModule<SignOutModule>('(dashboard)/profile/signOut.ts');
  });

  test('the Log out confirm says only this device is logged out, and where to sign out everywhere', () => {
    assert.deepEqual({ ...shell.LOGOUT_CONFIRM }, {
      title: 'Log out of this device?',
      message:
        'Your other devices and the CardElite Admin app stay signed in. To sign out everywhere, use Signed-in devices on your Profile.',
      confirmLabel: 'Log out',
    });
    const source = appSource('(dashboard)/_shell/Shell.tsx');
    assert.match(source, /await confirm\(\{ \.\.\.LOGOUT_CONFIRM, returnFocusTo \}\);/);
    assert.match(source, /fetch\('\/api\/auth\/logout', \{ method: 'POST' \}\)/);
    assert.doesNotMatch(source, /on every device, not just this one/);
  });

  test('the shared logout tail forgets the palette recents for the viewer and replaces the page with /login', () => {
    const removed: string[] = [];
    const replaced: string[] = [];
    const host = globalThis as { window?: unknown };
    const previous = host.window;
    host.window = {
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: (key: string) => removed.push(key) },
      location: { replace: (url: string) => replaced.push(url) },
    };
    try {
      signOut.leaveConsole('ada');
      signOut.leaveConsole('');
    } finally {
      host.window = previous;
    }
    assert.deepEqual(removed, ['cardelite.admin.palette.recent:ada']);
    assert.deepEqual(replaced, ['/login', '/login']);
    const source = appSource('(dashboard)/_shell/Shell.tsx');
    assert.match(source, /leaveConsole\(username\);/);
    assert.doesNotMatch(source, /forgetRecents|window\.location\.replace/);
  });

  test('the palette offers Log out for this device and Sign out everywhere, each calling its own handler', () => {
    const calls: string[] = [];
    const commands = shell.accountCommands(() => calls.push('logout'), () => calls.push('everywhere'));
    assert.deepEqual(commands.map(({ id, label, subtitle, keywords }) => ({ id, label, subtitle, keywords })), [
      { id: 'log-out', label: 'Log out', subtitle: 'This device', keywords: ['sign out', 'logout', 'this device'] },
      {
        id: 'sign-out-everywhere',
        label: 'Sign out everywhere',
        subtitle: 'Every device, including the mobile app',
        keywords: ['all devices', 'every device', 'log out everywhere', 'sessions'],
      },
    ]);
    assert.deepEqual(commands.map((command) => (command.icon as unknown as { displayName?: string }).displayName), [
      'LogOut', 'MonitorSmartphone',
    ]);
    for (const command of commands) {
      assert.equal(command.href, undefined);
      command.onSelect?.();
    }
    assert.deepEqual(calls, ['logout', 'everywhere']);
    assert.ok(!commands.some((command) => command.label === 'Sign out'), 'Sign out alone no longer means this device');
  });

  test('the shell wires both actions, shares the Profile confirm and returns focus to the search button', () => {
    const source = appSource('(dashboard)/_shell/Shell.tsx');
    assert.match(source, /const signOutEverywhere = useSignOutEverywhere\(username\);/);
    assert.match(source, /\.\.\.accountCommands\(\s*\(\) => \{\s*void logout\(returnToSearch\);\s*\},\s*\(\) => \{\s*void signOutEverywhere\(returnToSearch\);\s*\},\s*\)/);
    assert.match(source, /onLogout=\{logoutHere\}/);
    const signOutSource = appSource('(dashboard)/profile/signOut.ts');
    assert.match(signOutSource, /\.\.\.signOutEverywhereConfirm\(\),\s*returnFocusTo,\s*action: \(\) => signOutEverywhere\(\),/);
    assert.match(signOutSource, /if \(!decision\) return false;\s*leaveConsole\(username\);/);
  });
});

describe('two-step sign-in banner', () => {
  let shell: ShellModule;
  let theme: ThemeModule;
  let banner: BannerModule;
  let model: SecurityModelModule;

  before(async () => {
    shell = await loadAppModule<ShellModule>('(dashboard)/_shell/Shell.tsx');
    theme = await loadUi<ThemeModule>('theme.tsx');
    banner = await loadAppModule<BannerModule>('(dashboard)/_shell/SecurityBanner.tsx');
    model = await loadAppModule<SecurityModelModule>('(dashboard)/profile/securityModel.ts');
  });

  const due = (days: number, now: Date = new Date()): ShellSecurity => ({
    prompt: 'due',
    graceEndsAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
  });

  test('the layout prompt is none with two-step on or no requirement, due during the grace and overdue after it', () => {
    const grace = '2026-10-26T09:05:00.000Z';
    const off = { mode: 'off', graceEndsAt: null, requiredNow: false };
    const during = { mode: 'all', graceEndsAt: grace, requiredNow: false };
    const enforced = { mode: 'all', graceEndsAt: grace, requiredNow: true };
    for (const status of ['none', 'pending', 'active']) {
      assert.deepEqual(model.shellSecurity({ status }, off), { prompt: 'none', graceEndsAt: null }, status);
    }
    assert.deepEqual(model.shellSecurity({ status: 'active' }, during), { prompt: 'none', graceEndsAt: null });
    assert.deepEqual(model.shellSecurity({ status: 'active' }, enforced), { prompt: 'none', graceEndsAt: null });
    for (const status of ['none', 'pending']) {
      assert.deepEqual(model.shellSecurity({ status }, during), { prompt: 'due', graceEndsAt: grace }, status);
      assert.deepEqual(model.shellSecurity({ status }, enforced), { prompt: 'overdue', graceEndsAt: grace }, status);
    }
    assert.deepEqual(model.NO_SECURITY_PROMPT, { prompt: 'none', graceEndsAt: null });
  });

  test('the due banner names the date and the days left; overdue says it is required now', () => {
    assert.deepEqual(model.securityBannerView(due(14, BANNER_NOW), BANNER_NOW), {
      tone: 'warning',
      title: 'Set up two-step sign-in by 26 Oct 2026',
      text: 'It will be required for every admin. After that date you will be asked to set it up when you sign in. 14 days left.',
    });
    assert.match(model.securityBannerView(due(1, BANNER_NOW), BANNER_NOW)?.text ?? '', / 1 day left\.$/);
    const today = { prompt: 'due' as const, graceEndsAt: '2026-10-12T20:00:00.000Z' };
    assert.match(model.securityBannerView(today, BANNER_NOW)?.text ?? '', / Due today\.$/);
    const overdue = {
      tone: 'danger',
      title: 'Two-step sign-in is now required',
      text: 'Set it up now, or you will have to before you can use the console the next time you sign in.',
    };
    assert.deepEqual(model.securityBannerView({ prompt: 'overdue', graceEndsAt: '2026-10-01T09:05:00.000Z' }, BANNER_NOW), overdue);
    assert.deepEqual(model.securityBannerView({ prompt: 'due', graceEndsAt: '2026-10-12T09:00:00.000Z' }, BANNER_NOW), overdue);
    assert.equal(model.securityBannerView({ prompt: 'none', graceEndsAt: null }, BANNER_NOW), null);
    assert.equal(model.securityBannerView(undefined, BANNER_NOW), null);
    const undated = model.securityBannerView({ prompt: 'due', graceEndsAt: null }, BANNER_NOW);
    assert.equal(undated?.tone, 'warning');
    assert.equal(undated?.title, 'Set up two-step sign-in');
  });

  test('the banner is a static notice with a Set it up link to the Profile two-step card', () => {
    const html = render(createElement(banner.SecurityBanner, { security: due(14, BANNER_NOW), now: BANNER_NOW }));
    const links = tagsOf(html, 'a');
    assert.equal(links.length, 1);
    assert.equal(links[0].href, '/profile#two-step-sign-in');
    assert.equal(model.TWO_STEP_HREF, '/profile#two-step-sign-in');
    assert.match(textOf(html), /^Set up two-step sign-in by 26 Oct 2026 It will be required .* 14 days left\. Set it up$/);
    assert.doesNotMatch(html, /role="(alert|status)"/);
    assert.doesNotMatch(html, /Dismiss/);
    assert.equal(render(createElement(banner.SecurityBanner, { security: { prompt: 'none', graceEndsAt: null } })), '');
  });

  test('it is the first thing inside the main landmark, before the page, so Skip to main content lands on it', () => {
    const html = inShellWith(shell, theme, '/dashboard', due(10));
    const main = mainOf(html);
    assert.match(main, /^<div class="notice banner warning"/);
    assert.ok(main.indexOf('Set up two-step sign-in by') < main.indexOf('<h1>Page title</h1>'));
    assert.match(textOf(main), /10 days left\./);
    assert.ok(tagsOf(main, 'a').some((link) => link.href === '/profile#two-step-sign-in'));
  });

  test('after the grace it turns into the danger notice', () => {
    const main = mainOf(inShellWith(shell, theme, '/withdrawals', { prompt: 'overdue', graceEndsAt: '2026-10-01T09:05:00.000Z' }));
    assert.match(main, /^<div class="notice banner danger"/);
    assert.match(textOf(main), /^Two-step sign-in is now required Set it up now, or you will have to before you can use the console the next time you sign in\. Set it up/);
  });

  test('it is hidden on the Profile, with no prompt, and when the layout sends nothing', () => {
    for (const path of ['/profile', '/profile/devices']) {
      assert.doesNotMatch(mainOf(inShellWith(shell, theme, path, due(5))), /notice banner/, path);
    }
    assert.match(mainOf(inShellWith(shell, theme, '/profilex', due(5))), /^<div class="notice banner warning"/);
    assert.doesNotMatch(mainOf(inShellWith(shell, theme, '/dashboard', { prompt: 'none', graceEndsAt: null })), /notice banner/);
    const bare = mainOf(inShellWith(shell, theme, '/dashboard', undefined));
    assert.match(bare, /^<h1>Page title<\/h1>$/);
  });

  test('the banner appears above an access-denied page too, and the shell wires it from the security prop only', () => {
    const main = mainOf(inShellWith(shell, theme, '/users', due(3), { isSuperAdmin: false, allowedKeys: ['withdrawals'] }));
    assert.match(main, /^<div class="notice banner warning"/);
    assert.ok(main.indexOf('Set up two-step sign-in by') < main.indexOf('You do not have access to this page'));
    assert.doesNotMatch(main, /Page title/);
    const source = appSource('(dashboard)/_shell/Shell.tsx');
    assert.match(source, /security = NO_SECURITY_PROMPT/);
    assert.match(source, /\{onProfile \? null : <SecurityBanner security=\{security\} \/>\}\s*\{permissionDenied \? <AccessDenied \/> : children\}/);
    assert.doesNotMatch(appSource('(dashboard)/_shell/SecurityBanner.tsx'), /apiRequest|fetch\(|useResource/);
  });
});

const LAYOUT_STATE_KEY = '__cardeliteDashboardLayoutTest';
const APP_ROOT = fileURLToPath(new URL('../app/', import.meta.url));
const LAYOUT_FILE = resolve(APP_ROOT, '(dashboard)', 'layout.tsx');
const LAYOUT_IMPORT = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;

interface LayoutState {
  jar: Record<string, string>;
  check: unknown;
  calls: Array<[string, string]>;
  redirects: string[];
}

interface LayoutShell {
  type: unknown;
  props: ShellProps;
}

type LayoutModule = { default: (props: { children: ReactNode }) => Promise<ReactElement> };

function moduleUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function layoutStub(lines: string[]): string {
  return moduleUrl([`const state = () => globalThis.${LAYOUT_STATE_KEY};`, ...lines].join('\n'));
}

const LAYOUT_PACKAGES: Readonly<Record<string, string>> = {
  react: pathToFileURL(nodeRequire.resolve('react')).href,
  'react/jsx-runtime': pathToFileURL(nodeRequire.resolve('react/jsx-runtime')).href,
  'lucide-react': pathToFileURL(nodeRequire.resolve('lucide-react')).href,
  'next/headers': layoutStub([
    'export async function cookies() {',
    '  const jar = state().jar;',
    '  return { get: (name) => (Object.prototype.hasOwnProperty.call(jar, name) ? { name, value: jar[name] } : undefined) };',
    '}',
  ]),
  'next/navigation': layoutStub([
    'export function redirect(url) {',
    '  state().redirects.push(url);',
    "  throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' + url });",
    '}',
  ]),
};

const LAYOUT_LIBS: Readonly<Record<string, string>> = {
  [resolve(APP_ROOT, 'lib', 'jwt.ts')]: layoutStub([
    'export async function verifyAdminSession(token, transport) {',
    '  state().calls.push([token, transport]);',
    '  return state().check;',
    '}',
  ]),
  [resolve(APP_ROOT, 'lib', 'session.ts')]: layoutStub([
    "export const SESSION_COOKIE = 'admin_token';",
    'export class SessionUnavailableError extends Error {',
    "  constructor() { super('The admin session could not be checked.'); this.name = 'SessionUnavailableError'; }",
    '}',
  ]),
  [resolve(APP_ROOT, '(dashboard)', '_shell', 'Shell.tsx')]: layoutStub(['export function Shell() { return null; }']),
};

const layoutBundles = new Map<string, Promise<string>>();

function layoutResolve(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = /\.tsx?$/.test(base) ? [base] : [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`${fromFile} imports ${specifier}, which does not resolve`);
  return found;
}

async function layoutTranspile(file: string): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
    },
  });
  const targets = new Map<string, string>();
  for (const [, , specifier] of outputText.matchAll(LAYOUT_IMPORT)) {
    if (targets.has(specifier)) continue;
    if (specifier.startsWith('.')) {
      const path = layoutResolve(file, specifier);
      targets.set(specifier, LAYOUT_LIBS[path] ?? (await layoutBundle(path)));
    } else if (LAYOUT_PACKAGES[specifier]) {
      targets.set(specifier, LAYOUT_PACKAGES[specifier]);
    } else {
      throw new Error(`${file} imports ${specifier}, which this test does not provide`);
    }
  }
  return moduleUrl(outputText.replace(LAYOUT_IMPORT, (match: string, head: string, specifier: string) => {
    const target = targets.get(specifier);
    return target ? `${head}'${target}'` : match;
  }));
}

function layoutBundle(file: string): Promise<string> {
  let pending = layoutBundles.get(file);
  if (!pending) {
    pending = layoutTranspile(file);
    layoutBundles.set(file, pending);
  }
  return pending;
}

describe('the dashboard layout', () => {
  const ADMIN = {
    admin_id: '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f',
    role_title: 'Card Reviewer',
    is_super_admin: false,
    page_permissions: ['withdrawals', 'users'],
    username: 'ada',
    token_version: 3,
    sid: 'c4e2a9d1-3b5f-4e7a-8c6d-2f1e0a9b8c7d',
  };
  const GRACE = '2026-10-26T09:05:00.000Z';
  const host = globalThis as unknown as Record<string, unknown>;
  let layout: LayoutModule;
  let state: LayoutState;

  function ok(mfaStatus: string, policy: { mode: string; graceEndsAt: string | null; requiredNow: boolean }) {
    return {
      status: 'ok',
      claims: ADMIN,
      session: null,
      mfa: { status: mfaStatus, lockedUntil: null },
      policy,
    };
  }

  function prepare(jar: Record<string, string>, check: unknown): LayoutState {
    state = { jar, check, calls: [], redirects: [] };
    host[LAYOUT_STATE_KEY] = state;
    return state;
  }

  async function run(): Promise<LayoutShell> {
    return (await layout.default({ children: 'page body' })) as unknown as LayoutShell;
  }

  before(async () => {
    layout = (await import(await layoutBundle(LAYOUT_FILE))) as LayoutModule;
  });

  after(() => {
    Reflect.deleteProperty(host, LAYOUT_STATE_KEY);
  });

  test('no session cookie goes to /login without checking anything', async () => {
    prepare({}, ok('none', { mode: 'off', graceEndsAt: null, requiredNow: false }));
    await assert.rejects(run(), /NEXT_REDIRECT/);
    assert.deepEqual(state.redirects, ['/login']);
    assert.deepEqual(state.calls, []);
  });

  test('the cookie is checked as a web session, and an invalid one goes to /login', async () => {
    prepare({ admin_token: 'cookie-token' }, { status: 'invalid' });
    await assert.rejects(run(), /NEXT_REDIRECT/);
    assert.deepEqual(state.calls, [['cookie-token', 'cookie']]);
    assert.deepEqual(state.redirects, ['/login']);
  });

  test('a session that cannot be checked throws to the error boundary and never signs anyone out', async () => {
    prepare({ admin_token: 'cookie-token' }, { status: 'unavailable' });
    await assert.rejects(run(), (error: unknown) => error instanceof Error && error.name === 'SessionUnavailableError');
    assert.deepEqual(state.redirects, []);
  });

  test('a live session renders the shell with the checked identity, permissions and no prompt', async () => {
    prepare({ admin_token: 'cookie-token', admin_sidebar_collapsed: '1' }, ok('none', { mode: 'off', graceEndsAt: null, requiredNow: false }));
    const element = await run();
    assert.equal(typeof element.type, 'function');
    const props = element.props;
    assert.deepEqual(props.allowedKeys, ['withdrawals', 'users']);
    assert.equal(props.isSuperAdmin, false);
    assert.equal(props.username, 'ada');
    assert.equal(props.roleTitle, 'Card Reviewer');
    assert.equal(props.initialCollapsed, true);
    assert.deepEqual(props.permissions, [...props.permissions].sort());
    assert.ok(props.permissions.includes('withdrawals.read'));
    assert.deepEqual(props.security, { prompt: 'none', graceEndsAt: null });
    assert.equal(props.children, 'page body');
    assert.deepEqual(state.redirects, []);
  });

  test('the prompt comes from the same check: due during the grace, overdue after it, none once two-step is on', async () => {
    prepare({ admin_token: 't' }, ok('none', { mode: 'all', graceEndsAt: GRACE, requiredNow: false }));
    assert.deepEqual((await run()).props.security, { prompt: 'due', graceEndsAt: GRACE });
    prepare({ admin_token: 't' }, ok('pending', { mode: 'all', graceEndsAt: GRACE, requiredNow: true }));
    assert.deepEqual((await run()).props.security, { prompt: 'overdue', graceEndsAt: GRACE });
    prepare({ admin_token: 't' }, ok('active', { mode: 'all', graceEndsAt: GRACE, requiredNow: true }));
    assert.deepEqual((await run()).props.security, { prompt: 'none', graceEndsAt: null });
    assert.equal(state.calls.length, 1);
  });

  test('the source uses the session check, not the old null-returning verifier', () => {
    const source = appSource('(dashboard)/layout.tsx');
    assert.match(source, /const check = await verifyAdminSession\(token, 'cookie'\);/);
    assert.match(source, /if \(check\.status === 'unavailable'\) throw new SessionUnavailableError\(\);/);
    assert.match(source, /if \(check\.status === 'invalid'\) redirect\('\/login'\);/);
    assert.match(source, /security=\{shellSecurity\(check\.mfa, check\.policy\)\}/);
    assert.doesNotMatch(source, /verifyAdminJWT/);
  });
});

type RootErrorModule = typeof import('../app/error.tsx');
type RootErrorProps = Parameters<RootErrorModule['default']>[0];
type ShownErrorPage = ReactElement<RootErrorProps & { reset: () => void }>;

interface NextErrorBoundary {
  state: { error: Error | null; previousPathname: string | null };
  context: { refresh: () => void } | null;
  setState: (next: { error: null }) => void;
  render: () => ReactElement<{ children: ReactNode }>;
}

const { ErrorBoundaryHandler } = nodeRequire('next/dist/client/components/error-boundary') as {
  ErrorBoundaryHandler: new (props: {
    pathname: string | null;
    errorComponent: RootErrorModule['default'];
    children: ReactNode;
  }) => NextErrorBoundary;
};

const SESSION_CHECK_FAILED = 'The admin session could not be checked.';

describe('the root error boundary', () => {
  let rootError: RootErrorModule;

  before(async () => {
    rootError = await loadAppModule<RootErrorModule>('error.tsx');
  });

  function errorPage(nodeEnv: string, digest?: string): string {
    const error: RootErrorProps['error'] = new Error(SESSION_CHECK_FAILED);
    if (digest) error.digest = digest;
    const previous = process.env.NODE_ENV;
    Reflect.set(process.env, 'NODE_ENV', nodeEnv);
    try {
      return render(createElement(rootError.default, { error, unstable_retry: () => {} }));
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
      else Reflect.set(process.env, 'NODE_ENV', previous);
    }
  }

  test('an unavailable session check on page load shows the kit error page: Try again, the request ID and no link back to the dashboard', () => {
    const html = errorPage('production', '2786634153');
    assert.match(html, /^<main><div class="wrap" role="alert"><div class="icon iconDanger">/);
    assert.match(html, /<h1 class="title">Something went wrong<\/h1>/);
    assert.equal(
      textOf(html),
      "Something went wrong We couldn't load this page. Try again in a moment. Request ID 2786634153 Try again",
    );
    const [retry, ...others] = tagsOf(html, 'button');
    assert.deepEqual(others, []);
    assert.equal(retry.type, 'button');
    assert.equal(retry.disabled, undefined);
    assert.equal(retry['aria-busy'], undefined);
    assert.deepEqual(tagsOf(html, 'a'), []);
    assert.doesNotMatch(textOf(errorPage('production')), /Request ID/);
  });

  test('the error message itself shows only in development', () => {
    assert.doesNotMatch(errorPage('production', 'd1'), /<pre|could not be checked/);
    assert.match(errorPage('development', 'd1'), /<pre class="detail">The admin session could not be checked\.<\/pre>/);
  });

  test('Try again re-runs the server render through the retry Next hands error pages, and the kit shows it busy meanwhile', () => {
    const steps: unknown[] = [];
    const handler = new ErrorBoundaryHandler({ pathname: '/dashboard', errorComponent: rootError.default, children: 'page body' });
    handler.context = { refresh: () => steps.push('refresh') };
    handler.setState = (next) => steps.push(next);
    const error = new Error(SESSION_CHECK_FAILED);
    handler.state = { error, previousPathname: '/dashboard' };
    const shown = ([] as ReactNode[]).concat(handler.render().props.children)
      .find((child): child is ShownErrorPage => isValidElement(child) && child.type === rootError.default);
    assert.ok(shown, 'Next renders the root error page with its retry props');
    assert.equal(shown.props.error, error);
    shown.props.unstable_retry();
    assert.deepEqual(steps, ['refresh', { error: null }]);
    steps.length = 0;
    shown.props.reset();
    assert.deepEqual(steps, [{ error: null }], 'reset alone clears the boundary without asking the server again');
    const source = appSource('error.tsx');
    assert.match(source, /const \[pending, startTransition\] = useTransition\(\);/);
    assert.match(source, /onRetry=\{\(\) => startTransition\(unstable_retry\)\}\s*retrying=\{pending\}/);
    assert.doesNotMatch(source, /\breset\b|router|backHref/);
  });

  test('it is built on the kit ErrorState, logs like its siblings and uses no literal colours', () => {
    const source = appSource('error.tsx');
    assert.match(source, /^import \{ ErrorState \} from '\.\/_ui\/States';$/m);
    assert.match(source, /useEffect\(\(\) => \{\s*console\.error\('root segment error:', error\);\s*\}, \[error\]\);/);
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  });
});

describe('house rules for the shell files', () => {
  const files = [
    '(dashboard)/_shell/Shell.tsx',
    '(dashboard)/_shell/SecurityBanner.tsx',
    '(dashboard)/_shell/NavCounts.tsx',
    '(dashboard)/_shell/nav.ts',
    '(dashboard)/_shell/Shell.module.css',
    '(dashboard)/_shell/NavCounts.module.css',
    '(dashboard)/layout.tsx',
    '_ui/SessionExpired.tsx',
    'error.tsx',
  ];

  test('no comments, no static inline styles and no raw stacking numbers', () => {
    for (const file of files) {
      const text = appSource(file);
      assert.doesNotMatch(text, /\/\*|(^|[^:])\/\/(?!\/)/m, file);
      const inline = [...text.matchAll(/style=\{\{([^}]*)\}\}/g)].map((match) => match[1].trim());
      assert.deepEqual(inline, file.endsWith('Shell.tsx') ? ['top: railTip.tip.top, left: railTip.tip.left'] : [], file);
      for (const [, value] of text.matchAll(/z-index:\s*([^;]+);/g)) assert.match(value.trim(), /^var\(--z-[a-z]+\)$/, file);
    }
    assert.doesNotMatch(readFileSync(fileURLToPath(import.meta.url), 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m);
  });

  test('the banner, the counts island and the root error boundary are client components that never import server code', () => {
    for (const file of ['(dashboard)/_shell/SecurityBanner.tsx', '(dashboard)/_shell/NavCounts.tsx', 'error.tsx']) {
      const source = appSource(file);
      assert.ok(source.startsWith("'use client';"), file);
      assert.doesNotMatch(source, /next\/headers|lib\/(jwt|session|supabase|mfa|qr)|qrcode-generator/, file);
    }
  });
});
