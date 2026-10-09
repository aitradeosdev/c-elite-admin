import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, Fragment, type ReactNode } from 'react';
import { loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type {
  BalanceSnapshot, SaveReceipt, StaticDraft,
} from '../app/(dashboard)/platform-balance/model.ts';
import type { StaticCardProps } from '../app/(dashboard)/platform-balance/BalanceParts.tsx';

type ModelModule = typeof import('../app/(dashboard)/platform-balance/model.ts');
type PartsModule = typeof import('../app/(dashboard)/platform-balance/BalanceParts.tsx');

let model: ModelModule;
let parts: PartsModule;

before(async () => {
  model = await loadAppModule<ModelModule>('(dashboard)/platform-balance/model.ts');
  parts = await loadAppModule<PartsModule>('(dashboard)/platform-balance/BalanceParts.tsx');
});

const OWNED_DIR = fileURLToPath(new URL('../app/(dashboard)/platform-balance/', import.meta.url));
const ROUTE_FILE = fileURLToPath(new URL('../app/api/platform-balance/route.ts', import.meta.url));

const MOBILE_CONFIG_KEYS = [
  'platform_balance_mode',
  'platform_balance_static',
  'platform_balance_live',
  'platform_balance_live_at',
  'platform_balance_live_error',
  'active_payment_gateway',
];

const STAMP = '2026-10-02T08:00:00.000Z';
const NOW = Date.parse('2026-10-02T09:00:00.000Z');

const STORED: Record<string, string | null> = {
  platform_balance_mode: 'static',
  platform_balance_static: '48350000',
  platform_balance_live: '12345.67',
  platform_balance_live_at: '2026-10-02T08:30:00.000Z',
  platform_balance_live_error: '',
  active_payment_gateway: 'paystack',
  gateway_paystack_enabled: 'true',
  gateway_monnify_enabled: 'false',
  gateway_novac_enabled: 'false',
};

function rows(values: Record<string, string | null>) {
  return Object.entries(values).map(([key, value]) => ({ key, value, updated_at: STAMP }));
}

function snapshotOf(patch: Record<string, string | null> = {}): BalanceSnapshot {
  const snapshot = model.toSnapshot({ success: true, ...model.presentBalance(rows({ ...STORED, ...patch })) });
  assert.ok(snapshot);
  return snapshot;
}

function failure(patch: Partial<ApiFailure>): ApiResult<SaveReceipt> {
  return {
    ok: false,
    error: {
      kind: 'http',
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Refused.',
      requestId: 'req_1',
      details: null,
      outcomeUnknown: false,
      ...patch,
    },
  };
}

function textOfNode(node: ReactNode): string {
  return textOf(render(createElement(Fragment, null, node)));
}

function staticCardProps(snapshot: BalanceSnapshot, patch: Partial<StaticCardProps> = {}): StaticCardProps {
  return {
    snapshot,
    canWrite: true,
    headingId: 'h-static',
    inputId: 'amount',
    value: snapshot.staticText ?? '',
    dirty: false,
    error: null,
    preview: null,
    busy: false,
    phase: null,
    changedElsewhere: false,
    onChange: () => {},
    onBlur: () => {},
    onSave: () => {},
    onDiscard: () => {},
    ...patch,
  };
}

describe('static amount parsing', () => {
  test('accepts plain and grouped naira and stores a canonical value', () => {
    const cases: Array<[unknown, string, number]> = [
      ['48350000', '48350000', 48350000],
      ['48,350,000.50', '48350000.5', 48350000.5],
      ['₦ 1,000', '1000', 1000],
      ['  007.50 ', '7.5', 7.5],
      ['0.00', '0', 0],
      [48350000.5, '48350000.5', 48350000.5],
      ['1000000000000', '1000000000000', 1e12],
    ];
    for (const [input, value, amount] of cases) {
      assert.deepEqual(model.checkStaticAmount(input), { ok: true, value, amount }, String(input));
    }
  });

  test('refuses anything users would not see as a real amount', () => {
    const messages = model.AMOUNT_MESSAGES;
    const cases: Array<[unknown, string]> = [
      ['', messages.required],
      ['   ', messages.required],
      [null, messages.required],
      [undefined, messages.required],
      ['-5', messages.negative],
      ['−5', messages.negative],
      ['abc', messages.invalid],
      ['1,5', messages.invalid],
      ['1e6', messages.invalid],
      ['.5', messages.invalid],
      ['12.', messages.invalid],
      [Number.NaN, messages.invalid],
      [{}, messages.invalid],
      ['12.345', messages.decimals],
      ['1000000000000.01', messages.tooLarge],
    ];
    for (const [input, message] of cases) {
      assert.deepEqual(model.checkStaticAmount(input), { ok: false, message }, String(input));
    }
  });
});

describe('balance source', () => {
  test('accepts only static or live, in any case', () => {
    assert.deepEqual(model.checkMode('live'), { ok: true, value: 'live' });
    assert.deepEqual(model.checkMode(' STATIC '), { ok: true, value: 'static' });
    for (const raw of ['', 'auto', null, undefined, 1, true]) {
      assert.deepEqual(model.checkMode(raw), { ok: false, message: model.MODE_MESSAGE });
    }
  });

  test('only an exact live value switches users to the live balance, as the feed function does', () => {
    assert.equal(model.effectiveMode('live'), 'live');
    for (const raw of ['static', 'LIVE', ' live', '', null, undefined]) assert.equal(model.effectiveMode(raw), 'static');
  });
});

describe('what users see', () => {
  test('mirrors build_marketplace_feed_cache: anything that is not a plain number counts as zero', () => {
    assert.equal(model.shownAmount(' 12.5 '), 12.5);
    assert.equal(model.shownAmount('0012'), 12);
    assert.equal(model.shownAmount('1e6'), 0);
    assert.equal(model.shownAmount('abc'), 0);
    assert.equal(model.shownAmount('-5'), 0);
    assert.equal(model.shownAmount(null), 0);
    assert.equal(model.isShownAmount('48350000'), true);
    assert.equal(model.isShownAmount(''), false);
  });

  test('follows the source', () => {
    assert.equal(model.displayedBalance(STORED), 48350000);
    assert.equal(model.displayedBalance({ ...STORED, platform_balance_mode: 'live' }), 12345.67);
    assert.equal(model.displayedBalance({ ...STORED, platform_balance_mode: 'live', platform_balance_live: 'oops' }), 0);
  });
});

describe('GET payload (mobile contract)', () => {
  test('config keeps exactly the six keys the mobile app reads, with their stored values', () => {
    const payload = model.presentBalance([...rows(STORED), { key: 'unrelated', value: 'x' }, null, 'junk']);
    assert.deepEqual(Object.keys(payload.config).sort(), [...MOBILE_CONFIG_KEYS].sort());
    for (const key of MOBILE_CONFIG_KEYS) assert.equal(payload.config[key], STORED[key]);
    assert.equal(payload.config_updated_at.platform_balance_mode, STAMP);
    assert.equal(payload.live_gateway, 'paystack');
  });

  test('null values pass through unchanged and missing rows stay missing', () => {
    const payload = model.presentBalance(rows({ platform_balance_mode: 'live', platform_balance_live_error: null }));
    assert.deepEqual(payload.config, { platform_balance_mode: 'live', platform_balance_live_error: null });
  });

  test('the live provider is resolved the way the refresh job resolves it', () => {
    const disabled = model.presentBalance(rows({ ...STORED, active_payment_gateway: 'monnify' }));
    assert.equal(disabled.live_gateway, 'paystack');
    assert.equal(disabled.config.active_payment_gateway, 'monnify');
    const enabled = model.presentBalance(rows({ ...STORED, active_payment_gateway: 'monnify', gateway_monnify_enabled: 'true' }));
    assert.equal(enabled.live_gateway, 'monnify');
  });

  test('every key read is a config key or a gateway flag', () => {
    for (const key of MOBILE_CONFIG_KEYS) assert.ok(model.READ_KEYS.includes(key), key);
    assert.ok(model.READ_KEYS.includes('gateway_monnify_enabled'));
    assert.equal(new Set(model.READ_KEYS).size, model.READ_KEYS.length);
  });
});

describe('PATCH request', () => {
  test('accepts the exact bodies the mobile app sends', () => {
    for (const body of [
      { changes: { platform_balance_mode: 'live' } },
      { changes: { platform_balance_static: String(48350000.5) } },
    ]) {
      const parsed = model.readPatchRequest(body);
      assert.ok(parsed.ok);
      assert.equal(parsed.request.expected, null);
      const planned = model.planPatch(STORED, parsed.request);
      assert.ok(planned.ok);
      assert.equal(planned.plan.changed.length, 1);
    }
  });

  test('refuses malformed bodies', () => {
    assert.equal(model.readPatchRequest(null).ok, false);
    assert.equal(model.readPatchRequest('changes').ok, false);
    assert.deepEqual(model.readPatchRequest({}), { ok: false, message: 'No changes were sent.' });
    assert.deepEqual(model.readPatchRequest({ changes: [] }), { ok: false, message: 'No changes were sent.' });
    assert.equal(model.readPatchRequest({ changes: {}, expected: 'static' }).ok, false);
    assert.equal(model.readPatchRequest({ changes: {}, expected: { platform_balance_mode: {} } }).ok, false);
  });

  test('reads expected values for writable keys only', () => {
    const parsed = model.readPatchRequest({
      changes: { platform_balance_static: '1' },
      expected: { platform_balance_static: 48350000, platform_balance_mode: null, platform_balance_live: 'x' },
    });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.request.expected, { platform_balance_mode: '', platform_balance_static: '48350000' });
  });

  test('nothing writable is a validation error, and other keys are ignored', () => {
    const planned = model.planPatch(STORED, { changes: { platform_balance_live: '9' }, expected: null });
    assert.deepEqual(planned, { ok: false, code: 'VALIDATION_ERROR', message: 'Nothing to update.' });
    const mixed = model.planPatch(STORED, { changes: { platform_balance_live: '9', platform_balance_mode: 'live' }, expected: null });
    assert.ok(mixed.ok);
    assert.deepEqual(mixed.plan.updates, { platform_balance_mode: 'live' });
  });

  test('a bad value refuses the whole request', () => {
    for (const changes of [
      { platform_balance_mode: 'auto' },
      { platform_balance_static: '-1' },
      { platform_balance_mode: 'live', platform_balance_static: '12.345' },
    ]) {
      const planned = model.planPatch(STORED, { changes, expected: null });
      assert.equal(planned.ok, false);
      if (!planned.ok) assert.equal(planned.code, 'VALIDATION_ERROR');
    }
  });

  test('stores the canonical amount and records before and after, including what users saw', () => {
    const planned = model.planPatch(STORED, { changes: { platform_balance_static: '50,000,000.00' }, expected: null });
    assert.ok(planned.ok);
    assert.deepEqual(planned.plan.updates, { platform_balance_static: '50000000' });
    assert.deepEqual(planned.plan.before, { platform_balance_static: '48350000', displayed_balance: 48350000 });
    assert.deepEqual(planned.plan.after, { platform_balance_static: '50000000', displayed_balance: 50000000 });
    assert.equal(planned.plan.entityId, 'platform_balance_static');
  });

  test('a source switch records the figure users saw before and after', () => {
    const planned = model.planPatch(STORED, { changes: { platform_balance_mode: 'live' }, expected: null });
    assert.ok(planned.ok);
    assert.deepEqual(planned.plan.before, { platform_balance_mode: 'static', displayed_balance: 48350000 });
    assert.deepEqual(planned.plan.after, { platform_balance_mode: 'live', displayed_balance: 12345.67 });
  });

  test('an identical value is a no-op and two changes are a batch', () => {
    const same = model.planPatch(STORED, { changes: { platform_balance_mode: 'static' }, expected: null });
    assert.ok(same.ok);
    assert.deepEqual(same.plan.changed, []);
    assert.deepEqual(same.plan.unchanged, ['platform_balance_mode']);
    assert.deepEqual(same.plan.before, {});
    const both = model.planPatch(STORED, {
      changes: { platform_balance_mode: 'live', platform_balance_static: '1' },
      expected: null,
    });
    assert.ok(both.ok);
    assert.equal(both.plan.entityId, 'batch');
  });

  test('a stale expected value is a conflict and nothing is planned', () => {
    const current = { ...STORED, platform_balance_static: '49000000' };
    const planned = model.planPatch(current, {
      changes: { platform_balance_static: '50000000' },
      expected: { platform_balance_static: '48350000' },
    });
    assert.equal(planned.ok, false);
    if (planned.ok || planned.code !== 'STATE_CONFLICT') throw new Error('expected a conflict');
    assert.deepEqual(planned.conflicts, [{ key: 'platform_balance_static', label: 'static amount', current: '49000000' }]);
    assert.match(planned.message, /Another admin changed the static amount/);
  });

  test('expected values compare by what users see, and mobile requests skip the check', () => {
    const current = { ...STORED, platform_balance_static: '48350000.00' };
    const formatted = model.planPatch(current, {
      changes: { platform_balance_static: '50000000' },
      expected: { platform_balance_static: '48350000' },
    });
    assert.ok(formatted.ok);
    const mobile = model.planPatch({ ...STORED, platform_balance_static: '49000000' }, {
      changes: { platform_balance_static: '50000000' },
      expected: null,
    });
    assert.ok(mobile.ok);
  });

  test('a single change is written only if the stored value is still the one read', () => {
    const planned = model.planPatch(STORED, { changes: { platform_balance_static: '50,000,000' }, expected: null });
    assert.ok(planned.ok);
    assert.deepEqual(model.guardedWrite(STORED, planned.plan), {
      key: 'platform_balance_static', value: '50000000', exists: true, seen: '48350000',
    });
    const blank = { ...STORED, platform_balance_static: null };
    const fromNull = model.planPatch(blank, { changes: { platform_balance_static: '1' }, expected: null });
    assert.ok(fromNull.ok);
    assert.deepEqual(model.guardedWrite(blank, fromNull.plan), {
      key: 'platform_balance_static', value: '1', exists: true, seen: null,
    });
    const missing = Object.fromEntries(Object.entries(STORED).filter(([key]) => key !== 'platform_balance_mode'));
    const created = model.planPatch(missing, { changes: { platform_balance_mode: 'live' }, expected: null });
    assert.ok(created.ok);
    assert.deepEqual(model.guardedWrite(missing, created.plan), {
      key: 'platform_balance_mode', value: 'live', exists: false, seen: null,
    });
    const both = model.planPatch(STORED, {
      changes: { platform_balance_mode: 'live', platform_balance_static: '1' },
      expected: null,
    });
    assert.ok(both.ok);
    assert.equal(model.guardedWrite(STORED, both.plan), null);
  });
});

