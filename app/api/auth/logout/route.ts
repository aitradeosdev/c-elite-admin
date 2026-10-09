import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';
import { writeAudit } from '../../../lib/audit';
import { clientIpFrom, ok, requestId } from '../../../lib/api';

async function revokeSessions(adminId: string): Promise<string | null> {
  try {
    const { data: cur, error: readError } = await supabaseAdmin
      .from('admin_users').select('token_version').eq('id', adminId).single<{ token_version: number | null }>();
    const next = (cur?.token_version ?? 0) + 1;
    const { error: writeError } = await supabaseAdmin
      .from('admin_users').update({ token_version: next }).eq('id', adminId);
    return readError?.message ?? writeError?.message ?? null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (token) {
    const admin = await verifyAdminJWT(token);
    if (admin) {
      const revokeError = await revokeSessions(admin.admin_id);
      if (revokeError) console.error('admin logout session revoke failed:', revokeError);
      await writeAudit({
        admin: {
          admin_id: admin.admin_id,
          role_title: admin.role_title,
          ip: clientIpFrom((name) => req.headers.get(name)),
          user_agent: (req.headers.get('user-agent') || '').slice(0, 512),
          request_id: await requestId(),
        },
        action: 'LOGOUT',
        entity: 'admin_users',
        entity_id: admin.admin_id,
        result: revokeError ? 'partial' : 'success',
        error: revokeError,
        sensitivity: 'security',
      });
    }
  }

  const response = await ok();
  response.cookies.set('admin_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0),
    path: '/',
  });
  response.cookies.set('admin_theme', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(0),
    path: '/',
  });
  return response;
}
