'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Lock, RotateCw, Siren, UserX } from 'lucide-react';
import {
  Badge, Button, ErrorState, FieldShell, Input, Notice, RadioGroup, Ref, SidePanel, SkeletonLines, Textarea, useConfirm,
  useResource, useToast,
} from '../../../_ui';
import { apiRequest } from '../../../lib/apiClient';
import { toKobo } from '../../../lib/naira';
import { formatBusinessDateTime } from '../../../lib/time';
import { plural, userHandle, userSummary, type UserProfile } from './model';
import {
  CLOSE_WHILE_UNKNOWN, DEFAULT_TEMPLATES, DIRECTION_TEXT, EMPTY_ADJUST_FORM, NOTE_MAX, OTHER_CHOICE, REASON_MAX,
  REASON_PRESETS, REFERENCE_MAX, TEMPLATE_NAMES, adjustConfirmOptions, adjustPayload, allowanceOf, appliedNotices,
  characters, checkAdjustForm, classifyAdjust, firstProblem, formatKobo, isDeletionFreeze, isFormDirty, mintAdjustKey,
  newAttempt, notePresets, prepareAttempt, renderNotice, retryBody, settleAttempt, toAdjustReceipt, toWalletContext,
  withDirection,
  type AdjustDirection, type AdjustForm, type AdjustOutcome, type AdjustValues, type AttemptState, type BalancePreview,
  type FormField, type HistoryRow, type WalletContext,
} from './walletAdjust';
import s from './WalletAdjust.module.css';

type Working = 'checking' | 'confirming' | 'sending' | 'retrying' | null;

interface Problem {
  title: string;
  message: string;
}

export interface WalletAdjustPanelProps {
  user: UserProfile;
  onClose: () => void;
  onApplied: () => void;
  onOutcomeUnknown: () => void;
  returnFocusTo?: () => HTMLElement | null;
}

export function walletAdjustEndpoint(userId: string): string {
  return `/api/users/${encodeURIComponent(userId)}/wallet-adjustments`;
}

const WORKING_TEXT: Readonly<Record<Exclude<Working, null>, string>> = {
  checking: 'Checking the wallet…',
  confirming: 'Waiting for your confirmation…',
  sending: 'Applying the adjustment…',
  retrying: 'Sending the same request again…',
};

function refusedTitle(outcome: Extract<AdjustOutcome, { kind: 'refused' }>): string {
  if (outcome.status === 403) return 'You cannot make this adjustment';
  return 'Nothing was changed';
}

export function AdjustNotices({ context }: { context: WalletContext }) {
  const { user } = context;
  const pending = context.withdrawalsPending ?? 0;
  return (
    <div className={s.notices}>
      {user.deletedAt ? (
        <Notice tone="danger" icon={<UserX size={16} />} title="Deletion in progress">
          This account is being deleted, so its wallet cannot be adjusted.
        </Notice>
      ) : user.frozen && isDeletionFreeze(user) ? (
        <Notice tone="danger" icon={<Lock size={16} />} title="The user is deleting this account">
          The account is frozen while the deletion runs. A credit leaves money in the wallet, which stops the deletion
          from completing until the user withdraws it.
        </Notice>
      ) : user.frozen ? (
        <Notice
          tone="warning"
          icon={<Lock size={16} />}
          title="Account frozen"
          meta={`Frozen because: ${user.freezeReason || 'no reason was recorded.'}`}
        >
          Adjustments still apply to a frozen account and are recorded as made while frozen. Withdrawals stay blocked
          until it is unfrozen.
        </Notice>
      ) : null}
      {context.emergencyMode ? (
        <Notice tone="warning" icon={<Siren size={16} />} title="Emergency mode is on">
          Credits are refused until emergency mode is turned off. Debits are still allowed.
        </Notice>
      ) : null}
      {context.selfAdjustment ? (
        <Notice tone="danger" title="This is your own account">
          It uses your email address, so you cannot adjust its wallet.
        </Notice>
      ) : null}
      {!user.deletedAt && context.balanceKobo === null ? (
        <Notice tone="danger" title="No wallet">
          This user has no wallet, so there is nothing to adjust.
        </Notice>
      ) : null}
      {pending > 0 ? (
        <Notice tone="info" compact>
          {plural(pending, 'withdrawal is', 'withdrawals are')} waiting for review. Their amounts have already left
          the wallet, and rejecting one refunds it.
        </Notice>
      ) : null}
      {context.partial.length > 0 ? (
        <Notice tone="warning" compact>
          {context.partial.join(' ')}
        </Notice>
      ) : null}
    </div>
  );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.summaryItem}>
      <span className={s.summaryLabel}>{label}</span>
      <span className={s.summaryValue}>{children}</span>
    </div>
  );
}

