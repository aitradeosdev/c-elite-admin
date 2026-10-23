'use client';

import {
  type FormEvent, type ReactNode, type WheelEvent,
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AccessDenied, Button, Card, CardBody, CardHeader, ErrorState, FieldShell, Input, Select,
  Skeleton, SkeletonLines, Textarea, Toggle, useConfirm, useToast,
} from '../../_ui';
import type { ConfirmOptions } from '../../_ui';
import s from './ConfigForm.module.css';

export type ConfigValues = Record<string, string>;

export type ConfigInput = 'number' | 'text' | 'textarea' | 'toggle' | 'select';

export interface ConfigOption {
  value: string;
  label: string;
}

export type ConfigValidator = (value: string, values: ConfigValues) => string | null;

export type ConfigConsequence = (next: string, previous: string) => string | null;

export interface ConfigField {
  key: string;
  label: string;
  hint?: string;
  input: ConfigInput;
  options?: ConfigOption[];
  min?: number;
  max?: number;
  step?: number;
  mono?: boolean;
  required?: boolean;
  placeholder?: string;
  validate?: ConfigValidator;
  consequence?: ConfigConsequence;
}

export interface ConfigSection {
  title: string;
  description?: string;
  fields: ConfigField[];
}

export interface ConfigFormProps {
  title: string;
  subtitle?: ReactNode;
  endpoint: string;
  sections: ConfigSection[];
}

export interface ConfigChange {
  key: string;
  label: string;
  from: string;
  to: string;
  field: ConfigField;
}

export interface ConfigConflict {
  key: string;
  label: string;
  live: string;
  mine: string;
  field: ConfigField;
}

export interface RebaseResult {
  draft: ConfigValues;
  conflicts: ConfigConflict[];
}

export interface ConfigPayload {
  changes: ConfigValues;
  expected?: ConfigValues;
}

export type LoadFailureKind = 'network' | 'session' | 'forbidden' | 'server' | 'invalid';

export interface LoadFailure {
  kind: LoadFailureKind;
  message: string;
  detail: string | null;
  requestId: string | null;
}

export type FetchConfigResult =
  | { ok: true; values: ConfigValues }
  | { ok: false; failure: LoadFailure };

export interface SaveResult {
  status: number | null;
  body: unknown;
}

export interface NumberBounds {
  min?: number;
  max?: number;
  step?: number;
}

export interface NumberListOptions {
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface ConfigFieldEntry {
  field: ConfigField;
  section: ConfigSection;
}

type Phase = 'idle' | 'checking' | 'confirming' | 'saving';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; failure: LoadFailure }
  | { status: 'ready' };

interface FocusRequest {
  key: string | null;
  seq: number;
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const NUMBER_PATTERN = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const IPV4_PATTERN = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const INVALID_NUMBER = 'Enter a valid number.';
const REQUIRED = 'Enter a value.';
const INVALID_RESPONSE = 'The server sent a response these settings could not read.';
const LOAD_TIMEOUT_MS = 20_000;
const SAVE_TIMEOUT_MS = 30_000;

export function isOn(value: string | null | undefined): boolean {
  return TRUE_VALUES.has((value ?? '').trim().toLowerCase());
}

export function isPlainNumber(value: string): boolean {
  return NUMBER_PATTERN.test(value.trim());
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-NG', { maximumFractionDigits: 10 });
}

export function isRequired(field: ConfigField): boolean {
  return field.required ?? field.input === 'number';
}

export function isMono(field: ConfigField): boolean {
  if (field.input === 'toggle' || field.input === 'select') return false;
  return field.mono ?? field.input === 'number';
}

export function configFields(sections: ConfigSection[]): ConfigFieldEntry[] {
  const seen = new Set<string>();
  const entries: ConfigFieldEntry[] = [];
  for (const section of sections) {
    for (const field of section.fields) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      entries.push({ field, section });
    }
  }
  return entries;
}

export function normalizeValue(field: ConfigField, raw: string | null | undefined): string {
  const value = raw ?? '';
  if (field.input === 'toggle') return isOn(value) ? 'true' : 'false';
  if (field.input === 'select') return value;
  return value.trim();
}

export function normalizeValues(sections: ConfigSection[], raw: ConfigValues): ConfigValues {
  const values: ConfigValues = { ...raw };
  for (const { field } of configFields(sections)) values[field.key] = normalizeValue(field, raw[field.key]);
  return values;
}

