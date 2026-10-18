'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessDenied, Button, FilterBar, PageHeader, ResponsiveView, SearchInput, Select, useResource, useUrlState,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { PERMISSION_CATEGORIES } from '../../lib/permissions';
import { RISK_ORDER } from '../../lib/grants';
import {
  CATALOG_EMPTY, DENIED_MESSAGE, DENIED_TITLE, FILTERED_EMPTY, NO_FILTERS, PERMISSIONS_PATH, PERMISSIONS_URL,
  RISK_LABEL, SEARCH_MAX, STATUS_ORDER, TITLE, categoryFilter, cleanSearch, isFiltered, riskFilter, statusFilter,
  superAdminLine, toPermissionList, visiblePermissions,
  type PermissionEntry, type PermissionList, type PermissionsView,
} from './model';
import { PermissionDetails, PermissionMobileList, PermissionTable, STATUS_LABEL } from './PermissionParts';
import s from './page.module.css';

const NO_PERMISSIONS: readonly PermissionEntry[] = [];

const noop = () => {};

export default function PermissionsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Permissions />
    </Suspense>
  );
}

function PageFallback() {
  const shared = {
    rows: NO_PERMISSIONS,
    loading: true,
    busy: false,
    error: null,
    retrying: false,
    empty: CATALOG_EMPTY,
    onOpen: noop,
    onRetry: noop,
  };
  return (
    <div>
      <PageHeader title={TITLE} subtitle={superAdminLine(null)} />
      <ResponsiveView
        desktop={<PermissionTable {...shared} openKey={null} />}
        mobile={<PermissionMobileList {...shared} />}
      />
    </div>
  );
}

function Permissions() {
  const [view, setView] = useUrlState(PERMISSIONS_URL);
  const [searchText, setSearchText] = useState(view.search);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const appliedSearch = useRef(view.search);
  const listRegionRef = useRef<HTMLDivElement>(null);

  const list = useResource<PermissionList>(
    'admin-permissions',
    (signal) => apiRequest(PERMISSIONS_PATH, { signal, select: toPermissionList }),
  );
  const { refresh: refreshList } = list;
  const data = list.data;
  const entries = data?.permissions ?? NO_PERMISSIONS;
  const rows = useMemo(() => visiblePermissions(entries, view), [entries, view]);
  const openEntry = openKey ? entries.find((entry) => entry.key === openKey) ?? null : null;

  useEffect(() => {
    if (view.search === appliedSearch.current) return;
    appliedSearch.current = view.search;
    setSearchText(view.search);
  }, [view.search]);

  const update = useCallback((patch: Partial<PermissionsView>) => {
    setView((current) => ({ ...current, ...patch }));
  }, [setView]);

  const applySearch = useCallback((value: string) => {
    const search = cleanSearch(value);
    appliedSearch.current = search;
    setView((current) => (current.search === search ? current : { ...current, search }));
  }, [setView]);

  const clearFilters = useCallback(() => {
    setSearchText('');
    appliedSearch.current = '';
    setView(NO_FILTERS);
  }, [setView]);

  const openRow = useCallback((entry: PermissionEntry) => {
    setOpenKey(entry.key);
  }, []);

  const closePanel = useCallback(() => {
    setOpenKey(null);
  }, []);

  const rowFocus = useCallback((key: string) => () => {
    const region = listRegionRef.current;
    if (!region) return null;
    const opener = Array.from(region.querySelectorAll<HTMLElement>('[data-permission-open]')).find(
      (element) => element.dataset.permissionOpen === key && element.getClientRects().length > 0,
    );
    return opener ?? region;
  }, []);

  const subtitle = superAdminLine(data ? data.superAdminCount : null);

  if (list.error?.status === 403 && data === undefined) {
    return (
      <div>
        <PageHeader title={TITLE} subtitle={subtitle} />
        <AccessDenied title={DENIED_TITLE} message={DENIED_MESSAGE} />
      </div>
    );
  }

  const listError = list.error;
  const loaded = data !== undefined;
  const foreground = list.isInitialLoading || list.isRefreshing;
  const blocked = !loaded && listError !== null;
  const showSkeleton = !loaded && !blocked;
  const retry = () => void refreshList();
  const empty = entries.length === 0
    ? CATALOG_EMPTY
    : {
        ...FILTERED_EMPTY,
        actions: <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>,
      };
  const shared = {
    rows,
    loading: showSkeleton,
    busy: loaded && list.isRefreshing,
    error: blocked ? listError : null,
    retrying: foreground,
    empty,
    onOpen: openRow,
    onRetry: retry,
  };

  return (
    <div>
      <PageHeader title={TITLE} subtitle={subtitle} />

      <FilterBar
        aria-label="Filter permissions"
        search={
          <SearchInput
            aria-label="Search permissions"
            placeholder="Permission, key or description"
            maxLength={SEARCH_MAX}
            value={searchText}
            onChange={setSearchText}
            onDebouncedChange={applySearch}
          />
        }
        filters={
          <>
            <Select
              inline
              aria-label="Category"
              value={view.category}
              onChange={(event) => update({ category: categoryFilter(event.target.value) })}
            >
              <option value="">All categories</option>
              {PERMISSION_CATEGORIES.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </Select>
            <Select
              inline
              aria-label="Risk"
              value={view.risk}
              onChange={(event) => update({ risk: riskFilter(event.target.value) })}
            >
              <option value="">All risk levels</option>
              {RISK_ORDER.map((risk) => (
                <option key={risk} value={risk}>{RISK_LABEL[risk]}</option>
              ))}
            </Select>
            <Select
              inline
              aria-label="Status"
              value={view.status}
              onChange={(event) => update({ status: statusFilter(event.target.value) })}
            >
              <option value="">All statuses</option>
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>{STATUS_LABEL[status]}</option>
              ))}
            </Select>
          </>
        }
        onClear={clearFilters}
        active={isFiltered(view, searchText)}
      />

      <div ref={listRegionRef} className={s.listRegion} tabIndex={-1} role="region" aria-label="Permission list">
        <ResponsiveView
          desktop={<PermissionTable {...shared} openKey={openKey} />}
          mobile={<PermissionMobileList {...shared} />}
        />
      </div>

      {openEntry ? (
        <PermissionDetails
          key={openEntry.key}
          entry={openEntry}
          onClose={closePanel}
          returnFocusTo={rowFocus(openEntry.key)}
        />
      ) : null}
    </div>
  );
}