describe('snapshot', () => {
  test('derives what users see from the stored values', () => {
    const snapshot = snapshotOf();
    assert.equal(snapshot.mode, 'static');
    assert.equal(snapshot.staticAmount, 48350000);
    assert.equal(snapshot.liveAmount, 12345.67);
    assert.equal(snapshot.shownAmount, 48350000);
    assert.equal(snapshot.liveAt, '2026-10-02T08:30:00.000Z');
    assert.equal(snapshot.liveError, null);
    assert.equal(snapshot.gateway, 'paystack');
    assert.equal(snapshotOf({ platform_balance_mode: 'live' }).shownAmount, 12345.67);
  });

  test('refuses a body without config and falls back to the configured provider', () => {
    assert.equal(model.toSnapshot({ success: true }), null);
    assert.equal(model.toSnapshot({ config: [] }), null);
    const fallback = model.toSnapshot({ config: { active_payment_gateway: 'novac', platform_balance_live_at: 'not a date' } });
    assert.ok(fallback);
    assert.equal(fallback.gateway, 'paystack');
    assert.equal(fallback.liveAt, null);
    const reported = model.toSnapshot({ config: {}, live_gateway: 'novac' });
    assert.equal(reported?.gateway, 'novac');
  });

  test('applying a saved change recomputes what users see', () => {
    const next = model.applySaved(snapshotOf(), { platform_balance_mode: 'live' }, STAMP);
    assert.equal(next.mode, 'live');
    assert.equal(next.shownAmount, 12345.67);
    assert.equal(next.updatedAt.platform_balance_mode, STAMP);
    const untouched = snapshotOf();
    assert.equal(model.applySaved(untouched, { platform_balance_live: '1' }, STAMP), untouched);
  });

  test('the save payload carries the value last seen', () => {
    assert.deepEqual(model.changePayload(snapshotOf(), 'platform_balance_mode', 'live'), {
      changes: { platform_balance_mode: 'live' },
      expected: { platform_balance_mode: 'static' },
    });
    const missing = model.toSnapshot({ config: {} });
    assert.ok(missing);
    assert.deepEqual(model.changePayload(missing, 'platform_balance_static', '5').expected, { platform_balance_static: '' });
  });
});

