import type { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase';
import { redactAudit } from './redact';
import { fail } from './api';
import type { AdminContext } from './guard';

export type AuditResult = 'success' | 'failure' | 'partial';

export type AuditSensitivity = 'normal' | 'financial' | 'security' | 'sensitive';

export interface AuditInput {
  admin: Pick<AdminContext, 'admin_id' | 'role_title' | 'ip' | 'user_agent' | 'request_id'> | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  user_id?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  result?: AuditResult;
  error?: string | null;
  sensitivity?: AuditSensitivity;
}

export interface AuditOutcome {
  ok: boolean;
  error?: string;
  degraded?: boolean;
}

const EXTENDED_COLUMNS = ['admin_role', 'user_agent', 'request_id', 'reason', 'result', 'error', 'sensitivity'] as const;

let extendedSchema: boolean | null = null;

function isMissingColumn(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes('does not exist') || m.includes('could not find') || m.includes('unknown column')) {
    return EXTENDED_COLUMNS.some((c) => m.includes(c));
  }
  return false;
}

function baseRow(input: AuditInput) {
  return {
    admin_id: input.admin?.admin_id ?? null,
    user_id: input.user_id ?? null,
    action: input.action,
    entity: input.entity,
    entity_id: input.entity_id ?? null,
    before_value: input.before === undefined ? null : redactAudit(input.before),
    after_value: input.after === undefined ? null : redactAudit(input.after),
    ip_address: input.admin?.ip ?? null,
  };
}

function extendedRow(input: AuditInput) {
  return {
    ...baseRow(input),
    admin_role: input.admin?.role_title ?? null,
    user_agent: input.admin?.user_agent || null,
    request_id: input.admin?.request_id ?? null,
    reason: input.reason ?? null,
    result: input.result ?? 'success',
    error: input.error ?? null,
    sensitivity: input.sensitivity ?? 'normal',
  };
}

function foldedRow(input: AuditInput) {
  const row = baseRow(input);
  const meta = {
    admin_role: input.admin?.role_title ?? null,
    user_agent: input.admin?.user_agent || null,
    request_id: input.admin?.request_id ?? null,
    reason: input.reason ?? null,
    result: input.result ?? 'success',
    error: input.error ?? null,
    sensitivity: input.sensitivity ?? 'normal',
  };
  const after = row.after_value;
  return {
    ...row,
    after_value:
      after && typeof after === 'object' && !Array.isArray(after)
        ? { ...(after as Record<string, unknown>), __meta: meta }
        : { value: after ?? null, __meta: meta },
  };
}

export async function writeAudit(input: AuditInput): Promise<AuditOutcome> {
  if (extendedSchema !== false) {
    const { error } = await supabaseAdmin.from('audit_log').insert(extendedRow(input));
    if (!error) {
      extendedSchema = true;
      return { ok: true };
    }
    if (!isMissingColumn(error.message || '')) {
      console.error('audit_log insert failed:', input.action, error.message);
      return { ok: false, error: error.message };
    }
    extendedSchema = false;
  }

  const { error } = await supabaseAdmin.from('audit_log').insert(foldedRow(input));
  if (error) {
    console.error('audit_log insert failed:', input.action, error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, degraded: true };
}

export async function writeAuditOrFail(input: AuditInput): Promise<NextResponse | null> {
  const outcome = await writeAudit(input);
  if (outcome.ok) return null;
  return fail(
    'AUDIT_FAILED',
    'The action completed but could not be recorded in the audit log. Notify an administrator before retrying.',
    { details: { action: input.action, entity: input.entity, entity_id: input.entity_id ?? null } },
  );
}