export function changeLabels(sections: ConfigSection[]): Record<string, string> {
  const entries = configFields(sections);
  const scoped = (entry: ConfigFieldEntry) => `${entry.section.title} · ${entry.field.label}`;
  const tally = (pick: (entry: ConfigFieldEntry) => string) => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(pick(entry), (counts.get(pick(entry)) ?? 0) + 1);
    return counts;
  };
  const byLabel = tally((entry) => entry.field.label);
  const byScope = tally(scoped);
  const labels: Record<string, string> = {};
  for (const entry of entries) {
    labels[entry.field.key] = (byLabel.get(entry.field.label) ?? 0) < 2
      ? entry.field.label
      : (byScope.get(scoped(entry)) ?? 0) < 2
        ? scoped(entry)
        : `${scoped(entry)} (${entry.field.key})`;
  }
  return labels;
}

export function diffConfig(sections: ConfigSection[], baseline: ConfigValues, draft: ConfigValues): ConfigChange[] {
  const labels = changeLabels(sections);
  const changes: ConfigChange[] = [];
  for (const { field } of configFields(sections)) {
    const from = normalizeValue(field, baseline[field.key]);
    const to = normalizeValue(field, draft[field.key]);
    if (from !== to) changes.push({ key: field.key, label: labels[field.key], from, to, field });
  }
  return changes;
}

export function buildPayload(changes: ConfigChange[], live?: ConfigValues): ConfigPayload {
  const values: ConfigValues = {};
  for (const change of changes) values[change.key] = change.to;
  if (!live) return { changes: values };
  const expected: ConfigValues = {};
  for (const change of changes) expected[change.key] = live[change.key] ?? '';
  return { changes: values, expected };
}

export function applyChanges(values: ConfigValues, changes: ConfigChange[]): ConfigValues {
  const next: ConfigValues = { ...values };
  for (const change of changes) next[change.key] = change.to;
  return next;
}

export function rebaseDraft(
  sections: ConfigSection[],
  previous: ConfigValues,
  draft: ConfigValues,
  latest: ConfigValues,
): RebaseResult {
  const labels = changeLabels(sections);
  const next: ConfigValues = { ...latest };
  const conflicts: ConfigConflict[] = [];
  for (const { field } of configFields(sections)) {
    const { key } = field;
    const base = normalizeValue(field, previous[key]);
    const mine = normalizeValue(field, draft[key]);
    const live = normalizeValue(field, latest[key]);
    if (mine === base) {
      next[key] = latest[key] ?? '';
      continue;
    }
    next[key] = draft[key] ?? '';
    if (live !== base && live !== mine) conflicts.push({ key, label: labels[key], live, mine, field });
  }
  return { draft: next, conflicts };
}

export function displayValue(field: ConfigField, value: string): string {
  if (field.input === 'toggle') {
    const normalized = isOn(value) ? 'true' : 'false';
    const option = field.options?.find((candidate) => candidate.value === normalized);
    return option?.label ?? (normalized === 'true' ? 'On' : 'Off');
  }
  if (value === '') return 'Empty';
  if (field.input === 'select') {
    return field.options?.find((candidate) => candidate.value === value)?.label ?? value;
  }
  return value;
}

