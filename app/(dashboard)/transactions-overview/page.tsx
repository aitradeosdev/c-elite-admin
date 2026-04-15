'use client';

import { useEffect, useState, useCallback } from 'react';

function formatNaira(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    success: { bg: '#E8F5E9', color: '#2E7D32' },
    completed: { bg: '#E8F5E9', color: '#2E7D32' },
    pending: { bg: '#FFF8E1', color: '#F9A825' },
    processing: { bg: '#FFF8E1', color: '#F9A825' },
    failed: { bg: '#FFEBEE', color: '#C62828' },
    refunded: { bg: '#F3E5F5', color: '#6A1B9A' },
    pending_review: { bg: '#FFF8E1', color: '#F9A825' },
  };
  const s = map[status] || { bg: '#EBEBEB', color: '#888888' };
  return (
    <span style={{
      backgroundColor: s.bg,
      color: s.color,
      padding: '3px 8px',
      borderRadius: 100,
      fontSize: 10,
      fontWeight: 700,
    }}>{status?.replace(/_/g, ' ') || '-'}</span>
  );
}

const TYPE_OPTIONS = ['', 'card_trade', 'withdrawal', 'transfer', 'bill_payment', 'referral_bonus', 'coupon_bonus', 'manual_credit', 'task_reward', 'giftbox'];
const STATUS_OPTIONS = ['', 'success', 'pending', 'processing', 'failed', 'refunded', 'pending_review'];

export default function TransactionsOverviewPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState({ totalCount: 0, totalAmount: 0, todayCount: 0, todayAmount: 0 });
  const [exporting, setExporting] = useState(false);
  const limit = 25;

  // Filters
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (search) params.set('search', search);
    params.set('page', String(page));
    params.set('limit', String(limit));
    return params;
  }, [type, status, dateFrom, dateTo, search, page]);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/transactions?' + buildParams().toString());
    const json = await res.json();
    setRows(json.transactions || []);
    setTotal(json.total || 0);
    setStats(json.stats || { totalCount: 0, totalAmount: 0, todayCount: 0, todayAmount: 0 });
    setLoading(false);
  };

  useEffect(() => { load(); }, [page]);

  const applyFilters = () => { setPage(1); load(); };

  const clearFilters = () => {
    setType('');
    setStatus('');
    setDateFrom('');
    setDateTo('');
    setSearch('');
    setPage(1);
    // Trigger load after state clears
    setTimeout(() => load(), 0);
  };

  const totalPages = Math.ceil(total / limit);

  const exportCSV = async () => {
    setExporting(true);
    const params = buildParams();
    params.set('csv', '1');
    params.delete('page');
    params.delete('limit');
    const res = await fetch('/api/transactions?' + params.toString());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  return (
    <div>
      {/* Header */}
      <div style={s.header}>
        <span style={s.title}>Transactions Overview</span>
        <button style={s.exportBtn} onClick={exportCSV} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Stats */}
      <div style={s.statsGrid}>
        <div style={s.statCard}>
          <p style={s.statLabel}>TOTAL TRANSACTIONS</p>
          <p style={s.statValue}>{stats.totalCount.toLocaleString()}</p>
        </div>
        <div style={s.statCard}>
          <p style={s.statLabel}>TOTAL VOLUME</p>
          <p style={s.statValue}>{formatNaira(stats.totalAmount)}</p>
        </div>
        <div style={s.statCard}>
          <p style={s.statLabel}>TODAY TRANSACTIONS</p>
          <p style={s.statValue}>{stats.todayCount.toLocaleString()}</p>
        </div>
        <div style={s.statCard}>
          <p style={s.statLabel}>TODAY VOLUME</p>
          <p style={s.statValue}>{formatNaira(stats.todayAmount)}</p>
        </div>
      </div>

      {/* Filters */}
      <div style={s.filters}>
        <input
          placeholder="Search user"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={s.filterInput}
        />
        <select value={type} onChange={(e) => setType(e.target.value)} style={s.filterSelect}>
          <option value="">All Types</option>
          {TYPE_OPTIONS.filter(Boolean).map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={s.filterSelect}>
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.filter(Boolean).map((st) => (
            <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={s.filterInput} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={s.filterInput} />
        <button style={s.applyBtn} onClick={applyFilters}>Apply</button>
        <button style={s.clearBtn} onClick={clearFilters}>Clear</button>
      </div>

      {/* Table */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {['User', 'Type', 'Amount', 'Status', 'Reference', 'Date'].map((col) => (
                <th key={col} style={s.th}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: '#888' }}>Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No transactions found</td></tr>
            ) : rows.map((t: any, i: number) => (
              <tr key={t.id} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F7F7F7' }}>
                <td style={{ ...s.td, fontWeight: 600 }}>
                  {t.users?.username ? (
                    <a href={`/users/${t.user_id}`} style={{ color: '#1565C0', textDecoration: 'none' }}>@{t.users.username}</a>
                  ) : '-'}
                </td>
                <td style={s.td}>
                  <span style={s.typeBadge}>{(t.type || '-').replace(/_/g, ' ')}</span>
                </td>
                <td style={{ ...s.td, fontWeight: 700 }}>{formatNaira(t.amount)}</td>
                <td style={s.td}><StatusBadge status={t.status} /></td>
                <td style={{ ...s.td, fontSize: 11, color: '#888', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.reference_id || '-'}</td>
                <td style={s.td}>{new Date(t.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={s.pagination}>
          <button
            style={{ ...s.pageBtn, opacity: page <= 1 ? 0.4 : 1 }}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >Previous</button>
          <span style={s.pageInfo}>Page {page} of {totalPages} ({total.toLocaleString()} results)</span>
          <button
            style={{ ...s.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >Next</button>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 15, fontWeight: 800, color: '#111111' },
  exportBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 },
  statCard: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 16 },
  statLabel: { fontSize: 11, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 6px' },
  statValue: { fontSize: 24, fontWeight: 800, color: '#111111', margin: 0 },
  filters: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' },
  filterInput: { border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, outline: 'none', minWidth: 140 },
  filterSelect: { border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, outline: 'none', backgroundColor: '#FFFFFF', minWidth: 120 },
  applyBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  clearBtn: { backgroundColor: '#F7F7F7', color: '#333333', border: '1px solid #E8E8E8', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  tableWrap: { overflowX: 'auto', borderRadius: 10, border: '1px solid #EEEEEE', backgroundColor: '#FFF' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: '#111111', color: '#FFFFFF', fontSize: 12, fontWeight: 700, padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '12px 12px', color: '#333333', fontSize: 12, verticalAlign: 'middle' },
  typeBadge: { backgroundColor: '#F3E5F5', color: '#6A1B9A', padding: '3px 8px', borderRadius: 100, fontSize: 10, fontWeight: 600, textTransform: 'capitalize' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 },
  pageBtn: { backgroundColor: '#F7F7F7', color: '#333', border: '1px solid #E8E8E8', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  pageInfo: { fontSize: 12, color: '#888' },
};
