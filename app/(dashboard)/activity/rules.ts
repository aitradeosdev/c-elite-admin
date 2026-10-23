import { redactAudit } from '../../lib/redact';
import { MASK, METADATA_MASK_KEYS, isMaskable, maskMetadata } from '../../lib/mask';
import { BUSINESS_TZ } from '../../lib/time';
import { formatNaira } from '../../_ui/money';

export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const LEGACY_DEFAULT_LIMIT = 100;
export const LEGACY_MAX_LIMIT = 200;
export const EXPORT_CAP = 5000;
export const SEARCH_MAX = 64;
export const SEARCH_USER_CAP = 50;
export const JSON_MASK_KEYS: readonly string[] = [...METADATA_MASK_KEYS, 'submitted_fields'];

export type AuditResult = 'success' | 'failure' | 'partial';
export type ResultFilter = AuditResult | 'unrecorded';
export type EventTone = 'success' | 'warning' | 'danger' | 'neutral';

export const RESULT_FILTERS: readonly ResultFilter[] = ['success', 'failure', 'partial', 'unrecorded'];

const RESULT_TEXT: Readonly<Record<ResultFilter, string>> = {
  success: 'Succeeded',
  failure: 'Failed',
  partial: 'Partly completed',
  unrecorded: 'Not recorded',
};

const RESULT_TONES: Readonly<Record<ResultFilter, EventTone>> = {
  success: 'success',
  failure: 'danger',
  partial: 'warning',
  unrecorded: 'neutral',
};

function own<V>(record: Readonly<Record<string, V>>, key: string): V | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function humanize(raw: string): string {
  return capitalize(raw.replace(/[_\s]+/g, ' ').trim().toLowerCase());
}

export function isResultFilter(value: unknown): value is ResultFilter {
  return typeof value === 'string' && (RESULT_FILTERS as readonly string[]).includes(value);
}

export function resultKind(value: unknown): ResultFilter | null {
  const raw = text(value);
  if (raw === null) return 'unrecorded';
  return raw === 'success' || raw === 'failure' || raw === 'partial' ? raw : null;
}

export function resultLabel(value: unknown): string {
  const kind = resultKind(value);
  return kind ? RESULT_TEXT[kind] : humanize(String(value));
}

export function resultFilterLabel(value: ResultFilter): string {
  return RESULT_TEXT[value];
}

export function resultTone(value: unknown): EventTone {
  const kind = resultKind(value);
  return kind ? RESULT_TONES[kind] : 'neutral';
}

const SENSITIVITY_TEXT: Readonly<Record<string, string>> = {
  normal: 'Normal',
  financial: 'Financial',
  security: 'Security',
  sensitive: 'Sensitive data',
};

export function sensitivityLabel(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  return own(SENSITIVITY_TEXT, raw) ?? humanize(raw);
}

export function isElevatedSensitivity(value: unknown): boolean {
  const raw = text(value);
  return raw !== null && raw !== 'normal';
}

type ActionEntry = readonly [key: string, label: string];

export interface ActionOption {
  value: string;
  label: string;
}

export interface ActionGroup {
  label: string;
  options: readonly ActionOption[];
}

