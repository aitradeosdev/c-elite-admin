import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAppModule } from './support/uiHarness.ts';

type FlagsModule = typeof import('../app/lib/flags.ts');

const flags = await loadAppModule<FlagsModule>('lib/flags.ts');

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const LIB = fileURLToPath(new URL('../app/lib/flags.ts', import.meta.url));
const ROUTE = fileURLToPath(new URL('../app/api/flagged-transactions/route.ts', import.meta.url));
const RETIRED_PAGE_DIR = fileURLToPath(new URL('../app/(dashboard)/flagged-transactions/', import.meta.url));

const OTHER_FLAG_ID = '4a3b2c1d-6e5f-4a07-9b8a-1d0c2e3f4a5b';
const WITHDRAWAL_ID = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';
const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ACCOUNT = '0123456789';

function withdrawalRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
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

function sliceBetween(source: string, start: string, end?: string): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  return source.slice(from, to < 0 ? source.length : to);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

describe('status and type filters', () => {
  test('the mobile app’s filters keep working, including its "pending" chip', () => {
    assert.deepEqual(flags.parseStatusFilter(null), []);
    assert.deepEqual(flags.parseStatusFilter(''), []);
    assert.deepEqual(flags.parseStatusFilter('pending'), ['pending_review']);
    assert.deepEqual(flags.parseStatusFilter('escalated'), ['escalated']);
    assert.deepEqual(flags.parseStatusFilter('cleared'), ['cleared']);
    assert.deepEqual(flags.parseStatusFilter('rejected'), ['rejected']);
  });

  test('lists, the open alias and all are accepted', () => {
    assert.deepEqual(flags.parseStatusFilter('open'), ['pending_review', 'escalated']);
    assert.deepEqual(flags.parseStatusFilter('escalated,pending_review'), ['pending_review', 'escalated']);
    assert.deepEqual(flags.parseStatusFilter(' Cleared , rejected '), ['cleared', 'rejected']);
    assert.deepEqual(flags.parseStatusFilter('all'), []);
  });

  test('anything else is refused rather than silently widened', () => {
    for (const raw of ['held', 'constructor', '__proto__', 'toString', ',', 'cleared,bogus', 'all,cleared']) {
      assert.equal(flags.parseStatusFilter(raw), null, raw);
    }
  });

  test('the type filter accepts data tokens only', () => {
    assert.equal(flags.parseTypeFilter(''), '');
    assert.equal(flags.parseTypeFilter(null), '');
    assert.equal(flags.parseTypeFilter('all'), '');
    assert.equal(flags.parseTypeFilter(' Withdrawal '), 'withdrawal');
    assert.equal(flags.parseTypeFilter('giftcard_credit'), 'giftcard_credit');
    assert.equal(flags.parseTypeFilter('card sell'), null);
    assert.equal(flags.parseTypeFilter('x'.repeat(41)), null);
  });

  test('sort keys fall back to newest first', () => {
    assert.equal(flags.parseSortKey('amount'), 'amount');
    assert.equal(flags.parseSortKey('created_at'), 'created_at');
    assert.equal(flags.parseSortKey('flag_reason'), 'created_at');
    assert.equal(flags.parseSortKey(null), 'created_at');
  });

  test('open statuses are the two a review can still act on', () => {
    assert.deepEqual(flags.FLAG_STATUSES, ['pending_review', 'escalated', 'cleared', 'rejected']);
    assert.deepEqual(flags.OPEN_STATUSES, ['pending_review', 'escalated']);
  });
});

