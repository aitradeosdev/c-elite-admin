export const KOBO_PER_NAIRA = 100;

export type NairaProblem = 'required' | 'invalid' | 'negative' | 'decimals' | 'too_large';

export type NairaCheck =
  | { ok: true; value: string; amount: number; kobo: number }
  | { ok: false; problem: NairaProblem };

const NAIRA_SIGN = /^₦\s*/;
const MINUS = /^[-−]/;
const PLAIN = /^\d+(?:\.\d+)?$/;
const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const GROUPING = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });

export function parseNaira(raw: unknown, max: number): NairaCheck {
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, problem: 'invalid' };
    text = String(raw);
  } else if (typeof raw === 'string') {
    text = raw.trim().replace(NAIRA_SIGN, '');
  } else {
    return { ok: false, problem: raw === null || raw === undefined ? 'required' : 'invalid' };
  }
  if (text === '') return { ok: false, problem: 'required' };
  if (MINUS.test(text)) return { ok: false, problem: 'negative' };
  if (!PLAIN.test(text) && !GROUPED.test(text)) return { ok: false, problem: 'invalid' };
  const [whole, fraction = ''] = text.replace(/,/g, '').split('.');
  if (fraction.length > 2) return { ok: false, problem: 'decimals' };
  const units = whole.replace(/^0+(?=\d)/, '');
  const cents = fraction.replace(/0+$/, '');
  const value = cents ? `${units}.${cents}` : units;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount > max) return { ok: false, problem: 'too_large' };
  const kobo = Number(units) * KOBO_PER_NAIRA + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(kobo)) return { ok: false, problem: 'too_large' };
  return { ok: true, value, amount, kobo };
}

export function toKobo(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const kobo = Math.round(value * KOBO_PER_NAIRA);
    return Number.isSafeInteger(kobo) ? kobo : null;
  }
  if (typeof value !== 'string') return null;
  const parsed = parseNaira(value, Number.MAX_SAFE_INTEGER / KOBO_PER_NAIRA);
  return parsed.ok ? parsed.kobo : null;
}

export function koboText(kobo: number): string {
  const abs = Math.abs(kobo);
  const text = `${Math.floor(abs / KOBO_PER_NAIRA)}.${String(abs % KOBO_PER_NAIRA).padStart(2, '0')}`;
  return kobo < 0 ? `-${text}` : text;
}

export function koboNaira(kobo: number): number {
  return kobo / KOBO_PER_NAIRA;
}

export function groupedNairaText(kobo: number): string {
  const abs = Math.abs(kobo);
  const whole = GROUPING.format(Math.floor(abs / KOBO_PER_NAIRA));
  const rest = abs % KOBO_PER_NAIRA;
  const text = rest === 0 ? whole : `${whole}.${String(rest).padStart(2, '0')}`;
  return kobo < 0 ? `-${text}` : text;
}
