import type { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '../../../../lib/guard';
import { writeAudit } from '../../../../lib/audit';
import { fail, isUuid, ok } from '../../../../lib/api';
import { issueAndSend, linksConfigured } from '../../../../lib/passwordLinks';

export const maxDuration = 30;

const ENTITY = 'admin_users';
const INVALID_ADMIN = 'A valid admin account id is required.';
const NOT_SET_UP = 'Invitations are not set up on the server, so nothing was sent.';
const NOT_FOUND = 'Admin account not found.';
const INACTIVE = 'Reactivate this account before sending a new invitation.';
const PASSWORD_SET = 'This admin has already chosen a password.';
const NO_EMAIL = 'Add an email address first.';
const UNAVAILABLE = 'The invitation could not be sent right now. Try again shortly.';

function readId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isUuid(id) ? id : null;
}

function refusal(reason: string | null): Promise<NextResponse> {
  switch (reason) {
    case 'not_found':
      return fail('RESOURCE_NOT_FOUND', NOT_FOUND);
    case 'inactive':
      return fail('STATE_CONFLICT', INACTIVE);
    case 'password_set':
      return fail('STATE_CONFLICT', PASSWORD_SET);
    case 'no_email':
      return fail('STATE_CONFLICT', NO_EMAIL);
    default:
      return fail('INTERNAL_ERROR', UNAVAILABLE);
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const { id: raw } = await ctx.params;
  const id = readId(raw);
  if (!id) return fail('VALIDATION_ERROR', INVALID_ADMIN);
  if (!linksConfigured()) return fail('INTERNAL_ERROR', NOT_SET_UP);

  const issued = await issueAndSend({ adminId: id, purpose: 'invite', inviter: admin.username });
  if (issued.expiresAt === null) return refusal(issued.reason);

  await writeAudit({
    admin,
    action: 'ADMIN_INVITE_SENT',
    entity: ENTITY,
    entity_id: id,
    after: { outcome: issued.outcome, expires_at: issued.expiresAt, resend: true },
    result: issued.outcome === 'sent' ? 'success' : 'failure',
    error: issued.outcome === 'sent' ? null : issued.reason,
    sensitivity: 'security',
  });
  return ok({ invite: { outcome: issued.outcome, expires_at: issued.expiresAt } });
}
