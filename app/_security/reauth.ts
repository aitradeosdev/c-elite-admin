import { apiRequest, type ApiFailure } from '../lib/apiClient';
import { securityFailureText } from '../lib/adminSecurity';

export type CredentialKind = 'otp' | 'password';

export const REAUTH_PATH = '/api/account/reauth';
export const REAUTH_UNAVAILABLE = 'Your identity cannot be checked right now. Try again in a few minutes.';

export interface ReauthResult {
  reauthAt: string | null;
  validForSecs: number | null;
}

export class SecurityRequestError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure, fallback: string) {
    super(securityFailureText(failure, fallback));
    this.name = 'SecurityRequestError';
    this.failure = failure;
  }
}

export function reauthBody(kind: CredentialKind, value: string): Record<string, string> {
  return kind === 'otp' ? { otp: value } : { password: value };
}

export async function reauthenticate(
  kind: CredentialKind,
  value: string,
  signal?: AbortSignal | null,
): Promise<ReauthResult> {
  const result = await apiRequest(REAUTH_PATH, { method: 'POST', body: reauthBody(kind, value), signal });
  if (!result.ok) throw new SecurityRequestError(result.error, REAUTH_UNAVAILABLE);
  const at = result.data.reauth_at;
  const valid = result.data.valid_for_secs;
  return {
    reauthAt: typeof at === 'string' ? at : null,
    validForSecs: typeof valid === 'number' && Number.isFinite(valid) ? valid : null,
  };
}
