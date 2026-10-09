import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type Dispatch, type ElementType, type SetStateAction } from 'react';
import { classesOf, loadAppModule, loadUiExport, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import {
  EXPORT_RANGE_OPTIONS, businessDateKey, businessDatePresets, businessDayStart, exportRangeDates,
  formatBusinessDate, formatLagosDateRange, isExportRangeKey, lagosDateToRangeEnd, lagosDateToRangeStart,
  type ExportRangeDates, type ExportRangeKey,
} from '../app/lib/time.ts';
import type { ExportRangeValue, RangeKey } from '../app/lib/printExport.ts';
import type { ExportModalPresetProps, ExportModalProps } from '../app/_ui/ExportModal.tsx';

type PrintExportModule = typeof import('../app/lib/printExport.ts');

const DAY_MS = 86_400_000;
const KEYS: readonly ExportRangeKey[] = ['today', 'yesterday', '7d', '30d', 'month', 'all'];
const ZONES = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata', 'Europe/London', 'Africa/Lagos'];

function windowsAt(reference: Date): Record<ExportRangeKey, ExportRangeDates> {
  const out = {} as Record<ExportRangeKey, ExportRangeDates>;
  for (const key of KEYS) out[key] = exportRangeDates(key, reference);
  return out;
}

function pair(range: ExportRangeDates): [string | null, string | null] {
  return [range.from, range.to];
}

function pageExportWindow(key: ExportRangeKey, reference: Date): ExportRangeDates {
  if (key === 'yesterday') {
    const day = businessDateKey(new Date(businessDayStart(reference).getTime() - 1));
    return { from: day, to: day, label: 'Yesterday' };
  }
  const preset = businessDatePresets(reference).find((candidate) => candidate.key === key);
  return preset
    ? { from: preset.from, to: preset.to, label: preset.label }
    : { from: null, to: null, label: 'All time' };
}

function hourly(fromIso: string, hours: number): Date[] {
  const start = Date.parse(fromIso);
  return Array.from({ length: hours }, (_, index) => new Date(start + index * 3_600_000));
}

function withZone(zone: string, run: () => void): void {
  const original = process.env.TZ;
  try {
    process.env.TZ = zone;
    run();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

describe('exportRangeDates', () => {
  test('mid-month, every key resolves to inclusive Lagos calendar dates', () => {
    const w = windowsAt(new Date('2026-09-15T12:00:00Z'));
    assert.deepEqual(pair(w.today), ['2026-09-15', '2026-09-15']);
    assert.deepEqual(pair(w.yesterday), ['2026-09-14', '2026-09-14']);
    assert.deepEqual(pair(w['7d']), ['2026-09-09', '2026-09-15']);
    assert.deepEqual(pair(w['30d']), ['2026-08-17', '2026-09-15']);
    assert.deepEqual(pair(w.month), ['2026-09-01', '2026-09-15']);
    assert.deepEqual(pair(w.all), [null, null]);
  });

  test('23:30 UTC on 30 September is already 1 October in Lagos', () => {
    const w = windowsAt(new Date('2026-09-30T23:30:00Z'));
    assert.deepEqual(pair(w.today), ['2026-10-01', '2026-10-01']);
    assert.deepEqual(pair(w.yesterday), ['2026-09-30', '2026-09-30']);
    assert.deepEqual(pair(w['7d']), ['2026-09-25', '2026-10-01']);
    assert.deepEqual(pair(w['30d']), ['2026-09-02', '2026-10-01']);
    assert.deepEqual(pair(w.month), ['2026-10-01', '2026-10-01']);
  });

  test('the last minute before Lagos midnight still belongs to 30 September', () => {
    const w = windowsAt(new Date('2026-09-30T22:59:59Z'));
    assert.deepEqual(pair(w.today), ['2026-09-30', '2026-09-30']);
    assert.deepEqual(pair(w.yesterday), ['2026-09-29', '2026-09-29']);
    assert.deepEqual(pair(w.month), ['2026-09-01', '2026-09-30']);
  });

  test('this month starts on the first of the Lagos month, including at month and year ends', () => {
    assert.deepEqual(pair(exportRangeDates('month', new Date('2026-09-30T23:10:00Z'))), ['2026-10-01', '2026-10-01']);
    assert.deepEqual(pair(exportRangeDates('month', new Date('2026-10-31T22:30:00Z'))), ['2026-10-01', '2026-10-31']);
    assert.deepEqual(pair(exportRangeDates('month', new Date('2026-10-31T23:30:00Z'))), ['2026-11-01', '2026-11-01']);
    assert.deepEqual(pair(exportRangeDates('month', new Date('2025-12-31T23:30:00Z'))), ['2026-01-01', '2026-01-01']);
    assert.deepEqual(pair(exportRangeDates('month', new Date('2028-02-29T12:00:00Z'))), ['2028-02-01', '2028-02-29']);
  });

  test('on the first of the month, this month is the same single day as today', () => {
    const w = windowsAt(new Date('2026-10-01T08:00:00Z'));
    assert.deepEqual(pair(w.month), pair(w.today));
  });

  test('yesterday crosses month, year and leap-day boundaries on the Lagos calendar', () => {
    assert.deepEqual(pair(exportRangeDates('yesterday', new Date('2026-03-01T12:00:00Z'))), ['2026-02-28', '2026-02-28']);
    assert.deepEqual(pair(exportRangeDates('yesterday', new Date('2028-03-01T12:00:00Z'))), ['2028-02-29', '2028-02-29']);
    assert.deepEqual(pair(exportRangeDates('yesterday', new Date('2026-01-01T00:30:00Z'))), ['2025-12-31', '2025-12-31']);
    assert.deepEqual(pair(exportRangeDates('yesterday', new Date('2025-12-31T23:30:00Z'))), ['2025-12-31', '2025-12-31']);
  });

  test('rolling windows cross month and year boundaries', () => {
    const w = windowsAt(new Date('2026-01-03T10:00:00Z'));
    assert.deepEqual(pair(w['7d']), ['2025-12-28', '2026-01-03']);
    assert.deepEqual(pair(w['30d']), ['2025-12-05', '2026-01-03']);
    const march = windowsAt(new Date('2028-03-01T12:00:00Z'));
    assert.deepEqual(pair(march['7d']), ['2028-02-24', '2028-03-01']);
    assert.deepEqual(pair(march['30d']), ['2028-02-01', '2028-03-01']);
  });

  test('windows are inclusive: each spans exactly its days and contains the reference instant', () => {
    const spans: ReadonlyArray<[ExportRangeKey, number]> = [['today', 1], ['yesterday', 1], ['7d', 7], ['30d', 30]];
    for (const reference of [...hourly('2026-09-30T20:00:00Z', 6), new Date('2026-01-01T00:30:00Z'), new Date('2028-02-29T23:30:00Z')]) {
      const todayEnd = lagosDateToRangeEnd(businessDateKey(reference));
      for (const [key, days] of spans) {
        const { from, to } = exportRangeDates(key, reference);
        const start = Date.parse(lagosDateToRangeStart(from)!);
        const end = Date.parse(lagosDateToRangeEnd(to)!);
        assert.equal(end - start, days * DAY_MS, `${reference.toISOString()} ${key}`);
        if (key === 'yesterday') {
          assert.equal(end, businessDayStart(reference).getTime(), reference.toISOString());
        } else {
          assert.equal(lagosDateToRangeEnd(to), todayEnd, `${reference.toISOString()} ${key}`);
          assert.ok(reference.getTime() >= start && reference.getTime() < end, `${reference.toISOString()} ${key}`);
        }
      }
      const month = exportRangeDates('month', reference);
      assert.equal(month.from?.slice(0, 8), businessDateKey(reference).slice(0, 8));
      assert.equal(month.from?.slice(8), '01');
      assert.equal(lagosDateToRangeEnd(month.to), todayEnd);
    }
  });

  test('all time is unbounded at every reference instant', () => {
    for (const iso of ['2026-09-30T23:30:00Z', '2026-01-01T00:00:00Z', '2030-06-15T12:00:00Z']) {
      assert.deepEqual(exportRangeDates('all', new Date(iso)), { from: null, to: null, label: 'All time' });
    }
  });

  test('labels are the option labels', () => {
    const reference = new Date('2026-09-15T12:00:00Z');
    for (const option of EXPORT_RANGE_OPTIONS) assert.equal(exportRangeDates(option.value, reference).label, option.label);
  });

  test('an unknown key falls back to all time, as every page copy did', () => {
    assert.deepEqual(exportRangeDates('90d' as unknown as ExportRangeKey, new Date('2026-09-15T12:00:00Z')), {
      from: null, to: null, label: 'All time',
    });
  });

  test('reproduces the three page exportWindow copies hour by hour across year, month and leap-day edges', () => {
    const references = [
      ...hourly('2025-12-30T00:00:00Z', 72),
      ...hourly('2026-02-27T00:00:00Z', 72),
      ...hourly('2028-02-28T00:00:00Z', 48),
      new Date('2026-09-30T22:59:59.999Z'),
      new Date('2026-09-30T23:00:00.000Z'),
    ];
    for (const reference of references) {
      for (const key of KEYS) {
        assert.deepEqual(exportRangeDates(key, reference), pageExportWindow(key, reference), `${reference.toISOString()} ${key}`);
      }
    }
  });

  test('agrees with the date filter presets for every key they share', () => {
    for (const reference of hourly('2026-09-30T18:00:00Z', 12)) {
      for (const preset of businessDatePresets(reference)) {
        assert.deepEqual(exportRangeDates(preset.key, reference), { from: preset.from, to: preset.to, label: preset.label });
      }
    }
  });

  test('never depends on the host timezone', () => {
    for (const zone of ZONES) {
      withZone(zone, () => {
        const w = windowsAt(new Date('2026-09-30T23:30:00Z'));
        assert.deepEqual(pair(w.today), ['2026-10-01', '2026-10-01'], zone);
        assert.deepEqual(pair(w.yesterday), ['2026-09-30', '2026-09-30'], zone);
        assert.deepEqual(pair(w.month), ['2026-10-01', '2026-10-01'], zone);
        assert.deepEqual(pair(w['30d']), ['2026-09-02', '2026-10-01'], zone);
      });
    }
  });

  test('defaults to the current Lagos day', () => {
    const earlier = businessDateKey(new Date());
    const today = exportRangeDates('today').from;
    const later = businessDateKey(new Date());
    assert.ok(today === earlier || today === later);
  });
});

describe('export range options', () => {
  test('six presets in menu order with their labels', () => {
    assert.deepEqual(EXPORT_RANGE_OPTIONS.map((option) => option.value), KEYS);
    assert.deepEqual(
      EXPORT_RANGE_OPTIONS.map((option) => option.label),
      ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'This month', 'All time'],
    );
  });

  test('the shared list cannot be mutated by a page', () => {
    assert.ok(Object.isFrozen(EXPORT_RANGE_OPTIONS));
    assert.ok(EXPORT_RANGE_OPTIONS.every((option) => Object.isFrozen(option)));
  });

  test('isExportRangeKey accepts exactly the six keys', () => {
    for (const key of KEYS) assert.equal(isExportRangeKey(key), true, key);
    const rejected = ['filters', '', ' today', 'Today', '90d', 'toString', '__proto__', 'constructor', null, undefined, 7, {}];
    for (const value of rejected) assert.equal(isExportRangeKey(value), false, String(value));
  });
});

describe('formatLagosDateRange', () => {
  test('a single day is one formatted date', () => {
    assert.equal(formatLagosDateRange('2026-10-01', '2026-10-01'), '01 Oct 2026');
  });

  test('a range inside one year names the year once', () => {
    assert.equal(formatLagosDateRange('2026-10-01', '2026-10-15'), '01 Oct – 15 Oct 2026');
    assert.equal(formatLagosDateRange('2026-11-25', '2026-12-24'), '25 Nov – 24 Dec 2026');
  });

  test('a range across years names both years', () => {
    assert.equal(formatLagosDateRange('2025-12-28', '2026-01-03'), '28 Dec 2025 – 03 Jan 2026');
  });

  test('each end renders through formatBusinessDate on its Lagos day', () => {
    const text = formatLagosDateRange('2026-09-01', '2026-09-30');
    assert.ok(text?.endsWith(` – ${formatBusinessDate(lagosDateToRangeStart('2026-09-30'))}`), String(text));
    assert.ok(text?.startsWith('01 Sep'), String(text));
    assert.equal(text?.split('2026').length, 2, String(text));
  });

  test('an open end is described in words', () => {
    assert.equal(formatLagosDateRange('2026-10-01', null), 'On or after 01 Oct 2026');
    assert.equal(formatLagosDateRange(null, '2026-10-31'), 'On or before 31 Oct 2026');
    assert.equal(formatLagosDateRange(undefined, '2026-10-31'), 'On or before 31 Oct 2026');
  });

  test('no valid bound means no window', () => {
    assert.equal(formatLagosDateRange(null, null), null);
    assert.equal(formatLagosDateRange(undefined, undefined), null);
    assert.equal(formatLagosDateRange('2026-02-30', 'not a date'), null);
    assert.equal(formatLagosDateRange('2026-10-01', '2026-13-01'), 'On or after 01 Oct 2026');
  });

  test('never depends on the host timezone', () => {
    for (const zone of ZONES) {
      withZone(zone, () => {
        assert.equal(formatLagosDateRange('2026-10-01', '2026-10-15'), '01 Oct – 15 Oct 2026', zone);
        assert.equal(formatLagosDateRange('2025-12-31', '2025-12-31'), '31 Dec 2025', zone);
      });
    }
  });
});

describe('printExport ranges', () => {
  let lib: PrintExportModule;

  before(async () => {
    lib = await loadAppModule<PrintExportModule>('lib/printExport.ts');
  });

  test('rangeToDates is exportRangeDates for every key and reference', () => {
    for (const reference of [...hourly('2026-09-30T20:00:00Z', 6), ...hourly('2025-12-31T21:00:00Z', 4)]) {
      for (const key of KEYS) {
        assert.deepEqual(lib.rangeToDates(key, reference), exportRangeDates(key, reference), `${reference.toISOString()} ${key}`);
      }
    }
  });

  test('rangeToDates without a reference uses the current Lagos day', () => {
    const earlier = businessDateKey(new Date());
    const today = lib.rangeToDates('today');
    const later = businessDateKey(new Date());
    assert.ok(today.from === earlier || today.from === later);
    assert.equal(today.from, today.to);
  });

  test('rangeToDates follows Lagos, not the browser timezone it used to read', () => {
    for (const zone of ZONES) {
      withZone(zone, () => {
        const reference = new Date('2026-09-30T23:30:00Z');
        assert.deepEqual(pair(lib.rangeToDates('today', reference)), ['2026-10-01', '2026-10-01'], zone);
        assert.deepEqual(pair(lib.rangeToDates('month', reference)), ['2026-10-01', '2026-10-01'], zone);
      });
    }
  });

  test('parseExportRange keeps known values and refuses filters unless allowed', () => {
    for (const key of KEYS) assert.equal(lib.parseExportRange(key), key);
    assert.equal(lib.parseExportRange('filters'), 'filters');
    assert.equal(lib.parseExportRange('filters', false), null);
    for (const value of ['', 'Filters', '90d', null, undefined, 3]) assert.equal(lib.parseExportRange(value), null, String(value));
  });

  test('nextExportRange reports a real change only, never filters without the option, and nothing while busy', () => {
    assert.equal(lib.nextExportRange('30d', '7d'), '30d');
    assert.equal(lib.nextExportRange('filters', '7d', true), 'filters');
    assert.equal(lib.nextExportRange('7d', 'filters', true), '7d');
    assert.equal(lib.nextExportRange('7d', 'filters', false), '7d');
    assert.equal(lib.nextExportRange('7d', '7d'), null);
    assert.equal(lib.nextExportRange('filters', 'filters', true), null);
    assert.equal(lib.nextExportRange('filters', '7d', false), null);
    assert.equal(lib.nextExportRange('90d', '7d'), null);
    assert.equal(lib.nextExportRange('', 'all'), null);
    for (const raw of ['today', 'filters', 'all']) assert.equal(lib.nextExportRange(raw, '7d', true, true), null, raw);
  });

  test('resolveExportRange maps presets through Lagos and passes the on-screen filter dates through', () => {
    const reference = new Date('2026-09-30T23:30:00Z');
    for (const key of KEYS) assert.deepEqual(lib.resolveExportRange(key, null, reference), exportRangeDates(key, reference));
    assert.deepEqual(
      lib.resolveExportRange('filters', { from: '2026-09-01', to: '2026-09-30', label: 'Review tab' }, reference),
      { from: '2026-09-01', to: '2026-09-30', label: 'Review tab' },
    );
    assert.deepEqual(lib.resolveExportRange('filters', { from: '2026-09-01' }), { from: '2026-09-01', to: null, label: 'Current filters' });
    assert.deepEqual(lib.resolveExportRange('filters', { label: '' }), { from: null, to: null, label: 'Current filters' });
    assert.deepEqual(lib.resolveExportRange('filters'), { from: null, to: null, label: 'Current filters' });
  });

  test('describeExportWindow states the Lagos window in WAT, or that there is no date limit', () => {
    assert.equal(lib.describeExportWindow({ from: '2026-10-01', to: '2026-10-07' }), '01 Oct – 07 Oct 2026 (WAT)');
    assert.equal(lib.describeExportWindow({ from: '2026-10-01', to: '2026-10-01' }), '01 Oct 2026 (WAT)');
    assert.equal(lib.describeExportWindow({ from: '2026-10-01', to: null }), 'On or after 01 Oct 2026 (WAT)');
    assert.equal(lib.describeExportWindow({ from: null, to: null }), 'No date limit');
    assert.equal(lib.describeExportWindow({}), 'No date limit');
    assert.equal(lib.describeExportWindow(exportRangeDates('all')), lib.NO_DATE_LIMIT);
  });
});

describe('printTable', () => {
  interface FakeWindow {
    html: string;
    printed: number;
    focused: number;
    opened: unknown[];
  }

  let lib: PrintExportModule;
  let state: FakeWindow;
  let blocked = false;
  const holder = globalThis as unknown as { window?: unknown };

  before(async () => {
    lib = await loadAppModule<PrintExportModule>('lib/printExport.ts');
    holder.window = {
      open: (...args: unknown[]) => {
        state.opened = args;
        if (blocked) return null;
        return {
          document: {
            open: () => { state.html = ''; },
            write: (chunk: string) => { state.html += chunk; },
            close: () => {},
          },
          focus: () => { state.focused += 1; },
          print: () => { state.printed += 1; },
        };
      },
    };
  });

  after(() => {
    delete holder.window;
  });

  const fresh = () => {
    state = { html: '', printed: 0, focused: 0, opened: [] };
    blocked = false;
  };

  test('writes a standalone, escaped document and prints it after the window settles', (t) => {
    fresh();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const ok = lib.printTable({
      title: 'Withdrawals <Review>',
      meta: 'Last 7 days · 25 Sept – 01 Oct 2026 (WAT) · "2" rows',
      columns: ['ID', 'Account', 'Note'],
      rows: [['w-1', '0123456789', '<b>held</b> & flagged'], ['w-2', null, undefined]],
    });
    assert.equal(ok, true);
    assert.deepEqual(state.opened, ['', '_blank', 'width=1000,height=720']);
    assert.ok(state.html.startsWith('<!doctype html>'));
    assert.match(state.html, /<title>Withdrawals &lt;Review&gt;<\/title>/);
    assert.match(state.html, /<div class="meta">Last 7 days · 25 Sept – 01 Oct 2026 \(WAT\) · &quot;2&quot; rows<\/div>/);
    assert.match(state.html, /<tr><th>ID<\/th><th>Account<\/th><th>Note<\/th><\/tr>/);
    assert.match(state.html, /<td>0123456789<\/td>/);
    assert.match(state.html, /<td>&lt;b&gt;held&lt;\/b&gt; &amp; flagged<\/td>/);
    assert.match(state.html, /<tr><td>w-2<\/td><td><\/td><td><\/td><\/tr>/);
    assert.equal(state.focused, 1);
    assert.equal(state.printed, 0);
    t.mock.timers.tick(299);
    assert.equal(state.printed, 0);
    t.mock.timers.tick(1);
    assert.equal(state.printed, 1);
  });

  test('an empty export prints one full-width row saying so', (t) => {
    fresh();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    assert.equal(lib.printTable({ title: 'Users', meta: 'All time', columns: ['A', 'B', 'C', 'D'], rows: [] }), true);
    assert.match(state.html, /<td colspan="4"[^>]*>No rows in this window\.<\/td>/);
  });

  test('a blocked pop-up reports false and writes nothing', (t) => {
    fresh();
    blocked = true;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    assert.equal(lib.printTable({ title: 'Users', meta: '', columns: ['A'], rows: [['x']] }), false);
    assert.equal(state.html, '');
    t.mock.timers.tick(1000);
    assert.equal(state.printed, 0);
  });
});

function elementText(html: string, id: string | undefined): string {
  assert.ok(id, 'missing id');
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`<(\\w+)\\b[^>]*\\bid="${escaped}"[^>]*>`).exec(html);
  assert.ok(open, `no element with id ${id}`);
  const tags = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, 'g');
  tags.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return textOf(html.slice(open.index + open[0].length, match.index));
  }
  throw new Error(`element ${id} is not closed`);
}

