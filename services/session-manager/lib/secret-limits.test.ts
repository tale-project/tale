import { describe, expect, it } from 'vitest';

import { longerThan } from './secret-limits.ts';

describe('longerThan', () => {
  it('is false at the limit and true one character past it', () => {
    expect(longerThan('a'.repeat(120), 120)).toBe(false);
    expect(longerThan('a'.repeat(121), 120)).toBe(true);
  });

  it('counts an emoji as one character, as a person does', () => {
    // 61 emoji are 122 UTF-16 units but 61 characters.
    expect(longerThan('😀'.repeat(60), 60)).toBe(false);
    expect(longerThan('😀'.repeat(61), 60)).toBe(true);
  });

  it('is false for an empty text', () => {
    expect(longerThan('', 0)).toBe(false);
  });

  it('knows a text with more than twice the limit in UTF-16 units is over it', () => {
    // At the limit of units there is no need to count, past twice it either.
    expect(longerThan('😀'.repeat(120), 120)).toBe(false); // 240 units, 120 characters
    expect(longerThan('😀'.repeat(121), 120)).toBe(true); // 242 units
    expect(longerThan('a'.repeat(241), 120)).toBe(true);
    expect(longerThan('a'.repeat(5_000_000), 120)).toBe(true);
  });
});
