import { describe, expect, it } from 'vitest';

import { MASK_PLACEHOLDER, maskSecret } from './masking';

describe('maskSecret', () => {
  it('excerpts first4…last2 of a normal-length secret', () => {
    expect(maskSecret('sk-or-v1-abcdef123456')).toBe('sk-o…56');
  });

  it('trims before excerpting so padding cannot shift the excerpt', () => {
    expect(maskSecret('  sk-or-v1-abcdef123456  ')).toBe('sk-o…56');
  });

  it('degrades to the fixed placeholder for short secrets', () => {
    expect(maskSecret('short')).toBe(MASK_PLACEHOLDER);
    expect(maskSecret('123456789')).toBe(MASK_PLACEHOLDER);
    expect(maskSecret('')).toBe(MASK_PLACEHOLDER);
  });

  it('never returns the input itself at the boundary length', () => {
    const boundary = 'ABCDEFGHIJ';
    expect(maskSecret(boundary)).toBe('ABCD…IJ');
    expect(maskSecret(boundary)).not.toBe(boundary);
  });
});
