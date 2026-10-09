import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Fragment, createElement, isValidElement, type ElementType, type ReactElement, type ReactNode } from 'react';
import {
  classesOf, loadUi, render, tagsOf, textById, textOf, withClass, type Attrs,
} from './support/uiHarness.ts';
import type {
  TabItem, TabPanelProps, TabsActivation, TabsKey, TabsKeyAction, TabsProps,
} from '../app/_ui/Tabs.tsx';
import type { AccessDeniedProps, ErrorStateProps, RetryFocusPhase } from '../app/_ui/States.tsx';
import type { FieldSize, InputProps, SelectProps } from '../app/_ui/Field.tsx';

interface TabsModule {
  Tabs: ElementType;
  TabPanel: ElementType & { $$typeof: symbol };
  tabId: (base: string, value: string) => string;
  tabPanelId: (base: string, value: string) => string;
  tabIdPart: (value: string) => string;
  tabsMoveForKey: (key: string) => string | null;
  tabsKeyAction: (
    event: TabsKey, index: number, values: ReadonlyArray<string>, selected: string, activation: TabsActivation,
  ) => TabsKeyAction | null;
  tabStopIndex: (values: ReadonlyArray<string>, selected: string, focused: string | null) => number;
}

interface StatesModule {
  ErrorState: ElementType;
  AccessDenied: ElementType;
  retryFocusStep: (phase: RetryFocusPhase, retrying: boolean) => { phase: RetryFocusPhase; restore: boolean };
}

interface FieldModule {
  FieldShell: ElementType;
  Input: ElementType;
  Select: ElementType;
  Textarea: ElementType;
}

