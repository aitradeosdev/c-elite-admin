export type InputFormat = 'card_number' | 'expiry_date' | 'cvv' | 'custom';

export interface FieldFormat {
  readonly kind: InputFormat;
  readonly mask: string;
}

export interface FieldEdit {
  readonly value: string;
  readonly caret: number | null;
}

export interface FieldSelection {
  readonly start: number;
  readonly end: number;
}

interface TextEdit {
  readonly start: number;
  readonly aEnd: number;
  readonly bEnd: number;
  readonly size: number;
}

export const INPUT_FORMATS: readonly InputFormat[] = ['card_number', 'expiry_date', 'cvv', 'custom'];
export const PATTERN_MAX = 64;
export const CARD_NUMBER_MIN = 13;
export const CVV_MIN = 3;

const CARD_MASK = '#### #### #### #### ###';
const EXPIRY_MASK = '##/##';
const CVV_MASK = '####';
const PRINTABLE = /^[ -~]+$/;
const LETTER_OR_DIGIT = /[0-9B-Za-z]/;

function isSlot(ch: string | undefined): boolean {
  return ch === '#' || ch === 'A' || ch === '*';
}

function isDigit(ch: string): boolean {
  return ch.length === 1 && ch >= '0' && ch <= '9';
}

function isLetter(ch: string): boolean {
  return ch.length === 1 && ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z'));
}

function fits(slot: string, ch: string): boolean {
  if (slot === '#') return isDigit(ch);
  if (slot === 'A') return isLetter(ch);
  return isDigit(ch) || isLetter(ch);
}

function filled(mask: string, value: string): number {
  let n = 0;
  for (let j = 0; j < value.length && j < mask.length; j += 1) if (isSlot(mask[j])) n += 1;
  return n;
}

function slotChars(mask: string, value: string): string {
  let out = '';
  for (let j = 0; j < value.length && j < mask.length; j += 1) if (isSlot(mask[j])) out += value[j];
  return out;
}

function caretAfter(mask: string, value: string, k: number): number {
  if (k === 0) {
    let j = 0;
    while (j < value.length && !isSlot(mask[j])) j += 1;
    return j;
  }
  let n = 0;
  for (let j = 0; j < value.length; j += 1) {
    if (isSlot(mask[j])) {
      n += 1;
      if (n === k) return j + 1;
    }
  }
  return value.length;
}

function diffOf(a: string, b: string): TextEdit {
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a[start] === b[start]) start += 1;
  let tail = 0;
  while (tail < max - start && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const aEnd = a.length - tail;
  const bEnd = b.length - tail;
  return { start, aEnd, bEnd, size: aEnd - start + (bEnd - start) };
}

function editAt(a: string, b: string, start: number, end: number): TextEdit | null {
  const inserted = b.length - a.length + end - start;
  if (start < 0 || end < start || end > a.length || inserted < 0) return null;
  if (b.slice(0, start) !== a.slice(0, start) || b.slice(start + inserted) !== a.slice(end)) return null;
  return { start, aEnd: end, bEnd: start + inserted, size: end - start + inserted };
}

function editFrom(a: string, b: string, selection: FieldSelection): TextEdit | null {
  if (selection.start === selection.end && b.length < a.length) {
    return editAt(a, b, selection.start - (a.length - b.length), selection.end);
  }
  return editAt(a, b, selection.start, selection.end);
}

export function isInputFormat(value: unknown): value is InputFormat {
  return typeof value === 'string' && (INPUT_FORMATS as readonly string[]).includes(value);
}

