import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ElementType, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import {
  ACTION_FAILED_MESSAGE, CREDENTIAL_HELP, CREDENTIAL_LABEL, DEFAULT_PENDING_LABEL, EMPTY_CONFIRM_VALUES, OTHER_REASON,
  actionErrorText, canConfirm, choosePreset, clearCredential, confirmResult, createConfirmController, credentialReady,
  effectiveReason, settledResult,
  type ConfirmActionSpec, type ConfirmPhase, type ConfirmResult, type ConfirmValues,
} from '../app/_ui/confirmModel.ts';
import { classesOf, loadUi, render, tagsOf, textOf, type Attrs } from './support/uiHarness.ts';
import type { ConfirmFn, ConfirmOptions } from '../app/_ui/Confirm.tsx';

type ConfirmModule = typeof import('../app/_ui/Confirm.tsx');
type OverlayModule = typeof import('../app/_ui/Overlay.tsx');

const noop = () => {};

function values(patch: Partial<ConfirmValues> = {}): ConfirmValues {
  return { ...EMPTY_CONFIRM_VALUES, ...patch };
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value: T | undefined } = { settled: false, value: undefined };
  void promise.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Spec extends ConfirmActionSpec {
  title: string;
}

function controller() {
  return createConfirmController<Spec>();
}

function openSession(c: ReturnType<typeof controller>, spec: Spec) {
  const result = track(c.request(spec));
  const session = c.getSession();
  assert.ok(session, 'request must open a session');
  return { result, id: session.id };
}

describe('effective reason', () => {
  test('a chosen preset is the reason, and stale custom text is ignored', () => {
    assert.equal(effectiveReason({ preset: 'Duplicate request', reason: 'left over' }), 'Duplicate request');
  });

  test('"Other" uses the typed text, trimmed', () => {
    assert.equal(effectiveReason({ preset: OTHER_REASON, reason: '  card is fake  ' }), 'card is fake');
  });

  test('with no presets the typed text is the reason, trimmed', () => {
    assert.equal(effectiveReason({ preset: '', reason: '  audit note ' }), 'audit note');
    assert.equal(effectiveReason({ preset: '', reason: '   ' }), '');
  });

  test('choosing a preset clears custom text; choosing "Other" keeps it', () => {
    const typed = values({ preset: OTHER_REASON, reason: 'my words' });
    assert.deepEqual(choosePreset(typed, 'Fraud'), values({ preset: 'Fraud', reason: '' }));
    assert.deepEqual(choosePreset(typed, OTHER_REASON), typed);
  });
});

describe('can confirm', () => {
  test('a plain dialog can always be confirmed', () => {
    assert.equal(canConfirm({}, values()), true);
  });

  test('the typed phrase must match exactly after trimming', () => {
    const rules = { requireTyped: 'SEND TO ALL' };
    assert.equal(canConfirm(rules, values({ typed: 'send to all' })), false);
    assert.equal(canConfirm(rules, values({ typed: 'SEND TO AL' })), false);
    assert.equal(canConfirm(rules, values({ typed: '  SEND TO ALL ' })), true);
  });

  test('the acknowledgement must be ticked', () => {
    const rules = { acknowledge: 'I checked the destination account' };
    assert.equal(canConfirm(rules, values()), false);
    assert.equal(canConfirm(rules, values({ acknowledged: true })), true);
  });

  test('a required reason needs a preset or non-blank "Other" text', () => {
    const rules = { reason: { required: true } };
    assert.equal(canConfirm(rules, values()), false);
    assert.equal(canConfirm(rules, values({ preset: 'Fraud' })), true);
    assert.equal(canConfirm(rules, values({ preset: OTHER_REASON, reason: '   ' })), false);
    assert.equal(canConfirm(rules, values({ preset: OTHER_REASON, reason: 'Stolen card' })), true);
    assert.equal(canConfirm(rules, values({ reason: 'Free text without presets' })), true);
  });

  test('an optional reason never blocks', () => {
    assert.equal(canConfirm({ reason: {} }, values()), true);
  });

  test('every rule must pass at once', () => {
    const rules = { requireTyped: 'FREEZE', acknowledge: 'Understood', reason: { required: true } };
    assert.equal(canConfirm(rules, values({ typed: 'FREEZE', acknowledged: true })), false);
    assert.equal(canConfirm(rules, values({ typed: 'FREEZE', acknowledged: true, preset: 'Fraud' })), true);
  });
});

