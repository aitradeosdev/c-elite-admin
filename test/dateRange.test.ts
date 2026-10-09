import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, type ElementType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { businessDatePresets, type BusinessDatePresetKey } from '../app/lib/time.ts';
import type { DateRangeValue } from '../app/_ui/DateRangePicker.tsx';

type Attrs = Record<string, string>;
type PickerModule = typeof import('../app/_ui/DateRangePicker.tsx');

const nodeRequire = createRequire(import.meta.url);
const packageUrl = (specifier: string) => pathToFileURL(nodeRequire.resolve(specifier)).href;

const EXTERNAL: Record<string, string> = {
  react: packageUrl('react'),
  'react/jsx-runtime': packageUrl('react/jsx-runtime'),
  'lucide-react': packageUrl('lucide-react'),
};

const bundled = new Map<string, Promise<string>>();

function sourceFile(specifier: string, importer: URL): URL {
  const base = new URL(specifier, importer);
  const found = ['.tsx', '.ts'].map((ext) => new URL(`${base.href}${ext}`)).find((url) => existsSync(url));
  if (!found) throw new Error(`cannot resolve ${specifier} from ${importer.pathname}`);
  return found;
}

async function transpile(file: URL): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file.pathname,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const resolved = new Map<string, string>();
  for (const [, specifier] of outputText.matchAll(/from ['"]([^'"]+)['"]/g)) {
    if (specifier.endsWith('.module.css') || resolved.has(specifier)) continue;
    if (specifier.startsWith('.')) resolved.set(specifier, await bundle(sourceFile(specifier, file)));
    else if (EXTERNAL[specifier]) resolved.set(specifier, EXTERNAL[specifier]);
    else throw new Error(`${file.pathname} imports ${specifier}, which this loader does not resolve`);
  }
  const code = outputText
    .replace(
      /import (\w+) from ['"]\.\/[\w.]+\.module\.css['"];/,
      'const $1 = new Proxy({}, { get: (_target, key) => String(key) });',
    )
    .replace(/from ['"]([^'"]+)['"]/g, (match, specifier: string) => {
      const target = resolved.get(specifier);
      return target ? `from '${target}'` : match;
    });
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}

function bundle(file: URL): Promise<string> {
  let pending = bundled.get(file.href);
  if (!pending) {
    pending = transpile(file);
    bundled.set(file.href, pending);
  }
  return pending;
}

function uiFile(name: string): URL {
  return new URL(`../app/_ui/${name}`, import.meta.url);
}

async function loadUi<T>(name: string): Promise<T> {
  return (await import(await bundle(uiFile(name)))) as T;
}

function render(component: ElementType, props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(component, props));
}

function attrsOf(source: string): Attrs {
  const attrs: Attrs = {};
  for (const [, name, value] of source.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[name.toLowerCase()] = value ?? '';
  return attrs;
}

function tagsOf(html: string, tag: string): Attrs[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))].map((match) => attrsOf(match[1]));
}

function elementsOf(html: string, tag: string): { attrs: Attrs; text: string }[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'g'))].map((match) => ({
    attrs: attrsOf(match[1]),
    text: match[2].replace(/<[^>]+>/g, ''),
  }));
}

function classesOf(attrs: Attrs | undefined): string[] {
  return (attrs?.class ?? '').split(' ').filter(Boolean);
}

const noop = () => {};
const EMPTY: DateRangeValue = { from: null, to: null };

