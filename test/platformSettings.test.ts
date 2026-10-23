import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type Context } from 'react';
import { classesOf, loadAppModule, loadUi, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ShellProps } from '../app/(dashboard)/_shell/Shell.tsx';
import { PLATFORM_SETTINGS, filterNavByPermissions, navSections } from '../app/(dashboard)/_shell/nav.ts';
import {
  ALL_PERMISSIONS, LEGACY_PERMISSION_MAP, PAGE_READ_PERMISSION, resolvePermissions,
} from '../app/lib/permissions.ts';

type ShellModule = typeof import('../app/(dashboard)/_shell/Shell.tsx');
type ThemeModule = typeof import('../app/_ui/theme.tsx');
type LayoutModule = typeof import('../app/(dashboard)/admin-settings/layout.tsx');
type Access = Pick<ShellProps, 'allowedKeys' | 'isSuperAdmin' | 'permissions'>;

const nodeRequire = createRequire(import.meta.url);
const { PathnameContext } = nodeRequire('next/dist/shared/lib/hooks-client-context.shared-runtime') as {
  PathnameContext: Context<string | null>;
};

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const DASHBOARD_DIR = join(APP_DIR, '(dashboard)');
const SETTINGS_DIR = join(DASHBOARD_DIR, 'admin-settings');
const BALANCE_DIR = join(DASHBOARD_DIR, 'platform-balance');
const SECTION_SLUGS = ['platform-balance', 'limits-fees', 'bill-settings', 'anomaly-alerts', 'security-limits'] as const;
const CONFIG_FORM_SLUGS = ['limits-fees', 'bill-settings', 'anomaly-alerts', 'security-limits'] as const;
const OLD_PATH_LITERAL = /['"`]\/(?:platform-balance|limits-fees|bill-settings|anomaly-alerts|security-limits)\b/;
const SECTION_TABS: ReadonlyArray<readonly [string, string]> = [
  ['/admin-settings', 'General'],
  ['/admin-settings/platform-balance', 'Balance'],
  ['/admin-settings/limits-fees', 'Limits & Fees'],
  ['/admin-settings/bill-settings', 'Bill Settings'],
  ['/admin-settings/anomaly-alerts', 'Anomaly & Alerts'],
  ['/admin-settings/security-limits', 'Rate Limits & IPs'],
];
const NO_COMMENTS = /\/\*|(^|[^:])\/\/(?!\/)/m;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

describe('the five pages live under Platform Settings', () => {
  test('the old page files are gone, while the sections, the Balance modules and the six API routes stay', () => {
    for (const slug of CONFIG_FORM_SLUGS) assert.equal(existsSync(join(DASHBOARD_DIR, slug)), false, slug);
    assert.equal(existsSync(join(BALANCE_DIR, 'page.tsx')), false);
    for (const slug of SECTION_SLUGS) assert.ok(existsSync(join(SETTINGS_DIR, slug, 'page.tsx')), slug);
    for (const name of ['model.ts', 'BalanceParts.tsx', 'BalanceSection.tsx', 'page.module.css']) {
      assert.ok(existsSync(join(BALANCE_DIR, name)), name);
    }
    for (const slug of ['admin-settings', ...SECTION_SLUGS]) assert.ok(existsSync(join(APP_DIR, 'api', slug, 'route.ts')), slug);
  });

  test('each old address redirects with a 307 to its section, and the security headers are unchanged', async () => {
    const config = (await import('../next.config.ts')).default;
    assert.ok(config.redirects && config.headers);
    assert.deepEqual(await config.redirects(), SECTION_SLUGS.map((slug) => ({
      source: `/${slug}`,
      destination: `/admin-settings/${slug}`,
      permanent: false,
    })));
    assert.deepEqual(await config.headers(), [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
      ],
    }]);
  });

  test('nothing in the app links to an old address, and the dashboard links Wallet liability to the Balance section', () => {
    const files = sourceFiles(APP_DIR);
    assert.ok(files.length > 100, String(files.length));
    assert.deepEqual(files.filter((file) => OLD_PATH_LITERAL.test(readFileSync(file, 'utf8'))), []);
    const metrics = readFileSync(join(DASHBOARD_DIR, 'dashboard', 'metrics.tsx'), 'utf8');
    assert.match(metrics, /label: 'Wallet liability', hint: 'Sum of all user wallets', href: '\/admin-settings\/platform-balance',/);
  });
});

