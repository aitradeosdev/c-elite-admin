'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { toApiFailure, type ApiFailure, type ApiResult } from '../lib/apiClient';

export type ResourceStatus = 'idle' | 'loading' | 'refreshing' | 'success' | 'error';

export type ResourceFetcher<T> = (signal: AbortSignal) => Promise<ApiResult<T>>;

export type ResourceRequestReason = 'load' | 'refresh' | 'background';

export type ResourceUpdater<T> = T | ((previous: T | undefined) => T | undefined);

export type KeepPreviousData = boolean | ((previousKey: string, nextKey: string) => boolean);

export interface UseResourceOptions {
  pollMs?: number;
  keepPreviousData?: KeepPreviousData;
  enabled?: boolean;
}

export interface ResourceRefreshOptions {
  background?: boolean;
}

export interface ResourceInvalidateOptions {
  minGapMs?: number;
}

export interface ResourceSnapshot<T> {
  key: string | null;
  enabled: boolean;
  data: T | undefined;
  dataKey: string | null;
  error: ApiFailure | null;
  pending: ResourceRequestReason | null;
  lastUpdatedAt: number | null;
}

export interface ResourceView<T> {
  data: T | undefined;
  error: ApiFailure | null;
  status: ResourceStatus;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isPreviousData: boolean;
  lastUpdatedAt: number | null;
}

export interface UseResourceResult<T> extends ResourceView<T> {
  refresh: (options?: ResourceRefreshOptions) => Promise<ApiResult<T> | null>;
  mutate: (next: ResourceUpdater<T>) => void;
  invalidate: (options?: ResourceInvalidateOptions) => void;
}

export interface ResourceEnvironment {
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isHidden: () => boolean;
}

interface InFlight<T> {
  key: string;
  reason: ResourceRequestReason;
  controller: AbortController;
  resolve: (result: ApiResult<T> | null) => void;
  signals: number;
}

const REASON_WEIGHT: Readonly<Record<ResourceRequestReason, number>> = { background: 0, refresh: 1, load: 2 };

const DEFAULT_ENVIRONMENT: ResourceEnvironment = {
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
};

function emptySnapshot<T>(enabled: boolean): ResourceSnapshot<T> {
  return {
    key: null,
    enabled,
    data: undefined,
    dataKey: null,
    error: null,
    pending: null,
    lastUpdatedAt: null,
  };
}

function positiveMs(ms: number | undefined): number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function isApiResult<T>(value: unknown): value is ApiResult<T> {
  return Boolean(value) && typeof value === 'object' && typeof (value as { ok?: unknown }).ok === 'boolean';
}

function isHalting(error: ApiFailure | null): boolean {
  return error !== null && error.kind === 'http' && (error.status === 401 || error.status === 403);
}

function abortedResult<T>(): ApiResult<T> {
  return { ok: false, error: toApiFailure({ name: 'AbortError' }) };
}

export class ResourceStore<T> {
  private snapshot: ResourceSnapshot<T> = emptySnapshot<T>(true);
  private readonly listeners = new Set<() => void>();
  private readonly env: ResourceEnvironment;
  private fetcher: ResourceFetcher<T> | null = null;
  private inFlight: InFlight<T> | null = null;
  private timer: { handle: unknown } | null = null;
  private active = false;
  private pollMs = 0;
  private settledAt = 0;
  private signals = 0;
  private coveredSignals = 0;
  private signalGapMs = 0;
  private signalLoadAt: number | null = null;
  private signalTimer: { handle: unknown } | null = null;

  constructor(environment: Partial<ResourceEnvironment> = {}) {
    this.env = { ...DEFAULT_ENVIRONMENT, ...environment };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): ResourceSnapshot<T> => this.snapshot;

  setFetcher(fetcher: ResourceFetcher<T>): void {
    this.fetcher = fetcher;
  }

  setPollMs(ms: number): void {
    const next = positiveMs(ms);
    if (next === this.pollMs) return;
    this.pollMs = next;
    this.schedule();
  }

  start(key: string | null, enabled: boolean): void {
    this.active = true;
    const current = this.snapshot;
    if (key !== current.key) {
      this.cancel();
      this.dropSignals();
      this.commit(key === null ? emptySnapshot<T>(enabled) : { ...current, key, enabled, error: null, pending: null });
    } else if (enabled !== current.enabled) {
      if (!enabled) {
        this.cancel();
        this.dropSignals();
      }
      this.commit({ ...this.snapshot, enabled, pending: enabled ? this.snapshot.pending : null });
    }
    const next = this.snapshot;
    if (next.key !== null && next.enabled && next.dataKey !== next.key && this.inFlight === null) {
      void this.load('load');
      return;
    }
    this.schedule();
    this.flushSignals();
  }

