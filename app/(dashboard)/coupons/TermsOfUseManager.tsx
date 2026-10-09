'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ListChecks, Plus, Trash2, Undo2 } from 'lucide-react';
import {
  Badge, Button, EmptyState, FieldShell, Input, Modal, Notice, useConfirm, usePermissions, useToast,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { TERMS_CONFIG_KEY, TERM_OPTION_MAX, plural, termProblem } from './couponRules';
import {
  applyTermsChange, classifyMutation, diffTerms, isEmptyTermsChange, readStoredTerms, sameTerms, termsSaveBody,
  termsUsage, toMutationResult,
  type CouponRow, type CouponsSnapshot, type MutationOutcome,
} from './model';
import { termsConfirm, termsDiscardConfirm } from './confirmOptions';
import { changeSummary } from './CouponParts';
import s from './page.module.css';

export interface TermsOfUseManagerProps {
  terms: readonly string[] | null;
  coupons: readonly CouponRow[];
  loaded: boolean;
  readFresh: () => Promise<CouponsSnapshot | null>;
  onSaved: () => void;
}

interface TermsDialogProps {
  terms: readonly string[] | null;
  coupons: readonly CouponRow[];
  editable: boolean;
  readFresh: () => Promise<CouponsSnapshot | null>;
  onSaved: () => void;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
}

type RowState = 'kept' | 'removed' | 'added';

function termKey(term: string): string {
  return term.trim().toLowerCase();
}

export function TermsOfUseManager({ terms, coupons, loaded, readFresh, onSaved }: TermsOfUseManagerProps) {
  const { isSuperAdmin } = usePermissions();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        size="sm"
        leftIcon={<ListChecks size={14} aria-hidden />}
        aria-haspopup="dialog"
        disabled={!loaded}
        onClick={() => setOpen(true)}
      >
        Terms of use
      </Button>
      {open ? (
        <TermsDialog
          terms={terms}
          coupons={coupons}
          editable={isSuperAdmin}
          readFresh={readFresh}
          onSaved={onSaved}
          onClose={() => setOpen(false)}
          returnFocusTo={() => triggerRef.current}
        />
      ) : null}
    </>
  );
}

