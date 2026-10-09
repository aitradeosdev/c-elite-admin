import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, type ElementType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type ValueModule = typeof import('../app/_ui/Value.tsx');
type Attrs = Record<string, string>;

const nodeRequire = createRequire(import.meta.url);
const packageUrl = (specifier: string) => pathToFileURL(nodeRequire.resolve(specifier)).href;

const EXTERNAL: Record<string, string> = {
  react: packageUrl('react'),
  'react/jsx-runtime': packageUrl('react/jsx-runtime'),
  'next/link': packageUrl('next/link'),
  'lucide-react': packageUrl('lucide-react'),
};

const bundled = new Map<string, Promise<string>>();

function uiFile(name: string): URL {
  return new URL(`../app/_ui/${name}`, import.meta.url);
}

function siblingFile(specifier: string): string {
  const name = specifier.slice(2);
  const file = [`${name}.tsx`, `${name}.ts`].find((candidate) => existsSync(uiFile(candidate)));
  if (!file) throw new Error(`cannot find ${specifier} in app/_ui`);
  return file;
}

async function transpile(file: string): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(uiFile(file), 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const resolved = new Map<string, string>();
  for (const [, specifier] of outputText.matchAll(/from ['"]([^'"]+)['"]/g)) {
    if (specifier.endsWith('.module.css') || resolved.has(specifier)) continue;
    if (specifier.startsWith('./')) resolved.set(specifier, await bundle(siblingFile(specifier)));
    else if (EXTERNAL[specifier]) resolved.set(specifier, EXTERNAL[specifier]);
    else throw new Error(`${file} imports ${specifier}, which this loader does not resolve`);
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

function bundle(file: string): Promise<string> {
  let pending = bundled.get(file);
  if (!pending) {
    pending = transpile(file);
    bundled.set(file, pending);
  }
  return pending;
}

const value = (await import(await bundle('Value.tsx'))) as ValueModule;
const { formatMoney, formatCompactNaira, formatPercent, truncateRef, copyToClipboard } = value;
const Money = value.Money as ElementType;
const Percent = value.Percent as ElementType;
const Ref = value.Ref as ElementType;

function render(component: ElementType, props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(component, props));
}

function tagsOf(html: string, tag: string): Attrs[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))].map((match) => {
    const attrs: Attrs = {};
    for (const [, name, val] of match[1].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[name] = val ?? '';
    return attrs;
  });
}

function classesOf(attrs: Attrs | undefined): string[] {
  return (attrs?.class ?? '').split(' ').filter(Boolean);
}

function visibleText(html: string): string {
  return html
    .replace(/<span class="srOnly">[^<]*<\/span>/g, '')
    .replace(/<[^>]+>/g, '');
}

function spokenText(html: string): string {
  return html
    .replace(/<span aria-hidden="true">[^<]*<\/span>/g, '')
    .replace(/<button\b[\s\S]*?<\/button>/g, '')
    .replace(/<[^>]+>/g, '');
}

