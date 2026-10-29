'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, FieldShell, Input, Modal, RadioGroup, type RadioOption } from '../../_ui';
import { appliedKobo, formatPct, isValidKobo, nairaText, parsePercent, pctText } from './rules';
import { currencySamples, type LinkCard } from './model';
import s from './page.module.css';

const SAMPLE_KOBO = 120000;

type Choice = 'universal' | 'own';

export interface ExtraPercentageModalProps {
  card: LinkCard;
  universal: number;
  provider: string;
  onClose: () => void;
  onSubmit: (card: LinkCard, next: number | null) => Promise<boolean>;
}

function paysText(lowKobo: number, highKobo: number, hundredths: number): string {
  const lowPaid = appliedKobo(lowKobo, hundredths);
  const highPaid = appliedKobo(highKobo, hundredths);
  const invalid = !isValidKobo(lowPaid) || !isValidKobo(highPaid) ? ', which is not a valid rate' : '';
  if (lowKobo === highKobo) return `provider rate ${nairaText(lowKobo)} pays ${nairaText(lowPaid)} per unit${invalid}`;
  return `provider rates ${nairaText(lowKobo)} to ${nairaText(highKobo)} pay ${nairaText(lowPaid)} to ${nairaText(highPaid)} per unit${invalid}`;
}

export function ExtraPercentageModal({ card, universal, provider, onClose, onSubmit }: ExtraPercentageModalProps) {
  const baseId = useId();
  const formId = `${baseId}-form`;
  const inputId = `${baseId}-pct`;
  const aliveRef = useRef(true);
  const [choice, setChoice] = useState<Choice>(card.ownPct === null ? 'universal' : 'own');
  const [text, setText] = useState(card.ownPct === null ? '' : pctText(card.ownPct));
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const checked = parsePercent(text);
  const own = choice === 'own';
  const error = own && touched && !checked.ok ? checked.message : null;
  const hundredths = own
    ? checked.ok ? checked.hundredths : null
    : Math.round(universal * 100);
  const samples = currencySamples(card);
  const options: RadioOption<Choice>[] = [
    { value: 'universal', label: `Use the every-card percentage (${formatPct(universal)})` },
    { value: 'own', label: 'Use its own percentage' },
  ];

  const submit = async () => {
    if (submitting) return;
    if (own && !checked.ok) {
      setTouched(true);
      document.getElementById(inputId)?.focus();
      return;
    }
    const next = own && checked.ok ? checked.value : null;
    if (next === card.ownPct) {
      setNotice(next === null
        ? `${card.name} already uses the every-card percentage.`
        : `${card.name} already has its own extra percentage of ${formatPct(next)}.`);
      return;
    }
    setSubmitting(true);
    let done = false;
    try {
      done = await onSubmit(card, next);
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
      title={`Extra percentage for ${card.name}`}
      subtitle={`Applies to every linked card type of ${card.name}, in every country, physical and e-code.`}
      footer={(
        <>
          <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting}>Change percentage…</Button>
        </>
      )}
    >
      <form id={formId} className={s.modalForm} noValidate onSubmit={onFormSubmit}>
        <RadioGroup<Choice>
          legend="Extra percentage"
          options={options}
          value={choice}
          disabled={submitting}
          onChange={(next) => {
            setChoice(next);
            setNotice(null);
          }}
        />
        {own ? (
          <FieldShell
            label="Extra percentage (%)"
            htmlFor={inputId}
            required
            error={error}
            help={`Replaces the every-card percentage for ${card.name}; the two are not added together. A negative percentage pays less than ${provider}. 0% pays exactly the provider’s rate. Rates are rounded to the nearest kobo.`}
          >
            <Input
              id={inputId}
              mono
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder="4.5"
              value={text}
              readOnly={submitting}
              onChange={(event) => {
                setText(event.target.value);
                setNotice(null);
              }}
              onBlur={() => setTouched(true)}
            />
          </FieldShell>
        ) : null}
        {hundredths !== null ? (
          <div className={s.preview} aria-live="polite">
            <p className={s.previewLead}>
              {`At ${formatPct(hundredths / 100)}, a ${nairaText(SAMPLE_KOBO)} provider rate pays ${nairaText(appliedKobo(SAMPLE_KOBO, hundredths))}.`}
            </p>
            {samples.length > 0 ? (
              <ul className={s.sampleList}>
                {samples.map((sample) => (
                  <li key={sample.key}>
                    {`${sample.countryName}${sample.symbol ? ` (${sample.symbol})` : ''}: ${paysText(sample.lowKobo, sample.highKobo, hundredths)}.`}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {notice ? <p className={s.reason} role="status">{notice}</p> : null}
      </form>
    </Modal>
  );
}
