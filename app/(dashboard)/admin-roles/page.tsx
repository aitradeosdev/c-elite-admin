'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  AccessDenied, Button, ErrorState, FilterBar, Notice, PageHeader, ResponsiveView, SearchInput, SidePanel,
  SkeletonLines, Tabs, usePermissions, useResource, useTableSort, useToast, useUrlState,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { formatBusinessTime } from '../../lib/time';
import {
  EMPTY_COPY, MISSING_LINK, ROLES_PATH, ROLES_URL, ROLE_TABS, SEARCH_EMPTY, SUBTITLE, TITLE, tabCounts, toRoleList,
  visibleRoles, type EditableRole, type RoleList, type RoleTab, type RoleView,
} from './model';
import { LOAD_FAILED, RoleMobileList, RoleTable } from './RoleTable';
import { RoleDetails } from './RoleDetails';
import { RoleEditor } from './RoleEditor';
import s from './page.module.css';

type EditorState = { mode: 'create'; seed: string[] } | { mode: 'edit'; role: EditableRole } | null;

const NO_ROLES: readonly RoleView[] = [];

const noop = () => {};

export default function RolesPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Roles />
    </Suspense>
  );
}

function PageFallback() {
  return (
    <div>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      <ResponsiveView
        desktop={
          <RoleTable
            rows={NO_ROLES}
            loading
            busy={false}
            error={null}
            retrying={false}
            sort={null}
            empty={EMPTY_COPY.active}
            openId={null}
            onOpen={noop}
            onRetry={noop}
            onSort={noop}
          />
        }
        mobile={
          <RoleMobileList
            rows={NO_ROLES}
            loading
            busy={false}
            error={null}
            retrying={false}
            sort={null}
            empty={EMPTY_COPY.active}
            onOpen={noop}
            onRetry={noop}
            onSortChange={noop}
          />
        }
      />
    </div>
  );
}

