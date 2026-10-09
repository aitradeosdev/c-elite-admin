import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, createRef, type ElementType, type ReactNode } from 'react';
import {
  classesOf, loadUi, loadUiExport, render, tagsOf, textOf, withClass,
} from './support/uiHarness.ts';
import type {
  RowActivationEvent, RowActivationSelection, RowOpenProps, TableEmptyProps, TableProps, TableSkeletonColumn,
  TableSkeletonProps, TrProps,
} from '../app/_ui/Table.tsx';
import type { PaginationProps } from '../app/_ui/Pagination.tsx';
import type { ResponsiveViewProps } from '../app/_ui/ResponsiveView.tsx';

type ShouldActivateRow = (event: RowActivationEvent, selection?: RowActivationSelection | null) => boolean;
type RevealScrollTarget = (target: HTMLElement | null | undefined) => boolean;

const css = (name: string) => readFileSync(new URL(`../app/_ui/${name}`, import.meta.url), 'utf8');

class FakeNode {
  parent: FakeElement | null = null;

  get parentElement(): FakeElement | null {
    return this.parent;
  }
}

class FakeText extends FakeNode {}

class FakeElement extends FakeNode {
  tag: string;
  attrs: Record<string, string>;
  ownerDocument: { getSelection: () => RowActivationSelection | null } | null = null;

  constructor(tag: string, attrs: Record<string, string> = {}) {
    super();
    this.tag = tag;
    this.attrs = attrs;
  }

  add<N extends FakeNode>(child: N): N {
    child.parent = this;
    return child;
  }

  contains(node: unknown): boolean {
    for (let current = node as FakeNode | null; current; current = current.parent) {
      if (current === this) return true;
    }
    return false;
  }

  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const match = /^([a-z]+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(part.trim());
      if (!match) throw new Error(`fake DOM cannot match ${part}`);
      const [, tag, attr, value] = match;
      if (tag && tag !== this.tag) return false;
      if (attr && !(attr in this.attrs)) return false;
      if (attr && value !== undefined && this.attrs[attr] !== value) return false;
      return Boolean(tag || attr);
    });
  }

  closest(selector: string): FakeElement | null {
    for (let current: FakeElement | null = this; current; current = current.parent) {
      if (current.matches(selector)) return current;
    }
    return null;
  }
}

function click(target: FakeNode, row: FakeElement | null, extra: Partial<RowActivationEvent> = {}): RowActivationEvent {
  return {
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: target as unknown as EventTarget,
    currentTarget: row as unknown as EventTarget,
    ...extra,
  };
}

function selection(text: string, anchor: FakeNode | null, focus: FakeNode | null = anchor, spans?: FakeElement): RowActivationSelection {
  return {
    isCollapsed: text === '',
    anchorNode: anchor as unknown as Node,
    focusNode: focus as unknown as Node,
    toString: () => text,
    containsNode: (node: Node) => spans !== undefined && (node as unknown) === spans,
  };
}

function buildRow() {
  const table = new FakeElement('table');
  const tbody = table.add(new FakeElement('tbody'));
  const row = tbody.add(new FakeElement('tr'));
  const cell = row.add(new FakeElement('td'));
  const text = cell.add(new FakeText());
  const span = cell.add(new FakeElement('span'));
  const other = tbody.add(new FakeElement('tr'));
  const otherText = other.add(new FakeElement('td')).add(new FakeText());
  return { table, row, cell, text, span, otherText };
}

