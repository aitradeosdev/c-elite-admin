'use client';

import { forwardRef, useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button, Checkbox, Notice, SectionLabel } from '../../_ui';
import { sortGrants } from './rules';
import {
  ENFORCED_ADDITIONAL_GROUPS,
  PAGE_GRANT_GROUPS,
  RESERVED_ADDITIONAL,
  RESERVED_ADDITIONAL_GROUPS,
  accessSummary,
  extraGrants,
  holdsReserved,
  plural,
  type AccessSummary,
  type AdditionalGrantGroup,
  type AdditionalGrantSpec,
  type EditorMode,
  type ExtraGrantSpec,
  type PageGrantSpec,
} from './model';
import { ActionBreakdown, RiskBadge } from './GrantParts';
import s from './page.module.css';

type Mark = 'adding' | 'removing' | null;

interface RowProps {
  checked: boolean;
  mark: Mark;
  disabled: boolean;
  onToggle: (key: string, checked: boolean) => void;
}

function MarkTag({ mark }: { mark: Mark }) {
  if (!mark) return null;
  return <span className={s.grantMark}>{mark === 'adding' ? 'Adding' : 'Removing'}</span>;
}

function summaryText(summary: AccessSummary): string {
  if (summary.pages === 0 && summary.additional === 0) return 'No access selected yet.';
  const parts = [plural(summary.pages, 'page')];
  if (summary.additional) parts.push(`${summary.additional.toLocaleString('en-NG')} additional`);
  const actions = plural(summary.actions, 'action');
  return `${parts.join(' · ')} · ${actions}${summary.critical ? `, ${summary.critical.toLocaleString('en-NG')} critical` : ''}`;
}

function PageGrantRow({ spec, checked, mark, disabled, onToggle }: RowProps & { spec: PageGrantSpec }) {
  const detailId = useId();
  return (
    <div className={[s.grantRow, checked && s.grantRowOn].filter(Boolean).join(' ')}>
      <div className={s.grantRowHead}>
        <Checkbox
          className={s.grantCheck}
          checked={checked}
          disabled={disabled}
          onChange={(next) => onToggle(spec.key, next)}
          label={spec.label}
          aria-describedby={detailId}
        />
        <span className={s.grantAside}>
          <MarkTag mark={mark} />
          <code className={s.grantCode}>{spec.key}</code>
        </span>
      </div>
      <div id={detailId} className={s.grantDetail}>
        {spec.actions.length ? (
          <ActionBreakdown actions={spec.actions} />
        ) : (
          <p className={s.grantNoneLine}>Grants no actions.</p>
        )}
        {spec.notes.map((note) => (
          <p key={note.text} className={note.tone === 'warning' ? s.noteWarning : s.note}>{note.text}</p>
        ))}
      </div>
    </div>
  );
}

function AdditionalGrantRow({ spec, checked, mark, disabled, onToggle }: RowProps & { spec: AdditionalGrantSpec }) {
  return (
    <div className={[s.grantRow, checked && s.grantRowOn].filter(Boolean).join(' ')}>
      <div className={s.grantRowHead}>
        <Checkbox
          className={s.grantCheck}
          checked={checked}
          disabled={disabled}
          onChange={(next) => onToggle(spec.key, next)}
          label={spec.label}
          description={spec.description}
        />
        <span className={s.grantAside}>
          <MarkTag mark={mark} />
          <code className={s.grantCode}>{spec.key}</code>
          <RiskBadge risk={spec.risk} />
          {spec.enforced ? null : <span className={s.reservedTag}>Not in use yet</span>}
        </span>
      </div>
    </div>
  );
}

function ExtraGrantRow({ spec, checked, mark, disabled, onToggle }: RowProps & { spec: ExtraGrantSpec }) {
  const noteId = useId();
  const unknown = spec.kind === 'unknown';
  return (
    <div className={[s.grantRow, checked && s.grantRowOn].filter(Boolean).join(' ')}>
      <div className={s.grantRowHead}>
        <Checkbox
          className={s.grantCheck}
          checked={checked}
          disabled={disabled}
          invalid={unknown && checked}
          onChange={(next) => onToggle(spec.key, next)}
          label={spec.label}
          aria-describedby={noteId}
        />
        <span className={s.grantAside}>
          <MarkTag mark={mark} />
          <code className={s.grantCode}>{spec.key}</code>
        </span>
      </div>
      <p id={noteId} className={unknown ? s.noteDanger : s.note}>{spec.note}</p>
    </div>
  );
}

