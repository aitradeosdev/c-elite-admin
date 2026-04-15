'use client';

import { useEffect, useState } from 'react';

interface LogRow {
  id: string;
  referrer_username: string;
  referee_username: string;
  created_at: string;
  first_trade_at: string | null;
  first_trade_completed: boolean;
  referrer_bonus_amount: number;
  referee_bonus_amount: number;
  referrer_credited: boolean;
  referee_credited: boolean;
}

interface Stats {
  total_referrals: number;
  pending_payout: number;
  total_paid_out: number;
}

const CONFIG_KEYS = ['referral_active', 'referral_referrer_bonus', 'referral_referee_bonus'];

export default function ReferralManagementPage() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (silent = false) => {
    if (!silent) setLoading(true);
    const [configRes, refRes] = await Promise.all([
      fetch(`/api/app-config?keys=${CONFIG_KEYS.join(',')}`),
      fetch('/api/referrals'),
    ]);
    const configData = await configRes.json();
    const refData = await refRes.json();
    setConfig(configData.config || {});
    setStats(refData.stats || null);
    setLog(refData.log || []);
    if (!silent) setLoading(false);
  };

  const getValue = (key: string) => pending[key] ?? config[key] ?? '';
  const setValue = (key: string, value: string) => setPending((p) => ({ ...p, [key]: value }));
  const getToggle = (key: string) => getValue(key) === 'true';
  const toggleKey = (key: string) => setValue(key, getToggle(key) ? 'false' : 'true');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleSave = async () => {
    if (Object.keys(pending).length === 0) { showToast('No changes to save.'); return; }
    setSaving(true);
    const res = await fetch('/api/app-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: pending }),
    });
    setSaving(false);
    if (res.ok) { setPending({}); showToast('Referral settings saved ✓'); fetchAll(true); }
    else showToast('Failed to save settings.');
  };

  if (loading) return <p style={styles.empty}>Loading...</p>;

  const statusBadge = (r: LogRow) => {
    if (r.referrer_credited && r.referee_credited) return { text: 'Paid', style: styles.badgePaid };
    if (r.first_trade_completed) return { text: 'Pending Payout', style: styles.badgePending };
    return { text: 'Awaiting Trade', style: styles.badgeAwait };
  };

  return (
    <div style={styles.page}>
      {/* Settings card */}
      <div style={styles.card}>
        <div style={styles.cardHead}>
          <span style={styles.cardTitle}>Settings</span>
          <div style={{ ...styles.toggle, backgroundColor: getToggle('referral_active') ? '#111111' : '#E0E0E0' }} onClick={() => toggleKey('referral_active')}>
            <div style={{ ...styles.toggleThumb, left: getToggle('referral_active') ? 22 : 2 }} />
          </div>
        </div>

        <div style={styles.fieldRow}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>REFERRER BONUS (₦)</label>
            <input style={styles.input} type="number" value={getValue('referral_referrer_bonus')} onChange={(e) => setValue('referral_referrer_bonus', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>REFEREE BONUS (₦)</label>
            <input style={styles.input} type="number" value={getValue('referral_referee_bonus')} onChange={(e) => setValue('referral_referee_bonus', e.target.value)} />
          </div>
        </div>
        <p style={styles.readonlyNote}>Trigger: First Trade</p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={{ ...styles.saveBtn, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Stats card */}
      <div style={styles.statCard}>
        <div style={styles.statItem}>
          <span style={styles.statLabel}>Total Referrals</span>
          <span style={styles.statValue}>{stats?.total_referrals ?? 0}</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statLabel}>Pending Payout</span>
          <span style={styles.statValue}>₦{Number(stats?.pending_payout ?? 0).toLocaleString()}</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statLabel}>Total Paid Out</span>
          <span style={styles.statValue}>₦{Number(stats?.total_paid_out ?? 0).toLocaleString()}</span>
        </div>
      </div>

      {/* Log table */}
      <div style={styles.section}>
        <p style={styles.sectionTitle}>Referral Log</p>
        {log.length === 0 ? (
          <p style={styles.empty}>No referrals yet.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Referrer</th>
                  <th style={styles.th}>Referee</th>
                  <th style={styles.th}>Referred On</th>
                  <th style={styles.th}>First Trade</th>
                  <th style={styles.th}>Bonus</th>
                  <th style={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => {
                  const b = statusBadge(r);
                  return (
                    <tr key={r.id}>
                      <td style={styles.td}>@{r.referrer_username}</td>
                      <td style={styles.td}>@{r.referee_username}</td>
                      <td style={styles.td}>{new Date(r.created_at).toLocaleDateString()}</td>
                      <td style={styles.td}>{r.first_trade_at ? new Date(r.first_trade_at).toLocaleDateString() : '—'}</td>
                      <td style={styles.td}>₦{Number((r.referrer_bonus_amount || 0) + (r.referee_bonus_amount || 0)).toLocaleString()}</td>
                      <td style={styles.td}><span style={b.style}>{b.text}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { paddingBottom: 40 },
  empty: { fontSize: 12, color: '#888888', padding: 20, textAlign: 'center' },

  card: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 16, marginBottom: 12 },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: '#111111' },
  fieldRow: { display: 'flex', gap: 12 },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  input: { width: '100%', border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#111111', outline: 'none', boxSizing: 'border-box', backgroundColor: '#FFFFFF' },
  readonlyNote: { fontSize: 12, color: '#888888', marginTop: 12, marginBottom: 0 },
  saveBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },

  toggle: { width: 44, height: 24, borderRadius: 100, position: 'relative', cursor: 'pointer', transition: 'background-color 0.25s', flexShrink: 0 },
  toggleThumb: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.25s' },

  statCard: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 },
  statItem: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 },
  statLabel: { fontSize: 11, color: '#888888' },
  statValue: { fontSize: 18, fontWeight: 800, color: '#111111' },

  section: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#111111', margin: '0 0 12px' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: '#111111', color: '#FFFFFF', textAlign: 'left', padding: '8px 10px', fontWeight: 600, fontSize: 11 },
  td: { padding: '8px 10px', borderBottom: '1px solid #EEEEEE', color: '#333333' },

  badgePaid: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },
  badgePending: { backgroundColor: '#FFF3E0', color: '#E65100', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },
  badgeAwait: { backgroundColor: '#EBEBEB', color: '#666', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },

  toast: { position: 'fixed', bottom: 24, right: 24, backgroundColor: '#111111', color: '#FFFFFF', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 51 },
};