describe('live balance health', () => {
  test('flags a failed, missing, unreadable or stale live balance', () => {
    assert.equal(model.liveIssue(snapshotOf(), NOW), null);
    assert.equal(model.liveIssue(snapshotOf({ platform_balance_live_error: 'Invalid balance from gateway' }), NOW)?.kind, 'failed');
    assert.equal(model.liveIssue(snapshotOf({ platform_balance_live_at: '' }), NOW)?.kind, 'never');
    assert.equal(model.liveIssue(snapshotOf({ platform_balance_live: 'abc' }), NOW)?.kind, 'invalid');
    assert.equal(model.liveIssue(snapshotOf({ platform_balance_live_at: '2026-10-02T07:50:00.000Z' }), NOW)?.kind, 'stale');
    assert.equal(model.liveIssue(snapshotOf({ platform_balance_live_at: '2026-10-02T08:00:00.000Z' }), NOW), null);
  });

  test('a failed refresh says which provider failed and what users still see', () => {
    const issue = model.liveIssue(snapshotOf({ platform_balance_live_error: 'timeout' }), NOW);
    assert.match(issue?.message ?? '', /Paystack/);
    assert.match(issue?.message ?? '', /“timeout”/);
    assert.match(issue?.message ?? '', /30m ago/);
  });

  test('ages read naturally', () => {
    assert.equal(model.ageText('2026-10-02T08:59:30.000Z', NOW), 'less than a minute ago');
    assert.equal(model.ageText('2026-10-02T06:00:00.000Z', NOW), '3h ago');
  });

  test('explains a missing or unreadable static amount', () => {
    assert.equal(model.staticProblem(snapshotOf()), null);
    assert.match(model.staticProblem(snapshotOf({ platform_balance_static: null })) ?? '', /No static amount has been set/);
    assert.match(model.staticProblem(snapshotOf({ platform_balance_static: 'abc' })) ?? '', /“abc”/);
  });
});

