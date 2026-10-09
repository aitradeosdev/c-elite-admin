import { Money, Notice, type ConfirmDetail, type ConfirmOptions } from '../../_ui';
import { formatNaira } from '../../_ui/money';
import { formatBusinessDateTime } from '../../lib/time';
import { LARGE_BONUS, REASON_MAX, formatCount, formatDateKey, plural } from './couponRules';
import {
  FIELD_LABELS, awaitingLosing, awaitingText, couponStatus, expiryText, limitText, minTradeText, remainingLiability,
  restrictText, usesText,
  type Brand, type CouponDraftValues, type CouponProposal, type CouponRow, type FormKey, type RebaseResult,
  type TermsChange,
} from './model';
import { Change, MoneyChange, TermsDiff } from './CouponParts';
import s from './page.module.css';

export type ConfirmBase = Omit<ConfirmOptions, 'action'>;

const AUDIT_NOTE = { label: 'Note for the audit log (optional)', maxLength: REASON_MAX };

const DISABLE_REASONS = ['Promotion ended', 'Code is being misused', 'Created by mistake', 'Paused for review'];

const DELETE_REASONS = ['Created by mistake', 'Duplicate coupon', 'Test coupon', 'Promotion cancelled before launch'];

const TERMS_PREVIEW = 80;

function preview(text: string | null): string {
  if (!text) return 'None';
  return text.length > TERMS_PREVIEW ? `${text.slice(0, TERMS_PREVIEW - 1).trimEnd()}…` : text;
}

function activeText(active: boolean): string {
  return active ? 'Live' : 'Disabled';
}

function largeBonusLine(bonus: number): string {
  return `${formatNaira(bonus)} per trade is a large bonus. Check it is not a typo.`;
}

function missingBrandLine(type: string): string {
  return `No active card brand is named “${type}”, so no trade can use this coupon until one is.`;
}

export function createConfirm(values: CouponDraftValues, brandOk: boolean | null): ConfirmBase {
  const details: ConfirmDetail[] = [
    { label: 'Code', value: values.code, mono: true },
    { label: 'Brand', value: values.type },
    { label: 'Bonus per trade', value: <Money value={values.bonus} emphasis="strong" />, emphasis: true },
    { label: 'Minimum card value', value: minTradeText(values.minTrade) },
    { label: 'Usage limit', value: limitText(values.limit) },
    { label: 'Expires', value: expiryText(values.expiry) },
    { label: 'Who can use it', value: restrictText(values.restrictTo) },
    { label: 'Terms of use', value: preview(values.terms) },
    { label: 'Status', value: values.active ? 'Live as soon as it is created' : 'Created switched off' },
  ];
  const consequences: string[] = [];
  if (values.active) {
    consequences.push('It shows on the Coupons screen of the user app straight away, where any user can copy the code.');
    consequences.push(
      `Each qualifying ${values.type} trade gets ${formatNaira(values.bonus)} added to its payout when the trade is approved. Each user can use it once.`,
    );
  } else {
    consequences.push('Users cannot see or apply it until someone switches it on.');
  }
  const total = remainingLiability(values.bonus, values.limit, 0);
  consequences.push(
    total === null
      ? 'There is no usage limit, so every user can use it once until it expires or is switched off.'
      : `At most ${formatNaira(total)} in bonuses: ${limitText(values.limit)} at ${formatNaira(values.bonus)} each.`,
  );
  if (values.expiry === null) consequences.push('It has no expiry date, so it keeps running until someone switches it off.');
  if (values.bonus >= LARGE_BONUS) consequences.push(largeBonusLine(values.bonus));
  if (brandOk === false) consequences.push(missingBrandLine(values.type));
  return {
    tone: 'financial',
    title: `Create coupon ${values.code}?`,
    message: values.active
      ? 'Users can apply it as soon as it is created. The new coupon is recorded in the audit log.'
      : 'It is created switched off. The new coupon is recorded in the audit log.',
    details,
    consequences,
    reason: { ...AUDIT_NOTE, placeholder: 'For example: Black Friday promotion' },
    confirmLabel: 'Create coupon',
    cancelLabel: 'Keep editing',
    pendingLabel: 'Creating the coupon…',
  };
}

