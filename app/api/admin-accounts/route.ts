import type { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../lib/supabase';
import { requireRecentAuth, requireSuperAdmin, requireTwoStep, type AdminContext } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { ERROR_STATUS, fail, isUuid, ok } from '../../lib/api';
import { REASON_MAX, REASON_MESSAGE, REASON_MIN, rpcFailure, type RpcFailure } from '../../lib/roles';
import { linksConfigured, mintLinkToken, sendLinkEmail } from '../../lib/passwordLinks';
import {
  INVITE_PASSWORD_MESSAGE,
  checkCreate,
  checkReason,
  diffGrants,
  grantChangeRecord,
  normalizeGrants,
  planDelete,
  planEdit,
  savedChange,
  type AdminState,
  type CreateInput,
  type EditInput,
  type NewAdmin,
  type RuleFailure,
} from '../../(dashboard)/admin-accounts/rules';

export const maxDuration = 30;

const ADMIN_FIELDS =
  'id, username, email, role_title, page_permissions, role_id, direct_permissions, last_login_at, is_active, is_super_admin, deleted_at, created_at';
const ROLE_EMBED = 'role:admin_roles!admin_users_role_id_fkey(id, name, archived_at)';
const STATE_ROLE_EMBED = 'role:admin_roles!admin_users_role_id_fkey(id, name, archived_at, permissions)';
const ADMIN_COLUMNS = `${ADMIN_FIELDS}, ${ROLE_EMBED}`;
const STATE_COLUMNS = `${ADMIN_FIELDS}, token_version, ${STATE_ROLE_EMBED}`;
const ENTITY = 'admin_users';
const BCRYPT_ROUNDS = 12;
const EDIT_ATTEMPTS = 3;
const UNIQUE_VIOLATION = '23505';
const LAST_SUPER_ADMIN = 'At least one active super admin is required';
const LAST_SUPER_ADMIN_DEACTIVATE = 'Cannot deactivate the last active super admin.';
const LAST_SUPER_ADMIN_DELETE = 'Cannot delete the last active super admin.';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const ACCESS_ELSEWHERE = 'Change access in the web console’s Access section.';
const USERNAME_TAKEN = 'That username is already taken.';
const CREATE_FAILED = 'The admin account could not be created.';
const INVITES_NOT_SET_UP = 'Invitations are not set up on the server, so no account was created.';
const INVALID_ROLE = 'role_id must be a role id or null.';
const RESET_EMAIL_ONLY = 'Passwords are chosen by the admin from a reset email.';
const UNREADABLE_INVITE = 'The invitation returned a result that could not be read.';

type Body = Record<string, unknown>;

interface AdminRecord extends AdminState {
  last_login_at: string | null;
  created_at: string | null;
}

type StateRead = { ok: true; state: AdminRecord | null } | { ok: false };

interface SecurityStatus {
  mfa_status: 'none' | 'pending' | 'active' | null;
  mfa_confirmed_at: string | null;
  mfa_locked_until: string | null;
  mfa_last_used_at: string | null;
  recovery_codes_left: number | null;
  live_sessions: number | null;
  last_seen_at: string | null;
}

const NO_SECURITY_STATUS: Readonly<SecurityStatus> = Object.freeze({
  mfa_status: null,
  mfa_confirmed_at: null,
  mfa_locked_until: null,
  mfa_last_used_at: null,
  recovery_codes_left: null,
  live_sessions: null,
  last_seen_at: null,
});

function timeOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function countOf(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function securityStatus(raw: Record<string, unknown>): SecurityStatus {
  return {
    mfa_status: raw.mfa_status === 'active' || raw.mfa_status === 'pending' ? raw.mfa_status : 'none',
    mfa_confirmed_at: timeOrNull(raw.mfa_confirmed_at),
    mfa_locked_until: timeOrNull(raw.mfa_locked_until),
    mfa_last_used_at: timeOrNull(raw.mfa_last_used_at),
    recovery_codes_left: countOf(raw.recovery_codes_left),
    live_sessions: countOf(raw.live_sessions),
    last_seen_at: timeOrNull(raw.last_seen_at),
  };
}

async function readSecurityOverview(): Promise<Map<string, SecurityStatus> | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_security_overview');
    if (error) {
      console.error('admin security overview read:', error.message);
      return null;
    }
    if (!Array.isArray(data)) {
      console.error('admin security overview read:', 'no rows were returned');
      return null;
    }
    const overview = new Map<string, SecurityStatus>();
    for (const row of data as unknown[]) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      if (isUuid(record.admin_id)) overview.set(record.admin_id.toLowerCase(), securityStatus(record));
    }
    return overview;
  } catch (error) {
    console.error('admin security overview read:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

function withSecurityStatus(row: Record<string, unknown>, overview: Map<string, SecurityStatus> | null) {
  const id = typeof row.id === 'string' ? row.id.toLowerCase() : '';
  return { ...row, ...(overview?.get(id) ?? NO_SECURITY_STATUS) };
}

function publicRole(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const role = value as Record<string, unknown>;
  if (!isUuid(role.id)) return null;
  return {
    id: role.id,
    name: typeof role.name === 'string' ? role.name : null,
    archived: typeof role.archived_at === 'string' && role.archived_at !== '',
  };
}

function publicAdmin(row: AdminRecord) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role_title: row.role_title,
    page_permissions: row.page_permissions,
    role_id: row.role_id ?? null,
    role: publicRole(row.role),
    direct_permissions: row.direct_permissions ?? [],
    last_login_at: row.last_login_at,
    is_active: row.is_active,
    is_super_admin: row.is_super_admin,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
  };
}

