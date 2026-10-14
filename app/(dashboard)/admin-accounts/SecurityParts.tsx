'use client';

import { useId, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import {
  Badge, Button, DetailRow, ErrorState, LinkButton, Notice, SkeletonLines, TabPanel, Tabs, type BadgeTone,
} from '../../_ui';
import type { ApiFailure } from '../../lib/apiClient';
import {
  recoveryCodesLeftText, recoveryCodesTone, type DeviceSession, type TwoStepStatus,
} from '../../lib/adminSecurity';
import { formatAge, formatBusinessDateTime } from '../../lib/time';
import { DeviceList } from '../../_security/DeviceList';
import {
  ACTOR_TWO_STEP_FIRST, PROFILE_HREF, PROFILE_TWO_STEP_HREF, actorCanReset, capabilitiesFor, codesLeftLabel, isSelf,
  mfaCellState, policyRequirement,
  type AdminPanel, type AdminRow, type MfaCellState, type SecurityPolicy,
} from './model';
import s from './page.module.css';

export const OWN_ACCOUNT_NOTICE = 'This is your account. Manage your two-step sign-in and devices on your Profile.';
export const INACTIVE_DEVICES = 'No active sessions. Deactivated accounts are signed out everywhere.';
export const NO_DEVICES = 'No signed-in devices.';
export const RESET_HELP = 'Use this when they lost their phone or authenticator app.';
export const SIGN_OUT_EVERYWHERE_HELP = 'Ends every session, on the web and in the mobile app.';
export const STATUS_UNKNOWN = 'Two-step sign-in status could not be loaded. Refresh the list to try again.';

export interface MfaSummary {
  label: string;
  tone: BadgeTone;
}

function subClass(tone: 'neutral' | 'warning' | 'danger'): string {
  return tone === 'danger' ? s.subDanger : tone === 'warning' ? s.subWarning : s.sub;
}

function offTone(state: Extract<MfaCellState, { kind: 'off' }>): 'neutral' | 'warning' | 'danger' {
  return state.due === 'none' ? 'neutral' : state.due === 'grace' ? 'warning' : 'danger';
}

export function mfaSummary(state: MfaCellState): MfaSummary | null {
  switch (state.kind) {
    case 'deleted':
    case 'unknown':
      return null;
    case 'on':
      return { label: 'Two-step on', tone: 'success' };
    case 'locked':
      return { label: 'Two-step locked', tone: 'danger' };
    case 'pending':
      return { label: 'Two-step setup started', tone: 'neutral' };
    case 'off':
      return { label: 'Two-step off', tone: offTone(state) };
  }
}

export function MfaCell({ state }: { state: MfaCellState }) {
  switch (state.kind) {
    case 'deleted':
    case 'unknown':
      return (
        <span className={s.muted}>
          <span aria-hidden>—</span>
          <span className={s.srOnly}>{state.kind === 'deleted' ? 'Not applicable' : 'Not available'}</span>
        </span>
      );
    case 'on':
      return (
        <div className={s.mfaCell}>
          <Badge tone="success">
            <ShieldCheck size={12} aria-hidden />
            On
          </Badge>
          <span className={subClass(recoveryCodesTone(state.codesLeft))}>{codesLeftLabel(state.codesLeft)}</span>
        </div>
      );
    case 'locked':
      return (
        <div className={s.mfaCell}>
          <Badge tone="danger">Locked</Badge>
          <span className={s.subDanger}>{state.until ? `until ${state.until}` : 'for now'}</span>
        </div>
      );
    case 'pending':
      return (
        <div className={s.mfaCell}>
          <Badge tone="neutral">Setup started</Badge>
        </div>
      );
    case 'off':
      if (state.due === 'none') return <span className={s.muted}>Off</span>;
      return (
        <div className={s.mfaCell}>
          <Badge tone={offTone(state)}>Off</Badge>
          <span className={subClass(offTone(state))}>
            {state.due === 'grace' ? `Due ${state.date}` : 'Set up at next sign-in'}
          </span>
        </div>
      );
  }
}

export function MfaBadge({ state }: { state: MfaCellState }) {
  const summary = mfaSummary(state);
  return summary ? <Badge tone={summary.tone}>{summary.label}</Badge> : null;
}

export interface PanelTabsProps {
  id: string;
  value: AdminPanel;
  onChange: (next: AdminPanel) => void;
  sessions: number | null;
}

export function PanelTabs({ id, value, onChange, sessions }: PanelTabsProps) {
  return (
    <div className={s.panelTabs}>
      <Tabs<AdminPanel>
        id={id}
        aria-label="Account sections"
        value={value}
        onChange={onChange}
        items={[
          { value: 'account', label: 'Account' },
          { value: 'security', label: 'Security', count: sessions ? sessions.toLocaleString('en-NG') : undefined },
        ]}
      />
    </div>
  );
}

export interface DrawerPanelsProps {
  id: string;
  panel: AdminPanel;
  onPanelChange?: (next: AdminPanel) => void;
  sessions: number | null;
  security?: ReactNode;
  children: ReactNode;
}

export function DrawerPanels({ id, panel, onPanelChange, sessions, security, children }: DrawerPanelsProps) {
  if (security === undefined || !onPanelChange) return <>{children}</>;
  return (
    <>
      <PanelTabs id={id} value={panel} onChange={onPanelChange} sessions={sessions} />
      <TabPanel tabsId={id} value="account" active={panel === 'account'} keepMounted className={s.tabPanel}>
        {children}
      </TabPanel>
      <TabPanel tabsId={id} value="security" active={panel === 'security'} className={s.tabPanel}>
        {security}
      </TabPanel>
    </>
  );
}

export function drawerPanel(
  panel: AdminPanel,
  security: ReactNode | undefined,
  onPanelChange: ((next: AdminPanel) => void) | undefined,
): AdminPanel {
  return security === undefined || !onPanelChange ? 'account' : panel;
}

export interface DevicesState {
  sessions: readonly DeviceSession[] | undefined;
  error: ApiFailure | null;
  retrying: boolean;
  onRetry: () => void;
}

export interface AdminSecurityPanelProps {
  admin: AdminRow;
  currentAdminId: string | null;
  policy: SecurityPolicy;
  actorTwoStep: TwoStepStatus | null;
  devices: DevicesState | null;
  busy: boolean;
  pendingSessionId: string | null;
  now?: Date;
  resetRef?: Ref<HTMLButtonElement>;
  revokeRef?: Ref<HTMLButtonElement>;
  devicesRef?: Ref<HTMLElement>;
  onResetMfa: () => void;
  onSignOutDevice: (session: DeviceSession, device: string) => void;
  onSignOutEverywhere: () => void;
}

function whenText(value: string | null, now: Date, fallback: string): string {
  if (!value) return fallback;
  return `${formatBusinessDateTime(value)} WAT · ${formatAge(value, now)} ago`;
}

function statusBadge(state: MfaCellState): MfaSummary {
  switch (state.kind) {
    case 'on':
      return { label: 'On', tone: 'success' };
    case 'locked':
      return { label: 'Locked', tone: 'danger' };
    case 'pending':
      return { label: 'Setup started', tone: 'neutral' };
    case 'off':
      return { label: 'Off', tone: offTone(state) };
    default:
      return { label: 'Not available', tone: 'neutral' };
  }
}

function statusNote(state: MfaCellState, policy: SecurityPolicy, now: Date): string | null {
  if (state.kind === 'pending') return 'They started setting it up but did not finish.';
  if (state.kind === 'locked') return 'Too many wrong codes. It unlocks by itself, or a reset clears it.';
  if (state.kind !== 'off' || state.due === 'none') return null;
  const requirement = policyRequirement(policy, now);
  if (requirement.kind === 'grace') return `They have until ${requirement.dateTime} to set it up.`;
  return 'They must set it up the next time they sign in.';
}

export function AdminSecurityPanel({
  admin, currentAdminId, policy, actorTwoStep, devices, busy, pendingSessionId, now, resetRef, revokeRef, devicesRef,
  onResetMfa, onSignOutDevice, onSignOutEverywhere,
}: AdminSecurityPanelProps) {
  const baseId = useId();
  const at = now ?? new Date();
  const twoStepHeading = `${baseId}-two-step`;
  const devicesHeading = `${baseId}-devices`;
  const resetHelp = `${baseId}-reset-help`;

  if (isSelf(admin, currentAdminId)) {
    return (
      <div className={s.details}>
        <Notice
          tone="neutral"
          flush
          actions={<LinkButton href={PROFILE_HREF} variant="secondary" size="sm">Open Profile</LinkButton>}
        >
          {OWN_ACCOUNT_NOTICE}
        </Notice>
      </div>
    );
  }

  const capabilities = capabilitiesFor(admin, currentAdminId);
  const state = mfaCellState(admin, policy, at);
  const security = admin.security;
  const badge = statusBadge(state);
  const note = statusNote(state, policy, at);
  const ready = actorCanReset(actorTwoStep);
  const enrolled = security?.mfaStatus === 'active';

  return (
    <div className={s.details}>
      <section className={s.formSection} aria-labelledby={twoStepHeading}>
        <h3 id={twoStepHeading} className={s.formHeading}>Two-step sign-in</h3>
        {security ? (
          <div className={s.detailRows}>
            <DetailRow label="Status" value={<Badge tone={badge.tone}>{badge.label}</Badge>} />
            {enrolled ? <DetailRow label="On since" value={whenText(security.confirmedAt, at, '—')} /> : null}
            {enrolled ? <DetailRow label="Last code used" value={whenText(security.lastUsedAt, at, 'Not used yet')} /> : null}
            {enrolled ? (
              <DetailRow
                label="Recovery codes"
                value={(
                  <Badge tone={recoveryCodesTone(security.recoveryCodesLeft)}>
                    {recoveryCodesLeftText(security.recoveryCodesLeft)}
                  </Badge>
                )}
              />
            ) : null}
            {state.kind === 'locked' ? <DetailRow label="Locked until" value={state.until ?? 'Not recorded'} /> : null}
          </div>
        ) : (
          <p className={s.formHint}>{STATUS_UNKNOWN}</p>
        )}
        {note ? <p className={s.formHint}>{note}</p> : null}
        {capabilities.resetMfa ? (
          <div className={s.securityAction}>
            <Button
              ref={resetRef}
              type="button"
              variant="dangerSubtle"
              size="sm"
              leftIcon={<KeyRound size={14} aria-hidden />}
              disabled={!ready || busy}
              aria-describedby={resetHelp}
              onClick={onResetMfa}
            >
              Reset two-step sign-in…
            </Button>
            <p id={resetHelp} className={s.actionHint}>
              {ready ? RESET_HELP : (
                <>
                  {ACTOR_TWO_STEP_FIRST}{' '}
                  <Link href={PROFILE_TWO_STEP_HREF} className={s.inlineLink}>Open Profile</Link>
                </>
              )}
            </p>
          </div>
        ) : null}
      </section>

      <section ref={devicesRef} className={s.formSection} aria-labelledby={devicesHeading} tabIndex={-1}>
        <h3 id={devicesHeading} className={s.formHeading}>Signed-in devices</h3>
        {!admin.is_active ? (
          <p className={s.formHint}>{INACTIVE_DEVICES}</p>
        ) : !devices ? null : devices.sessions === undefined ? (
          devices.error ? (
            <ErrorState
              compact
              title="Signed-in devices could not be loaded"
              message={devices.error.message}
              requestId={devices.error.requestId}
              onRetry={devices.onRetry}
              retrying={devices.retrying}
            />
          ) : (
            <div aria-busy="true">
              <span className={s.srOnly} role="status">Loading signed-in devices…</span>
              <SkeletonLines rows={4} />
            </div>
          )
        ) : (
          <>
            {devices.error ? (
              <Notice
                tone="warning"
                compact
                flush
                announce="polite"
                actions={<Button variant="ghost" size="sm" onClick={devices.onRetry}>Try again</Button>}
              >
                The list could not be refreshed. {devices.error.message}
              </Notice>
            ) : null}
            <DeviceList
              sessions={devices.sessions}
              now={at}
              onSignOut={onSignOutDevice}
              pendingId={pendingSessionId}
              disabled={busy}
              emptyText={NO_DEVICES}
            />
          </>
        )}
        {capabilities.revoke ? (
          <div className={s.securityAction}>
            <Button
              ref={revokeRef}
              type="button"
              variant="dangerSubtle"
              size="sm"
              leftIcon={<LogOut size={14} aria-hidden />}
              disabled={busy}
              onClick={onSignOutEverywhere}
            >
              Sign out everywhere…
            </Button>
            <p className={s.actionHint}>{SIGN_OUT_EVERYWHERE_HELP}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
