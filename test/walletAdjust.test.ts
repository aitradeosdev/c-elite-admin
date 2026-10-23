import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import ts from 'typescript';
import { loadAppModule, loadUi, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import { groupedNairaText, koboText, parseNaira, toKobo } from '../app/lib/naira.ts';
import { ERROR_STATUS } from '../app/lib/http.ts';
import { businessDayStart } from '../app/lib/time.ts';
import type {
  AdjustForm, AdjustOutcome, AdjustPayload, AdjustReceipt, AttemptState, Refusal, WalletContext,
} from '../app/(dashboard)/users/[id]/walletAdjust.ts';
import type { UserProfile } from '../app/(dashboard)/users/[id]/model.ts';
import type { ApiBody, ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type { ConfirmOptions } from '../app/_ui/Confirm.tsx';

type AdjustModule = typeof import('../app/(dashboard)/users/[id]/walletAdjust.ts');
type PanelModule = typeof import('../app/(dashboard)/users/[id]/WalletAdjustPanel.tsx');
type PartsModule = typeof import('../app/(dashboard)/users/[id]/UserParts.tsx');
type PermissionsModule = typeof import('../app/_ui/Permissions.tsx');
type ConfirmModule = typeof import('../app/_ui/Confirm.tsx');

let adjust: AdjustModule;
let panel: PanelModule;
let parts: PartsModule;
let perms: PermissionsModule;
let confirmUi: ConfirmModule;

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const OWNED_DIR = join(APP_DIR, '(dashboard)', 'users', '[id]');
const ROUTE_FILE = join(APP_DIR, 'api', 'users', '[id]', 'wallet-adjustments', 'route.ts');
const NAIRA_FILE = join(APP_DIR, 'lib', 'naira.ts');

const USER_ID = '3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const ADMIN_ID = '0e000000-0000-4000-8000-0000000000aa';
const OTHER_ADMIN_ID = '0e000000-0000-4000-8000-0000000000bb';
const ADJUSTMENT_ID = '5d1e8a3b-2f47-4c9b-8e15-7a0c3d9b5f21';
const TRANSACTION_ID = '6e2f9b4c-3a58-4dab-9f26-8b1d4e0c6a32';
const KEY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const STAMP = '2026-10-10T09:30:00.000Z';
const REQUEST_ID = 'req_walletadj01';
const USER_AGENT = 'wallet-adjust-test';
const CLIENT_IP = '198.51.100.44';
const PRESET = 'Card trade paid at the wrong amount';
const RPC_PARAMS = [
  'p_admin_id', 'p_amount', 'p_direction', 'p_expected_balance', 'p_idempotency_key', 'p_ip', 'p_reason', 'p_reference',
  'p_request_id', 'p_user_agent', 'p_user_id', 'p_user_note',
];

const USER: UserProfile = {
  id: USER_ID,
  full_name: 'Ada Obi',
  username: 'ada',
  email: 'ada@example.com',
  phone: '08030000000',
  country: 'NG',
  is_active: true,
  is_frozen: false,
  freeze_reason: null,
  referral_code: 'ADA1',
  referred_by: null,
  bonus_balance: 0,
  last_active_at: STAMP,
  created_at: '2026-01-02T09:00:00.000Z',
  deleted_at: null,
  balance: 1500,
  avatar_url: null,
};

before(async () => {
  adjust = await loadAppModule<AdjustModule>('(dashboard)/users/[id]/walletAdjust.ts');
  panel = await loadAppModule<PanelModule>('(dashboard)/users/[id]/WalletAdjustPanel.tsx');
  parts = await loadAppModule<PartsModule>('(dashboard)/users/[id]/UserParts.tsx');
  perms = await loadUi<PermissionsModule>('Permissions.tsx');
  confirmUi = await loadUi<ConfirmModule>('Confirm.tsx');
});

function contextBody(patch: ApiBody = {}): ApiBody {
  return {
    success: true,
    user: { id: USER_ID, full_name: 'Ada Obi', username: 'ada', is_frozen: false, freeze_reason: null, deleted_at: null },
    wallet: { balance: 1500 },
    emergency_mode: false,
    limits: { per_adjustment: 500000, daily: 2000000 },
    used_today: 250000,
    withdrawals_pending: 0,
    self_adjustment: false,
    notifications: {
      credit: { active: true, title: 'Wallet Credited', body: '₦{amount} has been added to your wallet. {note}' },
      debit: { active: true, title: 'Wallet Debited', body: '₦{amount} has been deducted from your wallet. {note}' },
    },
    adjustments: [],
    partial: {
      config: null, used_today: null, withdrawals_pending: null, self_adjustment: null, notifications: null, adjustments: null,
    },
    ...patch,
  };
}

function contextOf(patch: ApiBody = {}): WalletContext {
  const context = adjust.toWalletContext(contextBody(patch));
  assert.ok(context);
  return context;
}

function form(patch: Partial<AdjustForm> = {}): AdjustForm {
  return { ...adjust.EMPTY_ADJUST_FORM, direction: 'credit', amount: '5000.50', reasonChoice: PRESET, ...patch };
}

function requestBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    direction: 'credit',
    amount: '5000.50',
    reason: PRESET,
    user_note: 'Balance adjustment by CardElite support.',
    reference: 'TICKET-42',
    expected_balance: '1500.00',
    idempotency_key: KEY,
    ...patch,
  };
}

function apiFailure(patch: Partial<ApiFailure>): ApiResult<AdjustReceipt> {
  return {
    ok: false,
    error: {
      kind: 'http',
      status: 409,
      code: 'STATE_CONFLICT',
      message: 'Refused.',
      requestId: 'req_1',
      details: null,
      outcomeUnknown: false,
      ...patch,
    },
  };
}

function receipt(patch: Record<string, unknown> = {}, replayed = false): AdjustReceipt {
  return {
    adjustment: adjust.adjustmentRecord({
      adjustment_id: ADJUSTMENT_ID,
      transaction_id: TRANSACTION_ID,
      user_id: USER_ID,
      direction: 'credit',
      amount: 5000.5,
      balance_before: 1500,
      balance_after: 6500.5,
      account_frozen: false,
      notified: true,
      created_at: STAMP,
      ...patch,
    }),
    replayed,
  };
}

describe('naira amounts', () => {
  test('the shared parser accepts plain, grouped and ₦-prefixed naira and counts exact kobo', () => {
    const cases: Array<[unknown, string, number]> = [
      ['5000', '5000', 500000],
      ['5,000.50', '5000.5', 500050],
      ['₦5000', '5000', 500000],
      ['₦ 1,234,567.89', '1234567.89', 123456789],
      ['0007.05', '7.05', 705],
      ['0.1', '0.1', 10],
      ['9999999999999.99', '9999999999999.99', 999999999999999],
    ];
    for (const [input, value, kobo] of cases) {
      const parsed = parseNaira(input, 9_999_999_999_999.99);
      assert.ok(parsed.ok, String(input));
      assert.equal(parsed.value, value, String(input));
      assert.equal(parsed.kobo, kobo, String(input));
    }
  });

  test('the shared parser refuses anything that is not a plain amount', () => {
    const cases: Array<[unknown, string]> = [
      ['', 'required'], [null, 'required'], ['-1', 'negative'], ['−5', 'negative'], ['1.005', 'decimals'],
      ['1e5', 'invalid'], ['5,00', 'invalid'], ['.5', 'invalid'], ['5.', 'invalid'], ['0x10', 'invalid'], [{}, 'invalid'],
      ['10000000000000', 'too_large'], ['99999999999999999999', 'too_large'],
    ];
    for (const [input, problem] of cases) {
      const parsed = parseNaira(input, 9_999_999_999_999.99);
      assert.deepEqual(parsed, { ok: false, problem }, String(input));
    }
  });

  test('kobo helpers round database numbers exactly and print fixed kobo', () => {
    assert.equal(toKobo(0.3), 30);
    assert.equal(toKobo(1500), 150000);
    assert.equal(toKobo(6500.5), 650050);
    assert.equal(toKobo('1500.00'), 150000);
    assert.equal(toKobo(Number.NaN), null);
    assert.equal(toKobo(null), null);
    assert.equal(koboText(500050), '5000.50');
    assert.equal(koboText(5), '0.05');
    assert.equal(koboText(0), '0.00');
    assert.equal(groupedNairaText(500050), '5,000.50');
    assert.equal(groupedNairaText(500049), '5,000.49');
    assert.equal(groupedNairaText(12345600), '123,456');
    assert.equal(groupedNairaText(40), '0.40');
    assert.equal(groupedNairaText(999999999999999), '9,999,999,999,999.99');
  });
});

