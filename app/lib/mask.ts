export type MaskKind = 'account' | 'phone' | 'code' | 'generic';

export interface MaskForDisplayOptions {
  visible?: number;
  kind?: MaskKind;
  label?: string;
}

export interface MaskedDisplay {
  text: string;
  spoken: string;
  empty: boolean;
}

export type JsonLeafKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'function'
  | 'symbol'
  | 'masked'
  | 'circular'
  | 'unreadable';

export interface JsonLeaf {
  kind: JsonLeafKind;
  text: string;
  json: string | undefined;
}

export interface JsonBranch {
  kind: 'object' | 'array';
  value: object;
  keys: readonly string[];
  size: number;
  ancestors: readonly object[];
}

export type JsonInspection = JsonLeaf | JsonBranch;

export interface JsonChild {
  key: string | null;
  name: string;
  value: unknown;
}

export interface InspectJsonOptions {
  key?: string | null;
  name?: string;
  ancestors?: readonly object[];
  maskKeys?: ReadonlySet<string>;
}

export interface MaskedJsonOptions {
  maskKeys?: Iterable<string>;
  space?: number;
}

export const MASK = '••••';

export const METADATA_MASK_KEYS: readonly string[] = ['account_number', 'electricity_token'];

const MISSING = '—';
const NOT_PROVIDED = 'Not provided';
const DEFAULT_VISIBLE = 4;
const DEFAULT_SPACE = 2;
const MAX_SPACE = 10;
const CIRCULAR = '[Circular]';
const UNREADABLE_TEXT = '[Unreadable]';
const SPOKEN_CHAR = /^[0-9A-Za-z]$/;

const METADATA_KEYS: ReadonlySet<string> = new Set(METADATA_MASK_KEYS);
const NO_ANCESTORS: readonly object[] = [];
const NO_KEYS: readonly string[] = [];
const UNREADABLE: object = Object.freeze({});

const PHRASES: Readonly<Record<MaskKind, { ending: string; hidden: string }>> = {
  account: { ending: 'Account ending', hidden: 'Account number hidden' },
  phone: { ending: 'Phone number ending', hidden: 'Phone number hidden' },
  code: { ending: 'Code ending', hidden: 'Code hidden' },
  generic: { ending: 'Hidden, ending', hidden: 'Hidden' },
};

function compact(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, '') : '';
}

function visibleCount(visible: number): number {
  return Number.isFinite(visible) ? Math.max(0, Math.floor(visible)) : 0;
}

function tailOf(value: unknown, visible: number): string {
  const text = compact(value);
  const count = visibleCount(visible);
  return count > 0 && text.length > count ? text.slice(-count) : '';
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function phrasesFor(kind: MaskKind | undefined, label: string | undefined): { ending: string; hidden: string } {
  const noun = typeof label === 'string' ? label.trim() : '';
  if (noun) return { ending: `${noun} ending`, hidden: `${noun} hidden` };
  return kind && Object.prototype.hasOwnProperty.call(PHRASES, kind) ? PHRASES[kind] : PHRASES.generic;
}

function spell(tail: string): string {
  return Array.from(tail).filter((char) => SPOKEN_CHAR.test(char)).join(' ');
}

export function maskTail(value: unknown, visible: number = DEFAULT_VISIBLE): string {
  const tail = tailOf(value, visible);
  return tail ? `${MASK} ${tail}` : MASK;
}

export function isMaskable(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

export function maskForDisplay(value: unknown, options: MaskForDisplayOptions = {}): MaskedDisplay {
  if (isBlank(value)) return { text: MISSING, spoken: NOT_PROVIDED, empty: true };
  const tail = tailOf(value, options.visible ?? DEFAULT_VISIBLE);
  const phrases = phrasesFor(options.kind, options.label);
  const spoken = spell(tail);
  return {
    text: tail ? `${MASK} ${tail}` : MASK,
    spoken: spoken ? `${phrases.ending} ${spoken}` : phrases.hidden,
    empty: false,
  };
}

export function maskMetadata(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => maskMetadata(item));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = METADATA_KEYS.has(key) && isMaskable(inner) ? maskTail(inner) : maskMetadata(inner);
  }
  return out;
}

function leaf(kind: JsonLeafKind, text: string, json: string | undefined): JsonLeaf {
  return { kind, text, json };
}

function literal(kind: 'string' | 'number' | 'boolean' | 'null', text: string): JsonLeaf {
  return leaf(kind, text, text);
}

