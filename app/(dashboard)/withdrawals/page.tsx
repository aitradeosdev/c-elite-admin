'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import {
  AccessDenied, Button, Card, CardBody, DateRangePicker, ErrorState, ExportModal, FilterBar, MaskedValue,
  MobileDataList, Money, Notice, PageHeader, Pagination, Ref, ResponsiveView, RowOpen, SearchInput, SidePanel, StatStrip,
  StatusDot, TBody, THead, Table, TableEmpty, TableSkeleton, TableState, Tabs, Td, Th, Tr, combineCodecs, enumParam,
  formatNaira, statusLabel, useCan, useConfirm, usePermissions, useResource, useTableSort, useToast, useUrlState,
  uuidParam,
  type DateRangeValue, type ExportFiltersOption, type ExportRangeValue, type TableSkeletonColumn,
} from '../../_ui';
import { apiRequest, type ApiFailure } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { describeExportWindow, printTable, resolveExportRange } from '../../lib/printExport';
import { businessDateKey, formatAge, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import {
  DEFAULT_TAB, EMERGENCY_UNCHECKED, REJECT_REASONS, TABS, approvalRefusal, classifyDecision, feeOf, grossOf,
  isActionable, isFrozen, isOpenFlag, messageOf, netOf, payoutProviderNote, providerLabel, tabSpec, toActionResult,
  toDetail, toListResult, userHandle, userSummary,
  type ApiEnvelope, type DetailResult, type ExportResponse, type SettledDecision, type Tab, type Withdrawal,
} from './model';
import {
  DetailBody, DetailSkeleton, EmergencyNotice, FlagBadge, FrozenBadge, OutcomeNotice, type Outcome,
} from './WithdrawalParts';
import s from './page.module.css';

const PAGE_SIZE = 50;
const POLL_MS = 5000;
const APPROVE_TIMEOUT_MS = 60000;
const SETTLE_WAIT_MS = 3000;
const ALL_TIME: DateRangeValue = { from: null, to: null };
const DATE_PRESETS = ['today', '7d', '30d', 'month', 'all'] as const;
const SUBTITLE = 'Payout queue across every status. Refreshes every 5 seconds; times are WAT.';
const UNKNOWN_APPROVAL =
  'The approval was sent but no usable response came back. Check this withdrawal’s status before trying again; the payout may already be on its way.';
const UNKNOWN_REJECTION =
  'The rejection was sent but no usable response came back. Check this withdrawal’s status before trying again.';
const BAD_LINK = 'That withdrawal link is not valid, so nothing was opened.';
const APPROVE_PENDING = 'Waiting for the payment provider. This can take up to a minute.';
const REJECT_PENDING = 'Rejecting and refunding the wallet…';
const EXPORT_OFFLINE = 'Could not reach the server, so the export was not created. Check your connection and try again.';
const TAB_ITEMS = TABS.map(({ value, label }) => ({ value, label }));

const WITHDRAWALS_URL = combineCodecs({
  tab: enumParam('tab', TABS.map((spec) => spec.value), DEFAULT_TAB),
  id: uuidParam('id'),
});

const SKELETON_COLUMNS: readonly TableSkeletonColumn[] = [
  { width: 120, lines: 2 },
  { width: 84, align: 'right' },
  { width: 150, lines: 2 },
  { width: 120, lines: 2 },
  { width: 92 },
  { width: 100 },
];

const DECIDE_SKELETON_COLUMNS: readonly TableSkeletonColumn[] = [
  ...SKELETON_COLUMNS,
  { width: 136, align: 'right', button: true },
];

type ActionKind = 'approve' | 'reject';

interface ActionOrigin {
  opener: HTMLElement | null;
  index: number;
  fromDrawer: boolean;
}

function skeletonColumns(canDecide: boolean): readonly TableSkeletonColumn[] {
  return canDecide ? DECIDE_SKELETON_COLUMNS : SKELETON_COLUMNS;
}

function sameTab(previousKey: string, nextKey: string): boolean {
  return new URLSearchParams(previousKey).get('status') === new URLSearchParams(nextKey).get('status');
}

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

function rowFocusTarget(region: HTMLElement | null, id: string | null, index: number): HTMLElement | null {
  if (!region) return null;
  const opens = Array.from(region.querySelectorAll<HTMLElement>('[data-row-open]')).filter(takesFocus);
  const own = id ? opens.find((element) => element.dataset.rowOpen === id) : undefined;
  if (own) return own;
  if (index >= 0 && opens.length > 0) return opens[Math.min(index, opens.length - 1)];
  return region;
}

function readFailureText(failure: ApiFailure): string {
  return failure.kind === 'http' ? failure.message : `${failure.message} Nothing was changed.`;
}

export default function WithdrawalsPage() {
  return (
    <Suspense fallback={<QueueFallback />}>
      <WithdrawalsQueue />
    </Suspense>
  );
}

function QueueFallback() {
  const canDecide = useCan(['withdrawals.approve', 'withdrawals.reject'], 'any');
  return (
    <div>
      <PageHeader title="Withdrawals" subtitle={SUBTITLE} />
      <ResponsiveView
        desktop={
          <Card>
            <CardBody flush>
              <Table flush aria-label="Withdrawals">
                <TBody>
                  <TableSkeleton columns={skeletonColumns(canDecide)} rows={8} />
                </TBody>
              </Table>
            </CardBody>
          </Card>
        }
        mobile={
          <MobileDataList<Withdrawal>
            ariaLabel="Withdrawals"
            items={[]}
            getKey={(row) => row.id}
            renderRow={(row) => ({ primary: userHandle(row.user) })}
            loading
            initialLoading
            skeletonRows={8}
          />
        }
      />
    </div>
  );
}

function WithdrawalsQueue() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawId = searchParams.get('id');
  const [url, setUrl] = useUrlState(WITHDRAWALS_URL);
  const tab = url.tab;
  const openId = url.id;

  const { isSuperAdmin } = usePermissions();
  const canApprove = useCan('withdrawals.approve');
  const canReject = useCan('withdrawals.reject');
  const canExport = useCan('withdrawals.export');
  const canDecide = canApprove || canReject;
  const columnCount = canDecide ? 7 : 6;

  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);
  const [page, setPage] = useState(1);
  const [pageTab, setPageTab] = useState<Tab>(tab);
  if (pageTab !== tab) {
    setPageTab(tab);
    setPage(1);
  }
  const { sort, toggle: toggleSort } = useTableSort({ key: 'created_at', dir: 'desc' });

  const [acting, setActing] = useState<{ id: string; kind: ActionKind } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<ExportRangeValue>('filters');
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const actingRef = useRef(false);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const drawerBodyRef = useRef<HTMLDivElement>(null);
  const lastOpenRef = useRef<string | null>(openId);
  const syncedRef = useRef<string | null>(null);

  const spec = tabSpec(tab);

  const listQuery = useMemo(() => {
    const params = new URLSearchParams();
    const statuses = tabSpec(tab).statuses;
    if (statuses) params.set('status', statuses.join(','));
    if (query) params.set('search', query);
    if (range.from) params.set('date_from', range.from);
    if (range.to) params.set('date_to', range.to);
    if (sort) {
      params.set('sort', sort.key);
      params.set('dir', sort.dir);
    }
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    return params.toString();
  }, [tab, query, range.from, range.to, sort, page]);

  const list = useResource(
    listQuery,
    (signal) => apiRequest('/api/withdrawals', {
      query: new URLSearchParams(listQuery),
      signal,
      select: toListResult,
    }),
    { pollMs: POLL_MS, keepPreviousData: sameTab },
  );

  const detail = useResource(
    openId ? `withdrawal:${openId}` : null,
    (signal) => apiRequest('/api/withdrawals', { query: { id: openId }, signal, select: toDetail }),
    { keepPreviousData: false },
  );

  const { refresh: refreshList } = list;
  const { refresh: refreshDetail, mutate: mutateDetail } = detail;

  const badLink = rawId !== null && !isUuid(rawId.trim());

  useEffect(() => {
    if (!badLink) return;
    toast.show(BAD_LINK, 'warning');
    setUrl((value) => value);
  }, [badLink, setUrl, toast]);

  useEffect(() => {
    if (openId) lastOpenRef.current = openId;
  }, [openId]);

  useEffect(() => {
    const data = list.data;
    if (!data || list.isPreviousData) return;
    const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
    if (data.withdrawals.length === 0 && page > lastPage) setPage(lastPage);
  }, [list.data, list.isPreviousData, page]);

  useEffect(() => {
    const shown = detail.data?.withdrawal;
    const match = shown ? list.data?.withdrawals.find((row) => row.id === shown.id) : undefined;
    if (!shown || !match || match.status === shown.status) return;
    const mark = `${shown.id}:${shown.status}:${match.status}`;
    if (syncedRef.current === mark) return;
    syncedRef.current = mark;
    void refreshDetail({ background: true });
  }, [list.data, detail.data, refreshDetail]);

  const openRow = useCallback((id: string) => setUrl((value) => ({ ...value, id })), [setUrl]);

  const closeDrawer = useCallback(() => setUrl((value) => ({ ...value, id: null })), [setUrl]);

  const changeTab = useCallback((next: Tab) => setUrl((value) => ({ ...value, tab: next })), [setUrl]);

  const retryList = useCallback(() => {
    void refreshList();
  }, [refreshList]);

  const drawerReturn = useCallback(
    () => rowFocusTarget(listRegionRef.current, lastOpenRef.current, -1),
    [],
  );

  const applySearch = useCallback((value: string) => {
    setQuery(value);
    setPage(1);
  }, []);

  const applyRange = useCallback((next: DateRangeValue) => {
    setRange(next);
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setSearchText('');
    setQuery('');
    setRange(ALL_TIME);
    setPage(1);
  }, []);

  const onSort = useCallback((key: string) => {
    toggleSort(key);
    setPage(1);
  }, [toggleSort]);

  const exportFilters = useMemo<ExportFiltersOption>(() => ({
    label: 'Current filters',
    description: `${spec.label} tab${query ? ` · search “${query}”` : ''}`,
    from: range.from,
    to: range.to,
  }), [spec.label, query, range.from, range.to]);

  const beginAction = (id: string, kind: ActionKind): boolean => {
    if (actingRef.current) return false;
    actingRef.current = true;
    setActing({ id, kind });
    return true;
  };

  const endAction = () => {
    actingRef.current = false;
    setActing(null);
  };

  const refreshAfterDecision = () => {
    void refreshList({ background: true });
    void refreshDetail({ background: true });
  };

  const settleAfterDecision = () => settleWithin(
    Promise.all([refreshList({ background: true }), refreshDetail({ background: true })]),
    SETTLE_WAIT_MS,
  );

  const decisionFocus = (id: string, origin: ActionOrigin) => (): HTMLElement | null => {
    if (takesFocus(origin.opener)) return origin.opener;
    if (origin.fromDrawer) return drawerBodyRef.current;
    return rowFocusTarget(listRegionRef.current, id, origin.index);
  };

  const reportRefusal = (message: string, status: number | null) => {
    toast.show(message, 'error');
    if (status === 403) router.refresh();
  };

  const readActionable = async (id: string): Promise<DetailResult | null> => {
    const result = await apiRequest('/api/withdrawals', { query: { id }, select: toDetail });
    if (!result.ok) {
      if (result.error.status !== 401) toast.show(readFailureText(result.error), 'error');
      if (result.error.status === 403) router.refresh();
      return null;
    }
    const fresh = result.data;
    mutateDetail((previous) => (previous?.withdrawal.id === id ? fresh : undefined));
    if (!isActionable(fresh.withdrawal.status)) {
      toast.show(
        `This withdrawal is now ${statusLabel(fresh.withdrawal.status)}, so it can no longer be approved or rejected.`,
        'warning',
      );
      void refreshList({ background: true });
      return null;
    }
    return fresh;
  };

  const reportApproval = (id: string, net: number, result: SettledDecision, raisedInDrawer: boolean) => {
    switch (result.kind) {
      case 'done':
        if (result.warning) {
          toast.show(result.warning, 'warning');
          setOutcome({
            id,
            tone: 'warning',
            title: 'Payout approved without an audit record',
            message: result.warning,
            requestId: result.requestId,
            raisedInDrawer,
          });
        } else {
          toast.show(`Payout of ${formatNaira(net)} approved. Status: ${statusLabel(result.status || 'processing')}.`, 'success');
        }
        return;
      case 'unknown':
        toast.show(UNKNOWN_APPROVAL, 'error');
        setOutcome({
          id,
          tone: 'danger',
          title: 'Approval outcome unknown',
          message: UNKNOWN_APPROVAL,
          requestId: result.requestId,
          raisedInDrawer,
        });
        return;
      case 'provider':
        toast.show(result.message, 'error');
        setOutcome({
          id,
          tone: 'danger',
          title: result.stage === 'gateway_unreachable' ? 'No response from the provider' : 'The provider did not accept the payout',
          message: result.message,
          requestId: result.requestId,
          raisedInDrawer,
        });
        return;
      case 'refused':
        reportRefusal(result.message, result.status);
        return;
      case 'expired':
        return;
    }
  };

  const reportRejection = (id: string, gross: number, result: SettledDecision, raisedInDrawer: boolean) => {
    switch (result.kind) {
      case 'done':
        if (result.warning) {
          toast.show(result.warning, 'warning');
          setOutcome({
            id,
            tone: 'warning',
            title: 'Withdrawal rejected without an audit record',
            message: result.warning,
            requestId: result.requestId,
            raisedInDrawer,
          });
        } else {
          toast.show(`Withdrawal rejected. ${formatNaira(gross)} refunded to the user’s wallet.`, 'success');
        }
        return;
      case 'unknown':
        toast.show(UNKNOWN_REJECTION, 'error');
        return;
      case 'provider':
      case 'refused':
        reportRefusal(result.message, result.kind === 'refused' ? result.status : null);
        return;
      case 'expired':
        return;
    }
  };

  const approve = async (id: string, origin: ActionOrigin) => {
    if (!beginAction(id, 'approve')) return;
    let sent = false;
    let settled = false;
    try {
      const fresh = await readActionable(id);
      setActing(null);
      if (!fresh) return;
      const w = fresh.withdrawal;
      const refusal = approvalRefusal(fresh);
      if (refusal) {
        toast.show(refusal, 'warning');
        void refreshList({ background: true });
        return;
      }
      const net = netOf(w);
      const destination = `${w.account_name || 'the account holder'} at ${w.bank_name || 'their bank'}`;
      const providerNote = payoutProviderNote(w.gateway, fresh.payoutGateway);
      const decision = await confirm({
        tone: 'financial',
        title: `Approve ${formatNaira(net)} payout?`,
        message: 'Confirming hands this payout to the provider straight away. Check the destination before you continue.',
        details: [
          { label: 'User', value: userSummary(w.user) },
          { label: 'Gross amount', value: <Money value={grossOf(w)} /> },
          { label: 'Fee', value: <Money value={feeOf(w)} /> },
          { label: 'Net payout', value: <Money value={net} emphasis="strong" />, emphasis: true },
          { label: 'Bank', value: w.bank_name || '—' },
          { label: 'Account name', value: w.account_name || '—' },
          { label: 'Account number', value: <MaskedValue value={w.account_number} kind="account" />, mono: true },
          {
            label: 'Payout provider',
            value: fresh.payoutGateway ? providerLabel(fresh.payoutGateway) : 'Could not be checked',
          },
        ],
        consequences: [
          `${formatNaira(net)} is sent to ${destination}. A payout the provider accepts cannot be recalled from here.`,
          ...(providerNote ? [providerNote] : []),
          ...(isOpenFlag(w.flag)
            ? [`This withdrawal is flagged: ${w.flag?.flag_reason || 'no reason recorded'}. Approving clears the flag.`]
            : []),
          ...(fresh.partial.flag ? ['The flag status could not be checked. Review the account before approving.'] : []),
          ...(fresh.emergencyMode === null ? [EMERGENCY_UNCHECKED] : []),
        ],
        confirmLabel: `Approve ${formatNaira(net)}`,
        pendingLabel: APPROVE_PENDING,
        action: async () => {
          sent = true;
          const result = classifyDecision(
            await apiRequest(`/api/withdrawals/${encodeURIComponent(id)}/approve`, {
              method: 'POST',
              timeoutMs: APPROVE_TIMEOUT_MS,
              select: toActionResult,
            }),
          );
          if (result.kind === 'retry') throw new Error(result.message);
          settled = true;
          if (result.kind !== 'expired') await settleAfterDecision();
          return result;
        },
        returnFocusTo: decisionFocus(id, origin),
      });
      if (decision?.value) reportApproval(id, net, decision.value, origin.fromDrawer);
    } finally {
      endAction();
      if (sent && !settled) refreshAfterDecision();
    }
  };

  const reject = async (id: string, origin: ActionOrigin) => {
    if (!beginAction(id, 'reject')) return;
    let sent = false;
    let settled = false;
    try {
      const fresh = await readActionable(id);
      setActing(null);
      if (!fresh) return;
      const w = fresh.withdrawal;
      const net = netOf(w);
      const gross = grossOf(w);
      const decision = await confirm({
        tone: 'danger',
        title: `Reject ${formatNaira(net)} withdrawal?`,
        message: 'Rejecting cancels this payout and refunds the user in full.',
        details: [
          { label: 'User', value: userSummary(w.user) },
          { label: 'Refund to wallet', value: <Money value={gross} emphasis="strong" />, emphasis: true },
          { label: 'Payout requested', value: <Money value={net} /> },
          { label: 'Bank', value: w.bank_name || '—' },
          { label: 'Account name', value: w.account_name || '—' },
          { label: 'Account number', value: <MaskedValue value={w.account_number} kind="account" />, mono: true },
        ],
        consequences: [
          `${formatNaira(gross)} (payout plus fee) goes back to the user’s wallet immediately.`,
          'The user is notified that the withdrawal failed and was refunded.',
          'A rejected withdrawal cannot be reopened.',
        ],
        reason: {
          required: true,
          presets: REJECT_REASONS,
          label: 'Reason for rejecting',
          placeholder: 'Explain why this payout is being rejected',
        },
        confirmLabel: 'Reject and refund',
        pendingLabel: REJECT_PENDING,
        action: async ({ reason }) => {
          sent = true;
          const result = classifyDecision(
            await apiRequest(`/api/withdrawals/${encodeURIComponent(id)}/reject`, {
              method: 'POST',
              body: { reason },
              select: toActionResult,
            }),
          );
          if (result.kind === 'retry') throw new Error(result.message);
          settled = true;
          if (result.kind !== 'expired') await settleAfterDecision();
          return result;
        },
        returnFocusTo: decisionFocus(id, origin),
      });
      if (decision?.value) reportRejection(id, gross, decision.value, origin.fromDrawer);
    } finally {
      endAction();
      if (sent && !settled) refreshAfterDecision();
    }
  };

  const runExport = async (format: 'csv' | 'pdf') => {
    if (exporting) return;
    setExporting(format);
    try {
      const span = resolveExportRange(exportRange, exportFilters);
      const params = new URLSearchParams();
      if (spec.statuses) params.set('status', spec.statuses.join(','));
      if (query) params.set('search', query);
      if (span.from) params.set('date_from', span.from);
      if (span.to) params.set('date_to', span.to);
      if (sort) {
        params.set('sort', sort.key);
        params.set('dir', sort.dir);
      }
      params.set(format, '1');
      const res = await fetch(`/api/withdrawals?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiEnvelope | null;
        if (res.status !== 401) toast.show(messageOf(body, 'The export could not be created.'), 'error');
        if (res.status === 403) router.refresh();
        return;
      }

      if (format === 'csv') {
        const blob = await res.blob();
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.download = `withdrawals-${businessDateKey(new Date())}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(href), 1000);
        const exported = Number(res.headers.get('x-export-rows') || 0);
        const matching = Number(res.headers.get('x-total-count') || exported);
        if (res.headers.get('x-export-truncated') === '1') {
          toast.show(
            `Exported ${exported.toLocaleString('en-NG')} of ${matching.toLocaleString('en-NG')} matching withdrawals. Narrow the time frame to export the rest.`,
            'warning',
          );
        } else {
          toast.show(`Exported ${exported.toLocaleString('en-NG')} withdrawals.`, 'success');
        }
        setExportOpen(false);
        return;
      }

      const body = (await res.json().catch(() => null)) as ExportResponse | null;
      if (!body || body.success === false || !Array.isArray(body.rows)) {
        toast.show(messageOf(body, 'The export could not be created.'), 'error');
        return;
      }
      const meta = [
        spec.label,
        query ? `search “${query}”` : null,
        exportRange === 'filters' ? null : span.label,
        describeExportWindow(span),
        `${body.rows.length.toLocaleString('en-NG')} rows`,
        `generated ${formatBusinessDateTime(new Date())} WAT`,
      ].filter(Boolean).join(' · ');
      const printed = printTable({
        title: 'Withdrawals',
        meta,
        columns: ['ID', 'User', 'Payout', 'Fee', 'Bank', 'Account', 'Account name', 'Status', 'Provider', 'Provider ref', 'Requested (WAT)'],
        rows: body.rows.map((r) => [
          r.ID, r.User, formatNaira(r.Amount), formatNaira(r.Fee ?? 0), r.Bank, r.Account, r.AccountName,
          statusLabel(r.Status), providerLabel(r.Gateway), r.GatewayRef, formatBusinessDateTime(r.Date),
        ]),
      });
      if (!printed) {
        toast.show('Your browser blocked the print window. Allow pop-ups for this site and try again.', 'warning');
        return;
      }
      if (body.truncated) {
        toast.show(
          `Printed ${body.rows.length.toLocaleString('en-NG')} of ${Number(body.total ?? 0).toLocaleString('en-NG')} matching withdrawals. Narrow the time frame to include the rest.`,
          'warning',
        );
      }
      setExportOpen(false);
    } catch {
      toast.show(EXPORT_OFFLINE, 'error');
    } finally {
      setExporting(null);
    }
  };

  const listError = list.error;
  const shown = list.isPreviousData && listError !== null ? undefined : list.data;
  const rows = shown?.withdrawals ?? [];
  const total = shown?.total ?? 0;
  const loaded = shown !== undefined;
  const foreground = list.isInitialLoading || list.isRefreshing;
  const blocked = rows.length === 0 && listError !== null;
  const showSkeleton = rows.length === 0 && !blocked && list.isInitialLoading;
  const tableBusy = list.isRefreshing && !showSkeleton && !blocked;
  const statsLoading = list.isInitialLoading && !blocked;
  const denied = listError?.status === 403 && shown === undefined;
  const refreshedAt = shown ? list.lastUpdatedAt : null;
  const filtersActive = searchText.trim() !== '' || range.from !== null || range.to !== null;
  const pageValue = rows.reduce((sum, row) => sum + netOf(row), 0);
  const emptyTitle = filtersActive ? 'No withdrawals match these filters' : spec.emptyTitle;
  const emptyHint = filtersActive ? 'Try a different search or date range, or clear the filters.' : spec.emptyHint;
  const clearButton = filtersActive ? (
    <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
  ) : undefined;
  const shownDetail = detail.data?.withdrawal ?? null;
  const emergencyOn = shown?.emergencyMode === true;

  const actionButtons = (w: Withdrawal, size: 'sm' | 'md', index: number) => {
    const label = `${formatNaira(netOf(w))} payout for ${userHandle(w.user)}`;
    const fromDrawer = size === 'md';
    return (
      <>
        {canApprove ? (
          <Button
            variant="success"
            size={size}
            loading={acting?.id === w.id && acting.kind === 'approve'}
            disabled={acting !== null}
            aria-label={size === 'sm' ? `Approve ${label}` : undefined}
            onClick={(event) => void approve(w.id, { opener: event.currentTarget, index, fromDrawer })}
          >
            {size === 'sm' ? 'Approve' : 'Approve payout'}
          </Button>
        ) : null}
        {canReject ? (
          <Button
            variant="dangerSubtle"
            size={size}
            loading={acting?.id === w.id && acting.kind === 'reject'}
            disabled={acting !== null}
            aria-label={size === 'sm' ? `Reject ${label}` : undefined}
            onClick={(event) => void reject(w.id, { opener: event.currentTarget, index, fromDrawer })}
          >
            Reject
          </Button>
        ) : null}
      </>
    );
  };

  if (denied) {
    return (
      <div>
        <PageHeader title="Withdrawals" subtitle={SUBTITLE} />
        <AccessDenied required={['withdrawals.read']} />
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
          <Table flush aria-label="Withdrawals" busy={tableBusy}>
            <THead>
              <Tr>
                <Th>User</Th>
                <Th align="right" sortKey="amount" sort={sort} onSort={onSort}>Payout</Th>
                <Th>Destination</Th>
                <Th sortKey="created_at" sort={sort} onSort={onSort}>Requested</Th>
                <Th>Status</Th>
                <Th>Provider ref</Th>
                {canDecide ? <Th align="right"><span className={s.srOnly}>Actions</span></Th> : null}
              </Tr>
            </THead>
            <TBody>
              {blocked && listError ? (
                <TableState colSpan={columnCount}>
                  <ErrorState
                    compact
                    title="Withdrawals could not be loaded"
                    message={listError.message}
                    requestId={listError.requestId}
                    onRetry={retryList}
                    retrying={foreground}
                  />
                </TableState>
              ) : showSkeleton ? (
                <TableSkeleton columns={skeletonColumns(canDecide)} rows={8} />
              ) : rows.length === 0 ? (
                <TableEmpty colSpan={columnCount} title={emptyTitle} hint={emptyHint} actions={clearButton} />
              ) : (
                rows.map((row, index) => (
                  <Tr key={row.id} selected={row.id === openId} onActivate={() => openRow(row.id)}>
                    <Td>
                      <div className={s.stack}>
                        <RowOpen onClick={() => openRow(row.id)} aria-haspopup="dialog" data-row-open={row.id}>
                          {userHandle(row.user)}
                        </RowOpen>
                        <span className={s.sub}>{row.user?.full_name || row.user?.email || '—'}</span>
                      </div>
                    </Td>
                    <Td align="right">
                      <Money value={row.amount} emphasis="primary" />
                    </Td>
                    <Td>
                      <div className={s.stack}>
                        <span className={s.lead}>{row.account_name || '—'}</span>
                        <span className={s.sub}>
                          {row.bank_name || 'Unknown bank'} · <MaskedValue value={row.account_number} kind="account" />
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <div className={s.stack}>
                        <span className={s.time}>{formatBusinessDateTime(row.created_at)}</span>
                        <span className={s.sub}>{formatAge(row.created_at)} ago</span>
                      </div>
                    </Td>
                    <Td>
                      <div className={s.statusCell}>
                        <StatusDot status={row.status} />
                        <FlagBadge flag={row.flag} />
                        <FrozenBadge user={row.user} />
                      </div>
                    </Td>
                    <Td>
                      <Ref value={row.gateway_reference} label="provider reference" size="sm" emphasis="secondary" />
                    </Td>
                    {canDecide ? (
                      <Td align="right">
                        {isActionable(row.status) ? (
                          <div className={s.rowActions}>{actionButtons(row, 'sm', index)}</div>
                        ) : null}
                      </Td>
                    ) : null}
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
    <MobileDataList<Withdrawal>
      ariaLabel="Withdrawals"
      items={rows}
      getKey={(row) => row.id}
      loading={foreground}
      initialLoading={showSkeleton}
      busy={foreground && !showSkeleton}
      error={listError ? listError.message : null}
      errorTitle="Withdrawals could not be loaded"
      onRetry={retryList}
      skeletonRows={8}
      empty={{ title: emptyTitle, hint: emptyHint, actions: clearButton }}
      renderRow={(row) => ({
        primary: userHandle(row.user),
        value: <Money value={row.amount} />,
        secondary: (
          <>
            {row.bank_name || 'Unknown bank'} · <MaskedValue value={row.account_number} kind="account" />
          </>
        ),
        status: <StatusDot status={row.status} />,
        meta: `${formatBusinessDateTime(row.created_at)} · ${formatAge(row.created_at)} ago`,
        flag: isFrozen(row.user) ? 'danger' : isOpenFlag(row.flag) ? 'warning' : null,
        flagLabel: isFrozen(row.user)
          ? 'Account frozen'
          : isOpenFlag(row.flag)
            ? `Flagged: ${row.flag?.flag_reason || 'no reason recorded'}`
            : undefined,
        onClick: () => openRow(row.id),
        actions: canDecide && isActionable(row.status) ? actionButtons(row, 'sm', rows.indexOf(row)) : undefined,
      })}
    />
  );

  return (
    <div>
      <PageHeader
        title="Withdrawals"
        subtitle={SUBTITLE}
        actions={
          canExport ? (
            <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={() => setExportOpen(true)}>
              Export
            </Button>
          ) : undefined
        }
      />

      {emergencyOn ? <EmergencyNotice settingsLink={isSuperAdmin} /> : null}

      {outcome ? (
        <OutcomeNotice
          outcome={outcome}
          announce={!outcome.raisedInDrawer}
          onDismiss={() => setOutcome(null)}
          onOpen={outcome.id === openId ? undefined : () => openRow(outcome.id)}
        />
      ) : null}

      <StatStrip
        items={[
          { label: 'Matching', value: loaded ? total.toLocaleString('en-NG') : '—', loading: statsLoading },
          { label: 'On this page', value: loaded ? rows.length.toLocaleString('en-NG') : '—', loading: statsLoading },
          {
            label: 'Payout value on this page',
            value: loaded ? formatNaira(pageValue) : '—',
            mono: true,
            loading: statsLoading,
            loadingWidth: '7em',
          },
        ]}
      />

      <div className={s.tabsRow}>
        <Tabs<Tab> aria-label="Withdrawal status" value={tab} onChange={changeTab} items={TAB_ITEMS} />
      </div>

      <FilterBar
        aria-label="Filter withdrawals"
        search={
          <SearchInput
            aria-label="Search withdrawals"
            placeholder="Name, username, email, account or reference"
            value={searchText}
            onChange={setSearchText}
            onDebouncedChange={applySearch}
            loading={list.isRefreshing}
          />
        }
        filters={
          <DateRangePicker value={range} onChange={applyRange} presets={DATE_PRESETS} legend="Requested between" />
        }
        onClear={clearFilters}
        active={filtersActive}
      />

      {shown?.searchCapped ? (
        <p className={s.hint} role="status">
          More than 100 users match this search, so only withdrawals for the first 100 are listed. Add more of the
          name, username or email to narrow it.
        </p>
      ) : null}

      <div ref={listRegionRef} className={s.listRegion} tabIndex={-1} role="region" aria-label="Withdrawal results">
        <ResponsiveView desktop={desktopList} mobile={mobileList} />
      </div>

      {shown?.flagNote && rows.length > 0 ? (
        <p className={s.hint} role="status">{shown.flagNote} Open a withdrawal to see its flag before deciding it.</p>
      ) : null}

      {loaded && !blocked ? (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          noun="withdrawals"
          disabled={foreground}
          label="Withdrawal pages"
          scrollTargetRef={listRegionRef}
        />
      ) : null}

      <SidePanel
        open={openId !== null}
        onClose={closeDrawer}
        title="Withdrawal"
        subtitle={
          shownDetail
            ? `${formatNaira(netOf(shownDetail))} to ${shownDetail.bank_name || 'bank'} · ${userHandle(shownDetail.user)}`
            : undefined
        }
        returnFocusTo={drawerReturn}
        footer={
          canDecide && shownDetail && isActionable(shownDetail.status) ? (
            <div className={s.drawerActions}>{actionButtons(shownDetail, 'md', -1)}</div>
          ) : undefined
        }
      >
        {outcome && outcome.id === openId ? (
          <OutcomeNotice outcome={outcome} announce onDismiss={() => setOutcome(null)} />
        ) : null}
        {detail.data ? (
          <div ref={drawerBodyRef} className={s.drawerBody} tabIndex={-1}>
            <DetailBody
              withdrawal={detail.data.withdrawal}
              partial={detail.data.partial}
              payoutGateway={detail.data.payoutGateway}
              emergencyMode={shown?.emergencyMode ?? detail.data.emergencyMode}
            />
          </div>
        ) : detail.error ? (
          <ErrorState
            compact
            title={detail.error.status === 404 ? 'Withdrawal not found' : 'This withdrawal could not be loaded'}
            message={detail.error.message}
            requestId={detail.error.requestId}
            onRetry={() => void refreshDetail()}
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
          title="Export withdrawals"
          subtitle={`Exports the ${spec.label} tab with the current search for the time frame you pick.`}
          rowLimitNote="Up to 50,000 rows. You are told if an export is cut short."
          sensitiveNote="Includes full bank account numbers."
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