export function WalletSummary({ user, context }: { user: UserProfile; context: WalletContext }) {
  const allowance = allowanceOf(context);
  return (
    <div className={s.summary}>
      <SummaryItem label="User">{userSummary(user)}</SummaryItem>
      <SummaryItem label="User ID">
        <Ref value={user.id} label="user ID" truncate={13} />
      </SummaryItem>
      <SummaryItem label="Live balance">
        <span className={s.balance} translate="no">
          {context.balanceKobo === null ? 'No wallet' : formatKobo(context.balanceKobo)}
        </span>
      </SummaryItem>
      <SummaryItem label="Your limits">
        {allowance ? (
          <>
            Up to {formatKobo(allowance.perAdjustmentKobo)} per adjustment and {formatKobo(allowance.dailyKobo)} a day.{' '}
            {allowance.leftTodayKobo === null
              ? 'Today’s total could not be worked out.'
              : `${formatKobo(allowance.leftTodayKobo)} left today.`}
          </>
        ) : (
          'The limits could not be loaded. They still apply.'
        )}
      </SummaryItem>
    </div>
  );
}

export function BalancePreviewLine({ preview }: { preview: BalancePreview | null }) {
  if (!preview) {
    return (
      <p className={s.previewEmpty}>
        Choose Credit or Debit and enter an amount to see the balance after the adjustment.
      </p>
    );
  }
  return (
    <div className={[s.preview, preview.negative && s.previewNegative].filter(Boolean).join(' ')} aria-live="polite">
      <span className={s.previewLabel}>Balance after</span>
      <span className={s.previewValue} translate="no">{formatKobo(preview.beforeKobo)}</span>
      <ArrowRight size={14} aria-hidden className={s.previewArrow} />
      <span className={s.previewValue} translate="no">
        {preview.negative ? 'Below ₦0.00, so it is refused' : formatKobo(preview.afterKobo)}
      </span>
    </div>
  );
}

export function MessagePreview({
  direction, amountKobo, note, context,
}: {
  direction: AdjustDirection | null;
  amountKobo: number | null;
  note: string;
  context: WalletContext;
}) {
  if (!direction || amountKobo === null || note === '') {
    return <p className={s.previewEmpty}>Choose the direction, the amount and a message to preview what the user sees.</p>;
  }
  const template = context.templates ? context.templates[direction] : DEFAULT_TEMPLATES[direction];
  const rendered = renderNotice(template, amountKobo, note);
  const sign = direction === 'credit' ? '+' : '−';
  return (
    <div className={s.userView}>
      <div className={s.userViewBlock}>
        <span className={s.userViewLabel}>Push and in-app notification</span>
        {rendered ? (
          <div className={s.phone}>
            <span className={s.phoneTitle}>{rendered.title}</span>
            <span className={s.phoneBody}>{rendered.body}</span>
          </div>
        ) : (
          <p className={s.previewEmpty}>
            None. The {TEMPLATE_NAMES[direction]} notification is switched off in Notification templates, so the user
            is not notified.
          </p>
        )}
      </div>
      <div className={s.userViewBlock}>
        <span className={s.userViewLabel}>Transaction history</span>
        <div className={s.phone}>
          <span className={s.phoneTitle}>
            {DIRECTION_TEXT[direction].history} <span translate="no">{`${sign}${formatKobo(amountKobo)}`}</span>
          </span>
          <span className={s.phoneBody}>{note}</span>
        </div>
      </div>
      <p className={s.hint}>
        {context.templates
          ? 'The notification uses the live template wording.'
          : 'The live template could not be read, so this uses the default wording.'}{' '}
        The reason and the reference are never shown to the user.
      </p>
    </div>
  );
}