const CATALOGUE: ReadonlyArray<readonly [string, ReadonlyArray<ActionEntry>]> = [
  ['Card queue', [
    ['APPROVE_CARD', 'Approved card'],
    ['APPROVE_CARD_CORRECTED', 'Approved card with corrections'],
    ['REJECT_CARD', 'Rejected card'],
    ['OVERTURN_DISPUTE', 'Overturned card dispute'],
    ['UPHOLD_DISPUTE', 'Upheld card dispute'],
    ['SHARE_CARD_SUBMISSION', 'Shared card submission'],
    ['DOWNLOAD_CARD_IMAGES', 'Downloaded card images'],
  ]],
  ['Withdrawals and risk', [
    ['APPROVE_WITHDRAWAL', 'Approved withdrawal'],
    ['REJECT_WITHDRAWAL', 'Rejected withdrawal'],
    ['RESUME_WITHDRAWAL_OK', 'Payout sent to provider'],
    ['RESUME_WITHDRAWAL_FAILED', 'Payout could not be sent'],
    ['RESUME_WITHDRAWAL_UNCONFIRMED', 'Payout could not be confirmed, stays processing, do not pay again by hand'],
    ['CLEAR_FLAG', 'Cleared flag'],
    ['ESCALATE_FLAG', 'Escalated flag'],
    ['REJECT_FLAG', 'Rejected flagged transaction'],
  ]],
  ['Users', [
    ['FREEZE_USER', 'Froze user'],
    ['UNFREEZE_USER', 'Unfroze user'],
    ['TERMINATE_USER_SESSIONS', 'Ended user sessions'],
    ['CREDIT_WALLET', 'Credited wallet'],
    ['DEBIT_WALLET', 'Debited wallet'],
  ]],
  ['Admins and sign-in', [
    ['CREATE_ADMIN', 'Created admin'],
    ['ADMIN_INVITE_SENT', 'Sent admin invitation'],
    ['ADMIN_INVITE_ACCEPTED', 'Accepted admin invitation'],
    ['EDIT_ADMIN', 'Edited admin'],
    ['EDIT_ADMIN_ACCESS', 'Changed admin access'],
    ['GRANT_SUPER_ADMIN', 'Granted super admin'],
    ['REMOVE_SUPER_ADMIN', 'Removed super admin'],
    ['REVOKE_ADMIN_SESSIONS', 'Signed admin out everywhere'],
    ['DEACTIVATE_ADMIN', 'Deactivated admin'],
    ['REACTIVATE_ADMIN', 'Reactivated admin'],
    ['DELETE_ADMIN', 'Deleted admin'],
    ['CREATE_ADMIN_ROLE', 'Created role'],
    ['EDIT_ADMIN_ROLE', 'Edited role'],
    ['ARCHIVE_ADMIN_ROLE', 'Archived role'],
    ['RESTORE_ADMIN_ROLE', 'Restored role'],
    ['ADMIN_AUTO_DEACTIVATED', 'Admin locked after failed sign-ins'],
    ['ADMIN_AUTO_DEACTIVATION_SKIPPED', 'Admin lock skipped for last super admin'],
    ['LOGIN', 'Signed in'],
    ['LOGIN_FAILED', 'Sign-in failed'],
    ['LOGIN_MFA_SETUP_REQUIRED', 'Sign-in needed two-step setup'],
    ['LOGOUT', 'Signed out'],
    ['PASSWORD_CHANGED', 'Changed own password'],
    ['PASSWORD_CHANGE_FAILED', 'Password change failed'],
    ['PASSWORD_RESET_REQUESTED', 'Requested password reset'],
    ['PASSWORD_RESET_COMPLETED', 'Reset password from email link'],
    ['MFA_ENABLED', 'Turned on two-step sign-in'],
    ['MFA_CHALLENGE_FAILED', 'Two-step code failed'],
    ['MFA_LOCKED', 'Two-step sign-in locked'],
    ['MFA_RECOVERY_CODE_USED', 'Signed in with a recovery code'],
    ['MFA_RECOVERY_CODES_REPLACED', 'Replaced recovery codes'],
    ['MFA_RESET', 'Reset admin two-step sign-in'],
    ['MFA_BREAK_GLASS_RESET', 'Two-step sign-in reset in the database'],
    ['REAUTH', 'Confirmed identity'],
    ['REAUTH_FAILED', 'Security check failed'],
    ['ADMIN_SESSION_REVOKED', 'Signed out a device'],
    ['ADMIN_SESSIONS_SIGNED_OUT_OTHERS', 'Signed out other devices'],
    ['ADMIN_SESSIONS_SIGNED_OUT_EVERYWHERE', 'Signed out everywhere'],
    ['SECURITY_POLICY_CHANGED', 'Changed two-step requirement'],
    ['UPDATE_ADMIN_THEME', 'Changed theme'],
  ]],
  ['Catalog', [
    ['CREATE_CARD', 'Created card'],
    ['UPDATE_CARD', 'Updated card'],
    ['REORDER_CARDS', 'Reordered cards'],
    ['UPLOAD_CARD_LOGO', 'Uploaded card logo'],
    ['ADD_CARD_COUNTRY', 'Added country to card'],
    ['UPDATE_CARD_COUNTRY', 'Updated card country'],
    ['REMOVE_CARD_COUNTRY', 'Removed card country'],
    ['CREATE_CARD_TYPE_TEMPLATE', 'Created card type template'],
    ['UPDATE_CARD_TYPE_TEMPLATE', 'Updated card type template'],
    ['DELETE_CARD_TYPE_TEMPLATE', 'Deleted card type template'],
    ['REORDER_CARD_TYPE_TEMPLATES', 'Reordered card type templates'],
    ['CREATE_TEMPLATE_FIELD', 'Created template field'],
    ['UPDATE_TEMPLATE_FIELD', 'Updated template field'],
    ['DELETE_TEMPLATE_FIELD', 'Deleted template field'],
    ['REORDER_TEMPLATE_FIELDS', 'Reordered template fields'],
    ['ADD_CARD_TYPE_TO_COUNTRY', 'Added card type to country'],
    ['REACTIVATE_CARD_TYPE_COUNTRY', 'Reactivated card type in country'],
    ['SET_CARD_TYPE_COUNTRY_ACTIVE', 'Changed card type availability'],
  ]],
  ['Rates', [
    ['UPDATE_RATE', 'Updated rate'],
    ['CREATE_DENOMINATION', 'Created rate range'],
  ]],
  ['Rewards', [
    ['CREATE_COUPON', 'Created coupon'],
    ['UPDATE_COUPON', 'Updated coupon'],
    ['DELETE_COUPON', 'Deleted coupon'],
    ['CREATE_GIFTBOX_ITEM', 'Created gift box item'],
    ['UPDATE_GIFTBOX_ITEM', 'Updated gift box item'],
    ['UPDATE_LEVEL_TIER', 'Updated level tier'],
    ['UPLOAD_LEVEL_BADGE', 'Uploaded level badge'],
  ]],
  ['Communications', [
    ['BROADCAST_NOTIFICATION', 'Sent broadcast'],
    ['UPDATE_NOTIFICATION_TEMPLATE', 'Updated notification template'],
    ['UPDATE_EMAIL_TEMPLATE', 'Updated email template'],
  ]],
  ['Settings', [
    ['UPDATE_ADMIN_SETTINGS', 'Updated admin settings'],
    ['ENABLE_EMERGENCY_MODE', 'Turned on emergency mode'],
    ['DISABLE_EMERGENCY_MODE', 'Turned off emergency mode'],
    ['UPDATE_PLATFORM_BALANCE', 'Updated platform balance'],
    ['UPDATE_LIMITS_FEES', 'Updated limits & fees'],
    ['UPDATE_BILL_SETTINGS', 'Updated bill settings'],
    ['UPDATE_ANOMALY_ALERTS', 'Updated anomaly alerts'],
    ['UPDATE_SECURITY_LIMITS', 'Updated rate limits & IPs'],
    ['UPDATE_APP_CONFIG', 'Updated app configuration'],
  ]],
  ['Exports', [
    ['EXPORT_CSV', 'Exported CSV'],
    ['EXPORT_PDF', 'Exported PDF'],
  ]],
  ['System', [
    ['PURGE_DELETED_ACCOUNT_WITHDRAWALS', 'Deleted-account withdrawal data purged'],
  ]],
  ['Retired actions', [
    ['BATCH_UPDATE_RATES', 'Updated rates'],
    ['CREATE_CARD_TYPE', 'Created card type'],
    ['UPDATE_CARD_TYPE', 'Updated card type'],
    ['DELETE_CARD_TYPE', 'Deleted card type'],
    ['CREATE_FIELD', 'Created field'],
    ['UPDATE_FIELD', 'Updated field'],
    ['DELETE_FIELD', 'Deleted field'],
    ['REORDER_FIELDS', 'Reordered fields'],
    ['GRANT_FEATURE_OVERRIDE', 'Granted feature override'],
    ['REVOKE_FEATURE_OVERRIDE', 'Revoked feature override'],
    ['REFUND_TRANSFER', 'Refunded transfer'],
  ]],
];

