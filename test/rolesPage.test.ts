import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type Context, type ElementType, type ReactNode } from 'react';
import { classesOf, loadAppModule, loadUi, render, tagsOf, textOf, withClass, type Attrs } from './support/uiHarness.ts';
import { ALL_PERMISSIONS } from '../app/lib/permissions.ts';
import type { ApiResult } from '../app/lib/apiClient.ts';
import type { ConfirmFn, ConfirmOptions, ConfirmResult } from '../app/_ui/Confirm.tsx';
import type { RoleWriteAttempt } from '../app/(dashboard)/admin-roles/model.ts';

type ModelModule = typeof import('../app/(dashboard)/admin-roles/model.ts');
type TableModule = typeof import('../app/(dashboard)/admin-roles/RoleTable.tsx');
type DetailsModule = typeof import('../app/(dashboard)/admin-roles/RoleDetails.tsx');
type EditorModule = typeof import('../app/(dashboard)/admin-roles/RoleEditor.tsx');
type RolesModule = typeof import('../app/lib/roles.ts');
type GrantsModule = typeof import('../app/lib/grants.ts');
type AccountsModel = typeof import('../app/(dashboard)/admin-accounts/model.ts');

let model: ModelModule;
let table: TableModule;
let details: DetailsModule;
let editor: EditorModule;
let roles: RolesModule;
let grants: GrantsModule;
let accounts: AccountsModel;
let ConfirmProvider: ElementType;

before(async () => {
  model = await loadAppModule<ModelModule>('(dashboard)/admin-roles/model.ts');
  table = await loadAppModule<TableModule>('(dashboard)/admin-roles/RoleTable.tsx');
  details = await loadAppModule<DetailsModule>('(dashboard)/admin-roles/RoleDetails.tsx');
  editor = await loadAppModule<EditorModule>('(dashboard)/admin-roles/RoleEditor.tsx');
  roles = await loadAppModule<RolesModule>('lib/roles.ts');
  grants = await loadAppModule<GrantsModule>('lib/grants.ts');
  accounts = await loadAppModule<AccountsModel>('(dashboard)/admin-accounts/model.ts');
  ConfirmProvider = (await loadUi<{ ConfirmProvider: ElementType }>('Confirm.tsx')).ConfirmProvider;
});

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const ROLES_DIR = join(APP_DIR, '(dashboard)', 'admin-roles');
const TEST_FILE = fileURLToPath(import.meta.url);

const SYSTEM_ID = '0b5a2c1e-6d7f-4a1b-8c2d-3e4f5a6b7c8d';
const MANAGER_ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const NIGHT_ID = '9c8b7a6f-5e4d-4c3b-8a29-18f7e6d5c4b3';
const ADA_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const ROOT_ID = '33333333-3333-4333-8333-333333333333';
const GONE_ID = '44444444-4444-4444-8444-444444444444';
const MANAGER_KEYS = ['dashboard', 'users', 'withdrawals'];
const TIGHTER_KEYS = ['dashboard', 'users', 'withdrawals.read', 'withdrawals.reject', 'withdrawals.export'];
const COLUMNS = ['Role', 'Description', 'Admins', 'Permissions', 'Protected', 'Updated'];
const OWNED = ['RoleDetails.tsx', 'RoleEditor.tsx', 'RoleTable.tsx', 'model.ts', 'page.module.css', 'page.tsx'];
const COMMENT = /\/\*|(^|[^:])\/\/(?!\/)/m;

const noop = () => {};

const nodeRequire = createRequire(import.meta.url);
const { AppRouterContext } = nodeRequire('next/dist/shared/lib/app-router-context.shared-runtime') as {
  AppRouterContext: Context<unknown>;
};

const ROUTER = { push: noop, replace: noop, refresh: noop, prefetch: noop, back: noop, forward: noop };

function rawRole(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MANAGER_ID,
    name: 'Manager',
    description: 'Day-to-day operations',
    permissions: MANAGER_KEYS,
    action_count: 10,
    is_protected: false,
    system_key: null,
    archived_at: null,
    version: 3,
    member_count: 3,
    active_member_count: 2,
    created_at: '2026-10-16T10:00:00.000Z',
    updated_at: '2026-10-17T09:30:00.000Z',
    updated_by_username: 'root',
    ...patch,
  };
}

function systemRaw(): Record<string, unknown> {
  return rawRole({
    id: SYSTEM_ID,
    name: 'Super administrator',
    description: 'Holds every permission.',
    permissions: [],
    action_count: 86,
    is_protected: true,
    system_key: 'super_admin',
    version: 1,
    member_count: 1,
    active_member_count: 1,
    updated_at: '2026-10-16T10:00:00.000Z',
    updated_by_username: null,
  });
}

function nightRaw(): Record<string, unknown> {
  return rawRole({
    id: NIGHT_ID,
    name: 'Night shift',
    description: '',
    permissions: ['card_queue'],
    action_count: 6,
    archived_at: '2026-10-15T08:00:00.000Z',
    version: 2,
    member_count: 0,
    active_member_count: 0,
    updated_at: null,
    updated_by_username: null,
  });
}

function viewOf(raw: Record<string, unknown>) {
  const view = model.toRoleView(raw);
  assert.ok(view);
  return view;
}

function detailOf(raw: Record<string, unknown>, members: unknown[] = []) {
  const parsed = model.toRoleDetail({ role: raw, members });
  assert.ok(parsed);
  return parsed;
}

function member(id: string, username: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, username, role_title: 'Operations', is_active: true, last_login_at: null, ...patch };
}

function failure(
  status: number | null,
  code: string | null,
  message: string,
  details: unknown = null,
  outcomeUnknown = false,
): ApiResult<string> {
  return {
    ok: false,
    error: { kind: status === null ? 'network' : 'http', status, code, message, requestId: null, details, outcomeUnknown },
  };
}

function cellsOf(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => textOf(match[1]));
}

function rowFor(html: string, name: string): string {
  const found = html.split('<tr').filter((chunk) => chunk.includes(`aria-label="Open ${name}"`));
  assert.equal(found.length, 1, name);
  return found[0];
}

function buttonTexts(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((match) => textOf(match[1])).filter(Boolean);
}

function buttonByText(html: string, label: string): Attrs | undefined {
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (textOf(match[2]) === label) return tagsOf(`<button${match[1]}>`, 'button')[0];
  }
  return undefined;
}

function inputFor(html: string, key: string): Attrs {
  const found = tagsOf(html, 'input').filter((input) => input.value === key);
  assert.equal(found.length, 1, key);
  return found[0];
}

function inApp(element: ReactNode): string {
  return render(createElement(
    AppRouterContext.Provider,
    { value: ROUTER },
    createElement(ConfirmProvider, { children: element }),
  ));
}

function tableHtml(rows: unknown[], patch: Record<string, unknown> = {}): string {
  return render(createElement(table.RoleTable as ElementType, {
    rows,
    loading: false,
    busy: false,
    error: null,
    retrying: false,
    sort: null,
    empty: { title: 'No roles yet', hint: 'Create a role to give admins a set of permissions.' },
    openId: null,
    onOpen: noop,
    onRetry: noop,
    onSort: noop,
    ...patch,
  }));
}

