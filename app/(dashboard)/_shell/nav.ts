import {
  LayoutDashboard, ClipboardList, ArrowDownToLine,
  Users, Activity, ShieldCheck,
  CreditCard, Wrench, BadgePercent,
  Gift, Trophy, TicketPercent, Share2,
  Megaphone, Bell, Mail,
  Settings, Wallet, SlidersHorizontal,
  Receipt, ShieldAlert, Shield,
  type LucideIcon,
} from 'lucide-react';

export interface NavLeaf {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  detailLabel?: string;
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
      { key: 'transactions_overview',  label: 'Transactions',   href: '/transactions-overview',  icon: ClipboardList },
    ],
  },
  {
    label: 'People',
    items: [
      { key: 'users',                  label: 'Users',          href: '/users',                  icon: Users, detailLabel: 'User details' },
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
      { key: 'bill_settings',          label: 'Bill Settings',  href: '/bill-settings',          icon: Receipt },
      { key: 'admin_settings',         label: 'Settings',       href: '/admin-settings',         icon: Settings },
    ],
  },
  {
    label: 'Security',
    items: [
      { key: 'anomaly_alerts',         label: 'Anomaly & Alerts', href: '/anomaly-alerts',       icon: ShieldAlert },
      { key: 'security_limits',        label: 'Rate Limits & IPs', href: '/security-limits',     icon: Shield },
    ],
  },
];

export interface NavMatch {
  group: NavGroup;
  leaf: NavLeaf;
  exact: boolean;
}

export function hrefMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function findNavMatch(pathname: string, groups: readonly NavGroup[] = NAV_GROUPS): NavMatch | null {
  let best: NavMatch | null = null;
  for (const group of groups) {
    for (const leaf of group.items) {
      if (!hrefMatches(pathname, leaf.href)) continue;
      if (best && best.leaf.href.length >= leaf.href.length) continue;
      best = { group, leaf, exact: pathname === leaf.href };
    }
  }
  return best;
}

export const PROFILE_HREF = '/profile';
export const PROFILE_LABEL = 'Profile';

export interface Breadcrumb {
  group: string;
  item: string;
  href: string;
  detail: string | null;
}

export function findBreadcrumb(pathname: string): Breadcrumb | null {
  const match = findNavMatch(pathname);
  if (!match) return null;
  return {
    group: match.group.label,
    item: match.leaf.label,
    href: match.leaf.href,
    detail: !match.exact && match.leaf.detailLabel ? match.leaf.detailLabel : null,
  };
}

export interface Crumb {
  label: string;
  href?: string;
  current?: boolean;
}

export function breadcrumbTrail(pathname: string): Crumb[] {
  const crumb = findBreadcrumb(pathname);
  if (!crumb) return [{ label: hrefMatches(pathname, PROFILE_HREF) ? PROFILE_LABEL : 'Admin', current: true }];
  if (!crumb.detail) return [{ label: crumb.group }, { label: crumb.item, current: true }];
  return [
    { label: crumb.group },
    { label: crumb.item, href: crumb.href },
    { label: crumb.detail, current: true },
  ];
}

export function findNavKey(pathname: string): string | null {
  return findNavMatch(pathname)?.leaf.key ?? null;
}

export function filterNavByPermissions(allowedKeys: readonly string[], isSuperAdmin: boolean): NavGroup[] {
  if (isSuperAdmin) return NAV_GROUPS;
  const allowed = new Set(allowedKeys);
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => allowed.has(i.key)) }))
    .filter((g) => g.items.length > 0);
}

export function isNavPathDenied(pathname: string, allowedKeys: readonly string[], isSuperAdmin: boolean): boolean {
  if (isSuperAdmin || pathname === '/dashboard') return false;
  const key = findNavKey(pathname);
  return key !== null && !allowedKeys.includes(key);
}

export const SIDEBAR_COLLAPSED_COOKIE = 'admin_sidebar_collapsed';
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseSidebarCollapsed(value: string | null | undefined): boolean | undefined {
  if (value === '1') return true;
  if (value === '0') return false;
  return undefined;
}

export function serializeSidebarCollapsed(collapsed: boolean, secure = false): string {
  return [
    `${SIDEBAR_COLLAPSED_COOKIE}=${collapsed ? '1' : '0'}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${SIDEBAR_COOKIE_MAX_AGE}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
