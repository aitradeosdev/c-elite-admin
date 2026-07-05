'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  PageHeader, Card, CardBody, Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, Toggle, SidePanel,
} from '../../_ui';
import { useIsMobile } from '../../lib/useIsMobile';
import { formatNaira, StatusDot, StatStrip } from '../_shared/statusUi';

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function presence(u: any): { label: string; tone: 'success' | 'danger' | 'neutral' } {
  if (u.is_frozen) return { label: 'Frozen', tone: 'danger' };
  if (u.is_online) return { label: 'Online', tone: 'success' };
  return { label: 'Offline', tone: 'neutral' };
}

function OnlineDot() {
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--tone-success-fg)', boxShadow: '0 0 0 3px var(--tone-success-bg)', flex: 'none' }} />;
}

const microLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'var(--fg-tertiary)',
  margin: '20px 0 10px', display: 'flex', alignItems: 'center', gap: 8,
};

function MoneyRow({ amount, meta, status, when }: { amount: number | string; meta: string; status: string; when: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 96 }}>{formatNaira(amount)}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>
      <StatusDot status={status} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', whiteSpace: 'nowrap', minWidth: 64, textAlign: 'right' }}>{when}</span>
    </div>
  );
}

function emptyLine(msg: string) {
  return <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', padding: '6px 0' }}>{msg}</div>;
}

function DetailBody({ detail, detailLoading, terminate, actionBusy, err }: {
  detail: any; detailLoading: boolean; terminate: () => void; actionBusy: boolean; err: string;
}) {
  if (detailLoading || !detail?.user) {
    return <div style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)', padding: '20px 0' }}>Loading…</div>;
  }
  const p = presence(detail.user);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-lg)', background: 'var(--accent-base)', color: 'var(--accent-fg)', display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 700, flex: 'none' }}>
          {(detail.user.full_name || detail.user.username || '?').charAt(0).toUpperCase()}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--fg-primary)' }}>@{detail.user.username || detail.user.full_name}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 3 }}>
            {detail.user.email}{detail.user.phone ? ' · ' + detail.user.phone : ''}
          </div>
        </div>
        <StatusDot status={p.label} tone={p.tone} />
      </div>

      <div style={{ marginTop: 14 }}>
        <Button variant="danger" size="sm" loading={actionBusy} onClick={terminate} style={{ width: '100%', justifyContent: 'center' }}>
          {actionBusy ? 'Terminating…' : 'Terminate all sessions'}
        </Button>
      </div>

      {err && (
        <div style={{ background: 'var(--tone-danger-bg)', color: 'var(--tone-danger-fg)', border: '1px solid var(--tone-danger-border)', padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', marginTop: 12 }}>{err}</div>
      )}

      <div style={microLabel}>Sessions <span style={{ color: 'var(--fg-disabled)' }}>· {detail.sessions.length}</span></div>
      {detail.sessions.length === 0 ? emptyLine('No sessions.') : detail.sessions.map((se: any) => (
        <div key={se.id} style={{ padding: '11px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)' }}>{new Date(se.created_at).toLocaleString()}</span>
            {se.ended_at
              ? <StatusDot status={`Ended ${timeAgo(se.ended_at)}`} tone="neutral" />
              : <StatusDot status="Active" tone="success" />}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
            {[se.device_model, se.os_version, se.app_version].filter(Boolean).join(' · ') || '—'} · IP {se.ip_address || '—'}
          </div>
        </div>
      ))}

      <div style={microLabel}>Recent withdrawals</div>
      {detail.withdrawals.length === 0 ? emptyLine('None.') : detail.withdrawals.map((w: any) => (
        <MoneyRow key={w.id} amount={w.amount} meta={`${w.bank_name || ''} · ${w.account_name || ''}`} status={w.status} when={timeAgo(w.created_at)} />
      ))}

      <div style={microLabel}>Recent transfers</div>
      {detail.transfers.length === 0 ? emptyLine('None.') : detail.transfers.map((t: any) => (
        <MoneyRow key={t.id} amount={t.amount} meta={t.type} status={t.status} when={timeAgo(t.created_at)} />
      ))}

      <div style={microLabel}>Recent transactions</div>
      {detail.transactions.length === 0 ? emptyLine('None.') : detail.transactions.map((tx: any) => (
        <MoneyRow key={tx.id} amount={tx.amount} meta={tx.type} status={tx.status} when={timeAgo(tx.created_at)} />
      ))}
    </>
  );
}

