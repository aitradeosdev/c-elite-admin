import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createElement, type ElementType } from 'react';
import { loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiBody, ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type {
  BrandCountry, BuilderData, Install, Template, TemplateField,
} from '../app/(dashboard)/field-builder/model.ts';
import type { TemplateCardProps } from '../app/(dashboard)/field-builder/BuilderParts.tsx';
import type { ReorderRefusal } from '../app/(dashboard)/field-builder/rules.ts';

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

const ROUTE_STATE = '__fieldBuilderRouteTest';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const IMPORTS = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;
const REQUEST_ID = 'req_fbroute01';
const USER_AGENT = 'field-builder-route-test';
const CLIENT_IP = '198.51.100.31';
const AUDIT_DOWN = 'audit store unavailable';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const SIGNED_OUT = 'Your session has expired. Sign in again.';
const NOT_SAVED = 'The new order could not be saved.';
const ORDER_UNCONFIRMED = 'The new order could not be confirmed. Reload to see the current order before trying again.';
const CARD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

interface RouteClaims {
  admin_id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  token_version: number;
}

interface RpcError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

interface RpcReply {
  data: unknown;
  error: RpcError | null;
}

interface AuditInsert {
  data: null;
  error: { message: string } | null;
}

interface RouteState {
  claims: RouteClaims | null;
  reply: RpcReply;
  calls: Array<{ name: string; params: unknown }>;
  tables: string[];
  audits: Array<Record<string, unknown>>;
  auditError: string | null;
  from: (table: string) => { insert: (row: Record<string, unknown>) => Promise<AuditInsert> };
  rpc: (name: string, params: unknown) => Promise<RpcReply>;
}

interface BuilderRoute {
  POST: (req: Request) => Promise<Response>;
  PATCH: (req: Request) => Promise<Response>;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const OWNER: RouteClaims = {
  admin_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  username: 'owner',
  role_title: 'Super Admin',
  is_super_admin: true,
  page_permissions: [],
  token_version: 0,
};

const route: RouteState = {
  claims: OWNER,
  reply: { data: null, error: null },
  calls: [],
  tables: [],
  audits: [],
  auditError: null,
  from(table) {
    route.tables.push(table);
    if (table !== 'audit_log') throw new Error(`this change must not touch ${table} directly`);
    return {
      insert: async (row) => {
        if (route.auditError) return { data: null, error: { message: route.auditError } };
        route.audits.push(row);
        return { data: null, error: null };
      },
    };
  },
  async rpc(name, params) {
    route.calls.push({ name, params });
    return route.reply;
  },
};
(globalThis as unknown as Record<string, unknown>)[ROUTE_STATE] = route;

const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const stateRef = `const state = () => globalThis.${ROUTE_STATE};`;

const FILE_STUBS: Readonly<Record<string, string>> = {
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: moduleUrl(`${stateRef}
export const supabaseAdmin = {
  from: (table) => state().from(table),
  rpc: (name, params) => state().rpc(name, params),
};`),
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: moduleUrl(`${stateRef}
export async function verifyAdminFromRequest() { return state().claims; }`),
};

const PACKAGE_STUBS: Readonly<Record<string, string>> = {
  'next/headers': moduleUrl(`
export async function headers() {
  return new Headers({ 'x-request-id': '${REQUEST_ID}', 'user-agent': '${USER_AGENT}', 'x-forwarded-for': '${CLIENT_IP}' });
}
export async function cookies() { return { get: () => undefined }; }`),
  'next/server': moduleUrl('export const NextResponse = { json: (body, init) => Response.json(body, init) };'),
};

const routeBundles = new Map<string, Promise<string>>();

function resolveImport(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const found = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]
    .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
  if (!found) throw new Error(`${fromFile} imports ${specifier}, which does not resolve to a .ts file`);
  return found;
}

async function compileRoute(file: string): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const targets = new Map<string, string>();
  for (const [, , specifier] of outputText.matchAll(IMPORTS)) {
    if (targets.has(specifier)) continue;
    if (specifier.startsWith('.')) {
      const target = resolveImport(file, specifier);
      targets.set(specifier, FILE_STUBS[target] ?? (await bundleRoute(target)));
    } else if (PACKAGE_STUBS[specifier]) {
      targets.set(specifier, PACKAGE_STUBS[specifier]);
    } else {
      throw new Error(`${file} imports ${specifier}, which this test does not provide`);
    }
  }
  return moduleUrl(outputText.replace(IMPORTS, (match, head: string, specifier: string) => {
    const target = targets.get(specifier);
    return target ? `${head}'${target}'` : match;
  }));
}

