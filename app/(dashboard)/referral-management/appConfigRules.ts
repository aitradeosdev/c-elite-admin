import { SETTINGS_ONLY_CONFIG_KEYS } from '../../lib/configSecrets';
import { validateConfigUrl } from '../../lib/configUrls';
import { SETTING_LABELS as SIGNUP_LABELS, SIGNUP_CONDITIONS, isSignupCondition } from '../bonuses-rewards/model';
import { SIGNUP_BONUS_MAX, amountTextProblem, parseAmountText, type AmountRule } from '../bonuses-rewards/rewardRules';
import { SETTING_LABELS, checkSetting, isSettingKey, sameSettingValue, type SettingCheck } from './referralRules';

export const MAX_CONFIG_KEYS = 200;
export const NO_CHANGES_MESSAGE = 'No changes provided';

const KEY_PATTERN = /^[a-z0-9_]{1,64}$/;
const EXPECTED_SHAPE = 'expected must map each changed key to the value you last saw.';

type SignupKey = 'signup_bonus_active' | 'signup_bonus_amount' | 'signup_bonus_condition';

const SIGNUP_KEYS: readonly SignupKey[] = ['signup_bonus_active', 'signup_bonus_amount', 'signup_bonus_condition'];
const SIGNUP_PAIR: readonly SignupKey[] = ['signup_bonus_active', 'signup_bonus_amount'];
const SIGNUP_AMOUNT: AmountRule = { noun: 'the bonus amount', max: SIGNUP_BONUS_MAX };
const PAYABLE_AMOUNT = /^\d+(?:\.\d+)?$/;
const SIGNUP_SWITCH = `${SIGNUP_LABELS.signup_bonus_active}: Switch the signup bonus on or off (true or false).`;
const SIGNUP_CONDITION = `${SIGNUP_LABELS.signup_bonus_condition}: Choose ${SIGNUP_CONDITIONS.map((option) => `“${option.label}”`).join(' or ')}.`;
const SIGNUP_ZERO = 'A signup bonus that is on needs an amount above ₦0. Switch the bonus off instead.';
const SIGNUP_UNREADABLE = `${SIGNUP_LABELS.signup_bonus_amount}: Enter a number, like 1500 or 1500.50.`;

export type ConfigSensitivity = 'normal' | 'financial' | 'security';

const SECURITY_KEYS: ReadonlySet<string> = new Set([
  'pin_reset_freeze_hours', 'large_withdrawal_flag_threshold', 'signup_rate_limit_per_hour',
  'anomaly_dormant_days', 'anomaly_dormant_amount', 'anomaly_rapid_window_mins', 'anomaly_rapid_ratio',
  'anomaly_failures_window_mins', 'anomaly_failures_threshold', 'critical_alert_amount', 'alert_email_batch',
  'paystack_webhook_ips', 'monnify_webhook_ips', 'novac_webhook_ips',
]);

