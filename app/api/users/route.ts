import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { sanitizeSearch, clampPagination } from '../../lib/sanitize';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin || (!admin.is_super_admin && !admin.page_permissions?.includes('users'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = sanitizeSearch(searchParams.get('search') || '');
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const csv = searchParams.get('csv') === '1';
  const pdf = searchParams.get('pdf') === '1';
  const { page, limit, offset } = clampPagination(searchParams.get('page'), searchParams.get('limit'));

  let query = supabaseAdmin
    .from('users')
    .select(`
      id, full_name, username, email, phone, country, is_active, is_frozen, freeze_reason, created_at,
      wallets(balance)
    `, { count: 'exact' });

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,username.ilike.%${search}%,email.ilike.%${search}%`);
  }
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59.999Z');

  if (csv || pdf) {
    const CSV_MAX_ROWS = 50000;
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .range(0, CSV_MAX_ROWS - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: txCounts } = await supabaseAdmin.rpc('count_user_transactions', {}) as any;
    const tradeMap: Record<string, number> = {};
    (txCounts || []).forEach((t: any) => { tradeMap[t.user_id] = Number(t.count) || 0; });

    const exportRows = (data || []).map((u: any) => {
      const balance = u.wallets?.[0]?.balance ?? u.wallets?.balance ?? 0;
      return {
        id: u.id,
        full_name: u.full_name || '',
        username: u.username || '',
        email: u.email || '',
        phone: u.phone || '',
        balance,
        trades: tradeMap[u.id] || 0,
        joined: u.created_at,
        status: u.is_frozen ? 'Frozen' : u.is_active ? 'Active' : 'Inactive',
      };
    });

    try {
      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.admin_id,
        action: 'EXPORT_CSV',
        entity: 'users',
        entity_id: 'bulk',
        after_value: { rows: exportRows.length, search: search || null, cap: CSV_MAX_ROWS },
        ip_address: req.headers.get('x-forwarded-for') || 'unknown',
      });
    } catch {}

    if (pdf) {
      return NextResponse.json({ rows: exportRows });
    }

    const csvCell = (v: unknown) => {
      const s = v == null ? '' : String(v);
      const needsPrefix = /^[=+\-@\t\r]/.test(s);
      const escaped = (needsPrefix ? "'" + s : s).replace(/"/g, '""');
      return `"${escaped}"`;
    };
    const header = 'ID,Name,Username,Email,Phone,Balance,Trades,Joined,Status\n';
    const csvBody = exportRows.map((r: any) =>
      [r.id, r.full_name, r.username, r.email, r.phone, r.balance, r.trades, r.joined, r.status]
        .map(csvCell).join(',')
    ).join('\n');

    return new Response(header + csvBody, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="users-${Date.now()}.csv"`,
      },
    });
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = (data || []).map((u: any) => u.id);
  let tradeCounts: Record<string, number> = {};
  if (userIds.length > 0) {
    const { data: txData } = await supabaseAdmin
      .from('transactions')
      .select('user_id')
      .in('user_id', userIds);
    if (txData) {
      txData.forEach((t: any) => {
        tradeCounts[t.user_id] = (tradeCounts[t.user_id] || 0) + 1;
      });
    }
  }

  const users = (data || []).map((u: any) => ({
    ...u,
    balance: u.wallets?.[0]?.balance ?? u.wallets?.balance ?? 0,
    trades: tradeCounts[u.id] || 0,
  }));

  return NextResponse.json({ users, total: count || 0, page, limit });
}
