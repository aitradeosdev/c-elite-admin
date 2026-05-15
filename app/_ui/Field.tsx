import { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode, forwardRef } from 'react';
import s from './Field.module.css';

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
  return (
    <div className={[s.wrap, className].filter(Boolean).join(' ')}>
      {label ? (
        <label htmlFor={htmlFor} className={[s.label, required && s.required].filter(Boolean).join(' ')}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? <div className={s.error}>{error}</div> : help ? <div className={s.help}>{help}</div> : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, mono, className, ...rest }, ref,
) {
  const cls = [s.control, mono && s.mono, invalid && s.invalid, className].filter(Boolean).join(' ');
  return <input ref={ref} className={cls} {...rest} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest }, ref,
) {
  const cls = [s.control, s.textarea, invalid && s.invalid, className].filter(Boolean).join(' ');
  return <textarea ref={ref} className={cls} {...rest} />;
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest }, ref,
) {
  const cls = [s.control, s.select, invalid && s.invalid, className].filter(Boolean).join(' ');
  return <select ref={ref} className={cls} {...rest}>{children}</select>;
});
