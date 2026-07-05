import React from 'react';

export function formatNaira(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

export type Tone = 'success' | 'warning' | 'danger' | 'purple' | 'info' | 'neutral';

export function statusTone(status: string): Tone {
  switch ((status || '').toLowerCase()) {
    case 'success':
    case 'completed':
    case 'approved':
    case 'active':
      return 'success';
    case 'processing':
    case 'initiated':
    case 'pending':
    case 'pending_review':
    case 'held':
    case 'review':
      return 'warning';
    case 'failed':
    case 'rejected':
    case 'declined':
    case 'blocked':
      return 'danger';
    case 'refunded':
      return 'purple';
    default:
      return 'neutral';
  }
}

function toneColor(tone: Tone) {
  return tone === 'success' ? 'var(--tone-success-fg)'
    : tone === 'warning' ? 'var(--tone-warning-fg)'
    : tone === 'danger' ? 'var(--tone-danger-fg)'
    : tone === 'purple' ? 'var(--tone-purple-fg)'
    : tone === 'info' ? 'var(--tone-info-fg)'
    : 'var(--fg-secondary)';
}

export function StatusDot({ status, tone }: { status: string; tone?: Tone }) {
  const color = toneColor(tone ?? statusTone(status));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 'var(--text-sm)', fontWeight: 500, color, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flex: 'none' }} />
      {(status || '-').replace(/_/g, ' ')}
    </span>
  );
}

export interface StatItem { label: string; value: string; mono?: boolean; }

export function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)',
      overflow: 'hidden', marginBottom: 'var(--space-4)',
    }}>
      {items.map((it, i) => (
        <div key={it.label} style={{
          padding: '13px 18px',
          borderRight: i === items.length - 1 ? undefined : '1px solid var(--border-subtle)',
          display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0,
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.11em', textTransform: 'uppercase', color: 'var(--fg-tertiary)' }}>{it.label}</span>
          <span style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', fontFamily: it.mono ? 'var(--font-mono)' : undefined }}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}
