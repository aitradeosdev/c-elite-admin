'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { isUuid } from '../lib/http';
import { isBusinessDateKey } from '../lib/time';
import type { DateRangeValue } from './DateRangePicker';
import type { SortDirection, SortState } from './useTableSort';

export type UrlParamValues = Record<string, string | null>;

export interface UrlCodec<T> {
  parse(params: URLSearchParams): T;
  serialize(value: T): UrlParamValues;
}

export type UrlCodecValue<C> = C extends UrlCodec<infer V> ? V : never;

export type UrlCodecShape = Record<string, UrlCodec<unknown>>;

export type UrlCodecShapeValue<S extends UrlCodecShape> = { [K in keyof S]: UrlCodecValue<S[K]> };

export type UrlStateMode = 'replace' | 'push';

export type UrlStateUpdate<T> = T | ((previous: T) => T);

export type UrlStateSetter<T> = (next: UrlStateUpdate<T>, mode?: UrlStateMode) => void;

export interface UrlParamSpec<V> {
  parse(raw: string | null): V;
  format(value: V): string | null;
}

export interface StringParamOptions {
  default?: string;
  maxLength?: number;
}

export interface IntParamOptions {
  min?: number;
  max?: number;
  default: number;
}

export interface SortParamOptions<D extends SortState | null> {
  allowed: readonly string[];
  default: D;
  sortName?: string;
  dirName?: string;
}

export interface UrlSyncState {
  observed: string;
  intended: string;
  pending: readonly string[];
}

export interface UrlLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface UrlWritePlan {
  query: string;
  url: string;
}

export function urlParam<V>(name: string, spec: UrlParamSpec<V>): UrlCodec<V> {
  return {
    parse: (params) => spec.parse(params.get(name)),
    serialize: (value) => ({ [name]: spec.format(value) }),
  };
}

export function stringParam(name: string, options: string | StringParamOptions = {}): UrlCodec<string> {
  const { default: fallback = '', maxLength } = typeof options === 'string' ? { default: options } : options;
  const limit = maxLength !== undefined && Number.isFinite(maxLength) && maxLength >= 0 ? Math.floor(maxLength) : null;
  const clean = (value: unknown): string => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return limit === null ? trimmed : trimmed.slice(0, limit).trim();
  };
  return urlParam<string>(name, {
    parse: (raw) => clean(raw) || fallback,
    format: (value) => {
      const text = clean(value);
      return text === '' || text === fallback ? null : text;
    },
  });
}

export function intParam(name: string, options: IntParamOptions): UrlCodec<number> {
  const min = options.min ?? Number.MIN_SAFE_INTEGER;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  const fallback = options.default;
  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  return urlParam<number>(name, {
    parse: (raw) => {
      const text = (raw ?? '').trim();
      if (!/^-?\d+$/.test(text)) return fallback;
      const value = Number(text);
      return Number.isSafeInteger(value) ? clamp(value) : fallback;
    },
    format: (value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      const next = clamp(Math.trunc(value));
      return next === fallback ? null : String(next);
    },
  });
}

export function enumParam<const V extends string, D extends V | '' | null = V>(
  name: string,
  values: readonly V[],
  fallback: D,
): UrlCodec<V | D> {
  const allowed = new Set<string>(values);
  return urlParam<V | D>(name, {
    parse: (raw) => {
      const text = (raw ?? '').trim();
      return allowed.has(text) ? (text as V) : fallback;
    },
    format: (value) => (value === fallback || value === null || value === '' || !allowed.has(value) ? null : value),
  });
}

export function uuidParam(name: string): UrlCodec<string | null> {
  const clean = (value: string | null): string | null => {
    const text = typeof value === 'string' ? value.trim() : '';
    return isUuid(text) ? text.toLowerCase() : null;
  };
  return urlParam<string | null>(name, { parse: clean, format: clean });
}

export function dateParam(name: string): UrlCodec<string | null> {
  const clean = (value: string | null): string | null => (isBusinessDateKey(value) ? value : null);
  return urlParam<string | null>(name, { parse: clean, format: clean });
}

export function dateRangeParam(fromName = 'date_from', toName = 'date_to'): UrlCodec<DateRangeValue> {
  const clean = (from: string | null | undefined, to: string | null | undefined): DateRangeValue => {
    const start = isBusinessDateKey(from) ? from : null;
    const end = isBusinessDateKey(to) ? to : null;
    return start !== null && end !== null && start > end ? { from: null, to: null } : { from: start, to: end };
  };
  return {
    parse: (params) => clean(params.get(fromName), params.get(toName)),
    serialize: (value) => {
      const range = clean(value?.from, value?.to);
      return { [fromName]: range.from, [toName]: range.to };
    },
  };
}