describe('the request checker', () => {
  test('accepts a full request and canonicalises the amounts', () => {
    const checked = adjust.checkAdjustRequest(requestBody());
    assert.deepEqual(checked, {
      ok: true,
      value: {
        direction: 'credit',
        amount: '5000.50',
        amount_kobo: 500050,
        reason: PRESET,
        user_note: 'Balance adjustment by CardElite support.',
        reference: 'TICKET-42',
        expected_balance: '1500.00',
        idempotency_key: KEY,
      },
    });
  });

  test('reads grouped and ₦-prefixed amounts as the same strict naira value', () => {
    const grouped = adjust.checkAdjustRequest(requestBody({ amount: '5,000.50' }));
    assert.ok(grouped.ok);
    assert.equal(grouped.value.amount, '5000.50');
    assert.equal(grouped.value.amount_kobo, 500050);
    const signed = adjust.checkAdjustRequest(requestBody({ amount: '₦5000' }));
    assert.ok(signed.ok);
    assert.equal(signed.value.amount, '5000.00');
    const largest = adjust.checkAdjustRequest(requestBody({ amount: '9999999999999.99' }));
    assert.ok(largest.ok);
  });

  test('refuses zero, negative, over-precise, exponent, huge and non-text amounts', () => {
    const messages = adjust.AMOUNT_PROBLEMS;
    const cases: Array<[unknown, string]> = [
      ['0', adjust.REQUEST_MESSAGES.amountZero],
      ['0.00', adjust.REQUEST_MESSAGES.amountZero],
      ['-1', messages.negative],
      ['1.005', messages.decimals],
      ['1e5', messages.invalid],
      ['10000000000000', messages.too_large],
      ['99999999999999999999999', messages.too_large],
      ['', messages.required],
      [undefined, messages.required],
      [null, messages.required],
      [5000, adjust.REQUEST_MESSAGES.amountType],
      [true, adjust.REQUEST_MESSAGES.amountType],
    ];
    for (const [amount, message] of cases) {
      assert.deepEqual(adjust.checkAdjustRequest(requestBody({ amount })), { ok: false, field: 'amount', message }, String(amount));
    }
  });

  test('needs a credit or debit direction', () => {
    for (const direction of [undefined, 'CREDIT', 'refund', 1, null]) {
      assert.deepEqual(
        adjust.checkAdjustRequest(requestBody({ direction })),
        { ok: false, field: 'direction', message: adjust.REQUEST_MESSAGES.direction },
        String(direction),
      );
    }
  });

  test('keeps the reason between 3 and 500 characters, counted as characters, not code units', () => {
    const fail = (reason: unknown) => adjust.checkAdjustRequest(requestBody({ reason }));
    assert.deepEqual(fail(undefined), { ok: false, field: 'reason', message: adjust.REQUEST_MESSAGES.reasonMissing });
    assert.deepEqual(fail('   '), { ok: false, field: 'reason', message: adjust.REQUEST_MESSAGES.reasonMissing });
    assert.deepEqual(fail('ab'), { ok: false, field: 'reason', message: adjust.REQUEST_MESSAGES.reasonShort });
    assert.deepEqual(fail('😀😀'), { ok: false, field: 'reason', message: adjust.REQUEST_MESSAGES.reasonShort });
    assert.equal(fail('abc').ok, true);
    assert.equal(fail('😀'.repeat(500)).ok, true);
    assert.deepEqual(fail('😀'.repeat(501)), { ok: false, field: 'reason', message: adjust.REQUEST_MESSAGES.reasonLong });
    assert.deepEqual(fail('x'.repeat(501)), { ok: false, field: 'reason', message: adjust.REQUEST_MESSAGES.reasonLong });
    assert.deepEqual(fail('bad\u0000text'), { ok: false, field: 'reason', message: adjust.REQUEST_MESSAGES.unsupported });
    const trimmed = fail('  Duplicate credit  ');
    assert.ok(trimmed.ok);
    assert.equal(trimmed.value.reason, 'Duplicate credit');
  });

  test('the message to the user is optional, trimmed and at most 140 characters', () => {
    const read = (user_note: unknown) => adjust.checkAdjustRequest(requestBody({ user_note }));
    for (const blank of [undefined, null, '', '   ']) {
      const checked = read(blank);
      assert.ok(checked.ok, String(blank));
      assert.equal(checked.value.user_note, null);
    }
    assert.equal(read('y'.repeat(140)).ok, true);
    assert.deepEqual(read('y'.repeat(141)), { ok: false, field: 'user_note', message: adjust.REQUEST_MESSAGES.noteLong });
    assert.deepEqual(read(12), { ok: false, field: 'user_note', message: adjust.REQUEST_MESSAGES.noteType });
  });

  test('the reference is optional, trimmed and at most 120 characters', () => {
    const read = (reference: unknown) => adjust.checkAdjustRequest(requestBody({ reference }));
    const blank = read('  ');
    assert.ok(blank.ok);
    assert.equal(blank.value.reference, null);
    assert.equal(read('r'.repeat(120)).ok, true);
    assert.deepEqual(read('r'.repeat(121)), { ok: false, field: 'reference', message: adjust.REQUEST_MESSAGES.referenceLong });
    assert.deepEqual(read({ id: 1 }), { ok: false, field: 'reference', message: adjust.REQUEST_MESSAGES.referenceType });
  });

  test('the expected balance is optional text of a non-negative amount', () => {
    const read = (expected_balance: unknown) => adjust.checkAdjustRequest(requestBody({ expected_balance }));
    for (const blank of [undefined, null, '']) {
      const checked = read(blank);
      assert.ok(checked.ok);
      assert.equal(checked.value.expected_balance, null);
    }
    const zero = read('0');
    assert.ok(zero.ok);
    assert.equal(zero.value.expected_balance, '0.00');
    const grouped = read('1,500.5');
    assert.ok(grouped.ok);
    assert.equal(grouped.value.expected_balance, '1500.50');
    for (const bad of ['-1', 'abc', '1.001']) {
      assert.deepEqual(read(bad), { ok: false, field: 'expected_balance', message: adjust.REQUEST_MESSAGES.balanceInvalid }, bad);
    }
    assert.deepEqual(read(1500), { ok: false, field: 'expected_balance', message: adjust.REQUEST_MESSAGES.balanceType });
  });

  test('the idempotency key must match the database pattern', () => {
    for (const key of [KEY, 'abcdefgh', 'A_b-1234', 'k'.repeat(128)]) {
      assert.equal(adjust.checkAdjustRequest(requestBody({ idempotency_key: key })).ok, true, key);
    }
    for (const key of [undefined, 'short', 'has a space', 'k'.repeat(129), 'semi;colon1', 12345678]) {
      assert.deepEqual(
        adjust.checkAdjustRequest(requestBody({ idempotency_key: key })),
        { ok: false, field: 'idempotency_key', message: adjust.REQUEST_MESSAGES.key },
        String(key),
      );
    }
  });

  test('a body that is not an object is refused before any field', () => {
    for (const body of [null, [], 'credit', 5]) {
      assert.deepEqual(adjust.checkAdjustRequest(body), { ok: false, field: null, message: adjust.REQUEST_MESSAGES.body });
    }
  });
});

describe('reading the database result', () => {
  test('an applied result keeps every field and the replay flag', () => {
    const fresh = adjust.readRpcResult({ applied: true, replayed: false, ...receipt().adjustment });
    assert.deepEqual(fresh, { kind: 'applied', adjustment: receipt().adjustment, replayed: false });
    const replay = adjust.readRpcResult({ applied: true, replayed: true, ...receipt().adjustment });
    assert.equal(replay.kind === 'applied' && replay.replayed, true);
  });

  test('a refusal keeps its reason and the numbers that explain it', () => {
    assert.deepEqual(adjust.readRpcResult({ applied: false, reason: 'over_daily_limit', limit: 2000000, used_today: 1900000 }), {
      kind: 'refused',
      refusal: { reason: 'over_daily_limit', balance: null, limit: 2000000, used_today: 1900000 },
    });
    assert.deepEqual(adjust.readRpcResult({ applied: false }), {
      kind: 'refused',
      refusal: { reason: 'unknown', balance: null, limit: null, used_today: null },
    });
  });

  test('anything else cannot be read', () => {
    for (const data of [null, 'ok', [], {}, { applied: 'true' }, { applied: 1 }]) {
      assert.deepEqual(adjust.readRpcResult(data), { kind: 'unreadable' }, JSON.stringify(data));
    }
  });
});

describe('route failure mapping', () => {
  const attempt = { amount_kobo: 500050 };

  test('every refusal reason maps to its code, status and details', () => {
    const cases: Array<[Record<string, unknown>, string, Record<string, unknown>]> = [
      [{ reason: 'user_not_found' }, 'RESOURCE_NOT_FOUND', { reason: 'user_not_found' }],
      [{ reason: 'wallet_not_found' }, 'RESOURCE_NOT_FOUND', { reason: 'wallet_not_found' }],
      [{ reason: 'account_deleted' }, 'STATE_CONFLICT', { reason: 'account_deleted' }],
      [{ reason: 'emergency_mode' }, 'STATE_CONFLICT', { reason: 'emergency_mode' }],
      [{ reason: 'self_adjustment' }, 'STATE_CONFLICT', { reason: 'self_adjustment' }],
      [{ reason: 'insufficient_balance', balance: 1200 }, 'STATE_CONFLICT', { reason: 'insufficient_balance', balance: 1200 }],
      [{ reason: 'balance_changed', balance: 1800 }, 'STATE_CONFLICT', { reason: 'balance_changed', balance: 1800 }],
      [{ reason: 'over_limit', limit: 500000 }, 'VALIDATION_ERROR', { reason: 'over_limit', limit: 500000 }],
      [
        { reason: 'over_daily_limit', limit: 2000000, used_today: 1900000 },
        'VALIDATION_ERROR',
        { reason: 'over_daily_limit', limit: 2000000, used_today: 1900000 },
      ],
      [{ reason: 'idempotency_mismatch' }, 'IDEMPOTENCY_CONFLICT', { reason: 'idempotency_mismatch' }],
      [{ reason: 'something_new' }, 'STATE_CONFLICT', { reason: 'something_new' }],
    ];
    const statuses: Record<string, number> = {
      RESOURCE_NOT_FOUND: 404, STATE_CONFLICT: 409, VALIDATION_ERROR: 400, IDEMPOTENCY_CONFLICT: 409,
    };
    for (const [data, code, details] of cases) {
      const outcome = adjust.readRpcResult({ applied: false, ...data });
      assert.equal(outcome.kind, 'refused');
      if (outcome.kind !== 'refused') continue;
      const failure = adjust.refusalFailure(outcome.refusal, attempt);
      assert.equal(failure.code, code, String(data.reason));
      assert.equal(ERROR_STATUS[failure.code], statuses[code], String(data.reason));
      assert.deepEqual(failure.details, details, String(data.reason));
      assert.match(failure.message, /[Nn]othing was changed/, String(data.reason));
    }
  });

  test('the messages name the amounts in plain words', () => {
    const refusal = (reason: string, extra: Partial<Record<'balance' | 'limit' | 'used_today', number>> = {}): Refusal => ({
      reason,
      balance: extra.balance ?? null,
      limit: extra.limit ?? null,
      used_today: extra.used_today ?? null,
    });
    assert.equal(
      adjust.refusalFailure(refusal('insufficient_balance', { balance: 1200 }), attempt).message,
      'The wallet holds ₦1,200.00, so it cannot be debited ₦5,000.50. A wallet can never go below zero. Nothing was changed.',
    );
    assert.equal(
      adjust.refusalFailure(refusal('balance_changed', { balance: 1800 }), attempt).message,
      'The balance changed to ₦1,800.00 after you opened this panel, so nothing was changed. Check the new balance and submit again.',
    );
    assert.equal(
      adjust.refusalFailure(refusal('over_limit', { limit: 500000 }), attempt).message,
      '₦5,000.50 is more than the ₦500,000.00 limit for one adjustment, so nothing was changed.',
    );
    assert.equal(
      adjust.refusalFailure(refusal('over_daily_limit', { limit: 2000000, used_today: 1999000 }), attempt).message,
      'This would take you past your daily adjustment limit of ₦2,000,000.00. You have adjusted ₦1,999,000.00 today, so ₦1,000.00 is left. Nothing was changed.',
    );
    assert.equal(
      adjust.refusalFailure(refusal('emergency_mode'), attempt).message,
      'Emergency mode is on, so wallets cannot be credited. Debits are still allowed. Nothing was changed.',
    );
  });

  test('raised errors: not authorized is the deactivated-admin response, invalid input a validation error', () => {
    assert.deepEqual(adjust.rpcErrorFailure({ code: 'P0001', message: 'Not authorized' }), {
      code: 'AUTH_REQUIRED', message: 'Your session has expired. Sign in again.', details: null,
    });
    assert.deepEqual(adjust.rpcErrorFailure({ code: 'P0001', message: 'Invalid adjustment' }), {
      code: 'VALIDATION_ERROR', message: adjust.INVALID_ADJUSTMENT_MESSAGE, details: null,
    });
  });

  test('any other database error rolled back, so it says nothing was changed', () => {
    for (const error of [
      { code: '40P01', message: 'deadlock detected' },
      { code: '57014', message: 'canceling statement due to statement timeout' },
      { code: 'PGRST202', message: 'Could not find the function public.admin_adjust_wallet' },
      { code: '23505', message: 'duplicate key value violates unique constraint' },
    ]) {
      assert.deepEqual(adjust.rpcErrorFailure(error), {
        code: 'INTERNAL_ERROR', message: adjust.NOT_APPLIED_MESSAGE, details: null,
      }, error.code);
    }
  });

  test('a transport failure is an unknown outcome, never "nothing was changed"', () => {
    for (const error of [
      { code: '', message: 'TypeError: fetch failed' },
      { message: 'Bad gateway' },
      { code: '20', message: 'AbortError: This operation was aborted' },
      { code: 'ECONNRESET', message: 'socket hang up' },
      { code: 'PGRST001', message: 'Database client error. Retrying the connection.' },
      null,
    ]) {
      const failure = adjust.rpcErrorFailure(error);
      assert.equal(failure.code, 'INTERNAL_ERROR', JSON.stringify(error));
      assert.deepEqual(failure.details, { outcome_unknown: true }, JSON.stringify(error));
      assert.doesNotMatch(failure.message, /nothing was changed/i);
      assert.match(failure.message, /may or may not have been applied/);
    }
  });
});

