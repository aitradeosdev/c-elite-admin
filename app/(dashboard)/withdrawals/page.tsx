'use client';

import { useEffect, useState, useCallback } from 'react';

type Tab = 'all' | 'pending_review' | 'held' | 'processing' | 'success' | 'failed' | 'refunded';

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending_review', label: 'Review Queue' },
  { key: 'held', label: 'Held' },
  { key: 'processing', label: 'Processing' },
  { key: 'success', label: 'Success' },
  { key: 'failed', label: 'Failed' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'all', label: 'All' },
];

const REJECT_REASONS = [
  'Suspicious activity',
  'Account under review',
  'Incorrect account details',
  'Duplicate withdrawal',
  'Gateway unavailable',
];

function formatNaira(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    success: { bg: '#E8F5E9', color: '#2E7D32' },
    processing: { bg: '#FFF8E1', color: '#F9A825' },
    initiated: { bg: '#FFF8E1', color: '#F9A825' },
    pending_review: { bg: '#FFF3E0', color: '#EF6C00' },
    held: { bg: '#FFEBEE', color: '#C62828' },
    failed: { bg: '#FFEBEE', color: '#C62828' },
    refunded: { bg: '#F3E5F5', color: '#6A1B9A' },
  };
  const st = map[status] || { bg: '#EBEBEB', color: '#888888' };
  return (
    <span style={{
      display: 'inline-block', backgroundColor: st.bg, color: st.color,
      padding: '3px 10px', borderRadius: 100, fontSize: 10, fontWeight: 700,
    }}>{(status || '-').replace(/_/g, ' ')}</span>
  );
}

