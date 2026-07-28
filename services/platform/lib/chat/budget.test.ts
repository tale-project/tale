import { describe, expect, it } from 'vitest';

import { resolveEffectiveWindow } from './budget';

describe('resolveEffectiveWindow', () => {
  it('is the model window when no cap applies', () => {
    expect(resolveEffectiveWindow({ contextWindow: 200_000 })).toBe(200_000);
    expect(
      resolveEffectiveWindow({
        contextWindow: 200_000,
        governanceMaxContext: null,
      }),
    ).toBe(200_000);
    expect(
      resolveEffectiveWindow({
        contextWindow: 200_000,
        governanceMaxContext: 0,
      }),
    ).toBe(200_000);
  });

  it('shrinks to a positive governance cap, never grows', () => {
    expect(
      resolveEffectiveWindow({
        contextWindow: 200_000,
        governanceMaxContext: 32_000,
      }),
    ).toBe(32_000);
    expect(
      resolveEffectiveWindow({
        contextWindow: 8_000,
        governanceMaxContext: 32_000,
      }),
    ).toBe(8_000);
  });
});
