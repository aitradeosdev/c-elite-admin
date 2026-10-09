import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ElementType } from 'react';
import { loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiBody, ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type {
  BrandCountry, BuilderData, Install, Template, TemplateField,
} from '../app/(dashboard)/field-builder/model.ts';
import type { TemplateCardProps } from '../app/(dashboard)/field-builder/BuilderParts.tsx';

type RulesModule = typeof import('../app/(dashboard)/field-builder/rules.ts');
type ModelModule = typeof import('../app/(dashboard)/field-builder/model.ts');

let rules: RulesModule;
let model: ModelModule;
let TemplateCard: ElementType<TemplateCardProps>;

before(async () => {
  rules = await loadAppModule<RulesModule>('(dashboard)/field-builder/rules.ts');
  model = await loadAppModule<ModelModule>('(dashboard)/field-builder/model.ts');
  TemplateCard = (await loadAppModule<{ TemplateCard: ElementType<TemplateCardProps> }>(
    '(dashboard)/field-builder/BuilderParts.tsx',
  )).TemplateCard;
});

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const F1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const F2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const I1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const I2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const COUNTRIES: BrandCountry[] = [
  { country_code: 'NG', country_name: 'Nigeria' },
  { country_code: 'GH', country_name: 'Ghana' },
  { country_code: 'US', country_name: 'United States' },
];

function field(id: string, label: string, patch: Partial<TemplateField> = {}): TemplateField {
  return { id, label, input_type: 'text', is_required: true, ...patch };
}

function install(id: string, code: string, patch: Partial<Install> = {}): Install {
  return {
    id,
    country_code: code,
    country_name: COUNTRIES.find((country) => country.country_code === code)?.country_name ?? null,
    is_active: true,
    active_rate_count: 3,
    fields: [{ label: 'Card code', input_type: 'text', is_required: true }],
    ...patch,
  };
}

function template(patch: Partial<Template> = {}): Template {
  return {
    id: T1,
    name: 'E-code',
    fields: [field(F1, 'Card code')],
    countries: [],
    ...patch,
  };
}

function failure(patch: Partial<ApiFailure>): ApiResult<ApiBody> {
  return {
    ok: false,
    error: {
      kind: 'http',
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side.',
      requestId: 'req_1',
      details: null,
      outcomeUnknown: false,
      ...patch,
    },
  };
}

describe('field-builder rules: text and types', () => {
  test('input types are the three the database allows', () => {
    assert.deepEqual([...rules.INPUT_TYPES], ['text', 'image', 'image_text']);
    assert.equal(rules.isInputType('image_text'), true);
    assert.equal(rules.isInputType('file'), false);
    assert.equal(rules.isInputType(null), false);
    assert.equal(rules.inputTypeLabel('image'), 'Image upload');
    assert.equal(rules.inputTypeLabel(null), 'Unknown type');
  });

  test('cleanText trims and collapses whitespace, and rejects non-strings', () => {
    assert.equal(rules.cleanText('  Card   code \n'), 'Card code');
    assert.equal(rules.cleanText(42), '');
    assert.equal(rules.cleanText(undefined), '');
  });

  test('textKey compares names case- and space-insensitively', () => {
    assert.equal(rules.textKey(' E-Code '), rules.textKey('e-code'));
    assert.notEqual(rules.textKey('E-code'), rules.textKey('Ecode'));
  });

  test('nameProblem and labelProblem enforce presence and length', () => {
    assert.match(rules.nameProblem('') ?? '', /Enter a name/);
    assert.equal(rules.nameProblem('E-code'), null);
    assert.match(rules.nameProblem('x'.repeat(rules.NAME_MAX + 1)) ?? '', new RegExp(`${rules.NAME_MAX} characters`));
    assert.equal(rules.nameProblem('x'.repeat(rules.NAME_MAX)), null);
    assert.match(rules.labelProblem('') ?? '', /Enter a label/);
    assert.match(rules.labelProblem('y'.repeat(rules.LABEL_MAX + 1)) ?? '', new RegExp(`${rules.LABEL_MAX} characters`));
    assert.equal(rules.labelProblem('Card code'), null);
  });

  test('findDuplicate ignores case and spacing and skips the item being edited', () => {
    const items = [{ id: T1, name: 'E-code' }, { id: T2, name: 'Physical card' }];
    assert.equal(rules.findDuplicate(items, (item) => item.name, '  e-CODE ')?.id, T1);
    assert.equal(rules.findDuplicate(items, (item) => item.name, 'E-code', T1), null);
    assert.equal(rules.findDuplicate(items, (item) => item.name, 'E-code', T1.toUpperCase()), null);
    assert.equal(rules.findDuplicate(items, (item) => item.name, 'Receipt'), null);
    assert.equal(rules.findDuplicate(items, (item) => item.name, '   '), null);
  });

  test('country codes are 2-3 letters, matched without regard to case', () => {
    assert.equal(rules.normalizeCountryCode(' ng '), 'NG');
    assert.equal(rules.normalizeCountryCode('USA'), 'USA');
    assert.equal(rules.normalizeCountryCode('N1'), null);
    assert.equal(rules.normalizeCountryCode('NIGR'), null);
    assert.equal(rules.normalizeCountryCode(7), null);
    assert.equal(rules.sameCountryCode('ng', 'NG'), true);
    assert.equal(rules.sameCountryCode('NG', 'GH'), false);
    assert.equal(rules.sameCountryCode(null, 'NG'), false);
  });

  test('parseIdList accepts only arrays of UUIDs and lower-cases them', () => {
    assert.deepEqual(rules.parseIdList([T1.toUpperCase(), T2]), [T1, T2]);
    assert.deepEqual(rules.parseIdList([]), []);
    assert.equal(rules.parseIdList([T1, 'nope']), null);
    assert.equal(rules.parseIdList(T1), null);
    assert.equal(rules.parseIdList(null), null);
  });

  test('parseSortOrder accepts whole numbers in range, including numeric strings', () => {
    assert.equal(rules.parseSortOrder(3), 3);
    assert.equal(rules.parseSortOrder('4'), 4);
    assert.equal(rules.parseSortOrder(0), 0);
    assert.equal(rules.parseSortOrder(-1), null);
    assert.equal(rules.parseSortOrder(1.5), null);
    assert.equal(rules.parseSortOrder(rules.SORT_ORDER_MAX + 1), null);
    assert.equal(rules.parseSortOrder(''), null);
    assert.equal(rules.parseSortOrder(null), null);
  });
});

describe('field-builder rules: ordering', () => {
  test('planReorder writes only the rows whose position changes', () => {
    const plan = rules.planReorder(
      [{ id: T1, sort_order: 0 }, { id: T2, sort_order: 1 }, { id: T3, sort_order: 2 }],
      [T2, T1, T3],
    );
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.order, [T2, T1, T3]);
    assert.deepEqual(plan.updates, [{ id: T2, sort_order: 0 }, { id: T1, sort_order: 1 }]);
  });

  test('planReorder renumbers tied or gapped sort orders into 0..n-1', () => {
    const plan = rules.planReorder(
      [{ id: T1, sort_order: 0 }, { id: T2, sort_order: 0 }, { id: T3, sort_order: 7 }],
      [T1, T2, T3],
    );
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.updates, [{ id: T2, sort_order: 1 }, { id: T3, sort_order: 2 }]);
  });

  test('planReorder returns no updates when nothing moved', () => {
    const plan = rules.planReorder([{ id: T1, sort_order: 0 }, { id: T2, sort_order: 1 }], [T1, T2]);
    assert.equal(plan.ok, true);
    if (plan.ok) assert.deepEqual(plan.updates, []);
  });

  test('planReorder refuses a list that does not match the current set exactly', () => {
    const current = [{ id: T1, sort_order: 0 }, { id: T2, sort_order: 1 }];
    assert.deepEqual(rules.planReorder(current, [T1]), { ok: false, reason: 'mismatch' });
    assert.deepEqual(rules.planReorder(current, [T1, T2, T3]), { ok: false, reason: 'mismatch' });
    assert.deepEqual(rules.planReorder(current, [T1, T3]), { ok: false, reason: 'mismatch' });
    assert.deepEqual(rules.planReorder(current, [T1, T1]), { ok: false, reason: 'duplicate' });
    assert.deepEqual(rules.planReorder(current, []), { ok: false, reason: 'empty' });
  });

  test('planReorder caps the list length and matches ids without regard to case', () => {
    const many = Array.from({ length: rules.REORDER_MAX + 1 }, (_, index) => `${index}`);
    assert.deepEqual(rules.planReorder([], many), { ok: false, reason: 'too_many' });
    const plan = rules.planReorder([{ id: T1, sort_order: 1 }], [T1.toUpperCase()]);
    assert.equal(plan.ok, true);
    if (plan.ok) assert.deepEqual(plan.updates, [{ id: T1, sort_order: 0 }]);
  });

  test('moveId swaps with the neighbour and refuses to move past either end', () => {
    assert.deepEqual(rules.moveId([T1, T2, T3], T2, 'up'), [T2, T1, T3]);
    assert.deepEqual(rules.moveId([T1, T2, T3], T2, 'down'), [T1, T3, T2]);
    assert.equal(rules.moveId([T1, T2, T3], T1, 'up'), null);
    assert.equal(rules.moveId([T1, T2, T3], T3, 'down'), null);
    assert.equal(rules.moveId([T1, T2], T3, 'up'), null);
  });

  test('reorderRefusalText explains each refusal', () => {
    assert.match(rules.reorderRefusalText('mismatch', 'fields'), /changed since you loaded them/);
    assert.match(rules.reorderRefusalText('duplicate', 'card types'), /only once/);
    assert.match(rules.reorderRefusalText('too_many', 'fields'), new RegExp(String(rules.REORDER_MAX)));
    assert.match(rules.reorderRefusalText('empty', 'fields'), /full list/);
  });
});

