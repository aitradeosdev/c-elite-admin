import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type Context } from 'react';
import { loadAppModule, render } from './support/uiHarness.ts';
import type { RefreshEnvironment, RefreshSchedule } from '../app/(dashboard)/dashboard/AutoRefresh.tsx';
import type { SignalTopic } from '../app/_ui/realtime/RealtimeSignals.tsx';

type AutoRefreshModule = typeof import('../app/(dashboard)/dashboard/AutoRefresh.tsx');
type SignalsModule = typeof import('../app/_ui/realtime/RealtimeSignals.tsx');
type MetricsModule = typeof import('../app/(dashboard)/dashboard/metrics.tsx');

const DASHBOARD_DIR = new URL('../app/(dashboard)/dashboard/', import.meta.url);
const LIB_DIR = new URL('../app/lib/', import.meta.url);
const AUTO_FILE = new URL('AutoRefresh.tsx', DASHBOARD_DIR);
const PAGE_FILE = new URL('page.tsx', DASHBOARD_DIR);
const PASS_LIB_FILE = new URL('realtimePass.ts', LIB_DIR);
const DASHBOARD_LIB_FILE = new URL('dashboard.ts', LIB_DIR);
const TEST_FILE = new URL(import.meta.url);

const T0 = 1000000;
const RENDERED_AT = '2026-10-16T08:00:00.000Z';
const BOTH: readonly SignalTopic[] = ['withdrawals', 'cards'];

const nodeRequire = createRequire(import.meta.url);
const { AppRouterContext } = nodeRequire('next/dist/shared/lib/app-router-context.shared-runtime') as {
  AppRouterContext: Context<unknown>;
};

let auto: AutoRefreshModule;
let signals: SignalsModule;
let metrics: MetricsModule;

before(async () => {
  auto = await loadAppModule<AutoRefreshModule>('(dashboard)/dashboard/AutoRefresh.tsx');
  signals = await loadAppModule<SignalsModule>('_ui/realtime/RealtimeSignals.tsx');
  metrics = await loadAppModule<MetricsModule>('(dashboard)/dashboard/metrics.tsx');
});