function TermsDialog({ terms, coupons, editable, readFresh, onSaved, onClose, returnFocusTo }: TermsDialogProps) {
  const confirm = useConfirm();
  const { show: notify } = useToast();
  const router = useRouter();
  const [base, setBase] = useState<string[]>(() => [...(terms ?? [])]);
  const [draft, setDraft] = useState<string[]>(() => [...(terms ?? [])]);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const unavailable = terms === null;
  const canEdit = editable && !unavailable;
  const change = useMemo(() => diffTerms(base, draft), [base, draft]);
  const dirty = canEdit && !isEmptyTermsChange(change);
  const kept = useMemo(() => new Set(draft.map(termKey)), [draft]);
  const original = useMemo(() => new Set(base.map(termKey)), [base]);
  const rows: { term: string; state: RowState }[] = [
    ...base.map((term) => ({ term, state: (kept.has(termKey(term)) ? 'kept' : 'removed') as RowState })),
    ...draft.filter((term) => !original.has(termKey(term))).map((term) => ({ term, state: 'added' as RowState })),
  ];

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

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;
    const issue = termProblem(text, draft);
    if (issue) {
      setProblem(issue);
      inputRef.current?.focus();
      return;
    }
    setDraft((current) => [...current, text.trim()]);
    setText('');
    setProblem(null);
    inputRef.current?.focus();
  };

  const remove = (term: string, state: RowState) => {
    setDraft((current) => current.filter((item) => item !== term));
    if (state === 'added') inputRef.current?.focus();
  };

  const restore = (term: string) => {
    setDraft((current) => {
      const present = new Set(current.map(termKey));
      present.add(termKey(term));
      return [
        ...base.filter((item) => present.has(termKey(item))),
        ...current.filter((item) => !original.has(termKey(item))),
      ];
    });
  };

  const requestClose = async () => {
    if (busyRef.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    const decision = await confirm(termsDiscardConfirm());
    if (decision && aliveRef.current) onClose();
  };

  const save = async () => {
    if (busyRef.current || !dirty) return;
    busyRef.current = true;
    setSaving(true);
    let sent = false;
    let settled = false;
    try {
      const fresh = await readFresh();
      if (!fresh || !aliveRef.current) return;
      const stored = await apiRequest('/api/app-config', {
        query: { keys: TERMS_CONFIG_KEY },
        select: readStoredTerms,
      });
      if (!aliveRef.current) return;
      if (!stored.ok) {
        if (stored.error.status !== 401) {
          notify(`The current list could not be read, so nothing was saved. ${stored.error.message}`, 'error');
        }
        if (stored.error.status === 403) router.refresh();
        return;
      }
      const latest = stored.data.terms;
      const next = applyTermsChange(latest, change);
      const effective = diffTerms(latest, next);
      if (isEmptyTermsChange(effective)) {
        notify('Nothing to save. The list already matches your changes.');
        setBase([...latest]);
        setDraft([...latest]);
        return;
      }
      const decision = await confirm<MutationOutcome>({
        ...termsConfirm(effective, next.length, !sameTerms(latest, base), (term) => termsUsage(fresh.coupons, term)),
        returnFocusTo: () => listRef.current ?? inputRef.current,
        action: async () => {
          sent = true;
          const attempt = classifyMutation(await apiRequest('/api/app-config', {
            method: 'PATCH',
            body: termsSaveBody(next, stored.data.raw),
            select: toMutationResult,
          }));
          if (attempt.kind === 'retry') throw new Error(attempt.message);
          settled = true;
          return attempt;
        },
      });
      const outcome = decision?.value;
      if (!outcome) return;
      switch (outcome.kind) {
        case 'done':
          notify('Terms of use list saved.', 'success');
          if (outcome.result.warning) notify(outcome.result.warning, 'warning');
          onSaved();
          onClose();
          return;
        case 'unknown':
          notify(outcome.message, 'error');
          onSaved();
          return;
        case 'stale':
          notify(outcome.message, 'warning');
          onSaved();
          return;
        case 'refused':
          notify(outcome.message, 'error');
          router.refresh();
          return;
        case 'expired':
          return;
      }
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setSaving(false);
      if (sent && !settled) onSaved();
    }
  };

  return (
    <Modal
      open
      onClose={() => void requestClose()}
      static={saving}
      size="md"
      title="Terms of use"
      subtitle="The options offered when you set a coupon’s terms of use. Users see the chosen term on the coupon in the app."
      returnFocusTo={returnFocusTo}
      footer={
        <div className={s.modalFooter}>
          <p className={s.footerStatus} role="status">{canEdit ? changeSummary(change) : ''}</p>
          <div className={s.footerActions}>
            {canEdit ? (
              <>
                <Button type="button" variant="ghost" disabled={saving} onClick={() => void requestClose()}>
                  Cancel
                </Button>
                <Button type="button" variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
                  Save list
                </Button>
              </>
            ) : (
              <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
            )}
          </div>
        </div>
      }
    >
      <div className={s.termsBody}>
        {unavailable ? (
          <Notice tone="danger" compact flush>
            The list could not be loaded, so it cannot be shown or changed. Close this and refresh the page.
          </Notice>
        ) : null}
        {!editable && !unavailable ? (
          <Notice tone="neutral" compact flush>
            Only super administrators can change this list. Ask one to add or remove a term.
          </Notice>
        ) : null}
        {canEdit ? (
          <form noValidate onSubmit={add}>
            <FieldShell
              label="New term"
              error={problem ?? undefined}
              help={`Up to ${TERM_OPTION_MAX} characters, for example “First-time users only”.`}
            >
              <div className={s.termAdd}>
                <Input
                  ref={inputRef}
                  className={s.termInput}
                  value={text}
                  maxLength={TERM_OPTION_MAX}
                  autoComplete="off"
                  readOnly={saving}
                  onChange={(event) => {
                    setText(event.target.value);
                    if (problem) setProblem(null);
                  }}
                />
                <Button type="submit" variant="secondary" leftIcon={<Plus size={14} aria-hidden />} disabled={saving}>
                  Add
                </Button>
              </div>
            </FieldShell>
          </form>
        ) : null}
        {unavailable ? null : rows.length === 0 ? (
          <EmptyState
            variant="plain"
            title="No terms yet"
            hint={canEdit ? 'Add the first term above.' : 'A super administrator can add terms.'}
          />
        ) : (
          <ul ref={listRef} className={s.termList} aria-label="Terms of use" tabIndex={-1}>
            {rows.map(({ term, state }) => {
              const used = termsUsage(coupons, term);
              return (
                <li
                  key={`${state === 'added' ? 'new' : 'base'}:${term}`}
                  className={state === 'removed' ? `${s.termItem} ${s.termRemoved}` : s.termItem}
                >
                  <div className={s.termMain}>
                    <span className={s.termText}>{term}</span>
                    <span className={s.termMeta}>
                      {state === 'added' ? <Badge tone="info">New</Badge> : null}
                      {state === 'removed' ? <Badge tone="warning">Removing</Badge> : null}
                      <span>{used === 0 ? 'Not used by any coupon' : `Used by ${plural(used, 'coupon', 'coupons')}`}</span>
                    </span>
                  </div>
                  {canEdit ? (
                    state === 'removed' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        leftIcon={<Undo2 size={14} aria-hidden />}
                        aria-label={`Undo removing “${term}”`}
                        disabled={saving}
                        onClick={() => restore(term)}
                      >
                        Undo
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 size={14} aria-hidden />}
                        aria-label={`Remove “${term}”`}
                        disabled={saving}
                        onClick={() => remove(term, state)}
                      >
                        Remove
                      </Button>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
