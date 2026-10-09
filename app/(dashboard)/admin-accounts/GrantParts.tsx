import { Badge, type BadgeTone } from '../../_ui';
import { PERMISSION_CATALOG, type Permission, type PermissionRisk } from '../../lib/permissions';
import { RISK_ORDER, grantRisk, type GrantChange } from './rules';
import { accessSummary, grantLabel, plural, type AccessSummary, type AdminRow } from './model';
import s from './page.module.css';

const RISK_TONE: Readonly<Record<PermissionRisk, BadgeTone>> = {
  critical: 'danger',
  high: 'warning',
  medium: 'neutral',
  low: 'neutral',
};

const RISK_LABEL: Readonly<Record<PermissionRisk, string>> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function RiskBadge({ risk }: { risk: PermissionRisk }) {
  return (
    <Badge tone={RISK_TONE[risk]}>
      {RISK_LABEL[risk]}
      <span className={s.srOnly}> risk</span>
    </Badge>
  );
}

export function ActionBreakdown({ actions, id }: { actions: readonly Permission[]; id?: string }) {
  const rows = RISK_ORDER.map((risk) => ({
    risk,
    labels: actions.filter((action) => PERMISSION_CATALOG[action].risk === risk).map((action) => PERMISSION_CATALOG[action].label),
  })).filter((row) => row.labels.length > 0);
  if (rows.length === 0) return null;
  return (
    <dl id={id} className={s.breakdown}>
      {rows.map((row) => (
        <div key={row.risk} className={s.breakdownRow}>
          <dt className={s.breakdownRisk}><RiskBadge risk={row.risk} /></dt>
          <dd className={s.breakdownActions}>{row.labels.join(', ')}</dd>
        </div>
      ))}
    </dl>
  );
}

export function GrantList({ keys, sign, label }: { keys: readonly string[]; sign?: '+' | '−'; label: string }) {
  return (
    <ul className={s.grantList} aria-label={label}>
      {keys.map((key) => {
        const risk = grantRisk(key);
        return (
          <li key={key} className={s.grantItem}>
            {sign ? <span className={s.grantSign} aria-hidden>{sign}</span> : null}
            <span className={s.grantName}>{grantLabel(key)}</span>
            <code className={s.grantCode}>{key}</code>
            {risk ? <RiskBadge risk={risk} /> : <span className={s.grantNone}>No actions</span>}
          </li>
        );
      })}
    </ul>
  );
}

export interface GrantDiffProps {
  change: GrantChange;
  addedTitle?: string;
  removedTitle?: string;
  showEffect?: boolean;
}

export function GrantDiff({ change, addedTitle = 'Granting', removedTitle = 'Removing', showEffect = true }: GrantDiffProps) {
  return (
    <div className={s.diff}>
      {change.added.length ? (
        <section className={s.diffSection}>
          <h3 className={s.diffTitle}>{addedTitle} · {change.added.length}</h3>
          <GrantList keys={change.added} sign="+" label={addedTitle} />
        </section>
      ) : null}
      {change.removed.length ? (
        <section className={s.diffSection}>
          <h3 className={s.diffTitle}>{removedTitle} · {change.removed.length}</h3>
          <GrantList keys={change.removed} sign="−" label={removedTitle} />
        </section>
      ) : null}
      {showEffect ? (
        <section className={s.diffSection}>
          <h3 className={s.diffTitle}>What this admin can do</h3>
          <p className={s.diffLead}>
            {change.gained.length ? `Gains ${plural(change.gained.length, 'action')}:` : 'Gains no actions.'}
          </p>
          <ActionBreakdown actions={change.gained} />
          <p className={s.diffLead}>
            {change.lost.length ? `Loses ${plural(change.lost.length, 'action')}:` : 'Loses no actions.'}
          </p>
          <ActionBreakdown actions={change.lost} />
        </section>
      ) : null}
    </div>
  );
}

export function Change({ before, after }: { before: string | null; after: string }) {
  return (
    <span className={s.change}>
      <span className={s.changeBefore}>{before || 'None'}</span>
      <span className={s.changeArrow} aria-hidden>→</span>
      <span className={s.srOnly}> changes to </span>
      <span>{after}</span>
    </span>
  );
}

export function accessCountText(summary: AccessSummary): string {
  const parts = [plural(summary.pages, 'page')];
  if (summary.additional) parts.push(`${summary.additional.toLocaleString('en-NG')} additional`);
  return parts.join(' · ');
}

export function accessPreview(labels: readonly string[], shown = 3): string {
  if (labels.length <= shown) return labels.join(', ');
  return `${labels.slice(0, shown).join(', ')} +${labels.length - shown} more`;
}

export function AccessCell({ admin }: { admin: AdminRow }) {
  if (admin.is_super_admin) {
    return (
      <div className={s.stack}>
        <span className={s.lead}>Everything</span>
        <span className={s.sub}>Super administrator</span>
      </div>
    );
  }
  const summary = accessSummary(admin.page_permissions);
  if (summary.pages === 0 && summary.additional === 0) return <span className={s.muted}>No access</span>;
  return (
    <div className={s.stack}>
      <span className={s.accessLine}>
        <span className={s.lead}>{accessCountText(summary)}</span>
        {summary.highest ? <RiskBadge risk={summary.highest} /> : null}
      </span>
      <span className={s.subWrap}>{accessPreview(summary.labels)}</span>
    </div>
  );
}
