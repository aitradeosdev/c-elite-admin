import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ElementType } from 'react';
import { loadUi, render, tagsOf, textById, textOf, type Attrs } from './support/uiHarness.ts';
import type {
  CommandPaletteProps, PaletteCommand, PaletteOption, PaletteRecent, PaletteSearchGroup, RecentStorage,
} from '../app/_ui/CommandPalette.tsx';
import type { HotkeyInput } from '../app/_ui/useHotkeys.ts';
import type { ApiFailure } from '../app/lib/apiClient.ts';

type PaletteModule = typeof import('../app/_ui/CommandPalette.tsx');
type HotkeysModule = typeof import('../app/_ui/useHotkeys.ts');

let palette: PaletteModule;
let hotkeys: HotkeysModule;
let SearchInput: ElementType;

const uiText = (name: string) => readFileSync(new URL(`../app/_ui/${name}`, import.meta.url), 'utf8');
const shellText = (name: string) => readFileSync(new URL(`../app/(dashboard)/_shell/${name}`, import.meta.url), 'utf8');

const Icon = () => null;

before(async () => {
  palette = await loadUi<PaletteModule>('CommandPalette.tsx');
  hotkeys = await loadUi<HotkeysModule>('useHotkeys.ts');
  SearchInput = (await loadUi<{ SearchInput: ElementType }>('SearchInput.tsx')).SearchInput;
});

function key(input: Partial<HotkeyInput> & { key: string }): HotkeyInput {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...input };
}

const WINDOWS = { apple: false, editable: false };
const MAC = { apple: true, editable: false };
const TYPING = { apple: false, editable: true };

function page(id: string, label: string, extra: Partial<PaletteCommand> = {}): PaletteCommand {
  return { id, label, href: `/${id}`, icon: Icon, ...extra };
}

function action(id: string, label: string, extra: Partial<PaletteCommand> = {}): PaletteCommand {
  return { id, label, icon: Icon, onSelect: () => {}, ...extra };
}

const PAGES: PaletteCommand[] = [
  page('dashboard', 'Dashboard', { subtitle: 'Operations', keywords: ['Operations'] }),
  page('withdrawals', 'Withdrawals', { subtitle: 'Operations', keywords: ['Operations'] }),
  page('users', 'Users', { subtitle: 'People', keywords: ['People'] }),
  page('security-limits', 'Rate Limits & IPs', { subtitle: 'Security', keywords: ['Security'] }),
  page('limits-fees', 'Limits & Fees', { subtitle: 'Configuration', keywords: ['Configuration'] }),
];

const ACTIONS: PaletteCommand[] = [
  action('theme-light', 'Theme: Light', { keywords: ['appearance', 'mode'] }),
  action('theme-dark', 'Theme: Dark', { keywords: ['appearance', 'mode'], hint: 'Current' }),
  action('shortcuts', 'Keyboard shortcuts', { keywords: ['help', 'hotkeys'] }),
  action('sign-out', 'Sign out', { keywords: ['log out', 'logout'] }),
];

const GROUPS: PaletteSearchGroup[] = [
  {
    key: 'users',
    label: 'Users',
    moreHref: '/users?search=jo',
    items: [
      { id: 'u1', title: 'Joan Obi', subtitle: '@joan · joan@example.com', meta: 'Joined 3 Oct 2026', status: 'active', href: '/users/u1' },
    ],
  },
  {
    key: 'withdrawals',
    label: 'Withdrawals',
    moreHref: null,
    items: [
      { id: 'w1', title: '₦50,000.00 to •••• 1234', subtitle: 'Joan Obi', meta: '9 Oct 2026, 14:02 WAT', status: 'pending_review', href: '/withdrawals?id=w1' },
    ],
  },
];

function sections(query: string, extra: Partial<Parameters<PaletteModule['buildPaletteSections']>[0]> = {}) {
  return palette.buildPaletteSections({
    query,
    recents: [],
    pages: PAGES,
    actions: ACTIONS,
    groups: [],
    recordsEnabled: true,
    ...extra,
  });
}

function labels(options: readonly PaletteOption[]): string[] {
  return options.map((option) => option.label);
}

class MemoryStorage implements RecentStorage {
  readonly items = new Map<string, string>();
  getItem(name: string): string | null {
    return this.items.get(name) ?? null;
  }
  setItem(name: string, value: string): void {
    this.items.set(name, value);
  }
  removeItem(name: string): void {
    this.items.delete(name);
  }
}

const THROWING: RecentStorage = {
  getItem: () => {
    throw new Error('SecurityError: storage is disabled');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError: storage is disabled');
  },
};

