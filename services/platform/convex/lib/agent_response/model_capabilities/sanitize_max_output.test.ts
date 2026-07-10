import { describe, expect, it } from 'vitest';

import { usableMaxOutputTokens } from './sanitize_max_output';

describe('usableMaxOutputTokens', () => {
  it('keeps a cap that leaves room for the prompt', () => {
    expect(usableMaxOutputTokens(101376, 1048576)).toBe(101376);
    expect(usableMaxOutputTokens(128000, 202752)).toBe(128000);
  });

  it('drops a cap that equals or exceeds the context window', () => {
    expect(usableMaxOutputTokens(1048576, 1048576)).toBeUndefined();
    expect(usableMaxOutputTokens(200000, 100000)).toBeUndefined();
  });

  it('passes through when context is unknown', () => {
    expect(usableMaxOutputTokens(8192, undefined)).toBe(8192);
  });

  it('treats non-positive caps as unknown', () => {
    expect(usableMaxOutputTokens(0, 100000)).toBeUndefined();
    expect(usableMaxOutputTokens(undefined, 100000)).toBeUndefined();
  });
});
