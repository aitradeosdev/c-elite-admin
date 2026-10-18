import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type Context, type ElementType } from 'react';
import { classesOf, loadAppModule, render, tagsOf, textOf, withClass, type Attrs } from './support/uiHarness.ts';
import {
  ALL_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  permissionStatus,
  type Permission,
} from '../app/lib/permissions.ts';

type ModelModule = typeof import('../app/(dashboard)/admin-permissions/model.ts');
type PartsModule = typeof import('../app/(dashboard)/admin-permissions/PermissionParts.tsx');
type PageModule = typeof import('../app/(dashboard)/admin-permissions/page.tsx');
type AccessModule = typeof import('../app/(dashboard)/_access/index.ts');
type AccountsModel = typeof import('../app/(dashboard)/admin-accounts/model.ts');
type Entry = import('../app/(dashboard)/admin-permissions/model.ts').PermissionEntry;
type View = import('../app/(dashboard)/admin-permissions/model.ts').PermissionsView;

let model: ModelModule;
let parts: PartsModule;
let page: PageModule;
let access: AccessModule;
let accounts: AccountsModel;

before(async () => {
  model = await loadAppModule<ModelModule>('(dashboard)/admin-permissions/model.ts');
  parts = await loadAppModule<PartsModule>('(dashboard)/admin-permissions/PermissionParts.tsx');
  page = await loadAppModule<PageModule>('(dashboard)/admin-permissions/page.tsx');
  access = await loadAppModule<AccessModule>('(dashboard)/_access/index.ts');
  accounts = await loadAppModule<AccountsModel>('(dashboard)/admin-accounts/model.ts');
});

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const OWNED_DIR = join(APP_DIR, '(dashboard)', 'admin-permissions');
const ROUTE_FILE = join(APP_DIR, 'api', 'admin-permissions', 'route.ts');
const TEST_FILE = fileURLToPath(import.meta.url);
const OWNED = ['PermissionParts.tsx', 'model.ts', 'page.module.css', 'page.tsx'];
const COMMENT = /\/\*|(^|[^:])\/\/(?!\/)/m;
const COLUMNS = ['Permission', 'Description', 'Category', 'Roles', 'Admins directly assigned', 'Risk', 'Status'];
const STATUS_TEXT = { enforced: 'In use', super_only: 'Super administrators only', reserved: 'Not in use yet' } as const;
const STATUS_TONE = { enforced: 'success', super_only: 'info', reserved: 'neutral' } as const;
const RISK_TONE = { critical: 'danger', high: 'warning', medium: 'neutral', low: 'neutral' } as const;

const nodeRequire = createRequire(import.meta.url);
const { SearchParamsContext } = nodeRequire('next/dist/shared/lib/hooks-client-context.shared-runtime') as {
  SearchParamsContext: Context<URLSearchParams | null>;
};

const noop = () => {};

const MANAGER = { id: '6F1D2C3B-4A5E-4F60-8A7B-9C0D1E2F3A4B', name: 'Manager' };
const AUDIT = { id: '11111111-1111-4111-8111-111111111111', name: 'Audit' };
const FINANCE = { id: '22222222-2222-4222-8222-222222222222', name: 'Finance' };
const NIGHT = { id: '33333333-3333-4333-8333-333333333333', name: 'Night shift' };
const SUPPORT = { id: '44444444-4444-4444-8444-444444444444', name: 'Support' };
const CLERK = { id: '55555555-5555-4555-8555-555555555555', username: 'clerk' };
const ADA = { id: '66666666-6666-4666-8666-666666666666', username: 'ada' };

const ROLES_BY_KEY: Partial<Record<Permission, Array<{ id: string; name: string }>>> = {
  'withdrawals.read': [AUDIT, FINANCE, MANAGER, NIGHT, SUPPORT],
  'withdrawals.approve': [MANAGER],
  'withdrawals.retry': [MANAGER],
};

const ADMINS_BY_KEY: Partial<Record<Permission, Array<{ id: string; username: string }>>> = {
  'withdrawals.read': [ADA, CLERK],
  'withdrawals.approve': [CLERK],
};

function legacyPages(key: Permission): string[] {
  return Object.keys(LEGACY_PERMISSION_MAP).filter((page) => LEGACY_PERMISSION_MAP[page].includes(key));
}

function apiEntry(key: Permission): Record<string, unknown> {
  const meta = PERMISSION_CATALOG[key];
  const admins = ADMINS_BY_KEY[key] ?? [];
  return {
    key,
    label: meta.label,
    description: meta.description,
    category: meta.category,
    risk: meta.risk,
    status: permissionStatus(key),
    legacy_pages: legacyPages(key),
    roles: ROLES_BY_KEY[key] ?? [],
    direct_admin_count: admins.length,
    direct_admins: admins,
  };
}

