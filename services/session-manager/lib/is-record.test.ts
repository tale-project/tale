import { describe, expect, it } from 'vitest';

import { isRecord } from './is-record.ts';

describe('isRecord', () => {
  it('accepts a plain object', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('refuses everything that is not a JSON object', () => {
    for (const value of [null, undefined, [], [1], 'text', 3, true]) {
      expect(isRecord(value)).toBe(false);
    }
  });
});
