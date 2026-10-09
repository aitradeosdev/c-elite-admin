import type { ConfirmDetail, ConfirmOptions } from '../../_ui';
import { formatCount, moveNote, type SettingKey, type SettingReading } from './referralRules';
import { unsavedText, type SaveOutcome, type SettingChange } from './model';
import { DiffValue } from './ReferralParts';

const SAVE_MESSAGE =
  'These settings decide who earns a referral bonus and how much. They apply as soon as you save, and the change is recorded in the audit log.';
const APP_REFRESH = 'The app shows the new referrer bonus after it reloads its settings, usually within a few minutes.';
const MONO_KEYS: ReadonlySet<SettingKey> = new Set([
  'referral_referrer_bonus', 'referral_referee_bonus', 'referral_min_trade_usd', 'referral_max_per_day',
]);

function amountOf(reading: SettingReading): number | null {
  return typeof reading.effective === 'number' ? reading.effective : null;
}

function fromPhrase(change: SettingChange): string {
  if (change.fromReading.effective !== null) return change.fromText;
  return change.fromReading.issue?.level === 'danger' ? 'an unreadable value' : 'no saved value';
}

export function changeConsequence(change: SettingChange): string {
  switch (change.key) {
    case 'referral_active':
      return change.toReading.effective === true
        ? 'Sign-ups that use a referral code are recorded as referrals again, each with the bonus amounts in force when the user signs up.'
        : 'Sign-ups that use a referral code are no longer recorded as referrals, so they earn no bonus. Referrals already recorded still unlock after a qualifying trade, and users can still claim them.';
    case 'referral_referrer_bonus':
    case 'referral_referee_bonus': {
      const who = change.key === 'referral_referrer_bonus' ? 'referrer' : 'referred user';
      return `Referrals recorded from now on pay the ${who} ${change.toText} instead of ${fromPhrase(change)}. Referrals already recorded keep the amount in force when the referred user signed up.${moveNote(amountOf(change.fromReading), amountOf(change.toReading))}`;
    }
    case 'referral_min_trade_usd':
      return `Referred users who have not unlocked their bonuses yet need a card trade approved with a card value of at least ${change.toText} in the card’s own currency, instead of ${fromPhrase(change)}. Trades approved before the change are not checked again.`;
    case 'referral_max_per_day':
      return `A referrer can earn from at most ${change.toText} in any 24 hours, instead of ${fromPhrase(change)}. Further sign-ups in that window still create an account but no referral.`;
  }
}

function conflictLine(change: SettingChange): string {
  return `Someone else changed ${change.label.toLowerCase()} to ${change.fromText} after you started editing. Saving sets it to ${change.toText}.`;
}

export function reviewConsequences(changes: readonly SettingChange[], notes: readonly string[]): string[] {
  const lines = [
    ...changes.filter((change) => change.conflict).map(conflictLine),
    ...changes.map(changeConsequence),
    ...notes,
  ];
  if (changes.some((change) => change.key === 'referral_referrer_bonus')) lines.push(APP_REFRESH);
  return lines;
}

export function reviewOptions(changes: readonly SettingChange[], notes: readonly string[]): ConfirmOptions<SaveOutcome> {
  const total = changes.length;
  return {
    tone: 'financial',
    title: total === 1 ? 'Save 1 change to the referral programme?' : `Save ${formatCount(total)} changes to the referral programme?`,
    message: SAVE_MESSAGE,
    details: changes.map((change): ConfirmDetail => ({
      label: change.label,
      value: <DiffValue from={change.fromText} to={change.toText} mono={MONO_KEYS.has(change.key)} />,
      emphasis: change.key === 'referral_referrer_bonus' || change.key === 'referral_referee_bonus',
    })),
    consequences: reviewConsequences(changes, notes),
    confirmLabel: total === 1 ? 'Save change' : `Save ${formatCount(total)} changes`,
    cancelLabel: 'Keep editing',
    pendingLabel: total === 1 ? 'Saving the change…' : `Saving ${formatCount(total)} changes…`,
  };
}

export function discardOptions(total: number): ConfirmOptions {
  return {
    title: total === 1 ? 'Discard 1 unsaved change?' : `Discard ${formatCount(total)} unsaved changes?`,
    message: 'The referral settings go back to their live values. Nothing has been saved, so nothing changes for users.',
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
  };
}

export function leaveOptions(total: number): ConfirmOptions {
  return {
    tone: 'danger',
    title: 'Leave without saving?',
    message: `You have ${unsavedText(total)} on this page. Leaving discards ${total === 1 ? 'it' : 'them'}, and nothing changes for users.`,
    confirmLabel: 'Discard and leave',
    cancelLabel: 'Keep editing',
  };
}