describe('field-builder model: reading responses', () => {
  test('toBrandList needs a cards array and normalises each row', () => {
    assert.equal(model.toBrandList({}), null);
    const list = model.toBrandList({
      cards: [
        { id: T1, name: 'Amazon', logo_url: 'https://x/a.png', is_active: true, template_count: 2 },
        { id: T2, name: '  ', is_active: null, template_count: null },
        { name: 'No id' },
        'junk',
      ],
    });
    assert.deepEqual(list, [
      { id: T1, name: 'Amazon', logo_url: 'https://x/a.png', is_active: true, template_count: 2 },
      { id: T2, name: model.UNNAMED_CARD, logo_url: null, is_active: false, template_count: null },
    ]);
  });

  test('brandDescription summarises card types and a switched-off card', () => {
    assert.equal(
      model.brandDescription({ id: T1, name: 'A', logo_url: null, is_active: true, template_count: 1 }),
      '1 card type',
    );
    assert.equal(
      model.brandDescription({ id: T1, name: 'A', logo_url: null, is_active: false, template_count: 3 }),
      '3 card types · Switched off in Cards',
    );
    assert.equal(model.brandDescription({ id: T1, name: 'A', logo_url: null, is_active: true, template_count: null }), undefined);
  });

  test('toBuilderData keeps the server order and tolerates missing detail', () => {
    assert.equal(model.toBuilderData({ countries: [] }), null);
    const data = model.toBuilderData({
      card: { id: T3, name: 'Amazon', is_active: true },
      templates: [
        {
          id: T2,
          name: 'Physical',
          is_active: null,
          sort_order: 0,
          fields: [{ id: F2, label: 'Front photo', input_type: 'image', is_required: false, sort_order: 0 }],
          countries: [
            { id: I1, country_code: 'NG', is_active: true, country_name: 'Nigeria', active_rate_count: 4, fields: [] },
            { id: I2, country_code: 'GH', is_active: null },
          ],
        },
        { id: T1, name: 'E-code', fields: [], countries: [] },
        { name: 'missing id' },
      ],
      countries: [{ country_code: 'NG', country_name: 'Nigeria', is_active: true }, { country_code: 'GH' }],
    });
    assert.ok(data);
    assert.deepEqual(data.card, { id: T3, name: 'Amazon', is_active: true });
    assert.deepEqual(data.templates.map((item) => item.id), [T2, T1]);
    const [physical] = data.templates;
    assert.deepEqual(physical.fields, [{ id: F2, label: 'Front photo', input_type: 'image', is_required: false }]);
    assert.deepEqual(physical.countries[0], {
      id: I1, country_code: 'NG', country_name: 'Nigeria', is_active: true, active_rate_count: 4, fields: [],
    });
    assert.deepEqual(physical.countries[1], {
      id: I2, country_code: 'GH', country_name: null, is_active: false, active_rate_count: null, fields: null,
    });
    assert.deepEqual(data.countries, [
      { country_code: 'NG', country_name: 'Nigeria' },
      { country_code: 'GH', country_name: 'GH' },
    ]);
  });

  test('countryLabel falls back from the install, to the card countries, to the code', () => {
    assert.equal(model.countryLabel({ country_code: 'NG', country_name: 'Naija' }, COUNTRIES), 'Naija');
    assert.equal(model.countryLabel({ country_code: 'gh', country_name: null }, COUNTRIES), 'Ghana');
    assert.equal(model.countryLabel({ country_code: 'ZZ', country_name: null }, COUNTRIES), 'ZZ');
  });

  test('addableCountries leaves out countries the card type is already in', () => {
    const tpl = template({ countries: [install(I1, 'ng', { is_active: false })] });
    assert.deepEqual(model.addableCountries(tpl, COUNTRIES).map((country) => country.country_code), ['GH', 'US']);
  });
});

