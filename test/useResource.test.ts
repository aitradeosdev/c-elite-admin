import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { loadUi, render } from './support/uiHarness.ts';
import type { ApiFailureKind, ApiResult } from '../app/lib/apiClient.ts';
import type {
  KeepPreviousData, ResourceEnvironment, ResourceFetcher, ResourceInvalidateOptions, ResourceStore, ResourceView,
} from '../app/_ui/useResource.ts';

type ResourceModule = typeof import('../app/_ui/useResource.ts');

interface Clock {
  env: ResourceEnvironment;
  hidden: boolean;
  advance: (ms: number) => void;
  timers: () => number;
}

interface Call<T> {
  signal: AbortSignal;
  resolve: (result: ApiResult<T>) => void;
}

let mod: ResourceModule;

before(async () => {
  mod = await loadUi<ResourceModule>('useResource.ts');
});

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

function controlled<T>(): { calls: Call<T>[]; fetcher: ResourceFetcher<T> } {
  const calls: Call<T>[] = [];
  const fetcher: ResourceFetcher<T> = (signal) => new Promise<ApiResult<T>>((resolve) => {
    calls.push({ signal, resolve });
  });
  return { calls, fetcher };
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data, status: 200, requestId: 'req_ok' };
}

function failed(status: number | null, kind: ApiFailureKind = 'http'): ApiResult<never> {
  return {
    ok: false,
    error: { kind, status, code: null, message: `failed ${status ?? kind}`, requestId: null, details: null, outcomeUnknown: false },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function answer<T>(calls: Call<T>[], data: T): Promise<void> {
  for (const call of calls) call.resolve(ok(data));
  return flush();
}

const GAP: ResourceInvalidateOptions = { minGapMs: 1000 };

function setup<T>(pollMs = 0): { clock: Clock; calls: Call<T>[]; store: ResourceStore<T> } {
  const clock = createClock();
  const { calls, fetcher } = controlled<T>();
  const store = new mod.ResourceStore<T>(clock.env);
  store.setFetcher(fetcher);
  store.setPollMs(pollMs);
  return { clock, calls, store };
}

function changeKey<T>(store: ResourceStore<T>, key: string | null, enabled = true): void {
  store.stop();
  store.start(key, enabled);
}

function view<T>(
  store: ResourceStore<T>,
  key: string | null,
  enabled = true,
  keepPreviousData: KeepPreviousData = true,
): ResourceView<T> {
  return mod.resolveResourceView(store.getSnapshot(), key, enabled, keepPreviousData);
}

describe('ResourceStore loading', () => {
  test('start loads the key once and exposes the data on success', async () => {
    const { calls, store } = setup<string[]>();
    store.start('k1', true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, false);
    assert.equal(view(store, 'k1').status, 'loading');
    assert.equal(view(store, 'k1').isInitialLoading, true);
    calls[0].resolve(ok(['a']));
    await flush();
    const current = view(store, 'k1');
    assert.equal(current.status, 'success');
    assert.deepEqual(current.data, ['a']);
    assert.equal(current.error, null);
    assert.equal(current.lastUpdatedAt, 1000);
    assert.equal(current.isInitialLoading, false);
    assert.equal(current.isRefreshing, false);
  });

  test('listeners hear every change until they unsubscribe', async () => {
    const { calls, store } = setup<string>();
    let heard = 0;
    const unsubscribe = store.subscribe(() => {
      heard += 1;
    });
    store.start('k1', true);
    const afterStart = heard;
    assert.ok(afterStart >= 1);
    unsubscribe();
    calls[0].resolve(ok('x'));
    await flush();
    assert.equal(heard, afterStart);
    assert.equal(store.getSnapshot().data, 'x');
  });

  test('changing the key aborts the in-flight request and its late response is ignored', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    changeKey(store, 'k2');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal.aborted, true);
    calls[1].resolve(ok('new'));
    await flush();
    calls[0].resolve(ok('old'));
    await flush();
    assert.equal(store.getSnapshot().data, 'new');
    assert.equal(store.getSnapshot().dataKey, 'k2');
  });

  test('a stale response that arrives first never overwrites the newer request', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    changeKey(store, 'k2');
    calls[0].resolve(ok('old'));
    await flush();
    assert.equal(store.getSnapshot().data, undefined);
    assert.equal(view(store, 'k2').status, 'loading');
    calls[1].resolve(ok('new'));
    await flush();
    assert.equal(view(store, 'k2').data, 'new');
  });

  test('refresh() supersedes the in-flight request and resolves each promise with its own outcome', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    const first = store.refresh();
    const second = store.refresh();
    assert.equal(calls.length, 3);
    assert.equal(calls[1].signal.aborted, true);
    const firstResult = await first;
    assert.equal(firstResult?.ok, false);
    assert.equal(firstResult && !firstResult.ok && firstResult.error.kind, 'aborted');
    calls[2].resolve(ok('b'));
    const secondResult = await second;
    assert.deepEqual(secondResult, ok('b'));
    assert.equal(store.getSnapshot().data, 'b');
  });

  test('refresh() resolves null when there is nothing to load', async () => {
    const { calls, store } = setup<string>();
    assert.equal(await store.refresh(), null);
    store.start(null, true);
    assert.equal(await store.refresh(), null);
    changeKey(store, 'k1', false);
    assert.equal(await store.refresh(), null);
    store.stop();
    assert.equal(await store.refresh(), null);
    assert.equal(calls.length, 0);
  });

  test('a manual refresh shows as refreshing while data stays visible', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    void store.refresh();
    const current = view(store, 'k1');
    assert.equal(current.status, 'refreshing');
    assert.equal(current.isRefreshing, true);
    assert.equal(current.isPreviousData, false);
    assert.equal(current.data, 'a');
  });

  test('key null is idle, clears the data and never fetches', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    changeKey(store, null);
    assert.equal(calls.length, 1);
    assert.equal(store.getSnapshot().data, undefined);
    assert.equal(store.getSnapshot().lastUpdatedAt, null);
    const current = view(store, null);
    assert.equal(current.status, 'idle');
    assert.equal(current.data, undefined);
  });

  test('enabled false never fetches, enabling fetches, disabling aborts the in-flight request', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', false);
    assert.equal(calls.length, 0);
    assert.equal(view(store, 'k1', false).status, 'idle');
    changeKey(store, 'k1', true);
    assert.equal(calls.length, 1);
    changeKey(store, 'k1', false);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(store.getSnapshot().pending, null);
    assert.equal(view(store, 'k1', false).status, 'idle');
  });
});

