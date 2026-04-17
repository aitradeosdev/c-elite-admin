export function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()\\]/g, '').replace(/\.\w+\./g, ' ').trim();
}

export function clampPagination(page: string | null, limit: string | null, maxLimit = 100) {
  const p = Math.max(1, parseInt(page || '1') || 1);
  const l = Math.min(maxLimit, Math.max(1, parseInt(limit || '25') || 25));
  return { page: p, limit: l, offset: (p - 1) * l };
}
