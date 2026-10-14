'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Check, Circle, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import {
  Badge, Button, Card, CardBody, CardFooter, CardHeader, DetailRow, FieldShell, Input, Notice, SkeletonLines,
  notifySessionExpired, useConfirm, useToast,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import {
  CHANGED_MESSAGE,
  EMPTY_PASSWORD_DRAFT,
  PASSWORD_PATH,
  classifyPasswordChange,
  createdText,
  firstPasswordError,
  lastSignInText,
  passwordChangeBody,
  passwordChangeConfirm,
  passwordChecklist,
  toPasswordChangeResult,
  validatePasswordDraft,
  type ChecklistItem,
  type NoticeTone,
  type PasswordChangeOutcome,
  type PasswordDraft,
  type PasswordErrors,
  type PasswordField,
  type ProfileAccount,
} from './model';
import { DEVICES_TITLE, TWO_STEP_TITLE } from './securityModel';
import s from './page.module.css';

const HIDDEN: Readonly<Record<PasswordField, boolean>> = Object.freeze({ current: false, next: false, confirm: false });

const FIELD_LABEL: Readonly<Record<PasswordField, string>> = {
  current: 'Current password',
  next: 'New password',
  confirm: 'Confirm new password',
};

const TOGGLE_LABEL: Readonly<Record<PasswordField, string>> = {
  current: 'Show current password',
  next: 'Show new password',
  confirm: 'Show new password confirmation',
};

const AUTOCOMPLETE: Readonly<Record<PasswordField, string>> = {
  current: 'current-password',
  next: 'new-password',
  confirm: 'new-password',
};

export interface AccountDetailsProps {
  account: ProfileAccount;
  now?: Date;
}

export function AccountDetails({ account, now }: AccountDetailsProps) {
  const headingId = useId();
  return (
    <Card role="group" aria-labelledby={headingId}>
      <CardHeader
        title={<h2 id={headingId} className={s.sectionHeading}>Account</h2>}
        subtitle="To change your email or role title, ask a super administrator."
      />
      <CardBody>
        <div className={s.detailRows}>
          <DetailRow label="Username" value={account.username} wrap />
          <DetailRow label="Email" value={account.email ?? 'None'} wrap />
          <DetailRow
            label="Role title"
            value={(
              <span className={s.roleValue}>
                <span>{account.roleTitle || 'No role title'}</span>
                {account.isSuperAdmin ? (
                  <Badge tone="neutral">
                    <ShieldCheck size={12} aria-hidden />
                    Super admin
                  </Badge>
                ) : null}
              </span>
            )}
          />
          <DetailRow label="Last sign-in" value={lastSignInText(account.lastLoginAt, now)} />
          <DetailRow label="Account created" value={createdText(account.createdAt)} />
        </div>
      </CardBody>
    </Card>
  );
}

export function ProfileSkeleton() {
  return (
    <div aria-busy="true">
      <span className={s.srOnly} role="status">Loading your profile…</span>
      <Card aria-hidden>
        <CardHeader title="Account" />
        <CardBody>
          <SkeletonLines rows={5} />
        </CardBody>
      </Card>
      <Card aria-hidden>
        <CardHeader title="Change password" />
        <CardBody>
          <SkeletonLines rows={4} />
        </CardBody>
      </Card>
      <Card aria-hidden>
        <CardHeader title={TWO_STEP_TITLE} />
        <CardBody>
          <SkeletonLines rows={3} />
        </CardBody>
      </Card>
      <Card aria-hidden>
        <CardHeader title={DEVICES_TITLE} />
        <CardBody>
          <SkeletonLines rows={3} />
        </CardBody>
      </Card>
    </div>
  );
}

export interface PasswordRulesProps {
  id: string;
  items: readonly ChecklistItem[];
}

export function PasswordRules({ id, items }: PasswordRulesProps) {
  return (
    <ul id={id} className={s.rules} aria-label="Password requirements">
      {items.map((item) => (
        <li key={item.id} className={item.met ? s.ruleMet : s.rule}>
          <span className={s.ruleIcon} aria-hidden>
            {item.met ? <Check size={14} /> : <Circle size={14} />}
          </span>
          <span>{item.label}</span>
          <span className={s.srOnly}>{item.met ? ', met' : ', not met yet'}</span>
        </li>
      ))}
    </ul>
  );
}

export interface PasswordInputProps {
  id: string;
  field: PasswordField;
  value: string;
  shown: boolean;
  readOnly: boolean;
  describedBy?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onToggle: () => void;
}