describe('matchHotkey', () => {
  test('Ctrl+K opens the palette on Windows and Linux, Cmd+K on macOS', () => {
    assert.equal(hotkeys.matchHotkey(key({ key: 'k', ctrlKey: true }), WINDOWS), 'palette');
    assert.equal(hotkeys.matchHotkey(key({ key: 'k', metaKey: true }), MAC), 'palette');
    assert.equal(hotkeys.matchHotkey(key({ key: 'K', ctrlKey: true }), WINDOWS), 'palette');
    assert.equal(hotkeys.matchHotkey(key({ key: 'k', ctrlKey: true }), MAC), null);
    assert.equal(hotkeys.matchHotkey(key({ key: 'k', metaKey: true }), WINDOWS), null);
  });

  test('the palette chord works while typing in a field', () => {
    assert.equal(hotkeys.matchHotkey(key({ key: 'k', ctrlKey: true }), TYPING), 'palette');
    assert.equal(hotkeys.matchHotkey(key({ key: 'k', metaKey: true }), { apple: true, editable: true }), 'palette');
  });

  test('extra modifiers and other letters do not open the palette', () => {
    assert.equal(hotkeys.matchHotkey(key({ key: 'K', ctrlKey: true, shiftKey: true }), WINDOWS), null);
    assert.equal(hotkeys.matchHotkey(key({ key: 'k', ctrlKey: true, altKey: true }), WINDOWS), null);
    assert.equal(hotkeys.matchHotkey(key({ key: 'k', ctrlKey: true, metaKey: true }), WINDOWS), null);
    assert.equal(hotkeys.matchHotkey(key({ key: 'j', ctrlKey: true }), WINDOWS), null);
    assert.equal(hotkeys.matchHotkey(key({ key: 'k' }), WINDOWS), null);
  });

  test('non-Latin layouts fall back to the physical K key; Latin layouts use the typed letter', () => {
    assert.equal(hotkeys.matchHotkey(key({ key: 'л', code: 'KeyK', ctrlKey: true }), WINDOWS), 'palette');
    assert.equal(hotkeys.matchHotkey(key({ key: 'k', code: 'KeyV', ctrlKey: true }), WINDOWS), 'palette');
    assert.equal(hotkeys.matchHotkey(key({ key: 't', code: 'KeyK', ctrlKey: true }), WINDOWS), null);
  });

  test('slash searches and question mark opens help, only outside editable fields', () => {
    assert.equal(hotkeys.matchHotkey(key({ key: '/' }), WINDOWS), 'search');
    assert.equal(hotkeys.matchHotkey(key({ key: '?', shiftKey: true }), WINDOWS), 'help');
    assert.equal(hotkeys.matchHotkey(key({ key: '/' }), TYPING), null);
    assert.equal(hotkeys.matchHotkey(key({ key: '?', shiftKey: true }), TYPING), null);
    assert.equal(hotkeys.matchHotkey(key({ key: '/' }), MAC), 'search');
  });

  test('layouts that need Shift or AltGr for the slash still work', () => {
    assert.equal(hotkeys.matchHotkey(key({ key: '/', shiftKey: true }), WINDOWS), 'search');
    assert.equal(hotkeys.matchHotkey(key({ key: '/', ctrlKey: true, altKey: true }), WINDOWS), 'search');
    assert.equal(hotkeys.matchHotkey(key({ key: '/', altGraph: true, ctrlKey: true }), WINDOWS), 'search');
    assert.equal(hotkeys.matchHotkey(key({ key: '/', altKey: true }), MAC), 'search');
  });

  test('browser and system chords on slash are left alone', () => {
    assert.equal(hotkeys.matchHotkey(key({ key: '/', ctrlKey: true }), WINDOWS), null);
    assert.equal(hotkeys.matchHotkey(key({ key: '/', altKey: true }), WINDOWS), null);
    assert.equal(hotkeys.matchHotkey(key({ key: '/', metaKey: true }), MAC), null);
    assert.equal(hotkeys.matchHotkey(key({ key: '/', ctrlKey: true }), MAC), null);
  });

  test('IME composition, key repeat and handled events never trigger a shortcut', () => {
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }]) {
      assert.equal(hotkeys.matchHotkey(key({ key: 'k', ctrlKey: true, ...extra }), WINDOWS), null);
      assert.equal(hotkeys.matchHotkey(key({ key: '/', ...extra }), WINDOWS), null);
      assert.equal(hotkeys.matchHotkey(key({ key: '?', ...extra }), WINDOWS), null);
    }
  });

  test('other keys do nothing', () => {
    for (const name of ['Escape', 'Enter', 'a', 'k', 'ArrowDown', ' ']) {
      assert.equal(hotkeys.matchHotkey(key({ key: name }), WINDOWS), null, name);
    }
  });
});

describe('hotkeyAllowed', () => {
  test('everything is allowed when no dialog is open', () => {
    for (const command of ['palette', 'search', 'help'] as const) {
      assert.equal(hotkeys.hotkeyAllowed(command, { overlayOpen: false, ownsOverlay: false }), true);
    }
  });

  test('another dialog blocks every shortcut, so keys never land behind it', () => {
    for (const command of ['palette', 'search', 'help'] as const) {
      assert.equal(hotkeys.hotkeyAllowed(command, { overlayOpen: true, ownsOverlay: false }), false);
    }
  });

  test('while the palette or shortcuts dialog is open only the palette chord works', () => {
    assert.equal(hotkeys.hotkeyAllowed('palette', { overlayOpen: true, ownsOverlay: true }), true);
    assert.equal(hotkeys.hotkeyAllowed('search', { overlayOpen: true, ownsOverlay: true }), false);
    assert.equal(hotkeys.hotkeyAllowed('help', { overlayOpen: true, ownsOverlay: true }), false);
  });
});

describe('isEditableTarget', () => {
  const element = (tagName: string, extra: Record<string, unknown> = {}) => ({
    tagName,
    getAttribute: (name: string) => (name === 'role' ? (extra.role as string | undefined) ?? null : null),
    ...extra,
  });

  test('text-like inputs, textareas, selects and content-editable areas are editable', () => {
    for (const type of ['text', 'search', 'email', 'number', 'password', 'tel', 'url', 'date', '']) {
      assert.equal(hotkeys.isEditableTarget(element('INPUT', { type })), true, type);
    }
    assert.equal(hotkeys.isEditableTarget(element('input')), true);
    assert.equal(hotkeys.isEditableTarget(element('TEXTAREA')), true);
    assert.equal(hotkeys.isEditableTarget(element('SELECT')), true);
    assert.equal(hotkeys.isEditableTarget(element('DIV', { isContentEditable: true })), true);
  });

  test('custom text widgets count as editable', () => {
    for (const role of ['textbox', 'searchbox', 'combobox', 'spinbutton']) {
      assert.equal(hotkeys.isEditableTarget(element('DIV', { role })), true, role);
    }
  });

  test('buttons, checkboxes and plain elements are not editable', () => {
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file', 'reset']) {
      assert.equal(hotkeys.isEditableTarget(element('INPUT', { type })), false, type);
    }
    for (const tag of ['BUTTON', 'A', 'DIV', 'BODY']) assert.equal(hotkeys.isEditableTarget(element(tag)), false, tag);
    for (const value of [null, undefined, 'input', 42]) assert.equal(hotkeys.isEditableTarget(value), false);
  });
});

