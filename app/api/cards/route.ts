import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import {
  checkCardCreate, checkCardPatch, checkCountryCreate, checkCountryPatch, diffFields, findBrandNamed, planReorder,
  readId, readReorderIds, sameBrandName,
  type ReorderStep,
} from '../../(dashboard)/cards/catalogRules';

const CARD_COLUMNS = 'id, name, logo_url, is_active, sort_order, created_at';
const COUNTRY_COLUMNS = 'id, card_id, country_code, country_name, currency_symbol, is_active';
const PAGE_ROWS = 1000;
const WRITE_BATCH = 10;
const UNIQUE_VIOLATION = '23505';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const COUNTRY_TAKEN = 'This country is already on this card.';

type Body = Record<string, unknown>;

interface CardRow {
  id: string;
  name: string | null;
  logo_url: string | null;
  is_active: boolean | null;
  sort_order: number | null;
  created_at: string | null;
}

interface CountryRow {
  id: string;
  card_id: string | null;
  country_code: string | null;
  country_name: string | null;
  currency_symbol: string | null;
  is_active: boolean | null;
}

interface NameRow {
  id: string;
  name: string | null;
}

type Rows<T> = { ok: true; rows: T[] } | { ok: false };

async function readBody(req: NextRequest): Promise<Body | null> {
  const raw: unknown = await req.json().catch(() => null);
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Body) : null;
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

function auditBase(admin: AdminContext, action: string, entity: string, entityId: string | null): AuditInput {
  return { admin, action, entity, entity_id: entityId, sensitivity: 'normal' };
}

function publicCountry(row: CountryRow) {
  return {
    id: row.id,
    country_code: row.country_code,
    country_name: row.country_name,
    currency_symbol: row.currency_symbol,
    is_active: row.is_active,
  };
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error) && (error?.code === UNIQUE_VIOLATION || /duplicate key|unique/i.test(error?.message ?? ''));
}

async function readAllCountries(): Promise<Rows<CountryRow>> {
  const rows: CountryRow[] = [];
  let total: number | null = null;
  while (total === null || rows.length < total) {
    const { data, error, count } = await supabaseAdmin
      .from('card_countries')
      .select(COUNTRY_COLUMNS, { count: 'exact' })
      .order('id', { ascending: true })
      .range(rows.length, rows.length + PAGE_ROWS - 1);
    if (error) {
      console.error('card countries list:', error.message);
      return { ok: false };
    }
    const page = (data ?? []) as CountryRow[];
    if (total === null) total = count ?? page.length;
    if (page.length === 0) break;
    rows.push(...page);
  }
  return { ok: true, rows };
}

async function readBrandNames(): Promise<Rows<NameRow>> {
  const { data, error } = await supabaseAdmin.from('cards').select('id, name');
  if (error) {
    console.error('card names read:', error.message);
    return { ok: false };
  }
  return { ok: true, rows: (data ?? []) as NameRow[] };
}

async function inBatches<T, R>(items: ReadonlyArray<T>, size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...await Promise.all(items.slice(start, start + size).map(run)));
  }
  return results;
}

export async function GET() {
  const guard = await requireAdmin('catalog.read');
  if (!guard.ok) return guard.response;

  const { data, error } = await supabaseAdmin
    .from('cards')
    .select(CARD_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    console.error('cards list:', error.message);
    return fail('INTERNAL_ERROR', 'The card catalog could not be loaded.');
  }

  const countries = await readAllCountries();
  if (!countries.ok) return fail('INTERNAL_ERROR', 'The countries for each brand could not be loaded.');

  const byCard = new Map<string, CountryRow[]>();
  for (const row of countries.rows) {
    if (!row.card_id) continue;
    const list = byCard.get(row.card_id);
    if (list) list.push(row);
    else byCard.set(row.card_id, [row]);
  }

  const cards = ((data ?? []) as CardRow[]).map((card) => ({
    ...card,
    countries: (byCard.get(card.id) ?? [])
      .slice()
      .sort((a, b) => (a.country_name ?? '').localeCompare(b.country_name ?? '', 'en'))
      .map(publicCountry),
  }));

  return ok({ cards });
}

async function createCard(admin: AdminContext, body: Body) {
  const checked = checkCardCreate(body);
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const card = checked.value;

  const names = await readBrandNames();
  if (!names.ok) return fail('INTERNAL_ERROR', 'Existing brand names could not be checked, so the brand was not added.');
  const clash = findBrandNamed(names.rows, card.name);
  if (clash) {
    return fail('STATE_CONFLICT', `A brand called “${clash.name}” already exists.`, { details: { id: clash.id } });
  }

  const audit: AuditInput = { ...auditBase(admin, 'CREATE_CARD', 'cards', null), after: card };
  const { data, error } = await supabaseAdmin.from('cards').insert(card).select(CARD_COLUMNS).single<CardRow>();
  if (error || !data) {
    const message = error?.message ?? 'No row was returned.';
    console.error('card create:', message);
    await writeAudit({ ...audit, result: 'failure', error: message });
    return fail('INTERNAL_ERROR', 'The brand could not be added.');
  }

  const recorded = await writeAudit({ ...audit, entity_id: data.id, result: 'success' });
  return ok({ id: data.id, card: { ...data, countries: [] }, ...auditFields(recorded.ok) });
}

