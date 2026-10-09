import { afterEach, before, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ElementType, type ReactNode } from 'react';
import { classesOf, loadUi, loadUiExport, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import type {
  SectionLabelElement, SectionLabelProps, StatCellProps, StatItem, StatStripProps, StatTone, StatusDotProps, Tone,
} from '../app/_ui/Status.tsx';
import type {
  EmptyStateProps, EmptyStateVariant, KpiHintTone, KpiProps, KpiTone, PageHeaderSkeletonProps, PausableTimer,
  SkeletonLinesProps, SkeletonProps, ToastCardProps, ToastHoverEvent, ToastPoliteness, ToastTone,
} from '../app/_ui/Misc.tsx';
import type { LinkButtonProps } from '../app/_ui/LinkButton.tsx';
import type { ButtonProps, ButtonSize, ButtonVariant } from '../app/_ui/Button.tsx';

const uiText = (name: string) => readFileSync(new URL(`../app/_ui/${name}`, import.meta.url), 'utf8');

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing rule ${selector}`);
  return match[1];
}

function reducedMotion(css: string): string {
  const marker = '@media (prefers-reduced-motion: reduce)';
  const blocks: string[] = [];
  for (let from = css.indexOf(marker); from >= 0; from = css.indexOf(marker, from + marker.length)) {
    const open = css.indexOf('{', from);
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1;
      if (css[end] === '}') depth -= 1;
      if (depth === 0) break;
    }
    blocks.push(css.slice(open + 1, end));
  }
  assert.ok(blocks.length > 0, 'missing reduced-motion block');
  return blocks.join('\n');
}

describe('StatusDot', () => {
  let StatusDot: ElementType;

  before(async () => {
    StatusDot = await loadUiExport('Status.tsx', 'StatusDot');
  });

  const dot = (props: StatusDotProps) => render(createElement(StatusDot, props));

  test('derives its text and tone from the status exactly as before', () => {
    const html = dot({ status: 'pending_review' });
    const [root, mark] = tagsOf(html, 'span');
    assert.deepEqual(classesOf(root), ['statusDot', 'toneWarning']);
    assert.equal('style' in root, false);
    assert.deepEqual(classesOf(mark), ['dot']);
    assert.equal(mark['aria-hidden'], 'true');
    assert.equal(textOf(html), 'pending review');
  });

  test('label replaces the text while the tone still comes from the status', () => {
    const html = dot({ status: 'dispute_resolved', label: 'Dispute closed' });
    assert.deepEqual(classesOf(tagsOf(html, 'span')[0]), ['statusDot', 'toneDanger', 'statusDotCustom']);
    assert.equal(textOf(html), 'Dispute closed');
  });

  test('an explicit tone wins over the status, with or without a label', () => {
    assert.deepEqual(classesOf(tagsOf(dot({ status: 'Active', tone: 'neutral' }), 'span')[0]), ['statusDot', 'toneNeutral']);
    const custom = dot({ status: 'approved', tone: 'info', label: createElement('b', null, 'Credited') });
    assert.deepEqual(classesOf(tagsOf(custom, 'span')[0]), ['statusDot', 'toneInfo', 'statusDotCustom']);
    assert.match(custom, /<b>Credited<\/b>/);
  });

  test('an empty label falls back to the status text', () => {
    for (const label of [undefined, null, false, ''] as ReactNode[]) {
      const html = dot({ status: 'resume_failed', label });
      assert.equal(textOf(html), 'resume failed', String(label));
      assert.deepEqual(classesOf(tagsOf(html, 'span')[0]), ['statusDot', 'toneDanger']);
    }
  });

  test('every tone has its own class and an unknown tone falls back to neutral', () => {
    const tones: Tone[] = ['success', 'warning', 'danger', 'purple', 'info', 'neutral'];
    const expected = ['toneSuccess', 'toneWarning', 'toneDanger', 'tonePurple', 'toneInfo', 'toneNeutral'];
    tones.forEach((tone, index) => {
      assert.equal(classesOf(tagsOf(dot({ status: 'x', tone }), 'span')[0])[1], expected[index]);
    });
    const stray = dot({ status: 'x', tone: 'loud' as Tone });
    assert.deepEqual(classesOf(tagsOf(stray, 'span')[0]), ['statusDot', 'toneNeutral']);
  });

  test('className merges after the kit classes', () => {
    assert.deepEqual(
      classesOf(tagsOf(dot({ status: 'failed', className: 'mine' }), 'span')[0]),
      ['statusDot', 'toneDanger', 'mine'],
    );
  });

  test('tone colours come from tokens, and only status text is capitalised', () => {
    const css = uiText('Status.module.css');
    assert.match(ruleBody(css, '.toneSuccess'), /color: var\(--tone-success-fg\)/);
    assert.match(ruleBody(css, '.toneNeutral'), /color: var\(--fg-secondary\)/);
    assert.match(ruleBody(css, '.statusDot'), /text-transform: capitalize/);
    assert.match(ruleBody(css, '.statusDotCustom'), /text-transform: none/);
  });
});

describe('StatStrip and StatCell', () => {
  let StatStrip: ElementType;
  let StatCell: ElementType;

  before(async () => {
    StatStrip = await loadUiExport('Status.tsx', 'StatStrip');
    StatCell = await loadUiExport('Status.tsx', 'StatCell');
  });

  const strip = (props: StatStripProps) => render(createElement(StatStrip, props));
  const cell = (item: StatCellProps) => render(createElement(StatCell, item));

  test('existing string items still render, now as a real list', () => {
    const html = strip({
      items: [
        { label: 'Matching', value: '1,204' },
        { label: 'Payout value', value: '₦5,000.00', mono: true },
      ],
    });
    assert.deepEqual(classesOf(tagsOf(html, 'div')[0]), ['statStrip']);
    const [list] = tagsOf(html, 'ul');
    assert.deepEqual(classesOf(list), ['statList']);
    assert.equal(list.role, 'list');
    assert.deepEqual(tagsOf(html, 'li').map(classesOf), [['statItem'], ['statItem']]);
    assert.deepEqual(withClass(html, 'div', 'statCell').map(classesOf), [['statCell'], ['statCell']]);
    const values = withClass(html, 'span', 'statValue');
    assert.deepEqual(values.map(classesOf), [['statValue'], ['statValue', 'mono']]);
    assert.equal(textOf(html), 'Matching 1,204 Payout value ₦5,000.00');
    assert.equal(tagsOf(html, 'a').length, 0);
    assert.equal(withClass(html, 'span', 'statHint').length, 0);
  });

  test('a value can be any React node', () => {
    const html = cell({ label: 'Payout', value: createElement('strong', { className: 'money' }, '₦1.00') });
    assert.match(html, /<span class="statValue"><strong class="money">₦1\.00<\/strong><\/span>/);
  });

  test('href turns the whole cell into a link', () => {
    const html = cell({ label: 'Pending', value: '12', href: '/withdrawals?tab=pending_review', hint: 'In review' });
    const [link] = tagsOf(html, 'a');
    assert.equal(link.href, '/withdrawals?tab=pending_review');
    assert.deepEqual(classesOf(link), ['statCell', 'statCellLink']);
    assert.equal(textOf(html), 'Pending 12 In review');
    assert.equal(tagsOf(html, 'div').length, 0);
  });

  test('hint renders as a secondary line under the value', () => {
    const html = cell({ label: 'Volume', value: '₦9.00', hint: 'Successful transactions' });
    assert.match(html, /<span class="statHint">Successful transactions<\/span><\/div>$/);
  });

  test('unavailable reads Unavailable with the default hint and never links', () => {
    const html = cell({ label: 'Wallet liability', value: '₦0.00', hint: 'Sum of all wallets', href: '/x', unavailable: true });
    assert.equal(tagsOf(html, 'a').length, 0);
    assert.match(html, /<span class="statValue"><span class="statUnavailable">Unavailable<\/span><\/span>/);
    assert.match(html, /<span class="statHint">This metric could not be loaded\.<\/span>/);
    assert.doesNotMatch(html, /₦0\.00|Sum of all wallets/);
  });

  test('unavailableHint replaces the default, and mono and tone stay off the word Unavailable', () => {
    const html = cell({
      label: 'Frozen', value: '3', unavailable: true, unavailableHint: 'Refresh to try again.', mono: true, tone: 'danger',
    });
    assert.deepEqual(classesOf(withClass(html, 'span', 'statValue')[0]), ['statValue']);
    assert.match(html, /<span class="statHint">Refresh to try again\.<\/span>/);
  });

  test('loading shows an inline skeleton sized by loadingWidth, keeps the hint and drops the link', () => {
    const html = cell({
      label: 'Payouts settled', value: '', hint: 'Successful withdrawals', href: '/withdrawals', loading: true, loadingWidth: '7em',
    });
    assert.equal(tagsOf(html, 'a').length, 0);
    const [skeleton] = tagsOf(html, 'span').filter((attrs) => classesOf(attrs).includes('skeleton'));
    assert.deepEqual(classesOf(skeleton), ['skeleton', 'skeletonInline']);
    assert.equal(skeleton.style, 'width:7em');
    assert.equal(skeleton['aria-hidden'], 'true');
    assert.match(html, /<span class="statHint">Successful withdrawals<\/span>/);
    assert.doesNotMatch(html, /<div aria-hidden/);
  });

  test('loading has a default width and wins over unavailable', () => {
    const html = cell({ label: 'Users', value: '9', loading: true, unavailable: true });
    const [skeleton] = tagsOf(html, 'span').filter((attrs) => classesOf(attrs).includes('skeleton'));
    assert.equal(skeleton.style, 'width:4em');
    assert.doesNotMatch(html, /Unavailable|could not be loaded/);
  });

  test('tone tints the value, neutral adds nothing', () => {
    const tones: Array<[StatTone | undefined, string[]]> = [
      [undefined, ['statValue']],
      ['neutral', ['statValue']],
      ['warning', ['statValue', 'statValueWarning']],
      ['danger', ['statValue', 'statValueDanger']],
    ];
    for (const [tone, expected] of tones) {
      assert.deepEqual(classesOf(withClass(cell({ label: 'Frozen', value: '3', tone }), 'span', 'statValue')[0]), expected);
    }
  });

  test('fill and flush add layout classes; className and attributes reach the frame', () => {
    const html = strip({
      items: [{ label: 'A', value: '1' }],
      fill: true,
      flush: true,
      className: 'mine',
      id: 'today',
      'aria-busy': true,
    });
    const [frame] = tagsOf(html, 'div');
    assert.deepEqual(classesOf(frame), ['statStrip', 'statStripFill', 'statStripFlush', 'mine']);
    assert.equal(frame.id, 'today');
    assert.equal(frame['aria-busy'], 'true');
  });

  test('an accessible name goes on the list, never on the generic frame', () => {
    const html = strip({ items: [{ label: 'A', value: '1' }], 'aria-label': 'Today', 'aria-labelledby': 'overview-today' });
    const [frame] = tagsOf(html, 'div');
    const [list] = tagsOf(html, 'ul');
    assert.equal('aria-label' in frame, false);
    assert.equal('aria-labelledby' in frame, false);
    assert.equal(list['aria-label'], 'Today');
    assert.equal(list['aria-labelledby'], 'overview-today');
    assert.equal('aria-label' in tagsOf(strip({ items: [] }), 'ul')[0], false);
  });

  test('can stand in for the dashboard MetricStrip cell by cell', () => {
    const items: StatItem[] = [
      { label: 'Cards submitted', value: '1,204', hint: 'Any status', href: '/card-queue' },
      { label: 'Payouts settled', value: '', hint: 'Successful withdrawals', loading: true, loadingWidth: '7em' },
      { label: 'Transactions', value: '', hint: 'All types', href: '/transactions-overview', unavailable: true },
    ];
    const html = strip({ items, fill: true, flush: true });
    const cells = tagsOf(html, 'li');
    assert.equal(cells.length, 3);
    assert.deepEqual(tagsOf(html, 'a').map((attrs) => attrs.href), ['/card-queue']);
    assert.equal(withClass(html, 'span', 'statLabel').length, 3);
    assert.equal(withClass(html, 'span', 'statHint').length, 3);
  });

  test('StatCell renders standalone and still accepts last', () => {
    const html = cell({ label: 'Days', value: '4', last: true, className: 'mine' });
    assert.deepEqual(classesOf(tagsOf(html, 'div')[0]), ['statCell', 'mine']);
  });

  test('separators survive wrapping and mobile, labels are mono uppercase, values tabular', () => {
    const css = uiText('Status.module.css');
    assert.match(ruleBody(css, '.statList'), /margin: 0 0 -1px -1px/);
    assert.match(ruleBody(css, '.statItem'), /border-left: 1px solid var\(--border-subtle\)/);
    assert.match(ruleBody(css, '.statStripFill .statItem'), /flex: 1 1 0;[\s\S]*border-bottom: 1px solid var\(--border-subtle\)/);
    assert.match(ruleBody(css, '.statStrip .statItem'), /flex: 1 1 50%/);
    assert.match(ruleBody(css, '.statStrip'), /overflow: hidden/);
    const label = ruleBody(css, '.statLabel');
    assert.match(label, /font-family: var\(--font-mono\)/);
    assert.match(label, /text-transform: uppercase/);
    assert.match(label, /letter-spacing: var\(--tracking-label\)/);
    assert.match(ruleBody(css, '.statValue'), /font-variant-numeric: tabular-nums/);
    assert.match(ruleBody(css, '.statStripFlush'), /margin-bottom: 0/);
  });

  test('the linked cell has an inset focus ring that the clipped frame cannot hide', () => {
    const css = uiText('Status.module.css');
    const focus = ruleBody(css, '.statCellLink:focus-visible');
    assert.match(focus, /outline: 2px solid var\(--accent-base\)/);
    assert.match(focus, /outline-offset: -2px/);
    assert.match(ruleBody(reducedMotion(css), '.statCellLink'), /transition: none/);
  });
});

describe('SectionLabel', () => {
  let SectionLabel: ElementType;

  before(async () => {
    SectionLabel = await loadUiExport('Status.tsx', 'SectionLabel');
  });

  const label = (props: Omit<SectionLabelProps, 'children'>, children: ReactNode = 'Payout') =>
    render(createElement(SectionLabel, props, children));

  test('defaults to a paragraph and keeps the style prop', () => {
    assert.equal(label({}), '<p class="sectionLabel">Payout</p>');
    assert.equal(label({ style: { marginTop: 4 } }), '<p class="sectionLabel" style="margin-top:4px">Payout</p>');
  });

  test('as renders a heading or a div', () => {
    const elements: SectionLabelElement[] = ['p', 'h2', 'h3', 'h4', 'div'];
    for (const element of elements) {
      assert.equal(label({ as: element }), `<${element} class="sectionLabel">Payout</${element}>`);
    }
  });

  test('id, flush and className let a band heading drop its wrapper and margin override', () => {
    assert.equal(
      label({ as: 'h2', id: 'overview-today', flush: true, className: 'band' }, 'Today'),
      '<h2 id="overview-today" class="sectionLabel sectionLabelFlush band">Today</h2>',
    );
    assert.match(ruleBody(uiText('Status.module.css'), '.sectionLabelFlush'), /margin-bottom: 0/);
  });
});

describe('Skeleton and SkeletonLines', () => {
  let Skeleton: ElementType;
  let SkeletonLines: ElementType;

  before(async () => {
    Skeleton = await loadUiExport('Misc.tsx', 'Skeleton');
    SkeletonLines = await loadUiExport('Misc.tsx', 'SkeletonLines');
  });

  const skeleton = (props: SkeletonProps) => render(createElement(Skeleton, props));
  const lines = (props: SkeletonLinesProps) => render(createElement(SkeletonLines, props));

  test('the block skeleton renders exactly as before', () => {
    assert.equal(skeleton({ width: 120 }), '<div aria-hidden="true" class="skeleton" style="width:120px;height:14px"></div>');
    assert.equal(
      skeleton({ width: '50%', height: 28, rounded: true, className: 'mine', id: 'x' }),
      '<div aria-hidden="true" class="skeleton mine" style="width:50%;height:28px;border-radius:var(--radius-pill)" id="x"></div>',
    );
  });

  test('inline renders a span without a fixed height so CSS sizes it to the text line', () => {
    assert.equal(
      skeleton({ inline: true, width: '7em' }),
      '<span aria-hidden="true" class="skeleton skeletonInline" style="width:7em"></span>',
    );
    assert.equal(
      skeleton({ inline: true, width: 32, height: 32, rounded: true }),
      '<span aria-hidden="true" class="skeleton skeletonInline" style="width:32px;height:32px;border-radius:var(--radius-pill)"></span>',
    );
  });

  test('the inline class sits on the line box and honours reduced motion through .skeleton', () => {
    const css = uiText('Misc.module.css');
    const inline = ruleBody(css, '.skeletonInline');
    assert.match(inline, /display: inline-block/);
    assert.match(inline, /height: 0\.75em/);
    assert.match(inline, /vertical-align: middle/);
    assert.match(inline, /max-width: 100%/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.skeleton \{\s*animation: none;/);
  });

  test('SkeletonLines keeps its layout in CSS, not inline styles', () => {
    const html = lines({});
    const [root] = tagsOf(html, 'div');
    assert.deepEqual(classesOf(root), ['skeletonLines']);
    assert.equal('style' in root, false);
    assert.equal(withClass(html, 'div', 'skeleton').length, 3);
    assert.doesNotMatch(html, /display:flex|flex-direction/);
    const rule = ruleBody(uiText('Misc.module.css'), '.skeletonLines');
    assert.match(rule, /display: flex/);
    assert.match(rule, /flex-direction: column/);
    assert.match(rule, /gap: var\(--skeleton-lines-gap, 10px\)/);
  });

  test('the gap prop still works through a custom property', () => {
    const html = lines({ rows: 2, gap: 6, height: 12 });
    assert.equal(tagsOf(html, 'div')[0].style, '--skeleton-lines-gap:6px');
    const rows = withClass(html, 'div', 'skeleton');
    assert.deepEqual(rows.map((attrs) => attrs.style), ['width:82%;height:12px', 'width:64%;height:12px']);
  });
});

describe('EmptyState variant', () => {
  let EmptyState: ElementType;

  before(async () => {
    EmptyState = await loadUiExport('Misc.tsx', 'EmptyState');
  });

  const empty = (props: EmptyStateProps) => render(createElement(EmptyState, props));

  test('card is the default and keeps the exact markup', () => {
    assert.equal(empty({ title: 'No templates', className: 'extra' }), '<div class="empty extra"><div class="emptyTitle">No templates</div></div>');
    assert.equal(empty({ title: 'No templates', variant: 'card' }), '<div class="empty"><div class="emptyTitle">No templates</div></div>');
  });

  test('plain drops the card chrome with one class', () => {
    const variant: EmptyStateVariant = 'plain';
    assert.equal(
      empty({ title: 'No submissions', variant, className: 'mine' }),
      '<div class="empty emptyPlain mine"><div class="emptyTitle">No submissions</div></div>',
    );
    const rule = ruleBody(uiText('Misc.module.css'), '.emptyPlain');
    assert.match(rule, /background: none/);
    assert.match(rule, /border: 0/);
    assert.match(rule, /border-radius: 0/);
  });
});

describe('Kpi tone and hintTone', () => {
  let Kpi: ElementType;

  before(async () => {
    Kpi = await loadUiExport('Misc.tsx', 'Kpi');
  });

  const kpi = (props: KpiProps) => render(createElement(Kpi, props));

  test('without a tone the tile classes are unchanged', () => {
    assert.deepEqual(classesOf(tagsOf(kpi({ label: 'Users', value: '9' }), 'div')[0]), ['kpi']);
    assert.deepEqual(classesOf(tagsOf(kpi({ label: 'Users', value: '9', href: '/users' }), 'a')[0]), ['kpi', 'kpiLink']);
    assert.deepEqual(classesOf(tagsOf(kpi({ label: 'Users', value: '9', tone: 'neutral', className: 'x' }), 'div')[0]), ['kpi', 'x']);
  });

  test('tone marks the tile, linked or not', () => {
    const tones: Array<[KpiTone, string]> = [['warning', 'kpiWarning'], ['danger', 'kpiDanger']];
    for (const [tone, expected] of tones) {
      assert.deepEqual(classesOf(tagsOf(kpi({ label: 'Pending', value: '4', tone }), 'div')[0]), ['kpi', expected]);
      const linked = kpi({ label: 'Pending', value: '4', tone, href: '/card-queue', className: 'mine' });
      assert.deepEqual(classesOf(tagsOf(linked, 'a')[0]), ['kpi', 'kpiLink', expected, 'mine']);
    }
  });

  test('the icon sits in a hidden wrapper the tone can tint', () => {
    const html = kpi({ label: 'Pending', value: '4', icon: createElement('svg', { id: 'i' }), tone: 'warning' });
    assert.match(html, /<div class="kpiLabel"><span class="kpiIcon" aria-hidden="true"><svg id="i"><\/svg><\/span><span>Pending<\/span><\/div>/);
    assert.equal(withClass(kpi({ label: 'Pending', value: '4' }), 'span', 'kpiIcon').length, 0);
  });

  test('hintTone colours the hint and nothing else', () => {
    const tones: Array<[KpiHintTone, string[]]> = [
      ['neutral', ['kpiHint']],
      ['success', ['kpiHint', 'kpiHintSuccess']],
      ['warning', ['kpiHint', 'kpiHintWarning']],
      ['danger', ['kpiHint', 'kpiHintDanger']],
    ];
    for (const [hintTone, expected] of tones) {
      const html = kpi({ label: 'Withdrawals', value: '12', hint: '2 awaiting review', hintTone });
      assert.deepEqual(classesOf(withClass(html, 'div', 'kpiHint')[0]), expected);
      assert.deepEqual(classesOf(tagsOf(html, 'div')[0]), ['kpi']);
    }
  });

  test('unavailable keeps its neutral hint and never links; delta still wins over hint', () => {
    const missing = kpi({ label: 'Trades', value: '3', href: '/t', unavailable: true, hint: 'x', hintTone: 'warning', tone: 'danger' });
    assert.equal(tagsOf(missing, 'a').length, 0);
    assert.deepEqual(classesOf(withClass(missing, 'div', 'kpiHint')[0]), ['kpiHint']);
    assert.match(missing, /This metric could not be loaded\./);
    assert.deepEqual(classesOf(tagsOf(missing, 'div')[0]), ['kpi', 'kpiDanger']);
    const delta = kpi({ label: 'Volume', value: '₦1', hint: 'hidden', hintTone: 'danger', delta: { value: '+4%', direction: 'up' } });
    assert.match(delta, /class="kpiDelta up">\+4%</);
    assert.doesNotMatch(delta, /hidden/);
  });

  test('tone CSS tints the border, the hover border and the icon from tokens', () => {
    const css = uiText('Misc.module.css');
    assert.match(ruleBody(css, '.kpiWarning'), /border-color: var\(--tone-warning-border\)/);
    assert.match(ruleBody(css, '.kpiWarning.kpiLink:hover'), /border-color: var\(--tone-warning-fg\)/);
    assert.match(ruleBody(css, '.kpiWarning .kpiIcon'), /color: var\(--tone-warning-fg\)/);
    assert.match(ruleBody(css, '.kpiDanger'), /border-color: var\(--tone-danger-border\)/);
    assert.match(ruleBody(css, '.kpiDanger.kpiLink:hover'), /border-color: var\(--tone-danger-fg\)/);
    assert.match(ruleBody(css, '.kpiDanger .kpiIcon'), /color: var\(--tone-danger-fg\)/);
    assert.match(ruleBody(css, '.kpiHintWarning'), /color: var\(--tone-warning-fg\)/);
    assert.ok(css.indexOf('.kpiWarning {') > css.indexOf('.kpi {'), 'tone border must follow the base border');
  });
});

describe('PageHeaderSkeleton', () => {
  let PageHeaderSkeleton: ElementType;

  before(async () => {
    PageHeaderSkeleton = await loadUiExport('Misc.tsx', 'PageHeaderSkeleton');
  });

  const header = (props: PageHeaderSkeletonProps) => render(createElement(PageHeaderSkeleton, props));
  const inlineBars = (html: string) => tagsOf(html, 'span').filter((attrs) => classesOf(attrs).includes('skeletonInline'));

  test('mirrors the PageHeader frame, title line and subtitle line', () => {
    const html = header({});
    const divs = tagsOf(html, 'div');
    assert.deepEqual(classesOf(divs[0]), ['pageHeader']);
    assert.deepEqual(classesOf(divs[1]), ['pageHeaderTitles']);
    assert.equal(divs[1]['aria-hidden'], 'true');
    assert.deepEqual(classesOf(divs[2]), ['pageTitle']);
    assert.deepEqual(classesOf(divs[3]), ['pageSubtitle']);
    assert.deepEqual(inlineBars(html).map((attrs) => attrs.style), ['width:10em', 'width:20em']);
    assert.equal(withClass(html, 'div', 'pageHeaderActions').length, 0);
    assert.doesNotMatch(html, /role="status"/);
    assert.equal(tagsOf(html, 'h1').length, 0);
  });

  test('actions take a count or explicit widths, sized like small buttons by default', () => {
    const counted = header({ actions: 2 });
    const [group] = withClass(counted, 'div', 'pageHeaderActions');
    assert.equal(group['aria-hidden'], 'true');
    assert.deepEqual(
      withClass(counted, 'div', 'pageHeaderAction').map((attrs) => attrs.style),
      ['width:88px;height:28px', 'width:88px;height:28px'],
    );
    const sized = header({ actions: [86, '8rem'] });
    assert.deepEqual(
      withClass(sized, 'div', 'pageHeaderAction').map((attrs) => attrs.style),
      ['width:86px;height:28px', 'width:8rem;height:28px'],
    );
  });

  test('actionSize matches the Button heights', () => {
    const heights: Array<[ButtonSize, string]> = [['sm', '28px'], ['md', '34px'], ['lg', '40px']];
    for (const [actionSize, height] of heights) {
      const [action] = withClass(header({ actions: 1, actionSize }), 'div', 'pageHeaderAction');
      assert.equal(action.style, `width:88px;height:${height}`);
    }
  });

  test('impossible action counts render no action group', () => {
    for (const actions of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, []]) {
      assert.equal(withClass(header({ actions }), 'div', 'pageHeaderActions').length, 0, String(actions));
    }
  });

  test('avatar adds a round placeholder before the title bar', () => {
    const html = header({ avatar: true, titleWidth: 220, subtitle: false });
    const bars = inlineBars(html);
    assert.equal(bars.length, 2);
    assert.deepEqual(classesOf(bars[0]), ['skeleton', 'skeletonInline', 'pageHeaderAvatar']);
    assert.equal(bars[0].style, 'width:var(--space-8);height:var(--space-8);border-radius:var(--radius-pill)');
    assert.equal(bars[1].style, 'width:220px');
    assert.equal(withClass(html, 'div', 'pageSubtitle').length, 0);
  });

  test('label adds one status message outside the hidden skeleton', () => {
    const html = header({ label: 'Loading user', className: 'mine' });
    assert.deepEqual(classesOf(tagsOf(html, 'div')[0]), ['pageHeader', 'mine']);
    assert.match(html, /^<div class="pageHeader mine"><span class="srOnly" role="status">Loading user<\/span><div class="pageHeaderTitles" aria-hidden="true">/);
    assert.equal(html.match(/role="status"/g)?.length, 1);
  });
});

describe('LinkButton', () => {
  let LinkButton: ElementType;
  let Button: ElementType;

  before(async () => {
    LinkButton = await loadUiExport('LinkButton.tsx', 'LinkButton');
    Button = await loadUiExport('Button.tsx', 'Button');
  });

  const link = (props: LinkButtonProps, children: ReactNode = 'Open') => render(createElement(LinkButton, props, children));
  const button = (props: ButtonProps, children: ReactNode = 'Open') => render(createElement(Button, props, children));

  test('uses exactly the Button classes for every variant and size, plus the link reset', () => {
    const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'dangerSubtle', 'success'];
    const sizes: ButtonSize[] = ['sm', 'md', 'lg'];
    for (const variant of variants) {
      for (const size of sizes) {
        const expected = classesOf(tagsOf(button({ variant, size }), 'button')[0]);
        const actual = classesOf(tagsOf(link({ href: '/users', variant, size }), 'a')[0]);
        assert.deepEqual(actual, [...expected, 'link'], `${variant} ${size}`);
        const square = classesOf(tagsOf(button({ variant, size, iconOnly: true, 'aria-label': 'x' }), 'button')[0]);
        const squareLink = classesOf(tagsOf(link({ href: '/users', variant, size, iconOnly: true, 'aria-label': 'x' }), 'a')[0]);
        assert.deepEqual(squareLink, [...square, 'link'], `${variant} ${size} icon`);
      }
    }
  });

  test('defaults to a secondary medium link to the href', () => {
    const html = link({ href: '/users' }, 'Back to users');
    assert.equal(html, '<a class="btn secondary md link" href="/users">Back to users</a>');
  });

  test('icons use the shared icon slot on both sides', () => {
    const html = link({ href: '/x', leftIcon: createElement('i', { id: 'l' }), rightIcon: createElement('i', { id: 'r' }) });
    assert.match(html, /^<a[^>]*><span class="icon"><i id="l"><\/i><\/span>Open<span class="icon"><i id="r"><\/i><\/span><\/a>$/);
  });

  test('iconOnly keeps the required name and drops the children', () => {
    const html = link({ href: '/users/1', iconOnly: true, 'aria-label': 'Open user', size: 'sm', leftIcon: createElement('i') });
    const [anchor] = tagsOf(html, 'a');
    assert.equal(anchor['aria-label'], 'Open user');
    assert.deepEqual(classesOf(anchor), ['btn', 'secondary', 'iconSm', 'link']);
    assert.doesNotMatch(html, /Open<|>Open/);
  });

  test('prefetch, replace and scroll go to next/link instead of the DOM', () => {
    const html = link({ href: '/users', prefetch: false, replace: true, scroll: false });
    const [anchor] = tagsOf(html, 'a');
    assert.deepEqual(Object.keys(anchor).sort(), ['class', 'href']);
  });

  test('anchor attributes and className pass through', () => {
    const html = link({ href: '/users', className: 'mine', title: 'All users', 'aria-current': 'page' });
    const [anchor] = tagsOf(html, 'a');
    assert.equal(anchor.title, 'All users');
    assert.equal(anchor['aria-current'], 'page');
    assert.deepEqual(classesOf(anchor), ['btn', 'secondary', 'md', 'link', 'mine']);
  });

  test('external renders a plain new-tab anchor with a spoken hint', () => {
    const html = link({ href: 'https://status.example.com', external: true, prefetch: false }, 'Provider status');
    const [anchor] = tagsOf(html, 'a');
    assert.equal(anchor.target, '_blank');
    assert.equal(anchor.rel, 'noopener noreferrer');
    assert.equal(anchor.href, 'https://status.example.com');
    assert.equal('prefetch' in anchor, false);
    assert.match(html, /Provider status<span class="srOnly"> \(opens in a new tab\)<\/span><\/a>$/);
    assert.equal(textOf(html), 'Provider status (opens in a new tab)');
  });

  test('external keeps its rel and target even if the caller passes others', () => {
    const [anchor] = tagsOf(link({ href: 'https://x.test', external: true, target: '_self', rel: 'opener' }), 'a');
    assert.equal(anchor.target, '_blank');
    assert.equal(anchor.rel, 'noopener noreferrer');
  });

  test('a caller-provided name is never doubled with the new-tab hint', () => {
    const named = link({ href: 'https://x.test', external: true, 'aria-label': 'Docs, opens in a new tab' }, 'Docs');
    assert.doesNotMatch(named, /srOnly/);
    const icon = link({ href: 'https://x.test', external: true, iconOnly: true, 'aria-label': 'Docs', leftIcon: createElement('i') });
    assert.doesNotMatch(icon, /srOnly/);
  });

  test('forwards refs like Button', () => {
    const forwardRef = Symbol.for('react.forward_ref');
    assert.equal((LinkButton as unknown as { $$typeof: symbol }).$$typeof, forwardRef);
    assert.equal((Button as unknown as { $$typeof: symbol }).$$typeof, forwardRef);
  });

  test('the shared stylesheet resets link underlines and keeps a visible focus ring', () => {
    const css = uiText('Button.module.css');
    assert.match(css, /\.link,\s*\.link:hover\s*\{\s*text-decoration: none;/);
    assert.match(ruleBody(css, '.link'), /vertical-align: middle/);
    assert.match(ruleBody(css, '.btn:focus-visible'), /outline: 2px solid var\(--accent-base\)/);
    assert.match(ruleBody(css, '.srOnly'), /clip-path: inset\(50%\)/);
  });
});

describe('Button', () => {
  let Button: ElementType;

  before(async () => {
    Button = await loadUiExport('Button.tsx', 'Button');
  });

  test('renders exactly as before', () => {
    assert.equal(
      render(createElement(Button, { variant: 'primary', size: 'sm', leftIcon: createElement('i') }, 'Save')),
      '<button class="btn primary sm"><span class="icon"><i></i></span>Save</button>',
    );
    assert.equal(
      render(createElement(Button, { loading: true }, 'Save')),
      '<button class="btn secondary md" disabled="" aria-busy="true"><span class="spinner" aria-hidden="true"></span>Save</button>',
    );
    assert.equal(
      render(createElement(Button, { iconOnly: true, variant: 'ghost', 'aria-label': 'Close', leftIcon: createElement('i') }, 'hidden')),
      '<button class="btn ghost iconMd" aria-label="Close"><span class="icon"><i></i></span></button>',
    );
  });

  test('ButtonProps carries no blank lines left from deleted comments', () => {
    const body = uiText('Button.tsx').match(/export interface ButtonProps[^{]*\{([\s\S]*?)\n\}/);
    assert.ok(body);
    assert.doesNotMatch(body[1], /\n[ \t]*\n/);
  });

  test('icon-only sizes are square, so the hit area meets the 24px target minimum', () => {
    const css = uiText('Button.module.css');
    assert.match(ruleBody(css, '.iconSm'), /width: 28px; height: 28px;/);
    assert.match(ruleBody(css, '.iconMd'), /width: 34px; height: 34px;/);
    assert.match(ruleBody(css, '.iconLg'), /width: 40px; height: 40px;/);
    const motion = reducedMotion(css);
    assert.match(ruleBody(motion, '.btn'), /transition: none/);
    assert.match(ruleBody(motion, '.spinner'), /animation-duration/);
  });
});

describe('toast timing', () => {
  let toastDuration: (tone: ToastTone) => number;
  let toastPoliteness: (tone: ToastTone) => ToastPoliteness;
  let startPausableTimer: (onExpire: () => void, ms: number) => PausableTimer;
  let toastHoverAfter: (current: number | null, id: number, event: ToastHoverEvent) => number | null;
  let toastFocusTarget: <T>(closers: readonly T[], origin: T, fallback: T | null) => T | null;

  before(async () => {
    const mod = await loadUi<{
      toastDuration: typeof toastDuration;
      toastPoliteness: typeof toastPoliteness;
      startPausableTimer: typeof startPausableTimer;
      toastHoverAfter: typeof toastHoverAfter;
      toastFocusTarget: typeof toastFocusTarget;
    }>('Misc.tsx');
    toastDuration = mod.toastDuration;
    toastPoliteness = mod.toastPoliteness;
    startPausableTimer = mod.startPausableTimer;
    toastHoverAfter = mod.toastHoverAfter;
    toastFocusTarget = mod.toastFocusTarget;
  });

  afterEach(() => {
    mock.timers.reset();
  });

  const fakeClock = () => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });

  test('errors and warnings stay about 8 seconds, everything else 3.5 seconds', () => {
    assert.equal(toastDuration('error'), 8000);
    assert.equal(toastDuration('warning'), 8000);
    assert.equal(toastDuration('success'), 3500);
    assert.equal(toastDuration('default'), 3500);
    assert.equal(toastDuration('loud' as ToastTone), 3500);
  });

  test('only errors interrupt the screen reader', () => {
    assert.equal(toastPoliteness('error'), 'assertive');
    for (const tone of ['default', 'success', 'warning'] as ToastTone[]) assert.equal(toastPoliteness(tone), 'polite', tone);
  });

  test('a timer fires once, after its full duration', () => {
    fakeClock();
    let fired = 0;
    startPausableTimer(() => { fired += 1; }, 8000);
    mock.timers.tick(7999);
    assert.equal(fired, 0);
    mock.timers.tick(1);
    assert.equal(fired, 1);
    mock.timers.tick(60000);
    assert.equal(fired, 1);
  });

  test('pause stops the clock and resume continues with only the time that was left', () => {
    fakeClock();
    let fired = 0;
    const timer = startPausableTimer(() => { fired += 1; }, 8000);
    mock.timers.tick(3000);
    timer.pause();
    mock.timers.tick(120000);
    assert.equal(fired, 0);
    timer.resume();
    mock.timers.tick(4999);
    assert.equal(fired, 0);
    mock.timers.tick(1);
    assert.equal(fired, 1);
  });

  test('repeated pause and resume calls do not lose or add time', () => {
    fakeClock();
    let fired = 0;
    const timer = startPausableTimer(() => { fired += 1; }, 3500);
    mock.timers.tick(1000);
    timer.pause();
    timer.pause();
    mock.timers.tick(5000);
    timer.resume();
    timer.resume();
    mock.timers.tick(1000);
    timer.pause();
    mock.timers.tick(5000);
    timer.resume();
    mock.timers.tick(1499);
    assert.equal(fired, 0);
    mock.timers.tick(1);
    assert.equal(fired, 1);
  });

  test('hover belongs to one toast and is released when that toast leaves or is dismissed', () => {
    assert.equal(toastHoverAfter(null, 3, 'enter'), 3);
    assert.equal(toastHoverAfter(3, 4, 'enter'), 4);
    assert.equal(toastHoverAfter(4, 3, 'leave'), 4);
    assert.equal(toastHoverAfter(4, 4, 'leave'), null);
    assert.equal(toastHoverAfter(4, 4, 'dismiss'), null);
    assert.equal(toastHoverAfter(4, 7, 'dismiss'), 4);
    assert.equal(toastHoverAfter(null, 7, 'dismiss'), null);
  });

  test('keyboard dismissal moves focus to the next toast, then the previous, then back to the page', () => {
    const page = { name: 'page' };
    const [a, b, c] = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    assert.equal(toastFocusTarget([a, b, c], a, page), b);
    assert.equal(toastFocusTarget([a, b, c], c, page), b);
    assert.equal(toastFocusTarget([a], a, page), page);
    assert.equal(toastFocusTarget([a], a, null), null);
    assert.equal(toastFocusTarget([a, b], c, page), page);
  });

  test('cancel stops the timer for good, and calls after expiry are harmless', () => {
    fakeClock();
    let fired = 0;
    const cancelled = startPausableTimer(() => { fired += 1; }, 1000);
    cancelled.cancel();
    cancelled.resume();
    mock.timers.tick(5000);
    assert.equal(fired, 0);
    const done = startPausableTimer(() => { fired += 1; }, 1000);
    mock.timers.tick(1000);
    done.pause();
    done.resume();
    done.cancel();
    mock.timers.tick(5000);
    assert.equal(fired, 1);
  });
});

describe('ToastProvider', () => {
  let ToastProvider: ElementType;
  let ToastCard: ElementType;
  let useToast: () => { show: (text: string, tone?: ToastTone) => void };

  before(async () => {
    const mod = await loadUi<{ ToastProvider: ElementType; ToastCard: ElementType; useToast: typeof useToast }>('Misc.tsx');
    ToastProvider = mod.ToastProvider;
    ToastCard = mod.ToastCard;
    useToast = mod.useToast;
  });

  const card = (props: Partial<ToastCardProps>) =>
    render(createElement(ToastCard, { id: 1, tone: 'default', text: 'Saved.', paused: false, onDismiss: () => {}, ...props }));

  test('renders one polite and one assertive live region before any toast exists', () => {
    const html = render(createElement(ToastProvider, null, createElement('main', null, 'page')));
    assert.match(html, /^<main>page<\/main><div class="toastWrap">/);
    const stacks = withClass(html, 'div', 'toastStack');
    assert.deepEqual(stacks.map((attrs) => attrs['aria-live']), ['polite', 'assertive']);
    assert.doesNotMatch(html, /role="(?:alert|status|log)"|aria-atomic/);
  });

  test('a toast is its text plus a named dismiss button, with no live role of its own', () => {
    const html = card({ tone: 'error', text: 'Payout failed. Do not retry.' });
    const [root] = tagsOf(html, 'div');
    assert.deepEqual(classesOf(root), ['toast', 'toastError']);
    assert.match(html, /<span class="toastText">Payout failed\. Do not retry\.<\/span>/);
    const [close] = tagsOf(html, 'button');
    assert.equal(close.type, 'button');
    assert.equal(close['aria-label'], 'Dismiss notification');
    assert.deepEqual(classesOf(close), ['toastClose']);
    assert.ok('data-toast-close' in close);
    const [icon] = tagsOf(html, 'svg');
    assert.equal(icon['aria-hidden'], 'true');
    assert.equal(icon.width, '14');
    assert.doesNotMatch(html, /aria-live|role=/);
  });

  test('each tone keeps its toast class', () => {
    const tones: Array<[ToastTone, string[]]> = [
      ['default', ['toast']],
      ['success', ['toast', 'toastSuccess']],
      ['warning', ['toast', 'toastWarning']],
      ['error', ['toast', 'toastError']],
    ];
    for (const [tone, expected] of tones) assert.deepEqual(classesOf(tagsOf(card({ tone }), 'div')[0]), expected, tone);
  });

  test('hover is tracked per toast and focus only follows a keyboard dismissal', () => {
    const code = uiText('Misc.tsx');
    assert.doesNotMatch(code, /className=\{s\.toastWrap\}[^>]*onPointer/);
    assert.match(code, /onPointerEnter=\{onHover \? \(\) => onHover\(id, 'enter'\)/);
    assert.match(code, /onPointerLeave=\{onHover \? \(\) => onHover\(id, 'leave'\)/);
    assert.match(code, /toastHoverAfter\(current, id, 'dismiss'\)/);
    assert.match(code, /matches\(':focus-visible'\)/);
  });

  test('consumers share the provider value and only see show', () => {
    const seen: Array<{ show: unknown }> = [];
    function Probe() {
      seen.push(useToast());
      return null;
    }
    render(createElement(ToastProvider, null, createElement(Probe), createElement(Probe)));
    assert.equal(seen.length, 2);
    assert.equal(seen[0], seen[1]);
    assert.deepEqual(Object.keys(seen[0]), ['show']);
    assert.equal(typeof seen[0].show, 'function');
  });

  test('outside a provider useToast is one stable no-op', () => {
    const seen: Array<{ show: (text: string, tone?: ToastTone) => void }> = [];
    function Probe() {
      seen.push(useToast());
      return null;
    }
    render(createElement(Probe));
    render(createElement(Probe));
    assert.equal(seen[0], seen[1]);
    assert.doesNotThrow(() => seen[0].show('Nothing listens', 'error'));
  });

  test('the toast stack is fixed on the toast layer, fits a 360px screen and honours reduced motion', () => {
    const css = uiText('Misc.module.css');
    const wrap = ruleBody(css, '.toastWrap');
    assert.match(wrap, /z-index: var\(--z-toast\)/);
    assert.match(wrap, /left: var\(--space-4\)/);
    assert.match(wrap, /right: var\(--space-4\)/);
    assert.match(wrap, /pointer-events: none/);
    assert.match(ruleBody(css, '.toastText'), /overflow-wrap: anywhere/);
    assert.match(ruleBody(css, '.toastClose:focus-visible'), /outline: 2px solid currentColor/);
    assert.match(ruleBody(css, '.toastClose'), /width: var\(--space-6\)/);
    const motion = reducedMotion(css);
    assert.match(ruleBody(motion, '.toast'), /animation: none/);
    assert.match(ruleBody(motion, '.toastClose'), /transition: none/);
  });
});

describe('hard rules for the display files', () => {
  const sheets = ['Status.module.css', 'Misc.module.css', 'Button.module.css'];
  const scripts = ['Status.tsx', 'Misc.tsx', 'Button.tsx', 'LinkButton.tsx'];

  for (const sheet of sheets) {
    test(`${sheet} uses tokens only, with no raw z-index and no comments`, () => {
      const css = uiText(sheet);
      assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'literal hex colour');
      assert.doesNotMatch(css, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/, 'literal colour function');
      assert.doesNotMatch(
        css,
        /(?<![-\w])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink)(?![-\w])/i,
        'named colour',
      );
      assert.doesNotMatch(css, /z-index\s*:\s*-?\d/, 'raw z-index');
      assert.doesNotMatch(css, /calc\([^)]*--z-/, 'arithmetic on a z token');
      assert.doesNotMatch(css, /\/\*/, 'prose comment');
    });
  }

  test('Status and Misc stylesheets avoid the transparent keyword too', () => {
    assert.doesNotMatch(uiText('Status.module.css'), /\btransparent\b/);
    assert.doesNotMatch(uiText('Misc.module.css'), /\btransparent\b/);
  });

  for (const script of scripts) {
    test(`${script} has no prose comments and no literal colours`, () => {
      const code = uiText(script);
      assert.doesNotMatch(code, /^\s*\/\/|\s\/\/\s|\/\*/m, 'comment');
      assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|\brgba?\(/, 'literal colour');
    });
  }

  test('static layout no longer lives in inline styles', () => {
    assert.doesNotMatch(uiText('Misc.tsx'), /style=\{\{\s*display/);
    assert.doesNotMatch(uiText('Status.tsx'), /style=\{\{/);
    assert.doesNotMatch(uiText('LinkButton.tsx'), /style=/);
  });

  test('Status and LinkButton stay server-renderable for the dashboard', () => {
    assert.doesNotMatch(uiText('Status.tsx'), /^['"]use client['"]/);
    assert.doesNotMatch(uiText('LinkButton.tsx'), /^['"]use client['"]/);
    assert.match(uiText('Misc.tsx'), /^'use client';/);
  });

  test('new and widened types stay assignable from the old shapes', () => {
    const legacyItem: StatItem = { label: 'Matching', value: '12', mono: true };
    const legacyKpi: KpiProps = { label: 'Users', value: '9', href: '/users', unavailable: false, unavailableHint: 'x' };
    const legacyEmpty: EmptyStateProps = { title: 'None', className: 'x' };
    const legacyLabel: SectionLabelProps = { children: 'Payout', style: { marginTop: 4 } };
    const legacySkeleton: SkeletonProps = { width: 10, height: 10, rounded: true };
    const legacyLines: SkeletonLinesProps = { rows: 2, gap: 4, height: 9 };
    const legacyDot: StatusDotProps = { status: 'failed', tone: 'danger' };
    assert.ok(legacyItem && legacyKpi && legacyEmpty && legacyLabel && legacySkeleton && legacyLines && legacyDot);
  });
});
