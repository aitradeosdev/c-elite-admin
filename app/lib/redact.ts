// Redact known-sensitive keys before they hit audit_log.
//
// audit_log.before_value / after_value JSONB is now surfaced to super admins
// via the mobile Activity tab's detail modal (list_admin_activity RPC returns
// both columns, the UI pretty-prints them). Anything we put in there is
// readable by every active super admin — so credentials, tokens, OTPs, etc.
// must be stripped first.
//
// Use:
//   import { redactAudit } from '../../lib/redact';
//   ...
//   await supabaseAdmin.from('audit_log').insert({
//     ...,
//     before_value: redactAudit(before),
//     after_value:  redactAudit(updates),
//   });

const SENSITIVE_KEYS = new Set<string>([
  'password',
  'password_hash',
  'pin',
  'pin_hash',
  'secret',
  'admin_function_secret',
  'admin_token',
  'release_secret',
  'otp',
  'otp_code',
  'token',
  'refresh_token',
  'api_key',
  'paystack_secret_key',
  'monnify_secret_key',
  'vtpass_api_key',
  'smtp_password',
]);

const PLACEHOLDER = '[redacted]';

/**
 * Recursively replace the value of any sensitive key with '[redacted]'.
 * Returns a shallow clone (input is never mutated) so the caller can still
 * use the original `updates` object for the actual `.update(...)` write.
 * Handles arrays + nested objects. Null / primitives pass through unchanged.
 */
export function redactAudit<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    return input.map((item) => redactAudit(item)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = PLACEHOLDER;
      } else {
        out[k] = redactAudit(v);
      }
    }
    return out as unknown as T;
  }
  return input;
}
