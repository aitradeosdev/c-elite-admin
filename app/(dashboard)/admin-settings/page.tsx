'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  AccessDenied, Card, ErrorState, PageHeader, useConfirm, usePermissions, useResource, useToast,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { guardedPath } from '../_config/ConfigForm';
import {
  BILL_PROVIDERS, BILL_PROVIDER_LABELS, GATEWAY_LABELS, IDENTITY_KEY, PAYMENT_GATEWAYS, PRIMARY_BILL_KEY,
  PRIMARY_GATEWAY_KEY, billFlagKey, gatewayFlagKey, joinLabels, settingLabel,
} from './rules';
import {
  KEEP_SECRET, SETTINGS_ENDPOINT, applySaved, billNotice, classifySave, editChanges, editErrors, emergencyPayload,
  emergencyState, firstInvalidKey, involvesMoney, isEditDirty, payoutNotice, pendingCount, rebaseEdit,
  reviewConsequences, reviewRows, savePayload, savedMessage, sectionById, startEdit, toSaveReceipt, toSnapshot,
  type RebaseOutcome, type SaveOutcome, type SavePayload, type SecretDraft, type SectionId, type SettingsEdit,
  type SettingsSnapshot,
} from './model';
import { discardOptions, emergencyOptions, leaveOptions, reviewOptions } from './confirmOptions';
import {
  EmergencyCard, ProviderCard, SaveBar, SecretField, SectionCard, SettingInput, SettingsSkeleton, secretReplaceId,
  secretUndoId, type Phase, type ProviderOption,
} from './SettingsParts';
import s from './page.module.css';

const TITLE = 'Admin Settings';
const SUBTITLE = 'Platform-wide configuration for payouts, bills, support and the user app. Super admins only; every change is recorded in the audit log.';
const DENIED_TITLE = 'Super administrators only';
const DENIED_MESSAGE = 'Platform settings can only be viewed and changed by a super administrator. Ask one if something here needs to change.';
const AUDIT_WARNING = 'The change was saved, but it could not be written to the audit log.';
const RELOAD_WARNING = 'Saved, but the latest values could not be reloaded. Refresh the page to confirm them.';
const UNCONFIRMED = 'Could not reach the server, so the save could not be confirmed. Reload the page to check the live values before trying again.';
const PLAIN_SECTIONS: readonly SectionId[] = ['approvals', 'version', 'support', 'legal', 'stores'];

const GATEWAY_OPTIONS: ProviderOption[] = PAYMENT_GATEWAYS.map((value) => ({
  value, label: GATEWAY_LABELS[value], flagKey: gatewayFlagKey(value),
}));

const BILL_OPTIONS: ProviderOption[] = BILL_PROVIDERS.map((value) => ({
  value, label: BILL_PROVIDER_LABELS[value], flagKey: billFlagKey(value),
}));

const fetchSettings = (signal: AbortSignal) => apiRequest(SETTINGS_ENDPOINT, { signal, select: toSnapshot });

interface FocusRequest {
  id: string;
  soft: boolean;
  seq: number;
}

interface SaveAttempt {
  outcome: SaveOutcome;
  payload: SavePayload;
  reloaded: boolean;
}

function focusable(element: HTMLElement): HTMLElement | null {
  if (element.matches('input, select, textarea, button, [tabindex]')) return element;
  return element.querySelector<HTMLElement>('input:checked:not(:disabled)')
    ?? element.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)');
}

function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

export default function AdminSettingsPage() {
  const { isSuperAdmin } = usePermissions();
  if (!isSuperAdmin) {
    return (
      <div className={s.page}>
        <AccessDenied title={DENIED_TITLE} message={DENIED_MESSAGE} />
      </div>
    );
  }
  return <AdminSettings />;
}

function AdminSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const baseId = useId();
  const settings = useResource<SettingsSnapshot>('admin-settings', fetchSettings);
  const { refresh: refreshSettings, mutate: mutateSettings } = settings;
  const live = settings.data;

  const [edit, setEdit] = useState<SettingsEdit | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [revealAll, setRevealAll] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const busyRef = useRef(false);
  const deniedRef = useRef(false);
  const leavingRef = useRef(false);
  const leaveRef = useRef<(path: string) => void>(() => {});
  const formRef = useRef<HTMLFormElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const emergencyRef = useRef<HTMLButtonElement>(null);

  const formId = `${baseId}-form`;
  const fieldId = useCallback((key: string) => `${baseId}-${key}`, [baseId]);
  const headingId = (name: string) => `${baseId}-heading-${name}`;

  const active = isEditDirty(edit) ? edit : null;
  const count = pendingCount(active);
  const changes = useMemo(() => (active ? editChanges(active) : []), [active]);
  const errors = useMemo<Record<string, string>>(() => (active ? editErrors(active) : {}), [active]);
  const shownErrors = useMemo(() => {
    const shown: Record<string, string> = {};
    for (const [key, message] of Object.entries(errors)) {
      if (revealAll || touched[key]) shown[key] = message;
    }
    return shown;
  }, [errors, revealAll, touched]);
  const issueCount = Object.keys(shownErrors).length;
  const busy = phase !== 'idle' || emergencyBusy;

  const requestFocus = useCallback((id: string, soft = false) => {
    setFocusRequest((previous) => ({ id, soft, seq: (previous?.seq ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.soft && !focusLost()) return;
    const element = document.getElementById(focusRequest.id);
    const target = element ? focusable(element) : null;
    if (!target) return;
    target.focus({ preventScroll: true });
    if (!focusRequest.soft) target.scrollIntoView({ block: 'center' });
  }, [focusRequest]);

  useEffect(() => {
    if (settings.error?.status !== 403 || deniedRef.current) return;
    deniedRef.current = true;
    router.refresh();
  }, [settings.error, router]);

  useEffect(() => {
    leaveRef.current = (path: string) => {
      void confirm(leaveOptions(count)).then((decision) => {
        if (!decision) return;
        leavingRef.current = true;
        router.push(path);
      });
    };
  });

  const dirty = active !== null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const intercept = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const path = guardedPath(anchor.href, window.location.href);
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      leaveRef.current(path);
    };
    window.addEventListener('click', intercept, true);
    return () => window.removeEventListener('click', intercept, true);
  }, [dirty]);

  const resetInteraction = useCallback(() => {
    setTouched({});
    setRevealAll(false);
  }, []);

  const finishEdit = useCallback(() => {
    setEdit(null);
    resetInteraction();
  }, [resetInteraction]);

  const beginEdit = useCallback((update: (current: SettingsEdit) => SettingsEdit) => {
    setEdit((previous) => {
      const current = previous && isEditDirty(previous) ? previous : live ? startEdit(live) : null;
      return current ? update(current) : previous;
    });
  }, [live]);

  const setValue = useCallback((key: string, value: string) => {
    beginEdit((current) => (current.draft[key] === value ? current : { ...current, draft: { ...current.draft, [key]: value } }));
  }, [beginEdit]);

  const setSecret = useCallback((next: SecretDraft) => {
    beginEdit((current) => ({ ...current, secret: next }));
  }, [beginEdit]);

  const touch = useCallback((key: string) => {
    setTouched((previous) => (previous[key] ? previous : { ...previous, [key]: true }));
  }, []);

  const reloadAfterSave = async (snapshot: SettingsSnapshot, payload: SavePayload): Promise<boolean> => {
    const after = await refreshSettings();
    if (after && after.ok) return true;
    mutateSettings(applySaved(snapshot, payload, new Date().toISOString()));
    return false;
  };

  const reconcile = async (from: SettingsEdit, secretSent: boolean): Promise<RebaseOutcome | null> => {
    const fresh = await refreshSettings();
    if (!fresh || !fresh.ok) return null;
    const latest = fresh.data;
    const previous = from.base.identity;
    const secretMoved = previous.set !== latest.identity.set || previous.updatedAt !== latest.identity.updatedAt;
    const source = secretSent && secretMoved ? { ...from, secret: KEEP_SECRET } : from;
    const rebased = rebaseEdit(source, latest);
    if (rebased.dirty) setEdit(rebased.edit);
    else finishEdit();
    return rebased;
  };

  const reportSave = async (attempt: SaveAttempt, target: SettingsEdit) => {
    const { outcome, payload } = attempt;
    const sentCount = Object.keys(payload.changes).length;
    switch (outcome.kind) {
      case 'done':
        toast.show(savedMessage(outcome.receipt, sentCount), 'success');
        if (!outcome.receipt.auditRecorded) toast.show(outcome.receipt.warning ?? AUDIT_WARNING, 'warning');
        if (!attempt.reloaded) toast.show(RELOAD_WARNING, 'warning');
        requestFocus(formId, true);
        return;
      case 'conflict': {
        await reconcile(target, false);
        const labels = outcome.keys.length > 0 ? joinLabels(outcome.keys.map(settingLabel)) : 'these settings';
        toast.show(
          `Another admin changed ${labels} while you were reviewing, so nothing was saved. Your edits are kept: check the values and review again.`,
          'warning',
        );
        return;
      }
      case 'denied':
        toast.show(outcome.message, 'error');
        router.refresh();
        return;
      case 'unknown': {
        const rebased = await reconcile(target, Object.prototype.hasOwnProperty.call(payload.changes, IDENTITY_KEY));
        if (!rebased) {
          toast.show(UNCONFIRMED, 'error');
          return;
        }
        if (!rebased.dirty) {
          toast.show(savedMessage({ changed: null, unchanged: [], auditRecorded: true, warning: null }, sentCount), 'success');
          return;
        }
        toast.show(
          'Could not confirm the save, and some values are not live yet. Your edits are kept: review and apply them again.',
          'error',
        );
        return;
      }
      default:
        return;
    }
  };

  const review = async () => {
    if (!active || busyRef.current) return;
    const invalid = firstInvalidKey(errors);
    if (invalid) {
      setRevealAll(true);
      requestFocus(fieldId(invalid));
      return;
    }
    busyRef.current = true;
    reviewRef.current?.focus({ preventScroll: true });
    setPhase('checking');
    let sent = false;
    let settled = false;
    try {
      const fresh = await refreshSettings();
      if (!fresh || !fresh.ok) {
        if (fresh?.error.status === 401) return;
        const detail = fresh ? ` ${fresh.error.message}` : '';
        toast.show(`Could not check the live values, so nothing was applied.${detail}`, 'error');
        if (fresh?.error.status === 403) router.refresh();
        return;
      }
      const latest = fresh.data;
      const rebased = rebaseEdit(active, latest);
      if (!rebased.dirty) {
        finishEdit();
        requestFocus(formId, true);
        toast.show('These values are already live. Nothing needed to change.');
        return;
      }
      const target = rebased.edit;
      setEdit(target);
      const stillInvalid = firstInvalidKey(editErrors(target));
      if (stillInvalid) {
        setRevealAll(true);
        requestFocus(fieldId(stillInvalid));
        toast.show('Another admin changed these settings while you were editing. Check the highlighted field.', 'warning');
        return;
      }
      setPhase('confirming');
      const decision = await confirm<SaveAttempt>({
        ...reviewOptions({
          rows: reviewRows(target),
          consequences: reviewConsequences(target),
          conflicts: rebased.conflicts,
          money: involvesMoney(target),
        }),
        action: async ({ reason }) => {
          sent = true;
          const payload = savePayload(target, reason);
          const outcome = classifySave(await apiRequest(SETTINGS_ENDPOINT, {
            method: 'PATCH',
            body: payload,
            select: toSaveReceipt,
          }));
          if (outcome.kind === 'refused') throw new Error(outcome.message);
          let reloaded = true;
          if (outcome.kind === 'done') {
            settled = true;
            reloaded = await reloadAfterSave(latest, payload);
            finishEdit();
          }
          return { outcome, payload, reloaded };
        },
        returnFocusTo: () => formRef.current,
      });
      const attempt = decision?.value;
      if (!attempt) return;
      if (attempt.outcome.kind !== 'done') settled = true;
      await reportSave(attempt, target);
    } finally {
      busyRef.current = false;
      setPhase('idle');
      if (sent && !settled) void refreshSettings({ background: true });
    }
  };

  const discard = async () => {
    if (!active || busyRef.current) return;
    const decision = await confirm(discardOptions(count));
    if (!decision) return;
    finishEdit();
    requestFocus(formId, true);
  };

  const reportEmergency = (outcome: SaveOutcome, turnOn: boolean) => {
    switch (outcome.kind) {
      case 'done': {
        const { receipt } = outcome;
        if (receipt.changed !== null && receipt.changed.length === 0) {
          toast.show(`Emergency mode was already ${turnOn ? 'on' : 'off'}. Nothing changed.`);
        } else {
          toast.show(
            turnOn
              ? 'Emergency mode is on. Users now see the maintenance screen, and new withdrawals and bill payments are refused.'
              : 'Emergency mode is off. Users can use the app again.',
            'success',
          );
        }
        if (!receipt.auditRecorded) toast.show(receipt.warning ?? AUDIT_WARNING, 'warning');
        return;
      }
      case 'conflict':
        toast.show(
          'Another admin changed emergency mode while you were confirming, so nothing was changed. Check its current state.',
          'warning',
        );
        return;
      case 'denied':
        toast.show(outcome.message, 'error');
        router.refresh();
        return;
      case 'unknown':
        toast.show(
          'The change was sent, but no response came back, so emergency mode may or may not have changed. The page now shows the current state; check it before trying again.',
          'error',
        );
        return;
      default:
        return;
    }
  };

  const toggleEmergency = async (turnOn: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setEmergencyBusy(true);
    let sent = false;
    let settled = false;
    try {
      const fresh = await refreshSettings();
      if (!fresh || !fresh.ok) {
        if (fresh?.error.status === 401) return;
        const detail = fresh ? ` ${fresh.error.message}` : '';
        toast.show(`Could not check emergency mode, so nothing was changed.${detail}`, 'error');
        if (fresh?.error.status === 403) router.refresh();
        return;
      }
      const snapshot = fresh.data;
      const current = emergencyState(snapshot);
      if (current.on === turnOn) {
        toast.show(
          turnOn
            ? 'Emergency mode is already on. Another admin turned it on.'
            : 'Emergency mode is already off. Another admin turned it off.',
          'warning',
        );
        return;
      }
      setEmergencyBusy(false);
      const decision = await confirm<SaveOutcome>({
        ...emergencyOptions(turnOn, current.since),
        action: async ({ reason }) => {
          sent = true;
          const payload = emergencyPayload(turnOn, reason);
          const outcome = classifySave(await apiRequest(SETTINGS_ENDPOINT, {
            method: 'PATCH',
            body: payload,
            select: toSaveReceipt,
          }));
          if (outcome.kind === 'refused') throw new Error(outcome.message);
          if (outcome.kind === 'done') {
            settled = true;
            await reloadAfterSave(snapshot, payload);
          }
          return outcome;
        },
        returnFocusTo: () => emergencyRef.current,
      });
      const outcome = decision?.value;
      if (outcome) reportEmergency(outcome, turnOn);
    } finally {
      busyRef.current = false;
      setEmergencyBusy(false);
      if (sent && !settled) void refreshSettings({ background: true });
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void review();
  };

  if (!live) {
    const failure = settings.error;
    if (failure?.status === 403) {
      return (
        <div className={s.page}>
          <AccessDenied title={DENIED_TITLE} message={DENIED_MESSAGE} />
        </div>
      );
    }
    return (
      <div className={s.page}>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        {failure ? (
          <Card>
            <ErrorState
              compact
              title="These settings could not be loaded"
              message={failure.message}
              requestId={failure.requestId}
              retrying={settings.isInitialLoading}
              onRetry={() => void refreshSettings()}
            />
          </Card>
        ) : (
          <SettingsSkeleton />
        )}
      </div>
    );
  }

  const base = active ? active.base : live;
  const values = active ? active.draft : live.values;
  const secret = active ? active.secret : KEEP_SECRET;
  const modified = new Set(changes.map((change) => change.key));
  if (secret.mode !== 'keep') modified.add(IDENTITY_KEY);
  const identityId = fieldId(IDENTITY_KEY);

  return (
    <div className={s.page}>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />

      <EmergencyCard
        state={emergencyState(live)}
        headingId={headingId('emergency')}
        busy={emergencyBusy}
        disabled={busy}
        buttonRef={emergencyRef}
        onToggle={(turnOn) => void toggleEmergency(turnOn)}
      />

      <form
        ref={formRef}
        id={formId}
        className={[s.form, dirty && s.formWithBar].filter(Boolean).join(' ')}
        noValidate
        tabIndex={-1}
        aria-label="Platform settings"
        aria-busy={busy || undefined}
        onSubmit={onSubmit}
      >
        <fieldset className={s.fieldset} disabled={busy}>
          <ProviderCard
            section={sectionById('payouts')}
            headingId={headingId('payouts')}
            primaryKey={PRIMARY_GATEWAY_KEY}
            providers={GATEWAY_OPTIONS}
            noun="gateway"
            values={values}
            errors={shownErrors}
            modified={modified}
            notice={payoutNotice(live)}
            fieldId={fieldId}
            onChange={setValue}
            onBlur={touch}
          />
          <ProviderCard
            section={sectionById('bills')}
            headingId={headingId('bills')}
            primaryKey={PRIMARY_BILL_KEY}
            providers={BILL_OPTIONS}
            noun="provider"
            values={values}
            errors={shownErrors}
            modified={modified}
            notice={billNotice(live)}
            fieldId={fieldId}
            onChange={setValue}
            onBlur={touch}
          />
          {PLAIN_SECTIONS.map((id) => {
            const section = sectionById(id);
            return (
              <SectionCard key={id} headingId={headingId(id)} title={section.title} description={section.description}>
                <div className={s.grid}>
                  {section.fields.map((field) => (
                    <SettingInput
                      key={field.key}
                      field={field}
                      id={fieldId(field.key)}
                      value={values[field.key] ?? ''}
                      error={shownErrors[field.key]}
                      modified={modified.has(field.key)}
                      onChange={setValue}
                      onBlur={touch}
                    />
                  ))}
                  {id === 'support' ? (
                    <SecretField
                      id={identityId}
                      identity={base.identity}
                      draft={secret}
                      error={shownErrors[IDENTITY_KEY]}
                      onReplace={() => {
                        setSecret({ mode: 'replace', value: '' });
                        requestFocus(identityId);
                      }}
                      onRemove={() => {
                        setSecret({ mode: 'clear' });
                        requestFocus(secretUndoId(identityId));
                      }}
                      onCancel={() => {
                        setSecret(KEEP_SECRET);
                        setTouched((previous) => ({ ...previous, [IDENTITY_KEY]: false }));
                        requestFocus(secretReplaceId(identityId));
                      }}
                      onValue={(value) => setSecret({ mode: 'replace', value })}
                      onBlur={() => touch(IDENTITY_KEY)}
                    />
                  ) : null}
                </div>
              </SectionCard>
            );
          })}
        </fieldset>

        {dirty ? (
          <SaveBar
            count={count}
            issues={issueCount}
            phase={phase}
            reviewRef={reviewRef}
            onDiscard={() => void discard()}
          />
        ) : null}
      </form>
    </div>
  );
}