export function luhnValid(digits: string): boolean {
  if (digits === '') return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const ch = digits[i];
    if (!isDigit(ch)) return false;
    let d = ch.charCodeAt(0) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function patternProblem(pattern: string): string | null {
  if (pattern === '') return 'Enter the pattern users must follow.';
  if (pattern.length > PATTERN_MAX) return `Keep the pattern to ${PATTERN_MAX} characters or fewer.`;
  if (!PRINTABLE.test(pattern) || LETTER_OR_DIGIT.test(pattern)) {
    return 'Use only #, A and * for what users type, with spaces or symbols such as - / . between them.';
  }
  if (pattern[0] === ' ') return 'Remove the space at the start of the pattern.';
  if (!isSlot(pattern[pattern.length - 1])) return 'End the pattern with #, A or *.';
  return null;
}

export function fieldFormatOf(kind: unknown, pattern: unknown): FieldFormat | null {
  const noPattern = pattern === null || pattern === undefined;
  if (kind === 'card_number' && noPattern) return { kind, mask: CARD_MASK };
  if (kind === 'expiry_date' && noPattern) return { kind, mask: EXPIRY_MASK };
  if (kind === 'cvv' && noPattern) return { kind, mask: CVV_MASK };
  if (kind === 'custom' && typeof pattern === 'string' && patternProblem(pattern) === null) return { kind, mask: pattern };
  return null;
}

export function formatFieldValue(format: FieldFormat, raw: string): string {
  const mask = format.mask;
  let out = '';
  let pending = '';
  let m = 0;
  let i = 0;
  while (i < raw.length && m < mask.length) {
    const slot = mask[m];
    const ch = raw[i];
    if (!isSlot(slot)) {
      pending += slot;
      m += 1;
      if (ch === slot) i += 1;
      continue;
    }
    if (fits(slot, ch)) {
      out += pending + ch;
      pending = '';
      m += 1;
    }
    i += 1;
  }
  return out;
}

export function applyFieldEdit(
  format: FieldFormat,
  shown: string,
  lastRaw: string,
  raw: string,
  selection: FieldSelection | null,
): FieldEdit {
  if (raw === shown) return { value: shown, caret: null };
  const fromShown = diffOf(shown, raw);
  const fromRaw = diffOf(lastRaw, raw);
  const useShown = fromRaw.size === 0 || fromShown.size <= fromRaw.size;
  const anchored = useShown && selection !== null ? editFrom(shown, raw, selection) : null;
  const edit = anchored ?? (useShown ? fromShown : fromRaw);
  let next = raw;
  let caretRaw = edit.bEnd;
  if (
    useShown
    && edit.bEnd === edit.start
    && edit.aEnd - edit.start === 1
    && edit.start < format.mask.length
    && !isSlot(format.mask[edit.start])
    && formatFieldValue(format, raw) === shown
  ) {
    let j = edit.start - 1;
    while (j >= 0 && !isSlot(format.mask[j])) j -= 1;
    if (j < 0) return { value: shown, caret: edit.start };
    next = shown.slice(0, j) + shown.slice(j + 1);
    caretRaw = j;
  }
  const value = formatFieldValue(format, next);
  if (caretRaw >= next.length) return { value, caret: null };
  const k = filled(format.mask, formatFieldValue(format, next.slice(0, caretRaw)));
  return { value, caret: caretAfter(format.mask, value, k) };
}

export function isFieldValueComplete(format: FieldFormat, value: string): boolean {
  if (value === '' || formatFieldValue(format, value) !== value) return false;
  const chars = slotChars(format.mask, value);
  switch (format.kind) {
    case 'card_number':
      return chars.length >= CARD_NUMBER_MIN && luhnValid(chars);
    case 'expiry_date': {
      if (chars.length !== 4) return false;
      const month = Number(chars.slice(0, 2));
      return month >= 1 && month <= 12;
    }
    case 'cvv':
      return chars.length >= CVV_MIN;
    case 'custom':
      return chars.length === filled(format.mask, format.mask);
  }
}

export function isFieldValueFull(format: FieldFormat, value: string): boolean {
  return filled(format.mask, value) === filled(format.mask, format.mask);
}

export function fieldFormatExample(format: FieldFormat): string {
  if (format.kind === 'card_number') return '0000 0000 0000 0000';
  if (format.kind === 'expiry_date') return 'MM/YY';
  if (format.kind === 'cvv') return '000';
  let out = '';
  for (const ch of format.mask) out += ch === '#' ? '0' : ch === '*' ? 'X' : ch;
  return out;
}

export function fieldValueProblem(format: FieldFormat, value: string): string | null {
  if (value === '' || isFieldValueComplete(format, value)) return null;
  switch (format.kind) {
    case 'card_number':
      return 'Check the card number.';
    case 'expiry_date':
      return 'Enter a valid date as MM/YY.';
    case 'cvv':
      return 'Enter the 3 or 4 digit CVV.';
    case 'custom':
      return `Use this format: ${fieldFormatExample(format)}`;
  }
}

export function fieldFormatMaxLength(format: FieldFormat): number {
  return format.mask.length;
}

export function fieldFormatDigitsOnly(format: FieldFormat): boolean {
  return !format.mask.includes('A') && !format.mask.includes('*');
}
