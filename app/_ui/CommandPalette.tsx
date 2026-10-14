'use client';

import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ChangeEvent, type ComponentType, type KeyboardEvent, type MouseEvent,
} from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine, ArrowLeftRight, ArrowRight, CreditCard, History, RotateCw, Search, TicketPercent, UserRound, X,
} from 'lucide-react';
import { apiRequest, type ApiBody, type ApiFailure } from '../lib/apiClient';
import { MASK, maskForDisplay } from '../lib/mask';
import { sanitizeSearch } from '../lib/sanitize';
import { Button } from './Button';
import { normalizeSearchText } from './Combobox';
import { Notice } from './Notice';
import { Modal } from './Overlay';
import { moveRovingIndex, type RovingMove } from './overlayStack';
import { StatusDot, statusLabel } from './Status';
import { useDebouncedValue } from './useDebouncedValue';
import { useFocusTrap } from './useFocusTrap';
import {
  SHORTCUT_SECTIONS, isComposingInput, shortcutKeyLabel, useApplePlatform,
  type ShortcutKey, type ShortcutKeyLabel,
} from './useHotkeys';
import { useResource } from './useResource';
import s from './CommandPalette.module.css';

export type PaletteIcon = ComponentType<{ size?: number }>;

export interface PaletteCommand {
  id: string;
  label: string;
  subtitle?: string;
  hint?: string;
  keywords?: readonly string[];
  icon?: PaletteIcon;
  href?: string;
  onSelect?: () => void;
}

export interface PaletteSearchItem {
  id: string;
  title: string;
  subtitle: string | null;
  meta: string | null;
  status: string | null;
  href: string;
}

export interface PaletteSearchGroup {
  key: string;
  label: string;
  items: PaletteSearchItem[];
  moreHref: string | null;
}

export interface PaletteSearchResult {
  query: string;
  groups: PaletteSearchGroup[];
  partial: string[];
}

export interface PaletteRecent {
  href: string;
  title: string;
  subtitle: string | null;
  kind: string;
}

export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PaletteOptionType = 'link' | 'action';

export interface PaletteOption {
  key: string;
  type: PaletteOptionType;
  label: string;
  subtitle: string | null;
  meta: string | null;
  status: string | null;
  hint: string | null;
  href: string | null;
  icon: PaletteIcon;
  recent: PaletteRecent | null;
  onSelect: (() => void) | null;
}

export type PaletteSectionSource = 'local' | 'search';

export interface PaletteSection {
  id: string;
  label: string;
  source: PaletteSectionSource;
  options: PaletteOption[];
}

export interface PaletteSectionsInput {
  query: string;
  recents: readonly PaletteRecent[];
  pages: readonly PaletteCommand[];
  actions: readonly PaletteCommand[];
  groups: readonly PaletteSearchGroup[];
  recordsEnabled: boolean;
  recordKinds?: readonly string[] | null;
}

export type PaletteKeyAction = RovingMove | 'open' | 'open-new-tab';

export interface PaletteKeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export interface PaletteStatusInput {
  query: string;
  count: number;
  pending: boolean;
  slow: boolean;
  failed: boolean;
  partial: boolean;
}

export const PALETTE_SEARCH_MIN_LENGTH = 2;
export const PALETTE_SEARCH_LIMIT = 5;
export const PALETTE_SEARCH_DEBOUNCE_MS = 250;
export const PALETTE_RECENT_LIMIT = 5;
export const PALETTE_QUERY_MAX = 64;

const SPINNER_DELAY_MS = 300;
const STATUS_DELAY_MS = 400;
const TEXT_LIMIT = 200;
const HREF_LIMIT = 2048;
const ECHO_LIMIT = 40;
const RECENT_STORAGE_PREFIX = 'cardelite.admin.palette.recent:';
const UNSAFE_HREF = /[\u0000-\u001f\u007f\\]/;
const WORD_BREAK = /[^\p{L}\p{N}]+/u;
const MASKED_TAIL = new RegExp(`${MASK}(?: ?([0-9A-Za-z]+))?`, 'g');

