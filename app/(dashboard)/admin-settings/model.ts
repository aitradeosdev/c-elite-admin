import type { ApiBody, ApiFailure, ApiResult } from '../../lib/apiClient';
import { resolvePayoutGateway } from '../../lib/gateway';
import { formatNaira } from '../../_ui';
import {
  diffConfig,
  rebaseDraft,
  validateConfig,
  type ConfigChange,
  type ConfigField,
  type ConfigOption,
  type ConfigSection,
  type ConfigValidator,
  type ConfigValues,
} from '../_config/ConfigForm';
import {
  ANDROID_STORE_KEY,
  APPROVAL_LIMIT_KEY,
  APPROVAL_LIMIT_MAX,
  APPROVAL_LIMIT_MIN,
  BILL_PROVIDERS,
  BILL_PROVIDER_LABELS,
  CHATWOOT_TOKEN_KEY,
  CHATWOOT_URL_KEY,
  CURRENT_VERSION_KEY,
  EMERGENCY_KEY,
  GATEWAY_LABELS,
  IDENTITY_KEY,
  IOS_STORE_KEY,
  MESSAGE_MAX_LENGTH,
  MINIMUM_VERSION_KEY,
  PAYMENT_GATEWAYS,
  PRIMARY_BILL_KEY,
  PRIMARY_GATEWAY_KEY,
  PRIVACY_URL_KEY,
  SECRET_MASK,
  SETTINGS_KEYS,
  TERMS_URL_KEY,
  UPDATE_MESSAGE_KEY,
  UPDATE_TYPES,
  UPDATE_TYPE_KEY,
  UPDATE_TYPE_LABELS,
  billFlagKey,
  billProviderLabel,
  checkSettingValue,
  gatewayFlagKey,
  gatewayLabel,
  isBillProvider,
  isFinancialKey,
  isFlagKey,
  isGateway,
  isMonoKey,
  isSecretKey,
  normalizeSettings,
  normalizeStored,
  primaryBillProvider,
  primaryGateway,
  settingLabel,
  settingProblem,
  type BillProvider,
  type StoredValue,
} from './rules';

export const SETTINGS_ENDPOINT = '/api/admin-settings';

export type SectionId = 'payouts' | 'bills' | 'approvals' | 'version' | 'support' | 'legal' | 'stores';

export type FieldKind = 'url' | 'token' | 'version' | 'money' | 'text' | 'select';

export interface SettingField extends ConfigField {
  kind?: FieldKind;
  wide?: boolean;
  maxLength?: number;
}

export interface SettingSection extends ConfigSection {
  id: SectionId;
  fields: SettingField[];
}

export interface SecretState {
  set: boolean;
  updatedAt: string | null;
  exposed: boolean;
}

export interface SettingsSnapshot {
  raw: Readonly<Record<string, StoredValue>>;
  values: ConfigValues;
  identity: SecretState;
  updatedAt: Readonly<Record<string, string | null>>;
}

export type SecretDraft = { mode: 'keep' } | { mode: 'replace'; value: string } | { mode: 'clear' };

export const KEEP_SECRET: SecretDraft = { mode: 'keep' };

export interface SettingsEdit {
  base: SettingsSnapshot;
  draft: ConfigValues;
  secret: SecretDraft;
}

export interface SecretChange {
  value: string;
  from: string;
  to: string;
}

export interface ReviewRow {
  key: string;
  label: string;
  from: string;
  to: string;
  fromMissing: boolean;
  toMissing: boolean;
  mono: boolean;
}

export interface RebaseOutcome {
  edit: SettingsEdit;
  conflicts: string[];
  dirty: boolean;
}

export interface SavePayload {
  changes: Record<string, string>;
  expected: Record<string, string>;
  reason?: string;
}

export interface SaveReceipt {
  changed: string[] | null;
  unchanged: string[];
  auditRecorded: boolean;
  warning: string | null;
}

