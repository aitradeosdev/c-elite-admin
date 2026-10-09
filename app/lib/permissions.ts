import type { AdminJWTPayload } from './jwt';

export type PermissionRisk = 'low' | 'medium' | 'high' | 'critical';

export interface PermissionMeta {
  readonly label: string;
  readonly description: string;
  readonly category: PermissionCategory;
  readonly risk: PermissionRisk;
}

export type PermissionCategory =
  | 'Operations'
  | 'Users'
  | 'Financial'
  | 'Gift Cards'
  | 'Rewards'
  | 'Communications'
  | 'Risk & Security'
  | 'Integrations'
  | 'Analytics'
  | 'System'
  | 'Administration'
  | 'Sensitive Data';

export const PERMISSION_CATEGORIES: readonly PermissionCategory[] = [
  'Operations',
  'Users',
  'Financial',
  'Gift Cards',
  'Rewards',
  'Communications',
  'Risk & Security',
  'Integrations',
  'Analytics',
  'System',
  'Administration',
  'Sensitive Data',
];

const CATALOG = {
  'cards.read': {
    label: 'View card submissions',
    description: 'Read the card review queue and submission details.',
    category: 'Operations',
    risk: 'medium',
  },
  'cards.review': {
    label: 'Decide card submissions',
    description: 'Approve, reject, request correction and resolve disputes. Approval credits a user wallet.',
    category: 'Operations',
    risk: 'critical',
  },
  'cards.assign': {
    label: 'Assign card submissions',
    description: 'Assign and unassign submissions to reviewers.',
    category: 'Operations',
    risk: 'low',
  },
  'cards.note': {
    label: 'Annotate card submissions',
    description: 'Add internal notes and flags to a submission.',
    category: 'Operations',
    risk: 'low',
  },
  'cards.export': {
    label: 'Export card submissions',
    description: 'Export submission data matching the current filters.',
    category: 'Operations',
    risk: 'high',
  },
  'withdrawals.read': {
    label: 'View withdrawals',
    description: 'Read the withdrawal queue and payout details.',
    category: 'Operations',
    risk: 'medium',
  },
  'withdrawals.approve': {
    label: 'Approve withdrawals',
    description: 'Release a payout to the payment provider. Moves real money.',
    category: 'Operations',
    risk: 'critical',
  },
  'withdrawals.reject': {
    label: 'Reject withdrawals',
    description: 'Decline a payout and refund the held amount.',
    category: 'Operations',
    risk: 'high',
  },
  'withdrawals.retry': {
    label: 'Retry withdrawals',
    description: 'Re-attempt a failed payout, optionally against another provider.',
    category: 'Operations',
    risk: 'critical',
  },
  'withdrawals.resolve': {
    label: 'Manually resolve withdrawals',
    description: 'Mark a payout paid or refunded without a provider call. Bypasses the gateway.',
    category: 'Operations',
    risk: 'critical',
  },
  'withdrawals.export': {
    label: 'Export withdrawals',
    description: 'Export withdrawal data matching the current filters.',
    category: 'Operations',
    risk: 'high',
  },
  'transactions.read': {
    label: 'View transactions',
    description: 'Search and inspect the financial ledger.',
    category: 'Operations',
    risk: 'medium',
  },
  'transactions.export': {
    label: 'Export transactions',
    description: 'Export ledger data matching the current filters.',
    category: 'Operations',
    risk: 'high',
  },
  'flags.read': {
    label: 'View flagged transactions',
    description: 'Read automatically flagged transactions and their triggers.',
    category: 'Operations',
    risk: 'medium',
  },
  'flags.resolve': {
    label: 'Resolve flagged transactions',
    description: 'Clear, escalate or reject a transaction flag.',
    category: 'Operations',
    risk: 'high',
  },
  'reconciliation.read': {
    label: 'View reconciliation',
    description: 'Read reconciliation runs and mismatches.',
    category: 'Operations',
    risk: 'high',
  },
  'reconciliation.resolve': {
    label: 'Resolve reconciliation mismatches',
    description: 'Retry a sync, raise an adjustment or mark a mismatch resolved.',
    category: 'Operations',
    risk: 'critical',
  },

  'users.read': {
    label: 'View users',
    description: 'Read the user directory and user detail.',
    category: 'Users',
    risk: 'medium',
  },
  'users.edit': {
    label: 'Edit users',
    description: 'Change a user profile and account settings.',
    category: 'Users',
    risk: 'high',
  },
  'users.freeze': {
    label: 'Freeze and unfreeze users',
    description: 'Suspend or restore account access, blocking all financial activity.',
    category: 'Users',
    risk: 'high',
  },
  'users.note': {
    label: 'Annotate users',
    description: 'Add internal notes and tags to a user.',
    category: 'Users',
    risk: 'low',
  },
  'users.sessions': {
    label: 'Terminate user sessions',
    description: 'Force a user to sign out of every device.',
    category: 'Users',
    risk: 'high',
  },
  'users.export': {
    label: 'Export users',
    description: 'Export user data matching the current filters.',
    category: 'Users',
    risk: 'high',
  },
  'users.delete': {
    label: 'Delete or anonymize users',
    description: 'Start the account deletion and anonymization workflow. Irreversible.',
    category: 'Users',
    risk: 'critical',
  },
  'user_activity.read': {
    label: 'View user activity',
    description: 'Read login history, device logs and live activity.',
    category: 'Users',
    risk: 'medium',
  },

  'wallets.read': {
    label: 'View wallets',
    description: 'Read wallet balances and the wallet ledger.',
    category: 'Financial',
    risk: 'high',
  },
  'wallets.adjust': {
    label: 'Request wallet adjustments',
    description: 'Raise a manual credit or debit against a user wallet.',
    category: 'Financial',
    risk: 'critical',
  },
  'wallets.approve_adjustment': {
    label: 'Approve wallet adjustments',
    description: 'Second-approve a wallet adjustment raised by another admin.',
    category: 'Financial',
    risk: 'critical',
  },
  'rates.read': {
    label: 'View rates',
    description: 'Read current card rates and rate history.',
    category: 'Financial',
    risk: 'low',
  },
  'rates.write': {
    label: 'Draft rate changes',
    description: 'Create and edit rate values without publishing them.',
    category: 'Financial',
    risk: 'high',
  },
  'rates.publish': {
    label: 'Publish rates',
    description: 'Make rate changes live. Changes every subsequent payout calculation.',
    category: 'Financial',
    risk: 'critical',
  },
  'limits.read': {
    label: 'View limits and fees',
    description: 'Read transaction limits, fees and thresholds.',
    category: 'Financial',
    risk: 'low',
  },
  'limits.write': {
    label: 'Change limits and fees',
    description: 'Change transaction limits, fees and thresholds.',
    category: 'Financial',
    risk: 'high',
  },
  'platform_balance.read': {
    label: 'View platform balance',
    description: 'Read provider and platform float balances.',
    category: 'Financial',
    risk: 'high',
  },
  'platform_balance.write': {
    label: 'Adjust platform balance',
    description: 'Change the recorded platform balance and refresh it from providers.',
    category: 'Financial',
    risk: 'critical',
  },

  'catalog.read': {
    label: 'View gift card catalog',
    description: 'Read card brands, the countries they are sold in and their logos.',
    category: 'Gift Cards',
    risk: 'low',
  },
  'catalog.write': {
    label: 'Edit gift card catalog',
    description: 'Create and edit card brands and their countries, and upload logos.',
    category: 'Gift Cards',
    risk: 'medium',
  },
  'catalog.publish': {
    label: 'Publish catalog changes',
    description: 'Activate, deactivate, archive and reorder card brands visible to users.',
    category: 'Gift Cards',
    risk: 'high',
  },
  'card_types.read': {
    label: 'View card types and fields',
    description: 'Read card-type templates and the fields users fill in when they submit a card.',
    category: 'Gift Cards',
    risk: 'low',
  },
  'card_types.write': {
    label: 'Edit card types and fields',
    description: 'Create, edit, reorder and remove card-type templates and their submission fields, and add them to countries.',
    category: 'Gift Cards',
    risk: 'medium',
  },

  'rewards.read': {
    label: 'View rewards',
    description: 'Read bonuses, levels, giftbox items and reward claims.',
    category: 'Rewards',
    risk: 'low',
  },
  'rewards.write': {
    label: 'Configure rewards',
    description: 'Change bonus amounts, level thresholds and giftbox items. Changes platform liability.',
    category: 'Rewards',
    risk: 'high',
  },
  'coupons.read': {
    label: 'View coupons',
    description: 'Read coupons and redemption history.',
    category: 'Rewards',
    risk: 'low',
  },
  'coupons.write': {
    label: 'Manage coupons',
    description: 'Create, edit, disable and extend coupons.',
    category: 'Rewards',
    risk: 'medium',
  },
  'referrals.read': {
    label: 'View referrals',
    description: 'Read the referral programme, tree and payout status.',
    category: 'Rewards',
    risk: 'low',
  },
  'referrals.write': {
    label: 'Configure referrals',
    description: 'Change referral bonus amounts and programme rules.',
    category: 'Rewards',
    risk: 'high',
  },
  'referrals.payout': {
    label: 'Manage referral payouts',
    description: 'Approve, retry, reject and mark referral payouts paid.',
    category: 'Rewards',
    risk: 'critical',
  },

  'communications.read': {
    label: 'View broadcasts',
    description: 'Read broadcasts, their audiences and delivery history.',
    category: 'Communications',
    risk: 'low',
  },
  'communications.write': {
    label: 'Draft broadcasts',
    description: 'Create and edit broadcasts without sending them.',
    category: 'Communications',
    risk: 'medium',
  },
  'notification_templates.read': {
    label: 'View notification templates',
    description: 'Read the push and in-app notification texts the platform sends automatically.',
    category: 'Communications',
    risk: 'low',
  },
  'notification_templates.write': {
    label: 'Edit notification templates',
    description: 'Change the push and in-app notification texts users receive after trades, payouts and other events.',
    category: 'Communications',
    risk: 'medium',
  },
  'email_templates.read': {
    label: 'View email templates',
    description: 'Read the email templates the platform sends automatically.',
    category: 'Communications',
    risk: 'low',
  },
  'email_templates.write': {
    label: 'Edit email templates',
    description: 'Change the subject and body of the emails users receive automatically.',
    category: 'Communications',
    risk: 'medium',
  },
  'communications.send': {
    label: 'Send to a segment',
    description: 'Send a push or email campaign to a filtered audience.',
    category: 'Communications',
    risk: 'high',
  },
  'communications.send_all': {
    label: 'Send to all users',
    description: 'Send to the entire user base. Cannot be recalled once delivery starts.',
    category: 'Communications',
    risk: 'critical',
  },

  'risk.read': {
    label: 'View risk',
    description: 'Read the risk dashboard, signals and investigation cases.',
    category: 'Risk & Security',
    risk: 'medium',
  },
  'risk.case_write': {
    label: 'Manage investigation cases',
    description: 'Create, assign, annotate and update investigation cases.',
    category: 'Risk & Security',
    risk: 'medium',
  },
  'risk.resolve': {
    label: 'Resolve risk cases',
    description: 'Close, escalate and resolve investigation cases.',
    category: 'Risk & Security',
    risk: 'high',
  },
  'anomaly.read': {
    label: 'View anomaly alerts',
    description: 'Read anomaly detection alerts and their detail.',
    category: 'Risk & Security',
    risk: 'medium',
  },
  'anomaly.write': {
    label: 'Configure anomaly detection',
    description: 'Change anomaly thresholds and acknowledge alerts.',
    category: 'Risk & Security',
    risk: 'high',
  },
  'security.read': {
    label: 'View security controls',
    description: 'Read rate limits, IP allowlists and security events.',
    category: 'Risk & Security',
    risk: 'medium',
  },
  'security.write': {
    label: 'Change security controls',
    description: 'Change rate limits and webhook IP allowlists. A wrong value can lock out providers.',
    category: 'Risk & Security',
    risk: 'critical',
  },

  'providers.read': {
    label: 'View providers',
    description: 'Read payment and bill provider configuration and health.',
    category: 'Integrations',
    risk: 'medium',
  },
  'providers.write': {
    label: 'Configure providers',
    description: 'Change provider settings and credentials.',
    category: 'Integrations',
    risk: 'critical',
  },
  'providers.switch': {
    label: 'Switch primary provider',
    description: 'Change which provider handles live traffic, or force a failover.',
    category: 'Integrations',
    risk: 'critical',
  },
  'webhooks.read': {
    label: 'View webhooks',
    description: 'Read webhook endpoints, deliveries and provider events.',
    category: 'Integrations',
    risk: 'medium',
  },

  'analytics.read': {
    label: 'View analytics',
    description: 'Read business, operations, financial, user and risk analytics.',
    category: 'Analytics',
    risk: 'medium',
  },
  'reports.run': {
    label: 'Run reports',
    description: 'Execute reports and queue report jobs.',
    category: 'Analytics',
    risk: 'medium',
  },
  'reports.export': {
    label: 'Export reports',
    description: 'Download report output.',
    category: 'Analytics',
    risk: 'high',
  },

  'system.read': {
    label: 'View system health',
    description: 'Read service health, queues and background job status.',
    category: 'System',
    risk: 'low',
  },
  'system.jobs': {
    label: 'Control background jobs',
    description: 'Retry and cancel background jobs.',
    category: 'System',
    risk: 'high',
  },
  'configuration.read': {
    label: 'View configuration',
    description: 'Read platform configuration and its change history.',
    category: 'System',
    risk: 'medium',
  },
  'configuration.write': {
    label: 'Draft configuration changes',
    description: 'Edit configuration without publishing it.',
    category: 'System',
    risk: 'high',
  },
  'configuration.publish': {
    label: 'Publish configuration',
    description: 'Apply configuration changes to the live platform.',
    category: 'System',
    risk: 'critical',
  },
  'emergency.manage': {
    label: 'Operate emergency controls',
    description: 'Enable emergency mode and pause withdrawals, trading, bills, rewards or registration.',
    category: 'System',
    risk: 'critical',
  },

  'admin_users.read': {
    label: 'View admins',
    description: 'Read the admin directory and admin detail.',
    category: 'Administration',
    risk: 'medium',
  },
  'admin_users.manage': {
    label: 'Manage admins',
    description: 'Invite, edit, deactivate and delete administrator accounts.',
    category: 'Administration',
    risk: 'critical',
  },
  'admin_users.sessions': {
    label: 'Manage admin sessions',
    description: 'View and revoke administrator sessions.',
    category: 'Administration',
    risk: 'high',
  },
  'roles.read': {
    label: 'View roles',
    description: 'Read role definitions and their permission sets.',
    category: 'Administration',
    risk: 'low',
  },
  'roles.write': {
    label: 'Manage roles',
    description: 'Create and edit roles and their permissions. Can escalate privilege.',
    category: 'Administration',
    risk: 'critical',
  },
  'audit.read': {
    label: 'View audit log',
    description: 'Read the administrative audit trail.',
    category: 'Administration',
    risk: 'high',
  },
  'audit.export': {
    label: 'Export audit log',
    description: 'Export audit records, which may contain sensitive metadata.',
    category: 'Administration',
    risk: 'critical',
  },

  'sensitive_data.reveal': {
    label: 'Reveal sensitive data',
    description: 'Unmask submitted card codes, full bank account numbers and other protected values.',
    category: 'Sensitive Data',
    risk: 'critical',
  },
  'sensitive_data.export': {
    label: 'Export sensitive data',
    description: 'Include protected columns such as bank account numbers in an export.',
    category: 'Sensitive Data',
    risk: 'critical',
  },
  'sensitive_data.download': {
    label: 'Download card images',
    description: 'Download submitted card images to local storage. Every download is recorded in the audit log.',
    category: 'Sensitive Data',
    risk: 'critical',
  },
  'sensitive_data.share': {
    label: 'Share card submissions',
    description: 'Send a submitted card, including its redeemable code, outside the console by WhatsApp, Telegram, email, copy or the device share sheet. Every share is recorded in the audit log.',
    category: 'Sensitive Data',
    risk: 'critical',
  },
} as const satisfies Record<string, PermissionMeta>;

