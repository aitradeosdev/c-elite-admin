'use client';

// Theme system for the admin dashboard.
//
// Per-user, server-persisted theme:
//   - Stored on admin_users.theme_preference (DB)
//   - Mirrored to the `admin_theme` cookie so the server can set
//     <html data-theme="..."> during SSR (root layout reads the cookie)
//   - Cross-device: log in on a new browser/phone, the login API reads
//     the DB value and seeds the cookie before the first dashboard render
//
// Modes: 'light' | 'dark' | 'system'. 'system' is never the value of
// data-theme on <html> — it resolves to light/dark via matchMedia. Only
// the resolved value ever reaches the DOM.

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const COOKIE_NAME = 'admin_theme';
const COOKIE_MAX_AGE_DAYS = 365;

interface ThemeContextValue {
  mode: ThemeMode;          // what the user picked
  resolved: ResolvedTheme;  // what is actually applied right now
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readCookieTheme(): ThemeMode {
  if (typeof document === 'undefined') return 'system';
  const match = document.cookie.split('; ').find((p) => p.startsWith(COOKIE_NAME + '='));
  if (!match) return 'system';
  const raw = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
  return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system';
}

function writeCookieTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const maxAge = 60 * 60 * 24 * COOKIE_MAX_AGE_DAYS;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(mode)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
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

/**
 * Best-effort POST to the server. Theme persistence is server-of-truth,
 * but the cookie + DOM apply synchronously so a slow network never blocks
 * the UI. Failures are silently swallowed — the cookie still wins for the
 * current session, and the next page load will re-sync from the DB.
 */
async function persistThemeToServer(mode: ThemeMode): Promise<void> {
  try {
    await fetch('/api/admin/theme', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: mode }),
      credentials: 'same-origin',
    });
  } catch { /* swallow — cookie + UI are already updated */ }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initial state defaults to 'system' — overwritten on mount with the actual
  // cookie value. The DOM already has the right data-theme from SSR (root
  // layout read the cookie), so this state lag is invisible to the user.
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('light');

  // Hydrate from the cookie on mount.
  useEffect(() => {
    const initial = readCookieTheme();
    setModeState(initial);
    setResolved(resolveTheme(initial));
  }, []);

  // When mode is 'system', track OS preference changes live.
  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const next: ResolvedTheme = mql.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    writeCookieTheme(next);
    setModeState(next);
    const r = resolveTheme(next);
    setResolved(r);
    // Brief CSS-driven transition flash so the swap feels intentional.
    if (typeof document !== 'undefined') {
      document.documentElement.classList.add('theme-transitioning');
      window.setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
      }, 250);
    }
    applyTheme(r);
    // Fire-and-forget DB persistence so cross-device sync works.
    persistThemeToServer(next);
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
