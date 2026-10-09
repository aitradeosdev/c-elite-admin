import type { ReactNode } from 'react';
import { Money, StatusDot, type TableSkeletonColumn } from '../../_ui';
import { formatCount, plural } from './couponRules';
import { usesText, type CouponRow, type CouponStatus, type ExpiryView, type TermsChange } from './model';
import s from './page.module.css';

export const SKELETON_COLUMNS: readonly TableSkeletonColumn[] = [
  { width: 120, lines: 2 },
  { width: 110 },
  { width: 92, align: 'right' },
  { width: 84, align: 'right' },
  { width: 64, align: 'right', lines: 2 },
  { width: 110, lines: 2 },
  { width: 84 },
  { width: 96, align: 'right', button: true },
];

export function Change({ before, after, mono }: { before: ReactNode; after: ReactNode; mono?: boolean }) {
  return (
    <span className={mono ? `${s.change} ${s.mono}` : s.change}>
      <span className={s.changeBefore}>{before}</span>
      <span className={s.changeArrow} aria-hidden>→</span>
      <span className={s.srOnly}> changes to </span>
      <span className={s.changeAfter}>{after}</span>
    </span>
  );
}

export function MoneyChange({ before, after }: { before: number; after: number }) {
  return <Change before={<Money value={before} />} after={<Money value={after} emphasis="strong" />} />;
}

export function StatusCell({ status }: { status: CouponStatus }) {
  return <StatusDot status={status.state} tone={status.tone} label={status.label} />;
}

export function CodeCell({ row }: { row: CouponRow }) {
  return (
    <div className={s.stack}>
      <span className={s.code}>{row.code || '—'}</span>
      {row.restrictTo ? <span className={s.sub}>Needs an approved {row.restrictTo} trade</span> : null}
    </div>
  );
}

export function BrandCell({ row, available }: { row: CouponRow; available: boolean | null }) {
  return (
    <div className={s.stack}>
      <span className={row.type ? s.brand : s.muted}>{row.type || 'No brand'}</span>
      {available === false ? <span className={s.warnText}>Not an active brand</span> : null}
    </div>
  );
}

export function UsesCell({ row }: { row: CouponRow }) {
  const awaiting = row.awaitingTrades ?? 0;
  return (
    <div className={`${s.stack} ${s.alignEnd}`}>
      <span className={s.figure}>{usesText(row)}</span>
      {awaiting > 0 ? <span className={s.sub}>{formatCount(awaiting)} awaiting review</span> : null}
    </div>
  );
}

export function ExpiryCell({ view }: { view: ExpiryView }) {
  return (
    <div className={s.stack}>
      <span className={s.time}>{view.date}</span>
      <span className={s.sub}>{view.relative}</span>
    </div>
  );
}

function TermList({ terms, sign, label }: { terms: readonly string[]; sign: '+' | '−'; label: string }) {
  return (
    <ul className={s.diffList} aria-label={label}>
      {terms.map((term) => (
        <li key={term} className={s.diffItem}>
          <span className={s.diffSign} aria-hidden>{sign}</span>
          <span className={s.diffText}>{term}</span>
        </li>
      ))}
    </ul>
  );
}

export function TermsDiff({ change }: { change: TermsChange }) {
  return (
    <div className={s.diff}>
      {change.added.length ? (
        <section className={s.diffSection}>
          <h3 className={s.diffTitle}>Adding · {formatCount(change.added.length)}</h3>
          <TermList terms={change.added} sign="+" label="Terms being added" />
        </section>
      ) : null}
      {change.removed.length ? (
        <section className={s.diffSection}>
          <h3 className={s.diffTitle}>Removing · {formatCount(change.removed.length)}</h3>
          <TermList terms={change.removed} sign="−" label="Terms being removed" />
        </section>
      ) : null}
    </div>
  );
}

export function changeSummary(change: TermsChange): string {
  const parts: string[] = [];
  if (change.added.length) parts.push(`${formatCount(change.added.length)} added`);
  if (change.removed.length) parts.push(`${formatCount(change.removed.length)} removed`);
  return parts.length ? `${parts.join(' · ')}, not saved yet` : '';
}

export function usedText(uses: number): string {
  return uses === 0 ? 'Not used yet' : `Used ${plural(uses, 'time', 'times')}`;
}
