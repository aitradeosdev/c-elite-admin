import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ElementType } from 'react';
import { loadAppModule, render, tagsOf, textById, textOf, withClass, type Attrs } from './support/uiHarness.ts';
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  RESOURCE_LABELS,
  actionLabel,
  permissionStatus,
  resourceOf,
  type Permission,
} from '../app/lib/permissions.ts';

type MatrixModule = typeof import('../app/(dashboard)/_access/PermissionMatrix.tsx');
type StoredKeysModule = typeof import('../app/(dashboard)/_access/StoredKeys.tsx');
type ImpactModule = typeof import('../app/(dashboard)/_access/ImpactList.tsx');
type PartsModule = typeof import('../app/(dashboard)/_access/GrantParts.tsx');
type BarrelModule = typeof import('../app/(dashboard)/_access/index.ts');
type GrantsModule = typeof import('../app/lib/grants.ts');
type RolesModule = typeof import('../app/lib/roles.ts');

let matrix: MatrixModule;
let stored: StoredKeysModule;
let impacts: ImpactModule;
let parts: PartsModule;
let barrel: BarrelModule;
let grants: GrantsModule;
let roles: RolesModule;

before(async () => {
  matrix = await loadAppModule<MatrixModule>('(dashboard)/_access/PermissionMatrix.tsx');
  stored = await loadAppModule<StoredKeysModule>('(dashboard)/_access/StoredKeys.tsx');
  impacts = await loadAppModule<ImpactModule>('(dashboard)/_access/ImpactList.tsx');
  parts = await loadAppModule<PartsModule>('(dashboard)/_access/GrantParts.tsx');
  barrel = await loadAppModule<BarrelModule>('(dashboard)/_access/index.ts');
  grants = await loadAppModule<GrantsModule>('lib/grants.ts');
  roles = await loadAppModule<RolesModule>('lib/roles.ts');
});

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const ACCESS_DIR = join(APP_DIR, '(dashboard)', '_access');
const ORIGINAL_PARTS = join(APP_DIR, '(dashboard)', 'admin-accounts', 'GrantParts.tsx');
const MANAGER = 'From role Manager';
const noop = () => {};

const RESOURCES: ReadonlyArray<{ resource: string; actions: Permission[] }> = PERMISSION_CATEGORIES.flatMap((category) => {
  const rows = new Map<string, Permission[]>();
  for (const key of ALL_PERMISSIONS.filter((permission) => PERMISSION_CATALOG[permission].category === category)) {
    rows.set(resourceOf(key), [...(rows.get(resourceOf(key)) ?? []), key]);
  }
  return Array.from(rows, ([resource, actions]) => ({ resource, actions }));
});

function rowOf(resource: string): Permission[] {
  const row = RESOURCES.find((entry) => entry.resource === resource);
  assert.ok(row, resource);
  return row.actions;
}

function matrixHtml(props: Record<string, unknown> = {}): string {
  return render(createElement(matrix.PermissionMatrix as ElementType, { value: new Set(), onChange: noop, ...props }));
}

function storedHtml(props: Record<string, unknown>): string {
  return render(createElement(stored.StoredKeys as ElementType, props));
}

function inputFor(html: string, key: string): Attrs {
  const found = tagsOf(html, 'input').filter((input) => input.value === key);
  assert.equal(found.length, 1, key);
  return found[0];
}

function chunkFor(html: string, key: string): string {
  const found = html.split('<label').filter((chunk) => chunk.includes(`value="${key}"`));
  assert.equal(found.length, 1, key);
  return found[0];
}

