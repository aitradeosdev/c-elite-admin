'use client';

import { useId, useMemo } from 'react';
import { Checkbox, Notice, SectionLabel } from '../../_ui';
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  RESOURCE_LABELS,
  actionLabel,
  permissionStatus,
  permissionsByCategory,
  resourceOf,
  type Permission,
  type PermissionCategory,
  type PermissionRisk,
} from '../../lib/permissions';
import { RISK_ORDER } from '../../lib/grants';
import { plural } from '../admin-accounts/model';
import { RiskBadge } from './GrantParts';
import { StoredKeys, type StoredKeysProps } from './StoredKeys';
import s from './access.module.css';

export interface MatrixResource {
  resource: string;
  label: string;
  actions: readonly Permission[];
}

export interface MatrixCategory {
  category: PermissionCategory;
  resources: readonly MatrixResource[];
}

export const MATRIX_CATEGORIES: readonly MatrixCategory[] = permissionsByCategory().map(({ category, permissions }) => {
  const rows = new Map<string, Permission[]>();
  for (const permission of permissions) {
    const resource = resourceOf(permission);
    const actions = rows.get(resource);
    if (actions) actions.push(permission);
    else rows.set(resource, [permission]);
  }
  return {
    category,
    resources: Array.from(rows, ([resource, actions]) => ({
      resource,
      label: RESOURCE_LABELS[resource] ?? resource,
      actions,
    })),
  };
});

export const STATUS_NOTE: Readonly<Record<'reserved' | 'super_only', string>> = {
  reserved: 'Not in use yet',
  super_only: 'Super administrators only',
};

const BADGED_RISKS: ReadonlySet<PermissionRisk> = new Set<PermissionRisk>(['critical', 'high']);

const NO_LOCKS: ReadonlyMap<Permission, string> = new Map();

export function canToggle(
  permission: Permission,
  locked: ReadonlyMap<Permission, string> = NO_LOCKS,
  readOnly = false,
): boolean {
  return !readOnly && !locked.has(permission) && permissionStatus(permission) === 'enforced';
}

export function actionNote(permission: Permission, locked: ReadonlyMap<Permission, string> = NO_LOCKS): string | null {
  const status = permissionStatus(permission);
  const notes = [locked.get(permission), status === 'enforced' ? undefined : STATUS_NOTE[status]]
    .filter((note): note is string => Boolean(note));
  return notes.length ? notes.join(' · ') : null;
}

export interface RowState {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
}

export function rowState(
  actions: readonly Permission[],
  value: ReadonlySet<Permission>,
  locked: ReadonlyMap<Permission, string> = NO_LOCKS,
  readOnly = false,
): RowState {
  const editable = actions.filter((permission) => canToggle(permission, locked, readOnly));
  if (editable.length === 0) {
    const shown = actions.filter((permission) => value.has(permission) || locked.has(permission)).length;
    return { checked: shown > 0 && shown === actions.length, indeterminate: shown > 0 && shown < actions.length, disabled: true };
  }
  const selected = editable.filter((permission) => value.has(permission)).length;
  return { checked: selected === editable.length, indeterminate: selected > 0 && selected < editable.length, disabled: false };
}

export function toggleRow(
  actions: readonly Permission[],
  value: ReadonlySet<Permission>,
  next: boolean,
  locked: ReadonlyMap<Permission, string> = NO_LOCKS,
  readOnly = false,
): Set<Permission> {
  const out = new Set(value);
  for (const permission of actions) {
    if (!canToggle(permission, locked, readOnly)) continue;
    if (next) out.add(permission);
    else out.delete(permission);
  }
  return out;
}

export function toggleAction(
  value: ReadonlySet<Permission>,
  permission: Permission,
  next: boolean,
  locked: ReadonlyMap<Permission, string> = NO_LOCKS,
  readOnly = false,
): Set<Permission> {
  return toggleRow([permission], value, next, locked, readOnly);
}

export interface MatrixSummary {
  total: number;
  byRisk: Record<PermissionRisk, number>;
}

