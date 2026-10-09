import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../lib/supabase';
import { signAdminJWT } from '../../lib/jwt';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { clientIpFrom, fail, ok, requestId } from '../../lib/api';

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const ADMIN_COLUMNS =
  'id, username, email, password_hash, role_title, is_super_admin, is_active, page_permissions, theme_preference, token_version';
const ENTITY = 'admin_users';
const MISSING_FIELDS = 'Email, username and password required';
const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again later.';
const INVALID_CREDENTIALS = 'Invalid credentials';
const PASSWORD_MISMATCH = 'Password did not match.';
const NO_ROWS = 'PGRST116';
const BURST_WINDOW_MS = 30 * 60 * 1000;
const BURST_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 24 * 60 * 60 * 1000;
const LOCKOUT_THRESHOLD = 25;

type ThemePreference = 'light' | 'dark' | 'system';
type AuditActor = NonNullable<AuditInput['admin']>;

interface Credentials {
  email: string;
  username: string;
  password: string;
}

interface AdminRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role_title: string;
  is_super_admin: boolean;
  is_active: boolean;
  page_permissions: string[] | null;
  theme_preference: string | null;
  token_version: number | null;
}

interface RequestMeta {
  ip: string;
  user_agent: string;
  request_id: string;
}

function readCredentials(body: unknown): Credentials | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { email, username, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof username !== 'string' || typeof password !== 'string') return null;
  if (!email || !username || !password) return null;
  return { email, username, password };
}

async function requestMeta(req: NextRequest): Promise<RequestMeta> {
  const get = (name: string) => req.headers.get(name);
  return {
    ip: clientIpFrom(get),
    user_agent: (get('user-agent') || '').slice(0, 512),
    request_id: await requestId(),
  };
}

async function withinRateLimit(key: string, action: string, limit: number, windowSecs: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('check_rate_limit_by_key', {
    p_key: key,
    p_action: action,
    p_limit: limit,
    p_window_secs: windowSecs,
  });
  if (error) console.error('admin login rate limit check failed:', action, error.message);
  return data !== false;
}

function actorFor(admin: AdminRow, meta: RequestMeta): AuditActor {
  return {
    admin_id: admin.id,
    role_title: admin.role_title,
    ip: meta.ip,
    user_agent: meta.user_agent,
    request_id: meta.request_id,
  };
}

function themePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

async function countFailures(adminId: string, windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await supabaseAdmin
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('admin_id', adminId)
    .eq('action', 'LOGIN_FAILED')
    .gte('created_at', since);
  return count ?? 0;
}

async function raiseBurstAlert(admin: AdminRow, failures: number, ip: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('admin_alerts').insert({
      admin_id: admin.id,
      severity: 'high',
      event_type: 'admin_login_burst',
      subject: `Repeated failed admin logins for ${admin.email}`,
      detail: { admin_id: admin.id, email: admin.email, fail_count: failures, ip },
    });
    if (error) console.error('admin login burst alert failed:', error.message);
  } catch (error) {
    console.error('admin login burst alert failed:', error instanceof Error ? error.message : String(error));
  }
}

async function autoDeactivate(admin: AdminRow, actor: AuditActor, failures: number): Promise<void> {
  const { error } = await supabaseAdmin.from('admin_users').update({ is_active: false }).eq('id', admin.id);
  if (error) console.error('admin auto-deactivation failed:', error.message);
  await writeAudit({
    admin: actor,
    action: 'ADMIN_AUTO_DEACTIVATED',
    entity: ENTITY,
    entity_id: admin.id,
    before: { is_active: true },
    after: { is_active: false },
    reason: `${failures} failed sign-ins in the last 24 hours.`,
    result: error ? 'failure' : 'success',
    error: error ? error.message : null,
    sensitivity: 'security',
  });
}

async function recordFailedSignIn(admin: AdminRow, meta: RequestMeta): Promise<void> {
  const actor = actorFor(admin, meta);
  await writeAudit({
    admin: actor,
    action: 'LOGIN_FAILED',
    entity: ENTITY,
    entity_id: admin.id,
    result: 'failure',
    error: PASSWORD_MISMATCH,
    sensitivity: 'security',
  });

  const [recent, daily] = await Promise.all([
    countFailures(admin.id, BURST_WINDOW_MS),
    countFailures(admin.id, LOCKOUT_WINDOW_MS),
  ]);
  if (recent >= BURST_THRESHOLD) await raiseBurstAlert(admin, recent, meta.ip);
  if (daily >= LOCKOUT_THRESHOLD) await autoDeactivate(admin, actor, daily);
}

export async function POST(req: NextRequest) {
  const credentials = readCredentials(await req.json().catch(() => null));
  if (!credentials) return fail('VALIDATION_ERROR', MISSING_FIELDS);
  const { email, username, password } = credentials;

  const meta = await requestMeta(req);
  if (!(await withinRateLimit(meta.ip, 'admin_login', 20, 600))) {
    return fail('RATE_LIMITED', TOO_MANY_ATTEMPTS);
  }

  const accountKey = `admin:${username.toLowerCase()}|${email.toLowerCase()}`;
  if (!(await withinRateLimit(accountKey, 'admin_login_account', 10, 1800))) {
    return fail('RATE_LIMITED', TOO_MANY_ATTEMPTS);
  }

  const { data: admin, error } = await supabaseAdmin
    .from('admin_users')
    .select(ADMIN_COLUMNS)
    .eq('username', username)
    .eq('email', email)
    .eq('is_active', true)
    .single<AdminRow>();

  if (error || !admin) {
    if (error && error.code !== NO_ROWS) console.error('admin login lookup failed:', error.message);
    await bcrypt.compare(password, DUMMY_HASH);
    return fail('AUTH_REQUIRED', INVALID_CREDENTIALS);
  }

  const passwordMatch = await bcrypt.compare(password, admin.password_hash);
  if (!passwordMatch) {
    await recordFailedSignIn(admin, meta);
    return fail('AUTH_REQUIRED', INVALID_CREDENTIALS);
  }

  await supabaseAdmin
    .from('admin_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', admin.id);

  await writeAudit({
    admin: actorFor(admin, meta),
    action: 'LOGIN',
    entity: ENTITY,
    entity_id: admin.id,
    result: 'success',
    sensitivity: 'security',
  });

  const isMobile = req.headers.get('x-client') === 'mobile-admin';

  const token = await signAdminJWT({
    admin_id: admin.id,
    role_title: admin.role_title,
    is_super_admin: admin.is_super_admin,
    page_permissions: admin.page_permissions || [],
    username: admin.username,
    token_version: admin.token_version ?? 0,
  }, isMobile ? '24h' : '8h');

  const themePref = themePreference(admin.theme_preference);

  if (isMobile) {
    return ok({
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role_title: admin.role_title,
        is_super_admin: admin.is_super_admin,
        page_permissions: admin.page_permissions || [],
        theme_preference: themePref,
      },
    });
  }

  const response = await ok();
  response.cookies.set('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 8,
    path: '/',
  });

  response.cookies.set('admin_theme', themePref, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });

  return response;
}
