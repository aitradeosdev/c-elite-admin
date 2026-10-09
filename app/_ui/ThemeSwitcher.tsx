'use client';

import type { ComponentType } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeMode } from './theme';
import s from './ThemeSwitcher.module.css';

const OPTIONS: Array<{ value: ThemeMode; label: string; icon: ComponentType<{ size?: number }> }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function ThemeSwitcher({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  return (
    <div className={[s.group, className].filter(Boolean).join(' ')} role="radiogroup" aria-label="Theme">
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            className={[s.btn, active && s.active].filter(Boolean).join(' ')}
            onClick={() => setMode(opt.value)}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