export function matrixSummary(
  value: ReadonlySet<Permission>,
  locked: ReadonlyMap<Permission, string> = NO_LOCKS,
): MatrixSummary {
  const byRisk: Record<PermissionRisk, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let total = 0;
  for (const permission of ALL_PERMISSIONS) {
    if (!value.has(permission) && !locked.has(permission)) continue;
    total += 1;
    byRisk[PERMISSION_CATALOG[permission].risk] += 1;
  }
  return { total, byRisk };
}

export function summaryText(summary: MatrixSummary): string {
  if (summary.total === 0) return 'No actions selected.';
  const parts = RISK_ORDER.filter((risk) => summary.byRisk[risk] > 0)
    .map((risk) => `${summary.byRisk[risk].toLocaleString('en-NG')} ${risk}`);
  return `${plural(summary.total, 'action')} selected: ${parts.join(', ')}.`;
}

export interface PermissionMatrixProps {
  value: ReadonlySet<Permission>;
  locked?: ReadonlyMap<Permission, string>;
  onChange?: (next: Set<Permission>) => void;
  readOnly?: boolean;
  storedKeys?: StoredKeysProps;
}

interface MatrixRowProps {
  row: MatrixResource;
  nameId: string;
  value: ReadonlySet<Permission>;
  locked: ReadonlyMap<Permission, string>;
  readOnly: boolean;
  onChange: (next: Set<Permission>) => void;
}

function ActionLabel({ permission }: { permission: Permission }) {
  const risk = PERMISSION_CATALOG[permission].risk;
  return (
    <span className={s.actionLabel}>
      {actionLabel(permission)}
      {BADGED_RISKS.has(risk) ? <RiskBadge risk={risk} /> : null}
    </span>
  );
}

function MatrixRow({ row, nameId, value, locked, readOnly, onChange }: MatrixRowProps) {
  const all = rowState(row.actions, value, locked, readOnly);
  return (
    <div role="group" aria-labelledby={nameId} className={s.resource}>
      <span id={nameId} className={s.resourceName}>{row.label}</span>
      <div className={s.resourceActions}>
        <Checkbox
          className={s.allCheck}
          checked={all.checked}
          indeterminate={all.indeterminate}
          disabled={all.disabled}
          onChange={(next) => onChange(toggleRow(row.actions, value, next, locked, readOnly))}
          label={<>All<span className={s.srOnly}> {row.label} actions</span></>}
        />
        {row.actions.map((permission) => {
          const note = actionNote(permission, locked);
          const noteId = `${nameId}-${permission}`;
          return (
            <div key={permission} className={s.action}>
              <Checkbox
                className={s.actionCheck}
                value={permission}
                checked={value.has(permission) || locked.has(permission)}
                disabled={!canToggle(permission, locked, readOnly)}
                onChange={(next) => onChange(toggleAction(value, permission, next, locked, readOnly))}
                label={<ActionLabel permission={permission} />}
                aria-describedby={note ? noteId : undefined}
              />
              {note ? <span id={noteId} className={s.actionNote}>{note}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PermissionMatrix({ value, locked = NO_LOCKS, onChange, readOnly = false, storedKeys }: PermissionMatrixProps) {
  const baseId = useId();
  const frozen = readOnly || !onChange;
  const summary = useMemo(() => summaryText(matrixSummary(value, locked)), [value, locked]);
  const emit = (next: Set<Permission>) => {
    if (!frozen) onChange?.(next);
  };

  return (
    <div className={s.matrix}>
      <p className={s.grantsSummary} role="status">{summary}</p>
      <Notice tone="neutral" compact flush title="Some permissions cannot be granted.">
        Not in use yet means nothing checks the permission yet. Super administrators only means it stays with super
        administrators.
      </Notice>
      {MATRIX_CATEGORIES.map((group) => (
        <div key={group.category} className={s.category}>
          <SectionLabel as="h4" flush>{group.category}</SectionLabel>
          <div className={s.resources}>
            {group.resources.map((row) => (
              <MatrixRow
                key={row.resource}
                row={row}
                nameId={`${baseId}-${row.resource}`}
                value={value}
                locked={locked}
                readOnly={frozen}
                onChange={emit}
              />
            ))}
          </div>
        </div>
      ))}
      {storedKeys ? <StoredKeys {...storedKeys} readOnly={frozen || storedKeys.readOnly === true} /> : null}
    </div>
  );
}
