import { requireAdminAny } from '../../../lib/guard';
import { fail, ok } from '../../../lib/api';
import { NO_STORE } from '../../../lib/session';
import {
  PASS_PERMISSIONS,
  isWebSession,
  passTimes,
  passTopics,
  realtimeSettings,
  signRealtimePass,
} from '../../../lib/realtimePass';

export async function POST() {
  const guard = await requireAdminAny(PASS_PERMISSIONS);
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  if (!isWebSession(admin.session)) return fail('PERMISSION_DENIED');

  const settings = realtimeSettings();
  if (!settings) return ok({ enabled: false }, { headers: { ...NO_STORE } });

  const times = passTimes(Date.now(), admin.session.expiresAt);
  if (!times) return ok({ enabled: false }, { headers: { ...NO_STORE } });

  const topics = passTopics(admin.can);
  const token = await signRealtimePass(settings.secret, topics, times).catch(() => null);
  if (token === null) {
    console.error('realtime pass signing failed');
    return fail('INTERNAL_ERROR');
  }

  return ok({
    enabled: true,
    url: settings.url,
    key: settings.key,
    token,
    issued_at: times.issuedAt,
    expires_at: times.expiresAt,
    topics,
  }, { headers: { ...NO_STORE } });
}