describe('outcome classification', () => {
  test('a success is applied and keeps the replay flag', () => {
    const ok: ApiResult<AdjustReceipt> = { ok: true, data: receipt({}, true), status: 200, requestId: 'req_ok' };
    assert.deepEqual(adjust.classifyAdjust(ok), { kind: 'applied', receipt: receipt({}, true) });
  });

  test('no answer, an unreadable answer or a server that says it could not confirm are unknown', () => {
    const unknowns = [
      apiFailure({ kind: 'network', status: null, code: null, outcomeUnknown: true }),
      apiFailure({ kind: 'timeout', status: null, code: null, outcomeUnknown: true }),
      apiFailure({ kind: 'parse', status: 200, code: null, outcomeUnknown: true }),
      apiFailure({ status: 502, code: null, outcomeUnknown: true }),
      apiFailure({ status: 500, code: 'INTERNAL_ERROR', details: { outcome_unknown: true } }),
    ];
    for (const result of unknowns) {
      assert.deepEqual(adjust.classifyAdjust(result), { kind: 'unknown', message: adjust.OUTCOME_UNKNOWN_MESSAGE });
    }
  });

  test('refusals carry the reason and the balance the database reported', () => {
    assert.deepEqual(
      adjust.classifyAdjust(apiFailure({ status: 409, message: 'Changed.', details: { reason: 'balance_changed', balance: 1800 } })),
      { kind: 'refused', status: 409, code: 'STATE_CONFLICT', message: 'Changed.', reason: 'balance_changed', balance: 1800 },
    );
    const limit = adjust.classifyAdjust(apiFailure({ status: 400, code: 'VALIDATION_ERROR', details: { reason: 'over_limit', limit: 500000 } }));
    assert.equal(limit.kind === 'refused' && limit.reason, 'over_limit');
    const field = adjust.classifyAdjust(apiFailure({ status: 400, code: 'VALIDATION_ERROR', details: { field: 'amount' } }));
    assert.equal(field.kind === 'refused' && field.reason, null);
    for (const status of [403, 404]) {
      assert.equal(adjust.classifyAdjust(apiFailure({ status })).kind, 'refused', String(status));
    }
  });

  test('an expired session is left to the session dialog; definite failures can be retried with the same request', () => {
    assert.deepEqual(adjust.classifyAdjust(apiFailure({ status: 401, code: 'AUTH_REQUIRED' })), { kind: 'expired' });
    assert.deepEqual(
      adjust.classifyAdjust(apiFailure({ status: 500, code: 'INTERNAL_ERROR', message: adjust.NOT_APPLIED_MESSAGE })),
      { kind: 'retry', message: adjust.NOT_APPLIED_MESSAGE },
    );
    assert.equal(adjust.classifyAdjust(apiFailure({ status: 429, code: 'RATE_LIMITED' })).kind, 'retry');
    assert.equal(adjust.classifyAdjust(apiFailure({ kind: 'parse', status: null, code: null, outcomeUnknown: false })).kind, 'retry');
  });

  test('the receipt reader needs the adjustment and the replay flag', () => {
    assert.equal(adjust.toAdjustReceipt({ adjustment: receipt().adjustment }), null);
    assert.equal(adjust.toAdjustReceipt({ replayed: false }), null);
    assert.deepEqual(adjust.toAdjustReceipt({ adjustment: { ...receipt().adjustment }, replayed: false }), receipt());
  });
});

describe('one key for one request', () => {
  const payload = (patch: Partial<AdjustPayload> = {}): AdjustPayload => ({
    direction: 'credit',
    amount: '5000.50',
    reason: PRESET,
    user_note: 'Balance adjustment by CardElite support.',
    reference: null,
    expected_balance: '1500.00',
    ...patch,
  });

  function minter(): () => string {
    let next = 1;
    return () => `key-${String(next++).padStart(4, '0')}`;
  }

  type Refused = Extract<AdjustOutcome, { kind: 'refused' }>;
  const unknown: AdjustOutcome = { kind: 'unknown', message: 'lost' };
  const definiteRefusal: Refused = {
    kind: 'refused', status: 409, code: 'STATE_CONFLICT', message: 'x', reason: 'balance_changed', balance: 1800,
  };
  const routeRefusal: Refused = {
    kind: 'refused', status: 400, code: 'VALIDATION_ERROR', message: 'x', reason: null, balance: null,
  };

  test('the session key is bound to the first request and reused only for the identical request', () => {
    const mint = minter();
    const start = adjust.newAttempt('session-key');
    const first = adjust.prepareAttempt(start, payload(), mint);
    assert.ok(first);
    assert.equal(first.body.idempotency_key, 'session-key');
    const again = adjust.prepareAttempt(first.state, payload(), mint);
    assert.ok(again);
    assert.deepEqual(again.body, first.body);
    const changed = adjust.prepareAttempt(first.state, payload({ amount: '6000.00' }), mint);
    assert.ok(changed);
    assert.equal(changed.body.idempotency_key, 'key-0001');
    assert.notEqual(changed.body.idempotency_key, first.body.idempotency_key);
  });

  test('an unknown outcome locks the request: retry resends the identical body and nothing else can be sent', () => {
    const mint = minter();
    const first = adjust.prepareAttempt(adjust.newAttempt('session-key'), payload(), mint);
    assert.ok(first);
    const locked = adjust.settleAttempt(first.state, unknown, mint);
    assert.equal(locked.locked, true);
    assert.deepEqual(adjust.retryBody(locked), first.body);
    assert.equal(adjust.prepareAttempt(locked, payload({ amount: '1.00' }), mint), null);
    assert.equal(adjust.prepareAttempt(locked, payload({ expected_balance: '6500.50' }), mint), null);
    const same = adjust.prepareAttempt(locked, payload(), mint);
    assert.ok(same);
    assert.deepEqual(same.body, first.body);
  });

  test('only a refusal from the database itself releases the lock; route refusals and retries do not', () => {
    const mint = minter();
    const first = adjust.prepareAttempt(adjust.newAttempt('session-key'), payload(), mint);
    assert.ok(first);
    const locked = adjust.settleAttempt(first.state, unknown, mint);
    assert.equal(adjust.settleAttempt(locked, routeRefusal, mint).locked, true);
    assert.equal(adjust.settleAttempt(locked, { kind: 'retry', message: 'x' }, mint).locked, true);
    assert.equal(adjust.settleAttempt(locked, { kind: 'expired' }, mint).locked, true);
    const released = adjust.settleAttempt(locked, definiteRefusal, mint);
    assert.equal(released.locked, false);
    assert.equal(released.key, 'session-key');
    const next = adjust.prepareAttempt(released, payload({ expected_balance: '1800.00' }), mint);
    assert.ok(next);
    assert.equal(next.body.idempotency_key, 'key-0001');
  });

  test('a key mismatch reported by the database starts a fresh key', () => {
    const mint = minter();
    const first = adjust.prepareAttempt(adjust.newAttempt('session-key'), payload(), mint);
    assert.ok(first);
    const mismatch: Refused = { ...definiteRefusal, reason: 'idempotency_mismatch', code: 'IDEMPOTENCY_CONFLICT' };
    const fresh = adjust.settleAttempt(first.state, mismatch, mint);
    assert.deepEqual(fresh, { key: 'key-0001', payload: null, locked: false });
  });

  test('across any sequence a key never carries two different requests', () => {
    const mint = minter();
    const seen = new Map<string, string>();
    let state: AttemptState = adjust.newAttempt('session-key');
    const steps: Array<[AdjustPayload, AdjustOutcome]> = [
      [payload(), routeRefusal],
      [payload({ amount: '7000.00' }), unknown],
      [payload({ amount: '7000.00' }), { kind: 'retry', message: 'x' }],
      [payload({ amount: '7000.00' }), definiteRefusal],
      [payload({ amount: '7000.00', expected_balance: '1800.00' }), unknown],
      [payload({ amount: '1.00' }), unknown],
    ];
    for (const [request, outcome] of steps) {
      const prepared = adjust.prepareAttempt(state, request, mint);
      if (!prepared) continue;
      const fingerprint = JSON.stringify({ ...prepared.body, idempotency_key: undefined });
      const previous = seen.get(prepared.body.idempotency_key);
      assert.ok(previous === undefined || previous === fingerprint, `key ${prepared.body.idempotency_key} reused for a different request`);
      seen.set(prepared.body.idempotency_key, fingerprint);
      state = adjust.settleAttempt(prepared.state, outcome, mint);
    }
    assert.equal(state.locked, true);
    assert.equal(state.payload?.amount, '7000.00');
  });

  test('keys are random, unique and match the database pattern', () => {
    const keys = new Set(Array.from({ length: 50 }, () => adjust.mintAdjustKey()));
    assert.equal(keys.size, 50);
    for (const key of keys) assert.match(key, adjust.KEY_PATTERN);
  });
});

