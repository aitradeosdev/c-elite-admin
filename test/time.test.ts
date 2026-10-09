import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_TZ,
  businessDateKey,
  businessDatePresets,
  businessDayEnd,
  businessDayStart,
  businessDaysAgoStart,
  businessRange,
  businessToday,
  formatAge,
  formatBusinessDate,
  formatBusinessDateTime,
  isBusinessDateKey,
  lagosDateToRangeEnd,
  lagosDateToRangeStart,
  previousBusinessRange,
  type BusinessDatePreset,
  type BusinessDatePresetKey,
} from '../app/lib/time.ts';

describe('business day boundary', () => {
  test('Lagos midnight is 23:00 UTC the previous day', () => {
    const start = businessDayStart(new Date('2026-09-30T12:00:00Z'));
    assert.equal(start.toISOString(), '2026-09-29T23:00:00.000Z');
  });

  test('an instant just after Lagos midnight belongs to the new day', () => {
    const start = businessDayStart(new Date('2026-09-30T23:30:00Z'));
    assert.equal(start.toISOString(), '2026-09-30T23:00:00.000Z');
  });

  test('an instant just before Lagos midnight belongs to the old day', () => {
    const start = businessDayStart(new Date('2026-09-30T22:59:59Z'));
    assert.equal(start.toISOString(), '2026-09-29T23:00:00.000Z');
  });

  test('the 00:00-01:00 UTC window still counts as the previous Lagos day', () => {
    const start = businessDayStart(new Date('2026-09-30T00:30:00Z'));
    assert.equal(start.toISOString(), '2026-09-29T23:00:00.000Z');
  });

  test('year boundary', () => {
    const start = businessDayStart(new Date('2026-01-01T00:10:00Z'));
    assert.equal(start.toISOString(), '2025-12-31T23:00:00.000Z');
  });

  test('day end is exactly 24h after day start', () => {
    const ref = new Date('2026-09-30T12:00:00Z');
    assert.equal(businessDayEnd(ref).getTime() - businessDayStart(ref).getTime(), 86400000);
  });

  test('the result never depends on the host timezone', () => {
    assert.equal(
      businessDayStart(new Date('2026-06-15T03:00:00Z')).toISOString(),
      '2026-06-14T23:00:00.000Z',
    );
    assert.equal(BUSINESS_TZ, 'Africa/Lagos');
  });
});

describe('ranges', () => {
  test('today is a 24h window starting at Lagos midnight', () => {
    const r = businessToday(new Date('2026-09-30T12:00:00Z'));
    assert.equal(r.from_iso, '2026-09-29T23:00:00.000Z');
    assert.equal(r.to_iso, '2026-09-30T23:00:00.000Z');
  });

  test('a 7-day range covers 7 Lagos days and ends at today end', () => {
    const r = businessRange(7, new Date('2026-09-30T12:00:00Z'));
    assert.equal(r.to.getTime() - r.from.getTime(), 7 * 86400000);
    assert.equal(r.to_iso, '2026-09-30T23:00:00.000Z');
    assert.equal(r.from_iso, '2026-09-23T23:00:00.000Z');
  });

  test('a 1-day range equals today', () => {
    const ref = new Date('2026-09-30T12:00:00Z');
    assert.equal(businessRange(1, ref).from_iso, businessToday(ref).from_iso);
    assert.equal(businessRange(1, ref).to_iso, businessToday(ref).to_iso);
  });

  test('the comparison window is the equal-length window immediately before', () => {
    const r = businessRange(7, new Date('2026-09-30T12:00:00Z'));
    const p = previousBusinessRange(r);
    assert.equal(p.to_iso, r.from_iso);
    assert.equal(p.to.getTime() - p.from.getTime(), r.to.getTime() - r.from.getTime());
    assert.equal(p.from_iso, '2026-09-16T23:00:00.000Z');
  });

  test('daysAgoStart lands on a Lagos midnight', () => {
    const d = businessDaysAgoStart(3, new Date('2026-09-30T12:00:00Z'));
    assert.equal(d.toISOString(), '2026-09-26T23:00:00.000Z');
  });
});

