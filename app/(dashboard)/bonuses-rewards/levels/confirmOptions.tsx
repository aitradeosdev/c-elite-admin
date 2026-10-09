import type { ConfirmDetail, ConfirmOptions } from '../../../_ui';
import { formatCount, formatUsd, isHugeMove, isLargeMove, toAmount, type TierValues } from '../rewardRules';
import { BadgeDiff, DiffValue } from '../RewardParts';
import { TIER_FIELD_LABELS, fieldValueText, type TierChange, type TierFieldChange } from './model';

function moveNote(from: unknown, to: unknown): string {
  const before = toAmount(from);
  const after = toAmount(to);
  if (isHugeMove(before, after)) return ' That is a tenfold change or more: check it is not a typo.';
  if (isLargeMove(before, after)) return ' Check this is not a typo.';
  return '';
}

function fieldConsequence(change: TierChange, field: TierFieldChange): string | null {
  const title = change.title;
  switch (field.field) {
    case 'bonus':
      return `${title}: users who claim it from now on get ${fieldValueText('bonus', field.to)} instead of ${fieldValueText('bonus', field.from)}. Bonuses already claimed do not change.${moveNote(field.from, field.to)}`;
    case 'target': {
      const before = toAmount(field.from);
      const after = toAmount(field.to);
      if (before !== null && after !== null && after < before) {
        return `${title}: users working on it who have already traded ${formatUsd(after)} or more since reaching it can claim straight away.${moveNote(before, after)}`;
      }
      return `${title}: users working on it now need ${fieldValueText('target', field.to)} of approved trades since reaching it, instead of ${fieldValueText('target', field.from)}.${moveNote(before, after)}`;
    }
    case 'active':
      return field.to === true
        ? `${title} is switched on: users who reach it can claim it. Users already past it are not sent back to it.`
        : `${title} is switched off: users working on it cannot claim it or move past it until it is switched back on, and users below it skip it.`;
    case 'name':
      return `${title}: users see the new name in the app.`;
    case 'badge':
      return `${title}: users see the ${field.to ? 'new badge' : 'tier without a badge'} in the app.`;
    default:
      return null;
  }
}

function conflictNote(change: TierChange): string | null {
  if (!change.conflict) return null;
  const parts = change.fields
    .filter((field) => field.key in (change.conflict as Partial<TierValues>))
    .map((field) => `${TIER_FIELD_LABELS[field.field].toLowerCase()} to ${fieldValueText(field.field, (change.conflict as Partial<TierValues>)[field.key])}`);
  if (parts.length === 0) return null;
  return `Someone else changed ${change.title} (${parts.join(' and ')}) after you started editing. Saving replaces their values with yours.`;
}

function detailValue(change: TierChange, field: TierFieldChange) {
  if (field.field === 'badge') {
    return <BadgeDiff from={(field.from as string | null) ?? null} to={(field.to as string | null) ?? null} name={change.tier.values.name || change.title} />;
  }
  return (
    <DiffValue
      from={fieldValueText(field.field, field.from)}
      to={fieldValueText(field.field, field.to)}
      mono={field.field === 'target' || field.field === 'bonus'}
    />
  );
}

export function tierReviewOptions(changes: readonly TierChange[]): ConfirmOptions {
  const fieldCount = changes.reduce((total, change) => total + change.fields.length, 0);
  const money = changes.some((change) => change.fields.some((field) => field.field === 'bonus' || field.field === 'target' || field.field === 'active'));
  const details: ConfirmDetail[] = [];
  const consequences: string[] = [];
  for (const change of changes) {
    const conflict = conflictNote(change);
    if (conflict) consequences.push(conflict);
  }
  for (const change of changes) {
    for (const field of change.fields) {
      details.push({
        label: `${change.title} · ${TIER_FIELD_LABELS[field.field]}`,
        value: detailValue(change, field),
        emphasis: field.field === 'bonus',
      });
      const line = fieldConsequence(change, field);
      if (line) consequences.push(line);
    }
  }
  const tiers = changes.length;
  return {
    tone: money ? 'financial' : 'default',
    title: tiers === 1 ? `Save changes to ${changes[0].title}?` : `Save changes to ${formatCount(tiers)} tiers?`,
    message: 'Level bonuses are paid by the platform. The new values apply to claims from the moment you save, and every change is recorded in the audit log.',
    details,
    consequences: consequences.length > 0 ? consequences : undefined,
    confirmLabel: fieldCount === 1 ? 'Save change' : `Save ${formatCount(fieldCount)} changes`,
    cancelLabel: 'Keep editing',
    pendingLabel: tiers === 1 ? 'Saving the tier…' : `Saving ${formatCount(tiers)} tiers…`,
  };
}

export function tierDiscardOptions(total: number): ConfirmOptions {
  return {
    title: total === 1 ? 'Discard 1 unsaved change?' : `Discard ${formatCount(total)} unsaved changes?`,
    message: 'The tiers go back to their live values. Nothing has been saved, so nothing changes for users.',
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
  };
}
