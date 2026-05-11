import { describe, expect, it } from 'vitest';

import { extractSnippet, extractTerms } from './snippet';

describe('extractTerms', () => {
  it('lowercases and dedupes', () => {
    expect(extractTerms('Hello hello To World')).toEqual([
      'hello',
      'to',
      'world',
    ]);
  });

  it('keeps single-character tokens so they can still highlight', () => {
    // Old behaviour dropped len<2 — we keep them. Search-gating happens at
    // the call site (the hook) instead, so the tokenizer is permissive.
    expect(extractTerms('a b config')).toEqual(['a', 'b', 'config']);
  });

  it('strips punctuation but keeps hyphens and underscores', () => {
    expect(extractTerms('self-hosted, agent_id; foo!')).toEqual([
      'self-hosted',
      'agent_id',
      'foo',
    ]);
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(extractTerms('   ')).toEqual([]);
  });

  it('drops empty tokens produced by stripping punctuation', () => {
    expect(extractTerms('!!! ???')).toEqual([]);
  });
});

describe('extractSnippet', () => {
  const body =
    'Tale is a self-hosted platform for chat and automations. ' +
    'Self-hosted means you run your own instance with full control over data residency. ' +
    'Cloud users get the same features without managing infrastructure.';

  it('returns the head when no terms are supplied', () => {
    const snippet = extractSnippet(body, [], 40);
    expect(snippet.startsWith('Tale is a')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('centres the window around the matched term', () => {
    const snippet = extractSnippet(body, ['residency'], 80);
    expect(snippet).toMatch(/residency/i);
    expect(snippet.startsWith('… ')).toBe(true);
  });

  it('prefers the longest matched term over a shorter one', () => {
    // Both "config" and "configuration" appear; the longer one carries more
    // signal. Build a body where the two are far enough apart that the
    // returned window would clearly include only one.
    const big =
      'config appears very early in this short overview. ' +
      'A long stretch of unrelated prose follows: ' +
      'X X X X X X X X X X X X X X X X X X X X X X X X X X X X X X. ' +
      'Then later we discuss the configuration option in detail.';
    const snippet = extractSnippet(big, ['config', 'configuration'], 80);
    expect(snippet).toMatch(/configuration/);
  });

  it('returns the head when no term matches the body', () => {
    const snippet = extractSnippet(body, ['unrelated'], 40);
    expect(snippet.startsWith('Tale is a')).toBe(true);
  });

  it('returns the body unchanged when shorter than the window', () => {
    expect(extractSnippet('short body', ['short'], 200)).toBe('short body');
  });

  it('returns an empty string for an empty body', () => {
    expect(extractSnippet('', ['hello'])).toBe('');
  });

  it('snaps the start to a word boundary', () => {
    const snippet = extractSnippet(body, ['residency'], 80);
    // The "… " prefix marks the cut; the next character should not be
    // mid-word — we either land on a capital letter or a known word start.
    const after = snippet.slice(2);
    expect(after[0]).toMatch(/[A-Za-z]/);
  });

  it('handles case-insensitive matching', () => {
    const snippet = extractSnippet('The Quick Brown Fox', ['quick'], 30);
    expect(snippet.toLowerCase()).toContain('quick');
  });

  it('ignores empty-string terms in the input set', () => {
    const snippet = extractSnippet(body, ['', 'residency'], 80);
    expect(snippet).toMatch(/residency/i);
  });
});
