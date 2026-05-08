import { describe, expect, it } from 'vitest';

import { extractSnippet, extractTerms } from './snippet';

describe('extractTerms', () => {
  it('lowercases, dedupes, and drops short tokens', () => {
    expect(extractTerms('Hello hello a To World')).toEqual([
      'hello',
      'to',
      'world',
    ]);
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

  it('centres the window around the first matched term', () => {
    const snippet = extractSnippet(body, ['residency'], 80);
    expect(snippet).toMatch(/residency/i);
    expect(snippet.startsWith('… ')).toBe(true);
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
});
