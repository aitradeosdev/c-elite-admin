import { ERROR_MESSAGE } from './http';

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiFailureKind = 'http' | 'network' | 'timeout' | 'aborted' | 'parse';

export type ApiBody = Record<string, unknown>;

export type ApiQueryValue = string | number | null | undefined;

export type ApiQuery = Readonly<Record<string, ApiQueryValue>>;

export interface ApiFailure {
  kind: ApiFailureKind;
  status: number | null;
  code: string | null;
  message: string;
  requestId: string | null;
  details: unknown;
  outcomeUnknown: boolean;
}

export type ApiResult<T> =
  | { ok: true; data: T; status: number; requestId: string | null }
  | { ok: false; error: ApiFailure };

export interface ApiRequestOptions<T = ApiBody> {
  method?: ApiMethod;
  query?: ApiQuery | URLSearchParams | null;
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal | null;
  timeoutMs?: number;
  select?: (body: ApiBody) => T | null | undefined;
}

export interface ApiClientConfig {
  onAuthExpired: ((failure: ApiFailure) => void) | null;
}

export const API_READ_TIMEOUT_MS = 20000;

export const API_WRITE_TIMEOUT_MS = 45000;

const MAX_TIMER_MS = 2147483647;

type Interruption = Exclude<ApiFailureKind, 'http'>;

const READ_COPY: Readonly<Record<Interruption, string>> = {
  network: 'Could not reach the server. Check your connection and try again.',
  timeout: 'The server took too long to respond. Try again.',
  aborted: 'The request was cancelled.',
  parse: 'The server sent a response that could not be read. Try again.',
};

const WRITE_COPY: Readonly<Record<Interruption, string>> = {
  network: 'Could not reach the server, so this change may or may not have been saved. Refresh to check before trying again.',
  timeout: 'The server took too long to respond, so this change may or may not have been saved. Refresh to check before trying again.',
  aborted: 'The request was cancelled, so this change may or may not have been saved. Refresh to check before trying again.',
  parse: 'The server’s response could not be read, so this change may or may not have been saved. Refresh to check before trying again.',
};

const NOT_SENT = 'This request could not be prepared, so nothing was sent. Reload the page and try again.';
const NOT_COMPLETED = 'The server could not complete this request.';

let config: ApiClientConfig = { onAuthExpired: null };

export function configureApiClient(patch: Partial<ApiClientConfig>): () => void {
  const previous = config;
  const applied: ApiClientConfig = { ...config, ...patch };
  config = applied;
  return () => {
    if (config === applied) config = previous;
  };
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isRecord(value: unknown): value is ApiBody {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isWrite(method: ApiMethod): boolean {
  return method !== 'GET';
}

function statusCopy(status: number, write: boolean): string {
  if (status === 401) return ERROR_MESSAGE.AUTH_REQUIRED;
  if (status === 403) return ERROR_MESSAGE.PERMISSION_DENIED;
  if (status === 404) return ERROR_MESSAGE.RESOURCE_NOT_FOUND;
  if (status === 409) return ERROR_MESSAGE.STATE_CONFLICT;
  if (status === 429) return ERROR_MESSAGE.RATE_LIMITED;
  if (status >= 500) {
    return write
      ? `The server returned an error (HTTP ${status}), so this change may or may not have been saved. Refresh to check before trying again.`
      : `The server returned an error (HTTP ${status}). Try again.`;
  }
  if (status >= 400) return ERROR_MESSAGE.VALIDATION_ERROR;
  return NOT_COMPLETED;
}

function interrupted(kind: Interruption, write: boolean, sent: boolean): ApiFailure {
  return {
    kind,
    status: null,
    code: null,
    message: (write ? WRITE_COPY : READ_COPY)[kind],
    requestId: null,
    details: null,
    outcomeUnknown: write && sent,
  };
}

export function toApiFailure(error: unknown, method: ApiMethod = 'GET'): ApiFailure {
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
  const kind: Interruption = name === 'AbortError'
    ? 'aborted'
    : name === 'TimeoutError'
      ? 'timeout'
      : name === 'TypeError'
        ? 'network'
        : 'parse';
  return interrupted(kind, isWrite(method), true);
}

export function serializeQuery(query: ApiQuery | URLSearchParams | null | undefined): string {
  const params = new URLSearchParams();
  if (!query) return '';
  if (query instanceof URLSearchParams) {
    query.forEach((value, name) => {
      if (value !== '') params.append(name, value);
    });
    return params.toString();
  }
  for (const [name, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) params.append(name, String(value));
      continue;
    }
    if (value !== '') params.append(name, value);
  }
  return params.toString();
}

function joinQuery(path: string, query: string): string {
  if (!query) return path;
  if (!path.includes('?')) return `${path}?${query}`;
  return /[?&]$/.test(path) ? `${path}${query}` : `${path}&${query}`;
}

function isAuthPath(path: string): boolean {
  try {
    return new URL(path, 'http://localhost').pathname.startsWith('/api/auth/');
  } catch {
    return false;
  }
}

function requestInit(method: ApiMethod, options: ApiRequestOptions<unknown>): RequestInit {
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (method === 'GET') throw new TypeError('GET requests cannot carry a body');
    if (typeof FormData !== 'undefined' && options.body instanceof FormData) {
      body = options.body;
    } else {
      const json = JSON.stringify(options.body);
      if (json === undefined) throw new TypeError('The request body cannot be sent as JSON');
      body = json;
      headers['content-type'] = 'application/json';
    }
  }
  if (options.headers) {
    for (const [name, value] of Object.entries(options.headers)) headers[name.toLowerCase()] = value;
  }
  return { method, headers, body, cache: 'no-store' };
}

