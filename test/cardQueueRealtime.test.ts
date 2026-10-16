import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type Context, type ElementType } from 'react';
import { loadAppModule, loadUi, render, textOf } from './support/uiHarness.ts';
import type { ApiResult } from '../app/lib/apiClient.ts';
import type { RealtimeSignal } from '../app/_ui/realtime/RealtimeSignals.tsx';
import type { ResourceEnvironment, ResourceStore } from '../app/_ui/useResource.ts';
import type { DecisionGate, QueueRefresh } from '../app/(dashboard)/card-queue/queueModel.ts';

type ModelModule = typeof import('../app/(dashboard)/card-queue/queueModel.ts');
type ResourceModule = typeof import('../app/_ui/useResource.ts');
type SignalsModule = typeof import('../app/_ui/realtime/RealtimeSignals.tsx');

const CARD_QUEUE_DIR = new URL('../app/(dashboard)/card-queue/', import.meta.url);
const OWNED = ['CardQueue.tsx', 'useQueueList.ts', 'queueModel.ts'];
const SUBMISSION_ID = '6f1c2b8e-0d0a-4f6e-9a51-3c2d4e5f6a7b';
const OTHER_ID = '0b8e7d6c-5a4b-4c3d-9e2f-1a0b9c8d7e6f';
const LIST_KEY = 'status=pending&sort=created_at&dir=desc&page=1&limit=50';
const RESYNC: RealtimeSignal = { kind: 'resync' };
const NO_REFRESH: QueueRefresh = { list: false, detail: false };

type Outcome = 'recorded' | 'changed' | 'denied' | 'refused' | 'signedOut';

const OUTCOMES: readonly Outcome[] = ['recorded', 'changed', 'denied', 'refused', 'signedOut'];

const nodeRequire = createRequire(import.meta.url);
const { AppRouterContext } = nodeRequire('next/dist/shared/lib/app-router-context.shared-runtime') as {
  AppRouterContext: Context<unknown>;
};
const { SearchParamsContext } = nodeRequire('next/dist/shared/lib/hooks-client-context.shared-runtime') as {
  SearchParamsContext: Context<URLSearchParams | null>;
};

const ROUTER = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
};

let model: ModelModule;
let resources: ResourceModule;

before(async () => {
  model = await loadAppModule<ModelModule>('(dashboard)/card-queue/queueModel.ts');
  resources = await loadUi<ResourceModule>('useResource.ts');
});

function change(id: string, status = 'approved'): RealtimeSignal {
  return { kind: 'signal', table: 'card_submissions', id, status };
}

function source(name: string): string {
  return readFileSync(new URL(name, CARD_QUEUE_DIR), 'utf8').replace(/\r\n/g, '\n');
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  assert.ok(from >= 0, start);
  const to = text.indexOf(end, from);
  assert.ok(to > from, end);
  return text.slice(from, to);
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface Clock {
  env: ResourceEnvironment;
  advance: (ms: number) => void;
}

function createClock(): Clock {
  let now = 1000;
  let sequence = 0;
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
      isHidden: () => false,
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
  };
}

interface Resource {
  store: ResourceStore<string>;
  requests: Array<(result: ApiResult<string>) => void>;
}

function resource(clock: Clock, pollMs: number): Resource {
  const requests: Array<(result: ApiResult<string>) => void> = [];
  const store = new resources.ResourceStore<string>(clock.env);
  store.setFetcher(() => new Promise<ApiResult<string>>((resolve) => {
    requests.push(resolve);
  }));
  store.setPollMs(pollMs);
  return { store, requests };
}

async function answer(target: Resource, data: string): Promise<void> {
  for (const resolve of target.requests) resolve({ ok: true, data, status: 200, requestId: 'req_ok' });
  await flush();
}