function historyAmount(row: HistoryRow): string {
  return `${row.direction === 'credit' ? '+' : '−'}${formatKobo(row.amountKobo)}`;
}

export function RecentAdjustments({ rows }: { rows: HistoryRow[] | null }) {
  if (rows === null) return <p className={s.previewEmpty}>Recent adjustments could not be loaded.</p>;
  if (rows.length === 0) return <p className={s.previewEmpty}>No wallet adjustments have been made for this user.</p>;
  return (
    <ul className={s.history}>
      {rows.map((row) => (
        <li key={row.id} className={s.historyRow}>
          <div className={s.historyMain}>
            <span className={s.historyTitle}>
              <Badge>{DIRECTION_TEXT[row.direction].label}</Badge>
              <span className={s.historyAmount} translate="no">{historyAmount(row)}</span>
            </span>
            <span className={s.historyText}>{row.reason || 'No reason recorded'}</span>
            <span className={s.historyMeta}>
              {formatBusinessDateTime(row.createdAt)} WAT · {row.adminUsername ? `@${row.adminUsername}` : 'Unknown admin'}
              {row.reference ? ` · Ref ${row.reference}` : ''}
              {row.accountFrozen ? ' · While frozen' : ''}
              {row.notified ? '' : ' · Not notified'}
            </span>
          </div>
          <span className={s.historyNote}>“{row.userNote}”</span>
        </li>
      ))}
    </ul>
  );
}

export function UnknownOutcomeNotice({ message, sent }: { message: string; sent: string | null }) {
  return (
    <Notice tone="danger" title="The adjustment could not be confirmed" announce="assertive" meta={sent}>
      {message} The details below stay locked until it is confirmed.
    </Notice>
  );
}

function sentSummary(state: AttemptState): string | null {
  const payload = state.payload;
  if (!payload) return null;
  const kobo = toKobo(payload.amount);
  return `Sent: ${DIRECTION_TEXT[payload.direction].label} ${kobo === null ? payload.amount : formatKobo(kobo)}.`;
}

