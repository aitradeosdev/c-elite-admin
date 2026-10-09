import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ElementType } from 'react';
import { loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiBody, ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type { DetailResult } from '../app/(dashboard)/flagged-transactions/model.ts';

type ModelModule = typeof import('../app/(dashboard)/flagged-transactions/model.ts');
type UrlModule = typeof import('../app/(dashboard)/flagged-transactions/flagsUrl.ts');

interface MetricSpecLike {
  statKey: string;
  perm: string;
  href: string;
}

const PAGE_DIR = fileURLToPath(new URL('../app/(dashboard)/flagged-transactions/', import.meta.url));
const ROUTE = fileURLToPath(new URL('../app/api/flagged-transactions/route.ts', import.meta.url));

const FLAG_ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const OTHER_FLAG_ID = '4a3b2c1d-6e5f-4a07-9b8a-1d0c2e3f4a5b';
const WITHDRAWAL_ID = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';
const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ADMIN_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const ACCOUNT = '0123456789';

let model: ModelModule;
let urls: UrlModule;
let parts: Record<string, ElementType>;
let metrics: { ACTION_METRICS: readonly MetricSpecLike[] };

before(async () => {
  model = await loadAppModule<ModelModule>('(dashboard)/flagged-transactions/model.ts');
  urls = await loadAppModule<UrlModule>('(dashboard)/flagged-transactions/flagsUrl.ts');
  parts = await loadAppModule<Record<string, ElementType>>('(dashboard)/flagged-transactions/FlagParts.tsx');
  metrics = await loadAppModule<{ ACTION_METRICS: readonly MetricSpecLike[] }>('(dashboard)/dashboard/metrics.tsx');
});

function flagBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FLAG_ID,
    user_id: USER_ID,
    transaction_id: WITHDRAWAL_ID,
    transaction_type: 'withdrawal',
    amount: 750000,
    flag_reason: 'Large withdrawal (>= N500000)',
    status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-10-08T09:30:00.000Z',
    users: {
      id: USER_ID,
      username: 'ada',
      full_name: 'Ada Obi',
      email: 'ada@example.com',
      is_frozen: false,
      freeze_reason: null,
    },
    ...patch,
  };
}

function withdrawalBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: WITHDRAWAL_ID,
    status: 'pending_review',
    amount: 750000,
    fee: 100,
    bank_name: 'Access Bank',
    account_number: '•••• 6789',
    account_name: 'Ada Obi',
    gateway: 'paystack',
    failure_reason: null,
    created_at: '2026-10-08T09:29:00.000Z',
    ...patch,
  };
}

function detailBody(patch: Record<string, unknown> = {}): ApiBody {
  return {
    success: true,
    flag: flagBody(),
    reviewer: null,
    withdrawal: withdrawalBody(),
    transaction: null,
    other_flags: [],
    partial: { reviewer: null, related: null, other_flags: null },
    ...patch,
  };
}

function detailOf(patch: Record<string, unknown> = {}): DetailResult {
  const detail = model.toDetail(detailBody(patch));
  assert.ok(detail, 'expected a readable detail body');
  return detail;
}

function failure(patch: Partial<ApiFailure>): ApiResult<ApiBody> {
  return {
    ok: false,
    error: {
      kind: 'http',
      status: 500,
      code: null,
      message: 'The server could not complete this request.',
      requestId: null,
      details: null,
      outcomeUnknown: false,
      ...patch,
    },
  };
}

function bodyHtml(detail: DetailResult, can: { resolve?: boolean; users?: boolean; withdrawals?: boolean } = {}): string {
  return render(createElement(parts.FlagDetailBody, {
    detail,
    canResolve: can.resolve ?? true,
    canUsers: can.users ?? true,
    canWithdrawals: can.withdrawals ?? true,
  }));
}

function linksOf(html: string): string[] {
  return tagsOf(html, 'a').map((attrs) => attrs.href ?? '');
}

function buttonLabels(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((match) => textOf(match[1]));
}

