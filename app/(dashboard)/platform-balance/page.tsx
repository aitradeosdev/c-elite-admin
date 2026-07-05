'use client';

import { useEffect, useState } from 'react';
import { PageHeader, Card, CardHeader, CardBody, CardFooter, FieldShell, Input, Button, Tabs } from '../../_ui';
import { StatStrip } from '../_shared/statusUi';

type Config = Record<string, string>;

export default function PlatformBalancePage() {
  const [config, setConfig] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [staticInput, setStaticInput] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/platform-balance');
    const data = await res.json().catch(() => ({}));
    const cfg: Config = data.config || {};
    setConfig(cfg);
    setStaticInput(cfg.platform_balance_static || '');
    if (!silent) setLoading(false);
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
    await fetchConfig(true);
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

  if (loading) {
    return (
      <div>
        <PageHeader title="Platform Balance" subtitle="Choose how the platform balance is sourced and reported." />
        <Card>
          <CardBody>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>Loading…</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Platform Balance" subtitle="Choose how the platform balance is sourced and reported." />

      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <CardHeader title="Mode" subtitle="Static uses a manually entered value; Live auto-fetches from the payment gateway." />
        <CardBody>
          <Tabs
            value={mode}
            onChange={(v) => !saving && setMode(v)}
            items={[
              { value: 'static', label: 'Static' },
              { value: 'live', label: 'Live' },
            ]}
          />
        </CardBody>
      </Card>

      {mode === 'static' ? (
        <Card>
          <CardHeader title="Static Balance" />
          <CardBody>
            <FieldShell label="Static Balance (₦)">
              <Input
                type="number"
                mono
                min={0}
                step="0.01"
                value={staticInput}
                onChange={(e) => setStaticInput(e.target.value)}
                placeholder="0.00"
              />
            </FieldShell>
          </CardBody>
          <CardFooter style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" size="sm" onClick={saveStatic} disabled={saving} loading={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Live Balance" />
          <CardBody>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', margin: '0 0 var(--space-4)', lineHeight: 1.5 }}>
              Balance is automatically refreshed from the <strong>{gateway}</strong> API every 30 minutes.
            </p>
            <StatStrip items={[
              {
                label: 'Current Balance',
                value: liveValue ? `₦${Number(liveValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—',
                mono: true,
              },
              {
                label: 'Last Updated',
                value: liveAt ? new Date(liveAt).toLocaleString() : 'Never',
              },
            ]} />
            {liveError && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--tone-danger-fg)', margin: 'var(--space-2) 0 0' }}>
                Error: {liveError}
              </p>
            )}
          </CardBody>
        </Card>
      )}

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