export type SaveOutcome =
  | { kind: 'done'; receipt: SaveReceipt }
  | { kind: 'refused'; message: string }
  | { kind: 'conflict'; message: string; keys: string[] }
  | { kind: 'reauth'; message: string }
  | { kind: 'denied'; message: string }
  | { kind: 'expired' }
  | { kind: 'unknown'; message: string };

export type StepUpCode = 'REAUTH_REQUIRED' | 'MFA_REQUIRED';

export const STEP_UP_MESSAGE: Readonly<Record<StepUpCode, string>> = {
  REAUTH_REQUIRED: 'Your identity check ran out. Enter a new code from your authenticator app and try again.',
  MFA_REQUIRED: 'Set up two-step sign-in on your Profile first.',
};

export function stepUpCode(failure: ApiFailure): StepUpCode | null {
  if (failure.kind !== 'http' || failure.status !== 403) return null;
  return failure.code === 'REAUTH_REQUIRED' || failure.code === 'MFA_REQUIRED' ? failure.code : null;
}

export type LiveNoticeTone = 'warning' | 'danger';

export interface LiveNotice {
  tone: LiveNoticeTone;
  title: string;
  message: string;
}

export interface EmergencyState {
  on: boolean;
  since: string | null;
}

const ON_OFF: ConfigOption[] = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' },
];

function ruleCheck(key: string): ConfigValidator {
  return (value, values) => {
    const checked = checkSettingValue(key, value);
    if (!checked.ok) return checked.message;
    return settingProblem(key, values);
  };
}

function gatewayFlagField(gateway: (typeof PAYMENT_GATEWAYS)[number]): SettingField {
  const key = gatewayFlagKey(gateway);
  return { key, label: settingLabel(key), input: 'toggle', options: ON_OFF, validate: ruleCheck(key) };
}

function billFlagField(provider: BillProvider): SettingField {
  const key = billFlagKey(provider);
  return { key, label: settingLabel(key), input: 'toggle', options: ON_OFF, validate: ruleCheck(key) };
}