  stop(): void {
    this.active = false;
    this.clearTimer();
    this.clearSignalTimer();
    if (this.cancel()) this.commit({ ...this.snapshot, pending: null });
  }

  refresh(options: ResourceRefreshOptions = {}): Promise<ApiResult<T> | null> {
    const { key, enabled } = this.snapshot;
    if (!this.active || key === null || !enabled) return Promise.resolve(null);
    return this.load(options.background ? 'background' : 'refresh');
  }

  invalidate(options: ResourceInvalidateOptions = {}): void {
    const { key, enabled, error } = this.snapshot;
    if (!this.active || key === null || !enabled || isHalting(error)) return;
    this.signals += 1;
    this.signalGapMs = positiveMs(options.minGapMs);
    this.flushSignals();
  }

  mutate(next: ResourceUpdater<T>): void {
    const current = this.snapshot;
    if (current.key === null) return;
    const previous = current.dataKey === current.key ? current.data : undefined;
    const value = typeof next === 'function'
      ? (next as (previous: T | undefined) => T | undefined)(previous)
      : next;
    if (value === undefined) return;
    this.cancel();
    const now = this.env.now();
    this.settledAt = now;
    this.commit({
      ...current,
      data: value,
      dataKey: current.key,
      error: null,
      pending: null,
      lastUpdatedAt: current.dataKey === current.key && current.lastUpdatedAt !== null ? current.lastUpdatedAt : now,
    });
    this.schedule();
    this.flushSignals();
  }

  visibilityChanged(): void {
    this.schedule();
    this.flushSignals();
  }

  private load(reason: ResourceRequestReason): Promise<ApiResult<T> | null> {
    const key = this.snapshot.key;
    const fetcher = this.fetcher;
    if (key === null || !fetcher) return Promise.resolve(null);
    const replaced = this.inFlight;
    const effective = replaced && replaced.key === key && REASON_WEIGHT[replaced.reason] > REASON_WEIGHT[reason]
      ? replaced.reason
      : reason;
    this.cancel();
    this.clearTimer();
    this.clearSignalTimer();
    const controller = new AbortController();
    let resolve: (result: ApiResult<T> | null) => void = () => {};
    const promise = new Promise<ApiResult<T> | null>((done) => {
      resolve = done;
    });
    const request: InFlight<T> = { key, reason: effective, controller, resolve, signals: this.signals };
    this.inFlight = request;
    this.commit({ ...this.snapshot, pending: effective });
    let outcome: Promise<unknown>;
    try {
      outcome = Promise.resolve(fetcher(controller.signal));
    } catch (error) {
      outcome = Promise.resolve<ApiResult<T>>({ ok: false, error: toApiFailure(error) });
    }
    outcome.then(
      (result) => this.settle(request, isApiResult<T>(result) ? result : { ok: false, error: toApiFailure(null) }),
      (error: unknown) => this.settle(request, { ok: false, error: toApiFailure(error) }),
    );
    return promise;
  }

  private settle(request: InFlight<T>, result: ApiResult<T>): void {
    if (this.inFlight !== request) return;
    this.inFlight = null;
    this.coveredSignals = Math.max(this.coveredSignals, request.signals);
    this.settledAt = this.env.now();
    const current = this.snapshot;
    if (result.ok) {
      this.commit({
        ...current,
        data: result.data,
        dataKey: request.key,
        error: null,
        pending: null,
        lastUpdatedAt: this.settledAt,
      });
    } else if (result.error.kind === 'aborted' && current.dataKey === request.key) {
      this.commit({ ...current, pending: null });
    } else {
      this.commit({ ...current, error: result.error, pending: null });
    }
    request.resolve(result);
    this.schedule();
    this.flushSignals();
  }

  private cancel(): boolean {
    const request = this.inFlight;
    if (!request) return false;
    this.inFlight = null;
    request.controller.abort();
    request.resolve(abortedResult<T>());
    return true;
  }

