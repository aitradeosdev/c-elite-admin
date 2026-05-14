import Link from 'next/link';
import {
  ClipboardList, Wallet, Users as UsersIcon, ArrowDownToLine,
  TrendingUp, TicketPercent, Gift, Share2,
} from 'lucide-react';
import { supabaseAdmin } from '../../lib/supabase';
import AutoRefresh from './AutoRefresh';
import {
  PageHeader, Kpi, KpiGrid, SectionTitle, Card, CardHeader, CardBody, Badge,
  Table, THead, TBody, Tr, Th, Td, TableEmpty, Button,
} from '../../_ui';

async function getDashboardStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const [
    { count: pendingCards },
    { data: todayPayouts },
    { count: totalUsers },
    { count: pendingWithdrawals },
    { count: cardsToday },
    { count: activeCoupons },
    { data: bonusPool },
    { count: referralsToday },
  ] = await Promise.all([
    supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('withdrawals').select('amount').eq('status', 'success').gte('created_at', todayISO),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'initiated'),
    supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).gte('created_at', todayISO),
    supabaseAdmin.from('coupons').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabaseAdmin.from('wallets').select('balance'),
    supabaseAdmin.from('referrals').select('id', { count: 'exact', head: true }).gte('created_at', todayISO),
  ]);

  const todayPayoutsTotal = (todayPayouts || []).reduce((sum: number, w: any) => sum + Number(w.amount), 0);
  const bonusPoolTotal = (bonusPool || []).reduce((sum: number, w: any) => sum + Number(w.balance), 0);

  return {
    pendingCards: pendingCards || 0,
    todayPayouts: todayPayoutsTotal,
    totalUsers: totalUsers || 0,
    pendingWithdrawals: pendingWithdrawals || 0,
    cardsToday: cardsToday || 0,
    activeCoupons: activeCoupons || 0,
    bonusPool: bonusPoolTotal,
    referralsToday: referralsToday || 0,
  };
}

async function getRecentSubmissions() {
  const { data } = await supabaseAdmin
    .from('card_submissions')
    .select(`
      id, amount_foreign, payout_naira, status, created_at,
      users(username),
      cards(name),
      card_countries(country_name)
    `)
    .order('created_at', { ascending: false })
    .limit(10);
  return data || [];
}

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
  const [stats, submissions] = await Promise.all([getDashboardStats(), getRecentSubmissions()]);

  return (
    <div>
      <AutoRefresh />

      <PageHeader
        title="Overview"
        subtitle="Today's activity across the CardElite platform."
      />

      <KpiGrid>
        <Kpi
          label="Pending cards"
          icon={<ClipboardList size={14} />}
          value={formatCount(stats.pendingCards)}
          hint="Awaiting admin review"
        />
        <Kpi
          label="Today's payouts"
          icon={<Wallet size={14} />}
          value={formatNaira(stats.todayPayouts)}
          hint="Withdrawals settled today"
        />
        <Kpi
          label="Total users"
          icon={<UsersIcon size={14} />}
          value={formatCount(stats.totalUsers)}
          hint="All-time registrations"
        />
        <Kpi
          label="Pending withdrawals"
          icon={<ArrowDownToLine size={14} />}
          value={formatCount(stats.pendingWithdrawals)}
          hint="In the approval queue"
        />
        <Kpi
          label="Cards today"
          icon={<TrendingUp size={14} />}
          value={formatCount(stats.cardsToday)}
          hint="Submissions in the last 24h"
        />
        <Kpi
          label="Active coupons"
          icon={<TicketPercent size={14} />}
          value={formatCount(stats.activeCoupons)}
          hint="Currently redeemable"
        />
        <Kpi
          label="Bonus pool"
          icon={<Gift size={14} />}
          value={formatNaira(stats.bonusPool)}
          hint="Pending across all wallets"
        />
        <Kpi
          label="Referrals today"
          icon={<Share2 size={14} />}
          value={formatCount(stats.referralsToday)}
          hint="New referral signups"
        />
      </KpiGrid>

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
                    <Td emphasis="secondary">{row.card_countries?.country_name || '—'}</Td>
                    <Td align="right" mono>{formatNaira(row.payout_naira)}</Td>
                    <Td emphasis="secondary">{new Date(row.created_at).toLocaleDateString()}</Td>
                    <Td>
                      <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
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
    </div>
  );
}