export const SECTIONS: SettingSection[] = [
  {
    id: 'payouts',
    title: 'Payment gateways',
    description: 'Payouts are sent through the primary gateway. API keys stay in Supabase function secrets and are not managed here.',
    fields: [
      {
        key: PRIMARY_GATEWAY_KEY,
        label: settingLabel(PRIMARY_GATEWAY_KEY),
        input: 'select',
        options: PAYMENT_GATEWAYS.map((value) => ({ value, label: GATEWAY_LABELS[value] })),
        validate: ruleCheck(PRIMARY_GATEWAY_KEY),
      },
      ...PAYMENT_GATEWAYS.map(gatewayFlagField),
    ],
  },
  {
    id: 'bills',
    title: 'Bill providers',
    description: 'Airtime, data, cable and electricity are bought through the primary provider. Services it does not offer are hidden in the app.',
    fields: [
      {
        key: PRIMARY_BILL_KEY,
        label: settingLabel(PRIMARY_BILL_KEY),
        input: 'select',
        options: BILL_PROVIDERS.map((value) => ({ value, label: BILL_PROVIDER_LABELS[value] })),
        validate: ruleCheck(PRIMARY_BILL_KEY),
      },
      ...BILL_PROVIDERS.map(billFlagField),
    ],
  },
  {
    id: 'approvals',
    title: 'Card approvals',
    description: 'A ceiling on what a single admin can approve, so one mistaken or compromised account cannot pay out a very large card.',
    fields: [
      {
        key: APPROVAL_LIMIT_KEY,
        label: 'Card approval limit (₦)',
        hint: 'Admins who are not super admins cannot approve a card above this amount. The server refuses and asks them to escalate to a super admin.',
        input: 'number',
        kind: 'money',
        min: APPROVAL_LIMIT_MIN,
        max: APPROVAL_LIMIT_MAX,
        step: 1,
        placeholder: '5000000',
        validate: ruleCheck(APPROVAL_LIMIT_KEY),
      },
    ],
  },
  {
    id: 'version',
    title: 'App version',
    description: 'Controls the update prompt in the user app. The app compares its installed version with these values each time it opens.',
    fields: [
      {
        key: CURRENT_VERSION_KEY,
        label: 'Current version',
        hint: 'The latest version that is live in both stores. Users below it see the update prompt.',
        input: 'text',
        kind: 'version',
        placeholder: '1.0.0',
        validate: ruleCheck(CURRENT_VERSION_KEY),
      },
      {
        key: MINIMUM_VERSION_KEY,
        label: 'Minimum version',
        hint: 'Users below this version must update before they can use the app.',
        input: 'text',
        kind: 'version',
        placeholder: '1.0.0',
        validate: ruleCheck(MINIMUM_VERSION_KEY),
      },
      {
        key: UPDATE_TYPE_KEY,
        label: 'Update prompt',
        hint: 'How the prompt behaves for users between the minimum and the current version.',
        input: 'select',
        kind: 'select',
        options: UPDATE_TYPES.map((value) => ({ value, label: UPDATE_TYPE_LABELS[value] })),
        validate: ruleCheck(UPDATE_TYPE_KEY),
      },
      {
        key: UPDATE_MESSAGE_KEY,
        label: 'Update message',
        hint: 'Shown on the update screen when an update is required.',
        input: 'text',
        kind: 'text',
        wide: true,
        maxLength: MESSAGE_MAX_LENGTH,
        placeholder: 'A new version of CardElite is available.',
        validate: ruleCheck(UPDATE_MESSAGE_KEY),
      },
    ],
  },
  {
    id: 'support',
    title: 'Live chat (Chatwoot)',
    description: 'The Support screen in the user app opens your Chatwoot website inbox with the signed-in user already identified.',
    fields: [
      {
        key: CHATWOOT_URL_KEY,
        label: 'Base URL',
        hint: 'Your Chatwoot address, for example https://app.chatwoot.com.',
        input: 'text',
        kind: 'url',
        placeholder: 'https://app.chatwoot.com',
        validate: ruleCheck(CHATWOOT_URL_KEY),
      },
      {
        key: CHATWOOT_TOKEN_KEY,
        label: 'Website inbox token',
        hint: 'From the website inbox settings in Chatwoot.',
        input: 'text',
        kind: 'token',
        placeholder: 'AbC123xyz',
        validate: ruleCheck(CHATWOOT_TOKEN_KEY),
      },
    ],
  },
  {
    id: 'legal',
    title: 'Legal links',
    description: 'Linked from the registration screen in the user app. Leave a field empty to show its label without a link.',
    fields: [
      {
        key: TERMS_URL_KEY,
        label: 'Terms of Use URL',
        input: 'text',
        kind: 'url',
        placeholder: 'https://your-site.com/terms',
        validate: ruleCheck(TERMS_URL_KEY),
      },
      {
        key: PRIVACY_URL_KEY,
        label: 'Privacy Policy URL',
        input: 'text',
        kind: 'url',
        placeholder: 'https://your-site.com/privacy',
        validate: ruleCheck(PRIVACY_URL_KEY),
      },
    ],
  },
  {
    id: 'stores',
    title: 'App store links',
    description: 'Where the update prompt sends users. Leave a field empty if the app is not listed in that store.',
    fields: [
      {
        key: ANDROID_STORE_KEY,
        label: 'Google Play URL',
        input: 'text',
        kind: 'url',
        placeholder: 'https://play.google.com/store/apps/details?id=com.cardelite.app',
        validate: ruleCheck(ANDROID_STORE_KEY),
      },
      {
        key: IOS_STORE_KEY,
        label: 'App Store URL',
        input: 'text',
        kind: 'url',
        placeholder: 'https://apps.apple.com/app/id000000000',
        validate: ruleCheck(IOS_STORE_KEY),
      },
    ],
  },
];

export const FIELD_ORDER: readonly string[] = SECTIONS.flatMap((section) => section.fields.map((field) => field.key))
  .flatMap((key) => (key === CHATWOOT_TOKEN_KEY ? [key, IDENTITY_KEY] : [key]));

