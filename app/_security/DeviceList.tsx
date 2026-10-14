'use client';

import { Monitor, Smartphone, Tablet, type LucideIcon } from 'lucide-react';
import { Badge } from '../_ui/Badge';
import { Button } from '../_ui/Button';
import {
  describeDevice, ipText, signOutLabel, signedInText, usedRecoveryCode,
  type DeviceKind, type DeviceSession,
} from '../lib/adminSecurity';
import s from './security.module.css';

export const NO_OTHER_DEVICES = 'No other devices are signed in.';
export const THIS_DEVICE = 'This device';
export const RECOVERY_CODE_BADGE = 'Recovery code';

const KIND_ICON: Readonly<Record<DeviceKind, LucideIcon>> = {
  computer: Monitor,
  phone: Smartphone,
  tablet: Tablet,
  app: Smartphone,
};

export interface DeviceListProps {
  sessions: readonly DeviceSession[];
  now?: Date;
  onSignOut?: (session: DeviceSession, deviceLabel: string) => void;
  pendingId?: string | null;
  disabled?: boolean;
  signOutText?: string;
  emptyText?: string;
  className?: string;
}

export function DeviceList({
  sessions, now, onSignOut, pendingId = null, disabled = false, signOutText = 'Sign out',
  emptyText = NO_OTHER_DEVICES, className,
}: DeviceListProps) {
  const at = now ?? new Date();
  const others = sessions.filter((session) => !session.current).length;
  return (
    <>
      {sessions.length > 0 ? (
        <ul role="list" className={[s.devices, className].filter(Boolean).join(' ')}>
          {sessions.map((session) => {
            const device = describeDevice(session.userAgent, session.client);
            const Icon = KIND_ICON[device.kind];
            return (
              <li key={session.id} className={s.device}>
                <span className={s.deviceIcon} aria-hidden>
                  <Icon size={16} aria-hidden />
                </span>
                <div className={s.deviceText}>
                  <div className={s.deviceTitle}>
                    <span className={s.deviceLabel}>{device.label}</span>
                    {session.current ? <Badge tone="accent">{THIS_DEVICE}</Badge> : null}
                    {usedRecoveryCode(session) ? <Badge tone="warning">{RECOVERY_CODE_BADGE}</Badge> : null}
                  </div>
                  <p className={s.deviceMeta}>{signedInText(session, at)}</p>
                  <p className={[s.deviceMeta, s.deviceIp].join(' ')} translate="no">{ipText(session.ip)}</p>
                </div>
                {!session.current && onSignOut ? (
                  <div className={s.deviceAction}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={signOutLabel(session, device.label)}
                      loading={pendingId === session.id}
                      disabled={disabled || (pendingId !== null && pendingId !== session.id)}
                      onClick={() => onSignOut(session, device.label)}
                    >
                      {signOutText}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {others === 0 ? <p className={s.devicesEmpty}>{emptyText}</p> : null}
    </>
  );
}
