import { RotateCw } from 'lucide-react';
import { businessToday } from '../../lib/time';
import { Button, PageHeader, Skeleton, StatStrip } from '../../_ui';
import { ActionTiles, Band, OpenQueueLink } from './DashboardBands';
import { RecentSubmissions } from './RecentSubmissions';
import {
  STRIP_BANDS, overviewSubtitle, placeholderActionTiles, placeholderStripCells,
} from './metrics';
import s from './page.module.css';

export default function DashboardLoading() {
  return (
    <div className={s.page}>
      <span className={s.srOnly} role="status">Loading the overview</span>

      <PageHeader
        title="Overview"
        subtitle={overviewSubtitle(businessToday().from)}
        actions={
          <>
            <Skeleton width={112} height={12} />
            <Button variant="secondary" size="sm" leftIcon={<RotateCw size={14} />} disabled>
              Refresh
            </Button>
          </>
        }
      />

      <div className={s.bands}>
        <Band id="overview-loading-action" label="Needs action">
          <ActionTiles tiles={placeholderActionTiles()} />
        </Band>

        {STRIP_BANDS.map((band) => (
          <Band key={band.id} id={`overview-loading-${band.id}`} label={band.label}>
            <StatStrip fill flush items={placeholderStripCells(band.metrics)} />
          </Band>
        ))}

        <Band id="overview-loading-recent" label="Recent submissions" aside={<OpenQueueLink />}>
          <RecentSubmissions rows={[]} error={null} loading />
        </Band>
      </div>
    </div>
  );
}