describe('platform hints', () => {
  test('Apple platforms are detected from the client hint, platform or user agent', () => {
    assert.equal(hotkeys.isApplePlatform({ platform: 'MacIntel' }), true);
    assert.equal(hotkeys.isApplePlatform({ platform: 'iPhone' }), true);
    assert.equal(hotkeys.isApplePlatform({ userAgentData: { platform: 'macOS' }, platform: '' }), true);
    assert.equal(hotkeys.isApplePlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }), false);
    assert.equal(hotkeys.isApplePlatform({ platform: 'Win32' }), false);
    assert.equal(hotkeys.isApplePlatform({ platform: 'Linux x86_64' }), false);
    assert.equal(hotkeys.isApplePlatform(null), false);
  });

  test('the trigger hint and aria-keyshortcuts follow the platform', () => {
    assert.deepEqual(hotkeys.paletteChordHint(true), { text: '⌘K', keyshortcuts: 'Meta+K' });
    assert.deepEqual(hotkeys.paletteChordHint(false), { text: 'Ctrl K', keyshortcuts: 'Control+K' });
  });

  test('key caps carry a spoken name for screen readers', () => {
    assert.deepEqual(hotkeys.shortcutKeyLabel('mod', true), { text: '⌘', spoken: 'Command' });
    assert.deepEqual(hotkeys.shortcutKeyLabel('mod', false), { text: 'Ctrl', spoken: 'Control' });
    assert.equal(hotkeys.shortcutKeyLabel('/', false).spoken, 'Slash');
    assert.equal(hotkeys.shortcutKeyLabel('?', false).spoken, 'Question mark');
    assert.equal(hotkeys.shortcutKeyLabel('escape', true).text, 'Esc');
  });
});

describe('shortcut catalogue', () => {
  test('every global shortcut listed in the dialog really triggers its command', () => {
    const expected: Record<string, string> = { palette: 'palette', search: 'search', help: 'help' };
    const anywhere = hotkeys.SHORTCUT_SECTIONS.find((section) => section.id === 'anywhere');
    assert.ok(anywhere);
    for (const apple of [false, true]) {
      for (const entry of anywhere.entries) {
        if (!(entry.id in expected)) continue;
        const chord = entry.chords[0];
        const mod = chord.includes('mod');
        const letter = chord.find((part) => part !== 'mod') ?? '';
        const input = key({
          key: letter === 'k' ? 'k' : letter,
          ctrlKey: mod && !apple,
          metaKey: mod && apple,
          shiftKey: letter === '?',
        });
        assert.equal(hotkeys.matchHotkey(input, { apple, editable: false }), expected[entry.id], `${entry.id} ${apple}`);
      }
    }
  });

  test('lists slash, question mark, Escape and the palette keys', () => {
    const ids = hotkeys.SHORTCUT_SECTIONS.flatMap((section) => section.entries.map((entry) => entry.id));
    for (const id of ['palette', 'search', 'help', 'close', 'move', 'jump', 'open', 'new-tab', 'dismiss']) {
      assert.ok(ids.includes(id), id);
    }
  });
});

describe('findPageSearchInput', () => {
  const field = (extra: Partial<Record<'disabled' | 'readOnly' | 'hiddenAncestor' | 'visible', boolean>> & { name: string }) => ({
    name: extra.name,
    disabled: extra.disabled ?? false,
    readOnly: extra.readOnly ?? false,
    closest: () => (extra.hiddenAncestor ? {} : null),
    getClientRects: () => ({ length: extra.visible === false ? 0 : 1 }),
  });

  function rootWith(fields: unknown[]) {
    const seen: string[] = [];
    const root = {
      querySelectorAll: (selector: string) => {
        seen.push(selector);
        return fields;
      },
    };
    return { root: root as unknown as ParentNode, seen };
  }

  test('returns the first visible, enabled, editable field marked as the page search', () => {
    const { root, seen } = rootWith([
      field({ name: 'hidden', visible: false }),
      field({ name: 'disabled', disabled: true }),
      field({ name: 'readonly', readOnly: true }),
      field({ name: 'inert', hiddenAncestor: true }),
      field({ name: 'page' }),
      field({ name: 'later' }),
    ]);
    const found = hotkeys.findPageSearchInput(root) as unknown as { name: string } | null;
    assert.equal(found?.name, 'page');
    assert.deepEqual(seen, [`input[${hotkeys.PAGE_SEARCH_ATTRIBUTE}]`]);
  });

  test('returns null when there is no usable field or no root', () => {
    assert.equal(hotkeys.findPageSearchInput(rootWith([field({ name: 'x', visible: false })]).root), null);
    assert.equal(hotkeys.findPageSearchInput(rootWith([]).root), null);
    assert.equal(hotkeys.findPageSearchInput(null), null);
  });

  test('the kit SearchInput carries the page-search marker, and a caller can opt out', () => {
    const marked = tagsOf(render(createElement(SearchInput, { 'aria-label': 'Search users' })), 'input');
    assert.equal(marked.length, 1);
    assert.equal(marked[0][hotkeys.PAGE_SEARCH_ATTRIBUTE], '');
    const optedOut = tagsOf(
      render(createElement(SearchInput, { 'aria-label': 'Filter', [hotkeys.PAGE_SEARCH_ATTRIBUTE]: undefined })),
      'input',
    );
    assert.equal(optedOut[0][hotkeys.PAGE_SEARCH_ATTRIBUTE], undefined);
  });
});

