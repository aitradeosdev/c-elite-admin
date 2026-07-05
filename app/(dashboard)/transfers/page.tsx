'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import {
  PageHeader, Card, CardBody, Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, Select, ExportModal,
} from '../../_ui';
import { printTable, rangeToDates } from '../../lib/printExport';
import type { RangeKey } from '../../lib/printExport';
import { useIsMobile } from '../../lib/useIsMobile';
import { formatNaira, StatusDot, StatStrip } from '../_shared/statusUi';

function TypeTag({ type }: { type: string }) {
  const isTag = type === 'tag';
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500,
      color: isTag ? 'var(--tone-info-fg)' : 'var(--tone-purple-fg)',
      background: isTag ? 'var(--tone-info-bg)' : 'var(--tone-purple-bg)',
      border: `1px solid ${isTag ? 'var(--tone-info-border)' : 'var(--tone-purple-border)'}`,
      padding: '2px 7px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
    }}>{isTag ? 'tag' : 'bank'}</span>
  );
}

function senderOf(t: any) { return t.sender?.username || t.sender?.full_name || '-'; }
function recipientOf(t: any) {
  return t.type === 'tag'
    ? (t.recipient?.username || t.recipient?.full_name || '-')
    : (t.recipient_account_name || '-');
}

function TransfersMobile({ rows, loading }: { rows: any[]; loading: boolean }) {
  if (loading && rows.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3].map((k) => (
          <div key={k} style={{ height: 84, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', opacity: 0.5 }} />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>
        No transfers found
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((t: any) => (
        <div key={t.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xl)', fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {formatNaira(t.amount)}
            </div>
            <StatusDot status={t.status} />
          </div>
          <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, marginTop: 4, color: 'var(--fg-primary)' }}>
            @{senderOf(t)} <span style={{ color: 'var(--fg-tertiary)' }}>→</span> {recipientOf(t)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <TypeTag type={t.type} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
              fee {formatNaira(t.fee || 0)} · {new Date(t.created_at).toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TransfersPage() {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<RangeKey>('7d');
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const limit = 25;

  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (search) params.set('search', search);
    params.set('page', String(page));
    params.set('limit', String(limit));
    return params;
  }, [type, status, dateFrom, dateTo, search, page]);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/transfers?' + buildParams().toString());
    const json = await res.json();
    setRows(json.transfers || []);
    setTotal(json.total || 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [page]);

  const applyFilters = () => { setPage(1); load(); };

  const clearFilters = () => {
    setType('');
    setStatus('');
    setDateFrom('');
    setDateTo('');
    setSearch('');
    setPage(1);
    setTimeout(() => load(), 0);
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
      const res = await fetch('/api/transfers?' + params.toString());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transfers-${Date.now()}.csv`;
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
      const res = await fetch('/api/transfers?' + params.toString());
      const json = await res.json();
      const rows = json.rows || [];
      const ok = printTable({
        title: 'Transfers',
        meta: label + ' · ' + rows.length + ' rows · generated ' + new Date().toLocaleString(),
        columns: ['ID', 'Type', 'Sender', 'Recipient', 'Bank', 'Account', 'Amount', 'Fee', 'Status', 'Date'],
        rows: rows.map((r: any) => [
          r.ID, r.Type, r.Sender, r.Recipient, r.Bank, r.Account, r.Amount, r.Fee, r.Status, r.Date,
        ]),
      });
      if (!ok) alert('Pop-up blocked — allow pop-ups to export PDF.');
      else setExportOpen(false);
    } finally {
      setExporting(null);
    }
  };

  const sumInView = rows.reduce((a, r) => a + Number(r?.amount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Transfers"
        subtitle="Peer-to-peer tag and bank transfers across the platform."
        actions={
          <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={() => setExportOpen(true)}>
            Export
          </Button>
        }
      />

      <StatStrip items={[
        { label: 'In view', value: rows.length.toLocaleString() },
        { label: 'Amount in view', value: formatNaira(sumInView), mono: true },
        { label: 'Total transfers', value: total.toLocaleString() },
      ]} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <Input placeholder="Search sender or recipient" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <Select value={type} onChange={(e) => setType(e.target.value)} style={{ minWidth: 130 }}>
          <option value="">All types</option>
          <option value="tag">Tag transfer</option>
          <option value="bank">Bank transfer</option>
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ minWidth: 130 }}>
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ minWidth: 140 }} />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ minWidth: 140 }} />
        <Button variant="primary" size="sm" onClick={applyFilters}>Apply</Button>
        <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
      </div>

      {isMobile ? (
        <TransfersMobile rows={rows} loading={loading} />
      ) : (
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Type</Th>
                  <Th>Sender</Th>
                  <Th>Recipient</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Fee</Th>
                  <Th>Status</Th>
                  <Th>Date</Th>
                </Tr>
              </THead>
              <TBody>
                {loading ? (
                  <TableEmpty colSpan={7}>Loading…</TableEmpty>
                ) : rows.length === 0 ? (
                  <TableEmpty colSpan={7}>No transfers found</TableEmpty>
                ) : rows.map((t: any) => {
                  const recipientDetail = t.type === 'bank'
                    ? `${t.recipient_bank_name || ''} · ${t.recipient_account_number || ''}`
                    : '';
                  return (
                    <Tr key={t.id}>
                      <Td><TypeTag type={t.type} /></Td>
                      <Td emphasis="primary">
                        <a href={`/users/${t.sender_id}`} style={{ color: 'var(--fg-link)', textDecoration: 'none' }}>@{senderOf(t)}</a>
                      </Td>
                      <Td>
                        <div>{recipientOf(t)}</div>
                        {recipientDetail && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{recipientDetail}</div>
                        )}
                      </Td>
                      <Td align="right" mono emphasis="primary">{formatNaira(t.amount)}</Td>
                      <Td align="right" mono emphasis="secondary">{formatNaira(t.fee || 0)}</Td>
                      <Td><StatusDot status={t.status} /></Td>
                      <Td emphasis="secondary" mono>{new Date(t.created_at).toLocaleString()}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 'var(--space-4)' }}>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', letterSpacing: '0.03em' }}>
            PAGE {page} / {totalPages} · {total.toLocaleString()} RESULTS
          </span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
        </div>
      )}

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Transfers"
        subtitle="Choose a time frame, then download CSV or print PDF."
        metaLine="up to 50,000 rows"
        range={exportRange}
        onRangeChange={setExportRange}
        exporting={exporting}
        onCsv={exportCSV}
        onPdf={exportPdf}
      />
    </div>
  );
}
