import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createCipheriv, createHash, createHmac, hkdfSync } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-generator';
import {
  MFA_KEY_VERSION,
  MfaUnavailableError,
  base32Encode,
  groupKey,
  hashChallengeToken,
  hashRecoveryCode,
  isMfaKeyConfigured,
  matchTotp,
  mfaKey,
  newChallengeToken,
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  openSecret,
  otpauthUri,
  sealSecret,
} from '../app/lib/mfa.ts';
import { qrDataUri } from '../app/lib/qr.ts';

const ADMIN_DIR = fileURLToPath(new URL('../', import.meta.url));
const APP_DIR = join(ADMIN_DIR, 'app');
const MFA_FILE = join(APP_DIR, 'lib', 'mfa.ts');
const QR_FILE = join(APP_DIR, 'lib', 'qr.ts');
const TEST_FILE = fileURLToPath(import.meta.url);
const INTEROP_TEST_FILE = join(ADMIN_DIR, 'test', 'mfaInterop.test.ts');

const KEY_ENV = 'ADMIN_MFA_ENCRYPTION_KEY';
const FIXED_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const FIXED_ADMIN = '3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b';
const OTHER_ADMIN = '9d0e6c2a-1b3f-4a5e-8c7d-6e5f4a3b2c1d';
const FIXED_IV = 'a0a1a2a3a4a5a6a7a8a9aaab';
const FIXED_SECRET = Buffer.from('12345678901234567890', 'ascii');
const FIXED_SEALED = 'oKGio6Slpqeoqaqr1ypPGXD9NYdbVbbhNE716EeUYCCow3tgg0VFxid5ZNE596De';
const FIXED_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const FIXED_PEPPER = 'fb54635ad886fad2fc581f48cd515cfe2a8f089e5cdd3575e2d063c18868b208';
const FIXED_RECOVERY_INPUT = 'abcde fghjk';
const FIXED_RECOVERY_CODE = 'ABCDEFGHJK';
const FIXED_RECOVERY_HASH = '33b76dcb0d0d19da3153d074f5ceb04efb4c5341b997f8b42177341e060b1fc7';
const FIXED_CHALLENGE = 'q6Wb3n4Xy0Zr2PpL8sT1uVwKcDeFgHiJkLmNoPqRsTu';
const FIXED_CHALLENGE_HASH = '77b9d6c11cdf8f7cef1c6718528251e6d7bbe1e599e85b3e8cf574cd5b55b0f2';
const DB_SECRET_CHECK = /^[A-Za-z0-9+/=_-]{24,512}$/;
const SEALED_FORM = /^(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const RECOVERY_DISPLAY = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const QR_PREFIX = 'data:image/svg+xml;base64,';
const QR_INTEGRITY = 'sha512-mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe/c+5XxCuetEenqmNFf1FH/ftXPCtFG5/TDobjsjz6sSNL0Sr8Z9g==';

const savedEnv = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function randomKeyText(): string {
  return crypto.randomBytes(32).toString('base64');
}

function keyWithBothSymbols(): string {
  let text = randomKeyText();
  while (!text.includes('+') || !text.includes('/')) text = randomKeyText();
  return text;
}

function referenceHotp(secret: Uint8Array, counter: number, digits = 6): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const value = mac.readUInt32BE(mac[mac.length - 1] & 0x0f) & 0x7fffffff;
  return String(value % 10 ** digits).padStart(digits, '0');
}

function sealRaw(key: Uint8Array, adminId: string, version: number, plain: Uint8Array, iv: Uint8Array = crypto.randomBytes(12)): string {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`cardelite-admin-mfa:v${version}:${adminId}`, 'utf8'));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
}

function sealedWithSymbols(): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const sealed = sealSecret(FIXED_SECRET, FIXED_ADMIN, 1);
    if (/[+/]/.test(sealed)) return sealed;
  }
  throw new Error('sealSecret never produced standard base64 with + or /');
}

function flip(sealed: string, index: number): string {
  const raw = Buffer.from(sealed, 'base64');
  raw[index] ^= 1;
  return raw.toString('base64');
}

function stepTime(step: number): number {
  return step * 30_000 + 15_000;
}