function bundleRoute(file: string): Promise<string> {
  let pending = routeBundles.get(file);
  if (!pending) {
    pending = compileRoute(file);
    routeBundles.set(file, pending);
  }
  return pending;
}

function rpcError(message: string, code = 'P0001'): RpcError {
  return { code, message, details: null, hint: null };
}

function failureBody(message: string, code: string, details?: unknown): Record<string, unknown> {
  return {
    success: false,
    error: message,
    code,
    message,
    request_id: REQUEST_ID,
    ...(details === undefined ? {} : { details }),
  };
}

function auditRow(fields: {
  action: string;
  entity: string;
  entity_id: string | null;
  before_value: unknown;
  after_value: unknown;
  result: string;
  error?: string;
  sensitivity: string;
}): Record<string, unknown> {
  return {
    admin_id: OWNER.admin_id,
    user_id: null,
    action: fields.action,
    entity: fields.entity,
    entity_id: fields.entity_id,
    before_value: fields.before_value,
    after_value: fields.after_value,
    ip_address: CLIENT_IP,
    admin_role: OWNER.role_title,
    user_agent: USER_AGENT,
    request_id: REQUEST_ID,
    reason: null,
    result: fields.result,
    error: fields.error ?? null,
    sensitivity: fields.sensitivity,
  };
}

let builderRoute: BuilderRoute;

function resetRoute(): void {
  route.claims = OWNER;
  route.reply = { data: null, error: null };
  route.calls = [];
  route.tables = [];
  route.audits = [];
  route.auditError = null;
  mock.method(console, 'error', () => {});
}

