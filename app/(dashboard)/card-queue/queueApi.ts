import { apiRequest, type ApiBody, type ApiFailure, type ApiResult } from '../../lib/apiClient';
import type {
  CardTypeOption, CorrectionPayload, Decision, QueueCounts, QueueRow, Submission,
} from './queueModel';

export interface QueueListResult {
  rows: QueueRow[];
  total: number;
  counts: QueueCounts;
  searchTruncated: boolean;
}

export interface SubmissionResult {
  submission: Submission;
  approvalLimit: number | null;
}

export interface DecisionRequest extends CorrectionPayload {
  action: Decision;
  reason?: string;
}

export interface DecisionResult {
  status: string | null;
  credited: number | null;
  warning: string | null;
}

export type DecisionFailureKind = 'signedOut' | 'denied' | 'changed' | 'refused';

export function decisionFailureKind(failure: ApiFailure): DecisionFailureKind {
  if (failure.status === 401) return 'signedOut';
  if (failure.status === 403) return 'denied';
  if (failure.outcomeUnknown || failure.status === 404 || failure.status === 409) return 'changed';
  return 'refused';
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value: unknown): ApiBody | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ApiBody) : null;
}

export function toQueueList(body: ApiBody): QueueListResult | null {
  if (!Array.isArray(body.submissions)) return null;
  const counts = record(body.counts) ?? {};
  return {
    rows: body.submissions as QueueRow[],
    total: count(body.total) ?? 0,
    counts: { pending: count(counts.pending), disputed: count(counts.disputed) },
    searchTruncated: body.search_truncated === true,
  };
}

export function toSubmissionResult(body: ApiBody): SubmissionResult | null {
  const raw = record(body.submission);
  if (!raw) return null;
  const submission = raw as unknown as Submission;
  return {
    submission: {
      ...submission,
      card_images: Array.isArray(submission.card_images) ? submission.card_images : [],
      dispute_images: Array.isArray(submission.dispute_images) ? submission.dispute_images : [],
      card_types_for_card: Array.isArray(submission.card_types_for_card)
        ? submission.card_types_for_card.map((t: CardTypeOption) => ({
            ...t,
            denominations: Array.isArray(t.denominations) ? t.denominations : [],
          }))
        : [],
      field_labels: submission.field_labels && typeof submission.field_labels === 'object' ? submission.field_labels : {},
      currency_symbol: text(submission.currency_symbol),
    },
    approvalLimit: count(body.approval_limit_naira),
  };
}

export function toDecisionResult(body: ApiBody): DecisionResult {
  return {
    status: text(body.status),
    credited: count(body.credited),
    warning: text(body.warning),
  };
}

export function fetchQueue(params: string, signal: AbortSignal): Promise<ApiResult<QueueListResult>> {
  return apiRequest('/api/card-queue', { query: new URLSearchParams(params), signal, select: toQueueList });
}

export function fetchSubmission(id: string, signal: AbortSignal): Promise<ApiResult<SubmissionResult>> {
  return apiRequest('/api/card-queue', { query: { id }, signal, select: toSubmissionResult });
}

export function postDecision(
  payload: DecisionRequest & { submission_id: string },
): Promise<ApiResult<DecisionResult>> {
  return apiRequest('/api/card-queue', { method: 'POST', body: payload, select: toDecisionResult });
}
