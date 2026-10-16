import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type Context } from 'react';
import { loadAppModule, render } from './support/uiHarness.ts';
import type { RefreshEnvironment, RefreshSchedule } from '../app/(dashboard)/dashboard/AutoRefresh.tsx';
import type { RealtimeStatus, SignalPause, SignalTopic } from '../app/_ui/realtime/RealtimeSignals.tsx';

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
const HOUR_MS = 60 * 60 * 1000;
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
  }, clock.env);
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

function status(live: boolean, pause: SignalPause | null = null): RealtimeStatus {
  return { live, pause };
}

describe('the overview refresh schedule', () => {
  test('the overview has no timer of its own; signals refresh it at most once every 10 s', () => {
    assert.equal(auto.SIGNAL_REFRESH_GAP_MS, 10000);
    assert.equal(auto.RefreshSchedule.length, 1);
  });

  test('with no signals it never refreshes and arms no timer, however long the page stays open, shown or hidden', () => {
    const view = openOverview();
    assert.equal(view.clock.timers(), 0);
    view.clock.advance(HOUR_MS * 8);
    assert.deepEqual(view.refreshes, []);
    view.hide();
    view.clock.advance(HOUR_MS);
    view.show();
    view.clock.advance(HOUR_MS);
    view.plan.refreshed();
    view.clock.advance(HOUR_MS);
    assert.deepEqual(view.refreshes, []);
    assert.equal(view.clock.timers(), 0);
  });

  test('a signal 10 s or more after the last refresh refreshes at once, and nothing follows it', () => {
    const { clock, plan, refreshes } = openOverview();
    clock.advance(15000);
    plan.signal();
    assert.deepEqual(refreshes, [15000]);
    assert.equal(clock.timers(), 0);
    clock.advance(HOUR_MS);
    assert.deepEqual(refreshes, [15000]);
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
    assert.equal(clock.timers(), 0);
    clock.advance(HOUR_MS);
    assert.deepEqual(refreshes, [10000]);
  });

  test('a minute of constant signals makes one refresh every 10 s and no more', () => {
    const { clock, plan, refreshes } = openOverview();
    for (let index = 0; index < 600; index += 1) {
      plan.signal();
      clock.advance(100);
    }
    assert.deepEqual(refreshes, [10000, 20000, 30000, 40000, 50000, 60000]);
    assert.equal(clock.timers(), 0);
    clock.advance(HOUR_MS);
    assert.deepEqual(refreshes, [10000, 20000, 30000, 40000, 50000, 60000]);
  });

  test('a refresh that lands from anywhere, the Refresh button and retries included, restarts the 10 s window', () => {
    const { clock, plan, refreshes } = openOverview();
    clock.advance(20000);
    plan.refreshed();
    clock.advance(4000);
    plan.signal();
    clock.advance(5999);
    assert.deepEqual(refreshes, []);
    clock.advance(1);
    assert.deepEqual(refreshes, [30000]);
    assert.equal(clock.timers(), 0);
  });

  test('a signal heard while a refresh is on its way gets one follow-up, 10 s after that refresh lands', () => {
    const { clock, plan, refreshes } = openOverview();
    clock.advance(30000);
    plan.signal();
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
    clock.advance(HOUR_MS);
    assert.deepEqual(refreshes, [30000, 41500]);
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
    clock.advance(HOUR_MS);
    assert.deepEqual(refreshes, [16000]);
  });

  test('while hidden nothing refreshes and no timer is armed; the return serves an owed signal once', () => {
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
    view.clock.advance(HOUR_MS);
    assert.deepEqual(view.refreshes, [100000]);
    assert.equal(view.clock.timers(), 0);
  });

  test('a trip away with nothing owed refreshes nothing on return and arms nothing', () => {
    const view = openOverview();
    view.clock.advance(2000);
    view.hide();
    view.clock.advance(HOUR_MS);
    view.show();
    assert.deepEqual(view.refreshes, []);
    assert.equal(view.clock.timers(), 0);
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

  test('on a return with live channels the resync is heard first and the overview reloads once; with none it waits for Refresh', () => {
    const live = openOverview();
    live.clock.advance(12000);
    live.hide();
    live.clock.advance(3000);
    live.clock.setHidden(false);
    live.plan.signal();
    live.plan.visibilityChanged();
    assert.deepEqual(live.refreshes, [15000]);
    live.clock.advance(HOUR_MS);
    assert.deepEqual(live.refreshes, [15000]);

    const paused = openOverview();
    paused.clock.advance(12000);
    paused.hide();
    paused.clock.advance(3000);
    paused.show();
    paused.clock.advance(HOUR_MS);
    assert.deepEqual(paused.refreshes, []);
    assert.equal(paused.clock.timers(), 0);
  });

  test('a reconnect, which every page hears as a resync, reloads the overview once', () => {
    const view = openOverview();
    view.clock.advance(60000);
    view.plan.signal();
    assert.deepEqual(view.refreshes, [60000]);
    view.plan.refreshed();
    view.clock.advance(HOUR_MS);
    assert.deepEqual(view.refreshes, [60000]);
  });

  test('a tab opened in the background arms nothing, and a signal heard there is served once it is shown', () => {
    const view = openOverview({ hidden: true });
    assert.equal(view.clock.timers(), 0);
    view.clock.advance(60000);
    view.plan.signal();
    assert.deepEqual(view.refreshes, []);
    assert.equal(view.clock.timers(), 0);
    view.show();
    assert.deepEqual(view.refreshes, [60000]);
    assert.equal(view.clock.timers(), 0);
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

  test('a refresh that throws still lets the next signal refresh, 10 s later', () => {
    let failing = true;
    const view = openOverview({
      onRefresh: () => {
        if (!failing) return;
        failing = false;
        throw new Error('router unavailable');
      },
    });
    view.clock.advance(30000);
    assert.throws(() => view.plan.signal(), /router unavailable/);
    view.plan.signal();
    assert.equal(view.clock.timers(), 1);
    view.clock.advance(10000);
    assert.deepEqual(view.refreshes, [30000, 40000]);
  });
});

describe('the overview live status', () => {
  test('with no topic the overview is neither live nor paused', () => {
    assert.deepEqual(auto.overviewStatus([]), status(false));
  });

  test('it is live only while every granted topic is live', () => {
    assert.deepEqual(auto.overviewStatus([status(true)]), status(true));
    assert.deepEqual(auto.overviewStatus([status(true), status(true)]), status(true));
    assert.deepEqual(auto.overviewStatus([status(true), status(false)]), status(false));
    assert.deepEqual(auto.overviewStatus([status(false), status(false)]), status(false));
  });

  test('any paused topic pauses the overview, and a pause that will not mend itself wins over reconnecting', () => {
    assert.deepEqual(auto.overviewStatus([status(true), status(false, 'reconnecting')]), status(false, 'reconnecting'));
    assert.deepEqual(auto.overviewStatus([status(false, 'reconnecting'), status(false, 'stopped')]), status(false, 'stopped'));
    assert.deepEqual(auto.overviewStatus([status(false, 'stopped'), status(true)]), status(false, 'stopped'));
    assert.deepEqual(auto.overviewStatus([status(false, 'disabled'), status(false, 'disabled')]), status(false, 'disabled'));
    assert.deepEqual(auto.overviewStatus([status(false, 'reconnecting'), status(false, 'disabled')]), status(false, 'disabled'));
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

  test('the updated stamp shows the render time and claims to be live only once the topics are', () => {
    const stamp = (topics: readonly SignalTopic[], provided: boolean) => {
      const element = createElement(auto.UpdatedStamp, { topics, generatedAt: RENDERED_AT });
      return render(provided ? createElement(signals.RealtimeSignalsProvider, { children: element }) : element);
    };
    for (const html of [stamp(BOTH, true), stamp(BOTH, false), stamp([], true)]) {
      assert.equal(html, '<span class="updated">Updated 09:00 WAT</span>');
    }
    assert.equal(auto.LIVE_NOTE, 'Updates live');
    assert.match(read(AUTO_FILE), /<span className=\{s\.updated\} title=\{live \? LIVE_NOTE : undefined\}>/);
  });

  test('it is a client island that takes React, the router, the kit, the realtime hooks, the time format and the Refresh hook', () => {
    const source = read(AUTO_FILE);
    assert.ok(source.startsWith("'use client';\n"));
    assert.deepEqual(staticImports(source), [
      'react', 'next/navigation', '../../_ui', '../../_ui/realtime/RealtimeSignals', '../../lib/time', './Refresh',
      './page.module.css',
    ]);
    assert.match(source, /^import \{ Button, Notice \} from '\.\.\/\.\.\/_ui';$/m);
    assert.match(source, /^import \{ useServerRefresh \} from '\.\/Refresh';$/m);
    assert.doesNotMatch(source, /@supabase|supabaseTransport|signalsCore|realtimePass|lib\/supabase|setInterval|\.channel\(|postgres_changes/);
    assert.doesNotMatch(source, /intervalMs|REFRESH_INTERVAL|30000/);
  });

  test('one signal-only schedule per mount drives router.refresh, hears tab returns on the document and is disposed on unmount', () => {
    const source = read(AUTO_FILE);
    assert.match(
      source,
      /useEffect\(\(\) => \{\n {4}const next = new RefreshSchedule\(\(\) => router\.refresh\(\)\);\n {4}schedule\.current = next;\n {4}const onVisibility = \(\) => next\.visibilityChanged\(\);\n {4}document\.addEventListener\('visibilitychange', onVisibility\);\n {4}return \(\) => \{\n {6}document\.removeEventListener\('visibilitychange', onVisibility\);\n {6}next\.dispose\(\);\n {6}schedule\.current = null;\n {4}\};\n {2}\}, \[router\]\);/,
    );
    assert.equal(count(source, 'router.refresh()'), 1);
    assert.equal(count(source, 'new RefreshSchedule('), 1);
    assert.match(source, /private dueAt\(\): number \| null \{\n {4}return this\.owed \? this\.lastAt \+ SIGNAL_REFRESH_GAP_MS : null;\n {2}\}/);
  });

  test('every new server render restarts the 10 s window, so the Refresh button and retries count as refreshes', () => {
    assert.match(read(AUTO_FILE), /useEffect\(\(\) => \{\n {4}schedule\.current\?\.refreshed\(\);\n {2}\}, \[generatedAt\]\);/);
  });

  test('it listens once per granted topic, after the schedule exists, and a hint only asks the schedule for a refresh', () => {
    const source = read(AUTO_FILE);
    assert.equal(count(source, 'useRealtimeSignal('), 2);
    assert.match(
      source,
      /const onSignal = \(\) => schedule\.current\?\.signal\(\);\n {2}useRealtimeSignal\(topics\.includes\('withdrawals'\) \? 'withdrawals' : null, onSignal\);\n {2}useRealtimeSignal\(topics\.includes\('cards'\) \? 'cards' : null, onSignal\);\n/,
    );
    assert.ok(source.indexOf('new RefreshSchedule(') < source.indexOf('useRealtimeSignal(topics'));
    assert.doesNotMatch(source, /\bsignal\.(?:id|status|table|withdrawalId|kind)\b/);
  });

  test('it reads the status of the granted topics only, and while paused shows the shared wording with a Refresh button', () => {
    const source = read(AUTO_FILE);
    assert.equal(count(source, 'useRealtimeStatus('), 2);
    assert.match(source, /const withdrawalsStatus = useRealtimeStatus\(withdrawals \? 'withdrawals' : null\);/);
    assert.match(source, /const cardsStatus = useRealtimeStatus\(cards \? 'cards' : null\);/);
    assert.match(source, /const \{ pending, refresh \} = useServerRefresh\(false, ''\);/);
    assert.match(
      source,
      /if \(!pause\) return null;\n {2}return \(\n {4}<Notice\n {6}tone="warning"\n {6}compact\n {6}announce="polite"\n {6}actions=\{<Button variant="ghost" size="sm" loading=\{pending\} onClick=\{refresh\}>Refresh<\/Button>\}\n {4}>\n {6}\{livePauseText\(pause\)\}\n {4}<\/Notice>\n {2}\);\n\}/,
    );
  });
});

describe('the overview page', () => {
  test('the server page takes its topics from the pass library and hands both islands the render time', () => {
    const page = read(PAGE_FILE);
    assert.doesNotMatch(page, /^\s*['"]use client['"]/);
    assert.match(page, /^import \{ realtimeTopicKeys \} from '\.\.\/\.\.\/lib\/realtimePass';$/m);
    assert.match(page, /^import AutoRefresh, \{ UpdatedStamp \} from '\.\/AutoRefresh';$/m);
    assert.match(page, /^ {2}const topics = realtimeTopicKeys\(\(permission\) => permissions\.has\(permission\)\);$/m);
    assert.ok(page.indexOf('const permissions = resolveAdminPermissions(admin);') < page.indexOf('const topics = '));
    assert.equal(count(page, '<AutoRefresh'), 1);
    assert.equal(count(page, '<UpdatedStamp'), 1);
  });

  test('the stamp sits beside the Refresh button, and the paused notice sits between the header and the figures', () => {
    const page = read(PAGE_FILE);
    assert.match(
      page,
      /actions=\{\n {10}<>\n {12}<UpdatedStamp topics=\{topics\} generatedAt=\{data\.generated_at\} \/>\n {12}<RefreshButton \/>\n {10}<\/>\n {8}\}\n {6}\/>\n\n {6}<AutoRefresh topics=\{topics\} generatedAt=\{data\.generated_at\} \/>\n\n {6}<div className=\{s\.bands\}>/,
    );
  });

  test('no copy on the overview promises a timed refresh or an automatic retry', () => {
    const page = read(PAGE_FILE);
    assert.doesNotMatch(page, /REFRESH_INTERVAL_MS|REFRESH_SECONDS|intervalMs|Refreshes automatically|retries on its own|keep retrying|every \$\{/);
    assert.match(page, /^const RECENT_ERROR = 'The latest card submissions could not be fetched\.';$/m);
    assert.match(page, /message="Every figure below shows as unavailable rather than zero\."/);
    assert.match(page, /stillFailing="Metrics are still unavailable\. Try again in a moment\."/);
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
