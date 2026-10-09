import type { ApiBody, ApiResult } from '../../../lib/apiClient';
import { formatNaira } from '../../../_ui/money';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '../../../lib/uploadTypes';
import {
  LEVEL_AMOUNT_MAX, amountTextProblem, formatCount, formatUsd, isLargeMove, isRecord, parseAmountText, plural,
  sameAmount, sameTierValue, tierNameProblem, tierValues, toAmount,
  type StoredTier, type TierKey, type TierResultStatus, type TierValues,
} from '../rewardRules';
import type { NoticeItem, PageNotice, ToastNote } from '../model';

export const LEVELS_ENDPOINT = '/api/levels';
export const UPLOAD_ENDPOINT = '/api/levels/upload';
export const BADGE_EXTENSIONS: readonly string[] = Object.keys(ALLOWED_IMAGE_TYPES);
export const BADGE_ACCEPT = BADGE_EXTENSIONS.map((ext) => `.${ext}`).join(',');
export const BADGE_MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

export interface Tier {
  id: string;
  order: number;
  values: TierValues;
  claims: number | null;
}

export interface TierSnapshot {
  tiers: Tier[];
  byId: Readonly<Record<string, Tier>>;
}

export type TierField = 'name' | 'target' | 'bonus' | 'active' | 'badge';

export const TIER_FIELDS: readonly TierField[] = ['name', 'target', 'bonus', 'active', 'badge'];

export const TIER_FIELD_KEYS: Readonly<Record<TierField, TierKey>> = {
  name: 'name',
  target: 'target_usd',
  bonus: 'bonus_naira',
  active: 'is_active',
  badge: 'badge_url',
};

export const TIER_FIELD_LABELS: Readonly<Record<TierField, string>> = {
  name: 'Name',
  target: 'Trade target',
  bonus: 'Bonus',
  active: 'Status',
  badge: 'Badge',
};

export interface TierEntry {
  name: string;
  target: string;
  bonus: string;
  active: boolean;
  badge: string | null;
  base: TierValues;
  title: string;
  conflict: Partial<TierValues> | null;
  failure: string | null;
}

export type TierDraft = Readonly<Record<string, TierEntry>>;

export const EMPTY_TIER_DRAFT: TierDraft = Object.freeze({});

export type TierEditable = Pick<TierEntry, 'name' | 'target' | 'bonus' | 'active' | 'badge'>;

export interface TierFieldChange {
  field: TierField;
  key: TierKey;
  label: string;
  from: TierValues[TierKey];
  to: TierValues[TierKey];
}

export interface TierChange {
  id: string;
  tier: Tier;
  title: string;
  fields: TierFieldChange[];
  conflict: Partial<TierValues> | null;
}

export interface TierReview {
  changes: TierChange[];
  errors: Readonly<Record<string, string>>;
  first: { id: string; field: TierField } | null;
}

export const EMPTY_TIER_REVIEW: TierReview = Object.freeze({ changes: [], errors: Object.freeze({}), first: null });

