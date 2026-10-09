import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, type ElementType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type MenuModule = typeof import('../app/_ui/Menu.tsx');
type ComboboxModule = typeof import('../app/_ui/Combobox.tsx');
type FieldModule = typeof import('../app/_ui/Field.tsx');
type Attrs = Record<string, string>;

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

function render(component: ElementType, props: Record<string, unknown>, children?: ReactNode): string {
  return renderToStaticMarkup(createElement(component, props, children));
}

function attrsOf(source: string): Attrs {
  const attrs: Attrs = {};
  for (const [, name, value] of source.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[name.toLowerCase()] = value ?? '';
  return attrs;
}

function tagsOf(html: string, tag: string): Attrs[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))].map((match) => attrsOf(match[1]));
}

function classesOf(attrs: Attrs | undefined): string[] {
  return (attrs?.class ?? '').split(' ').filter(Boolean);
}

function textById(html: string, id: string | undefined): string | undefined {
  if (!id) return undefined;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`id="${escaped}"[^>]*>([^<]*)<`))?.[1];
}

const noop = () => {};

const stack = await import('../app/_ui/overlayStack.ts');

describe('roving index movement', () => {
  const { moveRovingIndex } = stack;

  test('next and previous wrap around the ends', () => {
    assert.equal(moveRovingIndex(0, 4, 'next'), 1);
    assert.equal(moveRovingIndex(3, 4, 'next'), 0);
    assert.equal(moveRovingIndex(0, 4, 'previous'), 3);
    assert.equal(moveRovingIndex(2, 4, 'previous'), 1);
  });

  test('first and last jump to the ends from anywhere', () => {
    assert.equal(moveRovingIndex(2, 5, 'first'), 0);
    assert.equal(moveRovingIndex(-1, 5, 'first'), 0);
    assert.equal(moveRovingIndex(2, 5, 'last'), 4);
    assert.equal(moveRovingIndex(-1, 5, 'last'), 4);
  });

  test('with nothing active, next enters at the top and previous at the bottom', () => {
    assert.equal(moveRovingIndex(-1, 3, 'next'), 0);
    assert.equal(moveRovingIndex(-1, 3, 'previous'), 2);
    assert.equal(moveRovingIndex(7, 3, 'next'), 0);
  });

  test('an empty list has no active index', () => {
    for (const move of ['next', 'previous', 'first', 'last'] as const) {
      assert.equal(moveRovingIndex(0, 0, move), -1);
    }
  });

  test('without wrapping, movement stops at the ends', () => {
    assert.equal(moveRovingIndex(3, 4, 'next', false), 3);
    assert.equal(moveRovingIndex(0, 4, 'previous', false), 0);
    assert.equal(moveRovingIndex(1, 4, 'next', false), 2);
  });

  test('a single item stays put', () => {
    assert.equal(moveRovingIndex(0, 1, 'next'), 0);
    assert.equal(moveRovingIndex(0, 1, 'previous'), 0);
  });
});

