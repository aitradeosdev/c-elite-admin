'use client';

import { Fragment, useEffect, useId, useRef, useState, type Ref } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button, Card, CardBody, CardHeader, ErrorState, LinkButton, Notice, SkeletonLines, StatusDot, useConfirm,
  useResource, useToast,
} from '../../_ui';
import { apiRequest, type ApiFailure } from '../../lib/apiClient';
import { SecurityRequestError, reauthenticate } from '../../_security/reauth';
import { policyOffOptions, policyOnOptions } from './confirmOptions';
import {
  GRACE_DAYS, POLICY_CARD_ID, POLICY_ENDPOINT, POLICY_RESOURCE_KEY, POLICY_SUBTITLE, POLICY_TITLE,
  PROFILE_TWO_STEP_HREF, blockerText, classifyPolicyChange, handleOf, policyChangedText, policyPayload,
  policyUnchangedText, policyView, reasonProblem, rosterHref, rosterText, toPolicyChange, toPolicyState,
  type PolicyMode, type PolicyOutcome, type PolicyState, type PolicyView,
} from './securityPolicy';
import s from './page.module.css';

const AUDIT_WARNING = 'The two-step requirement was changed, but the change could not be written to the audit log.';
const UNCONFIRMED = 'The change was sent, but no response came back, so the requirement may or may not have changed. The card now shows the current state; check it before trying again.';

const fetchPolicy = (signal: AbortSignal) => apiRequest(POLICY_ENDPOINT, { signal, select: toPolicyState });

async function confirmIdentity(code: string): Promise<'ok' | 'expired'> {
  try {
    await reauthenticate('otp', code);
    return 'ok';
  } catch (error) {
    if (error instanceof SecurityRequestError && error.failure.kind === 'http' && error.failure.status === 401) {
      return 'expired';
    }
    throw error;
  }
}

function actionHelp(view: PolicyView): string {
  if (view.blocker) return blockerText(view.blocker);
  return view.action === 'on'
    ? `Admins get ${GRACE_DAYS} days to set it up. You confirm with a code from your authenticator app.`
    : 'Admins who use it keep it. You confirm with a code from your authenticator app.';
}

export interface SecurityPolicyCardProps {
  headingId: string;
  state: PolicyState | undefined;
  error: ApiFailure | null;
  retrying: boolean;
  busy: boolean;
  now?: Date;
  buttonRef?: Ref<HTMLButtonElement>;
  onRetry: () => void;
  onChange: (mode: PolicyMode) => void;
}