function decimalPlaces(text: string): number {
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function trimFraction(text: string): string {
  if (!text.includes('.')) return text;
  const trimmed = text.replace(/0+$/, '');
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

function decimalText(value: number): string {
  return Number.isInteger(value) ? String(value) : trimFraction(value.toFixed(10));
}

function scaled(text: string, places: number): bigint {
  const [whole, fraction = ''] = text.split('.');
  return BigInt(`${whole || '0'}${fraction.padEnd(places, '0')}`);
}

export function matchesStep(value: string, step: number): boolean {
  if (!(step >= 1e-10)) return true;
  const text = trimFraction(value.trim().replace(/^-/, ''));
  if (!isPlainNumber(text)) return false;
  const stepText = decimalText(step);
  const places = Math.max(decimalPlaces(text), decimalPlaces(stepText));
  if (places > 12) return false;
  return scaled(text, places) % scaled(stepText, places) === BigInt(0);
}

export function stepMessage(step: number): string {
  if (step === 1) return 'Enter a whole number.';
  const places = Math.round(-Math.log10(step));
  if (places > 0 && Math.abs(10 ** -places - step) < 1e-12) {
    return places === 1 ? 'Use at most 1 decimal place.' : `Use at most ${places} decimal places.`;
  }
  return `Enter a multiple of ${formatNumber(step)}.`;
}

export function validateNumber(value: string, bounds: NumberBounds = {}): string | null {
  const text = value.trim();
  if (!isPlainNumber(text)) return INVALID_NUMBER;
  const number = Number(text);
  if (bounds.min !== undefined && number < bounds.min) return `Must be at least ${formatNumber(bounds.min)}.`;
  if (bounds.max !== undefined && number > bounds.max) return `Must be at most ${formatNumber(bounds.max)}.`;
  if (bounds.step !== undefined && !matchesStep(text, bounds.step)) return stepMessage(bounds.step);
  return null;
}

export function validateField(field: ConfigField, raw: string | null | undefined, values: ConfigValues = {}): string | null {
  const value = normalizeValue(field, raw);
  if (value === '') {
    if (isRequired(field)) return REQUIRED;
    return field.validate ? field.validate(value, values) : null;
  }
  if (field.input === 'number') {
    const problem = validateNumber(value, field);
    if (problem) return problem;
  }
  if (field.input === 'select' && !(field.options ?? []).some((option) => option.value === value)) {
    return 'Choose one of the listed options.';
  }
  return field.validate ? field.validate(value, values) : null;
}

export function validateConfig(sections: ConfigSection[], baseline: ConfigValues, draft: ConfigValues): Record<string, string> {
  const values = normalizeValues(sections, draft);
  const errors: Record<string, string> = {};
  for (const { field } of configFields(sections)) {
    if (normalizeValue(field, baseline[field.key]) === values[field.key]) continue;
    const problem = validateField(field, draft[field.key], values);
    if (problem) errors[field.key] = problem;
  }
  return errors;
}

export function firstErrorKey(sections: ConfigSection[], errors: Record<string, string>): string | null {
  for (const { field } of configFields(sections)) {
    if (errors[field.key]) return field.key;
  }
  return null;
}

export function notAbove(otherKey: string, otherLabel: string): ConfigValidator {
  return (value, values) => {
    const other = values[otherKey];
    if (other === undefined || !isPlainNumber(other) || !isPlainNumber(value)) return null;
    return Number(value) > Number(other)
      ? `Must not be more than ${otherLabel} (${formatNumber(Number(other))}).`
      : null;
  };
}

export function notBelow(otherKey: string, otherLabel: string): ConfigValidator {
  return (value, values) => {
    const other = values[otherKey];
    if (other === undefined || !isPlainNumber(other) || !isPlainNumber(value)) return null;
    return Number(value) < Number(other)
      ? `Must not be less than ${otherLabel} (${formatNumber(Number(other))}).`
      : null;
  };
}

export function validateNumberList(value: string, options: NumberListOptions = {}): string | null {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.every((part) => part === '')) return 'Enter at least one value.';
  const seen = new Set<number>();
  for (const part of parts) {
    if (part === '') return 'Remove the empty entry. Look for a doubled or trailing comma.';
    if (/\s/.test(part)) return 'Separate each value with a comma.';
    if (!isPlainNumber(part)) return `“${part}” is not a number.`;
    const number = Number(part);
    if (options.integer && !Number.isInteger(number)) return `“${part}” is not a whole number.`;
    if (options.min !== undefined && number < options.min) {
      return `“${part}” is below the minimum of ${formatNumber(options.min)}.`;
    }
    if (options.max !== undefined && number > options.max) {
      return `“${part}” is above the maximum of ${formatNumber(options.max)}.`;
    }
    if (seen.has(number)) return `“${part}” is listed more than once.`;
    seen.add(number);
  }
  return null;
}

export function validateIpv4List(value: string): string | null {
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const part of parts) {
    if (/\s/.test(part)) return 'Separate each address with a comma.';
    if (!IPV4_PATTERN.test(part)) return `“${part}” is not a valid IPv4 address.`;
    if (seen.has(part)) return `“${part}” is listed more than once.`;
    seen.add(part);
  }
  return null;
}

export function validateTimeZone(value: string): string | null {
  if (value.length > 64) return 'Use 64 characters or fewer.';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions();
    return null;
  } catch {
    return `“${value}” is not a recognised IANA time zone. Use a name like Africa/Lagos.`;
  }
}

export function parseConfigResponse(body: unknown): ConfigValues | null {
  if (!body || typeof body !== 'object') return null;
  const config = (body as { config?: unknown }).config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const values: ConfigValues = {};
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (typeof value === 'string') values[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') values[key] = String(value);
    else if (value === null) values[key] = '';
  }
  return values;
}