function sliceBetween(source: string, start: string, end?: string): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  return source.slice(from, to < 0 ? source.length : to);
}

describe('status and type filters', () => {
  test('the mobile app’s filters keep working, including its "pending" chip', () => {
    assert.deepEqual(model.parseStatusFilter(null), []);
    assert.deepEqual(model.parseStatusFilter(''), []);
    assert.deepEqual(model.parseStatusFilter('pending'), ['pending_review']);
    assert.deepEqual(model.parseStatusFilter('escalated'), ['escalated']);
    assert.deepEqual(model.parseStatusFilter('cleared'), ['cleared']);
    assert.deepEqual(model.parseStatusFilter('rejected'), ['rejected']);
  });

  test('the web tabs ask for lists, the open alias and all', () => {
    assert.deepEqual(model.parseStatusFilter('open'), ['pending_review', 'escalated']);
    assert.deepEqual(model.parseStatusFilter('escalated,pending_review'), ['pending_review', 'escalated']);
    assert.deepEqual(model.parseStatusFilter(' Cleared , rejected '), ['cleared', 'rejected']);
    assert.deepEqual(model.parseStatusFilter('all'), []);
  });

  test('anything else is refused rather than silently widened', () => {
    for (const raw of ['held', 'constructor', '__proto__', 'toString', ',', 'cleared,bogus', 'all,cleared']) {
      assert.equal(model.parseStatusFilter(raw), null, raw);
    }
  });

  test('the type filter accepts data tokens only', () => {
    assert.equal(model.parseTypeFilter(''), '');
    assert.equal(model.parseTypeFilter('all'), '');
    assert.equal(model.parseTypeFilter(' Withdrawal '), 'withdrawal');
    assert.equal(model.parseTypeFilter('card sell'), null);
    assert.equal(model.parseTypeFilter('x'.repeat(41)), null);
    assert.equal(model.typeParam('bad type'), '');
    assert.equal(model.typeParam('giftcard_credit'), 'giftcard_credit');
  });

  test('type options list the data’s types plus the one in the link', () => {
    assert.deepEqual(model.typeOptions(['withdrawal'], ''), ['withdrawal']);
    assert.deepEqual(model.typeOptions(null, 'giftcard_credit'), ['giftcard_credit']);
    assert.deepEqual(model.typeOptions(['withdrawal', 'Bad Type'], 'airtime'), ['airtime', 'withdrawal']);
  });

  test('sort keys fall back to newest first', () => {
    assert.equal(model.parseSortKey('amount'), 'amount');
    assert.equal(model.parseSortKey('created_at'), 'created_at');
    assert.equal(model.parseSortKey('flag_reason'), 'created_at');
    assert.equal(model.parseSortKey(null), 'created_at');
  });
});

