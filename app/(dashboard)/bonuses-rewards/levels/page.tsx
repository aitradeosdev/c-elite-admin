'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RotateCw, Trophy } from 'lucide-react';
import {
  AccessDenied, Button, Card, EmptyState, ErrorState, LinkButton, Notice, PageHeader, StatStrip, useCan, useConfirm,
  usePermissions, useResource, useToast,
  type StatItem,
} from '../../../_ui';
import { formatNaira } from '../../../_ui/money';
import { apiRequest } from '../../../lib/apiClient';
import { BUSINESS_TZ_LABEL, formatBusinessTime } from '../../../lib/time';
import { formatCount } from '../rewardRules';
import { SETTINGS_ENDPOINT, toSettingsSnapshot, type PageNotice, type Phase, type SettingsSnapshot } from '../model';
import { leaveOptions } from '../confirmOptions';
import { PageNoticeView, UnsavedBar } from '../RewardParts';
import { useLeaveGuard } from '../useLeaveGuard';
import {
  EMPTY_TIER_DRAFT, EMPTY_TIER_REVIEW, LEVELS_ENDPOINT, UPLOAD_ENDPOINT, badgeFileProblem, classifyTierSave,
  editTier, errorKey, fieldInputId, rebaseTiers, rebaseTiersNotice, reviewTiers, revertTier, settleTierSave,
  tierDraftCount, tierPayload, tierTitle, tierView, toTierSaveResponse, toTierSnapshot, toUploadReceipt,
  type Tier, type TierDraft, type TierEditable, type TierField, type TierSaveOutcome, type TierSnapshot,
} from './model';
import { tierDiscardOptions, tierReviewOptions } from './confirmOptions';
import { TierCard, TierSkeleton } from './TierCard';
import s from './page.module.css';

const TITLE = 'Level tiers';
const SUBTITLE =
  'Users climb the tiers in order. A tier pays its bonus once the user’s approved trades since reaching it add up to its target.';
const EMPTY_SET: ReadonlySet<string> = new Set<string>();
const UPLOAD_TIMEOUT_MS = 60000;

const fetchTiers = (signal: AbortSignal) => apiRequest(LEVELS_ENDPOINT, { signal, select: toTierSnapshot });
const fetchProgramme = (signal: AbortSignal) => (
  apiRequest(SETTINGS_ENDPOINT, { signal, query: { keys: 'levels_active' }, select: toSettingsSnapshot })
);

interface Settled {
  snapshot: TierSnapshot | null;
}

function withKeys(set: ReadonlySet<string>, keys: readonly string[]): ReadonlySet<string> {
  if (keys.every((key) => set.has(key))) return set;
  const next = new Set(set);
  for (const key of keys) next.add(key);
  return next;
}

function withoutPrefix(set: ReadonlySet<string>, prefix: string): ReadonlySet<string> {
  let changed = false;
  const next = new Set<string>();
  for (const key of set) {
    if (key.startsWith(prefix)) changed = true;
    else next.add(key);
  }
  return changed ? next : set;
}

function loadedAt(timestamp: number | null): string {
  return timestamp === null ? '—' : `${formatBusinessTime(new Date(timestamp))} ${BUSINESS_TZ_LABEL}`;
}

