'use client';

import Link from 'next/link';
import { ArrowUpRight, Info, Lock } from 'lucide-react';
import {
  Avatar, Badge, Button, DetailRow, JsonViewer, LinkButton, MaskedValue, Money, Notice, Ref, SectionLabel, Skeleton,
  StatusDot,
  type ButtonVariant, type ConfirmDetail,
} from '../../_ui';
import { maskMetadata } from '../../lib/mask';
import { formatAge, formatBusinessDateTime } from '../../lib/time';
import { typeLabel } from '../transactions-overview/model';
import { feeOf, isActionable, netOf, providerLabel } from '../withdrawals/model';
import {
  DECIDE_IN_WITHDRAWALS, FLAG_ACTIONS, REVIEW_ONLY_BODY, REVIEW_ONLY_TITLE, VIEW_ONLY, actionsFor, flagStatusLabel,
  isOpenStatus, isWithdrawalFlag, userHandle, userName, userSubline, userSummary, withdrawalHref,
  type DetailResult, type Flag, type FlagAction, type FlagUser, type OtherFlag, type Reviewer, type TransactionSummary,
  type WithdrawalSummary,
} from './model';
import s from './page.module.css';

const ACTION_VARIANTS: Readonly<Record<FlagAction, ButtonVariant>> = {
  clear: 'primary',
  escalate: 'secondary',
  reject: 'dangerSubtle',
};

function when(value: string | null | undefined): string {
  if (!value) return '—';
  return `${formatBusinessDateTime(value)} WAT · ${formatAge(value)} ago`;
}

export function FlagStatusDot({ status }: { status: string }) {
  return <StatusDot status={status || 'unknown'} label={flagStatusLabel(status)} />;
}

export interface FlagUserCellProps {
  user: FlagUser | null;
  userId: string | null;
  canOpen: boolean;
}

export function FlagUserCell({ user, userId, canOpen }: FlagUserCellProps) {
  const handle = userHandle(user, userId);
  return (
    <div className={s.userCell}>
      <Avatar name={userName(user) || handle} decorative />
      <div className={s.stack}>
        {canOpen && userId ? (
          <Link href={`/users/${encodeURIComponent(userId)}`} prefetch={false} className={s.userLink}>
            {handle}
          </Link>
        ) : (
          <span className={s.lead}>{handle}</span>
        )}
        <span className={s.sub}>{userSubline(user)}</span>
      </div>
    </div>
  );
}

export function confirmDetails(detail: DetailResult): ConfirmDetail[] {
  const { flag, withdrawal } = detail;
  return [
    { label: 'Flag', value: flag.flag_reason || 'No reason was recorded' },
    { label: 'User', value: userSummary(flag.user) },
    { label: 'Flagged amount', value: <Money value={flag.amount} emphasis="strong" />, emphasis: true },
    { label: 'Flag status', value: <FlagStatusDot status={flag.status} /> },
    ...(withdrawal
      ? [{ label: 'Withdrawal status', value: <StatusDot status={withdrawal.status || 'unknown'} /> }]
      : []),
  ];
}

export interface FlagActionsProps {
  status: string;
  acting: FlagAction | null;
  onAction: (action: FlagAction, opener: HTMLElement) => void;
}

export function FlagActions({ status, acting, onAction }: FlagActionsProps) {
  const actions = actionsFor(status);
  if (actions.length === 0) return null;
  return (
    <div className={s.drawerActions} role="group" aria-label="Review this flag">
      {actions.map((action) => (
        <Button
          key={action}
          variant={ACTION_VARIANTS[action]}
          loading={acting === action}
          disabled={acting !== null}
          onClick={(event) => onAction(action, event.currentTarget)}
        >
          {FLAG_ACTIONS[action].button}
        </Button>
      ))}
    </div>
  );
}

function ReviewNotice({
  flag,
  withdrawal,
  canResolve,
  canWithdrawals,
}: {
  flag: Flag;
  withdrawal: WithdrawalSummary | null;
  canResolve: boolean;
  canWithdrawals: boolean;
}) {
  const href = canWithdrawals ? withdrawalHref(flag) : null;
  const viewOnly = !canResolve && isOpenStatus(flag.status);
  return (
    <Notice
      variant="callout"
      tone="info"
      icon={<Info size={14} aria-hidden />}
      title={REVIEW_ONLY_TITLE}
      meta={
        withdrawal?.status ? (
          <span className={s.noticeStatus}>
            Withdrawal status <StatusDot status={withdrawal.status} />
          </span>
        ) : undefined
      }
      actions={
        href ? (
          <LinkButton href={href} variant="secondary" size="sm" rightIcon={<ArrowUpRight size={14} aria-hidden />}>
            Open withdrawal
          </LinkButton>
        ) : undefined
      }
    >
      {REVIEW_ONLY_BODY}
      {isWithdrawalFlag(flag) ? ` ${DECIDE_IN_WITHDRAWALS}` : null}
      {viewOnly ? ` ${VIEW_ONLY}` : null}
    </Notice>
  );
}

