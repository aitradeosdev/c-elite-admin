import { after, type NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import { bustPromoCache } from '../../lib/promoCacheBust';
import {
  AWAITING_STATUSES, GUARD_COLUMNS, TERMS_CONFIG_KEY, awaitingByCode, awaitingFor, awaitingKey, couponConflicts,
  couponValues, deleteBlocker, escapeLike, isRecord, parseTermsList, planCouponUpdate, readCouponCreate,
  readCouponDelete, readCouponPatch, readReason, sameCode, toWhole, todayKey,
  type AwaitingTotals, type StoredCoupon,
} from '../../(dashboard)/coupons/couponRules';

const TABLE = 'coupons';
const PAGE_ROWS = 1000;
const MAX_PAGES = 10;
const UNIQUE_VIOLATION = '23505';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const CHANGED_ELSEWHERE =
  'Another admin changed this coupon after you opened it, so nothing was saved. Review the latest values and try again.';
const CHANGED_BEFORE_DELETE =
  'Another admin changed this coupon after you opened it, so nothing was deleted. Review it and try again.';
const CODES_UNCHECKED = 'Existing coupon codes could not be checked, so nothing was saved. Try again.';

type CouponRead = { ok: true; row: StoredCoupon | null } | { ok: false };
type AwaitingRead = { ok: true; totals: Map<string, AwaitingTotals> } | { ok: false };

interface BrandRow {
  id: string;
  name: string | null;
}

interface AwaitingRow {
  coupon_code: unknown;
  coupon_bonus: unknown;
}

async function readBody(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => null);
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error) && (error?.code === UNIQUE_VIOLATION || /duplicate key|unique/i.test(error?.message ?? ''));
}

function codeTakenText(code: string): string {
  return `Another coupon already uses the code ${code}. Choose a different code.`;
}

function publicCoupon(row: StoredCoupon, awaiting: AwaitingTotals | null) {
  return {
    ...row,
    pending_trades: awaiting ? awaiting.trades : null,
    pending_bonus_naira: awaiting ? awaiting.bonus : null,
  };
}

async function readCoupon(id: string): Promise<CouponRead> {
  const { data, error } = await supabaseAdmin.from(TABLE).select('*').eq('id', id).maybeSingle<StoredCoupon>();
  if (error) {
    console.error('coupon read:', id, error.message);
    return { ok: false };
  }
  return { ok: true, row: data ?? null };
}

async function readActiveBrands(): Promise<{ id: string; name: string }[] | null> {
  const { data, error } = await supabaseAdmin
    .from('cards')
    .select('id, name')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    console.error('coupon brands read:', error.message);
    return null;
  }
  return ((data ?? []) as BrandRow[]).flatMap((row) => {
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    return name ? [{ id: row.id, name }] : [];
  });
}

async function readBrandNames(): Promise<string[] | null> {
  const { data, error } = await supabaseAdmin.from('cards').select('name');
  if (error) {
    console.error('coupon brand names read:', error.message);
    return null;
  }
  return ((data ?? []) as { name: string | null }[]).flatMap((row) => (
    typeof row.name === 'string' && row.name.trim() !== '' ? [row.name] : []
  ));
}

async function readTermsOptions(): Promise<string[] | null> {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', TERMS_CONFIG_KEY)
    .maybeSingle<{ value: unknown }>();
  if (error) {
    console.error('coupon terms read:', error.message);
    return null;
  }
  return parseTermsList(data?.value ?? null);
}

async function readAwaiting(): Promise<AwaitingRead> {
  const rows: AwaitingRow[] = [];
  let total: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_ROWS;
    const { data, error, count } = await supabaseAdmin
      .from('card_submissions')
      .select('coupon_code, coupon_bonus', page === 0 ? { count: 'exact' } : undefined)
      .in('status', AWAITING_STATUSES)
      .not('coupon_code', 'is', null)
      .gt('coupon_bonus', 0)
      .order('id', { ascending: true })
      .range(from, from + PAGE_ROWS - 1);
    if (error) {
      console.error('coupon awaiting trades read:', error.message);
      return { ok: false };
    }
    const batch = (data ?? []) as AwaitingRow[];
    if (total === null && typeof count === 'number') total = count;
    rows.push(...batch);
    const finished = total !== null ? rows.length >= total : batch.length < PAGE_ROWS;
    if (batch.length === 0 || finished) return { ok: true, totals: awaitingByCode(rows) };
  }
  console.error(`coupon awaiting trades read: more than ${MAX_PAGES * PAGE_ROWS} rows`);
  return { ok: false };
}

