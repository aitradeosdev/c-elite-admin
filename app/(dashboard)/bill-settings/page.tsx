'use client';

import { useEffect, useState } from 'react';
import { PageHeader, Card, CardHeader, CardBody, CardFooter, FieldShell, Input, Button } from '../../_ui';

interface Field {
  key: string;
  label: string;
  hint: string;
  inputType: 'number' | 'text';
}

const FIELDS: { section: string; items: Field[] }[] = [
  {
    section: 'Airtime',
    items: [
      { key: 'airtime_quick_amounts', label: 'Quick Amounts (CSV)', hint: 'Comma-separated buttons shown on the Airtime screen. Example: 100,200,500,1000', inputType: 'text' },
      { key: 'min_airtime_amount', label: 'Minimum Amount (₦)', hint: 'Smallest airtime purchase a user can make.', inputType: 'number' },
    ],
  },
  {
    section: 'Electricity',
    items: [
      { key: 'electricity_quick_amounts', label: 'Quick Amounts (CSV)', hint: 'Comma-separated buttons shown on the Electricity screen. Example: 1000,2000,5000,10000', inputType: 'text' },
      { key: 'min_electricity_amount', label: 'Minimum Amount (₦)', hint: 'Smallest electricity purchase a user can make.', inputType: 'number' },
    ],
  },
];

type Config = Record<string, string>;

export default function BillSettingsPage() {
  const [config, setConfig] = useState<Config>({});
  const [draft, setDraft] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/bill-settings');
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
    const res = await fetch('/api/bill-settings', {
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

  return (
    <div>
      <PageHeader
        title="Bill Settings"
        subtitle="Configure the quick-amount presets and minimum purchase limits for airtime and electricity bills."
        actions={
          <Button variant="primary" size="sm" onClick={save} disabled={!hasChanges || saving} loading={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        }
      />

      {loading ? (
        <Card>
          <CardBody>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>Loading…</p>
          </CardBody>
        </Card>
      ) : (
        <>
          {FIELDS.map((section) => (
            <Card key={section.section} style={{ marginBottom: 'var(--space-4)' }}>
              <CardHeader title={section.section} />
              <CardBody>
                <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
                  {section.items.map((f) => (
                    <FieldShell key={f.key} label={f.label} help={f.hint}>
                      <Input
                        type={f.inputType}
                        mono={f.inputType === 'number'}
                        {...(f.inputType === 'number' ? { min: 0, step: '1' } : {})}
                        value={draft[f.key] ?? ''}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      />
                    </FieldShell>
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}

          <Card>
            <CardFooter>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', letterSpacing: '0.03em', marginRight: 'auto' }}>
                {hasChanges ? `${Object.keys(changes).length} UNSAVED` : 'ALL SAVED'}
              </span>
              <Button variant="primary" size="sm" onClick={save} disabled={!hasChanges || saving} loading={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </CardFooter>
          </Card>
        </>
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
