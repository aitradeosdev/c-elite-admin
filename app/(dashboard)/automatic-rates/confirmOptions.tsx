import type { ConfirmDetail, ConfirmOptions } from '../../_ui';
import {
  everyInterval, formatPct, intervalLabel, unpricedReasonText,
} from './rules';
import {
  linkedOfText, previewBands, sentence,
  type AutomaticStatus, type CardsSnapshot, type LinkCard, type LinkReceipt, type LinkRow, type MarkupReceipt,
  type ProviderProduct, type RunReceipt, type SwitchReceipt, type WriteOutcome,
} from './model';
import { ChangeValue } from './AutomaticRatesParts';

function count(value: number, one: string, many: string): string {
  return `${value.toLocaleString('en-NG')} ${value === 1 ? one : many}`;
}

function linkedPhrase(value: number): string {
  return value === 1 ? 'the linked card type' : `the ${value.toLocaleString('en-NG')} linked card types`;
}

export function pctChoice(own: number | null, universal: number): string {
  return own === null ? `${formatPct(universal)} (every-card percentage)` : `${formatPct(own)} (this card’s own percentage)`;
}

export interface TurnOnInput {
  status: AutomaticStatus;
  provider: string;
  cards: CardsSnapshot | null;
}

export function turnOnOptions({ status, provider, cards }: TurnOnInput): ConfirmOptions<WriteOutcome<SwitchReceipt>> {
  const linked = status.linkedTypeIds.length;
  const details: ConfirmDetail[] = [
    { label: 'Automatic rates', value: <ChangeValue from="Off" to="On" />, emphasis: true },
    { label: 'Rate provider', value: provider },
    { label: 'Linked card types', value: cards ? linkedOfText(cards) : linked.toLocaleString('en-NG') },
    { label: 'Update every', value: intervalLabel(status.intervalMinutes) },
    { label: 'Extra percentage for every card', value: formatPct(status.universalPct), mono: true },
  ];
  if (cards) details.push({ label: 'Cards with their own percentage', value: cards.ownPctCards.toLocaleString('en-NG') });
  const consequences = [
    `The first update starts within 5 minutes. After that, ranges and rates typed by hand on ${linkedPhrase(linked)} last only until the next update.`,
    'At each update, a linked card type gets exactly the provider’s ranges. Ranges the provider does not list are switched off, and a card type the provider does not quote is switched off until it is quoted again.',
    'Each update applies the provider’s rates as received, however far they move from the last update.',
  ];
  const manual = cards ? cards.typeCount - cards.linkedCount : 0;
  if (manual > 0) {
    consequences.push(manual === 1
      ? 'The 1 card type that is not linked keeps its rates, and extra percentages never apply to it.'
      : `The ${manual.toLocaleString('en-NG')} card types that are not linked keep their rates, and extra percentages never apply to them.`);
  }
  consequences.push('While automatic rates are on, changing an extra percentage reprices the linked ranges straight away. Rates are rounded to the nearest kobo after the percentage is applied.');
  return {
    tone: 'financial',
    title: 'Turn on automatic rates?',
    message: `${sentence(everyInterval(status.intervalMinutes))}, linked card types get ${provider}’s ranges and rates plus the extra percentage. Card types that are not linked are never changed. The change is recorded in the audit log.`,
    details,
    consequences,
    confirmLabel: 'Turn on automatic rates',
    cancelLabel: 'Keep them off',
    pendingLabel: 'Turning on automatic rates…',
  };
}

export function turnOffOptions(status: AutomaticStatus, provider: string): ConfirmOptions<WriteOutcome<SwitchReceipt>> {
  return {
    title: 'Turn off automatic rates?',
    message: `Updates from ${provider} stop. Every range keeps the rate it has now, and rates are set by hand again. The change is recorded in the audit log.`,
    details: [
      { label: 'Automatic rates', value: <ChangeValue from="On" to="Off" />, emphasis: true },
      { label: 'Linked card types', value: status.linkedTypeIds.length.toLocaleString('en-NG') },
    ],
    consequences: [
      'Links and extra percentages are kept, so turning automatic rates back on resumes updates.',
      'An update that is running when you confirm finishes without changing any rate.',
    ],
    confirmLabel: 'Turn off automatic rates',
    cancelLabel: 'Keep them on',
    pendingLabel: 'Turning off automatic rates…',
  };
}

