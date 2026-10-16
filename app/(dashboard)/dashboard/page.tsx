import { LayoutDashboard } from 'lucide-react';
import { verifyAdminFromRequest } from '../../lib/jwt';
import { resolveAdminPermissions } from '../../lib/permissions';
import { getDashboardData, type RecentSubmission } from '../../lib/dashboard';
import { realtimeTopicKeys } from '../../lib/realtimePass';
import { BUSINESS_TZ_LABEL, formatAge, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import { Card, EmptyState, PageHeader, StatStrip } from '../../_ui';
import AutoRefresh from './AutoRefresh';
import { ActionTiles, Band, OpenQueueLink } from './DashboardBands';
import { RecentSubmissions, type RecentRow } from './RecentSubmissions';
import { RefreshButton, RetryState } from './Refresh';
import {
  REFRESH_INTERVAL_MS, STRIP_BANDS, buildActionTiles, buildStripCells, overviewSubtitle,
} from './metrics';
import s from './page.module.css';

const REFRESH_SECONDS = REFRESH_INTERVAL_MS / 1000;
const RECENT_ERROR = `The latest card submissions could not be fetched. The overview retries on its own every ${REFRESH_SECONDS} seconds.`;

function toRecentRow(row: RecentSubmission, now: Date): RecentRow {
  return {
    id: row.id,
    href: `/card-queue?id=${encodeURIComponent(row.id)}`,
    user: row.users?.username ? `@${row.users.username}` : 'Unknown user',
    card: row.cards?.name || 'Unknown card',
    country: row.country_name || null,
    payout: row.payout_naira,
    status: row.status,
    submittedAt: formatBusinessDateTime(row.created_at),
    age: formatAge(row.created_at, now),
  };
}

export default async function DashboardPage() {
  const admin = await verifyAdminFromRequest();
  const permissions = resolveAdminPermissions(admin);
  const data = await getDashboardData(permissions);

  const now = new Date(data.generated_at);
  const failed = Boolean(data.metrics_error);
  const actionTiles = buildActionTiles(data.stats, permissions, failed, now);
  const strips = STRIP_BANDS
    .map((band) => ({ band, cells: buildStripCells(band.metrics, data.stats, permissions, failed) }))
    .filter((entry) => entry.cells.length > 0);
  const canSeeCards = permissions.has('cards.read');
  const hasMetrics = actionTiles.length > 0 || strips.length > 0;
  const topics = realtimeTopicKeys((permission) => permissions.has(permission));

  return (
    <div className={s.page}>
      <AutoRefresh intervalMs={REFRESH_INTERVAL_MS} topics={topics} generatedAt={data.generated_at} />

      <PageHeader
        title="Overview"
        subtitle={overviewSubtitle(data.range.from)}
        actions={
          <>
            <span className={s.updated} title={`Refreshes automatically every ${REFRESH_SECONDS} seconds`}>
              Updated {formatBusinessTime(now)} {BUSINESS_TZ_LABEL}
            </span>
            <RefreshButton />
          </>
        }
      />

      <div className={s.bands}>
        {failed && hasMetrics ? (
          <Card>
            <RetryState
              title="Metrics could not be calculated"
              message={`Every figure below shows as unavailable rather than zero. The overview also retries on its own every ${REFRESH_SECONDS} seconds.`}
              stillFailing="Metrics are still unavailable. The overview will keep retrying."
            />
          </Card>
        ) : null}

        {actionTiles.length > 0 ? (
          <Band id="overview-action" label="Needs action">
            <ActionTiles tiles={actionTiles} />
          </Band>
        ) : null}

        {strips.map(({ band, cells }) => (
          <Band key={band.id} id={`overview-${band.id}`} label={band.label}>
            <StatStrip fill flush items={cells} />
          </Band>
        ))}

        {!hasMetrics && !canSeeCards ? (
          <EmptyState
            icon={<LayoutDashboard size={20} strokeWidth={1.75} />}
            title="Nothing to show on your overview"
            hint="Your account holds no permissions with overview figures. Use the side navigation to open the pages you manage."
          />
        ) : null}

        {canSeeCards ? (
          <Band id="overview-recent" label="Recent submissions" aside={<OpenQueueLink />}>
            <RecentSubmissions
              rows={data.recent_submissions.map((row) => toRecentRow(row, now))}
              error={data.recent_submissions_error ? RECENT_ERROR : null}
            />
          </Band>
        ) : null}
      </div>
    </div>
  );
}
