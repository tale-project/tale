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
      modelData: { providerName: 'openai', modelId: 'gpt-5' },
      signals: TRIVIAL,
    });
    expect(trivial.applied).toBe(true);
    expect(trivial.tier).toBe('off');
    expect(trivial.providerOptions).toEqual({
      openai: { reasoningEffort: 'minimal' },
    });

    const hard = buildReasoningOptions({
      modelData: { providerName: 'openai', modelId: 'gpt-5' },
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
      },
      baseProviderOptions: { anthropic: { foo: 1 } },
      signals: { kind: 'utility', promptText: 'whatever' },
    });
    expect(decision.applied).toBe(false);
    expect(decision.providerOptions).toEqual({ anthropic: { foo: 1 } });
  });

  it('merges the overlay onto existing provider options without clobbering', () => {
    const decision = buildReasoningOptions({
      modelData: { providerName: 'openrouter', modelId: 'gpt-5' },
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
});