export default function WithdrawalsPage() {
  const [tab, setTab] = useState<Tab>('pending_review');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCustom, setRejectCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('status', tab);
    if (search) params.set('search', search);
    params.set('limit', '200');
    const res = await fetch('/api/withdrawals?' + params.toString());
    const json = await res.json();
    setRows(json.withdrawals || []);
    setTotal(json.total || 0);
    if (!silent) setLoading(false);
  }, [tab, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { load(true); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail({ id });
    const res = await fetch('/api/withdrawals?id=' + id);
    const json = await res.json();
    setDetail(json.withdrawal || null);
    setDetailLoading(false);
  };

  const closeDetail = () => {
    setDetail(null);
    setShowApprove(false);
    setShowReject(false);
    setRejectReason('');
    setRejectCustom('');
    setErr('');
  };

  const doApprove = async () => {
    if (!detail?.id) return;
    setBusy(true); setErr('');
    const res = await fetch(`/api/withdrawals/${detail.id}/approve`, { method: 'POST' });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(json?.error || 'Approve failed'); return; }
    closeDetail();
    load();
  };

  const doReject = async () => {
    if (!detail?.id) return;
    const reason = (rejectCustom.trim() || rejectReason).trim();
    if (!reason) { setErr('Pick or enter a reason'); return; }
    setBusy(true); setErr('');
    const res = await fetch(`/api/withdrawals/${detail.id}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(json?.error || 'Reject failed'); return; }
    closeDetail();
    load();
  };

  const exportCSV = async () => {
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('status', tab);
    if (search) params.set('search', search);
    params.set('csv', '1');
    const res = await fetch('/api/withdrawals?' + params.toString());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `withdrawals-${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const canAct = (status: string) => status === 'pending_review' || status === 'held';

  return (
    <div>
      <div style={s.header}>
        <span style={s.title}>Withdrawals</span>
        <button style={s.exportBtn} onClick={exportCSV}>Export CSV</button>
      </div>

      <div style={s.tabBar}>
        <div style={s.tabs}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ ...s.tabBtn, ...(tab === t.key ? s.tabBtnActive : {}) }}
            >{t.label}</button>
          ))}
        </div>
        <input
          placeholder="Search user or account"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={s.search}
        />
      </div>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {['User', 'Amount', 'Bank', 'Account', 'Gateway Ref', 'Requested', 'Status', 'Actions'].map((c) => (
                <th key={c} style={s.th}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#888' }}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No withdrawals</td></tr>
            )}
            {rows.map((w: any) => (
              <tr key={w.id} style={{ backgroundColor: canAct(w.status) ? '#FFFDE7' : '#FFFFFF' }}>
                <td style={{ ...s.td, fontWeight: 600 }}>
                  @{w.user?.username || w.user?.full_name || '-'}
                </td>
                <td style={{ ...s.td, fontWeight: 700, color: '#2E7D32' }}>{formatNaira(w.amount)}</td>
                <td style={s.td}>{w.bank_name || '-'}</td>
                <td style={s.td}>
                  <div>{w.account_name || '-'}</div>
                  <div style={s.sub}>{w.account_number || '-'}</div>
                </td>
                <td style={s.td}>{w.gateway_reference || '-'}</td>
                <td style={s.td}>{new Date(w.created_at).toLocaleString()}</td>
                <td style={s.td}><StatusBadge status={w.status} /></td>
                <td style={s.td}>
                  <div style={s.actions}>
                    {canAct(w.status) && (
                      <>
                        <button style={s.approveBtn} onClick={() => { openDetail(w.id); setShowApprove(true); }}>Approve</button>
                        <button style={s.rejectBtn} onClick={() => { openDetail(w.id); setShowReject(true); }}>Reject</button>
                      </>
                    )}
                    <button style={s.viewBtn} onClick={() => openDetail(w.id)}>View</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div style={s.totalBar}>{total.toLocaleString()} total</div>
      )}

      {detail && (
        <>
          <div style={s.panelDim} onClick={closeDetail} />
          <div style={s.panel}>
            <div style={s.panelHead}>
              <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Withdrawal</p>
              <button style={s.closeBtn} onClick={closeDetail}>×</button>
            </div>
            {detailLoading || !detail.user ? (
              <p style={{ padding: 16, color: '#888' }}>Loading…</p>
            ) : (
              <div style={s.panelBody}>
                <div style={s.userRow}>
                  <div style={s.avatar}>{(detail.user.full_name || '?').charAt(0).toUpperCase()}</div>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{detail.user.full_name}</p>
                    <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>{detail.user.email}</p>
                    <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>@{detail.user.username}</p>
                    {detail.user.phone && <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>{detail.user.phone}</p>}
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <Row label="Amount" value={formatNaira(detail.amount)} bold />
                  <Row label="Bank" value={detail.bank_name} />
                  <Row label="Account Name" value={detail.account_name} />
                  <Row label="Account Number" value={detail.account_number} />
                  <Row label="Gateway" value={detail.gateway || '-'} />
                  <Row label="Gateway Ref" value={detail.gateway_reference || '-'} />
                  <Row label="Status" value={<StatusBadge status={detail.status} />} />
                  {detail.failure_reason && <Row label="Reason" value={detail.failure_reason} />}
                  <Row label="Requested" value={new Date(detail.created_at).toLocaleString()} />
                </div>

                {detail.flag && (
                  <div style={s.flagBox}>
                    <div style={s.flagTitle}>Flagged</div>
                    <div style={s.flagText}>{detail.flag.flag_reason}</div>
                    <div style={s.flagMeta}>at {new Date(detail.flag.created_at).toLocaleString()}</div>
                  </div>
                )}

                {err && <div style={s.errorBar}>{err}</div>}

                {canAct(detail.status) && (
                  <>
                    {showApprove && (
                      <div style={s.confirmBox}>
                        <p style={s.confirmTitle}>Approve withdrawal of {formatNaira(detail.amount)}?</p>
                        <p style={s.confirmBody}>This will fire the gateway transfer to {detail.account_name} ({detail.bank_name}).</p>
                        <div style={s.confirmRow}>
                          <button style={s.cancelBtn} onClick={() => setShowApprove(false)} disabled={busy}>Cancel</button>
                          <button style={{ ...s.approveBtnLg, opacity: busy ? 0.5 : 1 }} onClick={doApprove} disabled={busy}>
                            {busy ? 'Approving…' : 'Confirm Approve'}
                          </button>
                        </div>
                      </div>
                    )}

                    {showReject && (
                      <div style={s.confirmBox}>
                        <p style={s.confirmTitle}>Reject withdrawal</p>
                        <p style={s.confirmBody}>Funds ({formatNaira(detail.amount)}) will be refunded to the user&apos;s wallet.</p>
                        <div style={s.reasonList}>
                          {REJECT_REASONS.map((r) => (
                            <label key={r} style={s.reasonRow}>
                              <input
                                type="radio"
                                name="reason"
                                value={r}
                                checked={rejectReason === r}
                                onChange={() => { setRejectReason(r); setRejectCustom(''); }}
                              />
                              <span>{r}</span>
                            </label>
                          ))}
                        </div>
                        <textarea
                          placeholder="Or custom reason"
                          value={rejectCustom}
                          onChange={(e) => { setRejectCustom(e.target.value); setRejectReason(''); }}
                          style={s.textarea}
                          rows={3}
                          maxLength={500}
                        />
                        <div style={s.confirmRow}>
                          <button style={s.cancelBtn} onClick={() => setShowReject(false)} disabled={busy}>Cancel</button>
                          <button style={{ ...s.rejectBtnLg, opacity: busy ? 0.5 : 1 }} onClick={doReject} disabled={busy}>
                            {busy ? 'Rejecting…' : 'Confirm Reject'}
                          </button>
                        </div>
                      </div>
                    )}

                    {!showApprove && !showReject && (
                      <div style={s.actionRow}>
                        <button style={s.approveBtnLg} onClick={() => setShowApprove(true)}>Approve</button>
                        <button style={s.rejectBtnLg} onClick={() => setShowReject(true)}>Reject</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: any; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F0F0F0' }}>
      <span style={{ fontSize: 12, color: '#888' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#111', fontWeight: bold ? 800 : 500, textAlign: 'right' }}>{value ?? '-'}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 15, fontWeight: 800, color: '#111111' },
  exportBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  tabBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  tabs: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  tabBtn: { backgroundColor: '#F7F7F7', color: '#333', borderWidth: 1, borderStyle: 'solid', borderColor: '#E8E8E8', borderRadius: 100, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  tabBtnActive: { backgroundColor: '#111', color: '#FFF', borderColor: '#111' },
  search: { border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, outline: 'none', minWidth: 240 },
  tableWrap: { overflowX: 'auto', borderRadius: 10, border: '1px solid #EEEEEE', backgroundColor: '#FFF' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: '#111111', color: '#FFFFFF', fontSize: 12, fontWeight: 700, padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '12px 12px', color: '#333333', fontSize: 12, verticalAlign: 'middle' },
  sub: { fontSize: 10, color: '#888', marginTop: 2 },
  actions: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  approveBtn: { backgroundColor: '#2E7D32', color: '#FFF', border: 'none', borderRadius: 100, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  rejectBtn: { backgroundColor: '#C62828', color: '#FFF', border: 'none', borderRadius: 100, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  viewBtn: { backgroundColor: '#F7F7F7', color: '#333', border: '1px solid #E8E8E8', borderRadius: 100, padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  totalBar: { fontSize: 11, color: '#888', marginTop: 12, textAlign: 'right' },
  panelDim: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)', zIndex: 40 },
  panel: { position: 'fixed', top: 0, right: 0, height: '100vh', width: 520, maxWidth: '90vw', backgroundColor: '#FFF', boxShadow: '-6px 0 30px rgba(0,0,0,0.15)', zIndex: 50, overflowY: 'auto' },
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid #EEE' },
  closeBtn: { backgroundColor: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666' },
  panelBody: { padding: 16 },
  userRow: { display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 14, borderBottom: '1px solid #EEE' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#111', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 },
  flagBox: { marginTop: 16, padding: 12, backgroundColor: '#FFF3E0', border: '1px solid #FFE0B2', borderRadius: 10 },
  flagTitle: { fontSize: 11, fontWeight: 800, color: '#EF6C00', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  flagText: { fontSize: 13, color: '#BF360C', fontWeight: 600 },
  flagMeta: { fontSize: 11, color: '#888', marginTop: 4 },
  actionRow: { display: 'flex', gap: 10, marginTop: 18 },
  approveBtnLg: { flex: 1, backgroundColor: '#2E7D32', color: '#FFF', border: 'none', borderRadius: 100, padding: '12px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  rejectBtnLg: { flex: 1, backgroundColor: '#C62828', color: '#FFF', border: 'none', borderRadius: 100, padding: '12px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  confirmBox: { marginTop: 18, padding: 14, backgroundColor: '#FAFAFA', border: '1px solid #EEE', borderRadius: 10 },
  confirmTitle: { fontSize: 13, fontWeight: 700, color: '#111', margin: '0 0 6px' },
  confirmBody: { fontSize: 12, color: '#666', margin: '0 0 12px', lineHeight: 1.5 },
  confirmRow: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 },
  cancelBtn: { backgroundColor: '#F7F7F7', color: '#333', border: '1px solid #E8E8E8', borderRadius: 100, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  reasonList: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 },
  reasonRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#333', cursor: 'pointer' },
  textarea: { width: '100%', border: '1.5px solid #E8E8E8', borderRadius: 8, padding: 10, fontSize: 12, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' },
  errorBar: { backgroundColor: '#FFEBEE', color: '#C62828', padding: '10px 12px', borderRadius: 8, fontSize: 12, marginTop: 12 },
};
