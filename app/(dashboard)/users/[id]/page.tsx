'use client';

import { Suspense, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Lock, LockOpen, RotateCw } from 'lucide-react';
import {
  AccessDenied, Button, ErrorState, Money, Notice, PageHeader, TabPanel, Tabs, enumParam, useCan, useConfirm,
  useResource, useToast, useUrlState,
  type ConfirmOptions,
} from '../../../_ui';
import { apiRequest, type ApiFailure } from '../../../lib/apiClient';
import { useIsMobile } from '../../../lib/useIsMobile';
import {
  DEFAULT_SECTION, FREEZE_REASONS, SECTIONS, SECTION_ORDER, UNKNOWN_ACTION_OUTCOME, accountState, actionNotice,
  classifyAction, countText, plural, toProfileResource, userHandle, userSummary, validUserId,
  type ActionAttempt, type ActionKind, type ActionOutcome, type ProfileData, type ProfileResource, type SectionKey,
} from './model';
import { useUserSection } from './useUserSection';
import {
  AccountNotices, NotFoundState, ProfileCard, ProfileKpis, UserDetailSkeleton, UserSubtitle, UserTitle,
} from './UserParts';
import { DevicesPanel, LoginsPanel, TransactionsPanel } from './ActivityPanels';
import s from './page.module.css';

const REASON_MAX = 500;
const ACTIVITY_TABS = 'user-activity';
const USER_TAB_URL = enumParam('tab', SECTION_ORDER, DEFAULT_SECTION);
const INCOMPLETE_PROFILE = 'The server returned an incomplete profile for this user.';
const NOT_SENT = 'The request could not be started, so nothing was changed. Try again.';

const PENDING_LABELS: Readonly<Record<ActionKind, string>> = {
  freeze: 'Freezing the account…',
  unfreeze: 'Unfreezing the account…',
};

function failureText(failure: ApiFailure): string {
  return failure.kind === 'parse' ? INCOMPLETE_PROFILE : failure.message;
}

function awaitingConsequence(count: number | null): string[] {
  if (count === null) {
    return ['Withdrawals awaiting review could not be checked. Any that are waiting cannot be approved while the account is frozen.'];
  }
  if (count === 0) return [];
  return [
    `${plural(count, 'withdrawal is', 'withdrawals are')} awaiting review. ${
      count === 1 ? 'It stays' : 'They stay'
    } in the queue but cannot be approved while the account is frozen. Reject in Withdrawals to refund the wallet.`,
  ];
}

function freezeOptions({ user, stats }: ProfileData): ConfirmOptions {
  const bonus = Number(user.bonus_balance ?? 0);
  return {
    tone: 'danger',
    title: `Freeze ${userHandle(user)}?`,
    message: 'Freezing blocks this account’s financial activity until an admin unfreezes it.',
    details: [
      { label: 'User', value: userSummary(user) },
      { label: 'User ID', value: user.id, mono: true },
      { label: 'Wallet balance', value: <Money value={user.balance} emphasis="strong" />, emphasis: true },
      ...(Number.isFinite(bonus) && bonus > 0 ? [{ label: 'Bonus balance', value: <Money value={bonus} /> }] : []),
    ],
    consequences: [
      'Withdrawals and bill payments are refused until the account is unfrozen. The balance stays in the wallet.',
      'The user’s app shows an Account Suspended notice with the reason you give, so write it for the user.',
      ...awaitingConsequence(stats.withdrawals_pending),
    ],
    reason: {
      required: true,
      presets: FREEZE_REASONS,
      label: 'Reason shown to the user',
      placeholder: 'Explain why this account is frozen',
      maxLength: REASON_MAX,
    },
    confirmLabel: 'Freeze account',
  };
}

function unfreezeOptions({ user }: ProfileData): ConfirmOptions {
  return {
    title: `Unfreeze ${userHandle(user)}?`,
    message: 'The account returns to normal as soon as you confirm.',
    details: [
      { label: 'User', value: userSummary(user) },
      { label: 'User ID', value: user.id, mono: true },
      { label: 'Frozen because', value: user.freeze_reason || 'No reason was recorded' },
      { label: 'Wallet balance', value: <Money value={user.balance} emphasis="strong" />, emphasis: true },
    ],
    consequences: [
      'Withdrawals and bill payments are allowed again immediately.',
      'The freeze reason is cleared from the account.',
    ],
    reason: {
      label: 'Note for the audit log',
      placeholder: 'Optional: why this account is being restored',
      maxLength: REASON_MAX,
    },
    confirmLabel: 'Unfreeze account',
  };
}

async function patchAccount(id: string, kind: ActionKind, reason: string): Promise<ActionAttempt> {
  return classifyAction(await apiRequest(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: reason ? { action: kind, reason } : { action: kind },
  }));
}

export default function UserDetailPage() {
  return (
    <Suspense fallback={<UserDetailSkeleton />}>
      <UserDetailRoute />
    </Suspense>
  );
}

function UserDetailRoute() {
  const params = useParams<{ id: string }>();
  const id = validUserId(params?.id);
  if (!id) return <NotFoundState />;
  return <UserDetail key={id} id={id} />;
}