describe('search', () => {
  test('a full id matches the flag, the flagged transaction or the user', () => {
    const plan = model.planFlagSearch(WITHDRAWAL_ID.toUpperCase());
    assert.deepEqual(plan, { kind: 'id', id: WITHDRAWAL_ID });
    assert.equal(
      model.flagSearchClause(plan, []),
      `id.eq.${WITHDRAWAL_ID},transaction_id.eq.${WITHDRAWAL_ID},user_id.eq.${WITHDRAWAL_ID}`,
    );
  });

  test('text resolves users by name, username or email and keeps a transaction id prefix', () => {
    assert.deepEqual(model.planFlagSearch('@ada'), { kind: 'text', userTerm: 'ada', fragment: null });
    assert.deepEqual(model.planFlagSearch('6f1c2d3e'), { kind: 'text', userTerm: '6f1c2d3e', fragment: '6f1c2d3e' });
    assert.equal(
      model.userMatchClause('ada'),
      'full_name.ilike.%ada%,username.ilike.%ada%,email.ilike.%ada%',
    );
    const plan = model.planFlagSearch('6f1c2d3e');
    assert.equal(
      model.flagSearchClause(plan, [USER_ID.toUpperCase(), 'not-a-user']),
      `user_id.in.(${USER_ID}),transaction_id.ilike.6f1c2d3e%`,
    );
  });

  test('a search that finds nobody matches nothing instead of everything', () => {
    assert.equal(model.flagSearchClause(model.planFlagSearch('nobody'), []), null);
    assert.deepEqual(model.planFlagSearch('   '), { kind: 'none' });
    assert.equal(model.flagSearchClause({ kind: 'none' }, []), null);
  });

  test('filter syntax is stripped before it reaches the database', () => {
    const plan = model.planFlagSearch('ada),id.eq.1,(x');
    assert.equal(plan.kind, 'text');
    if (plan.kind !== 'text') return;
    assert.doesNotMatch(plan.userTerm, /[(),]/);
  });

  test('user matches are capped at the first hundred', () => {
    const ids = Array.from({ length: 150 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    const clause = model.flagSearchClause(model.planFlagSearch('ada'), ids) ?? '';
    assert.equal(clause.split(',').length, 100);
  });
});

describe('list query and URL state', () => {
  const view = {
    tab: 'open' as const,
    search: '',
    type: '',
    range: { from: null, to: null },
    sort: { key: 'created_at', dir: 'desc' as const },
    page: 1,
  };

  test('the default Open tab asks for pending review and escalated flags, newest first', () => {
    const params = new URLSearchParams(model.listQuery(view));
    assert.equal(params.get('status'), 'pending_review,escalated');
    assert.equal(params.get('sort'), 'created_at');
    assert.equal(params.get('dir'), 'desc');
    assert.equal(params.get('page'), '1');
    assert.equal(params.get('page_size'), '50');
    assert.equal(params.has('search'), false);
  });

  test('every tab maps to the statuses it names, and All sends none', () => {
    const statusOf = (tab: string) => new URLSearchParams(model.listQuery({ ...view, tab: tab as never })).get('status');
    assert.equal(statusOf('pending_review'), 'pending_review');
    assert.equal(statusOf('escalated'), 'escalated');
    assert.equal(statusOf('cleared'), 'cleared');
    assert.equal(statusOf('rejected'), 'rejected');
    assert.equal(statusOf('all'), null);
    assert.deepEqual(model.TABS.map((tab) => tab.label), ['Open', 'Pending review', 'Escalated', 'Cleared', 'Rejected', 'All']);
  });

  test('search, type, Lagos dates, sort and page pass through', () => {
    const params = new URLSearchParams(model.listQuery({
      ...view,
      search: ' ada ',
      type: 'withdrawal',
      range: { from: '2026-10-01', to: '2026-10-08' },
      sort: { key: 'amount', dir: 'asc' },
      page: 3,
    }));
    assert.equal(params.get('search'), 'ada');
    assert.equal(params.get('type'), 'withdrawal');
    assert.equal(params.get('date_from'), '2026-10-01');
    assert.equal(params.get('date_to'), '2026-10-08');
    assert.equal(params.get('sort'), 'amount');
    assert.equal(params.get('dir'), 'asc');
    assert.equal(params.get('page'), '3');
  });

  test('rows are kept while filters change but not across tabs', () => {
    const open = model.listQuery(view);
    assert.equal(model.sameStatusScope(open, model.listQuery({ ...view, search: 'ada', page: 2 })), true);
    assert.equal(model.sameStatusScope(open, model.listQuery({ ...view, tab: 'cleared' })), false);
  });

  test('a bare link opens the Open tab, and ?id= opens one flag in the drawer', () => {
    const empty = urls.FLAGS_URL.parse(new URLSearchParams());
    assert.deepEqual(empty, {
      tab: 'open',
      search: '',
      type: '',
      range: { from: null, to: null },
      sort: { key: 'created_at', dir: 'desc' },
      page: 1,
      id: null,
    });
    const linked = urls.FLAGS_URL.parse(new URLSearchParams(`id=${FLAG_ID.toUpperCase()}`));
    assert.equal(linked.id, FLAG_ID);
    assert.equal(urls.FLAGS_URL.parse(new URLSearchParams('id=nope')).id, null);
  });

  test('unknown tab, type, sort and page values fall back to the defaults', () => {
    const parsed = urls.FLAGS_URL.parse(new URLSearchParams('tab=held&type=Bad%20Type&sort=reason&page=0'));
    assert.equal(parsed.tab, 'open');
    assert.equal(parsed.type, '');
    assert.deepEqual(parsed.sort, { key: 'created_at', dir: 'desc' });
    assert.equal(parsed.page, 1);
    const sorted = urls.FLAGS_URL.parse(new URLSearchParams('tab=escalated&sort=amount&dir=asc&type=withdrawal'));
    assert.equal(sorted.tab, 'escalated');
    assert.equal(sorted.type, 'withdrawal');
    assert.deepEqual(sorted.sort, { key: 'amount', dir: 'asc' });
  });

  test('defaults write nothing to the address bar', () => {
    const values = urls.FLAGS_URL.serialize(urls.FLAGS_URL.parse(new URLSearchParams()));
    assert.ok(Object.values(values).every((value) => value === null), JSON.stringify(values));
    assert.equal(urls.searchKey('  ada  '), 'ada');
  });
});

describe('list responses', () => {
  test('a body without a flagged array is unreadable, not an empty queue', () => {
    assert.equal(model.toListResult({ success: true }), null);
    assert.equal(model.toListResult({ flagged: 'nope' }), null);
  });

  test('rows, the users embed, per-status counts, types and the open count are mapped', () => {
    const result = model.toListResult({
      flagged: [flagBody(), flagBody({ id: OTHER_FLAG_ID, users: [{ username: 'obi' }] }), { id: '' }, null],
      total: 2,
      open_count: 7,
      counts: { pending_review: 5, escalated: 2, cleared: 40, rejected: 'x' },
      types: ['withdrawal', 'withdrawal', 'Bad Type', 3],
      search_capped: true,
    });
    assert.ok(result);
    assert.equal(result.flags.length, 2);
    assert.equal(result.flags[0].user?.username, 'ada');
    assert.equal(result.flags[1].user?.username, 'obi');
    assert.equal(result.total, 2);
    assert.equal(result.openCount, 7);
    assert.deepEqual(result.counts, { pending_review: 5, escalated: 2, cleared: 40, rejected: null });
    assert.deepEqual(result.types, ['withdrawal']);
    assert.equal(result.searchCapped, true);
  });

  test('an older body without the new keys still reads, using the pagination total', () => {
    const result = model.toListResult({ flagged: [flagBody()], open_count: null, pagination: { total: 12 } });
    assert.ok(result);
    assert.equal(result.total, 12);
    assert.equal(result.counts, null);
    assert.equal(result.types, null);
    assert.equal(result.openCount, null);
  });

  test('tab counts add up the statuses each tab shows', () => {
    const counts = { pending_review: 5, escalated: 2, cleared: 40, rejected: 3 };
    assert.equal(model.tabCount('open', counts), 7);
    assert.equal(model.tabCount('escalated', counts), 2);
    assert.equal(model.tabCount('all', counts), 50);
    assert.equal(model.tabCount('open', { ...counts, escalated: null }), null);
    assert.equal(model.tabCount('cleared', { ...counts, escalated: null }), 40);
    assert.equal(model.tabCount('all', null), null);
  });
});

describe('detail responses and masking', () => {
  test('a detail body without a flag is unreadable', () => {
    assert.equal(model.toDetail({ success: true }), null);
    assert.equal(model.toDetail({ flag: { status: 'pending_review' } }), null);
  });

  test('the flag, reviewer, withdrawal summary, other flags and partial notes are mapped', () => {
    const detail = detailOf({
      flag: flagBody({ status: 'cleared', reviewed_by: ADMIN_ID, reviewed_at: '2026-10-08T10:00:00.000Z' }),
      reviewer: { id: ADMIN_ID, username: 'evelyn' },
      other_flags: [{ id: OTHER_FLAG_ID, flag_reason: 'Dormant account', status: 'pending_review' }, { status: 'x' }],
      partial: { reviewer: null, related: null, other_flags: '  ' },
    });
    assert.equal(detail.flag.user?.is_frozen, false);
    assert.deepEqual(detail.reviewer, { id: ADMIN_ID, username: 'evelyn' });
    assert.equal(detail.withdrawal?.status, 'pending_review');
    assert.equal(detail.otherFlags.length, 1);
    assert.equal(detail.partial.otherFlags, null);
  });

  test('a whole account number is masked even if a server sends it unmasked', () => {
    const detail = detailOf({ withdrawal: withdrawalBody({ account_number: ACCOUNT }) });
    assert.equal(detail.withdrawal?.account_number, '•••• 6789');
  });

  test('the server presenter never returns a whole account number', () => {
    const summary = model.presentWithdrawal(withdrawalBody({ account_number: ACCOUNT }));
    assert.equal(summary.account_number, '•••• 6789');
    assert.equal(JSON.stringify(summary).includes(ACCOUNT), false);
    assert.equal(model.presentWithdrawal(withdrawalBody({ account_number: '1234' })).account_number, '••••');
    assert.equal(model.presentWithdrawal(withdrawalBody({ account_number: null })).account_number, null);
  });

  test('another transaction’s metadata is masked and secrets are redacted', () => {
    const summary = model.presentTransaction({
      id: OTHER_FLAG_ID,
      type: 'electricity',
      amount: 5000,
      status: 'success',
      reference_id: 'bill-1',
      created_at: '2026-10-08T09:00:00.000Z',
      metadata: { account_number: ACCOUNT, electricity_token: '1234-5678-9012-3456', pin: '1234', meter: 'prepaid' },
    });
    const text = JSON.stringify(summary);
    assert.equal(text.includes(ACCOUNT), false);
    assert.equal(text.includes('1234-5678-9012-3456'), false);
    assert.equal((summary.metadata as Record<string, unknown>).pin, '[redacted]');
    assert.equal((summary.metadata as Record<string, unknown>).meter, 'prepaid');
  });

  test('the withdrawal link needs a withdrawal flag with a real id', () => {
    assert.equal(model.withdrawalHref({ transaction_type: 'withdrawal', transaction_id: WITHDRAWAL_ID.toUpperCase() }),
      `/withdrawals?id=${WITHDRAWAL_ID}`);
    assert.equal(model.withdrawalHref({ transaction_type: 'withdrawal', transaction_id: 'ref-1' }), null);
    assert.equal(model.withdrawalHref({ transaction_type: 'airtime', transaction_id: WITHDRAWAL_ID }), null);
  });

  test('user labels fall back from username to name to email', () => {
    const user = model.toDetail(detailBody())?.flag.user ?? null;
    assert.equal(model.userHandle(user), '@ada');
    assert.equal(model.userSummary(user), 'Ada Obi (@ada)');
    assert.equal(model.userSubline(user), 'Ada Obi');
    assert.equal(model.userHandle(null, USER_ID), 'Unknown user');
    assert.equal(model.userHandle(null, null), 'No user');
  });
});

describe('review actions', () => {
  test('pending flags can be cleared, escalated or rejected; escalated flags cannot be escalated again', () => {
    assert.deepEqual(model.actionsFor('pending_review'), ['clear', 'escalate', 'reject']);
    assert.deepEqual(model.actionsFor('escalated'), ['clear', 'reject']);
    for (const status of ['cleared', 'rejected', '', null]) assert.deepEqual(model.actionsFor(status), [], String(status));
  });

  test('every confirmation says plainly that only the review is recorded', () => {
    for (const action of model.ACTION_ORDER) {
      const message = model.actionMessage(action);
      assert.match(message, /only records the review/);
      assert.match(message, /never approves, pays, holds or refunds anything/);
      assert.equal(model.FLAG_ACTIONS[action].presets.length > 0, true);
    }
  });

  test('confirmations spell out what happens to a withdrawal still awaiting a decision', () => {
    const detail = detailOf();
    const [clearResult, clearWithdrawal] = model.actionConsequences('clear', detail);
    assert.match(clearResult, /moves to Cleared/);
    assert.match(clearWithdrawal, /stays pending review\. Clearing the flag does not approve or pay it/);
    assert.match(clearWithdrawal, /approve the withdrawal on the Withdrawals page/);
    assert.match(model.actionConsequences('escalate', detail)[1], /does not hold or pause it/);
    assert.match(model.actionConsequences('reject', detail)[1], /does not reject or refund it/);
    assert.match(model.actionConsequences('reject', detail)[1], /reject the withdrawal on the Withdrawals page/);
  });

  test('settled, missing and non-withdrawal records are described without promising a change', () => {
    const settled = detailOf({ withdrawal: withdrawalBody({ status: 'success' }) });
    assert.match(model.actionConsequences('clear', settled)[1], /stays success\. Resolving this flag does not change, reverse or refund it/);
    const missing = detailOf({ withdrawal: null, partial: { related: 'The withdrawal could not be loaded.' } });
    assert.match(model.actionConsequences('reject', missing)[1], /could not be checked/);
    const other = detailOf({ flag: flagBody({ transaction_type: 'airtime' }), withdrawal: null });
    assert.match(model.actionConsequences('clear', other)[1], /No money moves/);
  });

  test('other open flags on the same withdrawal are called out', () => {
    const one = detailOf({ other_flags: [{ id: OTHER_FLAG_ID, flag_reason: 'Dormant', status: 'escalated' }] });
    assert.match(model.actionConsequences('clear', one).at(-1) ?? '', /^1 other open flag on this withdrawal stays open/);
    const closed = detailOf({ other_flags: [{ id: OTHER_FLAG_ID, flag_reason: 'Dormant', status: 'cleared' }] });
    assert.equal(model.actionConsequences('clear', closed).length, 2);
  });

  test('a flag that moved on is explained before any confirmation opens', () => {
    assert.equal(model.unavailableText('escalated', 'escalate'), 'This flag is already escalated.');
    assert.equal(
      model.unavailableText('cleared', 'reject'),
      'This flag is now cleared, so it can no longer be rejected.',
    );
  });

  test('outcomes are sorted by what the page must do next', () => {
    assert.deepEqual(
      model.classifyResolution({ ok: true, data: { status: 'cleared', warning: ' ' }, status: 200, requestId: 'req_1' }),
      { kind: 'done', status: 'cleared', warning: null },
    );
    assert.deepEqual(model.classifyResolution(failure({ kind: 'network', status: null, outcomeUnknown: true })), {
      kind: 'unknown',
    });
    assert.deepEqual(model.classifyResolution(failure({ status: 401 })), { kind: 'expired' });
    for (const status of [403, 404, 409]) {
      assert.deepEqual(model.classifyResolution(failure({ status, message: 'This flag is already cleared.' })), {
        kind: 'refused',
        status,
        message: 'This flag is already cleared.',
      });
    }
    assert.deepEqual(model.classifyResolution(failure({ status: 400, message: 'Unknown action.' })), {
      kind: 'retry',
      message: 'Unknown action.',
    });
  });

  test('toasts confirm nothing moved, and an audit gap is a warning', () => {
    assert.deepEqual(model.resolutionToast('clear', { kind: 'done', status: 'cleared', warning: null }), {
      text: model.FLAG_ACTIONS.clear.done,
      tone: 'success',
    });
    assert.match(model.FLAG_ACTIONS.reject.done, /nothing was rejected, reversed or refunded/);
    assert.deepEqual(model.resolutionToast('reject', { kind: 'done', status: 'rejected', warning: 'No audit row.' }), {
      text: 'No audit row.',
      tone: 'warning',
    });
    assert.equal(model.resolutionToast('escalate', { kind: 'unknown' })?.text, model.UNKNOWN_RESOLUTION);
    assert.equal(model.resolutionToast('clear', { kind: 'expired' }), null);
  });

  test('settleWithin resolves when the work finishes or the wait runs out', async () => {
    let finished = false;
    await model.settleWithin(Promise.resolve().then(() => { finished = true; }), 1000);
    assert.equal(finished, true);
    const started = Date.now();
    await model.settleWithin(new Promise(() => undefined), 20);
    assert.ok(Date.now() - started < 1000);
  });
});

describe('flag drawer', () => {
  test('states that resolving only records the review and links to the withdrawal', () => {
    const html = bodyHtml(detailOf());
    const text = textOf(html);
    assert.match(text, /Resolving a flag only records the review/);
    assert.match(text, /It never approves, pays, holds or refunds anything\./);
    assert.match(text, /frozen-account and emergency-mode checks and resolves this flag automatically/);
    assert.ok(linksOf(html).includes(`/withdrawals?id=${WITHDRAWAL_ID}`));
    assert.match(text, /Withdrawal status pending review/);
  });

  test('never prints the whole account number', () => {
    const html = bodyHtml(detailOf({ withdrawal: withdrawalBody({ account_number: ACCOUNT }) }));
    assert.equal(html.includes(ACCOUNT), false);
    assert.match(textOf(html), /•••• 6789/);
    assert.match(textOf(html), /Account ending 6 7 8 9/);
  });

  test('hides links the admin cannot use and tells view-only admins where to decide', () => {
    const viewer = bodyHtml(detailOf(), { resolve: false, users: false, withdrawals: false });
    assert.ok(!linksOf(viewer).some((href) => href.startsWith('/withdrawals')));
    assert.ok(!linksOf(viewer).some((href) => href.startsWith('/users/')));
    assert.match(textOf(viewer), /needs the Resolve flagged transactions permission/);
    const resolver = bodyHtml(detailOf());
    assert.doesNotMatch(textOf(resolver), /needs the Resolve flagged transactions permission/);
    assert.ok(linksOf(resolver).includes(`/users/${USER_ID}`));
  });

  test('a frozen account is called out with its reason', () => {
    const html = bodyHtml(detailOf({
      flag: flagBody({ users: { username: 'ada', full_name: 'Ada Obi', is_frozen: true, freeze_reason: 'Chargeback' } }),
    }));
    const text = textOf(html);
    assert.match(text, /Account frozen Chargeback/);
    assert.match(text, /cannot be approved while the account is frozen/);
    assert.match(text, /rejecting this flag does not/);
  });

  test('shows the review history with the reviewer and time', () => {
    const reviewed = textOf(bodyHtml(detailOf({
      flag: flagBody({ status: 'cleared', reviewed_by: ADMIN_ID, reviewed_at: '2026-10-08T10:00:00.000Z' }),
      reviewer: { id: ADMIN_ID, username: 'evelyn' },
    })));
    assert.match(reviewed, /Last review Cleared by evelyn/);
    assert.match(reviewed, /Reviewed 08 Oct 2026, 11:00 WAT/);
    assert.match(textOf(bodyHtml(detailOf())), /Last review Not reviewed yet/);
  });

  test('a missing withdrawal and other open flags are reported in place', () => {
    const html = bodyHtml(detailOf({
      withdrawal: null,
      partial: { reviewer: null, related: 'The withdrawal this flag was raised on could not be found.', other_flags: null },
      other_flags: [{ id: OTHER_FLAG_ID, flag_reason: 'Dormant account (30+ days inactive)', status: 'pending_review' }],
    }));
    const text = textOf(html);
    assert.match(text, /could not be found/);
    assert.match(text, /Other flags on this withdrawal/);
    assert.match(text, /Dormant account \(30\+ days inactive\)/);
  });

  test('footer actions follow the flag status', () => {
    const render3 = (status: string) => render(createElement(parts.FlagActions, { status, acting: null, onAction: () => undefined }));
    assert.deepEqual(buttonLabels(render3('pending_review')), ['Clear flag', 'Escalate flag', 'Reject flag']);
    assert.deepEqual(buttonLabels(render3('escalated')), ['Clear flag', 'Reject flag']);
    assert.equal(render3('cleared'), '');
    const busy = render(createElement(parts.FlagActions, { status: 'pending_review', acting: 'clear', onAction: () => undefined }));
    assert.equal(tagsOf(busy, 'button').every((attrs) => 'disabled' in attrs), true);
  });

  test('the user cell links to the user only for admins who can open users', () => {
    const linked = render(createElement(parts.FlagUserCell, {
      user: model.toDetail(detailBody())?.flag.user ?? null,
      userId: USER_ID,
      canOpen: true,
    }));
    assert.ok(linksOf(linked).includes(`/users/${USER_ID}`));
    const plain = render(createElement(parts.FlagUserCell, { user: null, userId: USER_ID, canOpen: false }));
    assert.equal(linksOf(plain).length, 0);
    assert.match(textOf(plain), /Unknown user/);
  });
});

describe('route contract and hard rules', () => {
  const source = readFileSync(ROUTE, 'utf8');
  const getBody = sliceBetween(source, 'export async function GET', 'export async function POST');
  const postBody = sliceBetween(source, 'export async function POST');

  test('Withdrawals admins can read the list and detail; resolving stays flags.resolve', () => {
    assert.match(getBody, /requireAdminAny\(\['flags\.read', 'withdrawals\.read'\]\)/);
    assert.match(postBody, /requireAdmin\('flags\.resolve'\)/);
    assert.doesNotMatch(postBody, /withdrawals\.read|requireAdminAny/);
  });

  test('keeps every key the mobile app sends and reads', () => {
    assert.match(getBody, /params\.get\('status'\)/);
    assert.match(source, /flagged: fetched\.rows,/);
    assert.match(source, /open_count: open,/);
    assert.match(postBody, /flag_id/);
    assert.match(postBody, /\.action/);
    assert.match(postBody, /clear: \{ status: 'cleared'|ACTIONS\[actionKey\]/);
  });

  test('the route’s resolutions match what the page tells the admin', () => {
    for (const action of model.ACTION_ORDER) {
      assert.match(source, new RegExp(`${action}: \\{ status: '${model.FLAG_ACTIONS[action].result}'`));
    }
  });

  test('resolving only records the review: no payout, hold, refund or RPC in the POST', () => {
    for (const forbidden of [/from\('withdrawals'\)/, /from\('transactions'\)/, /from\('wallets'\)/, /\.rpc\(/]) {
      assert.doesNotMatch(postBody, forbidden);
    }
    assert.match(postBody, /\.in\('status', OPEN_STATUSES\)/);
  });

  test('related records are summarised through the masking presenters, never selected whole', () => {
    assert.match(source, /presentWithdrawal\(data/);
    assert.match(source, /presentTransaction\(row\)/);
    assert.doesNotMatch(source, /select\('\*'\)/);
  });

  test('the dashboard Open flags tile opens this page for flag holders and Withdrawals admins', () => {
    const tile = metrics.ACTION_METRICS.find((metric) => metric.statKey === 'openFlags');
    assert.ok(tile);
    assert.equal(tile.href, '/flagged-transactions');
    assert.deepEqual(tile.perm, ['flags.read', 'withdrawals.read']);
  });

  test('no prose comments, literal colours, stacking numbers, static inline styles or Ref on bank details', () => {
    const files = [
      ...readdirSync(PAGE_DIR).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => join(PAGE_DIR, name)),
      ROUTE,
    ];
    assert.ok(files.length >= 5);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/\/\*|(^|[^:])\/\/(?!\/)/m.test(text), `${file} has a comment`);
      assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(text), `${file} has a literal colour`);
      assert.ok(!/z-?index/i.test(text), `${file} sets a stacking order`);
      assert.ok(!/style=\{\{/.test(text), `${file} has a static inline style`);
      assert.ok(!/<Ref[^>]*account_number/.test(text), `${file} puts an account number in a Ref`);
    }
    const css = readFileSync(join(PAGE_DIR, 'page.module.css'), 'utf8');
    assert.ok(!/\/\*/.test(css));
    assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|z-index/i.test(css));
  });
});
