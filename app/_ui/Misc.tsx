'use client';

import { CSSProperties, HTMLAttributes, ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import s from './Misc.module.css';

/* ============================================================
 * Skeleton — block placeholder shown while data loads
 * ============================================================ */
export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: number | string;
  height?: number | string;
  rounded?: boolean;
}
export function Skeleton({ width, height = 14, rounded, style, className, ...rest }: SkeletonProps) {
  const merged: CSSProperties = {
    width,
    height,
    borderRadius: rounded ? 999 : undefined,
    ...style,
  };
  return <div className={[s.skeleton, className].filter(Boolean).join(' ')} style={merged} {...rest} />;
}

/* ============================================================
 * EmptyState — centered "no data" with optional icon + actions
 * ============================================================ */
export interface EmptyStateProps {
  icon?: ReactNode;
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  className?: string;
}
export function EmptyState({ icon, title, hint, actions, className }: EmptyStateProps) {
  return (
    <div className={[s.empty, className].filter(Boolean).join(' ')}>
      {icon ? <div className={s.emptyIcon}>{icon}</div> : null}
      {title ? <div className={s.emptyTitle}>{title}</div> : null}
      {hint ? <div className={s.emptyHint}>{hint}</div> : null}
      {actions ? <div className={s.emptyActions}>{actions}</div> : null}
    </div>
  );
}

/* ============================================================
 * PageHeader — title + subtitle + actions, top of every page
 * ============================================================ */
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

/* ============================================================
 * SectionTitle — small label preceding a Card / group
 * ============================================================ */
export function SectionTitle({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[s.sectionTitle, className].filter(Boolean).join(' ')} {...rest}>{children}</div>;
}

/* ============================================================
 * KPI — single big-number stat tile
 * ============================================================ */
export interface KpiProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  delta?: { value: ReactNode; direction: 'up' | 'down' };
  className?: string;
}
export function Kpi({ label, value, icon, hint, delta, className }: KpiProps) {
  return (
    <div className={[s.kpi, className].filter(Boolean).join(' ')}>
      <div className={s.kpiLabel}>
        {icon}
        <span>{label}</span>
      </div>
      <div className={s.kpiValue}>{value}</div>
      {delta ? (
        <div className={[s.kpiDelta, delta.direction === 'up' ? s.up : s.down].join(' ')}>
          {delta.value}
        </div>
      ) : hint ? (
        <div className={s.kpiHint}>{hint}</div>
      ) : null}
    </div>
  );
}
export function KpiGrid({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[s.kpiGrid, className].filter(Boolean).join(' ')} {...rest}>{children}</div>;
}

/* ============================================================
 * Spinner — small inline loading indicator
 * ============================================================ */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <span className={[s.spinner, className].filter(Boolean).join(' ')} style={{ width: size, height: size }} aria-label="Loading" />;
}

/* ============================================================
 * Toast — flash messages via useToast()
 * ============================================================ */
export type ToastTone = 'default' | 'success' | 'error' | 'warning';
interface ToastItem { id: number; tone: ToastTone; text: string; }

interface ToastContextValue {
  show: (text: string, tone?: ToastTone) => void;
}
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const show = useCallback((text: string, tone: ToastTone = 'default') => {
    const id = ++idRef.current;
    setItems((prev) => [...prev, { id, tone, text }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className={s.toastWrap} aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={[
              s.toast,
              t.tone === 'success' && s.toastSuccess,
              t.tone === 'error' && s.toastError,
              t.tone === 'warning' && s.toastWarning,
            ].filter(Boolean).join(' ')}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Defensive fallback so a page that calls useToast outside the provider
    // tree (e.g. an error page) doesn't crash — it just no-ops.
    return { show: () => {} } as ToastContextValue;
  }
  return ctx;
}
