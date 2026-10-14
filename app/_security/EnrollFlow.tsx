'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../_ui/Button';
import { FieldShell } from '../_ui/Field';
import { Notice } from '../_ui/Notice';
import { Spinner } from '../_ui/Misc';
import { apiRequest, type ApiFailure } from '../lib/apiClient';
import {
  ENTER_OTP, SETUP_UNAVAILABLE, classifyEnrollFailure, isCompleteOtp, securityFailureText, toEnrollConfirmed,
  toEnrollSetup, type EnrollConfirmed, type EnrollResult, type EnrollSetup,
} from '../lib/adminSecurity';
import { OtpField } from './OtpField';
import { QrImage } from './QrImage';
import { RecoveryCodes } from './RecoveryCodes';
import { SetupKey } from './SetupKey';
import s from './security.module.css';

export type EnrollStage = 'starting' | 'setup' | 'codes';

export const SCAN_HEADING = 'Scan the QR code';
export const SCAN_LEAD =
  'Scan this QR code with an authenticator app such as Google Authenticator, Microsoft Authenticator, 1Password or Authy.';
export const CANT_SCAN = "Can't scan it?";
export const OPEN_IN_APP = 'Open in my authenticator app';
export const ENROLL_CODE_LABEL = 'Enter the 6-digit code it shows';
export const CODES_HEADING = 'Save your recovery codes';
export const DEFAULT_CONFIRM_LABEL = 'Turn on and continue';
export const DEFAULT_FINISH_LABEL = 'Continue to the console';
export const TRY_AGAIN = 'Try again';
export const START_AGAIN = 'Start again';

export interface EnrollFlowProps {
  startPath: string;
  confirmPath: string;
  username: string;
  setup?: EnrollSetup | null;
  confirmLabel?: string;
  finishLabel?: string;
  headingLevel?: 2 | 3;
  onFinish: (result: EnrollResult) => void;
  onEnded?: (failure: ApiFailure) => void;
  onStageChange?: (stage: EnrollStage) => void;
}

interface Problem {
  message: string;
  restart: boolean;
}

