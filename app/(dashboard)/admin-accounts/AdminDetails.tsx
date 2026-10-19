'use client';

import { useId, type ReactNode } from 'react';
import { DetailRow, Notice, SectionLabel, SidePanel, StatusDot } from '../../_ui';
import { ALL_PERMISSIONS, type Permission } from '../../lib/permissions';
import { formatAge, formatBusinessDateTime } from '../../lib/time';
import { effectiveActions, sortGrants } from './rules';
import {
  INVITED_LABEL, STATUS_LABEL, STATUS_TONE, adminHandle, isInvited, plural, roleLabel, statusOf, type AdminPanel,
  type AdminRow,
} from './model';
import { ActionBreakdown, GrantList } from '../_access';
import { DrawerPanels, drawerPanel } from './SecurityParts';
import s from './page.module.css';

function when(value: string | null): string {
  if (!value) return 'Never';
  return `${formatBusinessDateTime(value)} WAT · ${formatAge(value)} ago`;
}

function effectiveText(admin: AdminRow, actions: readonly Permission[]): string {
  if (actions.length === 0) return 'No actions.';
  const fromRole = admin.role_id !== null;
  const fromDirect = admin.direct_permissions.length > 0;
  const source = fromRole && fromDirect ? 'the role and direct grants' : fromRole ? 'the role' : 'direct grants';
  return `${plural(actions.length, 'action')} in total, from ${source}.`;
}

export interface AdminDetailsProps {
  admin: AdminRow;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
  panel?: AdminPanel;
  onPanelChange?: (next: AdminPanel) => void;
  security?: ReactNode;
  securityCount?: number | null;
  superAdmin?: ReactNode;
}

export function AdminDetails({
  admin, onClose, returnFocusTo, panel = 'account', onPanelChange, security, securityCount = null, superAdmin,
}: AdminDetailsProps) {
  const tabsId = useId();
  const status = statusOf(admin);
  const invited = isInvited(admin);
  const actions = admin.is_super_admin ? [] : (() => {
    const held = effectiveActions(admin.page_permissions);
    return ALL_PERMISSIONS.filter((permission) => held.has(permission));
  })();
  const direct = sortGrants(admin.direct_permissions);
  const tabs = status === 'deleted' ? undefined : security;

  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={adminHandle(admin)}
      subtitle={admin.role_title || undefined}
      returnFocusTo={returnFocusTo}
    >
      <DrawerPanels
        id={tabsId}
        panel={drawerPanel(panel, tabs, onPanelChange)}
        onPanelChange={onPanelChange}
        sessions={securityCount}
        security={tabs}
      >
        <div className={s.details}>
          {admin.is_super_admin ? (
            <Notice tone="info" flush title="Super administrator">
              Super administrators hold every permission, so roles and direct grants do not apply and the account
              cannot be edited here.
            </Notice>
          ) : null}
          {status === 'deleted' ? (
            <Notice tone="neutral" flush title="Deleted account">
              Deleted {formatBusinessDateTime(admin.deleted_at)} WAT. It cannot sign in, be reactivated or be changed.
            </Notice>
          ) : null}

          <section className={s.formSection}>
            <h3 className={s.formHeading}>Account</h3>
            <div className={s.detailRows}>
              <DetailRow label="Username" value={adminHandle(admin)} />
              <DetailRow label="Email" value={admin.email ?? 'None'} wrap />
              <DetailRow label="Role" value={roleLabel(admin)} wrap />
              <DetailRow label="Title" value={admin.role_title || '—'} wrap />
              <DetailRow
                label="Status"
                value={
                  <StatusDot status={status} tone={STATUS_TONE[status]} label={invited ? INVITED_LABEL : STATUS_LABEL[status]} />
                }
              />
              <DetailRow label="Last sign-in" value={invited ? INVITED_LABEL : when(admin.last_login_at)} />
              <DetailRow label="Created" value={admin.created_at ? `${formatBusinessDateTime(admin.created_at)} WAT` : '—'} />
            </div>
          </section>

          {admin.is_super_admin ? null : (
            <section className={s.formSection}>
              <h3 className={s.formHeading}>{status === 'deleted' ? 'Access it held' : 'Access'}</h3>
              <SectionLabel as="h4" flush>Direct grants</SectionLabel>
              {direct.length ? (
                <GrantList keys={direct} label="Direct grants" />
              ) : (
                <p className={s.formHint}>No direct grants.</p>
              )}
              <SectionLabel as="h4" flush>Effective access</SectionLabel>
              <p className={s.formHint}>{effectiveText(admin, actions)}</p>
              {actions.length ? <ActionBreakdown actions={actions} /> : null}
            </section>
          )}
          {superAdmin}
        </div>
      </DrawerPanels>
    </SidePanel>
  );
}
