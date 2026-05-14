'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronsLeft, ChevronsRight, LogOut } from 'lucide-react';
import { ToastProvider } from '../../_ui/Misc';
import { ThemeSwitcher } from './ThemeSwitcher';
import { findBreadcrumb, filterNavByPermissions } from './nav';
import s from './Shell.module.css';

const COLLAPSE_KEY = 'cardelite-admin-sidebar-collapsed';

interface ShellProps {
  /** Permission keys (plain strings) — function components like icons can't
   *  cross the server/client boundary, so the server passes the keys and the
   *  Shell resolves them against the in-module NAV_GROUPS itself. */
  allowedKeys: string[];
  isSuperAdmin: boolean;
  username: string;
  roleTitle: string;
  children: ReactNode;
}

/**
 * The whole dashboard chrome: collapsible sidebar (grouped nav, brand mark,
 * user pill), sticky top bar (breadcrumb + theme switch), scrollable content
 * area. Wraps everything in <ToastProvider> so pages can call useToast().
 */
export function Shell({ allowedKeys, isSuperAdmin, username, roleTitle, children }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const navGroups = useMemo(
    () => filterNavByPermissions(allowedKeys, isSuperAdmin),
    [allowedKeys, isSuperAdmin],
  );

  // Hydrate sidebar collapse state from localStorage on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY);
      if (saved === '1') setCollapsed(true);
    } catch { /* ignore */ }
  }, []);

  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    router.push('/login');
  };

  const initial = (username || '?').charAt(0).toUpperCase();
  const breadcrumb = findBreadcrumb(pathname);

  return (
    <ToastProvider>
      <div className={s.shell}>
        <aside className={[s.sidebar, collapsed && s.collapsed].filter(Boolean).join(' ')} aria-label="Primary">
          <div className={s.sidebarHead}>
            <div className={s.brandMark}>CE</div>
            {!collapsed ? (
              <div className={s.brandText}>
                <span className={s.brandName}>CardElite</span>
                <span className={s.brandSub}>Admin</span>
              </div>
            ) : null}
            <button
              type="button"
              className={s.collapseBtn}
              onClick={toggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            </button>
          </div>

          <nav className={s.navScroll}>
            {navGroups.map((group) => (
              <div key={group.label} className={s.group}>
                <div className={s.groupLabel}>{group.label}</div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || pathname.startsWith(item.href + '/');
                  // De-dupe by href since groups can list the same key twice (e.g. Bonuses + Levels).
                  return (
                    <Link
                      key={`${item.href}-${item.label}`}
                      href={item.href}
                      className={[s.navItem, active && s.active].filter(Boolean).join(' ')}
                      data-tooltip={collapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                    >
                      <span className={s.navIcon}><Icon size={16} /></span>
                      <span className={s.navLabel}>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className={s.sidebarFoot}>
            <div className={s.userAvatar} aria-hidden>{initial}</div>
            <div className={s.userIdentity}>
              <span className={s.userName}>{username}</span>
              <span className={s.userRole}>{roleTitle}</span>
            </div>
            <button
              type="button"
              className={s.logoutBtn}
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </aside>

        <main className={s.main}>
          <header className={s.topBar}>
            <nav className={s.breadcrumb} aria-label="Breadcrumb">
              {breadcrumb ? (
                <>
                  <span className={s.crumb}>{breadcrumb.group}</span>
                  <span className={s.sep}>/</span>
                  <span className={s.crumbCurrent}>{breadcrumb.item}</span>
                </>
              ) : (
                <span className={s.crumbCurrent}>Admin</span>
              )}
            </nav>
            <div className={s.topRight}>
              <ThemeSwitcher />
            </div>
          </header>
          <div className={s.content}>{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
