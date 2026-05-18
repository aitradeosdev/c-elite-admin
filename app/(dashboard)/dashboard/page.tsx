import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ClipboardList, Wallet, Users as UsersIcon, ArrowDownToLine,
  TrendingUp, TicketPercent, Gift, Share2,
  ArrowLeftRight, Receipt, Activity, CreditCard, ShieldCheck, UserPlus,
} from 'lucide-react';
import { supabaseAdmin } from '../../lib/supabase';
import { verifyAdminFromRequest } from '../../lib/jwt';
import AutoRefresh from './AutoRefresh';
import {
  PageHeader, Kpi, KpiGrid, SectionTitle, Card, CardHeader, CardBody, Badge,
  Table, THead, TBody, Tr, Th, Td, TableEmpty, Button,
} from '../../_ui';

type Stats = Record<string, number>;

// Permission-driven: only the metrics the admin can actually see are
// queried (least-privilege + fewer DB round-trips). Every page that has
// real numbers contributes a stat keyed to its nav permission.
async function getDashboardStats(can: (k: string) => boolean): Promise<Stats> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();
  const onlineISO = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const s: Stats = {};
  const jobs: Promise<unknown>[] = [];
  const count = (key: string, q: any) =>
    jobs.push(q.then((r: any) => { s[key] = r?.count || 0; }).catch(() => {}));
  const sum = (key: string, q: any, col: string) =>
    jobs.push(q.then((r: any) => {
      s[key] = (r?.data || []).reduce((a: number, x: any) => a + Number(x[col] || 0), 0);
    }).catch(() => {}));

  if (can('card_queue')) {
    count('pendingCards', supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'));
    count('cardsToday', supabaseAdmin.from('card_submissions').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
  }
  if (can('withdrawals')) {
    sum('todayPayouts', supabaseAdmin.from('withdrawals').select('amount').eq('status', 'success').gte('created_at', todayISO), 'amount');
    count('pendingWithdrawals', supabaseAdmin.from('withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'initiated'));
  }
  if (can('transfers')) {
    count('transfersToday', supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
    sum('transferVolumeToday', supabaseAdmin.from('transfers').select('amount').eq('status', 'success').gte('created_at', todayISO), 'amount');
  }
  if (can('transactions_overview')) {
    count('txToday', supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
    sum('txVolumeToday', supabaseAdmin.from('transactions').select('amount').eq('status', 'success').gte('created_at', todayISO), 'amount');
  }
  if (can('users')) {
    count('totalUsers', supabaseAdmin.from('users').select('id', { count: 'exact', head: true }));
    count('newUsersToday', supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
  }
  if (can('user_activity_monitor')) {
    count('onlineUsers', supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('last_active_at', onlineISO));
  }
  if (can('coupons')) {
    count('activeCoupons', supabaseAdmin.from('coupons').select('id', { count: 'exact', head: true }).eq('is_active', true));
  }
  if (can('bonuses_rewards')) {
    count('giftboxToday', supabaseAdmin.from('giftbox_claims').select('id', { count: 'exact', head: true }).gte('claimed_at', todayISO));
  }
  if (can('referral_management')) {
    count('referralsToday', supabaseAdmin.from('referrals').select('id', { count: 'exact', head: true }).gte('created_at', todayISO));
  }
  if (can('platform_balance')) {
    sum('walletTotal', supabaseAdmin.from('wallets').select('balance'), 'balance');
  }
  if (can('card_management')) {
    count('activeCards', supabaseAdmin.from('cards').select('id', { count: 'exact', head: true }).eq('is_active', true));
  }
  if (can('admin_accounts')) {
    count('totalAdmins', supabaseAdmin.from('admin_users').select('id', { count: 'exact', head: true }));
  }

  await Promise.all(jobs);
  return s;
}

async function getRecentSubmissions() {
  // card_submissions has NO FK to card_countries — embedding it made the
  // whole query error (data = null → "No submissions yet"). Country comes
  // from card_types.country_code, resolved to a name via card_countries
  // keyed by (card_id, country_code), same as the card-queue route.
  const { data } = await supabaseAdmin
    .from('card_submissions')
    .select(`
      id, amount_foreign, payout_naira, status, created_at, card_id,
      users(username),
      cards(name),
      card_types(country_code)
    `)
    .order('created_at', { ascending: false })
    .limit(10);
  const rows = data || [];
  const cardIds = [...new Set(rows.map((r: any) => r.card_id).filter(Boolean))];
  let nameByKey: Record<string, string> = {};
  if (cardIds.length) {
    const { data: cc } = await supabaseAdmin
      .from('card_countries')
      .select('card_id, country_code, country_name')
      .in('card_id', cardIds);
    nameByKey = Object.fromEntries(
      (cc || []).map((c: any) => [`${c.card_id}|${c.country_code}`, c.country_name]),
    );
  }
  return rows.map((r: any) => ({
    ...r,
    country_name:
      nameByKey[`${r.card_id}|${r.card_types?.country_code}`] ||
      r.card_types?.country_code ||
      null,
  }));
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
  const admin = await verifyAdminFromRequest();
  // Each admin sees only the widgets for pages they're permitted. Super
  // admins (all permissions) see everything. The KPI ↔ permission map
  // mirrors the nav keys in (dashboard)/_shell/nav.ts.
  const can = (key: string): boolean =>
    !!admin && (admin.is_super_admin || (admin.page_permissions || []).includes(key));

  const showSubmissions = can('card_queue');
  const [stats, submissions] = await Promise.all([
    getDashboardStats(can),
    showSubmissions ? getRecentSubmissions() : Promise.resolve([] as any[]),
  ]);

  const n = (k: string) => stats[k] || 0;

  // One widget per page-permission area that has real numbers. Filtered
  // by the admin's permissions; super admins (all perms) see everything.
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
        </>
      ) : null}
    </div>
  );
}
