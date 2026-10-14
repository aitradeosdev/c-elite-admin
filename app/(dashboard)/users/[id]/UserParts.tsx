'use client';

import type { Ref as ReactRef } from 'react';
import Link from 'next/link';
import {
  Activity, ArrowDownToLine, ArrowUpRight, ClipboardList, Lock, Receipt, UserX, Wallet,
} from 'lucide-react';
import {
  Avatar, Badge, Button, Card, CardBody, CardHeader, DetailRow, EmptyState, Kpi, KpiGrid, KpiSkeleton, LinkButton,
  Notice, PageHeader, PageHeaderSkeleton, Ref, SectionLabel, Skeleton, TBody, Table, TableSkeleton, formatNaira, useCan,
} from '../../../_ui';
import { formatAge, formatBusinessDate, formatBusinessDateTime } from '../../../lib/time';
import {
  ACCOUNT_STATES, accountState, canAdjustWallet, countText, displayName, plural, referrerName, userTransactionsHref,
  type Referrer, type UserProfile, type UserStats,
} from './model';
import s from './page.module.css';

const UNCOUNTED = 'Could not be counted. Refresh to try again.';
const PROFILE_SKELETON = ['46%', '38%', '52%', '44%', '30%', '41%', '35%', '48%', '33%'];
const REFRESH_SKELETON = 86;
const ADJUST_SKELETON = 116;
const FREEZE_SKELETON = 128;

export function AdjustWalletButton({
  user, onOpen, buttonRef,
}: {
  user: UserProfile;
  onOpen: () => void;
  buttonRef?: ReactRef<HTMLButtonElement>;
}) {
  const allowed = useCan(['users.read', 'wallets.adjust']);
  if (!allowed || !canAdjustWallet(user)) return null;
  return (
    <Button ref={buttonRef} variant="secondary" size="sm" leftIcon={<Wallet size={14} />} onClick={onOpen}>
      Adjust wallet
    </Button>
  );
}

export function UserTitle({ user }: { user: UserProfile }) {
  const name = displayName(user);
  return (
    <span className={s.titleRow}>
      <Avatar src={user.avatar_url} name={name} size="md" decorative />
      <span className={s.titleText}>{name}</span>
    </span>
  );
}

export function UserSubtitle({ user }: { user: UserProfile }) {
  const state = ACCOUNT_STATES[accountState(user)];
  return (
    <span className={s.subtitle}>
      {user.username && user.full_name ? <span className={s.handle} translate="no">@{user.username}</span> : null}
      <Badge tone={state.tone} dot>{state.label}</Badge>
      <span>Joined {formatBusinessDate(user.created_at)}</span>
    </span>
  );
}

export function AccountNotices({ user, stats }: { user: UserProfile; stats: UserStats }) {
  if (user.deleted_at) {
    return (
      <Notice
        tone="danger"
        icon={<UserX size={16} />}
        title="Deletion in progress"
        meta={`Requested ${formatBusinessDateTime(user.deleted_at)} WAT · ${formatAge(user.deleted_at)} ago`}
      >
        This account is being deleted, so it cannot be frozen or unfrozen from here.
      </Notice>
    );
  }

  if (!user.is_frozen) return null;

  const awaiting = stats.withdrawals_pending;
  return (
    <Notice
      tone="danger"
      icon={<Lock size={16} />}
      title="Account frozen"
      meta={
        <>
          Withdrawals and bill payments are refused, and the user sees this reason in the app.
          {awaiting ? (
            <Notice tone="warning" compact>
              {plural(awaiting, 'withdrawal is', 'withdrawals are')} awaiting review and cannot be approved while the
              account is frozen. Reject in Withdrawals to refund the wallet.
            </Notice>
          ) : null}
        </>
      }
    >
      {user.freeze_reason || 'No reason was recorded for this freeze.'}
    </Notice>
  );
}

function awaitingHint(count: number | null): string {
  if (count === null) return 'Review queue could not be checked';
  return count > 0 ? `${countText(count)} awaiting review` : 'None awaiting review';
}

