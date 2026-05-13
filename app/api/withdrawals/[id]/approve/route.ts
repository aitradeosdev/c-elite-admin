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

  const { data: rpc, error: rpcErr } = await supabaseAdmin.rpc('admin_approve_withdrawal', {
    p_withdrawal_id: id,
    p_admin_id: admin!.admin_id,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 400 });

  const url = `${process.env.SUPABASE_URL}/functions/v1/resume-withdrawal`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': process.env.ADMIN_FUNCTION_SECRET || '',
    },
    body: JSON.stringify({ withdrawal_id: id, admin_id: admin!.admin_id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    return NextResponse.json({ error: data?.message || 'Gateway failed', rpc }, { status: res.status || 500 });
  }

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin!.admin_id,
    action: 'APPROVE_WITHDRAWAL',
    entity: 'withdrawals',
    entity_id: id,
    after_value: { gateway_reference: data.gateway_reference },
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true, gateway_reference: data.gateway_reference });
}
