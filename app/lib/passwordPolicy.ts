export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const PASSWORD_MAX_BYTES = 72;

const NAME_MIN = 3;

export type PasswordRule = 'length' | 'lower' | 'upper' | 'digit' | 'symbol';

export const PASSWORD_RULES: ReadonlyArray<{ id: PasswordRule; label: string }> = [
  { id: 'length', label: `At least ${PASSWORD_MIN} characters` },
  { id: 'lower', label: 'A lowercase letter' },
  { id: 'upper', label: 'An uppercase letter' },
  { id: 'digit', label: 'A number' },
  { id: 'symbol', label: 'A symbol' },
];

const PASSWORD_MESSAGES: Readonly<Record<PasswordRule, string>> = {
  length: `Password must be at least ${PASSWORD_MIN} characters.`,
  lower: 'Password must include a lowercase letter.',
  upper: 'Password must include an uppercase letter.',
  digit: 'Password must include a number.',
  symbol: 'Password must include a symbol.',
};

export function unmetPasswordRules(password: string): PasswordRule[] {
  const unmet: PasswordRule[] = [];
  if (password.length < PASSWORD_MIN) unmet.push('length');
  if (!/[a-z]/.test(password)) unmet.push('lower');
  if (!/[A-Z]/.test(password)) unmet.push('upper');
  if (!/[0-9]/.test(password)) unmet.push('digit');
  if (!/[^a-zA-Z0-9]/.test(password)) unmet.push('symbol');
  return unmet;
}

export function checkPassword(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return 'A password is required.';
  if (value.length > PASSWORD_MAX) return `Password must be ${PASSWORD_MAX} characters or fewer.`;
  const unmet = unmetPasswordRules(value);
  return unmet.length ? PASSWORD_MESSAGES[unmet[0]] : null;
}

export type OwnPasswordRule = PasswordRule | 'bytes' | 'different' | 'personal';

export interface OwnPasswordContext {
  current: string;
  username: string | null | undefined;
  email: string | null | undefined;
}

export interface OwnPasswordProblem {
  rule: OwnPasswordRule | null;
  message: string;
}

export const OWN_PASSWORD_RULES: ReadonlyArray<{ id: OwnPasswordRule; label: string }> = [
  ...PASSWORD_RULES,
  { id: 'bytes', label: `At most ${PASSWORD_MAX_BYTES} bytes (emoji and accented letters use more)` },
  { id: 'different', label: 'Different from your current password' },
  { id: 'personal', label: 'Does not contain your username or email name (before the @)' },
];

export const DIFFERENT_PASSWORD_MESSAGE = 'Password must be different from your current password.';

const OWN_PASSWORD_MESSAGES: Readonly<Record<OwnPasswordRule, string>> = {
  ...PASSWORD_MESSAGES,
  bytes: `Password must be ${PASSWORD_MAX_BYTES} bytes or fewer. Emoji and accented letters take more than one byte each.`,
  different: DIFFERENT_PASSWORD_MESSAGE,
  personal: 'Password must not contain your username or the part of your email before the @.',
};

export const NEW_PASSWORD_REQUIRED = 'Enter a new password.';

const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).length;
}

function hashedBytes(value: string): Uint8Array {
  return encoder.encode(value).subarray(0, PASSWORD_MAX_BYTES);
}

export function isSamePassword(a: string, b: string): boolean {
  if (a === b) return true;
  const left = hashedBytes(a);
  const right = hashedBytes(b);
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export function personalNames(username: string | null | undefined, email: string | null | undefined): string[] {
  const names: string[] = [];
  const name = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (name.length >= NAME_MIN) names.push(name);
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const at = address.lastIndexOf('@');
  const local = at > 0 ? address.slice(0, at) : '';
  if (local.length >= NAME_MIN && !names.includes(local)) names.push(local);
  return names;
}

export function unmetOwnPasswordRules(password: string, context: OwnPasswordContext): OwnPasswordRule[] {
  const unmet: OwnPasswordRule[] = unmetPasswordRules(password);
  if (utf8Length(password) > PASSWORD_MAX_BYTES) unmet.push('bytes');
  if (context.current !== '' && isSamePassword(password, context.current)) unmet.push('different');
  const lowered = password.toLowerCase();
  if (personalNames(context.username, context.email).some((name) => lowered.includes(name))) unmet.push('personal');
  return unmet;
}

export function checkOwnPassword(value: unknown, context: OwnPasswordContext): OwnPasswordProblem | null {
  if (typeof value !== 'string' || value === '') return { rule: null, message: NEW_PASSWORD_REQUIRED };
  const [first] = unmetOwnPasswordRules(value, context);
  return first ? { rule: first, message: OWN_PASSWORD_MESSAGES[first] } : null;
}
