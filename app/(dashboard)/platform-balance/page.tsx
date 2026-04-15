'use client';

import { useEffect, useState } from 'react';

type Config = Record<string, string>;

export default function PlatformBalancePage() {
  const [config, setConfig] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [staticInput, setStaticInput] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async () => {
    setLoading(true);
    const res = await fetch('/api/platform-balance');
    const data = await res.json().catch(() => ({}));
    const cfg: Config = data.config || {};
    setConfig(cfg);
    setStaticInput(cfg.platform_balance_static || '');
    setLoading(false);
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const saveChanges = async (changes: Record<string, string>) => {
    setSaving(true);
    const res = await fetch('/api/platform-balance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
    setSaving(false);
    if (!res.ok) { showToast('Save failed'); return false; }
    showToast('Saved');
    await fetchConfig();
    return true;
  };

  const setMode = (mode: 'static' | 'live') => saveChanges({ platform_balance_mode: mode });
  const saveStatic = () => {
    const n = Number(staticInput);
    if (isNaN(n) || n < 0) return showToast('Enter a valid amount');
    saveChanges({ platform_balance_static: String(n) });
  };

  const mode = (config.platform_balance_mode || 'static') as 'static' | 'live';
  const gateway = config.active_payment_gateway || 'paystack';
  const liveValue = config.platform_balance_live;
  const liveAt = config.platform_balance_live_at;
  const liveError = config.platform_balance_live_error;

  if (loading) return <div><h1 style={styles.h1}>Platform Balance</h1><p style={styles.empty}>Loading…</p></div>;

  return (
    <div>
      <h1 style={styles.h1}>Platform Balance</h1>

      <div style={styles.card}>
        <p style={styles.cardTitle}>Mode</p>
        <div style={styles.tiles}>
          <div
            style={{ ...styles.tile, ...(mode === 'static' ? styles.tileActive : {}) }}
            onClick={() => !saving && setMode('static')}
          >
            <div style={styles.tileIcon}>📊</div>
            <p style={styles.tileLabel}>Static</p>
            <p style={styles.tileDesc}>Manually entered value</p>
          </div>
          <div
            style={{ ...styles.tile, ...(mode === 'live' ? styles.tileActive : {}) }}
            onClick={() => !saving && setMode('live')}
          >
            <div style={styles.tileIcon}>🔴</div>
            <p style={styles.tileLabel}>Live</p>
            <p style={styles.tileDesc}>Auto-fetched from gateway</p>
          </div>
        </div>
      </div>

      {mode === 'static' ? (
        <div style={styles.card}>
          <p style={styles.cardTitle}>Static Balance (₦)</p>
          <div style={styles.row}>
            <input
              style={styles.input}
              type="number"
              min={0}
              step="0.01"
              value={staticInput}
              onChange={(e) => setStaticInput(e.target.value)}
              placeholder="0.00"
            />
            <button style={styles.saveBtn} onClick={saveStatic} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.card}>
          <p style={styles.cardTitle}>Live Balance</p>
          <p style={styles.info}>
            Balance is automatically refreshed from the <strong>{gateway}</strong> API every 30 minutes.
          </p>
          <div style={styles.liveBox}>
            <p style={styles.liveLabel}>Current Balance</p>
            <p style={styles.liveValue}>
              {liveValue ? `₦${Number(liveValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
            </p>
            <p style={styles.liveMeta}>
              Last updated: {liveAt ? new Date(liveAt).toLocaleString() : 'Never'}
            </p>
            {liveError && <p style={styles.errorText}>Error: {liveError}</p>}
          </div>
        </div>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 20, fontWeight: 800, color: '#111', margin: '0 0 16px' },
  card: { backgroundColor: '#FFF', borderRadius: 10, padding: 20, marginBottom: 16, border: '1px solid #EEE' },
  cardTitle: { fontSize: 14, fontWeight: 700, color: '#111', margin: '0 0 14px' },
  tiles: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  tile: { padding: 20, border: '2px solid #EEE', borderRadius: 10, cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.15s' },
  tileActive: { borderColor: '#111', backgroundColor: '#FAFAFA' },
  tileIcon: { fontSize: 28, marginBottom: 6 },
  tileLabel: { fontSize: 14, fontWeight: 700, color: '#111', margin: '0 0 4px' },
  tileDesc: { fontSize: 11, color: '#888', margin: 0 },
  row: { display: 'flex', gap: 10 },
  input: { flex: 1, padding: '10px 12px', fontSize: 14, border: '1px solid #DDD', borderRadius: 6 },
  saveBtn: { padding: '10px 20px', fontSize: 13, fontWeight: 700, backgroundColor: '#111', color: '#FFF', border: 'none', borderRadius: 6, cursor: 'pointer' },
  info: { fontSize: 12, color: '#555', margin: '0 0 14px', lineHeight: 1.5 },
  liveBox: { padding: 16, backgroundColor: '#F9F9F9', borderRadius: 8, border: '1px solid #EEE' },
  liveLabel: { fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', margin: '0 0 6px' },
  liveValue: { fontSize: 24, fontWeight: 800, color: '#111', margin: '0 0 8px' },
  liveMeta: { fontSize: 11, color: '#888', margin: 0 },
  errorText: { fontSize: 11, color: '#E53935', marginTop: 8, margin: 0 },
  empty: { fontSize: 12, color: '#888' },
  toast: { position: 'fixed', bottom: 20, right: 20, backgroundColor: '#111', color: '#FFF', padding: '10px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, zIndex: 100 },
};