async function addCountry(admin: AdminContext, body: Body) {
  const checked = checkCountryCreate(body);
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const country = checked.value;

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('cards')
    .select('id, name')
    .eq('id', country.card_id)
    .maybeSingle<NameRow>();
  if (brandError) {
    console.error('card country brand read:', brandError.message);
    return fail('INTERNAL_ERROR', 'The brand could not be read, so the country was not added.');
  }
  if (!brand) return fail('RESOURCE_NOT_FOUND', 'That brand no longer exists.');

  const audit: AuditInput = {
    ...auditBase(admin, 'ADD_CARD_COUNTRY', 'card_countries', null),
    after: { ...country, card_name: brand.name },
  };
  const { data, error } = await supabaseAdmin
    .from('card_countries')
    .insert(country)
    .select(COUNTRY_COLUMNS)
    .single<CountryRow>();
  if (isUniqueViolation(error)) return fail('STATE_CONFLICT', COUNTRY_TAKEN);
  if (error || !data) {
    const message = error?.message ?? 'No row was returned.';
    console.error('card country create:', message);
    await writeAudit({ ...audit, result: 'failure', error: message });
    return fail('INTERNAL_ERROR', 'The country could not be added.');
  }

  const recorded = await writeAudit({ ...audit, entity_id: data.id, result: 'success' });
  return ok({ id: data.id, country: publicCountry(data), ...auditFields(recorded.ok) });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin('catalog.write');
  if (!guard.ok) return guard.response;

  const body = await readBody(req);
  if (!body) return fail('VALIDATION_ERROR', 'Send the brand or country as a JSON object.');
  if (body.type === 'card') return createCard(guard.admin, body);
  if (body.type === 'country') return addCountry(guard.admin, body);
  return fail('VALIDATION_ERROR', 'Invalid type. Use card or country.');
}

async function updateCard(admin: AdminContext, body: Body) {
  const id = readId(body.id);
  if (!id) return fail('VALIDATION_ERROR', 'A valid brand id is required.');
  const checked = checkCardPatch(body);
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);

  const { data: before, error: readError } = await supabaseAdmin
    .from('cards')
    .select(CARD_COLUMNS)
    .eq('id', id)
    .maybeSingle<CardRow>();
  if (readError) {
    console.error('card read:', readError.message);
    return fail('INTERNAL_ERROR', 'The brand could not be read, so nothing was changed.');
  }
  if (!before) return fail('RESOURCE_NOT_FOUND', 'That brand no longer exists.');

  const diff = diffFields({ ...before }, checked.value);
  if (diff.fields.length === 0) return ok({ changed: false, card: before });

  const nextName = diff.after.name;
  if (nextName !== undefined && !sameBrandName(before.name ?? '', nextName)) {
    const names = await readBrandNames();
    if (!names.ok) return fail('INTERNAL_ERROR', 'Existing brand names could not be checked, so nothing was changed.');
    const clash = findBrandNamed(names.rows, nextName, id);
    if (clash) {
      return fail('STATE_CONFLICT', `A brand called “${clash.name}” already exists.`, { details: { id: clash.id } });
    }
  }

  const audit: AuditInput = { ...auditBase(admin, 'UPDATE_CARD', 'cards', id), before: diff.before, after: diff.after };
  const { data, error } = await supabaseAdmin
    .from('cards')
    .update(diff.after)
    .eq('id', id)
    .select(CARD_COLUMNS)
    .maybeSingle<CardRow>();
  if (error) {
    console.error('card update:', error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', 'The brand could not be saved.');
  }
  if (!data) return fail('RESOURCE_NOT_FOUND', 'That brand no longer exists.');

  const recorded = await writeAudit({ ...audit, result: 'success' });
  return ok({ changed: true, card: data, ...auditFields(recorded.ok) });
}

async function updateCountry(admin: AdminContext, body: Body) {
  const id = readId(body.id);
  if (!id) return fail('VALIDATION_ERROR', 'A valid country id is required.');
  const checked = checkCountryPatch(body);
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);

  const { data: before, error: readError } = await supabaseAdmin
    .from('card_countries')
    .select(COUNTRY_COLUMNS)
    .eq('id', id)
    .maybeSingle<CountryRow>();
  if (readError) {
    console.error('card country read:', readError.message);
    return fail('INTERNAL_ERROR', 'The country could not be read, so nothing was changed.');
  }
  if (!before) return fail('RESOURCE_NOT_FOUND', 'That country is no longer on this brand.');

  const diff = diffFields({ ...before }, checked.value);
  if (diff.fields.length === 0) return ok({ changed: false, country: publicCountry(before) });

  const audit: AuditInput = {
    ...auditBase(admin, 'UPDATE_CARD_COUNTRY', 'card_countries', id),
    before: { ...diff.before, card_id: before.card_id },
    after: { ...diff.after, card_id: before.card_id },
  };
  const { data, error } = await supabaseAdmin
    .from('card_countries')
    .update(diff.after)
    .eq('id', id)
    .select(COUNTRY_COLUMNS)
    .maybeSingle<CountryRow>();
  if (isUniqueViolation(error)) return fail('STATE_CONFLICT', COUNTRY_TAKEN);
  if (error) {
    console.error('card country update:', error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', 'The country could not be saved.');
  }
  if (!data) return fail('RESOURCE_NOT_FOUND', 'That country is no longer on this brand.');

  const recorded = await writeAudit({ ...audit, result: 'success' });
  return ok({ changed: true, country: publicCountry(data), ...auditFields(recorded.ok) });
}