describe('menu rules', () => {
  let menu: MenuModule;

  before(async () => {
    menu = await loadUi<MenuModule>('Menu.tsx');
  });

  test('entries drop falsy slots and stray separators but keep order', () => {
    const copy = { label: 'Copy text', onSelect: noop };
    const share = { label: 'Share', onSelect: noop };
    const remove = { label: 'Delete', danger: true, onSelect: noop };
    const separator = { type: 'separator' as const };
    const entries = menu.normalizeMenuEntries([
      separator, false, copy, separator, null, separator, share, undefined, separator, remove, separator, separator,
    ]);
    assert.deepEqual(entries, [copy, separator, share, separator, remove]);
  });

  test('a list of only separators or gaps normalises to nothing', () => {
    assert.deepEqual(menu.normalizeMenuEntries([{ type: 'separator' }, false, { type: 'separator' }]), []);
    assert.deepEqual(menu.normalizeMenuEntries([]), []);
  });

  test('arrow, Home and End keys map to roving moves; other keys do not', () => {
    assert.equal(menu.menuMoveForKey('ArrowDown'), 'next');
    assert.equal(menu.menuMoveForKey('ArrowUp'), 'previous');
    assert.equal(menu.menuMoveForKey('Home'), 'first');
    assert.equal(menu.menuMoveForKey('End'), 'last');
    for (const key of ['Tab', 'Enter', ' ', 'a', 'ArrowLeft', 'PageDown']) assert.equal(menu.menuMoveForKey(key), null);
  });

  const LABELS = ['Copy text', 'Share with images', 'Share link', 'Delete', 'Download images'];

  test('typeahead on one character moves to the next item starting with it', () => {
    assert.equal(menu.matchMenuTypeahead(LABELS, 0, 's'), 1);
    assert.equal(menu.matchMenuTypeahead(LABELS, 1, 's'), 2);
    assert.equal(menu.matchMenuTypeahead(LABELS, 2, 's'), 1);
    assert.equal(menu.matchMenuTypeahead(LABELS, -1, 'd'), 3);
  });

  test('repeating one character cycles through its matches', () => {
    assert.equal(menu.matchMenuTypeahead(LABELS, 3, 'dd'), 4);
    assert.equal(menu.matchMenuTypeahead(LABELS, 4, 'ddd'), 3);
  });

  test('a longer prefix keeps the current item while it still matches', () => {
    assert.equal(menu.matchMenuTypeahead(LABELS, 1, 'sh'), 1);
    assert.equal(menu.matchMenuTypeahead(LABELS, 1, 'share l'), 2);
    assert.equal(menu.matchMenuTypeahead(LABELS, 3, 'do'), 4);
  });

  test('typeahead ignores case and accents and reports no match as -1', () => {
    assert.equal(menu.matchMenuTypeahead(LABELS, 3, 'C'), 0);
    assert.equal(menu.matchMenuTypeahead(['Édit', 'Export'], -1, 'ed'), 0);
    assert.equal(menu.matchMenuTypeahead(LABELS, 0, 'x'), -1);
    assert.equal(menu.matchMenuTypeahead(LABELS, 0, ''), -1);
    assert.equal(menu.matchMenuTypeahead([], -1, 'a'), -1);
  });

  test('when the only match is the current item, typeahead stays put', () => {
    assert.equal(menu.matchMenuTypeahead(LABELS, 0, 'c'), -1);
  });
});

