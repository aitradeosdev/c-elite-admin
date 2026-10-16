import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { loadUi, render } from './support/uiHarness.ts';
import type { ApiFailureKind, ApiResult } from '../app/lib/apiClient.ts';
import type {
  ChannelStatus, SignalPause, SignalStatus, SignalsEngine, SignalsEnvironment, SignalsTransport, SignalTopic,
} from '../app/_ui/realtime/signalsCore.ts';

type CoreModule = typeof import('../app/_ui/realtime/signalsCore.ts');
type SignalsModule = typeof import('../app/_ui/realtime/RealtimeSignals.tsx');

const ADMIN_DIR = fileURLToPath(new URL('../', import.meta.url));
const APP_DIR = join(ADMIN_DIR, 'app');
const PROVIDER_FILE = join(APP_DIR, '_ui', 'realtime', 'RealtimeSignals.tsx');
const RESOURCE_FILE = join(APP_DIR, '_ui', 'useResource.ts');
const PAGES_DIR = join(APP_DIR, '(dashboard)');
const WITHDRAWALS_PAGE = join(PAGES_DIR, 'withdrawals', 'page.tsx');
const CARD_QUEUE_PAGE = join(PAGES_DIR, 'card-queue', 'CardQueue.tsx');
const OVERVIEW_ISLAND = join(PAGES_DIR, 'dashboard', 'AutoRefresh.tsx');
const REALTIME_PAGE_FILES = [
  WITHDRAWALS_PAGE,
  join(PAGES_DIR, 'withdrawals', 'model.ts'),
  CARD_QUEUE_PAGE,
  join(PAGES_DIR, 'card-queue', 'queueModel.ts'),
  join(PAGES_DIR, 'card-queue', 'useQueueList.ts'),
  OVERVIEW_ISLAND,
  join(PAGES_DIR, 'dashboard', 'page.tsx'),
  join(PAGES_DIR, 'dashboard', 'metrics.tsx'),
  join(PAGES_DIR, '_shell', 'NavCounts.tsx'),
  join(APP_DIR, 'api', 'nav-counts', 'route.ts'),
];
const TEST_FILE = fileURLToPath(import.meta.url);
const STATIC_IMPORT_RE = /^(?:import|export)\s+(type\s+)?([^;'"]*?)\s*\bfrom\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]/gm;

const SUPABASE_URL = 'https://project.supabase.test';
const PUBLISHABLE_KEY = 'sb_publishable_liveUpdatesTestKey0123456789';
const BOTH_TOPICS = ['admin:withdrawals', 'admin:cards'] as const;
const DENIED = 'Unauthorized: You do not have permissions to read from this Channel topic: admin:cards';
const SIGNATURE_REFUSAL = 'JwtSignatureError: Failed to validate JWT signature';
const ISSUED_AT = 1_760_000_000;
const HOUR_MS = 60 * 60 * 1000;
const PAUSES: readonly SignalPause[] = ['reconnecting', 'disabled', 'stopped'];

let core: CoreModule;
let signals: SignalsModule;

before(async () => {
  core = await loadUi<CoreModule>('realtime/signalsCore.ts');
  signals = await loadUi<SignalsModule>('realtime/RealtimeSignals.tsx');
});

function read(file: string): string {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function rel(file: string): string {
  return relative(ADMIN_DIR, file).split(sep).join('/');
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  assert.ok(from >= 0, start);
  const to = text.indexOf(end, from);
  assert.ok(to > from, end);
  return text.slice(from, to);
}

function staticImports(source: string): string[] {
  const out: string[] = [];
  for (const [, typeOnly, clause, from, bare] of source.matchAll(STATIC_IMPORT_RE)) {
    if (bare) {
      out.push(bare);
      continue;
    }
    if (typeOnly) continue;
    const named = clause.match(/^\{([^}]*)\}$/);
    const parts = named ? named[1].split(',').map((part) => part.trim()).filter(Boolean) : [];
    if (named && parts.length > 0 && parts.every((part) => part.startsWith('type '))) continue;
    out.push(from);
  }
  return out;
}

async function settle(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>((done) => setImmediate(done));
  }
}

interface Clock {
  readonly env: SignalsEnvironment;
  hidden: boolean;
  advance: (ms: number) => Promise<void>;
  setHidden: (hidden: boolean) => void;
  timers: () => number;
}

function createClock(): Clock {
  let now = 1000;
  let sequence = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const visibility = new Set<() => void>();
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
      onVisibility: (callback) => {
        visibility.add(callback);
        return () => {
          visibility.delete(callback);
        };
      },
    },
    advance: async (ms) => {
      const target = now + ms;
      await settle();
      for (;;) {
        const due = [...pending]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (due.length === 0) break;
        const [id, timer] = due[0];
        pending.delete(id);
        now = Math.max(now, timer.at);
        timer.callback();
        await settle();
      }
      now = target;
      await settle();
    },
    setHidden: (hidden) => {
      clock.hidden = hidden;
      for (const callback of Array.from(visibility)) callback();
    },
    timers: () => pending.size,
  };
  return clock;
}