describe('credential option rules (opt-in)', () => {
  test('the empty values carry an empty credential', () => {
    assert.equal(EMPTY_CONFIRM_VALUES.credential, '');
    assert.equal(Object.isFrozen(EMPTY_CONFIRM_VALUES), true);
  });

  test('a code needs exactly 6 digits', () => {
    const rules = { credential: { kind: 'otp' as const } };
    for (const credential of ['', '12345', '1234567', '12345a', ' 12345', '123 456']) {
      assert.equal(canConfirm(rules, values({ credential })), false, JSON.stringify(credential));
    }
    assert.equal(canConfirm(rules, values({ credential: '012345' })), true);
    assert.equal(credentialReady('otp', '999999'), true);
  });

  test('a password needs any non-empty value, spaces included, and is never trimmed', () => {
    const rules = { credential: { kind: 'password' as const } };
    assert.equal(canConfirm(rules, values()), false);
    assert.equal(canConfirm(rules, values({ credential: ' ' })), true);
    assert.equal(canConfirm(rules, values({ credential: 'correct horse' })), true);
    assert.equal(credentialReady('password', ''), false);
  });

  test('without the option a typed credential changes nothing', () => {
    assert.equal(canConfirm({}, values({ credential: 'ignored' })), true);
    assert.equal(canConfirm({ reason: { required: true } }, values({ credential: '123456' })), false);
  });

  test('the credential must pass together with every other rule', () => {
    const rules = { reason: { required: true }, acknowledge: 'I checked', credential: { kind: 'otp' as const } };
    assert.equal(canConfirm(rules, values({ preset: 'Lost phone', acknowledged: true })), false);
    assert.equal(canConfirm(rules, values({ preset: 'Lost phone', credential: '123456' })), false);
    assert.equal(canConfirm(rules, values({ preset: 'Lost phone', acknowledged: true, credential: '123456' })), true);
  });

  test('the result carries the credential only when the option is on', () => {
    const typed = values({ preset: 'Lost phone', credential: '123456' });
    assert.deepEqual(confirmResult({ credential: { kind: 'otp' } }, typed), { reason: 'Lost phone', credential: '123456' });
    assert.deepEqual(confirmResult({}, typed), { reason: 'Lost phone' });
    assert.deepEqual(Object.keys(confirmResult({}, typed)), ['reason']);
  });

  test('clearing empties only the credential, and keeps the same object when there is nothing to clear', () => {
    const typed = values({ preset: 'Lost phone', reason: '', acknowledged: true, credential: '123456' });
    assert.deepEqual(clearCredential(typed), { ...typed, credential: '' });
    const empty = values({ preset: 'Lost phone' });
    assert.equal(clearCredential(empty), empty);
  });

  test('the settled result drops the credential and keeps the reason and the value', () => {
    assert.deepEqual(settledResult({ reason: 'r', credential: 'pw', value: 1 }), { reason: 'r', value: 1 });
    const plain = { reason: 'r', value: 1 };
    assert.equal(settledResult(plain), plain);
  });

  test('the default field copy', () => {
    assert.equal(CREDENTIAL_LABEL.otp, 'Code from your authenticator app');
    assert.equal(CREDENTIAL_LABEL.password, 'Your password');
    assert.equal(CREDENTIAL_HELP, 'Asked before changes to sign-in security.');
  });
});

describe('confirm with a credential and an action', () => {
  test('the action receives the credential; confirm() resolves without it', async () => {
    const c = controller();
    const seen: ConfirmResult[] = [];
    const { result, id } = openSession(c, {
      title: 'Get new recovery codes?',
      action: async (base) => {
        seen.push(base);
        return { codes: 10 };
      },
    });
    c.submit(id, { reason: '', credential: '123456' });
    await flush();
    assert.deepEqual(seen, [{ reason: '', credential: '123456' }]);
    assert.deepEqual(result.value, { reason: '', value: { codes: 10 } });
    assert.equal('credential' in (result.value ?? {}), false, 'the code or password never leaves the dialog after use');
  });

  test('a failed check keeps the dialog open; the retry sends the new credential', async () => {
    const c = controller();
    const seen: Array<string | undefined> = [];
    const { result, id } = openSession(c, {
      title: 'Reset two-step sign-in for @ada?',
      action: async (base) => {
        seen.push(base.credential);
        if (seen.length === 1) throw new Error('That code did not work. Enter the newest code from your authenticator app.');
        return 'reset';
      },
    });
    c.submit(id, { reason: 'Lost or replaced phone', credential: '111111' });
    await flush();
    assert.equal(c.getSession()?.phase, 'failed');
    assert.equal(c.getSession()?.error, 'That code did not work. Enter the newest code from your authenticator app.');
    assert.equal(result.settled, false);
    c.submit(id, { reason: 'Lost or replaced phone', credential: '222222' });
    await flush();
    assert.deepEqual(seen, ['111111', '222222']);
    assert.deepEqual(result.value, { reason: 'Lost or replaced phone', value: 'reset' });
  });

  test('without an action the page gets the credential back to send itself', async () => {
    const c = controller();
    const { result, id } = openSession(c, { title: 'Confirm it is you' });
    c.submit(id, { reason: '', credential: 'pw' });
    await flush();
    assert.deepEqual(result.value, { reason: '', credential: 'pw' });
  });
});

