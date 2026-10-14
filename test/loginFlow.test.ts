import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type Context, type ElementType, type ReactElement } from 'react';
import { loadAppModule, loadUi, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiBody, ApiFailure, ApiResult } from '../app/lib/apiClient.ts';

type ModelModule = typeof import('../app/login/model.ts');
type HttpModule = typeof import('../app/lib/http.ts');
type ThemeModule = typeof import('../app/_ui/theme.tsx');

const nodeRequire = createRequire(import.meta.url);
const { AppRouterContext } = nodeRequire('next/dist/shared/lib/app-router-context.shared-runtime') as {
  AppRouterContext: Context<unknown>;
};
const { SearchParamsContext } = nodeRequire('next/dist/shared/lib/hooks-client-context.shared-runtime') as {
  SearchParamsContext: Context<URLSearchParams | null>;
};

const ROUTER = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
};

const PAGE_SOURCE = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-12T09:05:00.000Z');

let model: ModelModule;
let http: HttpModule;
let theme: ThemeModule;
let LoginPage: ElementType;

before(async () => {
  model = await loadAppModule<ModelModule>('login/model.ts');
  http = await loadAppModule<HttpModule>('lib/http.ts');
  theme = await loadUi<ThemeModule>('theme.tsx');
  LoginPage = (await loadAppModule<{ default: ElementType }>('login/page.tsx')).default;
});

function ok(data: ApiBody): ApiResult<ApiBody> {
  return { ok: true, data: { success: true, request_id: 'req_test', ...data }, status: 200, requestId: 'req_test' };
}

function failed(status: number, code: string | null, message: string, details: unknown = null): ApiResult<ApiBody> {
  const error: ApiFailure = { kind: 'http', status, code, message, requestId: 'req_test', details, outcomeUnknown: false };
  return { ok: false, error };
}

function cut(kind: 'network' | 'timeout' | 'aborted' | 'parse'): ApiResult<ApiBody> {
  return {
    ok: false,
    error: { kind, status: null, code: null, message: 'apiClient copy', requestId: null, details: null, outcomeUnknown: true },
  };
}

function inApp(element: ReactElement, query = ''): string {
  return render(createElement(theme.ThemeProvider, {
    initialMode: 'light',
    initialResolved: 'light',
    children: createElement(
      AppRouterContext.Provider,
      { value: ROUTER },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, element),
    ),
  }));
}

describe('safeNext keeps ?next only when it stays on this console', () => {
  test('ordinary console paths are kept, with their query and hash', () => {
    assert.equal(model.safeNext('/users'), '/users');
    assert.equal(model.safeNext('/users?id=7#devices'), '/users?id=7#devices');
    assert.equal(model.safeNext('/profile#two-step-sign-in'), '/profile#two-step-sign-in');
    assert.equal(model.safeNext('/loginx'), '/loginx');
  });

  test('missing, relative, absolute and protocol-relative targets fall back to the dashboard', () => {
    for (const raw of [null, undefined, '', 'users', 'https://evil.example/x', 'javascript:alert(1)']) {
      assert.equal(model.safeNext(raw), '/dashboard', String(raw));
    }
    assert.equal(model.safeNext('/'.repeat(2) + 'evil.example/x'), '/dashboard');
  });

  test('backslash and control-character tricks that browsers turn into another host are refused', () => {
    assert.equal(model.safeNext('/\\evil.example'), '/dashboard');
    assert.equal(model.safeNext('/\t/evil.example'), '/dashboard');
    assert.equal(model.safeNext('/\n/evil.example'), '/dashboard');
    assert.equal(model.safeNext('/%2F%2Fevil.example'), '/%2F%2Fevil.example', 'an encoded slash stays a path on this host');
  });

  test('the sign-in page itself and API routes are never a destination', () => {
    for (const raw of ['/login', '/login?next=/users', '/login/', '/api/auth/logout', '/api/admin-accounts']) {
      assert.equal(model.safeNext(raw), '/dashboard', raw);
    }
  });
});

