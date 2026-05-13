import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../../../lib/jwt';
import { supabaseAdmin } from '../../../../lib/supabase';

async function getAdmin() {
  return verifyAdminFromRequest();
}

function gated(admin: any): boolean {
  if (!admin) return false;
  if (admin.is_super_admin) return true;
  return (admin.page_permissions || []).includes('withdrawals');
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!gated(admin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason || '').slice(0, 500);

  const { error: rpcErr } = await supabaseAdmin.rpc('admin_reject_withdrawal', {
    p_withdrawal_id: id,
    p_admin_id: admin!.admin_id,
    p_reason: reason,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 400 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin!.admin_id,
    action: 'REJECT_WITHDRAWAL',
    entity: 'withdrawals',
    entity_id: id,
    after_value: { reason },
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
