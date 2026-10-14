import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHmac, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MfaUnavailableError, matchTotp, mfaKey, openSecret, sealSecret } from '../app/lib/mfa.ts';

type TwinKeyError = Error & { variable: string };

type Twin = {
  MfaKeyError: new (variable: string, problem: string) => TwinKeyError;
  mfaKeyEnvName(version: number): string;
  openTotpSecret(sealed: string, adminId: string, keyVersion: number): Promise<Uint8Array>;
  matchTotpStep(secret: Uint8Array, code: string, nowMs?: number): Promise<number | null>;
  splitPasswordAndCode(input: string): { password: string; code: string } | null;
};

const TWIN_URL = new URL(['..', '..', 'supabase', 'functions', '_shared', 'adminMfa.ts'].join('/'), import.meta.url);
const TWIN_FILE = fileURLToPath(TWIN_URL);

const KEY_ENV = 'ADMIN_MFA_ENCRYPTION_KEY';
const FIXED_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const FIXED_ADMIN = '3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b';
const FIXED_SECRET = Buffer.from('12345678901234567890', 'ascii');
const FIXED_SEALED = 'oKGio6Slpqeoqaqr1ypPGXD9NYdbVbbhNE716EeUYCCow3tgg0VFxid5ZNE596De';
const MAIN_VERSION = 2;
const SAME_BYTES_VERSION = 3;
const MISSING_VERSION = 4;
const CACHE_VERSION = 5;
const MAIN_KEY = randomBytes(32).toString('base64');

const originalEnv = new Map<string, string>();
let twin: Twin;

function keyName(version: number): string {
  return version === 1 ? KEY_ENV : `${KEY_ENV}_V${version}`;
}

function setKey(version: number, value: string | undefined): void {
  if (value === undefined) delete process.env[keyName(version)];
  else process.env[keyName(version)] = value;
}

function aad(adminId: string, version: number): Buffer {
  return Buffer.from(`cardelite-admin-mfa:v${version}:${adminId}`, 'utf8');
}

function sealWith(key: Uint8Array, adminId: string, version: number, secret: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(adminId, version));
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
}

async function webSeal(key: Uint8Array, adminId: string, version: number, secret: Uint8Array): Promise<string> {
  const imported = await webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = randomBytes(12);
  const body = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(adminId, version), tagLength: 128 }, imported, secret);
  return Buffer.concat([iv, Buffer.from(body)]).toString('base64');
}

function referenceHotp(secret: Uint8Array, counter: number | bigint): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const value = mac.readUInt32BE(mac[mac.length - 1] & 0x0f) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, '0');
}

async function twinOpens(sealed: string, adminId: string, version: number): Promise<Buffer> {
  return Buffer.from(await twin.openTotpSecret(sealed, adminId, version));
}

async function twinRefusal(sealed: string, adminId: string, version: number): Promise<unknown> {
  try {
    await twin.openTotpSecret(sealed, adminId, version);
  } catch (error) {
    return error;
  }
  return null;
}

function nodeRefusal(sealed: string, adminId: string, version: number): unknown {
  try {
    openSecret(sealed, adminId, version);
  } catch (error) {
    return error;
  }
  return null;
}

function flip(sealed: string, index: number): string {
  const raw = Buffer.from(sealed, 'base64');
  raw[index] ^= 1;
  return raw.toString('base64');
}

function keyWithBothSymbols(): string {
  let text = randomBytes(32).toString('base64');
  while (!text.includes('+') || !text.includes('/')) text = randomBytes(32).toString('base64');
  return text;
}

before(async () => {
  for (const name of Object.keys(process.env)) {
    if (!name.startsWith(KEY_ENV)) continue;
    originalEnv.set(name, process.env[name] ?? '');
    delete process.env[name];
  }
  setKey(1, FIXED_KEY);
  setKey(MAIN_VERSION, MAIN_KEY);
  setKey(SAME_BYTES_VERSION, MAIN_KEY);
  Object.assign(globalThis, { Deno: { env: { get: (name: string) => process.env[name] } } });
  twin = (await import(TWIN_URL.href)) as Twin;
});

after(() => {
  for (const name of Object.keys(process.env)) if (name.startsWith(KEY_ENV)) delete process.env[name];
  for (const [name, value] of originalEnv) process.env[name] = value;
});

