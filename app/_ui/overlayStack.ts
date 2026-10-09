const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface OverlayOptions {
  lockScroll?: boolean;
  trapFocus?: boolean;
}

export interface OverlayEntry {
  id: number;
  root: HTMLElement;
  escape: () => void;
  lockScroll: boolean;
  trapFocus: boolean;
}

const stack: OverlayEntry[] = [];
let nextId = 1;
let savedOverflow: string | null = null;
let listening = false;

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && (el.offsetParent !== null || el === document.activeElement),
  );
}

function focusConnected(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected || el === document.body || el === document.documentElement) return false;
  el.focus({ preventScroll: true });
  return document.activeElement === el;
}

export function restoreFocus(
  previous: HTMLElement | null,
  fallback?: () => HTMLElement | null,
): HTMLElement | null {
  if (focusConnected(previous)) return previous;
  if (!fallback) return null;
  let target: HTMLElement | null = null;
  try {
    target = fallback();
  } catch {
    target = null;
  }
  return focusConnected(target) ? target : null;
}

export function topmostOverlay(): OverlayEntry | undefined {
  return stack[stack.length - 1];
}

export function topmostTrap(): OverlayEntry | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].trapFocus) return stack[i];
  }
  return undefined;
}

export function isTopmostTrap(el: HTMLElement | null): boolean {
  const top = topmostOverlay();
  return !!top && !!el && top.root === el;
}

export function overlayDepth(): number {
  return stack.length;
}

export type RovingMove = 'next' | 'previous' | 'first' | 'last';

export function moveRovingIndex(current: number, count: number, move: RovingMove, wrap = true): number {
  if (count <= 0) return -1;
  if (move === 'first') return 0;
  if (move === 'last') return count - 1;
  if (current < 0 || current >= count) return move === 'next' ? 0 : count - 1;
  const next = current + (move === 'next' ? 1 : -1);
  if (next < 0) return wrap ? count - 1 : 0;
  if (next >= count) return wrap ? 0 : count - 1;
  return next;
}

export function nextTabbable(from: HTMLElement, backward = false): HTMLElement | null {
  const trap = topmostTrap();
  const items = focusableWithin(trap ? trap.root : document.body);
  const index = items.indexOf(from);
  if (index < 0 || items.length < 2) return null;
  const next = index + (backward ? -1 : 1);
  if (next >= 0 && next < items.length) return items[next];
  return trap ? items[(next + items.length) % items.length] : null;
}

export function handleOverlayKeyDown(e: KeyboardEvent) {
  const top = topmostOverlay();
  if (!top) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    top.escape();
    return;
  }

  if (e.key !== 'Tab') return;
  const trap = topmostTrap();
  if (!trap) return;
  const items = focusableWithin(trap.root);
  if (items.length === 0) {
    e.preventDefault();
    trap.root.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const current = document.activeElement;
  if (e.shiftKey && (current === first || current === trap.root)) {
    e.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!e.shiftKey && current === last) {
    e.preventDefault();
    first.focus({ preventScroll: true });
  }
}

export function handleOverlayFocusIn(e: FocusEvent) {
  const trap = topmostTrap();
  if (!trap) return;
  if (!trap.root.contains(e.target as Node)) {
    (focusableWithin(trap.root)[0] ?? trap.root).focus({ preventScroll: true });
  }
}

export function pushOverlay(root: HTMLElement, escape: () => void, options: OverlayOptions = {}): number {
  const entry: OverlayEntry = {
    id: nextId++,
    root,
    escape,
    lockScroll: options.lockScroll !== false,
    trapFocus: options.trapFocus !== false,
  };
  if (entry.lockScroll && !stack.some((x) => x.lockScroll)) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  stack.push(entry);
  if (!listening) {
    document.addEventListener('keydown', handleOverlayKeyDown, true);
    document.addEventListener('focusin', handleOverlayFocusIn, true);
    listening = true;
  }
  return entry.id;
}

export function popOverlay(id: number) {
  const i = stack.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [entry] = stack.splice(i, 1);
  if (entry.lockScroll && !stack.some((x) => x.lockScroll)) {
    document.body.style.overflow = savedOverflow ?? '';
    savedOverflow = null;
  }
  if (stack.length === 0 && listening) {
    document.removeEventListener('keydown', handleOverlayKeyDown, true);
    document.removeEventListener('focusin', handleOverlayFocusIn, true);
    listening = false;
  }
}
