'use client';

import {
  FocusEvent, HTMLAttributes, MouseEvent, ReactNode, RefObject,
  forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef,
} from 'react';
import { focusableWithin, popOverlay, pushOverlay } from './overlayStack';
import s from './Popover.module.css';

export type PopoverAlign = 'start' | 'end';
export type PopoverWidth = 'auto' | 'anchor';
export type PopoverSide = 'bottom' | 'top';
export type PopoverRole = 'dialog' | 'menu' | 'listbox';
export type PopoverInitialFocus = 'first' | 'panel' | 'none';
export type PopoverDismissReason = 'escape' | 'outside' | 'scroll';

const GAP = 4;
const MARGIN = 8;
const MIN_HEIGHT = 120;

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function viewportBox(): Box {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const top = vv ? Math.max(0, vv.offsetTop) : 0;
  const bottom = vv ? Math.min(root.clientHeight, vv.offsetTop + vv.height) : root.clientHeight;
  return { top, bottom, left: 0, right: root.clientWidth };
}

function clippingAncestors(el: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)) found.push(node);
    if (style.position === 'fixed') break;
  }
  return found;
}

function outside(rect: DOMRect, box: Box): boolean {
  return rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right;
}

function anchorHidden(rect: DOMRect, clippers: HTMLElement[], view: Box): boolean {
  if (rect.width === 0 && rect.height === 0) return true;
  if (outside(rect, view)) return true;
  return clippers.some((el) => outside(rect, el.getBoundingClientRect()));
}

export interface PopoverPanelProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onDismiss?: (reason: PopoverDismissReason) => void;
  align?: PopoverAlign;
  width?: PopoverWidth;
  closeOnEscape?: boolean;
}

export const PopoverPanel = forwardRef<HTMLDivElement, PopoverPanelProps>(function PopoverPanel(
  { open, anchorRef, onDismiss, align = 'start', width = 'auto', closeOnEscape = true, className, children, ...rest },
  ref,
) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  const setPanelRef = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const dismiss = (reason: PopoverDismissReason) => dismissRef.current?.(reason);
    const overlayId = closeOnEscape
      ? pushOverlay(panel, () => dismiss('escape'), { lockScroll: false, trapFocus: false })
      : null;

    const anchor = anchorRef.current;
    const clippers = anchor ? clippingAncestors(anchor) : [];
    let side: PopoverSide = 'bottom';
    let measured = { panelWidth: -1, panelHeight: -1, anchorWidth: -1, anchorHeight: -1 };

    const place = (checkClip: boolean) => {
      const target = anchorRef.current;
      const probe = probeRef.current;
      if (!target || !probe) return;
      const rect = target.getBoundingClientRect();
      const view = viewportBox();
      if (checkClip && anchorHidden(rect, clippers, view)) {
        dismiss('scroll');
        return;
      }

      panel.style.setProperty('--popover-anchor-width', `${rect.width}px`);
      panel.style.removeProperty('--popover-available-height');
      const natural = panel.offsetHeight;
      const below = view.bottom - rect.bottom - GAP - MARGIN;
      const above = rect.top - view.top - GAP - MARGIN;
      if (side === 'bottom' && natural > below && above > below) side = 'top';
      else if (side === 'top' && natural > above && below >= above) side = 'bottom';

      const room = side === 'bottom' ? below : above;
      const limit = Math.min(Math.max(room, MIN_HEIGHT), view.bottom - view.top - MARGIN * 2);
      panel.style.setProperty('--popover-available-height', `${Math.max(limit, 0)}px`);

      const height = panel.offsetHeight;
      const panelWidth = panel.offsetWidth;
      const preferredTop = side === 'bottom' ? rect.bottom + GAP : rect.top - GAP - height;
      const top = Math.max(view.top + MARGIN, Math.min(preferredTop, view.bottom - MARGIN - height));
      const preferredLeft = align === 'end' ? rect.right - panelWidth : rect.left;
      const left = Math.max(view.left + MARGIN, Math.min(preferredLeft, view.right - MARGIN - panelWidth));
      const origin = probe.getBoundingClientRect();

      panel.style.top = `${Math.round(top - origin.top)}px`;
      panel.style.left = `${Math.round(left - origin.left)}px`;
      panel.dataset.side = side;
      measured = { panelWidth, panelHeight: height, anchorWidth: rect.width, anchorHeight: rect.height };
    };

    place(false);

    const onScroll = (event: Event) => {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      place(true);
    };
    const onResize = () => place(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.contains(target) || anchorRef.current?.contains(target)) return;
      dismiss('outside');
    };

    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);
    document.addEventListener('pointerdown', onPointerDown, true);

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          const target = anchorRef.current;
          if (
            panel.offsetWidth === measured.panelWidth
            && panel.offsetHeight === measured.panelHeight
            && (!target || (target.offsetWidth === Math.round(measured.anchorWidth)
              && target.offsetHeight === Math.round(measured.anchorHeight)))
          ) return;
          place(false);
        });
    observer?.observe(panel);
    if (anchor) observer?.observe(anchor);

    return () => {
      if (overlayId !== null) popOverlay(overlayId);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
      document.removeEventListener('pointerdown', onPointerDown, true);
      observer?.disconnect();
    };
  }, [open, anchorRef, align, width, closeOnEscape]);

  if (!open) return null;

  return (
    <>
      <span ref={probeRef} className={s.probe} aria-hidden />
      <div
        {...rest}
        ref={setPanelRef}
        className={[s.panel, width === 'anchor' && s.anchorWidth, className].filter(Boolean).join(' ')}
      >
        {children}
      </div>
    </>
  );
});