describe('previous data while a new key loads', () => {
  test('previous data stays visible and is marked as previous', async () => {
    const { calls, store } = setup<string>();
    store.start('pending:1', true);
    calls[0].resolve(ok('page one'));
    await flush();
    changeKey(store, 'pending:2');
    const current = view(store, 'pending:2');
    assert.equal(current.status, 'refreshing');
    assert.equal(current.data, 'page one');
    assert.equal(current.isPreviousData, true);
    assert.equal(current.isInitialLoading, false);
    assert.equal(current.lastUpdatedAt, 1000);
  });

  test('keepPreviousData false shows the loading state instead', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    changeKey(store, 'k2');
    const current = view(store, 'k2', true, false);
    assert.equal(current.status, 'loading');
    assert.equal(current.data, undefined);
    assert.equal(current.isPreviousData, false);
    assert.equal(current.lastUpdatedAt, null);
  });

  test('a predicate keeps data for some key changes and not others', async () => {
    const sameTab: KeepPreviousData = (previous, next) => previous.split(':')[0] === next.split(':')[0];
    const { calls, store } = setup<string>();
    store.start('pending:1', true);
    calls[0].resolve(ok('pending rows'));
    await flush();
    changeKey(store, 'pending:2');
    assert.equal(view(store, 'pending:2', true, sameTab).data, 'pending rows');
    changeKey(store, 'disputed:1');
    assert.equal(view(store, 'disputed:1', true, sameTab).data, undefined);
    assert.equal(view(store, 'disputed:1', true, sameTab).status, 'loading');
  });

  test('a render with a new key before the effect runs already shows the transition', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    const ahead = view(store, 'k2');
    assert.equal(ahead.status, 'refreshing');
    assert.equal(ahead.isPreviousData, true);
    assert.equal(view(store, 'k2', true, false).status, 'loading');
  });

  test('a failed load for a new key keeps the previous data next to the error', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    changeKey(store, 'k2');
    calls[1].resolve(failed(500));
    await flush();
    const current = view(store, 'k2');
    assert.equal(current.status, 'error');
    assert.equal(current.data, 'a');
    assert.equal(current.isPreviousData, true);
    assert.equal(current.error?.status, 500);
  });

  test('one key\'s error is not shown for the next key', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(failed(500));
    await flush();
    assert.equal(view(store, 'k1').status, 'error');
    assert.equal(view(store, 'k2').error, null);
    changeKey(store, 'k2');
    assert.equal(view(store, 'k2').error, null);
    assert.equal(view(store, 'k2').status, 'loading');
  });

  test('returning to the key whose data is held shows it without refetching', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    changeKey(store, 'k2');
    changeKey(store, 'k1');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].signal.aborted, true);
    assert.equal(view(store, 'k1').status, 'success');
    assert.equal(view(store, 'k1').data, 'a');
  });
});

