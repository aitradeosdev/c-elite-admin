'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Circle, Eye, EyeOff } from 'lucide-react';
import { Button, FieldShell, Input, Notice, SidePanel, useConfirm, useToast } from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { formatAge } from '../../lib/time';
import {
  PASSWORD_MAX,
  PASSWORD_RULES,
  ROLE_TITLE_MAX,
  USERNAME_MAX,
  USERNAME_MIN,
  unmetPasswordRules,
} from './rules';
import {
  EMPTY_DRAFT,
  STATUS_LABEL,
  adminHandle,
  classifyMutation,
  createRequestBody,
  draftFor,
  editRequestBody,
  firstError,
  isDraftDirty,
  isEmptyProposal,
  proposeEdit,
  rebaseValues,
  statusOf,
  toMutationResult,
  validateDraft,
  valuesOf,
  type AdminList,
  type AdminPanel,
  type AdminRow,
  type EditableValues,
  type EditorDraft,
  type EditorErrors,
  type EditorField,
  type EditorMode,
  type MutationOutcome,
  type MutationResult,
} from './model';
import { createConfirm, editConfirm } from './confirmOptions';
import { GrantEditor } from './GrantEditor';
import { DrawerPanels, drawerPanel } from './SecurityParts';
import s from './page.module.css';

const EMPTY_VALUES: EditableValues = { email: EMPTY_DRAFT.email, roleTitle: EMPTY_DRAFT.roleTitle, grants: EMPTY_DRAFT.grants };

const TAKEN = 'That username is already taken.';

export interface AdminEditorProps {
  mode: EditorMode;
  admin: AdminRow | null;
  readFresh: () => Promise<AdminList | null>;
  applyAdmin: (admin: AdminRow) => void;
  refreshList: () => void;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
  panel?: AdminPanel;
  onPanelChange?: (next: AdminPanel) => void;
  security?: ReactNode;
  securityCount?: number | null;
}

function subtitleFor(admin: AdminRow): string {
  const parts = [admin.role_title || 'No role title', STATUS_LABEL[statusOf(admin)]];
  parts.push(admin.last_login_at ? `last signed in ${formatAge(admin.last_login_at)} ago` : 'never signed in');
  return parts.join(' · ');
}

