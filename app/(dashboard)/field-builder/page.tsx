'use client';

import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, RotateCw } from 'lucide-react';
import {
  AccessDenied, Button, Combobox, EmptyState, ErrorState, FieldShell, Notice, PageHeader, Skeleton, useCan,
  useConfirm, useResource, useToast, useUrlState, uuidParam,
  type ComboboxOption, type ConfirmOptions,
} from '../../_ui';
import { apiRequest, type ApiBody, type ApiResult } from '../../lib/apiClient';
import { moveId, type MoveDirection } from './rules';
import {
  addCountryConfirm, addedCountryText, brandDescription, classifyMutation, countryLabel, createdTemplateText,
  deleteFieldConfirm, deleteTemplateConfirm, deletedFieldText, deletedTemplateText, movedText, renamedTemplateText,
  savedFieldText, switchedCountryText, toBrandList, toBuilderData, toggleCountryConfirm, withFieldOrder,
  withTemplateOrder,
  type BrandCountry, type BrandSummary, type BuilderData, type Install, type MutationAttempt, type MutationOutcome,
  type Template, type TemplateField,
} from './model';
import { BuilderSkeleton, TemplateCard, focusKey, type FocusKind } from './BuilderParts';
import { FieldEditor, TemplateEditor, type EditorResult, type FieldDraft } from './Editors';
import s from './page.module.css';

const ENDPOINT = '/api/field-builder';
const CARD_URL = uuidParam('card');
const TITLE = 'Field builder';
const SUBTITLE =
  'Card types and the details users fill in when they sell a card. A card type goes live in a country when you add it there.';
const NOT_SENT = 'The request could not be started, so nothing was changed. Try again.';
const UNKNOWN_OUTCOME =
  'No response came back, so this may or may not have been saved. The list has been reloaded; check it before trying again.';
const BAD_LINK = 'That link does not point to a card, so nothing was opened.';

type TemplateEditorState =
  | { kind: 'template'; mode: 'create' }
  | { kind: 'template'; mode: 'rename'; template: Template };

type FieldEditorState =
  | { kind: 'field'; mode: 'create'; template: Template }
  | { kind: 'field'; mode: 'edit'; template: Template; field: TemplateField };

type EditorState = TemplateEditorState | FieldEditorState;

interface ConfirmedRequest {
  options: ConfirmOptions;
  pendingLabel: string;
  request: () => Promise<ApiResult<ApiBody>>;
  success: (body: ApiBody) => string;
  after?: (body: ApiBody) => void;
  returnFocusTo?: () => HTMLElement | null;
  retryInDialog?: boolean;
}

function focusable(key: string | null): HTMLElement | null {
  if (!key) return null;
  const element = document.querySelector<HTMLElement>(`[data-focus="${key}"]`);
  if (!element || !element.isConnected || element.matches(':disabled')) return null;
  return element.getClientRects().length > 0 ? element : null;
}

function firstFocusable(keys: ReadonlyArray<string | null>): HTMLElement | null {
  for (const key of keys) {
    const element = focusable(key);
    if (element) return element;
  }
  return null;
}

function opposite(direction: MoveDirection): MoveDirection {
  return direction === 'up' ? 'down' : 'up';
}

function moveFocusKeys(kind: FocusKind, id: string, direction: MoveDirection, fallback: string): string[] {
  return [focusKey(kind, id, direction), focusKey(kind, id, opposite(direction)), fallback];
}

export default function FieldBuilderPage() {
  return (
    <Suspense fallback={<FieldBuilderFallback />}>
      <FieldBuilder />
    </Suspense>
  );
}

function FieldBuilderFallback() {
  return (
    <div className={s.page}>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      <div className={s.picker} aria-hidden>
        <div className={s.pickerSkeleton}>
          <Skeleton width={40} height={11} />
          <Skeleton height={34} />
        </div>
      </div>
    </div>
  );
}