describe('the form checker and the kobo preview', () => {
  test('a complete form gives the values and an exact preview', () => {
    const check = adjust.checkAdjustForm(form(), contextOf());
    assert.deepEqual(check.values, {
      direction: 'credit', amountKobo: 500050, reason: PRESET, reference: null, note: adjust.DEFAULT_NOTE,
    });
    assert.deepEqual(check.preview, { beforeKobo: 150000, afterKobo: 650050, changeKobo: 500050, negative: false });
    assert.deepEqual(check.errors, {});
    assert.equal(check.blocked, null);
  });

  test('the preview works in whole kobo, so decimal noise never appears', () => {
    const tiny = contextOf({ wallet: { balance: 0.3 } });
    const credit = adjust.checkAdjustForm(form({ amount: '0.1' }), tiny);
    assert.equal(credit.preview?.afterKobo, 40);
    const exact = adjust.checkAdjustForm(form({ direction: 'debit', amount: '0.30' }), tiny);
    assert.deepEqual(exact.preview, { beforeKobo: 30, afterKobo: 0, changeKobo: -30, negative: false });
    assert.ok(exact.values);
    const over = adjust.checkAdjustForm(form({ direction: 'debit', amount: '0.31' }), tiny);
    assert.equal(over.preview?.negative, true);
    assert.equal(over.values, null);
    assert.equal(over.errors.amount, 'The wallet holds ₦0.30, so you can debit at most that. A wallet can never go below zero.');
    assert.deepEqual(adjust.previewBalance(999999999999998, 'credit', 1), {
      beforeKobo: 999999999999998, afterKobo: 999999999999999, changeKobo: 1, negative: false,
    });
  });

  test('the reason gates the request: none chosen, Other left empty, too short or too long', () => {
    const context = contextOf();
    const none = adjust.checkAdjustForm(form({ reasonChoice: '' }), context);
    assert.equal(none.values, null);
    assert.equal(none.errors.reason, adjust.FORM_MESSAGES.reasonChoose);
    const empty = adjust.checkAdjustForm(form({ reasonChoice: adjust.OTHER_CHOICE, reasonText: '   ' }), context);
    assert.equal(empty.errors.reason, adjust.FORM_MESSAGES.reasonWrite);
    const short = adjust.checkAdjustForm(form({ reasonChoice: adjust.OTHER_CHOICE, reasonText: 'no' }), context);
    assert.equal(short.errors.reason, adjust.FORM_MESSAGES.reasonShort);
    const long = adjust.checkAdjustForm(form({ reasonChoice: adjust.OTHER_CHOICE, reasonText: 'r'.repeat(501) }), context);
    assert.equal(long.errors.reason, adjust.FORM_MESSAGES.reasonLong);
    const written = adjust.checkAdjustForm(form({ reasonChoice: adjust.OTHER_CHOICE, reasonText: ' Goodwill for a delay ' }), context);
    assert.equal(written.values?.reason, 'Goodwill for a delay');
    assert.equal(adjust.firstProblem(none.errors), 'reason');
  });

  test('direction, limits and the message are checked before anything is sent', () => {
    const context = contextOf();
    assert.equal(adjust.checkAdjustForm(form({ direction: null }), context).errors.direction, adjust.FORM_MESSAGES.direction);
    assert.equal(
      adjust.checkAdjustForm(form({ amount: '500000.01' }), context).errors.amount,
      'One adjustment can be at most ₦500,000.00.',
    );
    assert.equal(
      adjust.checkAdjustForm(form({ amount: '200000.01' }), contextOf({ used_today: 1800000 })).errors.amount,
      'You have ₦200,000.00 left of your ₦2,000,000.00 daily limit.',
    );
    assert.equal(
      adjust.checkAdjustForm(form({ amount: '1' }), contextOf({ used_today: 2000000 })).errors.amount,
      'You have used all of your ₦2,000,000.00 daily limit. It resets at midnight (WAT).',
    );
    assert.equal(
      adjust.checkAdjustForm(form({ amount: '200000' }), contextOf({ used_today: 1800000 })).errors.amount,
      undefined,
    );
    for (const limits of [{ per_adjustment: 0, daily: 2000000 }, { per_adjustment: 500000, daily: 0 }]) {
      assert.equal(
        adjust.checkAdjustForm(form({ amount: '1' }), contextOf({ limits })).errors.amount,
        'Wallet adjustments are switched off: a limit is set to ₦0.00 in Platform Settings, under Limits & Fees.',
      );
    }
    assert.equal(adjust.checkAdjustForm(form({ amount: '0' }), context).errors.amount, adjust.FORM_MESSAGES.amountZero);
    assert.equal(adjust.checkAdjustForm(form({ amount: '5,000.505' }), context).errors.amount, adjust.AMOUNT_PROBLEMS.decimals);
    assert.equal(
      adjust.checkAdjustForm(form({ noteChoice: adjust.OTHER_CHOICE, noteText: ' ' }), context).errors.note,
      adjust.FORM_MESSAGES.noteWrite,
    );
    assert.equal(
      adjust.checkAdjustForm(form({ noteChoice: adjust.OTHER_CHOICE, noteText: 'n'.repeat(141) }), context).errors.note,
      adjust.FORM_MESSAGES.noteLong,
    );
    assert.equal(adjust.checkAdjustForm(form({ reference: 'r'.repeat(121) }), context).errors.reference, adjust.FORM_MESSAGES.referenceLong);
    const limitsUnknown = adjust.checkAdjustForm(form({ amount: '900000' }), contextOf({ limits: null }));
    assert.equal(limitsUnknown.errors.amount, undefined);
  });

  test('emergency mode refuses credits but not debits', () => {
    const emergency = contextOf({ emergency_mode: true });
    assert.equal(adjust.checkAdjustForm(form(), emergency).errors.direction, adjust.FORM_MESSAGES.emergencyCredit);
    assert.ok(adjust.checkAdjustForm(form({ direction: 'debit', amount: '100' }), emergency).values);
  });

  test('deleted accounts, missing wallets and the admin’s own account block the request', () => {
    const cases: Array<[ApiBody, string]> = [
      [{ user: { ...(contextBody().user as Record<string, unknown>), deleted_at: STAMP } }, adjust.FORM_MESSAGES.deleted],
      [{ wallet: null }, adjust.FORM_MESSAGES.noWallet],
      [{ self_adjustment: true }, adjust.FORM_MESSAGES.self],
    ];
    for (const [patch, message] of cases) {
      const check = adjust.checkAdjustForm(form(), contextOf(patch));
      assert.equal(check.blocked, message);
      assert.equal(check.values, null);
    }
    assert.equal(adjust.checkAdjustForm(form(), null).blocked, adjust.FORM_MESSAGES.notLoaded);
  });

  test('a frozen account is allowed', () => {
    const frozen = contextOf({ user: { ...(contextBody().user as Record<string, unknown>), is_frozen: true, freeze_reason: 'Review' } });
    assert.ok(adjust.checkAdjustForm(form(), frozen).values);
  });

  test('changing direction keeps a shared message and resets one that only fits the other direction', () => {
    const refund = { ...form(), noteChoice: 'Refund from CardElite support.' };
    assert.equal(adjust.withDirection(refund, 'debit').noteChoice, adjust.DEFAULT_NOTE);
    const shared = { ...form(), noteChoice: 'Correction to an earlier transaction.' };
    assert.equal(adjust.withDirection(shared, 'debit').noteChoice, 'Correction to an earlier transaction.');
    const custom = { ...form(), noteChoice: adjust.OTHER_CHOICE, noteText: 'Hi' };
    assert.equal(adjust.withDirection(custom, 'debit').noteChoice, adjust.OTHER_CHOICE);
    assert.equal(adjust.isFormDirty({ ...adjust.EMPTY_ADJUST_FORM }), false);
    assert.equal(adjust.isFormDirty(form()), true);
  });

  test('the request body is built from kobo, with the balance the admin saw', () => {
    const check = adjust.checkAdjustForm(form({ reference: ' T-1 ' }), contextOf());
    assert.ok(check.values);
    assert.deepEqual(adjust.adjustPayload(check.values, 150000), {
      direction: 'credit',
      amount: '5000.50',
      reason: PRESET,
      user_note: adjust.DEFAULT_NOTE,
      reference: 'T-1',
      expected_balance: '1500.00',
    });
  });
});

describe('the wallet context', () => {
  test('reads the panel payload, in kobo', () => {
    const context = adjust.toWalletContext(contextBody({
      wallet: { balance: 1500.5 },
      used_today: 0.3,
      withdrawals_pending: 2,
      adjustments: [{
        id: ADJUSTMENT_ID, direction: 'debit', amount: 200, balance_before: 1700.5, balance_after: 1500.5, reason: 'Duplicate credit',
        user_note: 'Reversal of an amount credited in error.', reference: null, admin_id: ADMIN_ID, admin_username: 'owner',
        account_frozen: false, notified: true, transaction_id: TRANSACTION_ID, created_at: STAMP,
      }, { id: 'broken' }],
      partial: { config: null, adjustments: 'Recent adjustments could not be loaded.' },
    }));
    assert.ok(context);
    assert.equal(context.balanceKobo, 150050);
    assert.equal(context.usedTodayKobo, 30);
    assert.deepEqual(context.limits, { perAdjustmentKobo: 50000000, dailyKobo: 200000000 });
    assert.equal(context.withdrawalsPending, 2);
    assert.equal(context.history?.length, 1);
    assert.equal(context.history?.[0].amountKobo, 20000);
    assert.equal(context.history?.[0].adminUsername, 'owner');
    assert.deepEqual(context.partial, ['Recent adjustments could not be loaded.']);
    assert.deepEqual(adjust.allowanceOf(context), {
      perAdjustmentKobo: 50000000, dailyKobo: 200000000, usedTodayKobo: 30, leftTodayKobo: 199999970,
    });
  });

  test('a payload without a real user id is unreadable; missing parts read as unknown', () => {
    assert.equal(adjust.toWalletContext(contextBody({ user: { id: 'nope' } })), null);
    const sparse = adjust.toWalletContext({ user: { id: USER_ID } });
    assert.ok(sparse);
    assert.equal(sparse.balanceKobo, null);
    assert.equal(sparse.limits, null);
    assert.equal(sparse.emergencyMode, null);
    assert.equal(sparse.templates, null);
    assert.equal(sparse.history, null);
  });

  test('config values parse safely and fall back to the defaults', () => {
    assert.equal(adjust.readCap('750000', 500000), 750000);
    assert.equal(adjust.readCap(' 750000 ', 500000), 750000);
    assert.equal(adjust.readCap('0', 500000), 0);
    assert.equal(adjust.readCap('500000.50', 500000), 500000.5);
    for (const raw of [undefined, null, '', ' ', 'abc', '-5', '+5', '1e5', '5,000', '.5', '5.', '1'.repeat(256), `1.${'0'.repeat(256)}`, 5000]) {
      assert.equal(adjust.readCap(raw, 500000), 500000, String(raw));
    }
  });

  test('emails match case-insensitively, and an empty email never matches', () => {
    assert.equal(adjust.sameEmail(' Ada@Example.com ', 'ada@example.com'), true);
    assert.equal(adjust.sameEmail('ada@example.com', 'tolu@example.com'), false);
    assert.equal(adjust.sameEmail('', ''), false);
    assert.equal(adjust.sameEmail(null, null), false);
  });
});

describe('what the user sees', () => {
  test('the notification fills the template like the database does, keeping kobo only when there is some', () => {
    const context = contextOf();
    assert.deepEqual(adjust.renderNotice(context.templates!.credit, 500050, 'Thanks.'), {
      title: 'Wallet Credited',
      body: '₦5,000.50 has been added to your wallet. Thanks.',
    });
    assert.deepEqual(adjust.renderNotice(context.templates!.debit, 2500000, adjust.DEFAULT_NOTE), {
      title: 'Wallet Debited',
      body: '₦25,000 has been deducted from your wallet. Balance adjustment by CardElite support.',
    });
    assert.equal(adjust.renderNotice({ active: false, title: 'Wallet Credited', body: 'x' }, 100, 'n'), null);
    assert.equal(adjust.notificationAmount(500049), '5,000.49');
    assert.equal(adjust.notificationAmount(50000000), '500,000');
  });

  test('success notices say what moved, flag a replay and warn when the user was not notified', () => {
    assert.deepEqual(adjust.appliedNotices(receipt(), { direction: 'credit', amountKobo: 500050 }, '@ada'), [
      { text: 'Credited ₦5,000.50 to @ada. The balance is now ₦6,500.50.', tone: 'success' },
    ]);
    assert.deepEqual(adjust.appliedNotices(receipt({ direction: 'debit', amount: 200, balance_after: 1300 }), {
      direction: 'debit', amountKobo: 20000,
    }, '@ada')[0], { text: 'Debited ₦200.00 from @ada. The balance is now ₦1,300.00.', tone: 'success' });
    const replay = adjust.appliedNotices(receipt({ notified: false }, true), { direction: 'credit', amountKobo: 500050 }, '@ada');
    assert.equal(replay[0].text, 'This adjustment had already been applied, so it was not applied again. The balance is now ₦6,500.50.');
    assert.deepEqual(replay[1], {
      text: 'The user was not notified, because the Wallet Credited notification is switched off in Notification templates.',
      tone: 'warning',
    });
  });
});

