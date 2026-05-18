'use client';

import { useEffect, useState, useCallback } from 'react';

function formatNaira(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    success: { bg: 'var(--tone-success-bg)', color: 'var(--tone-success-fg)' },
    completed: { bg: 'var(--tone-success-bg)', color: 'var(--tone-success-fg)' },
    pending: { bg: 'var(--tone-warning-bg)', color: 'var(--tone-warning-fg)' },
    failed: { bg: 'var(--tone-danger-bg)', color: 'var(--tone-danger-fg)' },
  };
  const s = map[status] || { bg: 'var(--tone-neutral-bg)', color: 'var(--tone-neutral-fg)' };
  return (
    <span style={{
      backgroundColor: s.bg,
      color: s.color,
      padding: '3px 8px',
      borderRadius: 100,
      fontSize: 10,
      fontWeight: 700,
    }}>{status || '-'}</span>
  );
}

export default function TransfersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const limit = 25;

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
    const res = await fetch('/api/transfers?' + buildParams().toString());
    const json = await res.json();
    setRows(json.transfers || []);
    setTotal(json.total || 0);
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
    setTimeout(() => load(), 0);
  };

  const totalPages = Math.ceil(total / limit);

  const exportCSV = async () => {
    setExporting(true);
    const params = buildParams();
    params.set('csv', '1');
    params.delete('page');
    params.delete('limit');
    const res = await fetch('/api/transfers?' + params.toString());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transfers-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  return (
    <div>
      <div style={s.header}>
        <span style={s.title}>Transfers</span>
        <button style={s.exportBtn} onClick={exportCSV} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      <div style={s.filters}>
        <input
          placeholder="Search sender or recipient"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={s.filterInput}
        />
        <select value={type} onChange={(e) => setType(e.target.value)} style={s.filterSelect}>
          <option value="">All Types</option>
          <option value="tag">Tag Transfer</option>
          <option value="bank">Bank Transfer</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={s.filterSelect}>
          <option value="">All Statuses</option>
          <option value="success">Success</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={s.filterInput} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={s.filterInput} />
        <button style={s.applyBtn} onClick={applyFilters}>Apply</button>
        <button style={s.clearBtn} onClick={clearFilters}>Clear</button>
      </div>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {['Type', 'Sender', 'Recipient', 'Amount', 'Fee', 'Status', 'Date'].map((col) => (
                <th key={col} style={s.th}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: 'var(--fg-tertiary)' }}>Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: 'var(--fg-tertiary)' }}>No transfers found</td></tr>
            ) : rows.map((t: any, i: number) => {
              const senderName = t.sender?.username || t.sender?.full_name || '-';
              const recipientName = t.type === 'tag'
                ? (t.recipient?.username || t.recipient?.full_name || '-')
                : (t.recipient_account_name || '-');
              const recipientDetail = t.type === 'bank'
                ? `${t.recipient_bank_name || ''} - ${t.recipient_account_number || ''}`
                : '';
              return (
                <tr key={t.id} style={{ backgroundColor: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-subtle)' }}>
                  <td style={s.td}>
                    <span style={t.type === 'tag' ? s.tagBadge : s.bankBadge}>
                      {t.type === 'tag' ? 'Tag' : 'Bank'}
                    </span>
                  </td>
                  <td style={{ ...s.td, fontWeight: 600 }}>
                    <a href={`/users/${t.sender_id}`} style={{ color: 'var(--tone-info-fg)', textDecoration: 'none' }}>@{senderName}</a>
                  </td>
                  <td style={s.td}>
                    <div>{recipientName}</div>
                    {recipientDetail && <div style={{ fontSize: 10, color: 'var(--fg-tertiary)', marginTop: 2 }}>{recipientDetail}</div>}
                  </td>
                  <td style={{ ...s.td, fontWeight: 700 }}>{formatNaira(t.amount)}</td>
                  <td style={s.td}>{formatNaira(t.fee || 0)}</td>
                  <td style={s.td}><StatusBadge status={t.status} /></td>
                  <td style={s.td}>{new Date(t.created_at).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
  title: { fontSize: 15, fontWeight: 800, color: 'var(--fg-primary)' },
  exportBtn: { backgroundColor: 'var(--accent-base)', color: 'var(--accent-fg)', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  filters: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' },
  filterInput: { border: '1.5px solid var(--border-default)', borderRadius: 8, padding: '10px 14px', fontSize: 13, outline: 'none', minWidth: 140 },
  filterSelect: { border: '1.5px solid var(--border-default)', borderRadius: 8, padding: '10px 14px', fontSize: 13, outline: 'none', backgroundColor: 'var(--bg-surface)', minWidth: 120 },
  applyBtn: { backgroundColor: 'var(--accent-base)', color: 'var(--accent-fg)', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  clearBtn: { backgroundColor: 'var(--bg-subtle)', color: 'var(--fg-secondary)', border: '1px solid var(--border-default)', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  tableWrap: { overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border-default)', backgroundColor: 'var(--bg-surface)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: 'var(--accent-base)', color: 'var(--accent-fg)', fontSize: 12, fontWeight: 700, padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '12px 12px', color: 'var(--fg-secondary)', fontSize: 12, verticalAlign: 'middle' },
  tagBadge: { backgroundColor: 'var(--tone-info-bg)', color: 'var(--tone-info-fg)', padding: '3px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700 },
  bankBadge: { backgroundColor: 'var(--tone-purple-bg)', color: 'var(--tone-purple-fg)', padding: '3px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700 },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 },
  pageBtn: { backgroundColor: 'var(--bg-subtle)', color: 'var(--fg-secondary)', border: '1px solid var(--border-default)', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  pageInfo: { fontSize: 12, color: 'var(--fg-tertiary)' },
};