describe('field-builder model: summaries', () => {
  test('templateSummary states fields and where it is live', () => {
    assert.equal(model.templateSummary(template()), '1 field · Not in any country yet');
    assert.equal(
      model.templateSummary(template({ fields: [], countries: [install(I1, 'NG')] })),
      '0 fields · Live in 1 country',
    );
    assert.equal(
      model.templateSummary(template({ countries: [install(I1, 'NG'), install(I2, 'GH', { is_active: false })] })),
      '1 field · Live in 1 of 2 countries',
    );
    assert.equal(
      model.templateSummary(template({ countries: [install(I1, 'NG', { is_active: false })] })),
      '1 field · Switched off in 1 country',
    );
    assert.equal(
      model.templateSummary(template({
        countries: [install(I1, 'NG', { is_active: false }), install(I2, 'GH', { is_active: false })],
      })),
      '1 field · Switched off in all 2 countries',
    );
  });

  test('fieldSummary and rateText describe a row in plain words', () => {
    assert.equal(model.fieldSummary({ input_type: 'image_text', is_required: false }), 'Image and text · Optional');
    assert.equal(model.fieldSummary({ input_type: 'text', is_required: true }), 'Text · Required');
    assert.equal(model.rateText(install(I1, 'NG', { active_rate_count: 0 })), 'No rates');
    assert.equal(model.rateText(install(I1, 'NG', { active_rate_count: 1 })), '1 rate');
    assert.equal(model.rateText(install(I1, 'NG', { active_rate_count: null })), 'Rates not checked');
  });

  test('fieldsDiffer compares the copied fields with the template, ignoring order', () => {
    const tpl = template({ fields: [field(F1, 'Card code'), field(F2, 'Photo', { input_type: 'image' })] });
    const same = install(I1, 'NG', {
      fields: [
        { label: 'photo', input_type: 'image', is_required: true },
        { label: 'Card code', input_type: 'text', is_required: true },
      ],
    });
    const older = install(I2, 'GH', { fields: [{ label: 'Card code', input_type: 'text', is_required: true }] });
    const optional = install(I2, 'GH', {
      fields: [
        { label: 'Card code', input_type: 'text', is_required: false },
        { label: 'Photo', input_type: 'image', is_required: true },
      ],
    });
    assert.equal(model.fieldsDiffer(tpl, same), false);
    assert.equal(model.fieldsDiffer(tpl, older), true);
    assert.equal(model.fieldsDiffer(tpl, optional), true);
    assert.equal(model.fieldsDiffer(tpl, install(I2, 'GH', { fields: null })), null);
  });

  test('listText and plural read naturally', () => {
    assert.equal(model.listText([]), '');
    assert.equal(model.listText(['Nigeria']), 'Nigeria');
    assert.equal(model.listText(['Nigeria', 'Ghana']), 'Nigeria and Ghana');
    assert.equal(model.listText(['Nigeria', 'Ghana', 'Kenya']), 'Nigeria, Ghana and Kenya');
    assert.equal(model.plural(1, 'country', 'countries'), '1 country');
    assert.equal(model.plural(0, 'field'), '0 fields');
  });
});

