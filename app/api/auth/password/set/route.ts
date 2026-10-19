import type { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../../lib/supabase';
import { writeAudit } from '../../../../lib/audit';
import { fail, ok } from '../../../../lib/api';
import { hashChallengeToken } from '../../../../lib/mfa';
import { DIFFERENT_PASSWORD_MESSAGE, checkOwnPassword } from '../../../../lib/passwordPolicy';
import { LINK_INVALID, checkLink, isLinkToken, type LinkPurpose } from '../../../../lib/passwordLinks';
import { NO_STORE, actorFor, requestMeta } from '../../../../lib/session';

const ENTITY = 'admin_users';
const BCRYPT_ROUNDS = 12;
const SAVE_UNAVAILABLE = 'Your password could not be saved right now. Try again shortly.';
const LINK_INVALID_ERROR = 'link_invalid';
const NO_RESULT = 'The password link returned no result.';

interface SetRequest {
  token: unknown;
  newPassword: unknown;
}

type PasswordReuse = 'same' | 'different' | 'failed';

type Redeem =
  | { kind: 'saved'; adminId: string | null; purpose: LinkPurpose | null; roleTitle: string | null; sessionsRevoked: number }
  | { kind: 'invalid' }
  | { kind: 'failed'; message: string };

function readRequest(body: unknown): SetRequest {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return { token: record.token, newPassword: record.new_password };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function linkInvalid(): Promise<NextResponse> {
  return fail('STATE_CONFLICT', LINK_INVALID, { headers: { ...NO_STORE } });
}

function unavailable(): Promise<NextResponse> {
  return fail('INTERNAL_ERROR', SAVE_UNAVAILABLE, { headers: { ...NO_STORE } });
}

function invalidPassword(message: string, rule: string | null): Promise<NextResponse> {
  return fail('VALIDATION_ERROR', message, {
    details: rule ? { field: 'new_password', rule } : { field: 'new_password' },
    headers: { ...NO_STORE },
  });
}

function acceptedAction(purpose: LinkPurpose): string {
  return purpose === 'invite' ? 'ADMIN_INVITE_ACCEPTED' : 'PASSWORD_RESET_COMPLETED';
}

async function reuseOf(adminId: string, password: string): Promise<PasswordReuse> {
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('password_hash')
    .eq('id', adminId)
    .maybeSingle<{ password_hash: string | null }>();
  if (error) {
    console.error('admin password reset hash read failed:', error.message);
    return 'failed';
  }
  const hash = data?.password_hash;
  if (!hash) return 'different';
  try {
    return (await bcrypt.compare(password, hash)) ? 'same' : 'different';
  } catch (error) {
    console.error('admin password reset compare failed:', errorText(error));
    return 'different';
  }
}

async function redeem(tokenHash: string, passwordHash: string): Promise<Redeem> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_password_link_redeem', {
      p_token_hash: tokenHash,
      p_password_hash: passwordHash,
    });
    if (error) return { kind: 'failed', message: error.message };
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { kind: 'failed', message: NO_RESULT };
    const result = data as Record<string, unknown>;
    if (result.ok !== true) return { kind: 'invalid' };
    return {
      kind: 'saved',
      adminId: typeof result.admin_id === 'string' ? result.admin_id : null,
      purpose: result.purpose === 'invite' ? 'invite' : result.purpose === 'reset' ? 'reset' : null,
      roleTitle: typeof result.role_title === 'string' ? result.role_title : null,
      sessionsRevoked: Number(result.sessions_revoked) || 0,
    };
  } catch (error) {
    return { kind: 'failed', message: errorText(error) };
  }
}

export async function POST(req: NextRequest) {
  const request = readRequest(await req.json().catch(() => null));
  const token = request.token;
  if (!isLinkToken(token)) return linkInvalid();

  const checked = await checkLink(token);
  if (checked.kind === 'failed') return unavailable();
  if (checked.kind === 'invalid') return linkInvalid();
  const { link } = checked;

  const problem = checkOwnPassword(request.newPassword, { current: '', username: link.username, email: link.email });
  if (problem) return invalidPassword(problem.message, problem.rule);
  const password = String(request.newPassword);

  if (link.purpose === 'reset') {
    const reuse = await reuseOf(link.adminId, password);
    if (reuse === 'failed') return unavailable();
    if (reuse === 'same') return invalidPassword(DIFFERENT_PASSWORD_MESSAGE, 'different');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const meta = await requestMeta(req.headers);
  const redeemed = await redeem(hashChallengeToken(token), passwordHash);
  if (redeemed.kind === 'failed') {
    console.error('admin password link redeem failed:', redeemed.message);
    return unavailable();
  }
  if (redeemed.kind === 'invalid') {
    await writeAudit({
      admin: actorFor({ id: link.adminId, role_title: link.roleTitle }, meta),
      action: acceptedAction(link.purpose),
      entity: ENTITY,
      entity_id: link.adminId,
      result: 'failure',
      error: LINK_INVALID_ERROR,
      sensitivity: 'security',
    });
    return linkInvalid();
  }

  const adminId = redeemed.adminId ?? link.adminId;
  const purpose = redeemed.purpose ?? link.purpose;
  await writeAudit({
    admin: actorFor({ id: adminId, role_title: redeemed.roleTitle ?? link.roleTitle }, meta),
    action: acceptedAction(purpose),
    entity: ENTITY,
    entity_id: adminId,
    after: { sessions_revoked: redeemed.sessionsRevoked },
    result: 'success',
    sensitivity: 'security',
  });
  return ok({ purpose }, { headers: { ...NO_STORE } });
}