export function runOptions(provider: string): ConfirmOptions<WriteOutcome<RunReceipt>> {
  return {
    tone: 'financial',
    title: `Update rates from ${provider} now?`,
    message: `Linked card types get ${provider}’s current ranges and rates plus the extra percentages as soon as the update finishes. Ranges and rates typed on them by hand are replaced. The change is recorded in the audit log.`,
    consequences: ['The provider’s rates are applied as received, however far they move from the last update.'],
    confirmLabel: 'Update rates now',
    cancelLabel: 'Cancel',
    pendingLabel: 'Updating rates…',
  };
}

function linkConsequences(card: LinkCard, product: ProviderProduct, provider: string): string[] {
  const lines: string[] = [];
  if (product.problem !== null) {
    lines.push(`${sentence(provider)}’s rates for this product cannot be used because ${unpricedReasonText(product.problem)}. If you link it, this card type is switched off at each update until they can be used.`);
  } else if (previewBands(product, card.effectivePct)?.some((band) => !band.valid)) {
    lines.push('With the extra percentage, some of these rates are not valid, so this card type is switched off at each update until the percentage or the rates change.');
  }
  if (!product.inLatest) {
    lines.push(`${product.name} was not in ${provider}’s latest list, so this card type is switched off at the next update unless it is listed again.`);
  }
  return lines;
}

export function linkOptions(
  row: LinkRow,
  card: LinkCard,
  product: ProviderProduct,
  provider: string,
): ConfirmOptions<WriteOutcome<LinkReceipt>> {
  const consequences = linkConsequences(card, product, provider);
  return {
    tone: 'financial',
    title: `Link ${row.title} to ${product.name}?`,
    message: `While automatic rates are on, this card type gets ${provider}’s ranges and rates for ${product.name}, plus the extra percentage. Ranges and rates typed on it are replaced at the next update. The change is recorded in the audit log.`,
    details: [
      { label: 'Product', value: `${product.name} (${product.ref})` },
      { label: 'Extra percentage', value: pctChoice(card.ownPct, card.effectivePct) },
      { label: 'Live ranges now', value: row.liveRanges.toLocaleString('en-NG') },
    ],
    consequences: consequences.length > 0 ? consequences : undefined,
    confirmLabel: 'Link card type',
    cancelLabel: 'Go back',
    pendingLabel: 'Linking…',
  };
}

export function unlinkOptions(row: LinkRow): ConfirmOptions<WriteOutcome<LinkReceipt>> {
  return {
    tone: 'financial',
    title: `Unlink ${row.title}?`,
    message: 'This card type goes back to manual rates. Its ranges keep the rates they have now, and extra percentages no longer apply to it. The change is recorded in the audit log.',
    details: [
      { label: 'Product', value: row.product ? `${row.product.name} (${row.ref})` : String(row.ref) },
      { label: 'Live ranges now', value: row.liveRanges.toLocaleString('en-NG') },
    ],
    confirmLabel: 'Unlink card type',
    cancelLabel: 'Keep it linked',
    pendingLabel: 'Unlinking…',
  };
}

export function extraOptions(
  card: LinkCard,
  next: number | null,
  universal: number,
  enabled: boolean,
): ConfirmOptions<WriteOutcome<MarkupReceipt>> {
  return {
    tone: 'financial',
    title: `Change the extra percentage for ${card.name}?`,
    message: enabled
      ? `Linked ranges of ${card.name} are repriced as soon as you confirm. The change is recorded in the audit log.`
      : 'The percentage is used once automatic rates are on. The change is recorded in the audit log.',
    details: [
      {
        label: 'Extra percentage',
        value: <ChangeValue from={pctChoice(card.ownPct, universal)} to={pctChoice(next, universal)} />,
        emphasis: true,
      },
      { label: 'Linked card types', value: `${card.linked.toLocaleString('en-NG')} of ${count(card.rows.length, 'card type', 'card types')}` },
    ],
    consequences: [
      `Card types of ${card.name} that are not linked keep their hand-typed rates.`,
      'Rates are rounded to the nearest kobo after the percentage is applied.',
    ],
    confirmLabel: next === null ? 'Use the every-card percentage' : `Set to ${formatPct(next)}`,
    cancelLabel: 'Go back',
    pendingLabel: 'Saving the extra percentage…',
  };
}
