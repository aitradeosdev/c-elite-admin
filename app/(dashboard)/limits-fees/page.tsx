'use client';

import { useEffect, useState } from 'react';

const FIELDS = [
  {
    section: 'Withdrawals',
    items: [
      { key: 'min_withdrawal_amount', label: 'Minimum Withdrawal (₦)', hint: 'Smallest amount a user can withdraw per request.' },
      { key: 'max_withdrawal_amount', label: 'Maximum Withdrawal (₦)', hint: 'Largest amount a user can withdraw in a single request.' },
      { key: 'max_daily_withdrawal', label: 'Daily Withdrawal Cap (₦)', hint: 'Total per-user per-day limit across all withdrawals.' },
      { key: 'withdraw_fee', label: 'Withdraw Fee (₦)', hint: 'Flat fee charged on withdrawals to bank accounts. Set 0 for free.' },
    ],
  },
  {
    section: 'Transfer Fees',
    items: [
      { key: 'transfer_tag_fee', label: 'Tag Transfer Fee (₦)', hint: 'Flat fee charged on sender for @tag transfers. Set 0 for free.' },
    ],
  },
  {
    section: 'Anomaly Detection',
    items: [
      { key: 'large_withdrawal_flag_threshold', label: 'Large Withdrawal Flag (₦)', hint: 'Withdrawals >= this amount get auto-flagged for admin review in flagged_transactions. Set 0 to disable.' },
    ],
  },
];

type Config = Record<string, string>;

export default function LimitsFeesPage() {
  const [config, setConfig] = useState<Config>({});
  const [draft, setDraft] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async () => {
    setLoading(true);
    const res = await fetch('/api/limits-fees');
    const data = await res.json().catch(() => ({}));
    const cfg: Config = data.config || {};
    setConfig(cfg);
    setDraft(cfg);
    setLoading(false);
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const changes = Object.fromEntries(
    Object.keys(draft).filter((k) => draft[k] !== (config[k] ?? ''))
      .map((k) => [k, draft[k]]),
  );
  const hasChanges = Object.keys(changes).length > 0;

  const save = async () => {
    if (!hasChanges) return;
    setSaving(true);
    const res = await fetch('/api/limits-fees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { showToast(body.error || 'Save failed'); return; }
    showToast('Saved');
    await fetchConfig();
  };

  if (loading) return <div><h1 style={styles.h1}>Limits & Fees</h1><p style={styles.empty}>Loading…</p></div>;

  return (
    <div>
      <h1 style={styles.h1}>Limits & Fees</h1>

      {FIELDS.map((section) => (
        <div key={section.section} style={styles.card}>
          <p style={styles.cardTitle}>{section.section}</p>
          {section.items.map((f) => (
            <div key={f.key} style={styles.field}>
              <label style={styles.label}>{f.label}</label>
              <input
                style={styles.input}
                type="number"
                min={0}
                step="1"
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              />
              <p style={styles.hint}>{f.hint}</p>
            </div>
          ))}
        </div>
      ))}

      <div style={styles.footer}>
        <button
          style={{ ...styles.saveBtn, opacity: hasChanges && !saving ? 1 : 0.4 }}
          onClick={save}
          disabled={!hasChanges || saving}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 20, fontWeight: 800, color: '#111', margin: '0 0 16px' },
  card: { backgroundColor: '#FFF', borderRadius: 10, padding: 20, marginBottom: 16, border: '1px solid #EEE' },
  cardTitle: { fontSize: 14, fontWeight: 700, color: '#111', margin: '0 0 14px' },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 },
  input: { width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #DDD', borderRadius: 6, boxSizing: 'border-box' },
  hint: { fontSize: 11, color: '#888', margin: '6px 0 0', lineHeight: 1.5 },
  footer: { display: 'flex', justifyContent: 'flex-end', paddingTop: 8 },
  saveBtn: { padding: '12px 28px', fontSize: 13, fontWeight: 700, backgroundColor: '#111', color: '#FFF', border: 'none', borderRadius: 6, cursor: 'pointer' },
  empty: { fontSize: 12, color: '#888' },
  toast: { position: 'fixed', bottom: 20, right: 20, backgroundColor: '#111', color: '#FFF', padding: '10px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, zIndex: 100 },
};
