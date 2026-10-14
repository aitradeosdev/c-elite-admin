'use client';

import { Copy } from 'lucide-react';
import { Button } from '../_ui/Button';
import { compactSetupKey, groupSetupKey } from '../lib/adminSecurity';
import { useCopyStatus } from './hooks';
import s from './security.module.css';

export const SETUP_KEY_TYPE = 'Time-based, 6 digits';

export interface SetupKeyProps {
  secret: string;
  accountLabel: string;
}

export function SetupKey({ secret, accountLabel }: SetupKeyProps) {
  const { message, copy } = useCopyStatus();
  return (
    <div className={s.setupKey}>
      <dl className={s.keyList}>
        <div className={s.keyRow}>
          <dt className={s.keyLabel}>Account</dt>
          <dd className={s.keyValue}>{accountLabel}</dd>
        </div>
        <div className={s.keyRow}>
          <dt className={s.keyLabel}>Key</dt>
          <dd className={[s.keyValue, s.keySecret].join(' ')} translate="no">{groupSetupKey(secret)}</dd>
        </div>
        <div className={s.keyRow}>
          <dt className={s.keyLabel}>Type</dt>
          <dd className={s.keyValue}>{SETUP_KEY_TYPE}</dd>
        </div>
      </dl>
      <div className={s.copyRow}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          leftIcon={<Copy size={14} aria-hidden />}
          onClick={() => void copy(compactSetupKey(secret))}
        >
          Copy key
        </Button>
        <span className={s.copyStatus} role="status">{message}</span>
      </div>
    </div>
  );
}
