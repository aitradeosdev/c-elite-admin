'use client';

import { useEffect, useRef, type RefObject } from 'react';

export function isHashFor(hash: string, anchor: string): boolean {
  return hash === `#${anchor}`;
}

export function useHashFocus(anchor: string, ready: boolean, headingRef: RefObject<HTMLElement | null>): void {
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !ready) return;
    done.current = true;
    if (!isHashFor(window.location.hash, anchor)) return;
    document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
    headingRef.current?.focus({ preventScroll: true });
  }, [anchor, ready, headingRef]);
}
