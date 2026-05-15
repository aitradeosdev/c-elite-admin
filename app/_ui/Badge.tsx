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
  
  dot?: boolean;
}

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