describe('action error message', () => {
  test('actionErrorMessage decides the text when it returns something', () => {
    assert.equal(actionErrorText(new Error('raw'), () => '  The provider declined the payout.  '), 'The provider declined the payout.');
  });

  test('a blank or throwing actionErrorMessage falls back to the Error message', () => {
    assert.equal(actionErrorText(new Error('Already approved by another admin.'), () => '  '), 'Already approved by another admin.');
    assert.equal(
      actionErrorText(new Error('Already approved by another admin.'), () => { throw new Error('bug'); }),
      'Already approved by another admin.',
    );
  });

  test('an Error the page threw is shown as written, trimmed', () => {
    class DecisionError extends Error {}
    assert.equal(actionErrorText(new DecisionError(' Limit exceeded. ')), 'Limit exceeded.');
  });

  test('platform errors never reach the admin verbatim', () => {
    assert.equal(actionErrorText(new TypeError('Failed to fetch')), ACTION_FAILED_MESSAGE);
    assert.equal(actionErrorText(new SyntaxError('Unexpected token < in JSON')), ACTION_FAILED_MESSAGE);
    assert.equal(actionErrorText(new DOMException('signal timed out', 'TimeoutError')), ACTION_FAILED_MESSAGE);
    assert.equal(actionErrorText(new DOMException('The user aborted a request.', 'AbortError')), ACTION_FAILED_MESSAGE);
  });

  test('abort and timeout errors that are plain Errors by name are treated as platform errors too', () => {
    const aborted = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    const timedOut = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
    assert.equal(actionErrorText(aborted), ACTION_FAILED_MESSAGE);
    assert.equal(actionErrorText(timedOut), ACTION_FAILED_MESSAGE);
    assert.equal(actionErrorText(aborted, () => 'The request took too long. Check the status first.'), 'The request took too long. Check the status first.');
  });

  test('anything else falls back to the generic sentence', () => {
    assert.equal(actionErrorText('plain string'), ACTION_FAILED_MESSAGE);
    assert.equal(actionErrorText({ message: 'not an Error' }), ACTION_FAILED_MESSAGE);
    assert.equal(actionErrorText(undefined), ACTION_FAILED_MESSAGE);
    assert.equal(actionErrorText(new Error('   ')), ACTION_FAILED_MESSAGE);
  });

  test('the generic sentence does not claim the action failed cleanly', () => {
    assert.match(ACTION_FAILED_MESSAGE, /may or may not have gone through/);
  });
});

describe('confirm without an action (unchanged behaviour)', () => {
  test('Confirm resolves exactly { reason } and closes at once', async () => {
    const c = controller();
    const { result, id } = openSession(c, { title: 'Log out?' });
    assert.equal(c.submit(id, { reason: '' }), true);
    assert.equal(c.getSession(), null);
    await flush();
    assert.deepEqual(result.value, { reason: '' });
    assert.deepEqual(Object.keys(result.value ?? {}), ['reason'], 'no value key without an action');
  });

  test('Cancel resolves null', async () => {
    const c = controller();
    const { result, id } = openSession(c, { title: 'Log out?' });
    assert.equal(c.cancel(id), true);
    await flush();
    assert.equal(result.settled, true);
    assert.equal(result.value, null);
  });

  test('a pathname change closes the dialog with null', async () => {
    const c = controller();
    const { result } = openSession(c, { title: 'Discard changes?' });
    assert.equal(c.navigate(), true);
    assert.equal(c.getSession(), null);
    await flush();
    assert.equal(result.value, null);
  });

  test('a second confirm() resolves the first with null and shows the second', async () => {
    const c = controller();
    const first = openSession(c, { title: 'First' });
    const second = openSession(c, { title: 'Second' });
    await flush();
    assert.equal(first.result.value, null);
    assert.equal(c.getSession()?.options.title, 'Second');
    assert.notEqual(second.id, first.id);
  });
});

