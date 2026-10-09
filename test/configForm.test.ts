import { afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import type * as ConfigFormModule from '../app/(dashboard)/_config/ConfigForm.tsx';

type Mod = typeof ConfigFormModule;
type Section = ConfigFormModule.ConfigSection;
type Field = ConfigFormModule.ConfigField;

const nodeRequire = createRequire(import.meta.url);
const packageUrl = (specifier: string) => pathToFileURL(nodeRequire.resolve(specifier)).href;

const REAL: Record<string, string> = {
  react: packageUrl('react'),
  'react/jsx-runtime': packageUrl('react/jsx-runtime'),
};

function stubUrl(names: string[]): string {
  const body = names.map((name) => `export const ${name} = () => null;`).join('\n');
  return `data:text/javascript;base64,${Buffer.from(body).toString('base64')}`;
}

async function loadConfigForm(): Promise<Mod> {
  const source = readFileSync(new URL('../app/(dashboard)/_config/ConfigForm.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: 'ConfigForm.tsx',
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const code = outputText
    .replace(
      /import (\w+) from ['"]\.\/ConfigForm\.module\.css['"];/,
      'const $1 = new Proxy({}, { get: (_target, key) => String(key) });',
    )
    .replace(/import \{([^}]*)\} from ['"]([^'"]+)['"];/g, (_statement, clause: string, specifier: string) => {
      if (REAL[specifier]) return `import {${clause}} from '${REAL[specifier]}';`;
      const names = clause.split(',').map((part) => part.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      return `import {${clause}} from '${stubUrl(names)}';`;
    });
  const unresolved = code.match(/from ['"](?!file:|data:)([^'"]+)['"]/);
  if (unresolved) throw new Error(`ConfigForm imports ${unresolved[1]}, which this loader does not resolve`);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

let cf: Mod;

before(async () => {
  cf = await loadConfigForm();
});

const numberField = (overrides: Partial<Field> = {}): Field => ({
  key: 'amount', label: 'Amount (₦)', input: 'number', ...overrides,
});

const SECTIONS: Section[] = [
  {
    title: 'Withdrawals',
    fields: [
      { key: 'min_withdrawal_amount', label: 'Minimum Withdrawal (₦)', input: 'number', min: 1, max: 1_000_000_000, step: 1 },
      { key: 'max_withdrawal_amount', label: 'Maximum Withdrawal (₦)', input: 'number', min: 1, max: 1_000_000_000, step: 1 },
    ],
  },
  {
    title: 'Rapid Withdrawal Pattern',
    fields: [
      { key: 'anomaly_rapid_window_mins', label: 'Window (minutes)', input: 'number', min: 0, step: 1 },
      { key: 'anomaly_rapid_ratio', label: 'Ratio (0–1)', input: 'number', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Failed Transaction Burst',
    fields: [
      { key: 'anomaly_failures_window_mins', label: 'Window (minutes)', input: 'number', min: 0, step: 1 },
    ],
  },
  {
    title: 'Other',
    fields: [
      { key: 'alert_timezone', label: 'Alert Email Timezone', input: 'text', required: true },
      { key: 'paystack_webhook_ips', label: 'Paystack Webhook IPs (CSV)', input: 'textarea' },
      { key: 'feature_enabled', label: 'Feature', input: 'toggle' },
      {
        key: 'mode',
        label: 'Mode',
        input: 'select',
        options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
      },
    ],
  },
];

const LIVE = {
  min_withdrawal_amount: '1000',
  max_withdrawal_amount: '500000',
  anomaly_rapid_window_mins: '60',
  anomaly_rapid_ratio: '0.80',
  anomaly_failures_window_mins: '5',
  alert_timezone: 'Africa/Lagos',
  paystack_webhook_ips: '52.31.139.75,52.49.173.169',
  feature_enabled: 'false',
  mode: 'a',
};

const SERVER_IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;

describe('normalizeValue', () => {
  test('trims number, text and textarea values', () => {
    assert.equal(cf.normalizeValue(numberField(), ' 5000 '), '5000');
    assert.equal(cf.normalizeValue({ key: 'tz', label: 'TZ', input: 'text' }, ' Africa/Lagos\n'), 'Africa/Lagos');
    assert.equal(cf.normalizeValue({ key: 'ips', label: 'IPs', input: 'textarea' }, '\n1.1.1.1,\n2.2.2.2\n'), '1.1.1.1,\n2.2.2.2');
  });

  test('treats a missing value as empty', () => {
    assert.equal(cf.normalizeValue(numberField(), undefined), '');
    assert.equal(cf.normalizeValue(numberField(), null), '');
  });

  test('canonicalises toggles to true or false', () => {
    const toggle: Field = { key: 'flag', label: 'Flag', input: 'toggle' };
    for (const on of ['true', '1', 'yes', 'on', ' TRUE ']) assert.equal(cf.normalizeValue(toggle, on), 'true');
    for (const off of ['false', '0', 'no', '', undefined]) assert.equal(cf.normalizeValue(toggle, off), 'false');
  });

  test('keeps select values verbatim', () => {
    const select: Field = { key: 'mode', label: 'Mode', input: 'select', options: [] };
    assert.equal(cf.normalizeValue(select, ' a '), ' a ');
  });
});

describe('diffConfig', () => {
  test('lists only changed fields, in declaration order, as live value and new value', () => {
    const draft = { ...LIVE, anomaly_rapid_ratio: '0.75', min_withdrawal_amount: '2000' };
    const changes = cf.diffConfig(SECTIONS, LIVE, draft);
    assert.deepEqual(
      changes.map(({ key, from, to }) => ({ key, from, to })),
      [
        { key: 'min_withdrawal_amount', from: '1000', to: '2000' },
        { key: 'anomaly_rapid_ratio', from: '0.80', to: '0.75' },
      ],
    );
  });

  test('ignores edits that only add surrounding whitespace', () => {
    const draft = { ...LIVE, min_withdrawal_amount: ' 1000 ', alert_timezone: 'Africa/Lagos ' };
    assert.deepEqual(cf.diffConfig(SECTIONS, LIVE, draft), []);
  });

  test('treats a key the server did not return as empty', () => {
    const live = { ...LIVE } as Record<string, string>;
    delete live.alert_timezone;
    const changes = cf.diffConfig(SECTIONS, live, { ...live, alert_timezone: 'UTC' });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].from, '');
    assert.equal(changes[0].to, 'UTC');
  });

  test('ignores server keys the form does not declare', () => {
    const changes = cf.diffConfig(SECTIONS, { ...LIVE, other_key: '1' }, { ...LIVE, other_key: '2' });
    assert.deepEqual(changes, []);
  });

  test('a toggle stored as 1 and re-saved as true is not a change', () => {
    assert.deepEqual(cf.diffConfig(SECTIONS, { ...LIVE, feature_enabled: '1' }, { ...LIVE, feature_enabled: 'true' }), []);
  });

  test('labels duplicate field labels with their section title', () => {
    const draft = { ...LIVE, anomaly_rapid_window_mins: '30', anomaly_failures_window_mins: '10' };
    assert.deepEqual(
      cf.diffConfig(SECTIONS, LIVE, draft).map((change) => change.label),
      ['Rapid Withdrawal Pattern · Window (minutes)', 'Failed Transaction Burst · Window (minutes)'],
    );
  });

  test('unique labels stay unprefixed', () => {
    const changes = cf.diffConfig(SECTIONS, LIVE, { ...LIVE, max_withdrawal_amount: '600000' });
    assert.equal(changes[0].label, 'Maximum Withdrawal (₦)');
  });
});

describe('changeLabels', () => {
  test('falls back to the key when a label repeats inside one section', () => {
    const labels = cf.changeLabels([
      {
        title: 'Same',
        fields: [
          { key: 'a', label: 'Window', input: 'number' },
          { key: 'b', label: 'Window', input: 'number' },
        ],
      },
    ]);
    assert.deepEqual(labels, { a: 'Same · Window (a)', b: 'Same · Window (b)' });
  });
});

describe('buildPayload with the reviewed live values', () => {
  test('sends the raw live value of each changed key as expected, not the normalised one', () => {
    const live = { ...LIVE, min_withdrawal_amount: ' 1000 ' };
    const draft = { ...live, min_withdrawal_amount: '2000', mode: 'b' };
    const changes = cf.diffConfig(SECTIONS, live, draft);
    assert.deepEqual(changes.map((change) => change.key).sort(), ['min_withdrawal_amount', 'mode']);
    assert.deepEqual(cf.buildPayload(changes, live).expected, { min_withdrawal_amount: ' 1000 ', mode: 'a' });
  });

  test('without live values the payload keeps its original shape', () => {
    const draft = { ...LIVE, [Object.keys(LIVE)[0]]: 'changed-value' };
    const payload = cf.buildPayload(cf.diffConfig(SECTIONS, LIVE, draft));
    assert.equal('expected' in payload, false);
  });
});

describe('buildPayload', () => {
  test('sends exactly { changes } with only the changed keys as strings', () => {
    const draft = { ...LIVE, min_withdrawal_amount: ' 2500 ', paystack_webhook_ips: '', feature_enabled: 'true' };
    const payload = cf.buildPayload(cf.diffConfig(SECTIONS, LIVE, draft));
    assert.deepEqual(payload, {
      changes: { min_withdrawal_amount: '2500', paystack_webhook_ips: '', feature_enabled: 'true' },
    });
    assert.deepEqual(Object.keys(payload), ['changes']);
    for (const value of Object.values(payload.changes)) assert.equal(typeof value, 'string');
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
  });

  test('an untouched form produces an empty change set', () => {
    assert.deepEqual(cf.buildPayload(cf.diffConfig(SECTIONS, LIVE, LIVE)), { changes: {} });
  });
});

describe('applyChanges', () => {
  test('overlays the applied values on the live values', () => {
    const changes = cf.diffConfig(SECTIONS, LIVE, { ...LIVE, mode: 'b' });
    assert.deepEqual(cf.applyChanges(LIVE, changes), { ...LIVE, mode: 'b' });
  });
});

describe('validateNumber', () => {
  test('accepts plain decimal numbers', () => {
    for (const value of ['0', '5000', '0.80', '.5', ' 42 ']) assert.equal(cf.validateNumber(value), null, value);
  });

  test('rejects anything that is not a plain decimal number', () => {
    for (const value of ['', 'abc', '1e3', '0x10', '1,000', 'Infinity', '5.', '--1', '1 000']) {
      assert.equal(cf.validateNumber(value), 'Enter a valid number.', value);
    }
  });

  test('enforces min and max inclusively', () => {
    const bounds = { min: 1, max: 720 };
    assert.equal(cf.validateNumber('1', bounds), null);
    assert.equal(cf.validateNumber('720', bounds), null);
    assert.equal(cf.validateNumber('0', bounds), 'Must be at least 1.');
    assert.equal(cf.validateNumber('721', bounds), 'Must be at most 720.');
    assert.equal(cf.validateNumber('-1', { min: 0 }), 'Must be at least 0.');
    assert.equal(cf.validateNumber('1000000001', { max: 1_000_000_000 }), 'Must be at most 1,000,000,000.');
  });

  test('enforces whole numbers for step 1, including beyond float precision', () => {
    assert.equal(cf.validateNumber('2.5', { step: 1 }), 'Enter a whole number.');
    assert.equal(cf.validateNumber('2.0', { step: 1 }), null);
    assert.equal(cf.validateNumber('10000000000.5', { step: 1 }), 'Enter a whole number.');
    assert.equal(cf.validateNumber('10000000000', { step: 1 }), null);
  });

  test('enforces decimal places for fractional steps without float rounding errors', () => {
    for (const value of ['0.07', '0.29', '0.57', '0.80', '1']) assert.equal(cf.validateNumber(value, { step: 0.01 }), null, value);
    assert.equal(cf.validateNumber('0.805', { step: 0.01 }), 'Use at most 2 decimal places.');
    assert.equal(cf.validateNumber('0.75', { step: 0.25 }), null);
    assert.equal(cf.validateNumber('0.8', { step: 0.25 }), 'Enter a multiple of 0.25.');
  });

  test('every number it accepts with min 0 also passes the API check', () => {
    for (const value of ['0', '5000', '0.80', '.5', '720']) {
      assert.equal(cf.validateNumber(value, { min: 0 }), null);
      const parsed = Number(value);
      assert.ok(Number.isFinite(parsed) && parsed >= 0, value);
    }
  });
});

describe('stepMessage', () => {
  test('explains the step in plain words', () => {
    assert.equal(cf.stepMessage(1), 'Enter a whole number.');
    assert.equal(cf.stepMessage(0.1), 'Use at most 1 decimal place.');
    assert.equal(cf.stepMessage(0.01), 'Use at most 2 decimal places.');
    assert.equal(cf.stepMessage(5), 'Enter a multiple of 5.');
  });
});

describe('validateField', () => {
  test('number fields are required by default', () => {
    assert.equal(cf.validateField(numberField(), ''), 'Enter a value.');
    assert.equal(cf.validateField(numberField(), '   '), 'Enter a value.');
  });

  test('text fields are optional unless marked required', () => {
    assert.equal(cf.validateField({ key: 'note', label: 'Note', input: 'text' }, ''), null);
    assert.equal(cf.validateField({ key: 'tz', label: 'TZ', input: 'text', required: true }, ''), 'Enter a value.');
  });

  test('select values must be one of the options', () => {
    const select = SECTIONS[3].fields[3];
    assert.equal(cf.validateField(select, 'a'), null);
    assert.equal(cf.validateField(select, 'z'), 'Choose one of the listed options.');
  });

  test('custom validators get the normalised value and every normalised value', () => {
    const seen: Array<[string, Record<string, string>]> = [];
    const field: Field = {
      key: 'note',
      label: 'Note',
      input: 'text',
      validate: (value, values) => {
        seen.push([value, values]);
        return value === 'bad' ? 'No.' : null;
      },
    };
    assert.equal(cf.validateField(field, ' bad ', { other: '1' }), 'No.');
    assert.deepEqual(seen[0], ['bad', { other: '1' }]);
  });

  test('bounds are checked before the custom validator', () => {
    let called = false;
    const field = numberField({ min: 1, validate: () => { called = true; return null; } });
    assert.equal(cf.validateField(field, '0'), 'Must be at least 1.');
    assert.equal(called, false);
  });
});

describe('validateConfig', () => {
  test('only flags fields that differ from the live value', () => {
    const live = { ...LIVE, anomaly_rapid_ratio: '7' };
    assert.deepEqual(cf.validateConfig(SECTIONS, live, live), {});
    const errors = cf.validateConfig(SECTIONS, live, { ...live, min_withdrawal_amount: '0' });
    assert.deepEqual(errors, { min_withdrawal_amount: 'Must be at least 1.' });
  });

  test('cross-field rules see the other draft values', () => {
    const sections: Section[] = [
      {
        title: 'Withdrawals',
        fields: [
          {
            key: 'min_withdrawal_amount', label: 'Minimum', input: 'number', min: 1, step: 1,
            validate: cf.notAbove('max_withdrawal_amount', 'the maximum withdrawal'),
          },
          {
            key: 'max_withdrawal_amount', label: 'Maximum', input: 'number', min: 1, step: 1,
            validate: cf.notBelow('min_withdrawal_amount', 'the minimum withdrawal'),
          },
        ],
      },
    ];
    assert.deepEqual(
      cf.validateConfig(sections, LIVE, { ...LIVE, min_withdrawal_amount: '600000' }),
      { min_withdrawal_amount: 'Must not be more than the maximum withdrawal (500,000).' },
    );
    assert.deepEqual(
      cf.validateConfig(sections, LIVE, { ...LIVE, max_withdrawal_amount: '500' }),
      { max_withdrawal_amount: 'Must not be less than the minimum withdrawal (1,000).' },
    );
    assert.deepEqual(cf.validateConfig(sections, LIVE, { ...LIVE, max_withdrawal_amount: '1000' }), {});
  });

  test('firstErrorKey follows declaration order', () => {
    const errors = { paystack_webhook_ips: 'x', min_withdrawal_amount: 'y' };
    assert.equal(cf.firstErrorKey(SECTIONS, errors), 'min_withdrawal_amount');
    assert.equal(cf.firstErrorKey(SECTIONS, {}), null);
  });
});

describe('validateNumberList', () => {
  const amounts = (value: string) => cf.validateNumberList(value, { min: 1, integer: true });

  test('accepts comma-separated whole amounts', () => {
    assert.equal(amounts('100,200,500,1000'), null);
    assert.equal(amounts('100, 200 ,500'), null);
  });

  test('rejects empty entries that the mobile app would render as a zero button', () => {
    assert.equal(amounts('100,,200'), 'Remove the empty entry. Look for a doubled or trailing comma.');
    assert.equal(amounts('100,200,'), 'Remove the empty entry. Look for a doubled or trailing comma.');
    assert.equal(amounts(','), 'Enter at least one value.');
  });

  test('rejects zero, decimals, words, spaces and duplicates', () => {
    assert.equal(amounts('100,0'), '“0” is below the minimum of 1.');
    assert.equal(amounts('150.5'), '“150.5” is not a whole number.');
    assert.equal(amounts('100,abc'), '“abc” is not a number.');
    assert.equal(amounts('100 200'), 'Separate each value with a comma.');
    assert.equal(amounts('100,200,100'), '“100” is listed more than once.');
    assert.equal(amounts('100,100.0'), '“100.0” is listed more than once.');
  });

  test('respects a maximum', () => {
    assert.equal(cf.validateNumberList('5,50', { max: 10 }), '“50” is above the maximum of 10.');
  });
});

describe('validateIpv4List', () => {
  test('accepts an empty list and comma-separated IPv4 addresses', () => {
    assert.equal(cf.validateIpv4List(''), null);
    assert.equal(cf.validateIpv4List('52.31.139.75,52.49.173.169,52.214.14.220'), null);
    assert.equal(cf.validateIpv4List('52.31.139.75, 52.49.173.169,\n52.214.14.220,'), null);
  });

  test('rejects malformed, out-of-range, zero-padded and IPv6 addresses', () => {
    for (const ip of ['256.1.1.1', '1.2.3', '01.2.3.4', '1.2.3.4.5', '::1', 'paystack']) {
      assert.equal(cf.validateIpv4List(`1.1.1.1,${ip}`), `“${ip}” is not a valid IPv4 address.`, ip);
    }
  });

  test('asks for commas when addresses are separated by spaces or new lines', () => {
    assert.equal(cf.validateIpv4List('1.1.1.1 2.2.2.2'), 'Separate each address with a comma.');
    assert.equal(cf.validateIpv4List('1.1.1.1\n2.2.2.2'), 'Separate each address with a comma.');
  });

  test('rejects duplicates', () => {
    assert.equal(cf.validateIpv4List('1.1.1.1,1.1.1.1'), '“1.1.1.1” is listed more than once.');
  });

  test('every address it accepts is also accepted by the API', () => {
    const list = '0.0.0.0,9.9.9.9,10.0.0.1,172.16.254.1,192.168.100.200,255.255.255.255';
    assert.equal(cf.validateIpv4List(list), null);
    for (const ip of list.split(',')) assert.ok(SERVER_IPV4.test(ip), ip);
  });
});

describe('validateTimeZone', () => {
  test('accepts IANA zones', () => {
    assert.equal(cf.validateTimeZone('Africa/Lagos'), null);
    assert.equal(cf.validateTimeZone('UTC'), null);
    assert.equal(cf.validateTimeZone('Europe/London'), null);
  });

  test('rejects unknown zones and overlong values', () => {
    assert.equal(cf.validateTimeZone('Mars/Olympus'), '“Mars/Olympus” is not a recognised IANA time zone. Use a name like Africa/Lagos.');
    assert.equal(cf.validateTimeZone('Lagos'), '“Lagos” is not a recognised IANA time zone. Use a name like Africa/Lagos.');
    assert.equal(cf.validateTimeZone('A'.repeat(65)), 'Use 64 characters or fewer.');
  });
});

describe('rebaseDraft', () => {
  test('untouched fields take the latest live value', () => {
    const latest = { ...LIVE, anomaly_rapid_ratio: '0.90' };
    const result = cf.rebaseDraft(SECTIONS, LIVE, LIVE, latest);
    assert.equal(result.draft.anomaly_rapid_ratio, '0.90');
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(cf.diffConfig(SECTIONS, latest, result.draft), []);
  });

  test('local edits survive and are reported when someone else changed the same field', () => {
    const draft = { ...LIVE, min_withdrawal_amount: '2000', mode: 'b' };
    const latest = { ...LIVE, min_withdrawal_amount: '1500' };
    const result = cf.rebaseDraft(SECTIONS, LIVE, draft, latest);
    assert.equal(result.draft.min_withdrawal_amount, '2000');
    assert.equal(result.draft.mode, 'b');
    assert.deepEqual(
      result.conflicts.map(({ key, live, mine }) => ({ key, live, mine })),
      [{ key: 'min_withdrawal_amount', live: '1500', mine: '2000' }],
    );
  });

  test('converging on the same value is not a conflict and leaves nothing to apply', () => {
    const draft = { ...LIVE, mode: 'b' };
    const latest = { ...LIVE, mode: 'b' };
    const result = cf.rebaseDraft(SECTIONS, LIVE, draft, latest);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(cf.diffConfig(SECTIONS, latest, result.draft), []);
  });

  test('an applied save converges after an unconfirmed request', () => {
    const draft = { ...LIVE, min_withdrawal_amount: '2000' };
    const applied = cf.rebaseDraft(SECTIONS, LIVE, draft, { ...LIVE, min_withdrawal_amount: '2000' });
    assert.deepEqual(cf.diffConfig(SECTIONS, { ...LIVE, min_withdrawal_amount: '2000' }, applied.draft), []);
    const lost = cf.rebaseDraft(SECTIONS, LIVE, draft, LIVE);
    assert.equal(cf.diffConfig(SECTIONS, LIVE, lost.draft).length, 1);
  });
});

describe('displayValue', () => {
  test('shows empty values, toggles and select labels in words', () => {
    assert.equal(cf.displayValue(numberField(), ''), 'Empty');
    assert.equal(cf.displayValue(numberField(), '5000'), '5000');
    assert.equal(cf.displayValue({ key: 'f', label: 'F', input: 'toggle' }, 'true'), 'On');
    assert.equal(cf.displayValue({ key: 'f', label: 'F', input: 'toggle' }, ''), 'Off');
    assert.equal(
      cf.displayValue(
        { key: 'f', label: 'F', input: 'toggle', options: [{ value: 'true', label: 'Enabled' }] },
        '1',
      ),
      'Enabled',
    );
    assert.equal(cf.displayValue(SECTIONS[3].fields[3], 'b'), 'Beta');
    assert.equal(cf.displayValue(SECTIONS[3].fields[3], 'z'), 'z');
  });

  test('monospace applies to numbers by default and never to toggles or selects', () => {
    assert.equal(cf.isMono(numberField()), true);
    assert.equal(cf.isMono(numberField({ mono: false })), false);
    assert.equal(cf.isMono({ key: 't', label: 'T', input: 'text' }), false);
    assert.equal(cf.isMono({ key: 't', label: 'T', input: 'textarea', mono: true }), true);
    assert.equal(cf.isMono({ key: 't', label: 'T', input: 'toggle', mono: true }), false);
  });
});

describe('parseConfigResponse', () => {
  test('reads the config map', () => {
    assert.deepEqual(cf.parseConfigResponse({ config: { a: '1', b: '' } }), { a: '1', b: '' });
  });

  test('coerces stray scalar values and treats null as empty', () => {
    assert.deepEqual(cf.parseConfigResponse({ config: { a: 5, b: true, c: null, d: { x: 1 } } }), { a: '5', b: 'true', c: '' });
  });

  test('rejects anything that is not a config map instead of rendering an empty form', () => {
    for (const body of [null, 'x', {}, { config: null }, { config: [] }, { error: 'Unauthorized' }]) {
      assert.equal(cf.parseConfigResponse(body), null);
    }
  });
});

describe('fetchConfig', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function respond(body: unknown, status = 200, headers: Record<string, string> = {}) {
    const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    }) as typeof fetch;
    return calls;
  }

  test('returns the live values and bypasses the HTTP cache', async () => {
    const calls = respond({ config: { withdraw_fee: '0' } });
    assert.deepEqual(await cf.fetchConfig('/api/limits-fees'), { ok: true, values: { withdraw_fee: '0' } });
    assert.equal(calls[0].input, '/api/limits-fees');
    assert.equal(calls[0].init?.cache, 'no-store');
  });

  test('a network failure becomes a retryable failure, never an empty form', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const result = await cf.fetchConfig('/api/limits-fees');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.kind, 'network');
      assert.match(result.failure.message, /Could not reach the server/);
    }
  });

  test('a server error carries the detail and the request ID', async () => {
    respond({ error: 'relation "app_config" does not exist' }, 500, { 'x-request-id': 'req_abc123' });
    const result = await cf.fetchConfig('/api/anomaly-alerts');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.kind, 'server');
      assert.equal(result.failure.requestId, 'req_abc123');
      assert.equal(result.failure.detail, 'HTTP 500: relation "app_config" does not exist');
    }
  });

  test('401 and 403 are distinguished', async () => {
    respond({ error: 'Unauthorized' }, 401);
    const session = await cf.fetchConfig('/api/bill-settings');
    assert.equal(session.ok ? null : session.failure.kind, 'session');
    respond({ error: 'Forbidden' }, 403);
    const forbidden = await cf.fetchConfig('/api/bill-settings');
    assert.equal(forbidden.ok ? null : forbidden.failure.kind, 'forbidden');
  });

  test('a 200 without a config map is an invalid response', async () => {
    respond({ success: true });
    const result = await cf.fetchConfig('/api/security-limits');
    assert.equal(result.ok ? null : result.failure.kind, 'invalid');
  });

  test('a server that never answers times out into a retryable failure', async () => {
    globalThis.fetch = hangUntilAborted;
    const result = await cf.fetchConfig('/api/limits-fees', undefined, 20);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.kind, 'network');
      assert.match(result.failure.message, /took too long/);
    }
  });

  test('an aborted load settles instead of hanging', async () => {
    globalThis.fetch = hangUntilAborted;
    const controller = new AbortController();
    const pending = cf.fetchConfig('/api/limits-fees', controller.signal, 60_000);
    controller.abort();
    const result = await pending;
    assert.equal(result.ok, false);
    if (!result.ok) assert.doesNotMatch(result.failure.message, /took too long/);
  });
});