async function refuse(target: Resource, status: number): Promise<void> {
  for (const resolve of target.requests) {
    resolve({
      ok: false,
      error: {
        kind: 'http', status, code: null, message: `failed ${status}`, requestId: null, details: null, outcomeUnknown: false,
      },
    });
  }
  await flush();
}

interface Queue {
  clock: Clock;
  list: Resource;
  detail: Resource;
  gate: DecisionGate;
  live: boolean;
  refreshFor: (refresh: QueueRefresh) => void;
  hint: (signal: RealtimeSignal) => void;
}

async function openQueue(openId: string | null, live = true): Promise<Queue> {
  const clock = createClock();
  const list = resource(clock, model.pollFor(live));
  const detail = resource(clock, 0);
  const gate = new model.DecisionGate();
  list.store.start(LIST_KEY, true);
  detail.store.start(openId ? `submission:${openId}` : null, true);
  gate.setOpenId(openId);
  await answer(list, 'first page');
  await answer(detail, 'first detail');
  const refreshFor = (refresh: QueueRefresh) => {
    if (refresh.list) list.store.invalidate({ minGapMs: model.SIGNAL_GAP_MS });
    if (refresh.detail) detail.store.invalidate({ minGapMs: model.SIGNAL_GAP_MS });
  };
  return { clock, list, detail, gate, live, refreshFor, hint: (signal) => refreshFor(gate.signal(signal)) };
}

function sent(queue: Queue): { list: number; detail: number } {
  return { list: queue.list.requests.length, detail: queue.detail.requests.length };
}

async function decideLikeThePage(queue: Queue, outcome: Outcome, whileRecording: () => Promise<void>): Promise<Outcome> {
  if (!queue.gate.begin()) throw new Error('Another decision is still being recorded.');
  queue.list.store.setPollMs(model.pollFor(queue.live, true));
  try {
    await whileRecording();
    if (outcome === 'recorded') {
      queue.gate.settle(SUBMISSION_ID);
      const refreshed = queue.list.store.refresh();
      await answer(queue.list, 'after the decision');
      await refreshed;
      return outcome;
    }
    if (outcome === 'refused') throw new Error('The decision could not be saved.');
    if (outcome === 'signedOut') return outcome;
    if (outcome === 'changed') {
      queue.gate.settle(SUBMISSION_ID);
      const refreshed = Promise.all([queue.list.store.refresh(), queue.detail.store.refresh()]);
      await answer(queue.list, 'after the conflict');
      await answer(queue.detail, 'after the conflict');
      await refreshed;
    }
    return outcome;
  } finally {
    queue.refreshFor(queue.gate.end());
    queue.list.store.setPollMs(model.pollFor(queue.live));
  }
}

describe('card queue cadence and copy', () => {
  test('while live the queue polls every 120 s as a safety net, otherwise every 30 s, and never while a decision is recorded', () => {
    assert.equal(model.pollFor(true), 120000);
    assert.equal(model.pollFor(false), 30000);
    assert.equal(model.pollFor(true, true), 0);
    assert.equal(model.pollFor(false, true), 0);
    assert.equal(model.LIVE_POLL_MS, 120000);
    assert.equal(model.FALLBACK_POLL_MS, 30000);
  });

  test('signal loads start at least two seconds apart', () => {
    assert.equal(model.SIGNAL_GAP_MS, 2000);
  });

  test('the updated stamp says the queue updates live only while it does, and keeps today’s copy otherwise', () => {
    assert.equal(model.refreshNote(true), 'Updates live');
    assert.equal(model.refreshNote(false), 'Refreshes automatically every 30 seconds');
  });
});

