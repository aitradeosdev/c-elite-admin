'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import {
  PageHeader, Card, CardBody, Badge, Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Select, Modal,
} from '../../_ui';

export type RangeKey = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'month';

function rangeBounds(key: RangeKey): { from: Date | null; to: Date | null; label: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (key === 'today') {
    return { from: startOfDay(now), to: null, label: 'Today' };
  }
  if (key === 'yesterday') {
    const y = startOfDay(new Date(now.getTime() - 86_400_000));
    const t = startOfDay(now);
    return { from: y, to: t, label: 'Yesterday' };
  }
  if (key === '7d') {
    const f = startOfDay(new Date(now.getTime() - 6 * 86_400_000));
    return { from: f, to: null, label: 'Last 7 days' };
  }
  if (key === '30d') {
    const f = startOfDay(new Date(now.getTime() - 29 * 86_400_000));
    return { from: f, to: null, label: 'Last 30 days' };
  }
  if (key === 'month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null, label: 'This month' };
  }
  return { from: null, to: null, label: 'All time' };
}

interface ActivityRow {
  id: string;
  admin_id: string;
  admin_username: string | null;
  admin_role_title: string | null;
  admin_is_super: boolean;
  action: string;
  entity: string | null;
  entity_id: string | null;
  ip_address: string | null;
  created_at: string;
  before_value: any | null;
  after_value: any | null;
  target_username: string | null;
  target_label: string | null;
}

interface AdminRow {
  id: string;
  username: string | null;
  role_title: string | null;
  is_super_admin: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  APPROVE_CARD: 'Approved card',
  APPROVE_CARD_CORRECTED: 'Approved card (corrected)',
  REJECT_CARD: 'Rejected card',
  OVERTURN_CARD_DISPUTE: 'Overturned card dispute',
  UPHOLD_CARD_DISPUTE: 'Upheld card dispute',
  APPROVE_WITHDRAWAL: 'Approved withdrawal',
  REJECT_WITHDRAWAL: 'Rejected withdrawal',
  REFUND_TRANSFER: 'Refunded transfer',
  FREEZE_USER: 'Froze user',
  UNFREEZE_USER: 'Unfroze user',
  TERMINATE_USER_SESSIONS: 'Terminated sessions',
  CREATE_ADMIN: 'Created admin',
  EDIT_ADMIN: 'Edited admin',
  REACTIVATE_ADMIN: 'Reactivated admin',
  DEACTIVATE_ADMIN: 'Deactivated admin',
  DELETE_ADMIN: 'Deleted admin',
  CREATE_COUPON: 'Created coupon',
  UPDATE_COUPON: 'Updated coupon',
  GRANT_FEATURE_OVERRIDE: 'Granted feature override',
  REVOKE_FEATURE_OVERRIDE: 'Revoked feature override',
  BROADCAST_NOTIFICATION: 'Sent broadcast',
  CLEAR_FLAG: 'Cleared flag',
  ESCALATE_FLAG: 'Escalated flag',
  BATCH_UPDATE_RATES: 'Updated rates',
  CREATE_DENOMINATION: 'Created denomination',
  UPDATE_LIMITS_FEES: 'Updated limits & fees',
  UPDATE_ADMIN_SETTINGS: 'Updated admin settings',
  UPDATE_PLATFORM_BALANCE: 'Updated platform balance',
  CREATE_CARD: 'Created card',
  UPDATE_CARD: 'Updated card',
  REORDER_CARDS: 'Reordered cards',
  ADD_CARD_COUNTRY: 'Added country to card',
  UPDATE_CARD_COUNTRY: 'Updated card country',
  REMOVE_CARD_COUNTRY: 'Removed card country',
  CREATE_CARD_TYPE: 'Created card type',
  UPDATE_CARD_TYPE: 'Updated card type',
  DELETE_CARD_TYPE: 'Deleted card type',
  CREATE_FIELD: 'Created field',
  UPDATE_FIELD: 'Updated field',
  DELETE_FIELD: 'Deleted field',
  REORDER_FIELDS: 'Reordered fields',
  UPDATE_NOTIFICATION_TEMPLATE: 'Updated notification template',
  UPDATE_EMAIL_TEMPLATE: 'Updated email template',
};

