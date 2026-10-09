import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin } from '../../lib/guard';
import { ok, isUuid } from '../../lib/api';
import {
  SEARCH_CARD_CAP, SEARCH_USER_CAP, SearchQueryError, cardNamePattern, couponsFilter, exactUserMatch, executeSearch,
  flagsFilter, mergeHits, searchesCardNames, submissionsFilter, toCouponItem, toFlagItem, toSubmissionItem,
  toTransactionItem, toUserItem, toWithdrawalItem, transactionsFilter, userMatchFilter, usersFilter, withdrawalsFilter,
  type FlagHit, type GroupFailure, type PersonRef, type SearchContext, type SearchItem, type SearchRunners,
  type SubmissionHit, type TransactionHit, type UserHit, type WithdrawalHit,
} from '../../lib/search';
import { typeLabel } from '../../(dashboard)/transactions-overview/model';
import { couponStatus, toCouponRow, type Brand, type CouponRow } from '../../(dashboard)/coupons/model';
import { todayKey } from '../../(dashboard)/coupons/couponRules';

const USER_COLUMNS = 'id, full_name, username, email, is_active, is_frozen, deleted_at, created_at';
const PERSON_COLUMNS = 'id, username, full_name, email';
const WITHDRAWAL_COLUMNS = 'id, user_id, amount, bank_name, account_number, account_name, status, created_at';
const TRANSACTION_COLUMNS = 'id, type, amount, status, created_at, users(username, full_name, email)';
const SUBMISSION_COLUMNS =
  'id, payout_naira, status, created_at, cards(name), card_types(name, country_code), users(username, full_name, email)';
const COUPON_COLUMNS = 'id, code, type, bonus_rate_naira, expiry_date, max_redemptions, use_count, is_active, created_at';
const FLAG_COLUMNS = 'id, transaction_type, amount, flag_reason, status, created_at, users(username, full_name, email)';

const NEWEST = { ascending: false, nullsFirst: false } as const;
const BRAND_CAP = 500;
const NO_STORE = { 'Cache-Control': 'no-store' };

type QueryResult = { data: unknown; error: { code?: string } | null };

type IdRow = { id?: unknown };

type PersonRow = PersonRef & { id: string };

type BrandRow = { id?: unknown; name?: unknown };

async function rowsOf<T>(request: PromiseLike<QueryResult>): Promise<T[]> {
  const { data, error } = await request;
  if (error) throw new SearchQueryError(error.code);
  return Array.isArray(data) ? (data as T[]) : [];
}

function idsOf(rows: readonly IdRow[]): string[] {
  return rows.map((row) => row.id).filter(isUuid);
}

async function resolveUserIds({ intent, signal }: SearchContext): Promise<string[]> {
  const filter = userMatchFilter(intent);
  if (!filter) return [];
  const rows = await rowsOf<IdRow>(
    supabaseAdmin.from('users').select('id').or(filter).limit(SEARCH_USER_CAP).abortSignal(signal),
  );
  return idsOf(rows);
}

async function resolveCardIds({ intent, signal }: SearchContext): Promise<string[]> {
  if (!searchesCardNames(intent)) return [];
  const rows = await rowsOf<IdRow>(
    supabaseAdmin
      .from('cards')
      .select('id')
      .ilike('name', cardNamePattern(intent))
      .limit(SEARCH_CARD_CAP)
      .abortSignal(signal),
  );
  return idsOf(rows);
}

async function peopleById(ids: ReadonlyArray<string | null>, signal: AbortSignal): Promise<Map<string, PersonRef>> {
  const unique = Array.from(new Set(ids.filter(isUuid)));
  if (unique.length === 0) return new Map();
  const rows = await rowsOf<PersonRow>(
    supabaseAdmin.from('users').select(PERSON_COLUMNS).in('id', unique).limit(unique.length).abortSignal(signal),
  );
  return new Map(rows.map((row) => [row.id, row]));
}

async function activeBrands(signal: AbortSignal): Promise<Brand[] | null> {
  const { data, error } = await supabaseAdmin
    .from('cards')
    .select('id, name')
    .eq('is_active', true)
    .limit(BRAND_CAP)
    .abortSignal(signal);
  if (error || !Array.isArray(data) || data.length >= BRAND_CAP) return null;
  return (data as BrandRow[]).flatMap((row) => (
    typeof row.id === 'string' && typeof row.name === 'string' && row.name.trim() !== ''
      ? [{ id: row.id, name: row.name.trim() }]
      : []
  ));
}

async function searchUsers({ intent, limit, signal }: SearchContext): Promise<SearchItem[]> {
  const exact = exactUserMatch(intent);
  const [first, rest] = await Promise.all([
    exact
      ? rowsOf<UserHit>(
        supabaseAdmin.from('users').select(USER_COLUMNS).eq(exact.column, exact.value).limit(1).abortSignal(signal),
      )
      : Promise.resolve<UserHit[]>([]),
    rowsOf<UserHit>(
      supabaseAdmin
        .from('users')
        .select(USER_COLUMNS)
        .or(usersFilter(intent))
        .order('created_at', NEWEST)
        .order('id', NEWEST)
        .limit(limit)
        .abortSignal(signal),
    ),
  ]);
  return mergeHits(first, rest, limit).map((row) => toUserItem(row));
}

