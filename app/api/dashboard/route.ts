import type { NextRequest } from 'next/server';
import { requireAdmin } from '../../lib/guard';
import { ok, fail } from '../../lib/api';
import { getDashboardData } from '../../lib/dashboard';

const RECENT_ERROR = 'Recent submissions could not be loaded.';
const PREVIOUS_ERROR = 'Comparison figures could not be calculated.';

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const days = Number(url.searchParams.get('days') || '1');
  const compare = url.searchParams.get('compare') === '1';

  const data = await getDashboardData(guard.admin.permissions, { days, compare });

  if (data.metrics_error && data.groups.length > 0) {
    return fail('INTERNAL_ERROR', 'Dashboard metrics could not be calculated.', {
      details: { range: data.range },
    });
  }

  return ok({
    stats: data.stats,
    previous: data.previous,
    previous_error: data.previous_error ? PREVIOUS_ERROR : null,
    groups: data.groups,
    range: data.range,
    generated_at: data.generated_at,
    recent_submissions: data.recent_submissions,
    recent_submissions_error: data.recent_submissions_error ? RECENT_ERROR : null,
  });
}