function detailsHtml(patch: Record<string, unknown> = {}): string {
  return render(createElement(details.RoleDetailsPanel as ElementType, {
    role: viewOf(rawRole()),
    detail: undefined,
    error: null,
    retrying: false,
    canManage: true,
    busy: false,
    inUse: null,
    onClose: noop,
    onRetry: noop,
    onEdit: noop,
    onDuplicate: noop,
    onArchive: noop,
    onRestore: noop,
    ...patch,
  }));
}

function editorHtml(patch: Record<string, unknown> = {}): string {
  return inApp(createElement(editor.RoleEditor as ElementType, {
    mode: 'create',
    role: null,
    onClose: noop,
    onChanged: noop,
    ...patch,
  }));
}

function textOfNode(node: ReactNode): string {
  return textOf(render(createElement('div', null, node)));
}

type Answer = { reason?: string; credential?: string } | null;

function fakeConfirm(answers: Answer[]) {
  const calls: Array<ConfirmOptions<unknown>> = [];
  const confirm = async (options: ConfirmOptions<unknown>): Promise<ConfirmResult<unknown> | null> => {
    calls.push(options);
    const answer = answers.shift() ?? null;
    if (!answer) return null;
    const result: ConfirmResult = options.credential
      ? { reason: answer.reason ?? '', credential: answer.credential ?? '' }
      : { reason: answer.reason ?? '' };
    const value = options.action ? await options.action(result) : undefined;
    return { reason: result.reason, value };
  };
  return { confirm: confirm as unknown as ConfirmFn, calls };
}

function sender(attempts: Array<RoleWriteAttempt<string>>) {
  const reasons: string[] = [];
  const send = async (reason: string): Promise<RoleWriteAttempt<string>> => {
    reasons.push(reason);
    const next = attempts.shift();
    assert.ok(next, 'the save was sent more often than expected');
    return next;
  };
  return { send, reasons };
}

function verifier(answer: 'ok' | 'expired' = 'ok') {
  const codes: string[] = [];
  const verify = async (code: string): Promise<'ok' | 'expired'> => {
    codes.push(code);
    return answer;
  };
  return { verify, codes };
}

const SAVE_BASE = {
  tone: 'danger' as const,
  title: 'Save changes to Manager?',
  reason: { required: true, maxLength: 500 },
  confirmLabel: 'Save changes',
  pendingLabel: 'Saving…',
};

describe('roles list model', () => {
  test('parses the list, lowercases ids and keeps the counts the API computed', () => {
    const list = model.toRoleList({
      roles: [systemRaw(), rawRole({ id: MANAGER_ID.toUpperCase() }), nightRaw(), rawRole({ id: 'not-a-uuid' })],
      super_admin_count: 1,
      can_manage: true,
    });
    assert.ok(list);
    assert.deepEqual(list.roles.map((role) => role.id), [SYSTEM_ID, MANAGER_ID, NIGHT_ID]);
    assert.equal(list.superAdminCount, 1);
    assert.equal(list.canManage, true);
    const manager = list.roles[1];
    assert.deepEqual(
      [manager.action_count, manager.member_count, manager.active_member_count, manager.updated_by_username],
      [10, 3, 2, 'root'],
    );
    assert.equal(model.toRoleList({ roles: 'nope' }), null);
    assert.equal(model.toRoleList({ roles: [], can_manage: 'yes' })?.canManage, false);
  });

  test('splits active and archived roles, searches names and descriptions, and sorts the three columns', () => {
    const list = model.toRoleList({ roles: [systemRaw(), rawRole(), nightRaw()], super_admin_count: 1, can_manage: true });
    assert.ok(list);
    const names = (rows: Array<{ name: string }>) => rows.map((role) => role.name);
    assert.deepEqual(names(model.visibleRoles(list.roles, 'active', '', null)), ['Super administrator', 'Manager']);
    assert.deepEqual(names(model.visibleRoles(list.roles, 'archived', '', null)), ['Night shift']);
    assert.deepEqual(model.tabCounts(list.roles), { active: 2, archived: 1 });
    assert.deepEqual(names(model.visibleRoles(list.roles, 'active', '  DAY-TO ', null)), ['Manager']);
    assert.deepEqual(names(model.visibleRoles(list.roles, 'active', 'every permission', null)), ['Super administrator']);
    assert.deepEqual(names(model.visibleRoles(list.roles, 'active', 'night', null)), []);
    assert.deepEqual(names(model.visibleRoles(list.roles, 'active', '', { key: 'name', dir: 'asc' })), ['Manager', 'Super administrator']);
    assert.deepEqual(names(model.visibleRoles(list.roles, 'active', '', { key: 'admins', dir: 'desc' })), ['Manager', 'Super administrator']);
    assert.deepEqual(names(model.visibleRoles(list.roles, 'active', '', { key: 'updated_at', dir: 'asc' })), ['Super administrator', 'Manager']);
    const undated = [...list.roles, viewOf(rawRole({ id: BEN_ID, name: 'Undated', updated_at: null }))];
    assert.deepEqual(names(model.visibleRoles(undated, 'active', '', { key: 'updated_at', dir: 'desc' })), ['Manager', 'Super administrator', 'Undated']);
    assert.deepEqual(names(model.visibleRoles(list.roles, 'active', '', { key: 'description', dir: 'asc' })), ['Super administrator', 'Manager']);
  });

  test('cell text: active admins, All for the system row, an action count otherwise, and the updater', () => {
    const system = viewOf(systemRaw());
    const manager = viewOf(rawRole());
    assert.equal(model.isSystemRole(system), true);
    assert.equal(model.isSystemRole(manager), false);
    assert.equal(model.adminsText(manager), '2');
    assert.equal(model.permissionsText(system), 'All');
    assert.equal(model.permissionsText(manager), '10 actions');
    assert.equal(model.permissionsText(viewOf(rawRole({ action_count: 1 }))), '1 action');
    assert.equal(model.updatedBy(manager), '@root');
    assert.equal(model.updatedBy(system), null);
  });

  test('parses a role with its members, and a save answer with the impact the save returned', () => {
    const detail = detailOf(rawRole({ id: MANAGER_ID.toUpperCase() }), [
      member(ADA_ID.toUpperCase(), 'ada'),
      member('bad', 'nobody'),
      member(BEN_ID, 'ben', { is_active: false, role_title: '' }),
    ]);
    assert.equal(detail.role.id, MANAGER_ID);
    assert.deepEqual(detail.members.map((entry) => [entry.id, entry.username, entry.is_active, entry.role_title]), [
      [ADA_ID, 'ada', true, 'Operations'],
      [BEN_ID, 'ben', false, null],
    ]);
    assert.equal(model.toRoleDetail({ role: { id: MANAGER_ID } }), null);
    const created = model.toRoleSaved({ role: rawRole() });
    assert.ok(created);
    assert.equal(created.impact, null);
    assert.equal(model.toRoleSaved({ role: null }), null);
  });

  test('an impact is read defensively: unknown keys and rows are dropped and the counts are recomputed', () => {
    const impact = model.parseImpact({
      members_total: 9,
      affected: [
        { admin_id: ADA_ID, username: 'ada', is_active: true, gained: ['not.a.key'], lost: ['withdrawals.approve'], highest_risk: 'low' },
        { admin_id: 5, username: 'ghost' },
        { admin_id: BEN_ID, username: 'ben', is_active: false, gained: ['coupons.read'], lost: [] },
      ],
      unchanged: [{ admin_id: ROOT_ID, username: 'root', why: 'super_admin' }, { admin_id: GONE_ID, why: 'other' }],
      signed_out_count: 7,
    });
    assert.ok(impact);
    assert.deepEqual(impact.affected.map((admin) => [admin.username, admin.gained, admin.lost, admin.highest_risk]), [
      ['ada', [], ['withdrawals.approve'], 'critical'],
      ['ben', ['coupons.read'], [], 'low'],
    ]);
    assert.deepEqual(impact.unchanged.map((admin) => [admin.username, admin.why]), [['root', 'super_admin'], ['', 'same_access']]);
    assert.equal(impact.members_total, 4);
    assert.equal(impact.signed_out_count, 1);
    assert.equal(model.parseImpact({ affected: [] }), null);
    assert.equal(model.toImpact({ impact: null }), null);
  });
});

