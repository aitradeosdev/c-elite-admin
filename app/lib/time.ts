export const BUSINESS_TZ = 'Africa/Lagos';
export const BUSINESS_TZ_LABEL = 'WAT';

const PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date): Wall {
  const parts = PARTS_FMT.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
}

function offsetMs(instant: Date): number {
  const w = wallClock(instant);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function instantFromWall(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = new Date(naive - offsetMs(new Date(naive)));
  guess = new Date(naive - offsetMs(guess));
  return guess;
}

export function businessDayStart(reference: Date = new Date()): Date {
  const w = wallClock(reference);
  return instantFromWall(w.year, w.month, w.day);
}

export function businessDayEnd(reference: Date = new Date()): Date {
  return new Date(businessDayStart(reference).getTime() + 86400000);
}

export function businessDaysAgoStart(days: number, reference: Date = new Date()): Date {
  const start = businessDayStart(reference);
  const shifted = new Date(start.getTime() - days * 86400000);
  const w = wallClock(shifted);
  return instantFromWall(w.year, w.month, w.day);
}

export interface BusinessRange {
  from: Date;
  to: Date;
  from_iso: string;
  to_iso: string;
}

export function businessRange(days: number, reference: Date = new Date()): BusinessRange {
  const to = businessDayEnd(reference);
  const from = businessDaysAgoStart(Math.max(0, days - 1), reference);
  return { from, to, from_iso: from.toISOString(), to_iso: to.toISOString() };
}

export function businessToday(reference: Date = new Date()): BusinessRange {
  const from = businessDayStart(reference);
  const to = businessDayEnd(reference);
  return { from, to, from_iso: from.toISOString(), to_iso: to.toISOString() };
}

export function previousBusinessRange(range: BusinessRange): BusinessRange {
  const span = range.to.getTime() - range.from.getTime();
  const to = new Date(range.from.getTime());
  const from = new Date(range.from.getTime() - span);
  return { from, to, from_iso: from.toISOString(), to_iso: to.toISOString() };
}

export function businessDateKey(instant: Date | string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const w = wallClock(d);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const DATETIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatBusinessDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return DATE_FMT.format(d);
}

export function formatBusinessDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return DATETIME_FMT.format(d);
}

export function formatBusinessTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return TIME_FMT.format(d);
}

export function formatAge(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const secs = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (secs < 60) return '<1m';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

function parseDateKey(value: unknown): CalendarDay | null {
  if (typeof value !== 'string') return null;
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return { year, month, day };
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shiftDateKey(start: CalendarDay, days: number): string {
  const shifted = new Date(Date.UTC(start.year, start.month - 1, start.day + days));
  return formatDateKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function isBusinessDateKey(value: unknown): value is string {
  return parseDateKey(value) !== null;
}

export function lagosDateToRangeStart(date: string | null | undefined): string | null {
  const day = parseDateKey(date);
  return day ? instantFromWall(day.year, day.month, day.day).toISOString() : null;
}

export function lagosDateToRangeEnd(date: string | null | undefined): string | null {
  const day = parseDateKey(date);
  return day ? instantFromWall(day.year, day.month, day.day + 1).toISOString() : null;
}

export type BusinessDatePresetKey = 'today' | '7d' | '30d' | 'month' | 'all';

export interface BusinessDatePreset {
  key: BusinessDatePresetKey;
  label: string;
  from: string | null;
  to: string | null;
}

export function businessDatePresets(reference: Date = new Date()): BusinessDatePreset[] {
  const w = wallClock(reference);
  const today: CalendarDay = { year: w.year, month: w.month, day: w.day };
  const todayKey = formatDateKey(w.year, w.month, w.day);
  return [
    { key: 'today', label: 'Today', from: todayKey, to: todayKey },
    { key: '7d', label: 'Last 7 days', from: shiftDateKey(today, -6), to: todayKey },
    { key: '30d', label: 'Last 30 days', from: shiftDateKey(today, -29), to: todayKey },
    { key: 'month', label: 'This month', from: formatDateKey(w.year, w.month, 1), to: todayKey },
    { key: 'all', label: 'All time', from: null, to: null },
  ];
}

export type ExportRangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'all';

export interface ExportRangeOption {
  value: ExportRangeKey;
  label: string;
}

export interface ExportRangeDates {
  from: string | null;
  to: string | null;
  label: string;
}

const EXPORT_RANGE_LABELS: Readonly<Record<ExportRangeKey, string>> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
  all: 'All time',
};

const EXPORT_RANGE_ORDER: ReadonlyArray<ExportRangeKey> = ['today', 'yesterday', '7d', '30d', 'month', 'all'];

export const EXPORT_RANGE_OPTIONS: ReadonlyArray<ExportRangeOption> = Object.freeze(
  EXPORT_RANGE_ORDER.map((value): ExportRangeOption => Object.freeze({ value, label: EXPORT_RANGE_LABELS[value] })),
);

export function isExportRangeKey(value: unknown): value is ExportRangeKey {
  return EXPORT_RANGE_ORDER.some((key) => key === value);
}

export function exportRangeDates(key: ExportRangeKey, now: Date = new Date()): ExportRangeDates {
  if (!isExportRangeKey(key) || key === 'all') return { from: null, to: null, label: EXPORT_RANGE_LABELS.all };
  const w = wallClock(now);
  const today: CalendarDay = { year: w.year, month: w.month, day: w.day };
  const todayKey = formatDateKey(w.year, w.month, w.day);
  const label = EXPORT_RANGE_LABELS[key];
  switch (key) {
    case 'today':
      return { from: todayKey, to: todayKey, label };
    case 'yesterday': {
      const yesterdayKey = shiftDateKey(today, -1);
      return { from: yesterdayKey, to: yesterdayKey, label };
    }
    case '7d':
      return { from: shiftDateKey(today, -6), to: todayKey, label };
    case '30d':
      return { from: shiftDateKey(today, -29), to: todayKey, label };
    case 'month':
      return { from: formatDateKey(w.year, w.month, 1), to: todayKey, label };
  }
}

function formatDayMonth(instant: Date): string {
  const parts = DATE_FMT.formatToParts(instant);
  return parts
    .filter((part, index) => part.type !== 'year' && !(part.type === 'literal' && parts[index + 1]?.type === 'year'))
    .map((part) => part.value)
    .join('')
    .trim();
}

function dayStart(day: CalendarDay): Date {
  return instantFromWall(day.year, day.month, day.day);
}

export function formatLagosDateRange(from: string | null | undefined, to: string | null | undefined): string | null {
  const first = parseDateKey(from);
  const last = parseDateKey(to);
  if (first && last) {
    if (from === to) return formatBusinessDate(dayStart(first));
    const start = first.year === last.year ? formatDayMonth(dayStart(first)) : formatBusinessDate(dayStart(first));
    return `${start} – ${formatBusinessDate(dayStart(last))}`;
  }
  if (first) return `On or after ${formatBusinessDate(dayStart(first))}`;
  if (last) return `On or before ${formatBusinessDate(dayStart(last))}`;
  return null;
}