const MINUS = '−';
const MISSING_INPUTS = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe('formatMoney', () => {
  test('formats present amounts exactly as formatNaira does', () => {
    assert.equal(formatMoney(1500), '₦1,500.00');
    assert.equal(formatMoney(1234567.5), '₦1,234,567.50');
    assert.equal(formatMoney('2500.5'), '₦2,500.50');
    assert.equal(formatMoney(' 75 '), '₦75.00');
    assert.equal(formatMoney(0), '₦0.00');
  });

  test('missing or unreadable data is an em dash, never ₦0.00', () => {
    for (const input of [...MISSING_INPUTS, '', '   ', 'abc', 'n/a', '1,500', '0x10', '₦500', '1e400']) {
      assert.equal(formatMoney(input as never), '—', `input ${String(input)}`);
    }
  });

  test('a negative amount puts a real minus sign before the naira sign', () => {
    assert.equal(formatMoney(-500), `${MINUS}₦500.00`);
    assert.equal(formatMoney('-1500.25'), `${MINUS}₦1,500.25`);
    assert.doesNotMatch(formatMoney(-500), /₦-/);
  });

  test('signed adds a plus to positives and leaves zero unsigned', () => {
    assert.equal(formatMoney(500, { signed: true }), '+₦500.00');
    assert.equal(formatMoney(-500, { signed: true }), `${MINUS}₦500.00`);
    assert.equal(formatMoney(0, { signed: true }), '₦0.00');
    assert.equal(formatMoney(-0, { signed: true }), '₦0.00');
    assert.equal(formatMoney('+42', { signed: true }), '+₦42.00');
  });

  test('an amount that rounds to zero never shows a sign', () => {
    assert.equal(formatMoney(-0.0001), '₦0.00');
    assert.equal(formatMoney(0.0001, { signed: true }), '₦0.00');
    assert.equal(formatMoney(-0.0049, { signed: true }), '₦0.00');
  });

  test('always shows exactly two decimals, rounding sub-kobo fractions', () => {
    assert.equal(formatMoney(18.51855), '₦18.52');
    assert.equal(formatMoney(0.125), '₦0.13');
    assert.equal(formatMoney('0.005'), '₦0.01');
    assert.equal(formatMoney(-1234.5678), `${MINUS}₦1,234.57`);
    assert.equal(formatMoney(999.995, { compact: true }), '₦1k');
    assert.equal(formatMoney(340.456, { compact: true }), '₦340.46');
  });

  test('very large amounts stay fully written out without exponent or infinity', () => {
    assert.equal(formatMoney(1e21), '₦1,000,000,000,000,000,000,000.00');
    const max = formatMoney(Number.MAX_VALUE);
    assert.match(max, /^₦179,769,313,486,231,570(,\d{3})+\.00$/);
    assert.equal(formatMoney(-Number.MAX_VALUE).startsWith(`${MINUS}₦179,769`), true);
  });

  test('compact delegates to formatCompactNaira', () => {
    assert.equal(formatMoney(1_234_567, { compact: true }), '₦1.2m');
    assert.equal(formatMoney(-340_000, { compact: true, signed: true }), `${MINUS}₦340k`);
  });
});

describe('formatCompactNaira', () => {
  test('abbreviates thousands, millions, billions and trillions', () => {
    assert.equal(formatCompactNaira(1_234_567), '₦1.2m');
    assert.equal(formatCompactNaira(340_000), '₦340k');
    assert.equal(formatCompactNaira(1_000), '₦1k');
    assert.equal(formatCompactNaira(1_234), '₦1.2k');
    assert.equal(formatCompactNaira(12_345_678), '₦12.3m');
    assert.equal(formatCompactNaira(345_678), '₦346k');
    assert.equal(formatCompactNaira(2_500_000_000), '₦2.5bn');
    assert.equal(formatCompactNaira(1_500_000_000_000), '₦1.5tn');
  });

  test('keeps one decimal below a hundred units and drops a trailing zero', () => {
    assert.equal(formatCompactNaira(2_000_000), '₦2m');
    assert.equal(formatCompactNaira(1_050_000), '₦1.1m');
    assert.equal(formatCompactNaira(99_960), '₦100k');
    assert.equal(formatCompactNaira(123_456_789), '₦123m');
  });

  test('rounding up to a thousand units rolls over to the next unit', () => {
    assert.equal(formatCompactNaira(999_499), '₦999k');
    assert.equal(formatCompactNaira(999_500), '₦1m');
    assert.equal(formatCompactNaira(999_950_000), '₦1bn');
    assert.equal(formatCompactNaira(999_500_000_000), '₦1tn');
  });

  test('amounts under a thousand are shown exactly', () => {
    assert.equal(formatCompactNaira(999.5), '₦999.50');
    assert.equal(formatCompactNaira(340.5), '₦340.50');
    assert.equal(formatCompactNaira(0), '₦0.00');
  });

  test('negatives always carry a minus and signed adds a plus', () => {
    assert.equal(formatCompactNaira(-1_234_567), `${MINUS}₦1.2m`);
    assert.equal(formatCompactNaira(340_000, { signed: true }), '+₦340k');
    assert.equal(formatCompactNaira(-2_500_000_000, { signed: true }), `${MINUS}₦2.5bn`);
    assert.equal(formatCompactNaira('-750', { signed: true }), `${MINUS}₦750.00`);
  });

  test('missing data is an em dash', () => {
    for (const input of [...MISSING_INPUTS, '', 'abc']) {
      assert.equal(formatCompactNaira(input as never), '—', `input ${String(input)}`);
    }
  });

  test('beyond a thousand trillion the trillions are grouped instead of switching to an exponent', () => {
    assert.equal(formatCompactNaira(1.5e15), '₦1,500tn');
    for (const huge of [1e300, Number.MAX_VALUE]) {
      const text = formatCompactNaira(huge);
      assert.match(text, /^₦\d{1,3}(,\d{3})+tn$/);
    }
  });
});

