'use client';

import { useId, useState, type ReactNode } from 'react';
import { Pencil, Undo2 } from 'lucide-react';
import {
  Button, FieldShell, Input, Modal, Money, Notice, RadioGroup, Select, Textarea, formatNaira,
} from '../../_ui';
import {
  CORRECTION_NOTES, cardDetail, cardName, compareDecimal, formatForeignAmount, isPositive, koboText,
  matchDenomination, multiplyToKobo, parseDecimal, toKobo, userHandle, type CorrectionPayload, type Submission,
} from './queueModel';
import s from './ApproveModal.module.css';

const OTHER_NOTE = '__other__';
const NOTE_MAX = 500;
const ZERO = BigInt(0);

export interface ExpectedCredit {
  totalKobo: bigint;
  couponKobo: bigint;
}

export interface ApprovalRequest {
  payload: CorrectionPayload;
  expected: ExpectedCredit;
}

export interface ApproveModalProps {
  mode: 'approve' | 'overturn';
  submission: Submission;
  approvalLimit: number | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (request: ApprovalRequest) => void;
  returnFocusTo?: () => HTMLElement | null;
}

function Line({ label, children, total }: { label: ReactNode; children: ReactNode; total?: boolean }) {
  return (
    <div className={[s.line, total && s.total].filter(Boolean).join(' ')}>
      <dt className={s.lineLabel}>{label}</dt>
      <dd className={s.lineValue}>{children}</dd>
    </div>
  );
}

function Change({ from, to }: { from: ReactNode; to: ReactNode }) {
  return (
    <>
      <span className={s.was}><span className={s.srOnly}>was </span>{from}</span>
      <span className={s.arrow} aria-hidden>→</span>
      <span className={s.srOnly}> now </span>
      {to}
    </>
  );
}

function nairaText(kobo: bigint): string {
  return formatNaira(koboText(kobo));
}

