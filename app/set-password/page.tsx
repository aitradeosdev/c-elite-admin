'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { Notice } from '../_ui/Notice';
import { Spinner } from '../_ui/Misc';
import { PasswordRules } from '../_security/PasswordRules';
import { apiRequest } from '../lib/apiClient';
import { AuthShell, ButtonText, FormError } from '../login/AuthParts';
import { FORGOT_PATH, SIGN_IN_LABEL } from '../login/model';
import { BACK_TO_SIGN_IN, SIGN_IN_HREF } from '../forgot-password/model';
import {
  CHECK_PATH, CONFIRM_PASSWORD_LABEL, DONE_HEADING, DONE_LEAD, INVALID_HELP, LINK_INVALID, NEW_PASSWORD_LABEL,
  REQUEST_NEW_LINK, SAVE_LABEL, SAVE_PATH, SAVING_LABEL, SET_PASSWORD_PATH, TRY_AGAIN,
  checkBody, classifyCheck, classifySave, firstNewPasswordError, formHeading, formLead, newPasswordChecklist,
  saveBody, toLinkAccount, validateNewPassword,
  type NewPasswordDraft, type NewPasswordErrors, type NewPasswordField, type SetPasswordView,
} from './model';
import s from '../login/login.module.css';

const SHELL_HEADING_ID = 'set-password-heading';
const STEP_HEADING_ID = 'set-password-step-heading';
const RULES_ID = 'set-password-rules';

const EMPTY_DRAFT: Readonly<NewPasswordDraft> = Object.freeze({ next: '', confirm: '' });
const HIDDEN: Readonly<Record<NewPasswordField, boolean>> = Object.freeze({ next: false, confirm: false });
const NO_ERRORS: Readonly<NewPasswordErrors> = Object.freeze({});

const FIELD_ID: Readonly<Record<NewPasswordField, string>> = { next: 'set-password-new', confirm: 'set-password-confirm' };
const FIELD_LABEL: Readonly<Record<NewPasswordField, string>> = { next: NEW_PASSWORD_LABEL, confirm: CONFIRM_PASSWORD_LABEL };
const TOGGLE_NOUN: Readonly<Record<NewPasswordField, string>> = { next: 'new password', confirm: 'password confirmation' };

interface PasswordFieldProps {
  field: NewPasswordField;
  value: string;
  shown: boolean;
  error: string | null;
  describedBy?: string;
  readOnly: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onToggle: () => void;
}

function PasswordField({ field, value, shown, error, describedBy, readOnly, inputRef, onChange, onToggle }: PasswordFieldProps) {
  const id = FIELD_ID[field];
  const errorId = `${id}-error`;
  const toggleLabel = `${shown ? 'Hide' : 'Show'} ${TOGGLE_NOUN[field]}`;
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>{FIELD_LABEL[field]}</label>
      <div className={s.passwordWrap}>
        <input
          id={id}
          ref={inputRef}
          className={[s.input, s.inputWithAffix, error && s.inputInvalid].filter(Boolean).join(' ')}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          readOnly={readOnly}
          aria-invalid={!!error || undefined}
          aria-describedby={[error ? errorId : null, describedBy].filter(Boolean).join(' ') || undefined}
        />
        <button
          type="button"
          className={s.affixBtn}
          onClick={onToggle}
          aria-label={toggleLabel}
          aria-pressed={shown}
          title={toggleLabel}
          tabIndex={0}
        >
          {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
      {error ? <p id={errorId} className={s.fieldError}>{error}</p> : null}
    </div>
  );
}