describe('the Deno twin, run under Node WebCrypto', () => {
  test('exposes only the read-only surface and uses the same WebCrypto as Node', async () => {
    const namespace: Record<string, unknown> = await import(TWIN_URL.href);
    assert.deepEqual(Object.keys(namespace).sort(), ['MfaKeyError', 'matchTotpStep', 'mfaKeyEnvName', 'openTotpSecret', 'splitPasswordAndCode']);
    assert.equal(twin.mfaKeyEnvName(1), KEY_ENV);
    assert.equal(twin.mfaKeyEnvName(2), `${KEY_ENV}_V2`);
    assert.equal(twin.mfaKeyEnvName(1000), `${KEY_ENV}_V1000`);
    assert.equal(globalThis.crypto.subtle, webcrypto.subtle);
    const source = readFileSync(TWIN_FILE, 'utf8');
    assert.doesNotMatch(source, /\/\*|(^|[^:])\/\/(?!\/)/m);
    assert.doesNotMatch(source, /encrypt|recovery|console\.|^import /m);
    assert.equal(source.match(/Deno\.env\.get\(/g)?.length, 1);
    const loop = /for \(let delta[\s\S]*?\n {2}\}\n/.exec(source)?.[0] ?? '';
    assert.match(loop, /sameCode\(candidate, code\)/);
    assert.doesNotMatch(loop, /\breturn\b|\bbreak\b/);
  });

  test('both runtimes open the fixed vector', async () => {
    assert.deepEqual(openSecret(FIXED_SEALED, FIXED_ADMIN, 1), FIXED_SECRET);
    assert.deepEqual(await twinOpens(FIXED_SEALED, FIXED_ADMIN, 1), FIXED_SECRET);
  });

  test('the twin opens 200 secrets sealed by Node', async () => {
    const lengths = [20, 20, 20, 1, 64];
    for (let i = 0; i < 200; i += 1) {
      const adminId = randomUUID();
      const secret = randomBytes(lengths[i % lengths.length]);
      const sealed = sealSecret(secret, adminId, MAIN_VERSION);
      assert.deepEqual(await twinOpens(sealed, adminId, MAIN_VERSION), secret, `case ${i}`);
    }
  });

  test('Node opens 200 secrets sealed through WebCrypto with the twin layout', async () => {
    const key = Buffer.from(MAIN_KEY, 'base64');
    for (let i = 0; i < 200; i += 1) {
      const adminId = randomUUID();
      const secret = randomBytes(20);
      const sealed = await webSeal(key, adminId, MAIN_VERSION, secret);
      assert.equal(sealed.length, 64);
      assert.deepEqual(openSecret(sealed, adminId, MAIN_VERSION), secret, `case ${i}`);
      assert.deepEqual(await twinOpens(sealed, adminId, MAIN_VERSION), secret, `case ${i}`);
    }
  });

  test('the AAD binds the admin id and the key version in both runtimes', async () => {
    const adminId = randomUUID();
    const sealed = sealSecret(randomBytes(20), adminId, MAIN_VERSION);
    for (const [otherAdmin, version] of [
      [randomUUID(), MAIN_VERSION],
      [adminId.toUpperCase(), MAIN_VERSION],
      [adminId, SAME_BYTES_VERSION],
    ] as [string, number][]) {
      assert.ok(nodeRefusal(sealed, otherAdmin, version) instanceof Error, `${otherAdmin} v${version}`);
      const refused = await twinRefusal(sealed, otherAdmin, version);
      assert.ok(refused instanceof Error && !(refused instanceof twin.MfaKeyError), `${otherAdmin} v${version}`);
    }
  });

  test('tampering, truncation, an empty secret and loose base64 fail in both runtimes', async () => {
    const adminId = randomUUID();
    const candidates = Array.from({ length: 200 }, () => sealSecret(randomBytes(20), adminId, MAIN_VERSION));
    const sealed = candidates.find((value) => /[+/]/.test(value));
    assert.ok(sealed);
    const raw = Buffer.from(sealed, 'base64');
    const padded = sealSecret(randomBytes(22), adminId, MAIN_VERSION);
    assert.ok(padded.endsWith('='));
    const emptySealed = sealWith(Buffer.from(MAIN_KEY, 'base64'), adminId, MAIN_VERSION, Buffer.alloc(0));
    assert.equal(Buffer.from(emptySealed, 'base64').length, 28);
    const broken = [
      emptySealed,
      flip(sealed, 0),
      flip(sealed, 11),
      flip(sealed, 12),
      flip(sealed, 31),
      flip(sealed, 32),
      flip(sealed, raw.length - 1),
      raw.subarray(0, 28).toString('base64'),
      sealed.replace(/\+/g, '-').replace(/[/]/g, '_'),
      padded.replace(/=+$/, ''),
      ` ${sealed}`,
      `${sealed}\n`,
      '',
    ];
    assert.ok(!broken.includes(sealed) && !broken.includes(padded));
    for (const value of broken) {
      const nodeError = nodeRefusal(value, adminId, MAIN_VERSION);
      const twinError = await twinRefusal(value, adminId, MAIN_VERSION);
      assert.ok(nodeError instanceof Error && !(nodeError instanceof MfaUnavailableError), JSON.stringify(value));
      assert.ok(twinError instanceof Error && !(twinError instanceof twin.MfaKeyError), JSON.stringify(value));
    }
  });

  test('a wrong key fails in both runtimes', async () => {
    const adminId = randomUUID();
    const sealed = sealWith(randomBytes(32), adminId, MAIN_VERSION, randomBytes(20));
    assert.ok(nodeRefusal(sealed, adminId, MAIN_VERSION) instanceof Error);
    assert.ok((await twinRefusal(sealed, adminId, MAIN_VERSION)) instanceof Error);
  });

  test('a missing key or an invalid key version fails closed in both runtimes', async () => {
    const adminId = randomUUID();
    const sealed = sealWith(Buffer.from(MAIN_KEY, 'base64'), adminId, MISSING_VERSION, randomBytes(20));
    const nodeError = nodeRefusal(sealed, adminId, MISSING_VERSION);
    const twinError = await twinRefusal(sealed, adminId, MISSING_VERSION);
    assert.ok(nodeError instanceof MfaUnavailableError);
    assert.ok(twinError instanceof twin.MfaKeyError);
    assert.equal(nodeError.variable, `${KEY_ENV}_V${MISSING_VERSION}`);
    assert.equal(twinError.variable, nodeError.variable);
    assert.equal(twinError.message, nodeError.message);
    for (const version of [0, 1001, 1.5, Number.NaN]) {
      const fromNode = nodeRefusal(sealed, adminId, version);
      const fromTwin = await twinRefusal(sealed, adminId, version);
      assert.ok(fromNode instanceof MfaUnavailableError, String(version));
      assert.ok(fromTwin instanceof twin.MfaKeyError, String(version));
      assert.equal(fromTwin.message, fromNode.message, String(version));
    }
  });

  test('both runtimes accept and refuse the same key spellings', async () => {
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
      ['16-byte key', randomBytes(16).toString('base64'), false],
      ['48-byte key', randomBytes(48).toString('base64'), false],
      ['empty', '', false],
      ['blank', '   ', false],
      ['no-break space', `${b64} `, true],
      ['byte order mark', `﻿${b64}`, true],
      ['tabs', `\t${b64}\t`, true],
      ['31 bytes with double padding', randomBytes(31).toString('base64'), false],
      ['33 bytes', randomBytes(33).toString('base64'), false],
      ['non-canonical final character', `${b64.slice(0, 42)}${sibling}=`, true],
    ];
    let version = 10;
    for (const [label, value, accepted] of forms) {
      version += 1;
      setKey(version, value);
      const adminId = randomUUID();
      const secret = randomBytes(20);
      let nodeKey: Buffer | null = null;
      let nodeError: unknown = null;
      try {
        nodeKey = mfaKey(version);
      } catch (error) {
        nodeError = error;
      }
      const probe = sealWith(nodeKey ?? randomBytes(32), adminId, version, secret);
      const twinError = await twinRefusal(probe, adminId, version);
      assert.equal(nodeKey !== null, accepted, `${label}: Node`);
      assert.equal(twinError === null, accepted, `${label}: twin ${String(twinError)}`);
      if (!accepted) {
        assert.ok(nodeError instanceof MfaUnavailableError, label);
        assert.ok(twinError instanceof twin.MfaKeyError, label);
        assert.equal(twinError.variable, `${KEY_ENV}_V${version}`, label);
        assert.equal(twinError.message, nodeError.message, label);
        continue;
      }
      assert.deepEqual(nodeKey, Buffer.from(b64, 'base64'), label);
      assert.deepEqual(await twinOpens(sealSecret(secret, adminId, version), adminId, version), secret, label);
      assert.deepEqual(openSecret(await webSeal(Buffer.from(b64, 'base64'), adminId, version, secret), adminId, version), secret, label);
    }
    assert.ok(forms.length >= 15);
  });

  test('the twin caches the key per version while Node reads it on every call', async () => {
    const original = randomBytes(32);
    const replacement = randomBytes(32).toString('base64');
    setKey(CACHE_VERSION, original.toString('base64'));
    const adminId = randomUUID();
    const secret = randomBytes(20);
    assert.deepEqual(await twinOpens(sealWith(original, adminId, CACHE_VERSION, secret), adminId, CACHE_VERSION), secret);
    setKey(CACHE_VERSION, replacement);
    try {
      assert.equal(mfaKey(CACHE_VERSION).toString('base64'), replacement);
      assert.deepEqual(await twinOpens(sealWith(original, adminId, CACHE_VERSION, secret), adminId, CACHE_VERSION), secret);
      assert.deepEqual(openSecret(sealWith(Buffer.from(replacement, 'base64'), adminId, CACHE_VERSION, secret), adminId, CACHE_VERSION), secret);
    } finally {
      setKey(CACHE_VERSION, undefined);
    }
  });
});

