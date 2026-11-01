// @vitest-environment node

/**
 * The shared cron parse (trigger-delivery class): the ONE validator the bind
 * refuses on and the editor previews with. Anything the schedule matcher
 * cannot fire on is refused at parse — a field count other than five, names,
 * `?`, an out-of-range value — with a sentence the author can act on, and
 * with the facts of that sentence (`problem`) for the editors to word in the
 * author's language.
 */

import { describe, expect, it } from 'vitest';

import {
  CronImpossibleDateError,
  CronParseError,
  cronDstClass,
  cronParseProblem,
  parseCron,
  parseField,
} from './cron.ts';

describe('parseCron', () => {
  it.each(['* * * * *', '0 */6 * * *', '43 7 * * *', '0 9 * * 1-5'])(
    'accepts %s',
    (expression) => {
      expect(() => parseCron(expression)).not.toThrow();
    },
  );

  it.each([
    ['*/1 * * *', 'got 4'],
    ['0 0 * * * *', 'got 6'],
    ['0 9 * * MON', '"MON" is out of range (0..7)'],
    ['0 9 ? * 1', '"?" is out of range (1..31)'],
    ['61 * * * *', '"61" is out of range (0..59)'],
    ['0 0 31 2 *', 'never'],
  ])('refuses %s, saying why', (expression, sentence) => {
    expect(() => parseCron(expression)).toThrow(sentence);
  });

  it('refuses with a CronParseError, an impossible date included', () => {
    expect(() => parseCron('0 9 * * MON')).toThrow(CronParseError);
    expect(() => parseCron('0 0 31 2 *')).toThrow(CronImpossibleDateError);
    expect(new CronImpossibleDateError({ days: [31], months: [2] })).toEqual(
      expect.objectContaining({
        name: 'CronImpossibleDateError',
        problem: { kind: 'impossible_date', days: [31], months: [2] },
      }),
    );
  });

  it('reads 0 and 7 both as Sunday and marks a bare `*` as a wildcard', () => {
    const schedule = parseCron('0 0 * * 0,7');
    expect([...schedule.dayOfWeek.values]).toEqual([0, 7]);
    expect(schedule.dayOfMonth.wildcard).toBe(true);
    expect(schedule.dayOfWeek.wildcard).toBe(false);
  });
});

describe('parseField', () => {
  it('expands lists, ranges and steps', () => {
    expect([...parseField('1,5-7,*/20', 0, 59, 'minute').values]).toEqual([
      1, 5, 6, 7, 0, 20, 40,
    ]);
  });

  it('refuses a half-open range and a zero step', () => {
    expect(() => parseField('5-', 0, 59, 'minute')).toThrow('not a range');
    expect(() => parseField('*/0', 0, 59, 'minute')).toThrow('invalid step');
  });
});

describe('cronParseProblem', () => {
  it('is null for an expression that parses', () => {
    expect(cronParseProblem('0 9 * * 1-5')).toBeNull();
  });

  // The facts each refusal's sentence is worded from: the text as written,
  // the field it stands in, and the values that field takes.
  it.each([
    ['*/1 * * *', { kind: 'field_count', count: 4 }],
    ['1,,2 * * * *', { kind: 'empty_entry', field: 'minute', token: '1,,2' }],
    ['*/0 * * * *', { kind: 'invalid_step', field: 'minute', token: '*/0' }],
    ['0 5- * * *', { kind: 'not_a_range', field: 'hour', token: '5-' }],
    [
      '0 9 * * MON',
      {
        kind: 'out_of_range',
        field: 'dayOfWeek',
        token: 'MON',
        min: 0,
        max: 7,
      },
    ],
    [
      '0 0 1 5-1 *',
      { kind: 'out_of_range', field: 'month', token: '5-1', min: 1, max: 12 },
    ],
    ['0 0 31 6,4 *', { kind: 'impossible_date', days: [31], months: [4, 6] }],
  ] as const)('names what is wrong with %s', (expression, problem) => {
    expect(cronParseProblem(expression)).toEqual(problem);
  });
});

describe('cronDstClass', () => {
  it.each([
    ['30 2 * * *', 'named'],
    ['0 9 * * 1-5', 'named'],
    ['0,30 8-18 * * *', 'named'],
    ['0 9-17/2 * * *', 'named'],
    ['*/15 * * * *', 'grid'],
    ['* * * * *', 'grid'],
    ['30 * * * *', 'grid'],
    ['0 */6 * * *', 'grid'],
    ['*/10 9-17 * * 1-5', 'grid'],
  ] as const)('reads %s as %s', (expression, dstClass) => {
    expect(cronDstClass(parseCron(expression))).toBe(dstClass);
  });

  it('marks a field starred by its text, a stepped wildcard included', () => {
    expect(parseField('*/15', 0, 59, 'minute')).toMatchObject({
      starred: true,
      wildcard: false,
    });
    expect(parseField('*', 0, 23, 'hour')).toMatchObject({
      starred: true,
      wildcard: true,
    });
    expect(parseField('0-59/15', 0, 59, 'minute').starred).toBe(false);
  });
});
