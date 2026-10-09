import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/guard';
import { writeAudit, type AuditInput } from '../../../lib/audit';
import { fail, ok } from '../../../lib/api';

const VALID = new Set(['light', 'dark', 'system']);
const AUDIT_WARNING = 'Your theme was saved, but the change could not be written to the audit log.';

function readTheme(body: unknown): string {
  const value = body && typeof body === 'object' ? (body as { theme?: unknown }).theme : undefined;
  return String(value || '');
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const theme = readTheme(await req.json().catch(() => null));
  if (!VALID.has(theme)) {
    return fail('VALIDATION_ERROR', 'theme must be light | dark | system');
  }

  const audit: AuditInput = {
    admin,
    action: 'UPDATE_ADMIN_THEME',
    entity: 'admin_users',
    entity_id: admin.admin_id,
    after: { theme },
    sensitivity: 'security',
  };

  const { error } = await supabaseAdmin
    .from('admin_users')
    .update({ theme_preference: theme })
    .eq('id', admin.admin_id);
  if (error) {
    console.error('admin theme save failed:', error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', 'Your theme preference could not be saved. Try again.');
  }

  const recorded = await writeAudit({ ...audit, result: 'success' });

  const response = await ok({
    theme,
    ...(recorded.ok ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING }),
  });
  response.cookies.set('admin_theme', theme, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
  return response;
}