const ACTION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  OVERTURN_DISPUTE: ['OVERTURN_CARD_DISPUTE'],
  UPHOLD_DISPUTE: ['UPHOLD_CARD_DISPUTE'],
};

const ALIAS_LABELS: ReadonlyArray<ActionEntry> = [
  ['OVERTURN_CARD_DISPUTE', 'Overturned card dispute'],
  ['UPHOLD_CARD_DISPUTE', 'Upheld card dispute'],
];

export const ACTION_GROUPS: readonly ActionGroup[] = CATALOGUE.map(([label, entries]) => ({
  label,
  options: entries.map(([value, name]) => ({ value, label: name })),
}));

const ACTION_TEXT: ReadonlyMap<string, string> = new Map<string, string>([
  ...CATALOGUE.flatMap(([, entries]) => entries),
  ...ALIAS_LABELS,
]);

const LISTED_ACTIONS: ReadonlySet<string> = new Set(CATALOGUE.flatMap(([, entries]) => entries.map(([key]) => key)));

const PAST_TENSE: ReadonlyMap<string, string> = new Map<string, string>([
  ['activate', 'Activated'], ['add', 'Added'], ['approve', 'Approved'], ['archive', 'Archived'],
  ['assign', 'Assigned'], ['cancel', 'Cancelled'], ['change', 'Changed'], ['clear', 'Cleared'],
  ['create', 'Created'], ['credit', 'Credited'], ['deactivate', 'Deactivated'], ['debit', 'Debited'],
  ['delete', 'Deleted'], ['disable', 'Disabled'], ['download', 'Downloaded'], ['edit', 'Edited'],
  ['enable', 'Enabled'], ['end', 'Ended'], ['escalate', 'Escalated'], ['export', 'Exported'],
  ['freeze', 'Froze'], ['grant', 'Granted'], ['import', 'Imported'], ['mark', 'Marked'], ['pay', 'Paid'],
  ['publish', 'Published'], ['reactivate', 'Reactivated'], ['refund', 'Refunded'], ['reject', 'Rejected'],
  ['remove', 'Removed'], ['reorder', 'Reordered'], ['reset', 'Reset'], ['resolve', 'Resolved'],
  ['restore', 'Restored'], ['retry', 'Retried'], ['reveal', 'Revealed'], ['revoke', 'Revoked'],
  ['schedule', 'Scheduled'], ['send', 'Sent'], ['set', 'Set'], ['share', 'Shared'],
  ['terminate', 'Terminated'], ['toggle', 'Toggled'], ['unassign', 'Unassigned'], ['unfreeze', 'Unfroze'],
  ['update', 'Updated'], ['upload', 'Uploaded'], ['view', 'Viewed'],
]);

