import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  nextSort,
  sortToParams,
  sortWithKey,
  useTableSort,
  type SortState,
  type UseTableSortOptions,
  type UseTableSortResult,
} from '../app/_ui/useTableSort.ts';

describe('nextSort', () => {
  test('with no current sort, a column starts ascending', () => {
    assert.deepEqual(nextSort(null, 'amount'), { key: 'amount', dir: 'asc' });
    assert.deepEqual(nextSort(undefined, 'amount'), { key: 'amount', dir: 'asc' });
  });

  test('the active column flips ascending to descending', () => {
    assert.deepEqual(nextSort({ key: 'amount', dir: 'asc' }, 'amount'), { key: 'amount', dir: 'desc' });
  });

  test('the active column flips descending back to ascending, never to unsorted', () => {
    assert.deepEqual(nextSort({ key: 'amount', dir: 'desc' }, 'amount'), { key: 'amount', dir: 'asc' });
  });

  test('a different column starts ascending even when the previous one was descending', () => {
    assert.deepEqual(nextSort({ key: 'amount', dir: 'desc' }, 'created_at'), { key: 'created_at', dir: 'asc' });
    assert.deepEqual(nextSort({ key: 'amount', dir: 'asc' }, 'created_at'), { key: 'created_at', dir: 'asc' });
  });

  test('repeated clicks on one column alternate asc and desc', () => {
    let state: SortState | null = null;
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      state = nextSort(state, 'created_at');
      seen.push(state.dir);
    }
    assert.deepEqual(seen, ['asc', 'desc', 'asc', 'desc', 'asc']);
  });

  test('returning to an earlier column restarts at asc instead of restoring its old direction', () => {
    let state: SortState | null = nextSort(null, 'amount');
    state = nextSort(state, 'amount');
    assert.equal(state.dir, 'desc');
    state = nextSort(state, 'status');
    state = nextSort(state, 'amount');
    assert.deepEqual(state, { key: 'amount', dir: 'asc' });
  });

  test('keys are compared exactly, so case variants are different columns', () => {
    assert.deepEqual(nextSort({ key: 'Amount', dir: 'asc' }, 'amount'), { key: 'amount', dir: 'asc' });
    assert.deepEqual(nextSort({ key: 'users.name', dir: 'asc' }, 'users.name'), { key: 'users.name', dir: 'desc' });
  });

  test('the current state is never mutated and a fresh object is returned', () => {
    const current = Object.freeze({ key: 'amount', dir: 'asc' as const });
    const next = nextSort(current, 'amount');
    assert.notEqual(next, current);
    assert.deepEqual(current, { key: 'amount', dir: 'asc' });
  });
});

describe('sortWithKey', () => {
  test('changing the column keeps the chosen direction', () => {
    assert.deepEqual(sortWithKey({ key: 'created_at', dir: 'desc' }, 'amount'), { key: 'amount', dir: 'desc' });
    assert.deepEqual(sortWithKey({ key: 'created_at', dir: 'asc' }, 'amount'), { key: 'amount', dir: 'asc' });
  });

  test('with no current sort the new column starts ascending, like a header click', () => {
    assert.deepEqual(sortWithKey(null, 'amount'), { key: 'amount', dir: 'asc' });
    assert.deepEqual(sortWithKey(undefined, 'amount'), nextSort(undefined, 'amount'));
  });

  test('re-selecting the active column never flips it', () => {
    assert.deepEqual(sortWithKey({ key: 'amount', dir: 'desc' }, 'amount'), { key: 'amount', dir: 'desc' });
  });

  test('returns a fresh object and leaves the current state alone', () => {
    const current = Object.freeze({ key: 'amount', dir: 'desc' as const });
    const next = sortWithKey(current, 'amount');
    assert.notEqual(next, current);
    assert.deepEqual(current, { key: 'amount', dir: 'desc' });
  });
});

describe('sortToParams', () => {
  test('no sort yields an empty object that adds nothing to a query', () => {
    assert.deepEqual(sortToParams(null), {});
    assert.deepEqual(sortToParams(undefined), {});
    assert.deepEqual({ page: '1', ...sortToParams(null) }, { page: '1' });
  });

  test('an active sort maps key to sort and keeps dir', () => {
    assert.deepEqual(sortToParams({ key: 'created_at', dir: 'desc' }), { sort: 'created_at', dir: 'desc' });
  });

  test('params feed URLSearchParams directly', () => {
    assert.equal(new URLSearchParams(sortToParams({ key: 'amount', dir: 'asc' })).toString(), 'sort=amount&dir=asc');
    assert.equal(new URLSearchParams(sortToParams(null)).toString(), '');
  });
});

