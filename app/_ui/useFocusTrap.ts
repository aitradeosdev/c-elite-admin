'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { focusableWithin, popOverlay, pushOverlay, restoreFocus, type OverlayOptions } from './overlayStack';

export { isTopmostTrap } from './overlayStack';
export type { OverlayOptions } from './overlayStack';

export interface FocusTrapOptions extends OverlayOptions {
  returnFocusTo?: () => HTMLElement | null;
}

export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape?: () => void,
  options?: FocusTrapOptions,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  const escapeRef = useRef(onEscape);
  const optionsRef = useRef(options);

  useEffect(() => {
    escapeRef.current = onEscape;
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = pushOverlay(root, () => escapeRef.current?.(), optionsRef.current);

    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    (focusableWithin(root)[0] ?? root).focus({ preventScroll: true });

    return () => {
      popOverlay(id);
      restoreFocus(restoreTo, optionsRef.current?.returnFocusTo);
    };
  }, [active]);

  return ref;
}
