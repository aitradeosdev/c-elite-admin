import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, isUuid, ok } from '../../lib/api';
import {
  cleanText, findDuplicate, isInputType, labelProblem, nameProblem, normalizeCountryCode, parseIdList,
  parseSortOrder, planReorder, reorderRefusalText, sameCountryCode,
  type InputType, type Ordered, type SortUpdate,
} from '../../(dashboard)/field-builder/rules';

const TEMPLATES = 'card_type_templates';
const FIELDS = 'card_type_template_fields';
const INSTALLS = 'card_types';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const CHANGED_ELSEWHERE = 'This changed while you were working on it. Reload and try again.';

type Body = Record<string, unknown>;

interface QueryError {
  message?: string;
}

interface CardRow {
  id: string;
  name: string | null;
  logo_url: string | null;
  is_active: boolean | null;
  sort_order?: number | null;
}

interface TemplateRow {
  id: string;
  card_id: string;
  name: string;
  is_active: boolean | null;
  sort_order: number | null;
}

interface FieldRow {
  id: string;
  template_id: string;
  label: string | null;
  input_type: string | null;
  is_required: boolean | null;
  sort_order: number | null;
}

interface InstallRow {
  id: string;
  template_id: string | null;
  card_id?: string | null;
  country_code: string | null;
  name?: string | null;
  is_active: boolean | null;
}

interface InstallFieldRow {
  card_type_id: string;
  label: string | null;
  input_type: string | null;
  is_required: boolean | null;
  sort_order: number | null;
}

interface CountryRow {
  country_code: string | null;
  country_name: string | null;
  is_active: boolean | null;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function uuidOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return isUuid(id) ? id.toLowerCase() : null;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

async function readBody(req: NextRequest): Promise<Body | null> {
  const body: unknown = await req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Body) : null;
}

function invalid(message: string, field?: string) {
  return fail('VALIDATION_ERROR', message, field ? { details: { field } } : undefined);
}

function serverError(context: string, message: string, error: QueryError | null | undefined) {
  console.error(`field-builder ${context}:`, error?.message ?? 'no row returned');
  return fail('INTERNAL_ERROR', message);
}

function audit(admin: AdminContext, input: Omit<AuditInput, 'admin'>) {
  return writeAudit({ admin, ...input });
}