export const ACTION_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
export const ENTITY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

const LABEL_MATCH_MIN = 3;

function humanizeAction(raw: string): string {
  const words = raw.toLowerCase().split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return 'Unknown action';
  const [verb, ...rest] = words;
  return [PAST_TENSE.get(verb) ?? capitalize(verb), ...rest].join(' ');
}

export function actionLabel(raw: unknown): string {
  const key = text(raw);
  if (key === null) return 'Unknown action';
  return ACTION_TEXT.get(key) ?? humanizeAction(key);
}

export function isListedAction(key: string): boolean {
  return LISTED_ACTIONS.has(key);
}

export function isActionKey(value: unknown): value is string {
  return typeof value === 'string' && ACTION_PATTERN.test(value);
}

export function isEntityKey(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_PATTERN.test(value);
}

export function actionFilterKeys(action: string): string[] {
  return [action, ...(own(ACTION_ALIASES, action) ?? [])];
}

export function actionsMatching(query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < LABEL_MATCH_MIN) return [];
  const keys: string[] = [];
  for (const [key, label] of ACTION_TEXT) {
    if (label.toLowerCase().includes(needle)) keys.push(key);
  }
  return keys;
}

export const SYSTEM_ACTION = 'PURGE_DELETED_ACCOUNT_WITHDRAWALS';
export const SYSTEM_ACTOR = 'System';

export function isSystemEvent(event: Pick<StoredAuditRow, 'admin_id' | 'action'>): boolean {
  return text(event.admin_id) === null && event.action === SYSTEM_ACTION;
}