function apiBody(): Record<string, unknown> {
  return {
    success: true,
    request_id: 'req_permissions01',
    permissions: ALL_PERMISSIONS.map(apiEntry),
    categories: [...PERMISSION_CATEGORIES],
    super_admin_count: 1,
  };
}

function catalog(): Entry[] {
  const parsed = model.toPermissionList(apiBody());
  assert.ok(parsed);
  return parsed.permissions;
}

function entryOf(key: Permission): Entry {
  const found = catalog().find((entry) => entry.key === key);
  assert.ok(found, key);
  return found;
}

function keysOf(entries: readonly Entry[]): string[] {
  return entries.map((entry) => entry.key);
}

function view(patch: Partial<View> = {}): View {
  return { ...model.NO_FILTERS, ...patch };
}

function listProps(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rows: catalog(),
    loading: false,
    busy: false,
    error: null,
    retrying: false,
    empty: model.FILTERED_EMPTY,
    onOpen: noop,
    onRetry: noop,
    ...patch,
  };
}

function tableHtml(patch: Record<string, unknown> = {}): string {
  return render(createElement(parts.PermissionTable as ElementType, { openKey: null, ...listProps(patch) }));
}

function mobileHtml(patch: Record<string, unknown> = {}): string {
  return render(createElement(parts.PermissionMobileList as ElementType, listProps(patch)));
}

function detailsHtml(key: Permission): string {
  return render(createElement(parts.PermissionDetails as ElementType, { entry: entryOf(key), onClose: noop }));
}

function pageHtml(query = ''): string {
  return render(createElement(
    SearchParamsContext.Provider,
    { value: new URLSearchParams(query) },
    createElement(page.default as ElementType),
  ));
}

function headersOf(html: string): string[] {
  return [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((match) => textOf(match[1]));
}

function cellsOf(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => textOf(match[1]));
}

function rowFor(html: string, key: string): { tr: Attrs; html: string } {
  const found = html.split('<tr').filter((chunk) => chunk.includes(`data-permission-open="${key}"`));
  assert.equal(found.length, 1, key);
  const rowHtml = `<tr${found[0]}`;
  return { tr: tagsOf(rowHtml, 'tr')[0], html: rowHtml };
}

function mobileRowFor(html: string, key: string): { li: Attrs; html: string } {
  const found = html.split('<li').filter((chunk) => chunk.includes(`>${key}</code>`));
  assert.equal(found.length, 1, key);
  const rowHtml = `<li${found[0]}`;
  return { li: tagsOf(rowHtml, 'li')[0], html: rowHtml };
}

function selectBlock(html: string, label: string): string {
  const found = html.match(new RegExp(`<select\\b[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</select>`));
  assert.ok(found, label);
  return found[1];
}