function actionLabel(raw: string): string {
  return ACTION_LABEL[raw] || raw.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function actionTone(raw: string): 'success' | 'danger' | 'info' | 'neutral' {
  if (raw.startsWith('APPROVE') || raw.startsWith('OVERTURN') || raw.startsWith('REACTIVATE') || raw.startsWith('UNFREEZE')) return 'success';
  if (raw.startsWith('REJECT') || raw.startsWith('UPHOLD') || raw.startsWith('FREEZE') || raw.startsWith('DEACTIVATE') || raw.startsWith('DELETE') || raw.startsWith('REVOKE') || raw.startsWith('TERMINATE') || raw.startsWith('REFUND') || raw.startsWith('ESCALATE')) return 'danger';
  if (raw.startsWith('CREATE') || raw.startsWith('GRANT') || raw.startsWith('ADD') || raw.startsWith('BROADCAST') || raw.startsWith('CLEAR')) return 'info';
  return 'neutral';
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(key: string): string {
  const today = new Date();
  const tKey = dayKey(today.toISOString());
  const yest = new Date(today.getTime() - 86_400_000);
  const yKey = dayKey(yest.toISOString());
  if (key === tKey) return 'Today';
  if (key === yKey) return 'Yesterday';
  const [y, m, d] = key.split('-');
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  const sameYear = dt.getFullYear() === today.getFullYear();
  return sameYear
    ? `${DOW[dt.getDay()]}, ${MONTH[dt.getMonth()]} ${dt.getDate()}`
    : `${MONTH[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
}

function entityLabel(entity: string | null): string {
  if (!entity) return '';
  return entity.replace(/_/g, ' ');
}

export default function ActivityPage() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState<ActivityRow | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<RangeKey>('7d');
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const load = async () => {
    setLoading(true);
    setErr('');
    const p = new URLSearchParams();
    p.set('limit', '150');
    if (filter !== 'all') p.set('admin_filter', filter);
    const res = await fetch('/api/activity?' + p.toString());
    if (res.status === 403) { setErr('You do not have permission to view the activity log.'); setLoading(false); return; }
    const json = await res.json();
    if (!res.ok) { setErr(json?.error || 'Failed to load'); setLoading(false); return; }
    setRows(json.activity || []);
    setAdmins(json.admins || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter]);

  function buildExportQuery(format: 'csv' | 'json'): string {
    const p = new URLSearchParams();
    p.set('format', format);
    if (filter !== 'all') p.set('admin_filter', filter);
    const { from, to } = rangeBounds(exportRange);
    if (from) p.set('after', from.toISOString());
    if (to) p.set('before', to.toISOString());
    p.set('limit', '5000');
    return p.toString();
  }

  async function exportCsv() {
    setExporting('csv');
    try {
      const res = await fetch('/api/activity?' + buildExportQuery('csv'));
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.error || 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `admin-activity-${exportRange}-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    setExporting('pdf');
    try {
      const res = await fetch('/api/activity?' + buildExportQuery('json'));
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.error || 'Export failed');
        return;
      }
      const json = await res.json();
      const rows = (json.activity || []) as ActivityRow[];
      const html = buildPrintHtml(rows, rangeBounds(exportRange).label, filter, admins);
      const win = window.open('', '_blank', 'width=900,height=700');
      if (!win) { alert('Pop-up blocked — allow pop-ups to export PDF.'); return; }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => { win.print(); }, 300);
      setExportOpen(false);
    } finally {
      setExporting(null);
    }
  }

  const grouped = useMemo(() => {
    const out: Array<{ key: string; label: string; items: ActivityRow[] }> = [];
    const map = new Map<string, ActivityRow[]>();
    for (const r of rows) {
      const k = dayKey(r.created_at);
      const bucket = map.get(k) || [];
      bucket.push(r);
      map.set(k, bucket);
    }
    const keys = Array.from(map.keys()).sort().reverse();
    for (const k of keys) out.push({ key: k, label: dayLabel(k), items: map.get(k)! });
    return out;
  }, [rows]);

  return (
    <div>
      <PageHeader
        title="Admin Activity"
        subtitle="Audit log of every admin action across the platform."
      />

      <Card>
        <CardBody tight style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ minWidth: 260 }}>
            <Select value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value)}>
              <option value="all">All admins</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>@{a.username || 'unknown'}</option>
              ))}
            </Select>
          </div>
          <div style={{ flex: 1 }} />
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Download size={14} />}
            onClick={() => setExportOpen(true)}
          >
            Export
          </Button>
          <Button variant="secondary" size="sm" onClick={load}>Refresh</Button>
        </CardBody>
      </Card>

      {!!err && (
        <div style={{ marginTop: 16, color: 'var(--tone-danger-fg)', fontSize: 13, fontWeight: 600 }}>{err}</div>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Admin</Th>
                  <Th>Action</Th>
                  <Th>Target</Th>
                  <Th>When</Th>
                  <Th align="right">Detail</Th>
                </Tr>
              </THead>
              <TBody>
                {loading && rows.length === 0 ? (
                  <TableEmpty colSpan={5}>Loading…</TableEmpty>
                ) : grouped.length === 0 ? (
                  <TableEmpty colSpan={5}>No activity in this window.</TableEmpty>
                ) : grouped.map((g) => (
                  <ActivitySection
                    key={g.key}
                    label={g.label}
                    count={g.items.length}
                    items={g.items}
                    onOpen={setDetail}
                  />
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? actionLabel(detail.action) : ''}
        size="lg"
      >
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge tone={actionTone(detail.action)}>{actionLabel(detail.action)}</Badge>
              {detail.target_label && (
                <span style={{ color: 'var(--fg-primary)', fontWeight: 700, fontSize: 14 }}>· {detail.target_label}</span>
              )}
              {detail.target_username && (
                <span style={{ color: 'var(--fg-secondary)', fontSize: 13 }}>for @{detail.target_username}</span>
              )}
            </div>

            <DetailGrid
              title="WHO"
              rows={[
                ['Admin', `@${detail.admin_username || 'unknown'}`],
                ...(detail.admin_role_title ? [['Role', detail.admin_role_title] as [string, string]] : []),
                ['Super-admin', detail.admin_is_super ? 'Yes' : 'No'],
              ]}
            />

            <DetailGrid
              title="WHEN"
              rows={[
                ['Time', new Date(detail.created_at).toLocaleString()],
                ['Relative', timeAgo(detail.created_at)],
              ]}
            />

            <DetailGrid
              title="TARGET"
              rows={[
                ['Entity', entityLabel(detail.entity) || '—'],
                ...(detail.entity_id ? [['Entity ID', detail.entity_id, true] as [string, string, boolean]] : []),
                ...(detail.target_username ? [['User', `@${detail.target_username}`] as [string, string]] : []),
                ['IP address', detail.ip_address || '—', true],
              ]}
            />

            {(detail.before_value || detail.after_value) && (
              <div>
                <SectionLabel>CHANGES</SectionLabel>
                {detail.before_value && (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--fg-tertiary)', fontWeight: 700, letterSpacing: 0.8, marginBottom: 6 }}>BEFORE</div>
                    <JsonCard data={detail.before_value} />
                  </>
                )}
                {detail.after_value && (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--fg-tertiary)', fontWeight: 700, letterSpacing: 0.8, margin: '12px 0 6px' }}>AFTER</div>
                    <JsonCard data={detail.after_value} />
                  </>
                )}
              </div>
            )}

            <DetailGrid
              title="RAW"
              rows={[
                ['Audit ID', detail.id, true],
                ['Action key', detail.action, true],
              ]}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export activity"
        subtitle="Choose a time frame, then download CSV or print PDF."
        size="md"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--fg-tertiary)', letterSpacing: 1.2 }}>
              TIME FRAME
            </label>
            <Select
              value={exportRange}
              onChange={(e) => setExportRange((e.target as HTMLSelectElement).value as RangeKey)}
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="month">This month</option>
              <option value="all">All time</option>
            </Select>
            <span style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}>
              {filter === 'all'
                ? 'All admins'
                : `@${admins.find((a) => a.id === filter)?.username || 'unknown'}`}{' · '}
              up to 5,000 rows
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Button
              variant="primary"
              leftIcon={<Download size={14} />}
              onClick={exportCsv}
              loading={exporting === 'csv'}
              style={{ flex: 1 }}
            >
              Download CSV
            </Button>
            <Button
              variant="secondary"
              leftIcon={<Printer size={14} />}
              onClick={exportPdf}
              loading={exporting === 'pdf'}
              style={{ flex: 1 }}
            >
              Print / PDF
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function buildPrintHtml(rows: ActivityRow[], rangeLabel: string, filter: string, admins: AdminRow[]): string {
  const adminLabel = filter === 'all'
    ? 'All admins'
    : `@${admins.find((a) => a.id === filter)?.username || 'unknown'}`;
  const grouped: Array<{ label: string; items: ActivityRow[] }> = [];
  const map = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    const k = dayKey(r.created_at);
    const bucket = map.get(k) || [];
    bucket.push(r);
    map.set(k, bucket);
  }
  for (const k of Array.from(map.keys()).sort().reverse()) {
    grouped.push({ label: dayLabel(k), items: map.get(k)! });
  }
  const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const sections = grouped.map((g) => `
    <h2 class="day">${esc(g.label)} <span class="count">${g.items.length}</span></h2>
    <table>
      <thead>
        <tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>IP</th></tr>
      </thead>
      <tbody>
        ${g.items.map((r) => `
          <tr>
            <td>${esc(new Date(r.created_at).toLocaleTimeString())}</td>
            <td>@${esc(r.admin_username || 'unknown')}${r.admin_is_super ? ' <span class="super">SUPER</span>' : ''}</td>
            <td>${esc(actionLabel(r.action))}</td>
            <td>${esc(r.target_label || r.entity || '—')}${r.target_username ? ` · @${esc(r.target_username)}` : ''}</td>
            <td class="mono">${esc(r.ip_address || '—')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `).join('');
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>Admin Activity — ${esc(rangeLabel)}</title>
<style>
  body { font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif; color: #111; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 11px; margin-bottom: 18px; }
  h2.day { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #111; margin: 22px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .count { color: #888; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 6px 8px; vertical-align: top; border-bottom: 1px solid #eee; }
  th { color: #666; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; }
  .super { background: #F5B040; color: #fff; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: 800; margin-left: 4px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
  @media print { body { padding: 12px; } h2.day { break-after: avoid; } tr { break-inside: avoid; } }
</style>
</head><body>
<h1>Admin Activity</h1>
<div class="meta">${esc(rangeLabel)} · ${esc(adminLabel)} · ${rows.length} rows · generated ${esc(new Date().toLocaleString())}</div>
${sections || '<div style="color:#666;padding:32px;text-align:center;">No activity in this window.</div>'}
</body></html>`;
}

function ActivitySection({
  label, count, items, onOpen,
}: { label: string; count: number; items: ActivityRow[]; onOpen: (r: ActivityRow) => void }) {
  return (
    <>
      <Tr>
        <Td colSpan={5} style={{ background: 'var(--bg-subtle)', padding: '8px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--fg-primary)' }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-tertiary)' }}>{count}</span>
          </div>
        </Td>
      </Tr>
      {items.map((r) => (
        <Tr key={r.id}>
          <Td emphasis="primary">
            @{r.admin_username || 'unknown'}
            {r.admin_is_super && <Badge tone="warning" size="sm" style={{ marginLeft: 6 }}>SUPER</Badge>}
          </Td>
          <Td>
            <Badge tone={actionTone(r.action)}>{actionLabel(r.action)}</Badge>
          </Td>
          <Td emphasis="secondary">
            {r.target_label || (r.entity ? entityLabel(r.entity) : '—')}
            {r.target_username && <span style={{ color: 'var(--fg-tertiary)', marginLeft: 6 }}>· @{r.target_username}</span>}
          </Td>
          <Td emphasis="secondary">{timeAgo(r.created_at)}</Td>
          <Td align="right">
            <Button variant="ghost" size="sm" onClick={() => onOpen(r)}>View</Button>
          </Td>
        </Tr>
      ))}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--fg-secondary)', letterSpacing: 1.2, marginBottom: 8 }}>
      {children}
    </div>
  );
}

function DetailGrid({ title, rows }: { title: string; rows: Array<[string, string] | [string, string, boolean]> }) {
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <Card>
        <CardBody flush>
          {rows.map(([label, value, mono], i) => (
            <div
              key={label + i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
                padding: '11px 14px',
                borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border-subtle)',
              }}
            >
              <span style={{ color: 'var(--fg-tertiary)', fontSize: 13, fontWeight: 600 }}>{label}</span>
              <span
                style={{
                  color: 'var(--fg-primary)', fontSize: mono ? 11 : 13, fontWeight: 700,
                  fontFamily: mono ? 'var(--font-mono, monospace)' : undefined,
                  textAlign: 'right', flex: 1, wordBreak: 'break-all',
                }}
              >{value}</span>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function JsonCard({ data }: { data: any }) {
  return (
    <pre style={{
      background: 'var(--bg-subtle)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 10,
      padding: 12,
      fontSize: 11,
      lineHeight: 1.5,
      fontFamily: 'var(--font-mono, monospace)',
      color: 'var(--fg-primary)',
      overflow: 'auto',
      maxHeight: 280,
    }}>{JSON.stringify(data, null, 2)}</pre>
  );
}
