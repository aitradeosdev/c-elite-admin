import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAppModule, loadUi } from './support/uiHarness.ts';
import * as model from '../app/(dashboard)/withdrawals/model.ts';
import {
  SIGNAL_GAP_MS, invalidateOnSignal, signalReachesDetail, subtitleFor, type SignalTarget,
} from '../app/(dashboard)/withdrawals/model.ts';
import type { RealtimeSignal, SignalChange } from '../app/_ui/realtime/RealtimeSignals.tsx';
import type { ResourceEnvironment, ResourceInvalidateOptions, ResourceStore } from '../app/_ui/useResource.ts';
import type { ApiResult } from '../app/lib/apiClient.ts';

type ResourceModule = typeof import('../app/_ui/useResource.ts');

const PAGE_DIR = fileURLToPath(new URL('../app/(dashboard)/withdrawals/', import.meta.url));
const PAGE_FILE = join(PAGE_DIR, 'page.tsx');
const MODEL_FILE = join(PAGE_DIR, 'model.ts');
const TEST_FILE = fileURLToPath(import.meta.url);

const OPEN_ID = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';
const OTHER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const FLAG_ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const RESYNC: RealtimeSignal = { kind: 'resync' };
const GAP: ResourceInvalidateOptions = { minGapMs: 1000 };
const HOUR_MS = 60 * 60 * 1000;

let mod: ResourceModule;

before(async () => {
  mod = await loadUi<ResourceModule>('useResource.ts');
});

function changed(id: string, status = 'processing'): SignalChange {
  return { kind: 'signal', table: 'withdrawals', id, status };
}

function flagged(withdrawalId: string, id = FLAG_ID): SignalChange {
  return { kind: 'signal', table: 'flagged_transactions', id, status: 'cleared', withdrawalId };
}

interface Recorder extends SignalTarget {
  calls: Array<ResourceInvalidateOptions | undefined>;
}

function recorder(): Recorder {
  const calls: Array<ResourceInvalidateOptions | undefined> = [];
  return {
    calls,
    invalidate: (options) => {
      calls.push(options);
    },
  };
}

interface Clock {
  env: ResourceEnvironment;
  hidden: boolean;
  advance: (ms: number) => void;
  timers: () => number;
}

function createClock(): Clock {
  let now = 1000;
  let sequence = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const clock: Clock = {
    hidden: false,
    env: {
      now: () => now,
      setTimer: (callback, ms) => {
        sequence += 1;
        pending.set(sequence, { at: now + ms, callback });
        return sequence;
      },
      clearTimer: (handle) => {
        pending.delete(handle as number);
      },
      isHidden: () => clock.hidden,
    },
    advance: (ms) => {
      now += ms;
      const due = [...pending].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [id, timer] of due) {
        if (!pending.has(id)) continue;
        pending.delete(id);
        timer.callback();
      }
    },
    timers: () => pending.size,
  };
  return clock;
}

interface Resource {
  store: ResourceStore<string>;
  calls: Array<(result: ApiResult<string>) => void>;
}

function resource(clock: Clock): Resource {
  const calls: Array<(result: ApiResult<string>) => void> = [];
  const store = new mod.ResourceStore<string>(clock.env);
  store.setFetcher(() => new Promise<ApiResult<string>>((resolve) => {
    calls.push(resolve);
  }));
  return { store, calls };
}

function mount(openId: string | null) {
  const clock = createClock();
  const list = resource(clock);
  const detail = resource(clock);
  list.store.start('review=1&page=1&limit=50', true);
  detail.store.start(openId ? `withdrawal:${openId}` : null, true);
  const hint = (signal: RealtimeSignal) => invalidateOnSignal(signal, openId, list.store, detail.store);
  return { clock, list, detail, hint };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function answer(target: Resource, data: string): Promise<void> {
  for (const resolve of target.calls) resolve({ ok: true, data, status: 200, requestId: 'req_ok' });
  await flush();
}

async function refuse(target: Resource, status: number): Promise<void> {
  for (const resolve of target.calls) {
    resolve({
      ok: false,
      error: { kind: 'http', status, code: null, message: `failed ${status}`, requestId: null, details: null, outcomeUnknown: false },
    });
  }
  await flush();
}

function read(file: string): string {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function block(source: string, start: string): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, start);
  return source.slice(from, source.indexOf('\n}\n', from) + 2);
}

