const NAIRA = '₦';

const NAIRA_FORMAT = new Intl.NumberFormat('en-NG', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatNaira(n: number | string | null | undefined): string {
  const value = Number(n || 0);
  if (!Number.isFinite(value)) return '—';
  const text = NAIRA_FORMAT.format(value);
  return NAIRA + (/^-0(?:\.0+)?$/.test(text) ? text.slice(1) : text);
}