function optionsOf(html: string): { value: string; label: string; selected: boolean }[] {
  return [...html.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map((match) => ({
    value: /value="([^"]*)"/.exec(match[1])?.[1] ?? '',
    label: match[2],
    selected: /\bselected=""/.test(match[1]),
  }));
}

function actionButtons(html: string): { attrs: Record<string, string>; text: string; inner: string }[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .map((match) => ({ attrs: tagsOf(`<button${match[1]}>`, 'button')[0], text: textOf(match[2]), inner: match[2] }))
    .filter((button) => classesOf(button.attrs).includes('btn'));
}

describe('ExportModal', () => {
  let ExportModal: ElementType;
  let lib: PrintExportModule;
  const noop = () => {};
  const base = {
    open: true,
    onClose: noop,
    title: 'Export withdrawals',
    subtitle: 'Exports the Review tab with the current search.',
    exporting: null,
    onCsv: noop,
    onPdf: noop,
    onRangeChange: noop,
  };
  const modal = (props: Record<string, unknown>) => render(createElement(ExportModal, { ...base, ...props }));
  const select = (html: string) => {
    const found = tagsOf(html, 'select');
    assert.equal(found.length, 1);
    return found[0];
  };

  before(async () => {
    ExportModal = await loadUiExport('ExportModal.tsx', 'ExportModal');
    lib = await loadAppModule<PrintExportModule>('lib/printExport.ts');
  });

  test('renders nothing while closed', () => {
    assert.equal(modal({ open: false, range: '7d' }), '');
  });

  test('is a named dialog with a labelled time frame select listing the six presets in order', () => {
    const html = modal({ range: '7d' });
    const [dialog] = tagsOf(html, 'div').filter((attrs) => attrs.role === 'dialog');
    assert.equal(dialog['aria-modal'], 'true');
    assert.equal(elementText(html, dialog['aria-labelledby']), 'Export withdrawals');
    const control = select(html);
    const [label] = tagsOf(html, 'label');
    assert.equal(label.for, control.id);
    assert.match(html, /<label[^>]*>Time frame<\/label>/);
    assert.deepEqual(optionsOf(html), EXPORT_RANGE_OPTIONS.map((option) => ({
      value: option.value, label: option.label, selected: option.value === '7d',
    })));
  });

  test('shows the resolved Lagos window under the selection as the select description', () => {
    const beforeText = lib.describeExportWindow(exportRangeDates('7d'));
    const html = modal({ range: '7d' });
    const afterText = lib.describeExportWindow(exportRangeDates('7d'));
    const described = elementText(html, select(html)['aria-describedby']);
    assert.ok(described === beforeText || described === afterText, described);
    assert.match(described, /^\d{2} \w+ – \d{2} \w+ \d{4} \(WAT\)$|^\d{2} \w+ \d{4} – \d{2} \w+ \d{4} \(WAT\)$/);
    const unbounded = modal({ range: 'all' });
    assert.equal(elementText(unbounded, select(unbounded)['aria-describedby']), 'No date limit');
  });

  test('without filtersOption there is no current-filters choice', () => {
    const html = modal({ range: 'today', filtersOption: undefined });
    assert.equal(optionsOf(html).some((option) => option.value === 'filters'), false);
    assert.equal(optionsOf(html).length, 6);
  });

  test('filtersOption adds a first choice that, when selected, shows its description and window', () => {
    const html = modal({
      range: 'filters',
      filtersOption: { label: 'Current filters', description: 'Review tab · search “ada”', from: '2026-10-01', to: '2026-10-15' },
    });
    const options = optionsOf(html);
    assert.deepEqual(options[0], { value: 'filters', label: 'Current filters', selected: true });
    assert.equal(options.length, 7);
    assert.equal(options.filter((option) => option.selected).length, 1);
    const described = elementText(html, select(html)['aria-describedby']);
    assert.equal(described, 'Review tab · search “ada” 01 Oct – 15 Oct 2026 (WAT)');
    assert.equal(withClass(html, 'div', 'description').length, 1);
  });

  test('with filtersOption and a preset selected, the preset window shows and the description does not', () => {
    const html = modal({ range: 'all', filtersOption: { label: 'Match the list', description: 'Review tab' } });
    const options = optionsOf(html);
    assert.deepEqual(options[0], { value: 'filters', label: 'Match the list', selected: false });
    assert.equal(options.find((option) => option.selected)?.value, 'all');
    assert.equal(elementText(html, select(html)['aria-describedby']), 'No date limit');
    assert.equal(withClass(html, 'div', 'description').length, 0);
  });

  test('a filters selection with no date bounds says there is no date limit', () => {
    const html = modal({ range: 'filters', filtersOption: { label: 'Current filters' } });
    assert.equal(elementText(html, select(html)['aria-describedby']), 'No date limit');
  });

  test('a filters value without filtersOption is still shown, so the screen matches what the page exports', () => {
    const html = modal({ range: 'filters' });
    assert.deepEqual(optionsOf(html)[0], { value: 'filters', label: 'Current filters', selected: true });
  });

  test('an unknown range shows All time, the window the page would export', () => {
    const html = modal({ range: '90d' });
    assert.equal(optionsOf(html).find((option) => option.selected)?.value, 'all');
  });

  test('idle: both actions enabled, labelled, typed as buttons, and no status text', () => {
    const html = modal({ range: '7d', metaLine: 'Up to 50,000 rows. You are told if an export is cut short.' });
    const buttons = actionButtons(html);
    assert.deepEqual(buttons.map((button) => button.text), ['Print / PDF', 'Download CSV']);
    for (const button of buttons) {
      assert.equal(button.attrs.type, 'button');
      assert.equal('disabled' in button.attrs, false);
      assert.equal('aria-disabled' in button.attrs, false);
      assert.equal('aria-busy' in button.attrs, false);
      assert.equal('aria-describedby' in button.attrs, false);
    }
    assert.equal('disabled' in select(html), false);
    const status = /<span[^>]*role="status"[^>]*>([^<]*)<\/span>/.exec(html);
    assert.equal(status?.[1], '');
    assert.match(textOf(html), /Up to 50,000 rows\. You are told if an export is cut short\./);
  });

  test('while a CSV export runs both actions are disabled, only CSV shows loading, and the select is locked', () => {
    const html = modal({ range: '7d', exporting: 'csv' });
    const [pdf, csv] = actionButtons(html);
    for (const button of [pdf, csv]) {
      assert.equal(button.attrs['aria-disabled'], 'true');
      assert.equal('disabled' in button.attrs, false);
    }
    assert.equal(csv.attrs['aria-busy'], 'true');
    assert.equal('aria-busy' in pdf.attrs, false);
    assert.match(csv.inner, /lucide-loader-circle[^"]*spinner/);
    assert.doesNotMatch(csv.inner, /lucide-download/);
    assert.match(pdf.inner, /lucide-printer/);
    assert.equal('disabled' in select(html), true);
    assert.match(html, /role="status"[^>]*>Preparing the CSV download\.</);
  });

  test('while a print export runs the print action shows loading instead', () => {
    const html = modal({ range: '7d', exporting: 'pdf' });
    const [pdf, csv] = actionButtons(html);
    assert.equal(pdf.attrs['aria-busy'], 'true');
    assert.equal('aria-busy' in csv.attrs, false);
    assert.ok([pdf, csv].every((button) => button.attrs['aria-disabled'] === 'true'));
    assert.match(pdf.inner, /lucide-loader-circle/);
    assert.match(csv.inner, /lucide-download/);
    assert.match(html, /role="status"[^>]*>Preparing the print view\.</);
  });

  test('the row cap and the sensitive-data note show before the click and describe both actions', () => {
    const html = modal({
      range: '7d',
      rowLimitNote: 'Exports stop at 50,000 rows. You are told if one is cut short.',
      sensitiveNote: 'Includes full bank account numbers.',
    });
    const [limit] = withClass(html, 'div', 'note');
    const [sensitive] = withClass(html, 'div', 'sensitive');
    assert.equal(elementText(html, limit.id), 'Exports stop at 50,000 rows. You are told if one is cut short.');
    assert.equal(elementText(html, sensitive.id), 'Includes full bank account numbers.');
    assert.ok(classesOf(sensitive).includes('note'));
    for (const button of actionButtons(html)) assert.equal(button.attrs['aria-describedby'], `${limit.id} ${sensitive.id}`);
    const order = ['Time frame', 'Exports stop at', 'Includes full bank', 'Print / PDF'].map((marker) => html.indexOf(marker));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  test('a single note is the only description', () => {
    const html = modal({ range: '7d', sensitiveNote: 'Includes full bank account numbers.' });
    const [sensitive] = withClass(html, 'div', 'sensitive');
    for (const button of actionButtons(html)) assert.equal(button.attrs['aria-describedby'], sensitive.id);
    assert.equal(withClass(html, 'div', 'notes').length, 1);
  });

  test('every icon is hidden from assistive tech', () => {
    const html = modal({ range: '7d', exporting: 'csv', rowLimitNote: 'Cap', sensitiveNote: 'Sensitive' });
    const icons = tagsOf(html, 'svg');
    assert.ok(icons.length >= 5);
    assert.ok(icons.every((icon) => icon['aria-hidden'] === 'true'));
  });

  test('the props contract keeps preset-only pages compiling and hands filters only to pages that offer it', () => {
    const setPreset: Dispatch<SetStateAction<RangeKey>> = () => {};
    const setValue: Dispatch<SetStateAction<ExportRangeValue>> = () => {};
    const shared: Omit<ExportModalPresetProps, 'range' | 'onRangeChange' | 'filtersOption'> = {
      open: true, onClose: noop, title: 'Export', exporting: null, onCsv: noop, onPdf: noop,
    };
    const legacy: ExportModalProps = { ...shared, range: '7d', onRangeChange: setPreset, metaLine: 'Up to 50,000 rows.' };
    const widened: ExportModalProps = { ...shared, range: 'filters', onRangeChange: setValue, filtersOption: { label: 'Current filters' } };
    const optional: ExportModalProps = { ...shared, range: 'filters', onRangeChange: setValue, filtersOption: undefined };
    // @ts-expect-error a preset-only handler must not be offered the filters choice
    const mismatched: ExportModalProps = { ...shared, range: '7d', onRangeChange: setPreset, filtersOption: { label: 'Current filters' } };
    // @ts-expect-error a preset-only handler cannot hold the filters value
    const stray: ExportModalProps = { ...shared, range: 'filters', onRangeChange: setPreset };
    assert.ok(legacy && widened && optional && mismatched && stray);
  });
});

describe('export source rules', () => {
  const read = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8');
  const NAMED_COLOUR = /^(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|navy|teal|transparent)$/i;

  test('no prose comments in any file this unit owns', () => {
    for (const path of ['_ui/ExportModal.tsx', '_ui/ExportModal.module.css', 'lib/printExport.ts', 'lib/time.ts']) {
      assert.doesNotMatch(read(path), /\/\*|(?<![:'"])\/\//, path);
    }
  });

  test('the stylesheet uses colour tokens only and every z-index is a scale token', () => {
    const css = read('_ui/ExportModal.module.css');
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
    assert.doesNotMatch(css, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i);
    for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      for (const word of value.split(/[\s,()]+/)) assert.doesNotMatch(word, NAMED_COLOUR, property);
    }
    for (const [, value] of css.matchAll(/z-index\s*:\s*([^;]+);/g)) assert.match(value.trim(), /^var\(--z-[a-z]+\)$/);
  });

  test('motion has a reduced-motion rule', () => {
    const css = read('_ui/ExportModal.module.css');
    assert.match(css, /\banimation\s*:/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  });

  test('the modal is a client component with no inline styles', () => {
    const source = read('_ui/ExportModal.tsx');
    assert.ok(source.startsWith("'use client';"));
    assert.doesNotMatch(source, /\bstyle=/);
  });
});