describe('formatPercent', () => {
  test('treats values as fractions by default', () => {
    assert.equal(formatPercent(0.125), '12.5%');
    assert.equal(formatPercent(0.5), '50.0%');
    assert.equal(formatPercent(1), '100.0%');
    assert.equal(formatPercent(0), '0.0%');
  });

  test('the percent scale takes values that are already percentages', () => {
    assert.equal(formatPercent(12.5, { scale: 'percent' }), '12.5%');
    assert.equal(formatPercent(0.125, { scale: 'percent' }), '0.1%');
    assert.equal(formatPercent(250, { scale: 'percent', decimals: 0 }), '250%');
  });

  test('decimals are fixed so a column of percentages lines up', () => {
    assert.equal(formatPercent(0.1, { decimals: 2 }), '10.00%');
    assert.equal(formatPercent(0.12345, { decimals: 2 }), '12.35%');
    assert.equal(formatPercent(0.125, { decimals: 0 }), '13%');
  });

  test('rounds the decimal value, not its binary approximation', () => {
    assert.equal(formatPercent(0.145, { decimals: 0 }), '15%');
    assert.equal(formatPercent(0.285, { decimals: 0 }), '29%');
  });

  test('negatives always carry a minus and signed adds a plus', () => {
    assert.equal(formatPercent(-0.031), `${MINUS}3.1%`);
    assert.equal(formatPercent(0.125, { signed: true }), '+12.5%');
    assert.equal(formatPercent(-4, { scale: 'percent', signed: true }), `${MINUS}4.0%`);
    assert.equal(formatPercent(0, { signed: true }), '0.0%');
  });

  test('a value that rounds to zero never shows a sign', () => {
    assert.equal(formatPercent(-0.0001), '0.0%');
    assert.equal(formatPercent(0.0001, { signed: true }), '0.0%');
    assert.equal(formatPercent(-0), '0.0%');
  });

  test('missing or unreadable data is an em dash', () => {
    for (const input of [...MISSING_INPUTS, '', '  ', 'abc', '12.5%', '0x10']) {
      assert.equal(formatPercent(input), '—', `input ${String(input)}`);
    }
  });

  test('reads decimal strings the same way Money does', () => {
    assert.equal(formatPercent('0.125'), '12.5%');
    assert.equal(formatPercent(' -0.031 ', { signed: true }), `${MINUS}3.1%`);
    assert.equal(formatPercent('12.5', { scale: 'percent' }), '12.5%');
  });

  test('very large values are written out with grouping, never infinity', () => {
    assert.equal(formatPercent(12_345.678), '1,234,567.8%');
    assert.equal(formatPercent(1e6, { scale: 'percent' }), '1,000,000.0%');
    const huge = formatPercent(Number.MAX_VALUE);
    assert.match(huge, /^17,976,931,348,623,157(,\d{3})+\.0%$/);
  });

  test('out-of-range decimals are clamped instead of throwing', () => {
    assert.equal(formatPercent(0.125, { decimals: -2 }), '13%');
    assert.equal(formatPercent(0.125, { decimals: 2.9 }), '12.50%');
    assert.equal(formatPercent(0.125, { decimals: Number.NaN }), '12.5%');
    assert.equal(formatPercent(0.5, { decimals: 500 }), `50.${'0'.repeat(20)}%`);
  });
});