export function AdminEditor({
  mode, admin, readFresh, applyAdmin, refreshList, onClose, returnFocusTo, panel = 'account', onPanelChange, security,
  securityCount = null,
}: AdminEditorProps) {
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const router = useRouter();
  const formId = useId();
  const rulesId = useId();
  const tabsId = useId();
  const [draft, setDraft] = useState<EditorDraft>(() => draftFor(admin));
  const [base, setBase] = useState<EditableValues>(() => (admin ? valuesOf(admin) : EMPTY_VALUES));
  const [showErrors, setShowErrors] = useState(false);
  const [takenName, setTakenName] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reveal, setReveal] = useState(false);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const usernameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const grantsRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const handle = mode === 'create' ? adminHandle({ username: draft.username }) : adminHandle(admin);
  const dirty = isDraftDirty(mode, draft, base);
  const validation = useMemo(() => validateDraft(mode, draft), [mode, draft]);
  const nameTaken = mode === 'create' && takenName !== null && draft.username.trim() === takenName;
  const errors: EditorErrors = showErrors ? validation : {};
  const usernameError = errors.username ?? (nameTaken ? TAKEN : undefined);
  const unmet = useMemo(() => unmetPasswordRules(draft.password), [draft.password]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = <K extends keyof EditorDraft>(field: K, value: EditorDraft[K]) => {
    setDraft((current) => (current[field] === value ? current : { ...current, [field]: value }));
  };

  const focusField = (field: EditorField) => {
    const target = {
      username: usernameRef,
      email: emailRef,
      roleTitle: roleRef,
      password: passwordRef,
      confirmPassword: confirmPasswordRef,
      grants: grantsRef,
    }[field].current;
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center' });
  };

  const requestClose = useCallback(async () => {
    if (busyRef.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    const decision = await confirm({
      title: mode === 'create' ? 'Discard this new admin?' : `Discard changes to ${handle}?`,
      message: mode === 'create'
        ? 'Nothing has been created yet, so nobody gets access.'
        : 'Nothing has been saved, so the account stays exactly as it is.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
    });
    if (decision && aliveRef.current) onClose();
  }, [confirm, dirty, handle, mode, onClose]);

  const settle = (outcome: MutationOutcome, success: (result: MutationResult) => string) => {
    switch (outcome.kind) {
      case 'done':
        if (outcome.result.admin) applyAdmin(outcome.result.admin);
        refreshList();
        notify(outcome.result.changed ? success(outcome.result) : 'Nothing changed. These values were already live.', 'success');
        if (outcome.result.warning) notify(outcome.result.warning, 'warning');
        onClose();
        return;
      case 'unknown':
        notify(outcome.message, 'error');
        refreshList();
        return;
      case 'stale':
        notify(outcome.message, 'warning');
        refreshList();
        return;
      case 'refused':
        notify(outcome.message, 'error');
        router.refresh();
        return;
      case 'reauth':
        notify(outcome.message, 'warning');
        return;
      case 'expired':
        return;
    }
  };

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (busyRef.current) return;
    const invalid = firstError(validation) ?? (nameTaken ? 'username' : null);
    if (invalid) {
      setShowErrors(true);
      focusField(invalid);
      return;
    }
    busyRef.current = true;
    setReviewing(true);
    let sent = false;
    let settled = false;
    const password = draft.password;
    try {
      const fresh = await readFresh();
      if (!fresh || !aliveRef.current) return;

      if (mode === 'create') {
        const snapshot = draft;
        const username = snapshot.username.trim();
        if (fresh.admins.some((row) => row.username === username)) {
          setTakenName(username);
          setShowErrors(true);
          focusField('username');
          return;
        }
        const decision = await confirm<MutationOutcome>({
          ...createConfirm(snapshot),
          pendingLabel: 'Creating the account…',
          returnFocusTo: () => formRef.current,
          action: async ({ reason }) => {
            sent = true;
            const attempt = classifyMutation(await apiRequest('/api/admin-accounts', {
              method: 'POST',
              body: createRequestBody(snapshot, reason),
              select: toMutationResult,
            }));
            if (attempt.kind === 'retry') throw new Error(attempt.message);
            settled = true;
            return attempt;
          },
        });
        if (decision?.value) settle(decision.value, () => `Admin account ${adminHandle({ username })} created.`);
        return;
      }

      if (!admin) return;
      const live = fresh.admins.find((row) => row.id === admin.id);
      if (!live || live.deleted_at) {
        notify(`${adminHandle(admin)} was deleted while you were editing, so nothing was saved.`, 'warning');
        onClose();
        return;
      }
      if (live.is_super_admin) {
        notify(`${adminHandle(live)} is a super admin now, so page grants no longer apply.`, 'warning');
        onClose();
        return;
      }
      const server = valuesOf(live);
      const rebased = rebaseValues(base, { email: draft.email, roleTitle: draft.roleTitle, grants: draft.grants }, server);
      const merged: EditorDraft = { ...draft, ...rebased.values };
      setBase(server);
      setDraft(merged);
      const recheck = firstError(validateDraft('edit', merged));
      if (recheck) {
        setShowErrors(true);
        notify('Another admin changed this account while you were editing. Check the highlighted field.', 'warning');
        focusField(recheck);
        return;
      }
      const proposal = proposeEdit(live, rebased.values, password);
      if (isEmptyProposal(proposal)) {
        notify('Nothing to save. These values are already live.');
        return;
      }
      const decision = await confirm<MutationOutcome>({
        ...editConfirm(live, proposal, rebased),
        pendingLabel: 'Saving the changes…',
        returnFocusTo: () => formRef.current,
        action: async ({ reason }) => {
          sent = true;
          const attempt = classifyMutation(await apiRequest('/api/admin-accounts', {
            method: 'PATCH',
            body: editRequestBody(live.id, proposal, password, reason),
            select: toMutationResult,
          }));
          if (attempt.kind === 'retry') throw new Error(attempt.message);
          settled = true;
          return attempt;
        },
      });
      if (decision?.value) {
        settle(decision.value, (result) => `Saved changes to ${adminHandle(live)}.${
          result.sessionsRevoked ? ' They were signed out everywhere and must sign in again.' : ''
        }`);
      }
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setReviewing(false);
      if (sent && !settled) refreshList();
    }
  };

  const creating = mode === 'create';
  const tabs = creating ? undefined : security;
  const active = drawerPanel(panel, tabs, onPanelChange);

  return (
    <SidePanel
      open
      wide
      onClose={() => void requestClose()}
      title={creating ? 'New admin account' : `Edit ${handle}`}
      subtitle={creating ? 'They can sign in as soon as the account is created.' : admin ? subtitleFor(admin) : undefined}
      returnFocusTo={returnFocusTo}
      footer={active === 'account' ? (
        <div className={s.panelFooter}>
          <Button type="button" variant="ghost" disabled={reviewing} onClick={() => void requestClose()}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={reviewing}
            disabled={!creating && !dirty}
          >
            {creating ? 'Review and create' : 'Review changes'}
          </Button>
        </div>
      ) : undefined}
    >
      <DrawerPanels id={tabsId} panel={active} onPanelChange={onPanelChange} sessions={securityCount} security={tabs}>
        <form
          ref={formRef}
          id={formId}
          className={s.form}
          tabIndex={-1}
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          {!creating && admin && !admin.is_active ? (
            <Notice tone="warning" compact flush>
              This account is deactivated. Changes apply if it is reactivated.
            </Notice>
          ) : null}
          {!creating && admin && !admin.email ? (
            <Notice tone="warning" compact flush>
              This account has no email, so it cannot sign in. Add one below.
            </Notice>
          ) : null}

          <section className={s.formSection}>
            <h3 className={s.formHeading}>Account</h3>
            {creating ? (
              <FieldShell
                label="Username"
                required
                error={usernameError}
                help={`${USERNAME_MIN}–${USERNAME_MAX} characters. Admins sign in with it, and it cannot be changed later.`}
              >
                <Input
                  ref={usernameRef}
                  value={draft.username}
                  maxLength={USERNAME_MAX}
                  autoComplete="off"
                  spellCheck={false}
                  readOnly={reviewing}
                  onChange={(event) => update('username', event.target.value)}
                />
              </FieldShell>
            ) : null}
            <div className={s.fieldGrid}>
              <FieldShell
                label="Email"
                required
                error={errors.email}
                help="Admins sign in with this exact email, and security alerts go to it."
              >
                <Input
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  value={draft.email}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="name@cardelite.ng"
                  readOnly={reviewing}
                  onChange={(event) => update('email', event.target.value)}
                />
              </FieldShell>
              <FieldShell
                label="Role title"
                required
                error={errors.roleTitle}
                help="Shown next to their name. It grants nothing; access comes from the grants below."
              >
                <Input
                  ref={roleRef}
                  value={draft.roleTitle}
                  maxLength={ROLE_TITLE_MAX}
                  placeholder="For example: Card Reviewer"
                  readOnly={reviewing}
                  onChange={(event) => update('roleTitle', event.target.value)}
                />
              </FieldShell>
            </div>
          </section>

          <section className={s.formSection}>
            <h3 className={s.formHeading}>{creating ? 'Password' : 'Change password'}</h3>
            <p className={s.formHint}>
              {creating
                ? 'Send it to them through a secure channel. It cannot be read back once the account exists.'
                : `Leave both fields empty to keep the current password. A new password signs ${handle} out everywhere.`}
            </p>
            <div className={s.fieldGrid}>
              <FieldShell label={creating ? 'Password' : 'New password'} required={creating} error={errors.password}>
                <div className={s.passwordField}>
                  <Input
                    ref={passwordRef}
                    className={s.passwordInput}
                    type={reveal ? 'text' : 'password'}
                    value={draft.password}
                    maxLength={PASSWORD_MAX}
                    autoComplete="new-password"
                    spellCheck={false}
                    aria-describedby={rulesId}
                    readOnly={reviewing}
                    onChange={(event) => update('password', event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className={s.passwordToggle}
                    leftIcon={reveal ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                    aria-label="Show passwords"
                    aria-pressed={reveal}
                    onClick={() => setReveal((shown) => !shown)}
                  />
                </div>
              </FieldShell>
              <FieldShell label="Confirm password" required={creating} error={errors.confirmPassword}>
                <Input
                  ref={confirmPasswordRef}
                  type={reveal ? 'text' : 'password'}
                  value={draft.confirmPassword}
                  maxLength={PASSWORD_MAX}
                  autoComplete="new-password"
                  spellCheck={false}
                  readOnly={reviewing}
                  onChange={(event) => update('confirmPassword', event.target.value)}
                />
              </FieldShell>
            </div>
            <ul id={rulesId} className={s.rules} aria-label="Password requirements">
              {PASSWORD_RULES.map((rule) => {
                const met = draft.password !== '' && !unmet.includes(rule.id);
                return (
                  <li key={rule.id} className={met ? s.ruleMet : s.rule}>
                    {met ? <Check size={12} aria-hidden /> : <Circle size={12} aria-hidden />}
                    <span>{rule.label}</span>
                    <span className={s.srOnly}>{met ? ', met' : ', not met yet'}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <GrantEditor
            ref={grantsRef}
            mode={mode}
            value={draft.grants}
            baseline={base.grants}
            error={errors.grants}
            disabled={reviewing}
            onChange={(next) => update('grants', next)}
          />
        </form>
      </DrawerPanels>
    </SidePanel>
  );
}
