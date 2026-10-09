import type { ApiBody, ApiResult } from '../../lib/apiClient';
import type { ToastTone } from '../../_ui';
import { formatNaira } from '../../_ui/money';
import { formatBusinessDate } from '../../lib/time';
import {
  GIFTBOX_DESCRIPTION_MAX, GIFTBOX_FIELDS, GIFTBOX_NOTE_MAX, GIFTBOX_REWARD_MAX, GIFTBOX_TITLE_MAX, RULES_MAX,
  SIGNUP_BONUS_MAX,
  amountTextProblem, checkRule, countryCodeWarning, describeRule, formatCount, giftboxValues, isDateKey, isHugeMove,
  isLargeMove, isRecord, parseAmountText, plural, ruleImpact, ruleSpec, ruleType, rulesImpact, rulesList,
  sameAmount, sameGiftboxValue, sameRules, splitList, textOrNull, toAmount,
  type GiftboxField, type GiftboxValues, type RuleImpactLevel, type RuleSpec, type StoredGiftbox,
} from './rewardRules';

export const STATS_ENDPOINT = '/api/bonuses';
export const GIFTBOX_ENDPOINT = '/api/giftbox';
export const SETTINGS_ENDPOINT = '/api/app-config';
export const LEVELS_PATH = '/bonuses-rewards/levels';

export type SettingKey = 'signup_bonus_active' | 'signup_bonus_amount' | 'signup_bonus_condition' | 'levels_active';

export const SETTING_KEYS: readonly SettingKey[] = [
  'signup_bonus_active', 'signup_bonus_amount', 'signup_bonus_condition', 'levels_active',
];

export const SETTINGS_QUERY = { keys: SETTING_KEYS.join(',') };

export const SETTING_LABELS: Readonly<Record<SettingKey, string>> = {
  signup_bonus_active: 'Signup bonus',
  signup_bonus_amount: 'Signup bonus amount',
  signup_bonus_condition: 'When users can claim the signup bonus',
  levels_active: 'Levels programme',
};

export type SignupCondition = 'first_trade' | 'click_activate';

export interface SignupConditionOption {
  value: SignupCondition;
  label: string;
  description: string;
}

export const SIGNUP_CONDITIONS: readonly SignupConditionOption[] = [
  {
    value: 'first_trade',
    label: 'After their first approved trade',
    description: 'The claim unlocks once one of their card trades is approved.',
  },
  {
    value: 'click_activate',
    label: 'Straight away',
    description: 'New users can claim as soon as they sign up, with no trade needed.',
  },
];

export interface NoticeItem {
  id: string;
  title: string;
  detail: string;
}

export interface PageNotice {
  tone: 'warning' | 'danger';
  title: string;
  message: string;
  items: NoticeItem[];
}

export interface ToastNote {
  text: string;
  tone: ToastTone;
}

export type Phase = 'idle' | 'checking' | 'confirming' | 'saving';

function count(value: unknown): number | null {
  const amount = toAmount(value);
  return amount === null || amount < 0 ? null : Math.round(amount);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function formatDay(key: string | null): string {
  if (!key || !isDateKey(key)) return '—';
  return formatBusinessDate(`${key}T12:00:00Z`);
}

export function isSignupCondition(value: unknown): value is SignupCondition {
  return value === 'first_trade' || value === 'click_activate';
}

export function conditionText(value: string | null): string {
  const option = SIGNUP_CONDITIONS.find((item) => item.value === value);
  if (option) return option.label;
  if (!value) return 'Not set';
  return `“${value}”, which is not enforced, so users can claim straight away`;
}

export interface RewardStats {
  levelClaimsToday: number | null;
  activeTiers: number | null;
  signupToday: number | null;
  signupTotal: number | null;
}

export function toRewardStats(body: ApiBody): RewardStats | null {
  const stats = body.stats;
  if (!isRecord(stats)) return null;
  const missing = new Set(
    Array.isArray(body.unavailable) ? body.unavailable.filter((key): key is string => typeof key === 'string') : [],
  );
  const read = (key: string) => (missing.has(key) ? null : count(stats[key]));
  return {
    levelClaimsToday: read('level_claims_today'),
    activeTiers: read('level_tier_count'),
    signupToday: read('signup_awarded_today'),
    signupTotal: read('signup_awarded_total'),
  };
}

export interface GiftboxItem {
  id: string;
  title: string;
  description: string | null;
  reward: number | null;
  expiry: string | null;
  note: string | null;
  rules: unknown[];
  active: boolean;
  claims: number | null;
  values: GiftboxValues;
}

export function toGiftboxItem(value: unknown): GiftboxItem | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  if (!id) return null;
  const values = giftboxValues(value as StoredGiftbox);
  return {
    id,
    title: values.title ?? 'Untitled gift box',
    description: values.description,
    reward: values.reward_naira,
    expiry: values.expiry_date,
    note: values.eligibility_condition,
    rules: values.eligibility_rules,
    active: values.is_active,
    claims: value.claims_counted === false ? null : count(value.claims),
    values,
  };
}

