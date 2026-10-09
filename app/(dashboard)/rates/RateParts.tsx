'use client';

import { LoaderCircle } from 'lucide-react';
import { Avatar, Badge, Button, Card, Money, Notice, Percent, Skeleton, type AvatarSize } from '../../_ui';
import { formatNaira } from '../../_ui/money';
import { isLargeMove, rateMove, type RateValues } from './rateRules';
import { changeCountText, unsavedText, type PageNotice, type PendingChange, type Phase, type RowView } from './model';
import s from './page.module.css';

const SKELETON_NAMES = ['42%', '30%', '54%', '36%', '47%'];
const SKELETON_META = ['28%', '34%', '22%', '31%', '26%'];

function onOff(active: boolean): string {
  return active ? 'On' : 'Off';
}

function liveText(values: RateValues): string {
  const rate = values.rate === null ? 'no rate' : formatNaira(values.rate);
  return values.active ? rate : `${rate}, switched off`;
}

export function BrandMark({ src, name, size = 'sm' }: { src: string | null; name: string; size?: AvatarSize }) {
  return <Avatar src={src} name={name || '?'} size={size} decorative className={s.logoTile} />;
}

export function UnsavedMark() {
  return (
    <span className={s.unsaved}>
      <span className={s.unsavedDot} aria-hidden />
      Unsaved
    </span>
  );
}

export function MoveBadge({ from, to }: { from: number | null; to: number }) {
  const move = rateMove(from, to);
  const large = isLargeMove(from, to);
  if (move === null) {
    return large ? <Badge tone="warning" className={s.move}>New rate</Badge> : null;
  }
  if (large) {
    return (
      <Badge tone="warning" className={s.move}>
        <Percent value={move} signed decimals={1} />
      </Badge>
    );
  }
  return <Percent value={move} signed decimals={1} emphasis="muted" size="sm" className={s.move} />;
}

export function RateDiff({ change }: { change: PendingChange }) {
  return (
    <span className={s.diff}>
      {change.rateChanged ? (
        <span className={s.diffLine}>
          <span className={s.srOnly}>Rate from </span>
          <Money value={change.from.rate} className={s.diffFrom} />
          <span className={s.diffArrow} aria-hidden>→</span>
          <span className={s.srOnly}> to </span>
          <Money value={change.to.rate} emphasis="strong" />
          <MoveBadge from={change.from.rate} to={change.to.rate} />
        </span>
      ) : null}
      {change.activeChanged ? (
        <span className={s.diffLine}>
          <span className={s.srOnly}>Status from </span>
          <span className={s.diffFrom}>{onOff(change.from.active)}</span>
          <span className={s.diffArrow} aria-hidden>→</span>
          <span className={s.srOnly}> to </span>
          <span className={s.diffTo}>{onOff(change.to.active)}</span>
        </span>
      ) : null}
    </span>
  );
}

export function RowChange({ view }: { view: RowView }) {
  if (!view.changed) return null;
  return (
    <span className={s.rowChange}>
      {view.rateChanged ? (
        <span className={s.changeLine}>
          <span className={s.srOnly}>Was </span>
          <Money value={view.from.rate} size="sm" className={s.diffFrom} />
          <span className={s.diffArrow} aria-hidden>→</span>
          <span className={s.srOnly}>, now </span>
          {view.to === null ? (
            <span className={s.changeFail}>not a valid rate</span>
          ) : (
            <>
              <Money value={view.to} size="sm" emphasis="primary" />
              <MoveBadge from={view.from.rate} to={view.to} />
            </>
          )}
        </span>
      ) : null}
      {view.activeChanged ? (
        <span className={s.changeLine}>{view.active ? 'Switching on' : 'Switching off'}</span>
      ) : null}
      {view.huge ? <span className={s.changeWarn}>Large jump. Check for a typo.</span> : null}
      {view.conflict ? (
        <span className={s.changeWarn}>Changed elsewhere to {liveText(view.conflict)} while you were editing.</span>
      ) : null}
      {view.failure ? <span className={s.changeFail}>Not saved: {view.failure}</span> : null}
    </span>
  );
}

export function RatesSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true">
      <span className={s.srOnly} role="status">Loading rates</span>
      <Card aria-hidden>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className={s.skeletonRow}>
            <Skeleton width={28} height={28} className={s.skeletonLogo} />
            <div className={s.skeletonText}>
              <Skeleton width={SKELETON_NAMES[index % SKELETON_NAMES.length]} height={12} />
              <Skeleton width={SKELETON_META[index % SKELETON_META.length]} height={10} />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

export interface UnsavedBarProps {
  count: number;
  issues: number;
  phase: Phase;
  onDiscard: () => void;
  onReview: () => void;
}

export function UnsavedBar({ count, issues, phase, onDiscard, onReview }: UnsavedBarProps) {
  const busy = phase !== 'idle';
  const working = phase === 'checking' || phase === 'saving';
  const status = phase === 'checking'
    ? 'Checking the live rates…'
    : phase === 'saving'
      ? `Saving ${changeCountText(count)}…`
      : unsavedText(count);
  const label = phase === 'checking' ? 'Checking…' : phase === 'saving' ? 'Saving…' : 'Review changes';
  return (
    <div className={s.bar} role="region" aria-label="Unsaved rate changes">
      <p className={s.barStatus} role="status">
        <span className={s.barDot} aria-hidden />
        <span>{status}</span>
        {issues > 0 && !working ? <span className={s.barIssues}>{issues.toLocaleString('en-NG')} to fix</span> : null}
      </p>
      <div className={s.barActions}>
        <Button type="button" variant="ghost" aria-disabled={busy || undefined} onClick={onDiscard}>
          Discard
        </Button>
        <Button
          type="button"
          variant="primary"
          aria-disabled={busy || undefined}
          aria-busy={working || undefined}
          leftIcon={working ? <LoaderCircle size={14} aria-hidden className={s.spin} /> : undefined}
          onClick={onReview}
        >
          {label}
        </Button>
      </div>
    </div>
  );
}

export function PageNoticeView({ notice, onDismiss }: { notice: PageNotice; onDismiss: () => void }) {
  return (
    <Notice
      tone={notice.tone}
      title={notice.title}
      announce={notice.tone === 'danger' ? true : 'polite'}
      onDismiss={onDismiss}
      dismissLabel="Dismiss this notice"
    >
      <p className={s.noticeText}>{notice.message}</p>
      {notice.items.length > 0 ? (
        <ul className={s.noticeList}>
          {notice.items.map((item) => (
            <li key={item.id}>
              <span className={s.noticeItemTitle}>{item.title}</span>: {item.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </Notice>
  );
}
