'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw, Send } from 'lucide-react';
import {
  AccessDenied, Button, Card, CardBody, CardFooter, CardHeader, FieldShell, Input, Notice, PageHeader, Pagination,
  RadioGroup, ResponsiveView, Select, SidePanel, Skeleton, Textarea, useCan, useConfirm, useResource, useToast,
} from '../../_ui';
import { apiRequest } from '../../lib/apiClient';
import { BUSINESS_TZ_LABEL, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import {
  AUDIENCE_META, BROADCAST_TYPES, DEFAULT_COUNT_AUDIENCE, HISTORY_PAGE_SIZE, MESSAGE_LIMIT, READ_PERMISSION,
  SEARCH_PERMISSIONS, SEND_TIMEOUT_MS, TITLE_LIMIT, TYPE_LABELS, cleanText, isBroadcastType, unknownVariables,
  type Audience,
} from './broadcastRules';
import {
  EMPTY_DRAFT, audienceHelp, availableAudiences, classifySend, draftDirty, draftErrors, firstError, insertVariable,
  outcomeToast, planContext, recipientsText, sameDraft, sendBody, toHistoryPage, toRecipientCount, toSendResult,
  type Draft, type DraftField, type HistoryPage, type Outcome, type RecipientCount, type SendOutcome, type SendPlan,
  type TextField,
} from './model';
import { discardOptions, leaveOptions, sendOptions } from './confirmOptions';
import {
  CharacterCount, HistoryDetail, HistoryList, HistoryTable, NotificationPreview, OutcomeNotice, UserPicker, VariablePicker,
} from './BroadcastParts';
import { useLeaveGuard } from './useLeaveGuard';
import s from './page.module.css';

const TITLE = 'Broadcast';
const SUBTITLE =
  'Send an in-app notification and a push to a group of users or to one user. A sent broadcast cannot be recalled.';
const HISTORY_HEADING = 'broadcast-history-heading';
const ONE_USER: RecipientCount = { total: 1, accounts: 1, anonymousDevices: 0 };

type Phase = 'idle' | 'checking' | 'confirming';

interface CaretRequest {
  field: TextField;
  position: number;
  seq: number;
}

interface FocusRequest {
  field: DraftField;
  seq: number;
}

export default function BroadcastPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const canRead = useCan(READ_PERMISSION);
  const canSend = useCan('communications.send');
  const canSendAll = useCan('communications.send_all');
  const canSearch = useCan(SEARCH_PERMISSIONS, 'all');
  const canOpenUsers = useCan('users.read');

  const access = useMemo(() => ({ send: canSend, sendAll: canSendAll, search: canSearch }), [canSend, canSendAll, canSearch]);
  const audiences = useMemo(() => availableAudiences(access), [access]);
  const canCompose = audiences.length > 0;

  const [historyPage, setHistoryPage] = useState(1);
  const history = useResource<HistoryPage>(
    canRead ? `broadcast-history:${historyPage}` : null,
    (signal) => apiRequest('/api/notifications/broadcast', {
      query: { page: historyPage, page_size: HISTORY_PAGE_SIZE },
      signal,
      select: toHistoryPage,
    }),
  );
  const refreshHistory = history.refresh;

  const [draft, setDraftState] = useState<Draft>(EMPTY_DRAFT);
  const [showErrors, setShowErrors] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [target, setTarget] = useState<TextField>('message');
  const [caret, setCaret] = useState<CaretRequest | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const draftRef = useRef<Draft>(EMPTY_DRAFT);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const titleRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const audienceRef = useRef<HTMLDivElement>(null);
  const userInputRef = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const historyRef = useRef<HTMLElement>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const setDraft = useCallback((change: (current: Draft) => Draft) => {
    const next = change(draftRef.current);
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const audience = draft.audience && audiences.includes(draft.audience) ? draft.audience : null;
  const countAudience = audience && audience !== 'specific' ? audience : null;
  const recipients = useResource<RecipientCount>(
    canRead && countAudience ? `recipients:${countAudience}` : null,
    (signal) => apiRequest('/api/notifications/recipient-count', {
      query: { audience: countAudience ?? DEFAULT_COUNT_AUDIENCE },
      signal,
      select: toRecipientCount,
    }),
    { keepPreviousData: false },
  );
  const mutateRecipients = recipients.mutate;

  const globals = history.data?.globals ?? null;
  const errors = draftErrors({ ...draft, audience });
  const shown = showErrors ? errors : {};
  const unknown = useMemo(() => unknownVariables(draft.title, draft.message), [draft.title, draft.message]);
  const dirty = canCompose && draftDirty(draft);
  const busy = phase !== 'idle';

  useLeaveGuard(dirty, () => confirm(leaveOptions()).then((decision) => decision !== null));

  useEffect(() => {
    if (!caret) return;
    const element = caret.field === 'title' ? titleRef.current : messageRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(caret.position, caret.position);
  }, [caret]);

  useEffect(() => {
    if (!focusRequest) return;
    const { field } = focusRequest;
    const element: HTMLElement | null = field === 'title'
      ? titleRef.current
      : field === 'message'
        ? messageRef.current
        : field === 'user'
          ? userInputRef.current
          : audienceRef.current?.querySelector<HTMLInputElement>('input[type="radio"]') ?? null;
    element?.focus();
  }, [focusRequest]);

  const historyData = history.data;
  useEffect(() => {
    if (!historyData || historyData.rows.length > 0 || historyPage === 1) return;
    setHistoryPage(Math.max(1, Math.ceil(historyData.total / historyData.pageSize)));
  }, [historyData, historyPage]);

  const insert = (token: string) => {
    if (busyRef.current) return;
    const field = target;
    const element = field === 'title' ? titleRef.current : messageRef.current;
    const current = field === 'title' ? draftRef.current.title : draftRef.current.message;
    const selection = element
      ? { start: element.selectionStart ?? current.length, end: element.selectionEnd ?? current.length }
      : null;
    const result = insertVariable(current, selection, token, field === 'title' ? TITLE_LIMIT : MESSAGE_LIMIT);
    if (!result) {
      toast.show(`There is no room left in the ${field} for {${token}}. Shorten it first.`, 'warning');
      return;
    }
    setDraft((previous) => (field === 'title' ? { ...previous, title: result.text } : { ...previous, message: result.text }));
    setCaret((previous) => ({ field, position: result.caret, seq: (previous?.seq ?? 0) + 1 }));
  };

  const clearDraft = async () => {
    if (busyRef.current || !draftDirty(draftRef.current)) return;
    const decision = await confirm(discardOptions());
    if (!decision || !aliveRef.current || busyRef.current) return;
    setDraft(() => EMPTY_DRAFT);
    setShowErrors(false);
  };

  const showLatestHistory = (background: boolean) => {
    if (historyPage === 1) {
      void refreshHistory(background ? { background: true } : undefined);
      return;
    }
    setOpenId(null);
    setHistoryPage(1);
  };

  const checkHistory = () => {
    showLatestHistory(false);
    historyRef.current?.scrollIntoView({ block: 'start' });
  };

  const review = async (allowDuplicate = false) => {
    if (busyRef.current || !canCompose) return;
    const current = draftRef.current;
    const chosen = current.audience && audiences.includes(current.audience) ? current.audience : null;
    const field = firstError(draftErrors({ ...current, audience: chosen }));
    if (field || !chosen) {
      setShowErrors(true);
      setFocusRequest((previous) => ({ field: field ?? 'audience', seq: (previous?.seq ?? 0) + 1 }));
      return;
    }
    busyRef.current = true;
    setPhase('checking');
    let attempted = false;
    try {
      let counted: RecipientCount = ONE_USER;
      if (chosen !== 'specific') {
        const fresh = await apiRequest('/api/notifications/recipient-count', {
          query: { audience: chosen },
          select: toRecipientCount,
        });
        if (!aliveRef.current) return;
        if (!fresh.ok) {
          if (fresh.error.status !== 401) {
            toast.show(`The recipients could not be counted, so nothing was sent. ${fresh.error.message}`, 'error');
          }
          if (fresh.error.status === 403) router.refresh();
          return;
        }
        counted = fresh.data;
        mutateRecipients(fresh.data);
      }
      if (counted.total === 0) {
        toast.show('Nobody is in this audience right now, so there is nothing to send.', 'warning');
        return;
      }
      const plan: SendPlan = {
        audience: chosen,
        type: current.type,
        title: cleanText(current.title),
        message: cleanText(current.message),
        user: chosen === 'specific' ? current.user : null,
        recipients: counted,
        globals,
        allowDuplicate,
      };
      setPhase('confirming');
      const decision = await confirm<SendOutcome>({
        ...sendOptions(plan),
        action: async () => {
          attempted = true;
          const result = classifySend(await apiRequest('/api/notifications/broadcast', {
            method: 'POST',
            body: sendBody(plan),
            timeoutMs: SEND_TIMEOUT_MS,
            select: toSendResult,
          }));
          if (result.kind === 'retry') throw new Error(result.message);
          return result;
        },
        returnFocusTo: () => reviewRef.current,
      });
      if (!aliveRef.current) return;
      const settled = decision?.value;
      if (!settled || settled.kind === 'retry' || settled.kind === 'expired') return;
      const next: Outcome = { ...settled, context: planContext(plan), at: Date.now() };
      const note = outcomeToast(next);
      toast.show(note.text, note.tone);
      setOutcome(next);
      if (settled.kind === 'sent') {
        setDraft(() => EMPTY_DRAFT);
        setShowErrors(false);
      }
      if (settled.kind === 'refused' && settled.status === 403) router.refresh();
    } finally {
      busyRef.current = false;
      if (aliveRef.current) {
        setPhase('idle');
        if (attempted) showLatestHistory(true);
      }
    }
  };

  const denied = !canRead || (history.error?.status === 403 && history.data === undefined);
  if (denied) {
    return (
      <div className={s.page}>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <AccessDenied required={[READ_PERMISSION]} />
      </div>
    );
  }

  const historyError = history.error;
  const historyRows = history.data?.rows ?? [];
  const historyBlocked = historyRows.length === 0 && historyError !== null;
  const historyLoading = historyRows.length === 0 && !historyBlocked && history.isInitialLoading;
  const historyBusy = history.isRefreshing && !historyLoading && !historyBlocked;
  const refreshedAt = history.data ? history.lastUpdatedAt : null;
  const historyTotal = history.data?.total ?? 0;
  const historyPageSize = history.data?.pageSize ?? HISTORY_PAGE_SIZE;
  const openRow = historyRows.find((row) => row.id === openId) ?? null;
  const offerResend = outcome?.kind === 'duplicate'
    && audiences.includes(outcome.context.audience)
    && sameDraft(draft, outcome.context.audience, outcome.context.title, outcome.context.message, outcome.context.userId);

  let recipientValue: ReactNode;
  if (!audience) {
    recipientValue = <span className={s.muted}>Choose an audience</span>;
  } else if (audience === 'specific') {
    recipientValue = draft.user ? '1 user' : <span className={s.muted}>Choose a user</span>;
  } else if (recipients.data) {
    recipientValue = recipientsText(audience, recipients.data);
  } else if (recipients.error) {
    recipientValue = (
      <span className={s.countError}>
        <span>Could not count</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void recipients.refresh()}>
          Retry
        </Button>
      </span>
    );
  } else {
    recipientValue = <Skeleton inline width="7em" />;
  }

  const historyView = {
    rows: historyRows,
    loading: historyLoading,
    busy: historyBusy,
    error: historyError,
    retrying: history.isInitialLoading || history.isRefreshing,
    openId,
    onRetry: () => void refreshHistory(),
    onOpen: (id: string) => setOpenId(id),
  };

  return (
    <div className={s.page}>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />

      {outcome ? (
        <OutcomeNotice
          outcome={outcome}
          busy={busy}
          onDismiss={() => setOutcome(null)}
          onCheckHistory={outcome.kind === 'unknown' || outcome.kind === 'duplicate' ? checkHistory : undefined}
          onSendAgain={offerResend ? () => void review(true) : undefined}
        />
      ) : null}

      {canCompose ? (
        <div className={s.layout}>
          <Card className={s.composer}>
            <CardHeader title="New broadcast" subtitle="Choose who receives it, then write the notification." />
            <CardBody>
              <fieldset className={s.fieldset} disabled={busy}>
                <div className={s.form}>
                  <div ref={audienceRef}>
                    <RadioGroup<Audience>
                      legend="Audience"
                      required
                      options={audiences.map((value) => ({
                        value,
                        label: AUDIENCE_META[value].label,
                        description: AUDIENCE_META[value].description,
                      }))}
                      value={audience}
                      onChange={(next) => setDraft((previous) => ({ ...previous, audience: next }))}
                      error={shown.audience}
                      help={audienceHelp(access)}
                    />
                  </div>

                  {audience === 'specific' ? (
                    <UserPicker
                      selected={draft.user}
                      onSelect={(user) => setDraft((previous) => ({ ...previous, user }))}
                      onClear={() => setDraft((previous) => ({ ...previous, user: null }))}
                      error={shown.user}
                      disabled={busy}
                      inputRef={userInputRef}
                    />
                  ) : null}

                  <div className={s.rule} aria-hidden />

                  <FieldShell
                    label="Category"
                    help="Saved with the notification and shown in the history. The app shows every category the same way."
                  >
                    <Select
                      value={draft.type}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (isBroadcastType(next)) setDraft((previous) => ({ ...previous, type: next }));
                      }}
                    >
                      {BROADCAST_TYPES.map((value) => <option key={value} value={value}>{TYPE_LABELS[value]}</option>)}
                    </Select>
                  </FieldShell>

                  <FieldShell
                    label="Title"
                    required
                    error={shown.title}
                    help={<CharacterCount value={draft.title} limit={TITLE_LIMIT} note="Shown in bold above the message." />}
                  >
                    <Input
                      ref={titleRef}
                      value={draft.title}
                      maxLength={TITLE_LIMIT}
                      autoComplete="off"
                      placeholder="For example: Weekend rate boost"
                      onFocus={() => setTarget('title')}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDraft((previous) => ({ ...previous, title: value }));
                      }}
                    />
                  </FieldShell>

                  <FieldShell
                    label="Message"
                    required
                    error={shown.message}
                    help={<CharacterCount value={draft.message} limit={MESSAGE_LIMIT} note="Line breaks are kept." />}
                  >
                    <Textarea
                      ref={messageRef}
                      rows={5}
                      value={draft.message}
                      maxLength={MESSAGE_LIMIT}
                      className={s.messageInput}
                      placeholder="What do you want users to know?"
                      onFocus={() => setTarget('message')}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDraft((previous) => ({ ...previous, message: value }));
                      }}
                    />
                  </FieldShell>

                  {unknown.length > 0 ? (
                    <Notice tone="warning" compact flush>
                      {unknown.join(', ')} {unknown.length === 1 ? 'is not a variable' : 'are not variables'} the broadcast
                      service knows. Check the spelling against the list below, or remove the braces.
                    </Notice>
                  ) : null}

                  <VariablePicker globals={globals} target={target} disabled={busy} onInsert={insert} />
                </div>
              </fieldset>
            </CardBody>
          </Card>

          <aside className={s.aside} aria-label="Preview and send">
            <Card>
              <CardHeader title="Preview" subtitle="How it reads in the app’s notification list." />
              <CardBody>
                <NotificationPreview title={draft.title} message={draft.message} globals={globals} />
                <dl className={s.summary}>
                  <div className={s.summaryRow}>
                    <dt>Audience</dt>
                    <dd>{audience ? AUDIENCE_META[audience].label : <span className={s.muted}>Not chosen</span>}</dd>
                  </div>
                  <div className={s.summaryRow}>
                    <dt>Recipients</dt>
                    <dd>{recipientValue}</dd>
                  </div>
                  <div className={s.summaryRow}>
                    <dt>Category</dt>
                    <dd>{TYPE_LABELS[draft.type]}</dd>
                  </div>
                </dl>
                <p className={s.summaryNote}>
                  The count is checked again when you review, and nothing is sent until you confirm.
                </p>
              </CardBody>
              <CardFooter className={s.asideFooter}>
                <Button type="button" variant="ghost" size="sm" disabled={busy || !dirty} onClick={() => void clearDraft()}>
                  Clear draft
                </Button>
                <Button
                  ref={reviewRef}
                  type="button"
                  variant="primary"
                  leftIcon={<Send size={14} aria-hidden />}
                  loading={phase === 'checking'}
                  disabled={busy}
                  onClick={() => void review()}
                >
                  {phase === 'checking' ? 'Checking recipients…' : 'Review and send'}
                </Button>
              </CardFooter>
            </Card>
          </aside>
        </div>
      ) : (
        <Notice tone="neutral" compact>
          You can view broadcasts but not send them. Sending needs the “Send to a segment” or “Send to all users”
          permission.
        </Notice>
      )}

      <section ref={historyRef} className={s.history} aria-labelledby={HISTORY_HEADING}>
        <div className={s.historyHead}>
          <div className={s.historyTitles}>
            <h2 id={HISTORY_HEADING} className={s.historyTitle}>Broadcast history</h2>
            <p className={s.historyMeta}>
              {refreshedAt === null
                ? 'Most recent first'
                : `Most recent first · updated ${formatBusinessTime(new Date(refreshedAt))} ${BUSINESS_TZ_LABEL}`}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<RotateCw size={14} aria-hidden />}
            loading={history.isRefreshing}
            disabled={history.isInitialLoading}
            onClick={() => void refreshHistory()}
          >
            Refresh
          </Button>
        </div>

        {historyError && historyRows.length > 0 ? (
          <Notice
            tone="warning"
            compact
            announce="polite"
            actions={<Button type="button" variant="ghost" size="sm" onClick={() => void refreshHistory()}>Try again</Button>}
          >
            The history could not be refreshed. {historyError.message}
          </Notice>
        ) : null}

        <ResponsiveView desktop={<HistoryTable {...historyView} />} mobile={<HistoryList {...historyView} />} />

        {historyTotal > historyPageSize ? (
          <Pagination
            page={historyPage}
            pageSize={historyPageSize}
            total={historyTotal}
            onPageChange={(next) => {
              setOpenId(null);
              setHistoryPage(next);
            }}
            label="Broadcast history pages"
            noun="broadcasts"
            disabled={history.isRefreshing}
            scrollTargetRef={historyRef}
          />
        ) : null}
      </section>

      <SidePanel
        open={openRow !== null}
        onClose={() => setOpenId(null)}
        title={openRow?.title || 'Broadcast'}
        subtitle={openRow?.sentAt ? `Sent ${formatBusinessDateTime(openRow.sentAt)} ${BUSINESS_TZ_LABEL}` : undefined}
        returnFocusTo={() => (openId ? document.querySelector<HTMLElement>(`[data-row-open="${openId}"]`) : null)}
      >
        {openRow ? <HistoryDetail row={openRow} canOpenUser={canOpenUsers} /> : null}
      </SidePanel>
    </div>
  );
}
