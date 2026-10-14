'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, ShieldCheck } from 'lucide-react';
import {
  Badge, Button, Card, CardBody, CardFooter, CardHeader, DetailRow, ErrorState, Modal, Notice, SkeletonLines,
  notifySessionExpired, useConfirm, useResource, useToast,
} from '../../_ui';
import { apiRequest, type ApiFailure } from '../../lib/apiClient';
import { SETUP_UNAVAILABLE, securityFailureText, type EnrollResult, type EnrollSetup } from '../../lib/adminSecurity';
import { EnrollFlow, type EnrollStage } from '../../_security/EnrollFlow';
import { RecoveryCodes } from '../../_security/RecoveryCodes';
import { replaceRecoveryCodes, startProfileSetup } from './securityActions';
import {
  APP_CALLOUT_TEXT, APP_CALLOUT_TITLE, DONE_LABEL, ENABLED_TOAST, MFA_PATH, NEW_CODES_LABEL, NEW_CODES_MODAL_TITLE,
  SETUP_CONFIRM_LABEL, SETUP_CONFIRM_PATH, SETUP_FINISH_LABEL, SETUP_MODAL_TITLE, SETUP_START_PATH, SET_UP_LABEL,
  TWO_STEP_ANCHOR, TWO_STEP_LOAD_FAILED, TWO_STEP_SUBTITLE, TWO_STEP_TITLE,
  lockEndsAt, newCodesConfirm, setupConfirm, setupFinish, toTwoStepAccount, twoStepView,
  type NewRecoveryCodes, type TwoStepAccount, type TwoStepView,
} from './securityModel';
import { useHashFocus } from './useHashFocus';
import type { ProfileAccount } from './model';
import p from './page.module.css';
import s from './security.module.css';

const MAX_TIMER_MS = 2147483647;
const LOCK_SETTLE_MS = 1000;

function ignoreClose() {}

export interface TwoStepDetailsProps {
  view: TwoStepView;
}

export function TwoStepDetails({ view }: TwoStepDetailsProps) {
  return (
    <>
      {view.notices.map((notice) => (
        <Notice key={notice.key} tone={notice.tone} title={notice.title ?? undefined} flush>
          {notice.text}
        </Notice>
      ))}
      {view.lead ? <p className={s.lead}>{view.lead}</p> : null}
      {view.status === 'active' && view.codes ? (
        <>
          <div className={p.detailRows}>
            <DetailRow label="On since" value={view.onSince} />
            <DetailRow label="Last code used" value={view.lastUsed} wrap />
            <DetailRow label="Recovery codes" value={<Badge tone={view.codes.tone}>{view.codes.text}</Badge>} />
          </div>
          <Notice tone="info" variant="callout" title={APP_CALLOUT_TITLE} flush>{APP_CALLOUT_TEXT}</Notice>
          {view.help ? <p className={s.help}>{view.help}</p> : null}
        </>
      ) : null}
    </>
  );
}

export interface TwoStepPanelProps {
  view: TwoStepView | null;
  failure: ApiFailure | null;
  retrying: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  actionRef?: Ref<HTMLButtonElement>;
  onRetry: () => void;
  onSetUp: () => void;
  onNewCodes: () => void;
  children?: ReactNode;
}

export function TwoStepPanel({
  view, failure, retrying, headingRef, actionRef, onRetry, onSetUp, onNewCodes, children,
}: TwoStepPanelProps) {
  const headingId = useId();
  const icon = view?.locked
    ? <Lock size={12} aria-hidden />
    : view?.status === 'active' ? <ShieldCheck size={12} aria-hidden /> : null;

  return (
    <Card id={TWO_STEP_ANCHOR} role="region" aria-labelledby={headingId} className={s.section}>
      <CardHeader
        className={s.headerWrap}
        title={(
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className={[p.sectionHeading, s.heading].join(' ')}>
            {TWO_STEP_TITLE}
          </h2>
        )}
        subtitle={TWO_STEP_SUBTITLE}
        actions={view ? <Badge tone={view.badge.tone}>{icon}{view.badge.label}</Badge> : undefined}
      />
      <CardBody className={s.stack} aria-busy={view || failure ? undefined : true}>
        {view ? (
          <TwoStepDetails view={view} />
        ) : failure ? (
          <ErrorState
            compact
            title={TWO_STEP_LOAD_FAILED}
            message={failure.message}
            requestId={failure.requestId}
            onRetry={onRetry}
            retrying={retrying}
          />
        ) : (
          <SkeletonLines rows={3} />
        )}
      </CardBody>
      {view ? (
        <CardFooter>
          {view.canSetUp ? (
            <Button ref={actionRef} type="button" variant="primary" onClick={onSetUp}>{SET_UP_LABEL}</Button>
          ) : (
            <Button
              ref={actionRef}
              type="button"
              variant="secondary"
              disabled={!view.canReplaceCodes}
              onClick={onNewCodes}
            >
              {NEW_CODES_LABEL}
            </Button>
          )}
        </CardFooter>
      ) : null}
      {children}
    </Card>
  );
}

export interface TwoStepCardProps {
  account: ProfileAccount;
  onSignInChange?: () => void;
}

