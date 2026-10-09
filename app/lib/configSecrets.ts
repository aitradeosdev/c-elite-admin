export const SECRET_CONFIG_KEYS: readonly string[] = ['chatwoot_identity_key'];

export const SETTINGS_ONLY_CONFIG_KEYS: readonly string[] = ['chatwoot_identity_key', 'emergency_mode'];

const SECRET_SET: ReadonlySet<string> = new Set(SECRET_CONFIG_KEYS);

export function isSecretConfigKey(key: string): boolean {
  return SECRET_SET.has(key);
}