describe('credentials step', () => {
  const filled = { email: ' ops@cardelite.ng ', username: ' ops.lead ', password: ' secret ' };

  test('field messages match the existing form', () => {
    assert.equal(model.credentialError('email', { ...filled, email: ' ' }), 'Enter your admin email.');
    assert.equal(model.credentialError('email', { ...filled, email: 'ops@' }), 'That does not look like an email address.');
    assert.equal(model.credentialError('username', { ...filled, username: '' }), 'Enter your admin username.');
    assert.equal(model.credentialError('password', { ...filled, password: '' }), 'Enter your password.');
    for (const field of ['email', 'username', 'password'] as const) assert.equal(model.credentialError(field, filled), null);
  });

  test('the body trims email and username but never the password', () => {
    assert.deepEqual(model.signInBody(filled), { email: 'ops@cardelite.ng', username: 'ops.lead', password: ' secret ' });
    assert.equal(model.credentialsComplete(filled), true);
    assert.equal(model.credentialsComplete({ ...filled, password: '' }), false);
  });

  test('the lock key is per account, case-insensitive', () => {
    assert.equal(model.accountKey(filled), 'ops.lead|ops@cardelite.ng');
    assert.equal(model.accountKey({ email: 'OPS@CardElite.ng', username: 'Ops.Lead' }), 'ops.lead|ops@cardelite.ng');
  });
});

describe('POST /api/auth answer → next step', () => {
  test('step done signs in; step mfa asks for a code; step enroll starts setup', () => {
    assert.deepEqual(model.classifySignIn(ok({ step: 'done' })), { kind: 'done' });
    assert.deepEqual(model.classifySignIn(ok({ step: 'mfa', methods: ['otp', 'recovery'], username: 'ops.lead' })), { kind: 'code', username: 'ops.lead' });
    assert.deepEqual(model.classifySignIn(ok({ step: 'enroll', username: 'ops.lead' })), { kind: 'enroll', username: 'ops.lead' });
    assert.deepEqual(model.classifySignIn(ok({ step: 'mfa' })), { kind: 'code', username: null });
    assert.deepEqual(model.classifySignIn(ok({})), { kind: 'done' }, 'a plain success still leaves the page');
  });

  test('wrong credentials show the server text; a validation error too', () => {
    assert.deepEqual(model.classifySignIn(failed(401, 'AUTH_REQUIRED', 'Invalid credentials')), { kind: 'error', message: 'Invalid credentials', field: null });
    assert.deepEqual(
      model.classifySignIn(failed(400, 'VALIDATION_ERROR', 'Email, username and password required')),
      { kind: 'error', message: 'Email, username and password required', field: null },
    );
    assert.deepEqual(model.classifySignIn(failed(403, null, 'Origin not allowed')), { kind: 'error', message: model.SIGN_IN_FAILED, field: null });
  });

  test('a rate limit shows its text; a two-step lock is rebuilt with the edge wording and the WAT time', () => {
    assert.deepEqual(model.classifySignIn(failed(429, 'RATE_LIMITED', 'Too many attempts. Try again later.')), {
      kind: 'error', message: 'Too many attempts. Try again later.', field: null,
    });
    const until = '2026-10-12T09:19:10.000Z';
    const locked = model.classifySignIn(failed(429, 'RATE_LIMITED', 'whatever the server said', { reason: 'mfa_locked', locked_until: until }), NOW);
    assert.deepEqual(locked, {
      kind: 'locked',
      message: 'Too many wrong codes. Two-step sign-in is locked until 10:20 WAT. Your super administrators have been alerted.',
      lockedUntil: until,
    });
    assert.equal(locked.kind === 'locked' && locked.message, http.twoStepLockedMessage(until, NOW));
  });

  test('a 24-hour lock always names the day', () => {
    const until = '2026-10-13T09:19:10.000Z';
    const locked = model.classifySignIn(failed(429, 'RATE_LIMITED', 'x', { reason: 'mfa_locked', locked_until: until }), NOW);
    assert.equal(locked.kind === 'locked' && locked.message,
      'Too many wrong codes. Two-step sign-in is locked until 13 Oct, 10:20 WAT. Your super administrators have been alerted.');
  });

  test('a lock without a readable time still says what to do', () => {
    const locked = model.classifySignIn(failed(429, 'RATE_LIMITED', 'x', { reason: 'mfa_locked', locked_until: null }), NOW);
    assert.deepEqual(locked, {
      kind: 'locked',
      message: 'Too many wrong codes. Two-step sign-in is locked for now. Try again later. Your super administrators have been alerted.',
      lockedUntil: null,
    });
  });

  test('outages keep the server text when it is ours, and fall back when it is not', () => {
    assert.deepEqual(model.classifySignIn(failed(500, 'INTERNAL_ERROR', 'Two-step sign-in is unavailable right now. Try again later.')), {
      kind: 'error', message: 'Two-step sign-in is unavailable right now. Try again later.', field: null,
    });
    assert.deepEqual(model.classifySignIn(failed(504, null, 'The server returned an error (HTTP 504)')), {
      kind: 'error', message: 'Sign-in is unavailable right now. Try again shortly.', field: null,
    });
    assert.deepEqual(model.classifySignIn(cut('network')), {
      kind: 'error', message: 'Could not reach the server. Check your connection and try again.', field: null,
    });
    assert.deepEqual(model.classifySignIn(cut('timeout')), {
      kind: 'error', message: 'The server took too long to respond. Try again.', field: null,
    });
  });
});

