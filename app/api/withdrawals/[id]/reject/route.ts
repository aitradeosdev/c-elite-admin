import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { requireAdmin } from '../../../../lib/guard';
import { writeAudit } from '../../../../lib/audit';
import { ok, fail, isUuid } from '../../../../lib/api';

const REJECTABLE = ['pending_review', 'held', 'initiated'];

interface WithdrawalRow {
  status: string;
  amount: number | null;
  user_id: string | null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin('withdrawals.reject');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fail('VALIDATION_ERROR', 'Invalid withdrawal id.');

  const body = await req.json().catch(() => ({}));
  const reason = String((body as { reason?: unknown })?.reason || '').trim().slice(0, 500);
  if (!reason) return fail('VALIDATION_ERROR', 'A rejection reason is required.');

  const { data: before, error: readErr } = await supabaseAdmin
    .from('withdrawals')
    .select('status, amount, user_id')
    .eq('id', id)
    .maybeSingle<WithdrawalRow>();

  if (readErr) return fail('INTERNAL_ERROR', 'Could not read the withdrawal.');
  if (!before) return fail('RESOURCE_NOT_FOUND', 'Withdrawal not found.');
  if (!REJECTABLE.includes(before.status)) {
    return fail('STATE_CONFLICT', `This withdrawal is ${before.status.replace(/_/g, ' ')} and can no longer be rejected.`, {
      details: { status: before.status },
    });
  }

  const auditBase = {
    admin,
    action: 'REJECT_WITHDRAWAL',
    entity: 'withdrawals',
    entity_id: id,
    user_id: before.user_id,
    before: { status: before.status },
    reason,
    sensitivity: 'financial' as const,
  };

  const { error: rpcErr } = await supabaseAdmin.rpc('admin_reject_withdrawal', {
    p_withdrawal_id: id,
    p_admin_id: admin.admin_id,
    p_reason: reason,
  });

  if (rpcErr) {
    await writeAudit({ ...auditBase, after: { status: before.status }, result: 'failure', error: rpcErr.message });
    console.error('admin_reject_withdrawal:', rpcErr.message);
    return fail('STATE_CONFLICT', 'The withdrawal could not be rejected. Reload and try again.');
  }

  const { data: after } = await supabaseAdmin
    .from('withdrawals')
    .select('status')
    .eq('id', id)
    .maybeSingle<{ status: string }>();

  const audit = await writeAudit({
    ...auditBase,
    after: { status: after?.status ?? null, refunded_amount: before.amount },
    result: 'success',
  });

  return ok({
    status: after?.status ?? null,
    audit_recorded: audit.ok,
    ...(audit.ok ? {} : { warning: 'The rejection succeeded but could not be written to the audit log.' }),
  });
}