describe('useTableSort', () => {
  function renderHook(initial?: SortState | null): UseTableSortResult {
    const box: { current: UseTableSortResult | null } = { current: null };
    function Probe() {
      box.current = initial === undefined ? useTableSort() : useTableSort(initial);
      return null;
    }
    renderToString(createElement(Probe));
    const result = box.current;
    assert.ok(result, 'hook did not render');
    return result;
  }

  test('starts from the initial sort and exposes it as API params', () => {
    const hook = renderHook({ key: 'created_at', dir: 'desc' });
    assert.deepEqual(hook.sort, { key: 'created_at', dir: 'desc' });
    assert.deepEqual(hook.toParams(), { sort: 'created_at', dir: 'desc' });
  });

  test('defaults to unsorted with empty params', () => {
    const hook = renderHook();
    assert.equal(hook.sort, null);
    assert.deepEqual(hook.toParams(), {});
  });

  test('exposes state controls only and never a way to sort rows locally', () => {
    const hook = renderHook(null);
    assert.deepEqual(Object.keys(hook).sort(), ['reset', 'setSort', 'sort', 'toParams', 'toggle']);
    for (const name of ['reset', 'setSort', 'toParams', 'toggle'] as const) {
      assert.equal(typeof hook[name], 'function');
    }
  });
});

describe('useTableSort controlled', () => {
  function renderControlled(value: SortState | null) {
    const changes: Array<SortState | null> = [];
    const options: UseTableSortOptions = { value, onChange: (next) => changes.push(next) };
    const box: { current: UseTableSortResult | null } = { current: null };
    function Probe() {
      box.current = useTableSort(options);
      return null;
    }
    renderToString(createElement(Probe));
    const hook = box.current;
    assert.ok(hook, 'hook did not render');
    return { hook: hook as UseTableSortResult, changes };
  }

  test('reads the sort straight from value', () => {
    const { hook, changes } = renderControlled({ key: 'balance', dir: 'asc' });
    assert.deepEqual(hook.sort, { key: 'balance', dir: 'asc' });
    assert.deepEqual(hook.toParams(), { sort: 'balance', dir: 'asc' });
    assert.deepEqual(changes, []);
  });

  test('toggle reports nextSort of the current value through onChange', () => {
    const { hook, changes } = renderControlled({ key: 'created_at', dir: 'desc' });
    hook.toggle('created_at');
    hook.toggle('balance');
    assert.deepEqual(changes, [
      { key: 'created_at', dir: 'asc' },
      { key: 'balance', dir: 'asc' },
    ]);
  });

  test('toggle never moves on by itself, because the owner holds the state', () => {
    const { hook, changes } = renderControlled({ key: 'amount', dir: 'asc' });
    hook.toggle('amount');
    hook.toggle('amount');
    assert.deepEqual(changes, [{ key: 'amount', dir: 'desc' }, { key: 'amount', dir: 'desc' }]);
    assert.deepEqual(hook.sort, { key: 'amount', dir: 'asc' });
  });

  test('an unsorted value starts the clicked column ascending', () => {
    const { hook, changes } = renderControlled(null);
    assert.equal(hook.sort, null);
    assert.deepEqual(hook.toParams(), {});
    hook.toggle('amount');
    assert.deepEqual(changes, [{ key: 'amount', dir: 'asc' }]);
  });

  test('setSort routes plain values and updaters through onChange', () => {
    const { hook, changes } = renderControlled({ key: 'amount', dir: 'asc' });
    hook.setSort({ key: 'created_at', dir: 'desc' });
    hook.setSort((current) => (current ? { ...current, dir: 'desc' } : null));
    hook.setSort(null);
    assert.deepEqual(changes, [
      { key: 'created_at', dir: 'desc' },
      { key: 'amount', dir: 'desc' },
      null,
    ]);
  });

  test('reset reports the value the hook started with', () => {
    const { hook, changes } = renderControlled({ key: 'created_at', dir: 'desc' });
    hook.reset();
    assert.deepEqual(changes, [{ key: 'created_at', dir: 'desc' }]);
  });

  test('controlled mode exposes the same controls as uncontrolled mode', () => {
    const { hook } = renderControlled(null);
    assert.deepEqual(Object.keys(hook).sort(), ['reset', 'setSort', 'sort', 'toParams', 'toggle']);
  });

  test('a plain sort state is still treated as the initial value', () => {
    const box: { current: UseTableSortResult | null } = { current: null };
    function Probe() {
      box.current = useTableSort({ key: 'created_at', dir: 'desc' });
      return null;
    }
    renderToString(createElement(Probe));
    assert.deepEqual(box.current?.sort, { key: 'created_at', dir: 'desc' });
  });
});

describe('Table styles', () => {
  const css = readFileSync(new URL('../app/_ui/Table.module.css', import.meta.url), 'utf8');

  test('every z-index is a bare scale token, never a number or arithmetic on one', () => {
    const values = [...css.matchAll(/z-index\s*:\s*([^;]+);/g)].map((match) => match[1].trim());
    assert.ok(values.length > 0);
    for (const value of values) assert.match(value, /^var\(--z-[a-z]+\)$/);
  });

  test('the scroll wrapper isolates its sticky layers from the page', () => {
    assert.match(css, /\.wrap \{[^}]*isolation: isolate;/);
  });
});