describe('saving', () => {
  test('classifies every way a save can end', () => {
    const receipt: SaveReceipt = { changed: ['platform_balance_mode'], applied: {}, auditRecorded: true, warning: null };
    assert.deepEqual(model.classifySave({ ok: true, data: receipt, status: 200, requestId: null }), { kind: 'done', receipt });
    assert.deepEqual(model.classifySave(failure({ status: 401, code: 'AUTH_REQUIRED' })), { kind: 'expired' });
    assert.equal(model.classifySave(failure({ status: 403, code: 'PERMISSION_DENIED' })).kind, 'denied');
    assert.equal(model.classifySave(failure({ status: 409, code: 'STATE_CONFLICT' })).kind, 'conflict');
    assert.equal(model.classifySave(failure({ status: 502, code: null, outcomeUnknown: true })).kind, 'unknown');
    assert.equal(model.classifySave(failure({ kind: 'network', status: null, code: null, outcomeUnknown: true })).kind, 'unknown');
    assert.equal(model.classifySave(failure({ kind: 'timeout', status: null, code: null, outcomeUnknown: false })).kind, 'unknown');
    assert.equal(model.classifySave(failure({ status: 400 })).kind, 'refused');
    assert.equal(model.classifySave(failure({ status: 500, code: 'INTERNAL_ERROR' })).kind, 'refused');
  });

  test('reads the save receipt, defaulting to a recorded audit', () => {
    assert.deepEqual(model.toSaveReceipt({ success: true }), { changed: null, applied: {}, auditRecorded: true, warning: null });
    assert.deepEqual(
      model.toSaveReceipt({
        changed: ['platform_balance_static', 4],
        applied: { platform_balance_static: '5', bad: 5 },
        audit_recorded: false,
        warning: ' Not recorded. ',
      }),
      { changed: ['platform_balance_static'], applied: { platform_balance_static: '5' }, auditRecorded: false, warning: 'Not recorded.' },
    );
  });

  test('a draft is dirty only when the amount differs', () => {
    const draft = (text: string, base: string | null): StaticDraft => ({ text, base });
    assert.equal(model.isDraftDirty(null), false);
    assert.equal(model.isDraftDirty(draft('48,350,000.00', '48350000')), false);
    assert.equal(model.isDraftDirty(draft('50000000', '48350000')), true);
    assert.equal(model.isDraftDirty(draft('', null)), false);
    assert.equal(model.isDraftDirty(draft('abc', '48350000')), true);
    assert.equal(model.isDraftDirty(draft('abc', 'abc')), false);
  });

  test('notices edits made elsewhere and amounts already stored', () => {
    const fresh = snapshotOf({ platform_balance_static: '49000000' });
    assert.equal(model.editedElsewhere({ text: '5', base: '48350000' }, fresh), true);
    assert.equal(model.editedElsewhere({ text: '5', base: '49000000.0' }, fresh), false);
    assert.equal(model.alreadyStored(fresh, '49000000', 49000000), true);
    assert.equal(model.alreadyStored(fresh, '5', 5), false);
  });

  test('flags a likely extra or missing zero', () => {
    assert.equal(model.magnitudeOf(48350000, 483500000), 'larger');
    assert.equal(model.magnitudeOf(48350000, 4835000), 'smaller');
    assert.equal(model.magnitudeOf(48350000, 50000000), null);
    assert.equal(model.magnitudeOf(0, 50000000), null);
    assert.equal(model.magnitudeOf(48350000, 0), null);
  });
});