function Roles() {
  const { isSuperAdmin } = usePermissions();
  const { show: notify } = useToast();
  const [url, setUrl] = useUrlState(ROLES_URL);
  const [query, setQuery] = useState('');
  const { sort, setSort, toggle: toggleSort } = useTableSort(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  const list = useResource<RoleList>('admin-roles', (signal) => apiRequest(ROLES_PATH, { signal, select: toRoleList }));
  const { refresh: refreshList } = list;
  const data = list.data;
  const roles = data?.roles ?? NO_ROLES;
  const canManage = isSuperAdmin && data?.canManage === true;
  const rows = useMemo(() => visibleRoles(roles, url.tab, query, sort), [roles, url.tab, query, sort]);
  const counts = useMemo(() => tabCounts(roles), [roles]);
  const openRole = url.id ? roles.find((role) => role.id === url.id) ?? null : null;

  useEffect(() => {
    if (!url.id || !data || list.isPreviousData || openRole) return;
    notify(MISSING_LINK, 'warning');
    setUrl((value) => ({ ...value, id: null }));
  }, [url.id, data, list.isPreviousData, openRole, notify, setUrl]);

  const refreshQuietly = useCallback(() => {
    void refreshList({ background: true });
  }, [refreshList]);

  const openRow = useCallback((role: RoleView) => {
    setEditor(null);
    setUrl((value) => ({ ...value, id: role.id }));
  }, [setUrl]);

  const closePanel = useCallback(() => {
    setUrl((value) => (value.id === null ? value : { ...value, id: null }));
  }, [setUrl]);

  const changeTab = useCallback((next: RoleTab) => {
    setUrl((value) => ({ ...value, tab: next }));
  }, [setUrl]);

  const startCreate = useCallback(() => {
    setUrl((value) => (value.id === null ? value : { ...value, id: null }));
    setEditor({ mode: 'create', seed: [] });
  }, [setUrl]);

  const closeEditor = useCallback(() => setEditor(null), []);

  const rowFocus = useCallback((id: string | null) => () => {
    const region = listRegionRef.current;
    if (!region) return null;
    const opener = id
      ? Array.from(region.querySelectorAll<HTMLElement>('[data-role-open]')).find(
          (element) => element.dataset.roleOpen === id && element.getClientRects().length > 0,
        )
      : undefined;
    return opener ?? region;
  }, []);

  if (list.error?.status === 403 && data === undefined) {
    return (
      <div>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied
          title="Super administrators only"
          message="Roles are managed by super administrators. Ask one if you need to see or change a role."
        />
      </div>
    );
  }

  const listError = list.error;
  const loaded = data !== undefined;
  const foreground = list.isInitialLoading || list.isRefreshing;
  const blocked = !loaded && listError !== null;
  const showSkeleton = !loaded && !blocked;
  const tableBusy = loaded && list.isRefreshing;
  const searching = query.trim() !== '';
  const retry = () => void refreshList();
  const empty = searching
    ? {
        ...SEARCH_EMPTY,
        actions: <Button variant="secondary" size="sm" onClick={() => setQuery('')}>Clear search</Button>,
      }
    : EMPTY_COPY[url.tab];
  const tabItems = ROLE_TABS.map((item) => ({
    value: item.value,
    label: item.label,
    count: loaded ? counts[item.value].toLocaleString('en-NG') : undefined,
  }));
  const shared = {
    rows,
    loading: showSkeleton,
    busy: tableBusy,
    error: blocked ? listError : null,
    retrying: foreground,
    sort,
    empty,
    onOpen: openRow,
    onRetry: retry,
  };

  const staleNotice = listError && loaded ? (
    <Notice
      tone="warning"
      compact
      announce="polite"
      meta={list.lastUpdatedAt ? `Showing the list from ${formatBusinessTime(new Date(list.lastUpdatedAt))} WAT.` : undefined}
      actions={<Button variant="ghost" size="sm" onClick={retry}>Try again</Button>}
    >
      The list could not be refreshed. {listError.message}
    </Notice>
  ) : null;

  return (
    <div>
      <PageHeader
        title={TITLE}
        subtitle={SUBTITLE}
        actions={canManage ? (
          <Button
            ref={createButtonRef}
            variant="primary"
            size="sm"
            leftIcon={<Plus size={14} aria-hidden />}
            aria-haspopup="dialog"
            onClick={startCreate}
          >
            New role
          </Button>
        ) : undefined}
      />

      <div className={s.tabsRow}>
        <Tabs<RoleTab> aria-label="Role status" value={url.tab} onChange={changeTab} items={tabItems} />
      </div>

      <FilterBar
        aria-label="Filter roles"
        search={
          <SearchInput
            aria-label="Search roles"
            placeholder="Role name or description"
            value={query}
            onChange={setQuery}
          />
        }
        onClear={() => setQuery('')}
        active={searching}
      />

      {staleNotice}

      <div ref={listRegionRef} className={s.listRegion} tabIndex={-1} role="region" aria-label="Role list">
        <ResponsiveView
          desktop={<RoleTable {...shared} openId={url.id} onSort={toggleSort} />}
          mobile={<RoleMobileList {...shared} onSortChange={setSort} />}
        />
      </div>

      {editor ? (
        <RoleEditor
          key={editor.mode === 'edit' ? `edit:${editor.role.id}` : 'create'}
          mode={editor.mode}
          role={editor.mode === 'edit' ? editor.role : null}
          seed={editor.mode === 'create' ? editor.seed : undefined}
          onClose={closeEditor}
          onChanged={refreshQuietly}
          returnFocusTo={editor.mode === 'create' && !openRole ? () => createButtonRef.current : undefined}
        />
      ) : openRole ? (
        <RoleDetails
          key={openRole.id}
          role={openRole}
          canManage={canManage}
          onClose={closePanel}
          onEdit={(role) => setEditor({ mode: 'edit', role })}
          onDuplicate={(keys) => setEditor({ mode: 'create', seed: keys })}
          onChanged={refreshQuietly}
          returnFocusTo={rowFocus(openRole.id)}
        />
      ) : url.id && !loaded ? (
        <SidePanel open wide onClose={closePanel} title="Role" returnFocusTo={rowFocus(url.id)}>
          {blocked && listError ? (
            <ErrorState
              compact
              title={LOAD_FAILED}
              message={listError.message}
              requestId={listError.requestId}
              onRetry={retry}
              retrying={foreground}
            />
          ) : (
            <SkeletonLines rows={8} />
          )}
        </SidePanel>
      ) : null}
    </div>
  );
}
