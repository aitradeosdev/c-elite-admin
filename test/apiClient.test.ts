import { afterEach, before, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAppModule } from './support/uiHarness.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';

type ApiClientModule = typeof import('../app/lib/apiClient.ts');

interface FetchCall {
  url: string;
  init: RequestInit;
}

let api: ApiClientModule;
const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];

before(async () => {
  api = await loadAppModule<ApiClientModule>('lib/apiClient.ts');
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function hangUntilAbort(call: FetchCall): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = call.init.signal;
    if (!signal) return;
    const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal.aborted) fail();
    signal.addEventListener('abort', fail);
  });
}

function failureOf<T>(result: ApiResult<T>): ApiFailure {
  assert.equal(result.ok, false, 'expected a failure result');
  if (result.ok) throw new Error('unreachable');
  return result.error;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('apiRequest success envelope', () => {
  test('ok() payloads arrive whole as data, with status and the body request id', async () => {
    stubFetch(() => json({ success: true, request_id: 'req_body', submissions: [{ id: 'a' }], total: 1 }));
    const result = await api.apiRequest<{ submissions: Array<{ id: string }>; total: number }>('/api/card-queue');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 200);
    assert.equal(result.requestId, 'req_body');
    assert.deepEqual(result.data.submissions, [{ id: 'a' }]);
    assert.equal(result.data.total, 1);
  });

  test('the request id falls back to the x-request-id header', async () => {
    stubFetch(() => json({ success: true, rows: [] }, 200, { 'x-request-id': 'req_header' }));
    const result = await api.apiRequest('/api/users');
    assert.equal(result.ok && result.requestId, 'req_header');
  });

  test('an empty 2xx body is an empty object, not a failure', async () => {
    stubFetch(() => new Response('', { status: 200 }));
    const result = await api.apiRequest('/api/ping', { method: 'POST' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.data, {});
  });

  test('select maps the body, and its type is inferred', async () => {
    stubFetch(() => json({ success: true, withdrawal: { id: 'w1', status: 'pending' } }));
    const result = await api.apiRequest('/api/withdrawals', {
      query: { id: 'w1' },
      select: (body) => (body.withdrawal && typeof body.withdrawal === 'object' ? (body.withdrawal as { id: string }) : null),
    });
    assert.equal(result.ok && result.data.id, 'w1');
  });
});

describe('apiRequest request shape', () => {
  test('GET is the default, with no-store caching and a JSON accept header', async () => {
    stubFetch(() => json({ success: true }));
    await api.apiRequest('/api/dashboard');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/dashboard');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal((calls[0].init.headers as Record<string, string>).accept, 'application/json');
    assert.equal(calls[0].init.body, undefined);
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  test('query serialization skips null, undefined, empty strings and non-finite numbers', async () => {
    stubFetch(() => json({ success: true }));
    await api.apiRequest('/api/transactions', {
      query: { search: 'ada lovelace', status: '', type: null, date_from: undefined, page: 2, limit: Number.NaN },
    });
    assert.equal(calls[0].url, '/api/transactions?search=ada+lovelace&page=2');
  });

  test('query params are appended to a path that already has a query string', async () => {
    stubFetch(() => json({ success: true }));
    await api.apiRequest('/api/users/u1?section=devices', { query: { page: 3 } });
    await api.apiRequest('/api/users/u1?', { query: { page: 4 } });
    await api.apiRequest('/api/users/u1', { query: {} });
    assert.deepEqual(calls.map((call) => call.url), [
      '/api/users/u1?section=devices&page=3',
      '/api/users/u1?page=4',
      '/api/users/u1',
    ]);
  });

  test('a JSON body is stringified with a content type, and custom headers merge case-insensitively', async () => {
    stubFetch(() => json({ success: true }));
    await api.apiRequest('/api/users/u1', {
      method: 'PATCH',
      body: { action: 'freeze', reason: 'Review' },
      headers: { 'Idempotency-Key': 'k1', 'Content-Type': 'application/json; charset=utf-8' },
    });
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(calls[0].init.method, 'PATCH');
    assert.equal(calls[0].init.body, '{"action":"freeze","reason":"Review"}');
    assert.equal(headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(headers['idempotency-key'], 'k1');
    assert.equal(Object.keys(headers).filter((name) => name.toLowerCase() === 'content-type').length, 1);
  });

  test('FormData passes through untouched so the browser sets the multipart boundary', async () => {
    stubFetch(() => json({ success: true }));
    const form = new FormData();
    form.append('file', 'x');
    await api.apiRequest('/api/cards/upload', { method: 'POST', body: form });
    assert.equal(calls[0].init.body, form);
    assert.equal((calls[0].init.headers as Record<string, string>)['content-type'], undefined);
  });

  test('a GET with a body, or an unserializable body, is never sent', async () => {
    stubFetch(() => json({ success: true }));
    const withBody = failureOf(await api.apiRequest('/api/users', { body: { a: 1 } }));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const unserializable = failureOf(await api.apiRequest('/api/users', { method: 'POST', body: circular }));
    assert.equal(calls.length, 0);
    for (const failure of [withBody, unserializable]) {
      assert.equal(failure.kind, 'parse');
      assert.equal(failure.outcomeUnknown, false);
      assert.match(failure.message, /nothing was sent/);
    }
  });
});

describe('apiRequest http failures', () => {
  test('a fail() envelope becomes an http failure carrying code, message, details and request id', async () => {
    stubFetch(() => json({
      success: false,
      error: 'The payment provider could not be reached.',
      code: 'PROVIDER_ERROR',
      message: 'The payment provider could not be reached.',
      request_id: 'req_fail',
      details: { stage: 'gateway_unreachable' },
    }, 502));
    const failure = failureOf(await api.apiRequest('/api/withdrawals/w1/approve', { method: 'POST' }));
    assert.deepEqual(failure, {
      kind: 'http',
      status: 502,
      code: 'PROVIDER_ERROR',
      message: 'The payment provider could not be reached.',
      requestId: 'req_fail',
      details: { stage: 'gateway_unreachable' },
      outcomeUnknown: false,
    });
  });

  test('the message prefers body.error, then body.message, then a plain-English default', async () => {
    stubFetch(() => json({ error: 'Card already redeemed', message: 'ignored' }, 400));
    assert.equal(failureOf(await api.apiRequest('/api/a')).message, 'Card already redeemed');
    stubFetch(() => json({ message: 'Only message' }, 400));
    assert.equal(failureOf(await api.apiRequest('/api/a')).message, 'Only message');
    stubFetch(() => json({ error: '   ' }, 404));
    assert.equal(failureOf(await api.apiRequest('/api/a')).message, 'That record could not be found.');
    stubFetch(() => json({}, 409));
    assert.equal(failureOf(await api.apiRequest('/api/a')).message, 'That record has changed. Reload and try again.');
    stubFetch(() => json({}, 429));
    assert.equal(failureOf(await api.apiRequest('/api/a')).message, 'Too many requests. Try again shortly.');
  });

  test('a 5xx without a server code never shows the raw body text', async () => {
    stubFetch(() => json({ error: 'duplicate key value violates unique constraint "users_pkey"' }, 500));
    const read = failureOf(await api.apiRequest('/api/admin-accounts'));
    assert.equal(read.kind, 'http');
    assert.equal(read.code, null);
    assert.equal(read.message, 'The server returned an error (HTTP 500). Try again.');
    assert.equal(read.outcomeUnknown, false);
  });

  test('a write that gets a 5xx without a server code has an unknown outcome', async () => {
    stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    const failure = failureOf(await api.apiRequest('/api/withdrawals/w1/approve', { method: 'POST' }));
    assert.equal(failure.status, 502);
    assert.equal(failure.outcomeUnknown, true);
    assert.match(failure.message, /HTTP 502/);
    assert.match(failure.message, /may or may not have been saved/);
  });

  test('success:false inside a 200 is a failure', async () => {
    stubFetch(() => json({ success: false, error: 'Rate changed. Reload the card.', code: 'STATE_CONFLICT' }, 200));
    const failure = failureOf(await api.apiRequest('/api/card-queue', { method: 'POST', body: { action: 'approve' } }));
    assert.equal(failure.kind, 'http');
    assert.equal(failure.status, 200);
    assert.equal(failure.code, 'STATE_CONFLICT');
    assert.equal(failure.message, 'Rate changed. Reload the card.');
    assert.equal(failure.outcomeUnknown, false);
  });
});

describe('apiRequest unreadable responses', () => {
  test('a non-JSON 2xx is a parse failure; for a write the outcome is unknown', async () => {
    stubFetch(() => new Response('not json', { status: 200, headers: { 'x-request-id': 'req_html' } }));
    const read = failureOf(await api.apiRequest('/api/users'));
    assert.equal(read.kind, 'parse');
    assert.equal(read.status, 200);
    assert.equal(read.requestId, 'req_html');
    assert.equal(read.outcomeUnknown, false);
    const write = failureOf(await api.apiRequest('/api/users/u1', { method: 'PATCH', body: {} }));
    assert.equal(write.outcomeUnknown, true);
    assert.match(write.message, /may or may not have been saved/);
  });

  test('a JSON array or primitive body is not a valid envelope', async () => {
    stubFetch(() => json([1, 2, 3]));
    assert.equal(failureOf(await api.apiRequest('/api/a')).kind, 'parse');
    stubFetch(() => json('text'));
    assert.equal(failureOf(await api.apiRequest('/api/a')).kind, 'parse');
  });

  test('select returning null or throwing is a parse failure that keeps status and request id', async () => {
    stubFetch(() => json({ success: true, request_id: 'req_sel' }));
    const empty = failureOf(await api.apiRequest('/api/a', { select: () => null }));
    const thrown = failureOf(await api.apiRequest('/api/a', {
      select: () => {
        throw new Error('Cannot read properties of undefined');
      },
    }));
    for (const failure of [empty, thrown]) {
      assert.equal(failure.kind, 'parse');
      assert.equal(failure.status, 200);
      assert.equal(failure.requestId, 'req_sel');
      assert.doesNotMatch(failure.message, /Cannot read properties/);
    }
  });
});

describe('apiRequest interruptions', () => {
  test('a network error is plain English and never echoes the exception text', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const read = failureOf(await api.apiRequest('/api/users'));
    assert.deepEqual(read, {
      kind: 'network',
      status: null,
      code: null,
      message: 'Could not reach the server. Check your connection and try again.',
      requestId: null,
      details: null,
      outcomeUnknown: false,
    });
    const write = failureOf(await api.apiRequest('/api/card-queue', { method: 'POST', body: {} }));
    assert.equal(write.kind, 'network');
    assert.equal(write.outcomeUnknown, true);
    assert.match(write.message, /may or may not have been saved/);
    assert.doesNotMatch(write.message, /Failed to fetch/);
  });

  test('a body stream that breaks mid-read is a network failure', async () => {
    stubFetch(() => new Response(new ReadableStream({
      start(controller) {
        controller.error(new TypeError('terminated'));
      },
    }), { status: 200 }));
    assert.equal(failureOf(await api.apiRequest('/api/users')).kind, 'network');
  });

  test('a caller abort is reported as aborted, not as a network or timeout failure', async () => {
    stubFetch(hangUntilAbort);
    const controller = new AbortController();
    const pending = api.apiRequest('/api/users', { signal: controller.signal });
    await flush();
    controller.abort();
    const failure = failureOf(await pending);
    assert.equal(failure.kind, 'aborted');
    assert.equal(failure.outcomeUnknown, false);
    assert.equal(calls[0].init.signal?.aborted, true);
  });

  test('an already aborted signal never reaches fetch', async () => {
    stubFetch(() => json({ success: true }));
    const controller = new AbortController();
    controller.abort();
    const failure = failureOf(await api.apiRequest('/api/withdrawals/w1/reject', {
      method: 'POST',
      body: { reason: 'x' },
      signal: controller.signal,
    }));
    assert.equal(calls.length, 0);
    assert.equal(failure.kind, 'aborted');
    assert.equal(failure.outcomeUnknown, false);
  });

  test('a caller abort of a write leaves the outcome unknown', async () => {
    stubFetch(hangUntilAbort);
    const controller = new AbortController();
    const pending = api.apiRequest('/api/withdrawals/w1/approve', { method: 'POST', signal: controller.signal });
    await flush();
    controller.abort();
    const failure = failureOf(await pending);
    assert.equal(failure.kind, 'aborted');
    assert.equal(failure.outcomeUnknown, true);
  });

  test('a custom timeout aborts the request and reports timeout', async () => {
    stubFetch(hangUntilAbort);
    const failure = failureOf(await api.apiRequest('/api/users', { timeoutMs: 15 }));
    assert.equal(failure.kind, 'timeout');
    assert.equal(failure.message, 'The server took too long to respond. Try again.');
    assert.equal(calls[0].init.signal?.aborted, true);
  });

  test('a timeout beyond the timer range waits instead of firing at once', async () => {
    stubFetch(() => new Promise<Response>((resolve) => {
      setTimeout(() => resolve(json({ success: true })), 30);
    }));
    const result = await api.apiRequest('/api/users', { timeoutMs: 1e10 });
    assert.equal(result.ok, true);
    assert.equal(calls[0].init.signal?.aborted, false);
  });

  test('reads time out after 20 seconds and writes after 45 seconds', async () => {
    assert.equal(api.API_READ_TIMEOUT_MS, 20000);
    assert.equal(api.API_WRITE_TIMEOUT_MS, 45000);
    mock.timers.enable({ apis: ['setTimeout'] });
    stubFetch(hangUntilAbort);
    const settled: string[] = [];
    const read = api.apiRequest('/api/users').then((result) => {
      settled.push('read');
      return result;
    });
    const write = api.apiRequest('/api/withdrawals/w1/approve', { method: 'POST' }).then((result) => {
      settled.push('write');
      return result;
    });
    await flush();
    mock.timers.tick(19999);
    await flush();
    assert.deepEqual(settled, []);
    mock.timers.tick(1);
    await flush();
    assert.deepEqual(settled, ['read']);
    assert.equal(failureOf(await read).kind, 'timeout');
    mock.timers.tick(24999);
    await flush();
    assert.deepEqual(settled, ['read']);
    mock.timers.tick(1);
    await flush();
    const writeFailure = failureOf(await write);
    assert.equal(writeFailure.kind, 'timeout');
    assert.equal(writeFailure.outcomeUnknown, true);
  });

  test('a completed request clears its timer and stops listening to the caller signal', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    stubFetch(() => json({ success: true }));
    const controller = new AbortController();
    const result = await api.apiRequest('/api/users', { signal: controller.signal });
    assert.equal(result.ok, true);
    controller.abort();
    mock.timers.tick(60000);
    assert.equal(calls[0].init.signal?.aborted, false);
  });
});

describe('session expiry', () => {
  test('a 401 without a code, or with AUTH_REQUIRED, calls onAuthExpired once', async () => {
    const seen: ApiFailure[] = [];
    const restore = api.configureApiClient({ onAuthExpired: (failure) => seen.push(failure) });
    try {
      stubFetch(() => json({ error: 'Unauthorized' }, 401));
      await api.apiRequest('/api/activity');
      stubFetch(() => json({ success: false, code: 'AUTH_REQUIRED', error: 'Your session has expired. Sign in again.' }, 401));
      await api.apiRequest('/api/withdrawals');
      assert.equal(seen.length, 2);
      assert.equal(seen[0].status, 401);
      assert.equal(seen[1].code, 'AUTH_REQUIRED');
    } finally {
      restore();
    }
  });

  test('other 401 codes, other statuses and /api/auth/ routes do not expire the session', async () => {
    const seen: ApiFailure[] = [];
    const restore = api.configureApiClient({ onAuthExpired: (failure) => seen.push(failure) });
    try {
      stubFetch(() => json({ success: false, code: 'PIN_INVALID', error: 'Wrong PIN' }, 401));
      await api.apiRequest('/api/users/u1', { method: 'PATCH', body: {} });
      stubFetch(() => json({ error: 'Forbidden' }, 403));
      await api.apiRequest('/api/users');
      stubFetch(() => json({ error: 'Invalid credentials' }, 401));
      await api.apiRequest('/api/auth/login', { method: 'POST', body: {} });
      assert.equal(seen.length, 0);
    } finally {
      restore();
    }
  });

  test('a throwing handler cannot turn the result into a thrown error', async () => {
    const restore = api.configureApiClient({
      onAuthExpired: () => {
        throw new Error('handler broke');
      },
    });
    try {
      stubFetch(() => json({ error: 'Unauthorized' }, 401));
      const failure = failureOf(await api.apiRequest('/api/users'));
      assert.equal(failure.message, 'Unauthorized');
    } finally {
      restore();
    }
  });

  test('restore functions unwind registrations in reverse order, as StrictMode remounts do', async () => {
    const seen: string[] = [];
    stubFetch(() => json({ error: 'Unauthorized' }, 401));
    const first = api.configureApiClient({ onAuthExpired: () => seen.push('first') });
    const second = api.configureApiClient({ onAuthExpired: () => seen.push('second') });
    await api.apiRequest('/api/users');
    second();
    await api.apiRequest('/api/users');
    first();
    await api.apiRequest('/api/users');
    assert.deepEqual(seen, ['second', 'first']);
  });

  test('a stale restore does not remove a newer registration', async () => {
    const seen: string[] = [];
    stubFetch(() => json({ error: 'Unauthorized' }, 401));
    const first = api.configureApiClient({ onAuthExpired: () => seen.push('first') });
    first();
    const second = api.configureApiClient({ onAuthExpired: () => seen.push('second') });
    first();
    await api.apiRequest('/api/users');
    second();
    await api.apiRequest('/api/users');
    assert.deepEqual(seen, ['second']);
  });
});

describe('helpers', () => {
  test('serializeQuery accepts URLSearchParams and drops empty values', () => {
    const params = new URLSearchParams('status=pending&search=&page=2');
    assert.equal(api.serializeQuery(params), 'status=pending&page=2');
    assert.equal(api.serializeQuery(null), '');
    assert.equal(api.serializeQuery(undefined), '');
  });

  test('toApiFailure maps thrown errors without leaking their text', () => {
    assert.equal(api.toApiFailure(new DOMException('x', 'AbortError')).kind, 'aborted');
    assert.equal(api.toApiFailure(new DOMException('x', 'TimeoutError')).kind, 'timeout');
    assert.equal(api.toApiFailure(new TypeError('Failed to fetch')).kind, 'network');
    const unknown = api.toApiFailure(new Error('secret stack detail'));
    assert.equal(unknown.kind, 'parse');
    assert.doesNotMatch(unknown.message, /secret/);
    assert.equal(api.toApiFailure(null).kind, 'parse');
    assert.equal(api.toApiFailure(new TypeError('x'), 'POST').outcomeUnknown, true);
    assert.equal(api.toApiFailure(new TypeError('x')).outcomeUnknown, false);
  });

  test('apiRequest never throws, whatever fetch does', async () => {
    globalThis.fetch = (() => {
      throw new Error('synchronous explosion');
    }) as typeof fetch;
    const failure = failureOf(await api.apiRequest('/api/users'));
    assert.equal(failure.kind, 'network');
  });
});