function createRecord(account: NewAdmin, grants: readonly string[]) {
  return {
    username: account.username,
    email: account.email,
    role_title: account.role_title,
    page_permissions: [...grants],
    grant_changes: grantChangeRecord(diffGrants([], grants)),
  };
}

async function readBody(req: NextRequest): Promise<Body | null> {
  const raw: unknown = await req.json().catch(() => null);
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Body) : null;
}

function readId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isUuid(id) ? id : null;
}

async function readState(id: string): Promise<StateRead> {
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select(STATE_COLUMNS)
    .eq('id', id)
    .maybeSingle<AdminRecord>();
  if (error) {
    console.error('admin account read:', error.message);
    return { ok: false };
  }
  return { ok: true, state: data ?? null };
}

function accessRefusal(body: Body, admin: AdminContext): Promise<NextResponse> | null {
  if (body.role_id !== undefined || body.direct_permissions !== undefined) return fail('VALIDATION_ERROR', ACCESS_ELSEWHERE);
  if (body.page_permissions !== undefined && admin.session.client !== 'mobile') return fail('VALIDATION_ERROR', ACCESS_ELSEWHERE);
  return null;
}

function ruleRefusal(failure: RuleFailure | RpcFailure): Promise<NextResponse> {
  return fail(failure.code, failure.message, failure.details ? { details: failure.details } : undefined);
}

function storedRefusal(error: unknown): RpcFailure | null {
  const failure = rpcFailure(error);
  return failure.status === 400 || failure.status === 409 ? failure : null;
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readInvitePending(): Promise<Set<string> | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .is('password_hash', null)
      .is('deleted_at', null);
    if (error) {
      console.error('admin invite status read:', error.message);
      return null;
    }
    if (!Array.isArray(data)) {
      console.error('admin invite status read:', 'no rows were returned');
      return null;
    }
    const pending = new Set<string>();
    for (const row of data as unknown[]) {
      if (isRecord(row) && isUuid(row.id)) pending.add(row.id.toLowerCase());
    }
    return pending;
  } catch (error) {
    console.error('admin invite status read:', errorText(error));
    return null;
  }
}

