import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import {
  assembleRateTree, planRateWrite, readNewRange, readRateChanges, saveVerdict, storedValues,
  type CardRow, type CountryRow, type RateChangeInput, type RateResult, type StoredDenomination, type TypeRow,
} from '../../(dashboard)/rates/rateRules';

const PAGE_ROWS = 1000;
const MAX_PAGES = 100;
const READ_CHUNK = 100;
const WRITE_BATCH = 10;
const DENOMINATION_COLUMNS = 'id, card_type_id, range_label, min_value, max_value, rate_naira, is_active';

interface PageResponse {
  data: unknown[] | null;
  error: { message: string } | null;
  count?: number | null;
}

interface TypeContext {
  id: string;
  card_id: string | null;
  country_code: string | null;
  name: string | null;
}

interface Applied {
  result: RateResult;
  audit: AuditInput | null;
}

async function readAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<PageResponse>,
): Promise<T[] | null> {
  const rows: T[] = [];
  let total: number | null = null;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * PAGE_ROWS;
    const { data, error, count } = await page(from, from + PAGE_ROWS - 1);
    if (error) {
      console.error(`rates ${label} read:`, error.message);
      return null;
    }
    const batch = (data ?? []) as T[];
    if (total === null && typeof count === 'number') total = count;
    rows.push(...batch);
    const finished = total !== null ? rows.length >= total : batch.length < PAGE_ROWS;
    if (batch.length === 0 || finished) return rows;
  }
  console.error(`rates ${label} read: more than ${MAX_PAGES * PAGE_ROWS} rows`);
  return null;
}

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

function rangeContext(row: StoredDenomination) {
  return {
    card_type_id: row.card_type_id,
    range_label: row.range_label,
    min_value: row.min_value,
    max_value: row.max_value,
  };
}

function publicResult(id: string, status: RateResult['status'], row: StoredDenomination | null): RateResult {
  const values = row ? storedValues(row) : null;
  return {
    id,
    status,
    rate_naira: values ? values.rate : null,
    is_active: values ? values.active : null,
  };
}

async function readCurrent(ids: ReadonlyArray<string>): Promise<Map<string, StoredDenomination> | null> {
  const current = new Map<string, StoredDenomination>();
  for (let start = 0; start < ids.length; start += READ_CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('denominations')
      .select(DENOMINATION_COLUMNS)
      .in('id', ids.slice(start, start + READ_CHUNK));
    if (error) {
      console.error('rates current read:', error.message);
      return null;
    }
    for (const row of (data ?? []) as StoredDenomination[]) current.set(row.id, row);
  }
  return current;
}

async function readOne(id: string): Promise<StoredDenomination | null | undefined> {
  const { data, error } = await supabaseAdmin
    .from('denominations')
    .select(DENOMINATION_COLUMNS)
    .eq('id', id)
    .maybeSingle<StoredDenomination>();
  if (error) {
    console.error('rates row re-read:', error.message);
    return undefined;
  }
  return data ?? null;
}

async function writeGuarded(id: string, update: Record<string, unknown>, current: StoredDenomination) {
  let query = supabaseAdmin.from('denominations').update(update).eq('id', id);
  query = current.rate_naira === null ? query.is('rate_naira', null) : query.eq('rate_naira', current.rate_naira);
  query = current.is_active === null ? query.is('is_active', null) : query.eq('is_active', current.is_active);
  return query.select(DENOMINATION_COLUMNS);
}

