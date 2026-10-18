import { Badge } from '../../_ui';
import type { Impact } from '../../lib/roles';
import { adminHandle } from '../admin-accounts/model';
import { GrantDiff } from './GrantParts';
import s from './access.module.css';

export interface ImpactListProps {
  impact: Pick<Impact, 'affected' | 'unchanged'>;
}

export function ImpactList({ impact }: ImpactListProps) {
  const { affected, unchanged } = impact;
  if (affected.length === 0 && unchanged.length === 0) return null;

  return (
    <div className={s.diff}>
      {affected.length ? (
        <section className={s.diffSection}>
          <h3 className={s.diffTitle}>Affected · {affected.length}</h3>
          <ul className={s.impactList} aria-label="Affected admins">
            {affected.map((admin) => (
              <li key={admin.admin_id} className={s.impactItem}>
                <span className={s.impactName}>
                  {adminHandle(admin)}
                  {admin.is_active ? null : <Badge tone="neutral">Inactive</Badge>}
                </span>
                <GrantDiff change={{ added: [], removed: [], gained: admin.gained, lost: admin.lost }} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {unchanged.length ? (
        <section className={s.diffSection}>
          <h3 className={s.diffTitle}>Not affected · {unchanged.length}</h3>
          <ul className={s.impactList} aria-label="Admins not affected">
            {unchanged.map((admin) => (
              <li key={admin.admin_id} className={s.impactRow}>
                <span className={s.impactName}>{adminHandle(admin)}</span>
                <span className={s.impactWhy}>{admin.why === 'super_admin' ? 'Super admin' : 'Access unchanged'}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