const PURGE_COUNTS: ReadonlyArray<readonly [key: string, one: string, many: string]> = [
  ['withdrawals', 'withdrawal', 'withdrawals'],
  ['transactions', 'transaction', 'transactions'],
  ['flagged_transactions', 'flagged transaction', 'flagged transactions'],
  ['anomaly_check_queue', 'anomaly check', 'anomaly checks'],
  ['admin_alerts', 'admin alert', 'admin alerts'],
  ['security_alerts', 'security alert', 'security alerts'],
  ['notifications', 'notification', 'notifications'],
];

const COUNT_FORMAT = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });

export function actionDescription(event: Pick<ActivityEvent, 'action' | 'after_value'>): string | null {
  const after = event.after_value;
  if (event.action !== SYSTEM_ACTION || !isRecord(after)) return null;
  const counts: string[] = [];
  for (const [key, one, many] of PURGE_COUNTS) {
    const value = after[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
    counts.push(`${COUNT_FORMAT.format(value)} ${value === 1 ? one : many}`);
  }
  return `Removed from deleted accounts after the retention period: ${counts.slice(0, -1).join(', ')} and ${counts[counts.length - 1]}.`;
}

const ENTITY_TEXT: Readonly<Record<string, string>> = {
  admin_roles: 'Role',
  admin_users: 'Admin account',
  app_config: 'Configuration',
  audit_log: 'Audit log',
  card_countries: 'Card country',
  card_logos: 'Card logo',
  card_submissions: 'Card submission',
  card_type_fields: 'Card type field',
  card_type_template_fields: 'Template field',
  card_type_templates: 'Card type template',
  card_types: 'Card type',
  cards: 'Card brand',
  coupons: 'Coupon',
  denominations: 'Rate range',
  email_templates: 'Email template',
  feature_overrides: 'Feature override',
  flagged_transactions: 'Flagged transaction',
  giftbox_items: 'Gift box item',
  level_badges: 'Level badge',
  level_tiers: 'Level tier',
  notification_broadcasts: 'Broadcast',
  notification_templates: 'Notification template',
  transactions: 'Transactions',
  transfers: 'Transfer',
  users: 'User',
  wallet_adjustments: 'Wallet adjustment',
  withdrawals: 'Withdrawal',
};

export interface EntityOption {
  value: string;
  label: string;
}

export const ENTITY_OPTIONS: readonly EntityOption[] = Object.entries(ENTITY_TEXT)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function entityLabel(raw: unknown): string {
  const key = text(raw);
  if (key === null) return '';
  return own(ENTITY_TEXT, key) ?? humanize(key);
}

export function isListedEntity(key: string): boolean {
  return own(ENTITY_TEXT, key) !== undefined;
}

export interface AuditMeta {
  admin_role: string | null;
  user_agent: string | null;
  request_id: string | null;
  reason: string | null;
  result: string | null;
  error: string | null;
  sensitivity: string | null;
}

const META_KEY = '__meta';

function readMeta(value: Record<string, unknown>): AuditMeta {
  return {
    admin_role: text(value.admin_role),
    user_agent: text(value.user_agent),
    request_id: text(value.request_id),
    reason: text(value.reason),
    result: text(value.result),
    error: text(value.error),
    sensitivity: text(value.sensitivity),
  };
}

export function splitMeta(value: unknown): { after: unknown; meta: AuditMeta | null } {
  if (!isRecord(value) || !isRecord(value[META_KEY])) return { after: value ?? null, meta: null };
  const rest: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key !== META_KEY) rest[key] = inner;
  }
  const keys = Object.keys(rest);
  const wrapped = keys.length === 1 && keys[0] === 'value' && !isRecord(rest.value);
  return {
    after: wrapped ? rest.value ?? null : keys.length === 0 ? null : rest,
    meta: readMeta(value[META_KEY] as Record<string, unknown>),
  };
}

export interface StoredAuditRow {
  id: string;
  admin_id: string | null;
  user_id: string | null;
  action: string | null;
  entity: string | null;
  entity_id: string | null;
  before_value: unknown;
  after_value: unknown;
  ip_address: string | null;
  created_at: string;
  admin_role?: string | null;
  user_agent?: string | null;
  request_id?: string | null;
  reason?: string | null;
  result?: string | null;
  error?: string | null;
  sensitivity?: string | null;
}

