'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FieldShell, Input, Notice, Select, SidePanel, Toggle, useConfirm, useToast } from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { formatNaira } from '../../_ui/money';
import { CODE_MAX, TYPE_MAX, findBrand, plural } from './couponRules';
import {
  EMPTY_FORM, brandAvailable, brandNames, checkForm, classifyMutation, couponStatus, createRequestBody,
  editRequestBody, firstError, formFor, isFormDirty, proposeEdit, rebaseForm, toMutationResult,
  type CouponForm, type CouponRow, type CouponsSnapshot, type EditorMode, type FormField, type MutationOutcome,
} from './model';
import { createConfirm, discardConfirm, editConfirm } from './confirmOptions';
import { usedText } from './CouponParts';
import s from './page.module.css';

const TERM_LABEL_MAX = 80;

export interface CouponEditorProps {
  mode: EditorMode;
  coupon: CouponRow | null;
  snapshot: CouponsSnapshot;
  today: string;
  readFresh: () => Promise<CouponsSnapshot | null>;
  applyCoupon: (row: CouponRow) => void;
  refreshList: () => void;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}

function termLabel(term: string): string {
  return term.length > TERM_LABEL_MAX ? `${term.slice(0, TERM_LABEL_MAX - 1).trimEnd()}…` : term;
}

function awaitingLine(row: CouponRow): string | null {
  if (row.awaitingTrades === null || row.awaitingTrades === 0) return null;
  return `${plural(row.awaitingTrades, 'trade', 'trades')} awaiting review with ${formatNaira(row.awaitingBonus ?? 0)} in bonuses`;
}