describe('POST /api/auth/mfa/verify answer → next step', () => {
  const wrong = 'That code did not work. Enter the newest code, and check that your phone sets its clock automatically.';

  test('a code signs in; a recovery code shows the recovered panel with the codes left', () => {
    assert.deepEqual(model.classifyVerify(ok({ step: 'done', method: 'otp' })), { kind: 'done' });
    assert.deepEqual(model.classifyVerify(ok({ step: 'done', method: 'recovery', recovery_codes_left: 7 })), { kind: 'recovered', codesLeft: 7 });
    assert.deepEqual(model.classifyVerify(ok({ step: 'done', method: 'recovery', recovery_codes_left: 0 })), { kind: 'recovered', codesLeft: 0 });
    assert.deepEqual(model.classifyVerify(ok({ step: 'done', method: 'recovery' })), { kind: 'recovered', codesLeft: 0 });
  });

  test('a wrong code shows the message, adding the tries left only at 2 or fewer', () => {
    const at = (left: number) => model.classifyVerify(failed(400, 'VALIDATION_ERROR', wrong, { field: 'otp', attempts_left: left }));
    assert.deepEqual(at(4), { kind: 'error', message: wrong, field: 'otp' });
    assert.deepEqual(at(3), { kind: 'error', message: wrong, field: 'otp' });
    assert.deepEqual(at(2), { kind: 'error', message: `${wrong} 2 tries left.`, field: 'otp' });
    assert.deepEqual(at(1), { kind: 'error', message: `${wrong} 1 try left.`, field: 'otp' });
  });

  test('no tries left goes straight back to the password', () => {
    assert.deepEqual(
      model.classifyVerify(failed(400, 'VALIDATION_ERROR', wrong, { field: 'otp', attempts_left: 0 })),
      { kind: 'ended', message: 'That did not work, and this sign-in step has no tries left. Enter your password again.' },
    );
  });

  test('a replayed code and a bad recovery code carry their field', () => {
    assert.deepEqual(
      model.classifyVerify(failed(400, 'VALIDATION_ERROR', 'That code was already used. Wait for the next one.', { field: 'otp', attempts_left: 3 })),
      { kind: 'error', message: 'That code was already used. Wait for the next one.', field: 'otp' },
    );
    assert.deepEqual(
      model.classifyVerify(failed(400, 'VALIDATION_ERROR', 'That recovery code did not work or was already used.', { field: 'recovery_code', attempts_left: 2 })),
      { kind: 'error', message: 'That recovery code did not work or was already used. 2 tries left.', field: 'recovery_code' },
    );
  });

  test('an ended step goes back to the credentials with the step-ended message', () => {
    const ended = { kind: 'ended', message: 'This sign-in step ended. Enter your password again.' };
    assert.deepEqual(model.classifyVerify(failed(401, 'AUTH_REQUIRED', 'This sign-in step ended. Enter your password again.', { reason: 'challenge_expired' })), ended);
    assert.deepEqual(model.classifyVerify(failed(401, 'AUTH_REQUIRED', 'Your session has expired. Sign in again.')), ended);
  });

  test('a lock during the code step is the same edge wording', () => {
    const until = '2026-10-12T09:20:00.000Z';
    assert.deepEqual(model.classifyVerify(failed(429, 'RATE_LIMITED', 'x', { reason: 'mfa_locked', locked_until: until }), NOW), {
      kind: 'locked',
      message: 'Too many wrong codes. Two-step sign-in is locked until 10:20 WAT. Your super administrators have been alerted.',
      lockedUntil: until,
    });
  });

  test('outages show the server text or the fallback', () => {
    assert.deepEqual(model.classifyVerify(failed(500, 'INTERNAL_ERROR', 'Two-step sign-in is unavailable right now. Try again later.')), {
      kind: 'error', message: 'Two-step sign-in is unavailable right now. Try again later.', field: null,
    });
    assert.deepEqual(model.classifyVerify(cut('parse')), {
      kind: 'error', message: 'The server sent a response that could not be read. Try again.', field: null,
    });
  });
});