interface JoinRecord {
  topic: string;
  onStatus: (status: ChannelStatus, reason: string | null) => void;
}

class FakeTransport implements SignalsTransport {
  readonly joins: JoinRecord[] = [];

  async connect(): Promise<void> {}

  async setAuth(): Promise<void> {}

  join(topic: string, onMessage: (payload: unknown) => void, onStatus: JoinRecord['onStatus']): void {
    this.joins.push({ topic, onStatus });
  }

  async leave(): Promise<void> {}

  async disconnect(): Promise<void> {}

  joinsOf(topic: string): JoinRecord[] {
    return this.joins.filter((entry) => entry.topic === topic);
  }

  latest(topic: string): JoinRecord {
    const found = this.joinsOf(topic).at(-1);
    assert.ok(found, `no join for ${topic}`);
    return found;
  }
}

interface Harness {
  engine: SignalsEngine;
  clock: Clock;
  transport: FakeTransport;
  requests: () => number;
  answer: (result: ApiResult<unknown>) => Promise<void>;
}

function setup(options: { loadFails?: boolean } = {}): Harness {
  const clock = createClock();
  const transport = new FakeTransport();
  const waiting: Array<(result: ApiResult<unknown>) => void> = [];
  let requests = 0;
  const engine = new core.SignalsEngine({
    environment: clock.env,
    fetchPass: () => {
      requests += 1;
      return new Promise<ApiResult<unknown>>((done) => {
        waiting.push(done);
      });
    },
    loadTransport: async () => {
      if (options.loadFails) throw new Error('chunk failed to load');
      return transport;
    },
  });
  return {
    engine,
    clock,
    transport,
    requests: () => requests,
    answer: async (result) => {
      const next = waiting.shift();
      assert.ok(next, 'a pass request is waiting');
      next(result);
      await settle();
    },
  };
}

let minted = 0;

function granted(topics: readonly string[] = BOTH_TOPICS): ApiResult<unknown> {
  minted += 1;
  return {
    ok: true,
    status: 200,
    requestId: 'req_pass',
    data: {
      success: true,
      enabled: true,
      url: SUPABASE_URL,
      key: PUBLISHABLE_KEY,
      token: `eyJhbGciOiJIUzI1NiJ9.cGFzcw${minted}.c2lnbmF0dXJl${minted}`,
      issued_at: ISSUED_AT,
      expires_at: ISSUED_AT + 300,
      topics: [...topics],
    },
  };
}

function switchedOff(): ApiResult<unknown> {
  return { ok: true, status: 200, requestId: 'req_pass', data: { success: true, enabled: false } };
}

function withoutKey(): ApiResult<unknown> {
  const pass = granted();
  assert.ok(pass.ok);
  return { ...pass, data: { ...(pass.data as Record<string, unknown>), key: '' } };
}

function failure(status: number | null, kind: ApiFailureKind = 'http'): ApiResult<unknown> {
  return {
    ok: false,
    error: { kind, status, code: null, message: `failed ${status ?? kind}`, requestId: null, details: null, outcomeUnknown: false },
  };
}

function look(h: Harness, topic: SignalTopic): [SignalStatus, SignalPause | null] {
  return [h.engine.status(topic), h.engine.pause(topic)];
}

