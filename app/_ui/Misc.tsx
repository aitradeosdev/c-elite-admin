'use client';

import {
  CSSProperties, FocusEvent, HTMLAttributes, ReactNode, createContext, useCallback, useContext, useEffect, useMemo,
  useRef, useState,
} from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import type { ButtonSize } from './Button';
import s from './Misc.module.css';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: number | string;
  height?: number | string;
  rounded?: boolean;
  inline?: boolean;
}

export function Skeleton({ width, height, rounded, inline, style, className, ...rest }: SkeletonProps) {
  const merged: CSSProperties = {
    width,
    height: height ?? (inline ? undefined : 14),
    borderRadius: rounded ? 'var(--radius-pill)' : undefined,
    ...style,
  };
  const classes = [s.skeleton, inline && s.skeletonInline, className].filter(Boolean).join(' ');
  if (inline) return <span aria-hidden className={classes} style={merged} {...rest} />;
  return <div aria-hidden className={classes} style={merged} {...rest} />;
}

const LINE_WIDTHS = ['82%', '64%', '91%', '55%', '73%', '68%'];

export interface SkeletonLinesProps {
  rows?: number;
  gap?: number;
  height?: number;
}

export function SkeletonLines({ rows = 3, gap, height = 13 }: SkeletonLinesProps) {
  const style = gap === undefined ? undefined : ({ '--skeleton-lines-gap': `${gap}px` } as CSSProperties);
  return (
    <div className={s.skeletonLines} style={style}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} width={LINE_WIDTHS[i % LINE_WIDTHS.length]} />
      ))}
    </div>
  );
}

export type EmptyStateVariant = 'card' | 'plain';

export interface EmptyStateProps {
  icon?: ReactNode;
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  className?: string;
  variant?: EmptyStateVariant;
}

