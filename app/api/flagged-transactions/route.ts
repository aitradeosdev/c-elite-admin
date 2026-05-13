import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';

async function getAdmin() {
  return verifyAdminFromRequest();
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin?.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || '';

  let q = supabaseAdmin
    .from('flagged_transactions')
    .select('id, user_id, transaction_id, transaction_type, amount, flag_reason, status, reviewed_by, reviewed_at, created_at, users(username, full_name, email)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ flagged: data || [] });
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin?.is_super_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === 'string' ? body.action : '';
  const flagId = typeof body?.flag_id === 'string' ? body.flag_id : '';
  if (!flagId) return NextResponse.json({ error: 'Missing flag_id' }, { status: 400 });

  const newStatus = action === 'clear' ? 'cleared' : action === 'escalate' ? 'escalated' : '';
  if (!newStatus) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('flagged_transactions')
    .update({ status: newStatus, reviewed_by: admin!.admin_id, reviewed_at: new Date().toISOString() })
    .eq('id', flagId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin!.admin_id,
    action: action === 'clear' ? 'CLEAR_FLAG' : 'ESCALATE_FLAG',
    entity: 'flagged_transactions',
    entity_id: flagId,
    after_value: { status: newStatus },
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json({ success: true });
}