function changeDetail(key: FormKey, live: CouponRow, values: CouponDraftValues): ConfirmDetail {
  const label = FIELD_LABELS[key];
  switch (key) {
    case 'code':
      return { label, value: <Change before={live.code || '—'} after={values.code} mono /> };
    case 'type':
      return { label, value: <Change before={live.type || 'None'} after={values.type} /> };
    case 'bonus':
      return { label, value: <MoneyChange before={live.bonus} after={values.bonus} />, emphasis: true };
    case 'minTrade':
      return { label, value: <Change before={minTradeText(live.minTrade)} after={minTradeText(values.minTrade)} /> };
    case 'expiry':
      return { label, value: <Change before={expiryText(live.expiry)} after={expiryText(values.expiry)} /> };
    case 'limit':
      return { label, value: <Change before={limitText(live.limit)} after={limitText(values.limit)} /> };
    case 'active':
      return { label, value: <Change before={activeText(live.active)} after={activeText(values.active)} /> };
    case 'restrictTo':
      return { label, value: <Change before={restrictText(live.restrictTo)} after={restrictText(values.restrictTo)} /> };
    case 'terms':
      return { label, value: <Change before={preview(live.terms)} after={preview(values.terms)} /> };
  }
}

export function editConsequences(proposal: CouponProposal, brandOk: boolean | null): string[] {
  const { live, values, changes } = proposal;
  const has = (key: FormKey) => changes.includes(key);
  const awaiting = live.awaitingTrades;
  const lines: string[] = [];

  if (has('bonus')) {
    const kept = awaiting && awaiting > 0
      ? ` The ${plural(awaiting, 'trade', 'trades')} awaiting review keep the bonus ${awaiting === 1 ? 'it was' : 'they were'} given when submitted.`
      : ' Trades already submitted keep the bonus they were given when submitted.';
    lines.push(`New trades get ${formatNaira(values.bonus)} instead of ${formatNaira(live.bonus)}.${kept}`);
  }
  if (has('code')) {
    lines.push(`Users must type ${values.code} from now on. ${live.code} stops working, including for users who already copied it.`);
    if (awaiting && awaiting > 0) {
      lines.push(
        `${plural(awaiting, 'trade awaiting review used', 'trades awaiting review used')} ${live.code}. After the rename ${awaiting === 1 ? 'it gets' : 'they get'} no bonus when approved, so ${formatNaira(live.awaitingBonus ?? 0)} is not paid.`,
      );
    } else if (awaiting === null) {
      lines.push(`Trades awaiting review that used ${live.code} get no bonus when approved, because approval looks the coupon up by its code.`);
    }
  }
  if (has('limit')) {
    if (values.limit !== null && values.limit <= live.uses) {
      lines.push(`The limit is at or below the ${plural(live.uses, 'use', 'uses')} so far, so nobody else can apply it.`);
    }
    const losing = awaitingLosing(live, values.limit);
    if (losing > 0) {
      lines.push(
        `${plural(losing, 'trade awaiting review goes', 'trades awaiting review go')} over the new limit and ${losing === 1 ? 'gets' : 'get'} no bonus when approved.`,
      );
    }
    const total = remainingLiability(values.bonus, values.limit, live.uses);
    lines.push(
      total === null
        ? 'With no usage limit, every user can use it once.'
        : `At most ${formatNaira(total)} more in bonuses from new redemptions.`,
    );
  }
  if (has('expiry')) {
    lines.push(
      values.expiry === null
        ? 'It no longer expires, so it runs until someone switches it off.'
        : `Users can apply it until the end of ${formatDateKey(values.expiry)} (WAT).`,
    );
  }
  if (has('active')) {
    lines.push(
      values.active
        ? 'It shows on the Coupons screen of the user app and users can apply it straight away.'
        : 'Users can no longer see it in the app or apply it to new trades. Trades already submitted with it still get their bonus when approved.',
    );
  }
  if (has('type') || has('minTrade') || has('restrictTo')) {
    lines.push('The new brand, minimum and eligibility apply to new trades only.');
  }
  if (has('terms')) lines.push('Users see the new terms of use on the coupon in the app.');
  if (has('bonus') && values.bonus >= LARGE_BONUS) lines.push(largeBonusLine(values.bonus));
  if ((has('type') || has('active')) && values.active && brandOk === false) lines.push(missingBrandLine(values.type));
  return lines;
}