export function sectionById(id: SectionId): SettingSection {
  const section = SECTIONS.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`Unknown settings section: ${id}`);
  return section;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function toSnapshot(body: ApiBody): SettingsSnapshot | null {
  const config = body.config;
  if (!isRecord(config)) return null;
  const raw: Record<string, StoredValue> = {};
  for (const key of SETTINGS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) continue;
    const value = config[key];
    raw[key] = typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : null;
  }
  const values = normalizeSettings(raw);
  const secretsBody = body.secrets;
  const secrets: Record<string, unknown> = isRecord(secretsBody) ? secretsBody : {};
  const summaryBody = secrets[IDENTITY_KEY];
  const summary = isRecord(summaryBody) ? summaryBody : null;
  const identity: SecretState = summary
    ? { set: summary.set === true, updatedAt: text(summary.updated_at), exposed: summary.exposed === true }
    : { set: values[IDENTITY_KEY] !== '', updatedAt: null, exposed: false };
  const stampsBody = body.config_updated_at;
  const stamps: Record<string, unknown> = isRecord(stampsBody) ? stampsBody : {};
  const updatedAt: Record<string, string | null> = {};
  for (const key of SETTINGS_KEYS) updatedAt[key] = text(stamps[key]);
  return { raw, values, identity, updatedAt };
}

export function emergencyState(snapshot: SettingsSnapshot): EmergencyState {
  return { on: snapshot.values[EMERGENCY_KEY] === 'true', since: snapshot.updatedAt[EMERGENCY_KEY] ?? null };
}

export function startEdit(snapshot: SettingsSnapshot): SettingsEdit {
  return { base: snapshot, draft: { ...snapshot.values }, secret: KEEP_SECRET };
}

export function secretChange(identity: SecretState, draft: SecretDraft): SecretChange | null {
  if (draft.mode === 'keep') return null;
  if (draft.mode === 'clear') return identity.set ? { value: '', from: 'Stored', to: 'Removed' } : null;
  return { value: draft.value.trim(), from: identity.set ? 'Stored' : 'Not set', to: 'New key' };
}

export function secretProblem(draft: SecretDraft): string | null {
  if (draft.mode !== 'replace') return null;
  const value = draft.value.trim();
  if (value === '') return 'Enter the new key, or cancel replacing it.';
  const checked = checkSettingValue(IDENTITY_KEY, value);
  return checked.ok ? null : checked.message;
}

export function editChanges(edit: SettingsEdit): ConfigChange[] {
  return diffConfig(SECTIONS, edit.base.values, edit.draft);
}

export function pendingCount(edit: SettingsEdit | null): number {
  if (!edit) return 0;
  return editChanges(edit).length + (secretChange(edit.base.identity, edit.secret) ? 1 : 0);
}

export function isEditDirty(edit: SettingsEdit | null): boolean {
  return pendingCount(edit) > 0;
}

export function editErrors(edit: SettingsEdit): Record<string, string> {
  const errors = validateConfig(SECTIONS, edit.base.values, edit.draft);
  const secret = secretProblem(edit.secret);
  if (secret) errors[IDENTITY_KEY] = secret;
  return errors;
}

export function firstInvalidKey(errors: Readonly<Record<string, string>>): string | null {
  return FIELD_ORDER.find((key) => Boolean(errors[key])) ?? null;
}

export function formatSetting(key: string, value: string): string {
  if (isFlagKey(key)) return value === 'true' ? 'On' : 'Off';
  if (key === PRIMARY_GATEWAY_KEY) return gatewayLabel(value);
  if (key === PRIMARY_BILL_KEY) return billProviderLabel(value);
  if (key === UPDATE_TYPE_KEY) return value === 'force' ? 'Force' : value === 'soft' ? 'Soft' : value;
  if (isSecretKey(key)) return value === '' ? 'Not set' : 'Stored';
  if (value === '') return 'Not set';
  if (key === APPROVAL_LIMIT_KEY) return formatNaira(value);
  return value;
}

function orderOf(key: string): number {
  const index = FIELD_ORDER.indexOf(key);
  return index < 0 ? FIELD_ORDER.length : index;
}