describe('Menu', () => {
  let Menu: ElementType;

  before(async () => {
    Menu = (await loadUi<MenuModule>('Menu.tsx')).Menu;
  });

  const ITEMS = [
    { label: 'Copy text', onSelect: noop },
    { type: 'separator' },
    {
      label: 'Share with images',
      description: 'Uses the native share sheet',
      icon: createElement('svg', { 'data-icon': 'share' }),
      onSelect: noop,
    },
    false,
    { label: 'Delete submission', danger: true, onSelect: noop },
    { label: 'Archive', disabled: true, onSelect: noop },
    { type: 'separator' },
  ];

  function menu(props: Record<string, unknown> = {}): string {
    return render(Menu, {
      items: ITEMS,
      trigger: (triggerProps: Record<string, unknown>) =>
        createElement('button', { ...triggerProps, type: 'button' }, 'Actions'),
      ...props,
    });
  }

  test('closed: the trigger advertises a menu popup and nothing else renders', () => {
    const html = menu();
    const [trigger] = tagsOf(html, 'button');
    assert.equal(trigger['aria-haspopup'], 'menu');
    assert.equal(trigger['aria-expanded'], 'false');
    assert.equal('aria-controls' in trigger, false);
    assert.ok(trigger.id);
    assert.equal(html.includes('role="menu"'), false);
    assert.equal(tagsOf(html, 'button').length, 1);
  });

  test('open: the trigger controls a menu that it labels', () => {
    const html = menu({ open: true, onOpenChange: noop });
    const [trigger] = tagsOf(html, 'button');
    const panel = tagsOf(html, 'div').find((attrs) => attrs.role === 'menu');
    assert.ok(panel);
    assert.equal(trigger['aria-expanded'], 'true');
    assert.equal(trigger['aria-controls'], panel.id);
    assert.equal(panel['aria-labelledby'], trigger.id);
    assert.equal(panel.tabindex, '-1');
    assert.ok(classesOf(panel).includes('menu'));
    assert.equal(classesOf(panel).includes('padded'), false);
  });

  test('items are real buttons with the menuitem role, in order', () => {
    const html = menu({ open: true, onOpenChange: noop });
    const items = tagsOf(html, 'button').filter((attrs) => attrs.role === 'menuitem');
    assert.equal(items.length, 4);
    assert.ok(items.every((item) => item.type === 'button'));
    assert.deepEqual(
      items.map((item) => textById(html, item['aria-labelledby'])),
      ['Copy text', 'Share with images', 'Delete submission', 'Archive'],
    );
  });

  test('roving focus: exactly one item is in the tab order, the first by default', () => {
    const items = tagsOf(menu({ open: true, onOpenChange: noop }), 'button').filter((attrs) => attrs.role === 'menuitem');
    assert.deepEqual(items.map((item) => item.tabindex), ['0', '-1', '-1', '-1']);
  });

  test('separators are collapsed and never lead or trail', () => {
    const html = menu({ open: true, onOpenChange: noop });
    const separators = tagsOf(html, 'div').filter((attrs) => attrs.role === 'separator');
    assert.equal(separators.length, 1);
    assert.ok(html.indexOf('role="separator"') > html.indexOf('Copy text'));
    assert.ok(html.indexOf('role="separator"') < html.indexOf('Share with images'));
  });

  test('disabled items stay focusable for assistive tech but are marked aria-disabled', () => {
    const items = tagsOf(menu({ open: true, onOpenChange: noop }), 'button').filter((attrs) => attrs.role === 'menuitem');
    const archive = items[3];
    assert.equal(archive['aria-disabled'], 'true');
    assert.equal('disabled' in archive, false);
    assert.ok(items.slice(0, 3).every((item) => !('aria-disabled' in item)));
  });

  test('danger items carry the danger style hook', () => {
    const items = tagsOf(menu({ open: true, onOpenChange: noop }), 'button').filter((attrs) => attrs.role === 'menuitem');
    assert.deepEqual(items.map((item) => classesOf(item).includes('danger')), [false, false, true, false]);
  });

  test('a description is wired as the item description and the icon is rendered', () => {
    const html = menu({ open: true, onOpenChange: noop });
    const share = tagsOf(html, 'button').find((attrs) => textById(html, attrs['aria-labelledby']) === 'Share with images');
    assert.ok(share);
    assert.equal(textById(html, share['aria-describedby']), 'Uses the native share sheet');
    assert.ok(html.includes('data-icon="share"'));
  });

  test('one icon reserves a decorative icon column on every item so labels align', () => {
    const icons = tagsOf(menu({ open: true, onOpenChange: noop }), 'span').filter((attrs) => classesOf(attrs).includes('icon'));
    assert.equal(icons.length, 4);
    assert.ok(icons.every((icon) => icon['aria-hidden'] === 'true'));
    const plain = menu({ open: true, onOpenChange: noop, items: [{ label: 'Copy text', onSelect: noop }] });
    assert.equal(tagsOf(plain, 'span').some((attrs) => classesOf(attrs).includes('icon')), false);
  });

  test('an aria-label names the menu instead of the trigger', () => {
    const html = menu({ open: true, onOpenChange: noop, 'aria-label': 'Share submission' });
    const panel = tagsOf(html, 'div').find((attrs) => attrs.role === 'menu');
    assert.equal(panel?.['aria-label'], 'Share submission');
    assert.equal(panel && 'aria-labelledby' in panel, false);
  });

  test('an id is used for the menu element the trigger controls', () => {
    const html = menu({ open: true, onOpenChange: noop, id: 'share-menu' });
    assert.equal(tagsOf(html, 'button')[0]['aria-controls'], 'share-menu');
    assert.equal(tagsOf(html, 'div').find((attrs) => attrs.role === 'menu')?.id, 'share-menu');
  });

  test('a menu with no actionable items never opens', () => {
    const html = menu({ open: true, onOpenChange: noop, items: [false, { type: 'separator' }, null] });
    assert.equal(tagsOf(html, 'button')[0]['aria-expanded'], 'false');
    assert.equal(html.includes('role="menu"'), false);
  });
});

const COUNTRIES = [
  { value: 'NG', label: 'Nigeria', description: 'NGN ₦', keywords: ['NG', 'NGN'] },
  { value: 'NE', label: 'Niger', keywords: ['NE', 'XOF'] },
  { value: 'GH', label: 'Ghana', keywords: ['GH', 'GHS'] },
  { value: 'GB', label: 'United Kingdom', keywords: ['GB', 'GBP', 'UK'] },
  { value: 'US', label: 'United States', keywords: ['US', 'USD', 'USA'] },
  { value: 'AE', label: 'United Arab Emirates', keywords: ['AE', 'AED'] },
  { value: 'CI', label: "Côte d'Ivoire", keywords: ['CI', 'XOF'] },
  { value: 'TN', label: 'Tunisia', keywords: ['TN', 'TND'] },
  { value: 'SG', label: 'Singapore', keywords: ['SG', 'SGD'] },
];

