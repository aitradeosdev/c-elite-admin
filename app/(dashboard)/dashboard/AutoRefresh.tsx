'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtimeSignal, type SignalTopic } from '../../_ui/realtime/RealtimeSignals';

export const SIGNAL_REFRESH_GAP_MS = 10000;

export interface RefreshEnvironment {
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isHidden: () => boolean;
}

export interface AutoRefreshProps {
  intervalMs?: number;
  topics: readonly SignalTopic[];
  generatedAt: string;
}

const DEFAULT_ENVIRONMENT: RefreshEnvironment = {
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
};

function periodOf(ms: number): number | null {
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export class RefreshSchedule {
  private readonly refresh: () => void;
  private readonly env: RefreshEnvironment;
  private readonly intervalMs: number | null;
  private lastAt: number;
  private owed = false;
  private stopped = false;
  private timer: { handle: unknown; at: number } | null = null;

  constructor(refresh: () => void, intervalMs: number, environment: Partial<RefreshEnvironment> = {}) {
    this.refresh = refresh;
    this.env = { ...DEFAULT_ENVIRONMENT, ...environment };
    this.intervalMs = periodOf(intervalMs);
    this.lastAt = this.env.now();
    this.run();
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
    const times: number[] = [];
    if (this.intervalMs !== null) times.push(this.lastAt + this.intervalMs);
    if (this.owed) times.push(this.lastAt + SIGNAL_REFRESH_GAP_MS);
    return times.length > 0 ? Math.min(...times) : null;
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

export default function AutoRefresh({ intervalMs = 30000, topics, generatedAt }: AutoRefreshProps) {
  const router = useRouter();
  const schedule = useRef<RefreshSchedule | null>(null);

  useEffect(() => {
    const next = new RefreshSchedule(() => router.refresh(), intervalMs);
    schedule.current = next;
    const onVisibility = () => next.visibilityChanged();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      next.dispose();
      schedule.current = null;
    };
  }, [router, intervalMs]);

  useEffect(() => {
    schedule.current?.refreshed();
  }, [generatedAt]);

  const onSignal = () => schedule.current?.signal();
  useRealtimeSignal(topics.includes('withdrawals') ? 'withdrawals' : null, onSignal);
  useRealtimeSignal(topics.includes('cards') ? 'cards' : null, onSignal);
  return null;
}
