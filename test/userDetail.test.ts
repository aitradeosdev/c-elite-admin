import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ElementType } from 'react';
import { classesOf, loadAppModule, loadUi, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import type { ProfileData, SectionSeed, SectionView } from '../app/(dashboard)/users/[id]/model.ts';
import type { ApiBody, ApiFailure, ApiResult } from '../app/lib/apiClient.ts';

type UserDetailModel = typeof import('../app/(dashboard)/users/[id]/model.ts');
type UrlStateModule = typeof import('../app/_ui/useUrlState.ts');
type PermissionsModule = typeof import('../app/_ui/Permissions.tsx');

let model: UserDetailModel;
let url: UrlStateModule;
let perms: PermissionsModule;
let parts: Record<string, ElementType>;

before(async () => {
  model = await loadAppModule<UserDetailModel>('(dashboard)/users/[id]/model.ts');
  url = await loadUi<UrlStateModule>('useUrlState.ts');
  perms = await loadUi<PermissionsModule>('Permissions.tsx');
  parts = await loadAppModule<Record<string, ElementType>>('(dashboard)/users/[id]/UserParts.tsx');
});

const USER_ID = '3F2A9C1E-8B7D-4E6F-9A0B-1C2D3E4F5A6B';
const REFERRER_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function profileBody(patch: ApiBody = {}): ApiBody {
  return {
    success: true,
    user: {
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
      referred_by: REFERRER_ID,
      bonus_balance: 250,
      last_active_at: '2026-09-30T10:00:00.000Z',
      created_at: '2026-01-02T09:00:00.000Z',
      deleted_at: null,
      balance: 1500,
      avatar_url: null,
    },
    referrer: { id: REFERRER_ID, username: 'tolu', full_name: 'Tolu Ade' },
    stats: { trades: 12, withdrawals: 4, withdrawals_pending: 2, card_submissions: 7 },
    recentTransactions: [{ id: 't1' }, { id: 't2' }],
    devices: [{ id: 'd1' }],
    logins: [],
    totals: { transactions: 12, devices: 1, logins: 0 },
    page_size: { transactions: 10, devices: 20, logins: 20 },
    partial: { devices: null, logins: 'Sign-in records could not be read.', recent_transactions: null, stats: null, referrer: null },
    can: { freeze: true, transactions: true },
    ...patch,
  };
}

function failure(patch: Partial<ApiFailure>): ApiResult<ApiBody> {
  return {
    ok: false,
    error: {
      kind: 'http',
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'The account could not be frozen.',
      requestId: 'req_1',
      details: null,
      outcomeUnknown: false,
      ...patch,
    },
  };
}

function seed(patch: Partial<SectionSeed<unknown>> = {}): SectionSeed<unknown> {
  return { rows: [], total: 0, error: null, pageSize: null, ...patch };
}

function view(patch: Partial<SectionView> = {}): SectionView {
  return { page: 1, sort: { key: 'created_at', dir: 'desc' }, ...patch };
}

describe('readProfile', () => {
  test('reads the user, referrer, stats and partial notes, with a lower-cased id', () => {
    const profile = model.readProfile(profileBody());
    assert.ok(profile);
    assert.equal(profile.user.id, USER_ID.toLowerCase());
    assert.equal(profile.user.full_name, 'Ada Obi');
    assert.deepEqual(profile.referrer, { id: REFERRER_ID, username: 'tolu', full_name: 'Tolu Ade' });
    assert.deepEqual(profile.stats, { trades: 12, withdrawals: 4, withdrawals_pending: 2, card_submissions: 7 });
    assert.deepEqual(profile.partial, { stats: null, referrer: null });
  });

  test('no longer carries the server capability block', () => {
    const profile = model.readProfile(profileBody());
    assert.ok(profile);
    assert.equal('can' in profile, false);
  });

  test('rejects a body whose user has no valid id', () => {
    assert.equal(model.readProfile(profileBody({ user: { id: 'not-a-uuid' } })), null);
    assert.equal(model.readProfile(profileBody({ user: null })), null);
  });

  test('treats uncountable stats as unavailable rather than zero', () => {
    const profile = model.readProfile(profileBody({ stats: { trades: null, withdrawals: -1, withdrawals_pending: Number.NaN } }));
    assert.ok(profile);
    assert.deepEqual(profile.stats, { trades: null, withdrawals: null, withdrawals_pending: null, card_submissions: null });
  });

  test('toProfileResource keeps the raw body for section seeding', () => {
    const body = profileBody();
    const resource = model.toProfileResource(body);
    assert.ok(resource);
    assert.equal(resource.body, body);
    assert.equal(resource.profile.user.username, 'ada');
    assert.equal(model.toProfileResource(profileBody({ user: {} })), null);
  });
});

describe('sectionSeed', () => {
  test('maps each section to its rows, total, partial error and page size', () => {
    const body = profileBody();
    assert.deepEqual(model.sectionSeed(body, 'transactions'), {
      rows: [{ id: 't1' }, { id: 't2' }], total: 12, error: null, pageSize: 10,
    });
    assert.deepEqual(model.sectionSeed(body, 'devices'), { rows: [{ id: 'd1' }], total: 1, error: null, pageSize: 20 });
    assert.deepEqual(model.sectionSeed(body, 'logins'), {
      rows: [], total: 0, error: 'Sign-in records could not be read.', pageSize: 20,
    });
  });

  test('falls back to an empty, unknown seed when the body lacks the section', () => {
    const body = profileBody({ recentTransactions: 'x', totals: null, page_size: { transactions: 0 }, partial: null });
    assert.deepEqual(model.sectionSeed(body, 'transactions'), { rows: [], total: null, error: null, pageSize: null });
  });
});

describe('toSectionPage', () => {
  test('returns null unless items is an array, so the request reads as a failure', () => {
    assert.equal(model.toSectionPage({ success: true, total: 3 }), null);
    assert.equal(model.toSectionPage({ items: {} }), null);
  });

  test('keeps the rows and a finite, non-negative total', () => {
    assert.deepEqual(model.toSectionPage({ items: [{ id: 'a' }], total: 31 }), { rows: [{ id: 'a' }], total: 31 });
    assert.deepEqual(model.toSectionPage({ items: [], total: -2 }), { rows: [], total: null });
    assert.deepEqual(model.toSectionPage({ items: [], total: '4' }), { rows: [], total: null });
  });
});

describe('planSeed', () => {
  const spec = () => model.SECTIONS.transactions;

  test('applies a clean seed to the default view, whether or not the section was seeded before', () => {
    assert.equal(model.planSeed(spec(), view(), seed({ pageSize: 10 }), false), 'apply');
    assert.equal(model.planSeed(spec(), view(), seed({ pageSize: 10 }), true), 'apply');
    assert.equal(model.planSeed(spec(), view(), seed({ pageSize: null }), false), 'apply');
  });

  test('never seeds a page or sort the admin moved to; it refreshes that view once seeded', () => {
    assert.equal(model.planSeed(spec(), view({ page: 2 }), seed(), true), 'refresh');
    assert.equal(model.planSeed(spec(), view({ sort: { key: 'amount', dir: 'desc' } }), seed(), true), 'refresh');
    assert.equal(model.planSeed(spec(), view({ sort: { key: 'created_at', dir: 'asc' } }), seed(), true), 'refresh');
  });

  test('a seed error or a different server page size loads the section instead of seeding it', () => {
    assert.equal(model.planSeed(spec(), view(), seed({ error: 'The transaction ledger could not be read.' }), false), 'none');
    assert.equal(model.planSeed(spec(), view(), seed({ error: 'The transaction ledger could not be read.' }), true), 'refresh');
    assert.equal(model.planSeed(spec(), view(), seed({ pageSize: 25 }), false), 'none');
    assert.equal(model.planSeed(spec(), view(), seed({ pageSize: 25 }), true), 'refresh');
  });
});

describe('classifyAction', () => {
  test('a success is done, carrying the audit warning when there is one', () => {
    const ok = (data: ApiBody): ApiResult<ApiBody> => ({ ok: true, data, status: 200, requestId: 'req_ok' });
    assert.deepEqual(model.classifyAction(ok({ success: true, is_frozen: true })), { kind: 'done', warning: null });
    assert.deepEqual(
      model.classifyAction(ok({ success: true, warning: 'The account was frozen but could not be written to the audit log.' })),
      { kind: 'done', warning: 'The account was frozen but could not be written to the audit log.' },
    );
  });

  test('an outcome the client cannot know closes the dialog instead of offering a retry', () => {
    assert.deepEqual(model.classifyAction(failure({ kind: 'network', status: null, code: null, outcomeUnknown: true })), {
      kind: 'unknown',
    });
    assert.deepEqual(model.classifyAction(failure({ status: 502, code: null, outcomeUnknown: true })), { kind: 'unknown' });
    assert.deepEqual(model.classifyAction(failure({ kind: 'parse', status: 200, code: null, outcomeUnknown: true })), {
      kind: 'unknown',
    });
  });

  test('refusals a retry cannot fix are final', () => {
    for (const status of [401, 403, 404, 409]) {
      assert.deepEqual(model.classifyAction(failure({ status, code: 'STATE_CONFLICT', message: `refused ${status}` })), {
        kind: 'refused', status, message: `refused ${status}`,
      });
    }
  });

  test('a definite failure that might pass on a second try stays in the dialog', () => {
    for (const status of [400, 429, 500]) {
      assert.deepEqual(model.classifyAction(failure({ status, message: `failed ${status}` })), {
        kind: 'retry', message: `failed ${status}`,
      });
    }
  });
});

describe('actionNotice', () => {
  const user = { full_name: 'Ada Obi', username: 'ada' };

  test('confirms a freeze or unfreeze by handle', () => {
    assert.deepEqual(model.actionNotice('freeze', user, { kind: 'done', warning: null }), {
      text: '@ada is frozen. Withdrawals and bill payments are now refused.', tone: 'success',
    });
    assert.deepEqual(model.actionNotice('unfreeze', { full_name: 'Ada Obi', username: null }, { kind: 'done', warning: null }), {
      text: 'Ada Obi is unfrozen. Withdrawals and bill payments are allowed again.', tone: 'success',
    });
  });

  test('an audit warning replaces the success message', () => {
    assert.deepEqual(model.actionNotice('freeze', user, { kind: 'done', warning: 'Not audited.' }), {
      text: 'Not audited.', tone: 'warning',
    });
  });

  test('an unknown outcome says the account may or may not have changed', () => {
    assert.deepEqual(model.actionNotice('freeze', user, { kind: 'unknown' }), {
      text: model.UNKNOWN_ACTION_OUTCOME, tone: 'error',
    });
  });

  test('a refusal is shown as an error, except an expired session, which has its own dialog', () => {
    assert.deepEqual(model.actionNotice('freeze', user, { kind: 'refused', status: 409, message: 'This account is already frozen.' }), {
      text: 'This account is already frozen.', tone: 'error',
    });
    assert.equal(model.actionNotice('unfreeze', user, { kind: 'refused', status: 401, message: 'Session expired.' }), null);
  });
});

describe('UserParts', () => {
  function profile(): ProfileData {
    const read = model.readProfile(profileBody());
    assert.ok(read);
    return read;
  }

  function notices(user: Partial<ProfileData['user']>, pending: number | null): string {
    const base = profile();
    return render(createElement(parts.AccountNotices, {
      user: { ...base.user, ...user },
      stats: { ...base.stats, withdrawals_pending: pending },
    }));
  }

  test('the frozen notice keeps the reason, the refusal line and the review warning, without announcing', () => {
    const html = notices({ is_frozen: true, freeze_reason: 'Unusual activity on your account is under review.' }, 2);
    const text = textOf(html);
    assert.match(text, /Account frozen/);
    assert.match(text, /Unusual activity on your account is under review\./);
    assert.match(text, /Withdrawals and bill payments are refused, and the user sees this reason in the app\./);
    assert.match(
      text,
      /2 withdrawals are awaiting review and cannot be approved while the account is frozen\. Reject in Withdrawals to refund the wallet\./,
    );
    assert.equal(withClass(html, 'div', 'notice').length, 2);
    assert.doesNotMatch(html, /role="(alert|status)"/);
  });

  test('the frozen notice drops the review warning when nothing is waiting and says when no reason was given', () => {
    for (const pending of [0, null]) {
      const html = notices({ is_frozen: true, freeze_reason: null }, pending);
      assert.match(textOf(html), /No reason was recorded for this freeze\./);
      assert.doesNotMatch(textOf(html), /awaiting review/);
      assert.equal(withClass(html, 'div', 'notice').length, 1);
    }
  });

  test('the deletion notice replaces the frozen one and says when deletion was requested', () => {
    const text = textOf(notices({ is_frozen: true, deleted_at: '2026-09-30T08:00:00.000Z' }, 2));
    assert.match(text, /Deletion in progress/);
    assert.match(text, /This account is being deleted, so it cannot be frozen or unfrozen from here\./);
    assert.match(text, /Requested .+ WAT · .+ ago/);
    assert.doesNotMatch(text, /Account frozen/);
  });

  test('an active account shows no notice', () => {
    assert.equal(notices({}, 3), '');
  });

  test('the not-found state links back to the directory as a small secondary button', () => {
    const links = tagsOf(render(createElement(parts.NotFoundState)), 'a');
    assert.equal(links.length, 1);
    assert.equal(links[0].href, '/users');
    assert.deepEqual(classesOf(links[0]), ['btn', 'secondary', 'sm', 'link']);
  });

  test('the withdrawals hint turns amber only while withdrawals await review', () => {
    const base = profile();
    const kpis = (pending: number | null) => render(createElement(parts.ProfileKpis, {
      user: base.user,
      stats: { ...base.stats, withdrawals_pending: pending },
      canTransactions: true,
    }));
    assert.equal(withClass(kpis(2), 'div', 'kpiHintWarning').length, 1);
    assert.equal(withClass(kpis(0), 'div', 'kpiHintWarning').length, 0);
    assert.equal(withClass(kpis(null), 'div', 'kpiHintWarning').length, 0);
  });

  test('the loading header shows the freeze action only to admins who can freeze, and announces once', () => {
    const skeleton = (permissions: string[]) => render(createElement(
      perms.PermissionsProvider,
      { permissions, isSuperAdmin: false },
      createElement(parts.UserDetailSkeleton),
    ));
    const freezer = skeleton(['users.read', 'users.freeze']);
    assert.equal(withClass(freezer, 'div', 'pageHeaderAction').length, 2);
    assert.equal(withClass(skeleton(['users.read']), 'div', 'pageHeaderAction').length, 1);
    assert.equal(freezer.match(/role="status">Loading user</g)?.length, 1);
  });

  test('the loading header also keeps a place for Adjust wallet when the admin can adjust wallets', () => {
    const skeleton = (permissions: string[]) => render(createElement(
      perms.PermissionsProvider,
      { permissions, isSuperAdmin: false },
      createElement(parts.UserDetailSkeleton),
    ));
    assert.equal(withClass(skeleton(['users.read', 'wallets.adjust']), 'div', 'pageHeaderAction').length, 2);
    assert.equal(withClass(skeleton(['users.read', 'users.freeze', 'wallets.adjust']), 'div', 'pageHeaderAction').length, 3);
  });

  test('the Adjust wallet button sits in the header for admins who can adjust and accounts not being deleted', () => {
    const base = profile();
    const header = (user: ProfileData['user'], permissions: string[]) => render(createElement(
      perms.PermissionsProvider,
      { permissions, isSuperAdmin: false },
      createElement(parts.AdjustWalletButton, { user, onOpen: () => {} }),
    ));
    const shown = header(base.user, ['users.read', 'wallets.adjust']);
    assert.match(textOf(shown), /Adjust wallet/);
    assert.deepEqual(classesOf(tagsOf(shown, 'button')[0]), ['btn', 'secondary', 'sm']);
    assert.equal(header(base.user, ['users.read', 'users.freeze']), '');
    assert.equal(header({ ...base.user, deleted_at: '2026-09-30T08:00:00.000Z' }, ['users.read', 'wallets.adjust']), '');
    assert.match(textOf(header({ ...base.user, is_frozen: true }, ['users.read', 'wallets.adjust'])), /Adjust wallet/);
  });
});

describe('wallet adjustments on the user page', () => {
  test('only accounts that are not being deleted can be adjusted', () => {
    const user = { deleted_at: null, is_frozen: false, is_active: true };
    assert.equal(model.canAdjustWallet(user), true);
    assert.equal(model.canAdjustWallet({ ...user, is_frozen: true }), true);
    assert.equal(model.canAdjustWallet({ ...user, is_active: false }), true);
    assert.equal(model.canAdjustWallet({ ...user, deleted_at: '2026-09-30T08:00:00.000Z' }), false);
  });

  test('the transactions section names the adjustment types', () => {
    assert.equal(model.typeLabel('wallet_credit'), 'Wallet credit');
    assert.equal(model.typeLabel('wallet_debit'), 'Wallet debit');
    assert.equal(model.typeLabel('giftcard_credit'), 'Gift card credit');
  });
});

describe('section requests and the tab link', () => {
  test('sectionQuery names the section, page, limit and sort the route reads', () => {
    assert.equal(
      model.sectionQuery('devices', 3, 20, { key: 'last_seen_at', dir: 'asc' }),
      'section=devices&page=3&limit=20&sort=last_seen_at&dir=asc',
    );
  });

  test('?tab= deep links open a known section and the default tab stays out of the URL', () => {
    const codec = url.enumParam('tab', model.SECTION_ORDER, model.DEFAULT_SECTION);
    assert.equal(codec.parse(new URLSearchParams('tab=logins')), 'logins');
    assert.equal(codec.parse(new URLSearchParams('tab=devices')), 'devices');
    assert.equal(codec.parse(new URLSearchParams('tab=payouts')), 'transactions');
    assert.equal(codec.parse(new URLSearchParams('')), 'transactions');
    assert.deepEqual(codec.serialize('transactions'), { tab: null });
    assert.deepEqual(codec.serialize('devices'), { tab: 'devices' });
  });
});
