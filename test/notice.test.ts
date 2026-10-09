import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, Fragment, type ElementType, type ReactElement, type ReactNode } from 'react';
import { classesOf, loadUi, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import type { NoticeAnnounce, NoticeProps, NoticeRole, NoticeTone, NoticeVariant } from '../app/_ui/Notice.tsx';

interface NoticeModule {
  Notice: ElementType & { $$typeof: symbol; render: (props: NoticeProps, ref: unknown) => ReactElement };
  noticeRole: (tone: NoticeTone, announce?: NoticeAnnounce) => NoticeRole | undefined;
}

const TONES: readonly NoticeTone[] = ['info', 'success', 'warning', 'danger', 'neutral'];
const LOUD: ReadonlySet<NoticeTone> = new Set<NoticeTone>(['warning', 'danger']);
const DEFAULT_ICON: Readonly<Record<NoticeTone, string>> = {
  info: 'lucide-info',
  success: 'lucide-circle-check',
  warning: 'lucide-triangle-alert',
  danger: 'lucide-octagon-alert',
  neutral: 'lucide-info',
};

const uiText = (name: string) => readFileSync(new URL(`../app/_ui/${name}`, import.meta.url), 'utf8');

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing rule ${selector}`);
  return match[1];
}

function atRule(css: string, marker: string): string {
  const from = css.indexOf(marker);
  assert.ok(from >= 0, `missing ${marker}`);
  const open = css.indexOf('{', from);
  let depth = 0;
  let end = open;
  for (; end < css.length; end += 1) {
    if (css[end] === '{') depth += 1;
    if (css[end] === '}') depth -= 1;
    if (depth === 0) break;
  }
  return css.slice(open + 1, end);
}

function rolesIn(html: string): string[] {
  return [...html.matchAll(/\brole="([^"]+)"/g)].map((match) => match[1]);
}

function findElement(node: ReactNode, matches: (element: ReactElement<Record<string, unknown>>) => boolean):
  ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, matches);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return null;
  const element = node as ReactElement<Record<string, unknown>>;
  if (matches(element)) return element;
  return findElement(element.props.children as ReactNode, matches);
}

describe('noticeRole', () => {
  let noticeRole: NoticeModule['noticeRole'];

  before(async () => {
    ({ noticeRole } = await loadUi<NoticeModule>('Notice.tsx'));
  });

  test('is silent unless announce is set', () => {
    for (const tone of TONES) {
      assert.equal(noticeRole(tone), undefined, tone);
      assert.equal(noticeRole(tone, false), undefined, tone);
    }
  });

  test('announce maps danger and warning to alert and every other tone to status', () => {
    for (const tone of TONES) assert.equal(noticeRole(tone, true), LOUD.has(tone) ? 'alert' : 'status', tone);
  });

  test('polite and assertive override the tone mapping', () => {
    for (const tone of TONES) {
      assert.equal(noticeRole(tone, 'polite'), 'status', tone);
      assert.equal(noticeRole(tone, 'assertive'), 'alert', tone);
    }
  });
});

describe('Notice', () => {
  let Notice: NoticeModule['Notice'];

  before(async () => {
    ({ Notice } = await loadUi<NoticeModule>('Notice.tsx'));
  });

  const notice = (props: Partial<NoticeProps>, children?: ReactNode) =>
    render(createElement(Notice, { tone: 'info', ...props }, children));

  describe('live region', () => {
    test('nothing is announced by default, for every tone and layout', () => {
      const layouts: Array<Partial<NoticeProps>> = [{}, { compact: true }, { variant: 'callout' }];
      for (const tone of TONES) {
        for (const layout of layouts) {
          const html = notice({
            tone, ...layout, title: 'Title', meta: 'Meta', actions: createElement('button', null, 'Act'), onDismiss: () => {},
          }, 'Message');
          assert.deepEqual(rolesIn(html), [], `${tone} ${JSON.stringify(layout)}`);
          assert.doesNotMatch(html, /aria-live|aria-atomic/);
        }
      }
    });

    test('announce puts one role on the title and message, leaving meta, actions and dismiss outside', () => {
      for (const tone of TONES) {
        const role = LOUD.has(tone) ? 'alert' : 'status';
        const html = notice({
          tone,
          announce: true,
          title: 'Payout failed',
          meta: 'Request abc',
          actions: createElement('button', null, 'Open withdrawal'),
          onDismiss: () => {},
        }, 'The bank rejected it.');
        assert.deepEqual(rolesIn(html), [role], tone);
        assert.match(
          html,
          new RegExp(
            `<div class="stack" role="${role}"><div class="title">Payout failed</div>`
            + '<div class="text">The bank rejected it\\.</div></div>'
            + '<div class="meta">Request abc</div><div class="actions"><button>Open withdrawal</button></div></div>'
            + '<button type="button" class="dismiss"',
          ),
          tone,
        );
      }
    });

    test('a page and drawer copy of one outcome announce at most once', () => {
      const outcome = (announce?: boolean) => createElement(Notice, { tone: 'danger', title: 'Approval failed', announce }, 'Rejected.');
      assert.deepEqual(rolesIn(render(createElement(Fragment, null, outcome(), outcome()))), []);
      assert.deepEqual(rolesIn(render(createElement(Fragment, null, outcome(true), outcome()))), ['alert']);
    });

    test('a notice nested inside an announcing notice never opens a second live region', () => {
      const nested = (announce: NoticeAnnounce) => createElement(Notice, { tone: 'warning', compact: true, announce }, 'Awaiting review.');
      for (const layout of [{}, { compact: true }, { variant: 'callout' as NoticeVariant }]) {
        for (const inner of [true, 'polite', 'assertive'] as const) {
          assert.deepEqual(rolesIn(notice({ tone: 'danger', ...layout, announce: true, title: 'Frozen' }, nested(inner))), ['alert'], JSON.stringify(layout));
        }
      }
      assert.deepEqual(rolesIn(notice({ tone: 'danger', title: 'Frozen' }, nested(true))), ['alert']);
      assert.deepEqual(
        rolesIn(notice({ tone: 'danger', announce: true, title: 'Frozen', meta: nested(true) }, 'Body')),
        ['alert', 'alert'],
      );
      const deep = notice(
        { tone: 'danger', announce: true, title: 'Frozen' },
        createElement(Notice, { tone: 'info' }, nested(true)),
      );
      assert.deepEqual(rolesIn(deep), ['alert']);
    });

    test('compact notices announce the inline message, not the meta or the action', () => {
      const html = notice({
        tone: 'warning',
        compact: true,
        announce: 'polite',
        title: 'Live updates paused.',
        meta: 'Showing results from 14:02 WAT.',
        actions: createElement('button', null, 'Retry now'),
      }, 'The server did not respond.');
      assert.deepEqual(rolesIn(html), ['status']);
      assert.match(
        html,
        /<div class="lineText"><span class="inline" role="status"><span class="inlineTitle">Live updates paused\.<\/span> The server did not respond\.<\/span> <span class="inlineMeta">Showing results from 14:02 WAT\.<\/span><\/div><\/div><div class="actions"><button>Retry now<\/button><\/div>/,
      );
    });

    test('callouts announce their label and text but not the meta line', () => {
      const html = notice({ tone: 'danger', variant: 'callout', announce: true, title: 'Account frozen', meta: 'Reject to refund.' }, 'Chargeback');
      assert.deepEqual(rolesIn(html), ['alert']);
      assert.match(html, /<div class="stack" role="alert"><div class="label">[\s\S]*<\/div><div class="calloutText">Chargeback<\/div><\/div><div class="meta">Reject to refund\.<\/div>/);
    });

    test('a notice with only meta has no empty live region', () => {
      const html = notice({ announce: true, meta: 'Requested 1 Oct' });
      assert.deepEqual(rolesIn(html), []);
      assert.equal(withClass(html, 'div', 'stack').length, 0);
    });
  });

  describe('dismiss', () => {
    test('there is no dismiss control without onDismiss', () => {
      const html = notice({ title: 'Heads up' }, 'Body');
      assert.equal(tagsOf(html, 'button').length, 0);
      assert.equal(classesOf(tagsOf(html, 'div')[0]).includes('dismissible'), false);
    });

    test('onDismiss adds a real button with an accessible name and a hidden 14px icon', () => {
      const html = notice({ tone: 'danger', title: 'Approval failed', onDismiss: () => {} }, 'Rejected.');
      const [button] = tagsOf(html, 'button');
      assert.equal(button.type, 'button');
      assert.equal(button['aria-label'], 'Dismiss notice');
      assert.deepEqual(classesOf(button), ['dismiss']);
      const close = tagsOf(html, 'svg').find((svg) => svg.class.includes('lucide-x'));
      assert.ok(close);
      assert.equal(close['aria-hidden'], 'true');
      assert.equal(close.width, '14');
      assert.ok(classesOf(tagsOf(html, 'div')[0]).includes('dismissible'));
      assert.match(html, /<\/div><\/div><button type="button" class="dismiss"[^>]*>[\s\S]*<\/button><\/div>$/);
    });

    test('dismissLabel names the button and a blank label falls back to the default', () => {
      assert.equal(tagsOf(notice({ onDismiss: () => {}, dismissLabel: 'Dismiss this notice' }, 'x'), 'button')[0]['aria-label'], 'Dismiss this notice');
      assert.equal(tagsOf(notice({ onDismiss: () => {}, dismissLabel: '   ' }, 'x'), 'button')[0]['aria-label'], 'Dismiss notice');
    });

    test('the button calls exactly the handler it was given', () => {
      const onDismiss = () => {};
      for (const props of [{}, { compact: true }, { variant: 'callout' as NoticeVariant }]) {
        let tree: ReactElement | null = null;
        const Probe = () => {
          tree = Notice.render({ tone: 'warning', title: 'Stale', onDismiss, ...props }, null);
          return tree;
        };
        render(createElement(Probe));
        const button = findElement(tree, (element) => element.type === 'button');
        assert.ok(button, JSON.stringify(props));
        assert.equal(button.props.onClick, onDismiss);
        assert.equal(button.props.type, 'button');
      }
    });
  });

  describe('icon', () => {
    test('every tone has its own default icon, 16px on a banner', () => {
      for (const tone of TONES) {
        const html = notice({ tone, title: 'Title' }, 'Body');
        const [wrapper] = withClass(html, 'span', 'icon');
        assert.equal(wrapper['aria-hidden'], 'true', tone);
        const [svg] = tagsOf(html, 'svg');
        assert.ok(svg.class.split(' ').includes(DEFAULT_ICON[tone]), `${tone}: ${svg.class}`);
        assert.equal(svg.width, '16', tone);
        assert.equal(svg['aria-hidden'], 'true', tone);
      }
    });

    test('warning and danger never share a glyph, so tone is not colour alone', () => {
      assert.notEqual(DEFAULT_ICON.warning, DEFAULT_ICON.danger);
      const warning = tagsOf(notice({ tone: 'warning' }, 'x'), 'svg')[0].class;
      const danger = tagsOf(notice({ tone: 'danger' }, 'x'), 'svg')[0].class;
      assert.notEqual(warning, danger);
    });

    test('compact and callout default icons are 14px', () => {
      assert.equal(tagsOf(notice({ compact: true }, 'x'), 'svg')[0].width, '14');
      assert.equal(tagsOf(notice({ variant: 'callout', title: 'Label' }, 'x'), 'svg')[0].width, '14');
    });

    test('icon null hides it and a custom icon sits in the hidden wrapper', () => {
      for (const props of [{}, { compact: true }, { variant: 'callout' as NoticeVariant }]) {
        const hidden = notice({ ...props, title: 'Title', icon: null }, 'Body');
        assert.equal(tagsOf(hidden, 'svg').length, 0, JSON.stringify(props));
        assert.equal(withClass(hidden, 'span', 'icon').length + withClass(hidden, 'span', 'labelIcon').length, 0);
      }
      assert.match(notice({ title: 'T', icon: createElement('i', { id: 'lock' }) }, 'B'), /<span class="icon" aria-hidden="true"><i id="lock"><\/i><\/span>/);
      assert.match(
        notice({ variant: 'callout', title: 'T', icon: createElement('i', { id: 'lock' }) }, 'B'),
        /<span class="labelIcon" aria-hidden="true"><i id="lock"><\/i><\/span>/,
      );
    });
  });

  describe('layout', () => {
    test('a banner reads icon, title, message, meta, actions, then dismiss', () => {
      const html = notice({
        tone: 'danger',
        title: 'Approval outcome unknown',
        meta: 'Withdrawal 7f3a',
        actions: createElement('button', null, 'Open withdrawal'),
        onDismiss: () => {},
      }, 'Check the provider before retrying.');
      assert.deepEqual(classesOf(tagsOf(html, 'div')[0]), ['notice', 'banner', 'danger', 'dismissible']);
      assert.equal(textOf(html), 'Approval outcome unknown Check the provider before retrying. Withdrawal 7f3a Open withdrawal');
      assert.match(html, /^<div class="notice banner danger dismissible"><span class="icon" aria-hidden="true"><svg[^>]*>[\s\S]*?<\/svg><\/span><div class="main"><div class="stack"><div class="title">/);
    });

    test('a callout turns the title into a label line above the text and meta', () => {
      const html = notice({
        tone: 'warning',
        variant: 'callout',
        icon: createElement('i'),
        title: 'Flagged · open',
        meta: 'Raised 1 Oct 2026, 14:02 WAT',
      }, 'Velocity rule matched');
      assert.equal(
        html,
        '<div class="notice callout warning"><div class="main"><div class="stack"><div class="label">'
        + '<span class="labelIcon" aria-hidden="true"><i></i></span><span class="labelText">Flagged · open</span></div>'
        + '<div class="calloutText">Velocity rule matched</div></div>'
        + '<div class="meta">Raised 1 Oct 2026, 14:02 WAT</div></div></div>',
      );
    });

    test('a callout without a title is a plain tinted box with no orphan icon', () => {
      const html = notice({ tone: 'neutral', variant: 'callout' }, 'No message was given.');
      assert.equal(html, '<div class="notice callout neutral"><div class="main"><div class="stack"><div class="calloutText">No message was given.</div></div></div></div>');
    });

    test('compact banners are one line with the action beside it and the icon on the first text line', () => {
      const html = notice({
        tone: 'warning',
        compact: true,
        icon: createElement('i'),
        actions: createElement('button', null, 'Try again'),
      }, 'The list could not be updated. Showing the previous results.');
      assert.equal(
        html,
        '<div class="notice banner compact warning trailing"><div class="main"><div class="line">'
        + '<span class="icon" aria-hidden="true"><i></i></span>'
        + '<div class="lineText"><span class="inline">The list could not be updated. Showing the previous results.</span></div></div>'
        + '<div class="actions"><button>Try again</button></div></div></div>',
      );
    });

    test('compact banners get the trailing padding only when a control sits at the end', () => {
      assert.deepEqual(classesOf(tagsOf(notice({ compact: true }, 'x'), 'div')[0]), ['notice', 'banner', 'compact', 'info']);
      assert.deepEqual(
        classesOf(tagsOf(notice({ compact: true, onDismiss: () => {} }, 'x'), 'div')[0]),
        ['notice', 'banner', 'compact', 'info', 'dismissible', 'trailing'],
      );
      assert.ok(classesOf(tagsOf(notice({ compact: true, actions: 'Retry' }, 'x'), 'div')[0]).includes('trailing'));
    });

    test('compact on a callout only tightens it and keeps the label structure', () => {
      const html = notice({ variant: 'callout', compact: true, title: 'Dispute', icon: null }, 'Card already used');
      assert.deepEqual(classesOf(tagsOf(html, 'div')[0]), ['notice', 'callout', 'compact', 'info']);
      assert.equal(withClass(html, 'div', 'label').length, 1);
      assert.equal(withClass(html, 'div', 'line').length, 0);
    });

    test('an array of meta becomes spaced items and skips empty entries', () => {
      const html = notice({
        title: 'Approval failed',
        meta: [
          createElement(Fragment, null, 'Withdrawal ', createElement('code', null, '7f3a')),
          null,
          false,
          '',
          createElement(Fragment, null, 'Request ', createElement('code', null, 'req_9')),
        ],
      });
      assert.deepEqual(classesOf(withClass(html, 'div', 'meta')[0]), ['meta', 'metaList']);
      assert.equal(withClass(html, 'span', 'metaItem').length, 2);
      assert.match(html, /<div class="meta metaList"><span class="metaItem">Withdrawal <code>7f3a<\/code><\/span><span class="metaItem">Request <code>req_9<\/code><\/span><\/div>/);
    });

    test('meta that is not an array flows as one line of text', () => {
      const html = notice({ meta: createElement(Fragment, null, 'Requested ', createElement('time', null, '14:02'), ' WAT') }, 'x');
      assert.match(html, /<div class="meta">Requested <time>14:02<\/time> WAT<\/div>/);
      assert.equal(withClass(html, 'span', 'metaItem').length, 0);
    });

    test('compact meta items stay inline', () => {
      const html = notice({ compact: true, meta: ['Withdrawal 7f3a', 'Request req_9'] }, 'Retry failed.');
      assert.match(html, /<span class="inlineMeta"><span class="metaItem">Withdrawal 7f3a<\/span><span class="metaItem">Request req_9<\/span><\/span>/);
    });

    test('empty slots render no wrappers', () => {
      const html = notice({ title: '', meta: [null, false], actions: false, icon: null }, null);
      assert.equal(html, '<div class="notice banner info"><div class="main"></div></div>');
    });

    test('children may hold block content, including a nested warning line', () => {
      const html = notice(
        { tone: 'danger', title: 'Account frozen', meta: 'Withdrawals and bill payments are refused.' },
        createElement(
          Fragment,
          null,
          'Chargeback on card',
          createElement(Notice, { tone: 'warning', compact: true, icon: null }, '2 withdrawals are awaiting review.'),
        ),
      );
      assert.match(
        html,
        /<div class="text">Chargeback on card<div class="notice banner compact warning"><div class="main"><div class="line"><div class="lineText"><span class="inline">2 withdrawals are awaiting review\.<\/span><\/div><\/div><\/div><\/div><\/div>/,
      );
      assert.doesNotMatch(html, /<p\b/);
    });

    test('className and id land on the root, and refs are forwarded', () => {
      const [root] = tagsOf(notice({ id: 'outcome', className: 'pageGap' }, 'x'), 'div');
      assert.equal(root.id, 'outcome');
      assert.deepEqual(classesOf(root), ['notice', 'banner', 'info', 'pageGap']);
      assert.equal(Notice.$$typeof, Symbol.for('react.forward_ref'));
    });

    test('flush adds one class for gap-based stacks and is off by default', () => {
      assert.deepEqual(classesOf(tagsOf(notice({ flush: true, className: 'x' }, 'x'), 'div')[0]), ['notice', 'banner', 'info', 'flush', 'x']);
      assert.deepEqual(
        classesOf(tagsOf(notice({ variant: 'callout', compact: true, flush: true }, 'x'), 'div')[0]),
        ['notice', 'callout', 'compact', 'info', 'flush'],
      );
      assert.equal(classesOf(tagsOf(notice({}, 'x'), 'div')[0]).includes('flush'), false);
    });
  });

  describe('styles', () => {
    const css = uiText('Notice.module.css');

    test('every tone takes its surface, border and accent from the matching tone tokens', () => {
      for (const tone of TONES) {
        const body = ruleBody(css, `.${tone}`);
        assert.match(body, new RegExp(`--notice-bg: var\\(--tone-${tone}-bg\\)`), tone);
        assert.match(body, new RegExp(`--notice-border: var\\(--tone-${tone}-border\\)`), tone);
        assert.match(body, new RegExp(`--notice-fg: var\\(--tone-${tone}-fg\\)`), tone);
      }
      const root = ruleBody(css, '.notice');
      assert.match(root, /background: var\(--notice-bg\)/);
      assert.match(root, /border: 1px solid var\(--notice-border\)/);
      assert.match(ruleBody(css, '.icon'), /color: var\(--notice-fg\)/);
      assert.match(ruleBody(css, '.label'), /color: var\(--notice-fg\)/);
    });

    test('neutral titles stay primary text while other tones use their own colour', () => {
      assert.match(ruleBody(css, '.neutral'), /--notice-title: var\(--fg-primary\)/);
      for (const tone of TONES.filter((value) => value !== 'neutral')) {
        assert.match(ruleBody(css, `.${tone}`), new RegExp(`--notice-title: var\\(--tone-${tone}-fg\\)`), tone);
      }
      assert.match(ruleBody(css, '.title'), /color: var\(--notice-title\)/);
      assert.match(ruleBody(css, '.meta'), /color: var\(--fg-secondary\)/);
    });

    test('no literal colours, no z-index and no comments', () => {
      const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
      for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
        assert.doesNotMatch(value, colour, `${property}: ${value}`);
      }
      assert.doesNotMatch(css, /z-index/);
      assert.doesNotMatch(css, /\/\*/);
    });

    test('callout labels are mono uppercase with the label tokens', () => {
      const label = ruleBody(css, '.label');
      assert.match(label, /font-family: var\(--font-mono\)/);
      assert.match(label, /font-size: var\(--text-label\)/);
      assert.match(label, /letter-spacing: var\(--tracking-label\)/);
      assert.match(label, /text-transform: uppercase/);
    });

    test('the dismiss button is a 28px target with the kit focus ring and no motion when reduced', () => {
      const dismiss = ruleBody(css, '.dismiss');
      assert.match(dismiss, /width: var\(--space-7\);\s*height: var\(--space-7\)/);
      assert.match(dismiss, /background: none/);
      assert.match(ruleBody(css, '.dismiss:focus-visible'), /outline: 2px solid var\(--accent-base\)/);
      assert.match(ruleBody(atRule(css, '@media (hover: hover)'), '.dismiss:hover'), /background: var\(--notice-border\)/);
      assert.match(ruleBody(atRule(css, '@media (prefers-reduced-motion: reduce)'), '.dismiss'), /transition: none/);
    });

    test('icons line up with the first line of text, even when a compact strip wraps', () => {
      assert.match(ruleBody(css, '.icon'), /height: var\(--notice-line\)/);
      assert.match(ruleBody(css, '.banner'), /--notice-line: calc\(var\(--text-md\) \* var\(--leading-snug\)\)/);
      assert.match(ruleBody(css, '.banner.compact'), /--notice-line: calc\(var\(--text-sm\) \* var\(--leading-snug\)\)/);
      assert.match(ruleBody(css, '.line'), /align-items: flex-start/);
      const strip = ruleBody(css, '.banner.compact > .main');
      assert.match(strip, /flex-wrap: wrap/);
      assert.match(strip, /align-items: flex-start/);
      assert.doesNotMatch(ruleBody(css, '.banner.compact'), /align-items/);
      assert.match(
        ruleBody(css, '.banner.compact.trailing > .main > .line'),
        /padding: calc\(\(var\(--space-7\) - var\(--notice-line\)\) \/ 2\) 0/,
      );
      assert.match(ruleBody(css, '.banner.compact > .dismiss'), /margin: 0/);
      assert.match(ruleBody(css, '.dismiss'), /margin: calc\(\(var\(--notice-line\) - var\(--space-7\)\) \/ 2\) 0/);
    });

    test('compact banners are tighter and tone coloured; nested notices drop the page margin', () => {
      const compact = ruleBody(css, '.banner.compact');
      assert.match(compact, /color: var\(--notice-fg\)/);
      assert.match(compact, /font-size: var\(--text-sm\)/);
      assert.match(compact, /margin-bottom: var\(--space-3\)/);
      assert.match(ruleBody(css, '.banner'), /margin: 0 0 var\(--space-4\)/);
      assert.match(ruleBody(css, '.callout'), /margin: 0;/);
      assert.match(ruleBody(css, '.notice .notice'), /margin: var\(--space-2\) 0 0/);
      assert.doesNotMatch(css, /:last-child|:first-child/);
    });

    test('flush clears the outer margin and outranks every layout margin', () => {
      assert.match(ruleBody(css, '.notice.flush'), /margin: 0/);
      const flushAt = css.indexOf('.notice.flush');
      for (const selector of ['.banner {', '.callout {', '.banner.compact {', '.notice .notice {']) {
        assert.ok(css.indexOf(selector) < flushAt, `${selector} must come before .notice.flush`);
      }
    });

    test('text keeps line breaks from user-entered reasons and wraps long tokens', () => {
      assert.match(ruleBody(css, '.text'), /white-space: pre-line/);
      assert.match(ruleBody(css, '.calloutText'), /white-space: pre-line/);
      assert.match(ruleBody(css, '.notice'), /overflow-wrap: anywhere/);
      assert.match(ruleBody(css, '.notice'), /white-space: normal/);
    });

    test('phones get the tighter banner padding', () => {
      const phone = atRule(css, '@media (max-width: 768px)');
      assert.match(ruleBody(phone, '.banner'), /padding: var\(--space-3\)/);
      assert.match(ruleBody(phone, '.banner.dismissible'), /padding-right: var\(--space-2\)/);
    });

    test('the component source carries no prose comments', () => {
      assert.doesNotMatch(uiText('Notice.tsx'), /\/\/|\/\*/);
    });
  });
});
