import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/guard';
import { signSessionToken } from '../../../lib/jwt';
import { writeAudit } from '../../../lib/audit';
import { fail, ok } from '../../../lib/api';
import { checkOwnPassword } from '../../../lib/passwordPolicy';
import { NO_STORE, epochSeconds, setSessionCookie, type SessionTokenAdmin } from '../../../lib/session';

const ENTITY = 'admin_users';
const ACCOUNT_COLUMNS =
  'id, username, email, password_hash, role_title, is_super_admin, is_active, page_permissions, token_version';
const BCRYPT_ROUNDS = 12;
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_SECS = 15 * 60;
const SAVE_ATTEMPTS = 2;

const MISSING_BODY = 'Send your current password and a new password.';
const CURRENT_REQUIRED = 'Enter your current password.';
const NEW_REQUIRED = 'Enter a new password.';
const TOO_MANY_ATTEMPTS = 'Too many password change attempts. Wait 15 minutes, then try again.';
const LIMIT_UNAVAILABLE = 'Your password cannot be changed right now. Try again in a few minutes.';
const CURRENT_INCORRECT = 'Your current password is incorrect.';
const CURRENT_MISMATCH = 'Current password did not match.';
const READ_FAILED = 'Your account could not be read, so your password was not changed. Try again.';
const SAVE_FAILED = 'Your password could not be changed. Try again.';
const KEPT_CHANGING = 'Your account changed while the new password was being saved, so it was not changed. Try again.';
const AUDIT_WARNING = 'Your password was changed, but the change could not be written to the audit log.';
const NO_RESULT = 'The password change returned no result.';

type PasswordField = 'current_password' | 'new_password';

interface AccountRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string | null;
  role_title: string;
  is_super_admin: boolean;
  is_active: boolean;
  page_permissions: string[] | null;
  token_version: number | null;
}

interface PasswordChange {
  current: string;
  next: string;
}

type ChangeCheck = { ok: true; change: PasswordChange } | { ok: false; message: string; field?: PasswordField };

type AttemptLimit = 'allowed' | 'limited' | 'unavailable';

type AccountRead = { ok: true; row: AccountRow | null } | { ok: false };

type SaveResult =
  | { kind: 'saved'; tokenVersion: number; sessionKept: boolean; sessionsRevoked: number }
  | { kind: 'lost' }
  | { kind: 'failed'; message: string };

function readChange(body: unknown): ChangeCheck {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: MISSING_BODY };
  const record = body as Record<string, unknown>;
  const current = record.current_password;
  const next = record.new_password;
  if (typeof current !== 'string' || current === '') {
    return { ok: false, message: CURRENT_REQUIRED, field: 'current_password' };
  }
  if (typeof next !== 'string' || next === '') return { ok: false, message: NEW_REQUIRED, field: 'new_password' };
  return { ok: true, change: { current, next } };
}

function invalid(message: string, field?: PasswordField, rule?: string | null) {
  if (!field) return fail('VALIDATION_ERROR', message);
  return fail('VALIDATION_ERROR', message, { details: rule ? { field, rule } : { field } });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkAttemptLimit(adminId: string): Promise<AttemptLimit> {
  try {
    const { data, error } = await supabaseAdmin.rpc('check_rate_limit_by_key', {
      p_key: `admin:${adminId}`,
      p_action: 'admin_password_change',
      p_limit: ATTEMPT_LIMIT,
      p_window_secs: ATTEMPT_WINDOW_SECS,
    });
    if (error) {
      console.error('admin password change rate limit check failed:', error.message);
      return 'unavailable';
    }
    return data === true ? 'allowed' : 'limited';
  } catch (error) {
    console.error('admin password change rate limit check failed:', errorText(error));
    return 'unavailable';
  }
}

async function readAccount(adminId: string): Promise<AccountRead> {
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select(ACCOUNT_COLUMNS)
    .eq('id', adminId)
    .maybeSingle<AccountRow>();
  if (error) {
    console.error('admin password change account read failed:', error.message);
    return { ok: false };
  }
  return { ok: true, row: data ?? null };
}

async function matchesCurrent(password: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    console.error('admin password change compare failed:', errorText(error));
    return false;
  }
}