beforeEach(() => {
  setEnv(KEY_ENV, FIXED_KEY);
  for (let version = 2; version <= 12; version += 1) setEnv(`${KEY_ENV}_V${version}`, undefined);
});

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('the encryption key', () => {
  test('is read from ADMIN_MFA_ENCRYPTION_KEY at call time, for key version 1 by default', () => {
    assert.equal(MFA_KEY_VERSION, 1);
    assert.deepEqual([...mfaKey(1)], Array.from({ length: 32 }, (_, i) => i));
    assert.deepEqual(mfaKey(), mfaKey(1));
    const next = randomKeyText();
    setEnv(KEY_ENV, next);
    assert.equal(mfaKey(1).toString('base64'), next);
    setEnv(KEY_ENV, undefined);
    assert.throws(() => mfaKey(1), (error: unknown) => error instanceof MfaUnavailableError && error.variable === KEY_ENV);
  });

  test('later key versions read ADMIN_MFA_ENCRYPTION_KEY_V{n}', () => {
    const v2 = randomKeyText();
    setEnv(`${KEY_ENV}_V2`, v2);
    assert.equal(mfaKey(2).toString('base64'), v2);
    assert.throws(() => mfaKey(7), (error: unknown) => error instanceof MfaUnavailableError && error.variable === `${KEY_ENV}_V7`);
    assert.equal(mfaKey(1).toString('base64'), FIXED_KEY);
  });

  test('key versions outside 1 to 1000 fail closed', () => {
    for (const version of [0, -1, 1001, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => mfaKey(version), MfaUnavailableError, String(version));
      assert.equal(isMfaKeyConfigured(version), false);
    }
    setEnv(`${KEY_ENV}_V1000`, randomKeyText());
    assert.equal(isMfaKeyConfigured(1000), true);
    setEnv(`${KEY_ENV}_V1000`, undefined);
  });

  test('accepts only 44 characters of standard padded base64 after trimming', () => {
    const b64 = keyWithBothSymbols();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const sibling = alphabet.charAt(alphabet.indexOf(b64.charAt(42)) | 1);
    const forms: [string, string, boolean][] = [
      ['plain', b64, true],
      ['trailing newline', `${b64}\n`, true],
      ['crlf', `${b64}\r\n`, true],
      ['leading spaces', `  ${b64}`, true],
      ['quoted', `"${b64}"`, false],
      ['unpadded', b64.replace(/=+$/, ''), false],
      ['url-safe', b64.replace(/\+/g, '-').replace(/[/]/g, '_'), false],
      ['inner space', `${b64.slice(0, 10)} ${b64.slice(10)}`, false],
      ['stray character', `${b64.slice(0, 10)}*${b64.slice(10)}`, false],
      ['16-byte key', crypto.randomBytes(16).toString('base64'), false],
      ['48-byte key', crypto.randomBytes(48).toString('base64'), false],
      ['empty', '', false],
      ['blank', '   ', false],
      ['no-break space', `${b64}\u00a0`, true],
      ['byte order mark', `\ufeff${b64}`, true],
      ['tabs', `\t${b64}\t`, true],
      ['31 bytes with double padding', crypto.randomBytes(31).toString('base64'), false],
      ['33 bytes', crypto.randomBytes(33).toString('base64'), false],
      ['non-canonical final character', `${b64.slice(0, 42)}${sibling}=`, true],
    ];
    for (const [label, value, accepted] of forms) {
      setEnv(`${KEY_ENV}_V3`, value);
      assert.equal(isMfaKeyConfigured(3), accepted, label);
      if (accepted) {
        assert.equal(mfaKey(3).length, 32, label);
        continue;
      }
      assert.throws(
        () => mfaKey(3),
        (error: unknown) => {
          assert.ok(error instanceof MfaUnavailableError, label);
          assert.equal(error.variable, `${KEY_ENV}_V3`, label);
          assert.ok(error.message.startsWith(`${KEY_ENV}_V3 `), label);
          if (value.trim().length >= 8) assert.ok(!error.message.includes(value.trim().slice(0, 8)), label);
          return true;
        },
        label,
      );
    }
    setEnv(`${KEY_ENV}_V3`, `${b64.slice(0, 42)}${sibling}=`);
    assert.deepEqual(mfaKey(3), Buffer.from(b64, 'base64'));
  });

  test('a refusal carries only the variable name, never key material', () => {
    const b64 = randomKeyText();
    setEnv(KEY_ENV, `"${b64}"`);
    let caught: unknown = null;
    try {
      mfaKey(1);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof MfaUnavailableError);
    assert.equal(caught.name, 'MfaUnavailableError');
    assert.deepEqual(Object.keys(caught).sort(), ['name', 'variable']);
    const visible = `${caught.message} ${JSON.stringify(caught)} ${String(caught.stack)}`;
    for (let start = 0; start + 6 <= b64.length; start += 6) assert.ok(!visible.includes(b64.slice(start, start + 6)));
  });

  test('isMfaKeyConfigured follows the same rule', () => {
    assert.equal(isMfaKeyConfigured(), true);
    setEnv(KEY_ENV, 'not-a-key');
    assert.equal(isMfaKeyConfigured(), false);
    setEnv(KEY_ENV, undefined);
    assert.equal(isMfaKeyConfigured(), false);
    assert.equal(isMfaKeyConfigured(2), false);
  });
});

