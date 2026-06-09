import { describe, expect, it } from 'vitest';

import { resolvePromptCaching } from './strategy';

describe('resolvePromptCaching', () => {
  it('uses the declared capability verbatim', () => {
    // An operator can pin caching off, or force it on for any model.
    expect(
      resolvePromptCaching({
        modelId: 'gpt-4o',
        promptCaching: { mode: 'none' },
      }),
    ).toEqual({ mode: 'none', maxBreakpoints: 0 });

    // Operator can force explicit breakpoints on an unknown model.
    expect(
      resolvePromptCaching({
        modelId: 'some-custom-model',
        promptCaching: { mode: 'explicit-breakpoints', maxBreakpoints: 2 },
      }),
    ).toEqual({ mode: 'explicit-breakpoints', maxBreakpoints: 2 });
  });

  it('defaults maxBreakpoints for operator explicit-breakpoints without a cap', () => {
    expect(
      resolvePromptCaching({
        modelId: 'x',
        promptCaching: { mode: 'explicit-breakpoints' },
      }),
    ).toEqual({ mode: 'explicit-breakpoints', maxBreakpoints: 4 });
  });

  it('zeroes maxBreakpoints for non-explicit operator modes', () => {
    expect(
      resolvePromptCaching({
        modelId: 'x',
        promptCaching: { mode: 'auto-server', maxBreakpoints: 3 },
      }),
    ).toEqual({ mode: 'auto-server', maxBreakpoints: 0 });
  });

  it('falls back to none when no caching capability is declared', () => {
    // There is no built-in family inference in the resolver any more — the
    // capability arrives on `modelData.promptCaching` (config / catalog cache).
    // Family→mode inference lives in the catalog normalizer (`infer.ts`).
    expect(
      resolvePromptCaching({ modelId: 'anthropic/claude-opus-4' }),
    ).toEqual({ mode: 'none', maxBreakpoints: 0 });
    expect(resolvePromptCaching({ modelId: 'gpt-4o' })).toEqual({
      mode: 'none',
      maxBreakpoints: 0,
    });
    expect(resolvePromptCaching({ modelId: 'mistral-large' })).toEqual({
      mode: 'none',
      maxBreakpoints: 0,
    });
  });
});
