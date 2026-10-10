import { describe, expect, it } from 'vitest';

import { groupByDay, localDayKey } from './group-by-day';

const at = (iso: string) => new Date(iso).getTime();

describe('groupByDay', () => {
  it('groups consecutive entries of one local day, in order', () => {
    const entries = [
      { id: 'a', at: at('2026-10-05T09:00:00') },
      { id: 'b', at: at('2026-10-05T17:30:00') },
      { id: 'c', at: at('2026-10-06T08:15:00') },
    ];
    const days = groupByDay(entries, (entry) => entry.at);

    expect(days.map((day) => day.entries.map((entry) => entry.id))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
    expect(days[0]?.at).toBe(entries[0]?.at);
    expect(days[0]?.key).toBe(localDayKey(entries[0]?.at ?? 0));
  });

  it('keeps the given order and never merges a day that recurs later', () => {
    const entries = [
      at('2026-10-05T09:00:00'),
      at('2026-10-06T09:00:00'),
      at('2026-10-05T10:00:00'),
    ];
    expect(groupByDay(entries, (entry) => entry)).toHaveLength(3);
  });

  it('takes a custom day key', () => {
    const entries = [1, 2, 3, 4];
    const days = groupByDay(
      entries,
      (entry) => entry,
      (value) => (value <= 2 ? 'early' : 'late'),
    );
    expect(days.map((day) => day.key)).toEqual(['early', 'late']);
  });

  it('returns no days for no entries', () => {
    expect(groupByDay([], () => 0)).toEqual([]);
  });

  it('keys a day by its local calendar date', () => {
    expect(localDayKey(at('2026-10-05T23:59:00'))).toBe('2026-10-5');
    expect(localDayKey(at('2026-10-06T00:00:00'))).toBe('2026-10-6');
  });
});
