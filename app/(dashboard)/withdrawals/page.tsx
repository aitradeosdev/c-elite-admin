'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import {
  PageHeader, Card, CardBody, Badge, Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, Textarea, Tabs, SidePanel,
} from '../../_ui';

type Tab = 'all' | 'pending_review' | 'held' | 'processing' | 'success' | 'failed' | 'refunded';

const TAB_ITEMS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'pending_review', label: 'Review' },
  { value: 'held',           label: 'Held' },
  { value: 'processing',     label: 'Processing' },
  { value: 'success',        label: 'Success' },
  { value: 'failed',         label: 'Failed' },
  { value: 'refunded',       label: 'Refunded' },
  { value: 'all',            label: 'All' },
];

const REJECT_REASONS = [
  'Suspicious activity',
  'Account under review',
  'Incorrect account details',
  'Duplicate withdrawal',
  'Gateway unavailable',
];

function formatNaira(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'purple' | 'neutral' {
  switch (status) {
    case 'success': return 'success';
    case 'processing':
    case 'initiated':
    case 'pending_review': return 'warning';
    case 'held':
    case 'failed': return 'danger';
    case 'refunded': return 'purple';
    default: return 'neutral';
  }
}

export default function WithdrawalsPage() {
  const [tab, setTab] = useState<Tab>('pending_review');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCustom, setRejectCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('status', tab);
    if (search) params.set('search', search);
    params.set('limit', '200');
    const res = await fetch('/api/withdrawals?' + params.toString());
    const json = await res.json();
    setRows(json.withdrawals || []);
    setTotal(json.total || 0);
    if (!silent) setLoading(false);
  }, [tab, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { load(true); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail({ id });
    const res = await fetch('/api/withdrawals?id=' + id);
    const json = await res.json();
    setDetail(json.withdrawal || null);
    setDetailLoading(false);
  };

  const closeDetail = () => {
    setDetail(null);
    setShowApprove(false);
    setShowReject(false);
    setRejectReason('');
    setRejectCustom('');
    setErr('');
  };

  const doApprove = async () => {
    if (!detail?.id) return;
    setBusy(true); setErr('');
    const res = await fetch(`/api/withdrawals/${detail.id}/approve`, { method: 'POST' });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(json?.error || 'Approve failed'); return; }
    closeDetail();
    load();
  };

  const doReject = async () => {
    if (!detail?.id) return;
    const reason = (rejectCustom.trim() || rejectReason).trim();
    if (!reason) { setErr('Pick or enter a reason'); return; }
    setBusy(true); setErr('');
    const res = await fetch(`/api/withdrawals/${detail.id}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(json?.error || 'Reject failed'); return; }
    closeDetail();
    load();
  };

  const exportCSV = async () => {
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('status', tab);
    if (search) params.set('search', search);
    params.set('csv', '1');
    const res = await fetch('/api/withdrawals?' + params.toString());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `withdrawals-${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const canAct = (status: string) => status === 'pending_review' || status === 'held';

  return (
    <div>
      <PageHeader
        title="Withdrawals"
        subtitle="Live withdrawal queue across all statuses. Auto-refreshes every 5 seconds."
        actions={
          <Button variant="primary" size="sm" leftIcon={<Download size={14} />} onClick={exportCSV}>
            Export CSV
          </Button>
        }
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <Tabs<Tab> value={tab} onChange={setTab} items={TAB_ITEMS} />
        <Input
          placeholder="Search user or account"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260, maxWidth: 320 }}
        />
      </div>

      <Card>
        <CardBody flush>
          <Table flush>
            <THead>
              <Tr>
                <Th>User</Th>
                <Th align="right">Amount</Th>
                <Th>Bank</Th>
                <Th>Account</Th>
                <Th>Gateway ref</Th>
                <Th>Requested</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {loading ? (
                <TableEmpty colSpan={8}>Loading…</TableEmpty>
              ) : rows.length === 0 ? (
                <TableEmpty colSpan={8}>No withdrawals</TableEmpty>
              ) : rows.map((w: any) => (
                <Tr key={w.id}>
                  <Td emphasis="primary">@{w.user?.username || w.user?.full_name || '—'}</Td>
                  <Td align="right" mono emphasis="primary">{formatNaira(w.amount)}</Td>
                  <Td emphasis="secondary">{w.bank_name || '—'}</Td>
                  <Td>
                    <div>{w.account_name || '—'}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 2 }}>
                      {w.account_number || '—'}
                    </div>
                  </Td>
                  <Td emphasis="muted" mono>{w.gateway_reference || '—'}</Td>
                  <Td emphasis="secondary">{new Date(w.created_at).toLocaleString()}</Td>
                  <Td><Badge tone={statusTone(w.status)}>{(w.status || '-').replace(/_/g, ' ')}</Badge></Td>
                  <Td align="right">
                    <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                      {canAct(w.status) && (
                        <>
                          <Button variant="success" size="sm" onClick={() => { openDetail(w.id); setShowApprove(true); }}>
                            Approve
                          </Button>
                          <Button variant="dangerSubtle" size="sm" onClick={() => { openDetail(w.id); setShowReject(true); }}>
                            Reject
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openDetail(w.id)}>View</Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      {total > 0 && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 12, textAlign: 'right' }}>
          {total.toLocaleString()} total
        </div>
      )}

      <SidePanel
        open={!!detail}
        onClose={closeDetail}
        title="Withdrawal"
        subtitle={detail?.user ? `@${detail.user.username || ''}` : undefined}
      >
        {detailLoading || !detail?.user ? (
          <p style={{ color: 'var(--fg-tertiary)' }}>Loading…</p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{
                width: 44, height: 44, borderRadius: 'var(--radius-md)',
                background: 'var(--accent-base)', color: 'var(--accent-fg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700, flex: 'none',
              }}>
                {(detail.user.full_name || '?').charAt(0).toUpperCase()}
              </div>
              <div>
                <p style={{ fontSize: 'var(--text-md)', fontWeight: 700, margin: 0, color: 'var(--fg-primary)' }}>{detail.user.full_name}</p>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', margin: '2px 0 0' }}>{detail.user.email}</p>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', margin: '2px 0 0' }}>@{detail.user.username}</p>
                {detail.user.phone && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', margin: '2px 0 0' }}>{detail.user.phone}</p>}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <DetailRow label="Amount" value={formatNaira(detail.amount)} bold />
              <DetailRow label="Bank" value={detail.bank_name} />
              <DetailRow label="Account name" value={detail.account_name} />
              <DetailRow label="Account number" value={detail.account_number} />
              <DetailRow label="Gateway" value={detail.gateway || '—'} />
              <DetailRow label="Gateway ref" value={detail.gateway_reference || '—'} />
              <DetailRow label="Status" value={<Badge tone={statusTone(detail.status)}>{(detail.status || '-').replace(/_/g, ' ')}</Badge>} />
              {detail.failure_reason && <DetailRow label="Reason" value={detail.failure_reason} />}
              <DetailRow label="Requested" value={new Date(detail.created_at).toLocaleString()} />
            </div>

            {detail.flag && (
              <div style={{
                marginTop: 16, padding: 14, background: 'var(--tone-warning-bg)',
                border: '1px solid var(--tone-warning-border)', borderRadius: 'var(--radius-lg)',
              }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--tone-warning-fg)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  <AlertTriangle size={12} /> Flagged
                </div>
                <div style={{ fontSize: 'var(--text-md)', color: 'var(--tone-warning-fg)', fontWeight: 600 }}>{detail.flag.flag_reason}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 6 }}>
                  at {new Date(detail.flag.created_at).toLocaleString()}
                </div>
              </div>
            )}

            {err && (
              <div style={{
                background: 'var(--tone-danger-bg)', color: 'var(--tone-danger-fg)',
                border: '1px solid var(--tone-danger-border)', padding: '10px 12px',
                borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)', marginTop: 14,
              }}>{err}</div>
            )}

            {canAct(detail.status) && (
              <>
                {showApprove && (
                  <ConfirmBox
                    title={`Approve withdrawal of ${formatNaira(detail.amount)}?`}
                    body={`This will fire the gateway transfer to ${detail.account_name} (${detail.bank_name}).`}
                  >
                    <Button variant="secondary" onClick={() => setShowApprove(false)} disabled={busy}>Cancel</Button>
                    <Button variant="success" onClick={doApprove} loading={busy}>Confirm approve</Button>
                  </ConfirmBox>
                )}

                {showReject && (
                  <ConfirmBox
                    title="Reject withdrawal"
                    body={`Funds (${formatNaira(detail.amount)}) will be refunded to the user's wallet.`}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, width: '100%' }}>
                      {REJECT_REASONS.map((r) => (
                        <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-md)', color: 'var(--fg-primary)', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="reason"
                            value={r}
                            checked={rejectReason === r}
                            onChange={() => { setRejectReason(r); setRejectCustom(''); }}
                          />
                          <span>{r}</span>
                        </label>
                      ))}
                    </div>
                    <Textarea
                      placeholder="Or custom reason"
                      value={rejectCustom}
                      onChange={(e) => { setRejectCustom(e.target.value); setRejectReason(''); }}
                      rows={3}
                      maxLength={500}
                      style={{ marginBottom: 12 }}
                    />
                    <Button variant="secondary" onClick={() => setShowReject(false)} disabled={busy}>Cancel</Button>
                    <Button variant="danger" onClick={doReject} loading={busy}>Confirm reject</Button>
                  </ConfirmBox>
                )}

                {!showApprove && !showReject && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                    <Button variant="success" style={{ flex: 1 }} onClick={() => setShowApprove(true)}>Approve</Button>
                    <Button variant="dangerSubtle" style={{ flex: 1 }} onClick={() => setShowReject(true)}>Reject</Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </SidePanel>
    </div>
  );
}

function DetailRow({ label, value, bold }: { label: string; value: any; bold?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', gap: 16,
    }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>{label}</span>
      <span style={{
        fontSize: 'var(--text-md)', color: 'var(--fg-primary)',
        fontWeight: bold ? 700 : 500, textAlign: 'right',
      }}>{value ?? '—'}</span>
    </div>
  );
}

function ConfirmBox({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 18, padding: 16, background: 'var(--bg-subtle)',
      border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)',
    }}>
      <p style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--fg-primary)', margin: '0 0 6px' }}>{title}</p>
      <p style={{ fontSize: 'var(--text-md)', color: 'var(--fg-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>{body}</p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}
