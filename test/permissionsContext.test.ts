import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type Context, type ReactNode } from 'react';
import { loadAppModule, loadUi, render, tagsOf, textById, textOf } from './support/uiHarness.ts';
import type { Permission } from '../app/lib/permissions.ts';
import type { UsePermissionsResult } from '../app/_ui/Permissions.tsx';
import type { ShellProps } from '../app/(dashboard)/_shell/Shell.tsx';

type PermissionsModule = typeof import('../app/_ui/Permissions.tsx');
type CatalogModule = typeof import('../app/lib/permissions.ts');
type ShellModule = typeof import('../app/(dashboard)/_shell/Shell.tsx');
type ThemeModule = typeof import('../app/_ui/theme.tsx');

const nodeRequire = createRequire(import.meta.url);
const { PathnameContext } = nodeRequire('next/dist/shared/lib/hooks-client-context.shared-runtime') as {
  PathnameContext: Context<string | null>;
};

const source = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8');

let perms: PermissionsModule;
let catalog: CatalogModule;

before(async () => {
  perms = await loadUi<PermissionsModule>('Permissions.tsx');
  catalog = await loadAppModule<CatalogModule>('lib/permissions.ts');
});

function serverGuard(stored: readonly string[], isSuperAdmin: boolean) {
  const held = catalog.resolvePermissions(stored, isSuperAdmin);
  return {
    can: (p: Permission) => held.has(p),
    canAny: (list: readonly Permission[]) => list.some((p) => held.has(p)),
    canAll: (list: readonly Permission[]) => list.every((p) => held.has(p)),
  };
}

function asLayoutPasses(stored: readonly string[], isSuperAdmin: boolean): string[] {
  return Array.from(catalog.resolvePermissions(stored, isSuperAdmin)).sort();
}

function provider(permissions: readonly string[], isSuperAdmin: boolean, ...children: ReactNode[]) {
  return createElement(perms.PermissionsProvider, { permissions, isSuperAdmin }, ...children);
}

function Probe({ id = 'probe' }: { id?: string }): ReactNode {
  const { can, isSuperAdmin } = perms.usePermissions();
  const text = [
    `read=${can('withdrawals.read')}`,
    `approve=${can('withdrawals.approve')}`,
    `users=${can('users.read')}`,
    `super=${isSuperAdmin}`,
  ].join(' ');
  return createElement('output', { id }, text);
}

describe('permissionsKey', () => {
  test('trims, drops blanks, dedupes and sorts, so equal grants give an equal memo key', () => {
    assert.equal(perms.permissionsKey(['users.read', ' audit.read ', 'users.read', '', '   ']), 'audit.read users.read');
    assert.equal(
      perms.permissionsKey(['withdrawals.read', 'users.read']),
      perms.permissionsKey(['users.read', 'withdrawals.read', 'users.read']),
    );
  });

  test('different grants give different keys', () => {
    assert.notEqual(perms.permissionsKey(['users.read']), perms.permissionsKey(['users.read', 'users.export']));
    assert.equal(perms.permissionsKey([]), '');
  });

  test('entries with inner whitespace or non-string values are ignored, never split into grants', () => {
    assert.equal(perms.permissionsKey(['users.read withdrawals.approve', 'audit.read']), 'audit.read');
    assert.equal(perms.permissionsKey([42, null, undefined, 'users.read'] as unknown as string[]), 'users.read');
    assert.equal(perms.permissionsKey(null as unknown as string[]), '');
  });
});