describe('date range rules', () => {
  let picker: PickerModule;

  before(async () => {
    picker = await loadUi<PickerModule>('DateRangePicker.tsx');
  });

  test('blank inputs resolve to an open range on that side', () => {
    assert.deepEqual(picker.resolveDateRange('', ''), { from: null, to: null });
    assert.deepEqual(picker.resolveDateRange('2026-09-01', ''), { from: '2026-09-01', to: null });
    assert.deepEqual(picker.resolveDateRange('', '2026-09-30'), { from: null, to: '2026-09-30' });
  });

  test('a single day and an ordered range are both valid', () => {
    assert.deepEqual(picker.resolveDateRange('2026-09-30', '2026-09-30'), { from: '2026-09-30', to: '2026-09-30' });
    assert.deepEqual(picker.resolveDateRange('2025-12-31', '2026-01-01'), { from: '2025-12-31', to: '2026-01-01' });
  });

  test('an inverted range never resolves, so it is never applied', () => {
    assert.equal(picker.resolveDateRange('2026-10-01', '2026-09-30'), null);
    assert.equal(picker.resolveDateRange('2026-01-01', '2025-12-31'), null);
  });

  test('a half-typed year or an impossible date never resolves', () => {
    assert.equal(picker.resolveDateRange('0020-09-01', ''), null);
    assert.equal(picker.resolveDateRange('2026-09-01', '0202-09-30'), null);
    assert.equal(picker.resolveDateRange('2026-02-30', ''), null);
  });

  test('inversion needs two real dates with from after to, across month and year boundaries', () => {
    assert.equal(picker.isDateRangeInverted({ from: '2026-10-01', to: '2026-09-30' }), true);
    assert.equal(picker.isDateRangeInverted({ from: '2026-01-01', to: '2025-12-31' }), true);
    assert.equal(picker.isDateRangeInverted({ from: '2026-09-30', to: '2026-09-30' }), false);
    assert.equal(picker.isDateRangeInverted({ from: '2026-09-30', to: null }), false);
    assert.equal(picker.isDateRangeInverted({ from: '2026-10-01', to: '0020-09-30' }), false);
    assert.equal(picker.isDateRangeInverted({}), false);
  });

  test('a range matches the preset with the same bounds', () => {
    const presets = businessDatePresets(new Date('2026-09-15T12:00:00Z'));
    assert.equal(picker.matchDatePreset({ from: null, to: null }, presets), 'all');
    assert.equal(picker.matchDatePreset({ from: '2026-09-09', to: '2026-09-15' }, presets), '7d');
    assert.equal(picker.matchDatePreset({ from: '2026-09-10', to: '2026-09-15' }, presets), null);
    assert.equal(picker.matchDatePreset(null, presets), null);
  });

  test('when two presets share bounds, only the first one listed matches', () => {
    const firstOfMonth = businessDatePresets(new Date('2026-10-01T08:00:00Z'));
    const range = { from: '2026-10-01', to: '2026-10-01' };
    assert.equal(picker.matchDatePreset(range, firstOfMonth), 'today');
    assert.equal(picker.matchDatePreset(range, firstOfMonth.filter((p) => p.key !== 'today')), 'month');
  });

  test('preset selection keeps the requested order and drops duplicates', () => {
    const reference = new Date('2026-09-30T12:00:00Z');
    const keys = (list: ReadonlyArray<BusinessDatePresetKey> | undefined) =>
      picker.pickDatePresets(list, reference).map((p) => p.key);
    assert.deepEqual(keys(undefined), ['today', '7d', '30d', 'month', 'all']);
    assert.deepEqual(keys(['30d', 'today', '30d']), ['30d', 'today']);
    assert.deepEqual(keys([]), []);
  });
});