describe('the decision gate', () => {
  test('outside a decision a change refreshes the list, and the open submission only when the change is about it', () => {
    const gate = new model.DecisionGate();
    assert.deepEqual(gate.signal(change(SUBMISSION_ID)), { list: true, detail: false });
    gate.setOpenId(SUBMISSION_ID);
    assert.deepEqual(gate.signal(change(SUBMISSION_ID)), { list: true, detail: true });
    assert.deepEqual(gate.signal(change(OTHER_ID, 'pending')), { list: true, detail: false });
    gate.setOpenId(null);
    assert.deepEqual(gate.signal(change(SUBMISSION_ID)), { list: true, detail: false });
  });

  test('a reconnect refreshes the list but never reloads the open submission, whose images would be signed again', () => {
    const gate = new model.DecisionGate();
    gate.setOpenId(SUBMISSION_ID);
    assert.deepEqual(gate.signal(RESYNC), { list: true, detail: false });
  });

  test('signals during a decision refresh nothing, and however many arrive the list is refreshed once when it ends', () => {
    const gate = new model.DecisionGate();
    assert.equal(gate.begin(), true);
    for (let index = 0; index < 10; index += 1) {
      assert.deepEqual(gate.signal(index % 3 === 0 ? RESYNC : change(OTHER_ID)), NO_REFRESH);
    }
    assert.deepEqual(gate.end(), { list: true, detail: false });
    assert.deepEqual(gate.end(), NO_REFRESH);
    assert.deepEqual(gate.signal(change(OTHER_ID)), { list: true, detail: false });
  });

  test('a decision with no signal ends with nothing owed, and only one decision runs at a time', () => {
    const gate = new model.DecisionGate();
    assert.equal(gate.begin(), true);
    assert.equal(gate.begin(), false);
    assert.deepEqual(gate.end(), NO_REFRESH);
    assert.equal(gate.begin(), true);
    assert.deepEqual(gate.end(), NO_REFRESH);
  });

  test('the open submission is owed a reload only for a change about it, judged by what is open when the decision ends', () => {
    const gate = new model.DecisionGate();
    gate.setOpenId(SUBMISSION_ID);
    gate.begin();
    gate.signal(change(OTHER_ID));
    assert.deepEqual(gate.end(), { list: true, detail: false });

    gate.begin();
    gate.signal(change(OTHER_ID));
    gate.setOpenId(OTHER_ID);
    assert.deepEqual(gate.end(), { list: true, detail: true });

    gate.begin();
    gate.signal(change(OTHER_ID));
    gate.setOpenId(null);
    assert.deepEqual(gate.end(), { list: true, detail: false });
  });

  test('ids match whatever their case, so a hint in capitals still reaches the open submission and a settled one stays settled', () => {
    const upper = SUBMISSION_ID.toUpperCase();
    const gate = new model.DecisionGate();
    gate.setOpenId(upper);
    assert.deepEqual(gate.signal(change(SUBMISSION_ID)), { list: true, detail: true });
    gate.setOpenId(SUBMISSION_ID);
    assert.deepEqual(gate.signal(change(upper)), { list: true, detail: true });

    gate.begin();
    gate.signal(change(upper));
    assert.deepEqual(gate.end(), { list: true, detail: true });

    gate.begin();
    gate.signal(change(upper));
    gate.settle(upper);
    assert.deepEqual(gate.end(), { list: true, detail: false });
  });

  test('settle counts only during a decision, only for the submission it names, and never leaks into the next one', () => {
    const gate = new model.DecisionGate();
    gate.setOpenId(SUBMISSION_ID);
    gate.settle(SUBMISSION_ID);
    gate.begin();
    gate.signal(change(SUBMISSION_ID));
    assert.deepEqual(gate.end(), { list: true, detail: true });

    gate.begin();
    gate.signal(change(SUBMISSION_ID));
    gate.settle(OTHER_ID);
    assert.deepEqual(gate.end(), { list: true, detail: true });

    gate.begin();
    gate.signal(change(SUBMISSION_ID));
    gate.settle(SUBMISSION_ID);
    assert.deepEqual(gate.end(), { list: true, detail: false });

    gate.begin();
    gate.signal(change(SUBMISSION_ID));
    assert.deepEqual(gate.end(), { list: true, detail: true });
  });
});

