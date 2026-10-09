'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, Lock, RotateCw } from 'lucide-react';
import { Button } from './Button';
import s from './States.module.css';

function labelOr(label: string | undefined, fallback: string): string {
  return label && label.trim() ? label : fallback;
}

export type RetryFocusPhase = 'idle' | 'armed' | 'waiting';

export function retryFocusStep(
  phase: RetryFocusPhase,
  retrying: boolean,
): { phase: RetryFocusPhase; restore: boolean } {
  if (phase === 'idle') return { phase, restore: false };
  if (retrying) return { phase: 'waiting', restore: false };
  return { phase: 'idle', restore: phase === 'waiting' };
}

export interface AccessDeniedProps {
  title?: string;
  message?: ReactNode;
  required?: string[];
  backHref?: string;
  backLabel?: string;
  className?: string;
}

export function AccessDenied({
  title = 'You do not have access to this page',
  message = 'Your account does not hold the permission this page requires. If you need it, ask a super administrator to grant it.',
  required,
  backHref = '/dashboard',
  backLabel,
  className,
}: AccessDeniedProps) {
  return (
    <div className={[s.wrap, className].filter(Boolean).join(' ')} role="alert">
      <div className={[s.icon, s.iconMuted].join(' ')}><Lock size={22} aria-hidden /></div>
      <h1 className={s.title}>{title}</h1>
      <p className={s.body}>{message}</p>
      {required?.length ? (
        <p className={s.meta}>
          Required: {required.map((r) => <code key={r} className={s.code}>{r}</code>)}
        </p>
      ) : null}
      <Link href={backHref} className={s.linkBtn}>{labelOr(backLabel, 'Back to dashboard')}</Link>
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message?: ReactNode;
  requestId?: string | null;
  detail?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  backHref?: string;
  backLabel?: string;
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message = "We couldn't load this section.",
  requestId,
  detail,
  onRetry,
  retrying = false,
  retryLabel,
  backHref,
  backLabel,
  compact,
  className,
}: ErrorStateProps) {
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const refocusRef = useRef<RetryFocusPhase>('idle');

  useEffect(() => {
    const step = retryFocusStep(refocusRef.current, retrying);
    refocusRef.current = step.phase;
    const button = retryRef.current;
    if (!step.restore || !button || button.disabled) return;
    const current = button.ownerDocument.activeElement;
    if (current && current !== button.ownerDocument.body) return;
    button.focus({ preventScroll: true });
  });

  const retry = () => {
    const button = retryRef.current;
    refocusRef.current = button && button.ownerDocument.activeElement === button ? 'armed' : 'idle';
    onRetry?.();
  };

  return (
    <div
      className={[s.wrap, compact && s.compact, retrying && s.retrying, className].filter(Boolean).join(' ')}
      role="alert"
      aria-busy={retrying || undefined}
    >
      <div className={[s.icon, s.iconDanger].join(' ')}><AlertTriangle size={22} aria-hidden /></div>
      {compact
        ? <h2 className={s.titleCompact}>{title}</h2>
        : <h1 className={s.title}>{title}</h1>}
      <p className={s.body}>{message}</p>
      {requestId ? (
        <p className={s.meta}>Request ID <code className={s.code}>{requestId}</code></p>
      ) : null}
      {detail ? <pre className={s.detail}>{detail}</pre> : null}
      <div className={s.actions}>
        {onRetry ? (
          <Button
            ref={retryRef}
            type="button"
            variant="primary"
            size="sm"
            leftIcon={<RotateCw size={14} aria-hidden className={retrying ? s.spin : undefined} />}
            disabled={retrying}
            aria-busy={retrying || undefined}
            onClick={retry}
          >
            {labelOr(retryLabel, 'Try again')}
          </Button>
        ) : null}
        {backHref ? (
          <Link href={backHref} className={s.linkBtnSubtle}>{labelOr(backLabel, 'Go to dashboard')}</Link>
        ) : null}
      </div>
    </div>
  );
}
