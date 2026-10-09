'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, MoreHorizontal, Pencil, Plus, Power, PowerOff, RotateCw, Trash2 } from 'lucide-react';
import {
  AccessDenied, Button, Card, CardBody, ErrorState, FilterBar, Menu, MobileDataList, Money, Notice, PageHeader,
  ResponsiveView, SearchInput, SidePanel, SkeletonLines, StatStrip, TBody, THead, Table, TableEmpty, TableSkeleton,
  TableState, Tabs, Td, Th, Tr, combineCodecs, enumParam, stringParam, useCan, useConfirm, useResource, useTableSort,
  useToast, useUrlState, uuidParam,
  type MenuEntryInput, type MobileDataListSortOption, type StatItem,
} from '../../_ui';
import { apiRequest, type ApiFailure } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { formatBusinessTime } from '../../lib/time';
import { formatNaira } from '../../_ui/money';
import { deleteBlocker, formatCount, plural, todayKey } from './couponRules';
import {
  TABS, TAB_VALUES, brandAvailable, classifyMutation, couponStats, couponStatus, deletable, deleteRequestBody,
  expiryView, minTradeText, tabCounts, toMutationResult, toSnapshot, toggleRequestBody, usesText, visibleCoupons,
  withCoupon, withoutCoupon,
  type CouponRow, type CouponTab, type CouponsSnapshot, type MutationOutcome,
} from './model';
import { deleteConfirm, toggleConfirm } from './confirmOptions';
import { BrandCell, CodeCell, ExpiryCell, SKELETON_COLUMNS, StatusCell, UsesCell } from './CouponParts';
import { CouponEditor } from './CouponEditor';
import { CouponDetails } from './CouponDetails';
import { TermsOfUseManager } from './TermsOfUseManager';
import s from './page.module.css';

const TITLE = 'Coupons';
const SUBTITLE =
  'Codes users enter when they sell a card, for a flat naira bonus on top of the payout. Each user can use a coupon once. Dates are WAT.';
const COLUMN_COUNT = 8;
const SEARCH_MAX = 64;
const BAD_LINK = 'That coupon link is not valid, so nothing was opened.';
const MISSING_LINK = 'That coupon could not be found, so nothing was opened.';

const COUPONS_URL = combineCodecs({
  tab: enumParam('status', TAB_VALUES, 'all'),
  q: stringParam('q', { maxLength: SEARCH_MAX }),
  id: uuidParam('id'),
});

const MOBILE_SORT: ReadonlyArray<MobileDataListSortOption> = [
  { key: 'code', label: 'Code' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'uses', label: 'Uses' },
  { key: 'expiry', label: 'Expiry date' },
];

const NO_COUPONS: readonly CouponRow[] = [];

const EMPTY_COPY: Readonly<Record<CouponTab, { title: string; hint: string }>> = {
  all: { title: 'No coupons yet', hint: 'Create a coupon to give users a flat bonus on trades of one brand.' },
  live: { title: 'No live coupons', hint: 'Coupons that users can apply right now appear here.' },
  off: {
    title: 'Every coupon is live',
    hint: 'Coupons that are switched off, expired, used up or tied to a missing brand appear here.',
  },
};

type RowAction = 'enable' | 'disable' | 'delete';

function readFailureText(failure: ApiFailure): string {
  return `Could not check the latest coupon details, so nothing was changed. ${failure.message}`;
}

function successText(kind: RowAction, row: CouponRow): string {
  switch (kind) {
    case 'enable':
      return `${row.code} is switched on.`;
    case 'disable':
      return `${row.code} is switched off. Users can no longer apply it.`;
    case 'delete':
      return `${row.code} was deleted.`;
  }
}

export default function CouponsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Coupons />
    </Suspense>
  );
}

function PageFallback() {
  return (
    <div>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      <ResponsiveView
        desktop={
          <Card>
            <CardBody flush>
              <Table flush aria-label="Coupons">
                <TBody>
                  <TableSkeleton columns={SKELETON_COLUMNS} rows={5} />
                </TBody>
              </Table>
            </CardBody>
          </Card>
        }
        mobile={
          <MobileDataList<CouponRow>
            ariaLabel="Coupons"
            items={NO_COUPONS}
            getKey={(row) => row.id}
            renderRow={(row) => ({ primary: row.code })}
            loading
            initialLoading
            skeletonRows={5}
          />
        }
      />
    </div>
  );
}

