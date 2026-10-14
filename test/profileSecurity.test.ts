import { afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type Context, type ReactNode } from 'react';
import { loadAppModule, loadUi, render, tagsOf, textById, textOf, withClass } from './support/uiHarness.ts';
import type { ApiFailure } from '../app/lib/apiClient.ts';
import type { DeviceSession } from '../app/lib/adminSecurity.ts';
import type { ProfileAccount } from '../app/(dashboard)/profile/model.ts';
import type { TwoStepAccount, TwoStepView } from '../app/(dashboard)/profile/securityModel.ts';

type ModelModule = typeof import('../app/(dashboard)/profile/securityModel.ts');
type ActionsModule = typeof import('../app/(dashboard)/profile/securityActions.ts');
type TwoStepModule = typeof import('../app/(dashboard)/profile/TwoStepCard.tsx');
type DevicesModule = typeof import('../app/(dashboard)/profile/DevicesCard.tsx');
type PageModule = typeof import('../app/(dashboard)/profile/page.tsx');
type HashModule = typeof import('../app/(dashboard)/profile/useHashFocus.ts');
type ConfirmModule = typeof import('../app/_ui/Confirm.tsx');
type ReauthModule = typeof import('../app/_security/reauth.ts');
type LoginModelModule = typeof import('../app/login/model.ts');

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const PROFILE_DIR = join(APP_DIR, '(dashboard)', 'profile');
const TEST_FILE = fileURLToPath(import.meta.url);
const NOW = new Date('2026-10-12T09:05:00.000Z');
const GRACE = '2026-10-26T09:05:00.000Z';
const SESSION_ID = '0f6c3f8e-2b1a-4c5d-9e8f-7a6b5c4d3e2f';
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';
const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const CODES = [
  '7KQ2M-9XH4P', 'B3N8R-TV5W2', 'C6D9F-H2J4K', 'M8N3P-Q5R7S', 'T2V4W-X6Y8Z',
  '1A3B5-C7D9E', 'F2G4H-J6K8M', 'N3P5Q-R7S9T', 'V2W4X-Y6Z8A', 'B9C7D-E5F3G',
];
const LOCK_SENTENCE = 'Too many wrong codes. Two-step sign-in is locked until 10:20 WAT. Your super administrators have been alerted.';
const noop = () => {};

const nodeRequire = createRequire(import.meta.url);
const { AppRouterContext } = nodeRequire('next/dist/shared/lib/app-router-context.shared-runtime') as {
  AppRouterContext: Context<unknown>;
};

const PROFILE: ProfileAccount = {
  id: '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f',
  username: 'ops.lead',
  email: 'adaeze.okafor@cardelite.test',
  roleTitle: 'Operations Lead',
  isSuperAdmin: false,
  lastLoginAt: '2026-10-12T07:15:00.000Z',
  createdAt: '2026-01-02T09:00:00.000Z',
};

const ROUTER = {
  push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop, hmrRefresh: noop,
};

let model: ModelModule;
let actions: ActionsModule;
let twoStep: TwoStepModule;
let devices: DevicesModule;
let page: PageModule;
let hash: HashModule;
let confirmUi: ConfirmModule;
let reauth: ReauthModule;
let loginModel: LoginModelModule;

before(async () => {
  model = await loadAppModule<ModelModule>('(dashboard)/profile/securityModel.ts');
  actions = await loadAppModule<ActionsModule>('(dashboard)/profile/securityActions.ts');
  twoStep = await loadAppModule<TwoStepModule>('(dashboard)/profile/TwoStepCard.tsx');
  devices = await loadAppModule<DevicesModule>('(dashboard)/profile/DevicesCard.tsx');
  page = await loadAppModule<PageModule>('(dashboard)/profile/page.tsx');
  hash = await loadAppModule<HashModule>('(dashboard)/profile/useHashFocus.ts');
  confirmUi = await loadUi<ConfirmModule>('Confirm.tsx');
  reauth = await loadAppModule<ReauthModule>('_security/reauth.ts');
  loginModel = await loadAppModule<LoginModelModule>('login/model.ts');
});

function mfa(patch: Partial<TwoStepAccount> = {}): TwoStepAccount {
  return {
    status: 'none',
    createdAt: null,
    confirmedAt: null,
    lastUsedAt: null,
    lockedUntil: null,
    recoveryCodesLeft: 0,
    resetAt: null,
    policy: { mode: 'off', graceEndsAt: null, requiredNow: false },
    ...patch,
  };
}

const ACTIVE = mfa({
  status: 'active',
  createdAt: '2026-10-01T08:00:00.000Z',
  confirmedAt: '2026-10-01T08:03:00.000Z',
  lastUsedAt: '2026-10-12T07:05:00.000Z',
  recoveryCodesLeft: 8,
});

const DURING_GRACE = { mode: 'all' as const, graceEndsAt: GRACE, requiredNow: false };
const ENFORCED = { mode: 'all' as const, graceEndsAt: '2026-10-01T09:05:00.000Z', requiredNow: true };

function view(account: TwoStepAccount, isSuperAdmin = false): TwoStepView {
  return model.twoStepView(account, { isSuperAdmin, now: NOW });
}

function device(patch: Partial<DeviceSession> = {}): DeviceSession {
  return {
    id: SESSION_ID,
    client: 'web',
    userAgent: EDGE_UA,
    ip: '102.89.34.1',
    authMethods: ['pwd'],
    createdAt: '2026-10-12T08:14:00.000Z',
    lastSeenAt: '2026-10-12T09:04:30.000Z',
    expiresAt: '2026-10-12T16:14:00.000Z',
    current: false,
    ...patch,
  };
}

const THIS_DEVICE = device({ id: '11111111-1111-4111-8111-111111111111', current: true, authMethods: ['otp', 'pwd'] });
const PHONE_APP = device({
  id: '22222222-2222-4222-8222-222222222222',
  client: 'mobile',
  userAgent: 'okhttp/4.9.0',
  createdAt: '2026-10-11T07:00:00.000Z',
});
const ANDROID_WEB = device({ id: '33333333-3333-4333-8333-333333333333', userAgent: ANDROID_CHROME_UA, ip: '::1' });