export function ProfileKpis({
  user, stats, canTransactions,
}: {
  user: UserProfile;
  stats: UserStats;
  canTransactions: boolean;
}) {
  const bonus = Number(user.bonus_balance ?? 0);
  return (
    <KpiGrid className={s.kpis}>
      <Kpi
        label="Wallet balance"
        icon={<Wallet size={14} />}
        value={formatNaira(user.balance)}
        hint={Number.isFinite(bonus) && bonus > 0 ? `Plus ${formatNaira(bonus)} bonus balance` : 'No bonus balance'}
      />
      <Kpi
        label="Card submissions"
        icon={<ClipboardList size={14} />}
        value={countText(stats.card_submissions)}
        unavailable={stats.card_submissions === null}
        unavailableHint={UNCOUNTED}
        hint="Gift cards submitted, any status"
      />
      <Kpi
        label="Transactions"
        icon={<Receipt size={14} />}
        value={countText(stats.trades)}
        unavailable={stats.trades === null}
        unavailableHint={UNCOUNTED}
        hint={canTransactions ? 'Open in the transactions explorer' : 'Ledger entries of every type'}
        href={canTransactions ? userTransactionsHref(user.id) : undefined}
      />
      <Kpi
        label="Withdrawals"
        icon={<ArrowDownToLine size={14} />}
        value={countText(stats.withdrawals)}
        unavailable={stats.withdrawals === null}
        unavailableHint={UNCOUNTED}
        hint={awaitingHint(stats.withdrawals_pending)}
        hintTone={stats.withdrawals_pending ? 'warning' : 'neutral'}
      />
      <Kpi
        label="Last active"
        icon={<Activity size={14} />}
        value={user.last_active_at ? `${formatAge(user.last_active_at)} ago` : 'Not recorded'}
        hint={user.last_active_at ? `${formatBusinessDateTime(user.last_active_at)} WAT` : 'No app activity on record'}
      />
    </KpiGrid>
  );
}

function ReferrerValue({
  referredBy, referrer, error,
}: {
  referredBy: string | null;
  referrer: Referrer | null;
  error: string | null;
}) {
  if (!referredBy) return <span className={s.muted}>None</span>;
  if (referrer) {
    return (
      <Link href={`/users/${referrer.id}`} className={s.inlineLink}>
        {referrerName(referrer)} <ArrowUpRight size={12} aria-hidden />
      </Link>
    );
  }
  return <span className={s.muted}>{error ? 'Could not be loaded' : 'Account not found'}</span>;
}

function timeWithAge(value: string | null): string {
  return value ? `${formatBusinessDateTime(value)} WAT · ${formatAge(value)} ago` : 'Not recorded';
}

export function ProfileCard({
  user, referrer, referrerError,
}: {
  user: UserProfile;
  referrer: Referrer | null;
  referrerError: string | null;
}) {
  return (
    <Card className={s.profile}>
      <CardHeader title="Profile" />
      <CardBody>
        <div className={s.groups}>
          <div>
            <SectionLabel>Identity</SectionLabel>
            <DetailRow label="User ID" value={<Ref value={user.id} label="user ID" truncate={13} />} />
            <DetailRow label="Full name" value={user.full_name || '—'} wrap />
            <DetailRow label="Username" value={user.username ? `@${user.username}` : '—'} wrap />
            <DetailRow label="Email" value={user.email || '—'} wrap />
            <DetailRow label="Phone" value={user.phone || '—'} mono />
            <DetailRow label="Country" value={user.country || '—'} wrap />
          </div>
          <div>
            <SectionLabel>Account</SectionLabel>
            <DetailRow
              label="Referral code"
              value={<Ref value={user.referral_code} label="referral code" truncate={16} />}
            />
            <DetailRow
              label="Referred by"
              value={<ReferrerValue referredBy={user.referred_by} referrer={referrer} error={referrerError} />}
              wrap
            />
            <DetailRow label="Joined" value={timeWithAge(user.created_at)} wrap />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

export function NotFoundState() {
  return (
    <div>
      <PageHeader title="User not found" />
      <EmptyState
        icon={<UserX size={20} strokeWidth={1.75} />}
        title="No account matches this link"
        hint="The address may be mistyped, or the account may no longer exist. Find the user in the directory instead."
        actions={<LinkButton href="/users" size="sm">Back to users</LinkButton>}
      />
    </div>
  );
}

export function UserDetailSkeleton() {
  const canFreeze = useCan('users.freeze');
  const canAdjust = useCan(['users.read', 'wallets.adjust']);
  const actions = [
    REFRESH_SKELETON,
    ...(canAdjust ? [ADJUST_SKELETON] : []),
    ...(canFreeze ? [FREEZE_SKELETON] : []),
  ];
  return (
    <div className={s.page}>
      <PageHeaderSkeleton avatar actions={actions} label="Loading user" />
      <KpiGrid className={s.kpis} aria-hidden>
        {Array.from({ length: 5 }, (_, index) => <KpiSkeleton key={index} />)}
      </KpiGrid>
      <div className={s.layout} aria-hidden>
        <Card className={s.profile}>
          <CardBody>
            <Skeleton width={72} height={12} />
            <div className={s.skeletonRows}>
              {PROFILE_SKELETON.map((width, index) => (
                <div key={index} className={s.skeletonRow}>
                  <Skeleton width="28%" height={12} />
                  <Skeleton width={width} height={12} />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
        <div className={s.activity}>
          <div className={s.tabsSkeleton}>
            <Skeleton width={96} height={12} />
            <Skeleton width={64} height={12} />
            <Skeleton width={104} height={12} />
          </div>
          <Skeleton width="58%" height={12} className={s.captionSkeleton} />
          <Card>
            <CardBody flush>
              <Table flush aria-label="Loading activity">
                <TBody>
                  <TableSkeleton colSpan={5} rows={8} />
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