function hangUntilAborted(_input: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
}

describe('sendConfigChanges', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('PATCHes the exact JSON payload the API reads', async () => {
    const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;
    const result = await cf.sendConfigChanges('/api/limits-fees', { changes: { withdraw_fee: '50' } });
    assert.deepEqual(result, { status: 200, body: { success: true } });
    assert.equal(calls[0].input, '/api/limits-fees');
    assert.equal(calls[0].init?.method, 'PATCH');
    assert.deepEqual(calls[0].init?.headers, { 'Content-Type': 'application/json' });
    assert.equal(calls[0].init?.body, '{"changes":{"withdraw_fee":"50"}}');
  });

  test('reports an unknown outcome when the request never completes', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    assert.deepEqual(await cf.sendConfigChanges('/api/limits-fees', { changes: {} }), { status: null, body: null });
  });

  test('a save that never answers times out as an unknown outcome', async () => {
    globalThis.fetch = hangUntilAborted;
    assert.deepEqual(
      await cf.sendConfigChanges('/api/limits-fees', { changes: { withdraw_fee: '50' } }, 20),
      { status: null, body: null },
    );
  });
});

describe('save failure messages', () => {
  test('replaces raw config keys with field labels', () => {
    assert.equal(
      cf.describeSaveFailure(400, { error: 'Invalid value for min_withdrawal_amount' }, SECTIONS),
      'Invalid value for Minimum Withdrawal (₦).',
    );
    assert.equal(
      cf.humanizeServerMessage('Invalid number in anomaly_rapid_window_mins: x', SECTIONS),
      'Invalid number in Rapid Withdrawal Pattern · Window (minutes): x',
    );
    assert.equal(
      cf.humanizeServerMessage('anomaly_failures_window_mins and anomaly_rapid_window_mins', SECTIONS),
      'Failed Transaction Burst · Window (minutes) and Rapid Withdrawal Pattern · Window (minutes)',
    );
  });

  test('leaves messages without keys alone and keeps their punctuation', () => {
    assert.equal(cf.describeSaveFailure(400, { error: 'Invalid IP: 1.2.3' }, SECTIONS), 'Invalid IP: 1.2.3.');
    assert.equal(cf.describeSaveFailure(400, { error: 'Nothing to update.' }, SECTIONS), 'Nothing to update.');
  });

  test('explains session and permission failures and unreadable bodies', () => {
    assert.match(cf.describeSaveFailure(401, null, SECTIONS), /session has expired/);
    assert.equal(cf.describeSaveFailure(403, null, SECTIONS), 'You do not have permission to change these settings.');
    assert.equal(cf.describeSaveFailure(502, null, SECTIONS), 'The server returned an error (HTTP 502).');
  });

  test('request IDs prefer the body and fall back to the header', () => {
    assert.equal(cf.requestIdFrom({ request_id: 'req_body' }, 'req_header'), 'req_body');
    assert.equal(cf.requestIdFrom({ error: 'x' }, 'req_header'), 'req_header');
    assert.equal(cf.requestIdFrom(null, null), null);
  });
});

