import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../../../lib/jwt';
import { supabaseAdmin } from '../../../../lib/supabase';
import { redactAudit } from '../../../../lib/redact';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

function gated(admin: any): boolean {
  if (!admin) return false;
  if (admin.is_super_admin) return true;
  return (admin.page_permissions || []).includes('withdrawals');
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin || !gated(admin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const { data: w } = await supabaseAdmin.from('withdrawals').select('status').eq('id', id).maybeSingle();
  if (!w) return NextResponse.json({ error: 'Withdrawal not found' }, { status: 404 });
  if (!['pending_review', 'held'].includes(w.status)) {
    return NextResponse.json({ error: `Cannot approve from status ${w.status}` }, { status: 409 });
  }

  const { data: rpc, error: rpcErr } = await supabaseAdmin.rpc('admin_approve_withdrawal', {
    p_withdrawal_id: id,
    p_admin_id: admin.admin_id,
  });
  if (rpcErr) {
    console.error('admin_approve_withdrawal:', rpcErr.message);
    return NextResponse.json({ error: 'Could not approve' }, { status: 400 });
  }

  const adminToken = (await cookies()).get('admin_token')?.value;
  const url = `${process.env.SUPABASE_URL}/functions/v1/resume-withdrawal`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': process.env.ADMIN_FUNCTION_SECRET || '',
      Authorization: `Bearer ${adminToken || ''}`,
    },
    body: JSON.stringify({ withdrawal_id: id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    return NextResponse.json({ error: data?.message || 'Gateway failed', rpc }, { status: res.status || 500 });
  }

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id,
    action: 'APPROVE_WITHDRAWAL',
    entity: 'withdrawals',
    entity_id: id,
    after_value: redactAudit({ gateway_reference: data.gateway_reference }),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true, gateway_reference: data.gateway_reference });
}