describe('confirmation dialogs', () => {
  test('a switch to live shows the source and the figure before and after', () => {
    const options = parts.modeOptions(snapshotOf(), 'live', NOW);
    assert.equal(options.tone, 'financial');
    assert.deepEqual(options.details?.map((detail) => detail.label), ['Source', 'Users see', 'Live balance']);
    const [source, shown] = options.details ?? [];
    assert.equal(textOfNode(source.value), 'From Static → to Live');
    assert.equal(textOfNode(shown.value), 'From ₦48,350,000.00 → to ₦12,345.67');
    assert.equal(options.confirmLabel, 'Switch to Live');
    assert.equal(options.cancelLabel, 'Keep Static');
    assert.equal(options.pendingLabel, 'Switching to Live…');
    assert.match(options.consequences?.[0] ?? '', /follows Paystack/);
  });

  test('a switch to live warns when users would see a missing or failing balance', () => {
    const never = parts.modeOptions(snapshotOf({ platform_balance_live_at: '', platform_balance_live: '0' }), 'live', NOW);
    assert.match(never.consequences?.join(' ') ?? '', /users will see ₦0\.00 until the first refresh succeeds/);
    const failed = parts.modeOptions(snapshotOf({ platform_balance_live_error: 'timeout' }), 'live', NOW);
    assert.match(failed.consequences?.join(' ') ?? '', /The last refresh failed/);
  });

  test('a switch back to static names the amount users will see', () => {
    const options = parts.modeOptions(snapshotOf({ platform_balance_mode: 'live' }), 'static', NOW);
    assert.deepEqual(options.details?.map((detail) => detail.label), ['Source', 'Users see']);
    assert.equal(textOfNode(options.details?.[1].value), 'From ₦12,345.67 → to ₦48,350,000.00');
    assert.match(options.consequences?.[0] ?? '', /stays at ₦48,350,000\.00/);
  });

  test('a static change shows the amounts, the difference and its reach', () => {
    const options = parts.staticOptions(snapshotOf(), 50000000, false);
    assert.deepEqual(options.details?.map((detail) => detail.label), ['Static amount', 'Difference']);
    assert.equal(textOfNode(options.details?.[0].value), 'From ₦48,350,000.00 → to ₦50,000,000.00');
    assert.equal(textOfNode(options.details?.[1].value), '+₦1,650,000.00');
    assert.equal(options.confirmLabel, 'Set to ₦50,000,000.00');
    assert.match(String(options.message), /Every user sees the new amount/);
    assert.deepEqual(options.consequences, []);
  });

  test('a static change while live says users will not see it, and flags edits and zeros', () => {
    const live = parts.staticOptions(snapshotOf({ platform_balance_mode: 'live' }), 483500000, true);
    assert.deepEqual(live.details?.map((detail) => detail.label), ['Static amount', 'Difference', 'Users see']);
    const lines = live.consequences?.join(' ') ?? '';
    assert.match(lines, /The source is Live/);
    assert.match(lines, /Another admin changed the static amount/);
    assert.match(lines, /extra zero/);
    const zero = parts.staticOptions(snapshotOf(), 0, false);
    assert.match(zero.consequences?.join(' ') ?? '', /Users will see ₦0\.00/);
    const unset = parts.staticOptions(snapshotOf({ platform_balance_static: null }), 5, false);
    assert.deepEqual(unset.details?.map((detail) => detail.label), ['Static amount']);
    assert.equal(textOfNode(unset.details?.[0].value), 'From Not set → to ₦5.00');
  });

  test('leaving with an unsaved amount asks first', () => {
    const options = parts.leaveOptions();
    assert.equal(options.confirmLabel, 'Discard and leave');
    assert.equal(options.cancelLabel, 'Keep editing');
  });
});