export default function SetPasswordPage() {
  const [view, setView] = useState<SetPasswordView>({ kind: 'checking' });
  const [token, setToken] = useState('');
  const [draft, setDraft] = useState<NewPasswordDraft>(EMPTY_DRAFT);
  const [shown, setShown] = useState<Record<NewPasswordField, boolean>>(HIDDEN);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const read = useRef(false);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const account = view.kind === 'form' ? view.account : null;
  const checklist = useMemo(() => (account ? newPasswordChecklist(draft.next, account) : []), [draft.next, account]);
  const validation = useMemo(() => (account ? validateNewPassword(draft, account) : NO_ERRORS), [draft, account]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const check = useCallback(async (value: string) => {
    setView({ kind: 'checking' });
    const result = await apiRequest(CHECK_PATH, { method: 'POST', body: checkBody(value), select: toLinkAccount });
    if (alive.current) setView(classifyCheck(result));
  }, []);

  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const found = window.location.hash.slice(1);
    window.history.replaceState(null, '', SET_PASSWORD_PATH);
    if (!found) {
      setView({ kind: 'invalid' });
      return;
    }
    setToken(found);
    void check(found);
  }, [check]);

  useEffect(() => {
    if (view.kind === 'form') nextRef.current?.focus();
    else if (view.kind === 'done') headingRef.current?.focus();
  }, [view.kind]);

  const update = (field: NewPasswordField, value: string) => {
    setDraft((current) => (current[field] === value ? current : { ...current, [field]: value }));
    if (field === 'next') setServerError(null);
  };

  const toggle = (field: NewPasswordField) => {
    setShown((current) => ({ ...current, [field]: !current[field] }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !account) return;
    const invalid = firstNewPasswordError(validation);
    if (invalid) {
      setShowErrors(true);
      (invalid === 'next' ? nextRef : confirmRef).current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    setServerError(null);
    const result = await apiRequest(SAVE_PATH, { method: 'POST', body: saveBody(token, draft.next) });
    if (!alive.current) return;
    setBusy(false);
    const outcome = classifySave(result);
    if (outcome.kind === 'field') {
      setServerError(outcome.message);
      nextRef.current?.focus();
      return;
    }
    if (outcome.kind === 'error') {
      setError(outcome.message);
      return;
    }
    setDraft(EMPTY_DRAFT);
    setShown(HIDDEN);
    setView(outcome.kind === 'done' ? { kind: 'done' } : { kind: 'invalid' });
  };

  let body: ReactNode;
  if (view.kind === 'checking') {
    body = (
      <div className={s.checking}>
        <Spinner size={20} />
      </div>
    );
  } else if (view.kind === 'unavailable') {
    body = (
      <>
        <FormError message={view.message} />
        <button type="button" className={s.submit} onClick={() => void check(token)}>{TRY_AGAIN}</button>
      </>
    );
  } else if (view.kind === 'invalid') {
    body = (
      <>
        <Notice tone="warning" announce>{LINK_INVALID}</Notice>
        <p className={s.hint}>{INVALID_HELP}</p>
        <div className={s.altActions}>
          <Link href={FORGOT_PATH} className={s.linkBtn}>{REQUEST_NEW_LINK}</Link>
          <Link href={SIGN_IN_HREF} className={s.linkBtn}>{BACK_TO_SIGN_IN}</Link>
        </div>
      </>
    );
  } else if (view.kind === 'done') {
    body = (
      <section aria-labelledby={STEP_HEADING_ID}>
        <h2 id={STEP_HEADING_ID} ref={headingRef} tabIndex={-1} className={s.stepTitle}>{DONE_HEADING}</h2>
        <p className={s.stepLead}>{DONE_LEAD}</p>
        <Link href={SIGN_IN_HREF} className={s.submit}>{SIGN_IN_LABEL}</Link>
      </section>
    );
  } else {
    const nextError = serverError ?? (showErrors ? validation.next ?? null : null);
    const confirmError = showErrors ? validation.confirm ?? null : null;
    body = (
      <form onSubmit={submit} noValidate aria-labelledby={STEP_HEADING_ID}>
        <h2 id={STEP_HEADING_ID} className={s.stepTitle}>{formHeading(view.account)}</h2>
        <p className={s.stepLead}>{formLead(view.account)}</p>

        <PasswordField
          field="next"
          value={draft.next}
          shown={shown.next}
          error={nextError}
          describedBy={RULES_ID}
          readOnly={busy}
          inputRef={nextRef}
          onChange={(value) => update('next', value)}
          onToggle={() => toggle('next')}
        />
        <PasswordField
          field="confirm"
          value={draft.confirm}
          shown={shown.confirm}
          error={confirmError}
          readOnly={busy}
          inputRef={confirmRef}
          onChange={(value) => update('confirm', value)}
          onToggle={() => toggle('confirm')}
        />
        <div className={s.field}>
          <PasswordRules id={RULES_ID} items={checklist} />
        </div>

        <FormError message={error} />

        <button type="submit" className={s.submit} disabled={busy}>
          <ButtonText working={busy} idle={SAVE_LABEL} busy={SAVING_LABEL} />
        </button>
      </form>
    );
  }

  return <AuthShell headingId={SHELL_HEADING_ID}>{body}</AuthShell>;
}