const FINANCIAL_KEYS: ReadonlySet<string> = new Set([
  'bill_vtpass_enabled', 'bill_novac_enabled', 'active_bill_provider',
  'gateway_paystack_enabled', 'gateway_monnify_enabled', 'gateway_novac_enabled',
  'min_withdrawal_amount', 'max_withdrawal_amount', 'max_daily_withdrawal', 'withdraw_fee',
  'min_electricity_amount', 'electricity_quick_amounts', 'min_airtime_amount', 'max_airtime_amount',
  'min_data_amount', 'max_data_amount', 'min_cable_amount', 'max_cable_amount',
  'signup_bonus_amount', 'signup_bonus_condition', 'signup_bonus_active',
  'referral_active', 'referral_referrer_bonus', 'referral_referee_bonus', 'referral_min_trade_usd', 'referral_max_per_day',
  'level_bonus_active', 'levels_active',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function owns(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function isSignupKey(key: string): key is SignupKey {
  return (SIGNUP_KEYS as readonly string[]).includes(key);
}

function checkSignupSetting(key: SignupKey, raw: unknown): SettingCheck {
  const text = scalarText(raw)?.trim() ?? '';
  if (key === 'signup_bonus_active') {
    const flag = text.toLowerCase();
    return flag === 'true' || flag === 'false' ? { ok: true, value: flag } : { ok: false, message: SIGNUP_SWITCH };
  }
  if (key === 'signup_bonus_condition') {
    return isSignupCondition(text) ? { ok: true, value: text } : { ok: false, message: SIGNUP_CONDITION };
  }
  const problem = amountTextProblem(text, SIGNUP_AMOUNT);
  const amount = problem === null ? parseAmountText(text) : null;
  return amount === null
    ? { ok: false, message: `${SIGNUP_LABELS.signup_bonus_amount}: ${problem}` }
    : { ok: true, value: String(amount) };
}

export function configLabel(key: string): string {
  if (isSettingKey(key)) return SETTING_LABELS[key];
  return isSignupKey(key) ? SIGNUP_LABELS[key] : key;
}

export function configReadKeys(keys: readonly string[]): string[] {
  return keys.some(isSignupKey) ? Array.from(new Set([...keys, ...SIGNUP_KEYS])) : [...keys];
}

export type ConfigKeysCheck = { ok: true; keys: string[] | null } | { ok: false; message: string };

export function readConfigKeys(raw: string | null): ConfigKeysCheck {
  if (raw === null || raw === '') return { ok: true, keys: null };
  const keys = Array.from(new Set(raw.split(',').map((key) => key.trim()).filter((key) => KEY_PATTERN.test(key))));
  if (keys.length > MAX_CONFIG_KEYS) return { ok: false, message: `Ask for at most ${MAX_CONFIG_KEYS} keys at a time.` };
  return { ok: true, keys };
}

export interface ConfigPatch {
  changes: Record<string, string>;
  expected: Record<string, string> | null;
}

export type ConfigPatchCheck = { ok: true; patch: ConfigPatch } | { ok: false; message: string };

type ExpectedCheck = { ok: true; expected: Record<string, string> | null } | { ok: false; message: string };

function readExpected(raw: unknown, changes: Readonly<Record<string, string>>): ExpectedCheck {
  if (raw === undefined || raw === null) return { ok: true, expected: null };
  if (!isRecord(raw)) return { ok: false, message: EXPECTED_SHAPE };
  const expected: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!owns(changes, key)) continue;
    const seen = value === null ? '' : scalarText(value);
    if (seen === null) return { ok: false, message: EXPECTED_SHAPE };
    expected[key] = seen;
  }
  return { ok: true, expected };
}

export function readConfigPatch(body: unknown, allowed: ReadonlySet<string>): ConfigPatchCheck {
  const changes = isRecord(body) ? body.changes : undefined;
  if (!isRecord(changes) || Object.keys(changes).length === 0) return { ok: false, message: NO_CHANGES_MESSAGE };

  const incoming = Object.keys(changes);
  const settingsOnly = incoming.filter((key) => SETTINGS_ONLY_CONFIG_KEYS.includes(key));
  if (settingsOnly.length > 0) {
    return { ok: false, message: `${settingsOnly.join(', ')} can only be changed in Platform Settings` };
  }
  const rejected = incoming.filter((key) => !allowed.has(key));
  if (rejected.length > 0) return { ok: false, message: `Unknown app_config keys: ${rejected.join(', ')}` };

  const accepted: Record<string, string> = {};
  for (const key of incoming) {
    const raw = changes[key];
    const urlProblem = validateConfigUrl(key, raw);
    if (urlProblem) return { ok: false, message: urlProblem };
    if (isSettingKey(key)) {
      const checked = checkSetting(key, raw);
      if (!checked.ok) return { ok: false, message: `${SETTING_LABELS[key]}: ${checked.message}` };
      accepted[key] = checked.value;
      continue;
    }
    if (isSignupKey(key)) {
      const checked = checkSignupSetting(key, raw);
      if (!checked.ok) return checked;
      accepted[key] = checked.value;
      continue;
    }
    const value = scalarText(raw);
    if (value === null) return { ok: false, message: `${key} must be text, a number or true/false.` };
    accepted[key] = value;
  }

  const expected = readExpected(isRecord(body) ? body.expected : undefined, accepted);
  if (!expected.ok) return expected;
  return { ok: true, patch: { changes: accepted, expected: expected.expected } };
}

export interface ConfigConflict {
  key: string;
  label: string;
  current: string | null;
}

export interface ConfigWritePlan {
  changes: Record<string, string>;
  expected: Record<string, string> | null;
  unchanged: string[];
}

export type CurrentConfig = Readonly<Record<string, string | null>>;

function currentOf(current: CurrentConfig, key: string): string | null | undefined {
  return owns(current, key) ? current[key] : undefined;
}

function signupAmountProblem(amount: string): string | null {
  const problem = amountTextProblem(amount, { ...SIGNUP_AMOUNT, positive: true });
  if (problem) return parseAmountText(amount) === 0 ? SIGNUP_ZERO : `${SIGNUP_LABELS.signup_bonus_amount}: ${problem}`;
  return PAYABLE_AMOUNT.test(amount) ? null : SIGNUP_UNREADABLE;
}

export function signupBonusProblem(changes: Readonly<Record<string, string>>, current: CurrentConfig): string | null {
  const switching = owns(changes, 'signup_bonus_active');
  if (!switching && !owns(changes, 'signup_bonus_amount')) return null;
  const effective = (key: SignupKey) => (owns(changes, key) ? changes[key] : currentOf(current, key) ?? null);
  if (effective('signup_bonus_active') !== 'true') return null;
  const amountProblem = signupAmountProblem(effective('signup_bonus_amount') ?? '');
  if (amountProblem) return amountProblem;
  return switching && !isSignupCondition(effective('signup_bonus_condition')) ? SIGNUP_CONDITION : null;
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export function conflictMessage(keys: readonly string[]): string {
  const subject = joinLabels(keys.map(configLabel));
  return `Another admin changed ${subject} after you loaded ${keys.length === 1 ? 'it' : 'them'}, so nothing was saved. Reload to see the current values.`;
}

export function sensitivityFor(keys: readonly string[]): ConfigSensitivity {
  if (keys.some((key) => SECURITY_KEYS.has(key))) return 'security';
  if (keys.some((key) => FINANCIAL_KEYS.has(key))) return 'financial';
  return 'normal';
}

export function planConfigWrite(patch: ConfigPatch, current: CurrentConfig): ConfigWritePlan {
  const changes: Record<string, string> = {};
  const expected: Record<string, string> = {};
  const unchanged: string[] = [];
  for (const [key, next] of Object.entries(patch.changes)) {
    const stored = currentOf(current, key);
    if (isSettingKey(key) && typeof stored === 'string' && sameSettingValue(key, stored, next)) {
      unchanged.push(key);
      expected[key] = stored;
      continue;
    }
    changes[key] = next;
    if (patch.expected && owns(patch.expected, key)) expected[key] = patch.expected[key];
  }
  if (SIGNUP_PAIR.some((key) => owns(changes, key))) {
    for (const key of SIGNUP_PAIR) if (!owns(changes, key)) expected[key] = currentOf(current, key) ?? '';
  }
  return { changes, expected: Object.keys(expected).length > 0 ? expected : null, unchanged };
}
