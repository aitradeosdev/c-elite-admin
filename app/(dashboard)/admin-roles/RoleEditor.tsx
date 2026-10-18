'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button, FieldShell, Input, Notice, Select, SidePanel, Textarea, useConfirm, useResource, useToast,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { actionDiff, matrixFromKeys } from '../../lib/grants';
import { REASON_MAX, ROLE_DESCRIPTION_MAX, ROLE_NAME_MAX, ROLE_NAME_MIN, impactSentence, type Impact } from '../../lib/roles';
import { useUnloadGuard } from '../../_security/hooks';
import { Change, ImpactList, PermissionMatrix } from '../_access';
import {
  COPY_SOURCES_PATH, PREVIEW_PATH, PREVIEW_UNREACHABLE, ROLES_PATH, actionsText, baseFor, classifyRoleWrite,
  confirmWithStepUp, copySourceLabel, draftFor, firstRoleError, impactConsequences, impactTone, isRoleDirty,
  isSystemRole, previewBody, rebaseNoticeText, rebaseRoleDraft, rolePath, saveBody, saveSuccessText, toCopySources,
  toImpact, toRoleDetail, toRoleSaved, validateRoleDraft, valuesOf, withCopy, withMatrix, withStoredKeys,
  type ConfirmBase, type CopySource, type EditableRole, type EditorMode, type RoleConflict, type RoleDraftState,
  type RoleEditorErrors, type RoleEditorField, type RoleSaved, type RoleValues, type RoleWriteAttempt,
  type RoleWriteOutcome,
} from './model';
import s from './page.module.css';

export const COPY_LABEL = 'Copy access from an admin';
export const COPY_HELP = 'Replaces the permissions below with that admin’s own grants, page keys included.';
export const NAME_TAKEN = 'Another role already has this name.';

const NO_SOURCES: readonly CopySource[] = [];

export function saveConfirm(mode: EditorMode, role: EditableRole | null, draft: RoleValues, impact: Impact): ConfirmBase {
  const name = draft.name.trim();
  const change = actionDiff(role ? role.permissions : [], draft.keys);
  const renamed = role !== null && role.name.trim() !== name;
  return {
    tone: impactTone(impact),
    title: mode === 'create' || !role ? `Create the role ${name}?` : `Save changes to ${role.name}?`,
    message: (
      <div className={s.confirmBody}>
        <p className={s.confirmLead}>{impactSentence(impact)}</p>
        <ImpactList impact={impact} />
      </div>
    ),
    details: [
      { label: 'Role', value: renamed && role ? <Change before={role.name} after={name} /> : name },
      { label: 'Actions added', value: actionsText(change.gained.length) },
      { label: 'Actions removed', value: actionsText(change.lost.length) },
    ],
    consequences: impactConsequences(impact),
    reason: {
      required: true,
      label: mode === 'create' ? 'Reason for the new role' : 'Reason for the change',
      placeholder: 'Why is this change needed?',
      maxLength: REASON_MAX,
    },
    confirmLabel: mode === 'create' ? 'Create role' : 'Save changes',
    pendingLabel: 'Saving…',
  };
}

export interface RoleEditorProps {
  mode: EditorMode;
  role: EditableRole | null;
  seed?: readonly string[];
  onClose: () => void;
  onChanged: () => void;
  returnFocusTo?: () => HTMLElement | null;
}

