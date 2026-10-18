'use client';

import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Badge, Card, CardBody, DetailRow, ErrorState, MobileDataList, RowOpen, SectionLabel, SidePanel, TBody, THead, Table,
  TableEmpty, TableSkeleton, TableState, Td, Th, Tr,
  type BadgeTone, type TableSkeletonColumn,
} from '../../_ui';
import type { ApiFailure } from '../../lib/apiClient';
import type { PermissionRisk, PermissionStatus } from '../../lib/permissions';
import { RiskBadge, STATUS_NOTE } from '../_access';
import { adminHandle } from '../admin-accounts/model';
import {
  NO_DIRECT_TEXT, NO_PAGES_TEXT, NO_ROLES_TEXT, highRiskFlag, isHighRisk, mobileMeta, pageAccessLine, rolesPreview,
  type PermissionEntry,
} from './model';
import s from './page.module.css';

export const LOAD_FAILED = 'The permission catalog could not be loaded';

export const HIGH_RISK_LABEL = 'High risk';

export const STATUS_LABEL: Readonly<Record<PermissionStatus, string>> = {
  enforced: 'In use',
  super_only: STATUS_NOTE.super_only,
  reserved: STATUS_NOTE.reserved,
};

const STATUS_TONE: Readonly<Record<PermissionStatus, BadgeTone>> = {
  enforced: 'success',
  super_only: 'info',
  reserved: 'neutral',
};

export const PERMISSION_SKELETON_COLUMNS: readonly TableSkeletonColumn[] = [
  { width: 180, lines: 2 },
  { width: 280, lines: 2 },
  { width: 96 },
  { width: 140 },
  { width: 40, align: 'right' },
  { width: 120 },
  { width: 96 },
];

const COLUMN_COUNT = PERMISSION_SKELETON_COLUMNS.length;

export interface PermissionListEmpty {
  title: string;
  hint: string;
  actions?: ReactNode;
}

export interface PermissionListProps {
  rows: readonly PermissionEntry[];
  loading: boolean;
  busy: boolean;
  error: ApiFailure | null;
  retrying: boolean;
  empty: PermissionListEmpty;
  onOpen: (entry: PermissionEntry) => void;
  onRetry: () => void;
}

export interface PermissionTableProps extends PermissionListProps {
  openKey: string | null;
}