function httpFailure(status: number, code: string | null, message: string): ApiFailure {
  return { kind: 'http', status, code, message, requestId: 'req_profile_sec', details: null, outcomeUnknown: false };
}

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

interface Reply {
  status: number;
  body: unknown;
}

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];

function serve(handler: (call: FetchCall) => Reply): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof raw === 'string' ? JSON.parse(raw) : raw,
    };
    calls.push(call);
    const reply = handler(call);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function failBody(code: string | null, error: string, details: unknown = undefined) {
  return { success: false, error, ...(code ? { code } : {}), ...(details ? { details } : {}), request_id: 'req_test' };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
});

function withProviders(...children: ReactNode[]): string {
  return render(createElement(
    AppRouterContext.Provider,
    { value: ROUTER },
    createElement(confirmUi.ConfirmProvider, null, ...children),
  ));
}

function source(name: string): string {
  return readFileSync(join(PROFILE_DIR, name), 'utf8');
}

describe('reading GET /api/account/mfa', () => {
  test('keeps every field the card shows, and never anything secret', () => {
    const parsed = model.toTwoStepAccount({
      status: 'active',
      created_at: '2026-10-01T08:00:00.000Z',
      confirmed_at: '2026-10-01T08:03:00.000Z',
      last_used_at: '2026-10-12T07:05:00.000Z',
      locked_until: null,
      recovery_codes_left: 8,
      reset_at: '2026-09-30T10:00:00.000Z',
      secret_enc: 'never-shown',
      policy: { mfa_mode: 'all', mfa_grace_ends_at: GRACE, mfa_required_now: false },
    });
    assert.deepEqual(parsed, {
      status: 'active',
      createdAt: '2026-10-01T08:00:00.000Z',
      confirmedAt: '2026-10-01T08:03:00.000Z',
      lastUsedAt: '2026-10-12T07:05:00.000Z',
      lockedUntil: null,
      recoveryCodesLeft: 8,
      resetAt: '2026-09-30T10:00:00.000Z',
      policy: { mode: 'all', graceEndsAt: GRACE, requiredNow: false },
    });
    assert.ok(!JSON.stringify(parsed).includes('never-shown'));
  });

  test('a body without a status is unreadable; odd values fall back safely', () => {
    assert.equal(model.toTwoStepAccount({}), null);
    assert.equal(model.toTwoStepAccount({ status: 7 }), null);
    assert.deepEqual(model.toTwoStepAccount({
      status: 'enabled',
      created_at: 'not a time',
      recovery_codes_left: -3,
      locked_until: '',
      policy: 'all',
    }), mfa());
    assert.equal(model.toTwoStepAccount({ status: 'pending', recovery_codes_left: 2.5 })?.recoveryCodesLeft, 0);
  });
});

