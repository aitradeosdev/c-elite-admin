'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { topmostTrap } from './overlayStack';

export type HotkeyCommand = 'palette' | 'search' | 'help';

export interface HotkeyInput {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  altGraph?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
  defaultPrevented?: boolean;
}

export interface HotkeyContext {
  apple: boolean;
  editable: boolean;
}

export interface HotkeyGate {
  overlayOpen: boolean;
  ownsOverlay: boolean;
}

export interface PlatformSource {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string } | null;
}

export type ShortcutKey = 'mod' | 'enter' | 'escape' | 'up' | 'down' | 'home' | 'end' | 'k' | '/' | '?';

export interface ShortcutKeyLabel {
  text: string;
  spoken: string;
}

export interface ShortcutEntry {
  id: string;
  description: string;
  chords: ReadonlyArray<ReadonlyArray<ShortcutKey>>;
}

export interface ShortcutSection {
  id: string;
  title: string;
  entries: ReadonlyArray<ShortcutEntry>;
}

export interface PaletteChordHint {
  text: string;
  keyshortcuts: string;
}

export const PAGE_SEARCH_ATTRIBUTE = 'data-page-search';

const IME_KEY_CODE = 229;
const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;
const LATIN_LETTER = /^[a-z]$/i;
const PHYSICAL_LETTER = /^Key([A-Z])$/;
const HIDDEN_ANCESTOR = '[inert], [hidden], [aria-hidden="true"]';
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);
const TEXT_ROLES: ReadonlySet<string> = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

export const SHORTCUT_SECTIONS: ReadonlyArray<ShortcutSection> = [
  {
    id: 'anywhere',
    title: 'Anywhere',
    entries: [
      { id: 'palette', description: 'Open or close the command palette', chords: [['mod', 'k']] },
      { id: 'search', description: 'Search this page, or open the command palette', chords: [['/']] },
      { id: 'help', description: 'Show keyboard shortcuts', chords: [['?']] },
      { id: 'close', description: 'Close the open dialog, panel or menu', chords: [['escape']] },
    ],
  },
  {
    id: 'palette',
    title: 'In the command palette',
    entries: [
      { id: 'move', description: 'Move through the results', chords: [['up'], ['down']] },
      { id: 'jump', description: 'Jump to the first or last result', chords: [['home'], ['end']] },
      { id: 'open', description: 'Open the highlighted result', chords: [['enter']] },
      { id: 'new-tab', description: 'Open the highlighted page in a new tab', chords: [['mod', 'enter']] },
      { id: 'dismiss', description: 'Close the command palette', chords: [['escape']] },
    ],
  },
];

export function isApplePlatform(source: PlatformSource | null | undefined): boolean {
  if (!source) return false;
  const hint = source.userAgentData?.platform || source.platform || source.userAgent || '';
  return APPLE_PLATFORM.test(hint);
}

export function paletteChordHint(apple: boolean): PaletteChordHint {
  return apple ? { text: '⌘K', keyshortcuts: 'Meta+K' } : { text: 'Ctrl K', keyshortcuts: 'Control+K' };
}

export function shortcutKeyLabel(key: ShortcutKey, apple: boolean): ShortcutKeyLabel {
  switch (key) {
    case 'mod':
      return apple ? { text: '⌘', spoken: 'Command' } : { text: 'Ctrl', spoken: 'Control' };
    case 'enter':
      return apple ? { text: '↩', spoken: 'Return' } : { text: 'Enter', spoken: 'Enter' };
    case 'escape':
      return { text: 'Esc', spoken: 'Escape' };
    case 'up':
      return { text: '↑', spoken: 'Up arrow' };
    case 'down':
      return { text: '↓', spoken: 'Down arrow' };
    case 'home':
      return { text: 'Home', spoken: 'Home' };
    case 'end':
      return { text: 'End', spoken: 'End' };
    case 'k':
      return { text: 'K', spoken: 'K' };
    case '/':
      return { text: '/', spoken: 'Slash' };
    case '?':
      return { text: '?', spoken: 'Question mark' };
  }
}

interface EditableLike {
  tagName?: unknown;
  type?: unknown;
  isContentEditable?: unknown;
  getAttribute?: (name: string) => string | null;
}

