import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { classesOf, loadAppModule, loadUiExport, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { JsonBranch, MaskKind } from '../app/lib/mask.ts';
import type { MaskedValueProps } from '../app/_ui/Masked.tsx';

type MaskModule = typeof import('../app/lib/mask.ts');
type RouteMasking = { maskTail: (value: unknown) => string; maskMetadata: (value: unknown) => unknown };

const mask = await loadAppModule<MaskModule>('lib/mask.ts');
const MaskedValue = await loadUiExport('Masked.tsx', 'MaskedValue');

const appText = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8');

const ROUTE_MASK = '••••';
const ROUTE_KEYS = new Set(['account_number', 'electricity_token']);

function routeMaskTail(value: unknown): string {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, '') : '';
  return text.length > 4 ? `${ROUTE_MASK} ${text.slice(-4)}` : ROUTE_MASK;
}

function routeMaskMetadata(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => routeMaskMetadata(item));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const sensitive = ROUTE_KEYS.has(key) && inner !== null && inner !== undefined && inner !== '';
    out[key] = sensitive ? routeMaskTail(inner) : routeMaskMetadata(inner);
  }
  return out;
}

function legacyMaskAccount(value: string | null | undefined): { text: string; spoken: string } {
  const digits = String(value ?? '').replace(/\s+/g, '');
  if (!digits) return { text: '—', spoken: 'No account number' };
  if (digits.length <= 4) return { text: '••••', spoken: 'Account number hidden' };
  const tail = digits.slice(-4);
  return { text: `•••• ${tail}`, spoken: `Account ending ${tail.split('').join(' ')}` };
}

function legacyClientMaskTail(value: unknown): string {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (text.startsWith('•')) return text;
  const compact = text.replace(/\s+/g, '');
  return compact.length > 4 ? `•••• ${compact.slice(-4)}` : '••••';
}

function legacyMaskedSpoken(masked: string): string {
  const tail = masked.replace(/[^0-9A-Za-z]/g, '');
  return tail ? `Hidden, ending ${tail.split('').join(' ')}` : 'Hidden';
}

function extractFunction(source: string, name: string): string | null {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  return null;
}

async function routeMasking(source: string): Promise<RouteMasking | null> {
  const tail = extractFunction(source, 'maskTail');
  const metadata = extractFunction(source, 'maskMetadata');
  const keys = source.match(/const MASKED_METADATA_KEYS = new Set\(\[[^\]]*\]\);/)?.[0];
  const constant = source.match(/const MASK = '[^']*';/)?.[0];
  if (!tail || !metadata || !keys || !constant) return null;
  const { outputText } = ts.transpileModule(
    [constant, keys, tail, metadata, 'export { maskTail, maskMetadata };'].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  );
  return (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)) as RouteMasking;
}

const TAIL_SAMPLES: unknown[] = [
  '', ' ', '\t', '1', '12', '123', '1234', '12345', '0123456789', ' 0123 4567 89 ', '\t9876\n5432',
  '0801 234 5678', '+234 803 123 4567', 'ABCD-EFGH-WXYZ', 'AB-12', '•••• 1234', '••••', '•abc12345', '1234 ',
  '    12345', 'a b c d e', 'é1234', '\u{1D7D9}\u{1D7DA}\u{1D7DB}\u{1D7DC}\u{1D7DD}',
  0, 7, 1234, 12345, -12345, 1.5, 12345.678, 1234567890, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity, 1e21,
  true, false, null, undefined, {}, [], ['0123456789'], { n: '0123456789' }, BigInt('9007199254740993'),
  Symbol('0123456789'), () => '0123456789', new Date(0),
];

