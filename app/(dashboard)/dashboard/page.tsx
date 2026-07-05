import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ClipboardList, Wallet, Users as UsersIcon, ArrowDownToLine,
  TrendingUp, TicketPercent, Gift, Share2,
  ArrowLeftRight, Receipt, Activity, CreditCard, ShieldCheck, UserPlus, Coins,
} from 'lucide-react';
import { verifyAdminFromRequest } from '../../lib/jwt';
import { buildCan, getDashboardStats, getRecentSubmissions } from '../../lib/dashboard';
import AutoRefresh from './AutoRefresh';
import {
  PageHeader, Kpi, KpiGrid, SectionTitle, Card, CardHeader, CardBody,
  Table, THead, TBody, Tr, Th, Td, TableEmpty, Button,
} from '../../_ui';
import { StatusDot } from '../_shared/statusUi';

function formatNaira(amount: number) {
  return '₦' + amount.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function formatCount(n: number) {
  return n.toLocaleString();
}

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'neutral' {
  switch (status) {
    case 'approved': case 'dispute_resolved': return 'success';
    case 'pending': case 'disputed': return 'warning';
    case 'rejected': return 'danger';
    default: return 'neutral';
  }
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

export default async function DashboardPage() {
  const admin = await verifyAdminFromRequest();
  const can = buildCan(admin);

  const showSubmissions = can('card_queue');
  const [stats, submissions] = await Promise.all([
    getDashboardStats(can),
    showSubmissions ? getRecentSubmissions() : Promise.resolve([] as any[]),
  ]);

  const n = (k: string) => stats[k] || 0;

  const kpis: { perm: string; node: ReactNode }[] = [
    { perm: 'card_queue', node: (
      <Kpi key="pc" label="Pending cards" icon={<ClipboardList size={14} />}
        value={formatCount(n('pendingCards'))} hint="Awaiting admin review" />
    ) },
    { perm: 'card_queue', node: (
      <Kpi key="ct" label="Cards today" icon={<TrendingUp size={14} />}
        value={formatCount(n('cardsToday'))} hint="Submissions in the last 24h" />
    ) },
    { perm: 'withdrawals', node: (
      <Kpi key="tp" label="Today's payouts" icon={<Wallet size={14} />}
        value={formatNaira(n('todayPayouts'))} hint="Withdrawals settled today" />
    ) },
    { perm: 'withdrawals', node: (
      <Kpi key="pw" label="Pending withdrawals" icon={<ArrowDownToLine size={14} />}
        value={formatCount(n('pendingWithdrawals'))} hint="In the approval queue" />
    ) },
    { perm: 'transfers', node: (
      <Kpi key="tft" label="Transfers today" icon={<ArrowLeftRight size={14} />}
        value={formatCount(n('transfersToday'))} hint="Tag + bank, last 24h" />
    ) },
    { perm: 'transfers', node: (
      <Kpi key="tfv" label="Transfer volume" icon={<ArrowLeftRight size={14} />}
        value={formatNaira(n('transferVolumeToday'))} hint="Settled transfers today" />
    ) },
    { perm: 'transactions_overview', node: (
      <Kpi key="txt" label="Transactions today" icon={<Receipt size={14} />}
        value={formatCount(n('txToday'))} hint="All transaction types" />
    ) },
    { perm: 'transactions_overview', node: (
      <Kpi key="txv" label="Transaction volume" icon={<Receipt size={14} />}
        value={formatNaira(n('txVolumeToday'))} hint="Successful, today" />
    ) },
    { perm: 'users', node: (
      <Kpi key="tu" label="Total users" icon={<UsersIcon size={14} />}
        value={formatCount(n('totalUsers'))} hint="All-time registrations" />
    ) },
    { perm: 'users', node: (
      <Kpi key="nu" label="New users today" icon={<UserPlus size={14} />}
        value={formatCount(n('newUsersToday'))} hint="Signups in the last 24h" />
    ) },
    { perm: 'user_activity_monitor', node: (
      <Kpi key="ou" label="Users online" icon={<Activity size={14} />}
        value={formatCount(n('onlineUsers'))} hint="Active in the last 5 min" />
    ) },
    { perm: 'coupons', node: (
      <Kpi key="ac" label="Active coupons" icon={<TicketPercent size={14} />}
        value={formatCount(n('activeCoupons'))} hint="Currently redeemable" />
    ) },
    { perm: 'bonuses_rewards', node: (
      <Kpi key="gb" label="Giftbox claims" icon={<Gift size={14} />}
        value={formatCount(n('giftboxToday'))} hint="Claimed today" />
    ) },
    { perm: 'bonuses_rewards', node: (
      <Kpi key="rp" label="Reward pool" icon={<Coins size={14} />}
        value={formatNaira(n('rewardPool'))} hint="All rewards granted — redeemed + unredeemed" />
    ) },
    { perm: 'referral_management', node: (
      <Kpi key="rt" label="Referrals today" icon={<Share2 size={14} />}
        value={formatCount(n('referralsToday'))} hint="New referral signups" />
    ) },
    { perm: 'platform_balance', node: (
      <Kpi key="wt" label="Total wallet balance" icon={<Wallet size={14} />}
        value={formatNaira(n('walletTotal'))} hint="Sum across all user wallets" />
    ) },
    { perm: 'card_management', node: (
      <Kpi key="acd" label="Active cards" icon={<CreditCard size={14} />}
        value={formatCount(n('activeCards'))} hint="Live in the catalog" />
    ) },
    { perm: 'admin_accounts', node: (
      <Kpi key="ad" label="Admin accounts" icon={<ShieldCheck size={14} />}
        value={formatCount(n('totalAdmins'))} hint="Total admin users" />
    ) },
  ];
  const visibleKpis = kpis.filter((k) => can(k.perm));

  return (
    <div>
      <AutoRefresh />

      <PageHeader
        title="Overview"
        subtitle="Today's activity across the CardElite platform."
      />

      {visibleKpis.length > 0 ? (
        <KpiGrid>{visibleKpis.map((k) => k.node)}</KpiGrid>
      ) : null}

      {visibleKpis.length === 0 ? (
        <Card>
          <CardBody>
            <p style={{ color: 'var(--fg-secondary)', fontSize: 14 }}>
              No dashboard metrics for your permissions. Use the side navigation
              to access the pages you manage.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {can('card_queue') ? (
        <>
      <SectionTitle>Recent card submissions</SectionTitle>
      <Card>
        <CardHeader
          title="Latest 10"
          subtitle="Real-time feed — auto-refreshes every 30 seconds."
          actions={
            <Link href="/card-queue">
              <Button variant="secondary" size="sm">Open queue</Button>
            </Link>
          }
        />
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
              {submissions.length === 0 ? (
                <TableEmpty colSpan={7}>No submissions yet</TableEmpty>
              ) : (
                submissions.map((row: any) => (
                  <Tr key={row.id}>
                    <Td emphasis="primary">{row.users?.username || '—'}</Td>
                    <Td>{row.cards?.name || '—'}</Td>
                    <Td emphasis="secondary">{row.country_name || '—'}</Td>
                    <Td align="right" mono>{formatNaira(row.payout_naira)}</Td>
                    <Td emphasis="secondary">{new Date(row.created_at).toLocaleDateString()}</Td>
                    <Td>
                      <StatusDot status={statusLabel(row.status)} tone={statusTone(row.status)} />
                    </Td>
                    <Td align="right">
                      <Link href="/card-queue">
                        <Button variant="ghost" size="sm">Open</Button>
                      </Link>
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </CardBody>
      </Card>
        </>
      ) : null}
    </div>
  );
}
