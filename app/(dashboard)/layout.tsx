import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminJWT } from '../lib/jwt';
import SidebarClient from './SidebarClient';
import TopBarClient from './TopBarClient';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard' },
  { key: 'card_queue', label: 'Card Queue', href: '/card-queue' },
  { key: 'card_management', label: 'Card & Country Management', href: '/cards' },
  { key: 'card_type_builder', label: 'Card Type & Field Builder', href: '/field-builder' },
  { key: 'rates_management', label: 'Rates Management', href: '/rates' },
  { key: 'withdrawals', label: 'Withdrawals', href: '/withdrawals' },
  { key: 'transfers', label: 'Transfers', href: '/transfers' },
  { key: 'users', label: 'Users', href: '/users' },
  { key: 'transactions_overview', label: 'Transactions Overview', href: '/transactions-overview' },
  { key: 'bonuses_rewards', label: 'Bonuses & Rewards', href: '/bonuses-rewards' },
  { key: 'referral_management', label: 'Referral Management', href: '/referral-management' },
  { key: 'coupons', label: 'Coupons', href: '/coupons' },
  { key: 'notifications_broadcast', label: 'Notifications Broadcast', href: '/notifications-broadcast' },
  { key: 'notification_templates', label: 'Notification Templates', href: '/notification-templates' },
  { key: 'platform_balance', label: 'Platform Balance', href: '/platform-balance' },
  { key: 'admin_accounts', label: 'Admin Accounts', href: '/admin-accounts' },
  { key: 'user_activity_monitor', label: 'User Activity Monitor', href: '/user-activity-monitor' },
  { key: 'limits_fees', label: 'Limits & Fees', href: '/limits-fees' },
  { key: 'admin_settings', label: 'Admin Settings', href: '/admin-settings' },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;

  if (!token) redirect('/login');

  const admin = await verifyAdminJWT(token);
  if (!admin) redirect('/login');

  const visibleNav = admin.is_super_admin
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => admin.page_permissions.includes(item.key));

  return (
    <div style={styles.shell}>
      <SidebarClient
        navItems={visibleNav}
        roleTitle={admin.role_title}
        username={admin.username}
        isSuperAdmin={admin.is_super_admin}
      />
      <div style={styles.main}>
        <TopBarClient username={admin.username} />
        <div style={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: '#F7F7F7',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: 24,
  },
};
