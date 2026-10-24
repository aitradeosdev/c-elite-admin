import { ERROR_MESSAGE, type ApiErrorCode } from '../../../lib/http';
import { REASON_MAX, REASON_MESSAGE, REASON_MIN } from '../../../lib/roles';
import { formatNaira } from '../../../_ui/money';
import type { EdgeAnswer } from '../../../lib/edge';

export const DELETE_EDGE_FUNCTION = 'admin-delete-account';
export const DELETE_EDGE_TIMEOUT_MS = 50000;
export const DELETE_REQUEST_TIMEOUT_MS = 65000;
export const REQUEST_EMAIL_MAX = 254;

export const DELETE_TEXT = {
  body: 'Send the deletion as a JSON object.',
  email: 'Confirm the email address the request came from.',
  webOnly: 'Accounts can only be deleted in the web console.',
  notSetUp: 'Deleting accounts is not set up on the server, so nothing was changed.',
  refused: 'The deletion service refused this request, so nothing was changed.',
  notChecked: 'The server could not check this deletion, so nothing was changed. Try again.',
  notFound: 'User not found.',
  emailMismatch:
    'The email address on this account is not the one you confirmed, so nothing was changed. Reload the page and check the request again.',
  walletNotEmpty: 'The wallet is not at ₦0. An account can only be deleted when its wallet is at ₦0, so nothing was changed.',
  inFlight:
    'A gift card trade, withdrawal or bill payment on this account is still in progress, so nothing was changed. Try again once it has finished.',
  alreadyDeleted: 'This account’s deletion has already finished, so nothing was changed.',
  rateLimited: 'You can delete at most 10 accounts an hour, so nothing was changed. Try again later.',
  signInLeft: 'The account was deleted, but its sign-in could not be removed. Try again to finish the deletion.',
  filesLeft: 'The account was deleted, but some of its stored files could not be removed.',
  unknown: 'No answer came back, so the account may or may not have been deleted. Reload the page to see its current state.',
} as const;

export interface DeleteRequest {
  reason: string;
  requestEmail: string | null;
}

export type DeleteRequestCheck =
  | { ok: true; request: DeleteRequest }
  | { ok: false; message: string };

export type DeleteReply =
  | { ok: true; resumed: boolean; warning: string | null }
  | { ok: false; code: ApiErrorCode; message: string; details: Record<string, unknown> | null };

const UNKNOWN: DeleteReply = { ok: false, code: 'INTERNAL_ERROR', message: DELETE_TEXT.unknown, details: { outcome_unknown: true } };

const SESSION_CODES: ReadonlySet<string> = new Set(['no_token', 'bad_token', 'inactive', 'token_revoked', 'session_ended']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function refusal(code: ApiErrorCode, message: string, details: Record<string, unknown> | null = null): DeleteReply {
  return { ok: false, code, message, details };
}

export function deleteAccountPath(id: string): string {
  return `/api/users/${encodeURIComponent(id)}/delete`;
}

export function walletHeld(balance: number): string {
  return `The wallet holds ${formatNaira(balance)}. An account can only be deleted when its wallet is at ₦0, so nothing was changed.`;
}

export function readDeleteRequest(body: unknown): DeleteRequestCheck {
  const value = record(body);
  if (!value) return { ok: false, message: DELETE_TEXT.body };
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const length = Array.from(reason).length;
  if (length < REASON_MIN || length > REASON_MAX) return { ok: false, message: REASON_MESSAGE };
  if (value.request_email === undefined) return { ok: true, request: { reason, requestEmail: null } };
  const requestEmail = typeof value.request_email === 'string' ? value.request_email.trim() : '';
  if (!requestEmail || requestEmail.length > REQUEST_EMAIL_MAX) return { ok: false, message: DELETE_TEXT.email };
  return { ok: true, request: { reason, requestEmail } };
}

export function readEdgeAnswer(answer: EdgeAnswer): DeleteReply {
  if (answer.kind === 'failed') return UNKNOWN;
  const body = record(answer.body);
  const code = typeof body?.code === 'string' ? body.code : '';
  if (answer.status === 200) {
    if (body?.success !== true || code !== 'deleted' || typeof body.resumed !== 'boolean' || typeof body.files_removed !== 'boolean') {
      return UNKNOWN;
    }
    return { ok: true, resumed: body.resumed, warning: body.files_removed ? null : DELETE_TEXT.filesLeft };
  }
  if (SESSION_CODES.has(code)) return refusal('AUTH_REQUIRED', ERROR_MESSAGE.AUTH_REQUIRED);
  switch (code) {
    case 'reason_required':
      return refusal('VALIDATION_ERROR', REASON_MESSAGE, { field: 'reason' });
    case 'not_found':
      return refusal('RESOURCE_NOT_FOUND', DELETE_TEXT.notFound);
    case 'email_mismatch':
      return refusal('STATE_CONFLICT', DELETE_TEXT.emailMismatch, { reason: code });
    case 'wallet_balance': {
      const balance = typeof body?.balance === 'number' && Number.isFinite(body.balance) ? body.balance : null;
      return balance === null
        ? refusal('STATE_CONFLICT', DELETE_TEXT.walletNotEmpty, { reason: code })
        : refusal('STATE_CONFLICT', walletHeld(balance), { reason: code, balance });
    }
    case 'in_flight':
      return refusal('STATE_CONFLICT', DELETE_TEXT.inFlight, { reason: code });
    case 'already_deleted':
      return refusal('STATE_CONFLICT', DELETE_TEXT.alreadyDeleted, { reason: code });
    case 'forbidden':
      return refusal('PERMISSION_DENIED', ERROR_MESSAGE.PERMISSION_DENIED, { required: ['users.delete'] });
    case 'wrong_client':
      return refusal('PERMISSION_DENIED', DELETE_TEXT.webOnly);
    case 'rate_limited':
      return refusal('RATE_LIMITED', DELETE_TEXT.rateLimited);
    case 'not_authorized':
      return refusal('PROVIDER_ERROR', DELETE_TEXT.notSetUp);
    case 'lookup_failed':
    case 'db_error':
      return refusal('INTERNAL_ERROR', DELETE_TEXT.notChecked);
    case 'auth_not_removed':
      return refusal('INTERNAL_ERROR', DELETE_TEXT.signInLeft);
  }
  if (answer.status >= 400 && answer.status < 500) return refusal('PROVIDER_ERROR', DELETE_TEXT.refused);
  return UNKNOWN;
}
