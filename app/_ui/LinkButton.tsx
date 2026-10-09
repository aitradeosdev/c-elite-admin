import { AnchorHTMLAttributes, forwardRef, ReactNode } from 'react';
import Link, { type LinkProps } from 'next/link';
import type { ButtonSize, ButtonVariant } from './Button';
import s from './Button.module.css';

interface LinkButtonBaseProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  prefetch?: LinkProps['prefetch'];
  replace?: boolean;
  scroll?: boolean;
  external?: boolean;
}

export type LinkButtonProps = LinkButtonBaseProps & (
  | { iconOnly: true; 'aria-label': string }
  | { iconOnly?: false }
);

const NEW_TAB_HINT = ' (opens in a new tab)';

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  {
    href, variant = 'secondary', size = 'md', leftIcon, rightIcon, iconOnly, external, prefetch, replace, scroll,
    className, children, ...rest
  },
  ref,
) {
  const sizeClass = iconOnly
    ? size === 'sm' ? s.iconSm : size === 'lg' ? s.iconLg : s.iconMd
    : size === 'sm' ? s.sm : size === 'lg' ? s.lg : s.md;
  const classes = [s.btn, s[variant], sizeClass, s.link, className].filter(Boolean).join(' ');
  const named = Boolean(rest['aria-label'] || rest['aria-labelledby']);
  const content = (
    <>
      {leftIcon ? <span className={s.icon}>{leftIcon}</span> : null}
      {iconOnly ? null : children}
      {rightIcon ? <span className={s.icon}>{rightIcon}</span> : null}
      {external && !iconOnly && !named ? <span className={s.srOnly}>{NEW_TAB_HINT}</span> : null}
    </>
  );

  if (external) {
    return (
      <a ref={ref} {...rest} href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {content}
      </a>
    );
  }
  return (
    <Link ref={ref} {...rest} href={href} prefetch={prefetch} replace={replace} scroll={scroll} className={classes}>
      {content}
    </Link>
  );
});
