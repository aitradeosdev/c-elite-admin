import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type Context, type ElementType, type ReactElement } from 'react';
import { classesOf, loadAppModule, loadUi, loadUiExport, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import type { Permission } from '../app/lib/permissions.ts';
import type { MetricMap } from '../app/lib/dashboard.ts';
import type { RecentRow, RecentSubmissionsProps } from '../app/(dashboard)/dashboard/RecentSubmissions.tsx';

type MetricsModule = typeof import('../app/(dashboard)/dashboard/metrics.tsx');
type BandsModule = typeof import('../app/(dashboard)/dashboard/DashboardBands.tsx');
type RecentModule = typeof import('../app/(dashboard)/dashboard/RecentSubmissions.tsx');
type RefreshModule = typeof import('../app/(dashboard)/dashboard/Refresh.tsx');
type LoadingModule = typeof import('../app/(dashboard)/dashboard/loading.tsx');
type MoneyModule = typeof import('../app/_ui/money.ts');

const nodeRequire = createRequire(import.meta.url);
const { AppRouterContext } = nodeRequire('next/dist/shared/lib/app-router-context.shared-runtime') as {
  AppRouterContext: Context<unknown>;
};

const ROUTER = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
};

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const dashboardSource = (name: string) => source(`../app/(dashboard)/dashboard/${name}`);

const OWNED = [
  'page.tsx', 'loading.tsx', 'DashboardBands.tsx', 'RecentSubmissions.tsx', 'Refresh.tsx', 'AutoRefresh.tsx', 'metrics.tsx',
];

const ALL = new Set<Permission>([
  'cards.read', 'withdrawals.read', 'transactions.read', 'users.read', 'rewards.read', 'referrals.read',
  'wallets.read', 'user_activity.read', 'coupons.read', 'catalog.read', 'admin_users.read', 'flags.read',
]);

const NOW = new Date('2026-10-02T12:00:00.000Z');

const ACTION_STATS: MetricMap = {
  pendingCards: 3,
  oldestPendingCardAt: '2026-10-02T09:00:00.000Z',
  disputedCards: 0,
  pendingWithdrawals: '2',
  oldestPendingWithdrawalAt: '',
  pendingWithdrawalValue: 0,
  openFlags: null,
};

const ROWS: RecentRow[] = [
  {
    id: '0b8e7d6c-5a4b-4c3d-9e2f-1a0b9c8d7e6f',
    href: '/card-queue?id=0b8e7d6c-5a4b-4c3d-9e2f-1a0b9c8d7e6f',
    user: '@ada',
    card: 'Amazon',
    country: 'United States',
    payout: 125000,
    status: 'pending',
    submittedAt: '2 Oct 2026, 10:15',
    age: '2h',
  },
  {
    id: '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5',
    href: '/card-queue?id=6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5',
    user: 'Unknown user',
    card: 'Steam',
    country: null,
    payout: null,
    status: 'approved',
    submittedAt: '2 Oct 2026, 09:40',
    age: '3h',
  },
];

let metrics: MetricsModule;
let bands: BandsModule;
let recentModule: RecentModule;
let refreshModule: RefreshModule;
let loadingModule: LoadingModule;
let money: MoneyModule;
let StatStrip: ElementType;

before(async () => {
  metrics = await loadAppModule<MetricsModule>('(dashboard)/dashboard/metrics.tsx');
  bands = await loadAppModule<BandsModule>('(dashboard)/dashboard/DashboardBands.tsx');
  recentModule = await loadAppModule<RecentModule>('(dashboard)/dashboard/RecentSubmissions.tsx');
  refreshModule = await loadAppModule<RefreshModule>('(dashboard)/dashboard/Refresh.tsx');
  loadingModule = await loadAppModule<LoadingModule>('(dashboard)/dashboard/loading.tsx');
  money = await loadUi<MoneyModule>('money.ts');
  StatStrip = await loadUiExport('Status.tsx', 'StatStrip');
});