describe('the secret box', () => {
  test('the fixed vector is AES-256-GCM over iv || ciphertext || tag with the admin-bound AAD', () => {
    assert.equal(sealRaw(Buffer.from(FIXED_KEY, 'base64'), FIXED_ADMIN, 1, FIXED_SECRET, Buffer.from(FIXED_IV, 'hex')), FIXED_SEALED);
    assert.equal(FIXED_SEALED.length, 64);
  });

  test('opens the fixed vector', () => {
    assert.deepEqual(openSecret(FIXED_SEALED, FIXED_ADMIN, 1), FIXED_SECRET);
  });

  test('round-trips with a fresh IV and fits the database check', () => {
    const first = sealSecret(FIXED_SECRET, FIXED_ADMIN, 1);
    const second = sealSecret(FIXED_SECRET, FIXED_ADMIN, 1);
    assert.notEqual(first, second);
    for (const sealed of [first, second]) {
      assert.equal(sealed.length, 64);
      assert.match(sealed, SEALED_FORM);
      assert.match(sealed, DB_SECRET_CHECK);
      assert.equal(Buffer.from(sealed, 'base64').length, 12 + 20 + 16);
      assert.deepEqual(openSecret(sealed, FIXED_ADMIN, 1), FIXED_SECRET);
    }
    const secret = newTotpSecret();
    assert.deepEqual(openSecret(sealSecret(secret, OTHER_ADMIN, 1), OTHER_ADMIN, 1), secret);
  });

  test('the AAD binds the admin id and the key version', () => {
    const sealed = sealSecret(FIXED_SECRET, FIXED_ADMIN, 1);
    assert.throws(() => openSecret(sealed, OTHER_ADMIN, 1));
    assert.throws(() => openSecret(sealed, FIXED_ADMIN.toUpperCase(), 1), TypeError);
    setEnv(`${KEY_ENV}_V2`, FIXED_KEY);
    assert.throws(() => openSecret(sealed, FIXED_ADMIN, 2));
    const underV2 = sealSecret(FIXED_SECRET, FIXED_ADMIN, 2);
    assert.deepEqual(openSecret(underV2, FIXED_ADMIN, 2), FIXED_SECRET);
    assert.throws(() => openSecret(underV2, FIXED_ADMIN, 1));
  });

  test('a wrong key fails', () => {
    const sealed = sealSecret(FIXED_SECRET, FIXED_ADMIN, 1);
    setEnv(KEY_ENV, randomKeyText());
    assert.throws(() => openSecret(sealed, FIXED_ADMIN, 1));
  });

  test('tampering with the iv, the ciphertext or the tag fails', () => {
    const sealed = sealSecret(FIXED_SECRET, FIXED_ADMIN, 1);
    for (const index of [0, 11, 12, 31, 32, 47]) {
      assert.throws(() => openSecret(flip(sealed, index), FIXED_ADMIN, 1), Error, String(index));
    }
  });

  test('malformed sealed text is refused before decrypting', () => {
    const sealed = sealedWithSymbols();
    const raw = Buffer.from(sealed, 'base64');
    const emptySealed = sealRaw(Buffer.from(FIXED_KEY, 'base64'), FIXED_ADMIN, 1, Buffer.alloc(0));
    assert.equal(Buffer.from(emptySealed, 'base64').length, 28);
    const padded = sealSecret(Buffer.alloc(22, 7), FIXED_ADMIN, 1);
    assert.ok(padded.endsWith('='));
    assert.deepEqual(openSecret(padded, FIXED_ADMIN, 1), Buffer.alloc(22, 7));
    const malformed = [
      sealed.replace(/\+/g, '-').replace(/[/]/g, '_'),
      padded.replace(/=+$/, ''),
      ` ${sealed}`,
      `${sealed}\n`,
      raw.subarray(0, 28).toString('base64'),
      raw.subarray(0, 12).toString('base64'),
      emptySealed,
      '',
      'A===',
    ];
    for (const value of malformed) {
      assert.throws(() => openSecret(value, FIXED_ADMIN, 1), (error: unknown) => error instanceof Error && !(error instanceof MfaUnavailableError), JSON.stringify(value));
    }
    assert.throws(() => openSecret(undefined as unknown as string, FIXED_ADMIN, 1));
  });

  test('a missing or malformed key fails closed with MfaUnavailableError', () => {
    const sealed = sealSecret(FIXED_SECRET, FIXED_ADMIN, 1);
    for (const value of [undefined, '', 'short', `${FIXED_KEY.slice(0, 43)}`]) {
      setEnv(KEY_ENV, value);
      assert.throws(() => sealSecret(FIXED_SECRET, FIXED_ADMIN, 1), MfaUnavailableError);
      assert.throws(() => openSecret(sealed, FIXED_ADMIN, 1), MfaUnavailableError);
      assert.throws(() => hashRecoveryCode(FIXED_RECOVERY_CODE, FIXED_ADMIN, 1), MfaUnavailableError);
    }
  });

  test('refuses an empty secret and an admin id that is not a lower-case uuid', () => {
    assert.throws(() => sealSecret(Buffer.alloc(0), FIXED_ADMIN, 1), TypeError);
    for (const adminId of [FIXED_ADMIN.toUpperCase(), 'admin-1', '', ` ${FIXED_ADMIN}`]) {
      assert.throws(() => sealSecret(FIXED_SECRET, adminId, 1), TypeError, adminId);
      assert.throws(() => hashRecoveryCode(FIXED_RECOVERY_CODE, adminId, 1), TypeError, adminId);
    }
  });
});