describe('combobox filtering and ranking', () => {
  let combobox: ComboboxModule;

  before(async () => {
    combobox = await loadUi<ComboboxModule>('Combobox.tsx');
  });

  const values = (result: { options: ReadonlyArray<{ value: string }> }) => result.options.map((option) => option.value);

  test('search text ignores case, accents and extra whitespace', () => {
    assert.equal(combobox.normalizeSearchText('  Côte   D’Ivoire '), 'cote d’ivoire');
    assert.equal(combobox.normalizeSearchText('ÉLAN\tvital'), 'elan vital');
    assert.equal(combobox.normalizeSearchText('   '), '');
  });

  test('an empty or blank query lists every option in its original order', () => {
    for (const query of ['', '   ']) {
      const result = combobox.filterComboboxOptions(COUNTRIES, query);
      assert.deepEqual(values(result), COUNTRIES.map((country) => country.value));
      assert.equal(result.total, COUNTRIES.length);
    }
  });

  test('label prefix matches outrank substring matches, ties keep the original order', () => {
    assert.deepEqual(values(combobox.filterComboboxOptions(COUNTRIES, 'ni')), ['NG', 'NE', 'GB', 'US', 'AE', 'TN']);
  });

  test('an exact label beats a longer label that merely starts with it', () => {
    assert.deepEqual(values(combobox.filterComboboxOptions(COUNTRIES, 'niger')), ['NE', 'NG']);
  });

  test('an exact keyword such as an ISO code comes before substring hits', () => {
    assert.deepEqual(values(combobox.filterComboboxOptions(COUNTRIES, 'ng')), ['NG', 'GB', 'SG']);
    assert.deepEqual(values(combobox.filterComboboxOptions(COUNTRIES, 'USD')), ['US']);
  });

  test('words match by prefix anywhere in the label, across label and keywords', () => {
    assert.deepEqual(values(combobox.filterComboboxOptions(COUNTRIES, 'states')), ['US']);
    assert.deepEqual(values(combobox.filterComboboxOptions(COUNTRIES, 'kingdom united')), ['GB']);
    assert.deepEqual(values(combobox.filterComboboxOptions(COUNTRIES, 'united usd')), ['US']);
  });

  test('accented labels match unaccented queries', () => {
    assert.deepEqual(values(combobox.filterComboboxOptions(COUNTRIES, 'cote')), ['CI']);
    assert.deepEqual(values(combobox.filterComboboxOptions(COUNTRIES, "CÔTE D'IV")), ['CI']);
  });

  test('keywords match as substrings after every label match', () => {
    assert.deepEqual(values(combobox.filterComboboxOptions(COUNTRIES, 'bp')), ['GB']);
  });

  test('no match yields an empty list with a zero total', () => {
    const result = combobox.filterComboboxOptions(COUNTRIES, 'zzz');
    assert.deepEqual(result.options, []);
    assert.equal(result.total, 0);
  });

  test('maxResults caps what is shown but total still counts every match', () => {
    const capped = combobox.filterComboboxOptions(COUNTRIES, 'united', 2);
    assert.deepEqual(values(capped), ['GB', 'US']);
    assert.equal(capped.total, 3);
    const all = combobox.filterComboboxOptions(COUNTRIES, '', 4);
    assert.equal(all.options.length, 4);
    assert.equal(all.total, COUNTRIES.length);
  });

  test('maxResults is floored, never below one, and NaN means uncapped', () => {
    assert.equal(combobox.filterComboboxOptions(COUNTRIES, '', 2.9).options.length, 2);
    assert.equal(combobox.filterComboboxOptions(COUNTRIES, '', 0).options.length, 1);
    assert.equal(combobox.filterComboboxOptions(COUNTRIES, '', Number.NaN).options.length, COUNTRIES.length);
  });

  test('the same option objects come back, so callers keep their own fields', () => {
    const result = combobox.filterComboboxOptions(COUNTRIES, 'ghana');
    assert.equal(result.options[0], COUNTRIES[2]);
  });

  test('rank is 0 for an empty query and -1 for a non-match', () => {
    assert.equal(combobox.rankComboboxOption(COUNTRIES[0], ''), 0);
    assert.equal(combobox.rankComboboxOption(COUNTRIES[0], 'nigeria'), 0);
    assert.equal(combobox.rankComboboxOption(COUNTRIES[0], 'zzz'), -1);
    assert.ok(combobox.rankComboboxOption(COUNTRIES[0], 'nig') < combobox.rankComboboxOption(COUNTRIES[8], 'ng'));
  });

  test('an exact label match is found only when unambiguous', () => {
    assert.equal(combobox.findExactOption(COUNTRIES, '  NIGERIA ')?.value, 'NG');
    assert.equal(combobox.findExactOption(COUNTRIES, "cote d'ivoire")?.value, 'CI');
    assert.equal(combobox.findExactOption(COUNTRIES, 'nig'), null);
    assert.equal(combobox.findExactOption(COUNTRIES, ''), null);
    const twins = [{ value: 'a', label: 'Georgia' }, { value: 'b', label: 'Georgia' }];
    assert.equal(combobox.findExactOption(twins, 'georgia'), null);
  });
});