function inRouter(element: ReactElement): string {
  return render(createElement(AppRouterContext.Provider, { value: ROUTER }, element));
}

function band(id: string) {
  const found = metrics.STRIP_BANDS.find((entry) => entry.id === id);
  assert.ok(found, `missing band ${id}`);
  return found;
}

function count(html: string, pattern: RegExp): number {
  return [...html.matchAll(pattern)].length;
}

describe('dashboard metrics', () => {
  test('strip cells are kit StatItems: ready figures formatted, failures unavailable rather than zero', () => {
    const cells = metrics.buildStripCells(
      band('today').metrics,
      { cardsInRange: 1204, payoutsInRange: '250000.5', txInRange: null, txVolumeInRange: 'n/a' },
      new Set<Permission>(['cards.read', 'withdrawals.read', 'transactions.read']),
      false,
    );
    assert.deepEqual(cells, [
      { label: 'Cards submitted', hint: 'Any status', href: '/card-queue', value: '1,204', unavailable: false },
      {
        label: 'Payouts settled',
        hint: 'Successful withdrawals',
        href: '/withdrawals?tab=success',
        value: money.formatNaira(250000.5),
        unavailable: false,
      },
      { label: 'Transactions', hint: 'All types and statuses', href: '/transactions-overview', value: '', unavailable: true },
      { label: 'Volume', hint: 'Successful transactions', href: '/transactions-overview', value: '', unavailable: true },
    ]);
  });

  test('a failed calculation marks every granted cell unavailable and leaves ungranted ones out', () => {
    const cells = metrics.buildStripCells(
      band('estate').metrics,
      { totalUsers: 10, activeCards: 4 },
      new Set<Permission>(['users.read', 'catalog.read']),
      true,
    );
    assert.deepEqual(cells.map((cell) => [cell.label, cell.unavailable, cell.value]), [
      ['Total users', true, ''],
      ['Frozen users', true, ''],
      ['Active cards', true, ''],
    ]);
  });

  test('placeholders load every metric with a skeleton sized to its format', () => {
    const today = band('today');
    const cells = metrics.placeholderStripCells(today.metrics);
    assert.equal(cells.length, today.metrics.length);
    for (const cell of cells) {
      assert.equal(cell.loading, true);
      assert.equal(cell.value, '');
      assert.ok(cell.href);
    }
    assert.deepEqual(cells.slice(0, 2).map((cell) => cell.loadingWidth), ['2.5em', '7em']);
    assert.deepEqual(metrics.VALUE_SKELETON_WIDTH, { count: '2.5em', money: '7em' });
  });

  test('labels are unique within each strip, because StatStrip keys its cells by label', () => {
    for (const entry of metrics.STRIP_BANDS) {
      const labels = entry.metrics.map((spec) => spec.label);
      assert.equal(new Set(labels).size, labels.length, entry.id);
    }
  });

  test('action tiles need attention only while something is waiting', () => {
    const tiles = metrics.buildActionTiles(ACTION_STATS, ALL, false, NOW);
    assert.deepEqual(tiles.map((tile) => [tile.key, tile.state, tile.value, tile.attention, tile.age, tile.hint]), [
      ['pendingCards', 'ready', '3', true, '3h', 'Awaiting admin review'],
      ['disputedCards', 'ready', '0', false, null, 'No open disputes'],
      ['pendingWithdrawals', 'ready', '2', true, null, 'In review or held'],
      ['pendingWithdrawalValue', 'ready', money.formatNaira(0), false, null, 'Nothing held'],
      ['openFlags', 'unavailable', '', false, null, 'Awaiting review'],
    ]);
  });
});

