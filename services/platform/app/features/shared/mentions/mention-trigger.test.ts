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
    // Caret right after '@re' even though more text follows.
    expect(detectMentionTrigger('see @re and more', 7)).toEqual({
      query: 're',
      start: 4,
      end: 7,
    });
  });

  it('does not trigger mid-word (email addresses)', () => {
    expect(detectMentionTrigger('mail me at ym@tale.dev', 22)).toBeNull();
  });

  it('does not trigger once whitespace follows the query', () => {
    expect(detectMentionTrigger('@report done', 12)).toBeNull();
  });

  it('does not trigger without an @', () => {
    expect(detectMentionTrigger('plain message', 13)).toBeNull();
  });
});