describe('the roles table', () => {
  test('has the six columns, sortable by role, admins and updated', () => {
    const html = tableHtml([viewOf(systemRaw()), viewOf(rawRole())]);
    const headers = [...html.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)];
    assert.deepEqual(headers.map((match) => textOf(match[2])), COLUMNS);
    const sortable = headers.filter((match) => match[1].includes('aria-sort')).map((match) => textOf(match[2]));
    assert.deepEqual(sortable, ['Role', 'Admins', 'Updated']);
  });

  test('marks the protected system row with a System badge, All permissions and a Protected badge', () => {
    const html = tableHtml([viewOf(systemRaw()), viewOf(rawRole())], { openId: MANAGER_ID });
    const system = rowFor(html, 'Super administrator');
    assert.deepEqual(cellsOf(system), ['Super administrator System', 'Holds every permission.', '1', 'All', 'Protected', '16 Oct 2026']);
    const manager = rowFor(html, 'Manager');
    assert.deepEqual(cellsOf(manager), ['Manager', 'Day-to-day operations', '2', '10 actions', '—', '17 Oct 2026 @root']);
    assert.equal(html.split('>System<').length - 1, 1);
    assert.ok(classesOf(tagsOf(`<tr${manager}`, 'tr')[0]).includes('selected'));
    assert.ok(!classesOf(tagsOf(`<tr${system}`, 'tr')[0]).includes('selected'));
    const openers = tagsOf(html, 'button').filter((button) => 'data-role-open' in button);
    assert.deepEqual(openers.map((button) => [button['data-role-open'], button['aria-haspopup']]), [
      [SYSTEM_ID, 'dialog'],
      [MANAGER_ID, 'dialog'],
    ]);
  });

  test('archived rows show a dash for an empty description and a missing update time', () => {
    const html = tableHtml([viewOf(nightRaw())]);
    assert.deepEqual(cellsOf(rowFor(html, 'Night shift')), ['Night shift', '—', '0', '6 actions', '—', '—']);
  });

  test('shows a skeleton while loading, the error with a retry, and the empty state', () => {
    const loading = tableHtml([], { loading: true });
    assert.match(textOf(loading), /Loading Roles/);
    assert.ok(withClass(loading, 'tr', 'skeletonRow').length > 0);
    const failed = tableHtml([], {
      error: { kind: 'http', status: 500, code: 'INTERNAL_ERROR', message: 'Roles could not be loaded.', requestId: 'req_1', details: null, outcomeUnknown: false },
    });
    assert.match(textOf(failed), /Roles could not be loaded Roles could not be loaded\. Request ID req_1 Try again/);
    const empty = textOf(tableHtml([]));
    assert.match(empty, /No roles yet Create a role to give admins a set of permissions\./);
  });

  test('the phone list shows the same facts per row', () => {
    const html = render(createElement(table.RoleMobileList as ElementType, {
      rows: [viewOf(systemRaw()), viewOf(rawRole())],
      loading: false,
      busy: false,
      error: null,
      retrying: false,
      sort: null,
      empty: { title: 'No roles yet', hint: 'Create one.' },
      onOpen: noop,
      onRetry: noop,
      onSortChange: noop,
    }));
    const text = textOf(html);
    assert.match(text, /Super administrator · System Holds every permission\. Protected 1 admin · All · Updated 16 Oct 2026/);
    assert.match(text, /Manager Day-to-day operations 2 admins · 10 actions · Updated 17 Oct 2026/);
    assert.deepEqual(table.ROLE_MOBILE_SORT.map((option) => option.key), ['name', 'admins', 'updated_at']);
  });
});

