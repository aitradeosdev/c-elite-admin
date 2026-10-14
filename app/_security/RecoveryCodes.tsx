'use client';

import { useMemo, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Button } from '../_ui/Button';
import { Checkbox } from '../_ui/Checkbox';
import { recoveryCodesFileName, recoveryCodesText } from '../lib/adminSecurity';
import { downloadText, useCopyStatus, useUnloadGuard } from './hooks';
import s from './security.module.css';

export const RECOVERY_CODES_LEAD = 'Each code signs you in once if you lose your phone. They are shown only now.';
export const RECOVERY_CODES_SAVED = 'I have saved my recovery codes somewhere safe';

export interface RecoveryCodesProps {
  codes: readonly string[];
  username: string;
  createdAt?: Date;
  saved: boolean;
  onSavedChange: (next: boolean) => void;
  guardUnload?: boolean;
  disabled?: boolean;
}

export function RecoveryCodes({
  codes, username, createdAt, saved, onSavedChange, guardUnload = true, disabled = false,
}: RecoveryCodesProps) {
  const [madeAt] = useState(() => createdAt ?? new Date());
  const text = useMemo(() => recoveryCodesText(codes, { username, createdAt: madeAt }), [codes, username, madeAt]);
  const { message, copy } = useCopyStatus();
  useUnloadGuard(guardUnload && !saved);

  return (
    <div className={s.codes}>
      <p className={s.codesLead}>{RECOVERY_CODES_LEAD}</p>
      <ol className={s.codeList} aria-label="Recovery codes" translate="no">
        {codes.map((code, index) => (
          <li key={`${index}-${code}`} className={s.codeItem}>
            <span className={s.codeIndex} aria-hidden>{`${index + 1}.`}</span>
            <span className={s.code}>{code}</span>
          </li>
        ))}
      </ol>
      <div className={s.copyRow}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          leftIcon={<Copy size={14} aria-hidden />}
          onClick={() => void copy(text)}
        >
          Copy codes
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          leftIcon={<Download size={14} aria-hidden />}
          onClick={() => downloadText(text, recoveryCodesFileName(username, madeAt))}
        >
          Download .txt
        </Button>
        <span className={s.copyStatus} role="status">{message}</span>
      </div>
      <Checkbox
        checked={saved}
        onChange={onSavedChange}
        label={RECOVERY_CODES_SAVED}
        disabled={disabled}
      />
    </div>
  );
}