describe('withdrawals without timers', () => {
  test('the model keeps no polling cadence at all', () => {
    for (const name of ['LIVE_POLL_MS', 'FALLBACK_POLL_MS', 'pollFor']) assert.equal(name in model, false, name);
  });

  test('signal loads start at least a second apart', () => {
    assert.equal(SIGNAL_GAP_MS, 1000);
  });

  test('the subtitle says the page updates live only while it does, and never names a refresh interval', () => {
    assert.equal(subtitleFor(true), 'Payout queue across every status. Updates live; times are WAT.');
    assert.equal(subtitleFor(false), 'Payout queue across every status. Times are WAT.');
    for (const live of [true, false]) assert.doesNotMatch(subtitleFor(live), /refresh|every \d|second/i);
  });
});

describe('which resources a hint reloads', () => {
  test('every hint reloads the list once, with the one-second gap, whatever is open', () => {
    for (const hint of [changed(OTHER_ID), changed(OPEN_ID), flagged(OTHER_ID), flagged(OPEN_ID), RESYNC]) {
      for (const openId of [null, OPEN_ID]) {
        const list = recorder();
        const detail = recorder();
        invalidateOnSignal(hint, openId, list, detail);
        assert.deepEqual(list.calls, [GAP], JSON.stringify({ hint, openId }));
        assert.ok(detail.calls.every((options) => options?.minGapMs === 1000));
      }
    }
  });

  test('the drawer reloads only for its own withdrawal, its flags, or a resync', () => {
    const cases: Array<[string, RealtimeSignal, string | null, boolean]> = [
      ['closed drawer, a change', changed(OPEN_ID), null, false],
      ['closed drawer, a flag', flagged(OPEN_ID), null, false],
      ['closed drawer, a resync', RESYNC, null, false],
      ['open drawer, its own change', changed(OPEN_ID), OPEN_ID, true],
      ['open drawer, a flag on it', flagged(OPEN_ID), OPEN_ID, true],
      ['open drawer, a resync', RESYNC, OPEN_ID, true],
      ['open drawer, another withdrawal', changed(OTHER_ID), OPEN_ID, false],
      ['open drawer, a flag on another withdrawal', flagged(OTHER_ID), OPEN_ID, false],
      ['open drawer, a hint whose own id is the open one', flagged(OTHER_ID, OPEN_ID), OPEN_ID, true],
      ['open drawer, its change in capitals', changed(OPEN_ID.toUpperCase()), OPEN_ID, true],
      ['open drawer, its flag in capitals', flagged(OPEN_ID.toUpperCase()), OPEN_ID, true],
    ];
    for (const [label, hint, openId, reaches] of cases) {
      assert.equal(signalReachesDetail(hint, openId), reaches, label);
      const list = recorder();
      const detail = recorder();
      invalidateOnSignal(hint, openId, list, detail);
      assert.deepEqual(detail.calls, reaches ? [GAP] : [], label);
    }
  });
});

