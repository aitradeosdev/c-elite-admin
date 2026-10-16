'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Notice } from '../../_ui';
import {
  livePauseText, useRealtimeSignal, useRealtimeStatus, type RealtimeStatus, type SignalPause, type SignalTopic,
} from '../../_ui/realtime/RealtimeSignals';
import { BUSINESS_TZ_LABEL, formatBusinessTime } from '../../lib/time';
import { useServerRefresh } from './Refresh';
import s from './page.module.css';

export const SIGNAL_REFRESH_GAP_MS = 10000;

export const LIVE_NOTE = 'Updates live';

export interface RefreshEnvironment {
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isHidden: () => boolean;
}

export interface AutoRefreshProps {
  topics: readonly SignalTopic[];
  generatedAt: string;
}

const DEFAULT_ENVIRONMENT: RefreshEnvironment = {
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
};

const PAUSE_ORDER: readonly SignalPause[] = ['disabled', 'stopped', 'reconnecting'];

export class RefreshSchedule {
  private readonly refresh: () => void;
  private readonly env: RefreshEnvironment;
  private lastAt: number;
  private owed = false;
  private stopped = false;
  private timer: { handle: unknown; at: number } | null = null;

  constructor(refresh: () => void, environment: Partial<RefreshEnvironment> = {}) {
    this.refresh = refresh;
    this.env = { ...DEFAULT_ENVIRONMENT, ...environment };
    this.lastAt = this.env.now();
  }

  signal(): void {
    if (this.stopped) return;
    this.owed = true;
    this.run();
  }

  refreshed(): void {
    if (this.stopped) return;
    this.lastAt = this.env.now();
    this.run();
  }

  visibilityChanged(): void {
    this.run();
  }

  dispose(): void {
    this.stopped = true;
    this.clear();
  }

  private dueAt(): number | null {
    return this.owed ? this.lastAt + SIGNAL_REFRESH_GAP_MS : null;
  }

  private run(): void {
    if (this.stopped) return;
    if (this.env.isHidden()) {
      this.clear();
      return;
    }
    const due = this.dueAt();
    const now = this.env.now();
    if (due === null || now < due) {
      this.arm();
      return;
    }
    this.lastAt = now;
    this.owed = false;
    this.arm();
    this.refresh();
  }

  private arm(): void {
    const at = this.dueAt();
    if (this.timer && this.timer.at === at) return;
    this.clear();
    if (at === null) return;
    const timer: { handle: unknown; at: number } = { handle: null, at };
    timer.handle = this.env.setTimer(() => {
      if (this.timer !== timer) return;
      this.timer = null;
      this.run();
    }, Math.max(0, at - this.env.now()));
    this.timer = timer;
  }

  private clear(): void {
    const timer = this.timer;
    if (!timer) return;
    this.timer = null;
    this.env.clearTimer(timer.handle);
  }
}

export function overviewStatus(statuses: readonly RealtimeStatus[]): RealtimeStatus {
  const pause = PAUSE_ORDER.find((kind) => statuses.some((status) => status.pause === kind)) ?? null;
  return { live: statuses.length > 0 && statuses.every((status) => status.live), pause };
}

function useOverviewStatus(topics: readonly SignalTopic[]): RealtimeStatus {
  const withdrawals = topics.includes('withdrawals');
  const cards = topics.includes('cards');
  const withdrawalsStatus = useRealtimeStatus(withdrawals ? 'withdrawals' : null);
  const cardsStatus = useRealtimeStatus(cards ? 'cards' : null);
  return overviewStatus([
    ...(withdrawals ? [withdrawalsStatus] : []),
    ...(cards ? [cardsStatus] : []),
  ]);
}

export function UpdatedStamp({ topics, generatedAt }: AutoRefreshProps) {
  const { live } = useOverviewStatus(topics);
  return (
    <span className={s.updated} title={live ? LIVE_NOTE : undefined}>
      Updated {formatBusinessTime(generatedAt)} {BUSINESS_TZ_LABEL}
    </span>
  );
}

export default function AutoRefresh({ topics, generatedAt }: AutoRefreshProps) {
  const router = useRouter();
  const schedule = useRef<RefreshSchedule | null>(null);
  const { pending, refresh } = useServerRefresh(false, '');
  const { pause } = useOverviewStatus(topics);

  useEffect(() => {
    const next = new RefreshSchedule(() => router.refresh());
    schedule.current = next;
    const onVisibility = () => next.visibilityChanged();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      next.dispose();
      schedule.current = null;
    };
  }, [router]);

  useEffect(() => {
    schedule.current?.refreshed();
  }, [generatedAt]);

  const onSignal = () => schedule.current?.signal();
  useRealtimeSignal(topics.includes('withdrawals') ? 'withdrawals' : null, onSignal);
  useRealtimeSignal(topics.includes('cards') ? 'cards' : null, onSignal);

  if (!pause) return null;
  return (
    <Notice
      tone="warning"
      compact
      announce="polite"
      actions={<Button variant="ghost" size="sm" loading={pending} onClick={refresh}>Refresh</Button>}
    >
      {livePauseText(pause)}
    </Notice>
  );
}
