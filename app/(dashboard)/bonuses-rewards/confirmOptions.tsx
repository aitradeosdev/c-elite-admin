import { Money, type ConfirmDetail, type ConfirmOptions } from '../../_ui';
import { formatNaira } from '../../_ui/money';
import { formatCount, isHugeMove, isLargeMove, plural, ruleImpact } from './rewardRules';
import {
  formatDay, rulesText, settingsConsequences, settingsMoveMoney,
  type GiftboxChange, type GiftboxDraftValues, type GiftboxItem, type SettingChange,
} from './model';
import { DiffValue, ListDiff, RuleLines } from './RewardParts';

const FEED_DELAY = 'The app’s gift box list refreshes within about five minutes.';

function moveNote(from: number | null, to: number | null): string {
  if (isHugeMove(from, to)) return ' That is a tenfold change or more: check it is not a typo.';
  if (isLargeMove(from, to)) return ' Check this is not a typo.';
  return '';
}

function rewardText(amount: number | null): string {
  return amount === null ? 'no amount' : formatNaira(amount);
}

function blockingNotes(rules: readonly unknown[]): string[] {
  const notes: string[] = [];
  for (const rule of rules) {
    const impact = ruleImpact(rule);
    if (impact.level === 'blocking' && impact.message) notes.push(`A rule stops every claim. ${impact.message}`);
  }
  return notes;
}

function uniqueLines(lines: ReadonlyArray<string | null>): string[] {
  const out: string[] = [];
  for (const line of lines) if (line && !out.includes(line)) out.push(line);
  return out;
}

export function availability(values: GiftboxDraftValues, today: string): string {
  if (!values.is_active) return 'It is switched off, so nobody can see or claim it until you switch it on.';
  if (values.expiry_date === null) {
    return 'It has no end date, so the app does not list it and users cannot see or claim it. Add an end date to make it claimable.';
  }
  if (values.expiry_date < today) return 'Its end date has passed, so users cannot claim it.';
  const who = values.eligibility_rules.length === 0 ? 'Every user' : 'Users who pass every rule';
  return `${who} can claim ${formatNaira(values.reward_naira)} once, credited to their bonus balance, until the end of ${formatDay(values.expiry_date)}. ${FEED_DELAY}`;
}

function claimableProblem(values: GiftboxDraftValues, today: string): string | null {
  if (!values.is_active) return null;
  if (values.expiry_date === null || values.expiry_date < today) return availability(values, today);
  return null;
}

export function settingsReviewOptions(changes: readonly SettingChange[]): ConfirmOptions {
  const total = changes.length;
  return {
    tone: settingsMoveMoney(changes) ? 'financial' : 'default',
    title: total === 1 ? 'Apply 1 change to the reward programme?' : `Apply ${formatCount(total)} changes to the reward programme?`,
    message: 'These are platform settings. The new values apply to every user as soon as you apply them, and the change is recorded in the audit log.',
    details: changes.map((change): ConfirmDetail => ({
      label: change.label,
      value: <DiffValue from={change.fromText} to={change.toText} mono={change.key === 'signup_bonus_amount'} />,
      emphasis: change.key === 'signup_bonus_amount',
    })),
    consequences: settingsConsequences(changes),
    confirmLabel: total === 1 ? 'Apply change' : `Apply ${formatCount(total)} changes`,
    cancelLabel: 'Keep editing',
    pendingLabel: total === 1 ? 'Applying the change…' : `Applying ${formatCount(total)} changes…`,
  };
}

export function discardOptions(total: number, what: string): ConfirmOptions {
  return {
    title: total === 1 ? 'Discard 1 unsaved change?' : `Discard ${formatCount(total)} unsaved changes?`,
    message: `${what} go back to their live values. Nothing has been saved, so nothing changes for users.`,
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
  };
}

export function leaveOptions(): ConfirmOptions {
  return {
    tone: 'danger',
    title: 'Leave without saving?',
    message: 'You have unsaved changes on this page. Leaving discards them, and nothing changes for users.',
    confirmLabel: 'Discard and leave',
    cancelLabel: 'Keep editing',
  };
}

export function discardEditorOptions(editing: boolean, title: string): ConfirmOptions {
  return {
    title: editing ? 'Discard your changes?' : 'Discard this new gift box?',
    message: editing
      ? `Your changes to “${title}” have not been saved. Closing discards them, and nothing changes for users.`
      : 'This gift box has not been created. Closing discards what you entered.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
  };
}

export function giftboxCreateOptions(values: GiftboxDraftValues, notes: readonly string[], today: string): ConfirmOptions {
  return {
    tone: 'financial',
    title: `Create “${values.title}”?`,
    message: 'Gift box rewards are paid by the platform. The new gift box is recorded in the audit log.',
    details: [
      { label: 'Reward', value: <Money value={values.reward_naira} emphasis="strong" />, emphasis: true },
      { label: 'End date', value: values.expiry_date ? formatDay(values.expiry_date) : 'No end date' },
      { label: 'Who can claim', value: <RuleLines lines={rulesText(values.eligibility_rules)} /> },
      { label: 'Status', value: values.is_active ? 'Live' : 'Off' },
    ],
    consequences: uniqueLines([availability(values, today), ...notes, ...blockingNotes(values.eligibility_rules)]),
    confirmLabel: 'Create gift box',
    cancelLabel: 'Go back',
    pendingLabel: 'Creating the gift box…',
  };
}

