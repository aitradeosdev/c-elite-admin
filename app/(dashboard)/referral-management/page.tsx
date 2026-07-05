'use client';

import { useEffect, useState } from 'react';
import {
  PageHeader, Card, CardHeader, CardBody, CardFooter,
  Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, FieldShell, Toggle,
} from '../../_ui';
import { useIsMobile } from '../../lib/useIsMobile';
import { formatNaira, StatusDot, StatStrip, type Tone } from '../_shared/statusUi';

interface LogRow {
  id: string;
  referrer_username: string;
  referee_username: string;
  created_at: string;
  first_trade_at: string | null;
  first_trade_completed: boolean;
  referrer_bonus_amount: number;
  referee_bonus_amount: number;
  referrer_credited: boolean;
  referee_credited: boolean;
}

interface Stats {
  total_referrals: number;
  pending_payout: number;
  total_paid_out: number;
}

const CONFIG_KEYS = ['referral_active', 'referral_referrer_bonus', 'referral_referee_bonus', 'referral_min_trade_usd', 'referral_max_per_day'];

function logStatus(r: LogRow): { text: string; tone: Tone } {
  if (r.referrer_credited && r.referee_credited) return { text: 'Paid', tone: 'success' };
  if (r.first_trade_completed) return { text: 'Pending Payout', tone: 'warning' };
  return { text: 'Awaiting Trade', tone: 'neutral' };
}

function bonusOf(r: LogRow) {
  return formatNaira((r.referrer_bonus_amount || 0) + (r.referee_bonus_amount || 0));
}

function ReferralManagementMobile({ log }: { log: LogRow[] }) {
  if (log.length === 0) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>
        No referrals yet
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {log.map((r) => {
        const st = logStatus(r);
        return (
          <div key={r.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xl)', fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                {bonusOf(r)}
              </div>
              <StatusDot status={st.text} tone={st.tone} />
            </div>
            <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, marginTop: 4, color: 'var(--fg-primary)' }}>
              @{r.referrer_username} <span style={{ color: 'var(--fg-tertiary)' }}>→</span> @{r.referee_username}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 8 }}>
              referred {new Date(r.created_at).toLocaleDateString()} · first trade {r.first_trade_at ? new Date(r.first_trade_at).toLocaleDateString() : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ReferralManagementPage() {
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (silent = false) => {
    if (!silent) setLoading(true);
    const [configRes, refRes] = await Promise.all([
      fetch(`/api/app-config?keys=${CONFIG_KEYS.join(',')}`),
      fetch('/api/referrals'),
    ]);
    const configData = await configRes.json();
    const refData = await refRes.json();
    setConfig(configData.config || {});
    setStats(refData.stats || null);
    setLog(refData.log || []);
    if (!silent) setLoading(false);
  };

  const getValue = (key: string) => pending[key] ?? config[key] ?? '';
  const setValue = (key: string, value: string) => setPending((p) => ({ ...p, [key]: value }));
  const getToggle = (key: string) => getValue(key) === 'true';
  const toggleKey = (key: string) => setValue(key, getToggle(key) ? 'false' : 'true');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleSave = async () => {
    if (Object.keys(pending).length === 0) { showToast('No changes to save.'); return; }
    setSaving(true);
    const res = await fetch('/api/app-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: pending }),
    });
    setSaving(false);
    if (res.ok) { setPending({}); showToast('Referral settings saved ✓'); fetchAll(true); }
    else showToast('Failed to save settings.');
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Referral Management" subtitle="Configure referral bonuses and review every referral payout." />
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', padding: 20 }}>Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Referral Management"
        subtitle="Configure referral bonuses and review every referral payout."
      />

      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <CardHeader
          title="Settings"
          actions={
            <Toggle checked={getToggle('referral_active')} onChange={() => toggleKey('referral_active')} />
          }
        />
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
            <FieldShell label="Referrer bonus (₦)">
              <Input type="number" value={getValue('referral_referrer_bonus')} onChange={(e) => setValue('referral_referrer_bonus', e.target.value)} />
            </FieldShell>
            <FieldShell label="Referee bonus (₦)">
              <Input type="number" value={getValue('referral_referee_bonus')} onChange={(e) => setValue('referral_referee_bonus', e.target.value)} />
            </FieldShell>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <FieldShell label="Min first-trade (USD)">
              <Input type="number" value={getValue('referral_min_trade_usd')} onChange={(e) => setValue('referral_min_trade_usd', e.target.value)} />
            </FieldShell>
            <FieldShell label="Max referrals / day">
              <Input type="number" value={getValue('referral_max_per_day')} onChange={(e) => setValue('referral_max_per_day', e.target.value)} />
            </FieldShell>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: '12px 0 0' }}>Trigger: First Trade</p>
        </CardBody>
        <CardFooter style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" size="sm" loading={saving} disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </CardFooter>
      </Card>

      <StatStrip items={[
        { label: 'Total referrals', value: (stats?.total_referrals ?? 0).toLocaleString() },
        { label: 'Pending payout', value: formatNaira(stats?.pending_payout ?? 0), mono: true },
        { label: 'Total paid out', value: formatNaira(stats?.total_paid_out ?? 0), mono: true },
      ]} />

      {isMobile ? (
        <ReferralManagementMobile log={log} />
      ) : (
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Referrer</Th>
                  <Th>Referee</Th>
                  <Th>Referred On</Th>
                  <Th>First Trade</Th>
                  <Th align="right">Bonus</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {log.length === 0 ? (
                  <TableEmpty colSpan={6}>No referrals yet</TableEmpty>
                ) : log.map((r) => {
                  const st = logStatus(r);
                  return (
                    <Tr key={r.id}>
                      <Td emphasis="primary">@{r.referrer_username}</Td>
                      <Td emphasis="secondary">@{r.referee_username}</Td>
                      <Td emphasis="secondary" mono>{new Date(r.created_at).toLocaleDateString()}</Td>
                      <Td emphasis="secondary" mono>{r.first_trade_at ? new Date(r.first_trade_at).toLocaleDateString() : '—'}</Td>
                      <Td align="right" mono emphasis="primary">{bonusOf(r)}</Td>
                      <Td><StatusDot status={st.text} tone={st.tone} /></Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--fg-primary)', color: 'var(--bg-base)', padding: '10px 18px', borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-sm)', fontWeight: 600, zIndex: 51 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
