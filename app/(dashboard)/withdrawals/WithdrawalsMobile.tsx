'use client';

import { Button } from '../../_ui';

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

function StatusDot({ status }: { status: string }) {
  const tone = statusTone(status);
  const color =
    tone === 'success' ? 'var(--tone-success-fg)' :
    tone === 'warning' ? 'var(--tone-warning-fg)' :
    tone === 'danger'  ? 'var(--tone-danger-fg)'  :
    tone === 'purple'  ? 'var(--tone-purple-fg)'  : 'var(--fg-secondary)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)', fontWeight: 500, color, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flex: 'none' }} />
      {(status || '-').replace(/_/g, ' ')}
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-xl)',
  padding: 14,
  cursor: 'pointer',
};

export interface WithdrawalsMobileProps {
  rows: any[];
  loading: boolean;
  onOpen: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  canAct: (status: string) => boolean;
}

export function WithdrawalsMobile({ rows, loading, onOpen, onApprove, onReject, canAct }: WithdrawalsMobileProps) {
  if (loading && rows.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3].map((k) => (
          <div key={k} style={{ ...cardStyle, height: 92, opacity: 0.5 }} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center',
        color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)',
      }}>
        No withdrawals
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((w: any) => (
        <div
          key={w.id}
          style={{ ...cardStyle, boxShadow: w.flag ? 'inset 2px 0 0 var(--tone-warning-fg)' : undefined }}
          onClick={() => onOpen(w.id)}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xl)', fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                {formatNaira(w.amount)}
              </div>
              <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, marginTop: 2, color: 'var(--fg-primary)' }}>
                @{w.user?.username || w.user?.full_name || '—'}
              </div>
            </div>
            <StatusDot status={w.status} />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 8, letterSpacing: '0.02em' }}>
            {(w.bank_name || '—')} · {w.account_number || '—'} · {new Date(w.created_at).toLocaleString()}
          </div>
          {canAct(w.status) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
              <Button variant="success" size="sm" style={{ flex: 1 }} onClick={() => onApprove(w.id)}>Approve</Button>
              <Button variant="dangerSubtle" size="sm" style={{ flex: 1 }} onClick={() => onReject(w.id)}>Reject</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
