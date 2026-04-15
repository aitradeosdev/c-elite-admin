import { SignJWT, jwtVerify } from 'jose';

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
    return payload as unknown as AdminJWTPayload;
  } catch {
    return null;
  }
}
