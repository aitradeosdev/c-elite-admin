'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, RotateCw } from 'lucide-react';
import {
  AccessDenied, Button, Card, CardBody, DateRangePicker, ErrorState, ExportModal, FilterBar, MobileDataList, Notice,
  PageHeader, Pagination, ResponsiveView, RowOpen, SearchInput, Select, SidePanel, StatStrip, TBody, THead, Table,
  TableEmpty, TableSkeleton, TableState, Td, Th, Tr, nextSort, useCan, useResource, useToast, useUrlState,
  type DateRangeValue, type ExportFormat, type ExportRangeValue, type MobileDataListSortOption, type SortState,
  type TableSkeletonColumn,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { describeExportWindow, printTable, resolveExportRange } from '../../lib/printExport';
import { businessDateKey, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import {
  ACTION_GROUPS, ENTITY_OPTIONS, EXPORT_CAP, PAGE_SIZE, RESULT_FILTERS, SEARCH_USER_CAP, actionLabel, entityLabel,
  isListedAction, isListedEntity, isResultFilter, isSystemEvent, resultFilterLabel, resultKind,
  type ActivityEvent, type AdminInfo,
} from './rules';
import {
  ACTIVITY_ENDPOINT, ACTIVITY_URL, PRINT_COLUMNS, actorName, adminOptionLabel, ageText, cleanSearch,
  describeFilters, exportFiltersFor, exportQuery, isFiltered, listQuery, messageOf, printCells, targetSummary,
  toEventResult, toListResult, toPrintBatch,
  type ActivityList, type ActivityView, type ExportResponse,
} from './model';
import { AdminName, EventDetail, EventSkeleton, ResultDot } from './ActivityParts';
import s from './page.module.css';

const COLUMN_COUNT = 6;
const DATE_PRESETS = ['today', '7d', '30d', 'month', 'all'] as const;
const TITLE = 'Admin activity';
const SUBTITLE = 'Every action an administrator takes in the console, as recorded in the audit log. Times are WAT.';
const BAD_LINK = 'That activity link is not valid, so nothing was opened.';
const DENIED_MESSAGE =
  'The activity log is open to super administrators and to admins granted Admin Activity. If you need it, ask a super administrator to grant it.';
const EXPORT_FAILED = 'The export could not be created.';
const EXPORT_OFFLINE = 'Could not reach the server, so the export was not created. Check your connection and try again.';
const POPUP_BLOCKED = 'Your browser blocked the print window. Allow pop-ups for this site and try again.';
const SEARCH_CAPPED = `More than ${SEARCH_USER_CAP} customers match this search, so only events about the first ${SEARCH_USER_CAP} are included. Add more of the name, username or email to narrow it.`;
const EMPTY_EVENTS: readonly ActivityEvent[] = [];
const EMPTY_ADMINS: readonly AdminInfo[] = [];

const MOBILE_SORT_OPTIONS: ReadonlyArray<MobileDataListSortOption> = [{ key: 'created_at', label: 'Recorded' }];

const SKELETON_COLUMNS: ReadonlyArray<TableSkeletonColumn> = [
  { width: 128, lines: 2 },
  { width: 112, lines: 2 },
  { width: 168, lines: 2 },
  { width: 156, lines: 2 },
  { width: 92 },
  { width: 104 },
];

function count(value: number): string {
  return value.toLocaleString('en-NG');
}

function plural(value: number, one: string, many: string): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

function takesFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  return Boolean(
    element && element.isConnected && !element.matches(':disabled') && element.getClientRects().length > 0,
  );
}

function rowFocusTarget(region: HTMLElement | null, id: string | null): HTMLElement | null {
  if (!region) return null;
  const opener = id
    ? Array.from(region.querySelectorAll<HTMLElement>('[data-row-open]')).find(
        (element) => element.dataset.rowOpen === id && takesFocus(element),
      )
    : undefined;
  return opener ?? region;
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<ActivityFallback />}>
      <ActivityLog />
    </Suspense>
  );
}