describe('failed refreshes keep stale data', () => {
  test('the stale data stays, the error is separate and lastUpdatedAt still dates the data', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    clock.advance(60000);
    const result = await (async () => {
      const pending = store.refresh();
      calls[1].resolve(failed(503));
      return pending;
    })();
    assert.equal(result?.ok, false);
    const stale = view(store, 'k1');
    assert.equal(stale.status, 'error');
    assert.equal(stale.data, 'a');
    assert.equal(stale.isPreviousData, false);
    assert.equal(stale.lastUpdatedAt, 1000);
    assert.equal(stale.error?.status, 503);
    const retry = store.refresh();
    assert.equal(view(store, 'k1').status, 'refreshing');
    assert.equal(view(store, 'k1').error?.status, 503);
    calls[2].resolve(ok('b'));
    await retry;
    const fresh = view(store, 'k1');
    assert.equal(fresh.status, 'success');
    assert.equal(fresh.error, null);
    assert.equal(fresh.data, 'b');
    assert.equal(fresh.lastUpdatedAt, 61000);
  });
});

describe('polling', () => {
  test('the next poll runs pollMs after the last response, silently', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    assert.equal(clock.timers(), 1);
    clock.advance(4999);
    assert.equal(calls.length, 1);
    clock.advance(1);
    assert.equal(calls.length, 2);
    assert.equal(store.getSnapshot().pending, 'background');
    const during = view(store, 'k1');
    assert.equal(during.status, 'success');
    assert.equal(during.isRefreshing, false);
    calls[1].resolve(ok('b'));
    await flush();
    assert.equal(view(store, 'k1').data, 'b');
    assert.equal(clock.timers(), 1);
  });

  test('polls never overlap an in-flight request', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    clock.advance(5000);
    assert.equal(calls.length, 2);
    assert.equal(clock.timers(), 0);
    clock.advance(60000);
    assert.equal(calls.length, 2);
    calls[1].resolve(ok('b'));
    await flush();
    void store.refresh();
    assert.equal(clock.timers(), 0);
    clock.advance(60000);
    assert.equal(calls.length, 3);
    calls[2].resolve(ok('c'));
    await flush();
    clock.advance(5000);
    assert.equal(calls.length, 4);
  });

  test('polling pauses while hidden and resumes at once when the data is overdue', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    clock.hidden = true;
    store.visibilityChanged();
    assert.equal(clock.timers(), 0);
    clock.advance(30000);
    assert.equal(calls.length, 1);
    clock.hidden = false;
    store.visibilityChanged();
    clock.advance(0);
    assert.equal(calls.length, 2);
  });

  test('a timer that fires while hidden does nothing, and showing the page waits only the remainder', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    clock.advance(1000);
    clock.hidden = true;
    clock.advance(4000);
    assert.equal(calls.length, 1);
    clock.hidden = false;
    store.visibilityChanged();
    clock.advance(0);
    assert.equal(calls.length, 2);
    calls[1].resolve(ok('b'));
    await flush();
    clock.advance(1000);
    clock.hidden = true;
    store.visibilityChanged();
    clock.hidden = false;
    store.visibilityChanged();
    clock.advance(3999);
    assert.equal(calls.length, 2);
    clock.advance(1);
    assert.equal(calls.length, 3);
  });

  test('a 401 or 403 halts polling until a request succeeds again', async () => {
    for (const status of [401, 403]) {
      const { clock, calls, store } = setup<string>(5000);
      store.start('k1', true);
      calls[0].resolve(ok('a'));
      await flush();
      clock.advance(5000);
      calls[1].resolve(failed(status));
      await flush();
      assert.equal(clock.timers(), 0, `status ${status} must halt polling`);
      clock.advance(60000);
      assert.equal(calls.length, 2);
      const retry = store.refresh();
      calls[2].resolve(ok('b'));
      await retry;
      assert.equal(clock.timers(), 1);
    }
  });

  test('network and server failures keep polling so the page recovers on its own', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    calls[0].resolve(failed(null, 'network'));
    await flush();
    assert.equal(view(store, 'k1').status, 'error');
    clock.advance(5000);
    assert.equal(calls.length, 2);
    assert.equal(view(store, 'k1').status, 'error');
    assert.equal(view(store, 'k1').isInitialLoading, false);
    calls[1].resolve(ok('recovered'));
    await flush();
    assert.equal(view(store, 'k1').status, 'success');
    assert.equal(view(store, 'k1').data, 'recovered');
  });

  test('setting pollMs to 0 stops polling and a positive value restarts it', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    store.setPollMs(0);
    assert.equal(clock.timers(), 0);
    clock.advance(60000);
    assert.equal(calls.length, 1);
    store.setPollMs(5000);
    clock.advance(0);
    assert.equal(calls.length, 2);
  });
});

