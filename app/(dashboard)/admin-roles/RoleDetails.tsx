'use client';

import { Fragment, useRef, useState, type Ref } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, Copy, Pencil } from 'lucide-react';
import {
  Badge, Button, ErrorState, LinkButton, Notice, SidePanel, SkeletonLines, useConfirm, useResource, useToast,
} from '../../_ui';
import { apiRequest, type ApiFailure } from '../../lib/apiClient';
import { ALL_PERMISSIONS, type Permission } from '../../lib/permissions';
import { matrixFromKeys } from '../../lib/grants';
import { formatBusinessDateTime } from '../../lib/time';
import { PermissionMatrix } from '../_access';
import { adminHandle, plural } from '../admin-accounts/model';
import {
  ADMIN_ACCOUNTS_HREF, adminHref, archiveBody, archiveConfirm, archivePath, archiveSuccessText, classifyRoleWrite,
  confirmWithStepUp, duplicateKeys, holdersFromMembers, isArchived, isSystemRole, permissionsText, restoreConfirm,
  restorePath, rolePath, toRoleDetail, toRoleSaved,
  type EditableRole, type RoleDetail, type RoleHolder, type RoleMember, type RoleSaved, type RoleView,
  type RoleWriteOutcome,
} from './model';
import s from './page.module.css';

const ALL_ACTIONS: ReadonlySet<Permission> = new Set(ALL_PERMISSIONS);

export interface RoleDetailsPanelProps {
  role: RoleView;
  detail: RoleDetail | undefined;
  error: ApiFailure | null;
  retrying: boolean;
  canManage: boolean;
  busy: boolean;
  inUse: readonly RoleHolder[] | null;
  bodyRef?: Ref<HTMLDivElement>;
  onClose: () => void;
  onRetry: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onRestore: () => void;
  returnFocusTo?: () => HTMLElement | null;
}

function subtitleFor(role: RoleView, system: boolean, archived: boolean): string {
  if (system) return `${plural(role.active_member_count, 'super administrator')} · All permissions`;
  if (archived) return `Archived · ${permissionsText(role)}`;
  return `${plural(role.active_member_count, 'active admin')} · ${permissionsText(role)}`;
}

function MemberList({ members, system }: { members: readonly RoleMember[]; system: boolean }) {
  if (members.length === 0) {
    return <p className={s.formHint}>{system ? 'No active super administrator was found.' : 'No admin holds this role.'}</p>;
  }
  return (
    <ul className={s.memberList} aria-label={system ? 'Super administrators' : 'Admins holding this role'}>
      {members.map((member) => (
        <li key={member.id} className={s.memberItem}>
          <Link href={adminHref(member.id)} className={s.memberLink}>{adminHandle(member)}</Link>
          {member.role_title ? <span className={s.sub}>{member.role_title}</span> : null}
          {member.is_active ? null : <Badge tone="neutral">Inactive</Badge>}
        </li>
      ))}
    </ul>
  );
}

export function InUseNotice({ holders }: { holders: readonly RoleHolder[] }) {
  return (
    <Notice
      tone="warning"
      flush
      announce="polite"
      title="Admins still hold this role"
      actions={<LinkButton href={ADMIN_ACCOUNTS_HREF} variant="secondary" size="sm">Open Admin accounts</LinkButton>}
    >
      Move them to another role in Admin accounts before archiving it:{' '}
      {holders.map((holder, index) => (
        <Fragment key={holder.admin_id}>
          {index > 0 ? ', ' : null}
          <Link href={adminHref(holder.admin_id)} className={s.inlineLink}>{adminHandle(holder)}</Link>
        </Fragment>
      ))}
      .
    </Notice>
  );
}

