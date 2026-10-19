import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type Context, type ElementType, type ReactElement } from 'react';
import { loadAppModule, loadUi, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import type { ApiBody, ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type { LinkAccount } from '../app/set-password/model.ts';

type ForgotModule = typeof import('../app/forgot-password/model.ts');
type SetModule = typeof import('../app/set-password/model.ts');
type LoginModelModule = typeof import('../app/login/model.ts');
type PolicyModule = typeof import('../app/lib/passwordPolicy.ts');
type PartsModule = typeof import('../app/login/AuthParts.tsx');
type RulesModule = typeof import('../app/_security/PasswordRules.tsx');
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

const source = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8');

const FORGOT_PAGE = source('forgot-password/page.tsx');
const FORGOT_MODEL = source('forgot-password/model.ts');
const SET_PAGE = source('set-password/page.tsx');
const SET_MODEL = source('set-password/model.ts');
const PARTS = source('login/AuthParts.tsx');
const RULES = source('_security/PasswordRules.tsx');
const PROFILE_PARTS = source('(dashboard)/profile/ProfileParts.tsx');

const INVITE: LinkAccount = {
  purpose: 'invite',
  username: 'ada.obi',
  email: 'ada.obi@cardelite.test',
  expiresAt: '2026-10-22T13:30:00.000Z',
};
const RESET: LinkAccount = {
  purpose: 'reset',
  username: 'ops.lead',
  email: 'adaeze.okafor@cardelite.test',
  expiresAt: '2026-10-19T10:00:00.000Z',
};
const STRONG = 'Velvet-Harbour-Lantern-42';
const NETWORK = 'Could not reach the server. Check your connection and try again.';
const TIMEOUT = 'The server took too long to respond. Try again.';
const UNREADABLE = 'The server sent a response that could not be read. Try again.';

let forgot: ForgotModule;
let setPassword: SetModule;
let loginModel: LoginModelModule;
let policy: PolicyModule;
let parts: PartsModule;
let rules: RulesModule;
let theme: ThemeModule;
let ForgotPage: ElementType;
let SetPasswordPage: ElementType;

before(async () => {
  forgot = await loadAppModule<ForgotModule>('forgot-password/model.ts');
  setPassword = await loadAppModule<SetModule>('set-password/model.ts');
  loginModel = await loadAppModule<LoginModelModule>('login/model.ts');
  policy = await loadAppModule<PolicyModule>('lib/passwordPolicy.ts');
  parts = await loadAppModule<PartsModule>('login/AuthParts.tsx');
  rules = await loadAppModule<RulesModule>('_security/PasswordRules.tsx');
  theme = await loadUi<ThemeModule>('theme.tsx');
  ForgotPage = (await loadAppModule<{ default: ElementType }>('forgot-password/page.tsx')).default;
  SetPasswordPage = (await loadAppModule<{ default: ElementType }>('set-password/page.tsx')).default;
});

function ok<T = ApiBody>(data: T): ApiResult<T> {
  return { ok: true, data, status: 200, requestId: 'req_test' };
}

function failed<T = ApiBody>(status: number, code: string | null, message: string, details: unknown = null): ApiResult<T> {
  const error: ApiFailure = { kind: 'http', status, code, message, requestId: 'req_test', details, outcomeUnknown: false };
  return { ok: false, error };
}

function cut<T = ApiBody>(kind: 'network' | 'timeout' | 'aborted' | 'parse'): ApiResult<T> {
  return {
    ok: false,
    error: { kind, status: null, code: null, message: 'apiClient copy', requestId: null, details: null, outcomeUnknown: true },
  };
}

function inApp(element: ReactElement): string {
  return render(createElement(theme.ThemeProvider, {
    initialMode: 'light',
    initialResolved: 'light',
    children: createElement(
      AppRouterContext.Provider,
      { value: ROUTER },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams() }, element),
    ),
  }));
}