describe('lifecycle', () => {
  test('StrictMode double effects leave exactly one live request', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    store.stop();
    store.start('k1', true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(calls[1].signal.aborted, false);
    calls[0].resolve(ok('stale'));
    calls[1].resolve(ok('fresh'));
    await flush();
    assert.equal(store.getSnapshot().data, 'fresh');
  });

  test('unmount aborts the request, clears the poll timer and ignores late responses', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    void store.refresh();
    store.stop();
    assert.equal(calls[1].signal.aborted, true);
    assert.equal(clock.timers(), 0);
    assert.equal(store.getSnapshot().pending, null);
    calls[1].resolve(ok('late'));
    await flush();
    assert.equal(store.getSnapshot().data, 'a');
    clock.advance(60000);
    assert.equal(calls.length, 2);
  });

  test('a remount with the key already loaded does not refetch but resumes polling', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    store.stop();
    store.start('k1', true);
    assert.equal(calls.length, 1);
    assert.equal(clock.timers(), 1);
  });
});

describe('mutate', () => {
  test('mutate edits the data in place and discards an in-flight revalidation', async () => {
    const { calls, store } = setup<string[]>();
    store.start('k1', true);
    calls[0].resolve(ok(['a', 'b']));
    await flush();
    void store.refresh({ background: true });
    store.mutate((rows) => rows?.filter((row) => row !== 'a'));
    assert.equal(calls[1].signal.aborted, true);
    assert.deepEqual(store.getSnapshot().data, ['b']);
    assert.equal(store.getSnapshot().lastUpdatedAt, 1000);
    calls[1].resolve(ok(['a', 'b']));
    await flush();
    assert.deepEqual(store.getSnapshot().data, ['b']);
    assert.equal(view(store, 'k1').status, 'success');
  });

  test('an updater that returns undefined changes nothing', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    const before = store.getSnapshot();
    store.mutate(() => undefined);
    assert.equal(store.getSnapshot(), before);
    assert.equal(calls[0].signal.aborted, false);
  });

  test('mutate seeds a key with no data yet and cancels its initial load', async () => {
    const { clock, calls, store } = setup<string[]>();
    store.start('section:1', true);
    clock.advance(500);
    store.mutate(['seeded']);
    assert.equal(calls[0].signal.aborted, true);
    const current = view(store, 'section:1');
    assert.equal(current.status, 'success');
    assert.deepEqual(current.data, ['seeded']);
    assert.equal(current.lastUpdatedAt, 1500);
  });

  test('the updater never sees another key\'s data', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    changeKey(store, 'k2');
    let seen: string | undefined = 'unset';
    store.mutate((previous) => {
      seen = previous;
      return undefined;
    });
    assert.equal(seen, undefined);
    assert.equal(calls[1].signal.aborted, false);
  });

  test('mutate clears an earlier error', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(failed(500));
    await flush();
    store.mutate('fixed');
    assert.equal(view(store, 'k1').error, null);
    assert.equal(view(store, 'k1').status, 'success');
  });

  test('mutate on an idle store does nothing', () => {
    const { store } = setup<string>();
    const before = store.getSnapshot();
    store.mutate('x');
    assert.equal(store.getSnapshot(), before);
  });
});

describe('request reasons', () => {
  test('a background refresh never downgrades a foreground load in progress', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    changeKey(store, 'k2');
    void store.refresh({ background: true });
    assert.equal(calls[1].signal.aborted, true);
    assert.equal(store.getSnapshot().pending, 'load');
    const current = view(store, 'k2');
    assert.equal(current.status, 'refreshing');
    assert.equal(current.isPreviousData, true);
  });

  test('a manual refresh during a background poll is shown as refreshing', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    clock.advance(5000);
    assert.equal(store.getSnapshot().pending, 'background');
    void store.refresh();
    assert.equal(store.getSnapshot().pending, 'refresh');
    assert.equal(view(store, 'k1').status, 'refreshing');
  });
});

