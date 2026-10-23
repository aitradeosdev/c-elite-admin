'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import {
  AccessDenied, Button, ErrorState, Notice, PageHeader, formatNaira, useCan, useConfirm, useResource, useToast,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { BUSINESS_TZ_LABEL, formatBusinessTime } from '../../lib/time';
import { permissionLabel } from '../../lib/permissions';
import { guardedPath } from '../_config/ConfigForm';
import {
  AUDIT_WARNING, MODE_KEY, MODE_LABELS, PLATFORM_BALANCE_ENDPOINT, STATIC_KEY,
  alreadyStored, applySaved, changePayload, checkStaticAmount, classifySave, editedElsewhere, isDraftDirty,
  providerWord, toSaveReceipt, toSnapshot,
  type BalanceMode, type BalanceSnapshot, type SaveOutcome, type SavePayload, type SaveReceipt, type StaticDraft,
  type Working,
} from './model';
import {
  BalanceSkeleton, LiveCard, ShownCard, StaticCard, leaveOptions, modeOptions, staticOptions,
} from './BalanceParts';
import s from './page.module.css';

const TITLE = 'Platform Balance';
const SUBTITLE = 'The balance every user sees on the Marketplace screen of the app. Times are WAT.';
const POLL_MS = 60_000;
const CLOCK_MS = 30_000;
const NOT_CHECKED = 'Could not check the current platform balance, so nothing was changed.';
const MODE_UNKNOWN =
  'No response came back, so the source may or may not have changed. The page now shows the current source; check it before trying again.';
const STATIC_UNKNOWN =
  'No response came back, so the static amount may or may not have been saved. The page now shows the current amount; check it before trying again.';

interface Attempt {
  sent: boolean;
  settled: boolean;
  refusal: string | null;
}

const fetchBalance = (signal: AbortSignal) => apiRequest(PLATFORM_BALANCE_ENDPOINT, { signal, select: toSnapshot });

const sendChange = (payload: SavePayload) => apiRequest(PLATFORM_BALANCE_ENDPOINT, {
  method: 'PATCH',
  body: payload,
  select: toSaveReceipt,
});

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