describe('the financial confirmation', () => {
  function options(patch: { form?: Partial<AdjustForm>; context?: ApiBody; seen?: number | null } = {}): ConfirmOptions {
    const context = contextOf(patch.context);
    const check = adjust.checkAdjustForm(form(patch.form), context);
    assert.ok(check.values && check.preview);
    return adjust.adjustConfirmOptions({
      user: USER,
      values: check.values,
      preview: check.preview,
      context,
      seenBalanceKobo: patch.seen === undefined ? 150000 : patch.seen,
    });
  }

  function detail(confirm: ConfirmOptions, label: string): unknown {
    return confirm.details?.find((entry) => entry.label === label)?.value;
  }

  test('lists the user, direction, amount, balances, message and notification', () => {
    const confirm = options({ form: { reference: 'TICKET-42' } });
    assert.equal(confirm.tone, 'financial');
    assert.equal(confirm.title, 'Credit ₦5,000.50 to @ada?');
    assert.equal(detail(confirm, 'User'), 'Ada Obi (@ada)');
    assert.equal(detail(confirm, 'User ID'), USER_ID);
    assert.equal(detail(confirm, 'Direction'), 'Credit: money into the wallet');
    assert.equal(detail(confirm, 'Amount'), '₦5,000.50');
    assert.equal(detail(confirm, 'Balance before'), '₦1,500.00');
    assert.equal(detail(confirm, 'Balance after'), '₦6,500.50');
    assert.equal(detail(confirm, 'Message to the user'), adjust.DEFAULT_NOTE);
    assert.equal(detail(confirm, 'Notification'), 'Push and in-app');
    assert.equal(detail(confirm, 'Reason (internal)'), PRESET);
    assert.equal(detail(confirm, 'Reference (internal)'), 'TICKET-42');
    assert.equal(confirm.acknowledge, 'I have checked that ₦5,000.50 should be credited to @ada.');
    assert.equal(confirm.confirmLabel, 'Credit ₦5,000.50');
  });

  test('says it applies at once and that mistakes are fixed with an opposite adjustment', () => {
    const [first, second] = options().consequences ?? [];
    assert.equal(first, 'It applies as soon as you confirm and cannot be edited or undone. A mistake is fixed with an opposite adjustment.');
    assert.match(second, /notified by push and in the app/);
    assert.match(second, /reason and the reference stay internal/);
  });

  test('asks for the amount to be typed from ₦100,000', () => {
    assert.equal(options({ form: { amount: '99999.99' } }).requireTyped, undefined);
    assert.equal(options({ form: { amount: '100000' } }).requireTyped, '100000');
    assert.equal(options({ form: { amount: '150,000.50' } }).requireTyped, '150000.50');
  });

  test('a debit, a frozen account, a deletion, a switched-off template and a moved balance are all spelled out', () => {
    const debit = options({ form: { direction: 'debit', amount: '200' } });
    assert.equal(debit.title, 'Debit ₦200.00 from @ada?');
    assert.equal(detail(debit, 'Balance after'), '₦1,300.00');
    const user = contextBody().user as Record<string, unknown>;
    const frozen = options({ context: { user: { ...user, is_frozen: true, freeze_reason: 'Review' } } }).consequences ?? [];
    assert.ok(frozen.includes('The account is frozen. The adjustment still applies, and it is recorded as made while frozen.'));
    const deleting = options({ context: { user: { ...user, is_frozen: true, freeze_reason: 'Account deletion in progress' } } });
    assert.ok((deleting.consequences ?? []).some((line) => /stops the deletion/.test(line)));
    const silent = options({
      context: {
        notifications: {
          credit: { active: false, title: 'Wallet Credited', body: 'x' },
          debit: { active: true, title: 'Wallet Debited', body: 'y' },
        },
      },
    });
    assert.equal(detail(silent, 'Notification'), 'Not sent: the template is switched off');
    assert.ok((silent.consequences ?? []).some((line) => line.startsWith('The user is not notified')));
    const moved = options({ seen: 120000 }).consequences ?? [];
    assert.ok(moved.includes('The balance changed from ₦1,200.00 to ₦1,500.00 while the panel was open. The figures above use the current balance.'));
  });

  test('renders every detail, the acknowledgement and the typed amount in the dialog', () => {
    const html = render(createElement(confirmUi.ConfirmDialog, {
      session: { id: 1, options: options({ form: { amount: '150000' } }), phase: 'idle', error: null },
      onSubmit: () => {},
      onCancel: () => {},
    }));
    const text = textOf(html);
    for (const expected of [
      'Credit ₦150,000.00 to @ada?', 'Balance before', '₦1,500.00', 'Balance after', '₦151,500.00', 'Message to the user',
      'Push and in-app', 'A mistake is fixed with an opposite adjustment.', 'I have checked that ₦150,000.00 should be credited to @ada.',
      'Type 150000 to continue',
    ]) {
      assert.ok(text.includes(expected), expected);
    }
    assert.ok(tagsOf(html, 'button').some((attrs) => 'disabled' in attrs), 'confirm starts disabled until acknowledged and typed');
  });
});

describe('panel rendering', () => {
  function withPermissions(permissions: string[], isSuperAdmin: boolean, child: ReturnType<typeof createElement>): string {
    return render(createElement(perms.PermissionsProvider, { permissions, isSuperAdmin }, child));
  }

  function button(user: UserProfile, permissions: string[], isSuperAdmin = false): string {
    return withPermissions(permissions, isSuperAdmin, createElement(parts.AdjustWalletButton, { user, onOpen: () => {} }));
  }

  test('the Adjust wallet button needs users.read and wallets.adjust and an account that is not deleted', () => {
    assert.match(textOf(button(USER, ['users.read', 'wallets.adjust'])), /Adjust wallet/);
    assert.match(textOf(button(USER, [], true)), /Adjust wallet/);
    assert.match(textOf(button({ ...USER, is_frozen: true, freeze_reason: 'Review' }, ['users.read', 'wallets.adjust'])), /Adjust wallet/);
    assert.equal(button(USER, ['users.read']), '');
    assert.equal(button(USER, ['wallets.adjust']), '');
    assert.equal(button(USER, ['users.read', 'wallets.approve_adjustment']), '');
    assert.equal(button({ ...USER, deleted_at: STAMP }, [], true), '');
  });

  test('the loading header keeps a place for the button only for admins who can adjust', () => {
    const skeleton = (permissions: string[], isSuperAdmin = false) => withPermissions(
      permissions, isSuperAdmin, createElement(parts.UserDetailSkeleton),
    );
    assert.equal(withClass(skeleton(['users.read']), 'div', 'pageHeaderAction').length, 1);
    assert.equal(withClass(skeleton(['users.read', 'wallets.adjust']), 'div', 'pageHeaderAction').length, 2);
    assert.equal(withClass(skeleton(['users.read', 'users.freeze']), 'div', 'pageHeaderAction').length, 2);
    assert.equal(withClass(skeleton([], true), 'div', 'pageHeaderAction').length, 3);
  });

  test('notices: deletion in progress is stronger than a plain freeze, and each risk has its own line', () => {
    const user = contextBody().user as Record<string, unknown>;
    const notices = (patch: ApiBody) => textOf(render(createElement(panel.AdjustNotices, { context: contextOf(patch) })));
    const deleting = notices({ user: { ...user, is_frozen: true, freeze_reason: 'Account deletion in progress' } });
    assert.match(deleting, /The user is deleting this account/);
    assert.match(deleting, /A credit leaves money in the wallet, which stops the deletion/);
    assert.doesNotMatch(deleting, /Account frozen/);
    const frozen = notices({ user: { ...user, is_frozen: true, freeze_reason: 'Unusual activity' } });
    assert.match(frozen, /Account frozen/);
    assert.match(frozen, /Frozen because: Unusual activity/);
    assert.match(frozen, /recorded as made while frozen/);
    assert.match(notices({ emergency_mode: true }), /Credits are refused until emergency mode is turned off\. Debits are still allowed\./);
    assert.match(notices({ withdrawals_pending: 2 }), /2 withdrawals are waiting for review/);
    assert.match(notices({ self_adjustment: true }), /This is your own account/);
    assert.match(notices({ wallet: null }), /This user has no wallet/);
    assert.match(notices({ user: { ...user, deleted_at: STAMP } }), /Deletion in progress/);
    assert.match(notices({ partial: { used_today: 'Your adjustments today could not be totalled.' } }), /could not be totalled/);
    assert.equal(notices({}), '');
  });

  test('the balance preview shows before and after, and refuses a negative result', () => {
    const shown = textOf(render(createElement(panel.BalancePreviewLine, {
      preview: { beforeKobo: 150000, afterKobo: 650050, changeKobo: 500050, negative: false },
    })));
    assert.match(shown, /Balance after ₦1,500\.00 ₦6,500\.50/);
    const negative = render(createElement(panel.BalancePreviewLine, {
      preview: { beforeKobo: 150000, afterKobo: -1, changeKobo: -150001, negative: true },
    }));
    assert.match(textOf(negative), /Below ₦0\.00, so it is refused/);
    assert.equal(withClass(negative, 'div', 'previewNegative').length, 1);
    assert.match(textOf(render(createElement(panel.BalancePreviewLine, { preview: null }))), /Choose Credit or Debit/);
  });

  test('the message preview shows the notification and the history line, never the internal reason', () => {
    const html = textOf(render(createElement(panel.MessagePreview, {
      direction: 'credit', amountKobo: 500050, note: adjust.DEFAULT_NOTE, context: contextOf(),
    })));
    assert.match(html, /Wallet Credited ₦5,000\.50 has been added to your wallet\. Balance adjustment by CardElite support\./);
    assert.match(html, /Wallet credit \+₦5,000\.50/);
    assert.match(html, /reason and the reference are never shown to the user/);
    const off = textOf(render(createElement(panel.MessagePreview, {
      direction: 'debit',
      amountKobo: 100,
      note: 'n',
      context: contextOf({
        notifications: {
          credit: { active: true, title: 'a', body: 'b' },
          debit: { active: false, title: 'Wallet Debited', body: 'c' },
        },
      }),
    })));
    assert.match(off, /The Wallet Debited notification is switched off/);
    const fallback = textOf(render(createElement(panel.MessagePreview, {
      direction: 'credit', amountKobo: 100, note: 'n', context: contextOf({ notifications: null }),
    })));
    assert.match(fallback, /uses the default wording/);
  });

  test('recent adjustments list the admin, the amount and the message', () => {
    const context = contextOf({
      adjustments: [{
        id: ADJUSTMENT_ID, direction: 'debit', amount: 200, balance_before: 1700, balance_after: 1500, reason: 'Duplicate credit',
        user_note: 'Reversal of an amount credited in error.', reference: 'T-9', admin_id: ADMIN_ID, admin_username: 'owner',
        account_frozen: true, notified: false, transaction_id: TRANSACTION_ID, created_at: STAMP,
      }],
    });
    const html = textOf(render(createElement(panel.RecentAdjustments, { rows: context.history })));
    for (const expected of ['Debit', '−₦200.00', 'Duplicate credit', '@owner', 'Ref T-9', 'While frozen', 'Not notified',
      '“Reversal of an amount credited in error.”']) {
      assert.ok(html.includes(expected), expected);
    }
    assert.match(textOf(render(createElement(panel.RecentAdjustments, { rows: [] }))), /No wallet adjustments/);
    assert.match(textOf(render(createElement(panel.RecentAdjustments, { rows: null }))), /could not be loaded/);
  });

  test('the panel opens on the wallet, loading, with the review button disabled', () => {
    const html = render(createElement(confirmUi.ConfirmProvider, null, createElement(panel.WalletAdjustPanel, {
      user: USER,
      onClose: () => {},
      onApplied: () => {},
      onOutcomeUnknown: () => {},
    })));
    const text = textOf(html);
    assert.match(text, /Adjust wallet/);
    assert.match(text, /Ada Obi \(@ada\)/);
    assert.match(html, /aria-label="Loading the wallet"/);
    const review = tagsOf(html, 'button').find((attrs) => attrs.type === 'submit');
    assert.ok(review);
    assert.ok('disabled' in review);
    assert.equal(panel.walletAdjustEndpoint(USER_ID), `/api/users/${USER_ID}/wallet-adjustments`);
  });
});

interface Claims {
  admin_id: string;
  username: string;
  role_title: string;
  is_super_admin: boolean;
  page_permissions: string[];
  token_version: number;
}

type DbError = { message: string; code?: string } | null;

interface DbReply {
  data: unknown;
  error: DbError;
  count?: number | null;
}

interface QueryOp {
  table: string;
  kind: 'select' | 'insert';
  columns: string | null;
  head: boolean;
  eq: Record<string, unknown>;
  gte: Record<string, unknown>;
  in: Record<string, unknown[]>;
  orders: string[];
  range: [number, number] | null;
  limit: number | null;
  single: boolean;
  rows: unknown;
}

