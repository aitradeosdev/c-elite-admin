'use client';

import { useEffect, useState } from 'react';

interface Field {
  key: string;
  label: string;
  hint: string;
  inputType: 'number' | 'text';
  step?: string;
}

const FIELDS: { section: string; items: Field[] }[] = [
  {
    section: 'Dormant Account Activity',
    items: [
      { key: 'anomaly_dormant_days', label: 'Dormant Days', hint: 'Number of days of inactivity that makes a sudden large withdrawal suspicious.', inputType: 'number' },
      { key: 'anomaly_dormant_amount', label: 'Dormant Amount Threshold (₦)', hint: 'A withdrawal of at least this amount on a previously dormant account is flagged.', inputType: 'number' },
    ],
  },
  {
    section: 'Rapid Withdrawal Pattern',
    items: [
      { key: 'anomaly_rapid_window_mins', label: 'Window (minutes)', hint: 'Time window to look back when checking a withdrawal against deposits.', inputType: 'number' },
      { key: 'anomaly_rapid_ratio', label: 'Ratio (0–1)', hint: 'Flag when withdrawn / deposited within the window exceeds this ratio. Example: 0.80 = 80%.', inputType: 'number', step: '0.01' },
    ],
  },
  {
    section: 'Failed Transaction Burst',
    items: [
      { key: 'anomaly_failures_window_mins', label: 'Window (minutes)', hint: 'Look-back window for counting failed transactions.', inputType: 'number' },
      { key: 'anomaly_failures_threshold', label: 'Failures Threshold', hint: 'Number of failures within the window before the user is flagged.', inputType: 'number' },
    ],
  },
  {
    section: 'Critical Alerts',
    items: [
      { key: 'alert_critical_amount', label: 'Critical Amount (₦)', hint: 'Single-transaction amount that triggers a high-severity admin alert.', inputType: 'number' },
      { key: 'security_alerts_batch_size', label: 'Email Batch Size', hint: 'Max security alert emails sent per cron run.', inputType: 'number' },
      { key: 'alert_timezone', label: 'Alert Timezone', hint: 'IANA timezone used when rendering alert timestamps (e.g. Africa/Lagos).', inputType: 'text' },
    ],
  },
];

type Config = Record<string, string>;

export default function AnomalyAlertsPage() {
  const [config, setConfig] = useState<Config>({});
  const [draft, setDraft] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/anomaly-alerts');
    const data = await res.json().catch(() => ({}));
    const cfg: Config = data.config || {};
    setConfig(cfg);
    setDraft(cfg);
    if (!silent) setLoading(false);
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
    const res = await fetch('/api/anomaly-alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { showToast(body.error || 'Save failed'); return; }
    showToast('Saved');
    await fetchConfig(true);
  };

  if (loading) return <div><h1 style={styles.h1}>Anomaly & Alerts</h1><p style={styles.empty}>Loading…</p></div>;

  return (
    <div>
      <h1 style={styles.h1}>Anomaly & Alerts</h1>

      {FIELDS.map((section) => (
        <div key={section.section} style={styles.card}>
          <p style={styles.cardTitle}>{section.section}</p>
          {section.items.map((f) => (
            <div key={f.key} style={styles.field}>
              <label style={styles.label}>{f.label}</label>
              <input
                style={styles.input}
                type={f.inputType}
                {...(f.inputType === 'number' ? { min: 0, step: f.step ?? '1' } : {})}
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
  h1: { fontSize: 20, fontWeight: 800, color: 'var(--fg-primary)', margin: '0 0 16px' },
  card: { backgroundColor: 'var(--bg-surface)', borderRadius: 10, padding: 20, marginBottom: 16, border: '1px solid var(--border-default)' },
  cardTitle: { fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)', margin: '0 0 14px' },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg-secondary)', marginBottom: 6 },
  input: { width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--border-default)', borderRadius: 6, boxSizing: 'border-box' },
  hint: { fontSize: 11, color: 'var(--fg-tertiary)', margin: '6px 0 0', lineHeight: 1.5 },
  footer: { display: 'flex', justifyContent: 'flex-end', paddingTop: 8 },
  saveBtn: { padding: '12px 28px', fontSize: 13, fontWeight: 700, backgroundColor: 'var(--accent-base)', color: 'var(--accent-fg)', border: 'none', borderRadius: 6, cursor: 'pointer' },
  empty: { fontSize: 12, color: 'var(--fg-tertiary)' },
  toast: { position: 'fixed', bottom: 20, right: 20, backgroundColor: 'var(--accent-base)', color: 'var(--accent-fg)', padding: '10px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, zIndex: 100 },
};
