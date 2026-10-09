'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { BadgePercent, ChevronsDownUp, ChevronsUpDown, RotateCw } from 'lucide-react';
import {
  AccessDenied, Button, Card, EmptyState, ErrorState, FilterBar, LinkButton, Notice, PageHeader, SearchInput, Select,
  StatStrip, useCan, useConfirm, useResource, useToast,
  type StatItem,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { useIsMobile } from '../../lib/useIsMobile';
import { BUSINESS_TZ_LABEL, formatBusinessDate, formatBusinessTime } from '../../lib/time';
import {
  EMPTY_DRAFT, EMPTY_REVIEW, SHOW_OPTIONS, addTarget, changesByCard, classifyAdd, classifySave, containsRow, draftCount,
  editActive, editRate, filterCards, filtersActive, groupTitle, issuesByCard, newRangeBody, overlapsFor, rateInputId,
  rebaseDraft, rebaseNotice, reviewDraft, revertRow, savePayload, settleSave, toAddResponse, toRatesSnapshot,
  toSaveResponse,
  type AddOutcome, type AddRangeTarget, type Draft, type NewRangeValues, type PageNotice, type Phase, type RateRow,
  type RatesSnapshot, type SaveOutcome, type ShowFilter,
} from './model';
import { addRangeOptions, discardOptions, leaveOptions, reviewOptions } from './confirmOptions';
import { RateCardSection, type RateEditor } from './RateList';
import { PageNoticeView, RatesSkeleton, UnsavedBar } from './RateParts';
import { AddRangeModal } from './AddRangeModal';
import { useLeaveGuard } from './useLeaveGuard';
import s from './page.module.css';

const TITLE = 'Rates';
const SUBTITLE =
  'Naira paid per unit of card value, by card, country, type and value range. Saved changes apply to new submissions straight away.';
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

interface FocusRequest {
  id: string | null;
  seq: number;
}

interface Settled {
  snapshot: RatesSnapshot | null;
}

function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function withAll(set: ReadonlySet<string>, ids: Iterable<string>): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const id of ids) {
    if ((next ?? set).has(id)) continue;
    next = next ?? new Set(set);
    next.add(id);
  }
  return next ?? set;
}

function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

function loadedAt(timestamp: number | null): string {
  return timestamp === null ? '—' : `${formatBusinessTime(new Date(timestamp))} ${BUSINESS_TZ_LABEL}`;
}