export function SecurityPolicyCard({
  headingId, state, error, retrying, busy, now, buttonRef, onRetry, onChange,
}: SecurityPolicyCardProps) {
  const helpId = useId();
  const view = state ? policyView(state, now ?? new Date()) : null;

  return (
    <Card id={POLICY_CARD_ID} role="region" aria-labelledby={headingId} className={s.policyCard}>
      <CardHeader
        title={<h2 id={headingId} className={s.sectionHeading} tabIndex={-1}>{POLICY_TITLE}</h2>}
        subtitle={POLICY_SUBTITLE}
        actions={view ? <StatusDot status={view.phase} tone={view.statusTone} label={view.statusLabel} /> : undefined}
      />
      <CardBody className={s.policyBody}>
        {!state || !view ? (
          error ? (
            <ErrorState
              compact
              title="The two-step requirement could not be loaded"
              message={error.message}
              requestId={error.requestId}
              onRetry={onRetry}
              retrying={retrying}
            />
          ) : (
            <div aria-busy="true">
              <span className={s.srOnly} role="status">Loading the two-step requirement…</span>
              <SkeletonLines rows={3} />
            </div>
          )
        ) : (
          <>
            {error ? (
              <Notice
                tone="warning"
                compact
                flush
                announce="polite"
                actions={<Button variant="ghost" size="sm" onClick={onRetry}>Try again</Button>}
              >
                The two-step requirement could not be refreshed. {error.message}
              </Notice>
            ) : null}
            {view.phase === 'grace' && view.grace ? (
              <Notice tone="warning" flush title={`Required from ${view.grace.date}`}>
                Admins without it are asked to set it up by {view.grace.dateTime}. After that they must set it up when
                they sign in.
              </Notice>
            ) : null}
            {view.phase === 'required' ? (
              <Notice tone="neutral" flush>
                {view.grace ? `Required since ${view.grace.date}.` : 'Required.'} Admins without it set it up the next
                time they sign in.
              </Notice>
            ) : null}
            <div className={s.roster}>
              <p className={s.rosterLine}>{rosterText(state.roster)}</p>
              {state.roster.missing.length > 0 ? (
                <p className={s.rosterLine}>
                  Not set up yet:{' '}
                  {state.roster.missing.map((admin, index) => (
                    <Fragment key={admin.id}>
                      {index > 0 ? ', ' : null}
                      <Link href={rosterHref(admin.id)} className={s.rosterLink}>{handleOf(admin)}</Link>
                    </Fragment>
                  ))}
                </p>
              ) : null}
            </div>
            <div className={s.policyRow}>
              <p id={helpId} className={s.policyMeta}>{actionHelp(view)}</p>
              <Button
                ref={buttonRef}
                type="button"
                variant={view.action === 'on' ? 'primary' : 'dangerSubtle'}
                loading={busy}
                disabled={view.blocker !== null}
                aria-describedby={helpId}
                onClick={() => onChange(view.action === 'on' ? 'all' : 'off')}
              >
                {view.actionLabel}
              </Button>
            </div>
            {view.blocker === 'two_step' ? (
              <div className={s.policyLinks}>
                <LinkButton href={PROFILE_TWO_STEP_HREF} variant="secondary" size="sm">Open Profile</LinkButton>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

export function SecurityPolicySection() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const headingId = useId();
  const policy = useResource<PolicyState>(POLICY_RESOURCE_KEY, fetchPolicy);
  const { refresh } = policy;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (window.location.hash !== `#${POLICY_CARD_ID}`) return;
    document.getElementById(POLICY_CARD_ID)?.scrollIntoView({ block: 'start' });
    document.getElementById(headingId)?.focus({ preventScroll: true });
  }, [headingId]);

  const report = (outcome: PolicyOutcome) => {
    switch (outcome.kind) {
      case 'done': {
        const { change } = outcome;
        if (change.changed) {
          toast.show(policyChangedText(change), 'success');
          if (!change.auditRecorded) toast.show(change.warning ?? AUDIT_WARNING, 'warning');
        } else {
          toast.show(policyUnchangedText(change.mode));
        }
        router.refresh();
        return;
      }
      case 'conflict':
      case 'reauth':
        toast.show(outcome.message, 'warning');
        return;
      case 'denied':
        toast.show(outcome.message, 'error');
        router.refresh();
        return;
      case 'unknown':
        toast.show(UNCONFIRMED, 'error');
        return;
      default:
        return;
    }
  };

  const change = async (mode: PolicyMode) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let sent = false;
    let settled = false;
    try {
      const fresh = await refresh();
      if (!fresh || !fresh.ok) {
        if (fresh?.error.status === 401) return;
        const detail = fresh ? ` ${fresh.error.message}` : '';
        toast.show(`Could not check the two-step requirement, so nothing was changed.${detail}`, 'error');
        return;
      }
      const state = fresh.data;
      if (state.mode === mode) {
        toast.show(
          mode === 'all'
            ? 'Two-step sign-in is already required. Another admin turned it on.'
            : 'Two-step sign-in is already not required. Another admin turned it off.',
          'warning',
        );
        return;
      }
      const view = policyView(state);
      if (view.blocker) {
        toast.show(blockerText(view.blocker), 'warning');
        return;
      }
      setBusy(false);
      const decision = await confirm<PolicyOutcome>({
        ...(mode === 'all' ? policyOnOptions(state) : policyOffOptions(state)),
        action: async ({ reason, credential }) => {
          const short = reasonProblem(reason);
          if (short) throw new Error(short);
          const identity = await confirmIdentity(credential ?? '');
          if (identity === 'expired') return { kind: 'expired' };
          sent = true;
          const outcome = classifyPolicyChange(await apiRequest(POLICY_ENDPOINT, {
            method: 'PATCH',
            body: policyPayload(mode, reason),
            select: toPolicyChange,
          }));
          if (outcome.kind === 'refused') throw new Error(outcome.message);
          if (outcome.kind === 'reauth' && outcome.code === 'REAUTH_REQUIRED') throw new Error(outcome.message);
          settled = true;
          if (outcome.kind !== 'expired') await refresh({ background: true });
          return outcome;
        },
        returnFocusTo: () => buttonRef.current,
      });
      const outcome = decision?.value;
      if (outcome) report(outcome);
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (sent && !settled) void refresh({ background: true });
    }
  };

  return (
    <SecurityPolicyCard
      headingId={headingId}
      state={policy.data}
      error={policy.error}
      retrying={policy.isInitialLoading || policy.isRefreshing}
      busy={busy}
      buttonRef={buttonRef}
      onRetry={() => void refresh()}
      onChange={(mode) => void change(mode)}
    />
  );
}