function tokenAdmin(row: AccountRow, tokenVersion: number): SessionTokenAdmin {
  return {
    id: row.id,
    username: row.username,
    role_title: row.role_title,
    is_super_admin: row.is_super_admin,
    page_permissions: row.page_permissions || [],
    token_version: tokenVersion,
  };
}

async function saveHash(adminId: string, expected: number, hash: string, keepSid: string | null): Promise<SaveResult> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_password_change', {
      p_admin_id: adminId,
      p_expected_token_version: expected,
      p_password_hash: hash,
      p_keep_sid: keepSid,
    });
    if (error) return { kind: 'failed', message: error.message };
    if (!data || typeof data !== 'object') return { kind: 'failed', message: NO_RESULT };
    const result = data as Record<string, unknown>;
    if (result.ok !== true) {
      return result.reason === 'state_changed' ? { kind: 'lost' } : { kind: 'failed', message: NO_RESULT };
    }
    return {
      kind: 'saved',
      tokenVersion: Number(result.token_version),
      sessionKept: result.session_kept === true,
      sessionsRevoked: Number(result.sessions_revoked) || 0,
    };
  } catch (error) {
    return { kind: 'failed', message: errorText(error) };
  }
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const checked = readChange(await req.json().catch(() => null));
  if (!checked.ok) return invalid(checked.message, checked.field);
  const { current, next } = checked.change;

  const limit = await checkAttemptLimit(admin.admin_id);
  if (limit === 'limited') return fail('RATE_LIMITED', TOO_MANY_ATTEMPTS);
  if (limit === 'unavailable') return fail('RATE_LIMITED', LIMIT_UNAVAILABLE);

  const session = admin.session && admin.session.transport === 'cookie' ? admin.session : null;
  let hash: string | null = null;

  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt += 1) {
    const read = await readAccount(admin.admin_id);
    if (!read.ok) return fail('INTERNAL_ERROR', READ_FAILED);
    const row = read.row;
    if (!row || !row.is_active) return fail('AUTH_REQUIRED');

    if (!(await matchesCurrent(current, row.password_hash))) {
      await writeAudit({
        admin,
        action: 'PASSWORD_CHANGE_FAILED',
        entity: ENTITY,
        entity_id: admin.admin_id,
        result: 'failure',
        error: CURRENT_MISMATCH,
        sensitivity: 'security',
      });
      return invalid(CURRENT_INCORRECT, 'current_password');
    }

    const problem = checkOwnPassword(next, { current, username: row.username, email: row.email });
    if (problem) return invalid(problem.message, 'new_password', problem.rule);

    if (hash === null) hash = await bcrypt.hash(next, BCRYPT_ROUNDS);
    const expected = row.token_version ?? 0;

    let token: string | null = null;
    if (session) {
      try {
        token = await signSessionToken(tokenAdmin(row, expected + 1), session.id, session.amr, epochSeconds(session.expiresAt));
      } catch (error) {
        console.error('admin password change session signing failed:', errorText(error));
        return fail('INTERNAL_ERROR', SAVE_FAILED);
      }
    }

    const saved = await saveHash(admin.admin_id, expected, hash, session ? session.id : null);
    if (saved.kind === 'lost') continue;
    if (saved.kind === 'failed') {
      console.error('admin password change save failed:', saved.message);
      await writeAudit({
        admin,
        action: 'PASSWORD_CHANGE_FAILED',
        entity: ENTITY,
        entity_id: admin.admin_id,
        result: 'failure',
        error: saved.message,
        sensitivity: 'security',
      });
      return fail('INTERNAL_ERROR', SAVE_FAILED);
    }

    const renewed = session !== null && token !== null && saved.sessionKept && saved.tokenVersion === expected + 1;
    const recorded = await writeAudit({
      admin,
      action: 'PASSWORD_CHANGED',
      entity: ENTITY,
      entity_id: admin.admin_id,
      after: { password_changed: true, token_version_bumped: true, sessions_revoked: saved.sessionsRevoked },
      result: 'success',
      sensitivity: 'security',
    });

    const response = await ok({
      changed: true,
      sessions_revoked: true,
      session_renewed: renewed,
      ...auditFields(recorded.ok),
    }, { headers: { ...NO_STORE } });
    if (renewed && session && token !== null) setSessionCookie(response, token, session.expiresAt);
    return response;
  }

  return fail('STATE_CONFLICT', KEPT_CHANGING);
}