async function goLive(h: Harness, topics: readonly SignalTopic[]): Promise<void> {
  for (const topic of topics) h.engine.subscribe(topic, () => {});
  await settle();
  await h.answer(granted());
  for (const topic of topics) h.transport.latest(core.SIGNAL_TOPICS[topic]).onStatus('SUBSCRIBED', null);
  await settle();
  for (const topic of topics) assert.deepEqual(look(h, topic), ['live', null], topic);
}

describe('why live updates are paused', () => {
  test('nothing is paused before a page listens, while the first connection is made, or while live', async () => {
    const h = setup();
    assert.deepEqual(look(h, 'cards'), ['off', null]);
    h.engine.subscribe('cards', () => {});
    await settle();
    assert.deepEqual(look(h, 'cards'), ['connecting', null]);
    await h.answer(granted());
    assert.deepEqual(look(h, 'cards'), ['connecting', null]);
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    await settle();
    assert.deepEqual(look(h, 'cards'), ['live', null]);
  });

  test('a channel that closes, times out or errors is reconnecting until it is joined again', async () => {
    const failures: Array<[ChannelStatus, string | null]> = [
      ['CLOSED', null], ['TIMED_OUT', null], ['CHANNEL_ERROR', null], ['CHANNEL_ERROR', SIGNATURE_REFUSAL],
    ];
    for (const [status, reason] of failures) {
      const label = `${status} ${reason ?? ''}`;
      const h = setup();
      await goLive(h, ['cards']);
      h.transport.latest('admin:cards').onStatus(status, reason);
      await settle();
      assert.deepEqual(look(h, 'cards'), ['fallback', 'reconnecting'], label);
      await h.clock.advance(2000);
      assert.equal(h.transport.joinsOf('admin:cards').length, 2, label);
      assert.deepEqual(look(h, 'cards'), ['fallback', 'reconnecting'], label);
      h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
      await settle();
      assert.deepEqual(look(h, 'cards'), ['live', null], label);
    }
  });

  test('an unreachable pass route is reconnecting while the engine keeps asking', async () => {
    const answers = [failure(500), failure(503), failure(429), failure(null, 'network'), failure(null, 'timeout')];
    for (const answer of answers) {
      const label = JSON.stringify(answer);
      const h = setup();
      h.engine.subscribe('withdrawals', () => {});
      await settle();
      await h.answer(answer);
      assert.deepEqual(look(h, 'withdrawals'), ['fallback', 'reconnecting'], label);
      await h.clock.advance(5000);
      assert.equal(h.requests(), 2, label);
      await h.answer(granted());
      h.transport.latest('admin:withdrawals').onStatus('SUBSCRIBED', null);
      await settle();
      assert.deepEqual(look(h, 'withdrawals'), ['live', null], label);
    }
  });

  test('missing settings or an unusable pass answer turn live updates off for every page, pages opened later included', async () => {
    for (const answer of [switchedOff(), withoutKey(), failure(404), failure(400)]) {
      const label = JSON.stringify(answer);
      const h = setup();
      h.engine.subscribe('cards', () => {});
      await settle();
      await h.answer(answer);
      assert.deepEqual(look(h, 'cards'), ['fallback', 'disabled'], label);
      h.engine.subscribe('withdrawals', () => {});
      await h.clock.advance(HOUR_MS);
      assert.deepEqual(look(h, 'withdrawals'), ['fallback', 'disabled'], label);
      assert.equal(h.requests(), 1, label);
      assert.equal(h.clock.timers(), 0, label);
    }
  });

  test('a refused pass, on the first request or on renewal, and a transport that will not load stop live updates', async () => {
    for (const status of [401, 403]) {
      const first = setup();
      first.engine.subscribe('cards', () => {});
      await settle();
      await first.answer(failure(status));
      assert.deepEqual(look(first, 'cards'), ['fallback', 'stopped'], `first ${status}`);

      const renewal = setup();
      await goLive(renewal, ['withdrawals', 'cards']);
      await renewal.clock.advance(240_000);
      await renewal.answer(failure(status));
      assert.deepEqual(look(renewal, 'withdrawals'), ['fallback', 'stopped'], `renewal ${status}`);
      assert.deepEqual(look(renewal, 'cards'), ['fallback', 'stopped'], `renewal ${status}`);
      await renewal.clock.advance(HOUR_MS);
      assert.equal(renewal.requests(), 2, `renewal ${status}`);
    }
    const broken = setup({ loadFails: true });
    broken.engine.subscribe('cards', () => {});
    await settle();
    await broken.answer(granted());
    assert.deepEqual(look(broken, 'cards'), ['fallback', 'stopped']);
  });

  test('a join refused for read permission stops that topic while the other stays live', async () => {
    const h = setup();
    h.engine.subscribe('withdrawals', () => {});
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(granted());
    h.transport.latest('admin:withdrawals').onStatus('SUBSCRIBED', null);
    h.transport.latest('admin:cards').onStatus('CHANNEL_ERROR', DENIED);
    await settle();
    assert.deepEqual(look(h, 'cards'), ['fallback', 'stopped']);
    assert.deepEqual(look(h, 'withdrawals'), ['live', null]);
    await h.clock.advance(HOUR_MS);
    assert.deepEqual(look(h, 'cards'), ['fallback', 'stopped']);
  });

  test('refused joins reconnect twice, the third in a row stops, and watchers hear it though the status stays fallback', async () => {
    const h = setup();
    let heard = 0;
    h.engine.watch(() => {
      heard += 1;
    });
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(granted());
    const refuse = async () => {
      h.transport.latest('admin:cards').onStatus('CHANNEL_ERROR', SIGNATURE_REFUSAL);
      await settle();
    };
    await refuse();
    assert.deepEqual(look(h, 'cards'), ['fallback', 'reconnecting']);
    await h.clock.advance(2000);
    await refuse();
    assert.deepEqual(look(h, 'cards'), ['fallback', 'reconnecting']);
    await h.clock.advance(5000);
    const before = heard;
    await refuse();
    assert.deepEqual(look(h, 'cards'), ['fallback', 'stopped']);
    assert.equal(heard - before, 1);
  });

  test('a renewal that drops a topic stops it, and a renewal that grants it again joins it afresh', async () => {
    const h = setup();
    await goLive(h, ['withdrawals', 'cards']);
    await h.clock.advance(240_000);
    await h.answer(granted(['admin:withdrawals']));
    assert.deepEqual(look(h, 'cards'), ['fallback', 'stopped']);
    assert.deepEqual(look(h, 'withdrawals'), ['live', null]);
    await h.clock.advance(240_000);
    await h.answer(granted());
    assert.deepEqual(look(h, 'cards'), ['connecting', null]);
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    await settle();
    assert.deepEqual(look(h, 'cards'), ['live', null]);
  });

  test('a channel the server closes while the tab is hidden is reconnecting, and live again once the tab returns', async () => {
    const h = setup();
    await goLive(h, ['cards']);
    await h.clock.advance(100_000);
    h.clock.setHidden(true);
    await h.clock.advance(200_000);
    h.transport.latest('admin:cards').onStatus('CLOSED', null);
    await settle();
    assert.deepEqual(look(h, 'cards'), ['fallback', 'reconnecting']);
    h.clock.setHidden(false);
    await settle();
    await h.answer(granted());
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    await settle();
    assert.deepEqual(look(h, 'cards'), ['live', null]);
  });

  test('when the last page stops listening, or the engine is disposed, nothing is paused', async () => {
    const h = setup();
    const stop = h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(switchedOff());
    assert.deepEqual(look(h, 'cards'), ['fallback', 'disabled']);
    stop();
    assert.deepEqual(look(h, 'cards'), ['off', null]);
    h.engine.subscribe('cards', () => {});
    assert.deepEqual(look(h, 'cards'), ['fallback', 'disabled']);
    h.engine.dispose();
    await settle();
    assert.deepEqual(look(h, 'cards'), ['off', null]);
  });
});