describe('forgot password: model', () => {
  test('the copy and the route match the contract', () => {
    assert.equal(forgot.REQUEST_PATH, '/api/auth/password/forgot');
    assert.equal(forgot.SIGN_IN_HREF, '/login');
    assert.equal(forgot.FORGOT_HEADING, 'Reset your password');
    assert.equal(
      forgot.FORGOT_LEAD,
      'Enter the email and username you sign in with. We will email you a link to choose a new password.',
    );
    assert.equal(forgot.SEND_LABEL, 'Email me a link');
    assert.equal(forgot.SENDING_LABEL, 'Sending…');
    assert.equal(
      forgot.FORGOT_SENT,
      'If those details match an admin account, we have emailed a link to choose a new password. It works for 30 minutes.',
    );
    assert.equal(forgot.SPAM_HINT, 'Check your spam folder if it does not arrive.');
    assert.equal(forgot.BACK_TO_SIGN_IN, 'Back to sign in');
    assert.equal(forgot.FORGOT_UNAVAILABLE, 'Password reset is unavailable right now. Try again shortly.');
    assert.equal(forgot.FORGOT_FOOTNOTE, 'Every request is recorded.');
  });

  test('the fields reuse the sign-in checks, and the body trims both values', () => {
    const filled = { email: ' ops@cardelite.ng ', username: ' ops.lead ' };
    assert.equal(forgot.forgotError('email', { ...filled, email: ' ' }), 'Enter your admin email.');
    assert.equal(forgot.forgotError('email', { ...filled, email: 'ops@' }), 'That does not look like an email address.');
    assert.equal(forgot.forgotError('username', { ...filled, username: '' }), 'Enter your admin username.');
    assert.equal(forgot.forgotError('email', filled), null);
    assert.equal(forgot.forgotError('username', filled), null);
    assert.equal(forgot.forgotComplete(filled), true);
    assert.equal(forgot.forgotComplete({ ...filled, username: ' ' }), false);
    assert.deepEqual(forgot.forgotBody(filled), { email: 'ops@cardelite.ng', username: 'ops.lead' });
  });

  test('a 200 is always the same sent state, whatever the body says', () => {
    assert.deepEqual(forgot.classifyForgot(ok({ success: true, message: forgot.FORGOT_SENT })), { kind: 'sent' });
    assert.deepEqual(forgot.classifyForgot(ok({})), { kind: 'sent' });
  });

  test('429 shows the sign-in wording; every outage shows one sentence; a validation error shows its text', () => {
    const error = (message: string) => ({ kind: 'error', message });
    assert.deepEqual(forgot.classifyForgot(failed(429, 'RATE_LIMITED', 'Too many requests.')), error(loginModel.TOO_MANY_ATTEMPTS));
    assert.equal(loginModel.TOO_MANY_ATTEMPTS, 'Too many attempts. Wait a few minutes and try again.');
    for (const result of [
      failed(500, 'INTERNAL_ERROR', 'Password reset is not available right now.'),
      failed(500, null, 'The server returned an error (HTTP 500)'),
      failed(502, null, 'The server returned an error (HTTP 502)'),
      failed(504, null, 'The server returned an error (HTTP 504)'),
      failed(403, null, 'Origin not allowed'),
    ]) {
      assert.deepEqual(forgot.classifyForgot(result), error(forgot.FORGOT_UNAVAILABLE));
    }
    assert.deepEqual(forgot.classifyForgot(failed(400, 'VALIDATION_ERROR', 'Enter your email and username.')), error('Enter your email and username.'));
    assert.deepEqual(forgot.classifyForgot(cut('network')), error(NETWORK));
    assert.deepEqual(forgot.classifyForgot(cut('timeout')), error(TIMEOUT));
  });
});