describe('fetcher contract', () => {
  test('a fetcher that throws, rejects or returns garbage becomes an error state', async () => {
    const throwing = new mod.ResourceStore<string>(createClock().env);
    throwing.setFetcher(() => {
      throw new TypeError('boom');
    });
    throwing.start('k1', true);
    await flush();
    assert.equal(throwing.getSnapshot().error?.kind, 'network');

    const rejecting = new mod.ResourceStore<string>(createClock().env);
    rejecting.setFetcher(() => Promise.reject(new Error('mapping bug')));
    rejecting.start('k1', true);
    await flush();
    assert.equal(rejecting.getSnapshot().error?.kind, 'parse');
    assert.doesNotMatch(rejecting.getSnapshot().error?.message ?? '', /mapping bug/);

    const garbage = new mod.ResourceStore<string>(createClock().env);
    garbage.setFetcher(() => Promise.resolve(undefined as unknown as ApiResult<string>));
    garbage.start('k1', true);
    await flush();
    assert.equal(garbage.getSnapshot().error?.kind, 'parse');
    assert.equal(garbage.getSnapshot().pending, null);
  });

  test('an aborted result the store did not cause ends a refresh quietly when the key has data', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    void store.refresh();
    calls[1].resolve(failed(null, 'aborted'));
    await flush();
    assert.equal(store.getSnapshot().pending, null);
    assert.equal(store.getSnapshot().error, null);
    assert.equal(view(store, 'k1').status, 'success');
    assert.equal(view(store, 'k1').data, 'a');
  });

  test('an aborted result the store did not cause, with no data for the key, is an error instead of an endless load', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    calls[0].resolve(ok('a'));
    await flush();
    changeKey(store, 'k2');
    calls[1].resolve(failed(null, 'aborted'));
    await flush();
    const current = view(store, 'k2');
    assert.equal(store.getSnapshot().pending, null);
    assert.equal(current.status, 'error');
    assert.equal(current.isInitialLoading, false);
    assert.equal(current.error?.kind, 'aborted');
    assert.equal(current.data, 'a');
    assert.equal(current.isPreviousData, true);

    const fresh = setup<string>();
    fresh.store.start('k1', true);
    fresh.calls[0].resolve(failed(null, 'aborted'));
    await flush();
    assert.equal(view(fresh.store, 'k1').status, 'error');
    assert.equal(view(fresh.store, 'k1').isInitialLoading, false);
  });

  test('the fetcher always receives the signal of its own request', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    void store.refresh();
    assert.notEqual(calls[0].signal, calls[1].signal);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(calls[1].signal.aborted, false);
  });
});

describe('resolveResourceView', () => {
  test('the first render, before any effect, is loading for a key and idle otherwise', () => {
    const initial = new mod.ResourceStore<string>().getSnapshot();
    assert.equal(mod.resolveResourceView(initial, 'k1', true).status, 'loading');
    assert.equal(mod.resolveResourceView(initial, 'k1', true).isInitialLoading, true);
    assert.equal(mod.resolveResourceView(initial, 'k1', false).status, 'idle');
    assert.equal(mod.resolveResourceView(initial, null, true).status, 'idle');
  });
});

describe('useResource (server render)', () => {
  function probe(key: string | null, fetcher: ResourceFetcher<string>) {
    function Probe() {
      const resource = mod.useResource(key, fetcher, { pollMs: 1000 });
      return createElement(
        'output',
        null,
        `${resource.status}|${String(resource.isInitialLoading)}|${resource.data ?? 'none'}`,
      );
    }
    return render(createElement(Probe));
  }

  test('a key renders the loading state on the server and the fetcher is never called', () => {
    let called = 0;
    const html = probe('k1', async () => {
      called += 1;
      return ok('x');
    });
    assert.equal(html, '<output>loading|true|none</output>');
    assert.equal(called, 0);
  });

  test('a null key renders idle', () => {
    assert.equal(probe(null, async () => ok('x')), '<output>idle|false|none</output>');
  });
});

describe('invalidate: coalescing', () => {
  test('a signal reloads a settled key once in the background, with no spinner', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    await answer(calls, 'a');
    store.invalidate(GAP);
    assert.equal(calls.length, 2);
    assert.equal(store.getSnapshot().pending, 'background');
    const during = view(store, 'k1');
    assert.equal(during.status, 'success');
    assert.equal(during.isRefreshing, false);
    assert.equal(during.data, 'a');
    await answer(calls, 'b');
    assert.equal(view(store, 'k1').data, 'b');
    assert.equal(store.getSnapshot().pending, null);
  });

  test('ten signals in 100 ms give at most two loads, and the last signal is never lost', async () => {
    for (const quick of [true, false]) {
      const { clock, calls, store } = setup<string>();
      store.start('k1', true);
      await answer(calls, 'a');
      for (let index = 0; index < 10; index += 1) {
        store.invalidate(GAP);
        if (quick) await answer(calls, 'b');
        clock.advance(10);
      }
      await answer(calls, 'c');
      clock.advance(2000);
      await answer(calls, 'd');
      clock.advance(60000);
      const label = quick ? 'quick responses' : 'one slow response';
      assert.equal(calls.length, 3, label);
      assert.equal(view(store, 'k1').data, 'd', label);
    }
  });

  test('a request in flight is never aborted by a signal and gets exactly one follow-up', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    store.invalidate(GAP);
    store.invalidate(GAP);
    store.invalidate(GAP);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, false);
    assert.equal(store.getSnapshot().pending, 'load');
    assert.equal(clock.timers(), 0);
    await answer(calls, 'a');
    assert.equal(calls.length, 2);
    assert.equal(store.getSnapshot().pending, 'background');
    await answer(calls, 'b');
    clock.advance(60000);
    assert.equal(calls.length, 2);
    assert.equal(view(store, 'k1').data, 'b');
  });

  test('a signal during a poll is answered by one more load once the poll lands', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    await answer(calls, 'a');
    clock.advance(5000);
    assert.equal(calls.length, 2);
    store.invalidate(GAP);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].signal.aborted, false);
    await answer(calls, 'b');
    assert.equal(calls.length, 3);
    await answer(calls, 'c');
    clock.advance(4999);
    assert.equal(calls.length, 3);
    clock.advance(1);
    assert.equal(calls.length, 4);
  });

  test('a manual refresh covers signals waiting on the gap', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    await answer(calls, 'a');
    store.invalidate(GAP);
    await answer(calls, 'b');
    store.invalidate(GAP);
    assert.equal(clock.timers(), 1);
    void store.refresh();
    assert.equal(calls.length, 3);
    assert.equal(clock.timers(), 0);
    await answer(calls, 'c');
    clock.advance(60000);
    assert.equal(calls.length, 3);
  });

  test('mutate keeps a signal whose load it cancelled, and reloads after the gap', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    await answer(calls, 'a');
    store.invalidate(GAP);
    store.mutate('local');
    assert.equal(calls[1].signal.aborted, true);
    assert.equal(view(store, 'k1').data, 'local');
    assert.equal(clock.timers(), 1);
    clock.advance(999);
    assert.equal(calls.length, 2);
    clock.advance(1);
    assert.equal(calls.length, 3);
    await answer(calls, 'server');
    assert.equal(view(store, 'k1').data, 'server');
  });
});