describe('the two-step card, state by state', () => {
  test('off and not required: an invitation to set it up', () => {
    assert.deepEqual(view(mfa()), {
      status: 'none',
      badge: { label: 'Off', tone: 'neutral' },
      locked: false,
      notices: [],
      lead: 'Add a second step so a stolen password is not enough to get into the console.',
      onSince: null,
      lastUsed: null,
      codes: null,
      help: null,
      canSetUp: true,
      canReplaceCodes: false,
    });
  });

  test('off during the grace: a warning with the date, the time it starts and the days left', () => {
    assert.deepEqual(view(mfa({ policy: DURING_GRACE })).notices, [{
      key: 'required',
      tone: 'warning',
      title: 'Required by 26 Oct 2026',
      text: 'From 26 Oct 2026, 10:05 WAT you will have to set it up when you sign in. It takes about two minutes. 14 days left.',
    }]);
    const undated = view(mfa({ policy: { mode: 'all', graceEndsAt: null, requiredNow: false } })).notices;
    assert.deepEqual(undated.map(({ tone, title }) => ({ tone, title })), [{ tone: 'warning', title: 'Required soon' }]);
  });

  test('off after the grace: required now, at the next sign-in', () => {
    const notices = view(mfa({ policy: ENFORCED })).notices;
    assert.deepEqual(notices, [{
      key: 'required',
      tone: 'danger',
      title: null,
      text: 'Required now. You will have to set it up the next time you sign in.',
    }]);
    const lapsed = view(mfa({ policy: { mode: 'all', graceEndsAt: '2026-10-12T09:00:00.000Z', requiredNow: false } }));
    assert.equal(lapsed.notices[0].tone, 'danger');
  });

  test('setup not finished: says when it started and that starting again makes a new QR code', () => {
    const pending = view(mfa({ status: 'pending', createdAt: '2026-10-12T08:55:00.000Z', policy: DURING_GRACE }));
    assert.deepEqual(pending.badge, { label: 'Setup not finished', tone: 'neutral' });
    assert.equal(
      pending.lead,
      'You started setting this up on 12 Oct 2026, 09:55 WAT but did not finish. Starting again makes a new QR code; '
      + 'delete any older CardElite Admin entry from your app.',
    );
    assert.equal(pending.notices[0].key, 'required');
    assert.equal(pending.canSetUp, true);
    assert.match(view(mfa({ status: 'pending' })).lead ?? '', /^You started setting this up but did not finish\./);
  });

  test('on: since when, the last code, the codes left, the app hint and the lost-phone help', () => {
    const on = view({ ...ACTIVE, policy: ENFORCED });
    assert.deepEqual(on.badge, { label: 'On', tone: 'success' });
    assert.deepEqual(on.notices, [], 'no requirement notice once it is on');
    assert.equal(on.onSince, '01 Oct 2026, 09:03 WAT');
    assert.equal(on.lastUsed, '12 Oct 2026, 08:05 WAT · 2h ago');
    assert.deepEqual(on.codes, { left: 8, text: '8 left', tone: 'neutral' });
    assert.equal(on.help, 'Lost your phone? Sign in with a recovery code, then ask a super administrator to reset two-step sign-in.');
    assert.equal(on.lead, null);
    assert.equal(on.canSetUp, false);
    assert.equal(on.canReplaceCodes, true);
    assert.equal(view({ ...ACTIVE, lastUsedAt: null }).lastUsed, 'Not used yet');
  });

  test('a super administrator also learns that a sole super admin is reset from the database', () => {
    assert.equal(
      view(ACTIVE, true).help,
      'Lost your phone? Sign in with a recovery code, then ask a super administrator to reset two-step sign-in. '
      + 'If you are the only super administrator, it is reset from the database.',
    );
  });

  test('locked: the badge, when sign-in works again rounded up in WAT, and a nudge if it was not them', () => {
    const locked = view({ ...ACTIVE, lockedUntil: '2026-10-12T09:19:30.000Z' });
    assert.deepEqual(locked.badge, { label: 'Locked', tone: 'danger' });
    assert.equal(locked.locked, true);
    assert.deepEqual(locked.notices, [{
      key: 'locked',
      tone: 'danger',
      title: null,
      text: 'Locked until 10:20 WAT after too many wrong codes. If you did not enter those codes, change your password.',
    }]);
    assert.equal(locked.canReplaceCodes, false);
  });

  test('a 24-hour lock always names the day it ends', () => {
    const daily = view({ ...ACTIVE, lockedUntil: '2026-10-13T09:05:10.000Z' });
    assert.match(daily.notices[0].text, /^Locked until 13 Oct, 10:06 WAT after too many wrong codes\./);
    const lagosMidnight = view({ ...ACTIVE, lockedUntil: '2026-10-12T23:30:00.000Z' });
    assert.match(lagosMidnight.notices[0].text, /^Locked until 13 Oct, 00:30 WAT /);
  });

  test('a lock that has already ended is ignored', () => {
    const ended = view({ ...ACTIVE, lockedUntil: '2026-10-12T09:00:00.000Z' });
    assert.equal(ended.locked, false);
    assert.equal(ended.badge.label, 'On');
    assert.equal(ended.canReplaceCodes, true);
    assert.equal(model.lockEndsAt({ ...ACTIVE, lockedUntil: '2026-10-12T09:00:00.000Z' }, NOW), null);
    assert.equal(model.lockEndsAt({ ...ACTIVE, lockedUntil: '2026-10-12T09:19:30.000Z' }, NOW), Date.parse('2026-10-12T09:19:30.000Z'));
    assert.equal(model.lockEndsAt(mfa({ lockedUntil: '2026-10-12T09:19:30.000Z' }), NOW), null);
    assert.equal(model.lockEndsAt(undefined, NOW), null);
  });

  test('a reset newer than the last setup is explained, an older one is not', () => {
    const reset = view(mfa({ resetAt: '2026-10-11T12:30:00.000Z', policy: DURING_GRACE }));
    assert.deepEqual(reset.notices[0], {
      key: 'reset',
      tone: 'warning',
      title: null,
      text: 'A super administrator reset your two-step sign-in on 11 Oct 2026, 13:30 WAT.',
    });
    assert.equal(reset.notices[1].key, 'required');
    assert.equal(view(mfa({ status: 'pending', resetAt: '2026-10-11T12:30:00.000Z' })).notices[0].key, 'reset');
    assert.deepEqual(view({ ...ACTIVE, resetAt: '2026-09-30T10:00:00.000Z' }).notices, []);
  });

  test('few recovery codes warn, none left is a danger with a prompt to get new ones', () => {
    assert.deepEqual(view({ ...ACTIVE, recoveryCodesLeft: 3 }).codes, { left: 3, text: '3 left', tone: 'warning' });
    const none = view({ ...ACTIVE, recoveryCodesLeft: 0 });
    assert.deepEqual(none.codes, { left: 0, text: 'None left', tone: 'danger' });
    assert.deepEqual(none.notices, [{
      key: 'codes',
      tone: 'danger',
      title: null,
      text: 'You have no recovery codes left. Get new ones so you can still sign in if you lose your phone.',
    }]);
  });

  test('finishing setup refreshes the page, unless the session was not renewed, which opens the expired dialog', () => {
    assert.deepEqual(model.setupFinish({ sessionRenewed: false }), { expire: true, refresh: false });
    assert.deepEqual(model.setupFinish({ sessionRenewed: true }), { expire: false, refresh: true });
    assert.deepEqual(model.setupFinish({ sessionRenewed: null }), { expire: false, refresh: true });
  });
});

describe('two-step confirms', () => {
  test('setup asks for the password, warns about the other devices and changes nothing yet', () => {
    assert.deepEqual(model.setupConfirm(), {
      title: 'Set up two-step sign-in?',
      message:
        'Have your phone ready with an authenticator app, such as Google Authenticator, Microsoft Authenticator, 1Password or Authy. Nothing changes until you enter a code from it.',
      consequences: [
        'Turning it on signs you out on your other devices, including the CardElite Admin app. You stay signed in here.',
        'After that, every sign-in asks for a 6-digit code from the app.',
      ],
      credential: { kind: 'password' },
      confirmLabel: 'Continue',
      pendingLabel: 'Checking your password…',
    });
  });

  test('new recovery codes ask for a code and say the old ones stop working', () => {
    assert.deepEqual(model.newCodesConfirm(8), {
      title: 'Get new recovery codes?',
      message: 'Your current recovery codes stop working as soon as the new ones are made.',
      details: [{ label: 'Codes left now', value: '8' }],
      consequences: ['You see the new codes once. Save them before you close the window.'],
      credential: { kind: 'otp' },
      confirmLabel: 'Get new codes',
      pendingLabel: 'Making new codes…',
    });
    assert.equal(model.newCodesConfirm(-1).details?.[0].value, '0');
    assert.equal(model.newCodesConfirm(Number.NaN).details?.[0].value, '0');
  });
});