export default function RatesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const isMobile = useIsMobile();
  const canWrite = useCan('rates.write');
  const canCatalog = useCan('catalog.read');

  const rates = useResource<RatesSnapshot>('rates', (signal) => (
    apiRequest('/api/rates', { signal, select: toRatesSnapshot })
  ));
  const { refresh: refreshRates } = rates;
  const snapshot = rates.data;

  const [draft, setDraftState] = useState<Draft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [kept, setKept] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [revealAll, setRevealAll] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [open, setOpen] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<ShowFilter>('all');
  const [notice, setNotice] = useState<PageNotice | null>(null);
  const [adding, setAdding] = useState<AddRangeTarget | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const draftRef = useRef<Draft>(EMPTY_DRAFT);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const autoOpenedRef = useRef(false);
  const handledFocusRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const commitDraft = useCallback((next: Draft) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const updateDraft = useCallback((change: (current: Draft) => Draft) => {
    commitDraft(change(draftRef.current));
  }, [commitDraft]);

  const requestFocus = useCallback((id: string | null) => {
    setFocusRequest((previous) => ({ id, seq: (previous?.seq ?? 0) + 1 }));
  }, []);

  const review = useMemo(() => (snapshot ? reviewDraft(snapshot, draft) : EMPTY_REVIEW), [snapshot, draft]);
  const changeCount = useMemo(() => draftCount(draft), [draft]);
  const shownErrors = useMemo(() => {
    const shown: Record<string, string> = {};
    for (const [id, message] of Object.entries(review.errors)) {
      if (revealAll || touched.has(id)) shown[id] = message;
    }
    return shown;
  }, [review.errors, revealAll, touched]);
  const cardChanges = useMemo(
    () => (snapshot ? changesByCard(snapshot, draft) : new Map<string, number>()),
    [snapshot, draft],
  );
  const cardIssues = useMemo(
    () => (snapshot ? issuesByCard(snapshot, shownErrors) : new Map<string, number>()),
    [snapshot, shownErrors],
  );
  const visible = useMemo(
    () => (snapshot ? filterCards(snapshot.cards, query, show, draft, kept) : []),
    [snapshot, query, show, draft, kept],
  );

  const dirty = canWrite && changeCount > 0;
  const busy = phase !== 'idle';
  const issueCount = Object.keys(shownErrors).length;
  const filtering = filtersActive(query, show) || searchText.trim() !== '';

  useLeaveGuard(dirty, () => (
    confirm(leaveOptions(draftCount(draftRef.current))).then((decision) => decision !== null)
  ));

  useEffect(() => {
    if (!snapshot || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    if (snapshot.cards.length === 1) setOpen((previous) => withAll(previous, [snapshot.cards[0].id]));
  }, [snapshot]);

  useEffect(() => {
    if (!focusRequest || busy || handledFocusRef.current === focusRequest.seq) return;
    handledFocusRef.current = focusRequest.seq;
    if (focusRequest.id === null) {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      listRef.current?.focus({ preventScroll: true });
      return;
    }
    const element = document.getElementById(rateInputId(focusRequest.id));
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' });
  }, [focusRequest, busy]);

  const revealRow = useCallback((id: string, current: RatesSnapshot) => {
    const row = current.rows[id];
    if (!row) return;
    if (!containsRow(filterCards(current.cards, query, show, draftRef.current), id)) {
      setSearchText('');
      setQuery('');
      setShow('all');
    }
    setOpen((previous) => withAll(previous, [row.path.cardId]));
    setRevealAll(true);
    requestFocus(id);
  }, [query, show, requestFocus]);

  const openMatching = useCallback((nextQuery: string, nextShow: ShowFilter) => {
    if (!snapshot || !filtersActive(nextQuery, nextShow)) return;
    const matches = filterCards(snapshot.cards, nextQuery, nextShow, draftRef.current);
    setOpen((previous) => withAll(previous, matches.map((card) => card.id)));
  }, [snapshot]);

  const applyQuery = useCallback((value: string) => {
    setQuery(value);
    openMatching(value, show);
  }, [openMatching, show]);

  const applyShow = (next: ShowFilter) => {
    setShow(next);
    setKept(EMPTY_SET);
    openMatching(query, next);
  };

  const clearFilters = useCallback(() => {
    setSearchText('');
    setQuery('');
    setShow('all');
    setKept(EMPTY_SET);
  }, []);

  const toggleCard = useCallback((id: string) => {
    setOpen((previous) => toggled(previous, id));
  }, []);

  const editor = useMemo<RateEditor>(() => ({
    draft,
    errors: shownErrors,
    canWrite,
    isMobile,
    onRate: (row: RateRow, value: string) => {
      updateDraft((current) => editRate(current, row, value));
      setKept((previous) => withAll(previous, [row.id]));
    },
    onActive: (row: RateRow, active: boolean) => {
      updateDraft((current) => editActive(current, row, active));
      setTouched((previous) => withAll(previous, [row.id]));
      setKept((previous) => withAll(previous, [row.id]));
    },
    onRevert: (row: RateRow) => {
      updateDraft((current) => revertRow(current, row.id));
      setTouched((previous) => withoutId(previous, row.id));
      setKept((previous) => withAll(previous, [row.id]));
      requestFocus(row.id);
    },
    onBlur: (row: RateRow) => setTouched((previous) => withAll(previous, [row.id])),
    onAdd: (group) => setAdding(addTarget(group)),
  }), [draft, shownErrors, canWrite, isMobile, updateDraft, requestFocus]);

  const reload = async () => {
    if (busyRef.current) return;
    const result = await refreshRates();
    if (!aliveRef.current || !result) return;
    if (!result.ok) {
      if (result.error.status === 403) router.refresh();
      return;
    }
    const rebased = rebaseDraft(draftRef.current, result.data);
    commitDraft(rebased.draft);
    const note = rebaseNotice(rebased, true);
    if (note) setNotice(note);
  };

  const runReview = async () => {
    if (busyRef.current || !snapshot || !canWrite) return;
    const local = reviewDraft(snapshot, draftRef.current);
    if (local.firstError) {
      revealRow(local.firstError, snapshot);
      return;
    }
    if (local.changes.length === 0) return;
    busyRef.current = true;
    setPhase('checking');
    const settled: Settled = { snapshot: null };
    try {
      const fresh = await refreshRates();
      if (!aliveRef.current || !fresh) return;
      if (!fresh.ok) {
        if (fresh.error.status !== 401) {
          toast.show(`The live rates could not be checked, so nothing was saved. ${fresh.error.message}`, 'error');
        }
        if (fresh.error.status === 403) router.refresh();
        return;
      }
      const rebased = rebaseDraft(draftRef.current, fresh.data);
      commitDraft(rebased.draft);
      setNotice(rebaseNotice(rebased, false));
      const pending = reviewDraft(fresh.data, rebased.draft);
      if (pending.firstError) {
        revealRow(pending.firstError, fresh.data);
        toast.show('Another admin changed some of these rates while you were editing. Check the highlighted range.', 'warning');
        return;
      }
      if (pending.changes.length === 0) {
        toast.show('These rates are already live, so nothing needed saving.');
        requestFocus(null);
        return;
      }
      setPhase('confirming');
      const decision = await confirm<SaveOutcome>({
        ...reviewOptions(pending.changes),
        action: async () => {
          setPhase('saving');
          const outcome = classifySave(await apiRequest('/api/rates', {
            method: 'PATCH',
            body: savePayload(pending.changes),
            select: toSaveResponse,
          }));
          if (outcome.kind === 'retry') {
            setPhase('confirming');
            throw new Error(outcome.message);
          }
          if (outcome.kind === 'saved' || outcome.kind === 'partial' || outcome.kind === 'unknown') {
            const after = await refreshRates();
            settled.snapshot = after && after.ok ? after.data : null;
          }
          return outcome;
        },
        returnFocusTo: () => listRef.current,
      });
      if (!aliveRef.current) return;
      const outcome = decision?.value;
      if (!outcome) return;
      const settlement = settleSave(draftRef.current, pending.changes, outcome, settled.snapshot);
      commitDraft(settlement.draft);
      setKept(EMPTY_SET);
      if (settlement.notice) setNotice(settlement.notice);
      for (const note of settlement.toasts) toast.show(note.text, note.tone);
      if (outcome.kind === 'refused' && outcome.status === 403) router.refresh();
      if (settlement.cleared) {
        setTouched(EMPTY_SET);
        setRevealAll(false);
        requestFocus(null);
      }
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setPhase('idle');
    }
  };

  const runDiscard = async () => {
    if (busyRef.current) return;
    const total = draftCount(draftRef.current);
    if (total === 0) return;
    const decision = await confirm(discardOptions(total));
    if (!decision || !aliveRef.current || busyRef.current) return;
    commitDraft(EMPTY_DRAFT);
    setTouched(EMPTY_SET);
    setKept(EMPTY_SET);
    setRevealAll(false);
    setNotice(null);
    requestFocus(null);
  };

  const submitRange = async (target: AddRangeTarget, values: NewRangeValues): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    const settled: Settled = { snapshot: null };
    try {
      const decision = await confirm<AddOutcome>({
        ...addRangeOptions(target, values, overlapsFor(target, values.min, values.max)),
        action: async () => {
          const outcome = classifyAdd(await apiRequest('/api/rates', {
            method: 'POST',
            body: newRangeBody(target, values),
            select: toAddResponse,
          }));
          if (outcome.kind === 'retry') throw new Error(outcome.message);
          if (outcome.kind === 'added' || outcome.kind === 'unknown' || (outcome.kind === 'refused' && outcome.status === 404)) {
            const after = await refreshRates();
            settled.snapshot = after && after.ok ? after.data : null;
          }
          return outcome;
        },
      });
      if (!aliveRef.current) return false;
      const outcome = decision?.value;
      if (!outcome) return false;
      if (settled.snapshot) {
        const rebased = rebaseDraft(draftRef.current, settled.snapshot);
        commitDraft(rebased.draft);
        const note = rebaseNotice(rebased, true);
        if (note) setNotice(note);
      }
      switch (outcome.kind) {
        case 'added':
          toast.show(`Added ${values.label} to ${target.path.cardName} · ${groupTitle(target.path)}.`, 'success');
          if (outcome.warning) toast.show(outcome.warning, 'warning');
          setOpen((previous) => withAll(previous, [target.path.cardId]));
          return true;
        case 'unknown':
          toast.show(
            'No answer came back, so the range may or may not have been added. Check the list before adding it again.',
            'error',
          );
          return true;
        case 'refused':
          toast.show(outcome.message, 'error');
          if (outcome.status === 403) router.refresh();
          return outcome.status === 404;
        case 'expired':
        case 'retry':
          return false;
      }
    } finally {
      busyRef.current = false;
    }
  };

  if (rates.error?.status === 403 && !snapshot) {
    return (
      <div className={s.page}>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied required={['rates.read']} />
      </div>
    );
  }

  const updatedAt = snapshot ? rates.lastUpdatedAt : null;
  const loading = rates.isInitialLoading;
  const stats: StatItem[] = [
    { label: 'Cards', value: snapshot ? snapshot.totals.cards.toLocaleString('en-NG') : '—', loading },
    { label: 'Active ranges', value: snapshot ? snapshot.totals.active.toLocaleString('en-NG') : '—', loading },
    { label: 'Switched off', value: snapshot ? snapshot.totals.inactive.toLocaleString('en-NG') : '—', loading },
    {
      label: 'Last refreshed',
      value: loadedAt(updatedAt),
      hint: updatedAt === null ? undefined : formatBusinessDate(new Date(updatedAt)),
      mono: true,
      loading,
    },
  ];
  const visibleIds = visible.map((card) => card.id);
  const allOpen = visibleIds.length > 0 && visibleIds.every((id) => open.has(id));
  const showOptions = SHOW_OPTIONS.filter((option) => canWrite || option.value !== 'changed');

  let body: ReactNode;
  if (!snapshot) {
    body = rates.error ? (
      <Card>
        <ErrorState
          compact
          title="The rates could not be loaded"
          message={rates.error.message}
          requestId={rates.error.requestId}
          onRetry={() => void refreshRates()}
          retrying={rates.isInitialLoading || rates.isRefreshing}
        />
      </Card>
    ) : (
      <RatesSkeleton />
    );
  } else if (snapshot.cards.length === 0) {
    body = (
      <EmptyState
        icon={<BadgePercent size={20} strokeWidth={1.75} aria-hidden />}
        title="No active cards"
        hint="Rates are set per card, country and type. Add a card, or switch one on, in Cards."
        actions={canCatalog ? <LinkButton href="/cards" variant="secondary" size="sm">Open Cards</LinkButton> : undefined}
      />
    );
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        title="No ranges match these filters"
        hint="Try a different search, or show all ranges."
        actions={<Button type="button" variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>}
      />
    );
  } else {
    body = (
      <Card className={s.brandList}>
        {visible.map((card) => (
          <RateCardSection
            key={card.id}
            card={card}
            expanded={open.has(card.id)}
            changes={cardChanges.get(card.id) ?? 0}
            issues={cardIssues.get(card.id) ?? 0}
            editor={editor}
            onToggle={toggleCard}
          />
        ))}
      </Card>
    );
  }

  return (
    <div className={dirty ? `${s.page} ${s.dirty}` : s.page}>
      <PageHeader
        title={TITLE}
        subtitle={SUBTITLE}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<RotateCw size={14} aria-hidden />}
            loading={rates.isRefreshing && !busy}
            disabled={busy || loading}
            onClick={() => void reload()}
          >
            Refresh
          </Button>
        }
      />

      {rates.error && snapshot ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          meta={updatedAt === null ? undefined : `Showing rates loaded at ${loadedAt(updatedAt)}.`}
          actions={<Button type="button" variant="ghost" size="sm" onClick={() => void reload()}>Try again</Button>}
        >
          The rates could not be refreshed. {rates.error.message}
        </Notice>
      ) : null}

      {notice ? <PageNoticeView notice={notice} onDismiss={() => setNotice(null)} /> : null}

      {snapshot && !canWrite ? (
        <Notice tone="neutral" compact>
          You can view rates but not change them. Changing rates needs the Draft rate changes permission (rates.write).
        </Notice>
      ) : null}

      <StatStrip aria-label="Rates summary" items={stats} />

      {snapshot && snapshot.cards.length > 0 ? (
        <FilterBar
          aria-label="Filter rates"
          search={
            <SearchInput
              aria-label="Search rates"
              placeholder="Card, country, type or range"
              value={searchText}
              onChange={setSearchText}
              onDebouncedChange={applyQuery}
            />
          }
          filters={
            <Select
              inline
              aria-label="Show"
              value={show}
              onChange={(event) => applyShow(event.target.value as ShowFilter)}
            >
              {showOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          }
          onClear={clearFilters}
          active={filtering}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={allOpen ? <ChevronsDownUp size={14} aria-hidden /> : <ChevronsUpDown size={14} aria-hidden />}
              disabled={visibleIds.length === 0}
              onClick={() => setOpen(allOpen ? EMPTY_SET : withAll(open, visibleIds))}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          }
        />
      ) : null}

      <div
        ref={listRef}
        className={s.list}
        tabIndex={-1}
        role="region"
        aria-label="Rates by card"
        aria-busy={busy || undefined}
      >
        <fieldset className={s.fieldset} disabled={busy}>
          {body}
        </fieldset>
      </div>

      {dirty ? (
        <UnsavedBar
          count={changeCount}
          issues={issueCount}
          phase={phase}
          onDiscard={() => void runDiscard()}
          onReview={() => void runReview()}
        />
      ) : null}

      {canWrite && adding ? (
        <AddRangeModal
          key={adding.path.typeId}
          target={adding}
          onClose={() => setAdding(null)}
          onSubmit={submitRange}
        />
      ) : null}
    </div>
  );
}
