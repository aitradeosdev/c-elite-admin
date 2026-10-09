import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Kpi, KpiGrid, SectionLabel, Skeleton } from '../../_ui';
import { VALUE_SKELETON_WIDTH, type ActionTileView } from './metrics';
import s from './page.module.css';

const HINT_SKELETON_WIDTH = '9em';

export interface BandProps {
  id: string;
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}

export function Band({ id, label, aside, children }: BandProps) {
  return (
    <section className={s.band} aria-labelledby={id}>
      <div className={s.bandHead}>
        <SectionLabel as="h2" id={id} flush>{label}</SectionLabel>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function OpenQueueLink() {
  return (
    <Link href="/card-queue" className={s.bandLink}>
      Open queue
      <ArrowRight size={14} aria-hidden />
    </Link>
  );
}

function tileHint(tile: ActionTileView): ReactNode {
  if (tile.state === 'loading') return <Skeleton inline width={HINT_SKELETON_WIDTH} />;
  if (tile.age) {
    return (
      <>
        Oldest waiting <span className={s.age}>{tile.age}</span>
      </>
    );
  }
  return tile.hint;
}

export function ActionTiles({ tiles }: { tiles: readonly ActionTileView[] }) {
  return (
    <KpiGrid className={s.actionGrid}>
      {tiles.map((tile) => (
        <Kpi
          key={tile.key}
          icon={tile.icon}
          label={tile.label}
          href={tile.state === 'ready' ? tile.href : undefined}
          unavailable={tile.state === 'unavailable'}
          value={tile.state === 'loading' ? <Skeleton inline width={VALUE_SKELETON_WIDTH[tile.format]} /> : tile.value}
          hint={tileHint(tile)}
          tone={tile.attention ? 'warning' : 'neutral'}
          hintTone={tile.attention ? 'warning' : 'neutral'}
        />
      ))}
    </KpiGrid>
  );
}
