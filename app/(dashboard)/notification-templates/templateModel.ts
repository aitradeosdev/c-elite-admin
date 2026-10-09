import type { ApiBody, ApiResult } from '../../lib/apiClient';
import type { SortState } from '../../_ui';
import {
  describeIssue, humanizeKey, removedVariables, scanTemplate, splitIssues, toTemplateRecord,
  type PlaceholderIssue, type TemplateChannel, type TemplateFieldSpec, type TemplateRecord,
} from './templateRules';

export interface TemplateDraft {
  values: Readonly<Record<string, string>>;
  isActive: boolean;
}

export interface FieldChange {
  field: TemplateFieldSpec;
  before: string;
  after: string;
}

export interface ActiveChange {
  before: boolean;
  after: boolean;
}

export interface FieldProblems {
  errors: string[];
  warnings: string[];
  removed: string[];
}

export interface Rebase {
  draft: TemplateDraft;
  conflicts: string[];
  refreshed: string[];
}

export interface SaveReceipt {
  changed: boolean;
  template: TemplateRecord | null;
  auditRecorded: boolean;
  warning: string | null;
}

export type SaveOutcome =
  | { kind: 'saved'; receipt: SaveReceipt }
  | { kind: 'unknown'; message: string }
  | { kind: 'stale'; message: string }
  | { kind: 'missing'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'expired' }
  | { kind: 'retry'; message: string };

export interface TemplateStats {
  total: number;
  active: number;
  inactive: number;
  lastChanged: string | null;
}

export interface VariableInfo {
  sample: string;
  hint: string;
}

export const ACTIVE_LABEL = 'On/off switch';

export const VARIABLE_INFO: Readonly<Record<string, VariableInfo>> = {
  symbol: { sample: '$', hint: 'Currency symbol of the card’s country' },
  amount_foreign: { sample: '50', hint: 'Card value in the card’s own currency' },
  card_name: { sample: 'Amazon', hint: 'Card brand' },
  type_parens: { sample: ' (Physical)', hint: 'Card type in brackets after a space, or nothing when the card has no type' },
  credit: { sample: '72,500', hint: 'Naira credited to the wallet' },
  card_label: { sample: '$50 Amazon (Physical)', hint: 'Card value, brand and type' },
  reason: { sample: 'The code has already been redeemed', hint: 'Reason the reviewer gave' },
  amount: { sample: '10,000', hint: 'Naira amount' },
  total: { sample: '10,500', hint: 'Naira total' },
  bank_name: { sample: 'Access Bank', hint: 'Bank the payout went to' },
  account_last4: { sample: '6789', hint: 'Last four digits of the account number' },
  provider: { sample: 'MTN', hint: 'Bill provider' },
  type: { sample: 'airtime', hint: 'Bill type: airtime, data, cable or electricity' },
  hours: { sample: '24', hint: 'Hours withdrawals stay paused after a PIN reset' },
  sender_username: { sample: 'john', hint: 'Username of the sender' },
  first_name: { sample: 'Ada', hint: 'First name, or nothing when the user has no name on file' },
  device_model: { sample: 'iPhone 14', hint: 'Device model' },
  os_version: { sample: 'iOS 17.1', hint: 'Operating system version' },
  app_version: { sample: '1.2.0', hint: 'App version' },
  ip: { sample: '102.89.34.12', hint: 'IP address the sign-in came from' },
  when: { sample: '17/04/2026, 10:42:15', hint: 'Sign-in time in the alert time zone' },
  severity_upper: { sample: 'CRITICAL', hint: 'Alert severity in capitals' },
  severity_color: { sample: '#C62828', hint: 'Colour code for the severity' },
  alert_type: { sample: 'failed_login_burst', hint: 'Alert type code' },
  alert_subject: { sample: 'Repeated failed admin logins from 102.89.34.12', hint: 'Alert headline' },
  detail_json: { sample: '{\n  "ip": "102.89.34.12",\n  "count": 12\n}', hint: 'Alert details as formatted JSON' },
  fired_at: { sample: '2026-04-17T09:42:15.000Z', hint: 'When the alert fired, in UTC' },
};

export function variableHint(name: string): string | null {
  return Object.prototype.hasOwnProperty.call(VARIABLE_INFO, name) ? VARIABLE_INFO[name].hint : null;
}

export function defaultSample(name: string): string {
  return Object.prototype.hasOwnProperty.call(VARIABLE_INFO, name) ? VARIABLE_INFO[name].sample : `[${name}]`;
}

export function defaultSamples(variables: readonly string[]): Record<string, string> {
  const samples: Record<string, string> = {};
  for (const name of variables) samples[name] = defaultSample(name);
  return samples;
}

export function templateName(record: Pick<TemplateRecord, 'key'>): string {
  return humanizeKey(record.key);
}