describe('role details', () => {
  test('the protected system row is display only: no Edit, Duplicate, Archive or Restore', () => {
    const html = detailsHtml({
      role: viewOf(systemRaw()),
      detail: detailOf(systemRaw(), [member(ROOT_ID, 'root', { role_title: 'Super Admin' })]),
    });
    assert.deepEqual(buttonTexts(html), []);
    const text = textOf(html);
    assert.match(text, /Shown for reference Super administrators hold every permission\./);
    assert.match(text, /cannot be edited, duplicated, archived or assigned/);
    assert.match(text, /Super administrators · 1/);
    assert.deepEqual(withClass(html, 'a', 'memberLink').map((link) => link.href), [`/admin-accounts?id=${ROOT_ID}`]);
    const boxes = ALL_PERMISSIONS.map((key) => inputFor(html, key));
    assert.ok(boxes.every((box) => 'checked' in box && 'disabled' in box));
  });

  test('an active role offers Archive, Duplicate and Edit, and lists its members with links to Admin accounts', () => {
    const html = detailsHtml({
      detail: detailOf(rawRole(), [member(ADA_ID, 'ada'), member(BEN_ID, 'ben', { is_active: false })]),
    });
    assert.deepEqual(buttonTexts(html), ['Archive', 'Duplicate', 'Edit']);
    assert.ok(tagsOf(html, 'button').filter((button) => button['aria-haspopup'] === 'dialog').length >= 3);
    const text = textOf(html);
    assert.match(text, /Description Day-to-day operations/);
    assert.match(text, /Admins · 2 @ada Operations @ben Operations Inactive/);
    assert.deepEqual(withClass(html, 'a', 'memberLink').map((link) => link.href), [
      `/admin-accounts?id=${ADA_ID}`,
      `/admin-accounts?id=${BEN_ID}`,
    ]);
    assert.ok('checked' in inputFor(html, 'withdrawals.approve'));
    assert.ok(!('checked' in inputFor(html, 'coupons.read')));
    assert.ok(tagsOf(html, 'input').filter((input) => input.type === 'checkbox').every((input) => 'disabled' in input));
  });

  test('an archived role offers Restore and Duplicate but no Edit or Archive', () => {
    const html = detailsHtml({ role: viewOf(nightRaw()), detail: detailOf(nightRaw()) });
    assert.deepEqual(buttonTexts(html), ['Restore', 'Duplicate']);
    const text = textOf(html);
    assert.match(text, /Archived role Archived 15 Oct 2026, 09:00 WAT\. It cannot be assigned or edited until it is restored\./);
    assert.match(text, /No description\./);
    assert.match(text, /No admin holds this role\./);
  });

  test('without write access nothing can be changed', () => {
    assert.deepEqual(buttonTexts(detailsHtml({ canManage: false, detail: detailOf(rawRole()) })), []);
  });

  test('stored keys the matrix cannot show are listed read-only', () => {
    const raw = rawRole({ permissions: ['withdrawals', 'transfers'] });
    const html = detailsHtml({ role: viewOf(raw), detail: detailOf(raw) });
    assert.match(textOf(html), /Other stored keys/);
    const [fieldset] = tagsOf(html, 'fieldset');
    assert.ok(fieldset && 'disabled' in fieldset);
    assert.ok('disabled' in inputFor(html, 'transfers'));
  });

  test('while the members load it shows a skeleton, and a failed load offers a retry', () => {
    const loading = detailsHtml();
    assert.doesNotMatch(textOf(loading), /Admins ·/);
    assert.match(textOf(loading), /Description Day-to-day operations Admins Permissions/);
    const failed = detailsHtml({
      error: { kind: 'http', status: 500, code: 'INTERNAL_ERROR', message: 'The role could not be loaded.', requestId: null, details: null, outcomeUnknown: false },
    });
    assert.match(textOf(failed), /The admins holding this role could not be loaded The role could not be loaded\./);
    assert.ok(buttonByText(failed, 'Try again'));
  });

  test('a role still in use shows who holds it and links to Admin accounts', () => {
    const html = detailsHtml({
      detail: detailOf(rawRole(), [member(ADA_ID, 'ada')]),
      inUse: [{ admin_id: ADA_ID, username: 'ada' }, { admin_id: BEN_ID, username: 'ben' }],
    });
    const text = textOf(html);
    assert.match(text, /Admins still hold this role Move them to another role in Admin accounts before archiving it: @ada , @ben \./);
    const hrefs = tagsOf(html, 'a').map((link) => link.href);
    assert.ok(hrefs.includes('/admin-accounts'));
    assert.ok(hrefs.includes(`/admin-accounts?id=${BEN_ID}`));
    assert.match(text, /Open Admin accounts/);
  });
});

describe('the role editor', () => {
  test('a new role offers Copy access from an admin, the name and description, and the full matrix', () => {
    const html = editorHtml();
    const text = textOf(html);
    assert.match(text, /New role/);
    assert.match(text, /Copy access from an admin/);
    assert.ok(text.includes(editor.COPY_HELP));
    assert.match(text, /Loading admins…/);
    const [select] = tagsOf(html, 'select');
    assert.ok(select && 'disabled' in select);
    const copy = buttonByText(html, 'Copy access');
    assert.ok(copy && 'disabled' in copy);
    const review = buttonByText(html, 'Review changes');
    assert.ok(review && !('disabled' in review));
    assert.equal(review.type, 'submit');
    const lengthOf = (attrs: Attrs | undefined) => attrs?.maxlength ?? attrs?.maxLength;
    assert.ok(tagsOf(html, 'input').some((input) => lengthOf(input) === '64'));
    assert.equal(lengthOf(tagsOf(html, 'textarea')[0]), '500');
    assert.equal(tagsOf(html, 'input').filter((input) => input.type === 'checkbox').length, ALL_PERMISSIONS.length + 33);
    assert.ok(!('disabled' in inputFor(html, 'withdrawals.approve')));
    assert.ok('disabled' in inputFor(html, 'withdrawals.retry'));
    assert.ok('disabled' in inputFor(html, 'roles.write'));
  });

  test('editing starts from the stored keys, with nothing to review until something changes', () => {
    const role = viewOf(rawRole({ permissions: [...MANAGER_KEYS, 'transfers'] }));
    const html = editorHtml({ mode: 'edit', role });
    assert.match(textOf(html), /Edit Manager/);
    const review = buttonByText(html, 'Review changes');
    assert.ok(review && 'disabled' in review);
    assert.ok(tagsOf(html, 'input').some((input) => input.value === 'Manager'));
    assert.ok('checked' in inputFor(html, 'users.read') && !('disabled' in inputFor(html, 'users.read')));
    assert.ok('checked' in inputFor(html, 'withdrawals.retry') && 'disabled' in inputFor(html, 'withdrawals.retry'));
    assert.match(textOf(html), /Other stored keys/);
    assert.ok(!('disabled' in inputFor(html, 'transfers')));
  });

  test('Duplicate pre-fills a new role with the keys it was given', () => {
    const html = editorHtml({ seed: ['withdrawals'] });
    assert.ok('checked' in inputFor(html, 'withdrawals.approve'));
    assert.ok(!('checked' in inputFor(html, 'users.read')));
  });
});

