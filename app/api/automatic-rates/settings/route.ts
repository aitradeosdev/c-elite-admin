import type { NextRequest } from 'next/server';
import { requireAdmin } from '../../../lib/guard';
import { fail, ok } from '../../../lib/api';
import { callRateSync, readRateSync, refuse, writeDenied } from '../../../lib/rateSync';
import { readProviderRegistry } from '../../../lib/rateService';
import {
  TEXT, consoleSettingKey, invalidSetting, isNotAuthorized, providerRefusal, rateOutOfRangeText, readSettingsRequest,
  serviceRefusal, settingsConfig, webOnlyText,
} from '../../../(dashboard)/automatic-rates/rules';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function notSaved() {
  return fail('INTERNAL_ERROR', TEXT.settingsNotSaved, { details: { outcome_unknown: true } });
}

function consoleConflicts(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => (isRecord(item) ? { key: consoleSettingKey(item.key), current: item.current } : item));
}

export async function GET() {
  const guard = await requireAdmin('rates.read');
  if (!guard.ok) return guard.response;

  const status = await readRateSync('rate_sync_status');
  const config = status ? settingsConfig(status) : null;
  if (!config) {
    if (status) console.error('rate_sync_status: the settings did not have the expected shape');
    return fail('INTERNAL_ERROR', TEXT.settingsFailed);
  }
  return ok({ config });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('rates.write');
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const checked = readSettingsRequest(await req.json().catch(() => null));
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const { changes, expected, keys } = checked.value;

  if (keys.includes('rate_provider')) {
    if (admin.session.client !== 'web') return fail('PERMISSION_DENIED', webOnlyText('provider'));
    const provider = changes.provider;
    if (typeof provider === 'string') {
      const registry = await readProviderRegistry('automatic rates provider');
      if (!registry.ok) return refuse(serviceRefusal(registry.failure, 'provider'));
      const refused = providerRefusal(registry.providers, provider, 'provider');
      if (refused) return refuse(refused);
    }
  }

  const result = await callRateSync('admin_rate_sync_settings_set', {
    p_admin_id: admin.admin_id,
    p_changes: changes,
    p_expected: expected,
    p_ip: admin.ip,
    p_user_agent: admin.user_agent,
    p_request_id: admin.request_id,
  });
  if (!result.ok) {
    if (isNotAuthorized(result.message)) return writeDenied();
    console.error('admin_rate_sync_settings_set:', result.message);
    return notSaved();
  }

  const answer = isRecord(result.data) ? result.data : null;
  if (answer?.ok === true) {
    const config = settingsConfig(answer.settings);
    if (!config || !Array.isArray(answer.changed) || typeof answer.repriced !== 'number') return notSaved();
    return ok({ config, changed: answer.changed.map(consoleSettingKey), repriced: answer.repriced });
  }
  switch (answer?.reason) {
    case 'invalid':
      return fail('VALIDATION_ERROR', typeof answer.key === 'string' ? invalidSetting(consoleSettingKey(answer.key)) : TEXT.settingsNoChanges);
    case 'conflict':
      return fail('STATE_CONFLICT', TEXT.settingsChanged, { details: { reason: 'conflict', conflicts: consoleConflicts(answer.conflicts) } });
    case 'turn_off_first':
      return fail('STATE_CONFLICT', TEXT.settingsTurnOffFirst, { details: { reason: 'turn_off_first' } });
    case 'rate_out_of_range':
      return fail('STATE_CONFLICT', rateOutOfRangeText(answer), {
        details: { reason: 'rate_out_of_range', range_label: answer.range_label, card_type_id: answer.card_type_id },
      });
  }
  console.error('admin_rate_sync_settings_set: the answer did not have the expected shape');
  return notSaved();
}