export default function LevelsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const { isSuperAdmin } = usePermissions();
  const canWrite = useCan('rewards.write');

  const tiers = useResource<TierSnapshot>('level-tiers', fetchTiers);
  const programme = useResource<SettingsSnapshot>(
    isSuperAdmin ? 'levels-programme' : null,
    fetchProgramme,
    { enabled: isSuperAdmin },
  );
  const { refresh: refreshTiers } = tiers;
  const snapshot = tiers.data;

  const [draft, setDraftState] = useState<TierDraft>(EMPTY_TIER_DRAFT);
  const [touched, setTouched] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [revealAll, setRevealAll] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<PageNotice | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Readonly<Record<string, string>>>({});

  const draftRef = useRef<TierDraft>(EMPTY_TIER_DRAFT);
  const busyRef = useRef(false);
  const uploadingRef = useRef(false);
  const aliveRef = useRef(true);
  const gridRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const commitDraft = useCallback((next: TierDraft) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const review = useMemo(() => (snapshot ? reviewTiers(snapshot, draft) : EMPTY_TIER_REVIEW), [snapshot, draft]);
  const count = tierDraftCount(draft);
  const shownErrors = useMemo(() => {
    const shown: Record<string, string> = {};
    for (const [key, message] of Object.entries(review.errors)) {
      if (revealAll || touched.has(key)) shown[key] = message;
    }
    return shown;
  }, [review.errors, revealAll, touched]);
  const dirty = canWrite && count > 0;
  const busy = phase !== 'idle';

  useLeaveGuard(dirty || uploading !== null, () => confirm(leaveOptions()).then((decision) => decision !== null));

  const focusField = (target: { id: string; field: TierField }) => {
    const element = document.getElementById(fieldInputId(target.id, target.field));
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' });
  };

  const edit = (tier: Tier, patch: Partial<TierEditable>) => {
    if (busyRef.current) return;
    commitDraft(editTier(draftRef.current, tier, patch));
  };

  const touch = (tier: Tier, field: TierField) => setTouched((previous) => withKeys(previous, [errorKey(tier.id, field)]));

  const revert = (tier: Tier) => {
    if (busyRef.current) return;
    commitDraft(revertTier(draftRef.current, tier.id));
    setTouched((previous) => withoutPrefix(previous, `${tier.id}:`));
    setUploadErrors((previous) => {
      if (!(tier.id in previous)) return previous;
      const next = { ...previous };
      delete next[tier.id];
      return next;
    });
  };

  const setUploadError = (id: string, message: string | null) => {
    setUploadErrors((previous) => {
      if (message === null) {
        if (!(id in previous)) return previous;
        const next = { ...previous };
        delete next[id];
        return next;
      }
      return { ...previous, [id]: message };
    });
  };

  const uploadBadge = async (tier: Tier, file: File) => {
    if (uploadingRef.current || busyRef.current) return;
    const problem = badgeFileProblem(file.name, file.size);
    if (problem) {
      setUploadError(tier.id, problem);
      toast.show(`The badge was not uploaded. ${problem}`, 'error');
      return;
    }
    uploadingRef.current = true;
    setUploading(tier.id);
    setUploadError(tier.id, null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('tier_order', String(tier.order));
      const result = await apiRequest(UPLOAD_ENDPOINT, {
        method: 'POST',
        body: form,
        timeoutMs: UPLOAD_TIMEOUT_MS,
        select: toUploadReceipt,
      });
      if (!aliveRef.current) return;
      if (result.ok) {
        commitDraft(editTier(draftRef.current, tier, { badge: result.data.url }));
        toast.show(`Badge uploaded for ${tierTitle(tier)}. Review and save to show it in the app.`, 'success');
        if (result.data.warning) toast.show(result.data.warning, 'warning');
        return;
      }
      if (result.error.status === 401) return;
      setUploadError(tier.id, result.error.message);
      toast.show(`The badge was not uploaded. ${result.error.message}`, 'error');
      if (result.error.status === 403) router.refresh();
    } finally {
      uploadingRef.current = false;
      if (aliveRef.current) setUploading(null);
    }
  };

  const reload = async () => {
    if (busyRef.current) return;
    void programme.refresh();
    const result = await refreshTiers();
    if (!aliveRef.current || !result) return;
    if (!result.ok) {
      if (result.error.status === 403) router.refresh();
      return;
    }
    const rebased = rebaseTiers(draftRef.current, result.data);
    commitDraft(rebased.draft);
    const note = rebaseTiersNotice(rebased, true);
    if (note) setNotice(note);
  };

  const runReview = async () => {
    if (busyRef.current || !snapshot || !canWrite) return;
    if (uploadingRef.current) {
      toast.show('Wait for the badge upload to finish, then review your changes.', 'warning');
      return;
    }
    const local = reviewTiers(snapshot, draftRef.current);
    if (local.first) {
      setRevealAll(true);
      focusField(local.first);
      return;
    }
    if (local.changes.length === 0) return;
    busyRef.current = true;
    setPhase('checking');
    const settled: Settled = { snapshot: null };
    try {
      const fresh = await refreshTiers();
      if (!aliveRef.current || !fresh) return;
      if (!fresh.ok) {
        if (fresh.error.status !== 401) {
          toast.show(`The live tiers could not be checked, so nothing was saved. ${fresh.error.message}`, 'error');
        }
        if (fresh.error.status === 403) router.refresh();
        return;
      }
      const rebased = rebaseTiers(draftRef.current, fresh.data);
      commitDraft(rebased.draft);
      setNotice(rebaseTiersNotice(rebased, false));
      const pending = reviewTiers(fresh.data, rebased.draft);
      if (pending.first) {
        setRevealAll(true);
        focusField(pending.first);
        toast.show('Another admin changed some of these tiers while you were editing. Check the highlighted field.', 'warning');
        return;
      }
      if (pending.changes.length === 0) {
        toast.show('These values are already live, so nothing needed saving.');
        return;
      }
      setPhase('confirming');
      const decision = await confirm<TierSaveOutcome>({
        ...tierReviewOptions(pending.changes),
        action: async () => {
          setPhase('saving');
          const outcome = classifyTierSave(await apiRequest(LEVELS_ENDPOINT, {
            method: 'PATCH',
            body: tierPayload(pending.changes),
            select: toTierSaveResponse,
          }));
          if (outcome.kind === 'retry') {
            setPhase('confirming');
            throw new Error(outcome.message);
          }
          if (outcome.kind === 'saved' || outcome.kind === 'partial' || outcome.kind === 'unknown') {
            const after = await refreshTiers();
            settled.snapshot = after && after.ok ? after.data : null;
          }
          return outcome;
        },
        returnFocusTo: () => gridRef.current,
      });
      if (!aliveRef.current) return;
      const outcome = decision?.value;
      if (!outcome) return;
      const settlement = settleTierSave(draftRef.current, pending.changes, outcome, settled.snapshot);
      commitDraft(settlement.draft);
      if (settlement.notice) setNotice(settlement.notice);
      for (const note of settlement.toasts) toast.show(note.text, note.tone);
      if (outcome.kind === 'refused' && outcome.status === 403) router.refresh();
      if (settlement.cleared) {
        setTouched(EMPTY_SET);
        setRevealAll(false);
      }
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setPhase('idle');
    }
  };

  const runDiscard = async () => {
    if (busyRef.current) return;
    const total = tierDraftCount(draftRef.current);
    if (total === 0) return;
    const decision = await confirm(tierDiscardOptions(total));
    if (!decision || !aliveRef.current || busyRef.current) return;
    commitDraft(EMPTY_TIER_DRAFT);
    setTouched(EMPTY_SET);
    setRevealAll(false);
    setNotice(null);
    setUploadErrors({});
  };

  if (tiers.error?.status === 403 && !snapshot) {
    return (
      <div className={s.page}>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied required={['rewards.read']} backHref="/bonuses-rewards" backLabel="Back to Bonuses & Rewards" />
      </div>
    );
  }

  const loading = tiers.isInitialLoading;
  const updatedAt = snapshot ? tiers.lastUpdatedAt : null;
  const activeTiers = snapshot ? snapshot.tiers.filter((tier) => tier.values.is_active) : [];
  const claimsKnown = snapshot ? snapshot.tiers.every((tier) => tier.claims !== null) : false;
  const totalClaims = snapshot ? snapshot.tiers.reduce((total, tier) => total + (tier.claims ?? 0), 0) : 0;
  const ladderTotal = activeTiers.reduce((total, tier) => total + (tier.values.bonus_naira ?? 0), 0);
  const stats: StatItem[] = [
    {
      label: 'Active tiers',
      value: snapshot ? `${formatCount(activeTiers.length)} of ${formatCount(snapshot.tiers.length)}` : '—',
      loading,
    },
    {
      label: 'Level bonuses claimed',
      value: snapshot ? formatCount(totalClaims) : '—',
      hint: 'All time',
      loading,
      unavailable: Boolean(snapshot) && !claimsKnown,
    },
    {
      label: 'Bonus for every active tier',
      value: snapshot ? formatNaira(ladderTotal) : '—',
      hint: 'Paid to one user who claims them all',
      mono: true,
      loading,
    },
    { label: 'Last refreshed', value: loadedAt(updatedAt), mono: true, loading },
  ];
  const programmeOff = isSuperAdmin && programme.data !== undefined && programme.data.values.levels_active !== 'true';

  let body: ReactNode;
  if (!snapshot) {
    body = tiers.error ? (
      <Card>
        <ErrorState
          compact
          title="The level tiers could not be loaded"
          message={tiers.error.message}
          requestId={tiers.error.requestId}
          onRetry={() => void refreshTiers()}
          retrying={tiers.isInitialLoading || tiers.isRefreshing}
        />
      </Card>
    ) : (
      <div className={s.grid} aria-busy="true">
        <span className={s.srOnly} role="status">Loading level tiers</span>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className={s.cell}><TierSkeleton /></div>
        ))}
      </div>
    );
  } else if (snapshot.tiers.length === 0) {
    body = (
      <EmptyState
        icon={<Trophy size={20} strokeWidth={1.75} aria-hidden />}
        title="No level tiers"
        hint="The six tiers are created when the database is set up, not from this page. Ask an engineer to restore them."
      />
    );
  } else {
    body = (
      <fieldset className={s.fieldset} disabled={busy}>
        <div className={s.grid}>
          {snapshot.tiers.map((tier) => (
            <div key={tier.id} className={s.cell}>
              <TierCard
                tier={tier}
                view={tierView(tier, draft[tier.id])}
                errors={shownErrors}
                canWrite={canWrite}
                disabled={busy}
                uploading={uploading === tier.id}
                uploadBlocked={uploading !== null && uploading !== tier.id}
                uploadError={uploadErrors[tier.id] ?? null}
                onText={(field, value) => edit(
                  tier,
                  field === 'name' ? { name: value } : field === 'target' ? { target: value } : { bonus: value },
                )}
                onActive={(next) => edit(tier, { active: next })}
                onBadgeFile={(file) => void uploadBadge(tier, file)}
                onBadgeRemove={() => edit(tier, { badge: null })}
                onRevert={() => revert(tier)}
                onBlur={(field) => touch(tier, field)}
              />
            </div>
          ))}
        </div>
      </fieldset>
    );
  }

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
            loading={tiers.isRefreshing && !busy}
            disabled={busy || loading}
            onClick={() => void reload()}
          >
            Refresh
          </Button>
        )}
      />

      {tiers.error && snapshot ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          meta={updatedAt === null ? undefined : `Showing tiers loaded at ${loadedAt(updatedAt)}.`}
          actions={<Button type="button" variant="ghost" size="sm" onClick={() => void reload()}>Try again</Button>}
        >
          The tiers could not be refreshed. {tiers.error.message}
        </Notice>
      ) : null}

      {programmeOff ? (
        <Notice
          tone="warning"
          title="Levels are switched off"
          actions={(
            <LinkButton href="/bonuses-rewards" variant="secondary" size="sm" rightIcon={<ArrowRight size={14} aria-hidden />}>
              Open Bonuses & Rewards
            </LinkButton>
          )}
        >
          Users cannot see Levels or claim level bonuses until the levels programme is switched on. You can still edit the
          tiers here.
        </Notice>
      ) : null}

      {notice ? <PageNoticeView notice={notice} onDismiss={() => setNotice(null)} /> : null}

      {snapshot && !canWrite ? (
        <Notice tone="neutral" compact>
          You can view the tiers but not change them. Changing tiers needs the Configure rewards permission (rewards.write).
        </Notice>
      ) : null}

      <StatStrip aria-label="Level tiers summary" items={stats} />

      <div
        ref={gridRef}
        className={s.list}
        tabIndex={-1}
        role="region"
        aria-label="Level tiers"
        aria-busy={busy || undefined}
      >
        {body}
      </div>

      {dirty ? (
        <UnsavedBar
          count={count}
          issues={Object.keys(shownErrors).length}
          phase={phase}
          label="Unsaved tier changes"
          reviewRef={reviewRef}
          onDiscard={() => void runDiscard()}
          onReview={() => void runReview()}
        />
      ) : null}
    </div>
  );
}