export function RoleEditor({ mode, role, seed, onClose, onChanged, returnFocusTo }: RoleEditorProps) {
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const router = useRouter();
  const formId = useId();
  const permissionsHeadingId = useId();
  const [current, setCurrent] = useState<EditableRole | null>(role);
  const [base, setBase] = useState<RoleValues>(() => baseFor(role, seed));
  const [draft, setDraft] = useState<RoleDraftState>(() => draftFor(role, seed));
  const [showErrors, setShowErrors] = useState(false);
  const [takenName, setTakenName] = useState<string | null>(null);
  const [rebaseText, setRebaseText] = useState<string | null>(null);
  const [copyId, setCopyId] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const permissionsRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const creating = mode === 'create';
  const copies = useResource<CopySource[]>(
    'admin-role-copy-sources',
    (signal) => apiRequest(COPY_SOURCES_PATH, { signal, select: toCopySources }),
  );
  const sources = copies.data ?? NO_SOURCES;
  const copyFailed = copies.error !== null && copies.data === undefined;
  const dirty = isRoleDirty(draft, base);
  const validation = useMemo(() => validateRoleDraft(draft, current ? current.permissions : []), [draft, current]);
  const errors: RoleEditorErrors = showErrors ? validation : {};
  const nameTaken = takenName !== null && draft.name.trim().toLowerCase() === takenName;
  const nameError = errors.name ?? (nameTaken ? NAME_TAKEN : undefined);
  const matrixValue = useMemo(() => matrixFromKeys(draft.keys), [draft.keys]);
  const copyPlaceholder = copies.isInitialLoading
    ? 'Loading admins…'
    : copyFailed
      ? 'Admins could not be loaded'
      : sources.length ? 'Choose an admin' : 'No admins to copy from';

  useUnloadGuard(dirty);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const update = (patch: Partial<Pick<RoleValues, 'name' | 'description'>>) => {
    setDraft((value) => ({ ...value, ...patch }));
  };

  const focusField = (field: RoleEditorField) => {
    const target = field === 'name' ? nameRef.current : field === 'description' ? descriptionRef.current : permissionsRef.current;
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
      title: creating ? 'Discard this new role?' : `Discard changes to ${role ? role.name : 'this role'}?`,
      message: creating
        ? 'Nothing has been created yet, so no admin’s access changes.'
        : 'Nothing has been saved, so the role stays exactly as it is.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
    });
    if (decision && aliveRef.current) onClose();
  }, [confirm, creating, dirty, onClose, role]);

  const applyCopy = () => {
    const source = sources.find((item) => item.id === copyId);
    if (source) setDraft((value) => withCopy(value, source.keys));
  };

  const rebase = async (snapshot: RoleDraftState, target: EditableRole) => {
    const fresh = await apiRequest(rolePath(target.id), { select: toRoleDetail });
    if (!aliveRef.current) return;
    if (!fresh.ok) {
      if (fresh.error.status !== 401) {
        notify(`This role changed, and the latest version could not be loaded. ${fresh.error.message}`, 'error');
      }
      if (fresh.error.status === 403) router.refresh();
      return;
    }
    const live = fresh.data.role;
    onChanged();
    if (live.archived_at !== null || isSystemRole(live)) {
      notify(`${live.name} was archived while you were editing, so nothing was saved.`, 'warning');
      onClose();
      return;
    }
    const server = valuesOf(live);
    const result = rebaseRoleDraft(base, snapshot, server);
    setCurrent(live);
    setBase(server);
    setDraft({ ...result.values, baseline: result.baseline });
    setRebaseText(rebaseNoticeText(result));
  };

  const conflict = async (reason: RoleConflict, message: string, snapshot: RoleDraftState, target: EditableRole | null) => {
    if (reason === 'stale' && target) {
      await rebase(snapshot, target);
      return;
    }
    if (reason === 'name_taken') {
      setTakenName(snapshot.name.trim().toLowerCase());
      setShowErrors(true);
      focusField('name');
      return;
    }
    notify(message, 'warning');
    onChanged();
    if (reason === 'archived' || reason === 'protected' || reason === 'not_found') onClose();
  };

  const settle = async (outcome: RoleWriteOutcome<RoleSaved>, snapshot: RoleDraftState, target: EditableRole | null) => {
    switch (outcome.kind) {
      case 'done':
        notify(saveSuccessText(mode, outcome.result), 'success');
        onChanged();
        onClose();
        return;
      case 'conflict':
        await conflict(outcome.reason, outcome.message, snapshot, target);
        return;
      case 'refused':
        notify(outcome.message, 'error');
        router.refresh();
        return;
      case 'unknown':
        notify(outcome.message, 'error');
        onChanged();
        return;
      case 'reauth':
        notify(outcome.message, 'warning');
        return;
      case 'expired':
        return;
    }
  };

  const previewProblem = async (
    preview: Exclude<RoleWriteAttempt<Impact>, { kind: 'done' }>,
    snapshot: RoleDraftState,
    target: EditableRole | null,
  ) => {
    switch (preview.kind) {
      case 'conflict':
        await conflict(preview.reason, preview.message, snapshot, target);
        return;
      case 'refused':
        notify(preview.message, 'error');
        router.refresh();
        return;
      case 'unknown':
        notify(PREVIEW_UNREACHABLE, 'error');
        return;
      case 'reauth':
        notify(preview.message, 'warning');
        return;
      case 'retry':
        notify(preview.message, 'error');
        return;
      case 'expired':
        return;
    }
  };

  const review = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (busyRef.current) return;
    const invalid = firstRoleError(validation) ?? (nameTaken ? 'name' : null);
    if (invalid) {
      setShowErrors(true);
      focusField(invalid);
      return;
    }
    busyRef.current = true;
    setReviewing(true);
    setRebaseText(null);
    const snapshot = draft;
    const target = current;
    let sent = false;
    let settled = false;
    try {
      const preview = classifyRoleWrite(await apiRequest(PREVIEW_PATH, {
        method: 'POST',
        body: previewBody(snapshot, target),
        select: toImpact,
      }));
      if (!aliveRef.current) return;
      if (preview.kind !== 'done') {
        await previewProblem(preview, snapshot, target);
        return;
      }
      const outcome = await confirmWithStepUp<RoleSaved>(
        confirm,
        { ...saveConfirm(mode, target, snapshot, preview.result), returnFocusTo: () => formRef.current },
        async (reason) => {
          sent = true;
          const attempt = classifyRoleWrite(await apiRequest(target ? rolePath(target.id) : ROLES_PATH, {
            method: target ? 'PATCH' : 'POST',
            body: saveBody(snapshot, target, reason),
            select: toRoleSaved,
          }));
          settled = attempt.kind !== 'retry';
          return attempt;
        },
      );
      if (outcome && aliveRef.current) await settle(outcome, snapshot, target);
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setReviewing(false);
      if (sent && !settled) onChanged();
    }
  };

  return (
    <SidePanel
      open
      wide
      onClose={() => void requestClose()}
      title={creating ? 'New role' : `Edit ${role ? role.name : 'role'}`}
      subtitle={creating
        ? 'Nobody holds a new role until it is assigned in Admin accounts.'
        : 'You see who is affected before anything is saved.'}
      returnFocusTo={returnFocusTo}
      footer={
        <div className={s.panelFooter}>
          <Button type="button" variant="ghost" disabled={reviewing} onClick={() => void requestClose()}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={reviewing} disabled={!creating && !dirty}>
            Review changes
          </Button>
        </div>
      }
    >
      <form ref={formRef} id={formId} className={s.form} tabIndex={-1} noValidate onSubmit={(event) => void review(event)}>
        {rebaseText ? (
          <Notice tone="warning" compact flush announce="polite" title="Changed while you were editing">
            {rebaseText}
          </Notice>
        ) : null}

        <section className={s.formSection}>
          <h3 className={s.formHeading}>Role</h3>
          <FieldShell
            label="Name"
            required
            error={nameError}
            help={`${ROLE_NAME_MIN}–${ROLE_NAME_MAX} characters. No two roles can share a name.`}
          >
            <Input
              ref={nameRef}
              value={draft.name}
              maxLength={ROLE_NAME_MAX}
              autoComplete="off"
              placeholder="For example: Payout reviewer"
              readOnly={reviewing}
              onChange={(event) => update({ name: event.target.value })}
            />
          </FieldShell>
          <FieldShell
            label="Description"
            error={errors.description}
            help={`Optional. Up to ${ROLE_DESCRIPTION_MAX} characters.`}
          >
            <Textarea
              ref={descriptionRef}
              rows={3}
              value={draft.description}
              maxLength={ROLE_DESCRIPTION_MAX}
              readOnly={reviewing}
              onChange={(event) => update({ description: event.target.value })}
            />
          </FieldShell>
        </section>

        <section ref={permissionsRef} className={s.formSection} tabIndex={-1} aria-labelledby={permissionsHeadingId}>
          <h3 id={permissionsHeadingId} className={s.formHeading}>Permissions</h3>
          <div className={s.copyRow}>
            <FieldShell
              label={COPY_LABEL}
              help={COPY_HELP}
              error={copyFailed && copies.error ? `The admin list could not be loaded. ${copies.error.message}` : undefined}
              className={s.copyField}
            >
              <Select
                value={copyId}
                disabled={reviewing || sources.length === 0}
                onChange={(event) => setCopyId(event.target.value)}
              >
                <option value="">{copyPlaceholder}</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>{copySourceLabel(source)}</option>
                ))}
              </Select>
            </FieldShell>
            {copyFailed ? (
              <Button type="button" variant="secondary" loading={copies.isRefreshing} onClick={() => void copies.refresh()}>
                Try again
              </Button>
            ) : (
              <Button type="button" variant="secondary" disabled={reviewing || copyId === ''} onClick={applyCopy}>
                Copy access
              </Button>
            )}
          </div>
          {errors.permissions ? <p className={s.fieldError} role="alert">{errors.permissions}</p> : null}
          <PermissionMatrix
            value={matrixValue}
            readOnly={reviewing}
            onChange={(next) => setDraft((value) => withMatrix(value, next))}
            storedKeys={{
              value: draft.keys,
              baseline: draft.baseline,
              onChange: (next) => setDraft((value) => withStoredKeys(value, next)),
            }}
          />
        </section>
      </form>
    </SidePanel>
  );
}
