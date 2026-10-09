import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../lib/supabase';
import { requireSuperAdmin } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, isUuid, ok } from '../../lib/api';
import {
  checkCreate,
  checkReason,
  diffGrants,
  grantChangeRecord,
  planDelete,
  planEdit,
  type AdminState,
  type CreateInput,
  type EditInput,
} from '../../(dashboard)/admin-accounts/rules';

const ADMIN_COLUMNS =
  'id, username, email, role_title, page_permissions, last_login_at, is_active, is_super_admin, deleted_at, created_at';
const STATE_COLUMNS = `${ADMIN_COLUMNS}, token_version`;
const ENTITY = 'admin_users';
const BCRYPT_ROUNDS = 12;
const EDIT_ATTEMPTS = 3;
const UNIQUE_VIOLATION = '23505';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';

type Body = Record<string, unknown>;

interface AdminRecord extends AdminState {
  last_login_at: string | null;
  created_at: string | null;
}

type StateRead = { ok: true; state: AdminRecord | null } | { ok: false };

function publicAdmin(row: AdminRecord) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role_title: row.role_title,
    page_permissions: row.page_permissions,
    last_login_at: row.last_login_at,
    is_active: row.is_active,
    is_super_admin: row.is_super_admin,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
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

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select(ADMIN_COLUMNS)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('admin accounts list:', error.message);
    return fail('INTERNAL_ERROR', 'Admin accounts could not be loaded.');
  }
  return ok({ admins: data ?? [], current_admin_id: guard.admin.admin_id });
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body = await readBody(req);
  if (!body) return fail('VALIDATION_ERROR', 'Send the new admin account as a JSON object.');
  const reason = checkReason(body.reason);
  if (!reason.ok) return fail('VALIDATION_ERROR', reason.message);
  const checked = checkCreate(body as CreateInput);
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const account = checked.value;

  const audit: AuditInput = {
    admin,
    action: 'CREATE_ADMIN',
    entity: ENTITY,
    reason: reason.reason,
    sensitivity: 'security',
    after: {
      username: account.username,
      email: account.email,
      role_title: account.role_title,
      page_permissions: account.page_permissions,
      grant_changes: grantChangeRecord(diffGrants([], account.page_permissions)),
    },
  };

  const passwordHash = await bcrypt.hash(account.password, BCRYPT_ROUNDS);
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
      return fail('VALIDATION_ERROR', 'That username is already taken.');
    }
    console.error('admin account create:', message);
    await writeAudit({ ...audit, result: 'failure', error: message });
    return fail('INTERNAL_ERROR', 'The admin account could not be created.');
  }

  const recorded = await writeAudit({ ...audit, entity_id: data.id, result: 'success' });
  return ok({ id: data.id, admin: publicAdmin(data), ...auditFields(recorded.ok) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body = await readBody(req);
  if (!body) return fail('VALIDATION_ERROR', 'Send the changes as a JSON object.');
  const id = readId(body.id);
  if (!id) return fail('VALIDATION_ERROR', 'A valid admin account id is required.');
  const reason = checkReason(body.reason);
  if (!reason.ok) return fail('VALIDATION_ERROR', reason.message);

  let passwordHash: string | null = null;

  for (let attempt = 0; attempt < EDIT_ATTEMPTS; attempt++) {
    const read = await readState(id);
    if (!read.ok) return fail('INTERNAL_ERROR', 'The admin account could not be read.');
    const state = read.state;
    if (!state) return fail('RESOURCE_NOT_FOUND', 'Admin account not found.');

    const planned = planEdit(state, body as EditInput, admin.admin_id);
    if (!planned.ok) return fail(planned.code, planned.message);
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
      if ((count ?? 0) <= 1) return fail('STATE_CONFLICT', 'Cannot deactivate the last active super admin.');
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
    ).select(ADMIN_COLUMNS);

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
      console.error('admin account update:', error.message);
      await writeAudit({ ...audit, result: 'failure', error: error.message });
      return fail('INTERNAL_ERROR', 'The admin account could not be updated.');
    }

    const rows = (data ?? []) as unknown as AdminRecord[];
    if (rows.length === 0) continue;

    const recorded = await writeAudit({ ...audit, result: 'success' });
    return ok({
      changed: true,
      sessions_revoked: plan.revokesSessions,
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
    console.error('admin account delete:', error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', 'The admin account could not be deleted.');
  }

  const rows = (data ?? []) as unknown as AdminRecord[];
  if (rows.length === 0) {
    return fail('STATE_CONFLICT', 'This admin account changed while you were working on it. Reload and try again.');
  }

  const recorded = await writeAudit({ ...audit, result: 'success' });
  return ok({ admin: publicAdmin(rows[0]), ...auditFields(recorded.ok) });
}
