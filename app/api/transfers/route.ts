import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { sanitizeSearch, clampPagination } from '../../lib/sanitize';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

function formatCSVField(val: any): string {
  const raw = String(val ?? '');
  const s = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin || (!admin.is_super_admin && !admin.page_permissions?.includes('transfers'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || '';
  const status = searchParams.get('status') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const search = sanitizeSearch(searchParams.get('search') || '');
  const csv = searchParams.get('csv') === '1';
  const { page, limit, offset } = clampPagination(searchParams.get('page'), searchParams.get('limit'));

  let query = supabaseAdmin
    .from('transfers')
    .select(`
      id, sender_id, recipient_id, recipient_bank_name, recipient_account_number,
      recipient_account_name, amount, fee, type, note, status, created_at,
      sender:users!transfers_sender_id_fkey(username, full_name),
      recipient:users!transfers_recipient_id_fkey(username, full_name)
    `, { count: 'exact' });

  if (type) query = query.eq('type', type);
  if (status) query = query.eq('status', status);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59.999Z');

  if (search) {
    const { data: matchedUsers } = await supabaseAdmin
      .from('users')
      .select('id')
      .or(`full_name.ilike.%${search}%,username.ilike.%${search}%`);
    if (matchedUsers && matchedUsers.length > 0) {
      const ids = matchedUsers.map((u: any) => u.id);
      query = query.or(`sender_id.in.(${ids.join(',')}),recipient_id.in.(${ids.join(',')})`);
    } else {
      return NextResponse.json({ transfers: [], total: 0, page, limit });
    }
  }

  if (csv) {
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const header = 'ID,Type,Sender,Recipient,Bank,Account,Amount,Fee,Status,Date\n';
    const csvBody = (data || []).map((t: any) => {
      const senderName = t.sender?.username || t.sender?.full_name || '';
      const recipientName = t.type === 'tag'
        ? (t.recipient?.username || t.recipient?.full_name || '')
        : (t.recipient_account_name || '');
      return [
        t.id,
        t.type || '',
        formatCSVField(senderName),
        formatCSVField(recipientName),
        formatCSVField(t.recipient_bank_name || ''),
        formatCSVField(t.recipient_account_number || ''),
        t.amount,
        t.fee || 0,
        t.status || '',
        t.created_at,
      ].join(',');
    }).join('\n');

    return new Response(header + csvBody, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="transfers-${Date.now()}.csv"`,
      },
    });
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    transfers: data || [],
    total: count || 0,
    page,
    limit,
  });
}