describe('shouldActivateRow', () => {
  let shouldActivateRow: ShouldActivateRow;
  let ignore: string;

  before(async () => {
    const mod = await loadUi<{ shouldActivateRow: ShouldActivateRow; ROW_ACTIVATION_IGNORE: string }>('Table.tsx');
    shouldActivateRow = mod.shouldActivateRow;
    ignore = mod.ROW_ACTIVATION_IGNORE;
  });

  test('a plain primary click on row content activates', () => {
    const { row, cell, span, text } = buildRow();
    assert.equal(shouldActivateRow(click(cell, row), null), true);
    assert.equal(shouldActivateRow(click(span, row), null), true);
    assert.equal(shouldActivateRow(click(text, row), null), true);
    assert.equal(shouldActivateRow(click(row, row), null), true);
  });

  test('middle and secondary buttons never activate', () => {
    const { row, cell } = buildRow();
    assert.equal(shouldActivateRow(click(cell, row, { button: 1 }), null), false);
    assert.equal(shouldActivateRow(click(cell, row, { button: 2 }), null), false);
  });

  test('every modified click is left to the browser', () => {
    const { row, cell } = buildRow();
    for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const) {
      assert.equal(shouldActivateRow(click(cell, row, { [key]: true }), null), false, key);
    }
  });

  test('a click an inner handler already handled is ignored', () => {
    const { row, cell } = buildRow();
    assert.equal(shouldActivateRow(click(cell, row, { defaultPrevented: true }), null), false);
  });

  test('clicks inside interactive descendants never open the row', () => {
    const cases: Array<[string, Record<string, string>]> = [
      ['a', { href: '/users/1' }], ['button', {}], ['input', {}], ['select', {}], ['textarea', {}],
      ['label', {}], ['summary', {}], ['span', { role: 'button' }], ['span', { role: 'link' }],
      ['span', { role: 'checkbox' }], ['div', { role: 'menuitem' }], ['div', { 'data-row-ignore': '' }],
      ['input', { role: 'switch' }], ['div', { role: 'menu' }], ['div', { role: 'dialog' }],
    ];
    for (const [tag, attrs] of cases) {
      const { row, cell } = buildRow();
      const control = cell.add(new FakeElement(tag, attrs));
      const icon = control.add(new FakeElement('svg'));
      assert.equal(shouldActivateRow(click(control, row), null), false, `${tag} ${JSON.stringify(attrs)}`);
      assert.equal(shouldActivateRow(click(icon, row), null), false, `icon inside ${tag}`);
    }
  });

  test('the ignore list covers every control the brief names', () => {
    for (const selector of [
      'a', 'button', 'input', 'select', 'textarea', 'label', 'summary', '[role="button"]', '[role="link"]',
      '[role="checkbox"]', '[role="menuitem"]', '[data-row-ignore]',
    ]) {
      assert.ok(ignore.split(', ').includes(selector), selector);
    }
  });

  test('an interactive ancestor outside the row does not block activation', () => {
    const dialog = new FakeElement('div', { role: 'dialog' });
    const { table, row, cell } = buildRow();
    dialog.add(table);
    assert.equal(shouldActivateRow(click(cell, row), null), true);
  });

  test('a click from outside the row, such as a portal, is ignored', () => {
    const { row } = buildRow();
    const portal = new FakeElement('div');
    const item = portal.add(new FakeElement('span'));
    assert.equal(shouldActivateRow(click(item, row), null), false);
  });

  test('a text selection inside the row blocks activation', () => {
    const { row, cell, text } = buildRow();
    assert.equal(shouldActivateRow(click(cell, row), selection('Ada Lovelace', text)), false);
  });

  test('a collapsed or empty selection does not block activation', () => {
    const { row, cell, text } = buildRow();
    assert.equal(shouldActivateRow(click(cell, row), selection('', text)), true);
    const blank: RowActivationSelection = { ...selection('x', text), isCollapsed: false, toString: () => '' };
    assert.equal(shouldActivateRow(click(cell, row), blank), true);
  });

  test('a selection somewhere else on the page does not block activation', () => {
    const { row, cell, otherText } = buildRow();
    assert.equal(shouldActivateRow(click(cell, row), selection('elsewhere', otherText)), true);
  });

  test('a selection that spans across the row blocks activation', () => {
    const { row, cell, otherText } = buildRow();
    assert.equal(shouldActivateRow(click(cell, row), selection('spanning', otherText, otherText, row)), false);
  });

  test('without an explicit selection it reads the row document selection', () => {
    const { row, cell, text } = buildRow();
    row.ownerDocument = { getSelection: () => selection('picked', text) };
    assert.equal(shouldActivateRow(click(cell, row)), false);
    row.ownerDocument = { getSelection: () => null };
    assert.equal(shouldActivateRow(click(cell, row)), true);
    row.ownerDocument = null;
    assert.equal(shouldActivateRow(click(cell, row)), true);
  });

  test('without a row element any interactive target is still ignored', () => {
    const button = new FakeElement('button');
    const span = new FakeElement('span');
    assert.equal(shouldActivateRow(click(button, null), null), false);
    assert.equal(shouldActivateRow(click(span, null), null), true);
  });
});

