import type { NextRequest, NextResponse } from 'next/server';
import { fail, ok } from '../../../../lib/api';
import { LINK_INVALID, checkLink, isLinkToken } from '../../../../lib/passwordLinks';
import { NO_STORE } from '../../../../lib/session';

const CHECK_UNAVAILABLE = 'This link could not be checked right now. Try again shortly.';

function tokenOf(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { token } = body as Record<string, unknown>;
  return isLinkToken(token) ? token : null;
}

function linkInvalid(): Promise<NextResponse> {
  return fail('STATE_CONFLICT', LINK_INVALID, { headers: { ...NO_STORE } });
}

export async function POST(req: NextRequest) {
  const token = tokenOf(await req.json().catch(() => null));
  if (!token) return linkInvalid();

  const checked = await checkLink(token);
  if (checked.kind === 'failed') return fail('INTERNAL_ERROR', CHECK_UNAVAILABLE, { headers: { ...NO_STORE } });
  if (checked.kind === 'invalid') return linkInvalid();

  const { purpose, username, email, expiresAt } = checked.link;
  return ok({ purpose, username, email, expires_at: expiresAt }, { headers: { ...NO_STORE } });
}
