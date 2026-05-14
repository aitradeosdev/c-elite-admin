import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT, verifyAdminFromRequest } from '../../lib/jwt';
import { supabaseAdmin } from '../../lib/supabase';
import { redactAudit } from '../../lib/redact';

async function getAdmin(_req?: any) {
  return verifyAdminFromRequest();
}

async function logAction(adminId: string, action: string, entityId: string, before: any, after: any, ip: string) {
  await supabaseAdmin.from('audit_log').insert({
    admin_id: adminId,
    action,
    entity: 'card_submissions',
    entity_id: entityId,
    before_value: redactAudit(before),
    after_value: redactAudit(after),
    ip_address: ip,
  });
}

async function signImagePaths(paths: string[] | null): Promise<string[]> {
  if (!paths || paths.length === 0) return [];
  const out: string[] = [];
  for (const p of paths) {
    const { data } = await supabaseAdmin.storage.from('card-images').createSignedUrl(p, 3600);
    if (data?.signedUrl) out.push(data.signedUrl);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin || (!admin.is_super_admin && !(admin.page_permissions || []).includes('card_queue'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const search = searchParams.get('search')?.trim();
  const id = searchParams.get('id');

  if (id) {
    const { data, error } = await supabaseAdmin
      .from('card_submissions')
      .select(`
        id, amount_foreign, payout_naira, rate_at_submission, status, rejection_reason,
        submitted_fields, card_images, dispute_message, dispute_images, coupon_code, coupon_bonus, created_at,
        card_id, card_type_id,
        users(id, full_name, username, email),
        cards(id, name),
        card_types(id, name, country_code),
        denominations(range_label)
      `)
      .eq('id', id)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const cardImages = await signImagePaths((data as any).card_images);
    const disputeImages = await signImagePaths((data as any).dispute_images);
    let country_name: string | null = null;
    const cc = (data as any).card_types?.country_code;
    const cardId = (data as any).cards ? (await supabaseAdmin.from('card_submissions').select('card_id').eq('id', id).single()).data?.card_id : null;
    if (cc && cardId) {
      const { data: cn } = await supabaseAdmin
        .from('card_countries')
        .select('country_name, currency_symbol')
        .eq('card_id', cardId)
        .eq('country_code', cc)
        .maybeSingle();
      country_name = cn?.country_name || cc;
    }
    const { data: cardIdRow } = await supabaseAdmin
      .from('card_submissions')
      .select('card_id')
      .eq('id', id)
      .single();
    let card_types_for_card: any[] = [];
    if (cardIdRow?.card_id) {
      const { data: types } = await supabaseAdmin
        .from('card_types')
        .select('id, name, country_code, card_id')
        .eq('card_id', cardIdRow.card_id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      const typeIds = (types || []).map((t: any) => t.id);
      let denoms: any[] = [];
      if (typeIds.length > 0) {
        const { data: d } = await supabaseAdmin
          .from('denominations')
          .select('id, card_type_id, range_label, min_value, max_value, rate_naira')
          .in('card_type_id', typeIds)
          .eq('is_active', true);
        denoms = d || [];
      }
      card_types_for_card = (types || []).map((t: any) => ({
        ...t,
        denominations: denoms.filter((d: any) => d.card_type_id === t.id),
      }));
    }
    return NextResponse.json({ submission: { ...data, card_images: cardImages, dispute_images: disputeImages, country_name, card_types_for_card } });
  }

  let query = supabaseAdmin
    .from('card_submissions')
    .select(`
      id, amount_foreign, payout_naira, status, created_at, rejection_reason, dispute_message,
      users(id, full_name, username, email),
      cards(name),
      card_types(name, country_code)
    `)
    .order('created_at', { ascending: false })
    .limit(200);

  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = data || [];
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter((r: any) =>
      r.users?.username?.toLowerCase().includes(s) ||
      r.users?.full_name?.toLowerCase().includes(s) ||
      r.cards?.name?.toLowerCase().includes(s)
    );
  }

  return NextResponse.json({ submissions: rows });
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin || (!admin.is_super_admin && !(admin.page_permissions || []).includes('card_queue'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  const { action, submission_id, reason, card_type_id, amount_foreign, correction_note } = body;

  if (!action || !submission_id) {
    return NextResponse.json({ error: 'Missing action or submission_id' }, { status: 400 });
  }

  const { data: before } = await supabaseAdmin
    .from('card_submissions')
    .select('*')
    .eq('id', submission_id)
    .single();

  if (!before) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });

  if (action === 'approve' || action === 'overturn') {
    const rpcArgs: any = { p_submission_id: submission_id, p_admin_id: admin.admin_id };
    if (card_type_id) rpcArgs.p_card_type_id = card_type_id;
    if (amount_foreign !== undefined && amount_foreign !== null && amount_foreign !== '') {
      const n = Number(amount_foreign);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: 'Invalid corrected amount' }, { status: 400 });
      }
      rpcArgs.p_amount_foreign = n;
    }
    if (correction_note && String(correction_note).trim()) {
      rpcArgs.p_correction_note = String(correction_note).trim();
    }
    const { data, error } = await supabaseAdmin.rpc('approve_card_submission', rpcArgs);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAction(admin.admin_id, action === 'overturn' ? 'OVERTURN_DISPUTE' : 'APPROVE_CARD', submission_id, before, { status: 'approved', ...rpcArgs }, ip);
    return NextResponse.json({ success: true, result: data });
  }

  if (action === 'reject') {
    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 });
    }
    if (before.status !== 'pending') {
      return NextResponse.json({ error: 'Only pending submissions can be rejected' }, { status: 400 });
    }
    const { data: updated, error } = await supabaseAdmin
      .from('card_submissions')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', submission_id)
      .eq('status', 'pending')
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Submission is no longer pending' }, { status: 409 });
    }

    const { data: existingTxn } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('reference_id', submission_id)
      .eq('type', 'giftcard_credit')
      .maybeSingle();
    if (existingTxn) {
      await supabaseAdmin
        .from('transactions')
        .update({ status: 'failed', metadata: { submission_id, rejection_reason: reason } })
        .eq('id', existingTxn.id);
    } else {
      await supabaseAdmin.from('transactions').insert({
        user_id: before.user_id,
        type: 'giftcard_credit',
        amount: before.payout_naira,
        status: 'failed',
        reference_id: submission_id,
        idempotency_key: 'reject-card-' + submission_id,
        metadata: { submission_id, rejection_reason: reason },
      });
    }

    const { data: cardRow } = await supabaseAdmin
      .from('cards')
      .select('name')
      .eq('id', before.card_id)
      .maybeSingle();
    const { data: typeRow } = await supabaseAdmin
      .from('card_types')
      .select('name, country_code')
      .eq('id', before.card_type_id)
      .maybeSingle();
    let symbol = '$';
    if (typeRow?.country_code) {
      const { data: cc } = await supabaseAdmin
        .from('card_countries')
        .select('currency_symbol')
        .eq('card_id', before.card_id)
        .eq('country_code', typeRow.country_code)
        .maybeSingle();
      if (cc?.currency_symbol) symbol = cc.currency_symbol;
    }
    const amtNum = Number(before.amount_foreign) || 0;
    const amtStr = Number.isInteger(amtNum)
      ? amtNum.toLocaleString('en-US')
      : amtNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cardLabel = `${symbol}${amtStr} ${cardRow?.name || 'Gift card'}${typeRow?.name ? ` (${typeRow.name})` : ''}`;
    const rejectBody = `${cardLabel} was rejected. Reason: ${reason}`;

    await supabaseAdmin.rpc('emit_notification', {
      p_user_id: before.user_id,
      p_template_key: 'card_rejected',
      p_type: 'card_rejected',
      p_vars: { card_label: cardLabel, reason },
    });

    await logAction(admin.admin_id, 'REJECT_CARD', submission_id, before, { status: 'rejected', rejection_reason: reason }, ip);
    return NextResponse.json({ success: true });
  }

  if (action === 'uphold') {
    if (before.status !== 'disputed') {
      return NextResponse.json({ error: 'Only disputed submissions can be upheld' }, { status: 400 });
    }
    const { data: updated, error } = await supabaseAdmin
      .from('card_submissions')
      .update({ status: 'dispute_resolved' })
      .eq('id', submission_id)
      .eq('status', 'disputed')
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Submission is no longer disputed' }, { status: 409 });
    }

    await supabaseAdmin
      .from('transactions')
      .update({ status: 'failed' })
      .eq('reference_id', submission_id)
      .eq('type', 'giftcard_credit');

    await supabaseAdmin.rpc('emit_notification', {
      p_user_id: before.user_id,
      p_template_key: 'dispute_closed',
      p_type: 'dispute_closed',
      p_vars: {},
    });

    await logAction(admin.admin_id, 'UPHOLD_DISPUTE', submission_id, before, { status: 'dispute_resolved' }, ip);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
