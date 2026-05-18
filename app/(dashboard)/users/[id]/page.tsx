'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

function formatNaira(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    success: { bg: 'var(--tone-success-bg)', color: 'var(--tone-success-fg)' },
    completed: { bg: 'var(--tone-success-bg)', color: 'var(--tone-success-fg)' },
    pending: { bg: 'var(--tone-warning-bg)', color: 'var(--tone-warning-fg)' },
    processing: { bg: 'var(--tone-warning-bg)', color: 'var(--tone-warning-fg)' },
    failed: { bg: 'var(--tone-danger-bg)', color: 'var(--tone-danger-fg)' },
    refunded: { bg: 'var(--tone-purple-bg)', color: 'var(--tone-purple-fg)' },
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

export default function UserDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [freezing, setFreezing] = useState(false);
  const [showFreezeModal, setShowFreezeModal] = useState(false);
  const [freezeReason, setFreezeReason] = useState('');
  const [freezeError, setFreezeError] = useState('');
  const [activeTab, setActiveTab] = useState<'transactions' | 'devices' | 'logins'>('transactions');

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/users/${id}`);
    if (res.ok) {
      const json = await res.json();
      setData(json);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const handleFreeze = async () => {
    if (!freezeReason.trim()) { setFreezeError('Reason is required'); return; }
    setFreezing(true);
    setFreezeError('');
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'freeze', reason: freezeReason.trim() }),
    });
    const json = await res.json();
    setFreezing(false);
    if (!res.ok) { setFreezeError(json.error || 'Failed'); return; }
    setShowFreezeModal(false);
    setFreezeReason('');
    load();
  };

  const handleUnfreeze = async () => {
    setFreezing(true);
    await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unfreeze' }),
    });
    setFreezing(false);
    load();
  };

  if (loading) return <p style={{ color: 'var(--fg-tertiary)', fontSize: 13 }}>Loading...</p>;
  if (!data || !data.user) return <p style={{ color: 'var(--fg-tertiary)', fontSize: 13 }}>User not found</p>;

  const user = data.user;
  const stats = data.stats || {};

  return (
    <div>
      <div style={s.topBar}>
        <a href="/users" style={s.backLink}>&larr; Back to Users</a>
      </div>

      <div style={s.profileCard}>
        <div style={s.avatarRow}>
          <div style={s.avatar}>{(user.full_name || '?').charAt(0).toUpperCase()}</div>
          <div>
            <p style={s.profileName}>{user.full_name || '-'}</p>
            <p style={s.profileUsername}>@{user.username || '-'}</p>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {user.is_frozen ? (
              <>
                <span style={s.frozenBadge}>Frozen</span>
                <button style={s.unfreezeBtn} onClick={handleUnfreeze} disabled={freezing}>
                  {freezing ? 'Unfreezing...' : 'Unfreeze'}
                </button>
              </>
            ) : (
              <button style={s.freezeBtn} onClick={() => setShowFreezeModal(true)} disabled={freezing}>
                Freeze Account
              </button>
            )}
          </div>
        </div>

        {user.is_frozen && user.freeze_reason && (
          <div style={s.freezeReasonBox}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tone-danger-fg)', textTransform: 'uppercase' }}>Freeze Reason:</span>{' '}
            <span style={{ fontSize: 12, color: 'var(--fg-secondary)' }}>{user.freeze_reason}</span>
          </div>
        )}

        <div style={s.infoGrid}>
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="Phone" value={user.phone} />
          <InfoRow label="Country" value={user.country} />
          <InfoRow label="Balance" value={formatNaira(user.balance)} bold />
          <InfoRow label="Referral Code" value={user.referral_code} />
          <InfoRow label="Joined" value={new Date(user.created_at).toLocaleDateString()} />
        </div>

        <div style={s.statsGrid}>
          <div style={s.miniStat}>
            <p style={s.miniLabel}>TRADES</p>
            <p style={s.miniValue}>{stats.trades || 0}</p>
          </div>
          <div style={s.miniStat}>
            <p style={s.miniLabel}>WITHDRAWALS</p>
            <p style={s.miniValue}>{stats.withdrawals || 0}</p>
          </div>
          <div style={s.miniStat}>
            <p style={s.miniLabel}>TRANSFERS</p>
            <p style={s.miniValue}>{stats.transfers || 0}</p>
          </div>
        </div>
      </div>

      <div style={s.tabs}>
        {(['transactions', 'devices', 'logins'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              ...s.tabBtn,
              ...(activeTab === t ? s.tabBtnActive : {}),
            }}
          >{t === 'transactions' ? 'Recent Transactions' : t === 'devices' ? 'Device Logs' : 'Login History'}</button>
        ))}
      </div>

      {activeTab === 'transactions' && (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Type', 'Amount', 'Status', 'Date'].map((col) => (
                  <th key={col} style={s.th}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.recentTransactions || []).length === 0 ? (
                <tr><td colSpan={4} style={{ ...s.td, textAlign: 'center', color: 'var(--fg-tertiary)' }}>No transactions</td></tr>
              ) : (data.recentTransactions || []).map((t: any, i: number) => (
                <tr key={t.id} style={{ backgroundColor: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-subtle)' }}>
                  <td style={s.td}>
                    <span style={s.typeBadge}>{(t.type || '-').replace(/_/g, ' ')}</span>
                  </td>
                  <td style={{ ...s.td, fontWeight: 700 }}>{formatNaira(t.amount)}</td>
                  <td style={s.td}><StatusBadge status={t.status} /></td>
                  <td style={s.td}>{new Date(t.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'devices' && (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Device', 'OS', 'App Version', 'IP Address', 'Date'].map((col) => (
                  <th key={col} style={s.th}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.devices || []).length === 0 ? (
                <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: 'var(--fg-tertiary)' }}>No device logs</td></tr>
              ) : (data.devices || []).map((d: any, i: number) => (
                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-subtle)' }}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{d.device_model || '-'}</td>
                  <td style={s.td}>{d.os_version || '-'}</td>
                  <td style={s.td}>{d.app_version || '-'}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11 }}>{d.ip_address || '-'}</td>
                  <td style={s.td}>{new Date(d.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'logins' && (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Device', 'OS', 'App Version', 'IP Address', 'Date'].map((col) => (
                  <th key={col} style={s.th}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.logins || []).length === 0 ? (
                <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: 'var(--fg-tertiary)' }}>No login history</td></tr>
              ) : (data.logins || []).map((l: any, i: number) => (
                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-subtle)' }}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{l.device_model || '-'}</td>
                  <td style={s.td}>{l.os_version || '-'}</td>
                  <td style={s.td}>{l.app_version || '-'}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11 }}>{l.ip_address || '-'}</td>
                  <td style={s.td}>{new Date(l.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showFreezeModal && (
        <>
          <div style={s.modalOverlay} onClick={() => setShowFreezeModal(false)} />
          <div style={s.modal}>
            <p style={s.modalTitle}>Freeze Account</p>
            <p style={{ fontSize: 13, color: 'var(--fg-secondary)', margin: '0 0 12px' }}>
              Freezing <strong>@{user.username}</strong> will block all transactions, withdrawals, and transfers.
            </p>
            <label style={s.fieldLabel}>REASON</label>
            <textarea
              value={freezeReason}
              onChange={(e) => setFreezeReason(e.target.value)}
              placeholder="Why is this account being frozen?"
              style={s.textarea}
            />
            {freezeError && <p style={{ fontSize: 12, color: 'var(--tone-danger-fg)', margin: '8px 0 0' }}>{freezeError}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button style={s.cancelBtn} onClick={() => setShowFreezeModal(false)}>Cancel</button>
              <button style={s.confirmFreezeBtn} onClick={handleFreeze} disabled={freezing}>
                {freezing ? 'Freezing...' : 'Freeze Account'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InfoRow({ label, value, bold }: { label: string; value: any; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
      <span style={{ color: 'var(--fg-tertiary)' }}>{label}</span>
      <span style={{ fontWeight: bold ? 800 : 600, color: 'var(--fg-primary)', maxWidth: '55%', textAlign: 'right', wordBreak: 'break-word' }}>{value || '-'}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  topBar: { marginBottom: 16 },
  backLink: { fontSize: 13, color: 'var(--fg-link)', textDecoration: 'none', fontWeight: 600 },
  profileCard: { backgroundColor: 'var(--bg-surface)', borderRadius: 10, padding: 20, marginBottom: 16, border: '1px solid var(--border-default)' },
  avatarRow: { display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 },
  avatar: { width: 48, height: 48, borderRadius: '50%', backgroundColor: 'var(--accent-base)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, flexShrink: 0 },
  profileName: { fontSize: 16, fontWeight: 800, color: 'var(--fg-primary)', margin: 0 },
  profileUsername: { fontSize: 13, color: 'var(--fg-tertiary)', margin: '2px 0 0' },
  frozenBadge: { backgroundColor: 'var(--tone-danger-bg)', color: 'var(--tone-danger-fg)', padding: '4px 12px', borderRadius: 100, fontSize: 11, fontWeight: 700 },
  freezeBtn: { backgroundColor: 'var(--tone-danger-bg)', color: 'var(--tone-danger-fg)', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  unfreezeBtn: { backgroundColor: 'var(--tone-success-bg)', color: 'var(--tone-success-fg)', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  freezeReasonBox: { backgroundColor: 'var(--tone-danger-bg)', borderRadius: 8, padding: 12, marginBottom: 16 },
  infoGrid: { },
  statsGrid: { display: 'flex', gap: 12, marginTop: 16 },
  miniStat: { flex: 1, backgroundColor: 'var(--bg-subtle)', borderRadius: 8, padding: 12, textAlign: 'center' },
  miniLabel: { fontSize: 10, color: 'var(--fg-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 4px' },
  miniValue: { fontSize: 20, fontWeight: 800, color: 'var(--fg-primary)', margin: 0 },
  tabs: { display: 'flex', gap: 0, borderBottom: '1px solid var(--border-default)', marginBottom: 0 },
  tabBtn: { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 12, fontWeight: 500, color: 'var(--fg-tertiary)', cursor: 'pointer' },
  tabBtnActive: { borderBottom: '2px solid var(--accent-base)', color: 'var(--fg-primary)', fontWeight: 700 },
  tableWrap: { overflowX: 'auto', borderRadius: '0 0 10px 10px', border: '1px solid var(--border-default)', borderTop: 'none', backgroundColor: 'var(--bg-surface)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: 'var(--accent-base)', color: 'var(--accent-fg)', fontSize: 12, fontWeight: 700, padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '12px 12px', color: 'var(--fg-secondary)', fontSize: 12, verticalAlign: 'middle' },
  typeBadge: { backgroundColor: 'var(--tone-purple-bg)', color: 'var(--tone-purple-fg)', padding: '3px 8px', borderRadius: 100, fontSize: 10, fontWeight: 600, textTransform: 'capitalize' },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 49 },
  modal: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', backgroundColor: 'var(--bg-surface)', borderRadius: 12, padding: 24, width: 440, zIndex: 50, maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border-default)' },
  modalTitle: { fontSize: 15, fontWeight: 800, color: 'var(--fg-primary)', margin: '0 0 12px' },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--fg-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  textarea: { width: '100%', border: '1.5px solid var(--border-default)', borderRadius: 8, padding: '10px 14px', fontSize: 13, minHeight: 80, resize: 'vertical', outline: 'none', boxSizing: 'border-box', backgroundColor: 'var(--bg-surface)', color: 'var(--fg-primary)' },
  cancelBtn: { backgroundColor: 'var(--bg-subtle)', color: 'var(--fg-secondary)', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  confirmFreezeBtn: { backgroundColor: 'var(--tone-danger-fg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 100, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
};