const uiText = (name: string) => readFileSync(new URL(`../app/_ui/${name}`, import.meta.url), 'utf8');

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing rule ${selector}`);
  return match[1];
}

function pxOf(body: string, property: string): number {
  const match = body.match(new RegExp(`(?:^|[\\s;])${property}:\\s*(\\d+)px`));
  assert.ok(match, `missing ${property} in ${body}`);
  return Number(match[1]);
}

const noop = () => {};

const ITEMS: ReadonlyArray<TabItem> = [
  { value: 'transactions', label: 'Transactions', count: 12 },
  { value: 'devices', label: 'Devices' },
  { value: 'logins', label: 'Logins', count: '1,204' },
];

const tabsOf = (html: string) => tagsOf(html, 'button').filter((attrs) => attrs.role === 'tab');
const panelsOf = (html: string) => tagsOf(html, 'div').filter((attrs) => attrs.role === 'tabpanel');

describe('tab and panel ids', () => {
  let mod: TabsModule;

  before(async () => {
    mod = await loadUi<TabsModule>('Tabs.tsx');
  });

  test('id-safe values pass through unchanged', () => {
    assert.equal(mod.tabId('user-activity', 'devices'), 'user-activity-tab-devices');
    assert.equal(mod.tabPanelId('user-activity', 'devices'), 'user-activity-panel-devices');
    assert.equal(mod.tabId('q', 'pending-review'), 'q-tab-pending-review');
    assert.equal(mod.tabId('q', 'Tab2'), 'q-tab-Tab2');
  });

  test('characters that are unsafe in ids are encoded, so ids carry no whitespace or selector syntax', () => {
    const values = ['in review', 'a/b', 'x.y', '50%', 'tab#1', 'naïve', 'gift 🎁', 'line\nbreak', 'quote"d', 'under_score', ''];
    for (const value of values) {
      for (const id of [mod.tabId('b', value), mod.tabPanelId('b', value)]) {
        assert.match(id, /^[A-Za-z0-9_-]+$/, JSON.stringify(value));
      }
    }
    assert.equal(mod.tabIdPart('in review'), 'in_20_review');
    assert.equal(mod.tabIdPart('gift 🎁'), 'gift_20__1f381_');
  });

  test('distinct values always get distinct ids, including values that look like encodings', () => {
    const values = ['a b', 'a_b', 'a-b', 'a_20_b', 'a.b', 'a  b', 'A b', 'ab', 'a_5f_b', '_', '__', ''];
    const ids = values.map((value) => mod.tabId('t', value));
    assert.equal(new Set(ids).size, values.length);
  });

  test('a tab id and its panel id never coincide, and both are stable for the same input', () => {
    for (const value of ITEMS.map((item) => item.value)) {
      assert.notEqual(mod.tabId('t', value), mod.tabPanelId('t', value));
      assert.equal(mod.tabId('t', value), mod.tabId('t', value));
    }
  });
});

describe('Tabs', () => {
  let Tabs: ElementType;
  let TabPanel: ElementType;
  let tabId: TabsModule['tabId'];
  let tabPanelId: TabsModule['tabPanelId'];

  before(async () => {
    ({ Tabs, TabPanel, tabId, tabPanelId } = await loadUi<TabsModule>('Tabs.tsx'));
  });

  const tabs = (props: Partial<TabsProps> = {}) =>
    render(createElement(Tabs, { value: 'devices', onChange: noop, items: ITEMS, ...props }));

  test('renders a tablist of real buttons with the tab role and the selection on aria-selected', () => {
    const html = tabs();
    const [list] = tagsOf(html, 'div');
    assert.equal(list.role, 'tablist');
    const buttons = tabsOf(html);
    assert.equal(buttons.length, 3);
    assert.ok(buttons.every((button) => button.type === 'button'));
    assert.deepEqual(buttons.map((button) => button['aria-selected']), ['false', 'true', 'false']);
  });

  test('every tab gets an id from the base, and aria-controls only once a base is shared with panels', () => {
    const wired = tabsOf(tabs({ id: 'user-activity' }));
    assert.deepEqual(wired.map((button) => button.id), ITEMS.map((item) => tabId('user-activity', item.value)));
    assert.deepEqual(
      wired.map((button) => button['aria-controls']),
      ITEMS.map((item) => tabPanelId('user-activity', item.value)),
    );

    const unwired = tabsOf(tabs());
    assert.ok(unwired.every((button) => button.id && button.id.includes('-tab-')));
    assert.ok(unwired.every((button) => !('aria-controls' in button)));
  });

  test('generated bases keep two tab lists on one page from sharing ids', () => {
    const html = render(createElement(
      Fragment,
      null,
      createElement(Tabs, { value: 'devices', onChange: noop, items: ITEMS }),
      createElement(Tabs, { value: 'devices', onChange: noop, items: ITEMS }),
    ));
    const ids = tabsOf(html).map((button) => button.id);
    assert.equal(ids.length, 6);
    assert.equal(new Set(ids).size, 6);
  });

  test('roving tabindex: only the selected tab is in the tab order', () => {
    assert.deepEqual(tabsOf(tabs()).map((button) => button.tabindex), ['-1', '0', '-1']);
    assert.deepEqual(tabsOf(tabs({ value: 'logins' })).map((button) => button.tabindex), ['-1', '-1', '0']);
  });

  test('when no item matches the value the first tab stays reachable', () => {
    assert.deepEqual(tabsOf(tabs({ value: 'missing' })).map((button) => button.tabindex), ['0', '-1', '-1']);
    assert.ok(tabsOf(tabs({ value: 'missing' })).every((button) => button['aria-selected'] === 'false'));
  });

  test('aria-label and aria-labelledby name the tablist; an explicit id lands on it too', () => {
    const [labelled] = tagsOf(tabs({ 'aria-label': 'Activity sections' }), 'div');
    assert.equal(labelled['aria-label'], 'Activity sections');
    const [referenced] = tagsOf(tabs({ 'aria-labelledby': 'activity-heading' }), 'div');
    assert.equal(referenced['aria-labelledby'], 'activity-heading');
    assert.equal(tagsOf(tabs({ id: 'user-activity' }), 'div')[0].id, 'user-activity');
    assert.equal('id' in tagsOf(tabs(), 'div')[0], false);
  });

  test('legacy props render as before: count badge, active class, variant and className', () => {
    const html = tabs({ className: 'pageGap' });
    assert.deepEqual(classesOf(tagsOf(html, 'div')[0]), ['tabs', 'pageGap']);
    assert.deepEqual(tabsOf(html).map(classesOf), [['tab'], ['tab', 'active'], ['tab']]);
    assert.deepEqual(withClass(html, 'span', 'count').length, 2);
    assert.match(html, /Transactions<span class="count">12<\/span><\/button>/);
    assert.match(html, /Logins<span class="count">1,204<\/span><\/button>/);
    assert.deepEqual(classesOf(tagsOf(tabs({ variant: 'underline' }), 'div')[0]), ['underline']);
  });

  test('activation mode changes behaviour only, never the markup', () => {
    assert.equal(tabs({ id: 'x', activation: 'manual' }), tabs({ id: 'x', activation: 'auto' }));
    assert.equal(tabs({ id: 'x' }), tabs({ id: 'x', activation: 'auto' }));
  });

  test('a shared base wires every tab to a rendered panel and every panel back to its tab', () => {
    const html = render(createElement(
      Fragment,
      null,
      createElement(Tabs, { id: 'acts', value: 'devices', onChange: noop, items: ITEMS, 'aria-label': 'Activity' }),
      ...ITEMS.map((item) => createElement(
        TabPanel,
        { key: item.value, tabsId: 'acts', value: item.value, active: item.value === 'devices' },
        `${item.label} body`,
      )),
    ));
    const tabIds = new Set(tabsOf(html).map((button) => button.id));
    const panels = panelsOf(html);
    const panelIds = new Set(panels.map((panel) => panel.id));
    for (const button of tabsOf(html)) assert.ok(panelIds.has(button['aria-controls']), button.id);
    for (const panel of panels) assert.ok(tabIds.has(panel['aria-labelledby']), panel.id);
    assert.equal(textOf(html), 'Transactions 12 Devices Logins 1,204 Devices body');
  });
});

describe('TabPanel', () => {
  let TabPanel: TabsModule['TabPanel'];
  let tabId: TabsModule['tabId'];
  let tabPanelId: TabsModule['tabPanelId'];

  before(async () => {
    ({ TabPanel, tabId, tabPanelId } = await loadUi<TabsModule>('Tabs.tsx'));
  });

  const panel = (props: Partial<TabPanelProps>, children: ReactNode = 'Body') =>
    render(createElement(TabPanel, { tabsId: 'acts', value: 'in review', active: true, ...props }, children));

  test('an active panel is a focusable tabpanel named by its tab', () => {
    const html = panel({});
    const [root] = tagsOf(html, 'div');
    assert.equal(root.role, 'tabpanel');
    assert.equal(root.id, tabPanelId('acts', 'in review'));
    assert.equal(root['aria-labelledby'], tabId('acts', 'in review'));
    assert.equal(root.tabindex, '0');
    assert.equal('hidden' in root, false);
    assert.equal(textOf(html), 'Body');
  });

  test('an inactive panel stays in the DOM for aria-controls but is hidden and empty', () => {
    const html = panel({ active: false });
    const [root] = tagsOf(html, 'div');
    assert.equal(root.hidden, '');
    assert.equal(root.id, tabPanelId('acts', 'in review'));
    assert.equal(textOf(html), '');
  });

  test('keepMounted keeps hidden children mounted', () => {
    const html = panel({ active: false, keepMounted: true }, createElement('form', { id: 'draft' }, 'Unsaved'));
    assert.equal(tagsOf(html, 'div')[0].hidden, '');
    assert.equal(tagsOf(html, 'form')[0].id, 'draft');
    assert.equal(textOf(html), 'Unsaved');
  });

  test('className merges after the panel class, other attributes pass through, refs forward', () => {
    const [root] = tagsOf(panel({ className: 'section', 'aria-busy': true, tabIndex: -1 }), 'div');
    assert.deepEqual(classesOf(root), ['panel', 'section']);
    assert.equal(root['aria-busy'], 'true');
    assert.equal(root.tabindex, '-1');
    assert.equal(TabPanel.$$typeof, Symbol.for('react.forward_ref'));
  });
});

describe('tabs keyboard model', () => {
  let mod: TabsModule;
  const VALUES = ['transactions', 'devices', 'logins'];

  before(async () => {
    mod = await loadUi<TabsModule>('Tabs.tsx');
  });

  test('arrows move along the row and Home and End jump to the ends', () => {
    assert.equal(mod.tabsMoveForKey('ArrowRight'), 'next');
    assert.equal(mod.tabsMoveForKey('ArrowLeft'), 'previous');
    assert.equal(mod.tabsMoveForKey('Home'), 'first');
    assert.equal(mod.tabsMoveForKey('End'), 'last');
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Tab', 'a']) assert.equal(mod.tabsMoveForKey(key), null, key);
  });

  test('focus wraps at both ends', () => {
    const at = (key: string, index: number) => mod.tabsKeyAction({ key }, index, VALUES, 'devices', 'manual')?.focus;
    assert.equal(at('ArrowRight', 0), 1);
    assert.equal(at('ArrowRight', 2), 0);
    assert.equal(at('ArrowLeft', 0), 2);
    assert.equal(at('Home', 2), 0);
    assert.equal(at('End', 0), 2);
  });

  test('automatic activation selects the tab focus lands on; manual only moves focus', () => {
    assert.deepEqual(mod.tabsKeyAction({ key: 'ArrowRight' }, 1, VALUES, 'devices', 'auto'), { focus: 2, select: true });
    assert.deepEqual(mod.tabsKeyAction({ key: 'ArrowRight' }, 1, VALUES, 'devices', 'manual'), { focus: 2, select: false });
  });

  test('landing on the tab that is already selected does not re-select it', () => {
    assert.deepEqual(mod.tabsKeyAction({ key: 'ArrowLeft' }, 2, VALUES, 'devices', 'auto'), { focus: 1, select: false });
    assert.deepEqual(mod.tabsKeyAction({ key: 'ArrowRight' }, 0, ['only'], 'only', 'auto'), { focus: 0, select: false });
  });

  test('modified keys and unrelated keys are left to the browser', () => {
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      const event: TabsKey = { key: 'ArrowLeft' };
      event[modifier] = true;
      assert.equal(mod.tabsKeyAction(event, 1, VALUES, 'devices', 'auto'), null, modifier);
    }
    assert.equal(mod.tabsKeyAction({ key: 'Enter' }, 1, VALUES, 'devices', 'auto'), null);
    assert.equal(mod.tabsKeyAction({ key: 'ArrowRight' }, 0, [], 'devices', 'auto'), null);
  });

  test('the tab stop follows focus inside the list and falls back to the selection, then the first tab', () => {
    assert.equal(mod.tabStopIndex(VALUES, 'devices', null), 1);
    assert.equal(mod.tabStopIndex(VALUES, 'devices', 'logins'), 2);
    assert.equal(mod.tabStopIndex(VALUES, 'devices', 'removed'), 1);
    assert.equal(mod.tabStopIndex(VALUES, 'missing', null), 0);
    assert.equal(mod.tabStopIndex([], 'devices', null), -1);
  });
});

describe('ErrorState', () => {
  let ErrorState: ElementType;

  before(async () => {
    ({ ErrorState } = await loadUi<StatesModule>('States.tsx'));
  });

  const error = (props: Partial<ErrorStateProps> = {}) => render(createElement(ErrorState, props));
  const retryButton = (html: string): Attrs | undefined => tagsOf(html, 'button')[0];
  const spinning = (html: string) => tagsOf(html, 'svg').some((svg) => classesOf(svg).includes('spin'));

  test('without retrying it renders exactly as before', () => {
    const html = error({ compact: true, onRetry: noop });
    assert.match(html, /^<div class="wrap compact" role="alert"><div class="icon iconDanger">/);
    assert.doesNotMatch(html, /aria-busy/);
    const button = retryButton(html);
    assert.ok(button);
    assert.equal('disabled' in button, false);
    assert.equal(button.type, 'button');
    assert.match(html, />Try again<\/button>/);
    assert.equal(spinning(html), false);
  });

  test('retrying marks the region busy, dims it and disables the retry button with a spinning icon', () => {
    const html = error({ compact: true, onRetry: noop, retrying: true });
    const [root] = tagsOf(html, 'div');
    assert.deepEqual(classesOf(root), ['wrap', 'compact', 'retrying']);
    assert.equal(root.role, 'alert');
    assert.equal(root['aria-busy'], 'true');
    const button = retryButton(html);
    assert.ok(button);
    assert.equal(button.disabled, '');
    assert.equal(button['aria-busy'], 'true');
    assert.equal(spinning(html), true);
    assert.match(html, />Try again<\/button>/);
  });

  test('retrying swaps no nodes inside the alert, so it is not announced again', () => {
    const idle = error({ onRetry: noop, backHref: '/dashboard', requestId: 'req_9' });
    const busy = error({ onRetry: noop, backHref: '/dashboard', requestId: 'req_9', retrying: true });
    const shape = (html: string) => [...html.matchAll(/<(\/?)([a-z0-9]+)/g)].map((match) => `${match[1]}${match[2]}`).join(' ');
    assert.equal(shape(busy), shape(idle));
    assert.equal(textOf(busy), textOf(idle));
  });

  test('retryLabel and backLabel replace the defaults, and blank labels fall back', () => {
    const custom = error({ onRetry: noop, retryLabel: 'Reload queue', backHref: '/users', backLabel: 'Back to users' });
    assert.match(custom, />Reload queue<\/button>/);
    assert.match(custom, /<a class="linkBtnSubtle" href="\/users">Back to users<\/a>/);
    const blank = error({ onRetry: noop, retryLabel: '  ', backHref: '/dashboard', backLabel: '' });
    assert.match(blank, />Try again<\/button>/);
    assert.match(blank, />Go to dashboard<\/a>/);
  });

  test('retrying without a retry handler still marks the region busy', () => {
    const html = error({ retrying: true });
    assert.equal(tagsOf(html, 'div')[0]['aria-busy'], 'true');
    assert.equal(tagsOf(html, 'button').length, 0);
  });

  test('compact keeps an h2, the full page an h1, and className merges last', () => {
    assert.equal(tagsOf(error({ compact: true }), 'h2').length, 1);
    assert.equal(tagsOf(error({ compact: true }), 'h1').length, 0);
    assert.equal(tagsOf(error(), 'h1').length, 1);
    assert.deepEqual(classesOf(tagsOf(error({ className: 'cell' }), 'div')[0]), ['wrap', 'cell']);
  });

  test('decorative icons stay out of the accessibility tree', () => {
    const html = error({ onRetry: noop, retrying: true });
    assert.ok(tagsOf(html, 'svg').every((svg) => svg['aria-hidden'] === 'true'));
    assert.equal(tagsOf(html, 'svg').find((svg) => classesOf(svg).includes('lucide-rotate-cw'))?.width, '14');
  });
});

describe('retry focus restoration', () => {
  let retryFocusStep: StatesModule['retryFocusStep'];

  before(async () => {
    ({ retryFocusStep } = await loadUi<StatesModule>('States.tsx'));
  });

  test('a retry started from the focused button gives focus back once it ends', () => {
    const started = retryFocusStep('armed', true);
    assert.deepEqual(started, { phase: 'waiting', restore: false });
    assert.deepEqual(retryFocusStep(started.phase, true), { phase: 'waiting', restore: false });
    assert.deepEqual(retryFocusStep(started.phase, false), { phase: 'idle', restore: true });
  });

  test('a click whose retry never shows as retrying is forgotten, so focus is never moved later', () => {
    assert.deepEqual(retryFocusStep('armed', false), { phase: 'idle', restore: false });
  });

  test('retrying driven by anything other than the button never moves focus', () => {
    assert.deepEqual(retryFocusStep('idle', true), { phase: 'idle', restore: false });
    assert.deepEqual(retryFocusStep('idle', false), { phase: 'idle', restore: false });
  });
});

describe('AccessDenied', () => {
  let AccessDenied: ElementType;

  before(async () => {
    ({ AccessDenied } = await loadUi<StatesModule>('States.tsx'));
  });

  const denied = (props: Partial<AccessDeniedProps> = {}) => render(createElement(AccessDenied, props));

  test('defaults to a dashboard link labelled as before', () => {
    const html = denied();
    assert.match(html, /^<div class="wrap" role="alert">/);
    assert.match(html, /<a class="linkBtn" href="\/dashboard">Back to dashboard<\/a>/);
  });

  test('backLabel names the link for a different destination, and a blank label falls back', () => {
    assert.match(denied({ backHref: '/users', backLabel: 'Back to users' }), /<a class="linkBtn" href="\/users">Back to users<\/a>/);
    assert.match(denied({ backLabel: ' ' }), />Back to dashboard<\/a>/);
  });

  test('required permissions and className render', () => {
    const html = denied({ required: ['users.read'], className: 'inCard' });
    assert.deepEqual(classesOf(tagsOf(html, 'div')[0]), ['wrap', 'inCard']);
    assert.match(html, /<code class="code">users\.read<\/code>/);
  });
});

describe('Field sizes', () => {
  let field: FieldModule;

  before(async () => {
    field = await loadUi<FieldModule>('Field.tsx');
  });

  const select = (props: Partial<SelectProps> = {}) =>
    tagsOf(render(createElement(field.Select, { 'aria-label': 'Type', ...props }, createElement('option', null, 'All'))), 'select')[0];
  const input = (props: Partial<InputProps> = {}) => tagsOf(render(createElement(field.Input, props)), 'input')[0];

  test('defaults are unchanged: medium height, full width, no extra classes', () => {
    assert.deepEqual(classesOf(select()), ['control', 'select']);
    assert.deepEqual(classesOf(input()), ['control']);
    assert.deepEqual(classesOf(select({ size: 'md' })), ['control', 'select']);
    assert.deepEqual(classesOf(input({ size: 'md' })), ['control']);
  });

  test('size sm adds the small class to Select and Input without forwarding a size attribute', () => {
    const small = select({ size: 'sm' });
    assert.deepEqual(classesOf(small), ['control', 'select', 'sm']);
    assert.equal('size' in small, false);
    const smallInput = input({ size: 'sm', mono: true });
    assert.deepEqual(classesOf(smallInput), ['control', 'sm', 'mono']);
    assert.equal('size' in smallInput, false);
  });

  test('inline releases the full width, and combines with size, invalid and className', () => {
    assert.deepEqual(classesOf(select({ inline: true })), ['control', 'select', 'inline']);
    assert.deepEqual(
      classesOf(select({ inline: true, size: 'sm', invalid: true, className: 'page' })),
      ['control', 'select', 'sm', 'inline', 'invalid', 'page'],
    );
  });

  test('a numeric size is still the native attribute, as InputHTMLAttributes allowed before', () => {
    const wide = input({ size: 20 });
    assert.equal(wide.size, '20');
    assert.deepEqual(classesOf(wide), ['control']);
    const listbox = select({ size: 4 });
    assert.equal(listbox.size, '4');
    assert.deepEqual(classesOf(listbox), ['control', 'select']);
  });

  test('FieldShell still labels and describes sized, inline controls', () => {
    const html = render(createElement(
      field.FieldShell,
      { label: 'Status', help: 'Filters the list.', required: true },
      createElement(field.Select, { size: 'sm', inline: true }, createElement('option', null, 'All')),
    ));
    const [label] = tagsOf(html, 'label');
    const [control] = tagsOf(html, 'select');
    assert.equal(control.id, label.for);
    assert.equal(textById(html, control['aria-describedby']), 'Filters the list.');
    assert.equal(control['aria-required'], 'true');
    assert.deepEqual(classesOf(control), ['control', 'select', 'sm', 'inline']);
  });

  test('Textarea is untouched by the size work', () => {
    const [area] = tagsOf(render(createElement(field.Textarea, { rows: 3 })), 'textarea');
    assert.deepEqual(classesOf(area), ['control', 'textarea']);
  });
});

describe('states, tabs and field styles', () => {
  const field = uiText('Field.module.css');
  const button = uiText('Button.module.css');
  const tabsCss = uiText('Tabs.module.css');
  const statesCss = uiText('States.module.css');

  for (const sheet of ['Tabs.module.css', 'States.module.css', 'Field.module.css']) {
    test(`${sheet} uses design tokens only`, () => {
      const text = uiText(sheet);
      assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/, 'literal hex colour');
      assert.doesNotMatch(text, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/, 'literal colour function');
      assert.doesNotMatch(
        text,
        /(?<![-\w])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|transparent)(?![-\w])/i,
        'named colour',
      );
      assert.doesNotMatch(text, /z-index/, 'z-index');
      assert.doesNotMatch(text, /\/\*/, 'prose comment');
    });
  }

  test('control heights match the Button sizes they sit beside', () => {
    assert.equal(pxOf(ruleBody(field, '.sm'), 'height'), pxOf(ruleBody(button, '.sm'), 'height'));
    assert.equal(pxOf(ruleBody(field, '.control'), 'height'), pxOf(ruleBody(button, '.md'), 'height'));
  });

  test('the small size keeps the horizontal padding that SearchInput and Combobox position icons against', () => {
    assert.doesNotMatch(ruleBody(field, '.sm'), /padding(?:-left|-right|-inline)?:/);
  });

  test('inline selects size to their content but never overflow the row', () => {
    const body = ruleBody(field, '.inline');
    assert.match(body, /width: auto;/);
    assert.match(body, /max-width: 100%;/);
    assert.ok(field.indexOf('\n.inline {') > field.indexOf('\n.control {'), 'inline must follow control to win the cascade');
    assert.ok(field.indexOf('\n.sm {') > field.indexOf('\n.control {'), 'sm must follow control to win the cascade');
  });

  test('tabs draw an inset focus ring that the scrolling tab row cannot clip', () => {
    const ring = ruleBody(tabsCss, '.tab:focus-visible');
    assert.match(ring, /outline: 2px solid var\(--accent-base\);/);
    assert.match(ring, /outline-offset: -2px;/);
  });

  test('the underline indicator is a full 2px accent bar inside the tab', () => {
    const bar = ruleBody(tabsCss, '.underline .tab.active::after');
    assert.match(bar, /height: 2px;/);
    assert.match(bar, /bottom: 0;/);
    assert.match(bar, /background: var\(--accent-base\);/);
    assert.doesNotMatch(ruleBody(tabsCss, '.underline .tab'), /margin/);
  });

  test('panels hide reliably and show a visible focus ring', () => {
    assert.match(ruleBody(tabsCss, '.panel[hidden]'), /display: none;/);
    assert.match(ruleBody(tabsCss, '.panel:focus-visible'), /outline: 2px solid var\(--accent-base\);/);
  });

  test('selected tabs stay distinguishable in forced colours', () => {
    assert.match(tabsCss, /@media \(forced-colors: active\) \{[\s\S]*\.tab\.active \{[^}]*text-decoration-line: underline;/);
  });

  test('motion is reduced on request', () => {
    assert.match(tabsCss, /@media \(prefers-reduced-motion: reduce\) \{\s*\.tab \{ transition: none; \}/);
    assert.match(statesCss, /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.wrap > \* \{ transition: none; \}/);
    assert.match(statesCss, /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.spin \{ animation-duration: 1\.6s; \}/);
  });

  test('retrying dims the message but leaves the actions at full strength', () => {
    assert.match(ruleBody(statesCss, '.retrying > :not(.actions)'), /opacity: 0\.6;/);
  });

  test('the kit files carry no prose comments', () => {
    for (const file of ['Tabs.tsx', 'States.tsx', 'Field.tsx']) {
      const source = uiText(file);
      assert.doesNotMatch(source, /^\s*\/\/(?!\/)/m, `${file} line comment`);
      assert.doesNotMatch(source, /\/\*/, `${file} block comment`);
    }
  });
});

describe('public prop types', () => {
  test('existing call shapes and the new ones both type-check', () => {
    const legacyTabs: TabsProps<'a' | 'b'> = {
      value: 'a', onChange: (next) => void next, items: [{ value: 'a', label: 'A', count: 2 }, { value: 'b', label: 'B' }],
      variant: 'underline', className: 'x',
    };
    const wiredTabs: TabsProps<'a'> = {
      value: 'a', onChange: noop, items: [], id: 'acts', activation: 'manual', 'aria-label': 'Sections', 'aria-labelledby': 'h',
    };
    const panel: TabPanelProps = { tabsId: 'acts', value: 'a', active: false, keepMounted: true, className: 'p', 'aria-busy': true };
    const failed: ErrorStateProps = {
      onRetry: noop, retrying: true, retryLabel: 'Retry', backHref: '/dashboard', backLabel: 'Home', compact: true, className: 'c',
    };
    const legacyFailed: ErrorStateProps = { title: 'T', message: 'M', requestId: null, detail: null, onRetry: noop };
    const denied: AccessDeniedProps = { backHref: '/users', backLabel: 'Back to users', required: ['users.read'] };
    const size: FieldSize = 'sm';
    const compactSelect: SelectProps = { size, inline: true };
    const listboxSelect: SelectProps = { size: 4 };
    const compactInput: InputProps = { size: 'md', mono: true };
    const nativeInput: InputProps = { size: 20 };
    assert.ok(
      legacyTabs && wiredTabs && panel && failed && legacyFailed && denied && compactSelect && listboxSelect
        && compactInput && nativeInput,
    );
  });
});

interface KeyProbe {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  prevented: boolean;
  preventDefault: () => void;
}

type Props = Record<string, unknown>;

function captureTree(component: ElementType, props: Props): ReactElement {
  let tree: ReactNode = null;
  function Probe() {
    tree = (component as (input: Props) => ReactNode)(props);
    return tree;
  }
  render(createElement(Probe));
  assert.ok(isValidElement(tree));
  return tree;
}

function elementsOf(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elementsOf(node.props.children as ReactNode)];
}

function keyEvent(key: string, modifiers: Partial<Pick<KeyProbe, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {}): KeyProbe {
  const event: KeyProbe = {
    key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers,
    prevented: false,
    preventDefault: () => {
      event.prevented = true;
    },
  };
  return event;
}

describe('Tabs handlers', () => {
  let Tabs: ElementType;

  before(async () => {
    ({ Tabs } = await loadUi<TabsModule>('Tabs.tsx'));
  });

  const wire = (props: Partial<TabsProps> = {}) => {
    const calls: unknown[][] = [];
    const tree = captureTree(Tabs, {
      value: 'devices', items: ITEMS, ...props, onChange: (...args: unknown[]) => calls.push(args),
    });
    const tabs = elementsOf(tree).filter((element) => element.props.role === 'tab');
    assert.equal(tabs.length, ITEMS.length);
    const press = (index: number, event: KeyProbe) => {
      (tabs[index].props.onKeyDown as (event: KeyProbe) => void)(event);
      return event;
    };
    const click = (index: number) => (tabs[index].props.onClick as () => void)();
    return { calls, press, click };
  };

  test('clicking a tab reports its value, including the tab that is already selected', () => {
    const { calls, click } = wire();
    click(2);
    click(1);
    assert.deepEqual(calls, [['logins'], ['devices']]);
  });

  test('automatic activation selects the tab an arrow, Home or End lands on and stops the browser default', () => {
    const { calls, press } = wire();
    assert.equal(press(1, keyEvent('ArrowRight')).prevented, true);
    assert.equal(press(1, keyEvent('ArrowLeft')).prevented, true);
    assert.equal(press(0, keyEvent('End')).prevented, true);
    assert.equal(press(2, keyEvent('Home')).prevented, true);
    assert.deepEqual(calls, [['logins'], ['transactions'], ['logins'], ['transactions']]);
  });

  test('manual activation moves focus only, leaving Enter and Space to the native button click', () => {
    const { calls, press } = wire({ activation: 'manual' });
    assert.equal(press(1, keyEvent('ArrowRight')).prevented, true);
    assert.equal(press(1, keyEvent('End')).prevented, true);
    assert.equal(press(1, keyEvent('Enter')).prevented, false);
    assert.equal(press(1, keyEvent(' ')).prevented, false);
    assert.deepEqual(calls, []);
  });

  test('modified arrows and unrelated keys reach the browser untouched', () => {
    const { calls, press } = wire();
    assert.equal(press(1, keyEvent('ArrowLeft', { altKey: true })).prevented, false);
    assert.equal(press(1, keyEvent('ArrowRight', { shiftKey: true })).prevented, false);
    assert.equal(press(1, keyEvent('ArrowDown')).prevented, false);
    assert.equal(press(1, keyEvent('Tab')).prevented, false);
    assert.deepEqual(calls, []);
  });

  test('arrowing onto the selected tab does not report a change', () => {
    const { calls, press } = wire();
    press(2, keyEvent('ArrowLeft'));
    press(0, keyEvent('ArrowRight'));
    assert.deepEqual(calls, []);
  });
});

describe('ErrorState retry handler', () => {
  let ErrorState: ElementType;

  before(async () => {
    ({ ErrorState } = await loadUi<StatesModule>('States.tsx'));
  });

  const retryElement = (props: Partial<ErrorStateProps>) =>
    elementsOf(captureTree(ErrorState, props as Props)).find((element) => typeof element.props.onClick === 'function');

  test('the retry button calls onRetry once, without forwarding the click event', () => {
    const calls: unknown[][] = [];
    const button = retryElement({ onRetry: (...args: unknown[]) => void calls.push(args) });
    assert.ok(button);
    assert.equal(button.props.disabled, false);
    (button.props.onClick as (event: unknown) => void)({ type: 'click' });
    assert.deepEqual(calls, [[]]);
  });

  test('while retrying the button is disabled so a second request cannot start', () => {
    const button = retryElement({ onRetry: noop, retrying: true });
    assert.ok(button);
    assert.equal(button.props.disabled, true);
    assert.equal(button.props['aria-busy'], true);
    assert.equal(button.props.type, 'button');
  });

  test('no retry handler means no retry control', () => {
    assert.equal(retryElement({ retrying: true }), undefined);
  });
});
