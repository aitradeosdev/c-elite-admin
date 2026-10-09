'use client';

import {
  HTMLAttributes, MouseEvent, forwardRef, useEffect, useRef, useState,
} from 'react';
import { Check, Copy } from 'lucide-react';
import { formatNaira } from './Status';
import { useToast } from './Misc';
import s from './Value.module.css';

export type ValueSize = 'xs' | 'sm' | 'base' | 'md' | 'lg' | 'xl' | '2xl';
export type ValueEmphasis = 'strong' | 'primary' | 'secondary' | 'muted';
export type PercentScale = 'fraction' | 'percent';

export interface FormatMoneyOptions {
  signed?: boolean;
  compact?: boolean;
}

export interface FormatPercentOptions {
  scale?: PercentScale;
  decimals?: number;
  signed?: boolean;
}

type Direction = -1 | 0 | 1;

interface Formatted {
  text: string;
  direction: Direction;
  missing: boolean;
}

const MISSING = '—';
const MINUS = '−';
const ELLIPSIS = '…';
const NAIRA = '₦';
const COPIED_MS = 1500;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

const MISSING_PART: Formatted = { text: MISSING, direction: 0, missing: true };

const COMPACT_UNITS = [
  { size: 1e3, suffix: 'k' },
  { size: 1e6, suffix: 'm' },
  { size: 1e9, suffix: 'bn' },
  { size: 1e12, suffix: 'tn' },
];

const SIZE_CLASS: Record<ValueSize, string> = {
  xs: s.sizeXs,
  sm: s.sizeSm,
  base: s.sizeBase,
  md: s.sizeMd,
  lg: s.sizeLg,
  xl: s.sizeXl,
  '2xl': s.size2xl,
};