async function applyChange(admin: AdminContext, change: RateChangeInput, initial: StoredDenomination | null): Promise<Applied> {
  let current = initial;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!current) return { result: publicResult(change.id, 'missing', null), audit: null };
    const plan = planRateWrite(change, current);
    if (plan.kind === 'conflict') return { result: publicResult(change.id, 'conflict', current), audit: null };
    if (plan.kind === 'unchanged') return { result: publicResult(change.id, 'unchanged', current), audit: null };

    const values = storedValues(current);
    const before = { rate_naira: values.rate, is_active: values.active, ...rangeContext(current) };
    const { data, error } = await writeGuarded(change.id, plan.update, current);
    if (error) {
      console.error('rate update:', change.id, error.message);
      return {
        result: publicResult(change.id, 'error', current),
        audit: {
          ...auditBase(admin, 'UPDATE_RATE', change.id),
          before,
          after: plan.update,
          result: 'failure',
          error: error.message,
        },
      };
    }
    const saved = ((data ?? []) as StoredDenomination[])[0];
    if (saved) {
      const after = storedValues(saved);
      return {
        result: publicResult(change.id, 'saved', saved),
        audit: {
          ...auditBase(admin, 'UPDATE_RATE', change.id),
          before,
          after: { rate_naira: after.rate, is_active: after.active },
          result: 'success',
        },
      };
    }

    const live = await readOne(change.id);
    if (live === undefined) return { result: publicResult(change.id, 'error', current), audit: null };
    if (change.expected) {
      return { result: publicResult(change.id, live ? 'conflict' : 'missing', live), audit: null };
    }
    current = live;
  }
  return { result: publicResult(change.id, 'conflict', current), audit: null };
}

export async function GET() {
  const guard = await requireAdmin('rates.read');
  if (!guard.ok) return guard.response;

  const [cards, countries, types, denominations] = await Promise.all([
    readAll<CardRow>('cards', (from, to) => supabaseAdmin
      .from('cards')
      .select('id, name, logo_url, is_active, sort_order', { count: 'exact' })
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, to)),
    readAll<CountryRow>('countries', (from, to) => supabaseAdmin
      .from('card_countries')
      .select('id, card_id, country_code, country_name, currency_symbol', { count: 'exact' })
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, to)),
    readAll<TypeRow>('types', (from, to) => supabaseAdmin
      .from('card_types')
      .select('id, card_id, country_code, name, sort_order', { count: 'exact' })
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, to)),
    readAll<StoredDenomination>('denominations', (from, to) => supabaseAdmin
      .from('denominations')
      .select(DENOMINATION_COLUMNS, { count: 'exact' })
      .order('id', { ascending: true })
      .range(from, to)),
  ]);

  if (!cards || !countries || !types || !denominations) {
    return fail('INTERNAL_ERROR', 'The rates could not be loaded. Try again.');
  }

  return ok({ cards: assembleRateTree(cards, countries, types, denominations) });
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

  const current = await readCurrent(changes.map((change) => change.id));
  if (!current) return fail('INTERNAL_ERROR', 'The current rates could not be read, so nothing was saved. Try again.');

  const applied = await inBatches(changes, WRITE_BATCH, (change) => applyChange(admin, change, current.get(change.id) ?? null));
  const audits = applied.flatMap((item) => (item.audit ? [item.audit] : []));
  const outcomes = await inBatches(audits, WRITE_BATCH, (input) => writeAudit(input));
  const recorded = outcomes.every((outcome) => outcome.ok);
  const results = applied.map((item) => item.result);
  const saved = results.filter((result) => result.status === 'saved').length;
  const unchanged = results.filter((result) => result.status === 'unchanged').length;
  const verdict = saveVerdict(results);

  if (!verdict.ok) {
    return fail(verdict.code, verdict.message, {
      details: {
        saved,
        unchanged,
        failed: results.length - saved - unchanged,
        results,
        audit_recorded: recorded,
        ...(recorded ? {} : { warning: 'Some of the saved changes could not be written to the audit log.' }),
      },
    });
  }

  return ok({
    saved,
    unchanged,
    results,
    ...auditFields(
      recorded,
      saved === 1
        ? 'The rate was saved, but the change could not be written to the audit log.'
        : 'The rates were saved, but some changes could not be written to the audit log.',
    ),
  });
}
