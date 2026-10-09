'use client';

import {
  ChangeEvent, FocusEvent, ForwardedRef, InputHTMLAttributes, KeyboardEvent, MouseEvent, ReactNode, RefAttributes,
  forwardRef, useCallback, useId, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Input } from './Field';
import { PopoverPanel } from './Popover';
import { moveRovingIndex, popOverlay, pushOverlay } from './overlayStack';
import { useDebouncedValue } from './useDebouncedValue';
import s from './Combobox.module.css';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: ReactNode;
  keywords?: ReadonlyArray<string>;
}

export interface ComboboxFilterResult<T extends ComboboxOption = ComboboxOption> {
  options: T[];
  total: number;
}

export type ComboboxEscapeAction = 'close' | 'revert' | 'clear';

export interface ComboboxEscapeState {
  open: boolean;
  query: string | null;
  committedText: string;
  hasValue: boolean;
  armed: boolean;
}

export type ComboboxOpenMode = 'first' | 'last' | 'selected';

export interface ComboboxProps<T extends ComboboxOption = ComboboxOption>
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'defaultValue' | 'onChange' | 'type' | 'role' | 'children' | 'list' | 'multiple'
  > {
  options: ReadonlyArray<T>;
  value: string | null;
  onChange: (value: string | null, option: T | null) => void;
  maxResults?: number;
  emptyText?: string;
  invalid?: boolean;
}

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const WORD_BREAK = /[^\p{L}\p{N}]+/u;
const STATUS_DELAY_MS = 400;

export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function wordsOf(text: string): string[] {
  return text.split(WORD_BREAK).filter(Boolean);
}

function rankNormalized(option: ComboboxOption, needle: string, tokens: ReadonlyArray<string>): number {
  const label = normalizeSearchText(option.label);
  const keywords = (option.keywords ?? []).map(normalizeSearchText).filter(Boolean);
  if (label === needle) return 0;
  if (label.startsWith(needle)) return 1;
  if (keywords.includes(needle)) return 2;
  if (tokens.length > 0) {
    const words = [...wordsOf(label), ...keywords.flatMap(wordsOf)];
    if (tokens.every((token) => words.some((word) => word.startsWith(token)))) return 3;
  }
  if (label.includes(needle)) return 4;
  if (keywords.some((keyword) => keyword.includes(needle))) return 5;
  return -1;
}

export function rankComboboxOption(option: ComboboxOption, query: string): number {
  const needle = normalizeSearchText(query);
  return needle ? rankNormalized(option, needle, wordsOf(needle)) : 0;
}

