import { describe, expect, it, vi } from 'vitest';

import { durationIso, durationParts, formatDuration } from './format-duration';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** What `Intl.DurationFormat` answers by its specification: each unit by
 *  `Intl.NumberFormat`, joined by `Intl.ListFormat` of type `unit`. */
function specWords(
  locale: string,
  style: 'narrow' | 'short' | 'long',
  parts: ReadonlyArray<[string, number, number]>,
): string {
  const words = parts.map(([unit, value, digits]) =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit,
      unitDisplay: style,
      maximumFractionDigits: digits,
    }).format(value),
  );
  return new Intl.ListFormat(locale, { type: 'unit', style }).format(words);
}

describe('durationParts', () => {
  it.each([
    [0, [['millisecond', 0, 0]]],
    [320, [['millisecond', 320, 0]]],
    [999.4, [['millisecond', 999, 0]]],
    [999.6, [['second', 1, 1]]],
    [3240, [['second', 3.2, 1]]],
    [9960, [['second', 10, 0]]],
    [42 * SECOND, [['second', 42, 0]]],
    [59.6 * SECOND, [['minute', 1, 0]]],
    [
      3 * MINUTE + 12 * SECOND,
      [
        ['minute', 3, 0],
        ['second', 12, 0],
      ],
    ],
    [3 * MINUTE, [['minute', 3, 0]]],
    [
      2 * HOUR + 5 * MINUTE + 20 * SECOND,
      [
        ['hour', 2, 0],
        ['minute', 5, 0],
      ],
    ],
    [HOUR - 400, [['hour', 1, 0]]],
    [
      DAY + 3 * HOUR,
      [
        ['day', 1, 0],
        ['hour', 3, 0],
      ],
    ],
    [3 * DAY, [['day', 3, 0]]],
  ])('%d ms reads in %j', (ms, expected) => {
    expect(
      durationParts(ms).map((part) => [part.unit, part.value, part.digits]),
    ).toEqual(expected);
  });

  it('reads one unit to a tenth with maxUnits 1', () => {
    const one = (ms: number) =>
      durationParts(ms, 1).map((part) => [part.unit, part.value]);
    expect(one(90 * SECOND)).toEqual([['minute', 1.5]]);
    expect(one(3 * MINUTE + 12 * SECOND)).toEqual([['minute', 3.2]]);
    expect(one(90 * MINUTE)).toEqual([['hour', 1.5]]);
    expect(one(36 * HOUR)).toEqual([['day', 1.5]]);
    expect(one(5 * SECOND)).toEqual([['second', 5]]);
  });

  it('reads a negative duration as zero', () => {
    expect(durationParts(-50)).toEqual([
      { unit: 'millisecond', value: 0, digits: 0 },
    ]);
  });
});

describe('formatDuration', () => {
  it('writes English in each range', () => {
    expect(formatDuration(320, 'en')).toBe('320 ms');
    expect(formatDuration(3240, 'en')).toBe('3.2 sec');
    expect(formatDuration(42 * SECOND, 'en')).toBe('42 sec');
    expect(formatDuration(3 * MINUTE + 12 * SECOND, 'en')).toBe(
      '3 min, 12 sec',
    );
    expect(formatDuration(2 * HOUR + 5 * MINUTE, 'en')).toBe('2 hr, 5 min');
    expect(formatDuration(DAY + 3 * HOUR, 'en')).toBe('1 day, 3 hr');
    expect(
      formatDuration(3 * MINUTE + 12 * SECOND, 'en', { style: 'narrow' }),
    ).toBe('3m 12s');
    expect(
      formatDuration(3 * MINUTE + 12 * SECOND, 'en', { style: 'long' }),
    ).toBe('3 minutes, 12 seconds');
  });

  it('says a limit in its largest unit with maxUnits 1', () => {
    expect(formatDuration(250, 'en', { style: 'long', maxUnits: 1 })).toBe(
      '250 milliseconds',
    );
    expect(formatDuration(1000, 'en', { style: 'long', maxUnits: 1 })).toBe(
      '1 second',
    );
    expect(
      formatDuration(90 * SECOND, 'en', { style: 'long', maxUnits: 1 }),
    ).toBe('1.5 minutes');
    expect(
      formatDuration(90 * SECOND, 'de', { style: 'long', maxUnits: 1 }),
    ).toBe('1,5 Minuten');
    expect(
      formatDuration(5 * SECOND, 'fr', { style: 'long', maxUnits: 1 }),
    ).toBe('5 secondes');
  });

  it.each(['en', 'de', 'fr', 'de-CH'])(
    'writes %s the way Intl.DurationFormat composes its units',
    (locale) => {
      for (const style of ['narrow', 'short', 'long'] as const) {
        expect(
          formatDuration(3 * MINUTE + 12 * SECOND, locale, { style }),
        ).toBe(
          specWords(locale, style, [
            ['minute', 3, 0],
            ['second', 12, 0],
          ]),
        );
        expect(formatDuration(3240, locale, { style })).toBe(
          specWords(locale, style, [['second', 3.2, 1]]),
        );
        expect(formatDuration(DAY + 3 * HOUR, locale, { style })).toBe(
          specWords(locale, style, [
            ['day', 1, 0],
            ['hour', 3, 0],
          ]),
        );
      }
    },
  );

  it('reads a value that is not a number as a dash, and a bad locale as English', () => {
    expect(formatDuration(Number.NaN, 'en')).toBe('—');
    expect(formatDuration(Number.POSITIVE_INFINITY, 'en')).toBe('—');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(formatDuration(320, 'not a locale!')).toBe('320 ms');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('durationIso', () => {
  it.each([
    [0, 'PT0S'],
    [3200, 'PT3.2S'],
    [3 * MINUTE + 12 * SECOND, 'PT3M12S'],
    [2 * HOUR + 5 * MINUTE, 'PT2H5M'],
    [DAY + 3 * HOUR, 'P1DT3H'],
    [2 * DAY, 'P2D'],
    [1234, 'PT1.234S'],
    [-10, 'PT0S'],
  ])('%d ms is %s', (ms, expected) => {
    expect(durationIso(ms)).toBe(expected);
  });
});