function FieldBuilder() {
  const { show: notify } = useToast();
  const searchParams = useSearchParams();
  const [cardId, setCardId] = useUrlState(CARD_URL);
  const warnedRef = useRef<string | null>(null);
  const observed = searchParams.toString();

  const brands = useResource<BrandSummary[]>('field-builder:cards', (signal) => (
    apiRequest(ENDPOINT, { signal, select: toBrandList })
  ));
  const { refresh: refreshBrands } = brands;
  const brandList = brands.data;

  useEffect(() => {
    const params = new URLSearchParams(observed);
    const raw = params.get('card');
    if (raw !== null && raw.trim() !== '' && CARD_URL.parse(params) === null && warnedRef.current !== raw) {
      warnedRef.current = raw;
      notify(BAD_LINK, 'warning');
    }
    setCardId((value) => value);
  }, [observed, notify, setCardId]);

  const brand = useMemo(() => brandList?.find((item) => item.id === cardId) ?? null, [brandList, cardId]);
  const options = useMemo<ComboboxOption[]>(
    () => (brandList ?? []).map((item) => ({ value: item.id, label: item.name, description: brandDescription(item) })),
    [brandList],
  );
  const refreshCounts = useCallback(() => {
    void refreshBrands({ background: true });
  }, [refreshBrands]);

  if (brands.error?.status === 403 && !brandList) return <AccessDenied required={['card_types.read']} />;

  return (
    <div className={s.page}>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      <div className={s.picker}>
        <FieldShell label="Card" help="Choose the gift card brand whose card types you want to manage.">
          <Combobox
            options={options}
            value={cardId}
            onChange={(next) => setCardId(next)}
            placeholder={brands.isInitialLoading ? 'Loading cards…' : 'Search cards'}
            emptyText="No cards match"
            disabled={!brandList}
          />
        </FieldShell>
      </div>
      {brands.error ? (
        <Notice
          className={s.pageNotice}
          tone={brandList ? 'warning' : 'danger'}
          compact
          announce="polite"
          actions={<Button variant="ghost" size="sm" onClick={() => void refreshBrands()}>Try again</Button>}
        >
          {brandList ? 'The card list could not be refreshed.' : 'The card list could not be loaded.'} {brands.error.message}
        </Notice>
      ) : null}
      {cardId ? (
        <CardBuilder
          key={cardId}
          cardId={cardId}
          brand={brand}
          onMissing={() => setCardId(null)}
          onCountsChanged={refreshCounts}
        />
      ) : brandList && brandList.length === 0 ? (
        <EmptyState
          title="No cards yet"
          hint="Card types belong to a card. Add a card in Cards first, then come back to give it card types."
        />
      ) : (
        <EmptyState
          title="Choose a card"
          hint="Pick a card above to see its card types, the fields users fill in, and the countries each one is live in."
        />
      )}
    </div>
  );
}

interface CardBuilderProps {
  cardId: string;
  brand: BrandSummary | null;
  onMissing: () => void;
  onCountsChanged: () => void;
}

