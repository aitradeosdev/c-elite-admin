'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardBody, LinkButton, MobileDataList, Money, ResponsiveView, StatusDot, Table, TableEmpty, TableSkeleton,
  TableState, TBody, Td, Th, THead, Tr, type MobileDataListRow, type TableSkeletonColumn,
} from '../../_ui';
import { RetryState, useServerRefresh } from './Refresh';
import s from './page.module.css';

export interface RecentRow {
  id: string;
  href: string;
  user: string;
  card: string;
  country: string | null;
  payout: number | null;
  status: string;
  submittedAt: string;
  age: string;
}

export interface RecentSubmissionsProps {
  rows: readonly RecentRow[];
  error: string | null;
  loading?: boolean;
}

const COLUMNS = 7;
const SKELETON_ROWS = 10;
const LIST_LABEL = 'Recent card submissions';
const EMPTY_TITLE = 'No card submissions yet';
const EMPTY_HINT = 'Submissions appear here as soon as a user sends a card for review.';
const ERROR_TITLE = 'Recent submissions could not be loaded';
const STILL_FAILING = 'Recent submissions are still unavailable.';

const SKELETON_COLUMNS: readonly TableSkeletonColumn[] = [
  { width: 150 },
  { width: 76 },
  { width: 104 },
  { width: 72 },
  { width: 80, align: 'right' },
  { width: 64 },
  { width: 54, align: 'right', button: true },
];

export function RecentSubmissions({ rows, error, loading = false }: RecentSubmissionsProps) {
  const router = useRouter();
  const { pending, refresh } = useServerRefresh(Boolean(error), STILL_FAILING);

  const renderRow = (row: RecentRow): MobileDataListRow => ({
    primary: row.card,
    value: <Money value={row.payout} emphasis="primary" />,
    secondary: row.country ? `${row.user} · ${row.country}` : row.user,
    status: <StatusDot status={row.status} />,
    meta: `${row.submittedAt} · ${row.age} ago`,
    href: row.href,
  });

  let body: ReactNode;
  if (loading) {
    body = <TableSkeleton columns={SKELETON_COLUMNS} rows={SKELETON_ROWS} />;
  } else if (error && rows.length === 0) {
    body = (
      <TableState colSpan={COLUMNS}>
        <RetryState title={ERROR_TITLE} message={error} stillFailing={STILL_FAILING} />
      </TableState>
    );
  } else if (rows.length === 0) {
    body = <TableEmpty colSpan={COLUMNS} title={EMPTY_TITLE} hint={EMPTY_HINT} />;
  } else {
    body = rows.map((row) => (
      <Tr key={row.id} onActivate={() => router.push(row.href)}>
        <Td>
          <span className={s.when}>
            {row.submittedAt}
            <span className={s.whenAge}> · {row.age} ago</span>
          </span>
        </Td>
        <Td emphasis="primary">{row.user}</Td>
        <Td>{row.card}</Td>
        <Td emphasis="secondary">{row.country ?? '—'}</Td>
        <Td align="right"><Money value={row.payout} emphasis="primary" /></Td>
        <Td><StatusDot status={row.status} /></Td>
        <Td align="right">
          <LinkButton href={row.href} variant="ghost" size="sm" aria-label={`Open ${row.card} from ${row.user}`}>
            Open
          </LinkButton>
        </Td>
      </Tr>
    ));
  }

  return (
    <ResponsiveView
      desktop={
        <Card>
          <CardBody flush>
            <Table flush aria-label={LIST_LABEL} aria-busy={loading || undefined}>
              <THead>
                <Tr>
                  <Th>Submitted</Th>
                  <Th>User</Th>
                  <Th>Card</Th>
                  <Th>Country</Th>
                  <Th align="right">Payout</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>{body}</TBody>
            </Table>
          </CardBody>
        </Card>
      }
      mobile={
        <MobileDataList
          items={rows}
          getKey={(row) => row.id}
          renderRow={renderRow}
          ariaLabel={LIST_LABEL}
          loading={loading}
          busy={pending}
          error={error}
          errorTitle={ERROR_TITLE}
          onRetry={refresh}
          skeletonRows={SKELETON_ROWS}
          empty={{ title: EMPTY_TITLE, hint: EMPTY_HINT }}
        />
      }
    />
  );
}