export function PasswordInput({
  id, field, value, shown, readOnly, describedBy, inputRef, onChange, onToggle,
}: PasswordInputProps) {
  return (
    <div className={s.passwordField}>
      <Input
        ref={inputRef}
        id={id}
        className={s.passwordInput}
        type={shown ? 'text' : 'password'}
        value={value}
        autoComplete={AUTOCOMPLETE[field]}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby={describedBy}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        className={s.passwordToggle}
        leftIcon={shown ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
        aria-label={TOGGLE_LABEL[field]}
        aria-pressed={shown}
        aria-controls={id}
        onClick={onToggle}
      />
    </div>
  );
}

interface FormNotice {
  tone: NoticeTone;
  message: string;
}

function withoutField(errors: PasswordErrors, field: PasswordField): PasswordErrors {
  if (!errors[field]) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}

export interface PasswordCardProps {
  account: ProfileAccount;
}

export function PasswordCard({ account }: PasswordCardProps) {
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const rulesId = `${baseId}-rules`;
  const fieldId = (field: PasswordField) => `${baseId}-${field}`;
  const [draft, setDraft] = useState<PasswordDraft>(EMPTY_PASSWORD_DRAFT);
  const [shown, setShown] = useState<Record<PasswordField, boolean>>(HIDDEN);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<PasswordErrors>({});
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const checklist = useMemo(() => passwordChecklist(draft, account), [draft, account]);
  const validation = useMemo(() => validatePasswordDraft(draft, account), [draft, account]);
  const errors: PasswordErrors = { ...(showErrors ? validation : {}), ...serverErrors };
  const refs: Readonly<Record<PasswordField, RefObject<HTMLInputElement | null>>> = {
    current: currentRef,
    next: nextRef,
    confirm: confirmRef,
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const update = (field: PasswordField, value: string) => {
    setDraft((current) => (current[field] === value ? current : { ...current, [field]: value }));
    setServerErrors((current) => withoutField(current, field));
  };

  const toggle = (field: PasswordField) => {
    setShown((current) => ({ ...current, [field]: !current[field] }));
  };

  const focusField = (field: PasswordField) => {
    const input = refs[field].current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
    input.scrollIntoView({ block: 'center' });
  };

  const settle = (outcome: PasswordChangeOutcome) => {
    switch (outcome.kind) {
      case 'done':
        setDraft(EMPTY_PASSWORD_DRAFT);
        setShown(HIDDEN);
        setShowErrors(false);
        setServerErrors({});
        notify(CHANGED_MESSAGE, 'success');
        if (outcome.result.warning) notify(outcome.result.warning, 'warning');
        if (!outcome.result.sessionRenewed) notifySessionExpired();
        return;
      case 'field':
        setServerErrors({ [outcome.field]: outcome.message });
        focusField(outcome.field);
        return;
      case 'notice':
        setNotice({ tone: outcome.tone, message: outcome.message });
        return;
      case 'retry':
        setNotice({ tone: 'danger', message: outcome.message });
        return;
      case 'expired':
        return;
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;
    const invalid = firstPasswordError(validation);
    if (invalid) {
      setShowErrors(true);
      focusField(invalid);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    setServerErrors({});
    const body = passwordChangeBody(draft);
    try {
      const decision = await confirm<PasswordChangeOutcome>({
        ...passwordChangeConfirm(),
        returnFocusTo: () => submitRef.current,
        action: async () => {
          const outcome = classifyPasswordChange(await apiRequest(PASSWORD_PATH, {
            method: 'POST',
            body,
            select: toPasswordChangeResult,
          }));
          if (outcome.kind === 'retry') throw new Error(outcome.message);
          return outcome;
        },
      });
      if (aliveRef.current && decision?.value) settle(decision.value);
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  };

  const renderField = (field: PasswordField, describedBy?: string) => (
    <FieldShell
      label={FIELD_LABEL[field]}
      htmlFor={fieldId(field)}
      required
      error={errors[field]}
      className={field === 'next' ? s.startRow : undefined}
    >
      <PasswordInput
        id={fieldId(field)}
        field={field}
        value={draft[field]}
        shown={shown[field]}
        readOnly={busy}
        describedBy={describedBy}
        inputRef={refs[field]}
        onChange={(value) => update(field, value)}
        onToggle={() => toggle(field)}
      />
    </FieldShell>
  );

  return (
    <Card>
      <CardHeader
        title={<h2 id={headingId} className={s.sectionHeading}>Change password</h2>}
        subtitle="A new password signs you out on your other devices, including the mobile app. You stay signed in here."
      />
      <form className={s.form} noValidate aria-labelledby={headingId} onSubmit={(event) => void submit(event)}>
        <CardBody className={s.body}>
          {notice ? (
            <Notice tone={notice.tone} compact flush announce>
              {notice.message}
            </Notice>
          ) : null}
          <input type="text" name="username" autoComplete="username" value={account.username} readOnly hidden />
          <div className={s.fields}>
            {renderField('current')}
            {renderField('next', rulesId)}
            {renderField('confirm')}
          </div>
          <PasswordRules id={rulesId} items={checklist} />
        </CardBody>
        <CardFooter>
          <Button ref={submitRef} type="submit" variant="primary" loading={busy}>
            Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