describe('guardedPath', () => {
  const here = 'https://admin.example.com/limits-fees';

  test('returns the in-app path for another page', () => {
    assert.equal(cf.guardedPath('https://admin.example.com/withdrawals?tab=held#top', here), '/withdrawals?tab=held#top');
    assert.equal(cf.guardedPath('/dashboard', here), '/dashboard');
    assert.equal(cf.guardedPath('https://admin.example.com/limits-fees?view=1', here), '/limits-fees?view=1');
  });

  test('ignores same-page anchors, other origins and script URLs', () => {
    assert.equal(cf.guardedPath('https://admin.example.com/limits-fees#withdrawals', here), null);
    assert.equal(cf.guardedPath('https://evil.example.net/dashboard', here), null);
    assert.equal(cf.guardedPath('javascript:alert(1)', here), null);
    assert.equal(cf.guardedPath('mailto:ops@example.com', here), null);
  });
});

describe('the four configuration pages', () => {
  const pages = ['limits-fees', 'bill-settings', 'anomaly-alerts', 'security-limits'];

  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  for (const page of pages) {
    test(`${page} declares exactly the keys its API accepts and posts to it`, () => {
      const route = read(`../app/api/${page}/route.ts`);
      const source = read(`../app/(dashboard)/${page}/page.tsx`);
      const keysBlock = route.match(/const KEYS = \[([\s\S]*?)\];/);
      assert.ok(keysBlock, `${page} route has no KEYS list`);
      const apiKeys = [...keysBlock[1].matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]).sort();
      const pageKeys = [...source.matchAll(/key: '([a-z0-9_]+)'/g)].map((match) => match[1]).sort();
      assert.deepEqual(pageKeys, apiKeys);
      assert.match(source, new RegExp(`endpoint="/api/${page}"`));
      assert.match(source, /<ConfigForm/);
      assert.doesNotMatch(source, /fetch\(|useState|useEffect/);
    });
  }
});