describe('hints against the real resource store', () => {
  test('ten hints in 100 ms reload the list twice and never touch a closed drawer', async () => {
    const { clock, list, detail, hint } = mount(null);
    await answer(list, 'first');
    for (let index = 0; index < 10; index += 1) {
      hint(changed(OTHER_ID));
      clock.advance(10);
    }
    await answer(list, 'second');
    clock.advance(2000);
    await answer(list, 'third');
    clock.advance(HOUR_MS);
    assert.equal(list.calls.length, 3);
    assert.equal(detail.calls.length, 0);
    assert.equal(list.store.getSnapshot().data, 'third');
  });

  test('a change to the open withdrawal reloads the list and the drawer once each, in the background', async () => {
    const { list, detail, hint } = mount(OPEN_ID);
    await answer(list, 'list');
    await answer(detail, 'drawer');
    hint(changed(OPEN_ID));
    assert.equal(list.calls.length, 2);
    assert.equal(detail.calls.length, 2);
    assert.equal(list.store.getSnapshot().pending, 'background');
    assert.equal(detail.store.getSnapshot().pending, 'background');
    assert.equal(detail.store.getSnapshot().data, 'drawer');
    await answer(detail, 'fresh drawer');
    assert.equal(detail.store.getSnapshot().data, 'fresh drawer');
  });

  test('a flag on the open withdrawal reaches the drawer, and hints about others reload only the list', async () => {
    const { clock, list, detail, hint } = mount(OPEN_ID);
    await answer(list, 'a');
    await answer(detail, 'a');
    hint(flagged(OPEN_ID));
    assert.equal(detail.calls.length, 2);
    await answer(list, 'b');
    await answer(detail, 'b');
    hint(changed(OTHER_ID));
    hint(flagged(OTHER_ID));
    clock.advance(999);
    assert.equal(list.calls.length, 2);
    clock.advance(1);
    assert.equal(list.calls.length, 3);
    await answer(list, 'c');
    clock.advance(HOUR_MS);
    assert.equal(list.calls.length, 3);
    assert.equal(detail.calls.length, 2);
  });

  test('a resync, which every reconnect sends, reloads the list once, and the drawer when one is open', async () => {
    for (const openId of [null, OPEN_ID]) {
      const { clock, list, detail, hint } = mount(openId);
      await answer(list, 'a');
      await answer(detail, 'a');
      hint(RESYNC);
      assert.equal(list.calls.length, 2, String(openId));
      assert.equal(detail.calls.length, openId ? 2 : 0, String(openId));
      await answer(list, 'b');
      await answer(detail, 'b');
      clock.advance(HOUR_MS);
      assert.equal(list.calls.length, 2, String(openId));
      assert.equal(detail.calls.length, openId ? 2 : 0, String(openId));
    }
  });

  test('a hint while the first load is in flight is answered by exactly one follow-up', async () => {
    const { clock, list, hint } = mount(null);
    hint(RESYNC);
    hint(changed(OTHER_ID));
    assert.equal(list.calls.length, 1);
    await answer(list, 'a');
    assert.equal(list.calls.length, 2);
    await answer(list, 'b');
    clock.advance(HOUR_MS);
    assert.equal(list.calls.length, 2);
  });

  test('after a 401 or a 403 the page sends nothing more for hints', async () => {
    for (const status of [401, 403]) {
      const { clock, list, detail, hint } = mount(OPEN_ID);
      await refuse(list, status);
      await refuse(detail, status);
      hint(changed(OPEN_ID));
      hint(RESYNC);
      clock.advance(HOUR_MS);
      assert.equal(list.calls.length, 1, String(status));
      assert.equal(detail.calls.length, 1, String(status));
    }
  });

  test('with no hint the list and the drawer never load again, and no timer is left armed, whether the tab is shown or hidden', async () => {
    for (const hidden of [false, true]) {
      const { clock, list, detail } = mount(OPEN_ID);
      await answer(list, 'a');
      await answer(detail, 'a');
      clock.hidden = hidden;
      list.store.visibilityChanged();
      detail.store.visibilityChanged();
      assert.equal(clock.timers(), 0, `hidden ${hidden}`);
      clock.advance(HOUR_MS * 8);
      assert.equal(list.calls.length, 1, `hidden ${hidden}`);
      assert.equal(detail.calls.length, 1, `hidden ${hidden}`);
      assert.equal(clock.timers(), 0, `hidden ${hidden}`);
    }
  });

  test('a failed list load is not retried on a timer; the next hint or the Refresh button loads it again', async () => {
    const { clock, list, hint } = mount(null);
    await answer(list, 'a');
    hint(changed(OTHER_ID));
    await refuse(list, 500);
    clock.advance(HOUR_MS);
    assert.equal(list.calls.length, 2);
    assert.equal(clock.timers(), 0);
    clock.advance(SIGNAL_GAP_MS);
    hint(changed(OTHER_ID));
    assert.equal(list.calls.length, 3);
    await answer(list, 'b');
    const refreshed = list.store.refresh();
    assert.equal(list.calls.length, 4);
    await answer(list, 'c');
    await refreshed;
    assert.equal(list.store.getSnapshot().data, 'c');
  });

  test('a hint heard while the tab is hidden waits for the tab to return, then loads once', async () => {
    const { clock, list, hint } = mount(null);
    await answer(list, 'a');
    clock.hidden = true;
    hint(changed(OTHER_ID));
    hint(changed(OTHER_ID));
    clock.advance(HOUR_MS);
    assert.equal(list.calls.length, 1);
    clock.hidden = false;
    list.store.visibilityChanged();
    assert.equal(list.calls.length, 2);
    await answer(list, 'b');
    clock.advance(HOUR_MS);
    assert.equal(list.calls.length, 2);
  });
});