describe('truncateRef', () => {
  test('keeps the first twelve characters by default and adds an ellipsis', () => {
    assert.equal(truncateRef('TXN_1234567890ABCDEF'), 'TXN_12345678…');
  });

  test('leaves values at or under the limit untouched', () => {
    assert.equal(truncateRef('TXN_1234'), 'TXN_1234');
    assert.equal(truncateRef('ABCDEFGHIJKL'), 'ABCDEFGHIJKL');
    assert.equal(truncateRef('ABCDEFGHIJKLM'), 'ABCDEFGHIJKL…');
  });

  test('honours a custom limit and floors fractional ones', () => {
    assert.equal(truncateRef('abcdef', 3), 'abc…');
    assert.equal(truncateRef('abcdef', 2.9), 'ab…');
    assert.equal(truncateRef('abcdef', 1), 'a…');
  });

  test('a limit below one or not finite turns truncation off', () => {
    for (const limit of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(truncateRef('abcdef', limit), 'abcdef', `limit ${limit}`);
    }
  });

  test('missing or blank values are an em dash', () => {
    for (const input of [null, undefined, '', '   ', Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(truncateRef(input as never), '—', `input ${String(input)}`);
    }
  });

  test('trims surrounding whitespace before measuring', () => {
    assert.equal(truncateRef('  ref_1  '), 'ref_1');
    assert.equal(truncateRef('   abcdef   ', 3), 'abc…');
  });

  test('counts characters, so an emoji is never split in half', () => {
    assert.equal(truncateRef('😀😀😀', 2), '😀😀…');
    assert.equal(truncateRef('😀😀', 2), '😀😀');
  });

  test('numeric ids are treated as text, including very large ones', () => {
    assert.equal(truncateRef(1234567890123456, 4), '1234…');
    assert.equal(truncateRef(42), '42');
    assert.equal(truncateRef(-7), '-7');
  });
});

describe('copyToClipboard', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  function installNavigator(nav: unknown) {
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  }

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  test('writes the exact text and resolves true when the Clipboard API accepts it', async () => {
    const written: string[] = [];
    installNavigator({ clipboard: { writeText: async (text: string) => { written.push(text); } } });
    assert.equal(await copyToClipboard('TXN_1234567890ABCDEF'), true);
    assert.deepEqual(written, ['TXN_1234567890ABCDEF']);
  });

  test('resolves false when the browser rejects the write', async () => {
    installNavigator({ clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) } });
    assert.equal(await copyToClipboard('ref'), false);
  });

  test('resolves false when writeText throws synchronously', async () => {
    installNavigator({ clipboard: { writeText: () => { throw new Error('blocked'); } } });
    assert.equal(await copyToClipboard('ref'), false);
  });

  test('resolves false when the Clipboard API is missing', async () => {
    for (const nav of [{}, { clipboard: undefined }, { clipboard: {} }, { clipboard: { writeText: 'nope' } }, undefined]) {
      installNavigator(nav);
      assert.equal(await copyToClipboard('ref'), false);
    }
  });

  test('resolves false when reading navigator.clipboard itself throws', async () => {
    installNavigator({ get clipboard() { throw new Error('SecurityError'); } });
    assert.equal(await copyToClipboard('ref'), false);
  });
});

