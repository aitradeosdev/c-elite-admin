import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  PAYOUT_GATEWAY_KEYS, payoutGatewayConfig, readPayoutGateway, resolvePayoutGateway,
  type PayoutGateway, type PayoutGatewayConfig,
} from '../app/lib/gateway.ts';

type ConfigClient = Parameters<typeof readPayoutGateway>[0];

interface ConfigRow {
  key: string;
  value: string | null;
}

interface QueryCall {
  table: string;
  columns: string;
  column: string;
  values: string[];
}

interface FakeLookup {
  data?: unknown;
  error?: { message: string } | null;
  throws?: Error;
}

function fakeClient(lookup: FakeLookup): { client: ConfigClient; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            in(column: string, values: readonly string[]) {
              calls.push({ table, columns, column, values: [...values] });
              if (lookup.throws) return Promise.reject(lookup.throws);
              return Promise.resolve({ data: lookup.data ?? null, error: lookup.error ?? null });
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as ConfigClient, calls };
}

function rowsOf(config: Record<string, string | null | undefined>): ConfigRow[] {
  return Object.entries(config)
    .filter((entry): entry is [string, string | null] => entry[1] !== undefined)
    .map(([key, value]) => ({ key, value }));
}

const EDGE_GATEWAY = new URL('../../supabase/functions/_shared/gateway.ts', import.meta.url);
const EDGE_PRESENT = existsSync(EDGE_GATEWAY);

function extractFunction(source: string, signature: string): string | null {
  const start = source.indexOf(signature);
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

type EdgeResolver = (admin: unknown) => Promise<PayoutGateway>;

async function edgeResolver(): Promise<EdgeResolver> {
  const source = readFileSync(EDGE_GATEWAY, 'utf8');
  const body = extractFunction(source, 'async function getActiveGatewayName(');
  assert.ok(body, 'getActiveGatewayName was not found in supabase/functions/_shared/gateway.ts');
  const { outputText } = ts.transpileModule(`export ${body}`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const module = (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)) as {
    getActiveGatewayName: EdgeResolver;
  };
  return module.getActiveGatewayName;
}

describe('resolvePayoutGateway', () => {
  test('falls back to paystack when nothing is configured', () => {
    assert.equal(resolvePayoutGateway({}), 'paystack');
  });

  test('falls back to paystack when the active gateway is missing, null or empty', () => {
    for (const active of [undefined, null, '']) {
      const config: PayoutGatewayConfig = {
        active_payment_gateway: active,
        gateway_monnify_enabled: 'true',
        gateway_novac_enabled: 'true',
      };
      assert.equal(resolvePayoutGateway(config), 'paystack', String(active));
    }
  });

  test('uses paystack when it is active, whatever gateway_paystack_enabled says', () => {
    for (const enabled of [undefined, null, 'true', 'false', '']) {
      assert.equal(
        resolvePayoutGateway({ active_payment_gateway: 'paystack', gateway_paystack_enabled: enabled }),
        'paystack',
        String(enabled),
      );
    }
  });

  test('uses monnify only when it is active and gateway_monnify_enabled is exactly "true"', () => {
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'monnify', gateway_monnify_enabled: 'true' }), 'monnify');
    for (const enabled of [undefined, null, '', 'false', 'TRUE', 'True', ' true', 'true ', '1', 'yes']) {
      assert.equal(
        resolvePayoutGateway({ active_payment_gateway: 'monnify', gateway_monnify_enabled: enabled }),
        'paystack',
        String(enabled),
      );
    }
  });

  test('uses novac only when it is active and gateway_novac_enabled is exactly "true"', () => {
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'novac', gateway_novac_enabled: 'true' }), 'novac');
    for (const enabled of [undefined, null, '', 'false', 'TRUE', ' true', '1']) {
      assert.equal(
        resolvePayoutGateway({ active_payment_gateway: 'novac', gateway_novac_enabled: enabled }),
        'paystack',
        String(enabled),
      );
    }
  });

  test('lower-cases the active gateway name but does not trim it', () => {
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'MONNIFY', gateway_monnify_enabled: 'true' }), 'monnify');
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'Novac', gateway_novac_enabled: 'true' }), 'novac');
    assert.equal(resolvePayoutGateway({ active_payment_gateway: ' monnify', gateway_monnify_enabled: 'true' }), 'paystack');
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'novac ', gateway_novac_enabled: 'true' }), 'paystack');
  });

  test('ignores the enabled flag of a gateway that is not the active one', () => {
    assert.equal(
      resolvePayoutGateway({ active_payment_gateway: 'monnify', gateway_monnify_enabled: 'false', gateway_novac_enabled: 'true' }),
      'paystack',
    );
    assert.equal(
      resolvePayoutGateway({ active_payment_gateway: 'novac', gateway_novac_enabled: 'false', gateway_monnify_enabled: 'true' }),
      'paystack',
    );
    assert.equal(
      resolvePayoutGateway({ active_payment_gateway: 'paystack', gateway_monnify_enabled: 'true', gateway_novac_enabled: 'true' }),
      'paystack',
    );
  });

  test('falls back to paystack for a provider it does not know', () => {
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'flutterwave', gateway_flutterwave_enabled: 'true' }), 'paystack');
  });
});

