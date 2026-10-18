import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_PERMISSIONS,
  ENFORCED_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  PAGE_READ_PERMISSION,
  RESTRICTED_PERMISSIONS,
  isPermission,
  resourceOf,
} from '../app/lib/permissions.ts';
import { loadAppModule } from './support/uiHarness.ts';

type GrantsModule = typeof import('../app/lib/grants.ts');

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const SCHEMA_SQL = fileURLToPath(new URL('../../schema.sql', import.meta.url));
const ADMIN_SQL = fileURLToPath(new URL('../../schema_admin_app.sql', import.meta.url));
const EDGE_DIR = fileURLToPath(new URL('../../supabase/functions/', import.meta.url));
const RESUME_WITHDRAWAL = join(EDGE_DIR, 'resume-withdrawal', 'index.ts');
const MOBILE_API = join(EDGE_DIR, 'admin-mobile-api', 'index.ts');
const SIBLINGS_PRESENT = [SCHEMA_SQL, ADMIN_SQL, RESUME_WITHDRAWAL, MOBILE_API].every((file) => existsSync(file));
const ACCESS_UI = ['admin-accounts', 'admin-roles', 'admin-permissions', '_access']
  .map((name) => join(APP_DIR, '(dashboard)', name) + sep);
const CATALOG_MODULES = ['permissions.ts', 'grants.ts', 'roles.ts'].map((name) => join(APP_DIR, 'lib', name));
const DATA_FUNCTIONS = ['admin_legacy_grants', 'admin_catalog_keys'];
const LEGACY_ROW = /^ {4}\('([a-z_]+)', '([a-z_]+\.[a-z_]+)', (true|false)\)[,;]$/;
const CATALOG_ROW = /^ {4}\('([a-z_]+\.[a-z_]+)'\)[,;]$/;
const GUARD_CALL = /\b(?:requireAdmin|requireAdminAny|requireAdminAll|useCan|can|canAny|canAll|holdsAny|has)\(/g;
const KEY_LITERAL = /['"`]([a-z_]+\.[a-z_]+)['"`]/g;

function sqlBounds(source: string, name: string): [number, number] {
  const head = `CREATE OR REPLACE FUNCTION ${name}(`;
  const start = source.indexOf(head);
  assert.ok(start >= 0, `${name} is not in schema_admin_app.sql`);
  assert.equal(source.indexOf(head, start + 1), -1, `${name} is defined twice`);
  const open = source.indexOf('AS $$', start);
  const close = source.indexOf('$$;', open + 5);
  assert.ok(open > start && close > open, `${name} has no body`);
  return [open + 5, close];
}

function sqlBody(source: string, name: string): string {
  const [from, to] = sqlBounds(source, name);
  return source.slice(from, to);
}

function valueRows(body: string, pattern: RegExp): RegExpMatchArray[] {
  const all = body.split(/\r?\n/);
  const lines = all.filter((line) => line.startsWith('    ('));
  const rest = all.filter((line) => !line.startsWith('    (') && !line.trim().startsWith('--'));
  assert.deepEqual(rest.map((line) => line.trim()).filter((line) => line !== ''), ['VALUES'], 'the body is one VALUES list');
  return lines.map((line) => {
    const row = line.match(pattern);
    assert.ok(row, `unexpected VALUES row: ${line}`);
    return row;
  });
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

function quoted(source: string, key: string): boolean {
  return [`'${key}'`, `"${key}"`, `\`${key}\``].some((literal) => source.includes(literal));
}

function balanced(source: string, open: number, opener: string, closer: string): string {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === opener) depth += 1;
    else if (source[index] === closer) {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return source.slice(open);
}

function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} was not found`);
  return balanced(source, source.indexOf('{', start), '{', '}');
}

function byFirst(a: readonly string[], b: readonly string[]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

describe('SQL copies of the permission map in schema_admin_app.sql', { skip: !SIBLINGS_PRESENT }, () => {
  let sql = '';
  let grants: GrantsModule;

  before(async () => {
    sql = readFileSync(ADMIN_SQL, 'utf8');
    grants = await loadAppModule<GrantsModule>('lib/grants.ts');
  });

  test('admin_legacy_grants equals LEGACY_PERMISSION_MAP without dashboard', () => {
    const rows = valueRows(sqlBody(sql, 'admin_legacy_grants'), LEGACY_ROW);
    const pages: Record<string, string[]> = {};
    for (const [, page, permission] of rows) (pages[page] ??= []).push(permission);
    const expected = Object.entries(LEGACY_PERMISSION_MAP).filter(([page]) => page !== 'dashboard');
    assert.deepEqual(
      Object.fromEntries(Object.entries(pages).map(([page, list]) => [page, [...list].sort()])),
      Object.fromEntries(expected.map(([page, list]) => [page, [...list].sort()])),
    );
    assert.equal(rows.length, expected.reduce((total, [, list]) => total + list.length, 0));
  });

  test('its read rows equal PAGE_READ_PERMISSION, one per page', () => {
    const reads = valueRows(sqlBody(sql, 'admin_legacy_grants'), LEGACY_ROW)
      .filter(([, , , read]) => read === 'true')
      .map(([, page, permission]) => [page, permission]);
    assert.deepEqual(reads.sort(byFirst), Object.entries(PAGE_READ_PERMISSION).sort(byFirst));
  });

  test('admin_catalog_keys equals the catalog', () => {
    const keys = valueRows(sqlBody(sql, 'admin_catalog_keys'), CATALOG_ROW).map(([, key]) => key);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual([...keys].sort(), [...ALL_PERMISSIONS].sort());
  });

  test('the restricted rule in admin_grants_refused resolves to RESTRICTED_PERMISSIONS plus admin_accounts', () => {
    const body = sqlBody(sql, 'admin_grants_refused');
    const cut = body.indexOf('OR NOT (');
    assert.ok(cut > 0, 'the restricted rule is followed by the unknown-key rule');
    const rule = body.slice(0, cut);
    const exact = [...rule.matchAll(/\bk = '([a-z_]+)'/g)].map((match) => match[1]);
    const prefixes = [...rule.matchAll(/split_part\(k, '\.', 1\) IN \(([^)]*)\)/g)]
      .flatMap((match) => [...match[1].matchAll(/'([a-z_]+)'/g)].map((prefix) => prefix[1]));
    assert.ok(exact.length > 0 && prefixes.length > 0, 'the restricted rule was not found');
    const resolved = [...exact, ...ALL_PERMISSIONS.filter((key) => prefixes.includes(resourceOf(key)))].sort();
    assert.deepEqual(resolved, [...RESTRICTED_PERMISSIONS, 'admin_accounts'].sort());
    for (const key of resolved) {
      for (const kind of ['role', 'direct'] as const) {
        assert.deepEqual(grants.checkNewKeys([key], [], kind)?.keys, [key], `${kind}: ${key}`);
      }
    }
  });

  test('the admin_grant_keys_valid pattern accepts every catalog, page and retired key', () => {
    const match = sqlBody(sql, 'admin_grant_keys_valid').match(/k !~ '([^']+)'/);
    assert.ok(match, 'the key pattern was not found');
    const pattern = new RegExp(match[1]);
    for (const key of [...ALL_PERMISSIONS, ...Object.keys(LEGACY_PERMISSION_MAP), ...grants.RETIRED_PAGE_KEYS]) {
      assert.match(key, pattern, key);
    }
    for (const key of ['', 'Users', 'users.', '.read', 'users.read.all', 'users read', '9lives']) {
      assert.doesNotMatch(key, pattern, key);
    }
  });
});

describe('permissions in use across the console, SQL and edge functions', { skip: !SIBLINGS_PRESENT }, () => {
  test('every ENFORCED_PERMISSIONS key is checked by a console guard or gate, a SQL check or an edge check', () => {
    const consoleSources = sourceFiles(APP_DIR)
      .filter((file) => !CATALOG_MODULES.includes(file) && !ACCESS_UI.some((dir) => file.startsWith(dir)))
      .map((file) => readFileSync(file, 'utf8'));
    let adminSql = readFileSync(ADMIN_SQL, 'utf8');
    for (const name of DATA_FUNCTIONS) {
      const [from, to] = sqlBounds(adminSql, name);
      adminSql = adminSql.slice(0, from) + adminSql.slice(to);
    }
    const sources = [
      ...consoleSources,
      readFileSync(SCHEMA_SQL, 'utf8'),
      adminSql,
      ...sourceFiles(EDGE_DIR).map((file) => readFileSync(file, 'utf8')),
    ];
    assert.deepEqual(ENFORCED_PERMISSIONS.filter((key) => !sources.some((source) => quoted(source, key))), []);
  });

  test('every catalog key a guard call names is in ENFORCED_PERMISSIONS', () => {
    const enforced = new Set<string>(ENFORCED_PERMISSIONS);
    const outside: string[] = [];
    for (const file of sourceFiles(APP_DIR)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(GUARD_CALL)) {
        const args = balanced(source, (match.index ?? 0) + match[0].length - 1, '(', ')');
        for (const [, key] of args.matchAll(KEY_LITERAL)) {
          if (isPermission(key) && !enforced.has(key)) outside.push(`${file.slice(APP_DIR.length)}: ${key}`);
        }
      }
    }
    assert.deepEqual(outside, []);
  });
});

describe('edge functions that read admin permissions', { skip: !SIBLINGS_PRESENT }, () => {
  test('resume-withdrawal answers 500 when the admin read fails and checks withdrawals.approve through admin_has_permission', () => {
    const source = readFileSync(RESUME_WITHDRAWAL, 'utf8');
    const read = source.match(/const \{ data: \w+, error: (\w+) \} = await \w+\s*\.from\('admin_users'\)/);
    assert.ok(read, 'the admin row is read together with its error');
    const handled = source.indexOf(`if (${read[1]})`, read.index);
    assert.ok(handled > 0, 'the read error is checked');
    assert.match(source.slice(handled, handled + 160), /\b500\b/);
    const check = source.match(/const \{ data: (\w+), error: (\w+) \} = await \w+\.rpc\('admin_has_permission',\s*\{[^}]*p_permission:\s*'withdrawals\.approve'/);
    assert.ok(check, 'withdrawals.approve is checked through admin_has_permission together with its error');
    const failed = source.indexOf(`if (${check[2]})`, check.index);
    assert.ok(failed > 0, 'the permission lookup error is checked');
    assert.match(source.slice(failed, failed + 160), /\b500\b/);
    assert.ok(source.indexOf(`if (${check[1]} !== true)`, check.index) > failed, 'anything but true is refused');
    assert.doesNotMatch(source, /\.includes\(\s*['"]withdrawals['"]\s*\)/);
    assert.doesNotMatch(source, /\b(?:is_super_admin|page_permissions|is_active)\b/);
  });

  test('admin-mobile-api asks for the display keys before opening the session, again in /me, and still signs the raw list', () => {
    const source = readFileSync(MOBILE_API, 'utf8');
    const login = functionBody(source, 'async function handleLogin(');
    const display = login.indexOf("rpc('admin_display_page_keys'");
    assert.ok(display > 0, 'login asks for the display keys');
    assert.ok(login.indexOf("rpc('admin_session_open'") > display, 'the display keys come before the session opens');
    const opens = login.indexOf("rpc('admin_session_open'");
    const listed = login.slice(0, display).match(/const \{ data: (\w+), error: (\w+) \} = await \w+\.$/);
    assert.ok(listed, 'the display keys are read together with their error');
    const refused = login.indexOf(`if (${listed[2]} || !Array.isArray(${listed[1]}))`, display);
    assert.ok(refused > display && refused < opens, 'a failed lookup stops before the session opens');
    assert.match(login.slice(refused, refused + 200), /\b500\b/);
    assert.ok(login.lastIndexOf(`page_permissions: ${listed[1]},`) > opens, 'the body returns the display keys');
    const me = functionBody(source, 'async function handleMe(');
    const meListed = me.match(/const \{ data: (\w+), error: (\w+) \} = await \w+\.rpc\('admin_display_page_keys'/);
    assert.ok(meListed, '/me reads the display keys together with their error');
    const meRefused = me.indexOf(`if (${meListed[2]} || !Array.isArray(${meListed[1]}))`, meListed.index);
    assert.ok(meRefused > 0, '/me refuses a failed lookup');
    assert.match(me.slice(meRefused, meRefused + 200), /\b500\b/);
    assert.ok(me.indexOf(`page_permissions: ${meListed[1]},`) > meRefused, '/me returns the display keys');
    const signing = login.indexOf('signAdminJWT(');
    assert.ok(signing > 0, 'login signs a token');
    const payload = balanced(login, login.indexOf('{', signing), '{', '}');
    assert.match(payload, /page_permissions: admin\.page_permissions\b/);
    assert.doesNotMatch(payload, /pageKeys/);
  });
});
