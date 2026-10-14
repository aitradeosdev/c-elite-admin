'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { configureApiClient } from '../lib/apiClient';
import { Modal } from './Overlay';
import { Button } from './Button';
import s from './SessionExpired.module.css';

export const SESSION_EXPIRED_EVENT = 'cardelite:session-expired';

export function notifySessionExpired() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

function isAdminApi(input: RequestInfo | URL): boolean {
  try {
    const raw =
      typeof input === 'string' ? input
        : input instanceof URL ? input.href
        : input.url;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return false;
    if (!url.pathname.startsWith('/api/')) return false;
    return url.pathname !== '/api/auth' && !url.pathname.startsWith('/api/auth/');
  } catch {
    return false;
  }
}

export function SessionExpiredHandler() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const patched = useRef(false);

  useEffect(() => {
    const onExpired = () => setOpen(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => configureApiClient({ onAuthExpired: notifySessionExpired }), []);

  useEffect(() => {
    if (patched.current) return;
    patched.current = true;
    const original = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await original(input, init);
      if (res.status === 401 && isAdminApi(input)) notifySessionExpired();
      return res;
    };
    return () => {
      window.fetch = original;
      patched.current = false;
    };
  }, []);

  const signIn = useCallback(() => {
    const next = encodeURIComponent(pathname || '/dashboard');
    window.location.href = `/login?next=${next}`;
  }, [pathname]);

  if (!open) return null;

  return (
    <Modal
      open
      static
      hideClose
      size="sm"
      onClose={() => {}}
      title="Your session has expired"
      footer={<Button variant="primary" onClick={signIn}>Sign in again</Button>}
    >
      <p className={s.message}>
        For security, admin sessions end 8 hours after you sign in. A session also ends early if it is
        signed out from Signed-in devices, if you sign out everywhere or change your password on another
        device, or if a super administrator changes your access, resets your two-step sign-in or signs you
        out. Sign in again and you will come back to this page.
      </p>
    </Modal>
  );
}
