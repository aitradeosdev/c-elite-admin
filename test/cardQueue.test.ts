import { afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ElementType } from 'react';
import { classesOf, loadAppModule, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type { QueueQuery, QueueRow, Submission } from '../app/(dashboard)/card-queue/queueModel.ts';
import type { QueueTableProps } from '../app/(dashboard)/card-queue/QueueTable.tsx';
import type { SubmissionDrawerProps } from '../app/(dashboard)/card-queue/SubmissionDrawer.tsx';

type ModelModule = typeof import('../app/(dashboard)/card-queue/queueModel.ts');
type QueueApiModule = typeof import('../app/(dashboard)/card-queue/queueApi.ts');

interface FetchCall {
  url: string;
  init: RequestInit;
}

const SUBMISSION_ID = '6f1c2b8e-0d0a-4f6e-9a51-3c2d4e5f6a7b';
const CARD_CODE = 'XQ7P-2KDM-99LZ';

let model: ModelModule;
let queueApi: QueueApiModule;
let QueueTable: ElementType<QueueTableProps>;
let SubmissionDrawer: ElementType<SubmissionDrawerProps>;
const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];

before(async () => {
  model = await loadAppModule<ModelModule>('(dashboard)/card-queue/queueModel.ts');
  queueApi = await loadAppModule<QueueApiModule>('(dashboard)/card-queue/queueApi.ts');
  QueueTable = (await loadAppModule<{ QueueTable: ElementType<QueueTableProps> }>('(dashboard)/card-queue/QueueTable.tsx')).QueueTable;
  SubmissionDrawer = (await loadAppModule<{ SubmissionDrawer: ElementType<SubmissionDrawerProps> }>(
    '(dashboard)/card-queue/SubmissionDrawer.tsx',
  )).SubmissionDrawer;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function failureOf<T>(result: ApiResult<T>): ApiFailure {
  assert.equal(result.ok, false, 'expected a failure result');
  if (result.ok) throw new Error('unreachable');
  return result.error;
}

function failure(patch: Partial<ApiFailure>): ApiFailure {
  return {
    kind: 'http', status: 500, code: 'INTERNAL_ERROR', message: 'x', requestId: null, details: null, outcomeUnknown: false,
    ...patch,
  };
}

function row(patch: Partial<QueueRow> = {}): QueueRow {
  return {
    id: SUBMISSION_ID,
    amount_foreign: 100,
    payout_naira: 150000,
    status: 'pending',
    created_at: '2026-09-30T13:05:00.000Z',
    rejection_reason: null,
    dispute_message: null,
    users: { id: 'user-1', full_name: 'Ada Obi', username: 'ada', email: 'ada@example.com' },
    cards: { name: 'Amazon' },
    card_types: { name: 'Physical', country_code: 'US' },
    ...patch,
  };
}

function submission(patch: Partial<Submission> = {}): Submission {
  return {
    ...row(),
    rate_at_submission: 1500,
    submitted_fields: { code: CARD_CODE },
    card_images: [],
    dispute_images: [],
    coupon_code: null,
    coupon_bonus: null,
    card_id: 'card-1',
    card_type_id: 'type-1',
    cards: { id: 'card-1', name: 'Amazon' },
    card_types: { id: 'type-1', name: 'Physical', country_code: 'US' },
    denominations: { range_label: '$25 - $500' },
    country_name: 'United States',
    currency_symbol: '$',
    card_types_for_card: [],
    field_labels: { code: 'Card code' },
    ...patch,
  };
}

const noop = () => {};

function table(patch: Partial<QueueTableProps> = {}): string {
  const props: QueueTableProps = {
    rows: [row()],
    error: null,
    retrying: false,
    refreshing: false,
    sort: { key: 'created_at', dir: 'desc' },
    onSort: noop,
    activeId: null,
    canReview: true,
    deciding: false,
    empty: { title: 'No cards waiting for review', hint: 'New submissions appear here automatically.' },
    onOpen: noop,
    onApprove: noop,
    onReject: noop,
    onRetry: noop,
    ...patch,
  };
  return render(createElement(QueueTable, props));
}

function drawer(patch: Partial<SubmissionDrawerProps> = {}): string {
  const props: SubmissionDrawerProps = {
    open: true,
    submission: submission(),
    retrying: false,
    error: null,
    canReview: true,
    deciding: false,
    onClose: noop,
    onRetry: noop,
    onApprove: noop,
    onOverturn: noop,
    onReject: noop,
    onUphold: noop,
    ...patch,
  };
  return render(createElement(SubmissionDrawer, props));
}

function buttonLabels(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((match) => textOf(match[1]));
}

describe('card queue list query', () => {
  test('the default tab asks for pending submissions, newest first, 50 per page', () => {
    const params = model.queueParams({
      tab: 'pending', search: '', from: null, to: null, page: 1, sort: { key: 'created_at', dir: 'desc' },
    });
    assert.equal(params, 'status=pending&sort=created_at&dir=desc&page=1&limit=50');
  });

  test('the All tab sends no status and filters are passed through', () => {
    const params = new URLSearchParams(model.queueParams({
      tab: 'all', search: 'ada', from: '2026-09-01', to: '2026-09-30', page: 3, sort: { key: 'amount', dir: 'asc' },
    }));
    assert.equal(params.has('status'), false);
    assert.equal(params.get('search'), 'ada');
    assert.equal(params.get('date_from'), '2026-09-01');
    assert.equal(params.get('date_to'), '2026-09-30');
    assert.equal(params.get('sort'), 'amount');
    assert.equal(params.get('dir'), 'asc');
    assert.equal(params.get('page'), '3');
  });

  test('rows are kept while search, dates, page or sort change, but not across tabs', () => {
    const base: QueueQuery = { tab: 'pending', search: '', from: null, to: null, page: 1, sort: null };
    const key = (patch: Partial<QueueQuery>) => model.queueParams({ ...base, ...patch });
    assert.equal(model.sameQueueTab(key({}), key({ search: 'ada' })), true);
    assert.equal(model.sameQueueTab(key({}), key({ page: 2 })), true);
    assert.equal(model.sameQueueTab(key({}), key({ from: '2026-09-01' })), true);
    assert.equal(model.sameQueueTab(key({}), key({ tab: 'disputed' })), false);
    assert.equal(model.sameQueueTab(key({}), key({ tab: 'all' })), false);
    assert.equal(model.sameQueueTab(key({ tab: 'all' }), key({ tab: 'all', page: 4 })), true);
  });
});

describe('card queue response mappers', () => {
  test('a list body without a submissions array is unreadable, not an empty queue', () => {
    assert.equal(queueApi.toQueueList({ success: true, total: 3 }), null);
  });

  test('the list maps rows, total, tab counts and the truncation flag', () => {
    const mapped = queueApi.toQueueList({
      submissions: [row()], total: 51, counts: { pending: 12, disputed: 'x' }, search_truncated: true, can_review: true,
    });
    assert.ok(mapped);
    assert.equal(mapped.rows.length, 1);
    assert.equal(mapped.total, 51);
    assert.deepEqual(mapped.counts, { pending: 12, disputed: null });
    assert.equal(mapped.searchTruncated, true);
    assert.equal('canReview' in mapped, false);
  });

  test('a detail body without a submission object is unreadable', () => {
    assert.equal(queueApi.toSubmissionResult({ success: true }), null);
    assert.equal(queueApi.toSubmissionResult({ submission: [] }), null);
  });

  test('the detail normalises arrays, labels, the currency and the approval limit', () => {
    const mapped = queueApi.toSubmissionResult({
      submission: {
        ...submission(),
        card_images: null,
        dispute_images: 'x',
        card_types_for_card: [{ id: 't', name: 'Physical', country_code: 'US', denominations: null }],
        field_labels: null,
        currency_symbol: '  ',
      },
      approval_limit_naira: 5000000,
    });
    assert.ok(mapped);
    assert.deepEqual(mapped.submission.card_images, []);
    assert.deepEqual(mapped.submission.dispute_images, []);
    assert.deepEqual(mapped.submission.card_types_for_card[0].denominations, []);
    assert.deepEqual(mapped.submission.field_labels, {});
    assert.equal(mapped.submission.currency_symbol, null);
    assert.equal(mapped.approvalLimit, 5000000);
  });

  test('a decision maps the credited amount and drops a blank warning', () => {
    assert.deepEqual(
      queueApi.toDecisionResult({ status: 'approved', credited: 150000, warning: ' ' }),
      { status: 'approved', credited: 150000, warning: null },
    );
  });
});

describe('card queue requests', () => {
  test('the list is a no-store GET of /api/card-queue with the query and the caller signal', async () => {
    stubFetch(() => json({ success: true, submissions: [row()], total: 1, counts: { pending: 1, disputed: 0 } }));
    const controller = new AbortController();
    const result = await queueApi.fetchQueue('status=pending&page=1&limit=50', controller.signal);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/card-queue?status=pending&page=1&limit=50');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.data.rows[0].id, SUBMISSION_ID);
  });

  test('a 403 on the list reaches the page as status 403', async () => {
    stubFetch(() => json({ success: false, code: 'PERMISSION_DENIED', error: 'You do not have permission to do this.' }, 403));
    const error = failureOf(await queueApi.fetchQueue('status=pending', new AbortController().signal));
    assert.equal(error.status, 403);
  });

  test('the detail asks for one submission by id', async () => {
    stubFetch(() => json({ success: true, submission: submission(), approval_limit_naira: null }));
    const result = await queueApi.fetchSubmission(SUBMISSION_ID, new AbortController().signal);
    assert.equal(calls[0].url, `/api/card-queue?id=${SUBMISSION_ID}`);
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.data.approvalLimit, null);
  });

  test('a decision is a JSON POST with the mobile-compatible body', async () => {
    stubFetch(() => json({ success: true, status: 'rejected' }));
    const result = await queueApi.postDecision({ action: 'reject', reason: 'Invalid card code', submission_id: SUBMISSION_ID });
    assert.equal(calls[0].url, '/api/card-queue');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(new Headers(calls[0].init.headers).get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      action: 'reject', reason: 'Invalid card code', submission_id: SUBMISSION_ID,
    });
    assert.ok(result.ok);
    if (result.ok) assert.deepEqual(result.data, { status: 'rejected', credited: null, warning: null });
  });

  test('a decision that may have been saved is classed as changed, never as a retryable refusal', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const offline = failureOf(await queueApi.postDecision({ action: 'approve', submission_id: SUBMISSION_ID }));
    assert.equal(offline.outcomeUnknown, true);
    assert.equal(queueApi.decisionFailureKind(offline), 'changed');

    stubFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));
    const crashed = failureOf(await queueApi.postDecision({ action: 'approve', submission_id: SUBMISSION_ID }));
    assert.equal(queueApi.decisionFailureKind(crashed), 'changed');
  });

  test('decision failures are sorted by what the page must do next', () => {
    assert.equal(queueApi.decisionFailureKind(failure({ status: 401, code: 'AUTH_REQUIRED' })), 'signedOut');
    assert.equal(queueApi.decisionFailureKind(failure({ status: 403, code: 'PERMISSION_DENIED' })), 'denied');
    assert.equal(queueApi.decisionFailureKind(failure({ status: 404, code: 'RESOURCE_NOT_FOUND' })), 'changed');
    assert.equal(queueApi.decisionFailureKind(failure({ status: 409, code: 'STATE_CONFLICT' })), 'changed');
    assert.equal(queueApi.decisionFailureKind(failure({ status: 500, code: 'INTERNAL_ERROR' })), 'refused');
    assert.equal(queueApi.decisionFailureKind(failure({ status: 400, code: 'VALIDATION_ERROR' })), 'refused');
    assert.equal(queueApi.decisionFailureKind(failure({ status: 429, code: 'RATE_LIMITED' })), 'refused');
  });
});