export function toTemplateList(channel: TemplateChannel): (body: ApiBody) => TemplateRecord[] | null {
  return (body) => {
    if (!Array.isArray(body.templates)) return null;
    const rows: TemplateRecord[] = [];
    for (const raw of body.templates) {
      const record = toTemplateRecord(channel, raw);
      if (record) rows.push(record);
    }
    return rows;
  };
}

export function toSaveReceipt(channel: TemplateChannel): (body: ApiBody) => SaveReceipt {
  return (body) => ({
    changed: body.changed !== false,
    template: toTemplateRecord(channel, body.template),
    auditRecorded: body.audit_recorded !== false,
    warning: typeof body.warning === 'string' && body.warning.trim() !== '' ? body.warning : null,
  });
}

export function classifySave(result: ApiResult<SaveReceipt>): SaveOutcome {
  if (result.ok) return { kind: 'saved', receipt: result.data };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  if (failure.status === 403) return { kind: 'refused', message: failure.message };
  if (failure.status === 404) return { kind: 'missing', message: failure.message };
  if (failure.status === 409) return { kind: 'stale', message: failure.message };
  return { kind: 'retry', message: failure.message };
}

export function draftOf(record: TemplateRecord): TemplateDraft {
  return { values: { ...record.values }, isActive: record.isActive };
}

export function fieldChanges(channel: TemplateChannel, base: TemplateRecord, draft: TemplateDraft): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of channel.fields) {
    const before = base.values[field.name] ?? '';
    const after = draft.values[field.name] ?? '';
    if (before !== after) changes.push({ field, before, after });
  }
  return changes;
}

export function activeChange(base: TemplateRecord, draft: TemplateDraft): ActiveChange | null {
  return base.isActive === draft.isActive ? null : { before: base.isActive, after: draft.isActive };
}

export function isDirty(channel: TemplateChannel, base: TemplateRecord, draft: TemplateDraft): boolean {
  return fieldChanges(channel, base, draft).length > 0 || activeChange(base, draft) !== null;
}

export function sameContent(channel: TemplateChannel, record: TemplateRecord, draft: TemplateDraft): boolean {
  return !isDirty(channel, record, draft);
}

export function sameRecord(channel: TemplateChannel, a: TemplateRecord, b: TemplateRecord): boolean {
  return a.key === b.key
    && a.updatedAt === b.updatedAt
    && a.isActive === b.isActive
    && a.description === b.description
    && a.variables.join('\u0000') === b.variables.join('\u0000')
    && channel.fields.every((field) => (a.values[field.name] ?? '') === (b.values[field.name] ?? ''));
}

export function rebaseDraft(
  channel: TemplateChannel,
  base: TemplateRecord,
  draft: TemplateDraft,
  live: TemplateRecord,
): Rebase {
  const values: Record<string, string> = {};
  const conflicts: string[] = [];
  const refreshed: string[] = [];
  for (const field of channel.fields) {
    const was = base.values[field.name] ?? '';
    const mine = draft.values[field.name] ?? '';
    const theirs = live.values[field.name] ?? '';
    if (mine === was) {
      values[field.name] = theirs;
      if (theirs !== was) refreshed.push(field.label);
      continue;
    }
    values[field.name] = mine;
    if (theirs !== was && theirs !== mine) conflicts.push(field.label);
  }
  let isActive = draft.isActive;
  if (draft.isActive === base.isActive) {
    isActive = live.isActive;
    if (live.isActive !== base.isActive) refreshed.push(ACTIVE_LABEL);
  }
  return { draft: { values, isActive }, conflicts, refreshed };
}

export function savePayload(
  channel: TemplateChannel,
  base: TemplateRecord,
  draft: TemplateDraft,
  reason: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = { key: base.key };
  const expected: Record<string, unknown> = {};
  for (const change of fieldChanges(channel, base, draft)) {
    body[change.field.name] = change.after;
    expected[change.field.name] = change.before;
  }
  const active = activeChange(base, draft);
  if (active) {
    body.is_active = active.after;
    expected.is_active = active.before;
  }
  body.expected = expected;
  const note = reason.trim();
  if (note) body.reason = note;
  return body;
}

export function recordFromDraft(base: TemplateRecord, draft: TemplateDraft): TemplateRecord {
  return { ...base, values: { ...draft.values }, isActive: draft.isActive };
}

export function fieldProblems(
  field: TemplateFieldSpec,
  before: string,
  after: string,
  variables: readonly string[],
): FieldProblems {
  const errors: string[] = [];
  const noun = field.label.toLowerCase();
  const changed = before !== after;
  if (changed && after.trim() === '') errors.push(`The ${noun} cannot be empty.`);
  else if (changed && after.length > field.max) {
    errors.push(`Keep the ${noun} to ${field.max.toLocaleString('en-NG')} characters or fewer.`);
  }
  const split = splitIssues(before, after, variables, field.mode);
  for (const issue of split.introduced) errors.push(describeIssue(issue, variables));
  const warnings = split.existing.map((issue) => `${describeIssue(issue, variables)} This is already in the saved version.`);
  const removed = changed ? removedVariables(before, after, variables, field.mode) : [];
  return { errors, warnings, removed };
}

