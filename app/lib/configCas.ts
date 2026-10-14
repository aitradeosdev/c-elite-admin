import { supabaseAdmin } from './supabase';

const CONFIG_CAS_FUNCTION = 'app_config_compare_and_set';

export const RACE_CONFLICT_MESSAGE =
  'Another admin changed these settings while you were saving, so nothing was saved. Reload to see the current values.';

const UNREADABLE = `${CONFIG_CAS_FUNCTION} returned a result in an unexpected shape`;

export type ConfigValues = Readonly<Record<string, string>>;

export type StoredConfig = Readonly<Record<string, string | null | undefined>>;

export interface ConfigCasRequest {
  changes: ConfigValues;
  expected: ConfigValues | null;
  privateKeys: readonly string[] | null;
  order: readonly string[];
}

export interface ConfigCasConflict {
  key: string;
  current: string | null;
}

export type ConfigCasOutcome =
  | { kind: 'applied'; changed: string[]; unchanged: string[]; before: Record<string, string | null> }
  | { kind: 'conflict'; conflicts: ConfigCasConflict[] }
  | { kind: 'failed'; outcomeUnknown: boolean; code: string | null; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function owns(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function rankBy(order: readonly string[]): (key: string) => number {
  const rank = new Map<string, number>();
  for (const key of order) if (!rank.has(key)) rank.set(key, rank.size);
  return (key) => rank.get(key) ?? rank.size;
}

export function inOrder(keys: readonly string[], order: readonly string[]): string[] {
  const rankOf = rankBy(order);
  return [...keys].sort((a, b) => rankOf(a) - rankOf(b));
}

export function pick<T>(values: Readonly<Record<string, T>>, keys: readonly string[]): Record<string, T> {
  const picked: Record<string, T> = {};
  for (const key of keys) if (owns(values, key)) picked[key] = values[key];
  return picked;
}

export function seenValues(current: StoredConfig, keys: readonly string[]): Record<string, string> {
  const seen: Record<string, string> = {};
  for (const key of keys) seen[key] = (owns(current, key) ? current[key] : null) ?? '';
  return seen;
}

function unreadable(): ConfigCasOutcome {
  return { kind: 'failed', outcomeUnknown: true, code: null, message: UNREADABLE };
}

export function readConfigCas(data: unknown, order: readonly string[]): ConfigCasOutcome {
  if (!isRecord(data)) return unreadable();
  if (data.applied === false) {
    const rows = Array.isArray(data.conflicts) ? data.conflicts : [];
    const conflicts: ConfigCasConflict[] = [];
    for (const row of rows) {
      if (!isRecord(row) || typeof row.key !== 'string') continue;
      conflicts.push({ key: row.key, current: typeof row.current === 'string' ? row.current : null });
    }
    const rankOf = rankBy(order);
    return { kind: 'conflict', conflicts: conflicts.sort((a, b) => rankOf(a.key) - rankOf(b.key)) };
  }
  if (data.applied !== true) return unreadable();
  const { changed, unchanged, before } = data;
  if (!isTextList(changed) || !isTextList(unchanged) || !isRecord(before)) return unreadable();
  const previous: Record<string, string | null> = {};
  for (const key of changed) {
    const value = owns(before, key) ? before[key] : null;
    previous[key] = typeof value === 'string' ? value : null;
  }
  return { kind: 'applied', changed: inOrder(changed, order), unchanged: inOrder(unchanged, order), before: previous };
}

function failure(code: unknown, message: unknown): ConfigCasOutcome {
  const known = typeof code === 'string' && code !== '' ? code : null;
  const text = typeof message === 'string' && message !== '' ? message : 'unknown error';
  return { kind: 'failed', outcomeUnknown: known === null, code: known, message: text };
}

export async function compareAndSet(request: ConfigCasRequest): Promise<ConfigCasOutcome> {
  try {
    const { data, error } = await supabaseAdmin.rpc(CONFIG_CAS_FUNCTION, {
      p_changes: { ...request.changes },
      p_expected: request.expected ? { ...request.expected } : null,
      p_private_keys: request.privateKeys ? [...request.privateKeys] : null,
    });
    if (error) return failure(error.code, error.message);
    return readConfigCas(data, request.order);
  } catch (error) {
    return failure(null, error instanceof Error ? error.message : String(error));
  }
}
