'use client';

import {
  useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type FocusEvent, type PointerEvent, type ReactNode, type RefObject,
} from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Keyboard, LogOut, Menu, Monitor, Moon, PanelLeft, Search, Sun, X } from 'lucide-react';
import { Button } from '../../_ui/Button';
import { Spinner, ToastProvider, useToast } from '../../_ui/Misc';
import { ConfirmProvider, useConfirm } from '../../_ui/Confirm';
import { PermissionsProvider, usePermissions } from '../../_ui/Permissions';
import { AccessDenied } from '../../_ui/States';
import { SessionExpiredHandler } from '../../_ui/SessionExpired';
import { ThemeSwitcher } from '../../_ui/ThemeSwitcher';
import { useTheme, type ThemeMode } from '../../_ui/theme';
import {
  CommandPalette, KeyboardShortcutsDialog, forgetRecents, recentStorageKey, type PaletteCommand, type PaletteIcon,
} from '../../_ui/CommandPalette';
import { findPageSearchInput, paletteChordHint, useApplePlatform, useHotkeys } from '../../_ui/useHotkeys';
import { useFocusTrap } from '../../_ui/useFocusTrap';
import { popOverlay, pushOverlay } from '../../_ui/overlayStack';
import type { Permission } from '../../lib/permissions';
import {
  breadcrumbTrail, filterNavByPermissions, findNavMatch, isNavPathDenied, serializeSidebarCollapsed,
} from './nav';
import s from './Shell.module.css';

const MOBILE_QUERY = '(max-width: 768px)';
const TABLET_QUERY = '(768px < width < 1200px)';
const TIP_HIDE_DELAY = 120;
const LOGOUT_TIP_ID = 'account-logout';
const SEARCH_PATH = '/api/search';

const SEARCH_GROUP_PERMISSIONS: ReadonlyArray<readonly [string, readonly Permission[]]> = [
  ['users', ['users.read']],
  ['withdrawals', ['withdrawals.read']],
  ['transactions', ['transactions.read']],
  ['card_submissions', ['cards.read']],
  ['coupons', ['coupons.read']],
  ['flags', ['flags.read', 'withdrawals.read']],
];

const THEME_COMMANDS: ReadonlyArray<{ mode: ThemeMode; label: string; icon: PaletteIcon }> = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor },
];

const THEME_KEYWORDS: readonly string[] = ['appearance', 'colour', 'color', 'mode'];

function subscribeToQuery(query: string) {
  return (notify: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', notify);
    return () => list.removeEventListener('change', notify);
  };
}

const subscribeMobile = subscribeToQuery(MOBILE_QUERY);
const subscribeTablet = subscribeToQuery(TABLET_QUERY);
const readMobile = () => window.matchMedia(MOBILE_QUERY).matches;
const readTablet = () => window.matchMedia(TABLET_QUERY).matches;
const readOnServer = () => false;

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

interface RailTip {
  id: string;
  label: string;
  top: number;
  left: number;
  open: boolean;
}

export interface RailTipTriggerProps {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
}

