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
});
