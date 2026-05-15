

import {
  LayoutDashboard, ClipboardList, ArrowDownToLine, ArrowLeftRight,
  Users, Activity, ShieldCheck,
  CreditCard, Wrench, BadgePercent,
  Gift, Trophy, TicketPercent, Share2,
  Megaphone, Bell, Mail,
  Settings, Wallet, SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

export interface NavLeaf {
  
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavLeaf[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { key: 'dashboard',              label: 'Dashboard',      href: '/dashboard',              icon: LayoutDashboard },
      { key: 'card_queue',             label: 'Card Queue',     href: '/card-queue',             icon: ClipboardList },
      { key: 'withdrawals',            label: 'Withdrawals',    href: '/withdrawals',            icon: ArrowDownToLine },
      { key: 'transfers',              label: 'Transfers',      href: '/transfers',              icon: ArrowLeftRight },
      { key: 'transactions_overview',  label: 'Transactions',   href: '/transactions-overview',  icon: ClipboardList },
    ],
  },
  {
    label: 'People',
    items: [
      { key: 'users',                  label: 'Users',          href: '/users',                  icon: Users },
      { key: 'user_activity_monitor',  label: 'Activity Log',   href: '/user-activity-monitor',  icon: Activity },
      { key: 'activity',               label: 'Admin Activity', href: '/activity',               icon: Activity },
      { key: 'admin_accounts',         label: 'Admins',         href: '/admin-accounts',         icon: ShieldCheck },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { key: 'card_management',        label: 'Cards',          href: '/cards',                  icon: CreditCard },
      { key: 'card_type_builder',      label: 'Field Builder',  href: '/field-builder',          icon: Wrench },
      { key: 'rates_management',       label: 'Rates',          href: '/rates',                  icon: BadgePercent },
    ],
  },
  {
    label: 'Rewards',
    items: [
      { key: 'bonuses_rewards',        label: 'Bonuses',        href: '/bonuses-rewards',        icon: Gift },

      { key: 'bonuses_rewards',        label: 'Levels',         href: '/bonuses-rewards/levels', icon: Trophy },
      { key: 'coupons',                label: 'Coupons',        href: '/coupons',                icon: TicketPercent },
      { key: 'referral_management',    label: 'Referrals',      href: '/referral-management',    icon: Share2 },
    ],
  },
  {
    label: 'Communications',
    items: [
      { key: 'notifications_broadcast', label: 'Broadcast',     href: '/notifications-broadcast', icon: Megaphone },
      { key: 'notification_templates',  label: 'Push Templates', href: '/notification-templates', icon: Bell },
      { key: 'email_templates',         label: 'Email Templates', href: '/email-templates',      icon: Mail },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { key: 'platform_balance',       label: 'Balance',        href: '/platform-balance',       icon: Wallet },
      { key: 'limits_fees',            label: 'Limits & Fees',  href: '/limits-fees',            icon: SlidersHorizontal },
      { key: 'admin_settings',         label: 'Settings',       href: '/admin-settings',         icon: Settings },
    ],
  },
];

export function findBreadcrumb(pathname: string): { group: string; item: string } | null {
  for (const group of NAV_GROUPS) {
    for (const leaf of group.items) {
      if (pathname === leaf.href || pathname.startsWith(leaf.href + '/')) {
        return { group: group.label, item: leaf.label };
      }
    }
  }
  return null;
}

export function filterNavByPermissions(allowedKeys: string[], isSuperAdmin: boolean): NavGroup[] {
  if (isSuperAdmin) return NAV_GROUPS;
  const allowed = new Set(allowedKeys);
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => allowed.has(i.key)) }))
    .filter((g) => g.items.length > 0);
}
