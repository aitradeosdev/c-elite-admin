'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogOut, Pause, Play, RotateCw } from 'lucide-react';
import {
  AccessDenied, Avatar, Button, Card, CardBody, EmptyState, ErrorState, FilterBar, MobileDataList, Notice, PageHeader,
  Pagination, ResponsiveView, RowOpen, SearchInput, SidePanel, StatStrip, TBody, THead, Table, TableEmpty,
  TableSkeleton, TableState, Tabs, Td, Th, Tr, nextSort, useConfirm, usePermissions, useResource, useToast,
  useUrlState,
  type MobileDataListSortOption, type SortState, type TableSkeletonColumn,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { BUSINESS_TZ_LABEL, formatBusinessTime } from '../../lib/time';
import {
  DEFAULT_FILTER, ONLINE_LABEL, ONLINE_WINDOW_MINUTES, PAGE_SIZE, RECENT_LABEL, type ActivityFilter,
} from './rules';
import {
  ACTIVITY_URL, FILTER_TABS, POLL_SECONDS, accountState, classifyTerminate, cleanSearch, contactLine, countText,
  describeView, displayName, emptyCopy, handleOf, isFiltered, isLoaded, listQuery, liveState, pauseReason, sameFilter,
  seenText, toDetailResult, toListResult, toTerminateResult,
  type ActivityUser, type SettledTerminate, type UserDetail,
} from './model';
import { DetailBody, DetailSkeleton, DetailToolbar, JoinedCell, LiveStatus, SeenCell, StatusCell } from './ActivityParts';
import { terminateConfirm, terminateSuccess } from './confirmOptions';
import s from './page.module.css';

const POLL_MS = POLL_SECONDS * 1000;
const SETTLE_WAIT_MS = 3000;
const COLUMN_COUNT = 5;
const TITLE = 'User activity monitor';
const SUBTITLE =
  `Who is online (active in the last ${ONLINE_WINDOW_MINUTES} minutes), which devices are signed in and recent sign-ins for every customer. Super admins only; times are WAT.`;
const BAD_LINK = 'That user link is not valid, so nothing was opened.';
const DENIED_MESSAGE =
  'User activity shows live sessions, devices and sign-in history for every customer, so only super administrators can open it.';
const GONE = 'This account no longer exists, so there is nothing to sign out.';
const NOT_CONFIRMED =
  'Signing out was not confirmed. The panel is reloading so you can check which sessions are still open.';

const MOBILE_SORT_OPTIONS: ReadonlyArray<MobileDataListSortOption> = [
  { key: 'last_active_at', label: 'Last seen' },
  { key: 'created_at', label: 'Joined' },
];

const SKELETON_COLUMNS: ReadonlyArray<TableSkeletonColumn> = [
  { width: 140, avatar: true, lines: 2 },
  { width: 168, lines: 2 },
  { width: 96 },
  { width: 120, lines: 2 },
  { width: 92, lines: 2 },
];

function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    work.then(done, done);
  });
}

function takesFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  return Boolean(
    element && element.isConnected && !element.matches(':disabled') && element.getClientRects().length > 0,
  );
}

function rowFocusTarget(region: HTMLElement | null, id: string | null): HTMLElement | null {
  if (!region) return null;
  const opens = Array.from(region.querySelectorAll<HTMLElement>('[data-row-open]')).filter(takesFocus);
  return opens.find((element) => element.dataset.rowOpen === id) ?? region;
}

export default function UserActivityMonitorPage() {
  return (
    <Suspense fallback={<MonitorFallback />}>
      <ActivityMonitor />
    </Suspense>
  );
}

function MonitorFallback() {
  return (
    <div>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      <ResponsiveView
        desktop={
          <Card>
            <CardBody flush>
              <Table flush aria-label="Users by activity">
                <TBody>
                  <TableSkeleton columns={SKELETON_COLUMNS} rows={10} />
                </TBody>
              </Table>
            </CardBody>
          </Card>
        }
        mobile={
          <MobileDataList<ActivityUser>
            ariaLabel="Users by activity"
            items={[]}
            getKey={(user) => user.id}
            renderRow={(user) => ({ primary: user.id })}
            loading
            initialLoading
            skeletonRows={8}
          />
        }
      />
    </div>
  );
}

