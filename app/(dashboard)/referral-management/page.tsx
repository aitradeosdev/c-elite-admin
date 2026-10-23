'use client';

import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import {
  AccessDenied, Button, Card, CardBody, DateRangePicker, ErrorState, FilterBar, MobileDataList, Money, Notice, PageHeader,
  Pagination, ResponsiveView, SearchInput, Select, StatStrip, TBody, THead, Table, TableEmpty, TableSkeleton, TableState,
  Td, Th, Tr, combineCodecs, dateRangeParam, enumParam, formatNaira, intParam, nextSort, sortParam, stringParam, useCan,
  useConfirm, usePermissions, useResource, useToast, useUrlState,
  type DateRangeValue, type MobileDataListSortOption, type SortState, type StatItem, type TableSkeletonColumn,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { BUSINESS_TZ_LABEL, formatBusinessDate, formatBusinessTime } from '../../lib/time';
import {
  SEARCH_USER_CAP, SORT_KEYS, STATUS_FILTERS, STATUS_FILTER_LABELS, formatCount, plural,
  type SettingKey, type StatusFilter,
} from './referralRules';
import {
  CONFIG_ENDPOINT, DEFAULT_SORT, EMPTY_DRAFT, PAGE_SIZE, REFERRALS_ENDPOINT, SUMMARY_QUERY, classifySave, conflictNotice,
  draftChanges, draftCount, draftErrors, editSetting, filtersActive, firstErrorKey, listQueryString, programmeNotes,
  rebaseDraft, rebaseNotice, sameAsIntended, savePayload, savedText, toReferralList, toSaveReceipt, toSummary, totalBonus,
  unknownNotice, userHandle,
  type Draft, type PageNotice, type Phase, type ReferralList, type ReferralRow, type ReferralSummary, type SaveOutcome,
} from './model';
import { discardOptions, leaveOptions, reviewOptions } from './confirmOptions';
import {
  BonusCell, DateCell, HowItWorks, PageNoticeView, ProgrammeSkeleton, ReferralStatusDot, SectionHeading,
  SettingIssuesNotice, SettingsCard, UnsavedBar, UserCell, settingFieldId,
} from './ReferralParts';
import { useLeaveGuard } from './useLeaveGuard';
import s from './page.module.css';

const TITLE = 'Referrals';
const SUBTITLE =
  'The referral programme and every referral recorded. Users claim their own bonuses in the app; times are WAT.';
const COLUMN_COUNT = 6;
const OWED_READ_CAP = 5000;
const ALL_TIME: DateRangeValue = { from: null, to: null };
const DATE_PRESETS = ['today', '7d', '30d', 'month', 'all'] as const;
const SORT_OPTIONS: ReadonlyArray<MobileDataListSortOption> = [
  { key: 'created_at', label: 'Referred' },
  { key: 'first_trade_at', label: 'First trade' },
];
const SKELETON_COLUMNS: readonly TableSkeletonColumn[] = [
  { width: 140, lines: 2 },
  { width: 140, lines: 2 },
  { width: 110, lines: 2 },
  { width: 110, lines: 2 },
  { width: 190, lines: 2 },
  { width: 120 },
];

const REFERRALS_URL = combineCodecs({
  search: stringParam('search', { maxLength: 64 }),
  status: enumParam('status', STATUS_FILTERS, ''),
  range: dateRangeParam(),
  sort: sortParam({ allowed: SORT_KEYS, default: DEFAULT_SORT }),
  page: intParam('page', { min: 1, default: 1 }),
});

const fetchSummary = (signal: AbortSignal) => (
  apiRequest(REFERRALS_ENDPOINT, { signal, query: SUMMARY_QUERY, select: toSummary })
);

function loadedAt(timestamp: number | null): string | undefined {
  return timestamp === null ? undefined : `${formatBusinessTime(new Date(timestamp))} ${BUSINESS_TZ_LABEL}`;
}

function isStatusFilter(value: string): value is StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(value);
}