describe('invalidate: minimum gap', () => {
  test('signal loads start at least minGapMs apart, the trailing one on its own timer', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    await answer(calls, 'a');
    store.invalidate(GAP);
    assert.equal(calls.length, 2);
    clock.advance(300);
    await answer(calls, 'b');
    store.invalidate(GAP);
    assert.equal(calls.length, 2);
    assert.equal(clock.timers(), 1);
    clock.advance(699);
    assert.equal(calls.length, 2);
    clock.advance(1);
    assert.equal(calls.length, 3);
    assert.equal(store.getSnapshot().pending, 'background');
  });

  test('the follow-up to a signal load still in flight also waits out the gap', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    await answer(calls, 'a');
    store.invalidate(GAP);
    clock.advance(200);
    store.invalidate(GAP);
    clock.advance(100);
    await answer(calls, 'b');
    assert.equal(calls.length, 2);
    assert.equal(clock.timers(), 1);
    clock.advance(699);
    assert.equal(calls.length, 2);
    clock.advance(1);
    assert.equal(calls.length, 3);
  });

  test('with no gap, or a gap that is not a positive number, a signal after a landed load reloads at once', async () => {
    const { calls, store } = setup<string>();
    store.start('k1', true);
    await answer(calls, 'a');
    const gaps: [string, ResourceInvalidateOptions | undefined][] = [
      ['omitted', undefined], ['empty', {}], ['zero', { minGapMs: 0 }], ['negative', { minGapMs: -5 }],
      ['not a number', { minGapMs: Number.NaN }],
    ];
    let expected = 1;
    for (const [label, options] of gaps) {
      store.invalidate(options);
      expected += 1;
      assert.equal(calls.length, expected, label);
      await answer(calls, label);
    }
  });
});

describe('invalidate: hidden pages', () => {
  test('a signal while hidden waits for the page to be shown, then loads once', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    await answer(calls, 'a');
    clock.hidden = true;
    store.visibilityChanged();
    store.invalidate(GAP);
    store.invalidate(GAP);
    assert.equal(calls.length, 1);
    assert.equal(clock.timers(), 0);
    clock.advance(60000);
    assert.equal(calls.length, 1);
    clock.hidden = false;
    store.visibilityChanged();
    assert.equal(calls.length, 2);
    clock.advance(0);
    assert.equal(calls.length, 2);
    await answer(calls, 'b');
    assert.equal(view(store, 'k1').data, 'b');
    assert.equal(clock.timers(), 1);
  });

  test('a trailing signal load is held while hidden, and showing the page waits only what is left of the gap', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    await answer(calls, 'a');
    store.invalidate(GAP);
    await answer(calls, 'b');
    clock.advance(100);
    store.invalidate(GAP);
    assert.equal(clock.timers(), 1);
    clock.hidden = true;
    store.visibilityChanged();
    assert.equal(clock.timers(), 0);
    clock.advance(200);
    clock.hidden = false;
    store.visibilityChanged();
    assert.equal(calls.length, 2);
    clock.advance(699);
    assert.equal(calls.length, 2);
    clock.advance(1);
    assert.equal(calls.length, 3);
  });

  test('a signal timer that fires while the page is hidden waits for it to be shown', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    await answer(calls, 'a');
    store.invalidate(GAP);
    await answer(calls, 'b');
    store.invalidate(GAP);
    clock.hidden = true;
    clock.advance(5000);
    assert.equal(calls.length, 2);
    assert.equal(clock.timers(), 0);
    clock.hidden = false;
    store.visibilityChanged();
    assert.equal(calls.length, 3);
  });

  test('a follow-up that falls due while hidden waits for the page to be shown', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    store.invalidate(GAP);
    clock.hidden = true;
    store.visibilityChanged();
    await answer(calls, 'a');
    assert.equal(calls.length, 1);
    assert.equal(clock.timers(), 0);
    clock.hidden = false;
    store.visibilityChanged();
    assert.equal(calls.length, 2);
  });
});

