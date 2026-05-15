import { ReactNode } from 'react';
import s from './Tabs.module.css';

export interface TabsProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  items: ReadonlyArray<{ value: T; label: ReactNode; count?: number | string }>;
  variant?: 'segmented' | 'underline';
  className?: string;
}

export function Tabs<T extends string>({ value, onChange, items, variant = 'segmented', className }: TabsProps<T>) {
  const cls = [variant === 'underline' ? s.underline : s.tabs, className].filter(Boolean).join(' ');
  return (
    <div className={cls} role="tablist">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={[s.tab, active && s.active].filter(Boolean).join(' ')}
            onClick={() => onChange(it.value)}
          >
            {it.label}
            {it.count !== undefined ? <span className={s.count}>{it.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