describe('the role draft', () => {
  test('keeps a stored page key until one of its actions is unticked, and restores it when ticked again', () => {
    const start = model.draftFor(viewOf(rawRole({ permissions: ['withdrawals'] })));
    assert.deepEqual([start.keys, start.baseline], [['withdrawals'], ['withdrawals']]);
    const ticked = grants.matrixFromKeys(start.keys);
    ticked.delete('withdrawals.approve');
    const less = model.withMatrix(start, ticked);
    assert.deepEqual(less.keys, ['withdrawals.read', 'withdrawals.reject', 'withdrawals.export']);
    assert.deepEqual(less.baseline, ['withdrawals']);
    const back = grants.matrixFromKeys(less.keys);
    back.add('withdrawals.approve');
    assert.deepEqual(model.withMatrix(less, back).keys, ['withdrawals']);
  });

  test('copy sources are the non-super, non-deleted admins with the direct keys a role may take', () => {
    const sources = model.toCopySources({
      admins: [
        { id: ROOT_ID, username: 'root', is_super_admin: true, is_active: true, deleted_at: null, direct_permissions: ['admin_accounts'] },
        { id: ADA_ID.toUpperCase(), username: 'manager', is_super_admin: false, is_active: true, deleted_at: null, direct_permissions: MANAGER_KEYS },
        {
          id: BEN_ID, username: 'ben', is_super_admin: false, is_active: false, deleted_at: null,
          direct_permissions: ['coupons', 'admin_accounts', 'manual_wallet_credit', 'transfers', 'users.edit', 'flags.read'],
        },
        { id: GONE_ID, username: 'gone', is_super_admin: false, is_active: false, deleted_at: '2026-10-01T00:00:00.000Z', direct_permissions: ['coupons'] },
        { id: 'bad', username: 'bad', direct_permissions: ['coupons'] },
      ],
    });
    assert.ok(sources);
    assert.deepEqual(sources.map((source) => [source.id, source.username, source.keys]), [
      [BEN_ID, 'ben', ['coupons', 'flags.read']],
      [ADA_ID, 'manager', MANAGER_KEYS],
    ]);
    assert.deepEqual(sources.map(model.copySourceLabel), ['@ben · Inactive', '@manager']);
    assert.equal(model.toCopySources({ admins: null }), null);
  });

  test('copying the live Manager reproduces its keys verbatim, page keys included', () => {
    const copied = model.withCopy(model.draftFor(null), MANAGER_KEYS);
    assert.deepEqual(copied.keys, ['dashboard', 'withdrawals', 'users']);
    assert.deepEqual(copied.baseline, copied.keys);
    assert.ok(grants.matrixFromKeys(copied.keys).has('withdrawals.approve'));
    const ticked = grants.matrixFromKeys(copied.keys);
    ticked.delete('users.export');
    assert.deepEqual(model.withMatrix(copied, ticked).keys, ['dashboard', 'withdrawals', 'users.read']);
  });

  test('an unticked stored key stays out when the matrix changes, and can be put back', () => {
    const start = model.draftFor(viewOf(rawRole({ permissions: ['coupons', 'transfers'] })));
    assert.deepEqual(start.keys, ['coupons', 'transfers']);
    const without = model.withStoredKeys(start, ['coupons']);
    const ticked = grants.matrixFromKeys(['coupons']);
    ticked.add('rates.read');
    assert.deepEqual(model.withMatrix(start, ticked).keys, ['coupons', 'rates.read', 'transfers']);
    assert.deepEqual(model.withMatrix(without, ticked).keys, ['coupons', 'rates.read']);
    assert.deepEqual(model.otherKeys(['withdrawals', 'transfers', 'admin_accounts', 'users.read', 'manual_wallet_credit']), [
      'transfers', 'admin_accounts', 'manual_wallet_credit',
    ]);
    assert.deepEqual(model.withStoredKeys(without, ['coupons', 'transfers']).keys, ['coupons', 'transfers']);
  });

  test('Duplicate keeps only the keys a new role may take', () => {
    assert.deepEqual(
      model.duplicateKeys({ permissions: ['withdrawals', 'admin_accounts', 'transfers', 'manual_wallet_credit', 'users.edit', 'flags.read'] }),
      ['withdrawals', 'flags.read'],
    );
  });

  test('validates with the shared role rules and allows stored keys to stay', () => {
    const draft = { name: 'Payout reviewer', description: 'Reviews payouts', keys: ['withdrawals'] };
    assert.deepEqual(model.validateRoleDraft(draft, []), {});
    assert.deepEqual(model.validateRoleDraft({ ...draft, name: ' A ' }, []), { name: 'Role name must be 2–64 characters.' });
    assert.deepEqual(model.validateRoleDraft({ ...draft, description: 'x'.repeat(501) }, []), {
      description: 'The description must be 500 characters or fewer.',
    });
    assert.deepEqual(model.validateRoleDraft({ ...draft, keys: ['admin_accounts'] }, []), {
      permissions: 'This permission cannot be added to a role: admin_accounts.',
    });
    assert.deepEqual(model.validateRoleDraft({ ...draft, keys: ['admin_accounts'] }, ['admin_accounts']), {});
    assert.equal(model.firstRoleError({ description: 'x', name: 'y' }), 'name');
    assert.equal(model.firstRoleError({}), null);
  });

  test('is dirty only when the trimmed text or the key set changes', () => {
    const base = { name: 'Manager', description: 'Ops', keys: ['users', 'withdrawals'] };
    assert.equal(model.isRoleDirty({ ...base, name: ' Manager ', keys: ['withdrawals', 'users'] }, base), false);
    assert.equal(model.isRoleDirty({ ...base, name: 'Lead' }, base), true);
    assert.equal(model.isRoleDirty({ ...base, description: 'Operations' }, base), true);
    assert.equal(model.isRoleDirty({ ...base, keys: ['users'] }, base), true);
  });

  test('a stale role is rebased: your changes win, theirs are kept, and both-changed fields are reported', () => {
    const base = { name: 'Manager', description: 'Ops', keys: ['withdrawals'] };
    const local = { name: 'Payout manager', description: 'Ops', keys: ['withdrawals.read', 'withdrawals.reject', 'withdrawals.export'] };
    const server = { name: 'Manager', description: 'Operations', keys: ['withdrawals', 'coupons'] };
    const rebased = model.rebaseRoleDraft(base, local, server);
    assert.deepEqual(rebased.values, {
      name: 'Payout manager',
      description: 'Operations',
      keys: ['coupons', 'withdrawals.read', 'withdrawals.reject', 'withdrawals.export'],
    });
    assert.deepEqual(rebased.baseline, ['withdrawals', 'coupons']);
    assert.deepEqual(rebased.conflicts, []);
    assert.equal(rebased.changedElsewhere, true);
    const clash = model.rebaseRoleDraft(base, local, { ...server, name: 'Ops lead' });
    assert.deepEqual(clash.conflicts, ['name']);
    assert.equal(
      model.rebaseNoticeText(clash),
      'Another admin saved this role while you were editing. Their changes are kept and yours are applied on top; you both changed the name, and yours is kept. Review the changes again before saving.',
    );
    const copied = model.rebaseRoleDraft(base, { ...base, keys: ['dashboard', 'users'] }, base);
    assert.deepEqual(copied.baseline, ['dashboard', 'withdrawals', 'users']);
    assert.equal(copied.changedElsewhere, false);
  });

  test('the preview carries the version for an existing role, and every save sends the description', () => {
    const role = viewOf(rawRole());
    const draft = { name: ' Payout reviewer ', description: '  Reviews payouts ', keys: ['withdrawals'] };
    assert.deepEqual(model.previewBody(draft, null), {
      role_id: null, name: 'Payout reviewer', description: 'Reviews payouts', permissions: ['withdrawals'],
    });
    assert.deepEqual(model.previewBody(draft, role), {
      role_id: MANAGER_ID, name: 'Payout reviewer', description: 'Reviews payouts', permissions: ['withdrawals'], expected_version: 3,
    });
    assert.deepEqual(model.saveBody({ ...draft, description: '' }, null, 'New team'), {
      name: 'Payout reviewer', description: '', permissions: ['withdrawals'], reason: 'New team',
    });
    assert.deepEqual(model.saveBody(draft, role, 'Tighten payouts'), {
      name: 'Payout reviewer', description: 'Reviews payouts', permissions: ['withdrawals'], reason: 'Tighten payouts', expected_version: 3,
    });
    assert.deepEqual(model.archiveBody('No longer used', 4), { reason: 'No longer used', expected_version: 4 });
    assert.equal(model.rolePath(MANAGER_ID), `/api/admin-roles/${MANAGER_ID}`);
    assert.equal(model.archivePath(MANAGER_ID), `/api/admin-roles/${MANAGER_ID}/archive`);
    assert.equal(model.restorePath(MANAGER_ID), `/api/admin-roles/${MANAGER_ID}/restore`);
  });
});