export function toGiftboxList(body: ApiBody): GiftboxItem[] | null {
  if (!Array.isArray(body.items)) return null;
  return body.items.map(toGiftboxItem).filter((item): item is GiftboxItem => item !== null);
}

export type GiftboxStatusKind = 'live' | 'off' | 'ended' | 'hidden' | 'failing';

export interface GiftboxStatus {
  kind: GiftboxStatusKind;
  label: string;
  tone: 'success' | 'neutral' | 'warning' | 'danger';
  hint: string | null;
}

export function giftboxStatus(item: Pick<GiftboxItem, 'active' | 'expiry' | 'rules'>, today: string): GiftboxStatus {
  if (!item.active) {
    return { kind: 'off', label: 'Off', tone: 'neutral', hint: 'Switched off, so users cannot see or claim it.' };
  }
  if (rulesImpact(item.rules) === 'blocking') {
    return {
      kind: 'failing',
      label: 'Claims fail',
      tone: 'danger',
      hint: 'One of its rules stops every claim. Edit the rules to fix it.',
    };
  }
  if (item.expiry === null) {
    return {
      kind: 'hidden',
      label: 'Not shown in app',
      tone: 'warning',
      hint: 'The app only lists gift boxes that have an end date, so users cannot see this one.',
    };
  }
  if (item.expiry < today) {
    return {
      kind: 'ended',
      label: 'Ended',
      tone: 'warning',
      hint: `Its end date, ${formatDay(item.expiry)}, has passed, so users cannot claim it.`,
    };
  }
  return { kind: 'live', label: 'Live', tone: 'success', hint: null };
}

export interface RulesSummary {
  text: string;
  more: number;
  impact: RuleImpactLevel;
}

export function rulesSummary(rules: readonly unknown[]): RulesSummary {
  if (rules.length === 0) return { text: 'Every user, once', more: 0, impact: 'ok' };
  return { text: describeRule(rules[0]), more: rules.length - 1, impact: rulesImpact(rules) };
}

export function rulesText(rules: readonly unknown[]): string[] {
  return rules.length === 0 ? ['Every user can claim it once'] : rules.map((rule) => describeRule(rule));
}

export interface SettingsSnapshot {
  values: Readonly<Record<SettingKey, string | null>>;
}

export function toSettingsSnapshot(body: ApiBody): SettingsSnapshot | null {
  const config = body.config;
  if (!isRecord(config)) return null;
  const values = {} as Record<SettingKey, string | null>;
  for (const key of SETTING_KEYS) {
    const raw = config[key];
    values[key] = typeof raw === 'string'
      ? raw
      : typeof raw === 'number' || typeof raw === 'boolean'
        ? String(raw)
        : null;
  }
  return { values };
}

export interface SettingEntry {
  value: string;
  base: string | null;
  conflict: boolean;
}

export type SettingsDraft = Readonly<Partial<Record<SettingKey, SettingEntry>>>;

export const EMPTY_SETTINGS_DRAFT: SettingsDraft = Object.freeze({});

function isToggle(key: SettingKey): boolean {
  return key === 'signup_bonus_active' || key === 'levels_active';
}

