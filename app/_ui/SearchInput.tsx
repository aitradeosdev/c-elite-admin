'use client';

import {
  ChangeEvent, KeyboardEvent, MouseEvent, forwardRef, useCallback, useEffect, useRef, useState,
} from 'react';
import { Search, X } from 'lucide-react';
import { Input, type InputProps } from './Field';
import s from './SearchInput.module.css';

export interface SearchInputProps
  extends Omit<InputProps, 'type' | 'value' | 'defaultValue' | 'onChange' | 'aria-label'> {
  'aria-label': string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onDebouncedChange?: (value: string) => void;
  debounceMs?: number;
  loading?: boolean;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    defaultValue = '',
    onChange,
    onDebouncedChange,
    debounceMs = 300,
    loading = false,
    disabled,
    readOnly,
    className,
    style,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inner, setInner] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const debouncedRef = useRef(onDebouncedChange);
  const emittedRef = useRef(current.trim());

  useEffect(() => {
    debouncedRef.current = onDebouncedChange;
  });

  const setRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const emit = useCallback((raw: string) => {
    const next = raw.trim();
    if (next === emittedRef.current) return;
    emittedRef.current = next;
    debouncedRef.current?.(next);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => emit(current), Math.max(0, debounceMs));
    return () => clearTimeout(id);
  }, [current, debounceMs, emit]);

  const update = (next: string) => {
    if (!controlled) setInner(next);
    onChange?.(next);
  };

  const clear = () => {
    update('');
    emit('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && current !== '' && !readOnly) {
      event.preventDefault();
      event.stopPropagation();
      clear();
    } else if (event.key === 'Enter') {
      emit(current);
    }
  };

  const handleClearClick = () => {
    clear();
    inputRef.current?.focus();
  };

  const clearable = current !== '' && !disabled && !readOnly;

  return (
    <div className={[s.root, disabled && s.disabled, className].filter(Boolean).join(' ')} style={style}>
      <span className={s.leading} aria-hidden>
        {loading ? <span className={s.spinner} /> : <Search size={14} />}
      </span>
      <Input
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        data-page-search=""
        {...rest}
        ref={setRef}
        type="search"
        className={s.input}
        value={current}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(event: ChangeEvent<HTMLInputElement>) => update(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {clearable ? (
        <button
          type="button"
          className={s.clear}
          aria-label="Clear search"
          onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
          onClick={handleClearClick}
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
});
