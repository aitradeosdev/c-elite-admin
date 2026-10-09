'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  AccessDenied, Button, Card, CardBody, ErrorState, FilterBar, MobileDataList, Notice, PageHeader, ResponsiveView,
  RowOpen, SearchInput, StatStrip, TBody, THead, Table, TableEmpty, TableSkeleton, TableState, Td, Th, Tr, useCan,
  useConfirm, useResource, useToast, useUrlState, uuidParam,
  type StatItem, type TableSkeletonColumn,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { BUSINESS_TZ_LABEL, formatBusinessTime } from '../../lib/time';
import { BrandEditor } from './BrandEditor';
import { BrandPanel } from './BrandPanel';
import {
  BrandMark, BrandMenu, BrandStatus, CountryCell, MoveControls, ValueDiff, countryText, useDeferredFocus, visibleTarget,
} from './CatalogParts';
import {
  appendCard, availableCountries, brandLabel, catalogStats, classifyMutation, hasSharedPositions, matchesSearch,
  mergeSavedCard, moveId, plural, positionText, renumberCards, statusConsequences, statusText, toCardReceipt,
  toCatalog, toReceipt,
  type CardReceipt, type Catalog, type CatalogCard, type MoveTarget, type MutationOutcome, type SavedCard,
} from './model';
import s from './page.module.css';

const TITLE = 'Card brands';
const SUBTITLE = 'The gift-card brands users can sell, the countries each one is sold in, and their order in the app’s Sell tab.';
const POLL_MS = 30000;
const ID_PARAM = uuidParam('id');
const CHECK_FAILED = 'The latest catalog could not be loaded, so nothing was changed. Try again.';
const BAD_LINK = 'That brand link is not valid, so nothing was opened.';
const GONE_LINK = 'That brand is not in the catalog, so nothing was opened.';
const LOAD_FAILED = 'The card catalog could not be loaded';

const SKELETON_COLUMNS: ReadonlyArray<TableSkeletonColumn> = [
  { width: 32 },
  { width: 168, avatar: true },
  { width: 156, lines: 2 },
  { width: 88 },
];

const WRITE_SKELETON_COLUMNS: ReadonlyArray<TableSkeletonColumn> = [
  { width: 84 },
  ...SKELETON_COLUMNS.slice(1),
  { width: 28, align: 'right', button: true },
];

type EditorTarget = { mode: 'create' } | { mode: 'edit'; id: string };

type MoveSource = 'button' | 'menu';

function count(value: number): string {
  return value.toLocaleString('en-NG');
}

export default function CardsPage() {
  return (
    <Suspense fallback={<CatalogFallback />}>
      <CardCatalog />
    </Suspense>
  );
}

function CatalogFallback() {
  const canWrite = useCan('catalog.write');
  return (
    <div>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      <ResponsiveView
        desktop={
          <Card>
            <CardBody flush>
              <Table flush aria-label="Card brands">
                <TBody>
                  <TableSkeleton columns={canWrite ? WRITE_SKELETON_COLUMNS : SKELETON_COLUMNS} rows={8} />
                </TBody>
              </Table>
            </CardBody>
          </Card>
        }
        mobile={
          <MobileDataList<CatalogCard>
            ariaLabel="Card brands"
            items={[]}
            getKey={(card) => card.id}
            renderRow={(card) => ({ primary: brandLabel(card) })}
            loading
            initialLoading
            skeletonRows={8}
          />
        }
      />
    </div>
  );
}