export function editConfirm(proposal: CouponProposal, rebased: RebaseResult | null, brandOk: boolean | null): ConfirmBase {
  const { live, values, changes } = proposal;
  const details: ConfirmDetail[] = [
    { label: 'Coupon', value: live.code || '—', mono: true },
    ...changes.map((key) => changeDetail(key, live, values)),
  ];
  const consequences = editConsequences(proposal, brandOk);
  const conflictText = rebased ? rebased.conflicts.map((key) => FIELD_LABELS[key].toLowerCase()) : [];
  return {
    tone: changes.some((key) => key !== 'terms') ? 'financial' : 'default',
    title: `Save changes to ${live.code}?`,
    message: (
      <div className={s.confirmBody}>
        {rebased?.changedElsewhere ? (
          <Notice tone="warning" compact flush title="Changed while you were editing">
            Another admin changed this coupon. Their changes are kept and yours are applied on top
            {conflictText.length ? `; you both changed the ${conflictText.join(' and ')}, and yours wins` : ''}.
          </Notice>
        ) : null}
        <p className={s.confirmLead}>
          Only the {changes.length === 1 ? 'value' : `${formatCount(changes.length)} values`} below change. Every change is recorded in the audit log.
        </p>
      </div>
    ),
    details,
    consequences: consequences.length ? consequences : undefined,
    reason: { ...AUDIT_NOTE, placeholder: 'Why is this changing?' },
    confirmLabel: 'Save changes',
    cancelLabel: 'Keep editing',
    pendingLabel: 'Saving the changes…',
  };
}

export function toggleConfirm(live: CouponRow, next: boolean, today: string, brands: readonly Brand[] | null): ConfirmBase {
  const before = couponStatus(live, today, brands);
  const after = couponStatus({ ...live, active: next }, today, brands);
  const awaiting = live.awaitingTrades;
  const details: ConfirmDetail[] = [
    { label: 'Coupon', value: live.code || '—', mono: true },
    { label: 'Status', value: <Change before={before.label} after={after.label} />, emphasis: true },
    { label: 'Brand', value: live.type || 'None' },
    { label: 'Bonus per trade', value: <Money value={live.bonus} emphasis="strong" /> },
    { label: 'Used so far', value: usesText(live) },
    { label: 'Awaiting review', value: awaitingText(awaiting, live.awaitingBonus) },
  ];
  const consequences: string[] = [];
  if (!next) {
    consequences.push('Users can no longer see it in the app or apply it to new trades.');
    if (awaiting && awaiting > 0) {
      consequences.push(
        `The ${plural(awaiting, 'trade', 'trades')} awaiting review with it still ${awaiting === 1 ? 'gets its' : 'get their'} bonus when approved: ${formatNaira(live.awaitingBonus ?? 0)} in total.`,
      );
    } else {
      consequences.push('Trades already submitted with it still get their bonus when approved.');
    }
    consequences.push('You can switch it back on at any time.');
  } else {
    switch (after.state) {
      case 'live':
        consequences.push('It shows on the Coupons screen of the user app straight away, and users can apply it.');
        consequences.push(`Each qualifying trade gets ${formatNaira(live.bonus)} added to its payout when the trade is approved.`);
        break;
      case 'expired':
        consequences.push(`It expired on ${formatDateKey(live.expiry)}, so users still cannot apply it. Edit the expiry date to bring it back.`);
        break;
      case 'used_up':
        consequences.push(`It has reached its limit of ${limitText(live.limit)}, so users still cannot apply it. Raise the limit to bring it back.`);
        break;
      case 'no_brand':
        consequences.push(missingBrandLine(live.type));
        break;
      default:
        break;
    }
    const total = remainingLiability(live.bonus, live.limit, live.uses);
    if (after.state !== 'expired' && after.state !== 'used_up') {
      consequences.push(
        total === null
          ? 'There is no usage limit, so every user can use it once.'
          : `At most ${formatNaira(total)} more in bonuses from new redemptions.`,
      );
    }
  }
  return {
    tone: next ? 'financial' : 'default',
    title: next ? `Switch ${live.code} on?` : `Switch ${live.code} off?`,
    message: next
      ? 'The change is recorded in the audit log.'
      : 'Nothing is taken back from users who already used it. The change is recorded in the audit log.',
    details,
    consequences,
    reason: next
      ? { ...AUDIT_NOTE, placeholder: 'Why is it being switched on?' }
      : { ...AUDIT_NOTE, label: 'Reason (optional)', presets: DISABLE_REASONS },
    confirmLabel: next ? 'Enable coupon' : 'Disable coupon',
    cancelLabel: 'Cancel',
    pendingLabel: next ? 'Switching the coupon on…' : 'Switching the coupon off…',
  };
}