async function readAwaitingForCode(code: string): Promise<AwaitingTotals | null> {
  if (!code) return { trades: 0, bonus: 0 };
  const { data, error } = await supabaseAdmin
    .from('card_submissions')
    .select('coupon_code, coupon_bonus')
    .in('status', AWAITING_STATUSES)
    .ilike('coupon_code', escapeLike(code))
    .gt('coupon_bonus', 0)
    .limit(PAGE_ROWS);
  if (error) {
    console.error('coupon awaiting trades check:', error.message);
    return null;
  }
  const rows = ((data ?? []) as AwaitingRow[]).filter((row) => awaitingKey(row.coupon_code) === awaitingKey(code));
  return awaitingFor(code, awaitingByCode(rows));
}

async function countRedemptions(id: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('coupon_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('coupon_id', id);
  if (error) {
    console.error('coupon redemptions count:', id, error.message);
    return null;
  }
  return count ?? 0;
}

async function codeTaken(code: string, exceptId: string | null): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin.from(TABLE).select('id, code').ilike('code', escapeLike(code)).limit(50);
  if (error) {
    console.error('coupon code check:', error.message);
    return null;
  }
  return ((data ?? []) as { id: string; code: string | null }[]).some((row) => row.id !== exceptId && sameCode(row.code, code));
}

