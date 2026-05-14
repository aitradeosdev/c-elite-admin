import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';
import { redactAudit } from '../../../lib/redact';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('notifications_broadcast')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { data, error } = await supabaseAdmin
    .from('notification_broadcasts')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ broadcasts: data || [] });
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('notifications_broadcast')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { title, message, type, audience, target_user_id } = body;
  if (!title || !message || !audience) {
    return NextResponse.json({ error: 'Missing title/message/audience' }, { status: 400 });
  }

  if (audience === 'user') {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!target_user_id || !UUID_RE.test(String(target_user_id))) {
      return NextResponse.json({ error: 'Invalid target_user_id' }, { status: 400 });
    }
    const { data: exists } = await supabaseAdmin
      .from('users').select('id').eq('id', target_user_id).maybeSingle();
    if (!exists) return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
  }

  const url = `${process.env.SUPABASE_URL}/functions/v1/broadcast-notification`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': process.env.ADMIN_FUNCTION_SECRET || '',
    },
    body: JSON.stringify({ title, message, type, audience, target_user_id, admin_id: admin.admin_id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ error: data?.error || 'Broadcast failed' }, { status: res.status });

  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.admin_id, action: 'BROADCAST_NOTIFICATION', entity: 'notification_broadcasts',
    entity_id: data.broadcast_id || null,
    after_value: redactAudit({ title, audience, recipient_count: data.recipient_count, delivered: data.delivered }),
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
  });

  return NextResponse.json(data);
}
