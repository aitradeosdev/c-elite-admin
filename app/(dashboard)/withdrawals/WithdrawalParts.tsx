'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, Lock } from 'lucide-react';
import {
  Badge, Button, DetailRow, LinkButton, MaskedValue, Money, Notice, Ref, SectionLabel, Skeleton, StatusDot,
  statusLabel, statusTone,
} from '../../_ui';
import { formatAge, formatBusinessDateTime } from '../../lib/time';
import {
  EMERGENCY_PAUSED, EMERGENCY_REJECT_NOTE, EMERGENCY_TITLE, feeOf, grossOf, isActionable, isFrozen, isHeld, isOpenFlag,
  netOf, payoutDiffers, providerLabel,
  type DetailPartial, type Withdrawal, type WithdrawalFlag, type WithdrawalUser,
} from './model';
import s from './page.module.css';

const HELD_HINT = 'Held after a risk flag was escalated. It still needs a decision.';

export interface Outcome {
  id: string;
  tone: 'danger' | 'warning';
  title: string;
  message: string;
  requestId?: string | null;
  raisedInDrawer: boolean;
}

export function WithdrawalStatus({ status }: { status: string }) {
  if (!isHeld(status)) return <StatusDot status={status} />;
  return (
    <Badge tone={statusTone(status)} dot title={HELD_HINT}>
      Held
    </Badge>
  );
}

export function FrozenBadge({ user }: { user: WithdrawalUser | null | undefined }) {
  if (!isFrozen(user)) return null;
  return (
    <Badge tone="danger" title={user?.freeze_reason || undefined}>
      Frozen
    </Badge>
  );
}

export function FlagBadge({ flag }: { flag: WithdrawalFlag | null | undefined }) {
  if (!isOpenFlag(flag)) return null;
  return (
    <Badge tone="warning" title={flag?.flag_reason || undefined}>
      Flagged
    </Badge>
  );
}

export function EmergencyNotice({ settingsLink }: { settingsLink: boolean }) {
  return (
    <Notice
      tone="danger"
      title={EMERGENCY_TITLE}
      announce="polite"
      actions={
        settingsLink ? (
          <LinkButton href="/admin-settings" variant="secondary" size="sm">
            Open Admin Settings
          </LinkButton>
        ) : undefined
      }
    >
      {EMERGENCY_PAUSED} {EMERGENCY_REJECT_NOTE}
    </Notice>
  );
}

export function OutcomeNotice({
  outcome,
  announce,
  onDismiss,
  onOpen,
}: {
  outcome: Outcome;
  announce: boolean;
  onDismiss: () => void;
  onOpen?: () => void;
}) {
  return (
    <Notice
      tone={outcome.tone}
      title={outcome.title}
      icon={<AlertTriangle size={16} aria-hidden />}
      meta={[
        <>Withdrawal <Ref value={outcome.id} label="withdrawal ID" size="xs" /></>,
        outcome.requestId ? <>Request <Ref value={outcome.requestId} label="request ID" size="xs" /></> : null,
      ]}
      actions={onOpen ? <Button variant="secondary" size="sm" onClick={onOpen}>Open withdrawal</Button> : undefined}
      onDismiss={onDismiss}
      dismissLabel="Dismiss this notice"
      announce={announce}
    >
      {outcome.message}
    </Notice>
  );
}

function FrozenCallout({ user, actionable }: { user: WithdrawalUser; actionable: boolean }) {
  return (
    <Notice
      variant="callout"
      tone="danger"
      icon={<Lock size={14} aria-hidden />}
      title="Account frozen"
      meta={
        actionable
          ? 'This payout cannot be approved while the account is frozen. Reject it to refund the wallet, or unfreeze the account first.'
          : undefined
      }
    >
      {user.freeze_reason || 'No reason was recorded for this freeze.'}
    </Notice>
  );
}

function EmergencyCallout() {
  return (
    <Notice variant="callout" tone="danger" title={EMERGENCY_TITLE} meta={EMERGENCY_REJECT_NOTE}>
      {EMERGENCY_PAUSED}
    </Notice>
  );
}

function FlagCallout({ flag }: { flag: WithdrawalFlag }) {
  const open = isOpenFlag(flag);
  return (
    <Notice
      variant="callout"
      tone={open ? 'warning' : 'neutral'}
      icon={<AlertTriangle size={14} aria-hidden />}
      title={<>{open ? 'Flagged' : 'Previously flagged'} · {statusLabel(flag.status || '')}</>}
      meta={flag.created_at ? `Raised ${formatBusinessDateTime(flag.created_at)} WAT` : undefined}
    >
      {flag.flag_reason || 'No reason was recorded for this flag.'}
    </Notice>
  );
}

