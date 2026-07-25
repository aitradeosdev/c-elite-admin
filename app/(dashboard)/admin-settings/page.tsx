'use client';

import { useEffect, useState } from 'react';
import {
  PageHeader, Card, CardHeader, CardBody, CardFooter,
  Table, THead, TBody, Tr, Th, Td, TableEmpty,
  FieldShell, Input, Select, Toggle, Button, Modal,
} from '../../_ui';
import { useIsMobile } from '../../lib/useIsMobile';

type Config = Record<string, string>;

const GATEWAYS = [
  { key: 'paystack', label: 'Paystack' },
  { key: 'monnify', label: 'Monnify' },
  { key: 'novac', label: 'Novac' },
];

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 12px', background: 'var(--bg-subtle)',
  borderRadius: 'var(--radius-md)', gap: 12,
};
const rowLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--fg-primary)', flex: 1,
};

export default function AdminSettingsPage() {
  const [config, setConfig] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
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
  const [playstoreUrl, setPlaystoreUrl] = useState('');
  const [appstoreUrl, setAppstoreUrl] = useState('');

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
    setPlaystoreUrl(cfg.store_url_android || '');
    setAppstoreUrl(cfg.store_url_ios || '');
    setLoading(false);
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const save = async (changes: Record<string, string>, key: string) => {
    setSavingKey(key);
    try {
      const res = await fetch('/api/admin-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(body.error || 'Save failed'); return false; }
      showToast('Saved');
      setConfig((c) => ({ ...c, ...changes }));
      return true;
    } finally {
      setSavingKey(null);
    }
  };

  const toggleGateway = (g: string, enabled: boolean) => {
    const primary = config.active_payment_gateway;
    if (!enabled && primary === g) {
      showToast('Cannot disable the primary gateway');
      return;
    }
    save({ [`gateway_${g}_enabled`]: enabled ? 'true' : 'false' }, 'gateways');
  };

  const setPrimary = (g: string) => {
    if (config[`gateway_${g}_enabled`] !== 'true') {
      showToast('Enable the gateway first');
      return;
    }
    save({ active_payment_gateway: g }, 'gateways');
  };

  const toggleVtpass = (v: boolean) => save({ bill_vtpass_enabled: v ? 'true' : 'false' }, 'vtpass');
  const saveLiveChat = () => save({ live_chat_url: liveChatUrl }, 'liveChat');
  const saveMaxApproval = () => {
    const n = Number(maxApproval);
    if (!Number.isFinite(n) || n < 1000) {
      showToast('Enter a valid amount (minimum ₦1,000)');
      return;
    }
    save({ max_card_approval_naira: String(Math.floor(n)) }, 'maxApproval');
  };
  const saveVersion = () => save({
    app_current_version: curVer,
    app_minimum_version: minVer,
    app_update_type: updType,
    app_update_message: updMsg,
  }, 'version');

  const isValidUrl = (u: string) => u.length === 0 || /^https?:\/\/[^\s<>"']{3,}$/i.test(u.trim());
  const saveTerms = () => {
    if (!isValidUrl(termsUrl)) { showToast('Terms URL must start with https://'); return; }
    save({ terms_url: termsUrl.trim() }, 'terms');
  };
  const savePrivacy = () => {
    if (!isValidUrl(privacyUrl)) { showToast('Privacy URL must start with https://'); return; }
    save({ privacy_url: privacyUrl.trim() }, 'privacy');
  };
  const saveStoreLinks = () => {
    if (!isValidUrl(playstoreUrl)) { showToast('Play Store URL must start with https://'); return; }
    if (!isValidUrl(appstoreUrl)) { showToast('App Store URL must start with https://'); return; }
    save({ store_url_android: playstoreUrl.trim(), store_url_ios: appstoreUrl.trim() }, 'storeLinks');
  };

  const confirmEmergency = async () => {
    if (!emergencyConfirm) return;
    const ok = await save({ emergency_mode: emergencyConfirm === 'on' ? 'true' : 'false' }, 'emergency');
    if (ok) setEmergencyConfirm(null);
  };

  if (forbidden) {
    return (
      <div>
        <PageHeader title="Admin Settings" subtitle="Global platform configuration." />
        <Card><CardBody><p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', margin: 0 }}>Super-admin access only.</p></CardBody></Card>
      </div>
    );
  }
  if (loading) {
    return (
      <div>
        <PageHeader title="Admin Settings" subtitle="Global platform configuration." />
        <Card><CardBody><p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', margin: 0 }}>Loading…</p></CardBody></Card>
      </div>
    );
  }

  const emergencyOn = config.emergency_mode === 'true';
  const primary = config.active_payment_gateway;

  return (
    <div>
      <PageHeader title="Admin Settings" subtitle="Global platform configuration." />

      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <CardHeader
          title="Payment Gateways"
          subtitle="Credentials live in Supabase function secrets. Toggle which gateways are live; choose one as Primary."
        />
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {GATEWAYS.map((g) => {
              const enabled = config[`gateway_${g.key}_enabled`] === 'true';
              const isPrimary = primary === g.key;
              return (
                <div key={g.key} style={rowStyle}>
                  <span style={rowLabelStyle}>{g.label}</span>
                  <label style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="primary_gateway"
                      checked={isPrimary}
                      onChange={() => setPrimary(g.key)}
                      disabled={savingKey === 'gateways' || !enabled}
                    />
                    Primary
                  </label>
                  <Toggle checked={enabled} onChange={(v) => toggleGateway(g.key, v)} disabled={savingKey === 'gateways'} />
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <CardHeader
          title="Risk Limits"
          subtitle='Maximum gift-card approval amount (NGN) any non-super admin can authorise. Approvals above this threshold are rejected by the server with an "escalate to super admin" error. Default 5,000,000.'
        />
        <CardBody>
          <FieldShell label="Max card approval (NGN)">
            <Input
              type="number"
              mono
              inputMode="numeric"
              min={1000}
              step={1000}
              value={maxApproval}
              onChange={(e) => setMaxApproval(e.target.value)}
              placeholder="5000000"
            />
          </FieldShell>
        </CardBody>
        <CardFooter style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" size="sm" onClick={saveMaxApproval} disabled={savingKey === 'maxApproval'} loading={savingKey === 'maxApproval'}>
            {savingKey === 'maxApproval' ? 'Saving…' : 'Save'}
          </Button>
        </CardFooter>
      </Card>

      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <CardHeader title="Bill Payment API" />
        <CardBody>
          <div style={rowStyle}>
            <span style={rowLabelStyle}>VTpass</span>
            <Toggle
              checked={config.bill_vtpass_enabled === 'true'}
              onChange={toggleVtpass}
              disabled={savingKey === 'vtpass'}
            />
          </div>
        </CardBody>
      </Card>

      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <CardHeader
          title="Live Chat URL"
          subtitle='Direct chat link from your provider dashboard (e.g. Tawk/LiveChat/Smartsupp "Shareable Chat Link"). Opens full-screen in the Support tab.'
        />
        <CardBody>
          <FieldShell label="Live Chat URL">
            <Input
              type="url"
              value={liveChatUrl}
              onChange={(e) => setLiveChatUrl(e.target.value)}
              placeholder="https://direct.lc.chat/..."
            />
          </FieldShell>
        </CardBody>
        <CardFooter style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" size="sm" onClick={saveLiveChat} disabled={savingKey === 'liveChat'} loading={savingKey === 'liveChat'}>
            {savingKey === 'liveChat' ? 'Saving…' : 'Save'}
          </Button>
        </CardFooter>
      </Card>

      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <CardHeader
          title="Legal"
          subtitle='Public URLs to your Terms of Use and Privacy Policy. Linked from the user-app registration screen. Must be HTTPS — anything else (or a missing value) is treated as "not configured" and the labels stay non-clickable.'
        />
        <CardBody>
          <FieldShell label="Terms of Use URL">
            <Input
              type="url"
              value={termsUrl}
              onChange={(e) => setTermsUrl(e.target.value)}
              placeholder="https://your-site.com/terms"
            />
          </FieldShell>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0 16px' }}>
            <Button variant="primary" size="sm" onClick={saveTerms} disabled={savingKey === 'terms'} loading={savingKey === 'terms'}>
              {savingKey === 'terms' ? 'Saving…' : 'Save Terms URL'}
            </Button>
          </div>

          <FieldShell label="Privacy Policy URL">
            <Input
              type="url"
              value={privacyUrl}
              onChange={(e) => setPrivacyUrl(e.target.value)}
              placeholder="https://your-site.com/privacy"
            />
          </FieldShell>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <Button variant="primary" size="sm" onClick={savePrivacy} disabled={savingKey === 'privacy'} loading={savingKey === 'privacy'}>
              {savingKey === 'privacy' ? 'Saving…' : 'Save Privacy URL'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <CardHeader
          title="App Store Links"
          subtitle={'Public store listing URLs. Used by the app’s update prompt to send users to the right store. Must be HTTPS — a missing or invalid value is treated as "not configured".'}
        />
        <CardBody>
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <FieldShell label="Google Play Store URL">
              <Input
                type="url"
                value={playstoreUrl}
                onChange={(e) => setPlaystoreUrl(e.target.value)}
                placeholder="https://play.google.com/store/apps/details?id=com.cardelite.app"
              />
            </FieldShell>
            <FieldShell label="Apple App Store URL">
              <Input
                type="url"
                value={appstoreUrl}
                onChange={(e) => setAppstoreUrl(e.target.value)}
                placeholder="https://apps.apple.com/app/id000000000"
              />
            </FieldShell>
          </div>
        </CardBody>
        <CardFooter style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" size="sm" onClick={saveStoreLinks} disabled={savingKey === 'storeLinks'} loading={savingKey === 'storeLinks'}>
            {savingKey === 'storeLinks' ? 'Saving…' : 'Save Store Links'}
          </Button>
        </CardFooter>
      </Card>

      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <CardHeader title="App Version" />
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <FieldShell label="Current Version">
              <Input value={curVer} onChange={(e) => setCurVer(e.target.value)} placeholder="1.0.0" />
            </FieldShell>
            <FieldShell label="Minimum Version">
              <Input value={minVer} onChange={(e) => setMinVer(e.target.value)} placeholder="1.0.0" />
            </FieldShell>
            <FieldShell label="Update Type">
              <Select value={updType} onChange={(e) => setUpdType(e.target.value)}>
                <option value="soft">Soft</option>
                <option value="force">Force</option>
              </Select>
            </FieldShell>
            <div style={{ gridColumn: '1 / -1' }}>
              <FieldShell label="Update Message">
                <Input value={updMsg} onChange={(e) => setUpdMsg(e.target.value)} />
              </FieldShell>
            </div>
          </div>
        </CardBody>
        <CardFooter style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" size="sm" onClick={saveVersion} disabled={savingKey === 'version'} loading={savingKey === 'version'}>
            {savingKey === 'version' ? 'Saving…' : 'Save'}
          </Button>
        </CardFooter>
      </Card>

      <Card style={{ marginBottom: 'var(--space-4)', borderColor: emergencyOn ? 'var(--tone-danger-fg)' : undefined }}>
        <CardHeader
          title={<span style={{ color: emergencyOn ? 'var(--tone-danger-fg)' : undefined }}>Emergency Mode</span>}
          subtitle="When ON, all mobile clients are force-logged-out and shown a blocking maintenance modal on next resume."
        />
        <CardBody>
          <div style={rowStyle}>
            <span style={rowLabelStyle}>{emergencyOn ? 'ACTIVE' : 'Off'}</span>
            <Button
              variant={emergencyOn ? 'danger' : 'primary'}
              size="sm"
              onClick={() => setEmergencyConfirm(emergencyOn ? 'off' : 'on')}
              disabled={savingKey === 'emergency'}
            >
              {emergencyOn ? 'Disable Emergency Mode' : 'Enable Emergency Mode'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Modal
        open={!!emergencyConfirm}
        onClose={() => setEmergencyConfirm(null)}
        size="sm"
        title={emergencyConfirm === 'on' ? 'Enable Emergency Mode?' : 'Disable Emergency Mode?'}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEmergencyConfirm(null)} disabled={savingKey === 'emergency'}>Cancel</Button>
            <Button
              variant={emergencyConfirm === 'on' ? 'danger' : 'primary'}
              size="sm"
              onClick={confirmEmergency}
              disabled={savingKey === 'emergency'}
              loading={savingKey === 'emergency'}
            >
              {savingKey === 'emergency' ? 'Working…' : 'Confirm'}
            </Button>
          </>
        }
      >
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', lineHeight: 1.5, margin: 0 }}>
          {emergencyConfirm === 'on'
            ? 'This will force-logout every user on the mobile app and block access until you disable it. Continue?'
            : 'Users will regain access to the app. Continue?'}
        </p>
      </Modal>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)', color: 'var(--fg-primary)',
          padding: '10px 16px', borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-xs)',
          fontWeight: 600, boxShadow: 'var(--shadow-md)', zIndex: 100,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

type UserHit = { id: string; full_name: string; username: string; email: string };

