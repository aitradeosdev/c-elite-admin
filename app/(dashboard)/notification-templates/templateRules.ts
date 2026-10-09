export type TemplateMode = 'text' | 'html';

export interface TemplateFieldSpec {
  readonly name: string;
  readonly label: string;
  readonly mode: TemplateMode;
  readonly max: number;
  readonly multiline: boolean;
}

export interface TemplateChannel {
  readonly id: 'notification' | 'email';
  readonly table: 'notification_templates' | 'email_templates';
  readonly action: 'UPDATE_NOTIFICATION_TEMPLATE' | 'UPDATE_EMAIL_TEMPLATE';
  readonly fields: readonly TemplateFieldSpec[];
  readonly keyPattern: RegExp | null;
  readonly keyMax: number;
}

export const NOTIFICATION_CHANNEL: TemplateChannel = {
  id: 'notification',
  table: 'notification_templates',
  action: 'UPDATE_NOTIFICATION_TEMPLATE',
  fields: [
    { name: 'title', label: 'Title', mode: 'text', max: 100, multiline: false },
    { name: 'body', label: 'Body', mode: 'text', max: 500, multiline: true },
  ],
  keyPattern: null,
  keyMax: 128,
};

export const EMAIL_CHANNEL: TemplateChannel = {
  id: 'email',
  table: 'email_templates',
  action: 'UPDATE_EMAIL_TEMPLATE',
  fields: [
    { name: 'subject', label: 'Subject', mode: 'text', max: 300, multiline: false },
    { name: 'html', label: 'HTML body', mode: 'html', max: 200000, multiline: true },
  ],
  keyPattern: /^[a-z0-9_]+$/i,
  keyMax: 64,
};

export const REASON_MAX_LENGTH = 500;

export interface TemplateRecord {
  key: string;
  values: Readonly<Record<string, string>>;
  description: string | null;
  variables: readonly string[];
  isActive: boolean;
  updatedAt: string | null;
}

export type IssueKind = 'unknown' | 'spaced' | 'doubled' | 'unclosed' | 'unopened';

export interface PlaceholderIssue {
  kind: IssueKind;
  token: string;
  name: string;
  index: number;
}

export type TemplateSegment =
  | { kind: 'text'; text: string }
  | { kind: 'variable'; name: string; text: string; known: boolean };

export interface TemplateScan {
  segments: TemplateSegment[];
  issues: PlaceholderIssue[];
  uses: Readonly<Record<string, number>>;
}

const IDENTIFIER = /^[A-Za-z0-9_]+$/;
const BRACE_GROUP = /\{([^{}]*)\}/g;
const LOOSE_OPEN = /\{\s*([A-Za-z0-9_]+)/g;
const LOOSE_CLOSE = /([A-Za-z0-9_]+)\s*\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushText(segments: TemplateSegment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.kind === 'text') {
    segments[segments.length - 1] = { kind: 'text', text: last.text + text };
    return;
  }
  segments.push({ kind: 'text', text });
}

function scanLoose(
  text: string,
  offset: number,
  known: ReadonlySet<string>,
  mode: TemplateMode,
  issues: PlaceholderIssue[],
): void {
  const flags = (name: string) => known.has(name) || mode === 'text';
  for (const match of text.matchAll(LOOSE_OPEN)) {
    const name = match[1];
    if (!flags(name)) continue;
    issues.push({ kind: 'unclosed', token: match[0], name, index: offset + (match.index ?? 0) });
  }
  for (const match of text.matchAll(LOOSE_CLOSE)) {
    const name = match[1];
    if (!flags(name)) continue;
    issues.push({ kind: 'unopened', token: match[0], name, index: offset + (match.index ?? 0) });
  }
}

