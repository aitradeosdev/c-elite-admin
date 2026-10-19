import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin } from '../../lib/guard';
import { writeAudit, type AuditInput } from '../../lib/audit';
import { fail, ok } from '../../lib/api';
import {
  EMAIL_CHANNEL,
  planTemplateEdit,
  presentTemplate,
  readTemplatePatch,
  toTemplateRecord,
  type TemplateRecord,
} from '../../(dashboard)/notification-templates/templateRules';

const CHANNEL = EMAIL_CHANNEL;
const COLUMNS = 'key, subject, html, description, variables, is_active, updated_at';
const SAVE_ATTEMPTS = 3;
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const ADMIN_TEMPLATE_PREFIX = 'admin_';
const ADMIN_TEMPLATES_DENIED = 'Only super administrators can change admin email templates.';

type TemplateRead = { ok: true; template: TemplateRecord | null } | { ok: false };

async function readTemplate(key: string): Promise<TemplateRead> {
  const { data, error } = await supabaseAdmin.from(CHANNEL.table).select(COLUMNS).eq('key', key).maybeSingle();
  if (error) {
    console.error('email template read:', error.message);
    return { ok: false };
  }
  if (!data) return { ok: true, template: null };
  const template = toTemplateRecord(CHANNEL, data);
  return template ? { ok: true, template } : { ok: false };
}

function auditFields(recorded: boolean) {
  return recorded ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING };
}

export async function GET() {
  const guard = await requireAdmin('email_templates.read');
  if (!guard.ok) return guard.response;

  const { data, error } = await supabaseAdmin
    .from(CHANNEL.table)
    .select(COLUMNS)
    .order('key', { ascending: true });

  if (error) {
    console.error('email templates list:', error.message);
    return fail('INTERNAL_ERROR', 'The email templates could not be loaded.');
  }
  return ok({ templates: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('email_templates.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const body: unknown = await req.json().catch(() => null);
  const parsed = readTemplatePatch(CHANNEL, body);
  if (!parsed.ok) return fail('VALIDATION_ERROR', parsed.message);
  const { request } = parsed;
  if (request.key.startsWith(ADMIN_TEMPLATE_PREFIX) && !admin.is_super_admin) {
    return fail('PERMISSION_DENIED', ADMIN_TEMPLATES_DENIED);
  }

  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    const read = await readTemplate(request.key);
    if (!read.ok) return fail('INTERNAL_ERROR', 'The template could not be read, so nothing was changed.');
    const current = read.template;
    if (!current) return fail('RESOURCE_NOT_FOUND', 'Template not found');

    const planned = planTemplateEdit(CHANNEL, current, request);
    if (!planned.ok) return fail(planned.code, planned.message, { details: planned.details });
    const { plan } = planned;
    if (plan.changed.length === 0) {
      return ok({ changed: false, template: presentTemplate(CHANNEL, current) });
    }

    const audit: AuditInput = {
      admin,
      action: CHANNEL.action,
      entity: CHANNEL.table,
      entity_id: current.key,
      before: plan.before,
      after: plan.after,
      reason: request.reason,
    };

    const changes = { ...plan.updates, updated_at: new Date().toISOString(), updated_by: admin.admin_id };
    const scoped = supabaseAdmin.from(CHANNEL.table).update(changes).eq('key', current.key);
    const { data, error } = await (current.updatedAt === null
      ? scoped.is('updated_at', null)
      : scoped.eq('updated_at', current.updatedAt)
    ).select(COLUMNS);

    if (error) {
      console.error('email template update:', error.message);
      await writeAudit({ ...audit, result: 'failure', error: error.message });
      return fail('INTERNAL_ERROR', 'The template could not be saved. Nothing was changed.');
    }

    const rows: unknown[] = Array.isArray(data) ? data : [];
    if (rows.length === 0) continue;

    const saved = toTemplateRecord(CHANNEL, rows[0]);
    const recorded = await writeAudit({ ...audit, result: 'success' });
    return ok({
      changed: true,
      template: saved ? presentTemplate(CHANNEL, saved) : null,
      ...auditFields(recorded.ok),
    });
  }

  return fail('STATE_CONFLICT', 'This template kept changing while it was being saved. Reload it and try again.');
}