describe('command matching', () => {
  test('matches case-insensitive word prefixes and ignores other substrings', () => {
    assert.deepEqual(labels(palette.flattenSections(sections('with'))), ['Withdrawals']);
    assert.deepEqual(labels(palette.flattenSections(sections('USERS'))), ['Users']);
    assert.deepEqual(labels(palette.flattenSections(sections('ra li'))), ['Rate Limits & IPs']);
    assert.equal(palette.commandMatchRank({ label: 'Withdrawals' }, 'raw'), -1);
    assert.equal(palette.commandMatchRank({ label: 'Withdrawals' }, 'drawals'), -1);
  });

  test('ranks a label prefix before a word prefix before a keyword match, keeping table order', () => {
    const commands = [
      { label: 'Bill Settings', keywords: ['limits'] },
      { label: 'Rate Limits & IPs' },
      { label: 'Limits & Fees' },
    ];
    assert.deepEqual(palette.filterCommands(commands, 'limits').map((c) => c.label), [
      'Limits & Fees', 'Rate Limits & IPs', 'Bill Settings',
    ]);
    assert.equal(palette.commandMatchRank({ label: 'Limits & Fees' }, 'lim'), 0);
    assert.equal(palette.commandMatchRank({ label: 'Rate Limits & IPs' }, 'lim'), 1);
    assert.equal(palette.commandMatchRank({ label: 'Bill Settings', keywords: ['limits'] }, 'lim'), 2);
  });

  test('every word of the query must match', () => {
    assert.equal(palette.commandMatchRank({ label: 'Rate Limits & IPs' }, 'rate fees'), -1);
    assert.equal(palette.commandMatchRank({ label: 'Theme: Dark', keywords: ['appearance'] }, 'appearance dark'), 2);
  });

  test('keywords find actions, and accents and punctuation are ignored', () => {
    assert.deepEqual(labels(palette.flattenSections(sections('logout'))), ['Sign out']);
    assert.deepEqual(labels(palette.flattenSections(sections('appearance'))), ['Theme: Light', 'Theme: Dark']);
    assert.equal(palette.commandMatchRank({ label: 'Café rates' }, 'cafe'), 0);
    assert.equal(palette.commandMatchRank({ label: 'Limits & Fees' }, '&&'), -1);
  });

  test('an empty query keeps every command in order', () => {
    assert.deepEqual(palette.filterCommands(PAGES, '   ').map((c) => c.label), PAGES.map((c) => c.label));
  });
});

describe('paletteSearchKey', () => {
  test('searches only from two sanitised characters', () => {
    for (const text of ['', ' ', 'a', ' a ', '%%', '!!', '₦']) assert.equal(palette.paletteSearchKey(text), null, text);
    assert.equal(palette.paletteSearchKey('jo'), 'jo');
    assert.equal(palette.paletteSearchKey('  jo!  '), 'jo');
    assert.equal(palette.paletteSearchKey('joan@example.com'), 'joan@example.com');
  });

  test('caps the query at the server limit', () => {
    assert.equal(palette.paletteSearchKey('x'.repeat(200))?.length, palette.PALETTE_QUERY_MAX);
  });
});

describe('isSafeHref', () => {
  test('accepts same-site paths only', () => {
    for (const href of ['/users/u1', '/withdrawals?id=w1', '/coupons?search=SAVE10', '/']) {
      assert.equal(palette.isSafeHref(href), true, href);
    }
    for (const href of [
      '', '//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil.example', '/a\nb', 'users', 42, null,
    ]) {
      assert.equal(palette.isSafeHref(href), false, String(href));
    }
    assert.equal(palette.isSafeHref(`/${'a'.repeat(3000)}`), false);
  });
});

describe('readSearchResponse', () => {
  const body = {
    success: true,
    request_id: 'req-1',
    query: 'jo',
    groups: [
      {
        key: 'users',
        label: 'Users',
        more_href: '/users?search=jo',
        items: [
          { id: 'u1', title: 'Joan Obi', subtitle: '@joan', meta: null, status: 'active', href: '/users/u1' },
          { id: 'u1', title: 'Duplicate', subtitle: null, meta: null, status: null, href: '/users/u1' },
          { id: 'u2', title: 'Bad link', subtitle: null, meta: null, status: null, href: 'https://evil.example' },
          { id: 'u3', title: '   ', subtitle: null, meta: null, status: null, href: '/users/u3' },
          { id: 'u4', title: 'Jo Ade', subtitle: 7, meta: '', status: null, href: '/users/u4' },
        ],
      },
      { key: 'coupons', label: 'Coupons', more_href: '//evil.example', items: [] },
      { key: 'users', label: 'Users again', more_href: null, items: [{ id: 'x', title: 'X', href: '/users/x' }] },
      { key: 'withdrawals', label: 'Withdrawals', more_href: 'javascript:alert(1)', items: [
        { id: 'w1', title: '₦50,000.00 to •••• 1234', subtitle: 'Joan Obi', meta: '9 Oct 2026, 14:02 WAT', status: 'pending_review', href: '/withdrawals?id=w1' },
      ] },
      'nonsense',
    ],
    partial: { transactions: 'Transactions could not be searched.', coupons: 42 },
  };

  test('keeps valid groups and items and drops anything unsafe or malformed', () => {
    const result = palette.readSearchResponse(body);
    assert.ok(result);
    assert.equal(result.query, 'jo');
    assert.deepEqual(result.groups.map((g) => g.key), ['users', 'withdrawals']);
    assert.deepEqual(result.groups[0].items.map((i) => i.id), ['u1', 'u4']);
    assert.equal(result.groups[0].moreHref, '/users?search=jo');
    assert.equal(result.groups[1].moreHref, null);
    assert.deepEqual(result.groups[0].items[1], {
      id: 'u4', title: 'Jo Ade', subtitle: null, meta: null, status: null, href: '/users/u4',
    });
    assert.deepEqual(result.partial, ['transactions']);
  });

  test('refuses a body without a groups array', () => {
    assert.equal(palette.readSearchResponse({ success: true }), null);
    assert.equal(palette.readSearchResponse({ groups: 'users' }), null);
  });

  test('handles an empty, permission-filtered answer', () => {
    assert.deepEqual(palette.readSearchResponse({ query: 'jo', groups: [], partial: {} }), { query: 'jo', groups: [], partial: [] });
  });

  test('caps very long text', () => {
    const long = palette.readSearchResponse({ groups: [{ key: 'users', label: 'Users', items: [
      { id: 'u', title: 'x'.repeat(500), href: '/users/u' },
    ] }] });
    assert.equal(long?.groups[0].items[0].title.length, 200);
  });
});

