import { describe, expect, it } from 'vitest';

import { buildReasoningOptions } from './build_reasoning_options';
import { resolveReasoningCapability } from './capability';
import { recordOutcome } from './controller';
import { TIER_RANK, type ReasoningState } from './types';

/**
 * End-to-end convergence checks through the public surface: drive a self-
 * truncating model across a simulated conversation (decide → observe usage →
 * record) and assert the loop's emergent behaviour.
 */

const MODEL = {
  providerName: 'anthropic',
  modelId: 'anthropic/claude-sonnet-4',
  maxOutputTokens: 32768,
};

// A non-trivial, non-floored medium prompt (no code, no hard-verb triggers).
const MEDIUM_PROMPT =
  'Describe the main differences between living in a big city and a small ' +
  'town, covering cost of living, social life, commuting, and access to ' +
  'nature, with a few concrete examples for each point.';

function driveThread(promptText: string, usageTokens: number, turns: number) {
  const cap = resolveReasoningCapability(MODEL);
  if (!cap) throw new Error('expected a steerable model');
  let state: ReasoningState | undefined;
  let last = buildReasoningOptions({
    modelData: MODEL,
    signals: { kind: 'chat', promptText },
    state,
  });
  for (let i = 0; i < turns; i++) {
    last = buildReasoningOptions({
      modelData: MODEL,
      signals: { kind: 'chat', promptText },
      state,
    });
    state = recordOutcome(state, {
      difficultyClass: last.difficultyClass,
      reasoningTokens: usageTokens,
      budgetTokens: last.budgetTokens,
      selfTruncates: cap.selfTruncates,
      finishReason: 'stop',
    });
  }
  return { last, state };
}

describe('governor convergence (simulation)', () => {
  it('shrinks the reasoning budget when the model consistently under-uses it', () => {
    const first = buildReasoningOptions({
      modelData: MODEL,
      signals: { kind: 'chat', promptText: MEDIUM_PROMPT },
    });
    expect(first.applied).toBe(true);
    expect(first.budgetTokens).toBeGreaterThan(0);

    const { last } = driveThread(MEDIUM_PROMPT, 200, 12);
    expect(last.budgetTokens).toBeLessThan(first.budgetTokens);
  });

  it('keeps a hard (code) turn at or above medium even after an easy history', () => {
    const cap = resolveReasoningCapability(MODEL);
    if (!cap) throw new Error('expected a steerable model');
    let state: ReasoningState | undefined;
    for (let i = 0; i < 10; i++) {
      const d = buildReasoningOptions({
        modelData: MODEL,
        signals: { kind: 'chat', promptText: 'hi there' },
        state,
      });
      state = recordOutcome(state, {
        difficultyClass: d.difficultyClass,
        reasoningTokens: 40,
        budgetTokens: d.budgetTokens,
        selfTruncates: cap.selfTruncates,
        finishReason: 'stop',
      });
    }
    const hard = buildReasoningOptions({
      modelData: MODEL,
      signals: {
        kind: 'chat',
        promptText: 'debug this please\n```ts\nconst x = f(y)\n```',
      },
      state,
    });
    expect(TIER_RANK[hard.tier]).toBeGreaterThanOrEqual(TIER_RANK.medium);
  });
});