describe('invalidate: halts and resets', () => {
  test('after a 401 or 403 a signal does nothing until a request succeeds again', async () => {
    for (const status of [401, 403]) {
      const { clock, calls, store } = setup<string>(5000);
      store.start('k1', true);
      await answer(calls, 'a');
      void store.refresh();
      calls[1].resolve(failed(status));
      await flush();
      store.invalidate(GAP);
      assert.equal(calls.length, 2, `status ${status}`);
      assert.equal(clock.timers(), 0, `status ${status}`);
      clock.advance(60000);
      assert.equal(calls.length, 2, `status ${status}`);
      const retry = store.refresh();
      calls[2].resolve(ok('b'));
      await retry;
      store.invalidate(GAP);
      assert.equal(calls.length, 4, `status ${status}`);
    }
  });

  test('a signal that arrived during a request answered 401 or 403 is dropped, never retried', async () => {
    for (const status of [401, 403]) {
      const { clock, calls, store } = setup<string>();
      store.start('k1', true);
      await answer(calls, 'a');
      void store.refresh({ background: true });
      store.invalidate(GAP);
      calls[1].resolve(failed(status));
      await flush();
      assert.equal(calls.length, 2, `status ${status}`);
      assert.equal(clock.timers(), 0, `status ${status}`);
      const retry = store.refresh();
      calls[2].resolve(ok('b'));
      await retry;
      clock.advance(60000);
      assert.equal(calls.length, 3, `status ${status}`);
    }
  });

  test('a signal load that fails is not retried by the signal path, and the poll keeps its cadence', async () => {
    const { clock, calls, store } = setup<string>(60000);
    store.start('k1', true);
    await answer(calls, 'a');
    store.invalidate(GAP);
    calls[1].resolve(failed(503));
    await flush();
    assert.equal(view(store, 'k1').status, 'error');
    assert.equal(view(store, 'k1').data, 'a');
    assert.equal(clock.timers(), 1);
    clock.advance(59999);
    assert.equal(calls.length, 2);
    clock.advance(1);
    assert.equal(calls.length, 3);
  });

  test('changing the key drops signals still waiting, and their timer', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    store.invalidate(GAP);
    changeKey(store, 'k2');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal.aborted, true);
    await answer(calls, 'b');
    clock.advance(60000);
    assert.equal(calls.length, 2);
    store.invalidate(GAP);
    await answer(calls, 'c');
    store.invalidate(GAP);
    assert.equal(clock.timers(), 1);
    changeKey(store, 'k3');
    assert.equal(calls.length, 4);
    assert.equal(clock.timers(), 0);
    await answer(calls, 'd');
    clock.advance(60000);
    assert.equal(calls.length, 4);
    assert.equal(view(store, 'k3').data, 'd');
  });

  test('a key change clears pending signals even when it returns to a key whose data is still held', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    await answer(calls, 'a');
    store.invalidate(GAP);
    assert.equal(calls.length, 2);
    changeKey(store, 'k2');
    changeKey(store, 'k1');
    assert.equal(calls.length, 3);
    assert.equal(calls[1].signal.aborted, true);
    assert.equal(calls[2].signal.aborted, true);
    assert.equal(view(store, 'k1').data, 'a');
    assert.equal(clock.timers(), 0);
    clock.advance(60000);
    assert.equal(calls.length, 3);
  });

  test('disabling drops signals still waiting', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    await answer(calls, 'a');
    store.invalidate(GAP);
    await answer(calls, 'b');
    store.invalidate(GAP);
    assert.equal(clock.timers(), 1);
    changeKey(store, 'k1', false);
    assert.equal(clock.timers(), 0);
    changeKey(store, 'k1', true);
    clock.advance(60000);
    assert.equal(calls.length, 2);
  });

  test('a store that is not started, has no key, is disabled or is stopped ignores signals', async () => {
    const idle = setup<string>();
    idle.store.invalidate(GAP);
    assert.equal(idle.calls.length, 0);
    assert.equal(idle.clock.timers(), 0);

    const keyless = setup<string>();
    keyless.store.start(null, true);
    keyless.store.invalidate(GAP);
    assert.equal(keyless.calls.length, 0);
    assert.equal(keyless.clock.timers(), 0);

    const disabled = setup<string>();
    disabled.store.start('k1', false);
    disabled.store.invalidate(GAP);
    assert.equal(disabled.calls.length, 0);
    changeKey(disabled.store, 'k1', true);
    await answer(disabled.calls, 'a');
    assert.equal(disabled.calls.length, 1);

    const stopped = setup<string>();
    stopped.store.start('k1', true);
    await answer(stopped.calls, 'a');
    stopped.store.stop();
    stopped.store.invalidate(GAP);
    assert.equal(stopped.calls.length, 1);
    assert.equal(stopped.clock.timers(), 0);
    stopped.store.start('k1', true);
    assert.equal(stopped.calls.length, 1);
  });

  test('stopping clears the signal timer, and starting the same key again picks the signal back up', async () => {
    const { clock, calls, store } = setup<string>();
    store.start('k1', true);
    await answer(calls, 'a');
    store.invalidate(GAP);
    await answer(calls, 'b');
    store.invalidate(GAP);
    assert.equal(clock.timers(), 1);
    store.stop();
    assert.equal(clock.timers(), 0);
    clock.advance(5000);
    assert.equal(calls.length, 2);
    store.start('k1', true);
    assert.equal(calls.length, 3);
    assert.equal(store.getSnapshot().pending, 'background');
  });
});