describe('payoutGatewayConfig', () => {
  test('maps app_config rows to a key and value map', () => {
    assert.deepEqual(
      payoutGatewayConfig([
        { key: 'active_payment_gateway', value: 'monnify' },
        { key: 'gateway_monnify_enabled', value: 'true' },
        { key: 'gateway_novac_enabled', value: null },
      ]),
      { active_payment_gateway: 'monnify', gateway_monnify_enabled: 'true', gateway_novac_enabled: null },
    );
  });

  test('keeps only the gateway keys, and only string values', () => {
    assert.deepEqual(
      payoutGatewayConfig([
        { key: 'active_bill_provider', value: 'vtpass' },
        { key: 'active_payment_gateway', value: 7 },
        { key: 'gateway_paystack_enabled', value: true },
        { key: 42, value: 'monnify' },
        null,
        'active_payment_gateway',
      ]),
      { active_payment_gateway: null, gateway_paystack_enabled: null },
    );
  });

  test('returns an empty map for a missing or malformed result', () => {
    for (const rows of [null, undefined, {}, 'rows', 3]) {
      assert.deepEqual(payoutGatewayConfig(rows), {}, String(rows));
    }
  });
});

describe('readPayoutGateway', () => {
  test('reads the four gateway keys from app_config and resolves them', async () => {
    const { client, calls } = fakeClient({
      data: rowsOf({ active_payment_gateway: 'Monnify', gateway_monnify_enabled: 'true', gateway_paystack_enabled: 'true' }),
    });
    assert.equal(await readPayoutGateway(client), 'monnify');
    assert.deepEqual(calls, [{
      table: 'app_config',
      columns: 'key, value',
      column: 'key',
      values: ['active_payment_gateway', 'gateway_paystack_enabled', 'gateway_monnify_enabled', 'gateway_novac_enabled'],
    }]);
    assert.deepEqual([...PAYOUT_GATEWAY_KEYS], calls[0].values);
  });

  test('resolves to paystack when the lookup succeeds with no rows, as the edge function does', async () => {
    assert.equal(await readPayoutGateway(fakeClient({ data: [] }).client), 'paystack');
    assert.equal(await readPayoutGateway(fakeClient({ data: null }).client), 'paystack');
  });

  test('reports an unknown provider instead of guessing when the lookup fails', async (t) => {
    const logged = t.mock.method(console, 'error', () => {});
    assert.equal(await readPayoutGateway(fakeClient({ error: { message: 'permission denied' } }).client), null);
    assert.equal(await readPayoutGateway(fakeClient({ throws: new Error('socket hang up') }).client), null);
    assert.equal(logged.mock.callCount(), 2);
  });
});

describe('parity with resume-withdrawal (supabase/functions/_shared/gateway.ts)', { skip: !EDGE_PRESENT }, () => {
  const ACTIVE = [undefined, null, '', 'paystack', 'PAYSTACK', 'monnify', 'Monnify', 'MONNIFY', ' monnify', 'novac', 'NOVAC', 'novac ', 'flutterwave'];
  const FLAGS = [undefined, null, '', 'true', 'TRUE', 'false', ' true'];
  const PAYSTACK_FLAGS = [undefined, 'true', 'false'];

  test('resolves the same provider as getActiveGatewayName for every combination', async () => {
    const edge = await edgeResolver();
    let checked = 0;
    for (const active of ACTIVE) {
      for (const monnify of FLAGS) {
        for (const novac of FLAGS) {
          for (const paystack of PAYSTACK_FLAGS) {
            const config = {
              active_payment_gateway: active,
              gateway_monnify_enabled: monnify,
              gateway_novac_enabled: novac,
              gateway_paystack_enabled: paystack,
            };
            const rows = rowsOf(config);
            const label = JSON.stringify(config);
            const expected = await edge(fakeClient({ data: rows }).client);
            assert.equal(resolvePayoutGateway(config), expected, label);
            assert.equal(resolvePayoutGateway(payoutGatewayConfig(rows)), expected, label);
            assert.equal(await readPayoutGateway(fakeClient({ data: rows }).client), expected, label);
            checked += 1;
          }
        }
      }
    }
    assert.equal(checked, ACTIVE.length * FLAGS.length * FLAGS.length * PAYSTACK_FLAGS.length);
  });

  test('queries the same app_config keys as getActiveGatewayName', async () => {
    const edge = await edgeResolver();
    const edgeLookup = fakeClient({ data: [] });
    const ownLookup = fakeClient({ data: [] });
    await edge(edgeLookup.client);
    await readPayoutGateway(ownLookup.client);
    assert.deepEqual(ownLookup.calls, edgeLookup.calls);
  });
});