describe('formatting', () => {
  test('date key uses the Lagos calendar date', () => {
    assert.equal(businessDateKey('2026-09-30T23:30:00Z'), '2026-10-01');
    assert.equal(businessDateKey('2026-09-30T22:30:00Z'), '2026-09-30');
  });

  test('date and datetime render in Lagos time', () => {
    assert.equal(formatBusinessDate('2026-09-30T23:30:00Z'), '01 Oct 2026');
    assert.equal(formatBusinessDateTime('2026-09-30T23:30:00Z'), '01 Oct 2026, 00:30');
  });

  test('nullish and invalid values render as an em dash, never as an epoch date', () => {
    assert.equal(formatBusinessDate(null), '—');
    assert.equal(formatBusinessDate(undefined), '—');
    assert.equal(formatBusinessDate(''), '—');
    assert.equal(formatBusinessDate('not a date'), '—');
    assert.equal(formatBusinessDateTime(null), '—');
  });

  test('age buckets', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
    assert.equal(formatAge(ago(30_000), now), '<1m');
    assert.equal(formatAge(ago(12 * 60_000), now), '12m');
    assert.equal(formatAge(ago(2 * 3_600_000), now), '2h');
    assert.equal(formatAge(ago(3 * 86_400_000), now), '3d');
    assert.equal(formatAge(ago(60 * 86_400_000), now), '2mo');
    assert.equal(formatAge(ago(800 * 86_400_000), now), '2y');
  });

  test('a future timestamp does not render a negative age', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    assert.equal(formatAge(new Date(now.getTime() + 60_000).toISOString(), now), '<1m');
  });
});

