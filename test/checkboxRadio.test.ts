import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { Fragment, createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type Props = Record<string, unknown>;
type Attrs = Record<string, string>;

const nodeRequire = createRequire(import.meta.url);

async function loadComponent(file: string, exportName: string): Promise<ComponentType<Props>> {
  const source = readFileSync(new URL(`../app/_ui/${file}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const code = outputText
    .replace(
      /import (\w+) from ['"]\.\/\w+\.module\.css['"];/,
      'const $1 = new Proxy({}, { get: (_target, key) => String(key) });',
    )
    .replace(
      /from ['"](react(?:\/jsx-runtime)?)['"]/g,
      (_match, specifier: string) => `from '${pathToFileURL(nodeRequire.resolve(specifier)).href}'`,
    );
  const unresolved = code.match(/from ['"](\.\.?\/[^'"]+)['"]/);
  if (unresolved) throw new Error(`${file} imports ${unresolved[1]}, which this loader does not bundle`);
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return mod[exportName];
}

function render(component: ComponentType<Props>, props: Props): string {
  return renderToStaticMarkup(createElement(component, props));
}

function tagsOf(html: string, tag: string): Attrs[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))].map((match) => {
    const attrs: Attrs = {};
    for (const [, name, value] of match[1].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[name] = value ?? '';
    return attrs;
  });
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

describe('Checkbox', () => {
  let Checkbox: ComponentType<Props>;

  before(async () => {
    Checkbox = await loadComponent('Checkbox.tsx', 'Checkbox');
  });

  test('is a real checkbox inside its label, named by the label text alone', () => {
    const html = render(Checkbox, {
      checked: false, onChange: noop, label: 'Card queue', description: 'Review gift-card submissions',
    });
    const [input] = tagsOf(html, 'input');
    assert.ok(html.startsWith('<label'));
    assert.equal(input.type, 'checkbox');
    assert.equal(textById(html, input['aria-labelledby']), 'Card queue');
    assert.equal(textById(html, input['aria-describedby']), 'Review gift-card submissions');
    assert.equal('checked' in input, false);
  });

  test('keeps the styled box out of the accessibility tree', () => {
    const html = render(Checkbox, { checked: true, onChange: noop, label: 'Card queue' });
    const boxes = tagsOf(html, 'span').filter((span) => classesOf(span).includes('box'));
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0]['aria-hidden'], 'true');
  });

  test('reflects checked on the native input and fills the box', () => {
    const on = render(Checkbox, { checked: true, onChange: noop, label: 'Cards' });
    const off = render(Checkbox, { checked: false, onChange: noop, label: 'Cards' });
    assert.equal(tagsOf(on, 'input')[0].checked, '');
    assert.ok(classesOf(tagsOf(on, 'label')[0]).includes('filled'));
    assert.equal(classesOf(tagsOf(off, 'label')[0]).includes('filled'), false);
  });

  test('draws a dash instead of a check when indeterminate', () => {
    const check = render(Checkbox, { checked: true, onChange: noop, 'aria-label': 'Select all' });
    const dash = render(Checkbox, { checked: false, indeterminate: true, onChange: noop, 'aria-label': 'Select all' });
    const dashPath = tagsOf(dash, 'path')[0].d;
    assert.notEqual(dashPath, tagsOf(check, 'path')[0].d);
    assert.match(dashPath, /^M[\d.]+ [\d.]+h[\d.]+$/);
    assert.ok(classesOf(tagsOf(dash, 'label')[0]).includes('filled'));
  });

  test('puts a caller aria-describedby ahead of its own description', () => {
    const html = render(Checkbox, {
      checked: false, onChange: noop, label: 'Cards', description: 'Details', 'aria-describedby': 'external-hint',
    });
    const ids = tagsOf(html, 'input')[0]['aria-describedby'].split(' ');
    assert.equal(ids.length, 2);
    assert.equal(ids[0], 'external-hint');
    assert.equal(textById(html, ids[1]), 'Details');
  });

  test('exposes invalid and disabled states on the input itself', () => {
    const html = render(Checkbox, { checked: false, onChange: noop, label: 'Cards', invalid: true, disabled: true });
    const [input] = tagsOf(html, 'input');
    assert.equal(input['aria-invalid'], 'true');
    assert.equal(input.disabled, '');
    assert.ok(classesOf(tagsOf(html, 'label')[0]).includes('disabled'));
  });

  test('forwards native attributes to the input and layout hooks to the root', () => {
    const html = render(Checkbox, {
      checked: false,
      onChange: noop,
      label: 'Cards',
      id: 'perm-cards',
      name: 'pages',
      value: 'cards',
      required: true,
      className: 'custom',
      style: { marginTop: 4 },
    });
    const [input] = tagsOf(html, 'input');
    const [root] = tagsOf(html, 'label');
    assert.equal(input.id, 'perm-cards');
    assert.equal(input.name, 'pages');
    assert.equal(input.value, 'cards');
    assert.equal(input.required, '');
    assert.equal('style' in input, false);
    assert.ok(classesOf(root).includes('custom'));
    assert.equal(root.style, 'margin-top:4px');
  });

  test('without a visible label it relies on aria-label and renders no text block', () => {
    const html = render(Checkbox, { checked: false, onChange: noop, 'aria-label': 'Select row' });
    const [input] = tagsOf(html, 'input');
    assert.equal(input['aria-label'], 'Select row');
    assert.equal('aria-labelledby' in input, false);
    assert.equal('aria-describedby' in input, false);
    assert.equal(html.includes('class="text"'), false);
  });
});

describe('RadioGroup', () => {
  let RadioGroup: ComponentType<Props>;

  before(async () => {
    RadioGroup = await loadComponent('RadioGroup.tsx', 'RadioGroup');
  });

  const OPTIONS = [
    { value: 'duplicate', label: 'Duplicate' },
    { value: 'fraud', label: 'Suspected fraud', description: 'Escalates to the risk team' },
    { value: 'other', label: 'Other' },
  ];

  function group(props: Props = {}): string {
    return render(RadioGroup, { legend: 'Reason', options: OPTIONS, value: null, onChange: noop, ...props });
  }

  test('is a fieldset whose first child is the legend naming the group', () => {
    assert.match(group(), /^<fieldset\b[^>]*><legend\b[^>]*>Reason<\/legend>/);
  });

  test('renders real radios that share one generated name', () => {
    const radios = tagsOf(group(), 'input');
    assert.equal(radios.length, 3);
    assert.ok(radios.every((radio) => radio.type === 'radio'));
    assert.ok(radios[0].name);
    assert.ok(radios.every((radio) => radio.name === radios[0].name));
    assert.deepEqual(radios.map((radio) => radio.value), ['duplicate', 'fraud', 'other']);
  });

  test('gives separate groups separate names and honours an explicit name', () => {
    const html = renderToStaticMarkup(createElement(
      Fragment,
      null,
      createElement(RadioGroup, { legend: 'First', options: OPTIONS, value: null, onChange: noop }),
      createElement(RadioGroup, { legend: 'Second', options: OPTIONS, value: null, onChange: noop }),
    ));
    assert.equal(new Set(tagsOf(html, 'input').map((radio) => radio.name)).size, 2);
    assert.ok(tagsOf(group({ name: 'reject_reason' }), 'input').every((radio) => radio.name === 'reject_reason'));
  });

  test('checks exactly the option matching value, and none for null or an unmatched value', () => {
    const checkedValues = (html: string) =>
      tagsOf(html, 'input').filter((radio) => 'checked' in radio).map((radio) => radio.value);
    assert.deepEqual(checkedValues(group({ value: 'fraud' })), ['fraud']);
    assert.deepEqual(checkedValues(group({ value: null })), []);
    assert.deepEqual(checkedValues(group({ value: '' })), []);
  });

  test('names each radio by its label and describes it by its own description only', () => {
    const html = group();
    const [plain, described] = tagsOf(html, 'input');
    assert.equal(textById(html, plain['aria-labelledby']), 'Duplicate');
    assert.equal('aria-describedby' in plain, false);
    assert.equal(textById(html, described['aria-labelledby']), 'Suspected fraud');
    assert.equal(textById(html, described['aria-describedby']), 'Escalates to the risk team');
  });

  test('hideLegend keeps the legend text for assistive tech but hides it visually', () => {
    const html = group({ hideLegend: true });
    assert.ok(classesOf(tagsOf(html, 'legend')[0]).includes('srOnly'));
    assert.match(html, /<legend\b[^>]*>Reason</);
  });

  test('keeps every styled circle out of the accessibility tree', () => {
    const circles = tagsOf(group(), 'span').filter((span) => classesOf(span).includes('circle'));
    assert.equal(circles.length, 3);
    assert.ok(circles.every((circle) => circle['aria-hidden'] === 'true'));
  });

  test('disables single options natively and a whole group through the fieldset', () => {
    const partial = tagsOf(group({ options: [OPTIONS[0], { ...OPTIONS[1], disabled: true }] }), 'input');
    assert.deepEqual(partial.map((radio) => 'disabled' in radio), [false, true]);
    const all = group({ disabled: true });
    assert.equal(tagsOf(all, 'fieldset')[0].disabled, '');
    assert.ok(tagsOf(all, 'input').every((radio) => 'disabled' in radio));
  });

  test('required marks every radio required and hides the asterisk from assistive tech', () => {
    const html = group({ required: true });
    assert.ok(tagsOf(html, 'input').every((radio) => 'required' in radio));
    const asterisks = tagsOf(html, 'span').filter((span) => classesOf(span).includes('required'));
    assert.equal(asterisks.length, 1);
    assert.equal(asterisks[0]['aria-hidden'], 'true');
  });

  test('describes the fieldset with help, or with an alerting error that marks radios invalid', () => {
    const withHelp = group({ help: 'Recorded in the audit log.' });
    assert.equal(textById(withHelp, tagsOf(withHelp, 'fieldset')[0]['aria-describedby']), 'Recorded in the audit log.');
    assert.ok(tagsOf(withHelp, 'input').every((radio) => !('aria-invalid' in radio)));

    const withError = group({ help: 'Recorded in the audit log.', error: 'Choose a reason.' });
    assert.equal(textById(withError, tagsOf(withError, 'fieldset')[0]['aria-describedby']), 'Choose a reason.');
    assert.match(withError, /role="alert"[^>]*>Choose a reason\.</);
    assert.equal(withError.includes('Recorded in the audit log.'), false);
    assert.ok(tagsOf(withError, 'input').every((radio) => radio['aria-invalid'] === 'true'));
  });

  test('lays options out vertically by default and horizontally on request', () => {
    const layout = (html: string) => classesOf(tagsOf(html, 'div').find((div) => classesOf(div).includes('options')));
    assert.ok(layout(group()).includes('vertical'));
    assert.ok(layout(group({ orientation: 'horizontal' })).includes('horizontal'));
  });
});
