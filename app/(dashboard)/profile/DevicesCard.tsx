'use client';

import { useCallback, useEffect, useId, useRef, type Ref } from 'react';
import {
  Button, Card, CardBody, CardFooter, CardHeader, ErrorState, SkeletonLines, notifySessionExpired, useConfirm,
  useResource, useToast,
} from '../../_ui';
import { apiRequest, type ApiFailure } from '../../lib/apiClient';
import { toDeviceSessions, type DeviceSession } from '../../lib/adminSecurity';
import { DeviceList } from '../../_security/DeviceList';
import { signOutDevice, signOutOtherDevices } from './securityActions';
import {
  DEVICES_ANCHOR, DEVICES_LOAD_FAILED, DEVICES_POLL_MS, DEVICES_SUBTITLE, DEVICES_TITLE, SESSIONS_PATH,
  SIGN_OUT_EVERYWHERE_HELP, SIGN_OUT_EVERYWHERE_LABEL, SIGN_OUT_LABEL, SIGN_OUT_OTHERS_LABEL,
  deviceSignOutConfirm, deviceSignedOutText, hasThisDevice, otherDeviceCount, othersSignOutConfirm,
  othersSignedOutText,
  type DeviceSignOut, type OthersSignOut,
} from './securityModel';
import { useSignOutEverywhere } from './signOut';
import { useHashFocus } from './useHashFocus';
import type { ProfileAccount } from './model';
import p from './page.module.css';
import s from './security.module.css';

export interface DevicesPanelProps {
  sessions: readonly DeviceSession[] | null;
  failure: ApiFailure | null;
  retrying: boolean;
  now?: Date;
  headingRef?: Ref<HTMLHeadingElement>;
  everywhereRef?: Ref<HTMLButtonElement>;
  onRetry: () => void;
  onSignOut: (session: DeviceSession, deviceLabel: string) => void;
  onSignOutOthers: () => void;
  onSignOutEverywhere: () => void;
}

export function DevicesPanel({
  sessions, failure, retrying, now, headingRef, everywhereRef, onRetry, onSignOut, onSignOutOthers, onSignOutEverywhere,
}: DevicesPanelProps) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const helpId = `${baseId}-everywhere`;
  const others = sessions ? otherDeviceCount(sessions) : 0;

  return (
    <Card id={DEVICES_ANCHOR} role="region" aria-labelledby={headingId} className={s.section}>
      <CardHeader
        className={s.headerWrap}
        title={(
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className={[p.sectionHeading, s.heading].join(' ')}>
            {DEVICES_TITLE}
          </h2>
        )}
        subtitle={DEVICES_SUBTITLE}
        actions={others > 0 ? (
          <Button type="button" size="sm" variant="secondary" onClick={onSignOutOthers}>
            {SIGN_OUT_OTHERS_LABEL}
          </Button>
        ) : undefined}
      />
      <CardBody aria-busy={sessions || failure ? undefined : true}>
        {sessions ? (
          <DeviceList sessions={sessions} now={now} onSignOut={onSignOut} signOutText={SIGN_OUT_LABEL} />
        ) : failure ? (
          <ErrorState
            compact
            title={DEVICES_LOAD_FAILED}
            message={failure.message}
            requestId={failure.requestId}
            onRetry={onRetry}
            retrying={retrying}
          />
        ) : (
          <SkeletonLines rows={3} />
        )}
      </CardBody>
      <CardFooter className={s.footerWrap}>
        <p id={helpId} className={s.footerHelp}>{SIGN_OUT_EVERYWHERE_HELP}</p>
        <Button
          ref={everywhereRef}
          type="button"
          variant="dangerSubtle"
          aria-describedby={helpId}
          onClick={onSignOutEverywhere}
        >
          {SIGN_OUT_EVERYWHERE_LABEL}
        </Button>
      </CardFooter>
    </Card>
  );
}

export interface DevicesCardProps {
  account: ProfileAccount;
  version?: number;
}

export function DevicesCard({ account, version = 0 }: DevicesCardProps) {
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const signOutEverywhere = useSignOutEverywhere(account.username);
  const devices = useResource<DeviceSession[]>(
    `profile-devices:${version}`,
    (signal) => apiRequest(SESSIONS_PATH, { signal, select: toDeviceSessions }),
    { pollMs: DEVICES_POLL_MS },
  );
  const { refresh, mutate } = devices;
  const sessions = devices.data ?? null;
  const busy = useRef(false);
  const alive = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const everywhereRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useHashFocus(DEVICES_ANCHOR, devices.data !== undefined || devices.error !== null, headingRef);

  const focusHeading = useCallback(() => headingRef.current, []);

  const keepFocus = useCallback(() => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) headingRef.current?.focus({ preventScroll: true });
    }, 0);
  }, []);

  const signOutOne = useCallback(async (session: DeviceSession, deviceLabel: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const decision = await confirm<DeviceSignOut>({
        ...deviceSignOutConfirm(session, deviceLabel),
        returnFocusTo: focusHeading,
        action: () => signOutDevice(session.id),
      });
      if (!alive.current || !decision?.value) return;
      const outcome = decision.value;
      mutate((list) => list?.filter((item) => item.id !== session.id));
      keepFocus();
      notify(deviceSignedOutText(deviceLabel, outcome.revoked), outcome.revoked ? 'success' : 'default');
      if (outcome.warning) notify(outcome.warning, 'warning');
      void refresh({ background: true });
    } finally {
      busy.current = false;
    }
  }, [confirm, focusHeading, keepFocus, mutate, notify, refresh]);

  const signOutOthers = useCallback(async () => {
    if (busy.current || !sessions) return;
    busy.current = true;
    try {
      const decision = await confirm<OthersSignOut>({
        ...othersSignOutConfirm(otherDeviceCount(sessions), hasThisDevice(sessions)),
        returnFocusTo: focusHeading,
        action: () => signOutOtherDevices(),
      });
      if (!alive.current || !decision?.value) return;
      const outcome = decision.value;
      notify(othersSignedOutText(outcome.revoked), outcome.revoked > 0 ? 'success' : 'default');
      if (outcome.warning) notify(outcome.warning, 'warning');
      if (!outcome.sessionRenewed) {
        notifySessionExpired();
        return;
      }
      mutate((list) => list?.filter((item) => item.current));
      keepFocus();
      void refresh({ background: true });
    } finally {
      busy.current = false;
    }
  }, [confirm, focusHeading, keepFocus, mutate, notify, refresh, sessions]);

  const everywhere = useCallback(() => {
    void signOutEverywhere(() => everywhereRef.current);
  }, [signOutEverywhere]);

  return (
    <DevicesPanel
      sessions={sessions}
      failure={devices.error}
      retrying={devices.isInitialLoading}
      headingRef={headingRef}
      everywhereRef={everywhereRef}
      onRetry={() => void refresh()}
      onSignOut={(session, deviceLabel) => void signOutOne(session, deviceLabel)}
      onSignOutOthers={() => void signOutOthers()}
      onSignOutEverywhere={everywhere}
    />
  );
}