function dayKeyAfter(start: string, days: number): string {
  const [year, month, day] = start.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function presetsAt(reference: Date): Record<BusinessDatePresetKey, BusinessDatePreset> {
  const byKey = {} as Record<BusinessDatePresetKey, BusinessDatePreset>;
  for (const preset of businessDatePresets(reference)) byKey[preset.key] = preset;
  return byKey;
}

describe('Lagos calendar date bounds', () => {
  test('a Lagos date starts at 23:00 UTC the previous day', () => {
    assert.equal(lagosDateToRangeStart('2026-09-30'), '2026-09-29T23:00:00.000Z');
  });

  test('the end bound is the start of the next Lagos day, so it is exclusive', () => {
    assert.equal(lagosDateToRangeEnd('2026-09-30'), '2026-09-30T23:00:00.000Z');
    assert.equal(lagosDateToRangeEnd('2026-09-30'), lagosDateToRangeStart('2026-10-01'));
  });

  test('the first hour of the Lagos day is inside the range, which a bare UTC date misses', () => {
    const start = Date.parse(lagosDateToRangeStart('2026-09-30')!);
    const end = Date.parse(lagosDateToRangeEnd('2026-09-30')!);
    const halfPastMidnightInLagos = Date.parse('2026-09-29T23:30:00Z');
    assert.ok(halfPastMidnightInLagos >= start && halfPastMidnightInLagos < end);
    assert.ok(halfPastMidnightInLagos < Date.parse('2026-09-30'));
  });

  test('the last instant of the Lagos day is inside and the next Lagos midnight is not', () => {
    const end = Date.parse(lagosDateToRangeEnd('2026-09-30')!);
    assert.ok(Date.parse('2026-09-30T22:59:59.999Z') < end);
    assert.equal(Date.parse('2026-09-30T23:00:00.000Z'), end);
  });

  test('month boundaries', () => {
    assert.equal(lagosDateToRangeStart('2026-10-01'), '2026-09-30T23:00:00.000Z');
    assert.equal(lagosDateToRangeEnd('2026-04-30'), '2026-04-30T23:00:00.000Z');
    assert.equal(lagosDateToRangeEnd('2026-02-28'), lagosDateToRangeStart('2026-03-01'));
  });

  test('leap days', () => {
    assert.equal(lagosDateToRangeStart('2028-02-29'), '2028-02-28T23:00:00.000Z');
    assert.equal(lagosDateToRangeEnd('2028-02-28'), lagosDateToRangeStart('2028-02-29'));
    assert.equal(lagosDateToRangeEnd('2028-02-29'), '2028-02-29T23:00:00.000Z');
    assert.equal(lagosDateToRangeStart('2027-02-29'), null);
  });

  test('year boundaries', () => {
    assert.equal(lagosDateToRangeStart('2026-01-01'), '2025-12-31T23:00:00.000Z');
    assert.equal(lagosDateToRangeEnd('2025-12-31'), '2025-12-31T23:00:00.000Z');
    assert.equal(lagosDateToRangeEnd('2025-12-31'), lagosDateToRangeStart('2026-01-01'));
  });

  test('consecutive Lagos days tile a year and a half with no gap or overlap', () => {
    let day = '2025-11-01';
    for (let i = 0; i < 550; i++) {
      const next = dayKeyAfter(day, 1);
      const start = Date.parse(lagosDateToRangeStart(day)!);
      const end = Date.parse(lagosDateToRangeEnd(day)!);
      assert.equal(end - start, 86_400_000, day);
      assert.equal(lagosDateToRangeEnd(day), lagosDateToRangeStart(next), day);
      day = next;
    }
  });

  test('agrees with the existing business range helpers', () => {
    const range = businessRange(7, new Date('2026-09-30T12:00:00Z'));
    assert.equal(lagosDateToRangeStart('2026-09-24'), range.from_iso);
    assert.equal(lagosDateToRangeEnd('2026-09-30'), range.to_iso);
    assert.equal(lagosDateToRangeStart(businessDateKey(range.from)), range.from_iso);
  });

  test('missing, malformed or impossible dates return null instead of throwing', () => {
    const bad = [
      null, undefined, '', ' ', 'not a date', '2026-9-30', '2026-09-3', '20260930', '2026/09/30', '30-09-2026',
      '2026-09-30T00:00:00Z', ' 2026-09-30', '2026-09-30 ', '+02026-09-30', '2026-02-29', '2026-04-31',
      '2026-13-01', '2026-00-10', '2026-09-00', '0020-09-30',
    ];
    for (const value of bad) {
      assert.equal(lagosDateToRangeStart(value), null, String(value));
      assert.equal(lagosDateToRangeEnd(value), null, String(value));
    }
  });
});

describe('business date keys', () => {
  test('only real calendar dates in YYYY-MM-DD form are accepted', () => {
    for (const ok of ['2026-09-30', '2028-02-29', '1999-12-31', '2026-01-01']) {
      assert.equal(isBusinessDateKey(ok), true, ok);
    }
    for (const bad of ['2026-02-29', '2026-04-31', '2026-9-30', '', null, undefined, 20260930, new Date('2026-09-30')]) {
      assert.equal(isBusinessDateKey(bad), false, String(bad));
    }
  });

  test('a year that is still being typed is not a date yet', () => {
    for (const partial of ['0002-09-30', '0020-09-30', '0202-09-30']) {
      assert.equal(isBusinessDateKey(partial), false, partial);
    }
  });

  test('keys produced by businessDateKey are always accepted', () => {
    for (const iso of ['2026-09-30T23:30:00Z', '2025-12-31T23:59:59Z', '2028-02-29T12:00:00Z']) {
      assert.equal(isBusinessDateKey(businessDateKey(iso)), true, iso);
    }
  });
});

describe('business date presets', () => {
  test('today, last 7 days, last 30 days, this month and all time, in that order', () => {
    const presets = businessDatePresets(new Date('2026-09-30T12:00:00Z'));
    assert.deepEqual(presets.map((p) => p.key), ['today', '7d', '30d', 'month', 'all']);
    assert.deepEqual(presets.map((p) => p.label), ['Today', 'Last 7 days', 'Last 30 days', 'This month', 'All time']);
  });

  test('ranges end today and count today as one of their days', () => {
    const p = presetsAt(new Date('2026-09-15T12:00:00Z'));
    assert.deepEqual([p.today.from, p.today.to], ['2026-09-15', '2026-09-15']);
    assert.deepEqual([p['7d'].from, p['7d'].to], ['2026-09-09', '2026-09-15']);
    assert.deepEqual([p['30d'].from, p['30d'].to], ['2026-08-17', '2026-09-15']);
    assert.deepEqual([p.month.from, p.month.to], ['2026-09-01', '2026-09-15']);
    assert.deepEqual([p.all.from, p.all.to], [null, null]);
  });

  test('today follows the Lagos calendar, not UTC', () => {
    const afterMidnight = presetsAt(new Date('2026-09-30T23:30:00Z'));
    assert.deepEqual(
      [afterMidnight.today.from, afterMidnight.month.from, afterMidnight['7d'].from],
      ['2026-10-01', '2026-10-01', '2026-09-25'],
    );
    const beforeMidnight = presetsAt(new Date('2026-09-30T22:59:59Z'));
    assert.deepEqual([beforeMidnight.today.from, beforeMidnight.month.from], ['2026-09-30', '2026-09-01']);
  });

  test('ranges cross month boundaries', () => {
    const p = presetsAt(new Date('2026-03-03T09:00:00Z'));
    assert.deepEqual([p['7d'].from, p['30d'].from, p.month.from], ['2026-02-25', '2026-02-02', '2026-03-01']);
  });

  test('ranges cross year boundaries, including the Lagos new year', () => {
    const p = presetsAt(new Date('2026-01-03T10:00:00Z'));
    assert.deepEqual([p['7d'].from, p['30d'].from, p.month.from], ['2025-12-28', '2025-12-05', '2026-01-01']);
    const newYear = presetsAt(new Date('2025-12-31T23:30:00Z'));
    assert.deepEqual(
      [newYear.today.from, newYear.month.from, newYear['7d'].from],
      ['2026-01-01', '2026-01-01', '2025-12-26'],
    );
  });

  test('leap years', () => {
    const march = presetsAt(new Date('2028-03-01T12:00:00Z'));
    assert.deepEqual([march['7d'].from, march['30d'].from], ['2028-02-24', '2028-02-01']);
    const leapDay = presetsAt(new Date('2028-02-29T12:00:00Z'));
    assert.deepEqual([leapDay.today.from, leapDay.month.from], ['2028-02-29', '2028-02-01']);
  });

  test('on the first of the month, this month is the same single day as today', () => {
    const p = presetsAt(new Date('2026-10-01T08:00:00Z'));
    assert.deepEqual([p.month.from, p.month.to], [p.today.from, p.today.to]);
  });

  test('presets resolve to the same instants as the business range helpers', () => {
    const reference = new Date('2026-09-30T12:00:00Z');
    const p = presetsAt(reference);
    for (const [key, days] of [['today', 1], ['7d', 7], ['30d', 30]] as const) {
      const range = businessRange(days, reference);
      assert.equal(lagosDateToRangeStart(p[key].from), range.from_iso, key);
      assert.equal(lagosDateToRangeEnd(p[key].to), range.to_iso, key);
    }
  });

  test('every bounded preset is an ordered pair of valid date keys', () => {
    for (const iso of ['2026-01-01T00:30:00Z', '2026-02-28T23:30:00Z', '2026-09-30T12:00:00Z', '2028-02-29T23:00:00Z']) {
      for (const { key, from, to } of businessDatePresets(new Date(iso))) {
        if (key === 'all') continue;
        assert.ok(isBusinessDateKey(from) && isBusinessDateKey(to), `${iso} ${key}`);
        assert.ok(from <= to, `${iso} ${key}`);
      }
    }
  });

  test('defaults to the current Lagos day', () => {
    const before = businessDateKey(new Date());
    const today = businessDatePresets()[0].from;
    const after = businessDateKey(new Date());
    assert.ok(today === before || today === after);
  });

  test('neither the bounds nor the presets depend on the host timezone', () => {
    const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const original = process.env.TZ;
    try {
      for (const zone of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata', 'Africa/Lagos']) {
        process.env.TZ = zone;
        assert.equal(lagosDateToRangeStart('2026-03-29'), '2026-03-28T23:00:00.000Z', zone);
        assert.equal(lagosDateToRangeEnd('2026-10-31'), '2026-10-31T23:00:00.000Z', zone);
        const p = presetsAt(new Date('2026-09-30T23:30:00Z'));
        assert.deepEqual([p.today.from, p.month.from, p['30d'].from], ['2026-10-01', '2026-10-01', '2026-09-02'], zone);
      }
    } finally {
      process.env.TZ = original ?? hostZone;
    }
  });
});
