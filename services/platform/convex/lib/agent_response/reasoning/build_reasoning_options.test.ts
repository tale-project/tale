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

  describe('router reasoning seed (Auto-mode prior blend)', () => {
    const RANK: Record<string, number> = { off: 0, low: 1, medium: 2, high: 3 };
    const GPT5 = {
      providerName: 'openai',
      modelId: 'gpt-5',
      reasoning: { knob: 'effort' as const, supportsMinimal: true },
    };

    it('lifts a lexically-plain prompt when the router seeds high effort', () => {
      const seeded = buildReasoningOptions({
        modelData: GPT5,
        signals: { ...TRIVIAL, effortSeed: 'high' },
      });
      const unseeded = buildReasoningOptions({
        modelData: GPT5,
        signals: TRIVIAL,
      });
      // The seed pulls the heuristic prior up, so a trivial-LOOKING prompt the
      // router judged hard reasons harder than the pure heuristic would.
      expect(RANK[seeded.tier]).toBeGreaterThan(RANK[unseeded.tier]);
    });

    it('an undefined seed reproduces the pure-heuristic decision (additive only)', () => {
      const base = buildReasoningOptions({ modelData: GPT5, signals: HARD });
      const seedless = buildReasoningOptions({
        modelData: GPT5,
        signals: { ...HARD, effortSeed: undefined, creativitySeed: undefined },
      });
      expect(seedless.tier).toBe(base.tier);
      expect(seedless.providerOptions).toEqual(base.providerOptions);
    });

    it('a creativity seed shifts the sampling temperature on a non-reasoning model', () => {
      const sampling = {
        providerName: 'openai',
        modelId: 'openai/gpt-4o',
      };
      const precise = buildReasoningOptions({
        modelData: sampling,
        signals: {
          kind: 'chat',
          promptText: 'summarize this',
          creativitySeed: 'precise',
        },
      });
      const creative = buildReasoningOptions({
        modelData: sampling,
        signals: {
          kind: 'chat',
          promptText: 'summarize this',
          creativitySeed: 'creative',
        },
      });
      expect(creative.temperature).toBeGreaterThan(precise.temperature ?? 0);
    });
  });
});