describe('Table', () => {
  let Table: ElementType;
  let TBody: ElementType;
  let Tr: ElementType;
  let Td: ElementType;

  before(async () => {
    Table = await loadUiExport('Table.tsx', 'Table');
    TBody = await loadUiExport('Table.tsx', 'TBody');
    Tr = await loadUiExport('Table.tsx', 'Tr');
    Td = await loadUiExport('Table.tsx', 'Td');
  });

  const table = (props: Record<string, unknown>, children: ReactNode = null) => render(createElement(Table, props, children));

  test('busy marks the table aria-busy and adds the dimming class', () => {
    const [busy] = tagsOf(table({ busy: true, 'aria-label': 'Users' }), 'table');
    assert.equal(busy['aria-busy'], 'true');
    assert.deepEqual(classesOf(busy), ['table', 'busy']);
    assert.equal(busy['aria-label'], 'Users');
  });

  test('without busy the table renders exactly as before', () => {
    const [plain] = tagsOf(table({ 'aria-label': 'Users' }), 'table');
    assert.deepEqual(classesOf(plain), ['table']);
    assert.equal('aria-busy' in plain, false);
  });

  test('an explicit aria-busy still works and busy only ever adds to it', () => {
    assert.equal(tagsOf(table({ 'aria-busy': true }), 'table')[0]['aria-busy'], 'true');
    assert.equal(tagsOf(table({ 'aria-busy': true, busy: false }), 'table')[0]['aria-busy'], 'true');
    assert.equal(tagsOf(table({ 'aria-busy': undefined, busy: true }), 'table')[0]['aria-busy'], 'true');
    assert.equal('aria-busy' in tagsOf(table({ busy: false }), 'table')[0], false);
  });

  test('density and caller classes still merge after the busy class', () => {
    const [el] = tagsOf(table({ busy: true, density: 'dense', className: 'mine' }), 'table');
    assert.deepEqual(classesOf(el), ['table', 'dense', 'busy', 'mine']);
  });

  test('onActivate makes a row look interactive unless interactive is explicitly false', () => {
    const row = (props: Record<string, unknown>) => tagsOf(
      render(createElement('table', null, createElement('tbody', null, createElement(Tr, props, createElement(Td, null, 'x'))))),
      'tr',
    )[0];
    assert.deepEqual(classesOf(row({ onActivate: () => {} })), ['tr', 'interactive']);
    assert.deepEqual(classesOf(row({ onActivate: () => {}, interactive: false })), ['tr']);
    assert.deepEqual(classesOf(row({ interactive: true, selected: true })), ['tr', 'interactive', 'selected']);
    assert.deepEqual(classesOf(row({})), ['tr']);
  });

  test('onActivate runs after a raw onClick and only for clicks that pass the filter', () => {
    const renderRow = (Tr as unknown as { render: (props: TrProps, ref: null) => { props: { onClick?: (event: unknown) => void } } }).render;
    const { row, text, span } = buildRow();
    const button = span.add(new FakeElement('button'));
    row.ownerDocument = { getSelection: () => null };
    const calls: string[] = [];
    const element = renderRow({
      onClick: () => calls.push('click'),
      onActivate: () => calls.push('activate'),
    }, null);
    const handler = element.props.onClick;
    assert.equal(typeof handler, 'function');
    handler?.(click(text, row));
    handler?.(click(button, row));
    handler?.(click(text, row, { metaKey: true }));
    assert.deepEqual(calls, ['click', 'activate', 'click', 'click']);

    const legacy = () => {};
    assert.equal(renderRow({ onClick: legacy }, null).props.onClick, legacy);
  });

  test('rows render inside TBody unchanged', () => {
    const html = table({}, createElement(TBody, { className: 'body' }, createElement(Tr, null, createElement(Td, null, 'cell'))));
    assert.match(html, /<tbody class="body"><tr class="tr"><td class="td">cell<\/td><\/tr><\/tbody>/);
  });
});