function FrozenCallout({ user, awaiting }: { user: FlagUser; awaiting: boolean }) {
  return (
    <Notice
      variant="callout"
      tone="danger"
      icon={<Lock size={14} aria-hidden />}
      title="Account frozen"
      meta={
        awaiting
          ? 'The withdrawal cannot be approved while the account is frozen. Rejecting the withdrawal on the Withdrawals page still refunds the wallet; rejecting this flag does not.'
          : undefined
      }
    >
      {user.freeze_reason || 'No reason was recorded for this freeze.'}
    </Notice>
  );
}

function reviewerText(flag: Flag, reviewer: Reviewer | null, failed: boolean): string {
  if (!flag.reviewed_at && !flag.reviewed_by) return 'Not reviewed yet';
  const who = reviewer?.username || (failed ? 'an admin whose name could not be loaded' : 'an admin no longer on file');
  return `${flagStatusLabel(flag.status)} by ${who}`;
}

function WithdrawalSection({ withdrawal }: { withdrawal: WithdrawalSummary }) {
  return (
    <div className={s.section}>
      <SectionLabel as="h3">Withdrawal</SectionLabel>
      <DetailRow label="Status" value={<StatusDot status={withdrawal.status || 'unknown'} />} />
      <DetailRow label="Net payout" value={<Money value={netOf(withdrawal)} emphasis="strong" />} />
      <DetailRow label="Fee" value={<Money value={feeOf(withdrawal)} />} />
      <DetailRow label="Bank" value={withdrawal.bank_name || '—'} wrap />
      <DetailRow label="Account name" value={withdrawal.account_name || '—'} wrap />
      <DetailRow label="Account number" value={<MaskedValue value={withdrawal.account_number} kind="account" />} />
      <DetailRow label="Provider" value={providerLabel(withdrawal.gateway)} />
      <DetailRow label="Requested" value={when(withdrawal.created_at)} wrap />
      {withdrawal.failure_reason ? <DetailRow label="Failure reason" value={withdrawal.failure_reason} wrap /> : null}
      <DetailRow label="Withdrawal ID" value={<Ref value={withdrawal.id} label="withdrawal ID" truncate={13} />} />
    </div>
  );
}

function hasMetadata(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && Object.keys(value as object).length > 0;
}

function TransactionSection({ transaction }: { transaction: TransactionSummary }) {
  return (
    <div className={s.section}>
      <SectionLabel as="h3">Transaction</SectionLabel>
      <DetailRow label="Type" value={typeLabel(transaction.type)} wrap />
      <DetailRow label="Amount" value={<Money value={transaction.amount} emphasis="strong" />} />
      <DetailRow label="Status" value={<StatusDot status={transaction.status || 'unknown'} />} />
      <DetailRow label="Reference" value={<Ref value={transaction.reference_id} label="reference" truncate={13} />} />
      <DetailRow label="Created" value={when(transaction.created_at)} wrap />
      <DetailRow label="Transaction ID" value={<Ref value={transaction.id} label="transaction ID" truncate={13} />} />
      {hasMetadata(transaction.metadata) ? (
        <JsonViewer
          key={transaction.id}
          className={s.raw}
          value={maskMetadata(transaction.metadata)}
          label="Transaction metadata"
          defaultExpandDepth={0}
        />
      ) : null}
    </div>
  );
}