export function reviewRows(edit: SettingsEdit): ReviewRow[] {
  const rows: ReviewRow[] = editChanges(edit).map((change) => ({
    key: change.key,
    label: settingLabel(change.key),
    from: formatSetting(change.key, change.from),
    to: formatSetting(change.key, change.to),
    fromMissing: change.from === '' && !isFlagKey(change.key),
    toMissing: change.to === '' && !isFlagKey(change.key),
    mono: isMonoKey(change.key) && change.key !== APPROVAL_LIMIT_KEY,
  }));
  const secret = secretChange(edit.base.identity, edit.secret);
  if (secret) {
    rows.push({
      key: IDENTITY_KEY,
      label: settingLabel(IDENTITY_KEY),
      from: secret.from,
      to: secret.to,
      fromMissing: !edit.base.identity.set,
      toMissing: secret.value === '',
      mono: false,
    });
  }
  return rows.sort((a, b) => orderOf(a.key) - orderOf(b.key));
}

export function involvesMoney(edit: SettingsEdit): boolean {
  return editChanges(edit).some((change) => isFinancialKey(change.key));
}

function platformOf(key: string): string {
  return key === ANDROID_STORE_KEY ? 'Android' : 'iPhone';
}

function linkName(key: string): string {
  return key === TERMS_URL_KEY ? 'Terms of Use' : 'Privacy Policy';
}

function changeConsequence(change: ConfigChange, draft: ConfigValues): string | null {
  const { key, from, to } = change;
  if (key === PRIMARY_GATEWAY_KEY) {
    return `Payouts approved from now on are sent through ${gatewayLabel(to)} instead of ${gatewayLabel(from)}. Payouts already sent are not moved.`;
  }
  if (key === PRIMARY_BILL_KEY) {
    return `Airtime, data, cable and electricity are bought through ${billProviderLabel(to)} instead of ${billProviderLabel(from)}. Services it does not offer are hidden in the app.`;
  }
  const gateway = PAYMENT_GATEWAYS.find((option) => gatewayFlagKey(option) === key);
  if (gateway) return to === 'false' ? `${GATEWAY_LABELS[gateway]} can no longer be chosen as the primary payout gateway.` : null;
  const provider = BILL_PROVIDERS.find((option) => billFlagKey(option) === key);
  if (provider) return to === 'false' ? `${BILL_PROVIDER_LABELS[provider]} can no longer be chosen as the primary bill provider.` : null;
  if (key === APPROVAL_LIMIT_KEY) {
    return Number(to) > Number(from)
      ? `Admins who are not super admins can approve cards worth up to ${formatNaira(to)}, up from ${formatNaira(from)}.`
      : `Cards worth more than ${formatNaira(to)} now need a super admin to approve them (the limit was ${formatNaira(from)}).`;
  }
  if (key === CURRENT_VERSION_KEY) {
    if (to === '') return 'There is no current version any more, so the optional update prompt stops showing.';
    const forced = (draft[UPDATE_TYPE_KEY] ?? '') === 'force';
    return forced
      ? `Users below version ${to} must update before they can use the app. Make sure ${to} is live in both stores first.`
      : `Users below version ${to} are asked to update and can skip the prompt. Make sure ${to} is live in both stores first.`;
  }
  if (key === MINIMUM_VERSION_KEY) {
    return to === ''
      ? 'No version is blocked any more.'
      : `Users below version ${to} cannot use the app until they update.`;
  }
  if (key === UPDATE_TYPE_KEY) {
    const current = (draft[CURRENT_VERSION_KEY] ?? '').trim();
    const target = current ? `version ${current}` : 'the current version';
    return to === 'force'
      ? `Users below ${target} cannot use the app until they update.`
      : `Users below ${target} can skip the update prompt.`;
  }
  if (key === TERMS_URL_KEY || key === PRIVACY_URL_KEY) {
    return to === ''
      ? `The ${linkName(key)} link is removed from the registration screen.`
      : `The registration screen links to the new ${linkName(key)} address.`;
  }
  if (key === ANDROID_STORE_KEY || key === IOS_STORE_KEY) {
    return to === ''
      ? `The update prompt can no longer send ${platformOf(key)} users to the store.`
      : `The update prompt sends ${platformOf(key)} users to the new store listing.`;
  }
  return null;
}