describe('RowOpen', () => {
  let RowOpen: ElementType;

  before(async () => {
    RowOpen = await loadUiExport('Table.tsx', 'RowOpen');
  });

  test('href renders a real link styled as the row primary text', () => {
    const html = render(createElement(RowOpen, { href: '/users/42', 'aria-label': 'Open Ada Lovelace' }, 'Ada Lovelace'));
    const [link] = tagsOf(html, 'a');
    assert.equal(link.href, '/users/42');
    assert.deepEqual(classesOf(link), ['rowOpen']);
    assert.equal(link['aria-label'], 'Open Ada Lovelace');
    assert.equal(textOf(html), 'Ada Lovelace');
    assert.equal(tagsOf(html, 'button').length, 0);
  });

  test('onClick renders a type="button" so it never submits a form', () => {
    const html = render(createElement(RowOpen, { onClick: () => {}, 'aria-haspopup': 'dialog', className: 'extra' }, 'Withdrawal'));
    const [button] = tagsOf(html, 'button');
    assert.equal(button.type, 'button');
    assert.deepEqual(classesOf(button), ['rowOpen', 'extra']);
    assert.equal(button['aria-haspopup'], 'dialog');
    assert.equal('aria-label' in button, false);
    assert.equal(tagsOf(html, 'a').length, 0);
  });

  test('a caller cannot turn the button into a submit button', () => {
    const html = render(createElement(RowOpen, { onClick: () => {}, type: 'submit' } as Record<string, unknown>, 'Open'));
    assert.equal(tagsOf(html, 'button')[0].type, 'button');
  });

  test('forwards its ref to the rendered element', () => {
    const ref = createRef<HTMLButtonElement>();
    const html = render(createElement(RowOpen, { onClick: () => {}, ref }, 'Open'));
    assert.match(html, /^<button /);
  });
});

