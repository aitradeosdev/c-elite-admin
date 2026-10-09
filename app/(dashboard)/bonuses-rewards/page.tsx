'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RotateCw } from 'lucide-react';
import {
  AccessDenied, Button, Card, CardBody, CardHeader, ErrorState, FieldShell, Input, LinkButton, Notice, PageHeader,
  RadioGroup, Skeleton, StatStrip, Toggle, useCan, useConfirm, usePermissions, useResource, useToast,
  type StatItem,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { BUSINESS_TZ_LABEL, formatBusinessTime } from '../../lib/time';
import { formatCount, utcDateKey } from './rewardRules';
import {
  EMPTY_SETTINGS_DRAFT, GIFTBOX_ENDPOINT, LEVELS_PATH, SETTINGS_ENDPOINT, SETTINGS_QUERY, SIGNUP_CONDITIONS,
  STATS_ENDPOINT, classifyConfigSave, conditionText, editSetting, giftboxStatus, isSignupCondition, rebaseSettings,
  rebaseSettingsNotice, sameSettings, settingChanged, settingValue, settingsChanges, settingsCount, settingsErrors,
  settingsPayload, toGiftboxList, toRewardStats, toSettingsSnapshot,
  type ConfigOutcome, type GiftboxItem, type PageNotice, type Phase, type RewardStats, type SettingKey,
  type SettingsDraft, type SettingsSnapshot,
} from './model';
import { discardOptions, leaveOptions, settingsReviewOptions } from './confirmOptions';
import { PageNoticeView, SectionHeading, UnsavedBar, UnsavedMark } from './RewardParts';
import { GiftboxSection } from './GiftboxSection';
import { useLeaveGuard } from './useLeaveGuard';
import s from './page.module.css';

const TITLE = 'Bonuses & Rewards';
const SUBTITLE = 'The signup bonus, level rewards and gift boxes. Every reward is credited to the user’s bonus balance.';
const SINCE_TODAY = `Since 00:00 ${BUSINESS_TZ_LABEL}`;

const fetchStats = (signal: AbortSignal) => apiRequest(STATS_ENDPOINT, { signal, select: toRewardStats });
const fetchGiftboxes = (signal: AbortSignal) => apiRequest(GIFTBOX_ENDPOINT, { signal, select: toGiftboxList });
const fetchSettings = (signal: AbortSignal) => (
  apiRequest(SETTINGS_ENDPOINT, { signal, query: SETTINGS_QUERY, select: toSettingsSnapshot })
);

function countValue(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : formatCount(value);
}

function ProgrammeSkeleton() {
  return (
    <div className={s.programmeGrid} aria-busy="true">
      <span className={s.srOnly} role="status">Loading reward settings</span>
      {[0, 1].map((index) => (
        <div key={index} className={s.programmeCell} aria-hidden>
          <Card className={s.programmeCard}>
            <div className={s.skeletonCard}>
              <Skeleton width="40%" height={14} />
              <Skeleton width="70%" height={12} />
              <Skeleton width="100%" height={34} />
              <Skeleton width="55%" height={12} />
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

export default function BonusesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const baseId = useId();
  const { isSuperAdmin } = usePermissions();
  const canWrite = useCan('rewards.write');

  const stats = useResource<RewardStats>('reward-stats', fetchStats);
  const boxes = useResource<GiftboxItem[]>('giftbox-items', fetchGiftboxes);
  const settings = useResource<SettingsSnapshot>(
    isSuperAdmin ? 'reward-settings' : null,
    fetchSettings,
    { enabled: isSuperAdmin },
  );
  const { refresh: refreshStats } = stats;
  const { refresh: refreshBoxes } = boxes;
  const { refresh: refreshSettings } = settings;
  const live = settings.data;

  const [draft, setDraftState] = useState<SettingsDraft>(EMPTY_SETTINGS_DRAFT);
  const [touched, setTouched] = useState<Partial<Record<SettingKey, boolean>>>({});
  const [revealAll, setRevealAll] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<PageNotice | null>(null);

  const draftRef = useRef<SettingsDraft>(EMPTY_SETTINGS_DRAFT);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const deniedRef = useRef(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);

  const amountId = `${baseId}-signup-amount`;
  const programmeHeading = `${baseId}-programme`;
  const today = utcDateKey();

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (settings.error?.status !== 403 || deniedRef.current) return;
    deniedRef.current = true;
    router.refresh();
  }, [settings.error, router]);

  const commitDraft = useCallback((next: SettingsDraft) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const count = settingsCount(draft);
  const errors = useMemo(() => (live ? settingsErrors(live, draft) : {}), [live, draft]);
  const shownErrors = useMemo(() => {
    const shown: Partial<Record<SettingKey, string>> = {};
    for (const [key, message] of Object.entries(errors) as Array<[SettingKey, string]>) {
      if (revealAll || touched[key]) shown[key] = message;
    }
    return shown;
  }, [errors, revealAll, touched]);
  const dirty = isSuperAdmin && count > 0;
  const busy = phase !== 'idle';

  useLeaveGuard(dirty, () => confirm(leaveOptions()).then((decision) => decision !== null));

  const reloadGiftboxes = useCallback(async () => {
    const result = await refreshBoxes();
    return result && result.ok ? result.data : null;
  }, [refreshBoxes]);

  const edit = (key: SettingKey, value: string) => {
    if (!live || busyRef.current) return;
    commitDraft(editSetting(draftRef.current, live, key, value));
  };

  const touch = (key: SettingKey) => setTouched((current) => (current[key] ? current : { ...current, [key]: true }));

  const resetEditing = () => {
    commitDraft(EMPTY_SETTINGS_DRAFT);
    setTouched({});
    setRevealAll(false);
  };

  const focusAmount = () => {
    const element = document.getElementById(amountId);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'center' });
  };

  const refreshAll = async () => {
    if (busyRef.current) return;
    void refreshStats();
    void refreshBoxes();
    if (!isSuperAdmin) return;
    const result = await refreshSettings();
    if (!aliveRef.current || !result) return;
    if (!result.ok) {
      if (result.error.status === 403) router.refresh();
      return;
    }
    const rebased = rebaseSettings(draftRef.current, result.data);
    commitDraft(rebased.draft);
    const note = rebaseSettingsNotice(rebased);
    if (note) setNotice(note);
  };

  const review = async () => {
    if (busyRef.current || !live || !isSuperAdmin) return;
    if (Object.keys(settingsErrors(live, draftRef.current)).length > 0) {
      setRevealAll(true);
      focusAmount();
      return;
    }
    if (settingsCount(draftRef.current) === 0) return;
    busyRef.current = true;
    setPhase('checking');
    let sent = false;
    let settled = false;
    try {
      const fresh = await refreshSettings();
      if (!aliveRef.current || !fresh) return;
      if (!fresh.ok) {
        if (fresh.error.status !== 401) {
          toast.show(`The live settings could not be checked, so nothing was applied. ${fresh.error.message}`, 'error');
        }
        if (fresh.error.status === 403) router.refresh();
        return;
      }
      const rebased = rebaseSettings(draftRef.current, fresh.data);
      commitDraft(rebased.draft);
      setNotice(rebaseSettingsNotice(rebased));
      if (Object.keys(settingsErrors(fresh.data, rebased.draft)).length > 0) {
        setRevealAll(true);
        focusAmount();
        toast.show('Another admin changed these settings while you were editing. Check the highlighted field.', 'warning');
        return;
      }
      const changes = settingsChanges(rebased.draft);
      if (changes.length === 0) {
        toast.show('These values are already live, so nothing needed to change.');
        return;
      }
      const payload = settingsPayload(changes);
      setPhase('confirming');
      const decision = await confirm<ConfigOutcome>({
        ...settingsReviewOptions(changes),
        action: async () => {
          sent = true;
          setPhase('saving');
          const outcome = classifyConfigSave(await apiRequest(SETTINGS_ENDPOINT, { method: 'PATCH', body: payload }));
          if (outcome.kind === 'retry') {
            setPhase('confirming');
            throw new Error(outcome.message);
          }
          return outcome;
        },
        returnFocusTo: () => sectionRef.current,
      });
      if (!aliveRef.current) return;
      const outcome = decision?.value;
      if (!outcome) return;
      settled = true;
      switch (outcome.kind) {
        case 'done': {
          const after = await refreshSettings();
          if (!aliveRef.current) return;
          resetEditing();
          setNotice(null);
          toast.show(changes.length === 1 ? 'Saved. The change is live.' : `Saved. ${formatCount(changes.length)} changes are live.`, 'success');
          if (!after || !after.ok) toast.show('Saved, but the latest values could not be reloaded. Refresh to confirm them.', 'warning');
          return;
        }
        case 'unknown': {
          const after = await refreshSettings();
          if (!aliveRef.current) return;
          if (after && after.ok && sameSettings(after.data, payload.changes)) {
            resetEditing();
            toast.show(changes.length === 1 ? 'Saved. The change is live.' : `Saved. ${formatCount(changes.length)} changes are live.`, 'success');
            return;
          }
          if (after && after.ok) commitDraft(rebaseSettings(draftRef.current, after.data).draft);
          setNotice({
            tone: 'warning',
            title: 'The save could not be confirmed',
            message: `${outcome.message} Your changes are still marked as unsaved until you check them.`,
            items: [],
          });
          toast.show('The save could not be confirmed. Check the settings before trying again.', 'error');
          return;
        }
        case 'conflict': {
          const after = await refreshSettings();
          if (!aliveRef.current) return;
          if (after && after.ok) {
            const rebasedAfter = rebaseSettings(draftRef.current, after.data);
            commitDraft(rebasedAfter.draft);
            setNotice(rebaseSettingsNotice(rebasedAfter));
          }
          toast.show(`${outcome.message} Nothing was applied. Check the latest values, then review again.`, 'warning');
          return;
        }
        case 'refused':
          toast.show(outcome.message, 'error');
          if (outcome.status === 403) router.refresh();
          return;
        default:
          return;
      }
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setPhase('idle');
      if (sent && !settled) void refreshSettings({ background: true });
    }
  };

  const discard = async () => {
    if (busyRef.current) return;
    const total = settingsCount(draftRef.current);
    if (total === 0) return;
    const decision = await confirm(discardOptions(total, 'The settings'));
    if (!decision || !aliveRef.current || busyRef.current) return;
    resetEditing();
    setNotice(null);
  };

  const denied = (stats.error?.status === 403 && !stats.data) || (boxes.error?.status === 403 && !boxes.data);
  if (denied) {
    return (
      <div className={s.page}>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied required={['rewards.read']} />
      </div>
    );
  }

  const figures = stats.data;
  const figuresMissing = !figures && stats.error !== null;
  const boxesMissing = !boxes.data && boxes.error !== null;
  const liveBoxes = boxes.data ? boxes.data.filter((item) => giftboxStatus(item, today).kind === 'live').length : null;
  const statItems: StatItem[] = [
    {
      label: 'Active level tiers',
      value: countValue(figures?.activeTiers),
      loading: stats.isInitialLoading,
      unavailable: figuresMissing || figures?.activeTiers === null,
    },
    {
      label: 'Level claims today',
      value: countValue(figures?.levelClaimsToday),
      hint: SINCE_TODAY,
      loading: stats.isInitialLoading,
      unavailable: figuresMissing || figures?.levelClaimsToday === null,
    },
    {
      label: 'Signup bonuses today',
      value: countValue(figures?.signupToday),
      hint: SINCE_TODAY,
      loading: stats.isInitialLoading,
      unavailable: figuresMissing || figures?.signupToday === null,
    },
    {
      label: 'Signup bonuses, all time',
      value: countValue(figures?.signupTotal),
      loading: stats.isInitialLoading,
      unavailable: figuresMissing || figures?.signupTotal === null,
    },
    {
      label: 'Live gift boxes',
      value: countValue(liveBoxes),
      hint: boxes.data ? `${formatCount(boxes.data.length)} in total` : undefined,
      loading: boxes.isInitialLoading,
      unavailable: boxesMissing,
    },
  ];

  const staleError = (stats.error && stats.data ? stats.error : null)
    ?? (boxes.error && boxes.data ? boxes.error : null)
    ?? (settings.error && live ? settings.error : null);
  const refreshing = stats.isRefreshing || boxes.isRefreshing || settings.isRefreshing;
  const updatedAt = boxes.lastUpdatedAt ?? stats.lastUpdatedAt;

  const signupActive = live ? settingValue(live, draft, 'signup_bonus_active') === 'true' : false;
  const levelsOn = live ? settingValue(live, draft, 'levels_active') === 'true' : false;
  const condition = live ? settingValue(live, draft, 'signup_bonus_condition') : '';
  const signupChanged = settingChanged('signup_bonus_active', draft.signup_bonus_active)
    || settingChanged('signup_bonus_amount', draft.signup_bonus_amount)
    || settingChanged('signup_bonus_condition', draft.signup_bonus_condition);
  const levelsChanged = settingChanged('levels_active', draft.levels_active);
  const tiersLabel = canWrite ? 'Edit level tiers' : 'View level tiers';

  let programme: ReactNode;
  if (!isSuperAdmin) {
    programme = (
      <Notice
        tone="neutral"
        title="Super administrators only"
        actions={(
          <LinkButton href={LEVELS_PATH} variant="secondary" size="sm" rightIcon={<ArrowRight size={14} aria-hidden />}>
            {tiersLabel}
          </LinkButton>
        )}
      >
        The signup bonus and the levels on/off switch are platform settings, so only super administrators can view or
        change them. Level tiers and gift boxes are managed on the Levels page and below.
      </Notice>
    );
  } else if (!live) {
    programme = settings.error ? (
      <Card>
        <ErrorState
          compact
          title="The reward settings could not be loaded"
          message={settings.error.message}
          requestId={settings.error.requestId}
          onRetry={() => void refreshSettings()}
          retrying={settings.isInitialLoading || settings.isRefreshing}
        />
      </Card>
    ) : (
      <ProgrammeSkeleton />
    );
  } else {
    programme = (
      <div
        ref={sectionRef}
        className={s.programme}
        tabIndex={-1}
        role="group"
        aria-labelledby={programmeHeading}
        aria-busy={busy || undefined}
      >
        <fieldset className={s.fieldset} disabled={busy}>
          <div className={s.programmeGrid}>
            <div className={s.programmeCell}>
              <Card className={s.programmeCard}>
                <CardHeader
                  title={<h3 className={s.cardTitle}>Signup bonus{signupChanged ? <UnsavedMark /> : null}</h3>}
                  subtitle="A one-off bonus each new user can claim once."
                  actions={(
                    <Toggle
                      checked={signupActive}
                      label={signupActive ? 'On' : 'Off'}
                      aria-label="Signup bonus"
                      onChange={(next) => edit('signup_bonus_active', next ? 'true' : 'false')}
                    />
                  )}
                />
                <CardBody className={s.programmeBody}>
                  <FieldShell
                    label="Amount (₦)"
                    htmlFor={amountId}
                    error={shownErrors.signup_bonus_amount}
                    help="Credited to the user’s bonus balance when they claim."
                  >
                    <Input
                      id={amountId}
                      mono
                      inputMode="decimal"
                      autoComplete="off"
                      value={settingValue(live, draft, 'signup_bonus_amount')}
                      onChange={(event) => edit('signup_bonus_amount', event.target.value)}
                      onBlur={() => touch('signup_bonus_amount')}
                    />
                  </FieldShell>
                  <RadioGroup
                    legend="When users can claim it"
                    options={SIGNUP_CONDITIONS}
                    value={isSignupCondition(condition) ? condition : null}
                    onChange={(next) => edit('signup_bonus_condition', next)}
                  />
                  {condition && !isSignupCondition(condition) ? (
                    <Notice tone="warning" compact flush>
                      The saved setting is {conditionText(condition)}. Choose one of the options above to replace it.
                    </Notice>
                  ) : null}
                </CardBody>
              </Card>
            </div>
            <div className={s.programmeCell}>
              <Card className={s.programmeCard}>
                <CardHeader
                  title={<h3 className={s.cardTitle}>Levels{levelsChanged ? <UnsavedMark /> : null}</h3>}
                  subtitle="Tier bonuses users unlock by trading."
                  actions={(
                    <Toggle
                      checked={levelsOn}
                      label={levelsOn ? 'On' : 'Off'}
                      aria-label="Levels programme"
                      onChange={(next) => edit('levels_active', next ? 'true' : 'false')}
                    />
                  )}
                />
                <CardBody className={s.programmeBody}>
                  <p className={s.cardText}>
                    {levelsOn
                      ? 'Users see Levels in the app. Each tier pays its bonus once a user’s approved trades since reaching it meet the target.'
                      : 'Levels are hidden in the app and nobody can claim a level bonus. Users keep their tier progress.'}
                  </p>
                  <LinkButton
                    href={LEVELS_PATH}
                    variant="secondary"
                    size="sm"
                    className={s.cardLink}
                    rightIcon={<ArrowRight size={14} aria-hidden />}
                  >
                    {tiersLabel}
                  </LinkButton>
                </CardBody>
              </Card>
            </div>
          </div>
        </fieldset>
      </div>
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
            loading={refreshing && !busy}
            disabled={busy}
            onClick={() => void refreshAll()}
          >
            Refresh
          </Button>
        )}
      />

      {staleError ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          meta={updatedAt === null ? undefined : `Showing data loaded at ${formatBusinessTime(new Date(updatedAt))} ${BUSINESS_TZ_LABEL}.`}
          actions={<Button type="button" variant="ghost" size="sm" onClick={() => void refreshAll()}>Try again</Button>}
        >
          Part of this page could not be refreshed. {staleError.message}
        </Notice>
      ) : null}

      {notice ? <PageNoticeView notice={notice} onDismiss={() => setNotice(null)} /> : null}

      <StatStrip aria-label="Rewards summary" items={statItems} />

      <section aria-labelledby={programmeHeading} className={s.section}>
        <SectionHeading
          id={programmeHeading}
          title="Programme settings"
          hint={isSuperAdmin ? 'Platform settings that apply to every user as soon as they are applied.' : undefined}
        />
        {programme}
      </section>

      <GiftboxSection
        items={boxes.data}
        error={boxes.error}
        loading={boxes.isInitialLoading}
        refreshing={boxes.isRefreshing}
        canWrite={canWrite}
        today={today}
        reload={reloadGiftboxes}
      />

      {dirty ? (
        <UnsavedBar
          count={count}
          issues={Object.keys(shownErrors).length}
          phase={phase}
          label="Unsaved reward settings"
          reviewRef={reviewRef}
          onDiscard={() => void discard()}
          onReview={() => void review()}
        />
      ) : null}
    </div>
  );
}