describe('dashboard bands on the kit', () => {
  test('a band is a section named by a real h2, with no role=heading wrapper', () => {
    const html = render(createElement(bands.Band, { id: 'overview-today', label: 'Today', children: 'cells' }));
    const [section] = tagsOf(html, 'section');
    const [heading] = tagsOf(html, 'h2');
    assert.equal(section['aria-labelledby'], 'overview-today');
    assert.equal(heading.id, 'overview-today');
    assert.deepEqual(classesOf(heading), ['sectionLabel', 'sectionLabelFlush']);
    assert.match(html, /<h2[^>]*>Today<\/h2>/);
    assert.doesNotMatch(html, /role="heading"|aria-level|bandTitle/);
  });

  test('tiles waiting on an admin carry the Kpi warning tone on the tile and its hint', () => {
    const tiles = metrics.buildActionTiles(ACTION_STATS, ALL, false, NOW);
    const html = render(createElement(bands.ActionTiles, { tiles }));
    assert.deepEqual(tagsOf(html, 'a').map((attrs) => [attrs.href, classesOf(attrs)]), [
      ['/card-queue?status=pending', ['kpi', 'kpiLink', 'kpiWarning']],
      ['/card-queue?status=disputed', ['kpi', 'kpiLink']],
      ['/withdrawals?tab=pending_review', ['kpi', 'kpiLink', 'kpiWarning']],
      ['/withdrawals?tab=pending_review', ['kpi', 'kpiLink']],
    ]);
    assert.equal(withClass(html, 'div', 'kpiHintWarning').length, 2);
    assert.match(html, /<div class="kpiHint kpiHintWarning">Oldest waiting <span class="age">3h<\/span><\/div>/);
    assert.equal(withClass(html, 'span', 'kpiIcon').length, tiles.length);
    assert.doesNotMatch(html, /tileIcon|attention/);
    assert.match(textOf(html), /Open flags Unavailable This metric could not be loaded\./);
  });

  test('loading tiles show inline skeletons sized to the figure and never link', () => {
    const html = render(createElement(bands.ActionTiles, { tiles: metrics.placeholderActionTiles() }));
    assert.equal(tagsOf(html, 'a').length, 0);
    const skeletons = withClass(html, 'span', 'skeleton');
    for (const attrs of skeletons) assert.deepEqual(classesOf(attrs), ['skeleton', 'skeletonInline']);
    assert.deepEqual(skeletons.map((attrs) => attrs.style), [
      'width:2.5em', 'width:9em',
      'width:2.5em', 'width:9em',
      'width:2.5em', 'width:9em',
      'width:7em', 'width:9em',
      'width:2.5em', 'width:9em',
    ]);
    assert.doesNotMatch(html, /kpiWarning|kpiHintWarning|inlineSkeleton/);
  });

  test('the strips render through StatStrip: only ready cells link, unavailable ones say so', () => {
    const cells = metrics.buildStripCells(
      band('today').metrics,
      { cardsInRange: 7, txInRange: null },
      new Set<Permission>(['cards.read', 'transactions.read']),
      false,
    );
    const html = render(createElement(StatStrip, { items: cells, fill: true, flush: true }));
    assert.deepEqual(classesOf(tagsOf(html, 'div')[0]), ['statStrip', 'statStripFill', 'statStripFlush']);
    assert.deepEqual(tagsOf(html, 'a').map((attrs) => attrs.href), ['/card-queue']);
    assert.equal(withClass(html, 'span', 'statUnavailable').length, 2);
    assert.equal(count(html, /<span class="statHint">This metric could not be loaded\.<\/span>/g), 2);
  });
});

