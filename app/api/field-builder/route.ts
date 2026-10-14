import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, isUuid, ok } from '../../lib/api';
import {
  cleanText, findDuplicate, isInputType, labelProblem, nameProblem, normalizeCountryCode, parseIdList,
  parseSortOrder, reorderRefusalText, sameCountryCode,
  type InputType, type ReorderRefusal,
} from '../../(dashboard)/field-builder/rules';

const TEMPLATES = 'card_type_templates';
const FIELDS = 'card_type_template_fields';
const INSTALLS = 'card_types';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const CHANGED_ELSEWHERE = 'This changed while you were working on it. Reload and try again.';
const NOT_AUTHORIZED = 'Not authorized';
const ORDER_UNCONFIRMED = 'The new order could not be confirmed. Reload to see the current order before trying again.';
const INVALID_COUNTRY_CODE = 'Invalid country code';
const REORDER_REFUSALS: readonly ReorderRefusal[] = ['empty', 'too_many', 'duplicate', 'mismatch'];
const LIVE_OUTCOMES: readonly LiveOutcome[] = ['already_live', 'reactivated', 'created'];

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

type LiveOutcome = 'already_live' | 'reactivated' | 'created';

interface InstallContext {
  template_id: string | null;
  template_name: string | null;
  card_id: string | null;
  country_code: string | null;
}

type InstallResult =
  | { outcome: 'template_not_found' }
  | { outcome: 'country_not_active'; countryName: string | null }
  | {
      outcome: LiveOutcome;
      id: string;
      fieldsCopied: number | null;
      previousIsActive: boolean | null;
      context: InstallContext;
    };

type ReorderResult =
  | { applied: true; changed: boolean; templateId: string | null; order: string[]; before: string[] }
  | { applied: false; reason: ReorderRefusal };