export function sortParam<D extends SortState | null>(options: SortParamOptions<D>): UrlCodec<SortState | D> {
  const { allowed, default: fallback, sortName = 'sort', dirName = 'dir' } = options;
  const keys = new Set(allowed);
  const base: SortState | null = fallback;
  const isDefault = (value: SortState | null): boolean => (
    base === null ? value === null : value !== null && value.key === base.key && value.dir === base.dir
  );
  return {
    parse: (params) => {
      const key = (params.get(sortName) ?? '').trim();
      if (!keys.has(key)) return fallback;
      const raw = params.get(dirName);
      const dir: SortDirection = raw === 'asc' || raw === 'desc' ? raw : base?.dir ?? 'asc';
      const parsed: SortState = { key, dir };
      return isDefault(parsed) ? fallback : parsed;
    },
    serialize: (value) => {
      if (!value || !keys.has(value.key) || isDefault(value)) return { [sortName]: null, [dirName]: null };
      return { [sortName]: value.key, [dirName]: value.dir };
    },
  };
}

export function combineCodecs<S extends UrlCodecShape>(shape: S): UrlCodec<UrlCodecShapeValue<S>> {
  const fields = Object.keys(shape);
  return {
    parse: (params) => {
      const value: Record<string, unknown> = {};
      for (const field of fields) value[field] = shape[field].parse(params);
      return value as UrlCodecShapeValue<S>;
    },
    serialize: (value) => {
      const values: UrlParamValues = {};
      const record = value as Record<string, unknown>;
      for (const field of fields) Object.assign(values, shape[field].serialize(record[field]));
      return values;
    },
  };
}

export function mergeUrlQuery(current: string, values: UrlParamValues): string {
  const params = new URLSearchParams(current);
  for (const [name, value] of Object.entries(values)) {
    if (value == null || value === '') params.delete(name);
    else params.set(name, value);
  }
  return params.toString();
}

export function reconcileUrlSync(state: UrlSyncState, observed: string): UrlSyncState {
  if (observed === state.observed) return state;
  const index = state.pending.lastIndexOf(observed);
  if (index >= 0) return { observed, intended: state.intended, pending: state.pending.slice(index + 1) };
  return { observed, intended: observed, pending: [] };
}

export function recordUrlWrite(state: UrlSyncState, query: string): UrlSyncState {
  if (query === state.observed) return { observed: state.observed, intended: query, pending: [] };
  return { observed: state.observed, intended: query, pending: [...state.pending, query] };
}

export function planUrlWrite<T>(
  codec: UrlCodec<T>,
  location: UrlLocation,
  next: UrlStateUpdate<T>,
): UrlWritePlan | null {
  const current = new URLSearchParams(location.search).toString();
  const value = typeof next === 'function'
    ? (next as (previous: T) => T)(codec.parse(new URLSearchParams(current)))
    : next;
  const query = mergeUrlQuery(current, codec.serialize(value));
  if (query === current) return null;
  return { query, url: `${location.pathname}${query ? `?${query}` : ''}${location.hash}` };
}

export function useUrlState<T>(codec: UrlCodec<T>): [T, UrlStateSetter<T>] {
  const searchParams = useSearchParams();
  const observed = searchParams?.toString() ?? '';
  const [sync, setSync] = useState<UrlSyncState>(() => ({ observed, intended: observed, pending: [] }));
  const current = reconcileUrlSync(sync, observed);
  if (current !== sync) setSync(current);
  const codecRef = useRef(codec);
  const unmounted = useRef(false);

  useEffect(() => {
    codecRef.current = codec;
  });

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  const value = useMemo(() => codec.parse(new URLSearchParams(current.intended)), [codec, current.intended]);

  const set = useCallback<UrlStateSetter<T>>((next, mode = 'replace') => {
    if (typeof window === 'undefined' || unmounted.current) return;
    const plan = planUrlWrite(codecRef.current, window.location, next);
    if (!plan) return;
    if (mode === 'push') window.history.pushState(null, '', plan.url);
    else window.history.replaceState(null, '', plan.url);
    setSync((state) => recordUrlWrite(state, plan.query));
  }, []);

  return [value, set];
}