describe('TOTP', () => {
  test('base32 follows RFC 4648 in upper case without padding', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'MY======'],
      ['fo', 'MZXQ===='],
      ['foo', 'MZXW6==='],
      ['foob', 'MZXW6YQ='],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI======'],
    ];
    for (const [plain, padded] of vectors) assert.equal(base32Encode(Buffer.from(plain, 'ascii')), padded.replace(/=+$/, ''), plain);
    assert.equal(base32Encode(FIXED_SECRET), FIXED_BASE32);
    assert.equal(base32Encode(Buffer.alloc(20, 0xff)), '7'.repeat(32));
  });

  test('groupKey shows the key in groups of four', () => {
    assert.equal(groupKey(FIXED_BASE32), 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ');
    assert.equal(groupKey('ABCDEF'), 'ABCD EF');
    assert.equal(groupKey(''), '');
  });

  test('newTotpSecret gives 20 random bytes, 32 base32 characters', () => {
    const first = newTotpSecret();
    const second = newTotpSecret();
    assert.equal(first.length, 20);
    assert.notDeepEqual(first, second);
    assert.match(base32Encode(first), /^[A-Z2-7]{32}$/);
  });

  test('RFC 4226 HOTP values for counters 0 to 9', () => {
    const vectors = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    vectors.forEach((code, counter) => {
      assert.equal(referenceHotp(FIXED_SECRET, counter), code);
      assert.equal(matchTotp(FIXED_SECRET, code, stepTime(counter)), counter, `counter ${counter}`);
    });
  });

  test('RFC 6238 SHA-1 vectors', () => {
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, eight] of vectors) {
      const step = Math.floor(seconds / 30);
      assert.equal(referenceHotp(FIXED_SECRET, step, 8), eight, `T=${seconds}`);
      assert.equal(matchTotp(FIXED_SECRET, eight.slice(2), seconds * 1000), step, `T=${seconds}`);
    }
    assert.equal(matchTotp(FIXED_SECRET, '287082', 59_000), 1);
    assert.equal(matchTotp(FIXED_SECRET, '050471', 1111111111_000), 37037037);
  });

  test('the window is one step either side', () => {
    const now = 1111111111_000;
    const step = Math.floor(now / 30_000);
    assert.equal(matchTotp(FIXED_SECRET, referenceHotp(FIXED_SECRET, step), now), step);
    assert.equal(matchTotp(FIXED_SECRET, referenceHotp(FIXED_SECRET, step - 1), now), step - 1);
    assert.equal(matchTotp(FIXED_SECRET, referenceHotp(FIXED_SECRET, step + 1), now), step + 1);
    assert.equal(matchTotp(FIXED_SECRET, referenceHotp(FIXED_SECRET, step - 2), now), null);
    assert.equal(matchTotp(FIXED_SECRET, referenceHotp(FIXED_SECRET, step + 2), now), null);
  });

  test('the earliest matching step wins', () => {
    assert.equal(referenceHotp(FIXED_SECRET, 59061240), '963181');
    assert.equal(referenceHotp(FIXED_SECRET, 59061241), '963181');
    assert.equal(matchTotp(FIXED_SECRET, '963181', stepTime(59061240)), 59061240);
    assert.equal(matchTotp(FIXED_SECRET, '963181', stepTime(59061241)), 59061240);
    assert.equal(matchTotp(FIXED_SECRET, '963181', stepTime(59061242)), 59061241);
    assert.equal(referenceHotp(FIXED_SECRET, 61331809), '768734');
    assert.equal(referenceHotp(FIXED_SECRET, 61331811), '768734');
    assert.notEqual(referenceHotp(FIXED_SECRET, 61331810), '768734');
    assert.equal(matchTotp(FIXED_SECRET, '768734', stepTime(61331810)), 61331809);
  });

  test('codes must be exactly six ASCII digits', () => {
    const now = 1111111111_000;
    for (const code of ['12a456', '12345', '1234567', ' 050471', '050471 ', '050 471', '\uff10\uff15\uff10\uff14\uff17\uff11', '']) {
      assert.equal(matchTotp(FIXED_SECRET, code, now), null, JSON.stringify(code));
    }
    assert.equal(matchTotp(FIXED_SECRET, 50471 as unknown as string, now), null);
    assert.equal(matchTotp(Buffer.alloc(0), '050471', now), null);
  });

  test('step 0 works and non-finite times never match', () => {
    const zero = referenceHotp(FIXED_SECRET, 0);
    assert.equal(matchTotp(FIXED_SECRET, zero, 0), 0);
    assert.equal(matchTotp(FIXED_SECRET, zero, 29_999), 0);
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(matchTotp(FIXED_SECRET, zero, now), null);
    }
  });

  test('every candidate step is compared with timingSafeEqual, with no early exit', (t) => {
    const now = 1111111111_000;
    const step = Math.floor(now / 30_000);
    const compare = t.mock.method(crypto, 'timingSafeEqual');
    syncBuiltinESMExports();
    try {
      for (const delta of [-1, 0, 1]) {
        compare.mock.resetCalls();
        assert.equal(matchTotp(FIXED_SECRET, referenceHotp(FIXED_SECRET, step + delta), now), step + delta);
        assert.equal(compare.mock.callCount(), 3, `delta ${delta}`);
      }
      compare.mock.resetCalls();
      assert.equal(matchTotp(FIXED_SECRET, '000000', now), null);
      assert.equal(compare.mock.callCount(), 3);
      for (const call of compare.mock.calls) {
        const [given, expected] = call.arguments;
        assert.equal(given.byteLength, 6);
        assert.equal(expected.byteLength, 6);
      }
      compare.mock.resetCalls();
      assert.equal(matchTotp(FIXED_SECRET, 'abcdef', now), null);
      assert.equal(compare.mock.callCount(), 0);
    } finally {
      compare.mock.restore();
      syncBuiltinESMExports();
    }
  });
});