export function scanTemplate(text: string, variables: readonly string[], mode: TemplateMode): TemplateScan {
  const known = new Set(variables);
  const segments: TemplateSegment[] = [];
  const issues: PlaceholderIssue[] = [];
  const uses: Record<string, number> = {};
  let cursor = 0;
  for (const match of text.matchAll(BRACE_GROUP)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const loose = text.slice(cursor, start);
    scanLoose(loose, cursor, known, mode, issues);
    pushText(segments, loose);
    cursor = end;
    const inner = match[1];
    if (known.has(inner) || IDENTIFIER.test(inner)) {
      const isKnown = known.has(inner);
      segments.push({ kind: 'variable', name: inner, text: match[0], known: isKnown });
      if (isKnown) {
        uses[inner] = (uses[inner] ?? 0) + 1;
        const opener = text[start - 1] === '{' ? '{' : '';
        const closer = text[end] === '}' ? '}' : '';
        if (opener || closer) {
          issues.push({ kind: 'doubled', token: `${opener}${match[0]}${closer}`, name: inner, index: start - opener.length });
        }
      } else {
        issues.push({ kind: 'unknown', token: match[0], name: inner, index: start });
      }
      continue;
    }
    const trimmed = inner.trim();
    if (trimmed !== inner && IDENTIFIER.test(trimmed) && (mode === 'text' || known.has(trimmed))) {
      issues.push({ kind: 'spaced', token: match[0], name: trimmed, index: start });
    }
    pushText(segments, match[0]);
  }
  const rest = text.slice(cursor);
  scanLoose(rest, cursor, known, mode, issues);
  pushText(segments, rest);
  issues.sort((a, b) => a.index - b.index);
  return { segments, issues, uses };
}

function issueKey(issue: PlaceholderIssue): string {
  return `${issue.kind}|${issue.token}`;
}

function countIssues(issues: readonly PlaceholderIssue[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issueKey(issue), (counts.get(issueKey(issue)) ?? 0) + 1);
  return counts;
}

export interface IssueSplit {
  introduced: PlaceholderIssue[];
  existing: PlaceholderIssue[];
}

export function splitIssues(
  before: string,
  after: string,
  variables: readonly string[],
  mode: TemplateMode,
): IssueSplit {
  const previous = countIssues(scanTemplate(before, variables, mode).issues);
  const current = scanTemplate(after, variables, mode).issues;
  const counts = countIssues(current);
  const introduced: PlaceholderIssue[] = [];
  const existing: PlaceholderIssue[] = [];
  const seen = new Set<string>();
  for (const issue of current) {
    const key = issueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    if ((counts.get(key) ?? 0) > (previous.get(key) ?? 0)) introduced.push(issue);
    else existing.push(issue);
  }
  return { introduced, existing };
}

export function introducedIssues(
  before: string,
  after: string,
  variables: readonly string[],
  mode: TemplateMode,
): PlaceholderIssue[] {
  return splitIssues(before, after, variables, mode).introduced;
}

