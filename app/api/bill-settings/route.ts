import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin } from '../../lib/guard';
import { writeAudit, type AuditInput, type AuditSensitivity } from '../../lib/audit';
import { fail, ok } from '../../lib/api';

const KEYS = [
  'airtime_quick_amounts',
  'electricity_quick_amounts',
  'min_airtime_amount',
  'min_electricity_amount',
];

const CSV_KEYS = new Set(['airtime_quick_amounts', 'electricity_quick_amounts']);
const ALLOWED = new Set(KEYS);
const ACTION = 'UPDATE_BILL_SETTINGS';
const ENTITY = 'app_config';
const SENSITIVITY: AuditSensitivity = 'financial';
const LOG_PREFIX = 'bill-settings';
const PUBLIC_CACHE_KEY = 'app_config:public';
const LOAD_FAILED = 'The settings could not be loaded. Try again.';
const READ_FAILED = 'The current values could not be read, so nothing was saved. Try again.';
const NOT_SAVED = 'The new values could not be written to the database. Reload to check the live values before trying again.';
const EXPECTED_SHAPE = 'expected must map each setting to the value you last saw.';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';

type Values = Record<string, string>;
type Stored = Map<string, string | null>;
type StoredRead = { ok: true; stored: Stored } | { ok: false };
type ExpectedRead = { ok: true; expected: Values | null } | { ok: false; message: string };
type PatchRead = { ok: true; changes: Values; expected: Values | null } | { ok: false; message: string };

interface ConfigRow {
  key: string;
  value: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function owns(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function invalidValue(key: string, raw: unknown): string | null {
  if (CSV_KEYS.has(key)) {
    if (typeof raw !== 'string') return `Invalid value for ${key}`;
    const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return `${key} cannot be empty`;
    for (const part of parts) {
      const n = Number(part);
      if (!Number.isFinite(n) || n < 0) return `Invalid number in ${key}: ${part}`;
    }
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? null : `Invalid value for ${key}`;
}

function seenValue(raw: unknown): string | null {
  if (raw === null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

function readExpected(raw: unknown, changes: Values): ExpectedRead {
  if (raw === undefined || raw === null) return { ok: true, expected: null };
  if (!isRecord(raw)) return { ok: false, message: EXPECTED_SHAPE };
  const expected: Values = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!owns(changes, key)) continue;
    const seen = seenValue(value);
    if (seen === null) return { ok: false, message: EXPECTED_SHAPE };
    expected[key] = seen;
  }
  return { ok: true, expected };
}

function readPatch(body: unknown): PatchRead {
  const changes = isRecord(body) ? body.changes : undefined;
  if (!changes || typeof changes !== 'object') return { ok: false, message: 'No changes' };
  const requested = changes as Record<string, unknown>;
  const keys = Object.keys(requested).filter((key) => ALLOWED.has(key));
  if (keys.length === 0) return { ok: false, message: 'Nothing to update' };
  const values: Values = {};
  for (const key of keys) {
    const problem = invalidValue(key, requested[key]);
    if (problem) return { ok: false, message: problem };
    values[key] = String(requested[key]);
  }
  const expected = readExpected(isRecord(body) ? body.expected : undefined, values);
  if (!expected.ok) return expected;
  return { ok: true, changes: values, expected: expected.expected };
}

async function readStored(keys: readonly string[]): Promise<StoredRead> {
  const { data, error } = await supabaseAdmin.from('app_config').select('key, value').in('key', [...keys]);
  if (error) {
    console.error(`${LOG_PREFIX} read:`, error.message);
    return { ok: false };
  }
  const stored: Stored = new Map();
  for (const row of (data ?? []) as ConfigRow[]) {
    if (typeof row.key === 'string') stored.set(row.key, typeof row.value === 'string' ? row.value : null);
  }
  return { ok: true, stored };
}

async function clearPublicCache(): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('edge_cache_delete', { p_key: PUBLIC_CACHE_KEY });
    if (error) console.error(`${LOG_PREFIX} cache clear:`, error.message);
  } catch (error) {
    console.error(`${LOG_PREFIX} cache clear:`, error instanceof Error ? error.message : String(error));
  }
}

function joinKeys(keys: readonly string[]): string {
  if (keys.length <= 1) return keys.join('');
  return `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`;
}

function conflictMessage(keys: readonly string[]): string {
  const subject = keys.length === 1 ? 'it' : 'them';
  return `Another admin changed ${joinKeys(keys)} after you loaded ${subject}, so nothing was saved. Reload to see the current values.`;
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

export async function GET() {
  const guard = await requireAdmin('providers.read');
  if (!guard.ok) return guard.response;

  const read = await readStored(KEYS);
  if (!read.ok) return fail('INTERNAL_ERROR', LOAD_FAILED);
  return ok({ config: Object.fromEntries(read.stored) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('providers.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body: unknown = await req.json().catch(() => null);
  const parsed = readPatch(body);
  if (!parsed.ok) return fail('VALIDATION_ERROR', parsed.message);
  const { changes, expected } = parsed;

  const read = await readStored(Object.keys(changes));
  if (!read.ok) return fail('INTERNAL_ERROR', READ_FAILED);
  const { stored } = read;

  const updates: Values = {};
  const unchanged: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (stored.get(key) === value) unchanged.push(key);
    else updates[key] = value;
  }
  const changed = Object.keys(updates);

  const conflicted = expected
    ? changed.filter((key) => owns(expected, key) && (stored.get(key) ?? '') !== expected[key])
    : [];
  if (conflicted.length > 0) {
    return fail('STATE_CONFLICT', conflictMessage(conflicted), {
      details: { conflicts: conflicted.map((key) => ({ key, current: stored.get(key) ?? null })) },
    });
  }

  if (changed.length === 0) return ok({ changed, unchanged });

  const before: Record<string, string | null> = {};
  for (const key of changed) before[key] = stored.get(key) ?? null;
  const audit: AuditInput = {
    admin,
    action: ACTION,
    entity: ENTITY,
    entity_id: changed.length === 1 ? changed[0] : 'batch',
    before,
    after: updates,
    sensitivity: SENSITIVITY,
  };

  const updatedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('app_config')
    .upsert(changed.map((key) => ({ key, value: updates[key], updated_at: updatedAt })), { onConflict: 'key' });
  if (error) {
    console.error(`${LOG_PREFIX} save failed:`, error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', NOT_SAVED);
  }

  await clearPublicCache();

  const recorded = await writeAudit({ ...audit, result: 'success' });
  return ok({ changed, unchanged, ...auditFields(recorded.ok) });
}