function useRailTip(enabled: boolean, railRef: RefObject<HTMLElement | null>) {
  const [tip, setTip] = useState<RailTip | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const hovered = useRef<string | null>(null);
  const focused = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  const cancelHide = useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const clear = useCallback(() => {
    cancelHide();
    setTip(null);
  }, [cancelHide]);

  const dismiss = useCallback(() => {
    cancelHide();
    setTip((current) => (current?.open ? { ...current, open: false } : current));
  }, [cancelHide]);

  const show = useCallback((target: HTMLElement, id: string, label: string) => {
    cancelHide();
    anchor.current = target;
    const box = target.getBoundingClientRect();
    const rail = railRef.current?.getBoundingClientRect();
    setTip({ id, label, top: box.top + box.height / 2, left: rail ? rail.right : box.right, open: true });
  }, [cancelHide, railRef]);

  const follow = useCallback((scroller: HTMLElement) => {
    const target = anchor.current;
    if (!target || !scroller.contains(target)) return;
    const box = target.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const center = box.top + box.height / 2;
    const inView = center >= view.top && center <= view.bottom;
    setTip((current) => {
      if (!current) return current;
      return inView ? { ...current, top: center } : null;
    });
  }, []);

  const release = useCallback((id: string, delay: number) => {
    if (hovered.current === id || focused.current === id) return;
    cancelHide();
    const hide = () => setTip((current) => (current?.id === id ? null : current));
    if (delay <= 0) {
      hide();
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      hide();
    }, delay);
  }, [cancelHide]);

  const trigger = useCallback((id: string, label: string): RailTipTriggerProps => ({
    onPointerEnter: (event) => {
      if (event.pointerType === 'touch') return;
      hovered.current = id;
      show(event.currentTarget, id, label);
    },
    onPointerLeave: (event) => {
      if (event.pointerType === 'touch') return;
      if (hovered.current === id) hovered.current = null;
      release(id, TIP_HIDE_DELAY);
    },
    onPointerDown: dismiss,
    onFocus: (event) => {
      if (!isFocusVisible(event.currentTarget)) return;
      focused.current = id;
      show(event.currentTarget, id, label);
    },
    onBlur: () => {
      if (focused.current === id) focused.current = null;
      release(id, 0);
    },
  }), [dismiss, release, show]);

  const tipId = tip?.id ?? null;
  const visible = enabled && tip !== null && tip.open;

  const surface = {
    onPointerEnter: () => {
      if (tipId === null) return;
      cancelHide();
      hovered.current = tipId;
    },
    onPointerLeave: () => {
      if (tipId === null) return;
      if (hovered.current === tipId) hovered.current = null;
      release(tipId, TIP_HIDE_DELAY);
    },
  };

  useEffect(() => {
    if (!visible) return;
    const node = tipRef.current;
    if (!node) return;
    const id = pushOverlay(node, dismiss, { lockScroll: false, trapFocus: false });
    return () => popOverlay(id);
  }, [visible, dismiss]);

  useEffect(() => {
    if (enabled) return;
    hovered.current = null;
    focused.current = null;
    clear();
  }, [enabled, clear]);

  useEffect(() => cancelHide, [cancelHide]);

  return {
    tip: visible ? tip : null,
    activeId: enabled ? tipId : null,
    tipRef,
    trigger,
    follow,
    surface,
  };
}

export interface ShellProps {
  allowedKeys: string[];
  isSuperAdmin: boolean;
  permissions: readonly string[];
  username: string;
  roleTitle: string;
  initialCollapsed?: boolean;
  children: ReactNode;
}

export function Shell(props: ShellProps) {
  return (
    <PermissionsProvider permissions={props.permissions} isSuperAdmin={props.isSuperAdmin}>
      <ToastProvider>
        <ConfirmProvider>
          <ShellFrame {...props} />
        </ConfirmProvider>
        <SessionExpiredHandler />
      </ToastProvider>
    </PermissionsProvider>
  );
}

function useLogout(username: string) {
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const logout = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const accepted = await confirm({
      title: 'Log out?',
      message: 'This signs you out of the admin console on every device, not just this one.',
      confirmLabel: 'Log out',
    });
    if (!accepted) {
      busy.current = false;
      return;
    }
    setPending(true);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (!res.ok) throw new Error(`Logout failed with ${res.status}`);
    } catch {
      busy.current = false;
      setPending(false);
      toast.show('Could not log out. Check your connection and try again.', 'error');
      return;
    }
    if (username) forgetRecents(recentStorageKey(username));
    window.location.replace('/login');
  }, [confirm, toast, username]);

  return { pending, logout };
}