function Coupons() {
  const canWrite = useCan('coupons.write');
  const { show: notify } = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawId = searchParams.get('id');
  const [url, setUrl] = useUrlState(COUPONS_URL);
  const [searchText, setSearchText] = useState(url.q);
  const { sort, setSort, toggle: toggleSort } = useTableSort(null);
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const actingRef = useRef(false);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const today = todayKey();

  const list = useResource<CouponsSnapshot>(
    'coupons',
    (signal) => apiRequest('/api/coupons', { signal, select: toSnapshot }),
  );
  const { refresh: refreshList, mutate: mutateList } = list;
  const data = list.data;
  const coupons = data?.coupons ?? NO_COUPONS;
  const brands = data?.brands ?? null;
  const awaitingCounted = data?.awaitingCounted === true;
  const rows = useMemo(
    () => visibleCoupons(coupons, { tab: url.tab, query: url.q, sort, today, brands }),
    [coupons, url.tab, url.q, sort, today, brands],
  );
  const counts = useMemo(() => tabCounts(coupons, today, brands), [coupons, today, brands]);
  const stats = useMemo(() => couponStats(coupons, today, brands, awaitingCounted), [coupons, today, brands, awaitingCounted]);
  const openCoupon = url.id ? coupons.find((row) => row.id === url.id) ?? null : null;
  const badLink = rawId !== null && rawId.trim() !== '' && !isUuid(rawId.trim());

  useEffect(() => {
    if (!badLink) return;
    notify(BAD_LINK, 'warning');
    setUrl((value) => value);
  }, [badLink, notify, setUrl]);

  useEffect(() => {
    if (!url.id || !data || list.isPreviousData || openCoupon) return;
    notify(MISSING_LINK, 'warning');
    setUrl((value) => ({ ...value, id: null }));
  }, [url.id, data, list.isPreviousData, openCoupon, notify, setUrl]);

  const readFresh = useCallback(async (): Promise<CouponsSnapshot | null> => {
    const result = await apiRequest('/api/coupons', { select: toSnapshot });
    if (!result.ok) {
      if (result.error.status !== 401) notify(readFailureText(result.error), 'error');
      if (result.error.status === 403) router.refresh();
      return null;
    }
    mutateList(result.data);
    return result.data;
  }, [mutateList, notify, router]);

  const applyCoupon = useCallback((row: CouponRow) => {
    mutateList((previous) => withCoupon(previous, row));
  }, [mutateList]);

  const refreshQuietly = useCallback(() => {
    void refreshList({ background: true });
  }, [refreshList]);

  const openRow = useCallback((row: CouponRow) => {
    setCreating(false);
    setUrl((value) => ({ ...value, id: row.id }));
  }, [setUrl]);

  const closePanel = useCallback(() => {
    setCreating(false);
    setUrl((value) => (value.id === null ? value : { ...value, id: null }));
  }, [setUrl]);

  const startCreate = useCallback(() => {
    setUrl((value) => (value.id === null ? value : { ...value, id: null }));
    setCreating(true);
  }, [setUrl]);

  const changeTab = useCallback((next: CouponTab) => {
    setUrl((value) => ({ ...value, tab: next }));
  }, [setUrl]);

  const applySearch = useCallback((value: string) => {
    setUrl((current) => ({ ...current, q: value }));
  }, [setUrl]);

  const clearSearch = useCallback(() => {
    setSearchText('');
    setUrl((current) => ({ ...current, q: '' }));
  }, [setUrl]);

  const rowFocus = useCallback((id: string | null) => () => {
    const region = listRegionRef.current;
    if (!region) return null;
    const opener = id
      ? Array.from(region.querySelectorAll<HTMLElement>('[data-coupon-open]')).find(
          (element) => element.dataset.couponOpen === id && element.getClientRects().length > 0,
        )
      : undefined;
    return opener ?? region;
  }, []);

  const report = (kind: RowAction, row: CouponRow, outcome: MutationOutcome) => {
    switch (outcome.kind) {
      case 'done':
        notify(
          outcome.result.changed ? successText(kind, row) : `Nothing changed. ${row.code} was already in that state.`,
          'success',
        );
        if (outcome.result.warning) notify(outcome.result.warning, 'warning');
        return;
      case 'unknown':
        notify(outcome.message, 'error');
        return;
      case 'stale':
        notify(outcome.message, 'warning');
        return;
      case 'refused':
        notify(outcome.message, 'error');
        router.refresh();
        return;
      case 'expired':
        return;
    }
  };

  const runAction = async (kind: RowAction, target: CouponRow) => {
    if (actingRef.current || !canWrite) return;
    actingRef.current = true;
    setActing(target.id);
    let sent = false;
    let settled = false;
    try {
      const fresh = await readFresh();
      if (!fresh) return;
      const live = fresh.coupons.find((row) => row.id === target.id);
      if (!live) {
        notify(`${target.code} no longer exists, so nothing was changed.`, 'warning');
        return;
      }
      if (kind === 'enable' && live.active) {
        notify(`${live.code} is already switched on.`, 'warning');
        return;
      }
      if (kind === 'disable' && !live.active) {
        notify(`${live.code} is already switched off.`, 'warning');
        return;
      }
      if (kind === 'delete' && !deletable(live)) {
        const blocker = deleteBlocker({
          active: live.active,
          uses: live.uses,
          redemptions: live.uses,
          awaiting: live.awaitingTrades ?? 0,
        });
        notify(blocker ?? `${live.code} cannot be deleted right now.`, 'warning');
        return;
      }
      const options = kind === 'delete' ? deleteConfirm(live) : toggleConfirm(live, kind === 'enable', today, fresh.brands);
      const decision = await confirm<MutationOutcome>({
        ...options,
        action: async ({ reason }) => {
          sent = true;
          const attempt = classifyMutation(await apiRequest('/api/coupons', kind === 'delete'
            ? { method: 'DELETE', body: deleteRequestBody(live, reason), select: toMutationResult }
            : { method: 'PATCH', body: toggleRequestBody(live, kind === 'enable', reason), select: toMutationResult }));
          if (attempt.kind === 'retry') throw new Error(attempt.message);
          settled = true;
          if (attempt.kind === 'done') {
            const saved = attempt.result.coupon;
            if (kind === 'delete') mutateList((previous) => withoutCoupon(previous, live.id));
            else if (saved) mutateList((previous) => withCoupon(previous, saved));
          }
          if (attempt.kind !== 'expired') void refreshList({ background: true });
          return attempt;
        },
        returnFocusTo: rowFocus(kind === 'delete' ? null : live.id),
      });
      if (decision?.value) report(kind, live, decision.value);
    } finally {
      actingRef.current = false;
      setActing(null);
      if (sent && !settled) refreshQuietly();
    }
  };

  const menuItems = (row: CouponRow): MenuEntryInput[] => [
    row.active
      ? { label: 'Disable', icon: <PowerOff size={14} aria-hidden />, onSelect: () => void runAction('disable', row) }
      : { label: 'Enable', icon: <Power size={14} aria-hidden />, onSelect: () => void runAction('enable', row) },
    deletable(row) && { type: 'separator' },
    deletable(row) && {
      label: 'Delete',
      icon: <Trash2 size={14} aria-hidden />,
      danger: true,
      onSelect: () => void runAction('delete', row),
    },
  ];

  const actionsFor = (row: CouponRow, withOpen: boolean): ReactNode => {
    if (!withOpen && !canWrite) return undefined;
    return (
      <div className={s.rowActions}>
        {withOpen ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={canWrite ? <Pencil size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            aria-label={`${canWrite ? 'Edit' : 'View'} ${row.code}`}
            aria-haspopup="dialog"
            data-coupon-open={row.id}
            onClick={() => openRow(row)}
          >
            {canWrite ? 'Edit' : 'View'}
          </Button>
        ) : null}
        {canWrite ? (
          <Menu
            align="end"
            aria-label={`Actions for ${row.code}`}
            items={menuItems(row)}
            trigger={(props) => (
              <Button
                {...props}
                variant="ghost"
                size="sm"
                iconOnly
                leftIcon={<MoreHorizontal size={16} aria-hidden />}
                aria-label={`More actions for ${row.code}`}
                loading={acting === row.id}
                disabled={acting !== null}
              />
            )}
          />
        ) : null}
      </div>
    );
  };

  if (list.error?.status === 403 && data === undefined) {
    return (
      <div>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied required={['coupons.read']} />
      </div>
    );
  }

  const listError = list.error;
  const loaded = data !== undefined;
  const foreground = list.isInitialLoading || list.isRefreshing;
  const blocked = !loaded && listError !== null;
  const showSkeleton = !loaded && !blocked;
  const tableBusy = loaded && list.isRefreshing;
  const searching = url.q.trim() !== '';
  const emptyTitle = searching ? 'No coupons match this search' : EMPTY_COPY[url.tab].title;
  const emptyHint = searching
    ? 'Try a code or brand name, or clear the search.'
    : url.tab === 'all' && !canWrite
      ? 'Coupons appear here once someone with the Manage coupons permission creates one.'
      : EMPTY_COPY[url.tab].hint;
  const emptyAction = searching ? (
    <Button variant="secondary" size="sm" onClick={clearSearch}>Clear search</Button>
  ) : url.tab === 'all' && canWrite && loaded ? (
    <Button variant="primary" size="sm" leftIcon={<Plus size={14} aria-hidden />} aria-haspopup="dialog" onClick={startCreate}>
      New coupon
    </Button>
  ) : undefined;
  const retry = () => void refreshList();
  const tabItems = TABS.map((item) => ({
    value: item.value,
    label: item.label,
    count: loaded ? formatCount(counts[item.value]) : undefined,
  }));

  const statItems: StatItem[] = [
    {
      label: 'Live now',
      value: formatCount(stats.live),
      hint: `of ${plural(stats.total, 'coupon', 'coupons')}`,
      loading: showSkeleton,
    },
    {
      label: 'Redemptions',
      value: formatCount(stats.redemptions),
      hint: 'Approved trades that used a coupon',
      loading: showSkeleton,
    },
    {
      label: 'Awaiting review',
      value: formatCount(stats.awaitingTrades ?? 0),
      hint: stats.awaitingTrades
        ? `${formatNaira(stats.awaitingBonus ?? 0)} in bonuses on hold`
        : 'Trades with a coupon applied',
      unavailable: loaded && stats.awaitingTrades === null,
      unavailableHint: 'Trades awaiting review could not be counted.',
      loading: showSkeleton,
    },
    {
      label: 'Ending within 7 days',
      value: formatCount(stats.endingSoon),
      hint: 'Live coupons',
      tone: stats.endingSoon > 0 ? 'warning' : 'neutral',
      loading: showSkeleton,
    },
  ];

  const desktop = (
    <Card>
      <CardBody flush>
        <Table flush aria-label="Coupons" busy={tableBusy}>
          <THead>
            <Tr>
              <Th sortKey="code" sort={sort} onSort={toggleSort}>Code</Th>
              <Th>Brand</Th>
              <Th align="right" sortKey="bonus" sort={sort} onSort={toggleSort}>Bonus</Th>
              <Th align="right">Min. card value</Th>
              <Th align="right" sortKey="uses" sort={sort} onSort={toggleSort}>Uses</Th>
              <Th sortKey="expiry" sort={sort} onSort={toggleSort}>Expires</Th>
              <Th>Status</Th>
              <Th align="right"><span className={s.srOnly}>Actions</span></Th>
            </Tr>
          </THead>
          <TBody>
            {blocked && listError ? (
              <TableState colSpan={COLUMN_COUNT}>
                <ErrorState
                  compact
                  title="The coupons could not be loaded"
                  message={listError.message}
                  requestId={listError.requestId}
                  onRetry={retry}
                  retrying={foreground}
                />
              </TableState>
            ) : showSkeleton ? (
              <TableSkeleton columns={SKELETON_COLUMNS} rows={5} />
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={COLUMN_COUNT} title={emptyTitle} hint={emptyHint} actions={emptyAction} />
            ) : (
              rows.map((row) => (
                <Tr key={row.id} selected={row.id === url.id} onActivate={() => openRow(row)}>
                  <Td><CodeCell row={row} /></Td>
                  <Td><BrandCell row={row} available={brandAvailable(row.type, brands)} /></Td>
                  <Td align="right"><Money value={row.bonus} emphasis="primary" /></Td>
                  <Td align="right" mono emphasis="secondary">{minTradeText(row.minTrade)}</Td>
                  <Td align="right"><UsesCell row={row} /></Td>
                  <Td><ExpiryCell view={expiryView(row.expiry, today)} /></Td>
                  <Td><StatusCell status={couponStatus(row, today, brands)} /></Td>
                  <Td align="right">{actionsFor(row, true)}</Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );

  const mobile = (
    <MobileDataList<CouponRow>
      ariaLabel="Coupons"
      items={rows}
      getKey={(row) => row.id}
      loading={foreground}
      initialLoading={showSkeleton}
      busy={tableBusy}
      error={listError ? listError.message : null}
      errorTitle="The coupons could not be loaded"
      onRetry={retry}
      skeletonRows={5}
      empty={{ title: emptyTitle, hint: emptyHint, actions: emptyAction }}
      sortOptions={MOBILE_SORT}
      sort={sort}
      onSortChange={setSort}
      renderRow={(row) => {
        const status = couponStatus(row, today, brands);
        const expiry = expiryView(row.expiry, today);
        return {
          primary: <span className={s.code}>{row.code}</span>,
          value: <Money value={row.bonus} emphasis="primary" />,
          secondary: row.type || 'No brand',
          status: <StatusCell status={status} />,
          meta: `${minTradeText(row.minTrade)} · ${usesText(row)} uses · ${row.expiry ? `ends ${expiry.date}` : 'no expiry'}`,
          flag: status.state === 'no_brand' ? 'warning' : null,
          flagLabel: status.hint,
          onClick: () => openRow(row),
          actions: actionsFor(row, false),
        };
      }}
    />
  );

  const panelFocus = rowFocus(url.id);

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
              leftIcon={<RotateCw size={14} aria-hidden />}
              loading={list.isRefreshing}
              onClick={retry}
            >
              Refresh
            </Button>
            <TermsOfUseManager
              terms={data?.terms ?? null}
              coupons={coupons}
              loaded={loaded}
              readFresh={readFresh}
              onSaved={refreshQuietly}
            />
            {canWrite ? (
              <Button
                ref={createButtonRef}
                variant="primary"
                size="sm"
                leftIcon={<Plus size={14} aria-hidden />}
                aria-haspopup="dialog"
                disabled={!loaded}
                onClick={startCreate}
              >
                New coupon
              </Button>
            ) : null}
          </>
        }
      />

      {listError && loaded ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          meta={list.lastUpdatedAt ? `Showing the list from ${formatBusinessTime(new Date(list.lastUpdatedAt))} WAT.` : undefined}
          actions={<Button variant="ghost" size="sm" onClick={retry}>Try again</Button>}
        >
          The coupons could not be refreshed. {listError.message}
        </Notice>
      ) : null}

      {loaded && brands === null ? (
        <Notice tone="warning" compact>
          The brand list could not be loaded, so brand checks are paused. Refresh the page to try again.
        </Notice>
      ) : null}

      {loaded && !canWrite ? (
        <Notice tone="neutral" compact>
          You can view coupons but not change them. Changing coupons needs the Manage coupons permission (coupons.write).
        </Notice>
      ) : null}

      <StatStrip aria-label="Coupon totals" items={statItems} />

      <div className={s.tabsRow}>
        <Tabs<CouponTab> aria-label="Coupon status" value={url.tab} onChange={changeTab} items={tabItems} />
      </div>

      <FilterBar
        aria-label="Filter coupons"
        search={
          <SearchInput
            aria-label="Search coupons"
            placeholder="Code or brand"
            maxLength={SEARCH_MAX}
            value={searchText}
            onChange={setSearchText}
            onDebouncedChange={applySearch}
          />
        }
        onClear={clearSearch}
        active={searching || searchText.trim() !== ''}
      />

      <div ref={listRegionRef} className={s.listRegion} tabIndex={-1} role="region" aria-label="Coupon list">
        <ResponsiveView desktop={desktop} mobile={mobile} />
      </div>

      {creating && data ? (
        <CouponEditor
          key="create"
          mode="create"
          coupon={null}
          snapshot={data}
          today={today}
          readFresh={readFresh}
          applyCoupon={applyCoupon}
          refreshList={refreshQuietly}
          onClose={closePanel}
          returnFocusTo={() => createButtonRef.current}
        />
      ) : openCoupon && data ? (
        canWrite ? (
          <CouponEditor
            key={`edit:${openCoupon.id}`}
            mode="edit"
            coupon={openCoupon}
            snapshot={data}
            today={today}
            readFresh={readFresh}
            applyCoupon={applyCoupon}
            refreshList={refreshQuietly}
            onClose={closePanel}
            returnFocusTo={panelFocus}
          />
        ) : (
          <CouponDetails
            key={`view:${openCoupon.id}`}
            coupon={openCoupon}
            today={today}
            brands={brands}
            onClose={closePanel}
            returnFocusTo={panelFocus}
          />
        )
      ) : url.id && !loaded ? (
        <SidePanel open wide onClose={closePanel} title="Coupon" returnFocusTo={panelFocus}>
          {blocked && listError ? (
            <ErrorState
              compact
              title="This coupon could not be loaded"
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
