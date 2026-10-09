'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Lock, RotateCw, UserX } from 'lucide-react';
import { Badge, Button, DetailRow, Money, Notice, Ref, SectionLabel, Skeleton, StatusDot } from '../../_ui';
import { isUuid } from '../../lib/http';
import { BUSINESS_TZ_LABEL, formatBusinessDate, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import { DEVICE_LIMIT } from './rules';
import {
  accountState,
  ageText,
  deviceLabel,
  handleOf,
  openSessionSummary,
  openSessionsText,
  plural,
  presenceOf,
  seenText,
  sessionState,
  typeLabel,
  type ActivityUser,
  type DeviceRow,
  type LiveState,
  type LoadedDetail,
  type SessionRow,
  type TransactionRow,
  type UserDetail,
  type WithdrawalRow,
} from './model';
import s from './page.module.css';

function stamp(value: string | null): string {
  return value ? `${formatBusinessDateTime(value)} ${BUSINESS_TZ_LABEL}` : 'Time not recorded';
}

export function StatusCell({ user }: { user: ActivityUser }) {
  const state = accountState(user);
  if (state === 'deleted') {
    return (
      <span className={s.statusCell}>
        <Badge tone="neutral">Deleted</Badge>
      </span>
    );
  }
  const presence = presenceOf(user);
  return (
    <span className={s.statusCell}>
      <StatusDot status={presence.key} tone={presence.tone} label={presence.label} />
      {state === 'frozen' ? (
        <Badge tone="danger" title={user.freeze_reason || undefined}>
          Frozen
        </Badge>
      ) : null}
      {state === 'inactive' ? <Badge tone="neutral">Inactive</Badge> : null}
    </span>
  );
}

export function SeenCell({ value }: { value: string | null }) {
  if (!value) return <span className={s.muted}>Never active</span>;
  return (
    <span className={s.stack}>
      <span className={s.time}>{formatBusinessDateTime(value)}</span>
      <span className={s.sub}>{ageText(value)}</span>
    </span>
  );
}

export function JoinedCell({ value }: { value: string | null }) {
  if (!value) return <span className={s.muted}>—</span>;
  return (
    <span className={s.stack}>
      <span className={s.time}>{formatBusinessDate(value)}</span>
      <span className={s.sub}>{ageText(value)}</span>
    </span>
  );
}

export function LiveStatus({ state }: { state: LiveState }) {
  return (
    <p className={s.live}>
      <StatusDot status={state.label} tone={state.tone} label={state.label} />
      {state.detail ? <span className={s.liveDetail}>{state.detail}</span> : null}
    </p>
  );
}

export function DetailToolbar({
  loadedAt,
  refreshing,
  onRefresh,
}: {
  loadedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className={s.toolbar}>
      <span className={s.toolbarText}>
        {loadedAt
          ? `Loaded ${formatBusinessTime(new Date(loadedAt))} ${BUSINESS_TZ_LABEL}. Refresh to see new activity.`
          : 'Loading…'}
      </span>
      <Button variant="ghost" size="sm" leftIcon={<RotateCw size={14} aria-hidden />} loading={refreshing} onClick={onRefresh}>
        Refresh
      </Button>
    </div>
  );
}

function Section({
  title,
  count,
  hint,
  action,
  children,
}: {
  title: string;
  count?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <SectionLabel as="h3" flush>
          {title}
        </SectionLabel>
        {count ? <span className={s.sectionCount}>{count}</span> : null}
        {action}
      </div>
      {hint ? <p className={s.sectionHint}>{hint}</p> : null}
      {children}
    </section>
  );
}

function SectionProblem({ message }: { message: string }) {
  return (
    <Notice tone="warning" compact announce="polite" flush>
      {message} Use Refresh to try again.
    </Notice>
  );
}

function AccountNotices({ user }: { user: UserDetail }) {
  if (user.deleted_at) {
    return (
      <Notice
        variant="callout"
        tone="neutral"
        icon={<UserX size={14} aria-hidden />}
        title="Account deleted"
        meta={`Deleted ${stamp(user.deleted_at)} · ${ageText(user.deleted_at)}`}
      />
    );
  }
  if (user.is_frozen) {
    return (
      <Notice variant="callout" tone="danger" icon={<Lock size={14} aria-hidden />} title="Account frozen">
        {user.freeze_reason || 'No reason was recorded for this freeze.'}
      </Notice>
    );
  }
  return null;
}

function PresenceSection({ detail }: { detail: LoadedDetail }) {
  const { user } = detail;
  return (
    <Section title="Presence">
      <DetailRow label="Status" value={<StatusCell user={user} />} />
      <DetailRow label="Last seen" value={seenText(user.last_active_at)} wrap />
      <DetailRow label="Open sessions" value={openSessionsText(openSessionSummary(detail))} />
      <DetailRow
        label="Joined"
        value={user.created_at ? `${formatBusinessDate(user.created_at)} · ${ageText(user.created_at)}` : '—'}
        wrap
      />
    </Section>
  );
}

function AccountSection({ user }: { user: UserDetail }) {
  return (
    <Section
      title="Account"
      action={
        <Link href={`/users/${user.id}`} className={s.headLink}>
          View user <ArrowUpRight size={12} aria-hidden />
        </Link>
      }
    >
      <DetailRow label="Name" value={user.full_name || '—'} wrap />
      <DetailRow label="Username" value={handleOf(user) || '—'} wrap />
      <DetailRow label="Email" value={user.email || '—'} wrap />
      <DetailRow label="Phone" value={user.phone || '—'} mono />
      <DetailRow label="Country" value={user.country || '—'} />
      <DetailRow label="User ID" value={<Ref value={user.id} label="user ID" truncate={13} />} />
    </Section>
  );
}

function SessionItem({ session }: { session: SessionRow }) {
  const state = sessionState(session);
  return (
    <li className={s.item}>
      <div className={s.itemTop}>
        <span className={s.itemTitle}>{deviceLabel(session)}</span>
        <StatusDot status={state.key} tone={state.tone} label={state.label} />
      </div>
      <div className={s.itemMeta}>
        <span>Signed in {stamp(session.created_at)}</span>
        <span className={s.mono}>IP {session.ip_address || '—'}</span>
      </div>
    </li>
  );
}

function SessionsSection({ detail }: { detail: LoadedDetail }) {
  const { sessions, partial } = detail;
  return (
    <Section
      title="Sessions"
      count={sessions.length ? `Latest ${sessions.length.toLocaleString('en-NG')}` : undefined}
      hint="Each sign-in to the app starts a session. Open means it was never signed out, which can last after the app is closed."
    >
      {partial.sessions ? (
        <SectionProblem message={partial.sessions} />
      ) : sessions.length === 0 ? (
        <p className={s.none}>No sign-ins recorded.</p>
      ) : (
        <ul className={s.rows}>
          {sessions.map((session) => (
            <SessionItem key={session.id} session={session} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function DeviceItem({ device }: { device: DeviceRow }) {
  const firstUse = device.is_new_device && (device.login_count ?? 0) <= 1;
  return (
    <li className={s.item}>
      <div className={s.itemTop}>
        <span className={s.itemTitle}>{deviceLabel(device)}</span>
        <span className={s.itemBadges}>
          {firstUse ? <Badge tone="info">New device</Badge> : null}
          {device.login_count !== null ? <span className={s.itemCount}>{plural(device.login_count, 'sign-in')}</span> : null}
        </span>
      </div>
      <div className={s.itemMeta}>
        <span>Last seen {device.last_seen_at ? seenText(device.last_seen_at) : 'not recorded'}</span>
        <span>First seen {formatBusinessDate(device.created_at)}</span>
        <span className={s.mono}>IP {device.ip_address || '—'}</span>
      </div>
    </li>
  );
}

function DevicesSection({ detail }: { detail: LoadedDetail }) {
  const { devices, partial } = detail;
  const shown = devices.length;
  return (
    <Section
      title="Devices"
      count={shown ? (shown >= DEVICE_LIMIT ? `Latest ${DEVICE_LIMIT}` : plural(shown, 'device')) : undefined}
      hint="Phones this account has signed in from, most recently seen first."
    >
      {partial.devices ? (
        <SectionProblem message={partial.devices} />
      ) : shown === 0 ? (
        <p className={s.none}>No devices recorded.</p>
      ) : (
        <ul className={s.rows}>
          {devices.map((device) => (
            <DeviceItem key={device.id} device={device} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function RecordLink({ href, noun, children }: { href: string | null; noun: string; children: ReactNode }) {
  if (!href) return <span className={s.itemTitle}>{children}</span>;
  return (
    <Link href={href} className={s.itemLink}>
      <span className={s.srOnly}>Open {noun} </span>
      {children}
    </Link>
  );
}

function WithdrawalItem({ row }: { row: WithdrawalRow }) {
  return (
    <li className={s.item}>
      <div className={s.itemTop}>
        <RecordLink href={isUuid(row.id) ? `/withdrawals?id=${row.id}` : null} noun="withdrawal">
          <Money value={row.amount} emphasis="primary" />
        </RecordLink>
        <StatusDot status={row.status || 'unknown'} />
      </div>
      <div className={s.itemMeta}>
        <span>{[row.bank_name, row.account_name].filter(Boolean).join(' · ') || 'No destination recorded'}</span>
        <span>{stamp(row.created_at)}</span>
      </div>
    </li>
  );
}

function TransactionItem({ row }: { row: TransactionRow }) {
  return (
    <li className={s.item}>
      <div className={s.itemTop}>
        <RecordLink href={isUuid(row.id) ? `/transactions-overview?id=${row.id}` : null} noun="transaction">
          <Money value={row.amount} emphasis="primary" />
        </RecordLink>
        <StatusDot status={row.status || 'unknown'} />
      </div>
      <div className={s.itemMeta}>
        <span>{typeLabel(row.type)}</span>
        <span>{stamp(row.created_at)}</span>
      </div>
    </li>
  );
}

function WithdrawalsSection({ detail }: { detail: LoadedDetail }) {
  const { withdrawals, partial } = detail;
  return (
    <Section title="Recent withdrawals" count={withdrawals.length ? `Latest ${withdrawals.length}` : undefined}>
      {partial.withdrawals ? (
        <SectionProblem message={partial.withdrawals} />
      ) : withdrawals.length === 0 ? (
        <p className={s.none}>No withdrawals.</p>
      ) : (
        <ul className={s.rows}>
          {withdrawals.map((row) => (
            <WithdrawalItem key={row.id} row={row} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function TransactionsSection({ detail }: { detail: LoadedDetail }) {
  const { transactions, partial } = detail;
  return (
    <Section title="Recent transactions" count={transactions.length ? `Latest ${transactions.length}` : undefined}>
      {partial.transactions ? (
        <SectionProblem message={partial.transactions} />
      ) : transactions.length === 0 ? (
        <p className={s.none}>No transactions.</p>
      ) : (
        <ul className={s.rows}>
          {transactions.map((row) => (
            <TransactionItem key={row.id} row={row} />
          ))}
        </ul>
      )}
    </Section>
  );
}

export function DetailBody({ detail }: { detail: LoadedDetail }) {
  return (
    <div className={s.detail}>
      <AccountNotices user={detail.user} />
      <PresenceSection detail={detail} />
      <AccountSection user={detail.user} />
      <SessionsSection detail={detail} />
      <DevicesSection detail={detail} />
      <WithdrawalsSection detail={detail} />
      <TransactionsSection detail={detail} />
    </div>
  );
}

const SKELETON_SECTIONS = [4, 6, 4, 3];
const SKELETON_LABELS = ['34%', '22%', '40%', '28%', '31%'];
const SKELETON_VALUES = ['26%', '38%', '20%', '33%', '24%'];

export function DetailSkeleton() {
  return (
    <div className={s.detail}>
      <span className={s.srOnly} role="status">
        Loading user activity
      </span>
      {SKELETON_SECTIONS.map((rowCount, section) => (
        <div key={section} className={s.section} aria-hidden>
          <Skeleton width={84} height={10} />
          <div className={s.skeletonRows}>
            {Array.from({ length: rowCount }, (_, row) => (
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