function auditResult(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

function nextSortOrder(items: readonly { sort_order: number | null }[]): number {
  return items.reduce((max, item) => Math.max(max, typeof item.sort_order === 'number' ? item.sort_order : -1), -1) + 1;
}

async function applySortOrders(table: string, scope: { column: string; value: string }, updates: readonly SortUpdate[]) {
  const results = await Promise.all(updates.map((update) => (
    supabaseAdmin.from(table).update({ sort_order: update.sort_order }).eq('id', update.id).eq(scope.column, scope.value)
  )));
  const errors = results.map((result) => result.error).filter((error): error is NonNullable<typeof error> => Boolean(error));
  return { failed: errors.length, error: errors[0]?.message ?? null };
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin('card_types.read');
  if (!guard.ok) return guard.response;

  const raw = (new URL(req.url).searchParams.get('card_id') ?? '').trim();
  if (!raw) return listCards();
  const cardId = uuidOf(raw);
  if (!cardId) return invalid('card_id must be the id of a card.', 'card_id');
  return readBuilder(cardId);
}

async function listCards() {
  const [cards, templates] = await Promise.all([
    supabaseAdmin
      .from('cards')
      .select('id, name, logo_url, is_active, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabaseAdmin.from(TEMPLATES).select('card_id'),
  ]);
  if (cards.error) return serverError('list cards', 'The cards could not be loaded.', cards.error);
  if (templates.error) console.error('field-builder count templates:', templates.error.message);

  const counts = new Map<string, number>();
  for (const row of rows<{ card_id: string | null }>(templates.data)) {
    if (row.card_id) counts.set(row.card_id, (counts.get(row.card_id) ?? 0) + 1);
  }

  return ok({
    cards: rows<CardRow>(cards.data).map((card) => ({
      id: card.id,
      name: card.name,
      logo_url: card.logo_url,
      is_active: card.is_active,
      template_count: templates.error ? null : counts.get(card.id) ?? 0,
    })),
  });
}

async function readBuilder(cardId: string) {
  const [card, templates, countries] = await Promise.all([
    supabaseAdmin.from('cards').select('id, name, logo_url, is_active').eq('id', cardId).maybeSingle<CardRow>(),
    supabaseAdmin
      .from(TEMPLATES)
      .select('id, card_id, name, is_active, sort_order')
      .eq('card_id', cardId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    supabaseAdmin
      .from('card_countries')
      .select('country_code, country_name, is_active')
      .eq('card_id', cardId)
      .order('country_name', { ascending: true }),
  ]);
  if (card.error) return serverError('read card', 'The card could not be loaded.', card.error);
  if (!card.data) return fail('RESOURCE_NOT_FOUND', 'That card no longer exists.');
  if (templates.error) return serverError('read templates', 'The card types could not be loaded.', templates.error);
  if (countries.error) return serverError('read countries', 'The card’s countries could not be loaded.', countries.error);

  const templateRows = rows<TemplateRow>(templates.data);
  const templateIds = templateRows.map((template) => template.id);
  let fieldRows: FieldRow[] = [];
  let installRows: InstallRow[] = [];
  if (templateIds.length > 0) {
    const [fields, installs] = await Promise.all([
      supabaseAdmin
        .from(FIELDS)
        .select('id, template_id, label, input_type, is_required, sort_order')
        .in('template_id', templateIds)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true }),
      supabaseAdmin
        .from(INSTALLS)
        .select('id, template_id, country_code, is_active')
        .in('template_id', templateIds)
        .order('country_code', { ascending: true }),
    ]);
    if (fields.error) return serverError('read fields', 'The card type fields could not be loaded.', fields.error);
    if (installs.error) return serverError('read installs', 'The card type countries could not be loaded.', installs.error);
    fieldRows = rows<FieldRow>(fields.data);
    installRows = rows<InstallRow>(installs.data);
  }

  const installIds = installRows.map((install) => install.id);
  let detail: { fields: Map<string, InstallFieldRow[]>; rates: Map<string, number> } | null = {
    fields: new Map(),
    rates: new Map(),
  };
  if (installIds.length > 0) {
    const [installFields, denominations] = await Promise.all([
      supabaseAdmin
        .from('card_type_fields')
        .select('card_type_id, label, input_type, is_required, sort_order')
        .in('card_type_id', installIds)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true }),
      supabaseAdmin.from('denominations').select('card_type_id, is_active').in('card_type_id', installIds),
    ]);
    if (installFields.error || denominations.error) {
      console.error(
        'field-builder read install detail:',
        installFields.error?.message ?? denominations.error?.message ?? 'unknown error',
      );
      detail = null;
    } else {
      const rates = new Map<string, number>();
      for (const row of rows<{ card_type_id: string; is_active: boolean | null }>(denominations.data)) {
        if (row.is_active === true) rates.set(row.card_type_id, (rates.get(row.card_type_id) ?? 0) + 1);
      }
      detail = { fields: groupBy(rows<InstallFieldRow>(installFields.data), (row) => row.card_type_id), rates };
    }
  }

  const brandCountries = rows<CountryRow>(countries.data);
  const countryName = (code: string | null) => (
    brandCountries.find((country) => sameCountryCode(country.country_code, code))?.country_name ?? null
  );
  const fieldsByTemplate = groupBy(fieldRows, (field) => field.template_id);
  const installsByTemplate = groupBy(installRows, (install) => install.template_id);

  return ok({
    card: {
      id: card.data.id,
      name: card.data.name,
      logo_url: card.data.logo_url,
      is_active: card.data.is_active,
    },
    templates: templateRows.map((template) => ({
      id: template.id,
      name: template.name,
      is_active: template.is_active,
      sort_order: template.sort_order,
      fields: (fieldsByTemplate.get(template.id) ?? []).map((field) => ({
        id: field.id,
        label: field.label,
        input_type: field.input_type,
        is_required: field.is_required,
        sort_order: field.sort_order,
      })),
      countries: (installsByTemplate.get(template.id) ?? []).map((install) => ({
        id: install.id,
        country_code: install.country_code,
        is_active: install.is_active,
        country_name: countryName(install.country_code),
        active_rate_count: detail ? detail.rates.get(install.id) ?? 0 : null,
        fields: detail
          ? (detail.fields.get(install.id) ?? []).map((field) => ({
              label: field.label,
              input_type: field.input_type,
              is_required: field.is_required,
              sort_order: field.sort_order,
            }))
          : null,
      })),
    })),
    countries: brandCountries
      .filter((country) => country.is_active === true)
      .map((country) => ({
        country_code: country.country_code,
        country_name: country.country_name,
        is_active: country.is_active,
      })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin('card_types.write');
  if (!guard.ok) return guard.response;
  const body = await readBody(req);
  if (!body) return invalid('Send the change as a JSON object.');

  switch (body.type) {
    case 'template':
      return createTemplate(guard.admin, body);
    case 'field':
      return createField(guard.admin, body);
    case 'add_country':
      return addToCountry(guard.admin, body);
    default:
      return invalid('Unknown change type.', 'type');
  }
}

async function createTemplate(admin: AdminContext, body: Body) {
  const cardId = uuidOf(body.card_id);
  if (!cardId) return invalid('Choose the card this card type belongs to.', 'card_id');
  const name = cleanText(body.name);
  const problem = nameProblem(name);
  if (problem) return invalid(problem, 'name');
  const isActive = typeof body.is_active === 'boolean' ? body.is_active : true;

  const [card, siblings] = await Promise.all([
    supabaseAdmin.from('cards').select('id, name').eq('id', cardId).maybeSingle<{ id: string; name: string | null }>(),
    supabaseAdmin.from(TEMPLATES).select('id, name, sort_order').eq('card_id', cardId),
  ]);
  if (card.error) return serverError('create template card', 'The card could not be checked, so nothing was created.', card.error);
  if (!card.data) return fail('RESOURCE_NOT_FOUND', 'That card no longer exists.');
  if (siblings.error) {
    return serverError('create template siblings', 'The card types could not be checked, so nothing was created.', siblings.error);
  }

  const existing = rows<{ id: string; name: string | null; sort_order: number | null }>(siblings.data);
  const duplicate = findDuplicate(existing, (template) => template.name, name);
  if (duplicate) {
    return fail('STATE_CONFLICT', `${card.data.name || 'This card'} already has a card type called ${duplicate.name}.`, {
      details: { field: 'name' },
    });
  }

  const row = { card_id: cardId, name, is_active: isActive, sort_order: nextSortOrder(existing) };
  const base = { action: 'CREATE_CARD_TYPE_TEMPLATE', entity: TEMPLATES, sensitivity: 'normal' as const };
  const { data, error } = await supabaseAdmin.from(TEMPLATES).insert(row).select('id').single<{ id: string }>();
  if (error || !data) {
    await audit(admin, { ...base, entity_id: null, after: row, result: 'failure', error: error?.message ?? 'No row returned' });
    return serverError('create template', 'The card type could not be created.', error);
  }

  const recorded = await audit(admin, {
    ...base,
    entity_id: data.id,
    after: { ...row, card_name: card.data.name },
    result: 'success',
  });
  return ok({ id: data.id, ...auditResult(recorded.ok) });
}

async function createField(admin: AdminContext, body: Body) {
  const templateId = uuidOf(body.template_id);
  if (!templateId) return invalid('Choose the card type this field belongs to.', 'template_id');
  const label = cleanText(body.label);
  const problem = labelProblem(label);
  if (problem) return invalid(problem, 'label');
  const inputType: unknown = body.input_type === undefined || body.input_type === null ? 'text' : body.input_type;
  if (!isInputType(inputType)) return invalid('Choose text, image upload, or image and text.', 'input_type');
  const isRequired: unknown = body.is_required === undefined || body.is_required === null ? true : body.is_required;
  if (typeof isRequired !== 'boolean') return invalid('Say whether users must fill in this field.', 'is_required');

  const [template, siblings] = await Promise.all([
    supabaseAdmin.from(TEMPLATES).select('id, card_id, name').eq('id', templateId).maybeSingle<TemplateRow>(),
    supabaseAdmin.from(FIELDS).select('id, label, sort_order').eq('template_id', templateId),
  ]);
  if (template.error) {
    return serverError('create field template', 'The card type could not be checked, so nothing was added.', template.error);
  }
  if (!template.data) return fail('RESOURCE_NOT_FOUND', 'That card type no longer exists.');
  if (siblings.error) {
    return serverError('create field siblings', 'The card type fields could not be checked, so nothing was added.', siblings.error);
  }

  const existing = rows<{ id: string; label: string | null; sort_order: number | null }>(siblings.data);
  const duplicate = findDuplicate(existing, (field) => field.label, label);
  if (duplicate) {
    return fail('STATE_CONFLICT', `${template.data.name} already has a field called ${duplicate.label}.`, {
      details: { field: 'label' },
    });
  }

  const row = {
    template_id: templateId,
    label,
    input_type: inputType,
    is_required: isRequired,
    sort_order: nextSortOrder(existing),
  };
  const base = { action: 'CREATE_TEMPLATE_FIELD', entity: FIELDS, sensitivity: 'normal' as const };
  const { data, error } = await supabaseAdmin.from(FIELDS).insert(row).select('id').single<{ id: string }>();
  if (error || !data) {
    await audit(admin, { ...base, entity_id: null, after: row, result: 'failure', error: error?.message ?? 'No row returned' });
    return serverError('create field', 'The field could not be added.', error);
  }

  const recorded = await audit(admin, {
    ...base,
    entity_id: data.id,
    after: { ...row, template_name: template.data.name },
    result: 'success',
  });
  return ok({ id: data.id, ...auditResult(recorded.ok) });
}

async function addToCountry(admin: AdminContext, body: Body) {
  const templateId = uuidOf(body.template_id);
  if (!templateId) return invalid('Choose the card type to add.', 'template_id');
  const requested = normalizeCountryCode(body.country_code);
  if (!requested) return invalid('Choose a country.', 'country_code');

  const { data: template, error: templateError } = await supabaseAdmin
    .from(TEMPLATES)
    .select('id, card_id, name, sort_order')
    .eq('id', templateId)
    .maybeSingle<TemplateRow>();
  if (templateError) {
    return serverError('add country template', 'The card type could not be checked, so nothing was added.', templateError);
  }
  if (!template) return fail('RESOURCE_NOT_FOUND', 'That card type no longer exists.');

  const [countries, installs] = await Promise.all([
    supabaseAdmin.from('card_countries').select('country_code, country_name, is_active').eq('card_id', template.card_id),
    supabaseAdmin
      .from(INSTALLS)
      .select('id, country_code, is_active')
      .eq('card_id', template.card_id)
      .eq('template_id', templateId),
  ]);
  if (countries.error) {
    return serverError('add country countries', 'The card’s countries could not be checked, so nothing was added.', countries.error);
  }
  if (installs.error) {
    return serverError('add country installs', 'The card type’s countries could not be checked, so nothing was added.', installs.error);
  }

  const country = rows<CountryRow>(countries.data).find((row) => sameCountryCode(row.country_code, requested));
  if (!country || country.is_active !== true) {
    return fail(
      'STATE_CONFLICT',
      `${country?.country_name || requested} is not an active country for this card. Switch it on in Cards first.`,
      { details: { field: 'country_code' } },
    );
  }
  const code = country.country_code || requested;
  const place = country.country_name || code;
  const context = { template_id: templateId, template_name: template.name, card_id: template.card_id, country_code: code };
  const existing = rows<InstallRow>(installs.data).find((row) => sameCountryCode(row.country_code, code));

  if (existing) {
    if (existing.is_active === true) return ok({ id: existing.id, reactivated: false, already_live: true });
    const reactivate = { action: 'REACTIVATE_CARD_TYPE_COUNTRY', entity: INSTALLS, entity_id: existing.id, sensitivity: 'financial' as const };
    const update = supabaseAdmin.from(INSTALLS).update({ is_active: true }).eq('id', existing.id);
    const { data, error } = await (existing.is_active === null ? update.is('is_active', null) : update.eq('is_active', false)).select('id');
    if (error) {
      await audit(admin, { ...reactivate, before: { is_active: existing.is_active }, after: { is_active: true, ...context }, result: 'failure', error: error.message });
      return serverError('reactivate country', `${template.name} could not be switched back on in ${place}.`, error);
    }
    if (rows(data).length === 0) return fail('STATE_CONFLICT', CHANGED_ELSEWHERE);
    const recorded = await audit(admin, {
      ...reactivate,
      before: { is_active: existing.is_active },
      after: { is_active: true, ...context },
      result: 'success',
    });
    return ok({ id: existing.id, reactivated: true, ...auditResult(recorded.ok) });
  }

  const { data: templateFields, error: fieldsError } = await supabaseAdmin
    .from(FIELDS)
    .select('label, input_type, is_required, sort_order')
    .eq('template_id', templateId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (fieldsError) {
    return serverError('add country fields', 'The card type’s fields could not be read, so nothing was added.', fieldsError);
  }

  const base = { action: 'ADD_CARD_TYPE_TO_COUNTRY', entity: INSTALLS, sensitivity: 'financial' as const };
  const { data: created, error: insertError } = await supabaseAdmin
    .from(INSTALLS)
    .insert({
      card_id: template.card_id,
      country_code: code,
      name: template.name,
      template_id: templateId,
      is_active: false,
      sort_order: template.sort_order ?? 0,
    })
    .select('id')
    .single<{ id: string }>();
  if (insertError || !created) {
    await audit(admin, { ...base, entity_id: null, after: context, result: 'failure', error: insertError?.message ?? 'No row returned' });
    return serverError('add country insert', `${template.name} could not be added to ${place}. Nothing changed.`, insertError);
  }

  const copies = rows<Omit<InstallFieldRow, 'card_type_id'>>(templateFields).map((field, index) => ({
    card_type_id: created.id,
    label: field.label,
    input_type: field.input_type,
    is_required: field.is_required ?? true,
    sort_order: index,
  }));
  if (copies.length > 0) {
    const { error: copyError } = await supabaseAdmin.from('card_type_fields').insert(copies);
    if (copyError) {
      const { error: undoError } = await supabaseAdmin.from(INSTALLS).delete().eq('id', created.id);
      await audit(admin, {
        ...base,
        entity_id: created.id,
        after: { ...context, is_active: false, removed: !undoError },
        result: undoError ? 'partial' : 'failure',
        error: copyError.message,
      });
      console.error('field-builder add country copy:', copyError.message, undoError?.message ?? '');
      return fail(
        'INTERNAL_ERROR',
        undoError
          ? `${template.name} could not be added to ${place}. An incomplete copy was left switched off, so users cannot see it.`
          : `${template.name} could not be added to ${place}. Nothing changed.`,
      );
    }
  }

  const { error: liveError } = await supabaseAdmin.from(INSTALLS).update({ is_active: true }).eq('id', created.id);
  if (liveError) {
    await audit(admin, {
      ...base,
      entity_id: created.id,
      after: { ...context, is_active: false, fields_copied: copies.length },
      result: 'partial',
      error: liveError.message,
    });
    return serverError(
      'add country activate',
      `${template.name} was added to ${place} but could not be switched on. It is switched off; switch it on from the list.`,
      liveError,
    );
  }

  const recorded = await audit(admin, {
    ...base,
    entity_id: created.id,
    after: { ...context, is_active: true, fields_copied: copies.length },
    result: 'success',
  });
  return ok({ id: created.id, reactivated: false, fields_copied: copies.length, ...auditResult(recorded.ok) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('card_types.write');
  if (!guard.ok) return guard.response;
  const body = await readBody(req);
  if (!body) return invalid('Send the change as a JSON object.');

  switch (body.type) {
    case 'template':
      return updateTemplate(guard.admin, body);
    case 'field':
      return updateField(guard.admin, body);
    case 'reorder_templates':
      return reorderTemplates(guard.admin, body);
    case 'reorder_fields':
      return reorderFields(guard.admin, body);
    case 'country':
      return setCountryLive(guard.admin, body);
    default:
      return invalid('Unknown change type.', 'type');
  }
}

async function updateTemplate(admin: AdminContext, body: Body) {
  const id = uuidOf(body.id);
  if (!id) return invalid('Choose the card type to change.', 'id');

  const updates: { name?: string; is_active?: boolean; sort_order?: number } = {};
  if (body.name !== undefined) {
    const name = cleanText(body.name);
    const problem = nameProblem(name);
    if (problem) return invalid(problem, 'name');
    updates.name = name;
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return invalid('is_active must be true or false.', 'is_active');
    updates.is_active = body.is_active;
  }
  if (body.sort_order !== undefined) {
    const order = parseSortOrder(body.sort_order);
    if (order === null) return invalid('sort_order must be a whole number of 0 or more.', 'sort_order');
    updates.sort_order = order;
  }
  if (Object.keys(updates).length === 0) return invalid('Nothing to change.');

  const { data: before, error: readError } = await supabaseAdmin
    .from(TEMPLATES)
    .select('id, card_id, name, is_active, sort_order')
    .eq('id', id)
    .maybeSingle<TemplateRow>();
  if (readError) return serverError('update template read', 'The card type could not be read, so nothing changed.', readError);
  if (!before) return fail('RESOURCE_NOT_FOUND', 'That card type no longer exists.');

  if (updates.name !== undefined && updates.name !== before.name) {
    const { data: siblings, error: siblingsError } = await supabaseAdmin
      .from(TEMPLATES)
      .select('id, name')
      .eq('card_id', before.card_id);
    if (siblingsError) {
      return serverError('update template siblings', 'The card types could not be checked, so nothing changed.', siblingsError);
    }
    const duplicate = findDuplicate(rows<{ id: string; name: string | null }>(siblings), (row) => row.name, updates.name, id);
    if (duplicate) {
      return fail('STATE_CONFLICT', `This card already has a card type called ${duplicate.name}.`, { details: { field: 'name' } });
    }
  }

  const base = {
    action: 'UPDATE_CARD_TYPE_TEMPLATE',
    entity: TEMPLATES,
    entity_id: id,
    before: { name: before.name, is_active: before.is_active, sort_order: before.sort_order },
    sensitivity: 'normal' as const,
  };
  const { error: updateError } = await supabaseAdmin.from(TEMPLATES).update(updates).eq('id', id);
  if (updateError) {
    await audit(admin, { ...base, after: updates, result: 'failure', error: updateError.message });
    return serverError('update template', 'The card type could not be updated.', updateError);
  }

  let renamed: number | null = null;
  if (updates.name !== undefined) {
    const { data: clones, error: cloneError } = await supabaseAdmin
      .from(INSTALLS)
      .update({ name: updates.name })
      .eq('template_id', id)
      .select('id');
    if (cloneError) {
      await audit(admin, { ...base, after: updates, result: 'partial', error: cloneError.message });
      return serverError(
        'rename installs',
        'The card type was renamed here, but the countries it was added to still show the old name. Save the same name again to finish.',
        cloneError,
      );
    }
    renamed = rows(clones).length;
  }

  const recorded = await audit(admin, {
    ...base,
    after: renamed === null ? updates : { ...updates, countries_renamed: renamed },
    result: 'success',
  });
  return ok({ ...(renamed === null ? {} : { countries_renamed: renamed }), ...auditResult(recorded.ok) });
}

async function updateField(admin: AdminContext, body: Body) {
  const id = uuidOf(body.id);
  if (!id) return invalid('Choose the field to change.', 'id');

  const updates: { label?: string; input_type?: InputType; is_required?: boolean; sort_order?: number } = {};
  if (body.label !== undefined) {
    const label = cleanText(body.label);
    const problem = labelProblem(label);
    if (problem) return invalid(problem, 'label');
    updates.label = label;
  }
  if (body.input_type !== undefined && body.input_type !== null) {
    if (!isInputType(body.input_type)) return invalid('Choose text, image upload, or image and text.', 'input_type');
    updates.input_type = body.input_type;
  }
  if (body.is_required !== undefined) {
    if (typeof body.is_required !== 'boolean') return invalid('Say whether users must fill in this field.', 'is_required');
    updates.is_required = body.is_required;
  }
  if (body.sort_order !== undefined) {
    const order = parseSortOrder(body.sort_order);
    if (order === null) return invalid('sort_order must be a whole number of 0 or more.', 'sort_order');
    updates.sort_order = order;
  }
  if (Object.keys(updates).length === 0) return invalid('Nothing to change.');

  const { data: before, error: readError } = await supabaseAdmin
    .from(FIELDS)
    .select('id, template_id, label, input_type, is_required, sort_order')
    .eq('id', id)
    .maybeSingle<FieldRow>();
  if (readError) return serverError('update field read', 'The field could not be read, so nothing changed.', readError);
  if (!before) return fail('RESOURCE_NOT_FOUND', 'That field no longer exists.');

  if (updates.label !== undefined && updates.label !== before.label) {
    const { data: siblings, error: siblingsError } = await supabaseAdmin
      .from(FIELDS)
      .select('id, label')
      .eq('template_id', before.template_id);
    if (siblingsError) {
      return serverError('update field siblings', 'The card type fields could not be checked, so nothing changed.', siblingsError);
    }
    const duplicate = findDuplicate(rows<{ id: string; label: string | null }>(siblings), (row) => row.label, updates.label, id);
    if (duplicate) {
      return fail('STATE_CONFLICT', `This card type already has a field called ${duplicate.label}.`, { details: { field: 'label' } });
    }
  }

  const base = {
    action: 'UPDATE_TEMPLATE_FIELD',
    entity: FIELDS,
    entity_id: id,
    before: {
      template_id: before.template_id,
      label: before.label,
      input_type: before.input_type,
      is_required: before.is_required,
      sort_order: before.sort_order,
    },
    sensitivity: 'normal' as const,
  };
  const { error: updateError } = await supabaseAdmin.from(FIELDS).update(updates).eq('id', id);
  if (updateError) {
    await audit(admin, { ...base, after: updates, result: 'failure', error: updateError.message });
    return serverError('update field', 'The field could not be updated.', updateError);
  }

  const recorded = await audit(admin, { ...base, after: updates, result: 'success' });
  return ok(auditResult(recorded.ok));
}

async function reorderTemplates(admin: AdminContext, body: Body) {
  const cardId = uuidOf(body.card_id);
  if (!cardId) return invalid('Choose the card whose card types you are reordering.', 'card_id');
  const ids = parseIdList(body.ids);
  if (!ids) return invalid('Send the card types as a list of ids in their new order.', 'ids');

  const { data, error } = await supabaseAdmin
    .from(TEMPLATES)
    .select('id, sort_order')
    .eq('card_id', cardId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) return serverError('reorder templates read', 'The card types could not be read, so the order did not change.', error);

  const current = rows<Ordered>(data);
  const plan = planReorder(current, ids);
  if (!plan.ok) {
    const message = reorderRefusalText(plan.reason, 'card types');
    return plan.reason === 'mismatch' ? fail('STATE_CONFLICT', message) : invalid(message, 'ids');
  }
  if (plan.updates.length === 0) return ok({ changed: false });

  const base = {
    action: 'REORDER_CARD_TYPE_TEMPLATES',
    entity: TEMPLATES,
    entity_id: cardId,
    before: { order: current.map((row) => row.id) },
    after: { order: plan.order },
    sensitivity: 'normal' as const,
  };
  const applied = await applySortOrders(TEMPLATES, { column: 'card_id', value: cardId }, plan.updates);
  if (applied.failed > 0) {
    const none = applied.failed === plan.updates.length;
    await audit(admin, { ...base, result: none ? 'failure' : 'partial', error: applied.error });
    console.error('field-builder reorder templates:', applied.error);
    return fail(
      'INTERNAL_ERROR',
      none
        ? 'The new order could not be saved.'
        : 'The new order was only partly saved. Reload to see the current order, then try again.',
    );
  }

  const recorded = await audit(admin, { ...base, result: 'success' });
  return ok({ changed: true, ...auditResult(recorded.ok) });
}

async function reorderFields(admin: AdminContext, body: Body) {
  const ids = parseIdList(body.ids);
  if (!ids) return invalid('Send the fields as a list of ids in their new order.', 'ids');
  if (ids.length === 0) return invalid(reorderRefusalText('empty', 'fields'), 'ids');

  let templateId: string | null = null;
  if (body.template_id !== undefined && body.template_id !== null) {
    templateId = uuidOf(body.template_id);
    if (!templateId) return invalid('template_id must be the id of a card type.', 'template_id');
  } else {
    const { data, error } = await supabaseAdmin.from(FIELDS).select('id, template_id').in('id', ids);
    if (error) return serverError('reorder fields owners', 'The fields could not be read, so the order did not change.', error);
    const owners = new Set(rows<{ template_id: string | null }>(data).map((row) => row.template_id));
    const [owner] = Array.from(owners);
    if (owners.size !== 1 || !owner) return fail('STATE_CONFLICT', reorderRefusalText('mismatch', 'fields'));
    templateId = owner;
  }

  const { data, error } = await supabaseAdmin
    .from(FIELDS)
    .select('id, sort_order')
    .eq('template_id', templateId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) return serverError('reorder fields read', 'The fields could not be read, so the order did not change.', error);

  const current = rows<Ordered>(data);
  const plan = planReorder(current, ids);
  if (!plan.ok) {
    const message = reorderRefusalText(plan.reason, 'fields');
    return plan.reason === 'mismatch' ? fail('STATE_CONFLICT', message) : invalid(message, 'ids');
  }
  if (plan.updates.length === 0) return ok({ changed: false });

  const base = {
    action: 'REORDER_TEMPLATE_FIELDS',
    entity: FIELDS,
    entity_id: templateId,
    before: { order: current.map((row) => row.id) },
    after: { order: plan.order },
    sensitivity: 'normal' as const,
  };
  const applied = await applySortOrders(FIELDS, { column: 'template_id', value: templateId }, plan.updates);
  if (applied.failed > 0) {
    const none = applied.failed === plan.updates.length;
    await audit(admin, { ...base, result: none ? 'failure' : 'partial', error: applied.error });
    console.error('field-builder reorder fields:', applied.error);
    return fail(
      'INTERNAL_ERROR',
      none
        ? 'The new order could not be saved.'
        : 'The new order was only partly saved. Reload to see the current order, then try again.',
    );
  }

  const recorded = await audit(admin, { ...base, result: 'success' });
  return ok({ changed: true, ...auditResult(recorded.ok) });
}

async function setCountryLive(admin: AdminContext, body: Body) {
  const id = uuidOf(body.card_type_id);
  if (!id) return invalid('Choose the country to change.', 'card_type_id');
  if (typeof body.is_active !== 'boolean') return invalid('is_active must be true or false.', 'is_active');
  const next = body.is_active;

  const { data: before, error: readError } = await supabaseAdmin
    .from(INSTALLS)
    .select('id, card_id, template_id, country_code, name, is_active')
    .eq('id', id)
    .maybeSingle<InstallRow>();
  if (readError) return serverError('country read', 'The country could not be read, so nothing changed.', readError);
  if (!before) return fail('RESOURCE_NOT_FOUND', 'That country is no longer set up for this card type.');
  if ((before.is_active === true) === next) return ok({ changed: false, is_active: next });

  const base = {
    action: 'SET_CARD_TYPE_COUNTRY_ACTIVE',
    entity: INSTALLS,
    entity_id: id,
    before: { is_active: before.is_active },
    sensitivity: 'financial' as const,
  };
  const after = {
    is_active: next,
    template_id: before.template_id,
    card_id: before.card_id ?? null,
    country_code: before.country_code,
    name: before.name ?? null,
  };
  const update = supabaseAdmin.from(INSTALLS).update({ is_active: next }).eq('id', id);
  const { data, error } = await (before.is_active === null
    ? update.is('is_active', null)
    : update.eq('is_active', before.is_active)
  ).select('id');
  if (error) {
    await audit(admin, { ...base, after, result: 'failure', error: error.message });
    return serverError('country update', 'The country could not be changed.', error);
  }
  if (rows(data).length === 0) return fail('STATE_CONFLICT', CHANGED_ELSEWHERE);

  const recorded = await audit(admin, { ...base, after, result: 'success' });
  return ok({ changed: true, is_active: next, ...auditResult(recorded.ok) });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin('card_types.write');
  if (!guard.ok) return guard.response;
  const body = await readBody(req);
  if (!body) return invalid('Send the change as a JSON object.');

  switch (body.type) {
    case 'template':
      return deleteTemplate(guard.admin, body);
    case 'field':
      return deleteField(guard.admin, body);
    default:
      return invalid('Unknown change type.', 'type');
  }
}

async function deleteTemplate(admin: AdminContext, body: Body) {
  const id = uuidOf(body.id);
  if (!id) return invalid('Choose the card type to delete.', 'id');

  const { data: before, error: readError } = await supabaseAdmin
    .from(TEMPLATES)
    .select('id, card_id, name, is_active, sort_order')
    .eq('id', id)
    .maybeSingle<TemplateRow>();
  if (readError) return serverError('delete template read', 'The card type could not be read, so nothing was deleted.', readError);
  if (!before) return fail('RESOURCE_NOT_FOUND', 'That card type no longer exists.');

  const [fields, installs] = await Promise.all([
    supabaseAdmin.from(FIELDS).select('id, label').eq('template_id', id),
    supabaseAdmin.from(INSTALLS).select('id, country_code, is_active').eq('template_id', id),
  ]);
  if (fields.error || installs.error) {
    return serverError(
      'delete template detail',
      'The card type could not be checked, so nothing was deleted.',
      fields.error ?? installs.error,
    );
  }

  const installRows = rows<InstallRow>(installs.data);
  const installIds = installRows.map((row) => row.id);
  const base = {
    action: 'DELETE_CARD_TYPE_TEMPLATE',
    entity: TEMPLATES,
    entity_id: id,
    before: {
      ...before,
      fields: rows<{ label: string | null }>(fields.data).map((row) => row.label),
      countries: installRows.map((row) => ({ id: row.id, country_code: row.country_code, is_active: row.is_active })),
    },
    sensitivity: 'normal' as const,
  };

  if (installIds.length > 0) {
    const { error: unlinkError } = await supabaseAdmin.from(INSTALLS).update({ template_id: null }).eq('template_id', id);
    if (unlinkError) {
      await audit(admin, { ...base, after: null, result: 'failure', error: unlinkError.message });
      return serverError('delete template unlink', 'The card type could not be deleted. Nothing changed.', unlinkError);
    }
  }

  const { error: deleteError } = await supabaseAdmin.from(TEMPLATES).delete().eq('id', id);
  if (deleteError) {
    let relinked = true;
    if (installIds.length > 0) {
      const { error: relinkError } = await supabaseAdmin.from(INSTALLS).update({ template_id: id }).in('id', installIds);
      relinked = !relinkError;
    }
    await audit(admin, { ...base, after: null, result: relinked ? 'failure' : 'partial', error: deleteError.message });
    return serverError(
      'delete template',
      relinked
        ? 'The card type could not be deleted. Nothing changed.'
        : 'The card type could not be deleted, and its countries were left unlinked from it. They still work for users but no longer show under it here.',
      deleteError,
    );
  }

  const recorded = await audit(admin, {
    ...base,
    after: { deleted: true, unlinked_countries: installIds.length },
    result: 'success',
  });
  return ok({ unlinked_countries: installIds.length, ...auditResult(recorded.ok) });
}

async function deleteField(admin: AdminContext, body: Body) {
  const id = uuidOf(body.id);
  if (!id) return invalid('Choose the field to delete.', 'id');

  const { data: before, error: readError } = await supabaseAdmin
    .from(FIELDS)
    .select('id, template_id, label, input_type, is_required, sort_order')
    .eq('id', id)
    .maybeSingle<FieldRow>();
  if (readError) return serverError('delete field read', 'The field could not be read, so nothing was deleted.', readError);
  if (!before) return fail('RESOURCE_NOT_FOUND', 'That field no longer exists.');

  const base = { action: 'DELETE_TEMPLATE_FIELD', entity: FIELDS, entity_id: id, before, sensitivity: 'normal' as const };
  const { data, error } = await supabaseAdmin.from(FIELDS).delete().eq('id', id).select('id');
  if (error) {
    await audit(admin, { ...base, after: null, result: 'failure', error: error.message });
    return serverError('delete field', 'The field could not be deleted.', error);
  }
  if (rows(data).length === 0) return fail('RESOURCE_NOT_FOUND', 'That field no longer exists.');

  const recorded = await audit(admin, { ...base, after: null, result: 'success' });
  return ok(auditResult(recorded.ok));
}
