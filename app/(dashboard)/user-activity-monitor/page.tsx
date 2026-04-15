'use client';

import { useEffect, useState, useCallback } from 'react';

function formatNaira(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function UserActivityMonitorPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [onlyOnline, setOnlyOnline] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [err, setErr] = useState('');
  const limit = 25;

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (search) p.set('search', search);
    if (onlyOnline) p.set('online', '1');
    p.set('page', String(page));
    p.set('limit', String(limit));
    return p;
  }, [search, onlyOnline, page]);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/user-activity-monitor?' + buildParams().toString());
    if (res.status === 403) { setErr('Forbidden (super-admin only)'); setLoading(false); return; }
    const json = await res.json();
    setRows(json.users || []);
    setTotal(json.total || 0);
    setOnlineCount(json.online_count || 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, onlyOnline]);
  useEffect(() => {
    const t = setInterval(() => { load(); }, 30000);
    return () => clearInterval(t);
  }, [page, onlyOnline, search]);

  const openDetail = async (id: string) => {
    setSelected(id); setDetail(null); setDetailLoading(true); setErr('');
    const res = await fetch(`/api/user-activity-monitor/${id}`);
    const json = await res.json();
    if (!res.ok) { setErr(json?.error || 'Load failed'); setDetailLoading(false); return; }
    setDetail(json);
    setDetailLoading(false);
  };

  const terminate = async () => {
    if (!selected || !detail?.user) return;
    if (!confirm(`Force log out @${detail.user.username || detail.user.full_name}? All active sessions will be revoked.`)) return;
    setActionBusy(true); setErr('');
    const res = await fetch(`/api/user-activity-monitor/${selected}/terminate`, { method: 'POST' });
    const json = await res.json();
    setActionBusy(false);
    if (!res.ok) { setErr(json?.error || 'Terminate failed'); return; }
    await openDetail(selected);
    load();
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div style={s.header}>
        <span style={s.title}>User Activity Monitor</span>
        <div style={s.statBlock}>
          <span style={s.dotOnline} />
          <span style={s.statLabel}>{onlineCount.toLocaleString()} online now</span>
        </div>
      </div>

      {err && <div style={s.errorBar}>{err}</div>}

      <div style={s.filters}>
        <input
          placeholder="Search username, name, email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (setPage(1), load())}
          style={s.filterInput}
        />
        <label style={s.toggleLabel}>
          <input type="checkbox" checked={onlyOnline} onChange={(e) => { setOnlyOnline(e.target.checked); setPage(1); }} />
          <span style={{ marginLeft: 6 }}>Online only</span>
        </label>
        <button style={s.applyBtn} onClick={() => { setPage(1); load(); }}>Apply</button>
      </div>

      <div style={s.layout}>
        <div style={s.listPane}>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['User', 'Email', 'Last Active', 'Status'].map(c => <th key={c} style={s.th}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} style={{ ...s.td, textAlign: 'center', color: '#888' }}>Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={4} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No users</td></tr>
                ) : rows.map((u: any, i: number) => (
                  <tr
                    key={u.id}
                    onClick={() => openDetail(u.id)}
                    style={{
                      backgroundColor: selected === u.id ? '#FFF3E0' : (i % 2 === 0 ? '#FFFFFF' : '#F7F7F7'),
                      cursor: 'pointer',
                    }}
                  >
                    <td style={{ ...s.td, fontWeight: 600 }}>
                      {u.is_online && <span style={s.dotOnlineSmall} />}
                      @{u.username || u.full_name || '-'}
                    </td>
                    <td style={s.td}>{u.email || '-'}</td>
                    <td style={s.td}>{timeAgo(u.last_active_at)}</td>
                    <td style={s.td}>
                      {u.is_frozen ? <span style={s.frozenBadge}>Frozen</span> :
                       u.is_online ? <span style={s.onlineBadge}>Online</span> :
                       <span style={s.offlineBadge}>Offline</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={s.pagination}>
              <button style={{ ...s.pageBtn, opacity: page <= 1 ? 0.4 : 1 }} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Previous</button>
              <span style={s.pageInfo}>Page {page} of {totalPages}</span>
              <button style={{ ...s.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
            </div>
          )}
        </div>

        <div style={s.detailPane}>
          {!selected ? (
            <div style={s.emptyDetail}>Select a user to view activity detail.</div>
          ) : detailLoading ? (
            <div style={s.emptyDetail}>Loading...</div>
          ) : !detail?.user ? (
            <div style={s.emptyDetail}>User not found.</div>
          ) : (
            <>
              <div style={s.detailHeader}>
                <div>
                  <div style={s.detailName}>@{detail.user.username || detail.user.full_name}</div>
                  <div style={s.detailSub}>{detail.user.email}{detail.user.phone ? ' · ' + detail.user.phone : ''}</div>
                </div>
                <button
                  style={{ ...s.terminateBtn, opacity: actionBusy ? 0.5 : 1 }}
                  onClick={terminate}
                  disabled={actionBusy}
                >{actionBusy ? 'Terminating...' : 'Terminate Sessions'}</button>
              </div>

              <div style={s.sectionLabel}>Sessions</div>
              {detail.sessions.length === 0 ? <div style={s.muted}>No sessions.</div> : (
                <div style={s.scrollBox}>
                  {detail.sessions.map((se: any) => (
                    <div key={se.id} style={s.sessionCard}>
                      <div style={s.sessionRow}>
                        <span style={{ fontSize: 11, color: '#888' }}>{new Date(se.created_at).toLocaleString()}</span>
                        {se.ended_at
                          ? <span style={s.endedPill}>Ended {timeAgo(se.ended_at)}</span>
                          : <span style={s.activePill}>Active</span>}
                      </div>
                      <div style={s.sessionMeta}>IP: {se.ip_address || '-'}</div>
                      <div style={s.sessionMeta}>
                        {[se.device_model, se.os_version, se.app_version].filter(Boolean).join(' · ') || '-'}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={s.sectionLabel}>Recent Withdrawals</div>
              {detail.withdrawals.length === 0 ? <div style={s.muted}>None.</div> : (
                <div style={s.scrollBox}>
                  {detail.withdrawals.map((w: any) => (
                    <div key={w.id} style={s.actionRow}>
                      <span style={{ fontWeight: 700 }}>{formatNaira(w.amount)}</span>
                      <span style={s.muted2}>{w.bank_name} · {w.account_name}</span>
                      <span style={s.statusTag}>{w.status}</span>
                      <span style={s.muted2}>{timeAgo(w.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={s.sectionLabel}>Recent Transfers</div>
              {detail.transfers.length === 0 ? <div style={s.muted}>None.</div> : (
                <div style={s.scrollBox}>
                  {detail.transfers.map((t: any) => (
                    <div key={t.id} style={s.actionRow}>
                      <span style={{ fontWeight: 700 }}>{formatNaira(t.amount)}</span>
                      <span style={s.muted2}>{t.type}</span>
                      <span style={s.statusTag}>{t.status}</span>
                      <span style={s.muted2}>{timeAgo(t.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={s.sectionLabel}>Recent Transactions</div>
              {detail.transactions.length === 0 ? <div style={s.muted}>None.</div> : (
                <div style={s.scrollBox}>
                  {detail.transactions.map((tx: any) => (
                    <div key={tx.id} style={s.actionRow}>
                      <span style={{ fontWeight: 700 }}>{formatNaira(tx.amount)}</span>
                      <span style={s.muted2}>{tx.type}</span>
                      <span style={s.statusTag}>{tx.status}</span>
                      <span style={s.muted2}>{timeAgo(tx.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 15, fontWeight: 800, color: '#111111' },
  statBlock: { display: 'flex', alignItems: 'center', gap: 8, backgroundColor: '#FFF', padding: '8px 14px', borderRadius: 100, border: '1px solid #E8E8E8' },
  dotOnline: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2E7D32', display: 'inline-block' },
  dotOnlineSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2E7D32', display: 'inline-block', marginRight: 6 },
  statLabel: { fontSize: 12, fontWeight: 700, color: '#2E7D32' },
  errorBar: { backgroundColor: '#FFEBEE', color: '#C62828', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
  filters: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' },
  filterInput: { border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, outline: 'none', minWidth: 260 },
  toggleLabel: { fontSize: 12, fontWeight: 600, color: '#333', display: 'flex', alignItems: 'center', cursor: 'pointer' },
  applyBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  layout: { display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' },
  listPane: {},
  detailPane: { backgroundColor: '#FFF', border: '1px solid #EEE', borderRadius: 10, padding: 18, minHeight: 400 },
  emptyDetail: { textAlign: 'center', color: '#888', fontSize: 13, padding: 40 },
  detailHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid #EEE' },
  detailName: { fontSize: 16, fontWeight: 800, color: '#111' },
  detailSub: { fontSize: 12, color: '#888', marginTop: 3 },
  terminateBtn: { backgroundColor: '#C62828', color: '#FFF', border: 'none', borderRadius: 100, padding: '8px 16px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },
  scrollBox: { maxHeight: 180, overflowY: 'auto', border: '1px solid #F0F0F0', borderRadius: 8 },
  sessionCard: { padding: 10, borderBottom: '1px solid #F0F0F0' },
  sessionRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sessionMeta: { fontSize: 11, color: '#666', marginTop: 2 },
  activePill: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: '2px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700 },
  endedPill: { backgroundColor: '#EEE', color: '#666', padding: '2px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700 },
  actionRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderBottom: '1px solid #F0F0F0', fontSize: 12 },
  statusTag: { backgroundColor: '#F7F7F7', color: '#555', padding: '2px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700 },
  muted: { fontSize: 12, color: '#888', padding: '6px 0' },
  muted2: { fontSize: 11, color: '#888' },
  tableWrap: { overflowX: 'auto', borderRadius: 10, border: '1px solid #EEEEEE', backgroundColor: '#FFF' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: '#111111', color: '#FFFFFF', fontSize: 12, fontWeight: 700, padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '10px 12px', color: '#333333', fontSize: 12, verticalAlign: 'middle' },
  onlineBadge: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: '3px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700 },
  offlineBadge: { backgroundColor: '#EEE', color: '#666', padding: '3px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700 },
  frozenBadge: { backgroundColor: '#FFEBEE', color: '#C62828', padding: '3px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700 },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 },
  pageBtn: { backgroundColor: '#F7F7F7', color: '#333', border: '1px solid #E8E8E8', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  pageInfo: { fontSize: 12, color: '#888' },
};
