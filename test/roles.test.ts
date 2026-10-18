import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAppModule } from './support/uiHarness.ts';

type RolesModule = typeof import('../app/lib/roles.ts');

let roles: RolesModule;

before(async () => {
  roles = await loadAppModule<RolesModule>('lib/roles.ts');
});

const ADMIN_SQL = fileURLToPath(new URL('../../schema_admin_app.sql', import.meta.url));
const SQL_PRESENT = existsSync(ADMIN_SQL);
const ROLE_ID = '5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const ACTOR_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const MEMBER_A = '11111111-2222-4333-8444-555555555555';
const MEMBER_B = '22222222-3333-4444-8555-666666666666';
const MEMBER_C = '33333333-4444-4555-8666-777777777777';
const MEMBER_D = '44444444-5555-4666-8777-888888888888';
const LIB_FILES = ['permissions.ts', 'grants.ts', 'roles.ts'].map((name) => fileURLToPath(new URL(`../app/lib/${name}`, import.meta.url)));
const TEST_FILES = ['permissions.test.ts', 'grants.test.ts', 'roles.test.ts', 'sqlParity.test.ts']
  .map((name) => fileURLToPath(new URL(name, import.meta.url)));

function sqlFunction(source: string, name: string): string {
  const head = `CREATE OR REPLACE FUNCTION ${name}(`;
  const start = source.indexOf(head);
  assert.ok(start >= 0, `${name} is not in schema_admin_app.sql`);
  assert.equal(source.indexOf(head, start + 1), -1, `${name} is defined twice`);
  const open = source.indexOf('AS $$', start);
  const close = source.indexOf('$$;', open + 5);
  assert.ok(open > start && close > open, `${name} has no body`);
  return source.slice(open + 5, close);
}

describe('checkRoleDraft', () => {
  const valid = { name: 'Payout desk', description: 'Reviews payouts.', permissions: ['withdrawals.read'], reason: 'New team' };

  test('accepts a valid draft, trimming the name, description and reason', () => {
    const check = roles.checkRoleDraft(
      { name: '  Payout desk  ', description: '  Reviews payouts.  ', permissions: ['withdrawals.read', 'withdrawals.read', 'users'], reason: '  New team  ' },
      [],
    );
    assert.deepEqual(check, {
      ok: true,
      draft: { name: 'Payout desk', description: 'Reviews payouts.', permissions: ['withdrawals.read', 'users'], reason: 'New team' },
    });
  });

  test('names must be 2 to 64 characters once trimmed', () => {
    for (const name of ['', ' ', 'A', '  A  ', 'x'.repeat(65), 42, null, undefined]) {
      const check = roles.checkRoleDraft({ ...valid, name }, []);
      assert.equal(check.ok ? null : check.field, 'name', JSON.stringify(name));
    }
    for (const name of ['Ab', 'x'.repeat(64)]) assert.equal(roles.checkRoleDraft({ ...valid, name }, []).ok, true, name);
    assert.equal(roles.ROLE_NAME_MIN, 2);
    assert.equal(roles.ROLE_NAME_MAX, 64);
  });

  test('descriptions are optional text of at most 500 characters', () => {
    for (const description of [undefined, null, '', 'x'.repeat(500)]) {
      assert.equal(roles.checkRoleDraft({ ...valid, description }, []).ok, true, String(description));
    }
    for (const description of ['x'.repeat(501), 42, ['text']]) {
      const check = roles.checkRoleDraft({ ...valid, description }, []);
      assert.equal(check.ok ? null : check.field, 'description');
    }
    assert.equal(roles.ROLE_DESCRIPTION_MAX, 500);
  });

  test('permissions must be a list of keys the role may hold, except keys it already holds', () => {
    for (const permissions of [undefined, 'users', [42], ['users', null], Array.from({ length: 129 }, () => 'users')]) {
      const check = roles.checkRoleDraft({ ...valid, permissions }, []);
      assert.equal(check.ok ? null : check.field, 'permissions', JSON.stringify(permissions)?.slice(0, 40));
    }
    const refused = roles.checkRoleDraft({ ...valid, permissions: ['users', 'roles.write', 'risk.read'] }, ['users']);
    assert.deepEqual(refused, {
      ok: false,
      field: 'permissions',
      message: 'These permissions cannot be added to a role: risk.read, roles.write.',
      keys: ['risk.read', 'roles.write'],
    });
    assert.equal(roles.checkRoleDraft({ ...valid, permissions: ['risk.read'] }, ['risk.read']).ok, true);
    assert.equal(roles.checkRoleDraft({ ...valid, permissions: [] }, []).ok, true);
  });

  test('a reason of 3 to 500 characters is required when the draft carries one, and a preview without one passes', () => {
    for (const reason of [undefined, null, '', 'ab', '  ab  ', 'x'.repeat(501), 7]) {
      const check = roles.checkRoleDraft({ ...valid, reason }, []);
      assert.deepEqual(check.ok ? null : [check.field, check.message], ['reason', roles.REASON_MESSAGE], String(reason));
    }
    assert.equal(roles.checkRoleDraft({ ...valid, reason: 'abc' }, []).ok, true);
    assert.equal(roles.checkRoleDraft({ ...valid, reason: 'x'.repeat(500) }, []).ok, true);
    const preview = roles.checkRoleDraft({ name: valid.name, description: valid.description, permissions: valid.permissions }, []);
    assert.equal(preview.ok ? preview.draft.reason : 'refused', null);
    assert.equal(roles.REASON_MESSAGE, 'Enter a reason of 3 to 500 characters.');
  });
});

