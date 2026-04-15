'use client';

import { usePathname, useRouter } from 'next/navigation';

interface NavItem {
  key: string;
  label: string;
  href: string;
}

interface Props {
  navItems: NavItem[];
  roleTitle: string;
  username: string;
  isSuperAdmin: boolean;
}

export default function SidebarClient({ navItems, roleTitle, username, isSuperAdmin }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <div style={styles.sidebar}>
      <div style={styles.sidebarTop}>
        <p style={styles.wordmark}>CardElite</p>
        <p style={styles.adminLabel}>Admin Panel</p>
        <p style={styles.roleTitle}>{roleTitle}</p>
        <p style={styles.usernameLabel}>{username}</p>
      </div>

      <nav style={styles.nav}>
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <a
              key={item.key}
              href={item.href}
              style={{
                ...styles.navItem,
                ...(active ? styles.navItemActive : {}),
              }}
            >
              <span style={{ ...styles.dot, ...(active ? styles.dotActive : {}) }} />
              {item.label}
            </a>
          );
        })}
      </nav>

      <button style={styles.logoutBtn} onClick={handleLogout}>
        <span style={styles.dotRed} />
        Logout
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 220,
    backgroundColor: '#FFFFFF',
    borderRight: '1px solid #EEEEEE',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    height: '100vh',
    position: 'sticky',
    top: 0,
  },
  sidebarTop: {
    padding: 16,
    borderBottom: '1px solid #EEEEEE',
  },
  wordmark: {
    fontSize: 14,
    fontWeight: 800,
    color: '#111111',
    margin: 0,
  },
  adminLabel: {
    fontSize: 10,
    color: '#888888',
    margin: '2px 0 6px',
  },
  roleTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#111111',
    margin: 0,
  },
  usernameLabel: {
    fontSize: 11,
    color: '#888888',
    margin: '2px 0 0',
  },
  nav: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0',
    display: 'flex',
    flexDirection: 'column',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '8px 14px',
    fontSize: 11,
    fontWeight: 500,
    color: '#888888',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  navItemActive: {
    backgroundColor: '#FFFFFF',
    color: '#111111',
    fontWeight: 700,
    borderLeft: '2.5px solid #111111',
    paddingLeft: 11.5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: '#CCCCCC',
    flexShrink: 0,
  },
  dotActive: {
    backgroundColor: '#111111',
  },
  dotRed: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: '#E53935',
    flexShrink: 0,
  },
  logoutBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '12px 14px',
    fontSize: 11,
    fontWeight: 500,
    color: '#E53935',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    borderTop: '1px solid #EEEEEE',
  },
};