function CardBuilder({ cardId, brand, onMissing, onCountsChanged }: CardBuilderProps) {
  const { show: notify } = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const canWrite = useCan('card_types.write');
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const busyRef = useRef(false);

  const builder = useResource<BuilderData>(
    `field-builder:${cardId}`,
    (signal) => apiRequest(ENDPOINT, { query: { card_id: cardId }, signal, select: toBuilderData }),
    { keepPreviousData: false },
  );
  const { refresh, mutate } = builder;
  const data = builder.data;

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [seeded, setSeeded] = useState(false);
  if (data && !seeded) {
    setSeeded(true);
    if (data.templates.length === 1) setExpanded(new Set([data.templates[0].id]));
  }
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [moving, setMoving] = useState(false);
  const [focusTarget, setFocusTarget] = useState<ReadonlyArray<string | null> | null>(null);

  const cardName = data?.card?.name ?? brand?.name ?? 'this card';
  const countries = useMemo(() => data?.countries ?? [], [data]);
  const templates = useMemo(() => data?.templates ?? [], [data]);

  useEffect(() => {
    if (!focusTarget || moving) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || (active instanceof HTMLElement && active.matches(':disabled'));
    if (lost) (firstFocusable(focusTarget) ?? headingRef.current)?.focus({ preventScroll: true });
    setFocusTarget(null);
  }, [focusTarget, moving]);

  const setOpen = useCallback((id: string, open: boolean) => {
    setExpanded((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const send = useCallback(
    (method: 'POST' | 'PATCH' | 'DELETE', body: ApiBody) => apiRequest(ENDPOINT, { method, body }),
    [],
  );

  const announceDone = useCallback((message: string, warning: string | null) => {
    notify(warning ? `${message} ${warning}` : message, warning ? 'warning' : 'success');
  }, [notify]);

  const announceRefusal = useCallback((status: number | null, message: string) => {
    if (status === 401) return;
    notify(message, 'error');
    if (status === 403) router.refresh();
  }, [notify, router]);

  const runConfirmed = useCallback(async (spec: ConfirmedRequest) => {
    if (busyRef.current) return;
    busyRef.current = true;
    let sent = false;
    let settled = false;
    try {
      const decision = await confirm<MutationOutcome>({
        ...spec.options,
        pendingLabel: spec.pendingLabel,
        returnFocusTo: spec.returnFocusTo,
        action: async () => {
          sent = true;
          const attempt = classifyMutation(await spec.request());
          if (attempt.kind === 'retry' && spec.retryInDialog !== false) throw new Error(attempt.message);
          settled = true;
          await refresh({ background: true });
          return attempt.kind === 'retry'
            ? { kind: 'refused', status: null, message: attempt.message, field: attempt.field }
            : attempt;
        },
      });
      const outcome = decision?.value;
      if (!outcome) return;
      if (outcome.kind === 'done') {
        spec.after?.(outcome.body);
        announceDone(spec.success(outcome.body), outcome.warning);
      } else if (outcome.kind === 'unknown') {
        notify(UNKNOWN_OUTCOME, 'error');
      } else {
        announceRefusal(outcome.status, outcome.message);
      }
    } catch {
      notify(sent ? UNKNOWN_OUTCOME : NOT_SENT, 'error');
    } finally {
      busyRef.current = false;
      if (sent && !settled) void refresh({ background: true });
    }
  }, [announceDone, announceRefusal, confirm, notify, refresh]);

  const settleMove = useCallback((attempt: MutationAttempt, previous: BuilderData, success: string) => {
    if (attempt.kind === 'done') {
      announceDone(success, attempt.warning);
      return;
    }
    if (attempt.kind === 'unknown') {
      notify(UNKNOWN_OUTCOME, 'error');
      return;
    }
    mutate(previous);
    if (attempt.kind === 'refused') announceRefusal(attempt.status, attempt.message);
    else notify(attempt.message, 'error');
  }, [announceDone, announceRefusal, mutate, notify]);

  const runMove = useCallback(async (
    previous: BuilderData,
    optimistic: BuilderData,
    body: ApiBody,
    success: string,
    focusKeys: string[],
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setMoving(true);
    mutate(optimistic);
    try {
      settleMove(classifyMutation(await send('PATCH', body)), previous, success);
    } finally {
      busyRef.current = false;
      setMoving(false);
      setFocusTarget(focusKeys);
      void refresh({ background: true });
    }
  }, [mutate, refresh, send, settleMove]);

  const moveTemplate = (template: Template, direction: MoveDirection) => {
    if (!data) return;
    const order = moveId(data.templates.map((item) => item.id), template.id, direction);
    if (!order) return;
    void runMove(
      data,
      withTemplateOrder(data, order),
      { type: 'reorder_templates', card_id: cardId, ids: order },
      movedText(template.name, order.indexOf(template.id) + 1, order.length),
      moveFocusKeys('template', template.id, direction, focusKey('template', template.id)),
    );
  };

  const moveField = (template: Template, field: TemplateField, direction: MoveDirection) => {
    if (!data) return;
    const order = moveId(template.fields.map((item) => item.id), field.id, direction);
    if (!order) return;
    void runMove(
      data,
      withFieldOrder(data, template.id, order),
      { type: 'reorder_fields', template_id: template.id, ids: order },
      movedText(field.label || 'the field', order.indexOf(field.id) + 1, order.length),
      moveFocusKeys('field', field.id, direction, focusKey('field', field.id, 'edit')),
    );
  };

  const deleteTemplate = (template: Template) => {
    const index = templates.findIndex((item) => item.id === template.id);
    const neighbours = [templates[index + 1], templates[index - 1]]
      .filter((item): item is Template => Boolean(item))
      .map((item) => focusKey('template', item.id));
    void runConfirmed({
      options: deleteTemplateConfirm(template, cardName, countries),
      pendingLabel: `Deleting ${template.name}…`,
      request: () => send('DELETE', { type: 'template', id: template.id }),
      success: () => deletedTemplateText(template),
      after: () => onCountsChanged(),
      returnFocusTo: () => firstFocusable(neighbours) ?? headingRef.current,
    });
  };

  const deleteField = (template: Template, field: TemplateField) => {
    const index = template.fields.findIndex((item) => item.id === field.id);
    const neighbours = [template.fields[index + 1], template.fields[index - 1]]
      .filter((item): item is TemplateField => Boolean(item))
      .map((item) => focusKey('field', item.id, 'edit'));
    const label = field.label || 'This field';
    void runConfirmed({
      options: deleteFieldConfirm(template, { ...field, label }, countries),
      pendingLabel: `Deleting ${label}…`,
      request: () => send('DELETE', { type: 'field', id: field.id }),
      success: () => deletedFieldText(label, template.name),
      returnFocusTo: () => firstFocusable([
        ...neighbours,
        focusKey('template', template.id, 'add-field'),
        focusKey('template', template.id),
      ]),
    });
  };

  const switchCountry = (template: Template, install: Install, next: boolean) => {
    const place = countryLabel(install, countries);
    void runConfirmed({
      options: toggleCountryConfirm(template, install, countries, next),
      pendingLabel: next ? `Switching ${template.name} on in ${place}…` : `Switching ${template.name} off in ${place}…`,
      request: () => send('PATCH', { type: 'country', card_type_id: install.id, is_active: next }),
      success: (body) => switchedCountryText(template.name, place, next, body),
      returnFocusTo: () => firstFocusable([focusKey('install', install.id), focusKey('template', template.id)]),
    });
  };

  const addCountry = (template: Template, country: BrandCountry) => {
    let addedId: string | null = null;
    void runConfirmed({
      options: addCountryConfirm(template, country),
      pendingLabel: `Adding ${template.name} to ${country.country_name}…`,
      request: async () => {
        const result = await send('POST', {
          type: 'add_country',
          template_id: template.id,
          country_code: country.country_code,
        });
        if (result.ok && typeof result.data.id === 'string') addedId = result.data.id;
        return result;
      },
      success: (body) => addedCountryText(template.name, country.country_name, body),
      retryInDialog: false,
      returnFocusTo: () => firstFocusable([
        addedId ? focusKey('install', addedId) : null,
        focusKey('template', template.id, 'add-country'),
        focusKey('template', template.id),
      ]),
    });
  };

  const settleEditor = async (
    attempt: MutationAttempt,
    success: (body: ApiBody) => string,
    after?: (body: ApiBody) => void,
  ): Promise<EditorResult> => {
    switch (attempt.kind) {
      case 'done':
        after?.(attempt.body);
        await refresh({ background: true });
        announceDone(success(attempt.body), attempt.warning);
        return { close: true };
      case 'unknown':
        notify(UNKNOWN_OUTCOME, 'error');
        void refresh({ background: true });
        return { close: true };
      case 'refused':
        if (attempt.status === 401) return { close: false };
        announceRefusal(attempt.status, attempt.message);
        if (attempt.status === 403 || attempt.status === 404) {
          void refresh({ background: true });
          return { close: true };
        }
        return { close: false, error: attempt.field ? attempt.message : null, field: attempt.field };
      case 'retry':
        notify(attempt.message, 'error');
        return { close: false, error: attempt.field ? attempt.message : null, field: attempt.field };
    }
  };

  const saveTemplate = async (state: TemplateEditorState, name: string): Promise<EditorResult> => {
    if (busyRef.current) return { close: false };
    busyRef.current = true;
    try {
      if (state.mode === 'create') {
        const attempt = classifyMutation(await send('POST', { type: 'template', card_id: cardId, name }));
        return await settleEditor(attempt, () => createdTemplateText(name, cardName), (body) => {
          if (typeof body.id === 'string') setOpen(body.id, true);
          onCountsChanged();
        });
      }
      const attempt = classifyMutation(await send('PATCH', { type: 'template', id: state.template.id, name }));
      return await settleEditor(attempt, (body) => (
        renamedTemplateText(name, typeof body.countries_renamed === 'number' ? body.countries_renamed : 0)
      ));
    } finally {
      busyRef.current = false;
    }
  };

  const saveField = async (state: FieldEditorState, draft: FieldDraft): Promise<EditorResult> => {
    if (busyRef.current) return { close: false };
    busyRef.current = true;
    try {
      if (state.mode === 'create') {
        const attempt = classifyMutation(await send('POST', { type: 'field', template_id: state.template.id, ...draft }));
        return await settleEditor(attempt, () => savedFieldText(true, draft.label, state.template));
      }
      const attempt = classifyMutation(await send('PATCH', { type: 'field', id: state.field.id, ...draft }));
      return await settleEditor(attempt, () => savedFieldText(false, draft.label, state.template));
    } finally {
      busyRef.current = false;
    }
  };

  const openEditor = (next: EditorState) => {
    if (busyRef.current) return;
    setEditor(next);
  };

  if (builder.isInitialLoading) return <BuilderSkeleton />;

  const failure = builder.error;
  if (!data) {
    if (failure?.status === 403) {
      return (
        <ErrorState
          compact
          title="You cannot view these card types"
          message="Your account does not hold the card_types.read permission. Ask a super administrator to grant it."
        />
      );
    }
    if (failure?.status === 404) {
      return (
        <EmptyState
          title="This card no longer exists"
          hint="It may have been deleted in Cards. Choose another card above."
          actions={<Button variant="secondary" size="sm" onClick={onMissing}>Clear the selection</Button>}
        />
      );
    }
    if (failure) {
      return (
        <ErrorState
          compact
          title="The card types could not be loaded"
          message={failure.message}
          requestId={failure.requestId}
          onRetry={() => void refresh()}
        />
      );
    }
    return <BuilderSkeleton />;
  }

  const editorTemplate = editor && editor.kind === 'field'
    ? templates.find((item) => item.id === editor.template.id) ?? editor.template
    : null;

  return (
    <section className={s.section} aria-labelledby={headingId}>
      {failure ? (
        <Notice
          className={s.pageNotice}
          tone="warning"
          compact
          announce="polite"
          actions={<Button variant="ghost" size="sm" onClick={() => void refresh()}>Try again</Button>}
        >
          The card types could not be refreshed. {failure.message} Showing what was loaded earlier.
        </Notice>
      ) : null}
      {data.card && !data.card.is_active ? (
        <Notice className={s.pageNotice} tone="neutral" compact>
          {cardName} is switched off in Cards, so users cannot sell any of its card types until it is switched back on.
        </Notice>
      ) : null}
      {!canWrite ? (
        <Notice className={s.pageNotice} tone="neutral" compact>
          You can view these card types but not change them. Changes need the card_types.write permission.
        </Notice>
      ) : null}
      <div className={s.sectionBar}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className={s.sectionTitle}>
          Card types <span className={s.sectionCount}>{templates.length}</span>
        </h2>
        <div className={s.sectionActions}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leftIcon={<RotateCw size={14} aria-hidden />}
            loading={builder.isRefreshing}
            disabled={moving}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
          {canWrite ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              leftIcon={<Plus size={14} aria-hidden />}
              disabled={moving}
              onClick={() => openEditor({ kind: 'template', mode: 'create' })}
            >
              Add card type
            </Button>
          ) : null}
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          title="No card types yet"
          hint={
            canWrite
              ? `Add a card type to ${cardName}, give it the fields users fill in, then add it to a country to make it live.`
              : `Nobody has added a card type to ${cardName} yet.`
          }
        />
      ) : (
        <ol className={s.typeList} aria-labelledby={headingId}>
          {templates.map((template, index) => (
            <li key={template.id}>
              <TemplateCard
                template={template}
                index={index}
                total={templates.length}
                countries={countries}
                expanded={expanded.has(template.id)}
                canWrite={canWrite}
                moving={moving}
                onToggleExpanded={() => setOpen(template.id, !expanded.has(template.id))}
                onMove={(direction) => moveTemplate(template, direction)}
                onRename={() => openEditor({ kind: 'template', mode: 'rename', template })}
                onDelete={() => deleteTemplate(template)}
                onSwitchCountry={(install, next) => switchCountry(template, install, next)}
                onAddCountry={(country) => addCountry(template, country)}
                onAddField={() => openEditor({ kind: 'field', mode: 'create', template })}
                onEditField={(field) => openEditor({ kind: 'field', mode: 'edit', template, field })}
                onDeleteField={(field) => deleteField(template, field)}
                onMoveField={(field, direction) => moveField(template, field, direction)}
              />
            </li>
          ))}
        </ol>
      )}

      {editor && editor.kind === 'template' ? (
        <TemplateEditor
          key={editor.mode === 'rename' ? `rename:${editor.template.id}` : 'create'}
          mode={editor.mode}
          cardName={cardName}
          template={editor.mode === 'rename' ? editor.template : null}
          siblings={templates}
          countries={countries}
          onSave={(name) => saveTemplate(editor, name)}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {editor && editor.kind === 'field' && editorTemplate ? (
        <FieldEditor
          key={editor.mode === 'edit' ? `edit:${editor.field.id}` : `create:${editor.template.id}`}
          mode={editor.mode}
          template={editorTemplate}
          field={editor.mode === 'edit' ? editor.field : null}
          countries={countries}
          onSave={(draft) => saveField(editor, draft)}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </section>
  );
}