describe('field-builder model: confirmations', () => {
  test('deleting a card type that is live names the countries and requires acknowledgement', () => {
    const tpl = template({
      fields: [field(F1, 'Card code'), field(F2, 'Photo')],
      countries: [install(I1, 'NG'), install(I2, 'GH', { is_active: false, active_rate_count: 0 })],
    });
    const options = model.deleteTemplateConfirm(tpl, 'Amazon', COUNTRIES);
    assert.equal(options.tone, 'danger');
    assert.equal(options.title, 'Delete E-code?');
    assert.equal(options.confirmLabel, 'Delete card type');
    assert.equal(options.acknowledge, 'I understand E-code stays live in Nigeria.');
    const details = Object.fromEntries((options.details ?? []).map((detail) => [detail.label, detail.value]));
    assert.equal(details['Card'], 'Amazon');
    assert.equal(details['Fields deleted'], 'Card code and Photo');
    assert.equal(details['Countries kept'], 'Nigeria (live) and Ghana (off)');
    const text = (options.consequences ?? []).join(' ');
    assert.match(text, /This cannot be undone/);
    assert.match(text, /2 countries keep their own copy of the fields and their rates/);
    assert.match(text, /Users in Nigeria can still sell E-code/);
    assert.match(text, /Switch it off first/);
    assert.match(text, /two card types called E-code/);
  });

  test('deleting a card type that is in no country says users are not affected', () => {
    const options = model.deleteTemplateConfirm(template(), 'Amazon', COUNTRIES);
    assert.equal(options.acknowledge, undefined);
    const text = (options.consequences ?? []).join(' ');
    assert.match(text, /not in any country, so users are not affected/);
    assert.doesNotMatch(text, /two card types/);
  });

  test('deleting a field names the countries that keep their copy', () => {
    const tpl = template({
      fields: [field(F1, 'Card code'), field(F2, 'Photo')],
      countries: [
        install(I1, 'NG', { fields: [{ label: 'card code', input_type: 'text', is_required: true }] }),
        install(I2, 'GH', { fields: [{ label: 'Photo', input_type: 'image', is_required: true }] }),
      ],
    });
    const options = model.deleteFieldConfirm(tpl, tpl.fields[0], COUNTRIES);
    assert.equal(options.tone, 'danger');
    assert.equal(options.title, 'Delete the Card code field?');
    const text = (options.consequences ?? []).join(' ');
    assert.match(text, /Countries you add E-code to from now on will not ask users for Card code/);
    assert.match(text, /Nigeria keeps its own copy, so users there are still asked for Card code/);
    assert.doesNotMatch(text, /Ghana/);
  });

  test('deleting a field hedges when the copies could not be read, and is plain when none has it', () => {
    const unknown = template({ countries: [install(I1, 'NG', { fields: null })] });
    assert.match(
      (model.deleteFieldConfirm(unknown, unknown.fields[0], COUNTRIES).consequences ?? []).join(' '),
      /if their copy has it/,
    );
    const none = template({ countries: [install(I1, 'NG', { fields: [] })] });
    assert.match(
      (model.deleteFieldConfirm(none, none.fields[0], COUNTRIES).consequences ?? []).join(' '),
      /None of the countries already added ask for Card code/,
    );
  });

  test('adding to a country lists what users are asked for and warns about rates', () => {
    const tpl = template({ fields: [field(F1, 'Card code'), field(F2, 'Receipt', { is_required: false })] });
    const options = model.addCountryConfirm(tpl, COUNTRIES[1]);
    assert.equal(options.title, 'Add E-code to Ghana?');
    assert.equal(options.confirmLabel, 'Add to Ghana');
    assert.equal(options.tone, 'financial');
    const text = (options.consequences ?? []).join(' ');
    assert.match(text, /Users in Ghana are asked for Card code and Receipt \(optional\)/);
    assert.match(text, /no rates in Ghana yet/);
    assert.match(text, /keeps the fields it is added with/);
    const status = (options.details ?? []).find((detail) => detail.label === 'Status');
    assert.equal(status?.value, 'Not added → Live');
    const empty = model.addCountryConfirm(template({ fields: [] }), COUNTRIES[0]);
    assert.match((empty.consequences ?? []).join(' '), /has no fields, so users will not be asked/);
  });

  test('switching a country states the before and after status', () => {
    const tpl = template({ fields: [field(F1, 'Card code'), field(F2, 'Photo')] });
    const off = install(I1, 'NG', { is_active: false, active_rate_count: 0 });
    const on = model.toggleCountryConfirm(tpl, off, COUNTRIES, true);
    assert.equal(on.title, 'Switch E-code on in Nigeria?');
    assert.equal((on.details ?? []).find((detail) => detail.label === 'Status')?.value, 'Off → Live');
    const onText = (on.consequences ?? []).join(' ');
    assert.match(onText, /no live rates in Nigeria/);
    assert.match(onText, /differ from the card type’s current fields/);
    const offOptions = model.toggleCountryConfirm(tpl, install(I1, 'NG'), COUNTRIES, false);
    assert.equal(offOptions.confirmLabel, 'Switch off in Nigeria');
    assert.equal(on.tone, 'financial');
    assert.equal(offOptions.tone, 'financial');
    assert.equal((offOptions.details ?? []).find((detail) => detail.label === 'Status')?.value, 'Live → Off');
    assert.match((offOptions.consequences ?? []).join(' '), /Cards already submitted can still be reviewed/);
  });
});