export function readErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  for (const key of ['error', 'message']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function requestIdFrom(body: unknown, header: string | null): string | null {
  if (body && typeof body === 'object') {
    const value = (body as Record<string, unknown>).request_id;
    if (typeof value === 'string' && value) return value;
  }
  return header || null;
}

export function describeLoadFailure(
  status: number | null,
  body: unknown,
  requestId: string | null,
  timedOut = false,
): LoadFailure {
  if (status === null) {
    return {
      kind: 'network',
      message: timedOut
        ? 'The server took too long to respond. Try again in a moment.'
        : 'Could not reach the server. Check your connection and try again.',
      detail: null,
      requestId,
    };
  }
  if (status === 401) {
    return {
      kind: 'session',
      message: 'Your session has expired. Sign in again to load these settings.',
      detail: null,
      requestId,
    };
  }
  if (status === 403) {
    return {
      kind: 'forbidden',
      message: 'You do not have permission to view these settings.',
      detail: null,
      requestId,
    };
  }
  const server = readErrorMessage(body);
  return {
    kind: 'server',
    message: 'The server could not load these settings. Try again in a moment.',
    detail: server ? `HTTP ${status}: ${server}` : `HTTP ${status}`,
    requestId,
  };
}

export function humanizeServerMessage(message: string, sections: ConfigSection[]): string {
  const labels = changeLabels(sections);
  const keys = Object.keys(labels).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return message;
  const pattern = new RegExp(`\\b(?:${keys.map((key) => key.replace(REGEXP_SPECIALS, '\\$&')).join('|')})\\b`, 'g');
  return message.replace(pattern, (key) => labels[key] ?? key);
}

export function describeSaveFailure(status: number, body: unknown, sections: ConfigSection[]): string {
  if (status === 401) return 'Your session has expired. Sign in again, then apply them again.';
  if (status === 403) return 'You do not have permission to change these settings.';
  const server = readErrorMessage(body);
  if (!server) return `The server returned an error (HTTP ${status}).`;
  const text = humanizeServerMessage(server, sections);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function guardedPath(href: string, current: string): string | null {
  let here: URL;
  let target: URL;
  try {
    here = new URL(current);
    target = new URL(href, here);
  } catch {
    return null;
  }
  if (target.origin !== here.origin) return null;
  if (target.pathname === here.pathname && target.search === here.search) return null;
  return `${target.pathname}${target.search}${target.hash}`;
}

function deadline(timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const state = { timedOut: false };
  const abort = () => controller.abort();
  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort);
  const release = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  };
  return { signal: controller.signal, state, release };
}

export async function fetchConfig(
  endpoint: string,
  signal?: AbortSignal,
  timeoutMs = LOAD_TIMEOUT_MS,
): Promise<FetchConfigResult> {
  const limit = deadline(timeoutMs, signal);
  try {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: limit.signal,
      });
    } catch {
      return { ok: false, failure: describeLoadFailure(null, null, null, limit.state.timedOut) };
    }
    const body: unknown = await response.json().catch(() => null);
    const requestId = requestIdFrom(body, response.headers.get('x-request-id'));
    if (limit.state.timedOut) return { ok: false, failure: describeLoadFailure(null, null, requestId, true) };
    if (!response.ok) return { ok: false, failure: describeLoadFailure(response.status, body, requestId) };
    const values = parseConfigResponse(body);
    if (!values) {
      return { ok: false, failure: { kind: 'invalid', message: INVALID_RESPONSE, detail: null, requestId } };
    }
    return { ok: true, values };
  } finally {
    limit.release();
  }
}