function changeConsequence(change: GiftboxChange, item: GiftboxItem, values: GiftboxDraftValues, today: string): string | null {
  switch (change.field) {
    case 'reward_naira':
      return `Claims from now on pay ${rewardText(values.reward_naira)} instead of ${rewardText(item.reward)}. Users who already claimed keep what they were paid.${moveNote(item.reward, values.reward_naira)}`;
    case 'is_active':
      return values.is_active
        ? availability(values, today)
        : 'Users can no longer see or claim it. Rewards already claimed stay with users.';
    case 'expiry_date':
      if (values.expiry_date === null) return 'Without an end date the app does not list it, so users cannot see or claim it.';
      if (values.expiry_date < today) return 'The new end date has already passed, so users cannot claim it.';
      return `Users can claim it until the end of ${formatDay(values.expiry_date)}.`;
    case 'eligibility_rules':
      return 'Who can claim changes from now on. Users who already claimed keep their reward.';
    case 'title':
      return `Users see the new title in the app. ${FEED_DELAY}`;
    case 'description':
      return `Users see the new description in the app. ${FEED_DELAY}`;
    default:
      return null;
  }
}

export function giftboxEditOptions(
  item: GiftboxItem,
  values: GiftboxDraftValues,
  changes: readonly GiftboxChange[],
  notes: readonly string[],
  today: string,
): ConfirmOptions {
  const total = changes.length;
  const fields = new Set(changes.map((change) => change.field));
  const money = fields.has('reward_naira') || fields.has('is_active') || fields.has('eligibility_rules') || fields.has('expiry_date');
  const statusExplained = fields.has('is_active') || fields.has('expiry_date');
  const consequences = uniqueLines([
    ...changes.map((change) => changeConsequence(change, item, values, today)),
    statusExplained ? null : claimableProblem(values, today),
    ...notes,
    ...blockingNotes(values.eligibility_rules),
  ]);
  return {
    tone: money ? 'financial' : 'default',
    title: total === 1 ? `Save 1 change to “${item.title}”?` : `Save ${formatCount(total)} changes to “${item.title}”?`,
    message: item.claims === null
      ? 'The change is recorded in the audit log.'
      : `It has been claimed ${plural(item.claims, 'time', 'times')} so far. The change is recorded in the audit log.`,
    details: changes.map((change): ConfirmDetail => ({
      label: change.label,
      value: change.fromList && change.toList
        ? <ListDiff from={change.fromList} to={change.toList} />
        : <DiffValue from={change.from} to={change.to} mono={change.field === 'reward_naira'} />,
      emphasis: change.field === 'reward_naira',
    })),
    consequences: consequences.length > 0 ? consequences : undefined,
    confirmLabel: total === 1 ? 'Save change' : `Save ${formatCount(total)} changes`,
    cancelLabel: 'Keep editing',
    pendingLabel: 'Saving the gift box…',
  };
}

export function giftboxToggleOptions(item: GiftboxItem, active: boolean, today: string): ConfirmOptions {
  const values: GiftboxDraftValues = {
    title: item.title,
    description: item.description,
    reward_naira: item.reward ?? 0,
    expiry_date: item.expiry,
    eligibility_condition: item.note,
    eligibility_rules: item.rules,
    is_active: active,
  };
  const details: ConfirmDetail[] = [
    { label: 'Status', value: <DiffValue from={item.active ? 'Live' : 'Off'} to={active ? 'Live' : 'Off'} />, emphasis: true },
    { label: 'Reward', value: <Money value={item.reward} /> },
    { label: 'End date', value: item.expiry ? formatDay(item.expiry) : 'No end date' },
    { label: 'Who can claim', value: <RuleLines lines={rulesText(item.rules)} /> },
    { label: 'Claimed so far', value: item.claims === null ? 'Unknown' : plural(item.claims, 'time', 'times') },
  ];
  if (active) {
    return {
      tone: 'financial',
      title: `Switch on “${item.title}”?`,
      message: 'Switching it on lets users claim this reward. The change is recorded in the audit log.',
      details,
      consequences: uniqueLines([availability(values, today), ...blockingNotes(item.rules)]),
      confirmLabel: 'Switch on',
      cancelLabel: 'Cancel',
      pendingLabel: 'Switching it on…',
    };
  }
  return {
    tone: 'danger',
    title: `Switch off “${item.title}”?`,
    message: 'Switching it off stops new claims straight away. The change is recorded in the audit log.',
    details,
    consequences: [
      'Users can no longer see or claim it. Rewards already claimed stay with users.',
      `You can switch it back on at any time. ${FEED_DELAY}`,
    ],
    confirmLabel: 'Switch off',
    cancelLabel: 'Keep it on',
    pendingLabel: 'Switching it off…',
  };
}
