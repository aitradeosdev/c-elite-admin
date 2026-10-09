import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { Skeleton } from './Misc';
import s from './Status.module.css';

export { formatNaira } from './money';

export type Tone = 'success' | 'warning' | 'danger' | 'purple' | 'info' | 'neutral';

export function statusTone(status: string): Tone {
  switch ((status || '').toLowerCase()) {
    case 'success':
    case 'completed':
    case 'approved':
    case 'active':
    case 'cleared':
      return 'success';
    case 'processing':
    case 'initiated':
    case 'pending':
    case 'pending_review':
    case 'held':
    case 'review':
    case 'disputed':
    case 'escalated':
      return 'warning';
    case 'failed':
    case 'resume_failed':
    case 'rejected':
    case 'dispute_resolved':
    case 'declined':
    case 'blocked':
    case 'frozen':
      return 'danger';
    case 'refunded':
      return 'purple';
    default:
      return 'neutral';
  }
}

export function toneColor(tone: Tone) {
  return tone === 'success' ? 'var(--tone-success-fg)'
    : tone === 'warning' ? 'var(--tone-warning-fg)'
    : tone === 'danger' ? 'var(--tone-danger-fg)'
    : tone === 'purple' ? 'var(--tone-purple-fg)'
    : tone === 'info' ? 'var(--tone-info-fg)'
    : 'var(--fg-secondary)';
}

export function statusLabel(status: string) {
  return (status || '—').replace(/_/g, ' ');
}

function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  success: s.toneSuccess,
  warning: s.toneWarning,
  danger: s.toneDanger,
  purple: s.tonePurple,
  info: s.toneInfo,
  neutral: s.toneNeutral,
};

export interface StatusDotProps {
  status: string;
  tone?: Tone;
  label?: ReactNode;
  className?: string;
}

export function StatusDot({ status, tone, label, className }: StatusDotProps) {
  const custom = hasContent(label);
  const classes = [
    s.statusDot,
    TONE_CLASS[tone ?? statusTone(status)] ?? s.toneNeutral,
    custom && s.statusDotCustom,
    className,
  ].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      <span className={s.dot} aria-hidden />
      {custom ? label : statusLabel(status)}
    </span>
  );
}

export type StatTone = 'neutral' | 'warning' | 'danger';

export interface StatItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
  href?: string;
  hint?: ReactNode;
  unavailable?: boolean;
  unavailableHint?: ReactNode;
  loading?: boolean;
  loadingWidth?: number | string;
  tone?: StatTone;
}

export interface StatCellProps extends StatItem {
  last?: boolean;
  className?: string;
}

const STAT_TONE_CLASS: Readonly<Record<StatTone, string | undefined>> = {
  neutral: undefined,
  warning: s.statValueWarning,
  danger: s.statValueDanger,
};

const STAT_UNAVAILABLE_HINT = 'This metric could not be loaded.';
const STAT_LOADING_WIDTH = '4em';

export function StatCell({
  label, value, mono, href, hint, unavailable, unavailableHint, loading, loadingWidth, tone, className,
}: StatCellProps) {
  const missing = !loading && Boolean(unavailable);
  const note = missing ? (unavailableHint ?? STAT_UNAVAILABLE_HINT) : hint;
  const valueClass = [
    s.statValue,
    !missing && mono && s.mono,
    !missing && tone && STAT_TONE_CLASS[tone],
  ].filter(Boolean).join(' ');
  const body = (
    <>
      <span className={s.statLabel}>{label}</span>
      <span className={valueClass}>
        {loading ? (
          <Skeleton inline width={loadingWidth ?? STAT_LOADING_WIDTH} />
        ) : missing ? (
          <span className={s.statUnavailable}>Unavailable</span>
        ) : (
          value
        )}
      </span>
      {hasContent(note) ? <span className={s.statHint}>{note}</span> : null}
    </>
  );
  if (href && !loading && !unavailable) {
    return (
      <Link href={href} className={[s.statCell, s.statCellLink, className].filter(Boolean).join(' ')}>
        {body}
      </Link>
    );
  }
  return <div className={[s.statCell, className].filter(Boolean).join(' ')}>{body}</div>;
}

export interface StatStripProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  items: readonly StatItem[];
  fill?: boolean;
  flush?: boolean;
}

export function StatStrip({
  items, fill, flush, className, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, ...rest
}: StatStripProps) {
  const classes = [s.statStrip, fill && s.statStripFill, flush && s.statStripFlush, className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      <ul className={s.statList} role="list" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>
        {items.map((item) => (
          <li key={item.label} className={s.statItem}>
            <StatCell {...item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DetailRow({
  label,
  value,
  bold,
  wrap,
  mono,
}: {
  label: string;
  value: ReactNode;
  bold?: boolean;
  wrap?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={s.detailRow}>
      <span className={s.detailLabel}>{label}</span>
      <span className={[s.detailValue, bold && s.detailBold, wrap && s.detailWrap, mono && s.mono].filter(Boolean).join(' ')}>
        {value ?? '—'}
      </span>
    </div>
  );
}

export type SectionLabelElement = 'p' | 'h2' | 'h3' | 'h4' | 'div';

export interface SectionLabelProps {
  children: ReactNode;
  style?: CSSProperties;
  id?: string;
  className?: string;
  as?: SectionLabelElement;
  flush?: boolean;
}

export function SectionLabel({ children, style, id, className, as: Tag = 'p', flush }: SectionLabelProps) {
  return (
    <Tag
      id={id}
      className={[s.sectionLabel, flush && s.sectionLabelFlush, className].filter(Boolean).join(' ')}
      style={style}
    >
      {children}
    </Tag>
  );
}