describe('the paused notice wording', () => {
  test('each pause has one sentence the pages show as it is', () => {
    assert.equal(signals.livePauseText('reconnecting'), 'Live updates paused. Reconnecting…');
    assert.equal(signals.livePauseText('disabled'), 'Live updates are off. Use Refresh to see the latest.');
    assert.equal(signals.livePauseText('stopped'), 'Live updates paused. Use Refresh to see the latest.');
  });

  test('only a pause the engine retries says it is reconnecting, and none promises a timed refresh', () => {
    for (const pause of PAUSES) {
      const text = signals.livePauseText(pause);
      assert.equal(/Reconnecting/.test(text), pause === 'reconnecting', pause);
      assert.doesNotMatch(text, /second|minute|every|automatic/i, pause);
    }
  });
});

describe('the status hook', () => {
  function Probe({ topic }: { topic: SignalTopic | null }) {
    const { live, pause } = signals.useRealtimeStatus(topic);
    return createElement('output', null, `${live ? 'live' : 'not live'} ${pause ?? 'unpaused'}`);
  }

  test('outside the provider, in the server render and without a topic it is neither live nor paused', () => {
    const inProvider = (topic: SignalTopic | null) => render(createElement(signals.RealtimeSignalsProvider, {
      children: createElement(Probe, { topic }),
    }));
    assert.equal(render(createElement(Probe, { topic: 'cards' })), '<output>not live unpaused</output>');
    assert.equal(inProvider('withdrawals'), '<output>not live unpaused</output>');
    assert.equal(inProvider(null), '<output>not live unpaused</output>');
  });

  test('it only reads the engine, so it never adds a listener, a channel or a pass request', () => {
    const body = between(read(PROVIDER_FILE), 'export function useRealtimeStatus(', '\n}\n');
    assert.doesNotMatch(body, /subscribe\(|useEffect|apiRequest/);
    assert.match(body, /engine && topic \? engine\.status\(topic\) : 'off'/);
    assert.match(body, /engine && topic \? engine\.pause\(topic\) : null/);
    assert.match(body, /const status = useSyncExternalStore\(watch, readStatus, readOff\);/);
    assert.match(body, /const pause = useSyncExternalStore\(watch, readPause, readUnpaused\);/);
  });

  test('the provider module still reaches only React, the API client and the engine', () => {
    assert.deepEqual(staticImports(read(PROVIDER_FILE)), ['react', '../../lib/apiClient', './signalsCore']);
  });
});

describe('no timers on the realtime pages', () => {
  test('no realtime page or its model sets a polling interval or promises a timed refresh, in any state', () => {
    for (const file of REALTIME_PAGE_FILES) {
      const text = read(file);
      assert.doesNotMatch(text, /\bpollMs\b|setInterval|POLL_MS|pollFor|intervalMs|REFRESH_INTERVAL|REFRESH_SECONDS/, rel(file));
      assert.doesNotMatch(text, /Refreshes (?:every|automatically)|retries on its own|keep retrying|every \d+ seconds/i, rel(file));
    }
  });

  test('a resource with no pollMs never polls, because the hook defaults to no polling', () => {
    assert.match(read(RESOURCE_FILE), /const \{ pollMs = 0, keepPreviousData = true, enabled = true \} = options;/);
  });

  test('every realtime page reads the shared status and shows the shared wording with a Refresh button', () => {
    for (const file of [WITHDRAWALS_PAGE, CARD_QUEUE_PAGE, OVERVIEW_ISLAND]) {
      const text = read(file);
      assert.match(text, /useRealtimeStatus\(/, rel(file));
      assert.equal(text.split('{livePauseText(pause)}').length - 1, 1, rel(file));
      assert.match(text, /<Notice\n\s+tone="warning"\n\s+compact\n\s+announce="polite"\n/, rel(file));
      assert.match(
        text,
        /actions=\{<Button variant="ghost" size="sm" loading=\{[\w.]+\} onClick=\{\w+\}>Refresh<\/Button>\}/,
        rel(file),
      );
    }
  });
});

describe('house rules for live updates', () => {
  test('this suite carries no prose comments', () => {
    assert.doesNotMatch(read(TEST_FILE), /\/\*|(^|[^:])\/\/(?!\/)/m);
  });
});