export async function sendConfigChanges(
  endpoint: string,
  payload: ConfigPayload,
  timeoutMs = SAVE_TIMEOUT_MS,
): Promise<SaveResult> {
  const limit = deadline(timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: limit.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    return { status: null, body: null };
  } finally {
    limit.release();
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function savedMessage(count: number): string {
  return count === 1 ? 'Saved. 1 change is now live.' : `Saved. ${count} changes are now live.`;
}

function blurOnWheel(event: WheelEvent<HTMLInputElement>) {
  if (document.activeElement === event.currentTarget) event.currentTarget.blur();
}

function controlHeight(field: ConfigField): number {
  if (field.input === 'textarea') return 96;
  if (field.input === 'toggle') return 20;
  return 34;
}

function ValueText({ field, value, className }: { field: ConfigField; value: string; className: string }) {
  const empty = value === '' && field.input !== 'toggle';
  return (
    <span className={[className, empty ? s.emptyValue : isMono(field) && s.mono].filter(Boolean).join(' ')}>
      {displayValue(field, value)}
    </span>
  );
}

function DiffValue({ field, from, to }: { field: ConfigField; from: string; to: string }) {
  return (
    <span className={s.diff}>
      <span className={s.srOnly}>From </span>
      <ValueText field={field} value={from} className={s.diffFrom} />
      <span className={s.diffArrow} aria-hidden>→</span>
      <span className={s.srOnly}> to </span>
      <ValueText field={field} value={to} className={s.diffTo} />
    </span>
  );
}

function reviewOptions(title: string, pending: ConfigChange[], conflicts: ConfigConflict[]): ConfirmOptions {
  const count = pending.length;
  const consequences = [
    ...conflicts.map((conflict) => (
      `Someone else changed ${conflict.label} to ${displayValue(conflict.field, conflict.live)} after you opened this page. Applying replaces it.`
    )),
    ...pending.flatMap((change) => {
      const note = change.field.consequence?.(change.to, change.from);
      return note ? [note] : [];
    }),
  ];
  return {
    tone: 'danger',
    title: count === 1 ? `Apply 1 change to ${title}?` : `Apply ${count} changes to ${title}?`,
    message: 'The new values take effect as soon as you apply them, and the change is recorded in the audit log.',
    details: pending.map((change) => ({
      label: change.label,
      value: <DiffValue field={change.field} from={change.from} to={change.to} />,
    })),
    consequences: consequences.length ? consequences : undefined,
    confirmLabel: count === 1 ? 'Apply change' : `Apply ${count} changes`,
    cancelLabel: 'Keep editing',
  };
}

function ConfigSkeleton({ sections }: { sections: ConfigSection[] }) {
  return (
    <div aria-busy="true">
      <span className={s.srOnly} role="status">Loading settings…</span>
      {sections.map((section) => (
        <Card key={section.title} aria-hidden>
          <CardHeader title={section.title} subtitle={section.description} />
          <CardBody className={s.body}>
            <div className={s.grid}>
              {section.fields.map((field) => (
                <div
                  key={field.key}
                  className={[s.skeletonField, field.input === 'textarea' && s.wide].filter(Boolean).join(' ')}
                >
                  <Skeleton width="38%" height={11} />
                  <Skeleton
                    width={field.input === 'toggle' ? 36 : '100%'}
                    height={controlHeight(field)}
                    rounded={field.input === 'toggle'}
                  />
                  {field.hint ? <SkeletonLines rows={1} height={12} /> : null}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export function SectionHeading({ id, title, hint, actions }: { id?: string; title: string; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={s.sectionHead}>
      <div className={s.sectionTitles}>
        <h2 id={id} className={s.sectionTitle}>{title}</h2>
        {hint ? <p className={s.sectionHint}>{hint}</p> : null}
      </div>
      {actions ? <div className={s.sectionActions}>{actions}</div> : null}
    </div>
  );
}

export function ConfigForm({ title, subtitle, endpoint, sections }: ConfigFormProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const formRef = useRef<HTMLFormElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const loadControllerRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(false);
  const leavingRef = useRef(false);
  const leaveRef = useRef<(path: string) => void>(() => {});

  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [baseline, setBaseline] = useState<ConfigValues>({});
  const [draft, setDraft] = useState<ConfigValues>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [badInput, setBadInput] = useState<Record<string, boolean>>({});
  const [revealAll, setRevealAll] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const fieldId = useCallback((key: string) => `${baseId}-${key}`, [baseId]);

  const changes = useMemo(() => diffConfig(sections, baseline, draft), [sections, baseline, draft]);
  const changedKeys = useMemo(() => new Set(changes.map((change) => change.key)), [changes]);
  const errors = useMemo(() => {
    const found = validateConfig(sections, baseline, draft);
    for (const key of Object.keys(badInput)) {
      if (badInput[key]) found[key] = INVALID_NUMBER;
    }
    return found;
  }, [sections, baseline, draft, badInput]);
  const shownErrors = useMemo(() => {
    const shown: Record<string, string> = {};
    for (const [key, message] of Object.entries(errors)) {
      if (revealAll || touched[key]) shown[key] = message;
    }
    return shown;
  }, [errors, revealAll, touched]);

  const ready = loadState.status === 'ready';
  const busy = phase !== 'idle';
  const dirty = ready && changes.length > 0;
  const issueCount = Object.keys(shownErrors).length;

  const requestFocus = useCallback((key: string | null) => {
    setFocusRequest((previous) => ({ key, seq: (previous?.seq ?? 0) + 1 }));
  }, []);

  const resetInteraction = useCallback(() => {
    setTouched({});
    setBadInput({});
    setRevealAll(false);
  }, []);

  const load = useCallback(async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoadState((previous) => (previous.status === 'loading' ? previous : { status: 'loading' }));
    const result = await fetchConfig(endpoint, controller.signal);
    if (controller.signal.aborted) return;
    if (!result.ok) {
      setLoadState({ status: 'error', failure: result.failure });
      return;
    }
    setBaseline(result.values);
    setDraft(result.values);
    resetInteraction();
    setPhase('idle');
    setLoadState({ status: 'ready' });
  }, [endpoint, resetInteraction]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      loadControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    leaveRef.current = (path: string) => {
      const count = changes.length;
      void confirm({
        tone: 'danger',
        title: 'Leave without applying?',
        message: count === 1
          ? 'You have 1 unsaved change on this page. Leaving discards it.'
          : `You have ${count} unsaved changes on this page. Leaving discards them.`,
        confirmLabel: 'Discard and leave',
        cancelLabel: 'Keep editing',
      }).then((decision) => {
        if (!decision) return;
        leavingRef.current = true;
        router.push(path);
      });
    };
  });

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

  useLayoutEffect(() => {
    if (!dirty) return;
    const form = formRef.current;
    const bar = barRef.current;
    if (!form || !bar) return;
    const place = () => {
      const rect = form.getBoundingClientRect();
      bar.style.setProperty('--config-bar-left', `${Math.round(rect.left)}px`);
      bar.style.setProperty('--config-bar-width', `${Math.round(rect.width)}px`);
      form.style.setProperty('--config-bar-space', `${bar.offsetHeight}px`);
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(bar);
    for (let node: Element | null = form; node && node !== document.documentElement; node = node.parentElement) {
      observer?.observe(node);
    }
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      form.style.removeProperty('--config-bar-space');
    };
  }, [dirty]);

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.key) {
      const element = document.getElementById(fieldId(focusRequest.key));
      if (!element) return;
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'center' });
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    formRef.current?.focus({ preventScroll: true });
  }, [focusRequest, fieldId]);

  const setValue = useCallback((key: string, value: string, invalidInput = false) => {
    setDraft((previous) => (previous[key] === value ? previous : { ...previous, [key]: value }));
    setBadInput((previous) => (Boolean(previous[key]) === invalidInput ? previous : { ...previous, [key]: invalidInput }));
  }, []);

  const touch = useCallback((key: string) => {
    setTouched((previous) => (previous[key] ? previous : { ...previous, [key]: true }));
  }, []);

  const apply = async (pending: ConfigChange[], live: ConfigValues, local: ConfigValues) => {
    setPhase('saving');
    const sent = await sendConfigChanges(endpoint, buildPayload(pending, live));
    if (sent.status === 409) {
      const reason = describeSaveFailure(sent.status, sent.body, sections);
      const fresh = await fetchConfig(endpoint);
      if (!aliveRef.current) return;
      setPhase('idle');
      if (!fresh.ok) {
        toast.show(`Changes were not saved. ${reason} Reload the page to see the latest values.`, 'error');
        return;
      }
      const rebased = rebaseDraft(sections, live, local, fresh.values);
      setBaseline(fresh.values);
      setDraft(rebased.draft);
      toast.show(`Changes were not saved. ${reason} The latest values are loaded, so review your changes again.`, 'warning');
      return;
    }
    if (sent.status !== null && !isSuccess(sent.status)) {
      setPhase('idle');
      toast.show(`Changes were not saved. ${describeSaveFailure(sent.status, sent.body, sections)}`, 'error');
      return;
    }
    const latest = await fetchConfig(endpoint);
    if (sent.status !== null) {
      const next = latest.ok ? latest.values : applyChanges(live, pending);
      setBaseline(next);
      setDraft(next);
      resetInteraction();
      setPhase('idle');
      requestFocus(null);
      toast.show(savedMessage(pending.length), 'success');
      if (!latest.ok) {
        toast.show('Saved, but the latest values could not be reloaded. Refresh the page to confirm them.', 'warning');
      }
      return;
    }
    if (!latest.ok) {
      setPhase('idle');
      toast.show(
        'Could not reach the server, so the save could not be confirmed. Reload the page to check the live values before trying again.',
        'error',
      );
      return;
    }
    const rebased = rebaseDraft(sections, live, local, latest.values);
    const remaining = diffConfig(sections, latest.values, rebased.draft);
    setBaseline(latest.values);
    setDraft(rebased.draft);
    setPhase('idle');
    if (remaining.length === 0) {
      resetInteraction();
      requestFocus(null);
      toast.show(savedMessage(pending.length), 'success');
      return;
    }
    toast.show('Could not reach the server, so your changes were not saved. Try again.', 'error');
  };

  const review = async () => {
    if (!ready || busy || changes.length === 0) return;
    const invalid = firstErrorKey(sections, errors);
    if (invalid) {
      setRevealAll(true);
      requestFocus(invalid);
      return;
    }
    reviewRef.current?.focus({ preventScroll: true });
    setPhase('checking');
    const latest = await fetchConfig(endpoint);
    if (!aliveRef.current) return;
    if (!latest.ok) {
      setPhase('idle');
      toast.show(`Could not check the live values, so nothing was applied. ${latest.failure.message}`, 'error');
      return;
    }
    const rebased = rebaseDraft(sections, baseline, draft, latest.values);
    setBaseline(latest.values);
    setDraft(rebased.draft);
    const pending = diffConfig(sections, latest.values, rebased.draft);
    if (pending.length === 0) {
      setPhase('idle');
      resetInteraction();
      requestFocus(null);
      toast.show('These values are already live. Nothing needed to change.');
      return;
    }
    const stillInvalid = firstErrorKey(sections, validateConfig(sections, latest.values, rebased.draft));
    if (stillInvalid) {
      setPhase('idle');
      setRevealAll(true);
      requestFocus(stillInvalid);
      toast.show('Another admin changed these settings while you were editing. Check the highlighted field.', 'warning');
      return;
    }
    setPhase('confirming');
    const decision = await confirm(reviewOptions(title, pending, rebased.conflicts));
    if (!aliveRef.current) return;
    if (!decision) {
      setPhase('idle');
      return;
    }
    await apply(pending, latest.values, rebased.draft);
  };

  const discard = async () => {
    if (!dirty || busy) return;
    const count = changes.length;
    const decision = await confirm({
      title: count === 1 ? 'Discard 1 unsaved change?' : `Discard ${count} unsaved changes?`,
      message: 'The fields go back to their live values. Nothing has been applied, so nothing changes for users.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
    });
    if (!decision || !aliveRef.current) return;
    setDraft(baseline);
    resetInteraction();
    requestFocus(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void review();
  };

  const renderControl = (field: ConfigField, id: string, value: string, invalid: boolean) => {
    const required = isRequired(field) || undefined;
    const mono = isMono(field);
    const onBlur = () => touch(field.key);
    switch (field.input) {
      case 'number':
        return (
          <Input
            id={id}
            type="number"
            inputMode={field.step !== undefined && Number.isInteger(field.step) ? 'numeric' : 'decimal'}
            min={field.min}
            max={field.max}
            step={field.step ?? 'any'}
            mono={mono}
            value={value}
            placeholder={field.placeholder}
            autoComplete="off"
            aria-required={required}
            onWheel={blurOnWheel}
            onBlur={onBlur}
            onChange={(event) => setValue(field.key, event.target.value, event.target.validity.badInput)}
          />
        );
      case 'textarea':
        return (
          <Textarea
            id={id}
            rows={3}
            mono={mono}
            value={value}
            placeholder={field.placeholder}
            spellCheck={mono ? false : undefined}
            autoCapitalize={mono ? 'off' : undefined}
            aria-required={required}
            onBlur={onBlur}
            onChange={(event) => setValue(field.key, event.target.value)}
          />
        );
      case 'select': {
        const known = (field.options ?? []).some((option) => option.value === value);
        return (
          <Select
            id={id}
            value={value}
            aria-required={required}
            onBlur={onBlur}
            onChange={(event) => {
              setValue(field.key, event.target.value);
              touch(field.key);
            }}
          >
            {known ? null : <option value={value}>{value === '' ? 'Not set' : value}</option>}
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        );
      }
      case 'toggle': {
        const on = isOn(value);
        return (
          <span className={s.toggleRow}>
            <Toggle
              id={id}
              checked={on}
              disabled={busy}
              aria-describedby={invalid || field.hint ? `${id}-msg` : undefined}
              aria-invalid={invalid || undefined}
              onBlur={onBlur}
              onChange={(next) => {
                setValue(field.key, next ? 'true' : 'false');
                touch(field.key);
              }}
            />
            <span className={s.toggleState} aria-hidden>{displayValue(field, on ? 'true' : 'false')}</span>
          </span>
        );
      }
      default:
        return (
          <Input
            id={id}
            type="text"
            mono={mono}
            value={value}
            placeholder={field.placeholder}
            autoComplete="off"
            spellCheck={mono ? false : undefined}
            autoCapitalize={mono ? 'off' : undefined}
            aria-required={required}
            onBlur={onBlur}
            onChange={(event) => setValue(field.key, event.target.value)}
          />
        );
    }
  };

  const renderField = (field: ConfigField) => {
    const id = fieldId(field.key);
    const error = shownErrors[field.key];
    const modified = changedKeys.has(field.key) || Boolean(badInput[field.key]);
    return (
      <FieldShell
        key={field.key}
        htmlFor={id}
        label={(
          <>
            {field.label}
            {modified ? (
              <span className={s.modified}>
                <span className={s.modifiedDot} aria-hidden />
                Unsaved
              </span>
            ) : null}
          </>
        )}
        help={field.hint}
        error={error}
        className={field.input === 'textarea' ? s.wide : undefined}
      >
        {renderControl(field, id, draft[field.key] ?? '', Boolean(error))}
      </FieldShell>
    );
  };

  const statusText = phase === 'checking'
    ? 'Checking the live values…'
    : phase === 'saving'
      ? `Applying ${plural(changes.length, 'change')}…`
      : plural(changes.length, 'unsaved change');
  const reviewLabel = phase === 'checking' ? 'Checking…' : phase === 'saving' ? 'Applying…' : 'Review changes';
  const working = phase === 'checking' || phase === 'saving';

  return (
    <div className={s.root}>
      <SectionHeading id={titleId} title={title} hint={subtitle} />

      {loadState.status === 'loading' ? (
        <ConfigSkeleton sections={sections} />
      ) : loadState.status === 'error' ? (
        <Card>
          {loadState.failure.kind === 'forbidden' ? (
            <AccessDenied title="You do not have access to these settings" />
          ) : (
            <ErrorState
              compact
              title="These settings could not be loaded"
              message={loadState.failure.message}
              detail={loadState.failure.detail}
              requestId={loadState.failure.requestId}
              onRetry={() => void load()}
            />
          )}
        </Card>
      ) : (
        <form
          ref={formRef}
          className={[s.form, dirty && s.formWithBar].filter(Boolean).join(' ')}
          noValidate
          tabIndex={-1}
          aria-labelledby={titleId}
          aria-busy={busy || undefined}
          onSubmit={onSubmit}
        >
          <fieldset className={s.fieldset} disabled={busy}>
            {sections.map((section, index) => {
              const headingId = `${baseId}-section-${index}`;
              return (
                <Card key={section.title} role="group" aria-labelledby={headingId}>
                  <CardHeader
                    title={<h2 id={headingId} className={s.sectionHeading}>{section.title}</h2>}
                    subtitle={section.description}
                  />
                  <CardBody className={s.body}>
                    <div className={s.grid}>{section.fields.map(renderField)}</div>
                  </CardBody>
                </Card>
              );
            })}
          </fieldset>

          {dirty ? (
            <div ref={barRef} className={s.bar} role="region" aria-label="Unsaved changes">
              <p className={s.barStatus} role="status">
                <span className={s.barDot} aria-hidden />
                <span>{statusText}</span>
                {issueCount && !working ? (
                  <span className={s.barIssues}>{plural(issueCount, 'field')} to fix</span>
                ) : null}
              </p>
              <div className={s.barActions}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-disabled={busy || undefined}
                  onClick={() => void discard()}
                >
                  Discard
                </Button>
                <Button
                  ref={reviewRef}
                  type="submit"
                  variant="primary"
                  aria-disabled={busy || undefined}
                  aria-busy={working || undefined}
                  leftIcon={working ? <span className={s.spinner} /> : undefined}
                >
                  {reviewLabel}
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      )}
    </div>
  );
}