export interface PopoverTriggerProps {
  ref: (node: HTMLElement | null) => void;
  id: string;
  'aria-haspopup': PopoverRole;
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}

export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children?: ReactNode;
  role?: PopoverRole;
  align?: PopoverAlign;
  width?: PopoverWidth;
  initialFocus?: PopoverInitialFocus;
  padded?: boolean;
}

export const Popover = forwardRef<HTMLDivElement, PopoverProps>(function Popover(
  {
    open,
    onOpenChange,
    trigger,
    children,
    role = 'dialog',
    align = 'start',
    width = 'auto',
    initialFocus = 'first',
    padded = true,
    id,
    className,
    onBlur,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    ...rest
  },
  ref,
) {
  const baseId = useId();
  const panelId = id ?? `${baseId}-popover`;
  const triggerId = `${baseId}-trigger`;
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef(initialFocus);

  useEffect(() => {
    initialFocusRef.current = initialFocus;
  });

  const setTriggerRef = useCallback((node: HTMLElement | null) => {
    triggerRef.current = node;
  }, []);

  const setPanelRef = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const focus = initialFocusRef.current;
    if (panel && focus !== 'none') {
      const target = focus === 'first' ? focusableWithin(panel)[0] ?? panel : panel;
      target.focus({ preventScroll: true });
    }
    return () => {
      const active = document.activeElement;
      const anchor = triggerRef.current;
      if (anchor && anchor.isConnected && (!active || active === document.body)) {
        anchor.focus({ preventScroll: true });
      }
    };
  }, [open]);

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    onBlur?.(event);
    const next = event.relatedTarget;
    if (!(next instanceof Node)) return;
    if (event.currentTarget.contains(next) || triggerRef.current?.contains(next)) return;
    onOpenChange(false);
  };

  const triggerProps: PopoverTriggerProps = {
    ref: setTriggerRef,
    id: triggerId,
    'aria-haspopup': role,
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
    onClick: () => onOpenChange(!open),
  };

  return (
    <>
      {trigger(triggerProps)}
      <PopoverPanel
        tabIndex={-1}
        {...rest}
        ref={setPanelRef}
        open={open}
        anchorRef={triggerRef}
        onDismiss={() => onOpenChange(false)}
        align={align}
        width={width}
        id={panelId}
        role={role}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : triggerId)}
        className={[padded && s.padded, className].filter(Boolean).join(' ')}
        onBlur={handleBlur}
      >
        {children}
      </PopoverPanel>
    </>
  );
});