describe('the authenticator link', () => {
  test('matches the contract exactly', () => {
    assert.equal(
      otpauthUri('ops.lead', FIXED_BASE32),
      'otpauth://totp/CardElite%20Admin:ops.lead?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=CardElite%20Admin&algorithm=SHA1&digits=6&period=30',
    );
  });

  test('percent-encodes the username', () => {
    assert.ok(otpauthUri('a b&c/d?e#f:g', FIXED_BASE32).startsWith('otpauth://totp/CardElite%20Admin:a%20b%26c%2Fd%3Fe%23f%3Ag?secret='));
    assert.ok(otpauthUri('Ad\u00e9', FIXED_BASE32).includes(':Ad%C3%A9?'));
  });

  test('refuses a secret that is not bare upper-case base32', () => {
    for (const secret of [`${FIXED_BASE32}====`, groupKey(FIXED_BASE32), FIXED_BASE32.toLowerCase(), '', 'GEZDGNBV1']) {
      assert.throws(() => otpauthUri('ops.lead', secret), TypeError, secret);
    }
  });
});

describe('recovery codes', () => {
  test('ten distinct codes shown as XXXXX-XXXXX', () => {
    const codes = newRecoveryCodes();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    for (const code of codes) {
      assert.match(code, RECOVERY_DISPLAY);
      assert.equal(normalizeRecoveryCode(code), code.replace('-', ''));
    }
    const sixteen = newRecoveryCodes(16);
    assert.equal(new Set(sixteen).size, 16);
    for (const count of [0, 17, 1.5, -1]) assert.throws(() => newRecoveryCodes(count), RangeError, String(count));
  });

  test('draw from the whole Crockford alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) for (const code of newRecoveryCodes()) for (const ch of code.replace('-', '')) seen.add(ch);
    assert.deepEqual([...seen].sort().join(''), [...CROCKFORD].sort().join(''));
  });

  test('normalisation forgives case, spacing, dashes and I, L and O', () => {
    const accepted: [string, string][] = [
      [FIXED_RECOVERY_INPUT, FIXED_RECOVERY_CODE],
      ['ABCDE-FGHJK', FIXED_RECOVERY_CODE],
      ['  abcde-fghjk\n', FIXED_RECOVERY_CODE],
      ['abc de\tfg-hjk', FIXED_RECOVERY_CODE],
      ['ABCDE\u00a0FGHJK', FIXED_RECOVERY_CODE],
      ['oOiIl-LO0ab', '00111100AB'],
      ['ZZZZZ-00000', 'ZZZZZ00000'],
    ];
    for (const [input, code] of accepted) assert.equal(normalizeRecoveryCode(input), code, JSON.stringify(input));
    const refused: unknown[] = [
      'ABCDE-FGHJU',
      'ABCDE-FGHJ',
      'ABCDE-FGHJKK',
      'ABCDE_FGHJK',
      'ABCDE\u2013FGHJK',
      'abcde-fgh\u00df',
      '\u0131bcde-fghjk',
      'abcde-fghj\u017f',
      '',
      `${' '.repeat(60)}ABCDE-FGHJK`,
      1234567890,
      null,
      undefined,
    ];
    for (const input of refused) assert.equal(normalizeRecoveryCode(input), null, JSON.stringify(input));
  });

  test('the hash is HMAC-SHA256 under the HKDF pepper, bound to the admin id', () => {
    const pepper = Buffer.from(hkdfSync('sha256', Buffer.from(FIXED_KEY, 'base64'), Buffer.from('cardelite-admin'), Buffer.from('recovery-code-pepper:v1'), 32));
    assert.equal(pepper.toString('hex'), FIXED_PEPPER);
    assert.notEqual(FIXED_PEPPER, Buffer.from(FIXED_KEY, 'base64').toString('hex'));
    assert.equal(createHmac('sha256', pepper).update(`${FIXED_ADMIN}:${FIXED_RECOVERY_CODE}`).digest('hex'), FIXED_RECOVERY_HASH);
    for (const input of [FIXED_RECOVERY_INPUT, FIXED_RECOVERY_CODE, 'ABCDE-FGHJK']) {
      assert.equal(hashRecoveryCode(input, FIXED_ADMIN, 1), FIXED_RECOVERY_HASH, input);
    }
    assert.match(hashRecoveryCode(FIXED_RECOVERY_CODE, OTHER_ADMIN, 1), /^[0-9a-f]{64}$/);
    assert.notEqual(hashRecoveryCode(FIXED_RECOVERY_CODE, OTHER_ADMIN, 1), FIXED_RECOVERY_HASH);
    setEnv(`${KEY_ENV}_V2`, FIXED_KEY);
    assert.notEqual(hashRecoveryCode(FIXED_RECOVERY_CODE, FIXED_ADMIN, 2), FIXED_RECOVERY_HASH);
    setEnv(KEY_ENV, randomKeyText());
    assert.notEqual(hashRecoveryCode(FIXED_RECOVERY_CODE, FIXED_ADMIN, 1), FIXED_RECOVERY_HASH);
  });

  test('an invalid code cannot be hashed', () => {
    for (const code of ['ABCDE-FGHJU', '', 'short']) assert.throws(() => hashRecoveryCode(code, FIXED_ADMIN, 1), TypeError, code);
  });

  test('every code of a set hashes to a distinct value that passes the database check', () => {
    const hashes = newRecoveryCodes().map((code) => hashRecoveryCode(code, FIXED_ADMIN, MFA_KEY_VERSION));
    assert.equal(new Set(hashes).size, 10);
    for (const hash of hashes) assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

describe('challenge tokens', () => {
  test('are 32 random bytes as unpadded base64url, stored as a sha256 hex digest', () => {
    const first = newChallengeToken();
    const second = newChallengeToken();
    assert.notEqual(first.token, second.token);
    for (const { token, hash } of [first, second]) {
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(Buffer.from(token, 'base64url').length, 32);
      assert.equal(hash, createHash('sha256').update(token, 'utf8').digest('hex'));
      assert.equal(hashChallengeToken(token), hash);
    }
  });

  test('the fixed vector', () => {
    assert.equal(hashChallengeToken(FIXED_CHALLENGE), FIXED_CHALLENGE_HASH);
  });
});

function svgOf(uri: string): string {
  assert.ok(uri.startsWith(QR_PREFIX));
  const encoded = uri.slice(QR_PREFIX.length);
  assert.match(encoded, /^[A-Za-z0-9+/]+={0,2}$/);
  return Buffer.from(encoded, 'base64').toString('utf8');
}

function modulesOf(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(Buffer.from(text, 'utf8').toString('latin1'), 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, col) => qr.isDark(row, col)));
}

function drawnGrid(svg: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const match = /<path fill="#000" d="([^"]*)"\/>/.exec(svg);
  assert.ok(match);
  const d = match[1];
  assert.equal(d.replace(/M\d+ \d+h\d+v1h-\d+z/g, ''), '');
  for (const [, x, y, width, back] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    assert.equal(width, back);
    for (let i = 0; i < Number(width); i += 1) {
      const row = Number(y);
      const col = Number(x) + i;
      assert.ok(row < size && col < size);
      assert.equal(grid[row][col], false);
      grid[row][col] = true;
    }
  }
  return grid;
}

