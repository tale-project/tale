import { describe, expect, spyOn, test } from 'bun:test';

import { namesOtherIncarnation, readIncarnation } from './incarnation.ts';

describe('readIncarnation', () => {
  test('a launch without a stamp names no incarnation', () => {
    expect(readIncarnation(undefined)).toBeUndefined();
    expect(readIncarnation('')).toBeUndefined();
  });

  test('a creation stamp is named as given', () => {
    expect(readIncarnation('1760000000000')).toBe('1760000000000');
    expect(readIncarnation('0')).toBe('0');
  });

  test.each(['1760000000000.5', '-1', ' 1760000000000', 'abc', '1'.repeat(17)])(
    'a malformed stamp %p is never named',
    (raw) => {
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(readIncarnation(raw)).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    },
  );
});

describe('namesOtherIncarnation', () => {
  test('only a request naming another stamp to a daemon that has one is refused', () => {
    expect(namesOtherIncarnation('1760000000000', '1760000000001')).toBe(true);
    expect(namesOtherIncarnation('1760000000000', ['1', '1760000000000'])).toBe(
      true,
    );
    expect(namesOtherIncarnation('1760000000000', '1760000000000')).toBe(false);
    expect(namesOtherIncarnation('1760000000000', undefined)).toBe(false);
    expect(namesOtherIncarnation('1760000000000', '')).toBe(false);
    expect(namesOtherIncarnation(undefined, '1760000000001')).toBe(false);
  });
});
