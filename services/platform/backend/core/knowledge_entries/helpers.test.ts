import { describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import { normalizeTopicKey } from './constants';
import { validateTopicAndContent } from './helpers';

describe('normalizeTopicKey', () => {
  it('lowercases', () => {
    expect(normalizeTopicKey('Store Hours')).toBe('store hours');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeTopicKey('  Return policy  ')).toBe('return policy');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeTopicKey('Store \t  Hours\n today')).toBe(
      'store hours today',
    );
  });

  it('maps equivalent spellings to the same key', () => {
    expect(normalizeTopicKey('STORE   hours ')).toBe(
      normalizeTopicKey('store Hours'),
    );
  });
});

describe('validateTopicAndContent', () => {
  it('trims and returns normalized topicKey', () => {
    const result = validateTopicAndContent('  Store Hours ', ' Open 9-5 ');
    expect(result.topic).toBe('Store Hours');
    expect(result.topicKey).toBe('store hours');
    expect(result.content).toBe('Open 9-5');
  });

  // #2000: validation rejects with structured AppError codes (not raw
  // `Error`), so the client receives a readable code instead of an opaque
  // "Server Error".
  function codeOf(fn: () => unknown): string | undefined {
    try {
      fn();
    } catch (err) {
      if (!(err instanceof AppError)) return undefined;
      const data: unknown = err.data;
      if (typeof data !== 'object' || data === null || !('code' in data)) {
        return undefined;
      }
      const candidate: unknown = data.code;
      return typeof candidate === 'string' ? candidate : undefined;
    }
    return undefined;
  }

  it('rejects empty topic', () => {
    expect(codeOf(() => validateTopicAndContent('   ', 'content'))).toBe(
      'KNOWLEDGE_ENTRY_TOPIC_REQUIRED',
    );
  });

  it('rejects topic over the cap', () => {
    expect(
      codeOf(() => validateTopicAndContent('x'.repeat(121), 'content')),
    ).toBe('KNOWLEDGE_ENTRY_TOPIC_TOO_LONG');
  });

  it('rejects empty content', () => {
    expect(codeOf(() => validateTopicAndContent('topic', '   '))).toBe(
      'KNOWLEDGE_ENTRY_CONTENT_REQUIRED',
    );
  });

  it('rejects content over the cap', () => {
    expect(
      codeOf(() => validateTopicAndContent('topic', 'x'.repeat(8001))),
    ).toBe('KNOWLEDGE_ENTRY_CONTENT_TOO_LONG');
  });
});
