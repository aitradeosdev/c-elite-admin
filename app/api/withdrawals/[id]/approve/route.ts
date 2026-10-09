import type { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { supabaseAdmin } from '../../../../lib/supabase';
import { requireAdmin } from '../../../../lib/guard';
import { verifyAdminJWT } from '../../../../lib/jwt';
import { writeAudit } from '../../../../lib/audit';
import { ok, fail, isUuid } from '../../../../lib/api';
import { readPayoutGateway } from '../../../../lib/gateway';
import { EMERGENCY_APPROVAL, FROZEN_APPROVAL } from '../../../../(dashboard)/withdrawals/model';

const APPROVABLE = ['pending_review', 'held'];

const GATEWAY_TIMEOUT_MS = 45000;

interface WithdrawalRow {
  status: string;
  amount: number | null;
  fee: number | null;
  user_id: string | null;
  gateway: string | null;
}

async function forwardedAdminToken(): Promise<string | null> {
  const requestHeaders = await headers();
  if (requestHeaders.get('x-client') === 'mobile-admin') {
    const bearer = requestHeaders.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (bearer && (await verifyAdminJWT(bearer))) return bearer;
  }
  return (await cookies()).get('admin_token')?.value || null;
}

async function currentStatus(id: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('withdrawals').select('status').eq('id', id).maybeSingle();
  return data?.status ?? null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin('withdrawals.approve');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fail('VALIDATION_ERROR', 'Invalid withdrawal id.');

  const body = await req.json().catch(() => ({}));
  const reason = String((body as { reason?: unknown })?.reason || '').slice(0, 500) || null;

  const { data: before, error: readErr } = await supabaseAdmin
    .from('withdrawals')
    .select('status, amount, fee, user_id, gateway')
    .eq('id', id)
    .maybeSingle<WithdrawalRow>();

  if (readErr) return fail('INTERNAL_ERROR', 'Could not read the withdrawal.');
  if (!before) return fail('RESOURCE_NOT_FOUND', 'Withdrawal not found.');
  if (!APPROVABLE.includes(before.status)) {
    return fail('STATE_CONFLICT', `This withdrawal is ${before.status.replace(/_/g, ' ')} and can no longer be approved.`, {
      details: { status: before.status },
    });
  }

  const adminToken = await forwardedAdminToken();
  if (!adminToken) return fail('AUTH_REQUIRED', 'Your session has expired. Sign in again.');

  const auditBase = {
    admin,
    action: 'APPROVE_WITHDRAWAL',
    entity: 'withdrawals',
    entity_id: id,
    user_id: before.user_id,
    before: { status: before.status },
    reason,
    sensitivity: 'financial' as const,
  };

  const { error: rpcErr } = await supabaseAdmin.rpc('admin_approve_withdrawal', {
    p_withdrawal_id: id,
    p_admin_id: admin.admin_id,
  });

  if (rpcErr) {
    await writeAudit({
      ...auditBase,
      after: { status: before.status, stage: 'state_transition' },
      result: 'failure',
      error: rpcErr.message,
    });
    console.error('admin_approve_withdrawal:', rpcErr.message);
    if (rpcErr.message.includes('Account is frozen')) {
      return fail('STATE_CONFLICT', FROZEN_APPROVAL, { details: { reason: 'account_frozen' } });
    }
    if (rpcErr.message.includes('Emergency mode is on')) {
      return fail('STATE_CONFLICT', EMERGENCY_APPROVAL, { details: { reason: 'emergency_mode' } });
    }
    return fail('STATE_CONFLICT', 'The withdrawal could not be moved out of review. Reload and try again.');
  }

  const payoutLookup = readPayoutGateway(supabaseAdmin);
  const url = `${process.env.SUPABASE_URL}/functions/v1/resume-withdrawal`;

  let gatewayReference: string | null = null;
  let gatewayError: string | null = null;
  let reachedGateway = false;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': process.env.ADMIN_FUNCTION_SECRET || '',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ withdrawal_id: id }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    reachedGateway = true;
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; gateway_reference?: string };
    if (!res.ok || !data?.success) {
      gatewayError = data?.message || `Gateway responded ${res.status}`;
    } else {
      gatewayReference = data.gateway_reference ?? null;
    }
  } catch (e) {
    gatewayError = e instanceof Error ? e.message : 'Gateway request failed';
  }

  const [after, payoutGateway] = await Promise.all([currentStatus(id), payoutLookup]);

  if (gatewayError) {
    await writeAudit({
      ...auditBase,
      after: {
        status: after,
        stage: 'gateway',
        gateway: before.gateway,
        payout_gateway: payoutGateway,
        reached_gateway: reachedGateway,
      },
      result: 'partial',
      error: gatewayError,
    });

    if (!reachedGateway) {
      return fail(
        'PROVIDER_ERROR',
        `The payout was released but the provider response never arrived. This withdrawal is now "${after ?? 'unknown'}". Check the provider before retrying — the transfer may already have been sent.`,
        { details: { status: after, stage: 'gateway_unreachable', gateway_error: gatewayError } },
      );
    }

    return fail('PROVIDER_ERROR', gatewayError, {
      details: { status: after, stage: 'gateway_rejected' },
    });
  }

  const audit = await writeAudit({
    ...auditBase,
    after: {
      status: after,
      gateway_reference: gatewayReference,
      amount: before.amount,
      fee: before.fee,
      gateway: before.gateway,
      payout_gateway: payoutGateway,
    },
    result: 'success',
  });

  return ok({
    gateway_reference: gatewayReference,
    status: after,
    audit_recorded: audit.ok,
    ...(audit.ok ? {} : { warning: 'The payout succeeded but could not be written to the audit log.' }),
  });
}