describe('recents', () => {
  const recent = (href: string, title = href, kind = 'page'): PaletteRecent => ({ href, title, subtitle: null, kind });

  test('parses stored recents defensively', () => {
    for (const raw of [null, undefined, '', '{', '"x"', '{}', '42']) assert.deepEqual(palette.parseRecents(raw), []);
    const stored = JSON.stringify([
      recent('/users', 'Users'),
      { href: '//evil.example', title: 'Bad', kind: 'page' },
      { href: '/x', title: '', kind: 'page' },
      { href: '/y', title: 'Y', kind: 'Not A Kind' },
      recent('/users', 'Users again'),
      { ...recent('/users/u1', 'Joan Obi', 'users'), subtitle: '@joan' },
    ]);
    assert.deepEqual(palette.parseRecents(stored), [
      recent('/users', 'Users'),
      { href: '/users/u1', title: 'Joan Obi', subtitle: '@joan', kind: 'users' },
    ]);
  });

  test('drops records of a kind the palette no longer searches, such as the retired flags group', () => {
    const user = { href: '/users/u1', title: 'Joan Obi', subtitle: '@joan', kind: 'users' };
    const stored = JSON.stringify([
      { href: '/flagged-transactions?id=f1', title: 'Withdrawal flag · ₦500,000.00', subtitle: '@ada', kind: 'flags' },
      user,
      { href: '/mystery?id=m1', title: 'Mystery', subtitle: null, kind: 'mystery' },
    ]);
    assert.deepEqual(palette.parseRecents(stored), [user]);

    const storage = new MemoryStorage();
    const key = palette.recentStorageKey('ada');
    storage.setItem(key, stored);
    const loaded = palette.loadRecents(key, storage);
    assert.deepEqual(loaded, [user]);
    const shown = sections('', { recents: loaded, recordKinds: null })[0];
    assert.equal(shown.label, 'Recent');
    assert.deepEqual(shown.options.map((option) => option.href), ['/users/u1']);

    palette.saveRecent(key, recent('/coupons', 'Coupons'), storage);
    const rewritten = storage.getItem(key) ?? '';
    assert.ok(!rewritten.includes('flagged-transactions'), rewritten);
    assert.deepEqual(palette.loadRecents(key, storage).map((r) => r.href), ['/coupons', '/users/u1']);
  });

  test('keeps at most five, newest first, without duplicates', () => {
    const many = JSON.stringify(Array.from({ length: 9 }, (_, i) => recent(`/p${i}`)));
    assert.equal(palette.parseRecents(many).length, palette.PALETTE_RECENT_LIMIT);
    let list: PaletteRecent[] = [];
    for (const href of ['/a', '/b', '/c', '/d', '/e', '/f']) list = palette.rememberRecent(list, recent(href));
    assert.deepEqual(list.map((r) => r.href), ['/f', '/e', '/d', '/c', '/b']);
    list = palette.rememberRecent(list, recent('/c', 'Again'));
    assert.deepEqual(list.map((r) => r.href), ['/c', '/f', '/e', '/d', '/b']);
    assert.equal(list[0].title, 'Again');
  });

  test('storage is per viewer and survives a round trip', () => {
    const storage = new MemoryStorage();
    const key = palette.recentStorageKey('ada');
    assert.notEqual(key, palette.recentStorageKey('bola'));
    assert.deepEqual(palette.saveRecent(key, recent('/users', 'Users'), storage), [recent('/users', 'Users')]);
    palette.saveRecent(key, recent('/coupons', 'Coupons'), storage);
    assert.deepEqual(palette.loadRecents(key, storage).map((r) => r.href), ['/coupons', '/users']);
    assert.deepEqual(palette.loadRecents(palette.recentStorageKey('bola'), storage), []);
  });

  test('a storage that throws, or no viewer, never breaks the palette', () => {
    assert.deepEqual(palette.loadRecents('k', THROWING), []);
    assert.equal(palette.saveRecent('k', recent('/users'), THROWING), null);
    assert.equal(palette.forgetRecents('k', THROWING), false);
    assert.deepEqual(palette.loadRecents(null, new MemoryStorage()), []);
    assert.equal(palette.saveRecent(null, recent('/users'), new MemoryStorage()), null);
    assert.deepEqual(palette.loadRecents('k', null), []);
    assert.deepEqual(palette.loadRecents('k'), []);
    assert.equal(palette.forgetRecents('k'), false);
  });

  test('signing out forgets only that viewer’s history', () => {
    const storage = new MemoryStorage();
    const ada = palette.recentStorageKey('ada');
    const bola = palette.recentStorageKey('bola');
    palette.saveRecent(ada, recent('/users'), storage);
    palette.saveRecent(bola, recent('/coupons'), storage);
    assert.equal(palette.forgetRecents(ada, storage), true);
    assert.deepEqual(palette.loadRecents(ada, storage), []);
    assert.deepEqual(palette.loadRecents(bola, storage).map((r) => r.href), ['/coupons']);
    assert.equal(palette.forgetRecents(null, storage), false);
  });
});