export function settingEquals(key: SettingKey, a: string | null, b: string | null): boolean {
  if (isToggle(key)) return (a === 'true') === (b === 'true');
  if (key === 'signup_bonus_amount') {
    const x = a === null ? null : parseAmountText(a);
    const y = b === null ? null : parseAmountText(b);
    if (x !== null && y !== null) return sameAmount(x, y);
    return (a ?? '').trim() === (b ?? '').trim();
  }
  return (a ?? '') === (b ?? '');
}

export function settingChanged(key: SettingKey, entry: SettingEntry | undefined): boolean {
  return entry !== undefined && !settingEquals(key, entry.value, entry.base);
}

export function settingValue(snapshot: SettingsSnapshot, draft: SettingsDraft, key: SettingKey): string {
  return draft[key]?.value ?? snapshot.values[key] ?? '';
}

export function editSetting(
  draft: SettingsDraft,
  snapshot: SettingsSnapshot,
  key: SettingKey,
  value: string,
): SettingsDraft {
  const current = draft[key];
  const base = current ? current.base : snapshot.values[key];
  const pristine = key === 'signup_bonus_amount' ? value === (base ?? '') : settingEquals(key, value, base);
  if (pristine) {
    if (!current) return draft;
    const next: Partial<Record<SettingKey, SettingEntry>> = { ...draft };
    delete next[key];
    return next;
  }
  return { ...draft, [key]: { value, base, conflict: current?.conflict ?? false } };
}

export function settingsCount(draft: SettingsDraft): number {
  return SETTING_KEYS.filter((key) => settingChanged(key, draft[key])).length;
}

export function settingsErrors(snapshot: SettingsSnapshot, draft: SettingsDraft): Partial<Record<SettingKey, string>> {
  const errors: Partial<Record<SettingKey, string>> = {};
  const active = settingValue(snapshot, draft, 'signup_bonus_active') === 'true';
  const amountEdited = draft.signup_bonus_amount !== undefined;
  const switchedOn = settingChanged('signup_bonus_active', draft.signup_bonus_active) && active;
  if (amountEdited || switchedOn) {
    const amount = settingValue(snapshot, draft, 'signup_bonus_amount');
    const problem = amountTextProblem(amount, { noun: 'the bonus amount', max: SIGNUP_BONUS_MAX, positive: active });
    if (problem) {
      errors.signup_bonus_amount = active && parseAmountText(amount) === 0
        ? 'A signup bonus that is on needs an amount above ₦0. Switch the bonus off instead.'
        : problem;
    }
  }
  return errors;
}

export function settingText(key: SettingKey, value: string | null): string {
  if (isToggle(key)) return value === 'true' ? 'On' : 'Off';
  if (key === 'signup_bonus_amount') {
    const amount = value === null ? null : parseAmountText(value);
    return amount === null ? (value?.trim() ? value.trim() : 'Not set') : formatNaira(amount);
  }
  return conditionText(value);
}

export interface SettingChange {
  key: SettingKey;
  label: string;
  from: string | null;
  to: string;
  fromText: string;
  toText: string;
  conflict: boolean;
}

export function settingsChanges(draft: SettingsDraft): SettingChange[] {
  const changes: SettingChange[] = [];
  for (const key of SETTING_KEYS) {
    const entry = draft[key];
    if (!entry || !settingChanged(key, entry)) continue;
    changes.push({
      key,
      label: SETTING_LABELS[key],
      from: entry.base,
      to: entry.value,
      fromText: settingText(key, entry.base),
      toText: settingText(key, entry.value),
      conflict: entry.conflict,
    });
  }
  return changes;
}

export function normalizedSetting(key: SettingKey, value: string): string {
  if (isToggle(key)) return value === 'true' ? 'true' : 'false';
  if (key === 'signup_bonus_amount') {
    const amount = parseAmountText(value);
    return amount === null ? value.trim() : String(amount);
  }
  return value;
}

export interface SettingsPayload {
  changes: Record<string, string>;
  expected: Record<string, string | null>;
}

export function settingsPayload(changes: readonly SettingChange[]): SettingsPayload {
  const out: Record<string, string> = {};
  const expected: Record<string, string | null> = {};
  for (const change of changes) {
    out[change.key] = normalizedSetting(change.key, change.to);
    expected[change.key] = change.from;
  }
  return { changes: out, expected };
}