export function filterComboboxOptions<T extends ComboboxOption>(
  options: ReadonlyArray<T>,
  query: string,
  maxResults: number = Number.POSITIVE_INFINITY,
): ComboboxFilterResult<T> {
  const limit = Number.isNaN(maxResults) ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(maxResults));
  const needle = normalizeSearchText(query);
  if (!needle) return { options: options.slice(0, limit), total: options.length };
  const tokens = wordsOf(needle);
  const ranked: Array<{ option: T; rank: number; index: number }> = [];
  options.forEach((option, index) => {
    const rank = rankNormalized(option, needle, tokens);
    if (rank >= 0) ranked.push({ option, rank, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return { options: ranked.slice(0, limit).map((entry) => entry.option), total: ranked.length };
}

export function findExactOption<T extends ComboboxOption>(options: ReadonlyArray<T>, text: string): T | null {
  const needle = normalizeSearchText(text);
  if (!needle) return null;
  const matches = options.filter((option) => normalizeSearchText(option.label) === needle);
  return matches.length === 1 ? matches[0] : null;
}

export function comboboxStatus(shown: number, total: number, emptyText = 'No matches'): string {
  if (total <= 0) return emptyText;
  if (shown < total) {
    return `Showing ${shown} of ${total} options. Keep typing to narrow ${total - shown} more.`;
  }
  return total === 1 ? '1 option available.' : `${total} options available.`;
}

export function comboboxEscapeAction(state: ComboboxEscapeState): ComboboxEscapeAction | null {
  if (state.open) return 'close';
  if (state.query !== null && state.query !== state.committedText) return 'revert';
  if (state.armed && state.hasValue) return 'clear';
  return null;
}

export function comboboxOpeningIndex(
  results: ReadonlyArray<ComboboxOption>,
  value: string | null,
  mode: ComboboxOpenMode,
): number {
  const selected = value === null ? -1 : results.findIndex((option) => option.value === value);
  if (selected >= 0) return selected;
  if (mode === 'first') return results.length > 0 ? 0 : -1;
  if (mode === 'last') return results.length - 1;
  return -1;
}

type ActiveSource = 'keyboard' | 'pointer' | 'hover';

interface ActiveState {
  index: number;
  source: ActiveSource;
}

const NO_ACTIVE: ActiveState = { index: -1, source: 'keyboard' };

function labelTextOf(input: HTMLInputElement | null): string | undefined {
  const text = input?.labels?.[0]?.textContent?.trim();
  return text ? text : undefined;
}

function revealOption(list: HTMLElement, option: HTMLElement) {
  const bounds = list.getBoundingClientRect();
  const box = option.getBoundingClientRect();
  const top = bounds.top + list.clientTop;
  const bottom = top + list.clientHeight;
  if (box.top < top) list.scrollTop -= top - box.top;
  else if (box.bottom > bottom) list.scrollTop += box.bottom - bottom;
}

function keepInputFocus(event: MouseEvent<HTMLDivElement>) {
  event.preventDefault();
}

export const Combobox = forwardRef(function Combobox<T extends ComboboxOption>(
  {
    options,
    value,
    onChange,
    maxResults = 50,
    emptyText = 'No matches',
    invalid,
    disabled,
    readOnly,
    name,
    form,
    id,
    className,
    style,
    onFocus,
    onBlur,
    onKeyDown,
    onMouseDown,
    onClick,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    ...rest
  }: ComboboxProps<T>,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pointerFocusRef = useRef(false);
  const escapeRef = useRef<() => void>(() => {});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveState>(NO_ACTIVE);
  const [focused, setFocused] = useState(false);
  const [armed, setArmed] = useState(false);
  const [listLabel, setListLabel] = useState<string | undefined>(undefined);

  const inert = Boolean(disabled || readOnly);
  const selected = useMemo(
    () => (value === null ? null : options.find((option) => option.value === value) ?? null),
    [options, value],
  );
  const committedText = selected?.label ?? '';
  const { options: results, total } = useMemo(
    () => filterComboboxOptions(options, query ?? '', maxResults),
    [options, query, maxResults],
  );
  const positions = useMemo(() => new Map(options.map((option, index) => [option.value, index])), [options]);
  const isOpen = open && !inert;
  const listed = isOpen && results.length > 0;
  const activeIndex = active.index < results.length ? active.index : -1;
  const activeOption = listed && activeIndex >= 0 ? results[activeIndex] : null;
  const hiddenCount = total - results.length;
  const escapeAction = inert
    ? null
    : comboboxEscapeAction({ open: isOpen, query, committedText, hasValue: selected !== null, armed });
  const ownsEscape = focused && escapeAction !== null;
  const status = useDebouncedValue(isOpen ? comboboxStatus(results.length, total, emptyText) : '', STATUS_DELAY_MS);

  const optionId = (option: T) => `${baseId}-option-${positions.get(option.value) ?? -1}`;

  const setRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  useLayoutEffect(() => {
    escapeRef.current = () => {
      if (escapeAction === 'close') {
        setOpen(false);
        setArmed(true);
        return;
      }
      setArmed(false);
      if (escapeAction === 'revert') {
        setQuery(null);
      } else if (escapeAction === 'clear') {
        setQuery(null);
        onChange(null, null);
      }
    };
  });

  useLayoutEffect(() => {
    if (!ownsEscape) return;
    const root = rootRef.current;
    if (!root) return;
    const layer = pushOverlay(root, () => escapeRef.current(), { lockScroll: false, trapFocus: false });
    return () => popOverlay(layer);
  }, [ownsEscape]);

  const activeValue = activeOption?.value;

  useLayoutEffect(() => {
    if (!listed || activeIndex < 0 || active.source === 'hover') return;
    const list = listRef.current;
    const option = list?.children[activeIndex];
    if (list && option instanceof HTMLElement) revealOption(list, option);
  }, [listed, activeIndex, active.source, activeValue, query]);

  const show = (mode: ComboboxOpenMode, source: ActiveSource) => {
    setActive({ index: comboboxOpeningIndex(results, value, mode), source });
    setOpen(true);
    setArmed(false);
    setListLabel(labelTextOf(inputRef.current));
  };

  const commit = (option: T) => {
    setQuery(null);
    setOpen(false);
    setArmed(false);
    setActive(NO_ACTIVE);
    if (option.value !== value) onChange(option.value, option);
  };

  const hover = (index: number) => {
    if (active.index === index && active.source === 'hover') return;
    setActive({ index, source: 'hover' });
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setQuery(next);
    setActive({ index: normalizeSearchText(next) ? 0 : -1, source: 'keyboard' });
    setOpen(true);
    setArmed(false);
    setListLabel(labelTextOf(event.target));
    if (next === '' && selected) onChange(null, null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing || inert) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const down = event.key === 'ArrowDown';
      if (event.altKey) {
        if (!down) setOpen(false);
        else if (!isOpen) show('selected', 'keyboard');
        return;
      }
      if (!isOpen) {
        show(down ? 'first' : 'last', 'keyboard');
        return;
      }
      setActive({ index: moveRovingIndex(activeIndex, results.length, down ? 'next' : 'previous'), source: 'keyboard' });
      return;
    }
    if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      if (activeOption) commit(activeOption);
      else setOpen(false);
    }
  };

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    onFocus?.(event);
    setFocused(true);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    onBlur?.(event);
    const input = event.currentTarget;
    if (input.ownerDocument.activeElement === input) return;
    setFocused(false);
    setOpen(false);
    setArmed(false);
    setActive(NO_ACTIVE);
    if (query === null) return;
    setQuery(null);
    const exact = findExactOption(options, query);
    if (exact && exact.value !== value) onChange(exact.value, exact);
  };

  const handleMouseDown = (event: MouseEvent<HTMLInputElement>) => {
    onMouseDown?.(event);
    const input = event.currentTarget;
    pointerFocusRef.current = input.ownerDocument.activeElement !== input;
  };

  const handleClick = (event: MouseEvent<HTMLInputElement>) => {
    onClick?.(event);
    const firstClick = pointerFocusRef.current;
    pointerFocusRef.current = false;
    if (event.defaultPrevented || inert) return;
    const input = event.currentTarget;
    if (firstClick && query === null && input.value !== '' && input.selectionStart === input.selectionEnd) {
      input.select();
    }
    if (!isOpen) show('selected', 'pointer');
  };

  return (
    <div
      ref={rootRef}
      className={[s.root, isOpen && s.open, disabled && s.disabled, className].filter(Boolean).join(' ')}
      style={style}
    >
      <Input
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        {...rest}
        ref={setRef}
        id={id}
        form={form}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listed}
        aria-controls={listed ? listboxId : undefined}
        aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={s.input}
        value={query ?? committedText}
        disabled={disabled}
        readOnly={readOnly}
        invalid={invalid}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
      />
      <span className={s.chevron} aria-hidden>
        <ChevronDown size={14} />
      </span>
      {name !== undefined ? (
        <input type="hidden" name={name} form={form} value={value ?? ''} disabled={disabled} />
      ) : null}
      <span role="status" className={s.srOnly}>{status}</span>
      <PopoverPanel
        open={isOpen}
        anchorRef={rootRef}
        width="anchor"
        closeOnEscape={false}
        onDismiss={() => setOpen(false)}
        tabIndex={-1}
        onMouseDown={keepInputFocus}
      >
        {results.length > 0 ? (
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabelledBy ? undefined : ariaLabel ?? listLabel ?? 'Options'}
            aria-labelledby={ariaLabelledBy}
            className={s.listbox}
          >
            {results.map((option, index) => {
              const chosen = option.value === value;
              return (
                <div
                  key={option.value}
                  id={optionId(option)}
                  role="option"
                  aria-selected={chosen}
                  data-active={index === activeIndex ? (active.source === 'keyboard' ? 'keyboard' : 'pointer') : undefined}
                  className={s.option}
                  onMouseMove={() => hover(index)}
                  onClick={() => commit(option)}
                >
                  <span className={s.check} aria-hidden>
                    {chosen ? <Check size={14} /> : null}
                  </span>
                  <span className={s.text}>
                    <span className={s.label}>{option.label}</span>
                    {option.description ? <span className={s.description}>{option.description}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={s.empty}>{emptyText}</div>
        )}
        {hiddenCount > 0 ? <div className={s.hint}>{`Keep typing to narrow ${hiddenCount} more`}</div> : null}
      </PopoverPanel>
    </div>
  );
}) as <T extends ComboboxOption = ComboboxOption>(
  props: ComboboxProps<T> & RefAttributes<HTMLInputElement>,
) => ReactNode;
