// @vitest-environment node

/**
 * The shared cron parse (trigger-delivery class): the ONE validator the bind
 * refuses on and the editor previews with. Anything the schedule matcher
 * cannot fire on is refused at parse — a field count other than five, names,
 * `?`, an out-of-range value — with a sentence the author can act on.
 */

import { describe, expect, it } from 'vitest';

import { parseCron, parseField } from './cron.ts';

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

  it('reads 0 and 7 both as Sunday and marks a bare `*` as a wildcard', () => {
    const schedule = parseCron('0 0 * * 0,7');
    expect([...schedule.dayOfWeek.values]).toEqual([0, 7]);
    expect(schedule.dayOfMonth.wildcard).toBe(true);
    expect(schedule.dayOfWeek.wildcard).toBe(false);
  });
});

describe('parseField', () => {
  it('expands lists, ranges and steps', () => {
    expect([...parseField('1,5-7,*/20', 0, 59).values]).toEqual([
      1, 5, 6, 7, 0, 20, 40,
    ]);
  });

  it('refuses a half-open range and a zero step', () => {
    expect(() => parseField('5-', 0, 59)).toThrow('not a range');
    expect(() => parseField('*/0', 0, 59)).toThrow('invalid step');
  });
});