describe('cards', () => {
  const shownProps = (snapshot: BalanceSnapshot, canWrite: boolean) => ({
    snapshot,
    now: NOW,
    canWrite,
    working: null,
    headingId: 'h-shown',
    groupId: 'source',
    onSwitch: () => {},
  });

  const radiosOf = (html: string) => tagsOf(html, 'input').filter((attrs) => attrs.type === 'radio');
  const checkedOf = (html: string) => radiosOf(html).filter((attrs) => 'checked' in attrs).map((attrs) => attrs.value);
  const disabledOf = (html: string) => radiosOf(html).filter((attrs) => 'disabled' in attrs).map((attrs) => attrs.value);

  test('the source switch reflects the saved source and says a confirmation follows', () => {
    const html = render(createElement(parts.ShownCard, shownProps(snapshotOf(), true)));
    assert.equal(radiosOf(html).length, 2);
    assert.deepEqual(checkedOf(html), ['static']);
    assert.deepEqual(disabledOf(html), []);
    assert.match(textOf(html), /₦48,350,000\.00/);
    assert.match(textOf(html), /asked to confirm before the source changes/);
    assert.equal(tagsOf(html, 'p').filter((attrs) => attrs.role === 'status').length, 1);
    assert.ok(!tagsOf(html, 'div').some((attrs) => attrs['aria-busy'] === 'true'));
  });

  test('the switch shows the pending source while saving and cannot be switched back mid-save', () => {
    const html = render(createElement(parts.ShownCard, {
      ...shownProps(snapshotOf(), true),
      working: { kind: 'mode', target: 'live', phase: 'saving' },
    }));
    assert.match(textOf(html), /Switching to Live…/);
    assert.ok(tagsOf(html, 'div').some((attrs) => attrs['aria-busy'] === 'true'));
    assert.deepEqual(checkedOf(html), ['live']);
    assert.deepEqual(disabledOf(html), ['static']);
  });

  test('the switch says when it is checking the current source first', () => {
    const html = render(createElement(parts.ShownCard, {
      ...shownProps(snapshotOf(), true),
      working: { kind: 'mode', target: 'live', phase: 'checking' },
    }));
    assert.match(textOf(html), /Checking the current source…/);
    assert.deepEqual(checkedOf(html), ['live']);
  });

  test('saving the static amount locks the source on its saved value', () => {
    const html = render(createElement(parts.ShownCard, {
      ...shownProps(snapshotOf(), true),
      working: { kind: 'static', phase: 'saving' },
    }));
    assert.deepEqual(checkedOf(html), ['static']);
    assert.deepEqual(disabledOf(html), ['live']);
    assert.ok(!tagsOf(html, 'div').some((attrs) => attrs['aria-busy'] === 'true'));
  });

  test('the checked option is never disabled, so focus can always return to it', () => {
    const phases = ['checking', 'confirming', 'saving'] as const;
    const states = [
      null,
      ...phases.map((phase) => ({ kind: 'static' as const, phase })),
      ...phases.flatMap((phase) => model.BALANCE_MODES.map((target) => ({ kind: 'mode' as const, target, phase }))),
    ];
    for (const saved of model.BALANCE_MODES) {
      for (const working of states) {
        const html = render(createElement(parts.ShownCard, {
          ...shownProps(snapshotOf({ platform_balance_mode: saved }), true),
          working,
        }));
        const checked = checkedOf(html);
        assert.equal(checked.length, 1, JSON.stringify({ saved, working }));
        assert.ok(!disabledOf(html).includes(checked[0]), JSON.stringify({ saved, working }));
      }
    }
  });

  test('the switch shows the pending source, and any work in flight locks it', () => {
    const working: Array<Parameters<typeof model.sourceChoice>[1]> = [
      null,
      { kind: 'mode', target: 'live', phase: 'checking' },
      { kind: 'mode', target: 'live', phase: 'confirming' },
      { kind: 'mode', target: 'static', phase: 'saving' },
      { kind: 'static', phase: 'confirming' },
    ];
    for (const saved of model.BALANCE_MODES) {
      for (const state of working) {
        const choice = model.sourceChoice(saved, state);
        assert.equal(choice.locked, state !== null);
        assert.equal(choice.pending, state?.kind === 'mode' ? state.target : null);
        assert.equal(choice.value, choice.pending ?? saved);
      }
    }
  });

  test('readers see the figure without the switch', () => {
    const html = render(createElement(parts.ShownCard, shownProps(snapshotOf(), false)));
    assert.equal(tagsOf(html, 'input').length, 0);
    assert.match(textOf(html), /Static amount · since/);
  });

  test('a live source with no balance yet is flagged where users are affected', () => {
    const html = render(createElement(parts.ShownCard, shownProps(snapshotOf({ platform_balance_mode: 'live', platform_balance_live_at: '' }), false)));
    assert.match(textOf(html), /No live balance yet/);
  });

  test('the static editor marks unsaved input and only offers save when something changed', () => {
    const clean = render(createElement(parts.StaticCard, staticCardProps(snapshotOf())));
    const input = tagsOf(clean, 'input')[0];
    assert.equal(input.value, '48350000');
    assert.equal(input.inputMode, 'decimal');
    const save = tagsOf(clean, 'button').find((attrs) => attrs.type === 'submit');
    assert.equal(save?.['aria-disabled'], 'true');
    assert.doesNotMatch(textOf(clean), /Unsaved|Discard/);
    assert.match(textOf(clean), /Saved as ₦48,350,000\.00, last changed .+ WAT\./);

    const dirty = render(createElement(parts.StaticCard, staticCardProps(snapshotOf(), {
      value: '50000000',
      dirty: true,
      preview: 50000000,
    })));
    assert.match(textOf(dirty), /Unsaved/);
    assert.match(textOf(dirty), /Shows as ₦50,000,000\.00\./);
    assert.match(textOf(dirty), /Discard/);
    const ready = tagsOf(dirty, 'button').find((attrs) => attrs.type === 'submit');
    assert.equal(ready?.['aria-disabled'], undefined);
  });

  test('the static editor locks while a save runs', () => {
    const html = render(createElement(parts.StaticCard, staticCardProps(snapshotOf(), {
      value: '50000000',
      dirty: true,
      busy: true,
      phase: 'saving',
    })));
    assert.ok('readOnly' in tagsOf(html, 'input')[0]);
    const save = tagsOf(html, 'button').find((attrs) => attrs.type === 'submit');
    assert.equal(save?.['aria-disabled'], 'true');
    assert.equal(save?.['aria-busy'], 'true');
    assert.match(textOf(html), /Saving…/);
    const discard = tagsOf(html, 'button').find((attrs) => attrs.type === 'button');
    assert.equal(discard?.['aria-disabled'], 'true');
  });

  test('the static editor says when it is checking, and stays locked during a source switch', () => {
    const checking = render(createElement(parts.StaticCard, staticCardProps(snapshotOf(), {
      value: '50000000',
      dirty: true,
      busy: true,
      phase: 'checking',
    })));
    assert.match(textOf(checking), /Checking…/);
    const switching = render(createElement(parts.StaticCard, staticCardProps(snapshotOf(), { busy: true })));
    assert.ok('readOnly' in tagsOf(switching, 'input')[0]);
    const save = tagsOf(switching, 'button').find((attrs) => attrs.type === 'submit');
    assert.equal(save?.['aria-busy'], undefined);
    assert.match(textOf(switching), /Save amount/);
  });

  test('the static editor warns while editing when another admin changed the amount', () => {
    const fresh = snapshotOf({ platform_balance_static: '49000000' });
    const html = render(createElement(parts.StaticCard, staticCardProps(fresh, {
      value: '50000000',
      dirty: true,
      preview: 50000000,
      changedElsewhere: true,
    })));
    assert.match(textOf(html), /Changed by another admin/);
    assert.match(textOf(html), /The saved amount is now ₦49,000,000\.00 ?\./);
    const clean = render(createElement(parts.StaticCard, staticCardProps(fresh, { changedElsewhere: true })));
    assert.doesNotMatch(textOf(clean), /Changed by another admin/);
  });

  test('readers see the static amount without an editor', () => {
    const html = render(createElement(parts.StaticCard, staticCardProps(snapshotOf(), { canWrite: false })));
    assert.equal(tagsOf(html, 'input').length, 0);
    assert.equal(tagsOf(html, 'button').length, 0);
    assert.match(textOf(html), /₦48,350,000\.00/);
    assert.match(textOf(html), /In use/);
  });

  test('the live card shows the provider, the refresh time and problems when not in use', () => {
    const fresh = render(createElement(parts.LiveCard, { snapshot: snapshotOf(), now: NOW, headingId: 'h-live' }));
    assert.match(textOf(fresh), /₦12,345\.67/);
    assert.match(textOf(fresh), /Paystack/);
    assert.match(textOf(fresh), /WAT/);
    assert.match(textOf(fresh), /30m ago/);
    assert.match(textOf(fresh), /Not in use/);
    const never = render(createElement(parts.LiveCard, {
      snapshot: snapshotOf({ platform_balance_live_at: '', platform_balance_live_error: 'boom' }),
      now: NOW,
      headingId: 'h-live',
    }));
    assert.match(textOf(never), /Never/);
    assert.match(textOf(never), /The last live refresh failed/);
  });

  test('the skeleton announces loading once', () => {
    const html = render(createElement(parts.BalanceSkeleton));
    assert.equal(tagsOf(html, 'span').filter((attrs) => attrs.role === 'status').length, 1);
    assert.match(textOf(html), /Loading the platform balance/);
  });

  test('pending text only describes a source switch', () => {
    assert.equal(model.workingStatus(null), '');
    assert.equal(model.workingStatus({ kind: 'mode', target: 'live', phase: 'checking' }), 'Checking the current source…');
    assert.equal(model.workingStatus({ kind: 'mode', target: 'static', phase: 'saving' }), 'Switching to Static…');
    assert.equal(model.workingStatus({ kind: 'mode', target: 'live', phase: 'confirming' }), '');
    assert.equal(model.workingStatus({ kind: 'static', phase: 'saving' }), '');
  });

  test('the save button names each step', () => {
    assert.equal(model.saveLabel(null), 'Save amount');
    assert.equal(model.saveLabel('checking'), 'Checking…');
    assert.equal(model.saveLabel('confirming'), 'Save amount');
    assert.equal(model.saveLabel('saving'), 'Saving…');
  });

  test('help under the amount names the saved figure, or only the change time when none is valid', () => {
    assert.equal(model.savedHelp(snapshotOf(), null), 'Saved as ₦48,350,000.00.');
    assert.equal(model.savedHelp(snapshotOf(), 'now'), 'Saved as ₦48,350,000.00, last changed now.');
    assert.equal(model.savedHelp(snapshotOf({ platform_balance_static: 'abc' }), 'now'), 'Last changed now.');
    assert.equal(model.savedHelp(snapshotOf({ platform_balance_static: null }), null), undefined);
  });

  test('times carry the business zone', () => {
    assert.match(parts.stamp(STAMP) ?? '', /WAT$/);
    assert.equal(parts.stamp(null), null);
  });
});