describe('createPermissions', () => {
  test('holds exactly the listed keys', () => {
    const p = perms.createPermissions(['withdrawals.read', 'users.read'], false);
    assert.equal(p.can('withdrawals.read'), true);
    assert.equal(p.can('users.read'), true);
    assert.equal(p.can('withdrawals.approve'), false);
    assert.equal(p.isSuperAdmin, false);
    assert.deepEqual(Array.from(p.permissions), ['users.read', 'withdrawals.read']);
  });

  test('canAny and canAll answer like the server guard, including empty lists', () => {
    const p = perms.createPermissions(['withdrawals.read'], false);
    assert.equal(p.canAny(['withdrawals.approve', 'withdrawals.read']), true);
    assert.equal(p.canAny(['withdrawals.approve', 'withdrawals.reject']), false);
    assert.equal(p.canAll(['withdrawals.read', 'withdrawals.approve']), false);
    assert.equal(p.canAll(['withdrawals.read']), true);
    assert.equal(p.canAny([]), false);
    assert.equal(p.canAll([]), true);
  });

  test('matches resolvePermissions and the guard for legacy, catalog and mixed grants', () => {
    const cases: Array<[readonly string[], boolean]> = [
      [['withdrawals'], false],
      [['card_queue', 'sensitive_data.share'], false],
      [['users', 'users_freeze', 'audit.read'], false],
      [['transactions_overview'], false],
      [Object.keys(catalog.LEGACY_PERMISSION_MAP), false],
      [['dashboard'], false],
      [[], false],
      [[], true],
    ];
    for (const [stored, isSuperAdmin] of cases) {
      const server = serverGuard(stored, isSuperAdmin);
      const client = perms.createPermissions(asLayoutPasses(stored, isSuperAdmin), isSuperAdmin);
      for (const key of catalog.ALL_PERMISSIONS) {
        assert.equal(client.can(key), server.can(key), `${stored.join(',') || '(none)'} super=${isSuperAdmin}: ${key}`);
      }
      const lists: Permission[][] = [
        ['withdrawals.approve', 'withdrawals.reject'],
        ['users.read', 'users.freeze'],
        ['cards.review'],
        ['transactions.export', 'users.read', 'withdrawals.read', 'cards.read'],
      ];
      for (const list of lists) {
        assert.equal(client.canAny(list), server.canAny(list), `canAny ${list.join(',')}`);
        assert.equal(client.canAll(list), server.canAll(list), `canAll ${list.join(',')}`);
      }
    }
  });

  test('a super admin can do everything, even if the list is missing', () => {
    const p = perms.createPermissions([], true);
    assert.equal(p.isSuperAdmin, true);
    for (const key of catalog.ALL_PERMISSIONS) assert.equal(p.can(key), true, key);
    assert.equal(p.canAll(catalog.ALL_PERMISSIONS), true);
    assert.equal(p.canAny(['withdrawals.approve']), true);
    assert.equal(p.canAny([]), false);
  });

  test('the layout passes a super admin the whole catalog, so the exposed set is complete', () => {
    const p = perms.createPermissions(asLayoutPasses([], true), true);
    assert.equal(p.permissions.size, catalog.ALL_PERMISSIONS.length);
  });

  test('only a real true makes a super admin', () => {
    for (const flag of ['true', 1, 'yes', {}] as unknown as boolean[]) {
      const p = perms.createPermissions([], flag);
      assert.equal(p.isSuperAdmin, false);
      assert.equal(p.can('withdrawals.approve'), false);
    }
  });

  test('malformed questions are denied, even for a super admin', () => {
    const p = perms.createPermissions(['users.read'], true);
    assert.equal(p.can('' as Permission), false);
    assert.equal(p.can(undefined as unknown as Permission), false);
    assert.equal(p.canAny(undefined as unknown as Permission[]), false);
    assert.equal(p.canAll(null as unknown as Permission[]), false);
  });

  test('the value is frozen', () => {
    const p = perms.createPermissions(['users.read'], false);
    assert.equal(Object.isFrozen(p), true);
  });

  test('the exposed set cannot be mutated and never feeds the decision', () => {
    const p = perms.createPermissions(['users.read'], false);
    const exposed = p.permissions as Set<string>;
    assert.throws(() => exposed.add('withdrawals.approve'), TypeError);
    assert.throws(() => exposed.delete('users.read'), TypeError);
    assert.throws(() => exposed.clear(), TypeError);
    Set.prototype.add.call(exposed, 'withdrawals.approve');
    Set.prototype.delete.call(exposed, 'users.read');
    assert.equal(p.can('withdrawals.approve'), false);
    assert.equal(p.can('users.read'), true);
  });
});