describe('write outcomes', () => {
  test('classifies every answer the roles routes give', () => {
    assert.deepEqual(model.classifyRoleWrite<string>({ ok: true, data: 'saved', status: 200, requestId: null }), { kind: 'done', result: 'saved' });
    assert.deepEqual(model.classifyRoleWrite(failure(401, 'AUTH_REQUIRED', 'Your session has expired. Sign in again.')), { kind: 'expired' });
    assert.deepEqual(model.classifyRoleWrite(failure(null, null, 'Could not reach the server.', null, true)), {
      kind: 'unknown', message: 'Could not reach the server.',
    });
    assert.deepEqual(model.classifyRoleWrite(failure(403, 'MFA_REQUIRED', 'Set up two-step sign-in first.')), {
      kind: 'reauth', code: 'MFA_REQUIRED', message: accounts.STEP_UP_MESSAGE.MFA_REQUIRED,
    });
    assert.deepEqual(model.classifyRoleWrite(failure(403, 'REAUTH_REQUIRED', 'Confirm it is you to continue.', { method: 'otp' })), {
      kind: 'reauth', code: 'REAUTH_REQUIRED', message: accounts.STEP_UP_MESSAGE.REAUTH_REQUIRED,
    });
    assert.deepEqual(model.classifyRoleWrite(failure(403, 'PERMISSION_DENIED', 'This action is restricted to super administrators.')), {
      kind: 'refused', message: 'This action is restricted to super administrators.',
    });
    const stale = model.classifyRoleWrite(failure(409, 'STATE_CONFLICT', 'That record has changed. Reload and try again.', { reason: 'stale', version: 5 }));
    assert.deepEqual(stale, {
      kind: 'conflict', reason: 'stale', message: 'That record has changed. Reload and try again.', version: 5, members: [],
    });
    const inUse = model.classifyRoleWrite(failure(409, 'STATE_CONFLICT', 'Admins still hold this role. Move them to another role first.', {
      reason: 'in_use', members: [{ admin_id: ADA_ID.toUpperCase(), username: 'ada' }, { username: 'nobody' }],
    }));
    assert.equal(inUse.kind === 'conflict' && inUse.reason, 'in_use');
    assert.deepEqual(inUse.kind === 'conflict' ? inUse.members : null, [{ admin_id: ADA_ID, username: 'ada' }]);
    for (const reason of ['name_taken', 'protected', 'archived', 'unchanged']) {
      const outcome = model.classifyRoleWrite(failure(409, 'STATE_CONFLICT', 'x', { reason }));
      assert.equal(outcome.kind === 'conflict' && outcome.reason, reason);
    }
    const odd = model.classifyRoleWrite(failure(409, 'STATE_CONFLICT', 'x', { reason: 'constructor' }));
    assert.equal(odd.kind === 'conflict' && odd.reason, 'other');
    const missing = model.classifyRoleWrite(failure(404, 'RESOURCE_NOT_FOUND', 'Role not found.'));
    assert.equal(missing.kind === 'conflict' && missing.reason, 'not_found');
    assert.deepEqual(model.classifyRoleWrite(failure(400, 'VALIDATION_ERROR', 'Enter a reason of 3 to 500 characters.')), {
      kind: 'retry', message: 'Enter a reason of 3 to 500 characters.',
    });
    assert.deepEqual(model.classifyRoleWrite(failure(500, 'INTERNAL_ERROR', 'The role could not be saved. Try again.')), {
      kind: 'retry', message: 'The role could not be saved. Try again.',
    });
  });

  test('a reason must be 3 to 500 characters, counted like the database counts them', () => {
    assert.equal(model.reasonProblem('ok'), roles.REASON_MESSAGE);
    assert.equal(model.reasonProblem('   ab  '), roles.REASON_MESSAGE);
    assert.equal(model.reasonProblem('Fine'), null);
    assert.equal(model.reasonProblem('🙂🙂🙂'), null);
    assert.equal(model.reasonProblem('x'.repeat(501)), roles.REASON_MESSAGE);
  });
});

describe('the step-up flow', () => {
  test('a save inside the identity window needs only the reason', async () => {
    const { confirm, calls } = fakeConfirm([{ reason: 'Tighten payouts' }]);
    const { send, reasons } = sender([{ kind: 'done', result: 'saved' }]);
    const { verify, codes } = verifier();
    assert.deepEqual(await model.confirmWithStepUp(confirm, SAVE_BASE, send, verify), { kind: 'done', result: 'saved' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].credential, undefined);
    assert.deepEqual(calls[0].reason, { required: true, maxLength: 500 });
    assert.deepEqual(reasons, ['Tighten payouts']);
    assert.deepEqual(codes, []);
  });

  test('REAUTH_REQUIRED asks for a code through the identity check, then sends the same reason again', async () => {
    const { confirm, calls } = fakeConfirm([{ reason: 'Tighten payouts' }, { credential: '123456' }]);
    const { send, reasons } = sender([
      { kind: 'reauth', code: 'REAUTH_REQUIRED', message: 'Your identity check ran out.' },
      { kind: 'done', result: 'saved' },
    ]);
    const { verify, codes } = verifier();
    assert.deepEqual(await model.confirmWithStepUp(confirm, SAVE_BASE, send, verify), { kind: 'done', result: 'saved' });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].credential, { kind: 'otp' });
    assert.equal(calls[1].title, model.IDENTITY_TITLE);
    assert.equal(calls[1].message, model.IDENTITY_MESSAGE);
    assert.equal(calls[1].reason, undefined);
    assert.deepEqual([calls[1].tone, calls[1].confirmLabel, calls[1].pendingLabel], ['danger', 'Save changes', 'Saving…']);
    assert.deepEqual(codes, ['123456']);
    assert.deepEqual(reasons, ['Tighten payouts', 'Tighten payouts']);
  });

  test('MFA_REQUIRED ends the flow without asking for a code', async () => {
    const { confirm, calls } = fakeConfirm([{ reason: 'Tighten payouts' }]);
    const { send } = sender([{ kind: 'reauth', code: 'MFA_REQUIRED', message: 'Set up two-step sign-in on your Profile first.' }]);
    const outcome = await model.confirmWithStepUp(confirm, SAVE_BASE, send, verifier().verify);
    assert.deepEqual(outcome, { kind: 'reauth', code: 'MFA_REQUIRED', message: 'Set up two-step sign-in on your Profile first.' });
    assert.equal(calls.length, 1);
  });

  test('a short reason, a retryable failure and a second expired check keep the dialog open with the message', async () => {
    await assert.rejects(
      model.confirmWithStepUp(fakeConfirm([{ reason: 'no' }]).confirm, SAVE_BASE, sender([]).send, verifier().verify),
      { message: roles.REASON_MESSAGE },
    );
    await assert.rejects(
      model.confirmWithStepUp(
        fakeConfirm([{ reason: 'Tighten payouts' }]).confirm,
        SAVE_BASE,
        sender([{ kind: 'retry', message: 'The role could not be saved. Try again.' }]).send,
        verifier().verify,
      ),
      { message: 'The role could not be saved. Try again.' },
    );
    await assert.rejects(
      model.confirmWithStepUp(
        fakeConfirm([{ reason: 'Tighten payouts' }, { credential: '123456' }]).confirm,
        SAVE_BASE,
        sender([
          { kind: 'reauth', code: 'REAUTH_REQUIRED', message: 'first' },
          { kind: 'reauth', code: 'REAUTH_REQUIRED', message: accounts.STEP_UP_MESSAGE.REAUTH_REQUIRED },
        ]).send,
        verifier().verify,
      ),
      { message: accounts.STEP_UP_MESSAGE.REAUTH_REQUIRED },
    );
  });

  test('an ended session stops the flow, and cancelling either dialog sends nothing more', async () => {
    const ended = sender([{ kind: 'reauth', code: 'REAUTH_REQUIRED', message: 'x' }]);
    const outcome = await model.confirmWithStepUp(
      fakeConfirm([{ reason: 'Tighten payouts' }, { credential: '123456' }]).confirm,
      SAVE_BASE,
      ended.send,
      verifier('expired').verify,
    );
    assert.deepEqual(outcome, { kind: 'expired' });
    assert.equal(ended.reasons.length, 1);
    const cancelled = sender([]);
    assert.equal(await model.confirmWithStepUp(fakeConfirm([null]).confirm, SAVE_BASE, cancelled.send, verifier().verify), null);
    assert.equal(cancelled.reasons.length, 0);
    const second = sender([{ kind: 'reauth', code: 'REAUTH_REQUIRED', message: 'x' }]);
    assert.equal(await model.confirmWithStepUp(fakeConfirm([{ reason: 'Tighten payouts' }, null]).confirm, SAVE_BASE, second.send), null);
    assert.equal(second.reasons.length, 1);
  });
});