describe('Money', () => {
  test('renders one mono span with the formatted amount', () => {
    assert.equal(render(Money, { value: 1500 }), '<span translate="no" class="value">₦1,500.00</span>');
  });

  test('missing data renders a muted em dash', () => {
    for (const input of [null, undefined, Number.NaN, '']) {
      assert.equal(render(Money, { value: input }), '<span translate="no" class="value missing">—</span>');
    }
  });

  test('signed amounts are coloured by tone and zero stays neutral', () => {
    const up = render(Money, { value: 500, signed: true });
    const down = render(Money, { value: -500, signed: true });
    const zero = render(Money, { value: 0, signed: true });
    assert.match(up, /class="value positive">\+₦500\.00</);
    assert.match(down, new RegExp(`class="value negative">${MINUS}₦500\\.00<`));
    assert.deepEqual(classesOf(tagsOf(zero, 'span')[0]), ['value']);
  });

  test('an unsigned negative shows its minus without a tone colour', () => {
    const html = render(Money, { value: -500 });
    assert.deepEqual(classesOf(tagsOf(html, 'span')[0]), ['value']);
    assert.equal(visibleText(html), `${MINUS}₦500.00`);
  });

  test('compact shows the short form while hover and screen readers get the exact amount', () => {
    const html = render(Money, { value: 1_234_567.89, compact: true });
    const [root, short] = tagsOf(html, 'span');
    assert.equal(root.title, '₦1,234,567.89');
    assert.equal(short['aria-hidden'], 'true');
    assert.equal(visibleText(html), '₦1.2m');
    assert.equal(spokenText(html), '₦1,234,567.89');
  });

  test('compact signed keeps the sign in both forms', () => {
    const html = render(Money, { value: -1_234_567.89, compact: true, signed: true });
    assert.equal(tagsOf(html, 'span')[0].title, `${MINUS}₦1,234,567.89`);
    assert.equal(visibleText(html), `${MINUS}₦1.2m`);
    assert.ok(classesOf(tagsOf(html, 'span')[0]).includes('negative'));
  });

  test('compact amounts that need no abbreviation render plainly', () => {
    const html = render(Money, { value: 340.5, compact: true });
    assert.equal(html, '<span translate="no" class="value">₦340.50</span>');
  });

  test('size, emphasis and className compose in order and attributes pass through', () => {
    const html = render(Money, {
      value: 10, size: '2xl', emphasis: 'strong', className: 'extra', id: 'amt', 'data-kind': 'payout',
    });
    const [root] = tagsOf(html, 'span');
    assert.deepEqual(classesOf(root), ['value', 'size2xl', 'strong', 'extra']);
    assert.equal(root.id, 'amt');
    assert.equal(root['data-kind'], 'payout');
  });

  test('a caller title replaces the automatic one', () => {
    const html = render(Money, { value: 1_234_567, compact: true, title: 'Settled volume' });
    assert.equal(tagsOf(html, 'span')[0].title, 'Settled volume');
  });
});

describe('Percent', () => {
  test('renders a mono span with the formatted percentage', () => {
    assert.equal(render(Percent, { value: 0.125 }), '<span translate="no" class="value">12.5%</span>');
    assert.equal(render(Percent, { value: 12.5, scale: 'percent', decimals: 2 }), '<span translate="no" class="value">12.50%</span>');
  });

  test('missing data renders a muted em dash', () => {
    for (const input of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(render(Percent, { value: input }), '<span translate="no" class="value missing">—</span>');
    }
  });

  test('signed shows the sign but leaves colour to the context', () => {
    const html = render(Percent, { value: -0.031, signed: true, emphasis: 'muted', size: 'xs' });
    const [root] = tagsOf(html, 'span');
    assert.deepEqual(classesOf(root), ['value', 'sizeXs', 'muted']);
    assert.equal(visibleText(html), `${MINUS}3.1%`);
    assert.match(render(Percent, { value: 0.2, signed: true }), />\+20\.0%</);
  });
});

