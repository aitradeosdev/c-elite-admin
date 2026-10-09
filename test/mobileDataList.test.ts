import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, type ElementType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  MobileDataListProps, MobileDataListRow, MobileDataListView, MobileDataListViewInput,
} from '../app/_ui/MobileDataList.tsx';

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

async function loadExport(file: string, name: string): Promise<ElementType> {
  const mod = await import(await bundle(file));
  return mod[name];
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

function withClass(html: string, tag: string, className: string): Attrs[] {
  return tagsOf(html, tag).filter((attrs) => classesOf(attrs).includes(className));
}

function textById(html: string, id: string | undefined): string | undefined {
  if (!id) return undefined;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`id="${escaped}"[^>]*>([^<]*)<`))?.[1];
}

function itemsOf(html: string): string[] {
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[0]);
}

interface Withdrawal {
  id: string;
  user: string;
  amount: string;
  bank: string;
  when: string;
  pending?: boolean;
}

const ROWS: Withdrawal[] = [
  { id: 'wd_01', user: '@ada', amount: '₦50,000.00', bank: 'GTBank · 0123456789', when: '2 min ago', pending: true },
  { id: 'wd_02', user: '@tobi', amount: '₦1,250,000.00', bank: 'Access · 9876543210', when: '9 min ago' },
  { id: 'wd_03', user: '@chioma', amount: '₦7,500.00', bank: 'Opay · 8012345678', when: '1 h ago' },
];

const noop = () => {};