function ActivityFallback() {
  return (
    <div>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      <ResponsiveView
        desktop={
          <Card>
            <CardBody flush>
              <Table flush aria-label="Admin activity">
                <TBody>
                  <TableSkeleton colSpan={COLUMN_COUNT} rows={10} columns={SKELETON_COLUMNS} />
                </TBody>
              </Table>
            </CardBody>
          </Card>
        }
        mobile={
          <MobileDataList<ActivityEvent>
            ariaLabel="Admin activity"
            items={EMPTY_EVENTS}
            getKey={(event) => event.id}
            renderRow={(event) => ({ primary: event.id })}
            loading
            initialLoading
            skeletonRows={8}
          />
        }
      />
    </div>
  );
}

function ActivityLog() {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawId = searchParams.get('id');
  const canExport = useCan('audit.export');
  const canOpenUsers = useCan('users.read');
  const [view, setView] = useUrlState(ACTIVITY_URL);
  const openId = view.id;

  const [searchText, setSearchText] = useState(view.search);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<ExportRangeValue>('filters');
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const appliedSearch = useRef(view.search);
  const exportingRef = useRef(false);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const lastOpenRef = useRef<string | null>(openId);

  const query = useMemo(() => listQuery(view), [view]);

  const list = useResource<ActivityList>(query, (signal) => apiRequest(ACTIVITY_ENDPOINT, {
    query: new URLSearchParams(query),
    signal,
    select: toListResult,
  }));
  const { refresh: refreshList } = list;

  const listedEvent = openId ? list.data?.events.find((event) => event.id === openId) ?? null : null;
  const detail = useResource<ActivityEvent>(
    openId && !listedEvent ? `activity:${openId}` : null,
    (signal) => apiRequest(ACTIVITY_ENDPOINT, { query: { id: openId }, signal, select: toEventResult }),
    { keepPreviousData: false },
  );
  const { refresh: refreshDetail } = detail;
  const shownEvent = listedEvent ?? detail.data ?? null;

  const badLink = rawId !== null && !isUuid(rawId.trim());
  const settled = list.isPreviousData ? undefined : list.data;
  const roster = list.data?.admins ?? EMPTY_ADMINS;

  useEffect(() => {
    if (!badLink) return;
    toast.show(BAD_LINK, 'warning');
    setView((current) => current);
  }, [badLink, setView, toast]);

  useEffect(() => {
    if (openId) lastOpenRef.current = openId;
  }, [openId]);

  useEffect(() => {
    if (view.search === appliedSearch.current) return;
    appliedSearch.current = view.search;
    setSearchText(view.search);
  }, [view.search]);

  useEffect(() => {
    if (!settled || settled.events.length > 0) return;
    const lastPage = Math.max(1, Math.ceil(settled.total / PAGE_SIZE));
    setView((current) => (current.page > lastPage ? { ...current, page: lastPage } : current));
  }, [settled, setView]);

  const update = useCallback((patch: Partial<ActivityView>) => {
    setView((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  }, [setView]);

  const applySearch = useCallback((value: string) => {
    const search = cleanSearch(value);
    appliedSearch.current = search;
    setView((current) => (current.search === search ? current : { ...current, search, page: 1 }));
  }, [setView]);

  const applyRange = useCallback((range: DateRangeValue) => {
    update({ range });
  }, [update]);

  const applyResult = useCallback((value: string) => {
    update({ result: isResultFilter(value) ? value : '' });
  }, [update]);

  const clearFilters = useCallback(() => {
    setSearchText('');
    appliedSearch.current = '';
    update({ search: '', admin: null, action: '', entity: '', result: '', range: { from: null, to: null } });
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

  const openRow = useCallback((id: string) => {
    setView((current) => ({ ...current, id }));
  }, [setView]);

  const closeDrawer = useCallback(() => {
    setView((current) => ({ ...current, id: null }));
  }, [setView]);

  const drawerReturn = useCallback(() => rowFocusTarget(listRegionRef.current, lastOpenRef.current), []);

  const retryList = useCallback(() => {
    void refreshList();
  }, [refreshList]);

  const refreshAll = useCallback(() => {
    void refreshList();
    if (openId && !listedEvent) void refreshDetail();
  }, [refreshList, refreshDetail, openId, listedEvent]);

  const exportFilters = useMemo(() => exportFiltersFor(view, roster), [view, roster]);

  const downloadCsv = async (res: Response) => {
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `admin-activity-${businessDateKey(new Date())}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    const exported = Number(res.headers.get('x-export-rows') || 0);
    const matching = Number(res.headers.get('x-total-count') || exported);
    if (res.headers.get('x-export-truncated') === '1') {
      toast.show(
        `Exported ${count(exported)} of ${count(matching)} matching events. Narrow the time frame to export the rest.`,
        'warning',
      );
    } else {
      toast.show(`Exported ${plural(exported, 'event', 'events')}.`, 'success');
    }
  };

  const printPdf = async (res: Response, context: string[]): Promise<boolean> => {
    const body = (await res.json().catch(() => null)) as ExportResponse | null;
    const batch = toPrintBatch(body);
    if (!batch) {
      toast.show(messageOf(body, EXPORT_FAILED), 'error');
      return false;
    }
    const printed = printTable({
      title: 'Admin activity',
      meta: [
        ...context,
        plural(batch.rows.length, 'row', 'rows'),
        `generated ${formatBusinessDateTime(new Date())} WAT`,
      ].join(' · '),
      columns: PRINT_COLUMNS,
      rows: batch.rows.map(printCells),
    });
    if (!printed) {
      toast.show(POPUP_BLOCKED, 'warning');
      return false;
    }
    if (batch.truncated) {
      toast.show(
        `Printed ${count(batch.rows.length)} of ${count(batch.total)} matching events. Narrow the time frame to include the rest.`,
        'warning',
      );
    } else {
      toast.show(`Opened ${plural(batch.rows.length, 'event', 'events')} for printing.`, 'success');
    }
    return true;
  };

  const runExport = async (format: ExportFormat) => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(format);
    try {
      const span = resolveExportRange(exportRange, exportFilters);
      const res = await fetch(`${ACTIVITY_ENDPOINT}?${exportQuery(view, span, format)}`, { cache: 'no-store' });
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
        describeFilters(view, roster),
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
  const rows = data?.events ?? EMPTY_EVENTS;
  const total = data?.total ?? 0;
  const loaded = data !== undefined;
  const foreground = list.isInitialLoading || list.isRefreshing;
  const blocked = rows.length === 0 && listError !== null;
  const showSkeleton = list.isInitialLoading && !blocked;
  const busy = list.isRefreshing && !blocked;
  const refreshing = list.isRefreshing && !list.isPreviousData;
  const denied = listError?.status === 403 && data === undefined;
  const failuresOnPage = rows.filter((event) => resultKind(event.result) === 'failure').length;

  if (denied) {
    return (
      <div>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied message={DENIED_MESSAGE} />
      </div>
    );
  }

  const active = isFiltered(view, searchText);
  const emptyTitle = active ? 'No activity matches these filters' : 'No admin activity recorded yet';
  const emptyHint = active
    ? 'Try a different admin, action, record type, result or date range, or clear the filters.'
    : 'Every action an administrator takes in the console appears here as soon as it is recorded.';
  const clearButton = active ? (
    <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
  ) : undefined;
  const unlistedAdmin = view.admin !== null && !roster.some((admin) => admin.id === view.admin);
  const userHref = shownEvent && canOpenUsers && isUuid(shownEvent.user_id) ? `/users/${shownEvent.user_id}` : null;

  const desktopList = (
    <>
      {listError && rows.length > 0 ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          meta={list.lastUpdatedAt ? `Showing results from ${formatBusinessTime(new Date(list.lastUpdatedAt))} WAT.` : undefined}
          actions={<Button variant="ghost" size="sm" onClick={retryList}>Try again</Button>}
        >
          The activity log could not be updated. {listError.message}
        </Notice>
      ) : null}
      <Card>
        <CardBody flush>
          <Table flush aria-label="Admin activity" busy={busy}>
            <THead>
              <Tr>
                <Th sortKey="created_at" sort={view.sort} onSort={onSort}>Recorded</Th>
                <Th>Admin</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Result</Th>
                <Th>IP address</Th>
              </Tr>
            </THead>
            <TBody>
              {blocked && listError ? (
                <TableState colSpan={COLUMN_COUNT}>
                  <ErrorState
                    compact
                    title="The activity log could not be loaded"
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
                rows.map((event) => {
                  const target = targetSummary(event);
                  return (
                    <Tr key={event.id} selected={event.id === openId} onActivate={() => openRow(event.id)}>
                      <Td>
                        <div className={s.stack}>
                          <span className={s.time}>{formatBusinessDateTime(event.created_at)}</span>
                          <span className={s.sub}>{ageText(event.created_at)}</span>
                        </div>
                      </Td>
                      <Td>
                        <div className={s.stack}>
                          <AdminName event={event} />
                          {isSystemEvent(event) ? null : (
                            <span className={s.sub}>{event.admin_role || event.admin_role_title || 'Role not recorded'}</span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <div className={s.stack}>
                          <RowOpen onClick={() => openRow(event.id)} aria-haspopup="dialog" data-row-open={event.id}>
                            {actionLabel(event.action)}
                          </RowOpen>
                          <span className={s.subMono}>{event.action || '—'}</span>
                        </div>
                      </Td>
                      <Td>
                        <div className={s.stack}>
                          <span className={s.lead}>{target.primary}</span>
                          {target.secondary ? <span className={s.sub}>{target.secondary}</span> : null}
                        </div>
                      </Td>
                      <Td>
                        <ResultDot value={event.result} />
                      </Td>
                      <Td mono emphasis="secondary">{event.ip_address || '—'}</Td>
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
    <MobileDataList<ActivityEvent>
      ariaLabel="Admin activity"
      items={rows}
      getKey={(event) => event.id}
      loading={foreground}
      initialLoading={showSkeleton}
      busy={foreground && !showSkeleton}
      error={listError ? listError.message : null}
      errorTitle="The activity log could not be loaded"
      refreshErrorTitle="The activity log could not be updated"
      onRetry={retryList}
      skeletonRows={8}
      empty={{ title: emptyTitle, hint: emptyHint, actions: clearButton }}
      sortOptions={MOBILE_SORT_OPTIONS}
      sort={view.sort}
      onSortChange={onMobileSort}
      renderRow={(event) => {
        const target = targetSummary(event);
        const kind = resultKind(event.result);
        return {
          primary: actionLabel(event.action),
          secondary: `${actorName(event)} · ${target.primary}`,
          status: <ResultDot value={event.result} />,
          meta: `${formatBusinessDateTime(event.created_at)} WAT · ${ageText(event.created_at)}`,
          flag: kind === 'failure' ? 'danger' : kind === 'partial' ? 'warning' : null,
          flagLabel: kind === 'failure' ? 'Failed' : kind === 'partial' ? 'Partly completed' : undefined,
          onClick: () => openRow(event.id),
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
          { label: 'Matching events', value: loaded ? count(total) : '—', loading: showSkeleton },
          { label: 'On this page', value: loaded ? count(rows.length) : '—', loading: showSkeleton },
          {
            label: 'Failed on this page',
            value: loaded ? count(failuresOnPage) : '—',
            loading: showSkeleton,
            tone: failuresOnPage > 0 ? 'danger' : 'neutral',
          },
        ]}
      />

      <FilterBar
        aria-label="Filter admin activity"
        search={
          <SearchInput
            aria-label="Search admin activity"
            placeholder="Admin, customer, action, record ID, IP, request ID or reason"
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
              className={s.filterSelect}
              aria-label="Admin"
              value={view.admin ?? ''}
              onChange={(event) => update({ admin: event.target.value || null })}
            >
              <option value="">All admins</option>
              {unlistedAdmin && view.admin ? <option value={view.admin}>Selected admin</option> : null}
              {roster.map((admin) => (
                <option key={admin.id} value={admin.id}>{adminOptionLabel(admin)}</option>
              ))}
            </Select>
            <Select
              inline
              className={s.filterSelect}
              aria-label="Action"
              value={view.action}
              onChange={(event) => update({ action: event.target.value })}
            >
              <option value="">All actions</option>
              {view.action && !isListedAction(view.action) ? (
                <option value={view.action}>{actionLabel(view.action)}</option>
              ) : null}
              {ACTION_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <Select
              inline
              className={s.filterSelect}
              aria-label="Record type"
              value={view.entity}
              onChange={(event) => update({ entity: event.target.value })}
            >
              <option value="">All record types</option>
              {view.entity && !isListedEntity(view.entity) ? (
                <option value={view.entity}>{entityLabel(view.entity)}</option>
              ) : null}
              {ENTITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
            <Select
              inline
              className={s.filterSelect}
              aria-label="Result"
              value={view.result}
              onChange={(event) => applyResult(event.target.value)}
            >
              <option value="">Any result</option>
              {RESULT_FILTERS.map((value) => (
                <option key={value} value={value}>{resultFilterLabel(value)}</option>
              ))}
            </Select>
            <DateRangePicker value={view.range} onChange={applyRange} presets={DATE_PRESETS} legend="Recorded between" />
          </>
        }
        onClear={clearFilters}
        active={active}
      />

      {data?.searchCapped ? <p className={s.hint} role="status">{SEARCH_CAPPED}</p> : null}
      {data?.targetsNote && rows.length > 0 ? <p className={s.hint} role="status">{data.targetsNote}</p> : null}

      <div ref={listRegionRef} className={s.listRegion} tabIndex={-1} role="region" aria-label="Activity results">
        <ResponsiveView desktop={desktopList} mobile={mobileList} />
      </div>

      {loaded && !blocked ? (
        <Pagination
          page={view.page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={goToPage}
          noun="events"
          disabled={foreground}
          label="Activity pages"
          scrollTargetRef={listRegionRef}
        />
      ) : null}

      <SidePanel
        open={openId !== null}
        onClose={closeDrawer}
        wide
        title={shownEvent ? actionLabel(shownEvent.action) : 'Activity event'}
        subtitle={
          shownEvent
            ? `${formatBusinessDateTime(shownEvent.created_at)} WAT · ${actorName(shownEvent)}`
            : undefined
        }
        returnFocusTo={drawerReturn}
      >
        {shownEvent ? (
          <EventDetail event={shownEvent} userHref={userHref} />
        ) : detail.error ? (
          <ErrorState
            compact
            title={detail.error.status === 404 ? 'Activity event not found' : 'This event could not be loaded'}
            message={detail.error.message}
            requestId={detail.error.requestId}
            onRetry={() => void refreshDetail()}
            retrying={detail.isInitialLoading}
          />
        ) : (
          <EventSkeleton />
        )}
      </SidePanel>

      {canExport ? (
        <ExportModal
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          title="Export admin activity"
          subtitle="Exports the events that match the current admin, action, record type, result and search for the time frame you pick. Times are WAT."
          rowLimitNote={`Up to ${count(EXPORT_CAP)} events. You are told if an export is cut short.`}
          sensitiveNote="The CSV includes before and after values, IP addresses and user agents. Secrets such as passwords, PINs and keys are redacted."
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