const METADATA_SAMPLES: unknown[] = [
  null, undefined, 'x', 5, true, [], {},
  { account_number: '0123456789', bank_name: 'GTBank', account_name: 'ADA OBI' },
  { account_number: '1234' },
  { account_number: '' },
  { account_number: null },
  { account_number: undefined },
  { account_number: '   ' },
  { account_number: 0 },
  { account_number: 1234567890 },
  { account_number: { nested: '0123456789' } },
  { account_number: ['0123456789'] },
  { account_number: true },
  { account_number: '•••• 6789' },
  { electricity_token: '1234 5678 9012 3456 7890', units: '12.5 kWh' },
  { nested: { account_number: '9876543210', deeper: [{ electricity_token: '11112222333344445555' }] } },
  [{ account_number: '0123456789' }, 'plain', 7, null, [{ electricity_token: '55554444' }]],
  { ACCOUNT_NUMBER: '0123456789', account_numbers: ['0123456789'], accountNumber: '0123456789' },
  { fee: 50, recipient: '08031234567', disputed_at: '2026-10-01T09:00:00.000Z', provider: { id: 'p1' } },
];

describe('maskTail', () => {
  test('matches the server route implementation for every sample at the default width', () => {
    for (const sample of TAIL_SAMPLES) {
      assert.equal(mask.maskTail(sample), routeMaskTail(sample), `sample ${String(sample)}`);
      assert.equal(mask.maskTail(sample, 4), routeMaskTail(sample), `sample ${String(sample)} at 4`);
    }
  });

  test('pins the masking table', () => {
    const table: Array<[unknown, string]> = [
      ['0123456789', '•••• 6789'],
      [' 0123 4567 89 ', '•••• 6789'],
      ['+234 803 123 4567', '•••• 4567'],
      ['12345', '•••• 2345'],
      ['1234', '••••'],
      ['12', '••••'],
      ['', '••••'],
      [1234567890, '•••• 7890'],
      [null, '••••'],
      [undefined, '••••'],
      [{ value: '0123456789' }, '••••'],
      [true, '••••'],
    ];
    for (const [input, expected] of table) assert.equal(mask.maskTail(input), expected, `input ${String(input)}`);
  });

  test('never reveals a value that is not longer than the visible count', () => {
    for (let visible = 1; visible <= 8; visible += 1) {
      for (let length = 0; length <= visible; length += 1) {
        assert.equal(mask.maskTail('9'.repeat(length), visible), '••••', `length ${length} at ${visible}`);
      }
    }
  });

  test('reveals exactly the last characters requested', () => {
    assert.equal(mask.maskTail('0123456789', 2), '•••• 89');
    assert.equal(mask.maskTail('0123456789', 6), '•••• 456789');
    assert.equal(mask.maskTail('0123456789', 9), '•••• 123456789');
    assert.equal(mask.maskTail('0123456789', 2.9), '•••• 89');
  });

  test('treats zero, negative and non-finite widths as fully masked', () => {
    for (const visible of [0, -1, -10, NaN, Infinity, -Infinity]) {
      assert.equal(mask.maskTail('0123456789', visible), '••••', `visible ${visible}`);
    }
  });

  test('keeps a fixed prefix so the masked text does not reveal the length', () => {
    const short = mask.maskTail('12345');
    const long = mask.maskTail('1234567890123456789012345');
    assert.equal(short.length, long.length);
    assert.ok(short.startsWith('•••• ') && long.startsWith('•••• '));
  });
});