function OtherFlags({ flag, others, error }: { flag: Flag; others: readonly OtherFlag[]; error: string | null }) {
  if (others.length === 0 && !error) return null;
  return (
    <div className={s.section}>
      <SectionLabel as="h3">
        {isWithdrawalFlag(flag) ? 'Other flags on this withdrawal' : 'Other flags on this transaction'}
      </SectionLabel>
      {error ? (
        <Notice tone="warning" compact announce="polite" flush>
          {error}
        </Notice>
      ) : null}
      {others.length > 0 ? (
        <ul className={s.otherList}>
          {others.map((other) => (
            <li key={other.id} className={s.otherItem}>
              <span className={s.otherReason}>{other.flag_reason || 'No reason was recorded'}</span>
              <span className={s.otherMeta}>
                <FlagStatusDot status={other.status} />
                <span>Raised {when(other.created_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export interface FlagDetailBodyProps {
  detail: DetailResult;
  canResolve: boolean;
  canUsers: boolean;
  canWithdrawals: boolean;
}

export function FlagDetailBody({ detail, canResolve, canUsers, canWithdrawals }: FlagDetailBodyProps) {
  const { flag, reviewer, withdrawal, transaction, otherFlags, partial } = detail;
  const user = flag.user;
  const awaiting = withdrawal !== null && isActionable(withdrawal.status);
  const name = userName(user);
  return (
    <div className={s.detail}>
      <ReviewNotice flag={flag} withdrawal={withdrawal} canResolve={canResolve} canWithdrawals={canWithdrawals} />
      {user?.is_frozen ? <FrozenCallout user={user} awaiting={awaiting} /> : null}

      <div className={s.section}>
        <SectionLabel as="h3">Flag</SectionLabel>
        <DetailRow label="Reason" value={flag.flag_reason || 'No reason was recorded'} wrap />
        <DetailRow label="Status" value={<FlagStatusDot status={flag.status} />} />
        <DetailRow label="Type" value={typeLabel(flag.transaction_type)} wrap />
        <DetailRow label="Flagged amount" value={<Money value={flag.amount} emphasis="strong" />} />
        <DetailRow label="Flag ID" value={<Ref value={flag.id} label="flag ID" truncate={13} />} />
      </div>

      <div className={s.section}>
        <SectionLabel as="h3">Review history</SectionLabel>
        {partial.reviewer ? (
          <Notice tone="warning" compact announce="polite" flush>
            {partial.reviewer}
          </Notice>
        ) : null}
        <DetailRow label="Raised" value={when(flag.created_at)} wrap />
        <DetailRow label="Last review" value={reviewerText(flag, reviewer, partial.reviewer !== null)} wrap />
        {flag.reviewed_at ? <DetailRow label="Reviewed" value={when(flag.reviewed_at)} wrap /> : null}
      </div>

      {withdrawal ? <WithdrawalSection withdrawal={withdrawal} /> : null}
      {transaction ? <TransactionSection transaction={transaction} /> : null}
      {!withdrawal && !transaction && partial.related ? (
        <div className={s.section}>
          <SectionLabel as="h3">{isWithdrawalFlag(flag) ? 'Withdrawal' : 'Transaction'}</SectionLabel>
          <Notice tone="warning" compact announce="polite" flush>
            {partial.related}
          </Notice>
        </div>
      ) : null}

      <div className={s.section}>
        <div className={s.sectionHead}>
          <SectionLabel as="h3" flush>Account holder</SectionLabel>
          {canUsers && flag.user_id ? (
            <Link href={`/users/${encodeURIComponent(flag.user_id)}`} prefetch={false} className={s.headLink}>
              View user <ArrowUpRight size={12} aria-hidden />
            </Link>
          ) : null}
        </div>
        <div className={s.holder}>
          <Avatar name={name || userHandle(user, flag.user_id)} size="md" decorative />
          <div className={s.stack}>
            <span className={s.lead}>{name || userHandle(user, flag.user_id)}</span>
            <span className={s.sub}>{user?.email || 'No email on file'}</span>
          </div>
        </div>
        <DetailRow label="Username" value={user?.username ? `@${user.username}` : '—'} wrap />
        <DetailRow
          label="Account"
          value={
            user?.is_frozen ? (
              <Badge tone="danger" title={user.freeze_reason || undefined}>Frozen</Badge>
            ) : user?.is_frozen === false ? (
              'Not frozen'
            ) : (
              'Could not be checked'
            )
          }
        />
      </div>

      <OtherFlags flag={flag} others={otherFlags} error={partial.otherFlags} />
    </div>
  );
}

const SKELETON_SECTIONS = [2, 5, 3, 6];
const SKELETON_LABELS = ['34%', '22%', '40%', '28%', '31%'];
const SKELETON_VALUES = ['26%', '38%', '20%', '33%', '24%'];

export function FlagDetailSkeleton() {
  return (
    <div className={s.detail}>
      <span className={s.srOnly} role="status">Loading flag</span>
      {SKELETON_SECTIONS.map((count, section) => (
        <div key={section} className={s.section} aria-hidden>
          <Skeleton width={84} height={10} />
          <div className={s.skeletonRows}>
            {Array.from({ length: count }, (_, row) => (
              <div key={row} className={s.skeletonRow}>
                <Skeleton width={SKELETON_LABELS[(section + row) % SKELETON_LABELS.length]} height={12} />
                <Skeleton width={SKELETON_VALUES[(section + row) % SKELETON_VALUES.length]} height={12} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