describe('NO_PERMISSIONS (outside a provider)', () => {
  test('denies everything, including an empty allOf', () => {
    const none = perms.NO_PERMISSIONS;
    for (const key of catalog.ALL_PERMISSIONS) assert.equal(none.can(key), false, key);
    assert.equal(none.canAny(catalog.ALL_PERMISSIONS), false);
    assert.equal(none.canAll(catalog.ALL_PERMISSIONS), false);
    assert.equal(none.canAny([]), false);
    assert.equal(none.canAll([]), false);
    assert.equal(none.isSuperAdmin, false);
    assert.equal(none.permissions.size, 0);
    assert.equal(Object.isFrozen(none), true);
    assert.throws(() => (none.permissions as Set<string>).add('withdrawals.approve'), TypeError);
    assert.equal(none.permissions.size, 0);
  });
});

describe('permissionsAllow', () => {
  let p: UsePermissionsResult;

  before(() => {
    p = perms.createPermissions(['withdrawals.read', 'withdrawals.approve'], false);
  });

  test('a requirement naming nothing allows nothing, even for a super admin', () => {
    assert.equal(perms.permissionsAllow(p, {}), false);
    assert.equal(perms.permissionsAllow(perms.createPermissions([], true), {}), false);
    assert.equal(
      perms.permissionsAllow(p, { permission: undefined, anyOf: undefined, allOf: undefined }),
      false,
    );
  });

  test('permission, anyOf and allOf each gate on their own', () => {
    assert.equal(perms.permissionsAllow(p, { permission: 'withdrawals.approve' }), true);
    assert.equal(perms.permissionsAllow(p, { permission: 'withdrawals.reject' }), false);
    assert.equal(perms.permissionsAllow(p, { anyOf: ['withdrawals.reject', 'withdrawals.approve'] }), true);
    assert.equal(perms.permissionsAllow(p, { anyOf: ['withdrawals.reject', 'withdrawals.export'] }), false);
    assert.equal(perms.permissionsAllow(p, { allOf: ['withdrawals.read', 'withdrawals.approve'] }), true);
    assert.equal(perms.permissionsAllow(p, { allOf: ['withdrawals.read', 'withdrawals.reject'] }), false);
  });

  test('empty lists follow canAny and canAll', () => {
    assert.equal(perms.permissionsAllow(p, { anyOf: [] }), false);
    assert.equal(perms.permissionsAllow(p, { allOf: [] }), true);
    assert.equal(perms.permissionsAllow(perms.NO_PERMISSIONS, { allOf: [] }), false);
  });

  test('when several are given, every one must hold', () => {
    assert.equal(
      perms.permissionsAllow(p, { permission: 'withdrawals.read', anyOf: ['withdrawals.approve'], allOf: ['withdrawals.read'] }),
      true,
    );
    assert.equal(perms.permissionsAllow(p, { permission: 'withdrawals.read', anyOf: ['withdrawals.reject'] }), false);
    assert.equal(perms.permissionsAllow(p, { permission: 'withdrawals.export', allOf: ['withdrawals.read'] }), false);
  });
});

describe('PermissionsProvider and usePermissions', () => {
  test('outside a provider the hook returns the deny-all value and does not throw', () => {
    let seen: UsePermissionsResult | null = null;
    function Capture(): ReactNode {
      seen = perms.usePermissions();
      return null;
    }
    assert.equal(render(createElement(Capture)), '');
    assert.equal(seen, perms.NO_PERMISSIONS);
  });

  test('the provider renders only its children, so server and client markup match', () => {
    const html = render(provider(['users.read'], false, createElement('main', null, 'Users')));
    assert.equal(html, '<main>Users</main>');
  });

  test('every consumer in a tree shares one value and one set of functions', () => {
    const seen: UsePermissionsResult[] = [];
    function Capture(): ReactNode {
      seen.push(perms.usePermissions());
      return null;
    }
    render(provider(['users.read'], false, createElement(Capture), createElement('div', null, createElement(Capture))));
    assert.equal(seen.length, 2);
    assert.equal(seen[0], seen[1]);
    assert.equal(seen[0].can, seen[1].can);
    assert.equal(seen[0].can('users.read'), true);
  });

  test('a nested provider overrides its parent for its own subtree only', () => {
    const html = render(provider(
      ['users.read'],
      false,
      createElement(Probe, { id: 'outer' }),
      provider(['withdrawals.read'], false, createElement(Probe, { id: 'inner' })),
    ));
    assert.equal(textById(html, 'outer'), 'read=false approve=false users=true super=false');
    assert.equal(textById(html, 'inner'), 'read=true approve=false users=false super=false');
  });

  test('a super admin provider grants every check even with an empty list', () => {
    const html = render(provider([], true, createElement(Probe)));
    assert.equal(textById(html, 'probe'), 'read=true approve=true users=true super=true');
  });
});

