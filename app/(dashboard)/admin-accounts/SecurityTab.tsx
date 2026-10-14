'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm, useResource, useToast } from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { toDeviceSessions, type DeviceSession, type TwoStepStatus } from '../../lib/adminSecurity';
import {
  adminSessionPath, adminSessionsPath, classifyMutation, isSelf, toDeviceSignOut,
  type AdminRow, type DeviceSignOut, type MutationOutcome, type SecurityPolicy,
} from './model';
import { deviceSignOutConfirm, deviceSignOutSuccess } from './confirmOptions';
import { AdminSecurityPanel } from './SecurityParts';

export const DEVICE_ALREADY_ENDED = 'That session had already ended, so nothing changed.';
export const DEVICE_AUDIT_WARNING = 'The device was signed out, but the change could not be written to the audit log.';

export type FocusTarget = () => HTMLElement | null;

export interface AdminSecurityTabProps {
  admin: AdminRow;
  currentAdminId: string | null;
  policy: SecurityPolicy;
  actorTwoStep: TwoStepStatus | null;
  busy: boolean;
  revision: number;
  onResetMfa: (admin: AdminRow, returnFocusTo: FocusTarget) => void;
  onSignOutEverywhere: (admin: AdminRow, returnFocusTo: FocusTarget) => void;
  onChanged: () => void;
}

export function AdminSecurityTab({
  admin, currentAdminId, policy, actorTwoStep, busy, revision, onResetMfa, onSignOutEverywhere, onChanged,
}: AdminSecurityTabProps) {
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const aliveRef = useRef(true);
  const resetRef = useRef<HTMLButtonElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const devicesRef = useRef<HTMLElement>(null);

  const listable = !isSelf(admin, currentAdminId) && !admin.deleted_at && admin.is_active;
  const sessions = useResource<DeviceSession[]>(
    listable ? `admin-sessions:${admin.id}:${revision}` : null,
    (signal) => apiRequest(adminSessionsPath(admin.id), { signal, select: toDeviceSessions }),
  );
  const { refresh: refreshSessions } = sessions;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const focusOr = useCallback((preferred: { current: HTMLElement | null }): FocusTarget => () => {
    const element = preferred.current;
    if (element && element.isConnected && !element.matches(':disabled')) return element;
    return devicesRef.current;
  }, []);

  const report = (device: string, outcome: MutationOutcome<DeviceSignOut>) => {
    switch (outcome.kind) {
      case 'done':
        if (outcome.result.revoked) {
          notify(deviceSignOutSuccess(admin, device), 'success');
          if (!outcome.result.auditRecorded) notify(outcome.result.warning ?? DEVICE_AUDIT_WARNING, 'warning');
        } else {
          notify(DEVICE_ALREADY_ENDED);
        }
        return;
      case 'unknown':
        notify(outcome.message, 'error');
        return;
      case 'stale':
      case 'reauth':
        notify(outcome.message, 'warning');
        return;
      case 'refused':
        notify(outcome.message, 'error');
        router.refresh();
        return;
      case 'expired':
        return;
    }
  };

  const signOutDevice = async (session: DeviceSession, device: string) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingId(session.id);
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const origin = active instanceof HTMLElement && active !== document.body ? active : null;
    let sent = false;
    try {
      const decision = await confirm<MutationOutcome<DeviceSignOut>>({
        ...deviceSignOutConfirm(admin, session, device),
        action: async ({ reason }) => {
          sent = true;
          const attempt = classifyMutation(await apiRequest(adminSessionPath(admin.id, session.id), {
            method: 'DELETE',
            body: { reason },
            select: toDeviceSignOut,
          }));
          if (attempt.kind === 'retry') throw new Error(attempt.message);
          if (attempt.kind === 'reauth' && attempt.code === 'REAUTH_REQUIRED') throw new Error(attempt.message);
          if (attempt.kind !== 'expired') await refreshSessions({ background: true });
          return attempt;
        },
        returnFocusTo: () => (origin && origin.isConnected ? origin : devicesRef.current),
      });
      if (decision?.value && aliveRef.current) report(device, decision.value);
    } finally {
      pendingRef.current = false;
      if (aliveRef.current) setPendingId(null);
      if (sent) onChanged();
    }
  };

  return (
    <AdminSecurityPanel
      admin={admin}
      currentAdminId={currentAdminId}
      policy={policy}
      actorTwoStep={actorTwoStep}
      devices={listable ? {
        sessions: sessions.data,
        error: sessions.error,
        retrying: sessions.isInitialLoading || sessions.isRefreshing,
        onRetry: () => void refreshSessions(),
      } : null}
      busy={busy || pendingId !== null}
      pendingSessionId={pendingId}
      resetRef={resetRef}
      revokeRef={revokeRef}
      devicesRef={devicesRef}
      onResetMfa={() => onResetMfa(admin, focusOr(resetRef))}
      onSignOutDevice={(session, device) => void signOutDevice(session, device)}
      onSignOutEverywhere={() => onSignOutEverywhere(admin, focusOr(revokeRef))}
    />
  );
}