export interface SettingConflict {
  key: SettingKey;
  live: string | null;
}

export interface SettingsRebase {
  draft: SettingsDraft;
  conflicts: SettingConflict[];
  alreadyLive: SettingKey[];
}

export function rebaseSettings(draft: SettingsDraft, fresh: SettingsSnapshot): SettingsRebase {
  const next: Partial<Record<SettingKey, SettingEntry>> = {};
  const conflicts: SettingConflict[] = [];
  const alreadyLive: SettingKey[] = [];
  for (const key of SETTING_KEYS) {
    const entry = draft[key];
    if (!entry) continue;
    const live = fresh.values[key];
    if (!settingChanged(key, entry)) {
      if (!settingEquals(key, live, entry.base)) continue;
      next[key] = { ...entry, base: live };
      continue;
    }
    const moved = !settingEquals(key, live, entry.base);
    const rebased: SettingEntry = { value: entry.value, base: live, conflict: false };
    if (!settingChanged(key, rebased)) {
      alreadyLive.push(key);
      continue;
    }
    next[key] = { ...rebased, conflict: moved || entry.conflict };
    if (moved) conflicts.push({ key, live });
  }
  return { draft: next, conflicts, alreadyLive };
}

export function rebaseSettingsNotice(result: SettingsRebase): PageNotice | null {
  const items: NoticeItem[] = [
    ...result.conflicts.map((conflict) => ({
      id: conflict.key,
      title: SETTING_LABELS[conflict.key],
      detail: `Someone else changed this to ${settingText(conflict.key, conflict.live)}. Your value is kept; check it before applying.`,
    })),
    ...result.alreadyLive.map((key) => ({
      id: key,
      title: SETTING_LABELS[key],
      detail: 'Someone else already made this change, so there is nothing left to apply.',
    })),
  ];
  if (items.length === 0) return null;
  return {
    tone: 'warning',
    title: items.length === 1 ? 'A setting changed while you were editing' : 'Settings changed while you were editing',
    message: 'The live values were reloaded. Your other unsaved changes are kept.',
    items,
  };
}

function moveWarning(from: number | null, to: number | null): string {
  if (isHugeMove(from, to)) return ' That is a tenfold change or more: check it is not a typo.';
  if (isLargeMove(from, to)) return ' Check this is not a typo.';
  return '';
}

export function settingsConsequences(changes: readonly SettingChange[]): string[] {
  const lines: string[] = [];
  for (const change of changes) {
    if (change.conflict) {
      lines.push(`Someone else changed ${change.label.toLowerCase()} to ${change.fromText} after you started editing. Applying sets it to ${change.toText}.`);
    }
  }
  for (const change of changes) {
    switch (change.key) {
      case 'signup_bonus_active':
        lines.push(change.to === 'true'
          ? 'The app offers the signup bonus again, and users who have not claimed it can claim it.'
          : 'The app stops offering the signup bonus and nobody can claim it. Bonuses already credited stay with users.');
        break;
      case 'signup_bonus_amount': {
        const from = change.from === null ? null : parseAmountText(change.from);
        const to = parseAmountText(change.to);
        lines.push(`Signup bonuses claimed from now on pay ${change.toText} instead of ${change.fromText}. Bonuses already credited do not change.${moveWarning(from, to)}`);
        break;
      }
      case 'signup_bonus_condition':
        lines.push(change.to === 'first_trade'
          ? 'Users need an approved card trade before they can claim the signup bonus.'
          : 'Users no longer need a trade: anyone who has not claimed the signup bonus can claim it straight away.');
        break;
      case 'levels_active':
        lines.push(change.to === 'true'
          ? 'The app shows Levels again, and users can claim the bonus for the tier they have reached.'
          : 'The app hides Levels and nobody can claim a level bonus. Users keep their tier progress.');
        break;
    }
  }
  lines.push('Open apps pick up the change the next time they reload settings, usually within a few minutes.');
  return lines;
}

