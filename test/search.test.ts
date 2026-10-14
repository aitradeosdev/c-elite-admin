import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { loadAppModule } from './support/uiHarness.ts';
import { resolvePermissions, type Permission } from '../app/lib/permissions.ts';
import type {
  GroupFailure, SearchContext, SearchGroupKey, SearchIntent, SearchItem, SearchResponse, SearchRunners,
} from '../app/lib/search.ts';

type SearchModule = typeof import('../app/lib/search.ts');
type Handler = (context: SearchContext) => Promise<readonly SearchItem[]>;

const search = await loadAppModule<SearchModule>('lib/search.ts');

const appText = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8');
const ROUTE = appText('api/search/route.ts');
const LIB = appText('lib/search.ts');

const USER_ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const OTHER_ID = '9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const ACCOUNT = '0123456789';
const ALL_KEYS: readonly SearchGroupKey[] = [
  'users', 'withdrawals', 'transactions', 'card_submissions', 'coupons',
];

function grants(...permissions: Permission[]): (permission: Permission) => boolean {
  const held = new Set<Permission>(permissions);
  return (permission) => held.has(permission);
}

function everything(): (permission: Permission) => boolean {
  const held = resolvePermissions(null, true);
  return (permission) => held.has(permission);
}

function legacy(...keys: string[]): (permission: Permission) => boolean {
  const held = resolvePermissions(keys, false);
  return (permission) => held.has(permission);
}

function item(id: string, extra: Partial<SearchItem> = {}): SearchItem {
  return { id, title: `Item ${id}`, subtitle: null, meta: null, status: null, href: `/somewhere?id=${id}`, ...extra };
}

function intent(kind: SearchIntent['kind'], needle: string): SearchIntent {
  return { kind, needle };
}

function runners(
  handlers: Partial<Record<SearchGroupKey, Handler>> = {},
  calls: Array<{ key: SearchGroupKey; context: SearchContext }> = [],
): SearchRunners {
  const entries = ALL_KEYS.map((key) => [key, async (context: SearchContext) => {
    calls.push({ key, context });
    const handler = handlers[key];
    return handler ? handler(context) : [item(`${key}-hit`)];
  }]);
  return Object.fromEntries(entries) as SearchRunners;
}

