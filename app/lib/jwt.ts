import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { supabaseAdmin } from './supabase';

const secret = new TextEncoder().encode(process.env.ADMIN_JWT_SECRET!);

export interface AdminJWTPayload {
  admin_id: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  username: string;
}

export async function signAdminJWT(payload: AdminJWTPayload, expiresIn: string = '8h'): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifyAdminJWT(token: string): Promise<AdminJWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    const claims = payload as unknown as AdminJWTPayload;

    const { data: admin } = await supabaseAdmin
      .from('admin_users')
      .select('id, is_active, is_super_admin, page_permissions')
      .eq('id', claims.admin_id)
      .eq('is_active', true)
      .single();

    if (!admin) return null;

    return {
      ...claims,
      is_super_admin: admin.is_super_admin,
      page_permissions: admin.page_permissions || [],
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the calling admin from either:
 *   1. Authorization: Bearer <jwt>   (mobile)
 *   2. admin_token cookie            (web)
 * Bearer wins if both are present. Returns null if neither validates.
 *
 * Reads request context via Next.js's `headers()` + `cookies()` — call from
 * route handlers, no argument needed. Use this from every route both web AND
 * mobile call. Web-only routes can keep the cookie-only `verifyAdminJWT`.
 */
export async function verifyAdminFromRequest(): Promise<AdminJWTPayload | null> {
  const h = await headers();
  const auth = h.get('authorization');
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) {
      const claims = await verifyAdminJWT(m[1].trim());
      if (claims) return claims;
    }
  }
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return null;
  return verifyAdminJWT(token);
}
