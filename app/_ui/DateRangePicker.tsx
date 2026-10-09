'use client';

import {
  ChangeEvent, FocusEvent, ReactNode, useEffect, useId, useRef, useState,
} from 'react';
import {
  businessDatePresets, isBusinessDateKey, type BusinessDatePreset, type BusinessDatePresetKey,
} from '../lib/time';
import s from './DateRangePicker.module.css';

export interface DateRangeValue {
  from: string | null;
  to: string | null;
}

export interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  presets?: ReadonlyArray<BusinessDatePresetKey>;
  legend?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

type Edge = 'from' | 'to';

interface Draft {
  text: string;
  partial: boolean;
}

type Drafts = Record<Edge, Draft>;

const EDGES: ReadonlyArray<{ edge: Edge; label: string }> = [
  { edge: 'from', label: 'From' },
  { edge: 'to', label: 'To' },
];

export function isDateRangeInverted(range: { from?: string | null; to?: string | null }): boolean {
  const { from, to } = range;
  return isBusinessDateKey(from) && isBusinessDateKey(to) && from > to;
}

export function resolveDateRange(from: string, to: string): DateRangeValue | null {
  const range: DateRangeValue = { from: from === '' ? null : from, to: to === '' ? null : to };
  if (range.from !== null && !isBusinessDateKey(range.from)) return null;
  if (range.to !== null && !isBusinessDateKey(range.to)) return null;
  return isDateRangeInverted(range) ? null : range;
}

export function matchDatePreset(
  range: DateRangeValue | null,
  presets: ReadonlyArray<BusinessDatePreset>,
): BusinessDatePresetKey | null {
  if (!range) return null;
  return presets.find((preset) => preset.from === range.from && preset.to === range.to)?.key ?? null;
}

export function pickDatePresets(
  keys: ReadonlyArray<BusinessDatePresetKey> | undefined,
  reference: Date = new Date(),
): BusinessDatePreset[] {
  const all = businessDatePresets(reference);
  if (!keys) return all;
  const picked: BusinessDatePreset[] = [];
  for (const key of keys) {
    const preset = all.find((candidate) => candidate.key === key);
    if (preset && !picked.includes(preset)) picked.push(preset);
  }
  return picked;
}

function draftOf(value: string | null): Draft {
  return { text: value ?? '', partial: false };
}

export function DateRangePicker({
  value,
  onChange,
  presets,
  legend = 'Date range',
  disabled,
  id,
  className,
}: DateRangePickerProps) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const errorId = `${baseId}-error`;
  const from = value.from ?? null;
  const to = value.to ?? null;

  const [drafts, setDrafts] = useState<Drafts>(() => ({ from: draftOf(from), to: draftOf(to) }));
  const [synced, setSynced] = useState<DateRangeValue>({ from, to });
  const inputs = useRef<Record<Edge, HTMLInputElement | null>>({ from: null, to: null });

  if (synced.from !== from || synced.to !== to) {
    setSynced({ from, to });
    setDrafts({ from: draftOf(from), to: draftOf(to) });
  }

  useEffect(() => {
    for (const { edge } of EDGES) {
      const input = inputs.current[edge];
      const draft = drafts[edge];
      if (input && draft.text === '' && !draft.partial && input.validity.badInput) input.value = '';
    }
  }, [drafts]);

  const update = (next: Drafts) => {
    setDrafts(next);
    if (next.from.partial || next.to.partial) return;
    const range = resolveDateRange(next.from.text, next.to.text);
    if (!range || (range.from === from && range.to === to)) return;
    onChange(range);
  };

  const handleChange = (edge: Edge) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value: text, validity } = event.currentTarget;
    const partial = text === '' ? validity.badInput : !isBusinessDateKey(text);
    update({ ...drafts, [edge]: { text, partial } });
  };

  const handleBlur = (edge: Edge) => (event: FocusEvent<HTMLInputElement>) => {
    if (!drafts[edge].partial && !event.currentTarget.validity.badInput) return;
    update({ ...drafts, [edge]: draftOf(edge === 'from' ? from : to) });
  };

  const presetList = pickDatePresets(presets);
  const settled = drafts.from.partial || drafts.to.partial
    ? null
    : resolveDateRange(drafts.from.text, drafts.to.text);
  const activePreset = matchDatePreset(settled, presetList);
  const inverted = isDateRangeInverted({ from: drafts.from.text, to: drafts.to.text });

  return (
    <fieldset id={id} className={[s.root, className].filter(Boolean).join(' ')} disabled={disabled}>
      <legend className={s.srOnly}>{legend}</legend>
      <div className={s.fields}>
        {EDGES.map(({ edge, label }) => {
          const inputId = `${baseId}-${edge}`;
          const text = drafts[edge].text;
          return (
            <div key={edge} className={[s.field, inverted && s.invalid].filter(Boolean).join(' ')}>
              <label htmlFor={inputId} className={s.label}>{label}</label>
              <input
                ref={(node) => {
                  inputs.current[edge] = node;
                }}
                id={inputId}
                type="date"
                className={s.input}
                value={text}
                max="9999-12-31"
                data-empty={text === '' ? '' : undefined}
                aria-invalid={inverted || undefined}
                aria-describedby={inverted ? errorId : undefined}
                onChange={handleChange(edge)}
                onBlur={handleBlur(edge)}
              />
            </div>
          );
        })}
      </div>
      {presetList.length > 0 ? (
        <div className={s.presets} role="group" aria-label="Date presets">
          {presetList.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={s.chip}
              aria-pressed={preset.key === activePreset}
              onClick={() => update({ from: draftOf(preset.from), to: draftOf(preset.to) })}
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}
      {inverted ? (
        <p id={errorId} className={s.error} role="alert">From must be on or before To.</p>
      ) : null}
    </fieldset>
  );
}
