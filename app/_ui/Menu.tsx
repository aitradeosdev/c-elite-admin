'use client';

import {
  KeyboardEvent, PointerEvent, ReactNode, forwardRef, useEffect, useId, useRef, useState,
} from 'react';
import { Popover, type PopoverAlign, type PopoverTriggerProps } from './Popover';
import { moveRovingIndex, type RovingMove } from './overlayStack';
import s from './Menu.module.css';

export interface MenuItem {
  type?: 'item';
  label: string;
  icon?: ReactNode;
  description?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuSeparator {
  type: 'separator';
}

export type MenuEntry = MenuItem | MenuSeparator;

export type MenuEntryInput = MenuEntry | false | null | undefined;

export interface MenuTriggerProps extends PopoverTriggerProps {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface MenuProps {
  trigger: (props: MenuTriggerProps) => ReactNode;
  items: ReadonlyArray<MenuEntryInput>;
  align?: PopoverAlign;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

const TYPEAHEAD_RESET_MS = 500;

export function isMenuSeparator(entry: MenuEntry): entry is MenuSeparator {
  return entry.type === 'separator';
}

export function normalizeMenuEntries(entries: ReadonlyArray<MenuEntryInput>): MenuEntry[] {
  const result: MenuEntry[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (isMenuSeparator(entry) && (result.length === 0 || isMenuSeparator(result[result.length - 1]))) continue;
    result.push(entry);
  }
  if (result.length > 0 && isMenuSeparator(result[result.length - 1])) result.pop();
  return result;
}

export function menuMoveForKey(key: string): RovingMove | null {
  switch (key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'previous';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

function foldText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trimStart();
}

export function matchMenuTypeahead(labels: ReadonlyArray<string>, current: number, typed: string): number {
  const search = foldText(typed);
  const count = labels.length;
  if (!search || count === 0) return -1;
  const chars = Array.from(search);
  const cycling = chars.every((char) => char === chars[0]);
  const needle = cycling ? chars[0] : search;
  const from = current >= 0 && current < count ? current : 0;
  const skipCurrent = cycling && current >= 0 && current < count;
  for (let step = skipCurrent ? 1 : 0; step < count; step++) {
    const index = (from + step) % count;
    if (foldText(labels[index]).startsWith(needle)) return index;
  }
  return -1;
}

export const Menu = forwardRef<HTMLDivElement, MenuProps>(function Menu(
  {
    trigger,
    items,
    align = 'start',
    open: openProp,
    onOpenChange,
    id,
    className,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
  },
  ref,
) {
  const baseId = useId();
  const entries = normalizeMenuEntries(items);
  const actions = entries.filter((entry): entry is MenuItem => !isMenuSeparator(entry));
  const count = actions.length;
  const [ownOpen, setOwnOpen] = useState(false);
  const [active, setActive] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeahead = useRef<{ text: string; timer: number | undefined }>({ text: '', timer: undefined });
  const open = (openProp ?? ownOpen) && count > 0;
  const current = count > 0 ? Math.min(Math.max(active, 0), count - 1) : -1;

  useEffect(() => {
    if (!open) return;
    const state = typeahead.current;
    return () => {
      window.clearTimeout(state.timer);
      state.text = '';
    };
  }, [open]);

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };

  const show = (index: number) => {
    if (count === 0) return;
    setActive(index);
    setOpen(true);
  };

  const focusItem = (index: number, preventScroll = false) => {
    if (index < 0) return;
    setActive(index);
    itemRefs.current[index]?.focus({ preventScroll });
  };

  const handleOpenChange = (next: boolean) => {
    if (next) show(0);
    else setOpen(false);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || count === 0) return;
    event.preventDefault();
    const index = event.key === 'ArrowDown' ? 0 : count - 1;
    if (open) focusItem(index);
    else show(index);
  };

  const activate = (item: MenuItem) => {
    if (item.disabled) return;
    setOpen(false);
    item.onSelect();
  };

  const runTypeahead = (char: string) => {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.text += char;
    state.timer = window.setTimeout(() => {
      state.text = '';
    }, TYPEAHEAD_RESET_MS);
    focusItem(matchMenuTypeahead(actions.map((item) => item.label), current, state.text));
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = menuMoveForKey(event.key);
    if (move) {
      event.preventDefault();
      focusItem(moveRovingIndex(current, count, move));
      return;
    }
    if (event.key === 'Tab') {
      if (event.shiftKey) event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      runTypeahead(event.key);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    if (event.pointerType !== 'mouse' || actions[index]?.disabled) return;
    const item = event.currentTarget;
    if (item.ownerDocument.activeElement === item) return;
    focusItem(index, true);
  };

  const iconColumn = actions.some((item) => Boolean(item.icon));
  const rows: ReactNode[] = [];
  let nextIndex = 0;
  entries.forEach((entry, position) => {
    if (isMenuSeparator(entry)) {
      rows.push(<div key={`separator-${position}`} role="separator" className={s.separator} />);
      return;
    }
    const index = nextIndex;
    nextIndex += 1;
    const labelId = `${baseId}-item-${index}`;
    const descriptionId = entry.description ? `${labelId}-description` : undefined;
    rows.push(
      <button
        key={`item-${position}`}
        ref={(node) => {
          itemRefs.current[index] = node;
        }}
        type="button"
        role="menuitem"
        tabIndex={index === current ? 0 : -1}
        aria-disabled={entry.disabled || undefined}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        className={[s.item, entry.danger && s.danger].filter(Boolean).join(' ')}
        onClick={() => activate(entry)}
        onFocus={() => setActive(index)}
        onPointerMove={(event) => handlePointerMove(event, index)}
      >
        {iconColumn ? <span className={s.icon} aria-hidden>{entry.icon}</span> : null}
        <span className={s.text}>
          <span id={labelId} className={s.label}>{entry.label}</span>
          {entry.description ? (
            <span id={descriptionId} className={s.description}>{entry.description}</span>
          ) : null}
        </span>
      </button>,
    );
  });

  return (
    <Popover
      ref={ref}
      open={open}
      onOpenChange={handleOpenChange}
      role="menu"
      align={align}
      padded={false}
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={[s.menu, className].filter(Boolean).join(' ')}
      onKeyDown={handleMenuKeyDown}
      trigger={(props) => trigger({ ...props, onKeyDown: handleTriggerKeyDown })}
    >
      {rows}
    </Popover>
  );
});
