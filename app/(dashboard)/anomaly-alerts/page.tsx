'use client';

import { useEffect, useState } from 'react';
import { PageHeader, Card, CardHeader, CardBody, CardFooter, FieldShell, Input, Button } from '../../_ui';

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
      { key: 'alert_timezone', label: 'Alert Email Timezone', hint: 'IANA timezone (e.g. Africa/Lagos) used only for timestamps shown in security alert emails. Does not affect anomaly detection or withdrawal limits.', inputType: 'text' },
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

  return (
    <div>
      <PageHeader
        title="Anomaly & Alerts"
        subtitle="Tune the thresholds that drive fraud detection and critical security alert emails."
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
                        {...(f.inputType === 'number' ? { min: 0, step: f.step ?? '1' } : {})}
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