export interface AdminInfo {
  id: string;
  username: string | null;
  role_title: string | null;
  is_super_admin: boolean | null;
  is_active?: boolean | null;
  last_login_at?: string | null;
  deleted_at?: string | null;
}

export interface TargetInfo {
  username: string | null;
  label: string | null;
}

export interface ActivityEvent {
  id: string;
  admin_id: string | null;
  admin_username: string | null;
  admin_role_title: string | null;
  admin_is_super: boolean;
  admin_deleted: boolean;
  action: string;
  entity: string | null;
  entity_id: string | null;
  user_id: string | null;
  ip_address: string | null;
  created_at: string;
  target_username: string | null;
  target_label: string | null;
  admin_role: string | null;
  user_agent: string | null;
  request_id: string | null;
  reason: string | null;
  result: string | null;
  error: string | null;
  sensitivity: string | null;
  before_value: unknown;
  after_value: unknown;
}

export type PrintableEvent = Omit<ActivityEvent, 'before_value' | 'after_value'>;

export function presentEvent(row: StoredAuditRow, admin: AdminInfo | undefined, target: TargetInfo): ActivityEvent {
  const { after, meta } = splitMeta(row.after_value);
  return {
    id: row.id,
    admin_id: text(row.admin_id),
    admin_username: text(admin?.username),
    admin_role_title: text(admin?.role_title),
    admin_is_super: admin?.is_super_admin === true,
    admin_deleted: Boolean(admin?.deleted_at),
    action: text(row.action) ?? '',
    entity: text(row.entity),
    entity_id: text(row.entity_id),
    user_id: text(row.user_id),
    ip_address: text(row.ip_address),
    created_at: row.created_at,
    target_username: target.username,
    target_label: target.label,
    admin_role: text(row.admin_role) ?? meta?.admin_role ?? null,
    user_agent: text(row.user_agent) ?? meta?.user_agent ?? null,
    request_id: text(row.request_id) ?? meta?.request_id ?? null,
    reason: text(row.reason) ?? meta?.reason ?? null,
    result: text(row.result) ?? meta?.result ?? null,
    error: text(row.error) ?? meta?.error ?? null,
    sensitivity: text(row.sensitivity) ?? meta?.sensitivity ?? null,
    before_value: redactAudit(row.before_value ?? null),
    after_value: redactAudit(after),
  };
}

const SCREEN_HIDDEN_KEYS: ReadonlySet<string> = new Set(['submitted_fields']);

function hideKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => hideKeys(item));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SCREEN_HIDDEN_KEYS.has(key) && isMaskable(inner) ? MASK : hideKeys(inner);
  }
  return out;
}

export function screenValue(value: unknown): unknown {
  return hideKeys(maskMetadata(redactAudit(value ?? null)));
}

export function forScreen(event: ActivityEvent): ActivityEvent {
  return { ...event, before_value: screenValue(event.before_value), after_value: screenValue(event.after_value) };
}

export function toPrintable(event: ActivityEvent): PrintableEvent {
  return {
    id: event.id,
    admin_id: event.admin_id,
    admin_username: event.admin_username,
    admin_role_title: event.admin_role_title,
    admin_is_super: event.admin_is_super,
    admin_deleted: event.admin_deleted,
    action: event.action,
    entity: event.entity,
    entity_id: event.entity_id,
    user_id: event.user_id,
    ip_address: event.ip_address,
    created_at: event.created_at,
    target_username: event.target_username,
    target_label: event.target_label,
    admin_role: event.admin_role,
    user_agent: event.user_agent,
    request_id: event.request_id,
    reason: event.reason,
    result: event.result,
    error: event.error,
    sensitivity: event.sensitivity,
  };
}

export type LookupRow = Record<string, unknown>;

export type TargetLookup = (entity: string, id: unknown) => LookupRow | null;

export interface TargetRef {
  column: string;
  entity: string;
}

export interface TargetSpec {
  table: string;
  columns: string;
  owner?: string;
  refs?: readonly TargetRef[];
  label: (row: LookupRow, look: TargetLookup) => string | null;
}

const CARD_REF: TargetRef = { column: 'card_id', entity: 'cards' };
const CARD_TYPE_REF: TargetRef = { column: 'card_type_id', entity: 'card_types' };
const TEMPLATE_REF: TargetRef = { column: 'template_id', entity: 'card_type_templates' };

