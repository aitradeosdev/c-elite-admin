import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { requireSuperAdmin } from '../../../../lib/guard';
import { fail, isUuid, ok } from '../../../../lib/api';
import { NO_STORE, normalizeAuthMethods, type AuthMethod } from '../../../../lib/session';

const INVALID_ID = 'A valid admin account id is required.';
const LIST_FAILED = 'The signed-in devices could not be loaded. Try again.';

interface DeviceSession {
  id: string;
  client: 'web' | 'mobile';
  user_agent: string | null;
  ip: string | null;
  auth_methods: AuthMethod[];
  created_at: string | null;
  last_seen_at: string | null;
  expires_at: string | null;
  current: boolean;
}

type SessionList = { ok: true; rows: unknown[] } | { ok: false };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isUuid(id) ? id : null;
}

function toDevice(raw: unknown, currentId: string | null): DeviceSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (!isUuid(row.id)) return null;
  const id = row.id.toLowerCase();
  return {
    id,
    client: row.client === 'mobile' ? 'mobile' : 'web',
    user_agent: text(row.user_agent),
    ip: text(row.ip),
    auth_methods: normalizeAuthMethods(row.auth_methods),
    created_at: text(row.created_at),
    last_seen_at: text(row.last_seen_at),
    expires_at: text(row.expires_at),
    current: id === currentId,
  };
}

async function listSessions(adminId: string): Promise<SessionList> {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_sessions_list', { p_admin_id: adminId });
    if (error) {
      console.error('admin session list failed:', error.message);
      return { ok: false };
    }
    if (!Array.isArray(data)) {
      console.error('admin session list failed:', 'no rows were returned');
      return { ok: false };
    }
    return { ok: true, rows: data };
  } catch (error) {
    console.error('admin session list failed:', errorText(error));
    return { ok: false };
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const { id: raw } = await ctx.params;
  const target = readId(raw);
  if (!target) return fail('VALIDATION_ERROR', INVALID_ID);

  const listed = await listSessions(target);
  if (!listed.ok) return fail('INTERNAL_ERROR', LIST_FAILED);

  const own = target === admin.admin_id.toLowerCase();
  const currentId = own ? admin.session.id.toLowerCase() : null;
  const sessions = listed.rows
    .map((row) => toDevice(row, currentId))
    .filter((row): row is DeviceSession => row !== null)
    .sort((a, b) => Number(b.current) - Number(a.current));
  return ok({ sessions }, { headers: { ...NO_STORE } });
}