describe('maskForDisplay', () => {
  const KINDS: MaskKind[] = ['account', 'phone', 'code', 'generic'];

  test('renders a dash and "Not provided" for missing values in every kind', () => {
    for (const kind of KINDS) {
      for (const value of [null, undefined, '', '   ', '\n\t']) {
        assert.deepEqual(
          mask.maskForDisplay(value, { kind }),
          { text: '—', spoken: 'Not provided', empty: true },
          `${kind} ${JSON.stringify(value)}`,
        );
      }
    }
  });

  test('speaks the tail digit by digit with a kind-specific phrase', () => {
    const table: Array<[unknown, MaskKind, string, string]> = [
      ['0123456789', 'account', '•••• 6789', 'Account ending 6 7 8 9'],
      [1234567890, 'account', '•••• 7890', 'Account ending 7 8 9 0'],
      ['1234', 'account', '••••', 'Account number hidden'],
      ['+234 803 123 4567', 'phone', '•••• 4567', 'Phone number ending 4 5 6 7'],
      ['803', 'phone', '••••', 'Phone number hidden'],
      ['ABCD-EFGH-WXYZ', 'code', '•••• WXYZ', 'Code ending W X Y Z'],
      ['AB-12', 'code', '•••• B-12', 'Code ending B 1 2'],
      ['WXYZ', 'code', '••••', 'Code hidden'],
      ['•••• 1234', 'generic', '•••• 1234', 'Hidden, ending 1 2 3 4'],
      ['••••', 'generic', '••••', 'Hidden'],
      [{ secret: '0123456789' }, 'generic', '••••', 'Hidden'],
    ];
    for (const [value, kind, text, spoken] of table) {
      assert.deepEqual(mask.maskForDisplay(value, { kind }), { text, spoken, empty: false }, `${kind} ${String(value)}`);
    }
  });

  test('defaults to the generic phrasing and four visible characters', () => {
    assert.deepEqual(mask.maskForDisplay('0123456789'), {
      text: '•••• 6789',
      spoken: 'Hidden, ending 6 7 8 9',
      empty: false,
    });
  });

  test('uses a label as the spoken noun and ignores a blank label', () => {
    assert.equal(
      mask.maskForDisplay('12345678901234567890', { label: 'Electricity token' }).spoken,
      'Electricity token ending 7 8 9 0',
    );
    assert.equal(mask.maskForDisplay('123', { label: 'Electricity token' }).spoken, 'Electricity token hidden');
    assert.equal(mask.maskForDisplay('0123456789', { kind: 'account', label: '   ' }).spoken, 'Account ending 6 7 8 9');
    assert.equal(mask.maskForDisplay(null, { label: 'Electricity token' }).spoken, 'Not provided');
  });

  test('falls back to generic phrasing for an unknown kind', () => {
    for (const kind of ['bogus', 'toString', 'constructor', '__proto__']) {
      assert.equal(
        mask.maskForDisplay('0123456789', { kind: kind as MaskKind }).spoken,
        'Hidden, ending 6 7 8 9',
        kind,
      );
    }
  });

  test('honours the visible count and stays fully masked when it is unsafe', () => {
    assert.deepEqual(mask.maskForDisplay('0123456789', { kind: 'account', visible: 2 }), {
      text: '•••• 89',
      spoken: 'Account ending 8 9',
      empty: false,
    });
    for (const visible of [0, -3, NaN]) {
      assert.deepEqual(mask.maskForDisplay('0123456789', { kind: 'account', visible }), {
        text: '••••',
        spoken: 'Account number hidden',
        empty: false,
      });
    }
  });

  test('replaces the withdrawals MaskedAccount output for every non-empty account number', () => {
    const accounts = ['0123456789', ' 0123 4567 89 ', '12345', '1234', '1', '2034567812', 'AB12345678'];
    for (const account of accounts) {
      const masked = mask.maskForDisplay(account, { kind: 'account' });
      const legacy = legacyMaskAccount(account);
      assert.equal(masked.text, legacy.text, account);
      assert.equal(masked.spoken, legacy.spoken, account);
    }
  });

  test('keeps the dash for a missing account number and announces it as "Not provided"', () => {
    for (const account of [null, undefined, '', '   ']) {
      assert.equal(mask.maskForDisplay(account, { kind: 'account' }).text, legacyMaskAccount(account).text);
      assert.equal(mask.maskForDisplay(account, { kind: 'account' }).spoken, 'Not provided');
    }
  });

  test('replaces the transactions MaskedText output for server-masked metadata', () => {
    const served = ['0123456789', '1234 5678 9012 3456 7890', '1234', '12', 0, 1234567890, '•••• 6789', '••••'];
    for (const raw of served) {
      const text = legacyClientMaskTail(routeMaskTail(raw));
      const masked = mask.maskForDisplay(text);
      assert.equal(masked.text, text, String(raw));
      assert.equal(masked.spoken, legacyMaskedSpoken(text), String(raw));
    }
  });

  test('is stricter than the old client re-mask for values that merely start with a dot', () => {
    assert.equal(legacyClientMaskTail('•abc12345'), '•abc12345');
    assert.equal(mask.maskForDisplay('•abc12345').text, '•••• 2345');
  });
});