const USD = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function amountOf(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(amount) ? amount : null;
}

function naira(value: unknown): string | null {
  const amount = amountOf(value);
  return amount === null ? null : formatNaira(amount);
}

function usd(value: unknown): string | null {
  const amount = amountOf(value);
  return amount === null ? null : `$${USD.format(amount)}`;
}

function handleOf(value: unknown): string | null {
  const name = text(value);
  return name ? `@${name}` : null;
}

function nameOf(row: LookupRow | null, column = 'name'): string | null {
  return row ? text(row[column]) : null;
}

function joined(parts: ReadonlyArray<string | null>, separator = ' · '): string | null {
  const shown = parts.filter((part): part is string => part !== null && part !== '');
  return shown.length > 0 ? shown.join(separator) : null;
}

function withSuffix(base: string | null, suffix: string | null): string | null {
  if (!suffix) return base;
  return base ? `${base} (${suffix})` : `(${suffix})`;
}

export const TARGET_SPECS: Readonly<Record<string, TargetSpec>> = {
  users: {
    table: 'users',
    columns: 'id, username',
    owner: 'id',
    label: (row) => handleOf(row.username),
  },
  withdrawals: {
    table: 'withdrawals',
    columns: 'id, user_id, amount, bank_name',
    owner: 'user_id',
    label: (row) => {
      const bank = text(row.bank_name);
      return joined([naira(row.amount), bank ? `to ${bank}` : null], ' ');
    },
  },
  card_submissions: {
    table: 'card_submissions',
    columns: 'id, user_id, card_id, amount_foreign, payout_naira',
    owner: 'user_id',
    refs: [CARD_REF],
    label: (row, look) => withSuffix(
      joined([nameOf(look('cards', row.card_id)) ?? 'Card', usd(row.amount_foreign)]),
      naira(row.payout_naira),
    ),
  },
  flagged_transactions: {
    table: 'flagged_transactions',
    columns: 'id, user_id, amount, transaction_type',
    owner: 'user_id',
    label: (row) => {
      const kind = text(row.transaction_type);
      return joined([naira(row.amount), kind ? humanize(kind) : null]);
    },
  },
  feature_overrides: {
    table: 'feature_overrides',
    columns: 'id, user_id, feature_key',
    owner: 'user_id',
    label: (row) => text(row.feature_key),
  },
  coupons: {
    table: 'coupons',
    columns: 'id, code',
    label: (row) => text(row.code),
  },
  cards: {
    table: 'cards',
    columns: 'id, name',
    label: (row) => text(row.name),
  },
  card_countries: {
    table: 'card_countries',
    columns: 'id, card_id, country_name',
    refs: [CARD_REF],
    label: (row, look) => joined([nameOf(look('cards', row.card_id)), text(row.country_name)]),
  },
  card_types: {
    table: 'card_types',
    columns: 'id, card_id, name, country_code',
    refs: [CARD_REF],
    label: (row, look) => joined([nameOf(look('cards', row.card_id)), text(row.name), text(row.country_code)]),
  },
  card_type_fields: {
    table: 'card_type_fields',
    columns: 'id, card_type_id, label',
    refs: [CARD_TYPE_REF],
    label: (row, look) => joined([nameOf(look('card_types', row.card_type_id)), text(row.label)]),
  },
  card_type_templates: {
    table: 'card_type_templates',
    columns: 'id, card_id, name',
    refs: [CARD_REF],
    label: (row, look) => joined([nameOf(look('cards', row.card_id)), text(row.name)]),
  },
  card_type_template_fields: {
    table: 'card_type_template_fields',
    columns: 'id, template_id, label',
    refs: [TEMPLATE_REF],
    label: (row, look) => joined([nameOf(look('card_type_templates', row.template_id)), text(row.label)]),
  },
  denominations: {
    table: 'denominations',
    columns: 'id, card_type_id, range_label, rate_naira',
    refs: [CARD_TYPE_REF],
    label: (row, look) => {
      const type = look('card_types', row.card_type_id);
      const card = type ? look('cards', type.card_id) : null;
      return withSuffix(joined([nameOf(card), text(row.range_label)]), naira(row.rate_naira));
    },
  },
  notification_broadcasts: {
    table: 'notification_broadcasts',
    columns: 'id, title',
    label: (row) => text(row.title),
  },
  giftbox_items: {
    table: 'giftbox_items',
    columns: 'id, title',
    label: (row) => text(row.title),
  },
  level_tiers: {
    table: 'level_tiers',
    columns: 'id, name',
    label: (row) => text(row.name),
  },
  admin_roles: {
    table: 'admin_roles',
    columns: 'id, name',
    label: (row) => text(row.name),
  },
};