describe('confirm with an action', () => {
  test('Confirm keeps the dialog open, pending, until the action resolves; then resolves { reason, value }', async () => {
    const c = controller();
    const job = deferred<{ status: string }>();
    const calls: ConfirmResult[] = [];
    const { result, id } = openSession(c, {
      title: 'Approve payout?',
      action: (base) => {
        calls.push(base);
        return job.promise;
      },
    });
    assert.equal(c.submit(id, { reason: 'checked' }), true);
    assert.equal(c.getSession()?.phase, 'pending');
    assert.equal(c.getSession()?.error, null);
    assert.deepEqual(calls, [{ reason: 'checked' }], 'the action receives the confirmed reason');
    await flush();
    assert.equal(result.settled, false, 'confirm() must not resolve while the action is in flight');
    job.resolve({ status: 'processing' });
    await flush();
    assert.equal(c.getSession(), null);
    assert.deepEqual(result.value, { reason: 'checked', value: { status: 'processing' } });
  });

  test('an in-flight action cannot be abandoned: Cancel, Escape/backdrop and a second Confirm are ignored', async () => {
    const c = controller();
    const job = deferred();
    let runs = 0;
    const { result, id } = openSession(c, {
      title: 'Approve payout?',
      action: () => {
        runs += 1;
        return job.promise;
      },
    });
    c.submit(id, { reason: '' });
    assert.equal(c.cancel(id), false);
    assert.equal(c.submit(id, { reason: '' }), false);
    assert.equal(runs, 1, 'a double click must not send the money action twice');
    assert.equal(c.getSession()?.phase, 'pending');
    await flush();
    assert.equal(result.settled, false);
    job.resolve('done');
    await flush();
    assert.deepEqual(result.value, { reason: '', value: 'done' });
  });

  test('a failed action stays open with the error, re-enables the dialog, and confirm() stays unresolved', async () => {
    const c = controller();
    const job = deferred();
    const { result, id } = openSession(c, { title: 'Approve payout?', action: () => job.promise });
    c.submit(id, { reason: '' });
    job.reject(new Error('The provider did not accept the payout.'));
    await flush();
    const session = c.getSession();
    assert.equal(session?.id, id, 'the same dialog stays open');
    assert.equal(session?.phase, 'failed');
    assert.equal(session?.error, 'The provider did not accept the payout.');
    assert.equal(result.settled, false);
    assert.equal(c.cancel(id), true, 'Cancel works again after a failure');
    await flush();
    assert.equal(result.value, null, 'confirm() resolves null only on the later cancel');
  });

  test('Confirm after a failure retries the action and resolves with the retry result', async () => {
    const c = controller();
    let attempt = 0;
    const { result, id } = openSession(c, {
      title: 'Approve payout?',
      action: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('Temporarily unavailable.');
        return { attempt };
      },
    });
    c.submit(id, { reason: 'first' });
    await flush();
    assert.equal(c.getSession()?.phase, 'failed');
    assert.equal(c.submit(id, { reason: 'second' }), true);
    assert.equal(c.getSession()?.phase, 'pending');
    assert.equal(c.getSession()?.error, null, 'the old error clears while the retry runs');
    await flush();
    assert.deepEqual(result.value, { reason: 'second', value: { attempt: 2 } });
  });

  test('actionErrorMessage chooses the inline text', async () => {
    const c = controller();
    const { id } = openSession(c, {
      title: 'Freeze account?',
      action: () => Promise.reject(new TypeError('Failed to fetch')),
      actionErrorMessage: () => 'Could not reach the server. Nothing was changed.',
    });
    c.submit(id, { reason: 'fraud' });
    await flush();
    assert.equal(c.getSession()?.error, 'Could not reach the server. Nothing was changed.');
  });

  test('a page can tell an attempted-then-cancelled action from a plain cancel through its own closure', async () => {
    const c = controller();
    let sent = false;
    const { result, id } = openSession(c, {
      title: 'Approve payout?',
      action: async () => {
        sent = true;
        throw new Error('The provider did not answer.');
      },
    });
    c.submit(id, { reason: '' });
    await flush();
    c.cancel(id);
    await flush();
    assert.equal(result.value, null);
    assert.equal(sent, true, 'the page must still refresh: the request may have reached the server');
  });

  test('navigation with no dialog open is a no-op', () => {
    const c = controller();
    assert.equal(c.navigate(), false);
    assert.equal(c.getSession(), null);
  });

  test('an action that throws synchronously fails like a rejection', async () => {
    const c = controller();
    const { result, id } = openSession(c, {
      title: 'Approve payout?',
      action: () => {
        throw new Error('Invalid amount.');
      },
    });
    assert.equal(c.submit(id, { reason: '' }), true);
    await flush();
    assert.equal(c.getSession()?.phase, 'failed');
    assert.equal(c.getSession()?.error, 'Invalid amount.');
    assert.equal(result.settled, false);
  });
});