function sorted<T>(values: Iterable<T>): T[] {
  return [...values].sort();
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing rule ${selector}`);
  return match[1];
}

function atRule(css: string, marker: string): string {
  const from = css.indexOf(marker);
  assert.ok(from >= 0, `missing ${marker}`);
  const open = css.indexOf('{', from);
  let depth = 0;
  let end = open;
  for (; end < css.length; end += 1) {
    if (css[end] === '{') depth += 1;
    if (css[end] === '}') depth -= 1;
    if (depth === 0) break;
  }
  return css.slice(open + 1, end);
}

function adminRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f',
    username: 'ada',
    email: 'ada@cardelite.ng',
    role_title: 'Card Reviewer',
    page_permissions: ['card_queue', 'users'],
    last_login_at: null,
    is_active: true,
    is_super_admin: false,
    deleted_at: null,
    created_at: null,
    security: null,
    ...patch,
  };
}

describe('permission matrix layout', () => {
  test('renders the 12 catalog categories, one row per resource and one box per action', () => {
    const html = matrixHtml();
    const headings = [...html.matchAll(/<h4\b[^>]*>([^<]*)<\/h4>/g)].map((match) => match[1].replace(/&amp;/g, '&'));
    assert.deepEqual(headings, [...PERMISSION_CATEGORIES]);
    assert.equal(withClass(html, 'div', 'category').length, 12);
    const groups = tagsOf(html, 'div').filter((div) => div.role === 'group');
    assert.equal(groups.length, RESOURCES.length);
    assert.deepEqual(
      groups.map((group) => textById(html, group['aria-labelledby'])),
      RESOURCES.map((row) => RESOURCE_LABELS[row.resource]),
    );
    const keys = tagsOf(html, 'input').map((input) => input.value).filter((value) => value !== undefined);
    assert.deepEqual(keys, RESOURCES.flatMap((row) => row.actions));
    assert.equal(keys.length, ALL_PERMISSIONS.length);
    assert.equal(withClass(html, 'label', 'allCheck').length, RESOURCES.length);
    for (const key of ALL_PERMISSIONS) {
      assert.equal(chunkFor(html, key).match(/class="actionLabel">([^<]*)</)?.[1], actionLabel(key), key);
    }
  });

  test('builds the same rows it renders', () => {
    assert.deepEqual(
      matrix.MATRIX_CATEGORIES.map((group) => group.category),
      [...PERMISSION_CATEGORIES],
    );
    assert.deepEqual(
      matrix.MATRIX_CATEGORIES.flatMap((group) => group.resources.map((row) => ({ resource: row.resource, actions: row.actions }))),
      RESOURCES,
    );
  });

  test('disables reserved and super-only actions with their notes, and explains both once', () => {
    const html = matrixHtml();
    for (const key of ALL_PERMISSIONS) {
      const input = inputFor(html, key);
      const status = permissionStatus(key);
      assert.equal('disabled' in input, status !== 'enforced', key);
      if (status === 'enforced') assert.equal(input['aria-describedby'], undefined, key);
      else assert.equal(textById(html, input['aria-describedby']), status === 'reserved' ? 'Not in use yet' : 'Super administrators only', key);
    }
    const text = textOf(html);
    assert.equal(text.split('Some permissions cannot be granted.').length - 1, 1);
    assert.match(
      text,
      /Not in use yet means nothing checks the permission yet\. Super administrators only means it stays with super administrators\./,
    );
  });

  test('shows role actions ticked and locked with the role note, and keeps the rest editable', () => {
    const locked = new Map<Permission, string>([
      ['withdrawals.read', MANAGER],
      ['withdrawals.approve', MANAGER],
      ['withdrawals.retry', MANAGER],
    ]);
    const html = matrixHtml({ value: new Set<Permission>(['users.read']), locked });
    for (const key of ['withdrawals.read', 'withdrawals.approve']) {
      const input = inputFor(html, key);
      assert.ok('checked' in input && 'disabled' in input, key);
      assert.equal(textById(html, input['aria-describedby']), MANAGER, key);
    }
    assert.equal(textById(html, inputFor(html, 'withdrawals.retry')['aria-describedby']), `${MANAGER} · Not in use yet`);
    const direct = inputFor(html, 'users.read');
    assert.ok('checked' in direct && !('disabled' in direct));
    const open = inputFor(html, 'withdrawals.reject');
    assert.ok(!('checked' in open) && !('disabled' in open));
  });

  test('marks high and critical actions with a risk badge and no others', () => {
    const html = matrixHtml();
    for (const key of ALL_PERMISSIONS) {
      const badge = chunkFor(html, key).match(/>(Critical|High|Medium|Low)<span class="srOnly"> risk<\/span>/)?.[1] ?? null;
      const risk = PERMISSION_CATALOG[key].risk;
      assert.equal(badge, risk === 'critical' ? 'Critical' : risk === 'high' ? 'High' : null, key);
    }
  });

  test('a read-only matrix, or one without onChange, disables every box but still shows what is held', () => {
    const value = grants.matrixFromKeys(['withdrawals']);
    for (const props of [{ readOnly: true }, { onChange: undefined }]) {
      const html = matrixHtml({ value, ...props });
      const boxes = tagsOf(html, 'input').filter((input) => input.type === 'checkbox');
      assert.equal(boxes.length, ALL_PERMISSIONS.length + RESOURCES.length);
      assert.ok(boxes.every((input) => 'disabled' in input));
      assert.ok('checked' in inputFor(html, 'withdrawals.approve'));
      assert.ok('checked' in inputFor(html, 'withdrawals.retry'));
      assert.ok(!('checked' in inputFor(html, 'users.read')));
    }
  });
});

describe('permission matrix behaviour', () => {
  test('single boxes change only grantable actions that are not locked', () => {
    const value = new Set<Permission>(['users.read']);
    assert.deepEqual(sorted(matrix.toggleAction(value, 'users.export', true)), ['users.export', 'users.read']);
    assert.deepEqual(sorted(matrix.toggleAction(value, 'users.read', false)), []);
    assert.deepEqual(sorted(matrix.toggleAction(value, 'users.edit', true)), ['users.read']);
    assert.deepEqual(sorted(matrix.toggleAction(value, 'roles.write', true)), ['users.read']);
    const fromRole = new Map<Permission, string>([['users.read', MANAGER]]);
    assert.deepEqual(sorted(matrix.toggleAction(value, 'users.read', false, fromRole)), ['users.read']);
    assert.deepEqual(sorted(matrix.toggleAction(value, 'users.export', true, undefined, true)), ['users.read']);
    assert.notEqual(matrix.toggleAction(value, 'users.export', true), value);
    assert.deepEqual(sorted(value), ['users.read']);
    assert.equal(matrix.canToggle('withdrawals.approve'), true);
    assert.equal(matrix.canToggle('withdrawals.retry'), false);
    assert.equal(matrix.canToggle('admin_users.read'), false);
    assert.equal(matrix.actionNote('withdrawals.approve'), null);
    assert.equal(matrix.actionNote('admin_users.read'), 'Super administrators only');
  });

  test('the row All box covers the grantable actions and shows a mixed state', () => {
    const withdrawals = rowOf('withdrawals');
    assert.deepEqual(matrix.rowState(withdrawals, new Set()), { checked: false, indeterminate: false, disabled: false });
    const one = new Set<Permission>(['withdrawals.read']);
    assert.deepEqual(matrix.rowState(withdrawals, one), { checked: false, indeterminate: true, disabled: false });
    const all = matrix.toggleRow(withdrawals, one, true);
    assert.deepEqual(sorted(all), ['withdrawals.approve', 'withdrawals.export', 'withdrawals.read', 'withdrawals.reject']);
    assert.deepEqual(matrix.rowState(withdrawals, all), { checked: true, indeterminate: false, disabled: false });

    const locked = new Map<Permission, string>([['withdrawals.approve', MANAGER]]);
    const held = new Set<Permission>(['withdrawals.read', 'withdrawals.retry', 'withdrawals.export']);
    assert.deepEqual(sorted(matrix.toggleRow(withdrawals, held, false, locked)), ['withdrawals.retry']);
    assert.deepEqual(matrix.rowState(withdrawals, held, locked, true), { checked: false, indeterminate: true, disabled: true });

    assert.deepEqual(matrix.rowState(rowOf('reconciliation'), new Set()), { checked: false, indeterminate: false, disabled: true });
    const transactions = rowOf('transactions');
    const fromRole = new Map(transactions.map((key) => [key, MANAGER] as const));
    assert.deepEqual(matrix.rowState(transactions, new Set(), fromRole), { checked: true, indeterminate: false, disabled: true });

    const html = matrixHtml({ value: one });
    const group = html.split('role="group"').find((part) => part.includes('value="withdrawals.read"'));
    assert.ok(group);
    const allBox = group.split('<label')[1];
    assert.match(allBox, /class="[^"]*\ballCheck\b/);
    assert.match(allBox, /d="M3 6h6"/);
    assert.match(allBox, />All<span class="srOnly"> Withdrawals actions<\/span>/);
  });

  test('the live summary counts every ticked action by risk, role actions included', () => {
    const summary = matrix.matrixSummary(
      new Set<Permission>(['withdrawals.approve', 'withdrawals.read']),
      new Map<Permission, string>([['users.read', MANAGER]]),
    );
    assert.deepEqual(summary, { total: 3, byRisk: { critical: 1, high: 0, medium: 2, low: 0 } });
    assert.equal(matrix.summaryText(summary), '3 actions selected: 1 critical, 2 medium.');
    assert.equal(matrix.summaryText(matrix.matrixSummary(new Set())), 'No actions selected.');
    assert.equal(matrix.summaryText(matrix.matrixSummary(new Set<Permission>(['rates.read']))), '1 action selected: 1 low.');
    const html = matrixHtml({ value: new Set<Permission>(['withdrawals.approve']) });
    assert.equal(html.match(/<p class="grantsSummary" role="status">([^<]*)<\/p>/)?.[1], '1 action selected: 1 critical.');
  });

  test('round-trips with keysFromMatrix: an untouched page key stays, unticking an action replaces it', () => {
    const original = ['withdrawals'];
    const start = grants.matrixFromKeys(original);
    assert.deepEqual(grants.keysFromMatrix(original, start, true), ['withdrawals']);
    const next = matrix.toggleAction(start, 'withdrawals.approve', false);
    const keys = grants.keysFromMatrix(original, next, true);
    assert.deepEqual(keys, ['withdrawals.read', 'withdrawals.reject', 'withdrawals.export']);
    assert.equal(matrix.rowState(rowOf('withdrawals'), grants.matrixFromKeys(keys)).indeterminate, true);
    const back = matrix.toggleAction(grants.matrixFromKeys(keys), 'withdrawals.approve', true);
    assert.deepEqual(grants.keysFromMatrix(original, back, true), ['withdrawals']);
  });

  test('stacks each row at phone width and never scrolls sideways', () => {
    const css = readFileSync(join(ACCESS_DIR, 'access.module.css'), 'utf8');
    assert.match(ruleBody(atRule(css, '@media (max-width: 768px)'), '.resource'), /grid-template-columns: minmax\(0, 1fr\);/);
    assert.match(ruleBody(css, '.resource'), /grid-template-columns: minmax\(7rem, 11rem\) minmax\(0, 1fr\);/);
    assert.match(ruleBody(css, '.resource'), /min-width: 0;/);
    assert.match(ruleBody(css, '.resourceActions'), /flex-wrap: wrap;/);
    assert.match(ruleBody(css, '.resourceActions'), /min-width: 0;/);
    assert.doesNotMatch(css, /overflow-x|overflow: (?:auto|scroll)/);
  });
});

describe('stored keys', () => {
  test('lists only stored keys the matrix cannot show: the admin page key, retired keys and unknown keys', () => {
    const specs = stored.storedKeySpecs([
      'transfers', 'withdrawals', 'withdrawals.read', 'dashboard', 'manual_wallet_credit', 'admin_accounts', 'roles.write',
    ]);
    assert.deepEqual(specs.map((spec) => [spec.key, spec.kind]), [
      ['admin_accounts', 'restricted'],
      ['manual_wallet_credit', 'retired'],
      ['transfers', 'unknown'],
    ]);
    assert.equal(specs[2].label, 'transfers');
    assert.deepEqual(specs.map((spec) => spec.note), [
      'Includes managing admins and viewing roles, which are for super administrators only.',
      'Nothing checks this key any more, so it grants nothing.',
      'Not a recognised permission key, so it grants nothing.',
    ]);
    assert.equal(stored.storedKeyKind('roles.write'), null);
    assert.equal(stored.storedKeyKind('limits_fees'), null);
  });

  test('is untick-only: a stored key can be removed and put back, but nothing new is added', () => {
    const baseline = ['withdrawals', 'transfers'];
    assert.deepEqual(stored.toggleStoredKey(baseline, baseline, 'transfers', false), ['withdrawals']);
    assert.deepEqual(stored.toggleStoredKey(['withdrawals'], baseline, 'transfers', true), ['withdrawals', 'transfers']);
    assert.deepEqual(stored.toggleStoredKey(['withdrawals'], ['withdrawals'], 'transfers', true), ['withdrawals']);
    assert.deepEqual(stored.toggleStoredKey(baseline, baseline, 'transfers', true), baseline);
  });

  test('renders a row per key with its note, and marks an unticked key as Removing', () => {
    const html = storedHtml({
      value: ['withdrawals', 'admin_accounts'],
      baseline: ['withdrawals', 'admin_accounts', 'transfers'],
      onChange: noop,
    });
    const kept = inputFor(html, 'admin_accounts');
    const removed = inputFor(html, 'transfers');
    assert.ok('checked' in kept && !('disabled' in kept));
    assert.ok(!('checked' in removed) && !('disabled' in removed));
    assert.equal(tagsOf(html, 'input').some((input) => input.value === 'withdrawals'), false);
    assert.equal(withClass(html, 'span', 'grantMark').length, 1);
    assert.match(chunkFor(html, 'transfers'), /Removing/);
    assert.equal(textById(html, removed['aria-describedby']), 'Not a recognised permission key, so it grants nothing.');
    const text = textOf(html);
    assert.match(text, /Other stored keys/);
    assert.match(text, /These keys are stored but cannot be granted here\. Untick a key to remove it\. Once saved, it cannot be added back\./);
  });

  test('without onChange it is read-only and drops the untick hint', () => {
    const html = storedHtml({ value: ['transfers'] });
    const [fieldset] = tagsOf(html, 'fieldset');
    assert.ok(fieldset && 'disabled' in fieldset);
    assert.ok('disabled' in inputFor(html, 'transfers'));
    assert.doesNotMatch(textOf(html), /Untick/);
  });

  test('renders nothing when no such key is stored', () => {
    assert.equal(storedHtml({ value: ['withdrawals', 'users.read', 'dashboard'], onChange: noop }), '');
  });

  test('the matrix shows the stored keys block once, frozen when the matrix is', () => {
    const storedKeys = { value: ['withdrawals', 'transfers'], baseline: ['withdrawals', 'transfers'], onChange: noop };
    const editable = matrixHtml({ storedKeys });
    assert.equal(tagsOf(editable, 'fieldset').length, 1);
    assert.ok(!('disabled' in inputFor(editable, 'transfers')));
    const frozen = matrixHtml({ storedKeys, readOnly: true });
    assert.ok('disabled' in tagsOf(frozen, 'fieldset')[0]);
    assert.ok('disabled' in inputFor(frozen, 'transfers'));
    assert.equal(tagsOf(matrixHtml(), 'fieldset').length, 0);
  });
});

describe('impact list', () => {
  const members = [
    {
      admin_id: '11111111-1111-4111-8111-111111111111', username: 'ada', is_active: true, is_super_admin: false,
      changed: true, before: ['withdrawals.read'], after: ['withdrawals'],
    },
    {
      admin_id: '22222222-2222-4222-8222-222222222222', username: 'ben', is_active: false, is_super_admin: false,
      changed: true, before: ['coupons'], after: [],
    },
    {
      admin_id: '33333333-3333-4333-8333-333333333333', username: 'root', is_active: true, is_super_admin: true,
      changed: false, before: [], after: [],
    },
    {
      admin_id: '44444444-4444-4444-8444-444444444444', username: 'cy', is_active: true, is_super_admin: false,
      changed: false, before: ['withdrawals'], after: ['withdrawals', 'withdrawals.read'],
    },
  ];

  test('lists affected admins with their gained and lost actions, and the rest with why they are unaffected', () => {
    const html = render(createElement(impacts.ImpactList as ElementType, { impact: roles.buildImpact(members) }));
    const text = textOf(html);
    assert.match(text, /Affected · 2/);
    assert.match(text, /Not affected · 2/);
    const items = html.split('<li').slice(1);
    const ada = items.find((item) => item.includes('@ada'));
    const ben = items.find((item) => item.includes('@ben'));
    assert.ok(ada && ben);
    assert.match(textOf(`<li${ada}`), /Gains 5 actions/);
    assert.match(textOf(`<li${ada}`), /Loses no actions\./);
    assert.match(ada, /Critical<span class="srOnly"> risk<\/span>/);
    assert.doesNotMatch(ada, /Inactive/);
    assert.match(textOf(`<li${ben}`), /Inactive/);
    assert.match(textOf(`<li${ben}`), /Loses 2 actions/);
    assert.match(text, /@root Super admin/);
    assert.match(text, /@cy Access unchanged/);
    assert.equal(text.split('Inactive').length - 1, 1);
  });

  test('renders nothing when the role has no members', () => {
    assert.equal(render(createElement(impacts.ImpactList as ElementType, { impact: roles.buildImpact([]) })), '');
  });
});

describe('shared grant parts', () => {
  test('the copied parts render the grant diff, risk badges and access cell', () => {
    const change = grants.diffGrants(['coupons'], ['withdrawals']);
    const text = textOf(render(createElement(parts.GrantDiff as ElementType, { change })));
    assert.match(text, /Granting · 1/);
    assert.match(text, /Removing · 1/);
    assert.match(text, /Critical risk/);
    assert.match(text, /Gains 6 actions/);
    assert.match(text, /Loses 2 actions/);
    assert.equal(textOf(render(createElement(parts.AccessCell as ElementType, { admin: adminRow({ is_super_admin: true }) }))), 'Everything Super administrator');
    assert.equal(textOf(render(createElement(parts.AccessCell as ElementType, { admin: adminRow({ page_permissions: [] }) }))), 'No access');
    assert.match(textOf(render(createElement(parts.AccessCell as ElementType, { admin: adminRow() }))), /^2 pages Critical risk /);
    assert.equal(textOf(render(createElement(parts.Change as ElementType, { before: null, after: 'Lead' }))), 'None → changes to Lead');
    assert.equal(parts.accessPreview(['A', 'B', 'C', 'D', 'E']), 'A, B, C +2 more');
  });

  test('match the admin accounts originals while those still exist', { skip: !existsSync(ORIGINAL_PARTS) }, async () => {
    const original = await loadAppModule<PartsModule>('(dashboard)/admin-accounts/GrantParts.tsx');
    const withoutImports = (source: string) => source.replace(/\r\n/g, '\n').split('\n').filter((line) => !line.startsWith('import ')).join('\n');
    assert.equal(
      withoutImports(readFileSync(join(ACCESS_DIR, 'GrantParts.tsx'), 'utf8')),
      withoutImports(readFileSync(ORIGINAL_PARTS, 'utf8')),
    );
    const samples: Array<[string, Record<string, unknown>]> = [
      ['GrantDiff', { change: grants.diffGrants(['coupons', 'transfers'], ['withdrawals', 'flags.read']) }],
      ['GrantDiff', { change: grants.diffGrants([], ['card_queue']), addedTitle: 'Access granted', showEffect: false }],
      ['RiskBadge', { risk: 'high' }],
      ['ActionBreakdown', { actions: ['withdrawals.approve', 'users.read', 'rates.read'], id: 'breakdown' }],
      ['GrantList', { keys: ['withdrawals', 'transfers'], sign: '+', label: 'Granting' }],
      ['Change', { before: 'Reviewer', after: 'Lead' }],
      ['AccessCell', { admin: adminRow() }],
      ['AccessCell', { admin: adminRow({ page_permissions: ['flags.read', 'manual_wallet_credit'] }) }],
    ];
    for (const [name, props] of samples) {
      const theirs = render(createElement((original as unknown as Record<string, ElementType>)[name], props));
      const ours = render(createElement((parts as unknown as Record<string, ElementType>)[name], props));
      assert.equal(ours, theirs, name);
    }
  });
});

describe('the _access entry point', () => {
  test('re-exports the shared parts from their modules', () => {
    const expected: Array<[string, unknown]> = [
      ['PermissionMatrix', matrix.PermissionMatrix],
      ['MATRIX_CATEGORIES', matrix.MATRIX_CATEGORIES],
      ['STATUS_NOTE', matrix.STATUS_NOTE],
      ['actionNote', matrix.actionNote],
      ['canToggle', matrix.canToggle],
      ['matrixSummary', matrix.matrixSummary],
      ['rowState', matrix.rowState],
      ['summaryText', matrix.summaryText],
      ['toggleAction', matrix.toggleAction],
      ['toggleRow', matrix.toggleRow],
      ['StoredKeys', stored.StoredKeys],
      ['storedKeyKind', stored.storedKeyKind],
      ['storedKeySpecs', stored.storedKeySpecs],
      ['toggleStoredKey', stored.toggleStoredKey],
      ['ImpactList', impacts.ImpactList],
      ['RiskBadge', parts.RiskBadge],
      ['ActionBreakdown', parts.ActionBreakdown],
      ['GrantList', parts.GrantList],
      ['GrantDiff', parts.GrantDiff],
      ['Change', parts.Change],
      ['AccessCell', parts.AccessCell],
      ['accessCountText', parts.accessCountText],
      ['accessPreview', parts.accessPreview],
    ];
    const exported = barrel as unknown as Record<string, unknown>;
    for (const [name, value] of expected) assert.equal(exported[name], value, name);
    assert.deepEqual(Object.keys(exported).sort(), expected.map(([name]) => name).sort());
  });
});

describe('owned sources', () => {
  const owned = () => readdirSync(ACCESS_DIR).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => join(ACCESS_DIR, name));
  const css = () => readFileSync(join(ACCESS_DIR, 'access.module.css'), 'utf8');

  test('carry no prose comments, no inline styles and no raw form controls', () => {
    const files = owned();
    assert.deepEqual(files.map((file) => file.slice(ACCESS_DIR.length + 1)).sort(), [
      'GrantParts.tsx', 'ImpactList.tsx', 'PermissionMatrix.tsx', 'StoredKeys.tsx', 'index.ts',
    ]);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /\/\*/, file);
      assert.doesNotMatch(source, /(^|\s)\/\/\s/m, file);
      assert.doesNotMatch(source, /style=\{/, file);
      assert.doesNotMatch(source, /<(?:input|button|select|textarea)\b/, file);
    }
  });

  test('the stylesheet uses tokens only', () => {
    const sheet = css();
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
    for (const [, property, value] of sheet.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      assert.doesNotMatch(value, colour, `${property}: ${value}`);
      if (property === 'z-index') assert.match(value.trim(), /^var\(--z-[\w-]+\)$/);
    }
    assert.doesNotMatch(sheet, /\/\*/);
  });

  test('every class the components use is defined in the stylesheet, and none is left unused', () => {
    const used = new Set<string>();
    for (const file of owned()) {
      for (const [, name] of readFileSync(file, 'utf8').matchAll(/(?<![\w.])s\.([A-Za-z]\w*)/g)) used.add(name);
    }
    const defined = new Set([...css().matchAll(/\.([A-Za-z]\w*)/g)].map((match) => match[1]));
    assert.deepEqual(sorted(used).filter((name) => !defined.has(name)), []);
    assert.deepEqual(sorted(defined).filter((name) => !used.has(name)), []);
  });
});