function ListSkeleton() {
  return (
    <ResponsiveView
      desktop={(
        <Card>
          <CardBody flush>
            <Table flush aria-label="Referrals">
              <TBody>
                <TableSkeleton columns={SKELETON_COLUMNS} rows={8} />
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}
      mobile={(
        <MobileDataList<ReferralRow>
          ariaLabel="Referrals"
          items={[]}
          getKey={(row) => row.id}
          renderRow={(row) => ({ primary: row.id })}
          loading
          initialLoading
          skeletonRows={8}
        />
      )}
    />
  );
}

function ReferralsFallback() {
  return (
    <div className={s.page}>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      <div className={s.section}>
        <ProgrammeSkeleton />
      </div>
      <div className={s.section}>
        <ListSkeleton />
      </div>
    </div>
  );
}

export default function ReferralsPage() {
  return (
    <Suspense fallback={<ReferralsFallback />}>
      <Referrals />
    </Suspense>
  );
}

function Referrals() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const baseId = useId();
  const { isSuperAdmin } = usePermissions();
  const canOpenUsers = useCan('users.read');
  const [view, setView] = useUrlState(REFERRALS_URL);

  const summary = useResource<ReferralSummary>('referral-summary', fetchSummary);
  const listKey = useMemo(() => listQueryString(view), [view]);
  const list = useResource<ReferralList>(listKey, (signal) => (
    apiRequest(REFERRALS_ENDPOINT, { query: new URLSearchParams(listKey), signal, select: toReferralList })
  ));
  const { refresh: refreshSummary } = summary;
  const { refresh: refreshList } = list;
  const live = summary.data?.settings;

  const [draft, setDraftState] = useState<Draft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState<Partial<Record<SettingKey, boolean>>>({});
  const [revealAll, setRevealAll] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<PageNotice | null>(null);
  const [searchText, setSearchText] = useState(view.search);

  const draftRef = useRef<Draft>(EMPTY_DRAFT);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const deniedRef = useRef(false);
  const appliedSearch = useRef(view.search);
  const settingsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);

  const programmeId = `${baseId}-programme`;
  const settingsHeadingId = `${baseId}-settings`;
  const listHeadingId = `${baseId}-list`;
  const fieldBase = `${baseId}-field`;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (view.search === appliedSearch.current) return;
    appliedSearch.current = view.search;
    setSearchText(view.search);
  }, [view.search]);

  useEffect(() => {
    const refused = summary.error?.status === 403 || list.error?.status === 403;
    if (!refused || deniedRef.current) return;
    deniedRef.current = true;
    router.refresh();
  }, [summary.error, list.error, router]);

  useEffect(() => {
    const data = list.data;
    if (!data || list.isPreviousData) return;
    const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
    if (data.rows.length === 0 && view.page > lastPage) {
      setView((current) => (current.page > lastPage ? { ...current, page: lastPage } : current));
    }
  }, [list.data, list.isPreviousData, view.page, setView]);

  const commitDraft = useCallback((next: Draft) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const count = draftCount(draft);
  const errors = useMemo(() => draftErrors(draft), [draft]);
  const shownErrors = useMemo(() => {
    const shown: Partial<Record<SettingKey, string>> = {};
    for (const [key, message] of Object.entries(errors) as Array<[SettingKey, string]>) {
      if (revealAll || touched[key]) shown[key] = message;
    }
    return shown;
  }, [errors, revealAll, touched]);
  const dirty = isSuperAdmin && count > 0;
  const busy = phase !== 'idle';

  useLeaveGuard(dirty, () => (
    confirm(leaveOptions(draftCount(draftRef.current))).then((decision) => decision !== null)
  ));

  const edit = useCallback((key: SettingKey, value: string) => {
    if (!live || busyRef.current) return;
    commitDraft(editSetting(draftRef.current, live, key, value));
  }, [live, commitDraft]);

  const touch = useCallback((key: SettingKey) => {
    setTouched((current) => (current[key] ? current : { ...current, [key]: true }));
  }, []);

  const resetEditing = useCallback(() => {
    commitDraft(EMPTY_DRAFT);
    setTouched({});
    setRevealAll(false);
  }, [commitDraft]);

  const retryList = useCallback(() => {
    void refreshList();
  }, [refreshList]);

  const applySearch = useCallback((value: string) => {
    appliedSearch.current = value;
    setView((current) => (current.search === value ? current : { ...current, search: value, page: 1 }));
  }, [setView]);

  const applyStatus = useCallback((value: string) => {
    const status: StatusFilter | '' = isStatusFilter(value) ? value : '';
    setView((current) => ({ ...current, status, page: 1 }));
  }, [setView]);

  const applyRange = useCallback((next: DateRangeValue) => {
    setView((current) => ({ ...current, range: next, page: 1 }));
  }, [setView]);

  const clearFilters = useCallback(() => {
    setSearchText('');
    appliedSearch.current = '';
    setView((current) => ({ ...current, search: '', status: '', range: ALL_TIME, page: 1 }));
  }, [setView]);

  const onSort = useCallback((key: string) => {
    setView((current) => ({ ...current, sort: nextSort(current.sort, key), page: 1 }));
  }, [setView]);

  const onMobileSort = useCallback((next: SortState) => {
    setView((current) => ({ ...current, sort: next, page: 1 }));
  }, [setView]);

  const goToPage = useCallback((next: number) => {
    setView((current) => ({ ...current, page: next }));
  }, [setView]);

  const revealErrors = (found: Partial<Record<SettingKey, string>>) => {
    setRevealAll(true);
    const key = firstErrorKey(found);
    if (!key) return;
    const element = document.getElementById(settingFieldId(fieldBase, key));
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'center' });
  };

  const refreshAll = async () => {
    if (busyRef.current) return;
    void refreshList();
    const result = await refreshSummary();
    if (!aliveRef.current || !result) return;
    if (!result.ok) {
      if (result.error.status === 403) router.refresh();
      return;
    }
    const rebased = rebaseDraft(draftRef.current, result.data.settings);
    commitDraft(rebased.draft);
    const note = rebaseNotice(rebased, result.data.settings);
    if (note) setNotice(note);
  };

  const review = async () => {
    if (busyRef.current || !live || !isSuperAdmin) return;
    const localErrors = draftErrors(draftRef.current);
    if (firstErrorKey(localErrors)) {
      revealErrors(localErrors);
      return;
    }
    if (draftCount(draftRef.current) === 0) return;
    busyRef.current = true;
    setPhase('checking');
    let sent = false;
    let settled = false;
    try {
      const fresh = await refreshSummary();
      if (!aliveRef.current || !fresh) return;
      if (!fresh.ok) {
        if (fresh.error.status !== 401) {
          toast.show(`The live settings could not be checked, so nothing was saved. ${fresh.error.message}`, 'error');
        }
        if (fresh.error.status === 403) router.refresh();
        return;
      }
      const freshSettings = fresh.data.settings;
      const rebased = rebaseDraft(draftRef.current, freshSettings);
      commitDraft(rebased.draft);
      setNotice(rebaseNotice(rebased, freshSettings));
      const changes = draftChanges(rebased.draft);
      if (changes.length === 0) {
        toast.show('These values are already live, so nothing needed saving.');
        return;
      }
      const payload = savePayload(changes);
      setPhase('confirming');
      const decision = await confirm<SaveOutcome>({
        ...reviewOptions(changes, programmeNotes(freshSettings, changes)),
        action: async () => {
          sent = true;
          setPhase('saving');
          const outcome = classifySave(await apiRequest(CONFIG_ENDPOINT, {
            method: 'PATCH',
            body: payload,
            select: toSaveReceipt,
          }));
          if (outcome.kind === 'retry') {
            setPhase('confirming');
            throw new Error(outcome.message);
          }
          return outcome;
        },
        returnFocusTo: () => settingsRef.current,
      });
      if (!aliveRef.current) return;
      const outcome = decision?.value;
      if (!outcome) return;
      settled = true;
      switch (outcome.kind) {
        case 'saved': {
          const after = await refreshSummary();
          if (!aliveRef.current) return;
          resetEditing();
          setNotice(null);
          toast.show(savedText(changes.length), 'success');
          if (outcome.warning) toast.show(outcome.warning, 'warning');
          if (!after || !after.ok) toast.show('Saved, but the latest values could not be reloaded. Refresh to confirm them.', 'warning');
          return;
        }
        case 'conflict': {
          const after = await refreshSummary();
          if (!aliveRef.current) return;
          if (after && after.ok) {
            const again = rebaseDraft(draftRef.current, after.data.settings);
            commitDraft(again.draft);
            setNotice(rebaseNotice(again, after.data.settings) ?? conflictNotice(outcome.message));
          } else {
            setNotice(conflictNotice(outcome.message));
          }
          toast.show('Another admin changed these settings before your save reached them, so nothing was saved.', 'warning');
          return;
        }
        case 'unknown': {
          const after = await refreshSummary();
          if (!aliveRef.current) return;
          if (after && after.ok && sameAsIntended(after.data.settings, changes)) {
            resetEditing();
            setNotice(null);
            toast.show(savedText(changes.length), 'success');
            return;
          }
          if (after && after.ok) commitDraft(rebaseDraft(draftRef.current, after.data.settings).draft);
          setNotice(unknownNotice(outcome.message));
          toast.show('The save could not be confirmed. Check the settings before trying again.', 'error');
          return;
        }
        case 'refused':
          toast.show(outcome.message, 'error');
          if (outcome.status === 403) router.refresh();
          return;
        case 'expired':
        case 'retry':
          return;
      }
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setPhase('idle');
      if (sent && !settled) void refreshSummary({ background: true });
    }
  };

  const discard = async () => {
    if (busyRef.current) return;
    const total = draftCount(draftRef.current);
    if (total === 0) return;
    const decision = await confirm(discardOptions(total));
    if (!decision || !aliveRef.current || busyRef.current) return;
    resetEditing();
    setNotice(null);
  };

  const denied = (summary.error?.status === 403 && !summary.data) || (list.error?.status === 403 && !list.data);
  if (denied) {
    return (
      <div className={s.page}>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied required={['referrals.read']} />
      </div>
    );
  }

  const totals = summary.data?.totals ?? null;
  const totalsLoading = summary.isInitialLoading;
  const totalsMissing = !totalsLoading && totals === null && (summary.data !== undefined || summary.error !== null);
  const owedHint = totals
    ? totals.owedPartial
      ? `${plural(totals.unclaimed, 'referral', 'referrals')} to claim. The amount is a partial total covering at most the first ${formatCount(OWED_READ_CAP)}.`
      : plural(totals.unclaimed, 'referral to claim', 'referrals to claim')
    : undefined;
  const statItems: StatItem[] = [
    {
      label: 'Referrals',
      value: totals ? formatCount(totals.total) : '—',
      loading: totalsLoading,
      unavailable: totalsMissing,
    },
    {
      label: 'Awaiting first trade',
      value: totals ? formatCount(totals.awaiting) : '—',
      loading: totalsLoading,
      unavailable: totalsMissing,
    },
    {
      label: 'Unclaimed bonuses',
      value: totals ? formatNaira(totals.owed) : '—',
      mono: true,
      hint: owedHint,
      loading: totalsLoading,
      loadingWidth: '7em',
      unavailable: totalsMissing,
    },
    {
      label: 'Paid to referrers',
      value: totals ? formatNaira(totals.paidToReferrers) : '—',
      mono: true,
      hint: 'Claimed by referrers so far',
      loading: totalsLoading,
      loadingWidth: '7em',
      unavailable: totalsMissing,
    },
    {
      label: 'Paid to referred users',
      value: totals ? formatNaira(totals.paidToReferees) : '—',
      mono: true,
      hint: 'Claimed by referred users so far',
      loading: totalsLoading,
      loadingWidth: '7em',
      unavailable: totalsMissing,
    },
  ];

  let programme: ReactNode;
  if (!live) {
    programme = summary.error ? (
      <Card>
        <ErrorState
          compact
          title="The referral programme could not be loaded"
          message={summary.error.message}
          requestId={summary.error.requestId}
          onRetry={() => void refreshSummary()}
          retrying={summary.isInitialLoading || summary.isRefreshing}
        />
      </Card>
    ) : (
      <ProgrammeSkeleton />
    );
  } else {
    programme = (
      <div className={s.programmeGrid}>
        <div
          ref={settingsRef}
          className={s.settingsRegion}
          tabIndex={-1}
          role="group"
          aria-labelledby={settingsHeadingId}
          aria-busy={busy || undefined}
        >
          <fieldset className={s.fieldset} disabled={busy}>
            <SettingsCard
              live={live}
              draft={draft}
              errors={shownErrors}
              editable={isSuperAdmin}
              idBase={fieldBase}
              headingId={settingsHeadingId}
              onEdit={edit}
              onTouch={touch}
            />
          </fieldset>
        </div>
        <HowItWorks live={live} />
      </div>
    );
  }

  const listError = list.error;
  const shown = list.isPreviousData && listError !== null ? undefined : list.data;
  const rows = shown?.rows ?? [];
  const total = shown?.total ?? 0;
  const loaded = shown !== undefined;
  const foreground = list.isInitialLoading || list.isRefreshing;
  const blocked = rows.length === 0 && listError !== null;
  const showSkeleton = rows.length === 0 && !blocked && list.isInitialLoading;
  const tableBusy = list.isRefreshing && !showSkeleton && !blocked;
  const refreshedAt = shown ? list.lastUpdatedAt : null;
  const filtering = filtersActive(view, searchText);
  const emptyTitle = filtering ? 'No referrals match these filters' : 'No referrals yet';
  const emptyHint = filtering
    ? 'Try a different search, status or date range, or clear the filters.'
    : 'A referral is recorded when someone signs up with a user’s referral code while the programme is on.';
  const clearButton = filtering ? (
    <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
  ) : undefined;
  const summaryStamp = loadedAt(summary.data ? summary.lastUpdatedAt : null);

  const desktopList = (
    <div className={s.listStack}>
      {listError && rows.length > 0 ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          meta={refreshedAt ? `Showing results from ${loadedAt(refreshedAt)}.` : undefined}
          actions={<Button type="button" variant="ghost" size="sm" onClick={retryList}>Try again</Button>}
        >
          The referral log could not be refreshed. {listError.message}
        </Notice>
      ) : null}
      <Card>
        <CardBody flush>
          <Table flush aria-labelledby={listHeadingId} busy={tableBusy}>
            <THead>
              <Tr>
                <Th>Referrer</Th>
                <Th>Referred user</Th>
                <Th sortKey="created_at" sort={view.sort} onSort={onSort}>Referred</Th>
                <Th sortKey="first_trade_at" sort={view.sort} onSort={onSort}>First trade</Th>
                <Th>Bonuses</Th>
                <Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {blocked && listError ? (
                <TableState colSpan={COLUMN_COUNT}>
                  <ErrorState
                    compact
                    title="The referral log could not be loaded"
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
                  <Tr key={row.id}>
                    <Td>
                      <UserCell id={row.referrerId} name={row.referrerUsername} fullName={row.referrerName} canOpen={canOpenUsers} />
                    </Td>
                    <Td>
                      <UserCell id={row.refereeId} name={row.refereeUsername} fullName={row.refereeName} canOpen={canOpenUsers} />
                    </Td>
                    <Td>
                      <DateCell value={row.createdAt} empty="—" />
                    </Td>
                    <Td>
                      <DateCell value={row.firstTradeAt} empty="Not yet" />
                    </Td>
                    <Td>
                      <BonusCell row={row} />
                    </Td>
                    <Td>
                      <ReferralStatusDot status={row.status} />
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );

  const mobileList = (
    <MobileDataList<ReferralRow>
      ariaLabel="Referral log"
      items={rows}
      getKey={(row) => row.id}
      loading={foreground}
      initialLoading={showSkeleton}
      busy={foreground && !showSkeleton}
      error={listError ? listError.message : null}
      errorTitle="The referral log could not be loaded"
      refreshErrorTitle="The referral log could not be refreshed"
      onRetry={retryList}
      skeletonRows={8}
      empty={{ title: emptyTitle, hint: emptyHint, actions: clearButton }}
      sortOptions={SORT_OPTIONS}
      sort={view.sort}
      onSortChange={onMobileSort}
      renderRow={(row) => ({
        primary: (
          <>
            {userHandle(row.referrerUsername, row.referrerName)}
            <span aria-hidden> → </span>
            <span className={s.srOnly}> referred </span>
            {userHandle(row.refereeUsername, row.refereeName)}
          </>
        ),
        value: <Money value={totalBonus(row)} />,
        secondary: `Referrer ${formatNaira(row.referrerBonus)} · Referred user ${formatNaira(row.refereeBonus)}`,
        status: <ReferralStatusDot status={row.status} />,
        meta: `Referred ${formatBusinessDate(row.createdAt)} · ${row.firstTradeAt ? `first trade ${formatBusinessDate(row.firstTradeAt)}` : 'no first trade yet'}`,
      })}
    />
  );

  return (
    <div className={dirty ? `${s.page} ${s.dirty}` : s.page}>
      <PageHeader
        title={TITLE}
        subtitle={SUBTITLE}
        actions={(
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<RotateCw size={14} aria-hidden />}
            loading={(summary.isRefreshing || list.isRefreshing) && !busy}
            disabled={busy}
            onClick={() => void refreshAll()}
          >
            Refresh
          </Button>
        )}
      />

      {summary.error && summary.data ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          meta={summaryStamp ? `Showing values loaded at ${summaryStamp}.` : undefined}
          actions={<Button type="button" variant="ghost" size="sm" onClick={() => void refreshAll()}>Try again</Button>}
        >
          The programme settings and totals could not be refreshed. {summary.error.message}
        </Notice>
      ) : null}

      {notice ? <PageNoticeView notice={notice} onDismiss={() => setNotice(null)} /> : null}

      {live ? <SettingIssuesNotice live={live} editable={isSuperAdmin} /> : null}

      <StatStrip aria-label="Referral programme totals" items={statItems} />

      <section aria-labelledby={programmeId} className={s.section}>
        <SectionHeading
          id={programmeId}
          title="Programme"
          hint={isSuperAdmin ? 'Changes stay unsaved until you review and save them.' : undefined}
        />
        {programme}
      </section>

      <section aria-labelledby={listHeadingId} className={s.section}>
        <SectionHeading
          id={listHeadingId}
          title="Referral log"
          hint="Every referral recorded, with each side’s bonus and whether it has been claimed."
        />
        <FilterBar
          aria-label="Filter referrals"
          search={(
            <SearchInput
              aria-label="Search referrals"
              placeholder="Username, name, referral code or ID"
              maxLength={64}
              value={searchText}
              onChange={setSearchText}
              onDebouncedChange={applySearch}
              loading={list.isRefreshing}
            />
          )}
          filters={(
            <>
              <Select inline aria-label="Status" value={view.status} onChange={(event) => applyStatus(event.target.value)}>
                <option value="">All statuses</option>
                {STATUS_FILTERS.map((value) => (
                  <option key={value} value={value}>{STATUS_FILTER_LABELS[value]}</option>
                ))}
              </Select>
              <DateRangePicker value={view.range} onChange={applyRange} presets={DATE_PRESETS} legend="Referred between" />
            </>
          )}
          onClear={clearFilters}
          active={filtering}
        />
        {shown?.searchCapped ? (
          <p className={s.hint} role="status">
            More than {formatCount(SEARCH_USER_CAP)} users match this search, so only referrals for the first{' '}
            {formatCount(SEARCH_USER_CAP)} are listed. Add more of the username or name to narrow it.
          </p>
        ) : null}
        <div ref={listRef} className={s.listRegion} tabIndex={-1} role="region" aria-label="Referral results">
          <ResponsiveView desktop={desktopList} mobile={mobileList} />
        </div>
        {loaded && !blocked ? (
          <Pagination
            page={view.page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={goToPage}
            noun="referrals"
            disabled={foreground}
            label="Referral log pages"
            scrollTargetRef={listRef}
          />
        ) : null}
      </section>

      {dirty ? (
        <UnsavedBar
          count={count}
          issues={Object.keys(shownErrors).length}
          phase={phase}
          reviewRef={reviewRef}
          onDiscard={() => void discard()}
          onReview={() => void review()}
        />
      ) : null}
    </div>
  );
}
