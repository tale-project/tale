// @vitest-environment node

/**
 * Local times in a zone, held to a brute-force oracle: for a local time, scan
 * the instants around it, keep every one whose wall clock (read through
 * `formatToParts`, not the module's faster reader) shows exactly that time,
 * and take the earliest — or, when none does, shift forward by the gap.
 * The resolver must agree on every transition-adjacent time of a seeded
 * sample across every zone this runtime knows, and on the 153 local times
 * where Day.js and Luxon picked the later instant of a repeated hour.
 */

import { describe, expect, it } from 'vitest';

import type { CalendarDate } from './calendar.ts';
import {
  canonicalTimeZone,
  isTimeZone,
  localDateIn,
  localTimeZone,
  offsetAt,
  wallClockIn,
  zonedCandidates,
  zonedInstant,
} from './zoned-time.ts';

const MINUTE_MS = 60_000;
const QUARTER_MS = 15 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const day = (text: string): CalendarDate => {
  const [year, month, date] = text.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 0, day: date ?? 0 };
};
const time = (text: string) => {
  const [hour, minute] = text.split(':').map(Number);
  return { hour: hour ?? 0, minute: minute ?? 0 };
};

describe('zonedInstant — the named-time DST matrix', () => {
  it.each([
    // [zone, day, time, the instant, how many instants show that time]
    ['Europe/Zurich', '2026-03-29', '02:30', '2026-03-29T01:30:00Z', 0],
    ['Europe/Zurich', '2026-10-25', '02:30', '2026-10-25T00:30:00Z', 2],
    ['Europe/Zurich', '2026-10-25', '03:30', '2026-10-25T02:30:00Z', 1],
    ['America/New_York', '2026-03-08', '02:30', '2026-03-08T07:30:00Z', 0],
    ['America/New_York', '2026-11-01', '01:30', '2026-11-01T05:30:00Z', 2],
    ['Australia/Lord_Howe', '2026-10-04', '02:15', '2026-10-03T15:45:00Z', 0],
    ['Australia/Lord_Howe', '2026-04-05', '01:45', '2026-04-04T14:45:00Z', 2],
    ['Asia/Kolkata', '2026-03-29', '02:30', '2026-03-28T21:00:00Z', 1],
    ['Asia/Kolkata', '2026-10-25', '02:30', '2026-10-24T21:00:00Z', 1],
  ] as const)('%s %s %s → %s', (zone, date, at, expected, count) => {
    expect(iso(zonedInstant(day(date), time(at), zone))).toBe(expected);
    expect(zonedCandidates(day(date), time(at), zone)).toHaveLength(count);
  });

  it('lists both instants of a repeated time, the first one first', () => {
    expect(
      zonedCandidates(day('2026-10-25'), time('02:30'), 'Europe/Zurich').map(
        iso,
      ),
    ).toEqual(['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']);
    expect(
      zonedCandidates(
        day('2026-04-05'),
        time('01:45'),
        'Australia/Lord_Howe',
      ).map(iso),
    ).toEqual(['2026-04-04T14:45:00Z', '2026-04-04T15:15:00Z']);
  });
});

describe('wallClockIn, offsetAt, localDateIn', () => {
  it('reads the local day, a 24-hour clock and Date#getDay', () => {
    // 2026-10-24T22:30Z is Sunday 00:30 in Zurich (+2).
    expect(
      wallClockIn(Date.UTC(2026, 9, 24, 22, 30, 15), 'Europe/Zurich'),
    ).toEqual({
      year: 2026,
      month: 10,
      day: 25,
      hour: 0,
      minute: 30,
      second: 15,
      weekday: 0,
    });
    expect(localDateIn(Date.UTC(2026, 9, 24, 21, 59), 'Europe/Zurich')).toEqual(
      day('2026-10-24'),
    );
  });

  it('reads offsets east and west of Greenwich, half hours and seconds included', () => {
    expect(offsetAt(Date.UTC(2026, 6, 1), 'Europe/Zurich')).toBe(2 * HOUR_MS);
    expect(offsetAt(Date.UTC(2026, 0, 1), 'America/New_York')).toBe(
      -5 * HOUR_MS,
    );
    expect(offsetAt(Date.UTC(2026, 0, 1), 'Asia/Kathmandu')).toBe(
      5 * HOUR_MS + 45 * MINUTE_MS,
    );
    expect(offsetAt(Date.UTC(2026, 0, 1), '+05:30')).toBe(
      5 * HOUR_MS + 30 * MINUTE_MS,
    );
    // Bern mean time before 1894: +0:29:46.
    expect(offsetAt(Date.UTC(1890, 0, 1), 'Europe/Zurich')).toBe(
      (29 * 60 + 46) * 1000,
    );
  });

  it('throws on a zone Intl does not know', () => {
    expect(() => wallClockIn(0, 'Mars/Olympus_Mons')).toThrow(RangeError);
  });
});

