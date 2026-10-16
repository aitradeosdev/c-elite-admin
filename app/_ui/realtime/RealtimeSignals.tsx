'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode,
} from 'react';
import { API_READ_TIMEOUT_MS, apiRequest } from '../../lib/apiClient';
import {
  SignalsEngine, type RealtimeSignal, type SignalPause, type SignalStatus, type SignalTopic,
} from './signalsCore';

export type {
  RealtimeSignal, SignalChange, SignalPause, SignalResync, SignalTable, SignalTopic,
} from './signalsCore';

export const REALTIME_PASS_PATH = '/api/realtime/pass';

export interface RealtimeSignalState {
  live: boolean;
}

export interface RealtimeStatus {
  live: boolean;
  pause: SignalPause | null;
}

export interface RealtimeSignalsProviderProps {
  children: ReactNode;
}

const SignalsContext = createContext<SignalsEngine | null>(null);

function createEngine(): SignalsEngine {
  return new SignalsEngine({
    fetchPass: () => apiRequest(REALTIME_PASS_PATH, { method: 'POST', timeoutMs: API_READ_TIMEOUT_MS }),
    loadTransport: async () => (await import('./supabaseTransport')).createSupabaseTransport(),
  });
}

const readOff = (): SignalStatus => 'off';

const readUnpaused = (): SignalPause | null => null;

export function RealtimeSignalsProvider({ children }: RealtimeSignalsProviderProps) {
  const [engine, setEngine] = useState<SignalsEngine | null>(null);

  useEffect(() => {
    const next = createEngine();
    setEngine(next);
    return () => next.dispose();
  }, []);

  return <SignalsContext.Provider value={engine}>{children}</SignalsContext.Provider>;
}

export function useRealtimeSignal(
  topic: SignalTopic | null,
  onSignal: (signal: RealtimeSignal) => void,
): RealtimeSignalState {
  const engine = useContext(SignalsContext);
  const handler = useRef(onSignal);

  useEffect(() => {
    handler.current = onSignal;
  });

  const watch = useCallback(
    (notify: () => void) => (engine && topic ? engine.watch(notify) : () => {}),
    [engine, topic],
  );
  const read = useCallback((): SignalStatus => (engine && topic ? engine.status(topic) : 'off'), [engine, topic]);
  const status = useSyncExternalStore(watch, read, readOff);

  useEffect(() => {
    if (!engine || !topic) return;
    return engine.subscribe(topic, (signal) => handler.current(signal));
  }, [engine, topic]);

  const live = status === 'live';
  return useMemo(() => ({ live }), [live]);
}

export function useRealtimeStatus(topic: SignalTopic | null): RealtimeStatus {
  const engine = useContext(SignalsContext);

  const watch = useCallback(
    (notify: () => void) => (engine && topic ? engine.watch(notify) : () => {}),
    [engine, topic],
  );
  const readStatus = useCallback((): SignalStatus => (engine && topic ? engine.status(topic) : 'off'), [engine, topic]);
  const readPause = useCallback((): SignalPause | null => (engine && topic ? engine.pause(topic) : null), [engine, topic]);
  const status = useSyncExternalStore(watch, readStatus, readOff);
  const pause = useSyncExternalStore(watch, readPause, readUnpaused);

  const live = status === 'live';
  return useMemo(() => ({ live, pause }), [live, pause]);
}

const LIVE_PAUSE_TEXT: Readonly<Record<SignalPause, string>> = {
  reconnecting: 'Live updates paused. Reconnecting…',
  disabled: 'Live updates are off. Use Refresh to see the latest.',
  stopped: 'Live updates paused. Use Refresh to see the latest.',
};

export function livePauseText(pause: SignalPause): string {
  return LIVE_PAUSE_TEXT[pause];
}
