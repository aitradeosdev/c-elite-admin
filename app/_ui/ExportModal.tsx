'use client';

import { useId, type ReactNode } from 'react';
import { CalendarRange, Download, LoaderCircle, Printer, Rows3, ShieldAlert } from 'lucide-react';
import { Modal } from './Overlay';
import { FieldShell, Select } from './Field';
import { Button } from './Button';
import { EXPORT_RANGE_OPTIONS } from '../lib/time';
import {
  FILTERS_RANGE_LABEL, describeExportWindow, nextExportRange, parseExportRange, resolveExportRange,
  type ExportRangeValue, type RangeKey,
} from '../lib/printExport';
import s from './ExportModal.module.css';

export type { ExportRangeValue } from '../lib/printExport';

export type ExportFormat = 'csv' | 'pdf';

export interface ExportFiltersOption {
  label: string;
  description?: ReactNode;
  from?: string | null;
  to?: string | null;
}

interface ExportModalBaseProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  metaLine?: ReactNode;
  rowLimitNote?: ReactNode;
  sensitiveNote?: ReactNode;
  exporting: ExportFormat | null;
  onCsv: () => void;
  onPdf: () => void;
}

export interface ExportModalPresetProps extends ExportModalBaseProps {
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
  filtersOption?: undefined;
}

export interface ExportModalFiltersProps extends ExportModalBaseProps {
  range: ExportRangeValue;
  onRangeChange: (range: ExportRangeValue) => void;
  filtersOption?: ExportFiltersOption;
}

export type ExportModalProps = ExportModalPresetProps | ExportModalFiltersProps;

const PENDING: Readonly<Record<ExportFormat, string>> = {
  csv: 'Preparing the CSV download.',
  pdf: 'Preparing the print view.',
};

export function ExportModal(props: ExportModalProps) {
  const {
    open, onClose, title, subtitle, range, filtersOption, metaLine, rowLimitNote, sensitiveNote, exporting, onCsv, onPdf,
  } = props;
  const baseId = useId();
  const limitId = `${baseId}-limit`;
  const sensitiveId = `${baseId}-sensitive`;
  const busy = exporting !== null;
  const selected = parseExportRange(range) ?? 'all';
  const offerFilters = filtersOption !== undefined || selected === 'filters';
  const notesId = [rowLimitNote ? limitId : null, sensitiveNote ? sensitiveId : null].filter(Boolean).join(' ') || undefined;
  const windowText = open ? describeExportWindow(resolveExportRange(selected, filtersOption)) : '';

  const choose = (raw: string) => {
    const next = nextExportRange(raw, selected, props.filtersOption !== undefined, busy);
    if (next === null) return;
    if (next !== 'filters') props.onRangeChange(next);
    else if (props.filtersOption !== undefined) props.onRangeChange(next);
  };

  const help = (
    <div className={s.selection}>
      {selected === 'filters' && filtersOption?.description ? (
        <div className={s.description}>{filtersOption.description}</div>
      ) : null}
      <div className={s.window}>
        <span className={s.glyph}><CalendarRange size={14} aria-hidden /></span>
        <span>{windowText}</span>
      </div>
    </div>
  );

  const footer = (
    <div className={s.footer}>
      <span className={s.srOnly} role="status">{exporting ? PENDING[exporting] : ''}</span>
      <Button
        type="button"
        variant="secondary"
        leftIcon={exporting === 'pdf'
          ? <LoaderCircle size={14} aria-hidden className={s.spinner} />
          : <Printer size={14} aria-hidden />}
        aria-disabled={busy || undefined}
        aria-busy={exporting === 'pdf' || undefined}
        aria-describedby={notesId}
        onClick={busy ? undefined : onPdf}
      >
        Print / PDF
      </Button>
      <Button
        type="button"
        variant="primary"
        leftIcon={exporting === 'csv'
          ? <LoaderCircle size={14} aria-hidden className={s.spinner} />
          : <Download size={14} aria-hidden />}
        aria-disabled={busy || undefined}
        aria-busy={exporting === 'csv' || undefined}
        aria-describedby={notesId}
        onClick={busy ? undefined : onCsv}
      >
        Download CSV
      </Button>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} size="md" footer={footer}>
      <div className={s.content}>
        <FieldShell label="Time frame" help={help}>
          <Select value={selected} disabled={busy} onChange={(event) => choose(event.currentTarget.value)}>
            {offerFilters ? <option value="filters">{filtersOption?.label || FILTERS_RANGE_LABEL}</option> : null}
            {EXPORT_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </FieldShell>
        {metaLine ? <div className={s.meta}>{metaLine}</div> : null}
        {rowLimitNote || sensitiveNote ? (
          <div className={s.notes}>
            {rowLimitNote ? (
              <div id={limitId} className={s.note}>
                <span className={s.glyph}><Rows3 size={14} aria-hidden /></span>
                <div className={s.noteText}>{rowLimitNote}</div>
              </div>
            ) : null}
            {sensitiveNote ? (
              <div id={sensitiveId} className={[s.note, s.sensitive].filter(Boolean).join(' ')}>
                <span className={s.glyph}><ShieldAlert size={14} aria-hidden /></span>
                <div className={s.noteText}>{sensitiveNote}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
