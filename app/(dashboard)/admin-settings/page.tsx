'use client';

import { useEffect, useState } from 'react';

type Config = Record<string, string>;

const GATEWAYS = [
  { key: 'paystack', label: 'Paystack' },
  { key: 'monnify', label: 'Monnify' },
];

export default function AdminSettingsPage() {
  const [config, setConfig] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [forbidden, setForbidden] = useState(false);

  const [liveChatUrl, setLiveChatUrl] = useState('');
  const [curVer, setCurVer] = useState('');
  const [minVer, setMinVer] = useState('');
  const [updType, setUpdType] = useState('soft');
  const [updMsg, setUpdMsg] = useState('');

  const [emergencyConfirm, setEmergencyConfirm] = useState<null | 'on' | 'off'>(null);

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async () => {
    setLoading(true);
    const res = await fetch('/api/admin-settings');
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    const data = await res.json().catch(() => ({}));
    const cfg: Config = data.config || {};
    setConfig(cfg);
    setLiveChatUrl(cfg.live_chat_url || '');
    setCurVer(cfg.app_current_version || '');
    setMinVer(cfg.app_minimum_version || '');
    setUpdType(cfg.app_update_type || 'soft');
    setUpdMsg(cfg.app_update_message || '');
    setLoading(false);
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const save = async (changes: Record<string, string>) => {
    setSaving(true);
    const res = await fetch('/api/admin-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
    setSaving(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(body.error || 'Save failed'); return false; }
    showToast('Saved');
    await fetchConfig();
    return true;
  };

  const toggleGateway = (g: string, enabled: boolean) => {
    const primary = config.active_payment_gateway;
    if (!enabled && primary === g) {
      showToast('Cannot disable the primary gateway');
      return;
    }
    save({ [`gateway_${g}_enabled`]: enabled ? 'true' : 'false' });
  };

  const setPrimary = (g: string) => {
    if (config[`gateway_${g}_enabled`] !== 'true') {
      showToast('Enable the gateway first');
      return;
    }
    save({ active_payment_gateway: g });
  };

  const toggleVtpass = (v: boolean) => save({ bill_vtpass_enabled: v ? 'true' : 'false' });
  const saveLiveChat = () => save({ live_chat_url: liveChatUrl });
  const saveVersion = () => save({
    app_current_version: curVer,
    app_minimum_version: minVer,
    app_update_type: updType,
    app_update_message: updMsg,
  });

  const confirmEmergency = async () => {
    if (!emergencyConfirm) return;
    const ok = await save({ emergency_mode: emergencyConfirm === 'on' ? 'true' : 'false' });
    if (ok) setEmergencyConfirm(null);
  };

  if (forbidden) return <div><h1 style={styles.h1}>Admin Settings</h1><p style={styles.empty}>Super-admin access only.</p></div>;
  if (loading) return <div><h1 style={styles.h1}>Admin Settings</h1><p style={styles.empty}>Loading…</p></div>;

  const emergencyOn = config.emergency_mode === 'true';
  const primary = config.active_payment_gateway;

  return (
    <div>
      <h1 style={styles.h1}>Admin Settings</h1>

      <div style={styles.card}>
        <p style={styles.cardTitle}>Payment Gateways</p>
        <p style={styles.cardHint}>
          Credentials live in Supabase function secrets. Toggle which gateways are live; choose one as Primary.
        </p>
        <div style={styles.gwList}>
          {GATEWAYS.map((g) => {
            const enabled = config[`gateway_${g.key}_enabled`] === 'true';
            const isPrimary = primary === g.key;
            return (
              <div key={g.key} style={styles.gwRow}>
                <span style={styles.gwLabel}>{g.label}</span>
                <label style={styles.primaryLabel}>
                  <input
                    type="radio"
                    name="primary_gateway"
                    checked={isPrimary}
                    onChange={() => setPrimary(g.key)}
                    disabled={saving || !enabled}
                  />
                  Primary
                </label>
                <Toggle value={enabled} onChange={(v) => toggleGateway(g.key, v)} disabled={saving} />
              </div>
            );
          })}
        </div>
      </div>

      <div style={styles.card}>
        <p style={styles.cardTitle}>Bill Payment API</p>
        <div style={styles.gwRow}>
          <span style={styles.gwLabel}>VTpass</span>
          <Toggle
            value={config.bill_vtpass_enabled === 'true'}
            onChange={toggleVtpass}
            disabled={saving}
          />
        </div>
      </div>

      <div style={styles.card}>
        <p style={styles.cardTitle}>Live Chat URL</p>
        <p style={styles.cardHint}>Direct chat link from your provider dashboard (e.g. Tawk/LiveChat/Smartsupp "Shareable Chat Link"). Opens full-screen in the Support tab.</p>
        <input
          style={styles.input}
          type="url"
          value={liveChatUrl}
          onChange={(e) => setLiveChatUrl(e.target.value)}
          placeholder="https://direct.lc.chat/..."
        />
        <button style={styles.saveBtn} onClick={saveLiveChat} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div style={styles.card}>
        <p style={styles.cardTitle}>App Version</p>
        <div style={styles.grid2}>
          <div>
            <label style={styles.label}>Current Version</label>
            <input style={styles.input} value={curVer} onChange={(e) => setCurVer(e.target.value)} placeholder="1.0.0" />
          </div>
          <div>
            <label style={styles.label}>Minimum Version</label>
            <input style={styles.input} value={minVer} onChange={(e) => setMinVer(e.target.value)} placeholder="1.0.0" />
          </div>
          <div>
            <label style={styles.label}>Update Type</label>
            <select style={styles.input} value={updType} onChange={(e) => setUpdType(e.target.value)}>
              <option value="soft">Soft</option>
              <option value="force">Force</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={styles.label}>Update Message</label>
            <input style={styles.input} value={updMsg} onChange={(e) => setUpdMsg(e.target.value)} />
          </div>
        </div>
        <button style={{ ...styles.saveBtn, marginTop: 12 }} onClick={saveVersion} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div style={{ ...styles.card, borderColor: emergencyOn ? '#E53935' : '#EEE' }}>
        <p style={{ ...styles.cardTitle, color: emergencyOn ? '#E53935' : '#111' }}>Emergency Mode</p>
        <p style={styles.cardHint}>
          When ON, all mobile clients are force-logged-out and shown a blocking maintenance modal on next resume.
        </p>
        <div style={styles.gwRow}>
          <span style={styles.gwLabel}>{emergencyOn ? 'ACTIVE' : 'Off'}</span>
          <button
            style={emergencyOn ? styles.dangerBtn : styles.saveBtn}
            onClick={() => setEmergencyConfirm(emergencyOn ? 'off' : 'on')}
            disabled={saving}
          >
            {emergencyOn ? 'Disable Emergency Mode' : 'Enable Emergency Mode'}
          </button>
        </div>
      </div>

      {emergencyConfirm && (
        <div style={styles.modalBg} onClick={() => setEmergencyConfirm(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <p style={styles.modalTitle}>
              {emergencyConfirm === 'on' ? 'Enable Emergency Mode?' : 'Disable Emergency Mode?'}
            </p>
            <p style={styles.modalBody}>
              {emergencyConfirm === 'on'
                ? 'This will force-logout every user on the mobile app and block access until you disable it. Continue?'
                : 'Users will regain access to the app. Continue?'}
            </p>
            <div style={styles.modalRow}>
              <button style={styles.cancelBtn} onClick={() => setEmergencyConfirm(null)} disabled={saving}>Cancel</button>
              <button
                style={emergencyConfirm === 'on' ? styles.dangerBtn : styles.saveBtn}
                onClick={confirmEmergency}
                disabled={saving}
              >
                {saving ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      style={{
        width: 44, height: 24, borderRadius: 12, border: 'none',
        backgroundColor: value ? '#111' : '#CCC',
        position: 'relative', cursor: disabled ? 'default' : 'pointer',
        transition: 'background-color 0.15s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: value ? 22 : 2,
        width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFF',
        transition: 'left 0.15s',
      }} />
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 20, fontWeight: 800, color: '#111', margin: '0 0 16px' },
  card: { backgroundColor: '#FFF', borderRadius: 10, padding: 20, marginBottom: 16, border: '1px solid #EEE' },
  cardTitle: { fontSize: 14, fontWeight: 700, color: '#111', margin: '0 0 6px' },
  cardHint: { fontSize: 11, color: '#888', margin: '0 0 14px', lineHeight: 1.5 },
  gwList: { display: 'flex', flexDirection: 'column', gap: 10 },
  gwRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', backgroundColor: '#F9F9F9', borderRadius: 6, gap: 12 },
  gwLabel: { fontSize: 13, fontWeight: 600, color: '#111', flex: 1 },
  primaryLabel: { fontSize: 11, color: '#555', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' },
  textarea: { width: '100%', padding: 10, fontSize: 12, border: '1px solid #DDD', borderRadius: 6, fontFamily: 'monospace', marginBottom: 10, boxSizing: 'border-box' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 },
  input: { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #DDD', borderRadius: 6, boxSizing: 'border-box' },
  saveBtn: { padding: '10px 20px', fontSize: 13, fontWeight: 700, backgroundColor: '#111', color: '#FFF', border: 'none', borderRadius: 6, cursor: 'pointer' },
  dangerBtn: { padding: '10px 20px', fontSize: 13, fontWeight: 700, backgroundColor: '#E53935', color: '#FFF', border: 'none', borderRadius: 6, cursor: 'pointer' },
  cancelBtn: { padding: '10px 20px', fontSize: 13, fontWeight: 700, backgroundColor: '#FFF', color: '#111', border: '1px solid #DDD', borderRadius: 6, cursor: 'pointer' },
  empty: { fontSize: 12, color: '#888' },
  toast: { position: 'fixed', bottom: 20, right: 20, backgroundColor: '#111', color: '#FFF', padding: '10px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, zIndex: 100 },
  modalBg: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal: { backgroundColor: '#FFF', borderRadius: 10, padding: 24, maxWidth: 420, width: '90%' },
  modalTitle: { fontSize: 16, fontWeight: 800, color: '#111', margin: '0 0 10px' },
  modalBody: { fontSize: 13, color: '#555', lineHeight: 1.5, margin: '0 0 20px' },
  modalRow: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
};
