'use client';

import { DetailRow, Notice, SectionLabel, SidePanel, StatusDot } from '../../_ui';
import { ALL_PERMISSIONS } from '../../lib/permissions';
import { formatAge, formatBusinessDateTime } from '../../lib/time';
import { effectiveActions, sortGrants } from './rules';
import { STATUS_LABEL, STATUS_TONE, adminHandle, statusOf, type AdminRow } from './model';
import { ActionBreakdown, GrantList } from './GrantParts';
import s from './page.module.css';

function when(value: string | null): string {
  if (!value) return 'Never';
  return `${formatBusinessDateTime(value)} WAT · ${formatAge(value)} ago`;
}

export interface AdminDetailsProps {
  admin: AdminRow;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}

export function AdminDetails({ admin, onClose, returnFocusTo }: AdminDetailsProps) {
  const status = statusOf(admin);
  const actions = admin.is_super_admin ? [] : (() => {
    const held = effectiveActions(admin.page_permissions);
    return ALL_PERMISSIONS.filter((permission) => held.has(permission));
  })();

  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={adminHandle(admin)}
      subtitle={admin.role_title || undefined}
      returnFocusTo={returnFocusTo}
    >
      <div className={s.details}>
        {admin.is_super_admin ? (
          <Notice tone="info" flush title="Super administrator">
            Super administrators hold every permission, so page grants do not apply and the account cannot be edited
            here.
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
            <DetailRow label="Role title" value={admin.role_title || '—'} wrap />
            <DetailRow
              label="Status"
              value={<StatusDot status={status} tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />}
            />
            <DetailRow label="Last sign-in" value={when(admin.last_login_at)} />
            <DetailRow label="Created" value={admin.created_at ? `${formatBusinessDateTime(admin.created_at)} WAT` : '—'} />
          </div>
        </section>

        {admin.is_super_admin ? null : (
          <section className={s.formSection}>
            <h3 className={s.formHeading}>{status === 'deleted' ? 'Access it held' : 'Access'}</h3>
            {admin.page_permissions.length ? (
              <GrantList keys={sortGrants(admin.page_permissions)} label="Stored grants" />
            ) : (
              <p className={s.formHint}>No grants are stored on this account.</p>
            )}
            {actions.length ? (
              <>
                <SectionLabel as="h4" flush>Actions those grants allow</SectionLabel>
                <ActionBreakdown actions={actions} />
              </>
            ) : null}
          </section>
        )}
      </div>
    </SidePanel>
  );
}