export function reviewConsequences(edit: SettingsEdit): string[] {
  const changes = editChanges(edit);
  const notes: string[] = [];
  for (const change of changes) {
    const note = changeConsequence(change, edit.draft);
    if (note) notes.push(note);
  }
  if (changes.some((change) => change.key === CHATWOOT_URL_KEY || change.key === CHATWOOT_TOKEN_KEY)) {
    const url = (edit.draft[CHATWOOT_URL_KEY] ?? '').trim();
    const token = (edit.draft[CHATWOOT_TOKEN_KEY] ?? '').trim();
    notes.push(url && token
      ? 'The Support screen connects to the Chatwoot inbox with the new details.'
      : 'Live chat stops working in the app until both the base URL and the website token are set.');
  }
  const secret = secretChange(edit.base.identity, edit.secret);
  if (secret) {
    notes.push(secret.value === ''
      ? 'Chats are no longer verified with an identity key. If the inbox requires identity validation, signed-in users’ chats will fail.'
      : 'Signed-in users are verified with the new key. It must match the inbox’s identity validation key in Chatwoot, or their chats will fail verification.');
  }
  return notes;
}

export function rebaseEdit(edit: SettingsEdit, latest: SettingsSnapshot): RebaseOutcome {
  const rebased = rebaseDraft(SECTIONS, edit.base.values, edit.draft, latest.values);
  const conflicts = rebased.conflicts.map((conflict) => (
    `Someone else changed ${settingLabel(conflict.key)} to ${formatSetting(conflict.key, conflict.live)} after you opened this page. Applying replaces it.`
  ));
  const previous = edit.base.identity;
  const moved = previous.set !== latest.identity.set || previous.updatedAt !== latest.identity.updatedAt;
  const secret: SecretDraft = edit.secret.mode === 'clear' && !latest.identity.set ? KEEP_SECRET : edit.secret;
  if (secret.mode !== 'keep' && moved) {
    conflicts.push('Someone else changed the identity validation key after you opened this page. Applying replaces it.');
  }
  const next: SettingsEdit = { base: latest, draft: rebased.draft, secret };
  return { edit: next, conflicts, dirty: isEditDirty(next) };
}

export function savePayload(edit: SettingsEdit, reason = ''): SavePayload {
  const changes: Record<string, string> = {};
  const expected: Record<string, string> = {};
  for (const change of editChanges(edit)) {
    changes[change.key] = change.to;
    expected[change.key] = change.from;
  }
  const secret = secretChange(edit.base.identity, edit.secret);
  if (secret) {
    changes[IDENTITY_KEY] = secret.value;
    expected[IDENTITY_KEY] = edit.base.identity.set ? SECRET_MASK : '';
  }
  const note = reason.trim();
  return note ? { changes, expected, reason: note } : { changes, expected };
}

export function emergencyPayload(turnOn: boolean, reason: string): SavePayload {
  const note = reason.trim();
  const payload: SavePayload = {
    changes: { [EMERGENCY_KEY]: turnOn ? 'true' : 'false' },
    expected: { [EMERGENCY_KEY]: turnOn ? 'false' : 'true' },
  };
  return note ? { ...payload, reason: note } : payload;
}

export function applySaved(snapshot: SettingsSnapshot, payload: SavePayload, now: string): SettingsSnapshot {
  const raw: Record<string, StoredValue> = { ...snapshot.raw };
  const values: ConfigValues = { ...snapshot.values };
  const updatedAt: Record<string, string | null> = { ...snapshot.updatedAt };
  let identity = snapshot.identity;
  for (const [key, value] of Object.entries(payload.changes)) {
    updatedAt[key] = now;
    if (isSecretKey(key)) {
      const masked = value.trim() === '' ? '' : SECRET_MASK;
      raw[key] = masked;
      values[key] = masked;
      identity = { set: masked !== '', updatedAt: now, exposed: false };
      continue;
    }
    raw[key] = value;
    values[key] = normalizeStored(key, value);
  }
  return { raw, values, identity, updatedAt };
}