describe('rpcFailure', () => {
  test('maps every result reason to its status, code and details', () => {
    const cases: Array<[Record<string, unknown>, string, number, Record<string, unknown>]> = [
      [{ ok: false, reason: 'invalid' }, 'VALIDATION_ERROR', 400, { reason: 'invalid' }],
      [{ ok: false, reason: 'reason_required' }, 'VALIDATION_ERROR', 400, { reason: 'reason_required' }],
      [{ ok: false, reason: 'not_grantable', keys: ['roles.write', 7] }, 'VALIDATION_ERROR', 400, { reason: 'not_grantable', keys: ['roles.write'] }],
      [{ ok: false, reason: 'role_not_found' }, 'VALIDATION_ERROR', 400, { reason: 'role_not_found' }],
      [{ ok: false, reason: 'not_found' }, 'RESOURCE_NOT_FOUND', 404, { reason: 'not_found' }],
      [{ ok: false, reason: 'protected' }, 'STATE_CONFLICT', 409, { reason: 'protected' }],
      [{ ok: false, reason: 'archived' }, 'STATE_CONFLICT', 409, { reason: 'archived' }],
      [{ ok: false, reason: 'role_protected' }, 'STATE_CONFLICT', 409, { reason: 'role_protected' }],
      [{ ok: false, reason: 'role_archived' }, 'STATE_CONFLICT', 409, { reason: 'role_archived' }],
      [{ ok: false, reason: 'super_admin' }, 'STATE_CONFLICT', 409, { reason: 'super_admin' }],
      [{ ok: false, reason: 'stale', version: 7 }, 'STATE_CONFLICT', 409, { reason: 'stale', version: 7 }],
      [{ ok: false, reason: 'stale' }, 'STATE_CONFLICT', 409, { reason: 'stale' }],
      [{ ok: false, reason: 'name_taken' }, 'STATE_CONFLICT', 409, { reason: 'name_taken' }],
      [
        { ok: false, reason: 'in_use', members: [{ admin_id: MEMBER_A, username: 'manager' }, 'junk', { username: 'no id' }] },
        'STATE_CONFLICT', 409, { reason: 'in_use', members: [{ admin_id: MEMBER_A, username: 'manager' }] },
      ],
      [{ ok: false, reason: 'unchanged' }, 'STATE_CONFLICT', 409, { reason: 'unchanged' }],
    ];
    for (const [result, code, status, details] of cases) {
      const failure = roles.rpcFailure(result);
      assert.deepEqual([failure.code, failure.status, failure.details], [code, status, details], String(result.reason));
      assert.ok(failure.message.length > 0);
    }
  });

  test('uses the agreed wording for the role and super admin refusals', () => {
    const message = (reason: string) => roles.rpcFailure({ ok: false, reason }).message;
    assert.equal(message('role_not_found'), 'That role does not exist.');
    assert.equal(message('role_protected'), 'This role cannot be assigned.');
    assert.equal(message('role_archived'), 'This role is archived.');
    assert.equal(message('super_admin'), 'Super admins hold every permission, so roles do not apply.');
    assert.equal(message('reason_required'), roles.REASON_MESSAGE);
    assert.equal(roles.rpcFailure({ ok: false, reason: 'not_grantable', keys: ['roles.write'] }).message, 'This permission cannot be granted: roles.write.');
    assert.equal(roles.rpcFailure({ ok: false, reason: 'not_grantable' }).message, 'This permission cannot be granted.');
  });

  test('maps the raised and trigger errors, the role foreign key and the direct-grant check', () => {
    const cases: Array<[Record<string, unknown>, string, number, Record<string, unknown> | undefined]> = [
      [{ code: 'P0001', message: 'Not authorized' }, 'PERMISSION_DENIED', 403, undefined],
      [{ code: 'P0001', message: 'This role cannot be assigned' }, 'STATE_CONFLICT', 409, { reason: 'role_protected' }],
      [{ code: 'P0001', message: 'This role is archived' }, 'STATE_CONFLICT', 409, { reason: 'role_archived' }],
      [{ code: 'P0001', message: 'Roles do not apply to super admins' }, 'STATE_CONFLICT', 409, { reason: 'super_admin' }],
      [{ code: 'P0001', message: 'Change the role and the page permissions separately' }, 'VALIDATION_ERROR', 400, { reason: 'invalid' }],
      [{ code: 'P0001', message: 'This permission cannot be granted' }, 'VALIDATION_ERROR', 400, { reason: 'not_grantable' }],
      [
        { code: '23503', message: 'insert or update on table "admin_users" violates foreign key constraint "admin_users_role_id_fkey"' },
        'VALIDATION_ERROR', 400, { reason: 'role_not_found' },
      ],
      [
        { code: '23503', message: 'violates foreign key constraint', details: 'admin_users_role_id_fkey' },
        'VALIDATION_ERROR', 400, { reason: 'role_not_found' },
      ],
      [
        { code: '23514', message: 'new row for relation "admin_users" violates check constraint "admin_users_direct_permissions_valid"' },
        'VALIDATION_ERROR', 400, { reason: 'invalid' },
      ],
    ];
    for (const [error, code, status, details] of cases) {
      const failure = roles.rpcFailure(error);
      assert.deepEqual([failure.code, failure.status, failure.details], [code, status, details], String(error.message));
    }
    assert.equal(roles.rpcFailure({ message: 'Change the role and the page permissions separately' }).message,
      'Change the role and the page permissions separately.');
  });

  test('anything unrecognised is a 500 INTERNAL_ERROR, never a 401 or 403', () => {
    const unknown: unknown[] = [
      { ok: false, reason: 'mystery' },
      { ok: false, reason: 'constructor' },
      { ok: false, reason: 'toString' },
      { ok: false },
      { ok: true },
      { message: 'connection terminated' },
      { code: 'PGRST202', message: 'Could not find the function public.admin_role_save' },
      { code: '23503', message: 'insert or update on table "audit_log" violates foreign key constraint "audit_log_admin_id_fkey"' },
      { code: '23514', message: 'new row for relation "admin_roles" violates check constraint "admin_roles_name_check"' },
      { code: 'P0001', message: 'Not authorized ' },
      new Error('fetch failed'),
      null,
      undefined,
      'Not authorized',
      42,
      [],
    ];
    for (const value of unknown) {
      const failure = roles.rpcFailure(value);
      assert.deepEqual([failure.code, failure.status, failure.message, failure.details], [
        'INTERNAL_ERROR', 500, 'Something went wrong on our side.', undefined,
      ], String(value instanceof Error ? value.message : JSON.stringify(value)));
    }
  });

  test('every reason and raised message in the role SQL is mapped', { skip: !SQL_PRESENT }, () => {
    const source = readFileSync(ADMIN_SQL, 'utf8');
    const writers = ['admin_role_save', 'admin_role_set_archived', 'admin_set_access'].map((name) => sqlFunction(source, name));
    const reasons = new Set(writers.flatMap((body) => [...body.matchAll(/'reason', '([a-z_]+)'/g)].map((match) => match[1])));
    assert.ok(reasons.size >= 14, String(reasons.size));
    for (const reason of reasons) assert.notEqual(roles.rpcFailure({ ok: false, reason }).code, 'INTERNAL_ERROR', reason);
    const raised = new Set([...writers, sqlFunction(source, 'admin_users_compose_grants')]
      .flatMap((body) => [...body.matchAll(/RAISE EXCEPTION '([^']+)'/g)].map((match) => match[1])));
    assert.ok(raised.size >= 6, String(raised.size));
    for (const message of raised) assert.notEqual(roles.rpcFailure({ code: 'P0001', message }).code, 'INTERNAL_ERROR', message);
  });
});

describe('impact', () => {
  const members = [
    { admin_id: MEMBER_A, username: 'ops', is_active: true, is_super_admin: false, before: ['withdrawals'], after: ['withdrawals.read'], changed: true },
    { admin_id: MEMBER_B, username: 'old', is_active: false, is_super_admin: false, before: ['users'], after: ['users', 'coupons'], changed: true },
    { admin_id: MEMBER_C, username: 'boss', is_active: true, is_super_admin: true, before: ['users'], after: ['users', 'coupons'], changed: false },
    { admin_id: MEMBER_D, username: 'same', is_active: true, is_super_admin: false, before: ['withdrawals'], after: ['withdrawals', 'withdrawals.read'], changed: false },
    'junk',
    { username: 'no id', changed: true },
  ];

  test('buildImpact lists who changes, what they gain or lose, who is unaffected and who is signed out', () => {
    assert.deepEqual(roles.buildImpact(members), {
      members_total: 4,
      affected: [
        {
          admin_id: MEMBER_A,
          username: 'ops',
          is_active: true,
          gained: [],
          lost: ['withdrawals.approve', 'withdrawals.reject', 'withdrawals.retry', 'withdrawals.resolve', 'withdrawals.export'],
          highest_risk: 'critical',
        },
        { admin_id: MEMBER_B, username: 'old', is_active: false, gained: ['coupons.read', 'coupons.write'], lost: [], highest_risk: 'medium' },
      ],
      unchanged: [
        { admin_id: MEMBER_C, username: 'boss', why: 'super_admin' },
        { admin_id: MEMBER_D, username: 'same', why: 'same_access' },
      ],
      signed_out_count: 1,
    });
    assert.deepEqual(roles.buildImpact(null), { members_total: 0, affected: [], unchanged: [], signed_out_count: 0 });
  });

  test('impactSentence counts the admins whose access changes', () => {
    assert.equal(roles.impactSentence(roles.buildImpact([])), 'No admin’s access changes.');
    assert.equal(roles.impactSentence(roles.buildImpact(members.slice(2, 4))), 'No admin’s access changes.');
    assert.equal(roles.impactSentence(roles.buildImpact(members.slice(0, 1))), '1 admin will be affected.');
    assert.equal(roles.impactSentence(roles.buildImpact(members)), '2 admins will be affected.');
  });
});

describe('role rows', () => {
  const row = {
    id: ROLE_ID,
    name: 'Manager',
    description: 'Runs payouts',
    permissions: ['dashboard', 'users', 'withdrawals'],
    system_key: null,
    is_protected: false,
    version: 3,
    archived_at: null,
    archived_by: null,
    created_at: '2026-10-16T10:00:00+00:00',
    created_by: ACTOR_ID,
    updated_at: '2026-10-16T11:00:00+00:00',
    updated_by: ACTOR_ID,
  };

  test('parseRoleRow reads a stored role and refuses a row without an id, a name or a version', () => {
    assert.deepEqual(roles.parseRoleRow(row), row);
    assert.deepEqual(roles.parseRoleRow({ ...row, description: null, permissions: null, archived_by: 'x' }), {
      ...row, description: '', permissions: [], archived_by: null,
    });
    for (const bad of [null, 'role', [], { ...row, id: 'x' }, { ...row, name: null }, { ...row, version: 0 }, { ...row, version: 1.5 }, { ...row, version: '3' }]) {
      assert.equal(roles.parseRoleRow(bad), null, JSON.stringify(bad));
    }
  });

  test('roleSummary counts members and resolved actions, and the system role holds all permissions', () => {
    assert.deepEqual(roles.roleSummary(row, { total: 2, active: 1 }), {
      member_count: 2, active_member_count: 1, action_count: 10, actions_label: '10 actions',
    });
    assert.deepEqual(roles.roleSummary({ permissions: [], system_key: roles.SYSTEM_ROLE_KEY }, { total: 1, active: 1 }), {
      member_count: 1, active_member_count: 1, action_count: 86, actions_label: 'All permissions',
    });
    assert.equal(roles.roleSummary({ permissions: ['flags.read'], system_key: null }, { total: 0, active: 0 }).actions_label, '1 action');
  });

  test('assignableRole refuses the system role and archived roles', () => {
    assert.equal(roles.assignableRole(row), true);
    assert.equal(roles.assignableRole({ ...row, system_key: roles.SYSTEM_ROLE_KEY }), false);
    assert.equal(roles.assignableRole({ ...row, archived_at: '2026-10-16T12:00:00+00:00' }), false);
    assert.equal(roles.SYSTEM_ROLE_KEY, 'super_admin');
  });
});

describe('house rules for the permission core', () => {
  test('no prose comments in the permission modules or their tests', () => {
    for (const file of [...LIB_FILES, ...TEST_FILES]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m, file);
    }
  });
});
