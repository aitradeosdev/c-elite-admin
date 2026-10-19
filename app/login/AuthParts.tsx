'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ThemeSwitcher } from '../_ui/ThemeSwitcher';
import s from './login.module.css';

export interface AuthShellProps {
  headingId: string;
  foot?: string;
  children: ReactNode;
}

export function AuthShell({ headingId, foot, children }: AuthShellProps) {
  return (
    <main className={s.page}>
      <div className={s.themeSlot}>
        <ThemeSwitcher />
      </div>

      <section className={s.panel} aria-labelledby={headingId}>
        <header className={s.head}>
          <span className={s.mark} aria-hidden>CE</span>
          <div className={s.headText}>
            <h1 id={headingId} className={s.wordmark}>CardElite</h1>
            <p className={s.kicker}>Admin console</p>
          </div>
        </header>

        {children}

        {foot ? <p className={s.foot}>{foot}</p> : null}
      </section>
    </main>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className={s.formError} role="alert">
      <AlertTriangle size={15} className={s.formErrorIcon} aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function ButtonText({ working, idle, busy }: { working: boolean; idle: string; busy: string }) {
  if (!working) return <span>{idle}</span>;
  return (
    <>
      <Loader2 size={15} className={s.spin} aria-hidden />
      <span>{busy}</span>
    </>
  );
}