describe('DateRangePicker', () => {
  let DateRangePicker: ElementType;

  before(async () => {
    DateRangePicker = (await loadUi<PickerModule>('DateRangePicker.tsx')).DateRangePicker;
  });

  test('two native date inputs, each named by a visible From or To label', () => {
    const html = render(DateRangePicker, { value: EMPTY, onChange: noop });
    const inputs = tagsOf(html, 'input');
    const labels = elementsOf(html, 'label');
    assert.deepEqual(inputs.map((input) => input.type), ['date', 'date']);
    assert.deepEqual(labels.map((label) => label.text), ['From', 'To']);
    assert.deepEqual(labels.map((label) => label.attrs.for), inputs.map((input) => input.id));
    assert.notEqual(inputs[0].id, inputs[1].id);
  });

  test('the pair is grouped under a legend that defaults to Date range', () => {
    const html = render(DateRangePicker, { value: EMPTY, onChange: noop });
    assert.ok(html.startsWith('<fieldset'));
    assert.deepEqual(elementsOf(html, 'legend').map((legend) => legend.text), ['Date range']);
    const custom = render(DateRangePicker, { value: EMPTY, onChange: noop, legend: 'Requested' });
    assert.deepEqual(elementsOf(custom, 'legend').map((legend) => legend.text), ['Requested']);
  });

  test('inputs carry the committed Lagos dates and are capped at a four digit year', () => {
    const html = render(DateRangePicker, { value: { from: '2026-09-01', to: '2026-09-30' }, onChange: noop });
    const inputs = tagsOf(html, 'input');
    assert.deepEqual(inputs.map((input) => input.value), ['2026-09-01', '2026-09-30']);
    assert.deepEqual(inputs.map((input) => input.max), ['9999-12-31', '9999-12-31']);
    assert.equal(inputs.some((input) => 'data-empty' in input), false);
    const empty = tagsOf(render(DateRangePicker, { value: EMPTY, onChange: noop }), 'input');
    assert.ok(empty.every((input) => 'data-empty' in input && input.value === ''));
  });

  test('presets are toggle buttons in a labelled group, and All time is pressed for an open range', () => {
    const html = render(DateRangePicker, { value: EMPTY, onChange: noop });
    const group = tagsOf(html, 'div').find((attrs) => attrs.role === 'group');
    assert.equal(group?.['aria-label'], 'Date presets');
    const chips = elementsOf(html, 'button');
    assert.deepEqual(chips.map((chip) => chip.text), ['Today', 'Last 7 days', 'Last 30 days', 'This month', 'All time']);
    assert.ok(chips.every((chip) => chip.attrs.type === 'button'));
    assert.deepEqual(chips.map((chip) => chip.attrs['aria-pressed']), ['false', 'false', 'false', 'false', 'true']);
  });

  test('a value equal to a preset presses that preset only', () => {
    const sevenDays = businessDatePresets().find((preset) => preset.key === '7d');
    assert.ok(sevenDays);
    const html = render(DateRangePicker, { value: { from: sevenDays.from, to: sevenDays.to }, onChange: noop });
    const pressed = elementsOf(html, 'button').filter((chip) => chip.attrs['aria-pressed'] === 'true');
    assert.deepEqual(pressed.map((chip) => chip.text), ['Last 7 days']);
  });

  test('a custom range presses no preset', () => {
    const html = render(DateRangePicker, { value: { from: '2020-01-05', to: '2020-02-10' }, onChange: noop });
    assert.ok(elementsOf(html, 'button').every((chip) => chip.attrs['aria-pressed'] === 'false'));
  });

  test('presets can be narrowed, reordered or removed', () => {
    const narrowed = render(DateRangePicker, { value: EMPTY, onChange: noop, presets: ['30d', 'today'] });
    assert.deepEqual(elementsOf(narrowed, 'button').map((chip) => chip.text), ['Last 30 days', 'Today']);
    const none = render(DateRangePicker, { value: EMPTY, onChange: noop, presets: [] });
    assert.equal(elementsOf(none, 'button').length, 0);
    assert.equal(tagsOf(none, 'div').some((attrs) => attrs.role === 'group'), false);
  });

  test('a valid range shows no error and marks nothing invalid', () => {
    const html = render(DateRangePicker, { value: { from: '2026-09-01', to: '2026-09-30' }, onChange: noop });
    assert.equal(html.includes('role="alert"'), false);
    assert.ok(tagsOf(html, 'input').every((input) => !('aria-invalid' in input) && !('aria-describedby' in input)));
  });

  test('an inverted range shows an inline alert that both inputs point to', () => {
    const html = render(DateRangePicker, { value: { from: '2026-10-01', to: '2026-09-30' }, onChange: noop });
    const [alert] = elementsOf(html, 'p');
    assert.equal(alert.attrs.role, 'alert');
    assert.equal(alert.text, 'From must be on or before To.');
    for (const input of tagsOf(html, 'input')) {
      assert.equal(input['aria-invalid'], 'true');
      assert.equal(input['aria-describedby'], alert.attrs.id);
    }
    const fields = tagsOf(html, 'div').filter((attrs) => classesOf(attrs).includes('field'));
    assert.equal(fields.length, 2);
    assert.ok(fields.every((attrs) => classesOf(attrs).includes('invalid')));
    assert.ok(elementsOf(html, 'button').every((chip) => chip.attrs['aria-pressed'] === 'false'));
  });

  test('an id names the group and seeds every inner id', () => {
    const html = render(DateRangePicker, { value: { from: '2026-10-01', to: '2026-09-30' }, onChange: noop, id: 'created' });
    assert.equal(tagsOf(html, 'fieldset')[0].id, 'created');
    assert.deepEqual(tagsOf(html, 'input').map((input) => input.id), ['created-from', 'created-to']);
    assert.equal(elementsOf(html, 'p')[0].attrs.id, 'created-error');
  });

  test('disabled disables the whole group through the fieldset', () => {
    const html = render(DateRangePicker, { value: EMPTY, onChange: noop, disabled: true });
    assert.ok('disabled' in tagsOf(html, 'fieldset')[0]);
  });
});

