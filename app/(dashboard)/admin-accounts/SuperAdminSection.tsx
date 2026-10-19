'use client';

import { useId, useRef } from 'react';
import { ShieldMinus, ShieldPlus } from 'lucide-react';
import { Button } from '../../_ui';
import type { AdminRow, SuperAdminChange } from './model';
import type { FocusTarget } from './SecurityTab';
import s from './page.module.css';

export const MAKE_SUPER_ADMIN_HELP = 'Gives them every permission, clears their role and signs them out.';
export const REMOVE_SUPER_ADMIN_HELP =
  'Takes away every permission and signs them out. They have no access until you give them a role.';

export interface SuperAdminSectionProps {
  admin: AdminRow;
  change: SuperAdminChange;
  busy: boolean;
  onChange: (admin: AdminRow, change: SuperAdminChange, returnFocusTo: FocusTarget) => void;
}

export function SuperAdminSection({ admin, change, busy, onChange }: SuperAdminSectionProps) {
  const headingId = useId();
  const helpId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const making = change === 'make';

  const focus: FocusTarget = () => {
    const button = buttonRef.current;
    return button && button.isConnected && !button.disabled ? button : sectionRef.current;
  };

  return (
    <section ref={sectionRef} className={s.formSection} aria-labelledby={headingId} tabIndex={-1}>
      <h3 id={headingId} className={s.formHeading}>Super admin</h3>
      <div className={s.securityAction}>
        <Button
          ref={buttonRef}
          type="button"
          variant={making ? 'secondary' : 'dangerSubtle'}
          size="sm"
          leftIcon={making ? <ShieldPlus size={14} aria-hidden /> : <ShieldMinus size={14} aria-hidden />}
          disabled={busy}
          aria-describedby={helpId}
          onClick={() => onChange(admin, change, focus)}
        >
          {making ? 'Make super admin…' : 'Remove super admin…'}
        </Button>
        <p id={helpId} className={s.actionHint}>{making ? MAKE_SUPER_ADMIN_HELP : REMOVE_SUPER_ADMIN_HELP}</p>
      </div>
    </section>
  );
}
