'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { nextSort, useResource, type SortState } from '../../../_ui';
import { apiRequest, type ApiBody } from '../../../lib/apiClient';
import {
  SECTIONS, planSeed, sectionQuery, sectionSeed, toSectionPage,
  type SectionKey, type SectionPage, type SectionRowMap, type SectionView,
} from './model';

export interface SectionState<T> {
  rows: T[];
  total: number | null;
  page: number;
  pageSize: number;
  sort: SortState;
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export interface UserSection<T> {
  state: SectionState<T>;
  goTo: (page: number) => void;
  sortBy: (key: string) => void;
  retry: () => void;
}

export function useUserSection<K extends SectionKey>(
  userId: string,
  key: K,
  profileBody: ApiBody | undefined,
  profileLoadedAt: number | null,
): UserSection<SectionRowMap[K]> {
  type Row = SectionRowMap[K];
  const spec = SECTIONS[key];
  const [view, setView] = useState<SectionView>(() => ({ page: 1, sort: spec.defaultSort }));
  const [seeded, setSeeded] = useState(false);
  const seededAt = useRef<number | null>(null);

  const section = useResource<SectionPage<Row>>(
    `${userId}:${key}:${view.page}:${view.sort.key}:${view.sort.dir}`,
    (signal) => apiRequest(`/api/users/${encodeURIComponent(userId)}`, {
      query: new URLSearchParams(sectionQuery(key, view.page, spec.pageSize, view.sort)),
      signal,
      select: (body) => toSectionPage<Row>(body),
    }),
    { enabled: seeded },
  );
  const { data, error, isInitialLoading, isRefreshing, isPreviousData, mutate, refresh } = section;

  useEffect(() => {
    if (!profileBody || profileLoadedAt === null || seededAt.current === profileLoadedAt) return;
    seededAt.current = profileLoadedAt;
    const seed = sectionSeed(profileBody, key);
    const plan = planSeed(spec, view, seed, seeded);
    if (plan === 'apply') mutate({ rows: seed.rows, total: seed.total });
    else if (plan === 'refresh') void refresh();
    setSeeded(true);
  }, [profileBody, profileLoadedAt, key, spec, view, seeded, mutate, refresh]);

  useEffect(() => {
    if (!data || isPreviousData || data.rows.length > 0 || data.total === null || data.total <= 0) return;
    const lastPage = Math.max(1, Math.ceil(data.total / spec.pageSize));
    if (view.page > lastPage) setView((current) => ({ ...current, page: lastPage }));
  }, [data, isPreviousData, spec.pageSize, view.page]);

  const goTo = useCallback((page: number) => {
    setView((current) => ({ ...current, page: Math.max(1, Math.floor(page) || 1) }));
  }, []);

  const sortBy = useCallback((column: string) => {
    setView((current) => ({ page: 1, sort: nextSort(current.sort, column) }));
  }, []);

  const retry = useCallback(() => {
    void refresh();
  }, [refresh]);

  return {
    state: {
      rows: data?.rows ?? [],
      total: data?.total ?? null,
      page: view.page,
      pageSize: spec.pageSize,
      sort: view.sort,
      loading: isInitialLoading || isRefreshing,
      loaded: data !== undefined || error !== null,
      error: error ? (error.kind === 'parse' ? spec.errorMessage : error.message) : null,
    },
    goTo,
    sortBy,
    retry,
  };
}