describe('invalidate: the safety poll', () => {
  test('a signal load pushes the safety poll back to a full interval from when it lands', async () => {
    const { clock, calls, store } = setup<string>(60000);
    store.start('k1', true);
    await answer(calls, 'a');
    clock.advance(30000);
    store.invalidate(GAP);
    assert.equal(calls.length, 2);
    clock.advance(500);
    await answer(calls, 'b');
    clock.advance(59999);
    assert.equal(calls.length, 2);
    clock.advance(1);
    assert.equal(calls.length, 3);
    assert.equal(store.getSnapshot().pending, 'background');
  });

  test('a trailing signal load leaves the poll timer alone and is covered by a poll that runs first', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    await answer(calls, 'a');
    const wide: ResourceInvalidateOptions = { minGapMs: 10000 };
    store.invalidate(wide);
    await answer(calls, 'b');
    store.invalidate(wide);
    assert.equal(clock.timers(), 2);
    clock.advance(4999);
    assert.equal(calls.length, 2);
    clock.advance(1);
    assert.equal(calls.length, 3);
    assert.equal(clock.timers(), 0);
    await answer(calls, 'c');
    assert.equal(clock.timers(), 1);
    clock.advance(4999);
    assert.equal(calls.length, 3);
  });

  test('switching between the live safety interval and the fallback interval measures from the last response', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    await answer(calls, 'a');
    store.setPollMs(60000);
    clock.advance(30000);
    assert.equal(calls.length, 1);
    store.setPollMs(5000);
    clock.advance(0);
    assert.equal(calls.length, 2);
    await answer(calls, 'b');
    store.setPollMs(60000);
    clock.advance(59999);
    assert.equal(calls.length, 2);
    clock.advance(1);
    assert.equal(calls.length, 3);
  });

  test('without signals the poll runs exactly as before', async () => {
    const { clock, calls, store } = setup<string>(5000);
    store.start('k1', true);
    await answer(calls, 'a');
    for (let round = 1; round <= 3; round += 1) {
      assert.equal(clock.timers(), 1);
      clock.advance(4999);
      assert.equal(calls.length, round);
      clock.advance(1);
      assert.equal(calls.length, round + 1);
      assert.equal(clock.timers(), 0);
      await answer(calls, `p${round}`);
    }
  });
});

describe('useResource invalidate (server render)', () => {
  test('the hook returns invalidate, and a signal during a server render never fetches', () => {
    let called = 0;
    function Probe() {
      const resource = mod.useResource<string>('k1', async () => {
        called += 1;
        return ok('x');
      }, { pollMs: 1000 });
      resource.invalidate(GAP);
      return createElement('output', null, `${typeof resource.invalidate}|${resource.status}`);
    }
    assert.equal(render(createElement(Probe)), '<output>function|loading</output>');
    assert.equal(called, 0);
  });
});

describe('house rules', () => {
  test('the module and this test carry no prose comments', () => {
    for (const url of [new URL('../app/_ui/useResource.ts', import.meta.url), new URL(import.meta.url)]) {
      assert.doesNotMatch(readFileSync(url, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m, url.pathname);
    }
  });
});