describe('card queue table', () => {
  test('first load shows a per-column skeleton under the real headers', () => {
    const html = table({ rows: null });
    assert.match(textOf(html), /Loading Card submissions/);
    const skeletonRows = withClass(html, 'tr', 'skeletonRow');
    assert.equal(skeletonRows.length, 8);
    const firstRow = html.slice(html.indexOf('skeletonRow'));
    assert.equal((firstRow.slice(0, firstRow.indexOf('</tr>')).match(/<td\b/g) ?? []).length, 7);
  });

  test('a failed first load offers a retry that shows progress without swapping to a skeleton', () => {
    const error = failure({ status: 500, message: 'The card queue could not be loaded.', requestId: 'req_1' });
    const idle = table({ rows: null, error });
    assert.match(textOf(idle), /The card queue could not be loaded/);
    assert.match(textOf(idle), /req_1/);
    assert.deepEqual(buttonLabels(idle), ['Submitted', 'Payout', 'Try again']);

    const retrying = table({ rows: null, error, retrying: true });
    assert.equal(withClass(retrying, 'tr', 'skeletonRow').length, 0);
    const retry = tagsOf(retrying, 'button').find((attrs) => attrs['aria-busy'] === 'true');
    assert.ok(retry, 'the retry button is busy');
    assert.ok('disabled' in retry);
  });

  test('an empty tab says what happens next and keeps the filter action', () => {
    const html = table({
      rows: [],
      empty: { title: 'No submissions match these filters', hint: 'Try another search.', action: createElement('button', { type: 'button' }, 'Clear filters') },
    });
    assert.match(textOf(html), /No submissions match these filters/);
    assert.match(textOf(html), /Try another search\./);
    assert.ok(buttonLabels(html).includes('Clear filters'));
  });

  test('a refresh dims the rows through the kit busy table', () => {
    const html = table({ refreshing: true });
    const [tableAttrs] = tagsOf(html, 'table');
    assert.equal(tableAttrs['aria-busy'], 'true');
    assert.ok(classesOf(tableAttrs).includes('busy'));
  });

  test('each row opens through a named RowOpen and offers decisions only to reviewers', () => {
    const reviewer = table();
    const open = tagsOf(reviewer, 'button').find((attrs) => classesOf(attrs).includes('rowOpen'));
    assert.ok(open, 'the card name is the row opener');
    assert.equal(open['aria-haspopup'], 'dialog');
    assert.equal(open['aria-label'], 'Open Amazon from @ada');
    assert.deepEqual(buttonLabels(reviewer).slice(2), ['Amazon', 'Approve', 'Reject', 'View']);

    const viewer = table({ canReview: false });
    assert.deepEqual(buttonLabels(viewer).slice(2), ['Amazon', 'View']);
  });

  test('disputed rows say Review to reviewers and View to everyone else', () => {
    assert.deepEqual(buttonLabels(table({ rows: [row({ status: 'disputed' })] })).slice(2), ['Amazon', 'Review']);
    assert.deepEqual(buttonLabels(table({ rows: [row({ status: 'disputed' })], canReview: false })).slice(2), ['Amazon', 'View']);
  });

  test('decision buttons are disabled while a decision is recorded', () => {
    const html = table({ deciding: true });
    const approve = tagsOf(html, 'button').find((attrs) => attrs['aria-label'] === 'Approve Amazon from @ada');
    const reject = tagsOf(html, 'button').find((attrs) => attrs['aria-label'] === 'Reject Amazon from @ada');
    assert.ok(approve && 'disabled' in approve);
    assert.ok(reject && 'disabled' in reject);
  });

  test('a closed dispute reads exactly as the queue names it', () => {
    assert.match(textOf(table({ rows: [row({ status: 'dispute_resolved' })] })), /Dispute closed/);
  });
});

