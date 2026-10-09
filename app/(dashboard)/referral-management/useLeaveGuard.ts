'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { leavePath } from './model';

export function useLeaveGuard(active: boolean, confirmLeave: () => Promise<boolean>): void {
  const router = useRouter();
  const confirmRef = useRef(confirmLeave);
  const leavingRef = useRef(false);

  useEffect(() => {
    confirmRef.current = confirmLeave;
  });

  useEffect(() => {
    if (!active) return;
    leavingRef.current = false;

    const warn = (event: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    const intercept = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const path = leavePath(anchor.href, window.location.href);
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmRef.current().then((leave) => {
        if (!leave) return;
        leavingRef.current = true;
        router.push(path);
      });
    };

    window.addEventListener('beforeunload', warn);
    window.addEventListener('click', intercept, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('click', intercept, true);
    };
  }, [active, router]);
}
