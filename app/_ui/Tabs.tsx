'use client';

import {
  FocusEvent, HTMLAttributes, KeyboardEvent, ReactNode, forwardRef, useId, useRef, useState,
} from 'react';
import { moveRovingIndex, type RovingMove } from './overlayStack';
import s from './Tabs.module.css';

export type TabsVariant = 'segmented' | 'underline';

export type TabsActivation = 'auto' | 'manual';

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  count?: number | string;
}

export interface TabsProps<T extends string = string> {
  value: T;
  onChange: (next: T) => void;
  items: ReadonlyArray<TabItem<T>>;
  variant?: TabsVariant;
  className?: string;
  id?: string;
  activation?: TabsActivation;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

export interface TabsKey {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export interface TabsKeyAction {
  focus: number;
  select: boolean;
}

const ID_SAFE_CHAR = /^[A-Za-z0-9-]$/;

export function tabIdPart(value: string): string {
  let part = '';
  for (const char of value) {
    part += ID_SAFE_CHAR.test(char) ? char : `_${(char.codePointAt(0) ?? 0).toString(16)}_`;
  }
  return part;
}

export function tabId(base: string, value: string): string {
  return `${base}-tab-${tabIdPart(value)}`;
}

export function tabPanelId(base: string, value: string): string {
  return `${base}-panel-${tabIdPart(value)}`;
}

export function tabsMoveForKey(key: string): RovingMove | null {
  switch (key) {
    case 'ArrowRight':
      return 'next';
    case 'ArrowLeft':
      return 'previous';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

export function tabsKeyAction(
  event: TabsKey,
  index: number,
  values: ReadonlyArray<string>,
  selected: string,
  activation: TabsActivation,
): TabsKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const move = tabsMoveForKey(event.key);
  if (!move) return null;
  const focus = moveRovingIndex(index, values.length, move);
  if (focus < 0) return null;
  return { focus, select: activation === 'auto' && values[focus] !== selected };
}

export function tabStopIndex(values: ReadonlyArray<string>, selected: string, focused: string | null): number {
  if (values.length === 0) return -1;
  const focusedIndex = focused === null ? -1 : values.indexOf(focused);
  if (focusedIndex >= 0) return focusedIndex;
  const selectedIndex = values.indexOf(selected);
  return selectedIndex >= 0 ? selectedIndex : 0;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  variant = 'segmented',
  className,
  id,
  activation = 'auto',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: TabsProps<T>) {
  const autoId = useId();
  const base = id || autoId;
  const [focused, setFocused] = useState<T | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const values = items.map((item) => item.value);
  const stop = tabStopIndex(values, value, focused);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const action = tabsKeyAction(event, index, values, value, activation);
    if (!action) return;
    event.preventDefault();
    tabRefs.current[action.focus]?.focus();
    if (action.select) onChange(values[action.focus]);
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
  };

  const cls = [variant === 'underline' ? s.underline : s.tabs, className].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      role="tablist"
      id={id || undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onBlur={handleBlur}
    >
      {items.map((it, index) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={tabId(base, it.value)}
            aria-selected={active}
            aria-controls={id ? tabPanelId(base, it.value) : undefined}
            tabIndex={index === stop ? 0 : -1}
            className={[s.tab, active && s.active].filter(Boolean).join(' ')}
            onClick={() => onChange(it.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onFocus={() => setFocused(it.value)}
          >
            {it.label}
            {it.count !== undefined ? <span className={s.count}>{it.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'id' | 'role' | 'hidden' | 'aria-labelledby'> {
  tabsId: string;
  value: string;
  active: boolean;
  keepMounted?: boolean;
}

export const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(function TabPanel(
  { tabsId, value, active, keepMounted = false, tabIndex = 0, className, children, ...rest },
  ref,
) {
  return (
    <div
      {...rest}
      ref={ref}
      role="tabpanel"
      id={tabPanelId(tabsId, value)}
      aria-labelledby={tabId(tabsId, value)}
      tabIndex={tabIndex}
      hidden={!active}
      className={[s.panel, className].filter(Boolean).join(' ')}
    >
      {active || keepMounted ? children : null}
    </div>
  );
});