  private canPoll(): boolean {
    const { key, enabled, dataKey, error } = this.snapshot;
    if (!this.active || !enabled || key === null || this.pollMs <= 0 || this.inFlight !== null) return false;
    if (dataKey !== key && error === null) return false;
    if (isHalting(error)) return false;
    return !this.env.isHidden();
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.canPoll()) return;
    const delay = Math.max(0, this.settledAt + this.pollMs - this.env.now());
    const timer: { handle: unknown } = { handle: null };
    timer.handle = this.env.setTimer(() => {
      if (this.timer !== timer) return;
      this.timer = null;
      if (this.canPoll()) void this.load('background');
    }, delay);
    this.timer = timer;
  }

  private clearTimer(): void {
    const timer = this.timer;
    if (!timer) return;
    this.timer = null;
    this.env.clearTimer(timer.handle);
  }

  private flushSignals(): void {
    this.clearSignalTimer();
    if (this.coveredSignals >= this.signals) return;
    const { key, enabled, error } = this.snapshot;
    if (key === null || !enabled || isHalting(error)) {
      this.dropSignals();
      return;
    }
    if (!this.active || this.inFlight !== null || this.env.isHidden()) return;
    const now = this.env.now();
    const wait = this.signalLoadAt === null ? 0 : this.signalLoadAt + this.signalGapMs - now;
    if (wait <= 0) {
      this.signalLoadAt = now;
      void this.load('background');
      return;
    }
    const timer: { handle: unknown } = { handle: null };
    timer.handle = this.env.setTimer(() => {
      if (this.signalTimer !== timer) return;
      this.signalTimer = null;
      this.flushSignals();
    }, wait);
    this.signalTimer = timer;
  }

  private dropSignals(): void {
    this.coveredSignals = this.signals;
    this.clearSignalTimer();
  }

  private clearSignalTimer(): void {
    const timer = this.signalTimer;
    if (!timer) return;
    this.signalTimer = null;
    this.env.clearTimer(timer.handle);
  }

  private commit(next: ResourceSnapshot<T>): void {
    this.snapshot = next;
    for (const listener of Array.from(this.listeners)) listener();
  }
}

function keeps(keepPreviousData: KeepPreviousData, previousKey: string, nextKey: string): boolean {
  return typeof keepPreviousData === 'function' ? keepPreviousData(previousKey, nextKey) : keepPreviousData;
}

const IDLE_VIEW: ResourceView<never> = {
  data: undefined,
  error: null,
  status: 'idle',
  isInitialLoading: false,
  isRefreshing: false,
  isPreviousData: false,
  lastUpdatedAt: null,
};

export function resolveResourceView<T>(
  snapshot: ResourceSnapshot<T>,
  key: string | null,
  enabled: boolean,
  keepPreviousData: KeepPreviousData = true,
): ResourceView<T> {
  if (key === null) return IDLE_VIEW;
  const own = snapshot.dataKey === key && snapshot.data !== undefined;
  const sameKey = snapshot.key === key;
  const caughtUp = sameKey && snapshot.enabled === enabled;
  const pending = caughtUp ? snapshot.pending : enabled && !own ? 'load' : null;
  const error = sameKey ? snapshot.error : null;
  const foreground = pending === 'load' || pending === 'refresh';
  const previous = !own
    && snapshot.data !== undefined
    && snapshot.dataKey !== null
    && (foreground || error !== null)
    && keeps(keepPreviousData, snapshot.dataKey, key);
  const data = own || previous ? snapshot.data : undefined;
  const status: ResourceStatus = foreground
    ? data !== undefined ? 'refreshing' : 'loading'
    : error
      ? 'error'
      : own
        ? 'success'
        : enabled
          ? 'loading'
          : 'idle';
  return {
    data,
    error,
    status,
    isInitialLoading: status === 'loading',
    isRefreshing: status === 'refreshing',
    isPreviousData: previous,
    lastUpdatedAt: data !== undefined ? snapshot.lastUpdatedAt : null,
  };
}

export function useResource<T>(
  key: string | null,
  fetcher: ResourceFetcher<T>,
  options: UseResourceOptions = {},
): UseResourceResult<T> {
  const { pollMs = 0, keepPreviousData = true, enabled = true } = options;
  const [store] = useState(() => new ResourceStore<T>());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    store.setFetcher(fetcher);
  });

  useEffect(() => {
    store.start(key, enabled);
    return () => store.stop();
  }, [store, key, enabled]);

  useEffect(() => {
    store.setPollMs(pollMs);
  }, [store, pollMs]);

  useEffect(() => {
    const onVisibility = () => store.visibilityChanged();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [store]);

  const refresh = useCallback((options?: ResourceRefreshOptions) => store.refresh(options), [store]);
  const mutate = useCallback((next: ResourceUpdater<T>) => store.mutate(next), [store]);
  const invalidate = useCallback((options?: ResourceInvalidateOptions) => store.invalidate(options), [store]);

  return { ...resolveResourceView(snapshot, key, enabled, keepPreviousData), refresh, mutate, invalidate };
}
