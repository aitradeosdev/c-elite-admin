import { after, type NextRequest, type NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { writeAudit } from '../../../../lib/audit';
import { fail, ok } from '../../../../lib/api';
import { issueAndSend, linksConfigured } from '../../../../lib/passwordLinks';
import { NO_STORE, checkLimit, requestMeta, type LimitVerdict, type RequestMeta } from '../../../../lib/session';

export const maxDuration = 30;

const EMAIL_MAX = 320;
const USERNAME_MAX = 32;
const FORGOT_SENT =
  'If those details match an admin account, we have emailed a link to choose a new password. It works for 30 minutes.';
const MISSING_FIELDS = 'Enter the email and username you sign in with.';
const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again later.';
const RESET_UNAVAILABLE = 'Password reset is not available right now.';

interface ForgotRequest {
  email: string;
  username: string;
}

type AccountLookup = { ok: true; id: string | null } | { ok: false };

function readRequest(body: unknown): ForgotRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { email, username } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof username !== 'string') return null;
  const normalisedEmail = email.trim().toLowerCase();
  const trimmedUsername = username.trim();
  if (!normalisedEmail || normalisedEmail.length > EMAIL_MAX) return null;
  if (!trimmedUsername || trimmedUsername.length > USERNAME_MAX) return null;
  return { email: normalisedEmail, username: trimmedUsername };
}

function refuse(code: 'VALIDATION_ERROR' | 'RATE_LIMITED' | 'INTERNAL_ERROR', message: string): Promise<NextResponse> {
  return fail(code, message, { headers: { ...NO_STORE } });
}

function limitRefusal(verdict: LimitVerdict): Promise<NextResponse> {
  return verdict === 'limited' ? refuse('RATE_LIMITED', TOO_MANY_ATTEMPTS) : refuse('INTERNAL_ERROR', RESET_UNAVAILABLE);
}

async function findAccount(request: ForgotRequest): Promise<AccountLookup> {
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('id')
    .eq('username', request.username)
    .eq('email', request.email)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle<{ id: string }>();
  if (error) {
    console.error('admin password reset lookup failed:', error.message);
    return { ok: false };
  }
  return { ok: true, id: data?.id ?? null };
}

async function sendReset(adminId: string, meta: RequestMeta): Promise<void> {
  const sent = await issueAndSend({ adminId, purpose: 'reset' });
  await writeAudit({
    admin: null,
    action: 'PASSWORD_RESET_REQUESTED',
    entity: 'admin_users',
    entity_id: adminId,
    after: { outcome: sent.outcome, expires_at: sent.expiresAt, ip: meta.ip },
    result: sent.outcome === 'sent' ? 'success' : 'failure',
    error: sent.outcome === 'sent' ? null : sent.reason,
    sensitivity: 'security',
  });
}

export async function POST(req: NextRequest) {
  const request = readRequest(await req.json().catch(() => null));
  if (!request) return refuse('VALIDATION_ERROR', MISSING_FIELDS);
  const meta = await requestMeta(req.headers);

  const byIp = await checkLimit(meta.ip, 'admin_password_forgot', 10, 3600);
  if (byIp !== 'allowed') return limitRefusal(byIp);
  const byAccount = await checkLimit(
    `admin:${request.username.toLowerCase()}|${request.email}`,
    'admin_password_forgot_account',
    3,
    3600,
  );
  if (byAccount !== 'allowed') return limitRefusal(byAccount);

  if (!linksConfigured()) {
    console.error('admin password reset: ADMIN_CONSOLE_URL, SUPABASE_URL or ADMIN_FUNCTION_SECRET is not set');
    return refuse('INTERNAL_ERROR', RESET_UNAVAILABLE);
  }

  const account = await findAccount(request);
  if (!account.ok) return refuse('INTERNAL_ERROR', RESET_UNAVAILABLE);
  const adminId = account.id;
  if (adminId) after(() => sendReset(adminId, meta));
  return ok({ message: FORGOT_SENT }, { headers: { ...NO_STORE } });
}