function assertFinder(grid: boolean[][], top: number, left: number): void {
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      assert.equal(grid[top + r][left + c], ring !== 2, `finder ${top},${left} at ${r},${c}`);
    }
  }
}

describe('the QR code', () => {
  test('a 160-character link becomes a version 9 black-on-white SVG with a four-module quiet zone', () => {
    const uri = otpauthUri('ops.lead.with.long.username1', FIXED_BASE32);
    assert.equal(uri.length, 160);
    const dataUri = qrDataUri(uri);
    const svg = svgOf(dataUri);
    const size = 53 + 8;
    assert.match(
      svg,
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 61 61" width="244" height="244" shape-rendering="crispEdges"><rect width="61" height="61" fill="#fff"\/><path fill="#000" d="(?:M\d+ \d+h\d+v1h-\d+z)+"\/><\/svg>$/,
    );
    assert.equal(svg.match(/<path/g)?.length, 1);
    assert.equal(svg.match(/<rect/g)?.length, 1);
    assert.doesNotMatch(svg, /<script|foreignObject|href|\son\w+=|<text|<image|<style/i);
    assert.ok(svg.length > 4_000 && svg.length < 12_000, `svg is ${svg.length} bytes`);
    assert.ok(dataUri.length < 16_000, `data uri is ${dataUri.length} bytes`);
    const grid = drawnGrid(svg, size);
    const modules = modulesOf(uri);
    assert.equal(modules.length, 53);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const inside = row >= 4 && row < 57 && col >= 4 && col < 57;
        assert.equal(grid[row][col], inside ? modules[row - 4][col - 4] : false, `${row},${col}`);
      }
    }
    assertFinder(grid, 4, 4);
    assertFinder(grid, 4, size - 4 - 7);
    assertFinder(grid, size - 4 - 7, 4);
  });

  test('is deterministic and draws the exact module matrix for short and long links', () => {
    for (const username of ['a', 'ops.lead', 'super.admin.with.a.long.username_2026']) {
      const uri = otpauthUri(username, base32Encode(newTotpSecret()));
      const svg = svgOf(qrDataUri(uri));
      assert.equal(qrDataUri(uri), qrDataUri(uri));
      const modules = modulesOf(uri);
      const size = modules.length + 8;
      assert.ok(svg.includes(`viewBox="0 0 ${size} ${size}"`));
      const grid = drawnGrid(svg, size);
      for (let row = 0; row < modules.length; row += 1) {
        for (let col = 0; col < modules.length; col += 1) assert.equal(grid[row + 4][col + 4], modules[row][col]);
      }
    }
  });

  test('encodes text as UTF-8 bytes', () => {
    const svg = svgOf(qrDataUri('Ad\u00e9'));
    const modules = modulesOf('Ad\u00e9');
    const grid = drawnGrid(svg, modules.length + 8);
    for (let row = 0; row < modules.length; row += 1) {
      for (let col = 0; col < modules.length; col += 1) assert.equal(grid[row + 4][col + 4], modules[row][col]);
    }
    const latin = qrcode(0, 'M');
    latin.addData('Ad\u00e9', 'Byte');
    latin.make();
    let differs = latin.getModuleCount() !== modules.length;
    for (let row = 0; !differs && row < modules.length; row += 1) {
      for (let col = 0; col < modules.length; col += 1) if (latin.isDark(row, col) !== modules[row][col]) differs = true;
    }
    assert.ok(differs);
  });

  test('refuses text too long for any QR version with an Error', () => {
    assert.throws(() => qrDataUri('x'.repeat(2400)), RangeError);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(path);
  }
  return out;
}

