'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, FieldShell, Input, Modal, Notice, Toggle, formatNaira } from '../../_ui';
import { RANGE_LABEL_MAX, parseDecimal } from './rateRules';
import {
  checkNewRange, currencyAmount, firstNewRangeError, groupTitle, overlapsFor, perUnit,
  type AddRangeTarget, type NewRangeDraft, type NewRangeField, type NewRangeValues,
} from './model';
import { overlapConsequence } from './confirmOptions';
import s from './page.module.css';

const EMPTY_FORM: NewRangeDraft = { label: '', min: '', max: '', rate: '', active: true };

export interface AddRangeModalProps {
  target: AddRangeTarget;
  onClose: () => void;
  onSubmit: (target: AddRangeTarget, values: NewRangeValues) => Promise<boolean>;
}

export function AddRangeModal({ target, onClose, onSubmit }: AddRangeModalProps) {
  const baseId = useId();
  const formId = `${baseId}-form`;
  const aliveRef = useRef(true);
  const [form, setForm] = useState<NewRangeDraft>(EMPTY_FORM);
  const [touched, setTouched] = useState<ReadonlySet<NewRangeField>>(() => new Set());
  const [revealAll, setRevealAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const { path } = target;
  const check = checkNewRange(form);
  const min = parseDecimal(form.min);
  const max = parseDecimal(form.max);
  const rate = parseDecimal(form.rate);
  const overlaps = min !== null && max !== null && min <= max ? overlapsFor(target, min, max) : [];
  const overlapNote = overlapConsequence(overlaps);
  const fieldId = (field: NewRangeField) => `${baseId}-${field}`;
  const shown = (field: NewRangeField) => (revealAll || touched.has(field) ? check.errors[field] : undefined);
  const example = max !== null && rate !== null && !check.errors.rate && !check.errors.max
    ? `A ${currencyAmount(path.currency, max)} card pays ${formatNaira(max * rate)}.`
    : 'Naira paid for each unit of the card value.';

  const update = (patch: Partial<NewRangeDraft>) => setForm((current) => ({ ...current, ...patch }));

  const touch = (field: NewRangeField) => {
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));
  };

  const submit = async () => {
    if (submitting) return;
    const values = check.values;
    if (!values) {
      setRevealAll(true);
      const first = firstNewRangeError(check.errors);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    setSubmitting(true);
    let done = false;
    try {
      done = await onSubmit(target, values);
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
    if (done) onClose();
  };

  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  return (
    <Modal
      open
      onClose={onClose}
      static={submitting}
      size="sm"
      title="Add range"
      subtitle={`${path.cardName} · ${groupTitle(path)}`}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting}>Review range</Button>
        </>
      }
    >
      <form id={formId} className={s.formGrid} noValidate onSubmit={onFormSubmit}>
        <FieldShell
          label="Label"
          htmlFor={fieldId('label')}
          required
          error={shown('label')}
          help="Shown to users in the app and on their submissions."
        >
          <Input
            id={fieldId('label')}
            value={form.label}
            maxLength={RANGE_LABEL_MAX}
            autoComplete="off"
            placeholder={`e.g. ${currencyAmount(path.currency, 25)}–${currencyAmount(path.currency, 99)}`}
            onChange={(event) => update({ label: event.target.value })}
            onBlur={() => touch('label')}
          />
        </FieldShell>
        <div className={s.formPair}>
          <FieldShell label="Minimum card value" htmlFor={fieldId('min')} required error={shown('min')}>
            <Input
              id={fieldId('min')}
              mono
              inputMode="decimal"
              autoComplete="off"
              value={form.min}
              placeholder="25"
              onChange={(event) => update({ min: event.target.value })}
              onBlur={() => touch('min')}
            />
          </FieldShell>
          <FieldShell label="Maximum card value" htmlFor={fieldId('max')} required error={shown('max')}>
            <Input
              id={fieldId('max')}
              mono
              inputMode="decimal"
              autoComplete="off"
              value={form.max}
              placeholder="99"
              onChange={(event) => update({ max: event.target.value })}
              onBlur={() => touch('max')}
            />
          </FieldShell>
        </div>
        <FieldShell
          label={`Rate in naira ${perUnit(path.currency)}`}
          htmlFor={fieldId('rate')}
          required
          error={shown('rate')}
          help={example}
        >
          <Input
            id={fieldId('rate')}
            mono
            inputMode="decimal"
            autoComplete="off"
            value={form.rate}
            placeholder="1500.00"
            onChange={(event) => update({ rate: event.target.value })}
            onBlur={() => touch('rate')}
          />
        </FieldShell>
        <div className={s.toggleRow}>
          <Toggle checked={form.active} label="Active" onChange={(next) => update({ active: next })} />
          <span className={s.toggleHint}>
            {form.active ? 'Pays new submissions as soon as it is added.' : 'Added switched off; pays nothing yet.'}
          </span>
        </div>
        {overlapNote ? (
          <Notice tone="warning" compact flush announce="polite">{overlapNote}</Notice>
        ) : null}
      </form>
    </Modal>
  );
}
