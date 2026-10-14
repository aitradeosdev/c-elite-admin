import { isUuid } from './http';
import { isMaskable, maskMetadata, maskTail } from './mask';
import { redactAudit } from './redact';
import { sanitizeSearch } from './sanitize';

export type FlagStatus = 'pending_review' | 'escalated' | 'cleared' | 'rejected';
export type FlagSortKey = 'created_at' | 'amount';

export type StatusCounts = Readonly<Record<FlagStatus, number | null>>;

export interface WithdrawalSummary {
  id: string;
  status: string;
  amount: number | string | null;
  fee: number | string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  gateway: string | null;
  failure_reason: string | null;
  created_at: string | null;
}

export interface TransactionSummary {
  id: string;
  type: string | null;
  amount: number | string | null;
  status: string | null;
  reference_id: string | null;
  created_at: string | null;
  metadata: unknown;
}

export interface OtherFlag {
  id: string;
  flag_reason: string | null;
  status: string;
  created_at: string | null;
  reviewed_at: string | null;
}

export interface Reviewer {
  id: string;
  username: string | null;
}

export type FlagSearch =
  | { kind: 'none' }
  | { kind: 'id'; id: string }
  | { kind: 'text'; userTerm: string; fragment: string | null };

export const FLAG_STATUSES: readonly FlagStatus[] = ['pending_review', 'escalated', 'cleared', 'rejected'];
export const OPEN_STATUSES: readonly FlagStatus[] = ['pending_review', 'escalated'];
export const SEARCH_USER_CAP = 100;

const SEARCH_MAX = 64;

const STATUS_ALIASES: ReadonlyMap<string, readonly FlagStatus[]> = new Map<string, readonly FlagStatus[]>([
  ['open', OPEN_STATUSES],
  ['pending', ['pending_review']],
]);

const TYPE_TOKEN = /^[a-z0-9_]{1,40}$/;
const HEX_FRAGMENT = /^[0-9a-f-]{8,}$/;
const LEADING_AT = /^@+/;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function amountOf(value: unknown): number | string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function isFlagStatus(value: unknown): value is FlagStatus {
  return typeof value === 'string' && (FLAG_STATUSES as readonly string[]).includes(value);
}

export function firstOf(value: unknown): unknown {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function parseStatusFilter(raw: string | null | undefined): FlagStatus[] | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === '' || value === 'all') return [];
  const wanted = new Set<FlagStatus>();
  for (const token of value.split(',')) {
    const key = token.trim();
    if (!key) continue;
    const expanded = isFlagStatus(key) ? [key] : STATUS_ALIASES.get(key);
    if (!expanded) return null;
    for (const status of expanded) wanted.add(status);
  }
  if (wanted.size === 0) return null;
  return FLAG_STATUSES.filter((status) => wanted.has(status));
}

export function parseTypeFilter(raw: string | null | undefined): string | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === '' || value === 'all') return '';
  return TYPE_TOKEN.test(value) ? value : null;
}

export function parseSortKey(raw: string | null | undefined): FlagSortKey {
  return raw === 'amount' ? 'amount' : 'created_at';
}

export function planFlagSearch(raw: string | null | undefined): FlagSearch {
  const term = sanitizeSearch(typeof raw === 'string' ? raw : '', SEARCH_MAX);
  if (!term) return { kind: 'none' };
  const lowered = term.toLowerCase();
  if (isUuid(lowered)) return { kind: 'id', id: lowered };
  return {
    kind: 'text',
    userTerm: term.replace(LEADING_AT, '').trim(),
    fragment: HEX_FRAGMENT.test(lowered) ? lowered : null,
  };
}

export function userMatchClause(term: string): string {
  const pattern = `%${term}%`;
  return `full_name.ilike.${pattern},username.ilike.${pattern},email.ilike.${pattern}`;
}

export function flagSearchClause(plan: FlagSearch, userIds: readonly unknown[]): string | null {
  if (plan.kind === 'none') return null;
  if (plan.kind === 'id') return `id.eq.${plan.id},transaction_id.eq.${plan.id},user_id.eq.${plan.id}`;
  const ids = Array.from(
    new Set(userIds.filter((id): id is string => isUuid(id)).map((id) => id.toLowerCase())),
  ).slice(0, SEARCH_USER_CAP);
  const clauses: string[] = [];
  if (ids.length > 0) clauses.push(`user_id.in.(${ids.join(',')})`);
  if (plan.fragment) clauses.push(`transaction_id.ilike.${plan.fragment}%`);
  return clauses.length > 0 ? clauses.join(',') : null;
}

export function presentWithdrawal(row: Record<string, unknown>): WithdrawalSummary {
  return {
    id: text(row.id) ?? '',
    status: text(row.status) ?? '',
    amount: amountOf(row.amount),
    fee: amountOf(row.fee),
    bank_name: text(row.bank_name),
    account_number: isMaskable(row.account_number) ? maskTail(row.account_number) : null,
    account_name: text(row.account_name),
    gateway: text(row.gateway),
    failure_reason: text(row.failure_reason),
    created_at: text(row.created_at),
  };
}

export function presentTransaction(row: Record<string, unknown>): TransactionSummary {
  return {
    id: text(row.id) ?? '',
    type: text(row.type),
    amount: amountOf(row.amount),
    status: text(row.status),
    reference_id: text(row.reference_id),
    created_at: text(row.created_at),
    metadata: row.metadata === null || row.metadata === undefined ? null : redactAudit(maskMetadata(row.metadata)),
  };
}
