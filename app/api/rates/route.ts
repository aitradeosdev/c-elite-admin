import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import { DENOMINATION_COLUMNS, loadRateTree } from '../../lib/rateTree';
import { ratesAutomatic, readRateSync } from '../../lib/rateSync';
import {
  NO_CHANGES_MESSAGE, TOO_MANY_CHANGES_MESSAGE, conflictMessage, rateChangeProblem, readNewRange, readRateChanges,
  storedValues,
  type RateChangeInput, type RateResult, type RateValues, type StoredDenomination,
} from '../../(dashboard)/rates/rateRules';

const AUDIT_BATCH = 10;
const NOT_SAVED = 'The database did not accept the rate changes, so nothing was saved. Try again.';
const UNCONFIRMED = 'The save could not be confirmed. Reload the rates to check them before trying again.';

interface TypeContext {
  id: string;
  card_id: string | null;
  country_code: string | null;
  name: string | null;
}

type RangeContext = Pick<StoredDenomination, 'card_type_id' | 'range_label' | 'min_value' | 'max_value'>;

interface SavedRow {
  id: string;
  status: 'saved' | 'unchanged';
  after: RateValues;
  before: RateValues;
  context: RangeContext;
}

interface ConflictRow {
  id: string;
  status: 'conflict' | 'missing';
  live: RateValues | null;
}

interface InvalidRow {
  index: number;
  id: string | null;
  reason: string;
}

type SaveResult =
  | { applied: true; saved: string[]; unchanged: string[]; results: SavedRow[] }
  | { applied: false; conflicts: ConflictRow[]; invalid: InvalidRow[]; unchanged: string[] };

async function inBatches<T, R>(items: ReadonlyArray<T>, size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...await Promise.all(items.slice(start, start + size).map(run)));
  }
  return results;
}

async function readBody(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => null);
}

function auditFields(recorded: boolean, warning: string) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning };
}

function auditBase(admin: AdminContext, action: string, entityId: string | null): AuditInput {
  return { admin, action, entity: 'denominations', entity_id: entityId, sensitivity: 'financial' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function idList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    ids.push(item);
  }
  return ids;
}

