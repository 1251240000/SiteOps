import { describe, expect, it } from 'vitest';

import {
  addDays,
  enumerateBuckets,
  fillDateRange,
  formatIsoDate,
  parseIsoDate,
  startOfIsoWeek,
} from '../date/fill-range.js';

describe('parseIsoDate / formatIsoDate', () => {
  it('round-trips a UTC date', () => {
    const d = parseIsoDate('2026-03-15');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(2);
    expect(d.getUTCDate()).toBe(15);
    expect(formatIsoDate(d)).toBe('2026-03-15');
  });

  it('rejects malformed strings', () => {
    expect(() => parseIsoDate('2026-1-1')).toThrow();
    expect(() => parseIsoDate('2026/03/15')).toThrow();
    expect(() => parseIsoDate('not-a-date')).toThrow();
  });
});

describe('addDays', () => {
  it('handles month and year rollover', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    // 2024 was a leap year
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});

describe('startOfIsoWeek', () => {
  it('snaps any weekday back to Monday', () => {
    // 2026-05-13 is a Wednesday → Monday is 2026-05-11
    expect(startOfIsoWeek('2026-05-13')).toBe('2026-05-11');
    // 2026-05-11 is already Monday
    expect(startOfIsoWeek('2026-05-11')).toBe('2026-05-11');
    // 2026-05-17 is Sunday → Monday is 2026-05-11
    expect(startOfIsoWeek('2026-05-17')).toBe('2026-05-11');
  });
});

describe('enumerateBuckets', () => {
  it('returns one entry per day inclusive of both endpoints', () => {
    const out = enumerateBuckets('2026-05-01', '2026-05-03', 'day');
    expect(out).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
  });

  it('returns a single bucket when from === to', () => {
    expect(enumerateBuckets('2026-05-01', '2026-05-01', 'day')).toEqual(['2026-05-01']);
  });

  it('returns an empty array when from > to', () => {
    expect(enumerateBuckets('2026-05-10', '2026-05-01', 'day')).toEqual([]);
  });

  it('weekly buckets snap to Monday and step by 7 days', () => {
    // 2026-05-04 (Mon) ... 2026-05-25 (Mon) → 4 weeks
    const out = enumerateBuckets('2026-05-04', '2026-05-25', 'week');
    expect(out).toEqual(['2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25']);
  });

  it('weekly buckets cover partial weeks at both edges', () => {
    // Wed → Wed across 3 weeks → 3 Mondays
    const out = enumerateBuckets('2026-05-06', '2026-05-20', 'week');
    expect(out).toEqual(['2026-05-04', '2026-05-11', '2026-05-18']);
  });
});

describe('fillDateRange', () => {
  type Row = { date: string; pv: number };
  const factory = (date: string): Row => ({ date, pv: 0 });

  it('returns zero-filled rows when input is empty', () => {
    const out = fillDateRange<Row>(
      [],
      { from: '2026-05-01', to: '2026-05-03' },
      (r) => r.date,
      factory,
    );
    expect(out).toEqual([
      { date: '2026-05-01', pv: 0 },
      { date: '2026-05-02', pv: 0 },
      { date: '2026-05-03', pv: 0 },
    ]);
  });

  it('keeps a single existing row and pads the rest', () => {
    const rows: Row[] = [{ date: '2026-05-02', pv: 42 }];
    const out = fillDateRange<Row>(
      rows,
      { from: '2026-05-01', to: '2026-05-03' },
      (r) => r.date,
      factory,
    );
    expect(out).toEqual([
      { date: '2026-05-01', pv: 0 },
      { date: '2026-05-02', pv: 42 },
      { date: '2026-05-03', pv: 0 },
    ]);
  });

  it('preserves order of present rows but always returns ascending dates', () => {
    const rows: Row[] = [
      { date: '2026-05-03', pv: 30 },
      { date: '2026-05-01', pv: 10 },
    ];
    const out = fillDateRange<Row>(
      rows,
      { from: '2026-05-01', to: '2026-05-03' },
      (r) => r.date,
      factory,
    );
    expect(out.map((r) => r.date)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
    expect(out[0]?.pv).toBe(10);
    expect(out[2]?.pv).toBe(30);
  });

  it('drops rows outside the requested window', () => {
    const rows: Row[] = [
      { date: '2026-04-30', pv: 99 }, // before from
      { date: '2026-05-01', pv: 10 },
      { date: '2026-05-04', pv: 99 }, // after to
    ];
    const out = fillDateRange<Row>(
      rows,
      { from: '2026-05-01', to: '2026-05-02' },
      (r) => r.date,
      factory,
    );
    expect(out).toEqual([
      { date: '2026-05-01', pv: 10 },
      { date: '2026-05-02', pv: 0 },
    ]);
  });

  it('densifies a weekly series', () => {
    const rows: Row[] = [{ date: '2026-05-11', pv: 7 }];
    const out = fillDateRange<Row>(
      rows,
      { from: '2026-05-04', to: '2026-05-18', granularity: 'week' },
      (r) => r.date,
      factory,
    );
    expect(out).toEqual([
      { date: '2026-05-04', pv: 0 },
      { date: '2026-05-11', pv: 7 },
      { date: '2026-05-18', pv: 0 },
    ]);
  });

  it('returns an empty array for inverted ranges', () => {
    const out = fillDateRange<Row>(
      [],
      { from: '2026-05-03', to: '2026-05-01' },
      (r) => r.date,
      factory,
    );
    expect(out).toEqual([]);
  });

  it('handles a window of length 1', () => {
    const out = fillDateRange<Row>(
      [{ date: '2026-05-01', pv: 1 }],
      { from: '2026-05-01', to: '2026-05-01' },
      (r) => r.date,
      factory,
    );
    expect(out).toEqual([{ date: '2026-05-01', pv: 1 }]);
  });
});