describe('code entry before anything is sent', () => {
  test('an incomplete code is caught on the page, so it never uses up a try', () => {
    assert.equal(model.codeError('otp', ''), 'Enter the 6-digit code from your authenticator app.');
    assert.equal(model.codeError('otp', '12345'), 'Enter the 6-digit code from your authenticator app.');
    assert.equal(model.codeError('otp', '123456'), null);
    assert.equal(model.codeError('recovery', 'ABCDE-FGHJ'), 'Enter the whole recovery code: 10 letters and numbers.');
    assert.equal(model.codeError('recovery', 'abcde fghjk'), null);
    assert.equal(model.codeError('recovery', 'ABCDU-FGHJK'), 'Enter the whole recovery code: 10 letters and numbers.');
  });

  test('the body key is otp or recovery_code, never code', () => {
    assert.deepEqual(model.verifyBody('otp', '123456'), { otp: '123456' });
    assert.deepEqual(model.verifyBody('recovery', ' abcde-fghjk '), { recovery_code: 'abcde-fghjk' });
    assert.equal(PAGE_SOURCE.includes('code: '), false);
  });

  test('the step decides the mode', () => {
    assert.equal(model.codeModeOf('code'), 'otp');
    assert.equal(model.codeModeOf('recovery'), 'recovery');
    assert.equal(model.signingInAs('ops.lead'), '@ops.lead');
    assert.equal(model.signingInAs('@ops.lead'), '@ops.lead');
  });
});

describe('locks on the page', () => {
  test('a lock is kept only for a future time and only for the same account', () => {
    const lock = model.lockFrom('2026-10-12T09:20:00.000Z', 'ops.lead|ops@cardelite.ng', NOW);
    assert.deepEqual(lock, { until: Date.parse('2026-10-12T09:20:00.000Z'), account: 'ops.lead|ops@cardelite.ng' });
    assert.equal(model.lockApplies(lock, 'ops.lead|ops@cardelite.ng'), true);
    assert.equal(model.lockApplies(lock, 'ada|ada@cardelite.ng'), false);
    assert.equal(model.lockApplies(null, 'ops.lead|ops@cardelite.ng'), false);
    assert.equal(model.lockFrom('2026-10-12T09:00:00.000Z', 'x', NOW), null);
    assert.equal(model.lockFrom(null, 'x', NOW), null);
    assert.equal(model.lockFrom('soon', 'x', NOW), null);
  });
});