function withInviteState(row: Record<string, unknown>, pending: Set<string> | null) {
  const id = typeof row.id === 'string' ? row.id.toLowerCase() : '';
  return { ...row, invite_pending: pending === null ? null : pending.has(id) };
}

type RoleRead = { ok: true; id: string | null } | { ok: false };

type InviteOutcome =
  | { kind: 'created'; adminId: string; username: string; email: string; expiresAt: string }
  | { kind: 'refused'; failure: RpcFailure; error: string }
  | { kind: 'failed'; error: string };

const TAKEN_FAILURE: RpcFailure = {
  code: 'VALIDATION_ERROR',
  status: ERROR_STATUS.VALIDATION_ERROR,
  message: USERNAME_TAKEN,
};

function readRole(value: unknown): RoleRead {
  if (value === undefined || value === null) return { ok: true, id: null };
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isUuid(id) ? { ok: true, id } : { ok: false };
}

function readReason(value: unknown): string | null {
  const reason = typeof value === 'string' ? value.trim() : '';
  const length = Array.from(reason).length;
  return length >= REASON_MIN && length <= REASON_MAX ? reason : null;
}

function readInvite(data: unknown): InviteOutcome {
  if (!isRecord(data)) return { kind: 'failed', error: UNREADABLE_INVITE };
  if (data.ok !== true) {
    const failure = rpcFailure(data);
    const reason = typeof data.reason === 'string' ? data.reason : 'unknown';
    return failure.code === 'INTERNAL_ERROR'
      ? { kind: 'failed', error: `Unexpected refusal: ${reason}` }
      : { kind: 'refused', failure, error: failure.message };
  }
  const adminId = readId(data.admin_id);
  const { username, email, expires_at: expiresAt } = data;
  if (!adminId || typeof username !== 'string' || typeof email !== 'string' || typeof expiresAt !== 'string' || !expiresAt) {
    return { kind: 'failed', error: UNREADABLE_INVITE };
  }
  return { kind: 'created', adminId, username, email, expiresAt };
}

async function createInvite(
  admin: AdminContext,
  account: NewAdmin,
  roleId: string | null,
  reason: string,
  tokenHash: string,
): Promise<InviteOutcome> {
  let data: unknown;
  try {
    const result = await supabaseAdmin.rpc('admin_invite_create', {
      p_actor: admin.admin_id,
      p_username: account.username,
      p_email: account.email,
      p_role_title: account.role_title,
      p_role_id: roleId,
      p_token_hash: tokenHash,
      p_reason: reason,
      p_ip: admin.ip,
      p_user_agent: admin.user_agent || null,
      p_request_id: admin.request_id,
    });
    if (result.error) {
      if (result.error.code === UNIQUE_VIOLATION) return { kind: 'refused', failure: TAKEN_FAILURE, error: result.error.message };
      const failure = rpcFailure(result.error);
      return failure.code === 'INTERNAL_ERROR'
        ? { kind: 'failed', error: result.error.message }
        : { kind: 'refused', failure, error: result.error.message };
    }
    data = result.data;
  } catch (error) {
    return { kind: 'failed', error: errorText(error) };
  }
  return readInvite(data);
}

async function readCreated(id: string): Promise<AdminRecord | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('admin_users')
      .select(ADMIN_COLUMNS)
      .eq('id', id)
      .maybeSingle<AdminRecord>();
    if (error) {
      console.error('admin invite read back:', error.message);
      return null;
    }
    return data ?? null;
  } catch (error) {
    console.error('admin invite read back:', errorText(error));
    return null;
  }
}