export function settingsMoveMoney(changes: readonly SettingChange[]): boolean {
  return changes.some((change) => change.key !== 'levels_active' || change.to === 'true');
}

export type ConfigOutcome =
  | { kind: 'done' }
  | { kind: 'unknown'; message: string }
  | { kind: 'refused'; status: number | null; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'expired' }
  | { kind: 'retry'; message: string };

export function classifyConfigSave(result: ApiResult<ApiBody>): ConfigOutcome {
  if (result.ok) return { kind: 'done' };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  if (failure.status === 403) return { kind: 'refused', status: 403, message: failure.message };
  if (failure.status === 409) return { kind: 'conflict', message: failure.message };
  return { kind: 'retry', message: failure.message };
}

export function sameSettings(snapshot: SettingsSnapshot, intended: Readonly<Record<string, string>>): boolean {
  return Object.entries(intended).every(([key, value]) => (
    settingEquals(key as SettingKey, snapshot.values[key as SettingKey], value)
  ));
}

export interface RuleDraft {
  key: string;
  type: string;
  a: string;
  b: string;
  legacy: unknown;
}

function numberText(value: unknown): string {
  const amount = toAmount(value);
  if (amount !== null) return String(amount);
  return typeof value === 'string' ? value : '';
}

export function ruleDraftFrom(raw: unknown, key: string): RuleDraft {
  const type = ruleType(raw);
  const spec = ruleSpec(type);
  if (!spec || spec.retired || !isRecord(raw)) return { key, type, a: '', b: '', legacy: raw };
  const value = raw.value;
  const record: Record<string, unknown> = isRecord(value) ? value : {};
  switch (spec.kind) {
    case 'text':
      return { key, type, a: typeof value === 'string' ? value : '', b: '', legacy: null };
    case 'list':
      return { key, type, a: (splitList(value) ?? []).join(', '), b: '', legacy: null };
    case 'none':
      return { key, type, a: '', b: '', legacy: null };
    case 'countDays':
      return { key, type, a: numberText(record.count), b: numberText(record.days), legacy: null };
    case 'usdDays':
      return { key, type, a: numberText(record.amount), b: numberText(record.days), legacy: null };
    case 'usdCard':
      return {
        key,
        type,
        a: numberText(record.amount),
        b: typeof record.card === 'string' ? record.card : '',
        legacy: null,
      };
    default:
      return { key, type, a: numberText(value), b: '', legacy: null };
  }
}

export function newRuleDraft(key: string, type: string): RuleDraft {
  return { key, type, a: '', b: '', legacy: null };
}

export function isLegacyRule(draft: RuleDraft): boolean {
  return draft.legacy !== null;
}

function numeric(textValue: string): number | string {
  const amount = parseAmountText(textValue);
  return amount === null ? textValue.trim() : amount;
}

function rawFromDraft(spec: RuleSpec, draft: RuleDraft): Record<string, unknown> {
  switch (spec.kind) {
    case 'text':
    case 'list':
      return { type: spec.type, value: draft.a };
    case 'none':
      return { type: spec.type, value: null };
    case 'countDays':
      return { type: spec.type, value: { count: numeric(draft.a), days: numeric(draft.b) } };
    case 'usdDays':
      return { type: spec.type, value: { amount: numeric(draft.a), days: numeric(draft.b) } };
    case 'usdCard':
      return { type: spec.type, value: { amount: numeric(draft.a), card: draft.b } };
    default:
      return { type: spec.type, value: numeric(draft.a) };
  }
}

export function ruleFromDraft(draft: RuleDraft): { rule: unknown; problem: string | null } {
  if (draft.legacy !== null) return { rule: draft.legacy, problem: null };
  const spec = ruleSpec(draft.type);
  if (!spec || spec.retired) return { rule: null, problem: 'Choose a rule from the list.' };
  const checked = checkRule(rawFromDraft(spec, draft));
  return checked.ok ? { rule: checked.value, problem: null } : { rule: null, problem: checked.message };
}

export interface RulesCheck {
  rules: unknown[];
  problems: Readonly<Record<string, string>>;
  warnings: Readonly<Record<string, string>>;
  changed: boolean;
  complete: boolean;
}

