'use client';

import { usePathname } from 'next/navigation';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/card-queue': 'Card Queue',
  '/cards': 'Card & Country Management',
  '/field-builder': 'Card Type & Field Builder',
  '/rates': 'Rates Management',
  '/withdrawals': 'Withdrawals',
  '/transfers': 'Transfers',
  '/users': 'Users',
  '/transactions-overview': 'Transactions Overview',
  '/bonuses-rewards': 'Bonuses & Rewards',
  '/bonuses-rewards/levels': 'Levels',
  '/referral-management': 'Referral Management',
  '/coupons': 'Coupons',
  '/tasks': 'Tasks',
  '/notifications-broadcast': 'Notifications Broadcast',
  '/notification-templates': 'Notification Templates',
  '/platform-balance': 'Platform Balance',
  '/admin-accounts': 'Admin Accounts',
  '/user-activity-monitor': 'User Activity Monitor',
  '/admin-settings': 'Admin Settings',
};

export default function TopBarClient({ username }: { username: string }) {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] || 'Dashboard';

  return (
    <div style={styles.topBar}>
      <span style={styles.pageTitle}>{title}</span>
      <div style={styles.topBarRight}>
        <span style={styles.adminName}>{username}</span>
        <div style={styles.adminAvatar}>
          {username[0].toUpperCase()}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topBar: {
    height: 48,
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #EEEEEE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    flexShrink: 0,
  },
  pageTitle: {
    fontSize: 13,
    fontWeight: 800,
    color: '#111111',
  },
  topBarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  adminName: {
    fontSize: 12,
    color: '#333333',
  },
  adminAvatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    backgroundColor: '#111111',
    color: '#FFFFFF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
  },
};
