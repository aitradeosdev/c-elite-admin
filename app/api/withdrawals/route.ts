import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { sanitizeSearch, clampPagination } from '../../lib/sanitize';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

function gated(admin: any): boolean {
  if (!admin) return false;
  if (admin.is_super_admin) return true;
  return (admin.page_permissions || []).includes('withdrawals');
}

function formatCSVField(val: any): string {
  const raw = String(val ?? '');
  const s = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin || !gated(admin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id) {
    const { data: w, error } = await supabaseAdmin
      .from('withdrawals')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!w) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data: u } = await supabaseAdmin
      .from('users').select('id, username, full_name, email, phone').eq('id', w.user_id).maybeSingle();
    const { data: flag } = await supabaseAdmin
      .from('flagged_transactions')
      .select('id, flag_reason, status, created_at, reviewed_at')
      .eq('transaction_type', 'withdrawal')
      .eq('transaction_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return NextResponse.json({ withdrawal: { ...w, user: u, flag } });
  }

  const status = searchParams.get('status') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const search = sanitizeSearch(searchParams.get('search') || '');
  const csv = searchParams.get('csv') === '1';
  const pdf = searchParams.get('pdf') === '1';
  const reviewOnly = searchParams.get('review') === '1';
  const { page, limit, offset } = clampPagination(searchParams.get('page'), searchParams.get('limit'));

  let query = supabaseAdmin
    .from('withdrawals')
    .select(`
      id, user_id, amount, bank_name, account_number, account_name,
      gateway, gateway_reference, status, failure_reason, created_at
    `, { count: 'exact' });

  if (reviewOnly) {
    query = query.in('status', ['pending_review', 'held']);
  } else if (status) {
    query = query.eq('status', status);
  }
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59.999Z');

  if (search) {
    const { data: matchedUsers } = await supabaseAdmin
      .from('users')
      .select('id')
      .or(`full_name.ilike.%${search}%,username.ilike.%${search}%,email.ilike.%${search}%`);
    if (matchedUsers && matchedUsers.length > 0) {
      const ids = matchedUsers.map((u: any) => u.id);
      query = query.in('user_id', ids);
    } else {
      return NextResponse.json({ withdrawals: [], total: 0, page, limit });
    }
  }

  if (csv || pdf) {
    const CAP = 50000;
    const { data, error } = await query.order('created_at', { ascending: false }).range(0, CAP - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = data || [];
    const userIds = Array.from(new Set(rows.map((w: any) => w.user_id).filter(Boolean)));
    let usersMap: Record<string, any> = {};
    if (userIds.length) {
      const { data: users } = await supabaseAdmin
        .from('users').select('id, username, full_name').in('id', userIds);
      usersMap = Object.fromEntries((users || []).map((u: any) => [u.id, u]));
    }

    const exportRows = rows.map((w: any) => {
      const u = usersMap[w.user_id] || null;
      return {
        ID: w.id,
        User: u?.username || u?.full_name || '',
        Amount: w.amount,
        Bank: w.bank_name || '',
        Account: w.account_number || '',
        AccountName: w.account_name || '',
        Status: w.status || '',
        Gateway: w.gateway || '',
        GatewayRef: w.gateway_reference || '',
        Date: w.created_at,
      };
    });

    await supabaseAdmin.from('audit_log').insert({
      admin_id: admin.admin_id,
      action: 'EXPORT_CSV',
      entity: 'withdrawals',
      entity_id: null,
      diff: { rows: exportRows.length, filters: { status, dateFrom, dateTo, search, reviewOnly } },
    });

    if (pdf) {
      return NextResponse.json({ rows: exportRows });
    }

    const header = 'ID,User,Amount,Bank,Account,AccountName,Status,Gateway,GatewayRef,Date\n';
    const body = exportRows.map((r) =>
      [
        r.ID, r.User, r.Amount, r.Bank, r.Account, r.AccountName,
        r.Status, r.Gateway, r.GatewayRef, r.Date,
      ].map(formatCSVField).join(',')
    ).join('\n');

    return new Response(header + body, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="withdrawals-${Date.now()}.csv"`,
      },
    });
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = Array.from(new Set((data || []).map((w: any) => w.user_id).filter(Boolean)));
  let usersMap: Record<string, any> = {};
  if (userIds.length) {
    const { data: users } = await supabaseAdmin
      .from('users').select('id, username, full_name, email').in('id', userIds);
    usersMap = Object.fromEntries((users || []).map((u: any) => [u.id, u]));
  }
  const enriched = (data || []).map((w: any) => ({ ...w, user: usersMap[w.user_id] || null }));

  return NextResponse.json({
    withdrawals: enriched,
    total: count || 0,
    page,
    limit,
  });
}
