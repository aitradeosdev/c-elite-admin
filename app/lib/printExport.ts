import {
  BUSINESS_TZ_LABEL, exportRangeDates, formatLagosDateRange, isExportRangeKey,
  type ExportRangeDates, type ExportRangeKey,
} from './time';

type Cell = string | number | null | undefined;

export function printTable(opts: {
  title: string;
  meta: string;
  columns: string[];
  rows: Cell[][];
}): boolean {
  const esc = (s: Cell) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const thead = opts.columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const tbody = opts.rows.length
    ? opts.rows
        .map((r) => `<tr>${opts.columns.map((_, i) => `<td>${esc(r[i])}</td>`).join('')}</tr>`)
        .join('')
    : `<tr><td colspan="${opts.columns.length}" style="text-align:center;color:#666;padding:32px;">No rows in this window.</td></tr>`;
  const html = `<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>${esc(opts.title)}</title>
<style>
  body { font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif; color: #111; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 11px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 6px 8px; vertical-align: top; border-bottom: 1px solid #eee; word-break: break-word; }
  th { color: #666; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; }
  @media print { body { padding: 12px; } tr { break-inside: avoid; } }
</style>
</head><body>
<h1>${esc(opts.title)}</h1>
<div class="meta">${esc(opts.meta)}</div>
<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
</body></html>`;
  const win = window.open('', '_blank', 'width=1000,height=720');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
  return true;
}

export type RangeKey = ExportRangeKey;

export type ExportRangeValue = RangeKey | 'filters';

export interface ExportFilterWindow {
  from?: string | null;
  to?: string | null;
  label?: string;
}

export const FILTERS_RANGE_LABEL = 'Current filters';

export const NO_DATE_LIMIT = 'No date limit';

export function rangeToDates(key: RangeKey, now?: Date): ExportRangeDates {
  return exportRangeDates(key, now);
}

export function parseExportRange(value: unknown, allowFilters = true): ExportRangeValue | null {
  if (value === 'filters') return allowFilters ? 'filters' : null;
  return isExportRangeKey(value) ? value : null;
}

export function nextExportRange(
  raw: unknown,
  current: ExportRangeValue,
  allowFilters = true,
  busy = false,
): ExportRangeValue | null {
  if (busy) return null;
  const next = parseExportRange(raw, allowFilters);
  return next === null || next === current ? null : next;
}

export function resolveExportRange(
  value: ExportRangeValue,
  filters?: ExportFilterWindow | null,
  now?: Date,
): ExportRangeDates {
  if (value !== 'filters') return exportRangeDates(value, now);
  return {
    from: filters?.from ?? null,
    to: filters?.to ?? null,
    label: filters?.label || FILTERS_RANGE_LABEL,
  };
}

export function describeExportWindow(range: { from?: string | null; to?: string | null }): string {
  const dates = formatLagosDateRange(range.from, range.to);
  return dates ? `${dates} (${BUSINESS_TZ_LABEL})` : NO_DATE_LIMIT;
}
