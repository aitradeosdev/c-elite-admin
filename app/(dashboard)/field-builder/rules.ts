import { isUuid } from '../../lib/http';

export const INPUT_TYPES = ['text', 'image', 'image_text'] as const;

export type InputType = (typeof INPUT_TYPES)[number];

export const INPUT_TYPE_LABELS: Readonly<Record<InputType, string>> = {
  text: 'Text',
  image: 'Image upload',
  image_text: 'Image and text',
};

export const INPUT_TYPE_HINTS: Readonly<Record<InputType, string>> = {
  text: 'Users type a value, such as the card code.',
  image: 'Users upload a photo, such as the front of the card.',
  image_text: 'Users upload a photo and type a value.',
};

export const NAME_MAX = 80;
export const LABEL_MAX = 120;
export const REORDER_MAX = 200;
export const SORT_ORDER_MAX = 100000;

const COUNTRY_CODE = /^[A-Za-z]{2,3}$/;

export type MoveDirection = 'up' | 'down';

export type ReorderRefusal = 'empty' | 'too_many' | 'duplicate' | 'mismatch';

export function isInputType(value: unknown): value is InputType {
  return typeof value === 'string' && (INPUT_TYPES as readonly string[]).includes(value);
}

export function inputTypeLabel(value: string | null | undefined): string {
  return isInputType(value) ? INPUT_TYPE_LABELS[value] : 'Unknown type';
}

export function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function textKey(value: string | null | undefined): string {
  return cleanText(value ?? '').normalize('NFC').toLocaleLowerCase('en');
}

export function nameProblem(name: string): string | null {
  if (!name) return 'Enter a name for the card type.';
  if (name.length > NAME_MAX) return `Keep the name to ${NAME_MAX} characters or fewer.`;
  return null;
}

export function labelProblem(label: string): string | null {
  if (!label) return 'Enter a label for the field.';
  if (label.length > LABEL_MAX) return `Keep the label to ${LABEL_MAX} characters or fewer.`;
  return null;
}

export function findDuplicate<T extends { id: string }>(
  items: readonly T[],
  text: (item: T) => string | null | undefined,
  candidate: string,
  exceptId: string | null = null,
): T | null {
  const key = textKey(candidate);
  if (!key) return null;
  const except = exceptId ? exceptId.toLowerCase() : null;
  return items.find((item) => item.id.toLowerCase() !== except && textKey(text(item)) === key) ?? null;
}

export function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return COUNTRY_CODE.test(code) ? code.toUpperCase() : null;
}

export function sameCountryCode(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a) && Boolean(b) && String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
}

export function parseIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (!isUuid(item)) return null;
    ids.push(item.toLowerCase());
  }
  return ids;
}

export function parseSortOrder(value: unknown): number | null {
  const raw = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 0 && raw <= SORT_ORDER_MAX ? raw : null;
}

export function moveId(ids: readonly string[], id: string, direction: MoveDirection): string[] | null {
  const index = ids.indexOf(id);
  if (index < 0) return null;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return null;
  const next = ids.slice();
  next[index] = ids[target];
  next[target] = id;
  return next;
}

export function reorderRefusalText(reason: ReorderRefusal, noun: string): string {
  switch (reason) {
    case 'empty':
      return `Send the full list of ${noun} in their new order.`;
    case 'too_many':
      return `Reorder at most ${REORDER_MAX} ${noun} at a time.`;
    case 'duplicate':
      return `Each of the ${noun} can appear only once in the new order.`;
    case 'mismatch':
      return `The ${noun} changed since you loaded them. Reload and try again.`;
  }
}