describe('device confirms and toasts', () => {
  test('one web device: named, with when it signed in and its address', () => {
    assert.deepEqual(model.deviceSignOutConfirm(device(), 'Edge on Windows'), {
      title: 'Sign out Edge on Windows?',
      message: 'That device is signed out straight away and has to sign in again.',
      details: [
        { label: 'Signed in', value: '12 Oct 2026, 09:14 WAT' },
        { label: 'IP address', value: '102.89.34.1', mono: true },
      ],
      confirmLabel: 'Sign out',
      pendingLabel: 'Signing out…',
    });
  });

  test('the mobile app is told when it will notice; local and missing details read plainly', () => {
    const app = model.deviceSignOutConfirm({ ...PHONE_APP, ip: '::1', createdAt: null }, 'CardElite Admin app on Android');
    assert.equal(app.title, 'Sign out CardElite Admin app on Android?');
    assert.equal(
      app.message,
      'That device is signed out straight away and has to sign in again. The app goes back to its sign-in screen the next time it reaches the server.',
    );
    assert.deepEqual(app.details, [
      { label: 'Signed in', value: 'Not recorded' },
      { label: 'IP address', value: '::1 (local)', mono: true },
    ]);
    assert.equal(model.deviceSignOutConfirm({ ...PHONE_APP, ip: null }, 'x').details?.[1].value, 'Not recorded');
    assert.equal(model.deviceSignOutConfirm(device(), 'x').tone, undefined);
  });

  test('other devices: counted, and honest when this device has no listed session', () => {
    assert.deepEqual(model.othersSignOutConfirm(2, true), {
      title: 'Sign out your other devices?',
      message: 'Every other session ends straight away, on the web and in the CardElite Admin app. This device stays signed in.',
      details: [{ label: 'Other devices', value: '2' }],
      confirmLabel: 'Sign out other devices',
      pendingLabel: 'Signing out your other devices…',
    });
    assert.equal(
      model.othersSignOutConfirm(1, false).message,
      'Every other session ends straight away, on the web and in the CardElite Admin app. You will have to sign in again on this device too.',
    );
  });

  test('everywhere is a danger confirm that ends this session too', () => {
    assert.deepEqual(model.signOutEverywhereConfirm(), {
      tone: 'danger',
      title: 'Sign out everywhere?',
      message: 'Every session ends, including this one, and you go back to the sign-in page.',
      consequences: ['The CardElite Admin app goes back to its sign-in screen the next time it reaches the server.'],
      confirmLabel: 'Sign out everywhere',
      pendingLabel: 'Signing out everywhere…',
    });
  });

  test('toasts name the device or count the others', () => {
    assert.equal(model.deviceSignedOutText('Edge on Windows', true), 'Signed out Edge on Windows.');
    assert.equal(model.deviceSignedOutText('Edge on Windows', false), 'Edge on Windows was already signed out.');
    assert.equal(model.othersSignedOutText(2), 'Signed out 2 other devices.');
    assert.equal(model.othersSignedOutText(1), 'Signed out 1 other device.');
    assert.equal(model.othersSignedOutText(0), 'No other devices were signed in.');
  });

  test('counting other devices and finding this one', () => {
    assert.equal(model.otherDeviceCount([THIS_DEVICE, PHONE_APP, ANDROID_WEB]), 2);
    assert.equal(model.hasThisDevice([THIS_DEVICE, PHONE_APP]), true);
    assert.equal(model.hasThisDevice([PHONE_APP]), false);
    assert.equal(model.otherDeviceCount([]), 0);
  });
});

describe('reading the action responses', () => {
  test('new recovery codes need ten well-formed codes', () => {
    assert.deepEqual(model.toNewRecoveryCodes({ recovery_codes: CODES, recovery_codes_left: 10 }), {
      codes: CODES, left: 10, warning: null,
    });
    assert.deepEqual(
      model.toNewRecoveryCodes({ recovery_codes: CODES, warning: 'Not in the audit log.' }),
      { codes: CODES, left: 10, warning: 'Not in the audit log.' },
    );
    assert.equal(model.toNewRecoveryCodes({ recovery_codes: [...CODES.slice(1), 'lower-case'] }), null);
    assert.equal(model.toNewRecoveryCodes({ recovery_codes: [] }), null);
    assert.equal(model.toNewRecoveryCodes({}), null);
  });

  test('a device sign-out says whether it was still signed in', () => {
    assert.deepEqual(model.toDeviceSignOut({ revoked: true }), { revoked: true, warning: null });
    assert.deepEqual(model.toDeviceSignOut({ revoked: false }), { revoked: false, warning: null });
    assert.equal(model.toDeviceSignOut({}), null);
  });

  test('signing out the others reports the count and whether this session was renewed', () => {
    assert.deepEqual(model.toOthersSignOut({ sessions_revoked: 2, session_renewed: true }), {
      revoked: 2, sessionRenewed: true, warning: null,
    });
    assert.equal(model.toOthersSignOut({ sessions_revoked: 0 })?.sessionRenewed, false);
    assert.equal(model.toOthersSignOut({ sessions_revoked: -1, session_renewed: true }), null);
    assert.equal(model.toOthersSignOut({ session_renewed: true }), null);
  });

  test('session ids are encoded into the path', () => {
    assert.equal(model.sessionPath(SESSION_ID), `/api/account/sessions/${SESSION_ID}`);
    assert.equal(model.sessionPath('a/b?c'), '/api/account/sessions/a%2Fb%3Fc');
  });
});