function legacyProblem(raw: unknown): string {
  const spec = ruleSpec(ruleType(raw));
  const why = spec?.retired ?? 'The claim check does not recognise it.';
  return `Remove this rule to save changes to the rules. ${why}`;
}

export function checkRuleDrafts(drafts: readonly RuleDraft[], base: readonly unknown[]): RulesCheck {
  const rules: unknown[] = [];
  const problems: Record<string, string> = {};
  const warnings: Record<string, string> = {};
  let complete = true;
  for (const draft of drafts) {
    const { rule, problem } = ruleFromDraft(draft);
    if (problem) {
      problems[draft.key] = problem;
      complete = false;
      continue;
    }
    rules.push(rule);
    if (draft.legacy !== null) {
      const impact = ruleImpact(draft.legacy);
      if (impact.message) warnings[draft.key] = impact.message;
    } else if (draft.type === 'country_in' && isRecord(rule)) {
      const warning = countryCodeWarning(rule.value);
      if (warning) warnings[draft.key] = warning;
    }
  }
  if (drafts.length > RULES_MAX) complete = false;
  const changed = !complete || !sameRules(rules, base);
  if (changed) {
    for (const draft of drafts) {
      if (draft.legacy !== null && !problems[draft.key]) problems[draft.key] = legacyProblem(draft.legacy);
    }
  }
  return { rules, problems, warnings, changed, complete };
}

export type GiftboxFormField = 'title' | 'description' | 'reward' | 'expiry' | 'note';

export const GIFTBOX_FORM_FIELDS: readonly GiftboxFormField[] = ['title', 'reward', 'expiry', 'description', 'note'];

export interface GiftboxForm {
  title: string;
  description: string;
  reward: string;
  expiry: string;
  note: string;
  active: boolean;
  rules: RuleDraft[];
}

export interface GiftboxDraftValues {
  title: string;
  description: string | null;
  reward_naira: number;
  expiry_date: string | null;
  eligibility_condition: string | null;
  eligibility_rules: unknown[];
  is_active: boolean;
}

export function emptyGiftboxForm(): GiftboxForm {
  return { title: '', description: '', reward: '', expiry: '', note: '', active: true, rules: [] };
}

export function giftboxFormFrom(item: GiftboxItem, nextKey: () => string): GiftboxForm {
  return {
    title: item.values.title ?? '',
    description: item.description ?? '',
    reward: item.reward === null ? '' : String(item.reward),
    expiry: item.expiry ?? '',
    note: item.note ?? '',
    active: item.active,
    rules: item.rules.map((rule) => ruleDraftFrom(rule, nextKey())),
  };
}

export interface GiftboxFormCheck {
  errors: Partial<Record<GiftboxFormField, string>>;
  rules: RulesCheck;
  warnings: string[];
  values: GiftboxDraftValues | null;
}

export function checkGiftboxForm(form: GiftboxForm, baseRules: readonly unknown[], today: string): GiftboxFormCheck {
  const errors: Partial<Record<GiftboxFormField, string>> = {};
  const title = form.title.trim();
  if (!title) errors.title = 'Enter a title. Users see it on the gift box.';
  else if (title.length > GIFTBOX_TITLE_MAX) errors.title = `Use ${GIFTBOX_TITLE_MAX} characters or fewer.`;
  const reward = amountTextProblem(form.reward, { noun: 'the reward amount', max: GIFTBOX_REWARD_MAX });
  if (reward) errors.reward = reward;
  const expiry = form.expiry.trim();
  if (expiry && !isDateKey(expiry)) errors.expiry = 'Use a date like 2026-12-31.';
  if (form.description.trim().length > GIFTBOX_DESCRIPTION_MAX) {
    errors.description = `Use ${formatCount(GIFTBOX_DESCRIPTION_MAX)} characters or fewer.`;
  }
  if (form.note.trim().length > GIFTBOX_NOTE_MAX) errors.note = `Use ${GIFTBOX_NOTE_MAX} characters or fewer.`;
  const rules = checkRuleDrafts(form.rules, baseRules);
  const warnings: string[] = [];
  if (form.active && !expiry) {
    warnings.push('Without an end date the app does not list this gift box, so users cannot see or claim it.');
  } else if (form.active && isDateKey(expiry) && expiry < today) {
    warnings.push('The end date has passed, so users cannot claim this gift box.');
  }
  const amount = parseAmountText(form.reward);
  const valid = Object.keys(errors).length === 0 && Object.keys(rules.problems).length === 0 && rules.complete && amount !== null;
  return {
    errors,
    rules,
    warnings,
    values: valid
      ? {
          title,
          description: textOrNull(form.description),
          reward_naira: amount as number,
          expiry_date: expiry || null,
          eligibility_condition: textOrNull(form.note),
          eligibility_rules: rules.rules,
          is_active: form.active,
        }
      : null,
  };
}