export function templateProblems(
  channel: TemplateChannel,
  base: TemplateRecord,
  draft: TemplateDraft,
): Record<string, FieldProblems> {
  const problems: Record<string, FieldProblems> = {};
  for (const field of channel.fields) {
    problems[field.name] = fieldProblems(
      field,
      base.values[field.name] ?? '',
      draft.values[field.name] ?? '',
      base.variables,
    );
  }
  return problems;
}

export function firstInvalidField(channel: TemplateChannel, problems: Readonly<Record<string, FieldProblems>>): string | null {
  const field = channel.fields.find((spec) => (problems[spec.name]?.errors.length ?? 0) > 0);
  return field ? field.name : null;
}

export function variableUses(
  channel: TemplateChannel,
  draft: TemplateDraft,
  variables: readonly string[],
): Record<string, number> {
  const uses: Record<string, number> = {};
  for (const field of channel.fields) {
    const scan = scanTemplate(draft.values[field.name] ?? '', variables, field.mode);
    for (const [name, count] of Object.entries(scan.uses)) uses[name] = (uses[name] ?? 0) + count;
  }
  return uses;
}

export function insertToken(value: string, token: string, start: number | null, end: number | null): { value: string; caret: number } {
  const from = start === null ? value.length : Math.max(0, Math.min(start, value.length));
  const to = end === null ? from : Math.max(from, Math.min(end, value.length));
  return { value: value.slice(0, from) + token + value.slice(to), caret: from + token.length };
}

export function filterTemplates(
  channel: TemplateChannel,
  rows: readonly TemplateRecord[],
  query: string,
): TemplateRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => {
    const haystack = [
      row.key,
      templateName(row),
      row.description ?? '',
      ...channel.fields.map((field) => row.values[field.name] ?? ''),
    ];
    return haystack.some((text) => text.toLowerCase().includes(needle));
  });
}

function timeOf(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function sortTemplates(rows: readonly TemplateRecord[], sort: SortState | null): TemplateRecord[] {
  const copy = [...rows];
  if (!sort) return copy;
  const direction = sort.dir === 'desc' ? -1 : 1;
  if (sort.key === 'updated') {
    return copy.sort((a, b) => {
      const left = timeOf(a.updatedAt);
      const right = timeOf(b.updatedAt);
      if (left === right) return a.key.localeCompare(b.key);
      if (left === Number.NEGATIVE_INFINITY) return 1;
      if (right === Number.NEGATIVE_INFINITY) return -1;
      return (left - right) * direction;
    });
  }
  if (sort.key === 'name') {
    return copy.sort((a, b) => templateName(a).localeCompare(templateName(b), 'en') * direction);
  }
  return copy;
}

export function templateStats(rows: readonly TemplateRecord[]): TemplateStats {
  let active = 0;
  let lastChanged: string | null = null;
  for (const row of rows) {
    if (row.isActive) active++;
    if (row.updatedAt && timeOf(row.updatedAt) > timeOf(lastChanged)) lastChanged = row.updatedAt;
  }
  return { total: rows.length, active, inactive: rows.length - active, lastChanged };
}

export function withTemplate(
  rows: readonly TemplateRecord[] | undefined,
  record: TemplateRecord,
): TemplateRecord[] | undefined {
  if (!rows) return rows;
  let found = false;
  const next = rows.map((row) => {
    if (row.key !== record.key) return row;
    found = true;
    return record;
  });
  return found ? next : [...next, record];
}

export interface MarkedRun {
  text: string;
  marked: boolean;
}

export type TextRange = readonly [number, number];

export function brokenRanges(issues: readonly PlaceholderIssue[]): TextRange[] {
  return issues
    .filter((issue) => issue.kind !== 'unknown')
    .map((issue): TextRange => [issue.index, issue.index + issue.token.length])
    .sort((a, b) => a[0] - b[0]);
}

export function markedRuns(text: string, offset: number, ranges: readonly TextRange[]): MarkedRun[] {
  const runs: MarkedRun[] = [];
  const end = offset + text.length;
  const push = (from: number, to: number, marked: boolean) => {
    if (to <= from) return;
    const slice = text.slice(from - offset, to - offset);
    const last = runs[runs.length - 1];
    if (last && last.marked === marked) last.text += slice;
    else runs.push({ text: slice, marked });
  };
  let cursor = offset;
  for (const [from, to] of ranges) {
    const start = Math.max(from, cursor);
    const stop = Math.min(to, end);
    if (stop <= start) continue;
    push(cursor, start, false);
    push(start, stop, true);
    cursor = stop;
  }
  push(cursor, end, false);
  return runs;
}