export type Permission = keyof typeof CATALOG;

export const PERMISSION_CATALOG: Readonly<Record<Permission, PermissionMeta>> = CATALOG;

export const ALL_PERMISSIONS = Object.keys(CATALOG) as Permission[];

const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

export function permissionsByCategory(): { category: PermissionCategory; permissions: Permission[] }[] {
  return PERMISSION_CATEGORIES.map((category) => ({
    category,
    permissions: ALL_PERMISSIONS.filter((p) => CATALOG[p].category === category),
  })).filter((g) => g.permissions.length > 0);
}

export const LEGACY_PERMISSION_MAP: Readonly<Record<string, readonly Permission[]>> = {
  dashboard: [],
  card_queue: ['cards.read', 'cards.review', 'cards.assign', 'cards.note', 'cards.export', 'sensitive_data.reveal'],
  withdrawals: ['withdrawals.read', 'withdrawals.approve', 'withdrawals.reject', 'withdrawals.retry', 'withdrawals.resolve', 'withdrawals.export'],
  transactions_overview: ['transactions.read', 'transactions.export'],
  users: ['users.read', 'users.edit', 'users.export', 'users.note'],
  users_freeze: ['users.freeze'],
  user_activity_monitor: ['user_activity.read', 'users.sessions'],
  activity: ['audit.read', 'audit.export'],
  admin_accounts: ['admin_users.read', 'admin_users.manage', 'admin_users.sessions', 'roles.read'],
  card_management: ['catalog.read', 'catalog.write', 'catalog.publish'],
  card_type_builder: ['card_types.read', 'card_types.write'],
  rates_management: ['rates.read', 'rates.write', 'rates.publish'],
  bonuses_rewards: ['rewards.read', 'rewards.write'],
  coupons: ['coupons.read', 'coupons.write'],
  referral_management: ['referrals.read', 'referrals.write', 'referrals.payout'],
  notifications_broadcast: ['communications.read', 'communications.write', 'communications.send', 'communications.send_all'],
  notification_templates: ['notification_templates.read', 'notification_templates.write'],
  email_templates: ['email_templates.read', 'email_templates.write'],
  platform_balance: ['platform_balance.read', 'platform_balance.write', 'wallets.read'],
  limits_fees: ['limits.read', 'limits.write'],
  bill_settings: ['providers.read', 'providers.write'],
  admin_settings: ['configuration.read', 'configuration.write', 'configuration.publish'],
  anomaly_alerts: ['anomaly.read', 'anomaly.write', 'risk.read'],
  security_limits: ['security.read', 'security.write'],
};

export function holdsAny(permissions: ReadonlySet<Permission>, needed: Permission | readonly Permission[]): boolean {
  return typeof needed === 'string' ? permissions.has(needed) : needed.some((permission) => permissions.has(permission));
}

export function resolvePermissions(
  stored: readonly string[] | null | undefined,
  isSuperAdmin: boolean,
): Set<Permission> {
  if (isSuperAdmin) return new Set(ALL_PERMISSIONS);
  const out = new Set<Permission>();
  for (const raw of stored || []) {
    const key = String(raw || '').trim();
    if (!key) continue;
    if (isPermission(key)) {
      out.add(key);
      continue;
    }
    const expanded = LEGACY_PERMISSION_MAP[key];
    if (expanded) for (const p of expanded) out.add(p);
  }
  return out;
}

export function resolveAdminPermissions(admin: AdminJWTPayload | null): Set<Permission> {
  if (!admin) return new Set();
  return resolvePermissions(admin.page_permissions, admin.is_super_admin);
}

export function permissionLabel(key: Permission): string {
  return CATALOG[key].label;
}

export function permissionRisk(key: Permission): PermissionRisk {
  return CATALOG[key].risk;
}