describe('field-builder model: outcomes and messages', () => {
  test('classifyMutation separates done, unknown, final refusals and retryable failures', () => {
    assert.deepEqual(model.classifyMutation({ ok: true, data: { success: true }, status: 200, requestId: null }), {
      kind: 'done', body: { success: true }, warning: null,
    });
    const warned = model.classifyMutation({ ok: true, data: { warning: ' Not audited. ' }, status: 200, requestId: null });
    assert.equal(warned.kind === 'done' ? warned.warning : null, 'Not audited.');
    assert.deepEqual(model.classifyMutation(failure({ kind: 'network', status: null, code: null, outcomeUnknown: true, message: 'm' })), {
      kind: 'unknown', message: 'm',
    });
    assert.deepEqual(
      model.classifyMutation(failure({ status: 409, code: 'STATE_CONFLICT', message: 'Taken', details: { field: 'name' } })),
      { kind: 'refused', status: 409, message: 'Taken', field: 'name' },
    );
    assert.deepEqual(model.classifyMutation(failure({ status: 403, code: 'PERMISSION_DENIED', message: 'No' })), {
      kind: 'refused', status: 403, message: 'No', field: null,
    });
    assert.deepEqual(
      model.classifyMutation(failure({ status: 400, code: 'VALIDATION_ERROR', message: 'Bad', details: { field: 'label' } })),
      { kind: 'retry', message: 'Bad', field: 'label' },
    );
    assert.equal(model.classifyMutation(failure({})).kind, 'retry');
  });

  test('success messages describe what changed for users', () => {
    assert.match(model.createdTemplateText('E-code', 'Amazon'), /E-code added to Amazon/);
    assert.equal(model.renamedTemplateText('Digital', 0), 'Renamed to Digital.');
    assert.equal(
      model.renamedTemplateText('Digital', 2),
      'Renamed to Digital, here and in the 2 countries it was added to.',
    );
    assert.equal(model.deletedTemplateText(template()), 'E-code deleted.');
    assert.equal(
      model.deletedTemplateText(template({ countries: [install(I1, 'NG')] })),
      'E-code deleted. Its country was kept and still works for users if it was live.',
    );
    assert.equal(
      model.deletedTemplateText(template({ countries: [install(I1, 'NG'), install(I2, 'GH')] })),
      'E-code deleted. Its 2 countries were kept and still work for users where they were live.',
    );
    assert.equal(model.savedFieldText(true, 'PIN', template()), 'PIN added to E-code.');
    assert.equal(
      model.savedFieldText(false, 'PIN', template({ countries: [install(I1, 'NG')] })),
      'PIN saved. It applies to countries you add E-code to from now on.',
    );
    assert.equal(model.deletedFieldText('PIN', 'E-code'), 'PIN removed from E-code.');
    assert.equal(model.addedCountryText('E-code', 'Ghana', { already_live: true }), 'E-code was already live in Ghana.');
    assert.equal(model.addedCountryText('E-code', 'Ghana', { reactivated: true }), 'E-code is live in Ghana again.');
    assert.match(model.addedCountryText('E-code', 'Ghana', { id: I1 }), /Set its rates on the Rates page/);
    assert.equal(model.switchedCountryText('E-code', 'Ghana', false, { changed: true }), 'E-code is switched off in Ghana.');
    assert.equal(model.switchedCountryText('E-code', 'Ghana', true, { changed: false }), 'E-code was already live in Ghana.');
    assert.equal(model.movedText('E-code', 1, 3), 'Moved E-code to position 1 of 3.');
  });

  test('optimistic reorder keeps unlisted items at the end and leaves other card types alone', () => {
    const data: BuilderData = {
      card: { id: T3, name: 'Amazon', is_active: true },
      templates: [
        template({ id: T1, fields: [field(F1, 'A'), field(F2, 'B')] }),
        template({ id: T2, name: 'Physical', fields: [field(F1, 'X')] }),
      ],
      countries: COUNTRIES,
    };
    assert.deepEqual(model.withTemplateOrder(data, [T2, T1]).templates.map((item) => item.id), [T2, T1]);
    assert.deepEqual(model.withTemplateOrder(data, [T2]).templates.map((item) => item.id), [T2, T1]);
    const reordered = model.withFieldOrder(data, T1, [F2, F1]);
    assert.deepEqual(reordered.templates[0].fields.map((item) => item.label), ['B', 'A']);
    assert.equal(reordered.templates[1], data.templates[1]);
    assert.equal(data.templates[0].fields[0].label, 'A');
  });
});