export function ApproveModal({
  mode, submission, approvalLimit, busy, onCancel, onConfirm, returnFocusTo,
}: ApproveModalProps) {
  const headingId = useId();
  const originalTypeId = submission.card_type_id || submission.card_types?.id || '';
  const originalAmountText = submission.amount_foreign === null || submission.amount_foreign === undefined
    ? ''
    : String(submission.amount_foreign);

  const [correcting, setCorrecting] = useState(false);
  const [typeId, setTypeId] = useState(originalTypeId);
  const [amountText, setAmountText] = useState(originalAmountText);
  const [notePreset, setNotePreset] = useState('');
  const [noteText, setNoteText] = useState('');

  const types = submission.card_types_for_card;
  const symbol = submission.currency_symbol;
  const originalAmount = parseDecimal(submission.amount_foreign);
  const typedText = amountText.trim();
  const typedAmount = typedText === '' ? null : parseDecimal(typedText);
  const amountInvalid = correcting && typedText !== '' && !isPositive(typedAmount);
  const effectiveAmount = typedText === '' ? originalAmount : typedAmount;

  const typeChanged = correcting && typeId !== '' && typeId !== originalTypeId;
  const amountChanged = correcting
    && isPositive(typedAmount)
    && !(originalAmount && compareDecimal(typedAmount, originalAmount) === 0);
  const corrected = typeChanged || amountChanged;

  const selectedType = types.find((t) => t.id === (typeId || originalTypeId));
  const originalTypeName = submission.card_types?.name || 'Current type';
  const selectedTypeName = selectedType?.name || originalTypeName;
  const denomination = corrected ? matchDenomination(selectedType, effectiveAmount) : null;
  const correctedRate = denomination ? parseDecimal(denomination.rate_naira) : null;
  const correctedPayout = corrected && isPositive(effectiveAmount) && correctedRate
    ? multiplyToKobo(effectiveAmount, correctedRate)
    : null;

  const storedPayout = toKobo(submission.payout_naira);
  const couponKobo = toKobo(submission.coupon_bonus) ?? ZERO;
  const payoutKobo = corrected ? correctedPayout : storedPayout;
  const totalKobo = payoutKobo === null ? null : payoutKobo + couponKobo;

  const note = notePreset === OTHER_NOTE ? noteText.trim() : notePreset;

  let blocker: string | null = null;
  if (amountInvalid) {
    blocker = 'Enter a card value greater than zero.';
  } else if (corrected && !selectedType) {
    blocker = 'Choose an active card type for this card.';
  } else if (corrected && !denomination) {
    blocker = `No active denomination of ${selectedTypeName} covers ${formatForeignAmount(typedText || originalAmountText, symbol)}.`;
  } else if (corrected && !correctedRate) {
    blocker = 'The matching denomination has no rate set, so the corrected payout cannot be calculated.';
  } else if (!corrected && storedPayout === null) {
    blocker = 'This submission has no payout amount. Correct the card type or value to price it.';
  } else if (corrected && !note) {
    blocker = 'Choose or write a note so the user knows why the amount changed.';
  } else if (correcting && note.length > NOTE_MAX) {
    blocker = `Keep the note to ${NOTE_MAX} characters or fewer.`;
  }

  const limitKobo = approvalLimit === null ? null : toKobo(approvalLimit);
  const overLimit = totalKobo !== null && limitKobo !== null && totalKobo > limitKobo;
  const who = userHandle(submission.users);
  const totalText = totalKobo === null ? null : nairaText(totalKobo);
  const verb = mode === 'overturn' ? 'Overturn and credit' : 'Approve and credit';

  const resetCorrection = () => {
    setCorrecting(false);
    setTypeId(originalTypeId);
    setAmountText(originalAmountText);
    setNotePreset('');
    setNoteText('');
  };

  const submit = () => {
    if (busy || blocker || totalKobo === null) return;
    const payload: CorrectionPayload = {};
    if (typeChanged) payload.card_type_id = typeId;
    if (amountChanged) payload.amount_foreign = Number(typedText);
    if (correcting && note) payload.correction_note = note;
    onConfirm({ payload, expected: { totalKobo, couponKobo } });
  };

  const consequences = mode === 'overturn'
    ? [
        `The rejection is reversed and ${totalText ?? 'the payout'} is credited to ${who}'s wallet as soon as you confirm.`,
        'The dispute is closed and the user is notified.',
        'This cannot be undone from the console.',
      ]
    : [
        `${totalText ?? 'The payout'} is credited to ${who}'s wallet as soon as you confirm.`,
        'The user is notified that the card was approved.',
        'This cannot be undone from the console.',
      ];

  const typeOptions = types.some((t) => t.id === originalTypeId) || !originalTypeId
    ? types
    : [{ id: originalTypeId, name: `${originalTypeName} (current)`, country_code: submission.card_types?.country_code ?? null, denominations: [] }, ...types];

  return (
    <Modal
      open
      static={busy}
      onClose={onCancel}
      returnFocusTo={returnFocusTo}
      size="md"
      title={mode === 'overturn' ? 'Overturn dispute and credit' : 'Approve and credit'}
      subtitle={`${who} · ${[cardName(submission), cardDetail(submission)].filter(Boolean).join(' · ')}`}
      footer={
        <div className={s.footer}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="success" onClick={submit} loading={busy} disabled={Boolean(blocker) || totalKobo === null}>
            {totalText ? `${verb} ${totalText}` : verb}
          </Button>
        </div>
      }
    >
      <dl className={s.breakdown}>
        <Line label="Card type">
          {typeChanged ? <Change from={originalTypeName} to={selectedTypeName} /> : originalTypeName}
        </Line>
        <Line label="Card value">
          <span className={s.mono}>
            {amountChanged
              ? <Change from={formatForeignAmount(submission.amount_foreign, symbol)} to={formatForeignAmount(typedText, symbol)} />
              : formatForeignAmount(submission.amount_foreign, symbol)}
          </span>
        </Line>
        <Line label="Rate">
          <span className={s.mono}>
            {corrected
              ? (correctedRate && denomination ? `${formatNaira(denomination.rate_naira)} per unit` : '—')
              : (submission.rate_at_submission !== null && submission.rate_at_submission !== ''
                ? `${formatNaira(submission.rate_at_submission)} per unit`
                : '—')}
          </span>
        </Line>
        {corrected && denomination ? <Line label="Denomination">{denomination.range_label || '—'}</Line> : null}
        <Line label="Payout">
          {corrected
            ? <Change from={<Money value={submission.payout_naira} />} to={correctedPayout === null ? '—' : <Money value={koboText(correctedPayout)} />} />
            : <Money value={submission.payout_naira} />}
        </Line>
        {couponKobo > ZERO ? (
          <Line label={submission.coupon_code ? `Coupon ${submission.coupon_code}` : 'Coupon bonus'}>
            <Money value={koboText(couponKobo)} signed />
          </Line>
        ) : null}
        <Line label="Total credit" total>
          {totalKobo === null ? '—' : <Money value={koboText(totalKobo)} size="lg" emphasis="strong" />}
        </Line>
      </dl>

      <ul className={s.consequences}>
        {consequences.map((line) => <li key={line}>{line}</li>)}
        {couponKobo > ZERO ? (
          <li>
            The total includes the {nairaText(couponKobo)} coupon bonus. If the coupon can no longer be redeemed, only the payout is credited.
          </li>
        ) : null}
      </ul>

      {overLimit && limitKobo !== null ? (
        <Notice tone="danger" announce>
          This credit is above the {nairaText(limitKobo)} limit for a single approval, so the server will refuse it.
          The limit is set in Platform Settings.
        </Notice>
      ) : null}

      {!correcting ? (
        <div className={s.toggleRow}>
          <Button variant="secondary" leftIcon={<Pencil size={14} />} onClick={() => setCorrecting(true)} disabled={busy}>
            Correct card type or value
          </Button>
        </div>
      ) : (
        <div className={s.correction} role="group" aria-labelledby={headingId}>
          <div className={s.correctionHead}>
            <p id={headingId} className={s.correctionTitle}>Correction</p>
            <Button variant="ghost" size="sm" leftIcon={<Undo2 size={14} />} onClick={resetCorrection} disabled={busy}>
              Undo correction
            </Button>
          </div>

          <FieldShell label="Card type">
            <Select value={typeId} onChange={(event) => setTypeId(event.target.value)} disabled={busy}>
              {typeOptions.length === 0 ? <option value={typeId}>{originalTypeName}</option> : null}
              {typeOptions.length > 0 && typeId === '' ? <option value="" disabled>Choose a card type</option> : null}
              {typeOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.country_code ? `${t.name} (${t.country_code})` : t.name}</option>
              ))}
            </Select>
          </FieldShell>

          <FieldShell
            label={symbol ? `Card value (${symbol})` : 'Card value'}
            help={`In the card's own currency. Submitted as ${formatForeignAmount(submission.amount_foreign, symbol)}.`}
            error={amountInvalid ? 'Enter a value greater than zero.' : undefined}
          >
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              mono
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              disabled={busy}
            />
          </FieldShell>

          <RadioGroup
            legend="Note to user"
            required={corrected}
            options={[
              ...CORRECTION_NOTES.map((value) => ({ value, label: value })),
              { value: OTHER_NOTE, label: 'Other' },
            ]}
            value={notePreset || null}
            onChange={setNotePreset}
            disabled={busy}
          />

          {notePreset === OTHER_NOTE ? (
            <FieldShell label="Custom note" required={corrected}>
              <Textarea
                rows={2}
                maxLength={NOTE_MAX}
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                placeholder="Explain the correction to the user"
                disabled={busy}
              />
            </FieldShell>
          ) : null}
        </div>
      )}

      {blocker ? <p className={s.blocker} role="status">{blocker}</p> : null}
    </Modal>
  );
}
