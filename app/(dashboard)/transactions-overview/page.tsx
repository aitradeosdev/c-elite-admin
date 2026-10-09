'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, RotateCw } from 'lucide-react';
import {
  AccessDenied, Button, Card, CardBody, DateRangePicker, ErrorState, ExportModal, FilterBar, MobileDataList, Money,
  Notice, PageHeader, Pagination, Ref, ResponsiveView, RowOpen, SearchInput, Select, SidePanel, StatStrip, StatusDot,
  TBody, THead, Table, TableEmpty, TableSkeleton, TableState, Td, Th, Tr, combineCodecs, dateRangeParam, formatNaira,
  stringParam, truncateRef, urlParam, useCan, usePermissions, useResource, useTableSort, useToast, useUrlState,
  uuidParam,
  type DateRangeValue, type ExportFiltersOption, type ExportRangeValue, type TableSkeletonColumn,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { describeExportWindow, printTable, resolveExportRange } from '../../lib/printExport';
import { businessDateKey, formatAge, formatBusinessDateTime, type ExportRangeDates } from '../../lib/time';
import {
  SEARCH_MAX, STATUS_OPTIONS, TYPE_GROUPS, buildExportQuery, buildListQuery, filterQuery, filtersActive,
  isKnownStatus, isKnownType, messageOf, normalizeTokens, statusText, toDetail, toListResult, tokensLabel, typeLabel,
  userHandle, validId,
  type Capabilities, type ExportResponse, type FilterState, type ListSummary, type Transaction,
} from './model';
import { DetailBody, DetailSkeleton } from './TransactionParts';
import s from './page.module.css';

const PAGE_SIZE = 50;
const COLUMN_COUNT = 6;
const DATE_PRESETS = ['today', '7d', '30d', 'month', 'all'] as const;
const SUBTITLE = 'Full audit-log view of every money movement on the platform. Times are WAT.';
const BAD_LINK = 'That transaction link is not valid. Check the ID and try again.';
const EXPORT_OFFLINE = 'Could not reach the server, so the export was not created. Check your connection and try again.';

const SKELETON_COLUMNS: ReadonlyArray<TableSkeletonColumn> = [
  { width: 120, lines: 2 },
  { width: 132, lines: 2 },
  { width: 88, align: 'right' },
  { width: 76 },
  { width: 96 },
  { width: 124, lines: 2 },
];

const SEARCH_PARAM = stringParam('search', { maxLength: SEARCH_MAX });

const TX_URL = combineCodecs({
  search: SEARCH_PARAM,
  type: urlParam('type', { parse: normalizeTokens, format: (value: string) => normalizeTokens(value) || null }),
  status: urlParam('status', { parse: normalizeTokens, format: (value: string) => normalizeTokens(value) || null }),
  range: dateRangeParam(),
  id: uuidParam('id'),
});

type FilterPatch = Partial<Omit<ReturnType<typeof TX_URL.parse>, 'id'>>;

const CLEARED: FilterPatch = { search: '', type: '', status: '', range: { from: null, to: null } };

function searchKey(value: string): string {
  return SEARCH_PARAM.parse(new URLSearchParams({ search: value }));
}

function countText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-NG') : '—';
}

function moneyText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatNaira(value) : '—';
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<ExplorerFallback />}>
      <TransactionsExplorer />
    </Suspense>
  );
}

function ExplorerFallback() {
  return (
    <div>
      <PageHeader title="Transactions" subtitle={SUBTITLE} />
      <ResponsiveView
        desktop={
          <Card>
            <CardBody flush>
              <Table flush aria-label="Transactions">
                <TBody>
                  <TableSkeleton columns={SKELETON_COLUMNS} rows={10} />
                </TBody>
              </Table>
            </CardBody>
          </Card>
        }
        mobile={
          <MobileDataList<Transaction>
            ariaLabel="Transactions"
            items={[]}
            getKey={(row) => row.id}
            renderRow={(row) => ({ primary: typeLabel(row.type) })}
            loading
            initialLoading
            skeletonRows={8}
          />
        }
      />
    </div>
  );
}

