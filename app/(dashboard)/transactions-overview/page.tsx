'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Download, ChevronLeft, ChevronRight, Filter, X } from 'lucide-react';
import {
  PageHeader, Card, CardBody, Badge, Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, Select, Kpi, KpiGrid, ExportModal,
} from '../../_ui';
import { printTable, rangeToDates, type RangeKey } from '../../lib/printExport';

function formatNaira(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'purple' | 'neutral' {
  switch (status) {
    case 'success':
    case 'completed': return 'success';
    case 'pending':
    case 'processing':
    case 'pending_review': return 'warning';
    case 'failed': return 'danger';
    case 'refunded': return 'purple';
    default: return 'neutral';
  }
}

const TYPE_GROUPS: { label: string; key: string; values: string[] }[] = [
  { label: 'Giftcards', key: 'giftcards', values: ['giftcard_credit'] },
  { label: 'Withdrawals', key: 'withdrawals', values: ['withdrawal', 'withdrawal_refund'] },
  { label: 'Transfers', key: 'transfers', values: ['transfer_tag', 'transfer_received', 'transfer_refund', 'transfer_bank'] },
  { label: 'Bills', key: 'bills', values: ['airtime', 'data', 'cable', 'electricity'] },
  { label: 'Bonuses', key: 'bonuses', values: ['signup_bonus', 'giftbox_bonus', 'referral_bonus', 'bonus_redeem', 'level_bonus'] },
];
const STATUS_OPTIONS = ['', 'pending', 'pending_review', 'success', 'failed'];

export default function TransactionsOverviewPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState({ totalCount: 0, totalAmount: 0, todayCount: 0, todayAmount: 0 });
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<RangeKey>('7d');
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const limit = 25;

  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const [applied, setApplied] = useState({ type: '', status: '', dateFrom: '', dateTo: '', search: '' });

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (applied.type) params.set('type', applied.type);
    if (applied.status) params.set('status', applied.status);
    if (applied.dateFrom) params.set('date_from', applied.dateFrom);
    if (applied.dateTo) params.set('date_to', applied.dateTo);
    if (applied.search) params.set('search', applied.search);
    params.set('page', String(page));
    params.set('limit', String(limit));
    return params;
  }, [applied, page]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/transactions?' + buildParams().toString());
    const json = await res.json();
    setRows(json.transactions || []);
    setTotal(json.total || 0);
    setStats(json.stats || { totalCount: 0, totalAmount: 0, todayCount: 0, todayAmount: 0 });
    setLoading(false);
  }, [buildParams]);

  useEffect(() => { load(); }, [load]);

  const applyFilters = () => {
    setApplied({ type, status, dateFrom, dateTo, search });
    setPage(1);
  };

  const clearFilters = () => {
    setType('');
    setStatus('');
    setDateFrom('');
    setDateTo('');
    setSearch('');
    setApplied({ type: '', status: '', dateFrom: '', dateTo: '', search: '' });
    setPage(1);
  };

  const totalPages = Math.ceil(total / limit);

  const exportCSV = async () => {
    setExporting('csv');
    try {
      const params = buildParams();
      params.set('csv', '1');
      params.delete('page');
      params.delete('limit');
      const { from, to } = rangeToDates(exportRange);
      if (from) params.set('date_from', from);
      if (to) params.set('date_to', to);
      const res = await fetch('/api/transactions?' + params.toString());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    setExporting('pdf');
    try {
      const params = buildParams();
      params.set('pdf', '1');
      params.delete('page');
      params.delete('limit');
      const { from, to, label } = rangeToDates(exportRange);
      if (from) params.set('date_from', from);
      if (to) params.set('date_to', to);
      const res = await fetch('/api/transactions?' + params.toString());
      const json = await res.json();
      const rows = json.rows || [];
      const ok = printTable({
        title: 'Transactions',
        meta: `${label} · ${rows.length} rows · generated ${new Date().toLocaleString()}`,
        columns: ['ID', 'User', 'Email', 'Type', 'Amount', 'Status', 'Reference', 'Date'],
        rows: rows.map((r: any) => [
          r.ID, r.User, r.Email, r.Type, r.Amount, r.Status, r.Reference, r.Date,
        ]),
      });
      if (!ok) alert('Pop-up blocked — allow pop-ups to export PDF.');
      else setExportOpen(false);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle="Full audit-log view of every money movement on the platform."
        actions={
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Download size={14} />}
            onClick={() => setExportOpen(true)}
          >
            Export
          </Button>
        }
      />

      <KpiGrid style={{ marginBottom: 'var(--space-6)' }}>
        <Kpi label="Total transactions" value={stats.totalCount.toLocaleString()} />
        <Kpi label="Total volume" value={formatNaira(stats.totalAmount)} />
        <Kpi label="Today transactions" value={stats.todayCount.toLocaleString()} />
        <Kpi label="Today volume" value={formatNaira(stats.todayAmount)} />
      </KpiGrid>

      <Card>
        <CardBody tight>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input
              placeholder="Search user"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 200, maxWidth: 240 }}
            />
            <Select value={type} onChange={(e) => setType(e.target.value)} style={{ minWidth: 160 }}>
              <option value="">All types</option>
              {TYPE_GROUPS.map((g) => (
                <option key={g.key} value={g.values.join(',')}>{g.label}</option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ minWidth: 160 }}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.filter(Boolean).map((st) => (
                <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>
              ))}
            </Select>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ minWidth: 150 }} />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ minWidth: 150 }} />
            <Button variant="primary" size="sm" leftIcon={<Filter size={14} />} onClick={applyFilters}>Apply</Button>
            <Button variant="ghost" size="sm" leftIcon={<X size={14} />} onClick={clearFilters}>Clear</Button>
          </div>
        </CardBody>
      </Card>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>User</Th>
                  <Th>Type</Th>
                  <Th align="right">Amount</Th>
                  <Th>Status</Th>
                  <Th>Reference</Th>
                  <Th>Date</Th>
                </Tr>
              </THead>
              <TBody>
                {loading ? (
                  <TableEmpty colSpan={6}>Loading…</TableEmpty>
                ) : rows.length === 0 ? (
                  <TableEmpty colSpan={6}>No transactions found</TableEmpty>
                ) : rows.map((t: any) => (
                  <Tr key={t.id}>
                    <Td emphasis="primary">
                      {t.users?.username ? (
                        <Link href={`/users/${t.user_id}`} style={{ color: 'var(--fg-link)' }}>
                          @{t.users.username}
                        </Link>
                      ) : '—'}
                    </Td>
                    <Td>
                      <Badge tone="purple" size="sm">{(t.type || '-').replace(/_/g, ' ')}</Badge>
                    </Td>
                    <Td align="right" mono emphasis="primary">{formatNaira(t.amount)}</Td>
                    <Td><Badge tone={statusTone(t.status)}>{(t.status || '-').replace(/_/g, ' ')}</Badge></Td>
                    <Td emphasis="muted" mono style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.reference_id || '—'}
                    </Td>
                    <Td emphasis="secondary">{new Date(t.created_at).toLocaleString()}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }}>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ChevronLeft size={14} />}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>
            Page {page} of {totalPages} ({total.toLocaleString()} results)
          </span>
          <Button
            variant="secondary"
            size="sm"
            rightIcon={<ChevronRight size={14} />}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Transactions"
        subtitle="Choose a time frame, then download CSV or print PDF."
        range={exportRange}
        onRangeChange={setExportRange}
        metaLine="up to 50,000 rows"
        exporting={exporting}
        onCsv={exportCSV}
        onPdf={exportPdf}
      />
    </div>
  );
}