export function DetailBody({
  withdrawal,
  partial,
  payoutGateway,
  payoutMissing = false,
  emergencyMode = null,
}: {
  withdrawal: Withdrawal;
  partial: DetailPartial;
  payoutGateway: string | null;
  payoutMissing?: boolean;
  emergencyMode?: boolean | null;
}) {
  const user = withdrawal.user;
  const actionable = isActionable(withdrawal.status);
  return (
    <div className={s.detail}>
      {actionable && emergencyMode === true ? <EmergencyCallout /> : null}
      {user && isFrozen(user) ? <FrozenCallout user={user} actionable={actionable} /> : null}
      {withdrawal.flag ? <FlagCallout flag={withdrawal.flag} /> : null}
      {!withdrawal.flag && partial.flag ? (
        <Notice tone="warning" compact announce="polite" flush>
          {partial.flag} Review the account before deciding.
        </Notice>
      ) : null}

      <div className={s.section}>
        <SectionLabel>Payout</SectionLabel>
        <DetailRow label="Net payout" value={<Money value={netOf(withdrawal)} emphasis="strong" size="lg" />} />
        <DetailRow label="Fee" value={<Money value={feeOf(withdrawal)} />} />
        <DetailRow label="Debited from wallet" value={<Money value={grossOf(withdrawal)} />} />
      </div>

      <div className={s.section}>
        <SectionLabel>Destination</SectionLabel>
        <DetailRow label="Bank" value={withdrawal.bank_name || '—'} wrap />
        <DetailRow label="Account name" value={withdrawal.account_name || '—'} wrap />
        <DetailRow label="Account number" value={<MaskedValue value={withdrawal.account_number} kind="account" />} />
      </div>

      <div className={s.section}>
        <div className={s.sectionHead}>
          <SectionLabel flush>Account holder</SectionLabel>
          {withdrawal.user_id ? (
            <Link href={`/users/${withdrawal.user_id}`} className={s.holderLink}>
              View user <ArrowUpRight size={12} aria-hidden />
            </Link>
          ) : null}
        </div>
        {partial.user ? (
          <Notice tone="warning" compact announce="polite" flush>
            {partial.user}
          </Notice>
        ) : null}
        <DetailRow label="Name" value={user?.full_name || '—'} wrap />
        <DetailRow label="Username" value={user?.username ? `@${user.username}` : '—'} wrap />
        <DetailRow label="Email" value={user?.email || '—'} wrap />
        <DetailRow label="Phone" value={user?.phone || '—'} mono />
      </div>

      <div className={s.section}>
        <SectionLabel>Processing</SectionLabel>
        <DetailRow label="Status" value={<WithdrawalStatus status={withdrawal.status} />} />
        {withdrawal.failure_reason ? <DetailRow label="Reason" value={withdrawal.failure_reason} wrap /> : null}
        {actionable && payoutDiffers(withdrawal.gateway, payoutGateway) ? (
          <>
            <DetailRow label="Requested via" value={providerLabel(withdrawal.gateway)} />
            <DetailRow
              label="Payout provider"
              value={payoutGateway ? providerLabel(payoutGateway) : payoutMissing ? 'None available' : 'Could not be checked'}
            />
          </>
        ) : (
          <DetailRow label="Provider" value={providerLabel(withdrawal.gateway)} />
        )}
        <DetailRow
          label="Provider reference"
          value={<Ref value={withdrawal.gateway_reference} label="provider reference" truncate={18} />}
        />
        <DetailRow
          label="Requested"
          value={`${formatBusinessDateTime(withdrawal.created_at)} WAT · ${formatAge(withdrawal.created_at)} ago`}
          wrap
        />
        <DetailRow label="Withdrawal ID" value={<Ref value={withdrawal.id} label="withdrawal ID" truncate={13} />} />
      </div>
    </div>
  );
}

const SKELETON_SECTIONS = [3, 3, 4, 5];
const SKELETON_LABELS = ['34%', '22%', '40%', '28%', '31%'];
const SKELETON_VALUES = ['26%', '38%', '20%', '33%', '24%'];

export function DetailSkeleton() {
  return (
    <div className={s.detail}>
      <span className={s.srOnly} role="status">Loading withdrawal</span>
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
