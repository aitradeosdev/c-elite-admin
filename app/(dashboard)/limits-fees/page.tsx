'use client';

import { useEffect, useState } from 'react';
import { PageHeader, Card, CardHeader, CardBody, CardFooter, FieldShell, Input, Button } from '../../_ui';

interface Field { key: string; label: string; hint: string; type?: 'number' | 'text'; }

const FIELDS: { section: string; items: Field[] }[] = [
  {
    section: 'Withdrawals',
    items: [
      { key: 'min_withdrawal_amount', label: 'Minimum Withdrawal (₦)', hint: 'Smallest amount a user can withdraw per request.' },
      { key: 'max_withdrawal_amount', label: 'Maximum Withdrawal (₦)', hint: 'Largest amount a user can withdraw in a single request.' },
      { key: 'max_daily_withdrawal', label: 'Daily Withdrawal Cap (₦)', hint: 'Total per-user per-day limit across all withdrawals.' },
      { key: 'pin_reset_freeze_hours', label: 'PIN-Reset Withdrawal Freeze (hours)', hint: 'After a user resets their PIN via OTP, withdrawals are blocked for this many hours. Set 0 to disable. Max 720 (30 days).' },
      { key: 'withdraw_fee', label: 'Withdraw Fee (₦)', hint: 'Flat fee charged on withdrawals to bank accounts. Set 0 for free.' },
    ],
  },
  {
    section: 'Transfers',
    items: [
      { key: 'transfer_tag_fee', label: 'Tag Transfer Fee (₦)', hint: 'Flat fee charged on sender for @tag transfers. Set 0 for free.' },
      { key: 'transfer_quick_amounts', label: 'Tag Transfer Quick Amounts (CSV)', hint: 'Comma-separated preset buttons on the tag-transfer screen. Example: 500,1000,2000,5000,10000', type: 'text' },
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

  const fetchConfig = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/limits-fees');
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
    const res = await fetch('/api/limits-fees', {
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
        title="Limits & Fees"
        subtitle="Set withdrawal limits, transfer fees, and the auto-flag threshold that gate money movement across the app."
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
                        type={f.type === 'text' ? 'text' : 'number'}
                        mono={f.type !== 'text'}
                        {...(f.type === 'text' ? {} : { min: 0, step: '1' })}
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
