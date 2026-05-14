import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import s from './Button.module.css';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'dangerSubtle'
  | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show a spinner and disable interactions while async work runs. */
  loading?: boolean;
  /** Leading icon node (typically a lucide-react icon). */
  leftIcon?: ReactNode;
  /** Trailing icon node. */
  rightIcon?: ReactNode;
  /** If true, render only a square button suitable for a single icon. */
  iconOnly?: boolean;
}

/**
 * Standard button used everywhere in the admin. Variants:
 *   primary     — single CTA on the screen (uses accent)
 *   secondary   — neutral surface, default for most actions
 *   ghost       — borderless, for toolbar / inline actions
 *   danger      — destructive confirm (filled red)
 *   dangerSubtle— destructive trigger (tinted red, escalates to filled on hover)
 *   success     — confirm with positive intent (rarely needed)
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, leftIcon, rightIcon, iconOnly, className, children, disabled, ...rest },
  ref,
) {
  const sizeClass = iconOnly
    ? size === 'sm' ? s.iconSm : size === 'lg' ? s.iconLg : s.iconMd
    : size === 'sm' ? s.sm : size === 'lg' ? s.lg : s.md;
  const classes = [s.btn, s[variant], sizeClass, className].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={s.spinner} aria-hidden /> : leftIcon ? <span className={s.icon}>{leftIcon}</span> : null}
      {!iconOnly && children}
      {rightIcon && !loading ? <span className={s.icon}>{rightIcon}</span> : null}
    </button>
  );
});