describe('maskMetadata', () => {
  test('lists the metadata keys masked on screens', () => {
    assert.deepEqual([...mask.METADATA_MASK_KEYS], ['account_number', 'electricity_token']);
  });

  test('matches the server route implementation for every sample', () => {
    for (const sample of METADATA_SAMPLES) {
      assert.deepEqual(mask.maskMetadata(sample), routeMaskMetadata(sample), JSON.stringify(sample));
    }
  });

  test('pins masked output for nested metadata', () => {
    assert.deepEqual(
      mask.maskMetadata({
        account_number: '0123456789',
        bank_name: 'GTBank',
        nested: [{ electricity_token: '11112222333344445555', note: '' }],
        empty: { account_number: '' },
      }),
      {
        account_number: '•••• 6789',
        bank_name: 'GTBank',
        nested: [{ electricity_token: '•••• 5555', note: '' }],
        empty: { account_number: '' },
      },
    );
  });

  test('does not mutate its input', () => {
    const input = { account_number: '0123456789', nested: { electricity_token: '1234567890' } };
    const before = JSON.stringify(input);
    mask.maskMetadata(input);
    assert.equal(JSON.stringify(input), before);
  });

  for (const route of ['api/transactions/route.ts', 'api/users/[id]/route.ts']) {
    test(`stays identical to ${route} or replaces its copy`, async () => {
      const source = appText(route);
      const local = await routeMasking(source);
      if (local) {
        for (const sample of TAIL_SAMPLES) {
          assert.equal(mask.maskTail(sample), local.maskTail(sample), `${route} maskTail ${String(sample)}`);
        }
        for (const sample of METADATA_SAMPLES) {
          assert.deepEqual(mask.maskMetadata(sample), local.maskMetadata(sample), `${route} ${JSON.stringify(sample)}`);
        }
        return;
      }
      assert.match(source, /\bmaskMetadata\b[^;]*from\s+['"](?:\.\.\/)+lib\/mask['"]/);
    });
  }
});

describe('isMaskable', () => {
  test('treats only null, undefined and the empty string as nothing to mask', () => {
    for (const value of [null, undefined, '']) assert.equal(mask.isMaskable(value), false);
    for (const value of [' ', '0', 0, false, true, {}, [], NaN]) assert.equal(mask.isMaskable(value), true);
  });
});

describe('toMaskedJson', () => {
  const PLAIN: unknown[] = [
    null, true, false, 0, -0, 1.5, -12, 1e21, 'plain', 'quote " and \\ and \n newline', '', [], {},
    [1, [2, [3, []]]],
    { a: { b: { c: [] } } },
    { 'key with "quote"': 1, '': 'empty key' },
    { list: [{ id: 1, tags: ['a', 'b'] }, { id: 2, tags: [] }], total: 2, ok: true, none: null },
    [{ nested: [{ deep: { deeper: 'x' } }] }, 'tail'],
  ];

  test('matches JSON.stringify for plain JSON values at every indent', () => {
    for (const value of PLAIN) {
      assert.equal(mask.toMaskedJson(value), JSON.stringify(value, null, 2), JSON.stringify(value));
      assert.equal(mask.toMaskedJson(value, { space: 0 }), JSON.stringify(value), JSON.stringify(value));
      assert.equal(mask.toMaskedJson(value, { space: 4 }), JSON.stringify(value, null, 4), JSON.stringify(value));
    }
  });

  test('clamps the indent to 0-10 spaces and falls back to two for a non-finite indent', () => {
    const value = { a: [1] };
    assert.equal(mask.toMaskedJson(value, { space: 20 }), JSON.stringify(value, null, 10));
    assert.equal(mask.toMaskedJson(value, { space: -1 }), JSON.stringify(value));
    assert.equal(mask.toMaskedJson(value, { space: NaN }), JSON.stringify(value, null, 2));
  });

  test('masks the named keys at any depth and never emits their values', () => {
    const value = {
      account_number: '0123456789',
      bank_name: 'GTBank',
      payouts: [{ account_number: 2034567812, meta: { pin: { a: 1 } } }],
    };
    const text = mask.toMaskedJson(value, { maskKeys: ['account_number', 'pin'] });
    assert.deepEqual(JSON.parse(text), {
      account_number: '••••',
      bank_name: 'GTBank',
      payouts: [{ account_number: '••••', meta: { pin: '••••' } }],
    });
    assert.ok(!text.includes('0123456789') && !text.includes('2034567812') && !text.includes('"a"'));
  });

  test('accepts any iterable of keys', () => {
    assert.equal(mask.toMaskedJson({ code: 'ABCD' }, { maskKeys: new Set(['code']), space: 0 }), '{"code":"••••"}');
  });

  test('leaves empty values under masked keys as they are', () => {
    assert.equal(
      mask.toMaskedJson({ pin: null, code: '', token: undefined, keep: 1 }, { maskKeys: ['pin', 'code', 'token'], space: 0 }),
      '{"pin":null,"code":"","keep":1}',
    );
  });

  test('does not treat array positions as keys', () => {
    assert.equal(mask.toMaskedJson(['a', 'b'], { maskKeys: ['0', '1'], space: 0 }), '["a","b"]');
  });

  test('replaces circular references and keeps shared references', () => {
    const shared = { x: 1 };
    const value: Record<string, unknown> = { name: 'root', a: shared, b: [shared] };
    value.self = value;
    (shared as Record<string, unknown>).back = [value];
    assert.deepEqual(JSON.parse(mask.toMaskedJson(value)), {
      name: 'root',
      a: { x: 1, back: ['[Circular]'] },
      b: [{ x: 1, back: ['[Circular]'] }],
      self: '[Circular]',
    });
  });

  test('serialises non-JSON values the way JSON.stringify would, without throwing', () => {
    const value = {
      big: BigInt('12345678901234567890'),
      at: new Date('2026-10-01T09:30:00.000Z'),
      invalid: new Date('nope'),
      nan: NaN,
      inf: -Infinity,
      fn: function named() {
        return 1;
      },
      nothing: undefined,
      sym: Symbol('s'),
      boxed: [Object(7), Object('seven'), Object(false)],
      list: [undefined, () => 1, Symbol('t')],
      custom: { toJSON: () => ({ replaced: true }) },
    };
    const text = mask.toMaskedJson(value, { space: 0 });
    assert.equal(
      text,
      '{"big":12345678901234567890,"at":"2026-10-01T09:30:00.000Z","invalid":null,"nan":null,"inf":null,'
        + '"boxed":[7,"seven",false],"list":[null,null,null],"custom":{"replaced":true}}',
    );
    assert.doesNotThrow(() => JSON.parse(text));
  });

  test('marks unreadable values instead of throwing', () => {
    const throwing = {
      ok: 1,
      get boom(): unknown {
        throw new Error('getter failed');
      },
    };
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    const text = mask.toMaskedJson({ throwing, revoked: revocable.proxy }, { space: 0 });
    assert.equal(text, '{"throwing":{"ok":1,"boom":"[Unreadable]"},"revoked":"[Unreadable]"}');
  });

  test('stops a toJSON that keeps wrapping itself', () => {
    const looping: Record<string, unknown> = {};
    looping.toJSON = function toJSON(this: unknown) {
      return { self: this };
    };
    assert.equal(mask.toMaskedJson(looping, { space: 0 }), '{"self":"[Circular]"}');
  });

  test('returns null text for values JSON cannot represent at the root', () => {
    assert.equal(mask.toMaskedJson(undefined), 'null');
    assert.equal(mask.toMaskedJson(() => 1), 'null');
    assert.equal(mask.toMaskedJson(Symbol('x')), 'null');
  });
});

describe('inspectJson and jsonChildAt', () => {
  test('classifies leaves with display text and JSON text', () => {
    const table: Array<[unknown, string, string, string | undefined]> = [
      ['a"b', 'string', '"a\\"b"', '"a\\"b"'],
      [12.5, 'number', '12.5', '12.5'],
      [NaN, 'number', 'NaN', 'null'],
      [BigInt(42), 'number', '42', '42'],
      [true, 'boolean', 'true', 'true'],
      [null, 'null', 'null', 'null'],
      [undefined, 'undefined', 'undefined', undefined],
      [function payout() {
        return 1;
      }, 'function', '[Function payout]', undefined],
      [Symbol('tag'), 'symbol', 'Symbol(tag)', undefined],
      [new Date('2026-10-01T00:00:00.000Z'), 'string', '"2026-10-01T00:00:00.000Z"', '"2026-10-01T00:00:00.000Z"'],
    ];
    for (const [value, kind, text, json] of table) {
      assert.deepEqual(mask.inspectJson(value), { kind, text, json }, String(kind));
    }
    const anonymous = mask.inspectJson(Object.defineProperty(() => 1, 'name', { value: '' }));
    assert.equal(anonymous.kind === 'function' && anonymous.text, '[Function]');
  });

  test('describes branches with their size and an ancestor chain for cycle checks', () => {
    const value = { a: 1, b: [1, 2, 3] };
    const node = mask.inspectJson(value) as JsonBranch;
    assert.equal(node.kind, 'object');
    assert.deepEqual([...node.keys], ['a', 'b']);
    assert.equal(node.size, 2);
    assert.ok(node.ancestors.includes(value));
    const child = mask.jsonChildAt(node, 1);
    assert.deepEqual({ key: child.key, name: child.name }, { key: 'b', name: 'b' });
    const array = mask.inspectJson(child.value, { key: child.key, ancestors: node.ancestors }) as JsonBranch;
    assert.equal(array.kind, 'array');
    assert.equal(array.size, 3);
    assert.deepEqual(mask.jsonChildAt(array, 2), { key: null, name: '2', value: 3 });
  });

  test('masks only keyed, non-empty values', () => {
    const maskKeys = new Set(['secret']);
    assert.deepEqual(mask.inspectJson('x', { key: 'secret', maskKeys }), { kind: 'masked', text: '••••', json: '"••••"' });
    assert.equal(mask.inspectJson(null, { key: 'secret', maskKeys }).kind, 'null');
    assert.equal(mask.inspectJson('x', { key: null, maskKeys }).kind, 'string');
    assert.equal(mask.inspectJson('x', { maskKeys }).kind, 'string');
  });

  test('flags a value already on the ancestor chain as circular', () => {
    const parent = { child: {} };
    assert.equal(mask.inspectJson(parent, { ancestors: [parent] }).kind, 'circular');
  });

  test('turns a throwing getter into an unreadable leaf', () => {
    const value = {
      get broken(): unknown {
        throw new Error('nope');
      },
    };
    const node = mask.inspectJson(value) as JsonBranch;
    const child = mask.jsonChildAt(node, 0);
    assert.deepEqual(mask.inspectJson(child.value, { key: child.key, ancestors: node.ancestors }), {
      kind: 'unreadable',
      text: '[Unreadable]',
      json: '"[Unreadable]"',
    });
  });
});

describe('MaskedValue', () => {
  const view = (props: MaskedValueProps) => render(createElement(MaskedValue, props));

  test('renders the masked text hidden from screen readers and the spoken text for them', () => {
    const html = view({ value: '0123456789', kind: 'account' });
    const [outer, visible] = tagsOf(html, 'span');
    assert.deepEqual(classesOf(outer), ['masked']);
    assert.equal(outer.translate, 'no');
    assert.equal(visible['aria-hidden'], 'true');
    assert.match(html, /<span aria-hidden="true">•••• 6789<\/span><span class="srOnly">Account ending 6 7 8 9<\/span>/);
  });

  test('never puts the full value in the markup and offers no copy affordance', () => {
    for (const [value, kind] of [['0123456789', 'account'], ['ABCD-EFGH-WXYZ-9876', 'code'], ['08031234567', 'phone']]) {
      const html = view({ value, kind: kind as MaskKind });
      assert.ok(!html.includes(value), value);
      assert.equal(tagsOf(html, 'button').length, 0);
      assert.ok(!/\btitle=/.test(html));
    }
  });

  test('renders a muted dash with "Not provided" for missing values', () => {
    for (const value of [null, undefined, '']) {
      const html = view({ value, kind: 'account' });
      assert.deepEqual(classesOf(tagsOf(html, 'span')[0]), ['masked', 'missing']);
      assert.equal(textOf(html), '— Not provided');
    }
  });

  test('uses srLabel as the spoken noun', () => {
    const html = view({ value: '12345678901234567890', srLabel: 'Electricity token' });
    assert.match(html, /<span class="srOnly">Electricity token ending 7 8 9 0<\/span>/);
  });

  test('defaults to generic phrasing and four visible characters', () => {
    const html = view({ value: '•••• 1234' });
    assert.match(html, /<span aria-hidden="true">•••• 1234<\/span><span class="srOnly">Hidden, ending 1 2 3 4<\/span>/);
  });

  test('honours visible and kind', () => {
    const html = view({ value: '+234 803 123 4567', kind: 'phone', visible: 2 });
    assert.match(html, /<span aria-hidden="true">•••• 67<\/span><span class="srOnly">Phone number ending 6 7<\/span>/);
  });

  test('merges className and forwards attributes', () => {
    const html = view({ value: '0123456789', className: 'extra', id: 'acct', 'aria-describedby': 'hint' });
    const outer = tagsOf(html, 'span')[0];
    assert.deepEqual(classesOf(outer), ['masked', 'extra']);
    assert.equal(outer.id, 'acct');
    assert.equal(outer['aria-describedby'], 'hint');
  });
});

describe('sensitive display hard rules', () => {
  const sources = ['lib/mask.ts', '_ui/Masked.tsx', '_ui/Masked.module.css'].map((path) => [path, appText(path)] as const);

  test('carries no prose comments', () => {
    for (const [path, source] of sources) assert.ok(!/\/\*|(^|[^:])\/\/(?!\/)/m.test(source), path);
  });

  test('keeps the masking module free of React and the browser', () => {
    const source = appText('lib/mask.ts');
    assert.ok(!/from ['"]react/.test(source));
    assert.ok(!/\b(window|document|navigator)\b/.test(source));
  });

  test('styles with tokens only', () => {
    const css = appText('_ui/Masked.module.css');
    assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|z-index/i.test(css));
    assert.match(css, /var\(--font-mono\)/);
    assert.match(css, /tabular-nums/);
  });

  test('anchors the screen-reader text to the masked value so it cannot add scroll overflow elsewhere', () => {
    const css = appText('_ui/Masked.module.css');
    const masked = css.slice(css.indexOf('.masked {'), css.indexOf('}', css.indexOf('.masked {')));
    assert.match(masked, /position: relative;/);
    assert.match(css.slice(css.indexOf('.srOnly {')), /position: absolute;/);
  });
});