describe('buildPaletteSections', () => {
  test('an empty query shows Recent, Go to and Actions in that order', () => {
    const result = sections('', { recents: [{ href: '/users', title: 'Users', subtitle: 'People', kind: 'page' }] });
    assert.deepEqual(result.map((s) => s.label), ['Recent', 'Go to', 'Actions']);
    assert.deepEqual(labels(result[1].options), PAGES.map((p) => p.label));
    assert.deepEqual(labels(result[2].options), ACTIONS.map((a) => a.label));
    assert.equal(result[0].options[0].hint, 'Page');
    assert.ok(result.every((section) => section.source === 'local'));
  });

  test('recent pages the admin can no longer open are hidden', () => {
    const result = sections('', { recents: [
      { href: '/admin-accounts', title: 'Admins', subtitle: null, kind: 'page' },
      { href: '/users', title: 'Users', subtitle: null, kind: 'page' },
    ] });
    assert.deepEqual(result[0].options.map((o) => o.href), ['/users']);
  });

  test('recent records show only while record search is available', () => {
    const recents = [{ href: '/users/u1', title: 'Joan Obi', subtitle: '@joan', kind: 'users' }];
    assert.equal(sections('', { recents })[0].label, 'Recent');
    assert.equal(sections('', { recents, recordsEnabled: false })[0].label, 'Go to');
    assert.equal(sections('', { recents })[0].options[0].hint, 'User');
  });

  test('recent records show only for search groups the admin can still read', () => {
    const recents = [
      { href: '/users/u1', title: 'Joan Obi', subtitle: '@joan', kind: 'users' },
      { href: '/withdrawals?id=w1', title: '₦5,000.00 to •••• 1234', subtitle: 'Joan Obi', kind: 'withdrawals' },
      { href: '/users', title: 'Users', subtitle: 'People', kind: 'page' },
    ];
    const onlyUsers = sections('', { recents, recordKinds: ['users'] });
    assert.deepEqual(onlyUsers[0].options.map((o) => o.href), ['/users/u1', '/users']);
    const none = sections('', { recents, recordKinds: [] });
    assert.deepEqual(none[0].options.map((o) => o.href), ['/users']);
    const unrestricted = sections('', { recents, recordKinds: null });
    assert.equal(unrestricted[0].options.length, 3);
  });

  test('without recents the Recent group is left out', () => {
    assert.deepEqual(sections('').map((s) => s.label), ['Go to', 'Actions']);
  });

  test('a typed query filters commands locally, then lists search groups with See all last', () => {
    const result = sections('jo', { groups: GROUPS });
    assert.deepEqual(result.map((s) => s.label), ['Users', 'Withdrawals']);
    assert.deepEqual(result.map((s) => s.source), ['search', 'search']);
    assert.deepEqual(labels(result[0].options), ['Joan Obi', 'See all matching users']);
    assert.equal(result[0].options[1].href, '/users?search=jo');
    assert.equal(result[0].options[1].recent, null);
    assert.deepEqual(labels(result[1].options), ['₦50,000.00 to •••• 1234']);
    assert.equal(result[1].options[0].status, 'pending_review');
    assert.deepEqual(result[1].options[0].recent, {
      href: '/withdrawals?id=w1', title: '₦50,000.00 to •••• 1234', subtitle: 'Joan Obi', kind: 'withdrawals',
    });
  });

  test('a result from a group the palette does not know still opens but is never remembered as a recent', () => {
    const stale: PaletteSearchGroup = {
      key: 'flags',
      label: 'Flagged transactions',
      moreHref: null,
      items: [{ id: 'f1', title: 'Withdrawal flag', subtitle: '@ada', meta: null, status: 'pending_review', href: '/withdrawals?id=w1' }],
    };
    const result = sections('jo', { groups: [stale, GROUPS[0]] });
    const flagged = result.find((s) => s.label === 'Flagged transactions');
    assert.equal(flagged?.options[0].href, '/withdrawals?id=w1');
    assert.equal(flagged?.options[0].recent, null);
    assert.equal(result.find((s) => s.label === 'Users')?.options[0].recent?.kind, 'users');
  });

  test('local matches come before search groups so late results never move the highlight', () => {
    const result = sections('users', { groups: GROUPS });
    assert.deepEqual(result.map((s) => s.label), ['Go to', 'Users', 'Withdrawals']);
    assert.equal(palette.flattenSections(result)[0].label, 'Users');
  });

  test('a typed query hides recents', () => {
    const result = sections('use', { recents: [{ href: '/users', title: 'Users', subtitle: null, kind: 'page' }] });
    assert.ok(!result.some((s) => s.id === 'recent'));
  });

  test('unsafe pages, empty labels and actions without a handler are dropped, and keys stay unique', () => {
    const result = palette.buildPaletteSections({
      query: '',
      recents: [],
      pages: [page('ok', 'Fine'), { id: 'bad', label: 'Bad', href: '//evil.example' }, { id: 'blank', label: '  ', href: '/blank' }, page('ok', 'Twin')],
      actions: [{ id: 'noop', label: 'Does nothing' }, action('run', 'Runs')],
      groups: [],
      recordsEnabled: true,
    });
    assert.deepEqual(result.map((s) => labels(s.options)), [['Fine'], ['Runs']]);
    const keys = palette.flattenSections(result).map((o) => o.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  test('link commands are links that remember a page; actions are not remembered', () => {
    const [pages, actions] = sections('');
    assert.equal(pages.options[0].type, 'link');
    assert.deepEqual(pages.options[0].recent, { href: '/dashboard', title: 'Dashboard', subtitle: 'Operations', kind: 'page' });
    assert.equal(actions.options[0].type, 'action');
    assert.equal(actions.options[0].recent, null);
    assert.equal(actions.options[1].hint, 'Current');
  });
});

describe('active option movement', () => {
  const options = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];

  test('resolves the highlighted option by key, falling back to the first', () => {
    assert.equal(palette.resolveActiveIndex(options, null), 0);
    assert.equal(palette.resolveActiveIndex(options, 'c'), 2);
    assert.equal(palette.resolveActiveIndex(options, 'gone'), 0);
    assert.equal(palette.resolveActiveIndex([], 'a'), -1);
  });

  test('arrows wrap across every group, Home and End jump to the ends', () => {
    assert.equal(palette.movePaletteIndex(2, 3, 'next'), 0);
    assert.equal(palette.movePaletteIndex(0, 3, 'previous'), 2);
    assert.equal(palette.movePaletteIndex(1, 3, 'first'), 0);
    assert.equal(palette.movePaletteIndex(0, 3, 'last'), 2);
    assert.equal(palette.movePaletteIndex(-1, 3, 'next'), 0);
    assert.equal(palette.movePaletteIndex(0, 0, 'next'), -1);
    const flat = palette.flattenSections(sections('jo', { groups: GROUPS }));
    assert.equal(flat[palette.movePaletteIndex(1, flat.length, 'next')].label, '₦50,000.00 to •••• 1234');
  });

  test('maps keys to palette actions', () => {
    const plain = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'ArrowDown' }), 'next');
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'ArrowUp' }), 'previous');
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'Home' }), 'first');
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'End' }), 'last');
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'Enter' }), 'open');
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'Enter', ctrlKey: true }), 'open-new-tab');
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'Enter', metaKey: true }), 'open-new-tab');
  });

  test('leaves text editing keys, modified arrows and IME input to the field', () => {
    const plain = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'Home', shiftKey: true }), null);
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'ArrowDown', altKey: true }), null);
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'Enter', shiftKey: true }), null);
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'Enter', ctrlKey: true, shiftKey: true }), null);
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'Enter', isComposing: true }), null);
    assert.equal(palette.paletteKeyAction({ ...plain, key: 'Enter', keyCode: 229 }), null);
    for (const name of ['a', 'Backspace', 'ArrowLeft', 'Tab', 'Escape']) {
      assert.equal(palette.paletteKeyAction({ ...plain, key: name }), null, name);
    }
  });
});

