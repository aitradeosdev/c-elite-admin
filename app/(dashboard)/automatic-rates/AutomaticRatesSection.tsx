'use client';

import { useEffect, useId, useMemo, useRef, useState, type Ref } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import {
  AccessDenied, Button, Card, CardBody, ErrorState, Notice, SkeletonLines, useCan, useConfirm, useResource, useToast,
} from '../../_ui';
import { apiRequest, type ApiFailure, type ApiResult } from '../../lib/apiClient';
import { useIsMobile } from '../../lib/useIsMobile';
import { permissionLabel } from '../../lib/permissions';
import { BUSINESS_TZ_LABEL, formatBusinessTime } from '../../lib/time';
import { ConfigForm, SectionHeading, type ConfigSection } from '../_config/ConfigForm';
import {
  INTERVAL_OPTIONS, PERCENT_MAX, PERCENT_MIN, RUN_REQUEST_TIMEOUT_MS, TEXT, formatPct, intervalLabel, parsePercent,
  pctText, toProviderList,
} from './rules';
import {
  CARDS_ENDPOINT, PROVIDERS_ENDPOINT, RUN_ENDPOINT, SETTINGS_ENDPOINT, STATUS_ENDPOINT, classifyWrite, linkDueText,
  providerLock, providerName, rangesRepricedText, runToastText, toAutomaticStatus, toCardsSnapshot, toLinkReceipt,
  toMarkupReceipt, toRunReceipt, toSwitchReceipt, turnOnBlock,
  type AutomaticStatus, type CardsSnapshot, type LinkCard, type LinkReceipt, type LinkRow, type MarkupReceipt,
  type ProviderProduct, type ProvidersView, type RunReceipt, type SwitchReceipt, type WriteOutcome,
} from './model';
import { extraOptions, linkOptions, runOptions, turnOffOptions, turnOnOptions, unlinkOptions } from './confirmOptions';
import { AutomaticRatesSkeleton, SettingsSummary, SwitchCard, UpdatesCard } from './AutomaticRatesParts';
import { LinksCard } from './LinksCard';
import { LinkModal } from './LinkModal';
import { ExtraPercentageModal } from './ExtraPercentageModal';
import s from './page.module.css';

const POLL_MS = 30_000;
const CLOCK_MS = 30_000;

export type Working = 'switch' | 'run' | 'products' | 'link' | 'markup';

interface Attempt {
  sent: boolean;
  settled: boolean;
  refusal: string | null;
}

interface Linking {
  row: LinkRow;
  card: LinkCard;
}

const fetchStatus = (signal: AbortSignal) => apiRequest(STATUS_ENDPOINT, {
  signal,
  select: (body) => toAutomaticStatus(body.automatic),
});

const fetchProviders = (signal: AbortSignal) => apiRequest(PROVIDERS_ENDPOINT, {
  signal,
  select: (body) => toProviderList(body.providers),
});

const fetchCards = (signal: AbortSignal) => apiRequest(CARDS_ENDPOINT, { signal, select: toCardsSnapshot });

function newAttempt(): Attempt {
  return { sent: false, settled: false, refusal: null };
}

