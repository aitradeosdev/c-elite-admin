'use client';

import {
  useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode, type Ref,
} from 'react';
import { useRouter } from 'next/navigation';
import { Check, Circle, Eye, EyeOff } from 'lucide-react';
import {
  Button, ErrorState, FieldShell, Input, Notice, Select, SidePanel, SkeletonLines, useConfirm,
  useResource, useToast,
} from '../../_ui';
import { apiRequest, type ApiFailure } from '../../lib/apiClient';
import type { RoleRow } from '../../lib/roles';
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
  ACCESS_CHANGED_ELSEWHERE,
  EMPTY_DRAFT,
  NO_ACCESS,
  STATUS_LABEL,
  accessDraftFor,
  accessOf,
  accessPath,
  accessPreviewBody,
  accessReasonProblem,
  accessSaveBody,
  accessStepOf,
  adminHandle,
  classifyMutation,
  confirmIdentity,
  createRequestBody,
  createdNotice,
  draftFor,
  editRequestBody,
  firstError,
  isAccessDirty,
  isDraftDirty,
  isEmptyProposal,
  pickRole,
  previewStop,
  proposeEdit,
  proposedTitle,
  rebaseAccess,
  rebaseValues,
  roleChoices,
  statusOf,
  toAccessPreview,
  toAccessResult,
  toMutationResult,
  toRoleList,
  validateDraft,
  valuesOf,
  withAccess,
  type AccessDraft,
  type AccessExpected,
  type AccessHandoff,
  type AccessResult,
  type AccessStep,
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
import { accessConfirm, accessIdentityConfirm, accessSavedText, createConfirm, editConfirm } from './confirmOptions';
import { DrawerPanels, drawerPanel } from './SecurityParts';
import s from './page.module.css';

const EMPTY_VALUES: EditableValues = { email: EMPTY_DRAFT.email, roleTitle: EMPTY_DRAFT.roleTitle };

const TAKEN = 'That username is already taken.';

const ROLES_PATH = '/api/admin-roles';

const TITLE_HELP =
  'Shown next to their name, and grants nothing. Picking a role fills it in while it is empty or still names the previous role.';

const CREATE_ACCESS_HINT = 'Saved right after the account is created, as a second change that you review and confirm.';

const EDIT_ACCESS_HINT =
  'Saved on its own with Review access, with a reason and a recent identity check. The account details above are saved separately.';

const ROLE_HELP = 'The admin gets every action the role holds. The Roles page shows and edits them.';

const fetchRoles = (signal: AbortSignal) => apiRequest(ROLES_PATH, { signal, select: toRoleList });

export interface AccessSectionProps {
  mode: EditorMode;
  roles: readonly RoleRow[] | undefined;
  rolesError: ApiFailure | null;
  rolesRetrying: boolean;
  onRetryRoles: () => void;
  base: AccessExpected;
  draft: AccessDraft;
  currentRoleName?: string | null;
  notice?: string | null;
  disabled?: boolean;
  reviewing?: boolean;
  onRole: (roleId: string | null) => void;
  onReview?: () => void;
  sectionRef?: Ref<HTMLElement>;
  reviewRef?: Ref<HTMLButtonElement>;
}

