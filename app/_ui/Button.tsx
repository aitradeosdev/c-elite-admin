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
  
  loading?: boolean;
  
  leftIcon?: ReactNode;
  
  rightIcon?: ReactNode;
  
  iconOnly?: boolean;
}

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