export function deleteConfirm(live: CouponRow): ConfirmBase {
  const awaitingKnown = live.awaitingTrades !== null;
  const consequences = [
    'This cannot be undone.',
    `The code ${live.code} becomes free to use for a new coupon.`,
    'Users who copied the code see “Invalid coupon code” if they try it.',
    'Its change history stays in the audit log.',
  ];
  if (!awaitingKnown) {
    consequences.push('Trades awaiting review could not be counted here; the server checks them and refuses if any used this code.');
  }
  return {
    tone: 'danger',
    title: `Delete coupon ${live.code}?`,
    message: (
      <p className={s.confirmLead}>
        The coupon is removed for good. Nobody has used it{awaitingKnown ? ' and no trades are waiting with it' : ''}, so no user
        loses a bonus.
      </p>
    ),
    details: [
      { label: 'Code', value: live.code || '—', mono: true },
      { label: 'Brand', value: live.type || 'None' },
      { label: 'Bonus per trade', value: <Money value={live.bonus} /> },
      { label: 'Status', value: <Change before={activeText(live.active)} after="Deleted" /> },
      { label: 'Created', value: live.createdAt ? `${formatBusinessDateTime(live.createdAt)} WAT` : 'Unknown' },
    ],
    consequences,
    reason: { required: true, label: 'Reason for deleting', presets: DELETE_REASONS, maxLength: REASON_MAX },
    requireTyped: live.code || 'DELETE',
    confirmLabel: 'Delete coupon',
    cancelLabel: 'Keep coupon',
    pendingLabel: 'Deleting the coupon…',
  };
}

export function discardConfirm(creating: boolean, code: string): ConfirmBase {
  return {
    title: creating ? 'Discard this new coupon?' : `Discard changes to ${code}?`,
    message: creating
      ? 'Nothing has been created, so users see no change.'
      : 'Nothing has been saved, so the coupon stays exactly as it is.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
  };
}

export function termsConfirm(
  change: TermsChange,
  total: number,
  changedElsewhere: boolean,
  inUse: (term: string) => number,
): ConfirmBase {
  const stillShown = change.removed.reduce((sum, term) => sum + inUse(term), 0);
  const consequences = ['Users only see a term once a coupon uses it.'];
  if (change.added.length) consequences.unshift('New terms can be picked when creating or editing a coupon.');
  if (change.removed.length) {
    consequences.push('Removed terms are only no longer offered here; coupons that already use them keep them.');
  }
  if (stillShown > 0) {
    consequences.push(`${plural(stillShown, 'coupon still shows', 'coupons still show')} a removed term to users until edited.`);
  }
  return {
    title: 'Save the terms of use list?',
    message: (
      <div className={s.confirmBody}>
        {changedElsewhere ? (
          <Notice tone="warning" compact flush title="Changed while you were editing">
            Another super administrator changed the list. Their changes are kept and yours are applied on top.
          </Notice>
        ) : null}
        <TermsDiff change={change} />
      </div>
    ),
    details: [{ label: 'Terms after saving', value: formatCount(total) }],
    consequences,
    confirmLabel: 'Save list',
    cancelLabel: 'Keep editing',
    pendingLabel: 'Saving the list…',
  };
}

export function termsDiscardConfirm(): ConfirmBase {
  return {
    title: 'Discard changes to the list?',
    message: 'Nothing has been saved, so the terms of use list stays exactly as it is.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
  };
}