describe('the requests behind the confirms', () => {
  const SETUP_BODY = {
    success: true,
    otpauth_uri: 'otpauth://totp/CardElite%20Admin:ops.lead?secret=JBSWY3DPEHPK3PXP&issuer=CardElite%20Admin',
    secret_display: 'JBSW Y3DP EHPK 3PXP',
    qr_data_uri: 'data:image/svg+xml;base64,PHN2Zy8+',
    account_label: 'CardElite Admin (ops.lead)',
  };

  test('setup confirms the password first, then starts setup with an empty body', async () => {
    serve((call) => call.url === '/api/account/reauth'
      ? { status: 200, body: { success: true, reauth_at: NOW.toISOString(), valid_for_secs: 300 } }
      : { status: 200, body: SETUP_BODY });
    const setup = await actions.startProfileSetup('Correct-Horse-Battery-9');
    assert.deepEqual(setup, {
      otpauthUri: SETUP_BODY.otpauth_uri,
      secretDisplay: 'JBSW Y3DP EHPK 3PXP',
      qrDataUri: SETUP_BODY.qr_data_uri,
      accountLabel: 'CardElite Admin (ops.lead)',
    });
    assert.deepEqual(calls, [
      { url: '/api/account/reauth', method: 'POST', body: { password: 'Correct-Horse-Battery-9' } },
      { url: '/api/account/mfa/enroll/start', method: 'POST', body: {} },
    ]);
  });

  test('a wrong password keeps the dialog open with its message and never starts setup', async () => {
    serve(() => ({ status: 400, body: failBody('VALIDATION_ERROR', 'Your password is incorrect.', { field: 'password' }) }));
    await assert.rejects(actions.startProfileSetup('nope'), (error: unknown) => {
      assert.ok(error instanceof reauth.SecurityRequestError);
      assert.equal(error.message, 'Your password is incorrect.');
      return true;
    });
    assert.equal(calls.length, 1);
  });

  test('a refused or broken start explains itself', async () => {
    serve((call) => call.url === '/api/account/reauth'
      ? { status: 200, body: { success: true } }
      : { status: 409, body: failBody('STATE_CONFLICT', 'Two-step sign-in is already on.', { reason: 'already_active' }) });
    await assert.rejects(actions.startProfileSetup('pw'), /Two-step sign-in is already on\./);
    serve((call) => call.url === '/api/account/reauth'
      ? { status: 200, body: { success: true } }
      : { status: 502, body: { message: 'upstream' } });
    await assert.rejects(actions.startProfileSetup('pw'), /^SecurityRequestError: Two-step sign-in setup is unavailable right now\. Try again shortly\.$/);
  });

  test('new recovery codes send the code inline, as otp, with no separate identity check', async () => {
    serve(() => ({ status: 200, body: { success: true, recovery_codes: CODES, recovery_codes_left: 10, audit_recorded: true } }));
    const result = await actions.replaceRecoveryCodes('123456');
    assert.deepEqual(result, { codes: CODES, left: 10, warning: null });
    assert.deepEqual(calls, [{ url: '/api/account/mfa/recovery-codes', method: 'POST', body: { otp: '123456' } }]);
  });

  test('a wrong code, a lock or an unreadable answer keeps the confirm open with the right words', async () => {
    serve(() => ({
      status: 400,
      body: failBody('VALIDATION_ERROR', 'That code did not work. Codes work once, so if you just used it, wait for the next one.', { field: 'otp' }),
    }));
    await assert.rejects(actions.replaceRecoveryCodes('111111'), /That code did not work\. Codes work once/);
    serve(() => ({
      status: 429,
      body: failBody('RATE_LIMITED', LOCK_SENTENCE, { reason: 'mfa_locked', locked_until: '2026-10-12T09:19:30.000Z' }),
    }));
    await assert.rejects(actions.replaceRecoveryCodes('222222'), (error: unknown) => {
      assert.equal((error as Error).message, LOCK_SENTENCE);
      return true;
    });
    serve(() => ({ status: 200, body: { success: true, recovery_codes: ['nope'] } }));
    await assert.rejects(actions.replaceRecoveryCodes('333333'), /could not be read/);
    serve(() => ({ status: 500, body: {} }));
    await assert.rejects(actions.replaceRecoveryCodes('444444'), /^SecurityRequestError: Your recovery codes could not be changed right now\. Try again shortly\.$/);
  });

  test('one device is signed out with a DELETE on its own path', async () => {
    serve(() => ({ status: 200, body: { success: true, revoked: true, audit_recorded: true } }));
    assert.deepEqual(await actions.signOutDevice(SESSION_ID), { revoked: true, warning: null });
    assert.deepEqual(calls, [{ url: `/api/account/sessions/${SESSION_ID}`, method: 'DELETE', body: undefined }]);
    serve(() => ({ status: 409, body: failBody('STATE_CONFLICT', 'This is the device you are using. Use Log out instead.') }));
    await assert.rejects(actions.signOutDevice(SESSION_ID), /Use Log out instead\./);
  });

  test('the others are signed out with a bodiless POST, passing session_renewed through', async () => {
    serve(() => ({ status: 200, body: { success: true, sessions_revoked: 2, session_renewed: false, audit_recorded: true } }));
    assert.deepEqual(await actions.signOutOtherDevices(), { revoked: 2, sessionRenewed: false, warning: null });
    assert.deepEqual(calls, [{ url: '/api/account/sessions/sign-out-others', method: 'POST', body: undefined }]);
  });

  test('everywhere is a bodiless POST; its failures keep the confirm open', async () => {
    serve(() => ({ status: 200, body: { success: true, sessions_revoked: 3, audit_recorded: true } }));
    assert.equal(await actions.signOutEverywhere(), true);
    assert.deepEqual(calls, [{ url: '/api/account/sessions/sign-out-everywhere', method: 'POST', body: undefined }]);
    serve(() => ({ status: 500, body: failBody('INTERNAL_ERROR', 'You could not be signed out everywhere. Try again.') }));
    await assert.rejects(actions.signOutEverywhere(), /^SecurityRequestError: You could not be signed out everywhere\. Try again\.$/);
    serve(() => ({ status: 503, body: {} }));
    await assert.rejects(actions.signOutEverywhere(), /^SecurityRequestError: You could not be signed out everywhere\. Try again\.$/);
  });
});

