'use client';

import { useEffect, useState } from 'react';

interface Field {
  key: string;
  label: string;
  hint: string;
  inputType: 'number' | 'text' | 'textarea';
}

const FIELDS: { section: string; items: Field[] }[] = [
  {
    section: 'Anti-Abuse Rate Limits',
    items: [
      { key: 'signup_rate_limit_per_hour', label: 'Signups per IP / hour', hint: 'Max anonymous signups allowed from a single IP in a rolling 1-hour window.', inputType: 'number' },
    ],
  },
  {
    section: 'Webhook IP Allowlist',
    items: [
      { key: 'paystack_webhook_ips', label: 'Paystack Webhook IPs (CSV)', hint: 'Comma-separated IPv4 addresses authorised to call the Paystack webhook. Update only when Paystack rotates their IPs.', inputType: 'textarea' },
      { key: 'monnify_webhook_ips', label: 'Monnify Webhook IPs (CSV)', hint: "Comma-separated IPv4 addresses authorised to call the Monnify webhook (from Monnify's docs). If left empty, all Monnify webhooks are rejected (403).", inputType: 'textarea' },
    ],
  },
];

type Config = Record<string, string>;

export default function SecurityLimitsPage() {
  const [config, setConfig] = useState<Config>({});
  const [draft, setDraft] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/security-limits');
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
    const res = await fetch('/api/security-limits', {
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

  if (loading) return <div><h1 style={styles.h1}>Rate Limits & Webhook IPs</h1><p style={styles.empty}>Loading…</p></div>;

  return (
    <div>
      <h1 style={styles.h1}>Rate Limits & Webhook IPs</h1>

      {FIELDS.map((section) => (
        <div key={section.section} style={styles.card}>
          <p style={styles.cardTitle}>{section.section}</p>
          {section.items.map((f) => (
            <div key={f.key} style={styles.field}>
              <label style={styles.label}>{f.label}</label>
              {f.inputType === 'textarea' ? (
                <textarea
                  style={{ ...styles.input, minHeight: 78, fontFamily: 'monospace', resize: 'vertical' }}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              ) : (
                <input
                  style={styles.input}
                  type={f.inputType}
                  {...(f.inputType === 'number' ? { min: 0, step: '1' } : {})}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              )}
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