describe('time zone names', () => {
  it.each([
    ['utc', 'UTC'],
    ['europe/zurich', 'Europe/Zurich'],
    [' Europe/Zurich ', 'Europe/Zurich'],
    ['+05:30', '+05:30'],
  ])('canonicalizes %j to %j', (value, expected) => {
    expect(canonicalTimeZone(value)).toBe(expected);
  });

  it.each(['', '   ', 'Mars/Olympus_Mons', 'Europe/'])(
    'names no zone for %j',
    (value) => {
      expect(canonicalTimeZone(value)).toBeNull();
    },
  );

  it.each([
    ['US/Eastern', ['US/Eastern', 'America/New_York']],
    ['Asia/Kolkata', ['Asia/Kolkata', 'Asia/Calcutta']],
  ])(
    'keeps %s valid whichever spelling the runtime answers',
    (value, spellings) => {
      const canonical = canonicalTimeZone(value);
      expect(spellings).toContain(canonical);
      expect(isTimeZone(canonical ?? '')).toBe(true);
    },
  );

  it('takes a name as written for the task rule: a padded one is none', () => {
    expect(isTimeZone('Europe/Zurich')).toBe(true);
    expect(isTimeZone('europe/zurich')).toBe(true);
    expect(isTimeZone(' Europe/Zurich')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  it("answers the runtime's own zone", () => {
    expect(isTimeZone(localTimeZone())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The oracle
// ---------------------------------------------------------------------------

const oracleFormatters = new Map<string, Intl.DateTimeFormat>();
const oracleMemo = new Map<string, Map<number, number>>();

/** The wall clock at `ms`, as if it were UTC, read through named parts. */
function oracleWall(ms: number, zone: string): number {
  let memo = oracleMemo.get(zone);
  if (memo === undefined) {
    memo = new Map();
    oracleMemo.set(zone, memo);
  }
  const seen = memo.get(ms);
  if (seen !== undefined) return seen;
  let formatter = oracleFormatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    oracleFormatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(ms);
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );
  memo.set(ms, wall);
  return wall;
}

const oracleOffset = (ms: number, zone: string) => oracleWall(ms, zone) - ms;

/**
 * Every instant within ±15 h (no zone is further from UTC) whose wall clock
 * shows `local`, and the compatible answer. Offsets in this century are
 * whole quarter hours, so an instant showing `local` sits a whole number of
 * quarter hours from it; a zone that breaks that premise is scanned minute
 * by minute instead.
 */
function brute(
  local: number,
  zone: string,
): { candidates: number[]; compatible: number } {
  const scan = (step: number) => {
    const candidates: number[] = [];
    let lastBelow: number | null = null;
    let premise = true;
    for (
      let at = local - 15 * HOUR_MS;
      at <= local + 15 * HOUR_MS;
      at += step
    ) {
      const wall = oracleWall(at, zone);
      if (oracleOffset(at, zone) % QUARTER_MS !== 0) premise = false;
      if (wall === local) candidates.push(at);
      else if (wall < local) lastBelow = at;
    }
    return { candidates, lastBelow, premise };
  };
  let found = scan(QUARTER_MS);
  if (!found.premise) found = scan(MINUTE_MS);
  const first = found.candidates[0];
  if (first !== undefined) {
    return { candidates: found.candidates, compatible: first };
  }
  if (found.lastBelow === null)
    throw new Error(`no wall clock below ${iso(local)}`);
  return {
    candidates: [],
    compatible: local - oracleOffset(found.lastBelow, zone),
  };
}

interface Transition {
  at: number;
  before: number;
  after: number;
}

/** The offset changes in [from, to), found weekly and bisected to the
 * minute. */
function transitions(zone: string, from: number, to: number): Transition[] {
  const found: Transition[] = [];
  for (let at = from; at < to; at += 7 * DAY_MS) {
    const before = oracleOffset(at, zone);
    if (oracleOffset(at + 7 * DAY_MS, zone) === before) continue;
    let lo = at;
    let hi = at + 7 * DAY_MS;
    while (hi - lo > MINUTE_MS) {
      const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
      if (oracleOffset(mid, zone) === before) lo = mid;
      else hi = mid;
    }
    found.push({ at: hi, before, after: oracleOffset(hi, zone) });
  }
  return found;
}

/** Local times (as if UTC) around a transition: the edges of the skipped or
 * repeated stretch, inside it, and the midnight of its day. */
function targetsAround(t: Transition): number[] {
  const start = Math.min(t.at + t.before, t.at + t.after);
  const end = Math.max(t.at + t.before, t.at + t.after);
  const floor = (ms: number) => Math.floor(ms / MINUTE_MS) * MINUTE_MS;
  return [
    ...new Set([
      floor(start - QUARTER_MS),
      floor(start - MINUTE_MS),
      floor(start),
      floor(start + (end - start) / 2),
      floor(end - MINUTE_MS),
      floor(end),
      floor(end + 7 * MINUTE_MS),
      Math.floor(start / DAY_MS) * DAY_MS,
    ]),
  ];
}

/** mulberry32: a small seeded generator, so a failure replays. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

/** Compare the resolver with the oracle on one local time; a mismatch is
 * described, agreement is null. */
function disagreement(local: number, zone: string): string | null {
  const date = new Date(local);
  const calendar = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
  const clock = { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
  const truth = brute(local, zone);
  const candidates = zonedCandidates(calendar, clock, zone);
  const instant = zonedInstant(calendar, clock, zone);
  if (
    instant === truth.compatible &&
    candidates.length === truth.candidates.length &&
    candidates.every((at, i) => at === truth.candidates[i])
  ) {
    return null;
  }
  return `${zone} ${iso(local).slice(0, 16)} local: resolver ${iso(instant)} [${candidates.map(iso).join(', ')}], oracle ${iso(truth.compatible)} [${truth.candidates.map(iso).join(', ')}]`;
}

/**
 * The local times where Day.js 1.11 and Luxon 3.7 disagreed with this
 * resolver in a sweep of every zone's transition days 2020–2030 at eleven
 * times each (2026-10-08): each library picked the later instant of a
 * repeated hour, or mis-shifted a gap, and the brute-force scan sided with
 * the resolver every time. One line per zone and day.
 */
const DISPUTED = `
Africa/Casablanca 2020-04-19 02:00 02:15 02:30
Africa/Casablanca 2021-04-11 02:00 02:15 02:30
Africa/Casablanca 2022-03-27 02:00 02:15 02:30
Africa/Casablanca 2023-03-19 02:00 02:15 02:30
Africa/Casablanca 2024-03-10 02:00 02:15 02:30
Africa/Casablanca 2025-02-23 02:00 02:15 02:30
Africa/Casablanca 2026-02-15 02:00 02:15 02:30
Africa/Casablanca 2026-09-20 01:00 01:30 01:45
Africa/El_Aaiun 2020-04-19 02:00 02:15 02:30
Africa/El_Aaiun 2021-04-11 02:00 02:15 02:30
Africa/El_Aaiun 2022-03-27 02:00 02:15 02:30
Africa/El_Aaiun 2023-03-19 02:00 02:15 02:30
Africa/El_Aaiun 2024-03-10 02:00 02:15 02:30
Africa/El_Aaiun 2025-02-23 02:00 02:15 02:30
Africa/El_Aaiun 2026-02-15 02:00 02:15 02:30
Africa/El_Aaiun 2026-09-20 01:00 01:30 01:45
Africa/Juba 2021-01-31 23:30
America/Bahia_Banderas 2020-10-25 01:00 01:30 01:45
America/Bahia_Banderas 2021-10-31 01:00 01:30 01:45
America/Bahia_Banderas 2022-10-30 01:00 01:30 01:45
America/Godthab 2020-03-28 23:30
America/Godthab 2021-03-27 23:30
America/Godthab 2022-03-26 23:30
America/Godthab 2023-03-25 23:30
America/Mazatlan 2020-10-25 01:00 01:30 01:45
America/Mazatlan 2021-10-31 01:00 01:30 01:45
America/Mazatlan 2022-10-30 01:00 01:30 01:45
America/Merida 2020-10-25 01:00 01:30 01:45
America/Merida 2021-10-31 01:00 01:30 01:45
America/Merida 2022-10-30 01:00 01:30 01:45
America/Mexico_City 2020-10-25 01:00 01:30 01:45
America/Mexico_City 2021-10-31 01:00 01:30 01:45
America/Mexico_City 2022-10-30 01:00 01:30 01:45
America/Monterrey 2020-10-25 01:00 01:30 01:45
America/Monterrey 2021-10-31 01:00 01:30 01:45
America/Monterrey 2022-10-30 01:00 01:30 01:45
America/Ojinaga 2020-03-08 03:00 03:30
America/Ojinaga 2021-03-14 03:00 03:30
America/Ojinaga 2022-03-13 03:00 03:30
America/Scoresbysund 2020-10-25 00:00 00:30
America/Scoresbysund 2021-10-31 00:00 00:30
America/Scoresbysund 2022-10-30 00:00 00:30
America/Scoresbysund 2023-10-29 00:00 00:30
Antarctica/Casey 2020-03-08 00:00 00:30 01:00 01:30 01:45 02:00 02:15 02:30
Antarctica/Casey 2021-03-13 23:30
Antarctica/Casey 2022-03-12 23:30
Antarctica/Casey 2023-03-09 00:00 00:30 01:00 01:30 01:45 02:00 02:15 02:30
Antarctica/Vostok 2023-12-18 00:00 00:30 01:00 01:30 01:45
Asia/Almaty 2024-02-29 23:30
Asia/Qostanay 2024-02-29 23:30
Asia/Tehran 2020-09-20 23:30
Asia/Tehran 2021-09-21 23:30
Asia/Tehran 2022-09-21 23:30
Europe/Volgograd 2020-12-27 01:00 01:30 01:45
Pacific/Apia 2020-04-05 03:00 03:30
Pacific/Apia 2021-04-04 03:00 03:30
Pacific/Fiji 2020-01-12 02:00 02:15 02:30
Pacific/Fiji 2021-01-17 02:00 02:15 02:30
`;

describe('zonedInstant against the brute-force oracle', () => {
  it('agrees on every local time Day.js and Luxon got wrong', () => {
    const mismatches: string[] = [];
    let checked = 0;
    for (const line of DISPUTED.trim().split('\n')) {
      const [zone = '', date = '', ...times] = line.split(' ');
      // ICU builds differ in the zones they ship; one this runtime does
      // not know has nothing to resolve.
      if (!knownZone(zone)) continue;
      const { year, month, day: d } = day(date);
      for (const at of times) {
        const { hour, minute } = time(at);
        checked += 1;
        const wrong = disagreement(
          Date.UTC(year, month - 1, d, hour, minute),
          zone,
        );
        if (wrong !== null) mismatches.push(wrong);
      }
    }
    expect(mismatches).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(140);
  });

  it('agrees around every 2020–2030 transition of the zones with odd rules', () => {
    const mismatches: string[] = [];
    let shapes = { gap: 0, overlap: 0 };
    for (const zone of [
      'Europe/Zurich',
      'America/New_York',
      'Australia/Lord_Howe',
      'Pacific/Chatham',
      'Africa/Casablanca',
      'America/Santiago',
      'America/Havana',
      'Antarctica/Troll',
    ]) {
      if (!knownZone(zone)) continue;
      for (const t of transitions(
        zone,
        Date.UTC(2020, 0, 1),
        Date.UTC(2031, 0, 1),
      )) {
        if (t.after > t.before) shapes = { ...shapes, gap: shapes.gap + 1 };
        else shapes = { ...shapes, overlap: shapes.overlap + 1 };
        for (const local of targetsAround(t)) {
          const wrong = disagreement(local, zone);
          if (wrong !== null) mismatches.push(wrong);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(shapes.gap).toBeGreaterThan(50);
    expect(shapes.overlap).toBeGreaterThan(50);
  });

  it('agrees on a seeded sample of transition-adjacent times across every zone', () => {
    const random = seeded(20261008);
    const zones = Intl.supportedValuesOf('timeZone');
    const mismatches: string[] = [];
    const counts = { checked: 0, gap: 0, overlap: 0 };
    for (
      let attempt = 0;
      counts.checked < 200 && attempt < 20_000;
      attempt += 1
    ) {
      const zone = zones[Math.floor(random() * zones.length)] ?? 'UTC';
      const year = 2020 + Math.floor(random() * 11);
      const found = transitions(
        zone,
        Date.UTC(year, 0, 1),
        Date.UTC(year + 1, 0, 1),
      );
      const t = found[Math.floor(random() * found.length)];
      if (t === undefined) continue;
      const targets = targetsAround(t);
      const local = targets[Math.floor(random() * targets.length)] ?? 0;
      counts.checked += 1;
      if (t.after > t.before) counts.gap += 1;
      else counts.overlap += 1;
      const wrong = disagreement(local, zone);
      if (wrong !== null) mismatches.push(wrong);
    }
    expect(mismatches).toEqual([]);
    expect(counts.checked).toBe(200);
    expect(counts.gap).toBeGreaterThan(20);
    expect(counts.overlap).toBeGreaterThan(20);
  });
});