function ActivityMonitor() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isSuperAdmin } = usePermissions();
  const rawId = searchParams.get('id');
  const [view, setView] = useUrlState(ACTIVITY_URL);
  const openId = view.id;

  const [searchText, setSearchText] = useState(view.search);
  const [livePaused, setLivePaused] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [terminating, setTerminating] = useState(false);

  const terminatingRef = useRef(false);
  const appliedSearch = useRef(view.search);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const drawerBodyRef = useRef<HTMLDivElement>(null);
  const terminateRef = useRef<HTMLButtonElement>(null);
  const lastOpenRef = useRef<string | null>(openId);
  const currentOpenRef = useRef<string | null>(openId);

  const paused = pauseReason({ manual: livePaused, dialog: confirming, drawer: openId !== null });
  const listKey = useMemo(() => listQuery(view), [view]);

  const list = useResource(
    listKey,
    (signal) => apiRequest('/api/user-activity-monitor', {
      query: new URLSearchParams(listKey),
      signal,
      select: toListResult,
    }),
    { pollMs: paused ? 0 : POLL_MS, keepPreviousData: sameFilter },
  );

  const detail = useResource(
    openId ? `user-activity:${openId}` : null,
    (signal) => apiRequest(`/api/user-activity-monitor/${encodeURIComponent(openId ?? '')}`, {
      signal,
      select: toDetailResult,
    }),
    { keepPreviousData: false },
  );

  const { refresh: refreshList } = list;
  const { refresh: refreshDetail } = detail;

  const badLink = rawId !== null && !isUuid(rawId.trim());
  const settled = list.isPreviousData ? undefined : list.data;
  const denied = list.error?.status === 403 && list.data === undefined;

  useEffect(() => {
    if (!badLink) return;
    toast.show(BAD_LINK, 'warning');
    setView((current) => current);
  }, [badLink, setView, toast]);

  useEffect(() => {
    currentOpenRef.current = openId;
    if (openId) lastOpenRef.current = openId;
  }, [openId]);

  useEffect(() => {
    if (view.search === appliedSearch.current) return;
    appliedSearch.current = view.search;
    setSearchText(view.search);
  }, [view.search]);

  useEffect(() => {
    if (!settled || settled.users.length > 0) return;
    const lastPage = Math.max(1, Math.ceil(settled.total / PAGE_SIZE));
    setView((current) => (current.page > lastPage ? { ...current, page: lastPage } : current));
  }, [settled, setView]);

  const openRow = useCallback((id: string) => setView((current) => ({ ...current, id })), [setView]);

  const closeDrawer = useCallback(() => setView((current) => ({ ...current, id: null })), [setView]);

  const changeFilter = useCallback(
    (filter: ActivityFilter) => setView((current) => ({ ...current, filter, page: 1 })),
    [setView],
  );

  const applySearch = useCallback((value: string) => {
    const search = cleanSearch(value);
    appliedSearch.current = search;
    setView((current) => (current.search === search ? current : { ...current, search, page: 1 }));
  }, [setView]);

  const clearFilters = useCallback(() => {
    setSearchText('');
    appliedSearch.current = '';
    setView((current) => ({ ...current, filter: DEFAULT_FILTER, search: '', page: 1 }));
  }, [setView]);

  const onSort = useCallback((key: string) => {
    setView((current) => ({ ...current, sort: nextSort(current.sort, key), page: 1 }));
  }, [setView]);

  const onMobileSort = useCallback((next: SortState) => {
    setView((current) => ({ ...current, sort: next, page: 1 }));
  }, [setView]);

  const goToPage = useCallback((page: number) => setView((current) => ({ ...current, page })), [setView]);

  const retryList = useCallback(() => {
    void refreshList();
  }, [refreshList]);

  const retryDetail = useCallback(() => {
    void refreshDetail();
  }, [refreshDetail]);

  const drawerReturn = useCallback(() => rowFocusTarget(listRegionRef.current, lastOpenRef.current), []);

  const terminateReturn = useCallback((): HTMLElement | null => {
    if (takesFocus(terminateRef.current)) return terminateRef.current;
    if (drawerBodyRef.current?.isConnected) return drawerBodyRef.current;
    return listRegionRef.current;
  }, []);

  const reportTerminate = (outcome: SettledTerminate, user: UserDetail) => {
    switch (outcome.kind) {
      case 'done':
        if (outcome.warning) toast.show(`${terminateSuccess(user, outcome.endedSessions)} ${outcome.warning}`, 'warning');
        else toast.show(terminateSuccess(user, outcome.endedSessions), 'success');
        return;
      case 'refused':
        toast.show(outcome.message, 'error');
        if (outcome.status === 403) router.refresh();
        return;
      case 'expired':
        return;
    }
  };

  const terminate = async () => {
    if (terminatingRef.current || !openId) return;
    terminatingRef.current = true;
    setTerminating(true);
    let sent = false;
    let finished = false;
    try {
      const read = await refreshDetail();
      setTerminating(false);
      if (!read) return;
      if (!read.ok) {
        if (read.error.kind === 'aborted') return;
        if (read.error.status !== 401) toast.show(`${read.error.message} Nothing was changed.`, 'error');
        if (read.error.status === 403) router.refresh();
        return;
      }
      if (!isLoaded(read.data)) {
        toast.show(GONE, 'warning');
        return;
      }
      const target = read.data;
      const user = target.user;
      if (currentOpenRef.current?.toLowerCase() !== user.id.toLowerCase()) return;
      setConfirming(true);
      const decision = await confirm<SettledTerminate>({
        ...terminateConfirm(target),
        action: async ({ reason }) => {
          sent = true;
          const outcome = classifyTerminate(
            await apiRequest(`/api/user-activity-monitor/${encodeURIComponent(user.id)}/terminate`, {
              method: 'POST',
              body: { reason },
              select: toTerminateResult,
            }),
          );
          if (outcome.kind === 'retry') throw new Error(outcome.message);
          finished = true;
          if (outcome.kind !== 'expired') {
            await settleWithin(
              Promise.all([refreshDetail({ background: true }), refreshList({ background: true })]),
              SETTLE_WAIT_MS,
            );
          }
          return outcome;
        },
        returnFocusTo: terminateReturn,
      });
      if (decision?.value) reportTerminate(decision.value, user);
    } finally {
      terminatingRef.current = false;
      setTerminating(false);
      setConfirming(false);
      if (sent && !finished) {
        toast.show(NOT_CONFIRMED, 'error');
        void refreshDetail({ background: true });
        void refreshList({ background: true });
      }
    }
  };

  const listError = list.error;
  const shown = list.isPreviousData && listError !== null ? undefined : list.data;
  const rows = shown?.users ?? [];
  const total = shown?.total ?? 0;
  const loaded = shown !== undefined;
  const foreground = list.isInitialLoading || list.isRefreshing;
  const blocked = rows.length === 0 && listError !== null;
  const showSkeleton = rows.length === 0 && !blocked && list.isInitialLoading;
  const tableBusy = list.isRefreshing && !showSkeleton && !blocked;
  const statsLoading = list.isInitialLoading && !blocked;
  const filtersActive = isFiltered(view, searchText);
  const empty = emptyCopy(view);
  const live = liveState({ paused, failing: listError !== null, updatedAt: shown ? list.lastUpdatedAt : null });
  const loadedDetail = isLoaded(detail.data) ? detail.data : null;
  const drawerUser = loadedDetail?.user ?? (openId ? rows.find((row) => row.id === openId) ?? null : null);
  const clearButton = filtersActive ? (
    <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
  ) : undefined;

  if (denied) {
    return (
      <div>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied title="Super administrators only" message={DENIED_MESSAGE} />
      </div>
    );
  }

  const desktopList = (
    <>
      {listError && rows.length > 0 ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          meta={
            list.lastUpdatedAt
              ? `Showing activity from ${formatBusinessTime(new Date(list.lastUpdatedAt))} ${BUSINESS_TZ_LABEL}.`
              : undefined
          }
          actions={<Button variant="ghost" size="sm" onClick={retryList}>Retry now</Button>}
        >
          Live updates are failing. {listError.message}
        </Notice>
      ) : null}
      <Card>
        <CardBody flush>
          <Table flush aria-label="Users by activity" busy={tableBusy}>
            <THead>
              <Tr>
                <Th sticky>User</Th>
                <Th>Contact</Th>
                <Th>Status</Th>
                <Th sortKey="last_active_at" sort={view.sort} onSort={onSort}>Last seen</Th>
                <Th sortKey="created_at" sort={view.sort} onSort={onSort}>Joined</Th>
              </Tr>
            </THead>
            <TBody>
              {blocked && listError ? (
                <TableState colSpan={COLUMN_COUNT}>
                  <ErrorState
                    compact
                    title="User activity could not be loaded"
                    message={listError.message}
                    requestId={listError.requestId}
                    onRetry={retryList}
                    retrying={foreground}
                  />
                </TableState>
              ) : showSkeleton ? (
                <TableSkeleton columns={SKELETON_COLUMNS} rows={10} />
              ) : rows.length === 0 ? (
                <TableEmpty colSpan={COLUMN_COUNT} title={empty.title} hint={empty.hint} actions={clearButton} />
              ) : (
                rows.map((user) => {
                  const name = displayName(user);
                  return (
                    <Tr key={user.id} selected={user.id === openId} onActivate={() => openRow(user.id)}>
                      <Td sticky>
                        <div className={s.userCell}>
                          <Avatar name={name} decorative />
                          <div className={s.stack}>
                            <RowOpen onClick={() => openRow(user.id)} aria-haspopup="dialog" data-row-open={user.id}>
                              {name}
                            </RowOpen>
                            <span className={s.subMono}>
                              {user.full_name ? handleOf(user) || 'No username' : 'No name on file'}
                            </span>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <div className={s.stack}>
                          <span className={user.email ? s.lead : s.muted}>{user.email || 'No email'}</span>
                          <span className={s.subMono}>{user.phone || 'No phone'}</span>
                        </div>
                      </Td>
                      <Td>
                        <StatusCell user={user} />
                      </Td>
                      <Td>
                        <SeenCell value={user.last_active_at} />
                      </Td>
                      <Td>
                        <JoinedCell value={user.created_at} />
                      </Td>
                    </Tr>
                  );
                })
              )}
            </TBody>
          </Table>
        </CardBody>
      </Card>
    </>
  );

  const mobileList = (
    <MobileDataList<ActivityUser>
      ariaLabel="Users by activity"
      items={rows}
      getKey={(user) => user.id}
      loading={foreground}
      initialLoading={showSkeleton}
      busy={foreground && !showSkeleton}
      error={listError ? listError.message : null}
      errorTitle="User activity could not be loaded"
      refreshErrorTitle="Live updates are failing"
      onRetry={retryList}
      skeletonRows={8}
      empty={{ title: empty.title, hint: empty.hint, actions: clearButton }}
      sortOptions={MOBILE_SORT_OPTIONS}
      sort={view.sort}
      onSortChange={onMobileSort}
      renderRow={(user) => {
        const frozen = accountState(user) === 'frozen';
        return {
          leading: <Avatar name={displayName(user)} decorative />,
          primary: displayName(user),
          secondary: contactLine(user),
          status: <StatusCell user={user} />,
          meta: user.last_active_at ? `Last seen ${seenText(user.last_active_at)}` : 'Never active',
          flag: frozen ? 'danger' : null,
          flagLabel: frozen ? 'Account frozen' : undefined,
          onClick: () => openRow(user.id),
        };
      }}
    />
  );

  return (
    <div>
      <PageHeader
        title={TITLE}
        subtitle={SUBTITLE}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={livePaused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
              onClick={() => setLivePaused((value) => !value)}
            >
              {livePaused ? 'Resume updates' : 'Pause updates'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCw size={14} aria-hidden />}
              loading={list.isRefreshing && !list.isPreviousData}
              onClick={retryList}
            >
              Refresh
            </Button>
          </>
        }
      />

      <LiveStatus state={live} />

      <StatStrip
        aria-label="Activity summary"
        items={[
          {
            label: ONLINE_LABEL,
            value: countText(shown?.onlineCount),
            hint: 'Users online',
            loading: statsLoading,
            unavailable: shown !== undefined && shown.onlineCount === null,
          },
          {
            label: RECENT_LABEL,
            value: countText(shown?.recentCount),
            hint: 'Rolling, not since midnight',
            loading: statsLoading,
            unavailable: shown !== undefined && shown.recentCount === null,
          },
          {
            label: 'Matching',
            value: loaded ? countText(total) : '—',
            hint: describeView(view),
            loading: statsLoading,
          },
        ]}
      />

      <div className={s.tabsRow}>
        <Tabs<ActivityFilter>
          aria-label="Filter by activity"
          value={view.filter}
          onChange={changeFilter}
          items={FILTER_TABS}
        />
      </div>

      <FilterBar
        aria-label="Search user activity"
        search={
          <SearchInput
            aria-label="Search users"
            placeholder="Name, username, email, phone or user ID"
            value={searchText}
            onChange={setSearchText}
            onDebouncedChange={applySearch}
            loading={list.isRefreshing}
          />
        }
        onClear={clearFilters}
        active={filtersActive}
      />

      <div ref={listRegionRef} className={s.listRegion} tabIndex={-1} role="region" aria-label="User activity results">
        <ResponsiveView desktop={desktopList} mobile={mobileList} />
      </div>

      {loaded && !blocked ? (
        <Pagination
          page={view.page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={goToPage}
          noun="users"
          disabled={foreground}
          label="User activity pages"
          scrollTargetRef={listRegionRef}
        />
      ) : null}

      <SidePanel
        open={openId !== null}
        onClose={closeDrawer}
        title={drawerUser ? displayName(drawerUser) : 'User activity'}
        subtitle={drawerUser ? contactLine(drawerUser) : undefined}
        returnFocusTo={drawerReturn}
        footer={
          isSuperAdmin && loadedDetail ? (
            <div className={s.drawerActions}>
              <Button
                ref={terminateRef}
                variant="dangerSubtle"
                leftIcon={<LogOut size={14} aria-hidden />}
                loading={terminating}
                onClick={() => void terminate()}
              >
                Sign out everywhere
              </Button>
            </div>
          ) : undefined
        }
      >
        {detail.data ? (
          loadedDetail ? (
            <div ref={drawerBodyRef} className={s.drawerBody} tabIndex={-1}>
              <DetailToolbar loadedAt={detail.lastUpdatedAt} refreshing={detail.isRefreshing} onRefresh={retryDetail} />
              {detail.error ? (
                <Notice tone="warning" compact announce="polite">
                  This user could not be refreshed. {detail.error.message}
                </Notice>
              ) : null}
              <DetailBody detail={loadedDetail} />
            </div>
          ) : (
            <EmptyState
              variant="plain"
              title="User not found"
              hint="This account no longer exists. It may have been removed after the list loaded."
            />
          )
        ) : detail.error ? (
          <ErrorState
            compact
            title="This user’s activity could not be loaded"
            message={detail.error.message}
            requestId={detail.error.requestId}
            onRetry={retryDetail}
            retrying={detail.isInitialLoading}
          />
        ) : (
          <DetailSkeleton />
        )}
      </SidePanel>
    </div>
  );
}
