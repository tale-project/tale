import { describe, expect, it } from 'vitest';

import { parseSessionId } from './session-id';

describe('parseSessionId', () => {
  it('reads a whole number of one or more', () => {
    expect(parseSessionId('1')).toBe(1);
    expect(parseSessionId('42')).toBe(42);
    expect(parseSessionId('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    '',
    '0',
    '-3',
    '+3',
    '1.5',
    '1e3',
    '0x10',
    '007',
    ' 7',
    '7 ',
    'abc',
    '12abc',
    '9007199254740993',
  ])('names no session: %j', (text) => {
    expect(parseSessionId(text)).toBeNull();
  });
});
