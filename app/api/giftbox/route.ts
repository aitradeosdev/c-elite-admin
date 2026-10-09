import { after, type NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import { bustPromoCache } from '../../lib/promoCacheBust';
import {
  giftboxConflicts, giftboxValues, planGiftboxUpdate, readGiftboxCreate, readGiftboxPatch, readReason, readRules,
  sameRules, type Rule, type StoredGiftbox,
} from '../../(dashboard)/bonuses-rewards/rewardRules';

const TABLE = 'giftbox_items';
const COUNT_BATCH = 10;
const GUARDED_TEXT_FIELDS = ['title', 'description', 'expiry_date', 'eligibility_condition'] as const;
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const CHANGED_ELSEWHERE =
  'Another admin changed this gift box after you opened it, so nothing was saved. Review the latest values and try again.';

type ItemRead = { ok: true; row: StoredGiftbox | null } | { ok: false };

async function readBody(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => null);
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

function publicGiftbox(row: StoredGiftbox, claims: number | null) {
  return { ...row, claims: claims ?? 0, claims_counted: claims !== null };
}

async function countClaims(id: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('giftbox_claims')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', id);
  if (error) {
    console.error('giftbox claim count:', id, error.message);
    return null;
  }
  return count ?? 0;
}

async function countAll(ids: readonly string[]): Promise<Map<string, number | null>> {
  const counts = new Map<string, number | null>();
  for (let start = 0; start < ids.length; start += COUNT_BATCH) {
    const batch = ids.slice(start, start + COUNT_BATCH);
    const results = await Promise.all(batch.map((id) => countClaims(id)));
    batch.forEach((id, index) => counts.set(id, results[index]));
  }
  return counts;
}

async function readItem(id: string): Promise<ItemRead> {
  const { data, error } = await supabaseAdmin.from(TABLE).select('*').eq('id', id).maybeSingle<StoredGiftbox>();
  if (error) {
    console.error('giftbox read:', id, error.message);
    return { ok: false };
  }
  return { ok: true, row: data ?? null };
}

export async function GET() {
  const guard = await requireAdmin('rewards.read');
  if (!guard.ok) return guard.response;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('giftbox list:', error.message);
    return fail('INTERNAL_ERROR', 'The gift boxes could not be loaded. Try again.');
  }

  const rows = (data ?? []) as StoredGiftbox[];
  const counts = await countAll(rows.map((row) => row.id));
  return ok({ items: rows.map((row) => publicGiftbox(row, counts.get(row.id) ?? null)) });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin('rewards.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body = await readBody(req);
  const checked = readGiftboxCreate(body);
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const reason = readReason(body && typeof body === 'object' ? (body as Record<string, unknown>).reason : undefined);
  if (!reason.ok) return fail('VALIDATION_ERROR', reason.message);
  const input = checked.value;

  const audit: AuditInput = {
    admin,
    action: 'CREATE_GIFTBOX_ITEM',
    entity: TABLE,
    after: input,
    reason: reason.value,
    sensitivity: 'financial',
  };

  const { data, error } = await supabaseAdmin.from(TABLE).insert(input).select('*').single<StoredGiftbox>();
  if (error || !data) {
    const message = error?.message ?? 'No row was returned.';
    console.error('giftbox create:', message);
    await writeAudit({ ...audit, result: 'failure', error: message });
    return fail('INTERNAL_ERROR', 'The gift box could not be created. Try again.');
  }

  const recorded = await writeAudit({ ...audit, entity_id: data.id, after: giftboxValues(data), result: 'success' });
  after(() => bustPromoCache());
  return ok({ id: data.id, item: publicGiftbox(data, 0), ...auditFields(recorded.ok) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('rewards.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const checked = readGiftboxPatch(await readBody(req));
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const patch = checked.value;

  const read = await readItem(patch.id);
  if (!read.ok) return fail('INTERNAL_ERROR', 'The gift box could not be read, so nothing was saved. Try again.');
  if (!read.row) return fail('RESOURCE_NOT_FOUND', 'That gift box no longer exists.');
  const live = read.row;

  if (patch.expected) {
    const conflicts = giftboxConflicts(patch.expected, live);
    if (conflicts.length > 0) {
      return fail('STATE_CONFLICT', CHANGED_ELSEWHERE, { details: { item: publicGiftbox(live, null), fields: conflicts } });
    }
  }

  let rules: Rule[] | undefined;
  if (patch.rules !== undefined && !sameRules(patch.rules, live.eligibility_rules)) {
    const checkedRules = readRules(patch.rules);
    if (!checkedRules.ok) return fail('VALIDATION_ERROR', checkedRules.message);
    rules = checkedRules.value;
  }

  const plan = planGiftboxUpdate(patch.fields, rules, live);
  if (plan.problem) return fail('VALIDATION_ERROR', plan.problem);
  if (plan.changed.length === 0) return ok({ changed: false, item: publicGiftbox(live, null) });

  const audit: AuditInput = {
    admin,
    action: 'UPDATE_GIFTBOX_ITEM',
    entity: TABLE,
    entity_id: patch.id,
    before: { title: live.title, ...plan.before },
    after: plan.update,
    reason: patch.reason,
    sensitivity: plan.financial ? 'financial' : 'normal',
  };

  let query = supabaseAdmin.from(TABLE).update(plan.update).eq('id', patch.id);
  query = live.reward_naira === null ? query.is('reward_naira', null) : query.eq('reward_naira', live.reward_naira);
  query = live.is_active === null ? query.is('is_active', null) : query.eq('is_active', live.is_active);
  for (const field of GUARDED_TEXT_FIELDS) {
    if (!plan.changed.includes(field)) continue;
    const value = live[field];
    query = value === null || value === undefined ? query.is(field, null) : query.eq(field, value);
  }
  const { data, error } = await query.select('*');

  if (error) {
    console.error('giftbox update:', patch.id, error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', 'The gift box could not be saved. Try again.');
  }

  const saved = ((data ?? []) as StoredGiftbox[])[0];
  if (!saved) {
    const again = await readItem(patch.id);
    if (again.ok && !again.row) return fail('RESOURCE_NOT_FOUND', 'That gift box no longer exists.');
    const latest = again.ok && again.row ? again.row : null;
    return fail('STATE_CONFLICT', CHANGED_ELSEWHERE, {
      details: {
        item: latest ? publicGiftbox(latest, null) : null,
        fields: latest && patch.expected ? giftboxConflicts(patch.expected, latest) : [],
      },
    });
  }

  const recorded = await writeAudit({ ...audit, result: 'success' });
  after(() => bustPromoCache());
  return ok({ changed: true, item: publicGiftbox(saved, null), ...auditFields(recorded.ok) });
}