export function StatusBadge({ status }: { status: PermissionStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function HighRiskMark({ risk }: { risk: PermissionRisk }) {
  return (
    <span className={[s.highRisk, risk === 'critical' ? s.highRiskCritical : s.highRiskHigh].join(' ')}>
      <AlertTriangle size={12} aria-hidden />
      {HIGH_RISK_LABEL}
    </span>
  );
}

export function RiskCell({ risk }: { risk: PermissionRisk }) {
  return (
    <span className={s.riskCell}>
      <RiskBadge risk={risk} />
      {isHighRisk(risk) ? <HighRiskMark risk={risk} /> : null}
    </span>
  );
}

function PermissionCell({ entry, onOpen }: { entry: PermissionEntry; onOpen: (entry: PermissionEntry) => void }) {
  return (
    <span className={s.stack}>
      <RowOpen
        className={s.name}
        onClick={() => onOpen(entry)}
        aria-haspopup="dialog"
        aria-label={`Open ${entry.label}`}
        data-permission-open={entry.key}
      >
        {entry.label}
      </RowOpen>
      <code className={s.key}>{entry.key}</code>
    </span>
  );
}

export function PermissionTable({
  rows, loading, busy, error, retrying, empty, openKey, onOpen, onRetry,
}: PermissionTableProps) {
  return (
    <Card>
      <CardBody flush>
        <Table flush aria-label="Permissions" busy={busy}>
          <THead>
            <Tr>
              <Th>Permission</Th>
              <Th>Description</Th>
              <Th>Category</Th>
              <Th>Roles</Th>
              <Th align="right" className={s.wrapHead}>Admins directly assigned</Th>
              <Th>Risk</Th>
              <Th>Status</Th>
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
              <TableSkeleton columns={PERMISSION_SKELETON_COLUMNS} rows={8} />
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={COLUMN_COUNT} title={empty.title} hint={empty.hint} actions={empty.actions} />
            ) : (
              rows.map((entry) => (
                <Tr
                  key={entry.key}
                  className={entry.status === 'reserved' ? s.reservedRow : undefined}
                  selected={entry.key === openKey}
                  onActivate={() => onOpen(entry)}
                >
                  <Td><PermissionCell entry={entry} onOpen={onOpen} /></Td>
                  <Td><span className={s.description}>{entry.description}</span></Td>
                  <Td>{entry.category}</Td>
                  <Td>{entry.roles.length ? rolesPreview(entry.roles) : <span className={s.muted}>—</span>}</Td>
                  <Td align="right">{entry.direct_admin_count.toLocaleString('en-NG')}</Td>
                  <Td><RiskCell risk={entry.risk} /></Td>
                  <Td><StatusBadge status={entry.status} /></Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );
}

export function PermissionMobileList({
  rows, loading, busy, error, retrying, empty, onOpen, onRetry,
}: PermissionListProps) {
  return (
    <MobileDataList<PermissionEntry>
      ariaLabel="Permissions"
      items={rows}
      getKey={(entry) => entry.key}
      loading={loading || retrying}
      initialLoading={loading}
      busy={busy}
      error={error ? error.message : null}
      errorTitle={LOAD_FAILED}
      onRetry={onRetry}
      skeletonRows={8}
      empty={empty}
      renderRow={(entry) => ({
        primary: <span className={entry.status === 'reserved' ? s.muted : undefined}>{entry.label}</span>,
        value: <RiskBadge risk={entry.risk} />,
        secondary: <code className={s.key}>{entry.key}</code>,
        status: <StatusBadge status={entry.status} />,
        meta: mobileMeta(entry),
        flag: highRiskFlag(entry.risk),
        flagLabel: HIGH_RISK_LABEL,
        onClick: () => onOpen(entry),
      })}
    />
  );
}

export interface PermissionDetailsProps {
  entry: PermissionEntry;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}

export function PermissionDetails({ entry, onClose, returnFocusTo }: PermissionDetailsProps) {
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={entry.label}
      subtitle={<code className={s.key}>{entry.key}</code>}
      returnFocusTo={returnFocusTo}
    >
      <div className={s.details}>
        <section className={s.detailSection}>
          <p className={s.detailText}>{entry.description}</p>
          <DetailRow label="Category" value={entry.category} />
          <DetailRow label="Risk" value={<RiskCell risk={entry.risk} />} />
          <DetailRow label="Status" value={<StatusBadge status={entry.status} />} />
        </section>

        <section className={s.detailSection}>
          <SectionLabel as="h3">{`Roles · ${entry.roles.length.toLocaleString('en-NG')}`}</SectionLabel>
          {entry.roles.length ? (
            <ul className={s.itemList} aria-label="Roles that grant this permission">
              {entry.roles.map((role) => <li key={role.id} className={s.item}>{role.name}</li>)}
            </ul>
          ) : (
            <p className={s.emptyText}>{NO_ROLES_TEXT}</p>
          )}
        </section>

        <section className={s.detailSection}>
          <SectionLabel as="h3">{`Admins directly assigned · ${entry.direct_admins.length.toLocaleString('en-NG')}`}</SectionLabel>
          {entry.direct_admins.length ? (
            <ul className={s.itemList} aria-label="Admins directly assigned this permission">
              {entry.direct_admins.map((admin) => <li key={admin.id} className={s.item}>{adminHandle(admin)}</li>)}
            </ul>
          ) : (
            <p className={s.emptyText}>{NO_DIRECT_TEXT}</p>
          )}
        </section>

        <section className={s.detailSection}>
          <SectionLabel as="h3">Page access</SectionLabel>
          {entry.legacy_pages.length ? (
            <ul className={s.itemList} aria-label="Page access that includes this permission">
              {entry.legacy_pages.map((page) => <li key={page} className={s.item}>{pageAccessLine(page)}</li>)}
            </ul>
          ) : (
            <p className={s.emptyText}>{NO_PAGES_TEXT}</p>
          )}
        </section>
      </div>
    </SidePanel>
  );
}
