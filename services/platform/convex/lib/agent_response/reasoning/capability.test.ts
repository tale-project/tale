import { describe, expect, it } from 'vitest';

import { resolveReasoningCapability, tierToEffort } from './capability';

describe('resolveReasoningCapability', () => {
  it('honors an explicit operator config over the curated table', () => {
    const cap = resolveReasoningCapability({
      modelId: 'gpt-5',
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

  it('maps OpenAI reasoning families to the effort knob', () => {
    expect(resolveReasoningCapability({ modelId: 'gpt-5' })).toEqual({
      knob: 'effort',
      selfTruncates: false,
      supportsMinimal: true,
    });
    expect(resolveReasoningCapability({ modelId: 'gpt-5.1' })?.knob).toBe(
      'effort',
    );
    expect(resolveReasoningCapability({ modelId: 'o1' })?.knob).toBe('effort');
    expect(resolveReasoningCapability({ modelId: 'o3-mini' })?.knob).toBe(
      'effort',
    );
    expect(
      resolveReasoningCapability({ modelId: 'openai/o4-mini' })?.knob,
    ).toBe('effort');
  });

  it('maps Anthropic thinking families to the budget knob (with prefix)', () => {
    expect(
      resolveReasoningCapability({ modelId: 'anthropic/claude-sonnet-4' }),
    ).toEqual({
      knob: 'budgetTokens',
      selfTruncates: true,
      minBudgetTokens: 1024,
    });
    expect(
      resolveReasoningCapability({ modelId: 'anthropic/claude-3-7-sonnet' })
        ?.knob,
    ).toBe('budgetTokens');
  });

  it('matches an explicit :thinking / -thinking suffix', () => {
    expect(
      resolveReasoningCapability({ modelId: 'qwen/qwq-32b:thinking' })?.knob,
    ).toBe('budgetTokens');
  });

  it('returns null for non-reasoning models', () => {
    expect(resolveReasoningCapability({ modelId: 'openai/gpt-4o' })).toBeNull();
    expect(
      resolveReasoningCapability({ modelId: 'deepseek/deepseek-chat' }),
    ).toBeNull();
    expect(resolveReasoningCapability({ modelId: 'mistral-large' })).toBeNull();
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