function positionsOf(steps: ReadonlyArray<ReorderStep>, side: 'from' | 'to') {
  return steps.map((step) => ({ id: step.id, sort_order: step[side] }));
}

async function reorderCards(admin: AdminContext, body: Body) {
  const read = readReorderIds(body.ids);
  if (!read.ok) return fail('VALIDATION_ERROR', read.message);

  const { data, error } = await supabaseAdmin.from('cards').select('id, sort_order');
  if (error) {
    console.error('card order read:', error.message);
    return fail('INTERNAL_ERROR', 'The current order could not be read, so nothing was changed.');
  }

  const plan = planReorder((data ?? []) as Array<{ id: string; sort_order: number | null }>, read.ids);
  if (plan.missing.length > 0 || plan.extra.length > 0) {
    return fail('STATE_CONFLICT', 'The brand list has changed since you loaded it. Reload and try again.', {
      details: { missing: plan.missing, extra: plan.extra },
    });
  }
  if (plan.steps.length === 0) return ok({ changed: false, positions: [] });

  const movedId = readId(body.moved);
  const audit: AuditInput = {
    ...auditBase(admin, 'REORDER_CARDS', 'cards', movedId && read.ids.includes(movedId) ? movedId : null),
    before: { positions: positionsOf(plan.steps, 'from') },
    after: { positions: positionsOf(plan.steps, 'to') },
  };

  const results = await inBatches(plan.steps, WRITE_BATCH, async (step) => {
    const { error: writeError } = await supabaseAdmin.from('cards').update({ sort_order: step.to }).eq('id', step.id);
    return writeError ? writeError.message : null;
  });
  const failures = results.filter((message): message is string => message !== null);
  if (failures.length > 0) {
    const none = failures.length === plan.steps.length;
    console.error('card reorder:', failures[0]);
    await writeAudit({ ...audit, result: none ? 'failure' : 'partial', error: failures[0] });
    return fail(
      'INTERNAL_ERROR',
      none ? 'The new order could not be saved.' : 'Only part of the new order was saved. Reload to see the current order.',
      { details: { saved: plan.steps.length - failures.length, failed: failures.length } },
    );
  }

  const recorded = await writeAudit({ ...audit, result: 'success' });
  return ok({ changed: true, positions: positionsOf(plan.steps, 'to'), ...auditFields(recorded.ok) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('catalog.write');
  if (!guard.ok) return guard.response;

  const body = await readBody(req);
  if (!body) return fail('VALIDATION_ERROR', 'Send the changes as a JSON object.');
  if (body.type === 'card') return updateCard(guard.admin, body);
  if (body.type === 'country') return updateCountry(guard.admin, body);
  if (body.type === 'reorder') return reorderCards(guard.admin, body);
  return fail('VALIDATION_ERROR', 'Invalid type. Use card, country or reorder.');
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin('catalog.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body = await readBody(req);
  if (!body) return fail('VALIDATION_ERROR', 'Send the country to remove as a JSON object.');
  if (body.type !== 'country') {
    return fail('VALIDATION_ERROR', 'Invalid type. Only countries can be removed; deactivate a brand to hide it.');
  }
  const id = readId(body.id);
  if (!id) return fail('VALIDATION_ERROR', 'A valid country id is required.');

  const { data: before, error: readError } = await supabaseAdmin
    .from('card_countries')
    .select(COUNTRY_COLUMNS)
    .eq('id', id)
    .maybeSingle<CountryRow>();
  if (readError) {
    console.error('card country read:', readError.message);
    return fail('INTERNAL_ERROR', 'The country could not be read, so nothing was removed.');
  }
  if (!before) return fail('RESOURCE_NOT_FOUND', 'That country is no longer on this brand.');

  const audit: AuditInput = { ...auditBase(admin, 'REMOVE_CARD_COUNTRY', 'card_countries', id), before };
  const { error } = await supabaseAdmin.from('card_countries').delete().eq('id', id);
  if (error) {
    console.error('card country delete:', error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', 'The country could not be removed.');
  }

  const recorded = await writeAudit({ ...audit, result: 'success' });
  return ok({ id, ...auditFields(recorded.ok) });
}