export function EnrollFlow({
  startPath,
  confirmPath,
  username,
  setup: initialSetup = null,
  confirmLabel = DEFAULT_CONFIRM_LABEL,
  finishLabel = DEFAULT_FINISH_LABEL,
  headingLevel = 3,
  onFinish,
  onEnded,
  onStageChange,
}: EnrollFlowProps) {
  const [setup, setSetup] = useState<EnrollSetup | null>(initialSetup);
  const [stage, setStage] = useState<EnrollStage>(initialSetup ? 'setup' : 'starting');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState<EnrollConfirmed | null>(null);
  const [saved, setSaved] = useState(false);
  const alive = useRef(false);
  const started = useRef(initialSetup !== null);
  const restarted = useRef(false);
  const handlers = useRef({ onEnded, onStageChange });
  const codeRef = useRef<HTMLInputElement>(null);
  const scanHeadingRef = useRef<HTMLHeadingElement>(null);
  const codesHeadingRef = useRef<HTMLHeadingElement>(null);
  const baseId = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const scanHeadingId = `${baseId}-scan`;
  const codesHeadingId = `${baseId}-codes`;
  const codeId = `${baseId}-code`;

  useEffect(() => {
    handlers.current = { onEnded, onStageChange };
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const end = useCallback((failure: ApiFailure) => {
    const handler = handlers.current.onEnded;
    if (handler) handler(failure);
    else setProblem({ message: securityFailureText(failure, SETUP_UNAVAILABLE), restart: false });
  }, []);

  const start = useCallback(async (restart: boolean) => {
    restarted.current = restart;
    setPending(true);
    setProblem(null);
    setCode('');
    setCodeError(null);
    setStage('starting');
    const result = await apiRequest<EnrollSetup>(startPath, { method: 'POST', body: {}, select: toEnrollSetup });
    if (!alive.current) return;
    setPending(false);
    if (result.ok) {
      setSetup(result.data);
      setStage('setup');
      return;
    }
    const outcome = classifyEnrollFailure(result.error, 'start');
    if (outcome.kind === 'ended') end(result.error);
    else if (outcome.kind === 'problem') setProblem({ message: outcome.message, restart: outcome.restart });
  }, [startPath, end]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start(false);
  }, [start]);

  useEffect(() => {
    handlers.current.onStageChange?.(stage);
    if (stage === 'codes') codesHeadingRef.current?.focus();
    if (stage === 'setup' && restarted.current) {
      restarted.current = false;
      scanHeadingRef.current?.focus();
    }
  }, [stage]);

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || stage !== 'setup') return;
    if (!isCompleteOtp(code)) {
      setCodeError(ENTER_OTP);
      codeRef.current?.focus();
      return;
    }
    setPending(true);
    setCodeError(null);
    setProblem(null);
    const result = await apiRequest<EnrollConfirmed>(confirmPath, {
      method: 'POST',
      body: { otp: code },
      select: toEnrollConfirmed,
    });
    if (!alive.current) return;
    setPending(false);
    if (result.ok) {
      setCode('');
      setSaved(false);
      setConfirmed(result.data);
      setStage('codes');
      return;
    }
    const outcome = classifyEnrollFailure(result.error, 'confirm');
    if (outcome.kind === 'ended') {
      end(result.error);
      return;
    }
    if (outcome.kind === 'field') {
      setCode('');
      setCodeError(outcome.message);
      codeRef.current?.focus();
      return;
    }
    setProblem({ message: outcome.message, restart: outcome.restart });
  };

  const problemNotice = problem ? (
    <Notice
      tone="danger"
      announce
      flush
      actions={problem.restart ? (
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => void start(true)}>
          {stage === 'starting' ? TRY_AGAIN : START_AGAIN}
        </Button>
      ) : undefined}
    >
      {problem.message}
    </Notice>
  ) : null;

  if (stage === 'codes' && confirmed) {
    return (
      <div className={s.flow}>
        <section className={s.section} aria-labelledby={codesHeadingId}>
          <Heading id={codesHeadingId} ref={codesHeadingRef} tabIndex={-1} className={s.stepHeading}>
            {CODES_HEADING}
          </Heading>
          <RecoveryCodes codes={confirmed.recoveryCodes} username={username} saved={saved} onSavedChange={setSaved} />
          <div className={s.actions}>
            <Button
              type="button"
              variant="primary"
              disabled={!saved}
              onClick={() => onFinish({ sessionRenewed: confirmed.sessionRenewed })}
            >
              {finishLabel}
            </Button>
          </div>
        </section>
      </div>
    );
  }

  if (stage === 'starting' || !setup) {
    return (
      <div className={s.flow}>
        {problemNotice ?? (
          <div className={s.loading}>
            <Spinner size={20} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={s.flow}>
      <section className={s.section} aria-labelledby={scanHeadingId}>
        <Heading id={scanHeadingId} ref={scanHeadingRef} tabIndex={-1} className={s.stepHeading}>
          {SCAN_HEADING}
        </Heading>
        <p className={s.lead}>{SCAN_LEAD}</p>
        <QrImage src={setup.qrDataUri} />
        <a className={s.appLink} href={setup.otpauthUri}>{OPEN_IN_APP}</a>
        <details className={s.details}>
          <summary className={s.summary}>{CANT_SCAN}</summary>
          <SetupKey secret={setup.secretDisplay} accountLabel={setup.accountLabel} />
        </details>
      </section>
      <form className={s.section} onSubmit={confirm} noValidate>
        <FieldShell label={ENROLL_CODE_LABEL} htmlFor={codeId} error={codeError}>
          <OtpField
            id={codeId}
            ref={codeRef}
            value={code}
            readOnly={pending}
            onValueChange={(next) => {
              setCode(next);
              if (codeError) setCodeError(null);
            }}
          />
        </FieldShell>
        {problemNotice}
        <div className={s.actions}>
          <Button type="submit" variant="primary" loading={pending}>{confirmLabel}</Button>
        </div>
      </form>
    </div>
  );
}
