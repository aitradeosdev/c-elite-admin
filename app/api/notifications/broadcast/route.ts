import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdmin, requireAdminAny } from '../../../lib/guard';
import { writeAudit, type AuditInput } from '../../../lib/audit';
import { buildPagination, fail, ok, parsePageParams } from '../../../lib/api';
import {
  CONFIG_KEYS, DUPLICATE_ACTION, DUPLICATE_WINDOW_SECONDS, EDGE_TIMEOUT_MS, HISTORY_MAX_PAGE_SIZE, HISTORY_PAGE_SIZE,
  NOT_CONFIGURED_MESSAGE, READ_PERMISSION, SEND_PERMISSIONS, classifyEdgeFailure, classifyEdgeResponse, duplicateKey,
  duplicateMessage, edgeOutcomeMessage, globalsFromConfig, readBroadcastRequest, sendDeniedMessage, sendPermission,
  type BroadcastRequest, type ConfigRow, type EdgeOutcome, type SendCounts,
} from '../../../(dashboard)/notifications-broadcast/broadcastRules';

export const maxDuration = 60;

const AUDIT_WARNING = 'The broadcast was sent, but it could not be written to the audit log.';

function edgeUrl(): string | null {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}/functions/v1/broadcast-notification` : null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function callEdge(url: string, secret: string, payload: Record<string, unknown>): Promise<EdgeOutcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(EDGE_TIMEOUT_MS),
    });
  } catch (error) {
    return classifyEdgeFailure(error);
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    return classifyEdgeFailure(error);
  }
  return classifyEdgeResponse(response.status, parseJson(raw));
}

async function duplicateStartedAt(key: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('anon_rate_limits')
    .select('window_start')
    .eq('key', key)
    .eq('action', DUPLICATE_ACTION)
    .maybeSingle<{ window_start: string | null }>();
  if (error) {
    console.error('broadcast duplicate lookup:', error.message);
    return null;
  }
  return data?.window_start ?? null;
}

async function releaseDuplicateKey(key: string): Promise<void> {
  const { error } = await supabaseAdmin.from('anon_rate_limits').delete().eq('key', key).eq('action', DUPLICATE_ACTION);
  if (error) console.error('broadcast duplicate release:', error.message);
}

function attemptRecord(request: BroadcastRequest) {
  return {
    title: request.title,
    message: request.message,
    type: request.type,
    audience: request.audience,
    target_user_id: request.target_user_id,
    allow_duplicate: request.allow_duplicate,
  };
}

function countFields(counts: SendCounts) {
  return {
    broadcast_id: counts.broadcastId,
    recipient_count: counts.recipients,
    delivered: counts.delivered,
    failed: counts.failed,
    anonymous_recipient_count: counts.anonymousRecipients,
    anonymous_delivered: counts.anonymousDelivered,
    anonymous_failed: counts.anonymousFailed,
  };
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(READ_PERMISSION);
  if (!guard.ok) return guard.response;

  const { page, pageSize, from, to } = parsePageParams(new URL(req.url), {
    defaultSize: HISTORY_PAGE_SIZE,
    maxSize: HISTORY_MAX_PAGE_SIZE,
  });

  const [history, config] = await Promise.all([
    supabaseAdmin
      .from('notification_broadcasts')
      .select('*', { count: 'exact' })
      .order('sent_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    supabaseAdmin.from('app_config').select('key, value').in('key', [...CONFIG_KEYS]),
  ]);

  if (history.error) {
    if (history.error.code === 'PGRST103') {
      return ok({ broadcasts: [], variables: null }, { pagination: buildPagination(page, pageSize, null) });
    }
    console.error('broadcast history read:', history.error.message);
    return fail('INTERNAL_ERROR', 'The broadcast history could not be loaded. Try again.');
  }
  if (config.error) console.error('broadcast variables read:', config.error.message);

  return ok(
    {
      broadcasts: history.data ?? [],
      variables: config.error ? null : globalsFromConfig((config.data ?? []) as ConfigRow[]),
    },
    { pagination: buildPagination(page, pageSize, history.count ?? null) },
  );
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminAny(SEND_PERMISSIONS);
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const checked = readBroadcastRequest(await req.json().catch(() => null));
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const request = checked.value;

  const permission = sendPermission(request.audience);
  if (!admin.can(permission)) {
    return fail('PERMISSION_DENIED', sendDeniedMessage(request.audience), { details: { required: [permission] } });
  }

  const url = edgeUrl();
  const secret = process.env.ADMIN_FUNCTION_SECRET || '';
  if (!url || !secret) {
    console.error('broadcast: SUPABASE_URL or ADMIN_FUNCTION_SECRET is not set');
    return fail('PROVIDER_ERROR', NOT_CONFIGURED_MESSAGE, {
      details: { outcome: 'not_sent', reason: 'misconfigured', edge_status: null },
    });
  }

  if (request.target_user_id) {
    const { data: target, error: targetError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', request.target_user_id)
      .maybeSingle();
    if (targetError) {
      console.error('broadcast target read:', targetError.message);
      return fail('INTERNAL_ERROR', 'The user could not be checked, so nothing was sent. Try again.');
    }
    if (!target) return fail('RESOURCE_NOT_FOUND', 'That user no longer exists, so nothing was sent.');
  }

  const audit: AuditInput = {
    admin,
    action: 'BROADCAST_NOTIFICATION',
    entity: 'notification_broadcasts',
    user_id: request.target_user_id,
    sensitivity: 'normal',
  };
  const attempt = attemptRecord(request);

  const key = await duplicateKey(request);
  if (!request.allow_duplicate) {
    const { data: allowed, error: guardError } = await supabaseAdmin.rpc('check_rate_limit_by_key', {
      p_key: key,
      p_action: DUPLICATE_ACTION,
      p_limit: 1,
      p_window_secs: DUPLICATE_WINDOW_SECONDS,
    });
    if (guardError || typeof allowed !== 'boolean') {
      console.error('broadcast duplicate check:', guardError?.message ?? 'no answer');
      return fail('INTERNAL_ERROR', 'The repeat-send check could not run, so nothing was sent. Try again in a moment.');
    }
    if (!allowed) {
      const startedAt = await duplicateStartedAt(key);
      await writeAudit({ ...audit, after: attempt, result: 'failure', error: 'duplicate_blocked' });
      return fail('IDEMPOTENCY_CONFLICT', duplicateMessage(startedAt), {
        details: { outcome: 'duplicate', first_sent_at: startedAt, window_seconds: DUPLICATE_WINDOW_SECONDS },
      });
    }
  }

  const outcome = await callEdge(url, secret, {
    title: request.title,
    message: request.message,
    type: request.type,
    audience: request.audience,
    target_user_id: request.target_user_id,
    admin_id: admin.admin_id,
  });

  if (outcome.kind === 'sent') {
    const fields = countFields(outcome.counts);
    const recorded = await writeAudit({
      ...audit,
      entity_id: outcome.counts.broadcastId,
      after: { ...attempt, ...fields },
      result: 'success',
    });
    return ok({
      ...fields,
      ...(recorded.ok ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING }),
    });
  }

  const message = edgeOutcomeMessage(outcome);

  if (outcome.kind === 'not_sent') {
    if (!request.allow_duplicate) await releaseDuplicateKey(key);
    await writeAudit({
      ...audit,
      after: attempt,
      result: 'failure',
      error: `not_sent:${outcome.reason}${outcome.status === null ? '' : ` HTTP ${outcome.status}`}${outcome.detail ? ` ${outcome.detail}` : ''}`,
    });
    return fail('PROVIDER_ERROR', message, {
      details: { outcome: 'not_sent', reason: outcome.reason, edge_status: outcome.status },
    });
  }

  await writeAudit({
    ...audit,
    after: attempt,
    result: 'partial',
    error: `unknown:${outcome.stage}${outcome.status === null ? '' : ` HTTP ${outcome.status}`}`,
  });
  return fail('PROVIDER_ERROR', message, {
    status: outcome.stage === 'timeout' ? 504 : 502,
    details: { outcome: 'unknown', stage: outcome.stage, edge_status: outcome.status },
  });
}