function ActivityMobile({ rows, loading, onOpen }: { rows: any[]; loading: boolean; onOpen: (id: string) => void }) {
  if (loading && rows.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3].map((k) => (
          <div key={k} style={{ height: 70, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', opacity: 0.5 }} />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>No users</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((u: any) => {
        const p = presence(u);
        return (
          <div key={u.id} onClick={() => onOpen(u.id)} style={{ background: 'var(--bg-surface)', cursor: 'pointer', padding: 14, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0, fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--fg-primary)', display: 'flex', alignItems: 'center', gap: 7 }}>
                {u.is_online && <OnlineDot />}@{u.username || u.full_name || '—'}
              </div>
              <StatusDot status={p.label} tone={p.tone} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email || '—'}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', whiteSpace: 'nowrap' }}>{timeAgo(u.last_active_at)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function UserActivityMonitorPage() {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<any[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [onlyOnline, setOnlyOnline] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [err, setErr] = useState('');
  const limit = 25;

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (search) p.set('search', search);
    if (onlyOnline) p.set('online', '1');
    p.set('page', String(page));
    p.set('limit', String(limit));
    return p;
  }, [search, onlyOnline, page]);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/user-activity-monitor?' + buildParams().toString());
    if (res.status === 403) { setErr('Forbidden (super-admin only)'); setLoading(false); return; }
    const json = await res.json();
    setRows(json.users || []);
    setTotal(json.total || 0);
    setOnlineCount(json.online_count || 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, onlyOnline]);
  useEffect(() => {
    const t = setInterval(() => { load(); }, 30000);
    return () => clearInterval(t);
  }, [page, onlyOnline, search]);

  const openDetail = async (id: string) => {
    setSelected(id); setDetail(null); setDetailLoading(true); setErr('');
    const res = await fetch(`/api/user-activity-monitor/${id}`);
    const json = await res.json();
    if (!res.ok) { setErr(json?.error || 'Load failed'); setDetailLoading(false); return; }
    setDetail(json);
    setDetailLoading(false);
  };

  const terminate = async () => {
    if (!selected || !detail?.user) return;
    if (!confirm(`Force log out @${detail.user.username || detail.user.full_name}? All active sessions will be revoked.`)) return;
    setActionBusy(true); setErr('');
    const res = await fetch(`/api/user-activity-monitor/${selected}/terminate`, { method: 'POST' });
    const json = await res.json();
    setActionBusy(false);
    if (!res.ok) { setErr(json?.error || 'Terminate failed'); return; }
    await openDetail(selected);
    load();
  };

  const closePanel = () => { setSelected(null); setDetail(null); setErr(''); };
  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <PageHeader
        title="User activity monitor"
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <OnlineDot />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: '0.04em', color: 'var(--fg-tertiary)' }}>
              LIVE · {onlineCount.toLocaleString()} ONLINE · AUTO-REFRESH 30s
            </span>
          </span>
        }
      />

      <StatStrip items={[
        { label: 'Online now', value: onlineCount.toLocaleString() },
        { label: 'Total users', value: total.toLocaleString() },
      ]} />

      {err && !selected && (
        <div style={{ backgroundColor: 'var(--tone-danger-bg)', color: 'var(--tone-danger-fg)', border: '1px solid var(--tone-danger-border)', padding: '10px 14px', borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <Input
          placeholder="Search username, name, email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (setPage(1), load())}
          style={{ minWidth: 260 }}
        />
        <Toggle label="Online only" checked={onlyOnline} onChange={(next) => { setOnlyOnline(next); setPage(1); }} />
        <Button variant="primary" size="sm" onClick={() => { setPage(1); load(); }}>Apply</Button>
      </div>

      {isMobile ? (
        <ActivityMobile rows={rows} loading={loading} onOpen={openDetail} />
      ) : (
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>User</Th>
                  <Th>Email</Th>
                  <Th>Last active</Th>
                  <Th>Status</Th>
                  <Th align="right"></Th>
                </Tr>
              </THead>
              <TBody>
                {loading && rows.length === 0 ? (
                  <TableEmpty colSpan={5}>Loading…</TableEmpty>
                ) : rows.length === 0 ? (
                  <TableEmpty colSpan={5}>No users</TableEmpty>
                ) : rows.map((u: any) => {
                  const p = presence(u);
                  return (
                    <Tr key={u.id} interactive selected={selected === u.id} onClick={() => openDetail(u.id)}>
                      <Td emphasis="primary">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                          {u.is_online ? <OnlineDot /> : <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--border-strong)', flex: 'none' }} />}
                          @{u.username || u.full_name || '—'}
                        </span>
                      </Td>
                      <Td emphasis="secondary">{u.email || '—'}</Td>
                      <Td emphasis="secondary" mono>{timeAgo(u.last_active_at)}</Td>
                      <Td><StatusDot status={p.label} tone={p.tone} /></Td>
                      <Td align="right"><span style={{ color: 'var(--fg-disabled)' }}>›</span></Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 'var(--space-4)' }}>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', letterSpacing: '0.03em' }}>
            PAGE {page} / {totalPages}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
        </div>
      )}

      <SidePanel
        open={!!selected}
        onClose={closePanel}
        title="Activity detail"
        subtitle={detail?.user ? `@${detail.user.username || detail.user.full_name}` : undefined}
      >
        <DetailBody detail={detail} detailLoading={detailLoading} terminate={terminate} actionBusy={actionBusy} err={err} />
      </SidePanel>
    </div>
  );
}
