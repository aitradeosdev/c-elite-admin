export function sanitizeSearch(raw: string, maxLen = 64): string {
  return raw
    .replace(/[^a-zA-Z0-9 @._+\-]/g, '')
    .replace(/\.+/g, '.')
    .trim()
    .slice(0, maxLen);
}

export function clampPagination(page: string | null, limit: string | null, maxLimit = 100) {
  const p = Math.max(1, parseInt(page || '1') || 1);
  const l = Math.min(maxLimit, Math.max(1, parseInt(limit || '25') || 25));
  return { page: p, limit: l, offset: (p - 1) * l };
}

export function asUuid(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : null;
}
