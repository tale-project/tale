import { describe, expect, it } from 'vitest';

import { jsonBytes } from './json-bytes';

describe('jsonBytes', () => {
  it('counts the bytes of the JSON text, not its characters', () => {
    expect(jsonBytes('abc')).toBe(5);
    expect(jsonBytes('äö')).toBe(6);
    expect(jsonBytes({ a: [1, 2] })).toBe(11);
    expect(jsonBytes(null)).toBe(4);
  });

  it('counts nothing for a value JSON cannot hold', () => {
    expect(jsonBytes(undefined)).toBe(0);
    expect(jsonBytes(() => 1)).toBe(0);
  });
});
