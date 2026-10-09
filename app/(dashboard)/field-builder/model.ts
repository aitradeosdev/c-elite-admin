import type { ConfirmDetail, ConfirmOptions } from '../../_ui';
import type { ApiBody, ApiResult } from '../../lib/apiClient';
import { inputTypeLabel, sameCountryCode, textKey } from './rules';

export interface BrandSummary {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  template_count: number | null;
}

export interface CardRef {
  id: string;
  name: string;
  is_active: boolean;
}

export interface BrandCountry {
  country_code: string;
  country_name: string;
}

export interface InstallField {
  label: string;
  input_type: string;
  is_required: boolean;
}

export interface Install {
  id: string;
  country_code: string;
  country_name: string | null;
  is_active: boolean;
  active_rate_count: number | null;
  fields: InstallField[] | null;
}

export interface TemplateField {
  id: string;
  label: string;
  input_type: string;
  is_required: boolean;
}

export interface Template {
  id: string;
  name: string;
  fields: TemplateField[];
  countries: Install[];
}

export interface BuilderData {
  card: CardRef | null;
  templates: Template[];
  countries: BrandCountry[];
}

export type MutationOutcome =
  | { kind: 'done'; body: ApiBody; warning: string | null }
  | { kind: 'unknown'; message: string }
  | { kind: 'refused'; status: number | null; message: string; field: string | null };

export type MutationAttempt = MutationOutcome | { kind: 'retry'; message: string; field: string | null };

export const UNNAMED_CARD = 'Unnamed card';
export const UNNAMED_TYPE = 'Unnamed card type';
export const REACH_NOTE = 'Users may take a few minutes to see the change.';

const FINAL_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 409]);

function record(value: unknown): ApiBody | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as ApiBody) : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function plural(amount: number, one: string, many = `${one}s`): string {
  return `${amount} ${amount === 1 ? one : many}`;
}