export function EmptyState({ icon, title, hint, actions, className, variant = 'card' }: EmptyStateProps) {
  return (
    <div className={[s.empty, variant === 'plain' && s.emptyPlain, className].filter(Boolean).join(' ')}>
      {icon ? <div className={s.emptyIcon} aria-hidden>{icon}</div> : null}
      {title ? <div className={s.emptyTitle}>{title}</div> : null}
      {hint ? <div className={s.emptyHint}>{hint}</div> : null}
      {actions ? <div className={s.emptyActions}>{actions}</div> : null}
    </div>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={[s.pageHeader, className].filter(Boolean).join(' ')}>
      <div className={s.pageHeaderTitles}>
        <h1 className={s.pageTitle}>{title}</h1>
        {subtitle ? <p className={s.pageSubtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={s.pageHeaderActions}>{actions}</div> : null}
    </div>
  );
}

export interface PageHeaderSkeletonProps {
  titleWidth?: number | string;
  subtitle?: boolean;
  subtitleWidth?: number | string;
  actions?: number | ReadonlyArray<number | string>;
  actionSize?: ButtonSize;
  avatar?: boolean;
  label?: string;
  className?: string;
}

const ACTION_SKELETON_WIDTH = 88;
const ACTION_SKELETON_HEIGHT: Readonly<Record<ButtonSize, number>> = { sm: 28, md: 34, lg: 40 };

function actionWidths(actions: PageHeaderSkeletonProps['actions']): ReadonlyArray<number | string> {
  if (typeof actions === 'number') {
    const count = Number.isFinite(actions) ? Math.max(0, Math.floor(actions)) : 0;
    return Array.from({ length: count }, () => ACTION_SKELETON_WIDTH);
  }
  return actions ?? [];
}

export function PageHeaderSkeleton({
  titleWidth = '10em',
  subtitle = true,
  subtitleWidth = '20em',
  actions,
  actionSize = 'sm',
  avatar,
  label,
  className,
}: PageHeaderSkeletonProps) {
  const widths = actionWidths(actions);
  const actionHeight = ACTION_SKELETON_HEIGHT[actionSize] ?? ACTION_SKELETON_HEIGHT.sm;
  return (
    <div className={[s.pageHeader, className].filter(Boolean).join(' ')}>
      {label ? <span className={s.srOnly} role="status">{label}</span> : null}
      <div className={s.pageHeaderTitles} aria-hidden>
        <div className={s.pageTitle}>
          {avatar ? (
            <Skeleton inline rounded width="var(--space-8)" height="var(--space-8)" className={s.pageHeaderAvatar} />
          ) : null}
          <Skeleton inline width={titleWidth} />
        </div>
        {subtitle ? (
          <div className={s.pageSubtitle}>
            <Skeleton inline width={subtitleWidth} />
          </div>
        ) : null}
      </div>
      {widths.length > 0 ? (
        <div className={s.pageHeaderActions} aria-hidden>
          {widths.map((width, index) => (
            <Skeleton key={index} width={width} height={actionHeight} className={s.pageHeaderAction} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SectionTitle({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[s.sectionTitle, className].filter(Boolean).join(' ')} {...rest}>{children}</div>;
}

export type KpiTone = 'neutral' | 'warning' | 'danger';
export type KpiHintTone = 'neutral' | 'success' | 'warning' | 'danger';

const KPI_TONE_CLASS: Readonly<Record<KpiTone, string | undefined>> = {
  neutral: undefined,
  warning: s.kpiWarning,
  danger: s.kpiDanger,
};

const KPI_HINT_TONE_CLASS: Readonly<Record<KpiHintTone, string | undefined>> = {
  neutral: undefined,
  success: s.kpiHintSuccess,
  warning: s.kpiHintWarning,
  danger: s.kpiHintDanger,
};

export interface KpiProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  delta?: { value: ReactNode; direction: 'up' | 'down' };
  href?: string;
  unavailable?: boolean;
  unavailableHint?: ReactNode;
  className?: string;
  tone?: KpiTone;
  hintTone?: KpiHintTone;
}

export function Kpi({
  label, value, icon, hint, delta, href, unavailable, unavailableHint, className, tone = 'neutral', hintTone = 'neutral',
}: KpiProps) {
  const toneClass = KPI_TONE_CLASS[tone];
  const body = (
    <>
      <div className={s.kpiLabel}>
        {icon ? <span className={s.kpiIcon} aria-hidden>{icon}</span> : null}
        <span>{label}</span>
      </div>
      <div className={[s.kpiValue, unavailable && s.kpiUnavailable].filter(Boolean).join(' ')}>
        {unavailable ? 'Unavailable' : value}
      </div>
      {unavailable ? (
        <div className={s.kpiHint}>{unavailableHint ?? 'This metric could not be loaded.'}</div>
      ) : delta ? (
        <div className={[s.kpiDelta, delta.direction === 'up' ? s.up : s.down].join(' ')}>
          {delta.value}
        </div>
      ) : hint ? (
        <div className={[s.kpiHint, KPI_HINT_TONE_CLASS[hintTone]].filter(Boolean).join(' ')}>{hint}</div>
      ) : null}
    </>
  );

  if (href && !unavailable) {
    return (
      <Link href={href} className={[s.kpi, s.kpiLink, toneClass, className].filter(Boolean).join(' ')}>
        {body}
      </Link>
    );
  }
  return <div className={[s.kpi, toneClass, className].filter(Boolean).join(' ')}>{body}</div>;
}

export function KpiGrid({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[s.kpiGrid, className].filter(Boolean).join(' ')} {...rest}>{children}</div>;
}

export function KpiSkeleton() {
  return (
    <div className={s.kpi}>
      <Skeleton width="52%" height={11} />
      <Skeleton width="68%" height={24} />
    </div>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <span className={[s.spinner, className].filter(Boolean).join(' ')} style={{ width: size, height: size }} role="img" aria-label="Loading" />;
}

export type ToastTone = 'default' | 'success' | 'error' | 'warning';
export type ToastPoliteness = 'polite' | 'assertive';

const TOAST_DURATION_MS: Readonly<Record<ToastTone, number>> = {
  default: 3500,
  success: 3500,
  warning: 8000,
  error: 8000,
};

export function toastDuration(tone: ToastTone): number {
  return TOAST_DURATION_MS[tone] ?? TOAST_DURATION_MS.default;
}

export function toastPoliteness(tone: ToastTone): ToastPoliteness {
  return tone === 'error' ? 'assertive' : 'polite';
}

export interface PausableTimer {
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}

export function startPausableTimer(onExpire: () => void, ms: number): PausableTimer {
  let remaining = Math.max(0, ms);
  let startedAt = 0;
  let handle: ReturnType<typeof setTimeout> | null = null;
  let finished = false;
  const run = () => {
    startedAt = Date.now();
    handle = setTimeout(() => {
      handle = null;
      finished = true;
      onExpire();
    }, remaining);
  };
  run();
  return {
    pause: () => {
      if (finished || handle === null) return;
      clearTimeout(handle);
      handle = null;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    },
    resume: () => {
      if (finished || handle !== null) return;
      run();
    },
    cancel: () => {
      if (handle !== null) clearTimeout(handle);
      handle = null;
      finished = true;
    },
  };
}

export type ToastHoverEvent = 'enter' | 'leave' | 'dismiss';

export function toastHoverAfter(current: number | null, id: number, event: ToastHoverEvent): number | null {
  if (event === 'enter') return id;
  return current === id ? null : current;
}

export function toastFocusTarget<T>(closers: readonly T[], origin: T, fallback: T | null): T | null {
  const index = closers.indexOf(origin);
  if (index < 0) return fallback;
  return closers[index + 1] ?? closers[index - 1] ?? fallback;
}

function focusCameFromKeyboard(element: HTMLElement): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

const TOAST_TONE_CLASS: Readonly<Record<ToastTone, string | undefined>> = {
  default: undefined,
  success: s.toastSuccess,
  error: s.toastError,
  warning: s.toastWarning,
};

export interface ToastCardProps {
  id: number;
  tone: ToastTone;
  text: string;
  paused: boolean;
  onDismiss: (id: number, origin?: HTMLElement) => void;
  onHover?: (id: number, event: ToastHoverEvent) => void;
}

export function ToastCard({ id, tone, text, paused, onDismiss, onHover }: ToastCardProps) {
  const timer = useRef<PausableTimer | null>(null);

  useEffect(() => {
    const current = startPausableTimer(() => onDismiss(id), toastDuration(tone));
    timer.current = current;
    return () => {
      current.cancel();
      if (timer.current === current) timer.current = null;
    };
  }, [id, tone, onDismiss]);

  useEffect(() => {
    if (paused) timer.current?.pause();
    else timer.current?.resume();
  }, [paused]);

  return (
    <div
      className={[s.toast, TOAST_TONE_CLASS[tone]].filter(Boolean).join(' ')}
      onPointerEnter={onHover ? () => onHover(id, 'enter') : undefined}
      onPointerLeave={onHover ? () => onHover(id, 'leave') : undefined}
    >
      <span className={s.toastText}>{text}</span>
      <button
        type="button"
        className={s.toastClose}
        aria-label="Dismiss notification"
        data-toast-close=""
        onClick={(event) => onDismiss(id, event.currentTarget)}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
}

interface ToastContextValue {
  show: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const NOOP_TOAST: ToastContextValue = { show: () => {} };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const idRef = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const show = useCallback((text: string, tone: ToastTone = 'default') => {
    const id = ++idRef.current;
    setItems((prev) => [...prev, { id, tone, text }]);
  }, []);

  const hover = useCallback((id: number, event: ToastHoverEvent) => {
    setHoveredId((current) => toastHoverAfter(current, id, event));
  }, []);

  const dismiss = useCallback((id: number, origin?: HTMLElement) => {
    const wrap = wrapRef.current;
    if (wrap && origin && origin.ownerDocument.activeElement === origin && focusCameFromKeyboard(origin)) {
      const closers = Array.from(wrap.querySelectorAll<HTMLElement>('[data-toast-close]'));
      const back = returnFocusRef.current;
      const target = toastFocusTarget(closers, origin, back && back.isConnected ? back : null);
      target?.focus();
    }
    setHoveredId((current) => toastHoverAfter(current, id, 'dismiss'));
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap && !wrap.contains(wrap.ownerDocument.activeElement)) setFocused(false);
  }, [items]);

  const onFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !event.currentTarget.contains(from)) returnFocusRef.current = from;
    setFocused(true);
  }, []);

  const onBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const to = event.relatedTarget;
    if (!(to instanceof Node) || !event.currentTarget.contains(to)) setFocused(false);
  }, []);

  const toastValue = useMemo(() => ({ show }), [show]);
  const paused = hoveredId !== null || focused;

  const card = (item: ToastItem) => (
    <ToastCard
      key={item.id}
      id={item.id}
      tone={item.tone}
      text={item.text}
      paused={paused}
      onDismiss={dismiss}
      onHover={hover}
    />
  );

  return (
    <ToastContext.Provider value={toastValue}>
      {children}
      <div ref={wrapRef} className={s.toastWrap} onFocus={onFocus} onBlur={onBlur}>
        <div className={s.toastStack} aria-live="polite">
          {items.filter((item) => toastPoliteness(item.tone) === 'polite').map(card)}
        </div>
        <div className={s.toastStack} aria-live="assertive">
          {items.filter((item) => toastPoliteness(item.tone) === 'assertive').map(card)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext) ?? NOOP_TOAST;
}