describe('palette copy', () => {
  test('failure messages never echo server or network error text', () => {
    const failure = (kind: ApiFailure['kind'], status: number | null): ApiFailure => ({
      kind, status, code: 'X', message: 'relation "users" does not exist', requestId: 'r', details: null, outcomeUnknown: false,
    });
    const network = palette.searchFailureMessage(failure('network', null));
    const timeout = palette.searchFailureMessage(failure('timeout', null));
    const limited = palette.searchFailureMessage(failure('http', 429));
    const server = palette.searchFailureMessage(failure('http', 500));
    for (const text of [network, timeout, limited, server]) {
      assert.ok(!text.includes('relation'), text);
      assert.ok(text.length > 0);
    }
    assert.match(network, /reach the server/);
    assert.match(timeout, /too long/);
    assert.match(limited, /Too many searches/);
    assert.match(server, /could not be completed/);
  });

  test('partial results name the groups that failed, never the reason', () => {
    assert.equal(
      palette.partialSearchDetail(['withdrawals', 'coupons', 'card_submissions']),
      'Withdrawals, Coupons and Card submissions could not be searched. Try again in a moment.',
    );
    assert.equal(palette.partialSearchDetail(['transactions']), 'Transactions could not be searched. Try again in a moment.');
    assert.equal(palette.partialSearchDetail(['mystery', 'flags']), 'Try again in a moment.');
  });

  test('status announcements wait for results and say what happened', () => {
    const base = { query: 'jo', count: 0, pending: false, slow: false, failed: false, partial: false };
    assert.equal(palette.paletteStatus({ ...base, query: '  ' }), '');
    assert.equal(palette.paletteStatus({ ...base, pending: true }), '');
    assert.equal(palette.paletteStatus({ ...base, pending: true, slow: true }), 'Searching…');
    assert.equal(palette.paletteStatus(base), 'No matches for “jo”.');
    assert.equal(palette.paletteStatus({ ...base, count: 1 }), '1 result.');
    assert.equal(palette.paletteStatus({ ...base, count: 3, partial: true }), '3 results. Some results could not be loaded.');
    assert.match(palette.paletteStatus({ ...base, failed: true, count: 2 }), /^Search is unavailable right now\. Showing 2 results/);
  });

  test('long queries are shortened when echoed back', () => {
    const text = palette.noMatchesText('a'.repeat(100));
    assert.ok(text.length < 60);
    assert.ok(text.endsWith('…”'));
  });

  test('options get a full spoken name with a readable status', () => {
    assert.equal(
      palette.optionAccessibleName({ label: 'Joan Obi', subtitle: '@joan', meta: '₦5,000.00', status: 'pending_review', hint: null }),
      'Joan Obi, @joan, ₦5,000.00, pending review',
    );
    assert.equal(palette.optionAccessibleName({ label: 'Users', subtitle: null, meta: null, status: null, hint: 'Page' }), 'Users, Page');
  });

  test('masked account tails are spoken as hidden digits, never as bullets', () => {
    assert.equal(palette.speakMasked('₦50,000.00 to •••• 1234'), '₦50,000.00 to hidden, ending 1 2 3 4');
    assert.equal(palette.speakMasked('•••• · GTBank'), 'hidden · GTBank');
    assert.equal(palette.speakMasked('••••987654 and •••• 12'), 'hidden, ending 9 8 7 6 5 4 and hidden, ending 1 2');
    assert.equal(palette.speakMasked('No mask here'), 'No mask here');
    assert.equal(
      palette.optionAccessibleName({
        label: '₦50,000.00 to •••• 1234', subtitle: 'Joan Obi', meta: null, status: 'pending_review', hint: null,
      }),
      '₦50,000.00 to hidden, ending 1 2 3 4, Joan Obi, pending review',
    );
  });

  test('the screen-reader hint names the platform key', () => {
    assert.match(palette.paletteHintText(true), /Command Enter/);
    assert.match(palette.paletteHintText(false), /Control Enter/);
  });
});

