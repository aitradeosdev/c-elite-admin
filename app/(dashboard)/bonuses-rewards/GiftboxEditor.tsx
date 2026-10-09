'use client';

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { Button, FieldShell, Input, Modal, Notice, Textarea, Toggle, useConfirm, useToast } from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { GIFTBOX_DESCRIPTION_MAX, GIFTBOX_NOTE_MAX, GIFTBOX_TITLE_MAX, sameAmount } from './rewardRules';
import {
  GIFTBOX_ENDPOINT, checkGiftboxForm, classifyGiftboxSave, emptyGiftboxForm, formDirty, giftboxChanges,
  giftboxCreateBody, giftboxFormFrom, giftboxPatchBody, intendedValues, isLegacyRule, rebaseGiftboxForm,
  sameAsIntended, sameGiftboxItem, toGiftboxReceipt,
  type GiftboxDraftValues, type GiftboxForm, type GiftboxFormCheck, type GiftboxFormField, type GiftboxItem,
  type GiftboxOutcome, type PageNotice, type Phase,
} from './model';
import { discardEditorOptions, giftboxCreateOptions, giftboxEditOptions, leaveOptions } from './confirmOptions';
import { PageNoticeView } from './RewardParts';
import { RuleBuilder } from './RuleBuilder';
import { useLeaveGuard } from './useLeaveGuard';
import s from './page.module.css';

const FIELD_ORDER: readonly GiftboxFormField[] = ['title', 'reward', 'expiry', 'description'];

export interface GiftboxEditorProps {
  item: GiftboxItem | null;
  items: readonly GiftboxItem[];
  today: string;
  reload: () => Promise<GiftboxItem[] | null>;
  onClose: () => void;
}

