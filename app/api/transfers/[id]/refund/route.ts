import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../../../lib/jwt';
import { supabaseAdmin } from '../../../../lib/supabase';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

function gated(admin: any): boolean {
  if (!admin) return false;
  if (admin.is_super_admin) return true;
  return (admin.page_permissions || []).includes('transfers');
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!gated(admin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'Refund reason required' }, { status: 400 });

  const { data: before } = await supabaseAdmin
    .from('transfers')
    .select('type, status, amount, sender_id')
    .eq('id', id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (before.type !== 'bank') return NextResponse.json({ error: 'Only bank transfers can be manually refunded' }, { status: 400 });
  if (!['initiated', 'processing'].includes(before.status)) {
    return NextResponse.json({ error: `Cannot refund a transfer in status ${before.status}` }, { status: 409 });
  }

  const { error } = await supabaseAdmin.rpc('refund_bank_transfer', {
    p_transfer_id: id,
    p_reason: reason,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin!.admin_id,
    action: 'REFUND_TRANSFER',
    entity: 'transfers',
    entity_id: id,
    before_value: before,
    after_value: { status: 'failed', reason },
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
