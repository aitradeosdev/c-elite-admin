'use client';

import type { ReactNode, Ref } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  Badge, Button, Card, CardBody, CardFooter, CardHeader, DetailRow, FieldShell, Input, Money, Notice, RadioGroup,
  Skeleton, SkeletonLines, formatNaira,
  type ConfirmDetail, type ConfirmOptions, type RadioOption,
} from '../../_ui';
import { BUSINESS_TZ_LABEL, formatBusinessDateTime } from '../../lib/time';
import {
  BALANCE_MODES, MODE_KEY, MODE_LABELS, PROVIDER_LABELS, REFRESH_INTERVAL_MINUTES, STATIC_KEY,
  ageText, applySaved, liveIssue, modeConsequences, saveLabel, savedHelp, sourceChoice, sourceText,
  staticConsequences, staticProblem, workingStatus,
  type BalanceMode, type BalanceSnapshot, type SaveOutcome, type WorkPhase, type Working,
} from './model';
import s from './page.module.css';

const SOURCE_HELP = 'You are asked to confirm before the source changes for users.';

export function stamp(at: string | null | undefined): string | null {
  return at ? `${formatBusinessDateTime(at)} ${BUSINESS_TZ_LABEL}` : null;
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

export function InUseBadge({ inUse }: { inUse: boolean }) {
  return inUse
    ? <Badge tone="success" dot>In use</Badge>
    : <Badge tone="neutral">Not in use</Badge>;
}

function storedStatic(snapshot: BalanceSnapshot): ReactNode {
  if (snapshot.staticValid) return <Money value={snapshot.staticAmount} />;
  return snapshot.staticText === null || snapshot.staticText.trim() === ''
    ? 'Not set'
    : `“${snapshot.staticText}” (not a valid amount)`;
}

function staticDescription(snapshot: BalanceSnapshot): ReactNode {
  if (snapshot.staticValid) {
    return <>Users see a fixed amount that an admin sets: <Money value={snapshot.staticAmount} />.</>;
  }
  return <>Users see a fixed amount that an admin sets. {staticProblem(snapshot)}</>;
}

function liveDescription(snapshot: BalanceSnapshot): ReactNode {
  const provider = PROVIDER_LABELS[snapshot.gateway];
  if (!snapshot.liveAt) {
    return <>Users see the {provider} balance, refreshed every {REFRESH_INTERVAL_MINUTES} minutes. None has been fetched yet.</>;
  }
  return (
    <>
      Users see the {provider} balance, refreshed every {REFRESH_INTERVAL_MINUTES} minutes:{' '}
      <Money value={snapshot.liveAmount} /> as of {stamp(snapshot.liveAt)}.
    </>
  );
}

export interface ShownCardProps {
  snapshot: BalanceSnapshot;
  now: number;
  canWrite: boolean;
  working: Working | null;
  headingId: string;
  groupId: string;
  onSwitch: (target: BalanceMode) => void;
}

export function ShownCard({ snapshot, now, canWrite, working, headingId, groupId, onSwitch }: ShownCardProps) {
  const since = stamp(snapshot.updatedAt[MODE_KEY]);
  const issue = snapshot.mode === 'live' ? liveIssue(snapshot, now) : null;
  const status = workingStatus(working);
  const choice = sourceChoice(snapshot.mode, working);
  const options: RadioOption<BalanceMode>[] = BALANCE_MODES.map((mode) => ({
    value: mode,
    label: MODE_LABELS[mode],
    description: mode === 'static' ? staticDescription(snapshot) : liveDescription(snapshot),
    disabled: choice.locked && mode !== choice.value,
  }));

  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardHeader
          title={<h2 id={headingId} className={s.heading}>Shown to users</h2>}
          subtitle="The figure on the Platform Balance card of the Marketplace screen in the app."
        />
        <CardBody className={s.shownBody}>
          <div className={s.shown}>
            <Money value={snapshot.shownAmount} emphasis="strong" className={s.shownValue} />
            <p className={s.shownMeta}>
              {sourceText(snapshot)}
              {since ? ` · since ${since}` : ''}
            </p>
          </div>
          {issue ? (
            <Notice variant="callout" tone={issue.kind === 'stale' ? 'warning' : 'danger'} title={issue.title}>
              {issue.message}
            </Notice>
          ) : null}
          {canWrite ? (
            <div className={s.source} aria-busy={choice.pending !== null || undefined}>
              <RadioGroup<BalanceMode>
                id={groupId}
                legend="Source"
                options={options}
                value={choice.value}
                help={SOURCE_HELP}
                onChange={onSwitch}
              />
              <p className={s.status} role="status">
                {status ? (
                  <>
                    <LoaderCircle size={14} aria-hidden className={s.spin} />
                    <span>{status}</span>
                  </>
                ) : null}
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </section>
  );
}

export interface StaticCardProps {
  snapshot: BalanceSnapshot;
  canWrite: boolean;
  headingId: string;
  inputId: string;
  value: string;
  dirty: boolean;
  error: string | null;
  preview: number | null;
  busy: boolean;
  phase: WorkPhase | null;
  changedElsewhere: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
  onBlur: () => void;
  onSave: () => void;
  onDiscard: () => void;
}

function StaticEditor({
  snapshot, inputId, value, dirty, error, preview, busy, phase, changedElsewhere, inputRef,
  onChange, onBlur, onSave, onDiscard,
}: StaticCardProps) {
  const changedAt = stamp(snapshot.updatedAt[STATIC_KEY]);
  const problem = staticProblem(snapshot);
  const working = phase === 'checking' || phase === 'saving';
  const help = dirty
    ? preview !== null ? `Shows as ${formatNaira(preview)}.` : undefined
    : savedHelp(snapshot, changedAt);

  return (
    <form
      className={s.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <CardBody className={s.stack}>
        {problem && !dirty ? (
          <Notice variant="callout" tone="warning" title="No valid amount stored">{problem}</Notice>
        ) : null}
        {dirty && changedElsewhere ? (
          <Notice variant="callout" tone="warning" title="Changed by another admin">
            The saved amount is now {storedStatic(snapshot)}. Saving replaces it with yours. Discard to start again from
            the new amount.
          </Notice>
        ) : null}
        <FieldShell
          htmlFor={inputId}
          label={(
            <>
              Amount
              {dirty ? (
                <span className={s.unsaved}>
                  <span className={s.unsavedDot} aria-hidden />
                  Unsaved
                </span>
              ) : null}
            </>
          )}
          help={help}
          error={error}
        >
          <div className={s.amount}>
            <span className={s.currency} aria-hidden>₦</span>
            <Input
              ref={inputRef}
              id={inputId}
              className={s.amountInput}
              type="text"
              inputMode="decimal"
              mono
              autoComplete="off"
              spellCheck={false}
              placeholder="0.00"
              value={value}
              readOnly={busy}
              onChange={(event) => onChange(event.target.value)}
              onBlur={onBlur}
            />
          </div>
        </FieldShell>
      </CardBody>
      <CardFooter>
        {dirty ? (
          <Button type="button" variant="ghost" size="sm" aria-disabled={busy || undefined} onClick={onDiscard}>
            Discard
          </Button>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          size="sm"
          aria-disabled={busy || !dirty || undefined}
          aria-busy={working || undefined}
          leftIcon={working ? <LoaderCircle size={14} aria-hidden className={s.spin} /> : undefined}
        >
          {saveLabel(phase)}
        </Button>
      </CardFooter>
    </form>
  );
}

export function StaticCard(props: StaticCardProps) {
  const { snapshot, canWrite, headingId } = props;
  const inUse = snapshot.mode === 'static';
  const problem = staticProblem(snapshot);

  return (
    <section aria-labelledby={headingId} className={s.cell}>
      <Card className={s.fill}>
        <CardHeader
          title={<h2 id={headingId} className={s.heading}>Static amount</h2>}
          subtitle={inUse ? 'Users see this amount now.' : 'Users see this amount only while the source is Static.'}
          actions={<InUseBadge inUse={inUse} />}
        />
        {canWrite ? (
          <StaticEditor {...props} />
        ) : (
          <CardBody className={s.stack}>
            <div className={s.rows}>
              <DetailRow label="Amount" value={storedStatic(snapshot)} />
              <DetailRow label="Last changed" value={stamp(snapshot.updatedAt[STATIC_KEY]) ?? '—'} />
            </div>
            {problem ? <Notice variant="callout" tone="warning" title="No valid amount stored">{problem}</Notice> : null}
          </CardBody>
        )}
      </Card>
    </section>
  );
}

export interface LiveCardProps {
  snapshot: BalanceSnapshot;
  now: number;
  headingId: string;
}

export function LiveCard({ snapshot, now, headingId }: LiveCardProps) {
  const provider = PROVIDER_LABELS[snapshot.gateway];
  const inUse = snapshot.mode === 'live';
  const issue = inUse ? null : liveIssue(snapshot, now);

  return (
    <section aria-labelledby={headingId} className={s.cell}>
      <Card className={s.fill}>
        <CardHeader
          title={<h2 id={headingId} className={s.heading}>Live balance</h2>}
          subtitle={`Read from ${provider} every ${REFRESH_INTERVAL_MINUTES} minutes by a scheduled job.`}
          actions={<InUseBadge inUse={inUse} />}
        />
        <CardBody className={s.stack}>
          <div className={s.rows}>
            <DetailRow
              label="Balance"
              value={snapshot.liveAt ? <Money value={snapshot.liveAmount} emphasis="strong" /> : 'Not fetched yet'}
            />
            <DetailRow label="Provider" value={provider} />
            <DetailRow
              label="Last refreshed"
              value={snapshot.liveAt ? (
                <span className={s.when}>
                  <span>{stamp(snapshot.liveAt)}</span>
                  <span className={s.age}>{ageText(snapshot.liveAt, now)}</span>
                </span>
              ) : 'Never'}
            />
          </div>
          {issue ? (
            <Notice variant="callout" tone={issue.kind === 'never' ? 'neutral' : 'warning'} title={issue.title}>
              {issue.message}
            </Notice>
          ) : null}
        </CardBody>
      </Card>
    </section>
  );
}

export function BalanceSkeleton() {
  return (
    <div className={s.skeleton} aria-busy="true">
      <span className={s.srOnly} role="status">Loading the platform balance…</span>
      <Card aria-hidden>
        <CardHeader title={<Skeleton width="9em" height={16} />} subtitle={<Skeleton width="60%" height={12} />} />
        <CardBody className={s.shownBody}>
          <Skeleton width="11em" height={30} />
          <SkeletonLines rows={3} />
        </CardBody>
      </Card>
      <div className={s.grid}>
        {['static', 'live'].map((key) => (
          <div key={key} className={s.cell}>
            <Card aria-hidden className={s.fill}>
              <CardHeader title={<Skeleton width="8em" height={16} />} actions={<Skeleton width={64} height={18} rounded />} />
              <CardBody>
                <SkeletonLines rows={3} />
              </CardBody>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}

export function modeOptions(fresh: BalanceSnapshot, target: BalanceMode, now: number): ConfirmOptions<SaveOutcome> {
  const after = applySaved(fresh, { [MODE_KEY]: target }, new Date(now).toISOString());
  const provider = PROVIDER_LABELS[fresh.gateway];
  const details: ConfirmDetail[] = [
    { label: 'Source', value: <ChangeValue from={MODE_LABELS[fresh.mode]} to={MODE_LABELS[target]} /> },
    {
      label: 'Users see',
      value: (
        <ChangeValue
          from={<Money value={fresh.shownAmount} />}
          to={<Money value={after.shownAmount} emphasis="strong" />}
        />
      ),
      emphasis: true,
    },
  ];
  if (target === 'live') {
    details.push({
      label: 'Live balance',
      value: fresh.liveAt ? `${provider}, refreshed ${stamp(fresh.liveAt)}` : `${provider}, never refreshed`,
    });
  }
  return {
    tone: 'financial',
    title: target === 'live' ? 'Show users the live balance?' : 'Show users the static amount?',
    message: 'Every user sees the new figure on the Marketplace screen within about a minute. The change is recorded in the audit log.',
    details,
    consequences: modeConsequences(fresh, target, now),
    confirmLabel: `Switch to ${MODE_LABELS[target]}`,
    cancelLabel: `Keep ${MODE_LABELS[fresh.mode]}`,
    pendingLabel: `Switching to ${MODE_LABELS[target]}…`,
  };
}

export function staticOptions(
  fresh: BalanceSnapshot,
  amount: number,
  changedElsewhere: boolean,
): ConfirmOptions<SaveOutcome> {
  const details: ConfirmDetail[] = [
    {
      label: 'Static amount',
      value: <ChangeValue from={storedStatic(fresh)} to={<Money value={amount} emphasis="strong" />} />,
      emphasis: true,
    },
  ];
  if (fresh.staticValid) {
    details.push({ label: 'Difference', value: <Money value={amount - fresh.staticAmount} signed /> });
  }
  if (fresh.mode === 'live') {
    details.push({
      label: 'Users see',
      value: <><Money value={fresh.shownAmount} /> (live balance, unchanged)</>,
    });
  }
  return {
    tone: 'financial',
    title: 'Change the static amount?',
    message: fresh.mode === 'static'
      ? 'Every user sees the new amount on the Marketplace screen within about a minute. The change is recorded in the audit log.'
      : 'Users do not see this amount while the source is Live. The change is recorded in the audit log.',
    details,
    consequences: staticConsequences(fresh, amount, changedElsewhere),
    confirmLabel: `Set to ${formatNaira(amount)}`,
    cancelLabel: 'Keep editing',
    pendingLabel: 'Saving the static amount…',
  };
}

export function leaveOptions(): ConfirmOptions {
  return {
    tone: 'danger',
    title: 'Leave without saving?',
    message: 'The static amount you typed has not been saved. Leaving discards it.',
    confirmLabel: 'Discard and leave',
    cancelLabel: 'Keep editing',
  };
}