function useClock(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function count(value: number, one: string, many: string): string {
  return `${value.toLocaleString('en-NG')} ${value === 1 ? one : many}`;
}

function universalConsequence(enabled: boolean) {
  return (next: string): string | null => {
    const parsed = parsePercent(next);
    if (!parsed.ok) return null;
    const when = enabled ? 'straight away' : 'once automatic rates are on';
    if (parsed.hundredths === 0) {
      return `Linked cards without their own extra percentage are paid exactly the provider’s rate ${when}.`;
    }
    const size = `${pctText(Math.abs(parsed.value))}%`;
    const direction = parsed.hundredths > 0 ? 'more' : 'less';
    return `Linked cards without their own extra percentage are paid ${size} ${direction} than the provider’s rate, rounded to the nearest kobo, ${when}.`;
  };
}

function settingsSections(view: ProvidersView, enabled: boolean): ConfigSection[] {
  const sections: ConfigSection[] = [];
  if (view.state === 'ready' && view.providers.length > 0) {
    sections.push({
      title: 'Rate provider',
      fields: [{
        key: 'rate_provider',
        label: 'Rate provider',
        hint: 'Choosing a provider changes no rate. Card types are linked to its products below, and it is only read while automatic rates are on. It can only be changed while automatic rates are off.',
        input: 'select',
        options: [
          { value: '', label: 'Not chosen' },
          ...view.providers.map((provider) => ({ value: provider.id, label: provider.label })),
        ],
      }],
    });
  }
  sections.push({
    title: 'Schedule and extra percentage',
    fields: [
      {
        key: 'interval_minutes',
        label: 'Update every',
        hint: 'How often linked card types are read from the rate provider while automatic rates are on. An update that is due starts within 5 minutes.',
        input: 'select',
        required: true,
        options: INTERVAL_OPTIONS.map((minutes) => ({ value: String(minutes), label: intervalLabel(minutes) })),
      },
      {
        key: 'universal_markup_pct',
        label: 'Extra percentage for every card',
        hint: 'Added to the provider’s rate on every linked card that has no extra percentage of its own, in every country and currency. Use a negative percentage to pay less than the provider. Rates are rounded to the nearest kobo: ₦1,200.00 from the provider at +4% pays ₦1,248.00.',
        input: 'number',
        min: PERCENT_MIN,
        max: PERCENT_MAX,
        step: 0.01,
        required: true,
        consequence: universalConsequence(enabled),
      },
    ],
  });
  return sections;
}

export interface AutomaticRatesViewProps {
  status: AutomaticStatus;
  failure: ApiFailure | null;
  shownAt: number | null;
  view: ProvidersView;
  cards: CardsSnapshot | null;
  cardsFailure: ApiFailure | null;
  cardsRetrying: boolean;
  canWrite: boolean;
  isMobile: boolean;
  now: number;
  working: Working | null;
  baseId: string;
  switchRef: Ref<HTMLButtonElement>;
  runRef: Ref<HTMLButtonElement>;
  onRetry: () => void;
  onRetryCards: () => void;
  onToggle: (turnOn: boolean) => void;
  onRun: () => void;
  onLoadProducts: () => void;
  onLink: (row: LinkRow, card: LinkCard) => void;
  onUnlink: (row: LinkRow) => void;
  onExtra: (card: LinkCard) => void;
  onSettingsSaved: () => void;
}

export function AutomaticRatesView({
  status, failure, shownAt, view, cards, cardsFailure, cardsRetrying, canWrite, isMobile, now, working, baseId,
  switchRef, runRef, onRetry, onRetryCards, onToggle, onRun, onLoadProducts, onLink, onUnlink, onExtra, onSettingsSaved,
}: AutomaticRatesViewProps) {
  const sections = useMemo(() => settingsSections(view, status.enabled), [view, status.enabled]);
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of cards ? cards.cards : []) {
      for (const row of card.rows) map.set(row.typeId, row.title);
    }
    return map;
  }, [cards]);
  const provider = providerName(status.provider, view);
  const lock = providerLock(status.provider, view, status.enabled);
  const busy = working !== null;

  return (
    <>
      {failure ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          actions={<Button variant="ghost" size="sm" onClick={onRetry}>Try again</Button>}
        >
          The latest status could not be loaded. {failure.message}
          {shownAt === null ? '' : ` Showing the status from ${formatBusinessTime(new Date(shownAt))} ${BUSINESS_TZ_LABEL}.`}
        </Notice>
      ) : null}

      {canWrite ? null : (
        <Notice tone="neutral" compact>
          You can view automatic rates. Changing them needs the “{permissionLabel('rates.write')}” permission.
        </Notice>
      )}

      <div className={s.sections}>
        <SwitchCard
          status={status}
          now={now}
          canWrite={canWrite}
          block={turnOnBlock(status, view)}
          lock={lock}
          busy={working === 'switch'}
          disabled={busy}
          headingId={`${baseId}-switch`}
          buttonRef={switchRef}
          onToggle={onToggle}
        />

        <UpdatesCard
          status={status}
          now={now}
          view={view}
          cards={cards}
          labels={labels}
          canWrite={canWrite}
          running={working === 'run' || working === 'products' ? working : null}
          disabled={busy}
          headingId={`${baseId}-updates`}
          runRef={runRef}
          onRun={onRun}
          onLoadProducts={onLoadProducts}
        />

        {canWrite ? (
          <div className={s.settings}>
            {view.state === 'failed' ? (
              <Notice tone="warning" compact>The rate service could not be checked, so the provider cannot be changed right now.</Notice>
            ) : null}
            {view.state === 'ready' && view.providers.length === 0 ? (
              <Notice tone="neutral" compact>No rate provider is set up on the server yet.</Notice>
            ) : null}
            {view.state === 'loading' ? (
              <Card aria-busy="true">
                <CardBody>
                  <SkeletonLines rows={3} />
                </CardBody>
              </Card>
            ) : (
              <ConfigForm
                title="Update settings"
                subtitle="Which provider to read, how often, and the extra percentage added to its rates."
                endpoint={SETTINGS_ENDPOINT}
                sections={sections}
                onSaved={onSettingsSaved}
              />
            )}
          </div>
        ) : (
          <SettingsSummary status={status} view={view} headingId={`${baseId}-settings`} />
        )}

        {cards ? (
          <LinksCard
            snapshot={cards}
            provider={provider}
            lock={lock}
            canWrite={canWrite}
            isMobile={isMobile}
            disabled={busy}
            loadingProducts={working === 'products'}
            headingId={`${baseId}-links`}
            onLink={onLink}
            onUnlink={onUnlink}
            onExtra={onExtra}
            onLoadProducts={onLoadProducts}
          />
        ) : cardsFailure ? (
          <Card>
            <ErrorState
              compact
              title="The card types could not be loaded"
              message={cardsFailure.message}
              requestId={cardsFailure.requestId}
              onRetry={onRetryCards}
              retrying={cardsRetrying}
            />
          </Card>
        ) : (
          <Card aria-busy="true">
            <CardBody>
              <SkeletonLines rows={4} />
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}

export default function AutomaticRatesSection() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const isMobile = useIsMobile();
  const canWrite = useCan('rates.write');
  const baseId = useId();
  const status = useResource<AutomaticStatus>('automatic-rates', fetchStatus, { pollMs: POLL_MS });
  const providers = useResource('automatic-rates-providers', fetchProviders);
  const cards = useResource<CardsSnapshot>('automatic-rates-cards', fetchCards);
  const { refresh: refreshStatus, mutate: mutateStatus } = status;
  const { refresh: refreshProviders } = providers;
  const { refresh: refreshCards } = cards;
  const snapshot = status.data;
  const cardsData = cards.data === undefined ? null : cards.data;
  const clock = useClock(CLOCK_MS);
  const now = status.lastUpdatedAt === null ? clock : Math.max(clock, status.lastUpdatedAt);

  const [working, setWorking] = useState<Working | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [extra, setExtra] = useState<LinkCard | null>(null);

  const busyRef = useRef(false);
  const aliveRef = useRef(false);
  const settingsRef = useRef<string | null>(null);
  const switchRef = useRef<HTMLButtonElement>(null);
  const runRef = useRef<HTMLButtonElement>(null);

  const view = useMemo<ProvidersView>(() => {
    if (providers.data) return { state: 'ready', providers: providers.data };
    return providers.error ? { state: 'failed' } : { state: 'loading' };
  }, [providers.data, providers.error]);
  const settingsStamp = snapshot ? `${snapshot.updatedAt}|${snapshot.provider}` : null;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (settingsStamp === null) return;
    const previous = settingsRef.current;
    settingsRef.current = settingsStamp;
    if (previous !== null && previous !== settingsStamp) void refreshCards({ background: true });
  }, [settingsStamp, refreshCards]);

  const readNow = async <T,>(refresh: () => Promise<ApiResult<T> | null>): Promise<T | null> => {
    let result = await refresh();
    if (aliveRef.current && result && !result.ok && result.error.kind === 'aborted') result = await refresh();
    if (!aliveRef.current || !result) return null;
    if (!result.ok) {
      if (result.error.status !== 401) {
        toast.show(`Could not check automatic rates, so nothing was changed. ${result.error.message}`, 'error');
      }
      if (result.error.status === 403) router.refresh();
      return null;
    }
    return result.data;
  };

  const readFresh = () => readNow(refreshStatus);

  const reportCommon = (outcome: WriteOutcome<unknown>): boolean => {
    switch (outcome.kind) {
      case 'denied':
        toast.show(outcome.message, 'error');
        router.refresh();
        return true;
      case 'unknown':
        toast.show(outcome.message, 'error');
        return true;
      case 'expired':
        return true;
      default:
        return false;
    }
  };

  const refreshAll = () => {
    void refreshStatus();
    void refreshProviders();
    void refreshCards();
  };

  const settingsSaved = () => {
    void refreshStatus({ background: true });
    void refreshCards({ background: true });
  };

  const toggleSwitch = async (turnOn: boolean) => {
    if (!canWrite || busyRef.current) return;
    busyRef.current = true;
    setWorking('switch');
    const attempt = newAttempt();
    try {
      const fresh = await readFresh();
      if (!fresh) return;
      if (fresh.enabled === turnOn) {
        toast.show(
          turnOn ? 'Automatic rates are already on. Another admin turned them on.' : 'Automatic rates are already off. Another admin turned them off.',
          'warning',
        );
        return;
      }
      if (turnOn) {
        const block = turnOnBlock(fresh, view);
        if (block !== null) {
          toast.show(block, 'error');
          return;
        }
      }
      const provider = providerName(fresh.provider, view);
      setWorking(null);
      const decision = await confirm<WriteOutcome<SwitchReceipt>>({
        ...(turnOn ? turnOnOptions({ status: fresh, provider, cards: cardsData }) : turnOffOptions(fresh, provider)),
        action: async () => {
          attempt.sent = true;
          attempt.refusal = null;
          const outcome = classifyWrite(await apiRequest(STATUS_ENDPOINT, {
            method: 'PATCH',
            body: { enabled: turnOn, expected: fresh.enabled },
            select: toSwitchReceipt,
          }));
          if (outcome.kind === 'refused') {
            attempt.refusal = outcome.message;
            throw new Error(outcome.message);
          }
          if (outcome.kind === 'done') {
            attempt.settled = true;
            if (outcome.data.status) mutateStatus(outcome.data.status);
            else void refreshStatus({ background: true });
          }
          return outcome;
        },
        returnFocusTo: () => switchRef.current,
      });
      const outcome = decision?.value;
      if (!outcome) {
        if (attempt.refusal) toast.show(attempt.refusal, 'error');
        return;
      }
      if (reportCommon(outcome)) return;
      if (outcome.kind === 'conflict') {
        toast.show(outcome.message, 'warning');
        return;
      }
      if (outcome.kind !== 'done') return;
      if (outcome.data.changed.length === 0) {
        toast.show(`Automatic rates were already ${turnOn ? 'on' : 'off'}. Nothing changed.`);
        return;
      }
      toast.show(
        turnOn
          ? 'Automatic rates are on. The first update starts within 5 minutes.'
          : 'Automatic rates are off. Every rate stays as it is until someone changes it.',
        'success',
      );
    } finally {
      busyRef.current = false;
      setWorking(null);
      if (attempt.sent && !attempt.settled) void refreshStatus({ background: true });
    }
  };

  const runNow = async () => {
    if (!canWrite || busyRef.current) return;
    busyRef.current = true;
    setWorking('run');
    const attempt = newAttempt();
    try {
      const fresh = await readFresh();
      if (!fresh) return;
      if (!fresh.enabled) {
        toast.show(TEXT.runOff, 'error');
        return;
      }
      if (fresh.running) {
        toast.show(TEXT.runBusy, 'warning');
        return;
      }
      const provider = providerName(fresh.provider, view);
      setWorking(null);
      const decision = await confirm<WriteOutcome<RunReceipt>>({
        ...runOptions(provider),
        action: async () => {
          attempt.sent = true;
          attempt.refusal = null;
          const outcome = classifyWrite(await apiRequest(RUN_ENDPOINT, {
            method: 'POST',
            body: { action: 'run' },
            select: toRunReceipt,
            timeoutMs: RUN_REQUEST_TIMEOUT_MS,
          }));
          if (outcome.kind === 'refused') {
            attempt.refusal = outcome.message;
            throw new Error(outcome.message);
          }
          if (outcome.kind === 'done') attempt.settled = true;
          return outcome;
        },
        returnFocusTo: () => runRef.current,
      });
      const outcome = decision?.value;
      if (!outcome) {
        if (attempt.refusal) toast.show(attempt.refusal, 'error');
        return;
      }
      if (reportCommon(outcome)) return;
      if (outcome.kind === 'conflict') {
        toast.show(outcome.message, 'warning');
        return;
      }
      if (outcome.kind === 'done' && outcome.data.mode === 'apply') toast.show(runToastText(outcome.data.summary, provider), 'success');
    } finally {
      busyRef.current = false;
      setWorking(null);
      if (attempt.sent) {
        void refreshStatus({ background: true });
        void refreshCards({ background: true });
      }
    }
  };

  const loadProducts = async () => {
    const current = status.data;
    if (!canWrite || busyRef.current || !current || current.provider === null) return;
    busyRef.current = true;
    setWorking('products');
    try {
      const provider = providerName(current.provider, view);
      const outcome = classifyWrite(await apiRequest(RUN_ENDPOINT, {
        method: 'POST',
        body: { action: 'products' },
        select: toRunReceipt,
        timeoutMs: RUN_REQUEST_TIMEOUT_MS,
      }));
      if (!aliveRef.current || reportCommon(outcome)) return;
      if (outcome.kind === 'refused' || outcome.kind === 'conflict') {
        toast.show(outcome.message, 'error');
        return;
      }
      if (outcome.kind !== 'done' || outcome.data.mode !== 'products') return;
      const { lines, usable } = outcome.data.summary;
      const unusable = lines - usable;
      const note = unusable === 0
        ? ''
        : unusable === 1
          ? ' 1 of them has rates that cannot be used.'
          : ` ${unusable.toLocaleString('en-NG')} of them have rates that cannot be used.`;
      toast.show(`${count(lines, 'product', 'products')} loaded from ${provider}.${note}`, 'success');
    } finally {
      busyRef.current = false;
      setWorking(null);
      void refreshStatus({ background: true });
      void refreshCards({ background: true });
    }
  };

  const saveLinks = async (
    options: ReturnType<typeof linkOptions>,
    change: { card_type_id: string; provider_ref: string | null; expected_ref: string | null },
  ): Promise<WriteOutcome<LinkReceipt> | null> => {
    const attempt = newAttempt();
    try {
      const decision = await confirm<WriteOutcome<LinkReceipt>>({
        ...options,
        action: async () => {
          attempt.sent = true;
          attempt.refusal = null;
          const outcome = classifyWrite(await apiRequest(CARDS_ENDPOINT, {
            method: 'PATCH',
            body: { type: 'links', changes: [change] },
            select: toLinkReceipt,
          }));
          if (outcome.kind === 'refused') {
            attempt.refusal = outcome.message;
            throw new Error(outcome.message);
          }
          return outcome;
        },
      });
      const outcome = decision?.value;
      if (!outcome) {
        if (attempt.refusal) toast.show(attempt.refusal, 'error');
        return null;
      }
      return outcome;
    } finally {
      if (attempt.sent) {
        void refreshCards({ background: true });
        void refreshStatus({ background: true });
      }
    }
  };

  const submitLink = async (row: LinkRow, card: LinkCard, product: ProviderProduct): Promise<boolean> => {
    if (!canWrite || busyRef.current) return false;
    busyRef.current = true;
    setWorking('link');
    try {
      const fresh = await readFresh();
      if (!fresh) return false;
      const cardsNow = await readNow(refreshCards);
      if (!cardsNow) return false;
      const freshCard = cardsNow.cards.find((entry) => entry.id === card.id);
      if (!freshCard) {
        toast.show(`${card.name} is no longer listed (it was switched off or removed in Cards), so nothing was changed.`, 'error');
        return true;
      }
      const provider = providerName(fresh.provider, view);
      const priced = { ...freshCard, effectivePct: freshCard.ownPct ?? fresh.universalPct };
      const outcome = await saveLinks(linkOptions(row, priced, product, provider), {
        card_type_id: row.typeId,
        provider_ref: product.ref,
        expected_ref: row.ref,
      });
      if (!outcome || !aliveRef.current) return false;
      if (reportCommon(outcome)) return outcome.kind !== 'expired';
      if (outcome.kind === 'conflict') {
        toast.show(outcome.message, 'warning');
        return true;
      }
      if (outcome.kind !== 'done') return false;
      toast.show(`${row.title} is linked to ${product.name}.${linkDueText(fresh, Date.now())}`, 'success');
      return true;
    } finally {
      busyRef.current = false;
      setWorking(null);
    }
  };

  const unlink = async (row: LinkRow) => {
    if (!canWrite || busyRef.current || row.ref === null) return;
    busyRef.current = true;
    setWorking('link');
    try {
      const outcome = await saveLinks(unlinkOptions(row), { card_type_id: row.typeId, provider_ref: null, expected_ref: row.ref });
      if (!outcome || !aliveRef.current || reportCommon(outcome)) return;
      if (outcome.kind === 'conflict') {
        toast.show(outcome.message, 'warning');
        return;
      }
      if (outcome.kind === 'done') toast.show(`${row.title} is unlinked. Its rates are set by hand from now on.`, 'success');
    } finally {
      busyRef.current = false;
      setWorking(null);
    }
  };

  const submitExtra = async (card: LinkCard, next: number | null): Promise<boolean> => {
    if (!canWrite || busyRef.current) return false;
    busyRef.current = true;
    setWorking('markup');
    const attempt = newAttempt();
    try {
      const fresh = await readFresh();
      if (!fresh) return false;
      const decision = await confirm<WriteOutcome<MarkupReceipt>>({
        ...extraOptions(card, next, fresh.universalPct, fresh.enabled),
        action: async () => {
          attempt.sent = true;
          attempt.refusal = null;
          const outcome = classifyWrite(await apiRequest(CARDS_ENDPOINT, {
            method: 'PATCH',
            body: {
              type: 'markup',
              card_id: card.id,
              markup_pct: next === null ? null : pctText(next),
              expected: card.ownPct === null ? null : pctText(card.ownPct),
            },
            select: toMarkupReceipt,
          }));
          if (outcome.kind === 'refused') {
            attempt.refusal = outcome.message;
            throw new Error(outcome.message);
          }
          return outcome;
        },
      });
      const outcome = decision?.value;
      if (!outcome) {
        if (attempt.refusal) toast.show(attempt.refusal, 'error');
        return false;
      }
      if (!aliveRef.current) return false;
      if (reportCommon(outcome)) return outcome.kind !== 'expired';
      if (outcome.kind === 'conflict') {
        toast.show(outcome.message, 'warning');
        return true;
      }
      if (outcome.kind !== 'done') return false;
      const repriced = rangesRepricedText(outcome.data.repriced);
      toast.show(
        outcome.data.ownPct === null
          ? `${card.name} now uses the every-card percentage (${formatPct(outcome.data.effectivePct)}).${repriced}`
          : `${card.name} now has its own extra percentage of ${formatPct(outcome.data.effectivePct)}.${repriced}`,
        'success',
      );
      return true;
    } finally {
      busyRef.current = false;
      setWorking(null);
      if (attempt.sent) {
        void refreshCards({ background: true });
        void refreshStatus({ background: true });
      }
    }
  };

  const header = (
    <SectionHeading
      id={`${baseId}-title`}
      title={TEXT.heading}
      hint={TEXT.hint}
      actions={(
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RotateCw size={14} aria-hidden />}
          loading={status.isRefreshing || providers.isRefreshing || cards.isRefreshing}
          disabled={status.isInitialLoading}
          onClick={refreshAll}
        >
          Refresh
        </Button>
      )}
    />
  );

  const failure = status.error;
  if (failure?.status === 403) {
    return (
      <div className={s.page}>
        <AccessDenied required={['rates.read']} />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className={s.page}>
        {header}
        {failure && !status.isInitialLoading ? (
          <ErrorState
            title={TEXT.loadFailed}
            message={failure.message}
            requestId={failure.requestId}
            onRetry={() => void refreshStatus()}
            retrying={status.isRefreshing}
          />
        ) : (
          <AutomaticRatesSkeleton />
        )}
      </div>
    );
  }

  const provider = providerName(snapshot.provider, view);
  const linkCard = linking && cardsData ? cardsData.cards.find((entry) => entry.id === linking.card.id) : undefined;

  return (
    <div className={s.page}>
      {header}

      <AutomaticRatesView
        status={snapshot}
        failure={failure}
        shownAt={status.lastUpdatedAt}
        view={view}
        cards={cardsData}
        cardsFailure={cards.error}
        cardsRetrying={cards.isRefreshing}
        canWrite={canWrite}
        isMobile={isMobile}
        now={now}
        working={working}
        baseId={baseId}
        switchRef={switchRef}
        runRef={runRef}
        onRetry={() => void refreshStatus()}
        onRetryCards={() => void refreshCards()}
        onToggle={(turnOn) => void toggleSwitch(turnOn)}
        onRun={() => void runNow()}
        onLoadProducts={() => void loadProducts()}
        onLink={(row, card) => setLinking({ row, card })}
        onUnlink={(row) => void unlink(row)}
        onExtra={(card) => setExtra(card)}
        onSettingsSaved={settingsSaved}
      />

      {canWrite && linking && cardsData && linkCard ? (
        <LinkModal
          key={linking.row.typeId}
          row={linking.row}
          card={linkCard}
          products={cardsData.products}
          provider={provider}
          onClose={() => setLinking(null)}
          onSubmit={submitLink}
        />
      ) : null}

      {canWrite && extra ? (
        <ExtraPercentageModal
          key={extra.id}
          card={extra}
          universal={snapshot.universalPct}
          provider={provider}
          onClose={() => setExtra(null)}
          onSubmit={submitExtra}
        />
      ) : null}
    </div>
  );
}