export async function GET() {
  const guard = await requireAdmin('coupons.read');
  if (!guard.ok) return guard.response;

  const [coupons, brands, terms, awaiting] = await Promise.all([
    supabaseAdmin.from(TABLE).select('*').order('created_at', { ascending: false }),
    readActiveBrands(),
    readTermsOptions(),
    readAwaiting(),
  ]);
  if (coupons.error) {
    console.error('coupons list:', coupons.error.message);
    return fail('INTERNAL_ERROR', 'The coupons could not be loaded. Try again.');
  }

  const rows = (coupons.data ?? []) as StoredCoupon[];
  return ok({
    coupons: rows.map((row) => publicCoupon(row, awaiting.ok ? awaitingFor(row.code, awaiting.totals) : null)),
    brands,
    terms_options: terms,
    pending_counted: awaiting.ok,
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin('coupons.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body = await readBody(req);
  const brands = isRecord(body) ? await readBrandNames() : null;
  const checked = readCouponCreate(body, { today: todayKey(), brands });
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const reason = readReason(isRecord(body) ? body.reason : undefined);
  if (!reason.ok) return fail('VALIDATION_ERROR', reason.message);
  const input = checked.value;

  const taken = await codeTaken(input.code, null);
  if (taken === null) return fail('INTERNAL_ERROR', 'Existing coupon codes could not be checked, so the coupon was not created. Try again.');
  if (taken) return fail('VALIDATION_ERROR', codeTakenText(input.code));

  const audit: AuditInput = {
    admin,
    action: 'CREATE_COUPON',
    entity: TABLE,
    after: input,
    reason: reason.value,
    sensitivity: 'financial',
  };

  const { data, error } = await supabaseAdmin.from(TABLE).insert(input).select('*').single<StoredCoupon>();
  if (error || !data) {
    if (isUniqueViolation(error)) return fail('VALIDATION_ERROR', codeTakenText(input.code));
    const message = error?.message ?? 'No row was returned.';
    console.error('coupon create:', message);
    await writeAudit({ ...audit, result: 'failure', error: message });
    return fail('INTERNAL_ERROR', 'The coupon could not be created. Try again.');
  }

  const recorded = await writeAudit({ ...audit, entity_id: data.id, after: couponValues(data), result: 'success' });
  after(() => bustPromoCache());
  return ok({ id: data.id, coupon: publicCoupon(data, { trades: 0, bonus: 0 }), ...auditFields(recorded.ok) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('coupons.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body = await readBody(req);
  const brands = isRecord(body) && body.type !== undefined ? await readBrandNames() : null;
  const checked = readCouponPatch(body, { brands });
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const patch = checked.value;

  const read = await readCoupon(patch.id);
  if (!read.ok) return fail('INTERNAL_ERROR', 'The coupon could not be read, so nothing was saved. Try again.');
  if (!read.row) return fail('RESOURCE_NOT_FOUND', 'That coupon no longer exists.');
  const live = read.row;

  if (patch.expected) {
    const conflicts = couponConflicts(patch.expected, live);
    if (conflicts.length > 0) {
      return fail('STATE_CONFLICT', CHANGED_ELSEWHERE, { details: { coupon: publicCoupon(live, null), fields: conflicts } });
    }
  }

  const plan = planCouponUpdate(patch.fields, live, todayKey());
  if (plan.problem) return fail('VALIDATION_ERROR', plan.problem);
  if (plan.changed.length === 0) return ok({ changed: false, coupon: publicCoupon(live, null) });

  if (plan.update.code !== undefined) {
    const taken = await codeTaken(plan.update.code, live.id);
    if (taken === null) return fail('INTERNAL_ERROR', CODES_UNCHECKED);
    if (taken) return fail('VALIDATION_ERROR', codeTakenText(plan.update.code));
  }

  const audit: AuditInput = {
    admin,
    action: 'UPDATE_COUPON',
    entity: TABLE,
    entity_id: live.id,
    before: { code: live.code, ...plan.before },
    after: plan.update,
    reason: patch.reason,
    sensitivity: plan.financial ? 'financial' : 'normal',
  };

  let query = supabaseAdmin.from(TABLE).update(plan.update).eq('id', live.id);
  for (const column of GUARD_COLUMNS) {
    const value = live[column];
    query = value === null || value === undefined ? query.is(column, null) : query.eq(column, value);
  }
  const { data, error } = await query.select('*');

  if (error) {
    if (isUniqueViolation(error) && plan.update.code !== undefined) {
      return fail('VALIDATION_ERROR', codeTakenText(plan.update.code));
    }
    console.error('coupon update:', live.id, error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', 'The coupon could not be saved. Try again.');
  }

  const saved = ((data ?? []) as StoredCoupon[])[0];
  if (!saved) {
    const again = await readCoupon(live.id);
    if (again.ok && !again.row) return fail('RESOURCE_NOT_FOUND', 'That coupon no longer exists.');
    const latest = again.ok && again.row ? again.row : null;
    return fail('STATE_CONFLICT', CHANGED_ELSEWHERE, {
      details: {
        coupon: latest ? publicCoupon(latest, null) : null,
        fields: latest && patch.expected ? couponConflicts(patch.expected, latest) : [],
      },
    });
  }

  const recorded = await writeAudit({ ...audit, result: 'success' });
  after(() => bustPromoCache());
  return ok({ changed: true, coupon: publicCoupon(saved, null), ...auditFields(recorded.ok) });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin('coupons.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const checked = readCouponDelete(await readBody(req), new URL(req.url).searchParams.get('id'));
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const request = checked.value;

  const read = await readCoupon(request.id);
  if (!read.ok) return fail('INTERNAL_ERROR', 'The coupon could not be read, so nothing was deleted. Try again.');
  if (!read.row) return fail('RESOURCE_NOT_FOUND', 'That coupon no longer exists.');
  const live = read.row;

  if (request.expected) {
    const conflicts = couponConflicts(request.expected, live);
    if (conflicts.length > 0) {
      return fail('STATE_CONFLICT', CHANGED_BEFORE_DELETE, { details: { coupon: publicCoupon(live, null), fields: conflicts } });
    }
  }

  const values = couponValues(live);
  const [awaiting, redemptions] = await Promise.all([
    readAwaitingForCode(typeof live.code === 'string' ? live.code : ''),
    countRedemptions(live.id),
  ]);
  if (!awaiting || redemptions === null) {
    return fail('INTERNAL_ERROR', 'The coupon’s redemptions could not be checked, so nothing was deleted. Try again.');
  }

  const uses = Math.max(0, toWhole(live.use_count) ?? 0);
  const blocker = deleteBlocker({ active: values.is_active, uses, redemptions, awaiting: awaiting.trades });
  if (blocker) return fail('STATE_CONFLICT', blocker, { details: { coupon: publicCoupon(live, awaiting) } });

  const audit: AuditInput = {
    admin,
    action: 'DELETE_COUPON',
    entity: TABLE,
    entity_id: live.id,
    before: { ...values, use_count: uses, created_at: live.created_at },
    after: { deleted: true },
    reason: request.reason,
    sensitivity: 'financial',
  };

  let query = supabaseAdmin.from(TABLE).delete().eq('id', live.id).eq('is_active', false);
  query = live.use_count === null ? query.is('use_count', null) : query.eq('use_count', 0);
  const { data, error } = await query.select('id');

  if (error) {
    console.error('coupon delete:', live.id, error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', 'The coupon could not be deleted. Try again.');
  }

  if ((data ?? []).length === 0) {
    const again = await readCoupon(live.id);
    if (again.ok && !again.row) return fail('RESOURCE_NOT_FOUND', 'That coupon no longer exists.');
    return fail('STATE_CONFLICT', 'This coupon changed while it was being deleted, so nothing was deleted. Reload and try again.');
  }

  const recorded = await writeAudit({ ...audit, result: 'success' });
  after(() => bustPromoCache());
  return ok({ deleted: true, id: live.id, ...auditFields(recorded.ok) });
}
