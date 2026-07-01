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
  if (!admin || (!admin.is_super_admin && !admin.page_permissions?.includes('transactions_overview'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = sanitizeSearch(searchParams.get('search') || '');
  const type = searchParams.get('type') || '';
  const status = searchParams.get('status') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const csv = searchParams.get('csv') === '1';
  const pdf = searchParams.get('pdf') === '1';
  const { page, limit, offset } = clampPagination(searchParams.get('page'), searchParams.get('limit'));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const { data: statsRows } = await supabaseAdmin.rpc('admin_transactions_stats');
  const stats0 = Array.isArray(statsRows) ? statsRows[0] : statsRows;
  const totalCount = Number(stats0?.total_count || 0);
  const totalAmount = Number(stats0?.total_amount || 0);
  const todayCount = Number(stats0?.today_count || 0);
  const todayAmount = Number(stats0?.today_amount || 0);

  let query = supabaseAdmin
    .from('transactions')
    .select('id, user_id, type, amount, status, reference_id, metadata, created_at, users(username, full_name, email)', { count: 'exact' });

  if (type) {
    const arr = type.split(',').map((s) => s.trim()).filter(Boolean);
    if (arr.length === 1) query = query.eq('type', arr[0]);
    else if (arr.length > 1) query = query.in('type', arr);
  }
  if (status) query = query.eq('status', status);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59.999Z');

  if (search) {
    const { data: matchedUsers } = await supabaseAdmin
      .from('users')
      .select('id')
      .or(`full_name.ilike.%${search}%,username.ilike.%${search}%,email.ilike.%${search}%`);
    if (matchedUsers && matchedUsers.length > 0) {
      query = query.in('user_id', matchedUsers.map((u: any) => u.id));
    } else {
      return NextResponse.json({
        transactions: [],
        total: 0,
        page,
        limit,
        stats: { totalCount, totalAmount, todayCount, todayAmount },
      });
    }
  }

  if (csv || pdf) {
    const CAP = 50000;
    const { data, error } = await query.order('created_at', { ascending: false }).range(0, CAP - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const exportRows = (data || []).map((t: any) => ({
      ID: t.id,
      User: t.users?.username || '',
      Email: t.users?.email || '',
      Type: t.type || '',
      Amount: t.amount,
      Status: t.status || '',
      Reference: t.reference_id || '',
      Date: t.created_at,
    }));

    await supabaseAdmin.from('audit_log').insert({
      admin_id: admin.admin_id,
      action: 'EXPORT_CSV',
      entity: 'transactions',
      entity_id: null,
      diff: { rows: exportRows.length, filters: { type, status, dateFrom, dateTo, search } },
    });

    if (pdf) {
      return NextResponse.json({ rows: exportRows });
    }

    const header = 'ID,User,Email,Type,Amount,Status,Reference,Date\n';
    const csvBody = exportRows.map((r) =>
      [
        r.ID, r.User, r.Email, r.Type, r.Amount, r.Status, r.Reference, r.Date,
      ].map(formatCSVField).join(',')
    ).join('\n');

    return new Response(header + csvBody, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="transactions-${Date.now()}.csv"`,
      },
    });
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    transactions: data || [],
    total: count || 0,
    page,
    limit,
    stats: { totalCount, totalAmount, todayCount, todayAmount },
  });
}