export function removedVariables(
  before: string,
  after: string,
  variables: readonly string[],
  mode: TemplateMode,
): string[] {
  const was = scanTemplate(before, variables, mode).uses;
  const now = scanTemplate(after, variables, mode).uses;
  return variables.filter((name) => (was[name] ?? 0) > 0 && (now[name] ?? 0) === 0);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

export function suggestVariable(name: string, variables: readonly string[]): string | null {
  const lower = name.toLowerCase();
  const exact = variables.find((candidate) => candidate.toLowerCase() === lower);
  if (exact) return exact;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of variables) {
    const distance = editDistance(lower, candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== null && bestDistance <= Math.min(2, Math.floor(Math.max(name.length, 2) / 2)) ? best : null;
}

const LISTED_VARIABLES = 6;

export function variableList(variables: readonly string[]): string {
  const shown = variables.slice(0, LISTED_VARIABLES).map((name) => `{${name}}`).join(', ');
  const more = variables.length - LISTED_VARIABLES;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

export function describeIssue(issue: PlaceholderIssue, variables: readonly string[]): string {
  const fixed = `{${issue.name}}`;
  switch (issue.kind) {
    case 'unknown': {
      const suggestion = suggestVariable(issue.name, variables);
      const lead = `${issue.token} is not a variable this template supplies, so users would see it as typed.`;
      if (suggestion) return `${lead} Did you mean {${suggestion}}?`;
      if (variables.length === 0) return `${lead} This template has no variables.`;
      return `${lead} Use one of ${variableList(variables)}.`;
    }
    case 'spaced':
      return `${issue.token} has spaces inside the braces, so it would not be filled in. Write ${fixed}.`;
    case 'doubled':
      return `${issue.token} has doubled braces, so users would see a stray brace. Write ${fixed}.`;
    case 'unclosed':
      return `${issue.token} is missing its closing brace. Write ${fixed}.`;
    case 'unopened':
      return `${issue.token} is missing its opening brace. Write ${fixed}.`;
  }
}

export function escapeHtmlValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderTemplate(
  text: string,
  values: Readonly<Record<string, string>>,
  mode: TemplateMode,
): string {
  return text.replace(BRACE_GROUP, (match: string, inner: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, inner)) return match;
    const value = values[inner] ?? '';
    return mode === 'html' ? escapeHtmlValue(value) : value;
  });
}

export function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function templateColumns(channel: TemplateChannel): string {
  return ['key', ...channel.fields.map((field) => field.name), 'description', 'variables', 'is_active', 'updated_at'].join(', ');
}

export function toTemplateRecord(channel: TemplateChannel, raw: unknown): TemplateRecord | null {
  if (!isRecord(raw) || typeof raw.key !== 'string' || raw.key === '') return null;
  const values: Record<string, string> = {};
  for (const field of channel.fields) {
    const value = raw[field.name];
    values[field.name] = typeof value === 'string' ? value : '';
  }
  const variables = Array.isArray(raw.variables)
    ? raw.variables.filter((name): name is string => typeof name === 'string' && name !== '')
    : [];
  return {
    key: raw.key,
    values,
    description: typeof raw.description === 'string' && raw.description.trim() !== '' ? raw.description : null,
    variables: Array.from(new Set(variables)),
    isActive: raw.is_active !== false,
    updatedAt: typeof raw.updated_at === 'string' && raw.updated_at !== '' ? raw.updated_at : null,
  };
}

export function presentTemplate(channel: TemplateChannel, record: TemplateRecord): Record<string, unknown> {
  const out: Record<string, unknown> = { key: record.key };
  for (const field of channel.fields) out[field.name] = record.values[field.name] ?? '';
  out.description = record.description;
  out.variables = [...record.variables];
  out.is_active = record.isActive;
  out.updated_at = record.updatedAt;
  return out;
}

export interface TemplatePatchRequest {
  key: string;
  values: Readonly<Record<string, string>>;
  isActive: boolean | null;
  expected: { values: Readonly<Record<string, string>>; isActive: boolean | null } | null;
  reason: string | null;
}

export type TemplatePatchRead = { ok: true; request: TemplatePatchRequest } | { ok: false; message: string };

function readKey(channel: TemplateChannel, raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > channel.keyMax) return null;
  if (channel.keyPattern && !channel.keyPattern.test(raw)) return null;
  return raw;
}

function readText(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw === 'string') return { ok: true, value: raw };
  if (typeof raw === 'number' && Number.isFinite(raw)) return { ok: true, value: String(raw) };
  return { ok: false };
}

function readFlag(raw: unknown): { ok: true; value: boolean | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  if (raw === 'true' || raw === 1) return { ok: true, value: true };
  if (raw === 'false' || raw === 0) return { ok: true, value: false };
  return { ok: false };
}

