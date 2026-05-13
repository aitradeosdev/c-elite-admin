import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { sanitizeSearch, clampPagination } from '../../lib/sanitize';

async function getAdmin() {
  return verifyAdminFromRequest();
}

function formatCSVField(val: any): string {
  const raw = String(val ?? '');
  const s = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin || !admin.page_permissions?.includes('transactions_overview')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = sanitizeSearch(searchParams.get('search') || '');
  const type = searchParams.get('type') || '';
  const status = searchParams.get('status') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const csv = searchParams.get('csv') === '1';
  const { page, limit, offset } = clampPagination(searchParams.get('page'), searchParams.get('limit'));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const [
    { count: totalCount },
    { data: totalAmountData },
    { count: todayCount },
    { data: todayAmountData },
  ] = await Promise.all([
    supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('transactions').select('amount'),
    supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).gte('created_at', todayISO),
    supabaseAdmin.from('transactions').select('amount').gte('created_at', todayISO),
  ]);

  const totalAmount = (totalAmountData || []).reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
  const todayAmount = (todayAmountData || []).reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);

  let query = supabaseAdmin
    .from('transactions')
    .select('id, user_id, type, amount, status, reference_id, metadata, created_at, users(username, full_name, email)', { count: 'exact' });

  if (type) query = query.eq('type', type);
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
        stats: { totalCount: totalCount || 0, totalAmount, todayCount: todayCount || 0, todayAmount },
      });
    }
  }

  if (csv) {
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const header = 'ID,User,Email,Type,Amount,Status,Reference,Date\n';
    const csvBody = (data || []).map((t: any) =>
      [
        t.id,
        formatCSVField((t as any).users?.username || ''),
        formatCSVField((t as any).users?.email || ''),
        t.type || '',
        t.amount,
        t.status || '',
        formatCSVField(t.reference_id || ''),
        t.created_at,
      ].join(',')
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
    stats: {
      totalCount: totalCount || 0,
      totalAmount,
      todayCount: todayCount || 0,
      todayAmount,
    },
  });
}