function CardCatalog() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawId = searchParams.get('id');
  const canWrite = useCan('catalog.write');
  const [openId, setOpenId] = useUrlState(ID_PARAM);
  const focusLater = useDeferredFocus();

  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const busyRef = useRef(false);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const lastOpenRef = useRef<string | null>(openId);

  const catalog = useResource(
    'cards',
    (signal) => apiRequest('/api/cards', { signal, select: toCatalog }),
    { pollMs: savingId ? 0 : POLL_MS },
  );
  const { refresh: refreshCatalog, mutate: mutateCatalog } = catalog;

  const cards = useMemo(() => catalog.data?.cards ?? [], [catalog.data]);
  const loaded = catalog.data !== undefined;
  const listError = catalog.error;
  const blocked = !loaded && listError !== null;
  const showSkeleton = !loaded && !blocked;
  const denied = listError?.status === 403 && !loaded;
  const total = cards.length;
  const stats = useMemo(() => catalogStats(cards), [cards]);
  const positions = useMemo(() => new Map(cards.map((card, index) => [card.id, index])), [cards]);
  const filtering = search !== '';
  const rows = useMemo(
    () => (filtering ? cards.filter((card) => matchesSearch(card, search)) : cards),
    [cards, filtering, search],
  );
  const shared = useMemo(() => hasSharedPositions(cards), [cards]);
  const locked = savingId !== null || statusId !== null;
  const canReorder = canWrite && !filtering && total > 1;
  const openCard = openId ? cards.find((card) => card.id === openId) ?? null : null;
  const editCard = editor?.mode === 'edit' ? cards.find((card) => card.id === editor.id) ?? null : null;
  const columnCount = canWrite ? 5 : 4;
  const tableBusy = loaded && catalog.isRefreshing;
  const badLink = rawId !== null && rawId.trim() !== '' && !isUuid(rawId.trim());

  useEffect(() => {
    if (!badLink) return;
    toast.show(BAD_LINK, 'warning');
    setOpenId((value) => value);
  }, [badLink, setOpenId, toast]);

  useEffect(() => {
    if (openId) lastOpenRef.current = openId;
  }, [openId]);

  useEffect(() => {
    const list = catalog.data?.cards;
    if (!openId || !list || list.some((card) => card.id === openId)) return;
    toast.show(GONE_LINK, 'warning');
    setOpenId(null);
  }, [openId, catalog.data, setOpenId, toast]);

  const reload = useCallback(async (): Promise<Catalog | null> => {
    const result = await refreshCatalog();
    return result && result.ok ? result.data : null;
  }, [refreshCatalog]);

  const patchCards = useCallback((update: (list: CatalogCard[]) => CatalogCard[]) => {
    mutateCatalog((previous) => (previous ? { cards: update(previous.cards) } : previous));
  }, [mutateCatalog]);

  const refreshQuietly = useCallback(() => {
    void refreshCatalog({ background: true });
  }, [refreshCatalog]);

  const retry = useCallback(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  const openBrand = useCallback((id: string) => setOpenId(id), [setOpenId]);

  const closePanel = useCallback(() => setOpenId(null), [setOpenId]);

  const panelReturn = useCallback(() => {
    const id = lastOpenRef.current;
    return (id ? visibleTarget(`[data-row-open="${id}"]`) : null) ?? listRegionRef.current;
  }, []);

  const applySearch = useCallback((value: string) => setSearch(value), []);

  const clearSearch = useCallback(() => {
    setSearchText('');
    setSearch('');
  }, []);

  const openEditor = (target: EditorTarget) => {
    if (!canWrite || busyRef.current) return;
    setEditor(target);
  };

  const handleCreated = (saved: SavedCard) => {
    patchCards((list) => appendCard(list, saved));
    setEditor(null);
    setOpenId(saved.id);
    refreshQuietly();
  };

  const handleUpdated = (saved: SavedCard | null) => {
    if (saved) patchCards((list) => mergeSavedCard(list, saved));
    setEditor(null);
    refreshQuietly();
  };

  const move = async (card: CatalogCard, target: MoveTarget, source: MoveSource) => {
    const before = catalog.data;
    if (!canReorder || busyRef.current || !before) return;
    const ids = before.cards.map((entry) => entry.id);
    const next = moveId(ids, card.id, target);
    if (!next) return;
    busyRef.current = true;
    const label = brandLabel(card);
    const from = ids.indexOf(card.id) + 1;
    const to = next.indexOf(card.id) + 1;
    const selector = source === 'menu'
      ? `[data-row-menu="${card.id}"]`
      : `[data-move="${card.id}"][data-move-dir="${target}"]`;
    const keepFocus = () => focusLater(() => visibleTarget(selector));
    setSavingId(card.id);
    patchCards((list) => renumberCards(list, next));
    setAnnouncement(`${label} moved to position ${to} of ${next.length}.`);
    keepFocus();
    try {
      const outcome = classifyMutation(await apiRequest('/api/cards', {
        method: 'PATCH',
        body: { type: 'reorder', ids: next, moved: card.id },
        select: toReceipt,
      }));
      switch (outcome.kind) {
        case 'done':
          toast.show('Order saved. Users see the new order once their app refreshes its brand list.', 'success');
          if (outcome.data.warning) toast.show(outcome.data.warning, 'warning');
          refreshQuietly();
          return;
        case 'unknown':
          setAnnouncement('');
          toast.show(outcome.message, 'error');
          void refreshCatalog();
          return;
        case 'expired':
          mutateCatalog(before);
          setAnnouncement('');
          return;
        case 'refused':
        case 'retry':
          mutateCatalog(before);
          setAnnouncement('');
          toast.show(
            outcome.kind === 'refused' && outcome.status === 409
              ? `The brand list changed since it was loaded, so the new order was not saved. The latest list is shown now; move ${label} again if it is still needed.`
              : `The new order was not saved, so ${label} is back in position ${from}. ${outcome.message}`,
            'error',
          );
          if (outcome.kind === 'refused' && outcome.status === 403) router.refresh();
          void refreshCatalog();
      }
    } finally {
      busyRef.current = false;
      setSavingId(null);
      keepFocus();
    }
  };

  const reportStatus = (outcome: MutationOutcome<CardReceipt>, live: CatalogCard, next: boolean) => {
    const label = brandLabel(live);
    switch (outcome.kind) {
      case 'done': {
        const saved = outcome.data.card;
        patchCards((list) => (
          saved
            ? mergeSavedCard(list, saved)
            : list.map((entry) => (entry.id === live.id ? { ...entry, is_active: next } : entry))
        ));
        const sellable = availableCountries(live) > 0
          ? 'Users can sell it once their app refreshes its brand list.'
          : 'Make a country available so users can sell it.';
        toast.show(
          next ? `${label} is active. ${sellable}` : `${label} is inactive. Users stop seeing it once their app refreshes its brand list.`,
          'success',
        );
        if (outcome.data.warning) toast.show(outcome.data.warning, 'warning');
        refreshQuietly();
        return;
      }
      case 'expired':
        return;
      case 'unknown':
        toast.show(outcome.message, 'error');
        refreshQuietly();
        return;
      case 'refused':
      case 'retry':
        toast.show(`${label} was not changed. ${outcome.message}`, 'error');
        if (outcome.kind === 'refused' && outcome.status === 403) router.refresh();
        refreshQuietly();
    }
  };

  const changeStatus = async (card: CatalogCard, next: boolean) => {
    if (!canWrite || busyRef.current) return;
    busyRef.current = true;
    setStatusId(card.id);
    let sent = false;
    try {
      const fresh = await reload();
      if (!fresh) {
        toast.show(CHECK_FAILED, 'error');
        return;
      }
      const live = fresh.cards.find((entry) => entry.id === card.id);
      if (!live) {
        toast.show(`${brandLabel(card)} is no longer in the catalog, so nothing was changed.`, 'warning');
        return;
      }
      const label = brandLabel(live);
      if (live.is_active === next) {
        toast.show(`${label} is already ${statusText(next).toLowerCase()}, so nothing needed to change.`);
        return;
      }
      const decision = await confirm<MutationOutcome<CardReceipt>>({
        tone: next ? 'default' : 'danger',
        title: next ? `Activate ${label}?` : `Deactivate ${label}?`,
        message: next
          ? 'This shows the brand to users in the Sell tab and the rate calculator.'
          : 'This hides the brand from users in the Sell tab and the rate calculator.',
        details: [
          { label: 'Brand', value: label },
          { label: 'Status', value: <ValueDiff before={statusText(live.is_active)} after={statusText(next)} /> },
          { label: 'Available countries', value: `${availableCountries(live)} of ${live.countries.length}`, mono: true },
          { label: 'Position', value: positionText(fresh.cards.indexOf(live), fresh.cards.length), mono: true },
        ],
        consequences: statusConsequences(live, next),
        confirmLabel: next ? 'Activate brand' : 'Deactivate brand',
        pendingLabel: next ? 'Activating…' : 'Deactivating…',
        action: async () => {
          sent = true;
          const outcome = classifyMutation(await apiRequest('/api/cards', {
            method: 'PATCH',
            body: { type: 'card', id: live.id, is_active: next },
            select: toCardReceipt,
          }));
          if (outcome.kind === 'retry') throw new Error(outcome.message);
          return outcome;
        },
        returnFocusTo: () => visibleTarget(`[data-row-menu="${card.id}"]`) ?? listRegionRef.current,
      });
      if (decision?.value) {
        reportStatus(decision.value, live, next);
        return;
      }
      if (sent) refreshQuietly();
    } finally {
      busyRef.current = false;
      setStatusId(null);
    }
  };

  if (denied) {
    return (
      <div>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied required={['catalog.read']} />
      </div>
    );
  }

  const createButton = (
    <Button
      variant="primary"
      size="sm"
      leftIcon={<Plus size={14} aria-hidden />}
      disabled={!loaded}
      onClick={() => openEditor({ mode: 'create' })}
    >
      Add brand
    </Button>
  );

  const emptyTitle = filtering ? `No brands match “${search}”` : 'No card brands yet';
  const emptyHint = filtering
    ? 'Search by brand name, or by a country’s name or code.'
    : canWrite
      ? 'Add the first brand users can sell.'
      : 'Brands appear here once an admin adds them.';
  const emptyAction = filtering
    ? <Button variant="secondary" size="sm" onClick={clearSearch}>Clear search</Button>
    : canWrite
      ? createButton
      : undefined;

  const statItems: StatItem[] = [
    { label: 'Brands', value: count(stats.total), loading: showSkeleton, unavailable: blocked },
    { label: 'Active', value: count(stats.active), loading: showSkeleton, unavailable: blocked },
    { label: 'Inactive', value: count(stats.inactive), loading: showSkeleton, unavailable: blocked },
    {
      label: 'Active without a country',
      value: count(stats.needsCountry),
      hint: stats.needsCountry > 0 ? 'Shown to users but cannot be sold' : undefined,
      tone: stats.needsCountry > 0 ? 'warning' : 'neutral',
      loading: showSkeleton,
      unavailable: blocked,
    },
  ];

  const moveControls = (card: CatalogCard, index: number, compact: boolean) => (
    <MoveControls
      card={card}
      index={index}
      total={total}
      saving={savingId === card.id}
      locked={locked}
      showPosition={!compact}
      onMove={(target) => void move(card, target, 'button')}
    />
  );

  const rowMenu = (card: CatalogCard, index: number) => (
    <BrandMenu
      card={card}
      index={index}
      total={total}
      locked={locked}
      canReorder={canReorder}
      onEdit={() => openEditor({ mode: 'edit', id: card.id })}
      onCountries={() => openBrand(card.id)}
      onMove={(target) => void move(card, target, 'menu')}
      onStatus={(next) => void changeStatus(card, next)}
    />
  );

  const desktopList = (
    <Card>
      <CardBody flush>
        <Table flush aria-label="Card brands" busy={tableBusy}>
          <THead>
            <Tr>
              <Th>Position</Th>
              <Th>Brand</Th>
              <Th>Countries</Th>
              <Th>Status</Th>
              {canWrite ? <Th align="right"><span className={s.srOnly}>Actions</span></Th> : null}
            </Tr>
          </THead>
          <TBody>
            {blocked && listError ? (
              <TableState colSpan={columnCount}>
                <ErrorState
                  compact
                  title={LOAD_FAILED}
                  message={listError.message}
                  requestId={listError.requestId}
                  onRetry={retry}
                  retrying={catalog.isInitialLoading || catalog.isRefreshing}
                />
              </TableState>
            ) : showSkeleton ? (
              <TableSkeleton columns={canWrite ? WRITE_SKELETON_COLUMNS : SKELETON_COLUMNS} rows={8} />
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={columnCount} title={emptyTitle} hint={emptyHint} actions={emptyAction} />
            ) : (
              rows.map((card) => {
                const index = positions.get(card.id) ?? 0;
                return (
                  <Tr key={card.id} selected={card.id === openId} onActivate={() => openBrand(card.id)}>
                    <Td>
                      {canReorder ? moveControls(card, index, false) : <span className={s.position}>{index + 1}</span>}
                    </Td>
                    <Td>
                      <div className={s.brandCell}>
                        <BrandMark src={card.logo_url} name={card.name} />
                        <RowOpen onClick={() => openBrand(card.id)} aria-haspopup="dialog" data-row-open={card.id}>
                          {brandLabel(card)}
                        </RowOpen>
                      </div>
                    </Td>
                    <Td>
                      <CountryCell card={card} />
                    </Td>
                    <Td>
                      <BrandStatus card={card} />
                    </Td>
                    {canWrite ? <Td align="right">{rowMenu(card, index)}</Td> : null}
                  </Tr>
                );
              })
            )}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );

  const mobileList = (
    <MobileDataList<CatalogCard>
      ariaLabel="Card brands"
      items={rows}
      getKey={(card) => card.id}
      loading={showSkeleton || catalog.isRefreshing}
      initialLoading={showSkeleton}
      busy={tableBusy}
      error={blocked && listError ? listError.message : null}
      errorTitle={LOAD_FAILED}
      onRetry={retry}
      skeletonRows={8}
      empty={{ title: emptyTitle, hint: emptyHint, actions: emptyAction }}
      renderRow={(card) => {
        const index = positions.get(card.id) ?? 0;
        return {
          leading: <BrandMark src={card.logo_url} name={card.name} />,
          primary: brandLabel(card),
          secondary: countryText(card),
          status: <BrandStatus card={card} />,
          meta: `Position ${positionText(index, total)}`,
          onClick: () => openBrand(card.id),
          actions: canWrite ? (
            <>
              {canReorder ? moveControls(card, index, true) : null}
              {rowMenu(card, index)}
            </>
          ) : undefined,
        };
      }}
    />
  );

  return (
    <div>
      <PageHeader title={TITLE} subtitle={SUBTITLE} actions={canWrite ? createButton : undefined} />

      {listError && loaded ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          meta={
            catalog.lastUpdatedAt
              ? `Showing the catalog from ${formatBusinessTime(new Date(catalog.lastUpdatedAt))} ${BUSINESS_TZ_LABEL}.`
              : undefined
          }
          actions={<Button variant="ghost" size="sm" onClick={retry}>Try again</Button>}
        >
          The catalog could not be refreshed. {listError.message}
        </Notice>
      ) : null}

      <StatStrip aria-label="Catalog summary" items={statItems} />

      {loaded && shared && canReorder ? (
        <Notice tone="info" compact>
          Some brands share a position, so the app can list them in either order. Moving any brand saves a clean order
          for every brand.
        </Notice>
      ) : null}

      {loaded && total > 0 ? (
        <FilterBar
          aria-label="Find a brand"
          search={
            <SearchInput
              aria-label="Search brands"
              placeholder="Brand, country or country code"
              value={searchText}
              onChange={setSearchText}
              onDebouncedChange={applySearch}
            />
          }
          onClear={clearSearch}
          active={searchText.trim() !== ''}
        />
      ) : null}

      {filtering && canWrite && total > 1 ? (
        <p className={s.hint}>
          {`Showing ${plural(rows.length, 'matching brand', 'matching brands')}. Clear the search to change the order.`}
        </p>
      ) : null}

      <div ref={listRegionRef} className={s.listRegion} tabIndex={-1} role="region" aria-label="Brands">
        <ResponsiveView desktop={desktopList} mobile={mobileList} />
      </div>

      <p className={s.srOnly} role="status">{announcement}</p>

      {openCard ? (
        <BrandPanel
          key={openCard.id}
          card={openCard}
          index={positions.get(openCard.id) ?? 0}
          total={total}
          canWrite={canWrite}
          reload={reload}
          patchCards={patchCards}
          refreshQuietly={refreshQuietly}
          onEdit={() => openEditor({ mode: 'edit', id: openCard.id })}
          onClose={closePanel}
          returnFocusTo={panelReturn}
        />
      ) : null}

      {canWrite && editor && (editor.mode === 'create' || editCard) ? (
        <BrandEditor
          key={editor.mode === 'edit' ? `edit-${editor.id}` : 'create'}
          card={editor.mode === 'edit' ? editCard : null}
          cards={cards}
          reload={reload}
          onCreated={handleCreated}
          onUpdated={handleUpdated}
          onStale={refreshQuietly}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