describe('module hygiene', () => {
  test('the crypto and QR modules and their tests carry no comments and never log', () => {
    for (const file of [MFA_FILE, QR_FILE, TEST_FILE, INTEROP_TEST_FILE]) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /\/\*|(^|[^:])\/\/(?!\/)/m, file);
    }
    for (const file of [MFA_FILE, QR_FILE]) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /console\.|use client|NEXT_PUBLIC/, file);
    }
  });

  test('mfa.ts uses only node:crypto and reads only the key variables', () => {
    const text = readFileSync(MFA_FILE, 'utf8');
    assert.deepEqual([...text.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]), ['node:crypto']);
    assert.equal(text.match(/process\.env/g)?.length, 1);
    assert.match(text, /process\.env\[name\]/);
    assert.deepEqual([...readFileSync(QR_FILE, 'utf8').matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]), ['qrcode-generator']);
  });

  test('only lib/qr.ts imports qrcode-generator, and no client module imports the crypto or QR modules', () => {
    const importers: string[] = [];
    for (const file of walk(APP_DIR)) {
      const text = readFileSync(file, 'utf8');
      const rel = relative(APP_DIR, file).split('\\').join('/');
      if (/from\s+['"]qrcode-generator['"]/.test(text)) importers.push(rel);
      if (/^\s*['"]use client['"]/.test(text)) {
        assert.doesNotMatch(text, /from\s+['"][^'"]*lib\/(?:mfa|qr)(?:\.ts)?['"]|qrcode-generator/, rel);
      }
    }
    assert.deepEqual(importers, ['lib/qr.ts']);
  });

  test('qrcode-generator is pinned to exactly 2.0.4 with the registry integrity and no dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ADMIN_DIR, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(join(ADMIN_DIR, 'package-lock.json'), 'utf8'));
    assert.equal(pkg.dependencies['qrcode-generator'], '2.0.4');
    assert.equal(lock.packages[''].dependencies['qrcode-generator'], '2.0.4');
    assert.deepEqual(lock.packages['node_modules/qrcode-generator'], {
      version: '2.0.4',
      resolved: 'https://registry.npmjs.org/qrcode-generator/-/qrcode-generator-2.0.4.tgz',
      integrity: QR_INTEGRITY,
      license: 'MIT',
    });
    assert.deepEqual(Object.keys(lock.packages).filter((key: string) => key.includes('qrcode-generator')), ['node_modules/qrcode-generator']);
    const installed = JSON.parse(readFileSync(join(ADMIN_DIR, 'node_modules', 'qrcode-generator', 'package.json'), 'utf8'));
    assert.equal(installed.version, '2.0.4');
    assert.equal(installed.dependencies, undefined);
  });
});