const EMPHASIS_CLASS: Record<ValueEmphasis, string> = {
  strong: s.strong,
  primary: s.primary,
  secondary: s.secondary,
  muted: s.muted,
};

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(style: 'decimal' | 'percent', minDigits: number, maxDigits: number): Intl.NumberFormat {
  const key = `${style}:${minDigits}:${maxDigits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat('en-NG', {
      style,
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    });
    numberFormats.set(key, format);
  }
  return format;
}

function toAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!DECIMAL.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

function withSign(magnitude: string, value: number, showPlus: boolean): Formatted {
  const direction: Direction = /[1-9]/.test(magnitude) ? (value < 0 ? -1 : 1) : 0;
  const prefix = direction < 0 ? MINUS : direction > 0 && showPlus ? '+' : '';
  return { text: prefix + magnitude, direction, missing: false };
}

function toKobo(abs: number): number {
  return Number(abs.toFixed(2));
}

function exactNaira(abs: number): string {
  return formatNaira(toKobo(abs));
}

function compactNaira(amount: number): string {
  const abs = toKobo(amount);
  if (abs < COMPACT_UNITS[0].size) return formatNaira(abs);
  let index = 0;
  while (index < COMPACT_UNITS.length - 1 && abs / COMPACT_UNITS[index].size >= 999.5) index += 1;
  const { size, suffix } = COMPACT_UNITS[index];
  const scaled = abs / size;
  return NAIRA + numberFormat('decimal', 0, scaled < 100 ? 1 : 0).format(scaled) + suffix;
}

function moneyParts(value: unknown, compact: boolean, showPlus: boolean): Formatted {
  const amount = toAmount(value);
  if (amount === null) return MISSING_PART;
  const abs = Math.abs(amount);
  return withSign(compact ? compactNaira(abs) : exactNaira(abs), amount, showPlus);
}

function percentDigits(decimals: unknown): number {
  if (typeof decimals !== 'number' || !Number.isFinite(decimals)) return 1;
  return Math.min(20, Math.max(0, Math.trunc(decimals)));
}

function percentParts(value: unknown, options: FormatPercentOptions): Formatted {
  const parsed = toAmount(value);
  if (parsed === null) return MISSING_PART;
  const digits = percentDigits(options.decimals);
  const abs = Math.abs(parsed);
  const magnitude = options.scale === 'percent'
    ? `${numberFormat('decimal', digits, digits).format(abs)}%`
    : numberFormat('percent', digits, digits).format(abs);
  return withSign(magnitude, parsed, options.signed === true);
}

function refText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function formatMoney(
  value: number | string | null | undefined,
  options: FormatMoneyOptions = {},
): string {
  return moneyParts(value, options.compact === true, options.signed === true).text;
}

export function formatCompactNaira(
  value: number | string | null | undefined,
  options: Pick<FormatMoneyOptions, 'signed'> = {},
): string {
  return moneyParts(value, true, options.signed === true).text;
}

export function formatPercent(
  value: number | string | null | undefined,
  options: FormatPercentOptions = {},
): string {
  return percentParts(value, options).text;
}

export function truncateRef(value: string | number | null | undefined, max = 12): string {
  const text = refText(value);
  if (!text) return MISSING;
  if (!Number.isFinite(max) || max < 1) return text;
  const chars = Array.from(text);
  const limit = Math.floor(max);
  return chars.length > limit ? chars.slice(0, limit).join('') + ELLIPSIS : text;
}

export function copyToClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') return Promise.resolve(false);
    return Promise.resolve(clipboard.writeText(text)).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

function valueClass(
  size: ValueSize | undefined,
  emphasis: ValueEmphasis | undefined,
  ...extra: Array<string | false | null | undefined>
): string {
  return [s.value, size && SIZE_CLASS[size], emphasis && EMPHASIS_CLASS[emphasis], ...extra]
    .filter(Boolean)
    .join(' ');
}

export interface MoneyProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: number | string | null | undefined;
  emphasis?: ValueEmphasis;
  signed?: boolean;
  compact?: boolean;
  size?: ValueSize;
}

export const Money = forwardRef<HTMLSpanElement, MoneyProps>(function Money(
  { value, emphasis, signed = false, compact = false, size, className, ...rest },
  ref,
) {
  const shown = moneyParts(value, compact, signed);
  const exact = compact && !shown.missing ? moneyParts(value, false, signed).text : shown.text;
  const abbreviated = exact !== shown.text;
  const tone = shown.missing
    ? s.missing
    : signed && shown.direction > 0
      ? s.positive
      : signed && shown.direction < 0
        ? s.negative
        : null;
  return (
    <span
      ref={ref}
      translate="no"
      title={abbreviated ? exact : undefined}
      {...rest}
      className={valueClass(size, emphasis, tone, className)}
    >
      {abbreviated ? (
        <>
          <span aria-hidden>{shown.text}</span>
          <span className={s.srOnly}>{exact}</span>
        </>
      ) : shown.text}
    </span>
  );
});

export interface PercentProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: number | string | null | undefined;
  scale?: PercentScale;
  decimals?: number;
  signed?: boolean;
  emphasis?: ValueEmphasis;
  size?: ValueSize;
}

export const Percent = forwardRef<HTMLSpanElement, PercentProps>(function Percent(
  { value, scale = 'fraction', decimals = 1, signed = false, emphasis, size, className, ...rest },
  ref,
) {
  const shown = percentParts(value, { scale, decimals, signed });
  return (
    <span
      ref={ref}
      translate="no"
      {...rest}
      className={valueClass(size, emphasis, shown.missing && s.missing, className)}
    >
      {shown.text}
    </span>
  );
});

export interface RefProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: string | number | null | undefined;
  truncate?: number;
  copyable?: boolean;
  label?: string;
  emphasis?: ValueEmphasis;
  size?: ValueSize;
}

export const Ref = forwardRef<HTMLSpanElement, RefProps>(function Ref(
  { value, truncate = 12, copyable = true, label = 'reference', emphasis, size, className, ...rest },
  ref,
) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const mountedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  const full = refText(value);
  if (!full) {
    return (
      <span ref={ref} translate="no" {...rest} className={valueClass(size, emphasis, s.missing, className)}>
        {MISSING}
      </span>
    );
  }

  const name = (typeof label === 'string' ? label.trim() : '') || 'reference';
  const shown = truncateRef(full, truncate);
  const truncated = shown !== full;

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    copyToClipboard(full).then((ok) => {
      if (!ok) {
        toast.show(`Could not copy the ${name} to the clipboard.`, 'error');
        return;
      }
      toast.show(`${name.charAt(0).toUpperCase()}${name.slice(1)} copied to the clipboard.`, 'success');
      if (!mountedRef.current) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      setCopied(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setCopied(false);
      }, COPIED_MS);
    });
  };

  return (
    <span ref={ref} translate="no" {...rest} className={valueClass(size, emphasis, s.ref, className)}>
      <span className={s.refText} title={full}>
        {truncated ? (
          <>
            <span aria-hidden>{shown}</span>
            <span className={s.srOnly}>{full}</span>
          </>
        ) : full}
      </span>
      {copyable ? (
        <button
          type="button"
          className={[s.copy, copied && s.copied].filter(Boolean).join(' ')}
          aria-label={`Copy ${name} ${full}`}
          onClick={handleCopy}
        >
          {copied
            ? <Check className={s.copyIcon} size="1em" strokeWidth={2.25} aria-hidden />
            : <Copy className={s.copyIcon} size="1em" strokeWidth={2} aria-hidden />}
        </button>
      ) : null}
    </span>
  );
});
