import { supabaseAdmin } from '../../lib/supabase';

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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    pending: { bg: '#FFF8E1', color: '#F9A825' },
    approved: { bg: '#E8F5E9', color: '#2E7D32' },
    rejected: { bg: '#FFEBEE', color: '#C62828' },
    disputed: { bg: '#FFF8E1', color: '#F9A825' },
    dispute_resolved: { bg: '#E8F5E9', color: '#2E7D32' },
  };
  const style = map[status] || map.pending;
  return (
    <span style={{
      backgroundColor: style.bg,
      color: style.color,
      padding: '3px 8px',
      borderRadius: 100,
      fontSize: 11,
      fontWeight: 600,
    }}>
      {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
    </span>
  );
}

const STATS = [
  { key: 'pendingCards', label: 'Pending Cards' },
  { key: 'todayPayouts', label: 'Today Payouts (₦)', format: true },
  { key: 'totalUsers', label: 'Total Users' },
  { key: 'pendingWithdrawals', label: 'Pending Withdrawals' },
  { key: 'cardsToday', label: 'Cards Today' },
  { key: 'activeCoupons', label: 'Active Coupons' },
  { key: 'bonusPool', label: 'Bonus Pool', format: true },
  { key: 'referralsToday', label: 'Referrals Today' },
];

import AutoRefresh from './AutoRefresh';

export default async function DashboardPage() {
  const [stats, submissions] = await Promise.all([getDashboardStats(), getRecentSubmissions()]);

  return (
    <div>
      <AutoRefresh />
      {/* Stats Grid */}
      <div style={styles.statsGrid}>
        {STATS.map((stat) => (
          <div key={stat.key} style={styles.statCard}>
            <p style={styles.statLabel}>{stat.label}</p>
            <p style={styles.statValue}>
              {stat.format
                ? formatNaira(stats[stat.key as keyof typeof stats] as number)
                : (stats[stat.key as keyof typeof stats] as number).toLocaleString()
              }
            </p>
          </div>
        ))}
      </div>

      {/* Recent Submissions */}
      <p style={styles.tableTitle}>Recent Card Submissions</p>
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['User', 'Card', 'Country', 'Value', 'Submitted', 'Status', 'Actions'].map((col) => (
                <th key={col} style={styles.th}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {submissions.map((row: any, i: number) => (
              <tr key={row.id} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F7F7F7' }}>
                <td style={styles.td}>{row.users?.username || '-'}</td>
                <td style={styles.td}>{row.cards?.name || '-'}</td>
                <td style={styles.td}>{row.card_countries?.country_name || '-'}</td>
                <td style={styles.td}>{formatNaira(row.payout_naira)}</td>
                <td style={styles.td}>{new Date(row.created_at).toLocaleDateString()}</td>
                <td style={styles.td}><StatusBadge status={row.status} /></td>
                <td style={styles.td}>
                  <div style={styles.actions}>
                    {row.status === 'pending' && (
                      <>
                        <button style={styles.approveBtn}>Approve</button>
                        <button style={styles.rejectBtn}>Reject</button>
                      </>
                    )}
                    <button style={styles.viewBtn}>View</button>
                  </div>
                </td>
              </tr>
            ))}
            {submissions.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#888888' }}>No submissions yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
    marginBottom: 0,
  },
  statCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 16,
  },
  statLabel: {
    fontSize: 11,
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 6,
    margin: '0 0 6px',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 800,
    color: '#111111',
    margin: 0,
  },
  tableTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#111111',
    marginTop: 24,
    marginBottom: 12,
  },
  tableWrapper: {
    overflowX: 'auto',
    borderRadius: 10,
    border: '1px solid #EEEEEE',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  th: {
    backgroundColor: '#111111',
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 700,
    padding: '10px 12px',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 12px',
    color: '#333333',
    fontSize: 12,
    minHeight: 52,
    verticalAlign: 'middle',
  },
  actions: {
    display: 'flex',
    gap: 6,
  },
  approveBtn: {
    backgroundColor: '#E8F5E9',
    color: '#2E7D32',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  rejectBtn: {
    backgroundColor: '#FFEBEE',
    color: '#C62828',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  viewBtn: {
    backgroundColor: '#E3F2FD',
    color: '#1565C0',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
