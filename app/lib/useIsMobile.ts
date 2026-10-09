'use client';

import { useCallback, useSyncExternalStore } from 'react';

export const BREAKPOINT_MOBILE = 768;
export const BREAKPOINT_DESKTOP = 1200;

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function subscribe(query: string) {
  return (onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  };
}

function useMediaQuery(query: string, serverValue: boolean): boolean {
  const sub = useCallback(subscribe(query), [query]);
  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return serverValue;
    return window.matchMedia(query).matches;
  }, [query, serverValue]);
  const getServerSnapshot = useCallback(() => serverValue, [serverValue]);
  return useSyncExternalStore(sub, getSnapshot, getServerSnapshot);
}

export function useIsMobile(breakpoint = BREAKPOINT_MOBILE): boolean {
  return useMediaQuery(`(max-width: ${breakpoint}px)`, false);
}

export function useIsDesktop(breakpoint = BREAKPOINT_DESKTOP): boolean {
  return useMediaQuery(`(min-width: ${breakpoint}px)`, true);
}

export function useBreakpoint(): Breakpoint {
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  if (isMobile) return 'mobile';
  return isDesktop ? 'desktop' : 'tablet';
}
