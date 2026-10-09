import { afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ElementType } from 'react';
import { loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import {
  EMERGENCY_APPROVAL, EMERGENCY_PAUSED, EMERGENCY_REJECT_NOTE, EMERGENCY_TITLE, EMERGENCY_UNCHECKED, FROZEN_APPROVAL,
  PAYOUT_UNCHECKED, approvalRefusal, classifyDecision, payoutDiffers, payoutProviderNote, toActionResult, toDetail,
  toListResult,
  type ActionResult, type DetailPartial, type Withdrawal,
} from '../app/(dashboard)/withdrawals/model.ts';
import type { ApiResult } from '../app/lib/apiClient.ts';

const PAGE_DIR = fileURLToPath(new URL('../app/(dashboard)/withdrawals/', import.meta.url));
const API_DIR = fileURLToPath(new URL('../app/api/withdrawals/', import.meta.url));
const LIST_ROUTE = join(API_DIR, 'route.ts');
const APPROVE_ROUTE = join(API_DIR, '[id]', 'approve', 'route.ts');
const REJECT_ROUTE = join(API_DIR, '[id]', 'reject', 'route.ts');

type ApiClientModule = typeof import('../app/lib/apiClient.ts');

let api: ApiClientModule;
let parts: Record<string, ElementType>;
const realFetch = globalThis.fetch;

before(async () => {
  api = await loadAppModule<ApiClientModule>('lib/apiClient.ts');
  parts = await loadAppModule<Record<string, ElementType>>('(dashboard)/withdrawals/WithdrawalParts.tsx');
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(handler: (init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => handler(init ?? {})) as typeof fetch;
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function failed(code: string, message: string, status: number, details?: unknown): Response {
  return json({ success: false, error: message, code, message, request_id: 'req_fail', ...(details ? { details } : {}) }, status);
}

function approve(timeoutMs?: number): Promise<ApiResult<ActionResult>> {
  return api.apiRequest('/api/withdrawals/w1/approve', { method: 'POST', select: toActionResult, timeoutMs });
}

const UNREACHABLE =
  'The payout was released but the provider response never arrived. This withdrawal is now "initiated". Check the provider before retrying — the transfer may already have been sent.';

const WITHDRAWAL: Withdrawal = {
  id: '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5',
  user_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  amount: 50000,
  fee: 100,
  bank_name: 'Access Bank',
  account_number: '0123456789',
  account_name: 'Ada Obi',
  gateway: 'paystack',
  gateway_reference: null,
  status: 'pending_review',
  failure_reason: null,
  created_at: '2026-10-01T09:30:00.000Z',
  user: { username: 'ada', full_name: 'Ada Obi', email: 'ada@example.com', phone: '08030000000', is_frozen: false },
  flag: null,
};

const NO_PARTIAL: DetailPartial = { user: null, flag: null };

function detailHtml(
  withdrawal: Withdrawal,
  payoutGateway: string | null,
  partial: DetailPartial = NO_PARTIAL,
  emergencyMode?: boolean | null,
): string {
  return render(createElement(parts.DetailBody, { withdrawal, partial, payoutGateway, emergencyMode }));
}

function rowValue(html: string, label: string): string | undefined {
  const text = textOf(html);
  const index = text.indexOf(`${label} `);
  return index < 0 ? undefined : text.slice(index + label.length + 1);
}

describe('classifyDecision', () => {
  test('a 2xx response is a finished decision carrying the new status, any warning and the request id', async () => {
    respond(() => json({ success: true, request_id: 'req_ok', status: 'processing', gateway_reference: 'TRF_1', audit_recorded: true }, 200));
    assert.deepEqual(classifyDecision(await approve()), { kind: 'done', status: 'processing', warning: null, requestId: 'req_ok' });

    respond(() => json({ success: true, request_id: 'req_warn', status: 'processing', audit_recorded: false, warning: 'The payout succeeded but could not be written to the audit log.' }, 200));
    assert.deepEqual(classifyDecision(await approve()), {
      kind: 'done',
      status: 'processing',
      warning: 'The payout succeeded but could not be written to the audit log.',
      requestId: 'req_warn',
    });
  });

  test('PROVIDER_ERROR keeps the route message verbatim with its stage', async () => {
    respond(() => failed('PROVIDER_ERROR', UNREACHABLE, 502, { status: 'initiated', stage: 'gateway_unreachable', gateway_error: 'timeout' }));
    assert.deepEqual(classifyDecision(await approve()), {
      kind: 'provider', message: UNREACHABLE, stage: 'gateway_unreachable', requestId: 'req_fail',
    });

    respond(() => failed('PROVIDER_ERROR', 'Gateway error. Withdrawal failed and refunded to the user.', 502, { status: 'failed', stage: 'gateway_rejected' }));
    assert.deepEqual(classifyDecision(await approve()), {
      kind: 'provider',
      message: 'Gateway error. Withdrawal failed and refunded to the user.',
      stage: 'gateway_rejected',
      requestId: 'req_fail',
    });

    respond(() => failed('PROVIDER_ERROR', 'The payment provider could not be reached.', 502));
    const bare = classifyDecision(await approve());
    assert.equal(bare.kind === 'provider' && bare.stage, null);
  });

  test('a send whose result is unknown is never offered as a retry', async () => {
    respond(() => new Response('<html>Internal Server Error</html>', { status: 500, headers: { 'x-request-id': 'req_500' } }));
    assert.deepEqual(classifyDecision(await approve()), { kind: 'unknown', requestId: 'req_500' });

    respond(() => new Response('upstream timed out', { status: 504 }));
    assert.deepEqual(classifyDecision(await approve()), { kind: 'unknown', requestId: null });

    respond(() => {
      throw new TypeError('Failed to fetch');
    });
    assert.deepEqual(classifyDecision(await approve()), { kind: 'unknown', requestId: null });

    respond(() => new Response('{"success": tru', { status: 200 }));
    assert.equal(classifyDecision(await approve()).kind, 'unknown');

    respond((init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    assert.deepEqual(classifyDecision(await approve(5)), { kind: 'unknown', requestId: null });
  });

  test('a lost session closes the dialog for the sign-in prompt', async () => {
    respond(() => failed('AUTH_REQUIRED', 'Your session has expired. Sign in again.', 401));
    assert.deepEqual(classifyDecision(await approve()), { kind: 'expired' });
  });

  test('permission, missing and already-decided answers close the dialog with the route message', async () => {
    respond(() => failed('PERMISSION_DENIED', 'You do not have permission to do this.', 403));
    assert.deepEqual(classifyDecision(await approve()), {
      kind: 'refused', message: 'You do not have permission to do this.', status: 403,
    });

    respond(() => failed('RESOURCE_NOT_FOUND', 'Withdrawal not found.', 404));
    assert.deepEqual(classifyDecision(await approve()), { kind: 'refused', message: 'Withdrawal not found.', status: 404 });

    const frozen = 'This account is frozen. Unfreeze it before approving, or reject the withdrawal to refund the wallet.';
    assert.equal(FROZEN_APPROVAL, frozen);
    respond(() => failed('STATE_CONFLICT', frozen, 409, { reason: 'account_frozen' }));
    assert.deepEqual(classifyDecision(await approve()), { kind: 'refused', message: frozen, status: 409 });

    respond(() => failed('STATE_CONFLICT', EMERGENCY_APPROVAL, 409, { reason: 'emergency_mode' }));
    assert.deepEqual(classifyDecision(await approve()), { kind: 'refused', message: EMERGENCY_APPROVAL, status: 409 });
  });

  test('definite refusals that changed nothing stay retryable in the dialog', async () => {
    respond(() => failed('VALIDATION_ERROR', 'A rejection reason is required.', 400));
    assert.deepEqual(classifyDecision(await approve()), { kind: 'retry', message: 'A rejection reason is required.' });

    respond(() => failed('RATE_LIMITED', 'Too many requests. Try again shortly.', 429));
    assert.deepEqual(classifyDecision(await approve()), { kind: 'retry', message: 'Too many requests. Try again shortly.' });

    respond(() => failed('INTERNAL_ERROR', 'Could not read the withdrawal.', 500));
    assert.deepEqual(classifyDecision(await approve()), { kind: 'retry', message: 'Could not read the withdrawal.' });
  });
});

describe('payout provider wording', () => {
  test('says nothing extra when the payout goes through the provider the request came in on', () => {
    assert.equal(payoutProviderNote('paystack', 'paystack'), null);
    assert.equal(payoutProviderNote(' Paystack ', 'paystack'), null);
    assert.equal(payoutDiffers('MONNIFY', 'monnify'), false);
  });

  test('names both providers when the active provider differs from the request', () => {
    assert.equal(
      payoutProviderNote('paystack', 'monnify'),
      'This request came in via Paystack, but the payout will go through Monnify, the active provider.',
    );
    assert.equal(
      payoutProviderNote('monnify', 'novac'),
      'This request came in via Monnify, but the payout will go through Novac, the active provider.',
    );
    assert.equal(payoutDiffers('paystack', 'monnify'), true);
  });

  test('warns when the active provider could not be checked', () => {
    assert.equal(payoutProviderNote('paystack', null), PAYOUT_UNCHECKED);
    assert.equal(payoutDiffers('paystack', null), true);
  });

  test('has nothing to contrast when the request recorded no provider', () => {
    assert.equal(payoutProviderNote(null, 'monnify'), null);
    assert.equal(payoutProviderNote('', 'monnify'), null);
    assert.equal(payoutDiffers(null, 'monnify'), false);
  });
});

describe('response mappers', () => {
  test('toListResult needs a withdrawals array', () => {
    assert.equal(toListResult({ success: true }), null);
    assert.equal(toListResult({ withdrawals: {} }), null);
    assert.deepEqual(
      toListResult({
        withdrawals: [WITHDRAWAL],
        total: '12',
        search_capped: true,
        emergency_mode: true,
        partial: { flags: ' Flag markers could not be loaded. ' },
      }),
      { withdrawals: [WITHDRAWAL], total: 12, searchCapped: true, flagNote: 'Flag markers could not be loaded.', emergencyMode: true },
    );
    assert.deepEqual(
      toListResult({ withdrawals: [], total: -4, search_capped: 'yes', partial: { flags: null } }),
      { withdrawals: [], total: 0, searchCapped: false, flagNote: null, emergencyMode: null },
    );
  });

  test('toDetail needs a withdrawal with an id and carries the payout provider', () => {
    assert.equal(toDetail({ success: true }), null);
    assert.equal(toDetail({ withdrawal: { status: 'held' } }), null);
    assert.deepEqual(
      toDetail({
        withdrawal: WITHDRAWAL,
        partial: { user: 'The account holder could not be loaded.', flag: null },
        payout_gateway: 'monnify',
        emergency_mode: false,
      }),
      {
        withdrawal: WITHDRAWAL,
        partial: { user: 'The account holder could not be loaded.', flag: null },
        payoutGateway: 'monnify',
        emergencyMode: false,
      },
    );
    assert.deepEqual(toDetail({ withdrawal: WITHDRAWAL }), {
      withdrawal: WITHDRAWAL, partial: NO_PARTIAL, payoutGateway: null, emergencyMode: null,
    });
  });

  test('a detail response without a withdrawal is an unreadable response, not data', async () => {
    respond(() => json({ success: true, request_id: 'req_empty' }, 200));
    const result = await api.apiRequest('/api/withdrawals', { query: { id: WITHDRAWAL.id }, select: toDetail });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error.kind, 'parse');
  });

  test('toActionResult keeps status and warning text only', () => {
    assert.deepEqual(toActionResult({ status: 'processing', warning: '  ' }), { status: 'processing', warning: null });
    assert.deepEqual(toActionResult({ status: 3, warning: 'Audit failed.' }), { status: null, warning: 'Audit failed.' });
  });
});

describe('withdrawal detail drawer', () => {
  test('masks the bank account number and never prints it whole', () => {
    const html = detailHtml(WITHDRAWAL, 'paystack');
    assert.ok(!html.includes('0123456789'), 'the full account number reached the screen');
    assert.match(html, /•••• 6789/);
    assert.match(html, /Account ending 6 7 8 9/);
  });

  test('shows one provider row when the payout goes through the provider the request came in on', () => {
    const html = detailHtml(WITHDRAWAL, 'paystack');
    assert.equal(rowValue(html, 'Provider')?.startsWith('Paystack'), true);
    assert.ok(!textOf(html).includes('Payout provider'));
    assert.ok(!textOf(html).includes('Requested via'));
  });

  test('shows the request provider and the active payout provider when they differ', () => {
    const html = detailHtml(WITHDRAWAL, 'monnify');
    assert.equal(rowValue(html, 'Requested via')?.startsWith('Paystack'), true);
    assert.equal(rowValue(html, 'Payout provider')?.startsWith('Monnify'), true);
  });

  test('says the payout provider could not be checked rather than guessing', () => {
    const html = detailHtml(WITHDRAWAL, null);
    assert.equal(rowValue(html, 'Payout provider')?.startsWith('Could not be checked'), true);
  });

  test('keeps the recorded provider for a withdrawal that is no longer awaiting a decision', () => {
    const html = detailHtml({ ...WITHDRAWAL, status: 'processing', gateway_reference: 'TRF_1' }, null);
    assert.equal(rowValue(html, 'Provider')?.startsWith('Paystack'), true);
    assert.ok(!textOf(html).includes('Payout provider'));
  });

  test('calls out a frozen account and explains why an open payout cannot be approved', () => {
    const frozen = { ...WITHDRAWAL, user: { ...WITHDRAWAL.user, is_frozen: true, freeze_reason: 'Chargeback under review' } };
    const open = textOf(detailHtml(frozen, 'paystack'));
    assert.match(open, /Account frozen Chargeback under review/);
    assert.match(open, /This payout cannot be approved while the account is frozen\./);
    const closed = textOf(detailHtml({ ...frozen, status: 'failed' }, null));
    assert.match(closed, /Account frozen Chargeback under review/);
    assert.ok(!closed.includes('cannot be approved while the account is frozen'));
    assert.ok(!textOf(detailHtml(WITHDRAWAL, 'paystack')).includes('Account frozen'));
  });

  test('announces a partial load politely', () => {
    const html = detailHtml(WITHDRAWAL, 'paystack', { user: 'The account holder could not be loaded.', flag: 'The flag status could not be checked.' });
    const live = tagsOf(html, 'span').filter((attrs) => attrs.role === 'status');
    assert.equal(live.length, 2);
    assert.match(textOf(html), /The flag status could not be checked\. Review the account before deciding\./);
  });
});

describe('outcome notice', () => {
  const outcome = {
    id: WITHDRAWAL.id,
    tone: 'danger' as const,
    title: 'Approval outcome unknown',
    message: 'The approval was sent but no usable response came back.',
    requestId: 'req_x',
    raisedInDrawer: false,
  };

  test('announces as an alert only where it was raised', () => {
    const loud = render(createElement(parts.OutcomeNotice, { outcome, announce: true, onDismiss: () => {} }));
    const quiet = render(createElement(parts.OutcomeNotice, { outcome, announce: false, onDismiss: () => {} }));
    assert.equal(tagsOf(loud, 'div').filter((attrs) => attrs.role === 'alert').length, 1);
    assert.equal(tagsOf(quiet, 'div').filter((attrs) => attrs.role).length, 0);
    assert.match(textOf(quiet), /Approval outcome unknown The approval was sent but no usable response came back\./);
  });

  test('offers to open the withdrawal and to dismiss the notice', () => {
    const html = render(createElement(parts.OutcomeNotice, { outcome, announce: false, onDismiss: () => {}, onOpen: () => {} }));
    const labels = tagsOf(html, 'button').map((attrs) => attrs['aria-label']).filter(Boolean);
    assert.ok(labels.includes('Dismiss this notice'));
    assert.match(textOf(html), /Open withdrawal/);
    assert.match(textOf(html), /req_x/);
  });
});

describe('emergency mode', () => {
  test('the refusal says approvals are paused, who can lift it and where', () => {
    assert.equal(
      EMERGENCY_APPROVAL,
      'Emergency mode is on. Approvals are paused until a super administrator turns it off in Admin Settings.',
    );
    assert.match(EMERGENCY_UNCHECKED, /^Emergency mode could not be checked\./);
  });

  test('a frozen account is refused first, then emergency mode, and an unchecked flag refuses nothing', () => {
    const frozen: Withdrawal = { ...WITHDRAWAL, user: { ...WITHDRAWAL.user, is_frozen: true } };
    assert.equal(approvalRefusal({ withdrawal: frozen, emergencyMode: true }), FROZEN_APPROVAL);
    assert.equal(approvalRefusal({ withdrawal: frozen, emergencyMode: false }), FROZEN_APPROVAL);
    assert.equal(approvalRefusal({ withdrawal: WITHDRAWAL, emergencyMode: true }), EMERGENCY_APPROVAL);
    assert.equal(approvalRefusal({ withdrawal: WITHDRAWAL, emergencyMode: false }), null);
    assert.equal(approvalRefusal({ withdrawal: WITHDRAWAL, emergencyMode: null }), null);
  });

  test('only a real boolean is read as the emergency flag', () => {
    assert.equal(toListResult({ withdrawals: [], emergency_mode: true })?.emergencyMode, true);
    assert.equal(toListResult({ withdrawals: [], emergency_mode: false })?.emergencyMode, false);
    assert.equal(toListResult({ withdrawals: [], emergency_mode: 'true' })?.emergencyMode, null);
    assert.equal(toListResult({ withdrawals: [], emergency_mode: null })?.emergencyMode, null);
    assert.equal(toDetail({ withdrawal: WITHDRAWAL, emergency_mode: true })?.emergencyMode, true);
    assert.equal(toDetail({ withdrawal: WITHDRAWAL, emergency_mode: 1 })?.emergencyMode, null);
  });

  test('the page notice says rejecting still works and links only super admins to the switch', () => {
    const plain = render(createElement(parts.EmergencyNotice, { settingsLink: false }));
    assert.equal(textOf(plain), `${EMERGENCY_TITLE} ${EMERGENCY_PAUSED} ${EMERGENCY_REJECT_NOTE}`);
    assert.equal(tagsOf(plain, 'a').length, 0);
    assert.equal(tagsOf(plain, 'div').filter((attrs) => attrs.role === 'status').length, 1);
    const linked = render(createElement(parts.EmergencyNotice, { settingsLink: true }));
    assert.deepEqual(tagsOf(linked, 'a').map((attrs) => attrs.href), ['/admin-settings']);
    assert.match(textOf(linked), /Open Admin Settings$/);
  });

  test('the drawer explains the pause only while the withdrawal can still be approved', () => {
    const open = textOf(detailHtml(WITHDRAWAL, 'paystack', NO_PARTIAL, true));
    assert.ok(open.startsWith(`${EMERGENCY_TITLE} ${EMERGENCY_PAUSED} ${EMERGENCY_REJECT_NOTE}`), open);
    const held = textOf(detailHtml({ ...WITHDRAWAL, status: 'held' }, 'paystack', NO_PARTIAL, true));
    assert.ok(held.startsWith(EMERGENCY_TITLE), held);
    assert.ok(!textOf(detailHtml({ ...WITHDRAWAL, status: 'success' }, null, NO_PARTIAL, true)).includes(EMERGENCY_TITLE));
    assert.ok(!textOf(detailHtml(WITHDRAWAL, 'paystack', NO_PARTIAL, false)).includes(EMERGENCY_TITLE));
    assert.ok(!textOf(detailHtml(WITHDRAWAL, 'paystack', NO_PARTIAL, null)).includes(EMERGENCY_TITLE));
    assert.ok(!textOf(detailHtml(WITHDRAWAL, 'paystack')).includes(EMERGENCY_TITLE));
  });

  test('a frozen account in emergency mode shows both reasons approval is blocked', () => {
    const frozen: Withdrawal = { ...WITHDRAWAL, user: { ...WITHDRAWAL.user, is_frozen: true, freeze_reason: 'Chargeback' } };
    const text = textOf(detailHtml(frozen, 'paystack', NO_PARTIAL, true));
    assert.equal(text.indexOf(EMERGENCY_TITLE), 0, text);
    assert.ok(text.indexOf('Account frozen Chargeback') > 0, text);
  });
});

describe('route contract and hard rules', () => {
  test('the approve route maps the database refusal like a frozen account, before any payout is sent', () => {
    const source = readFileSync(APPROVE_ROUTE, 'utf8');
    assert.match(source, /import \{ EMERGENCY_APPROVAL, FROZEN_APPROVAL \} from '[./]+\(dashboard\)\/withdrawals\/model';/);
    const rpc = source.indexOf("rpc('admin_approve_withdrawal'");
    const frozen = source.indexOf("rpcErr.message.includes('Account is frozen')");
    const emergency = source.indexOf("rpcErr.message.includes('Emergency mode is on')");
    const fallback = source.indexOf("'The withdrawal could not be moved out of review. Reload and try again.'");
    const payout = source.indexOf('/functions/v1/resume-withdrawal');
    assert.ok(rpc > 0 && frozen > rpc && emergency > frozen && fallback > emergency && payout > fallback);
    assert.match(source, /fail\('STATE_CONFLICT', FROZEN_APPROVAL, \{ details: \{ reason: 'account_frozen' \} \}\)/);
    assert.match(source, /fail\('STATE_CONFLICT', EMERGENCY_APPROVAL, \{ details: \{ reason: 'emergency_mode' \} \}\)/);
    assert.doesNotMatch(source, /This account is frozen\.|Approvals are paused/);
  });

  test('list and detail responses add emergency_mode, read as the exact flag text, and keep every mobile key', () => {
    const source = readFileSync(LIST_ROUTE, 'utf8');
    assert.match(source, /const EMERGENCY_KEY = 'emergency_mode';/);
    assert.match(source, /\.from\('app_config'\)\s*\.select\('value'\)\s*\.eq\('key', EMERGENCY_KEY\)/);
    assert.match(source, /return data\?\.value === 'true';/);
    assert.equal(source.match(/emergency_mode: emergencyMode,/g)?.length, 2);
    for (const key of ['withdrawals,', 'total,', 'search_capped:', 'withdrawal: {', 'payout_gateway:', 'partial:']) {
      assert.ok(source.includes(key), key);
    }
  });

  test('the page refuses approval up front from a fresh read and keeps reject available', () => {
    const page = readFileSync(join(PAGE_DIR, 'page.tsx'), 'utf8');
    const approveStart = page.indexOf('const approve = async');
    const rejectStart = page.indexOf('const reject = async');
    const approveBody = page.slice(approveStart, rejectStart);
    const rejectBody = page.slice(rejectStart, page.indexOf('const runExport = async'));
    assert.ok(approveStart > 0 && rejectStart > approveStart);
    assert.ok(approveBody.indexOf('await readActionable(id)') < approveBody.indexOf('approvalRefusal(fresh)'));
    assert.ok(approveBody.indexOf('approvalRefusal(fresh)') < approveBody.indexOf('await confirm('));
    assert.doesNotMatch(rejectBody, /approvalRefusal|emergency/i);
    assert.match(page, /emergencyOn \? <EmergencyNotice settingsLink=\{isSuperAdmin\} \/> : null/);
  });

  test('no prose comments, literal colours, stacking numbers or static inline styles', () => {
    const sources = [
      ...['page.tsx', 'model.ts', 'WithdrawalParts.tsx'].map((name) => join(PAGE_DIR, name)),
      LIST_ROUTE,
      APPROVE_ROUTE,
      REJECT_ROUTE,
    ];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/\/\*|(^|[^:])\/\/(?!\/)/m.test(text), `${file} has a comment`);
      assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(text), `${file} has a literal colour`);
      assert.ok(!/z-?index/i.test(text), `${file} sets a stacking order`);
      assert.ok(!/style=\{\{/.test(text), `${file} has a static inline style`);
    }
    const css = readFileSync(join(PAGE_DIR, 'page.module.css'), 'utf8');
    assert.ok(!/\/\*/.test(css));
    assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|z-index/i.test(css));
  });
});