describe('the withdrawals page wiring', () => {
  test('the page module links, so every name it takes from the model and the realtime kit exists', async () => {
    const pageModule = await loadAppModule<{ default: unknown }>('(dashboard)/withdrawals/page.tsx');
    assert.equal(typeof pageModule.default, 'function');
  });

  test('the page takes the hooks and the wording from the realtime kit folder and never imports supabase-js', () => {
    const page = read(PAGE_FILE);
    assert.ok(page.startsWith("'use client';\n"));
    assert.match(
      page,
      /^import \{ livePauseText, useRealtimeSignal, useRealtimeStatus \} from '\.\.\/\.\.\/_ui\/realtime\/RealtimeSignals';$/m,
    );
    assert.doesNotMatch(page, /@supabase|supabaseTransport|signalsCore|lib\/realtimePass|lib\/supabase/);
  });

  test('the page listens on the withdrawals topic once, reads its status once, before the list, and hands every hint to the model', () => {
    const page = read(PAGE_FILE);
    const call = "  useRealtimeSignal('withdrawals', (hint) => invalidateOnSignal(hint, openId, list, detail));\n";
    const status = "  const { live, pause } = useRealtimeStatus('withdrawals');\n";
    assert.equal(count(page, call), 1);
    assert.equal(count(page, status), 1);
    assert.ok(page.includes(call + status));
    assert.equal(count(page, 'useRealtimeSignal('), 1);
    assert.equal(count(page, 'useRealtimeStatus('), 1);
    assert.ok(page.indexOf(status) < page.indexOf('const list = useResource('));
    assert.ok(page.indexOf('const list = useResource(') < page.indexOf('const detail = useResource('));
    assert.equal(count(page, '(hint)'), 1);
    assert.doesNotMatch(page, /\bhint\.|\bsignal\.(?:id|status|table|withdrawalId|kind)\b/);
  });

  test('neither the list nor the drawer polls, in any state', () => {
    const page = read(PAGE_FILE);
    assert.doesNotMatch(page, /pollMs|pollFor|setInterval|POLL_MS/);
    assert.match(page, /select: toListResult,\s*\}\),\s*\{ keepPreviousData: sameTabFilter \},\s*\);/);
    const start = page.indexOf('const detail = useResource(');
    const detail = page.slice(start, page.indexOf('\n  );', start));
    assert.match(detail, /\{ keepPreviousData: false \},$/);
    assert.doesNotMatch(page, /\bSUBTITLE\b/);
  });

  test('the header copy comes from the model in every state, and the fallback never claims to be live', () => {
    const page = read(PAGE_FILE);
    assert.doesNotMatch(page, /Refreshes every|Updates live/);
    assert.equal(count(page, 'subtitleFor('), 3);
    assert.equal(count(page, 'subtitle={subtitleFor(live)}'), 2);
    const fallback = page.slice(page.indexOf('function QueueFallback()'), page.indexOf('function WithdrawalsQueue()'));
    assert.match(fallback, /<PageHeader title="Withdrawals" subtitle=\{subtitleFor\(false\)\} \/>/);
    assert.match(page, /if \(denied\) \{\s*return \(\s*<div>\s*<PageHeader title="Withdrawals" subtitle=\{subtitleFor\(live\)\} \/>/);
  });

  test('while live updates are paused the page says why under its header, with a Refresh that reloads the list and the open withdrawal', () => {
    const page = read(PAGE_FILE);
    const notice = [
      '      {pause && !listError ? (',
      '        <Notice',
      '          tone="warning"',
      '          compact',
      '          announce="polite"',
      '          meta={refreshedAt ? `Showing results from ${formatBusinessTime(new Date(refreshedAt))} WAT.` : undefined}',
      '          actions={<Button variant="ghost" size="sm" loading={list.isRefreshing} onClick={refreshNow}>Refresh</Button>}',
      '        >',
      '          {livePauseText(pause)}',
      '        </Notice>',
      '      ) : null}',
    ].join('\n');
    assert.equal(count(page, notice), 1);
    const header = page.indexOf('      <PageHeader\n        title="Withdrawals"');
    assert.ok(header > 0);
    const between = page.slice(page.indexOf('\n      />\n', header) + '\n      />\n'.length, page.indexOf(notice));
    assert.equal(between.trim(), '');
    assert.ok(page.indexOf(notice) < page.indexOf('{emergencyOn ? <EmergencyNotice'));
    assert.equal(count(page, 'livePauseText('), 1);
    assert.match(
      page,
      /const refreshNow = useCallback\(\(\) => \{\n {4}void refreshList\(\);\n {4}void refreshDetail\(\);\n {2}\}, \[refreshDetail, refreshList\]\);/,
    );
    assert.equal(count(page, 'onClick={refreshNow}'), 2);
  });

  test('the header always offers a Refresh that reloads the list and the open withdrawal, live or not', () => {
    const page = read(PAGE_FILE);
    const header = page.slice(page.indexOf('      <PageHeader\n        title="Withdrawals"'), page.indexOf('{pause && !listError ? ('));
    assert.match(
      header,
      /actions=\{\n\s+<>\n\s+<Button\n\s+variant="secondary"\n\s+size="sm"\n\s+leftIcon=\{<RotateCw size=\{14\} \/>\}\n\s+loading=\{list\.isRefreshing\}\n\s+onClick=\{refreshNow\}\n\s+>\n\s+Refresh\n\s+<\/Button>\n\s+\{canExport \? \(/,
    );
    assert.doesNotMatch(header, /live \?|pause \?/);
  });

  test('a failed list load keeps its own Live updates paused notice, so the two notices never stack', () => {
    const page = read(PAGE_FILE);
    assert.match(
      page,
      /\{listError && rows\.length > 0 \? \(\s*<Notice\s+tone="warning"\s+compact\s+announce="polite"\s+meta=\{refreshedAt \? `Showing results from \$\{formatBusinessTime\(new Date\(refreshedAt\)\)\} WAT\.` : undefined\}\s+actions=\{<Button variant="ghost" size="sm" onClick=\{retryList\}>Retry now<\/Button>\}\s*>\s*Live updates paused\. \{listError\.message\}\s*<\/Notice>/,
    );
    assert.match(page, /\{pause && !listError \? \(/);
  });

  test('the drawer status sync, the fresh read before deciding and the refusal handling are unchanged', () => {
    const page = read(PAGE_FILE);
    assert.match(
      page,
      /if \(!shown \|\| !match \|\| match\.status === shown\.status\) return;[\s\S]*?syncedRef\.current = mark;\s*void refreshDetail\(\{ background: true \}\);\s*\}, \[list\.data, detail\.data, refreshDetail\]\);/,
    );
    assert.equal(count(page, 'await readActionable(id)'), 2);
    assert.match(page, /const readActionable = async \(id: string\): Promise<DetailResult \| null> => \{\s*const result = await apiRequest\('\/api\/withdrawals', \{ query: \{ id \}, select: toDetail \}\);/);
    assert.match(page, /const reportRefusal = \(message: string, status: number \| null\) => \{\s*toast\.show\(message, 'error'\);\s*if \(status === 403\) router\.refresh\(\);\s*\};/);
  });

  test('the after-decision refresh still reloads the list and the drawer in the background', () => {
    const page = read(PAGE_FILE);
    assert.match(
      page,
      /const refreshAfterDecision = \(\) => \{\n {4}void refreshList\(\{ background: true \}\);\n {4}void refreshDetail\(\{ background: true \}\);\n {2}\};/,
    );
    assert.match(page, /Promise\.all\(\[refreshList\(\{ background: true \}\), refreshDetail\(\{ background: true \}\)\]\)/);
  });

  test('the model only invalidates, reads nothing from a hint but its kind and ids, and imports types only', () => {
    const source = read(MODEL_FILE);
    const imports = [...source.matchAll(/^import\b.*$/gm)].map((match) => match[0]);
    assert.ok(imports.length >= 2);
    for (const line of imports) assert.match(line, /^import type \{/, line);
    assert.ok(imports.includes("import type { RealtimeSignal } from '../../_ui/realtime/RealtimeSignals';"));
    const helpers = block(source, 'export function signalReachesDetail(') + block(source, 'export function invalidateOnSignal(');
    assert.deepEqual([...new Set([...helpers.matchAll(/\bsignal\.(\w+)/g)].map((match) => match[1]))].sort(), ['id', 'kind', 'withdrawalId']);
    const invalidate = block(source, 'export function invalidateOnSignal(');
    assert.equal(count(invalidate, '.invalidate({ minGapMs: SIGNAL_GAP_MS })'), 2);
    assert.doesNotMatch(invalidate, /refresh|mutate|load\(/);
  });
});

describe('house rules for the withdrawals realtime wiring', () => {
  test('this suite carries no prose comments', () => {
    assert.doesNotMatch(read(TEST_FILE), /\/\*|(^|[^:])\/\/(?!\/)/m);
  });
});