export const GIFTBOX_FIELD_LABELS: Readonly<Record<GiftboxField, string>> = {
  title: 'Title',
  description: 'Description',
  reward_naira: 'Reward',
  expiry_date: 'End date',
  eligibility_condition: 'Requirement note',
  eligibility_rules: 'Who can claim',
  is_active: 'Status',
};

export interface GiftboxChange {
  field: GiftboxField;
  label: string;
  from: string;
  to: string;
  fromList: string[] | null;
  toList: string[] | null;
}

function fieldText(field: GiftboxField, value: unknown): string {
  switch (field) {
    case 'reward_naira': {
      const amount = toAmount(value);
      return amount === null ? 'Not set' : formatNaira(amount);
    }
    case 'expiry_date':
      return typeof value === 'string' && value ? formatDay(value) : 'No end date';
    case 'is_active':
      return value === true ? 'Live' : 'Off';
    case 'eligibility_rules': {
      const rules = rulesList(value);
      return rules.length === 0 ? 'Every user, once' : plural(rules.length, 'rule', 'rules');
    }
    default:
      return textOrNull(value) ?? 'None';
  }
}

export function giftboxChanges(item: GiftboxItem, values: GiftboxDraftValues): GiftboxChange[] {
  const changes: GiftboxChange[] = [];
  const order: GiftboxField[] = [
    'title', 'reward_naira', 'is_active', 'expiry_date', 'eligibility_rules', 'description', 'eligibility_condition',
  ];
  for (const field of order) {
    const before = item.values[field];
    const after = values[field];
    if (sameGiftboxValue(field, before, after)) continue;
    const rules = field === 'eligibility_rules';
    changes.push({
      field,
      label: GIFTBOX_FIELD_LABELS[field],
      from: fieldText(field, before),
      to: fieldText(field, after),
      fromList: rules ? rulesText(rulesList(before)) : null,
      toList: rules ? rulesText(rulesList(after)) : null,
    });
  }
  return changes;
}

export function giftboxCreateBody(values: GiftboxDraftValues) {
  return { ...values };
}

export function giftboxPatchBody(item: GiftboxItem, values: GiftboxDraftValues, changes: readonly GiftboxChange[]) {
  const body: Record<string, unknown> = { id: item.id };
  const expected: Record<string, unknown> = {};
  for (const change of changes) {
    body[change.field] = values[change.field];
    expected[change.field] = item.values[change.field];
  }
  body.expected = expected;
  return body;
}

export function giftboxToggleBody(item: GiftboxItem, active: boolean) {
  return { id: item.id, is_active: active, expected: { is_active: item.active } };
}

export interface GiftboxReceipt {
  item: GiftboxItem | null;
  changed: boolean;
  warning: string | null;
}

export function toGiftboxReceipt(body: ApiBody): GiftboxReceipt {
  return {
    item: toGiftboxItem(body.item),
    changed: body.changed !== false,
    warning: body.audit_recorded === false ? text(body.warning) ?? 'The change was saved, but it could not be written to the audit log.' : null,
  };
}

export type GiftboxOutcome =
  | { kind: 'saved'; receipt: GiftboxReceipt }
  | { kind: 'conflict'; message: string; live: GiftboxItem | null }
  | { kind: 'missing'; message: string }
  | { kind: 'unknown'; message: string }
  | { kind: 'refused'; status: number | null; message: string }
  | { kind: 'expired' }
  | { kind: 'retry'; message: string };