interface ReorderCall {
  fn: 'admin_reorder_card_type_templates' | 'admin_reorder_template_fields';
  params: Record<string, string | string[] | null>;
  ids: string[];
  noun: string;
  entity: string;
  entityId: string | null;
  context: string;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function idsOf(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((id) => typeof id === 'string') ? (value as string[]) : null;
}

function isRefusal(value: unknown): value is ReorderRefusal {
  return typeof value === 'string' && (REORDER_REFUSALS as readonly string[]).includes(value);
}

function isLiveOutcome(value: unknown): value is LiveOutcome {
  return typeof value === 'string' && (LIVE_OUTCOMES as readonly string[]).includes(value);
}

function readReorder(data: unknown): ReorderResult | null {
  const result = recordOf(data);
  if (!result) return null;
  if (result.applied === false) return isRefusal(result.reason) ? { applied: false, reason: result.reason } : null;
  const order = idsOf(result.order);
  const before = idsOf(result.before);
  if (result.applied !== true || !order || !before) return null;
  return { applied: true, changed: result.changed === true, templateId: textOf(result.template_id), order, before };
}

function readInstall(data: unknown): InstallResult | null {
  const result = recordOf(data);
  if (!result) return null;
  if (result.outcome === 'template_not_found') return { outcome: 'template_not_found' };
  if (result.outcome === 'country_not_active') return { outcome: 'country_not_active', countryName: textOf(result.country_name) };
  const id = textOf(result.id);
  if (!isLiveOutcome(result.outcome) || !id) return null;
  return {
    outcome: result.outcome,
    id,
    fieldsCopied: typeof result.fields_copied === 'number' ? result.fields_copied : null,
    previousIsActive: typeof result.previous_is_active === 'boolean' ? result.previous_is_active : null,
    context: {
      template_id: textOf(result.template_id),
      template_name: textOf(result.template_name),
      card_id: textOf(result.card_id),
      country_code: textOf(result.country_code),
    },
  };
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

  const { data, error } = await supabaseAdmin.rpc('admin_add_card_type_to_country', {
    p_admin_id: admin.admin_id,
    p_template_id: templateId,
    p_country_code: requested,
  });
  if (error?.message === NOT_AUTHORIZED) return fail('AUTH_REQUIRED');
  if (error?.message === INVALID_COUNTRY_CODE) return invalid('Choose a country.', 'country_code');
  const result = error ? null : readInstall(data);
  if (!result) {
    const failure = error ?? { message: 'admin_add_card_type_to_country returned an unexpected result' };
    await audit(admin, {
      action: 'ADD_CARD_TYPE_TO_COUNTRY',
      entity: INSTALLS,
      entity_id: null,
      after: { template_id: templateId, country_code: requested },
      sensitivity: 'financial',
      result: 'failure',
      error: failure.message,
    });
    return serverError(
      'add country',
      error
        ? `The card type could not be added to ${requested}. Nothing changed.`
        : `Adding the card type to ${requested} could not be confirmed. Reload to check before trying again.`,
      failure,
    );
  }

  switch (result.outcome) {
    case 'template_not_found':
      return fail('RESOURCE_NOT_FOUND', 'That card type no longer exists.');
    case 'country_not_active':
      return fail(
        'STATE_CONFLICT',
        `${result.countryName || requested} is not an active country for this card. Switch it on in Cards first.`,
        { details: { field: 'country_code' } },
      );
    case 'already_live':
      return ok({ id: result.id, reactivated: false, already_live: true });
    case 'reactivated': {
      const recorded = await audit(admin, {
        action: 'REACTIVATE_CARD_TYPE_COUNTRY',
        entity: INSTALLS,
        entity_id: result.id,
        before: { is_active: result.previousIsActive },
        after: { is_active: true, ...result.context },
        sensitivity: 'financial',
        result: 'success',
      });
      return ok({ id: result.id, reactivated: true, ...auditResult(recorded.ok) });
    }
    case 'created': {
      const recorded = await audit(admin, {
        action: 'ADD_CARD_TYPE_TO_COUNTRY',
        entity: INSTALLS,
        entity_id: result.id,
        after: { ...result.context, is_active: true, fields_copied: result.fieldsCopied },
        sensitivity: 'financial',
        result: 'success',
      });
      return ok({ id: result.id, reactivated: false, fields_copied: result.fieldsCopied, ...auditResult(recorded.ok) });
    }
  }
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

  return runReorder(admin, 'REORDER_CARD_TYPE_TEMPLATES', {
    fn: 'admin_reorder_card_type_templates',
    params: { p_admin_id: admin.admin_id, p_card_id: cardId, p_ids: ids },
    ids,
    noun: 'card types',
    entity: TEMPLATES,
    entityId: cardId,
    context: 'reorder templates',
  });
}

async function reorderFields(admin: AdminContext, body: Body) {
  const ids = parseIdList(body.ids);
  if (!ids) return invalid('Send the fields as a list of ids in their new order.', 'ids');
  if (ids.length === 0) return invalid(reorderRefusalText('empty', 'fields'), 'ids');

  let templateId: string | null = null;
  if (body.template_id !== undefined && body.template_id !== null) {
    templateId = uuidOf(body.template_id);
    if (!templateId) return invalid('template_id must be the id of a card type.', 'template_id');
  }

  return runReorder(admin, 'REORDER_TEMPLATE_FIELDS', {
    fn: 'admin_reorder_template_fields',
    params: { p_admin_id: admin.admin_id, p_template_id: templateId, p_ids: ids },
    ids,
    noun: 'fields',
    entity: FIELDS,
    entityId: templateId,
    context: 'reorder fields',
  });
}

async function runReorder(admin: AdminContext, action: string, call: ReorderCall) {
  const { data, error } = await supabaseAdmin.rpc(call.fn, call.params);
  if (error?.message === NOT_AUTHORIZED) return fail('AUTH_REQUIRED');
  const result = error ? null : readReorder(data);
  const base = { action, entity: call.entity, sensitivity: 'normal' as const };
  if (!result) {
    const message = error?.message ?? `${call.fn} returned an unexpected result`;
    await audit(admin, { ...base, entity_id: call.entityId, after: { order: call.ids }, result: 'failure', error: message });
    console.error(`field-builder ${call.context}:`, message);
    return fail('INTERNAL_ERROR', error ? 'The new order could not be saved.' : ORDER_UNCONFIRMED);
  }
  if (!result.applied) {
    const message = reorderRefusalText(result.reason, call.noun);
    return result.reason === 'mismatch' ? fail('STATE_CONFLICT', message) : invalid(message, 'ids');
  }
  if (!result.changed) return ok({ changed: false });

  const recorded = await audit(admin, {
    ...base,
    entity_id: result.templateId ?? call.entityId,
    before: { order: result.before },
    after: { order: result.order },
    result: 'success',
  });
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
