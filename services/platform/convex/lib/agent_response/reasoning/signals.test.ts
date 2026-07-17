import { describe, expect, it } from 'vitest';

import { scoreDifficulty } from './signals';

describe('scoreDifficulty', () => {
  it('forces utility calls to off regardless of content', () => {
    const result = scoreDifficulty({
      kind: 'utility',
      promptText: 'Prove that sqrt(2) is irrational. ```ts huge code ```',
    });
    expect(result.target.tier).toBe('off');
    expect(result.floorTier).toBe('off');
  });

  it('drops trivial greetings/acks to off', () => {
    for (const text of ['hi', 'thanks!', 'ok', 'sounds good']) {
      expect(
        scoreDifficulty({ kind: 'chat', promptText: text }).target.tier,
      ).toBe('off');
    }
  });

  it('floors code prompts at medium', () => {
    const result = scoreDifficulty({
      kind: 'chat',
      promptText: 'why does this break?\n```js\nconsole.log(x)\n```',
    });
    expect(result.floorTier).toBe('medium');
    expect(['medium', 'high']).toContain(result.target.tier);
  });

  it('floors hard-verb prompts at medium', () => {
    const result = scoreDifficulty({
      kind: 'chat',
      promptText: 'Please prove that there are infinitely many primes.',
    });
    expect(result.floorTier).toBe('medium');
  });

  it('raises a long, structured, multi-step coding task to high', () => {
    const big = 'x'.repeat(3000);
    const result = scoreDifficulty({
      kind: 'chat',
      promptText: `Refactor and analyze performance.\n\`\`\`ts\n${big}\n\`\`\`\nSteps:\n1. profile\n2. optimize\n3. verify`,
      toolCount: 6,
      maxSteps: 12,
    });
    expect(result.target.tier).toBe('high');
  });

  it('gives attachments at least a low floor', () => {
    const result = scoreDifficulty({
      kind: 'chat',
      promptText: 'what is this?',
      hasAttachments: true,
    });
    expect(result.floorTier).toBe('low');
  });

  it('treats a short follow-up deep in a thread as easy', () => {
    const result = scoreDifficulty({
      kind: 'chat',
      promptText: 'and the second one?',
      historyMessageCount: 12,
    });
    expect(['off', 'low']).toContain(result.target.tier);
  });

  it('detects code from inline backticks and stack traces, not just fences (A4)', () => {
    const stackTrace = scoreDifficulty({
      kind: 'chat',
      promptText:
        'TypeError: Cannot read properties of undefined (reading "x")\n    at foo (/app/index.js:10:5)',
    });
    // A raw stack trace (no fences) now clears the code floor.
    expect(stackTrace.floorTier).toBe('medium');
  });

  it('scores two hard verbs strictly higher than one (A4 graded intent)', () => {
    const one = scoreDifficulty({
      kind: 'chat',
      promptText: 'Please analyze this situation.',
    });
    const two = scoreDifficulty({
      kind: 'chat',
      promptText: 'Please analyze and evaluate this situation rigorously.',
    });
    expect(two.intensity).toBeGreaterThan(one.intensity);
  });

  it('handles a borderline follow-up smoothly without a 6/30 cliff (A4)', () => {
    // Just below the old hard threshold (count 5, ~35 chars): should not jump.
    const borderline = scoreDifficulty({
      kind: 'chat',
      promptText: 'can you expand on that a little more',
      historyMessageCount: 5,
    });
    expect(['off', 'low', 'medium']).toContain(borderline.target.tier);
    expect(borderline.intensity).toBeLessThan(1);
  });

  it('does not damp a terse HARD rework deep in a thread (P1-A)', () => {
    // A short message deep in a thread WITH code is a rework, not a casual
    // follow-up — the follow-up penalty must not pull it below its code floor.
    const rework = scoreDifficulty({
      kind: 'chat',
      promptText: 'now redo it in Rust:\n```rs\nfn main(){}\n```',
      historyMessageCount: 12,
    });
    expect(rework.floorTier).toBe('medium');
    expect(['medium', 'high']).toContain(rework.target.tier);
    // A plain short follow-up in the same deep thread still damps to easy.
    const casual = scoreDifficulty({
      kind: 'chat',
      promptText: 'and the next one?',
      historyMessageCount: 12,
    });
    expect(['off', 'low']).toContain(casual.target.tier);
  });

  it('blends the prior toward a router effort seed (P0-A)', () => {
    // A lexically-plain prompt the heuristic rates low, lifted by a high seed.
    const plain = 'walk me through the options here';
    const unseeded = scoreDifficulty({ kind: 'chat', promptText: plain });
    const seeded = scoreDifficulty({
      kind: 'chat',
      promptText: plain,
      effortSeed: 'high',
    });
    expect(seeded.intensity).toBeGreaterThan(unseeded.intensity);
  });

  it('is byte-identical to the pure heuristic when no seed is given (P0-A)', () => {
    const signals = {
      kind: 'chat' as const,
      promptText: 'Please analyze and evaluate this rigorously.',
      historyMessageCount: 3,
    };
    const base = scoreDifficulty(signals);
    const seedless = scoreDifficulty({
      ...signals,
      effortSeed: undefined,
      creativitySeed: undefined,
    });
    expect(seedless).toEqual(base);
  });

  it('blends creativity toward a router creativity seed (P0-A)', () => {
    const plain = 'tell me about cats';
    const precise = scoreDifficulty({
      kind: 'chat',
      promptText: plain,
      creativitySeed: 'precise',
    });
    const creative = scoreDifficulty({
      kind: 'chat',
      promptText: plain,
      creativitySeed: 'creative',
    });
    expect(creative.creativity).toBeGreaterThan(precise.creativity);
  });
});

describe('class-capped prior budget', () => {
  // The prior may never announce 'easy' yet spend a 'medium' thinking budget:
  // a single feature weight (math on "what is 2+2?") used to push a trivial
  // turn to a ~3.4k-token thinking prior — seconds of dead air before the
  // first visible token.
  it('caps an easy-class turn at the low-tier budget even when math fires', () => {
    const r = scoreDifficulty({
      kind: 'chat',
      promptText: 'What is 2+2? Answer in one word.',
    });
    expect(r.difficultyClass).toBe('easy');
    expect(r.target.tier).toBe('low');
    expect(r.target.budgetTokens).toBeLessThanOrEqual(2048);
  });

  it('keeps trivial greetings at tier off', () => {
    const r = scoreDifficulty({ kind: 'chat', promptText: 'hello' });
    expect(r.target.tier).toBe('off');
    expect(r.target.budgetTokens).toBe(0);
  });

  it('floors still win: code turns keep their medium minimum', () => {
    const r = scoreDifficulty({
      kind: 'chat',
      promptText: 'Fix this:\n```js\nconst x = arr.map(f);\n```',
    });
    expect(r.floorTier).toBe('medium');
    expect(r.target.budgetTokens).toBeGreaterThanOrEqual(8192);
  });

  it('hard turns keep an uncapped high-tier prior', () => {
    const r = scoreDifficulty({
      kind: 'chat',
      promptText:
        'Prove that sqrt(2) is irrational, then formalize the argument step by step.',
    });
    expect(r.difficultyClass).toBe('hard');
    expect(r.target.budgetTokens).toBeGreaterThan(8192);
  });
});
