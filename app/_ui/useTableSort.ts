'use client';

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  dir: SortDirection;
}

export type SortParams = { sort: string; dir: SortDirection } | Record<string, never>;

export function nextSort(current: SortState | null | undefined, key: string): SortState {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

export function sortWithKey(current: SortState | null | undefined, key: string): SortState {
  return { key, dir: current?.dir ?? 'asc' };
}

export function sortToParams(sort: SortState | null | undefined): SortParams {
  return sort ? { sort: sort.key, dir: sort.dir } : {};
}

export interface UseTableSortOptions {
  value: SortState | null;
  onChange: (next: SortState | null) => void;
}

export interface UseTableSortResult {
  sort: SortState | null;
  setSort: Dispatch<SetStateAction<SortState | null>>;
  toggle: (key: string) => void;
  reset: () => void;
  toParams: () => SortParams;
}

function isOptions(value: SortState | UseTableSortOptions | null | undefined): value is UseTableSortOptions {
  return typeof value === 'object' && value !== null && typeof (value as UseTableSortOptions).onChange === 'function';
}

export function useTableSort(initial?: SortState | null): UseTableSortResult;
export function useTableSort(options: UseTableSortOptions): UseTableSortResult;
export function useTableSort(input: SortState | UseTableSortOptions | null = null): UseTableSortResult {
  const options = isOptions(input) ? input : null;
  const onChange = options?.onChange;
  const value = options ? options.value ?? null : null;
  const [initialSort] = useState<SortState | null>(() => (options ? value : (input as SortState | null)));
  const [own, setOwn] = useState<SortState | null>(initialSort);
  const sort = onChange ? value : own;

  const setSort = useCallback<Dispatch<SetStateAction<SortState | null>>>((action) => {
    if (onChange) {
      onChange(typeof action === 'function' ? action(value) : action);
      return;
    }
    setOwn(action);
  }, [onChange, value]);

  const toggle = useCallback((key: string) => {
    if (onChange) {
      onChange(nextSort(value, key));
      return;
    }
    setOwn((current) => nextSort(current, key));
  }, [onChange, value]);

  const reset = useCallback(() => {
    if (onChange) {
      onChange(initialSort);
      return;
    }
    setOwn(initialSort);
  }, [onChange, initialSort]);

  const toParams = useCallback(() => sortToParams(sort), [sort]);

  return useMemo(
    () => ({ sort, setSort, toggle, reset, toParams }),
    [sort, setSort, toggle, reset, toParams],
  );
}