interface FakeQuery extends PromiseLike<DbReply> {
  select(columns: string, options?: { count?: string; head?: boolean }): FakeQuery;
  insert(rows: unknown): FakeQuery;
  eq(column: string, value: unknown): FakeQuery;
  gte(column: string, value: unknown): FakeQuery;
  in(column: string, values: readonly unknown[]): FakeQuery;
  order(column: string, options?: { ascending?: boolean }): FakeQuery;
  range(from: number, to: number): FakeQuery;
  limit(count: number): FakeQuery;
  maybeSingle(): FakeQuery;
}

interface World {
  user: Record<string, unknown> | null;
  wallet: Record<string, unknown> | null;
  config: Array<{ key: string; value: string | null }>;
  today: Array<{ id: string; amount: number | string }>;
  history: Array<Record<string, unknown>>;
  pending: number | null;
  adminEmail: string | null;
  admins: Array<{ id: string; username: string | null }>;
  templates: Array<{ key: string; title: string; body: string; is_active: boolean }>;
  failures: Partial<Record<string, string>>;
  auditFailure: string | null;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface RouteHarness {
  claims: Claims | null;
  headers: Record<string, string>;
  world: World;
  ops: QueryOp[];
  rpcCalls: RpcCall[];
  audits: Record<string, unknown>[];
  rpcReply: DbReply | 'throw';
  from(table: string): FakeQuery;
  rpc(name: string, args: Record<string, unknown>): Promise<DbReply>;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface AdjustRoute {
  GET: (req: Request, ctx: RouteContext) => Promise<Response>;
  POST: (req: Request, ctx: RouteContext) => Promise<Response>;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const HARNESS_KEY = '__walletAdjustRouteHarness';

const OWNER: Claims = {
  admin_id: ADMIN_ID,
  username: 'owner',
  role_title: 'Super Admin',
  is_super_admin: true,
  page_permissions: [],
  token_version: 0,
};

function staff(grants: string[]): Claims {
  return { ...OWNER, username: 'ops', role_title: 'Operations', is_super_admin: false, page_permissions: grants };
}

function freshWorld(): World {
  return {
    user: {
      id: USER_ID, full_name: 'Ada Obi', username: 'ada', email: 'ada@example.com', is_frozen: false, freeze_reason: null,
      deleted_at: null,
    },
    wallet: { balance: 1500 },
    config: [
      { key: 'emergency_mode', value: 'false' },
      { key: 'max_wallet_adjustment_naira', value: '500000' },
      { key: 'max_wallet_adjustment_daily_naira', value: '2000000' },
    ],
    today: [{ id: 'a1', amount: 0.1 }, { id: 'a2', amount: 0.2 }],
    history: [{
      id: ADJUSTMENT_ID, direction: 'credit', amount: 5000.5, balance_before: 1500, balance_after: 6500.5, reason: PRESET,
      user_note: 'Balance adjustment by CardElite support.', reference: 'TICKET-42', admin_id: OTHER_ADMIN_ID,
      account_frozen: false, notified: true, transaction_id: TRANSACTION_ID, created_at: STAMP,
    }],
    pending: 1,
    adminEmail: 'owner@cardelite.ng',
    admins: [{ id: OTHER_ADMIN_ID, username: 'tolu' }],
    templates: [
      { key: 'wallet_credited', title: 'Wallet Credited', body: '₦{amount} has been added to your wallet. {note}', is_active: true },
      { key: 'wallet_debited', title: 'Wallet Debited', body: '₦{amount} has been deducted from your wallet. {note}', is_active: false },
    ],
    failures: {},
    auditFailure: null,
  };
}

function slotOf(op: QueryOp): string {
  if (op.table === 'wallet_adjustments') return 'admin_id' in op.eq ? 'wallet_adjustments:today' : 'wallet_adjustments:history';
  if (op.table === 'admin_users') return 'id' in op.in ? 'admin_users:names' : 'admin_users:email';
  return op.table;
}

function respond(op: QueryOp): DbReply {
  const harness = routeHarness;
  harness.ops.push(op);
  const world = harness.world;
  if (op.kind === 'insert') {
    if (op.table !== 'audit_log') throw new Error(`unexpected insert into ${op.table}`);
    if (world.auditFailure) return { data: null, error: { message: world.auditFailure } };
    harness.audits.push(op.rows as Record<string, unknown>);
    return { data: null, error: null };
  }
  const slot = slotOf(op);
  const failed = world.failures[slot];
  if (failed) return { data: null, error: { message: failed } };
  switch (slot) {
    case 'users':
      return { data: world.user, error: null };
    case 'wallets':
      return { data: world.wallet, error: null };
    case 'app_config':
      return { data: world.config.filter((row) => (op.in.key ?? []).includes(row.key)), error: null };
    case 'wallet_adjustments:today': {
      const [from, to] = op.range ?? [0, world.today.length - 1];
      return { data: world.today.slice(from, to + 1), error: null };
    }
    case 'wallet_adjustments:history':
      return { data: world.history.slice(0, op.limit ?? world.history.length), error: null };
    case 'withdrawals':
      return { data: null, error: null, count: world.pending };
    case 'admin_users:email':
      return { data: { email: world.adminEmail }, error: null };
    case 'admin_users:names':
      return { data: world.admins.filter((row) => (op.in.id ?? []).includes(row.id)), error: null };
    case 'notification_templates':
      return { data: world.templates, error: null };
    default:
      throw new Error(`unexpected select on ${op.table}`);
  }
}

function fakeQuery(table: string): FakeQuery {
  const op: QueryOp = {
    table, kind: 'select', columns: null, head: false, eq: {}, gte: {}, in: {}, orders: [], range: null, limit: null, single: false,
    rows: null,
  };
  const query: FakeQuery = {
    select(columns, options) {
      op.columns = columns;
      op.head = options?.head === true;
      return query;
    },
    insert(rows) {
      op.kind = 'insert';
      op.rows = rows;
      return query;
    },
    eq(column, value) {
      op.eq[column] = value;
      return query;
    },
    gte(column, value) {
      op.gte[column] = value;
      return query;
    },
    in(column, values) {
      op.in[column] = [...values];
      return query;
    },
    order(column, options) {
      op.orders.push(`${column}:${options?.ascending === false ? 'desc' : 'asc'}`);
      return query;
    },
    range(from, to) {
      op.range = [from, to];
      return query;
    },
    limit(count) {
      op.limit = count;
      return query;
    },
    maybeSingle() {
      op.single = true;
      return query;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve().then(() => respond(op)).then(onFulfilled, onRejected);
    },
  };
  return query;
}

const routeHarness: RouteHarness = {
  claims: OWNER,
  headers: {},
  world: freshWorld(),
  ops: [],
  rpcCalls: [],
  audits: [],
  rpcReply: { data: null, error: null },
  from: (table) => fakeQuery(table),
  async rpc(name, args) {
    routeHarness.rpcCalls.push({ name, args });
    if (routeHarness.rpcReply === 'throw') throw new Error('fetch failed');
    return routeHarness.rpcReply;
  },
};
(globalThis as unknown as Record<string, unknown>)[HARNESS_KEY] = routeHarness;

const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const harnessRef = `const harness = () => globalThis.${HARNESS_KEY};`;

const ROUTE_FILE_STUBS: Readonly<Record<string, string>> = {
  [resolve(APP_DIR, 'lib', 'supabase.ts')]: moduleUrl(`${harnessRef}
export const supabaseAdmin = {
  from: (table) => harness().from(table),
  rpc: (name, args) => harness().rpc(name, args),
};`),
  [resolve(APP_DIR, 'lib', 'jwt.ts')]: moduleUrl(`${harnessRef}
export async function verifyAdminFromRequest() { return harness().claims; }`),
};

const ROUTE_PACKAGE_STUBS: Readonly<Record<string, string>> = {
  'next/headers': moduleUrl(`${harnessRef}
export async function headers() { return new Headers(harness().headers); }
export async function cookies() { return { get: () => undefined }; }`),
  'next/server': moduleUrl('export const NextResponse = { json: (body, init) => Response.json(body, init) };'),
};

const ROUTE_IMPORTS = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;
const routeBundles = new Map<string, Promise<string>>();

function resolveRouteImport(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const found = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]
    .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
  if (!found) throw new Error(`${fromFile} imports ${specifier}, which does not resolve to a .ts file`);
  return found;
}

async function compileRouteModule(file: string): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const targets = new Map<string, string>();
  for (const [, , specifier] of outputText.matchAll(ROUTE_IMPORTS)) {
    if (targets.has(specifier)) continue;
    if (specifier.startsWith('.')) {
      const target = resolveRouteImport(file, specifier);
      targets.set(specifier, ROUTE_FILE_STUBS[target] ?? (await bundleRouteModule(target)));
    } else if (ROUTE_PACKAGE_STUBS[specifier]) {
      targets.set(specifier, ROUTE_PACKAGE_STUBS[specifier]);
    } else {
      throw new Error(`${file} imports ${specifier}, which this test does not provide`);
    }
  }
  return moduleUrl(outputText.replace(ROUTE_IMPORTS, (match: string, head: string, specifier: string) => {
    const target = targets.get(specifier);
    return target ? `${head}'${target}'` : match;
  }));
}

function bundleRouteModule(file: string): Promise<string> {
  let pending = routeBundles.get(file);
  if (!pending) {
    pending = compileRouteModule(file);
    routeBundles.set(file, pending);
  }
  return pending;
}

let adjustRoute: AdjustRoute;

function resetRoute(claims: Claims | null = OWNER): void {
  routeHarness.claims = claims;
  routeHarness.headers = { 'x-request-id': REQUEST_ID, 'user-agent': USER_AGENT, 'x-forwarded-for': CLIENT_IP };
  routeHarness.world = freshWorld();
  routeHarness.ops = [];
  routeHarness.rpcCalls = [];
  routeHarness.audits = [];
  routeHarness.rpcReply = { data: appliedData(), error: null };
}

function appliedData(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    applied: true,
    replayed: false,
    adjustment_id: ADJUSTMENT_ID,
    transaction_id: TRANSACTION_ID,
    user_id: USER_ID,
    direction: 'credit',
    amount: 5000.5,
    balance_before: 1500,
    balance_after: 6500.5,
    account_frozen: false,
    notified: true,
    created_at: STAMP,
    ...patch,
  };
}

function context(id: string): RouteContext {
  return { params: Promise.resolve({ id }) };
}

