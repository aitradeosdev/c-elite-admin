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

export type RangeKey = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'month';

export function rangeToDates(key: RangeKey): { from: string | null; to: string | null; label: string } {
  const now = new Date();
  const dayMs = 86_400_000;
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (key === 'today') return { from: ymd(now), to: ymd(now), label: 'Today' };
  if (key === 'yesterday') {
    const y = new Date(now.getTime() - dayMs);
    return { from: ymd(y), to: ymd(y), label: 'Yesterday' };
  }
  if (key === '7d') return { from: ymd(new Date(now.getTime() - 6 * dayMs)), to: ymd(now), label: 'Last 7 days' };
  if (key === '30d') return { from: ymd(new Date(now.getTime() - 29 * dayMs)), to: ymd(now), label: 'Last 30 days' };
  if (key === 'month') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now), label: 'This month' };
  return { from: null, to: null, label: 'All time' };
}
