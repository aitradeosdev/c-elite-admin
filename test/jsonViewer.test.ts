import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { classesOf, loadUiExport, render, tagsOf, textById, textOf, withClass } from './support/uiHarness.ts';
import type { JsonViewerProps } from '../app/_ui/JsonViewer.tsx';

const JsonViewer = await loadUiExport('JsonViewer.tsx', 'JsonViewer');

const view = (props: JsonViewerProps) => render(createElement(JsonViewer, props));
const uiText = (name: string) => readFileSync(new URL(`../app/_ui/${name}`, import.meta.url), 'utf8');

function spanTexts(html: string, className: string): string[] {
  const pattern = new RegExp(`<span class="${className}">([^<]*)</span>`, 'g');
  return [...html.matchAll(pattern)].map((match) => textOf(match[1]));
}

function toggles(html: string) {
  return withClass(html, 'button', 'toggle');
}

function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `missing ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

const METADATA = {
  bank_name: 'GTBank',
  fee: 50,
  retry: false,
  note: null,
  provider: { name: 'paystack', code: 'P1' },
  items: [1, 2, 3],
};

describe('JsonViewer tree', () => {
  test('expands the root and collapses nested values by default', () => {
    const html = view({ value: METADATA });
    const [root, provider, items] = toggles(html);
    assert.equal(toggles(html).length, 3);
    assert.equal(root['aria-expanded'], 'true');
    assert.equal(root['aria-label'], 'JSON, object, 6 keys');
    assert.equal(provider['aria-expanded'], 'false');
    assert.equal(provider['aria-label'], 'provider, object, 2 keys');
    assert.equal(items['aria-label'], 'items, array, 3 items');
    assert.equal(items.type, 'button');
    assert.deepEqual(spanTexts(html, 'count'), ['2 keys', '3 items']);
    assert.ok(!html.includes('paystack'), 'collapsed children are not rendered');
  });

  test('points an expanded toggle at the list it controls and drops the reference when collapsed', () => {
    const html = view({ value: METADATA });
    const [root, provider] = toggles(html);
    const list = tagsOf(html, 'ul')[0];
    assert.equal(root['aria-controls'], list.id);
    assert.equal(list.role, 'list');
    assert.equal(provider['aria-controls'], undefined);
  });

  test('distinguishes strings, numbers, booleans and null', () => {
    const html = view({ value: METADATA });
    assert.deepEqual(spanTexts(html, 'string'), ['"GTBank"']);
    assert.deepEqual(spanTexts(html, 'number'), ['50']);
    assert.deepEqual(spanTexts(html, 'boolean'), ['false']);
    assert.deepEqual(spanTexts(html, 'nullValue'), ['null']);
    assert.deepEqual(spanTexts(html, 'key').slice(0, 4), ['"bank_name"', '"fee"', '"retry"', '"note"']);
  });

  test('collapses the root to a single line at depth 0', () => {
    const html = view({ value: METADATA, defaultExpandDepth: 0 });
    const buttons = toggles(html);
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0]['aria-expanded'], 'false');
    assert.equal(tagsOf(html, 'ul').length, 0);
    assert.deepEqual(spanTexts(html, 'count'), ['6 keys']);
    assert.ok(!html.includes('GTBank'));
  });

  test('expands every level when asked', () => {
    const html = view({ value: METADATA, defaultExpandDepth: Infinity });
    assert.ok(toggles(html).every((toggle) => toggle['aria-expanded'] === 'true'));
    assert.ok(spanTexts(html, 'string').includes('"paystack"'));
    assert.deepEqual(spanTexts(html, 'number'), ['50', '1', '2', '3']);
  });

  test('treats a non-number depth as the default', () => {
    const html = view({ value: METADATA, defaultExpandDepth: NaN });
    assert.equal(toggles(html)[0]['aria-expanded'], 'true');
    assert.equal(toggles(html)[1]['aria-expanded'], 'false');
  });

  test('places commas between entries only', () => {
    const html = view({ value: { a: 1, b: 2, c: { d: 3 } } });
    assert.equal(spanTexts(html, 'punct').filter((text) => text === ',').length, 2);
    const nested = view({ value: { a: 1, b: { c: 2 } }, defaultExpandDepth: Infinity });
    assert.equal(spanTexts(nested, 'punct').filter((text) => text === ',').length, 1);
  });

  test('labels array items by position', () => {
    const html = view({ value: [{ id: 1 }, [2]] });
    const [, first, second] = toggles(html);
    assert.equal(first['aria-label'], 'Item 1, object, 1 key');
    assert.equal(second['aria-label'], 'Item 2, array, 1 item');
  });

  test('escapes keys and strings as JSON', () => {
    const html = view({ value: { 'say "hi"': 'line\nbreak' } });
    assert.deepEqual(spanTexts(html, 'key'), ['"say \\"hi\\""']);
    assert.deepEqual(spanTexts(html, 'string'), ['"line\\nbreak"']);
  });

  test('renders primitives and empty containers as one line without toggles', () => {
    for (const [value, className, text] of [
      ['hello', 'string', '"hello"'],
      [42, 'number', '42'],
      [true, 'boolean', 'true'],
      [null, 'nullValue', 'null'],
    ] as const) {
      const html = view({ value });
      assert.equal(toggles(html).length, 0);
      assert.deepEqual(spanTexts(html, className), [text]);
    }
    assert.deepEqual(spanTexts(view({ value: {} }), 'punct'), ['{}']);
    assert.deepEqual(spanTexts(view({ value: [] }), 'punct'), ['[]']);
  });
});

describe('JsonViewer masking', () => {
  test('masks the named keys at any depth and never renders their values', () => {
    const html = view({
      value: {
        account_number: '0123456789',
        profile: { pin: '4321', name: 'Ada' },
        payouts: [{ account_number: 2034567812 }],
      },
      maskKeys: ['account_number', 'pin'],
      defaultExpandDepth: Infinity,
    });
    for (const secret of ['0123456789', '4321', '2034567812']) assert.ok(!html.includes(secret), secret);
    assert.equal(withClass(html, 'span', 'masked').length, 3);
    assert.equal((html.match(/<span aria-hidden="true">••••<\/span><span class="srOnly">hidden<\/span>/g) ?? []).length, 3);
    assert.ok(spanTexts(html, 'string').includes('"Ada"'));
  });

  test('masks a whole object or array under a masked key', () => {
    const html = view({ value: { card: { code: 'ABCD-EFGH' } }, maskKeys: ['card'], defaultExpandDepth: Infinity });
    assert.ok(!html.includes('ABCD-EFGH'));
    assert.equal(toggles(html).length, 1);
    assert.equal(withClass(html, 'span', 'masked').length, 1);
  });

  test('shows empty values under masked keys as they are', () => {
    const html = view({ value: { pin: null, code: '' }, maskKeys: ['pin', 'code'] });
    assert.equal(withClass(html, 'span', 'masked').length, 0);
    assert.deepEqual(spanTexts(html, 'nullValue'), ['null']);
    assert.deepEqual(spanTexts(html, 'string'), ['""']);
  });
});

describe('JsonViewer large and unusual values', () => {
  test('shows the first 50 items of a long array and pages the rest', () => {
    const html = view({ value: Array.from({ length: 120 }, (_, index) => index) });
    assert.equal(spanTexts(html, 'number').length, 50);
    const more = withClass(html, 'button', 'more');
    assert.equal(more.length, 1);
    assert.equal(more[0].type, 'button');
    assert.match(html, />Show 50 more \(70 not shown\)<\/button>/);
  });

  test('offers only the remainder when fewer than a page are hidden', () => {
    assert.match(view({ value: Array.from({ length: 60 }, (_, index) => index) }), />Show 10 more<\/button>/);
    assert.equal(withClass(view({ value: Array.from({ length: 50 }, (_, index) => index) }), 'button', 'more').length, 0);
  });

  test('pages objects with many keys too', () => {
    const value = Object.fromEntries(Array.from({ length: 75 }, (_, index) => [`key_${index}`, index]));
    const html = view({ value });
    assert.equal(spanTexts(html, 'key').length, 50);
    assert.match(html, />Show 25 more<\/button>/);
    assert.equal(toggles(html)[0]['aria-label'], 'JSON, object, 75 keys');
  });

  test('keeps the comma after the last visible entry while more are hidden', () => {
    const html = view({ value: Array.from({ length: 51 }, () => 0) });
    assert.equal(spanTexts(html, 'punct').filter((text) => text === ',').length, 50);
  });

  test('renders circular references without throwing', () => {
    const value: Record<string, unknown> = { id: 1, children: [] };
    (value.children as unknown[]).push({ parent: value });
    value.self = value;
    const html = view({ value, defaultExpandDepth: Infinity });
    assert.deepEqual(spanTexts(html, 'special'), ['[Circular]', '[Circular]']);
  });

  test('renders bigint, functions, dates, undefined and symbols safely', () => {
    const html = view({
      value: {
        big: BigInt('12345678901234567890'),
        fn: function payout() {
          return 1;
        },
        at: new Date('2026-10-01T00:00:00.000Z'),
        nothing: undefined,
        sym: Symbol('s'),
      },
    });
    assert.deepEqual(spanTexts(html, 'number'), ['12345678901234567890']);
    assert.deepEqual(spanTexts(html, 'string'), ['"2026-10-01T00:00:00.000Z"']);
    assert.deepEqual(spanTexts(html, 'special'), ['[Function payout]', 'undefined', 'Symbol(s)']);
  });

  test('renders unreadable values instead of throwing', () => {
    const value = {
      ok: 1,
      get broken(): unknown {
        throw new Error('nope');
      },
    };
    assert.deepEqual(spanTexts(view({ value }), 'special'), ['[Unreadable]']);
  });
});

describe('JsonViewer chrome', () => {
  test('names the focusable scroll region from the visible title', () => {
    const html = view({ value: METADATA, label: 'Raw metadata' });
    const title = withClass(html, 'span', 'title')[0];
    const region = tagsOf(html, 'div').find((attrs) => attrs.role === 'region');
    assert.ok(region && title);
    assert.equal(textById(html, title.id), 'Raw metadata');
    assert.equal(region['aria-labelledby'], title.id);
    assert.equal(region['aria-label'], undefined);
    assert.equal(region.tabindex, '0');
    assert.equal(toggles(html)[0]['aria-label'], 'Raw metadata, object, 6 keys');
  });

  test('falls back to an aria-label and no header without a title or copy', () => {
    const html = view({ value: METADATA });
    const region = tagsOf(html, 'div').find((attrs) => attrs.role === 'region');
    assert.equal(region?.['aria-label'], 'JSON');
    assert.equal(withClass(html, 'div', 'header').length, 0);
  });

  test('offers Copy JSON only when copyable', () => {
    assert.ok(!view({ value: METADATA, label: 'Raw metadata' }).includes('Copy JSON'));
    const html = view({ value: METADATA, label: 'Raw metadata', copyable: true });
    const copy = withClass(html, 'button', 'copy');
    assert.equal(copy.length, 1);
    assert.equal(copy[0].type, 'button');
    assert.equal(copy[0]['aria-describedby'], withClass(html, 'span', 'title')[0].id);
    assert.match(html, /Copy JSON<\/button>/);
    const untitled = withClass(view({ value: METADATA, copyable: true }), 'button', 'copy');
    assert.equal(untitled[0]['aria-describedby'], undefined);
  });

  test('passes maxHeight through a custom property', () => {
    const region = (props: Partial<JsonViewerProps>) =>
      tagsOf(view({ value: METADATA, ...props }), 'div').find((attrs) => attrs.role === 'region');
    assert.equal(region({ maxHeight: 240 })?.style, '--json-viewer-max-height:240px');
    assert.equal(region({ maxHeight: '50vh' })?.style, '--json-viewer-max-height:50vh');
    assert.equal(region({ maxHeight: 'min(50vh, 400px)' })?.style, '--json-viewer-max-height:min(50vh, 400px)');
    for (const maxHeight of [0, -5, NaN, Infinity, '', '   ', '20rem;color:red', '1px}']) {
      assert.equal(region({ maxHeight })?.style, undefined, String(maxHeight));
    }
  });

  test('merges className and forwards attributes onto the root', () => {
    const html = view({ value: 1, className: 'extra', id: 'raw', 'data-section': 'metadata' } as JsonViewerProps);
    const root = tagsOf(html, 'div')[0];
    assert.deepEqual(classesOf(root), ['root', 'extra']);
    assert.equal(root.id, 'raw');
    assert.equal(root['data-section'], 'metadata');
  });

  test('gives every toggle a chevron hidden from screen readers', () => {
    const html = view({ value: METADATA });
    const chevrons = tagsOf(html, 'svg').filter((attrs) => classesOf(attrs).includes('chevron'));
    assert.equal(chevrons.length, 3);
    assert.ok(chevrons.every((attrs) => attrs['aria-hidden'] === 'true' && attrs.width === '14'));
  });
});

describe('JsonViewer hard rules', () => {
  const css = uiText('JsonViewer.module.css');
  const source = uiText('JsonViewer.tsx');

  test('is a client module without prose comments or static inline styles', () => {
    assert.ok(source.startsWith("'use client';"));
    assert.ok(!/\/\*|(^|[^:])\/\/(?!\/)/m.test(source));
    assert.ok(!/\/\*/.test(css));
    assert.ok(!/style=\{\{/.test(source));
  });

  test('styles with tokens only and no stacking order', () => {
    assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|z-index/i.test(css));
    assert.match(block(css, '.number'), /var\(--code-number\)/);
    assert.match(block(css, '.boolean'), /var\(--code-boolean\)/);
    assert.match(block(css, '.nullValue'), /var\(--code-null\)/);
    assert.match(block(css, '.toggle:focus-visible'), /outline: 2px solid var\(--accent-base\)/);
  });

  test('keeps absolutely positioned screen-reader text inside the scroll region', () => {
    assert.match(block(css, '.body {'), /position: relative;/);
    assert.match(block(css, '.srOnly {'), /position: absolute;/);
  });

  test('turns motion off for reduced-motion users', () => {
    const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
    assert.ok(start >= 0);
    assert.match(css.slice(start), /\.chevron[\s\S]*transition: none/);
  });

  test('defines the code tokens in the light and dark themes', () => {
    const tokens = uiText('tokens.css');
    const light = tokens.slice(tokens.indexOf("[data-theme='light'] {"), tokens.indexOf("[data-theme='dark'] {"));
    const darkStart = tokens.indexOf("[data-theme='dark'] {");
    const dark = tokens.slice(darkStart, tokens.indexOf('}', darkStart));
    for (const token of ['--code-number', '--code-boolean', '--code-null']) {
      assert.match(light, new RegExp(`${token}:\\s*#[0-9A-F]{6};`), `${token} light`);
      assert.match(dark, new RegExp(`${token}:\\s*#[0-9A-F]{6};`), `${token} dark`);
    }
  });
});
