'use client';

import { useEffect, useState } from 'react';

function formatNaira(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [exporting, setExporting] = useState(false);
  const limit = 25;

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('page', String(page));
    params.set('limit', String(limit));
    const res = await fetch('/api/users?' + params.toString());
    const json = await res.json();
    setUsers(json.users || []);
    setTotal(json.total || 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [page]);
  useEffect(() => { setPage(1); load(); }, [search]);

  const totalPages = Math.ceil(total / limit);

  const exportCSV = async () => {
    setExporting(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('csv', '1');
    const res = await fetch('/api/users?' + params.toString());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users-${Date.now()}.csv`;
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
        <span style={s.title}>Users</span>
        <div style={s.headerRight}>
          <input
            placeholder="Search name, username, or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={s.search}
          />
          <button style={s.exportBtn} onClick={exportCSV} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={s.statsRow}>
        <div style={s.statCard}>
          <p style={s.statLabel}>TOTAL USERS</p>
          <p style={s.statValue}>{total.toLocaleString()}</p>
        </div>
      </div>

      {/* Table */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {['Name', 'Username', 'Email', 'Phone', 'Balance', 'Trades', 'Status', 'Joined', 'Actions'].map((col) => (
                <th key={col} style={s.th}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: '#888' }}>Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No users found</td></tr>
            ) : users.map((u: any, i: number) => (
              <tr key={u.id} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F7F7F7' }}>
                <td style={{ ...s.td, fontWeight: 600 }}>{u.full_name || '-'}</td>
                <td style={s.td}>@{u.username || '-'}</td>
                <td style={s.td}>{u.email || '-'}</td>
                <td style={s.td}>{u.phone || '-'}</td>
                <td style={{ ...s.td, fontWeight: 700 }}>{formatNaira(u.balance)}</td>
                <td style={s.td}>{u.trades || 0}</td>
                <td style={s.td}>
                  {u.is_frozen ? (
                    <span style={s.badgeFrozen}>Frozen</span>
                  ) : u.is_active ? (
                    <span style={s.badgeActive}>Active</span>
                  ) : (
                    <span style={s.badgeInactive}>Inactive</span>
                  )}
                </td>
                <td style={s.td}>{new Date(u.created_at).toLocaleDateString()}</td>
                <td style={s.td}>
                  <a href={`/users/${u.id}`} style={s.viewBtn}>View</a>
                </td>
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
          <span style={s.pageInfo}>Page {page} of {totalPages}</span>
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
  headerRight: { display: 'flex', gap: 10, alignItems: 'center' },
  search: { width: 280, border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, outline: 'none' },
  exportBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  statsRow: { display: 'flex', gap: 12, marginBottom: 16 },
  statCard: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 16 },
  statLabel: { fontSize: 11, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 6px' },
  statValue: { fontSize: 24, fontWeight: 800, color: '#111111', margin: 0 },
  tableWrap: { overflowX: 'auto', borderRadius: 10, border: '1px solid #EEEEEE', backgroundColor: '#FFF' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: '#111111', color: '#FFFFFF', fontSize: 12, fontWeight: 700, padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '12px 12px', color: '#333333', fontSize: 12, verticalAlign: 'middle' },
  badgeActive: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: '3px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700 },
  badgeInactive: { backgroundColor: '#EBEBEB', color: '#888888', padding: '3px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700 },
  badgeFrozen: { backgroundColor: '#FFEBEE', color: '#C62828', padding: '3px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700 },
  viewBtn: { backgroundColor: '#E3F2FD', color: '#1565C0', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'inline-block' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 },
  pageBtn: { backgroundColor: '#F7F7F7', color: '#333', border: '1px solid #E8E8E8', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  pageInfo: { fontSize: 12, color: '#888' },
};