export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const node = target as EditableLike;
  if (node.isContentEditable === true) return true;
  const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = typeof node.type === 'string' && node.type !== '' ? node.type.toLowerCase() : 'text';
    return !NON_TEXT_INPUTS.has(type);
  }
  const role = typeof node.getAttribute === 'function' ? node.getAttribute('role') : null;
  return role !== null && TEXT_ROLES.has(role.trim().toLowerCase());
}

export function isComposingInput(input: Pick<HotkeyInput, 'isComposing' | 'keyCode'>): boolean {
  return input.isComposing === true || input.keyCode === IME_KEY_CODE;
}

function letterOf(input: Pick<HotkeyInput, 'key' | 'code'>): string {
  if (LATIN_LETTER.test(input.key)) return input.key.toLowerCase();
  const physical = PHYSICAL_LETTER.exec(input.code ?? '');
  return physical ? physical[1].toLowerCase() : '';
}

export function isPaletteChord(input: HotkeyInput, apple: boolean): boolean {
  if (input.altKey || input.shiftKey || letterOf(input) !== 'k') return false;
  return apple ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey;
}

function typesCharacter(input: HotkeyInput, apple: boolean): boolean {
  if (input.metaKey) return false;
  if (apple) return !input.ctrlKey;
  if (input.altGraph === true || (input.ctrlKey && input.altKey)) return true;
  return !input.ctrlKey && !input.altKey;
}

export function matchHotkey(input: HotkeyInput, context: HotkeyContext): HotkeyCommand | null {
  if (input.defaultPrevented || input.repeat || isComposingInput(input)) return null;
  if (isPaletteChord(input, context.apple)) return 'palette';
  if (context.editable || !typesCharacter(input, context.apple)) return null;
  if (input.key === '/') return 'search';
  if (input.key === '?') return 'help';
  return null;
}

export function hotkeyAllowed(command: HotkeyCommand, gate: HotkeyGate): boolean {
  if (!gate.overlayOpen) return true;
  return command === 'palette' && gate.ownsOverlay;
}

export function isUsableSearchField(field: HTMLInputElement): boolean {
  if (field.disabled || field.readOnly) return false;
  if (field.closest(HIDDEN_ANCESTOR)) return false;
  return field.getClientRects().length > 0;
}

export function findPageSearchInput(root: ParentNode | null | undefined): HTMLInputElement | null {
  if (!root) return null;
  const fields = Array.from(root.querySelectorAll<HTMLInputElement>(`input[${PAGE_SEARCH_ATTRIBUTE}]`));
  return fields.find(isUsableSearchField) ?? null;
}

export function toHotkeyInput(event: KeyboardEvent): HotkeyInput {
  return {
    key: event.key,
    code: event.code,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    altGraph: typeof event.getModifierState === 'function' && event.getModifierState('AltGraph'),
    isComposing: event.isComposing,
    keyCode: event.keyCode,
    repeat: event.repeat,
    defaultPrevented: event.defaultPrevented,
  };
}

function keyTarget(event: KeyboardEvent): EventTarget | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return path.length > 0 ? path[0] : event.target;
}

const subscribeNever = () => () => {};
const readPlatform = (): boolean | null => isApplePlatform(typeof navigator === 'undefined' ? null : navigator);
const readServerPlatform = (): boolean | null => null;

export function useApplePlatform(): boolean | null {
  return useSyncExternalStore(subscribeNever, readPlatform, readServerPlatform);
}

export interface UseHotkeysOptions {
  onPalette: () => void;
  onSearch: () => void;
  onHelp: () => void;
  ownsOverlay?: () => boolean;
}

export function useHotkeys(options: UseHotkeysOptions): void {
  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = matchHotkey(toHotkeyInput(event), {
        apple: readPlatform() === true,
        editable: isEditableTarget(keyTarget(event)),
      });
      if (!command) return;
      const handlers = latest.current;
      const gate: HotkeyGate = {
        overlayOpen: topmostTrap() !== undefined,
        ownsOverlay: handlers.ownsOverlay?.() ?? false,
      };
      if (!hotkeyAllowed(command, gate)) return;
      event.preventDefault();
      if (command === 'palette') handlers.onPalette();
      else if (command === 'search') handlers.onSearch();
      else handlers.onHelp();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
