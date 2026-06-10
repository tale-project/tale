import { describe, expect, it } from 'vitest';

import { buildReasoningOptions } from './build_reasoning_options';

const TRIVIAL = { kind: 'chat' as const, promptText: 'hi' };
const HARD = {
  kind: 'chat' as const,
  promptText: 'Please prove that there are infinitely many primes.',
};

describe('buildReasoningOptions', () => {
  it('passes base options through for non-reasoning models (no overlay)', () => {
    const decision = buildReasoningOptions({
      modelData: { providerName: 'openai', modelId: 'openai/gpt-4o' },
      baseProviderOptions: { openai: { foo: 'bar' } },
      signals: HARD,
    });
    expect(decision.applied).toBe(false);
    expect(decision.providerOptions).toEqual({ openai: { foo: 'bar' } });
  });

  it('emits reasoningEffort for effort-knob models', () => {
    const trivial = buildReasoningOptions({
      modelData: {
        providerName: 'openai',
        modelId: 'gpt-5',
        reasoning: { knob: 'effort', supportsMinimal: true },
      },
      signals: TRIVIAL,
    });
    expect(trivial.applied).toBe(true);
    expect(trivial.tier).toBe('off');
    expect(trivial.providerOptions).toEqual({
      openai: { reasoningEffort: 'minimal' },
    });

    const hard = buildReasoningOptions({
      modelData: {
        providerName: 'openai',
        modelId: 'gpt-5',
        reasoning: { knob: 'effort', supportsMinimal: true },
      },
      signals: HARD,
    });
    // A genuine proof rates as high reasoning under the calibrated prior.
    expect(hard.providerOptions).toEqual({
      openai: { reasoningEffort: 'high' },
    });
  });

  it('emits a thinking budget for budget-knob models, capped by output tokens', () => {
    const decision = buildReasoningOptions({
      modelData: {
        providerName: 'anthropic',
        modelId: 'anthropic/claude-sonnet-4',
        reasoning: { knob: 'budgetTokens', minBudgetTokens: 1024 },
        maxOutputTokens: 32768,
      },
      signals: {
        kind: 'chat',
        promptText:
          'Refactor and analyze this large module thoroughly. '.repeat(60),
      },
    });
    expect(decision.applied).toBe(true);
    const thinking = (
      decision.providerOptions?.anthropic as Record<string, unknown>
    )?.thinking as { type: string; budget_tokens: number };
    expect(thinking.type).toBe('enabled');
    expect(thinking.budget_tokens).toBeGreaterThan(0);
    expect(thinking.budget_tokens).toBeLessThanOrEqual(32768 - 1024);
  });

  it('omits the overlay for budget-knob models when the tier is off', () => {
    const decision = buildReasoningOptions({
      modelData: {
        providerName: 'anthropic',
        modelId: 'anthropic/claude-sonnet-4',
        reasoning: { knob: 'budgetTokens', minBudgetTokens: 1024 },
      },
      baseProviderOptions: { anthropic: { foo: 1 } },
      signals: { kind: 'utility', promptText: 'whatever' },
    });
    expect(decision.applied).toBe(false);
    expect(decision.providerOptions).toEqual({ anthropic: { foo: 1 } });
  });

  it('locks the cheap-path floor for effort models (A6): off → minimal (gpt-5) vs low (o-series)', () => {
    // gpt-5 supports the 'minimal' floor.
    const gpt5 = buildReasoningOptions({
      modelData: {
        providerName: 'openai',
        modelId: 'gpt-5',
        reasoning: { knob: 'effort', supportsMinimal: true },
      },
      signals: TRIVIAL,
    });
    expect(gpt5.tier).toBe('off');
    expect(gpt5.providerOptions).toEqual({
      openai: { reasoningEffort: 'minimal' },
    });

    // o-series lacks 'minimal' — 'low' is the irreducible floor on a trivial
    // turn (there is no cheaper legal effort value for these models).
    const o3 = buildReasoningOptions({
      modelData: {
        providerName: 'openai',
        modelId: 'o3-mini',
        reasoning: { knob: 'effort' },
      },
      signals: TRIVIAL,
    });
    expect(o3.tier).toBe('off');
    expect(o3.providerOptions).toEqual({
      openai: { reasoningEffort: 'low' },
    });

    // Budget-knob (Anthropic) models emit NO overlay at off — truly free.
    const claude = buildReasoningOptions({
      modelData: {
        providerName: 'anthropic',
        modelId: 'claude-haiku-4.5',
        reasoning: { knob: 'budgetTokens', minBudgetTokens: 1024 },
      },
      signals: TRIVIAL,
    });
    expect(claude.applied).toBe(false);
  });

  it('merges the overlay onto existing provider options without clobbering', () => {
    const decision = buildReasoningOptions({
      modelData: {
        providerName: 'openrouter',
        modelId: 'gpt-5',
        reasoning: { knob: 'effort', supportsMinimal: true },
      },
      baseProviderOptions: {
        openrouter: { provider: { quantizations: ['fp8'] } },
      },
      signals: HARD,
    });
    expect(decision.providerOptions).toEqual({
      openrouter: {
        provider: { quantizations: ['fp8'] },
        reasoningEffort: 'high',
      },
    });
  });

  describe('per-agent response-tuning bounds', () => {
    it('caps the tier at the effort ceiling on a hard turn', () => {
      const decision = buildReasoningOptions({
        modelData: {
          providerName: 'openai',
          modelId: 'gpt-5',
          reasoning: { knob: 'effort', supportsMinimal: true },
        },
        signals: HARD,
        effortCeilingTier: 'low',
      });
      // HARD alone would be 'high'; the ceiling clamps it to 'low'.
      expect(decision.tier).toBe('low');
      expect(decision.providerOptions).toEqual({
        openai: { reasoningEffort: 'low' },
      });
    });

    it('lifts the tier to the effort floor on a trivial turn', () => {
      const decision = buildReasoningOptions({
        modelData: {
          providerName: 'openai',
          modelId: 'gpt-5',
          reasoning: { knob: 'effort', supportsMinimal: true },
        },
        signals: TRIVIAL,
        effortFloorTier: 'high',
      });
      expect(decision.tier).toBe('high');
    });

    it('caps the thinking budget by the per-class budgetCap', () => {
      const decision = buildReasoningOptions({
        modelData: {
          providerName: 'anthropic',
          modelId: 'anthropic/claude-sonnet-4',
          reasoning: { knob: 'budgetTokens', minBudgetTokens: 1024 },
          maxOutputTokens: 64000,
        },
        signals: {
          kind: 'chat',
          promptText:
            'Refactor and analyze this large module thoroughly. '.repeat(60),
        },
        budgetCaps: { hard: 4096, medium: 4096, easy: 4096 },
      });
      const thinking = (
        decision.providerOptions?.anthropic as Record<string, unknown>
      )?.thinking as { budget_tokens: number };
      expect(thinking.budget_tokens).toBeLessThanOrEqual(4096);
    });

    it('honors a custom temperature range for sampling models', () => {
      const decision = buildReasoningOptions({
        modelData: { providerName: 'openai', modelId: 'openai/gpt-4o' },
        signals: { kind: 'chat', promptText: 'write a creative poem' },
        creativityOverride: 1,
        temperatureRange: { min: 0.2, max: 0.5 },
      });
      // creativity=1 maps to the top of the band → 0.5.
      expect(decision.temperature).toBe(0.5);
    });

    it('is identical to no-tuning when no bounds are set', () => {
      const base = buildReasoningOptions({
        modelData: {
          providerName: 'openai',
          modelId: 'gpt-5',
          reasoning: { knob: 'effort', supportsMinimal: true },
        },
        signals: HARD,
      });
      const tuned = buildReasoningOptions({
        modelData: {
          providerName: 'openai',
          modelId: 'gpt-5',
          reasoning: { knob: 'effort', supportsMinimal: true },
        },
        signals: HARD,
        qualityProfile: 'balanced',
      });
      expect(tuned.tier).toBe(base.tier);
      expect(tuned.providerOptions).toEqual(base.providerOptions);
    });
  });
});