describe('RecentSubmissions', () => {
  const recent = (props: RecentSubmissionsProps) => inRouter(createElement(recentModule.RecentSubmissions, props));

  test('renders both trees through ResponsiveView, so phones get list markup from the server', () => {
    const html = recent({ rows: ROWS, error: null });
    assert.deepEqual(withClass(html, 'div', 'view').map(classesOf), [
      ['view', 'desktop', 'atMobile'],
      ['view', 'mobile', 'atMobile'],
    ]);
    assert.equal(tagsOf(html, 'table')[0]['aria-label'], 'Recent card submissions');
    assert.equal(withClass(html, 'ul', 'list')[0]['aria-label'], 'Recent card submissions');
    assert.doesNotMatch(html, /desktopOnly|mobileOnly/);
  });

  test('each row opens the queue drawer through a ghost LinkButton named for the card and user', () => {
    const html = recent({ rows: ROWS, error: null });
    assert.deepEqual(withClass(html, 'a', 'btn').map((attrs) => [classesOf(attrs), attrs.href, attrs['aria-label']]), [
      [['btn', 'ghost', 'sm', 'link'], ROWS[0].href, 'Open Amazon from @ada'],
      [['btn', 'ghost', 'sm', 'link'], ROWS[1].href, 'Open Steam from Unknown user'],
    ]);
    const bodyRows = withClass(html, 'tr', 'tr').filter((attrs) => classesOf(attrs).includes('interactive'));
    assert.equal(bodyRows.length, ROWS.length);
    assert.deepEqual(withClass(html, 'a', 'body').map((attrs) => attrs.href), ROWS.map((row) => row.href));
    assert.doesNotMatch(html, /openLink/);
  });

  test('loading shows per-column skeleton rows on desktop and the skeleton list on mobile', () => {
    const html = recent({ rows: [], error: null, loading: true });
    assert.equal(withClass(html, 'tr', 'skeletonRow').length, 10);
    const firstRow = html.match(/<tr[^>]*class="skeletonRow"[^>]*>([\s\S]*?)<\/tr>/);
    assert.ok(firstRow);
    assert.equal(count(firstRow[1], /<td\b/g), 7);
    const buttons = withClass(html, 'div', 'skeletonButton');
    assert.equal(buttons.length, 10);
    for (const attrs of buttons) assert.match(attrs.style, /^width:54px;height:var\(--space-7\)/);
    assert.deepEqual([...html.matchAll(/role="status">([^<]*)</g)].map((match) => match[1]), [
      'Loading Recent card submissions',
      'Loading Recent card submissions',
    ]);
    assert.equal(tagsOf(html, 'table')[0]['aria-busy'], 'true');
    assert.equal(tagsOf(html, 'a').length, 0);
  });

  test('a failed fetch shows the same ErrorState title with a retry on both trees', () => {
    const html = recent({ rows: [], error: 'The latest card submissions could not be fetched.' });
    assert.equal(tagsOf(html, 'div').filter((attrs) => attrs.role === 'alert').length, 2);
    assert.equal(count(html, /<h2 class="titleCompact">Recent submissions could not be loaded<\/h2>/g), 2);
    assert.equal(count(html, /The latest card submissions could not be fetched\./g), 2);
    assert.equal(count(html, />Try again</g), 2);
    assert.equal(withClass(html, 'td', 'stateCell')[0].colSpan, '7');
  });

  test('an empty feed says what will appear, on both trees', () => {
    const html = recent({ rows: [], error: null });
    assert.equal(count(html, /No card submissions yet/g), 2);
    assert.equal(count(html, /Submissions appear here as soon as a user sends a card for review\./g), 2);
    assert.equal(withClass(html, 'td', 'stateCell')[0].colSpan, '7');
    assert.deepEqual(classesOf(withClass(html, 'div', 'emptyState')[0]), ['empty', 'emptyState']);
  });
});

