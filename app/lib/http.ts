export type ApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'REAUTH_REQUIRED'
  | 'MFA_REQUIRED'
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
  REAUTH_REQUIRED: 403,
  MFA_REQUIRED: 403,
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
  REAUTH_REQUIRED: 'Confirm it is you to continue.',
  MFA_REQUIRED: 'Set up two-step sign-in first.',
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

export const MFA_LOCKED_REASON = 'mfa_locked';
export const STEP_ENDED_REASON = 'challenge_expired';

const WAT_OFFSET_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function instantOf(value: unknown): number {
  if (typeof value === 'string') return Date.parse(value);
  if (value instanceof Date) return value.getTime();
  return Number.NaN;
}

export function twoStepUnlockText(lockedUntil: unknown, nowMs: number = Date.now()): string | null {
  const until = instantOf(lockedUntil);
  if (!Number.isFinite(until) || !Number.isFinite(nowMs)) return null;
  const at = new Date(Math.ceil(until / MINUTE_MS) * MINUTE_MS + WAT_OFFSET_MS);
  const today = new Date(nowMs + WAT_OFFSET_MS);
  const time = `${pad2(at.getUTCHours())}:${pad2(at.getUTCMinutes())} WAT`;
  const sameDay = at.getUTCFullYear() === today.getUTCFullYear()
    && at.getUTCMonth() === today.getUTCMonth()
    && at.getUTCDate() === today.getUTCDate();
  return sameDay ? time : `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}, ${time}`;
}

export function twoStepLockedMessage(lockedUntil: unknown, nowMs: number = Date.now()): string {
  const when = twoStepUnlockText(lockedUntil, nowMs);
  return when
    ? `Too many wrong codes. Two-step sign-in is locked until ${when}. Your super administrators have been alerted.`
    : 'Too many wrong codes. Two-step sign-in is locked for now. Try again later. Your super administrators have been alerted.';
}

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
