'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUp, Trash2 } from 'lucide-react';
import {
  Button, FieldShell, Input, Modal, Notice, Toggle, useConfirm, useToast,
  type ConfirmDetail,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { CARD_NAME_MAX, LOGO_ACCEPT, LOGO_MAX_MB, cardNameProblem, logoFileProblem } from './catalogRules';
import { BrandMark, LogoValue, ValueDiff, useLeaveWarning } from './CatalogParts';
import {
  NEW_BRAND, brandChangeConsequences, brandChanges, brandDraftOf, brandLabel, brandPatch, classifyMutation,
  duplicateBrand, nextSortOrder, rebaseBrand, statusText, toCardReceipt, toCreatedCard, toUploadReceipt,
  type BrandChange, type BrandDraft, type BrandField, type CardReceipt, type Catalog, type CatalogCard,
  type CreatedCardReceipt, type MutationOutcome, type SavedCard,
} from './model';
import s from './page.module.css';

type Phase = 'idle' | 'checking' | 'saving';

export interface BrandEditorProps {
  card: CatalogCard | null;
  cards: ReadonlyArray<CatalogCard>;
  reload: () => Promise<Catalog | null>;
  onCreated: (saved: SavedCard) => void;
  onUpdated: (saved: SavedCard | null) => void;
  onStale: () => void;
  onClose: () => void;
}

const FIELD_LABEL: Readonly<Record<BrandField, string>> = {
  name: 'Name',
  logo_url: 'Logo',
  is_active: 'Status',
};

const CHECK_FAILED = 'The latest values could not be checked, so nothing was saved. Try again.';
const LOGO_HELP = `PNG, JPG or WebP, up to ${LOGO_MAX_MB} MB.`;

function changeValue(change: BrandChange, name: string, side: 'before' | 'after') {
  const value = change[side];
  if (change.field === 'is_active') return statusText(value === true);
  if (change.field === 'logo_url') return <LogoValue src={typeof value === 'string' ? value : null} name={name} />;
  return typeof value === 'string' && value ? value : '—';
}

function changeDetails(pending: ReadonlyArray<BrandChange>, name: string): ConfirmDetail[] {
  return pending.map((change) => ({
    label: FIELD_LABEL[change.field],
    value: <ValueDiff before={changeValue(change, name, 'before')} after={changeValue(change, name, 'after')} />,
  }));
}

function activeNote(active: boolean, editing: boolean): string {
  if (!active) return 'Hidden from the Sell tab and the rate calculator.';
  return editing
    ? 'Users can see this brand in the Sell tab and the rate calculator.'
    : 'Users see it in the Sell tab once it is added, but cannot sell it until it has an available country.';
}

export function BrandEditor({ card, cards, reload, onCreated, onUpdated, onStale, onClose }: BrandEditorProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const formId = useId();
  const logoButtonId = useId();
  const activeNoteId = useId();
  const editing = card !== null;
  const [base] = useState<BrandDraft>(() => (card ? brandDraftOf(card) : { ...NEW_BRAND }));
  const [draft, setDraft] = useState<BrandDraft>(base);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const uploadingRef = useRef(false);
  const closingRef = useRef(false);

  const dirty = brandChanges(base, draft).length > 0;
  const busy = phase !== 'idle';
  const label = card ? brandLabel(card) : 'this brand';

  useLeaveWarning(dirty || uploading);

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
  }, []);

  const update = (patch: Partial<BrandDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const refused = (status: number, message: string) => {
    toast.show(message, 'error');
    if (status === 403) router.refresh();
  };

  const requestClose = async () => {
    if (busyRef.current || closingRef.current) return;
    if (!dirty && !uploadingRef.current) {
      onClose();
      return;
    }
    closingRef.current = true;
    try {
      const decision = await confirm({
        title: editing ? 'Discard your changes?' : 'Discard this new brand?',
        message: editing
          ? `Your changes to ${label} have not been saved. Closing discards them, and nothing changes for users.`
          : 'This brand has not been added yet. Closing discards what you entered.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
      });
      if (decision) onClose();
    } finally {
      closingRef.current = false;
    }
  };

  const checkName = (pool: ReadonlyArray<CatalogCard>): boolean => {
    const name = draft.name.trim();
    if (editing && name === base.name.trim()) {
      setNameError(null);
      return true;
    }
    const problem = cardNameProblem(name);
    const clash = problem ? null : duplicateBrand(pool, name, card?.id ?? null);
    const message = problem ?? (clash ? `A brand called “${brandLabel(clash)}” already exists.` : null);
    setNameError(message);
    if (message) nameRef.current?.focus();
    return message === null;
  };

  const pickLogo = () => {
    if (uploadingRef.current || busyRef.current) return;
    fileRef.current?.click();
  };

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || uploadingRef.current) return;
    const problem = logoFileProblem(file.name, file.size);
    if (problem) {
      setUploadError(problem);
      toast.show(`The logo was not uploaded. ${problem}`, 'error');
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await apiRequest('/api/cards/upload', { method: 'POST', body: form, select: toUploadReceipt });
      if (result.ok) {
        update({ logo_url: result.data.url });
        toast.show(editing ? 'Logo uploaded. Save to use it for this brand.' : 'Logo uploaded.', 'success');
        if (result.data.warning) toast.show(result.data.warning, 'warning');
        return;
      }
      if (result.error.status === 401) return;
      setUploadError(result.error.message);
      toast.show(`The logo was not uploaded. ${result.error.message}`, 'error');
      if (result.error.status === 403) router.refresh();
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const reportCreate = (outcome: MutationOutcome<CreatedCardReceipt>, name: string, sortOrder: number) => {
    switch (outcome.kind) {
      case 'done': {
        const saved: SavedCard = outcome.data.card ?? {
          id: outcome.data.id,
          name,
          logo_url: draft.logo_url,
          is_active: draft.is_active,
          sort_order: sortOrder,
        };
        toast.show(
          draft.is_active
            ? `${name} added and active. Add a country so users can sell it.`
            : `${name} added and hidden from users. Add its countries, then activate it.`,
          'success',
        );
        if (outcome.data.warning) toast.show(outcome.data.warning, 'warning');
        onCreated(saved);
        return;
      }
      case 'expired':
        return;
      case 'refused':
        if (outcome.status === 409) setNameError(outcome.message);
        else setFormError(outcome.message);
        refused(outcome.status, `${name} was not added. ${outcome.message}`);
        return;
      case 'unknown':
        setFormError(outcome.message);
        toast.show(outcome.message, 'error');
        onStale();
        return;
      case 'retry':
        setFormError(outcome.message);
        toast.show(`${name} was not added. ${outcome.message}`, 'error');
    }
  };

  const create = async () => {
    const name = draft.name.trim();
    const sortOrder = nextSortOrder(cards);
    const result = await apiRequest('/api/cards', {
      method: 'POST',
      body: { type: 'card', name, is_active: draft.is_active, logo_url: draft.logo_url, sort_order: sortOrder },
      select: toCreatedCard,
    });
    reportCreate(classifyMutation(result), name, sortOrder);
  };

  const reportUpdate = (outcome: MutationOutcome<CardReceipt>, previousName: string, nextName: string) => {
    switch (outcome.kind) {
      case 'done':
        toast.show(previousName !== nextName ? `${previousName} is now called ${nextName}.` : `${nextName} saved.`, 'success');
        if (outcome.data.warning) toast.show(outcome.data.warning, 'warning');
        onUpdated(outcome.data.card);
        return;
      case 'expired':
        return;
      case 'refused':
        refused(outcome.status, `Nothing was saved. ${outcome.message}`);
        if (outcome.status === 409) setNameError(outcome.message);
        onStale();
        if (outcome.status === 404) onClose();
        return;
      case 'unknown':
        setFormError(outcome.message);
        toast.show(outcome.message, 'error');
        onStale();
        return;
      case 'retry':
        setFormError(outcome.message);
        toast.show(`Nothing was saved. ${outcome.message}`, 'error');
    }
  };

  const send = (id: string, pending: ReadonlyArray<BrandChange>) => apiRequest('/api/cards', {
    method: 'PATCH',
    body: brandPatch(id, pending),
    select: toCardReceipt,
  });

  const save = async (current: CatalogCard) => {
    const fresh = await reload();
    if (!fresh) {
      setFormError(CHECK_FAILED);
      toast.show(CHECK_FAILED, 'error');
      return;
    }
    const live = fresh.cards.find((entry) => entry.id === current.id);
    if (!live) {
      toast.show(`${label} is no longer in the catalog, so nothing was saved.`, 'error');
      onClose();
      return;
    }
    if (!checkName(fresh.cards)) return;
    const rebase = rebaseBrand(base, draft, brandDraftOf(live));
    const previousName = brandLabel(live);
    const nextName = brandLabel(rebase.draft);
    if (rebase.pending.length === 0) {
      toast.show(`${previousName} already has these values, so nothing needed to change.`);
      onUpdated(null);
      return;
    }
    const reviewed = rebase.conflicts.length > 0 || rebase.pending.some((change) => change.field !== 'logo_url');
    if (!reviewed) {
      setPhase('saving');
      reportUpdate(classifyMutation(await send(live.id, rebase.pending)), previousName, nextName);
      return;
    }
    const deactivating = rebase.pending.some((change) => change.field === 'is_active' && change.after === false);
    const conflictNote = rebase.conflicts.length > 0
      ? ` Another admin changed the ${rebase.conflicts.map((field) => FIELD_LABEL[field].toLowerCase()).join(' and ')} while you were editing, so check the values below.`
      : '';
    let sent = false;
    const decision = await confirm<MutationOutcome<CardReceipt>>({
      tone: deactivating ? 'danger' : 'default',
      title: deactivating ? `Save and deactivate ${previousName}?` : `Save changes to ${previousName}?`,
      message: `These changes go live for users as soon as you confirm.${conflictNote}`,
      details: changeDetails(rebase.pending, previousName),
      consequences: brandChangeConsequences(rebase.pending, live, rebase.draft),
      confirmLabel: deactivating ? 'Save and deactivate' : 'Save changes',
      pendingLabel: 'Saving…',
      action: async () => {
        sent = true;
        const outcome = classifyMutation(await send(live.id, rebase.pending));
        if (outcome.kind === 'retry') throw new Error(outcome.message);
        return outcome;
      },
      returnFocusTo: () => nameRef.current,
    });
    if (decision?.value) {
      reportUpdate(decision.value, previousName, nextName);
      return;
    }
    if (sent) onStale();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || uploadingRef.current) return;
    if (editing && !dirty) return;
    if (!checkName(cards)) return;
    busyRef.current = true;
    setFormError(null);
    setPhase(editing ? 'checking' : 'saving');
    try {
      if (card) await save(card);
      else await create();
    } finally {
      busyRef.current = false;
      setPhase('idle');
    }
  };

  const logoName = draft.name.trim() || (card ? card.name : '');
  const logoAction = uploading ? 'Uploading logo' : draft.logo_url ? 'Replace logo' : 'Upload logo';

  return (
    <Modal
      open
      onClose={() => void requestClose()}
      static={busy}
      title={editing ? `Edit ${label}` : 'Add a card brand'}
      subtitle={
        editing
          ? 'Name and status changes are reviewed before they go live.'
          : 'New brands go to the end of the Sell-tab order.'
      }
      footer={
        <>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void requestClose()}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            size="sm"
            loading={busy}
            disabled={uploading || (editing && !dirty)}
          >
            {editing ? 'Save changes' : 'Add brand'}
          </Button>
        </>
      }
    >
      <form id={formId} className={s.editorForm} onSubmit={(event) => void submit(event)} noValidate>
        {formError ? <Notice tone="danger" compact flush>{formError}</Notice> : null}

        <FieldShell
          label="Brand name"
          required
          error={nameError}
          help={nameError ? undefined : 'Shown to users exactly as written. Coupons and giftbox rules refer to brands by this name.'}
        >
          <Input
            ref={nameRef}
            value={draft.name}
            maxLength={CARD_NAME_MAX}
            autoComplete="off"
            spellCheck={false}
            readOnly={busy}
            onChange={(event) => {
              update({ name: event.target.value });
              if (nameError) setNameError(null);
            }}
          />
        </FieldShell>

        <FieldShell label="Logo" htmlFor={logoButtonId} error={uploadError} help={uploadError ? undefined : LOGO_HELP}>
          <div className={s.logoField}>
            <BrandMark src={draft.logo_url} name={logoName} size="lg" />
            <div className={s.logoButtons}>
              <Button
                id={logoButtonId}
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<ImageUp size={14} aria-hidden />}
                loading={uploading}
                disabled={busy}
                aria-label={logoAction}
                aria-describedby={`${logoButtonId}-msg`}
                onClick={pickLogo}
              >
                {logoAction}
              </Button>
              {draft.logo_url ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 size={14} aria-hidden />}
                  disabled={busy || uploading}
                  onClick={() => update({ logo_url: null })}
                >
                  Remove logo
                </Button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              className={s.fileInput}
              type="file"
              accept={LOGO_ACCEPT}
              tabIndex={-1}
              aria-hidden
              onChange={(event) => void uploadLogo(event)}
            />
          </div>
        </FieldShell>

        <div className={s.toggleField}>
          <Toggle
            checked={draft.is_active}
            disabled={busy}
            aria-describedby={activeNoteId}
            onChange={(next) => update({ is_active: next })}
            label="Active"
          />
          <p id={activeNoteId} className={s.fieldNote}>{activeNote(draft.is_active, editing)}</p>
        </div>
      </form>
    </Modal>
  );
}