async function send(method: 'POST' | 'PATCH', body: unknown): Promise<Reply> {
  const request = new Request('http://admin.test/api/field-builder', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await (method === 'POST' ? builderRoute.POST(request) : builderRoute.PATCH(request));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function guardReply(method: 'POST' | 'PATCH', body: unknown): Promise<Reply> {
  route.claims = null;
  const reply = await send(method, body);
  route.claims = OWNER;
  return reply;
}

describe('field-builder route: reorders through the database functions', () => {
  before(async () => {
    builderRoute = (await import(await bundleRoute(resolve(APP_DIR, 'api', 'field-builder', 'route.ts')))) as BuilderRoute;
  });

  beforeEach(resetRoute);

  afterEach(() => {
    mock.restoreAll();
  });

  function reordered(changed: boolean, templateId?: string | null) {
    return {
      data: {
        applied: true,
        changed,
        ...(templateId === undefined ? {} : { template_id: templateId }),
        order: [T2, T1, T3],
        before: [T1, T2, T3],
        positions: changed ? [{ id: T2, from: 1, to: 0 }, { id: T1, from: 0, to: 1 }] : [],
      },
      error: null,
    };
  }

  test('card types are reordered by card with every parameter present', async () => {
    route.reply = reordered(false);
    await send('PATCH', { type: 'reorder_templates', card_id: CARD.toUpperCase(), ids: [T2.toUpperCase(), T1, T3] });
    assert.deepEqual(route.calls, [{
      name: 'admin_reorder_card_type_templates',
      params: { p_admin_id: OWNER.admin_id, p_card_id: CARD, p_ids: [T2, T1, T3] },
    }]);
  });

  test('a saved card type order is audited with the order before and after, against the card', async () => {
    route.reply = reordered(true);
    const reply = await send('PATCH', { type: 'reorder_templates', card_id: CARD, ids: [T2, T1, T3] });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { success: true, request_id: REQUEST_ID, changed: true, audit_recorded: true });
    assert.deepEqual(route.audits, [auditRow({
      action: 'REORDER_CARD_TYPE_TEMPLATES',
      entity: 'card_type_templates',
      entity_id: CARD,
      before_value: { order: [T1, T2, T3] },
      after_value: { order: [T2, T1, T3] },
      result: 'success',
      sensitivity: 'normal',
    })]);
    assert.deepEqual(route.tables, ['audit_log']);
  });

  test('an order that is already in place reports no change and writes no audit', async () => {
    route.reply = reordered(false);
    const templates = await send('PATCH', { type: 'reorder_templates', card_id: CARD, ids: [T2, T1, T3] });
    route.reply = reordered(false, T1);
    const fields = await send('PATCH', { type: 'reorder_fields', template_id: T1, ids: [F2, F1] });
    for (const reply of [templates, fields]) {
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body, { success: true, request_id: REQUEST_ID, changed: false });
    }
    assert.deepEqual(route.audits, []);
  });

  test('refusals are worded per list: a stale list conflicts and the rest are validation errors on ids', async () => {
    const refusals: Array<[ReorderRefusal, number, string]> = [
      ['mismatch', 409, 'STATE_CONFLICT'],
      ['empty', 400, 'VALIDATION_ERROR'],
      ['too_many', 400, 'VALIDATION_ERROR'],
      ['duplicate', 400, 'VALIDATION_ERROR'],
    ];
    for (const [reason, status, code] of refusals) {
      const details = reason === 'mismatch' ? undefined : { field: 'ids' };
      route.reply = { data: { applied: false, reason, missing: [], extra: [] }, error: null };
      const templates = await send('PATCH', { type: 'reorder_templates', card_id: CARD, ids: [T1, T2] });
      assert.equal(templates.status, status, reason);
      assert.deepEqual(templates.body, failureBody(rules.reorderRefusalText(reason, 'card types'), code, details), reason);
      route.reply = { data: { applied: false, reason, template_id: T1, missing: [], extra: [] }, error: null };
      const fields = await send('PATCH', { type: 'reorder_fields', template_id: T1, ids: [F1, F2] });
      assert.equal(fields.status, status, reason);
      assert.deepEqual(fields.body, failureBody(rules.reorderRefusalText(reason, 'fields'), code, details), reason);
    }
    assert.deepEqual(route.audits, []);
  });

  test('fields are reordered by the template sent, or by the owner the function derives when none is sent', async () => {
    route.reply = reordered(false, T1);
    await send('PATCH', { type: 'reorder_fields', template_id: T1.toUpperCase(), ids: [F2.toUpperCase(), F1] });
    await send('PATCH', { type: 'reorder_fields', ids: [F2, F1] });
    await send('PATCH', { type: 'reorder_fields', template_id: null, ids: [F2, F1] });
    assert.deepEqual(route.calls, [
      { name: 'admin_reorder_template_fields', params: { p_admin_id: OWNER.admin_id, p_template_id: T1, p_ids: [F2, F1] } },
      { name: 'admin_reorder_template_fields', params: { p_admin_id: OWNER.admin_id, p_template_id: null, p_ids: [F2, F1] } },
      { name: 'admin_reorder_template_fields', params: { p_admin_id: OWNER.admin_id, p_template_id: null, p_ids: [F2, F1] } },
    ]);
  });

  test('a saved field order is audited against the template the function resolved', async () => {
    route.reply = {
      data: { applied: true, changed: true, template_id: T3, order: [F2, F1], before: [F1, F2], positions: [] },
      error: null,
    };
    const reply = await send('PATCH', { type: 'reorder_fields', ids: [F2, F1] });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { success: true, request_id: REQUEST_ID, changed: true, audit_recorded: true });
    assert.deepEqual(route.audits, [auditRow({
      action: 'REORDER_TEMPLATE_FIELDS',
      entity: 'card_type_template_fields',
      entity_id: T3,
      before_value: { order: [F1, F2] },
      after_value: { order: [F2, F1] },
      result: 'success',
      sensitivity: 'normal',
    })]);
  });

  test('fields that do not share one card type are a conflict', async () => {
    route.reply = { data: { applied: false, reason: 'mismatch', template_id: null, missing: [F2], extra: [] }, error: null };
    const reply = await send('PATCH', { type: 'reorder_fields', ids: [F1, F2] });
    assert.equal(reply.status, 409);
    assert.deepEqual(reply.body, failureBody('The fields changed since you loaded them. Reload and try again.', 'STATE_CONFLICT'));
  });

  test('a saved order whose audit cannot be written still succeeds, with a warning', async () => {
    route.reply = reordered(true);
    route.auditError = AUDIT_DOWN;
    const reply = await send('PATCH', { type: 'reorder_templates', card_id: CARD, ids: [T2, T1, T3] });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, {
      success: true, request_id: REQUEST_ID, changed: true, audit_recorded: false, warning: AUDIT_WARNING,
    });
  });

  test('an admin deactivated after the guard gets the same answer as the guard gives a deactivated admin', async () => {
    const templateBody = { type: 'reorder_templates', card_id: CARD, ids: [T1, T2] };
    const fieldBody = { type: 'reorder_fields', template_id: T1, ids: [F1, F2] };
    const guarded = await guardReply('PATCH', templateBody);
    assert.deepEqual(guarded.body, failureBody(SIGNED_OUT, 'AUTH_REQUIRED'));
    route.reply = { data: null, error: rpcError('Not authorized') };
    assert.deepEqual(await send('PATCH', templateBody), guarded);
    assert.deepEqual(await send('PATCH', fieldBody), guarded);
    assert.equal(route.calls.length, 2);
    assert.deepEqual(route.audits, []);
  });

  test('any other database error saves nothing, says so, and is audited as a failure', async () => {
    route.reply = { data: null, error: rpcError('could not serialize access', '40001') };
    const templates = await send('PATCH', { type: 'reorder_templates', card_id: CARD, ids: [T2, T1] });
    const fields = await send('PATCH', { type: 'reorder_fields', ids: [F2, F1] });
    for (const reply of [templates, fields]) {
      assert.equal(reply.status, 500);
      assert.deepEqual(reply.body, failureBody(NOT_SAVED, 'INTERNAL_ERROR'));
    }
    assert.deepEqual(route.audits, [
      auditRow({
        action: 'REORDER_CARD_TYPE_TEMPLATES',
        entity: 'card_type_templates',
        entity_id: CARD,
        before_value: null,
        after_value: { order: [T2, T1] },
        result: 'failure',
        error: 'could not serialize access',
        sensitivity: 'normal',
      }),
      auditRow({
        action: 'REORDER_TEMPLATE_FIELDS',
        entity: 'card_type_template_fields',
        entity_id: null,
        before_value: null,
        after_value: { order: [F2, F1] },
        result: 'failure',
        error: 'could not serialize access',
        sensitivity: 'normal',
      }),
    ]);
  });

  test('a result the route does not recognise is reported as unconfirmed and audited as a failure', async () => {
    const shapes = [
      null,
      { applied: false, reason: 'later' },
      { applied: true, changed: true, order: [T1], before: 'T1' },
    ];
    for (const data of shapes) {
      route.reply = { data, error: null };
      const reply = await send('PATCH', { type: 'reorder_templates', card_id: CARD, ids: [T1] });
      assert.equal(reply.status, 500);
      assert.deepEqual(reply.body, failureBody(ORDER_UNCONFIRMED, 'INTERNAL_ERROR'));
    }
    assert.deepEqual(
      route.audits.map((row) => row.error),
      Array.from(shapes, () => 'admin_reorder_card_type_templates returned an unexpected result'),
    );
  });

  test('requests the route refuses up front never reach the database', async () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ type: 'reorder_templates', card_id: 'nope', ids: [T1] }, 'Choose the card whose card types you are reordering.', 'card_id'],
      [{ type: 'reorder_templates', card_id: CARD, ids: [T1, 'nope'] }, 'Send the card types as a list of ids in their new order.', 'ids'],
      [{ type: 'reorder_fields', ids: 'nope' }, 'Send the fields as a list of ids in their new order.', 'ids'],
      [{ type: 'reorder_fields', ids: [] }, 'Send the full list of fields in their new order.', 'ids'],
      [{ type: 'reorder_fields', template_id: 'nope', ids: [F1] }, 'template_id must be the id of a card type.', 'template_id'],
    ];
    for (const [body, message, field] of cases) {
      const reply = await send('PATCH', body);
      assert.equal(reply.status, 400, message);
      assert.deepEqual(reply.body, failureBody(message, 'VALIDATION_ERROR', { field }), message);
    }
    assert.deepEqual(route.calls, []);
  });
});

