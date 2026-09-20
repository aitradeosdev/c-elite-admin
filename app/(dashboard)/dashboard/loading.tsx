import {
  PageHeader, KpiGrid, KpiSkeleton, SectionTitle, Card, CardHeader, CardBody,
  Table, THead, TBody, Tr, Th, TableSkeleton,
} from '../../_ui';

export default function DashboardLoading() {
  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Today's activity across the CardElite platform."
      />

      <KpiGrid>
        {Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />)}
      </KpiGrid>

      <SectionTitle>Recent card submissions</SectionTitle>
      <Card>
        <CardHeader title="Latest 10" subtitle="Real-time feed — auto-refreshes every 30 seconds." />
        <CardBody flush>
          <Table flush>
            <THead>
              <Tr>
                <Th>User</Th>
                <Th>Card</Th>
                <Th>Country</Th>
                <Th align="right">Payout</Th>
                <Th>Submitted</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              <TableSkeleton colSpan={7} />
            </TBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