describe('the Platform Settings layout inside the shell', () => {
  let shell: ShellModule;
  let theme: ThemeModule;
  let layout: LayoutModule;

  before(async () => {
    shell = await loadAppModule<ShellModule>('(dashboard)/_shell/Shell.tsx');
    theme = await loadUi<ThemeModule>('theme.tsx');
    layout = await loadAppModule<LayoutModule>('(dashboard)/admin-settings/layout.tsx');
  });

  function inSettings(pathname: string, access: Access): string {
    const props: ShellProps = {
      ...access,
      username: 'ada',
      roleTitle: 'Operations Lead',
      children: createElement(layout.default, { children: createElement('p', { id: 'section-probe' }, 'section body') }),
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

  function sectionNav(html: string): { tag: string; links: string[] } {
    const match = /(<nav\b[^>]*aria-label="Platform Settings sections"[^>]*>)([\s\S]*?)<\/nav>/.exec(html);
    assert.ok(match, 'section nav');
    return { tag: match[1], links: [...match[2].matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((link) => link[0]) };
  }

  const superAdmin: Access = { isSuperAdmin: true, allowedKeys: [], permissions: [...ALL_PERMISSIONS].sort() };

  const stored = (keys: readonly string[]): Access => ({
    isSuperAdmin: false,
    allowedKeys: [...keys],
    permissions: Array.from(resolvePermissions(keys, false)).sort(),
  });

  test('a super admin on a section sees one Platform Settings heading, every section tab, and the section below them', () => {
    const html = inSettings('/admin-settings/limits-fees', superAdmin);
    assert.equal(tagsOf(html, 'h1').length, 1);
    const main = mainOf(html);
    assert.match(main, /^<div class="frame"><div class="pageHeader"><div class="pageHeaderTitles"><h1 class="pageTitle">Platform Settings<\/h1><\/div><\/div><nav /);
    const nav = sectionNav(main);
    assert.deepEqual(classesOf(tagsOf(nav.tag, 'nav')[0]), ['underline', 'sections']);
    assert.deepEqual(nav.links.map((link) => tagsOf(link, 'a')[0].href), SECTION_TABS.map(([href]) => href));
    assert.deepEqual(nav.links.map((link) => textOf(link)), SECTION_TABS.map(([, label]) => label));
    assert.deepEqual(nav.links.map((link) => tagsOf(link, 'a')[0]['aria-current']), [
      undefined, undefined, 'page', undefined, undefined, undefined,
    ]);
    assert.ok(main.indexOf('<p id="section-probe">section body</p>') > main.indexOf('</nav>'));
    const crumbs = /<nav aria-label="Breadcrumb"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
    assert.ok(crumbs, 'breadcrumb');
    assert.equal(textOf(crumbs[1]), 'Configuration / Platform Settings / Limits & Fees');
    assert.equal(tagsOf(crumbs[1], 'a').length, 0);
  });

  test('on General the first tab is current', () => {
    const nav = sectionNav(mainOf(inSettings('/admin-settings', superAdmin)));
    assert.deepEqual(nav.links.map((link) => tagsOf(link, 'a')[0]['aria-current']), [
      'page', undefined, undefined, undefined, undefined, undefined,
    ]);
  });

  test('an admin sees only the sections they may open', () => {
    const html = inSettings('/admin-settings/bill-settings', stored(['bill_settings', 'security.read']));
    const nav = sectionNav(mainOf(html));
    assert.deepEqual(nav.links.map((link) => tagsOf(link, 'a')[0].href), ['/admin-settings/bill-settings', '/admin-settings/security-limits']);
    assert.deepEqual(nav.links.map((link) => textOf(link)), ['Bill Settings', 'Rate Limits & IPs']);
    assert.deepEqual(nav.links.map((link) => tagsOf(link, 'a')[0]['aria-current']), ['page', undefined]);
    assert.match(mainOf(html), /<p id="section-probe">section body<\/p>/);
  });

  test('a section the admin may not open shows the shell refusal instead of the layout', () => {
    for (const path of ['/admin-settings/limits-fees', '/admin-settings']) {
      const main = mainOf(inSettings(path, stored(['bill_settings'])));
      assert.match(textOf(main), /You do not have access to this page/, path);
      assert.doesNotMatch(main, /Platform Settings sections|section-probe/, path);
    }
  });
});

describe('the section tabs follow the sidebar rule', () => {
  test('for every page key and every permission, the resolved permissions alone list the same sections as the stored keys', () => {
    const listing: string[] = [];
    for (const key of [...Object.keys(LEGACY_PERMISSION_MAP), ...ALL_PERMISSIONS]) {
      const held = resolvePermissions([key], false);
      const fromPermissions = navSections(PLATFORM_SETTINGS, filterNavByPermissions([], false, held, PAGE_READ_PERMISSION));
      const fromStored = navSections(PLATFORM_SETTINGS, filterNavByPermissions([key], false, held, PAGE_READ_PERMISSION));
      assert.deepEqual(fromPermissions, fromStored, key);
      if (fromStored.length > 0) listing.push(key);
    }
    assert.deepEqual(listing.sort(), [
      'admin_settings', 'anomaly.read', 'anomaly_alerts', 'bill_settings', 'configuration.read', 'limits.read', 'limits_fees',
      'platform_balance', 'platform_balance.read', 'providers.read', 'security.read', 'security_limits',
    ]);
  });
});

describe('house rules for the Platform Settings files', () => {
  const files = [join(SETTINGS_DIR, 'layout.tsx'), ...SECTION_SLUGS.map((slug) => join(SETTINGS_DIR, slug, 'page.tsx'))];

  test('the layout and the section routes carry no prose comments and no inline styles', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, NO_COMMENTS, file);
      assert.doesNotMatch(source, /style=\{/, file);
    }
    assert.doesNotMatch(readFileSync(fileURLToPath(import.meta.url), 'utf8'), NO_COMMENTS);
  });

  test('the Balance route renders the Balance section, and the four form pages import the shared form', () => {
    const route = readFileSync(join(SETTINGS_DIR, 'platform-balance', 'page.tsx'), 'utf8');
    assert.match(route, /^import PlatformBalanceSection from '\.\.\/\.\.\/platform-balance\/BalanceSection';$/m);
    assert.match(route, /return <PlatformBalanceSection \/>;/);
    assert.doesNotMatch(route, /use client/);
    for (const slug of CONFIG_FORM_SLUGS) {
      const source = readFileSync(join(SETTINGS_DIR, slug, 'page.tsx'), 'utf8');
      assert.match(source, /^import \{ ConfigForm\b[^}]*\} from '\.\.\/\.\.\/_config\/ConfigForm';$/m, slug);
    }
  });

  test('the layout is a client component that builds its tabs from the menu table and the resolved permissions', () => {
    const source = readFileSync(join(SETTINGS_DIR, 'layout.tsx'), 'utf8');
    assert.ok(source.startsWith("'use client';"));
    assert.match(source, /const \{ isSuperAdmin, permissions \} = usePermissions\(\);/);
    assert.match(source, /navSections\(PLATFORM_SETTINGS, filterNavByPermissions\(\[\], isSuperAdmin, permissions, PAGE_READ_PERMISSION\)\)/);
    assert.match(source, /label: leaf === PLATFORM_SETTINGS \? GENERAL_SECTION_LABEL : leaf\.label/);
    assert.match(source, /current=\{findNavMatch\(pathname\)\?\.leaf\.href \?\? null\}/);
  });
});