describe('combobox state rules', () => {
  let combobox: ComboboxModule;

  before(async () => {
    combobox = await loadUi<ComboboxModule>('Combobox.tsx');
  });

  test('status announces counts, the cap, and the empty text', () => {
    assert.equal(combobox.comboboxStatus(0, 0), 'No matches');
    assert.equal(combobox.comboboxStatus(0, 0, 'No country found'), 'No country found');
    assert.equal(combobox.comboboxStatus(1, 1), '1 option available.');
    assert.equal(combobox.comboboxStatus(7, 7), '7 options available.');
    assert.equal(combobox.comboboxStatus(50, 200), 'Showing 50 of 200 options. Keep typing to narrow 150 more.');
  });

  const base = { open: false, query: null, committedText: '', hasValue: false, armed: false };

  test('Escape first closes an open list, whatever else is pending', () => {
    assert.equal(combobox.comboboxEscapeAction({ ...base, open: true }), 'close');
    assert.equal(combobox.comboboxEscapeAction({ ...base, open: true, query: 'nig' }), 'close');
    assert.equal(combobox.comboboxEscapeAction({ ...base, open: true, hasValue: true, committedText: 'Nigeria' }), 'close');
  });

  test('with typed text and the list closed, the second Escape clears the text', () => {
    assert.equal(combobox.comboboxEscapeAction({ ...base, query: 'nig', armed: true }), 'revert');
    assert.equal(combobox.comboboxEscapeAction({ ...base, query: 'nig' }), 'revert');
    assert.equal(combobox.comboboxEscapeAction({ ...base }), null);
  });

  test('typing over a chosen value: the second Escape restores it rather than wiping it', () => {
    const typed = { ...base, query: 'gha', committedText: 'Nigeria', hasValue: true, armed: true };
    assert.equal(combobox.comboboxEscapeAction(typed), 'revert');
    assert.equal(combobox.comboboxEscapeAction({ ...typed, query: null, armed: false }), null);
  });

  test('a chosen value is cleared only by the Escape right after closing the list', () => {
    const chosen = { ...base, committedText: 'Nigeria', hasValue: true };
    assert.equal(combobox.comboboxEscapeAction({ ...chosen, armed: true }), 'clear');
    assert.equal(combobox.comboboxEscapeAction({ ...chosen, armed: false }), null);
    assert.equal(combobox.comboboxEscapeAction({ ...chosen, query: 'Nigeria', armed: true }), 'clear');
  });

  test('opening highlights the chosen option when it is listed', () => {
    const listed = COUNTRIES.slice(0, 4);
    for (const mode of ['first', 'last', 'selected'] as const) {
      assert.equal(combobox.comboboxOpeningIndex(listed, 'GH', mode), 2);
    }
  });

  test('otherwise ArrowDown opens on the first option, ArrowUp on the last, a click on none', () => {
    const listed = COUNTRIES.slice(0, 4);
    assert.equal(combobox.comboboxOpeningIndex(listed, null, 'first'), 0);
    assert.equal(combobox.comboboxOpeningIndex(listed, 'SG', 'last'), 3);
    assert.equal(combobox.comboboxOpeningIndex(listed, 'SG', 'selected'), -1);
    for (const mode of ['first', 'last', 'selected'] as const) {
      assert.equal(combobox.comboboxOpeningIndex([], null, mode), -1);
    }
  });
});