function count(value: unknown): number | null {
  const amount = toAmount(value);
  return amount === null || amount < 0 ? null : Math.round(amount);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function amountText(value: number | null): string {
  return value === null ? '' : String(value);
}

export function tierTitle(tier: Pick<Tier, 'order' | 'values'>): string {
  return tier.values.name ? `Tier ${tier.order} · ${tier.values.name}` : `Tier ${tier.order}`;
}

export function toTierSnapshot(body: ApiBody): TierSnapshot | null {
  if (!Array.isArray(body.tiers)) return null;
  const tiers: Tier[] = [];
  for (const raw of body.tiers) {
    if (!isRecord(raw)) continue;
    const id = text(raw.id);
    if (!id) continue;
    tiers.push({
      id,
      order: count(raw.tier_order) ?? 0,
      values: tierValues(raw as StoredTier),
      claims: raw.claims_counted === false ? null : count(raw.claims),
    });
  }
  tiers.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { tiers, byId: Object.fromEntries(tiers.map((tier) => [tier.id, tier])) };
}

export function fieldValueText(field: TierField, value: unknown): string {
  switch (field) {
    case 'target': {
      const amount = toAmount(value);
      return amount === null ? 'Not set' : formatUsd(amount);
    }
    case 'bonus': {
      const amount = toAmount(value);
      return amount === null ? 'Not set' : formatNaira(amount);
    }
    case 'active':
      return value === true ? 'Active' : 'Off';
    case 'badge':
      return typeof value === 'string' && value ? 'Badge image' : 'No badge';
    default:
      return typeof value === 'string' && value.trim() ? value.trim() : 'Not set';
  }
}

export function startEntry(tier: Tier): TierEntry {
  return {
    name: tier.values.name,
    target: amountText(tier.values.target_usd),
    bonus: amountText(tier.values.bonus_naira),
    active: tier.values.is_active,
    badge: tier.values.badge_url,
    base: tier.values,
    title: tierTitle(tier),
    conflict: null,
    failure: null,
  };
}

function amountTouched(textValue: string, base: number | null): boolean {
  const parsed = parseAmountText(textValue);
  if (parsed === null) return textValue.trim() !== amountText(base);
  return !sameAmount(parsed, base);
}

export function fieldTouched(entry: TierEntry, field: TierField): boolean {
  switch (field) {
    case 'name':
      return entry.name.trim() !== entry.base.name;
    case 'target':
      return amountTouched(entry.target, entry.base.target_usd);
    case 'bonus':
      return amountTouched(entry.bonus, entry.base.bonus_naira);
    case 'active':
      return entry.active !== entry.base.is_active;
    case 'badge':
      return entry.badge !== entry.base.badge_url;
  }
}

export function touchedFields(entry: TierEntry | undefined): TierField[] {
  return entry ? TIER_FIELDS.filter((field) => fieldTouched(entry, field)) : [];
}

function isPristine(entry: TierEntry): boolean {
  return entry.name === entry.base.name
    && entry.target === amountText(entry.base.target_usd)
    && entry.bonus === amountText(entry.base.bonus_naira)
    && entry.active === entry.base.is_active
    && entry.badge === entry.base.badge_url
    && entry.failure === null;
}

function without(draft: TierDraft, ids: Iterable<string>): TierDraft {
  const drop = new Set(ids);
  let removed = false;
  const next: Record<string, TierEntry> = {};
  for (const [id, entry] of Object.entries(draft)) {
    if (drop.has(id)) removed = true;
    else next[id] = entry;
  }
  return removed ? next : draft;
}

export function editTier(draft: TierDraft, tier: Tier, patch: Partial<TierEditable>): TierDraft {
  const entry = draft[tier.id] ?? startEntry(tier);
  const next: TierEntry = { ...entry, ...patch, failure: null };
  if (isPristine(next)) return without(draft, [tier.id]);
  return { ...draft, [tier.id]: next };
}

export function revertTier(draft: TierDraft, id: string): TierDraft {
  return without(draft, [id]);
}

export function tierDraftCount(draft: TierDraft): number {
  return Object.values(draft).reduce((total, entry) => total + touchedFields(entry).length, 0);
}

export function fieldProblem(entry: TierEntry, field: TierField): string | null {
  if (!fieldTouched(entry, field)) return null;
  switch (field) {
    case 'name':
      return tierNameProblem(entry.name);
    case 'target':
      return amountTextProblem(entry.target, { noun: 'a trade target', max: LEVEL_AMOUNT_MAX });
    case 'bonus':
      return amountTextProblem(entry.bonus, { noun: 'a bonus amount', max: LEVEL_AMOUNT_MAX });
    default:
      return null;
  }
}

export function errorKey(id: string, field: TierField): string {
  return `${id}:${field}`;
}

export function fieldInputId(id: string, field: TierField): string {
  return `tier-${id}-${field}`;
}

function parsedValue(entry: TierEntry, field: TierField): TierValues[TierKey] {
  switch (field) {
    case 'name':
      return entry.name.trim();
    case 'target':
      return parseAmountText(entry.target);
    case 'bonus':
      return parseAmountText(entry.bonus);
    case 'active':
      return entry.active;
    case 'badge':
      return entry.badge;
  }
}

export function reviewTiers(snapshot: TierSnapshot, draft: TierDraft): TierReview {
  const changes: TierChange[] = [];
  const errors: Record<string, string> = {};
  let first: TierReview['first'] = null;
  for (const tier of snapshot.tiers) {
    const entry = draft[tier.id];
    const fields = touchedFields(entry);
    if (!entry || fields.length === 0) continue;
    let broken = false;
    for (const field of fields) {
      const problem = fieldProblem(entry, field);
      if (!problem) continue;
      errors[errorKey(tier.id, field)] = problem;
      if (first === null) first = { id: tier.id, field };
      broken = true;
    }
    if (broken) continue;
    changes.push({
      id: tier.id,
      tier,
      title: tierTitle(tier),
      fields: fields.map((field) => ({
        field,
        key: TIER_FIELD_KEYS[field],
        label: TIER_FIELD_LABELS[field],
        from: entry.base[TIER_FIELD_KEYS[field]],
        to: parsedValue(entry, field),
      })),
      conflict: entry.conflict,
    });
  }
  return { changes, errors, first };
}

export interface TierRebaseNote {
  id: string;
  title: string;
}

export interface TierRebaseConflict extends TierRebaseNote {
  fields: TierField[];
  live: TierValues;
}

export interface TierRebase {
  draft: TierDraft;
  conflicts: TierRebaseConflict[];
  dropped: TierRebaseNote[];
  alreadyLive: TierRebaseNote[];
}

export function rebaseTiers(draft: TierDraft, snapshot: TierSnapshot): TierRebase {
  const next: Record<string, TierEntry> = {};
  const conflicts: TierRebaseConflict[] = [];
  const dropped: TierRebaseNote[] = [];
  const alreadyLive: TierRebaseNote[] = [];
  for (const [id, entry] of Object.entries(draft)) {
    const tier = snapshot.byId[id];
    if (!tier) {
      dropped.push({ id, title: entry.title });
      continue;
    }
    const live = tier.values;
    const touched = touchedFields(entry);
    const moved = touched.filter((field) => !sameTierValue(TIER_FIELD_KEYS[field], live[TIER_FIELD_KEYS[field]], entry.base[TIER_FIELD_KEYS[field]]));
    const rebased: TierEntry = {
      name: touched.includes('name') ? entry.name : live.name,
      target: touched.includes('target') ? entry.target : amountText(live.target_usd),
      bonus: touched.includes('bonus') ? entry.bonus : amountText(live.bonus_naira),
      active: touched.includes('active') ? entry.active : live.is_active,
      badge: touched.includes('badge') ? entry.badge : live.badge_url,
      base: live,
      title: tierTitle(tier),
      conflict: null,
      failure: entry.failure,
    };
    if (touchedFields(rebased).length === 0) {
      if (touched.length > 0) alreadyLive.push({ id, title: rebased.title });
      continue;
    }
    if (moved.length > 0) {
      const conflict: Partial<TierValues> = {};
      for (const field of moved) {
        const key = TIER_FIELD_KEYS[field];
        (conflict as Record<string, unknown>)[key] = live[key];
      }
      next[id] = { ...rebased, conflict };
      conflicts.push({ id, title: rebased.title, fields: moved, live });
    } else {
      next[id] = { ...rebased, conflict: entry.conflict };
    }
  }
  return { draft: next, conflicts, dropped, alreadyLive };
}

export function rebaseTiersNotice(result: TierRebase, includeConflicts: boolean): PageNotice | null {
  const items: NoticeItem[] = [
    ...(includeConflicts
      ? result.conflicts.map((conflict) => ({
          id: conflict.id,
          title: conflict.title,
          detail: `Someone else changed ${conflict.fields.map((field) => `${TIER_FIELD_LABELS[field].toLowerCase()} to ${fieldValueText(field, conflict.live[TIER_FIELD_KEYS[field]])}`).join(' and ')}. Your values are kept; check them before saving.`,
        }))
      : []),
    ...result.dropped.map((note) => ({
      id: note.id,
      title: note.title,
      detail: 'This tier is no longer listed, so your change was discarded.',
    })),
    ...result.alreadyLive.map((note) => ({
      id: note.id,
      title: note.title,
      detail: 'Someone else already made this change, so there is nothing left to save.',
    })),
  ];
  if (items.length === 0) return null;
  return {
    tone: 'warning',
    title: items.length === 1 ? 'A tier changed while you were editing' : 'Tiers changed while you were editing',
    message: 'The live tiers were reloaded. Your other unsaved changes are kept.',
    items,
  };
}

export function tierPayload(changes: readonly TierChange[]) {
  return {
    changes: changes.map((change) => {
      const values: Record<string, unknown> = {};
      const expected: Record<string, unknown> = {};
      for (const field of change.fields) {
        values[field.key] = field.to;
        expected[field.key] = field.from;
      }
      return { id: change.id, ...values, expected };
    }),
  };
}

export interface TierRowResult {
  id: string;
  status: TierResultStatus;
  values: TierValues | null;
}

export interface TierSaveResponse {
  results: TierRowResult[];
  warning: string | null;
}

const STATUSES: ReadonlySet<string> = new Set(['saved', 'unchanged', 'conflict', 'missing', 'error']);

export function toTierResults(value: unknown): TierRowResult[] | null {
  if (!Array.isArray(value)) return null;
  const results: TierRowResult[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const id = text(item.id);
    const status = item.status;
    if (!id || typeof status !== 'string' || !STATUSES.has(status)) return null;
    results.push({
      id,
      status: status as TierResultStatus,
      values: isRecord(item.tier) ? tierValues(item.tier as StoredTier) : null,
    });
  }
  return results;
}

export function toTierSaveResponse(body: ApiBody): TierSaveResponse {
  return {
    results: toTierResults(body.results) ?? [],
    warning: body.audit_recorded === false ? text(body.warning) ?? 'Saved, but the change could not be written to the audit log.' : null,
  };
}

export type TierSaveOutcome =
  | { kind: 'saved'; results: TierRowResult[]; warning: string | null }
  | { kind: 'partial'; results: TierRowResult[]; message: string; warning: string | null }
  | { kind: 'unknown'; message: string }
  | { kind: 'refused'; status: number | null; message: string }
  | { kind: 'expired' }
  | { kind: 'retry'; message: string };

export function classifyTierSave(result: ApiResult<TierSaveResponse>): TierSaveOutcome {
  if (result.ok) return { kind: 'saved', results: result.data.results, warning: result.data.warning };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  if (failure.status === 403) return { kind: 'refused', status: 403, message: failure.message };
  const details = isRecord(failure.details) ? failure.details : null;
  const results = details ? toTierResults(details.results) : null;
  if (details && results && results.length > 0) {
    const warning = details.audit_recorded === false ? text(details.warning) : null;
    return { kind: 'partial', results, message: failure.message, warning };
  }
  return { kind: 'retry', message: failure.message };
}

export function failureReason(result: TierRowResult | undefined): string {
  if (!result) return 'No result came back for this change.';
  if (result.status === 'missing') return 'This tier no longer exists.';
  if (result.status === 'error') return 'The database did not accept this change.';
  if (result.status === 'conflict') return 'Someone else changed this tier before your save reached it.';
  return '';
}

export interface TierSettlement {
  draft: TierDraft;
  notice: PageNotice | null;
  toasts: ToastNote[];
  cleared: boolean;
}

function savedText(total: number): string {
  return total === 1 ? 'Saved 1 tier. Claims from now on use it.' : `Saved ${formatCount(total)} tiers. Claims from now on use them.`;
}

export function settleTierSave(
  draft: TierDraft,
  pending: readonly TierChange[],
  outcome: TierSaveOutcome,
  fresh: TierSnapshot | null,
): TierSettlement {
  const total = pending.length;
  switch (outcome.kind) {
    case 'saved': {
      const remaining = without(draft, pending.map((change) => change.id));
      const next = fresh ? rebaseTiers(remaining, fresh).draft : remaining;
      const toasts: ToastNote[] = [{ text: savedText(total), tone: 'success' }];
      if (outcome.warning) toasts.push({ text: outcome.warning, tone: 'warning' });
      if (!fresh) toasts.push({ text: 'The saved tiers could not be reloaded. Refresh to see them.', tone: 'warning' });
      return { draft: next, notice: null, toasts, cleared: tierDraftCount(next) === 0 };
    }
    case 'partial': {
      const byId = new Map(outcome.results.map((result) => [result.id, result]));
      const next: Record<string, TierEntry> = { ...draft };
      const failed: NoticeItem[] = [];
      let saved = 0;
      for (const change of pending) {
        const result = byId.get(change.id);
        if (result && (result.status === 'saved' || result.status === 'unchanged')) {
          delete next[change.id];
          saved += 1;
          continue;
        }
        const reason = failureReason(result);
        failed.push({ id: change.id, title: change.title, detail: reason });
        const entry = next[change.id];
        if (entry) next[change.id] = { ...entry, failure: reason };
      }
      return {
        draft: fresh ? rebaseTiers(next, fresh).draft : next,
        notice: {
          tone: 'danger',
          title: total === 1 ? 'The tier change was not saved' : `${formatCount(failed.length)} of ${plural(total, 'tier', 'tiers')} not saved`,
          message: saved > 0
            ? `${plural(saved, 'tier was', 'tiers were')} saved and ${saved === 1 ? 'is' : 'are'} live. The rest are still marked as unsaved below.`
            : 'Nothing was saved. Your changes are still marked as unsaved below.',
          items: failed,
        },
        toasts: outcome.warning
          ? [{ text: outcome.message, tone: 'error' }, { text: outcome.warning, tone: 'warning' }]
          : [{ text: outcome.message, tone: 'error' }],
        cleared: false,
      };
    }
    case 'unknown': {
      if (!fresh) {
        return {
          draft,
          notice: {
            tone: 'warning',
            title: 'The save could not be confirmed',
            message: `${outcome.message} Your changes are still marked as unsaved below until you check.`,
            items: [],
          },
          toasts: [{ text: 'The save could not be confirmed. Refresh the tiers before trying again.', tone: 'error' }],
          cleared: false,
        };
      }
      const rebased = rebaseTiers(draft, fresh);
      const ids = new Set(pending.map((change) => change.id));
      const live = rebased.alreadyLive.filter((note) => ids.has(note.id)).length;
      const remaining = pending.filter((change) => rebased.draft[change.id] !== undefined).length;
      const message = remaining === 0
        ? `No answer came back from the server, so the live tiers were checked: all ${plural(total, 'change is', 'changes are')} live.`
        : `No answer came back from the server, so the live tiers were checked: ${formatCount(live)} of ${plural(total, 'tier is', 'tiers are')} live and ${plural(remaining, 'is', 'are')} still marked as unsaved below.`;
      return {
        draft: rebased.draft,
        notice: { tone: 'warning', title: 'The save could not be confirmed', message, items: [] },
        toasts: remaining === 0
          ? [{ text: savedText(total), tone: 'success' }]
          : [{ text: 'Some tier changes may not have been saved. Check the notice above the tiers.', tone: 'warning' }],
        cleared: tierDraftCount(rebased.draft) === 0,
      };
    }
    case 'refused':
    case 'retry':
      return { draft, notice: null, toasts: [{ text: outcome.message, tone: 'error' }], cleared: false };
    case 'expired':
      return { draft, notice: null, toasts: [], cleared: false };
  }
}

export interface TierView {
  name: string;
  target: string;
  bonus: string;
  active: boolean;
  badge: string | null;
  base: TierValues;
  changed: TierField[];
  conflict: Partial<TierValues> | null;
  failure: string | null;
}

export function tierView(tier: Tier, entry: TierEntry | undefined): TierView {
  const source = entry ?? startEntry(tier);
  return {
    name: source.name,
    target: source.target,
    bonus: source.bonus,
    active: source.active,
    badge: source.badge,
    base: source.base,
    changed: touchedFields(entry),
    conflict: entry?.conflict ?? null,
    failure: entry?.failure ?? null,
  };
}

export interface ViewChange {
  field: TierField;
  label: string;
  from: string;
  to: string | null;
  large: boolean;
}

export function viewChanges(view: TierView): ViewChange[] {
  return view.changed.map((field) => {
    const key = TIER_FIELD_KEYS[field];
    const before = view.base[key];
    const after = field === 'name'
      ? view.name.trim()
      : field === 'target'
        ? parseAmountText(view.target)
        : field === 'bonus'
          ? parseAmountText(view.bonus)
          : field === 'active'
            ? view.active
            : view.badge;
    const amount = field === 'target' || field === 'bonus';
    return {
      field,
      label: TIER_FIELD_LABELS[field],
      from: fieldValueText(field, before),
      to: amount && after === null ? null : fieldValueText(field, after),
      large: amount && after !== null && isLargeMove(toAmount(before), toAmount(after)),
    };
  });
}

export function conflictText(view: TierView): string | null {
  if (!view.conflict) return null;
  const parts = TIER_FIELDS
    .filter((field) => TIER_FIELD_KEYS[field] in (view.conflict as Partial<TierValues>))
    .map((field) => `${TIER_FIELD_LABELS[field].toLowerCase()} to ${fieldValueText(field, (view.conflict as Partial<TierValues>)[TIER_FIELD_KEYS[field]])}`);
  return parts.length > 0 ? `Someone else changed the ${parts.join(' and ')} while you were editing.` : null;
}

export function badgeFileProblem(fileName: string, size: number): string | null {
  const ext = fileName.includes('.') ? (fileName.split('.').pop() || '').toLowerCase() : '';
  if (!BADGE_EXTENSIONS.includes(ext)) return `Choose a ${BADGE_EXTENSIONS.join(', ')} image.`;
  if (size > MAX_UPLOAD_BYTES) return `Badges can be at most ${BADGE_MAX_MB} MB.`;
  return null;
}

export interface UploadReceipt {
  url: string;
  warning: string | null;
}

export function toUploadReceipt(body: ApiBody): UploadReceipt | null {
  const url = text(body.url);
  if (!url) return null;
  return {
    url,
    warning: body.audit_recorded === false ? text(body.warning) ?? 'The badge was uploaded, but the upload could not be written to the audit log.' : null,
  };
}