export function classifyGiftboxSave(result: ApiResult<GiftboxReceipt>): GiftboxOutcome {
  if (result.ok) return { kind: 'saved', receipt: result.data };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  if (failure.outcomeUnknown) return { kind: 'unknown', message: failure.message };
  if (failure.status === 403) return { kind: 'refused', status: 403, message: failure.message };
  if (failure.status === 404) return { kind: 'missing', message: failure.message };
  if (failure.status === 409) {
    const details = isRecord(failure.details) ? failure.details : null;
    return { kind: 'conflict', message: failure.message, live: details ? toGiftboxItem(details.item) : null };
  }
  return { kind: 'retry', message: failure.message };
}

export function sameAsIntended(item: GiftboxItem, values: Partial<GiftboxDraftValues>): boolean {
  return (Object.keys(values) as GiftboxField[]).every((field) => sameGiftboxValue(field, item.values[field], values[field]));
}

export function sameGiftboxItem(a: GiftboxItem, b: GiftboxItem): boolean {
  return GIFTBOX_FIELDS.every((field) => sameGiftboxValue(field, a.values[field], b.values[field]));
}

export function intendedValues(values: GiftboxDraftValues, changes: readonly GiftboxChange[]): Partial<GiftboxDraftValues> {
  const out: Partial<GiftboxDraftValues> = {};
  for (const change of changes) (out as Record<string, unknown>)[change.field] = values[change.field];
  return out;
}

export interface FormRebase {
  form: GiftboxForm;
  conflicts: string[];
}

function formTextSame(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

function formRewardSame(a: string, b: string): boolean {
  const x = parseAmountText(a);
  const y = parseAmountText(b);
  return x !== null && y !== null ? sameAmount(x, y) : formTextSame(a, b);
}

export function rebaseGiftboxForm(
  form: GiftboxForm,
  oldItem: GiftboxItem,
  live: GiftboxItem,
  nextKey: () => string,
): FormRebase {
  const oldForm = giftboxFormFrom(oldItem, nextKey);
  const liveForm = giftboxFormFrom(live, nextKey);
  const next: GiftboxForm = { ...form };
  const conflicts: string[] = [];
  const textFields: Array<[keyof Omit<GiftboxForm, 'active' | 'rules'>, GiftboxField]> = [
    ['title', 'title'],
    ['description', 'description'],
    ['reward', 'reward_naira'],
    ['expiry', 'expiry_date'],
    ['note', 'eligibility_condition'],
  ];
  for (const [key, field] of textFields) {
    const same = key === 'reward' ? formRewardSame : formTextSame;
    const edited = !same(form[key], oldForm[key]);
    const moved = !same(liveForm[key], oldForm[key]);
    if (!edited) next[key] = liveForm[key];
    else if (moved) conflicts.push(GIFTBOX_FIELD_LABELS[field]);
  }
  const activeEdited = form.active !== oldForm.active;
  if (!activeEdited) next.active = live.active;
  else if (live.active !== oldItem.active) conflicts.push(GIFTBOX_FIELD_LABELS.is_active);
  const rulesCheck = checkRuleDrafts(form.rules, oldItem.rules);
  const rulesEdited = rulesCheck.changed;
  if (!rulesEdited) next.rules = liveForm.rules;
  else if (!sameRules(live.rules, oldItem.rules)) conflicts.push(GIFTBOX_FIELD_LABELS.eligibility_rules);
  return { form: next, conflicts };
}

export function formDirty(form: GiftboxForm, base: GiftboxForm): boolean {
  if (!formTextSame(form.title, base.title) || !formTextSame(form.description, base.description)) return true;
  if (!formRewardSame(form.reward, base.reward) || !formTextSame(form.expiry, base.expiry)) return true;
  if (!formTextSame(form.note, base.note) || form.active !== base.active) return true;
  if (form.rules.length !== base.rules.length) return true;
  return form.rules.some((rule, index) => {
    const other = base.rules[index];
    return rule.type !== other.type || rule.a !== other.a || rule.b !== other.b || rule.legacy !== other.legacy;
  });
}

export function leavePath(href: string, current: string): string | null {
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