export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const [listed, overview, pending] = await Promise.all([
    supabaseAdmin.from('admin_users').select(ADMIN_COLUMNS).order('created_at', { ascending: true }),
    readSecurityOverview(),
    readInvitePending(),
  ]);
  const { data, error } = listed;

  if (error) {
    console.error('admin accounts list:', error.message);
    return fail('INTERNAL_ERROR', 'Admin accounts could not be loaded.');
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  return ok({
    admins: rows.map((row) => withInviteState(withSecurityStatus({ ...row, role: publicRole(row.role) }, overview), pending)),
    current_admin_id: admin.admin_id,
    security: {
      mfa_mode: admin.policy.mode,
      mfa_grace_ends_at: admin.policy.graceEndsAt,
      mfa_required_now: admin.policy.requiredNow,
      actor_mfa_status: admin.mfa.status,
      status_loaded: overview !== null,
    },
  });
}

async function createForPhone(req: NextRequest, admin: AdminContext): Promise<NextResponse> {
  const body = await readBody(req);
  if (!body) return fail('VALIDATION_ERROR', 'Send the new admin account as a JSON object.');
  const refused = accessRefusal(body, admin);
  if (refused) return refused;
  const reason = checkReason(body.reason);
  if (!reason.ok) return fail('VALIDATION_ERROR', reason.message);
  const checked = checkCreate(body as CreateInput, 'mobile');
  if (!checked.ok) return ruleRefusal(checked);
  const account = checked.value;

  const audit: AuditInput = {
    admin,
    action: 'CREATE_ADMIN',
    entity: ENTITY,
    reason: reason.reason,
    sensitivity: 'security',
    after: createRecord(account, account.page_permissions),
  };

  const passwordHash = await bcrypt.hash(account.password as string, BCRYPT_ROUNDS);
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .insert({
      username: account.username,
      email: account.email,
      password_hash: passwordHash,
      role_title: account.role_title,
      page_permissions: account.page_permissions,
      is_super_admin: false,
      is_active: true,
    })
    .select(ADMIN_COLUMNS)
    .single<AdminRecord>();

  if (error || !data) {
    const message = error?.message ?? 'No row was returned.';
    if (error?.code === UNIQUE_VIOLATION || /unique|duplicate/i.test(message)) {
      return fail('VALIDATION_ERROR', USERNAME_TAKEN);
    }
    const refusal = error ? storedRefusal(error) : null;
    if (!refusal) console.error('admin account create:', message);
    await writeAudit({ ...audit, result: 'failure', error: message });
    return refusal ? ruleRefusal(refusal) : fail('INTERNAL_ERROR', CREATE_FAILED);
  }

  const recorded = await writeAudit({
    ...audit,
    entity_id: data.id,
    after: createRecord(account, normalizeGrants(data.page_permissions)),
    result: 'success',
  });
  return ok({ id: data.id, admin: publicAdmin(data), ...auditFields(recorded.ok) });
}