describe('MobileDataList', () => {
  let MobileDataList: ElementType;

  before(async () => {
    MobileDataList = await loadExport('MobileDataList.tsx', 'MobileDataList');
  });

  function render(
    overrides: Partial<MobileDataListProps<Withdrawal>> = {},
    row: (item: Withdrawal) => Partial<MobileDataListRow> = () => ({}),
  ): string {
    const props: MobileDataListProps<Withdrawal> = {
      items: ROWS,
      getKey: (item) => item.id,
      ariaLabel: 'Withdrawals',
      renderRow: (item) => ({
        primary: item.user,
        secondary: item.bank,
        value: item.amount,
        status: 'pending',
        meta: item.when,
        ...row(item),
      }),
      ...overrides,
    };
    return renderToStaticMarkup(createElement(MobileDataList, props));
  }

  test('renders one labelled list with an item per row instead of a card per row', () => {
    const html = render();
    const [list] = tagsOf(html, 'ul');
    assert.equal(tagsOf(html, 'ul').length, 1);
    assert.equal(list.role, 'list');
    assert.equal(list['aria-label'], 'Withdrawals');
    assert.ok(classesOf(list).includes('list'));
    assert.equal(itemsOf(html).length, ROWS.length);
    assert.equal('aria-busy' in list, false);
  });

  test('an href row is a real link that carries the whole row', () => {
    const html = render({}, (item) => ({ href: `/withdrawals/${item.id}` }));
    const links = tagsOf(html, 'a');
    assert.deepEqual(links.map((a) => a.href), ROWS.map((item) => `/withdrawals/${item.id}`));
    for (const link of links) assert.ok(classesOf(link).includes('interactive'));
    assert.equal(tagsOf(html, 'button').length, 0);
    const [first] = itemsOf(html);
    assert.match(first, /<a\b[^>]*>[\s\S]*@ada[\s\S]*₦50,000\.00[\s\S]*GTBank[\s\S]*pending[\s\S]*2 min ago[\s\S]*<\/a>/);
  });

  test('an onClick row is a type="button" so it is keyboard reachable', () => {
    const html = render({}, () => ({ onClick: noop }));
    const buttons = tagsOf(html, 'button');
    assert.equal(buttons.length, ROWS.length);
    for (const button of buttons) {
      assert.equal(button.type, 'button');
      assert.ok(classesOf(button).includes('body'));
      assert.ok(classesOf(button).includes('interactive'));
    }
    assert.equal(tagsOf(html, 'a').length, 0);
  });

  test('href wins over onClick so a row never renders two interactive bodies', () => {
    const html = render({}, (item) => ({ href: `/withdrawals/${item.id}`, onClick: noop }));
    assert.equal(tagsOf(html, 'a').length, ROWS.length);
    assert.equal(tagsOf(html, 'button').length, 0);
  });

  test('a row with neither href nor onClick stays inert', () => {
    const html = render();
    assert.equal(tagsOf(html, 'a').length, 0);
    assert.equal(tagsOf(html, 'button').length, 0);
    const bodies = withClass(html, 'div', 'body');
    assert.equal(bodies.length, ROWS.length);
    for (const body of bodies) assert.equal(classesOf(body).includes('interactive'), false);
  });

  test('row actions are a labelled sibling of the link, never nested inside it', () => {
    const html = render({}, (item) => ({
      href: `/withdrawals/${item.id}`,
      actions: item.pending
        ? [createElement('button', { key: 'a', type: 'button' }, 'Approve'), createElement('button', { key: 'r', type: 'button' }, 'Reject')]
        : undefined,
    }));
    for (const link of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
      assert.doesNotMatch(link[1], /<(a|button)\b/);
    }
    const groups = tagsOf(html, 'div').filter((attrs) => attrs.role === 'group');
    assert.equal(groups.length, 1);
    assert.ok(classesOf(groups[0]).includes('actions'));
    assert.equal(textById(html, groups[0]['aria-labelledby']), '@ada');
    const [first, second] = itemsOf(html);
    assert.match(first, /<\/a><div\b[^>]*role="group"[^>]*>[\s\S]*Approve[\s\S]*Reject[\s\S]*<\/div><\/li>$/);
    assert.doesNotMatch(second, /role="group"/);
  });

  test('value sits in its own slot and status moves to the top line when there is no value', () => {
    const withValue = render();
    assert.equal(withClass(withValue, 'span', 'value').length, ROWS.length);
    assert.equal(withClass(withValue, 'span', 'statusTop').length, 0);

    const withoutValue = render({}, () => ({ value: undefined }));
    assert.equal(withClass(withoutValue, 'span', 'value').length, 0);
    assert.equal(withClass(withoutValue, 'span', 'statusTop').length, ROWS.length);
  });

  test('empty slots render nothing, so false and empty strings never leave a gap', () => {
    const html = render({}, () => ({ secondary: false, meta: '', status: null, value: undefined }));
    for (const slot of ['secondary', 'meta', 'status', 'value']) {
      assert.equal(withClass(html, 'span', slot).length, 0, `${slot} should not render`);
    }
    assert.equal(withClass(html, 'span', 'primary').length, ROWS.length);
  });

  test('a numeric zero value is still shown', () => {
    const html = render({ items: ROWS.slice(0, 1) }, () => ({ value: 0 as ReactNode }));
    assert.match(html, /class="value">0</);
  });

  test('leading content switches the row to the three-column layout', () => {
    const html = render({ items: ROWS.slice(0, 1) }, () => ({ leading: createElement('img', { alt: '', src: '/a.png' }) }));
    const [body] = withClass(html, 'div', 'body');
    assert.ok(classesOf(body).includes('withLeading'));
    assert.equal(withClass(html, 'span', 'leading').length, 1);
  });

  test('a flag draws the tone rule on the item and is announced before the row content', () => {
    const html = render({}, (item) => ({
      href: `/withdrawals/${item.id}`,
      flag: item.id === 'wd_01' ? 'warning' : item.id === 'wd_02' ? 'danger' : null,
      flagLabel: item.id === 'wd_02' ? 'Flagged: new bank account' : undefined,
    }));
    const [warning, danger, plain] = tagsOf(html, 'li');
    assert.ok(classesOf(warning).includes('flagWarning'));
    assert.ok(classesOf(danger).includes('flagDanger'));
    assert.deepEqual(classesOf(plain), ['row']);
    const [first, second, third] = itemsOf(html);
    assert.match(first, /<a\b[^>]*><span class="srOnly">Flagged<\/span>/);
    assert.match(second, /<a\b[^>]*><span class="srOnly">Flagged: new bank account<\/span>/);
    assert.doesNotMatch(third, /srOnly/);
  });

  test('the danger flag has its own default announcement', () => {
    const html = render({ items: ROWS.slice(0, 1) }, () => ({ flag: 'danger' }));
    assert.match(html, /<span class="srOnly">Flagged as critical<\/span>/);
  });

  test('initial loading renders six animated Skeleton rows, never opacity boxes', () => {
    const html = render({ items: [], loading: true });
    const [list] = tagsOf(html, 'ul');
    assert.equal(list['aria-hidden'], 'true');
    assert.equal(itemsOf(html).length, 6);
    assert.equal(withClass(html, 'div', 'skeleton').length, 6 * 5);
    assert.doesNotMatch(html, /opacity/);
    const status = tagsOf(html, 'span').find((attrs) => attrs.role === 'status');
    assert.ok(status);
    assert.match(html, /role="status">Loading Withdrawals</);
  });

  test('skeletonRows sets how many placeholder rows render', () => {
    assert.equal(itemsOf(render({ items: [], loading: true, skeletonRows: 10 })).length, 10);
    assert.equal(itemsOf(render({ items: [], loading: true, skeletonRows: 0 })).length, 1);
  });

  test('a refresh keeps the rows on screen and marks the list busy', () => {
    const html = render({ loading: true });
    const [list] = tagsOf(html, 'ul');
    assert.equal(list['aria-busy'], 'true');
    assert.equal(itemsOf(html).length, ROWS.length);
    assert.equal(withClass(html, 'div', 'skeleton').length, 0);
  });

  test('a refresh with rows leaves them undimmed unless busy asks for it', () => {
    assert.deepEqual(classesOf(tagsOf(render({ loading: true }), 'ul')[0]), ['list']);
    const [list] = tagsOf(render({ busy: true }), 'ul');
    assert.deepEqual(classesOf(list), ['list', 'busy']);
    assert.equal(list['aria-busy'], 'true');
  });

  test('busy={false} keeps an empty refetch undimmed but still marks it busy', () => {
    const dimmed = render({ items: [], loading: true, initialLoading: false });
    assert.equal(withClass(dimmed, 'div', 'busy').length, 1);
    const plain = render({ items: [], loading: true, initialLoading: false, busy: false });
    assert.equal(withClass(plain, 'div', 'busy').length, 0);
    assert.match(plain, /^<div class="root" aria-busy="true">/);
  });

  test('an error renders the compact ErrorState with retry inside the list frame', () => {
    const html = render({ items: [], error: 'Could not reach the server.', onRetry: noop });
    assert.equal(tagsOf(html, 'ul').length, 0);
    assert.match(html, /class="frame"><div class="wrap compact" role="alert">/);
    assert.match(html, /This list could not be loaded/);
    assert.match(html, /Could not reach the server\./);
    assert.match(html, /Try again/);
  });

  test('an error without onRetry offers no retry button', () => {
    const html = render({ items: [], error: 'Forbidden' });
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /Try again/);
  });

  test('loading only outranks an error while there is nothing to show', () => {
    const retrying = render({ items: [], loading: true, error: 'Timed out' });
    assert.doesNotMatch(retrying, /role="alert"/);
    assert.equal(withClass(retrying, 'div', 'skeleton').length, 6 * 5);

    const failedRefresh = render({ loading: true, error: 'Timed out' });
    assert.match(failedRefresh, /role="alert"/);
    assert.equal(tagsOf(failedRefresh, 'ul').length, 1);
  });

  test('a failed refresh keeps the rows on screen under the error', () => {
    const html = render({ error: 'Timed out', onRetry: noop });
    assert.match(html, /^<div class="root"><div class="frame notice"><div class="wrap compact" role="alert">/);
    assert.match(html, /This list could not be refreshed/);
    assert.match(html, /Try again/);
    assert.equal(itemsOf(html).length, ROWS.length);
    assert.ok(html.indexOf('role="alert"') < html.indexOf('<ul'));
  });

  test('row actions carry no click handler that could swallow document listeners', () => {
    const source = readFileSync(uiFile('MobileDataList.tsx'), 'utf8');
    assert.doesNotMatch(source, /stopPropagation/);
  });

  test('no items renders EmptyState with the caller content and a decorative icon', () => {
    const html = render({
      items: [],
      empty: {
        title: 'No withdrawals',
        hint: 'Pending requests show up here.',
        actions: createElement('button', { type: 'button' }, 'Clear filters'),
      },
    });
    assert.equal(tagsOf(html, 'ul').length, 0);
    assert.equal(withClass(html, 'div', 'empty').length, 1);
    const [icon] = withClass(html, 'div', 'emptyIcon');
    assert.equal(icon['aria-hidden'], 'true');
    assert.match(html, /class="emptyTitle">No withdrawals</);
    assert.match(html, /class="emptyHint">Pending requests show up here\.</);
    assert.match(html, /class="emptyActions"><button type="button">Clear filters<\/button>/);
  });

  test('empty falls back to a generic title and can drop the icon', () => {
    assert.match(render({ items: [] }), /class="emptyTitle">Nothing to show</);
    const html = render({ items: [], empty: { title: 'No coupons yet', icon: null } });
    assert.equal(withClass(html, 'div', 'emptyIcon').length, 0);
  });

  test('className lands on the same root element in every state', () => {
    const states = [
      render({ className: 'spaced' }),
      render({ className: 'spaced', items: [], loading: true }),
      render({ className: 'spaced', error: 'Nope' }),
      render({ className: 'spaced', items: [] }),
    ];
    for (const html of states) assert.match(html, /^<div class="root spaced">/);
  });

  test('a refetch after the list settled keeps the empty state and marks it busy', () => {
    const html = render({ items: [], loading: true, initialLoading: false, empty: { title: 'No withdrawals' } });
    assert.match(html, /^<div class="root" aria-busy="true">/);
    assert.match(html, /class="emptyTitle">No withdrawals</);
    assert.equal(withClass(html, 'div', 'skeleton').length, 0);
    assert.doesNotMatch(html, /role="status"/);
  });

  test('a retry after a failed first load keeps the error on screen and marks it busy', () => {
    const html = render({ items: [], loading: true, initialLoading: false, error: 'Timed out', onRetry: noop });
    assert.match(html, /^<div class="root" aria-busy="true"><div class="frame busy"><div class="wrap compact" role="alert">/);
    assert.match(html, /This list could not be loaded/);
    assert.equal(withClass(html, 'div', 'skeleton').length, 0);
  });

  test('initialLoading forces the skeleton while there is nothing to show', () => {
    const html = render({ items: [], loading: false, initialLoading: true });
    assert.equal(itemsOf(html).length, 6);
    assert.match(html, /role="status">Loading Withdrawals</);
    assert.equal(withClass(html, 'div', 'skeleton').length, 6 * 5);
  });

  test('initialLoading never hides rows that are already on screen', () => {
    const html = render({ loading: true, initialLoading: true });
    assert.equal(tagsOf(html, 'ul')[0]['aria-busy'], 'true');
    assert.equal(withClass(html, 'div', 'skeleton').length, 0);
  });

  test('error titles can be named for the page', () => {
    const failed = render({ items: [], error: 'Forbidden', errorTitle: 'Withdrawals could not be loaded' });
    assert.match(failed, /<h2[^>]*>Withdrawals could not be loaded<\/h2>/);
    assert.doesNotMatch(failed, /This list could not be loaded/);
    const stale = render({ error: 'Timed out', refreshErrorTitle: 'Live updates paused' });
    assert.match(stale, /<h2[^>]*>Live updates paused<\/h2>/);
    assert.doesNotMatch(stale, /This list could not be refreshed/);
  });
});

