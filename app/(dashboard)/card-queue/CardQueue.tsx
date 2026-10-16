'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import {
  AccessDenied, Button, Card, CardBody, DateRangePicker, FilterBar, MobileDataList, Money, Notice, PageHeader,
  Pagination, Ref, SearchInput, StatusDot, TabPanel, Tabs, combineCodecs, enumParam, formatNaira, useCan, useConfirm,
  useResource, useTableSort, useToast, useUrlState, uuidParam,
  type ConfirmDetail, type DateRangeValue, type MobileDataListRow, type MobileDataListSortOption, type SortState,
} from '../../_ui';
import { useRealtimeSignal } from '../../_ui/realtime/RealtimeSignals';
import { useIsMobile } from '../../lib/useIsMobile';
import { BUSINESS_TZ_LABEL, formatAge, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import { ApproveModal, type ApprovalRequest, type ExpectedCredit } from './ApproveModal';
import { QueueTable, type QueueEmpty } from './QueueTable';
import { SubmissionDrawer } from './SubmissionDrawer';
import {
  decisionFailureKind, fetchSubmission, postDecision, type DecisionRequest, type DecisionResult, type QueueListResult,
} from './queueApi';
import {
  DEFAULT_TAB, DecisionGate, PAGE_SIZE, QUEUE_TABS, REJECT_REASONS, SIGNAL_GAP_MS, cardDetail, cardName,
  formatForeignAmount, refreshNote, statusText, toKobo, userHandle, type QueueRefresh, type QueueRow, type QueueTab,
  type Submission,
} from './queueModel';
import { useQueueList } from './useQueueList';
import s from './page.module.css';

const EMPTY_COPY: Readonly<Record<QueueTab, { title: string; hint: string }>> = {
  pending: { title: 'No cards waiting for review', hint: 'New submissions appear here automatically.' },
  disputed: { title: 'No open disputes', hint: 'When a user disputes a rejection, it lands here for a final decision.' },
  approved: { title: 'No approved cards yet', hint: 'Cards you approve are listed here.' },
  rejected: { title: 'No rejected cards yet', hint: 'Cards you reject are listed here.' },
  all: { title: 'No submissions yet', hint: 'Submissions appear here as soon as users send cards.' },
};

const DATE_PRESETS = ['today', '7d', '30d', 'all'] as const;

const BUSY_MESSAGE = 'Another decision is still being recorded. Wait for it to finish, then try again.';

const SIGNAL_REFRESH = { minGapMs: SIGNAL_GAP_MS };

const QUEUE_TABS_ID = 'card-queue-status';

const ID_PARAM = uuidParam('id');

const QUEUE_URL = combineCodecs({
  tab: enumParam('status', QUEUE_TABS.map((item) => item.value), DEFAULT_TAB),
  id: ID_PARAM,
});

const MOBILE_SORT_OPTIONS: ReadonlyArray<MobileDataListSortOption> = [
  { key: 'created_at', label: 'Submitted' },
  { key: 'amount', label: 'Payout' },
];

type ApproveMode = 'approve' | 'overturn';

interface Approval {
  id: string;
  mode: ApproveMode;
}

interface QueuePage {
  tab: QueueTab;
  page: number;
}

interface LoadedList {
  data: QueueListResult;
  at: number | null;
}

type DecisionOutcome =
  | { kind: 'recorded' }
  | { kind: 'changed' | 'denied'; message: string }
  | { kind: 'signedOut' };

function currencyOf(target: QueueRow): string | null {
  return 'currency_symbol' in target ? (target as Submission).currency_symbol : null;
}

function decisionDetails(target: QueueRow): ConfirmDetail[] {
  const fullName = target.users?.username && target.users?.full_name ? ` · ${target.users.full_name}` : '';
  return [
    { label: 'User', value: `${userHandle(target.users)}${fullName}` },
    { label: 'Card', value: [cardName(target), cardDetail(target)].filter(Boolean).join(' · ') },
    { label: 'Card value', value: formatForeignAmount(target.amount_foreign, currencyOf(target)), mono: true },
    { label: 'Payout', value: <Money value={target.payout_naira} emphasis="strong" />, emphasis: true },
    { label: 'Submission', value: <Ref value={target.id} truncate={13} copyable={false} label="submission ID" /> },
  ];
}

function creditWarning(credited: number | null, expected: ExpectedCredit | undefined): string | null {
  if (credited === null || !expected) return null;
  const creditedKobo = toKobo(credited);
  if (creditedKobo === null || creditedKobo === expected.totalKobo) return null;
  const shown = formatNaira(Number(expected.totalKobo) / 100);
  if (expected.couponKobo > BigInt(0) && creditedKobo === expected.totalKobo - expected.couponKobo) {
    return `The coupon bonus was not applied because the coupon can no longer be redeemed, so ${formatNaira(credited)} was credited instead of ${shown}.`;
  }
  return `${formatNaira(credited)} was credited, not the ${shown} shown. Check the submission for a rate change.`;
}

export function CardQueue() {
  const { show: notify } = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const canReview = useCan('cards.review');
  const [url, setUrl] = useUrlState(QUEUE_URL);
  const tab = url.tab;
  const openId = url.id;

  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<DateRangeValue>({ from: null, to: null });
  const [paging, setPaging] = useState<QueuePage>({ tab, page: 1 });
  const { sort, setSort, toggle: toggleSort } = useTableSort({ key: 'created_at', dir: 'desc' });
  const [deciding, setDeciding] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [approveIntent, setApproveIntent] = useState<string | null>(null);
  const [lastList, setLastList] = useState<LoadedList | null>(null);
  const [approvalFor, setApprovalFor] = useState(openId);
  if (approvalFor !== openId) {
    setApprovalFor(openId);
    if (approval) setApproval(null);
  }
  const panelRef = useRef<HTMLDivElement>(null);
  const warnedId = useRef<string | null>(null);
  const [gate] = useState(() => new DecisionGate());

  const page = paging.tab === tab ? paging.page : 1;
  const { live } = useRealtimeSignal('cards', (signal) => refreshFor(gate.signal(signal)));
  const list = useQueueList({ tab, search, from: range.from, to: range.to, page, sort }, deciding, live);
  const detail = useResource(
    openId ? `submission:${openId}` : null,
    (signal) => fetchSubmission(openId!, signal),
    { keepPreviousData: false },
  );
  if (list.data && list.data !== lastList?.data) setLastList({ data: list.data, at: list.lastUpdatedAt });
  const refreshList = list.refresh;
  const refreshDetail = detail.refresh;
  const invalidateList = list.invalidate;
  const invalidateDetail = detail.invalidate;
  const rows = list.data?.rows ?? null;
  const total = list.data?.total ?? 0;
  const counts = (list.data ?? lastList?.data)?.counts ?? null;
  const loadedAt = list.lastUpdatedAt ?? lastList?.at ?? null;
  const submission = detail.data?.submission ?? null;
  const approveMode = approval && approval.id === openId && submission?.id === approval.id ? approval.mode : null;
  const observedQuery = searchParams.toString();

  const setPage = useCallback((next: number) => setPaging({ tab, page: next }), [tab]);
  const focusList = useCallback(() => panelRef.current, []);

  const refreshFor = useCallback((refresh: QueueRefresh) => {
    if (refresh.list) invalidateList(SIGNAL_REFRESH);
    if (refresh.detail) invalidateDetail(SIGNAL_REFRESH);
  }, [invalidateDetail, invalidateList]);

  useEffect(() => {
    gate.setOpenId(openId);
  }, [gate, openId]);

  useEffect(() => {
    const params = new URLSearchParams(observedQuery);
    const rawId = params.get('id');
    if (rawId !== null && rawId.trim() !== '' && ID_PARAM.parse(params) === null && warnedId.current !== rawId) {
      warnedId.current = rawId;
      notify('That link does not point to a card submission, so nothing was opened.', 'warning');
    }
    setUrl((value) => value);
  }, [observedQuery, notify, setUrl]);

  useEffect(() => {
    const data = list.data;
    if (!data || list.isPreviousData) return;
    if (data.rows.length === 0 && data.total > 0 && page > 1) {
      setPage(Math.max(1, Math.ceil(data.total / PAGE_SIZE)));
    }
  }, [list.data, list.isPreviousData, page, setPage]);

  useEffect(() => {
    if (!approveIntent) return;
    if (approveIntent !== openId || detail.error) {
      setApproveIntent(null);
      return;
    }
    if (!submission || submission.id !== approveIntent) return;
    setApproveIntent(null);
    if (!canReview) {
      notify('You can view this submission but your account cannot decide it.', 'warning');
    } else if (submission.status === 'pending') {
      setApproval({ id: submission.id, mode: 'approve' });
    } else {
      notify(`This submission is ${statusText(submission.status).toLowerCase()} and can no longer be approved.`, 'warning');
    }
  }, [approveIntent, openId, submission, detail.error, canReview, notify]);

  const changeTab = useCallback((next: QueueTab) => {
    setUrl((value) => ({ ...value, tab: next }));
    setPaging({ tab: next, page: 1 });
  }, [setUrl]);

  const applySearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, [setPage]);

  const applyRange = useCallback((next: DateRangeValue) => {
    setRange(next);
    setPage(1);
  }, [setPage]);

  const clearFilters = useCallback(() => {
    setSearchText('');
    setSearch('');
    setRange({ from: null, to: null });
    setPage(1);
  }, [setPage]);

  const changeSort = useCallback((key: string) => {
    toggleSort(key);
    setPage(1);
  }, [setPage, toggleSort]);

  const changeMobileSort = useCallback((next: SortState) => {
    setSort(next);
    setPage(1);
  }, [setPage, setSort]);

  const openSubmission = useCallback((id: string) => {
    setApproval(null);
    setApproveIntent(null);
    setUrl((value) => ({ ...value, id }));
  }, [setUrl]);

  const closeSubmission = useCallback(() => {
    setApproval(null);
    setApproveIntent(null);
    setUrl((value) => ({ ...value, id: null }));
  }, [setUrl]);

  const closeDecided = useCallback((id: string) => {
    setApproval(null);
    setUrl((value) => (value.id === id ? { ...value, id: null } : value));
  }, [setUrl]);

  const announce = useCallback((target: QueueRow, request: DecisionRequest, result: DecisionResult, expected?: ExpectedCredit) => {
    const who = userHandle(target.users);
    if (request.action === 'approve' || request.action === 'overturn') {
      const verb = request.action === 'overturn' ? 'Dispute overturned' : 'Card approved';
      notify(
        result.credited !== null ? `${verb}. ${formatNaira(result.credited)} credited to ${who}.` : `${verb}. ${who} has been credited.`,
        'success',
      );
      const mismatch = creditWarning(result.credited, expected);
      if (mismatch) notify(mismatch, 'warning');
    } else if (request.action === 'reject') {
      notify(`Card from ${who} rejected.`, 'success');
    } else {
      notify('Dispute closed. The rejection stands.', 'success');
    }
    if (result.warning) notify(result.warning, 'warning');
  }, [notify]);

  const beginDecision = useCallback((): boolean => {
    if (!gate.begin()) return false;
    setDeciding(true);
    return true;
  }, [gate]);

  const endDecision = useCallback(() => {
    setDeciding(false);
    refreshFor(gate.end());
  }, [gate, refreshFor]);

  const runDecision = useCallback(async (target: QueueRow, request: DecisionRequest): Promise<DecisionOutcome> => {
    if (!beginDecision()) throw new Error(BUSY_MESSAGE);
    try {
      const result = await postDecision({ ...request, submission_id: target.id });
      if (result.ok) {
        gate.settle(target.id);
        announce(target, request, result.data);
        await refreshList();
        return { kind: 'recorded' };
      }
      const kind = decisionFailureKind(result.error);
      if (kind === 'refused') throw new Error(result.error.message);
      if (kind === 'signedOut') return { kind };
      if (kind === 'changed') {
        gate.settle(target.id);
        await Promise.all([refreshList(), refreshDetail()]);
      }
      return { kind, message: result.error.message };
    } finally {
      endDecision();
    }
  }, [announce, beginDecision, endDecision, gate, refreshDetail, refreshList]);

  const finishDecision = useCallback((target: QueueRow, outcome: DecisionOutcome | undefined) => {
    if (!outcome || outcome.kind === 'signedOut') return;
    if (outcome.kind === 'recorded') {
      closeDecided(target.id);
      return;
    }
    notify(outcome.message, 'error');
    if (outcome.kind === 'denied') router.refresh();
  }, [closeDecided, notify, router]);

  const requestReject = useCallback(async (target: QueueRow) => {
    const decision = await confirm({
      tone: 'danger',
      title: 'Reject this card?',
      details: decisionDetails(target),
      consequences: [
        `${userHandle(target.users)} is notified and sees the reason you choose.`,
        'The pending credit is marked failed. No money moves.',
        'The user can dispute the decision within 14 days of submitting.',
      ],
      reason: {
        label: 'Rejection reason',
        required: true,
        presets: REJECT_REASONS,
        placeholder: 'Explain why the card is rejected. The user sees this.',
      },
      confirmLabel: 'Reject card',
      pendingLabel: 'Rejecting the card…',
      action: ({ reason }) => runDecision(target, { action: 'reject', reason }),
      returnFocusTo: focusList,
    });
    if (decision) finishDecision(target, decision.value);
  }, [confirm, finishDecision, focusList, runDecision]);

  const requestUphold = useCallback(async (target: Submission) => {
    const decision = await confirm({
      tone: 'danger',
      title: 'Uphold the rejection?',
      details: decisionDetails(target),
      consequences: [
        'The rejection stands and the dispute is closed. A closed dispute cannot be reopened.',
        'The pending credit is marked failed. No money moves.',
        `${userHandle(target.users)} is notified that the dispute was closed.`,
      ],
      reason: {
        label: 'Internal note',
        placeholder: 'Optional. Recorded in the audit log and not shown to the user.',
      },
      confirmLabel: 'Uphold rejection',
      pendingLabel: 'Closing the dispute…',
      action: ({ reason }) => runDecision(target, { action: 'uphold', ...(reason ? { reason } : {}) }),
      returnFocusTo: focusList,
    });
    if (decision) finishDecision(target, decision.value);
  }, [confirm, finishDecision, focusList, runDecision]);

  const decide = useCallback(async (target: Submission, request: DecisionRequest, expected: ExpectedCredit) => {
    if (!beginDecision()) return;
    try {
      const result = await postDecision({ ...request, submission_id: target.id });
      if (result.ok) {
        gate.settle(target.id);
        announce(target, request, result.data, expected);
        await refreshList();
        closeDecided(target.id);
        return;
      }
      const kind = decisionFailureKind(result.error);
      if (kind === 'signedOut') return;
      notify(result.error.message, 'error');
      if (kind === 'denied') {
        setApproval(null);
        router.refresh();
      } else if (kind === 'changed') {
        gate.settle(target.id);
        setApproval(null);
        void refreshDetail();
        void refreshList();
      }
    } finally {
      endDecision();
    }
  }, [announce, beginDecision, closeDecided, endDecision, gate, notify, refreshDetail, refreshList, router]);

  const approveFromRow = useCallback((row: QueueRow) => {
    setApproval(null);
    setApproveIntent(row.id);
    setUrl((value) => ({ ...value, id: row.id }));
  }, [setUrl]);

  const confirmApproval = useCallback((request: ApprovalRequest) => {
    if (!submission || !approveMode) return;
    void decide(submission, { action: approveMode, ...request.payload }, request.expected);
  }, [approveMode, decide, submission]);

  if (list.error?.status === 403 && list.data === undefined) {
    return <AccessDenied required={['cards.read']} />;
  }

  const filtersActive = search !== '' || searchText.trim() !== '' || range.from !== null || range.to !== null;
  const empty: QueueEmpty = filtersActive
    ? {
        title: 'No submissions match these filters',
        hint: 'Try another search or date range, or clear the filters.',
        action: <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>,
      }
    : EMPTY_COPY[tab];

  const tabItems = QUEUE_TABS.map((item) => {
    const value = item.value === 'pending' ? counts?.pending : item.value === 'disputed' ? counts?.disputed : null;
    return typeof value === 'number' ? { ...item, count: value.toLocaleString('en-NG') } : item;
  });

  const retryList = () => void refreshList();

  const renderMobileRow = (row: QueueRow): MobileDataListRow => {
    const country = row.card_types?.country_code;
    return {
      primary: row.card_types?.name ? `${cardName(row)} · ${row.card_types.name}` : cardName(row),
      value: <Money value={row.payout_naira} emphasis="primary" />,
      secondary: country ? `${userHandle(row.users)} · ${country}` : userHandle(row.users),
      status: <StatusDot status={row.status} label={statusText(row.status)} />,
      meta: `${formatBusinessDateTime(row.created_at)} · ${formatAge(row.created_at)} ago · value ${formatForeignAmount(row.amount_foreign)}`,
      onClick: () => openSubmission(row.id),
      actions: row.status === 'pending' && canReview ? (
        <>
          <Button variant="success" size="sm" disabled={deciding} onClick={() => approveFromRow(row)}>Approve</Button>
          <Button variant="dangerSubtle" size="sm" disabled={deciding} onClick={() => void requestReject(row)}>Reject</Button>
        </>
      ) : undefined,
    };
  };

  return (
    <div>
      <PageHeader
        title="Card queue"
        subtitle="Review gift-card submissions. Approving a card credits the user's wallet immediately."
        actions={
          <>
            {loadedAt ? (
              <span className={s.updated} title={refreshNote(live)}>
                Updated {formatBusinessTime(new Date(loadedAt))} {BUSINESS_TZ_LABEL}
              </span>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCw size={14} />}
              loading={list.isRefreshing}
              onClick={retryList}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className={s.tabs}>
        <Tabs<QueueTab>
          id={QUEUE_TABS_ID}
          aria-label="Submission status"
          value={tab}
          onChange={changeTab}
          items={tabItems}
          variant="underline"
        />
      </div>

      <FilterBar
        aria-label="Filter submissions"
        search={
          <SearchInput
            aria-label="Search submissions"
            placeholder="Search user, email, card brand or submission ID"
            value={searchText}
            onChange={setSearchText}
            onDebouncedChange={applySearch}
            loading={list.isRefreshing && (search !== '' || searchText.trim() !== '')}
          />
        }
        filters={
          <DateRangePicker
            value={range}
            onChange={applyRange}
            presets={DATE_PRESETS}
            legend="Submitted between"
          />
        }
        onClear={clearFilters}
        active={filtersActive}
      />

      <TabPanel
        ref={panelRef}
        tabsId={QUEUE_TABS_ID}
        value={tab}
        active
        tabIndex={-1}
        className={s.listTop}
      >
        {list.data?.searchTruncated ? (
          <p className={s.hint} role="status">
            This search matches too many users or card brands to include them all, so some submissions may be missing. Add more of the name or email to narrow it.
          </p>
        ) : null}

        {isMobile ? (
          <MobileDataList
            items={rows ?? []}
            getKey={(row) => row.id}
            renderRow={renderMobileRow}
            ariaLabel="Card submissions"
            loading={list.isInitialLoading || list.isRefreshing}
            initialLoading={list.isInitialLoading && !list.error}
            busy={list.isInitialLoading || list.isRefreshing}
            error={list.error?.message ?? null}
            errorTitle="The card queue could not be loaded"
            refreshErrorTitle="The card queue could not be refreshed"
            onRetry={retryList}
            empty={{ title: empty.title, hint: empty.hint, actions: empty.action }}
            sortOptions={MOBILE_SORT_OPTIONS}
            sort={sort}
            onSortChange={changeMobileSort}
          />
        ) : (
          <>
            {list.error && rows ? (
              <Notice
                tone="warning"
                compact
                announce="polite"
                meta={loadedAt ? `Showing results from ${formatBusinessTime(new Date(loadedAt))} ${BUSINESS_TZ_LABEL}.` : undefined}
                actions={<Button variant="ghost" size="sm" onClick={retryList}>Retry</Button>}
              >
                {list.error.message}
              </Notice>
            ) : null}
            <Card>
              <CardBody flush>
                <QueueTable
                  rows={rows}
                  error={list.error}
                  retrying={list.isInitialLoading}
                  refreshing={list.isRefreshing}
                  sort={sort}
                  onSort={changeSort}
                  activeId={openId}
                  canReview={canReview}
                  deciding={deciding}
                  empty={empty}
                  onOpen={(row) => openSubmission(row.id)}
                  onApprove={approveFromRow}
                  onReject={(row) => void requestReject(row)}
                  onRetry={retryList}
                />
              </CardBody>
            </Card>
          </>
        )}

        {rows && total > 0 ? (
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            label="Card queue pages"
            noun="submissions"
            scrollTargetRef={panelRef}
          />
        ) : null}
      </TabPanel>

      <SubmissionDrawer
        open={openId !== null}
        submission={submission}
        retrying={detail.isInitialLoading}
        error={detail.error}
        canReview={canReview}
        deciding={deciding}
        onClose={closeSubmission}
        onRetry={() => void refreshDetail()}
        onApprove={(sub) => setApproval({ id: sub.id, mode: 'approve' })}
        onOverturn={(sub) => setApproval({ id: sub.id, mode: 'overturn' })}
        onReject={(sub) => void requestReject(sub)}
        onUphold={(sub) => void requestUphold(sub)}
        returnFocusTo={focusList}
      />

      {approveMode && submission ? (
        <ApproveModal
          key={`${submission.id}:${approveMode}`}
          mode={approveMode}
          submission={submission}
          approvalLimit={detail.data?.approvalLimit ?? null}
          busy={deciding}
          onCancel={() => setApproval(null)}
          onConfirm={confirmApproval}
          returnFocusTo={focusList}
        />
      ) : null}
    </div>
  );
}
