import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_MESSAGE,
  ERROR_STATUS,
  buildPagination,
  clientIpFrom,
  isUuid,
  newRequestId,
  parsePageParams,
  type ApiErrorCode,
} from '../app/lib/http.ts';

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
