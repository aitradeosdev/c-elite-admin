import { Money, formatPercent, type ConfirmDetail, type ConfirmOptions } from '../../_ui';
import { formatNaira } from '../../_ui/money';
import { HUGE_MOVE, LARGE_MOVE, isHugeMove, isLargeMove, rateMove, type RateValues } from './rateRules';
import {
  changeCountText, currencyAmount, detailLabels, groupTitle, nextUpdatePhrase, perUnit, unsavedText, updatesLive,
  type AddOutcome, type AddRangeTarget, type ExistingRange, type NewRangeValues, type PendingChange, type RatesAutomatic,
  type SaveOutcome,
} from './model';
import { RateDiff } from './RateParts';

const LISTED_MOVES = 3;

const SAVE_MESSAGE =
  'New card submissions are paid at these rates from the moment you save. Submissions already made keep the rate they were submitted at, unless a reviewer corrects the card at approval. Every change is recorded in the audit log.';

function rateText(rate: number | null): string {
  return rate === null ? 'no rate' : formatNaira(rate);
}

function liveText(values: RateValues): string {
  return values.active ? rateText(values.rate) : `${rateText(values.rate)} (switched off)`;
}

function moveSize(change: PendingChange): number {
  const move = rateMove(change.from.rate, change.to.rate);
  return move === null ? -1 : Math.abs(move);
}

function moveText(change: PendingChange): string {
  const move = rateMove(change.from.rate, change.to.rate);
  const span = `from ${rateText(change.from.rate)} to ${formatNaira(change.to.rate)}`;
  return move === null ? span : `${formatPercent(move, { signed: true })}, ${span}`;
}

function rangeCount(total: number): string {
  return total === 1 ? '1 range is' : `${total.toLocaleString('en-NG')} ranges are`;
}

export function reviewConsequences(
  changes: readonly PendingChange[],
  labels: ReadonlyMap<string, string> = detailLabels(changes),
): string[] {
  const labelOf = (change: PendingChange) => labels.get(change.id) ?? change.title;
  const lines: string[] = [];

  for (const change of changes) {
    if (!change.conflict) continue;
    lines.push(
      `Someone else changed ${labelOf(change)} to ${liveText(change.conflict)} after you started editing. Saving sets it to ${liveText(change.to)}.`,
    );
  }

  const large = changes.filter((change) => change.rateChanged && isLargeMove(change.from.rate, change.to.rate));
  if (large.length > 0 && large.length <= LISTED_MOVES) {
    for (const change of large) {
      const typo = isHugeMove(change.from.rate, change.to.rate) ? ' Check this is not a typo.' : '';
      lines.push(`${labelOf(change)} moves ${moveText(change)}.${typo}`);
    }
  } else if (large.length > LISTED_MOVES) {
    const biggest = [...large].sort((a, b) => moveSize(b) - moveSize(a))[0];
    const huge = large.filter((change) => isHugeMove(change.from.rate, change.to.rate)).length;
    const typo = huge > 0
      ? ` ${huge.toLocaleString('en-NG')} of them ${huge === 1 ? 'moves' : 'move'} by ${formatPercent(HUGE_MOVE, { decimals: 0 })} or more; check for typos.`
      : '';
    lines.push(
      `${large.length.toLocaleString('en-NG')} rates move by more than ${formatPercent(LARGE_MOVE, { decimals: 0 })}. The largest is ${labelOf(biggest)}, ${moveText(biggest)}.${typo}`,
    );
  }

  const off = changes.filter((change) => change.activeChanged && !change.to.active).length;
  if (off > 0) {
    lines.push(`${rangeCount(off)} switched off. The app stops offering ${off === 1 ? 'it' : 'them'} for new submissions.`);
  }
  const on = changes.filter((change) => change.activeChanged && change.to.active).length;
  if (on > 0) {
    lines.push(`${rangeCount(on)} switched on and ${on === 1 ? 'starts' : 'start'} paying new submissions immediately.`);
  }
  return lines;
}