export function RoleDetailsPanel({
  role, detail, error, retrying, canManage, busy, inUse, bodyRef, onClose, onRetry, onEdit, onDuplicate, onArchive,
  onRestore, returnFocusTo,
}: RoleDetailsPanelProps) {
  const current = detail ? detail.role : role;
  const system = isSystemRole(current);
  const archived = isArchived(current);
  const manage = canManage && !system;
  const value = system ? ALL_ACTIONS : matrixFromKeys(current.permissions);

  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={current.name}
      subtitle={subtitleFor(role, system, archived)}
      returnFocusTo={returnFocusTo}
      footer={manage ? (
        <div className={s.panelFooter}>
          {archived ? (
            <Button
              variant="primary"
              leftIcon={<ArchiveRestore size={14} aria-hidden />}
              aria-haspopup="dialog"
              loading={busy}
              onClick={onRestore}
            >
              Restore
            </Button>
          ) : (
            <Button
              variant="secondary"
              leftIcon={<Archive size={14} aria-hidden />}
              aria-haspopup="dialog"
              loading={busy}
              onClick={onArchive}
            >
              Archive
            </Button>
          )}
          <Button
            variant="secondary"
            leftIcon={<Copy size={14} aria-hidden />}
            aria-haspopup="dialog"
            disabled={busy}
            onClick={onDuplicate}
          >
            Duplicate
          </Button>
          {archived ? null : (
            <Button
              variant="primary"
              leftIcon={<Pencil size={14} aria-hidden />}
              aria-haspopup="dialog"
              disabled={busy}
              onClick={onEdit}
            >
              Edit
            </Button>
          )}
        </div>
      ) : undefined}
    >
      <div ref={bodyRef} className={s.details} tabIndex={-1}>
        {system ? (
          <Notice tone="info" flush title="Shown for reference">
            Super administrators hold every permission. This row mirrors the super administrator flag, so it cannot be
            edited, duplicated, archived or assigned.
          </Notice>
        ) : null}
        {archived ? (
          <Notice tone="neutral" flush title="Archived role">
            Archived {formatBusinessDateTime(current.archived_at)} WAT. It cannot be assigned or edited until it is restored.
          </Notice>
        ) : null}
        {inUse && inUse.length > 0 ? <InUseNotice holders={inUse} /> : null}

        <section className={s.formSection}>
          <h3 className={s.formHeading}>Description</h3>
          <p className={current.description ? s.descriptionText : s.formHint}>{current.description || 'No description.'}</p>
        </section>

        <section className={s.formSection}>
          <h3 className={s.formHeading}>
            {system ? 'Super administrators' : 'Admins'}
            {detail ? ` · ${detail.members.length.toLocaleString('en-NG')}` : ''}
          </h3>
          {detail ? (
            <MemberList members={detail.members} system={system} />
          ) : error ? (
            <ErrorState
              compact
              title="The admins holding this role could not be loaded"
              message={error.message}
              requestId={error.requestId}
              onRetry={onRetry}
              retrying={retrying}
            />
          ) : (
            <SkeletonLines rows={3} />
          )}
        </section>

        <section className={s.formSection}>
          <h3 className={s.formHeading}>Permissions</h3>
          <PermissionMatrix value={value} readOnly storedKeys={system ? undefined : { value: current.permissions }} />
        </section>
      </div>
    </SidePanel>
  );
}

export interface RoleDetailsProps {
  role: RoleView;
  canManage: boolean;
  onClose: () => void;
  onEdit: (role: EditableRole) => void;
  onDuplicate: (keys: string[]) => void;
  onChanged: () => void;
  returnFocusTo?: () => HTMLElement | null;
}

export function RoleDetails({ role, canManage, onClose, onEdit, onDuplicate, onChanged, returnFocusTo }: RoleDetailsProps) {
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [inUse, setInUse] = useState<RoleHolder[] | null>(null);
  const busyRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const detail = useResource<RoleDetail>(
    `admin-role:${role.id}`,
    (signal) => apiRequest(rolePath(role.id), { signal, select: toRoleDetail }),
  );
  const { refresh } = detail;
  const current: EditableRole = detail.data ? detail.data.role : role;

  const report = (outcome: RoleWriteOutcome<RoleSaved>, archived: boolean) => {
    switch (outcome.kind) {
      case 'done':
        notify(archiveSuccessText(archived, outcome.result.role.name), 'success');
        return;
      case 'conflict':
        if (outcome.reason === 'in_use') {
          setInUse(outcome.members);
          return;
        }
        notify(outcome.message, 'warning');
        return;
      case 'refused':
        notify(outcome.message, 'error');
        router.refresh();
        return;
      case 'unknown':
        notify(outcome.message, 'error');
        return;
      case 'reauth':
        notify(outcome.message, 'warning');
        return;
      case 'expired':
        return;
    }
  };

  const changeArchived = async (archived: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setInUse(null);
    let sent = false;
    try {
      const fresh = await refresh();
      if (!fresh) return;
      if (!fresh.ok) {
        if (fresh.error.status !== 401) {
          notify(`Could not check the latest role details, so nothing was changed. ${fresh.error.message}`, 'error');
        }
        if (fresh.error.status === 403) router.refresh();
        return;
      }
      const live = fresh.data;
      if (isSystemRole(live.role)) return;
      if (isArchived(live.role) === archived) {
        notify(archived ? `${live.role.name} is already archived.` : `${live.role.name} is not archived.`, 'warning');
        onChanged();
        return;
      }
      if (archived && live.members.length > 0) {
        setInUse(holdersFromMembers(live.members));
        return;
      }
      const options = archived ? archiveConfirm(live.role) : restoreConfirm(live.role);
      const outcome = await confirmWithStepUp<RoleSaved>(
        confirm,
        { ...options, returnFocusTo: () => bodyRef.current },
        async (reason) => {
          sent = true;
          return classifyRoleWrite(await apiRequest(archived ? archivePath(live.role.id) : restorePath(live.role.id), {
            method: 'POST',
            body: archiveBody(reason, live.role.version),
            select: toRoleSaved,
          }));
        },
      );
      if (outcome) report(outcome, archived);
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (sent) {
        void refresh({ background: true });
        onChanged();
      }
    }
  };

  return (
    <RoleDetailsPanel
      role={role}
      detail={detail.data}
      error={detail.error}
      retrying={detail.isInitialLoading || detail.isRefreshing}
      canManage={canManage}
      busy={busy}
      inUse={inUse}
      bodyRef={bodyRef}
      onClose={onClose}
      onRetry={() => void refresh()}
      onEdit={() => onEdit(current)}
      onDuplicate={() => onDuplicate(duplicateKeys(current))}
      onArchive={() => void changeArchived(true)}
      onRestore={() => void changeArchived(false)}
      returnFocusTo={returnFocusTo}
    />
  );
}