async function searchWithdrawals(context: SearchContext, userIds: readonly string[]): Promise<SearchItem[]> {
  const filter = withdrawalsFilter(context.intent, userIds);
  if (!filter) return [];
  const rows = await rowsOf<WithdrawalHit>(
    supabaseAdmin
      .from('withdrawals')
      .select(WITHDRAWAL_COLUMNS)
      .or(filter)
      .order('created_at', NEWEST)
      .order('id', NEWEST)
      .limit(context.limit)
      .abortSignal(context.signal),
  );
  const people = await peopleById(rows.map((row) => row.user_id), context.signal);
  return rows.map((row) => toWithdrawalItem(row, (row.user_id && people.get(row.user_id)) || null));
}

async function searchTransactions(context: SearchContext, userIds: readonly string[]): Promise<SearchItem[]> {
  const filter = transactionsFilter(context.intent, userIds);
  if (!filter) return [];
  const rows = await rowsOf<TransactionHit>(
    supabaseAdmin
      .from('transactions')
      .select(TRANSACTION_COLUMNS)
      .or(filter)
      .order('created_at', NEWEST)
      .order('id', NEWEST)
      .limit(context.limit)
      .abortSignal(context.signal),
  );
  return rows.map((row) => toTransactionItem(row, typeLabel(row.type)));
}

async function searchSubmissions(context: SearchContext, userIds: Promise<string[]>): Promise<SearchItem[]> {
  const [users, cards] = await Promise.all([userIds, resolveCardIds(context)]);
  const filter = submissionsFilter(context.intent, users, cards);
  if (!filter) return [];
  const rows = await rowsOf<SubmissionHit>(
    supabaseAdmin
      .from('card_submissions')
      .select(SUBMISSION_COLUMNS)
      .or(filter)
      .order('created_at', NEWEST)
      .order('id', NEWEST)
      .limit(context.limit)
      .abortSignal(context.signal),
  );
  return rows.map((row) => toSubmissionItem(row));
}

async function searchCoupons({ intent, limit, signal }: SearchContext): Promise<SearchItem[]> {
  const filter = couponsFilter(intent);
  if (!filter) return [];
  const raw = await rowsOf<unknown>(
    supabaseAdmin
      .from('coupons')
      .select(COUPON_COLUMNS)
      .or(filter)
      .order('created_at', NEWEST)
      .order('id', NEWEST)
      .limit(limit)
      .abortSignal(signal),
  );
  const rows = raw.map((row) => toCouponRow(row)).filter((row): row is CouponRow => row !== null);
  if (rows.length === 0) return [];
  const brands = await activeBrands(signal);
  const today = todayKey();
  return rows.map((row) => toCouponItem({
    id: row.id,
    code: row.code,
    brand: row.type,
    bonus: row.bonus,
    expiry: row.expiry,
    state: couponStatus(row, today, brands).state,
  }, today));
}

async function searchFlags(context: SearchContext, userIds: readonly string[]): Promise<SearchItem[]> {
  const filter = flagsFilter(context.intent, userIds);
  if (!filter) return [];
  const rows = await rowsOf<FlagHit>(
    supabaseAdmin
      .from('flagged_transactions')
      .select(FLAG_COLUMNS)
      .or(filter)
      .order('created_at', NEWEST)
      .order('id', NEWEST)
      .limit(context.limit)
      .abortSignal(context.signal),
  );
  return rows.map((row) => toFlagItem(row, row.transaction_type ? typeLabel(row.transaction_type) : null));
}

function createRunners(): SearchRunners {
  let matched: Promise<string[]> | null = null;
  const matchingUserIds = (context: SearchContext): Promise<string[]> => {
    matched ??= resolveUserIds(context);
    return matched;
  };
  return {
    users: searchUsers,
    withdrawals: async (context) => searchWithdrawals(context, await matchingUserIds(context)),
    transactions: async (context) => searchTransactions(context, await matchingUserIds(context)),
    card_submissions: (context) => searchSubmissions(context, matchingUserIds(context)),
    coupons: searchCoupons,
    flags: async (context) => searchFlags(context, await matchingUserIds(context)),
  };
}

function reportFailure({ key, status, code }: GroupFailure): void {
  console.error(`search: ${key} ${status === 'timeout' ? 'timed out' : 'failed'} (${code})`);
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const params = new URL(req.url).searchParams;
  const result = await executeSearch({
    rawQuery: params.get('q'),
    rawLimit: params.get('limit'),
    can: guard.admin.can,
    runners: createRunners(),
    signal: req.signal,
    onFailure: reportFailure,
  });
  return ok(result, { headers: NO_STORE });
}