describe('setup and recovery endings', () => {
  test('a setup that ends sends the admin back to the password with the right reason', () => {
    const timedOut: ApiFailure = { kind: 'http', status: 401, code: 'AUTH_REQUIRED', message: 'x', requestId: null, details: { reason: 'challenge_expired' }, outcomeUnknown: false };
    const usedUp: ApiFailure = { ...timedOut, status: 400, code: 'VALIDATION_ERROR', details: { field: 'otp', attempts_left: 0 } };
    assert.equal(model.enrollEndedMessage(timedOut), 'This setup timed out. Enter your password again to start over.');
    assert.equal(model.enrollEndedMessage(usedUp), 'That did not work, and this setup has no tries left. Enter your password again to start over.');
  });

  test('the recovered panel counts the codes left and turns to danger at the last one', () => {
    assert.deepEqual(model.recoveredNotice(7), {
      tone: 'warning',
      text: 'You have 7 recovery codes left. If your authenticator app is gone, ask a super administrator to reset two-step sign-in, then set it up again.',
    });
    assert.match(model.recoveredNotice(1).text, /^You have 1 recovery code left\./);
    assert.deepEqual(model.recoveredNotice(0), {
      tone: 'danger', text: 'That was your last recovery code. Get new codes on your Profile now.',
    });
  });

  test('the step copy matches the contract', () => {
    assert.equal(model.CODE_HEADING, 'Two-step sign-in');
    assert.equal(model.CODE_LABEL, 'Authentication code');
    assert.equal(model.CODE_HELP, 'Enter the 6-digit code from your authenticator app. It changes every 30 seconds.');
    assert.equal(model.RECOVERY_LABEL, 'Recovery code');
    assert.equal(model.RECOVERY_HELP, 'Each recovery code works once. Type it with or without the dash.');
    assert.equal(model.RECOVERY_HINT, 'Lost your phone and your codes? Ask a super administrator to reset your two-step sign-in.');
    assert.equal(model.USE_RECOVERY, 'Use a recovery code instead');
    assert.equal(model.SWITCH_ACCOUNT, 'Sign in as someone else');
    assert.equal(model.VERIFY_LABEL, 'Verify');
    assert.equal(model.VERIFYING_LABEL, 'Verifying…');
    assert.equal(model.ENROLL_HEADING, 'Set up two-step sign-in');
    assert.equal(model.ENROLL_REQUIRED, 'Two-step sign-in is required for every admin. Set it up now to finish signing in.');
    assert.equal(model.ENROLL_CONFIRM_LABEL, 'Turn on and continue');
    assert.equal(model.ENROLL_FINISH_LABEL, 'Continue to the console');
    assert.equal(model.RECOVERED_HEADING, 'Signed in with a recovery code');
    assert.equal(model.PROFILE_TWO_STEP_HREF, '/profile#two-step-sign-in');
    assert.equal(model.STEP_ENDED, 'This sign-in step ended. Enter your password again.');
  });
});

