import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ElementType } from 'react';
import { classesOf, loadAppModule, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import type { ApiFailure } from '../app/lib/apiClient.ts';
import type { DeviceSession } from '../app/lib/adminSecurity.ts';

type SecurityModule = typeof import('../app/lib/adminSecurity.ts');
type HttpModule = typeof import('../app/lib/http.ts');
type MfaModule = typeof import('../app/lib/mfa.ts');
type QrModule = typeof import('../app/lib/qr.ts');
type QrImageModule = typeof import('../app/_security/QrImage.tsx');
type SetupKeyModule = typeof import('../app/_security/SetupKey.tsx');
type RecoveryCodesModule = typeof import('../app/_security/RecoveryCodes.tsx');
type DeviceListModule = typeof import('../app/_security/DeviceList.tsx');
type OtpFieldModule = typeof import('../app/_security/OtpField.tsx');
type EnrollFlowModule = typeof import('../app/_security/EnrollFlow.tsx');
type ReauthModule = typeof import('../app/_security/reauth.ts');

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const SECURITY_DIR = join(APP_DIR, '_security');
const TEST_FILE = fileURLToPath(import.meta.url);
const NOW = new Date('2026-10-12T09:05:00.000Z');
const noop = () => {};

let sec: SecurityModule;
let http: HttpModule;
let mfa: MfaModule;
let qr: QrModule;
let qrImage: QrImageModule;
let setupKey: SetupKeyModule;
let recoveryCodes: RecoveryCodesModule;
let deviceList: DeviceListModule;
let otpField: OtpFieldModule;
let enrollFlow: EnrollFlowModule;
let reauth: ReauthModule;

before(async () => {
  sec = await loadAppModule<SecurityModule>('lib/adminSecurity.ts');
  http = await loadAppModule<HttpModule>('lib/http.ts');
  mfa = await import('../app/lib/mfa.ts');
  qr = await import('../app/lib/qr.ts');
  qrImage = await loadAppModule<QrImageModule>('_security/QrImage.tsx');
  setupKey = await loadAppModule<SetupKeyModule>('_security/SetupKey.tsx');
  recoveryCodes = await loadAppModule<RecoveryCodesModule>('_security/RecoveryCodes.tsx');
  deviceList = await loadAppModule<DeviceListModule>('_security/DeviceList.tsx');
  otpField = await loadAppModule<OtpFieldModule>('_security/OtpField.tsx');
  enrollFlow = await loadAppModule<EnrollFlowModule>('_security/EnrollFlow.tsx');
  reauth = await loadAppModule<ReauthModule>('_security/reauth.ts');
});

function httpFailure(status: number, code: string | null, message: string, details: unknown = null): ApiFailure {
  return { kind: 'http', status, code, message, requestId: 'req_test', details, outcomeUnknown: false };
}

function interrupted(kind: 'network' | 'timeout' | 'aborted' | 'parse'): ApiFailure {
  return { kind, status: null, code: null, message: 'apiClient copy', requestId: null, details: null, outcomeUnknown: true };
}

function session(patch: Partial<DeviceSession> = {}): DeviceSession {
  return {
    id: '0f6c3f8e-2b1a-4c5d-9e8f-7a6b5c4d3e2f',
    client: 'web',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    ip: '102.89.34.1',
    authMethods: ['pwd'],
    createdAt: '2026-10-12T08:14:00.000Z',
    lastSeenAt: '2026-10-12T09:04:30.000Z',
    expiresAt: '2026-10-12T16:14:00.000Z',
    current: false,
    ...patch,
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const DEVICE_CASES: ReadonlyArray<readonly [string, 'web' | 'mobile', string, string]> = [
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 'web', 'Edge on Windows', 'computer'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'web', 'Chrome on Windows', 'computer'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15', 'web', 'Safari on macOS', 'computer'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1', 'web', 'Safari on iPhone', 'phone'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1', 'web', 'Chrome on iPhone', 'phone'],
  ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', 'web', 'Chrome on Android', 'phone'],
  ['Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36', 'web', 'Samsung Internet on Android', 'phone'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0', 'web', 'Firefox on Windows', 'computer'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/122.0.0.0', 'web', 'Opera on Linux', 'computer'],
  ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'web', 'Chrome on ChromeOS', 'computer'],
  ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'web', 'Chrome on Android', 'tablet'],
  ['okhttp/4.12.0', 'mobile', 'CardElite Admin app on Android', 'app'],
  ['CardEliteAdmin/1 CFNetwork/1568.100.1 Darwin/24.0.0', 'mobile', 'CardElite Admin app on iPhone', 'app'],
  ['', 'mobile', 'CardElite Admin app', 'app'],
  ['', 'web', 'Unknown browser', 'computer'],
  ['curl/8.4.0', 'web', 'Unknown browser', 'computer'],
];

describe('describeDevice', () => {
  test('the 16 prototype cases give the same label and kind', () => {
    assert.equal(DEVICE_CASES.length, 16);
    for (const [ua, client, label, kind] of DEVICE_CASES) {
      assert.deepEqual(sec.describeDevice(ua, client), { label, kind }, ua || `(empty ${client})`);
    }
  });

  test('mobile sessions are labelled by client, never by browser, whatever the user agent says', () => {
    const chrome = DEVICE_CASES[0][0];
    assert.deepEqual(sec.describeDevice(chrome, 'mobile'), { label: 'CardElite Admin app', kind: 'app' });
    assert.deepEqual(sec.describeDevice('Mozilla/5.0 (Linux; Android 14)', 'mobile'), {
      label: 'CardElite Admin app on Android', kind: 'app',
    });
  });

  test('iPad Safari is a tablet; iPadOS presenting as a Mac stays a computer', () => {
    const ipad = 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
    assert.deepEqual(sec.describeDevice(ipad, 'web'), { label: 'Safari on iPad', kind: 'tablet' });
  });

  test('a system without a known browser, and junk input, still get a readable label', () => {
    assert.deepEqual(sec.describeDevice('Mozilla/5.0 (Windows NT 10.0) Unknown/1.0', 'web'), {
      label: 'Browser on Windows', kind: 'computer',
    });
    assert.deepEqual(sec.describeDevice(null, 'web'), { label: 'Unknown browser', kind: 'computer' });
    assert.deepEqual(sec.describeDevice(42, undefined), { label: 'Unknown browser', kind: 'computer' });
  });

  test('only the first 512 characters of a user agent are read', () => {
    const padded = `${'x'.repeat(600)} Edg/141.0`;
    assert.deepEqual(sec.describeDevice(padded, 'web'), { label: 'Unknown browser', kind: 'computer' });
  });
});

describe('addresses and activity lines', () => {
  test('isLocalAddress knows ::1, 127.* and their mapped forms', () => {
    for (const ip of ['::1', '127.0.0.1', '127.10.0.3', '::ffff:127.0.0.1', ' localhost ']) assert.equal(sec.isLocalAddress(ip), true, ip);
    for (const ip of ['197.210.53.4', '10.0.0.1', '::2', '', null, 7]) assert.equal(sec.isLocalAddress(ip), false, String(ip));
  });

  test('ipText reads local addresses, missing addresses and public ones', () => {
    assert.equal(sec.ipText('::1'), 'Local address (::1)');
    assert.equal(sec.ipText('127.0.0.1'), 'Local address (127.0.0.1)');
    assert.equal(sec.ipText('102.89.34.1'), 'IP 102.89.34.1');
    assert.equal(sec.ipText(null), 'IP not recorded');
    assert.equal(sec.ipText('unknown'), 'IP not recorded');
    assert.equal(sec.ipText('  '), 'IP not recorded');
  });

  test('lastSeenText says Active now under 2 minutes, otherwise the age', () => {
    assert.equal(sec.lastSeenText('2026-10-12T09:04:30.000Z', NOW), 'Active now');
    assert.equal(sec.lastSeenText('2026-10-12T09:03:01.000Z', NOW), 'Active now');
    assert.equal(sec.lastSeenText('2026-10-12T09:03:00.000Z', NOW), 'Active 2m ago');
    assert.equal(sec.lastSeenText('2026-10-10T09:05:00.000Z', NOW), 'Active 2d ago');
    assert.equal(sec.lastSeenText('2026-10-12T09:06:00.000Z', NOW), 'Active now', 'a little clock skew still reads as now');
    assert.equal(sec.lastSeenText(null, NOW), null);
    assert.equal(sec.lastSeenText('not a date', NOW), null);
  });

  test('signedInText joins the WAT sign-in time and the activity', () => {
    assert.equal(sec.signedInText(session(), NOW), 'Signed in 12 Oct 2026, 09:14 WAT · Active now');
    assert.equal(
      sec.signedInText(session({ lastSeenAt: '2026-10-12T08:59:00.000Z' }), NOW),
      'Signed in 12 Oct 2026, 09:14 WAT · Active 6m ago',
    );
    assert.equal(sec.signedInText(session({ lastSeenAt: null }), NOW), 'Signed in 12 Oct 2026, 09:14 WAT');
    assert.equal(sec.signedInText(session({ createdAt: null, lastSeenAt: null }), NOW), 'Sign-in time not recorded');
  });

  test('signOutLabel names the device and its sign-in time', () => {
    assert.equal(sec.signOutLabel(session(), 'Edge on Windows'), 'Sign out Edge on Windows, signed in 12 Oct 2026, 09:14 WAT');
    assert.equal(sec.signOutLabel(session({ createdAt: null }), 'Edge on Windows'), 'Sign out Edge on Windows');
  });
});

describe('codes and keys', () => {
  test('sanitizeOtp keeps digits only, at most 6, so pasted codes with spaces work', () => {
    assert.equal(sec.sanitizeOtp('123 456'), '123456');
    assert.equal(sec.sanitizeOtp('12-34-56-78'), '123456');
    assert.equal(sec.sanitizeOtp('abc'), '');
    assert.equal(sec.sanitizeOtp(null), '');
    assert.equal(sec.sanitizeOtp(' 0 0 1 '), '001');
  });

  test('isCompleteOtp needs exactly 6 digits', () => {
    assert.equal(sec.isCompleteOtp('123456'), true);
    for (const value of ['12345', '1234567', '12345a', ' 123456', '', null]) assert.equal(sec.isCompleteOtp(value), false, String(value));
  });

  test('isCompleteRecoveryCode agrees with the server normaliser for every input', () => {
    const inputs = [
      'ABCDE-FGHJK', 'abcde fghjk', 'ABCDEFGHJK', ' abcde-fghjk ', 'ab cd ef gh jk', 'ABCDE--FGHJK', 'IIIII-LLLLL',
      'ooooo-00000', 'ABCDE-FGHJ', 'ABCDE-FGHJKM', 'ABCDU-FGHJK', 'ABCDE_FGHJK', 'ÀBCDE-FGHJK', '', '   ', '-----',
      `${'A'.repeat(5)}-${'B'.repeat(5)}${' '.repeat(60)}`, 'ABCDE-FGHJK\n',
      ...mfa.newRecoveryCodes(),
    ];
    for (const input of inputs) {
      assert.equal(sec.isCompleteRecoveryCode(input), mfa.normalizeRecoveryCode(input) !== null, JSON.stringify(input));
    }
    assert.equal(sec.isCompleteRecoveryCode(42), false);
  });

  test('groupSetupKey shows base32 in upper-case groups of 4, like the server groupKey', () => {
    assert.equal(sec.groupSetupKey('jbswy3dpehpk3pxpjbswy3dpehpk3pxp'), 'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    assert.equal(sec.groupSetupKey('JBSW Y3DP EH'), 'JBSW Y3DP EH');
    const key = mfa.base32Encode(mfa.newTotpSecret());
    assert.equal(sec.groupSetupKey(key), mfa.groupKey(key));
    assert.equal(sec.compactSetupKey(mfa.groupKey(key)), key);
  });

  test('the input attribute sets match the contract and never carry maxLength', () => {
    assert.deepEqual({ ...sec.OTP_INPUT_ATTRIBUTES }, {
      type: 'text', inputMode: 'numeric', autoComplete: 'one-time-code', enterKeyHint: 'go',
      autoCapitalize: 'none', spellCheck: false, translate: 'no',
    });
    assert.equal(sec.RECOVERY_INPUT_ATTRIBUTES.autoComplete, 'off');
    assert.equal('maxLength' in sec.OTP_INPUT_ATTRIBUTES, false);
  });
});

describe('grace, lock and status text', () => {
  test('graceText gives the WAT date, the time and the days left', () => {
    assert.deepEqual(sec.graceText('2026-10-26T09:05:00.000Z', NOW), {
      date: '26 Oct 2026', shortDate: '26 Oct', dateTime: '26 Oct 2026, 10:05 WAT', daysLeft: 14, left: '14 days left', overdue: false,
    });
    assert.equal(sec.graceText('2026-10-13T08:00:00.000Z', NOW)?.left, '1 day left');
    assert.equal(sec.graceText('2026-10-12T22:30:00.000Z', NOW)?.left, 'Due today');
    assert.equal(sec.graceText('2026-10-12T23:30:00.000Z', NOW)?.left, '1 day left', 'after 23:00 UTC it is already tomorrow in Lagos');
  });

  test('graceText marks a passed date as required now', () => {
    const passed = sec.graceText('2026-10-12T09:00:00.000Z', NOW);
    assert.equal(passed?.overdue, true);
    assert.equal(passed?.daysLeft, 0);
    assert.equal(passed?.left, 'Required now');
    assert.equal(sec.graceText(null, NOW), null);
    assert.equal(sec.graceText('soon', NOW), null);
  });

  test('lockedUntilText uses the shared round-up WAT rule from http.ts', () => {
    assert.equal(sec.lockedUntilText('2026-10-12T09:19:10.000Z', NOW), 'Locked until 10:20 WAT');
    assert.equal(sec.lockedUntilText('2026-10-13T09:19:10.000Z', NOW), 'Locked until 13 Oct, 10:20 WAT');
    assert.equal(
      sec.lockedUntilText('2026-10-13T09:19:10.000Z', NOW),
      `Locked until ${http.twoStepUnlockText('2026-10-13T09:19:10.000Z', NOW.getTime())}`,
    );
    assert.equal(sec.lockedUntilText(null, NOW), 'Locked');
  });

  test('twoStepBadge maps none, pending, active and an active lock', () => {
    assert.deepEqual(sec.twoStepBadge({ status: 'none' }, NOW), { label: 'Off', tone: 'neutral' });
    assert.deepEqual(sec.twoStepBadge({ status: 'pending' }, NOW), { label: 'Setup not finished', tone: 'neutral' });
    assert.deepEqual(sec.twoStepBadge({ status: 'active' }, NOW), { label: 'On', tone: 'success' });
    assert.deepEqual(sec.twoStepBadge({ status: 'active', lockedUntil: '2026-10-12T09:20:00.000Z' }, NOW), { label: 'Locked', tone: 'danger' });
    assert.deepEqual(sec.twoStepBadge({ status: 'active', lockedUntil: '2026-10-12T09:00:00.000Z' }, NOW), { label: 'On', tone: 'success' });
    assert.deepEqual(sec.twoStepBadge({ status: 'none', lockedUntil: '2026-10-12T09:20:00.000Z' }, NOW), { label: 'Off', tone: 'neutral' });
  });

  test('toTwoStepStatus defaults anything unknown to none', () => {
    assert.equal(sec.toTwoStepStatus('active'), 'active');
    assert.equal(sec.toTwoStepStatus('pending'), 'pending');
    for (const value of ['none', 'on', null, undefined, 1]) assert.equal(sec.toTwoStepStatus(value), 'none');
  });

  test('recovery code counts warn at 3 or fewer and are danger at none', () => {
    assert.equal(sec.recoveryCodesTone(8), 'neutral');
    assert.equal(sec.recoveryCodesTone(3), 'warning');
    assert.equal(sec.recoveryCodesTone(1), 'warning');
    assert.equal(sec.recoveryCodesTone(0), 'danger');
    assert.equal(sec.recoveryCodesLeftText(8), '8 left');
    assert.equal(sec.recoveryCodesLeftText(0), 'None left');
  });

  test('tries-left text appears only at 2 or fewer, singular at 1', () => {
    assert.equal(sec.withTriesLeft('That code did not work.', 4), 'That code did not work.');
    assert.equal(sec.withTriesLeft('That code did not work.', 3), 'That code did not work.');
    assert.equal(sec.withTriesLeft('That code did not work.', 2), 'That code did not work. 2 tries left.');
    assert.equal(sec.withTriesLeft('That code did not work.', 1), 'That code did not work. 1 try left.');
    assert.equal(sec.withTriesLeft('That code did not work.', 0), 'That code did not work. No tries left.');
    assert.equal(sec.withTriesLeft('That code did not work.', null), 'That code did not work.');
    assert.equal(sec.withTriesLeft('That code did not work.', 1.5), 'That code did not work.');
  });
});

describe('recovery code file', () => {
  test('the text has a heading, the account, the WAT time, one usage line and numbered codes', () => {
    const text = sec.recoveryCodesText(['ABCDE-FGHJK', '12345-67890'], { username: 'ops.lead', createdAt: NOW });
    assert.equal(text, [
      'CardElite Admin recovery codes',
      'Account: ops.lead',
      'Created: 12 Oct 2026, 10:05 WAT',
      '',
      'Each code signs you in once if you lose your phone. On the sign-in page, choose "Use a recovery code instead" and type one code.',
      '',
      '1. ABCDE-FGHJK',
      '2. 12345-67890',
      '',
    ].join('\n'));
  });

  test('ten codes are numbered with aligned dots', () => {
    const codes = mfa.newRecoveryCodes();
    const lines = sec.recoveryCodesText(codes, { username: 'ops.lead', createdAt: NOW }).split('\n');
    assert.equal(lines.filter((line) => /^ ?\d+\. /.test(line)).length, 10);
    assert.ok(lines.includes(` 1. ${codes[0]}`));
    assert.ok(lines.includes(`10. ${codes[9]}`));
  });

  test('the file name carries the username and the WAT date, made safe for any file system', () => {
    assert.equal(sec.recoveryCodesFileName('ops.lead', NOW), 'cardelite-admin-recovery-codes-ops.lead-2026-10-12.txt');
    assert.equal(sec.recoveryCodesFileName('../x y', NOW), 'cardelite-admin-recovery-codes-x-y-2026-10-12.txt');
    assert.equal(sec.recoveryCodesFileName('', NOW), 'cardelite-admin-recovery-codes-admin-2026-10-12.txt');
    assert.equal(
      sec.recoveryCodesFileName('ops', new Date('2026-10-12T23:30:00.000Z')),
      'cardelite-admin-recovery-codes-ops-2026-10-13.txt',
      'the date is the Lagos date',
    );
  });
});

describe('response parsers', () => {
  test('toEnrollSetup accepts a real server QR and key and regroups the key', () => {
    const key = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const uri = mfa.otpauthUri('ops.lead', key);
    const setup = sec.toEnrollSetup({
      otpauth_uri: uri, secret_display: mfa.groupKey(key), qr_data_uri: qr.qrDataUri(uri), account_label: 'CardElite Admin (ops.lead)',
    });
    assert.ok(setup);
    assert.equal(setup.otpauthUri, uri);
    assert.equal(setup.secretDisplay, 'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    assert.equal(setup.accountLabel, 'CardElite Admin (ops.lead)');
    assert.equal(sec.isQrDataUri(setup.qrDataUri), true);
  });

  test('toEnrollSetup refuses anything that is not a data: SVG and an otpauth TOTP link', () => {
    const base = { otpauth_uri: 'otpauth://totp/CardElite%20Admin:ops?secret=JBSWY3DP', secret_display: 'JBSW Y3DP', qr_data_uri: 'data:image/svg+xml;base64,PHN2Zy8+' };
    assert.ok(sec.toEnrollSetup(base));
    assert.equal(sec.toEnrollSetup({ ...base, qr_data_uri: 'https://evil.example/qr.svg' }), null);
    assert.equal(sec.toEnrollSetup({ ...base, qr_data_uri: 'data:text/html;base64,PHNjcmlwdD4=' }), null);
    assert.equal(sec.toEnrollSetup({ ...base, qr_data_uri: 'data:image/svg+xml;utf8,<svg onload=x>' }), null);
    assert.equal(sec.toEnrollSetup({ ...base, otpauth_uri: 'javascript:alert(1)' }), null);
    assert.equal(sec.toEnrollSetup({ ...base, otpauth_uri: 'otpauth://hotp/x?secret=A' }), null);
    assert.equal(sec.toEnrollSetup({ ...base, secret_display: 'not base32!' }), null);
    assert.equal(sec.toEnrollSetup({ ...base, secret_display: '' }), null);
    assert.equal(sec.toEnrollSetup({ ...base, account_label: undefined })?.accountLabel, 'CardElite Admin');
  });

  test('toEnrollConfirmed needs well-formed recovery codes and reads session_renewed', () => {
    const codes = mfa.newRecoveryCodes();
    assert.deepEqual(sec.toEnrollConfirmed({ recovery_codes: codes }), { recoveryCodes: codes, sessionRenewed: null });
    assert.deepEqual(sec.toEnrollConfirmed({ recovery_codes: codes, session_renewed: false }), { recoveryCodes: codes, sessionRenewed: false });
    assert.equal(sec.toEnrollConfirmed({ recovery_codes: [] }), null);
    assert.equal(sec.toEnrollConfirmed({ recovery_codes: [...codes, 'abcde-fghjk'] }), null);
    assert.equal(sec.toEnrollConfirmed({ recovery_codes: 'ABCDE-FGHJK' }), null);
    assert.equal(sec.toEnrollConfirmed({}), null);
  });

  test('toDeviceSessions reads the sessions list, puts this device first and drops rows without an id', () => {
    const parsed = sec.toDeviceSessions({
      sessions: [
        { id: 'b', client: 'mobile', user_agent: 'okhttp/4.12.0', ip: '197.210.53.4', auth_methods: ['otp', 'pwd'], created_at: '2026-10-12T07:00:00.000Z', last_seen_at: '2026-10-12T09:00:00.000Z', expires_at: '2026-10-13T07:00:00.000Z', current: false },
        { id: 'a', client: 'web', user_agent: 'Mozilla/5.0', ip: '::1', auth_methods: ['pwd', 'recovery', 'sms'], created_at: '2026-10-12T08:00:00.000Z', last_seen_at: 'later', expires_at: null, current: true },
        { client: 'web' },
        'junk',
      ],
    });
    assert.ok(parsed);
    assert.deepEqual(parsed.map((row) => row.id), ['a', 'b']);
    assert.deepEqual(parsed[0], {
      id: 'a', client: 'web', userAgent: 'Mozilla/5.0', ip: '::1', authMethods: ['pwd', 'recovery'],
      createdAt: '2026-10-12T08:00:00.000Z', lastSeenAt: null, expiresAt: null, current: true,
    });
    assert.deepEqual(parsed[1].authMethods, ['otp', 'pwd']);
    assert.equal(parsed[1].client, 'mobile');
    assert.equal(sec.toDeviceSessions({ sessions: null }), null);
    assert.deepEqual(sec.toDeviceSessions({ sessions: [] }), []);
  });
});

describe('failure text and enrolment failures', () => {
  test('interrupted requests get sign-in copy, never the apiClient "may or may not have been saved" copy', () => {
    assert.equal(sec.securityFailureText(interrupted('network'), 'fallback'), 'Could not reach the server. Check your connection and try again.');
    assert.equal(sec.securityFailureText(interrupted('timeout'), 'fallback'), 'The server took too long to respond. Try again.');
    assert.equal(sec.securityFailureText(interrupted('parse'), 'fallback'), 'The server sent a response that could not be read. Try again.');
    assert.equal(sec.securityFailureText(interrupted('aborted'), 'fallback'), 'The request was cancelled. Try again.');
  });

  test('a 5xx without an error code uses the fallback; a coded error keeps the server text', () => {
    assert.equal(sec.securityFailureText(httpFailure(502, null, 'The server returned an error (HTTP 502)…'), 'fallback'), 'fallback');
    assert.equal(sec.securityFailureText(httpFailure(500, 'INTERNAL_ERROR', 'Two-step sign-in is unavailable right now. Try again later.'), 'fallback'),
      'Two-step sign-in is unavailable right now. Try again later.');
    assert.equal(sec.securityFailureText(httpFailure(409, 'STATE_CONFLICT', 'Already on.'), 'fallback'), 'Already on.');
  });

  test('401 and 403 end the flow at both stages', () => {
    for (const stage of ['start', 'confirm'] as const) {
      assert.deepEqual(sec.classifyEnrollFailure(httpFailure(401, 'AUTH_REQUIRED', 'This sign-in step ended.', { reason: 'challenge_expired' }), stage), { kind: 'ended' });
      assert.deepEqual(sec.classifyEnrollFailure(httpFailure(403, 'REAUTH_REQUIRED', 'Confirm it is you to continue.'), stage), { kind: 'ended' });
    }
  });

  test('a wrong setup code is a field error with tries left; none left ends the flow', () => {
    const wrong = "That code did not work. Use the newest CardElite Admin entry in your app and check your phone's clock.";
    assert.deepEqual(
      sec.classifyEnrollFailure(httpFailure(400, 'VALIDATION_ERROR', wrong, { field: 'otp', attempts_left: 3 }), 'confirm'),
      { kind: 'field', message: wrong },
    );
    assert.deepEqual(
      sec.classifyEnrollFailure(httpFailure(400, 'VALIDATION_ERROR', wrong, { field: 'otp', attempts_left: 1 }), 'confirm'),
      { kind: 'field', message: `${wrong} 1 try left.` },
    );
    assert.deepEqual(
      sec.classifyEnrollFailure(httpFailure(400, 'VALIDATION_ERROR', wrong, { field: 'otp' }), 'confirm'),
      { kind: 'field', message: wrong },
    );
    assert.deepEqual(
      sec.classifyEnrollFailure(httpFailure(400, 'VALIDATION_ERROR', wrong, { field: 'otp', attempts_left: 0 }), 'confirm'),
      { kind: 'ended' },
    );
  });

  test('a confirm conflict offers a restart; a start conflict does not', () => {
    assert.deepEqual(
      sec.classifyEnrollFailure(httpFailure(409, 'STATE_CONFLICT', 'This setup timed out or was replaced. Start again.'), 'confirm'),
      { kind: 'problem', message: 'This setup timed out or was replaced. Start again.', restart: true },
    );
    assert.deepEqual(
      sec.classifyEnrollFailure(httpFailure(409, null, 'That record has changed. Reload and try again.'), 'confirm'),
      { kind: 'problem', message: sec.SETUP_REPLACED, restart: true },
    );
    assert.deepEqual(
      sec.classifyEnrollFailure(httpFailure(409, 'STATE_CONFLICT', 'Two-step sign-in is already on.'), 'start'),
      { kind: 'problem', message: 'Two-step sign-in is already on.', restart: false },
    );
  });

  test('other failures are problems; a failed start can be tried again', () => {
    assert.deepEqual(sec.classifyEnrollFailure(interrupted('network'), 'start'), {
      kind: 'problem', message: 'Could not reach the server. Check your connection and try again.', restart: true,
    });
    assert.deepEqual(sec.classifyEnrollFailure(httpFailure(500, 'INTERNAL_ERROR', 'Two-step sign-in is unavailable right now. Try again later.'), 'confirm'), {
      kind: 'problem', message: 'Two-step sign-in is unavailable right now. Try again later.', restart: false,
    });
    assert.deepEqual(sec.classifyEnrollFailure(httpFailure(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.'), 'confirm'), {
      kind: 'problem', message: 'Too many requests. Try again shortly.', restart: false,
    });
  });
});

describe('reauth helper', () => {
  test('the body uses otp or password, never code', () => {
    assert.deepEqual(reauth.reauthBody('otp', '123456'), { otp: '123456' });
    assert.deepEqual(reauth.reauthBody('password', 'pw'), { password: 'pw' });
    assert.equal(reauth.REAUTH_PATH, '/api/account/reauth');
  });

  test('a refusal becomes an Error whose message the confirm dialog shows as written', () => {
    const error = new reauth.SecurityRequestError(httpFailure(400, 'VALIDATION_ERROR', 'Your password is incorrect.', { field: 'password' }), reauth.REAUTH_UNAVAILABLE);
    assert.equal(error.message, 'Your password is incorrect.');
    assert.equal(error.name, 'SecurityRequestError');
    assert.equal(error.failure.status, 400);
    assert.equal(new reauth.SecurityRequestError(interrupted('timeout'), reauth.REAUTH_UNAVAILABLE).message, 'The server took too long to respond. Try again.');
  });
});

describe('QrImage', () => {
  test('a server data: SVG renders as a 176px <img> with the alt text, never as markup', () => {
    const src = qr.qrDataUri('otpauth://totp/CardElite%20Admin:ops?secret=JBSWY3DP&issuer=CardElite%20Admin');
    const html = render(createElement(qrImage.QrImage, { src }));
    const [img] = tagsOf(html, 'img');
    assert.equal(img.src, src);
    assert.equal(img.width, '176');
    assert.equal(img.height, '176');
    assert.equal(img.alt, 'QR code for setting up CardElite Admin two-step sign-in. If you cannot scan it, use the setup key.');
    assert.equal(html.includes('<svg'), false);
    assert.ok(withClass(html, 'div', 'qrFrame').length === 1);
  });

  test('anything else renders the setup-key hint instead of an image', () => {
    for (const src of ['https://evil.example/qr.svg', 'data:image/svg+xml;utf8,<svg/>', 'javascript:alert(1)', '']) {
      const html = render(createElement(qrImage.QrImage, { src }));
      assert.equal(tagsOf(html, 'img').length, 0, src);
      assert.equal(textOf(html), 'The QR code could not be shown. Use the setup key instead.');
    }
  });
});

describe('SetupKey', () => {
  test('shows the account, the grouped key and the type, with a Copy key button and a mounted status', () => {
    const html = render(createElement(setupKey.SetupKey, { secret: 'jbswy3dpehpk3pxp', accountLabel: 'CardElite Admin (ops.lead)' }));
    const text = textOf(html);
    assert.match(text, /Account CardElite Admin \(ops\.lead\)/);
    assert.match(text, /Key JBSW Y3DP EHPK 3PXP/);
    assert.match(text, /Type Time-based, 6 digits/);
    const [button] = tagsOf(html, 'button');
    assert.equal(button.type, 'button');
    assert.match(text, /Copy key/);
    const status = tagsOf(html, 'span').find((attrs) => attrs.role === 'status');
    assert.ok(status, 'the Copied status is a live region that exists before it speaks');
    const key = tagsOf(html, 'dd').find((attrs) => classesOf(attrs).includes('keySecret'));
    assert.equal(key?.translate, 'no');
  });
});

describe('RecoveryCodes', () => {
  const codes = ['ABCDE-FGHJK', '12345-67890', 'KMNPQ-RSTVW', 'XYZ01-23456', '7890A-BCDEF', 'GHJKM-NPQRS', 'TVWXY-Z0123', '45678-9ABCD', 'EFGHJ-KMNPQ', 'RSTVW-XYZ01'];

  function codesView(saved = false) {
    return render(createElement(recoveryCodes.RecoveryCodes, { codes, username: 'ops.lead', createdAt: NOW, saved, onSavedChange: noop }));
  }

  test('lists every code once in an ordered list, under the one-time line', () => {
    const html = codesView();
    const [list] = tagsOf(html, 'ol');
    assert.equal(list['aria-label'], 'Recovery codes');
    assert.equal(list.translate, 'no');
    assert.equal(tagsOf(html, 'li').length, 10);
    for (const code of codes) assert.equal(textOf(html).split(code).length - 1, 1, code);
    assert.match(textOf(html), /^Each code signs you in once if you lose your phone\. They are shown only now\./);
  });

  test('offers Copy codes and Download .txt, then the saved checkbox', () => {
    const html = codesView();
    const text = textOf(html);
    assert.ok(text.indexOf('Copy codes') < text.indexOf('Download .txt'));
    assert.ok(text.indexOf('Download .txt') < text.indexOf('I have saved my recovery codes somewhere safe'));
    assert.equal(tagsOf(html, 'button').length, 2);
    const checkbox = tagsOf(html, 'input').find((attrs) => attrs.type === 'checkbox');
    assert.ok(checkbox);
    assert.equal('checked' in checkbox, false);
    const ticked = tagsOf(codesView(true), 'input').find((attrs) => attrs.type === 'checkbox');
    assert.equal('checked' in (ticked ?? {}), true);
  });
});

describe('DeviceList', () => {
  const current = session({ id: 'current', current: true });
  const phone = session({
    id: 'phone', client: 'mobile', userAgent: 'okhttp/4.12.0', ip: '197.210.53.4', authMethods: ['otp', 'pwd'],
    createdAt: '2026-10-11T07:00:00.000Z', lastSeenAt: '2026-10-12T08:05:00.000Z',
  });
  const recovered = session({ id: 'recovered', authMethods: ['pwd', 'recovery'], ip: '::1' });

  function list(props: Record<string, unknown>) {
    return render(createElement(deviceList.DeviceList as ElementType, { now: NOW, ...props }));
  }

  test('rows show the device label, badges, sign-in line and IP; this device has no Sign out', () => {
    const html = list({ sessions: [current, phone, recovered], onSignOut: noop });
    const [ul] = tagsOf(html, 'ul');
    assert.equal(ul.role, 'list');
    assert.equal(tagsOf(html, 'li').length, 3);
    const text = textOf(html);
    assert.match(text, /Edge on Windows This device Signed in 12 Oct 2026, 09:14 WAT · Active now IP 102\.89\.34\.1/);
    assert.match(text, /CardElite Admin app on Android Signed in 11 Oct 2026, 08:00 WAT · Active 1h ago IP 197\.210\.53\.4/);
    assert.match(text, /Edge on Windows Recovery code Signed in .* Local address \(::1\)/);
    const buttons = tagsOf(html, 'button');
    assert.equal(buttons.length, 2, 'only the other devices get a Sign out button');
    assert.deepEqual(buttons.map((attrs) => attrs['aria-label']), [
      'Sign out CardElite Admin app on Android, signed in 11 Oct 2026, 08:00 WAT',
      'Sign out Edge on Windows, signed in 12 Oct 2026, 09:14 WAT',
    ]);
    assert.equal(text.includes('No other devices are signed in.'), false);
  });

  test('icons are hidden from assistive technology', () => {
    const html = list({ sessions: [current, phone] });
    for (const svg of tagsOf(html, 'svg')) assert.equal(svg['aria-hidden'], 'true');
  });

  test('without a handler nothing can be signed out', () => {
    assert.equal(tagsOf(list({ sessions: [current, phone] }), 'button').length, 0);
  });

  test('only this device: the muted line says no other devices are signed in', () => {
    const html = list({ sessions: [current], onSignOut: noop });
    assert.match(textOf(html), /No other devices are signed in\.$/);
    assert.equal(withClass(html, 'p', 'devicesEmpty').length, 1);
  });

  test('an empty list shows only the empty text, which a host can replace', () => {
    const html = list({ sessions: [], emptyText: 'No active sessions.' });
    assert.equal(tagsOf(html, 'ul').length, 0);
    assert.equal(textOf(html), 'No active sessions.');
  });

  test('a pending sign-out shows on its row and freezes the others', () => {
    const other = session({ id: 'other', createdAt: '2026-10-10T07:00:00.000Z' });
    const html = list({ sessions: [current, phone, other], onSignOut: noop, pendingId: 'phone' });
    const [pending, frozen] = tagsOf(html, 'button');
    assert.equal(pending['aria-busy'], 'true');
    assert.equal('disabled' in pending, true);
    assert.equal('disabled' in frozen, true);
  });
});

describe('OtpField', () => {
  test('a single mono input with numeric keypad, one-time-code autofill and no maxLength', () => {
    const html = render(createElement(otpField.OtpField, { id: 'code', value: '12', onValueChange: noop }));
    const inputs = tagsOf(html, 'input');
    assert.equal(inputs.length, 1);
    const [input] = inputs;
    assert.equal(input.type, 'text');
    assert.equal(input.inputMode, 'numeric');
    assert.equal(input.autoComplete, 'one-time-code');
    assert.equal(input.name, 'otp');
    assert.equal(input.value, '12');
    assert.equal(input.translate, 'no');
    assert.equal('maxLength' in input, false);
    assert.ok(classesOf(input).includes('mono'));
  });
});

describe('EnrollFlow', () => {
  const key = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const uri = 'otpauth://totp/CardElite%20Admin:ops.lead?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=CardElite%20Admin';
  let setup: NonNullable<ReturnType<SecurityModule['toEnrollSetup']>>;

  before(() => {
    const parsed = sec.toEnrollSetup({
      otpauth_uri: uri, secret_display: mfa.groupKey(key), qr_data_uri: qr.qrDataUri(uri), account_label: 'CardElite Admin (ops.lead)',
    });
    assert.ok(parsed);
    setup = parsed;
  });

  function flow(props: Record<string, unknown> = {}) {
    return render(createElement(enrollFlow.EnrollFlow as ElementType, {
      startPath: '/api/auth/mfa/enroll/start', confirmPath: '/api/auth/mfa/enroll/confirm', username: 'ops.lead',
      onFinish: noop, ...props,
    }));
  }

  test('before the setup arrives it shows only a spinner, with no step counter text', () => {
    const html = flow();
    assert.equal(tagsOf(html, 'img').length, 0);
    const spinner = tagsOf(html, 'span').find((attrs) => attrs.role === 'img');
    assert.equal(spinner?.['aria-label'], 'Loading');
    assert.equal(textOf(html), '');
  });

  test('with the setup: scan heading, QR image, phone link, setup key behind a disclosure, then the code form', () => {
    const html = flow({ setup });
    const text = textOf(html);
    assert.match(text, /^Scan the QR code Scan this QR code with an authenticator app such as Google Authenticator, Microsoft Authenticator, 1Password or Authy\./);
    const [img] = tagsOf(html, 'img');
    assert.equal(img.src, setup.qrDataUri);
    const link = tagsOf(html, 'a').find((attrs) => classesOf(attrs).includes('appLink'));
    assert.equal(link?.href.replace(/&amp;/g, '&'), uri);
    assert.match(text, /Open in my authenticator app/);
    assert.equal(tagsOf(html, 'details').length, 1);
    assert.match(text, /Can't scan it\? Account CardElite Admin \(ops\.lead\) Key JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP Type Time-based, 6 digits/);
    assert.match(text, /Enter the 6-digit code it shows/);
    assert.doesNotMatch(text, /Step \d|of \d/);
  });

  test('the code field is labelled and numeric; the submit button carries the host label', () => {
    const html = flow({ setup, confirmLabel: 'Turn on' });
    const input = tagsOf(html, 'input').find((attrs) => attrs.name === 'otp');
    assert.ok(input);
    assert.equal(input.inputMode, 'numeric');
    assert.equal(input.autoComplete, 'one-time-code');
    const label = tagsOf(html, 'label').find((attrs) => attrs.for === input.id);
    assert.ok(label, 'the label points at the code input');
    const submit = tagsOf(html, 'button').find((attrs) => attrs.type === 'submit');
    assert.ok(submit);
    assert.match(textOf(html), /Turn on$/);
    assert.match(textOf(flow({ setup })), /Turn on and continue$/);
  });

  test('headings default to h3 and can be h2', () => {
    assert.equal(tagsOf(flow({ setup }), 'h3').length, 1);
    assert.equal(tagsOf(flow({ setup, headingLevel: 2 }), 'h2').length, 1);
  });
});

describe('house rules for the security UI', () => {
  const owned = [
    ...walk(SECURITY_DIR),
    join(APP_DIR, 'lib', 'adminSecurity.ts'),
    join(APP_DIR, '_ui', 'Confirm.tsx'),
    join(APP_DIR, '_ui', 'confirmModel.ts'),
    join(APP_DIR, 'login', 'page.tsx'),
    join(APP_DIR, 'login', 'model.ts'),
    join(APP_DIR, 'login', 'login.module.css'),
    TEST_FILE,
    fileURLToPath(new URL('./loginFlow.test.ts', import.meta.url)),
  ];

  test('no prose comments in the owned sources or these tests', () => {
    for (const file of owned) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m, relative(APP_DIR, file));
    }
  });

  test('no static inline styles in the owned components', () => {
    for (const file of owned.filter((name) => name.endsWith('.tsx'))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /style=\{\{/, relative(APP_DIR, file));
    }
  });

  test('stylesheets use tokens only: no literal colours and no raw z-index', () => {
    const sheets = owned.filter((file) => file.endsWith('.css'));
    assert.ok(sheets.length >= 2);
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
    for (const file of sheets) {
      const css = readFileSync(file, 'utf8');
      assert.doesNotMatch(css, /\[data-theme/, `${file} branches on the theme`);
      for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
        assert.doesNotMatch(value, colour, `${file} ${property}: ${value}`);
        assert.notEqual(property, 'z-index', file);
      }
    }
  });

  test('no client component imports the QR encoder, the MFA crypto, node:crypto or server-only modules', () => {
    const forbidden = /from\s+['"](?:qrcode-generator|node:crypto|[^'"]*\/lib\/(?:mfa|qr|session|jwt|supabase|guard)(?:\.ts)?)['"]/;
    const clientFiles = walk(APP_DIR).filter((file) => /\.(tsx?|mts)$/.test(file) && !file.includes(`${join('app', 'api')}`));
    let checked = 0;
    for (const file of clientFiles) {
      const source = readFileSync(file, 'utf8');
      const isClient = /^\s*['"]use client['"]/.test(source) || file.startsWith(SECURITY_DIR) || file.includes(join('app', 'login'));
      if (!isClient) continue;
      checked += 1;
      assert.equal(forbidden.test(source), false, `${relative(APP_DIR, file)} imports a server-only module`);
    }
    assert.ok(checked > 20);
  });

  test('the security components use no toast or confirm provider, so the login page can use them', () => {
    for (const file of walk(SECURITY_DIR)) {
      const source = readFileSync(file, 'utf8');
      assert.equal(/useToast|useConfirm/.test(source), false, relative(APP_DIR, file));
    }
  });

  test('the QR is shown only through <img>, never injected as markup', () => {
    for (const file of walk(SECURITY_DIR)) {
      assert.equal(readFileSync(file, 'utf8').includes('dangerouslySetInnerHTML'), false, relative(APP_DIR, file));
    }
  });
});