export function AccessSection({
  mode, roles, rolesError, rolesRetrying, onRetryRoles, base, draft, currentRoleName = null, notice = null,
  disabled = false, reviewing = false, onRole, onReview, sectionRef, reviewRef,
}: AccessSectionProps) {
  const headingId = useId();
  const roleFieldId = useId();
  const choices = roles ? roleChoices(roles, base.role_id, currentRoleName) : [];
  const dirty = isAccessDirty(base, draft);

  return (
    <section ref={sectionRef} className={s.formSection} aria-labelledby={headingId} tabIndex={-1}>
      <h3 id={headingId} className={s.formHeading}>Access</h3>
      <p className={s.formHint}>{mode === 'create' ? CREATE_ACCESS_HINT : EDIT_ACCESS_HINT}</p>
      {notice ? <Notice tone="warning" compact flush announce="polite">{notice}</Notice> : null}
      {roles === undefined ? (
        rolesError ? (
          <ErrorState
            compact
            title="Roles could not be loaded"
            message={rolesError.message}
            requestId={rolesError.requestId}
            onRetry={onRetryRoles}
            retrying={rolesRetrying}
          />
        ) : (
          <div aria-busy="true">
            <span className={s.srOnly} role="status">Loading roles…</span>
            <SkeletonLines rows={4} />
          </div>
        )
      ) : (
        <>
          <div className={s.fieldGrid}>
            <FieldShell label="Role" htmlFor={roleFieldId} help={ROLE_HELP}>
              <Select
                id={roleFieldId}
                value={draft.roleId ?? ''}
                disabled={disabled}
                onChange={(event) => onRole(event.target.value || null)}
              >
                <option value="">No role</option>
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>{choice.name}</option>
                ))}
              </Select>
            </FieldShell>
          </div>
          {onReview ? (
            <div className={s.accessActions}>
              <Button
                ref={reviewRef}
                type="button"
                variant="secondary"
                loading={reviewing}
                disabled={!dirty || disabled}
                onClick={onReview}
              >
                Review access
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export interface AdminEditorProps {
  mode: EditorMode;
  admin: AdminRow | null;
  readFresh: () => Promise<AdminList | null>;
  applyAdmin: (admin: AdminRow) => void;
  refreshList: () => void;
  onClose: () => void;
  onHandoff?: (admin: AdminRow, handoff: AccessHandoff) => void;
  handoff?: AccessHandoff;
  returnFocusTo?: () => HTMLElement | null;
  panel?: AdminPanel;
  onPanelChange?: (next: AdminPanel) => void;
  security?: ReactNode;
  securityCount?: number | null;
}

function subtitleFor(admin: AdminRow): string {
  const parts = [admin.role_title || 'No title', STATUS_LABEL[statusOf(admin)]];
  parts.push(admin.last_login_at ? `last signed in ${formatAge(admin.last_login_at)} ago` : 'never signed in');
  return parts.join(' · ');
}

export function AdminEditor({
  mode, admin, readFresh, applyAdmin, refreshList, onClose, onHandoff, handoff, returnFocusTo, panel = 'account',
  onPanelChange, security, securityCount = null,
}: AdminEditorProps) {
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const router = useRouter();
  const formId = useId();
  const rulesId = useId();
  const tabsId = useId();
  const [draft, setDraft] = useState<EditorDraft>(() => draftFor(admin));
  const [base, setBase] = useState<EditableValues>(() => (admin ? valuesOf(admin) : EMPTY_VALUES));
  const [accessBase, setAccessBase] = useState<AccessExpected>(() => (admin ? accessOf(admin) : NO_ACCESS));
  const [access, setAccess] = useState<AccessDraft>(
    () => handoff?.access ?? accessDraftFor(admin ? accessOf(admin) : NO_ACCESS),
  );
  const [createdText, setCreatedText] = useState<string | null>(() => handoff?.notice ?? null);
  const [accessNotice, setAccessNotice] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [takenName, setTakenName] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewingAccess, setReviewingAccess] = useState(false);
  const [reveal, setReveal] = useState(false);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const usernameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const accessRef = useRef<HTMLElement>(null);
  const reviewAccessRef = useRef<HTMLButtonElement>(null);

  const creating = mode === 'create';
  const showsAccess = !creating && admin !== null && !admin.is_super_admin;
  const roles = useResource<RoleRow[]>(showsAccess ? 'admin-roles' : null, fetchRoles);
  const { refresh: refreshRoles } = roles;
  const roleList = roles.data;

  const handle = creating ? adminHandle({ username: draft.username }) : adminHandle(admin);
  const accountDirty = isDraftDirty(mode, draft, base);
  const accessDirty = showsAccess && isAccessDirty(accessBase, access);
  const dirty = accountDirty || accessDirty;
  const busy = reviewing || reviewingAccess;
  const validation = useMemo(() => validateDraft(mode, draft), [mode, draft]);
  const nameTaken = creating && takenName !== null && draft.username.trim() === takenName;
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
      roleTitle: titleRef,
      password: passwordRef,
      confirmPassword: confirmPasswordRef,
    }[field].current;
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center' });
  };

  const roleNameOf = (roleId: string | null): string | null => {
    if (!roleId) return null;
    const known = roleList?.find((role) => role.id === roleId);
    if (known) return known.name;
    return admin?.role && admin.role.id === roleId ? admin.role.name : null;
  };

  const chooseRole = (roleId: string | null) => {
    const role = roleId ? roleList?.find((item) => item.id === roleId) ?? null : null;
    if (roleId && !role) return;
    const previous = roleNameOf(access.roleId);
    setAccess((current) => pickRole(current, roleId, role ? role.permissions : []));
    const title = proposedTitle(draft.roleTitle, previous, role ? role.name : null);
    if (title !== null) update('roleTitle', title);
  };

  const accessFocus = () => {
    const button = reviewAccessRef.current;
    return button && !button.disabled ? button : accessRef.current;
  };

  const requestClose = useCallback(async () => {
    if (busyRef.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    const decision = await confirm({
      title: creating ? 'Discard this new admin?' : `Discard changes to ${handle}?`,
      message: creating
        ? 'Nothing has been created yet, so nobody gets access.'
        : 'Nothing has been saved, so the account stays exactly as it is.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
    });
    if (decision && aliveRef.current) onClose();
  }, [confirm, creating, dirty, handle, onClose]);

  const reportFailure = (outcome: Exclude<MutationOutcome, { kind: 'done' }>) => {
    switch (outcome.kind) {
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

  const settleEdit = (live: AdminRow, result: MutationResult, values: EditableValues, keepOpen: boolean) => {
    const saved = result.admin;
    if (saved) applyAdmin(saved);
    refreshList();
    notify(
      result.changed
        ? `Saved changes to ${adminHandle(live)}.${result.sessionsRevoked ? ' They were signed out everywhere and must sign in again.' : ''}`
        : 'Nothing changed. These values were already live.',
      'success',
    );
    if (result.warning) notify(result.warning, 'warning');
    if (!keepOpen) {
      onClose();
      return;
    }
    const next = saved ? valuesOf(saved) : values;
    setBase(next);
    setDraft((current) => ({ ...current, ...next, password: '', confirmPassword: '' }));
  };

  const runAccessStep = async (
    target: AdminRow,
    expected: AccessExpected,
    next: AccessDraft,
    titlePending: boolean,
    focus: () => HTMLElement | null,
  ): Promise<AccessStep> => {
    const preview = await apiRequest(accessPath(target.id), {
      method: 'PATCH',
      body: accessPreviewBody(expected, next),
      select: toAccessPreview,
    });
    if (!preview.ok) return previewStop(preview.error);
    if (!aliveRef.current) return { kind: 'cancelled' };
    let reason = '';
    const save = async () => classifyMutation(await apiRequest(accessPath(target.id), {
      method: 'PATCH',
      body: accessSaveBody(expected, next, reason),
      select: toAccessResult,
    }));
    const first = await confirm<MutationOutcome<AccessResult>>({
      ...accessConfirm({
        admin: target,
        preview: preview.data,
        before: { roleName: roleNameOf(expected.role_id), direct: expected.direct_permissions },
        after: { roleName: roleNameOf(next.roleId), direct: next.direct },
        titlePending,
      }),
      returnFocusTo: focus,
      action: async (result) => {
        const problem = accessReasonProblem(result.reason);
        if (problem) throw new Error(problem);
        reason = result.reason;
        const attempt = await save();
        if (attempt.kind === 'retry') throw new Error(attempt.message);
        return attempt;
      },
    });
    const outcome = first?.value;
    if (outcome?.kind !== 'reauth' || outcome.code !== 'REAUTH_REQUIRED' || !aliveRef.current) {
      return accessStepOf(outcome);
    }
    const second = await confirm<MutationOutcome<AccessResult>>({
      ...accessIdentityConfirm(target),
      returnFocusTo: focus,
      action: async ({ credential }) => {
        const identity = await confirmIdentity(credential ?? '');
        if (identity === 'expired') return { kind: 'expired' };
        const attempt = await save();
        if (attempt.kind === 'retry') throw new Error(attempt.message);
        if (attempt.kind === 'reauth' && attempt.code === 'REAUTH_REQUIRED') throw new Error(attempt.message);
        return attempt;
      },
    });
    return accessStepOf(second?.value);
  };

  const settleAccess = (target: AdminRow, result: AccessResult, keepOpen: boolean) => {
    notify(accessSavedText(target, result), 'success');
    refreshList();
    const saved = result.access;
    if (saved) {
      const roleName = roleNameOf(saved.role_id);
      applyAdmin(withAccess(target, saved, saved.role_id ? { id: saved.role_id, name: roleName, archived: false } : null));
      setAccessBase(saved);
      setAccess(accessDraftFor(saved));
    }
    setAccessNotice(null);
    setCreatedText(null);
    if (!saved || !keepOpen) onClose();
  };

  const reloadAccess = async (target: AdminRow, expected: AccessExpected, next: AccessDraft, message: string) => {
    void refreshRoles({ background: true });
    const fresh = await readFresh();
    if (!fresh || !aliveRef.current) return;
    const live = fresh.admins.find((row) => row.id === target.id);
    if (!live || live.deleted_at) {
      notify(`${adminHandle(target)} was deleted while you were editing, so nothing was saved.`, 'warning');
      onClose();
      return;
    }
    if (live.is_super_admin) {
      notify(`${adminHandle(live)} is a super admin now, so roles and additional access do not apply.`, 'warning');
      onClose();
      return;
    }
    const server = accessOf(live);
    const rebased = rebaseAccess(expected, next, server);
    setAccessBase(server);
    setAccess(rebased.draft);
    setAccessNotice(rebased.changedElsewhere ? ACCESS_CHANGED_ELSEWHERE : message);
    notify(message, 'warning');
  };

  const reviewAccess = async () => {
    if (busyRef.current || creating || !admin) return;
    const target = admin;
    const expected = accessBase;
    const next = access;
    if (!isAccessDirty(expected, next)) return;
    busyRef.current = true;
    setReviewingAccess(true);
    try {
      const titlePending = draft.roleTitle.trim() !== base.roleTitle.trim();
      const step = await runAccessStep(target, expected, next, titlePending, accessFocus);
      if (!aliveRef.current) return;
      switch (step.kind) {
        case 'saved':
          settleAccess(target, step.result, accountDirty);
          return;
        case 'stale':
          await reloadAccess(target, expected, next, step.message);
          return;
        case 'refused':
          notify(step.message, 'error');
          router.refresh();
          return;
        case 'reauth':
          notify(step.message, 'warning');
          return;
        case 'failed':
          notify(step.message, 'error');
          return;
        case 'unknown':
          notify(step.message, 'error');
          refreshList();
          return;
        default:
          return;
      }
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setReviewingAccess(false);
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

      if (creating) {
        const snapshot = draft;
        const planned = access;
        const username = snapshot.username.trim();
        if (fresh.admins.some((row) => row.username === username)) {
          setTakenName(username);
          setShowErrors(true);
          focusField('username');
          return;
        }
        const wantsAccess = isAccessDirty(NO_ACCESS, planned);
        const decision = await confirm<MutationOutcome>({
          ...createConfirm(snapshot, wantsAccess ? { roleName: roleNameOf(planned.roleId), direct: planned.direct } : null),
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
        const outcome = decision?.value;
        if (!outcome) return;
        if (outcome.kind !== 'done') {
          reportFailure(outcome);
          return;
        }
        const created = outcome.result.admin;
        if (created) applyAdmin(created);
        refreshList();
        notify(`Admin account ${adminHandle({ username })} created.`, 'success');
        if (outcome.result.warning) notify(outcome.result.warning, 'warning');
        if (!wantsAccess) {
          onClose();
          return;
        }
        if (!created) {
          notify('Its access was not saved, because the new account could not be read back. Open the account to set it.', 'warning');
          onClose();
          return;
        }
        const step = await runAccessStep(created, accessOf(created), planned, false, () => formRef.current);
        if (!aliveRef.current) return;
        if (step.kind === 'saved') {
          notify(accessSavedText(created, step.result), 'success');
          refreshList();
          onClose();
          return;
        }
        if (step.kind === 'refused') router.refresh();
        if (onHandoff) onHandoff(created, { adminId: created.id, access: planned, notice: createdNotice(step) });
        else onClose();
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
        notify(`${adminHandle(live)} is a super admin now, so this account can no longer be edited here.`, 'warning');
        onClose();
        return;
      }
      const server = valuesOf(live);
      const rebased = rebaseValues(base, { email: draft.email, roleTitle: draft.roleTitle }, server);
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
      const keepOpen = accessDirty;
      const decision = await confirm<MutationOutcome>({
        ...editConfirm(live, proposal, rebased, keepOpen),
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
      const outcome = decision?.value;
      if (!outcome) return;
      if (outcome.kind === 'done') settleEdit(live, outcome.result, rebased.values, keepOpen);
      else reportFailure(outcome);
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setReviewing(false);
      if (sent && !settled) refreshList();
    }
  };

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
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void requestClose()}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={reviewing}
            disabled={(!creating && !accountDirty) || reviewingAccess}
          >
            {creating ? 'Review and create' : 'Review changes'}
          </Button>
        </div>
      ) : undefined}
    >
      <DrawerPanels id={tabsId} panel={active} onPanelChange={onPanelChange} sessions={securityCount} security={tabs}>
        <div className={s.editor}>
          {createdText ? (
            <Notice tone="warning" compact flush announce="polite">{createdText}</Notice>
          ) : null}
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
                    readOnly={busy}
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
                    readOnly={busy}
                    onChange={(event) => update('email', event.target.value)}
                  />
                </FieldShell>
                <FieldShell label="Title" required error={errors.roleTitle} help={TITLE_HELP}>
                  <Input
                    ref={titleRef}
                    value={draft.roleTitle}
                    maxLength={ROLE_TITLE_MAX}
                    placeholder="For example: Card Reviewer"
                    readOnly={busy}
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
                      readOnly={busy}
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
                    readOnly={busy}
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
          </form>

          {showsAccess ? (
            <AccessSection
              mode={mode}
              roles={roleList}
              rolesError={roles.error}
              rolesRetrying={roles.isInitialLoading || roles.isRefreshing}
              onRetryRoles={() => void refreshRoles()}
              base={accessBase}
              draft={access}
              currentRoleName={admin?.role?.name ?? null}
              notice={accessNotice}
              disabled={busy}
              reviewing={reviewingAccess}
              onRole={chooseRole}
              onReview={creating ? undefined : () => void reviewAccess()}
              sectionRef={accessRef}
              reviewRef={reviewAccessRef}
            />
          ) : null}
        </div>
      </DrawerPanels>
    </SidePanel>
  );
}
