'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import {
  Button, Card, CardBody, ErrorState, MobileDataList, Money, Notice, Pagination, Ref, RowOpen, StatusDot, TBody,
  THead, Table, TableEmpty, TableSkeleton, TableState, Td, Th, Tr, truncateRef,
  type MobileDataListRow, type ThProps,
} from '../../../_ui';
import { formatAge, formatBusinessDateTime } from '../../../lib/time';
import {
  SECTIONS, countText, deviceSummary, plural, transactionHref, typeLabel, userTransactionsHref,
  type DeviceRow, type LoginRow, type SectionSpec, type TransactionRow,
} from './model';
import type { UserSection } from './useUserSection';
import s from './page.module.css';

function sortable<T>(section: UserSection<T>, key: string): Pick<ThProps, 'sortKey' | 'sort' | 'onSort'> {
  if ((section.state.total ?? section.state.rows.length) < 2) return {};
  return { sortKey: key, sort: section.state.sort, onSort: section.sortBy };
}

function stamp(value: string | null): string {
  return value ? `${formatBusinessDateTime(value)} · ${formatAge(value)} ago` : 'Not recorded';
}

function TimeCell({ value }: { value: string | null }) {
  if (!value) return <span className={s.muted}>—</span>;
  return (
    <div className={s.stack}>
      <span className={s.time}>{formatBusinessDateTime(value)}</span>
      <span className={s.sub}>{formatAge(value)} ago</span>
    </div>
  );
}

function DeviceCell({ row }: { row: DeviceRow | LoginRow }) {
  return (
    <div className={s.stack}>
      <span className={s.lead}>{row.device_model || 'Unknown device'}</span>
      <span className={s.sub}>{deviceSummary(row)}</span>
    </div>
  );
}

interface FrameProps<T> {
  spec: SectionSpec;
  section: UserSection<T>;
  isMobile: boolean;
  columns: number;
  head: ReactNode;
  toolbar?: ReactNode;
  rowKey: (row: T) => string;
  renderRow: (row: T) => ReactNode;
  mobileRow: (row: T) => MobileDataListRow;
}

function SectionFrame<T>({
  spec, section, isMobile, columns, head, toolbar, rowKey, renderRow, mobileRow,
}: FrameProps<T>) {
  const { state } = section;
  const hasRows = state.rows.length > 0;
  const blocked = Boolean(state.error) && !hasRows;
  const busy = state.loading && hasRows;
  const showPager = state.loaded && !blocked && state.total !== null && state.total > 0;

  return (
    <div className={s.panel}>
      <div className={s.panelBar}>
        <p className={s.panelCaption}>{spec.caption}</p>
        {toolbar}
      </div>

      {isMobile ? (
        <MobileDataList<T>
          ariaLabel={spec.label}
          items={state.rows}
          getKey={rowKey}
          loading={state.loading}
          initialLoading={!state.loaded}
          busy={state.loading}
          error={state.error}
          onRetry={section.retry}
          skeletonRows={6}
          empty={{ title: spec.emptyTitle, hint: spec.emptyHint }}
          renderRow={mobileRow}
        />
      ) : (
        <>
          {state.error && hasRows ? (
            <Notice
              tone="warning"
              compact
              announce="polite"
              actions={<Button variant="ghost" size="sm" onClick={section.retry}>Try again</Button>}
            >
              {state.error} Showing the results loaded earlier.
            </Notice>
          ) : null}
          <Card>
            <CardBody flush>
              <Table flush aria-label={spec.label} busy={busy} aria-busy={state.loading || undefined}>
                <THead>{head}</THead>
                <TBody>
                  {!state.loaded ? (
                    <TableSkeleton colSpan={columns} rows={Math.min(spec.pageSize, 8)} />
                  ) : blocked ? (
                    <TableState colSpan={columns}>
                      <ErrorState
                        compact
                        title={spec.errorTitle}
                        message={state.error}
                        onRetry={section.retry}
                        retrying={state.loading}
                      />
                    </TableState>
                  ) : !hasRows ? (
                    <TableEmpty colSpan={columns} title={spec.emptyTitle} hint={spec.emptyHint} />
                  ) : (
                    state.rows.map(renderRow)
                  )}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </>
      )}

      {showPager && state.total !== null ? (
        <Pagination
          page={state.page}
          pageSize={state.pageSize}
          total={state.total}
          onPageChange={section.goTo}
          noun={spec.noun}
          disabled={state.loading}
          label={`${spec.label} pages`}
        />
      ) : null}
    </div>
  );
}