describe('useCan', () => {
  function CanProbe({ check, mode }: { check: Permission | readonly Permission[]; mode?: 'any' | 'all' }): ReactNode {
    return String(perms.useCan(check, mode));
  }

  const ask = (held: readonly string[], check: Permission | readonly Permission[], mode?: 'any' | 'all') =>
    render(provider(held, false, createElement(CanProbe, { check, mode })));

  test('a single permission', () => {
    assert.equal(ask(['withdrawals.approve'], 'withdrawals.approve'), 'true');
    assert.equal(ask(['withdrawals.read'], 'withdrawals.approve'), 'false');
    assert.equal(ask(['withdrawals.read'], 'withdrawals.read', 'any'), 'true');
  });

  test('a list defaults to every permission held', () => {
    assert.equal(ask(['withdrawals.approve'], ['withdrawals.approve', 'withdrawals.reject']), 'false');
    assert.equal(ask(['withdrawals.approve', 'withdrawals.reject'], ['withdrawals.approve', 'withdrawals.reject']), 'true');
    assert.equal(ask(['withdrawals.approve'], ['withdrawals.approve', 'withdrawals.reject'], 'all'), 'false');
  });

  test('mode any needs one of the list', () => {
    assert.equal(ask(['withdrawals.reject'], ['withdrawals.approve', 'withdrawals.reject'], 'any'), 'true');
    assert.equal(ask(['withdrawals.read'], ['withdrawals.approve', 'withdrawals.reject'], 'any'), 'false');
  });

  test('outside a provider every form is false', () => {
    assert.equal(render(createElement(CanProbe, { check: 'withdrawals.read' })), 'false');
    assert.equal(render(createElement(CanProbe, { check: ['withdrawals.read'], mode: 'any' })), 'false');
    assert.equal(render(createElement(CanProbe, { check: [] })), 'false');
  });
});

describe('Can', () => {
  const exportButton = () => createElement('button', { type: 'button' }, 'Export');
  const note = () => createElement('p', null, 'You can view withdrawals but not export them.');

  test('renders its children with no wrapper element when allowed', () => {
    const html = render(provider(['withdrawals.export'], false,
      createElement(perms.Can, { permission: 'withdrawals.export' }, exportButton())));
    assert.equal(html, '<button type="button">Export</button>');
  });

  test('renders nothing by default when denied', () => {
    const html = render(provider(['withdrawals.read'], false,
      createElement(perms.Can, { permission: 'withdrawals.export' }, exportButton())));
    assert.equal(html, '');
  });

  test('renders the fallback when denied', () => {
    const html = render(provider(['withdrawals.read'], false,
      createElement(perms.Can, { permission: 'withdrawals.export', fallback: note() }, exportButton())));
    assert.equal(textOf(html), 'You can view withdrawals but not export them.');
    assert.equal(tagsOf(html, 'button').length, 0);
  });

  test('anyOf and allOf gate the same way as the hook', () => {
    const held = ['withdrawals.approve'];
    const any = render(provider(held, false,
      createElement(perms.Can, { anyOf: ['withdrawals.approve', 'withdrawals.reject'] }, 'actions')));
    const all = render(provider(held, false,
      createElement(perms.Can, { allOf: ['withdrawals.approve', 'withdrawals.reject'], fallback: 'none' }, 'actions')));
    assert.equal(any, 'actions');
    assert.equal(all, 'none');
  });

  test('with no requirement it fails closed', () => {
    const html = render(provider(['withdrawals.read'], true,
      createElement(perms.Can, { fallback: 'none' }, exportButton())));
    assert.equal(html, 'none');
  });

  test('outside a provider it never renders its children', () => {
    assert.equal(render(createElement(perms.Can, { permission: 'withdrawals.read' }, exportButton())), '');
    assert.equal(render(createElement(perms.Can, { allOf: [], fallback: 'none' }, exportButton())), 'none');
  });

  test('a super admin sees every gated child', () => {
    const html = render(provider([], true,
      createElement(perms.Can, { allOf: ['withdrawals.approve', 'withdrawals.reject', 'withdrawals.export'] }, exportButton())));
    assert.equal(html, '<button type="button">Export</button>');
  });
});