describe('Ref', () => {
  const FULL = 'TXN_1234567890ABCDEF';

  test('shows the truncated reference, keeps the full value in title and for screen readers', () => {
    const html = render(Ref, { value: FULL });
    const text = tagsOf(html, 'span').find((span) => classesOf(span).includes('refText'));
    assert.equal(text?.title, FULL);
    assert.equal(visibleText(html), 'TXN_12345678…');
    assert.equal(spokenText(html), FULL);
  });

  test('the copy control is a labelled button with a decorative icon', () => {
    const html = render(Ref, { value: FULL });
    const [button] = tagsOf(html, 'button');
    assert.equal(button.type, 'button');
    assert.equal(button['aria-label'], `Copy reference ${FULL}`);
    assert.ok(classesOf(button).includes('copy'));
    assert.equal(classesOf(button).includes('copied'), false);
    const [icon] = tagsOf(html, 'svg');
    assert.equal(icon['aria-hidden'], 'true');
    assert.match(html, /<button\b[^>]*><svg\b[^>]*>[\s\S]*<\/svg><\/button>/);
  });

  test('label names what is being copied', () => {
    const [button] = tagsOf(render(Ref, { value: 'PSK_998877', label: 'gateway reference' }), 'button');
    assert.equal(button['aria-label'], 'Copy gateway reference PSK_998877');
    const [fallback] = tagsOf(render(Ref, { value: 'PSK_998877', label: '  ' }), 'button');
    assert.equal(fallback['aria-label'], 'Copy reference PSK_998877');
  });

  test('a short reference renders plainly without duplicate screen reader text', () => {
    const html = render(Ref, { value: 'wd_01' });
    assert.doesNotMatch(html, /srOnly|aria-hidden="true">wd_01/);
    assert.equal(visibleText(html), 'wd_01');
  });

  test('truncate controls the visible length and Infinity shows everything', () => {
    assert.equal(visibleText(render(Ref, { value: FULL, truncate: 6, copyable: false })), 'TXN_12…');
    assert.equal(visibleText(render(Ref, { value: FULL, truncate: Number.POSITIVE_INFINITY, copyable: false })), FULL);
  });

  test('copyable false renders the value without a button', () => {
    const html = render(Ref, { value: FULL, copyable: false });
    assert.equal(tagsOf(html, 'button').length, 0);
    assert.equal(spokenText(html), FULL);
  });

  test('missing references render a muted em dash with nothing to copy', () => {
    for (const input of [null, undefined, '', '   ']) {
      const html = render(Ref, { value: input });
      assert.equal(html, '<span translate="no" class="value missing">—</span>');
    }
  });

  test('surrounding whitespace is trimmed from what is shown, labelled and copied', () => {
    const html = render(Ref, { value: '  wd_01  ' });
    assert.equal(tagsOf(html, 'button')[0]['aria-label'], 'Copy reference wd_01');
    assert.equal(tagsOf(html, 'span').find((span) => classesOf(span).includes('refText'))?.title, 'wd_01');
  });

  test('numeric ids render as text', () => {
    const html = render(Ref, { value: 1024, label: 'user ID' });
    assert.equal(visibleText(html), '1024');
    assert.equal(tagsOf(html, 'button')[0]['aria-label'], 'Copy user ID 1024');
  });

  test('root carries the mono value classes plus size, emphasis and className', () => {
    const [root] = tagsOf(render(Ref, { value: FULL, size: 'xs', emphasis: 'muted', className: 'cell' }), 'span');
    assert.deepEqual(classesOf(root), ['value', 'sizeXs', 'muted', 'ref', 'cell']);
    assert.equal(root.translate, 'no');
  });
});

describe('Value source and styles', () => {
  const css = readFileSync(uiFile('Value.module.css'), 'utf8');
  const source = readFileSync(uiFile('Value.tsx'), 'utf8');

  test('the stylesheet uses design tokens only', () => {
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'literal hex colour');
    assert.doesNotMatch(css, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/, 'literal colour function');
    assert.doesNotMatch(
      css,
      /(?<![-\w])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|transparent)(?![-\w])/i,
      'named colour',
    );
    assert.doesNotMatch(css, /z-index/, 'z-index');
    assert.doesNotMatch(css, /\/\*/, 'prose comment');
  });

  test('values are always mono with tabular figures', () => {
    assert.match(css, /\.value \{[^}]*font-family: var\(--font-mono\);[^}]*font-variant-numeric: tabular-nums;/);
  });

  test('the copy button transition honours reduced motion and has a visible focus ring', () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.copy \{ transition: none; \}/);
    assert.match(css, /\.copy:focus-visible \{[^}]*outline: 2px solid var\(--accent-base\);/);
  });

  test('the component source is a client module without prose comments', () => {
    assert.ok(source.startsWith("'use client';"));
    assert.doesNotMatch(source, /^\s*\/\/(?!\s*(?:eslint|@ts-))/m);
    assert.doesNotMatch(source, /\/\*/);
  });
});