function ShellFrame({
  allowedKeys, isSuperAdmin, username, roleTitle, initialCollapsed, children,
}: ShellProps) {
  const pathname = usePathname();
  const baseId = useId();
  const sidebarId = `${baseId}-sidebar`;
  const mobile = useSyncExternalStore(subscribeMobile, readMobile, readOnServer);
  const tablet = useSyncExternalStore(subscribeTablet, readTablet, readOnServer);
  const [preference, setPreference] = useState<boolean | undefined>(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const wasDrawerOpen = useRef(false);
  const apple = useApplePlatform();
  const { mode, setMode } = useTheme();
  const { canAny } = usePermissions();
  const { pending: logoutPending, logout } = useLogout(username);

  const drawerOpen = mobile && mobileOpen;
  const collapsed = !mobile && (preference ?? tablet);

  const closeDrawer = useCallback(() => setMobileOpen(false), []);
  const railRef = useRef<HTMLElement>(null);
  const drawerRef = useFocusTrap<HTMLDivElement>(drawerOpen, closeDrawer);
  const railTip = useRailTip(collapsed, railRef);

  const navGroups = useMemo(
    () => filterNavByPermissions(allowedKeys, isSuperAdmin),
    [allowedKeys, isSuperAdmin],
  );

  const navMatch = findNavMatch(pathname);
  const currentHref = navMatch?.leaf.href ?? null;
  const currentHint = navMatch?.exact ? 'Current page' : 'Current section';
  const recordKinds = useMemo(
    () => SEARCH_GROUP_PERMISSIONS.filter(([, needs]) => canAny(needs)).map(([kind]) => kind),
    [canAny],
  );
  const canSearch = recordKinds.length > 0;
  const chord = apple === null ? null : paletteChordHint(apple);

  const openPalette = useCallback(() => {
    setShortcutsOpen(false);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const returnToSearch = useCallback(() => searchTriggerRef.current, []);

  const pageCommands = useMemo<PaletteCommand[]>(
    () => navGroups.flatMap((group) => group.items.map((item) => ({
      id: item.href,
      label: item.label,
      subtitle: group.label,
      keywords: [group.label],
      icon: item.icon,
      href: item.href,
      hint: item.href === currentHref ? currentHint : undefined,
    }))),
    [navGroups, currentHref, currentHint],
  );

  const actionCommands = useMemo<PaletteCommand[]>(
    () => [
      ...THEME_COMMANDS.map((theme) => ({
        id: `theme-${theme.mode}`,
        label: `Theme: ${theme.label}`,
        keywords: THEME_KEYWORDS,
        icon: theme.icon,
        hint: mode === theme.mode ? 'Current' : undefined,
        onSelect: () => setMode(theme.mode),
      })),
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        keywords: ['help', 'hotkeys', 'keys'],
        icon: Keyboard,
        onSelect: () => setShortcutsOpen(true),
      },
      {
        id: 'sign-out',
        label: 'Sign out',
        keywords: ['log out', 'logout'],
        icon: LogOut,
        onSelect: () => {
          void logout();
        },
      },
    ],
    [mode, setMode, logout],
  );

  useHotkeys({
    onPalette: () => {
      if (paletteOpen) closePalette();
      else openPalette();
    },
    onSearch: () => {
      const field = findPageSearchInput(mainRef.current);
      if (!field) {
        openPalette();
        return;
      }
      field.focus();
      field.select();
    },
    onHelp: () => setShortcutsOpen(true),
    ownsOverlay: () => paletteOpen || shortcutsOpen,
  });

  useEffect(() => {
    setMobileOpen(false);
    setPaletteOpen(false);
    setShortcutsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobile) setMobileOpen(false);
  }, [mobile]);

  useEffect(() => {
    if (wasDrawerOpen.current && !drawerOpen) hamburgerRef.current?.focus({ preventScroll: true });
    wasDrawerOpen.current = drawerOpen;
  }, [drawerOpen]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setPreference(next);
    try {
      document.cookie = serializeSidebarCollapsed(next, window.location.protocol === 'https:');
    } catch {}
  };

  const crumbs = breadcrumbTrail(pathname);
  const permissionDenied = isNavPathDenied(pathname, allowedKeys, isSuperAdmin);
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

  return (
    <div className={s.shell}>
      <a href="#main-content" className={s.skipLink} inert={drawerOpen}>Skip to main content</a>

      <aside
        ref={railRef}
        id={sidebarId}
        className={[
          s.sidebar,
          preference === true && s.collapsed,
          preference === undefined && s.autoRail,
          drawerOpen && s.mobileOpen,
        ].filter(Boolean).join(' ')}
        aria-label="Sidebar"
        inert={mobile && !drawerOpen}
      >
        <div
          ref={drawerRef}
          className={s.sidebarInner}
          role={drawerOpen ? 'dialog' : undefined}
          aria-modal={drawerOpen || undefined}
          aria-label={drawerOpen ? 'Menu' : undefined}
        >
          <div className={s.sidebarHead}>
            <span className={s.brandMark} aria-hidden="true">CE</span>
            <span className={s.brandText}>
              <span className={s.brandName}>CardElite</span>
              <span className={s.brandSub}>Admin</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              className={s.drawerClose}
              leftIcon={<X size={16} />}
              onClick={closeDrawer}
              aria-label="Close menu"
            />
          </div>

          <nav
            aria-label="Primary"
            className={s.navScroll}
            onScroll={(event) => railTip.follow(event.currentTarget)}
          >
            {navGroups.map((group, groupIndex) => {
              const labelId = `${baseId}-group-${groupIndex}`;
              return (
                <div key={group.label} className={s.group}>
                  <div id={labelId} className={s.groupLabel}>{group.label}</div>
                  <ul role="list" aria-labelledby={labelId} className={s.navList}>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = navMatch?.leaf.href === item.href;
                      return (
                        <li key={`${item.href}-${item.label}`}>
                          <Link
                            href={item.href}
                            className={[s.navItem, active && s.active].filter(Boolean).join(' ')}
                            aria-current={active ? (navMatch?.exact ? 'page' : 'true') : undefined}
                            aria-label={collapsed ? item.label : undefined}
                            title={collapsed && railTip.activeId !== item.href ? item.label : undefined}
                            onClick={drawerOpen ? closeDrawer : undefined}
                            {...(collapsed ? railTip.trigger(item.href, item.label) : {})}
                          >
                            <span className={s.navIcon} aria-hidden="true"><Icon size={16} /></span>
                            <span className={s.navLabel}>{item.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>

          <SidebarAccount
            username={username}
            roleTitle={roleTitle}
            pending={logoutPending}
            onLogout={logout}
            tipTrigger={collapsed ? railTip.trigger(LOGOUT_TIP_ID, 'Log out') : undefined}
            showTitle={railTip.activeId !== LOGOUT_TIP_ID}
          />
        </div>
      </aside>

      <div
        className={[s.scrim, drawerOpen && s.scrimOpen].filter(Boolean).join(' ')}
        onClick={closeDrawer}
        aria-hidden="true"
      />

      {railTip.tip ? (
        <div
          ref={railTip.tipRef}
          className={s.railTip}
          style={{ top: railTip.tip.top, left: railTip.tip.left }}
          aria-hidden="true"
          {...railTip.surface}
        >
          <span className={s.railTipBubble}>{railTip.tip.label}</span>
        </div>
      ) : null}

      <div className={s.main} inert={drawerOpen}>
        <header className={s.topBar}>
          <div className={s.topLeft}>
            <Button
              variant="ghost"
              iconOnly
              className={s.railToggle}
              leftIcon={<PanelLeft size={16} />}
              onClick={toggleCollapsed}
              aria-label={toggleLabel}
              aria-controls={sidebarId}
              title={toggleLabel}
            />
            <Button
              ref={hamburgerRef}
              variant="ghost"
              iconOnly
              className={s.hamburger}
              leftIcon={<Menu size={18} />}
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              aria-controls={sidebarId}
            />
            <span className={s.topDivider} aria-hidden="true" />
            <nav aria-label="Breadcrumb" className={s.breadcrumb}>
              <ol className={s.crumbs}>
                {crumbs.map((crumb, index) => (
                  <li
                    key={`${index}-${crumb.label}`}
                    className={[s.crumb, index === 0 && crumbs.length > 1 && s.crumbLead].filter(Boolean).join(' ')}
                  >
                    {crumb.href ? (
                      <Link href={crumb.href} className={s.crumbLink}>{crumb.label}</Link>
                    ) : (
                      <span
                        className={crumb.current ? s.crumbCurrent : s.crumbText}
                        aria-current={crumb.current ? 'page' : undefined}
                      >
                        {crumb.label}
                      </span>
                    )}
                    {index < crumbs.length - 1 ? <span className={s.sep} aria-hidden="true">/</span> : null}
                  </li>
                ))}
              </ol>
            </nav>
          </div>
          <div className={s.topRight}>
            <Button
              ref={searchTriggerRef}
              variant="secondary"
              className={s.searchTrigger}
              leftIcon={<Search size={14} aria-hidden />}
              rightIcon={chord ? <kbd className={s.searchKbd} aria-hidden="true">{chord.text}</kbd> : undefined}
              onClick={openPalette}
              aria-label="Search"
              aria-haspopup="dialog"
              aria-keyshortcuts={chord?.keyshortcuts}
            >
              <span className={s.searchLabel}>Search…</span>
            </Button>
            <ThemeSwitcher />
          </div>
        </header>

        <main ref={mainRef} id="main-content" tabIndex={-1} className={s.content}>
          {permissionDenied ? <AccessDenied /> : children}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        pages={pageCommands}
        actions={actionCommands}
        searchPath={canSearch ? SEARCH_PATH : null}
        recordKinds={recordKinds}
        viewer={username}
        returnFocusTo={returnToSearch}
      />
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={closeShortcuts} returnFocusTo={returnToSearch} />
    </div>
  );
}

export interface SidebarAccountProps {
  username: string;
  roleTitle: string;
  pending: boolean;
  onLogout: () => void;
  tipTrigger?: RailTipTriggerProps;
  showTitle: boolean;
}

function SidebarAccount({ username, roleTitle, pending, onLogout, tipTrigger, showTitle }: SidebarAccountProps) {
  const initial = (username || '?').charAt(0).toUpperCase();

  return (
    <div className={s.sidebarFoot}>
      <span className={s.userAvatar} aria-hidden="true">{initial}</span>
      <span className={s.userIdentity}>
        <span className={s.userName}>{username}</span>
        <span className={s.userRole}>{roleTitle}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        className={s.logoutBtn}
        leftIcon={pending ? (
          <span className={s.pendingIcon} aria-hidden="true"><Spinner size={14} /></span>
        ) : (
          <LogOut size={14} />
        )}
        onClick={onLogout}
        aria-label="Log out"
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        title={showTitle ? 'Log out' : undefined}
        {...(tipTrigger ?? {})}
      />
    </div>
  );
}
