import { describe, expect, it } from 'vitest';

import { resolveReasoningCapability, tierToEffort } from './capability';

describe('resolveReasoningCapability', () => {
  // The capability arrives already resolved on `modelData.reasoning` (operator
  // provider JSON, with the OpenRouter catalog cache layered under it). There
  // is no built-in family inference here — that lives in the catalog
  // normalizer (`model_capabilities/infer.ts`), covered by normalize.test.ts.

  it('maps an effort config (with the minimal floor) to a tier-filling knob', () => {
    const cap = resolveReasoningCapability({
      modelId: 'gpt-5',
      reasoning: { knob: 'effort', supportsMinimal: true },
    });
    expect(cap).toEqual({
      knob: 'effort',
      selfTruncates: false,
      supportsMinimal: true,
      minBudgetTokens: undefined,
      maxBudgetTokens: undefined,
    });
  });

  it('maps a budgetTokens config to a self-truncating knob', () => {
    const cap = resolveReasoningCapability({
      modelId: 'anthropic/claude-sonnet-4',
      reasoning: { knob: 'budgetTokens', minBudgetTokens: 2048 },
    });
    expect(cap).toEqual({
      knob: 'budgetTokens',
      selfTruncates: true,
      supportsMinimal: undefined,
      minBudgetTokens: 2048,
      maxBudgetTokens: undefined,
    });
  });

  it('disables the governor when config knob is "none"', () => {
    expect(
      resolveReasoningCapability({
        modelId: 'gpt-5',
        reasoning: { knob: 'none' },
      }),
    ).toBeNull();
  });

  it('returns null when no reasoning capability is declared', () => {
    expect(resolveReasoningCapability({ modelId: 'openai/gpt-4o' })).toBeNull();
    expect(
      resolveReasoningCapability({ modelId: 'anthropic/claude-sonnet-4' }),
    ).toBeNull();
  });
});

describe('tierToEffort', () => {
  it('uses minimal floor only when supported', () => {
    expect(tierToEffort('off', true)).toBe('minimal');
    expect(tierToEffort('off', false)).toBe('low');
    expect(tierToEffort('off', undefined)).toBe('low');
  });

  it('passes through the named tiers', () => {
    expect(tierToEffort('low', true)).toBe('low');
    expect(tierToEffort('medium', true)).toBe('medium');
    expect(tierToEffort('high', true)).toBe('high');
  });
});
