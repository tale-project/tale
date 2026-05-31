import { describe, expect, it } from 'vitest';

import {
  buildReasoningOptions,
  type BuildReasoningOptionsInput,
} from './build_reasoning_options';
import { TIER_RANK, type ReasoningTier } from './types';

/**
 * Behavioral invariants of the Adaptive Reasoning Governor, asserted through
 * its stable public surface (`buildReasoningOptions`). These must hold for ANY
 * internal implementation of the difficulty prior / controller, so they guard
 * the algorithm against regressions across rewrites.
 */

const EFFORT_MODEL = { providerName: 'openai', modelId: 'gpt-5' };
const BUDGET_MODEL = {
  providerName: 'anthropic',
  modelId: 'anthropic/claude-sonnet-4',
  maxOutputTokens: 8192,
};
const NON_REASONING = { providerName: 'openai', modelId: 'openai/gpt-4o' };

function decide(
  modelData: BuildReasoningOptionsInput['modelData'],
  promptText: string,
  extra: Partial<BuildReasoningOptionsInput['signals']> = {},
) {
  return buildReasoningOptions({
    modelData,
    signals: { kind: 'chat', promptText, ...extra },
  });
}

const TRIVIAL = 'hi';
const HARD =
  'Refactor and analyze the performance of this module, then prove the bound.\n```ts\n' +
  'x'.repeat(2000) +
  '\n```\nSteps:\n1. profile\n2. optimize\n3. verify';

describe('governor invariants', () => {
  it('never steers an unknown (non-reasoning) model and passes base through untouched', () => {
    const base = { openai: { foo: 'bar', nested: { a: 1 } } };
    const decision = buildReasoningOptions({
      modelData: NON_REASONING,
      baseProviderOptions: base,
      signals: { kind: 'chat', promptText: HARD },
    });
    expect(decision.applied).toBe(false);
    expect(decision.providerOptions).toEqual(base);
  });

  it('forces utility calls to off on every model family', () => {
    expect(decide(EFFORT_MODEL, HARD, { kind: 'utility' }).tier).toBe('off');
    expect(decide(BUDGET_MODEL, HARD, { kind: 'utility' }).tier).toBe('off');
    // off effort model still emits a (minimal) floor; off budget model emits nothing.
    expect(
      decide(EFFORT_MODEL, HARD, { kind: 'utility' }).providerOptions,
    ).toEqual({
      openai: { reasoningEffort: 'minimal' },
    });
    expect(decide(BUDGET_MODEL, HARD, { kind: 'utility' }).applied).toBe(false);
  });

  it('is monotonic at the extremes: trivial ≤ hard (both knobs)', () => {
    for (const model of [EFFORT_MODEL, BUDGET_MODEL]) {
      const easy = decide(model, TRIVIAL);
      const hard = decide(model, HARD);
      expect(TIER_RANK[hard.tier]).toBeGreaterThanOrEqual(TIER_RANK[easy.tier]);
    }
  });

  it('honors hard-signal floors (code ⇒ at least medium)', () => {
    const decision = decide(
      EFFORT_MODEL,
      'why does this throw?\n```js\nf(x)\n```',
    );
    expect(TIER_RANK[decision.tier]).toBeGreaterThanOrEqual(
      TIER_RANK['medium'],
    );
  });

  it('emits only valid effort values for effort-knob models', () => {
    const valid = new Set(['minimal', 'low', 'medium', 'high']);
    for (const prompt of [TRIVIAL, 'summarize this', HARD, 'design a system']) {
      const opts = decide(EFFORT_MODEL, prompt).providerOptions as
        | { openai?: { reasoningEffort?: string } }
        | undefined;
      const effort = opts?.openai?.reasoningEffort;
      expect(effort && valid.has(effort)).toBe(true);
    }
  });

  it('keeps the thinking budget within the model output cap and the provider floor', () => {
    const decision = decide(BUDGET_MODEL, HARD);
    const opts = decision.providerOptions;
    if (decision.applied && opts) {
      const thinking = (opts.anthropic as Record<string, unknown>).thinking as {
        budget_tokens: number;
      };
      expect(thinking.budget_tokens).toBeGreaterThanOrEqual(1024);
      expect(thinking.budget_tokens).toBeLessThanOrEqual(8192 - 1024);
    }
  });

  it('never clobbers existing provider options when merging the overlay', () => {
    const base = { openai: { provider: { quantizations: ['fp8'] }, foo: 42 } };
    const decision = buildReasoningOptions({
      modelData: EFFORT_MODEL,
      baseProviderOptions: base,
      signals: { kind: 'chat', promptText: HARD },
    });
    const merged = decision.providerOptions?.openai as Record<string, unknown>;
    expect(merged.provider).toEqual({ quantizations: ['fp8'] });
    expect(merged.foo).toBe(42);
    expect(merged.reasoningEffort).toBeDefined();
  });

  it('is deterministic for identical inputs (no hidden randomness)', () => {
    const input: BuildReasoningOptionsInput = {
      modelData: EFFORT_MODEL,
      signals: { kind: 'chat', promptText: HARD, toolCount: 3 },
    };
    expect(buildReasoningOptions(input)).toEqual(buildReasoningOptions(input));
  });

  it('returns a tier that is one of the canonical values', () => {
    const tiers: ReasoningTier[] = ['off', 'low', 'medium', 'high'];
    for (const model of [EFFORT_MODEL, BUDGET_MODEL, NON_REASONING]) {
      expect(tiers).toContain(decide(model, HARD).tier);
    }
  });
});