export function GiftboxEditor({ item, items, today, reload, onClose }: GiftboxEditorProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const idBase = useId();
  const formId = `${idBase}-form`;
  const keyRef = useRef(0);
  const nextKey = useCallback(() => {
    keyRef.current += 1;
    return `rule-${keyRef.current}`;
  }, []);
  const [baseItem, setBaseItem] = useState<GiftboxItem | null>(item);
  const [baseForm, setBaseForm] = useState<GiftboxForm>(() => (item ? giftboxFormFrom(item, nextKey) : emptyGiftboxForm()));
  const [form, setForm] = useState<GiftboxForm>(baseForm);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [revealAll, setRevealAll] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<PageNotice | null>(null);
  const busyRef = useRef(false);
  const closingRef = useRef(false);
  const saveRef = useRef<HTMLButtonElement>(null);

  const editing = baseItem !== null;
  const busy = phase !== 'idle';
  const working = phase === 'checking' || phase === 'saving';
  const check = useMemo(() => checkGiftboxForm(form, baseItem?.rules ?? [], today), [form, baseItem, today]);
  const dirty = formDirty(form, baseForm);

  useLeaveGuard(dirty, () => confirm(leaveOptions()).then((decision) => decision !== null));

  const ruleProblems = useMemo(() => {
    const shown: Record<string, string> = {};
    for (const rule of form.rules) {
      const problem = check.rules.problems[rule.key];
      if (problem && (revealAll || touched[rule.key] || isLegacyRule(rule))) shown[rule.key] = problem;
    }
    return shown;
  }, [form.rules, check.rules.problems, revealAll, touched]);

  const shownError = (field: GiftboxFormField) => (revealAll || touched[field] ? check.errors[field] : undefined);
  const update = (patch: Partial<GiftboxForm>) => setForm((current) => ({ ...current, ...patch }));
  const touch = (key: string) => setTouched((current) => (current[key] ? current : { ...current, [key]: true }));
  const fieldId = (field: GiftboxFormField) => `${idBase}-${field}`;

  const focusFirstProblem = (result: GiftboxFormCheck) => {
    const field = FIELD_ORDER.find((key) => result.errors[key]);
    const rule = form.rules.find((entry) => result.rules.problems[entry.key]);
    const target = field
      ? document.getElementById(fieldId(field))
      : rule
        ? document.getElementById(`${idBase}-rules-${rule.key}-${isLegacyRule(rule) ? 'remove' : 'type'}`)
        : result.errors.note
          ? document.getElementById(fieldId('note'))
          : null;
    target?.focus();
  };

  const requestClose = async () => {
    if (busyRef.current || closingRef.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    closingRef.current = true;
    try {
      const decision = await confirm(discardEditorOptions(editing, baseItem?.title ?? ''));
      if (decision) onClose();
    } finally {
      closingRef.current = false;
    }
  };

  const applyRebase = (previous: GiftboxItem, latest: GiftboxItem, reason: string) => {
    const result = rebaseGiftboxForm(form, previous, latest, nextKey);
    setBaseItem(latest);
    setBaseForm(giftboxFormFrom(latest, nextKey));
    setForm(result.form);
    setNotice({
      tone: 'warning',
      title: 'This gift box changed while you were editing',
      message: result.conflicts.length > 0
        ? `${reason} Someone else also changed ${result.conflicts.join(', ').toLowerCase()}, which you edited too. Your values are kept: check them, then review again.`
        : `${reason} The latest values were loaded and your edits are kept. Review again to save.`,
      items: [],
    });
  };

  const refused = (status: number | null, message: string) => {
    toast.show(message, 'error');
    if (status === 403) router.refresh();
  };

  const saveEdit = async (base: GiftboxItem, values: GiftboxDraftValues, notes: string[]) => {
    setPhase('checking');
    const fresh = await reload();
    if (!fresh) {
      toast.show('The latest values could not be checked, so nothing was saved. Try again.', 'error');
      return;
    }
    const live = fresh.find((entry) => entry.id === base.id);
    if (!live) {
      toast.show('This gift box no longer exists, so nothing was saved.', 'error');
      onClose();
      return;
    }
    if (!sameGiftboxItem(live, base)) {
      applyRebase(base, live, 'Another admin saved a change to it.');
      return;
    }
    const changes = giftboxChanges(live, values);
    if (changes.length === 0) {
      toast.show('Nothing has changed, so there was nothing to save.');
      onClose();
      return;
    }
    setPhase('confirming');
    const decision = await confirm<GiftboxOutcome>({
      ...giftboxEditOptions(live, values, changes, notes, today),
      action: async () => {
        setPhase('saving');
        const outcome = classifyGiftboxSave(await apiRequest(GIFTBOX_ENDPOINT, {
          method: 'PATCH',
          body: giftboxPatchBody(live, values, changes),
          select: toGiftboxReceipt,
        }));
        if (outcome.kind === 'retry') {
          setPhase('confirming');
          throw new Error(outcome.message);
        }
        return outcome;
      },
      returnFocusTo: () => saveRef.current,
    });
    const outcome = decision?.value;
    if (!outcome) return;
    switch (outcome.kind) {
      case 'saved':
        toast.show(
          outcome.receipt.changed ? `Saved “${values.title}”.` : 'Those values were already live, so nothing changed.',
          outcome.receipt.changed ? 'success' : 'default',
        );
        if (outcome.receipt.warning) toast.show(outcome.receipt.warning, 'warning');
        void reload();
        onClose();
        return;
      case 'conflict': {
        const reloaded = reload();
        const latest = outcome.live ?? (await reloaded)?.find((entry) => entry.id === base.id) ?? null;
        if (latest) applyRebase(live, latest, 'Nothing was saved.');
        toast.show(outcome.message, 'warning');
        return;
      }
      case 'missing':
        toast.show('This gift box no longer exists, so nothing was saved.', 'error');
        void reload();
        onClose();
        return;
      case 'unknown': {
        const after = await reload();
        const landed = after?.find((entry) => entry.id === base.id) ?? null;
        if (landed && sameAsIntended(landed, intendedValues(values, changes))) {
          toast.show(`Saved “${values.title}”.`, 'success');
          onClose();
          return;
        }
        if (landed && !sameGiftboxItem(landed, live)) applyRebase(live, landed, 'It changed after the save was sent.');
        setNotice({
          tone: 'danger',
          title: 'The save could not be confirmed',
          message: `${outcome.message} Your changes are still here. Check the gift box before saving again.`,
          items: [],
        });
        toast.show('The save could not be confirmed. Check the gift box before trying again.', 'error');
        return;
      }
      case 'refused':
        refused(outcome.status, outcome.message);
        return;
      default:
        return;
    }
  };

  const saveCreate = async (values: GiftboxDraftValues, notes: string[]) => {
    const known = new Set(items.map((entry) => entry.id));
    setPhase('confirming');
    const decision = await confirm<GiftboxOutcome>({
      ...giftboxCreateOptions(values, notes, today),
      action: async () => {
        setPhase('saving');
        const outcome = classifyGiftboxSave(await apiRequest(GIFTBOX_ENDPOINT, {
          method: 'POST',
          body: giftboxCreateBody(values),
          select: toGiftboxReceipt,
        }));
        if (outcome.kind === 'retry' || outcome.kind === 'conflict' || outcome.kind === 'missing') {
          setPhase('confirming');
          throw new Error(outcome.message);
        }
        return outcome;
      },
      returnFocusTo: () => saveRef.current,
    });
    const outcome = decision?.value;
    if (!outcome) return;
    switch (outcome.kind) {
      case 'saved':
        toast.show(`Created “${values.title}”.`, 'success');
        if (outcome.receipt.warning) toast.show(outcome.receipt.warning, 'warning');
        void reload();
        onClose();
        return;
      case 'unknown': {
        const after = await reload();
        const created = after?.find((entry) => (
          !known.has(entry.id) && entry.title === values.title && sameAmount(entry.reward, values.reward_naira)
        ));
        if (created) {
          toast.show(`Created “${values.title}”.`, 'success');
          onClose();
          return;
        }
        setNotice({
          tone: 'danger',
          title: 'The gift box may or may not have been created',
          message: `${outcome.message} Check the list before creating it again, so it is not added twice.`,
          items: [],
        });
        toast.show('The new gift box could not be confirmed. Check the list before trying again.', 'error');
        return;
      }
      case 'refused':
        refused(outcome.status, outcome.message);
        return;
      default:
        return;
    }
  };

  const save = async () => {
    if (busyRef.current) return;
    const result = checkGiftboxForm(form, baseItem?.rules ?? [], today);
    if (!result.values) {
      setRevealAll(true);
      focusFirstProblem(result);
      return;
    }
    const values = result.values;
    const notes = Object.values(result.rules.warnings);
    busyRef.current = true;
    setNotice(null);
    try {
      if (baseItem) await saveEdit(baseItem, values, notes);
      else await saveCreate(values, notes);
    } finally {
      busyRef.current = false;
      setPhase('idle');
    }
  };

  return (
    <Modal
      open
      onClose={() => void requestClose()}
      static={busy}
      size="lg"
      title={baseItem ? `Edit “${baseItem.title}”` : 'New gift box'}
      subtitle={baseItem
        ? 'Nothing changes for users until you review and confirm.'
        : 'A one-off reward users claim from the Giftbox screen in the app.'}
      footer={
        <div className={s.editorFoot}>
          {working ? (
            <p className={s.editorStatus} role="status">{phase === 'checking' ? 'Checking the latest values…' : 'Saving…'}</p>
          ) : null}
          <div className={s.editorActions}>
            <Button type="button" variant="ghost" aria-disabled={busy || undefined} onClick={() => void requestClose()}>
              Cancel
            </Button>
            <Button
              ref={saveRef}
              type="submit"
              form={formId}
              variant="primary"
              aria-disabled={busy || undefined}
              aria-busy={working || undefined}
              leftIcon={working ? <LoaderCircle size={14} aria-hidden className={s.spin} /> : undefined}
            >
              {editing ? 'Review changes' : 'Review and create'}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={formId}
        noValidate
        className={s.editorForm}
        aria-busy={busy || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {notice ? <PageNoticeView notice={notice} onDismiss={() => setNotice(null)} /> : null}
        <fieldset className={s.fieldset} disabled={busy}>
          <div className={s.formGrid}>
            <FieldShell
              label="Title"
              required
              htmlFor={fieldId('title')}
              error={shownError('title')}
              help={`Shown on the gift box in the app. Up to ${GIFTBOX_TITLE_MAX} characters.`}
            >
              <Input
                id={fieldId('title')}
                value={form.title}
                maxLength={GIFTBOX_TITLE_MAX}
                autoComplete="off"
                onChange={(event) => update({ title: event.target.value })}
                onBlur={() => touch('title')}
              />
            </FieldShell>
            <div className={s.formPair}>
              <FieldShell
                label="Reward (₦)"
                required
                htmlFor={fieldId('reward')}
                error={shownError('reward')}
                help="Credited to the user’s bonus balance when they claim."
              >
                <Input
                  id={fieldId('reward')}
                  mono
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="e.g. 500"
                  value={form.reward}
                  onChange={(event) => update({ reward: event.target.value })}
                  onBlur={() => touch('reward')}
                />
              </FieldShell>
              <FieldShell
                label="End date"
                htmlFor={fieldId('expiry')}
                error={shownError('expiry')}
                help="The last day users can claim it."
              >
                <Input
                  id={fieldId('expiry')}
                  type="date"
                  value={form.expiry}
                  onChange={(event) => update({ expiry: event.target.value })}
                  onBlur={() => touch('expiry')}
                />
              </FieldShell>
            </div>
            <FieldShell
              label="Description"
              htmlFor={fieldId('description')}
              error={shownError('description')}
              help="Shown under the title in the app, up to three lines."
            >
              <Textarea
                id={fieldId('description')}
                rows={3}
                maxLength={GIFTBOX_DESCRIPTION_MAX}
                value={form.description}
                onChange={(event) => update({ description: event.target.value })}
                onBlur={() => touch('description')}
              />
            </FieldShell>
            <RuleBuilder
              idBase={`${idBase}-rules`}
              rules={form.rules}
              problems={ruleProblems}
              warnings={check.rules.warnings}
              disabled={busy}
              nextKey={nextKey}
              onChange={(rules) => update({ rules })}
              onBlur={touch}
            />
            <FieldShell
              label="Requirement note (admins only)"
              htmlFor={fieldId('note')}
              error={shownError('note')}
              help="Not shown in the app. The rules above decide who can claim."
            >
              <Input
                id={fieldId('note')}
                value={form.note}
                maxLength={GIFTBOX_NOTE_MAX}
                autoComplete="off"
                onChange={(event) => update({ note: event.target.value })}
                onBlur={() => touch('note')}
              />
            </FieldShell>
            <div className={s.statusRow}>
              <Toggle checked={form.active} label="Live in the app" onChange={(next) => update({ active: next })} />
              <p className={s.statusHint}>
                {form.active
                  ? 'Users can claim it once it is saved, while its end date has not passed.'
                  : 'Saved switched off: users cannot see or claim it.'}
              </p>
            </div>
            {check.warnings.length > 0 ? (
              <Notice tone="warning" compact flush>{check.warnings.join(' ')}</Notice>
            ) : null}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
