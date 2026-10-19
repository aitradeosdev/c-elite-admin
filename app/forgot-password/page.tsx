'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Notice } from '../_ui/Notice';
import { apiRequest } from '../lib/apiClient';
import { AuthShell, ButtonText, FormError } from '../login/AuthParts';
import {
  BACK_TO_SIGN_IN, FORGOT_FOOTNOTE, FORGOT_HEADING, FORGOT_LEAD, FORGOT_SENT, REQUEST_PATH, SEND_LABEL, SENDING_LABEL,
  SIGN_IN_HREF, SPAM_HINT, classifyForgot, forgotBody, forgotComplete, forgotError,
  type ForgotField, type ForgotValues,
} from './model';
import s from '../login/login.module.css';

const SHELL_HEADING_ID = 'forgot-heading';
const STEP_HEADING_ID = 'forgot-step-heading';

const UNTOUCHED: Readonly<Record<ForgotField, boolean>> = Object.freeze({ email: false, username: false });
const ALL_TOUCHED: Readonly<Record<ForgotField, boolean>> = Object.freeze({ email: true, username: true });

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState<Record<ForgotField, boolean>>(UNTOUCHED);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const values: ForgotValues = { email, username };

  useEffect(() => {
    if (sent) headingRef.current?.focus();
    else emailRef.current?.focus();
  }, [sent]);

  const fieldError = (name: ForgotField): string | null => (touched[name] ? forgotError(name, values) : null);

  const markTouched = (name: ForgotField) => setTouched((current) => ({ ...current, [name]: true }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(ALL_TOUCHED);
    if (!forgotComplete(values) || busy) return;
    setBusy(true);
    setError('');
    const result = await apiRequest(REQUEST_PATH, { method: 'POST', body: forgotBody(values) });
    setBusy(false);
    const outcome = classifyForgot(result);
    if (outcome.kind === 'sent') setSent(true);
    else setError(outcome.message);
  };

  return (
    <AuthShell headingId={SHELL_HEADING_ID} foot={FORGOT_FOOTNOTE}>
      {sent ? (
        <section aria-labelledby={STEP_HEADING_ID}>
          <h2 id={STEP_HEADING_ID} ref={headingRef} tabIndex={-1} className={s.stepTitle}>{FORGOT_HEADING}</h2>
          <Notice tone="success" announce>{FORGOT_SENT}</Notice>
          <p className={s.hint}>{SPAM_HINT}</p>
          <div className={s.altActions}>
            <Link href={SIGN_IN_HREF} className={s.linkBtn}>{BACK_TO_SIGN_IN}</Link>
          </div>
        </section>
      ) : (
        <form onSubmit={submit} noValidate aria-labelledby={STEP_HEADING_ID}>
          <h2 id={STEP_HEADING_ID} className={s.stepTitle}>{FORGOT_HEADING}</h2>
          <p className={s.stepLead}>{FORGOT_LEAD}</p>

          <div className={s.field}>
            <label className={s.label} htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
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
              disabled={busy}
              aria-invalid={!!fieldError('email') || undefined}
              aria-describedby={fieldError('email') ? 'forgot-email-error' : undefined}
            />
            {fieldError('email') ? (
              <p id="forgot-email-error" className={s.fieldError}>{fieldError('email')}</p>
            ) : null}
          </div>

          <div className={s.field}>
            <label className={s.label} htmlFor="forgot-username">Username</label>
            <input
              id="forgot-username"
              className={[s.input, fieldError('username') && s.inputInvalid].filter(Boolean).join(' ')}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => markTouched('username')}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              aria-invalid={!!fieldError('username') || undefined}
              aria-describedby={fieldError('username') ? 'forgot-username-error' : undefined}
            />
            {fieldError('username') ? (
              <p id="forgot-username-error" className={s.fieldError}>{fieldError('username')}</p>
            ) : null}
          </div>

          <FormError message={error} />

          <button type="submit" className={s.submit} disabled={busy}>
            <ButtonText working={busy} idle={SEND_LABEL} busy={SENDING_LABEL} />
          </button>
        </form>
      )}
    </AuthShell>
  );
}
