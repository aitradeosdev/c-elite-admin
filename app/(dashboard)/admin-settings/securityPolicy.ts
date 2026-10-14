import type { ApiBody, ApiResult } from '../../lib/apiClient';
import { isUuid } from '../../lib/http';
import { graceText, toTwoStepStatus, type GraceText, type TwoStepStatus } from '../../lib/adminSecurity';
import { STEP_UP_MESSAGE, stepUpCode } from './model';

export const POLICY_ENDPOINT = '/api/admin-settings/security-policy';
export const POLICY_CARD_ID = 'admin-two-step';
export const POLICY_RESOURCE_KEY = 'admin-security-policy';
export const PROFILE_TWO_STEP_HREF = '/profile#two-step-sign-in';
export const GRACE_DAYS = 14;
export const REASON_MIN_LENGTH = 3;
export const REASON_TOO_SHORT = `Give a reason of at least ${REASON_MIN_LENGTH} characters.`;

export const POLICY_TITLE = 'Two-step sign-in for admins';
export const POLICY_SUBTITLE =
  'Require an authenticator app code at every admin sign-in, on the web console and in the CardElite Admin app.';
export const ACTOR_FIRST_HELP = 'Set up two-step sign-in on your Profile first. You confirm this change with a code from your app.';
export const KEY_MISSING_HELP = 'The two-step key is not configured on the server.';
export const TURN_ON_LABEL = 'Require for all admins…';
export const TURN_OFF_LABEL = 'Stop requiring it…';

const DAY_MS = 24 * 60 * 60 * 1000;
const MISSING_SHOWN = 3;

export type PolicyMode = 'off' | 'all';
export type PolicyPhase = 'off' | 'grace' | 'required';
export type PolicyBlocker = 'two_step' | 'key';
export type PolicyTone = 'neutral' | 'warning' | 'success';

export interface RosterAdmin {
  id: string;
  username: string;
}

export interface PolicyRoster {
  active: number;
  enrolled: number;
  missing: RosterAdmin[];
}

export interface PolicyState {
  mode: PolicyMode;
  graceEndsAt: string | null;
  requiredNow: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  keyConfigured: boolean;
  actorTwoStep: TwoStepStatus;
  roster: PolicyRoster;
}

export interface PolicyView {
  phase: PolicyPhase;
  statusLabel: string;
  statusTone: PolicyTone;
  grace: GraceText | null;
  action: 'on' | 'off';
  actionLabel: string;
  blocker: PolicyBlocker | null;
}

export interface PolicyChange {
  changed: boolean;
  mode: PolicyMode;
  graceEndsAt: string | null;
  auditRecorded: boolean;
  warning: string | null;
}