describe('the sign-in page', () => {
  test('opens on the credentials form, with the theme switch, the brand and the footnote', () => {
    const html = inApp(createElement(LoginPage));
    assert.equal(
      textOf(html),
      'CE CardElite Admin console Email Username Password Sign in Admin access is granted by a super administrator. Every sign-in attempt is recorded.',
    );
    assert.equal(tagsOf(html, 'div').filter((attrs) => attrs.role === 'radiogroup').length, 1, 'the theme switch is still there');
    const inputs = tagsOf(html, 'input');
    assert.deepEqual(inputs.map((attrs) => attrs.id), ['login-email', 'login-username', 'login-password']);
    assert.equal(inputs[2].type, 'password');
    assert.equal(inputs[2].autoComplete, 'current-password');
    const submit = tagsOf(html, 'button').find((attrs) => attrs.type === 'submit');
    assert.ok(submit);
    assert.equal('disabled' in submit, false);
    assert.equal(tagsOf(html, 'div').some((attrs) => attrs.role === 'alert'), false);
  });

  test('renders the same with a ?next destination', () => {
    assert.equal(inApp(createElement(LoginPage), 'next=%2Fusers'), inApp(createElement(LoginPage)));
  });

  test('the page needs no toast or confirm provider and never imports server code', () => {
    assert.ok(PAGE_SOURCE.startsWith("'use client';"));
    assert.doesNotMatch(PAGE_SOURCE, /useToast|useConfirm|ToastProvider|ConfirmProvider/);
    assert.doesNotMatch(PAGE_SOURCE, /lib\/(?:mfa|qr|session|jwt|supabase)|qrcode-generator|node:crypto/);
  });

  test('the code steps post to the verify route; setup uses the pre-session enrolment routes', () => {
    assert.match(PAGE_SOURCE, /apiRequest\(SIGN_IN_PATH, \{ method: 'POST', body: signInBody\(values\) \}\)/);
    assert.match(PAGE_SOURCE, /apiRequest\(VERIFY_PATH, \{ method: 'POST', body: verifyBody\(mode, code\) \}\)/);
    assert.match(PAGE_SOURCE, /startPath=\{ENROLL_START_PATH\}\s+confirmPath=\{ENROLL_CONFIRM_PATH\}/);
    assert.equal(model.SIGN_IN_PATH, '/api/auth');
    assert.equal(model.VERIFY_PATH, '/api/auth/mfa/verify');
    assert.equal(model.ENROLL_START_PATH, '/api/auth/mfa/enroll/start');
    assert.equal(model.ENROLL_CONFIRM_PATH, '/api/auth/mfa/enroll/confirm');
  });

  test('the code field is one input with the shared one-time-code attributes and no auto-submit', () => {
    assert.match(PAGE_SOURCE, /\{\.\.\.\(otp \? OTP_INPUT_ATTRIBUTES : RECOVERY_INPUT_ATTRIBUTES\)\}/);
    assert.match(PAGE_SOURCE, /setCode\(otp \? sanitizeOtp\(e\.target\.value\) : e\.target\.value\)/);
    assert.equal((PAGE_SOURCE.match(/<input/g) ?? []).length, 4, 'email, username, password and one code field');
    assert.doesNotMatch(PAGE_SOURCE, /maxLength/);
    assert.doesNotMatch(PAGE_SOURCE, /length === 6|\.length >= 6/);
  });

  test('a lock disables submit for that account only, until the lock ends', () => {
    assert.match(PAGE_SOURCE, /disabled=\{working \|\| locked\}/);
    assert.match(PAGE_SOURCE, /window\.setTimeout\(\(\) => setLock\(null\), wait\)/);
  });

  test('the lock sentence clears itself when the lock ends, and a code problem is announced', () => {
    assert.match(PAGE_SOURCE, /lockMessage\.current = nextLock \? outcome\.message : null;/);
    assert.match(PAGE_SOURCE, /setError\(\(current\) => \(current === message \? '' : current\)\);/);
    assert.match(PAGE_SOURCE, /className=\{s\.fieldError\} role="alert">\{codeProblem\}/);
  });

  test('Sign in as someone else keeps the email and username and clears the password', () => {
    assert.match(PAGE_SOURCE, /const returnToCredentials = \(message: string, target: FocusTarget\) => \{\s+setStep\('credentials'\);\s+setPassword\(''\);/);
    assert.doesNotMatch(PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('const returnToCredentials'), PAGE_SOURCE.indexOf('const apply')), /setEmail|setUsername/);
  });
});