function hang(context: SearchContext): Promise<readonly SearchItem[]> {
  return new Promise((_resolve, reject) => {
    context.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

function commentCount(source: string): number {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const found = new Set<number>();
  const visit = (node: ts.Node) => {
    const ranges = [
      ...(ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(source, node.getEnd()) ?? []),
    ];
    for (const range of ranges) found.add(range.pos);
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  return found.size;
}

function groupKeys(response: SearchResponse): SearchGroupKey[] {
  return response.groups.map((group) => group.key);
}

function visibleText(entry: SearchItem): string {
  return [entry.title, entry.subtitle, entry.meta].filter(Boolean).join(' | ');
}

describe('reading the query and limit', () => {
  test('the query goes through sanitizeSearch and needs two characters', () => {
    assert.equal(search.readSearchQuery(null), '');
    assert.equal(search.readSearchQuery(undefined), '');
    assert.equal(search.readSearchQuery("  o'brien; drop%  "), 'obrien drop');
    assert.equal(search.readSearchQuery('a,b(c)d"e*f:g'), 'abcdefg');
    assert.equal(search.readSearchQuery('x'.repeat(80)).length, 64);
    assert.equal(search.isSearchable(''), false);
    assert.equal(search.isSearchable('a'), false);
    assert.equal(search.isSearchable('ab'), true);
    assert.equal(search.isSearchable('é'), false);
  });

  test('limit defaults to 5, clamps to 10 and ignores anything that is not a whole number', () => {
    const cases: Array<[string | null, number]> = [
      [null, 5], ['', 5], ['3', 3], [' 7 ', 7], ['1', 1], ['10', 10], ['11', 10], ['999999999999', 10],
      ['0', 5], ['-2', 5], ['2.5', 5], ['abc', 5], ['1e1', 5],
    ];
    for (const [raw, expected] of cases) assert.equal(search.parseSearchLimit(raw), expected, String(raw));
  });
});

describe('intent detection', () => {
  test('a UUID is an exact id lookup', () => {
    assert.deepEqual(search.detectIntent(USER_ID.toUpperCase()), intent('id', USER_ID));
  });

  test('@handles, emails and phone numbers are user searches', () => {
    assert.deepEqual(search.detectIntent('@John_Doe'), intent('username', 'john_doe'));
    assert.deepEqual(search.detectIntent('John.Doe@Example.com'), intent('email', 'john.doe@example.com'));
    assert.deepEqual(search.detectIntent('john@'), intent('email', 'john@'));
    for (const phone of ['08012345678', '+2348012345678', '2348012345678', '+234 801 234 5678', '0801-234-5678']) {
      assert.deepEqual(search.detectIntent(phone), intent('phone', '8012345678'), phone);
    }
  });

  test('ten digits are an account number, with or without separators', () => {
    for (const value of [ACCOUNT, '0123 456 789', '0123-456-789', '012.345.6789']) {
      assert.deepEqual(search.detectIntent(value), intent('account', ACCOUNT), value);
    }
  });

  test('everything else is a plain text search', () => {
    assert.deepEqual(search.detectIntent('amazon'), intent('text', 'amazon'));
    assert.deepEqual(search.detectIntent('John Doe'), intent('text', 'John Doe'));
    assert.deepEqual(search.detectIntent('12345'), intent('text', '12345'));
    assert.deepEqual(search.detectIntent('@john doe'), intent('text', '@john doe'));
    assert.deepEqual(search.detectIntent('@'), intent('text', '@'));
    assert.deepEqual(search.detectIntent('deadbeef-12'), intent('text', 'deadbeef-12'));
  });

  test('the needle of a sanitised query can never break a PostgREST filter', () => {
    const nasty = [
      'a,b', 'x)or(id.eq.1', 'name"quoted"', "o'neil", 'per%cent', 'star*', 'semi;colon', 'colon:value', 'back\\slash',
      'tab\there', '(id.eq.x)', 'a.b..c', '@we(ird', 'mail@x,y.com',
    ];
    for (const raw of nasty) {
      const query = search.readSearchQuery(raw);
      const { needle } = search.detectIntent(query);
      assert.doesNotMatch(needle, /[,()"'%*;:\\]/, raw);
    }
  });
});

describe('permission gating', () => {
  test('each group needs its own read permission', () => {
    const expected: Array<[Permission, SearchGroupKey[]]> = [
      ['users.read', ['users']],
      ['withdrawals.read', ['withdrawals']],
      ['transactions.read', ['transactions']],
      ['cards.read', ['card_submissions']],
      ['coupons.read', ['coupons']],
      ['flags.read', []],
      ['users.edit', []],
      ['cards.review', []],
      ['anomaly.read', []],
    ];
    for (const [permission, keys] of expected) {
      assert.deepEqual(search.permittedGroups(grants(permission)), keys, permission);
    }
  });

  test('the shell offers recent records for exactly the groups and permissions the server searches', () => {
    const shell = appText('(dashboard)/_shell/Shell.tsx');
    const start = shell.indexOf('const SEARCH_GROUP_PERMISSIONS');
    assert.ok(start >= 0);
    const table = shell.slice(start, shell.indexOf('];', start));
    const entries = [...table.matchAll(/\['(\w+)', \[([^\]]*)\]\]/g)]
      .map(([, key, needs]) => [key, [...needs.matchAll(/'([\w.]+)'/g)].map((match) => match[1])] as const);
    assert.deepEqual(Object.fromEntries(entries), search.SEARCH_GROUP_ACCESS);
  });

  test('legacy page keys and super admins resolve to the expected groups', () => {
    assert.deepEqual(search.permittedGroups(everything()), ALL_KEYS);
    assert.deepEqual(search.permittedGroups(legacy('withdrawals')), ['withdrawals']);
    assert.deepEqual(search.permittedGroups(legacy('card_queue')), ['card_submissions']);
    assert.deepEqual(search.permittedGroups(legacy('users', 'coupons', 'transactions_overview')), [
      'users', 'transactions', 'coupons',
    ]);
    assert.deepEqual(search.permittedGroups(legacy('dashboard', 'anomaly_alerts', 'rates_management')), []);
  });

  test('only permitted groups are searched and returned', async () => {
    const calls: Array<{ key: SearchGroupKey; context: SearchContext }> = [];
    const response = await search.executeSearch({
      rawQuery: 'john',
      rawLimit: null,
      can: grants('coupons.read', 'withdrawals.read'),
      runners: runners({}, calls),
    });
    assert.deepEqual(calls.map((call) => call.key).sort(), ['coupons', 'withdrawals']);
    assert.deepEqual(groupKeys(response).sort(), ['coupons', 'withdrawals']);
  });

  test('an admin without any read permission gets no groups and no queries', async () => {
    const calls: Array<{ key: SearchGroupKey; context: SearchContext }> = [];
    const response = await search.executeSearch({
      rawQuery: 'john',
      rawLimit: '5',
      can: grants('audit.read', 'users.edit', 'flags.resolve'),
      runners: runners({}, calls),
    });
    assert.deepEqual(response, { query: 'john', groups: [], partial: {} });
    assert.equal(calls.length, 0);
  });
});

describe('filters', () => {
  test('users match the same columns as the users list, narrowed by intent', () => {
    assert.equal(
      search.usersFilter(intent('text', 'john')),
      'full_name.ilike.%john%,username.ilike.%john%,email.ilike.%john%,phone.ilike.%john%',
    );
    assert.equal(search.usersFilter(intent('id', USER_ID)), `id.eq.${USER_ID}`);
    assert.equal(search.usersFilter(intent('username', 'john')), 'username.ilike.%john%');
    assert.equal(search.usersFilter(intent('email', 'john@x.com')), 'email.ilike.%john@x.com%');
    assert.equal(search.usersFilter(intent('phone', '8012345678')), 'phone.ilike.%8012345678%');
  });

  test('related groups resolve users the way their list routes do', () => {
    assert.equal(search.userMatchFilter(intent('id', USER_ID)), null);
    assert.equal(
      search.userMatchFilter(intent('text', 'john')),
      'full_name.ilike.%john%,username.ilike.%john%,email.ilike.%john%',
    );
    assert.equal(search.userMatchFilter(intent('username', 'john')), 'username.ilike.%john%');
    assert.equal(search.userMatchFilter(intent('phone', '8012345678')), 'phone.ilike.%8012345678%');
  });

  test('exact user lookups run for handles and complete emails only', () => {
    assert.deepEqual(search.exactUserMatch(intent('username', 'john_doe')), { column: 'username', value: 'john_doe' });
    assert.deepEqual(search.exactUserMatch(intent('email', 'john@x.com')), { column: 'email', value: 'john@x.com' });
    assert.equal(search.exactUserMatch(intent('email', 'john@')), null);
    assert.equal(search.exactUserMatch(intent('email', 'john@x')), null);
    assert.equal(search.exactUserMatch(intent('text', 'john')), null);
  });

  test('withdrawals search account fields and matched users; ids use indexed equality', () => {
    assert.equal(
      search.withdrawalsFilter(intent('text', 'john'), [USER_ID, 'not-an-id']),
      `user_id.in.(${USER_ID}),account_name.ilike.%john%,account_number.ilike.%john%,gateway_reference.ilike.%john%`,
    );
    assert.equal(
      search.withdrawalsFilter(intent('account', ACCOUNT), []),
      `account_name.ilike.%${ACCOUNT}%,account_number.ilike.%${ACCOUNT}%,gateway_reference.ilike.%${ACCOUNT}%`,
    );
    assert.equal(search.withdrawalsFilter(intent('email', 'john@x.com'), []), null);
    assert.equal(search.withdrawalsFilter(intent('username', 'john'), [USER_ID]), `user_id.in.(${USER_ID})`);
    assert.equal(
      search.withdrawalsFilter(intent('id', USER_ID), []),
      `id.eq.${USER_ID},user_id.eq.${USER_ID},gateway_reference.eq.${USER_ID}`,
    );
  });

  test('transactions match ids, references and matched users', () => {
    assert.equal(
      search.transactionsFilter(intent('id', USER_ID), []),
      `id.eq.${USER_ID},user_id.eq.${USER_ID},reference_id.eq.${USER_ID}`,
    );
    assert.equal(search.transactionsFilter(intent('text', 'DeadBeef'), []), 'reference_id.ilike.deadbeef%');
    assert.equal(search.transactionsFilter(intent('text', 'john'), []), null);
    assert.equal(search.transactionsFilter(intent('text', 'john'), [OTHER_ID]), `user_id.in.(${OTHER_ID})`);
    assert.equal(search.transactionsFilter(intent('email', 'deadbeef@x.com'), []), null);
  });

  test('card submissions match card brands for text and users otherwise', () => {
    assert.equal(search.searchesCardNames(intent('text', 'amazon')), true);
    assert.equal(search.searchesCardNames(intent('account', ACCOUNT)), false);
    assert.equal(search.searchesCardNames(intent('username', 'amazon')), false);
    assert.equal(search.cardNamePattern(intent('text', 'amazon')), '%amazon%');
    assert.equal(
      search.submissionsFilter(intent('text', 'amazon'), [USER_ID], [OTHER_ID]),
      `card_id.in.(${OTHER_ID}),user_id.in.(${USER_ID})`,
    );
    assert.equal(search.submissionsFilter(intent('text', 'amazon'), [], []), null);
    assert.equal(search.submissionsFilter(intent('id', USER_ID), [], []), `id.eq.${USER_ID},user_id.eq.${USER_ID}`);
  });

  test('coupons match code or brand like the coupons page, and ids exactly', () => {
    assert.equal(search.couponsFilter(intent('text', 'save')), 'code.ilike.%save%,type.ilike.%save%');
    assert.equal(search.couponsFilter(intent('id', USER_ID)), `id.eq.${USER_ID}`);
    assert.equal(search.couponsFilter(intent('email', 'save@x.com')), null);
    assert.equal(search.couponsFilter(intent('phone', '8012345678')), null);
  });

  test('id lists are validated, de-duplicated and capped at 100', () => {
    assert.equal(search.transactionsFilter(intent('text', 'john'), [USER_ID, USER_ID]), `user_id.in.(${USER_ID})`);
    const ids = Array.from({ length: 150 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    const filter = search.transactionsFilter(intent('text', 'john'), [...ids, 'x', ''.padEnd(36, 'z')]) ?? '';
    const listed = filter.slice('user_id.in.('.length, -1).split(',');
    assert.equal(listed.length, 100);
    assert.ok(listed.every((id) => /^[0-9a-f-]{36}$/.test(id)));
  });
});

describe('items, masking and formatting', () => {
  test('users show name, handle, email, Lagos join date and account state', () => {
    const user = search.toUserItem({
      id: USER_ID, full_name: ' Ada  Obi ', username: 'ada', email: 'ada@x.com',
      is_active: true, is_frozen: false, deleted_at: null, created_at: '2026-10-09T23:30:00Z',
    });
    assert.deepEqual(user, {
      id: USER_ID,
      title: 'Ada Obi',
      subtitle: '@ada · ada@x.com',
      meta: 'Joined 10 Oct 2026',
      status: 'active',
      href: `/users/${USER_ID}`,
    });
    const handleOnly = search.toUserItem({
      id: USER_ID, full_name: null, username: 'ada', email: null,
      is_active: null, is_frozen: null, deleted_at: null, created_at: null,
    });
    assert.equal(handleOnly.title, '@ada');
    assert.equal(handleOnly.subtitle, null);
    assert.equal(handleOnly.meta, null);
    assert.equal(handleOnly.status, 'inactive');
    const base = { id: USER_ID, full_name: 'A', username: null, email: null, created_at: null };
    assert.equal(search.toUserItem({ ...base, is_active: true, is_frozen: true, deleted_at: null }).status, 'frozen');
    assert.equal(search.toUserItem({ ...base, is_active: true, is_frozen: true, deleted_at: '2026-01-01' }).status, 'deleted');
  });

  test('withdrawals never show the full account number', () => {
    const withdrawal = search.toWithdrawalItem({
      id: OTHER_ID, user_id: USER_ID, amount: '50000.00', bank_name: 'GTBank', account_number: ACCOUNT,
      account_name: 'ADA OBI', status: 'pending_review', created_at: '2026-10-09T13:05:00Z',
    }, { username: 'ada' });
    assert.deepEqual(withdrawal, {
      id: OTHER_ID,
      title: '₦50,000.00 payout for @ada',
      subtitle: 'GTBank · •••• 6789 · ADA OBI',
      meta: '09 Oct 2026, 14:05 WAT',
      status: 'pending_review',
      href: `/withdrawals?id=${OTHER_ID}`,
    });
    assert.ok(!JSON.stringify(withdrawal).includes(ACCOUNT));
    const spaced = search.toWithdrawalItem({
      id: OTHER_ID, user_id: null, amount: null, bank_name: null, account_number: '0123 456 789',
      account_name: null, status: null, created_at: null,
    }, null);
    assert.equal(spaced.title, 'Withdrawal');
    assert.equal(spaced.subtitle, '•••• 6789');
  });

  test('free text on withdrawals cannot carry an account number either', () => {
    const withdrawal = search.toWithdrawalItem({
      id: 'w', user_id: null, amount: 1234567890, bank_name: `Bank ${ACCOUNT}`, account_number: ACCOUNT,
      account_name: `Paid from 2${ACCOUNT}`, status: 'success', created_at: '2026-10-09T13:05:00Z',
    }, { full_name: 'Ada Obi' });
    assert.equal(withdrawal.subtitle, 'Bank •••• 6789 · •••• 6789 · Paid from •••• 6789');
    assert.equal(withdrawal.title, '₦1,234,567,890.00 payout for Ada Obi');
    assert.doesNotMatch(visibleText(withdrawal), /\d{10}/);
  });

  test('transactions and card submissions read as naira and Lagos time', () => {
    const transaction = search.toTransactionItem({
      id: USER_ID, type: 'withdrawal', amount: 1234567.5, status: 'success', created_at: '2026-10-09T13:05:00Z',
      users: [{ username: null, full_name: 'Ada Obi', email: 'ada@x.com' }],
    }, 'Withdrawal');
    assert.deepEqual(transaction, {
      id: USER_ID,
      title: 'Withdrawal · ₦1,234,567.50',
      subtitle: 'Ada Obi',
      meta: '09 Oct 2026, 14:05 WAT',
      status: 'success',
      href: `/transactions-overview?id=${USER_ID}`,
    });
    const submission = search.toSubmissionItem({
      id: USER_ID, payout_naira: 45000, status: 'pending', created_at: '2026-10-09T13:05:00Z',
      cards: { name: 'Amazon' }, card_types: [{ name: 'E-code', country_code: 'US' }], users: { username: 'ada' },
    });
    assert.deepEqual(submission, {
      id: USER_ID,
      title: 'Amazon · E-code · US',
      subtitle: '@ada',
      meta: '₦45,000.00 payout · 09 Oct 2026, 14:05 WAT',
      status: 'pending',
      href: `/card-queue?id=${USER_ID}`,
    });
  });

  test('coupons show code, brand, bonus and the Lagos end date', () => {
    const today = '2026-10-09';
    const live = search.toCouponItem({
      id: USER_ID, code: 'SAVE500', brand: 'Amazon', bonus: 500, expiry: '2026-10-31', state: 'live',
    }, today);
    assert.deepEqual(live, {
      id: USER_ID,
      title: 'SAVE500',
      subtitle: 'Amazon · ₦500.00 bonus',
      meta: 'Ends 31 Oct 2026',
      status: 'active',
      href: `/coupons?id=${USER_ID}`,
    });
    const ended = search.toCouponItem({
      id: USER_ID, code: 'OLD', brand: '', bonus: 0, expiry: '2026-10-08', state: 'disabled',
    }, today);
    assert.equal(ended.subtitle, 'No brand');
    assert.equal(ended.meta, 'Ended 08 Oct 2026');
    assert.equal(ended.status, 'disabled');
    const open = search.toCouponItem({
      id: USER_ID, code: 'FOREVER', brand: 'Steam', bonus: null, expiry: null, state: 'used_up',
    }, today);
    assert.equal(open.meta, 'No end date');
    assert.equal(open.status, 'used_up');
    assert.equal(search.couponItemStatus('expired'), 'expired');
    assert.equal(search.couponItemStatus('no_brand'), 'no_brand');
  });
});

describe('links', () => {
  test('every item deep-links to the record on its page', () => {
    assert.equal(search.itemHref('users', USER_ID), `/users/${USER_ID}`);
    assert.equal(search.itemHref('withdrawals', USER_ID), `/withdrawals?id=${USER_ID}`);
    assert.equal(search.itemHref('transactions', USER_ID), `/transactions-overview?id=${USER_ID}`);
    assert.equal(search.itemHref('card_submissions', USER_ID), `/card-queue?id=${USER_ID}`);
    assert.equal(search.itemHref('coupons', USER_ID), `/coupons?id=${USER_ID}`);
    assert.equal(search.itemHref('users', 'a/b?c'), '/users/a%2Fb%3Fc');
  });

  test('the pages behind each link accept the id deep link', () => {
    assert.match(appText('(dashboard)/withdrawals/page.tsx'), /id: uuidParam\('id'\)/);
    assert.match(appText('(dashboard)/transactions-overview/page.tsx'), /id: uuidParam\('id'\)/);
    assert.match(appText('(dashboard)/card-queue/CardQueue.tsx'), /uuidParam\('id'\)/);
    assert.match(appText('(dashboard)/coupons/page.tsx'), /id: uuidParam\('id'\)/);
    assert.ok(appText('(dashboard)/users/[id]/page.tsx').length > 0);
  });

  test('"see all" uses each list page\'s real search parameter, or nothing when there is none', () => {
    assert.equal(search.moreHref('users', intent('text', 'ada obi')), '/users?search=ada+obi');
    assert.equal(search.moreHref('users', intent('username', 'ada')), '/users?search=ada');
    assert.equal(search.moreHref('users', intent('email', 'ada@x.com')), '/users?search=ada%40x.com');
    assert.equal(search.moreHref('users', intent('phone', '8012345678')), '/users?search=8012345678');
    assert.equal(search.moreHref('transactions', intent('text', 'ada')), '/transactions-overview?search=ada');
    assert.equal(search.moreHref('transactions', intent('id', USER_ID)), `/transactions-overview?search=${USER_ID}`);
    assert.equal(search.moreHref('transactions', intent('phone', '8012345678')), null);
    assert.equal(search.moreHref('coupons', intent('text', 'save')), '/coupons?q=save');
    assert.equal(search.moreHref('coupons', intent('id', USER_ID)), null);
    assert.equal(search.moreHref('coupons', intent('email', 'save@x.com')), null);
    for (const key of ['withdrawals', 'card_submissions'] as const) {
      assert.equal(search.moreHref(key, intent('text', 'ada')), null, key);
    }
  });

  test('the search parameters match the pages\' URL codecs', () => {
    assert.match(appText('(dashboard)/users/model.ts'), /search: stringParam\('search'/);
    assert.match(appText('(dashboard)/transactions-overview/page.tsx'), /stringParam\('search'/);
    assert.match(appText('(dashboard)/coupons/page.tsx'), /q: stringParam\('q'/);
    assert.doesNotMatch(appText('(dashboard)/withdrawals/page.tsx'), /stringParam\(/);
    assert.doesNotMatch(appText('(dashboard)/card-queue/CardQueue.tsx'), /stringParam\(/);
  });
});

describe('running a search', () => {
  test('short or empty queries return an empty result without searching', async () => {
    for (const raw of [null, '', 'a', '  b  ', "'%", '@']) {
      const calls: Array<{ key: SearchGroupKey; context: SearchContext }> = [];
      const response = await search.executeSearch({
        rawQuery: raw, rawLimit: null, can: everything(), runners: runners({}, calls),
      });
      assert.deepEqual(response, { query: search.readSearchQuery(raw), groups: [], partial: {} }, String(raw));
      assert.equal(calls.length, 0, String(raw));
    }
  });

  test('the response has exactly the contract shape', async () => {
    const response = await search.executeSearch({
      rawQuery: 'ada', rawLimit: null, can: everything(), runners: runners(),
    });
    assert.deepEqual(Object.keys(response).sort(), ['groups', 'partial', 'query']);
    assert.equal(response.query, 'ada');
    assert.deepEqual(response.partial, {});
    assert.deepEqual(groupKeys(response), ALL_KEYS);
    for (const group of response.groups) {
      assert.deepEqual(Object.keys(group).sort(), ['items', 'key', 'label', 'more_href']);
      assert.equal(group.label, search.SEARCH_GROUP_LABELS[group.key]);
      for (const entry of group.items) {
        assert.deepEqual(Object.keys(entry).sort(), ['href', 'id', 'meta', 'status', 'subtitle', 'title']);
      }
    }
    assert.equal(response.groups.find((group) => group.key === 'users')?.more_href, '/users?search=ada');
    assert.equal(response.groups.find((group) => group.key === 'withdrawals')?.more_href, null);
  });

  test('every runner gets the sanitised query, its intent, the limit and one shared signal', async () => {
    const calls: Array<{ key: SearchGroupKey; context: SearchContext }> = [];
    await search.executeSearch({
      rawQuery: ' @Ada_O ', rawLimit: '3', can: everything(), runners: runners({}, calls),
    });
    assert.equal(calls.length, ALL_KEYS.length);
    const signals = new Set(calls.map((call) => call.context.signal));
    assert.equal(signals.size, 1);
    for (const { context } of calls) {
      assert.equal(context.query, '@Ada_O');
      assert.deepEqual(context.intent, intent('username', 'ada_o'));
      assert.equal(context.limit, 3);
    }
  });

  test('items are capped at the limit, de-duplicated, and empty groups are left out', async () => {
    const many = Array.from({ length: 8 }, (_, index) => item(`u${index}`));
    const response = await search.executeSearch({
      rawQuery: 'ada',
      rawLimit: '4',
      can: everything(),
      runners: runners({
        users: async () => [item('u0'), ...many],
        withdrawals: async () => [],
        coupons: async () => [],
      }),
    });
    const users = response.groups.find((group) => group.key === 'users');
    assert.deepEqual(users?.items.map((entry) => entry.id), ['u0', 'u1', 'u2', 'u3']);
    assert.deepEqual(groupKeys(response), ['users', 'transactions', 'card_submissions']);
    assert.deepEqual(response.partial, {});
  });

  test('a failing group goes to partial and the rest still answer', async () => {
    const failures: GroupFailure[] = [];
    const response = await search.executeSearch({
      rawQuery: 'ada@secret.com',
      rawLimit: null,
      can: everything(),
      onFailure: (failure) => failures.push(failure),
      runners: runners({
        withdrawals: async () => {
          throw new search.SearchQueryError('PGRST100');
        },
        transactions: () => {
          throw new TypeError('ada@secret.com exploded');
        },
      }),
    });
    assert.deepEqual(response.partial, {
      withdrawals: 'Withdrawals could not be searched.',
      transactions: 'Transactions could not be searched.',
    });
    assert.deepEqual(groupKeys(response), ['users', 'card_submissions', 'coupons']);
    assert.deepEqual(failures, [
      { key: 'withdrawals', status: 'failed', code: 'PGRST100' },
      { key: 'transactions', status: 'failed', code: 'TypeError' },
    ]);
    assert.ok(!JSON.stringify(failures).includes('secret'));
  });

  test('a slow group times out inside the budget and its queries are aborted', async () => {
    let aborted = false;
    const failures: GroupFailure[] = [];
    const started = Date.now();
    const response = await search.executeSearch({
      rawQuery: 'ada',
      rawLimit: null,
      can: everything(),
      budgetMs: 40,
      onFailure: (failure) => failures.push(failure),
      runners: runners({
        card_submissions: (context) => {
          context.signal.addEventListener('abort', () => {
            aborted = true;
          });
          return hang(context);
        },
        coupons: async () => {
          throw new search.SearchQueryError('57014');
        },
      }),
    });
    assert.ok(Date.now() - started < 2000);
    assert.equal(aborted, true);
    assert.deepEqual(response.partial, {
      card_submissions: 'Card submissions took too long to search.',
      coupons: 'Coupons could not be searched.',
    });
    assert.deepEqual(failures, [
      { key: 'card_submissions', status: 'timeout', code: 'timeout' },
      { key: 'coupons', status: 'failed', code: '57014' },
    ]);
    assert.deepEqual(groupKeys(response), ['users', 'withdrawals', 'transactions']);
  });

  test('a closed request stops the search straight away', async () => {
    const outer = new AbortController();
    const started = Date.now();
    const pending = search.executeSearch({
      rawQuery: 'ada',
      rawLimit: null,
      can: grants('users.read'),
      budgetMs: 60000,
      signal: outer.signal,
      runners: runners({ users: hang }),
    });
    setTimeout(() => outer.abort(), 10);
    const response = await pending;
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual(response.partial, { users: 'Users took too long to search.' });
    assert.deepEqual(response.groups, []);
  });

  test('settleWithin keeps an early failure as a failure even when another task times out', async () => {
    const outcomes = await search.settleWithin<number>([
      async () => 1,
      async () => {
        throw new Error('early');
      },
      (signal) => new Promise<number>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('late')), { once: true });
      }),
      () => {
        throw new Error('sync');
      },
    ], 30);
    assert.deepEqual(outcomes.map((outcome) => outcome.status), ['ok', 'failed', 'timeout', 'failed']);
    assert.deepEqual(outcomes[0], { status: 'ok', value: 1 });
  });

  test('an account number puts withdrawals first and keeps the number out of every item', async () => {
    const response = await search.executeSearch({
      rawQuery: '0123 456 789',
      rawLimit: null,
      can: everything(),
      runners: runners({
        withdrawals: async () => [search.toWithdrawalItem({
          id: OTHER_ID, user_id: null, amount: 1000, bank_name: 'GTBank', account_number: ACCOUNT,
          account_name: 'ADA OBI', status: 'success', created_at: null,
        }, null)],
      }),
    });
    assert.equal(response.groups[0].key, 'withdrawals');
    assert.ok(!JSON.stringify(response.groups.map((group) => group.items)).includes(ACCOUNT));
    assert.equal(response.groups[0].items[0].subtitle, 'GTBank · •••• 6789 · ADA OBI');
    assert.equal(response.groups[0].more_href, null);
  });

  test('an id search lists the group holding that exact record first', async () => {
    const response = await search.executeSearch({
      rawQuery: OTHER_ID.toUpperCase(),
      rawLimit: null,
      can: everything(),
      runners: runners({
        users: async () => [item(USER_ID)],
        withdrawals: async () => [],
        card_submissions: async () => [item(OTHER_ID)],
        coupons: async () => [],
      }),
    });
    assert.deepEqual(groupKeys(response), ['card_submissions', 'users', 'transactions']);
  });

  test('user-shaped searches keep users first', async () => {
    for (const raw of ['@ada', 'ada@x.com', '08012345678']) {
      const response = await search.executeSearch({
        rawQuery: raw, rawLimit: null, can: everything(), runners: runners(),
      });
      assert.equal(response.groups[0].key, 'users', raw);
    }
  });

  test('failure codes never carry free text', () => {
    assert.equal(search.failureCode(new search.SearchQueryError('PGRST100')), 'PGRST100');
    assert.equal(search.failureCode(new search.SearchQueryError('bad code; drop table')), 'unknown');
    assert.equal(search.failureCode(new search.SearchQueryError(undefined)), 'unknown');
    assert.equal(search.failureCode(new RangeError('ada@x.com')), 'RangeError');
    assert.equal(search.failureCode('ada@x.com'), 'unexpected');
    assert.equal(search.partialMessage('card_submissions', 'failed'), 'Card submissions could not be searched.');
  });
});

describe('route source', () => {
  test('any signed-in admin may call it; groups are gated through the admin context', () => {
    assert.match(ROUTE, /requireAdmin\(\)/);
    assert.doesNotMatch(ROUTE, /requireAdmin\(['"]|requireAdminAny|requireAdminAll|requireSuperAdmin/);
    assert.match(ROUTE, /can: guard\.admin\.can/);
    assert.doesNotMatch(ROUTE, /fail\(/);
  });

  test('every query is bounded and abortable', () => {
    const chains = ROUTE.split(/supabaseAdmin\s*\.from\(/).slice(1);
    assert.ok(chains.length >= 6);
    for (const chain of chains) {
      const query = chain.split(/\);\n|\),\n/)[0];
      assert.match(query, /\.limit\(/, chain.slice(0, 40));
      assert.match(query, /\.abortSignal\((?:context\.)?signal$/, chain.slice(0, 40));
    }
  });

  test('it never reads card codes, images or metadata, and never writes', () => {
    assert.doesNotMatch(ROUTE, /submitted_fields|card_images|dispute_images|metadata|pin_hash|select\('\*'\)/);
    assert.doesNotMatch(ROUTE, /writeAudit|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
    assert.match(ROUTE, /'Cache-Control': 'no-store'/);
  });

  test('it never logs the query or anything derived from it', () => {
    const logs = ROUTE.match(/console\.\w+\([^;]*;/g) ?? [];
    assert.equal(logs.length, 1);
    for (const log of logs) assert.doesNotMatch(log, /query|needle|intent|params|filter|rawQuery/);
    assert.doesNotMatch(LIB, /console\./);
  });

  test('the search files stay comment-free', () => {
    const slash = '/';
    assert.equal(commentCount(`const a = 1; ${slash}${slash} note\n${slash}* block *${slash} const b = 2;`), 2);
    const own = readFileSync(new URL(import.meta.url), 'utf8');
    for (const [name, source] of [['route', ROUTE], ['lib', LIB], ['test', own]] as const) {
      assert.equal(commentCount(source), 0, name);
    }
  });
});