export function TwoStepCard({ account, onSignInChange }: TwoStepCardProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const mfa = useResource<TwoStepAccount>(
    'profile-two-step',
    (signal) => apiRequest(MFA_PATH, { signal, select: toTwoStepAccount }),
  );
  const { refresh } = mfa;
  const [setup, setSetup] = useState<EnrollSetup | null>(null);
  const [setupRun, setSetupRun] = useState(0);
  const [stage, setStage] = useState<EnrollStage>('setup');
  const [newCodes, setNewCodes] = useState<NewRecoveryCodes | null>(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const busy = useRef(false);
  const alive = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const changed = useRef(onSignInChange);

  const data = mfa.data;
  const view = data ? twoStepView(data, { isSuperAdmin: account.isSuperAdmin }) : null;
  const lockEnds = lockEndsAt(data);

  useEffect(() => {
    changed.current = onSignInChange;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useHashFocus(TWO_STEP_ANCHOR, data !== undefined || mfa.error !== null, headingRef);

  useEffect(() => {
    if (lockEnds === null) return;
    const wait = Math.min(Math.max(0, lockEnds - Date.now()) + LOCK_SETTLE_MS, MAX_TIMER_MS);
    const timer = window.setTimeout(() => {
      void refresh({ background: true });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [lockEnds, refresh]);

  const focusTarget = useCallback(() => actionRef.current ?? headingRef.current, []);

  const beginSetup = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    let attempted = false;
    try {
      const decision = await confirm<EnrollSetup>({
        ...setupConfirm(),
        returnFocusTo: focusTarget,
        action: async ({ credential }) => {
          attempted = true;
          return startProfileSetup(credential ?? '');
        },
      });
      if (!alive.current) return;
      if (decision?.value) {
        setStage('setup');
        setSetup(decision.value);
        setSetupRun((run) => run + 1);
      } else if (attempted) {
        void refresh({ background: true });
      }
    } finally {
      busy.current = false;
    }
  }, [confirm, focusTarget, refresh]);

  const closeSetup = useCallback(() => {
    setSetup(null);
    void refresh({ background: true });
  }, [refresh]);

  const setupEnded = useCallback((failure: ApiFailure) => {
    setSetup(null);
    if (failure.kind === 'http' && failure.status === 401) return;
    void refresh({ background: true });
    if (failure.kind === 'http' && failure.code === 'REAUTH_REQUIRED') {
      void beginSetup();
      return;
    }
    notify(securityFailureText(failure, SETUP_UNAVAILABLE), 'error');
  }, [beginSetup, notify, refresh]);

  const finishSetup = useCallback((result: EnrollResult) => {
    setSetup(null);
    notify(ENABLED_TOAST, 'success');
    if (setupFinish(result).expire) {
      notifySessionExpired();
      return;
    }
    void refresh();
    changed.current?.();
    router.refresh();
  }, [notify, refresh, router]);

  const getNewCodes = useCallback(async () => {
    if (busy.current || !data) return;
    busy.current = true;
    let attempted = false;
    try {
      const decision = await confirm<NewRecoveryCodes>({
        ...newCodesConfirm(data.recoveryCodesLeft),
        returnFocusTo: focusTarget,
        action: async ({ credential }) => {
          attempted = true;
          return replaceRecoveryCodes(credential ?? '');
        },
      });
      if (!alive.current) return;
      if (decision?.value) {
        setCodesSaved(false);
        setNewCodes(decision.value);
        if (decision.value.warning) notify(decision.value.warning, 'warning');
      }
      if (decision?.value || attempted) void refresh({ background: true });
    } finally {
      busy.current = false;
    }
  }, [confirm, data, focusTarget, notify, refresh]);

  const closeCodes = useCallback(() => {
    setNewCodes(null);
    setCodesSaved(false);
  }, []);

  return (
    <TwoStepPanel
      view={view}
      failure={mfa.error}
      retrying={mfa.isInitialLoading}
      headingRef={headingRef}
      actionRef={actionRef}
      onRetry={() => void refresh()}
      onSetUp={() => void beginSetup()}
      onNewCodes={() => void getNewCodes()}
    >
      {setup ? (
        <Modal
          open
          size="md"
          title={SETUP_MODAL_TITLE}
          static={stage === 'codes'}
          hideClose={stage === 'codes'}
          onClose={closeSetup}
          returnFocusTo={focusTarget}
        >
          <EnrollFlow
            key={setupRun}
            startPath={SETUP_START_PATH}
            confirmPath={SETUP_CONFIRM_PATH}
            username={account.username}
            setup={setup}
            confirmLabel={SETUP_CONFIRM_LABEL}
            finishLabel={SETUP_FINISH_LABEL}
            headingLevel={2}
            onStageChange={setStage}
            onEnded={setupEnded}
            onFinish={finishSetup}
          />
        </Modal>
      ) : null}
      {newCodes ? (
        <Modal
          open
          static
          hideClose
          size="md"
          title={NEW_CODES_MODAL_TITLE}
          onClose={ignoreClose}
          returnFocusTo={focusTarget}
          footer={(
            <Button type="button" variant="primary" disabled={!codesSaved} onClick={closeCodes}>
              {DONE_LABEL}
            </Button>
          )}
        >
          <RecoveryCodes
            codes={newCodes.codes}
            username={account.username}
            saved={codesSaved}
            onSavedChange={setCodesSaved}
          />
        </Modal>
      ) : null}
    </TwoStepPanel>
  );
}