export const PASSTHROUGH_TARGETS: ReadonlySet<string> = new Set([
  'app_config', 'card_logos', 'email_templates', 'level_badges', 'notification_templates',
]);

export function targetSpec(entity: string): TargetSpec | undefined {
  return own(TARGET_SPECS, entity);
}

export function targetRefs(entity: string, row: LookupRow): Array<{ entity: string; id: string }> {
  const spec = targetSpec(entity);
  if (!spec) return [];
  const refs: TargetRef[] = [...(spec.refs ?? [])];
  if (spec.owner && spec.owner !== 'id') refs.push({ column: spec.owner, entity: 'users' });
  const out: Array<{ entity: string; id: string }> = [];
  for (const ref of refs) {
    const id = text(row[ref.column]);
    if (id) out.push({ entity: ref.entity, id });
  }
  return out;
}

function passthroughLabel(entityId: string): string {
  return entityId === 'batch' ? 'Several settings' : entityId;
}

export function resolveTarget(
  row: Pick<StoredAuditRow, 'entity' | 'entity_id' | 'user_id'>,
  look: TargetLookup,
  adminOf: (id: string) => AdminInfo | undefined,
): TargetInfo {
  const entity = text(row.entity);
  const id = text(row.entity_id);
  const fallbackUser = nameOf(look('users', row.user_id), 'username');
  if (!entity || !id) return { username: fallbackUser, label: null };
  if (entity === 'admin_users') {
    const name = text(adminOf(id)?.username);
    return { username: name, label: name ? `@${name}` : null };
  }
  if (PASSTHROUGH_TARGETS.has(entity)) return { username: fallbackUser, label: passthroughLabel(id) };
  const spec = targetSpec(entity);
  const target = spec ? look(entity, id) : null;
  if (!spec || !target) return { username: fallbackUser, label: null };
  const owner = spec.owner ? nameOf(look('users', target[spec.owner]), 'username') : null;
  return { username: owner ?? fallbackUser, label: spec.label(target, look) };
}

const STAMP_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatStamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : STAMP_FORMAT.format(date);
}

export const EXPORT_COLUMNS = [
  'created_at', 'admin_username', 'admin_role_title', 'admin_is_super',
  'action', 'entity', 'entity_id', 'target_username', 'target_label',
  'ip_address', 'before_value', 'after_value', 'id',
  'created_at_lagos', 'action_label', 'result', 'reason', 'error', 'sensitivity',
  'request_id', 'user_agent', 'admin_role', 'user_id',
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportRecord(event: ActivityEvent): Record<ExportColumn, unknown> {
  return {
    created_at: event.created_at,
    admin_username: event.admin_username,
    admin_role_title: event.admin_role_title,
    admin_is_super: event.admin_is_super,
    action: event.action,
    entity: event.entity,
    entity_id: event.entity_id,
    target_username: event.target_username,
    target_label: event.target_label,
    ip_address: event.ip_address,
    before_value: event.before_value,
    after_value: event.after_value,
    id: event.id,
    created_at_lagos: formatStamp(event.created_at),
    action_label: actionLabel(event.action),
    result: event.result,
    reason: event.reason,
    error: event.error,
    sensitivity: event.sensitivity,
    request_id: event.request_id,
    user_agent: event.user_agent,
    admin_role: event.admin_role,
    user_id: event.user_id,
  };
}

export function toCsv(events: readonly ActivityEvent[]): string {
  const lines = events.map((event) => {
    const record = exportRecord(event);
    return EXPORT_COLUMNS.map((column) => csvCell(record[column])).join(',');
  });
  return [EXPORT_COLUMNS.join(','), ...lines].join('\n');
}