describe('dashboard refresh and loading', () => {
  test('RetryState is the kit ErrorState itself, with a retry and no local busy wrapper', () => {
    const html = inRouter(createElement(refreshModule.RetryState, {
      title: 'Metrics could not be calculated',
      message: 'Every figure below shows as unavailable rather than zero.',
      stillFailing: 'Metrics are still unavailable.',
    }));
    assert.ok(html.startsWith('<div class="wrap compact" role="alert">'), html.slice(0, 80));
    assert.doesNotMatch(html, /aria-busy|retrying/);
    assert.match(html, />Try again</);
  });

  test('the loading state mirrors the page: header, every band in order, recent submissions', () => {
    const html = inRouter(createElement(loadingModule.default));
    assert.match(html, /<h1 class="pageTitle">Overview<\/h1>/);
    const headings = [...html.matchAll(/<h2 id="([^"]+)" class="sectionLabel sectionLabelFlush">([^<]*)<\/h2>/g)];
    assert.deepEqual(headings.map((match) => match[2]), ['Needs action', 'Today', 'Exposure', 'Estate', 'Recent submissions']);
    assert.deepEqual(tagsOf(html, 'section').map((attrs) => attrs['aria-labelledby']), headings.map((match) => match[1]));
    const cells = metrics.STRIP_BANDS.reduce((sum, entry) => sum + entry.metrics.length, 0);
    assert.equal(withClass(html, 'div', 'statCell').length, cells);
    assert.equal(withClass(html, 'div', 'kpi').length, metrics.ACTION_METRICS.length);
    assert.deepEqual(tagsOf(html, 'a').map((attrs) => attrs.href), ['/card-queue']);
    const refresh = tagsOf(html, 'button').filter((attrs) => classesOf(attrs).includes('btn'));
    assert.equal(refresh.length, 1);
    assert.ok('disabled' in refresh[0]);
  });
});

describe('dashboard sources', () => {
  test('owned sources carry no prose comments and no static inline styles', () => {
    for (const name of OWNED) {
      const code = dashboardSource(name);
      assert.doesNotMatch(code, /^\s*\/\/|\s\/\/\s|\/\*/m, name);
      assert.doesNotMatch(code, /style=\{\{/, name);
    }
    for (const path of ['../app/api/dashboard/route.ts', '../app/lib/dashboard.ts']) {
      assert.doesNotMatch(source(path), /^\s*\/\/|\s\/\/\s|\/\*/m, path);
    }
  });

  test('the stylesheet uses tokens only, with no z-index and no comments', () => {
    const css = dashboardSource('page.module.css');
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(css, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/);
    assert.doesNotMatch(css, /(?<![-\w])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink)(?![-\w])/i);
    assert.doesNotMatch(css, /z-index/);
    assert.doesNotMatch(css, /\/\*/);
  });

  test('every class the dashboard references is defined, and no rule is left unused', () => {
    const used = new Set(OWNED.flatMap((name) => [...dashboardSource(name).matchAll(/\bs\.([A-Za-z]\w*)/g)].map((match) => match[1])));
    const defined = new Set([...dashboardSource('page.module.css').matchAll(/\.([A-Za-z]\w*)/g)].map((match) => match[1]));
    assert.deepEqual([...used].sort(), [...defined].sort());
  });

  test('the local workarounds the kit replaced are gone', () => {
    const code = OWNED.map(dashboardSource).join('\n');
    const retired = [
      'MetricStrip', 'CellBody', 'StripCellView', 'ValueSkeleton', 'HintSkeleton', 'SkeletonLine', 'SkeletonRow',
      'SKELETON_WIDTHS', 'StateRow', 'openRow', 'window.open', 'role="heading"', 'aria-level',
    ];
    for (const name of retired) assert.ok(!code.includes(name), name);
  });

  test('server modules stay server-rendered and the client islands are marked', () => {
    for (const name of ['page.tsx', 'loading.tsx', 'DashboardBands.tsx', 'metrics.tsx']) {
      assert.doesNotMatch(dashboardSource(name), /^['"]use client['"]/, name);
    }
    for (const name of ['RecentSubmissions.tsx', 'Refresh.tsx', 'AutoRefresh.tsx']) {
      assert.match(dashboardSource(name), /^'use client';/, name);
    }
  });
});
