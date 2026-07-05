'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Card, CardBody, Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Tabs, Modal, Textarea,
} from '../../../_ui';
import { formatNaira, StatusDot, StatStrip } from '../../_shared/statusUi';

type TabKey = 'transactions' | 'devices' | 'logins';

function TypeLabel({ type }: { type: string }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.04em',
      color: 'var(--fg-secondary)', background: 'var(--bg-subtle)',
      border: '1px solid var(--border-default)', padding: '2px 7px',
      borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
    }}>{(type || '-').replace(/_/g, ' ')}</span>
  );
}

export default function UserDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [freezing, setFreezing] = useState(false);
  const [showFreezeModal, setShowFreezeModal] = useState(false);
  const [freezeReason, setFreezeReason] = useState('');
  const [freezeError, setFreezeError] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('transactions');

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/users/${id}`);
    if (res.ok) {
      const json = await res.json();
      setData(json);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const handleFreeze = async () => {
    if (!freezeReason.trim()) { setFreezeError('Reason is required'); return; }
    setFreezing(true);
    setFreezeError('');
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'freeze', reason: freezeReason.trim() }),
    });
    const json = await res.json();
    setFreezing(false);
    if (!res.ok) { setFreezeError(json.error || 'Failed'); return; }
    setShowFreezeModal(false);
    setFreezeReason('');
    load();
  };

  const handleUnfreeze = async () => {
    setFreezing(true);
    await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unfreeze' }),
    });
    setFreezing(false);
    load();
  };

  if (loading) return <p style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>Loading…</p>;
  if (!data || !data.user) return <p style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>User not found</p>;

  const user = data.user;
  const stats = data.stats || {};

  const TAB_ITEMS: ReadonlyArray<{ value: TabKey; label: string }> = [
    { value: 'transactions', label: 'Recent transactions' },
    { value: 'devices', label: 'Device logs' },
    { value: 'logins', label: 'Login history' },
  ];

  return (
    <div>
      <a href="/users" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: '0.04em', color: 'var(--fg-tertiary)', textDecoration: 'none', display: 'inline-block', marginBottom: 'var(--space-4)' }}>
        ← BACK TO USERS
      </a>

      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <CardBody>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-lg)', background: 'var(--accent-base)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, flexShrink: 0 }}>
              {(user.full_name || '?').charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--fg-primary)', margin: 0 }}>{user.full_name || '—'}</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', margin: '2px 0 0' }}>@{user.username || '—'}</p>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {user.is_frozen ? (
                <>
                  <StatusDot status="Frozen" tone="danger" />
                  <Button variant="success" size="sm" onClick={handleUnfreeze} disabled={freezing}>
                    {freezing ? 'Unfreezing…' : 'Unfreeze'}
                  </Button>
                </>
              ) : (
                <Button variant="dangerSubtle" size="sm" onClick={() => setShowFreezeModal(true)} disabled={freezing}>
                  Freeze account
                </Button>
              )}
            </div>
          </div>

          {user.is_frozen && user.freeze_reason && (
            <div style={{ background: 'var(--tone-danger-bg)', border: '1px solid var(--tone-danger-border)', borderRadius: 'var(--radius-lg)', padding: 12, marginTop: 14 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--tone-danger-fg)', textTransform: 'uppercase' }}>Freeze reason</span>{' '}
              <span style={{ fontSize: 'var(--text-md)', color: 'var(--fg-secondary)' }}>{user.freeze_reason}</span>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <InfoRow label="Email" value={user.email} />
            <InfoRow label="Phone" value={user.phone} />
            <InfoRow label="Country" value={user.country} />
            <InfoRow label="Balance" value={formatNaira(user.balance)} bold mono />
            <InfoRow label="Referral code" value={user.referral_code} mono />
            <InfoRow label="Joined" value={new Date(user.created_at).toLocaleDateString()} />
          </div>
        </CardBody>
      </Card>

      <StatStrip items={[
        { label: 'Trades', value: String(stats.trades || 0) },
        { label: 'Withdrawals', value: String(stats.withdrawals || 0) },
        { label: 'Transfers', value: String(stats.transfers || 0) },
      ]} />

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Tabs<TabKey> value={activeTab} onChange={setActiveTab} items={TAB_ITEMS} variant="underline" />
      </div>

      {activeTab === 'transactions' && (
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Type</Th>
                  <Th align="right">Amount</Th>
                  <Th>Status</Th>
                  <Th>Date</Th>
                </Tr>
              </THead>
              <TBody>
                {(data.recentTransactions || []).length === 0 ? (
                  <TableEmpty colSpan={4}>No transactions</TableEmpty>
                ) : (data.recentTransactions || []).map((t: any) => (
                  <Tr key={t.id}>
                    <Td><TypeLabel type={t.type} /></Td>
                    <Td align="right" mono emphasis="primary">{formatNaira(t.amount)}</Td>
                    <Td><StatusDot status={t.status} /></Td>
                    <Td emphasis="secondary" mono>{new Date(t.created_at).toLocaleString()}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {(activeTab === 'devices' || activeTab === 'logins') && (
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Device</Th>
                  <Th>OS</Th>
                  <Th>App version</Th>
                  <Th>IP address</Th>
                  <Th>Date</Th>
                </Tr>
              </THead>
              <TBody>
                {(data[activeTab] || []).length === 0 ? (
                  <TableEmpty colSpan={5}>{activeTab === 'devices' ? 'No device logs' : 'No login history'}</TableEmpty>
                ) : (data[activeTab] || []).map((d: any, i: number) => (
                  <Tr key={i}>
                    <Td emphasis="primary">{d.device_model || '—'}</Td>
                    <Td emphasis="secondary">{d.os_version || '—'}</Td>
                    <Td emphasis="secondary">{d.app_version || '—'}</Td>
                    <Td mono emphasis="muted">{d.ip_address || '—'}</Td>
                    <Td emphasis="secondary" mono>{new Date(d.created_at).toLocaleString()}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <Modal
        open={showFreezeModal}
        onClose={() => setShowFreezeModal(false)}
        title="Freeze account"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowFreezeModal(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleFreeze} loading={freezing}>Freeze account</Button>
          </>
        }
      >
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--fg-secondary)', margin: '0 0 12px' }}>
          Freezing <strong>@{user.username}</strong> will block all transactions, withdrawals, and transfers.
        </p>
        <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500, color: 'var(--fg-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Reason</label>
        <Textarea
          value={freezeReason}
          onChange={(e) => setFreezeReason(e.target.value)}
          placeholder="Why is this account being frozen?"
          rows={3}
        />
        {freezeError && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--tone-danger-fg)', margin: '8px 0 0' }}>{freezeError}</p>}
      </Modal>
    </div>
  );
}

function InfoRow({ label, value, bold, mono }: { label: string; value: any; bold?: boolean; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-md)', gap: 16 }}>
      <span style={{ color: 'var(--fg-tertiary)' }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 550, color: 'var(--fg-primary)', maxWidth: '55%', textAlign: 'right', wordBreak: 'break-word', fontFamily: mono ? 'var(--font-mono)' : undefined }}>{value || '—'}</span>
    </div>
  );
}
