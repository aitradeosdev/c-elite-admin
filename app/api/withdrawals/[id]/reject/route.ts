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
  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason || '').slice(0, 500);

  const { data: w } = await supabaseAdmin.from('withdrawals').select('status').eq('id', id).maybeSingle();
  if (!w) return NextResponse.json({ error: 'Withdrawal not found' }, { status: 404 });
  if (!['pending_review', 'held', 'initiated'].includes(w.status)) {
    return NextResponse.json({ error: `Cannot reject from status ${w.status}` }, { status: 409 });
  }

  const { error: rpcErr } = await supabaseAdmin.rpc('admin_reject_withdrawal', {
    p_withdrawal_id: id,
    p_admin_id: admin.admin_id,
    p_reason: reason,
  });
  if (rpcErr) {
    console.error('admin_reject_withdrawal:', rpcErr.message);
    return NextResponse.json({ error: 'Could not reject' }, { status: 400 });
  }

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id,
    action: 'REJECT_WITHDRAWAL',
    entity: 'withdrawals',
    entity_id: id,
    after_value: redactAudit({ reason }),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