function twoStepPanel(props: Partial<Parameters<TwoStepModule['TwoStepPanel']>[0]> = {}): string {
  return render(createElement(twoStep.TwoStepPanel, {
    view: null,
    failure: null,
    retrying: false,
    onRetry: noop,
    onSetUp: noop,
    onNewCodes: noop,
    ...props,
  }));
}

function devicesPanel(props: Partial<Parameters<DevicesModule['DevicesPanel']>[0]> = {}): string {
  return render(createElement(devices.DevicesPanel, {
    sessions: null,
    failure: null,
    retrying: false,
    now: NOW,
    onRetry: noop,
    onSignOut: noop,
    onSignOutOthers: noop,
    onSignOutEverywhere: noop,
    ...props,
  }));
}

function regionOf(html: string, id: string) {
  const card = tagsOf(html, 'div').find((attrs) => attrs.id === id);
  assert.ok(card, `card #${id}`);
  assert.equal(card.role, 'region');
  const heading = tagsOf(html, 'h2').find((attrs) => attrs.id === card['aria-labelledby']);
  assert.ok(heading, 'the region is named by its heading');
  return { card, heading };
}

describe('the two-step card markup', () => {
  test('is the #two-step-sign-in region, named by a focusable heading, loading on its own', () => {
    const html = twoStepPanel();
    const { card, heading } = regionOf(html, 'two-step-sign-in');
    assert.ok(card.class?.split(' ').includes('section'), 'the card clears the sticky top bar when scrolled to');
    assert.equal(heading.tabindex, '-1');
    assert.equal(textById(html, heading.id), 'Two-step sign-in');
    assert.match(textOf(html), /A 6-digit code from an authenticator app, asked for after your password\./);
    assert.ok(tagsOf(html, 'div').some((attrs) => attrs['aria-busy'] === 'true'));
    assert.equal(tagsOf(html, 'button').length, 0);
  });

  test('a load failure retries in place', () => {
    const html = twoStepPanel({ failure: httpFailure(500, 'INTERNAL_ERROR', 'Your two-step sign-in could not be loaded. Try again.') });
    assert.match(
      textOf(html),
      /Your two-step sign-in could not be loaded Your two-step sign-in could not be loaded\. Try again\. Request ID req_profile_sec Try again$/,
    );
    assert.equal(tagsOf(html, 'button').length, 1, 'only the retry button, no setup action without data');
  });

  test('off: the lead, the Off badge and one primary Set up button', () => {
    const html = twoStepPanel({ view: view(mfa()) });
    const text = textOf(html);
    assert.match(text, /Two-step sign-in A 6-digit code .* Off Add a second step so a stolen password is not enough to get into the console\. Set up two-step sign-in$/);
    const buttons = tagsOf(html, 'button');
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].type, 'button');
    assert.ok(buttons[0].class?.split(' ').includes('primary'));
  });

  test('during the grace the requirement shows as a titled warning', () => {
    const html = twoStepPanel({ view: view(mfa({ policy: DURING_GRACE })) });
    assert.equal(withClass(html, 'div', 'warning').length, 1);
    assert.match(textOf(html), /Required by 26 Oct 2026 From 26 Oct 2026, 10:05 WAT you will have to set it up when you sign in\. It takes about two minutes\. 14 days left\./);
  });

  test('on: rows, the codes badge, the app callout, the help and Get new recovery codes', () => {
    const html = twoStepPanel({ view: view(ACTIVE) });
    const text = textOf(html);
    for (const expected of [
      'On since 01 Oct 2026, 09:03 WAT',
      'Last code used 12 Oct 2026, 08:05 WAT · 2h ago',
      'Recovery codes 8 left',
      'CardElite Admin app Type your password and then your 6-digit code in the Password field, with no space.',
      'Lost your phone? Sign in with a recovery code',
    ]) {
      assert.ok(text.includes(expected), expected);
    }
    assert.ok(withClass(html, 'div', 'callout').length === 1);
    const [button] = tagsOf(html, 'button');
    assert.equal(textOf(html.slice(html.lastIndexOf('<button'))).startsWith('Get new recovery codes…'), true);
    assert.equal('disabled' in button, false);
    assert.ok(withClass(html, 'span', 'success').length >= 1, 'the On badge is green');
  });

  test('locked: the Locked badge, the danger notice and no new codes until it ends', () => {
    const html = twoStepPanel({ view: view({ ...ACTIVE, lockedUntil: '2026-10-12T09:19:30.000Z' }) });
    assert.match(textOf(html), /Locked Locked until 10:20 WAT after too many wrong codes\./);
    const [button] = tagsOf(html, 'button');
    assert.ok('disabled' in button);
    assert.equal(withClass(html, 'div', 'danger').length, 1);
  });

  test('whatever the card hosts, such as its dialogs, renders inside it', () => {
    const html = twoStepPanel({ view: view(mfa()), children: createElement('output', { id: 'hosted' }, 'dialog') });
    const card = html.indexOf('id="two-step-sign-in"');
    assert.ok(card >= 0 && html.indexOf('id="hosted"') > card);
  });
});

