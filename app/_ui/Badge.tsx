import { HTMLAttributes } from 'react';
import s from './Badge.module.css';

export type BadgeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'purple'
  | 'accent';
export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Show a coloured dot before the label. */
  dot?: boolean;
}

/**
 * Status pill. Use tone for semantic meaning, not aesthetics.
 *   success — completed / approved / active
 *   warning — pending / processing / needs attention
 *   danger  — failed / rejected / frozen
 *   info    — informational state
 *   purple  — refunded / reversed
 *   neutral — default / fallback
 *   accent  — brand-coloured one-off (use rarely)
 */
export function Badge({ tone = 'neutral', size = 'sm', dot, className, children, ...rest }: BadgeProps) {
  const sizeClass = size === 'md' ? s.md : size === 'lg' ? s.lg : '';
  const classes = [s.badge, s[tone], sizeClass, className].filter(Boolean).join(' ');
  return (
    <span className={classes} {...rest}>
      {dot ? <span className={s.dot} aria-hidden /> : null}
      {children}
    </span>
  );
}
