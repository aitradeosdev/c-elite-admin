import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import {
  planTierWrite, publicTierValues, readLevelPatch, tierValues, tierVerdict, toAmount,
  type LevelChange, type StoredTier, type TierKey, type TierResult, type TierValues,
} from '../../(dashboard)/bonuses-rewards/rewardRules';

const TABLE = 'level_tiers';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';

interface Applied {
  result: TierResult;
  fields: TierKey[];
  audit: AuditInput | null;
}

async function readBody(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => null);
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

function publicTier(row: StoredTier, claims: number | null) {
  return { ...row, claims: claims ?? 0, claims_counted: claims !== null };
}

async function countClaims(order: number | null): Promise<number | null> {
  if (order === null) return null;
  const { count, error } = await supabaseAdmin
    .from('user_level_claims')
    .select('id', { count: 'exact', head: true })
    .eq('tier_order', order);
  if (error) {
    console.error('level claim count:', order, error.message);
    return null;
  }
  return count ?? 0;
}

async function readTiers(ids: readonly string[]): Promise<Map<string, StoredTier> | null> {
  const { data, error } = await supabaseAdmin.from(TABLE).select('*').in('id', [...ids]);
  if (error) {
    console.error('level tiers read:', error.message);
    return null;
  }
  return new Map(((data ?? []) as StoredTier[]).map((row) => [row.id, row]));
}

async function readTier(id: string): Promise<StoredTier | null | undefined> {
  const { data, error } = await supabaseAdmin.from(TABLE).select('*').eq('id', id).maybeSingle<StoredTier>();
  if (error) {
    console.error('level tier re-read:', id, error.message);
    return undefined;
  }
  return data ?? null;
}

function guardedUpdate(id: string, update: Partial<TierValues>, current: StoredTier) {
  let query = supabaseAdmin
    .from(TABLE)
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', id);
  for (const key of Object.keys(update) as TierKey[]) {
    const value = current[key];
    query = value === null || value === undefined ? query.is(key, null) : query.eq(key, value);
  }
  return query.select('*');
}

function result(id: string, status: TierResult['status'], row: StoredTier | null): TierResult {
  return { id, status, tier: row ? publicTierValues(row) : null };
}

async function applyChange(
  admin: AdminContext,
  change: LevelChange,
  initial: StoredTier | null,
  reason: string | null,
): Promise<Applied> {
  let current = initial;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!current) return { result: result(change.id, 'missing', null), fields: [], audit: null };
    const plan = planTierWrite(change, current);
    if (plan.kind === 'unchanged') return { result: result(change.id, 'unchanged', current), fields: [], audit: null };
    if (plan.kind === 'invalid') return { result: result(change.id, 'error', current), fields: [], audit: null };
    if (plan.kind === 'conflict') return { result: result(change.id, 'conflict', current), fields: plan.fields, audit: null };

    const values = tierValues(current);
    const audit: AuditInput = {
      admin,
      action: 'UPDATE_LEVEL_TIER',
      entity: TABLE,
      entity_id: change.id,
      before: { tier_order: toAmount(current.tier_order), name: values.name, ...plan.before },
      after: plan.update,
      reason,
      sensitivity: plan.financial ? 'financial' : 'normal',
    };
    const { data, error } = await guardedUpdate(change.id, plan.update, current);
    if (error) {
      console.error('level tier update:', change.id, error.message);
      return {
        result: result(change.id, 'error', current),
        fields: Object.keys(plan.update) as TierKey[],
        audit: { ...audit, result: 'failure', error: error.message },
      };
    }
    const saved = ((data ?? []) as StoredTier[])[0];
    if (saved) {
      return {
        result: result(change.id, 'saved', saved),
        fields: Object.keys(plan.update) as TierKey[],
        audit: { ...audit, result: 'success' },
      };
    }

    const live = await readTier(change.id);
    if (live === undefined) return { result: result(change.id, 'error', current), fields: [], audit: null };
    if (change.expected) {
      return { result: result(change.id, live ? 'conflict' : 'missing', live), fields: Object.keys(plan.update) as TierKey[], audit: null };
    }
    current = live;
  }
  return { result: result(change.id, 'conflict', current), fields: [], audit: null };
}

export async function GET() {
  const guard = await requireAdmin('rewards.read');
  if (!guard.ok) return guard.response;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*')
    .order('tier_order', { ascending: true });
  if (error) {
    console.error('level tiers list:', error.message);
    return fail('INTERNAL_ERROR', 'The level tiers could not be loaded. Try again.');
  }

  const rows = (data ?? []) as StoredTier[];
  const counts = await Promise.all(rows.map((row) => countClaims(toAmount(row.tier_order))));
  return ok({ tiers: rows.map((row, index) => publicTier(row, counts[index])) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('rewards.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const checked = readLevelPatch(await readBody(req));
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const { changes, batch, reason } = checked.value;

  const current = await readTiers(changes.map((change) => change.id));
  if (!current) return fail('INTERNAL_ERROR', 'The level tiers could not be read, so nothing was saved. Try again.');

  for (let index = 0; index < changes.length; index += 1) {
    const row = current.get(changes[index].id);
    if (!row) continue;
    const plan = planTierWrite(changes[index], row);
    if (plan.kind === 'invalid') {
      return fail('VALIDATION_ERROR', batch ? `Change ${index + 1}: ${plan.message} Nothing was saved.` : plan.message);
    }
  }

  const applied: Applied[] = [];
  for (const change of changes) {
    applied.push(await applyChange(admin, change, current.get(change.id) ?? null, reason));
  }
  const outcomes = await Promise.all(
    applied.flatMap((item) => (item.audit ? [writeAudit(item.audit)] : [])),
  );
  const recorded = outcomes.every((outcome) => outcome.ok);
  const results = applied.map((item) => item.result);

  if (!batch) {
    const only = applied[0];
    switch (only.result.status) {
      case 'saved':
        return ok({ changed: true, tier: only.result.tier, ...auditFields(recorded) });
      case 'unchanged':
        return ok({ changed: false, tier: only.result.tier });
      case 'missing':
        return fail('RESOURCE_NOT_FOUND', 'That level tier no longer exists.');
      case 'conflict':
        return fail(
          'STATE_CONFLICT',
          'Another admin changed this tier after you opened it, so nothing was saved. Review the latest values and try again.',
          { details: { tier: only.result.tier, fields: only.fields } },
        );
      default:
        return fail('INTERNAL_ERROR', 'The level tier could not be saved. Try again.');
    }
  }

  const saved = results.filter((item) => item.status === 'saved').length;
  const unchanged = results.filter((item) => item.status === 'unchanged').length;
  const verdict = tierVerdict(results);
  if (!verdict.ok) {
    return fail(verdict.code, verdict.message, {
      details: {
        saved,
        unchanged,
        failed: results.length - saved - unchanged,
        results,
        audit_recorded: recorded,
        ...(recorded ? {} : { warning: 'Some of the saved changes could not be written to the audit log.' }),
      },
    });
  }
  return ok({ saved, unchanged, results, ...auditFields(recorded) });
}
