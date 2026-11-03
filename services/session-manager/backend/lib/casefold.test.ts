import { describe, expect, it } from 'vitest';

import { casefold } from './casefold.ts';

describe('casefold', () => {
  it('makes letters of any case equal', () => {
    expect(casefold('Work Browser')).toBe(casefold('wORK bROWSER'));
    expect(casefold('Shop Ä')).toBe(casefold('shop ä'));
  });

  it('folds the way a person means it: the German ß is "ss"', () => {
    expect(casefold('Straße')).toBe(casefold('STRASSE'));
    expect(casefold('ΟΔΥΣΣΕΥΣ')).toBe(casefold('οδυσσευς'));
  });

  it('keeps different texts different, and digits as they are', () => {
    expect(casefold('a')).not.toBe(casefold('b'));
    expect(casefold('0001')).toBe('0001');
  });
});