function marker(kind: 'masked' | 'circular' | 'unreadable', text: string): JsonLeaf {
  return leaf(kind, text, JSON.stringify(text));
}

function normalize(raw: unknown, name: string): unknown {
  let value = raw;
  if (typeof value === 'object' && value !== null) {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') value = toJSON.call(value, name);
  }
  if (value instanceof Number || value instanceof String || value instanceof Boolean) return value.valueOf();
  return value;
}

function classify(raw: unknown, name: string, ancestors: readonly object[]): JsonInspection {
  const value = normalize(raw, name);
  if (typeof value === 'string') return literal('string', JSON.stringify(value));
  if (typeof value === 'number') {
    return Number.isFinite(value) ? literal('number', JSON.stringify(value)) : leaf('number', String(value), 'null');
  }
  if (typeof value === 'bigint') return literal('number', value.toString());
  if (typeof value === 'boolean') return literal('boolean', value ? 'true' : 'false');
  if (typeof value === 'undefined') return leaf('undefined', 'undefined', undefined);
  if (typeof value === 'function') return leaf('function', value.name ? `[Function ${value.name}]` : '[Function]', undefined);
  if (typeof value === 'symbol') return leaf('symbol', value.toString(), undefined);
  if (value === null) return literal('null', 'null');
  const target = value as object;
  if (ancestors.includes(target)) return marker('circular', CIRCULAR);
  const chain = target === raw ? [...ancestors, target] : [...ancestors, raw as object, target];
  if (Array.isArray(target)) {
    return { kind: 'array', value: target, keys: NO_KEYS, size: target.length, ancestors: chain };
  }
  const keys = Object.keys(target);
  return { kind: 'object', value: target, keys, size: keys.length, ancestors: chain };
}

export function isJsonBranch(node: JsonInspection): node is JsonBranch {
  return node.kind === 'object' || node.kind === 'array';
}

export function inspectJson(value: unknown, options: InspectJsonOptions = {}): JsonInspection {
  const key = options.key ?? null;
  const ancestors = options.ancestors ?? NO_ANCESTORS;
  if (key !== null && options.maskKeys?.has(key) && isMaskable(value)) return marker('masked', MASK);
  if (value === UNREADABLE) return marker('unreadable', UNREADABLE_TEXT);
  if (typeof value === 'object' && value !== null && ancestors.includes(value)) return marker('circular', CIRCULAR);
  try {
    return classify(value, options.name ?? key ?? '', ancestors);
  } catch {
    return marker('unreadable', UNREADABLE_TEXT);
  }
}

export function jsonChildAt(branch: JsonBranch, index: number): JsonChild {
  const key = branch.kind === 'object' ? branch.keys[index] ?? null : null;
  const name = key ?? String(index);
  try {
    return { key, name, value: (branch.value as Record<string, unknown>)[name] };
  } catch {
    return { key, name, value: UNREADABLE };
  }
}

function spaceOf(space: number | undefined): string {
  const width = typeof space === 'number' && Number.isFinite(space)
    ? Math.min(MAX_SPACE, Math.max(0, Math.floor(space)))
    : DEFAULT_SPACE;
  return ' '.repeat(width);
}

function writeJson(node: JsonInspection, maskKeys: ReadonlySet<string>, indent: string, current: string): string | undefined {
  if (!isJsonBranch(node)) return node.json;
  const inner = current + indent;
  const parts: string[] = [];
  for (let index = 0; index < node.size; index += 1) {
    const child = jsonChildAt(node, index);
    const inspected = inspectJson(child.value, {
      key: child.key,
      name: child.name,
      ancestors: node.ancestors,
      maskKeys,
    });
    const text = writeJson(inspected, maskKeys, indent, inner);
    if (node.kind === 'array') parts.push(text ?? 'null');
    else if (text !== undefined) parts.push(`${JSON.stringify(child.name)}:${indent ? ' ' : ''}${text}`);
  }
  const open = node.kind === 'array' ? '[' : '{';
  const close = node.kind === 'array' ? ']' : '}';
  if (parts.length === 0) return open + close;
  if (!indent) return open + parts.join(',') + close;
  return `${open}\n${inner}${parts.join(`,\n${inner}`)}\n${current}${close}`;
}

export function toMaskedJson(value: unknown, options: MaskedJsonOptions = {}): string {
  const maskKeys: ReadonlySet<string> = new Set(options.maskKeys ?? NO_KEYS);
  return writeJson(inspectJson(value, { maskKeys }), maskKeys, spaceOf(options.space), '') ?? 'null';
}