describe('signals against the real resource store', () => {
  test('ten changes in 100 ms reload the list twice, in the background, two seconds apart', async () => {
    const queue = await openQueue(null);
    const start = sent(queue);
    for (let index = 0; index < 10; index += 1) {
      queue.hint(change(OTHER_ID));
      queue.clock.advance(10);
    }
    assert.equal(queue.list.requests.length - start.list, 1);
    assert.equal(queue.list.store.getSnapshot().pending, 'background');
    await answer(queue.list, 'second page');
    queue.clock.advance(model.SIGNAL_GAP_MS - 101);
    await flush();
    assert.equal(queue.list.requests.length - start.list, 1);
    queue.clock.advance(1);
    await flush();
    assert.equal(queue.list.requests.length - start.list, 2);
    await answer(queue.list, 'third page');
    queue.clock.advance(model.SIGNAL_GAP_MS * 10);
    await flush();
    assert.equal(queue.list.requests.length - start.list, 2);
  });

  test('a change about the open submission reloads it once; changes about others and reconnects reload only the list', async () => {
    const queue = await openQueue(SUBMISSION_ID);
    const start = sent(queue);
    queue.hint(change(OTHER_ID));
    assert.deepEqual(sent(queue), { list: start.list + 1, detail: start.detail });
    await answer(queue.list, 'second page');
    queue.clock.advance(model.SIGNAL_GAP_MS);
    queue.hint(RESYNC);
    assert.deepEqual(sent(queue), { list: start.list + 2, detail: start.detail });
    await answer(queue.list, 'third page');
    queue.clock.advance(model.SIGNAL_GAP_MS);
    queue.hint(change(SUBMISSION_ID));
    assert.deepEqual(sent(queue), { list: start.list + 3, detail: start.detail + 1 });
    assert.equal(queue.detail.store.getSnapshot().pending, 'background');
  });

  test('for every outcome a change during the decision loads nothing until it ends, then exactly one more list load', async () => {
    for (const outcome of OUTCOMES) {
      const queue = await openQueue(SUBMISSION_ID);
      const start = sent(queue);
      const decision = decideLikeThePage(queue, outcome, async () => {
        queue.hint(change(OTHER_ID));
        queue.clock.advance(300);
        queue.hint(change(SUBMISSION_ID));
        queue.hint(RESYNC);
        await flush();
        assert.deepEqual(sent(queue), start, `${outcome}: nothing loads while the decision is recorded`);
      });
      if (outcome === 'refused') await assert.rejects(decision, /could not be saved/);
      else assert.equal(await decision, outcome);
      const own = outcome === 'recorded' || outcome === 'changed' ? 1 : 0;
      assert.equal(queue.list.requests.length - start.list, own + 1, `${outcome}: one list load follows the decision`);
      await answer(queue.list, 'after the follow-up');
      await answer(queue.detail, 'after the follow-up');
      queue.clock.advance(model.SIGNAL_GAP_MS * 10);
      await flush();
      assert.equal(queue.list.requests.length - start.list, own + 1, `${outcome}: and nothing after it`);
      const detail = outcome === 'changed' ? 1 : outcome === 'recorded' ? 0 : 1;
      assert.equal(queue.detail.requests.length - start.detail, detail, `${outcome}: the open submission`);
    }
  });

  test('a decision during which nothing changed ends without an extra load', async () => {
    const queue = await openQueue(SUBMISSION_ID);
    const start = sent(queue);
    await assert.rejects(decideLikeThePage(queue, 'refused', async () => {}), /could not be saved/);
    queue.clock.advance(model.SIGNAL_GAP_MS * 10);
    await flush();
    assert.deepEqual(sent(queue), start);
  });

  test('after a decision that ends signed out, the one follow-up meets the 401 and then nothing more is sent', async () => {
    const queue = await openQueue(SUBMISSION_ID);
    await decideLikeThePage(queue, 'signedOut', async () => {
      queue.hint(change(OTHER_ID));
    });
    const after = sent(queue);
    await refuse(queue.list, 401);
    queue.hint(change(OTHER_ID));
    queue.hint(RESYNC);
    queue.clock.advance(model.LIVE_POLL_MS * 3);
    await flush();
    assert.deepEqual(sent(queue), after);
    assert.equal(queue.list.store.getSnapshot().error?.status, 401);
  });

  test('the list polls every 120 s while live, every 30 s otherwise, and not at all while a decision is recorded', async () => {
    for (const [live, every] of [[true, 120000], [false, 30000]] as const) {
      const queue = await openQueue(null, live);
      const start = queue.list.requests.length;
      queue.clock.advance(every - 1);
      await flush();
      assert.equal(queue.list.requests.length, start, `live ${live}`);
      queue.clock.advance(1);
      await flush();
      assert.equal(queue.list.requests.length, start + 1, `live ${live}`);
    }
    const deciding = await openQueue(null);
    const start = deciding.list.requests.length;
    deciding.list.store.setPollMs(model.pollFor(true, true));
    deciding.clock.advance(model.LIVE_POLL_MS * 10);
    await flush();
    assert.equal(deciding.list.requests.length, start);
  });
});

