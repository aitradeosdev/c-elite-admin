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
const EDGE_RESUME = new URL('../../supabase/functions/resume-withdrawal/index.ts', import.meta.url);
const EDGE_PROCESS = new URL('../../supabase/functions/process-withdrawal/index.ts', import.meta.url);
const EDGE_PRESENT = [EDGE_GATEWAY, EDGE_RESUME, EDGE_PROCESS].every((file) => existsSync(file));

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
  test('resolves no gateway when nothing is configured', () => {
    assert.equal(resolvePayoutGateway({}), null);
  });

  test('resolves no gateway when the active gateway is missing, null or empty, whatever the flags say', () => {
    for (const active of [undefined, null, '']) {
      const config: PayoutGatewayConfig = {
        active_payment_gateway: active,
        gateway_paystack_enabled: 'true',
        gateway_monnify_enabled: 'true',
        gateway_novac_enabled: 'true',
      };
      assert.equal(resolvePayoutGateway(config), null, String(active));
    }
  });

  test('uses paystack only when it is active and gateway_paystack_enabled is exactly "true"', () => {
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'paystack', gateway_paystack_enabled: 'true' }), 'paystack');
    for (const enabled of [undefined, null, '', 'false', 'TRUE', ' true', '1']) {
      assert.equal(
        resolvePayoutGateway({ active_payment_gateway: 'paystack', gateway_paystack_enabled: enabled }),
        null,
        String(enabled),
      );
    }
  });

  test('uses monnify only when it is active and gateway_monnify_enabled is exactly "true"', () => {
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'monnify', gateway_monnify_enabled: 'true' }), 'monnify');
    for (const enabled of [undefined, null, '', 'false', 'TRUE', 'True', ' true', 'true ', '1', 'yes']) {
      assert.equal(
        resolvePayoutGateway({ active_payment_gateway: 'monnify', gateway_monnify_enabled: enabled }),
        null,
        String(enabled),
      );
    }
  });

  test('uses novac only when it is active and gateway_novac_enabled is exactly "true"', () => {
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'novac', gateway_novac_enabled: 'true' }), 'novac');
    for (const enabled of [undefined, null, '', 'false', 'TRUE', ' true', '1']) {
      assert.equal(
        resolvePayoutGateway({ active_payment_gateway: 'novac', gateway_novac_enabled: enabled }),
        null,
        String(enabled),
      );
    }
  });

  test('lower-cases the active gateway name but does not trim it', () => {
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'MONNIFY', gateway_monnify_enabled: 'true' }), 'monnify');
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'Novac', gateway_novac_enabled: 'true' }), 'novac');
    assert.equal(resolvePayoutGateway({ active_payment_gateway: ' monnify', gateway_monnify_enabled: 'true' }), null);
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'novac ', gateway_novac_enabled: 'true' }), null);
  });

  test('never moves payouts to a gateway that is not the active one', () => {
    assert.equal(
      resolvePayoutGateway({
        active_payment_gateway: 'monnify',
        gateway_monnify_enabled: 'false',
        gateway_novac_enabled: 'true',
        gateway_paystack_enabled: 'true',
      }),
      null,
    );
    assert.equal(
      resolvePayoutGateway({ active_payment_gateway: 'novac', gateway_novac_enabled: 'false', gateway_monnify_enabled: 'true' }),
      null,
    );
    assert.equal(
      resolvePayoutGateway({ active_payment_gateway: 'paystack', gateway_monnify_enabled: 'true', gateway_novac_enabled: 'true' }),
      null,
    );
    assert.equal(
      resolvePayoutGateway({
        active_payment_gateway: 'paystack',
        gateway_paystack_enabled: 'true',
        gateway_monnify_enabled: 'true',
        gateway_novac_enabled: 'true',
      }),
      'paystack',
    );
  });

  test('resolves no gateway for a provider it does not know', () => {
    assert.equal(resolvePayoutGateway({ active_payment_gateway: 'flutterwave', gateway_flutterwave_enabled: 'true' }), null);
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
    assert.deepEqual(await readPayoutGateway(client), { kind: 'gateway', gateway: 'monnify' });
    assert.deepEqual(calls, [{
      table: 'app_config',
      columns: 'key, value',
      column: 'key',
      values: ['active_payment_gateway', 'gateway_paystack_enabled', 'gateway_monnify_enabled', 'gateway_novac_enabled'],
    }]);
    assert.deepEqual([...PAYOUT_GATEWAY_KEYS], calls[0].values);
  });

  test('reports no gateway when the lookup succeeds with no rows, as the edge function refuses', async () => {
    assert.deepEqual(await readPayoutGateway(fakeClient({ data: [] }).client), { kind: 'none' });
    assert.deepEqual(await readPayoutGateway(fakeClient({ data: null }).client), { kind: 'none' });
    assert.deepEqual(
      await readPayoutGateway(fakeClient({ data: rowsOf({ active_payment_gateway: 'monnify', gateway_monnify_enabled: 'false' }) }).client),
      { kind: 'none' },
    );
  });

  test('reports an unknown provider instead of guessing when the lookup fails, and tells it apart from no gateway', async (t) => {
    const logged = t.mock.method(console, 'error', () => {});
    assert.deepEqual(await readPayoutGateway(fakeClient({ error: { message: 'permission denied' } }).client), { kind: 'unknown' });
    assert.deepEqual(await readPayoutGateway(fakeClient({ throws: new Error('socket hang up') }).client), { kind: 'unknown' });
    assert.equal(logged.mock.callCount(), 2);
  });
});

