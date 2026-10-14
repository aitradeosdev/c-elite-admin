import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ERROR_MESSAGE,
  ERROR_STATUS,
  MFA_LOCKED_REASON,
  STEP_ENDED_REASON,
  buildPagination,
  clientIpFrom,
  isUuid,
  newRequestId,
  parsePageParams,
  twoStepLockedMessage,
  twoStepUnlockText,
  type ApiErrorCode,
} from '../app/lib/http.ts';

const HTTP_FILE = fileURLToPath(new URL('../app/lib/http.ts', import.meta.url));
const TEST_FILE = fileURLToPath(import.meta.url);
const EDGE_LOGIN = fileURLToPath(new URL('../../supabase/functions/admin-mobile-api/index.ts', import.meta.url));

describe('error codes', () => {
  const codes = Object.keys(ERROR_STATUS) as ApiErrorCode[];

  test('the spec codes all exist', () => {
    for (const required of [
      'AUTH_REQUIRED', 'PERMISSION_DENIED', 'RESOURCE_NOT_FOUND', 'VALIDATION_ERROR',
      'STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'PROVIDER_ERROR', 'OPERATION_IN_PROGRESS',
      'RATE_LIMITED',
    ]) {
      assert.ok(codes.includes(required as ApiErrorCode), `missing code ${required}`);
    }
  });

  test('every code has a status and a human message', () => {
    for (const code of codes) {
      assert.equal(typeof ERROR_STATUS[code], 'number');
      assert.ok(ERROR_STATUS[code] >= 400 && ERROR_STATUS[code] <= 599, `${code} status out of range`);
      assert.ok(ERROR_MESSAGE[code].length > 0, `${code} has no message`);
    }
  });

  test('authentication is 401 and authorization is 403', () => {
    assert.equal(ERROR_STATUS.AUTH_REQUIRED, 401);
    assert.equal(ERROR_STATUS.PERMISSION_DENIED, 403);
  });

  test('the in-session prompts are 403 with plain messages, so they never open the expiry dialog or sign the app out', () => {
    assert.equal(ERROR_STATUS.REAUTH_REQUIRED, 403);
    assert.equal(ERROR_STATUS.MFA_REQUIRED, 403);
    assert.equal(ERROR_MESSAGE.REAUTH_REQUIRED, 'Confirm it is you to continue.');
    assert.equal(ERROR_MESSAGE.MFA_REQUIRED, 'Set up two-step sign-in first.');
  });

  test('401 belongs to AUTH_REQUIRED alone, which means the session is gone', () => {
    assert.deepEqual(codes.filter((code) => ERROR_STATUS[code] === 401), ['AUTH_REQUIRED']);
  });

  test('no message leaks a stack trace or technical detail', () => {
    for (const code of codes) {
      assert.ok(!/Error:|\bat \w+\.|undefined|null/.test(ERROR_MESSAGE[code]), `${code} message is technical`);
    }
  });
});

describe('buildPagination', () => {
  test('computes pages and has_more', () => {
    const p = buildPagination(1, 50, 120);
    assert.equal(p.total_pages, 3);
    assert.equal(p.has_more, true);
  });

  test('last page has no more', () => {
    assert.equal(buildPagination(3, 50, 120).has_more, false);
  });

  test('exact multiple does not produce a phantom page', () => {
    const p = buildPagination(2, 50, 100);
    assert.equal(p.total_pages, 2);
    assert.equal(p.has_more, false);
  });

  test('an empty result set still reports one page', () => {
    const p = buildPagination(1, 50, 0);
    assert.equal(p.total_pages, 1);
    assert.equal(p.has_more, false);
  });

  test('unknown total does not claim more pages', () => {
    const p = buildPagination(1, 50, null);
    assert.equal(p.total_pages, null);
    assert.equal(p.has_more, false);
  });

  test('degenerate input cannot produce a divide-by-zero or negative page', () => {
    const p = buildPagination(0, 0, 10);
    assert.equal(p.page, 1);
    assert.equal(p.page_size, 1);
    assert.equal(p.total_pages, 10);
  });
});