describe('SearchInput', () => {
  let SearchInput: ElementType;

  before(async () => {
    SearchInput = (await loadUi<{ SearchInput: ElementType }>('SearchInput.tsx')).SearchInput;
  });

  test('is a labelled search field with a decorative leading icon', () => {
    const html = render(SearchInput, { 'aria-label': 'Search users', value: '', onChange: noop });
    const [input] = tagsOf(html, 'input');
    assert.equal(input.type, 'search');
    assert.equal(input['aria-label'], 'Search users');
    assert.equal(input.autocomplete, 'off');
    assert.equal(input.spellcheck, 'false');
    assert.equal(input.enterkeyhint, 'search');
    const leading = tagsOf(html, 'span').find((attrs) => classesOf(attrs).includes('leading'));
    assert.equal(leading?.['aria-hidden'], 'true');
    assert.ok(html.includes('lucide-search'));
  });

  test('reuses the kit input styling', () => {
    const [input] = tagsOf(render(SearchInput, { 'aria-label': 'Search', value: '' }), 'input');
    assert.deepEqual(classesOf(input), ['control', 'input']);
  });

  test('offers a labelled clear button only when there is text to clear', () => {
    const empty = render(SearchInput, { 'aria-label': 'Search', value: '', onChange: noop });
    assert.equal(tagsOf(empty, 'button').length, 0);
    const filled = render(SearchInput, { 'aria-label': 'Search', value: 'ada', onChange: noop });
    const [button] = tagsOf(filled, 'button');
    assert.equal(button['aria-label'], 'Clear search');
    assert.equal(button.type, 'button');
    assert.equal(tagsOf(filled, 'input')[0].value, 'ada');
  });

  test('never offers to clear a disabled or read-only field', () => {
    for (const lock of [{ disabled: true }, { readOnly: true }]) {
      const html = render(SearchInput, { 'aria-label': 'Search', value: 'ada', onChange: noop, ...lock });
      assert.equal(tagsOf(html, 'button').length, 0);
    }
  });

  test('works uncontrolled from a default value', () => {
    const html = render(SearchInput, { 'aria-label': 'Search', defaultValue: 'tobi' });
    assert.equal(tagsOf(html, 'input')[0].value, 'tobi');
    assert.equal(tagsOf(html, 'button')[0]['aria-label'], 'Clear search');
  });

  test('loading swaps the icon for a spinner that stays hidden from assistive tech', () => {
    const html = render(SearchInput, { 'aria-label': 'Search', value: 'ada', loading: true });
    const leading = tagsOf(html, 'span').find((attrs) => classesOf(attrs).includes('leading'));
    assert.equal(leading?.['aria-hidden'], 'true');
    assert.ok(tagsOf(html, 'span').some((attrs) => classesOf(attrs).includes('spinner')));
    assert.equal(html.includes('lucide-search'), false);
  });

  test('className and style size the wrapper, not the input', () => {
    const html = render(SearchInput, { 'aria-label': 'Search', value: '', className: 'wide', style: { maxWidth: 360 } });
    const [root] = tagsOf(html, 'div');
    assert.deepEqual(classesOf(root), ['root', 'wide']);
    assert.equal(root.style, 'max-width:360px');
    assert.equal('style' in tagsOf(html, 'input')[0], false);
  });
});

