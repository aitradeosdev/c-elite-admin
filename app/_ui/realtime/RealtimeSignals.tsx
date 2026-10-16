'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode,
} from 'react';
import { API_READ_TIMEOUT_MS, apiRequest } from '../../lib/apiClient';
import { SignalsEngine, type RealtimeSignal, type SignalStatus, type SignalTopic } from './signalsCore';

export type { RealtimeSignal, SignalChange, SignalResync, SignalTable, SignalTopic } from './signalsCore';

export const REALTIME_PASS_PATH = '/api/realtime/pass';

export interface RealtimeSignalState {
  live: boolean;
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