describe('forgot password: page', () => {
  test('opens on the form inside the sign-in shell, with the footnote', () => {
    const html = inApp(createElement(ForgotPage));
    assert.equal(
      textOf(html),
      'CE CardElite Admin console Reset your password Enter the email and username you sign in with. We will email you a link to choose a new password. Email Username Email me a link Every request is recorded.',
    );
    assert.equal(tagsOf(html, 'div').filter((attrs) => attrs.role === 'radiogroup').length, 1, 'the theme switch is there');
    assert.equal(tagsOf(html, 'section')[0]?.['aria-labelledby'], 'forgot-heading');
    assert.equal(tagsOf(html, 'h1')[0]?.id, 'forgot-heading');
    assert.equal(tagsOf(html, 'form')[0]?.['aria-labelledby'], 'forgot-step-heading');
    assert.equal(tagsOf(html, 'h2')[0]?.id, 'forgot-step-heading');
    const inputs = tagsOf(html, 'input');
    assert.deepEqual(inputs.map((attrs) => attrs.id), ['forgot-email', 'forgot-username']);
    assert.deepEqual(inputs.map((attrs) => attrs.type), ['email', 'text']);
    assert.deepEqual(inputs.map((attrs) => attrs.autoComplete), ['email', 'username']);
    for (const input of inputs) assert.equal(input.class, 'input');
    assert.deepEqual(tagsOf(html, 'label').map((attrs) => attrs.for), ['forgot-email', 'forgot-username']);
    const submit = tagsOf(html, 'button').find((attrs) => attrs.type === 'submit');
    assert.equal(submit?.class, 'submit');
    assert.equal(submit && 'disabled' in submit, false);
    assert.equal(withClass(html, 'p', 'foot').length, 1);
    assert.equal(tagsOf(html, 'div').some((attrs) => attrs.role === 'alert'), false);
  });

  test('it posts the trimmed email and username, then swaps the form for the notice, the spam hint and the way back', () => {
    assert.match(FORGOT_PAGE, /apiRequest\(REQUEST_PATH, \{ method: 'POST', body: forgotBody\(values\) \}\)/);
    assert.match(FORGOT_PAGE, /if \(outcome\.kind === 'sent'\) setSent\(true\);\s*else setError\(outcome\.message\);/);
    assert.match(FORGOT_PAGE, /\{sent \? \(\s*<section aria-labelledby=\{STEP_HEADING_ID\}>/);
    assert.match(
      FORGOT_PAGE,
      /<Notice tone="success" announce>\{FORGOT_SENT\}<\/Notice>\s*<p className=\{s\.hint\}>\{SPAM_HINT\}<\/p>\s*<div className=\{s\.altActions\}>\s*<Link href=\{SIGN_IN_HREF\} className=\{s\.linkBtn\}>\{BACK_TO_SIGN_IN\}<\/Link>/,
    );
    assert.match(FORGOT_PAGE, /<AuthShell headingId=\{SHELL_HEADING_ID\} foot=\{FORGOT_FOOTNOTE\}>/);
    assert.match(FORGOT_PAGE, /import s from '\.\.\/login\/login\.module\.css';/);
  });
});

describe('set password: model', () => {
  test('the copy and the routes match the contract', () => {
    assert.equal(setPassword.SET_PASSWORD_PATH, '/set-password');
    assert.equal(setPassword.CHECK_PATH, '/api/auth/password/check');
    assert.equal(setPassword.SAVE_PATH, '/api/auth/password/set');
    assert.equal(setPassword.INVITE_HEADING, 'Choose your password');
    assert.equal(setPassword.RESET_HEADING, 'Choose a new password');
    assert.equal(setPassword.NEW_PASSWORD_LABEL, 'New password');
    assert.equal(setPassword.CONFIRM_PASSWORD_LABEL, 'Confirm password');
    assert.equal(setPassword.SAVE_LABEL, 'Save password');
    assert.equal(setPassword.SAVING_LABEL, 'Saving…');
    assert.equal(setPassword.DONE_HEADING, 'Password saved');
    assert.equal(setPassword.DONE_LEAD, 'Sign in with your email, your username and your new password.');
    assert.equal(setPassword.LINK_INVALID, 'This link has expired, was already used, or was replaced by a newer one.');
    assert.equal(
      setPassword.INVALID_HELP,
      'If you were resetting your password, request a new link. If you were invited, ask a super administrator to send a new invitation.',
    );
    assert.equal(setPassword.REQUEST_NEW_LINK, 'Request a new link');
    assert.equal(setPassword.SAVE_UNAVAILABLE, 'Your password could not be saved right now. Try again shortly.');
  });

  test('the check answer is read strictly', () => {
    assert.deepEqual(
      setPassword.toLinkAccount({ purpose: 'invite', username: ' ada.obi ', email: 'ada.obi@cardelite.test', expires_at: INVITE.expiresAt }),
      INVITE,
    );
    assert.deepEqual(
      setPassword.toLinkAccount({ purpose: 'reset', username: 'ops.lead', email: null, expires_at: 'soon' }),
      { purpose: 'reset', username: 'ops.lead', email: null, expiresAt: null },
    );
    assert.equal(setPassword.toLinkAccount({ purpose: 'admin', username: 'ops.lead' }), null);
    assert.equal(setPassword.toLinkAccount({ username: 'ops.lead' }), null);
    assert.equal(setPassword.toLinkAccount({ purpose: 'invite', username: ' ' }), null);
  });

  test('the heading and the lead follow the purpose; the invite names its expiry in WAT', () => {
    assert.equal(setPassword.formHeading(INVITE), 'Choose your password');
    assert.equal(setPassword.formHeading(RESET), 'Choose a new password');
    assert.equal(
      setPassword.formLead(INVITE),
      'Welcome, @ada.obi. Choose a password to finish setting up your admin account. The link works until 22 Oct 2026, 14:30 WAT.',
    );
    assert.equal(
      setPassword.formLead({ ...INVITE, expiresAt: null }),
      'Welcome, @ada.obi. Choose a password to finish setting up your admin account.',
    );
    assert.equal(setPassword.formLead(RESET), '@ops.lead, choosing a new password signs you out on every device.');
  });

  test('the rule list is the shared policy without "different", with live state for this account', () => {
    assert.deepEqual(
      setPassword.SET_PASSWORD_RULES.map((rule) => rule.id),
      policy.OWN_PASSWORD_RULES.map((rule) => rule.id).filter((id) => id !== 'different'),
    );
    assert.equal(setPassword.SET_PASSWORD_RULES.length, 7);
    const empty = setPassword.newPasswordChecklist('', INVITE);
    assert.equal(empty.length, 7);
    assert.ok(empty.every((item) => !item.met));
    assert.deepEqual(
      empty.map((item) => item.label),
      policy.OWN_PASSWORD_RULES.filter((rule) => rule.id !== 'different').map((rule) => rule.label),
    );
    assert.ok(setPassword.newPasswordChecklist(STRONG, INVITE).every((item) => item.met));
    const personal = setPassword.newPasswordChecklist('Key-Ada.Obi-2026!', INVITE);
    assert.deepEqual(personal.filter((item) => !item.met).map((item) => item.id), ['personal']);
    const emailName = setPassword.newPasswordChecklist('Adaeze.Okafor-Key-2026', RESET);
    assert.deepEqual(emailName.filter((item) => !item.met).map((item) => item.id), ['personal']);
    const short = setPassword.newPasswordChecklist('Ab1!', RESET);
    assert.deepEqual(short.filter((item) => !item.met).map((item) => item.id), ['length']);
  });

  test('a missing or mismatched confirmation, and a weak password, are caught on the page', () => {
    assert.deepEqual(setPassword.validateNewPassword({ next: STRONG, confirm: STRONG }, INVITE), {});
    assert.deepEqual(setPassword.validateNewPassword({ next: STRONG, confirm: '' }, INVITE), {
      confirm: 'Enter the new password again.',
    });
    assert.deepEqual(setPassword.validateNewPassword({ next: STRONG, confirm: `${STRONG}x` }, INVITE), {
      confirm: 'The new passwords do not match.',
    });
    assert.deepEqual(setPassword.validateNewPassword({ next: '', confirm: '' }, INVITE), {
      next: 'Enter a new password.',
      confirm: 'Enter the new password again.',
    });
    const personal = setPassword.validateNewPassword({ next: 'Key-Ada.Obi-2026!', confirm: 'Key-Ada.Obi-2026!' }, INVITE);
    assert.deepEqual(personal, {
      next: policy.checkOwnPassword('Key-Ada.Obi-2026!', { current: '', username: 'ada.obi', email: INVITE.email })?.message,
    });
    assert.equal(setPassword.firstNewPasswordError({ next: 'x', confirm: 'y' }), 'next');
    assert.equal(setPassword.firstNewPasswordError({ confirm: 'y' }), 'confirm');
    assert.equal(setPassword.firstNewPasswordError({}), null);
  });

  test('the token travels only in POST bodies, and the password is never trimmed', () => {
    assert.deepEqual(setPassword.checkBody('tok_abc'), { token: 'tok_abc' });
    assert.deepEqual(setPassword.saveBody('tok_abc', ` ${STRONG} `), { token: 'tok_abc', new_password: ` ${STRONG} ` });
  });

  test('check: 200 opens the form, 409 the invalid state, and an outage is never called an invalid link', () => {
    assert.deepEqual(setPassword.classifyCheck(ok(INVITE)), { kind: 'form', account: INVITE });
    assert.deepEqual(
      setPassword.classifyCheck(failed<LinkAccount>(409, 'STATE_CONFLICT', setPassword.LINK_INVALID)),
      { kind: 'invalid' },
    );
    const unavailable = (message: string) => ({ kind: 'unavailable', message });
    for (const result of [
      failed<LinkAccount>(500, 'INTERNAL_ERROR', 'Something failed.'),
      failed<LinkAccount>(500, null, 'The server returned an error (HTTP 500)'),
      failed<LinkAccount>(404, null, 'Not found'),
    ]) {
      assert.deepEqual(setPassword.classifyCheck(result), unavailable(setPassword.CHECK_UNAVAILABLE));
    }
    assert.deepEqual(setPassword.classifyCheck(cut<LinkAccount>('network')), unavailable(NETWORK));
    assert.deepEqual(setPassword.classifyCheck(cut<LinkAccount>('parse')), unavailable(UNREADABLE));
  });

  test('save: 200 is done, 409 the invalid state, a field error goes under New password, outages one sentence', () => {
    assert.deepEqual(setPassword.classifySave(ok({ success: true, purpose: 'invite' })), { kind: 'done' });
    assert.deepEqual(setPassword.classifySave(failed(409, 'STATE_CONFLICT', setPassword.LINK_INVALID)), { kind: 'invalid' });
    const different = 'Password must be different from your current password.';
    assert.deepEqual(
      setPassword.classifySave(failed(400, 'VALIDATION_ERROR', different, { field: 'new_password' })),
      { kind: 'field', message: different },
    );
    assert.deepEqual(setPassword.classifySave(failed(400, 'VALIDATION_ERROR', different)), { kind: 'error', message: different });
    for (const result of [
      failed(500, 'INTERNAL_ERROR', 'Your password could not be saved right now. Try again shortly.'),
      failed(500, null, 'The server returned an error (HTTP 500)'),
      failed(504, null, 'The server returned an error (HTTP 504)'),
    ]) {
      assert.deepEqual(setPassword.classifySave(result), { kind: 'error', message: setPassword.SAVE_UNAVAILABLE });
    }
    assert.deepEqual(setPassword.classifySave(cut('timeout')), { kind: 'error', message: TIMEOUT });
  });
});

describe('set password: page', () => {
  test('opens on a spinner alone inside the sign-in shell, with no text and no footnote', () => {
    const html = inApp(createElement(SetPasswordPage));
    assert.equal(textOf(html), 'CE CardElite Admin console');
    assert.equal(tagsOf(html, 'section')[0]?.['aria-labelledby'], 'set-password-heading');
    const spinner = tagsOf(html, 'span').find((attrs) => attrs.role === 'img');
    assert.equal(spinner?.['aria-label'], 'Loading');
    assert.equal(withClass(html, 'div', 'checking').length, 1);
    assert.deepEqual(tagsOf(html, 'input'), []);
    assert.equal(withClass(html, 'p', 'foot').length, 0);
  });

  test('the token is read once from the fragment and stripped from the address bar before anything is sent', () => {
    assert.match(
      SET_PAGE,
      /if \(read\.current\) return;\s*read\.current = true;\s*const found = window\.location\.hash\.slice\(1\);\s*window\.history\.replaceState\(null, '', SET_PASSWORD_PATH\);\s*if \(!found\) \{\s*setView\(\{ kind: 'invalid' \}\);\s*return;\s*\}\s*setToken\(found\);\s*void check\(found\);/,
    );
    assert.equal((SET_PAGE.match(/window\.history\./g) ?? []).length, 1);
    assert.equal((SET_PAGE.match(/window\.location/g) ?? []).length, 1);
    assert.deepEqual([...SET_PAGE.matchAll(/apiRequest\((\w+)/g)].map((match) => match[1]), ['CHECK_PATH', 'SAVE_PATH']);
    assert.deepEqual([...SET_PAGE.matchAll(/\bcheck\((\w+)\)/g)].map((match) => match[1]), ['found', 'token']);
    assert.match(SET_PAGE, /apiRequest\(CHECK_PATH, \{ method: 'POST', body: checkBody\(value\), select: toLinkAccount \}\)/);
    assert.match(SET_PAGE, /apiRequest\(SAVE_PATH, \{ method: 'POST', body: saveBody\(token, draft\.next\) \}\)/);
    assert.match(SET_PAGE, /<button type="button" className=\{s\.submit\} onClick=\{\(\) => void check\(token\)\}>\{TRY_AGAIN\}<\/button>/);
  });

  test('the token and the password stay in memory: no storage, cookies, logging or query strings', () => {
    for (const [name, text] of [
      ['set-password/page.tsx', SET_PAGE],
      ['set-password/model.ts', SET_MODEL],
      ['forgot-password/page.tsx', FORGOT_PAGE],
      ['forgot-password/model.ts', FORGOT_MODEL],
    ]) {
      assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|document\.cookie|console\.|query:|searchParams/, name);
    }
    assert.match(SET_PAGE, /const \[token, setToken\] = useState\(''\);/);
  });

  test('the form: two password fields with the sign-in show/hide affix, the shared rule list, then save', () => {
    assert.match(SET_PAGE, /className=\{\[s\.input, s\.inputWithAffix, error && s\.inputInvalid\]\.filter\(Boolean\)\.join\(' '\)\}/);
    assert.match(SET_PAGE, /<div className=\{s\.passwordWrap\}>/);
    assert.match(SET_PAGE, /className=\{s\.affixBtn\}/);
    assert.match(SET_PAGE, /aria-pressed=\{shown\}/);
    assert.match(SET_PAGE, /autoComplete="new-password"/);
    assert.equal((SET_PAGE.match(/<input/g) ?? []).length, 1, 'one input, rendered for each field');
    assert.match(SET_PAGE, /<PasswordField\s+field="next"[\s\S]*?describedBy=\{RULES_ID\}[\s\S]*?<PasswordField\s+field="confirm"/);
    assert.match(SET_PAGE, /<PasswordRules id=\{RULES_ID\} items=\{checklist\} \/>/);
    assert.match(SET_PAGE, /newPasswordChecklist\(draft\.next, account\)/);
    assert.match(SET_PAGE, /<ButtonText working=\{busy\} idle=\{SAVE_LABEL\} busy=\{SAVING_LABEL\} \/>/);
    assert.match(SET_PAGE, /<h2 id=\{STEP_HEADING_ID\} className=\{s\.stepTitle\}>\{formHeading\(view\.account\)\}<\/h2>\s*<p className=\{s\.stepLead\}>\{formLead\(view\.account\)\}<\/p>/);
  });

  test('a field error shows under New password, 409 ends in the invalid state, success ends in Password saved', () => {
    assert.match(SET_PAGE, /const nextError = serverError \?\? \(showErrors \? validation\.next \?\? null : null\);/);
    assert.match(SET_PAGE, /if \(outcome\.kind === 'field'\) \{\s*setServerError\(outcome\.message\);/);
    assert.match(SET_PAGE, /setView\(outcome\.kind === 'done' \? \{ kind: 'done' \} : \{ kind: 'invalid' \}\);/);
    assert.match(
      SET_PAGE,
      /<Notice tone="warning" announce>\{LINK_INVALID\}<\/Notice>\s*<p className=\{s\.hint\}>\{INVALID_HELP\}<\/p>\s*<div className=\{s\.altActions\}>\s*<Link href=\{FORGOT_PATH\} className=\{s\.linkBtn\}>\{REQUEST_NEW_LINK\}<\/Link>\s*<Link href=\{SIGN_IN_HREF\} className=\{s\.linkBtn\}>\{BACK_TO_SIGN_IN\}<\/Link>/,
    );
    assert.match(
      SET_PAGE,
      /\{DONE_HEADING\}<\/h2>\s*<p className=\{s\.stepLead\}>\{DONE_LEAD\}<\/p>\s*<Link href=\{SIGN_IN_HREF\} className=\{s\.submit\}>\{SIGN_IN_LABEL\}<\/Link>/,
    );
    assert.equal(loginModel.SIGN_IN_LABEL, 'Sign in');
    assert.doesNotMatch(SET_PAGE, /router|setSessionCookie|\/api\/auth'/);
  });
});

describe('shared parts', () => {
  test('AuthShell renders the sign-in shell with its heading id, and the footnote only when given', () => {
    const shell = (foot?: string) => inApp(createElement(parts.AuthShell, { headingId: 'probe-heading', foot, children: 'Body' }));
    const withFoot = shell('Every request is recorded.');
    assert.match(withFoot, /^<main class="page"><div class="themeSlot">/);
    assert.match(
      withFoot,
      /<section class="panel" aria-labelledby="probe-heading"><header class="head"><span class="mark" aria-hidden="true">CE<\/span><div class="headText"><h1 id="probe-heading" class="wordmark">CardElite<\/h1><p class="kicker">Admin console<\/p><\/div><\/header>Body<p class="foot">Every request is recorded\.<\/p><\/section><\/main>$/,
    );
    assert.match(shell(), /<\/header>Body<\/section><\/main>$/);
  });

  test('FormError shows nothing when empty and an alert otherwise; ButtonText swaps in the spinner', () => {
    assert.equal(render(createElement(parts.FormError, { message: '' })), '');
    const alert = render(createElement(parts.FormError, { message: 'Try again.' }));
    assert.equal(tagsOf(alert, 'div')[0]?.role, 'alert');
    assert.equal(tagsOf(alert, 'div')[0]?.class, 'formError');
    assert.equal(textOf(alert), 'Try again.');
    assert.equal(render(createElement(parts.ButtonText, { working: false, idle: 'Save password', busy: 'Saving…' })), '<span>Save password</span>');
    const busy = render(createElement(parts.ButtonText, { working: true, idle: 'Save password', busy: 'Saving…' }));
    assert.equal(textOf(busy), 'Saving…');
    assert.ok((tagsOf(busy, 'svg')[0]?.class ?? '').split(' ').includes('spin'));
  });

  test('PasswordRules lives in _security, marks met and unmet rules, and Profile uses it', () => {
    const items = setPassword.newPasswordChecklist('Velvet-harbour', INVITE);
    const html = render(createElement(rules.PasswordRules, { id: 'rules', items }));
    const [list] = tagsOf(html, 'ul');
    assert.equal(list.id, 'rules');
    assert.equal(list['aria-label'], 'Password requirements');
    assert.equal(withClass(html, 'li', 'ruleMet').length, items.filter((item) => item.met).length);
    assert.equal(withClass(html, 'li', 'rule').length, items.filter((item) => !item.met).length);
    assert.match(textOf(html), /A number , not met yet/);
    assert.match(textOf(html), /An uppercase letter , met/);
    assert.doesNotMatch(textOf(html), /Different from your current password/);
    assert.match(PROFILE_PARTS, /^import \{ PasswordRules \} from '\.\.\/\.\.\/_security\/PasswordRules';$/m);
    assert.match(PROFILE_PARTS, /^export \{ PasswordRules \};$/m);
    assert.doesNotMatch(PROFILE_PARTS, /function PasswordRules|s\.rule/);
    assert.doesNotMatch(RULES, /useToast|useConfirm/);
  });

  test('the new pages and their models need no toast, confirm, session or server code', () => {
    for (const [name, text] of [['forgot-password/page.tsx', FORGOT_PAGE], ['set-password/page.tsx', SET_PAGE]]) {
      assert.ok(text.startsWith("'use client';"), name);
    }
    for (const [name, text] of [['forgot-password/model.ts', FORGOT_MODEL], ['set-password/model.ts', SET_MODEL]]) {
      assert.doesNotMatch(text, /'use client'|from 'react'|from 'next/, name);
    }
    for (const [name, text] of [
      ['forgot-password/page.tsx', FORGOT_PAGE],
      ['forgot-password/model.ts', FORGOT_MODEL],
      ['set-password/page.tsx', SET_PAGE],
      ['set-password/model.ts', SET_MODEL],
      ['login/AuthParts.tsx', PARTS],
      ['_security/PasswordRules.tsx', RULES],
    ]) {
      assert.doesNotMatch(text, /useToast|useConfirm|ToastProvider|ConfirmProvider/, name);
      assert.doesNotMatch(
        text,
        /lib\/(?:mfa|qr|session|jwt|supabase|guard|audit|api|passwordLinks|edge)['"]|node:crypto|bcrypt|next\/(?:headers|server)/,
        name,
      );
    }
  });
});