describe('Permissions.tsx module boundaries', () => {
  test('is a client module that takes only the Permission type from the catalog', () => {
    const text = source('_ui/Permissions.tsx');
    assert.match(text, /^'use client';/);
    const fromCatalog = text.split('\n').filter((line) => /from '\.\.\/lib\/permissions'/.test(line));
    assert.ok(fromCatalog.length > 0);
    for (const line of fromCatalog) assert.match(line, /^import type \{/);
  });
});

describe('Shell provides permissions to every page', () => {
  let shell: ShellModule;
  let theme: ThemeModule;

  before(async () => {
    shell = await loadAppModule<ShellModule>('(dashboard)/_shell/Shell.tsx');
    theme = await loadUi<ThemeModule>('theme.tsx');
  });

  function inShell(pathname: string, props: Partial<Omit<ShellProps, 'children'>>, child: ReactNode): string {
    const shellProps: ShellProps = {
      allowedKeys: [],
      isSuperAdmin: false,
      permissions: [],
      username: 'ada',
      roleTitle: 'Operations',
      ...props,
      children: child,
    };
    return render(createElement(
      PathnameContext.Provider,
      { value: pathname },
      createElement(theme.ThemeProvider, {
        initialMode: 'light',
        initialResolved: 'light',
        children: createElement(shell.Shell, shellProps),
      }),
    ));
  }

  test('a page under the shell reads the resolved permissions it was given', () => {
    const html = inShell('/dashboard', {
      allowedKeys: ['withdrawals'],
      permissions: ['withdrawals.read'],
    }, createElement(Probe));
    assert.equal(textById(html, 'probe'), 'read=true approve=false users=false super=false');
  });

  test('a super admin page sees every permission', () => {
    const html = inShell('/dashboard', {
      isSuperAdmin: true,
      permissions: asLayoutPasses([], true),
    }, createElement(Probe));
    assert.equal(textById(html, 'probe'), 'read=true approve=true users=true super=true');
  });

  test('navigation still follows allowedKeys, not the new permissions prop', () => {
    const html = inShell('/dashboard', {
      allowedKeys: ['withdrawals'],
      permissions: ['withdrawals.read', 'users.read', 'transactions.read'],
    }, createElement(Probe));
    const hrefs = tagsOf(html, 'a').map((a) => a.href);
    assert.ok(hrefs.includes('/withdrawals'));
    assert.ok(!hrefs.includes('/users'));
    assert.ok(!hrefs.includes('/transactions-overview'));
  });

  test('the page access gate is unchanged: it still checks allowedKeys', () => {
    const html = inShell('/users', {
      allowedKeys: ['withdrawals'],
      permissions: ['users.read'],
    }, createElement(Probe));
    assert.equal(textById(html, 'probe'), undefined);
    assert.ok(textOf(html).includes('You do not have access to this page'));
  });

  test('the provider wraps the toast and confirm providers, so dialog content shares the context', () => {
    const text = source('(dashboard)/_shell/Shell.tsx');
    assert.match(
      text,
      /<PermissionsProvider\b[^>]*>\s*<ToastProvider>\s*<ConfirmProvider>/,
    );
  });
});