describe('parsePageParams', () => {
  const at = (qs: string) => parsePageParams(new URL('https://admin.test/x' + qs));

  test('defaults to page 1 size 50', () => {
    const p = at('');
    assert.deepEqual([p.page, p.pageSize, p.from, p.to], [1, 50, 0, 49]);
  });

  test('honours page and page_size', () => {
    const p = at('?page=3&page_size=25');
    assert.deepEqual([p.page, p.pageSize, p.from, p.to], [3, 25, 50, 74]);
  });

  test('caps page_size so a client cannot ask for the whole table', () => {
    assert.equal(at('?page_size=100000').pageSize, 200);
    assert.equal(parsePageParams(new URL('https://x/?page_size=999'), { maxSize: 20 }).pageSize, 20);
  });

  test('rejects zero, negative and non-numeric values instead of producing a bad range', () => {
    assert.equal(at('?page=0').page, 1);
    assert.equal(at('?page=-5').page, 1);
    assert.equal(at('?page=abc').page, 1);
    assert.equal(at('?page_size=0').pageSize, 50);
    assert.equal(at('?page_size=-10').pageSize, 50);
    assert.equal(at('?page_size=abc').pageSize, 50);
  });

  test('from/to is always a valid inclusive range', () => {
    for (const qs of ['', '?page=1', '?page=7&page_size=13', '?page=abc&page_size=-1']) {
      const p = at(qs);
      assert.ok(p.from >= 0, qs);
      assert.ok(p.to >= p.from, qs);
      assert.equal(p.to - p.from + 1, p.pageSize, qs);
    }
  });
});

describe('isUuid', () => {
  test('accepts a real uuid in either case', () => {
    assert.ok(isUuid('bc0daef7-1234-4abc-89ef-0123456789ab'));
    assert.ok(isUuid('BC0DAEF7-1234-4ABC-89EF-0123456789AB'));
  });

  test('rejects near-misses and injection attempts', () => {
    for (const bad of [
      '', 'null', 'undefined',
      'bc0daef7-1234-4abc-89ef-0123456789a',
      'bc0daef7-1234-4abc-89ef-0123456789abc',
      "bc0daef7-1234-4abc-89ef-0123456789ab' OR '1'='1",
      'bc0daef7_1234_4abc_89ef_0123456789ab',
      ' bc0daef7-1234-4abc-89ef-0123456789ab',
      'zc0daef7-1234-4abc-89ef-0123456789ab',
    ]) {
      assert.equal(isUuid(bad), false, `should reject: ${JSON.stringify(bad)}`);
    }
  });

  test('rejects non-strings', () => {
    for (const bad of [null, undefined, 0, 123, {}, [], true]) {
      assert.equal(isUuid(bad), false);
    }
  });
});

describe('newRequestId', () => {
  test('is prefixed and stable in shape', () => {
    const id = newRequestId();
    assert.match(id, /^req_[0-9a-f]{12}$/);
  });

  test('does not collide across a batch', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRequestId()));
    assert.equal(ids.size, 500);
  });
});

describe('clientIpFrom', () => {
  const from = (h: Record<string, string>) => clientIpFrom((n) => h[n] ?? null);

  test('takes the last x-forwarded-for hop, not the client-controlled first', () => {
    assert.equal(from({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }), '3.3.3.3');
  });

  test('falls back to x-real-ip', () => {
    assert.equal(from({ 'x-real-ip': '9.9.9.9' }), '9.9.9.9');
  });

  test('never returns empty', () => {
    assert.equal(from({}), 'unknown');
    assert.equal(from({ 'x-forwarded-for': '' }), 'unknown');
    assert.equal(from({ 'x-forwarded-for': ' , , ' }), 'unknown');
  });
});