async function getContext(id = USER_ID): Promise<Reply> {
  const response = await adjustRoute.GET(new Request(`http://admin.test/api/users/${id}/wallet-adjustments`), context(id));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function postAdjustment(payload: unknown, id = USER_ID): Promise<Reply> {
  const response = await adjustRoute.POST(new Request(`http://admin.test/api/users/${id}/wallet-adjustments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  }), context(id));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function failureBody(message: string, code: string, extra: Record<string, unknown> = {}) {
  return { success: false, error: message, code, message, request_id: REQUEST_ID, ...extra };
}

function attemptedAfter(patch: Record<string, unknown> = {}) {
  return {
    direction: 'credit',
    amount: '5000.50',
    user_note: 'Balance adjustment by CardElite support.',
    reference: 'TICKET-42',
    expected_balance: '1500.00',
    idempotency_key: KEY,
    ...patch,
  };
}

function failureAudit(fields: { action?: string; error: string; after?: Record<string, unknown> }) {
  return {
    admin_id: ADMIN_ID,
    user_id: USER_ID,
    action: fields.action ?? 'CREDIT_WALLET',
    entity: 'wallet_adjustments',
    entity_id: null,
    before_value: null,
    after_value: fields.after ?? attemptedAfter(),
    ip_address: CLIENT_IP,
    admin_role: OWNER.role_title,
    user_agent: USER_AGENT,
    request_id: REQUEST_ID,
    reason: PRESET,
    result: 'failure',
    error: fields.error,
    sensitivity: 'financial',
  };
}

function tablesTouched(): string[] {
  return routeHarness.ops.map((op) => `${op.kind}:${op.table}`);
}

describe('wallet adjustments route', () => {
  before(async () => {
    adjustRoute = (await import(await bundleRouteModule(ROUTE_FILE))) as AdjustRoute;
  });

  beforeEach(() => {
    resetRoute();
    mock.method(console, 'error', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  describe('access', () => {
    test('no session is 401 and touches nothing', async () => {
      resetRoute(null);
      assert.equal((await getContext()).status, 401);
      const write = await postAdjustment(requestBody());
      assert.equal(write.status, 401);
      assert.equal(write.body.code, 'AUTH_REQUIRED');
      assert.deepEqual(routeHarness.ops, []);
      assert.deepEqual(routeHarness.rpcCalls, []);
    });

    test('both users.read and wallets.adjust are required, for reading and for adjusting', async () => {
      const refused: string[][] = [
        ['users'],
        ['users.read'],
        ['wallets.adjust'],
        ['users', 'wallets.approve_adjustment'],
        ['users', 'users_freeze', 'withdrawals', 'transactions_overview', 'platform_balance', 'limits_fees', 'admin_settings'],
      ];
      for (const grants of refused) {
        resetRoute(staff(grants));
        const read = await getContext();
        assert.equal(read.status, 403, grants.join(','));
        assert.deepEqual(read.body.details, { required: ['users.read', 'wallets.adjust'] });
        const write = await postAdjustment(requestBody());
        assert.equal(write.status, 403, grants.join(','));
        assert.deepEqual(routeHarness.ops, [], grants.join(','));
        assert.deepEqual(routeHarness.rpcCalls, [], grants.join(','));
      }
      for (const grants of [['users', 'wallets.adjust'], ['users.read', 'wallets.adjust']]) {
        resetRoute(staff(grants));
        assert.equal((await getContext()).status, 200, grants.join(','));
        assert.equal((await postAdjustment(requestBody())).status, 200, grants.join(','));
      }
    });

    test('an id that is not a uuid is refused before anything is read or sent', async () => {
      assert.deepEqual((await getContext('nope')).body, failureBody('Invalid user id.', 'VALIDATION_ERROR'));
      assert.equal((await postAdjustment(requestBody(), 'nope')).status, 400);
      assert.deepEqual(routeHarness.ops, []);
      assert.deepEqual(routeHarness.rpcCalls, []);
    });
  });

  describe('GET', () => {
    test('returns what the panel needs to open, and never the user’s email', async () => {
      const startOfDay = businessDayStart().toISOString();
      const res = await getContext();
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.user, {
        id: USER_ID, full_name: 'Ada Obi', username: 'ada', is_frozen: false, freeze_reason: null, deleted_at: null,
      });
      assert.deepEqual(res.body.wallet, { balance: 1500 });
      assert.equal(res.body.emergency_mode, false);
      assert.deepEqual(res.body.limits, { per_adjustment: 500000, daily: 2000000 });
      assert.equal(res.body.used_today, 0.3);
      assert.equal(res.body.withdrawals_pending, 1);
      assert.equal(res.body.self_adjustment, false);
      assert.deepEqual(res.body.notifications, {
        credit: { active: true, title: 'Wallet Credited', body: '₦{amount} has been added to your wallet. {note}' },
        debit: { active: false, title: 'Wallet Debited', body: '₦{amount} has been deducted from your wallet. {note}' },
      });
      const history = res.body.adjustments as Array<Record<string, unknown>>;
      assert.equal(history.length, 1);
      assert.equal(history[0].admin_username, 'tolu');
      assert.deepEqual(res.body.partial, {
        config: null, used_today: null, withdrawals_pending: null, self_adjustment: null, notifications: null, adjustments: null,
      });
      assert.ok(!JSON.stringify(res.body).includes('ada@example.com'));
      assert.ok(!JSON.stringify(res.body).includes('owner@cardelite.ng'));

      const today = routeHarness.ops.find((op) => slotOf(op) === 'wallet_adjustments:today');
      assert.ok(today);
      assert.deepEqual(today.eq, { admin_id: ADMIN_ID });
      assert.deepEqual(today.gte, { created_at: startOfDay });
      const pending = routeHarness.ops.find((op) => op.table === 'withdrawals');
      assert.ok(pending);
      assert.deepEqual(pending.in, { status: ['pending_review', 'held'] });
      assert.equal(pending.head, true);
      const recent = routeHarness.ops.find((op) => slotOf(op) === 'wallet_adjustments:history');
      assert.ok(recent);
      assert.equal(recent.limit, 20);
      assert.deepEqual(recent.orders, ['created_at:desc', 'id:desc']);
      assert.deepEqual(recent.eq, { user_id: USER_ID });
      assert.ok(routeHarness.ops.every((op) => op.kind === 'select'), 'the GET only reads');
    });

    test('the panel payload parses into exact kobo on the client', async () => {
      const res = await getContext();
      const parsed = adjust.toWalletContext(res.body);
      assert.ok(parsed);
      assert.equal(parsed.balanceKobo, 150000);
      assert.equal(parsed.usedTodayKobo, 30);
      assert.equal(parsed.templates?.debit.active, false);
      assert.equal(parsed.history?.[0].adminUsername, 'tolu');
    });

    test('today’s total is summed in kobo across every page of the admin’s adjustments', async () => {
      routeHarness.world.today = [
        ...Array.from({ length: 1000 }, (_, index) => ({ id: `r${index}`, amount: 1 })),
        ...Array.from({ length: 5 }, (_, index) => ({ id: `s${index}`, amount: '0.01' })),
      ];
      const res = await getContext();
      assert.equal(res.body.used_today, 1000.05);
      const pages = routeHarness.ops.filter((op) => slotOf(op) === 'wallet_adjustments:today').map((op) => op.range);
      assert.deepEqual(pages, [[0, 999], [1000, 1999]]);
    });

    test('limits fall back to the defaults when missing or malformed, like the database', async () => {
      routeHarness.world.config = [
        { key: 'emergency_mode', value: 'true' },
        { key: 'max_wallet_adjustment_naira', value: 'lots' },
      ];
      const res = await getContext();
      assert.equal(res.body.emergency_mode, true);
      assert.deepEqual(res.body.limits, { per_adjustment: 500000, daily: 2000000 });
    });

    test('the admin’s own account is recognised by email, ignoring case and spaces', async () => {
      routeHarness.world.adminEmail = '  ADA@example.com ';
      assert.equal((await getContext()).body.self_adjustment, true);
      resetRoute();
      routeHarness.world.adminEmail = null;
      assert.equal((await getContext()).body.self_adjustment, false);
    });

    test('a user without a wallet has no balance; a missing template counts as switched off', async () => {
      routeHarness.world.wallet = null;
      routeHarness.world.templates = [];
      const res = await getContext();
      assert.equal(res.body.wallet, null);
      assert.deepEqual(res.body.notifications, {
        credit: { active: false, title: null, body: null },
        debit: { active: false, title: null, body: null },
      });
    });

    test('parts that fail are reported as partial, while the wallet and the user are required', async () => {
      routeHarness.world.failures = {
        app_config: 'boom',
        'wallet_adjustments:today': 'boom',
        withdrawals: 'boom',
        'admin_users:email': 'boom',
        notification_templates: 'boom',
        'wallet_adjustments:history': 'boom',
      };
      const res = await getContext();
      assert.equal(res.status, 200);
      assert.equal(res.body.limits, null);
      assert.equal(res.body.emergency_mode, null);
      assert.equal(res.body.used_today, null);
      assert.equal(res.body.withdrawals_pending, null);
      assert.equal(res.body.self_adjustment, null);
      assert.equal(res.body.notifications, null);
      assert.equal(res.body.adjustments, null);
      const partial = res.body.partial as Record<string, string | null>;
      assert.ok(Object.values(partial).every((entry) => typeof entry === 'string' && entry.length > 0));
      assert.ok(!JSON.stringify(res.body).includes('boom'));

      resetRoute();
      routeHarness.world.failures = { wallets: 'relation "wallets" does not exist' };
      const walletDown = await getContext();
      assert.deepEqual(walletDown.body, failureBody('The wallet could not be loaded. Try again.', 'INTERNAL_ERROR'));

      resetRoute();
      routeHarness.world.failures = { users: 'down' };
      assert.deepEqual((await getContext()).body, failureBody('The account could not be loaded. Try again.', 'INTERNAL_ERROR'));

      resetRoute();
      routeHarness.world.user = null;
      assert.deepEqual((await getContext()).body, failureBody('User not found.', 'RESOURCE_NOT_FOUND'));
    });

    test('admin names that cannot be read leave the history in place without names', async () => {
      routeHarness.world.failures = { 'admin_users:names': 'boom' };
      const res = await getContext();
      const history = res.body.adjustments as Array<Record<string, unknown>>;
      assert.equal(history.length, 1);
      assert.equal(history[0].admin_username, null);
    });
  });

  describe('POST', () => {
    test('sends every parameter to the database function, null never undefined, and returns the adjustment', async () => {
      const res = await postAdjustment(requestBody(), USER_ID.toUpperCase());
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        success: true,
        request_id: REQUEST_ID,
        adjustment: {
          adjustment_id: ADJUSTMENT_ID,
          transaction_id: TRANSACTION_ID,
          user_id: USER_ID,
          direction: 'credit',
          amount: 5000.5,
          balance_before: 1500,
          balance_after: 6500.5,
          account_frozen: false,
          notified: true,
          created_at: STAMP,
        },
        replayed: false,
      });
      assert.equal(routeHarness.rpcCalls.length, 1);
      const [call] = routeHarness.rpcCalls;
      assert.equal(call.name, 'admin_adjust_wallet');
      assert.deepEqual(Object.keys(call.args).sort(), RPC_PARAMS);
      for (const name of RPC_PARAMS) assert.notEqual(call.args[name], undefined, `${name} must never be undefined`);
      assert.deepEqual(call.args, {
        p_admin_id: ADMIN_ID,
        p_user_id: USER_ID,
        p_direction: 'credit',
        p_amount: '5000.50',
        p_reason: PRESET,
        p_user_note: 'Balance adjustment by CardElite support.',
        p_reference: 'TICKET-42',
        p_idempotency_key: KEY,
        p_expected_balance: '1500.00',
        p_request_id: REQUEST_ID,
        p_ip: CLIENT_IP,
        p_user_agent: USER_AGENT,
      });
      assert.deepEqual(tablesTouched(), [], 'the function writes the success audit itself, so the route writes nothing');
      assert.deepEqual(routeHarness.audits, []);
    });

    test('optional fields are sent as null, and a missing user agent too', async () => {
      delete routeHarness.headers['user-agent'];
      const res = await postAdjustment(requestBody({ user_note: '  ', reference: undefined, expected_balance: null, direction: 'debit' }));
      assert.equal(res.status, 200);
      const args = routeHarness.rpcCalls[0].args;
      assert.equal(args.p_user_note, null);
      assert.equal(args.p_reference, null);
      assert.equal(args.p_expected_balance, null);
      assert.equal(args.p_user_agent, null);
      assert.equal(args.p_direction, 'debit');
    });

    test('a replay is a success that says so and writes nothing', async () => {
      routeHarness.rpcReply = { data: appliedData({ replayed: true }), error: null };
      const res = await postAdjustment(requestBody());
      assert.equal(res.status, 200);
      assert.equal(res.body.replayed, true);
      assert.deepEqual(tablesTouched(), []);
    });

    test('invalid requests are refused before the database is called and are not audited', async () => {
      const cases: Array<[unknown, string, string | null]> = [
        ['not json', adjust.REQUEST_MESSAGES.body, null],
        [requestBody({ amount: '0' }), adjust.REQUEST_MESSAGES.amountZero, 'amount'],
        [requestBody({ amount: '1e5' }), adjust.AMOUNT_PROBLEMS.invalid, 'amount'],
        [requestBody({ reason: 'no' }), adjust.REQUEST_MESSAGES.reasonShort, 'reason'],
        [requestBody({ idempotency_key: 'x' }), adjust.REQUEST_MESSAGES.key, 'idempotency_key'],
      ];
      for (const [payload, message, field] of cases) {
        resetRoute();
        const res = await postAdjustment(payload);
        assert.deepEqual(res.body, failureBody(message, 'VALIDATION_ERROR', { details: { field } }), message);
        assert.deepEqual(routeHarness.rpcCalls, []);
        assert.deepEqual(routeHarness.audits, []);
      }
    });

    test('every refusal is mapped and audited once as a failure, with the direction as the action', async () => {
      const cases: Array<[Record<string, unknown>, number, string]> = [
        [{ reason: 'user_not_found' }, 404, 'RESOURCE_NOT_FOUND'],
        [{ reason: 'wallet_not_found' }, 404, 'RESOURCE_NOT_FOUND'],
        [{ reason: 'account_deleted' }, 409, 'STATE_CONFLICT'],
        [{ reason: 'emergency_mode' }, 409, 'STATE_CONFLICT'],
        [{ reason: 'self_adjustment' }, 409, 'STATE_CONFLICT'],
        [{ reason: 'insufficient_balance', balance: 1200 }, 409, 'STATE_CONFLICT'],
        [{ reason: 'balance_changed', balance: 1800 }, 409, 'STATE_CONFLICT'],
        [{ reason: 'over_limit', limit: 500000 }, 400, 'VALIDATION_ERROR'],
        [{ reason: 'over_daily_limit', limit: 2000000, used_today: 1999000 }, 400, 'VALIDATION_ERROR'],
        [{ reason: 'idempotency_mismatch' }, 409, 'IDEMPOTENCY_CONFLICT'],
      ];
      for (const direction of ['credit', 'debit'] as const) {
        for (const [refusal, status, code] of cases) {
          resetRoute();
          routeHarness.rpcReply = { data: { applied: false, ...refusal }, error: null };
          const res = await postAdjustment(requestBody({ direction }));
          const label = `${direction} ${String(refusal.reason)}`;
          assert.equal(res.status, status, label);
          assert.equal(res.body.code, code, label);
          assert.equal(res.body.success, false, label);
          const { reason, ...extras } = refusal;
          assert.deepEqual(res.body.details, { reason, ...extras }, label);
          assert.deepEqual(routeHarness.audits, [failureAudit({
            action: direction === 'credit' ? 'CREDIT_WALLET' : 'DEBIT_WALLET',
            error: String(reason),
            after: attemptedAfter({ direction, ...extras }),
          })], label);
        }
      }
    });

    test('not authorized gets the same answer as a deactivated admin, and is audited', async () => {
      routeHarness.rpcReply = { data: null, error: { code: 'P0001', message: 'Not authorized' } };
      const res = await postAdjustment(requestBody());
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, failureBody('Your session has expired. Sign in again.', 'AUTH_REQUIRED'));
      assert.deepEqual(routeHarness.audits, [failureAudit({ error: 'Not authorized' })]);
    });

    test('invalid input caught by the database is a validation error', async () => {
      routeHarness.rpcReply = { data: null, error: { code: 'P0001', message: 'Invalid adjustment' } };
      const res = await postAdjustment(requestBody());
      assert.deepEqual(res.body, failureBody(adjust.INVALID_ADJUSTMENT_MESSAGE, 'VALIDATION_ERROR'));
      assert.deepEqual(routeHarness.audits, [failureAudit({ error: 'Invalid adjustment' })]);
    });

    test('any other database error rolled back the whole call, so nothing was changed', async () => {
      routeHarness.rpcReply = { data: null, error: { code: '40P01', message: 'deadlock detected' } };
      const res = await postAdjustment(requestBody());
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, failureBody(adjust.NOT_APPLIED_MESSAGE, 'INTERNAL_ERROR'));
      assert.deepEqual(routeHarness.audits, [failureAudit({ error: 'deadlock detected' })]);
    });

    test('a lost or unreadable answer is reported as unknown, so the panel retries with the same key', async () => {
      const unknownBody = failureBody(adjust.OUTCOME_UNKNOWN_MESSAGE, 'INTERNAL_ERROR', { details: { outcome_unknown: true } });
      routeHarness.rpcReply = { data: null, error: { code: '', message: 'TypeError: fetch failed' } };
      const lost = await postAdjustment(requestBody());
      assert.equal(lost.status, 500);
      assert.deepEqual(lost.body, unknownBody);
      assert.deepEqual(routeHarness.audits, [failureAudit({ error: 'TypeError: fetch failed (the outcome is unknown)' })]);

      resetRoute();
      routeHarness.rpcReply = 'throw';
      assert.deepEqual((await postAdjustment(requestBody())).body, unknownBody);
      assert.deepEqual(routeHarness.audits, [failureAudit({ error: 'fetch failed (the outcome is unknown)' })]);

      resetRoute();
      routeHarness.rpcReply = { data: { ok: true }, error: null };
      assert.deepEqual((await postAdjustment(requestBody())).body, unknownBody);
      assert.deepEqual(routeHarness.audits, [failureAudit({ error: 'The result could not be read (the outcome is unknown)' })]);
    });

    test('a failed audit write does not change the answer', async () => {
      routeHarness.world.auditFailure = 'audit insert refused';
      routeHarness.rpcReply = { data: { applied: false, reason: 'emergency_mode' }, error: null };
      const res = await postAdjustment(requestBody());
      assert.equal(res.status, 409);
      assert.deepEqual(res.body.details, { reason: 'emergency_mode' });
    });
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

function sliceBetween(source: string, start: string, end?: string): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  return source.slice(from, to < 0 ? source.length : to);
}

describe('source contract', () => {
  const route = () => readFileSync(ROUTE_FILE, 'utf8');

  test('both handlers use the guard for users.read and wallets.adjust together', () => {
    const source = route();
    const get = sliceBetween(source, 'export async function GET', 'export async function POST');
    const post = sliceBetween(source, 'export async function POST');
    for (const handler of [get, post]) {
      assert.match(handler, /requireAdminAll\(\['users\.read', 'wallets\.adjust'\]\)/);
    }
    assert.doesNotMatch(source, /requireSuperAdmin|requireAdminAny|requireAdmin\(/);
    assert.doesNotMatch(source, /NextResponse\.json|verifyAdminFromRequest|page_permissions/);
  });

  test('the POST calls the database function by name with every parameter, sourced from the guard and the request', () => {
    const post = sliceBetween(route(), 'export async function POST');
    assert.match(post, /supabaseAdmin\.rpc\('admin_adjust_wallet', \{/);
    for (const [name, source] of [
      ['p_admin_id', 'admin.admin_id'], ['p_user_id', 'userId'], ['p_direction', 'request.direction'],
      ['p_amount', 'request.amount'], ['p_reason', 'request.reason'], ['p_user_note', 'request.user_note'],
      ['p_reference', 'request.reference'], ['p_idempotency_key', 'request.idempotency_key'],
      ['p_expected_balance', 'request.expected_balance'], ['p_request_id', 'admin.request_id'], ['p_ip', 'admin.ip'],
      ['p_user_agent', 'admin.user_agent \\|\\| null'],
    ]) {
      assert.match(post, new RegExp(`${name}: ${source},`), name);
    }
  });

  test('the route only ever audits failures, as financial, with the action written as literals', () => {
    const source = route();
    assert.equal(source.match(/writeAudit\(/g)?.length, 1);
    assert.match(source, /action: request\.direction === 'credit' \? 'CREDIT_WALLET' : 'DEBIT_WALLET',/);
    assert.match(source, /entity: 'wallet_adjustments',/);
    assert.match(source, /result: 'failure',/);
    assert.match(source, /sensitivity: 'financial',/);
    assert.doesNotMatch(source, /result: 'success'/);
    assert.doesNotMatch(source, /\.(?:insert|update|upsert|delete)\(/);
  });

  test('no console code moves money itself: no wallet writes and no new ledger inserts anywhere in app/', () => {
    const files = sourceFiles(APP_DIR).filter((file) => /\.tsx?$/.test(file));
    const offenders = (pattern: RegExp) => files
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map((file) => relative(APP_DIR, file).split(sep).join('/'));
    assert.deepEqual(offenders(/\.from\(\s*['"`]wallets['"`]\s*\)\s*\.(?:update|insert|upsert|delete)\(/), []);
    assert.deepEqual(offenders(/\.from\(\s*['"`]wallet_adjustments['"`]\s*\)\s*\.(?:update|insert|upsert|delete)\(/), []);
    assert.deepEqual(offenders(/\.from\(\s*['"`]transactions['"`]\s*\)\s*\.(?:upsert|delete)\(/), []);
    assert.deepEqual(
      offenders(/\.from\(\s*['"`]transactions['"`]\s*\)\s*\.insert\(/),
      ['api/card-queue/route.ts'],
      'only the existing failed-credit record of a rejected card may insert a ledger row directly',
    );
    const cardQueue = readFileSync(join(APP_DIR, 'api', 'card-queue', 'route.ts'), 'utf8');
    const insert = sliceBetween(cardQueue, ".from('transactions').insert(", '});');
    assert.match(insert, /status: 'failed',/);
    assert.match(insert, /type: 'giftcard_credit',/);
  });

  test('the shared module is server-safe and the new files follow the house rules', () => {
    const shared = readFileSync(join(OWNED_DIR, 'walletAdjust.ts'), 'utf8');
    assert.doesNotMatch(shared, /'use client'/);
    assert.doesNotMatch(shared, /from 'react'/);
    assert.doesNotMatch(shared, /^import \{[^}]*\} from '\.\.\/\.\.\/\.\.\/_ui';$/m);
    const owned = [
      ROUTE_FILE, NAIRA_FILE, join(OWNED_DIR, 'walletAdjust.ts'), join(OWNED_DIR, 'WalletAdjustPanel.tsx'),
      join(OWNED_DIR, 'UserParts.tsx'), join(OWNED_DIR, 'page.tsx'), join(OWNED_DIR, 'model.ts'),
    ];
    for (const file of owned) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /\/\*/, file);
      assert.doesNotMatch(source, /(^|\s)\/\/\s/m, file);
      assert.doesNotMatch(source, /style=\{/, file);
      assert.doesNotMatch(source, /[\u0000-\u0008\u000B\u000C\u000E-\u001F​-‏‪-‮⁦-⁩﻿]/, file);
    }
  });

  test('the panel stylesheet uses tokens only', () => {
    const css = readFileSync(join(OWNED_DIR, 'WalletAdjust.module.css'), 'utf8');
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
    for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      assert.doesNotMatch(value, colour, `${property}: ${value}`);
      assert.notEqual(property, 'z-index', `${property}: ${value}`);
    }
    assert.doesNotMatch(css, /\/\*/);
  });

  test('the panel keeps one key per session and retries with the stored request', () => {
    const source = readFileSync(join(OWNED_DIR, 'WalletAdjustPanel.tsx'), 'utf8');
    assert.match(source, /const \[initialKey\] = useState\(mintAdjustKey\);/);
    assert.match(source, /const body = retryBody\(attemptRef\.current\);/);
    assert.match(source, /prepareAttempt\(attemptRef\.current, adjustPayload\(values, fresh\.balanceKobo\), mintAdjustKey\)/);
    assert.equal(source.match(/randomUUID/g), null);
    assert.equal(source.match(/method: 'POST'/g)?.length, 2);
  });
});
