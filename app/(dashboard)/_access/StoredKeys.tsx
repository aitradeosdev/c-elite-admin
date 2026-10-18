'use client';

import { useId } from 'react';
import { Checkbox, SectionLabel } from '../../_ui';
import { isPermission } from '../../lib/permissions';
import { sortGrants } from '../../lib/grants';
import { grantKind } from '../admin-accounts/rules';
import { grantLabel } from '../admin-accounts/model';
import s from './access.module.css';

export type StoredKeyKind = 'restricted' | 'retired' | 'unknown';

export interface StoredKeySpec {
  key: string;
  kind: StoredKeyKind;
  label: string;
  note: string;
}

const STORED_NOTES: Readonly<Record<StoredKeyKind, string>> = {
  restricted: 'Includes managing admins and viewing roles, which are for super administrators only.',
  retired: 'Nothing checks this key any more, so it grants nothing.',
  unknown: 'Not a recognised permission key, so it grants nothing.',
};

const STORED_KEYS_HINT = 'These keys are stored but cannot be granted here.';

const STORED_KEYS_UNTICK_HINT = 'Untick a key to remove it. Once saved, it cannot be added back.';

export function storedKeyKind(key: string): StoredKeyKind | null {
  if (isPermission(key)) return null;
  const kind = grantKind(key);
  return kind === 'restricted' || kind === 'retired' || kind === 'unknown' ? kind : null;
}

export function storedKeySpecs(keys: Iterable<string>): StoredKeySpec[] {
  const specs: StoredKeySpec[] = [];
  for (const key of sortGrants(new Set(keys))) {
    const kind = storedKeyKind(key);
    if (kind) specs.push({ key, kind, label: grantLabel(key), note: STORED_NOTES[kind] });
  }
  return specs;
}

export function toggleStoredKey(
  value: readonly string[],
  baseline: readonly string[],
  key: string,
  next: boolean,
): string[] {
  if (!next) return value.filter((item) => item !== key);
  if (value.includes(key) || !baseline.includes(key)) return [...value];
  return [...value, key];
}

export interface StoredKeysProps {
  value: readonly string[];
  baseline?: readonly string[];
  onChange?: (next: string[]) => void;
  readOnly?: boolean;
}

interface StoredKeyRowProps {
  spec: StoredKeySpec;
  checked: boolean;
  removing: boolean;
  disabled: boolean;
  onToggle: (key: string, next: boolean) => void;
}

function StoredKeyRow({ spec, checked, removing, disabled, onToggle }: StoredKeyRowProps) {
  const noteId = useId();
  return (
    <div className={[s.grantRow, checked && s.grantRowOn].filter(Boolean).join(' ')}>
      <div className={s.grantRowHead}>
        <Checkbox
          className={s.grantCheck}
          value={spec.key}
          checked={checked}
          disabled={disabled}
          onChange={(next) => onToggle(spec.key, next)}
          label={spec.label}
          aria-describedby={noteId}
        />
        <span className={s.grantAside}>
          {removing ? <span className={s.grantMark}>Removing</span> : null}
          <code className={s.grantCode}>{spec.key}</code>
        </span>
      </div>
      <p id={noteId} className={s.note}>{spec.note}</p>
    </div>
  );
}

export function StoredKeys({ value, baseline = value, onChange, readOnly = false }: StoredKeysProps) {
  const frozen = readOnly || !onChange;
  const specs = storedKeySpecs([...baseline, ...value]);
  if (specs.length === 0) return null;
  const held = new Set(value);
  const stored = new Set(baseline);
  const toggle = (key: string, next: boolean) => {
    if (!frozen) onChange?.(toggleStoredKey(value, baseline, key, next));
  };

  return (
    <div className={s.grantBlock}>
      <SectionLabel as="h4" flush>Other stored keys</SectionLabel>
      <p className={s.formHint}>{frozen ? STORED_KEYS_HINT : `${STORED_KEYS_HINT} ${STORED_KEYS_UNTICK_HINT}`}</p>
      <fieldset className={s.grantGroup} disabled={frozen}>
        <legend className={s.srOnly}>Other stored keys</legend>
        <div className={s.grantRows}>
          {specs.map((spec) => (
            <StoredKeyRow
              key={spec.key}
              spec={spec}
              checked={held.has(spec.key)}
              removing={stored.has(spec.key) && !held.has(spec.key)}
              disabled={frozen}
              onToggle={toggle}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}