export function toSaveReceipt(body: ApiBody): SaveReceipt | null {
  if (body.success === false) return null;
  return {
    changed: Array.isArray(body.changed) ? strings(body.changed) : null,
    unchanged: strings(body.unchanged),
    auditRecorded: body.audit_recorded !== false,
    warning: text(body.warning),
  };
}

function conflictKeys(details: unknown): string[] {
  if (!isRecord(details) || !Array.isArray(details.conflicts)) return [];
  return details.conflicts
    .map((conflict) => (isRecord(conflict) && typeof conflict.key === 'string' ? conflict.key : null))
    .filter((key): key is string => key !== null);
}

export function classifySave(result: ApiResult<SaveReceipt>): SaveOutcome {
  if (result.ok) return { kind: 'done', receipt: result.data };
  const failure = result.error;
  if (failure.status === 401) return { kind: 'expired' };
  const stepUp = stepUpCode(failure);
  if (stepUp) return { kind: 'reauth', message: STEP_UP_MESSAGE[stepUp] };
  if (failure.status === 403) return { kind: 'denied', message: failure.message };
  if (failure.status === 409 && failure.code === 'STATE_CONFLICT') {
    return { kind: 'conflict', message: failure.message, keys: conflictKeys(failure.details) };
  }
  if (failure.outcomeUnknown || failure.kind !== 'http') return { kind: 'unknown', message: failure.message };
  return { kind: 'refused', message: failure.message };
}

export function savedMessage(receipt: SaveReceipt, sent: number): string {
  const count = receipt.changed === null ? sent : receipt.changed.length;
  if (count === 0) return 'Nothing needed to change. These values were already live.';
  return count === 1 ? 'Saved. 1 change is now live.' : `Saved. ${count} changes are now live.`;
}

export function payoutNotice(snapshot: SettingsSnapshot): LiveNotice | null {
  const configured = primaryGateway(snapshot.raw);
  const effective = resolvePayoutGateway(snapshot.raw);
  if (configured === effective) return null;
  const fallback = GATEWAY_LABELS[effective];
  return {
    tone: 'warning',
    title: `Payouts are going through ${fallback}`,
    message: isGateway(configured)
      ? `${gatewayLabel(configured)} is the primary gateway but is turned off, so payouts fall back to ${fallback}. Turn ${gatewayLabel(configured)} on, or choose another primary gateway.`
      : `The primary gateway is set to “${configured}”, which this console does not recognise, so payouts fall back to ${fallback}. Choose a primary gateway.`,
  };
}

export function billNotice(snapshot: SettingsSnapshot): LiveNotice | null {
  const raw = snapshot.raw;
  const configured = primaryBillProvider(raw);
  const active: BillProvider = configured === 'novac' && raw[billFlagKey('novac')] === 'true' ? 'novac' : 'vtpass';
  const flag = raw[billFlagKey(active)];
  const label = BILL_PROVIDER_LABELS[active];
  if (flag !== undefined && flag !== 'true') {
    return {
      tone: 'danger',
      title: 'Bill payments are being refused',
      message: `${label} is the provider in use but is turned off, so the app refuses airtime, data, cable and electricity purchases. Turn ${label} on, or make another provider primary.`,
    };
  }
  if (configured === active) return null;
  return {
    tone: 'warning',
    title: `Bills are going through ${label}`,
    message: isBillProvider(configured)
      ? `${billProviderLabel(configured)} is the primary provider but is turned off, so bill payments fall back to ${label}. Turn ${billProviderLabel(configured)} on, or choose another primary provider.`
      : `The primary bill provider is set to “${configured}”, which this console does not recognise, so bill payments go through ${label}. Choose a primary provider.`,
  };
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
