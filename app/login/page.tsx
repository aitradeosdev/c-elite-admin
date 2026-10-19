'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Notice } from '../_ui/Notice';
import { EnrollFlow, type EnrollStage } from '../_security/EnrollFlow';
import { apiRequest, type ApiFailure } from '../lib/apiClient';
import { OTP_INPUT_ATTRIBUTES, RECOVERY_INPUT_ATTRIBUTES, sanitizeOtp } from '../lib/adminSecurity';
import { AuthShell, ButtonText, FormError } from './AuthParts';
import {
  CODE_HEADING, CODE_HELP, CODE_LABEL, CONTINUE_LABEL, ENROLL_CONFIRM_LABEL, ENROLL_CONFIRM_PATH, ENROLL_FINISH_LABEL,
  ENROLL_HEADING, ENROLL_HELP, ENROLL_REQUIRED, ENROLL_START_PATH, FOOTNOTE, FORGOT_LABEL, FORGOT_PATH,
  OPEN_PROFILE_LABEL, PROFILE_TWO_STEP_HREF, RECOVERED_HEADING, RECOVERY_HELP, RECOVERY_HINT, RECOVERY_LABEL,
  SIGN_IN_LABEL, SIGN_IN_PATH, SIGNING_IN_LABEL, SWITCH_ACCOUNT, USE_APP, USE_RECOVERY, VERIFY_LABEL, VERIFY_PATH,
  VERIFYING_LABEL,
  accountKey, classifySignIn, classifyVerify, codeError, codeModeOf, credentialError, credentialsComplete,
  enrollEndedMessage, lockApplies, lockFrom, recoveredNotice, safeNext, signInBody, signingInAs, verifyBody,
  type CredentialField, type Credentials, type LoginStep, type SignInLock, type SignInOutcome,
} from './model';
import s from './login.module.css';

type FocusTarget = 'email' | 'password' | 'code' | 'heading';

interface FocusRequest {
  target: FocusTarget;
  select: boolean;
  seq: number;
}

const UNTOUCHED: Readonly<Record<CredentialField, boolean>> = Object.freeze({
  email: false,
  username: false,
  password: false,
});

const ALL_TOUCHED: Readonly<Record<CredentialField, boolean>> = Object.freeze({
  email: true,
  username: true,
  password: true,
});

