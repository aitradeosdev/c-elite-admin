import { afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactNode } from 'react';
import { loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type {
  BroadcastRow, Outcome, OutcomeContext, RecipientCount, SendPlan, SendResult, UserHit,
} from '../app/(dashboard)/notifications-broadcast/model.ts';

type Rules = typeof import('../app/(dashboard)/notifications-broadcast/broadcastRules.ts');
type Model = typeof import('../app/(dashboard)/notifications-broadcast/model.ts');
type Options = typeof import('../app/(dashboard)/notifications-broadcast/confirmOptions.tsx');
type Parts = typeof import('../app/(dashboard)/notifications-broadcast/BroadcastParts.tsx');
type ApiClient = typeof import('../app/lib/apiClient.ts');
type Permissions = typeof import('../app/lib/permissions.ts');

let rules: Rules;
let model: Model;
let options: Options;
let parts: Parts;
let api: ApiClient;
let permissions: Permissions;
const realFetch = globalThis.fetch;

before(async () => {
  rules = await loadAppModule<Rules>('(dashboard)/notifications-broadcast/broadcastRules.ts');
  model = await loadAppModule<Model>('(dashboard)/notifications-broadcast/model.ts');
  options = await loadAppModule<Options>('(dashboard)/notifications-broadcast/confirmOptions.tsx');
  parts = await loadAppModule<Parts>('(dashboard)/notifications-broadcast/BroadcastParts.tsx');
  api = await loadAppModule<ApiClient>('lib/apiClient.ts');
  permissions = await loadAppModule<Permissions>('lib/permissions.ts');
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const OWNED_DIR = fileURLToPath(new URL('../app/(dashboard)/notifications-broadcast/', import.meta.url));
const BROADCAST_ROUTE = fileURLToPath(new URL('../app/api/notifications/broadcast/route.ts', import.meta.url));
const COUNT_ROUTE = fileURLToPath(new URL('../app/api/notifications/recipient-count/route.ts', import.meta.url));
const SEARCH_ROUTE = fileURLToPath(new URL('../app/api/notifications/user-search/route.ts', import.meta.url));

const USER_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const BROADCAST_ID = '0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6';
const REQUEST_ID = 'req_abc123def456';
const STAMP = '2026-10-03T09:15:00.000Z';

function hit(patch: Partial<UserHit> = {}): UserHit {
  return {
    id: USER_ID,
    fullName: 'Ada Obi',
    username: 'ada',
    email: 'ada@example.com',
    active: true,
    deleted: false,
    pushEnabled: true,
    ...patch,
  };
}

function counted(total: number, accounts = total): RecipientCount {
  return { total, accounts, anonymousDevices: total - accounts };
}

function plan(patch: Partial<SendPlan> = {}): SendPlan {
  return {
    audience: 'active_7d',
    type: 'general',
    title: 'Weekend boost',
    message: 'Rates are up this weekend.',
    user: null,
    recipients: counted(1234),
    globals: null,
    allowDuplicate: false,
    ...patch,
  };
}

function sendResult(patch: Partial<SendResult> = {}): SendResult {
  return {
    broadcastId: BROADCAST_ID,
    recipients: 1234,
    delivered: 900,
    failed: 4,
    anonymousRecipients: 0,
    anonymousDelivered: 0,
    anonymousFailed: 0,
    auditWarning: null,
    ...patch,
  };
}

function failure(patch: Partial<ApiFailure>): ApiResult<SendResult> {
  return {
    ok: false,
    error: {
      kind: 'http',
      status: 500,
      code: null,
      message: 'Server message',
      requestId: REQUEST_ID,
      details: null,
      outcomeUnknown: false,
      ...patch,
    },
  };
}

function context(patch: Partial<OutcomeContext> = {}): OutcomeContext {
  return {
    audience: 'active_7d',
    title: 'Weekend boost',
    message: 'Rates are up this weekend.',
    userId: null,
    userLabel: null,
    recipients: counted(1234),
    ...patch,
  };
}

function row(patch: Partial<BroadcastRow> = {}): BroadcastRow {
  return {
    id: BROADCAST_ID,
    title: 'Weekend boost',
    message: 'Rates are up this weekend, {first_name}.',
    type: 'promo',
    audience: 'active_7d',
    targetUserId: null,
    recipients: 1234,
    delivered: 900,
    failed: 4,
    sentAt: STAMP,
    ...patch,
  };
}

function html(node: ReactNode): string {
  return render(createElement('div', null, node));
}

function respond(status: number, body: unknown): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
}

function ownedSources(): string[] {
  return [
    ...readdirSync(OWNED_DIR).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => join(OWNED_DIR, name)),
    BROADCAST_ROUTE,
    COUNT_ROUTE,
    SEARCH_ROUTE,
  ];
}

describe('reading a broadcast request', () => {
  test('accepts the shape the web and mobile apps send and fills in the defaults', () => {
    const checked = rules.readBroadcastRequest({
      title: '  Hello  ',
      message: 'Rates are up.',
      audience: 'all',
      type: null,
      target_user_id: null,
    });
    assert.ok(checked.ok);
    if (!checked.ok) return;
    assert.deepEqual(checked.value, {
      title: 'Hello',
      message: 'Rates are up.',
      type: 'general',
      audience: 'all',
      target_user_id: null,
      allow_duplicate: false,
    });
  });

  test('strips bidirectional controls and normalises the text before checking it', () => {
    const checked = rules.readBroadcastRequest({
      title: `Pay \u202Eday\u202C`,
      message: '\uFB01ne print',
      audience: 'inactive',
    });
    assert.ok(checked.ok);
    if (!checked.ok) return;
    assert.equal(checked.value.title, 'Pay day');
    assert.equal(checked.value.message, 'fine print');
  });

  test('keeps the chosen user only for a one-user send, lower-cased', () => {
    const one = rules.readBroadcastRequest({
      title: 'Hi', message: 'There', audience: 'specific', target_user_id: USER_ID.toUpperCase(),
    });
    assert.ok(one.ok && one.value.target_user_id === USER_ID);
    const group = rules.readBroadcastRequest({
      title: 'Hi', message: 'There', audience: 'active_7d', target_user_id: USER_ID,
    });
    assert.ok(group.ok && group.value.target_user_id === null);
  });

  test('only an explicit true asks to skip the repeat-send check', () => {
    const yes = rules.readBroadcastRequest({ title: 'a', message: 'b', audience: 'all', allow_duplicate: true });
    const truthy = rules.readBroadcastRequest({ title: 'a', message: 'b', audience: 'all', allow_duplicate: 'true' });
    assert.ok(yes.ok && yes.value.allow_duplicate === true);
    assert.ok(truthy.ok && truthy.value.allow_duplicate === false);
  });

  test('refuses what the edge function would refuse, with a reason', () => {
    const cases: Array<[unknown, RegExp]> = [
      [null, /JSON object/],
      [[], /JSON object/],
      [{ message: 'b', audience: 'all' }, /all required/],
      [{ title: '   ', message: 'b', audience: 'all' }, /all required/],
      [{ title: 'a', message: 'b' }, /all required/],
      [{ title: 'a'.repeat(121), message: 'b', audience: 'all' }, /up to 120/],
      [{ title: 'a', message: 'b'.repeat(1001), audience: 'all' }, /up to 1000/],
      [{ title: 'a', message: 'b', audience: 'everyone' }, /audience is not recognised/],
      [{ title: 'a', message: 'b', audience: 'all', type: 'info' }, /category is not recognised/],
      [{ title: 'a', message: 'b', audience: 'all', type: '' }, /category is not recognised/],
      [{ title: 'a', message: 'b', audience: 'specific', target_user_id: 'not-a-uuid' }, /Choose the user/],
      [{ title: 'a', message: 'b', audience: 'specific' }, /Choose the user/],
    ];
    for (const [body, reason] of cases) {
      const checked = rules.readBroadcastRequest(body);
      assert.equal(checked.ok, false, JSON.stringify(body));
      if (!checked.ok) assert.match(checked.message, reason);
    }
  });

  test('accepts exactly the title and message limits', () => {
    const checked = rules.readBroadcastRequest({ title: 'a'.repeat(120), message: 'b'.repeat(1000), audience: 'all' });
    assert.ok(checked.ok);
  });

  test('the count route defaults to all users and rejects unknown audiences', () => {
    assert.deepEqual(rules.readAudienceParam(null), { ok: true, value: 'all' });
    assert.deepEqual(rules.readAudienceParam(''), { ok: true, value: 'all' });
    assert.deepEqual(rules.readAudienceParam('specific'), { ok: true, value: 'specific' });
    assert.equal(rules.readAudienceParam('everyone').ok, false);
  });
});

describe('who may do what', () => {
  test('sending to everyone needs send_all; every other audience needs send', () => {
    for (const audience of rules.AUDIENCES) {
      const expected = audience === 'all' || audience === 'all_anon' ? 'communications.send_all' : 'communications.send';
      assert.equal(rules.sendPermission(audience), expected, audience);
      assert.equal(rules.reachesEveryone(audience), expected === 'communications.send_all');
    }
    assert.match(rules.sendDeniedMessage('all'), /“Send to all users” permission/);
    assert.match(rules.sendDeniedMessage('specific'), /“Send to a segment” permission/);
  });

  test('the routes keep today’s rules, mapped to the catalog', () => {
    assert.equal(rules.READ_PERMISSION, 'communications.read');
    assert.deepEqual([...rules.SEND_PERMISSIONS], ['communications.send', 'communications.send_all']);
    assert.deepEqual([...rules.SEARCH_PERMISSIONS], ['communications.read', 'users.read']);
  });

  test('the legacy broadcast key grants every broadcast action but not user search on its own', () => {
    const legacy = permissions.resolvePermissions(['notifications_broadcast'], false);
    for (const key of ['communications.read', 'communications.write', 'communications.send', 'communications.send_all'] as const) {
      assert.ok(legacy.has(key), key);
    }
    assert.ok(!legacy.has('users.read'));
    const both = permissions.resolvePermissions(['notifications_broadcast', 'users'], false);
    assert.ok(rules.SEARCH_PERMISSIONS.every((key) => both.has(key)));
  });

  test('offers only the audiences the admin can send to', () => {
    assert.deepEqual(model.availableAudiences({ send: true, sendAll: true, search: true }), [
      'all', 'all_anon', 'active_7d', 'inactive', 'specific',
    ]);
    assert.deepEqual(model.availableAudiences({ send: true, sendAll: false, search: false }), ['active_7d', 'inactive']);
    assert.deepEqual(model.availableAudiences({ send: false, sendAll: true, search: true }), ['all', 'all_anon']);
    assert.deepEqual(model.availableAudiences({ send: false, sendAll: false, search: true }), []);
  });

  test('explains every audience it hides, by permission name', () => {
    assert.equal(model.audienceHelp({ send: true, sendAll: true, search: true }), undefined);
    assert.equal(
      model.audienceHelp({ send: true, sendAll: false, search: true }),
      'Sending to all users needs the “Send to all users” permission.',
    );
    assert.equal(
      model.audienceHelp({ send: true, sendAll: true, search: false }),
      'Sending to one user also needs the “View users” permission, to find them.',
    );
    assert.match(model.audienceHelp({ send: false, sendAll: true, search: true }) ?? '', /“Send to a segment” permission/);
  });
});

describe('the broadcast service reply', () => {
  test('a 2xx with success true is a send, with every count read', () => {
    const outcome = rules.classifyEdgeResponse(200, {
      success: true,
      broadcast_id: BROADCAST_ID,
      recipient_count: 10,
      delivered: 7,
      failed: 1,
      anonymous_recipient_count: 3,
      anonymous_delivered: 2,
      anonymous_failed: '1',
    });
    assert.deepEqual(outcome, {
      kind: 'sent',
      counts: {
        broadcastId: BROADCAST_ID,
        recipients: 10,
        delivered: 7,
        failed: 1,
        anonymousRecipients: 3,
        anonymousDelivered: 2,
        anonymousFailed: 1,
      },
    });
  });

  test('the zero-recipient reply, which omits most counts, still reads as a send', () => {
    const outcome = rules.classifyEdgeResponse(200, { success: true, broadcast_id: BROADCAST_ID, recipient_count: 0, delivered: 0 });
    assert.equal(outcome.kind, 'sent');
    if (outcome.kind === 'sent') assert.equal(outcome.counts.failed, 0);
  });

  test('anything that may already have reached users is unknown, never “not sent”', () => {
    const unknown: Array<[number, unknown]> = [
      [200, { ok: true }],
      [200, null],
      [500, { error: 'Something went wrong' }],
      [502, null],
      [504, null],
      [546, { error: 'WORKER_LIMIT' }],
      [302, null],
    ];
    for (const [status, body] of unknown) {
      assert.equal(rules.classifyEdgeResponse(status, body).kind, 'unknown', String(status));
    }
  });

  test('refusals that happen before any work are “not sent”', () => {
    const refused = rules.classifyEdgeResponse(400, { error: 'Invalid type' });
    assert.deepEqual(refused, { kind: 'not_sent', reason: 'refused', status: 400, detail: 'Invalid type' });
    for (const status of [401, 403, 404]) {
      const outcome = rules.classifyEdgeResponse(status, { error: 'Forbidden' });
      assert.equal(outcome.kind === 'not_sent' && outcome.reason, 'misconfigured', String(status));
    }
    const missing = rules.classifyEdgeResponse(500, { error: 'Server misconfigured: ADMIN_FUNCTION_SECRET missing' });
    assert.equal(missing.kind === 'not_sent' && missing.reason, 'misconfigured');
  });

  test('a timeout or dropped connection is unknown, with the stage named', () => {
    const timeout = rules.classifyEdgeFailure(new DOMException('The operation timed out.', 'TimeoutError'));
    assert.equal(timeout.kind === 'unknown' && timeout.stage, 'timeout');
    const aborted = rules.classifyEdgeFailure(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    assert.equal(aborted.kind === 'unknown' && aborted.stage, 'timeout');
    const network = rules.classifyEdgeFailure(new TypeError('fetch failed'));
    assert.equal(network.kind === 'unknown' && network.stage, 'network');
    assert.equal(rules.classifyEdgeFailure('weird').kind, 'unknown');
  });

  test('the messages never claim more than is known', () => {
    const refused = rules.edgeOutcomeMessage({ kind: 'not_sent', reason: 'refused', status: 400, detail: 'Invalid type.' });
    assert.equal(refused, 'The broadcast service refused this request (Invalid type), so nothing was sent.');
    assert.match(
      rules.edgeOutcomeMessage({ kind: 'not_sent', reason: 'misconfigured', status: 403, detail: '' }),
      /nothing was sent/,
    );
    for (const stage of ['timeout', 'network', 'upstream', 'unreadable'] as const) {
      const message = rules.edgeOutcomeMessage({ kind: 'unknown', stage, status: null, detail: '' });
      assert.match(message, /may|probably/, stage);
      assert.match(message, /history before you send it again/, stage);
      assert.doesNotMatch(message, /nothing was sent/i, stage);
    }
    assert.match(rules.edgeOutcomeMessage({ kind: 'unknown', stage: 'timeout', status: null, detail: '' }), /50 seconds/);
  });
});

describe('the repeat-send guard', () => {
  const base = { audience: 'all' as const, target_user_id: null, title: 'Hello', message: 'World' };

  test('the key is a stable SHA-256 of audience, user, title and message', async () => {
    const key = await rules.duplicateKey(base);
    assert.match(key, /^broadcast:[0-9a-f]{64}$/);
    assert.equal(await rules.duplicateKey({ ...base }), key);
    for (const patch of [{ audience: 'all_anon' as const }, { target_user_id: USER_ID }, { title: 'Hello!' }, { message: 'World.' }]) {
      assert.notEqual(await rules.duplicateKey({ ...base, ...patch }), key, JSON.stringify(patch));
    }
  });

  test('the category does not change the key, so a re-labelled repeat is still caught', async () => {
    const checked = rules.readBroadcastRequest({ ...base, type: 'promo' });
    const plain = rules.readBroadcastRequest({ ...base, type: 'system' });
    assert.ok(checked.ok && plain.ok);
    if (checked.ok && plain.ok) {
      assert.equal(await rules.duplicateKey(checked.value), await rules.duplicateKey(plain.value));
    }
  });

  test('the refusal says when the first one started, when it is known', () => {
    assert.match(rules.duplicateMessage(STAMP), /started at 10:15 WAT, less than 10 minutes ago/);
    assert.match(rules.duplicateMessage(null), /^An identical broadcast to this audience was started, less than 10 minutes ago/);
    assert.match(rules.duplicateMessage(null), /may still be delivering/);
  });
});

describe('variables', () => {
  test('splits text exactly where the edge function substitutes', () => {
    const parts = rules.splitTemplate('Hi {first_name}, withdraw from ₦{min_withdrawal}. {nope} {} {a\nb}');
    const tokens = parts.filter((part) => part.kind === 'variable').map((part) => part.kind === 'variable' ? part.token : '');
    assert.deepEqual(tokens, ['first_name', 'min_withdrawal', 'nope']);
    assert.equal(parts.map((part) => (part.kind === 'text' ? part.text : part.raw)).join(''), 'Hi {first_name}, withdraw from ₦{min_withdrawal}. {nope} {} {a\nb}');
  });

  test('flags unknown tokens once, including doubled braces the service would leave alone', () => {
    assert.deepEqual(rules.unknownVariables('{nope} and {nope}', '{{first_name}}'), ['{nope}', '{{first_name}']);
    assert.deepEqual(rules.unknownVariables('Hi {first_name}', '{app_version}'), []);
    assert.deepEqual(rules.unknownVariables('{constructor}'), ['{constructor}']);
  });

  test('lists the known variables used, in catalog order', () => {
    const used = rules.usedVariables('{balance} {first_name}', '{min_withdrawal} {first_name}').map((spec) => spec.token);
    assert.deepEqual(used, ['first_name', 'balance', 'min_withdrawal']);
  });

  test('formats app-setting amounts the way the edge function does', () => {
    assert.equal(rules.formatConfigAmount('1000'), '1,000');
    assert.equal(rules.formatConfigAmount('1000.6'), '1,001');
    assert.equal(rules.formatConfigAmount(2500), '2,500');
    assert.equal(rules.formatConfigAmount(''), '0');
    assert.equal(rules.formatConfigAmount('abc'), '0');
    assert.equal(rules.formatConfigAmount(null), '0');
  });

  test('substituted values lose control and direction characters and stop at 80 characters', () => {
    assert.equal(rules.sanitizeSubstitution('a\u0007b\u202Ec\u2066d'), 'abcd');
    assert.equal(rules.sanitizeSubstitution('x'.repeat(90)).length, 80);
    assert.equal(rules.sanitizeSubstitution(null), '');
  });

  test('builds every global value from app settings, defaulting like the service', () => {
    const values = rules.globalsFromConfig([
      { key: 'min_withdrawal_amount', value: '1000' },
      { key: 'max_withdrawal_amount', value: '500000' },
      { key: 'signup_bonus_amount', value: null },
      { key: 'app_current_version', value: '2.4.1' },
      { key: 'unrelated', value: '9' },
    ]);
    assert.deepEqual(values, {
      min_withdrawal: '1,000',
      max_withdrawal: '500,000',
      signup_bonus: '0',
      referral_bonus: '0',
      app_version: '2.4.1',
    });
    assert.deepEqual([...rules.CONFIG_KEYS], [
      'min_withdrawal_amount', 'max_withdrawal_amount', 'signup_bonus_amount', 'referral_referrer_bonus', 'app_current_version',
    ]);
  });
});

describe('reading API responses', () => {
  test('history rows keep the fields the mobile app reads, and bad rows are dropped', () => {
    const page = model.toHistoryPage({
      broadcasts: [
        {
          id: BROADCAST_ID, title: 'Hi', message: 'There', type: 'promo', audience: 'all', target_user_id: null,
          recipient_count: 10, delivered_count: '7', failed_count: 1, sent_at: STAMP, admin_id: USER_ID,
        },
        { title: 'no id' },
        'junk',
      ],
      variables: { min_withdrawal: '1,000', bad: 4 },
      pagination: { page: 2, page_size: 20, total: 31 },
    });
    assert.ok(page);
    if (!page) return;
    assert.equal(page.rows.length, 1);
    assert.deepEqual(page.rows[0], {
      id: BROADCAST_ID, title: 'Hi', message: 'There', type: 'promo', audience: 'all', targetUserId: null,
      recipients: 10, delivered: 7, failed: 1, sentAt: STAMP,
    });
    assert.equal(page.total, 31);
    assert.equal(page.page, 2);
    assert.deepEqual(page.globals, { min_withdrawal: '1,000' });
    assert.equal(model.toHistoryPage({ items: [] }), null);
  });

  test('history without pagination (the old shape) still counts its rows', () => {
    const page = model.toHistoryPage({ broadcasts: [{ id: BROADCAST_ID }] });
    assert.equal(page?.total, 1);
    assert.equal(page?.globals, null);
  });

  test('recipient counts accept the old single number and the new breakdown', () => {
    assert.deepEqual(model.toRecipientCount({ count: 12 }), { total: 12, accounts: 12, anonymousDevices: 0 });
    assert.deepEqual(model.toRecipientCount({ count: 15, accounts: 10, anonymous_devices: 5 }), {
      total: 15, accounts: 10, anonymousDevices: 5,
    });
    assert.equal(model.toRecipientCount({ count: 'many' }), null);
    assert.equal(model.toRecipientCount({}), null);
  });

  test('user hits carry the state that decides whether they can be chosen', () => {
    const hits = model.toUserHits({
      users: [
        { id: USER_ID, full_name: 'Ada Obi', username: 'ada', email: 'ada@example.com' },
        { id: BROADCAST_ID, full_name: null, username: null, email: 'x@example.com', is_active: false, deleted_at: STAMP, push_notifications_enabled: false },
        { full_name: 'no id' },
      ],
    });
    assert.ok(hits);
    if (!hits) return;
    assert.equal(hits.length, 2);
    assert.deepEqual(hits[0], hit());
    assert.deepEqual(
      { active: hits[1].active, deleted: hits[1].deleted, pushEnabled: hits[1].pushEnabled },
      { active: false, deleted: true, pushEnabled: false },
    );
    assert.equal(model.userName(hits[1]), 'x@example.com');
    assert.equal(model.userSummary(hit()), 'Ada Obi · @ada · ada@example.com');
    assert.equal(model.toUserHits({}), null);
  });

  test('a send result reads the counts and the audit warning', () => {
    const plain = model.toSendResult({ success: true, broadcast_id: BROADCAST_ID, recipient_count: 3, delivered: 2, failed: 1 });
    assert.equal(plain.recipients, 3);
    assert.equal(plain.auditWarning, null);
    const warned = model.toSendResult({ recipient_count: 3, audit_recorded: false });
    assert.match(warned.auditWarning ?? '', /audit log/);
  });
});

describe('classifying a send', () => {
  test('success carries the result and request ID', () => {
    const outcome = model.classifySend({ ok: true, data: sendResult(), status: 200, requestId: REQUEST_ID });
    assert.deepEqual(outcome, { kind: 'sent', result: sendResult(), requestId: REQUEST_ID });
  });

  test('a lost answer is unknown, with copy that matches what happened', () => {
    const cases: Array<[Partial<ApiFailure>, RegExp]> = [
      [{ kind: 'timeout', status: null, outcomeUnknown: true }, /did not answer within 65 seconds/],
      [{ kind: 'network', status: null, outcomeUnknown: true }, /connection dropped/],
      [{ kind: 'http', status: 504, outcomeUnknown: true }, /HTTP 504/],
      [{ kind: 'parse', status: 200, outcomeUnknown: true }, /could not be read/],
    ];
    for (const [patch, copy] of cases) {
      const outcome = model.classifySend(failure(patch));
      assert.equal(outcome.kind, 'unknown');
      if (outcome.kind === 'unknown') {
        assert.match(outcome.message, copy);
        assert.match(outcome.message, /may or may not/);
      }
    }
  });

  test('the server’s provider verdicts are kept apart', () => {
    const notSent = model.classifySend(failure({
      status: 502, code: 'PROVIDER_ERROR', message: 'Nothing was sent.', details: { outcome: 'not_sent' },
    }));
    assert.equal(notSent.kind, 'not_sent');
    const unknown = model.classifySend(failure({
      status: 504, code: 'PROVIDER_ERROR', message: 'May have gone out.', details: { outcome: 'unknown', stage: 'timeout' },
    }));
    assert.deepEqual(unknown, { kind: 'unknown', message: 'May have gone out.', requestId: REQUEST_ID });
  });

  test('a repeat is reported with when the first one started', () => {
    const outcome = model.classifySend(failure({
      status: 409, code: 'IDEMPOTENCY_CONFLICT', message: 'Identical.', details: { outcome: 'duplicate', first_sent_at: STAMP },
    }));
    assert.deepEqual(outcome, { kind: 'duplicate', message: 'Identical.', requestId: REQUEST_ID, firstSentAt: STAMP });
  });

  test('definite refusals close the dialog; only a safe failure offers Retry', () => {
    for (const status of [400, 403, 404, 409]) {
      assert.equal(model.classifySend(failure({ status, code: 'VALIDATION_ERROR' })).kind, 'refused', String(status));
    }
    assert.deepEqual(model.classifySend(failure({ status: 401, code: 'AUTH_REQUIRED' })), { kind: 'expired' });
    assert.equal(model.classifySend(failure({ status: 500, code: 'INTERNAL_ERROR' })).kind, 'retry');
    assert.equal(model.classifySend(failure({ status: 429, code: 'RATE_LIMITED' })).kind, 'retry');
    assert.equal(model.classifySend(failure({ kind: 'parse', status: null, message: 'Not sent' })).kind, 'retry');
  });

  test('through the real client: a route PROVIDER_ERROR body is not mistaken for a lost answer', async () => {
    respond(504, {
      success: false, error: 'Timed out.', code: 'PROVIDER_ERROR', message: 'Timed out.', request_id: REQUEST_ID,
      details: { outcome: 'unknown', stage: 'timeout', edge_status: null },
    });
    const outcome = model.classifySend(await api.apiRequest('/api/notifications/broadcast', {
      method: 'POST', body: {}, select: model.toSendResult,
    }));
    assert.deepEqual(outcome, { kind: 'unknown', message: 'Timed out.', requestId: REQUEST_ID });
  });

  test('through the real client: a bare gateway 504 is still unknown', async () => {
    globalThis.fetch = (async () => new Response('<html>Gateway timeout</html>', { status: 504 })) as typeof fetch;
    const outcome = model.classifySend(await api.apiRequest('/api/notifications/broadcast', {
      method: 'POST', body: {}, select: model.toSendResult,
    }));
    assert.equal(outcome.kind, 'unknown');
  });

  test('through the real client: a success body becomes a result', async () => {
    respond(200, { success: true, request_id: REQUEST_ID, broadcast_id: BROADCAST_ID, recipient_count: 5, delivered: 4, failed: 1 });
    const outcome = model.classifySend(await api.apiRequest('/api/notifications/broadcast', {
      method: 'POST', body: {}, select: model.toSendResult,
    }));
    assert.equal(outcome.kind, 'sent');
    if (outcome.kind === 'sent') assert.equal(outcome.result.recipients, 5);
  });
});

describe('the draft', () => {
  test('lists problems in the order the form shows them', () => {
    const errors = model.draftErrors({ ...model.EMPTY_DRAFT, audience: 'specific' });
    assert.deepEqual(Object.keys(errors).sort(), ['message', 'title', 'user']);
    assert.equal(model.firstError(errors), 'user');
    assert.equal(model.firstError(model.draftErrors(model.EMPTY_DRAFT)), 'audience');
    assert.deepEqual(
      model.draftErrors({ audience: 'specific', type: 'general', title: 'a', message: 'b', user: hit() }),
      {},
    );
    assert.match(model.draftErrors({ ...model.EMPTY_DRAFT, audience: 'all', title: '   ', message: 'x' }).title ?? '', /Add a title/);
  });

  test('is dirty once there is text or a chosen user, not for choices alone', () => {
    assert.equal(model.draftDirty({ ...model.EMPTY_DRAFT, audience: 'all', type: 'promo' }), false);
    assert.equal(model.draftDirty({ ...model.EMPTY_DRAFT, title: 'x' }), true);
    assert.equal(model.draftDirty({ ...model.EMPTY_DRAFT, user: hit() }), true);
  });

  test('matches a sent plan only when audience, cleaned text and user are unchanged', () => {
    const draft = { audience: 'specific' as const, type: 'general' as const, title: ' Hi ', message: 'There', user: hit() };
    assert.equal(model.sameDraft(draft, 'specific', 'Hi', 'There', USER_ID), true);
    assert.equal(model.sameDraft({ ...draft, message: 'There!' }, 'specific', 'Hi', 'There', USER_ID), false);
    assert.equal(model.sameDraft({ ...draft, user: null }, 'specific', 'Hi', 'There', USER_ID), false);
  });

  test('inserts a variable at the cursor, replacing a selection', () => {
    assert.deepEqual(model.insertVariable('Hi there', { start: 3, end: 3 }, 'first_name', 120), {
      text: 'Hi {first_name}there', caret: 15,
    });
    assert.deepEqual(model.insertVariable('Hi there', { start: 3, end: 8 }, 'first_name', 120), {
      text: 'Hi {first_name}', caret: 15,
    });
    assert.deepEqual(model.insertVariable('Hi', null, 'balance', 120), { text: 'Hi{balance}', caret: 11 });
    assert.deepEqual(model.insertVariable('Hi', { start: 40, end: -3 }, 'balance', 120), { text: 'Hi{balance}', caret: 11 });
    assert.equal(model.insertVariable('x'.repeat(115), null, 'balance', 120), null);
  });

  test('the send body matches the contract, with the user only for one-user sends', () => {
    assert.deepEqual(model.sendBody(plan()), {
      title: 'Weekend boost', message: 'Rates are up this weekend.', type: 'general', audience: 'active_7d', target_user_id: null,
    });
    assert.deepEqual(model.sendBody(plan({ audience: 'specific', user: hit(), allowDuplicate: true })), {
      title: 'Weekend boost',
      message: 'Rates are up this weekend.',
      type: 'general',
      audience: 'specific',
      target_user_id: USER_ID,
      allow_duplicate: true,
    });
    assert.equal(model.planContext(plan({ audience: 'specific', user: hit() })).userLabel, 'Ada Obi');
  });

  test('recipient wording names accounts and app-only devices', () => {
    assert.equal(model.recipientsText('active_7d', counted(1234)), '1,234 accounts');
    assert.equal(model.recipientsText('inactive', counted(1)), '1 account');
    assert.equal(model.recipientsText('all_anon', counted(1500, 1200)), '1,200 accounts and 300 app-only devices');
    assert.equal(model.recipientsText('specific', null), '1 user');
    assert.equal(model.recipientsText('all', null), '—');
  });

  test('leaving is only intercepted for a different page in this console', () => {
    const here = 'https://admin.example.com/notifications-broadcast';
    assert.equal(model.leavePath('/users', here), '/users');
    assert.equal(model.leavePath('/notifications-broadcast', here), null);
    assert.equal(model.leavePath('https://elsewhere.example.com/x', here), null);
  });
});

describe('the result shown after a send', () => {
  function sent(result: SendResult, patch: Partial<OutcomeContext> = {}): Outcome {
    return { kind: 'sent', result, requestId: REQUEST_ID, context: context(patch), at: Date.parse(STAMP) };
  }

  test('a clean send is a success with accounts and push counts', () => {
    const summary = model.outcomeSummary(sent(sendResult()));
    assert.equal(summary.tone, 'success');
    assert.equal(summary.title, 'Sent to 1,234 accounts');
    assert.ok(summary.lines.includes('In the app: 1,234 accounts.'));
    assert.ok(summary.lines.includes('Push: 900 accepted by the push service, 4 failed.'));
    assert.equal(model.outcomeToast(sent(sendResult())).tone, 'success');
  });

  test('fewer accounts than counted at confirm time is flagged', () => {
    const summary = model.outcomeSummary(sent(sendResult({ recipients: 1000 })));
    assert.equal(summary.tone, 'warning');
    assert.ok(summary.lines.some((line) => /1,234 accounts matched this audience, but the service reported 1,000/.test(line)));
    assert.equal(model.shortfall(counted(1234), sendResult({ recipients: 1300 })), 0);
  });

  test('app-only devices, an empty audience and a missing audit record are all reported', () => {
    const anon = model.outcomeSummary(sent(
      sendResult({ anonymousRecipients: 50, anonymousDelivered: 45, anonymousFailed: 5 }),
      { audience: 'all_anon', recipients: counted(1284, 1234) },
    ));
    assert.ok(anon.lines.some((line) => line.startsWith('App-only devices: 45 accepted and 5 failed, of 50.')));
    const empty = model.outcomeSummary(sent(sendResult({ recipients: 0, delivered: 0, failed: 0 }), { recipients: counted(0) }));
    assert.equal(empty.tone, 'warning');
    assert.ok(empty.lines.includes('Push: none sent.'));
    const unaudited = model.outcomeSummary(sent(sendResult({ auditWarning: 'Not in the audit log.' })));
    assert.equal(unaudited.tone, 'warning');
    assert.ok(unaudited.lines.includes('Not in the audit log.'));
  });

  test('a one-user send is titled with the user', () => {
    const summary = model.outcomeSummary(sent(sendResult({ recipients: 1, delivered: 1, failed: 0 }), {
      audience: 'specific', userId: USER_ID, userLabel: 'Ada Obi', recipients: counted(1),
    }));
    assert.equal(summary.title, 'Sent to Ada Obi');
  });

  test('failures keep the server’s words and their own tone', () => {
    const base = { requestId: REQUEST_ID, context: context(), at: Date.parse(STAMP) };
    const unknown = model.outcomeSummary({ kind: 'unknown', message: 'May have gone.', ...base });
    assert.equal(unknown.tone, 'danger');
    assert.match(unknown.title, /may have gone out/);
    assert.deepEqual(unknown.lines, ['May have gone.']);
    const duplicate = model.outcomeSummary({ kind: 'duplicate', message: 'Identical.', firstSentAt: null, ...base });
    assert.equal(duplicate.tone, 'warning');
    assert.equal(model.outcomeToast({ kind: 'duplicate', message: 'Identical.', firstSentAt: null, ...base }).tone, 'warning');
    const refused = model.outcomeSummary({ kind: 'refused', message: 'No.', status: 400, ...base });
    assert.equal(refused.title, 'Not sent');
    assert.equal(model.outcomeToast({ kind: 'not_sent', message: 'Nothing was sent.', ...base }).text, 'Nothing was sent.');
  });
});

describe('the confirmation', () => {
  function detailText(opts: ReturnType<Options['sendOptions']>, label: string): string {
    const detail = opts.details?.find((item) => item.label === label);
    return detail ? textOf(html(detail.value)) : '';
  }

  test('sending to everyone is a danger confirmation with the typed phrase and the live count', () => {
    const opts = options.sendOptions(plan({ audience: 'all', recipients: counted(12345) }));
    assert.equal(opts.tone, 'danger');
    assert.equal(opts.title, 'Send to every user?');
    assert.equal(opts.requireTyped, 'SEND TO ALL');
    assert.equal(opts.confirmLabel, 'Send to 12,345 recipients');
    assert.match(detailText(opts, 'Recipients'), /12,345 accounts/);
    assert.match(detailText(opts, 'Recipients'), /Counted just now/);
    assert.match(detailText(opts, 'Audience'), /All users/);
    assert.ok(opts.consequences?.includes('A sent broadcast cannot be recalled, edited or deleted.'));
    assert.ok(opts.pendingLabel && /up to a minute/.test(opts.pendingLabel));
  });

  test('every user and app-only devices requires the phrase too and warns about blank variables', () => {
    const opts = options.sendOptions(plan({
      audience: 'all_anon', recipients: counted(1300, 1200), title: 'Hi {first_name}',
    }));
    assert.equal(opts.requireTyped, 'SEND TO ALL');
    assert.match(detailText(opts, 'Recipients'), /1,200 accounts and 100 app-only devices/);
    assert.ok(opts.consequences?.some((line) => /left blank on app-only devices/.test(line)));
  });

  test('a segment send needs no phrase; a deliberate repeat does', () => {
    const segment = options.sendOptions(plan());
    assert.equal(segment.tone, 'default');
    assert.equal(segment.requireTyped, undefined);
    const repeat = options.sendOptions(plan({ allowDuplicate: true }));
    assert.equal(repeat.title, 'Send this broadcast again?');
    assert.equal(repeat.requireTyped, 'SEND AGAIN');
    assert.ok(repeat.consequences?.some((line) => /receives it again/.test(line)));
  });

  test('a one-user send names the user and their push setting', () => {
    const opts = options.sendOptions(plan({
      audience: 'specific', user: hit({ pushEnabled: false, active: false }), recipients: counted(1),
    }));
    assert.equal(opts.title, 'Send to this user?');
    assert.equal(opts.confirmLabel, 'Send to this user');
    assert.equal(detailText(opts, 'User'), 'Ada Obi · @ada · ada@example.com');
    assert.equal(detailText(opts, 'Push'), 'Off, in-app only');
    assert.equal(detailText(opts, 'Recipients'), '1 user');
    assert.ok(opts.consequences?.some((line) => /Push is turned off/.test(line)));
    assert.ok(opts.consequences?.some((line) => /marked inactive/.test(line)));
  });

  test('shows the title and body as users will see them, with app settings filled in', () => {
    const opts = options.sendOptions(plan({
      title: 'Withdraw from ₦{min_withdrawal}',
      message: 'Hi {first_name}, see {nope}.',
      globals: { min_withdrawal: '1,000' },
    }));
    const text = textOf(html(opts.message));
    assert.match(text, /Withdraw from ₦ ?1,000/);
    assert.match(text, /First name/);
    assert.match(text, /\{nope\}/);
    assert.match(text, /personal variables filled in/);
    assert.ok(opts.consequences?.some((line) => line.startsWith('{nope} is not a variable')));
  });

  test('leave and discard dialogs say nothing was sent', () => {
    assert.match(String(options.leaveOptions().message), /has not been sent/);
    assert.equal(options.leaveOptions().tone, 'danger');
    assert.match(String(options.discardOptions().message), /Nothing has been sent/);
  });
});

describe('rendered parts', () => {
  test('the preview marks personal variables, fills app settings and shows placeholders when empty', () => {
    const filled = textOf(render(createElement(parts.NotificationPreview, {
      title: 'Hi {first_name}',
      message: 'Min {min_withdrawal}',
      globals: { min_withdrawal: '1,000' },
    })));
    assert.match(filled, /Hi First name/);
    assert.match(filled, /Min 1,000/);
    const empty = textOf(render(createElement(parts.NotificationPreview, { title: '', message: ' ', globals: null })));
    assert.match(empty, /Your title appears here/);
    assert.match(empty, /Your message appears here/);
  });

  test('the variable picker offers every variable with a spoken name', () => {
    const markup = render(createElement(parts.VariablePicker, {
      globals: { min_withdrawal: '1,000' }, target: 'title', onInsert: () => {},
    }));
    const buttons = tagsOf(markup, 'button');
    assert.equal(buttons.length, rules.USER_VARIABLES.length + rules.CONFIG_VARIABLES.length);
    assert.ok(buttons.some((attrs) => attrs['aria-label'] === 'Insert First name'));
    assert.match(textOf(markup), /Minimum withdrawal, with no ₦ sign\. Now 1,000\./);
    assert.match(textOf(markup), /in the title/);
  });

  test('the user picker asks for three characters before searching', () => {
    const markup = render(createElement(parts.UserPicker, {
      selected: null, onSelect: () => {}, onClear: () => {}, inputRef: { current: null },
    }));
    assert.match(textOf(markup), /Type at least 3 characters/);
    assert.ok(tagsOf(markup, 'input').some((attrs) => attrs['aria-label'] === 'Find the user to send to'));
  });

  test('a chosen user shows who it is and warns about inactive accounts and push', () => {
    const markup = render(createElement(parts.UserPicker, {
      selected: hit({ active: false, pushEnabled: false }), onSelect: () => {}, onClear: () => {}, inputRef: { current: null },
    }));
    const text = textOf(markup);
    assert.match(text, /Ada Obi/);
    assert.match(text, /@ada · ada@example.com/);
    assert.match(text, /Change/);
    assert.match(text, /marked inactive/);
    assert.match(text, /Push is turned off/);
  });

  test('the history table lists counts, audience and category, and opens rows by button', () => {
    const markup = render(createElement(parts.HistoryTable, {
      rows: [row({ failed: 4 })],
      loading: false,
      busy: false,
      error: null,
      retrying: false,
      openId: null,
      onRetry: () => {},
      onOpen: () => {},
    }));
    const text = textOf(markup);
    assert.match(text, /Weekend boost/);
    assert.match(text, /Active in the last 7 days/);
    assert.match(text, /Promotion/);
    assert.match(text, /1,234/);
    assert.ok(tagsOf(markup, 'button').some((attrs) => attrs['data-row-open'] === BROADCAST_ID));
    assert.ok(tagsOf(markup, 'table').some((attrs) => attrs['aria-label'] === 'Broadcast history'));
  });

  test('the history table shows an empty state and a blocking error', () => {
    const base = { rows: [], loading: false, busy: false, retrying: false, openId: null, onRetry: () => {}, onOpen: () => {} };
    assert.match(textOf(render(createElement(parts.HistoryTable, { ...base, error: null }))), /No broadcasts yet/);
    const failed = render(createElement(parts.HistoryTable, {
      ...base,
      error: { kind: 'http', status: 500, code: 'INTERNAL_ERROR', message: 'Down.', requestId: null, details: null, outcomeUnknown: false },
    }));
    assert.match(textOf(failed), /could not be loaded/);
  });

  test('the result notice lists every line and the broadcast reference', () => {
    const markup = render(createElement(parts.OutcomeNotice, {
      outcome: { kind: 'sent', result: sendResult({ recipients: 1000 }), requestId: REQUEST_ID, context: context(), at: Date.parse(STAMP) },
      onDismiss: () => {},
    }));
    const text = textOf(markup);
    assert.match(text, /Sent to 1,000 accounts/);
    assert.match(text, /service reported 1,000/);
    assert.match(text, /Weekend boost/);
    assert.ok(tagsOf(markup, 'button').some((attrs) => attrs['aria-label'] === 'Dismiss this result'));
  });

  test('the history detail links to the user only for admins who can open users', () => {
    const withLink = render(createElement(parts.HistoryDetail, {
      row: row({ audience: 'specific', targetUserId: USER_ID }), canOpenUser: true,
    }));
    assert.ok(tagsOf(withLink, 'a').some((attrs) => attrs.href === `/users/${USER_ID}`));
    const withoutLink = render(createElement(parts.HistoryDetail, {
      row: row({ audience: 'specific', targetUserId: USER_ID }), canOpenUser: false,
    }));
    assert.ok(!tagsOf(withoutLink, 'a').some((attrs) => attrs.href === `/users/${USER_ID}`));
    assert.match(textOf(withoutLink), /Variables were filled in when it was sent/);
  });
});

describe('routes and hard rules', () => {
  test('each route uses the guard with exactly its permission and the additive envelope', () => {
    const broadcast = readFileSync(BROADCAST_ROUTE, 'utf8');
    assert.match(broadcast, /requireAdmin\(READ_PERMISSION\)/);
    assert.match(broadcast, /requireAdminAny\(SEND_PERMISSIONS\)/);
    assert.match(broadcast, /admin\.can\(permission\)/);
    assert.match(broadcast, /sendPermission\(request\.audience\)/);
    assert.match(broadcast, /writeAudit\(/);
    assert.match(broadcast, /broadcasts: history\.data/);
    assert.match(broadcast, /recipient_count: counts\.recipients/);
    assert.match(broadcast, /check_rate_limit_by_key/);
    assert.match(broadcast, /AbortSignal\.timeout\(EDGE_TIMEOUT_MS\)/);
    const count = readFileSync(COUNT_ROUTE, 'utf8');
    assert.match(count, /requireAdmin\(READ_PERMISSION\)/);
    assert.match(count, /count: accountCount \+ anonymousCount/);
    assert.match(count, /count: 1/);
    const search = readFileSync(SEARCH_ROUTE, 'utf8');
    assert.match(search, /requireAdminAll\(SEARCH_PERMISSIONS\)/);
    assert.match(search, /sanitizeSearch/);
    assert.match(search, /id, full_name, username, email/);
    assert.match(search, /users: data/);
    for (const source of [broadcast, count, search]) {
      assert.doesNotMatch(source, /NextResponse\.json|verifyAdminFromRequest|page_permissions/);
      assert.match(source, /from '\.\.\/\.\.\/\.\.\/\(dashboard\)\/notifications-broadcast\/broadcastRules'/);
    }
  });

  test('no prose comments, literal colours, stacking numbers or static inline styles', () => {
    for (const file of ownedSources()) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/\/\*|(^|[^:])\/\/(?!\/)/m.test(text), `${file} has a comment`);
      assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(text), `${file} has a literal colour`);
      assert.ok(!/z-?index/i.test(text), `${file} sets a stacking order`);
      assert.ok(!/style=\{\{/.test(text), `${file} has a static inline style`);
    }
    const css = readFileSync(join(OWNED_DIR, 'page.module.css'), 'utf8');
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
    for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      assert.doesNotMatch(value, colour, `${property}: ${value}`);
      assert.notEqual(property, 'z-index');
    }
    assert.doesNotMatch(css, /\/\*/);
  });

  test('invisible and direction characters are written as escapes', () => {
    const hidden = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
    for (const file of [...ownedSources(), fileURLToPath(import.meta.url)]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), hidden, file);
    }
  });

  test('the private mobile list and the window-size hook are gone', () => {
    const page = readFileSync(join(OWNED_DIR, 'page.tsx'), 'utf8');
    assert.ok(page.startsWith("'use client';"));
    assert.doesNotMatch(page, /BroadcastsMobile|useIsMobile|toLocaleString\(\)/);
    assert.match(page, /ResponsiveView/);
    assert.match(page, /useLeaveGuard\(dirty/);
  });
});