function readJson(raw: string): ApiBody | null {
  if (raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function notifyAuthExpired(failure: ApiFailure): void {
  const handler = config.onAuthExpired;
  if (!handler) return;
  try {
    handler(failure);
  } catch {
    return;
  }
}

function settleResponse<T>(
  path: string,
  method: ApiMethod,
  response: Response,
  raw: string,
  select: ApiRequestOptions<T>['select'],
): ApiResult<T> {
  const write = isWrite(method);
  const body = readJson(raw);
  const status = response.status;
  const requestId = text(body?.request_id) ?? text(response.headers.get('x-request-id'));

  if (!response.ok || body?.success === false) {
    const code = text(body?.code);
    const untrusted = status >= 500 && code === null;
    const failure: ApiFailure = {
      kind: 'http',
      status,
      code,
      message: (untrusted ? null : text(body?.error) ?? text(body?.message)) ?? statusCopy(status, write),
      requestId,
      details: body?.details ?? null,
      outcomeUnknown: write && untrusted,
    };
    if (status === 401 && (code === null || code === 'AUTH_REQUIRED') && !isAuthPath(path)) {
      notifyAuthExpired(failure);
    }
    return { ok: false, error: failure };
  }

  const unreadable: ApiResult<T> = {
    ok: false,
    error: { ...interrupted('parse', write, true), status, requestId },
  };
  if (body === null) return unreadable;
  if (!select) return { ok: true, data: body as T, status, requestId };
  try {
    const selected = select(body);
    if (selected === null || selected === undefined) return unreadable;
    return { ok: true, data: selected, status, requestId };
  } catch {
    return unreadable;
  }
}

export async function apiRequest<T = ApiBody>(
  path: string,
  options: ApiRequestOptions<T> = {},
): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET';
  const write = isWrite(method);
  const outer = options.signal ?? null;
  if (outer?.aborted) return { ok: false, error: interrupted('aborted', write, false) };

  let url: string;
  let init: RequestInit;
  try {
    url = joinQuery(path, serializeQuery(options.query));
    init = requestInit(method, options);
  } catch {
    return {
      ok: false,
      error: { ...interrupted('parse', write, false), message: NOT_SENT },
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  outer?.addEventListener('abort', forwardAbort);
  const limit = options.timeoutMs ?? (write ? API_WRITE_TIMEOUT_MS : API_READ_TIMEOUT_MS);
  const timer = Number.isFinite(limit) && limit > 0
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, Math.min(limit, MAX_TIMER_MS))
    : null;
  const interruption = (): ApiFailure =>
    interrupted(outer?.aborted ? 'aborted' : timedOut ? 'timeout' : 'network', write, true);

  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch {
      return { ok: false, error: interruption() };
    }
    let raw: string;
    try {
      raw = await response.text();
    } catch {
      return { ok: false, error: interruption() };
    }
    return settleResponse(path, method, response, raw, options.select);
  } finally {
    if (timer !== null) clearTimeout(timer);
    outer?.removeEventListener('abort', forwardAbort);
  }
}
