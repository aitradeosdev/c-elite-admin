import { afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ElementType } from 'react';
import { loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { Capabilities, FilterState, Transaction } from '../app/(dashboard)/transactions-overview/model.ts';

type ModelModule = typeof import('../app/(dashboard)/transactions-overview/model.ts');
type ApiClientModule = typeof import('../app/lib/apiClient.ts');

let model: ModelModule;
let api: ApiClientModule;
let parts: Record<string, ElementType>;
const realFetch = globalThis.fetch;

before(async () => {
  model = await loadAppModule<ModelModule>('(dashboard)/transactions-overview/model.ts');
  api = await loadAppModule<ApiClientModule>('lib/apiClient.ts');
  parts = await loadAppModule<Record<string, ElementType>>('(dashboard)/transactions-overview/TransactionParts.tsx');
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(body: unknown, status: number): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
}

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const WITHDRAWAL_ID = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';

const TX: Transaction = {
  id: '0b8e7d6c-5a4b-4c3d-9e2f-1a0b9c8d7e6f',
  user_id: USER_ID,
  type: 'withdrawal',
  amount: 50000,
  status: 'success',
  reference_id: WITHDRAWAL_ID,
  metadata: {
    account_number: '0123456789',
    bank_name: 'GTBank',
    account_name: 'ADA OBI',
    fee: 100,
    payout: { account_number: '9876543210', bank: 'GTB' },
  },
  created_at: '2026-10-01T09:30:00.000Z',
  users: { id: USER_ID, username: 'ada', full_name: 'Ada Obi', email: 'ada@example.com' },
};

const ALL: Capabilities = { users: true, withdrawals: true, cards: true };
const NONE: Capabilities = { users: false, withdrawals: false, cards: false };

const FILTERS: FilterState = {
  search: 'ada',
  type: 'withdrawal',
  status: 'failed',
  from: '2026-09-01',
  to: '2026-09-30',
};

function drawer(transaction: Transaction, can: Capabilities = ALL): string {
  return render(createElement(parts.DetailBody, { transaction, can }));
}

describe('filter tokens', () => {
  test('lower-cases, de-duplicates and sorts type and status tokens', () => {
    assert.equal(model.normalizeTokens(' Withdrawal_Refund, withdrawal,WITHDRAWAL '), 'withdrawal,withdrawal_refund');
    assert.equal(model.normalizeTokens('data,DROP TABLE,x-y,airtime'), 'airtime,data');
    assert.equal(model.normalizeTokens(null), '');
    assert.equal(model.normalizeTokens(undefined), '');
  });

  test('keeps at most sixteen tokens', () => {
    const many = Array.from({ length: 20 }, (_, index) => `t${String(index).padStart(2, '0')}`).join(',');
    assert.equal(model.normalizeTokens(many).split(',').length, 16);
  });
});

describe('wallet adjustment types', () => {
  test('are labelled in the explorer', () => {
    assert.equal(model.typeLabel('wallet_credit'), 'Wallet credit');
    assert.equal(model.typeLabel('wallet_debit'), 'Wallet debit');
  });

  test('can be filtered together or one at a time', () => {
    const group = model.TYPE_GROUPS.find((entry) => entry.label === 'Wallet adjustments');
    assert.ok(group);
    assert.deepEqual(group.options, [
      { value: 'wallet_credit,wallet_debit', label: 'All wallet adjustments' },
      { value: 'wallet_credit', label: 'Wallet credits' },
      { value: 'wallet_debit', label: 'Wallet debits' },
    ]);
    assert.equal(model.isKnownType(model.normalizeTokens('wallet_debit,wallet_credit')), true);
  });
});

describe('list and export queries', () => {
  test('the list query carries every filter, the sort and the page', () => {
    assert.equal(
      model.buildListQuery(FILTERS, { key: 'amount', dir: 'asc' }, 2, 50),
      'search=ada&type=withdrawal&status=failed&date_from=2026-09-01&date_to=2026-09-30&sort=amount&dir=asc&page=2&limit=50',
    );
  });

  test('the filter key ignores sort and paging and changes with any filter', () => {
    assert.equal(
      model.filterQuery(FILTERS),
      'search=ada&type=withdrawal&status=failed&date_from=2026-09-01&date_to=2026-09-30',
    );
    assert.equal(model.filterQuery({ ...FILTERS }), model.filterQuery(FILTERS));
    assert.notEqual(model.filterQuery({ ...FILTERS, status: '' }), model.filterQuery(FILTERS));
    assert.equal(model.filterQuery({ search: '', type: '', status: '', from: null, to: null }), '');
  });

  test('an export uses the chosen window, not the on-screen dates, and keeps search, type and status', () => {
    assert.equal(
      model.buildExportQuery(FILTERS, { key: 'created_at', dir: 'desc' }, { from: '2026-10-01', to: '2026-10-02' }, 'csv'),
      'search=ada&type=withdrawal&status=failed&date_from=2026-10-01&date_to=2026-10-02&sort=created_at&dir=desc&csv=1',
    );
    assert.equal(
      model.buildExportQuery(FILTERS, null, { from: null, to: null }, 'pdf'),
      'search=ada&type=withdrawal&status=failed&pdf=1',
    );
  });
});

describe('response mappers', () => {
  test('toListResult needs a transactions array', () => {
    assert.equal(model.toListResult({ success: true }), null);
    assert.equal(model.toListResult({ transactions: {} }), null);
  });

  test('toListResult reads the page, the search cap and only a full summary', () => {
    assert.deepEqual(model.toListResult({ transactions: [TX], total: '12', search_capped: true, summary: 'none' }), {
      transactions: [TX],
      total: 12,
      searchCapped: true,
      summary: null,
    });
    assert.deepEqual(model.toListResult({ transactions: [], total: -4, search_capped: 'yes', summary: 'legacy' }), {
      transactions: [],
      total: 0,
      searchCapped: false,
      summary: null,
    });
  });

  test('a full summary keeps the figures and joins the partial failures', () => {
    const stats = { totalCount: 9, totalAmount: 1200, todayCount: 1, todayAmount: 50 };
    const today = { date: '2026-10-02', count: 3, success_volume: 4500 };
    assert.deepEqual(
      model.toListResult({ transactions: [], total: 0, summary: 'full', stats, today, partial: { stats: null, today: null } })?.summary,
      { stats, today, error: null },
    );
    assert.deepEqual(
      model.toListResult({
        transactions: [],
        summary: 'full',
        stats: null,
        today: 'n/a',
        partial: { stats: ' Platform totals could not be loaded. ', today: 'Today’s figures could not be loaded.' },
      })?.summary,
      {
        stats: null,
        today: null,
        error: 'Platform totals could not be loaded. Today’s figures could not be loaded.',
      },
    );
  });

  test('toDetail needs a transaction with an id', () => {
    assert.equal(model.toDetail({ success: true }), null);
    assert.equal(model.toDetail({ transaction: { type: 'withdrawal' } }), null);
    assert.equal(model.toDetail({ transaction: [TX] }), null);
    assert.deepEqual(model.toDetail({ transaction: TX }), { transaction: TX });
  });

  test('a refused list keeps the route message, and a detail without a transaction is unreadable', async () => {
    respond({ success: false, error: 'Unknown status filter.', code: 'VALIDATION_ERROR', request_id: 'req_bad' }, 400);
    const list = await api.apiRequest('/api/transactions', { query: { status: 'x' }, select: model.toListResult });
    assert.equal(list.ok, false);
    assert.equal(!list.ok && list.error.message, 'Unknown status filter.');
    assert.equal(!list.ok && list.error.requestId, 'req_bad');

    respond({ success: true, request_id: 'req_empty' }, 200);
    const detail = await api.apiRequest('/api/transactions', { query: { id: TX.id }, select: model.toDetail });
    assert.equal(detail.ok, false);
    assert.equal(!detail.ok && detail.error.kind, 'parse');
  });
});

describe('metadata rows', () => {
  test('mask account numbers and tokens to the last four, whether or not the server already did', () => {
    const raw = model.metadataRows({ account_number: '0123456789', electricity_token: '1234 5678 9012 3456 7890' });
    const served = model.metadataRows({ account_number: '•••• 6789', electricity_token: '•••• 7890' });
    const expected = [
      { key: 'account_number', label: 'Account number', kind: 'masked', text: '•••• 6789' },
      { key: 'electricity_token', label: 'Electricity token', kind: 'masked', text: '•••• 7890' },
    ];
    assert.deepEqual(raw, expected);
    assert.deepEqual(served, expected);
    assert.deepEqual(model.metadataRows({ account_number: '1234' })[0].text, '••••');
  });

  test('mask the same keys inside nested values', () => {
    const [row] = model.metadataRows({ payout: { account_number: '9876543210', bank: 'GTB' } });
    assert.equal(row.kind, 'json');
    assert.equal(row.text, '{"account_number":"•••• 3210","bank":"GTB"}');
  });

  test('describe money, ids, times, flags and empty values', () => {
    const rows = model.metadataRows({
      fee: '100',
      submission_id: WITHDRAWAL_ID,
      disputed_at: '2026-10-01T09:30:00.000Z',
      manual: true,
      reason: '',
    });
    const kinds = Object.fromEntries(rows.map((row) => [row.key, [row.kind, row.text]]));
    assert.deepEqual(kinds, {
      fee: ['money', '100'],
      submission_id: ['id', WITHDRAWAL_ID],
      disputed_at: ['datetime', '2026-10-01T09:30:00.000Z'],
      manual: ['text', 'Yes'],
      reason: ['empty', '—'],
    });
  });

  test('list known keys first in their set order, then the rest alphabetically', () => {
    const keys = model.metadataRows({ zeta: 1, fee: 2, bank_name: 'x', alpha: 3 }).map((row) => row.key);
    assert.deepEqual(keys, ['bank_name', 'fee', 'alpha', 'zeta']);
  });

  test('ignore arrays and missing metadata', () => {
    assert.deepEqual(model.metadataRows(null), []);
    assert.deepEqual(model.metadataRows(undefined), []);
    assert.deepEqual(model.metadataRows([] as unknown as Record<string, unknown>), []);
  });
});

describe('related links', () => {
  test('link a withdrawal or a gift card credit to its source only with the read permission', () => {
    assert.deepEqual(model.relatedLink(TX, ALL), { href: `/withdrawals?id=${WITHDRAWAL_ID}`, label: 'Open withdrawal' });
    assert.equal(model.relatedLink(TX, NONE), null);
    assert.deepEqual(
      model.relatedLink({ ...TX, type: 'giftcard_credit' }, { ...NONE, cards: true }),
      { href: `/card-queue?id=${WITHDRAWAL_ID}`, label: 'Open card submission' },
    );
    assert.equal(model.relatedLink({ ...TX, type: 'airtime' }, ALL), null);
  });

  test('wallet adjustments have no related link, even with an id reference and every permission', () => {
    for (const type of ['wallet_credit', 'wallet_debit']) {
      assert.equal(model.relatedLink({ ...TX, type, reference_id: WITHDRAWAL_ID }, ALL), null, type);
    }
  });

  test('need a real id as the reference and lower-case it', () => {
    assert.equal(model.relatedLink({ ...TX, reference_id: 'VTP-123' }, ALL), null);
    assert.equal(
      model.relatedLink({ ...TX, reference_id: WITHDRAWAL_ID.toUpperCase() }, ALL)?.href,
      `/withdrawals?id=${WITHDRAWAL_ID}`,
    );
    assert.equal(model.validId(` ${WITHDRAWAL_ID}`), null);
  });
});

describe('transaction drawer', () => {
  test('never prints a bank account number whole and names the masked field for screen readers', () => {
    const html = drawer(TX);
    assert.ok(!html.includes('0123456789'), 'the full account number reached the screen');
    assert.ok(!html.includes('9876543210'), 'a nested account number reached the screen');
    assert.match(html, /•••• 6789/);
    assert.match(textOf(html), /Account number ending 6 7 8 9/);
  });

  test('shows the raw metadata in a collapsed, copyable viewer', () => {
    const html = drawer(TX);
    assert.match(textOf(html), /Raw metadata/);
    assert.match(textOf(html), /Copy JSON/);
    const toggle = tagsOf(html, 'button').find((attrs) => attrs['aria-label']?.startsWith('Raw metadata'));
    assert.equal(toggle?.['aria-expanded'], 'false');
    assert.equal(toggle?.['aria-label'], 'Raw metadata, object, 5 keys');
  });

  test('has no raw viewer for empty metadata but keeps one for an array', () => {
    const empty = drawer({ ...TX, metadata: {} });
    assert.match(textOf(empty), /No metadata was recorded for this transaction\./);
    assert.ok(!textOf(empty).includes('Raw metadata'));
    assert.ok(!textOf(drawer({ ...TX, metadata: null })).includes('Raw metadata'));
    const list = drawer({ ...TX, metadata: [] as unknown as Record<string, unknown> });
    assert.match(textOf(list), /Raw metadata/);
  });

  test('links to the user and the source withdrawal only with the matching permissions', () => {
    const allowed = drawer(TX, ALL);
    assert.ok(tagsOf(allowed, 'a').some((attrs) => attrs.href === `/users/${USER_ID}`));
    assert.ok(tagsOf(allowed, 'a').some((attrs) => attrs.href === `/withdrawals?id=${WITHDRAWAL_ID}`));
    const denied = drawer(TX, NONE);
    assert.equal(tagsOf(denied, 'a').length, 0);
  });
});