describe('field-builder template card markup', () => {
  const noop = () => {};

  function card(patch: Partial<TemplateCardProps> = {}): string {
    const props: TemplateCardProps = {
      template: template({
        fields: [field(F1, 'Card code'), field(F2, 'Photo', { input_type: 'image', is_required: false })],
        countries: [install(I1, 'NG'), install(I2, 'GH', { is_active: false, active_rate_count: 0, fields: [] })],
      }),
      index: 0,
      total: 2,
      countries: COUNTRIES,
      expanded: true,
      canWrite: true,
      moving: false,
      onToggleExpanded: noop,
      onMove: noop,
      onRename: noop,
      onDelete: noop,
      onSwitchCountry: noop,
      onAddCountry: noop,
      onAddField: noop,
      onEditField: noop,
      onDeleteField: noop,
      onMoveField: noop,
      ...patch,
    };
    return render(createElement(TemplateCard, props));
  }

  function button(html: string, label: string) {
    return tagsOf(html, 'button').find((attrs) => attrs['aria-label'] === label);
  }

  test('the heading is a disclosure button that controls the body', () => {
    const html = card({ expanded: false });
    const toggle = tagsOf(html, 'button').find((attrs) => attrs['aria-expanded'] !== undefined);
    assert.ok(toggle);
    assert.equal(toggle['aria-expanded'], 'false');
    const body = tagsOf(html, 'div').find((attrs) => attrs.id === toggle['aria-controls']);
    assert.ok(body);
    assert.equal(body.hidden, '');
    assert.match(textOf(html), /2 fields · Live in 1 of 2 countries/);
  });

  test('move buttons are named for the item and disabled at the ends of the list', () => {
    const first = card({ index: 0, total: 2 });
    assert.equal(button(first, 'Move E-code up')?.disabled, '');
    assert.equal(button(first, 'Move E-code down')?.disabled, undefined);
    const last = card({ index: 1, total: 2 });
    assert.equal(button(last, 'Move E-code down')?.disabled, '');
    assert.equal(button(card({ moving: true }), 'Move E-code down')?.disabled, '');
    assert.equal(button(card({ total: 1 }), 'Move E-code up'), undefined);
    assert.equal(button(first, 'Move Card code up')?.disabled, '');
    assert.equal(button(first, 'Move Photo down')?.disabled, '');
    assert.ok(button(first, 'Rename E-code'));
    assert.ok(button(first, 'Delete Photo'));
    assert.ok(button(first, 'Add field to E-code'));
  });

  test('every write control is disabled while a new order is saving', () => {
    const html = card({ moving: true });
    for (const label of ['Rename E-code', 'Delete E-code', 'Edit Card code', 'Delete Photo', 'Add field to E-code']) {
      assert.equal(button(html, label)?.disabled, '', label);
    }
    const switches = tagsOf(html, 'input').filter((attrs) => attrs.role === 'switch');
    assert.ok(switches.length > 0);
    for (const attrs of switches) assert.equal(attrs.disabled, '');
    assert.equal(button(card(), 'Rename E-code')?.disabled, undefined);
  });

  test('countries show live state as a labelled switch, rates and drifted fields', () => {
    const html = card();
    const switches = tagsOf(html, 'input').filter((attrs) => attrs.role === 'switch');
    assert.deepEqual(switches.map((attrs) => attrs['aria-label']), ['E-code live in Nigeria', 'E-code live in Ghana']);
    assert.equal(switches[0].checked, '');
    assert.equal(switches[1].checked, undefined);
    const text = textOf(html);
    assert.match(text, /3 rates/);
    assert.match(text, /No rates/);
    assert.match(text, /Fields differ/);
    assert.match(text, /Choose a country/);
    assert.match(text, /United States/);
  });

  test('without card_types.write the card is read-only', () => {
    const html = card({ canWrite: false });
    assert.equal(button(html, 'Rename E-code'), undefined);
    assert.equal(button(html, 'Move E-code down'), undefined);
    assert.equal(button(html, 'Add field to E-code'), undefined);
    assert.equal(tagsOf(html, 'input').filter((attrs) => attrs.role === 'switch').length, 0);
    assert.doesNotMatch(textOf(html), /Choose a country/);
    assert.match(textOf(html), /Live/);
    assert.match(textOf(html), /Off/);
  });
});