describe('navigation while an action is in flight', () => {
  test('the pathname change is deferred: the action finishes and confirm() resolves with its result, not null', async () => {
    const c = controller();
    const job = deferred();
    const { result, id } = openSession(c, { title: 'Approve payout?', action: () => job.promise });
    c.submit(id, { reason: '' });
    assert.equal(c.navigate(), false);
    assert.equal(c.getSession()?.phase, 'pending', 'the dialog stays up, pending, on the new page');
    job.resolve('ok');
    await flush();
    assert.equal(c.getSession(), null);
    assert.deepEqual(result.value, { reason: '', value: 'ok' });
  });

  test('if the deferred action then fails, the error stays visible; the next pathname change closes it with null', async () => {
    const c = controller();
    const job = deferred();
    const { result, id } = openSession(c, { title: 'Approve payout?', action: () => job.promise });
    c.submit(id, { reason: '' });
    c.navigate();
    job.reject(new Error('The provider did not accept the payout.'));
    await flush();
    assert.equal(c.getSession()?.phase, 'failed', 'a money failure is never hidden by navigation');
    assert.equal(result.settled, false);
    assert.equal(c.navigate(), true);
    await flush();
    assert.equal(result.value, null);
  });
});

describe('a second confirm() while one is open', () => {
  test('with an action in flight, the NEW call resolves null at once and the running one is untouched', async () => {
    const c = controller();
    const job = deferred();
    const first = openSession(c, { title: 'Approve payout?', action: () => job.promise });
    c.submit(first.id, { reason: '' });
    const second = track(c.request({ title: 'Reject payout?' }));
    await flush();
    assert.equal(second.settled, true);
    assert.equal(second.value, null);
    assert.equal(c.getSession()?.id, first.id);
    assert.equal(c.getSession()?.phase, 'pending');
    assert.equal(first.result.settled, false);
    job.resolve('ok');
    await flush();
    assert.deepEqual(first.result.value, { reason: '', value: 'ok' });
  });

  test('after a failure nothing is running, so the new call replaces it and the failed one resolves null', async () => {
    const c = controller();
    const first = openSession(c, { title: 'Approve payout?', action: () => Promise.reject(new Error('No.')) });
    c.submit(first.id, { reason: '' });
    await flush();
    const second = openSession(c, { title: 'Reject payout?' });
    await flush();
    assert.equal(first.result.value, null);
    assert.equal(c.getSession()?.id, second.id);
    assert.equal(c.getSession()?.phase, 'idle');
  });

  test('a refused call while an action runs does not disturb subscribers or the running dialog', async () => {
    const c = controller();
    const job = deferred();
    const first = openSession(c, { title: 'Approve payout?', action: () => job.promise });
    c.submit(first.id, { reason: '' });
    const running = c.getSession();
    let heard = 0;
    const stop = c.subscribe(() => {
      heard += 1;
    });
    await c.request({ title: 'Reject payout?' });
    assert.equal(heard, 0);
    assert.equal(c.getSession(), running);
    stop();
    job.resolve('ok');
    await flush();
  });

  test('clicks meant for a replaced dialog are ignored', async () => {
    const c = controller();
    const first = openSession(c, { title: 'First' });
    const second = openSession(c, { title: 'Second' });
    assert.equal(c.submit(first.id, { reason: '' }), false);
    assert.equal(c.cancel(first.id), false);
    assert.equal(c.getSession()?.id, second.id);
  });
});

describe('ConfirmFn typing', () => {
  test('the action value type flows to the result, and option objects typed without it still fit', async () => {
    const calls: ConfirmOptions[] = [];
    const confirm = (async (options: ConfirmOptions) => {
      calls.push(options);
      return { reason: 'r', value: { status: 'processing' } };
    }) as ConfirmFn;
    const decision = await confirm({ title: 'Approve payout?', action: async () => ({ status: 'processing' as const }) });
    const status: 'processing' | undefined = decision?.value?.status;
    assert.equal(status, 'processing');
    const plain: ConfirmOptions = { title: 'Log out?' };
    const legacy = await confirm(plain);
    assert.equal(legacy?.reason, 'r');
    assert.equal(calls.length, 2);
  });
});