const EMPTY_GROUPS: readonly PaletteSearchGroup[] = [];

const GROUP_ICONS: Readonly<Record<string, PaletteIcon>> = {
  users: UserRound,
  withdrawals: ArrowDownToLine,
  transactions: ArrowLeftRight,
  card_submissions: CreditCard,
  coupons: TicketPercent,
};

const GROUP_LABELS: Readonly<Record<string, string>> = {
  users: 'Users',
  withdrawals: 'Withdrawals',
  transactions: 'Transactions',
  card_submissions: 'Card submissions',
  coupons: 'Coupons',
};

const KIND_LABELS: Readonly<Record<string, string>> = {
  page: 'Page',
  users: 'User',
  withdrawals: 'Withdrawal',
  transactions: 'Transaction',
  card_submissions: 'Card submission',
  coupons: 'Coupon',
};

const RECENT_KINDS: ReadonlySet<string> = new Set(Object.keys(KIND_LABELS));

const FOOTER_HINTS: ReadonlyArray<{ id: string; keys: ReadonlyArray<ShortcutKey>; text: string }> = [
  { id: 'move', keys: ['up', 'down'], text: 'to move' },
  { id: 'open', keys: ['enter'], text: 'to open' },
  { id: 'new-tab', keys: ['mod', 'enter'], text: 'for a new tab' },
  { id: 'close', keys: ['escape'], text: 'to close' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const chars = Array.from(trimmed);
  return chars.length > TEXT_LIMIT ? chars.slice(0, TEXT_LIMIT).join('') : trimmed;
}

function wordsOf(text: string): string[] {
  return normalizeSearchText(text).split(WORD_BREAK).filter(Boolean);
}

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function echo(query: string): string {
  const chars = Array.from(query.trim());
  return chars.length > ECHO_LIMIT ? `${chars.slice(0, ECHO_LIMIT).join('')}…` : chars.join('');
}

export function isSafeHref(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= HREF_LIMIT
    && value.startsWith('/')
    && !value.startsWith('//')
    && !UNSAFE_HREF.test(value);
}

export function commandMatchRank(command: Pick<PaletteCommand, 'label' | 'keywords'>, query: string): number {
  const needle = normalizeSearchText(query);
  if (!needle) return 0;
  const tokens = needle.split(WORD_BREAK).filter(Boolean);
  if (tokens.length === 0) return -1;
  const label = normalizeSearchText(command.label);
  if (label.startsWith(needle)) return 0;
  const labelWords = label.split(WORD_BREAK).filter(Boolean);
  if (tokens.every((token) => labelWords.some((word) => word.startsWith(token)))) return 1;
  const words = [...labelWords, ...(command.keywords ?? []).flatMap(wordsOf)];
  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) return 2;
  return -1;
}