describe('TOTP agreement', () => {
  test('both runtimes match the same step over 300 random times', async () => {
    let agreed = 0;
    for (let i = 0; i < 300; i += 1) {
      const secret = randomBytes(20);
      const now = Date.now() + Math.floor((Math.random() - 0.5) * 1e11);
      const current = Math.floor(now / 30_000);
      const delta = [-2, -1, 0, 1, 2][i % 5];
      const code = referenceHotp(secret, current + delta);
      const fromNode = matchTotp(secret, code, now);
      const fromTwin = await twin.matchTotpStep(secret, code, now);
      assert.equal(fromTwin, fromNode, `case ${i} delta ${delta}`);
      if (Math.abs(delta) <= 1) {
        assert.ok(fromNode !== null && fromNode <= current + delta && fromNode >= current - 1, `case ${i} delta ${delta}`);
      }
      agreed += 1;
    }
    assert.equal(agreed, 300);
  });

  test('both runtimes agree on the RFC vectors and the earliest-step rule', async () => {
    const hotpVectors = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    for (let counter = 0; counter < hotpVectors.length; counter += 1) {
      const now = counter * 30_000 + 15_000;
      assert.equal(matchTotp(FIXED_SECRET, hotpVectors[counter], now), counter);
      assert.equal(await twin.matchTotpStep(FIXED_SECRET, hotpVectors[counter], now), counter);
    }
    const totpVectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];
    for (const [seconds, code] of totpVectors) {
      const step = Math.floor(seconds / 30);
      assert.equal(matchTotp(FIXED_SECRET, code, seconds * 1000), step, `T=${seconds}`);
      assert.equal(await twin.matchTotpStep(FIXED_SECRET, code, seconds * 1000), step, `T=${seconds}`);
    }
    const earliest: [string, number, number][] = [
      ['963181', 59061240, 59061240],
      ['963181', 59061241, 59061240],
      ['963181', 59061242, 59061241],
      ['768734', 61331810, 61331809],
    ];
    for (const [code, step, expected] of earliest) {
      const now = step * 30_000 + 15_000;
      assert.equal(matchTotp(FIXED_SECRET, code, now), expected, `${code}@${step}`);
      assert.equal(await twin.matchTotpStep(FIXED_SECRET, code, now), expected, `${code}@${step}`);
    }
  });

  test('both runtimes refuse malformed codes, empty secrets and non-finite times', async () => {
    const now = 1111111111_000;
    for (const code of ['12a456', '12345', '1234567', ' 050471', '050471 ', '050 471', '０５０４７１', '']) {
      assert.equal(matchTotp(FIXED_SECRET, code, now), null, JSON.stringify(code));
      assert.equal(await twin.matchTotpStep(FIXED_SECRET, code, now), null, JSON.stringify(code));
    }
    assert.equal(matchTotp(Buffer.alloc(0), '050471', now), null);
    assert.equal(await twin.matchTotpStep(new Uint8Array(0), '050471', now), null);
    const zero = referenceHotp(FIXED_SECRET, 0);
    const wrapped = referenceHotp(FIXED_SECRET, (BigInt(1) << BigInt(64)) - BigInt(1));
    assert.notEqual(wrapped, zero);
    assert.notEqual(wrapped, referenceHotp(FIXED_SECRET, 1));
    for (const time of [0, 15_000, 29_999]) {
      assert.equal(matchTotp(FIXED_SECRET, zero, time), 0);
      assert.equal(await twin.matchTotpStep(FIXED_SECRET, zero, time), 0);
      assert.equal(matchTotp(FIXED_SECRET, wrapped, time), null);
      assert.equal(await twin.matchTotpStep(FIXED_SECRET, wrapped, time), null);
    }
    for (const time of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(matchTotp(FIXED_SECRET, zero, time), null);
      assert.equal(await twin.matchTotpStep(FIXED_SECRET, zero, time), null);
    }
  });
});

describe('the mobile password-and-code split', () => {
  test('takes a trailing six-digit code off the password, and nothing else', () => {
    const split = twin.splitPasswordAndCode;
    assert.deepEqual(split('Secret#Pass1123456'), { password: 'Secret#Pass1', code: '123456' });
    assert.deepEqual(split('a123456'), { password: 'a', code: '123456' });
    assert.deepEqual(split('pass word 000000'), { password: 'pass word ', code: '000000' });
    assert.deepEqual(split('abc12345678'), { password: 'abc12', code: '345678' });
    assert.deepEqual(split('p\u{1F600}w654321'), { password: 'p\u{1F600}w', code: '654321' });
    for (const input of ['Secret#Pass12345a', '123456', '12345', '', 'password', 'pass１２３４５６']) {
      assert.equal(split(input), null, JSON.stringify(input));
    }
    assert.equal(split(undefined as unknown as string), null);
  });
});