export type PolicyOutcome =
  | { kind: 'done'; change: PolicyChange }
  | { kind: 'refused'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'reauth'; code: 'REAUTH_REQUIRED' | 'MFA_REQUIRED'; message: string }
  | { kind: 'denied'; message: string }
  | { kind: 'expired' }
  | { kind: 'unknown'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toRosterAdmin(raw: unknown): RosterAdmin | null {
  if (!isRecord(raw) || !isUuid(raw.id)) return null;
  return { id: raw.id.toLowerCase(), username: typeof raw.username === 'string' ? raw.username : '' };
}

export function toPolicyState(body: ApiBody): PolicyState | null {
  const mode = body.mfa_mode;
  if (mode !== 'off' && mode !== 'all') return null;
  const roster = isRecord(body.roster) ? body.roster : null;
  if (!roster) return null;
  const missing = Array.isArray(roster.missing)
    ? roster.missing.map(toRosterAdmin).filter((admin): admin is RosterAdmin => admin !== null)
    : [];
  return {
    mode,
    graceEndsAt: mode === 'all' ? text(body.mfa_grace_ends_at) : null,
    requiredNow: mode === 'all' && body.mfa_required_now === true,
    updatedAt: text(body.updated_at),
    updatedBy: isUuid(body.updated_by) ? body.updated_by.toLowerCase() : null,
    keyConfigured: body.key_configured === true,
    actorTwoStep: toTwoStepStatus(body.actor_mfa_status),
    roster: { active: count(roster.active), enrolled: count(roster.enrolled), missing },
  };
}

export function policyView(state: PolicyState, now: Date = new Date()): PolicyView {
  const grace = state.mode === 'all' ? graceText(state.graceEndsAt, now) : null;
  const phase: PolicyPhase = state.mode === 'off'
    ? 'off'
    : state.requiredNow || !grace || grace.overdue ? 'required' : 'grace';
  const action = state.mode === 'off' ? 'on' : 'off';
  const blocker: PolicyBlocker | null = state.actorTwoStep !== 'active'
    ? 'two_step'
    : action === 'on' && !state.keyConfigured ? 'key' : null;
  return {
    phase,
    statusLabel: phase === 'off' ? 'Not required' : phase === 'grace' && grace ? `Required from ${grace.shortDate}` : 'Required',
    statusTone: phase === 'off' ? 'neutral' : phase === 'grace' ? 'warning' : 'success',
    grace,
    action,
    actionLabel: action === 'on' ? TURN_ON_LABEL : TURN_OFF_LABEL,
    blocker,
  };
}

export function blockerText(blocker: PolicyBlocker): string {
  return blocker === 'two_step' ? ACTOR_FIRST_HELP : KEY_MISSING_HELP;
}

export function rosterText(roster: PolicyRoster): string {
  if (roster.active === 0) return 'There are no active admins.';
  if (roster.enrolled >= roster.active) {
    return roster.active === 1 ? 'The only active admin uses it.' : `All ${roster.active} active admins use it.`;
  }
  return `${roster.enrolled} of ${roster.active} active ${roster.active === 1 ? 'admin uses' : 'admins use'} it.`;
}

export function rosterHref(id: string): string {
  return `/admin-accounts?id=${encodeURIComponent(id)}&panel=security`;
}

export function handleOf(admin: RosterAdmin): string {
  const name = admin.username.trim();
  return name ? `@${name}` : 'an admin';
}

export function missingSummary(missing: readonly RosterAdmin[]): string {
  if (missing.length === 0) return 'None';
  const names = missing.slice(0, MISSING_SHOWN).map(handleOf).join(', ');
  const more = missing.length > MISSING_SHOWN ? ` +${missing.length - MISSING_SHOWN} more` : '';
  return `${missing.length} (${names}${more})`;
}

export function graceEndFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + GRACE_DAYS * DAY_MS);
}

export function reasonProblem(reason: string): string | null {
  return Array.from(reason.trim()).length < REASON_MIN_LENGTH ? REASON_TOO_SHORT : null;
}

export function policyPayload(mode: PolicyMode, reason: string): { mfa_mode: PolicyMode; reason: string } {
  return { mfa_mode: mode, reason: reason.trim() };
}

export function toPolicyChange(body: ApiBody): PolicyChange | null {
  const mode = body.mfa_mode;
  if (typeof body.changed !== 'boolean' || (mode !== 'off' && mode !== 'all')) return null;
  return {
    changed: body.changed,
    mode,
    graceEndsAt: text(body.mfa_grace_ends_at),
    auditRecorded: body.audit_recorded !== false,
    warning: text(body.warning),
  };
}

export function classifyPolicyChange(result: ApiResult<PolicyChange>): PolicyOutcome {
  if (result.ok) return { kind: 'done', change: result.data };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown || failure.kind !== 'http') return { kind: 'unknown', message: failure.message };
  const stepUp = stepUpCode(failure);
  if (stepUp) return { kind: 'reauth', code: stepUp, message: STEP_UP_MESSAGE[stepUp] };
  if (failure.status === 403) return { kind: 'denied', message: failure.message };
  if (failure.status === 409) return { kind: 'conflict', message: failure.message };
  return { kind: 'refused', message: failure.message };
}

export function policyChangedText(change: PolicyChange, now: Date = new Date()): string {
  if (change.mode === 'off') return 'Two-step sign-in is no longer required. Admins who use it keep it.';
  const grace = graceText(change.graceEndsAt, now);
  return grace
    ? `Two-step sign-in is now required. Admins without it have until ${grace.dateTime} to set it up.`
    : 'Two-step sign-in is now required for every admin.';
}

export function policyUnchangedText(mode: PolicyMode): string {
  return mode === 'all'
    ? 'Two-step sign-in was already required. Nothing changed.'
    : 'Two-step sign-in was already not required. Nothing changed.';
}