describe('CommandPalette markup', () => {
  function renderPalette(props: Partial<CommandPaletteProps> = {}) {
    return render(createElement(palette.CommandPalette, {
      open: true,
      onClose: () => {},
      pages: PAGES,
      actions: ACTIONS,
      viewer: 'ada',
      ...props,
    }));
  }

  test('renders nothing while closed', () => {
    assert.equal(render(createElement(palette.CommandPalette, { open: false, onClose: () => {}, pages: PAGES })), '');
  });

  test('is a labelled modal dialog with a combobox wired to a grouped listbox', () => {
    const html = renderPalette();
    const [dialog] = tagsOf(html, 'div').filter((attrs) => attrs.role === 'dialog');
    assert.equal(dialog['aria-modal'], 'true');
    assert.equal(textById(html, dialog['aria-labelledby']), 'Command palette');

    const [input] = tagsOf(html, 'input');
    assert.equal(input.role, 'combobox');
    assert.equal(input['aria-autocomplete'], 'list');
    assert.equal(input['aria-expanded'], 'true');
    assert.ok(input['aria-label']);
    assert.ok(textById(html, input['aria-describedby'])?.includes('arrow keys'));

    const [listbox] = tagsOf(html, 'div').filter((attrs) => attrs.role === 'listbox');
    assert.equal(input['aria-controls'], listbox.id);

    const groups = tagsOf(html, 'div').filter((attrs) => attrs.role === 'group');
    assert.deepEqual(groups.map((g) => textById(html, g['aria-labelledby'])), ['Go to', 'Actions']);

    const options = [...tagsOf(html, 'a'), ...tagsOf(html, 'div')].filter((attrs) => attrs.role === 'option');
    assert.equal(options.length, PAGES.length + ACTIONS.length);
    const selected = options.filter((o) => o['aria-selected'] === 'true');
    assert.equal(selected.length, 1);
    assert.equal(input['aria-activedescendant'], selected[0].id);
    assert.equal(selected[0].href, '/dashboard');
    assert.equal(selected[0]['data-active'], 'keyboard');
  });

  test('page options are real links kept out of the tab order; actions are plain options', () => {
    const html = renderPalette();
    const links = tagsOf(html, 'a').filter((attrs) => attrs.role === 'option');
    assert.deepEqual(links.map((a) => a.href), PAGES.map((p) => p.href));
    for (const link of links) assert.equal(link.tabindex, '-1');
    const actions = tagsOf(html, 'div').filter((attrs) => attrs.role === 'option');
    assert.deepEqual(actions.map((a) => a['aria-label']), ['Theme: Light', 'Theme: Dark, Current', 'Keyboard shortcuts', 'Sign out']);
  });

  test('announces through a status region, offers a close button, and hides the key legend from screen readers', () => {
    const html = renderPalette();
    assert.equal(tagsOf(html, 'div').filter((attrs) => attrs.role === 'status').length, 1);
    const close = tagsOf(html, 'button').find((attrs) => attrs['aria-label'] === 'Close command palette');
    assert.ok(close);
    assert.equal(close.type, 'button');
    const hidden = tagsOf(html, 'div').filter((attrs: Attrs) => attrs['aria-hidden'] === 'true');
    assert.ok(hidden.length >= 1);
    assert.ok(!html.includes('style="'));
  });

  test('labels the field for page-only search when record search is unavailable', () => {
    const [withSearch] = tagsOf(renderPalette({ searchPath: '/api/search' }), 'input');
    const [withoutSearch] = tagsOf(renderPalette({ searchPath: null }), 'input');
    assert.equal(withSearch['aria-label'], 'Search records, pages and commands');
    assert.equal(withoutSearch['aria-label'], 'Search pages and commands');
  });
});

describe('KeyboardShortcutsDialog markup', () => {
  test('lists every shortcut with spoken key names', () => {
    const html = render(createElement(palette.KeyboardShortcutsDialog, { open: true, onClose: () => {} }));
    const text = textOf(html);
    assert.ok(text.includes('Keyboard shortcuts'));
    for (const section of hotkeys.SHORTCUT_SECTIONS) {
      assert.ok(text.includes(section.title), section.title);
      for (const entry of section.entries) assert.ok(text.includes(entry.description), entry.description);
    }
    assert.ok(tagsOf(html, 'kbd').length >= 10);
    assert.ok(text.includes('Control'));
    assert.ok(text.includes('Slash'));
    assert.ok(text.includes(' or '));
    assert.equal(tagsOf(html, 'div').filter((attrs) => attrs.role === 'dialog').length, 1);
  });

  test('renders nothing while closed', () => {
    assert.equal(render(createElement(palette.KeyboardShortcutsDialog, { open: false, onClose: () => {} })), '');
  });
});

describe('house rules for the palette files', () => {
  const sources = {
    'CommandPalette.tsx': uiText('CommandPalette.tsx'),
    'CommandPalette.module.css': uiText('CommandPalette.module.css'),
    'useHotkeys.ts': uiText('useHotkeys.ts'),
    'Shell.module.css': shellText('Shell.module.css'),
  };

  test('no comments and no static inline styles', () => {
    for (const [name, text] of Object.entries(sources)) {
      assert.ok(!/\/\*/.test(text), `${name} has a block comment`);
      assert.ok(!/^\s*\/\/(?!\/)/m.test(text), `${name} has a line comment`);
      assert.ok(!text.includes('style={{'), `${name} has a static inline style`);
    }
  });

  test('colours and layers come from tokens', () => {
    for (const name of ['CommandPalette.module.css', 'Shell.module.css'] as const) {
      const css = sources[name];
      assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), `${name} has a literal colour`);
      assert.ok(!/\b(?:rgba?|hsla?)\(/i.test(css), `${name} has a literal colour function`);
      for (const [, value] of css.matchAll(/z-index:\s*([^;]+);/g)) {
        assert.match(value.trim(), /^var\(--z-[a-z]+\)$/, `${name} z-index ${value}`);
      }
    }
  });

  test('motion is switched off for reduced-motion users', () => {
    const css = sources['CommandPalette.module.css'];
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.ok(reduced.includes('animation: none'));
    assert.ok(reduced.includes('.scrim'));
    assert.ok(reduced.includes('.dialog'));
  });

  test('the palette becomes a full-screen sheet on phones', () => {
    const css = sources['CommandPalette.module.css'];
    const mobile = css.slice(css.indexOf('@media (max-width: 768px)'));
    assert.match(mobile, /\.dialog\s*\{[^}]*border-radius:\s*0/);
    assert.match(mobile, /\.scrim\s*\{[^}]*padding:\s*0/);
  });
});