const MAX_TIMER_MS = 2147483647;
const STEP_HEADING_ID = 'login-step-heading';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams?.get('next'));

  const [step, setStep] = useState<LoginStep>('credentials');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Record<CredentialField, boolean>>(UNTOUCHED);
  const [account, setAccount] = useState('');
  const [code, setCode] = useState('');
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lock, setLock] = useState<SignInLock | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [codesLeft, setCodesLeft] = useState(0);
  const [setupConfirmed, setSetupConfirmed] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest>({ target: 'email', select: false, seq: 0 });
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lockMessage = useRef<string | null>(null);

  const values: Credentials = { email, username, password };
  const currentAccount = accountKey(values);
  const locked = lockApplies(lock, currentAccount);
  const working = busy || leaving;
  const mode = codeModeOf(step);

  useEffect(() => {
    const target = focusRequest.target;
    const node = target === 'email'
      ? emailRef.current
      : target === 'password'
        ? passwordRef.current
        : target === 'code'
          ? codeRef.current
          : headingRef.current;
    if (!node) return;
    node.focus();
    if (focusRequest.select && node instanceof HTMLInputElement) node.select();
  }, [focusRequest]);

  useEffect(() => {
    if (!lock) return;
    const wait = Math.max(0, Math.min(lock.until - Date.now(), MAX_TIMER_MS));
    const timer = window.setTimeout(() => setLock(null), wait);
    return () => window.clearTimeout(timer);
  }, [lock]);

  useEffect(() => {
    if (lock) return;
    const message = lockMessage.current;
    if (message === null) return;
    lockMessage.current = null;
    setError((current) => (current === message ? '' : current));
  }, [lock]);

  const requestFocus = (target: FocusTarget, select = false) => {
    setFocusRequest((current) => ({ target, select, seq: current.seq + 1 }));
  };

  const fieldError = (name: CredentialField): string | null => (touched[name] ? credentialError(name, values) : null);

  const markTouched = (name: CredentialField) => setTouched((current) => ({ ...current, [name]: true }));

  const resetCode = () => {
    setCode('');
    setCodeProblem(null);
  };

  const leave = () => {
    setLeaving(true);
    router.push(next);
  };

  const returnToCredentials = (message: string, target: FocusTarget) => {
    setStep('credentials');
    setPassword('');
    setShowPassword(false);
    setTouched((current) => ({ ...current, password: false }));
    resetCode();
    setSetupConfirmed(false);
    setError(message);
    requestFocus(target);
  };

  const apply = (outcome: SignInOutcome) => {
    switch (outcome.kind) {
      case 'done':
        leave();
        return;
      case 'code':
      case 'enroll':
        setAccount(outcome.username ?? username.trim());
        setPassword('');
        setShowPassword(false);
        resetCode();
        setError('');
        setSetupConfirmed(false);
        setStep(outcome.kind);
        requestFocus(outcome.kind === 'code' ? 'code' : 'heading');
        return;
      case 'recovered':
        resetCode();
        setError('');
        setCodesLeft(outcome.codesLeft);
        setStep('recovered');
        requestFocus('heading');
        return;
      case 'ended':
        returnToCredentials(outcome.message, 'password');
        return;
      case 'locked': {
        if (step === 'code' || step === 'recovery') resetCode();
        const nextLock = lockFrom(outcome.lockedUntil, currentAccount);
        lockMessage.current = nextLock ? outcome.message : null;
        setError(outcome.message);
        setLock(nextLock);
        return;
      }
      case 'error':
        setError(outcome.message);
        if (outcome.field === 'otp') {
          setCode('');
          requestFocus('code');
        } else if (outcome.field === 'recovery_code') {
          requestFocus('code', true);
        }
        return;
    }
  };

  const submitCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(ALL_TOUCHED);
    if (!credentialsComplete(values) || working || locked) return;
    setBusy(true);
    setError('');
    const result = await apiRequest(SIGN_IN_PATH, { method: 'POST', body: signInBody(values) });
    setBusy(false);
    apply(classifySignIn(result));
  };

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working || locked) return;
    const problem = codeError(mode, code);
    if (problem) {
      setCodeProblem(problem);
      requestFocus('code');
      return;
    }
    setCodeProblem(null);
    setBusy(true);
    setError('');
    const result = await apiRequest(VERIFY_PATH, { method: 'POST', body: verifyBody(mode, code) });
    setBusy(false);
    apply(classifyVerify(result));
  };

  const switchMode = () => {
    setStep(mode === 'otp' ? 'recovery' : 'code');
    resetCode();
    if (!locked) setError('');
    requestFocus('code');
  };

  const switchAccount = () => returnToCredentials(locked ? error : '', 'email');

  const enrollStageChanged = (stage: EnrollStage) => setSetupConfirmed(stage === 'codes');

  const enrollEnded = (failure: ApiFailure) => returnToCredentials(enrollEndedMessage(failure), 'password');

  const accountLine = (
    <p className={s.stepLead}>
      Signing in as <strong className={s.account} translate="no">{signingInAs(account)}</strong>
    </p>
  );

  let body: ReactNode;
  if (step === 'code' || step === 'recovery') {
    const otp = mode === 'otp';
    const codeId = otp ? 'login-otp' : 'login-recovery-code';
    const messageId = `${codeId}-${codeProblem ? 'error' : 'help'}`;
    body = (
      <form onSubmit={submitCode} noValidate aria-labelledby={STEP_HEADING_ID}>
        <h2 id={STEP_HEADING_ID} className={s.stepTitle}>{CODE_HEADING}</h2>
        {accountLine}
        <div className={s.field}>
          <label className={s.label} htmlFor={codeId}>{otp ? CODE_LABEL : RECOVERY_LABEL}</label>
          <input
            key={mode}
            id={codeId}
            ref={codeRef}
            name={otp ? 'otp' : 'recovery_code'}
            className={[s.input, s.codeInput, codeProblem && s.inputInvalid].filter(Boolean).join(' ')}
            {...(otp ? OTP_INPUT_ATTRIBUTES : RECOVERY_INPUT_ATTRIBUTES)}
            value={code}
            onChange={(e) => {
              setCode(otp ? sanitizeOtp(e.target.value) : e.target.value);
              if (codeProblem) setCodeProblem(null);
            }}
            readOnly={working}
            aria-invalid={codeProblem ? true : undefined}
            aria-describedby={messageId}
          />
          {codeProblem ? (
            <p id={messageId} className={s.fieldError} role="alert">{codeProblem}</p>
          ) : (
            <p id={messageId} className={s.help}>{otp ? CODE_HELP : RECOVERY_HELP}</p>
          )}
        </div>

        <FormError message={error} />

        <button type="submit" className={s.submit} disabled={working || locked}>
          <ButtonText working={working} idle={VERIFY_LABEL} busy={VERIFYING_LABEL} />
        </button>

        <div className={s.altActions}>
          <button type="button" className={s.linkBtn} onClick={switchMode} disabled={working}>
            {otp ? USE_RECOVERY : USE_APP}
          </button>
          <button type="button" className={s.linkBtn} onClick={switchAccount} disabled={working}>
            {SWITCH_ACCOUNT}
          </button>
        </div>
        {otp ? null : <p className={s.hint}>{RECOVERY_HINT}</p>}
      </form>
    );
  } else if (step === 'enroll') {
    body = (
      <section aria-labelledby={STEP_HEADING_ID}>
        <h2 id={STEP_HEADING_ID} ref={headingRef} tabIndex={-1} className={s.stepTitle}>{ENROLL_HEADING}</h2>
        {accountLine}
        <Notice tone="warning">{ENROLL_REQUIRED}</Notice>
        <EnrollFlow
          startPath={ENROLL_START_PATH}
          confirmPath={ENROLL_CONFIRM_PATH}
          username={account}
          confirmLabel={ENROLL_CONFIRM_LABEL}
          finishLabel={ENROLL_FINISH_LABEL}
          onStageChange={enrollStageChanged}
          onEnded={enrollEnded}
          onFinish={leave}
        />
        {setupConfirmed ? null : (
          <div className={s.altActions}>
            <p className={s.hintInline}>{ENROLL_HELP}</p>
            <button type="button" className={s.linkBtn} onClick={switchAccount} disabled={leaving}>
              {SWITCH_ACCOUNT}
            </button>
          </div>
        )}
      </section>
    );
  } else if (step === 'recovered') {
    const notice = recoveredNotice(codesLeft);
    body = (
      <section aria-labelledby={STEP_HEADING_ID}>
        <h2 id={STEP_HEADING_ID} ref={headingRef} tabIndex={-1} className={s.stepTitle}>{RECOVERED_HEADING}</h2>
        <Notice tone={notice.tone}>{notice.text}</Notice>
        <div className={s.choices}>
          <button type="button" className={s.submit} onClick={leave} disabled={leaving}>
            <ButtonText working={leaving} idle={CONTINUE_LABEL} busy={CONTINUE_LABEL} />
          </button>
          <Link href={PROFILE_TWO_STEP_HREF} className={s.secondary}>{OPEN_PROFILE_LABEL}</Link>
        </div>
      </section>
    );
  } else {
    body = (
      <form onSubmit={submitCredentials} noValidate>
        <div className={s.field}>
          <label className={s.label} htmlFor="login-email">Email</label>
          <input
            id="login-email"
            ref={emailRef}
            className={[s.input, fieldError('email') && s.inputInvalid].filter(Boolean).join(' ')}
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => markTouched('email')}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            disabled={working}
            aria-invalid={!!fieldError('email') || undefined}
            aria-describedby={fieldError('email') ? 'login-email-error' : undefined}
          />
          {fieldError('email') ? (
            <p id="login-email-error" className={s.fieldError}>{fieldError('email')}</p>
          ) : null}
        </div>

        <div className={s.field}>
          <label className={s.label} htmlFor="login-username">Username</label>
          <input
            id="login-username"
            className={[s.input, fieldError('username') && s.inputInvalid].filter(Boolean).join(' ')}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={() => markTouched('username')}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            disabled={working}
            aria-invalid={!!fieldError('username') || undefined}
            aria-describedby={fieldError('username') ? 'login-username-error' : undefined}
          />
          {fieldError('username') ? (
            <p id="login-username-error" className={s.fieldError}>{fieldError('username')}</p>
          ) : null}
        </div>

        <div className={s.field}>
          <label className={s.label} htmlFor="login-password">Password</label>
          <div className={s.passwordWrap}>
            <input
              id="login-password"
              ref={passwordRef}
              className={[s.input, s.inputWithAffix, fieldError('password') && s.inputInvalid].filter(Boolean).join(' ')}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => markTouched('password')}
              autoComplete="current-password"
              disabled={working}
              aria-invalid={!!fieldError('password') || undefined}
              aria-describedby={fieldError('password') ? 'login-password-error' : undefined}
            />
            <button
              type="button"
              className={s.affixBtn}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              title={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={0}
            >
              {showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
            </button>
          </div>
          {fieldError('password') ? (
            <p id="login-password-error" className={s.fieldError}>{fieldError('password')}</p>
          ) : null}
          <p className={s.forgot}>
            <Link href={FORGOT_PATH} className={s.linkBtn}>{FORGOT_LABEL}</Link>
          </p>
        </div>

        <FormError message={error} />

        <button type="submit" className={s.submit} disabled={working || locked}>
          <ButtonText working={working} idle={SIGN_IN_LABEL} busy={SIGNING_IN_LABEL} />
        </button>
      </form>
    );
  }

  return (
    <AuthShell headingId="login-heading" foot={FOOTNOTE}>
      {body}
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className={s.page} />}>
      <LoginForm />
    </Suspense>
  );
}