describe('search', () => {
  test('a full id matches the flag, the flagged transaction or the user', () => {
    const plan = flags.planFlagSearch(WITHDRAWAL_ID.toUpperCase());
    assert.deepEqual(plan, { kind: 'id', id: WITHDRAWAL_ID });
    assert.equal(
      flags.flagSearchClause(plan, []),
      `id.eq.${WITHDRAWAL_ID},transaction_id.eq.${WITHDRAWAL_ID},user_id.eq.${WITHDRAWAL_ID}`,
    );
  });

  test('text resolves users by name, username or email and keeps a transaction id prefix', () => {
    assert.deepEqual(flags.planFlagSearch('@ada'), { kind: 'text', userTerm: 'ada', fragment: null });
    assert.deepEqual(flags.planFlagSearch('6f1c2d3e'), { kind: 'text', userTerm: '6f1c2d3e', fragment: '6f1c2d3e' });
    assert.equal(
      flags.userMatchClause('ada'),
      'full_name.ilike.%ada%,username.ilike.%ada%,email.ilike.%ada%',
    );
    const plan = flags.planFlagSearch('6f1c2d3e');
    assert.equal(
      flags.flagSearchClause(plan, [USER_ID.toUpperCase(), 'not-a-user']),
      `user_id.in.(${USER_ID}),transaction_id.ilike.6f1c2d3e%`,
    );
  });

  test('a search that finds nobody matches nothing instead of everything', () => {
    assert.equal(flags.flagSearchClause(flags.planFlagSearch('nobody'), []), null);
    assert.deepEqual(flags.planFlagSearch('   '), { kind: 'none' });
    assert.deepEqual(flags.planFlagSearch(null), { kind: 'none' });
    assert.equal(flags.flagSearchClause({ kind: 'none' }, []), null);
  });

  test('filter syntax is stripped before it reaches the database', () => {
    const plan = flags.planFlagSearch('ada),id.eq.1,(x');
    assert.equal(plan.kind, 'text');
    if (plan.kind !== 'text') return;
    assert.doesNotMatch(plan.userTerm, /[(),]/);
  });

  test('user matches are capped at the first hundred', () => {
    const ids = Array.from({ length: 150 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    const clause = flags.flagSearchClause(flags.planFlagSearch('ada'), ids) ?? '';
    assert.equal(clause.split(',').length, flags.SEARCH_USER_CAP);
    assert.equal(flags.SEARCH_USER_CAP, 100);
  });
});

describe('presenters', () => {
  test('the withdrawal presenter never returns a whole account number', () => {
    const summary = flags.presentWithdrawal(withdrawalRow({ account_number: ACCOUNT }));
    assert.equal(summary.account_number, '•••• 6789');
    assert.equal(JSON.stringify(summary).includes(ACCOUNT), false);
    assert.equal(flags.presentWithdrawal(withdrawalRow({ account_number: '1234' })).account_number, '••••');
    assert.equal(flags.presentWithdrawal(withdrawalRow({ account_number: null })).account_number, null);
    assert.equal(summary.status, 'pending_review');
    assert.equal(summary.amount, 750000);
  });

  test('another transaction’s metadata is masked and secrets are redacted', () => {
    const summary = flags.presentTransaction({
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
    assert.equal(flags.presentTransaction({ id: OTHER_FLAG_ID, metadata: null }).metadata, null);
  });

  test('an embedded user reads the same whether it arrives as an object or a one-item array', () => {
    const user = { username: 'ada' };
    assert.equal(flags.firstOf(user), user);
    assert.equal(flags.firstOf([user]), user);
    assert.equal(flags.firstOf([]), null);
    assert.equal(flags.firstOf(undefined), null);
  });
});

describe('route contract and hard rules', () => {
  const source = readFileSync(ROUTE, 'utf8');
  const lib = readFileSync(LIB, 'utf8');
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

  test('a list request without a page size still returns up to 200 flags, as the mobile app expects', () => {
    assert.match(getBody, /parsePageParams\(url, \{ defaultSize: 200, maxSize: 200 \}\)/);
  });

  test('the list keeps its status, search, type and date filters, per-status counts and ?id= detail', () => {
    for (const param of ['id', 'status', 'type', 'search', 'date_from', 'date_to', 'sort', 'dir', 'types']) {
      assert.match(getBody, new RegExp(`params\\.get\\('${param}'\\)`), param);
    }
    assert.match(source, /^\s*counts,\s*$/m);
    assert.match(source, /pagination: buildPagination\(/);
  });

  test('each action records only the review status it names', () => {
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['clear', 'cleared'],
      ['escalate', 'escalated'],
      ['reject', 'rejected'],
    ];
    for (const [action, status] of expected) {
      assert.match(source, new RegExp(`${action}: \\{ status: '${status}'`), action);
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

  test('the route takes its helpers from app/lib, never from a page folder', () => {
    assert.match(source, /from '\.\.\/\.\.\/lib\/flags';/);
    assert.doesNotMatch(source, /\(dashboard\)/);
  });

  test('the shared helpers are plain TypeScript with no React or Next imports', () => {
    assert.doesNotMatch(lib, /^['"]use client['"]/m);
    assert.doesNotMatch(lib, /from ['"](?:react|next)(?:\/[^'"]*)?['"]/);
    const imports = lib.split('\n').map((entry) => entry.trim()).filter((entry) => entry.startsWith('import '));
    assert.equal(imports.length, 4);
    for (const line of imports) assert.match(line, /from '\.\/(?:http|mask|redact|sanitize)';$/, line);
  });

  test('the route and the shared helpers carry no comments', () => {
    for (const [name, text] of [['route', source], ['lib', lib]] as const) {
      assert.ok(!/\/\*|(^|[^:])\/\/(?!\/)/m.test(text), `${name} has a comment`);
    }
  });
});

describe('retired Flagged page', () => {
  test('the page folder is gone while the API the mobile app calls stays', () => {
    assert.equal(existsSync(RETIRED_PAGE_DIR), false);
    assert.equal(existsSync(ROUTE), true);
  });

  test('nothing in the app links to the page; only the API path remains', () => {
    const files = sourceFiles(APP_DIR);
    assert.ok(files.includes(ROUTE));
    const offenders = files.filter((file) => /(?<!\/api)\/flagged-transactions\b/.test(readFileSync(file, 'utf8')));
    assert.deepEqual(offenders, []);
  });
});
