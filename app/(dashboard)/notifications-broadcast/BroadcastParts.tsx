'use client';

import { useEffect, useId, useState, type RefObject } from 'react';
import { Bell } from 'lucide-react';
import {
  Avatar, Badge, Button, Card, CardBody, DetailRow, ErrorState, FieldShell, LinkButton, MobileDataList, Notice, Ref,
  RowOpen, SearchInput, Table, TableEmpty, TableSkeleton, TableState, TBody, Td, Th, THead, Tr, useResource,
} from '../../_ui';
import { apiRequest, type ApiFailure } from '../../lib/apiClient';
import { BUSINESS_TZ_LABEL, formatAge, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import {
  CONFIG_VARIABLES, SEARCH_LIMIT, SEARCH_MIN, USER_VARIABLES, audienceLabel, splitTemplate, typeLabel, usedVariables,
  type GlobalValues, type VariableSpec,
} from './broadcastRules';
import {
  formatCount, outcomeSummary, plural, toUserHits, userLine, userName,
  type BroadcastRow, type Outcome, type TextField, type UserHit,
} from './model';
import s from './page.module.css';

const HISTORY_COLUMNS = 6;

const HISTORY_SKELETON = [
  { width: 116, lines: 2 },
  { width: '46%', lines: 2 },
  { width: 132, lines: 2 },
  { width: 64, align: 'right' },
  { width: 64, align: 'right' },
  { width: 48, align: 'right' },
] as const;

const EMPTY_HISTORY = {
  title: 'No broadcasts yet',
  hint: 'Each broadcast appears here with its audience and delivery counts once it is sent.',
};

export function TemplateText({ text, globals }: { text: string; globals: GlobalValues | null }) {
  return (
    <>
      {splitTemplate(text).map((part, index) => {
        if (part.kind === 'text') return <span key={index}>{part.text}</span>;
        if (!part.spec) return <span key={index} className={s.varUnknown}>{part.raw}</span>;
        const value = part.spec.scope === 'config' && globals ? globals[part.spec.token] : undefined;
        if (value !== undefined) return <span key={index} className={s.varValue}>{value}</span>;
        return <span key={index} className={s.varChip}>{part.spec.label}</span>;
      })}
    </>
  );
}

export interface NotificationPreviewProps {
  title: string;
  message: string;
  globals: GlobalValues | null;
  caption?: string;
}

export function NotificationPreview({ title, message, globals, caption }: NotificationPreviewProps) {
  const hasTitle = title.trim() !== '';
  const hasMessage = message.trim() !== '';
  return (
    <figure className={s.preview}>
      {caption ? <figcaption className={s.previewCaption}>{caption}</figcaption> : null}
      <div className={s.previewCard}>
        <span className={s.previewIcon} aria-hidden>
          <Bell size={14} />
        </span>
        <div className={s.previewText}>
          <p className={[s.previewTitle, !hasTitle && s.previewEmpty].filter(Boolean).join(' ')}>
            {hasTitle ? <TemplateText text={title} globals={globals} /> : 'Your title appears here'}
          </p>
          <p className={[s.previewMessage, !hasMessage && s.previewEmpty].filter(Boolean).join(' ')}>
            {hasMessage ? <TemplateText text={message} globals={globals} /> : 'Your message appears here'}
          </p>
        </div>
      </div>
    </figure>
  );
}

export function CharacterCount({ value, limit, note }: { value: string; limit: number; note?: string }) {
  const full = value.length >= limit;
  return (
    <span className={s.help}>
      {note ? <span>{note}</span> : null}
      <span className={[s.counter, full && s.counterFull].filter(Boolean).join(' ')}>
        {formatCount(value.length)}/{formatCount(limit)}
      </span>
    </span>
  );
}

interface VariableGroupProps {
  id: string;
  title: string;
  note: string;
  specs: readonly VariableSpec[];
  globals: GlobalValues | null;
  disabled?: boolean;
  onInsert: (token: string) => void;
}

function VariableGroup({ id, title, note, specs, globals, disabled, onInsert }: VariableGroupProps) {
  return (
    <div className={s.variableGroup} role="group" aria-labelledby={id}>
      <p id={id} className={s.variableHeading}>
        {title}
        <span className={s.variableNote}>{note}</span>
      </p>
      <ul className={s.variableList}>
        {specs.map((spec) => {
          const value = globals ? globals[spec.token] : undefined;
          const hintId = `${id}-${spec.token}`;
          return (
            <li key={spec.token}>
              <button
                type="button"
                className={s.variable}
                disabled={disabled}
                aria-label={`Insert ${spec.label}`}
                aria-describedby={hintId}
                onClick={() => onInsert(spec.token)}
              >
                <code className={s.variableToken}>{`{${spec.token}}`}</code>
                <span id={hintId} className={s.variableHint}>
                  {value ? `${spec.hint}. Now ${value}.` : spec.hint}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface VariablePickerProps {
  globals: GlobalValues | null;
  target: TextField;
  disabled?: boolean;
  onInsert: (token: string) => void;
}

export function VariablePicker({ globals, target, disabled, onInsert }: VariablePickerProps) {
  const baseId = useId();
  return (
    <div className={s.variables}>
      <div className={s.variablesHead}>
        <p className={s.fieldLabel}>Variables</p>
        <p className={s.variablesTarget}>Inserted at the cursor in the {target === 'title' ? 'title' : 'message'}</p>
      </div>
      <VariableGroup
        id={`${baseId}-user`}
        title="Personal"
        note="Filled in for each user"
        specs={USER_VARIABLES}
        globals={null}
        disabled={disabled}
        onInsert={onInsert}
      />
      <VariableGroup
        id={`${baseId}-config`}
        title="App settings"
        note="The same for everyone"
        specs={CONFIG_VARIABLES}
        globals={globals}
        disabled={disabled}
        onInsert={onInsert}
      />
    </div>
  );
}

function UserBadges({ user }: { user: UserHit }) {
  if (!user.deleted && user.active && user.pushEnabled) return null;
  return (
    <span className={s.badges}>
      {user.deleted ? <Badge tone="danger">Deleted</Badge> : null}
      {!user.deleted && !user.active ? <Badge tone="warning">Inactive</Badge> : null}
      {!user.deleted && !user.pushEnabled ? <Badge tone="neutral">Push off</Badge> : null}
    </span>
  );
}

export interface UserPickerProps {
  selected: UserHit | null;
  onSelect: (user: UserHit) => void;
  onClear: () => void;
  error?: string;
  disabled?: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function UserPicker({ selected, onSelect, onClear, error, disabled, inputRef }: UserPickerProps) {
  const labelId = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [refocus, setRefocus] = useState(false);
  const searching = selected === null && query.length >= SEARCH_MIN;
  const search = useResource<UserHit[]>(
    searching ? `user-search:${query}` : null,
    (signal) => apiRequest('/api/notifications/user-search', { query: { q: query }, signal, select: toUserHits }),
  );

  useEffect(() => {
    if (!refocus || selected) return;
    setRefocus(false);
    inputRef.current?.focus();
  }, [refocus, selected, inputRef]);

  if (selected) {
    const line = userLine(selected);
    return (
      <div className={s.picker}>
        <p id={labelId} className={s.fieldLabel}>User</p>
        <div className={s.chosen} role="group" aria-labelledby={labelId}>
          <Avatar name={userName(selected)} size="md" decorative />
          <div className={s.chosenText}>
            <span className={s.hitName}>{userName(selected)}</span>
            {line ? <span className={s.hitMeta}>{line}</span> : null}
            <UserBadges user={selected} />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onClear();
              setRefocus(true);
            }}
          >
            Change
          </Button>
        </div>
        {!selected.active ? (
          <p className={s.pickerNote}>This account is marked inactive, so group broadcasts leave it out. The user may not see this.</p>
        ) : null}
        {!selected.pushEnabled ? (
          <p className={s.pickerNote}>Push is turned off for this user, so they will only see it in the app.</p>
        ) : null}
      </div>
    );
  }

  const typed = text.trim();
  const hits = typed.length >= SEARCH_MIN ? search.data ?? [] : [];
  const pending = typed.length >= SEARCH_MIN && (typed !== query || search.isInitialLoading || search.isRefreshing);
  let status: string;
  if (typed.length < SEARCH_MIN) status = `Type at least ${SEARCH_MIN} characters.`;
  else if (pending) status = 'Searching…';
  else if (search.error) status = search.error.message;
  else if (hits.length === 0) status = `No users match “${query}”.`;
  else if (hits.length >= SEARCH_LIMIT) status = `Showing the first ${SEARCH_LIMIT} matches. Keep typing to narrow the list.`;
  else status = `${plural(hits.length, 'match', 'matches')}.`;

  return (
    <div className={s.picker}>
      <FieldShell label="User" required error={error} help="Search by name, username or email.">
        <SearchInput
          ref={inputRef}
          aria-label="Find the user to send to"
          placeholder="Name, username or email"
          value={text}
          onChange={setText}
          onDebouncedChange={setQuery}
          loading={pending}
          disabled={disabled}
        />
      </FieldShell>
      <p className={s.pickerStatus} role="status">{status}</p>
      {hits.length > 0 ? (
        <ul
          className={[s.hits, pending && s.hitsBusy].filter(Boolean).join(' ')}
          aria-label="Matching users"
          aria-busy={pending || undefined}
        >
          {hits.map((hit) => {
            const line = userLine(hit);
            return (
              <li key={hit.id}>
                <button
                  type="button"
                  className={s.hit}
                  disabled={disabled || hit.deleted}
                  onClick={() => onSelect(hit)}
                >
                  <Avatar name={userName(hit)} size="sm" decorative />
                  <span className={s.hitText}>
                    <span className={s.hitName}>{userName(hit)}</span>
                    <span className={s.hitMeta}>{line || 'No username or email'}</span>
                  </span>
                  <UserBadges user={hit} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export interface OutcomeNoticeProps {
  outcome: Outcome;
  onDismiss: () => void;
  onCheckHistory?: () => void;
  onSendAgain?: () => void;
  busy?: boolean;
}

export function OutcomeNotice({ outcome, onDismiss, onCheckHistory, onSendAgain, busy }: OutcomeNoticeProps) {
  const summary = outcomeSummary(outcome);
  const broadcastId = outcome.kind === 'sent' ? outcome.result.broadcastId : null;
  const context = outcome.context;
  const subject = context.title.length > 60 ? `${context.title.slice(0, 59)}…` : context.title;
  const meta = [
    `“${subject}” · ${audienceLabel(context.audience)} · ${formatBusinessTime(new Date(outcome.at))} ${BUSINESS_TZ_LABEL}`,
    broadcastId ? <>Broadcast <Ref value={broadcastId} label="broadcast ID" size="xs" /></> : null,
    outcome.requestId ? <>Request <Ref value={outcome.requestId} label="request ID" size="xs" /></> : null,
  ];
  const actions = onSendAgain || onCheckHistory ? (
    <>
      {onCheckHistory ? (
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onCheckHistory}>
          Check the history
        </Button>
      ) : null}
      {onSendAgain ? (
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onSendAgain}>
          Send it again anyway
        </Button>
      ) : null}
    </>
  ) : undefined;
  return (
    <Notice
      tone={summary.tone}
      title={summary.title}
      meta={meta}
      actions={actions}
      onDismiss={onDismiss}
      dismissLabel="Dismiss this result"
    >
      {summary.lines.length === 1 ? (
        summary.lines[0]
      ) : (
        <ul className={s.outcomeLines}>
          {summary.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </Notice>
  );
}

export interface HistoryViewProps {
  rows: readonly BroadcastRow[];
  loading: boolean;
  busy: boolean;
  error: ApiFailure | null;
  retrying: boolean;
  openId: string | null;
  onRetry: () => void;
  onOpen: (id: string) => void;
}

function sentAge(row: BroadcastRow): string {
  return row.sentAt ? `${formatAge(row.sentAt)} ago` : '—';
}

export function HistoryTable({ rows, loading, busy, error, retrying, openId, onRetry, onOpen }: HistoryViewProps) {
  return (
    <Card>
      <CardBody flush>
        <Table flush aria-label="Broadcast history" busy={busy}>
          <THead>
            <Tr>
              <Th>Sent</Th>
              <Th>Broadcast</Th>
              <Th>Audience</Th>
              <Th align="right">Recipients</Th>
              <Th align="right">Push accepted</Th>
              <Th align="right">Push failed</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.length === 0 && error ? (
              <TableState colSpan={HISTORY_COLUMNS}>
                <ErrorState
                  compact
                  title="The broadcast history could not be loaded"
                  message={error.message}
                  requestId={error.requestId}
                  onRetry={onRetry}
                  retrying={retrying}
                />
              </TableState>
            ) : loading ? (
              <TableSkeleton columns={HISTORY_SKELETON} rows={6} label="Loading the broadcast history" />
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={HISTORY_COLUMNS} title={EMPTY_HISTORY.title} hint={EMPTY_HISTORY.hint} />
            ) : (
              rows.map((row) => (
                <Tr key={row.id} selected={row.id === openId} onActivate={() => onOpen(row.id)}>
                  <Td>
                    <div className={s.stack}>
                      <span className={s.time}>{formatBusinessDateTime(row.sentAt)}</span>
                      <span className={s.sub}>{sentAge(row)}</span>
                    </div>
                  </Td>
                  <Td>
                    <div className={[s.stack, s.broadcastCell].join(' ')}>
                      <RowOpen onClick={() => onOpen(row.id)} aria-haspopup="dialog" data-row-open={row.id}>
                        {row.title || 'Untitled broadcast'}
                      </RowOpen>
                      <span className={[s.sub, s.clamp].join(' ')}>{row.message}</span>
                    </div>
                  </Td>
                  <Td>
                    <div className={s.stack}>
                      <span>{audienceLabel(row.audience)}</span>
                      <span className={s.sub}>{typeLabel(row.type)}</span>
                    </div>
                  </Td>
                  <Td align="right" mono>{formatCount(row.recipients)}</Td>
                  <Td align="right" mono>{formatCount(row.delivered)}</Td>
                  <Td align="right" mono>
                    <span className={row.failed > 0 ? s.failed : undefined}>{formatCount(row.failed)}</span>
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );
}

export function HistoryList({ rows, loading, busy, error, onRetry, onOpen }: HistoryViewProps) {
  return (
    <MobileDataList<BroadcastRow>
      ariaLabel="Broadcast history"
      items={rows}
      getKey={(row) => row.id}
      loading={loading || busy}
      initialLoading={loading}
      busy={busy}
      error={rows.length === 0 && error ? error.message : null}
      errorTitle="The broadcast history could not be loaded"
      onRetry={onRetry}
      empty={EMPTY_HISTORY}
      renderRow={(row) => ({
        primary: row.title || 'Untitled broadcast',
        value: plural(row.recipients, 'recipient', 'recipients'),
        secondary: row.message,
        status: audienceLabel(row.audience),
        meta: [
          formatBusinessDateTime(row.sentAt),
          `${formatCount(row.delivered)} pushed`,
          row.failed > 0 ? `${formatCount(row.failed)} failed` : null,
        ].filter(Boolean).join(' · '),
        onClick: () => onOpen(row.id),
      })}
    />
  );
}

export function HistoryDetail({ row, canOpenUser }: { row: BroadcastRow; canOpenUser: boolean }) {
  const personal = usedVariables(row.title, row.message).length > 0;
  return (
    <div className={s.detail}>
      <NotificationPreview
        title={row.title}
        message={row.message}
        globals={null}
        caption={personal ? 'As written. Variables were filled in when it was sent.' : 'As sent'}
      />
      <div className={s.detailRows}>
        <DetailRow
          label="Sent"
          value={row.sentAt ? `${formatBusinessDateTime(row.sentAt)} ${BUSINESS_TZ_LABEL} · ${sentAge(row)}` : '—'}
        />
        <DetailRow label="Audience" value={audienceLabel(row.audience)} />
        <DetailRow label="Category" value={typeLabel(row.type)} />
        <DetailRow label="Recipients" value={formatCount(row.recipients)} mono />
        <DetailRow label="Push accepted" value={formatCount(row.delivered)} mono />
        <DetailRow label="Push failed" value={formatCount(row.failed)} mono />
        {row.targetUserId ? (
          <DetailRow
            label="User"
            value={
              canOpenUser ? (
                <LinkButton href={`/users/${encodeURIComponent(row.targetUserId)}`} variant="ghost" size="sm">
                  Open user
                </LinkButton>
              ) : (
                <Ref value={row.targetUserId} label="user ID" size="sm" />
              )
            }
          />
        ) : null}
        <DetailRow label="Broadcast ID" value={<Ref value={row.id} label="broadcast ID" size="sm" />} />
      </div>
      {row.audience === 'all_anon' ? (
        <p className={s.detailNote}>Recipients and push counts include app-only devices.</p>
      ) : null}
      <p className={s.detailNote}>
        Push accepted means the push service took the message for delivery. Every recipient account also gets it in the
        app’s notification list.
      </p>
    </div>
  );
}