describe('Combobox', () => {
  let Combobox: ElementType;
  let FieldShell: ElementType;

  before(async () => {
    Combobox = (await loadUi<ComboboxModule>('Combobox.tsx')).Combobox as ElementType;
    FieldShell = (await loadUi<FieldModule>('Field.tsx')).FieldShell as ElementType;
  });

  function box(props: Record<string, unknown> = {}): string {
    return render(Combobox, { options: COUNTRIES, value: null, onChange: noop, 'aria-label': 'Country', ...props });
  }

  test('the input is a list-autocomplete combobox, collapsed until it has a listbox to show', () => {
    const [input] = tagsOf(box(), 'input');
    assert.equal(input.role, 'combobox');
    assert.equal(input.type, 'text');
    assert.equal(input['aria-autocomplete'], 'list');
    assert.equal(input['aria-expanded'], 'false');
    assert.equal('aria-controls' in input, false);
    assert.equal('aria-activedescendant' in input, false);
    assert.equal(input['aria-label'], 'Country');
  });

  test('browser autofill, autocorrect and spellcheck are off', () => {
    const [input] = tagsOf(box(), 'input');
    assert.equal(input.autocomplete, 'off');
    assert.equal(input.autocorrect, 'off');
    assert.equal(input.autocapitalize, 'none');
    assert.equal(input.spellcheck, 'false');
  });

  test('closed, no listbox or option is mounted', () => {
    const html = box({ value: 'NG' });
    assert.equal(html.includes('role="listbox"'), false);
    assert.equal(html.includes('role="option"'), false);
  });

  test('the input shows the chosen option label, or nothing', () => {
    assert.equal(tagsOf(box({ value: 'GB' }), 'input')[0].value, 'United Kingdom');
    assert.equal(tagsOf(box({ value: null }), 'input')[0].value, '');
    assert.equal(tagsOf(box({ value: 'ZZ' }), 'input')[0].value, '');
  });

  test('reuses the kit input styling and keeps a decorative chevron', () => {
    const html = box();
    assert.deepEqual(classesOf(tagsOf(html, 'input')[0]), ['control', 'input']);
    const chevron = tagsOf(html, 'span').find((attrs) => classesOf(attrs).includes('chevron'));
    assert.equal(chevron?.['aria-hidden'], 'true');
    assert.ok(html.includes('lucide-chevron-down'));
  });

  test('a polite status region is always mounted for result announcements', () => {
    const status = tagsOf(box(), 'span').filter((attrs) => attrs.role === 'status');
    assert.equal(status.length, 1);
    assert.ok(classesOf(status[0]).includes('srOnly'));
  });

  test('a name submits the value through a hidden input, not the visible label', () => {
    const html = box({ value: 'NG', name: 'country_code' });
    const inputs = tagsOf(html, 'input');
    const hidden = inputs.find((attrs) => attrs.type === 'hidden');
    assert.equal(hidden?.name, 'country_code');
    assert.equal(hidden?.value, 'NG');
    assert.equal('name' in inputs.find((attrs) => attrs.role === 'combobox')!, false);
    const empty = tagsOf(box({ value: null, name: 'country_code' }), 'input').find((attrs) => attrs.type === 'hidden');
    assert.equal(empty?.value, '');
    assert.equal(hidden && 'disabled' in hidden, false);
  });

  test('the hidden value follows the form attribute and is not submitted while disabled', () => {
    const inputs = tagsOf(box({ value: 'NG', name: 'country_code', form: 'add-country', disabled: true }), 'input');
    const hidden = inputs.find((attrs) => attrs.type === 'hidden');
    assert.equal(hidden?.form, 'add-country');
    assert.equal(hidden?.disabled, '');
    assert.equal(inputs.find((attrs) => attrs.role === 'combobox')?.form, 'add-country');
  });

  test('inside FieldShell it takes the field id, description and invalid state', () => {
    const html = render(
      FieldShell,
      { label: 'Country', htmlFor: 'country', help: 'Where the card was issued', required: true },
      createElement(Combobox, { options: COUNTRIES, value: null, onChange: noop }),
    );
    const [label] = tagsOf(html, 'label');
    const input = tagsOf(html, 'input').find((attrs) => attrs.role === 'combobox');
    assert.ok(input);
    assert.equal(label.for, 'country');
    assert.equal(input.id, 'country');
    assert.equal(textById(html, input['aria-describedby']), 'Where the card was issued');
    assert.equal(input['aria-required'], 'true');
    assert.equal('aria-invalid' in input, false);

    const failing = render(
      FieldShell,
      { label: 'Country', htmlFor: 'country', error: 'Choose a country' },
      createElement(Combobox, { options: COUNTRIES, value: null, onChange: noop }),
    );
    const invalid = tagsOf(failing, 'input').find((attrs) => attrs.role === 'combobox');
    assert.equal(invalid?.['aria-invalid'], 'true');
    assert.ok(classesOf(invalid).includes('invalid'));
    assert.equal(textById(failing, invalid?.['aria-describedby']), 'Choose a country');
  });

  test('caller id and aria-describedby pass through and merge with the field', () => {
    const html = render(
      FieldShell,
      { label: 'Country', htmlFor: 'country', help: 'Issuing country' },
      createElement(Combobox, {
        options: COUNTRIES, value: null, onChange: noop, id: 'issuer', 'aria-describedby': 'extra-hint',
      }),
    );
    const input = tagsOf(html, 'input').find((attrs) => attrs.role === 'combobox');
    assert.equal(input?.id, 'issuer');
    assert.deepEqual(input?.['aria-describedby'].split(' '), ['extra-hint', 'country-msg']);
  });

  test('invalid, disabled and placeholder reach the input', () => {
    const [invalid] = tagsOf(box({ invalid: true }), 'input');
    assert.equal(invalid['aria-invalid'], 'true');
    const html = box({ disabled: true, placeholder: 'Search country' });
    const [input] = tagsOf(html, 'input');
    assert.equal(input.disabled, '');
    assert.equal(input.placeholder, 'Search country');
    assert.ok(classesOf(tagsOf(html, 'div')[0]).includes('disabled'));
  });

  test('className and style size the wrapper, not the input', () => {
    const html = box({ className: 'wide', style: { maxWidth: 320 } });
    const [root] = tagsOf(html, 'div');
    assert.deepEqual(classesOf(root), ['root', 'wide']);
    assert.equal(root.style, 'max-width:320px');
    assert.equal('style' in tagsOf(html, 'input')[0], false);
  });
});

