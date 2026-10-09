'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, RotateCw } from 'lucide-react';
import {
  AccessDenied, Avatar, Button, Card, CardBody, DateRangePicker, ErrorState, ExportModal, FilterBar, MobileDataList,
  Money, Notice, PageHeader, Pagination, Ref, ResponsiveView, RowOpen, SearchInput, Select, StatStrip, StatusDot,
  TBody, THead, Table, TableEmpty, TableSkeleton, TableState, Td, Th, Tr, formatNaira, nextSort, useCan, useResource,
  useToast, useUrlState,
  type DateRangeValue, type ExportFormat, type ExportRangeValue, type MobileDataListSortOption, type SortState,
  type TableSkeletonColumn,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { describeExportWindow, printTable, resolveExportRange } from '../../lib/printExport';
import { useIsMobile } from '../../lib/useIsMobile';
import { businessDateKey, formatBusinessDate, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import {
  DEFAULT_SORT, PAGE_SIZE, STATUS_OPTIONS, USERS_URL, accountStatus, ageText, cleanSearch, countText, describeFilters,
  exportFiltersFor, exportQuery, fullNameOf, handleOf, isFiltered, joinedMeta, listQuery, messageOf, statusFilterOf,
  toListResult, tradesOf,
  type ExportResponse, type SummaryState, type UserList, type UserRow, type UsersView,
} from './model';
import s from './page.module.css';

const COLUMN_COUNT = 7;
const DATE_PRESETS = ['today', '7d', '30d', 'month', 'all'] as const;
const SUBTITLE = 'Every registered customer with their wallet balance and account status. Dates are WAT.';
const STRAY_LINK = 'That user link is not valid, so the full directory is shown instead.';
const SORT_FALLBACK = 'Sorting by balance is unavailable right now, so users are shown newest first.';
const EXPORT_FAILED = 'The export could not be created.';
const EXPORT_OFFLINE = 'Could not reach the server, so the export was not created. Check your connection and try again.';
const PRINT_COLUMNS = ['ID', 'Name', 'Username', 'Email', 'Phone', 'Balance', 'Trades', 'Joined (WAT)', 'Status'];

const MOBILE_SORT_OPTIONS: ReadonlyArray<MobileDataListSortOption> = [
  { key: 'created_at', label: 'Joined' },
  { key: 'balance', label: 'Balance' },
];

const SKELETON_COLUMNS: ReadonlyArray<TableSkeletonColumn> = [
  { width: 132, avatar: true, lines: 2 },
  { width: 168, lines: 2 },
  { width: 88, align: 'right' },
  { width: 28, align: 'right' },
  { width: 64 },
  { width: 88, lines: 2 },
  { width: 76 },
];

export default function UsersPage() {
  return (
    <Suspense fallback={<DirectoryFallback />}>
      <UserDirectory />
    </Suspense>
  );
}

function DirectoryFallback() {
  return (
    <div>
      <PageHeader title="Users" subtitle={SUBTITLE} />
      <ResponsiveView
        desktop={
          <Card>
            <CardBody flush>
              <Table flush aria-label="Users">
                <TBody>
                  <TableSkeleton colSpan={COLUMN_COUNT} rows={10} columns={SKELETON_COLUMNS} />
                </TBody>
              </Table>
            </CardBody>
          </Card>
        }
        mobile={
          <MobileDataList<UserRow>
            ariaLabel="Users"
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

function UserDirectory() {
  const toast = useToast();
  const isMobile = useIsMobile();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canExport = useCan('users.export');
  const [view, setView] = useUrlState(USERS_URL);

  const [searchText, setSearchText] = useState(view.search);
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<ExportRangeValue>('filters');
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const wantSummary = useRef(true);
  const appliedSearch = useRef(view.search);
  const warnedId = useRef<string | null>(null);
  const exportingRef = useRef(false);
  const listTopRef = useRef<HTMLDivElement>(null);

  const redirectId = view.id;
  const strayId = redirectId === null ? searchParams.get('id') : null;
  const query = useMemo(() => listQuery(view), [view]);

  const list = useResource<UserList>(redirectId ? null : query, async (signal) => {
    const withSummary = wantSummary.current;
    const result = await apiRequest('/api/users', {
      query: { ...Object.fromEntries(new URLSearchParams(query)), summary: withSummary ? '1' : null },
      signal,
      select: (body) => toListResult(body, withSummary),
    });
    if (result.ok && withSummary && !signal.aborted) wantSummary.current = false;
    return result;
  });
  const { refresh: refreshList } = list;

  const arrived = list.data?.summary ?? null;
  if (arrived !== null && arrived !== summary) setSummary(arrived);

  const settled = list.isPreviousData ? undefined : list.data;

  useEffect(() => {
    if (redirectId) router.replace(`/users/${redirectId}`);
  }, [redirectId, router]);

  useEffect(() => {
    if (strayId === null) {
      warnedId.current = null;
      return;
    }
    if (warnedId.current !== strayId) {
      warnedId.current = strayId;
      toast.show(STRAY_LINK, 'warning');
    }
    setView((current) => current);
  }, [strayId, setView, toast]);

  useEffect(() => {
    if (view.search === appliedSearch.current) return;
    appliedSearch.current = view.search;
    setSearchText(view.search);
  }, [view.search]);

  useEffect(() => {
    if (!settled) return;
    if (settled.sortFallback) {
      toast.show(SORT_FALLBACK, 'warning');
      setView((current) => ({ ...current, sort: DEFAULT_SORT, page: 1 }));
      return;
    }
    if (settled.users.length > 0) return;
    const lastPage = Math.max(1, Math.ceil(settled.total / PAGE_SIZE));
    setView((current) => (current.page > lastPage ? { ...current, page: lastPage } : current));
  }, [settled, setView, toast]);

  const update = useCallback((patch: Partial<UsersView>) => {
    setView((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  }, [setView]);

  const applySearch = useCallback((value: string) => {
    const search = cleanSearch(value);
    appliedSearch.current = search;
    setView((current) => (current.search === search ? current : { ...current, search, page: 1 }));
  }, [setView]);

  const applyStatus = useCallback((value: string) => {
    update({ status: statusFilterOf(value) });
  }, [update]);

  const applyRange = useCallback((next: DateRangeValue) => {
    update({ range: next });
  }, [update]);

  const clearFilters = useCallback(() => {
    setSearchText('');
    appliedSearch.current = '';
    update({ search: '', status: '', range: { from: null, to: null } });
  }, [update]);

  const onSort = useCallback((key: string) => {
    setView((current) => ({ ...current, sort: nextSort(current.sort, key), page: 1 }));
  }, [setView]);

  const onMobileSort = useCallback((next: SortState) => {
    update({ sort: next });
  }, [update]);

  const goToPage = useCallback((next: number) => {
    setView((current) => ({ ...current, page: next }));
  }, [setView]);

  const retryList = useCallback(() => {
    void refreshList();
  }, [refreshList]);

  const refreshAll = useCallback(() => {
    wantSummary.current = true;
    void refreshList();
  }, [refreshList]);

  const exportFilters = useMemo(() => exportFiltersFor(view), [view]);

  const downloadCsv = async (res: Response) => {
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `users-${businessDateKey(new Date())}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    const exported = Number(res.headers.get('x-export-rows') || 0);
    const matching = Number(res.headers.get('x-total-count') || exported);
    if (res.headers.get('x-export-truncated') === '1') {
      toast.show(
        `Exported ${exported.toLocaleString('en-NG')} of ${matching.toLocaleString('en-NG')} matching users. Narrow the time frame to export the rest.`,
        'warning',
      );
    } else {
      toast.show(`Exported ${exported.toLocaleString('en-NG')} users.`, 'success');
    }
  };

  const printPdf = async (res: Response, context: string[]): Promise<boolean> => {
    const body = (await res.json().catch(() => null)) as ExportResponse | null;
    if (!body || body.success === false || !Array.isArray(body.rows)) {
      toast.show(messageOf(body, EXPORT_FAILED), 'error');
      return false;
    }
    const printed = printTable({
      title: 'Users',
      meta: [
        ...context,
        `${body.rows.length.toLocaleString('en-NG')} rows`,
        `generated ${formatBusinessDateTime(new Date())} WAT`,
      ].join(' · '),
      columns: PRINT_COLUMNS,
      rows: body.rows.map((r) => [
        r.id,
        r.full_name,
        r.username ? `@${r.username}` : '',
        r.email,
        r.phone,
        formatNaira(r.balance),
        r.trades,
        r.joined_lagos || formatBusinessDateTime(r.joined),
        r.status,
      ]),
    });
    if (!printed) {
      toast.show('Your browser blocked the print window. Allow pop-ups for this site and try again.', 'warning');
      return false;
    }
    if (body.truncated) {
      toast.show(
        `Printed ${body.rows.length.toLocaleString('en-NG')} of ${Number(body.total ?? 0).toLocaleString('en-NG')} matching users. Narrow the time frame to include the rest.`,
        'warning',
      );
    } else {
      toast.show(`Opened ${body.rows.length.toLocaleString('en-NG')} users for printing.`, 'success');
    }
    return true;
  };

  const runExport = async (format: ExportFormat) => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(format);
    try {
      const span = resolveExportRange(exportRange, exportFilters);
      const res = await fetch(`/api/users?${exportQuery(view, span, format)}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ExportResponse | null;
        if (res.status !== 401) toast.show(messageOf(body, EXPORT_FAILED), 'error');
        if (res.status === 403) router.refresh();
        return;
      }
      if (format === 'csv') {
        await downloadCsv(res);
        setExportOpen(false);
        return;
      }
      const context = [
        describeFilters(view),
        exportRange === 'filters' ? null : span.label,
        describeExportWindow(span),
      ].filter((part): part is string => Boolean(part));
      if (await printPdf(res, context)) setExportOpen(false);
    } catch {
      toast.show(EXPORT_OFFLINE, 'error');
    } finally {
      exportingRef.current = false;
      setExporting(null);
    }
  };

  const listError = list.error;
  const data = list.data;
  const rows = data?.users ?? [];
  const total = data?.total ?? 0;
  const loaded = data !== undefined;
  const foreground = list.isInitialLoading || list.isRefreshing;
  const blocked = rows.length === 0 && listError !== null;
  const showSkeleton = list.isInitialLoading && !blocked;
  const busy = list.isRefreshing && !blocked;
  const refreshing = list.isRefreshing && !list.isPreviousData;
  const summaryLoading = summary === null && showSkeleton;
  const denied = listError?.status === 403;

  if (denied) {
    return (
      <div>
        <PageHeader title="Users" subtitle={SUBTITLE} />
        <AccessDenied required={['users.read']} />
      </div>
    );
  }

  if (redirectId) return <DirectoryFallback />;

  const active = isFiltered(view, searchText);
  const emptyTitle = active ? 'No users match these filters' : 'No users yet';
  const emptyHint = active
    ? 'Try a different search, status or join date, or clear the filters.'
    : 'Customers appear here as soon as they sign up in the CardElite app.';
  const clearButton = active ? (
    <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
  ) : undefined;

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={SUBTITLE}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCw size={14} />}
              loading={refreshing}
              onClick={refreshAll}
            >
              Refresh
            </Button>
            {canExport ? (
              <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={() => setExportOpen(true)}>
                Export
              </Button>
            ) : null}
          </>
        }
      />

      <StatStrip
        items={[
          { label: 'Matching', value: loaded ? countText(total) : '—', loading: showSkeleton },
          {
            label: 'Total users',
            value: countText(summary?.data?.total_users),
            hint: 'Excludes deleted accounts',
            loading: summaryLoading,
          },
          { label: 'Joined today', value: countText(summary?.data?.new_today), loading: summaryLoading },
          { label: 'Frozen', value: countText(summary?.data?.frozen), loading: summaryLoading },
        ]}
      />

      {summary?.error ? (
        <p className={s.hint} role="status">{summary.error} Use Refresh to try again.</p>
      ) : null}

      <FilterBar
        aria-label="Filter users"
        search={
          <SearchInput
            aria-label="Search users"
            placeholder="Name, username, email, phone or user ID"
            value={searchText}
            onChange={setSearchText}
            onDebouncedChange={applySearch}
            loading={busy}
          />
        }
        filters={
          <>
            <div className={s.filterSelect}>
              <Select aria-label="Account status" value={view.status} onChange={(event) => applyStatus(event.target.value)}>
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </div>
            <DateRangePicker
              value={view.range}
              onChange={applyRange}
              presets={DATE_PRESETS}
              legend="Joined between"
            />
          </>
        }
        onClear={clearFilters}
        active={active}
      />

      {data?.tradesPartial ? (
        <p className={s.hint} role="status">
          Trade counts could not be loaded for some users on this page, so they show as —. Use Refresh to try again.
        </p>
      ) : null}

      <div ref={listTopRef} className={s.listTop}>
        {isMobile ? (
          <MobileDataList<UserRow>
            ariaLabel="Users"
            items={rows}
            getKey={(user) => user.id}
            loading={foreground}
            initialLoading={showSkeleton}
            busy={foreground && !showSkeleton}
            error={listError ? listError.message : null}
            errorTitle="Users could not be loaded"
            refreshErrorTitle="Users could not be updated"
            onRetry={retryList}
            skeletonRows={8}
            empty={{ title: emptyTitle, hint: emptyHint, actions: clearButton }}
            sortOptions={MOBILE_SORT_OPTIONS}
            sort={view.sort}
            onSortChange={onMobileSort}
            renderRow={(user) => {
              const fullName = fullNameOf(user);
              const handle = handleOf(user);
              const status = accountStatus(user);
              const secondary = [fullName ? handle : null, user.email].filter(Boolean).join(' · ');
              return {
                leading: <Avatar src={user.avatar_url} name={fullName || handle} decorative />,
                primary: fullName || handle || 'Unnamed user',
                value: <Money value={user.balance} />,
                secondary: secondary || undefined,
                status: <StatusDot status={status.label} tone={status.tone} />,
                meta: joinedMeta(user),
                href: `/users/${user.id}`,
              };
            }}
          />
        ) : (
          <>
            {listError && rows.length > 0 ? (
              <Notice
                tone="warning"
                compact
                announce="polite"
                meta={list.lastUpdatedAt ? `Showing results from ${formatBusinessTime(new Date(list.lastUpdatedAt))} WAT.` : undefined}
                actions={<Button variant="ghost" size="sm" onClick={retryList}>Try again</Button>}
              >
                The list could not be updated. {listError.message}
              </Notice>
            ) : null}
            <Card>
              <CardBody flush>
                <Table flush aria-label="Users" busy={busy}>
                  <THead>
                    <Tr>
                      <Th sticky>User</Th>
                      <Th>Contact</Th>
                      <Th align="right" sortKey="balance" sort={view.sort} onSort={onSort}>Balance</Th>
                      <Th align="right">Trades</Th>
                      <Th>Status</Th>
                      <Th sortKey="created_at" sort={view.sort} onSort={onSort}>Joined</Th>
                      <Th>User ID</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {blocked && listError ? (
                      <TableState colSpan={COLUMN_COUNT}>
                        <ErrorState
                          compact
                          title="Users could not be loaded"
                          message={listError.message}
                          requestId={listError.requestId}
                          onRetry={retryList}
                          retrying={foreground}
                        />
                      </TableState>
                    ) : showSkeleton ? (
                      <TableSkeleton colSpan={COLUMN_COUNT} rows={10} columns={SKELETON_COLUMNS} />
                    ) : rows.length === 0 ? (
                      <TableEmpty colSpan={COLUMN_COUNT} title={emptyTitle} hint={emptyHint} actions={clearButton} />
                    ) : (
                      rows.map((user) => {
                        const fullName = fullNameOf(user);
                        const handle = handleOf(user);
                        const status = accountStatus(user);
                        const trades = tradesOf(user);
                        const href = `/users/${user.id}`;
                        return (
                          <Tr key={user.id} onActivate={() => router.push(href)}>
                            <Td sticky>
                              <div className={s.userCell}>
                                <Avatar src={user.avatar_url} name={fullName || handle} decorative />
                                <div className={s.stack}>
                                  <RowOpen href={href} prefetch={false} className={fullName ? undefined : s.nameMissing}>
                                    {fullName || handle || 'Unnamed user'}
                                  </RowOpen>
                                  <span className={fullName ? s.subMono : s.sub}>
                                    {fullName ? handle || 'No username' : 'No name on file'}
                                  </span>
                                </div>
                              </div>
                            </Td>
                            <Td>
                              <div className={s.stack}>
                                <span className={user.email ? s.lead : [s.lead, s.muted].join(' ')}>
                                  {user.email || '—'}
                                </span>
                                <span className={s.subMono}>{user.phone || '—'}</span>
                              </div>
                            </Td>
                            <Td align="right">
                              <Money value={user.balance} emphasis="primary" />
                            </Td>
                            <Td align="right" mono>
                              {trades === null ? <span className={s.muted}>—</span> : trades.toLocaleString('en-NG')}
                            </Td>
                            <Td>
                              <StatusDot status={status.label} tone={status.tone} />
                            </Td>
                            <Td>
                              <div className={s.stack}>
                                <span className={s.time} title={`${formatBusinessDateTime(user.created_at)} WAT`}>
                                  {formatBusinessDate(user.created_at)}
                                </span>
                                <span className={s.sub}>{ageText(user.created_at)}</span>
                              </div>
                            </Td>
                            <Td>
                              <Ref value={user.id} truncate={8} label="user ID" size="sm" emphasis="secondary" />
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
        )}
      </div>

      {loaded && !blocked ? (
        <Pagination
          page={view.page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={goToPage}
          noun="users"
          disabled={foreground}
          label="User pages"
          scrollTargetRef={listTopRef}
        />
      ) : null}

      {canExport ? (
        <ExportModal
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          title="Export users"
          subtitle="Exports users matching the current search and status who joined in the time frame you pick. Times are WAT."
          rowLimitNote="Up to 50,000 rows. You are told if an export is cut short."
          sensitiveNote="Includes email addresses and phone numbers."
          range={exportRange}
          onRangeChange={setExportRange}
          filtersOption={exportFilters}
          exporting={exporting}
          onCsv={() => void runExport('csv')}
          onPdf={() => void runExport('pdf')}
        />
      ) : null}
    </div>
  );
}
