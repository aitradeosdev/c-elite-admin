import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const MFA_KEY_VERSION = 1;

const KEY_ENV = 'ADMIN_MFA_ENCRYPTION_KEY';
const MAX_KEY_VERSION = 1000;
const KEY_BYTES = 32;
const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const SEALED_PATTERN = /^(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ADMIN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AAD_PREFIX = 'cardelite-admin-mfa';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SECRET_BYTES = 20;
const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW_STEPS = 1;
const CODE_PATTERN = /^[0-9]{6}$/;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32_PATTERN = /^[A-Z2-7]+$/;
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_LENGTH = 10;
const RECOVERY_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const RECOVERY_COUNT = 10;
const MAX_RECOVERY_COUNT = 16;
const MAX_RECOVERY_INPUT = 64;
const PEPPER_SALT = 'cardelite-admin';
const CHALLENGE_BYTES = 32;

export class MfaUnavailableError extends Error {
  readonly variable: string;

  constructor(variable: string, problem: string) {
    super(`${variable} ${problem}`);
    this.name = 'MfaUnavailableError';
    this.variable = variable;
  }
}

function keyEnvName(version: number): string {
  return version === 1 ? KEY_ENV : `${KEY_ENV}_V${version}`;
}

export function mfaKey(version: number = MFA_KEY_VERSION): Buffer {
  if (!Number.isInteger(version) || version < 1 || version > MAX_KEY_VERSION) {
    throw new MfaUnavailableError(KEY_ENV, `version must be a whole number from 1 to ${MAX_KEY_VERSION}`);
  }
  const name = keyEnvName(version);
  const value = (process.env[name] ?? '').trim();
  if (!value) throw new MfaUnavailableError(name, 'is not set');
  const key = KEY_PATTERN.test(value) ? Buffer.from(value, 'base64') : null;
  if (!key || key.length !== KEY_BYTES) {
    throw new MfaUnavailableError(name, 'must be 44 characters of standard base64 (32 bytes)');
  }
  return key;
}

export function isMfaKeyConfigured(version: number = MFA_KEY_VERSION): boolean {
  try {
    mfaKey(version);
    return true;
  } catch (error) {
    if (error instanceof MfaUnavailableError) return false;
    throw error;
  }
}

function assertAdminId(adminId: string): void {
  if (typeof adminId !== 'string' || !ADMIN_ID_PATTERN.test(adminId)) {
    throw new TypeError('The admin id must be a lower-case uuid');
  }
}

function secretAad(adminId: string, keyVersion: number): Buffer {
  return Buffer.from(`${AAD_PREFIX}:v${keyVersion}:${adminId}`, 'utf8');
}

export function sealSecret(secret: Uint8Array, adminId: string, keyVersion: number): string {
  const key = mfaKey(keyVersion);
  assertAdminId(adminId);
  if (!(secret instanceof Uint8Array) || secret.length === 0) {
    throw new TypeError('The two-step secret must be non-empty bytes');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(secretAad(adminId, keyVersion));
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
}

export function openSecret(sealed: string, adminId: string, keyVersion: number): Buffer {
  const key = mfaKey(keyVersion);
  assertAdminId(adminId);
  if (typeof sealed !== 'string' || !SEALED_PATTERN.test(sealed)) {
    throw new Error('The sealed two-step secret is not standard base64');
  }
  const raw = Buffer.from(sealed, 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES + 1) throw new Error('The sealed two-step secret is too short');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
  decipher.setAAD(secretAad(adminId, keyVersion));
  decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
}

export function newTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function groupKey(base32: string): string {
  return (base32.match(/.{1,4}/g) ?? []).join(' ');
}

function hotp(secret: Uint8Array, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function matchTotp(secret: Uint8Array, code: string, nowMs: number = Date.now()): number | null {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code) || !Number.isFinite(nowMs) || secret.length === 0) {
    return null;
  }
  const given = Buffer.from(code, 'utf8');
  const current = Math.floor(nowMs / 1000 / STEP_SECONDS);
  let found: number | null = null;
  for (let delta = -WINDOW_STEPS; delta <= WINDOW_STEPS; delta += 1) {
    const step = current + delta;
    if (step < 0) continue;
    const candidate = Buffer.from(hotp(secret, step), 'utf8');
    if (timingSafeEqual(candidate, given) && found === null) found = step;
  }
  return found;
}

export function otpauthUri(username: string, secretBase32: string): string {
  if (!BASE32_PATTERN.test(secretBase32)) throw new TypeError('The secret must be unpadded upper-case base32');
  return `otpauth://totp/CardElite%20Admin:${encodeURIComponent(username)}?secret=${secretBase32}&issuer=CardElite%20Admin&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

export function newRecoveryCodes(count: number = RECOVERY_COUNT): string[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_RECOVERY_COUNT) {
    throw new RangeError(`Recovery codes come in sets of 1 to ${MAX_RECOVERY_COUNT}`);
  }
  const codes = new Set<string>();
  while (codes.size < count) {
    let code = '';
    for (const byte of randomBytes(RECOVERY_LENGTH)) code += RECOVERY_ALPHABET[byte & 31];
    codes.add(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return [...codes];
}

export function normalizeRecoveryCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > MAX_RECOVERY_INPUT) return null;
  const compact = input.replace(/[\s-]+/g, '');
  if (!/^[0-9A-Za-z]{10}$/.test(compact)) return null;
  const code = compact.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');
  return RECOVERY_PATTERN.test(code) ? code : null;
}

function recoveryPepper(keyVersion: number): Buffer {
  const pepper = hkdfSync(
    'sha256',
    mfaKey(keyVersion),
    Buffer.from(PEPPER_SALT, 'utf8'),
    Buffer.from(`recovery-code-pepper:v${keyVersion}`, 'utf8'),
    KEY_BYTES,
  );
  return Buffer.from(pepper);
}

export function hashRecoveryCode(code: string, adminId: string, keyVersion: number): string {
  const pepper = recoveryPepper(keyVersion);
  assertAdminId(adminId);
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) throw new TypeError('The recovery code is not valid');
  return createHmac('sha256', pepper).update(`${adminId}:${normalized}`, 'utf8').digest('hex');
}

export function hashChallengeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newChallengeToken(): { token: string; hash: string } {
  const token = randomBytes(CHALLENGE_BYTES).toString('base64url');
  return { token, hash: hashChallengeToken(token) };
}
