import { describe, it, expect } from 'vitest';

import { computeCacheKey } from '../cache_key';

const BASE_PARAMS = {
  agentName: 'chat',
  model: 'claude-sonnet-4-20250514',
  instructions: 'You are a helpful assistant.',
  threadContext: '',
  userMessage: 'Hello',
};

describe('computeCacheKey', () => {
  it('returns a deterministic 16-char hex string', () => {
    const key1 = computeCacheKey(BASE_PARAMS);
    const key2 = computeCacheKey(BASE_PARAMS);
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('different agentName produces different key', () => {
    const key1 = computeCacheKey(BASE_PARAMS);
    const key2 = computeCacheKey({ ...BASE_PARAMS, agentName: 'support' });
    expect(key1).not.toBe(key2);
  });

  it('different model produces different key', () => {
    const key1 = computeCacheKey(BASE_PARAMS);
    const key2 = computeCacheKey({ ...BASE_PARAMS, model: 'gpt-4o' });
    expect(key1).not.toBe(key2);
  });

  it('different instructions produces different key', () => {
    const key1 = computeCacheKey(BASE_PARAMS);
    const key2 = computeCacheKey({
      ...BASE_PARAMS,
      instructions: 'You are a coding assistant.',
    });
    expect(key1).not.toBe(key2);
  });

  it('different threadContext produces different key', () => {
    const key1 = computeCacheKey(BASE_PARAMS);
    const key2 = computeCacheKey({
      ...BASE_PARAMS,
      threadContext: 'User: Hi\nAssistant: Hello!',
    });
    expect(key1).not.toBe(key2);
  });

  it('different userMessage produces different key', () => {
    const key1 = computeCacheKey(BASE_PARAMS);
    const key2 = computeCacheKey({ ...BASE_PARAMS, userMessage: 'Goodbye' });
    expect(key1).not.toBe(key2);
  });

  it('different generationParams produces different key', () => {
    const key1 = computeCacheKey(BASE_PARAMS);
    const key2 = computeCacheKey({
      ...BASE_PARAMS,
      generationParams: { temperature: 0 },
    });
    expect(key1).not.toBe(key2);
  });

  it('undefined generationParams same as empty object', () => {
    const key1 = computeCacheKey(BASE_PARAMS);
    const key2 = computeCacheKey({ ...BASE_PARAMS, generationParams: {} });
    // Both should use {} via the ?? fallback
    expect(key1).toBe(key2);
  });

  it('preserves semantic differences in punctuation', () => {
    const keyCpp = computeCacheKey({ ...BASE_PARAMS, userMessage: 'C++' });
    const keyC = computeCacheKey({ ...BASE_PARAMS, userMessage: 'C' });
    expect(keyCpp).not.toBe(keyC);
  });

  it('whitespace normalization collapses trivial differences', () => {
    const key1 = computeCacheKey({
      ...BASE_PARAMS,
      userMessage: 'hello  world',
    });
    const key2 = computeCacheKey({
      ...BASE_PARAMS,
      userMessage: 'hello world',
    });
    expect(key1).toBe(key2);
  });
});