function readReason(raw: unknown): { ok: true; reason: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, reason: null };
  if (typeof raw !== 'string') return { ok: false, message: 'The reason must be text.' };
  const reason = raw.trim();
  if (reason.length > REASON_MAX_LENGTH) {
    return { ok: false, message: `Keep the reason to ${REASON_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, reason: reason || null };
}

function readExpected(
  channel: TemplateChannel,
  raw: unknown,
): { ok: true; expected: TemplatePatchRequest['expected'] } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, expected: null };
  const invalid = 'expected must list the values you last saw for the fields you are changing.';
  if (!isRecord(raw)) return { ok: false, message: invalid };
  const values: Record<string, string> = {};
  for (const field of channel.fields) {
    const value = raw[field.name];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') return { ok: false, message: invalid };
    values[field.name] = value;
  }
  const flag = readFlag(raw.is_active);
  if (!flag.ok) return { ok: false, message: invalid };
  return { ok: true, expected: { values, isActive: flag.value } };
}

export function readTemplatePatch(channel: TemplateChannel, body: unknown): TemplatePatchRead {
  if (!isRecord(body)) return { ok: false, message: 'Send the template changes as a JSON object.' };
  const key = readKey(channel, body.key);
  if (key === null) return { ok: false, message: 'A valid template key is required.' };
  const values: Record<string, string> = {};
  for (const field of channel.fields) {
    const read = readText(body[field.name]);
    if (!read.ok) return { ok: false, message: `The ${field.label.toLowerCase()} must be text.` };
    if (read.value !== null) values[field.name] = read.value;
  }
  const flag = readFlag(body.is_active);
  if (!flag.ok) return { ok: false, message: 'is_active must be true or false.' };
  const reason = readReason(body.reason);
  if (!reason.ok) return reason;
  const expected = readExpected(channel, body.expected);
  if (!expected.ok) return expected;
  return { ok: true, request: { key, values, isActive: flag.value, expected: expected.expected, reason: reason.reason } };
}

export interface FieldValidation {
  field: string;
  message: string;
  issues: PlaceholderIssue[];
}

export function checkFieldEdit(
  field: TemplateFieldSpec,
  before: string,
  after: string,
  variables: readonly string[],
): FieldValidation | null {
  const noun = field.label.toLowerCase();
  if (after.trim() === '') return { field: field.name, message: `The ${noun} cannot be empty.`, issues: [] };
  if (after.length > field.max) {
    return {
      field: field.name,
      message: `Keep the ${noun} to ${field.max.toLocaleString('en-NG')} characters or fewer. It is ${after.length.toLocaleString('en-NG')} now.`,
      issues: [],
    };
  }
  const introduced = introducedIssues(before, after, variables, field.mode);
  if (introduced.length === 0) return null;
  const first = describeIssue(introduced[0], variables);
  const more = introduced.length - 1;
  const tail = more > 0 ? ` ${more === 1 ? 'One more problem' : `${more} more problems`} in the ${noun}.` : '';
  return { field: field.name, message: `${field.label}: ${first}${tail}`, issues: introduced };
}

export interface TemplateEditPlan {
  updates: Record<string, string | boolean>;
  before: Record<string, string | boolean>;
  after: Record<string, string | boolean>;
  changed: string[];
}

export type TemplateEditResult =
  | { ok: true; plan: TemplateEditPlan }
  | { ok: false; code: 'VALIDATION_ERROR' | 'STATE_CONFLICT'; message: string; details: Record<string, unknown> };

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export function planTemplateEdit(
  channel: TemplateChannel,
  current: TemplateRecord,
  request: TemplatePatchRequest,
): TemplateEditResult {
  const changedFields: TemplateFieldSpec[] = [];
  const conflicts: string[] = [];
  const conflictLabels: string[] = [];
  for (const field of channel.fields) {
    const next = request.values[field.name];
    if (next === undefined) continue;
    const now = current.values[field.name] ?? '';
    if (next === now) continue;
    const seen = request.expected?.values[field.name];
    if (seen !== undefined && seen !== now) {
      conflicts.push(field.name);
      conflictLabels.push(field.label.toLowerCase());
      continue;
    }
    changedFields.push(field);
  }
  let activeChanged = false;
  if (request.isActive !== null && request.isActive !== current.isActive) {
    const seen = request.expected?.isActive ?? null;
    if (seen !== null && seen !== current.isActive) {
      conflicts.push('is_active');
      conflictLabels.push('on/off switch');
    } else {
      activeChanged = true;
    }
  }
  if (conflicts.length > 0) {
    return {
      ok: false,
      code: 'STATE_CONFLICT',
      message: `Another admin changed the ${joinLabels(conflictLabels)} of this template after you opened it, so nothing was saved. Reload to see the current version.`,
      details: { conflicts },
    };
  }
  for (const field of changedFields) {
    const problem = checkFieldEdit(field, current.values[field.name] ?? '', request.values[field.name] ?? '', current.variables);
    if (problem) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: problem.message,
        details: {
          field: problem.field,
          issues: problem.issues.map((issue) => ({
            kind: issue.kind,
            token: issue.token,
            suggestion: issue.kind === 'unknown' ? suggestVariable(issue.name, current.variables) : `{${issue.name}}`,
          })),
          variables: [...current.variables],
        },
      };
    }
  }
  const updates: Record<string, string | boolean> = {};
  const before: Record<string, string | boolean> = {};
  const after: Record<string, string | boolean> = {};
  for (const field of changedFields) {
    updates[field.name] = request.values[field.name] ?? '';
    before[field.name] = current.values[field.name] ?? '';
    after[field.name] = request.values[field.name] ?? '';
  }
  if (activeChanged && request.isActive !== null) {
    updates.is_active = request.isActive;
    before.is_active = current.isActive;
    after.is_active = request.isActive;
  }
  return { ok: true, plan: { updates, before, after, changed: Object.keys(updates) } };
}
