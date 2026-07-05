'use client';

import { useEffect } from 'react';

/**
 * Hard-disables page zoom everywhere. iOS Safari ignores the viewport
 * `maximum-scale` / `user-scalable=no`, so pinch-zoom must be blocked in JS
 * via the iOS-only gesture events. Also blocks desktop ctrl/⌘ + wheel and
 * ctrl/⌘ +/-/0 zoom. Single-finger scrolling is unaffected.
 */
export function NoZoom() {
  useEffect(() => {
    const prevent = (e: Event) => { e.preventDefault(); };

    // iOS Safari pinch-zoom
    document.addEventListener('gesturestart', prevent, { passive: false });
    document.addEventListener('gesturechange', prevent, { passive: false });
    document.addEventListener('gestureend', prevent, { passive: false });

    // desktop trackpad / ctrl+wheel zoom
    const onWheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    window.addEventListener('wheel', onWheel, { passive: false });

    // desktop keyboard zoom (ctrl/⌘ with +, -, =, 0)
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('gesturestart', prevent);
      document.removeEventListener('gesturechange', prevent);
      document.removeEventListener('gestureend', prevent);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return null;
}