function read(file: URL): string {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function staticImports(text: string): string[] {
  return [...text.matchAll(/^import\b[^;]*?\bfrom '([^']+)';$/gm)].map((match) => match[1]);
}

interface Clock {
  env: RefreshEnvironment;
  advance: (ms: number) => void;
  elapsed: () => number;
  timers: () => number;
  setHidden: (hidden: boolean) => void;
}

function createClock(hidden: boolean): Clock {
  let now = T0;
  let sequence = 0;
  let isHidden = hidden;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const due = (until: number) => [...timers]
    .filter(([, timer]) => timer.at <= until)
    .sort(([leftId, left], [rightId, right]) => left.at - right.at || leftId - rightId)[0];
  return {
    env: {
      now: () => now,
      setTimer: (callback, ms) => {
        sequence += 1;
        timers.set(sequence, { at: now + ms, callback });
        return sequence;
      },
      clearTimer: (handle) => {
        timers.delete(handle as number);
      },
      isHidden: () => isHidden,
    },
    advance: (ms) => {
      const until = now + ms;
      let next = due(until);
      while (next) {
        const [id, timer] = next;
        timers.delete(id);
        now = timer.at;
        timer.callback();
        next = due(until);
      }
      now = until;
    },
    elapsed: () => now - T0,
    timers: () => timers.size,
    setHidden: (value) => {
      isHidden = value;
    },
  };
}

interface OverviewOptions {
  intervalMs?: number;
  hidden?: boolean;
  onRefresh?: () => void;
}

interface Overview {
  clock: Clock;
  plan: RefreshSchedule;
  refreshes: number[];
  hide: () => void;
  show: () => void;
}

function openOverview(options: OverviewOptions = {}): Overview {
  const clock = createClock(options.hidden ?? false);
  const refreshes: number[] = [];
  const plan = new auto.RefreshSchedule(() => {
    refreshes.push(clock.elapsed());
    options.onRefresh?.();
  }, options.intervalMs ?? metrics.REFRESH_INTERVAL_MS, clock.env);
  return {
    clock,
    plan,
    refreshes,
    hide: () => {
      clock.setHidden(true);
      plan.visibilityChanged();
    },
    show: () => {
      clock.setHidden(false);
      plan.visibilityChanged();
    },
  };
}

describe('the overview refresh schedule', () => {
  test('the overview keeps its 30 s timer, and signals refresh it at most once every 10 s', () => {
    assert.equal(metrics.REFRESH_INTERVAL_MS, 30000);
    assert.equal(auto.SIGNAL_REFRESH_GAP_MS, 10000);
  });

  test('with no signals it refreshes every 30 s, the one timer armed again from each refresh', () => {
    const { clock, refreshes } = openOverview();
    assert.equal(clock.timers(), 1);
    clock.advance(29999);
    assert.deepEqual(refreshes, []);
    clock.advance(1);
    assert.deepEqual(refreshes, [30000]);
    clock.advance(30000);
    assert.deepEqual(refreshes, [30000, 60000]);
    assert.equal(clock.timers(), 1);
  });

  test('a refresh that lands from anywhere, the Refresh button and retries included, starts the 30 s again', () => {
    const { clock, plan, refreshes } = openOverview();
    clock.advance(20000);
    plan.refreshed();
    clock.advance(29999);
    assert.deepEqual(refreshes, []);
    clock.advance(1);
    assert.deepEqual(refreshes, [50000]);
    clock.advance(1500);
    plan.refreshed();
    clock.advance(29999);
    assert.deepEqual(refreshes, [50000]);
    clock.advance(1);
    assert.deepEqual(refreshes, [50000, 81500]);
    assert.equal(clock.timers(), 1);
  });

  test('a signal 10 s or more after the last refresh refreshes at once, and the next timed refresh is 30 s after it', () => {
    const { clock, plan, refreshes } = openOverview();
    clock.advance(15000);
    plan.signal();
    assert.deepEqual(refreshes, [15000]);
    clock.advance(29999);
    assert.deepEqual(refreshes, [15000]);
    clock.advance(1);
    assert.deepEqual(refreshes, [15000, 45000]);
  });

  test('signals inside 10 s of the last refresh wait for the window to close, and any number of them make one refresh', () => {
    const { clock, plan, refreshes } = openOverview();
    clock.advance(3000);
    for (let index = 0; index < 10; index += 1) {
      plan.signal();
      clock.advance(10);
    }
    assert.deepEqual(refreshes, []);
    assert.equal(clock.timers(), 1);
    clock.advance(6899);
    assert.deepEqual(refreshes, []);
    clock.advance(1);
    assert.deepEqual(refreshes, [10000]);
    clock.advance(29999);
    assert.deepEqual(refreshes, [10000]);
    clock.advance(1);
    assert.deepEqual(refreshes, [10000, 40000]);
  });

  test('a minute of constant signals makes one refresh every 10 s and no more', () => {
    const { clock, plan, refreshes } = openOverview();
    for (let index = 0; index < 600; index += 1) {
      plan.signal();
      clock.advance(100);
    }
    assert.deepEqual(refreshes, [10000, 20000, 30000, 40000, 50000, 60000]);
    assert.equal(clock.timers(), 1);
  });

  test('a signal heard while a refresh is on its way gets one follow-up, 10 s after that refresh lands', () => {
    const { clock, plan, refreshes } = openOverview();
    clock.advance(30000);
    assert.deepEqual(refreshes, [30000]);
    clock.advance(500);
    plan.signal();
    clock.advance(1000);
    plan.refreshed();
    clock.advance(9999);
    assert.deepEqual(refreshes, [30000]);
    clock.advance(1);
    assert.deepEqual(refreshes, [30000, 41500]);
    plan.refreshed();
    clock.advance(30000);
    assert.deepEqual(refreshes, [30000, 41500, 71500]);
  });

  test('a refresh the overview did not start never cancels a signal it still owes, because it may predate the change', () => {
    const { clock, plan, refreshes } = openOverview();
    clock.advance(4000);
    plan.signal();
    clock.advance(2000);
    plan.refreshed();
    clock.advance(9999);
    assert.deepEqual(refreshes, []);
    clock.advance(1);
    assert.deepEqual(refreshes, [16000]);
    clock.advance(30000);
    assert.deepEqual(refreshes, [16000, 46000]);
  });

  test('while hidden neither the timer nor signals refresh, and the return catches up once', () => {
    const view = openOverview();
    view.clock.advance(5000);
    view.hide();
    assert.equal(view.clock.timers(), 0);
    view.plan.signal();
    view.clock.advance(95000);
    assert.deepEqual(view.refreshes, []);
    assert.equal(view.clock.timers(), 0);
    view.show();
    assert.deepEqual(view.refreshes, [100000]);
    view.clock.advance(30000);
    assert.deepEqual(view.refreshes, [100000, 130000]);
  });

  test('a short trip away with nothing due refreshes nothing on return, and the timer keeps its place', () => {
    const view = openOverview();
    view.clock.advance(2000);
    view.hide();
    view.clock.advance(3000);
    view.show();
    assert.deepEqual(view.refreshes, []);
    view.clock.advance(24999);
    assert.deepEqual(view.refreshes, []);
    view.clock.advance(1);
    assert.deepEqual(view.refreshes, [30000]);
  });

  test('a signal heard while hidden is served on return, but still no sooner than 10 s after the last refresh', () => {
    const view = openOverview();
    view.clock.advance(1000);
    view.hide();
    view.clock.advance(1000);
    view.plan.signal();
    view.clock.advance(2000);
    view.show();
    assert.deepEqual(view.refreshes, []);
    view.clock.advance(5999);
    assert.deepEqual(view.refreshes, []);
    view.clock.advance(1);
    assert.deepEqual(view.refreshes, [10000]);
  });

  test('on a return with live channels the resync is heard before the page handler and the overview refreshes once', () => {
    const live = openOverview();
    live.clock.advance(12000);
    live.hide();
    live.clock.advance(3000);
    live.clock.setHidden(false);
    live.plan.signal();
    live.plan.visibilityChanged();
    assert.deepEqual(live.refreshes, [15000]);
    live.clock.advance(29999);
    assert.deepEqual(live.refreshes, [15000]);
    live.clock.advance(1);
    assert.deepEqual(live.refreshes, [15000, 45000]);

    const polling = openOverview();
    polling.clock.advance(12000);
    polling.hide();
    polling.clock.advance(3000);
    polling.show();
    assert.deepEqual(polling.refreshes, []);
    polling.clock.advance(15000);
    assert.deepEqual(polling.refreshes, [30000]);
  });

  test('a tab opened in the background arms nothing until it is shown', () => {
    const view = openOverview({ hidden: true });
    assert.equal(view.clock.timers(), 0);
    view.clock.advance(60000);
    assert.deepEqual(view.refreshes, []);
    view.show();
    assert.deepEqual(view.refreshes, [60000]);
    assert.equal(view.clock.timers(), 1);
  });

  test('after dispose nothing refreshes and no timer is left behind', () => {
    const view = openOverview();
    view.clock.advance(5000);
    view.plan.signal();
    assert.equal(view.clock.timers(), 1);
    view.plan.dispose();
    assert.equal(view.clock.timers(), 0);
    view.plan.signal();
    view.plan.refreshed();
    view.plan.visibilityChanged();
    view.clock.advance(120000);
    assert.deepEqual(view.refreshes, []);
    assert.equal(view.clock.timers(), 0);
  });

  test('without a usable interval only signals refresh, still 10 s apart and with no timer left idle', () => {
    for (const intervalMs of [0, -30000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const label = String(intervalMs);
      const view = openOverview({ intervalMs });
      view.clock.advance(120000);
      assert.deepEqual(view.refreshes, [], label);
      assert.equal(view.clock.timers(), 0, label);
      view.plan.signal();
      view.plan.signal();
      assert.deepEqual(view.refreshes, [120000], label);
      view.clock.advance(10000);
      assert.deepEqual(view.refreshes, [120000, 130000], label);
      assert.equal(view.clock.timers(), 0, label);
    }
  });

  test('the 10 s gap never holds back a shorter timer', () => {
    const view = openOverview({ intervalMs: 5000 });
    view.clock.advance(1000);
    view.plan.signal();
    view.clock.advance(3999);
    assert.deepEqual(view.refreshes, []);
    view.clock.advance(1);
    assert.deepEqual(view.refreshes, [5000]);
    view.clock.advance(5000);
    assert.deepEqual(view.refreshes, [5000, 10000]);
  });

  test('a refresh that throws still leaves the next one armed', () => {
    let failing = true;
    const view = openOverview({
      onRefresh: () => {
        if (!failing) return;
        failing = false;
        throw new Error('router unavailable');
      },
    });
    assert.throws(() => view.clock.advance(30000), /router unavailable/);
    assert.equal(view.clock.timers(), 1);
    view.clock.advance(30000);
    assert.deepEqual(view.refreshes, [30000, 60000]);
  });
});

describe('the AutoRefresh island', () => {
  test('it renders nothing and never refreshes while rendering, inside or outside the realtime provider', () => {
    let refreshed = 0;
    const router = {
      push: () => {},
      replace: () => {},
      prefetch: () => {},
      back: () => {},
      forward: () => {},
      refresh: () => {
        refreshed += 1;
      },
    };
    const inRouter = (topics: readonly SignalTopic[], provided: boolean) => {
      const island = createElement(auto.default, { topics, generatedAt: RENDERED_AT });
      const tree = provided ? createElement(signals.RealtimeSignalsProvider, { children: island }) : island;
      return render(createElement(AppRouterContext.Provider, { value: router }, tree));
    };
    assert.deepEqual([inRouter(BOTH, false), inRouter(BOTH, true), inRouter([], true)], ['', '', '']);
    assert.equal(refreshed, 0);
  });

  test('it is a client island that takes only React, the router and the realtime hook', () => {
    const source = read(AUTO_FILE);
    assert.ok(source.startsWith("'use client';\n"));
    assert.deepEqual(staticImports(source), ['react', 'next/navigation', '../../_ui/realtime/RealtimeSignals']);
    assert.match(source, /^import \{ useRealtimeSignal, type SignalTopic \} from '\.\.\/\.\.\/_ui\/realtime\/RealtimeSignals';$/m);
    assert.doesNotMatch(source, /@supabase|supabaseTransport|signalsCore|realtimePass|lib\/supabase|setInterval|\.channel\(|postgres_changes/);
  });

  test('one schedule per mount drives router.refresh, hears tab returns on the document and is disposed on unmount', () => {
    const source = read(AUTO_FILE);
    assert.match(
      source,
      /useEffect\(\(\) => \{\n {4}const next = new RefreshSchedule\(\(\) => router\.refresh\(\), intervalMs\);\n {4}schedule\.current = next;\n {4}const onVisibility = \(\) => next\.visibilityChanged\(\);\n {4}document\.addEventListener\('visibilitychange', onVisibility\);\n {4}return \(\) => \{\n {6}document\.removeEventListener\('visibilitychange', onVisibility\);\n {6}next\.dispose\(\);\n {6}schedule\.current = null;\n {4}\};\n {2}\}, \[router, intervalMs\]\);/,
    );
    assert.equal(count(source, 'router.refresh()'), 1);
    assert.equal(count(source, 'new RefreshSchedule('), 1);
  });

  test('every new server render restarts the clock, so the Refresh button and retries count as refreshes', () => {
    assert.match(read(AUTO_FILE), /useEffect\(\(\) => \{\n {4}schedule\.current\?\.refreshed\(\);\n {2}\}, \[generatedAt\]\);/);
  });

  test('it listens once per granted topic, after the schedule exists, and a hint only asks the schedule for a refresh', () => {
    const source = read(AUTO_FILE);
    assert.equal(count(source, 'useRealtimeSignal('), 2);
    assert.match(
      source,
      /const onSignal = \(\) => schedule\.current\?\.signal\(\);\n {2}useRealtimeSignal\(topics\.includes\('withdrawals'\) \? 'withdrawals' : null, onSignal\);\n {2}useRealtimeSignal\(topics\.includes\('cards'\) \? 'cards' : null, onSignal\);\n {2}return null;\n\}/,
    );
    assert.ok(source.indexOf('new RefreshSchedule(') < source.indexOf('useRealtimeSignal(topics'));
    assert.doesNotMatch(source, /\bsignal\.(?:id|status|table|withdrawalId|kind)\b/);
  });
});

describe('the overview page', () => {
  test('the server page takes its topics from the pass library and hands the island the render time', () => {
    const page = read(PAGE_FILE);
    assert.doesNotMatch(page, /^\s*['"]use client['"]/);
    assert.match(page, /^import \{ realtimeTopicKeys \} from '\.\.\/\.\.\/lib\/realtimePass';$/m);
    assert.match(page, /^ {2}const topics = realtimeTopicKeys\(\(permission\) => permissions\.has\(permission\)\);$/m);
    assert.match(page, /^ {6}<AutoRefresh intervalMs=\{REFRESH_INTERVAL_MS\} topics=\{topics\} generatedAt=\{data\.generated_at\} \/>$/m);
    assert.equal(count(page, '<AutoRefresh'), 1);
    assert.ok(page.indexOf('const permissions = resolveAdminPermissions(admin);') < page.indexOf('const topics = '));
    assert.match(page, /title=\{`Refreshes automatically every \$\{REFRESH_SECONDS\} seconds`\}/);
  });

  test('the topics are the pass library topics, granted by the same read permissions as the Needs action tiles they refresh', () => {
    const pass = read(PASS_LIB_FILE);
    assert.match(pass, /\{ key: 'withdrawals', topic: 'admin:withdrawals', permission: 'withdrawals\.read' \}/);
    assert.match(pass, /\{ key: 'cards', topic: 'admin:cards', permission: 'cards\.read' \}/);
    const groups = read(DASHBOARD_LIB_FILE);
    for (const line of ["  cards: 'cards.read',", "  withdrawals: 'withdrawals.read',", "  flags: 'withdrawals.read',"]) {
      assert.ok(groups.includes(`\n${line}\n`), line);
    }
    const tilePermissions = new Set(metrics.ACTION_METRICS.map((spec) => String(spec.perm)));
    assert.deepEqual([...tilePermissions].sort(), ['cards.read', 'withdrawals.read']);
  });
});

describe('house rules for the overview realtime wiring', () => {
  test('the owned sources and this suite carry no prose comments, and the sources no inline styles', () => {
    const files: Array<[string, URL]> = [['AutoRefresh.tsx', AUTO_FILE], ['page.tsx', PAGE_FILE], ['this suite', TEST_FILE]];
    for (const [name, file] of files) assert.doesNotMatch(read(file), /\/\*|(^|[^:])\/\/(?!\/)/m, name);
    for (const [name, file] of files.slice(0, 2)) assert.doesNotMatch(read(file), /style=\{\{/, name);
  });
});