export function filterCommands<T extends Pick<PaletteCommand, 'label' | 'keywords'>>(
  commands: readonly T[],
  query: string,
): T[] {
  if (!normalizeSearchText(query)) return [...commands];
  return commands
    .map((command, index) => ({ command, index, rank: commandMatchRank(command, query) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.command);
}

export function paletteSearchKey(text: string): string | null {
  const query = sanitizeSearch(text, PALETTE_QUERY_MAX);
  return Array.from(query).length >= PALETTE_SEARCH_MIN_LENGTH ? query : null;
}

function readSearchItem(value: unknown): PaletteSearchItem | null {
  if (!isRecord(value) || !isSafeHref(value.href)) return null;
  const id = cleanText(value.id);
  const title = cleanText(value.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    subtitle: cleanText(value.subtitle),
    meta: cleanText(value.meta),
    status: cleanText(value.status),
    href: value.href,
  };
}

export function readSearchResponse(body: ApiBody): PaletteSearchResult | null {
  if (!Array.isArray(body.groups)) return null;
  const groups: PaletteSearchGroup[] = [];
  const seenGroups = new Set<string>();
  for (const value of body.groups) {
    if (!isRecord(value) || !Array.isArray(value.items)) continue;
    const key = cleanText(value.key);
    const label = cleanText(value.label);
    if (!key || !label || seenGroups.has(key)) continue;
    const seenItems = new Set<string>();
    const items: PaletteSearchItem[] = [];
    for (const raw of value.items) {
      const item = readSearchItem(raw);
      if (!item || seenItems.has(item.id)) continue;
      seenItems.add(item.id);
      items.push(item);
    }
    if (items.length === 0) continue;
    seenGroups.add(key);
    groups.push({ key, label, items, moreHref: isSafeHref(value.more_href) ? value.more_href : null });
  }
  const partialBody = body.partial;
  const partial = isRecord(partialBody)
    ? Object.keys(partialBody).filter((key) => typeof partialBody[key] === 'string')
    : [];
  return { query: typeof body.query === 'string' ? body.query : '', groups, partial };
}

export function recentStorageKey(viewer: string): string {
  return `${RECENT_STORAGE_PREFIX}${viewer}`;
}

function readRecent(value: unknown): PaletteRecent | null {
  if (!isRecord(value) || !isSafeHref(value.href)) return null;
  const title = cleanText(value.title);
  const kind = typeof value.kind === 'string' && RECENT_KINDS.has(value.kind) ? value.kind : null;
  if (!title || !kind) return null;
  return { href: value.href, title, subtitle: cleanText(value.subtitle), kind };
}

export function parseRecents(raw: string | null | undefined): PaletteRecent[] {
  if (typeof raw !== 'string' || raw === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const recents: PaletteRecent[] = [];
  for (const value of parsed) {
    const recent = readRecent(value);
    if (!recent || recents.some((entry) => entry.href === recent.href)) continue;
    recents.push(recent);
    if (recents.length === PALETTE_RECENT_LIMIT) break;
  }
  return recents;
}

export function rememberRecent(list: readonly PaletteRecent[], entry: PaletteRecent): PaletteRecent[] {
  return [entry, ...list.filter((item) => item.href !== entry.href)].slice(0, PALETTE_RECENT_LIMIT);
}

function browserStorage(): RecentStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadRecents(key: string | null, storage: RecentStorage | null = browserStorage()): PaletteRecent[] {
  if (!key || !storage) return [];
  try {
    return parseRecents(storage.getItem(key));
  } catch {
    return [];
  }
}

export function saveRecent(
  key: string | null,
  entry: PaletteRecent,
  storage: RecentStorage | null = browserStorage(),
): PaletteRecent[] | null {
  if (!key || !storage) return null;
  try {
    const next = rememberRecent(parseRecents(storage.getItem(key)), entry);
    storage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

export function forgetRecents(key: string | null, storage: RecentStorage | null = browserStorage()): boolean {
  if (!key || !storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function commandOption(command: PaletteCommand, prefix: 'page' | 'action'): PaletteOption | null {
  const label = command.label.trim();
  if (!label) return null;
  const hasHref = command.href !== undefined;
  const href = hasHref && isSafeHref(command.href) ? command.href : null;
  if (hasHref && href === null) return null;
  if (href === null && !command.onSelect) return null;
  const subtitle = command.subtitle?.trim() || null;
  return {
    key: `${prefix}:${command.id}`,
    type: href ? 'link' : 'action',
    label,
    subtitle,
    meta: null,
    status: null,
    hint: command.hint?.trim() || null,
    href,
    icon: command.icon ?? ArrowRight,
    recent: href ? { href, title: label, subtitle, kind: 'page' } : null,
    onSelect: href ? null : command.onSelect ?? null,
  };
}

function recentOption(recent: PaletteRecent, pages: readonly PaletteCommand[]): PaletteOption {
  const page = recent.kind === 'page' ? pages.find((command) => command.href === recent.href) : undefined;
  return {
    key: `recent:${recent.href}`,
    type: 'link',
    label: page?.label ?? recent.title,
    subtitle: recent.subtitle,
    meta: null,
    status: null,
    hint: KIND_LABELS[recent.kind] ?? null,
    href: recent.href,
    icon: page?.icon ?? GROUP_ICONS[recent.kind] ?? History,
    recent,
    onSelect: null,
  };
}

function searchOption(group: PaletteSearchGroup, item: PaletteSearchItem): PaletteOption {
  const remembered = group.key !== 'page' && RECENT_KINDS.has(group.key);
  return {
    key: `${group.key}:${item.id}`,
    type: 'link',
    label: item.title,
    subtitle: item.subtitle,
    meta: item.meta,
    status: item.status,
    hint: null,
    href: item.href,
    icon: GROUP_ICONS[group.key] ?? Search,
    recent: remembered ? { href: item.href, title: item.title, subtitle: item.subtitle, kind: group.key } : null,
    onSelect: null,
  };
}

function moreOption(group: PaletteSearchGroup, href: string): PaletteOption {
  return {
    key: `more:${group.key}`,
    type: 'link',
    label: `See all matching ${group.label.toLowerCase()}`,
    subtitle: null,
    meta: null,
    status: null,
    hint: null,
    href,
    icon: ArrowRight,
    recent: null,
    onSelect: null,
  };
}

export function buildPaletteSections(input: PaletteSectionsInput): PaletteSection[] {
  const sections: PaletteSection[] = [];
  const used = new Set<string>();
  const add = (
    id: string,
    label: string,
    source: PaletteSectionSource,
    candidates: ReadonlyArray<PaletteOption | null>,
  ) => {
    const options: PaletteOption[] = [];
    for (const option of candidates) {
      if (!option || used.has(option.key)) continue;
      used.add(option.key);
      options.push(option);
    }
    if (options.length > 0) sections.push({ id, label, source, options });
  };

  if (!normalizeSearchText(input.query)) {
    const pageHrefs = new Set(input.pages.map((command) => command.href).filter(isSafeHref));
    const kinds = input.recordKinds ? new Set(input.recordKinds) : null;
    const recents = input.recents.filter((recent) => {
      if (recent.kind === 'page') return pageHrefs.has(recent.href);
      return input.recordsEnabled && (kinds === null || kinds.has(recent.kind));
    });
    add('recent', 'Recent', 'local', recents.map((recent) => recentOption(recent, input.pages)));
    add('pages', 'Go to', 'local', input.pages.map((command) => commandOption(command, 'page')));
    add('actions', 'Actions', 'local', input.actions.map((command) => commandOption(command, 'action')));
    return sections;
  }

  const pages = filterCommands(input.pages, input.query);
  const actions = filterCommands(input.actions, input.query);
  add('pages', 'Go to', 'local', pages.map((command) => commandOption(command, 'page')));
  add('actions', 'Actions', 'local', actions.map((command) => commandOption(command, 'action')));
  for (const group of input.groups) {
    add(`search-${group.key}`, group.label, 'search', [
      ...group.items.map((item) => searchOption(group, item)),
      group.moreHref ? moreOption(group, group.moreHref) : null,
    ]);
  }
  return sections;
}

export function flattenSections(sections: readonly PaletteSection[]): PaletteOption[] {
  return sections.flatMap((section) => section.options);
}

export function resolveActiveIndex(options: ReadonlyArray<Pick<PaletteOption, 'key'>>, activeKey: string | null): number {
  if (options.length === 0) return -1;
  if (activeKey === null) return 0;
  const index = options.findIndex((option) => option.key === activeKey);
  return index >= 0 ? index : 0;
}

export function paletteKeyAction(input: PaletteKeyInput): PaletteKeyAction | null {
  if (isComposingInput(input)) return null;
  const modified = input.ctrlKey || input.metaKey || input.altKey || input.shiftKey;
  switch (input.key) {
    case 'ArrowDown':
      return modified ? null : 'next';
    case 'ArrowUp':
      return modified ? null : 'previous';
    case 'Home':
      return modified ? null : 'first';
    case 'End':
      return modified ? null : 'last';
    case 'Enter':
      if (!modified) return 'open';
      return (input.ctrlKey || input.metaKey) && !input.altKey && !input.shiftKey ? 'open-new-tab' : null;
    default:
      return null;
  }
}

export function movePaletteIndex(current: number, count: number, move: RovingMove): number {
  return moveRovingIndex(current, count, move, true);
}

export function speakMasked(text: string): string {
  return text.replace(MASKED_TAIL, (_match: string, tail: string | undefined) => {
    const visible = tail ?? '';
    const spoken = maskForDisplay(`${MASK}${visible}`, { visible: visible.length }).spoken;
    return spoken.charAt(0).toLowerCase() + spoken.slice(1);
  });
}

export function optionAccessibleName(option: Pick<PaletteOption, 'label' | 'subtitle' | 'meta' | 'status' | 'hint'>): string {
  return [option.label, option.subtitle, option.meta, option.status ? statusLabel(option.status) : null, option.hint]
    .filter((part): part is string => Boolean(part))
    .map(speakMasked)
    .join(', ');
}

export function searchFailureMessage(error: Pick<ApiFailure, 'kind' | 'status'>): string {
  if (error.kind === 'network') return 'Could not reach the server. Check your connection and try again.';
  if (error.kind === 'timeout') return 'Search took too long to respond. Try again.';
  if (error.status === 429) return 'Too many searches in a short time. Wait a moment, then try again.';
  return 'Search could not be completed. Try again.';
}

export function partialSearchDetail(keys: readonly string[]): string {
  const labels = Array.from(new Set(keys.map((key) => GROUP_LABELS[key]).filter((label): label is string => Boolean(label))));
  if (labels.length === 0) return 'Try again in a moment.';
  return `${joinList(labels)} could not be searched. Try again in a moment.`;
}

export function resultCountText(count: number): string {
  return count === 1 ? '1 result' : `${count} results`;
}

export function noMatchesText(query: string): string {
  return `No matches for “${echo(query)}”`;
}

export function paletteStatus(input: PaletteStatusInput): string {
  if (!normalizeSearchText(input.query)) return '';
  if (input.failed) {
    const local = input.count > 0 ? ` Showing ${resultCountText(input.count)} from pages and commands.` : '';
    return `Search is unavailable right now.${local}`;
  }
  if (input.pending) return input.slow ? 'Searching…' : '';
  if (input.count === 0) return `${noMatchesText(input.query)}.`;
  const partial = input.partial ? ' Some results could not be loaded.' : '';
  return `${resultCountText(input.count)}.${partial}`;
}

export function paletteHintText(apple: boolean): string {
  const mod = apple ? 'Command' : 'Control';
  return `Use the up and down arrow keys to move through the results. Press Enter to open one, ${mod} Enter to open it in a new tab, or Escape to close.`;
}

function useLateFlag(active: boolean, delayMs: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setLate(true), delayMs);
    return () => {
      window.clearTimeout(timer);
      setLate(false);
    };
  }, [active, delayMs]);
  return active && late;
}

function keepInputFocus(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
}

function KeyCap({ label }: { label: ShortcutKeyLabel }) {
  if (label.text === label.spoken) return <kbd className={s.kbd}>{label.text}</kbd>;
  return (
    <kbd className={s.kbd}>
      <span aria-hidden="true">{label.text}</span>
      <span className={s.srOnly}>{label.spoken}</span>
    </kbd>
  );
}

function Chord({ keys, apple }: { keys: ReadonlyArray<ShortcutKey>; apple: boolean }) {
  return (
    <span className={s.chord}>
      {keys.map((key, index) => (
        <span key={key} className={s.chordKey}>
          {index > 0 ? <span className={s.srOnly}> plus </span> : null}
          <KeyCap label={shortcutKeyLabel(key, apple)} />
        </span>
      ))}
    </span>
  );
}

interface ActiveState {
  key: string | null;
  source: 'keyboard' | 'pointer';
}

const NO_ACTIVE: ActiveState = { key: null, source: 'keyboard' };

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  pages: readonly PaletteCommand[];
  actions?: readonly PaletteCommand[];
  searchPath?: string | null;
  recordKinds?: readonly string[] | null;
  viewer?: string | null;
  returnFocusTo?: () => HTMLElement | null;
}

export function CommandPalette(props: CommandPaletteProps) {
  if (!props.open) return null;
  return <PaletteDialog {...props} />;
}

const NO_COMMANDS: readonly PaletteCommand[] = [];

function PaletteDialog({
  onClose, pages, actions = NO_COMMANDS, searchPath = null, recordKinds = null, viewer = null, returnFocusTo,
}: CommandPaletteProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const hintId = `${baseId}-hint`;
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const apple = useApplePlatform() === true;
  const trapRef = useFocusTrap<HTMLDivElement>(true, onClose, { returnFocusTo });
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pressedScrim = useRef(false);
  const storageKey = viewer ? recentStorageKey(viewer) : null;
  const [recents] = useState<PaletteRecent[]>(() => loadRecents(storageKey));
  const [text, setText] = useState('');
  const [active, setActive] = useState<ActiveState>(NO_ACTIVE);

  const searchKey = searchPath ? paletteSearchKey(text) : null;
  const settledKey = useDebouncedValue(searchKey, PALETTE_SEARCH_DEBOUNCE_MS);
  const requestKey = searchKey === null ? null : settledKey;
  const remote = useResource<PaletteSearchResult>(
    searchPath && requestKey ? `palette-search:${requestKey}` : null,
    (signal) => apiRequest(searchPath ?? '', {
      query: { q: requestKey, limit: PALETTE_SEARCH_LIMIT },
      signal,
      select: readSearchResponse,
    }),
  );

  const failure = remote.error && remote.error.kind !== 'aborted' ? remote.error : null;
  const remoteData = remote.data && !(failure && remote.isPreviousData) ? remote.data : null;
  const inFlight = remote.status === 'loading' || remote.status === 'refreshing';
  const pending = searchKey !== null && (searchKey !== requestKey || inFlight);
  const slow = useLateFlag(inFlight, SPINNER_DELAY_MS);
  const sessionEnded = failure?.status === 401;

  useEffect(() => {
    if (sessionEnded) onClose();
  }, [sessionEnded, onClose]);

  const groups = remoteData?.groups ?? EMPTY_GROUPS;
  const partialKeys = remoteData?.partial ?? [];
  const sections = useMemo(
    () => buildPaletteSections({
      query: text, recents, pages, actions, groups, recordsEnabled: Boolean(searchPath), recordKinds,
    }),
    [text, recents, pages, actions, groups, searchPath, recordKinds],
  );
  const options = useMemo(() => flattenSections(sections), [sections]);
  const activeIndex = resolveActiveIndex(options, active.key);
  const activeOption = activeIndex >= 0 ? options[activeIndex] : null;
  const typed = normalizeSearchText(text) !== '';
  const stale = remote.isPreviousData && groups.length > 0;

  const statusText = paletteStatus({
    query: text,
    count: options.length,
    pending,
    slow,
    failed: failure !== null,
    partial: partialKeys.length > 0,
  });
  const announced = useDebouncedValue(statusText, STATUS_DELAY_MS);

  useLayoutEffect(() => {
    if (active.source !== 'keyboard' || activeIndex < 0) return;
    const body = bodyRef.current;
    if (!body) return;
    if (activeIndex === 0) {
      body.scrollTop = 0;
      return;
    }
    const node = body.querySelector(`[data-option-index="${activeIndex}"]`);
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, active.source, active.key]);

  const remember = (option: PaletteOption) => {
    if (option.recent) saveRecent(storageKey, option.recent);
  };

  const runAction = (option: PaletteOption) => {
    onClose();
    option.onSelect?.();
  };

  const activate = (index: number, newTab: boolean) => {
    const option = options[index];
    if (!option) return;
    if (option.type === 'action' || !option.href) {
      runAction(option);
      return;
    }
    if (newTab) {
      remember(option);
      window.open(option.href, '_blank', 'noopener');
      return;
    }
    const node = bodyRef.current?.querySelector(`[data-option-index="${index}"]`);
    if (node instanceof HTMLAnchorElement) {
      node.click();
      return;
    }
    remember(option);
    onClose();
    window.location.assign(option.href);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setText(event.target.value);
    setActive(NO_ACTIVE);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const action = paletteKeyAction({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.keyCode,
    });
    if (!action) return;
    if (action === 'open' || action === 'open-new-tab') {
      if (activeIndex < 0) return;
      event.preventDefault();
      activate(activeIndex, action === 'open-new-tab');
      return;
    }
    if (options.length === 0) return;
    event.preventDefault();
    const next = movePaletteIndex(activeIndex, options.length, action);
    setActive({ key: options[next].key, source: 'keyboard' });
  };

  const hover = (key: string) => {
    setActive((current) => (current.key === key && current.source === 'pointer' ? current : { key, source: 'pointer' }));
  };

  const pressScrim = (event: MouseEvent<HTMLDivElement>) => {
    pressedScrim.current = event.target === event.currentTarget;
  };

  const closeFromScrim = (event: MouseEvent<HTMLDivElement>) => {
    const pressed = pressedScrim.current;
    pressedScrim.current = false;
    if (pressed && event.target === event.currentTarget) onClose();
  };

  const renderOption = (option: PaletteOption, index: number) => {
    const selected = index === activeIndex;
    const Icon = option.icon;
    const content = (
      <>
        <span className={s.optionIcon} aria-hidden="true"><Icon size={16} /></span>
        <span className={s.optionText}>
          <span className={s.optionLabel}>{option.label}</span>
          {option.subtitle ? <span className={s.optionSubtitle}>{option.subtitle}</span> : null}
        </span>
        {option.meta || option.status || option.hint ? (
          <span className={s.optionAside}>
            {option.meta ? <span className={s.optionMeta}>{option.meta}</span> : null}
            {option.status ? <StatusDot status={option.status} className={s.optionStatus} /> : null}
            {option.hint ? <span className={s.optionHint}>{option.hint}</span> : null}
          </span>
        ) : null}
      </>
    );
    if (option.type === 'link' && option.href) {
      return (
        <Link
          key={option.key}
          id={optionId(index)}
          href={option.href}
          prefetch={false}
          role="option"
          aria-selected={selected}
          aria-label={optionAccessibleName(option)}
          tabIndex={-1}
          data-option-index={index}
          data-active={selected ? active.source : undefined}
          className={s.option}
          onMouseDown={keepInputFocus}
          onMouseMove={() => hover(option.key)}
          onClick={() => remember(option)}
          onAuxClick={(event) => {
            if (event.button === 1) remember(option);
          }}
          onNavigate={onClose}
        >
          {content}
        </Link>
      );
    }
    return (
      <div
        key={option.key}
        id={optionId(index)}
        role="option"
        aria-selected={selected}
        aria-label={optionAccessibleName(option)}
        data-option-index={index}
        data-active={selected ? active.source : undefined}
        className={s.option}
        onMouseDown={keepInputFocus}
        onMouseMove={() => hover(option.key)}
        onClick={() => runAction(option)}
      >
        {content}
      </div>
    );
  };

  let flatIndex = 0;
  const showSearching = typed && pending && slow && groups.length === 0 && failure === null;
  const showEmpty = typed && options.length === 0 && !pending && failure === null;
  const tooShort = Boolean(searchPath) && typed && searchKey === null;
  const shortHint = `Type at least ${PALETTE_SEARCH_MIN_LENGTH} characters to search records.`;
  const emptyHint = tooShort
    ? shortHint
    : searchPath ? 'Try a name, email, reference or page.' : 'Try the name of a page or a command.';

  return (
    <div className={s.scrim} onMouseDown={pressScrim} onClick={closeFromScrim}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={s.dialog}>
        <h2 id={titleId} className={s.srOnly}>Command palette</h2>
        <div className={s.searchRow}>
          <span className={s.searchIcon} aria-hidden="true"><Search size={16} /></span>
          <input
            ref={inputRef}
            className={s.input}
            type="text"
            role="combobox"
            aria-label={searchPath ? 'Search records, pages and commands' : 'Search pages and commands'}
            aria-autocomplete="list"
            aria-expanded={options.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeOption ? optionId(activeIndex) : undefined}
            aria-describedby={hintId}
            placeholder={searchPath ? 'Search users, withdrawals, pages…' : 'Search pages and commands…'}
            value={text}
            maxLength={PALETTE_QUERY_MAX}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            onChange={handleChange}
            onKeyDown={handleKeyDown}
          />
          {slow ? <span className={s.spinner} aria-hidden="true" /> : null}
          <button type="button" className={s.close} onClick={onClose} aria-label="Close command palette">
            <span className={s.closeKey} aria-hidden="true">Esc</span>
            <span className={s.closeIcon} aria-hidden="true"><X size={18} /></span>
          </button>
        </div>
        <p id={hintId} className={s.srOnly}>{paletteHintText(apple)}</p>
        <div role="status" className={s.srOnly}>{announced}</div>
        <div ref={bodyRef} className={s.body}>
          {failure ? (
            <Notice
              tone="danger"
              compact
              className={s.notice}
              actions={(
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<RotateCw size={14} aria-hidden />}
                  onClick={() => {
                    inputRef.current?.focus({ preventScroll: true });
                    void remote.refresh();
                  }}
                >
                  Try again
                </Button>
              )}
            >
              {searchFailureMessage(failure)}
            </Notice>
          ) : null}
          {!failure && partialKeys.length > 0 ? (
            <Notice tone="warning" compact className={s.notice} title="Some results could not be loaded.">
              {partialSearchDetail(partialKeys)}
            </Notice>
          ) : null}
          <div id={listboxId} role="listbox" aria-label="Results" className={s.listbox}>
            {sections.map((section) => {
              const labelId = `${baseId}-section-${section.id}`;
              const dimmed = stale && section.source === 'search';
              return (
                <div
                  key={section.id}
                  role="group"
                  aria-labelledby={labelId}
                  className={[s.group, dimmed && s.stale].filter(Boolean).join(' ')}
                >
                  <div id={labelId} className={s.groupLabel} aria-hidden="true">{section.label}</div>
                  {section.options.map((option) => {
                    const index = flatIndex;
                    flatIndex += 1;
                    return renderOption(option, index);
                  })}
                </div>
              );
            })}
          </div>
          {showSearching ? (
            <p className={s.state}>
              <span className={s.stateSpinner} aria-hidden="true" />
              Searching…
            </p>
          ) : null}
          {showEmpty ? (
            <div className={s.empty}>
              <p className={s.emptyTitle}>{noMatchesText(text)}</p>
              <p className={s.emptyHint}>{emptyHint}</p>
            </div>
          ) : null}
          {tooShort && !showEmpty ? <p className={s.note}>{shortHint}</p> : null}
        </div>
        <div className={s.footer} aria-hidden="true">
          {FOOTER_HINTS.map((hint) => (
            <span key={hint.id} className={s.footerHint}>
              <Chord keys={hint.keys} apple={apple} />
              <span>{hint.text}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}

export function KeyboardShortcutsDialog({ open, onClose, returnFocusTo }: KeyboardShortcutsDialogProps) {
  const baseId = useId();
  const apple = useApplePlatform() === true;
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="md" returnFocusTo={returnFocusTo}>
      <div className={s.shortcuts}>
        {SHORTCUT_SECTIONS.map((section) => {
          const headingId = `${baseId}-${section.id}`;
          return (
            <section key={section.id} className={s.shortcutSection} aria-labelledby={headingId}>
              <h3 id={headingId} className={s.shortcutTitle}>{section.title}</h3>
              <dl className={s.shortcutList}>
                {section.entries.map((entry) => (
                  <div key={entry.id} className={s.shortcutRow}>
                    <dt className={s.shortcutText}>{entry.description}</dt>
                    <dd className={s.shortcutKeys}>
                      {entry.chords.map((chord, index) => (
                        <span key={chord.join('+')} className={s.shortcutChord}>
                          {index > 0 ? <span className={s.shortcutOr}>or</span> : null}
                          <Chord keys={chord} apple={apple} />
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
