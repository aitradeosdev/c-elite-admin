import { Suspense } from 'react';
import {
  Card, CardBody, PageHeader, Skeleton, Table, TableSkeleton, TBody, Th, THead, Tr,
} from '../../_ui';
import { CardQueue } from './CardQueue';
import { QUEUE_SKELETON_COLUMNS, QUEUE_TABS } from './queueModel';
import s from './page.module.css';

function CardQueueFallback() {
  return (
    <div>
      <PageHeader
        title="Card queue"
        subtitle="Review gift-card submissions. Approving a card credits the user's wallet immediately."
      />
      <div className={s.fallbackTabs} aria-hidden>
        {QUEUE_TABS.map((item) => <Skeleton key={item.value} width={64} height={11} />)}
      </div>
      <div className={s.fallbackFilters} aria-hidden>
        <Skeleton height={34} className={s.fallbackSearch} />
        <Skeleton width={280} height={34} />
      </div>
      <Card>
        <CardBody flush>
          <Table flush aria-label="Card submissions">
            <THead>
              <Tr>
                <Th>Submitted</Th>
                <Th>User</Th>
                <Th>Card</Th>
                <Th align="right">Card value</Th>
                <Th align="right">Payout</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              <TableSkeleton rows={8} columns={QUEUE_SKELETON_COLUMNS} />
            </TBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}

export default function CardQueuePage() {
  return (
    <Suspense fallback={<CardQueueFallback />}>
      <CardQueue />
    </Suspense>
  );
}
