'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AccessDenied, Avatar, Button, Card, CardBody, DateRangePicker, ErrorState, FilterBar, MobileDataList, Money, Notice,
  PageHeader, Pagination, ResponsiveView, RowOpen, SearchInput, Select, SidePanel, TBody, THead, Table, TableEmpty,
  TableSkeleton, TableState, Tabs, Td, Th, Tr, formatNaira, nextSort, useCan, useConfirm, useResource, useToast,
  useUrlState,
  type DateRangeValue, type MobileDataListSortOption, type SortState, type TableSkeletonColumn,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { formatAge, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import { typeLabel } from '../transactions-overview/model';
import {
  FLAG_ACTIONS, PAGE_SIZE, READ_DENIED, REASON_MAX, TABS, actionConsequences, actionMessage, actionsFor,
  classifyResolution, listQuery, readFailureText, resolutionToast, sameStatusScope, settleWithin, tabCount, tabSpec,
  toDetail, toListResult, typeOptions, unavailableText, userHandle, userName,
  type DetailResult, type Flag, type FlagAction, type FlagTab, type ResolutionOutcome, type StatusCounts,
} from './model';
import { FLAGS_URL, searchKey } from './flagsUrl';
import {
  FlagActions, FlagDetailBody, FlagDetailSkeleton, FlagStatusDot, FlagUserCell, confirmDetails,
} from './FlagParts';
import s from './page.module.css';

const TITLE = 'Flagged transactions';
const SUBTITLE = 'Transactions the risk rules flagged for a second look. Refreshes every 15 seconds; times are WAT.';
const POLL_MS = 15000;
const SETTLE_WAIT_MS = 3000;
const COLUMN_COUNT = 5;
const ALL_TIME: DateRangeValue = { from: null, to: null };
const DATE_PRESETS = ['today', '7d', '30d', 'month', 'all'] as const;
const BAD_LINK = 'That flag link is not valid, so nothing was opened.';
const PENDING_LABEL = 'Recording your review…';

const SKELETON_COLUMNS: readonly TableSkeletonColumn[] = [
  { width: 200, lines: 2 },
  { width: 132, lines: 2, avatar: true },
  { width: 84, align: 'right' },
  { width: 120, lines: 2 },
  { width: 104, lines: 2 },
];

const MOBILE_SORT_OPTIONS: readonly MobileDataListSortOption[] = [
  { key: 'created_at', label: 'Raised' },
  { key: 'amount', label: 'Amount' },
];

function takesFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  return Boolean(
    element && element.isConnected && !element.matches(':disabled') && element.getClientRects().length > 0,
  );
}

function rowFocusTarget(region: HTMLElement | null, id: string | null): HTMLElement | null {
  if (!region) return null;
  const own = Array.from(region.querySelectorAll<HTMLElement>('[data-row-open]'))
    .filter(takesFocus)
    .find((element) => element.dataset.rowOpen === id);
  return own ?? region;
}

function rowLabel(row: Flag): string {
  const amount = row.amount === null ? 'no amount' : formatNaira(row.amount);
  return `, ${userHandle(row.user, row.user_id)}, ${amount}`;
}

export default function FlaggedTransactionsPage() {
  return (
    <Suspense fallback={<FlagsFallback />}>
      <FlagsQueue />
    </Suspense>
  );
}

function FlagsFallback() {
  return (
    <div>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      <ResponsiveView
        desktop={
          <Card>
            <CardBody flush>
              <Table flush aria-label={TITLE}>
                <TBody>
                  <TableSkeleton columns={SKELETON_COLUMNS} rows={8} />
                </TBody>
              </Table>
            </CardBody>
          </Card>
        }
        mobile={
          <MobileDataList<Flag>
            ariaLabel={TITLE}
            items={[]}
            getKey={(row) => row.id}
            renderRow={(row) => ({ primary: row.flag_reason || row.id })}
            loading
            initialLoading
            skeletonRows={8}
          />
        }
      />
    </div>
  );
}