describe('confirmations', () => {
  test('a new role: nobody is affected, a reason is required and nothing asks for a code up front', () => {
    const options = editor.saveConfirm('create', null, { name: ' Payout reviewer ', description: '', keys: ['withdrawals'] }, roles.buildImpact([]));
    assert.equal(options.title, 'Create the role Payout reviewer?');
    assert.equal(options.tone, 'default');
    assert.equal(textOfNode(options.message), 'No admin’s access changes.');
    assert.deepEqual((options.details ?? []).map((detail) => [detail.label, textOfNode(detail.value)]), [
      ['Role', 'Payout reviewer'],
      ['Actions added', '6 actions'],
      ['Actions removed', 'None'],
    ]);
    assert.deepEqual(options.consequences, []);
    assert.equal(options.reason?.required, true);
    assert.equal(options.reason?.maxLength, 500);
    assert.equal(options.credential, undefined);
    assert.equal(options.confirmLabel, 'Create role');
    assert.equal(options.pendingLabel, 'Saving…');
  });

  test('an edit that takes a critical action away is dangerous and says who is signed out', () => {
    const impact = roles.buildImpact([
      {
        admin_id: ADA_ID, username: 'ada', is_active: true, is_super_admin: false, changed: true,
        before: MANAGER_KEYS, after: TIGHTER_KEYS,
      },
      { admin_id: ROOT_ID, username: 'root', is_active: true, is_super_admin: true, changed: false, before: [], after: [] },
    ]);
    const options = editor.saveConfirm('edit', viewOf(rawRole()), { name: 'Payout manager', description: 'Ops', keys: TIGHTER_KEYS }, impact);
    assert.equal(options.title, 'Save changes to Manager?');
    assert.equal(options.tone, 'danger');
    const message = textOfNode(options.message);
    assert.match(message, /^1 admin will be affected\. Affected · 1 @ada/);
    assert.match(message, /Loses 3 actions/);
    assert.match(message, /Not affected · 1 @root Super admin/);
    assert.deepEqual((options.details ?? []).map((detail) => [detail.label, textOfNode(detail.value)]), [
      ['Role', 'Manager → changes to Payout manager'],
      ['Actions added', 'None'],
      ['Actions removed', '3 actions'],
    ]);
    assert.deepEqual(options.consequences, [
      '@ada loses 3 actions.',
      'They will be signed out on every device, and their phone alerts stop until they sign in again.',
    ]);
    assert.equal(options.confirmLabel, 'Save changes');
  });

  test('member lines, the tone and the success toast follow the members the save returned', () => {
    const base = { admin_id: ADA_ID, username: 'ada', is_active: true, highest_risk: null };
    assert.equal(model.memberLine({ ...base, gained: ['coupons.read', 'rates.read'], lost: [] }), '@ada gains 2 actions.');
    assert.equal(model.memberLine({ ...base, gained: ['coupons.read'], lost: ['rates.read', 'users.read'] }), '@ada gains 1 action and loses 2 actions.');
    assert.equal(model.memberLine({ ...base, gained: [], lost: [] }), '@ada’s access changes.');
    assert.equal(model.impactTone({ affected: [{ ...base, gained: [], lost: [], highest_risk: 'high' }] }), 'default');
    assert.deepEqual(model.impactConsequences({ affected: [{ ...base, is_active: false, gained: [], lost: ['users.read'] }], signed_out_count: 0 }), [
      '@ada loses 1 action.',
    ]);
    const created = model.toRoleSaved({ role: rawRole({ name: 'Payout reviewer' }) });
    assert.ok(created);
    assert.equal(model.saveSuccessText('create', created), 'Created the role Payout reviewer.');
    const quiet = model.toRoleSaved({ role: rawRole(), impact: { affected: [], unchanged: [] } });
    assert.ok(quiet);
    assert.equal(model.saveSuccessText('edit', quiet), 'Saved the role Manager. No admin’s access changed.');
    const loud = model.toRoleSaved({
      role: rawRole(),
      impact: {
        affected: [
          { admin_id: ADA_ID, username: 'ada', is_active: true, gained: [], lost: ['withdrawals.approve'] },
          { admin_id: BEN_ID, username: 'ben', is_active: false, gained: ['coupons.read'], lost: [] },
        ],
        unchanged: [],
      },
    });
    assert.ok(loud);
    assert.equal(model.saveSuccessText('edit', loud), 'Saved the role Manager. Access changed for 2 admins. 1 admin was signed out on every device.');
  });

  test('archive and restore need a reason; the code is asked only when the identity check has run out', () => {
    const role = viewOf(rawRole());
    const archive = model.archiveConfirm(role);
    assert.equal(archive.title, 'Archive Manager?');
    assert.match(String(archive.message), /Nobody holds this role, so no admin’s access changes\./);
    assert.deepEqual((archive.details ?? []).map((detail) => [detail.label, detail.value]), [['Role', 'Manager'], ['Permissions', '10 actions']]);
    assert.deepEqual([archive.reason?.required, archive.reason?.maxLength, archive.credential], [true, 500, undefined]);
    assert.deepEqual([archive.confirmLabel, archive.pendingLabel], ['Archive role', 'Archiving…']);
    const restore = model.restoreConfirm(viewOf(nightRaw()));
    assert.equal(restore.title, 'Restore Night shift?');
    assert.deepEqual([restore.reason?.required, restore.credential, restore.confirmLabel], [true, undefined, 'Restore role']);
    const identity = model.identityConfirm(archive);
    assert.deepEqual([identity.title, identity.credential, identity.reason], [model.IDENTITY_TITLE, { kind: 'otp' }, undefined]);
    assert.equal(model.archiveSuccessText(true, 'Manager'), 'Archived the role Manager.');
    assert.equal(model.archiveSuccessText(false, 'Manager'), 'Restored the role Manager.');
  });
});

