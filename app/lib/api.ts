import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import {
  ERROR_MESSAGE,
  ERROR_STATUS,
  newRequestId,
  type ApiErrorCode,
  type Pagination,
} from './http';

export {
  buildPagination,
  clientIpFrom,
  isUuid,
  newRequestId,
  parsePageParams,
  ERROR_MESSAGE,
  ERROR_STATUS,
} from './http';
export type { ApiErrorCode, Pagination, PageParams } from './http';

export async function requestId(): Promise<string> {
  try {
    const h = await headers();
    return h.get('x-request-id') || newRequestId();
  } catch {
    return newRequestId();
  }
}

export interface OkInit {
  status?: number;
  pagination?: Pagination;
  headers?: Record<string, string>;
}

export async function ok<T extends Record<string, unknown>>(
  payload?: T,
  init?: OkInit,
): Promise<NextResponse> {
  const rid = await requestId();
  const body: Record<string, unknown> = {
    success: true,
    request_id: rid,
    ...(payload || {}),
  };
  if (init?.pagination) body.pagination = init.pagination;
  const res = NextResponse.json(body, { status: init?.status ?? 200 });
  res.headers.set('x-request-id', rid);
  if (init?.headers) for (const [k, v] of Object.entries(init.headers)) res.headers.set(k, v);
  return res;
}

export interface FailInit {
  status?: number;
  details?: unknown;
  headers?: Record<string, string>;
}

export async function fail(
  code: ApiErrorCode,
  message?: string,
  init?: FailInit,
): Promise<NextResponse> {
  const rid = await requestId();
  const text = message || ERROR_MESSAGE[code];
  const body: Record<string, unknown> = {
    success: false,
    error: text,
    code,
    message: text,
    request_id: rid,
  };
  if (init?.details !== undefined) body.details = init.details;
  const res = NextResponse.json(body, { status: init?.status ?? ERROR_STATUS[code] });
  res.headers.set('x-request-id', rid);
  if (init?.headers) for (const [k, v] of Object.entries(init.headers)) res.headers.set(k, v);
  return res;
}