describe('submission drawer', () => {
  test('an open dispute is a warning callout and a closed one is neutral', () => {
    const open = drawer({ submission: submission({ status: 'disputed', dispute_message: 'The card was valid.' }) });
    const openNotice = withClass(open, 'div', 'callout')[0];
    assert.ok(openNotice);
    assert.ok(classesOf(openNotice).includes('warning'));
    assert.match(textOf(open), /Open dispute The card was valid\./);

    const closed = drawer({ submission: submission({ status: 'dispute_resolved', dispute_message: 'Please check again.' }) });
    const closedNotice = withClass(closed, 'div', 'callout')[0];
    assert.ok(classesOf(closedNotice).includes('neutral'));
    assert.match(textOf(closed), /Dispute Please check again\./);
  });

  test('the user is shown with a decorative initials avatar', () => {
    const html = drawer();
    const avatar = withClass(html, 'span', 'avatar')[0];
    assert.ok(avatar);
    assert.ok(classesOf(avatar).includes('lg'));
    assert.equal(avatar.role, undefined);
    assert.match(html, />AO</);
  });

  test('card codes stay plain text and are never put in a copyable reference', () => {
    const html = drawer();
    assert.match(textOf(html), new RegExp(`Card code ${CARD_CODE}`));
    for (const ref of withClass(html, 'span', 'refText')) {
      assert.notEqual(ref.title, CARD_CODE);
    }
    assert.equal(html.split(CARD_CODE).length - 1, 1);
  });

  test('decision buttons follow the status and the review permission', () => {
    const labels = (html: string) => buttonLabels(html).filter((text) => /Approve|Reject|Uphold|Overturn/.test(text));
    assert.deepEqual(labels(drawer()), ['Reject', 'Approve']);
    assert.deepEqual(labels(drawer({ submission: submission({ status: 'disputed' }) })), ['Uphold rejection', 'Overturn']);
    assert.deepEqual(labels(drawer({ canReview: false })), []);
    assert.deepEqual(labels(drawer({ submission: submission({ status: 'approved' }) })), []);
  });

  test('a missing submission has no retry, and other failures retry in place', () => {
    const missing = drawer({ submission: null, error: failure({ status: 404, code: 'RESOURCE_NOT_FOUND' }) });
    assert.match(textOf(missing), /Submission not found/);
    assert.equal(buttonLabels(missing).includes('Try again'), false);

    const retrying = drawer({ submission: null, error: failure({ status: 500, message: 'Down.' }), retrying: true });
    assert.match(textOf(retrying), /This submission could not be loaded/);
    const retry = tagsOf(retrying, 'button').find((attrs) => attrs['aria-busy'] === 'true');
    assert.ok(retry && 'disabled' in retry);
  });

  test('loading shows the drawer skeleton with a status message', () => {
    const html = drawer({ submission: null });
    assert.match(textOf(html), /Loading submission/);
  });
});
