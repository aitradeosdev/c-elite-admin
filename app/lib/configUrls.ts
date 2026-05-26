export const URL_CONFIG_KEYS = new Set<string>([
  'live_chat_url', 'terms_url', 'privacy_url', 'store_url_android', 'store_url_ios',
]);

const URL_MAX_LEN = 2048;
const URL_RE = /^https:\/\/[^\s<>"']{3,}$/i;
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

export function validateConfigUrl(key: string, rawValue: unknown): string | null {
  if (!URL_CONFIG_KEYS.has(key)) return null;
  const raw = String(rawValue ?? '');
  if (raw.length === 0) return null;
  if (raw.length > URL_MAX_LEN) return `${key} exceeds ${URL_MAX_LEN} characters`;
  if (CONTROL_RE.test(raw)) return `${key} contains disallowed characters`;
  if (!URL_RE.test(raw)) return `${key} must be a valid https:// URL`;
  return null;
}
