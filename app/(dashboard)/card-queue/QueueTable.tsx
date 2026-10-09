'use client';

import type { ReactNode } from 'react';
import {
  Button, ErrorState, Money, RowOpen, StatusDot, Table, TableEmpty, TableSkeleton, TableState, TBody, Td, Th, THead,
  Tr, type SortState,
} from '../../_ui';
import type { ApiFailure } from '../../lib/apiClient';
import { formatAge, formatBusinessDateTime } from '../../lib/time';
import {
  QUEUE_SKELETON_COLUMNS, cardDetail, cardName, formatForeignAmount, statusText, userHandle, type QueueRow,
} from './queueModel';
import s from './page.module.css';

const COLUMNS = QUEUE_SKELETON_COLUMNS.length;

export interface QueueEmpty {
  title: string;
  hint: string;
  action?: ReactNode;
}

export interface QueueTableProps {
  rows: QueueRow[] | null;
  error: ApiFailure | null;
  retrying: boolean;
  refreshing: boolean;
  sort: SortState | null;
  onSort: (key: string) => void;
  activeId: string | null;
  canReview: boolean;
  deciding: boolean;
  empty: QueueEmpty;
  onOpen: (row: QueueRow) => void;
  onApprove: (row: QueueRow) => void;
  onReject: (row: QueueRow) => void;
  onRetry: () => void;
}

interface RowProps {
  row: QueueRow;
  active: boolean;
  canReview: boolean;
  deciding: boolean;
  onOpen: (row: QueueRow) => void;
  onApprove: (row: QueueRow) => void;
  onReject: (row: QueueRow) => void;
}

function QueueTableRow({ row, active, canReview, deciding, onOpen, onApprove, onReject }: RowProps) {
  const who = userHandle(row.users);
  const card = cardName(row);
  const detail = cardDetail(row);
  const showName = Boolean(row.users?.username && row.users?.full_name);
  const openLabel = row.status === 'disputed' && canReview ? 'Review' : 'View';
  return (
    <Tr selected={active} onActivate={() => onOpen(row)}>
      <Td>
        <span className={s.stack}>
          <span className={s.primaryText}>{formatBusinessDateTime(row.created_at)}</span>
          <span className={s.secondaryText}>{formatAge(row.created_at)} ago</span>
        </span>
      </Td>
      <Td>
        <span className={s.stack}>
          <span className={s.primaryText}>{who}</span>
          {showName ? <span className={s.secondaryText}>{row.users?.full_name}</span> : null}
        </span>
      </Td>
      <Td>
        <span className={s.stack}>
          <RowOpen onClick={() => onOpen(row)} aria-haspopup="dialog" aria-label={`Open ${card} from ${who}`}>
            {card}
          </RowOpen>
          {detail ? <span className={s.secondaryText}>{detail}</span> : null}
        </span>
      </Td>
      <Td align="right" mono emphasis="secondary">{formatForeignAmount(row.amount_foreign)}</Td>
      <Td align="right"><Money value={row.payout_naira} emphasis="primary" /></Td>
      <Td><StatusDot status={row.status} label={statusText(row.status)} /></Td>
      <Td align="right">
        <span className={s.rowActions}>
          {row.status === 'pending' && canReview ? (
            <>
              <Button
                variant="success"
                size="sm"
                disabled={deciding}
                onClick={() => onApprove(row)}
                aria-label={`Approve ${card} from ${who}`}
              >
                Approve
              </Button>
              <Button
                variant="dangerSubtle"
                size="sm"
                disabled={deciding}
                onClick={() => onReject(row)}
                aria-label={`Reject ${card} from ${who}`}
              >
                Reject
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpen(row)}
            aria-haspopup="dialog"
            aria-label={`${openLabel} ${card} from ${who}`}
          >
            {openLabel}
          </Button>
        </span>
      </Td>
    </Tr>
  );
}

export function QueueTable({
  rows, error, retrying, refreshing, sort, onSort, activeId, canReview, deciding, empty, onOpen, onApprove, onReject,
  onRetry,
}: QueueTableProps) {
  let body: ReactNode;
  if (rows === null && error) {
    body = (
      <TableState colSpan={COLUMNS}>
        <ErrorState
          compact
          title="The card queue could not be loaded"
          message={error.message}
          requestId={error.requestId}
          onRetry={onRetry}
          retrying={retrying}
        />
      </TableState>
    );
  } else if (rows === null) {
    body = <TableSkeleton rows={8} columns={QUEUE_SKELETON_COLUMNS} />;
  } else if (rows.length === 0) {
    body = <TableEmpty colSpan={COLUMNS} title={empty.title} hint={empty.hint} actions={empty.action} />;
  } else {
    body = rows.map((row) => (
      <QueueTableRow
        key={row.id}
        row={row}
        active={row.id === activeId}
        canReview={canReview}
        deciding={deciding}
        onOpen={onOpen}
        onApprove={onApprove}
        onReject={onReject}
      />
    ));
  }

  return (
    <Table flush aria-label="Card submissions" busy={refreshing}>
      <THead>
        <Tr>
          <Th sortKey="created_at" sort={sort} onSort={onSort}>Submitted</Th>
          <Th>User</Th>
          <Th>Card</Th>
          <Th align="right">Card value</Th>
          <Th align="right" sortKey="amount" sort={sort} onSort={onSort}>Payout</Th>
          <Th>Status</Th>
          <Th align="right">Actions</Th>
        </Tr>
      </THead>
      <TBody>{body}</TBody>
    </Table>
  );
}