describe('the signed-in devices card markup', () => {
  test('is the #signed-in-devices region with Sign out everywhere always in its footer', () => {
    const html = devicesPanel();
    const { heading } = regionOf(html, 'signed-in-devices');
    assert.equal(heading.tabindex, '-1');
    assert.equal(textById(html, heading.id), 'Signed-in devices');
    assert.match(textOf(html), /Where your account is signed in now, on the web console and in the CardElite Admin app\./);
    const buttons = tagsOf(html, 'button');
    assert.equal(buttons.length, 1);
    assert.ok(buttons[0].class?.split(' ').includes('dangerSubtle'));
    assert.equal(textById(html, buttons[0]['aria-describedby']), 'Ends every session, including this one.');
    assert.match(textOf(html), /Ends every session, including this one\. Sign out everywhere…$/);
  });

  test('this device first with its badge and no button; the others each get a named Sign out', () => {
    const html = devicesPanel({ sessions: [THIS_DEVICE, PHONE_APP, ANDROID_WEB] });
    const text = textOf(html);
    assert.ok(text.includes('Edge on Windows This device'));
    assert.ok(text.includes('CardElite Admin app on Android'));
    assert.ok(text.includes('Chrome on Android'));
    assert.ok(text.includes('Local address (::1)'));
    const labels = tagsOf(html, 'button').map((button) => button['aria-label']).filter(Boolean);
    assert.deepEqual(labels, [
      'Sign out CardElite Admin app on Android, signed in 11 Oct 2026, 08:00 WAT',
      'Sign out Chrome on Android, signed in 12 Oct 2026, 09:14 WAT',
    ]);
    assert.ok(text.includes('Sign out other devices'));
  });

  test('with no other device, there is no Sign out other devices button', () => {
    for (const sessions of [[THIS_DEVICE], []]) {
      const html = devicesPanel({ sessions });
      assert.ok(!textOf(html).includes('Sign out other devices'));
      assert.ok(textOf(html).includes('No other devices are signed in.'));
    }
  });

  test('loading and failure stay inside the card', () => {
    assert.ok(tagsOf(devicesPanel(), 'div').some((attrs) => attrs['aria-busy'] === 'true'));
    const html = devicesPanel({ failure: httpFailure(500, 'INTERNAL_ERROR', 'Your signed-in devices could not be loaded. Try again.') });
    assert.match(textOf(html), /Your signed-in devices could not be loaded Your signed-in devices could not be loaded\. Try again\./);
    assert.match(textOf(html), /Sign out everywhere…$/);
  });
});

describe('the profile page with its two new cards', () => {
  test('the loading state shows four cards', () => {
    const text = textOf(render(createElement(page.default)));
    assert.match(text, /Loading your profile… Account Change password Two-step sign-in Signed-in devices$/);
  });

  test('the two cards come after Change password, each with its own data, and devices reload after setup', () => {
    const text = source('page.tsx');
    const order = ['<AccountDetails', '<PasswordCard', '<TwoStepCard', '<DevicesCard'].map((tag) => text.indexOf(tag));
    assert.ok(order.every((index) => index > 0));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.match(text, /<TwoStepCard account=\{account\} onSignInChange=\{devicesChanged\} \/>/);
    assert.match(text, /<DevicesCard account=\{account\} version=\{devicesVersion\} \/>/);
    assert.match(source('TwoStepCard.tsx'), /useResource<TwoStepAccount>\(\s*'profile-two-step',\s*\(signal\) => apiRequest\(MFA_PATH, \{ signal, select: toTwoStepAccount \}\),\s*\)/);
    assert.match(source('DevicesCard.tsx'), /`profile-devices:\$\{version\}`,\s*\(signal\) => apiRequest\(SESSIONS_PATH, \{ signal, select: toDeviceSessions \}\),\s*\{ pollMs: DEVICES_POLL_MS \},/);
    assert.equal(model.MFA_PATH, '/api/account/mfa');
    assert.equal(model.SESSIONS_PATH, '/api/account/sessions');
    assert.equal(model.DEVICES_POLL_MS, 60000);
  });

  test('the live cards render under the shell providers and start by loading', () => {
    const html = withProviders(
      createElement(twoStep.TwoStepCard, { account: PROFILE }),
      createElement(devices.DevicesCard, { account: PROFILE }),
    );
    regionOf(html, 'two-step-sign-in');
    regionOf(html, 'signed-in-devices');
    assert.equal(tagsOf(html, 'div').filter((attrs) => attrs['aria-busy'] === 'true').length, 2);
  });
});

