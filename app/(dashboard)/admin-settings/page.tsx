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
  const [maxApproval, setMaxApproval] = useState('');
  const [termsUrl, setTermsUrl] = useState('');
  const [privacyUrl, setPrivacyUrl] = useState('');

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
    setMaxApproval(cfg.max_card_approval_naira || '5000000');
    setTermsUrl(cfg.terms_url || '');
    setPrivacyUrl(cfg.privacy_url || '');
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
  const toggleTagTransfer = (v: boolean) => save({ tag_transfer_enabled: v ? 'true' : 'false' });
  const saveLiveChat = () => save({ live_chat_url: liveChatUrl });
  const saveMaxApproval = () => {
    const n = Number(maxApproval);
    if (!Number.isFinite(n) || n < 1000) {
      showToast('Enter a valid amount (minimum ₦1,000)');
      return;
    }
    save({ max_card_approval_naira: String(Math.floor(n)) });
  };
  const saveVersion = () => save({
    app_current_version: curVer,
    app_minimum_version: minVer,
    app_update_type: updType,
    app_update_message: updMsg,
  });

  const isValidUrl = (u: string) => u.length === 0 || /^https?:\/\/[^\s<>"']{3,}$/i.test(u.trim());
  const saveTerms = () => {
    if (!isValidUrl(termsUrl)) { showToast('Terms URL must start with https://'); return; }
    save({ terms_url: termsUrl.trim() });
  };
  const savePrivacy = () => {
    if (!isValidUrl(privacyUrl)) { showToast('Privacy URL must start with https://'); return; }
    save({ privacy_url: privacyUrl.trim() });
  };

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
        <p style={styles.cardTitle}>Risk Limits</p>
        <p style={styles.cardHint}>
          Maximum gift-card approval amount (NGN) any non-super admin can authorise. Approvals above this threshold are
          rejected by the server with an "escalate to super admin" error. Default 5,000,000.
        </p>
        <label style={styles.label}>Max card approval (NGN)</label>
        <input
          style={styles.input}
          type="number"
          inputMode="numeric"
          min={1000}
          step={1000}
          value={maxApproval}
          onChange={(e) => setMaxApproval(e.target.value)}
          placeholder="5000000"
        />
        <button style={styles.saveBtn} onClick={saveMaxApproval} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
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

      <TagTransferSection
        enabled={config.tag_transfer_enabled !== 'false'}
        onToggle={toggleTagTransfer}
        saving={saving}
        showToast={showToast}
      />

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
        <p style={styles.cardTitle}>Legal</p>
        <p style={styles.cardHint}>
          Public URLs to your Terms of Use and Privacy Policy. Linked from the
          user-app registration screen. Must be HTTPS — anything else (or a
          missing value) is treated as &quot;not configured&quot; and the labels stay
          non-clickable.
        </p>
        <label style={styles.label}>Terms of Use URL</label>
        <input
          style={styles.input}
          type="url"
          value={termsUrl}
          onChange={(e) => setTermsUrl(e.target.value)}
          placeholder="https://your-site.com/terms"
        />
        <button style={{ ...styles.saveBtn, marginBottom: 12 }} onClick={saveTerms} disabled={saving}>
          {saving ? 'Saving…' : 'Save Terms URL'}
        </button>

        <label style={styles.label}>Privacy Policy URL</label>
        <input
          style={styles.input}
          type="url"
          value={privacyUrl}
          onChange={(e) => setPrivacyUrl(e.target.value)}
          placeholder="https://your-site.com/privacy"
        />
        <button style={styles.saveBtn} onClick={savePrivacy} disabled={saving}>
          {saving ? 'Saving…' : 'Save Privacy URL'}
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

type Override = {
  id: string;
  user_id: string;
  enabled: boolean;
  granted_at: string;
  reason: string | null;
  username: string;
  email: string;
  full_name: string;
  granted_by_username: string;
};

type UserHit = { id: string; full_name: string; username: string; email: string };

function TagTransferSection({
  enabled, onToggle, saving, showToast,
}: { enabled: boolean; onToggle: (v: boolean) => void; saving: boolean; showToast: (m: string) => void }) {
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<UserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string>('');
  const [reason, setReason] = useState('');

  const fetchOverrides = async () => {
    setLoadingList(true);
    const res = await fetch('/api/feature-overrides?feature=tag_transfer');
    const data = await res.json().catch(() => ({}));
    setOverrides(data.overrides || []);
    setLoadingList(false);
  };

  useEffect(() => { fetchOverrides(); }, []);

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/feature-overrides/user-search?q=${encodeURIComponent(search.trim())}`);
      const data = await res.json().catch(() => ({}));
      setResults((data.users || []).filter((u: UserHit) => !overrides.some((o) => o.user_id === u.id)));
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [search, overrides]);

  const addUser = async (u: UserHit) => {
    setBusyId(u.id);
    const res = await fetch('/api/feature-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: u.id, feature_key: 'tag_transfer', reason: reason.trim() || null }),
    });
    setBusyId('');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || 'Could not add');
      return;
    }
    setSearch(''); setResults([]); setReason('');
    showToast(`Added ${u.username || u.email}`);
    await fetchOverrides();
  };

  const removeOverride = async (o: Override) => {
    if (!confirm(`Remove ${o.username || o.email} from the tag-transfer allow-list?`)) return;
    setBusyId(o.id);
    const res = await fetch(`/api/feature-overrides/${o.id}`, { method: 'DELETE' });
    setBusyId('');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || 'Could not remove');
      return;
    }
    showToast(`Removed ${o.username || o.email}`);
    await fetchOverrides();
  };

  return (
    <div style={styles.card}>
      <p style={styles.cardTitle}>Tag Transfer</p>
      <p style={styles.cardHint}>
        Controls peer-to-peer @username transfers globally. When disabled, ONLY users on the allow-list below
        can still send tag transfers. Hides the Transfer button in the mobile app and blocks the RPC server-side.
      </p>
      <div style={styles.gwRow}>
        <span style={styles.gwLabel}>{enabled ? 'Enabled globally' : 'Disabled globally'}</span>
        <Toggle value={enabled} onChange={onToggle} disabled={saving} />
      </div>

      {!enabled && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #EEE' }}>
          <p style={{ ...styles.cardTitle, marginBottom: 8 }}>Allow-list ({overrides.length})</p>
          <p style={styles.cardHint}>These users can transfer even with the global toggle OFF.</p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              style={{ ...styles.input, flex: 2 }}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by username, email, or full name…"
            />
            <input
              style={{ ...styles.input, flex: 1 }}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              maxLength={500}
            />
          </div>

          {search.trim() ? (
            <div style={{ border: '1px solid #EEE', borderRadius: 6, marginBottom: 12, maxHeight: 200, overflowY: 'auto' }}>
              {searching ? (
                <div style={{ padding: 12, fontSize: 12, color: '#888' }}>Searching…</div>
              ) : results.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: '#888' }}>No matches.</div>
              ) : (
                results.map((u) => (
                  <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #F5F5F5' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{u.full_name || u.username}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>@{u.username} · {u.email}</div>
                    </div>
                    <button
                      style={styles.saveBtn}
                      onClick={() => addUser(u)}
                      disabled={busyId === u.id}
                    >
                      {busyId === u.id ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {loadingList ? (
            <p style={styles.empty}>Loading allow-list…</p>
          ) : overrides.length === 0 ? (
            <p style={styles.empty}>No users on the allow-list. Tag transfer is fully blocked.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {overrides.map((o) => (
                <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: '#F9F9F9', borderRadius: 6 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{o.full_name || o.username}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>
                      @{o.username} · {o.email}
                      {o.reason ? ` · "${o.reason}"` : ''}
                      {o.granted_by_username ? ` · by ${o.granted_by_username}` : ''}
                      {' · '}{new Date(o.granted_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    style={styles.cancelBtn}
                    onClick={() => removeOverride(o)}
                    disabled={busyId === o.id}
                  >
                    {busyId === o.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