function optionsOf(block: string): Array<{ value: string; text: string; selected: boolean }> {
  return [...block.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map((match) => {
    const attrs = tagsOf(`<option${match[1]}>`, 'option')[0];
    return { value: attrs.value ?? '', text: textOf(match[2]), selected: 'selected' in attrs };
  });
}

function sectionTexts(html: string): string[] {
  return [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => textOf(match[1]));
}

function itemsOf(html: string, label: string): string[] {
  const found = html.match(new RegExp(`<ul\\b[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</ul>`));
  assert.ok(found, label);
  return [...found[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => textOf(match[1]));
}

describe('the catalog model', () => {
  test('parses every permission the API lists, in its order, with roles, admins and page bundles', () => {
    const parsed = model.toPermissionList(apiBody());
    assert.ok(parsed);
    assert.equal(parsed.superAdminCount, 1);
    assert.deepEqual(keysOf(parsed.permissions), ALL_PERMISSIONS);
    for (const entry of parsed.permissions) {
      const meta = PERMISSION_CATALOG[entry.key];
      assert.deepEqual(
        [entry.label, entry.description, entry.category, entry.risk, entry.status],
        [meta.label, meta.description, meta.category, meta.risk, permissionStatus(entry.key)],
      );
      assert.deepEqual(entry.legacy_pages, legacyPages(entry.key));
    }
    assert.deepEqual(entryOf('withdrawals.approve'), {
      key: 'withdrawals.approve',
      label: 'Approve withdrawals',
      description: PERMISSION_CATALOG['withdrawals.approve'].description,
      category: 'Operations',
      risk: 'critical',
      status: 'enforced',
      legacy_pages: ['withdrawals'],
      roles: [{ id: MANAGER.id.toLowerCase(), name: 'Manager' }],
      direct_admin_count: 1,
      direct_admins: [CLERK],
    });
    assert.deepEqual(entryOf('roles.read').legacy_pages, ['admin_accounts']);
    assert.deepEqual(entryOf('users.freeze').legacy_pages, ['users_freeze']);
    assert.deepEqual(entryOf('flags.read').legacy_pages, []);
  });

  test('drops malformed rows, roles and admins, and refuses a body without a permission list', () => {
    const good = apiEntry('withdrawals.read');
    const parsed = model.toPermissionList({
      permissions: [
        null,
        'withdrawals.read',
        { ...good, key: 'withdrawals.fly' },
        { ...good, key: 'withdrawals' },
        { ...good, category: 'Payments' },
        { ...good, risk: 'severe' },
        { ...good, status: 'active' },
        {
          ...good,
          label: '',
          description: 7,
          legacy_pages: ['withdrawals', '', 3, null],
          roles: [MANAGER, { id: 'not-a-uuid', name: 'Ghost' }, { id: AUDIT.id }, null],
          direct_admin_count: -4,
          direct_admins: [CLERK, { id: 'nope', username: 'ghost' }, { id: ADA.id }],
        },
      ],
      super_admin_count: '2',
    });
    assert.ok(parsed);
    assert.equal(parsed.superAdminCount, 0);
    assert.deepEqual(parsed.permissions, [{
      key: 'withdrawals.read',
      label: 'withdrawals.read',
      description: '',
      category: 'Operations',
      risk: 'medium',
      status: 'enforced',
      legacy_pages: ['withdrawals'],
      roles: [{ id: MANAGER.id.toLowerCase(), name: 'Manager' }],
      direct_admin_count: 0,
      direct_admins: [CLERK, { id: ADA.id, username: '' }],
    }]);
    assert.equal(model.toPermissionList({}), null);
    assert.equal(model.toPermissionList({ permissions: { 'withdrawals.read': good } }), null);
  });

  test('the URL keeps the search and the three filters, and ignores values it does not know', () => {
    const parsed = model.PERMISSIONS_URL.parse(
      new URLSearchParams('search=%20approve%20&category=Risk+%26+Security&risk=critical&status=reserved&id=x'),
    );
    assert.deepEqual(parsed, { search: 'approve', category: 'Risk & Security', risk: 'critical', status: 'reserved' });
    assert.deepEqual(model.PERMISSIONS_URL.serialize(parsed), {
      search: 'approve', category: 'Risk & Security', risk: 'critical', status: 'reserved',
    });
    assert.deepEqual(
      model.PERMISSIONS_URL.parse(new URLSearchParams('category=Payments&risk=severe&status=active')),
      model.NO_FILTERS,
    );
    assert.deepEqual(model.PERMISSIONS_URL.serialize(model.NO_FILTERS), {
      search: null, category: null, risk: null, status: null,
    });
    assert.equal(model.PERMISSIONS_URL.parse(new URLSearchParams(`search=${'a'.repeat(80)}`)).search, 'a'.repeat(64));
    assert.equal(model.cleanSearch(`  ${'b'.repeat(70)}  `), 'b'.repeat(64));
  });

  test('the selects map their values onto the lists and anything else onto every value', () => {
    for (const category of PERMISSION_CATEGORIES) assert.equal(model.categoryFilter(category), category);
    for (const risk of ['critical', 'high', 'medium', 'low']) assert.equal(model.riskFilter(risk), risk);
    for (const status of ['enforced', 'super_only', 'reserved']) assert.equal(model.statusFilter(status), status);
    assert.deepEqual(
      [model.categoryFilter('Payments'), model.riskFilter('severe'), model.statusFilter('In use'), model.statusFilter('')],
      ['', '', '', ''],
    );
    assert.deepEqual(model.STATUS_ORDER, ['enforced', 'super_only', 'reserved']);
  });

  test('search matches the key, the label and the description, ignoring case, and nothing else', () => {
    const entries = catalog();
    const search = (text: string) => keysOf(model.visiblePermissions(entries, view({ search: text })));
    assert.deepEqual(search('APPROVE'), ['cards.review', 'withdrawals.approve', 'wallets.approve_adjustment', 'referrals.payout']);
    assert.deepEqual(search('withdrawals.re'), ['withdrawals.read', 'withdrawals.reject', 'withdrawals.retry', 'withdrawals.resolve']);
    assert.deepEqual(search('payment provider'), ['withdrawals.approve']);
    assert.deepEqual(search('operations'), ['analytics.read']);
    assert.deepEqual(search('manager'), []);
    assert.deepEqual(search('withdrawals'), search('  Withdrawals '));
    assert.equal(search('').length, ALL_PERMISSIONS.length);
  });

  test('category, risk and status narrow together, and no filter lists every permission', () => {
    const entries = catalog();
    const shown = (patch: Partial<View>) => keysOf(model.visiblePermissions(entries, view(patch)));
    assert.deepEqual(shown({ category: 'Operations', risk: 'critical' }), [
      'cards.review', 'withdrawals.approve', 'withdrawals.retry', 'withdrawals.resolve', 'reconciliation.resolve',
    ]);
    assert.deepEqual(shown({ category: 'Operations', risk: 'critical', status: 'enforced' }), ['cards.review', 'withdrawals.approve']);
    assert.deepEqual(shown({ category: 'Operations', risk: 'critical', status: 'reserved', search: 'withdrawal' }), [
      'withdrawals.retry', 'withdrawals.resolve',
    ]);
    for (const status of model.STATUS_ORDER) {
      assert.deepEqual(shown({ status }), ALL_PERMISSIONS.filter((key) => permissionStatus(key) === status));
    }
    assert.deepEqual(shown({ status: 'super_only' }), [
      'admin_users.read', 'admin_users.manage', 'admin_users.sessions', 'roles.read', 'roles.write',
    ]);
    assert.deepEqual(shown({}), ALL_PERMISSIONS);
  });

  test('the filter bar is active while any filter or unapplied search text is set', () => {
    assert.equal(model.isFiltered(model.NO_FILTERS, ''), false);
    assert.equal(model.isFiltered(model.NO_FILTERS, '   '), false);
    assert.equal(model.isFiltered(model.NO_FILTERS, 'appr'), true);
    const patches: Array<Partial<View>> = [{ search: 'a' }, { category: 'Users' }, { risk: 'low' }, { status: 'reserved' }];
    for (const patch of patches) assert.equal(model.isFiltered(view(patch), ''), true, JSON.stringify(patch));
  });

  test('header, roles, admin and page-bundle wording', () => {
    assert.equal(model.TITLE, 'Permissions');
    assert.equal(model.PERMISSIONS_PATH, '/api/admin-permissions');
    assert.equal(model.superAdminLine(null), 'Super administrators hold every permission');
    assert.equal(model.superAdminLine(1), 'Super administrators hold every permission (1)');
    assert.equal(model.superAdminLine(1200), 'Super administrators hold every permission (1,200)');
    const roles = [AUDIT, FINANCE, MANAGER, NIGHT, SUPPORT];
    assert.equal(model.rolesPreview([]), '');
    assert.equal(model.rolesPreview(roles.slice(0, 1)), 'Audit');
    assert.equal(model.rolesPreview(roles.slice(0, 3)), 'Audit, Finance, Manager');
    assert.equal(model.rolesPreview(roles.slice(0, 4)), 'Audit, Finance, Manager +1');
    assert.equal(model.rolesPreview(roles), 'Audit, Finance, Manager +2');
    assert.equal(model.directAdminsText(0), '0 admins directly assigned');
    assert.equal(model.directAdminsText(1), '1 admin directly assigned');
    assert.equal(model.mobileMeta(entryOf('withdrawals.read')), 'Operations · 5 roles · 2 admins directly assigned');
    assert.equal(model.mobileMeta(entryOf('flags.read')), 'Operations · No roles · 0 admins directly assigned');
    assert.equal(model.pageAccessLine('withdrawals'), 'Comes with Withdrawals page access');
    for (const pageKey of Object.keys(LEGACY_PERMISSION_MAP)) {
      assert.equal(model.pageAccessLine(pageKey), `Comes with ${accounts.grantLabel(pageKey)} page access`, pageKey);
    }
  });

  test('high and critical are the high-risk levels; critical flags in the danger tone', () => {
    assert.deepEqual(
      (['critical', 'high', 'medium', 'low'] as const).map((risk) => [model.isHighRisk(risk), model.highRiskFlag(risk)]),
      [[true, 'danger'], [true, 'warning'], [false, null], [false, null]],
    );
  });
});

describe('the permissions table', () => {
  test('has the seven columns in the planned order', () => {
    const html = tableHtml();
    assert.deepEqual(headersOf(html), COLUMNS);
    const admins = tagsOf(html, 'th').find((th) => classesOf(th).includes('wrapHead'));
    assert.ok(admins && classesOf(admins).includes('numeric'));
  });

  test('a row shows the label with its key in mono, the description, category, roles, direct count, risk and status', () => {
    const html = tableHtml();
    assert.equal(tagsOf(html, 'tr').length, ALL_PERMISSIONS.length + 1);
    const approve = rowFor(html, 'withdrawals.approve');
    assert.deepEqual(cellsOf(approve.html), [
      'Approve withdrawals withdrawals.approve',
      PERMISSION_CATALOG['withdrawals.approve'].description,
      'Operations',
      'Manager',
      '1',
      'Critical risk High risk',
      'In use',
    ]);
    assert.match(approve.html, /<code class="key">withdrawals\.approve<\/code>/);
    assert.deepEqual(cellsOf(rowFor(html, 'withdrawals.read').html).slice(3, 5), ['Audit, Finance, Manager +2', '2']);
    assert.deepEqual(cellsOf(rowFor(html, 'flags.read').html).slice(2), [
      'Operations', '—', '0', 'Medium risk', 'In use',
    ]);
    assert.equal(withClass(rowFor(html, 'flags.read').html, 'span', 'muted').length, 1);
  });

  test('high and critical permissions carry the High risk marker in their tone, the rest only the risk badge', () => {
    const html = tableHtml();
    for (const key of ALL_PERMISSIONS) {
      const { risk } = PERMISSION_CATALOG[key];
      const row = rowFor(html, key).html;
      const marks = withClass(row, 'span', 'highRisk');
      const badge = withClass(row, 'span', 'badge').find((attrs) => classesOf(attrs).includes(RISK_TONE[risk]));
      assert.ok(badge, `${key} has a ${risk} badge`);
      if (risk === 'critical' || risk === 'high') {
        assert.equal(marks.length, 1, key);
        assert.ok(classesOf(marks[0]).includes(risk === 'critical' ? 'highRiskCritical' : 'highRiskHigh'), key);
        assert.match(textOf(row), /High risk/, key);
      } else {
        assert.equal(marks.length, 0, key);
        assert.doesNotMatch(textOf(row), /High risk/, key);
      }
    }
  });

  test('the status badge reads In use, Super administrators only or Not in use yet, and only reserved rows are muted', () => {
    const html = tableHtml();
    const seen = new Set<string>();
    for (const key of ALL_PERMISSIONS) {
      const status = permissionStatus(key);
      const { tr, html: row } = rowFor(html, key);
      assert.equal(cellsOf(row)[6], STATUS_TEXT[status], key);
      const badge = withClass(row, 'span', 'badge').find((attrs) => classesOf(attrs).includes(STATUS_TONE[status]));
      assert.ok(badge, key);
      assert.equal(classesOf(tr).includes('reservedRow'), status === 'reserved', key);
      seen.add(status);
    }
    assert.deepEqual([...seen].sort(), ['enforced', 'reserved', 'super_only']);
    assert.deepEqual(parts.STATUS_LABEL, STATUS_TEXT);
    assert.equal(parts.STATUS_LABEL.reserved, access.STATUS_NOTE.reserved);
    assert.equal(parts.STATUS_LABEL.super_only, access.STATUS_NOTE.super_only);
  });

  test('every row opens the read-only details from a button that announces a dialog', () => {
    const html = tableHtml({ openKey: 'withdrawals.retry' });
    const opener = tagsOf(html, 'button').find((button) => button['data-permission-open'] === 'withdrawals.approve');
    assert.ok(opener);
    assert.equal(opener['aria-haspopup'], 'dialog');
    assert.equal(opener['aria-label'], 'Open Approve withdrawals');
    assert.ok(classesOf(opener).includes('name'));
    assert.equal(tagsOf(html, 'button').filter((button) => button['data-permission-open']).length, ALL_PERMISSIONS.length);
    assert.equal(tagsOf(html, 'tr').filter((tr) => classesOf(tr).includes('selected')).length, 1);
    assert.ok(classesOf(rowFor(html, 'withdrawals.retry').tr).includes('selected'));
    assert.ok(classesOf(rowFor(html, 'withdrawals.retry').tr).includes('interactive'));
  });

  test('loading shows a skeleton, a failed load offers a retry, and no match shows the empty state with its action', () => {
    const loading = tableHtml({ rows: [], loading: true });
    assert.match(textOf(loading), /Loading Permissions/);
    assert.equal(withClass(loading, 'tr', 'skeletonRow').length, 8);

    const failed = tableHtml({
      rows: [],
      error: { kind: 'http', status: 500, code: 'INTERNAL_ERROR', message: 'Permissions could not be loaded.', requestId: 'req_x', details: null, outcomeUnknown: false },
    });
    assert.match(textOf(failed), /The permission catalog could not be loaded/);
    assert.match(textOf(failed), /Permissions could not be loaded\./);
    assert.match(textOf(failed), /req_x/);
    assert.match(textOf(failed), /Try again/);

    const none = tableHtml({
      rows: [],
      empty: { ...model.FILTERED_EMPTY, actions: createElement('span', { className: 'clearProbe' }, 'Clear filters') },
    });
    assert.match(textOf(none), new RegExp(model.FILTERED_EMPTY.title));
    assert.match(textOf(none), /clear the filters/);
    assert.equal(withClass(none, 'span', 'clearProbe').length, 1);
  });
});

describe('the phone list', () => {
  test('shows the label, key, risk, status and counts, flags high risk and mutes reserved rows', () => {
    const html = mobileHtml();
    assert.equal(tagsOf(html, 'li').length, ALL_PERMISSIONS.length);
    const approve = mobileRowFor(html, 'withdrawals.approve');
    assert.ok(classesOf(approve.li).includes('flagDanger'));
    assert.equal(
      textOf(approve.html),
      'High risk Approve withdrawals Critical risk withdrawals.approve In use Operations · 1 role · 1 admin directly assigned',
    );
    const reject = mobileRowFor(html, 'withdrawals.reject');
    assert.ok(classesOf(reject.li).includes('flagWarning'));
    const read = mobileRowFor(html, 'withdrawals.read');
    assert.ok(!classesOf(read.li).includes('flagWarning') && !classesOf(read.li).includes('flagDanger'));
    assert.doesNotMatch(textOf(read.html), /High risk/);
    for (const key of ALL_PERMISSIONS) {
      const row = mobileRowFor(html, key);
      const muted = withClass(row.html, 'span', 'muted').length === 1;
      assert.equal(muted, permissionStatus(key) === 'reserved', key);
      assert.match(textOf(row.html), new RegExp(STATUS_TEXT[permissionStatus(key)]), key);
    }
  });

  test('loading, failure and the empty state follow the desktop table', () => {
    assert.match(textOf(mobileHtml({ rows: [], loading: true })), /Loading Permissions/);
    const failed = mobileHtml({
      rows: [],
      error: { kind: 'http', status: 500, code: 'INTERNAL_ERROR', message: 'Permissions could not be loaded.', requestId: null, details: null, outcomeUnknown: false },
    });
    assert.match(textOf(failed), /The permission catalog could not be loaded/);
    assert.match(textOf(failed), /Try again/);
    assert.match(textOf(mobileHtml({ rows: [] })), new RegExp(model.FILTERED_EMPTY.title));
  });
});

describe('permission details', () => {
  test('lists the roles, the directly assigned admins and the page access that includes the permission', () => {
    const html = detailsHtml('withdrawals.read');
    assert.equal(tagsOf(html, 'aside')[0]?.role, 'dialog');
    assert.match(html, /<code class="key">withdrawals\.read<\/code>/);
    assert.match(textOf(html), /^View withdrawals withdrawals\.read/);
    const sections = sectionTexts(html);
    assert.equal(sections.length, 4);
    assert.equal(
      sections[0],
      `${PERMISSION_CATALOG['withdrawals.read'].description} Category Operations Risk Medium risk Status In use`,
    );
    assert.match(sections[1], /^Roles · 5/);
    assert.match(sections[2], /^Admins directly assigned · 2/);
    assert.match(sections[3], /^Page access/);
    assert.deepEqual(itemsOf(html, 'Roles that grant this permission'), ['Audit', 'Finance', 'Manager', 'Night shift', 'Support']);
    assert.deepEqual(itemsOf(html, 'Admins directly assigned this permission'), ['@ada', '@clerk']);
    assert.deepEqual(itemsOf(html, 'Page access that includes this permission'), ['Comes with Withdrawals page access']);
  });

  test('a critical, not-in-use permission shows both, and empty sections say so', () => {
    const retry = detailsHtml('withdrawals.retry');
    assert.match(sectionTexts(retry)[0], /Risk Critical risk High risk Status Not in use yet$/);
    const flags = sectionTexts(detailsHtml('flags.read'));
    assert.equal(flags[1], `Roles · 0 ${model.NO_ROLES_TEXT}`);
    assert.equal(flags[2], `Admins directly assigned · 0 ${model.NO_DIRECT_TEXT}`);
    assert.equal(flags[3], `Page access ${model.NO_PAGES_TEXT}`);
    assert.deepEqual(itemsOf(detailsHtml('roles.read'), 'Page access that includes this permission'), [
      model.pageAccessLine('admin_accounts'),
    ]);
  });

  test('is read-only: the close button is the only control', () => {
    for (const key of ['withdrawals.read', 'roles.read', 'flags.read'] as const) {
      const html = detailsHtml(key);
      assert.deepEqual(tagsOf(html, 'button').map((button) => button['aria-label']), ['Close panel'], key);
      assert.equal(tagsOf(html, 'input').length + tagsOf(html, 'select').length + tagsOf(html, 'textarea').length, 0, key);
      assert.equal(tagsOf(html, 'a').length, 0, key);
    }
  });
});

describe('the page', () => {
  const source = () => readFileSync(join(OWNED_DIR, 'page.tsx'), 'utf8');

  test('wraps the page in Suspense and exports only the page component', () => {
    const text = source();
    assert.match(text, /^export default function PermissionsPage\(\) \{\n  return \(\n    <Suspense fallback=\{<PageFallback \/>\}>\n      <Permissions \/>/m);
    assert.deepEqual([...text.matchAll(/^export\b.*$/gm)].map((match) => match[0]), ['export default function PermissionsPage() {']);
    assert.deepEqual(Object.keys(page), ['default']);
  });

  test('renders the header, the search, the three filters and both list views while the catalog loads', () => {
    const html = pageHtml();
    assert.match(html, /<h1[^>]*>Permissions<\/h1>/);
    assert.match(textOf(html), /Super administrators hold every permission/);
    const search = tagsOf(html, 'input').find((input) => input['aria-label'] === 'Search permissions');
    assert.ok(search);
    assert.equal(search.placeholder, 'Permission, key or description');
    assert.equal(search.maxLength, '64');
    assert.deepEqual(optionsOf(selectBlock(html, 'Category')).map((option) => option.text), ['All categories', ...PERMISSION_CATEGORIES]);
    assert.deepEqual(optionsOf(selectBlock(html, 'Risk')).map((option) => [option.value, option.text]), [
      ['', 'All risk levels'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'],
    ]);
    assert.deepEqual(optionsOf(selectBlock(html, 'Status')).map((option) => [option.value, option.text]), [
      ['', 'All statuses'], ['enforced', 'In use'], ['super_only', 'Super administrators only'], ['reserved', 'Not in use yet'],
    ]);
    assert.doesNotMatch(textOf(html), /Clear filters/);
    assert.equal((textOf(html).match(/Loading Permissions/g) ?? []).length, 2);
    assert.deepEqual(headersOf(html), COLUMNS);
  });

  test('the search and the filters are read from the URL', () => {
    const html = pageHtml('search=approve&category=Operations&risk=critical&status=enforced');
    const search = tagsOf(html, 'input').find((input) => input['aria-label'] === 'Search permissions');
    assert.equal(search?.value, 'approve');
    const selected = (label: string) => optionsOf(selectBlock(html, label)).filter((option) => option.selected).map((option) => option.value);
    assert.deepEqual([selected('Category'), selected('Risk'), selected('Status')], [['Operations'], ['critical'], ['enforced']]);
    assert.match(textOf(html), /Clear filters/);
  });

  test('loads the catalog once from the permissions API, which still returns the fields the page reads', () => {
    const text = source();
    assert.match(text, /useResource<PermissionList>\(\n    'admin-permissions',\n    \(signal\) => apiRequest\(PERMISSIONS_PATH, \{ signal, select: toPermissionList \}\),\n  \);/);
    assert.equal((text.match(/apiRequest\(/g) ?? []).length, 1);
    assert.match(text, /const \[view, setView\] = useUrlState\(PERMISSIONS_URL\);/);
    const route = readFileSync(ROUTE_FILE, 'utf8');
    assert.match(route, /export async function GET\(\)/);
    for (const field of ['legacy_pages:', 'roles:', 'direct_admin_count:', 'direct_admins:', 'super_admin_count:']) {
      assert.ok(route.includes(field), field);
    }
  });

  test('the header line carries the super admin count from the API, and a 403 shows the access-denied screen', () => {
    const text = source();
    assert.match(text, /const subtitle = superAdminLine\(data \? data\.superAdminCount : null\);/);
    assert.equal((text.match(/<PageHeader title=\{TITLE\} subtitle=\{subtitle\} \/>/g) ?? []).length, 2);
    assert.match(
      text,
      /if \(list\.error\?\.status === 403 && data === undefined\) \{\s*return \(\s*<div>\s*<PageHeader title=\{TITLE\} subtitle=\{subtitle\} \/>\s*<AccessDenied title=\{DENIED_TITLE\} message=\{DENIED_MESSAGE\} \/>/,
    );
    assert.equal(model.DENIED_TITLE, 'Super administrators only');
  });

  test('both list views share one set of props, and a row opens the details panel for that permission', () => {
    const text = source();
    assert.match(text, /desktop=\{<PermissionTable \{\.\.\.shared\} openKey=\{openKey\} \/>\}/);
    assert.match(text, /mobile=\{<PermissionMobileList \{\.\.\.shared\} \/>\}/);
    assert.match(text, /const openEntry = openKey \? entries\.find\(\(entry\) => entry\.key === openKey\) \?\? null : null;/);
    assert.match(text, /\{openEntry \? \(\s*<PermissionDetails\s*key=\{openEntry\.key\}\s*entry=\{openEntry\}/);
    assert.match(text, /const rows = useMemo\(\(\) => visiblePermissions\(entries, view\), \[entries, view\]\);/);
    assert.match(text, /onDebouncedChange=\{applySearch\}/);
    assert.match(text, /onClear=\{clearFilters\}\n        active=\{isFiltered\(view, searchText\)\}/);
  });

  test('the page writes nothing and asks for nothing', () => {
    for (const name of ['page.tsx', 'PermissionParts.tsx', 'model.ts']) {
      const text = readFileSync(join(OWNED_DIR, name), 'utf8');
      assert.doesNotMatch(text, /method:|useConfirm|useToast|usePermissions|useCan\(/, name);
    }
  });
});

describe('owned sources', () => {
  const files = () => readdirSync(OWNED_DIR).sort();
  const code = () => files().filter((name) => /\.tsx?$/.test(name));
  const read = (name: string) => readFileSync(join(OWNED_DIR, name), 'utf8');

  test('the folder holds exactly the planned files', () => {
    assert.deepEqual(files(), OWNED);
  });

  test('carry no prose comments, no inline styles, no raw form controls and no permission literals', () => {
    for (const name of code()) {
      const text = read(name);
      assert.doesNotMatch(text, COMMENT, name);
      assert.doesNotMatch(text, /style=\{/, name);
      assert.doesNotMatch(text, /<(?:input|button|select|textarea)\b/, name);
      assert.doesNotMatch(text, /['"`][a-z_]+\.[a-z_]+['"`]/, name);
      assert.doesNotMatch(text, /from\s+['"][^'"]*\/lib\/(?:mfa|qr|session|jwt|supabase|guard|audit)(?:\.ts)?['"]/, name);
      assert.doesNotMatch(text, /\t|[ \t]+$|\r/m, name);
    }
    assert.doesNotMatch(readFileSync(TEST_FILE, 'utf8'), COMMENT);
  });

  test('the shared pieces come from the access UI and Admin accounts, not copies', () => {
    const partsSource = read('PermissionParts.tsx');
    assert.match(partsSource, /^import \{ RiskBadge, STATUS_NOTE \} from '\.\.\/_access';$/m);
    assert.match(partsSource, /^import \{ adminHandle \} from '\.\.\/admin-accounts\/model';$/m);
    assert.match(read('model.ts'), /^import \{ grantLabel, plural \} from '\.\.\/admin-accounts\/model';$/m);
    for (const name of code()) assert.doesNotMatch(read(name), /function (?:RiskBadge|plural|adminHandle|grantLabel)\b/, name);
    const badge = render(createElement(parts.RiskCell as ElementType, { risk: 'low' }));
    assert.equal(badge, `<span class="riskCell">${render(createElement(access.RiskBadge as ElementType, { risk: 'low' }))}</span>`);
  });

  test('the components are client modules and the model is not', () => {
    for (const name of ['page.tsx', 'PermissionParts.tsx']) assert.match(read(name), /^'use client';\n/, name);
    assert.doesNotMatch(read('model.ts'), /'use client'/);
  });

  test('the stylesheet uses tokens only and never scrolls sideways', () => {
    const css = read('page.module.css');
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
    for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      assert.doesNotMatch(value, colour, `${property}: ${value}`);
      assert.notEqual(property, 'z-index');
    }
    assert.doesNotMatch(css, /\/\*/);
    assert.doesNotMatch(css, /overflow-x|overflow: (?:auto|scroll)/);
    assert.doesNotMatch(css, /\t|[ \t]+$|\r/m);
  });

  test('every class the components use is defined, and none is left unused', () => {
    const used = new Set<string>();
    for (const name of code().filter((file) => file.endsWith('.tsx'))) {
      for (const [, className] of read(name).matchAll(/(?<![\w.])s\.([A-Za-z]\w*)/g)) used.add(className);
    }
    const defined = new Set([...read('page.module.css').matchAll(/\.([A-Za-z]\w*)/g)].map((match) => match[1]));
    assert.deepEqual([...used].filter((name) => !defined.has(name)).sort(), []);
    assert.deepEqual([...defined].filter((name) => !used.has(name)).sort(), []);
  });
});
