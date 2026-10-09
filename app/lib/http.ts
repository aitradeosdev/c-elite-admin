export type ApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'STATE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PROVIDER_ERROR'
  | 'OPERATION_IN_PROGRESS'
  | 'RATE_LIMITED'
  | 'AUDIT_FAILED'
  | 'INTERNAL_ERROR';

export const ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  PERMISSION_DENIED: 403,
  RESOURCE_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  STATE_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PROVIDER_ERROR: 502,
  OPERATION_IN_PROGRESS: 409,
  RATE_LIMITED: 429,
  AUDIT_FAILED: 500,
  INTERNAL_ERROR: 500,
};

export const ERROR_MESSAGE: Readonly<Record<ApiErrorCode, string>> = {
  AUTH_REQUIRED: 'Your session has expired. Sign in again.',
  PERMISSION_DENIED: 'You do not have permission to do this.',
  RESOURCE_NOT_FOUND: 'That record could not be found.',
  VALIDATION_ERROR: 'The request was not valid.',
  STATE_CONFLICT: 'That record has changed. Reload and try again.',
  IDEMPOTENCY_CONFLICT: 'This operation has already been submitted.',
  PROVIDER_ERROR: 'The payment provider could not be reached.',
  OPERATION_IN_PROGRESS: 'This operation is already running.',
  RATE_LIMITED: 'Too many requests. Try again shortly.',
  AUDIT_FAILED: 'The action was blocked because it could not be recorded.',
  INTERNAL_ERROR: 'Something went wrong on our side.',
};

export interface Pagination {
  page: number;
  page_size: number;
  total: number | null;
  total_pages: number | null;
  has_more: boolean;
}

export function buildPagination(page: number, pageSize: number, total: number | null): Pagination {
  const safeSize = Math.max(1, Math.floor(pageSize) || 1);
  const safePage = Math.max(1, Math.floor(page) || 1);
  const totalPages = total === null ? null : Math.max(1, Math.ceil(total / safeSize));
  return {
    page: safePage,
    page_size: safeSize,
    total,
    total_pages: totalPages,
    has_more: total === null ? false : safePage * safeSize < total,
  };
}

export function newRequestId(): string {
  return 'req_' + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export interface PageParams {
  page: number;
  pageSize: number;
  from: number;
  to: number;
}

export function parsePageParams(
  url: URL,
  opts?: { defaultSize?: number; maxSize?: number },
): PageParams {
  const defaultSize = opts?.defaultSize ?? 50;
  const maxSize = opts?.maxSize ?? 200;
  const rawPage = Number(url.searchParams.get('page') || '1');
  const rawSize = Number(url.searchParams.get('page_size') || String(defaultSize));
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize >= 1
    ? Math.min(Math.floor(rawSize), maxSize)
    : defaultSize;
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function clientIpFrom(get: (name: string) => string | null): string {
  const xff = get('x-forwarded-for') || '';
  const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || get('x-real-ip') || 'unknown';
}