describe('the card queue wiring', () => {
  test('the list hook takes the live flag and polls through pollFor', () => {
    const hook = source('useQueueList.ts');
    assert.match(
      hook,
      /export function useQueueList\(query: QueueQuery, paused: boolean, live: boolean\): UseResourceResult<QueueListResult> \{/,
    );
    assert.match(hook, /pollMs: pollFor\(live, paused\),/);
    assert.doesNotMatch(hook, /POLL_MS/);
  });

  test('the page takes the hook from the realtime kit folder, listens on the cards topic and passes live to the list', () => {
    const page = source('CardQueue.tsx');
    assert.match(page, /^import \{ useRealtimeSignal \} from '\.\.\/\.\.\/_ui\/realtime\/RealtimeSignals';$/m);
    assert.doesNotMatch(page, /@supabase|supabaseTransport|signalsCore/);
    assert.equal(count(page, 'useRealtimeSignal('), 1);
    assert.match(page, /const \{ live \} = useRealtimeSignal\('cards', \(signal\) => refreshFor\(gate\.signal\(signal\)\)\);\n {2}const list = useQueueList\(/);
    assert.match(page, /useQueueList\(\{ tab, search, from: range\.from, to: range\.to, page, sort \}, deciding, live\);/);
  });

  test('every signal becomes a coalesced invalidate, never a refresh, and the gate always knows the open submission', () => {
    const page = source('CardQueue.tsx');
    assert.match(page, /^const SIGNAL_REFRESH = \{ minGapMs: SIGNAL_GAP_MS \};$/m);
    assert.match(page, /const invalidateList = list\.invalidate;\n {2}const invalidateDetail = detail\.invalidate;/);
    assert.match(
      page,
      /const refreshFor = useCallback\(\(refresh: QueueRefresh\) => \{\n {4}if \(refresh\.list\) invalidateList\(SIGNAL_REFRESH\);\n {4}if \(refresh\.detail\) invalidateDetail\(SIGNAL_REFRESH\);\n {2}\}, \[invalidateDetail, invalidateList\]\);/,
    );
    assert.equal(count(page, 'invalidateList('), 1);
    assert.equal(count(page, 'invalidateDetail('), 1);
    assert.equal(count(page, '.invalidate'), 2);
    assert.match(page, /useEffect\(\(\) => \{\n {4}gate\.setOpenId\(openId\);\n {2}\}, \[gate, openId\]\);/);
  });

  test('both decision paths share the gate: one at a time, settled where the page closes or reloads the submission, released in finally', () => {
    const page = source('CardQueue.tsx');
    assert.doesNotMatch(page, /decidingRef/);
    assert.match(page, /const \[gate\] = useState\(\(\) => new DecisionGate\(\)\);/);
    assert.match(
      page,
      /const beginDecision = useCallback\(\(\): boolean => \{\n {4}if \(!gate\.begin\(\)\) return false;\n {4}setDeciding\(true\);\n {4}return true;\n {2}\}, \[gate\]\);/,
    );
    assert.match(
      page,
      /const endDecision = useCallback\(\(\) => \{\n {4}setDeciding\(false\);\n {4}refreshFor\(gate\.end\(\)\);\n {2}\}, \[gate, refreshFor\]\);/,
    );
    const run = between(page, 'const runDecision = useCallback(', '\n  }, [');
    const decide = between(page, 'const decide = useCallback(', '\n  }, [');
    assert.match(run, /^[^\n]*\n {4}if \(!beginDecision\(\)\) throw new Error\(BUSY_MESSAGE\);\n {4}try \{/);
    assert.match(decide, /^[^\n]*\n {4}if \(!beginDecision\(\)\) return;\n {4}try \{/);
    for (const body of [run, decide]) {
      assert.match(body, /\n {4}\} finally \{\n {6}endDecision\(\);\n {4}\}$/);
      assert.match(body, /if \(result\.ok\) \{\n {8}gate\.settle\(target\.id\);/);
      assert.equal(count(body, 'gate.settle(target.id);'), 2);
    }
    assert.match(
      run,
      /if \(kind === 'changed'\) \{\n {8}gate\.settle\(target\.id\);\n {8}await Promise\.all\(\[refreshList\(\), refreshDetail\(\)\]\);\n {6}\}/,
    );
    assert.match(decide, /\} else if \(kind === 'changed'\) \{\n {8}gate\.settle\(target\.id\);/);
    assert.equal(count(page, 'beginDecision()'), 2);
    assert.equal(count(page, 'endDecision();'), 2);
  });

  test('the updated stamp takes its copy from the model', () => {
    const page = source('CardQueue.tsx');
    assert.match(page, /<span className=\{s\.updated\} title=\{refreshNote\(live\)\}>/);
    assert.doesNotMatch(page, /every 30 seconds/);
  });

  test('the model imports types only, so the server page that imports it never pulls in the realtime client', () => {
    const imports = source('queueModel.ts').match(/^import\b.*$/gm) ?? [];
    assert.deepEqual(imports, [
      "import type { SortState, TableSkeletonColumn } from '../../_ui';",
      "import type { RealtimeSignal } from '../../_ui/realtime/RealtimeSignals';",
    ]);
  });

  test('the page still renders inside the router, confirm and realtime providers, for the list and an opened submission', async () => {
    const { CardQueue } = await loadAppModule<{ CardQueue: ElementType }>('(dashboard)/card-queue/CardQueue.tsx');
    const signals = await loadAppModule<SignalsModule>('_ui/realtime/RealtimeSignals.tsx');
    const { ConfirmProvider } = await loadUi<{ ConfirmProvider: ElementType }>('Confirm.tsx');
    const inPage = (query: string) => textOf(render(createElement(
      AppRouterContext.Provider,
      { value: ROUTER },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams(query) },
        createElement(ConfirmProvider, {
          children: createElement(signals.RealtimeSignalsProvider, { children: createElement(CardQueue) }),
        }),
      ),
    )));
    const list = inPage('');
    assert.match(list, /Card queue/);
    assert.match(list, /Loading Card submissions/);
    assert.doesNotMatch(list, /Updated/);
    assert.match(inPage(`id=${SUBMISSION_ID}`), /Loading submission/);
  });
});

describe('house rules for the card queue realtime wiring', () => {
  test('the owned sources and this suite carry no prose comments', () => {
    for (const name of OWNED) assert.doesNotMatch(source(name), /\/\*|(^|[^:])\/\/(?!\/)/m, name);
    assert.doesNotMatch(readFileSync(new URL(import.meta.url), 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m);
  });
});