export function WalletAdjustPanel({ user, onClose, onApplied, onOutcomeUnknown, returnFocusTo }: WalletAdjustPanelProps) {
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const formId = useId();
  const directionName = useId();
  const reasonName = useId();
  const noteName = useId();
  const endpoint = walletAdjustEndpoint(user.id);
  const resource = useResource<WalletContext>(`wallet-adjust:${user.id}`, (signal) => (
    apiRequest(endpoint, { signal, select: toWalletContext })
  ));
  const { refresh } = resource;
  const context = resource.data ?? null;

  const [initialKey] = useState(mintAdjustKey);
  const attemptRef = useRef<AttemptState>(newAttempt(initialKey));
  const [form, setForm] = useState<AdjustForm>(() => ({ ...EMPTY_ADJUST_FORM }));
  const [showErrors, setShowErrors] = useState(false);
  const [working, setWorking] = useState<Working>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);

  const locked = unknown !== null;
  const busy = working !== null;
  const frozenFields = locked || busy;
  const check = checkAdjustForm(form, context);
  const errors = showErrors ? check.errors : {};
  const dirty = isFormDirty(form);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!dirty && !locked) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, locked]);

  const update = (patch: Partial<AdjustForm>) => {
    if (frozenFields) return;
    setForm((current) => ({ ...current, ...patch }));
  };

  const chooseDirection = (direction: AdjustDirection) => {
    if (frozenFields) return;
    setForm((current) => withDirection(current, direction));
  };

  const focusField = (field: FormField) => {
    const target = formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"] :is(input, textarea):not(:disabled)`);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center' });
  };

  const requestClose = useCallback(async () => {
    if (busyRef.current) return;
    if (unknown !== null) {
      const decision = await confirm({
        tone: 'danger',
        title: 'Close without confirming the adjustment?',
        message: CLOSE_WHILE_UNKNOWN,
        confirmLabel: 'Close anyway',
        cancelLabel: 'Keep it open',
      });
      if (decision && aliveRef.current) onClose();
      return;
    }
    if (dirty) {
      const decision = await confirm({
        title: 'Discard this adjustment?',
        message: 'Nothing has been sent. The details you entered will be lost.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
      });
      if (decision && aliveRef.current) onClose();
      return;
    }
    onClose();
  }, [confirm, dirty, onClose, unknown]);

  const settle = (outcome: AdjustOutcome, values: Pick<AdjustValues, 'direction' | 'amountKobo'>) => {
    attemptRef.current = settleAttempt(attemptRef.current, outcome, mintAdjustKey);
    const stillLocked = attemptRef.current.locked;
    switch (outcome.kind) {
      case 'applied':
        for (const notice of appliedNotices(outcome.receipt, values, userHandle(user))) notify(notice.text, notice.tone);
        onApplied();
        onClose();
        return;
      case 'unknown':
        setUnknown(outcome.message);
        setProblem(null);
        onOutcomeUnknown();
        void refresh({ background: true });
        return;
      case 'refused':
        if (!stillLocked) setUnknown(null);
        setProblem({ title: refusedTitle(outcome), message: outcome.message });
        void refresh({ background: true });
        return;
      case 'retry':
        setProblem({ title: stillLocked ? 'Still not confirmed' : 'Nothing was changed', message: outcome.message });
        return;
      case 'expired':
        return;
    }
  };

  const review = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (busyRef.current || locked) return;
    const first = checkAdjustForm(form, context);
    if (!first.values) {
      setShowErrors(true);
      if (first.blocked) setProblem({ title: 'Nothing can be sent', message: first.blocked });
      const field = firstProblem(first.errors);
      if (field) focusField(field);
      return;
    }
    busyRef.current = true;
    setProblem(null);
    setWorking('checking');
    try {
      const refreshed = await refresh();
      if (!aliveRef.current) return;
      const fresh = refreshed && refreshed.ok ? refreshed.data : null;
      if (!fresh) {
        setProblem({ title: 'Nothing was sent', message: 'The wallet could not be checked, so nothing was sent. Try again.' });
        return;
      }
      const recheck = checkAdjustForm(form, fresh);
      if (!recheck.values || !recheck.preview) {
        setShowErrors(true);
        if (recheck.blocked) setProblem({ title: 'Nothing can be sent', message: recheck.blocked });
        const field = firstProblem(recheck.errors);
        if (field) focusField(field);
        return;
      }
      const values = recheck.values;
      const prepared = prepareAttempt(attemptRef.current, adjustPayload(values, fresh.balanceKobo), mintAdjustKey);
      if (!prepared) return;
      attemptRef.current = prepared.state;
      setWorking('confirming');
      const decision = await confirm<AdjustOutcome>({
        ...adjustConfirmOptions({
          user,
          values,
          preview: recheck.preview,
          context: fresh,
          seenBalanceKobo: context?.balanceKobo ?? null,
        }),
        returnFocusTo: () => formRef.current,
        action: async () => {
          setWorking('sending');
          const outcome = classifyAdjust(await apiRequest(endpoint, {
            method: 'POST',
            body: prepared.body,
            select: toAdjustReceipt,
          }));
          if (outcome.kind === 'retry') {
            setWorking('confirming');
            throw new Error(outcome.message);
          }
          return outcome;
        },
      });
      if (decision?.value && aliveRef.current) settle(decision.value, values);
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setWorking(null);
    }
  };

  const retrySafely = async () => {
    if (busyRef.current) return;
    const body = retryBody(attemptRef.current);
    if (!body) return;
    busyRef.current = true;
    setProblem(null);
    setWorking('retrying');
    try {
      const outcome = classifyAdjust(await apiRequest(endpoint, { method: 'POST', body, select: toAdjustReceipt }));
      if (aliveRef.current) settle(outcome, { direction: body.direction, amountKobo: toKobo(body.amount) ?? 0 });
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setWorking(null);
    }
  };

  const allowance = context ? allowanceOf(context) : null;
  const reasonOther = form.reasonChoice === OTHER_CHOICE;
  const noteOther = form.noteChoice === OTHER_CHOICE;
  const noteLength = characters(form.noteText.trim());
  const note = noteOther ? form.noteText.trim() : form.noteChoice;
  const amountHelp = allowance
    ? `Up to ${formatKobo(allowance.perAdjustmentKobo)} at once.${
      allowance.leftTodayKobo === null ? '' : ` ${formatKobo(allowance.leftTodayKobo)} of your daily limit is left today.`
    }`
    : 'In naira, with up to 2 decimal places.';

  return (
    <SidePanel
      open
      wide
      onClose={() => void requestClose()}
      title="Adjust wallet"
      subtitle={userSummary(user)}
      returnFocusTo={returnFocusTo}
      footer={
        <div className={s.footer}>
          <p className={s.footerStatus} role="status">{working ? WORKING_TEXT[working] : null}</p>
          <div className={s.footerActions}>
            <Button type="button" variant="ghost" aria-disabled={busy || undefined} onClick={() => void requestClose()}>
              {locked ? 'Close' : 'Cancel'}
            </Button>
            {locked ? (
              <Button
                type="button"
                variant="primary"
                leftIcon={<RotateCw size={14} aria-hidden />}
                loading={working === 'retrying'}
                disabled={busy && working !== 'retrying'}
                onClick={() => void retrySafely()}
              >
                Retry safely
              </Button>
            ) : (
              <Button
                type="submit"
                form={formId}
                variant="primary"
                loading={working === 'checking' || working === 'sending'}
                disabled={!context || busy}
              >
                Review adjustment
              </Button>
            )}
          </div>
        </div>
      }
    >
      {!context ? (
        resource.error ? (
          <ErrorState
            compact
            title="The wallet could not be loaded"
            message={resource.error.kind === 'parse' ? 'The server sent an incomplete answer.' : resource.error.message}
            requestId={resource.error.requestId}
            onRetry={() => void refresh()}
            retrying={resource.isRefreshing || resource.isInitialLoading}
          />
        ) : (
          <div role="status" aria-label="Loading the wallet">
            <SkeletonLines rows={6} />
          </div>
        )
      ) : (
        <form
          ref={formRef}
          id={formId}
          className={s.form}
          tabIndex={-1}
          noValidate
          aria-busy={busy || undefined}
          onSubmit={(event) => void review(event)}
        >
          {locked ? <UnknownOutcomeNotice message={unknown} sent={sentSummary(attemptRef.current)} /> : null}
          {problem ? (
            <Notice tone="danger" title={problem.title} announce="assertive">
              {problem.message}
            </Notice>
          ) : null}
          <AdjustNotices context={context} />

          <section className={s.section}>
            <h3 className={s.heading}>Wallet</h3>
            <WalletSummary user={user} context={context} />
          </section>

          <section className={s.section}>
            <h3 className={s.heading}>Adjustment</h3>
            <div data-field="direction">
              <RadioGroup<AdjustDirection>
                name={directionName}
                legend="Direction"
                required
                orientation="horizontal"
                disabled={frozenFields}
                value={form.direction}
                onChange={chooseDirection}
                error={errors.direction}
                options={[
                  {
                    value: 'credit',
                    label: 'Credit',
                    description: 'Add money to the wallet',
                    disabled: context.emergencyMode === true,
                  },
                  { value: 'debit', label: 'Debit', description: 'Take money out of the wallet' },
                ]}
              />
            </div>
            <div data-field="amount">
              <FieldShell label="Amount (₦)" required error={errors.amount} help={amountHelp}>
                <Input
                  mono
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="5000.00"
                  value={form.amount}
                  readOnly={frozenFields}
                  onChange={(event) => update({ amount: event.target.value })}
                />
              </FieldShell>
            </div>
            <BalancePreviewLine preview={check.preview} />
          </section>

          <section className={s.section}>
            <h3 className={s.heading}>Internal record</h3>
            <div data-field="reason">
              <RadioGroup
                name={reasonName}
                legend="Reason (internal)"
                required
                disabled={frozenFields}
                value={form.reasonChoice || null}
                onChange={(next) => update({ reasonChoice: next })}
                error={reasonOther ? undefined : errors.reason}
                help="Recorded on the adjustment and in the audit log. The user never sees it."
                options={[
                  ...REASON_PRESETS.map((preset) => ({ value: preset, label: preset })),
                  { value: OTHER_CHOICE, label: 'Other' },
                ]}
              />
              {reasonOther ? (
                <FieldShell error={errors.reason}>
                  <Textarea
                    aria-label="Other reason"
                    rows={3}
                    maxLength={REASON_MAX}
                    placeholder="Explain why this wallet is being adjusted"
                    value={form.reasonText}
                    readOnly={frozenFields}
                    onChange={(event) => update({ reasonText: event.target.value })}
                  />
                </FieldShell>
              ) : null}
            </div>
            <div data-field="reference">
              <FieldShell
                label="Reference (internal, optional)"
                error={errors.reference}
                help="A ticket, card submission or transaction ID that explains the adjustment. The user never sees it."
              >
                <Input
                  autoComplete="off"
                  maxLength={REFERENCE_MAX}
                  value={form.reference}
                  readOnly={frozenFields}
                  onChange={(event) => update({ reference: event.target.value })}
                />
              </FieldShell>
            </div>
          </section>

          <section className={s.section}>
            <h3 className={s.heading}>What the user sees</h3>
            <div data-field="note">
              <RadioGroup
                name={noteName}
                legend="Message to the user"
                required
                disabled={frozenFields}
                value={form.noteChoice}
                onChange={(next) => update({ noteChoice: next })}
                error={noteOther ? undefined : errors.note}
                options={[
                  ...notePresets(form.direction).map((preset) => ({ value: preset, label: preset })),
                  { value: OTHER_CHOICE, label: 'Write my own' },
                ]}
              />
              {noteOther ? (
                <FieldShell
                  error={errors.note}
                  help={`${noteLength}/${NOTE_MAX} characters. Shown in the notification and the transaction history.`}
                >
                  <Textarea
                    aria-label="Your message to the user"
                    rows={2}
                    maxLength={NOTE_MAX}
                    placeholder="A short, plain message for the user"
                    value={form.noteText}
                    readOnly={frozenFields}
                    onChange={(event) => update({ noteText: event.target.value })}
                  />
                </FieldShell>
              ) : null}
            </div>
            <MessagePreview direction={form.direction} amountKobo={check.amountKobo} note={note} context={context} />
          </section>

          <section className={s.section}>
            <h3 className={s.heading}>Recent adjustments</h3>
            <RecentAdjustments rows={context.history} />
          </section>
        </form>
      )}
    </SidePanel>
  );
}
