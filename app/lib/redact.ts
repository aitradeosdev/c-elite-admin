

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