describe('TableEmpty and TableState', () => {
  let TableEmpty: ElementType;
  let TableState: ElementType;

  before(async () => {
    TableEmpty = await loadUiExport('Table.tsx', 'TableEmpty');
    TableState = await loadUiExport('Table.tsx', 'TableState');
  });

  test('children-only usage renders byte-for-byte as before', () => {
    assert.equal(render(createElement(TableEmpty, { colSpan: 5 }, 'No users')), '<tr><td colSpan="5" class="empty">No users</td></tr>');
    assert.equal(render(createElement(TableEmpty, { colSpan: 3 })), '<tr><td colSpan="3" class="empty">No data</td></tr>');
  });

  test('slots render a chrome-free EmptyState spanning the table', () => {
    const html = render(createElement(TableEmpty, {
      colSpan: 7,
      title: 'No submissions match these filters',
      hint: 'Try another search.',
      actions: createElement('button', { type: 'button' }, 'Clear filters'),
    }));
    assert.match(html, /^<tr><td colSpan="7" class="stateCell"><div class="empty emptyState">/);
    const [icon] = withClass(html, 'div', 'emptyIcon');
    assert.equal(icon['aria-hidden'], 'true');
    assert.match(html, /lucide-inbox/);
    assert.match(html, /class="emptyTitle">No submissions match these filters</);
    assert.match(html, /class="emptyHint">Try another search\.</);
    assert.match(html, /class="emptyActions"><button type="button">Clear filters<\/button>/);
  });

  test('children become the title when only other slots are given, and icon can be dropped', () => {
    const html = render(createElement(TableEmpty, { colSpan: 2, hint: 'Nothing recorded.', icon: null }, 'No devices'));
    assert.match(html, /class="emptyTitle">No devices</);
    assert.equal(withClass(html, 'div', 'emptyIcon').length, 0);
  });

  test('a custom icon replaces the default one', () => {
    const html = render(createElement(TableEmpty, { colSpan: 2, title: 'Empty', icon: createElement('svg', { id: 'own' }) }));
    assert.match(html, /<div class="emptyIcon" aria-hidden="true"><svg id="own"><\/svg><\/div>/);
    assert.doesNotMatch(html, /lucide-inbox/);
  });

  test('TableState gives arbitrary state content an unpadded full-width cell', () => {
    const html = render(createElement(TableState, { colSpan: 6 }, createElement('div', { role: 'alert' }, 'Failed')));
    assert.equal(html, '<tr><td colSpan="6" class="stateCell"><div role="alert">Failed</div></td></tr>');
  });
});

