'use client';

import type { ReactNode, RefObject } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Avatar, Button, Notice } from '../../_ui';
import { formatCount } from './rewardRules';
import type { PageNotice, Phase } from './model';
import s from './page.module.css';

export function DiffValue({ from, to, mono }: { from: ReactNode; to: ReactNode; mono?: boolean }) {
  return (
    <span className={s.diff}>
      <span className={s.srOnly}>From </span>
      <span className={[s.diffFrom, mono && s.mono].filter(Boolean).join(' ')}>{from}</span>
      <span className={s.diffArrow} aria-hidden>→</span>
      <span className={s.srOnly}> to </span>
      <span className={[s.diffTo, mono && s.mono].filter(Boolean).join(' ')}>{to}</span>
    </span>
  );
}

export function ListDiff({ from, to }: { from: readonly string[]; to: readonly string[] }) {
  return (
    <span className={s.listDiff}>
      <span className={s.listDiffBlock}>
        <span className={s.listDiffLabel}>Before</span>
        <span className={s.listDiffItems} role="list">
          {from.map((line, index) => <span key={index} role="listitem" className={s.diffFrom}>{line}</span>)}
        </span>
      </span>
      <span className={s.listDiffBlock}>
        <span className={s.listDiffLabel}>After</span>
        <span className={s.listDiffItems} role="list">
          {to.map((line, index) => <span key={index} role="listitem" className={s.diffTo}>{line}</span>)}
        </span>
      </span>
    </span>
  );
}

export function RuleLines({ lines }: { lines: readonly string[] }) {
  return (
    <span className={s.ruleLines} role="list">
      {lines.map((line, index) => <span key={index} role="listitem" className={s.ruleLine}>{line}</span>)}
    </span>
  );
}

export function BadgeDiff({ from, to, name }: { from: string | null; to: string | null; name: string }) {
  const describe = (url: string | null) => (url ? 'Badge image' : 'No badge');
  return (
    <span className={s.badgeDiff}>
      <span className={s.badgeDiffSide}>
        <Avatar src={from} name={name} size="lg" decorative className={s.badgeThumb} />
        <span className={s.diffFrom}>{describe(from)}</span>
      </span>
      <span className={s.diffArrow} aria-hidden>→</span>
      <span className={s.srOnly}> changes to </span>
      <span className={s.badgeDiffSide}>
        <Avatar src={to} name={name} size="lg" decorative className={s.badgeThumb} />
        <span className={s.diffTo}>{to ? (from ? 'New badge image' : 'Badge image') : 'No badge'}</span>
      </span>
    </span>
  );
}

export function UnsavedMark({ label = 'Unsaved' }: { label?: string }) {
  return (
    <span className={s.unsaved}>
      <span className={s.unsavedDot} aria-hidden />
      {label}
    </span>
  );
}

export function changeCountText(total: number): string {
  return total === 1 ? '1 unsaved change' : `${formatCount(total)} unsaved changes`;
}

export interface UnsavedBarProps {
  count: number;
  issues: number;
  phase: Phase;
  label: string;
  reviewRef?: RefObject<HTMLButtonElement | null>;
  onDiscard: () => void;
  onReview: () => void;
}

export function UnsavedBar({ count, issues, phase, label, reviewRef, onDiscard, onReview }: UnsavedBarProps) {
  const busy = phase !== 'idle';
  const working = phase === 'checking' || phase === 'saving';
  const status = phase === 'checking'
    ? 'Checking the live values…'
    : phase === 'saving'
      ? 'Saving…'
      : changeCountText(count);
  const action = phase === 'checking' ? 'Checking…' : phase === 'saving' ? 'Saving…' : 'Review changes';
  return (
    <div className={s.bar} role="region" aria-label={label}>
      <p className={s.barStatus} role="status">
        <span className={s.barDot} aria-hidden />
        <span>{status}</span>
        {issues > 0 && !working ? <span className={s.barIssues}>{formatCount(issues)} to fix</span> : null}
      </p>
      <div className={s.barActions}>
        <Button type="button" variant="ghost" aria-disabled={busy || undefined} onClick={onDiscard}>
          Discard
        </Button>
        <Button
          ref={reviewRef}
          type="button"
          variant="primary"
          aria-disabled={busy || undefined}
          aria-busy={working || undefined}
          leftIcon={working ? <LoaderCircle size={14} aria-hidden className={s.spin} /> : undefined}
          onClick={onReview}
        >
          {action}
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

export function SectionHeading({ id, title, hint, actions }: { id: string; title: string; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={s.sectionHead}>
      <div className={s.sectionTitles}>
        <h2 id={id} className={s.sectionTitle}>{title}</h2>
        {hint ? <p className={s.sectionHint}>{hint}</p> : null}
      </div>
      {actions ? <div className={s.sectionActions}>{actions}</div> : null}
    </div>
  );
}