export function listText(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function toBrandList(body: ApiBody): BrandSummary[] | null {
  if (!Array.isArray(body.cards)) return null;
  return body.cards.flatMap((raw) => {
    const row = record(raw);
    const id = text(row?.id);
    if (!row || !id) return [];
    return [{
      id,
      name: text(row.name) ?? UNNAMED_CARD,
      logo_url: text(row.logo_url),
      is_active: row.is_active === true,
      template_count: count(row.template_count),
    }];
  });
}

export function brandDescription(brand: BrandSummary): string | undefined {
  const parts = [
    brand.template_count === null ? null : plural(brand.template_count, 'card type'),
    brand.is_active ? null : 'Switched off in Cards',
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' · ') : undefined;
}

function toInstallFields(value: unknown): InstallField[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((raw) => {
    const row = record(raw);
    if (!row) return [];
    return [{ label: text(row.label) ?? '', input_type: text(row.input_type) ?? '', is_required: row.is_required !== false }];
  });
}

function toTemplate(raw: unknown): Template | null {
  const row = record(raw);
  const id = text(row?.id);
  if (!row || !id) return null;
  const fields = list(row.fields).flatMap((item) => {
    const field = record(item);
    const fieldId = text(field?.id);
    if (!field || !fieldId) return [];
    return [{
      id: fieldId,
      label: text(field.label) ?? '',
      input_type: text(field.input_type) ?? '',
      is_required: field.is_required !== false,
    }];
  });
  const countries = list(row.countries).flatMap((item) => {
    const install = record(item);
    const installId = text(install?.id);
    const code = text(install?.country_code);
    if (!install || !installId || !code) return [];
    return [{
      id: installId,
      country_code: code,
      country_name: text(install.country_name),
      is_active: install.is_active === true,
      active_rate_count: count(install.active_rate_count),
      fields: toInstallFields(install.fields),
    }];
  });
  return { id, name: text(row.name) ?? UNNAMED_TYPE, fields, countries };
}

export function toBuilderData(body: ApiBody): BuilderData | null {
  if (!Array.isArray(body.templates)) return null;
  const cardRow = record(body.card);
  const cardId = text(cardRow?.id);
  const card = cardRow && cardId
    ? { id: cardId, name: text(cardRow.name) ?? UNNAMED_CARD, is_active: cardRow.is_active === true }
    : null;
  const templates = body.templates.flatMap((raw) => {
    const template = toTemplate(raw);
    return template ? [template] : [];
  });
  const countries = list(body.countries).flatMap((raw) => {
    const row = record(raw);
    const code = text(row?.country_code);
    if (!row || !code) return [];
    return [{ country_code: code, country_name: text(row.country_name) ?? code }];
  });
  return { card, templates, countries };
}

export function countryLabel(
  install: Pick<Install, 'country_code' | 'country_name'>,
  countries: readonly BrandCountry[],
): string {
  return install.country_name
    ?? countries.find((country) => sameCountryCode(country.country_code, install.country_code))?.country_name
    ?? install.country_code;
}

export function liveInstalls(template: Template): Install[] {
  return template.countries.filter((install) => install.is_active);
}

export function addableCountries(template: Template, countries: readonly BrandCountry[]): BrandCountry[] {
  return countries.filter(
    (country) => !template.countries.some((install) => sameCountryCode(install.country_code, country.country_code)),
  );
}

export function templateSummary(template: Template): string {
  const fields = plural(template.fields.length, 'field');
  const total = template.countries.length;
  if (total === 0) return `${fields} · Not in any country yet`;
  const live = liveInstalls(template).length;
  if (live === total) return `${fields} · Live in ${plural(total, 'country', 'countries')}`;
  if (live === 0) return `${fields} · Switched off in ${total === 1 ? '1 country' : `all ${total} countries`}`;
  return `${fields} · Live in ${live} of ${total} countries`;
}

export function fieldSummary(field: Pick<TemplateField, 'input_type' | 'is_required'>): string {
  return `${inputTypeLabel(field.input_type)} · ${field.is_required ? 'Required' : 'Optional'}`;
}

function fieldKey(field: InstallField | TemplateField): string {
  return JSON.stringify([textKey(field.label), field.input_type, field.is_required]);
}

export function sameFields(template: readonly TemplateField[], install: readonly InstallField[]): boolean {
  if (template.length !== install.length) return false;
  const left = template.map(fieldKey).sort();
  const right = install.map(fieldKey).sort();
  return left.every((key, index) => key === right[index]);
}

export function fieldsDiffer(template: Template, install: Install): boolean | null {
  return install.fields ? !sameFields(template.fields, install.fields) : null;
}

export function rateText(install: Install): string {
  if (install.active_rate_count === null) return 'Rates not checked';
  if (install.active_rate_count === 0) return 'No rates';
  return plural(install.active_rate_count, 'rate');
}

function fieldLine(field: Pick<TemplateField, 'label' | 'is_required'>): string {
  return `${field.label}${field.is_required ? '' : ' (optional)'}`;
}

function holdersOf(template: Template, label: string): { known: Install[]; unknown: boolean } {
  const key = textKey(label);
  return {
    known: template.countries.filter((install) => install.fields?.some((field) => textKey(field.label) === key)),
    unknown: template.countries.some((install) => install.fields === null),
  };
}

export function deleteTemplateConfirm(
  template: Template,
  cardName: string,
  countries: readonly BrandCountry[],
): ConfirmOptions {
  const installs = template.countries;
  const live = liveInstalls(template);
  const liveNames = live.map((install) => countryLabel(install, countries));
  const rated = installs.some((install) => (install.active_rate_count ?? 0) > 0);
  const kept = installs.length === 1
    ? `${countryLabel(installs[0], countries)} keeps its own copy of the fields${rated ? ' and its rates' : ''}, but no longer appears in Field builder.`
    : `Its ${installs.length} countries keep their own copy of the fields${rated ? ' and their rates' : ''}, but no longer appear in Field builder.`;
  const consequences = [
    `${template.name} and its ${plural(template.fields.length, 'field')} are deleted. This cannot be undone.`,
    installs.length === 0 ? 'It is not in any country, so users are not affected.' : kept,
  ];
  if (live.length > 0) {
    consequences.push(
      `Users in ${listText(liveNames)} can still sell ${template.name}, and you will no longer be able to switch it off there from Field builder. Switch ${live.length === 1 ? 'it' : 'them'} off first if users should stop selling it.`,
    );
  }
  if (installs.length > 0) {
    consequences.push(
      `If you later add a new card type with the same name to those countries, users see two card types called ${template.name}.`,
    );
  }
  return {
    tone: 'danger',
    title: `Delete ${template.name}?`,
    message: `This removes the card type from ${cardName}.`,
    details: [
      { label: 'Card type', value: template.name, emphasis: true },
      { label: 'Card', value: cardName },
      {
        label: 'Fields deleted',
        value: template.fields.length ? listText(template.fields.map((field) => field.label)) : 'None',
      },
      {
        label: 'Countries kept',
        value: installs.length
          ? listText(installs.map((install) => `${countryLabel(install, countries)} (${install.is_active ? 'live' : 'off'})`))
          : 'None',
      },
    ],
    consequences,
    acknowledge: live.length > 0
      ? `I understand ${template.name} stays live in ${listText(liveNames)}.`
      : undefined,
    confirmLabel: 'Delete card type',
  };
}

export function deleteFieldConfirm(
  template: Template,
  field: TemplateField,
  countries: readonly BrandCountry[],
): ConfirmOptions {
  const { known, unknown } = holdersOf(template, field.label);
  const consequences = [
    `Countries you add ${template.name} to from now on will not ask users for ${field.label}.`,
  ];
  if (template.countries.length > 0) {
    if (unknown) {
      consequences.push(
        `Countries already added keep their own copy of the fields, so users there are still asked for ${field.label} if their copy has it.`,
      );
    } else if (known.length > 0) {
      const names = known.map((install) => countryLabel(install, countries));
      consequences.push(
        `${listText(names)} ${known.length === 1 ? 'keeps its' : 'keep their'} own copy, so users there are still asked for ${field.label}.`,
      );
    } else {
      consequences.push(`None of the countries already added ask for ${field.label}, so they are not affected.`);
    }
  }
  consequences.push('This cannot be undone.');
  return {
    tone: 'danger',
    title: `Delete the ${field.label} field?`,
    message: `This removes it from ${template.name}.`,
    details: [
      { label: 'Field', value: field.label, emphasis: true },
      { label: 'Type', value: inputTypeLabel(field.input_type) },
      { label: 'Users must fill it in', value: field.is_required ? 'Yes' : 'No' },
      { label: 'Card type', value: template.name },
    ],
    consequences,
    confirmLabel: 'Delete field',
  };
}

export function addCountryConfirm(template: Template, country: BrandCountry): ConfirmOptions {
  const place = country.country_name;
  const consequences = [
    template.fields.length === 0
      ? `${template.name} has no fields, so users will not be asked for a card code or an image.`
      : `Users in ${place} are asked for ${listText(template.fields.map(fieldLine))}.`,
    `It has no rates in ${place} yet, so users cannot submit it until you set them on the Rates page.`,
    `Later changes to its fields do not reach ${place}; it keeps the fields it is added with.`,
    REACH_NOTE,
  ];
  return {
    tone: 'financial',
    title: `Add ${template.name} to ${place}?`,
    message: `${template.name} goes live for users in ${place} as soon as you confirm.`,
    details: [
      { label: 'Card type', value: template.name, emphasis: true },
      { label: 'Country', value: `${place} (${country.country_code})` },
      { label: 'Fields copied', value: template.fields.length ? String(template.fields.length) : 'None' },
      { label: 'Status', value: 'Not added → Live' },
    ],
    consequences,
    confirmLabel: `Add to ${place}`,
  };
}

export function toggleCountryConfirm(
  template: Template,
  install: Install,
  countries: readonly BrandCountry[],
  next: boolean,
): ConfirmOptions {
  const place = countryLabel(install, countries);
  const details: ConfirmDetail[] = [
    { label: 'Card type', value: template.name },
    { label: 'Country', value: `${place} (${install.country_code})` },
    { label: 'Status', value: next ? 'Off → Live' : 'Live → Off', emphasis: true },
    { label: 'Rates', value: rateText(install) },
  ];
  if (next) {
    const consequences = [`Users in ${place} can pick ${template.name} again.`];
    if (install.active_rate_count === 0) {
      consequences.push(`It has no live rates in ${place}, so users cannot submit it until you set them on the Rates page.`);
    }
    if (fieldsDiffer(template, install)) {
      consequences.push(`${place} still asks for the fields it was added with, which differ from the card type’s current fields.`);
    }
    consequences.push(REACH_NOTE);
    return {
      tone: 'financial',
      title: `Switch ${template.name} on in ${place}?`,
      details,
      consequences,
      confirmLabel: `Switch on in ${place}`,
    };
  }
  return {
    tone: 'financial',
    title: `Switch ${template.name} off in ${place}?`,
    details,
    consequences: [
      `Users in ${place} can no longer pick ${template.name}. Cards already submitted can still be reviewed.`,
      'Its fields and rates are kept, so you can switch it back on later.',
      REACH_NOTE,
    ],
    confirmLabel: `Switch off in ${place}`,
  };
}

function detailField(details: unknown): string | null {
  return text(record(details)?.field);
}

export function classifyMutation(result: ApiResult<ApiBody>): MutationAttempt {
  if (result.ok) return { kind: 'done', body: result.data, warning: text(result.data.warning) };
  const { error } = result;
  if (error.outcomeUnknown) return { kind: 'unknown', message: error.message };
  const field = detailField(error.details);
  if (error.status !== null && FINAL_STATUSES.has(error.status)) {
    return { kind: 'refused', status: error.status, message: error.message, field };
  }
  return { kind: 'retry', message: error.message, field };
}

export function createdTemplateText(name: string, cardName: string): string {
  return `${name} added to ${cardName}. Give it fields, then add it to a country to make it live.`;
}

export function renamedTemplateText(name: string, countriesRenamed: number): string {
  return countriesRenamed > 0
    ? `Renamed to ${name}, here and in the ${plural(countriesRenamed, 'country', 'countries')} it was added to.`
    : `Renamed to ${name}.`;
}

export function deletedTemplateText(template: Template): string {
  const kept = template.countries.length;
  if (kept === 0) return `${template.name} deleted.`;
  return kept === 1
    ? `${template.name} deleted. Its country was kept and still works for users if it was live.`
    : `${template.name} deleted. Its ${kept} countries were kept and still work for users where they were live.`;
}

export function savedFieldText(created: boolean, label: string, template: Template): string {
  const lead = created ? `${label} added to ${template.name}.` : `${label} saved.`;
  return template.countries.length > 0
    ? `${lead} It applies to countries you add ${template.name} to from now on.`
    : lead;
}

export function deletedFieldText(label: string, templateName: string): string {
  return `${label} removed from ${templateName}.`;
}

export function addedCountryText(templateName: string, place: string, body: ApiBody): string {
  if (body.already_live === true) return `${templateName} was already live in ${place}.`;
  if (body.reactivated === true) return `${templateName} is live in ${place} again.`;
  return `${templateName} is live in ${place}. Set its rates on the Rates page so users can submit it.`;
}

export function switchedCountryText(templateName: string, place: string, next: boolean, body: ApiBody): string {
  if (body.changed === false) return `${templateName} was already ${next ? 'live' : 'switched off'} in ${place}.`;
  return next ? `${templateName} is live in ${place}.` : `${templateName} is switched off in ${place}.`;
}

export function movedText(name: string, position: number, total: number): string {
  return `Moved ${name} to position ${position} of ${total}.`;
}

function arrange<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const rest = items.filter((item) => !ids.includes(item.id));
  return [...ordered, ...rest];
}

export function withTemplateOrder(data: BuilderData, ids: readonly string[]): BuilderData {
  return { ...data, templates: arrange(data.templates, ids) };
}

export function withFieldOrder(data: BuilderData, templateId: string, ids: readonly string[]): BuilderData {
  return {
    ...data,
    templates: data.templates.map((template) => (
      template.id === templateId ? { ...template, fields: arrange(template.fields, ids) } : template
    )),
  };
}