describe('controller store contract', () => {
  test('the snapshot is stable between changes and subscribers hear every change', async () => {
    const c = controller();
    let heard = 0;
    const stop = c.subscribe(() => {
      heard += 1;
    });
    assert.equal(c.getSession(), c.getSession());
    const job = deferred();
    const { id } = openSession(c, { title: 'Approve payout?', action: () => job.promise });
    const opened = c.getSession();
    assert.equal(c.getSession(), opened);
    c.submit(id, { reason: '' });
    assert.notEqual(c.getSession(), opened);
    job.reject(new Error('No.'));
    await flush();
    c.cancel(id);
    assert.equal(heard, 4, 'open, pending, failed, closed');
    stop();
    openSession(c, { title: 'Again' });
    assert.equal(heard, 4);
  });
});

describe('ConfirmDialog markup', () => {
  let ConfirmDialog: ElementType;

  before(async () => {
    ({ ConfirmDialog } = await loadUi<ConfirmModule>('Confirm.tsx'));
  });

  function dialog(options: ConfirmOptions, phase: ConfirmPhase = 'idle', error: string | null = null) {
    return render(createElement(ConfirmDialog, { session: { id: 1, options, phase, error }, onSubmit: noop, onCancel: noop }));
  }

  function buttons(html: string): { cancel: Attrs; confirm: Attrs } {
    const [cancel, confirm, ...rest] = tagsOf(html, 'button');
    assert.equal(rest.length, 0, 'only Cancel and Confirm are buttons');
    return { cancel, confirm };
  }

  function hasAttr(attrs: Attrs | undefined, name: string): boolean {
    return Object.keys(attrs ?? {}).some((key) => key.toLowerCase() === name);
  }

  function statusText(html: string): string | null {
    const match = html.match(/<p class="status" role="status">([^<]*)<\/p>/);
    return match ? match[1] : null;
  }

  const action = () => Promise.resolve();

  const withdrawal: ConfirmOptions = {
    tone: 'danger',
    title: 'Reject ₦5,000 withdrawal?',
    reason: { required: true, presets: ['Suspicious activity'], label: 'Reason for rejecting' },
    requireTyped: 'REJECT',
    acknowledge: 'The user is refunded in full.',
    confirmLabel: 'Reject and refund',
    action,
  };

  test('without an action there is no status line and no alert', () => {
    const html = dialog({ title: 'Log out?', confirmLabel: 'Log out' });
    assert.equal(statusText(html), null);
    assert.equal(tagsOf(html, 'div').some((attrs) => attrs.role === 'alert'), false);
    const { cancel, confirm } = buttons(html);
    assert.equal('disabled' in cancel, false);
    assert.equal('disabled' in confirm, false);
    assert.equal('aria-busy' in confirm, false);
  });

  test('idle with an action: the polite status line is already mounted and empty', () => {
    const html = dialog({ title: 'Approve payout?', action });
    assert.equal(statusText(html), '', 'a live region must exist before its text changes');
  });

  test('unmet requirements keep Confirm disabled, as before', () => {
    const { confirm } = buttons(dialog(withdrawal));
    assert.equal('disabled' in confirm, true);
    assert.equal('aria-disabled' in confirm, false);
  });

  test('pending: Confirm stays focusable but inert (aria-disabled, aria-busy, spinner); Cancel is disabled', () => {
    const html = dialog(withdrawal, 'pending');
    const { cancel, confirm } = buttons(html);
    assert.equal(confirm['aria-disabled'], 'true');
    assert.equal(confirm['aria-busy'], 'true');
    assert.equal('disabled' in confirm, false, 'a disabled button would drop keyboard focus to <body>');
    assert.equal('disabled' in cancel, true);
    const spinner = tagsOf(html, 'svg').find((attrs) => classesOf(attrs).includes('spinner'));
    assert.equal(spinner?.['aria-hidden'], 'true');
  });

  test('pending: the status line says what is happening, default "Working…"', () => {
    assert.equal(statusText(dialog(withdrawal, 'pending')), DEFAULT_PENDING_LABEL);
    assert.equal(DEFAULT_PENDING_LABEL, 'Working…');
    assert.equal(
      statusText(dialog({ ...withdrawal, pendingLabel: 'Sending the payout to the provider…' }, 'pending')),
      'Sending the payout to the provider…',
    );
  });

  test('pending: text fields are read-only and choices are locked', () => {
    const html = dialog({ ...withdrawal, reason: { required: true } }, 'pending');
    const [textarea] = tagsOf(html, 'textarea');
    assert.equal(hasAttr(textarea, 'readonly'), true);
    assert.equal(hasAttr(textarea, 'disabled'), false, 'read-only keeps the text focusable and selectable');
    assert.ok(classesOf(textarea).includes('readOnly'));
    const inputs = tagsOf(html, 'input');
    const typed = inputs.find((attrs) => attrs.placeholder === 'REJECT');
    assert.equal(hasAttr(typed, 'readonly'), true);
    const checkbox = inputs.find((attrs) => attrs.type === 'checkbox');
    assert.equal(hasAttr(checkbox, 'disabled'), true);
    const [idleTextarea] = tagsOf(dialog({ ...withdrawal, reason: { required: true } }), 'textarea');
    assert.equal(hasAttr(idleTextarea, 'readonly'), false);
    assert.equal(classesOf(idleTextarea).includes('readOnly'), false);
  });

  test('pending: preset radios are disabled through their fieldset', () => {
    const [fieldset] = tagsOf(dialog(withdrawal, 'pending'), 'fieldset');
    assert.equal('disabled' in fieldset, true);
    const [idleFieldset] = tagsOf(dialog(withdrawal), 'fieldset');
    assert.equal('disabled' in idleFieldset, false);
  });

  test('failed: the error appears once, as an alert, and both buttons work again', () => {
    const message = 'The provider did not accept the payout.';
    const html = dialog({ title: 'Approve payout?', action }, 'failed', message);
    const alerts = tagsOf(html, 'div').filter((attrs) => attrs.role === 'alert');
    assert.equal(alerts.length, 1);
    assert.ok(classesOf(alerts[0]).includes('error'));
    assert.equal(textOf(html).split(message).length - 1, 1, 'the message is rendered exactly once');
    assert.equal(statusText(html), '', 'the status line is cleared so nothing is announced twice');
    const { cancel, confirm } = buttons(html);
    assert.equal('disabled' in cancel, false);
    assert.equal('disabled' in confirm, false);
    assert.equal('aria-disabled' in confirm, false);
  });

  test('title and error icons are hidden from assistive technology', () => {
    const html = dialog({ title: 'Approve payout?', tone: 'financial', action }, 'failed', 'No.');
    const icons = tagsOf(html, 'svg');
    assert.ok(icons.length >= 2);
    for (const icon of icons) assert.equal(icon['aria-hidden'], 'true');
  });

  test('the dialog is a labelled modal dialog', () => {
    const html = dialog({ title: 'Approve payout?', action });
    const panel = tagsOf(html, 'div').find((attrs) => attrs.role === 'dialog');
    assert.equal(panel?.['aria-modal'], 'true');
    assert.ok(panel?.['aria-labelledby']);
    assert.ok(html.includes(`id="${panel?.['aria-labelledby']}"`));
  });

  const reset: ConfirmOptions = {
    tone: 'danger',
    title: 'Reset two-step sign-in for @ada?',
    reason: { required: true, presets: ['Lost or replaced phone'] },
    acknowledge: 'I checked who asked',
    credential: { kind: 'otp' },
    confirmLabel: 'Reset two-step sign-in',
    action,
  };

  function credentialInput(html: string): Attrs | undefined {
    return tagsOf(html, 'input').find((attrs) => attrs.name === 'otp' || attrs.name === 'password');
  }

  test('an otp credential renders last: a labelled, required, mono, numeric one-time-code field with the default help', () => {
    const html = dialog(reset);
    const input = credentialInput(html);
    assert.ok(input);
    assert.equal(input.type, 'text');
    assert.equal(input.inputMode, 'numeric');
    assert.equal(input.autoComplete, 'one-time-code');
    assert.equal(input['aria-required'], 'true');
    assert.equal(input.translate, 'no');
    assert.equal('maxLength' in input, false);
    assert.ok(classesOf(input).includes('mono'));
    const label = tagsOf(html, 'label').find((attrs) => attrs.for === input.id);
    assert.ok(label);
    assert.match(textOf(html), /Code from your authenticator app Asked before changes to sign-in security\./);
    assert.ok(html.indexOf('name="otp"') > html.indexOf('type="checkbox"'), 'after the acknowledgement');
    assert.ok(html.indexOf('name="otp"') > html.indexOf('type="radio"'), 'after the reason');
    assert.ok(html.indexOf('name="otp"') < html.indexOf('<button'), 'before the footer buttons');
  });

  test('a password credential is a current-password field labelled Your password', () => {
    const html = dialog({ title: 'Set up two-step sign-in?', credential: { kind: 'password' }, action });
    const input = credentialInput(html);
    assert.equal(input?.type, 'password');
    assert.equal(input?.autoComplete, 'current-password');
    assert.match(textOf(html), /Your password Asked before changes to sign-in security\./);
  });

  test('the label and help can be replaced, and an empty help hides it', () => {
    const custom = textOf(dialog({ title: 'x', credential: { kind: 'otp', label: 'Code from your app', help: 'It changes every 30 seconds.' } }));
    assert.match(custom, /Code from your app It changes every 30 seconds\./);
    const quiet = textOf(dialog({ title: 'x', credential: { kind: 'otp', help: '' } }));
    assert.doesNotMatch(quiet, /Asked before changes/);
  });

  test('Confirm stays disabled until the credential is ready; the field adds no extra button', () => {
    const { confirm } = buttons(dialog({ title: 'Get new recovery codes?', credential: { kind: 'otp' }, action }));
    assert.equal('disabled' in confirm, true);
  });

  test('pending: the credential is read-only and focusable, never disabled', () => {
    const input = credentialInput(dialog(reset, 'pending'));
    assert.ok(input);
    assert.equal(hasAttr(input, 'readonly'), true);
    assert.equal('disabled' in input, false);
    assert.ok(classesOf(input).includes('readOnly'));
    const idle = credentialInput(dialog(reset));
    assert.equal(hasAttr(idle, 'readonly'), false);
  });

  test('with both an acknowledgement and a credential, the checkbox sits in a spaced block; without a credential the markup is unchanged', () => {
    const withCredential = dialog({ title: 'x', acknowledge: 'I checked', credential: { kind: 'otp' } });
    const blocks = tagsOf(withCredential, 'div').filter((attrs) => classesOf(attrs).includes('block'));
    assert.equal(blocks.length, 2);
    const plain = { title: 'Reject payout?', acknowledge: 'I checked', reason: { required: true }, action };
    assert.equal(dialog({ ...plain, credential: undefined }), dialog(plain));
    assert.equal(tagsOf(dialog(plain), 'div').filter((attrs) => classesOf(attrs).includes('block')).length, 1);
  });

  test('a failure clears the credential and moves focus back to it', () => {
    const source = readFileSync(new URL('../app/_ui/Confirm.tsx', import.meta.url), 'utf8');
    assert.match(source, /if \(phase === 'failed' && credentialSpec\) setValues\(clearCredential\);/);
    assert.match(source, /if \(phase !== 'failed' \|\| !hasCredential\) return;\s+credentialRef\.current\?\.focus\(\{ preventScroll: true \}\);/);
    assert.match(source, /onSubmit\(confirmResult\(options, values\)\)/);
    assert.match(source, /update\(\{ credential: sanitizeOtp\(e\.target\.value\) \}\)/);
  });
});

