import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireSuperAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit, type AuditInput, type AuditSensitivity } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import { RACE_CONFLICT_MESSAGE, compareAndSet, pick, type ConfigCasConflict } from '../../lib/configCas';

const KEYS = [
  'min_withdrawal_amount',
  'max_withdrawal_amount',
  'max_daily_withdrawal',
  'pin_reset_freeze_hours',
  'withdraw_fee',
  'large_withdrawal_flag_threshold',
  'max_wallet_adjustment_naira',
  'max_wallet_adjustment_daily_naira',
];

const PRIVATE_KEYS = ['max_wallet_adjustment_naira', 'max_wallet_adjustment_daily_naira'];

const ALLOWED = new Set(KEYS);
const WHOLE_NAIRA_KEYS = new Set(PRIVATE_KEYS);
const WHOLE_NAIRA = /^[1-9]\d*$/;
const WHOLE_NAIRA_MAX = 10_000_000_000;
const SECURITY_KEYS = new Set(['pin_reset_freeze_hours', 'large_withdrawal_flag_threshold']);
const ACTION = 'UPDATE_LIMITS_FEES';
const ENTITY = 'app_config';
const LOG_PREFIX = 'limits-fees';
const PUBLIC_CACHE_KEY = 'app_config:public';
const LOAD_FAILED = 'The settings could not be loaded. Try again.';
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
  if (WHOLE_NAIRA_KEYS.has(key)) {
    const text = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
    return WHOLE_NAIRA.test(text) && Number(text) <= WHOLE_NAIRA_MAX ? null : `Invalid value for ${key}`;
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

function sensitivityFor(keys: readonly string[]): AuditSensitivity {
  return keys.some((key) => SECURITY_KEYS.has(key)) ? 'security' : 'financial';
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

function auditOf(admin: AdminContext, keys: readonly string[]): AuditInput {
  return {
    admin,
    action: ACTION,
    entity: ENTITY,
    entity_id: keys.length === 1 ? keys[0] : 'batch',
    sensitivity: sensitivityFor(keys),
  };
}

function conflictResponse(conflicts: readonly ConfigCasConflict[]) {
  const message = conflicts.length > 0 ? conflictMessage(conflicts.map((conflict) => conflict.key)) : RACE_CONFLICT_MESSAGE;
  return fail('STATE_CONFLICT', message, { details: { conflicts } });
}

export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const read = await readStored(KEYS);
  if (!read.ok) return fail('INTERNAL_ERROR', LOAD_FAILED);
  return ok({ config: Object.fromEntries(read.stored) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body: unknown = await req.json().catch(() => null);
  const parsed = readPatch(body);
  if (!parsed.ok) return fail('VALIDATION_ERROR', parsed.message);
  const { changes, expected } = parsed;
  const requested = Object.keys(changes);

  const outcome = await compareAndSet({ changes, expected, privateKeys: PRIVATE_KEYS, order: requested });
  if (outcome.kind === 'conflict') return conflictResponse(outcome.conflicts);
  if (outcome.kind === 'failed') {
    console.error(`${LOG_PREFIX} save failed:`, outcome.message);
    await writeAudit({ ...auditOf(admin, requested), after: changes, result: 'failure', error: outcome.message });
    return fail('INTERNAL_ERROR', NOT_SAVED);
  }

  const { changed, unchanged } = outcome;
  if (changed.length === 0) return ok({ changed, unchanged });

  const audit: AuditInput = { ...auditOf(admin, changed), before: pick(outcome.before, changed), after: pick(changes, changed) };

  await clearPublicCache();

  const recorded = await writeAudit({ ...audit, result: 'success' });
  return ok({ changed, unchanged, ...auditFields(recorded.ok) });
}