export default function PlatformBalancePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const canWrite = useCan('platform_balance.write');
  const baseId = useId();
  const balance = useResource<BalanceSnapshot>('platform-balance', fetchBalance, { pollMs: POLL_MS });
  const { refresh, mutate } = balance;
  const snapshot = balance.data;
  const clock = useClock(CLOCK_MS);
  const now = Math.max(clock, balance.lastUpdatedAt ?? 0);

  const [working, setWorking] = useState<Working | null>(null);
  const [draft, setDraft] = useState<StaticDraft | null>(null);
  const [showError, setShowError] = useState(false);
  const [seenStatic, setSeenStatic] = useState<string | null | undefined>(snapshot?.staticText);

  const busyRef = useRef(false);
  const aliveRef = useRef(false);
  const leavingRef = useRef(false);
  const leaveRef = useRef<(path: string) => void>(() => {});
  const inputRef = useRef<HTMLInputElement>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);

  const serverStatic = snapshot?.staticText;
  if (seenStatic !== serverStatic) {
    setSeenStatic(serverStatic);
    if (draft && !isDraftDirty(draft)) setDraft(null);
  }

  const dirty = canWrite && isDraftDirty(draft);
  const check = draft ? checkStaticAmount(draft.text) : null;
  const inputError = dirty && showError && check && !check.ok ? check.message : null;
  const preview = check && check.ok ? check.amount : null;
  const busy = working !== null;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    leaveRef.current = (path: string) => {
      void confirm(leaveOptions()).then((decision) => {
        if (!decision) return;
        leavingRef.current = true;
        router.push(path);
      });
    };
  });

  useEffect(() => {
    if (!dirty) return;
    const intercept = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const path = guardedPath(anchor.href, window.location.href);
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      leaveRef.current(path);
    };
    window.addEventListener('click', intercept, true);
    return () => window.removeEventListener('click', intercept, true);
  }, [dirty]);

  const readFresh = async (): Promise<BalanceSnapshot | null> => {
    const result = await apiRequest(PLATFORM_BALANCE_ENDPOINT, { select: toSnapshot });
    if (!result.ok) {
      if (result.error.status !== 401) toast.show(`${NOT_CHECKED} ${result.error.message}`, 'error');
      if (result.error.status === 403) router.refresh();
      return null;
    }
    mutate(result.data);
    return result.data;
  };

  const commitSaved = (fresh: BalanceSnapshot, payload: SavePayload, receipt: SaveReceipt): BalanceSnapshot => {
    const next = applySaved(fresh, { ...payload.changes, ...receipt.applied }, new Date().toISOString());
    mutate(next);
    void refresh({ background: true });
    return next;
  };

  const reportCommon = (outcome: SaveOutcome, unknownMessage: string): boolean => {
    switch (outcome.kind) {
      case 'denied':
        toast.show(outcome.message, 'error');
        router.refresh();
        return true;
      case 'unknown':
        toast.show(unknownMessage, 'error');
        return true;
      case 'expired':
        return true;
      default:
        return false;
    }
  };

  const reportAudit = (receipt: SaveReceipt) => {
    if (!receipt.auditRecorded) toast.show(receipt.warning ?? AUDIT_WARNING, 'warning');
  };

  const switchMode = async (target: BalanceMode) => {
    if (!canWrite || busyRef.current || !snapshot || snapshot.mode === target) return;
    busyRef.current = true;
    setWorking({ kind: 'mode', target, phase: 'checking' });
    const attempt = newAttempt();
    try {
      const fresh = await readFresh();
      if (!fresh || !aliveRef.current) return;
      if (fresh.mode === target) {
        toast.show(`The source is already ${MODE_LABELS[target]}. Another admin changed it, so nothing was sent.`, 'warning');
        return;
      }
      const payload = changePayload(fresh, MODE_KEY, target);
      const provider = providerWord(fresh.gateway);
      setWorking({ kind: 'mode', target, phase: 'confirming' });
      const decision = await confirm<SaveOutcome>({
        ...modeOptions(fresh, target, Date.now()),
        action: async () => {
          attempt.sent = true;
          attempt.refusal = null;
          setWorking({ kind: 'mode', target, phase: 'saving' });
          const outcome = classifySave(await sendChange(payload));
          if (outcome.kind === 'refused') {
            attempt.refusal = outcome.message;
            setWorking({ kind: 'mode', target, phase: 'confirming' });
            throw new Error(outcome.message);
          }
          if (outcome.kind === 'done') {
            attempt.settled = true;
            commitSaved(fresh, payload, outcome.receipt);
          }
          return outcome;
        },
        returnFocusTo: () => (
          document.getElementById(`${baseId}-source`)?.querySelector<HTMLInputElement>('input:checked')
            ?? refreshRef.current
        ),
      });
      const outcome = decision?.value;
      if (!outcome) {
        if (attempt.refusal) {
          toast.show(
            `The source was not changed: ${attempt.refusal} Users still see the ${MODE_LABELS[fresh.mode].toLowerCase()} figure, ${formatNaira(fresh.shownAmount)}.`,
            'error',
          );
        }
        return;
      }
      if (reportCommon(outcome, MODE_UNKNOWN)) return;
      if (outcome.kind === 'conflict') {
        toast.show('Another admin changed the source while you were confirming, so nothing was changed. The page now shows the current source.', 'warning');
        return;
      }
      if (outcome.kind !== 'done') return;
      const { receipt } = outcome;
      if (receipt.changed !== null && receipt.changed.length === 0) {
        toast.show(`The source was already ${MODE_LABELS[target]}. Nothing changed.`);
      } else {
        const shown = applySaved(fresh, payload.changes, new Date().toISOString()).shownAmount;
        toast.show(
          target === 'live'
            ? `Users now see the live ${provider} balance, ${formatNaira(shown)}.`
            : `Users now see the static amount, ${formatNaira(shown)}.`,
          'success',
        );
      }
      reportAudit(receipt);
    } finally {
      busyRef.current = false;
      setWorking(null);
      if (attempt.sent && !attempt.settled) void refresh({ background: true });
    }
  };

  const saveStatic = async () => {
    if (!canWrite || busyRef.current || !snapshot || !draft || !isDraftDirty(draft)) return;
    const checked = checkStaticAmount(draft.text);
    if (!checked.ok) {
      setShowError(true);
      inputRef.current?.focus();
      return;
    }
    busyRef.current = true;
    setWorking({ kind: 'static', phase: 'checking' });
    const attempt = newAttempt();
    try {
      const fresh = await readFresh();
      if (!fresh || !aliveRef.current) return;
      if (alreadyStored(fresh, checked.value, checked.amount)) {
        setDraft(null);
        setShowError(false);
        toast.show(`The static amount is already ${formatNaira(checked.amount)}. Nothing needed to change.`);
        return;
      }
      const payload = changePayload(fresh, STATIC_KEY, checked.value);
      setWorking({ kind: 'static', phase: 'confirming' });
      const decision = await confirm<SaveOutcome>({
        ...staticOptions(fresh, checked.amount, editedElsewhere(draft, fresh)),
        action: async () => {
          attempt.sent = true;
          attempt.refusal = null;
          setWorking({ kind: 'static', phase: 'saving' });
          const outcome = classifySave(await sendChange(payload));
          if (outcome.kind === 'refused') {
            attempt.refusal = outcome.message;
            setWorking({ kind: 'static', phase: 'confirming' });
            throw new Error(outcome.message);
          }
          if (outcome.kind === 'done') {
            attempt.settled = true;
            setDraft(null);
            setShowError(false);
            commitSaved(fresh, payload, outcome.receipt);
          }
          return outcome;
        },
        returnFocusTo: () => inputRef.current,
      });
      const outcome = decision?.value;
      if (!outcome) {
        if (attempt.refusal) {
          toast.show(
            `The static amount was not saved: ${attempt.refusal} It is still ${formatNaira(fresh.staticAmount)}.`,
            'error',
          );
        }
        return;
      }
      if (reportCommon(outcome, STATIC_UNKNOWN)) return;
      if (outcome.kind === 'conflict') {
        toast.show(
          'Another admin changed the static amount while you were confirming, so nothing was saved. Your amount is still in the field; check the current value, then save again.',
          'warning',
        );
        return;
      }
      if (outcome.kind !== 'done') return;
      const { receipt } = outcome;
      if (receipt.changed !== null && receipt.changed.length === 0) {
        toast.show(`The static amount was already ${formatNaira(checked.amount)}. Nothing changed.`);
      } else {
        toast.show(
          fresh.mode === 'static'
            ? `Static amount set to ${formatNaira(checked.amount)}. Users now see it.`
            : `Static amount set to ${formatNaira(checked.amount)}. Users see it once the source is switched to Static.`,
          'success',
        );
      }
      reportAudit(receipt);
    } finally {
      busyRef.current = false;
      setWorking(null);
      if (attempt.sent && !attempt.settled) void refresh({ background: true });
    }
  };

  const changeDraft = (text: string) => {
    if (busyRef.current) return;
    setDraft((current) => ({ text, base: current ? current.base : snapshot?.staticText ?? null }));
  };

  const discardDraft = () => {
    if (busyRef.current) return;
    setDraft(null);
    setShowError(false);
    inputRef.current?.focus();
  };

  const header = (
    <PageHeader
      title={TITLE}
      subtitle={SUBTITLE}
      actions={(
        <Button
          ref={refreshRef}
          variant="secondary"
          size="sm"
          leftIcon={<RotateCw size={14} aria-hidden />}
          loading={balance.isRefreshing}
          disabled={balance.isInitialLoading}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
      )}
    />
  );

  if (balance.isInitialLoading) {
    return (
      <div className={s.page}>
        {header}
        <BalanceSkeleton />
      </div>
    );
  }

  const failure = balance.error;
  if (failure?.status === 403) {
    return (
      <div className={s.page}>
        <AccessDenied required={['platform_balance.read']} />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className={s.page}>
        {header}
        {failure ? (
          <ErrorState
            title="The platform balance could not be loaded"
            message={failure.message}
            requestId={failure.requestId}
            onRetry={() => void refresh()}
            retrying={balance.isRefreshing}
          />
        ) : (
          <BalanceSkeleton />
        )}
      </div>
    );
  }

  const staticWorking = working?.kind === 'static' ? working : null;

  return (
    <div className={s.page}>
      {header}

      {failure ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          actions={<Button variant="ghost" size="sm" onClick={() => void refresh()}>Try again</Button>}
        >
          The latest values could not be loaded. {failure.message}
          {balance.lastUpdatedAt
            ? ` Showing values from ${formatBusinessTime(new Date(balance.lastUpdatedAt))} ${BUSINESS_TZ_LABEL}.`
            : ''}
        </Notice>
      ) : null}

      {canWrite ? null : (
        <Notice tone="neutral" compact>
          You can view the platform balance. Changing it needs the “{permissionLabel('platform_balance.write')}” permission.
        </Notice>
      )}

      <ShownCard
        snapshot={snapshot}
        now={now}
        canWrite={canWrite}
        working={working}
        headingId={`${baseId}-shown`}
        groupId={`${baseId}-source`}
        onSwitch={(target) => void switchMode(target)}
      />

      <div className={s.grid}>
        <StaticCard
          snapshot={snapshot}
          canWrite={canWrite}
          headingId={`${baseId}-static`}
          inputId={`${baseId}-amount`}
          value={draft ? draft.text : snapshot.staticText ?? ''}
          dirty={dirty}
          error={inputError}
          preview={preview}
          busy={busy}
          phase={staticWorking ? staticWorking.phase : null}
          changedElsewhere={dirty && draft !== null && editedElsewhere(draft, snapshot)}
          inputRef={inputRef}
          onChange={changeDraft}
          onBlur={() => {
            if (dirty) setShowError(true);
          }}
          onSave={() => void saveStatic()}
          onDiscard={discardDraft}
        />
        <LiveCard snapshot={snapshot} now={now} headingId={`${baseId}-live`} />
      </div>
    </div>
  );
}
