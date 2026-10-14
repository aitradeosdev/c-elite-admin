'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '../_ui/Value';
import { COPY_STATUS_MS, COPY_STATUS_TEXT, type CopyState } from '../lib/adminSecurity';

export interface CopyStatus {
  state: CopyState;
  message: string;
  copy: (text: string) => Promise<boolean>;
}

export function useCopyStatus(resetMs: number = COPY_STATUS_MS): CopyStatus {
  const [state, setState] = useState<CopyState>('idle');
  const alive = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  const copy = useCallback(async (text: string) => {
    const copied = await copyToClipboard(text);
    if (!alive.current) return copied;
    setState(copied ? 'copied' : 'failed');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (alive.current) setState('idle');
    }, resetMs);
    return copied;
  }, [resetMs]);

  return { state, message: COPY_STATUS_TEXT[state], copy };
}

export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

export function downloadText(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