describe('hard rules', () => {
  const sources = () => [
    ...readdirSync(OWNED_DIR).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => join(OWNED_DIR, name)),
    ROUTE_FILE,
  ];

  test('owned sources carry no prose comments and no inline styles', () => {
    for (const file of sources()) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /\/\*/, file);
      assert.doesNotMatch(source, /(^|\s)\/\/\s/m, file);
      assert.doesNotMatch(source, /style=\{/, file);
    }
  });

  test('the stylesheet uses tokens only', () => {
    const css = readFileSync(join(OWNED_DIR, 'page.module.css'), 'utf8');
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
    for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      assert.doesNotMatch(value, colour, `${property}: ${value}`);
      assert.notEqual(property, 'z-index', `${property}: ${value}`);
    }
    assert.doesNotMatch(css, /\/\*/);
  });

  test('the shared model stays server-safe', () => {
    const source = readFileSync(join(OWNED_DIR, 'model.ts'), 'utf8');
    assert.doesNotMatch(source, /'use client'/);
    assert.doesNotMatch(source, /from '\.\.\/\.\.\/_ui'/);
    assert.doesNotMatch(source, /from 'react'/);
  });

  test('the route keeps the access rule, the envelope and the audit trail', () => {
    const source = readFileSync(ROUTE_FILE, 'utf8');
    const get = source.slice(source.indexOf('export async function GET'), source.indexOf('export async function PATCH'));
    const patch = source.slice(source.indexOf('export async function PATCH'));
    assert.match(get, /requireAdmin\('platform_balance\.read'\)/);
    assert.match(patch, /requireAdmin\('platform_balance\.write'\)/);
    assert.doesNotMatch(source, /requireSuperAdmin|requireAdminAny|requireAdminAll/);
    assert.doesNotMatch(source, /NextResponse\.json\(/);
    assert.match(patch, /writeAudit\(\{ \.\.\.audit, result: 'failure'/);
    assert.match(patch, /writeAudit\(\{ \.\.\.audit, result: 'success' \}\)/);
    assert.match(source, /sensitivity: 'financial'/);
    assert.match(source, /from '\.\.\/\.\.\/\(dashboard\)\/platform-balance\/model'/);
    assert.match(patch, /writePlan\(current, plan,/);
    assert.match(source, /update\.eq\('value', guarded\.seen\)/);
    assert.match(source, /return raceConflict\(plan\)/);
  });
});
