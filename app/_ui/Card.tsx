import { HTMLAttributes, ReactNode } from 'react';
import s from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  /** Remove the rounded corners. Use when the card spans a full panel width. */
  flush?: boolean;
}

export function Card({ elevated, flush, className, ...rest }: CardProps) {
  const classes = [s.card, elevated && s.elevated, flush && s.flush, className].filter(Boolean).join(' ');
  return <div className={classes} {...rest} />;
}

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Drop the border-bottom separator. */
  bare?: boolean;
}

export function CardHeader({ title, subtitle, actions, bare, className, children, ...rest }: CardHeaderProps) {
  const classes = [s.header, bare && s.headerBare, className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {(title || subtitle) ? (
        <div className={s.titleRow}>
          {title ? <div className={s.title}>{title}</div> : null}
          {subtitle ? <div className={s.subtitle}>{subtitle}</div> : null}
        </div>
      ) : null}
      {children}
      {actions ? <div className={s.actions}>{actions}</div> : null}
    </div>
  );
}

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  /** Tighter padding for dense content like tables. */
  tight?: boolean;
  /** No padding. Use for embedded full-bleed tables. */
  flush?: boolean;
}

export function CardBody({ tight, flush, className, ...rest }: CardBodyProps) {
  const classes = [
    s.body,
    tight && s.bodyTight,
    flush && s.bodyFlush,
    className,
  ].filter(Boolean).join(' ');
  return <div className={classes} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[s.footer, className].filter(Boolean).join(' ')} {...rest} />;
}