function UserDetail({ id }: { id: string }) {
  const { show: showToast } = useToast();
  const confirm = useConfirm();
  const isMobile = useIsMobile();
  const router = useRouter();
  const canFreeze = useCan('users.freeze');
  const canTransactions = useCan('transactions.read');
  const [tab, setTab] = useUrlState(USER_TAB_URL);

  const profile = useResource<ProfileResource>(`user:${id}`, (signal) => (
    apiRequest(`/api/users/${encodeURIComponent(id)}`, { signal, select: toProfileResource })
  ));
  const { refresh: refreshProfile } = profile;
  const current = profile.data?.profile ?? null;
  const body = profile.data?.body;

  const transactions = useUserSection(id, 'transactions', body, profile.lastUpdatedAt);
  const devices = useUserSection(id, 'devices', body, profile.lastUpdatedAt);
  const logins = useUserSection(id, 'logins', body, profile.lastUpdatedAt);

  const actingRef = useRef(false);
  const refreshButtonRef = useRef<HTMLButtonElement>(null);

  const act = useCallback(async (kind: ActionKind) => {
    if (!current || actingRef.current) return;
    actingRef.current = true;
    let sent = false;
    let settled = false;
    try {
      const decision = await confirm<ActionOutcome>({
        ...(kind === 'freeze' ? freezeOptions(current) : unfreezeOptions(current)),
        pendingLabel: PENDING_LABELS[kind],
        action: async ({ reason }) => {
          sent = true;
          const attempt = await patchAccount(id, kind, reason.trim());
          if (attempt.kind === 'retry') throw new Error(attempt.message);
          if (attempt.kind !== 'unknown') {
            settled = true;
            await refreshProfile();
          }
          return attempt;
        },
        returnFocusTo: () => refreshButtonRef.current,
      });
      const outcome = decision?.value;
      if (!outcome) return;
      const notice = actionNotice(kind, current.user, outcome);
      if (notice) showToast(notice.text, notice.tone);
      if (outcome.kind === 'refused' && outcome.status === 403) router.refresh();
    } catch {
      showToast(sent ? UNKNOWN_ACTION_OUTCOME : NOT_SENT, 'error');
    } finally {
      actingRef.current = false;
      if (sent && !settled) void refreshProfile();
    }
  }, [confirm, current, id, refreshProfile, router, showToast]);

  if (profile.isInitialLoading) return <UserDetailSkeleton />;

  const failure = profile.error;
  if (failure?.status === 403) return <AccessDenied required={['users.read']} />;

  if (!current) {
    if (!failure) return <UserDetailSkeleton />;
    if (failure.status === 404 || failure.status === 400) return <NotFoundState />;
    return (
      <ErrorState
        title="This user could not be loaded"
        message={failureText(failure)}
        requestId={failure.requestId}
        onRetry={() => void refreshProfile()}
      />
    );
  }

  const { user, stats, referrer, partial } = current;
  const state = accountState(user);
  const canAct = canFreeze && state !== 'deleted';
  const frozen = state === 'frozen';
  const sections = { transactions, devices, logins };
  const tabItems = SECTION_ORDER.map((key) => {
    const total = sections[key].state.total;
    return { value: key, label: SECTIONS[key].label, count: total === null ? undefined : countText(total) };
  });

  return (
    <div className={s.page}>
      <PageHeader
        title={<UserTitle user={user} />}
        subtitle={<UserSubtitle user={user} />}
        actions={
          <>
            <Button
              ref={refreshButtonRef}
              variant="secondary"
              size="sm"
              leftIcon={<RotateCw size={14} />}
              loading={profile.isRefreshing}
              onClick={() => void refreshProfile()}
            >
              Refresh
            </Button>
            {canAct ? (
              <Button
                variant={frozen ? 'secondary' : 'dangerSubtle'}
                size="sm"
                leftIcon={frozen ? <LockOpen size={14} /> : <Lock size={14} />}
                onClick={() => void act(frozen ? 'unfreeze' : 'freeze')}
              >
                {frozen ? 'Unfreeze account' : 'Freeze account'}
              </Button>
            ) : null}
          </>
        }
      />

      {failure ? (
        <Notice
          tone="warning"
          compact
          announce="polite"
          actions={<Button variant="ghost" size="sm" onClick={() => void refreshProfile()}>Try again</Button>}
        >
          The profile could not be refreshed. {failureText(failure)} Showing what was loaded earlier.
        </Notice>
      ) : null}

      <AccountNotices user={user} stats={stats} />

      <ProfileKpis user={user} stats={stats} canTransactions={canTransactions} />

      <div className={s.layout}>
        <ProfileCard user={user} referrer={referrer} referrerError={partial.referrer} />
        <section className={s.activity} aria-label="Activity">
          <Tabs<SectionKey>
            id={ACTIVITY_TABS}
            aria-label="Activity sections"
            value={tab}
            onChange={(next) => setTab(next)}
            items={tabItems}
            variant="underline"
          />
          {SECTION_ORDER.map((key) => (
            <TabPanel key={key} tabsId={ACTIVITY_TABS} value={key} active={tab === key}>
              {key === 'transactions' ? (
                <TransactionsPanel
                  section={transactions}
                  userId={user.id}
                  canOpen={canTransactions}
                  isMobile={isMobile}
                />
              ) : key === 'devices' ? (
                <DevicesPanel section={devices} isMobile={isMobile} />
              ) : (
                <LoginsPanel section={logins} isMobile={isMobile} />
              )}
            </TabPanel>
          ))}
        </section>
      </div>
    </div>
  );
}