describe('menu and combobox source rules', () => {
  const files = [
    'Menu.tsx', 'Menu.module.css', 'Combobox.tsx', 'Combobox.module.css',
    'Popover.tsx', 'Popover.module.css', 'overlayStack.ts',
  ];
  const read = (name: string) => readFileSync(uiFile(name), 'utf8');
  const stylesheets = files.filter((file) => file.endsWith('.css'));
  const NAMED_COLOUR = /^(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|navy|teal|transparent)$/i;

  test('no prose comments anywhere', () => {
    for (const name of files) assert.doesNotMatch(read(name), /\/\*|(?<!:)\/\//, name);
  });

  test('stylesheets use colour tokens only', () => {
    for (const name of stylesheets) {
      const css = read(name);
      assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, name);
      assert.doesNotMatch(css, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i, name);
      for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
        for (const word of value.split(/[\s,()]+/)) assert.doesNotMatch(word, NAMED_COLOUR, `${name} ${property}`);
      }
    }
  });

  test('every z-index is a bare scale token, never arithmetic', () => {
    for (const name of stylesheets) {
      const css = read(name);
      assert.doesNotMatch(css, /calc\([^)]*--z-/, name);
      for (const [, value] of css.matchAll(/z-index\s*:\s*([^;]+);/g)) {
        assert.match(value.trim(), /^var\(--z-[a-z]+\)$/, name);
      }
    }
  });

  test('anything that moves has a reduced-motion rule', () => {
    for (const name of stylesheets) {
      const css = read(name);
      if (/\b(?:transition|animation)\s*:/.test(css)) {
        assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, name);
      }
    }
  });

  test('interactive components are client modules', () => {
    for (const name of ['Menu.tsx', 'Combobox.tsx', 'Popover.tsx']) {
      assert.ok(read(name).startsWith("'use client';"), name);
    }
  });

  test('menus and options style hover, focus and press in CSS, never inline', () => {
    const menuCss = read('Menu.module.css');
    assert.match(menuCss, /\.item:hover/);
    assert.match(menuCss, /\.item:focus-visible/);
    assert.match(menuCss, /\.item:active/);
    assert.match(menuCss, /\.danger\s*\{[^}]*var\(--tone-danger-fg\)/);
    for (const name of ['Menu.tsx', 'Combobox.tsx']) {
      assert.doesNotMatch(read(name), /\.style\.|style=\{\{/, name);
    }
  });
});
