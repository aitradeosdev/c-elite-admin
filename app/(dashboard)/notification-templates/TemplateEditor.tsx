'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FieldShell, Input, Notice, SidePanel, Textarea, Toggle, useConfirm, useToast } from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { formatAge } from '../../lib/time';
import type { TemplateFieldSpec, TemplateRecord } from './templateRules';
import {
  activeChange, classifySave, defaultSamples, draftOf, fieldChanges, firstInvalidField, insertToken, isDirty,
  rebaseDraft, recordFromDraft, sameContent, sameRecord, savePayload, templateName, templateProblems, toSaveReceipt,
  variableUses,
  type SaveOutcome, type TemplateDraft,
} from './templateModel';
import { discardOptions, saveOptions, type RemovedVariables } from './confirmOptions';
import { FieldNotes, IssueList, SampleValues, VariableChips } from './TemplateParts';
import type { TemplatePageConfig } from './templateConfig';
import s from './page.module.css';

export interface TemplateEditorProps {
  config: TemplatePageConfig;
  template: TemplateRecord;
  canWrite: boolean;
  readFresh: () => Promise<readonly TemplateRecord[] | null>;
  onSaved: (record: TemplateRecord) => void;
  onRefresh: () => void;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

interface CaretRequest {
  field: string;
  position: number;
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function updatedText(record: TemplateRecord): string {
  return record.updatedAt ? `changed ${formatAge(record.updatedAt)} ago` : 'never changed';
}

export function TemplateEditor({
  config, template, canWrite, readFresh, onSaved, onRefresh, onClose, returnFocusTo,
}: TemplateEditorProps) {
  const { channel, Preview } = config;
  const noun = channel.id === 'email' ? 'email' : 'notification';
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const router = useRouter();
  const formId = useId();
  const sendingId = useId();
  const contentId = useId();
  const previewId = useId();
  const chipsId = useId();
  const [base, setBase] = useState<TemplateRecord>(template);
  const [draft, setDraft] = useState<TemplateDraft>(() => draftOf(template));
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [revealAll, setRevealAll] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [samples, setSamples] = useState<Record<string, string>>(() => defaultSamples(template.variables));
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRefs = useRef<Record<string, FieldElement | null>>({});
  const focusedRef = useRef<Set<string>>(new Set<string>());
  const lastFieldRef = useRef<string>(channel.fields[channel.fields.length - 1]?.name ?? '');
  const caretRef = useRef<CaretRequest | null>(null);

  const name = templateName(base);
  const dirty = canWrite && isDirty(channel, base, draft);
  const problems = useMemo(() => templateProblems(channel, base, draft), [channel, base, draft]);
  const uses = useMemo(() => variableUses(channel, draft, base.variables), [channel, draft, base.variables]);
  const fieldNames = channel.fields.map((field) => field.label.toLowerCase()).join(' or ');

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

  useEffect(() => {
    if (busyRef.current || sameRecord(channel, template, base) || isDirty(channel, base, draft)) return;
    setBase(template);
    setDraft(draftOf(template));
    setSamples((current) => ({ ...defaultSamples(template.variables), ...current }));
  }, [channel, template, base, draft]);

  useLayoutEffect(() => {
    const pending = caretRef.current;
    if (!pending) return;
    caretRef.current = null;
    const element = fieldRefs.current[pending.field];
    if (!element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(pending.position, pending.position);
  }, [draft]);

  const update = (field: string, value: string) => {
    setDraft((current) => (
      current.values[field] === value ? current : { ...current, values: { ...current.values, [field]: value } }
    ));
  };

  const insertVariable = (variable: string) => {
    if (!canWrite || busyRef.current) return;
    const field = lastFieldRef.current;
    const element = fieldRefs.current[field];
    const current = draft.values[field] ?? '';
    const known = Boolean(element) && focusedRef.current.has(field);
    const next = insertToken(
      current,
      `{${variable}}`,
      known && element ? element.selectionStart : null,
      known && element ? element.selectionEnd : null,
    );
    caretRef.current = { field, position: next.caret };
    focusedRef.current.add(field);
    update(field, next.value);
  };

  const focusField = (field: string) => {
    const element = fieldRefs.current[field];
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' });
  };

  const requestClose = useCallback(async () => {
    if (busyRef.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    const decision = await confirm(discardOptions(base));
    if (decision && aliveRef.current) onClose();
  }, [base, confirm, dirty, onClose]);

  const applyRebase = (from: TemplateRecord, mine: TemplateDraft, live: TemplateRecord): string[] => {
    const rebased = rebaseDraft(channel, from, mine, live);
    setBase(live);
    setDraft(rebased.draft);
    setSamples((current) => ({ ...defaultSamples(live.variables), ...current }));
    return rebased.conflicts;
  };

  const reloadAfterConflict = async (sentFrom: TemplateRecord, sent: TemplateDraft): Promise<boolean> => {
    const fresh = await readFresh();
    if (!aliveRef.current || !fresh) return false;
    const live = fresh.find((row) => row.key === sentFrom.key);
    if (!live) {
      notify(`${name} no longer exists, so nothing was saved.`, 'warning');
      onClose();
      return true;
    }
    const conflicts = applyRebase(sentFrom, sent, live);
    setNotice(conflicts.length > 0
      ? `Nothing was saved: someone else saved this template while you were reviewing, and they also changed the ${joinLabels(conflicts.map((label) => label.toLowerCase()))}. Your edits are kept. Review again to compare their version with yours.`
      : 'Nothing was saved: someone else saved this template while you were reviewing. Their changes are loaded and your edits are kept. Review again to save.');
    return true;
  };

  const settle = async (outcome: SaveOutcome, sentFrom: TemplateRecord, sent: TemplateDraft) => {
    switch (outcome.kind) {
      case 'saved': {
        const record = outcome.receipt.template ?? recordFromDraft(sentFrom, sent);
        onSaved(record);
        notify(
          outcome.receipt.changed
            ? `Saved ${name}. The next ${noun} sent uses this version.`
            : 'Nothing changed. This version was already live.',
          'success',
        );
        if (outcome.receipt.warning) notify(outcome.receipt.warning, 'warning');
        onClose();
        return;
      }
      case 'stale':
        if (!(await reloadAfterConflict(sentFrom, sent)) && aliveRef.current) notify(outcome.message, 'warning');
        return;
      case 'unknown': {
        const fresh = await readFresh();
        if (!aliveRef.current) return;
        const live = fresh?.find((row) => row.key === sentFrom.key) ?? null;
        if (live && sameContent(channel, live, sent)) {
          onSaved(live);
          notify(`Saved ${name}. The connection dropped, but the template now has your changes.`, 'success');
          onClose();
          return;
        }
        if (live) {
          applyRebase(sentFrom, sent, live);
          notify(
            'The save could not be confirmed, and the template still shows the earlier version. Your edits are kept here, so you can review and save again.',
            'error',
          );
          return;
        }
        notify(outcome.message, 'error');
        return;
      }
      case 'missing':
        notify(outcome.message, 'error');
        onRefresh();
        onClose();
        return;
      case 'refused':
        notify(outcome.message, 'error');
        router.refresh();
        return;
      case 'expired':
      case 'retry':
        return;
    }
  };

  const review = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (busyRef.current || !canWrite) return;
    const invalid = firstInvalidField(channel, problems);
    if (invalid) {
      setRevealAll(true);
      focusField(invalid);
      return;
    }
    if (!dirty) return;
    busyRef.current = true;
    setReviewing(true);
    setNotice(null);
    let sent = false;
    let settled = false;
    try {
      const fresh = await readFresh();
      if (!aliveRef.current || !fresh) return;
      const live = fresh.find((row) => row.key === base.key);
      if (!live) {
        notify(`${name} no longer exists, so nothing was saved.`, 'warning');
        onClose();
        return;
      }
      const rebased = rebaseDraft(channel, base, draft, live);
      setBase(live);
      setDraft(rebased.draft);
      setSamples((current) => ({ ...defaultSamples(live.variables), ...current }));
      if (rebased.refreshed.length > 0) {
        setNotice(`Another admin changed the ${joinLabels(rebased.refreshed.map((label) => label.toLowerCase()))} since you opened this template. You had not edited ${rebased.refreshed.length === 1 ? 'it' : 'them'}, so their version is shown.`);
      }
      const recheck = templateProblems(channel, live, rebased.draft);
      const again = firstInvalidField(channel, recheck);
      if (again) {
        setRevealAll(true);
        notify('This template changed while you were editing. Check the highlighted field before saving.', 'warning');
        focusField(again);
        return;
      }
      const changes = fieldChanges(channel, live, rebased.draft);
      const active = activeChange(live, rebased.draft);
      if (changes.length === 0 && !active) {
        notify('Nothing to save. This version is already live.');
        return;
      }
      const removed: RemovedVariables[] = channel.fields.map((field) => ({
        label: field.label,
        names: recheck[field.name]?.removed ?? [],
      }));
      const sentDraft = rebased.draft;
      const decision = await confirm<SaveOutcome>({
        ...saveOptions({ channel, template: live, changes, active, conflicts: rebased.conflicts, removed }),
        returnFocusTo: () => formRef.current,
        action: async ({ reason }) => {
          sent = true;
          const outcome = classifySave(await apiRequest(config.apiPath, {
            method: 'PATCH',
            body: savePayload(channel, live, sentDraft, reason),
            select: toSaveReceipt(channel),
          }));
          if (outcome.kind === 'retry') throw new Error(outcome.message);
          settled = true;
          return outcome;
        },
      });
      const outcome = decision?.value;
      if (!outcome || !aliveRef.current) return;
      await settle(outcome, live, sentDraft);
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setReviewing(false);
      if (sent && !settled) onRefresh();
    }
  };

  const markTouched = (field: string) => {
    setTouched((current) => {
      if (current.has(field)) return current;
      const next = new Set(current);
      next.add(field);
      return next;
    });
  };

  const renderField = (field: TemplateFieldSpec) => {
    const value = draft.values[field.name] ?? '';
    const problem = problems[field.name] ?? { errors: [], warnings: [], removed: [] };
    const shownErrors = canWrite && (revealAll || touched.has(field.name)) ? problem.errors : [];
    const over = value.length > field.max;
    const counter = (
      <span className={over ? s.counterOver : s.counter}>
        {`${value.length.toLocaleString('en-NG')} of ${field.max.toLocaleString('en-NG')} characters`}
      </span>
    );
    const html = field.mode === 'html';
    const shared = {
      value,
      readOnly: !canWrite || reviewing,
      spellCheck: !html,
      autoComplete: 'off',
      onFocus: () => {
        lastFieldRef.current = field.name;
        focusedRef.current.add(field.name);
      },
      onBlur: () => markTouched(field.name),
    };
    return (
      <div key={field.name} className={s.fieldBlock}>
        <FieldShell
          label={field.label}
          required={canWrite}
          error={shownErrors.length > 0 ? <IssueList items={shownErrors} /> : undefined}
          help={counter}
        >
          {field.multiline ? (
            <Textarea
              {...shared}
              ref={(node) => {
                fieldRefs.current[field.name] = node;
              }}
              rows={html ? 16 : 4}
              mono={html}
              className={html ? s.htmlArea : s.bodyArea}
              onChange={(event) => update(field.name, event.target.value)}
            />
          ) : (
            <Input
              {...shared}
              ref={(node) => {
                fieldRefs.current[field.name] = node;
              }}
              onChange={(event) => update(field.name, event.target.value)}
            />
          )}
        </FieldShell>
        <FieldNotes warnings={problem.warnings} removed={problem.removed} />
      </div>
    );
  };

  return (
    <SidePanel
      open
      wide
      onClose={() => void requestClose()}
      title={canWrite ? `Edit ${name}` : name}
      subtitle={`${base.key} · ${updatedText(base)}`}
      returnFocusTo={returnFocusTo}
      footer={
        <div className={s.panelFooter}>
          <span className={s.unsaved}>{dirty ? 'Unsaved changes' : ''}</span>
          <Button type="button" variant="ghost" disabled={reviewing} onClick={() => void requestClose()}>
            {canWrite ? 'Cancel' : 'Close'}
          </Button>
          {canWrite ? (
            <Button type="submit" form={formId} variant="primary" loading={reviewing} disabled={!dirty}>
              Review changes
            </Button>
          ) : null}
        </div>
      }
    >
      <form
        ref={formRef}
        id={formId}
        className={s.form}
        tabIndex={-1}
        noValidate
        onSubmit={(event) => void review(event)}
      >
        {notice ? (
          <Notice tone="warning" compact flush announce="polite" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        ) : null}
        {!canWrite ? (
          <Notice tone="neutral" compact flush>
            {`You can view this template but not change it. Editing needs the ${config.writePermissionLabel} permission (${config.writePermission}).`}
          </Notice>
        ) : null}
        {base.description ? (
          <Notice variant="callout" tone="neutral" icon={null} title="Sent when">
            {base.description}
          </Notice>
        ) : null}

        <section className={s.section} aria-labelledby={sendingId}>
          <h3 id={sendingId} className={s.sectionTitle}>Sending</h3>
          <Toggle
            checked={draft.isActive}
            disabled={!canWrite || reviewing}
            label={`Send this ${noun}`}
            onChange={(next) => setDraft((current) => ({ ...current, isActive: next }))}
          />
          <p className={s.hint}>
            {draft.isActive
              ? `Users get this ${noun} every time the event happens.`
              : `Nothing is sent for this event while it is switched off.`}
          </p>
        </section>

        <section className={s.section} aria-labelledby={contentId}>
          <h3 id={contentId} className={s.sectionTitle}>Content</h3>
          <div className={s.variables}>
            <p id={chipsId} className={s.subTitle}>Variables</p>
            <p className={s.hint}>
              {canWrite
                ? `Each one is filled in when the ${noun} is sent. Select one to insert it at the cursor in the ${fieldNames}.`
                : `Each one is filled in when the ${noun} is sent.`}
            </p>
            <VariableChips
              variables={base.variables}
              uses={uses}
              onInsert={canWrite ? insertVariable : undefined}
              disabled={reviewing}
              labelledBy={chipsId}
            />
          </div>
          {channel.fields.map(renderField)}
        </section>

        <section className={s.section} aria-labelledby={previewId}>
          <h3 id={previewId} className={s.sectionTitle}>Preview</h3>
          <Preview channel={channel} variables={base.variables} values={draft.values} samples={samples} />
          <SampleValues
            variables={base.variables}
            samples={samples}
            onChange={(variable, value) => setSamples((current) => ({ ...current, [variable]: value }))}
            onReset={() => setSamples(defaultSamples(base.variables))}
          />
        </section>
      </form>
    </SidePanel>
  );
}