export function TransactionsPanel({
  section, userId, canOpen, isMobile,
}: {
  section: UserSection<TransactionRow>;
  userId: string;
  canOpen: boolean;
  isMobile: boolean;
}) {
  const router = useRouter();
  return (
    <SectionFrame<TransactionRow>
      spec={SECTIONS.transactions}
      section={section}
      isMobile={isMobile}
      columns={5}
      toolbar={canOpen ? (
        <Link href={userTransactionsHref(userId)} className={s.panelLink}>
          Open in Transactions <ArrowUpRight size={12} aria-hidden />
        </Link>
      ) : null}
      head={
        <Tr>
          <Th>Transaction</Th>
          <Th align="right" {...sortable(section, 'amount')}>Amount</Th>
          <Th>Status</Th>
          <Th>Reference</Th>
          <Th {...sortable(section, 'created_at')}>Created</Th>
        </Tr>
      }
      rowKey={(row) => row.id}
      renderRow={(row) => {
        const href = transactionHref(row.id);
        return (
          <Tr key={row.id} interactive={canOpen} onActivate={canOpen ? () => router.push(href) : undefined}>
            <Td>
              <div className={s.stack}>
                {canOpen ? (
                  <RowOpen href={href}>{typeLabel(row.type)}</RowOpen>
                ) : (
                  <span className={s.lead}>{typeLabel(row.type)}</span>
                )}
                <span className={s.subMono} translate="no">{truncateRef(row.id, 8)}</span>
              </div>
            </Td>
            <Td align="right">
              <Money value={row.amount} emphasis="primary" />
            </Td>
            <Td>
              <StatusDot status={row.status || 'unknown'} />
            </Td>
            <Td>
              <Ref value={row.reference_id} label="reference" size="sm" emphasis="secondary" />
            </Td>
            <Td>
              <TimeCell value={row.created_at} />
            </Td>
          </Tr>
        );
      }}
      mobileRow={(row) => ({
        primary: typeLabel(row.type),
        value: <Money value={row.amount} />,
        secondary: <span translate="no">{truncateRef(row.id, 8)}</span>,
        status: <StatusDot status={row.status || 'unknown'} />,
        meta: stamp(row.created_at),
        href: canOpen ? transactionHref(row.id) : undefined,
      })}
    />
  );
}

function deviceKey(row: DeviceRow | LoginRow): string {
  return row.id ?? `${row.created_at}|${row.device_model ?? ''}|${row.ip_address ?? ''}`;
}

export function DevicesPanel({ section, isMobile }: { section: UserSection<DeviceRow>; isMobile: boolean }) {
  return (
    <SectionFrame<DeviceRow>
      spec={SECTIONS.devices}
      section={section}
      isMobile={isMobile}
      columns={5}
      head={
        <Tr>
          <Th>Device</Th>
          <Th>IP address</Th>
          <Th {...sortable(section, 'created_at')}>First seen</Th>
          <Th {...sortable(section, 'last_seen_at')}>Last seen</Th>
          <Th align="right" {...sortable(section, 'login_count')}>Sign-ins</Th>
        </Tr>
      }
      rowKey={deviceKey}
      renderRow={(row) => (
        <Tr key={deviceKey(row)}>
          <Td>
            <DeviceCell row={row} />
          </Td>
          <Td mono emphasis="muted" translate="no">{row.ip_address || '—'}</Td>
          <Td>
            <TimeCell value={row.created_at} />
          </Td>
          <Td>
            <TimeCell value={row.last_seen_at} />
          </Td>
          <Td align="right" mono>{countText(row.login_count ?? 1)}</Td>
        </Tr>
      )}
      mobileRow={(row) => ({
        primary: row.device_model || 'Unknown device',
        secondary: deviceSummary(row),
        status: plural(row.login_count ?? 1, 'sign-in', 'sign-ins'),
        meta: `${row.last_seen_at ? `Last seen ${stamp(row.last_seen_at)}` : `First seen ${stamp(row.created_at)}`}${
          row.ip_address ? ` · ${row.ip_address}` : ''
        }`,
      })}
    />
  );
}

export function LoginsPanel({ section, isMobile }: { section: UserSection<LoginRow>; isMobile: boolean }) {
  return (
    <SectionFrame<LoginRow>
      spec={SECTIONS.logins}
      section={section}
      isMobile={isMobile}
      columns={4}
      head={
        <Tr>
          <Th>Device</Th>
          <Th>IP address</Th>
          <Th {...sortable(section, 'created_at')}>Signed in</Th>
          <Th>Signed out</Th>
        </Tr>
      }
      rowKey={deviceKey}
      renderRow={(row) => (
        <Tr key={deviceKey(row)}>
          <Td>
            <DeviceCell row={row} />
          </Td>
          <Td mono emphasis="muted" translate="no">{row.ip_address || '—'}</Td>
          <Td>
            <TimeCell value={row.created_at} />
          </Td>
          <Td>
            <TimeCell value={row.ended_at} />
          </Td>
        </Tr>
      )}
      mobileRow={(row) => ({
        primary: row.device_model || 'Unknown device',
        secondary: deviceSummary(row),
        status: row.ended_at ? 'Signed out' : undefined,
        meta: `${stamp(row.created_at)}${row.ip_address ? ` · ${row.ip_address}` : ''}`,
      })}
    />
  );
}