describe('TableSkeleton', () => {
  let Table: ElementType;
  let TBody: ElementType;
  let TableSkeleton: ElementType;

  before(async () => {
    Table = await loadUiExport('Table.tsx', 'Table');
    TBody = await loadUiExport('Table.tsx', 'TBody');
    TableSkeleton = await loadUiExport('Table.tsx', 'TableSkeleton');
  });

  const skeleton = (props: Record<string, unknown>, tableProps: Record<string, unknown> = {}) =>
    render(createElement(Table, tableProps, createElement(TBody, null, createElement(TableSkeleton, props))));

  const skeletonRows = (html: string) => [...html.matchAll(/<tr class="skeletonRow" aria-hidden="true">([\s\S]*?)<\/tr>/g)].map((m) => m[1]);

  test('full-width mode keeps one spanning bar per row and moves padding into CSS', () => {
    const html = skeleton({ colSpan: 7, rows: 4 });
    const rows = skeletonRows(html);
    assert.equal(rows.length, 4);
    for (const row of rows) {
      const cells = tagsOf(row, 'td');
      assert.equal(cells.length, 1);
      assert.equal(cells[0].colSpan, '7');
      assert.deepEqual(classesOf(cells[0]), ['td', 'skeletonCell']);
      assert.equal('style' in cells[0], false);
    }
    assert.doesNotMatch(html, /padding/);
  });

  test('defaults to six rows and keeps the old row-count semantics', () => {
    assert.equal(skeletonRows(skeleton({ colSpan: 3 })).length, 6);
    assert.equal(skeletonRows(skeleton({ colSpan: 3, rows: 0 })).length, 0);
  });

  test('skeleton rows are hidden from assistive tech behind one loading status', () => {
    const html = skeleton({ colSpan: 4, rows: 3 });
    assert.equal(tagsOf(html, 'tr').filter((attrs) => attrs['aria-hidden'] === 'true').length, 3);
    const statuses = tagsOf(html, 'span').filter((attrs) => attrs.role === 'status');
    assert.equal(statuses.length, 1);
    assert.match(html, /^<div[^>]*><table class="table"><tbody><tr><td colSpan="4" class="srOnly"><span role="status">Loading<\/span><\/td><\/tr>/);
  });

  test('the status names the table it is loading, or uses an explicit label', () => {
    assert.match(skeleton({ colSpan: 2 }, { 'aria-label': 'Users' }), /role="status">Loading Users</);
    assert.match(skeleton({ colSpan: 2, label: 'Fetching payouts' }, { 'aria-label': 'Users' }), /role="status">Fetching payouts</);
  });

  test('a table already labelled as loading is not announced as "Loading Loading"', () => {
    assert.match(skeleton({ colSpan: 2 }, { 'aria-label': 'Loading activity' }), /role="status">Loading activity</);
    assert.match(skeleton({ colSpan: 2 }, { 'aria-label': '  ' }), /role="status">Loading</);
    assert.match(skeleton({ colSpan: 2, label: '' }, { 'aria-label': 'Users' }), /role="status">Loading Users</);
  });

  test('columns mode renders one skeleton cell per column, mirroring real rows', () => {
    const columns: TableSkeletonColumn[] = [
      { width: 150, lines: 2, avatar: true },
      { width: 120, lines: 2 },
      { width: 80, align: 'right' },
      { width: '40%', align: 'center' },
      { width: 64, align: 'right', button: true },
    ];
    const html = skeleton({ columns, rows: 3 });
    const rows = skeletonRows(html);
    assert.equal(rows.length, 3);
    for (const row of rows) {
      const cells = tagsOf(row, 'td');
      assert.equal(cells.length, columns.length);
      for (const cell of cells) {
        assert.ok(classesOf(cell).includes('td'));
        assert.equal('colSpan' in cell, false);
      }
      assert.ok(classesOf(cells[2]).includes('numeric'));
      assert.ok(classesOf(cells[3]).includes('center'));
    }
    assert.match(html, /<td colSpan="5" class="srOnly">/);
  });

  test('avatar, two-line, alignment and button cells use their own shapes', () => {
    const html = skeleton({
      columns: [{ width: 150, lines: 2, avatar: true }, { width: 80, align: 'right' }, { align: 'right', button: true }],
      rows: 1,
    });
    const [avatar] = withClass(html, 'div', 'skeletonAvatar');
    assert.match(avatar.style, /width:var\(--space-7\);height:var\(--space-7\);border-radius:var\(--radius-pill\)/);
    assert.equal(withClass(html, 'div', 'skeletonLineSub').length, 1);
    assert.equal(withClass(html, 'div', 'skeletonEnd').length, 2);
    const [button] = withClass(html, 'div', 'skeletonButton');
    assert.match(button.style, /width:56px;height:var\(--space-7\)/);
  });

  test('bar widths vary by row so the placeholder does not look mechanical', () => {
    const html = skeleton({ columns: [{ width: 100 }, { width: '30%' }], rows: 3 });
    const widths = tagsOf(html, 'div')
      .filter((attrs) => classesOf(attrs).includes('skeleton'))
      .map((attrs) => /width:([^;]+)/.exec(attrs.style)?.[1]);
    assert.deepEqual(widths, ['100px', 'calc(30% * 0.82)', '82px', 'calc(30% * 0.94)', '94px', 'calc(30% * 0.7)']);
  });

  test('without columns or colSpan in columns mode the span falls back to the column count', () => {
    const html = skeleton({ columns: [{}, {}, {}], rows: 1 });
    assert.match(html, /<td colSpan="3" class="srOnly">/);
  });
});