function readEach<T>(value: unknown, read: (row: Record<string, unknown>) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const rows: T[] = [];
  for (const item of value) {
    const row = isRecord(item) ? read(item) : null;
    if (row === null) return null;
    rows.push(row);
  }
  return rows;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function amountOrNull(value: unknown): number | string | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

function savedRow(row: Record<string, unknown>): SavedRow | null {
  const { id, status, before } = row;
  if (typeof id !== 'string' || (status !== 'saved' && status !== 'unchanged') || !isRecord(before)) return null;
  return {
    id,
    status,
    after: storedValues(row),
    before: storedValues(before),
    context: {
      card_type_id: textOrNull(row.card_type_id),
      range_label: textOrNull(row.range_label),
      min_value: amountOrNull(row.min_value),
      max_value: amountOrNull(row.max_value),
    },
  };
}

function conflictRow(row: Record<string, unknown>): ConflictRow | null {
  const { id, status } = row;
  if (typeof id !== 'string' || (status !== 'conflict' && status !== 'missing')) return null;
  return { id, status, live: status === 'missing' ? null : storedValues(row) };
}

function invalidRow(row: Record<string, unknown>): InvalidRow | null {
  const { index, id, reason } = row;
  if (typeof index !== 'number' || !Number.isInteger(index) || typeof reason !== 'string') return null;
  return { index, id: textOrNull(id), reason };
}

function readSaveResult(data: unknown): SaveResult | null {
  if (!isRecord(data)) return null;
  const unchanged = idList(data.unchanged);
  if (!unchanged) return null;
  if (data.applied === true) {
    const saved = idList(data.saved);
    const results = readEach(data.results, savedRow);
    return saved && results ? { applied: true, saved, unchanged, results } : null;
  }
  if (data.applied !== false) return null;
  const conflicts = readEach(data.conflicts, conflictRow);
  const invalid = readEach(data.invalid, invalidRow);
  if (!conflicts || !invalid || conflicts.length + invalid.length === 0) return null;
  return { applied: false, conflicts, invalid, unchanged };
}

function rpcChanges(changes: ReadonlyArray<RateChangeInput>) {
  return changes.map((change) => ({
    id: change.id,
    rate_naira: change.rate,
    is_active: change.active,
    expected: change.expected ? { rate_naira: change.expected.rate, is_active: change.expected.active } : null,
  }));
}

function requestedUpdate(change: RateChangeInput) {
  return change.active === null ? { rate_naira: change.rate } : { rate_naira: change.rate, is_active: change.active };
}

function publicResult(row: SavedRow): RateResult {
  return { id: row.id, status: row.status, rate_naira: row.after.rate, is_active: row.after.active };
}

function conflictResults(
  changes: ReadonlyArray<RateChangeInput>,
  conflicts: ReadonlyArray<ConflictRow>,
  unchanged: ReadonlyArray<string>,
): RateResult[] {
  const conflictById = new Map(conflicts.map((row) => [row.id, row]));
  const live = new Set(unchanged);
  return changes.flatMap((change): RateResult[] => {
    const conflict = conflictById.get(change.id);
    if (conflict) {
      return [{
        id: change.id,
        status: conflict.status,
        rate_naira: conflict.live ? conflict.live.rate : null,
        is_active: conflict.live ? conflict.live.active : null,
      }];
    }
    if (live.has(change.id)) return [{ id: change.id, status: 'unchanged', rate_naira: change.rate, is_active: change.active }];
    return [];
  });
}

function savedAudit(admin: AdminContext, row: SavedRow): AuditInput {
  return {
    ...auditBase(admin, 'UPDATE_RATE', row.id),
    before: { rate_naira: row.before.rate, is_active: row.before.active, ...row.context },
    after: { rate_naira: row.after.rate, is_active: row.after.active },
    result: 'success',
  };
}

async function saveFailure(admin: AdminContext, changes: ReadonlyArray<RateChangeInput>, message: string) {
  if (message === 'Not authorized') return fail('AUTH_REQUIRED');
  if (message === 'No rate changes provided') return fail('VALIDATION_ERROR', NO_CHANGES_MESSAGE);
  if (message === 'Too many rate changes') return fail('VALIDATION_ERROR', TOO_MANY_CHANGES_MESSAGE);
  console.error('admin_save_rates:', message);
  await inBatches(changes, AUDIT_BATCH, (change) => writeAudit({
    ...auditBase(admin, 'UPDATE_RATE', change.id),
    after: requestedUpdate(change),
    result: 'failure',
    error: message,
  }));
  return fail('INTERNAL_ERROR', NOT_SAVED);
}

export async function GET() {
  const guard = await requireAdmin('rates.read');
  if (!guard.ok) return guard.response;

  const [cards, status] = await Promise.all([loadRateTree(), readRateSync('rate_sync_status')]);
  if (!cards || !status) {
    return fail('INTERNAL_ERROR', 'The rates could not be loaded. Try again.');
  }

  return ok({ cards, automatic: ratesAutomatic(status) });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin('rates.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const checked = readNewRange(await readBody(req));
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const range = checked.value;

  const { data: type, error: typeError } = await supabaseAdmin
    .from('card_types')
    .select('id, card_id, country_code, name')
    .eq('id', range.card_type_id)
    .maybeSingle<TypeContext>();
  if (typeError) {
    console.error('rates card type read:', typeError.message);
    return fail('INTERNAL_ERROR', 'The card type could not be checked, so the range was not added.');
  }
  if (!type) return fail('RESOURCE_NOT_FOUND', 'That card type no longer exists, so the range was not added.');

  const context = { card_id: type.card_id, country_code: type.country_code, card_type: type.name };
  const audit: AuditInput = { ...auditBase(admin, 'CREATE_DENOMINATION', null), after: { ...range, ...context } };

  const { data, error } = await supabaseAdmin
    .from('denominations')
    .insert(range)
    .select(DENOMINATION_COLUMNS)
    .single<StoredDenomination>();
  if (error || !data) {
    const message = error?.message ?? 'No row was returned.';
    console.error('rates range create:', message);
    await writeAudit({ ...audit, result: 'failure', error: message });
    return fail('INTERNAL_ERROR', 'The range could not be added. Try again.');
  }

  const recorded = await writeAudit({
    ...audit,
    entity_id: data.id,
    after: { ...data, ...context },
    result: 'success',
  });

  return ok({
    id: data.id,
    denomination: {
      id: data.id,
      range_label: data.range_label,
      min_value: data.min_value,
      max_value: data.max_value,
      rate_naira: data.rate_naira,
      is_active: data.is_active,
    },
    ...auditFields(recorded.ok, 'The range was added, but it could not be written to the audit log.'),
  });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('rates.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const checked = readRateChanges(await readBody(req));
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const changes = checked.value;

  const { data, error } = await supabaseAdmin.rpc('admin_save_rates', {
    p_admin_id: admin.admin_id,
    p_changes: rpcChanges(changes),
  });
  if (error) return saveFailure(admin, changes, error.message);

  const result = readSaveResult(data);
  if (!result) {
    console.error('admin_save_rates: the result did not have the expected shape.');
    return fail('INTERNAL_ERROR', UNCONFIRMED);
  }

  if (!result.applied) {
    if (result.invalid.length > 0) {
      const first = result.invalid[0];
      return fail('VALIDATION_ERROR', rateChangeProblem(first.reason, first.index + 1, first.id), {
        details: { invalid: result.invalid },
      });
    }
    const results = conflictResults(changes, result.conflicts, result.unchanged);
    const conflicts = results.filter((row) => row.status === 'conflict' || row.status === 'missing').length;
    return fail('STATE_CONFLICT', conflictMessage(changes.length, conflicts), {
      details: {
        saved: 0,
        unchanged: result.unchanged.length,
        failed: changes.length - result.unchanged.length,
        results,
        audit_recorded: true,
      },
    });
  }

  const written = result.results.filter((row) => row.status === 'saved');
  const outcomes = await inBatches(written, AUDIT_BATCH, (row) => writeAudit(savedAudit(admin, row)));
  const recorded = outcomes.every((outcome) => outcome.ok);

  return ok({
    saved: result.saved.length,
    unchanged: result.unchanged.length,
    results: result.results.map(publicResult),
    ...auditFields(
      recorded,
      result.saved.length === 1
        ? 'The rate was saved, but the change could not be written to the audit log.'
        : 'The rates were saved, but some changes could not be written to the audit log.',
    ),
  });
}
