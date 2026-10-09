'use client';

import {
  InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode,
  createContext, forwardRef, useContext, useId,
} from 'react';
import s from './Field.module.css';

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

interface FieldShellProps {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  help?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function FieldShell({ label, htmlFor, required, help, error, children, className }: FieldShellProps) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const messageId = `${id}-msg`;
  const hasMessage = Boolean(error || help);

  return (
    <FieldContext.Provider
      value={{
        id,
        describedBy: hasMessage ? messageId : undefined,
        invalid: Boolean(error),
        required: Boolean(required),
      }}
    >
      <div className={[s.wrap, className].filter(Boolean).join(' ')}>
        {label ? (
          <label htmlFor={id} className={[s.label, required && s.required].filter(Boolean).join(' ')}>
            {label}
          </label>
        ) : null}
        {children}
        {error ? (
          <div id={messageId} className={s.error} role="alert">{error}</div>
        ) : help ? (
          <div id={messageId} className={s.help}>{help}</div>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

interface ControlA11y {
  id?: string;
  invalid?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
  'aria-required'?: boolean | 'true' | 'false';
}

function useFieldControl(props: ControlA11y) {
  const ctx = useContext(FieldContext);
  const describedBy = [props['aria-describedby'], ctx?.describedBy].filter(Boolean).join(' ') || undefined;
  const invalid = props.invalid || ctx?.invalid;
  return {
    id: props.id ?? ctx?.id,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (invalid ? true : undefined),
    'aria-required': props['aria-required'] ?? (ctx?.required ? true : undefined),
    invalid: Boolean(invalid),
  };
}

export type FieldSize = 'sm' | 'md';

function sizeClass(size: FieldSize | number | undefined): string | undefined {
  return size === 'sm' ? s.sm : undefined;
}

function nativeSize(size: FieldSize | number | undefined): number | undefined {
  return typeof size === 'number' ? size : undefined;
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean;
  mono?: boolean;
  size?: FieldSize | number;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, mono, size, className, id, ...rest }, ref,
) {
  const a11y = useFieldControl({ id, invalid, ...rest });
  const cls = [s.control, sizeClass(size), mono && s.mono, a11y.invalid && s.invalid, className].filter(Boolean).join(' ');
  return (
    <input
      ref={ref}
      className={cls}
      {...rest}
      size={nativeSize(size)}
      id={a11y.id}
      aria-describedby={a11y['aria-describedby']}
      aria-invalid={a11y['aria-invalid']}
      aria-required={a11y['aria-required']}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, mono, className, id, ...rest }, ref,
) {
  const a11y = useFieldControl({ id, invalid, ...rest });
  const cls = [s.control, s.textarea, mono && s.mono, a11y.invalid && s.invalid, className].filter(Boolean).join(' ');
  return (
    <textarea
      ref={ref}
      className={cls}
      {...rest}
      id={a11y.id}
      aria-describedby={a11y['aria-describedby']}
      aria-invalid={a11y['aria-invalid']}
      aria-required={a11y['aria-required']}
    />
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  invalid?: boolean;
  size?: FieldSize | number;
  inline?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, size, inline, className, children, id, ...rest }, ref,
) {
  const a11y = useFieldControl({ id, invalid, ...rest });
  const cls = [
    s.control, s.select, sizeClass(size), inline && s.inline, a11y.invalid && s.invalid, className,
  ].filter(Boolean).join(' ');
  return (
    <select
      ref={ref}
      className={cls}
      {...rest}
      size={nativeSize(size)}
      id={a11y.id}
      aria-describedby={a11y['aria-describedby']}
      aria-invalid={a11y['aria-invalid']}
      aria-required={a11y['aria-required']}
    >
      {children}
    </select>
  );
});
