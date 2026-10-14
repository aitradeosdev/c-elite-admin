import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireRecentAuth, requireSuperAdmin, requireTwoStep } from '../../../lib/guard';
import { writeAudit } from '../../../lib/audit';
import { fail, isUuid, ok } from '../../../lib/api';
import { isMfaKeyConfigured } from '../../../lib/mfa';
import { NO_STORE } from '../../../lib/session';

const ENTITY = 'admin_security_policy';
const REASON_MIN = 3;
const REASON_MAX = 500;

const LOAD_FAILED = 'The two-step requirement could not be loaded. Try again.';
const MODE_INVALID = 'Choose whether two-step sign-in is required for every admin.';
const REASON_SHORT = `Give a reason of at least ${REASON_MIN} characters.`;
const REASON_LONG = `The reason must be ${REASON_MAX} characters or fewer.`;
const KEY_MISSING = 'Set ADMIN_MFA_ENCRYPTION_KEY before requiring two-step sign-in.';
const SAVE_FAILED = 'The two-step requirement could not be changed. Try again.';
const AUDIT_WARNING = 'The two-step requirement was changed, but the change could not be written to the audit log.';

type Mode = 'off' | 'all';

interface Policy {
  mode: Mode;
  graceEndsAt: string | null;
  requiredNow: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface RosterAdmin {
  id: string;
  username: string;
}

type ReasonRead = { ok: true; reason: string } | { ok: false; message: string };

type Saved =
  | { kind: 'done'; changed: boolean; mode: Mode; graceEndsAt: string | null }
  | { kind: 'failed'; message: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  return record(await req.json().catch(() => null));
}

function readReason(value: unknown): ReasonRead {
  const reason = typeof value === 'string' ? value.trim() : '';
  const length = Array.from(reason).length;
  if (length < REASON_MIN) return { ok: false, message: REASON_SHORT };
  if (length > REASON_MAX) return { ok: false, message: REASON_LONG };
  return { ok: true, reason };
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

async function readPolicy(): Promise<Policy | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_security_policy_get');
    if (error) {
      console.error('admin security policy read failed:', error.message);
      return null;
    }
    const row = record(data);
    if (!row) {
      console.error('admin security policy read failed:', 'no result');
      return null;
    }
    return {
      mode: row.mfa_mode === 'all' ? 'all' : 'off',
      graceEndsAt: text(row.mfa_grace_ends_at),
      requiredNow: row.mfa_required_now === true,
      updatedAt: text(row.updated_at),
      updatedBy: isUuid(row.updated_by) ? row.updated_by.toLowerCase() : null,
    };
  } catch (error) {
    console.error('admin security policy read failed:', errorText(error));
    return null;
  }
}

async function readEnrolled(): Promise<Set<string> | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_security_overview');
    if (error) {
      console.error('admin security overview read failed:', error.message);
      return null;
    }
    if (!Array.isArray(data)) {
      console.error('admin security overview read failed:', 'no rows were returned');
      return null;
    }
    const enrolled = new Set<string>();
    for (const item of data as unknown[]) {
      const row = record(item);
      if (row && row.mfa_status === 'active' && isUuid(row.admin_id)) enrolled.add(row.admin_id.toLowerCase());
    }
    return enrolled;
  } catch (error) {
    console.error('admin security overview read failed:', errorText(error));
    return null;
  }
}

async function readActiveAdmins(): Promise<RosterAdmin[] | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('admin_users')
      .select('id, username')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('admin security roster read failed:', error.message);
      return null;
    }
    const admins: RosterAdmin[] = [];
    for (const item of (Array.isArray(data) ? data : []) as unknown[]) {
      const row = record(item);
      if (!row || !isUuid(row.id)) continue;
      admins.push({ id: row.id.toLowerCase(), username: typeof row.username === 'string' ? row.username : '' });
    }
    return admins;
  } catch (error) {
    console.error('admin security roster read failed:', errorText(error));
    return null;
  }
}

async function savePolicy(actor: string, mode: Mode): Promise<Saved> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_security_policy_set', { p_actor: actor, p_mfa_mode: mode });
    if (error) return { kind: 'failed', message: error.message };
    const row = record(data);
    if (!row) return { kind: 'failed', message: 'The policy change returned no result.' };
    return {
      kind: 'done',
      changed: row.changed === true,
      mode: row.mfa_mode === 'all' ? 'all' : 'off',
      graceEndsAt: text(row.mfa_grace_ends_at),
    };
  } catch (error) {
    return { kind: 'failed', message: errorText(error) };
  }
}

export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const [policy, enrolled, active] = await Promise.all([readPolicy(), readEnrolled(), readActiveAdmins()]);
  if (!policy || !enrolled || !active) return fail('INTERNAL_ERROR', LOAD_FAILED);

  const missing = active.filter((entry) => !enrolled.has(entry.id));
  return ok({
    mfa_mode: policy.mode,
    mfa_grace_ends_at: policy.graceEndsAt,
    mfa_required_now: policy.requiredNow,
    updated_at: policy.updatedAt,
    updated_by: policy.updatedBy,
    key_configured: isMfaKeyConfigured(),
    actor_mfa_status: admin.mfa.status,
    roster: {
      active: active.length,
      enrolled: active.length - missing.length,
      missing,
    },
  }, { headers: { ...NO_STORE } });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const withoutTwoStep = await requireTwoStep(admin);
  if (withoutTwoStep) return withoutTwoStep;
  const stale = await requireRecentAuth(admin);
  if (stale) return stale;

  const body = await readBody(req);
  const mode = body?.mfa_mode;
  if (mode !== 'all' && mode !== 'off') return fail('VALIDATION_ERROR', MODE_INVALID, { details: { field: 'mfa_mode' } });
  const reason = readReason(body?.reason);
  if (!reason.ok) return fail('VALIDATION_ERROR', reason.message, { details: { field: 'reason' } });
  if (mode === 'all' && !isMfaKeyConfigured()) {
    return fail('STATE_CONFLICT', KEY_MISSING, { details: { reason: 'key_not_configured' } });
  }

  const before = { mfa_mode: admin.policy.mode, mfa_grace_ends_at: admin.policy.graceEndsAt };
  const saved = await savePolicy(admin.admin_id.toLowerCase(), mode);
  if (saved.kind === 'failed') {
    console.error('admin security policy change failed:', saved.message);
    await writeAudit({
      admin,
      action: 'SECURITY_POLICY_CHANGED',
      entity: ENTITY,
      entity_id: null,
      before,
      after: { mfa_mode: mode },
      reason: reason.reason,
      result: 'failure',
      error: saved.message,
      sensitivity: 'security',
    });
    return fail('INTERNAL_ERROR', SAVE_FAILED);
  }
  if (!saved.changed) return ok({ changed: false, mfa_mode: saved.mode, mfa_grace_ends_at: saved.graceEndsAt });

  const recorded = await writeAudit({
    admin,
    action: 'SECURITY_POLICY_CHANGED',
    entity: ENTITY,
    entity_id: null,
    before,
    after: { mfa_mode: saved.mode, mfa_grace_ends_at: saved.graceEndsAt },
    reason: reason.reason,
    result: 'success',
    sensitivity: 'security',
  });
  return ok({
    changed: true,
    mfa_mode: saved.mode,
    mfa_grace_ends_at: saved.graceEndsAt,
    ...auditFields(recorded.ok),
  });
}