describe('FilterBar', () => {
  let FilterBar: ElementType;

  before(async () => {
    FilterBar = (await loadUi<{ FilterBar: ElementType }>('FilterBar.tsx')).FilterBar;
  });

  const slots = {
    search: createElement('input', { 'aria-label': 'Search', id: 'slot-search' }),
    filters: createElement('select', { 'aria-label': 'Status', id: 'slot-filter' }),
    actions: createElement('button', { type: 'button', id: 'slot-action' }, 'Export'),
  };

  test('is a search landmark labelled Filters by default', () => {
    const [root] = tagsOf(render(FilterBar, slots), 'div');
    assert.equal(root.role, 'search');
    assert.equal(root['aria-label'], 'Filters');
    const labelled = tagsOf(render(FilterBar, { ...slots, 'aria-labelledby': 'heading' }), 'div')[0];
    assert.equal(labelled['aria-labelledby'], 'heading');
    assert.equal('aria-label' in labelled, false);
    const named = tagsOf(render(FilterBar, { ...slots, 'aria-label': 'Filter withdrawals' }), 'div')[0];
    assert.equal(named['aria-label'], 'Filter withdrawals');
  });

  test('lays out search, then filters, then actions', () => {
    const html = render(FilterBar, { ...slots, onClear: noop, active: true });
    const order = ['slot-search', 'slot-filter', 'Clear filters', 'slot-action'].map((marker) => html.indexOf(marker));
    assert.ok(order.every((index) => index >= 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    const wrappers = tagsOf(html, 'div').slice(1).map((attrs) => classesOf(attrs)[0]);
    assert.deepEqual(wrappers, ['search', 'filters', 'actions']);
  });

  test('omits the wrapper for any slot that is not provided', () => {
    const html = render(FilterBar, { filters: slots.filters });
    assert.deepEqual(tagsOf(html, 'div').slice(1).map((attrs) => classesOf(attrs)[0]), ['filters']);
  });

  test('offers Clear filters whenever a clear handler exists unless active is false', () => {
    const clearButtons = (props: Record<string, unknown>) =>
      elementsOf(render(FilterBar, { ...slots, ...props }), 'button').filter((button) => button.text.includes('Clear filters'));
    assert.equal(clearButtons({ onClear: noop, active: true }).length, 1);
    assert.equal(clearButtons({ onClear: noop, active: false }).length, 0);
    assert.equal(clearButtons({ onClear: noop }).length, 1);
    assert.equal(clearButtons({ active: true }).length, 0);
    assert.equal(clearButtons({ onClear: noop, active: true })[0].attrs.type, 'button');
  });
});

describe('filter toolbar source rules', () => {
  const files = [
    'FilterBar.tsx', 'FilterBar.module.css', 'SearchInput.tsx', 'SearchInput.module.css',
    'DateRangePicker.tsx', 'DateRangePicker.module.css', 'useDebouncedValue.ts',
  ];
  const read = (name: string) => readFileSync(uiFile(name), 'utf8');
  const NAMED_COLOUR = /^(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|navy|teal)$/i;

  test('no prose comments anywhere', () => {
    for (const name of files) assert.doesNotMatch(read(name), /\/\*|(?<!:)\/\//, name);
  });

  test('stylesheets use colour tokens only', () => {
    for (const name of files.filter((file) => file.endsWith('.css'))) {
      const css = read(name);
      assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, name);
      assert.doesNotMatch(css, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i, name);
      for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
        for (const word of value.split(/[\s,()]+/)) assert.doesNotMatch(word, NAMED_COLOUR, `${name} ${property}`);
      }
    }
  });

  test('every z-index is a scale token', () => {
    for (const name of files.filter((file) => file.endsWith('.css'))) {
      for (const [, value] of read(name).matchAll(/z-index\s*:\s*([^;]+);/g)) {
        assert.match(value.trim(), /^var\(--z-[a-z]+\)$/, name);
      }
    }
  });

  test('anything that moves has a reduced-motion rule', () => {
    for (const name of files.filter((file) => file.endsWith('.css'))) {
      const css = read(name);
      if (/\b(?:transition|animation)\s*:/.test(css)) {
        assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, name);
      }
    }
  });

  test('interactive modules are client components', () => {
    for (const name of files.filter((file) => /\.tsx?$/.test(file))) {
      assert.ok(read(name).startsWith("'use client';"), name);
    }
  });
});
