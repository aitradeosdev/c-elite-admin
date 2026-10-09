'use client';

import {
  InputHTMLAttributes, ReactNode, forwardRef, useCallback, useEffect, useId, useRef,
} from 'react';
import s from './Checkbox.module.css';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'defaultChecked' | 'children'> {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  indeterminate?: boolean;
  invalid?: boolean;
}

const CHECK_PATH = 'M2.5 6.5 5 9l4.5-5.5';
const DASH_PATH = 'M3 6h6';

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    checked,
    onChange,
    label,
    description,
    indeterminate = false,
    invalid = false,
    disabled,
    className,
    style,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    ...rest
  },
  ref,
) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const descriptionId = `${baseId}-description`;
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  });

  return (
    <label
      className={[
        s.root,
        (checked || indeterminate) && s.filled,
        invalid && s.invalid,
        disabled && s.disabled,
        description ? s.described : null,
        className,
      ].filter(Boolean).join(' ')}
      style={style}
    >
      <span className={s.control}>
        <input
          {...rest}
          ref={setRef}
          type="checkbox"
          className={s.input}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-labelledby={labelledBy ?? (label ? labelId : undefined)}
          aria-describedby={[describedBy, description ? descriptionId : null].filter(Boolean).join(' ') || undefined}
          aria-invalid={ariaInvalid ?? (invalid || undefined)}
        />
        <span className={s.box} aria-hidden>
          <svg
            className={s.glyph}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={indeterminate ? DASH_PATH : CHECK_PATH} />
          </svg>
        </span>
      </span>
      {label || description ? (
        <span className={s.text}>
          {label ? <span id={labelId} className={s.label}>{label}</span> : null}
          {description ? <span id={descriptionId} className={s.description}>{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
});