describe('ConfirmProvider on the server', () => {
  let mod: ConfirmModule;

  before(async () => {
    mod = await loadUi<ConfirmModule>('Confirm.tsx');
  });

  test('renders only its children, so server and client markup match', () => {
    const html = render(createElement(mod.ConfirmProvider, null, createElement('main', null, 'Withdrawals')));
    assert.equal(html, '<main>Withdrawals</main>');
  });

  test('useConfirm gives a confirm function inside the provider and throws outside it', () => {
    function Probe(): ReactNode {
      const confirm = mod.useConfirm();
      return typeof confirm;
    }
    assert.equal(render(createElement(mod.ConfirmProvider, null, createElement(Probe))), 'function');
    assert.throws(() => render(createElement(Probe)), /inside <ConfirmProvider>/);
  });
});

describe('Modal and SidePanel returnFocusTo', () => {
  let overlay: OverlayModule;

  before(async () => {
    overlay = await loadUi<OverlayModule>('Overlay.tsx');
  });

  test('returnFocusTo changes nothing in the rendered markup', () => {
    const fallback = () => null;
    const modal = (extra: object) => render(createElement(overlay.Modal, {
      open: true, onClose: noop, title: 'Export', footer: 'Footer', children: 'Body', ...extra,
    }));
    assert.equal(modal({ returnFocusTo: fallback }), modal({}));
    const panel = (extra: object) => render(createElement(overlay.SidePanel, {
      open: true, onClose: noop, title: 'Withdrawal', children: 'Body', ...extra,
    }));
    assert.equal(panel({ returnFocusTo: fallback }), panel({}));
  });

  test('a closed Modal or SidePanel renders nothing', () => {
    assert.equal(render(createElement(overlay.Modal, { open: false, onClose: noop, children: 'Body' })), '');
    assert.equal(render(createElement(overlay.SidePanel, { open: false, onClose: noop, children: 'Body' })), '');
  });

  test('close buttons are named and their icons hidden', () => {
    const html = render(createElement(overlay.SidePanel, { open: true, onClose: noop, title: 'Withdrawal', children: 'Body' }));
    const [close] = tagsOf(html, 'button');
    assert.equal(close['aria-label'], 'Close panel');
    assert.equal(tagsOf(html, 'svg')[0]?.['aria-hidden'], 'true');
  });
});
