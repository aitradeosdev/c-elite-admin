import { InputHTMLAttributes, ReactNode, forwardRef } from 'react';
import s from './Toggle.module.css';

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
}

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(function Toggle(
  { label, checked, onChange, disabled, className, id, ...rest }, ref,
) {
  return (
    <label className={[s.row, checked && s.on, disabled && s.disabled, className].filter(Boolean).join(' ')}>
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={s.input}
        id={id}
        {...rest}
      />
      <span className={s.track} aria-hidden>
        <span className={s.thumb} />
      </span>
      {label ? <span className={s.label}>{label}</span> : null}
    </label>
  );
});