describe('parity with resume-withdrawal (supabase/functions/_shared/gateway.ts)', { skip: !EDGE_PRESENT }, () => {
  const ACTIVE = [undefined, null, '', 'paystack', 'PAYSTACK', 'monnify', 'Monnify', 'MONNIFY', ' monnify', 'novac', 'NOVAC', 'novac ', 'flutterwave'];
  const FLAGS = [undefined, null, '', 'true', 'TRUE', 'false', ' true'];

  const REFUSAL = /^(?:The payout gateway settings could not be read \(.*\)|No payout gateway is set|The payout gateway is set to ".*", which is not supported|(?:Paystack|Monnify|Novac) is the payout gateway but is turned off)$/;

  async function edgeOutcome(edge: EdgeResolver, client: ConfigClient): Promise<PayoutGateway | null> {
    try {
      return await edge(client);
    } catch (error) {
      assert.ok(error instanceof Error, 'the edge resolver refuses with an Error');
      assert.match(error.message, REFUSAL, 'the edge resolver refuses with one of its own reasons, not a crash');
      return null;
    }
  }

  test('resolves the same provider as getActiveGatewayName for every combination, and refuses where it refuses', async () => {
    const edge = await edgeResolver();
    let checked = 0;
    let refused = 0;
    for (const active of ACTIVE) {
      for (const monnify of FLAGS) {
        for (const novac of FLAGS) {
          for (const paystack of FLAGS) {
            const config = {
              active_payment_gateway: active,
              gateway_monnify_enabled: monnify,
              gateway_novac_enabled: novac,
              gateway_paystack_enabled: paystack,
            };
            const rows = rowsOf(config);
            const label = JSON.stringify(config);
            const expected = await edgeOutcome(edge, fakeClient({ data: rows }).client);
            assert.equal(resolvePayoutGateway(config), expected, label);
            assert.equal(resolvePayoutGateway(payoutGatewayConfig(rows)), expected, label);
            assert.deepEqual(
              await readPayoutGateway(fakeClient({ data: rows }).client),
              expected === null ? { kind: 'none' } : { kind: 'gateway', gateway: expected },
              label,
            );
            if (expected === null) refused += 1;
            checked += 1;
          }
        }
      }
    }
    assert.equal(checked, ACTIVE.length * FLAGS.length ** 3);
    assert.ok(refused > 0 && refused < checked, `${refused} of ${checked} combinations refused`);
  });

  test('the edge refuses a failed lookup instead of choosing a gateway', async (t) => {
    t.mock.method(console, 'error', () => {});
    const edge = await edgeResolver();
    await assert.rejects(edge(fakeClient({ error: { message: 'permission denied' } }).client), /could not be read \(permission denied\)/);
    await assert.rejects(edge(fakeClient({ data: [] }).client), /^Error: No payout gateway is set$/);
    assert.deepEqual(await readPayoutGateway(fakeClient({ error: { message: 'permission denied' } }).client), { kind: 'unknown' });
  });

  test('the refusal check rejects a crash, so a broken resolver cannot pass for a refusal', async () => {
    const crashing: EdgeResolver = async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'toLowerCase')");
    };
    await assert.rejects(edgeOutcome(crashing, fakeClient({ data: [] }).client), assert.AssertionError);
    for (const reason of [
      'The payout gateway settings could not be read (permission denied)',
      'No payout gateway is set',
      'The payout gateway is set to "flutterwave", which is not supported',
      'Monnify is the payout gateway but is turned off',
    ]) {
      const refusing: EdgeResolver = async () => {
        throw new Error(reason);
      };
      assert.equal(await edgeOutcome(refusing, fakeClient({ data: [] }).client), null, reason);
    }
  });

  test('queries the same app_config keys as getActiveGatewayName', async () => {
    const edge = await edgeResolver();
    const edgeLookup = fakeClient({ data: [] });
    const ownLookup = fakeClient({ data: [] });
    await edgeOutcome(edge, edgeLookup.client);
    await readPayoutGateway(ownLookup.client);
    assert.deepEqual(ownLookup.calls, edgeLookup.calls);
  });

  test('resume-withdrawal and process-withdrawal look the gateway up before they claim or debit, and refuse with 503', () => {
    const resume = readFileSync(EDGE_RESUME, 'utf8');
    const lookup = resume.indexOf('await getActiveGateway(admin)');
    const claim = resume.indexOf(".update({ status: 'processing' })");
    assert.ok(lookup > 0 && claim > lookup, 'resume-withdrawal resolves the gateway before its claim');
    assert.match(resume.slice(lookup, claim), /\b503\b/);
    assert.equal(resume.indexOf('await getActiveGateway(admin)', lookup + 1), -1, 'resume-withdrawal resolves the gateway once');
    const process = readFileSync(EDGE_PROCESS, 'utf8');
    const resolved = process.indexOf('await getActiveGateway(admin)');
    const debit = process.indexOf("rpc('process_withdrawal_debit'");
    assert.ok(resolved > 0 && debit > resolved, 'process-withdrawal resolves the gateway before the debit');
    assert.match(process.slice(resolved, debit), /\b503\b/);
  });
});