describe('resolveMobileDataListView', () => {
  let resolve: (input: MobileDataListViewInput) => MobileDataListView;

  before(async () => {
    resolve = (await loadExport('MobileDataList.tsx', 'resolveMobileDataListView')) as unknown as typeof resolve;
  });

  interface Step {
    count: number;
    loading: boolean;
    error?: boolean;
  }

  function play(steps: Step[], initialLoading?: boolean): MobileDataListView[] {
    let settled: boolean | null = null;
    return steps.map((step) => {
      const current: boolean = settled ?? !step.loading;
      const view = resolve({ ...step, error: Boolean(step.error), settled: current, initialLoading });
      settled = current || !step.loading;
      return view;
    });
  }

  test('the skeleton shows only until the first render that is not loading', () => {
    assert.deepEqual(
      play([
        { count: 0, loading: true },
        { count: 0, loading: false },
        { count: 0, loading: true },
        { count: 3, loading: false },
        { count: 3, loading: true },
        { count: 0, loading: false },
        { count: 0, loading: true },
      ]),
      ['skeleton', 'empty', 'empty', 'list', 'list', 'empty', 'empty'],
    );
  });

  test('a list that mounts with data never shows a skeleton, even when later emptied and refetched', () => {
    assert.deepEqual(
      play([{ count: 2, loading: false }, { count: 0, loading: false }, { count: 0, loading: true }]),
      ['list', 'empty', 'empty'],
    );
  });

  test('a failed first load stays an error during the retry instead of flashing the skeleton', () => {
    assert.deepEqual(
      play([
        { count: 0, loading: true },
        { count: 0, loading: false, error: true },
        { count: 0, loading: true, error: true },
        { count: 4, loading: false },
      ]),
      ['skeleton', 'error', 'error', 'list'],
    );
  });

  test('loading still outranks an error before the first settle', () => {
    assert.equal(resolve({ count: 0, loading: true, error: true, settled: false }), 'skeleton');
  });

  test('initialLoading overrides the tracking in both directions', () => {
    assert.deepEqual(
      play([{ count: 0, loading: true }, { count: 0, loading: false }, { count: 0, loading: true }], true),
      ['skeleton', 'skeleton', 'skeleton'],
    );
    assert.deepEqual(play([{ count: 0, loading: true }, { count: 0, loading: false }], false), ['empty', 'empty']);
    assert.equal(resolve({ count: 0, loading: false, error: true, settled: true, initialLoading: false }), 'error');
  });

  test('rows always win', () => {
    for (const initialLoading of [true, false, undefined]) {
      assert.equal(resolve({ count: 1, loading: true, error: true, settled: false, initialLoading }), 'list');
    }
  });
});