describe('field-builder route: adding a card type to a country through the database function', () => {
  before(async () => {
    builderRoute = (await import(await bundleRoute(resolve(APP_DIR, 'api', 'field-builder', 'route.ts')))) as BuilderRoute;
  });

  beforeEach(resetRoute);

  afterEach(() => {
    mock.restoreAll();
  });

  const MOBILE_BODY = { type: 'add_country', template_id: T1, country_code: 'GH' };

  function live(outcome: 'already_live' | 'reactivated' | 'created', patch: Record<string, unknown> = {}) {
    return {
      data: {
        applied: true,
        outcome,
        id: I1,
        reactivated: outcome === 'reactivated',
        already_live: outcome === 'already_live',
        fields_copied: outcome === 'created' ? 2 : null,
        previous_is_active: outcome === 'already_live' ? true : outcome === 'reactivated' ? false : null,
        template_id: T1,
        template_name: 'E-code',
        card_id: CARD,
        country_code: 'GH',
        country_name: 'Ghana',
        ...patch,
      },
      error: null,
    };
  }

  test('the function gets the admin, the card type and the cleaned country code, with every parameter present', async () => {
    route.reply = live('created');
    await send('POST', { type: 'add_country', template_id: ` ${T1.toUpperCase()} `, country_code: ' gh ' });
    assert.deepEqual(route.calls, [{
      name: 'admin_add_card_type_to_country',
      params: { p_admin_id: OWNER.admin_id, p_template_id: T1, p_country_code: 'GH' },
    }]);
  });

  test('a new country returns the install and the fields copied, and is audited as added', async () => {
    route.reply = live('created');
    const reply = await send('POST', MOBILE_BODY);
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, {
      success: true, request_id: REQUEST_ID, id: I1, reactivated: false, fields_copied: 2, audit_recorded: true,
    });
    assert.deepEqual(route.audits, [auditRow({
      action: 'ADD_CARD_TYPE_TO_COUNTRY',
      entity: 'card_types',
      entity_id: I1,
      before_value: null,
      after_value: {
        template_id: T1, template_name: 'E-code', card_id: CARD, country_code: 'GH', is_active: true, fields_copied: 2,
      },
      result: 'success',
      sensitivity: 'financial',
    })]);
    assert.deepEqual(route.tables, ['audit_log']);
  });

  test('a country that was switched off is switched back on and audited with its previous state', async () => {
    for (const previous of [false, null]) {
      route.audits = [];
      route.reply = live('reactivated', { previous_is_active: previous });
      const reply = await send('POST', MOBILE_BODY);
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body, { success: true, request_id: REQUEST_ID, id: I1, reactivated: true, audit_recorded: true });
      assert.deepEqual(route.audits, [auditRow({
        action: 'REACTIVATE_CARD_TYPE_COUNTRY',
        entity: 'card_types',
        entity_id: I1,
        before_value: { is_active: previous },
        after_value: { is_active: true, template_id: T1, template_name: 'E-code', card_id: CARD, country_code: 'GH' },
        result: 'success',
        sensitivity: 'financial',
      })]);
    }
  });

  test('a country where the card type is already live changes nothing and writes no audit', async () => {
    route.reply = live('already_live');
    const reply = await send('POST', MOBILE_BODY);
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { success: true, request_id: REQUEST_ID, id: I1, reactivated: false, already_live: true });
    assert.deepEqual(route.audits, []);
  });

  test('a saved country whose audit cannot be written still succeeds, with a warning', async () => {
    route.auditError = AUDIT_DOWN;
    route.reply = live('created');
    const created = await send('POST', MOBILE_BODY);
    route.reply = live('reactivated');
    const reactivated = await send('POST', MOBILE_BODY);
    for (const reply of [created, reactivated]) {
      assert.equal(reply.status, 200);
      assert.equal(reply.body.audit_recorded, false);
      assert.equal(reply.body.warning, AUDIT_WARNING);
    }
  });

  test('a card type that no longer exists is not found', async () => {
    route.reply = { data: { applied: false, outcome: 'template_not_found' }, error: null };
    const reply = await send('POST', MOBILE_BODY);
    assert.equal(reply.status, 404);
    assert.deepEqual(reply.body, failureBody('That card type no longer exists.', 'RESOURCE_NOT_FOUND'));
    assert.deepEqual(route.audits, []);
  });

  test('a country that is not active for the card is a conflict, named when the card has it', async () => {
    const refused = (countryName: string | null) => ({
      data: {
        applied: false, outcome: 'country_not_active', template_id: T1, template_name: 'E-code', card_id: CARD,
        country_code: 'GH', country_name: countryName,
      },
      error: null,
    });
    route.reply = refused('Ghana');
    const named = await send('POST', MOBILE_BODY);
    route.reply = refused(null);
    const unnamed = await send('POST', MOBILE_BODY);
    assert.equal(named.status, 409);
    assert.deepEqual(named.body, failureBody(
      'Ghana is not an active country for this card. Switch it on in Cards first.',
      'STATE_CONFLICT',
      { field: 'country_code' },
    ));
    assert.deepEqual(unnamed.body, failureBody(
      'GH is not an active country for this card. Switch it on in Cards first.',
      'STATE_CONFLICT',
      { field: 'country_code' },
    ));
    assert.deepEqual(route.audits, []);
  });

  test('a country code the function rejects asks for a country', async () => {
    route.reply = { data: null, error: rpcError('Invalid country code') };
    const reply = await send('POST', MOBILE_BODY);
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, failureBody('Choose a country.', 'VALIDATION_ERROR', { field: 'country_code' }));
    assert.deepEqual(route.audits, []);
  });

  test('an admin deactivated after the guard gets the same answer as the guard gives a deactivated admin', async () => {
    const guarded = await guardReply('POST', MOBILE_BODY);
    route.reply = { data: null, error: rpcError('Not authorized') };
    const reply = await send('POST', MOBILE_BODY);
    assert.deepEqual(reply, guarded);
    assert.deepEqual(reply.body, failureBody(SIGNED_OUT, 'AUTH_REQUIRED'));
    assert.equal(route.calls.length, 1);
    assert.deepEqual(route.audits, []);
  });

  test('any other database error adds nothing, says so, and is audited as a failure', async () => {
    route.reply = { data: null, error: rpcError('deadlock detected', '40P01') };
    const reply = await send('POST', MOBILE_BODY);
    assert.equal(reply.status, 500);
    assert.deepEqual(reply.body, failureBody('The card type could not be added to GH. Nothing changed.', 'INTERNAL_ERROR'));
    assert.deepEqual(route.audits, [auditRow({
      action: 'ADD_CARD_TYPE_TO_COUNTRY',
      entity: 'card_types',
      entity_id: null,
      before_value: null,
      after_value: { template_id: T1, country_code: 'GH' },
      result: 'failure',
      error: 'deadlock detected',
      sensitivity: 'financial',
    })]);
  });

  test('a result the route does not recognise is reported as unconfirmed and audited as a failure', async () => {
    const shapes = [null, { applied: true, outcome: 'created' }, { applied: true, outcome: 'moved', id: I1 }];
    for (const data of shapes) {
      route.reply = { data, error: null };
      const reply = await send('POST', MOBILE_BODY);
      assert.equal(reply.status, 500);
      assert.deepEqual(
        reply.body,
        failureBody('Adding the card type to GH could not be confirmed. Reload to check before trying again.', 'INTERNAL_ERROR'),
      );
    }
    assert.deepEqual(
      route.audits.map((row) => row.error),
      Array.from(shapes, () => 'admin_add_card_type_to_country returned an unexpected result'),
    );
  });

  test('requests the route refuses up front never reach the database', async () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ type: 'add_country', template_id: 'nope', country_code: 'GH' }, 'Choose the card type to add.', 'template_id'],
      [{ type: 'add_country', template_id: T1, country_code: 'G1' }, 'Choose a country.', 'country_code'],
      [{ type: 'add_country', template_id: T1 }, 'Choose a country.', 'country_code'],
    ];
    for (const [body, message, field] of cases) {
      const reply = await send('POST', body);
      assert.equal(reply.status, 400, message);
      assert.deepEqual(reply.body, failureBody(message, 'VALIDATION_ERROR', { field }), message);
    }
    assert.deepEqual(route.calls, []);
  });
});
