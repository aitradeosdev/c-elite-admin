'use client';

import type { ReactNode, Ref } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  Button, Card, CardBody, CardFooter, CardHeader, DetailRow, Notice, Skeleton, SkeletonLines, StatusDot,
  type NoticeTone,
} from '../../_ui';
import {
  everyInterval, formatPct, intervalLabel, joinWords, offCause, runErrorText, summaryText,
  type IntervalMinutes, type OffCause, type UnpricedType,
} from './rules';
import {
  ageText, dueNow, linkedOfText, linkedText, overdue, providerEntry, providerLock, providerName, stamp, statusIssue,
  type AutomaticStatus, type CardsSnapshot, type ProvidersView, type RunningRun, type StatusIssue,
} from './model';
import s from './page.module.css';

const LISTED_NAMES = 5;

function classes(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

export function ChangeValue({ from, to }: { from: ReactNode; to: ReactNode }) {
  return (
    <span className={s.change}>
      <span className={s.srOnly}>From </span>
      <span className={s.changeFrom}>{from}</span>
      <span className={s.changeArrow} aria-hidden>→</span>
      <span className={s.srOnly}> to </span>
      <span className={s.changeTo}>{to}</span>
    </span>
  );
}

function When({ at, now }: { at: string; now: number }) {
  return (
    <span className={s.when}>
      <span>{stamp(at)}</span>
      <span className={s.age}>{ageText(at, now)}</span>
    </span>
  );
}

export interface SwitchCardProps {
  status: AutomaticStatus;
  now: number;
  canWrite: boolean;
  block: string | null;
  lock: string | null;
  busy: boolean;
  disabled: boolean;
  headingId: string;
  buttonRef: Ref<HTMLButtonElement>;
  onToggle: (turnOn: boolean) => void;
}

function updatedText(linked: number, interval: IntervalMinutes): string {
  if (linked === 0) return 'No card types are linked, so nothing is updated.';
  const types = linked === 1 ? '1 linked card type is' : `${linked.toLocaleString('en-NG')} linked card types are`;
  return `${types} updated ${everyInterval(interval)}. Rates typed on them by hand are replaced at the next update.`;
}

export function SwitchCard({ status, now, canWrite, block, lock, busy, disabled, headingId, buttonRef, onToggle }: SwitchCardProps) {
  const on = status.enabled;
  const since = status.enabledChangedAt;
  const linked = status.linkedTypeIds.length;
  const meta = on
    ? 'Turning automatic rates off keeps every rate as it is.'
    : since
      ? `Off since ${stamp(since)}. Every rate is set by hand.`
      : 'Off. Every rate is set by hand.';
  const blocked = !on && block !== null;
  return (
    <Card role="region" aria-labelledby={headingId} className={classes(on && s.switchOn)}>
      <CardHeader
        title={<h2 id={headingId} className={s.heading}>Automatic rates</h2>}
        subtitle="While they are on, linked card types get their ranges and rates from the rate provider on a schedule."
        actions={<StatusDot status={on ? 'on' : 'off'} tone={on ? 'success' : 'neutral'} label={on ? 'On' : 'Off'} />}
      />
      <CardBody className={s.switchBody}>
        {on && since ? (
          <Notice tone="info" flush title="Automatic rates are on" meta={`On since ${stamp(since)} (${ageText(since, now)})`}>
            {updatedText(linked, status.intervalMinutes)}
          </Notice>
        ) : null}
        <div className={s.switchRow}>
          <p className={s.switchMeta}>{meta}</p>
          {canWrite ? (
            <Button
              ref={buttonRef}
              type="button"
              variant={on ? 'secondary' : 'primary'}
              loading={busy}
              disabled={disabled || blocked}
              aria-describedby={blocked ? `${headingId}-block` : undefined}
              onClick={() => onToggle(!on)}
            >
              {on ? 'Turn off automatic rates…' : 'Turn on automatic rates…'}
            </Button>
          ) : null}
        </div>
        {canWrite && blocked ? <p id={`${headingId}-block`} className={s.reason}>{block}</p> : null}
        {!canWrite && !on && lock !== null ? <p className={s.reason}>{lock}</p> : null}
      </CardBody>
    </Card>
  );
}

export function RunningNotice({ running, now }: { running: RunningRun; now: number }) {
  return (
    <Notice tone="info" compact flush announce="polite" icon={<LoaderCircle size={14} aria-hidden className={s.spin} />}>
      {running.mode === 'apply'
        ? `An update is running. It started ${ageText(running.startedAt, now)}.`
        : `Products are loading. This started ${ageText(running.startedAt, now)}.`}
    </Notice>
  );
}

function offNames(types: readonly UnpricedType[], labels: ReadonlyMap<string, string>): string {
  const names = types.map((entry) => labels.get(entry.cardTypeId));
  if (names.some((name) => name === undefined)) return linkedText(types.length);
  const shown = (names as string[]).slice(0, LISTED_NAMES);
  const more = types.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more.toLocaleString('en-NG')} more` : joinWords(shown);
}

interface IssueView {
  tone: NoticeTone;
  title: string;
  message: string;
}

function typesOffMessage(types: readonly UnpricedType[], provider: string, labels: ReadonlyMap<string, string>): string {
  const groups: Record<OffCause, UnpricedType[]> = { provider: [], percentage: [], currency: [] };
  for (const entry of types) groups[offCause(entry.reason)].push(entry);
  const parts: string[] = [];
  if (groups.provider.length > 0) {
    parts.push(`The last update got no usable rates for ${offNames(groups.provider, labels)}, so their ranges were switched off. They stay off until ${provider} quotes them again, or until you unlink them and set their rates by hand.`);
  }
  if (groups.percentage.length > 0) {
    parts.push(`The extra percentage would make a rate ₦0.00 or less, or more than ₦100,000.00, for ${offNames(groups.percentage, labels)}, so their ranges were switched off at the last update. They stay off until the percentage or ${provider}’s rate brings every rate back in range, or until you unlink them and set their rates by hand.`);
  }
  if (groups.currency.length > 0) {
    parts.push(`No currency symbol is set in Cards for the country of ${offNames(groups.currency, labels)}, so their ranges were switched off at the last update. They stay off until one is added, or until you unlink them and set their rates by hand.`);
  }
  return parts.join(' ');
}

function nextAttemptText(status: AutomaticStatus, at: string, now: number): string {
  if (overdue(status, now)) return `, and the next attempt has been overdue since ${stamp(at)}`;
  if (dueNow(status, now)) return ', and the next attempt starts within 5 minutes';
  return `, and the next attempt is due around ${stamp(at)}`;
}

export function issueView(
  issue: Exclude<StatusIssue, { kind: 'running' }>,
  status: AutomaticStatus,
  provider: string,
  now: number,
  labels: ReadonlyMap<string, string>,
): IssueView {
  switch (issue.kind) {
    case 'failed': {
      const next = issue.nextDueAt ? nextAttemptText(status, issue.nextDueAt, now) : '';
      const streak = issue.streak >= 2 ? ` ${issue.streak.toLocaleString('en-NG')} updates in a row have failed.` : '';
      return {
        tone: 'danger',
        title: 'The last update failed',
        message: `Reading rates from ${provider} failed because ${runErrorText(issue.error)}. Rates stay as they were${next}.${streak}`,
      };
    }
    case 'stale':
      return {
        tone: 'warning',
        title: 'Rates are out of date',
        message: issue.lastSuccessAt
          ? `The last successful update was ${ageText(issue.lastSuccessAt, now)}. Updates are due ${everyInterval(status.intervalMinutes)}, so recent ones have not succeeded.`
          : `No update has succeeded since automatic rates were turned on${status.enabledChangedAt ? ` ${ageText(status.enabledChangedAt, now)}` : ''}. Updates are due ${everyInterval(status.intervalMinutes)}.`,
      };
    case 'never':
      return {
        tone: 'neutral',
        title: 'No update has finished yet',
        message: status.nextDueAt !== null && overdue(status, now)
          ? `The first update has been overdue since ${stamp(status.nextDueAt)}.`
          : 'The first update starts within 5 minutes of turning automatic rates on.',
      };
    case 'types_off':
      return {
        tone: 'warning',
        title: issue.types.length === 1 ? '1 card type is switched off' : `${issue.types.length.toLocaleString('en-NG')} card types are switched off`,
        message: typesOffMessage(issue.types, provider, labels),
      };
    case 'no_links':
      return {
        tone: 'warning',
        title: 'No card types are linked',
        message: 'Automatic rates are on, but nothing is updated until a card type is linked.',
      };
  }
}

function providerRow(status: AutomaticStatus, view: ProvidersView): ReactNode {
  if (status.provider === null) return 'Not chosen';
  const entry = providerEntry(status.provider, view);
  if (entry) return entry.label;
  if (view.state === 'ready') return `${status.provider} (not set up on the server)`;
  return <span className={s.mono}>{status.provider}</span>;
}

function resultRow(status: AutomaticStatus): ReactNode {
  const last = status.lastUpdate;
  if (!last) return null;
  if (last.status === 'failed') return <span className={s.failed}>Failed: {runErrorText(last.error)}</span>;
  const changed = summaryText(last.summary);
  if (changed === null) return 'No change: the provider’s rates matched the live rates';
  const types = last.summary.linked === 1 ? '1 card type' : `${last.summary.linked.toLocaleString('en-NG')} card types`;
  return `${changed} on ${types}`;
}

function nextUpdateRow(status: AutomaticStatus, now: number): string {
  if (!status.enabled || status.nextDueAt === null) return 'None while automatic rates are off';
  if (status.linkedTypeIds.length === 0) return 'None until a card type is linked';
  if (overdue(status, now)) return `Overdue since ${stamp(status.nextDueAt)}`;
  if (dueNow(status, now)) return 'Due now. It starts within 5 minutes.';
  return `Due around ${stamp(status.nextDueAt)}`;
}

function productsRow(status: AutomaticStatus, now: number): ReactNode {
  const last = status.lastProducts;
  if (!last) return 'Not loaded yet';
  if (last.status === 'failed') {
    return <span className={s.failed}>The last load failed {ageText(last.finishedAt, now)}: {runErrorText(last.error)}</span>;
  }
  const loaded = last.summary.lines === 1 ? '1 product' : `${last.summary.lines.toLocaleString('en-NG')} products`;
  return `${loaded} loaded ${ageText(last.finishedAt, now)}`;
}

export interface UpdatesCardProps {
  status: AutomaticStatus;
  now: number;
  view: ProvidersView;
  cards: CardsSnapshot | null;
  labels: ReadonlyMap<string, string>;
  canWrite: boolean;
  running: 'run' | 'products' | null;
  disabled: boolean;
  headingId: string;
  runRef: Ref<HTMLButtonElement>;
  onRun: () => void;
  onLoadProducts: () => void;
}

export function UpdatesCard({
  status, now, view, cards, labels, canWrite, running, disabled, headingId, runRef, onRun, onLoadProducts,
}: UpdatesCardProps) {
  const provider = providerName(status.provider, view);
  const lock = providerLock(status.provider, view, status.enabled);
  const noRegistry = view.state === 'ready' && view.providers.length === 0;
  const issue = statusIssue(status);
  const callout = issue && issue.kind !== 'running' ? issueView(issue, status, provider, now, labels) : null;
  const busyRun = status.running !== null;
  const runReason = busyRun
    ? 'An update is already running. The status shows when it finishes.'
    : !status.enabled
      ? `Turn on automatic rates to update them from ${provider}.`
      : null;
  const productsReason = busyRun
    ? null
    : lock !== null
      ? lock
      : status.provider === null
        ? 'Choose a rate provider first.'
        : null;
  const linked = cards ? linkedOfText(cards) : status.linkedTypeIds.length.toLocaleString('en-NG');
  const last = status.lastUpdate;
  const result = resultRow(status);
  const notes = [runReason, productsReason].filter((note): note is string => note !== null);

  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader
        title={<h2 id={headingId} className={s.heading}>Updates</h2>}
        subtitle={status.provider === null
          ? noRegistry ? 'No rate provider is set up on the server yet.' : 'No rate provider is chosen yet.'
          : `Rates are read from ${provider} ${everyInterval(status.intervalMinutes)} while automatic rates are on.`}
      />
      <CardBody className={s.stack}>
        {status.running ? <RunningNotice running={status.running} now={now} /> : null}
        {callout ? (
          <Notice variant="callout" tone={callout.tone} title={callout.title}>{callout.message}</Notice>
        ) : null}
        <div className={s.rows}>
          <DetailRow label="Rate provider" value={providerRow(status, view)} />
          <DetailRow label="Last update" value={last ? <When at={last.finishedAt} now={now} /> : 'Never'} />
          {result !== null ? <DetailRow label="Result" wrap value={result} /> : null}
          <DetailRow label="Next update" value={nextUpdateRow(status, now)} />
          <DetailRow label="Linked card types" value={linked} />
          <DetailRow label="Products" wrap value={productsRow(status, now)} />
        </div>
      </CardBody>
      {canWrite ? (
        <CardFooter className={s.footer}>
          {notes.length > 0 ? (
            <div className={s.footerNotes}>
              {notes.map((note) => <p key={note} className={s.reason}>{note}</p>)}
            </div>
          ) : null}
          <div className={s.footerActions}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={running === 'products'}
              disabled={disabled || busyRun || status.provider === null || lock !== null}
              onClick={onLoadProducts}
            >
              Load products
            </Button>
            <Button
              ref={runRef}
              type="button"
              variant="primary"
              size="sm"
              loading={running === 'run'}
              disabled={disabled || busyRun || !status.enabled}
              onClick={onRun}
            >
              Update rates now…
            </Button>
          </div>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export interface SettingsSummaryProps {
  status: AutomaticStatus;
  view: ProvidersView;
  headingId: string;
}

export function SettingsSummary({ status, view, headingId }: SettingsSummaryProps) {
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader
        title={<h2 id={headingId} className={s.heading}>Update settings</h2>}
        subtitle="Which provider to read, how often, and the extra percentage added to its rates."
      />
      <CardBody className={s.rows}>
        <DetailRow label="Rate provider" value={providerRow(status, view)} />
        <DetailRow label="Update every" value={intervalLabel(status.intervalMinutes)} />
        <DetailRow label="Extra percentage for every card" value={formatPct(status.universalPct)} mono />
      </CardBody>
    </Card>
  );
}

export function AutomaticRatesSkeleton() {
  return (
    <div className={s.skeleton} aria-busy="true">
      <span className={s.srOnly} role="status">Loading automatic rates…</span>
      {['switch', 'updates', 'links'].map((key) => (
        <Card key={key} aria-hidden>
          <CardHeader title={<Skeleton width="9em" height={16} />} subtitle={<Skeleton width="55%" height={12} />} />
          <CardBody>
            <SkeletonLines rows={3} />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
