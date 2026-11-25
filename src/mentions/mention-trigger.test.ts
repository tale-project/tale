import { describe, expect, it } from 'vitest';

import { detectMentionTrigger } from './mention-trigger';

describe('detectMentionTrigger', () => {
  it('triggers on a leading @', () => {
    expect(detectMentionTrigger('@', 1)).toEqual({
      query: '',
      start: 0,
      end: 1,
    });
  });

  it('triggers on @ after whitespace and captures the query', () => {
    expect(detectMentionTrigger('summarize @rep', 14)).toEqual({
      query: 'rep',
      start: 10,
      end: 14,
    });
  });

  it('uses the text BEFORE the caret only', () => {
    expect(detectMentionTrigger('see @re and more', 7)).toEqual({
      query: 're',
      start: 4,
      end: 7,
    });
  });

  it('does not trigger mid-word (email addresses)', () => {
    expect(detectMentionTrigger('mail me at ym@tale.dev', 22)).toBeNull();
  });

  it('runs across the spaces of a name, up to three words', () => {
    expect(detectMentionTrigger('ping @My Opus', 13)).toEqual({
      query: 'My Opus',
      start: 5,
      end: 13,
    });
    expect(detectMentionTrigger('@My Opus ', 9)?.query).toBe('My Opus ');
    expect(detectMentionTrigger('@My Opus Agent', 14)?.query).toBe(
      'My Opus Agent',
    );
    expect(detectMentionTrigger('@My Opus Agent #3', 17)).toBeNull();
  });

  it('ends at a newline, a doubled space or another @', () => {
    expect(detectMentionTrigger('@ada\nnext', 9)).toBeNull();
    expect(detectMentionTrigger('@ada  next', 10)).toBeNull();
    expect(detectMentionTrigger('@ada @bo', 8)).toEqual({
      query: 'bo',
      start: 5,
      end: 8,
    });
  });

  it('does not trigger without an @', () => {
    expect(detectMentionTrigger('plain message', 13)).toBeNull();
  });
});