export function CouponEditor({
  mode, coupon, snapshot, today, readFresh, applyCoupon, refreshList, onClose, returnFocusTo,
}: CouponEditorProps) {
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const router = useRouter();
  const formId = useId();
  const [form, setForm] = useState<CouponForm>(() => formFor(coupon));
  const [base, setBase] = useState<CouponForm>(() => formFor(coupon));
  const [baseRow, setBaseRow] = useState<CouponRow | null>(coupon);
  const [showErrors, setShowErrors] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const typeSelectRef = useRef<HTMLSelectElement>(null);
  const typeInputRef = useRef<HTMLInputElement>(null);
  const bonusRef = useRef<HTMLInputElement>(null);
  const minTradeRef = useRef<HTMLInputElement>(null);
  const expiryRef = useRef<HTMLInputElement>(null);
  const limitRef = useRef<HTMLInputElement>(null);
  const restrictRef = useRef<HTMLSelectElement>(null);
  const termsRef = useRef<HTMLSelectElement>(null);

  const creating = mode === 'create';
  const brands = snapshot.brands;
  const names = useMemo(() => brandNames(brands), [brands]);
  const check = useMemo(
    () => checkForm(form, { mode, today, base: baseRow, coupons: snapshot.coupons, brands }),
    [form, mode, today, baseRow, snapshot.coupons, brands],
  );
  const errors = showErrors ? check.errors : {};
  const dirty = isFormDirty(form, creating ? EMPTY_FORM : base);
  const handle = baseRow?.code || 'this coupon';

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = <K extends keyof CouponForm>(field: K, value: CouponForm[K]) => {
    setForm((current) => (current[field] === value ? current : { ...current, [field]: value }));
  };

  const focusField = (field: FormField) => {
    const target: HTMLElement | null = {
      code: codeRef.current,
      type: typeSelectRef.current ?? typeInputRef.current,
      bonus: bonusRef.current,
      minTrade: minTradeRef.current,
      expiry: expiryRef.current,
      limit: limitRef.current,
      restrictTo: restrictRef.current,
      terms: termsRef.current,
    }[field];
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center' });
  };

  const requestClose = useCallback(async () => {
    if (busyRef.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    const decision = await confirm(discardConfirm(creating, handle));
    if (decision && aliveRef.current) onClose();
  }, [confirm, creating, dirty, handle, onClose]);

  const settle = (outcome: MutationOutcome, success: string) => {
    switch (outcome.kind) {
      case 'done':
        if (outcome.result.coupon) applyCoupon(outcome.result.coupon);
        refreshList();
        notify(outcome.result.changed ? success : 'Nothing changed. These values were already live.', 'success');
        if (outcome.result.warning) notify(outcome.result.warning, 'warning');
        onClose();
        return;
      case 'unknown':
        notify(outcome.message, 'error');
        refreshList();
        return;
      case 'stale':
        notify(outcome.message, 'warning');
        if (outcome.latest) applyCoupon(outcome.latest);
        refreshList();
        return;
      case 'refused':
        notify(outcome.message, 'error');
        router.refresh();
        return;
      case 'expired':
        return;
    }
  };

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (busyRef.current) return;
    const invalid = firstError(check.errors);
    if (invalid || !check.values) {
      setShowErrors(true);
      if (invalid) focusField(invalid);
      return;
    }
    busyRef.current = true;
    setReviewing(true);
    let sent = false;
    let settled = false;
    try {
      const fresh = await readFresh();
      if (!fresh || !aliveRef.current) return;

      if (creating) {
        const recheck = checkForm(form, { mode, today, base: null, coupons: fresh.coupons, brands: fresh.brands });
        const values = recheck.values;
        if (!values) {
          setShowErrors(true);
          const field = firstError(recheck.errors);
          if (field) focusField(field);
          return;
        }
        const decision = await confirm<MutationOutcome>({
          ...createConfirm(values, brandAvailable(values.type, fresh.brands)),
          returnFocusTo: () => formRef.current,
          action: async ({ reason }) => {
            sent = true;
            const attempt = classifyMutation(await apiRequest('/api/coupons', {
              method: 'POST',
              body: createRequestBody(values, reason),
              select: toMutationResult,
            }));
            if (attempt.kind === 'retry') throw new Error(attempt.message);
            settled = true;
            return attempt;
          },
        });
        if (decision?.value) settle(decision.value, `Coupon ${values.code} created.`);
        return;
      }

      if (!baseRow) return;
      const live = fresh.coupons.find((row) => row.id === baseRow.id);
      if (!live) {
        notify(`${baseRow.code} was deleted while you were editing, so nothing was saved.`, 'warning');
        onClose();
        return;
      }
      const serverForm = formFor(live);
      const rebased = rebaseForm(base, form, serverForm);
      setBase(serverForm);
      setBaseRow(live);
      setForm(rebased.form);
      const recheck = checkForm(rebased.form, { mode, today, base: live, coupons: fresh.coupons, brands: fresh.brands });
      if (!recheck.values) {
        setShowErrors(true);
        notify(
          rebased.changedElsewhere
            ? 'Another admin changed this coupon while you were editing. Check the highlighted field.'
            : 'Check the highlighted field before saving.',
          'warning',
        );
        const field = firstError(recheck.errors);
        if (field) focusField(field);
        return;
      }
      const proposal = proposeEdit(live, rebased.form, recheck.values);
      if (proposal.changes.length === 0) {
        notify('Nothing to save. These values are already live.');
        return;
      }
      const decision = await confirm<MutationOutcome>({
        ...editConfirm(proposal, rebased.changedElsewhere ? rebased : null, brandAvailable(recheck.values.type, fresh.brands)),
        returnFocusTo: () => formRef.current,
        action: async ({ reason }) => {
          sent = true;
          const attempt = classifyMutation(await apiRequest('/api/coupons', {
            method: 'PATCH',
            body: editRequestBody(proposal, reason),
            select: toMutationResult,
          }));
          if (attempt.kind === 'retry') throw new Error(attempt.message);
          settled = true;
          return attempt;
        },
      });
      if (decision?.value) settle(decision.value, `Saved changes to ${live.code}.`);
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setReviewing(false);
      if (sent && !settled) refreshList();
    }
  };

  const status = baseRow ? couponStatus(baseRow, today, brands) : null;
  const typeMatch = brands ? findBrand(form.type, names) : null;
  const typeExtra = brands !== null && form.type.trim() !== '' && typeMatch === null;
  const restrictMatch = brands ? findBrand(form.restrictTo, names) : null;
  const restrictExtra = form.restrictTo.trim() !== '' && restrictMatch === null;
  const limitHelp = !baseRow
    ? 'Total redemptions across all users. Leave empty for no limit.'
    : baseRow.uses === 0
      ? 'Total redemptions across all users. Not used yet. Leave empty for no limit.'
      : `Total redemptions across all users. Used ${plural(baseRow.uses, 'time', 'times')} so far. Leave empty for no limit.`;
  const termOptions = snapshot.terms ?? [];
  const termExtra = form.terms.trim() !== '' && !termOptions.includes(form.terms.trim());
  const awaiting = baseRow ? awaitingLine(baseRow) : null;

  return (
    <SidePanel
      open
      wide
      onClose={() => void requestClose()}
      title={creating ? 'New coupon' : `Edit ${handle}`}
      subtitle={
        creating
          ? 'Users see it on the Coupons screen of the app as soon as it is live.'
          : baseRow && status
            ? `${baseRow.type || 'No brand'} · ${status.label} · ${usedText(baseRow.uses)}`
            : undefined
      }
      returnFocusTo={returnFocusTo}
      footer={
        <div className={s.panelFooter}>
          <Button type="button" variant="ghost" disabled={reviewing} onClick={() => void requestClose()}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={reviewing} disabled={!creating && !dirty}>
            {creating ? 'Review and create' : 'Review changes'}
          </Button>
        </div>
      }
    >
      <form
        ref={formRef}
        id={formId}
        className={s.form}
        tabIndex={-1}
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        {status && status.state !== 'live' ? (
          <Notice tone={status.state === 'disabled' ? 'neutral' : 'warning'} compact flush>
            {status.hint}
          </Notice>
        ) : null}
        {awaiting ? (
          <Notice tone="info" compact flush>
            {awaiting}. They keep the bonus they were given when submitted, unless the code is renamed or the limit is lowered.
          </Notice>
        ) : null}

        <section className={s.formSection}>
          <h3 className={s.formHeading}>Code and brand</h3>
          <div className={s.fieldGrid}>
            <FieldShell
              label="Code"
              required
              error={errors.code}
              help={`3–${CODE_MAX} capital letters, numbers, hyphens or underscores. Users type it in the app.`}
            >
              <Input
                ref={codeRef}
                mono
                value={form.code}
                maxLength={CODE_MAX}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="WELCOME10"
                readOnly={reviewing}
                onChange={(event) => update('code', event.target.value.toUpperCase())}
              />
            </FieldShell>
            <FieldShell
              label="Brand"
              required
              error={errors.type}
              help={
                brands
                  ? 'The coupon only applies to trades of this brand.'
                  : 'The brand list could not be loaded. Type the brand exactly as it is listed in Cards.'
              }
            >
              {brands ? (
                <Select
                  ref={typeSelectRef}
                  value={typeMatch ?? form.type}
                  disabled={reviewing}
                  onChange={(event) => update('type', event.target.value)}
                >
                  {form.type.trim() === '' ? <option value="">Choose a brand</option> : null}
                  {typeExtra ? <option value={form.type}>{form.type} (not an active brand)</option> : null}
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.name}>{brand.name}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  ref={typeInputRef}
                  value={form.type}
                  maxLength={TYPE_MAX}
                  autoComplete="off"
                  readOnly={reviewing}
                  onChange={(event) => update('type', event.target.value)}
                />
              )}
            </FieldShell>
          </div>
        </section>

        <section className={s.formSection}>
          <h3 className={s.formHeading}>Reward</h3>
          <div className={s.fieldGrid}>
            <FieldShell
              label="Bonus per trade (₦)"
              required
              error={errors.bonus}
              help="Added to the payout when the trade is approved. Each user can use a coupon once."
            >
              <Input
                ref={bonusRef}
                mono
                inputMode="decimal"
                autoComplete="off"
                value={form.bonus}
                placeholder="1000"
                readOnly={reviewing}
                onChange={(event) => update('bonus', event.target.value)}
              />
            </FieldShell>
            <FieldShell
              label="Minimum card value"
              error={errors.minTrade}
              help="Checked against the card’s face value in its own currency; the app shows it in dollars. Leave empty for no minimum."
            >
              <Input
                ref={minTradeRef}
                mono
                inputMode="decimal"
                autoComplete="off"
                value={form.minTrade}
                placeholder="50"
                readOnly={reviewing}
                onChange={(event) => update('minTrade', event.target.value)}
              />
            </FieldShell>
          </div>
        </section>

        <section className={s.formSection}>
          <h3 className={s.formHeading}>Limits</h3>
          <div className={s.fieldGrid}>
            <FieldShell
              label="Expiry date"
              error={errors.expiry}
              help="Users can apply it until the end of this day (WAT). Leave empty to keep it running until it is switched off."
            >
              <Input
                ref={expiryRef}
                type="date"
                min={today}
                value={form.expiry}
                readOnly={reviewing}
                onChange={(event) => update('expiry', event.target.value)}
              />
            </FieldShell>
            <FieldShell
              label="Usage limit"
              error={errors.limit}
              help={limitHelp}
            >
              <Input
                ref={limitRef}
                mono
                inputMode="numeric"
                autoComplete="off"
                value={form.limit}
                placeholder="No limit"
                readOnly={reviewing}
                onChange={(event) => update('limit', event.target.value)}
              />
            </FieldShell>
          </div>
        </section>

        <section className={s.formSection}>
          <h3 className={s.formHeading}>Eligibility and terms</h3>
          <div className={s.fieldGrid}>
            <FieldShell
              label="Who can use it"
              error={errors.restrictTo}
              help="Optionally require at least one approved trade of a brand before the coupon works."
            >
              <Select
                ref={restrictRef}
                value={restrictMatch ?? form.restrictTo}
                disabled={reviewing}
                onChange={(event) => update('restrictTo', event.target.value)}
              >
                <option value="">Anyone</option>
                {restrictExtra ? (
                  <option value={form.restrictTo}>
                    {brands ? `Has traded ${form.restrictTo} (not an active brand)` : `Has traded ${form.restrictTo}`}
                  </option>
                ) : null}
                {(brands ?? []).map((brand) => (
                  <option key={brand.id} value={brand.name}>Has an approved {brand.name} trade</option>
                ))}
              </Select>
            </FieldShell>
            <FieldShell
              label="Terms of use"
              error={errors.terms}
              help={
                snapshot.terms === null
                  ? 'The terms of use list could not be loaded, so only the current terms can be kept.'
                  : 'Shown to users on the coupon in the app. Super administrators manage this list.'
              }
            >
              <Select
                ref={termsRef}
                value={form.terms.trim()}
                disabled={reviewing}
                onChange={(event) => update('terms', event.target.value)}
              >
                <option value="">None</option>
                {termExtra ? <option value={form.terms.trim()}>Current: {termLabel(form.terms.trim())}</option> : null}
                {termOptions.map((term) => (
                  <option key={term} value={term}>{termLabel(term)}</option>
                ))}
              </Select>
            </FieldShell>
          </div>
        </section>

        <section className={s.formSection}>
          <h3 className={s.formHeading}>Status</h3>
          <div className={s.toggleRow}>
            <Toggle
              checked={form.active}
              label={form.active ? 'Live' : 'Disabled'}
              disabled={reviewing}
              onChange={(next) => update('active', next)}
            />
            <span className={s.toggleHint}>
              {form.active
                ? creating
                  ? 'Users can apply it as soon as it is created.'
                  : 'Users can see it in the app and apply it.'
                : 'Switched off. Users cannot see it in the app or apply it.'}
            </span>
          </div>
        </section>

        {check.warnings.length ? (
          <Notice tone="warning" compact flush announce="polite">
            {check.warnings.length === 1 ? (
              check.warnings[0]
            ) : (
              <ul className={s.noticeList}>
                {check.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
          </Notice>
        ) : null}
      </form>
    </SidePanel>
  );
}