describe('Pagination', () => {
  let Pagination: ElementType;
  let revealScrollTarget: RevealScrollTarget;

  before(async () => {
    Pagination = await loadUiExport('Pagination.tsx', 'Pagination');
    revealScrollTarget = (await loadUi<{ revealScrollTarget: RevealScrollTarget }>('Pagination.tsx')).revealScrollTarget;
  });

  function target(top: number, { reduce = false, margin = '0px' } = {}) {
    const calls: ScrollIntoViewOptions[] = [];
    const el = {
      getBoundingClientRect: () => ({ top }),
      scrollIntoView: (options: ScrollIntoViewOptions) => calls.push(options),
      ownerDocument: {
        defaultView: {
          getComputedStyle: () => ({ scrollMarginTop: margin }),
          matchMedia: (query: string) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)' }),
        },
      },
    };
    return { el: el as unknown as HTMLElement, calls };
  }

  test('scrolls the list top back into view once it has scrolled above the viewport', () => {
    const { el, calls } = target(-420);
    assert.equal(revealScrollTarget(el), true);
    assert.deepEqual(calls, [{ block: 'start', behavior: 'smooth' }]);
  });

  test('reduced motion jumps instead of animating', () => {
    const { el, calls } = target(-10, { reduce: true });
    revealScrollTarget(el);
    assert.deepEqual(calls, [{ block: 'start', behavior: 'auto' }]);
  });

  test('leaves the page alone while the list top is still visible', () => {
    const { el, calls } = target(0);
    assert.equal(revealScrollTarget(el), false);
    assert.equal(calls.length, 0);
    assert.equal(revealScrollTarget(null), false);
    assert.equal(revealScrollTarget(undefined), false);
  });

  test('honours the target scroll-margin-top so a sticky bar never hides it', () => {
    const under = target(50, { margin: '80px' });
    assert.equal(revealScrollTarget(under.el), true);
    const clear = target(90, { margin: '80px' });
    assert.equal(revealScrollTarget(clear.el), false);
  });

  test('a scroll target changes nothing in the rendered markup', () => {
    const props = { page: 2, pageSize: 50, total: 240, onPageChange: () => {}, noun: 'users', label: 'User pages' };
    const ref = createRef<HTMLDivElement>();
    assert.equal(
      render(createElement(Pagination, { ...props, scrollTargetRef: ref })),
      render(createElement(Pagination, props)),
    );
  });

  test('the page buttons keep their names and their icons stay decorative', () => {
    const html = render(createElement(Pagination, { page: 1, pageSize: 10, total: 30, onPageChange: () => {} }));
    const names = tagsOf(html, 'button').map((attrs) => attrs['aria-label']);
    assert.deepEqual(names, ['Previous page', 'Next page']);
    for (const svg of tagsOf(html, 'svg')) assert.equal(svg['aria-hidden'], 'true');
  });
});