async function inviteFromWeb(req: NextRequest, admin: AdminContext): Promise<NextResponse> {
  const body = await readBody(req);
  if (!body) return fail('VALIDATION_ERROR', 'Send the new admin account as a JSON object.');
  if (body.password !== undefined) return fail('VALIDATION_ERROR', INVITE_PASSWORD_MESSAGE);
  if (body.direct_permissions !== undefined || body.page_permissions !== undefined) {
    return fail('VALIDATION_ERROR', ACCESS_ELSEWHERE);
  }
  const reason = readReason(body.reason);
  if (reason === null) {
    return fail('VALIDATION_ERROR', REASON_MESSAGE, { details: { field: 'reason', reason: 'reason_required' } });
  }
  const role = readRole(body.role_id);
  if (!role.ok) return fail('VALIDATION_ERROR', INVALID_ROLE, { details: { field: 'role_id', reason: 'invalid' } });
  const checked = checkCreate(body as CreateInput, 'web');
  if (!checked.ok) return ruleRefusal(checked);
  const account = checked.value;
  if (!linksConfigured()) return fail('INTERNAL_ERROR', INVITES_NOT_SET_UP);

  const audit: AuditInput = {
    admin,
    action: 'CREATE_ADMIN',
    entity: ENTITY,
    reason,
    sensitivity: 'security',
    after: { username: account.username, email: account.email, role_title: account.role_title, role_id: role.id },
  };

  const { token, tokenHash } = mintLinkToken();
  const outcome = await createInvite(admin, account, role.id, reason, tokenHash);
  if (outcome.kind === 'failed') {
    console.error('admin invite failed:', outcome.error);
    await writeAudit({ ...audit, result: 'failure', error: outcome.error });
    return fail('INTERNAL_ERROR', CREATE_FAILED);
  }
  if (outcome.kind === 'refused') {
    await writeAudit({ ...audit, result: 'failure', error: outcome.error });
    return ruleRefusal(outcome.failure);
  }

  const created = await readCreated(outcome.adminId);
  const delivery = await sendLinkEmail({
    purpose: 'invite',
    token,
    email: outcome.email,
    username: outcome.username,
    expiresAt: outcome.expiresAt,
    inviter: admin.username,
  });
  const recorded = await writeAudit({
    admin,
    action: 'ADMIN_INVITE_SENT',
    entity: ENTITY,
    entity_id: outcome.adminId,
    after: { outcome: delivery.outcome, expires_at: outcome.expiresAt, resend: false },
    result: delivery.outcome === 'sent' ? 'success' : 'failure',
    error: delivery.outcome === 'sent' ? null : delivery.reason,
    sensitivity: 'security',
  });
  return ok({
    id: outcome.adminId,
    admin: created ? publicAdmin(created) : null,
    invite: { outcome: delivery.outcome, expires_at: outcome.expiresAt },
    ...auditFields(recorded.ok),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  if (admin.session.client === 'mobile') return createForPhone(req, admin);
  const withoutTwoStep = await requireTwoStep(admin);
  if (withoutTwoStep) return withoutTwoStep;
  const stale = await requireRecentAuth(admin);
  if (stale) return stale;
  return inviteFromWeb(req, admin);
}

export async function PATCH(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body = await readBody(req);
  if (!body) return fail('VALIDATION_ERROR', 'Send the changes as a JSON object.');
  const id = readId(body.id);
  if (!id) return fail('VALIDATION_ERROR', 'A valid admin account id is required.');
  if (body.password !== undefined && admin.session.client !== 'mobile') return fail('VALIDATION_ERROR', RESET_EMAIL_ONLY);
  const refused = accessRefusal(body, admin);
  if (refused) return refused;
  const reason = checkReason(body.reason);
  if (!reason.ok) return fail('VALIDATION_ERROR', reason.message);

  let passwordHash: string | null = null;

  for (let attempt = 0; attempt < EDIT_ATTEMPTS; attempt++) {
    const read = await readState(id);
    if (!read.ok) return fail('INTERNAL_ERROR', 'The admin account could not be read.');
    const state = read.state;
    if (!state) return fail('RESOURCE_NOT_FOUND', 'Admin account not found.');

    const planned = planEdit(state, body as EditInput, admin.admin_id);
    if (!planned.ok) return ruleRefusal(planned);
    const plan = planned.plan;

    if (plan.changed.length === 0 && !plan.revokesSessions) {
      return ok({ changed: false, sessions_revoked: false, admin: publicAdmin(state) });
    }

    if (plan.deactivatesSuperAdmin) {
      const { count, error: countError } = await supabaseAdmin
        .from('admin_users')
        .select('id', { count: 'exact', head: true })
        .eq('is_super_admin', true)
        .eq('is_active', true)
        .is('deleted_at', null);
      if (countError) {
        console.error('admin account super admin count:', countError.message);
        return fail('INTERNAL_ERROR', 'The remaining super admins could not be counted, so nothing was changed.');
      }
      if ((count ?? 0) <= 1) return fail('STATE_CONFLICT', LAST_SUPER_ADMIN_DEACTIVATE);
    }

    if (plan.password !== null && passwordHash === null) {
      passwordHash = await bcrypt.hash(plan.password, BCRYPT_ROUNDS);
    }

    const changes = {
      ...plan.updates,
      ...(plan.password !== null && passwordHash !== null ? { password_hash: passwordHash } : {}),
    };
    const guarded = supabaseAdmin.from('admin_users').update(changes).eq('id', id).is('deleted_at', null);
    const { data, error } = await (state.token_version === null
      ? guarded.is('token_version', null)
      : guarded.eq('token_version', state.token_version)
    ).select(STATE_COLUMNS);

    const audit: AuditInput = {
      admin,
      action: plan.action,
      entity: ENTITY,
      entity_id: id,
      before: plan.before,
      after: plan.after,
      reason: reason.reason,
      sensitivity: 'security',
    };

    if (error) {
      const lastSuperAdmin = error.message === LAST_SUPER_ADMIN;
      const refusal = lastSuperAdmin ? null : storedRefusal(error);
      if (!lastSuperAdmin && !refusal) console.error('admin account update:', error.message);
      await writeAudit({ ...audit, result: 'failure', error: error.message });
      if (lastSuperAdmin) return fail('STATE_CONFLICT', LAST_SUPER_ADMIN_DEACTIVATE);
      return refusal ? ruleRefusal(refusal) : fail('INTERNAL_ERROR', 'The admin account could not be updated.');
    }

    const rows = (data ?? []) as unknown as AdminRecord[];
    if (rows.length === 0) continue;

    const saved = savedChange(plan, state, rows[0]);
    const recorded = await writeAudit({ ...audit, after: saved.after, result: 'success' });
    return ok({
      changed: true,
      sessions_revoked: saved.sessionsRevoked,
      admin: publicAdmin(rows[0]),
      ...auditFields(recorded.ok),
    });
  }

  return fail('STATE_CONFLICT', 'This admin account kept changing while it was being saved. Reload it and try again.');
}

export async function DELETE(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body = (await readBody(req)) ?? {};
  const id = readId(body.id ?? new URL(req.url).searchParams.get('id'));
  if (!id) return fail('VALIDATION_ERROR', 'A valid admin account id is required.');
  const reason = checkReason(body.reason);
  if (!reason.ok) return fail('VALIDATION_ERROR', reason.message);

  const read = await readState(id);
  if (!read.ok) return fail('INTERNAL_ERROR', 'The admin account could not be read.');
  if (!read.state) return fail('RESOURCE_NOT_FOUND', 'Admin account not found.');

  const planned = planDelete(read.state);
  if (!planned.ok) return fail(planned.code, planned.message);

  const next = { deleted_at: new Date().toISOString(), is_active: false };
  const audit: AuditInput = {
    admin,
    action: 'DELETE_ADMIN',
    entity: ENTITY,
    entity_id: id,
    before: planned.before,
    after: next,
    reason: reason.reason,
    sensitivity: 'security',
  };

  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .update(next)
    .eq('id', id)
    .is('deleted_at', null)
    .not('is_super_admin', 'is', true)
    .not('is_active', 'is', true)
    .select(ADMIN_COLUMNS);

  if (error) {
    const lastSuperAdmin = error.message === LAST_SUPER_ADMIN;
    if (!lastSuperAdmin) console.error('admin account delete:', error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return lastSuperAdmin
      ? fail('STATE_CONFLICT', LAST_SUPER_ADMIN_DELETE)
      : fail('INTERNAL_ERROR', 'The admin account could not be deleted.');
  }

  const rows = (data ?? []) as unknown as AdminRecord[];
  if (rows.length === 0) {
    return fail('STATE_CONFLICT', 'This admin account changed while you were working on it. Reload and try again.');
  }

  const recorded = await writeAudit({ ...audit, result: 'success' });
  return ok({ admin: publicAdmin(rows[0]), ...auditFields(recorded.ok) });
}
