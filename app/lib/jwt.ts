import { SignJWT, jwtVerify } from 'jose';
import { supabaseAdmin } from './supabase';

const secret = new TextEncoder().encode(process.env.ADMIN_JWT_SECRET!);

export interface AdminJWTPayload {
  admin_id: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  username: string;
}

export async function signAdminJWT(payload: AdminJWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
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