function FlagsQueue() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawId = searchParams.get('id');
  const [url, setUrl] = useUrlState(FLAGS_URL);
  const openId = url.id;

  const canResolve = useCan('flags.resolve');
  const canUsers = useCan('users.read');
  const canWithdrawals = useCan('withdrawals.read');

  const [searchText, setSearchText] = useState(url.search);
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [types, setTypes] = useState<string[] | null>(null);
  const [acting, setActing] = useState<FlagAction | null>(null);

  const appliedSearch = useRef(url.search);
  const wantTypes = useRef(true);
  const actingRef = useRef(false);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const drawerBodyRef = useRef<HTMLDivElement>(null);
  const lastOpenRef = useRef<string | null>(openId);
  const syncedRef = useRef<string | null>(null);

  const listKey = useMemo(() => listQuery(url, PAGE_SIZE), [url]);

  const list = useResource(
    listKey,
    (signal) => apiRequest('/api/flagged-transactions', {
      query: { ...Object.fromEntries(new URLSearchParams(listKey)), types: wantTypes.current ? '1' : null },
      signal,
      select: toListResult,
    }),
    { pollMs: POLL_MS, keepPreviousData: sameStatusScope },
  );

  const detail = useResource(
    openId ? `flag:${openId}` : null,
    (signal) => apiRequest('/api/flagged-transactions', { query: { id: openId }, signal, select: toDetail }),
    { keepPreviousData: false },
  );

  const { refresh: refreshList } = list;
  const { refresh: refreshDetail, mutate: mutateDetail } = detail;

  const incomingCounts = list.data?.counts ?? null;
  if (incomingCounts !== null && incomingCounts !== counts) setCounts(incomingCounts);
  const incomingTypes = list.data?.types ?? null;
  if (incomingTypes !== null && incomingTypes !== types) setTypes(incomingTypes);

  const badLink = rawId !== null && !isUuid(rawId.trim());

  useEffect(() => {
    if (!badLink) return;
    toast.show(BAD_LINK, 'warning');
    setUrl((value) => value);
  }, [badLink, setUrl, toast]);

  useEffect(() => {
    if (list.data?.types) wantTypes.current = false;
  }, [list.data]);

  useEffect(() => {
    if (url.search === appliedSearch.current) return;
    appliedSearch.current = url.search;
    setSearchText(url.search);
  }, [url.search]);

  useEffect(() => {
    if (openId) lastOpenRef.current = openId;
  }, [openId]);

  useEffect(() => {
    const data = list.data;
    if (!data || list.isPreviousData) return;
    const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
    if (data.flags.length === 0 && url.page > lastPage) setUrl((value) => ({ ...value, page: lastPage }));
  }, [list.data, list.isPreviousData, url.page, setUrl]);

  useEffect(() => {
    const shown = detail.data?.flag;
    const match = shown ? list.data?.flags.find((row) => row.id === shown.id) : undefined;
    if (!shown || !match || match.status === shown.status) return;
    const mark = `${shown.id}:${shown.status}:${match.status}`;
    if (syncedRef.current === mark) return;
    syncedRef.current = mark;
    void refreshDetail({ background: true });
  }, [list.data, detail.data, refreshDetail]);

  const openRow = useCallback((id: string) => setUrl((value) => ({ ...value, id })), [setUrl]);

  const closeDrawer = useCallback(() => setUrl((value) => ({ ...value, id: null })), [setUrl]);

  const changeTab = useCallback((tab: FlagTab) => setUrl((value) => ({ ...value, tab, page: 1 })), [setUrl]);

  const changePage = useCallback((page: number) => setUrl((value) => ({ ...value, page })), [setUrl]);

  const applySearch = useCallback((next: string) => {
    appliedSearch.current = searchKey(next);
    setUrl((value) => ({ ...value, search: next, page: 1 }));
  }, [setUrl]);

  const applyType = useCallback((type: string) => setUrl((value) => ({ ...value, type, page: 1 })), [setUrl]);

  const applyRange = useCallback(
    (range: DateRangeValue) => setUrl((value) => ({ ...value, range, page: 1 })),
    [setUrl],
  );

  const clearFilters = useCallback(() => {
    appliedSearch.current = '';
    setSearchText('');
    setUrl((value) => ({ ...value, search: '', type: '', range: ALL_TIME, page: 1 }));
  }, [setUrl]);

  const onSort = useCallback(
    (key: string) => setUrl((value) => ({ ...value, sort: nextSort(value.sort, key), page: 1 })),
    [setUrl],
  );

  const onMobileSort = useCallback(
    (sort: SortState) => setUrl((value) => ({ ...value, sort, page: 1 })),
    [setUrl],
  );

  const retryList = useCallback(() => {
    void refreshList();
  }, [refreshList]);

  const retryDetail = useCallback(() => {
    void refreshDetail();
  }, [refreshDetail]);

  const drawerReturn = useCallback(() => rowFocusTarget(listRegionRef.current, lastOpenRef.current), []);

  const settle = () => settleWithin(
    Promise.all([refreshList({ background: true }), refreshDetail({ background: true })]),
    SETTLE_WAIT_MS,
  );

  const refreshBoth = () => {
    void refreshList({ background: true });
    void refreshDetail({ background: true });
  };

  const readOpen = async (id: string, action: FlagAction): Promise<DetailResult | null> => {
    const result = await apiRequest('/api/flagged-transactions', { query: { id }, select: toDetail });
    if (!result.ok) {
      if (result.error.status !== 401) toast.show(readFailureText(result.error), 'error');
      if (result.error.status === 403) router.refresh();
      return null;
    }
    const fresh = result.data;
    mutateDetail((previous) => (previous?.flag.id === id ? fresh : previous));
    if (!actionsFor(fresh.flag.status).includes(action)) {
      toast.show(unavailableText(fresh.flag.status, action), 'warning');
      void refreshList({ background: true });
      return null;
    }
    return fresh;
  };

  const resolveFlag = async (action: FlagAction, opener: HTMLElement | null) => {
    const id = openId;
    if (!id || actingRef.current) return;
    actingRef.current = true;
    setActing(action);
    let sent = false;
    let settled = false;
    try {
      const fresh = await readOpen(id, action);
      setActing(null);
      if (!fresh) return;
      const spec = FLAG_ACTIONS[action];
      const decision = await confirm<ResolutionOutcome>({
        tone: action === 'reject' ? 'danger' : 'default',
        title: spec.title,
        message: actionMessage(action),
        details: confirmDetails(fresh),
        consequences: actionConsequences(action, fresh),
        reason: {
          required: true,
          presets: spec.presets,
          label: spec.reasonLabel,
          placeholder: spec.placeholder,
          maxLength: REASON_MAX,
        },
        confirmLabel: spec.confirmLabel,
        pendingLabel: PENDING_LABEL,
        action: async ({ reason }) => {
          sent = true;
          const attempt = classifyResolution(
            await apiRequest('/api/flagged-transactions', {
              method: 'POST',
              body: { flag_id: id, action, reason: reason.trim() },
            }),
          );
          if (attempt.kind === 'retry') throw new Error(attempt.message);
          settled = true;
          if (attempt.kind !== 'expired') await settle();
          return attempt;
        },
        returnFocusTo: () => (takesFocus(opener) ? opener : drawerBodyRef.current),
      });
      const outcome = decision?.value;
      if (!outcome) return;
      const notice = resolutionToast(action, outcome);
      if (notice) toast.show(notice.text, notice.tone);
      if (outcome.kind === 'refused' && outcome.status === 403) router.refresh();
    } finally {
      actingRef.current = false;
      setActing(null);
      if (sent && !settled) refreshBoth();
    }
  };

  const listError = list.error;
  const shown = list.isPreviousData && listError !== null ? undefined : list.data;
  const rows = shown?.flags ?? [];
  const total = shown?.total ?? 0;
  const loaded = shown !== undefined;
  const foreground = list.isInitialLoading || list.isRefreshing;
  const blocked = rows.length === 0 && listError !== null;
  const showSkeleton = rows.length === 0 && !blocked && list.isInitialLoading;
  const tableBusy = list.isRefreshing && !showSkeleton && !blocked;
  const denied = listError?.status === 403 && shown === undefined;
  const refreshedAt = shown ? list.lastUpdatedAt : null;
  const spec = tabSpec(url.tab);
  const filtersActive = searchText.trim() !== '' || url.type !== '' || url.range.from !== null || url.range.to !== null;
  const emptyTitle = filtersActive ? 'No flags match these filters' : spec.emptyTitle;
  const emptyHint = filtersActive
    ? 'Try a different search, type or date range, or clear the filters.'
    : spec.emptyHint;
  const clearButton = filtersActive ? (
    <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
  ) : undefined;
  const tabItems = TABS.map((tab) => {
    const count = tabCount(tab.value, counts);
    return { value: tab.value, label: tab.label, count: count === null ? undefined : count.toLocaleString('en-NG') };
  });
  const typeChoices = typeOptions(types, url.type);
  const shownDetail = detail.data ?? null;
  const drawerFlag = shownDetail?.flag ?? rows.find((row) => row.id === openId) ?? null;
  const notFound = detail.error?.status === 404;

  if (denied) {
    return (
      <div>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied message={READ_DENIED} />
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
          meta={refreshedAt ? `Showing results from ${formatBusinessTime(new Date(refreshedAt))} WAT.` : undefined}
          actions={<Button variant="ghost" size="sm" onClick={retryList}>Retry now</Button>}
        >
          Live updates paused. {listError.message}
        </Notice>
      ) : null}
      <Card>
        <CardBody flush>
          <Table flush aria-label={TITLE} busy={tableBusy}>
            <THead>
              <Tr>
                <Th>Flag</Th>
                <Th>User</Th>
                <Th align="right" sortKey="amount" sort={url.sort} onSort={onSort}>Amount</Th>
                <Th sortKey="created_at" sort={url.sort} onSort={onSort}>Raised</Th>
                <Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {blocked && listError ? (
                <TableState colSpan={COLUMN_COUNT}>
                  <ErrorState
                    compact
                    title="Flagged transactions could not be loaded"
                    message={listError.message}
                    requestId={listError.requestId}
                    onRetry={retryList}
                    retrying={foreground}
                  />
                </TableState>
              ) : showSkeleton ? (
                <TableSkeleton columns={SKELETON_COLUMNS} rows={8} />
              ) : rows.length === 0 ? (
                <TableEmpty colSpan={COLUMN_COUNT} title={emptyTitle} hint={emptyHint} actions={clearButton} />
              ) : (
                rows.map((row) => (
                  <Tr key={row.id} selected={row.id === openId} onActivate={() => openRow(row.id)}>
                    <Td>
                      <div className={s.flagCell}>
                        <RowOpen onClick={() => openRow(row.id)} aria-haspopup="dialog" data-row-open={row.id}>
                          {row.flag_reason || 'No reason was recorded'}
                          <span className={s.srOnly}>{rowLabel(row)}</span>
                        </RowOpen>
                        <span className={s.sub}>{typeLabel(row.transaction_type)}</span>
                      </div>
                    </Td>
                    <Td>
                      <FlagUserCell user={row.user} userId={row.user_id} canOpen={canUsers} />
                    </Td>
                    <Td align="right">
                      <Money value={row.amount} emphasis="primary" />
                    </Td>
                    <Td>
                      <div className={s.stack}>
                        <span className={s.time}>{formatBusinessDateTime(row.created_at)}</span>
                        <span className={s.sub}>{formatAge(row.created_at)} ago</span>
                      </div>
                    </Td>
                    <Td>
                      <div className={s.stack}>
                        <FlagStatusDot status={row.status} />
                        {row.reviewed_at ? (
                          <span className={s.sub}>Reviewed {formatAge(row.reviewed_at)} ago</span>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </CardBody>
      </Card>
    </>
  );

  const mobileList = (
    <MobileDataList<Flag>
      ariaLabel={TITLE}
      items={rows}
      getKey={(row) => row.id}
      loading={foreground}
      initialLoading={showSkeleton}
      busy={foreground && !showSkeleton}
      error={listError ? listError.message : null}
      errorTitle="Flagged transactions could not be loaded"
      onRetry={retryList}
      skeletonRows={8}
      empty={{ title: emptyTitle, hint: emptyHint, actions: clearButton }}
      sortOptions={MOBILE_SORT_OPTIONS}
      sort={url.sort}
      onSortChange={onMobileSort}
      renderRow={(row) => ({
        leading: <Avatar name={userName(row.user) || userHandle(row.user, row.user_id)} decorative />,
        primary: row.flag_reason || 'No reason was recorded',
        value: <Money value={row.amount} />,
        secondary: `${userHandle(row.user, row.user_id)} · ${typeLabel(row.transaction_type)}`,
        status: <FlagStatusDot status={row.status} />,
        meta: `Raised ${formatBusinessDateTime(row.created_at)} · ${formatAge(row.created_at)} ago`,
        onClick: () => openRow(row.id),
      })}
    />
  );

  return (
    <div>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />

      <div className={s.tabsRow}>
        <Tabs<FlagTab> aria-label="Flag status" value={url.tab} onChange={changeTab} items={tabItems} />
      </div>

      <FilterBar
        aria-label="Filter flagged transactions"
        search={
          <SearchInput
            aria-label="Search flagged transactions"
            placeholder="Name, username, email or transaction ID"
            value={searchText}
            onChange={setSearchText}
            onDebouncedChange={applySearch}
            loading={list.isRefreshing}
          />
        }
        filters={
          <>
            <Select
              inline
              aria-label="Transaction type"
              value={url.type}
              onChange={(event) => applyType(event.target.value)}
            >
              <option value="">All types</option>
              {typeChoices.map((type) => (
                <option key={type} value={type}>{typeLabel(type)}</option>
              ))}
            </Select>
            <DateRangePicker value={url.range} onChange={applyRange} presets={DATE_PRESETS} legend="Raised between" />
          </>
        }
        onClear={clearFilters}
        active={filtersActive}
      />

      {shown?.searchCapped ? (
        <p className={s.hint} role="status">
          More than 100 users match this search, so only flags for the first 100 are listed. Add more of the name,
          username or email to narrow it.
        </p>
      ) : null}

      <div ref={listRegionRef} className={s.listRegion} tabIndex={-1} role="region" aria-label="Flag results">
        <ResponsiveView desktop={desktopList} mobile={mobileList} />
      </div>

      {loaded && !blocked ? (
        <Pagination
          page={url.page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={changePage}
          noun="flags"
          disabled={foreground}
          label="Flag pages"
          scrollTargetRef={listRegionRef}
        />
      ) : null}

      <SidePanel
        open={openId !== null}
        onClose={closeDrawer}
        title="Flag"
        subtitle={
          drawerFlag ? (
            <>
              {typeLabel(drawerFlag.transaction_type)} · <Money value={drawerFlag.amount} /> ·{' '}
              {userHandle(drawerFlag.user, drawerFlag.user_id)}
            </>
          ) : undefined
        }
        returnFocusTo={drawerReturn}
        footer={
          canResolve && shownDetail && actionsFor(shownDetail.flag.status).length > 0 ? (
            <FlagActions
              status={shownDetail.flag.status}
              acting={acting}
              onAction={(action, opener) => void resolveFlag(action, opener)}
            />
          ) : undefined
        }
      >
        {shownDetail ? (
          <>
            {detail.error ? (
              <Notice
                tone="warning"
                compact
                announce="polite"
                actions={<Button variant="ghost" size="sm" onClick={retryDetail}>Try again</Button>}
              >
                {detail.error.message} Showing the details loaded earlier.
              </Notice>
            ) : null}
            <div
              ref={drawerBodyRef}
              className={s.drawerBody}
              tabIndex={-1}
              aria-busy={detail.isRefreshing || undefined}
            >
              <FlagDetailBody
                detail={shownDetail}
                canResolve={canResolve}
                canUsers={canUsers}
                canWithdrawals={canWithdrawals}
              />
            </div>
          </>
        ) : detail.error ? (
          <ErrorState
            compact
            title={notFound ? 'Flag not found' : 'This flag could not be loaded'}
            message={detail.error.message}
            requestId={detail.error.requestId}
            onRetry={notFound ? undefined : retryDetail}
            retrying={detail.isInitialLoading}
          />
        ) : (
          <FlagDetailSkeleton />
        )}
      </SidePanel>
    </div>
  );
}
