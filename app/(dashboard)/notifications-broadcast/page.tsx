'use client';

import { useEffect, useState } from 'react';

interface Broadcast {
  id: string;
  title: string;
  message: string;
  type: string;
  audience: string;
  recipient_count: number;
  delivered_count: number;
  failed_count: number;
  sent_at: string;
}

interface UserHit { id: string; full_name: string | null; username: string | null; email: string }

const AUDIENCES = [
  { value: 'all', label: 'All Users' },
  { value: 'active_7d', label: 'Active in last 7 days' },
  { value: 'inactive', label: 'Inactive (7+ days)' },
  { value: 'specific', label: 'Specific User' },
];

const TYPES = [
  { value: 'general', label: 'General' },
  { value: 'promo', label: 'Promotional' },
  { value: 'update', label: 'Product Update' },
  { value: 'system', label: 'System' },
];

export default function NotificationsBroadcastPage() {
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [audience, setAudience] = useState('all');
  const [type, setType] = useState('general');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');

  const [userQuery, setUserQuery] = useState('');
  const [userHits, setUserHits] = useState<UserHit[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserHit | null>(null);

  useEffect(() => { fetchHistory(); }, []);

  useEffect(() => {
    if (audience === 'specific') {
      setCount(selectedUser ? 1 : 0);
      return;
    }
    setCount(null);
    fetch(`/api/notifications/recipient-count?audience=${audience}`)
      .then((r) => r.json()).then((d) => setCount(d.count ?? 0)).catch(() => setCount(0));
  }, [audience, selectedUser]);

  useEffect(() => {
    if (audience !== 'specific' || !userQuery.trim()) { setUserHits([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/notifications/user-search?q=${encodeURIComponent(userQuery)}`)
        .then((r) => r.json()).then((d) => setUserHits(d.users || [])).catch(() => setUserHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [userQuery, audience]);

  const fetchHistory = async () => {
    setLoading(true);
    const res = await fetch('/api/notifications/broadcast');
    const data = await res.json().catch(() => ({}));
    setHistory(data.broadcasts || []);
    setLoading(false);
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const send = async () => {
    if (!title.trim() || !message.trim()) return showToast('Title and message required');
    if (audience === 'specific' && !selectedUser) return showToast('Pick a user');
    setSending(true);
    const res = await fetch('/api/notifications/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, message, type, audience,
        target_user_id: audience === 'specific' ? selectedUser?.id : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) return showToast(data?.error || 'Broadcast failed');
    showToast(`Sent to ${data.recipient_count ?? 0} users`);
    setTitle(''); setMessage(''); setSelectedUser(null); setUserQuery('');
    fetchHistory();
  };

  return (
    <div>
      <h1 style={styles.h1}>Notifications Broadcast</h1>

      <div style={styles.card}>
        <p style={styles.cardTitle}>Compose Broadcast</p>

        <div style={styles.grid2}>
          <div>
            <label style={styles.label}>Audience</label>
            <select style={styles.input} value={audience} onChange={(e) => setAudience(e.target.value)}>
              {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label style={styles.label}>Type</label>
            <select style={styles.input} value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>

        {audience === 'specific' && (
          <div style={{ marginTop: 12, position: 'relative' }}>
            <label style={styles.label}>Search User</label>
            {selectedUser ? (
              <div style={styles.selectedUser}>
                <span>{selectedUser.full_name || selectedUser.username} — {selectedUser.email}</span>
                <button style={styles.clearBtn} onClick={() => { setSelectedUser(null); setUserQuery(''); }}>Clear</button>
              </div>
            ) : (
              <>
                <input
                  style={styles.input}
                  placeholder="Username, email, or name"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                />
                {userHits.length > 0 && (
                  <div style={styles.dropdown}>
                    {userHits.map((u) => (
                      <div key={u.id} style={styles.dropdownItem} onClick={() => { setSelectedUser(u); setUserHits([]); }}>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{u.full_name || u.username}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>{u.email}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <label style={styles.label}>Title</label>
          <input style={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={styles.label}>Message</label>
          <textarea style={{ ...styles.input, minHeight: 90, resize: 'vertical' }} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
        </div>

        <div style={styles.sendRow}>
          <p style={styles.countText}>
            Recipients: <strong>{count === null ? '…' : count.toLocaleString()}</strong>
          </p>
          <button style={styles.sendBtn} onClick={send} disabled={sending}>
            {sending ? 'Sending…' : 'Send Broadcast'}
          </button>
        </div>
      </div>

      <div style={styles.card}>
        <p style={styles.cardTitle}>Recent Broadcasts</p>
        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : history.length === 0 ? (
          <p style={styles.empty}>No broadcasts yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Title</th>
                <th style={styles.th}>Message</th>
                <th style={styles.th}>Audience</th>
                <th style={styles.th}>Delivered</th>
                <th style={styles.th}>Sent</th>
              </tr>
            </thead>
            <tbody>
              {history.map((b) => (
                <tr key={b.id}>
                  <td style={styles.td}>{b.title}</td>
                  <td style={styles.td}>{b.message.length > 60 ? b.message.slice(0, 60) + '…' : b.message}</td>
                  <td style={styles.td}><span style={styles.badge}>{b.audience}</span></td>
                  <td style={styles.td}>{b.delivered_count}/{b.recipient_count}</td>
                  <td style={styles.td}>{new Date(b.sent_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 20, fontWeight: 800, color: '#111', margin: '0 0 16px' },
  card: { backgroundColor: '#FFF', borderRadius: 10, padding: 20, marginBottom: 16, border: '1px solid #EEE' },
  cardTitle: { fontSize: 14, fontWeight: 700, color: '#111', margin: '0 0 14px' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 5, textTransform: 'uppercase' },
  input: { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #DDD', borderRadius: 6, backgroundColor: '#FFF', boxSizing: 'border-box' },
  selectedUser: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', fontSize: 13, border: '1px solid #111', borderRadius: 6, backgroundColor: '#F9F9F9' },
  clearBtn: { background: 'none', border: 'none', color: '#E53935', cursor: 'pointer', fontSize: 11, fontWeight: 600 },
  dropdown: { position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#FFF', border: '1px solid #DDD', borderRadius: 6, marginTop: 2, maxHeight: 200, overflowY: 'auto', zIndex: 10 },
  dropdownItem: { padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid #F2F2F2' },
  sendRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTop: '1px solid #F2F2F2' },
  countText: { fontSize: 13, color: '#555', margin: 0 },
  sendBtn: { padding: '10px 20px', fontSize: 13, fontWeight: 700, backgroundColor: '#111', color: '#FFF', border: 'none', borderRadius: 6, cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', padding: '8px 10px', borderBottom: '1px solid #EEE' },
  td: { fontSize: 12, color: '#111', padding: '10px', borderBottom: '1px solid #F2F2F2' },
  badge: { fontSize: 10, fontWeight: 600, padding: '2px 8px', backgroundColor: '#F2F2F2', borderRadius: 10 },
  empty: { fontSize: 12, color: '#888', margin: 0 },
  toast: { position: 'fixed', bottom: 20, right: 20, backgroundColor: '#111', color: '#FFF', padding: '10px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, zIndex: 100 },
};