export function automaticConsequences(
  changes: readonly PendingChange[],
  automatic?: RatesAutomatic | null,
  now?: number | null,
): string[] {
  if (!automatic || !automatic.enabled || typeof now !== 'number') return [];
  const phrase = nextUpdatePhrase(automatic, now);
  if (!phrase) return [];
  const linked = changes.filter((change) => updatesLive(automatic, change.row.path.typeId)).length;
  if (linked === 0) return [];
  const due = phrase.aside;
  if (changes.length === 1) {
    return [`This change is on a linked card type. The next automatic update, ${due}, replaces it with the rate provider’s rate.`];
  }
  return [linked === 1
    ? `1 of these changes is on a linked card type. The next automatic update, ${due}, replaces it with the rate provider’s rate.`
    : `${linked.toLocaleString('en-NG')} of these changes are on linked card types. The next automatic update, ${due}, replaces them with the rate provider’s rates.`];
}

export function reviewOptions(
  changes: readonly PendingChange[],
  automatic?: RatesAutomatic | null,
  now?: number | null,
): ConfirmOptions<SaveOutcome> {
  const labels = detailLabels(changes);
  const consequences = [...reviewConsequences(changes, labels), ...automaticConsequences(changes, automatic, now)];
  const total = changes.length;
  return {
    tone: 'financial',
    title: total === 1 ? 'Save 1 rate change?' : `Save ${total.toLocaleString('en-NG')} rate changes?`,
    message: SAVE_MESSAGE,
    details: changes.map((change): ConfirmDetail => ({
      label: labels.get(change.id) ?? change.title,
      value: <RateDiff change={change} />,
    })),
    consequences: consequences.length > 0 ? consequences : undefined,
    confirmLabel: total === 1 ? 'Save change' : `Save ${total.toLocaleString('en-NG')} changes`,
    cancelLabel: 'Keep editing',
    pendingLabel: `Saving ${changeCountText(total)}…`,
  };
}

export function discardOptions(total: number): ConfirmOptions {
  return {
    title: total === 1 ? 'Discard 1 unsaved change?' : `Discard ${total.toLocaleString('en-NG')} unsaved changes?`,
    message: 'The rates go back to their live values. Nothing has been saved, so nothing changes for users.',
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
  };
}

export function leaveOptions(total: number): ConfirmOptions {
  return {
    tone: 'danger',
    title: 'Leave without saving?',
    message: `You have ${unsavedText(total)} on this page. Leaving discards ${total === 1 ? 'it' : 'them'}.`,
    confirmLabel: 'Discard and leave',
    cancelLabel: 'Keep editing',
  };
}

export function overlapConsequence(overlaps: readonly ExistingRange[]): string | null {
  if (overlaps.length === 0) return null;
  const names = overlaps.map((range) => (range.active ? range.label : `${range.label} (switched off)`)).join(', ');
  return `This range overlaps ${names}. Where active ranges overlap, the one with the higher minimum value sets the rate.`;
}

export function addRangeOptions(
  target: AddRangeTarget,
  values: NewRangeValues,
  overlaps: readonly ExistingRange[],
  automatic?: RatesAutomatic | null,
  now?: number | null,
): ConfirmOptions<AddOutcome> {
  const { path } = target;
  const top = currencyAmount(path.currency, values.max);
  const overlap = overlapConsequence(overlaps);
  const notes = overlap ? [overlap] : [];
  const phrase = automatic && typeof now === 'number' ? nextUpdatePhrase(automatic, now) : null;
  if (phrase && updatesLive(automatic, path.typeId)) {
    notes.push(`This card type is linked to the rate provider. At the next update, ${phrase.aside}, its ranges are replaced by the provider’s: this range is switched off, or repriced if the provider quotes exactly this range.`);
  }
  return {
    tone: 'financial',
    title: `Add ${values.label} to ${path.cardName}?`,
    message: values.active
      ? 'The new range pays new submissions as soon as you add it. The change is recorded in the audit log.'
      : 'The new range is added switched off, so it pays nothing until someone switches it on. The change is recorded in the audit log.',
    details: [
      { label: 'Card', value: `${path.cardName} · ${groupTitle(path)}` },
      { label: 'Range', value: values.label },
      {
        label: 'Card value',
        value: `${currencyAmount(path.currency, values.min)} – ${top}`,
        mono: true,
      },
      {
        label: `Rate ${perUnit(path.currency)}`,
        value: <Money value={values.rate} emphasis="strong" />,
        emphasis: true,
      },
      { label: `Payout for a ${top} card`, value: <Money value={values.max * values.rate} /> },
      { label: 'Status', value: values.active ? 'Active' : 'Switched off' },
    ],
    consequences: notes.length > 0 ? notes : undefined,
    confirmLabel: 'Add range',
    cancelLabel: 'Go back',
    pendingLabel: 'Adding the range…',
  };
}
