import type { NextRequest } from 'next/server';
import { requireAdmin } from '../../lib/guard';
import { fail, ok } from '../../lib/api';
import { callRateSync, readRateSync, refuse, writeDenied } from '../../lib/rateSync';
import { readProviderRegistry } from '../../lib/rateService';
import {
  TEXT, isNotAuthorized, providerRefusal, readSwitchBody, serviceRefusal, webOnlyText,
} from '../../(dashboard)/automatic-rates/rules';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function conflict(current: boolean) {
  return fail('STATE_CONFLICT', current ? TEXT.conflictOn : TEXT.conflictOff, {
    details: { reason: 'conflict', enabled: current },
  });
}

function unconfirmed() {
  return fail('INTERNAL_ERROR', TEXT.switchUnconfirmed, { details: { outcome_unknown: true } });
}

export async function GET() {
  const guard = await requireAdmin('rates.read');
  if (!guard.ok) return guard.response;

  const status = await readRateSync('rate_sync_status');
  if (!status) return fail('INTERNAL_ERROR', TEXT.statusFailed);
  return ok({ automatic: status });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('rates.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const checked = readSwitchBody(await req.json().catch(() => null));
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const { enabled, expected } = checked.value;

  if (enabled) {
    if (admin.session.client !== 'web') return fail('PERMISSION_DENIED', webOnlyText('turn_on'));
    const status = await readRateSync('rate_sync_status');
    if (!status || typeof status.enabled !== 'boolean') return refuse(serviceRefusal('not_checked', 'turn_on'));
    if (status.enabled !== expected) return conflict(status.enabled);
    if (status.provider === null) return fail('STATE_CONFLICT', TEXT.switchNoProvider, { details: { reason: 'no_provider' } });
    if (typeof status.provider !== 'string') return refuse(serviceRefusal('not_checked', 'turn_on'));
    const registry = await readProviderRegistry('automatic rates turn on');
    if (!registry.ok) return refuse(serviceRefusal(registry.failure, 'turn_on'));
    const refused = providerRefusal(registry.providers, status.provider, 'turn_on');
    if (refused) return refuse(refused);
  }

  const result = await callRateSync('admin_rate_sync_settings_set', {
    p_admin_id: admin.admin_id,
    p_changes: { enabled },
    p_expected: { enabled: expected },
    p_ip: admin.ip,
    p_user_agent: admin.user_agent,
    p_request_id: admin.request_id,
  });
  if (!result.ok) {
    if (isNotAuthorized(result.message)) return writeDenied();
    console.error('admin_rate_sync_settings_set:', result.message);
    return unconfirmed();
  }

  const answer = isRecord(result.data) ? result.data : null;
  const settings = answer && isRecord(answer.settings) ? answer.settings : null;
  if (answer?.ok === true) {
    if (!settings || typeof settings.enabled !== 'boolean' || !Array.isArray(answer.changed)) return unconfirmed();
    const status = await readRateSync('rate_sync_status');
    return ok({ enabled: settings.enabled, changed: answer.changed, ...(status ? { automatic: status } : {}) });
  }
  switch (answer?.reason) {
    case 'conflict':
      return settings && typeof settings.enabled === 'boolean' ? conflict(settings.enabled) : unconfirmed();
    case 'no_provider':
      return fail('STATE_CONFLICT', TEXT.switchNoProvider, { details: { reason: 'no_provider' } });
    case 'no_links':
      return fail('STATE_CONFLICT', TEXT.switchNoLinks, { details: { reason: 'no_links' } });
    case 'invalid':
      return fail('VALIDATION_ERROR', TEXT.switchBody);
  }
  console.error('admin_rate_sync_settings_set: the answer did not have the expected shape');
  return unconfirmed();
}