describe('MobileDataList sort control', () => {
  let MobileDataList: ElementType;

  before(async () => {
    MobileDataList = await loadExport('MobileDataList.tsx', 'MobileDataList');
  });

  const OPTIONS = [
    { key: 'created_at', label: 'Date requested' },
    { key: 'amount', label: 'Payout' },
  ];

  function render(overrides: Partial<MobileDataListProps<Withdrawal>> = {}): string {
    const props: MobileDataListProps<Withdrawal> = {
      items: ROWS,
      getKey: (item) => item.id,
      ariaLabel: 'Withdrawals',
      renderRow: (item) => ({ primary: item.user, value: item.amount }),
      sortOptions: OPTIONS,
      sort: { key: 'amount', dir: 'desc' },
      onSortChange: noop,
      ...overrides,
    };
    return renderToStaticMarkup(createElement(MobileDataList, props));
  }

  test('renders a labelled select and a named direction toggle above the list', () => {
    const html = render();
    assert.match(html, /^<div class="root"><div class="sortBar"><label class="sortLabel" for="[^"]+">Sort by<\/label>/);
    const [label] = tagsOf(html, 'label');
    const [select] = tagsOf(html, 'select');
    assert.equal(select.id, label.for);
    assert.deepEqual(classesOf(select), ['control', 'select']);
    const options = tagsOf(html, 'option');
    assert.deepEqual(options.map((option) => option.value), ['created_at', 'amount']);
    assert.equal('selected' in options[1], true);
    assert.equal('selected' in options[0], false);
    assert.ok(html.indexOf('class="sortBar"') < html.indexOf('<ul'));
  });

  test('the direction toggle is a real button whose pressed state is the direction', () => {
    const desc = tagsOf(render(), 'button').find((attrs) => classesOf(attrs).includes('sortDirection'));
    assert.ok(desc);
    assert.equal(desc.type, 'button');
    assert.equal(desc['aria-label'], 'Sort descending');
    assert.equal(desc['aria-pressed'], 'true');
    assert.equal('disabled' in desc, false);
    assert.match(render(), /lucide-arrow-down-wide-narrow/);

    const ascHtml = render({ sort: { key: 'amount', dir: 'asc' } });
    const asc = tagsOf(ascHtml, 'button').find((attrs) => classesOf(attrs).includes('sortDirection'));
    assert.equal(asc?.['aria-pressed'], 'false');
    assert.equal(asc?.['aria-label'], 'Sort descending');
    assert.match(ascHtml, /lucide-arrow-up-narrow-wide/);
  });

  test('with no sort the select shows the default order and the toggle is disabled', () => {
    const html = render({ sort: null });
    const [placeholder] = tagsOf(html, 'option');
    assert.equal(placeholder.value, '');
    assert.equal('disabled' in placeholder, true);
    assert.equal('selected' in placeholder, true);
    assert.match(html, /<option value="" disabled="" selected="">Default order<\/option>/);
    const toggle = tagsOf(html, 'button').find((attrs) => classesOf(attrs).includes('sortDirection'));
    assert.equal('disabled' in (toggle ?? {}), true);
  });

  test('a sort key the options do not list is shown as the current order', () => {
    const html = render({ sort: { key: 'status', dir: 'asc' } });
    assert.match(html, /<option value="" disabled="" selected="">Current order<\/option>/);
    const toggle = tagsOf(html, 'button').find((attrs) => classesOf(attrs).includes('sortDirection'));
    assert.equal('disabled' in (toggle ?? {}), false);
  });

  test('stays in place across loading, empty and error states so the layout never jumps', () => {
    for (const html of [
      render({ items: [], loading: true }),
      render({ items: [] }),
      render({ items: [], error: 'Nope' }),
      render({ error: 'Timed out' }),
    ]) {
      assert.match(html, /^<div class="root"[^>]*><div class="sortBar">/);
    }
    const stale = render({ error: 'Timed out' });
    assert.ok(stale.indexOf('class="sortBar"') < stale.indexOf('role="alert"'));
  });

  test('is omitted without a change handler or without options', () => {
    assert.doesNotMatch(render({ onSortChange: undefined }), /sortBar/);
    assert.doesNotMatch(render({ sortOptions: [] }), /sortBar/);
    assert.doesNotMatch(render({ sortOptions: undefined }), /sortBar/);
  });
});