describe('two-step lock wording', () => {
  const NOW = Date.parse('2026-10-13T10:00:00.000Z');

  test('rounds the unlock time up to the next whole minute and shows it in WAT on the same Lagos day', () => {
    assert.equal(twoStepUnlockText('2026-10-13T10:14:30.500Z', NOW), '11:15 WAT');
    assert.equal(twoStepUnlockText('2026-10-13T10:14:00.001Z', NOW), '11:15 WAT');
    assert.equal(twoStepUnlockText('2026-10-13T10:15:00.000Z', NOW), '11:15 WAT');
    assert.equal(twoStepUnlockText('2026-10-13T10:14:30.123456+00:00', NOW), '11:15 WAT');
  });

  test('adds the date whenever sign-in works again on another Lagos day, as every 24-hour lock does', () => {
    assert.equal(twoStepUnlockText('2026-10-14T13:05:10.000Z', NOW), '14 Oct, 14:06 WAT');
    assert.equal(twoStepUnlockText('2026-11-01T09:00:30.000Z', Date.parse('2026-10-31T09:00:00.000Z')), '1 Nov, 10:01 WAT');
    assert.equal(twoStepUnlockText(new Date('2026-10-14T10:00:00.000Z'), NOW), '14 Oct, 11:00 WAT');
  });

  test('compares days in Lagos time, not UTC, across midnight', () => {
    const lateEvening = Date.parse('2026-10-13T22:50:00.000Z');
    assert.equal(twoStepUnlockText('2026-10-13T23:04:20.000Z', lateEvening), '14 Oct, 00:05 WAT');
    assert.equal(twoStepUnlockText('2026-10-13T22:44:59.000Z', Date.parse('2026-10-13T22:30:00.000Z')), '23:45 WAT');
    assert.equal(twoStepUnlockText('2026-10-13T23:24:01.000Z', Date.parse('2026-10-13T23:10:00.000Z')), '00:25 WAT');
  });

  test('gives no time for a missing or unreadable value', () => {
    for (const value of [null, undefined, '', 'not a date', 1760350000000, {}, new Date('nope')]) {
      assert.equal(twoStepUnlockText(value, NOW), null, String(value));
    }
    assert.equal(twoStepUnlockText('2026-10-13T10:14:30.000Z', Number.NaN), null);
  });

  test('says when sign-in works again, or says it is locked for now when the time cannot be read', () => {
    assert.equal(
      twoStepLockedMessage('2026-10-13T10:14:30.000Z', NOW),
      'Too many wrong codes. Two-step sign-in is locked until 11:15 WAT. Your super administrators have been alerted.',
    );
    assert.equal(
      twoStepLockedMessage('2026-10-14T10:00:00.000Z', NOW),
      'Too many wrong codes. Two-step sign-in is locked until 14 Oct, 11:00 WAT. Your super administrators have been alerted.',
    );
    assert.equal(
      twoStepLockedMessage(null, NOW),
      'Too many wrong codes. Two-step sign-in is locked for now. Try again later. Your super administrators have been alerted.',
    );
  });

  test('names the reasons the sign-in screens act on', () => {
    assert.equal(MFA_LOCKED_REASON, 'mfa_locked');
    assert.equal(STEP_ENDED_REASON, 'challenge_expired');
  });

  test('reads exactly like the mobile sign-in, which uses the same rounding and offset', { skip: !existsSync(EDGE_LOGIN) }, () => {
    const edge = readFileSync(EDGE_LOGIN, 'utf8');
    const web = readFileSync(HTTP_FILE, 'utf8');
    for (const fragment of [
      'Too many wrong codes. Two-step sign-in is locked until ${when}. Your super administrators have been alerted.',
      'Too many wrong codes. Two-step sign-in is locked for now. Try again later. Your super administrators have been alerted.',
      'Math.ceil(until / ',
      ':${pad2(at.getUTCMinutes())} WAT`',
      '`${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}, ${time}`',
    ]) {
      assert.ok(edge.includes(fragment), `edge: ${fragment}`);
      assert.ok(web.includes(fragment), `web: ${fragment}`);
    }
    assert.match(edge, /WAT_OFFSET_MS = 60 \* 60 \* 1000;/);
    assert.match(web, /WAT_OFFSET_MS = 60 \* 60 \* 1000;/);
  });
});

describe('house rules', () => {
  test('the module and this test carry no prose comments', () => {
    for (const file of [HTTP_FILE, TEST_FILE]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m, file);
    }
  });
});
