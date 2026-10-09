'use client';

import { ReactNode, useId } from 'react';
import s from './RadioGroup.module.css';

export type RadioGroupOrientation = 'vertical' | 'horizontal';

export interface RadioOption<T extends string = string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string = string> {
  legend: ReactNode;
  hideLegend?: boolean;
  options: ReadonlyArray<RadioOption<T>>;
  value: T | null;
  onChange: (next: T) => void;
  orientation?: RadioGroupOrientation;
  name?: string;
  help?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function RadioGroup<T extends string = string>({
  legend,
  hideLegend,
  options,
  value,
  onChange,
  orientation = 'vertical',
  name,
  help,
  error,
  invalid,
  required,
  disabled,
  id,
  className,
}: RadioGroupProps<T>) {
  const baseId = useId();
  const groupName = name ?? baseId;
  const messageId = `${baseId}-message`;
  const isInvalid = Boolean(invalid || error);
  const described = options.some((option) => option.description);

  return (
    <fieldset
      id={id}
      disabled={disabled}
      aria-describedby={error || help ? messageId : undefined}
      className={[s.group, isInvalid && s.invalid, className].filter(Boolean).join(' ')}
    >
      <legend className={[s.legend, hideLegend && s.srOnly].filter(Boolean).join(' ')}>
        {legend}
        {required ? <span className={s.required} aria-hidden> *</span> : null}
      </legend>
      <div
        className={[
          s.options,
          orientation === 'horizontal' ? s.horizontal : s.vertical,
          described && s.described,
        ].filter(Boolean).join(' ')}
      >
        {options.map((option, index) => {
          const checked = option.value === value;
          const optionDisabled = Boolean(disabled || option.disabled);
          const labelId = `${baseId}-${index}-label`;
          const descriptionId = `${baseId}-${index}-description`;
          return (
            <label
              key={option.value}
              className={[s.option, checked && s.checked, optionDisabled && s.disabled].filter(Boolean).join(' ')}
            >
              <span className={s.control}>
                <input
                  type="radio"
                  className={s.input}
                  name={groupName}
                  value={option.value}
                  checked={checked}
                  disabled={optionDisabled}
                  required={required}
                  onChange={() => onChange(option.value)}
                  aria-labelledby={labelId}
                  aria-describedby={option.description ? descriptionId : undefined}
                  aria-invalid={isInvalid || undefined}
                />
                <span className={s.circle} aria-hidden />
              </span>
              <span className={s.text}>
                <span id={labelId} className={s.label}>{option.label}</span>
                {option.description ? (
                  <span id={descriptionId} className={s.description}>{option.description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <div id={messageId} className={s.error} role="alert">{error}</div>
      ) : help ? (
        <div id={messageId} className={s.help}>{help}</div>
      ) : null}
    </fieldset>
  );
}
