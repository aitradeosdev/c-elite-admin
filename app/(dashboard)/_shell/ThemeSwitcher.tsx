'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeMode } from '../../_ui/theme';
import s from './Shell.module.css';

/**
 * Three-state segmented control: Light / System / Dark.
 * The icons match the convention used by every modern dev tool dashboard.
 */
export function ThemeSwitcher() {
  const { mode, setMode } = useTheme();
  const options: Array<{ value: ThemeMode; label: string; icon: React.ComponentType<{ size?: number }> }> = [
    { value: 'light',  label: 'Light',  icon: Sun },
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'dark',   label: 'Dark',   icon: Moon },
  ];
  return (
    <div className={s.themeSwitch} role="radiogroup" aria-label="Theme">
      {options.map((opt) => {
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
            className={[s.themeSwitchBtn, active && s.active].filter(Boolean).join(' ')}
            onClick={() => setMode(opt.value)}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
