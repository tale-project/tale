import { describe, expect, it } from 'vitest';

import { MAX_PROMPT_CONTENT_BYTES } from '@/convex/prompts/constants';

import { computePromptContentLimit } from './use-prompt-content-limit';

describe('computePromptContentLimit', () => {
  it('is under limit for short ASCII content', () => {
    const result = computePromptContentLimit('Hello world');
    expect(result.chars).toBe(11);
    expect(result.bytes).toBe(11);
    expect(result.overLimit).toBe(false);
    expect(result.approachingLimit).toBe(false);
  });

  it('flags content right at the byte ceiling as in-limit', () => {
    const content = 'x'.repeat(MAX_PROMPT_CONTENT_BYTES);
    const result = computePromptContentLimit(content);
    expect(result.bytes).toBe(MAX_PROMPT_CONTENT_BYTES);
    expect(result.overLimit).toBe(false);
  });

  it('flags content one byte over the ceiling as over-limit', () => {
    const content = 'x'.repeat(MAX_PROMPT_CONTENT_BYTES + 1);
    const result = computePromptContentLimit(content);
    expect(result.overLimit).toBe(true);
  });

  // Regression: the #2644 fix compared a char count against the byte cap
  // directly, so multi-byte content (accents, emoji, CJK) could read as
  // "under limit" in characters while already over the real UTF-8 byte cap
  // the server enforces — a false, contradictory reading, since Save was
  // already blocked. `overLimit` must key off `bytes`, never `chars`, so a
  // char count under the byte-cap NUMBER while over the real byte budget
  // still correctly reports over-limit.
  it('is byte-blocked on multi-byte content whose char count reads well under the byte cap', () => {
    // Each 'é' is 1 UTF-16 code unit (chars) but 2 UTF-8 bytes.
    const charCount = 9_000;
    const content = 'é'.repeat(charCount);
    const result = computePromptContentLimit(content);

    // The old, defective design would have shown
    // `${charCount} / ${MAX_PROMPT_CONTENT_BYTES} characters` here — i.e.
    // "9,000 / 16,384 characters", falsely implying plenty of room left.
    expect(result.chars).toBe(charCount);
    expect(result.chars).toBeLessThan(MAX_PROMPT_CONTENT_BYTES);

    // The real, byte-based gate is already tripped.
    expect(result.bytes).toBe(charCount * 2);
    expect(result.bytes).toBeGreaterThan(MAX_PROMPT_CONTENT_BYTES);
    expect(result.overLimit).toBe(true);
  });

  it('formats the cap as a human-readable size, not a raw byte count', () => {
    const result = computePromptContentLimit('anything');
    expect(result.limitLabel).toBe('16 KB');
  });
});