describe('ResponsiveView', () => {
  let ResponsiveView: ElementType;

  before(async () => {
    ResponsiveView = await loadUiExport('ResponsiveView.tsx', 'ResponsiveView');
  });

  test('renders both trees so server and client markup always match', () => {
    const html = render(createElement(ResponsiveView, {
      desktop: createElement('table', { id: 'wide' }),
      mobile: createElement('ul', { id: 'narrow' }),
    }));
    assert.equal(
      html,
      '<div class="view desktop atMobile"><table id="wide"></table></div><div class="view mobile atMobile"><ul id="narrow"></ul></div>',
    );
  });

  test('the desktop breakpoint switches the classes, not the markup shape', () => {
    const html = render(createElement(ResponsiveView, { desktop: 'd', mobile: 'm', breakpoint: 'desktop' }));
    assert.equal(html, '<div class="view desktop atDesktop">d</div><div class="view mobile atDesktop">m</div>');
  });

  test('is a plain server-compatible module without client hooks', () => {
    const source = css('ResponsiveView.tsx');
    assert.doesNotMatch(source, /'use client'/);
    assert.doesNotMatch(source, /\buse[A-Z]\w*\(/);
  });

  test('its media queries use the same breakpoints as useIsMobile and useIsDesktop', () => {
    const hooks = readFileSync(new URL('../app/lib/useIsMobile.ts', import.meta.url), 'utf8');
    const mobile = /BREAKPOINT_MOBILE = (\d+)/.exec(hooks)?.[1];
    const desktop = /BREAKPOINT_DESKTOP = (\d+)/.exec(hooks)?.[1];
    assert.ok(mobile && desktop);
    const sheet = css('ResponsiveView.module.css');
    assert.match(sheet, new RegExp(`@media \\(max-width: ${mobile}px\\) \\{\\s*\\.atMobile\\.desktop \\{ display: none; \\}`));
    assert.match(sheet, new RegExp(`@media not all and \\(max-width: ${mobile}px\\) \\{\\s*\\.atMobile\\.mobile \\{ display: none; \\}`));
    assert.match(sheet, new RegExp(`@media not all and \\(min-width: ${desktop}px\\) \\{\\s*\\.atDesktop\\.desktop \\{ display: none; \\}`));
    assert.match(sheet, new RegExp(`@media \\(min-width: ${desktop}px\\) \\{\\s*\\.atDesktop\\.mobile \\{ display: none; \\}`));
  });
});

describe('public prop types', () => {
  test('existing call shapes and the new ones both type-check', () => {
    const listTop = createRef<HTMLDivElement>();
    const pagination: PaginationProps = {
      page: 1, pageSize: 50, total: 120, onPageChange: () => {}, scrollTargetRef: listTop,
    };
    const legacySkeleton: TableSkeletonProps = { colSpan: 7, rows: 8 };
    const columnSkeleton: TableSkeletonProps = {
      columns: [{ width: 150, lines: 2, avatar: true }, { width: 80, align: 'right' }, { button: true }],
    };
    const legacyEmpty: TableEmptyProps = { colSpan: 5, children: 'No users' };
    const slotEmpty: TableEmptyProps = { colSpan: 5, title: 'No users', hint: 'Try again.', icon: null };
    const link: RowOpenProps = { href: '/users/1', prefetch: false, children: 'Ada' };
    const button: RowOpenProps = { onClick: () => {}, 'aria-haspopup': 'dialog', children: 'Open' };
    const row: TrProps = { interactive: true, selected: false, onActivate: (event) => void event.currentTarget };
    const table: TableProps = { busy: true, density: 'dense', 'aria-label': 'Users' };
    const view: ResponsiveViewProps = { desktop: null, mobile: null, breakpoint: 'desktop' };
    assert.ok(pagination && legacySkeleton && columnSkeleton && legacyEmpty && slotEmpty && link && button && row && table && view);
  });
});

describe('list kit styles', () => {
  for (const sheet of ['Table.module.css', 'Pagination.module.css', 'ResponsiveView.module.css']) {
    test(`${sheet} uses design tokens only`, () => {
      const text = css(sheet);
      assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/, 'literal hex colour');
      assert.doesNotMatch(text, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/, 'literal colour function');
      assert.doesNotMatch(
        text,
        /(?<![-\w])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|transparent)(?![-\w])/i,
        'named colour',
      );
      assert.doesNotMatch(text, /z-index\s*:\s*-?\d/, 'raw z-index');
      assert.doesNotMatch(text, /\/\*/, 'prose comment');
    });
  }

  test('the busy body dims, drops the hover highlight and honours reduced motion', () => {
    const text = css('Table.module.css');
    assert.match(text, /\.busy > tbody \{[^}]*opacity: 0\.55;/);
    assert.match(text, /\.busy > tbody > \.tr:not\(\.selected\):hover \{ background: none; \}/);
    assert.match(text, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.table > tbody \{ transition: none; \}/);
  });

  test('RowOpen has a visible focus ring from the accent token', () => {
    assert.match(css('Table.module.css'), /\.rowOpen:focus-visible \{\s*outline: 2px solid var\(--accent-base\);/);
  });

  test('the kit files carry no prose comments', () => {
    for (const file of ['Table.tsx', 'Pagination.tsx', 'ResponsiveView.tsx', 'MobileDataList.tsx', 'useTableSort.ts']) {
      const source = css(file);
      assert.doesNotMatch(source, /^\s*\/\/(?!\/)/m, `${file} line comment`);
      assert.doesNotMatch(source, /\/\*/, `${file} block comment`);
    }
  });

  test('no static inline styles in the table module', () => {
    assert.doesNotMatch(css('Table.tsx'), /style=\{\{\s*padding/);
  });
});
