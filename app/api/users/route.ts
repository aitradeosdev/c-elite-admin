import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { sanitizeSearch, clampPagination } from '../../lib/sanitize';

async function getAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return null;
  return verifyAdminJWT(token);
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin || !admin.page_permissions?.includes('users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = sanitizeSearch(searchParams.get('search') || '');
  const csv = searchParams.get('csv') === '1';
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

  if (csv) {
    // No pagination for CSV
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Count transactions per user
    const userIds = (data || []).map((u: any) => u.id);
    const { data: txCounts } = await supabaseAdmin.rpc('count_user_transactions', {}) as any;

    const rows = (data || []).map((u: any) => {
      const balance = u.wallets?.[0]?.balance ?? u.wallets?.balance ?? 0;
      const trades = txCounts?.find((t: any) => t.user_id === u.id)?.count ?? 0;
      return {
        id: u.id,
        full_name: u.full_name || '',
        username: u.username || '',
        email: u.email || '',
        phone: u.phone || '',
        balance,
        trades,
        joined: u.created_at,
        status: u.is_frozen ? 'Frozen' : u.is_active ? 'Active' : 'Inactive',
      };
    });

    // Escape each cell: a user-chosen value like `=cmd|'/c calc'!A1`
    // would execute in Excel when the CSV is opened.
    const csvCell = (v: unknown) => {
      const s = v == null ? '' : String(v);
      const needsPrefix = /^[=+\-@\t\r]/.test(s);
      const escaped = (needsPrefix ? "'" + s : s).replace(/"/g, '""');
      return `"${escaped}"`;
    };
    const header = 'ID,Name,Username,Email,Phone,Balance,Trades,Joined,Status\n';
    const csvBody = rows.map((r: any) =>
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

  // Get transaction counts for these users
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
