'use client';

// Theme system for the admin dashboard.
//
// Three modes: 'light' | 'dark' | 'system'. Persisted to localStorage as
// `cardelite-admin-theme`. When mode is 'system', listens to the OS preference
// and flips the resolved theme on change.
//
// The applied attribute is `data-theme="light|dark"` on <html>. Components
// never read 'system' — they only ever see the RESOLVED theme via this hook.
//
// Pre-paint FOUC prevention: ThemeScript() emits a tiny IIFE that runs in
// <head> before React hydrates and sets data-theme synchronously. Without it
// dark-mode users would see a white flash on every cold load.

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'cardelite-admin-theme';

interface ThemeContextValue {
  mode: ThemeMode;          // what the user picked
  resolved: ResolvedTheme;  // what is actually applied right now
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Inline script — emitted in <head> by RootLayout so it runs BEFORE first paint.
 * Reads the user's saved preference (or system fallback) and sets the
 * `data-theme` attribute on <html> so the right token set is in effect for
 * the very first frame. Without this, dark-mode users see a white flash.
 *
 * Wrapped in a try/catch because storage access can throw in private-mode
 * browsers; a failure just falls back to 'light'.
 */
export function ThemeScript() {
  const script = `(function(){try{var k="${STORAGE_KEY}";var s=localStorage.getItem(k);var sys=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=(s==="dark"||s==="light")?s:sys;document.documentElement.setAttribute("data-theme",r);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initial mode: from localStorage if set, else 'system'. We cannot read
  // localStorage during SSR, so initial render is always 'system' — the
  // inline ThemeScript has already applied the correct data-theme, so this
  // mismatch is invisible to the user.
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('light');

  // Hydrate from localStorage on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      const initialMode: ThemeMode = saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'system';
      setModeState(initialMode);
      setResolved(resolveTheme(initialMode));
    } catch {
      setResolved('light');
    }
  }, []);

  // When mode is 'system', track OS preference changes.
  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const next = mql.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };
    // Initial sync in case OS changed between mount and listener attach.
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore — non-persistent mode in private browsing */
    }
    setModeState(next);
    const r = resolveTheme(next);
    setResolved(r);
    // Briefly enable a CSS class on <html> that animates the theme swap so
    // the colour change feels intentional instead of jarring. Removed after
    // 250ms so it doesn't impose transitions on regular interactions.
    if (typeof document !== 'undefined') {
      document.documentElement.classList.add('theme-transitioning');
      window.setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
      }, 250);
    }
    applyTheme(r);
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be called inside <ThemeProvider>');
  }
  return ctx;
}
