'use client';

import { Download, Printer } from 'lucide-react';
import { Modal } from './Overlay';
import { Select } from './Field';
import { Button } from './Button';
import type { RangeKey } from '../lib/printExport';

export function ExportModal({
  open, onClose, title, subtitle, range, onRangeChange, metaLine, exporting, onCsv, onPdf,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  metaLine?: string;
  exporting: 'csv' | 'pdf' | null;
  onCsv: () => void;
  onPdf: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--fg-tertiary)', letterSpacing: 1.2 }}>
            TIME FRAME
          </label>
          <Select value={range} onChange={(e) => onRangeChange((e.target as HTMLSelectElement).value as RangeKey)}>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </Select>
          {metaLine ? <span style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}>{metaLine}</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <Button variant="primary" leftIcon={<Download size={14} />} onClick={onCsv} loading={exporting === 'csv'} style={{ flex: 1 }}>
            Download CSV
          </Button>
          <Button variant="secondary" leftIcon={<Printer size={14} />} onClick={onPdf} loading={exporting === 'pdf'} style={{ flex: 1 }}>
            Print / PDF
          </Button>
        </div>
      </div>
    </Modal>
  );
}