describe('how the cards act', () => {
  const twoStepSource = () => source('TwoStepCard.tsx');
  const devicesSource = () => source('DevicesCard.tsx');

  test('setup: password confirm, then the in-session flow in a dialog that cannot close while codes show', () => {
    const text = twoStepSource();
    assert.match(text, /\.\.\.setupConfirm\(\),\s*returnFocusTo: focusTarget,\s*action: async \(\{ credential \}\) => \{\s*attempted = true;\s*return startProfileSetup\(credential \?\? ''\);/);
    assert.match(text, /static=\{stage === 'codes'\}\s*hideClose=\{stage === 'codes'\}/);
    assert.match(text, /startPath=\{SETUP_START_PATH\}\s*confirmPath=\{SETUP_CONFIRM_PATH\}/);
    assert.match(text, /setup=\{setup\}/);
    assert.equal(model.SETUP_START_PATH, '/api/account/mfa/enroll/start');
    assert.equal(model.SETUP_CONFIRM_PATH, '/api/account/mfa/enroll/confirm');
    assert.equal(model.RECOVERY_CODES_PATH, '/api/account/mfa/recovery-codes');
  });

  test('finishing setup toasts, then either opens the expired dialog or refreshes the page and the devices', () => {
    const text = twoStepSource();
    assert.match(
      text,
      /notify\(ENABLED_TOAST, 'success'\);\s*if \(setupFinish\(result\)\.expire\) \{\s*notifySessionExpired\(\);\s*return;\s*\}\s*void refresh\(\);\s*changed\.current\?\.\(\);\s*router\.refresh\(\);/,
    );
    assert.equal(model.ENABLED_TOAST, 'Two-step sign-in is on.');
  });

  test('an expired identity check during Start again asks for the password again instead of failing', () => {
    assert.match(twoStepSource(), /if \(failure\.kind === 'http' && failure\.status === 401\) return;/);
    assert.match(twoStepSource(), /failure\.code === 'REAUTH_REQUIRED'\) \{\s*void beginSetup\(\);\s*return;\s*\}/);
  });

  test('new recovery codes: code confirm, then a static dialog whose Done waits for the saved box', () => {
    const text = twoStepSource();
    assert.match(text, /\.\.\.newCodesConfirm\(data\.recoveryCodesLeft\),\s*returnFocusTo: focusTarget,\s*action: async \(\{ credential \}\) => \{\s*attempted = true;\s*return replaceRecoveryCodes\(credential \?\? ''\);/);
    assert.match(text, /open\s*static\s*hideClose\s*size="md"\s*title=\{NEW_CODES_MODAL_TITLE\}/);
    assert.match(text, /disabled=\{!codesSaved\} onClick=\{closeCodes\}/);
    assert.match(text, /<RecoveryCodes\s*codes=\{newCodes\.codes\}/);
  });

  test('a lock refreshes the card when it ends', () => {
    assert.match(twoStepSource(), /const lockEnds = lockEndsAt\(data\);/);
    assert.match(twoStepSource(), /window\.setTimeout\(\(\) => \{\s*void refresh\(\{ background: true \}\);\s*\}, wait\);/);
  });

  test('signing out the others opens the expired dialog when this session was not renewed', () => {
    assert.match(
      devicesSource(),
      /if \(!outcome\.sessionRenewed\) \{\s*notifySessionExpired\(\);\s*return;\s*\}\s*mutate\(\(list\) => list\?\.filter\(\(item\) => item\.current\)\);/,
    );
  });

  test('one device is removed straight away, then the list is refreshed', () => {
    assert.match(devicesSource(), /action: \(\) => signOutDevice\(session\.id\),/);
    assert.match(devicesSource(), /mutate\(\(list\) => list\?\.filter\(\(item\) => item\.id !== session\.id\)\);\s*keepFocus\(\);/);
  });

  test('Sign out everywhere shares the shell confirm and the logout tail', () => {
    assert.match(devicesSource(), /const signOutEverywhere = useSignOutEverywhere\(account\.username\);/);
    assert.match(devicesSource(), /void signOutEverywhere\(\(\) => everywhereRef\.current\);/);
  });
});

describe('deep links to the cards', () => {
  test('the hash must name the card exactly', () => {
    assert.equal(hash.isHashFor('#two-step-sign-in', model.TWO_STEP_ANCHOR), true);
    assert.equal(hash.isHashFor('#signed-in-devices', model.DEVICES_ANCHOR), true);
    assert.equal(hash.isHashFor('#signed-in-devices', model.TWO_STEP_ANCHOR), false);
    assert.equal(hash.isHashFor('', model.TWO_STEP_ANCHOR), false);
    assert.equal(hash.isHashFor('two-step-sign-in', model.TWO_STEP_ANCHOR), false);
  });

  test('each card scrolls into view and focuses its heading once its own data settles, once', () => {
    assert.match(source('TwoStepCard.tsx'), /useHashFocus\(TWO_STEP_ANCHOR, data !== undefined \|\| mfa\.error !== null, headingRef\);/);
    assert.match(source('DevicesCard.tsx'), /useHashFocus\(DEVICES_ANCHOR, devices\.data !== undefined \|\| devices\.error !== null, headingRef\);/);
    const hook = source('useHashFocus.ts');
    assert.match(hook, /if \(done\.current \|\| !ready\) return;\s*done\.current = true;/);
    assert.match(hook, /document\.getElementById\(anchor\)\?\.scrollIntoView\(\{ block: 'start' \}\);\s*headingRef\.current\?\.focus\(\{ preventScroll: true \}\);/);
  });

  test('the cards clear the sticky top bar, and the login and banner links point at the same card', () => {
    const css = source('security.module.css');
    assert.match(css, /\.section \{\s*scroll-margin-top: calc\(var\(--shell-bar-height\) \+ var\(--space-4\)\);\s*\}/);
    for (const name of ['TwoStepCard.tsx', 'DevicesCard.tsx']) {
      assert.match(source(name), /role="region" aria-labelledby=\{headingId\} className=\{s\.section\}/, name);
    }
    assert.match(css, /\.heading:focus \{\s*outline: none;\s*\}/);
    assert.equal(model.TWO_STEP_HREF, loginModel.PROFILE_TWO_STEP_HREF);
  });
});

describe('house rules for the profile security files', () => {
  const OWN = [
    'securityModel.ts', 'securityActions.ts', 'signOut.ts', 'useHashFocus.ts', 'TwoStepCard.tsx', 'DevicesCard.tsx',
    'page.tsx', 'ProfileParts.tsx', 'security.module.css',
  ];

  test('no comments, inline styles or stacking numbers, here or in this test', () => {
    for (const name of OWN) {
      const text = source(name);
      assert.doesNotMatch(text, /\/\*|(^|[^:])\/\/(?!\/)/m, name);
      assert.doesNotMatch(text, /style=\{\{/, name);
      assert.doesNotMatch(text, /z-?index/i, name);
    }
    assert.doesNotMatch(readFileSync(TEST_FILE, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m);
  });

  test('client modules say so; the model stays importable by the server layout', () => {
    for (const name of ['TwoStepCard.tsx', 'DevicesCard.tsx', 'signOut.ts', 'useHashFocus.ts']) {
      assert.ok(source(name).startsWith("'use client';"), name);
    }
    for (const name of ['securityModel.ts', 'securityActions.ts']) {
      assert.doesNotMatch(source(name), /'use client'|from 'react'|from 'next/, name);
    }
  });

  test('nothing in the profile reaches server-only code, the QR encoder or the key', () => {
    for (const name of readdirSync(PROFILE_DIR).filter((file) => /\.(ts|tsx)$/.test(file))) {
      assert.doesNotMatch(source(name), /qrcode-generator|lib\/(mfa|qr|session|jwt|supabase|guard)|next\/headers|node:crypto/, name);
    }
  });

  test('every colour comes from a token', () => {
    const css = source('security.module.css');
    for (const [, value] of css.matchAll(/[\w-]+\s*:\s*([^;{}]+);/g)) {
      assert.doesNotMatch(value, /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:transparent|currentcolor|white|black)\b/i, value);
    }
  });
});