function TransactionsExplorer() {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawId = searchParams.get('id');
  const [url, setUrl] = useUrlState(TX_URL);
  const openId = url.id;

  const canExport = useCan('transactions.export');
  const { can: has } = usePermissions();
  const can = useMemo<Capabilities>(() => ({
    users: has('users.read'),
    withdrawals: has('withdrawals.read'),
    cards: has('cards.read'),
  }), [has]);

  const filters = useMemo<FilterState>(() => ({
    search: url.search,
    type: url.type,
    status: url.status,
    from: url.range.from,
    to: url.range.to,
  }), [url.search, url.type, url.status, url.range.from, url.range.to]);
  const filterKey = filterQuery(filters);

  const [searchText, setSearchText] = useState(url.search);
  const [page, setPage] = useState(1);
  const [pageScope, setPageScope] = useState(filterKey);
  if (pageScope !== filterKey) {
    setPageScope(filterKey);
    setPage(1);
  }
  const { sort, toggle: toggleSort } = useTableSort({ key: 'created_at', dir: 'desc' });
  const [summary, setSummary] = useState<ListSummary | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<ExportRangeValue>('filters');
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const wantSummary = useRef(true);
  const appliedSearch = useRef(url.search);
  const exportingRef = useRef(false);

  const listKey = useMemo(() => buildListQuery(filters, sort, page, PAGE_SIZE), [filters, sort, page]);

  const list = useResource(listKey, (signal) => apiRequest('/api/transactions', {
    query: { ...Object.fromEntries(new URLSearchParams(listKey)), summary: wantSummary.current ? '1' : '0' },
    signal,
    select: toListResult,
  }));

  const detail = useResource(
    openId ? `transaction:${openId}` : null,
    (signal) => apiRequest('/api/transactions', { query: { id: openId }, signal, select: toDetail }),
    { keepPreviousData: false },
  );

  const { refresh: refreshList } = list;
  const { refresh: refreshDetail } = detail;

  const incomingSummary = list.data?.summary ?? null;
  if (incomingSummary !== null && incomingSummary !== summary) setSummary(incomingSummary);

  const badLink = rawId !== null && validId(rawId.trim()) === null;

  useEffect(() => {
    if (!badLink) return;
    toast.show(BAD_LINK, 'warning');
    setUrl((value) => value);
  }, [badLink, setUrl, toast]);

  useEffect(() => {
    if (url.search === appliedSearch.current) return;
    appliedSearch.current = url.search;
    setSearchText(url.search);
  }, [url.search]);

  useEffect(() => {
    if (list.data?.summary) wantSummary.current = false;
  }, [list.data]);

  useEffect(() => {
    const data = list.data;
    if (!data || list.isPreviousData) return;
    const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
    if (data.transactions.length === 0 && page > lastPage) setPage(lastPage);
  }, [list.data, list.isPreviousData, page]);

  const openRow = useCallback((id: string) => setUrl((value) => ({ ...value, id })), [setUrl]);

  const closeDrawer = useCallback(() => setUrl((value) => ({ ...value, id: null })), [setUrl]);

  const updateFilters = useCallback((patch: FilterPatch) => {
    setUrl((value) => ({ ...value, ...patch }));
  }, [setUrl]);

  const applySearch = useCallback((value: string) => {
    appliedSearch.current = searchKey(value);
    updateFilters({ search: value });
  }, [updateFilters]);

  const applyRange = useCallback((next: DateRangeValue) => {
    updateFilters({ range: next });
  }, [updateFilters]);

  const clearFilters = useCallback(() => {
    appliedSearch.current = '';
    setSearchText('');
    updateFilters(CLEARED);
  }, [updateFilters]);

  const onSort = useCallback((key: string) => {
    toggleSort(key);
    setPage(1);
  }, [toggleSort]);

  const retryList = useCallback(() => {
    void refreshList();
  }, [refreshList]);

  const retryDetail = useCallback(() => {
    void refreshDetail();
  }, [refreshDetail]);

  const refresh = () => {
    wantSummary.current = true;
    void refreshList();
    void refreshDetail();
  };

  const exportFilters = useMemo<ExportFiltersOption>(
    () => ({ label: 'Current filters', from: filters.from, to: filters.to }),
    [filters.from, filters.to],
  );

  const downloadCsv = async (res: Response) => {
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `transactions-${businessDateKey(new Date())}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    const exported = Number(res.headers.get('x-export-rows') || 0);
    const matching = Number(res.headers.get('x-total-count') || exported);
    if (res.headers.get('x-export-truncated') === '1') {
      toast.show(
        `Exported ${exported.toLocaleString('en-NG')} of ${matching.toLocaleString('en-NG')} matching transactions. Narrow the time frame to export the rest.`,
        'warning',
      );
    } else {
      toast.show(`Exported ${exported.toLocaleString('en-NG')} transactions.`, 'success');
    }
  };

  const printPdf = async (res: Response, span: ExportRangeDates): Promise<boolean> => {
    const body = (await res.json().catch(() => null)) as ExportResponse | null;
    if (!body || body.success === false || !Array.isArray(body.rows)) {
      toast.show(messageOf(body, 'The export could not be created.'), 'error');
      return false;
    }
    const printed = printTable({
      title: 'Transactions',
      meta: [
        span.label,
        describeExportWindow(span),
        `${body.rows.length.toLocaleString('en-NG')} rows`,
        `generated ${formatBusinessDateTime(new Date())} WAT`,
      ].join(' · '),
      columns: ['Transaction ID', 'User', 'Email', 'Type', 'Amount', 'Status', 'Reference', 'Created (WAT)'],
      rows: body.rows.map((r) => [
        r.ID, r.User, r.Email, typeLabel(r.Type), formatNaira(r.Amount), statusText(r.Status), r.Reference,
        r.DateLagos || formatBusinessDateTime(r.Date),
      ]),
    });
    if (!printed) {
      toast.show('Your browser blocked the print window. Allow pop-ups for this site and try again.', 'warning');
      return false;
    }
    if (body.truncated) {
      toast.show(
        `Printed ${body.rows.length.toLocaleString('en-NG')} of ${Number(body.total ?? 0).toLocaleString('en-NG')} matching transactions. Narrow the time frame to include the rest.`,
        'warning',
      );
    } else {
      toast.show(`Opened ${body.rows.length.toLocaleString('en-NG')} transactions for printing.`, 'success');
    }
    return true;
  };

  const runExport = async (format: 'csv' | 'pdf') => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(format);
    try {
      const span = resolveExportRange(exportRange, exportFilters);
      const query = buildExportQuery(filters, sort, span, format);
      const res = await fetch(`/api/transactions?${query}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ExportResponse | null;
        if (res.status !== 401) toast.show(messageOf(body, 'The export could not be created.'), 'error');
        if (res.status === 403) router.refresh();
        return;
      }
      if (format === 'csv') {
        await downloadCsv(res);
        setExportOpen(false);
        return;
      }
      if (await printPdf(res, span)) setExportOpen(false);
    } catch {
      toast.show(EXPORT_OFFLINE, 'error');
    } finally {
      exportingRef.current = false;
      setExporting(null);
    }
  };

  const data = list.data;
  const rows = data?.transactions ?? [];
  const total = data?.total ?? 0;
  const listError = list.error;
  const foreground = list.isInitialLoading || list.isRefreshing;
  const blocked = rows.length === 0 && listError !== null;
  const showSkeleton = list.isInitialLoading && !blocked;
  const busy = list.isRefreshing;
  const refreshing = list.isRefreshing && !list.isPreviousData;
  const summaryLoading = summary === null && showSkeleton;
  const denied = listError?.status === 403;
  const notFound = detail.error?.status === 404;
  const shown = notFound ? null : detail.data?.transaction ?? rows.find((row) => row.id === openId) ?? null;
  const active = searchText.trim() !== '' || filtersActive(filters);
  const emptyTitle = active ? 'No transactions match these filters' : 'No transactions yet';
  const emptyHint = active
    ? 'Try a different search, type, status or date range, or clear the filters.'
    : 'Every credit, debit, withdrawal and bill payment appears here as soon as it is recorded.';
  const clearButton = active ? (
    <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
  ) : undefined;

  if (denied) {
    return (
      <div>
        <PageHeader title="Transactions" subtitle={SUBTITLE} />
        <AccessDenied required={['transactions.read']} />
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
          actions={<Button variant="ghost" size="sm" onClick={retryList}>Try again</Button>}
        >
          The list could not be updated. {listError.message} Showing the previous results.
        </Notice>
      ) : null}
      <Card>
        <CardBody flush>
          <Table flush aria-label="Transactions" busy={busy}>
            <THead>
              <Tr>
                <Th>Transaction</Th>
                <Th>User</Th>
                <Th align="right" sortKey="amount" sort={sort} onSort={onSort}>Amount</Th>
                <Th>Status</Th>
                <Th>Reference</Th>
                <Th sortKey="created_at" sort={sort} onSort={onSort}>Created</Th>
              </Tr>
            </THead>
            <TBody>
              {blocked && listError ? (
                <TableState colSpan={COLUMN_COUNT}>
                  <ErrorState
                    compact
                    title="Transactions could not be loaded"
                    message={listError.message}
                    requestId={listError.requestId}
                    onRetry={retryList}
                    retrying={foreground}
                  />
                </TableState>
              ) : showSkeleton ? (
                <TableSkeleton columns={SKELETON_COLUMNS} rows={10} />
              ) : rows.length === 0 ? (
                <TableEmpty colSpan={COLUMN_COUNT} title={emptyTitle} hint={emptyHint} actions={clearButton} />
              ) : (
                rows.map((row) => (
                  <Tr key={row.id} selected={row.id === openId} onActivate={() => openRow(row.id)}>
                    <Td>
                      <div className={s.stack}>
                        <RowOpen onClick={() => openRow(row.id)} aria-haspopup="dialog">
                          {typeLabel(row.type)}
                        </RowOpen>
                        <span className={s.subMono} translate="no">{truncateRef(row.id, 8)}</span>
                      </div>
                    </Td>
                    <Td>
                      <div className={s.stack}>
                        {can.users && row.user_id ? (
                          <Link href={`/users/${row.user_id}`} className={s.userLink}>
                            {userHandle(row.users, row.user_id)}
                          </Link>
                        ) : (
                          <span className={s.lead}>{userHandle(row.users, row.user_id)}</span>
                        )}
                        <span className={s.sub}>{row.users?.full_name || row.users?.email || '—'}</span>
                      </div>
                    </Td>
                    <Td align="right">
                      <Money value={row.amount} emphasis="primary" />
                    </Td>
                    <Td>
                      <StatusDot status={row.status || 'unknown'} />
                    </Td>
                    <Td>
                      <Ref value={row.reference_id} label="reference" size="sm" emphasis="secondary" />
                    </Td>
                    <Td>
                      <div className={s.stack}>
                        <span className={s.time}>{formatBusinessDateTime(row.created_at)}</span>
                        <span className={s.sub}>{formatAge(row.created_at)} ago</span>
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
    <MobileDataList<Transaction>
      ariaLabel="Transactions"
      items={rows}
      getKey={(row) => row.id}
      loading={foreground}
      initialLoading={showSkeleton}
      busy={foreground && !showSkeleton}
      error={listError ? listError.message : null}
      errorTitle="Transactions could not be loaded"
      onRetry={retryList}
      skeletonRows={8}
      empty={{ title: emptyTitle, hint: emptyHint, actions: clearButton }}
      renderRow={(row) => ({
        primary: typeLabel(row.type),
        value: <Money value={row.amount} />,
        secondary: userHandle(row.users, row.user_id),
        status: <StatusDot status={row.status || 'unknown'} />,
        meta: `${formatBusinessDateTime(row.created_at)} · ${formatAge(row.created_at)} ago`,
        onClick: () => openRow(row.id),
      })}
    />
  );

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle={SUBTITLE}
        actions={
          <div className={s.headerActions}>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCw size={14} />}
              loading={refreshing}
              onClick={refresh}
            >
              Refresh
            </Button>
            {canExport ? (
              <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={() => setExportOpen(true)}>
                Export
              </Button>
            ) : null}
          </div>
        }
      />

      <StatStrip
        items={[
          { label: 'Matching', value: data ? countText(total) : '—', loading: showSkeleton },
          { label: 'All transactions', value: countText(summary?.stats?.totalCount), loading: summaryLoading },
          {
            label: 'Total volume · any status',
            value: moneyText(summary?.stats?.totalAmount),
            mono: true,
            loading: summaryLoading,
            loadingWidth: '7em',
          },
          { label: 'Today · WAT', value: countText(summary?.today?.count), loading: summaryLoading },
          {
            label: 'Successful volume today',
            value: moneyText(summary?.today?.success_volume),
            mono: true,
            loading: summaryLoading,
            loadingWidth: '7em',
          },
        ]}
      />

      {summary?.error ? (
        <p className={s.hint} role="status">{summary.error} Use Refresh to try again.</p>
      ) : null}

      <FilterBar
        aria-label="Filter transactions"
        search={
          <SearchInput
            aria-label="Search transactions"
            placeholder="Name, username, email, transaction ID or reference"
            value={searchText}
            onChange={setSearchText}
            onDebouncedChange={applySearch}
            loading={busy}
          />
        }
        filters={
          <>
            <Select
              inline
              aria-label="Transaction type"
              value={filters.type}
              onChange={(event) => updateFilters({ type: event.target.value })}
            >
              <option value="">All types</option>
              {TYPE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((entry) => (
                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                  ))}
                </optgroup>
              ))}
              {filters.type && !isKnownType(filters.type) ? (
                <option value={filters.type}>{tokensLabel(filters.type, typeLabel)}</option>
              ) : null}
            </Select>
            <Select
              inline
              aria-label="Status"
              value={filters.status}
              onChange={(event) => updateFilters({ status: event.target.value })}
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
              {filters.status && !isKnownStatus(filters.status) ? (
                <option value={filters.status}>{tokensLabel(filters.status, statusText)}</option>
              ) : null}
            </Select>
            <DateRangePicker
              value={url.range}
              onChange={applyRange}
              presets={DATE_PRESETS}
              legend="Created between"
            />
          </>
        }
        onClear={clearFilters}
        active={active}
      />

      {data?.searchCapped ? (
        <p className={s.hint} role="status">
          More than 100 users match this search, so only transactions for the first 100 are listed. Add more of the
          name, username or email to narrow it.
        </p>
      ) : null}

      <ResponsiveView desktop={desktopList} mobile={mobileList} />

      {data && !blocked ? (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          noun="transactions"
          disabled={foreground}
          label="Transaction pages"
        />
      ) : null}

      <SidePanel
        open={openId !== null}
        onClose={closeDrawer}
        title="Transaction"
        subtitle={shown ? `${typeLabel(shown.type)} · ${userHandle(shown.users, shown.user_id)}` : undefined}
      >
        {shown ? (
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
            <div aria-busy={detail.isInitialLoading || detail.isRefreshing || undefined}>
              <DetailBody transaction={shown} can={can} />
            </div>
          </>
        ) : detail.error ? (
          <ErrorState
            compact
            title={notFound ? 'Transaction not found' : 'This transaction could not be loaded'}
            message={detail.error.message}
            requestId={detail.error.requestId}
            onRetry={retryDetail}
            retrying={detail.isInitialLoading}
          />
        ) : (
          <DetailSkeleton />
        )}
      </SidePanel>

      {canExport ? (
        <ExportModal
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          title="Export transactions"
          subtitle="Exports transactions matching the current search, type and status for the time frame you pick."
          rowLimitNote="Up to 50,000 rows. You are told if an export is cut short."
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