describe('EmptyState', () => {
  let EmptyState: ElementType;

  before(async () => {
    EmptyState = await loadExport('Misc.tsx', 'EmptyState');
  });

  test('keeps its props API and renders only the parts it is given', () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { title: 'No templates', className: 'extra' }));
    assert.equal(html, '<div class="empty extra"><div class="emptyTitle">No templates</div></div>');
  });

  test('renders icon, title, hint and actions in order with the icon hidden from assistive tech', () => {
    const html = renderToStaticMarkup(createElement(EmptyState, {
      icon: createElement('svg', null),
      title: 'Nothing yet',
      hint: 'Create one to get started.',
      actions: createElement('button', { type: 'button' }, 'Create'),
    }));
    assert.equal(
      html,
      '<div class="empty"><div class="emptyIcon" aria-hidden="true"><svg></svg></div>'
        + '<div class="emptyTitle">Nothing yet</div><div class="emptyHint">Create one to get started.</div>'
        + '<div class="emptyActions"><button type="button">Create</button></div></div>',
    );
  });
});

describe('MobileDataList and EmptyState styles', () => {
  const sheets = ['MobileDataList.module.css', 'Misc.module.css'];

  for (const sheet of sheets) {
    test(`${sheet} uses design tokens only`, () => {
      const css = readFileSync(uiFile(sheet), 'utf8');
      assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'literal hex colour');
      assert.doesNotMatch(css, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/, 'literal colour function');
      assert.doesNotMatch(
        css,
        /(?<![-\w])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|transparent)(?![-\w])/i,
        'named colour',
      );
      assert.doesNotMatch(css, /z-index\s*:\s*-?\d/, 'raw z-index');
      assert.doesNotMatch(css, /\/\*/, 'prose comment');
    });
  }

  test('the row transition and the Skeleton shimmer honour reduced motion', () => {
    const list = readFileSync(uiFile('MobileDataList.module.css'), 'utf8');
    const reduced = list.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*([^{}]+)\{\s*transition: none;\s*\}/);
    assert.ok(reduced, 'reduced-motion block turns transitions off');
    const selectors = reduced[1].split(',').map((part) => part.trim());
    for (const selector of ['.interactive', '.list', '.frame', '.busy']) assert.ok(selectors.includes(selector), selector);
    const misc = readFileSync(uiFile('Misc.module.css'), 'utf8');
    assert.match(misc, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.skeleton \{\s*animation: none;/);
  });
});