function AdditionalGroups({
  groups, held, markOf, disabled, onToggle,
}: {
  groups: readonly AdditionalGrantGroup[];
  held: ReadonlySet<string>;
  markOf: (key: string) => Mark;
  disabled: boolean;
  onToggle: (key: string, checked: boolean) => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <fieldset key={group.category} className={s.grantGroup} disabled={disabled}>
          <legend className={s.grantLegend}>{group.category}</legend>
          <div className={s.grantRows}>
            {group.grants.map((spec) => (
              <AdditionalGrantRow
                key={spec.key}
                spec={spec}
                checked={held.has(spec.key)}
                mark={markOf(spec.key)}
                disabled={disabled}
                onToggle={onToggle}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </>
  );
}

export interface GrantEditorProps {
  value: readonly string[];
  baseline: readonly string[];
  onChange: (next: string[]) => void;
  mode: EditorMode;
  error?: string;
  disabled?: boolean;
}

export const GrantEditor = forwardRef<HTMLElement, GrantEditorProps>(function GrantEditor(
  { value, baseline, onChange, mode, error, disabled = false },
  ref,
) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const errorId = `${baseId}-error`;
  const reservedId = `${baseId}-reserved`;
  const held = useMemo(() => new Set(value), [value]);
  const before = useMemo(() => new Set(baseline), [baseline]);
  const summary = useMemo(() => accessSummary(value), [value]);
  const extras = useMemo(() => extraGrants([...baseline, ...value]), [baseline, value]);
  const [showReserved, setShowReserved] = useState(() => holdsReserved(value) || holdsReserved(baseline));

  const toggle = (key: string, checked: boolean) => {
    if (checked) onChange(sortGrants(new Set([...value, key])));
    else onChange(value.filter((item) => item !== key));
  };

  const markOf = (key: string): Mark => {
    if (mode !== 'edit' || held.has(key) === before.has(key)) return null;
    return held.has(key) ? 'adding' : 'removing';
  };

  return (
    <section
      ref={ref}
      className={s.grants}
      aria-labelledby={headingId}
      aria-describedby={error ? errorId : undefined}
      tabIndex={-1}
    >
      <div className={s.grantsHead}>
        <h3 id={headingId} className={s.formHeading}>Access</h3>
        <p className={s.grantsSummary} role="status">{summaryText(summary)}</p>
      </div>
      <p className={s.formHint}>
        Page access is what the console, the mobile app, alert routing and the payout service check, so it stays the
        main grant. Additional permissions are stored alongside it.
      </p>
      {error ? <p id={errorId} className={s.fieldError} role="alert">{error}</p> : null}

      <div className={s.grantBlock}>
        <SectionLabel as="h4" flush>Page access</SectionLabel>
        {PAGE_GRANT_GROUPS.map((group) => (
          <fieldset key={group.label} className={s.grantGroup} disabled={disabled}>
            <legend className={s.grantLegend}>{group.label}</legend>
            <div className={s.grantRows}>
              {group.grants.map((spec) => (
                <PageGrantRow
                  key={spec.key}
                  spec={spec}
                  checked={held.has(spec.key)}
                  mark={markOf(spec.key)}
                  disabled={disabled}
                  onToggle={toggle}
                />
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className={s.grantBlock}>
        <SectionLabel as="h4" flush>Additional permissions</SectionLabel>
        <p className={s.formHint}>Catalog permissions that no page grant includes.</p>
        <AdditionalGroups
          groups={ENFORCED_ADDITIONAL_GROUPS}
          held={held}
          markOf={markOf}
          disabled={disabled}
          onToggle={toggle}
        />
        <div className={s.reserved}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leftIcon={showReserved ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            aria-expanded={showReserved}
            aria-controls={reservedId}
            onClick={() => setShowReserved((open) => !open)}
          >
            {showReserved ? 'Hide' : 'Show'} {plural(RESERVED_ADDITIONAL.length, 'reserved permission')}
          </Button>
          <div id={reservedId} className={s.reservedBody} hidden={!showReserved}>
            <Notice tone="neutral" compact flush>
              Nothing in the console checks these yet. A grant takes effect on its own when the feature that uses it
              ships, so only grant one you would also grant today.
            </Notice>
            <AdditionalGroups
              groups={RESERVED_ADDITIONAL_GROUPS}
              held={held}
              markOf={markOf}
              disabled={disabled}
              onToggle={toggle}
            />
          </div>
        </div>
      </div>

      {extras.length ? (
        <div className={s.grantBlock}>
          <SectionLabel as="h4" flush>Other stored keys</SectionLabel>
          <p className={s.formHint}>These keys are on the account but cannot be granted here.</p>
          <fieldset className={s.grantGroup} disabled={disabled}>
            <legend className={s.srOnly}>Other stored keys</legend>
            <div className={s.grantRows}>
              {extras.map((spec) => (
                <ExtraGrantRow
                  key={spec.key}
                  spec={spec}
                  checked={held.has(spec.key)}
                  mark={markOf(spec.key)}
                  disabled={disabled}
                  onToggle={toggle}
                />
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
    </section>
  );
});