describe('the page', () => {
  const source = () => readFileSync(join(ROLES_DIR, 'page.tsx'), 'utf8');

  test('wraps the page in Suspense and exports only the page component', () => {
    const text = source();
    assert.match(text, /^export default function RolesPage\(\) \{\n  return \(\n    <Suspense fallback=\{<PageFallback \/>\}>\n      <Roles \/>/m);
    assert.deepEqual([...text.matchAll(/^export\b.*$/gm)].map((match) => match[0]), ['export default function RolesPage() {']);
  });

  test('reads the list from the roles API and shows the header, the tabs, the search and both list views', () => {
    const text = source();
    assert.match(text, /useResource<RoleList>\('admin-roles', \(signal\) => apiRequest\(ROLES_PATH, \{ signal, select: toRoleList \}\)\)/);
    assert.match(text, /<PageHeader\n        title=\{TITLE\}\n        subtitle=\{SUBTITLE\}/);
    assert.match(text, /<Tabs<RoleTab> aria-label="Role status" value=\{url\.tab\} onChange=\{changeTab\} items=\{tabItems\} \/>/);
    assert.match(text, /<SearchInput\n            aria-label="Search roles"/);
    assert.match(text, /desktop=\{<RoleTable \{\.\.\.shared\} openId=\{url\.id\} onSort=\{toggleSort\} \/>\}/);
    assert.match(text, /mobile=\{<RoleMobileList \{\.\.\.shared\} onSortChange=\{setSort\} \/>\}/);
    assert.deepEqual(model.ROLE_TABS.map((tab) => tab.label), ['Active', 'Archived']);
    assert.equal(model.TITLE, 'Roles');
  });

  test('the New role button needs can_manage from the API and a super admin session', () => {
    const text = source();
    assert.match(text, /const canManage = isSuperAdmin && data\?\.canManage === true;/);
    assert.match(text, /actions=\{canManage \? \(/);
    assert.match(text, /setEditor\(\{ mode: 'create', seed: \[\] \}\);/);
  });

  test('a 403 from the list shows the access-denied screen', () => {
    assert.match(
      source(),
      /if \(list\.error\?\.status === 403 && data === undefined\) \{\s*return \(\s*<div>\s*<PageHeader title=\{TITLE\} subtitle=\{SUBTITLE\} \/>\s*<AccessDenied/,
    );
  });

  test('Edit and Duplicate from the details open the editor, and the open role follows the URL', () => {
    const text = source();
    assert.match(text, /onEdit=\{\(role\) => setEditor\(\{ mode: 'edit', role \}\)\}/);
    assert.match(text, /onDuplicate=\{\(keys\) => setEditor\(\{ mode: 'create', seed: keys \}\)\}/);
    assert.match(text, /const openRole = url\.id \? roles\.find\(\(role\) => role\.id === url\.id\) \?\? null : null;/);
    assert.match(text, /notify\(MISSING_LINK, 'warning'\);/);
  });
});

describe('flow order in the sources', () => {
  const source = (name: string) => readFileSync(join(ROLES_DIR, name), 'utf8');

  test('the editor previews with the role version before it opens the confirmation, and rebases on stale', () => {
    const text = source('RoleEditor.tsx');
    const preview = text.indexOf('apiRequest(PREVIEW_PATH');
    const confirmation = text.indexOf('confirmWithStepUp<RoleSaved>(');
    assert.ok(preview > 0 && confirmation > preview);
    assert.match(text, /body: previewBody\(snapshot, target\)/);
    assert.match(text, /body: saveBody\(snapshot, target, reason\)/);
    assert.match(text, /if \(reason === 'stale' && target\) \{\s*await rebase\(snapshot, target\);/);
    assert.match(text, /notify\(saveSuccessText\(mode, outcome\.result\), 'success'\);/);
  });

  test('archiving reads the role again and shows its holders before asking for anything', () => {
    const text = source('RoleDetails.tsx');
    const reread = text.indexOf('const fresh = await refresh();');
    const held = text.indexOf('if (archived && live.members.length > 0) {');
    const confirmation = text.indexOf('confirmWithStepUp<RoleSaved>(');
    assert.ok(reread > 0 && held > reread && confirmation > held);
    assert.match(text, /body: archiveBody\(reason, live\.role\.version\)/);
    assert.match(text, /if \(outcome\.reason === 'in_use'\) \{\s*setInUse\(outcome\.members\);/);
  });

  test('the identity check is the shared one from Admin accounts, reached only through the step-up flow', () => {
    for (const name of ['model.ts', 'page.tsx', 'RoleTable.tsx', 'RoleDetails.tsx', 'RoleEditor.tsx']) {
      assert.doesNotMatch(source(name), /_security\/reauth|reauthenticate\(/, name);
    }
    assert.match(source('model.ts'), /confirmIdentity, plural, stepUpCode, type StepUpCode,\n\} from '\.\.\/admin-accounts\/model';/);
    assert.match(source('model.ts'), /verify: \(code: string\) => Promise<'ok' \| 'expired'> = confirmIdentity,/);
    assert.equal(model.confirmWithStepUp.length, 3);
  });
});

describe('owned sources', () => {
  const files = () => readdirSync(ROLES_DIR).sort();
  const code = () => files().filter((name) => /\.tsx?$/.test(name));
  const read = (name: string) => readFileSync(join(ROLES_DIR, name), 'utf8');

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
      assert.doesNotMatch(text, /\t|[ \t]+$/m, name);
    }
    assert.doesNotMatch(readFileSync(TEST_FILE, 'utf8'), COMMENT);
  });

  test('the components are client modules and the model is not', () => {
    for (const name of ['page.tsx', 'RoleTable.tsx', 'RoleDetails.tsx', 'RoleEditor.tsx']) {
      assert.match(read(name), /^'use client';\n/, name);
    }
    assert.doesNotMatch(read('model.ts'), /'use client'/);
  });

  test('the stylesheet uses tokens only and stacks at phone width', () => {
    const css = read('page.module.css');
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
    for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      assert.doesNotMatch(value, colour, `${property}: ${value}`);
      if (property === 'z-index') assert.match(value.trim(), /^var\(--z-[\w-]+\)$/);
    }
    assert.doesNotMatch(css, /\/\*/);
    assert.doesNotMatch(css, /overflow-x|overflow: (?:auto|scroll)/);
    assert.match(css, /@media \(max-width: 768px\)/);
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
