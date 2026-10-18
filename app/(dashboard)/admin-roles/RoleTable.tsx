'use client';

import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  Badge, Card, CardBody, ErrorState, MobileDataList, RowOpen, TBody, THead, Table, TableEmpty, TableSkeleton,
  TableState, Td, Th, Tr, type MobileDataListSortOption, type SortState, type TableSkeletonColumn,
} from '../../_ui';
import type { ApiFailure } from '../../lib/apiClient';
import { formatBusinessDate } from '../../lib/time';
import { plural } from '../admin-accounts/model';
import { adminsText, isSystemRole, permissionsText, updatedBy, type RoleView } from './model';
import s from './page.module.css';

export const LOAD_FAILED = 'Roles could not be loaded';

export const ROLE_SKELETON_COLUMNS: readonly TableSkeletonColumn[] = [
  { width: 160 },
  { width: 240, lines: 2 },
  { width: 48, align: 'right' },
  { width: 88 },
  { width: 92 },
  { width: 120, lines: 2 },
];

const COLUMN_COUNT = ROLE_SKELETON_COLUMNS.length;

export const ROLE_MOBILE_SORT: ReadonlyArray<MobileDataListSortOption> = [
  { key: 'name', label: 'Role' },
  { key: 'admins', label: 'Admins' },
  { key: 'updated_at', label: 'Updated' },
];

export interface RoleListEmpty {
  title: string;
  hint: string;
  actions?: ReactNode;
}

export interface RoleListProps {
  rows: readonly RoleView[];
  loading: boolean;
  busy: boolean;
  error: ApiFailure | null;
  retrying: boolean;
  sort: SortState | null;
  empty: RoleListEmpty;
  onOpen: (role: RoleView) => void;
  onRetry: () => void;
}

export interface RoleTableProps extends RoleListProps {
  openId: string | null;
  onSort: (key: string) => void;
}

export interface RoleMobileListProps extends RoleListProps {
  onSortChange: (next: SortState) => void;
}

function ProtectedBadge() {
  return (
    <Badge tone="neutral">
      <ShieldCheck size={12} aria-hidden />
      Protected
    </Badge>
  );
}

function RoleCell({ role, onOpen }: { role: RoleView; onOpen: (role: RoleView) => void }) {
  return (
    <span className={s.nameLine}>
      <RowOpen onClick={() => onOpen(role)} aria-haspopup="dialog" aria-label={`Open ${role.name}`} data-role-open={role.id}>
        {role.name}
      </RowOpen>
      {isSystemRole(role) ? <Badge tone="neutral">System</Badge> : null}
    </span>
  );
}

function UpdatedCell({ role }: { role: RoleView }) {
  if (!role.updated_at) return <span className={s.muted}>—</span>;
  const by = updatedBy(role);
  return (
    <span className={s.stack}>
      <span className={s.time}>{formatBusinessDate(role.updated_at)}</span>
      {by ? <span className={s.sub}>{by}</span> : null}
    </span>
  );
}

export function RoleTable({
  rows, loading, busy, error, retrying, sort, empty, openId, onOpen, onRetry, onSort,
}: RoleTableProps) {
  return (
    <Card>
      <CardBody flush>
        <Table flush aria-label="Roles" busy={busy}>
          <THead>
            <Tr>
              <Th sortKey="name" sort={sort} onSort={onSort}>Role</Th>
              <Th>Description</Th>
              <Th align="right" sortKey="admins" sort={sort} onSort={onSort}>Admins</Th>
              <Th>Permissions</Th>
              <Th>Protected</Th>
              <Th sortKey="updated_at" sort={sort} onSort={onSort}>Updated</Th>
            </Tr>
          </THead>
          <TBody>
            {error ? (
              <TableState colSpan={COLUMN_COUNT}>
                <ErrorState
                  compact
                  title={LOAD_FAILED}
                  message={error.message}
                  requestId={error.requestId}
                  onRetry={onRetry}
                  retrying={retrying}
                />
              </TableState>
            ) : loading ? (
              <TableSkeleton columns={ROLE_SKELETON_COLUMNS} rows={4} />
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={COLUMN_COUNT} title={empty.title} hint={empty.hint} actions={empty.actions} />
            ) : (
              rows.map((role) => (
                <Tr key={role.id} selected={role.id === openId} onActivate={() => onOpen(role)}>
                  <Td><RoleCell role={role} onOpen={onOpen} /></Td>
                  <Td>
                    {role.description ? (
                      <span className={s.description}>{role.description}</span>
                    ) : (
                      <span className={s.muted}>—</span>
                    )}
                  </Td>
                  <Td align="right">{adminsText(role)}</Td>
                  <Td>{permissionsText(role)}</Td>
                  <Td>{role.is_protected ? <ProtectedBadge /> : <span className={s.muted}>—</span>}</Td>
                  <Td><UpdatedCell role={role} /></Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );
}

export function RoleMobileList({
  rows, loading, busy, error, retrying, sort, empty, onOpen, onRetry, onSortChange,
}: RoleMobileListProps) {
  return (
    <MobileDataList<RoleView>
      ariaLabel="Roles"
      items={rows}
      getKey={(role) => role.id}
      loading={loading || retrying}
      initialLoading={loading}
      busy={busy}
      error={error ? error.message : null}
      errorTitle={LOAD_FAILED}
      onRetry={onRetry}
      skeletonRows={4}
      empty={empty}
      sortOptions={ROLE_MOBILE_SORT}
      sort={sort}
      onSortChange={onSortChange}
      renderRow={(role) => ({
        primary: isSystemRole(role) ? `${role.name} · System` : role.name,
        secondary: role.description || 'No description',
        status: role.is_protected ? <ProtectedBadge /> : undefined,
        meta: `${plural(role.active_member_count, 'admin')} · ${permissionsText(role)} · Updated ${formatBusinessDate(role.updated_at)}`,
        onClick: () => onOpen(role),
      })}
    />
  );
}
