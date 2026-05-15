'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const COOKIE_NAME = 'admin_theme';
const COOKIE_MAX_AGE_DAYS = 365;

interface ThemeContextValue {
  mode: ThemeMode;          
  resolved: ResolvedTheme;  
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

async function persistThemeToServer(mode: ThemeMode): Promise<void> {
  try {
    await fetch('/api/admin/theme', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: mode }),
      credentials: 'same-origin',
    });
  } catch {  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {

  const [mode, setModeState] = useState<ThemeMode>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('light');

  useEffect(() => {
    const initial = readCookieTheme();
    setModeState(initial);
    setResolved(resolveTheme(initial));
  }, []);

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
    
    if (typeof document !== 'undefined') {
      document.documentElement.classList.add('theme-transitioning');
      window.setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
      }, 250);
    }
    applyTheme(r);
    
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
